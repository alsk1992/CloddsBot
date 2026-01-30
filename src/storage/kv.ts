/**
 * KV Storage Adapter for caching
 */

import type { Env } from '../config';

export interface CacheOptions {
  ttlSeconds?: number;
}

export async function cacheGet<T>(
  kv: KVNamespace,
  key: string
): Promise<T | null> {
  const value = await kv.get(key);
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(
  kv: KVNamespace,
  key: string,
  value: T,
  options?: CacheOptions
): Promise<void> {
  const serialized = JSON.stringify(value);

  if (options?.ttlSeconds) {
    await kv.put(key, serialized, { expirationTtl: options.ttlSeconds });
  } else {
    await kv.put(key, serialized);
  }
}

export async function cacheDelete(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key);
}

export async function cacheGetOrSet<T>(
  kv: KVNamespace,
  key: string,
  fetcher: () => Promise<T>,
  options?: CacheOptions
): Promise<T> {
  const cached = await cacheGet<T>(kv, key);
  if (cached !== null) {
    return cached;
  }

  const value = await fetcher();
  await cacheSet(kv, key, value, options);
  return value;
}

// Prefixed cache helpers for different data types
export const marketCache = {
  async get(kv: KVNamespace, platform: string, marketId: string) {
    return cacheGet(kv, `market:${platform}:${marketId}`);
  },

  async set(
    kv: KVNamespace,
    platform: string,
    marketId: string,
    value: unknown,
    ttlSeconds = 60
  ) {
    return cacheSet(kv, `market:${platform}:${marketId}`, value, { ttlSeconds });
  },
};

export const searchCache = {
  async get(kv: KVNamespace, query: string, platform?: string) {
    const key = platform
      ? `search:${platform}:${query}`
      : `search:all:${query}`;
    return cacheGet(kv, key);
  },

  async set(
    kv: KVNamespace,
    query: string,
    value: unknown,
    platform?: string,
    ttlSeconds = 300
  ) {
    const key = platform
      ? `search:${platform}:${query}`
      : `search:all:${query}`;
    return cacheSet(kv, key, value, { ttlSeconds });
  },
};

export const orderbookCache = {
  async get(kv: KVNamespace, platform: string, marketId: string) {
    return cacheGet(kv, `orderbook:${platform}:${marketId}`);
  },

  async set(
    kv: KVNamespace,
    platform: string,
    marketId: string,
    value: unknown,
    ttlSeconds = 30
  ) {
    return cacheSet(kv, `orderbook:${platform}:${marketId}`, value, { ttlSeconds });
  },
};
