/**
 * Kalshi Feed
 * Real-time market data from Kalshi
 */

import { EventEmitter } from 'events';
import { Market, Outcome, PriceUpdate, Platform } from '../../types';
import { logger } from '../../utils/logger';

const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';

interface KalshiMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  category: string;
  status: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  volume: number;
  volume_24h: number;
  open_interest: number;
  close_time: string;
  result?: string;
}

interface KalshiEvent {
  event_ticker: string;
  title: string;
  category: string;
  markets: KalshiMarket[];
}

export interface KalshiFeed extends EventEmitter {
  connect: () => Promise<void>;
  disconnect: () => void;
  searchMarkets: (query: string) => Promise<Market[]>;
  getMarket: (ticker: string) => Promise<Market | null>;
  subscribeToMarket: (ticker: string) => void;
  unsubscribeFromMarket: (ticker: string) => void;
}

export async function createKalshiFeed(config?: {
  email?: string;
  password?: string;
}): Promise<KalshiFeed> {
  const emitter = new EventEmitter();
  let authToken: string | null = null;
  let tokenExpiry: Date | null = null;
  let pollInterval: NodeJS.Timeout | null = null;
  const subscribedTickers = new Set<string>();
  const priceCache = new Map<string, number>();

  async function authenticate(): Promise<void> {
    if (!config?.email || !config?.password) {
      logger.warn('Kalshi: No credentials provided, using unauthenticated access');
      return;
    }

    try {
      const response = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: config.email,
          password: config.password,
        }),
      });

      if (!response.ok) {
        throw new Error(`Kalshi auth failed: ${response.status}`);
      }

      const data: any = await response.json();
      authToken = data.token;
      // Token expires in 30 minutes
      tokenExpiry = new Date(Date.now() + 29 * 60 * 1000);
      logger.info('Kalshi: Authenticated successfully');
    } catch (error) {
      logger.error('Kalshi: Authentication error', error);
    }
  }

  function getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
  }

  async function ensureAuth(): Promise<void> {
    if (config?.email && config?.password) {
      if (!authToken || !tokenExpiry || new Date() >= tokenExpiry) {
        await authenticate();
      }
    }
  }

  function convertToMarket(kalshiMarket: KalshiMarket): Market {
    const yesPrice = kalshiMarket.yes_bid / 100;
    const noPrice = kalshiMarket.no_bid / 100;

    return {
      id: kalshiMarket.ticker,
      platform: 'kalshi' as Platform,
      slug: kalshiMarket.ticker.toLowerCase(),
      question: kalshiMarket.title,
      description: kalshiMarket.subtitle,
      outcomes: [
        {
          id: `${kalshiMarket.ticker}-yes`,
          name: 'Yes',
          price: yesPrice,
          volume24h: kalshiMarket.volume_24h / 2,
        },
        {
          id: `${kalshiMarket.ticker}-no`,
          name: 'No',
          price: noPrice,
          volume24h: kalshiMarket.volume_24h / 2,
        },
      ],
      volume24h: kalshiMarket.volume_24h / 100,
      liquidity: kalshiMarket.open_interest / 100,
      endDate: new Date(kalshiMarket.close_time),
      resolved: kalshiMarket.result !== undefined,
      resolutionValue: kalshiMarket.result === 'yes' ? 1 : kalshiMarket.result === 'no' ? 0 : undefined,
      tags: [kalshiMarket.category],
      url: `https://kalshi.com/markets/${kalshiMarket.ticker}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async function searchMarkets(query: string): Promise<Market[]> {
    await ensureAuth();

    try {
      const params = new URLSearchParams({
        status: 'open',
        limit: '20',
      });

      const response = await fetch(`${BASE_URL}/markets?${params}`, {
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Kalshi API error: ${response.status}`);
      }

      const data: any = await response.json();
      const markets: KalshiMarket[] = data.markets || [];

      // Filter by query
      const queryLower = query.toLowerCase();
      const filtered = markets.filter(m =>
        m.title.toLowerCase().includes(queryLower) ||
        m.ticker.toLowerCase().includes(queryLower)
      );

      return filtered.map(convertToMarket);
    } catch (error) {
      logger.error('Kalshi: Search error', error);
      return [];
    }
  }

  async function getMarket(ticker: string): Promise<Market | null> {
    await ensureAuth();

    try {
      const response = await fetch(`${BASE_URL}/markets/${ticker}`, {
        headers: getHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Kalshi API error: ${response.status}`);
      }

      const data: any = await response.json();
      return convertToMarket(data.market);
    } catch (error) {
      logger.error(`Kalshi: Error fetching market ${ticker}`, error);
      return null;
    }
  }

  async function pollPrices(): Promise<void> {
    if (subscribedTickers.size === 0) return;

    for (const ticker of subscribedTickers) {
      try {
        const market = await getMarket(ticker);
        if (!market) continue;

        const currentPrice = market.outcomes[0].price;
        const previousPrice = priceCache.get(ticker);

        if (previousPrice !== undefined && currentPrice !== previousPrice) {
          const update: PriceUpdate = {
            platform: 'kalshi',
            marketId: ticker,
            outcomeId: `${ticker}-yes`,
            price: currentPrice,
            previousPrice,
            timestamp: Date.now(),
          };
          emitter.emit('price', update);
        }

        priceCache.set(ticker, currentPrice);
      } catch (error) {
        logger.error(`Kalshi: Poll error for ${ticker}`, error);
      }
    }
  }

  return Object.assign(emitter, {
    async connect(): Promise<void> {
      await authenticate();
      // Kalshi doesn't have WebSocket, so we poll
      pollInterval = setInterval(pollPrices, 5000);
      logger.info('Kalshi: Connected (polling mode)');
      emitter.emit('connected');
    },

    disconnect(): void {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      authToken = null;
      tokenExpiry = null;
      logger.info('Kalshi: Disconnected');
      emitter.emit('disconnected');
    },

    searchMarkets,
    getMarket,

    subscribeToMarket(ticker: string): void {
      subscribedTickers.add(ticker);
    },

    unsubscribeFromMarket(ticker: string): void {
      subscribedTickers.delete(ticker);
      priceCache.delete(ticker);
    },
  }) as KalshiFeed;
}
