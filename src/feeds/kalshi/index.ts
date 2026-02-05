/**
 * Kalshi Feed
 * Real-time market data from Kalshi
 */

import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import WebSocket from 'ws';
import { Market, Orderbook, PriceUpdate, Platform } from '../../types';
import { logger } from '../../utils/logger';
import { buildKalshiHeadersForUrl, KalshiApiKeyAuth, normalizeKalshiPrivateKey } from '../../utils/kalshi-auth';
import { getGlobalFreshnessTracker, type FreshnessTracker } from '../freshness';

const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';
const WS_URL = 'wss://api.elections.kalshi.com/trade-api/ws/v2';

interface KalshiMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  category?: string;
  status?: string;
  event_ticker?: string;
  yes_price?: number;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  volume?: number;
  volume_24h?: number;
  open_interest?: number;
  close_time?: string;
  close_ts?: number;
  result?: string;
}

interface KalshiEvent {
  event_ticker: string;
  title: string;
  category: string;
  markets: KalshiMarket[];
}

export interface KalshiEventResult {
  eventTicker: string;
  title: string;
  category: string;
  markets: Market[];
}

export interface KalshiFeed extends EventEmitter {
  connect: () => Promise<void>;
  disconnect: () => void;
  searchMarkets: (query: string) => Promise<Market[]>;
  getMarket: (ticker: string) => Promise<Market | null>;
  getOrderbook: (ticker: string) => Promise<Orderbook | null>;
  getEvents: (params?: { status?: string; limit?: number; category?: string }) => Promise<KalshiEventResult[]>;
  getEvent: (eventTicker: string) => Promise<KalshiEventResult | null>;
  subscribeToMarket: (ticker: string) => void;
  unsubscribeFromMarket: (ticker: string) => void;
}

export async function createKalshiFeed(config?: {
  apiKeyId?: string;
  privateKeyPem?: string;
  privateKeyPath?: string;
  /** Legacy email login (deprecated) */
  email?: string;
  /** Legacy password login (deprecated) */
  password?: string;
}): Promise<KalshiFeed> {
  const emitter = new EventEmitter();
  let apiKeyAuth: KalshiApiKeyAuth | null = null;
  let pollInterval: NodeJS.Timeout | null = null;
  let ws: WebSocket | null = null;
  let wsReconnectTimer: NodeJS.Timeout | null = null;
  let wsConnected = false;
  let wsReconnectAttempt = 0;
  let wsRequestId = 1;
  const subscribedTickers = new Set<string>();
  const priceCache = new Map<string, number>();

  // Freshness tracking for WebSocket health monitoring
  const freshnessTracker: FreshnessTracker = getGlobalFreshnessTracker();

  function loadApiKeyAuth(): void {
    const apiKeyId = config?.apiKeyId || process.env.KALSHI_API_KEY_ID;
    const privateKeyPath = config?.privateKeyPath || process.env.KALSHI_PRIVATE_KEY_PATH;
    const privateKeyPem = config?.privateKeyPem || process.env.KALSHI_PRIVATE_KEY;

    let pem = privateKeyPem;
    if (!pem && privateKeyPath) {
      try {
        pem = readFileSync(privateKeyPath, 'utf8');
      } catch (error) {
        logger.warn({ error, privateKeyPath }, 'Kalshi: Failed to read private key file');
      }
    }

    if (apiKeyId && pem) {
      apiKeyAuth = {
        apiKeyId,
        privateKeyPem: normalizeKalshiPrivateKey(pem),
      };
      return;
    }

    if (config?.email || config?.password) {
      logger.warn('Kalshi: Legacy email/password auth is no longer supported in feed. Use API key auth.');
    } else {
      logger.warn('Kalshi: No API key credentials provided, using unauthenticated access');
    }
  }

  function getHeaders(method: string, url: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKeyAuth) {
      Object.assign(headers, buildKalshiHeadersForUrl(apiKeyAuth, method, url));
    }
    return headers;
  }

  loadApiKeyAuth();

  function shouldUseWebsocket(): boolean {
    return Boolean(apiKeyAuth);
  }

  function normalizePrice(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value));
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1.5 ? numeric / 100 : numeric;
  }

  function normalizeCents(value: unknown): number | null {
    return normalizePrice(value);
  }

  function emitTickerPrice(ticker: string, price: number): void {
    const previousPrice = priceCache.get(ticker);
    if (previousPrice !== undefined && previousPrice === price) return;

    // Record message for freshness tracking
    freshnessTracker.recordMessage('kalshi', ticker);

    const update: PriceUpdate = {
      platform: 'kalshi',
      marketId: ticker,
      outcomeId: `${ticker}-yes`,
      price,
      previousPrice,
      timestamp: Date.now(),
    };
    priceCache.set(ticker, price);
    emitter.emit('price', update);
  }

  function sendWsMessage(payload: Record<string, unknown>): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }

  function subscribeWs(ticker: string): void {
    sendWsMessage({
      id: wsRequestId++,
      cmd: 'subscribe',
      params: {
        channels: ['ticker'],
        market_ticker: ticker,
      },
    });
  }

  function unsubscribeWs(ticker: string): void {
    sendWsMessage({
      id: wsRequestId++,
      cmd: 'unsubscribe',
      params: {
        channels: ['ticker'],
        market_ticker: ticker,
      },
    });
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
    if (ws || !apiKeyAuth) return;

    const headers = buildKalshiHeadersForUrl(apiKeyAuth, 'GET', WS_URL);
    ws = new WebSocket(WS_URL, { headers });

    ws.on('open', () => {
      wsConnected = true;
      wsReconnectAttempt = 0;
      logger.info('Kalshi: WebSocket connected');
      for (const ticker of subscribedTickers) {
        subscribeWs(ticker);
      }
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as {
          type?: string;
          data?: Record<string, unknown>;
        };
        if (message.type !== 'ticker' || !message.data) return;

        const ticker = message.data.market_ticker as string | undefined;
        if (!ticker) return;

        const yesBid = normalizePrice(message.data.yes_bid);
        const yesAsk = normalizePrice(message.data.yes_ask);
        const lastPrice = normalizePrice(message.data.last_price);

        let price: number | null = null;
        if (yesBid !== null && yesAsk !== null) {
          price = (yesBid + yesAsk) / 2;
        } else if (yesBid !== null) {
          price = yesBid;
        } else if (yesAsk !== null) {
          price = yesAsk;
        } else if (lastPrice !== null) {
          price = lastPrice;
        }

        if (price !== null) {
          emitTickerPrice(ticker, price);
        }
      } catch (error) {
        logger.warn({ error }, 'Kalshi: Failed to parse WebSocket message');
      }
    });

    ws.on('error', (error) => {
      logger.warn({ error }, 'Kalshi: WebSocket error');
    });

    ws.on('close', () => {
      wsConnected = false;
      ws = null;
      logger.warn('Kalshi: WebSocket disconnected');
      scheduleWsReconnect();
    });
  }

  function disconnectWebsocket(): void {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    wsConnected = false;
  }

  function convertToMarket(kalshiMarket: KalshiMarket): Market {
    const yesPrice = normalizeCents(kalshiMarket.yes_price)
      ?? normalizeCents(kalshiMarket.yes_bid)
      ?? normalizeCents(kalshiMarket.yes_ask)
      ?? 0;
    const noPrice = normalizeCents(kalshiMarket.no_bid)
      ?? normalizeCents(kalshiMarket.no_ask)
      ?? Math.max(0, 1 - yesPrice);
    const closeTime = kalshiMarket.close_time
      ? new Date(kalshiMarket.close_time)
      : kalshiMarket.close_ts
        ? new Date(kalshiMarket.close_ts * 1000)
        : undefined;

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
          volume24h: (kalshiMarket.volume_24h ?? kalshiMarket.volume ?? 0) / 2,
        },
        {
          id: `${kalshiMarket.ticker}-no`,
          name: 'No',
          price: noPrice,
          volume24h: (kalshiMarket.volume_24h ?? kalshiMarket.volume ?? 0) / 2,
        },
      ],
      volume24h: (kalshiMarket.volume_24h ?? kalshiMarket.volume ?? 0) / 100,
      liquidity: (kalshiMarket.open_interest ?? 0) / 100,
      endDate: closeTime,
      resolved: kalshiMarket.result !== undefined && kalshiMarket.result !== null,
      resolutionValue: kalshiMarket.result === 'yes' ? 1 : kalshiMarket.result === 'no' ? 0 : undefined,
      tags: kalshiMarket.category ? [kalshiMarket.category] : [],
      url: `https://kalshi.com/markets/${kalshiMarket.ticker}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async function searchMarkets(query: string): Promise<Market[]> {
    try {
      const params = new URLSearchParams({
        status: 'open',
        limit: '20',
      });

      const url = `${BASE_URL}/markets?${params}`;
      const response = await fetch(url, {
        headers: getHeaders('GET', url),
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
    try {
      const url = `${BASE_URL}/markets/${ticker}`;
      const response = await fetch(url, {
        headers: getHeaders('GET', url),
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

  function parseOrderbookSide(raw: unknown): Array<[number, number]> {
    if (!Array.isArray(raw)) return [];
    const levels: Array<[number, number]> = [];
    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const price = normalizePrice(entry[0]);
      const size = typeof entry[1] === 'number' ? entry[1] : Number.parseFloat(String(entry[1]));
      if (price === null || !Number.isFinite(size) || size <= 0) continue;
      levels.push([price, size]);
    }
    return levels;
  }

  async function getOrderbook(ticker: string): Promise<Orderbook | null> {
    try {
      const url = `${BASE_URL}/markets/${ticker}/orderbook`;
      const response = await fetch(url, {
        headers: getHeaders('GET', url),
      });
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Kalshi API error: ${response.status}`);
      }
      const payload = await response.json() as { orderbook?: { yes?: unknown; no?: unknown } };
      const orderbook = payload.orderbook || {};
      const yesBids = parseOrderbookSide(orderbook.yes);
      const noBids = parseOrderbookSide(orderbook.no);

      const asks: Array<[number, number]> = noBids
        .map(([price, size]): [number, number] => [Number((1 - price).toFixed(4)), size])
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
      const spread =
        Number.isFinite(bestBid) && Number.isFinite(bestAsk)
          ? bestAsk - bestBid
          : 0;

      return {
        platform: 'kalshi',
        marketId: ticker,
        outcomeId: `${ticker}-yes`,
        bids,
        asks,
        spread,
        midPrice,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error(`Kalshi: Error fetching orderbook ${ticker}`, error);
      return null;
    }
  }

  async function pollPrices(): Promise<void> {
    if (wsConnected) return;
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
      loadApiKeyAuth();
      if (shouldUseWebsocket()) {
        connectWebsocket();
        pollInterval = setInterval(pollPrices, 5000);
        logger.info('Kalshi: Connected (websocket + polling fallback)');
      } else {
        pollInterval = setInterval(pollPrices, 5000);
        logger.info('Kalshi: Connected (polling mode)');
      }
      emitter.emit('connected');
    },

    disconnect(): void {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      disconnectWebsocket();
      apiKeyAuth = null;
      logger.info('Kalshi: Disconnected');
      emitter.emit('disconnected');
    },

    searchMarkets,
    getMarket,
    getOrderbook,

    async getEvents(params?: { status?: string; limit?: number; category?: string }): Promise<KalshiEventResult[]> {
      try {
        const qs = new URLSearchParams({
          status: params?.status ?? 'open',
          limit: String(params?.limit ?? 20),
          with_nested_markets: 'true',
        });
        if (params?.category) qs.set('series_ticker', params.category);

        const url = `${BASE_URL}/events?${qs}`;
        const response = await fetch(url, { headers: getHeaders('GET', url) });
        if (!response.ok) throw new Error(`Kalshi API error: ${response.status}`);

        const data = (await response.json()) as { events?: KalshiEvent[] };
        const events = data.events || [];

        return events.map(e => ({
          eventTicker: e.event_ticker,
          title: e.title,
          category: e.category,
          markets: (e.markets || []).map(convertToMarket),
        }));
      } catch (error) {
        logger.error('Kalshi: Events fetch error', error);
        return [];
      }
    },

    async getEvent(eventTicker: string): Promise<KalshiEventResult | null> {
      try {
        const url = `${BASE_URL}/events/${eventTicker}?with_nested_markets=true`;
        const response = await fetch(url, { headers: getHeaders('GET', url) });
        if (!response.ok) {
          if (response.status === 404) return null;
          throw new Error(`Kalshi API error: ${response.status}`);
        }

        const data = (await response.json()) as { event?: KalshiEvent };
        const e = data.event;
        if (!e) return null;

        return {
          eventTicker: e.event_ticker,
          title: e.title,
          category: e.category,
          markets: (e.markets || []).map(convertToMarket),
        };
      } catch (error) {
        logger.error(`Kalshi: Error fetching event ${eventTicker}`, error);
        return null;
      }
    },

    subscribeToMarket(ticker: string): void {
      subscribedTickers.add(ticker);
      if (wsConnected) {
        subscribeWs(ticker);
      }

      // Start freshness tracking with polling fallback
      freshnessTracker.track('kalshi', ticker, async () => {
        const market = await getMarket(ticker);
        if (market && market.outcomes[0]) {
          emitTickerPrice(ticker, market.outcomes[0].price);
        }
      });
    },

    unsubscribeFromMarket(ticker: string): void {
      subscribedTickers.delete(ticker);
      priceCache.delete(ticker);
      freshnessTracker.untrack('kalshi', ticker);
      if (wsConnected) {
        unsubscribeWs(ticker);
      }
    },
  }) as KalshiFeed;
}
