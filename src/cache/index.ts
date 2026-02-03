/**
 * LRU Cache with TTL Support
 *
 * High-performance caching for Clodds hot paths:
 * - Market lookups
 * - API key validation
 * - Price subscriptions
 *
 * Features:
 * - LRU eviction policy
 * - Per-entry TTL
 * - Memory-efficient storage
 * - Cache statistics
 */

import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface CacheOptions<K = string, V = unknown> {
  /** Maximum number of entries (default: 1000) */
  maxSize?: number;
  /** Default TTL in ms (default: 60000 = 1 minute) */
  defaultTtl?: number;
  /** Name for logging (default: 'cache') */
  name?: string;
  /** Custom key serializer for complex keys */
  keySerializer?: (key: K) => string;
  /** On eviction callback */
  onEvict?: (key: K, value: V, reason: EvictionReason) => void;
  /** Enable stats collection (default: true) */
  collectStats?: boolean;
}

export interface CacheEntry<V> {
  value: V;
  expiresAt: number;
  createdAt: number;
  accessCount: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
  hitRate: number;
}

export type EvictionReason = 'expired' | 'capacity' | 'manual';

export interface LRUCache<K = string, V = unknown> {
  /** Get value from cache */
  get(key: K): V | undefined;
  /** Get value or compute if missing */
  getOrSet(key: K, compute: () => V | Promise<V>, ttl?: number): Promise<V>;
  /** Set value in cache */
  set(key: K, value: V, ttl?: number): void;
  /** Check if key exists and is not expired */
  has(key: K): boolean;
  /** Delete key from cache */
  delete(key: K): boolean;
  /** Clear all entries */
  clear(): void;
  /** Get cache statistics */
  stats(): CacheStats;
  /** Reset statistics */
  resetStats(): void;
  /** Get all keys */
  keys(): K[];
  /** Get size */
  size(): number;
  /** Prune expired entries */
  prune(): number;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createCache<K = string, V = unknown>(
  options: CacheOptions<K, V> = {}
): LRUCache<K, V> {
  const maxSize = options.maxSize ?? 1000;
  const defaultTtl = options.defaultTtl ?? 60000;
  const name = options.name ?? 'cache';
  const collectStats = options.collectStats !== false;
  const keySerializer = options.keySerializer ?? ((k: K) => String(k));
  const onEvict = options.onEvict;

  // Storage: Map maintains insertion order for LRU
  const cache = new Map<string, CacheEntry<V>>();
  // Original keys for retrieval
  const keyMap = new Map<string, K>();

  // Statistics
  let stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  function getSerializedKey(key: K): string {
    return keySerializer(key);
  }

  function isExpired(entry: CacheEntry<V>): boolean {
    return entry.expiresAt > 0 && Date.now() > entry.expiresAt;
  }

  function evict(serializedKey: string, reason: EvictionReason): void {
    const entry = cache.get(serializedKey);
    const originalKey = keyMap.get(serializedKey);

    if (entry && originalKey !== undefined) {
      cache.delete(serializedKey);
      keyMap.delete(serializedKey);
      stats.evictions++;

      if (onEvict) {
        try {
          onEvict(originalKey, entry.value, reason);
        } catch (e) {
          logger.warn({ name, key: serializedKey, error: e }, 'Cache eviction callback error');
        }
      }
    }
  }

  function ensureCapacity(): void {
    while (cache.size >= maxSize) {
      // LRU: Remove oldest entry (first in Map)
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        evict(oldestKey, 'capacity');
      } else {
        break;
      }
    }
  }

  function moveToEnd(serializedKey: string, entry: CacheEntry<V>): void {
    // Move entry to end (most recently used) by re-inserting
    cache.delete(serializedKey);
    cache.set(serializedKey, entry);
  }

  function get(key: K): V | undefined {
    const serializedKey = getSerializedKey(key);
    const entry = cache.get(serializedKey);

    if (!entry) {
      if (collectStats) stats.misses++;
      return undefined;
    }

    if (isExpired(entry)) {
      evict(serializedKey, 'expired');
      if (collectStats) stats.misses++;
      return undefined;
    }

    // Update access count and move to end (most recently used)
    entry.accessCount++;
    moveToEnd(serializedKey, entry);

    if (collectStats) stats.hits++;
    return entry.value;
  }

  async function getOrSet(
    key: K,
    compute: () => V | Promise<V>,
    ttl?: number
  ): Promise<V> {
    const existing = get(key);
    if (existing !== undefined) {
      return existing;
    }

    const value = await compute();
    set(key, value, ttl);
    return value;
  }

  function set(key: K, value: V, ttl?: number): void {
    const serializedKey = getSerializedKey(key);
    const effectiveTtl = ttl ?? defaultTtl;

    // Check if key already exists
    const existing = cache.get(serializedKey);
    if (existing) {
      // Update existing entry
      existing.value = value;
      existing.expiresAt = effectiveTtl > 0 ? Date.now() + effectiveTtl : 0;
      existing.accessCount++;
      moveToEnd(serializedKey, existing);
      return;
    }

    // Ensure we have capacity
    ensureCapacity();

    // Create new entry
    const entry: CacheEntry<V> = {
      value,
      expiresAt: effectiveTtl > 0 ? Date.now() + effectiveTtl : 0,
      createdAt: Date.now(),
      accessCount: 1,
    };

    cache.set(serializedKey, entry);
    keyMap.set(serializedKey, key);
  }

  function has(key: K): boolean {
    const serializedKey = getSerializedKey(key);
    const entry = cache.get(serializedKey);

    if (!entry) return false;

    if (isExpired(entry)) {
      evict(serializedKey, 'expired');
      return false;
    }

    return true;
  }

  function deleteKey(key: K): boolean {
    const serializedKey = getSerializedKey(key);
    if (cache.has(serializedKey)) {
      evict(serializedKey, 'manual');
      return true;
    }
    return false;
  }

  function clear(): void {
    cache.clear();
    keyMap.clear();
  }

  function getStats(): CacheStats {
    const total = stats.hits + stats.misses;
    return {
      hits: stats.hits,
      misses: stats.misses,
      evictions: stats.evictions,
      size: cache.size,
      maxSize,
      hitRate: total > 0 ? stats.hits / total : 0,
    };
  }

  function resetStats(): void {
    stats = { hits: 0, misses: 0, evictions: 0 };
  }

  function keys(): K[] {
    const result: K[] = [];
    for (const [serializedKey, entry] of cache) {
      if (!isExpired(entry)) {
        const originalKey = keyMap.get(serializedKey);
        if (originalKey !== undefined) {
          result.push(originalKey);
        }
      }
    }
    return result;
  }

  function size(): number {
    return cache.size;
  }

  function prune(): number {
    let pruned = 0;
    const now = Date.now();

    for (const [serializedKey, entry] of cache) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) {
        evict(serializedKey, 'expired');
        pruned++;
      }
    }

    return pruned;
  }

  // Periodic cleanup (every 5 minutes)
  const cleanupInterval = setInterval(() => {
    const pruned = prune();
    if (pruned > 0) {
      logger.debug({ name, pruned, remaining: cache.size }, 'Cache pruned expired entries');
    }
  }, 5 * 60 * 1000);

  // Prevent interval from keeping process alive
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return {
    get,
    getOrSet,
    set,
    has,
    delete: deleteKey,
    clear,
    stats: getStats,
    resetStats,
    keys,
    size,
    prune,
  };
}

// =============================================================================
// SPECIALIZED CACHES
// =============================================================================

/**
 * Market cache - for caching market data lookups
 */
export interface MarketCacheKey {
  platform?: string;
  marketId: string;
}

export function createMarketCache<V = unknown>(
  options: Omit<CacheOptions<MarketCacheKey, V>, 'keySerializer'> = {}
): LRUCache<MarketCacheKey, V> {
  return createCache<MarketCacheKey, V>({
    name: 'market-cache',
    maxSize: 500,
    defaultTtl: 30000, // 30 seconds - markets change frequently
    ...options,
    keySerializer: (key) => `${key.platform || '*'}:${key.marketId}`,
  });
}

/**
 * API key validation cache - brief caching for validated keys
 */
export interface ApiKeyCacheKey {
  keyId: string;
  secretHash: string;
}

export function createApiKeyCache<V = unknown>(
  options: Omit<CacheOptions<ApiKeyCacheKey, V>, 'keySerializer'> = {}
): LRUCache<ApiKeyCacheKey, V> {
  return createCache<ApiKeyCacheKey, V>({
    name: 'apikey-cache',
    maxSize: 200,
    defaultTtl: 10000, // 10 seconds - brief caching for validation
    ...options,
    keySerializer: (key) => `${key.keyId}:${key.secretHash.slice(0, 8)}`,
  });
}

/**
 * Subscription deduplication cache - track active subscriptions
 */
export interface SubscriptionKey {
  platform: string;
  marketId: string;
  callbackId: string;
}

export function createSubscriptionCache<V = number>(
  options: Omit<CacheOptions<SubscriptionKey, V>, 'keySerializer'> = {}
): LRUCache<SubscriptionKey, V> {
  return createCache<SubscriptionKey, V>({
    name: 'subscription-cache',
    maxSize: 1000,
    defaultTtl: 0, // No expiry - managed manually
    ...options,
    keySerializer: (key) => `${key.platform}:${key.marketId}:${key.callbackId}`,
  });
}

// =============================================================================
// BATCH OPERATIONS
// =============================================================================

/**
 * Batch get multiple keys at once
 */
export function batchGet<K, V>(
  cache: LRUCache<K, V>,
  keys: K[]
): Map<K, V | undefined> {
  const results = new Map<K, V | undefined>();
  for (const key of keys) {
    results.set(key, cache.get(key));
  }
  return results;
}

/**
 * Batch set multiple key-value pairs
 */
export function batchSet<K, V>(
  cache: LRUCache<K, V>,
  entries: Array<[K, V, number?]>
): void {
  for (const [key, value, ttl] of entries) {
    cache.set(key, value, ttl);
  }
}

/**
 * Get multiple values, computing missing ones in batch
 */
export async function batchGetOrCompute<K, V>(
  cache: LRUCache<K, V>,
  keys: K[],
  computeBatch: (missingKeys: K[]) => Promise<Map<K, V>>,
  ttl?: number
): Promise<Map<K, V>> {
  const results = new Map<K, V>();
  const missingKeys: K[] = [];

  // Check cache for all keys
  for (const key of keys) {
    const value = cache.get(key);
    if (value !== undefined) {
      results.set(key, value);
    } else {
      missingKeys.push(key);
    }
  }

  // Compute missing values in batch
  if (missingKeys.length > 0) {
    const computed = await computeBatch(missingKeys);
    for (const [key, value] of computed) {
      results.set(key, value);
      cache.set(key, value, ttl);
    }
  }

  return results;
}

// =============================================================================
// EXPORTS
// =============================================================================

// Types are already exported at definition, no need to re-export
