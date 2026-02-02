/**
 * Predict.fun Feed
 * Real-time market data from Predict.fun (BNB Chain prediction market)
 *
 * API Endpoints:
 * - Base: https://api.predict.fun/v1
 * - GET /markets - List markets
 * - GET /markets/{marketId} - Market details
 * - GET /markets/{marketId}/orderbook - Orderbook
 */

import { EventEmitter } from 'events';
import { Market, Orderbook, PriceUpdate, Platform } from '../../types';
import { logger } from '../../utils/logger';
import { getGlobalFreshnessTracker, type FreshnessTracker } from '../freshness';

const BASE_URL = 'https://api.predict.fun/v1';

// API rate limit handling
const RATE_LIMIT_DELAY_MS = 70;

interface PredictFunMarket {
  id: string;
  title: string;
  description?: string;
  category?: string;
  status?: 'OPEN' | 'CLOSED' | 'RESOLVED';
  outcomes?: PredictFunOutcome[];
  volume?: number;
  liquidity?: number;
  endDate?: string;
  resolution?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface PredictFunOutcome {
  id: string;
  tokenId: string;
  name: string;
  price?: number;
  volume24h?: number;
}

interface PredictFunOrderbookEntry {
  price: string;
  size: string;
}

interface PredictFunOrderbook {
  bids: PredictFunOrderbookEntry[];
  asks: PredictFunOrderbookEntry[];
}

export interface PredictFunFeed extends EventEmitter {
  connect: () => Promise<void>;
  disconnect: () => void;
  searchMarkets: (query: string) => Promise<Market[]>;
  getMarket: (marketId: string) => Promise<Market | null>;
  getOrderbook: (platform: string, marketId: string) => Promise<Orderbook | null>;
  subscribeToMarket: (marketId: string) => void;
  unsubscribeFromMarket: (marketId: string) => void;
}

export async function createPredictFunFeed(config?: {
  apiKey?: string;
}): Promise<PredictFunFeed> {
  const emitter = new EventEmitter();
  const apiKey = config?.apiKey || process.env.PREDICTFUN_API_KEY;
  const subscribedMarkets = new Set<string>();
  const priceCache = new Map<string, number>();
  let lastRequestTime = 0;
  let pollInterval: NodeJS.Timeout | null = null;

  const freshnessTracker: FreshnessTracker = getGlobalFreshnessTracker();

  function getApiHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }
    return headers;
  }

  async function rateLimitedFetch(url: string, options?: RequestInit): Promise<Response> {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();

    return fetch(url, {
      ...options,
      headers: {
        ...getApiHeaders(),
        ...(options?.headers as Record<string, string> || {}),
      },
    });
  }

  function emitPrice(marketId: string, outcomeId: string, price: number): void {
    const cacheKey = `${marketId}:${outcomeId}`;
    const previousPrice = priceCache.get(cacheKey);
    if (previousPrice !== undefined && previousPrice === price) return;

    freshnessTracker.recordMessage('predictfun', marketId);

    const update: PriceUpdate = {
      platform: 'predictfun',
      marketId,
      outcomeId,
      price,
      previousPrice,
      timestamp: Date.now(),
    };
    priceCache.set(cacheKey, price);
    emitter.emit('price', update);
  }

  function convertToMarket(pfMarket: PredictFunMarket): Market {
    const outcomes = (pfMarket.outcomes || []).map(outcome => ({
      id: outcome.id,
      tokenId: outcome.tokenId,
      name: outcome.name,
      price: outcome.price ?? 0,
      volume24h: outcome.volume24h ?? 0,
    }));

    // If no outcomes, create default Yes/No
    if (outcomes.length === 0) {
      outcomes.push(
        { id: `${pfMarket.id}-yes`, tokenId: `${pfMarket.id}-yes`, name: 'Yes', price: 0.5, volume24h: 0 },
        { id: `${pfMarket.id}-no`, tokenId: `${pfMarket.id}-no`, name: 'No', price: 0.5, volume24h: 0 }
      );
    }

    const endDate = pfMarket.endDate ? new Date(pfMarket.endDate) : undefined;

    return {
      id: pfMarket.id,
      platform: 'predictfun' as Platform,
      slug: `predictfun-${pfMarket.id}`,
      question: pfMarket.title,
      description: pfMarket.description,
      outcomes,
      volume24h: pfMarket.volume ?? 0,
      liquidity: pfMarket.liquidity ?? 0,
      endDate,
      resolved: pfMarket.status === 'RESOLVED',
      resolutionValue: pfMarket.resolution ? (pfMarket.resolution === 'YES' ? 1 : 0) : undefined,
      tags: pfMarket.category ? [pfMarket.category] : [],
      url: `https://predict.fun/markets/${pfMarket.id}`,
      createdAt: pfMarket.createdAt ? new Date(pfMarket.createdAt) : new Date(),
      updatedAt: pfMarket.updatedAt ? new Date(pfMarket.updatedAt) : new Date(),
    };
  }

  async function searchMarkets(query: string): Promise<Market[]> {
    try {
      const params = new URLSearchParams();
      if (query) params.append('search', query);
      params.append('status', 'OPEN');

      const url = `${BASE_URL}/markets?${params}`;
      const response = await rateLimitedFetch(url);

      if (!response.ok) {
        throw new Error(`Predict.fun API error: ${response.status}`);
      }

      const data = await response.json() as { success: boolean; data?: PredictFunMarket[] };
      const markets = data.data || [];

      return markets.map(convertToMarket);
    } catch (error) {
      logger.error('Predict.fun: Search error', error);
      return [];
    }
  }

  async function getMarket(marketId: string): Promise<Market | null> {
    try {
      const url = `${BASE_URL}/markets/${marketId}`;
      const response = await rateLimitedFetch(url);

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Predict.fun API error: ${response.status}`);
      }

      const data = await response.json() as { success: boolean; data?: PredictFunMarket };
      if (!data.data) return null;

      return convertToMarket(data.data);
    } catch (error) {
      logger.error(`Predict.fun: Error fetching market ${marketId}`, error);
      return null;
    }
  }

  async function getOrderbook(_platform: string, marketId: string): Promise<Orderbook | null> {
    try {
      const url = `${BASE_URL}/markets/${marketId}/orderbook`;
      const response = await rateLimitedFetch(url);

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Predict.fun API error: ${response.status}`);
      }

      const data = await response.json() as { success: boolean; data?: PredictFunOrderbook };
      const orderbook = data.data;
      if (!orderbook) return null;

      const bids: [number, number][] = (orderbook.bids || [])
        .map((b: PredictFunOrderbookEntry) => [parseFloat(b.price), parseFloat(b.size)] as [number, number])
        .filter(([price, size]: [number, number]) => !isNaN(price) && !isNaN(size) && price > 0 && size > 0)
        .sort((a: [number, number], b: [number, number]) => b[0] - a[0]);

      const asks: [number, number][] = (orderbook.asks || [])
        .map((a: PredictFunOrderbookEntry) => [parseFloat(a.price), parseFloat(a.size)] as [number, number])
        .filter(([price, size]: [number, number]) => !isNaN(price) && !isNaN(size) && price > 0 && size > 0)
        .sort((a: [number, number], b: [number, number]) => a[0] - b[0]);

      const bestBid = bids[0]?.[0] || 0;
      const bestAsk = asks[0]?.[0] || 1;
      const midPrice = (bestBid + bestAsk) / 2;
      const spread = bestAsk - bestBid;

      return {
        platform: 'predictfun',
        marketId,
        outcomeId: marketId,
        bids,
        asks,
        spread,
        midPrice,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error(`Predict.fun: Error fetching orderbook ${marketId}`, error);
      return null;
    }
  }

  async function pollMarketPrices(): Promise<void> {
    for (const marketId of subscribedMarkets) {
      try {
        const market = await getMarket(marketId);
        if (market) {
          for (const outcome of market.outcomes) {
            emitPrice(marketId, outcome.id, outcome.price);
          }
        }
      } catch (error) {
        logger.warn(`Predict.fun: Error polling ${marketId}`, error);
      }
    }
  }

  return Object.assign(emitter, {
    async connect(): Promise<void> {
      // Start polling for subscribed markets
      pollInterval = setInterval(() => {
        if (subscribedMarkets.size > 0) {
          pollMarketPrices();
        }
      }, 10000); // Poll every 10 seconds

      logger.info('Predict.fun: Feed connected');
      emitter.emit('connected');
    },

    disconnect(): void {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      subscribedMarkets.clear();
      priceCache.clear();
      logger.info('Predict.fun: Feed disconnected');
      emitter.emit('disconnected');
    },

    searchMarkets,
    getMarket,
    getOrderbook,

    subscribeToMarket(marketId: string): void {
      subscribedMarkets.add(marketId);

      freshnessTracker.track('predictfun', marketId, async () => {
        const market = await getMarket(marketId);
        if (market && market.outcomes[0]) {
          emitPrice(marketId, market.outcomes[0].id, market.outcomes[0].price);
        }
      });
    },

    unsubscribeFromMarket(marketId: string): void {
      subscribedMarkets.delete(marketId);
      freshnessTracker.untrack('predictfun', marketId);
    },
  }) as PredictFunFeed;
}
