/**
 * Drift BET Feed
 * Prediction markets on Solana
 *
 * Docs: https://docs.drift.trade/prediction-markets/
 */

import { EventEmitter } from 'events';
import { Market, Outcome, PriceUpdate, Platform } from '../../types';
import { logger } from '../../utils/logger';

// Drift BET API endpoints
const API_URL = 'https://drift-api.drift.trade';
const BET_API_URL = 'https://bet.drift.trade/api';

interface DriftMarket {
  marketIndex: number;
  baseAssetSymbol: string;
  marketName: string;
  status: string;
  expiryTs: number;
  probability: number;
  volume24h: number;
  openInterest: number;
  description?: string;
}

export interface DriftFeed extends EventEmitter {
  start: () => Promise<void>;
  stop: () => void;
  searchMarkets: (query: string) => Promise<Market[]>;
  getMarket: (marketIndex: string) => Promise<Market | null>;
  subscribeToMarket: (marketIndex: string) => void;
  unsubscribeFromMarket: (marketIndex: string) => void;
}

export async function createDriftFeed(): Promise<DriftFeed> {
  const emitter = new EventEmitter();
  let pollInterval: NodeJS.Timeout | null = null;
  const subscribedMarkets = new Set<string>();
  const priceCache = new Map<string, number>();

  function convertToMarket(m: DriftMarket): Market {
    const prob = m.probability;

    return {
      id: m.marketIndex.toString(),
      platform: 'drift' as Platform,
      slug: m.baseAssetSymbol.toLowerCase(),
      question: m.marketName,
      description: m.description,
      outcomes: [
        {
          id: `${m.marketIndex}-yes`,
          name: 'Yes',
          price: prob,
          volume24h: m.volume24h / 2,
        },
        {
          id: `${m.marketIndex}-no`,
          name: 'No',
          price: 1 - prob,
          volume24h: m.volume24h / 2,
        },
      ],
      volume24h: m.volume24h,
      liquidity: m.openInterest,
      endDate: m.expiryTs ? new Date(m.expiryTs * 1000) : undefined,
      resolved: m.status === 'resolved',
      tags: ['solana', 'crypto'],
      url: `https://bet.drift.trade/market/${m.marketIndex}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async function fetchMarkets(): Promise<DriftMarket[]> {
    try {
      // Drift BET API - fetch prediction markets
      const response = await fetch(`${BET_API_URL}/markets`);
      if (!response.ok) {
        throw new Error(`Drift API error: ${response.status}`);
      }
      const data: any = await response.json();
      return data.markets || [];
    } catch (error) {
      logger.warn('Drift: Failed to fetch markets', error);
      return [];
    }
  }

  async function searchMarkets(query: string): Promise<Market[]> {
    try {
      const markets = await fetchMarkets();
      const queryLower = query.toLowerCase();

      const filtered = markets.filter(m =>
        m.marketName.toLowerCase().includes(queryLower) ||
        m.baseAssetSymbol.toLowerCase().includes(queryLower)
      );

      return filtered.map(convertToMarket);
    } catch (error) {
      logger.error('Drift: Search error', error);
      return [];
    }
  }

  async function getMarket(marketIndex: string): Promise<Market | null> {
    try {
      const response = await fetch(`${BET_API_URL}/markets/${marketIndex}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Drift API error: ${response.status}`);
      }
      const market = await response.json() as DriftMarket;
      return convertToMarket(market);
    } catch (error) {
      logger.error(`Drift: Error fetching market ${marketIndex}`, error);
      return null;
    }
  }

  async function pollPrices(): Promise<void> {
    if (subscribedMarkets.size === 0) return;

    for (const marketIndex of subscribedMarkets) {
      try {
        const market = await getMarket(marketIndex);
        if (!market) continue;

        const currentPrice = market.outcomes[0].price;
        const previousPrice = priceCache.get(marketIndex);

        if (previousPrice !== undefined && currentPrice !== previousPrice) {
          const update: PriceUpdate = {
            platform: 'drift' as Platform,
            marketId: marketIndex,
            outcomeId: `${marketIndex}-yes`,
            price: currentPrice,
            previousPrice,
            timestamp: Date.now(),
          };
          emitter.emit('price', update);
        }

        priceCache.set(marketIndex, currentPrice);
      } catch (error) {
        logger.error(`Drift: Poll error for ${marketIndex}`, error);
      }
    }
  }

  return Object.assign(emitter, {
    async start(): Promise<void> {
      // Drift doesn't have WebSocket for BET markets, poll every 10s
      pollInterval = setInterval(pollPrices, 10000);
      logger.info('Drift BET: Started (polling mode)');
      emitter.emit('connected');
    },

    stop(): void {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      logger.info('Drift BET: Stopped');
      emitter.emit('disconnected');
    },

    searchMarkets,
    getMarket,

    subscribeToMarket(marketIndex: string): void {
      subscribedMarkets.add(marketIndex);
    },

    unsubscribeFromMarket(marketIndex: string): void {
      subscribedMarkets.delete(marketIndex);
      priceCache.delete(marketIndex);
    },
  }) as DriftFeed;
}
