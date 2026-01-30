/**
 * Manifold Markets Feed
 * Real-time market data from Manifold Markets
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Market, Outcome, PriceUpdate, Platform } from '../../types';
import { logger } from '../../utils/logger';
import { getGlobalFreshnessTracker, type FreshnessTracker } from '../freshness';

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
  // Price cache: marketId -> outcomeId -> price
  const priceCache = new Map<string, Map<string, number>>();
  // Store outcome type for each market
  const marketTypeCache = new Map<string, 'BINARY' | 'MULTIPLE_CHOICE' | 'PSEUDO_NUMERIC' | 'FREE_RESPONSE'>();

  // Freshness tracking for WebSocket health monitoring
  const freshnessTracker: FreshnessTracker = getGlobalFreshnessTracker();

  function convertToMarket(m: ManifoldMarket): Market {
    let outcomes: Outcome[] = [];

    // Cache market type for WebSocket handling
    marketTypeCache.set(m.id, m.outcomeType);

    if (m.outcomeType === 'BINARY' || m.outcomeType === 'PSEUDO_NUMERIC') {
      const prob = m.probability || 0.5;
      outcomes = [
        {
          id: `${m.id}-yes`,
          name: m.outcomeType === 'PSEUDO_NUMERIC' ? 'Higher' : 'Yes',
          price: prob,
          volume24h: m.volume24Hours / 2,
        },
        {
          id: `${m.id}-no`,
          name: m.outcomeType === 'PSEUDO_NUMERIC' ? 'Lower' : 'No',
          price: 1 - prob,
          volume24h: m.volume24Hours / 2,
        },
      ];
    } else if ((m.outcomeType === 'MULTIPLE_CHOICE' || m.outcomeType === 'FREE_RESPONSE') && m.answers) {
      // Sort answers by probability descending for easier display
      const sortedAnswers = [...m.answers].sort((a, b) => b.probability - a.probability);
      outcomes = sortedAnswers.map(a => ({
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
      tags: [m.outcomeType], // Include market type as a tag
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
          const marketId = market.id;

          // Record message for freshness tracking
          freshnessTracker.recordMessage('manifold', marketId);

          // Get or create price cache for this market
          let marketPrices = priceCache.get(marketId);
          if (!marketPrices) {
            marketPrices = new Map();
            priceCache.set(marketId, marketPrices);
          }

          // Handle BINARY markets
          if (market.probability !== undefined) {
            const outcomeId = `${marketId}-yes`;
            const currentPrice = market.probability;
            const previousPrice = marketPrices.get(outcomeId);

            if (previousPrice !== undefined && currentPrice !== previousPrice) {
              emitter.emit('price', {
                platform: 'manifold',
                marketId,
                outcomeId,
                price: currentPrice,
                previousPrice,
                timestamp: Date.now(),
              } as PriceUpdate);
            }

            marketPrices.set(outcomeId, currentPrice);
            // Also update NO price
            marketPrices.set(`${marketId}-no`, 1 - currentPrice);
          }

          // Handle MULTIPLE_CHOICE markets
          if (market.answers && Array.isArray(market.answers)) {
            for (const answer of market.answers) {
              if (!answer.id || answer.probability === undefined) continue;

              const outcomeId = answer.id;
              const currentPrice = answer.probability;
              const previousPrice = marketPrices.get(outcomeId);

              if (previousPrice !== undefined && currentPrice !== previousPrice) {
                emitter.emit('price', {
                  platform: 'manifold',
                  marketId,
                  outcomeId,
                  price: currentPrice,
                  previousPrice,
                  timestamp: Date.now(),
                } as PriceUpdate);
              }

              marketPrices.set(outcomeId, currentPrice);
            }
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

      // Start freshness tracking with polling fallback
      freshnessTracker.track('manifold', id, async () => {
        const market = await getMarket(id);
        if (market && market.outcomes.length > 0) {
          // Get or create price cache for this market
          let marketPrices = priceCache.get(id);
          if (!marketPrices) {
            marketPrices = new Map();
            priceCache.set(id, marketPrices);
          }

          // Emit updates for all outcomes
          for (const outcome of market.outcomes) {
            const currentPrice = outcome.price;
            const previousPrice = marketPrices.get(outcome.id);

            if (previousPrice !== undefined && previousPrice !== currentPrice) {
              emitter.emit('price', {
                platform: 'manifold',
                marketId: id,
                outcomeId: outcome.id,
                price: currentPrice,
                previousPrice,
                timestamp: Date.now(),
              });
            }

            marketPrices.set(outcome.id, currentPrice);
          }
        }
      });
    },

    unsubscribeFromMarket(id: string): void {
      subscribedIds.delete(id);
      priceCache.delete(id);
      marketTypeCache.delete(id);
      freshnessTracker.untrack('manifold', id);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'unsubscribe',
          topics: [`market/${id}`],
        }));
      }
    },
  }) as ManifoldFeed;
}
