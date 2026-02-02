/**
 * Providers Module - Clawdbot-style model provider management
 *
 * Features:
 * - Multiple AI model providers (Anthropic, OpenAI, etc.)
 * - Unified API interface
 * - Streaming support
 * - Fallback chains
 * - Rate limiting
 * - Cost tracking
 * - Retry with exponential backoff
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import {
  withRetry,
  RetryConfig,
  RETRY_POLICIES,
  RateLimitError,
  TransientError,
  isRetryableError,
} from '../infra/retry';
import { GroqProvider, TogetherProvider, FireworksProvider } from './discovery';

// =============================================================================
// TYPES
// =============================================================================

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  stream?: boolean;
}

export interface CompletionResult {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'error';
  latency: number;
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  timeout?: number;
  maxRetries?: number;
  /** Retry configuration */
  retry?: RetryConfig;
  /** Retry policy name (default, conservative, aggressive, or provider-specific) */
  retryPolicy?: string;
}

export interface Provider {
  name: string;
  complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult>;
  stream(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk>;
  listModels(): Promise<string[]>;
  isAvailable(): Promise<boolean>;
}

// =============================================================================
// GEMINI PROVIDER (Google Generative Language API)
// =============================================================================

export class GeminiProvider implements Provider {
  name = 'gemini';
  private apiKey: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private defaultModel = process.env.CLODDS_GEMINI_MODEL || 'gemini-1.5-pro';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private endpoint(model: string, method: 'generateContent' | 'streamGenerateContent'): string {
    const cleanModel = model.startsWith('models/') ? model : `models/${model}`;
    return `${this.baseUrl}/${cleanModel}:${method}?key=${this.apiKey}`;
  }

  private toGeminiMessages(messages: Message[]): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n').trim();
    const rest = messages.filter(m => m.role !== 'system');

    const mapped = rest.map((m) => {
      const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
      return {
        role,
        parts: [{ text: m.content }],
      };
    });

    if (system) {
      mapped.unshift({
        role: 'user',
        parts: [{ text: `System instruction:\n${system}` }],
      });
    }

    return mapped;
  }

  async complete(messages: Message[], options: CompletionOptions = {}): Promise<CompletionResult> {
    const startTime = Date.now();
    const model = options.model || this.defaultModel;

    const response = await fetch(this.endpoint(model, 'generateContent'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: this.toGeminiMessages(messages),
        generationConfig: {
          temperature: options.temperature,
          topP: options.topP,
          maxOutputTokens: options.maxTokens,
          stopSequences: options.stopSequences,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini error: ${response.status}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      modelVersion?: string;
    };

    const content = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    const finish = data.candidates?.[0]?.finishReason;

    return {
      content,
      model: data.modelVersion || model,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
      finishReason: finish === 'STOP' ? 'end_turn' : 'end_turn',
      latency: Date.now() - startTime,
    };
  }

  async *stream(messages: Message[], options: CompletionOptions = {}): AsyncIterable<StreamChunk> {
    const model = options.model || this.defaultModel;

    const response = await fetch(this.endpoint(model, 'streamGenerateContent'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: this.toGeminiMessages(messages),
        generationConfig: {
          temperature: options.temperature,
          topP: options.topP,
          maxOutputTokens: options.maxTokens,
          stopSequences: options.stopSequences,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini streaming error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Gemini streaming responses are JSON lines.
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const content = event.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
          if (content) {
            yield { content, done: false };
          }
        } catch {
          // Ignore malformed chunks.
        }
      }
    }

    yield { content: '', done: true };
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models?key=${this.apiKey}`);
      if (!response.ok) return [];
      const data = await response.json() as { models?: Array<{ name: string }> };
      return data.models?.map(m => m.name.replace(/^models\//, '')) || [];
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const models = await this.listModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// ANTHROPIC PROVIDER
// =============================================================================

export class AnthropicProvider implements Provider {
  name = 'anthropic';
  private config: ProviderConfig;
  private retryConfig: RetryConfig;

  constructor(config: ProviderConfig) {
    this.config = {
      baseUrl: 'https://api.anthropic.com',
      defaultModel: 'claude-3-5-sonnet-20241022',
      timeout: 120000,
      maxRetries: 3,
      ...config,
    };

    // Set up retry configuration
    const policy = config.retryPolicy ? RETRY_POLICIES[config.retryPolicy] : RETRY_POLICIES.anthropic;
    this.retryConfig = {
      ...policy?.config,
      ...config.retry,
      maxAttempts: config.maxRetries ?? policy?.config.maxAttempts ?? 3,
      onRetry: (info) => {
        logger.warn({
          provider: 'anthropic',
          attempt: info.attempt,
          maxAttempts: info.maxAttempts,
          delay: info.delay,
          error: info.error.message,
        }, 'Anthropic API retry');
      },
    };
  }

  async complete(messages: Message[], options: CompletionOptions = {}): Promise<CompletionResult> {
    const startTime = Date.now();

    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const body = {
      model: options.model || this.config.defaultModel,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature,
      top_p: options.topP,
      stop_sequences: options.stopSequences,
      system: systemMessages.map(m => m.content).join('\n\n') || undefined,
      messages: conversationMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    };

    const response = await this.request('/v1/messages', body);

    return {
      content: response.content[0]?.text || '',
      model: response.model,
      usage: {
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
        totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      },
      finishReason: response.stop_reason === 'end_turn' ? 'end_turn' :
        response.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
      latency: Date.now() - startTime,
    };
  }

  async *stream(messages: Message[], options: CompletionOptions = {}): AsyncIterable<StreamChunk> {
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const body = {
      model: options.model || this.config.defaultModel,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature,
      top_p: options.topP,
      stop_sequences: options.stopSequences,
      system: systemMessages.map(m => m.content).join('\n\n') || undefined,
      messages: conversationMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    };

    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { content: '', done: true };
            return;
          }

          try {
            const event = JSON.parse(data);
            if (event.type === 'content_block_delta' && event.delta?.text) {
              yield { content: event.delta.text, done: false };
            }
            if (event.type === 'message_stop') {
              yield { content: '', done: true };
              return;
            }
          } catch (e) {
            logger.debug({ err: e, line }, 'Failed to parse SSE event');
          }
        }
      }
    }

    yield { content: '', done: true };
  }

  async listModels(): Promise<string[]> {
    return [
      'claude-3-5-sonnet-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      return response.ok || response.status === 400; // 400 means auth is valid
    } catch {
      return false;
    }
  }

  private async request(path: string, body: unknown): Promise<any> {
    return withRetry(async () => {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const statusCode = response.status;

        // Rate limit
        if (statusCode === 429) {
          const retryAfter = response.headers.get('retry-after');
          throw new RateLimitError(
            `Anthropic rate limited: ${statusCode} - ${errorText}`,
            statusCode,
            retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined
          );
        }

        // Server errors are transient
        if (statusCode >= 500) {
          throw new TransientError(`Anthropic server error: ${statusCode} - ${errorText}`, statusCode);
        }

        // Client errors are not retryable
        throw new Error(`Anthropic API error: ${statusCode} - ${errorText}`);
      }

      return response.json();
    }, this.retryConfig);
  }
}

// =============================================================================
// OPENAI PROVIDER
// =============================================================================

export class OpenAIProvider implements Provider {
  name = 'openai';
  private config: ProviderConfig;
  private retryConfig: RetryConfig;

  constructor(config: ProviderConfig) {
    this.config = {
      baseUrl: 'https://api.openai.com',
      defaultModel: 'gpt-4o',
      timeout: 120000,
      maxRetries: 3,
      ...config,
    };

    // Set up retry configuration
    const policy = config.retryPolicy ? RETRY_POLICIES[config.retryPolicy] : RETRY_POLICIES.openai;
    this.retryConfig = {
      ...policy?.config,
      ...config.retry,
      maxAttempts: config.maxRetries ?? policy?.config.maxAttempts ?? 3,
      onRetry: (info) => {
        logger.warn({
          provider: 'openai',
          attempt: info.attempt,
          maxAttempts: info.maxAttempts,
          delay: info.delay,
          error: info.error.message,
        }, 'OpenAI API retry');
      },
    };
  }

  async complete(messages: Message[], options: CompletionOptions = {}): Promise<CompletionResult> {
    const startTime = Date.now();

    const body = {
      model: options.model || this.config.defaultModel,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature,
      top_p: options.topP,
      stop: options.stopSequences,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    };

    const response = await this.request('/v1/chat/completions', body);

    return {
      content: response.choices[0]?.message?.content || '',
      model: response.model,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      finishReason: response.choices[0]?.finish_reason === 'stop' ? 'end_turn' :
        response.choices[0]?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
      latency: Date.now() - startTime,
    };
  }

  async *stream(messages: Message[], options: CompletionOptions = {}): AsyncIterable<StreamChunk> {
    const body = {
      model: options.model || this.config.defaultModel,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature,
      top_p: options.topP,
      stop: options.stopSequences,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    };

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { content: '', done: true };
            return;
          }

          try {
            const event = JSON.parse(data);
            const content = event.choices?.[0]?.delta?.content;
            if (content) {
              yield { content, done: false };
            }
            if (event.choices?.[0]?.finish_reason) {
              yield { content: '', done: true };
              return;
            }
          } catch (e) {
            logger.debug({ err: e, line }, 'Failed to parse OpenAI SSE event');
          }
        }
      }
    }

    yield { content: '', done: true };
  }

  async listModels(): Promise<string[]> {
    const response = await this.request('/v1/models', null);
    return response.data
      .filter((m: any) => m.id.includes('gpt'))
      .map((m: any) => m.id);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async request(path: string, body: unknown): Promise<any> {
    return withRetry(async () => {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const statusCode = response.status;

        // Rate limit
        if (statusCode === 429) {
          const retryAfter = response.headers.get('retry-after');
          throw new RateLimitError(
            `OpenAI rate limited: ${statusCode} - ${errorText}`,
            statusCode,
            retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined
          );
        }

        // Server errors are transient
        if (statusCode >= 500) {
          throw new TransientError(`OpenAI server error: ${statusCode} - ${errorText}`, statusCode);
        }

        // Client errors are not retryable
        throw new Error(`OpenAI API error: ${statusCode} - ${errorText}`);
      }

      return response.json();
    }, this.retryConfig);
  }
}

// =============================================================================
// OLLAMA PROVIDER (LOCAL)
// =============================================================================

export class OllamaProvider implements Provider {
  name = 'ollama';
  private baseUrl: string;
  private defaultModel: string;
  private retryConfig: RetryConfig;

  constructor(baseUrl = 'http://localhost:11434', defaultModel = 'llama3', retryConfig?: RetryConfig) {
    this.baseUrl = baseUrl;
    this.defaultModel = defaultModel;
    this.retryConfig = {
      ...RETRY_POLICIES.default.config,
      ...retryConfig,
      onRetry: (info) => {
        logger.warn({
          provider: 'ollama',
          attempt: info.attempt,
          maxAttempts: info.maxAttempts,
          delay: info.delay,
          error: info.error.message,
        }, 'Ollama retry');
      },
    };
  }

  async complete(messages: Message[], options: CompletionOptions = {}): Promise<CompletionResult> {
    const startTime = Date.now();

    return withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model || this.defaultModel,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          stream: false,
          options: {
            temperature: options.temperature,
            top_p: options.topP,
            num_predict: options.maxTokens,
            stop: options.stopSequences,
          },
        }),
      });

      if (!response.ok) {
        const statusCode = response.status;
        if (statusCode >= 500) {
          throw new TransientError(`Ollama server error: ${statusCode}`, statusCode);
        }
        throw new Error(`Ollama error: ${statusCode}`);
      }

      const data = await response.json() as {
        message?: { content?: string };
        model: string;
        prompt_eval_count?: number;
        eval_count?: number;
        done_reason?: string;
      };

      return {
        content: data.message?.content || '',
        model: data.model,
        usage: {
          inputTokens: data.prompt_eval_count || 0,
          outputTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
        finishReason: data.done_reason === 'stop' ? 'end_turn' : 'max_tokens',
        latency: Date.now() - startTime,
      };
    }, this.retryConfig);
  }

  async *stream(messages: Message[], options: CompletionOptions = {}): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model || this.defaultModel,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
        options: {
          temperature: options.temperature,
          top_p: options.topP,
          num_predict: options.maxTokens,
          stop: options.stopSequences,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            yield { content: data.message.content, done: false };
          }
          if (data.done) {
            yield { content: '', done: true };
            return;
          }
        } catch (e) {
          logger.debug({ err: e, line }, 'Failed to parse Ollama stream event');
        }
      }
    }

    yield { content: '', done: true };
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json() as { models?: Array<{ name: string }> };
      return data.models?.map(m => m.name) || [];
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// PROVIDER MANAGER
// =============================================================================

export class ProviderManager extends EventEmitter {
  private providers: Map<string, Provider> = new Map();
  private defaultProvider: string | null = null;
  private fallbackChain: string[] = [];
  private circuits: Map<string, {
    failures: number;
    successes: number;
    openUntil?: number;
  }> = new Map();

  private readonly circuitConfig = {
    failureThreshold: Number(process.env.CLODDS_PROVIDER_CB_FAILURE_THRESHOLD || 3),
    cooldownMs: Number(process.env.CLODDS_PROVIDER_CB_COOLDOWN_MS || 60_000),
    successResetThreshold: Number(process.env.CLODDS_PROVIDER_CB_SUCCESS_RESET || 2),
  };

  private getCircuit(provider: string) {
    let state = this.circuits.get(provider);
    if (!state) {
      state = { failures: 0, successes: 0 };
      this.circuits.set(provider, state);
    }
    return state;
  }

  private isCircuitOpen(provider: string): boolean {
    const state = this.getCircuit(provider);
    if (!state.openUntil) return false;
    if (Date.now() >= state.openUntil) {
      state.openUntil = undefined;
      state.failures = 0;
      state.successes = 0;
      logger.info({ provider }, 'Provider circuit cooldown expired');
      return false;
    }
    return true;
  }

  private reportSuccess(provider: string): void {
    const state = this.getCircuit(provider);
    state.successes += 1;
    state.failures = Math.max(0, state.failures - 1);
    if (state.openUntil && state.successes >= this.circuitConfig.successResetThreshold) {
      state.openUntil = undefined;
      state.failures = 0;
      state.successes = 0;
      logger.info({ provider }, 'Provider circuit closed after successes');
    }
  }

  private reportFailure(provider: string, error: unknown): void {
    const state = this.getCircuit(provider);
    state.failures += 1;
    state.successes = 0;

    if (state.failures >= this.circuitConfig.failureThreshold) {
      state.openUntil = Date.now() + this.circuitConfig.cooldownMs;
      logger.warn(
        {
          provider,
          failures: state.failures,
          openUntil: state.openUntil,
          error: error instanceof Error ? error.message : String(error),
        },
        'Provider circuit opened'
      );
    }
  }

  /** Register a provider */
  register(provider: Provider): this {
    this.providers.set(provider.name, provider);
    if (!this.defaultProvider) {
      this.defaultProvider = provider.name;
    }
    return this;
  }

  /** Set default provider */
  setDefault(name: string): this {
    if (!this.providers.has(name)) {
      throw new Error(`Provider '${name}' not found`);
    }
    this.defaultProvider = name;
    return this;
  }

  /** Set fallback chain */
  setFallbackChain(providers: string[]): this {
    this.fallbackChain = providers;
    return this;
  }

  /** Get a provider */
  get(name?: string): Provider {
    const providerName = name || this.defaultProvider;
    if (!providerName) {
      throw new Error('No provider specified and no default set');
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider '${providerName}' not found`);
    }

    return provider;
  }

  /** Complete with fallback */
  async complete(
    messages: Message[],
    options: CompletionOptions & { provider?: string } = {}
  ): Promise<CompletionResult> {
    const chain = options.provider ? [options.provider] : [
      this.defaultProvider!,
      ...this.fallbackChain.filter(p => p !== this.defaultProvider),
    ];

    let lastError: Error | null = null;

    for (const providerName of chain) {
      if (this.isCircuitOpen(providerName)) {
        logger.warn({ provider: providerName }, 'Provider circuit open, skipping');
        continue;
      }
      try {
        const provider = this.get(providerName);
        const result = await provider.complete(messages, options);
        this.reportSuccess(providerName);
        this.emit('completion', { provider: providerName, result });
        return result;
      } catch (error) {
        lastError = error as Error;
        this.reportFailure(providerName, error);
        logger.warn({ provider: providerName, error }, 'Provider failed, trying next');
        this.emit('fallback', { provider: providerName, error });
      }
    }

    throw lastError || new Error('All providers failed');
  }

  /** Stream with fallback */
  async *stream(
    messages: Message[],
    options: CompletionOptions & { provider?: string } = {}
  ): AsyncIterable<StreamChunk> {
    const chain = options.provider ? [options.provider] : [
      this.defaultProvider!,
      ...this.fallbackChain.filter(p => p !== this.defaultProvider),
    ];

    let lastError: Error | null = null;

    for (const providerName of chain) {
      if (this.isCircuitOpen(providerName)) {
        logger.warn({ provider: providerName }, 'Provider circuit open, skipping stream');
        continue;
      }
      try {
        const provider = this.get(providerName);
        for await (const chunk of provider.stream(messages, options)) {
          yield chunk;
        }
        this.reportSuccess(providerName);
        return;
      } catch (error) {
        lastError = error as Error;
        this.reportFailure(providerName, error);
        logger.warn({ provider: providerName, error }, 'Provider streaming failed, trying next');
      }
    }

    throw lastError || new Error('All providers failed');
  }

  /** List all providers */
  list(): string[] {
    return Array.from(this.providers.keys());
  }

  /** Check availability of all providers */
  async checkAvailability(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const [name, provider] of this.providers) {
      results[name] = await provider.isAvailable();
    }

    return results;
  }
}

// =============================================================================
// COST TRACKING
// =============================================================================

export interface CostConfig {
  inputCostPer1k: number;
  outputCostPer1k: number;
}

const MODEL_COSTS: Record<string, CostConfig> = {
  'claude-3-5-sonnet-20241022': { inputCostPer1k: 0.003, outputCostPer1k: 0.015 },
  'claude-3-opus-20240229': { inputCostPer1k: 0.015, outputCostPer1k: 0.075 },
  'claude-3-sonnet-20240229': { inputCostPer1k: 0.003, outputCostPer1k: 0.015 },
  'claude-3-haiku-20240307': { inputCostPer1k: 0.00025, outputCostPer1k: 0.00125 },
  'gpt-4o': { inputCostPer1k: 0.005, outputCostPer1k: 0.015 },
  'gpt-4-turbo': { inputCostPer1k: 0.01, outputCostPer1k: 0.03 },
  'gpt-3.5-turbo': { inputCostPer1k: 0.0005, outputCostPer1k: 0.0015 },
};

export function calculateCost(result: CompletionResult): number {
  const costs = MODEL_COSTS[result.model];
  if (!costs) return 0;

  return (
    (result.usage.inputTokens / 1000) * costs.inputCostPer1k +
    (result.usage.outputTokens / 1000) * costs.outputCostPer1k
  );
}

// =============================================================================
// FACTORY
// =============================================================================

/** Create a provider manager with common providers */
export function createProviders(options: {
  anthropicKey?: string;
  openaiKey?: string;
  ollamaUrl?: string;
  groqKey?: string;
  togetherKey?: string;
  fireworksKey?: string;
  geminiKey?: string;
} = {}): ProviderManager {
  const manager = new ProviderManager();

  if (options.anthropicKey) {
    manager.register(new AnthropicProvider({ apiKey: options.anthropicKey }));
  }

  if (options.openaiKey) {
    manager.register(new OpenAIProvider({ apiKey: options.openaiKey }));
  }

  if (options.ollamaUrl) {
    manager.register(new OllamaProvider(options.ollamaUrl));
  }

  if (options.groqKey) {
    manager.register(new GroqProvider(options.groqKey));
  }

  if (options.togetherKey) {
    manager.register(new TogetherProvider(options.togetherKey));
  }

  if (options.fireworksKey) {
    manager.register(new FireworksProvider(options.fireworksKey));
  }

  if (options.geminiKey) {
    manager.register(new GeminiProvider(options.geminiKey));
  }

  return manager;
}

// =============================================================================
// DEFAULT INSTANCE
// =============================================================================

export const providers = new ProviderManager();

// Auto-register from environment
if (process.env.ANTHROPIC_API_KEY) {
  providers.register(new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }));
}

if (process.env.OPENAI_API_KEY) {
  providers.register(new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }));
}

if (process.env.OLLAMA_URL) {
  providers.register(new OllamaProvider(process.env.OLLAMA_URL));
}

if (process.env.GROQ_API_KEY) {
  providers.register(new GroqProvider(process.env.GROQ_API_KEY));
}

if (process.env.TOGETHER_API_KEY) {
  providers.register(new TogetherProvider(process.env.TOGETHER_API_KEY));
}

if (process.env.FIREWORKS_API_KEY) {
  providers.register(new FireworksProvider(process.env.FIREWORKS_API_KEY));
}

if (process.env.GEMINI_API_KEY) {
  providers.register(new GeminiProvider(process.env.GEMINI_API_KEY));
}

export { createProviderHealthMonitor } from './health';
export type { ProviderHealthMonitor, ProviderHealthSnapshot, ProviderHealthStatus } from './health';
