/**
 * Provider Discovery & Enhanced Management
 *
 * Features:
 * - Model discovery (auto-detect available models)
 * - Auth profile management
 * - Usage tracking & analytics
 * - Additional providers (Bedrock, Groq, Together, etc.)
 * - Cache tracing & diagnostics
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';
import {
  Provider,
  ProviderConfig,
  Message,
  CompletionOptions,
  CompletionResult,
  StreamChunk,
} from './index';
import { withRetry, RETRY_POLICIES, TransientError } from '../infra/retry';

// =============================================================================
// MODEL DISCOVERY
// =============================================================================

export interface DiscoveredModel {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxOutput?: number;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
  capabilities?: string[];
}

export interface ModelRegistry {
  /** Discover models from a provider */
  discover(provider: Provider): Promise<DiscoveredModel[]>;
  /** Get all discovered models */
  getAll(): DiscoveredModel[];
  /** Get models by provider */
  getByProvider(providerName: string): DiscoveredModel[];
  /** Find model by ID */
  find(modelId: string): DiscoveredModel | undefined;
  /** Refresh all models */
  refresh(): Promise<void>;
}

/**
 * Create a model registry
 */
export function createModelRegistry(providers: Map<string, Provider>): ModelRegistry {
  const models: Map<string, DiscoveredModel> = new Map();

  return {
    async discover(provider) {
      const discovered: DiscoveredModel[] = [];

      try {
        const modelIds = await provider.listModels();

        for (const id of modelIds) {
          const model: DiscoveredModel = {
            id,
            name: id,
            provider: provider.name,
          };

          // Add known metadata
          const metadata = KNOWN_MODELS[id];
          if (metadata) {
            Object.assign(model, metadata);
          }

          discovered.push(model);
          models.set(`${provider.name}:${id}`, model);
        }

        logger.info({ provider: provider.name, count: discovered.length }, 'Discovered models');
      } catch (err) {
        logger.warn({ provider: provider.name, error: err }, 'Failed to discover models');
      }

      return discovered;
    },

    getAll() {
      return Array.from(models.values());
    },

    getByProvider(providerName) {
      return Array.from(models.values()).filter(m => m.provider === providerName);
    },

    find(modelId) {
      // Try direct lookup first
      for (const model of models.values()) {
        if (model.id === modelId) return model;
      }
      return undefined;
    },

    async refresh() {
      for (const provider of providers.values()) {
        await this.discover(provider);
      }
    },
  };
}

// Known model metadata
const KNOWN_MODELS: Record<string, Partial<DiscoveredModel>> = {
  'claude-3-5-sonnet-20241022': {
    name: 'Claude 3.5 Sonnet',
    contextWindow: 200000,
    maxOutput: 8192,
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.015,
    capabilities: ['vision', 'tools', 'streaming'],
  },
  'claude-3-opus-20240229': {
    name: 'Claude 3 Opus',
    contextWindow: 200000,
    maxOutput: 4096,
    inputCostPer1k: 0.015,
    outputCostPer1k: 0.075,
    capabilities: ['vision', 'tools', 'streaming'],
  },
  'claude-3-5-haiku-20241022': {
    name: 'Claude 3.5 Haiku',
    contextWindow: 200000,
    maxOutput: 8192,
    inputCostPer1k: 0.00025,
    outputCostPer1k: 0.00125,
    capabilities: ['vision', 'tools', 'streaming'],
  },
  'gpt-4o': {
    name: 'GPT-4o',
    contextWindow: 128000,
    maxOutput: 4096,
    inputCostPer1k: 0.005,
    outputCostPer1k: 0.015,
    capabilities: ['vision', 'tools', 'streaming'],
  },
  'gpt-4-turbo': {
    name: 'GPT-4 Turbo',
    contextWindow: 128000,
    maxOutput: 4096,
    inputCostPer1k: 0.01,
    outputCostPer1k: 0.03,
    capabilities: ['vision', 'tools', 'streaming'],
  },
};

// =============================================================================
// AUTH PROFILE MANAGEMENT
// =============================================================================

export interface AuthProfile {
  name: string;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  region?: string; // For Bedrock
  accessKeyId?: string; // For AWS
  secretAccessKey?: string; // For AWS
  metadata?: Record<string, string>;
}

export interface AuthProfileManager {
  /** Add or update a profile */
  set(profile: AuthProfile): void;
  /** Get a profile by name */
  get(name: string): AuthProfile | undefined;
  /** Get all profiles */
  list(): AuthProfile[];
  /** Get profiles by provider */
  listByProvider(provider: string): AuthProfile[];
  /** Delete a profile */
  delete(name: string): boolean;
  /** Save profiles to disk */
  save(): void;
  /** Load profiles from disk */
  load(): void;
}

const PROFILES_DIR = join(homedir(), '.clodds', 'auth');
const PROFILES_FILE = join(PROFILES_DIR, 'profiles.json');

/**
 * Create an auth profile manager
 */
export function createAuthProfileManager(): AuthProfileManager {
  const profiles: Map<string, AuthProfile> = new Map();

  const manager: AuthProfileManager = {
    set(profile) {
      profiles.set(profile.name, profile);
      this.save();
    },

    get(name) {
      return profiles.get(name);
    },

    list() {
      return Array.from(profiles.values());
    },

    listByProvider(provider) {
      return Array.from(profiles.values()).filter(p => p.provider === provider);
    },

    delete(name) {
      const existed = profiles.delete(name);
      if (existed) this.save();
      return existed;
    },

    save() {
      try {
        if (!existsSync(PROFILES_DIR)) {
          mkdirSync(PROFILES_DIR, { recursive: true });
        }
        // Don't save API keys in plain text in production
        // This is a simplified version
        const data = Array.from(profiles.values()).map(p => ({
          ...p,
          apiKey: '***', // Mask key
        }));
        writeFileSync(PROFILES_FILE, JSON.stringify(data, null, 2));
      } catch (err) {
        logger.error({ error: err }, 'Failed to save auth profiles');
      }
    },

    load() {
      try {
        if (existsSync(PROFILES_FILE)) {
          const data = JSON.parse(readFileSync(PROFILES_FILE, 'utf-8'));
          for (const profile of data) {
            profiles.set(profile.name, profile);
          }
          logger.info({ count: profiles.size }, 'Loaded auth profiles');
        }
      } catch (err) {
        logger.error({ error: err }, 'Failed to load auth profiles');
      }
    },
  };

  // Auto-load on creation
  manager.load();

  return manager;
}

// =============================================================================
// USAGE TRACKING
// =============================================================================

export interface UsageRecord {
  timestamp: Date;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  latency: number;
  sessionId?: string;
  userId?: string;
}

export interface UsageStats {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  avgLatency: number;
  byProvider: Record<string, {
    requests: number;
    tokens: number;
    cost: number;
  }>;
  byModel: Record<string, {
    requests: number;
    tokens: number;
    cost: number;
  }>;
}

export interface UsageTracker {
  /** Record a completion */
  record(result: CompletionResult, provider: string, sessionId?: string, userId?: string): void;
  /** Get usage stats for time period */
  getStats(since?: Date): UsageStats;
  /** Get usage by session */
  getBySession(sessionId: string): UsageRecord[];
  /** Get usage by user */
  getByUser(userId: string): UsageRecord[];
  /** Get recent records */
  getRecent(limit?: number): UsageRecord[];
  /** Export usage data */
  export(): UsageRecord[];
  /** Clear old records */
  cleanup(olderThan: Date): number;
}

/**
 * Create a usage tracker
 */
export function createUsageTracker(): UsageTracker {
  const records: UsageRecord[] = [];
  const MAX_RECORDS = 10000;

  return {
    record(result, provider, sessionId, userId) {
      const record: UsageRecord = {
        timestamp: new Date(),
        provider,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cost: calculateCost(result.model, result.usage.inputTokens, result.usage.outputTokens),
        latency: result.latency,
        sessionId,
        userId,
      };

      records.push(record);

      // Keep bounded
      if (records.length > MAX_RECORDS) {
        records.shift();
      }

      logger.debug({
        provider,
        model: result.model,
        tokens: result.usage.totalTokens,
        cost: record.cost,
      }, 'Recorded usage');
    },

    getStats(since) {
      const filtered = since
        ? records.filter(r => r.timestamp >= since)
        : records;

      const stats: UsageStats = {
        totalRequests: filtered.length,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        avgLatency: 0,
        byProvider: {},
        byModel: {},
      };

      let totalLatency = 0;

      for (const r of filtered) {
        stats.totalInputTokens += r.inputTokens;
        stats.totalOutputTokens += r.outputTokens;
        stats.totalCost += r.cost;
        totalLatency += r.latency;

        // By provider
        if (!stats.byProvider[r.provider]) {
          stats.byProvider[r.provider] = { requests: 0, tokens: 0, cost: 0 };
        }
        stats.byProvider[r.provider].requests++;
        stats.byProvider[r.provider].tokens += r.inputTokens + r.outputTokens;
        stats.byProvider[r.provider].cost += r.cost;

        // By model
        if (!stats.byModel[r.model]) {
          stats.byModel[r.model] = { requests: 0, tokens: 0, cost: 0 };
        }
        stats.byModel[r.model].requests++;
        stats.byModel[r.model].tokens += r.inputTokens + r.outputTokens;
        stats.byModel[r.model].cost += r.cost;
      }

      stats.avgLatency = filtered.length > 0 ? totalLatency / filtered.length : 0;

      return stats;
    },

    getBySession(sessionId) {
      return records.filter(r => r.sessionId === sessionId);
    },

    getByUser(userId) {
      return records.filter(r => r.userId === userId);
    },

    getRecent(limit = 100) {
      return records.slice(-limit);
    },

    export() {
      return [...records];
    },

    cleanup(olderThan) {
      const before = records.length;
      const newRecords = records.filter(r => r.timestamp >= olderThan);
      records.length = 0;
      records.push(...newRecords);
      return before - records.length;
    },
  };
}

// Helper to calculate cost
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const metadata = KNOWN_MODELS[model];
  if (!metadata) return 0;

  const inputCost = (inputTokens / 1000) * (metadata.inputCostPer1k ?? 0);
  const outputCost = (outputTokens / 1000) * (metadata.outputCostPer1k ?? 0);
  return inputCost + outputCost;
}

// =============================================================================
// ADDITIONAL PROVIDERS
// =============================================================================

/**
 * Groq Provider (fast inference)
 */
export class GroqProvider implements Provider {
  name = 'groq';
  private apiKey: string;
  private baseUrl = 'https://api.groq.com/openai/v1';
  private defaultModel = 'llama-3.1-70b-versatile';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async complete(messages: Message[], options: CompletionOptions = {}): Promise<CompletionResult> {
    const startTime = Date.now();

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || this.defaultModel,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        top_p: options.topP,
        stop: options.stopSequences,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq error: ${response.status}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    return {
      content: data.choices[0]?.message?.content ?? '',
      model: data.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      finishReason: data.choices[0]?.finish_reason === 'stop' ? 'end_turn' : 'max_tokens',
      latency: Date.now() - startTime,
    };
  }

  async *stream(messages: Message[], options: CompletionOptions = {}): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || this.defaultModel,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq error: ${response.status}`);
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
      buffer = lines.pop() ?? '';

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
          } catch (err) {
            logger.debug({ error: err }, 'Failed to parse Groq SSE chunk');
          }
        }
      }
    }

    yield { content: '', done: true };
  }

  async listModels(): Promise<string[]> {
    return ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Together AI Provider
 */
export class TogetherProvider implements Provider {
  name = 'together';
  private apiKey: string;
  private baseUrl = 'https://api.together.xyz/v1';
  private defaultModel = 'meta-llama/Llama-3-70b-chat-hf';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async complete(messages: Message[], options: CompletionOptions = {}): Promise<CompletionResult> {
    const startTime = Date.now();

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || this.defaultModel,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        top_p: options.topP,
        stop: options.stopSequences,
      }),
    });

    if (!response.ok) {
      throw new Error(`Together error: ${response.status}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    return {
      content: data.choices[0]?.message?.content ?? '',
      model: data.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      finishReason: data.choices[0]?.finish_reason === 'stop' ? 'end_turn' : 'max_tokens',
      latency: Date.now() - startTime,
    };
  }

  async *stream(messages: Message[], options: CompletionOptions = {}): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || this.defaultModel,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Together error: ${response.status}`);
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
      buffer = lines.pop() ?? '';

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
          } catch (err) {
            logger.debug({ error: err }, 'Failed to parse Together SSE chunk');
          }
        }
      }
    }

    yield { content: '', done: true };
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });
    if (!response.ok) return [];
    const data = await response.json() as { data: Array<{ id: string }> };
    return data.data?.map((m: { id: string }) => m.id) || [];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Fireworks AI Provider
 */
export class FireworksProvider implements Provider {
  name = 'fireworks';
  private apiKey: string;
  private baseUrl = 'https://api.fireworks.ai/inference/v1';
  private defaultModel = 'accounts/fireworks/models/llama-v3p1-70b-instruct';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async complete(messages: Message[], options: CompletionOptions = {}): Promise<CompletionResult> {
    const startTime = Date.now();

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || this.defaultModel,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        top_p: options.topP,
        stop: options.stopSequences,
      }),
    });

    if (!response.ok) {
      throw new Error(`Fireworks error: ${response.status}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    return {
      content: data.choices[0]?.message?.content ?? '',
      model: data.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      finishReason: data.choices[0]?.finish_reason === 'stop' ? 'end_turn' : 'max_tokens',
      latency: Date.now() - startTime,
    };
  }

  async *stream(messages: Message[], options: CompletionOptions = {}): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || this.defaultModel,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        top_p: options.topP,
        stop: options.stopSequences,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Fireworks streaming error: ${response.status}`);
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
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
        if (data === '[DONE]') {
          yield { content: '', done: true };
          return;
        }

        try {
          const event = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const content = event.choices?.[0]?.delta?.content;
          if (content) {
            yield { content, done: false };
          }
        } catch (err) {
          logger.debug({ error: err }, 'Failed to parse Fireworks SSE chunk');
        }
      }
    }

    yield { content: '', done: true };
  }

  async listModels(): Promise<string[]> {
    return [
      'accounts/fireworks/models/llama-v3p1-70b-instruct',
      'accounts/fireworks/models/llama-v3p1-8b-instruct',
      'accounts/fireworks/models/mixtral-8x7b-instruct',
    ];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// CACHE & DIAGNOSTICS
// =============================================================================

export interface CacheEntry {
  key: string;
  result: CompletionResult;
  timestamp: Date;
  hits: number;
}

export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  savedTokens: number;
  savedCost: number;
}

export interface ResponseCache {
  /** Get cached result */
  get(key: string): CompletionResult | undefined;
  /** Set cached result */
  set(key: string, result: CompletionResult): void;
  /** Generate cache key */
  generateKey(messages: Message[], options: CompletionOptions): string;
  /** Get cache stats */
  getStats(): CacheStats;
  /** Clear cache */
  clear(): void;
}

/**
 * Create a response cache
 */
export function createResponseCache(maxSize = 1000, ttlMs = 3600000): ResponseCache {
  const cache: Map<string, CacheEntry> = new Map();
  let hits = 0;
  let misses = 0;
  let savedTokens = 0;
  let savedCost = 0;

  function cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [key, entry] of cache) {
      if (now - entry.timestamp.getTime() > ttlMs) {
        expired.push(key);
      }
    }

    for (const key of expired) {
      cache.delete(key);
    }

    // Evict oldest if over size
    while (cache.size > maxSize) {
      const oldest = Array.from(cache.entries())
        .sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime())[0];
      if (oldest) {
        cache.delete(oldest[0]);
      }
    }
  }

  return {
    get(key) {
      const entry = cache.get(key);
      if (entry) {
        entry.hits++;
        hits++;
        savedTokens += entry.result.usage.totalTokens;
        savedCost += calculateCost(
          entry.result.model,
          entry.result.usage.inputTokens,
          entry.result.usage.outputTokens
        );
        return entry.result;
      }
      misses++;
      return undefined;
    },

    set(key, result) {
      cleanup();
      cache.set(key, {
        key,
        result,
        timestamp: new Date(),
        hits: 0,
      });
    },

    generateKey(messages, options) {
      // Simple hash of messages + options
      const data = JSON.stringify({ messages, options });
      let hash = 0;
      for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return `cache_${hash.toString(36)}`;
    },

    getStats() {
      const total = hits + misses;
      return {
        totalEntries: cache.size,
        totalHits: hits,
        totalMisses: misses,
        hitRate: total > 0 ? hits / total : 0,
        savedTokens,
        savedCost,
      };
    },

    clear() {
      cache.clear();
      hits = 0;
      misses = 0;
      savedTokens = 0;
      savedCost = 0;
    },
  };
}

export interface DiagnosticInfo {
  provider: string;
  available: boolean;
  latency?: number;
  lastError?: string;
  models?: string[];
}

/**
 * Run diagnostics on providers
 */
export async function runDiagnostics(
  providers: Map<string, Provider>
): Promise<DiagnosticInfo[]> {
  const results: DiagnosticInfo[] = [];

  for (const [name, provider] of providers) {
    const info: DiagnosticInfo = {
      provider: name,
      available: false,
    };

    const startTime = Date.now();

    try {
      info.available = await provider.isAvailable();
      info.latency = Date.now() - startTime;

      if (info.available) {
        try {
          info.models = await provider.listModels();
        } catch (err) {
          logger.debug({ provider: name, error: err }, 'Failed to list models during diagnostics');
        }
      }
    } catch (err) {
      info.lastError = String(err);
    }

    results.push(info);
  }

  return results;
}

// =============================================================================
// EXPORTS
// =============================================================================

export const discovery = {
  createModelRegistry,
  createAuthProfileManager,
  createUsageTracker,
  createResponseCache,
  runDiagnostics,
  GroqProvider,
  TogetherProvider,
  FireworksProvider,
};
