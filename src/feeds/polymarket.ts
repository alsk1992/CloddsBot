/**
 * Polymarket REST Client for Cloudflare Workers
 * No WebSocket (not available in Workers), pure REST
 */

import { API_URLS, CACHE_TTL, type Env } from '../config';
import type { Market, Orderbook } from '../types';

interface PolymarketMarket {
  condition_id: string;
  question_id: string;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: number;
  }>;
  question: string;
  description: string;
  end_date_iso: string;
  active: boolean;
  closed: boolean;
  volume: string;
  liquidity: string;
  slug: string;
}

interface PolymarketOrderbookResponse {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

function convertMarket(data: PolymarketMarket): Market {
  return {
    id: data.condition_id,
    platform: 'polymarket',
    slug: data.slug,
    question: data.question,
    description: data.description,
    outcomes: data.tokens.map((t) => ({
      id: t.token_id,
      tokenId: t.token_id,
      name: t.outcome,
      price: t.price,
    })),
    volume24h: parseFloat(data.volume) || 0,
    liquidity: parseFloat(data.liquidity) || 0,
    endDate: data.end_date_iso,
    resolved: data.closed,
    url: `https://polymarket.com/event/${data.slug}`,
  };
}

export async function searchPolymarkets(
  query: string,
  env: Env,
  limit = 20
): Promise<Market[]> {
  const cacheKey = `poly:search:${query}:${limit}`;

  // Check cache
  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const url = `${API_URLS.POLYMARKET_GAMMA}/markets?_limit=${limit}&active=true&closed=false&_q=${encodeURIComponent(query)}`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error('Polymarket search failed:', res.status);
    return [];
  }

  const data = (await res.json()) as PolymarketMarket[];
  const markets = data.map(convertMarket);

  // Cache results
  await env.CACHE.put(cacheKey, JSON.stringify(markets), {
    expirationTtl: CACHE_TTL.SEARCH,
  });

  return markets;
}

export async function getPolymarket(
  marketId: string,
  env: Env
): Promise<Market | null> {
  const cacheKey = `poly:market:${marketId}`;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const res = await fetch(`${API_URLS.POLYMARKET_GAMMA}/markets/${marketId}`);
  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as PolymarketMarket;
  const market = convertMarket(data);

  await env.CACHE.put(cacheKey, JSON.stringify(market), {
    expirationTtl: CACHE_TTL.MARKET,
  });

  return market;
}

export async function getPolymarketOrderbook(
  tokenId: string,
  env: Env
): Promise<Orderbook | null> {
  const cacheKey = `poly:orderbook:${tokenId}`;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const res = await fetch(`${API_URLS.POLYMARKET_REST}/orderbook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token_id: tokenId }),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as PolymarketOrderbookResponse;

  const bids = (data.bids || [])
    .map((bid) => [parseFloat(bid.price), parseFloat(bid.size)] as [number, number])
    .filter(([p, s]) => Number.isFinite(p) && Number.isFinite(s))
    .sort((a, b) => b[0] - a[0]);

  const asks = (data.asks || [])
    .map((ask) => [parseFloat(ask.price), parseFloat(ask.size)] as [number, number])
    .filter(([p, s]) => Number.isFinite(p) && Number.isFinite(s))
    .sort((a, b) => a[0] - b[0]);

  const bestBid = bids[0]?.[0] ?? null;
  const bestAsk = asks[0]?.[0] ?? null;
  const midPrice =
    bestBid !== null && bestAsk !== null
      ? (bestBid + bestAsk) / 2
      : bestBid ?? bestAsk ?? 0;

  const orderbook: Orderbook = {
    platform: 'polymarket',
    marketId: tokenId,
    bids,
    asks,
    spread: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : 0,
    midPrice,
    timestamp: Date.now(),
  };

  await env.CACHE.put(cacheKey, JSON.stringify(orderbook), {
    expirationTtl: CACHE_TTL.ORDERBOOK,
  });

  return orderbook;
}

export async function getPolymarketPrice(
  tokenId: string,
  env: Env
): Promise<number | null> {
  const orderbook = await getPolymarketOrderbook(tokenId, env);
  return orderbook?.midPrice ?? null;
}

export async function getActivePolymarkets(
  env: Env,
  limit = 100
): Promise<Market[]> {
  const cacheKey = `poly:active:${limit}`;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const url = `${API_URLS.POLYMARKET_GAMMA}/markets?_limit=${limit}&active=true&closed=false&_sort=volume:DESC`;

  const res = await fetch(url);
  if (!res.ok) {
    return [];
  }

  const data = (await res.json()) as PolymarketMarket[];
  const markets = data.map(convertMarket);

  await env.CACHE.put(cacheKey, JSON.stringify(markets), {
    expirationTtl: CACHE_TTL.SEARCH,
  });

  return markets;
}
