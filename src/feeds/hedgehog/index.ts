/**
 * Hedgehog Markets Feed
 * Real-time market data from Hedgehog Markets (Solana prediction market)
 *
 * Hedgehog Markets is a decentralized prediction market platform on Solana
 * with near-instant settlement and low fees.
 *
 * Website: https://hedgehog.markets
 * GitHub: https://github.com/Hedgehog-Markets
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Market, Orderbook, PriceUpdate, OrderbookUpdate, Platform } from '../../types';
import { logger } from '../../utils/logger';
import { getGlobalFreshnessTracker, type FreshnessTracker } from '../freshness';
import type {
  HedgehogFeedConfig,
  HedgehogApiMarket,
  HedgehogMarketsResponse,
  HedgehogMarketResponse,
  HedgehogOrderbook,
  HedgehogWsMessage,
  HedgehogWsPrice,
  HedgehogWsOrderbook,
} from './types';

// Default API endpoints
const DEFAULT_API_URL = 'https://api.hedgehog.markets';
const DEFAULT_WS_URL = 'wss://ws.hedgehog.markets';

// Fallback to web scraping endpoint if API doesn't exist
const FALLBACK_API_URL = 'https://hedgehog.markets/api';

// Rate limiting
const RATE_LIMIT_DELAY_MS = 100; // 10 req/sec to be safe

export interface HedgehogFeed extends EventEmitter {
  start: () => Promise<void>;
  stop: () => void;
  searchMarkets: (query: string) => Promise<Market[]>;
  getMarket: (marketId: string) => Promise<Market | null>;
  getOrderbook: (platform: string, marketId: string, outcomeId?: string) => Promise<Orderbook | null>;
  subscribeToMarket: (marketId: string) => void;
  unsubscribeFromMarket: (marketId: string) => void;
}

export async function createHedgehogFeed(config: HedgehogFeedConfig = {}): Promise<HedgehogFeed> {
  const emitter = new EventEmitter();

  // Configuration
  const apiUrl = config.apiUrl || process.env.HEDGEHOG_API_URL || DEFAULT_API_URL;
  const wsUrl = config.wsUrl || process.env.HEDGEHOG_WS_URL || DEFAULT_WS_URL;
  const apiKey = config.apiKey || process.env.HEDGEHOG_API_KEY;
  const requestTimeoutMs = config.requestTimeoutMs ?? 10000;
  const pollIntervalMs = config.pollIntervalMs ?? 10000;
  const enableWebSocket = config.enableWebSocket ?? true;
  const minVolume = config.minVolume ?? 0;
  const categories = config.categories;

  // State
  let ws: WebSocket | null = null;
  let wsConnected = false;
  let wsReconnectTimer: NodeJS.Timeout | null = null;
  let wsReconnectAttempt = 0;
  let pollInterval: NodeJS.Timeout | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  const subscribedMarkets = new Set<string>();
  const priceCache = new Map<string, number>();
  const marketCache = new Map<string, Market>();
  let lastRequestTime = 0;
  let usesFallbackApi = false;

  // Freshness tracking
  const freshnessTracker: FreshnessTracker = getGlobalFreshnessTracker();

  /**
   * Rate-limited fetch with timeout and optional API key
   */
  async function rateLimitedFetch(url: string, options?: RequestInit): Promise<Response> {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options?.headers as Record<string, string> || {}),
      };

      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['X-API-Key'] = apiKey;
      }

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Try fetching from primary API, fall back to alternate endpoint
   */
  async function fetchWithFallback<T>(path: string): Promise<T | null> {
    const primaryUrl = `${apiUrl}${path}`;
    const fallbackUrl = `${FALLBACK_API_URL}${path}`;

    try {
      const response = await rateLimitedFetch(usesFallbackApi ? fallbackUrl : primaryUrl);

      if (!response.ok) {
        // Try fallback if primary fails and we haven't switched yet
        if (!usesFallbackApi) {
          logger.info('Hedgehog: Primary API unavailable, trying fallback');
          usesFallbackApi = true;
          const fallbackResponse = await rateLimitedFetch(fallbackUrl);
          if (fallbackResponse.ok) {
            return await fallbackResponse.json() as T;
          }
        }
        throw new Error(`Hedgehog API error: ${response.status}`);
      }

      return await response.json() as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.warn('Hedgehog: Request timeout');
      } else {
        logger.warn({ error }, 'Hedgehog: Fetch error');
      }
      return null;
    }
  }

  /**
   * Convert Hedgehog API market to standard Market type
   */
  function convertToMarket(apiMarket: HedgehogApiMarket): Market {
    const outcomes = apiMarket.outcomes.map(outcome => ({
      id: outcome.id,
      tokenId: outcome.tokenId || outcome.mint || outcome.id,
      name: outcome.name,
      price: outcome.price,
      priceChange24h: outcome.priceChange24h,
      volume24h: outcome.volume24h ?? 0,
    }));

    // If no outcomes but binary market, create Yes/No
    if (outcomes.length === 0 && apiMarket.marketType === 'binary') {
      outcomes.push(
        { id: `${apiMarket.id}-yes`, tokenId: `${apiMarket.id}-yes`, name: 'Yes', price: 0.5, priceChange24h: undefined, volume24h: 0 },
        { id: `${apiMarket.id}-no`, tokenId: `${apiMarket.id}-no`, name: 'No', price: 0.5, priceChange24h: undefined, volume24h: 0 }
      );
    }

    const endDate = apiMarket.endTime
      ? new Date(typeof apiMarket.endTime === 'number' ? apiMarket.endTime * 1000 : apiMarket.endTime)
      : undefined;

    const createdAt = apiMarket.createdAt
      ? new Date(typeof apiMarket.createdAt === 'number' ? apiMarket.createdAt * 1000 : apiMarket.createdAt)
      : new Date();

    const updatedAt = apiMarket.updatedAt
      ? new Date(typeof apiMarket.updatedAt === 'number' ? apiMarket.updatedAt * 1000 : apiMarket.updatedAt)
      : new Date();

    const tags = [...(apiMarket.tags || [])];
    if (apiMarket.category && !tags.includes(apiMarket.category)) {
      tags.push(apiMarket.category);
    }
    if (!tags.includes('solana')) {
      tags.push('solana');
    }

    return {
      id: apiMarket.id,
      platform: 'hedgehog' as Platform,
      slug: `hedgehog-${apiMarket.id}`,
      question: apiMarket.title,
      description: apiMarket.description,
      outcomes,
      volume24h: apiMarket.volume24h ?? apiMarket.volume ?? 0,
      liquidity: apiMarket.liquidity ?? 0,
      endDate,
      resolved: apiMarket.status === 'resolved',
      resolutionValue: apiMarket.resolution,
      tags,
      url: `https://hedgehog.markets/market/${apiMarket.id}`,
      createdAt,
      updatedAt,
    };
  }

  /**
   * Emit price update
   */
  function emitPriceUpdate(marketId: string, outcomeId: string, price: number): void {
    const cacheKey = `${marketId}-${outcomeId}`;
    const previousPrice = priceCache.get(cacheKey);

    if (previousPrice !== undefined && previousPrice === price) {
      return; // No change
    }

    // Record for freshness tracking
    freshnessTracker.recordMessage('hedgehog', marketId);

    const update: PriceUpdate = {
      platform: 'hedgehog' as Platform,
      marketId,
      outcomeId,
      price,
      previousPrice,
      timestamp: Date.now(),
    };

    priceCache.set(cacheKey, price);
    emitter.emit('price', update);
  }

  /**
   * Emit orderbook update
   */
  function emitOrderbookUpdate(
    marketId: string,
    outcomeId: string,
    bids: Array<[number, number]>,
    asks: Array<[number, number]>
  ): void {
    const update: OrderbookUpdate = {
      platform: 'hedgehog' as Platform,
      marketId,
      outcomeId,
      bids,
      asks,
      timestamp: Date.now(),
    };
    emitter.emit('orderbook', update);
  }

  /**
   * Connect to WebSocket
   */
  function connectWebSocket(): void {
    if (ws || !enableWebSocket) return;

    const fullWsUrl = apiKey ? `${wsUrl}?apiKey=${apiKey}` : wsUrl;

    try {
      ws = new WebSocket(fullWsUrl);

      ws.on('open', () => {
        wsConnected = true;
        wsReconnectAttempt = 0;
        logger.info('Hedgehog: WebSocket connected');

        // Start heartbeat
        heartbeatInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
          }
        }, 30000);

        // Resubscribe to all markets
        for (const marketId of subscribedMarkets) {
          subscribeWs(marketId);
        }
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString()) as HedgehogWsMessage;
          handleWsMessage(message);
        } catch (error) {
          logger.warn({ error }, 'Hedgehog: Failed to parse WebSocket message');
        }
      });

      ws.on('error', (error) => {
        logger.warn({ error }, 'Hedgehog: WebSocket error');
      });

      ws.on('close', () => {
        wsConnected = false;
        ws = null;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        logger.warn('Hedgehog: WebSocket disconnected');
        scheduleWsReconnect();
      });
    } catch (error) {
      logger.warn({ error }, 'Hedgehog: Failed to create WebSocket');
      scheduleWsReconnect();
    }
  }

  /**
   * Schedule WebSocket reconnection
   */
  function scheduleWsReconnect(): void {
    if (wsReconnectTimer || !enableWebSocket) return;

    const delay = Math.min(30000, 2000 + wsReconnectAttempt * 2000);
    wsReconnectAttempt += 1;

    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      connectWebSocket();
    }, delay);
  }

  /**
   * Handle WebSocket message
   */
  function handleWsMessage(message: HedgehogWsMessage): void {
    switch (message.type) {
      case 'price': {
        const priceMsg = message as HedgehogWsPrice;
        emitPriceUpdate(priceMsg.marketId, priceMsg.outcomeId, priceMsg.price);
        break;
      }
      case 'orderbook': {
        const obMsg = message as HedgehogWsOrderbook;
        const bids: Array<[number, number]> = obMsg.bids.map(b => [b.price, b.size]);
        const asks: Array<[number, number]> = obMsg.asks.map(a => [a.price, a.size]);
        emitOrderbookUpdate(obMsg.marketId, obMsg.outcomeId, bids, asks);
        break;
      }
      case 'heartbeat':
        // Heartbeat acknowledged
        break;
      case 'error':
        logger.warn({ code: (message as any).code, message: (message as any).message }, 'Hedgehog: WebSocket error message');
        break;
    }
  }

  /**
   * Subscribe to market via WebSocket
   */
  function subscribeWs(marketId: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: 'subscribe',
      channel: 'price',
      marketId,
    }));

    ws.send(JSON.stringify({
      type: 'subscribe',
      channel: 'orderbook',
      marketId,
    }));
  }

  /**
   * Unsubscribe from market via WebSocket
   */
  function unsubscribeWs(marketId: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: 'unsubscribe',
      channel: 'price',
      marketId,
    }));

    ws.send(JSON.stringify({
      type: 'unsubscribe',
      channel: 'orderbook',
      marketId,
    }));
  }

  /**
   * Disconnect WebSocket
   */
  function disconnectWebSocket(): void {
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

  /**
   * Poll prices for subscribed markets (fallback when WebSocket unavailable)
   */
  async function pollPrices(): Promise<void> {
    if (subscribedMarkets.size === 0) return;

    for (const marketId of subscribedMarkets) {
      try {
        const market = await getMarket(marketId);
        if (!market) continue;

        for (const outcome of market.outcomes) {
          emitPriceUpdate(marketId, outcome.id, outcome.price);
        }
      } catch (error) {
        logger.warn({ error, marketId }, 'Hedgehog: Poll error');
      }
    }
  }

  /**
   * Fetch all markets
   */
  async function fetchMarkets(): Promise<HedgehogApiMarket[]> {
    try {
      // Try different possible API endpoints
      let data = await fetchWithFallback<HedgehogMarketsResponse | HedgehogApiMarket[]>('/markets');

      if (!data) {
        // Try alternate endpoint
        data = await fetchWithFallback<HedgehogMarketsResponse | HedgehogApiMarket[]>('/v1/markets');
      }

      if (!data) {
        logger.warn('Hedgehog: Failed to fetch markets');
        return [];
      }

      const markets = Array.isArray(data) ? data : (data as HedgehogMarketsResponse).markets;

      if (!markets || !Array.isArray(markets)) {
        logger.warn('Hedgehog: Invalid markets response');
        return [];
      }

      // Filter by volume and categories if configured
      return markets.filter(m => {
        if (minVolume > 0 && (m.volume24h ?? m.volume ?? 0) < minVolume) {
          return false;
        }
        if (categories && categories.length > 0 && m.category) {
          return categories.includes(m.category);
        }
        return true;
      });
    } catch (error) {
      logger.error({ error }, 'Hedgehog: Error fetching markets');
      return [];
    }
  }

  /**
   * Search markets by query
   */
  async function searchMarkets(query: string): Promise<Market[]> {
    try {
      const markets = await fetchMarkets();
      const queryLower = query.toLowerCase();

      const filtered = markets.filter(m =>
        m.title.toLowerCase().includes(queryLower) ||
        (m.description && m.description.toLowerCase().includes(queryLower)) ||
        (m.category && m.category.toLowerCase().includes(queryLower)) ||
        (m.tags && m.tags.some(tag => tag.toLowerCase().includes(queryLower)))
      );

      const converted = filtered.map(convertToMarket);

      // Cache markets
      for (const market of converted) {
        marketCache.set(market.id, market);
      }

      return converted;
    } catch (error) {
      logger.error({ error }, 'Hedgehog: Search error');
      return [];
    }
  }

  /**
   * Get single market by ID
   */
  async function getMarket(marketId: string): Promise<Market | null> {
    // Check cache first
    const cached = marketCache.get(marketId);
    if (cached) {
      return cached;
    }

    try {
      const data = await fetchWithFallback<HedgehogMarketResponse | HedgehogApiMarket>(`/markets/${marketId}`);

      if (!data) {
        // Try alternate endpoint
        const altData = await fetchWithFallback<HedgehogMarketResponse | HedgehogApiMarket>(`/v1/markets/${marketId}`);
        if (!altData) return null;

        const apiMarket = 'market' in altData ? altData.market : altData;
        const market = convertToMarket(apiMarket);
        marketCache.set(marketId, market);
        return market;
      }

      const apiMarket = 'market' in data ? (data as HedgehogMarketResponse).market : (data as HedgehogApiMarket);
      const market = convertToMarket(apiMarket);
      marketCache.set(marketId, market);
      return market;
    } catch (error) {
      logger.error({ error, marketId }, 'Hedgehog: Error fetching market');
      return null;
    }
  }

  /**
   * Get orderbook for a market/outcome
   */
  async function getOrderbook(_platform: string, marketId: string, outcomeId?: string): Promise<Orderbook | null> {
    try {
      const endpoint = outcomeId
        ? `/markets/${marketId}/orderbook/${outcomeId}`
        : `/markets/${marketId}/orderbook`;

      const data = await fetchWithFallback<HedgehogOrderbook>(endpoint);

      if (!data) {
        // Try to construct from market data
        const market = await getMarket(marketId);
        if (!market || market.outcomes.length === 0) return null;

        const outcome = outcomeId
          ? market.outcomes.find(o => o.id === outcomeId)
          : market.outcomes[0];

        if (!outcome) return null;

        // Synthetic orderbook from price
        const size = Math.max(1, market.liquidity || market.volume24h || 1);
        return {
          platform: 'hedgehog' as Platform,
          marketId,
          outcomeId: outcome.id,
          bids: [[outcome.price, size]],
          asks: [[outcome.price, size]],
          spread: 0,
          midPrice: outcome.price,
          timestamp: Date.now(),
        };
      }

      const bids: Array<[number, number]> = data.bids
        .map(b => [b.price, b.size] as [number, number])
        .filter(([price, size]) => price > 0 && size > 0)
        .sort((a, b) => b[0] - a[0]);

      const asks: Array<[number, number]> = data.asks
        .map(a => [a.price, a.size] as [number, number])
        .filter(([price, size]) => price > 0 && size > 0)
        .sort((a, b) => a[0] - b[0]);

      const bestBid = bids[0]?.[0] ?? 0;
      const bestAsk = asks[0]?.[0] ?? 1;
      const midPrice = (bestBid + bestAsk) / 2;
      const spread = bestAsk - bestBid;

      return {
        platform: 'hedgehog' as Platform,
        marketId,
        outcomeId: data.outcomeId || outcomeId || '',
        bids,
        asks,
        spread,
        midPrice,
        timestamp: data.timestamp || Date.now(),
      };
    } catch (error) {
      logger.error({ error, marketId }, 'Hedgehog: Error fetching orderbook');
      return null;
    }
  }

  // Create and return the feed
  return Object.assign(emitter, {
    async start(): Promise<void> {
      logger.info({ apiUrl, wsUrl, enableWebSocket }, 'Hedgehog: Starting feed');

      // Test API connectivity
      const markets = await fetchMarkets();
      if (markets.length === 0) {
        logger.warn('Hedgehog: No markets found or API unavailable');
      } else {
        logger.info({ count: markets.length }, 'Hedgehog: Markets loaded');

        // Cache initial markets
        for (const m of markets) {
          const market = convertToMarket(m);
          marketCache.set(market.id, market);
        }
      }

      // Connect WebSocket for real-time updates
      if (enableWebSocket) {
        connectWebSocket();
      }

      // Start polling as fallback or if WebSocket disabled
      if (!enableWebSocket || !wsConnected) {
        pollInterval = setInterval(pollPrices, pollIntervalMs);
        logger.info({ pollIntervalMs }, 'Hedgehog: Started polling mode');
      }

      emitter.emit('connected');
    },

    stop(): void {
      disconnectWebSocket();

      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      subscribedMarkets.clear();
      priceCache.clear();
      marketCache.clear();

      logger.info('Hedgehog: Feed stopped');
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
      freshnessTracker.track('hedgehog', marketId, async () => {
        const market = await getMarket(marketId);
        if (market) {
          for (const outcome of market.outcomes) {
            emitPriceUpdate(marketId, outcome.id, outcome.price);
          }
        }
      });
    },

    unsubscribeFromMarket(marketId: string): void {
      subscribedMarkets.delete(marketId);
      freshnessTracker.untrack('hedgehog', marketId);

      // Clear cached prices for this market
      for (const key of priceCache.keys()) {
        if (key.startsWith(`${marketId}-`)) {
          priceCache.delete(key);
        }
      }

      if (wsConnected) {
        unsubscribeWs(marketId);
      }
    },
  }) as HedgehogFeed;
}

// Export types
export type { HedgehogFeedConfig } from './types';
