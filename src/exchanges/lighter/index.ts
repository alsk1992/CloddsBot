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
import { spawn } from 'child_process';
import path from 'path';
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
  /** L1 identity — informational only; not sufficient on its own to trade (see below). */
  walletAddress: string;
  privateKey: string;
  /**
   * L2 trading credentials. Lighter is a zk-rollup: every order/cancel is an L2
   * transaction signed with a Lighter-native keypair (api_private_key), which is a
   * *different* key from the L1 wallet above — it's registered on-chain once via a
   * one-time setup flow (not implemented here; see scripts/lighter-bridge/bridge.py's
   * header). All three are required to place or cancel an order.
   */
  accountIndex?: number;
  apiKeyIndex?: number;
  apiPrivateKey?: string;
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
  /** client_order_index — pass this back into cancelOrder/modify, not order_id. */
  orderId: string;
  market: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  status: string;
  price: string;
  size: string;
  filled: string;
  remaining: string;
  reduceOnly: boolean;
}

export interface LighterPosition {
  market: string;
  side: 'LONG' | 'SHORT';
  size: string;
  entryPrice: string;
  unrealizedPnl: string;
  realizedPnl: string;
  liquidationPrice: string;
  marginMode: 'cross' | 'isolated';
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
  /** client_order_index — pass this to cancelOrder to reference this order later. */
  orderId?: string;
  /** L2 transaction hash, for block-explorer reference. Not usable as a cancel target. */
  txHash?: string;
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
  }
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

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
// PYTHON BRIDGE (L2 transaction signing)
// =============================================================================

/**
 * Lighter's L2 transactions are signed by a native binary the official SDK loads via
 * ctypes (compiled from github.com/elliottech/lighter-go) — there's no published spec
 * to reimplement in TypeScript, and Lighter's own official AI-agent kit
 * (elliottech/lighter-agent-kit, pushed the same day this was written) works the exact
 * same way: shell out to Python running the real SDK, not a reimplementation. This
 * mirrors src/evm/fast-broadcast.ts's Rust-subprocess pattern — same "call out to a
 * real, verified implementation" shape, different language because Python (not Rust)
 * is what the official signer binary is actually distributed for.
 */
function resolveBridgeScript(): string {
  return process.env.LIGHTER_BRIDGE_SCRIPT
    || path.join(__dirname, '..', '..', '..', 'scripts', 'lighter-bridge', 'bridge.py');
}

function resolvePythonBin(): string {
  return process.env.LIGHTER_PYTHON_BIN || 'python3';
}

interface LighterBridgeError {
  error: string;
}

async function callLighterBridge<T>(
  config: LighterConfig,
  action: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  if (config.accountIndex == null || config.apiKeyIndex == null || !config.apiPrivateKey) {
    throw new Error(
      'Lighter: accountIndex, apiKeyIndex, and apiPrivateKey are required for trading calls ' +
      '(these are L2 credentials, separate from the L1 wallet — see LighterConfig)'
    );
  }

  const request = {
    action,
    url: API_URL,
    account_index: config.accountIndex,
    api_key_index: config.apiKeyIndex,
    api_private_key: config.apiPrivateKey,
    ...params,
  };

  return new Promise<T>((resolve, reject) => {
    const child = spawn(resolvePythonBin(), [resolveBridgeScript()], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    child.on('error', (err) => {
      reject(new Error(`Lighter bridge failed to start (${resolvePythonBin()} ${resolveBridgeScript()}): ${err.message}`));
    });

    child.on('close', () => {
      let parsed: T | LighterBridgeError;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        reject(new Error(`Lighter bridge produced no valid JSON. stderr: ${stderr.trim() || '(empty)'}`));
        return;
      }

      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        reject(new Error((parsed as LighterBridgeError).error));
        return;
      }

      resolve(parsed as T);
    });

    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}

let clientOrderIndexCounter = 0;
let lastClientOrderIndexMs = 0;

/** Monotonic per-process order index — same timestamp+counter shape as
 * polymarket-order-signer.ts's generateNonce(), for the same reason (uniqueness even
 * when multiple orders are placed within the same millisecond). */
function generateClientOrderIndex(): number {
  const now = Date.now();
  if (now === lastClientOrderIndexMs) {
    clientOrderIndexCounter++;
  } else {
    clientOrderIndexCounter = 0;
    lastClientOrderIndexMs = now;
  }
  return now * 1000 + clientOrderIndexCounter;
}

function toScaledAmount(humanValue: number, decimals: number): number {
  return Math.round(humanValue * Math.pow(10, decimals));
}

// =============================================================================
// PUBLIC API — ACCOUNT (Auth Required)
// =============================================================================

interface RawLighterAsset {
  symbol: string;
  balance: string;
  locked_balance: string;
}

interface RawLighterPosition {
  market_id: number;
  symbol: string;
  sign: number; // 1 = long, -1 = short
  position: string;
  avg_entry_price: string;
  unrealized_pnl: string;
  realized_pnl: string;
  liquidation_price: string;
  margin_mode: number; // 0 = cross, 1 = isolated
}

interface RawLighterAccount {
  index: number;
  positions?: RawLighterPosition[];
  assets?: RawLighterAsset[];
}

export async function getBalance(config: LighterConfig): Promise<LighterBalance[]> {
  const data = await callLighterBridge<{ success: true; accounts: RawLighterAccount[] }>(
    config,
    'get_account'
  );
  const assets = data.accounts[0]?.assets || [];
  return assets.map((a): LighterBalance => {
    const total = parseFloat(a.balance) || 0;
    const locked = parseFloat(a.locked_balance) || 0;
    return {
      token: a.symbol,
      total: a.balance,
      available: (total - locked).toString(),
      inOrders: a.locked_balance,
    };
  });
}

export async function getPositions(config: LighterConfig): Promise<LighterPosition[]> {
  const data = await callLighterBridge<{ success: true; accounts: RawLighterAccount[] }>(
    config,
    'get_account'
  );
  const positions = data.accounts[0]?.positions || [];
  return positions
    .filter((p) => parseFloat(p.position) !== 0)
    .map((p): LighterPosition => ({
      market: p.symbol,
      side: p.sign >= 0 ? 'LONG' : 'SHORT',
      size: p.position,
      entryPrice: p.avg_entry_price,
      unrealizedPnl: p.unrealized_pnl,
      realizedPnl: p.realized_pnl,
      liquidationPrice: p.liquidation_price,
      marginMode: p.margin_mode === 1 ? 'isolated' : 'cross',
    }));
}

interface RawLighterOrder {
  client_order_index: number;
  market_index: number;
  is_ask: boolean;
  type: string;
  status: string;
  initial_base_amount: string;
  remaining_base_amount: string;
  filled_base_amount: string;
  price: string;
  reduce_only: boolean;
}

export async function getOpenOrders(config: LighterConfig, market?: string): Promise<LighterOrder[]> {
  const marketIndex = market !== undefined ? await resolveMarketIndex(market) : undefined;
  const data = await callLighterBridge<{ success: true; orders: RawLighterOrder[] }>(
    config,
    'get_open_orders',
    marketIndex !== undefined ? { market_index: marketIndex } : {}
  );
  const markets = await getMarkets();
  return data.orders.map((o): LighterOrder => {
    const m = markets.find((mkt) => Number(mkt.id) === o.market_index);
    return {
      orderId: String(o.client_order_index),
      market: m?.name ?? String(o.market_index),
      side: o.is_ask ? 'SELL' : 'BUY',
      type: o.type === 'market' ? 'MARKET' : 'LIMIT',
      status: o.status,
      price: o.price,
      size: o.initial_base_amount,
      filled: o.filled_base_amount,
      remaining: o.remaining_base_amount,
      reduceOnly: o.reduce_only,
    };
  });
}

// =============================================================================
// PUBLIC API — TRADING (Auth Required)
// =============================================================================

interface BridgeOrderResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export async function placeOrder(
  config: LighterConfig,
  params: LighterOrderParams
): Promise<LighterOrderResult> {
  const clientOrderIndex = generateClientOrderIndex();

  if (config.dryRun) {
    logger.info({ params }, '[DRY RUN] Would place Lighter order');
    return { success: true, orderId: String(clientOrderIndex) };
  }

  try {
    const marketIndex = await resolveMarketIndex(params.market);
    const markets = await getMarkets();
    const market = markets.find((m) => Number(m.id) === marketIndex);
    if (!market) throw new Error(`Lighter: unknown market "${params.market}"`);

    const isAsk = params.side === 'SELL';
    const baseAmount = toScaledAmount(params.size, market.basePrecision);
    const orderType = params.type || (params.price !== undefined ? 'LIMIT' : 'MARKET');

    if (params.price === undefined) {
      throw new Error(
        orderType === 'MARKET'
          ? 'Lighter: market orders require `price` as the worst acceptable execution price (slippage bound) — the SDK has no unbounded market order'
          : 'Lighter: limit orders require `price`'
      );
    }

    let result: BridgeOrderResult;
    if (orderType === 'MARKET') {
      result = await callLighterBridge<BridgeOrderResult>(config, 'place_market_order', {
        market_index: marketIndex,
        client_order_index: clientOrderIndex,
        base_amount: baseAmount,
        avg_execution_price: toScaledAmount(params.price, market.quotePrecision),
        is_ask: isAsk,
      });
    } else {
      result = await callLighterBridge<BridgeOrderResult>(config, 'place_limit_order', {
        market_index: marketIndex,
        client_order_index: clientOrderIndex,
        base_amount: baseAmount,
        price: toScaledAmount(params.price, market.quotePrecision),
        is_ask: isAsk,
        reduce_only: params.reduceOnly ?? false,
        post_only: params.postOnly ?? false,
      });
    }

    if (!result.success) {
      return { success: false, error: result.error || 'Lighter order failed' };
    }
    return { success: true, orderId: String(clientOrderIndex), txHash: result.txHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, params }, 'Lighter order failed');
    return { success: false, error: message };
  }
}

/**
 * Cancelling needs the order's market as well as its index — the CLI/skill layer
 * only takes an orderId (client_order_index) for UX reasons, so this looks the order
 * up across every market first via getOpenOrders(), same round-trip cost as before
 * (getOpenOrders was already what cancelAllOrders did per-order).
 */
export async function cancelOrder(
  config: LighterConfig,
  orderId: string
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ orderId }, '[DRY RUN] Would cancel Lighter order');
    return { success: true };
  }

  try {
    const openOrders = await getOpenOrders(config);
    const order = openOrders.find((o) => o.orderId === orderId);
    if (!order) {
      return { success: false, error: `Lighter: order ${orderId} not found among open orders` };
    }
    const marketIndex = await resolveMarketIndex(order.market);

    const result = await callLighterBridge<BridgeOrderResult>(config, 'cancel_order', {
      market_index: marketIndex,
      order_index: Number(orderId),
    });
    if (!result.success) {
      return { success: false, error: result.error || 'Lighter cancel failed' };
    }
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
    const marketIndex = market !== undefined ? await resolveMarketIndex(market) : undefined;
    const result = await callLighterBridge<BridgeOrderResult>(config, 'cancel_all_orders',
      marketIndex !== undefined ? { market_index: marketIndex } : {}
    );
    if (!result.success) {
      return { success: false, error: result.error || 'Lighter cancel-all failed' };
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
