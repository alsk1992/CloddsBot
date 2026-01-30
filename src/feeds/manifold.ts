/**
 * Manifold Markets REST Client for Cloudflare Workers
 */

import { API_URLS, CACHE_TTL, type Env } from '../config';
import type { Market } from '../types';

interface ManifoldMarket {
  id: string;
  slug: string;
  question: string;
  description?: string;
  probability?: number;
  volume: number;
  volume24Hours?: number;
  totalLiquidity?: number;
  closeTime?: number;
  isResolved: boolean;
  resolution?: string;
  outcomeType: string;
  answers?: Array<{
    id: string;
    text: string;
    probability: number;
  }>;
}

function convertMarket(data: ManifoldMarket): Market {
  let outcomes: Market['outcomes'];

  if (data.outcomeType === 'BINARY') {
    const prob = data.probability ?? 0.5;
    outcomes = [
      { id: 'yes', name: 'Yes', price: prob },
      { id: 'no', name: 'No', price: 1 - prob },
    ];
  } else if (data.answers && data.answers.length > 0) {
    outcomes = data.answers.map((a) => ({
      id: a.id,
      name: a.text,
      price: a.probability,
    }));
  } else {
    outcomes = [{ id: 'yes', name: 'Yes', price: data.probability ?? 0.5 }];
  }

  return {
    id: data.id,
    platform: 'manifold',
    slug: data.slug,
    question: data.question,
    description: data.description,
    outcomes,
    volume24h: data.volume24Hours ?? data.volume ?? 0,
    liquidity: data.totalLiquidity ?? 0,
    endDate: data.closeTime ? new Date(data.closeTime).toISOString() : undefined,
    resolved: data.isResolved,
    url: `https://manifold.markets/${data.slug}`,
  };
}

export async function searchManifoldMarkets(
  query: string,
  env: Env,
  limit = 20
): Promise<Market[]> {
  const cacheKey = `manifold:search:${query}:${limit}`;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const url = `${API_URLS.MANIFOLD_API}/search-markets?term=${encodeURIComponent(query)}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error('Manifold search failed:', res.status);
    return [];
  }

  const data = (await res.json()) as ManifoldMarket[];
  const markets = data.map(convertMarket);

  await env.CACHE.put(cacheKey, JSON.stringify(markets), {
    expirationTtl: CACHE_TTL.SEARCH,
  });

  return markets;
}

export async function getManifoldMarket(
  slug: string,
  env: Env
): Promise<Market | null> {
  const cacheKey = `manifold:market:${slug}`;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const res = await fetch(`${API_URLS.MANIFOLD_API}/slug/${slug}`);
  if (!res.ok) {
    if (res.status === 404) return null;
    console.error('Manifold market fetch failed:', res.status);
    return null;
  }

  const data = (await res.json()) as ManifoldMarket;
  const market = convertMarket(data);

  await env.CACHE.put(cacheKey, JSON.stringify(market), {
    expirationTtl: CACHE_TTL.MARKET,
  });

  return market;
}

export async function getActiveManifoldMarkets(
  env: Env,
  limit = 100
): Promise<Market[]> {
  const cacheKey = `manifold:active:${limit}`;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const url = `${API_URLS.MANIFOLD_API}/markets?limit=${limit}&sort=liquidity`;

  const res = await fetch(url);
  if (!res.ok) {
    return [];
  }

  const data = (await res.json()) as ManifoldMarket[];
  const markets = data.filter((m) => !m.isResolved).map(convertMarket);

  await env.CACHE.put(cacheKey, JSON.stringify(markets), {
    expirationTtl: CACHE_TTL.SEARCH,
  });

  return markets;
}
