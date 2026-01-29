/**
 * Kalshi REST Client for Cloudflare Workers
 * Supports API key authentication
 */

import { API_URLS, CACHE_TTL, type Env } from '../config';
import type { Market, Orderbook } from '../types';
import { buildKalshiHeaders } from '../utils/crypto';

interface KalshiMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  category?: string;
  status?: string;
  yes_price?: number;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  volume?: number;
  volume_24h?: number;
  open_interest?: number;
  close_time?: string;
  result?: string;
}

function normalizePrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(numeric)) return null;
  // Kalshi prices can be in cents (1-99) or decimal (0.01-0.99)
  return numeric > 1.5 ? numeric / 100 : numeric;
}

function convertMarket(data: KalshiMarket): Market {
  const yesPrice =
    normalizePrice(data.yes_price) ??
    normalizePrice(data.yes_bid) ??
    normalizePrice(data.yes_ask) ??
    0;
  const noPrice =
    normalizePrice(data.no_bid) ??
    normalizePrice(data.no_ask) ??
    Math.max(0, 1 - yesPrice);

  return {
    id: data.ticker,
    platform: 'kalshi',
    slug: data.ticker.toLowerCase(),
    question: data.title,
    description: data.subtitle,
    outcomes: [
      {
        id: `${data.ticker}-yes`,
        name: 'Yes',
        price: yesPrice,
      },
      {
        id: `${data.ticker}-no`,
        name: 'No',
        price: noPrice,
      },
    ],
    volume24h: (data.volume_24h ?? data.volume ?? 0) / 100,
    liquidity: (data.open_interest ?? 0) / 100,
    endDate: data.close_time,
    resolved: data.result !== undefined && data.result !== null,
    url: `https://kalshi.com/markets/${data.ticker}`,
  };
}

async function kalshiFetch(
  url: string,
  env: Env,
  method = 'GET'
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add auth headers if credentials available
  if (env.KALSHI_API_KEY_ID && env.KALSHI_PRIVATE_KEY) {
    const authHeaders = await buildKalshiHeaders(
      env.KALSHI_API_KEY_ID,
      env.KALSHI_PRIVATE_KEY,
      method,
      url
    );
    Object.assign(headers, authHeaders);
  }

  return fetch(url, { method, headers });
}

export async function searchKalshiMarkets(
  query: string,
  env: Env,
  limit = 20
): Promise<Market[]> {
  const cacheKey = `kalshi:search:${query}:${limit}`;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const url = `${API_URLS.KALSHI_API}/markets?status=open&limit=${limit}`;
  const res = await kalshiFetch(url, env);

  if (!res.ok) {
    console.error('Kalshi search failed:', res.status);
    return [];
  }

  const data = (await res.json()) as { markets?: KalshiMarket[] };
  const markets = data.markets || [];

  // Filter by query client-side (Kalshi doesn't have text search)
  const queryLower = query.toLowerCase();
  const filtered = markets.filter(
    (m) =>
      m.title.toLowerCase().includes(queryLower) ||
      m.ticker.toLowerCase().includes(queryLower)
  );

  const converted = filtered.map(convertMarket);

  await env.CACHE.put(cacheKey, JSON.stringify(converted), {
    expirationTtl: CACHE_TTL.SEARCH,
  });

  return converted;
}

export async function getKalshiMarket(
  ticker: string,
  env: Env
): Promise<Market | null> {
  const cacheKey = `kalshi:market:${ticker}`;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const url = `${API_URLS.KALSHI_API}/markets/${ticker}`;
  const res = await kalshiFetch(url, env);

  if (!res.ok) {
    if (res.status === 404) return null;
    console.error('Kalshi market fetch failed:', res.status);
    return null;
  }

  const data = (await res.json()) as { market?: KalshiMarket };
  if (!data.market) return null;

  const market = convertMarket(data.market);

  await env.CACHE.put(cacheKey, JSON.stringify(market), {
    expirationTtl: CACHE_TTL.MARKET,
  });

  return market;
}

export async function getKalshiOrderbook(
  ticker: string,
  env: Env
): Promise<Orderbook | null> {
  const cacheKey = `kalshi:orderbook:${ticker}`;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const url = `${API_URLS.KALSHI_API}/markets/${ticker}/orderbook`;
  const res = await kalshiFetch(url, env);

  if (!res.ok) {
    return null;
  }

  const payload = (await res.json()) as {
    orderbook?: { yes?: unknown; no?: unknown };
  };
  const orderbook = payload.orderbook || {};

  function parseOrderbookSide(raw: unknown): Array<[number, number]> {
    if (!Array.isArray(raw)) return [];
    const levels: Array<[number, number]> = [];
    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const price = normalizePrice(entry[0]);
      const size =
        typeof entry[1] === 'number' ? entry[1] : parseFloat(String(entry[1]));
      if (price === null || !Number.isFinite(size) || size <= 0) continue;
      levels.push([price, size]);
    }
    return levels;
  }

  const yesBids = parseOrderbookSide(orderbook.yes);
  const noBids = parseOrderbookSide(orderbook.no);

  // Convert NO bids to YES asks (price = 1 - noPrice)
  const asks: Array<[number, number]> = noBids
    .map(([price, size]) => [Number((1 - price).toFixed(4)), size] as [number, number])
    .filter(([price]) => price > 0 && price < 1)
    .sort((a, b) => a[0] - b[0]);

  const bids = yesBids.sort((a, b) => b[0] - a[0]);
  const bestBid = bids[0]?.[0];
  const bestAsk = asks[0]?.[0];
  const midPrice =
    Number.isFinite(bestBid) && Number.isFinite(bestAsk)
      ? (bestBid + bestAsk) / 2
      : Number.isFinite(bestBid)
        ? bestBid
        : Number.isFinite(bestAsk)
          ? bestAsk
          : 0;

  const result: Orderbook = {
    platform: 'kalshi',
    marketId: ticker,
    bids,
    asks,
    spread:
      Number.isFinite(bestBid) && Number.isFinite(bestAsk)
        ? bestAsk - bestBid
        : 0,
    midPrice,
    timestamp: Date.now(),
  };

  await env.CACHE.put(cacheKey, JSON.stringify(result), {
    expirationTtl: CACHE_TTL.ORDERBOOK,
  });

  return result;
}

export async function getActiveKalshiMarkets(
  env: Env,
  limit = 100
): Promise<Market[]> {
  const cacheKey = `kalshi:active:${limit}`;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const url = `${API_URLS.KALSHI_API}/markets?status=open&limit=${limit}`;
  const res = await kalshiFetch(url, env);

  if (!res.ok) {
    return [];
  }

  const data = (await res.json()) as { markets?: KalshiMarket[] };
  const markets = (data.markets || []).map(convertMarket);

  await env.CACHE.put(cacheKey, JSON.stringify(markets), {
    expirationTtl: CACHE_TTL.SEARCH,
  });

  return markets;
}
