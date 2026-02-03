/**
 * Opinion.trade Feed
 * Real-time market data from Opinion.trade (BNB Chain prediction market)
 *
 * API Endpoints:
 * - Base: https://proxy.opinion.trade:8443/openapi
 * - GET /market - List markets
 * - GET /market/{marketId} - Market details
 * - GET /token/latest-price?tokenId=X - Token price
 * - GET /token/orderbook?tokenId=X - Orderbook
 * - GET /token/price-history?tokenId=X - Price history
 *
 * WebSocket:
 * - URL: wss://ws.opinion.trade?apikey={API_KEY}
 * - Heartbeat: {"action":"HEARTBEAT"} every 30s
 * - Subscribe: {"action":"SUBSCRIBE","channel":"{CHANNEL}","marketId":{ID}}
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Market, Orderbook, PriceUpdate, Platform } from '../../types';
import { logger } from '../../utils/logger';
import { buildOpinionHeaders, buildOpinionWsUrl, OpinionApiAuth } from '../../utils/opinion-auth';
import { getGlobalFreshnessTracker, type FreshnessTracker } from '../freshness';

const BASE_URL = 'https://proxy.opinion.trade:8443/openapi';

// API rate limit: 15 req/sec
const RATE_LIMIT_DELAY_MS = 70; // ~14 req/sec to stay safe

interface OpinionMarket {
  id: number;
  title: string;
  description?: string;
  category?: string;
  status?: 'OPEN' | 'CLOSED' | 'RESOLVED';
  tokens?: OpinionToken[];
  volume?: number;
  liquidity?: number;
  endTime?: string;
  resolution?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface OpinionToken {
  id: string;
  marketId: number;
  name: string;
  price?: number;
  volume24h?: number;
}

interface OpinionOrderbookEntry {
  price: string;
  size: string;
}

interface OpinionOrderbook {
  bids: OpinionOrderbookEntry[];
  asks: OpinionOrderbookEntry[];
}

export interface OpinionFeed extends EventEmitter {
  connect: () => Promise<void>;
  disconnect: () => void;
  searchMarkets: (query: string) => Promise<Market[]>;
  getMarket: (marketId: string) => Promise<Market | null>;
  getOrderbook: (platform: string, tokenId: string) => Promise<Orderbook | null>;
  subscribeToMarket: (marketId: string) => void;
  unsubscribeFromMarket: (marketId: string) => void;
}

export async function createOpinionFeed(config?: {
  apiKey?: string;
}): Promise<OpinionFeed> {
  const emitter = new EventEmitter();
  let apiAuth: OpinionApiAuth | null = null;
  let ws: WebSocket | null = null;
  let wsReconnectTimer: NodeJS.Timeout | null = null;
  let wsConnected = false;
  let wsReconnectAttempt = 0;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  const subscribedMarkets = new Set<string>();
  const priceCache = new Map<string, number>();
  let lastRequestTime = 0;

  // Freshness tracking for WebSocket health monitoring
  const freshnessTracker: FreshnessTracker = getGlobalFreshnessTracker();

  function loadApiAuth(): void {
    const apiKey = config?.apiKey || process.env.OPINION_API_KEY;

    if (apiKey) {
      apiAuth = { apiKey };
      logger.info('Opinion: API key configured');
    } else {
      logger.warn('Opinion: No API key provided, using unauthenticated access (limited)');
    }
  }

  async function rateLimitedFetch(url: string, options?: RequestInit): Promise<Response> {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> || {}),
    };

    if (apiAuth) {
      Object.assign(headers, buildOpinionHeaders(apiAuth));
    }

    return fetch(url, {
      ...options,
      headers,
    });
  }

  loadApiAuth();

  function emitTokenPrice(tokenId: string, marketId: string, price: number): void {
    const previousPrice = priceCache.get(tokenId);
    if (previousPrice !== undefined && previousPrice === price) return;

    // Record message for freshness tracking
    freshnessTracker.recordMessage('opinion', tokenId);

    const update: PriceUpdate = {
      platform: 'opinion',
      marketId,
      outcomeId: tokenId,
      price,
      previousPrice,
      timestamp: Date.now(),
    };
    priceCache.set(tokenId, price);
    emitter.emit('price', update);
  }

  function scheduleWsReconnect(): void {
    if (wsReconnectTimer) return;
    const delay = Math.min(30000, 2000 + wsReconnectAttempt * 2000);
    wsReconnectAttempt += 1;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      connectWebsocket();
    }, delay);
  }

  function connectWebsocket(): void {
    if (ws || !apiAuth) return;

    const wsUrl = buildOpinionWsUrl(apiAuth);
    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      wsConnected = true;
      wsReconnectAttempt = 0;
      logger.info('Opinion: WebSocket connected');

      // Start heartbeat
      heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'HEARTBEAT' }));
        }
      }, 30000);

      // Resubscribe to all markets
      for (const marketId of subscribedMarkets) {
        subscribeWs(marketId);
      }
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as {
          channel?: string;
          data?: Record<string, unknown>;
          marketId?: number;
          tokenId?: string;
          price?: number;
        };

        // Handle price updates
        if (message.channel === 'price' && message.tokenId && message.price !== undefined) {
          const marketIdStr = message.marketId?.toString() || '';
          emitTokenPrice(message.tokenId, marketIdStr, message.price);
        }

        // Handle orderbook updates
        if (message.channel === 'orderbook' && message.data) {
          const rawData = message.data as { bids?: OpinionOrderbookEntry[]; asks?: OpinionOrderbookEntry[]; tokenId?: string };
          const bids: [number, number][] = (rawData.bids || [])
            .map((b) => [parseFloat(b.price), parseFloat(b.size)] as [number, number])
            .filter(([price, size]) => !isNaN(price) && !isNaN(size) && price > 0 && size > 0)
            .sort((a, b) => b[0] - a[0]);
          const asks: [number, number][] = (rawData.asks || [])
            .map((a) => [parseFloat(a.price), parseFloat(a.size)] as [number, number])
            .filter(([price, size]) => !isNaN(price) && !isNaN(size) && price > 0 && size > 0)
            .sort((a, b) => a[0] - b[0]);

          emitter.emit('orderbook', {
            platform: 'opinion',
            marketId: message.marketId?.toString() || '',
            outcomeId: rawData.tokenId || message.marketId?.toString() || '',
            bids,
            asks,
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        logger.warn({ error }, 'Opinion: Failed to parse WebSocket message');
      }
    });

    ws.on('error', (error) => {
      logger.warn({ error }, 'Opinion: WebSocket error');
    });

    ws.on('close', () => {
      wsConnected = false;
      ws = null;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      logger.warn('Opinion: WebSocket disconnected');
      scheduleWsReconnect();
    });
  }

  function disconnectWebsocket(): void {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    wsConnected = false;
  }

  function subscribeWs(marketId: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Subscribe to price channel for this market
    ws.send(JSON.stringify({
      action: 'SUBSCRIBE',
      channel: 'price',
      marketId: parseInt(marketId, 10),
    }));

    // Subscribe to orderbook channel for this market
    ws.send(JSON.stringify({
      action: 'SUBSCRIBE',
      channel: 'orderbook',
      marketId: parseInt(marketId, 10),
    }));
  }

  function unsubscribeWs(marketId: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      action: 'UNSUBSCRIBE',
      channel: 'price',
      marketId: parseInt(marketId, 10),
    }));

    ws.send(JSON.stringify({
      action: 'UNSUBSCRIBE',
      channel: 'orderbook',
      marketId: parseInt(marketId, 10),
    }));
  }

  function convertToMarket(opinionMarket: OpinionMarket): Market {
    const outcomes = (opinionMarket.tokens || []).map(token => ({
      id: token.id,
      tokenId: token.id,
      name: token.name,
      price: token.price ?? 0,
      volume24h: token.volume24h ?? 0,
    }));

    // If no tokens but we have a binary market, create Yes/No outcomes
    if (outcomes.length === 0) {
      outcomes.push(
        { id: `${opinionMarket.id}-yes`, tokenId: `${opinionMarket.id}-yes`, name: 'Yes', price: 0.5, volume24h: 0 },
        { id: `${opinionMarket.id}-no`, tokenId: `${opinionMarket.id}-no`, name: 'No', price: 0.5, volume24h: 0 }
      );
    }

    const endDate = opinionMarket.endTime ? new Date(opinionMarket.endTime) : undefined;

    return {
      id: opinionMarket.id.toString(),
      platform: 'opinion' as Platform,
      slug: `opinion-${opinionMarket.id}`,
      question: opinionMarket.title,
      description: opinionMarket.description,
      outcomes,
      volume24h: opinionMarket.volume ?? 0,
      liquidity: opinionMarket.liquidity ?? 0,
      endDate,
      resolved: opinionMarket.status === 'RESOLVED',
      resolutionValue: opinionMarket.resolution,
      tags: opinionMarket.category ? [opinionMarket.category] : [],
      url: `https://opinion.trade/market/${opinionMarket.id}`,
      createdAt: opinionMarket.createdAt ? new Date(opinionMarket.createdAt) : new Date(),
      updatedAt: opinionMarket.updatedAt ? new Date(opinionMarket.updatedAt) : new Date(),
    };
  }

  async function searchMarkets(query: string): Promise<Market[]> {
    try {
      const url = `${BASE_URL}/market`;
      const response = await rateLimitedFetch(url);

      if (!response.ok) {
        throw new Error(`Opinion API error: ${response.status}`);
      }

      const data = await response.json() as { markets?: OpinionMarket[] } | OpinionMarket[];
      const markets: OpinionMarket[] = Array.isArray(data) ? data : (data.markets || []);

      // Filter by query
      const queryLower = query.toLowerCase();
      const filtered = markets.filter(m =>
        m.title.toLowerCase().includes(queryLower) ||
        (m.description && m.description.toLowerCase().includes(queryLower)) ||
        (m.category && m.category.toLowerCase().includes(queryLower))
      );

      return filtered.map(convertToMarket);
    } catch (error) {
      logger.error('Opinion: Search error', error);
      return [];
    }
  }

  async function getMarket(marketId: string): Promise<Market | null> {
    try {
      const url = `${BASE_URL}/market/${marketId}`;
      const response = await rateLimitedFetch(url);

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Opinion API error: ${response.status}`);
      }

      const data = await response.json() as OpinionMarket | { market?: OpinionMarket };
      const market: OpinionMarket | undefined = 'market' in data && data.market ? data.market : (data as OpinionMarket);
      if (!market || !market.id) return null;

      return convertToMarket(market);
    } catch (error) {
      logger.error(`Opinion: Error fetching market ${marketId}`, error);
      return null;
    }
  }

  async function getOrderbook(_platform: string, tokenId: string): Promise<Orderbook | null> {
    try {
      const url = `${BASE_URL}/token/orderbook?tokenId=${encodeURIComponent(tokenId)}`;
      const response = await rateLimitedFetch(url);

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Opinion API error: ${response.status}`);
      }

      const data = await response.json() as OpinionOrderbook | { orderbook?: OpinionOrderbook };
      const orderbook: OpinionOrderbook | undefined = 'orderbook' in data && data.orderbook ? data.orderbook : (data as OpinionOrderbook);
      if (!orderbook) return null;

      const bids: [number, number][] = (orderbook.bids || [])
        .map((b: OpinionOrderbookEntry) => [parseFloat(b.price), parseFloat(b.size)] as [number, number])
        .filter(([price, size]: [number, number]) => !isNaN(price) && !isNaN(size) && price > 0 && size > 0)
        .sort((a: [number, number], b: [number, number]) => b[0] - a[0]); // Sort bids descending by price

      const asks: [number, number][] = (orderbook.asks || [])
        .map((a: OpinionOrderbookEntry) => [parseFloat(a.price), parseFloat(a.size)] as [number, number])
        .filter(([price, size]: [number, number]) => !isNaN(price) && !isNaN(size) && price > 0 && size > 0)
        .sort((a: [number, number], b: [number, number]) => a[0] - b[0]); // Sort asks ascending by price

      const bestBid = bids[0]?.[0] || 0;
      const bestAsk = asks[0]?.[0] || 1;
      const midPrice = (bestBid + bestAsk) / 2;
      const spread = bestAsk - bestBid;

      // Extract marketId from tokenId if possible (Opinion tokens often include market info)
      const marketId = tokenId.split('-')[0] || tokenId;

      return {
        platform: 'opinion',
        marketId,
        outcomeId: tokenId,
        bids,
        asks,
        spread,
        midPrice,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error(`Opinion: Error fetching orderbook ${tokenId}`, error);
      return null;
    }
  }

  async function getTokenPrice(tokenId: string): Promise<number | null> {
    try {
      const url = `${BASE_URL}/token/latest-price?tokenId=${encodeURIComponent(tokenId)}`;
      const response = await rateLimitedFetch(url);

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as { price?: number } | number;
      const price = typeof data === 'number' ? data : data.price;
      return price ?? null;
    } catch (error) {
      logger.warn(`Opinion: Error fetching price for ${tokenId}`, error);
      return null;
    }
  }

  return Object.assign(emitter, {
    async connect(): Promise<void> {
      loadApiAuth();
      if (apiAuth) {
        connectWebsocket();
      }
      logger.info('Opinion: Feed connected');
      emitter.emit('connected');
    },

    disconnect(): void {
      disconnectWebsocket();
      apiAuth = null;
      logger.info('Opinion: Feed disconnected');
      emitter.emit('disconnected');
    },

    searchMarkets,
    getMarket,
    getOrderbook,

    subscribeToMarket(marketId: string): void {
      subscribedMarkets.add(marketId);
      if (wsConnected) {
        subscribeWs(marketId);
      }

      // Start freshness tracking with polling fallback
      freshnessTracker.track('opinion', marketId, async () => {
        const market = await getMarket(marketId);
        if (market && market.outcomes[0]) {
          const tokenId = market.outcomes[0].tokenId || market.outcomes[0].id;
          const price = await getTokenPrice(tokenId);
          if (price !== null) {
            emitTokenPrice(tokenId, marketId, price);
          }
        }
      });
    },

    unsubscribeFromMarket(marketId: string): void {
      subscribedMarkets.delete(marketId);
      freshnessTracker.untrack('opinion', marketId);
      if (wsConnected) {
        unsubscribeWs(marketId);
      }
    },
  }) as OpinionFeed;
}
