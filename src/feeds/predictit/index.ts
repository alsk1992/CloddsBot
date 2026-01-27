/**
 * PredictIt Feed
 * Read-only market data (no trading API)
 */

import { EventEmitter } from 'events';
import { Market, Platform } from '../../types';
import { logger } from '../../utils/logger';

const API_URL = 'https://www.predictit.org/api/marketdata/all/';

interface PredictItMarket {
  id: number;
  name: string;
  shortName: string;
  image: string;
  url: string;
  contracts: PredictItContract[];
  timeStamp: string;
  status: string;
}

interface PredictItContract {
  id: number;
  name: string;
  shortName: string;
  image: string;
  status: string;
  lastTradePrice: number;
  bestBuyYesCost: number;
  bestBuyNoCost: number;
  bestSellYesCost: number;
  bestSellNoCost: number;
  lastClosePrice: number;
  displayOrder: number;
}

export interface PredictItFeed extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): void;
  searchMarkets(query: string): Promise<Market[]>;
  getMarket(id: string): Promise<Market | null>;
  getAllMarkets(): Promise<Market[]>;
}

export async function createPredictItFeed(): Promise<PredictItFeed> {
  const emitter = new EventEmitter() as PredictItFeed;
  let marketCache: PredictItMarket[] = [];
  let lastFetch = 0;
  const CACHE_TTL = 60000; // 1 minute

  async function fetchAllMarkets(): Promise<PredictItMarket[]> {
    const now = Date.now();
    if (marketCache.length > 0 && now - lastFetch < CACHE_TTL) {
      return marketCache;
    }

    try {
      const response = await fetch(API_URL);
      if (!response.ok) {
        throw new Error(`PredictIt API error: ${response.status}`);
      }

      const data: any = await response.json();
      marketCache = data.markets || [];
      lastFetch = now;
      return marketCache;
    } catch (error) {
      logger.error('PredictIt fetch error:', error);
      return marketCache;
    }
  }

  function convertToMarket(m: PredictItMarket): Market {
    return {
      id: m.id.toString(),
      platform: 'predictit' as Platform,
      slug: m.url.split('/').pop() || m.id.toString(),
      question: m.name,
      description: m.shortName,
      outcomes: m.contracts.map(c => ({
        id: c.id.toString(),
        name: c.name,
        price: c.lastTradePrice,
        previousPrice: c.lastClosePrice,
        volume24h: 0, // PredictIt doesn't expose volume
      })),
      volume24h: 0,
      liquidity: 0,
      resolved: m.status === 'Closed',
      tags: [],
      url: m.url,
      createdAt: new Date(m.timeStamp),
      updatedAt: new Date(m.timeStamp),
    };
  }

  emitter.connect = async () => {
    logger.info('PredictIt feed connected (read-only)');
    await fetchAllMarkets();
  };

  emitter.disconnect = () => {
    marketCache = [];
    logger.info('PredictIt feed disconnected');
  };

  emitter.searchMarkets = async (query: string): Promise<Market[]> => {
    const markets = await fetchAllMarkets();
    const queryLower = query.toLowerCase();

    return markets
      .filter(m =>
        m.name.toLowerCase().includes(queryLower) ||
        m.shortName.toLowerCase().includes(queryLower) ||
        m.contracts.some(c => c.name.toLowerCase().includes(queryLower))
      )
      .map(convertToMarket)
      .slice(0, 20);
  };

  emitter.getMarket = async (id: string): Promise<Market | null> => {
    const markets = await fetchAllMarkets();
    const market = markets.find(m => m.id.toString() === id);
    return market ? convertToMarket(market) : null;
  };

  emitter.getAllMarkets = async (): Promise<Market[]> => {
    const markets = await fetchAllMarkets();
    return markets.map(convertToMarket);
  };

  return emitter;
}
