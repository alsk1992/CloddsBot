/**
 * LLM Service - Multi-model inference for agents
 *
 * Supports Claude, GPT, Llama, Mixtral
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../utils/logger';
import type {
  ComputeRequest,
  LLMRequest,
  LLMResponse,
  LLMModel,
  LLMMessage,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface LLMService {
  /** Execute LLM inference */
  execute(request: ComputeRequest): Promise<LLMResponse>;
  /** Execute LLM inference with streaming */
  executeStream(request: ComputeRequest): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown>;
  /** Get available models */
  getModels(): LLMModel[];
  /** Check model availability */
  isAvailable(model: LLMModel): boolean;
}

export interface LLMStreamChunk {
  /** Chunk type */
  type: 'text' | 'tool_use' | 'done' | 'error';
  /** Text content (for text chunks) */
  text?: string;
  /** Tool call (for tool_use chunks) */
  toolCall?: { name: string; arguments: Record<string, unknown> };
  /** Error message (for error chunks) */
  error?: string;
  /** Cumulative usage (updated on 'done') */
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMServiceConfig {
  /** Anthropic API key */
  anthropicKey?: string;
  /** OpenAI API key */
  openaiKey?: string;
  /** Together API key (for Llama/Mixtral) */
  togetherKey?: string;
  /** Default model */
  defaultModel?: LLMModel;
  /** Default max tokens */
  defaultMaxTokens?: number;
  /** Default temperature */
  defaultTemperature?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MODEL_PROVIDERS: Record<LLMModel, 'anthropic' | 'openai' | 'together'> = {
  'claude-sonnet-4-20250514': 'anthropic',
  'claude-3-5-haiku-latest': 'anthropic',
  'claude-opus-4-20250514': 'anthropic',
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',
  'llama-3.1-70b': 'together',
  'llama-3.1-8b': 'together',
  'mixtral-8x7b': 'together',
};

const TOGETHER_MODEL_IDS: Partial<Record<LLMModel, string>> = {
  'llama-3.1-70b': 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
  'llama-3.1-8b': 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
  'mixtral-8x7b': 'mistralai/Mixtral-8x7B-Instruct-v0.1',
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createLLMService(config: LLMServiceConfig = {}): LLMService {
  const anthropicKey = config.anthropicKey || getEnv('ANTHROPIC_API_KEY');
  const openaiKey = config.openaiKey || getEnv('OPENAI_API_KEY');
  const togetherKey = config.togetherKey || getEnv('TOGETHER_API_KEY');

  const defaultModel = config.defaultModel || 'claude-sonnet-4-20250514';
  const defaultMaxTokens = config.defaultMaxTokens || 4096;
  const defaultTemperature = config.defaultTemperature || 0.7;

  // Initialize clients
  const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

  function getEnv(key: string): string | undefined {
    if (typeof globalThis !== 'undefined' && 'process' in globalThis) {
      return (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[key];
    }
    return undefined;
  }

  function getModels(): LLMModel[] {
    const available: LLMModel[] = [];

    if (anthropicKey) {
      available.push('claude-sonnet-4-20250514', 'claude-3-5-haiku-latest', 'claude-opus-4-20250514');
    }
    if (openaiKey) {
      available.push('gpt-4o', 'gpt-4o-mini');
    }
    if (togetherKey) {
      available.push('llama-3.1-70b', 'llama-3.1-8b', 'mixtral-8x7b');
    }

    return available;
  }

  function isAvailable(model: LLMModel): boolean {
    const provider = MODEL_PROVIDERS[model];
    if (!provider) return false;

    switch (provider) {
      case 'anthropic': return !!anthropicKey;
      case 'openai': return !!openaiKey;
      case 'together': return !!togetherKey;
      default: return false;
    }
  }

  async function execute(request: ComputeRequest): Promise<LLMResponse> {
    const payload = request.payload as LLMRequest;
    const model = payload.model || defaultModel;
    const maxTokens = payload.maxTokens || defaultMaxTokens;
    const temperature = payload.temperature || defaultTemperature;

    if (!isAvailable(model)) {
      throw new Error(`Model ${model} is not available. Configure the appropriate API key.`);
    }

    const provider = MODEL_PROVIDERS[model];

    logger.info({
      requestId: request.id,
      model,
      provider,
      messageCount: payload.messages.length,
    }, 'Executing LLM request');

    switch (provider) {
      case 'anthropic':
        return executeAnthropic(payload, model, maxTokens, temperature);
      case 'openai':
        return executeOpenAI(payload, model, maxTokens, temperature);
      case 'together':
        return executeTogether(payload, model, maxTokens, temperature);
      default:
        throw new Error(`Unknown provider for model: ${model}`);
    }
  }

  async function executeAnthropic(
    payload: LLMRequest,
    model: LLMModel,
    maxTokens: number,
    temperature: number
  ): Promise<LLMResponse> {
    if (!anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    // Convert messages format
    const messages = payload.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Extract system prompt
    const systemMessage = payload.messages.find(m => m.role === 'system');
    const system = payload.system || systemMessage?.content;

    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages,
    });

    const textContent = response.content.find(c => c.type === 'text');
    const content = textContent?.type === 'text' ? textContent.text : '';

    // Extract tool calls if any
    const toolCalls = response.content
      .filter(c => c.type === 'tool_use')
      .map(c => {
        if (c.type === 'tool_use') {
          return {
            name: c.name,
            arguments: c.input as Record<string, unknown>,
          };
        }
        return null;
      })
      .filter((c): c is { name: string; arguments: Record<string, unknown> } => c !== null);

    return {
      content,
      model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason || 'unknown',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async function executeOpenAI(
    payload: LLMRequest,
    model: LLMModel,
    maxTokens: number,
    temperature: number
  ): Promise<LLMResponse> {
    if (!openaiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Convert messages
    const messages = payload.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Add system prompt if not in messages
    if (payload.system && !messages.some(m => m.role === 'system')) {
      messages.unshift({ role: 'system', content: payload.system });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: { content: string; tool_calls?: Array<{ function: { name: string; arguments: string } }> };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices[0];
    const toolCalls = choice.message.tool_calls?.map(tc => ({
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: choice.message.content || '',
      model,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      },
      stopReason: choice.finish_reason,
      toolCalls,
    };
  }

  async function executeTogether(
    payload: LLMRequest,
    model: LLMModel,
    maxTokens: number,
    temperature: number
  ): Promise<LLMResponse> {
    if (!togetherKey) {
      throw new Error('Together API key not configured');
    }

    const togetherModel = TOGETHER_MODEL_IDS[model];
    if (!togetherModel) {
      throw new Error(`Unknown Together model: ${model}`);
    }

    // Convert messages
    const messages = payload.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Add system prompt
    if (payload.system && !messages.some(m => m.role === 'system')) {
      messages.unshift({ role: 'system', content: payload.system });
    }

    const response = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${togetherKey}`,
      },
      body: JSON.stringify({
        model: togetherModel,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Together API error: ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices[0];

    return {
      content: choice.message.content || '',
      model,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      },
      stopReason: choice.finish_reason,
    };
  }

  async function* executeStream(request: ComputeRequest): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown> {
    const payload = request.payload as LLMRequest;
    const model = payload.model || defaultModel;
    const maxTokens = payload.maxTokens || defaultMaxTokens;
    const temperature = payload.temperature || defaultTemperature;

    if (!isAvailable(model)) {
      yield { type: 'error', error: `Model ${model} is not available` };
      return {
        content: '',
        model,
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: 'error',
      };
    }

    const provider = MODEL_PROVIDERS[model];

    logger.info({
      requestId: request.id,
      model,
      provider,
      streaming: true,
    }, 'Executing streaming LLM request');

    switch (provider) {
      case 'anthropic':
        return yield* streamAnthropic(payload, model, maxTokens, temperature);
      case 'openai':
        return yield* streamOpenAI(payload, model, maxTokens, temperature);
      case 'together':
        return yield* streamTogether(payload, model, maxTokens, temperature);
      default:
        yield { type: 'error', error: `Unknown provider for model: ${model}` };
        return {
          content: '',
          model,
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: 'error',
        };
    }
  }

  async function* streamAnthropic(
    payload: LLMRequest,
    model: LLMModel,
    maxTokens: number,
    temperature: number
  ): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown> {
    if (!anthropic) {
      yield { type: 'error', error: 'Anthropic client not initialized' };
      return { content: '', model, usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'error' };
    }

    const messages = payload.messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const systemMessage = payload.messages.find(m => m.role === 'system');
    const system = payload.system || systemMessage?.content;

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = 'unknown';

    const stream = anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          fullContent += event.delta.text;
          yield { type: 'text', text: event.delta.text };
        }
      } else if (event.type === 'message_delta') {
        stopReason = event.delta.stop_reason || stopReason;
        if (event.usage) {
          outputTokens = event.usage.output_tokens;
        }
      } else if (event.type === 'message_start') {
        if (event.message.usage) {
          inputTokens = event.message.usage.input_tokens;
        }
      }
    }

    yield { type: 'done', usage: { inputTokens, outputTokens } };

    return {
      content: fullContent,
      model,
      usage: { inputTokens, outputTokens },
      stopReason,
    };
  }

  async function* streamOpenAI(
    payload: LLMRequest,
    model: LLMModel,
    maxTokens: number,
    temperature: number
  ): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown> {
    if (!openaiKey) {
      yield { type: 'error', error: 'OpenAI API key not configured' };
      return { content: '', model, usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'error' };
    }

    const messages = payload.messages.map(m => ({ role: m.role, content: m.content }));
    if (payload.system && !messages.some(m => m.role === 'system')) {
      messages.unshift({ role: 'system', content: payload.system });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!response.ok || !response.body) {
      const error = await response.text();
      yield { type: 'error', error: `OpenAI API error: ${error}` };
      return { content: '', model, usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'error' };
    }

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = 'unknown';

    const reader = response.body.getReader();
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
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
              usage?: { prompt_tokens: number; completion_tokens: number };
            };

            if (parsed.choices?.[0]?.delta?.content) {
              const text = parsed.choices[0].delta.content;
              fullContent += text;
              yield { type: 'text', text };
            }
            if (parsed.choices?.[0]?.finish_reason) {
              stopReason = parsed.choices[0].finish_reason;
            }
            if (parsed.usage) {
              inputTokens = parsed.usage.prompt_tokens;
              outputTokens = parsed.usage.completion_tokens;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    yield { type: 'done', usage: { inputTokens, outputTokens } };

    return {
      content: fullContent,
      model,
      usage: { inputTokens, outputTokens },
      stopReason,
    };
  }

  async function* streamTogether(
    payload: LLMRequest,
    model: LLMModel,
    maxTokens: number,
    temperature: number
  ): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown> {
    if (!togetherKey) {
      yield { type: 'error', error: 'Together API key not configured' };
      return { content: '', model, usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'error' };
    }

    const togetherModel = TOGETHER_MODEL_IDS[model];
    if (!togetherModel) {
      yield { type: 'error', error: `Unknown Together model: ${model}` };
      return { content: '', model, usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'error' };
    }

    const messages = payload.messages.map(m => ({ role: m.role, content: m.content }));
    if (payload.system && !messages.some(m => m.role === 'system')) {
      messages.unshift({ role: 'system', content: payload.system });
    }

    const response = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${togetherKey}`,
      },
      body: JSON.stringify({
        model: togetherModel,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      const error = await response.text();
      yield { type: 'error', error: `Together API error: ${error}` };
      return { content: '', model, usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'error' };
    }

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = 'unknown';

    const reader = response.body.getReader();
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
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
              usage?: { prompt_tokens: number; completion_tokens: number };
            };

            if (parsed.choices?.[0]?.delta?.content) {
              const text = parsed.choices[0].delta.content;
              fullContent += text;
              yield { type: 'text', text };
            }
            if (parsed.choices?.[0]?.finish_reason) {
              stopReason = parsed.choices[0].finish_reason;
            }
            if (parsed.usage) {
              inputTokens = parsed.usage.prompt_tokens;
              outputTokens = parsed.usage.completion_tokens;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    // Estimate tokens if not provided (Together doesn't always include usage in stream)
    if (inputTokens === 0) {
      const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
      inputTokens = Math.ceil(inputChars / 4);
    }
    if (outputTokens === 0) {
      outputTokens = Math.ceil(fullContent.length / 4);
    }

    yield { type: 'done', usage: { inputTokens, outputTokens } };

    return {
      content: fullContent,
      model,
      usage: { inputTokens, outputTokens },
      stopReason,
    };
  }

  return {
    execute,
    executeStream,
    getModels,
    isAvailable,
  };
}
