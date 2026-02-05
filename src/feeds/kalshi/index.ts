/**
 * Kalshi Feed
 * Real-time market data from Kalshi via WebSocket
 *
 * WebSocket URL: wss://api.elections.kalshi.com/trade-api/ws/v2
 * Auth: Required for connection (KALSHI-ACCESS-KEY, KALSHI-ACCESS-SIGNATURE, KALSHI-ACCESS-TIMESTAMP)
 *
 * PUBLIC channels (no extra auth):
 * - 'ticker': Price updates (yes_bid, yes_ask, last_price) - DEFAULT
 * - 'trade': Live trade stream with price, count, taker side
 *
 * PRIVATE channels (requires auth):
 * - 'orderbook_delta': Real-time orderbook changes (snapshot + deltas with seq)
 * - 'fill': Personal order fill notifications
 *
 * Message flow for orderbook_delta:
 * 1. Subscribe -> receive 'subscribed' with sid
 * 2. Receive 'orderbook_snapshot' with full book state
 * 3. Receive 'orderbook_delta' messages with seq numbers
 *
 * Events emitted:
 * - 'price': PriceUpdate when ticker price changes
 * - 'orderbook_snapshot': Full orderbook state
 * - 'orderbook_delta': KalshiOrderbookDelta on orderbook changes
 * - 'trade': KalshiTradeEvent on trades
 * - 'fill': KalshiFillEvent when your orders fill
 *
 * Heartbeat: Kalshi sends ping every 10s with body "heartbeat", pong auto-handled
 *
 * Usage:
 *   const feed = await createKalshiFeed({ apiKeyId, privateKeyPem });
 *   await feed.connect();
 *   feed.subscribeToMarket('TICKER', ['ticker', 'trade']);  // public
 *   feed.subscribeToMarket('TICKER', ['orderbook_delta']); // private, requires auth
 *   feed.subscribeToFills();  // Get fill notifications
 *   feed.on('trade', (trade) => console.log('Trade:', trade));
 *   feed.on('fill', (fill) => console.log('My order filled:', fill));
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

// WebSocket channel types
type KalshiChannel = 'ticker' | 'orderbook_delta' | 'trade' | 'fill';

// Trade event from WebSocket
export interface KalshiTradeEvent {
  platform: 'kalshi';
  marketId: string;
  tradeId: string;
  side: 'yes' | 'no';
  price: number;
  count: number;
  takerSide: 'yes' | 'no';
  timestamp: number;
}

// Orderbook snapshot event from WebSocket (received before deltas)
export interface KalshiOrderbookSnapshot {
  platform: 'kalshi';
  marketId: string;
  sid: number;  // Subscription ID
  seq: number;  // Sequence number (always 1 for snapshot)
  yes: Array<[number, number]>; // [price, qty] pairs
  no: Array<[number, number]>;  // [price, qty] pairs
  timestamp: number;
}

// Orderbook delta event from WebSocket
export interface KalshiOrderbookDelta {
  platform: 'kalshi';
  marketId: string;
  sid: number;  // Subscription ID
  seq: number;  // Sequence number for ordering/gap detection
  side: 'yes' | 'no';
  price: number;
  delta: number; // Positive = add, negative = remove
  clientOrderId?: string; // Present if YOUR order caused this change
  timestamp: number;
}

// Fill event from WebSocket (when your order fills)
export interface KalshiFillEvent {
  platform: 'kalshi';
  marketId: string;
  orderId: string;
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  count: number;
  price: number;
  isTaker: boolean;
  timestamp: number;
}

export interface KalshiFeed extends EventEmitter {
  connect: () => Promise<void>;
  disconnect: () => void;
  searchMarkets: (query: string) => Promise<Market[]>;
  getMarket: (ticker: string) => Promise<Market | null>;
  getOrderbook: (ticker: string) => Promise<Orderbook | null>;
  getRealtimeOrderbook: (ticker: string) => Orderbook | null;
  getEvents: (params?: { status?: string; limit?: number; category?: string }) => Promise<KalshiEventResult[]>;
  getEvent: (eventTicker: string) => Promise<KalshiEventResult | null>;
  subscribeToMarket: (ticker: string, channels?: KalshiChannel[]) => void;
  unsubscribeFromMarket: (ticker: string, channels?: KalshiChannel[]) => void;
  subscribeToFills: () => void;
  unsubscribeFromFills: () => void;
}

// Export channel type for external use
export type { KalshiChannel };

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

  // Track which channels each ticker is subscribed to
  const tickerChannels = new Map<string, Set<KalshiChannel>>();
  let subscribedToFills = false;

  // In-memory orderbook state for delta updates
  const orderbookState = new Map<string, {
    yes: Map<number, number>; // price -> size
    no: Map<number, number>;
  }>();

  // Subscription ID tracking (ticker -> sid)
  const subscriptionIds = new Map<string, number>();

  // Sequence number tracking for gap detection (sid -> last seq)
  const lastSeqBySid = new Map<number, number>();

  // Last update timestamp for staleness detection (ticker -> timestamp)
  const orderbookLastUpdate = new Map<string, number>();
  const ORDERBOOK_STALE_THRESHOLD_MS = 30000; // 30 seconds

  function subscribeWs(ticker: string, channels: KalshiChannel[] = ['ticker']): void {
    sendWsMessage({
      id: wsRequestId++,
      cmd: 'subscribe',
      params: {
        channels,
        market_ticker: ticker,
      },
    });

    // Track subscribed channels
    let tickerSet = tickerChannels.get(ticker);
    if (!tickerSet) {
      tickerSet = new Set();
      tickerChannels.set(ticker, tickerSet);
    }
    for (const ch of channels) tickerSet.add(ch);

    // Initialize orderbook state if subscribing to orderbook_delta
    if (channels.includes('orderbook_delta') && !orderbookState.has(ticker)) {
      orderbookState.set(ticker, { yes: new Map(), no: new Map() });
    }
  }

  function unsubscribeWs(ticker: string, channels: KalshiChannel[] = ['ticker']): void {
    sendWsMessage({
      id: wsRequestId++,
      cmd: 'unsubscribe',
      params: {
        channels,
        market_ticker: ticker,
      },
    });

    // Remove from tracking
    const tickerSet = tickerChannels.get(ticker);
    if (tickerSet) {
      for (const ch of channels) tickerSet.delete(ch);
      if (tickerSet.size === 0) {
        tickerChannels.delete(ticker);
        orderbookState.delete(ticker);
      }
    }
  }

  function subscribeToFillsWs(): void {
    if (subscribedToFills) return;
    sendWsMessage({
      id: wsRequestId++,
      cmd: 'subscribe',
      params: {
        channels: ['fill'],
      },
    });
    subscribedToFills = true;
  }

  function unsubscribeFromFillsWs(): void {
    if (!subscribedToFills) return;
    sendWsMessage({
      id: wsRequestId++,
      cmd: 'unsubscribe',
      params: {
        channels: ['fill'],
      },
    });
    subscribedToFills = false;
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

    // Build headers fresh for each connection attempt (timestamp-based auth)
    const headers = buildKalshiHeadersForUrl(apiKeyAuth, 'GET', WS_URL);
    logger.debug({ timestamp: headers['KALSHI-ACCESS-TIMESTAMP'] }, 'Kalshi: Creating WebSocket with fresh headers');
    ws = new WebSocket(WS_URL, { headers });

    ws.on('open', () => {
      wsConnected = true;
      wsReconnectAttempt = 0;
      logger.info('Kalshi: WebSocket connected');

      // Resubscribe to all tickers with their channels
      for (const [ticker, channels] of tickerChannels) {
        if (channels.size > 0) {
          subscribeWs(ticker, Array.from(channels));
        }
      }

      // Resubscribe to fills if enabled
      if (subscribedToFills) {
        subscribedToFills = false; // Reset so subscribeToFillsWs will send
        subscribeToFillsWs();
      }
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as {
          type?: string;
          sid?: number;  // Subscription ID
          seq?: number;  // Sequence number
          msg?: Record<string, unknown>;
          // Legacy format
          data?: Record<string, unknown>;
        };

        // Handle different message types
        const msgData = message.msg || message.data;
        const sid = message.sid;
        const seq = message.seq;

        switch (message.type) {
          case 'ticker': {
            if (msgData) handleTickerMessage(msgData);
            break;
          }
          case 'orderbook_snapshot': {
            if (msgData) handleOrderbookSnapshot(msgData, sid, seq);
            break;
          }
          case 'orderbook_delta': {
            if (msgData) handleOrderbookDelta(msgData, sid, seq);
            break;
          }
          case 'trade': {
            if (msgData) handleTradeMessage(msgData);
            break;
          }
          case 'fill': {
            if (msgData) handleFillMessage(msgData);
            break;
          }
          case 'subscribed': {
            // Store subscription ID for seq tracking
            if (msgData && sid) {
              const ticker = (msgData.market_ticker || msgData.market_id) as string;
              if (ticker) {
                subscriptionIds.set(ticker, sid);
                logger.debug({ ticker, sid }, 'Kalshi: Subscription confirmed');
              }
            }
            break;
          }
          case 'unsubscribed':
            break;
          case 'error': {
            const code = msgData?.code;
            const errorMsg = msgData?.msg || msgData?.message;
            logger.error({ code, errorMsg }, 'Kalshi: WebSocket error message');
            break;
          }
          default:
            // Unknown message type
            break;
        }
      } catch (error) {
        logger.warn({ error }, 'Kalshi: Failed to parse WebSocket message');
      }
    });

    function handleTickerMessage(msgData: Record<string, unknown>): void {
      const ticker = msgData.market_ticker as string | undefined;
      if (!ticker) return;

      const yesBid = normalizePrice(msgData.yes_bid);
      const yesAsk = normalizePrice(msgData.yes_ask);
      const lastPrice = normalizePrice(msgData.last_price);

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
    }

    function handleOrderbookSnapshot(msgData: Record<string, unknown>, sid?: number, seq?: number): void {
      // market_id is used in orderbook messages, not market_ticker
      const ticker = (msgData.market_id || msgData.market_ticker) as string | undefined;
      if (!ticker) return;

      // Parse yes and no sides from snapshot
      const yesRaw = msgData.yes as Array<[number, number]> | undefined;
      const noRaw = msgData.no as Array<[number, number]> | undefined;

      // Initialize or reset orderbook state
      const state = orderbookState.get(ticker) || { yes: new Map(), no: new Map() };
      state.yes.clear();
      state.no.clear();

      const yesLevels: Array<[number, number]> = [];
      const noLevels: Array<[number, number]> = [];

      if (Array.isArray(yesRaw)) {
        for (const [price, qty] of yesRaw) {
          const normPrice = normalizePrice(price);
          if (normPrice !== null && qty > 0) {
            state.yes.set(normPrice, qty);
            yesLevels.push([normPrice, qty]);
          }
        }
      }

      if (Array.isArray(noRaw)) {
        for (const [price, qty] of noRaw) {
          const normPrice = normalizePrice(price);
          if (normPrice !== null && qty > 0) {
            state.no.set(normPrice, qty);
            noLevels.push([normPrice, qty]);
          }
        }
      }

      orderbookState.set(ticker, state);

      // Track sequence number (snapshot is always seq=1)
      if (sid !== undefined && seq !== undefined) {
        lastSeqBySid.set(sid, seq);
      }

      // Track last update time for staleness detection
      orderbookLastUpdate.set(ticker, Date.now());
      freshnessTracker.recordMessage('kalshi', ticker);

      const snapshotEvent: KalshiOrderbookSnapshot = {
        platform: 'kalshi',
        marketId: ticker,
        sid: sid ?? 0,
        seq: seq ?? 1,
        yes: yesLevels,
        no: noLevels,
        timestamp: Date.now(),
      };
      emitter.emit('orderbook_snapshot', snapshotEvent);
      logger.debug({ ticker, yesLevels: yesLevels.length, noLevels: noLevels.length }, 'Kalshi: Orderbook snapshot received');
    }

    function handleOrderbookDelta(msgData: Record<string, unknown>, sid?: number, seq?: number): void {
      // market_id is used in orderbook messages, not market_ticker
      const ticker = (msgData.market_id || msgData.market_ticker) as string | undefined;
      if (!ticker) return;

      // Validate side is exactly 'yes' or 'no' (case-sensitive)
      const sideRaw = msgData.side as string | undefined;
      const side: 'yes' | 'no' | undefined = sideRaw === 'yes' || sideRaw === 'no' ? sideRaw : undefined;
      const price = normalizePrice(msgData.price);
      const delta = typeof msgData.delta === 'number' ? msgData.delta : 0;
      const clientOrderId = msgData.client_order_id as string | undefined;

      if (!side || price === null) return;

      // Check for sequence gaps and trigger recovery
      if (sid !== undefined && seq !== undefined) {
        const lastSeq = lastSeqBySid.get(sid);
        if (lastSeq !== undefined && seq !== lastSeq + 1) {
          logger.warn({ ticker, sid, expectedSeq: lastSeq + 1, actualSeq: seq }, 'Kalshi: Sequence gap detected, resubscribing');
          // Trigger re-subscription to get fresh snapshot
          const channels = tickerChannels.get(ticker);
          if (channels?.has('orderbook_delta')) {
            // Unsubscribe and resubscribe to get fresh snapshot
            unsubscribeWs(ticker, ['orderbook_delta']);
            // Clear stale orderbook state
            const state = orderbookState.get(ticker);
            if (state) {
              state.yes.clear();
              state.no.clear();
            }
            // Resubscribe after brief delay to allow server to process unsubscribe
            setTimeout(() => {
              if (wsConnected) {
                subscribeWs(ticker, ['orderbook_delta']);
              }
            }, 100);
          }
          return; // Skip this delta, wait for fresh snapshot
        }
        lastSeqBySid.set(sid, seq);
      }

      // Update in-memory orderbook state
      const state = orderbookState.get(ticker);
      if (state) {
        const sideBook = side === 'yes' ? state.yes : state.no;
        const currentSize = sideBook.get(price) || 0;
        const newSize = currentSize + delta;
        if (newSize <= 0) {
          sideBook.delete(price);
        } else {
          sideBook.set(price, newSize);
        }
      }

      // Track last update time for staleness detection
      orderbookLastUpdate.set(ticker, Date.now());
      freshnessTracker.recordMessage('kalshi', ticker);

      const deltaEvent: KalshiOrderbookDelta = {
        platform: 'kalshi',
        marketId: ticker,
        sid: sid ?? 0,
        seq: seq ?? 0,
        side,
        price,
        delta,
        clientOrderId,
        timestamp: Date.now(),
      };
      emitter.emit('orderbook_delta', deltaEvent);
    }

    function handleTradeMessage(msgData: Record<string, unknown>): void {
      const ticker = (msgData.market_ticker || msgData.market_id) as string | undefined;
      if (!ticker) return;

      const tradeId = String(msgData.trade_id || msgData.id || Date.now());
      // Validate side is exactly 'yes' or 'no'
      const sideRaw = msgData.side as string | undefined;
      const side: 'yes' | 'no' | undefined = sideRaw === 'yes' || sideRaw === 'no' ? sideRaw : undefined;
      const price = normalizePrice(msgData.yes_price ?? msgData.price);
      const count = typeof msgData.count === 'number' && Number.isFinite(msgData.count) ? msgData.count : 1;
      // Validate taker_side, fallback to side (not arbitrary 'yes')
      const takerRaw = msgData.taker_side as string | undefined;
      const takerSide: 'yes' | 'no' = takerRaw === 'yes' || takerRaw === 'no' ? takerRaw : (side || 'yes');

      if (!side || price === null) return;

      freshnessTracker.recordMessage('kalshi', ticker);

      const tradeEvent: KalshiTradeEvent = {
        platform: 'kalshi',
        marketId: ticker,
        tradeId,
        side,
        price,
        count,
        takerSide,
        timestamp: Date.now(),
      };
      emitter.emit('trade', tradeEvent);

      // Also update price from trades
      emitTickerPrice(ticker, price);
    }

    function handleFillMessage(msgData: Record<string, unknown>): void {
      const ticker = (msgData.market_ticker || msgData.market_id) as string | undefined;
      const orderId = String(msgData.order_id || '');
      // Validate side
      const sideRaw = msgData.side as string | undefined;
      const side: 'yes' | 'no' | undefined = sideRaw === 'yes' || sideRaw === 'no' ? sideRaw : undefined;
      // Validate action
      const actionRaw = msgData.action as string | undefined;
      const action: 'buy' | 'sell' | undefined = actionRaw === 'buy' || actionRaw === 'sell' ? actionRaw : undefined;
      const count = typeof msgData.count === 'number' && Number.isFinite(msgData.count) ? msgData.count : 0;
      const price = normalizePrice(msgData.yes_price ?? msgData.no_price ?? msgData.price);
      const isTaker = msgData.is_taker === true;

      if (!ticker || !side || !action || price === null) return;

      const fillEvent: KalshiFillEvent = {
        platform: 'kalshi',
        marketId: ticker,
        orderId,
        side,
        action,
        count,
        price,
        isTaker,
        timestamp: Date.now(),
      };
      emitter.emit('fill', fillEvent);
      logger.info({ fillEvent }, 'Kalshi: Order filled');
    }

    // Handle ping frames from Kalshi (sent every 10s with body "heartbeat")
    // ws library auto-responds with pong, but we track for monitoring
    ws.on('ping', (data) => {
      const body = data.toString();
      if (body === 'heartbeat') {
        logger.trace('Kalshi: Received heartbeat ping');
      }
      // ws library auto-sends pong response
    });

    ws.on('pong', () => {
      logger.trace('Kalshi: Received pong');
    });

    ws.on('error', (error) => {
      logger.warn({ error }, 'Kalshi: WebSocket error');
    });

    ws.on('close', (code, reason) => {
      wsConnected = false;
      ws = null;
      logger.warn({ code, reason: reason.toString() }, 'Kalshi: WebSocket disconnected');
      scheduleWsReconnect();
    });
  }

  // Clean up all state for a ticker (memory leak prevention)
  function cleanupTickerState(ticker: string): void {
    subscribedTickers.delete(ticker);
    priceCache.delete(ticker);
    tickerChannels.delete(ticker);
    orderbookState.delete(ticker);
    orderbookLastUpdate.delete(ticker);
    freshnessTracker.untrack('kalshi', ticker);

    // Clean up subscription ID and sequence tracking
    const sid = subscriptionIds.get(ticker);
    if (sid !== undefined) {
      lastSeqBySid.delete(sid);
      subscriptionIds.delete(ticker);
    }
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

      // Validate price is in valid range [0, 1]
      if (price < 0 || price > 1) {
        logger.warn({ rawPrice: entry[0], normalizedPrice: price }, 'Kalshi: Invalid orderbook price out of range [0,1], skipping');
        continue;
      }

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

    getRealtimeOrderbook(ticker: string): Orderbook | null {
      const state = orderbookState.get(ticker);
      if (!state) return null;

      // Check for stale orderbook (no updates in threshold time)
      const lastUpdate = orderbookLastUpdate.get(ticker);
      if (lastUpdate && Date.now() - lastUpdate > ORDERBOOK_STALE_THRESHOLD_MS) {
        logger.warn({ ticker, lastUpdate, ageMs: Date.now() - lastUpdate }, 'Kalshi: Orderbook is stale');
        // Return null to indicate stale data, caller should fetch fresh via REST
        return null;
      }

      // Convert Map to sorted arrays
      const bids: Array<[number, number]> = Array.from(state.yes.entries())
        .filter(([, size]) => size > 0 && Number.isFinite(size))
        .sort((a, b) => b[0] - a[0]); // Descending by price

      // Asks derived from NO side (price = 1 - no_price)
      // Validate price bounds before conversion
      const asks: Array<[number, number]> = Array.from(state.no.entries())
        .filter(([price, size]) => price >= 0 && price <= 1 && size > 0 && Number.isFinite(size))
        .map(([price, size]): [number, number] => [Number((1 - price).toFixed(4)), size])
        .filter(([price]) => price > 0 && price < 1)
        .sort((a, b) => a[0] - b[0]); // Ascending by price

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
    },

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

    subscribeToMarket(ticker: string, channels: KalshiChannel[] = ['ticker']): void {
      subscribedTickers.add(ticker);

      // Ensure channels are tracked
      let tickerSet = tickerChannels.get(ticker);
      if (!tickerSet) {
        tickerSet = new Set();
        tickerChannels.set(ticker, tickerSet);
      }
      for (const ch of channels) tickerSet.add(ch);

      // Initialize orderbook state if subscribing to orderbook_delta
      if (channels.includes('orderbook_delta') && !orderbookState.has(ticker)) {
        orderbookState.set(ticker, { yes: new Map(), no: new Map() });

        // Fetch initial orderbook snapshot to seed the state
        getOrderbook(ticker).then(ob => {
          if (!ob) return;
          const state = orderbookState.get(ticker);
          if (!state) return;

          // Populate YES side (bids)
          for (const [price, size] of ob.bids) {
            state.yes.set(price, size);
          }
          // Populate NO side (asks are 1-no_price, so reverse)
          for (const [askPrice, size] of ob.asks) {
            const noPrice = Number((1 - askPrice).toFixed(4));
            state.no.set(noPrice, size);
          }
          logger.debug({ ticker, yesBids: state.yes.size, noAsks: state.no.size }, 'Kalshi: Initialized orderbook state');
        }).catch(err => {
          logger.warn({ err, ticker }, 'Kalshi: Failed to fetch initial orderbook');
        });
      }

      if (wsConnected) {
        subscribeWs(ticker, channels);
      }

      // Start freshness tracking with polling fallback
      freshnessTracker.track('kalshi', ticker, async () => {
        const market = await getMarket(ticker);
        if (market && market.outcomes[0]) {
          emitTickerPrice(ticker, market.outcomes[0].price);
        }
      });
    },

    unsubscribeFromMarket(ticker: string, channels?: KalshiChannel[]): void {
      const tickerSet = tickerChannels.get(ticker);

      if (channels) {
        // Unsubscribe from specific channels
        if (tickerSet) {
          for (const ch of channels) tickerSet.delete(ch);
        }
        if (wsConnected) {
          unsubscribeWs(ticker, channels);
        }
        // Only fully unsubscribe if no channels left
        if (!tickerSet || tickerSet.size === 0) {
          cleanupTickerState(ticker);
        }
      } else {
        // Unsubscribe from all channels
        const allChannels = tickerSet ? Array.from(tickerSet) : ['ticker'];
        cleanupTickerState(ticker);
        if (wsConnected) {
          unsubscribeWs(ticker, allChannels as KalshiChannel[]);
        }
      }
    },

    subscribeToFills(): void {
      if (wsConnected) {
        subscribeToFillsWs();
      } else {
        // Mark as pending, will subscribe on connect
        subscribedToFills = true;
      }
      logger.info('Kalshi: Subscribed to fills');
    },

    unsubscribeFromFills(): void {
      if (wsConnected) {
        unsubscribeFromFillsWs();
      }
      subscribedToFills = false;
      logger.info('Kalshi: Unsubscribed from fills');
    },
  }) as KalshiFeed;
}
