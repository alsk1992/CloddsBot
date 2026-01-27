/**
 * Manifold Markets Feed
 * Real-time market data from Manifold Markets
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Market, Outcome, PriceUpdate, Platform } from '../../types';
import { logger } from '../../utils/logger';

const API_URL = 'https://api.manifold.markets/v0';
const WS_URL = 'wss://api.manifold.markets/ws';

interface ManifoldMarket {
  id: string;
  slug: string;
  question: string;
  description?: string;
  textDescription?: string;
  probability?: number;
  pool?: { YES: number; NO: number };
  volume: number;
  volume24Hours: number;
  totalLiquidity: number;
  closeTime?: number;
  isResolved: boolean;
  resolution?: string;
  resolutionProbability?: number;
  createdTime: number;
  lastUpdatedTime: number;
  url: string;
  outcomeType: 'BINARY' | 'MULTIPLE_CHOICE' | 'PSEUDO_NUMERIC' | 'FREE_RESPONSE';
  answers?: Array<{
    id: string;
    text: string;
    probability: number;
  }>;
}

export interface ManifoldFeed extends EventEmitter {
  connect: () => Promise<void>;
  disconnect: () => void;
  searchMarkets: (query: string) => Promise<Market[]>;
  getMarket: (idOrSlug: string) => Promise<Market | null>;
  subscribeToMarket: (id: string) => void;
  unsubscribeFromMarket: (id: string) => void;
}

export async function createManifoldFeed(): Promise<ManifoldFeed> {
  const emitter = new EventEmitter();
  let ws: WebSocket | null = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECTS = 5;
  const subscribedIds = new Set<string>();
  const priceCache = new Map<string, number>();

  function convertToMarket(m: ManifoldMarket): Market {
    let outcomes: Outcome[] = [];

    if (m.outcomeType === 'BINARY') {
      const prob = m.probability || 0.5;
      outcomes = [
        {
          id: `${m.id}-yes`,
          name: 'Yes',
          price: prob,
          volume24h: m.volume24Hours / 2,
        },
        {
          id: `${m.id}-no`,
          name: 'No',
          price: 1 - prob,
          volume24h: m.volume24Hours / 2,
        },
      ];
    } else if (m.outcomeType === 'MULTIPLE_CHOICE' && m.answers) {
      outcomes = m.answers.map(a => ({
        id: a.id,
        name: a.text,
        price: a.probability,
        volume24h: m.volume24Hours / m.answers!.length,
      }));
    }

    return {
      id: m.id,
      platform: 'manifold' as Platform,
      slug: m.slug,
      question: m.question,
      description: m.textDescription || m.description,
      outcomes,
      volume24h: m.volume24Hours,
      liquidity: m.totalLiquidity,
      endDate: m.closeTime ? new Date(m.closeTime) : undefined,
      resolved: m.isResolved,
      resolutionValue: m.resolutionProbability,
      tags: [],
      url: m.url || `https://manifold.markets/${m.slug}`,
      createdAt: new Date(m.createdTime),
      updatedAt: new Date(m.lastUpdatedTime),
    };
  }

  async function searchMarkets(query: string): Promise<Market[]> {
    try {
      const params = new URLSearchParams({
        term: query,
        limit: '20',
        filter: 'open',
        sort: 'liquidity',
      });

      const response = await fetch(`${API_URL}/search-markets?${params}`);

      if (!response.ok) {
        throw new Error(`Manifold API error: ${response.status}`);
      }

      const markets = await response.json() as ManifoldMarket[];
      return markets.map(convertToMarket);
    } catch (error) {
      logger.error('Manifold: Search error', error);
      return [];
    }
  }

  async function getMarket(idOrSlug: string): Promise<Market | null> {
    try {
      // Try by ID first
      let response = await fetch(`${API_URL}/market/${idOrSlug}`);

      if (!response.ok) {
        // Try by slug
        response = await fetch(`${API_URL}/slug/${idOrSlug}`);
      }

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Manifold API error: ${response.status}`);
      }

      const market = await response.json() as ManifoldMarket;
      return convertToMarket(market);
    } catch (error) {
      logger.error(`Manifold: Error fetching market ${idOrSlug}`, error);
      return null;
    }
  }

  function setupWebSocket(): void {
    ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      logger.info('Manifold: WebSocket connected');
      reconnectAttempts = 0;
      emitter.emit('connected');

      // Resubscribe to markets
      for (const id of subscribedIds) {
        ws?.send(JSON.stringify({
          type: 'subscribe',
          topics: [`market/${id}`],
        }));
      }
    });

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'market-update') {
          const market = message.data;
          const currentPrice = market.probability;

          if (currentPrice !== undefined) {
            const previousPrice = priceCache.get(market.id);

            if (previousPrice !== undefined && currentPrice !== previousPrice) {
              const update: PriceUpdate = {
                platform: 'manifold',
                marketId: market.id,
                outcomeId: `${market.id}-yes`,
                price: currentPrice,
                previousPrice,
                timestamp: Date.now(),
              };
              emitter.emit('price', update);
            }

            priceCache.set(market.id, currentPrice);
          }
        }
      } catch (error) {
        logger.error('Manifold: WebSocket message parse error', error);
      }
    });

    ws.on('close', () => {
      logger.warn('Manifold: WebSocket disconnected');
      emitter.emit('disconnected');

      if (reconnectAttempts < MAX_RECONNECTS) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        setTimeout(setupWebSocket, delay);
      }
    });

    ws.on('error', (error) => {
      logger.error('Manifold: WebSocket error', error);
    });
  }

  return Object.assign(emitter, {
    async connect(): Promise<void> {
      setupWebSocket();
    },

    disconnect(): void {
      if (ws) {
        ws.close();
        ws = null;
      }
    },

    searchMarkets,
    getMarket,

    subscribeToMarket(id: string): void {
      subscribedIds.add(id);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'subscribe',
          topics: [`market/${id}`],
        }));
      }
    },

    unsubscribeFromMarket(id: string): void {
      subscribedIds.delete(id);
      priceCache.delete(id);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'unsubscribe',
          topics: [`market/${id}`],
        }));
      }
    },
  }) as ManifoldFeed;
}
