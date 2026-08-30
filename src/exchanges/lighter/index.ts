/**
 * Lighter — zk-rollup orderbook exchange (mainnet.zklighter.elliot.ai)
 *
 * Market-data path (getMarkets/getOrderbook/subscribeOrderbook) is verified
 * against the live API. Account/trading endpoints below were left as they
 * were found — Lighter's real trading flow requires client-side L2 tx
 * signing (see apidocs.lighter.xyz/docs/trading), not a bearer-token REST
 * call, so those functions are almost certainly still wrong. Not fixed here
 * since it's an execution/signing concern, out of scope for market data.
 *
 * @see https://apidocs.lighter.xyz
 */

import { WebSocket } from 'ws';
import { logger } from '../../utils/logger';

// =============================================================================
// CONSTANTS
// =============================================================================

const API_URL = 'https://mainnet.zklighter.elliot.ai';
const WS_URL = 'wss://mainnet.zklighter.elliot.ai/stream?readonly=true';
const WS_ORIGIN = 'https://app.lighter.xyz';
const WS_KEEPALIVE_MS = 60_000;
const WS_RECONNECT_DELAY_MS = 2_000;

// =============================================================================
// TYPES
// =============================================================================

export interface LighterConfig {
  apiKey?: string;
  walletAddress: string;
  privateKey: string;
  dryRun?: boolean;
}

export interface LighterMarket {
  id: string;
  name: string;
  baseToken: string;
  quoteToken: string;
  basePrecision: number;
  quotePrecision: number;
  minOrderSize: string;
  status: string;
  /** 'spot' markets are directly comparable to spot DEX quotes; 'perp' carries funding/basis risk. */
  marketType: 'spot' | 'perp';
}

export interface LighterOrderbookLevel {
  price: number;
  size: number;
}

export interface LighterOrderbook {
  market: string;
  bids: LighterOrderbookLevel[];
  asks: LighterOrderbookLevel[];
  timestamp: number;
}

export interface LighterOrder {
  orderId: string;
  market: string;
  side: 'BUY' | 'SELL';
  price: string;
  size: string;
  filled: string;
  status: string;
  timestamp: number;
}

export interface LighterPosition {
  market: string;
  side: 'LONG' | 'SHORT';
  size: string;
  entryPrice: string;
  markPrice: string;
  unrealizedPnl: string;
  leverage: string;
  liquidationPrice: string;
}

export interface LighterBalance {
  token: string;
  total: string;
  available: string;
  inOrders: string;
}

export interface LighterOrderParams {
  market: string;
  side: 'BUY' | 'SELL';
  price?: number;
  size: number;
  type?: 'LIMIT' | 'MARKET';
  reduceOnly?: boolean;
  postOnly?: boolean;
}

export interface LighterOrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

// =============================================================================
// HTTP HELPER
// =============================================================================

async function httpRequest<T>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    apiKey?: string;
  }
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options?.apiKey) {
    headers['X-API-Key'] = options.apiKey;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options?.method || (options?.body ? 'POST' : 'GET'),
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Lighter API error: ${response.status} ${text}`);
  }

  return response.json() as Promise<T>;
}

// =============================================================================
// PUBLIC API — MARKET DATA (No Auth)
// =============================================================================

interface RawOrderBookEntry {
  symbol: string;
  market_id: number;
  market_type: string;
  status: string;
  min_base_amount: string;
  supported_size_decimals: number;
  supported_price_decimals: number;
}

let marketsCache: { fetchedAt: number; markets: LighterMarket[] } | null = null;
const MARKETS_CACHE_TTL_MS = 60_000;

export async function getMarkets(): Promise<LighterMarket[]> {
  if (marketsCache && Date.now() - marketsCache.fetchedAt < MARKETS_CACHE_TTL_MS) {
    return marketsCache.markets;
  }

  const data = await httpRequest<{ code: number; order_books: RawOrderBookEntry[] }>('/api/v1/orderBooks');
  const markets = (data.order_books || []).map((m): LighterMarket => {
    const [baseToken, quoteToken] = m.symbol.split('/');
    return {
      id: String(m.market_id),
      name: m.symbol,
      baseToken: baseToken || m.symbol,
      quoteToken: quoteToken || 'USDC',
      basePrecision: m.supported_size_decimals,
      quotePrecision: m.supported_price_decimals,
      minOrderSize: m.min_base_amount,
      status: m.status,
      marketType: m.market_type === 'perp' ? 'perp' : 'spot',
    };
  });

  marketsCache = { fetchedAt: Date.now(), markets };
  return markets;
}

async function resolveMarketIndex(market: string): Promise<number> {
  const asNumber = Number(market);
  if (Number.isFinite(asNumber) && Number.isInteger(asNumber)) return asNumber;

  const markets = await getMarkets();
  const target = market.trim().toLowerCase();
  const match = markets.find(
    (m) => m.id.toLowerCase() === target || m.name.toLowerCase() === target
  );
  if (!match) throw new Error(`Lighter: unknown market "${market}"`);
  return Number(match.id);
}

/**
 * One-shot orderbook fetch. There is no plain REST depth endpoint on the
 * real API — this opens a short-lived websocket subscription, takes the
 * initial full snapshot, and closes. For repeated/live reads use
 * subscribeOrderbook instead, which keeps one connection open and applies
 * incremental diffs rather than re-snapshotting per call.
 */
export async function getOrderbook(market: string, depth = 20, timeoutMs = 8_000): Promise<LighterOrderbook> {
  const marketIndex = await resolveMarketIndex(market);

  return new Promise<LighterOrderbook>((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { Origin: WS_ORIGIN } });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Lighter: orderbook snapshot for market ${marketIndex} timed out`));
    }, timeoutMs);

    const finish = (result: LighterOrderbook | Error) => {
      clearTimeout(timer);
      ws.removeAllListeners();
      ws.terminate();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', channel: `order_book/${marketIndex}` }));
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type !== 'subscribed/order_book' || !msg.order_book) return;

        const bids = (msg.order_book.bids || [])
          .map((l: { price: string; size: string }) => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
          .sort((a: LighterOrderbookLevel, b: LighterOrderbookLevel) => b.price - a.price)
          .slice(0, depth);
        const asks = (msg.order_book.asks || [])
          .map((l: { price: string; size: string }) => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
          .sort((a: LighterOrderbookLevel, b: LighterOrderbookLevel) => a.price - b.price)
          .slice(0, depth);

        finish({ market: String(marketIndex), bids, asks, timestamp: Date.now() });
      } catch {
        // ignore malformed frames, let the timeout handle persistent failure
      }
    });

    ws.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));
  });
}

export async function getPrice(market: string): Promise<{ bid: number; ask: number; mid: number }> {
  const ob = await getOrderbook(market, 1);
  const bid = ob.bids[0]?.price ?? 0;
  const ask = ob.asks[0]?.price ?? 0;
  const mid = bid && ask ? (bid + ask) / 2 : bid || ask;
  return { bid, ask, mid };
}

// =============================================================================
// LIVE ORDERBOOK FEED — shared websocket, incremental diffs, auto-reconnect
// =============================================================================

interface ChannelState {
  bids: Map<number, number>;
  asks: Map<number, number>;
  lastNonce: number | null;
  listeners: Set<(ob: LighterOrderbook) => void>;
}

let sharedWs: WebSocket | null = null;
let sharedWsConnecting: Promise<WebSocket> | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
const channels = new Map<number, ChannelState>();

function channelKey(marketIndex: number): string {
  return `order_book:${marketIndex}`;
}

function applySnapshot(state: ChannelState, orderBook: { bids: Array<{ price: string; size: string }>; asks: Array<{ price: string; size: string }>; nonce: number }): void {
  state.bids.clear();
  state.asks.clear();
  for (const l of orderBook.bids) state.bids.set(parseFloat(l.price), parseFloat(l.size));
  for (const l of orderBook.asks) state.asks.set(parseFloat(l.price), parseFloat(l.size));
  state.lastNonce = orderBook.nonce;
}

function applyDiff(state: ChannelState, orderBook: { bids: Array<{ price: string; size: string }>; asks: Array<{ price: string; size: string }>; nonce: number; begin_nonce: number }): boolean {
  if (state.lastNonce !== null && orderBook.begin_nonce !== state.lastNonce) {
    return false; // gap detected — caller should resync
  }
  for (const l of orderBook.bids) {
    const price = parseFloat(l.price);
    const size = parseFloat(l.size);
    if (size <= 0) state.bids.delete(price);
    else state.bids.set(price, size);
  }
  for (const l of orderBook.asks) {
    const price = parseFloat(l.price);
    const size = parseFloat(l.size);
    if (size <= 0) state.asks.delete(price);
    else state.asks.set(price, size);
  }
  state.lastNonce = orderBook.nonce;
  return true;
}

function snapshotFromState(marketIndex: number, state: ChannelState): LighterOrderbook {
  const bids = [...state.bids.entries()]
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => b.price - a.price);
  const asks = [...state.asks.entries()]
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => a.price - b.price);
  return { market: String(marketIndex), bids, asks, timestamp: Date.now() };
}

function ensureSharedConnection(): Promise<WebSocket> {
  if (sharedWs && sharedWs.readyState === WebSocket.OPEN) return Promise.resolve(sharedWs);
  if (sharedWsConnecting) return sharedWsConnecting;

  sharedWsConnecting = new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { Origin: WS_ORIGIN } });

    ws.on('open', () => {
      sharedWs = ws;
      sharedWsConnecting = null;
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      keepaliveTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, WS_KEEPALIVE_MS);

      for (const marketIndex of channels.keys()) {
        ws.send(JSON.stringify({ type: 'subscribe', channel: `order_book/${marketIndex}` }));
      }
      resolve(ws);
    });

    ws.on('message', (data: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (!msg.channel || !msg.order_book) return;

      const marketIndex = parseInt(String(msg.channel).split(':')[1], 10);
      const state = channels.get(marketIndex);
      if (!state) return;

      if (msg.type === 'subscribed/order_book') {
        applySnapshot(state, msg.order_book);
      } else if (msg.type === 'update/order_book') {
        const ok = applyDiff(state, msg.order_book);
        if (!ok) {
          logger.warn({ marketIndex }, 'Lighter orderbook nonce gap — resubscribing to resync');
          ws.send(JSON.stringify({ type: 'subscribe', channel: `order_book/${marketIndex}` }));
          return;
        }
      } else {
        return;
      }

      const snapshot = snapshotFromState(marketIndex, state);
      for (const cb of state.listeners) cb(snapshot);
    });

    ws.on('close', () => {
      sharedWs = null;
      sharedWsConnecting = null;
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
      for (const state of channels.values()) state.lastNonce = null;
      if (channels.size > 0) {
        setTimeout(() => {
          if (channels.size > 0) ensureSharedConnection().catch((err) => logger.warn({ err }, 'Lighter WS reconnect failed'));
        }, WS_RECONNECT_DELAY_MS);
      }
    });

    ws.on('error', (err) => {
      logger.warn({ err }, 'Lighter WS error');
      sharedWsConnecting = null;
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });

  return sharedWsConnecting;
}

/**
 * Live, incrementally-updated orderbook feed for one market. Shares a single
 * websocket connection across all subscribed markets, applies true diffs
 * (not re-fetches), and auto-reconnects/resyncs on disconnect or nonce gaps.
 * Returns an unsubscribe function.
 */
export function subscribeOrderbook(
  market: string | number,
  onUpdate: (orderbook: LighterOrderbook) => void
): () => void {
  let unsubscribed = false;
  let marketIndex: number | null = null;

  (async () => {
    marketIndex = await resolveMarketIndex(String(market));
    if (unsubscribed || marketIndex === null) return;

    let state = channels.get(marketIndex);
    const isNewChannel = !state;
    if (!state) {
      state = { bids: new Map(), asks: new Map(), lastNonce: null, listeners: new Set() };
      channels.set(marketIndex, state);
    }
    state.listeners.add(onUpdate);

    const ws = await ensureSharedConnection();
    if (!isNewChannel && ws.readyState === WebSocket.OPEN) {
      // Connection already existed before this subscription — (re)request a snapshot for it.
      ws.send(JSON.stringify({ type: 'subscribe', channel: `order_book/${marketIndex}` }));
    }
  })().catch((err) => logger.warn({ err, market }, 'Lighter subscribeOrderbook failed'));

  return () => {
    unsubscribed = true;
    if (marketIndex === null) return;
    const state = channels.get(marketIndex);
    if (!state) return;
    state.listeners.delete(onUpdate);
    if (state.listeners.size === 0) {
      channels.delete(marketIndex);
      if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
        sharedWs.send(JSON.stringify({ type: 'unsubscribe', channel: `order_book/${marketIndex}` }));
      }
    }
  };
}

// =============================================================================
// PUBLIC API — ACCOUNT (Auth Required)
// =============================================================================

export async function getBalance(config: LighterConfig): Promise<LighterBalance[]> {
  const data = await httpRequest<{ balances: LighterBalance[] }>(
    `/api/v1/account/${config.walletAddress}/balances`,
    { apiKey: config.apiKey }
  );
  return data.balances || [];
}

export async function getPositions(config: LighterConfig): Promise<LighterPosition[]> {
  const data = await httpRequest<{ positions: LighterPosition[] }>(
    `/api/v1/account/${config.walletAddress}/positions`,
    { apiKey: config.apiKey }
  );
  return data.positions || [];
}

export async function getOpenOrders(config: LighterConfig, market?: string): Promise<LighterOrder[]> {
  const path = market
    ? `/api/v1/account/${config.walletAddress}/orders?market=${encodeURIComponent(market)}&status=open`
    : `/api/v1/account/${config.walletAddress}/orders?status=open`;
  const data = await httpRequest<{ orders: LighterOrder[] }>(path, { apiKey: config.apiKey });
  return data.orders || [];
}

// =============================================================================
// PUBLIC API — TRADING (Auth Required)
// =============================================================================

export async function placeOrder(
  config: LighterConfig,
  params: LighterOrderParams
): Promise<LighterOrderResult> {
  if (config.dryRun) {
    logger.info({ params }, '[DRY RUN] Would place Lighter order');
    return { success: true, orderId: `dry-${Date.now()}` };
  }

  try {
    const data = await httpRequest<{ orderId: string }>(
      '/api/v1/order',
      {
        method: 'POST',
        apiKey: config.apiKey,
        body: {
          wallet: config.walletAddress,
          market: params.market,
          side: params.side,
          type: params.type || (params.price ? 'LIMIT' : 'MARKET'),
          price: params.price?.toString(),
          size: params.size.toString(),
          reduceOnly: params.reduceOnly ?? false,
          postOnly: params.postOnly ?? false,
        },
      }
    );

    return { success: true, orderId: data.orderId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, params }, 'Lighter order failed');
    return { success: false, error: message };
  }
}

export async function cancelOrder(
  config: LighterConfig,
  orderId: string
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ orderId }, '[DRY RUN] Would cancel Lighter order');
    return { success: true };
  }

  try {
    await httpRequest(`/api/v1/order/${orderId}`, {
      method: 'DELETE',
      apiKey: config.apiKey,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function cancelAllOrders(
  config: LighterConfig,
  market?: string
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ market }, '[DRY RUN] Would cancel all Lighter orders');
    return { success: true };
  }

  try {
    const orders = await getOpenOrders(config, market);
    for (const order of orders) {
      await cancelOrder(config, order.orderId);
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { API_URL };
