/**
 * Execution Service - Native TypeScript order execution
 *
 * Features:
 * - Limit orders (GTC, GTD)
 * - Market orders (FOK)
 * - Maker orders (GTC with postOnly flag)
 * - Order cancellation
 * - Open orders management
 *
 * Supports: Polymarket, Kalshi
 */

import { createHmac, randomBytes } from 'crypto';
import { logger } from '../utils/logger';
import {
  buildPolymarketHeadersForUrl,
  PolymarketApiKeyAuth,
} from '../utils/polymarket-auth';
import {
  buildSignedOrder,
  buildSignedOrders,
  type PostOrderBody,
  type SignerConfig,
} from '../utils/polymarket-order-signer';
import {
  buildKalshiHeadersForUrl,
  KalshiApiKeyAuth,
} from '../utils/kalshi-auth';
import {
  buildOpinionHeaders,
  OpinionApiAuth,
} from '../utils/opinion-auth';
import * as opinion from '../exchanges/opinion';
import * as predictfun from '../exchanges/predictfun';
import {
  createUserWebSocket,
  type UserWebSocket,
  type FillEvent,
  type OrderEvent,
} from '../feeds/polymarket/user-ws';
import type { CircuitBreaker, CircuitBreakerState } from './circuit-breaker';

// =============================================================================
// TYPES
// =============================================================================

export type OrderSide = 'buy' | 'sell';
// Note: Polymarket supports GTC, GTD, FOK, FAK. POST_ONLY is achieved via postOnly boolean flag.
// FAK (Fill-And-Kill) is like IOC - partially fill what's available immediately, cancel the rest.
export type OrderType = 'GTC' | 'FOK' | 'GTD' | 'FAK';
export type OrderStatus = 'pending' | 'open' | 'filled' | 'cancelled' | 'expired' | 'rejected';

export interface OrderRequest {
  platform: 'polymarket' | 'kalshi' | 'opinion' | 'predictfun';
  marketId: string;
  tokenId?: string;  // For Polymarket
  outcome?: string;  // 'yes' | 'no' for Kalshi
  side: OrderSide;
  price: number;     // 0.01 to 0.99
  size: number;      // Number of shares/contracts
  orderType?: OrderType;
  expiration?: number; // Unix timestamp for GTD
  /** Polymarket: true for negative risk markets (crypto 15-min markets) */
  negRisk?: boolean;
  /** Polymarket: true to ensure order only adds liquidity (maker-only). Order rejected if it would take liquidity. */
  postOnly?: boolean;
  /** Maximum slippage allowed (as decimal, e.g., 0.02 = 2%) */
  maxSlippage?: number;
}

export interface SlippageProtection {
  /** Maximum slippage as decimal (default: 0.02 = 2%) */
  maxSlippage: number;
  /** Check orderbook before executing (default: true) */
  checkOrderbook: boolean;
  /** Cancel order if estimated slippage exceeds max (default: true) */
  autoCancel: boolean;
  /** Use limit orders instead of market orders (default: true) */
  useLimitOrders: boolean;
  /** Price buffer for limit orders as decimal (default: 0.01 = 1%) */
  limitPriceBuffer: number;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  filledSize?: number;
  avgFillPrice?: number;
  status?: OrderStatus;
  error?: string;
  transactionHash?: string;
}

export interface OpenOrder {
  orderId: string;
  platform: 'polymarket' | 'kalshi' | 'opinion' | 'predictfun';
  marketId: string;
  tokenId?: string;
  outcome?: string;
  side: OrderSide;
  price: number;
  originalSize: number;
  remainingSize: number;
  filledSize: number;
  orderType: OrderType;
  status: OrderStatus;
  createdAt: Date;
  expiration?: Date;
  /** Transaction hash for on-chain confirmation (Polymarket) */
  transactionHash?: string;
  /** Fill status from WebSocket: MATCHED → MINED → CONFIRMED */
  fillStatus?: 'MATCHED' | 'MINED' | 'CONFIRMED' | 'FAILED';
}

/** Real-time fill tracking for WebSocket updates */
export interface TrackedFill {
  orderId: string;
  marketId: string;
  tokenId: string;
  side: OrderSide;
  size: number;
  price: number;
  status: 'MATCHED' | 'MINED' | 'CONFIRMED' | 'FAILED';
  transactionHash?: string;
  timestamp: number;
  receivedAt: number;
}

/** Real-time order event tracking for WebSocket updates */
export interface TrackedOrder {
  orderId: string;
  marketId: string;
  tokenId: string;
  type: 'PLACEMENT' | 'UPDATE' | 'CANCELLATION';
  side: OrderSide;
  price: number;
  originalSize: number;
  sizeMatched: number;
  timestamp: number;
  receivedAt: number;
}

/** Pending settlement for resolved markets */
export interface PendingSettlement {
  marketId: string;
  conditionId: string;
  tokenId: string;
  outcome: 'yes' | 'no';
  size: number;
  /** Claimable amount in USDC (if market resolved in your favor) */
  claimable: number;
  /** Resolution status */
  resolutionStatus: 'resolved' | 'pending' | 'disputed';
  resolvedAt?: Date;
}

export interface ExecutionConfig {
  polymarket?: PolymarketApiKeyAuth & {
    privateKey?: string;  // For EIP-712 order signing
    funderAddress?: string;  // Proxy/Safe wallet address (where funds live)
    /** 0=EOA, 1=POLY_PROXY (Magic Link), 2=POLY_GNOSIS_SAFE (MetaMask/browser) */
    signatureType?: number;
  };
  kalshi?: KalshiApiKeyAuth;
  opinion?: OpinionApiAuth & {
    /** Wallet private key for trading (BNB Chain) */
    privateKey?: string;
    /** Vault/funder address */
    multiSigAddress?: string;
    /** BNB Chain RPC URL (default: https://bsc-dataseed.binance.org) */
    rpcUrl?: string;
  };
  predictfun?: {
    /** Wallet private key for trading (BNB Chain) */
    privateKey: string;
    /** Smart wallet/deposit address (optional) */
    predictAccount?: string;
    /** BNB Chain RPC URL */
    rpcUrl?: string;
    /** API key (optional) */
    apiKey?: string;
  };
  /** Max order size in USD */
  maxOrderSize?: number;
  /** Dry run mode - log but don't execute */
  dryRun?: boolean;
  /** Slippage protection settings */
  slippageProtection?: Partial<SlippageProtection>;
}

export interface ExecutionService {
  // Limit orders
  buyLimit(request: Omit<OrderRequest, 'side'>): Promise<OrderResult>;
  sellLimit(request: Omit<OrderRequest, 'side'>): Promise<OrderResult>;

  // Market orders
  marketBuy(request: Omit<OrderRequest, 'side' | 'price'>): Promise<OrderResult>;
  marketSell(request: Omit<OrderRequest, 'side' | 'price'>): Promise<OrderResult>;

  // Maker orders (GTC with postOnly flag - avoid taker fees)
  makerBuy(request: Omit<OrderRequest, 'side' | 'orderType' | 'postOnly'>): Promise<OrderResult>;
  makerSell(request: Omit<OrderRequest, 'side' | 'orderType' | 'postOnly'>): Promise<OrderResult>;

  // Slippage-protected orders (checks slippage before executing)
  protectedBuy(request: Omit<OrderRequest, 'side'>, maxSlippage?: number): Promise<OrderResult>;
  protectedSell(request: Omit<OrderRequest, 'side'>, maxSlippage?: number): Promise<OrderResult>;

  // Slippage estimation
  estimateSlippage(request: OrderRequest): Promise<{ slippage: number; expectedPrice: number }>;

  // Order management
  cancelOrder(platform: 'polymarket' | 'kalshi' | 'opinion' | 'predictfun', orderId: string): Promise<boolean>;
  cancelAllOrders(platform?: 'polymarket' | 'kalshi' | 'opinion' | 'predictfun', marketId?: string): Promise<number>;
  getOpenOrders(platform?: 'polymarket' | 'kalshi' | 'opinion' | 'predictfun'): Promise<OpenOrder[]>;
  getOrder(platform: 'polymarket' | 'kalshi' | 'opinion' | 'predictfun', orderId: string): Promise<OpenOrder | null>;

  // Batch operations (Opinion only for now)
  placeOrdersBatch(orders: Array<Omit<OrderRequest, 'orderType'>>): Promise<OrderResult[]>;
  cancelOrdersBatch(platform: 'polymarket' | 'kalshi' | 'opinion' | 'predictfun', orderIds: string[]): Promise<Array<{ orderId: string; success: boolean }>>;

  // Utilities
  estimateFill(request: OrderRequest): Promise<{ avgPrice: number; filledSize: number }>;

  // Real-time fill tracking (Polymarket WebSocket)
  /** Connect WebSocket for real-time fill notifications */
  connectFillsWebSocket(): Promise<void>;
  /** Disconnect fill notifications WebSocket */
  disconnectFillsWebSocket(): void;
  /** Check if fills WebSocket is connected */
  isFillsWebSocketConnected(): boolean;
  /** Subscribe to fill events */
  onFill(callback: (fill: TrackedFill) => void): () => void;
  /** Subscribe to order events (placement, update, cancellation) */
  onOrder(callback: (order: TrackedOrder) => void): () => void;
  /** Get all tracked fills (received via WebSocket) */
  getTrackedFills(): TrackedFill[];
  /** Get tracked fill for a specific order */
  getTrackedFill(orderId: string): TrackedFill | undefined;
  /** Clear old tracked fills (older than specified ms, default 1 hour) */
  clearOldFills(maxAgeMs?: number): number;
  /** Wait for a fill to reach CONFIRMED status (or timeout) */
  waitForFill(orderId: string, timeoutMs?: number): Promise<TrackedFill | null>;

  // Polymarket Order Heartbeat (required to keep orders alive)
  /** Start heartbeat - returns heartbeat ID. Call every <10s or orders get cancelled. */
  startHeartbeat(): Promise<string>;
  /** Send heartbeat with existing ID. Returns new heartbeat ID. */
  sendHeartbeat(heartbeatId: string): Promise<string>;
  /** Stop heartbeat (orders will be cancelled after 10s). */
  stopHeartbeat(): void;
  /** Check if heartbeat is active. */
  isHeartbeatActive(): boolean;

  // Polymarket Settlement
  /** Get pending settlements for resolved markets */
  getPendingSettlements(): Promise<PendingSettlement[]>;

  // Polymarket Collateral Approval
  /** Approve USDC spending for the CTF exchange (required before first trade) */
  approveUSDC(amount?: number): Promise<{ success: boolean; txHash?: string; error?: string }>;
  /** Check current USDC allowance for trading */
  getUSDCAllowance(): Promise<number>;

  // Batch Orderbook Fetching
  /** Fetch orderbooks for multiple tokens in one call */
  getOrderbooksBatch(tokenIds: string[]): Promise<Map<string, OrderbookData | null>>;

  // Circuit Breaker Integration
  /** Enable circuit breaker for order validation (blocks orders when tripped) */
  setCircuitBreaker(breaker: import('./circuit-breaker').CircuitBreaker | null): void;
  /** Get current circuit breaker state (null if not set) */
  getCircuitBreakerState(): import('./circuit-breaker').CircuitBreakerState | null;
}

// =============================================================================
// POLYMARKET EXECUTION
// =============================================================================

// API URLs (configurable for testnet)
const POLY_CLOB_URL = process.env.POLY_CLOB_URL || 'https://clob.polymarket.com';

// Exchange contract addresses (configurable via env for testnet support)
// Mainnet (default):
//   CTF: 0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E
//   NEG_RISK: 0xC5d563A36AE78145C45a50134d48A1215220f80a
// Amoy Testnet:
//   POLY_CLOB_URL=https://clob.polymarket.com (same)
//   POLY_CTF_EXCHANGE=0xdFE02Eb6733538f8Ea35D585af8DE5958AD99E40
//   POLY_NEG_RISK_CTF_EXCHANGE=0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296
const POLY_CTF_EXCHANGE = process.env.POLY_CTF_EXCHANGE || '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const POLY_NEG_RISK_CTF_EXCHANGE = process.env.POLY_NEG_RISK_CTF_EXCHANGE || '0xC5d563A36AE78145C45a50134d48A1215220f80a';

interface NegRiskResponse {
  neg_risk?: boolean;
}

/**
 * Check if a token is a negative risk market (crypto 15-min markets)
 */
export async function checkPolymarketNegRisk(tokenId: string): Promise<boolean> {
  try {
    const response = await fetch(`${POLY_CLOB_URL}/neg-risk?token_id=${tokenId}`);
    if (!response.ok) {
      return false;
    }
    const data = (await response.json()) as NegRiskResponse;
    return data.neg_risk === true;
  } catch {
    return false;
  }
}

/**
 * Get the appropriate exchange address for a market
 */
export function getPolymarketExchange(negRisk: boolean): string {
  return negRisk ? POLY_NEG_RISK_CTF_EXCHANGE : POLY_CTF_EXCHANGE;
}

// Cache for tick sizes, neg risk status, fee rates, and orderbooks
const tickSizeCache = new Map<string, { tickSize: string; cachedAt: number }>();
const negRiskCache = new Map<string, { negRisk: boolean; cachedAt: number }>();
const feeRateCache = new Map<string, { feeRateBps: number; cachedAt: number }>();
const orderbookCache = new Map<string, { data: OrderbookData; cachedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour for static data
const ORDERBOOK_CACHE_TTL_MS = 5000; // 5 seconds for orderbook (needs to be fresh)

// Nonce tracking to prevent duplicate orders
let lastNonce = Date.now();
function getNextNonce(): string {
  const now = Date.now();
  lastNonce = now > lastNonce ? now : lastNonce + 1;
  return lastNonce.toString();
}

/**
 * Get tick size for a token (from orderbook endpoint)
 * Valid tick sizes: "0.1", "0.01", "0.001", "0.0001"
 */
export async function getPolymarketTickSize(tokenId: string): Promise<string> {
  // Check cache
  const cached = tickSizeCache.get(tokenId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.tickSize;
  }

  try {
    const response = await fetch(`${POLY_CLOB_URL}/book?token_id=${tokenId}`);
    if (!response.ok) {
      return '0.01'; // Default tick size
    }
    const data = await response.json() as { tick_size?: string };
    const tickSize = data.tick_size || '0.01';
    tickSizeCache.set(tokenId, { tickSize, cachedAt: Date.now() });
    return tickSize;
  } catch {
    return '0.01';
  }
}

/**
 * Validate price against tick size
 * Returns error message if invalid, null if valid
 */
export function validatePriceTickSize(price: number, tickSize: string): string | null {
  const tick = parseFloat(tickSize);
  if (tick <= 0) return null; // Skip validation if tick size invalid

  // Check if price is a multiple of tick size (with floating point tolerance)
  const remainder = Math.abs((price * 10000) % (tick * 10000)) / 10000;
  const tolerance = tick / 100; // 1% of tick size tolerance for floating point

  if (remainder > tolerance && remainder < tick - tolerance) {
    return `Price ${price} is not a valid tick size increment. Must be multiple of ${tickSize}`;
  }
  return null;
}

/**
 * Get neg risk status with caching
 */
export async function getPolymarketNegRiskCached(tokenId: string): Promise<boolean> {
  // Check cache
  const cached = negRiskCache.get(tokenId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.negRisk;
  }

  const negRisk = await checkPolymarketNegRisk(tokenId);
  negRiskCache.set(tokenId, { negRisk, cachedAt: Date.now() });
  return negRisk;
}

/**
 * Get fee rate in basis points for a token
 * Crypto 15-min markets have higher fees due to negative risk
 */
export async function getPolymarketFeeRate(tokenId: string): Promise<number> {
  // Check cache
  const cached = feeRateCache.get(tokenId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.feeRateBps;
  }

  try {
    // Fee rate depends on neg_risk status
    // Standard markets: 0 bps maker, ~2% taker
    // Neg risk (crypto): higher fees
    const negRisk = await getPolymarketNegRiskCached(tokenId);
    // Polymarket fee formula for neg risk: shares × 0.25 × (price × (1 - price))²
    // Simplified: ~0-50 bps depending on price
    const feeRateBps = negRisk ? 25 : 0; // Approximate - actual varies by price
    feeRateCache.set(tokenId, { feeRateBps, cachedAt: Date.now() });
    return feeRateBps;
  } catch {
    return 0;
  }
}

/**
 * Get orderbook with caching (5 second TTL)
 */
export async function getPolymarketOrderbookCached(tokenId: string): Promise<OrderbookData | null> {
  // Check cache
  const cached = orderbookCache.get(tokenId);
  if (cached && Date.now() - cached.cachedAt < ORDERBOOK_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const response = await fetch(`${POLY_CLOB_URL}/book?token_id=${tokenId}`);
    if (!response.ok) return null;

    const data = await response.json() as {
      bids?: Array<{ price: string; size: string }>;
      asks?: Array<{ price: string; size: string }>;
    };

    const bids: [number, number][] = (data.bids || [])
      .map((b) => [parseFloat(b.price), parseFloat(b.size)] as [number, number])
      .sort((a, b) => b[0] - a[0]); // Highest bid first

    const asks: [number, number][] = (data.asks || [])
      .map((a) => [parseFloat(a.price), parseFloat(a.size)] as [number, number])
      .sort((a, b) => a[0] - b[0]); // Lowest ask first

    const bestBid = bids[0]?.[0] || 0;
    const bestAsk = asks[0]?.[0] || 1;
    const midPrice = (bestBid + bestAsk) / 2;

    const orderbook: OrderbookData = { bids, asks, midPrice };
    orderbookCache.set(tokenId, { data: orderbook, cachedAt: Date.now() });
    return orderbook;
  } catch {
    return null;
  }
}

/**
 * Validate post-only order won't take liquidity
 * Returns error message if order would cross the spread
 */
export async function validatePostOnly(
  tokenId: string,
  side: OrderSide,
  price: number
): Promise<string | null> {
  const orderbook = await getPolymarketOrderbookCached(tokenId);
  if (!orderbook) return null; // Can't validate, let server decide

  if (side === 'buy') {
    // Buy order: price must be < best ask to be maker-only
    const bestAsk = orderbook.asks[0]?.[0];
    if (bestAsk && price >= bestAsk) {
      return `Post-only buy at ${price} would cross spread (best ask: ${bestAsk}). Use price < ${bestAsk}`;
    }
  } else {
    // Sell order: price must be > best bid to be maker-only
    const bestBid = orderbook.bids[0]?.[0];
    if (bestBid && price <= bestBid) {
      return `Post-only sell at ${price} would cross spread (best bid: ${bestBid}). Use price > ${bestBid}`;
    }
  }

  return null;
}

/** Polymarket error codes */
type PolymarketErrorCode =
  | 'INVALID_PRICE'
  | 'INVALID_SIZE'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_TICK_SIZE'
  | 'INVALID_NONCE'
  | 'MARKET_HALTED'
  | 'ORDER_WOULD_MATCH'
  | 'UNKNOWN';

/**
 * Parse Polymarket error response into structured error
 */
function parsePolymarketError(errorMsg: string | undefined, status: number): { code: PolymarketErrorCode; message: string } {
  if (!errorMsg) {
    return { code: 'UNKNOWN', message: `HTTP ${status}` };
  }

  const msg = errorMsg.toLowerCase();

  if (msg.includes('price') && (msg.includes('invalid') || msg.includes('tick'))) {
    return { code: 'INVALID_TICK_SIZE', message: errorMsg };
  }
  if (msg.includes('balance') || msg.includes('insufficient')) {
    return { code: 'INSUFFICIENT_BALANCE', message: errorMsg };
  }
  if (msg.includes('size') && msg.includes('invalid')) {
    return { code: 'INVALID_SIZE', message: errorMsg };
  }
  if (msg.includes('nonce')) {
    return { code: 'INVALID_NONCE', message: errorMsg };
  }
  if (msg.includes('halt') || msg.includes('closed')) {
    return { code: 'MARKET_HALTED', message: errorMsg };
  }
  if (msg.includes('match') || msg.includes('cross')) {
    return { code: 'ORDER_WOULD_MATCH', message: errorMsg };
  }

  return { code: 'UNKNOWN', message: errorMsg };
}

/**
 * Get USDC balance for an address
 */
export async function getPolymarketBalance(
  auth: PolymarketApiKeyAuth,
  address?: string
): Promise<{ balance: number; allowance: number }> {
  const walletAddress = address || auth.address;
  const url = `${POLY_CLOB_URL}/balance?address=${walletAddress}`;

  const headers = buildPolymarketHeadersForUrl(auth, 'GET', url);

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json() as { balance?: string; allowance?: string };
    return {
      balance: parseFloat(data.balance || '0'),
      allowance: parseFloat(data.allowance || '0'),
    };
  } catch (error) {
    logger.error({ error, walletAddress }, 'Failed to fetch Polymarket balance');
    return { balance: 0, allowance: 0 };
  }
}

/**
 * Get positions for an address
 */
export async function getPolymarketPositions(
  auth: PolymarketApiKeyAuth,
  address?: string
): Promise<Array<{
  tokenId: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
}>> {
  const walletAddress = address || auth.address;
  const url = `${POLY_CLOB_URL}/positions?address=${walletAddress}`;

  const headers = buildPolymarketHeadersForUrl(auth, 'GET', url);

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json() as Array<{
      asset_id?: string;
      condition_id?: string;
      size?: string;
      avg_price?: string;
      cur_price?: string;
      unrealized_pnl?: string;
    }>;

    return data.map(p => ({
      tokenId: p.asset_id || '',
      conditionId: p.condition_id || '',
      size: parseFloat(p.size || '0'),
      avgPrice: parseFloat(p.avg_price || '0'),
      currentPrice: parseFloat(p.cur_price || '0'),
      unrealizedPnl: parseFloat(p.unrealized_pnl || '0'),
    }));
  } catch (error) {
    logger.error({ error, walletAddress }, 'Failed to fetch Polymarket positions');
    return [];
  }
}

/**
 * Get trade history for an address
 */
export async function getPolymarketTrades(
  auth: PolymarketApiKeyAuth,
  limit = 100
): Promise<Array<{
  id: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  timestamp: Date;
  transactionHash?: string;
}>> {
  const url = `${POLY_CLOB_URL}/trades?limit=${limit}`;
  const headers = buildPolymarketHeadersForUrl(auth, 'GET', url);

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json() as Array<{
      id?: string;
      asset_id?: string;
      side?: string;
      price?: string;
      size?: string;
      timestamp?: string;
      transaction_hash?: string;
    }>;

    return data.map(t => ({
      id: t.id || '',
      tokenId: t.asset_id || '',
      side: (t.side?.toUpperCase() || 'BUY') as 'BUY' | 'SELL',
      price: parseFloat(t.price || '0'),
      size: parseFloat(t.size || '0'),
      timestamp: new Date(t.timestamp || Date.now()),
      transactionHash: t.transaction_hash,
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to fetch Polymarket trades');
    return [];
  }
}

// =============================================================================
// ORDERBOOK FETCHING FOR SLIPPAGE CALCULATION
// =============================================================================

export interface OrderbookData {
  bids: [number, number][]; // [price, size]
  asks: [number, number][]; // [price, size]
  midPrice: number;
}

// =============================================================================
// ORDERBOOK IMBALANCE DETECTION
// =============================================================================

export type DirectionalSignal = 'bullish' | 'bearish' | 'neutral';

export interface OrderbookImbalance {
  /** Bid volume / Ask volume ratio (>1 = more bid pressure) */
  bidAskRatio: number;
  /** Normalized imbalance score from -1 (bearish) to +1 (bullish) */
  imbalanceScore: number;
  /** Volume-weighted average bid price */
  vwapBid: number;
  /** Volume-weighted average ask price */
  vwapAsk: number;
  /** Total bid volume within depth levels */
  totalBidVolume: number;
  /** Total ask volume within depth levels */
  totalAskVolume: number;
  /** Spread as decimal (e.g., 0.02 = 2 cents) */
  spread: number;
  /** Spread as percentage of mid price */
  spreadPct: number;
  /** Directional signal based on imbalance */
  signal: DirectionalSignal;
  /** Confidence in signal (0-1 based on volume and spread) */
  confidence: number;
  /** Best bid price */
  bestBid: number;
  /** Best ask price */
  bestAsk: number;
  /** Mid price */
  midPrice: number;
}

/**
 * Calculate orderbook imbalance metrics for directional signals
 *
 * @param orderbook - Raw orderbook data
 * @param depthLevels - Number of price levels to analyze (default: 5)
 * @param depthDollars - Optional: analyze orders within this dollar amount of best price
 * @returns Imbalance metrics including directional signal
 */
export function calculateOrderbookImbalance(
  orderbook: OrderbookData,
  depthLevels: number = 5,
  depthDollars?: number
): OrderbookImbalance {
  const { bids, asks, midPrice } = orderbook;

  // Filter to depth levels or dollar depth
  let filteredBids = bids.slice(0, depthLevels);
  let filteredAsks = asks.slice(0, depthLevels);

  if (depthDollars !== undefined && depthDollars > 0) {
    const bestBid = bids[0]?.[0] || 0;
    const bestAsk = asks[0]?.[0] || 1;

    filteredBids = bids.filter(([price]) => bestBid - price <= depthDollars);
    filteredAsks = asks.filter(([price]) => price - bestAsk <= depthDollars);
  }

  // Calculate total volumes
  const totalBidVolume = filteredBids.reduce((sum, [, size]) => sum + size, 0);
  const totalAskVolume = filteredAsks.reduce((sum, [, size]) => sum + size, 0);

  // Calculate VWAP for each side
  const bidCost = filteredBids.reduce((sum, [price, size]) => sum + price * size, 0);
  const askCost = filteredAsks.reduce((sum, [price, size]) => sum + price * size, 0);

  const vwapBid = totalBidVolume > 0 ? bidCost / totalBidVolume : 0;
  const vwapAsk = totalAskVolume > 0 ? askCost / totalAskVolume : 1;

  // Calculate bid/ask ratio
  const bidAskRatio = totalAskVolume > 0 ? totalBidVolume / totalAskVolume :
                      totalBidVolume > 0 ? Infinity : 1;

  // Normalized imbalance score: (bid - ask) / (bid + ask)
  // Ranges from -1 (all asks) to +1 (all bids)
  const totalVolume = totalBidVolume + totalAskVolume;
  const imbalanceScore = totalVolume > 0
    ? (totalBidVolume - totalAskVolume) / totalVolume
    : 0;

  // Best prices and spread
  const bestBid = bids[0]?.[0] || 0;
  const bestAsk = asks[0]?.[0] || 1;
  const spread = bestAsk - bestBid;
  const spreadPct = midPrice > 0 ? spread / midPrice : 0;

  // Determine directional signal
  // Thresholds tuned for prediction markets (typically 0.01-0.99 range)
  let signal: DirectionalSignal = 'neutral';
  if (imbalanceScore > 0.15) {
    signal = 'bullish';  // Significantly more bid volume
  } else if (imbalanceScore < -0.15) {
    signal = 'bearish';  // Significantly more ask volume
  }

  // Confidence based on:
  // 1. Total volume (more volume = more reliable signal)
  // 2. Spread (tighter spread = more reliable)
  // 3. Imbalance magnitude (stronger imbalance = more confident)
  const volumeScore = Math.min(1, totalVolume / 10000); // Normalize to ~$10k
  const spreadScore = Math.max(0, 1 - spreadPct * 10);   // Penalty for wide spreads
  const imbalanceMagnitude = Math.abs(imbalanceScore);

  const confidence = (volumeScore * 0.4 + spreadScore * 0.3 + imbalanceMagnitude * 0.3);

  return {
    bidAskRatio,
    imbalanceScore,
    vwapBid,
    vwapAsk,
    totalBidVolume,
    totalAskVolume,
    spread,
    spreadPct,
    signal,
    confidence: Math.min(1, Math.max(0, confidence)),
    bestBid,
    bestAsk,
    midPrice,
  };
}

/**
 * Fetch and analyze orderbook imbalance for a market
 */
export async function getOrderbookImbalance(
  platform: 'polymarket' | 'kalshi' | 'opinion' | 'predictfun',
  marketIdOrTokenId: string,
  depthLevels?: number
): Promise<OrderbookImbalance | null> {
  try {
    let orderbook: OrderbookData | null = null;

    if (platform === 'polymarket') {
      orderbook = await fetchPolymarketOrderbook(marketIdOrTokenId);
    } else if (platform === 'kalshi') {
      orderbook = await fetchKalshiOrderbook(marketIdOrTokenId);
    } else if (platform === 'opinion') {
      orderbook = await fetchOpinionOrderbook(marketIdOrTokenId);
    }

    if (!orderbook || (orderbook.bids.length === 0 && orderbook.asks.length === 0)) {
      return null;
    }

    return calculateOrderbookImbalance(orderbook, depthLevels);
  } catch (error) {
    logger.warn({ error, platform, marketIdOrTokenId }, 'Failed to get orderbook imbalance');
    return null;
  }
}

/**
 * Fetch Polymarket orderbook for a token
 */
async function fetchPolymarketOrderbook(tokenId: string): Promise<OrderbookData | null> {
  try {
    const response = await fetch(`${POLY_CLOB_URL}/book?token_id=${tokenId}`);
    if (!response.ok) return null;

    const data = await response.json() as {
      bids?: Array<{ price: string; size: string }>;
      asks?: Array<{ price: string; size: string }>;
    };

    const bids: [number, number][] = (data.bids || [])
      .map(b => [parseFloat(b.price), parseFloat(b.size)] as [number, number])
      .sort((a, b) => b[0] - a[0]); // Sort bids descending by price

    const asks: [number, number][] = (data.asks || [])
      .map(a => [parseFloat(a.price), parseFloat(a.size)] as [number, number])
      .sort((a, b) => a[0] - b[0]); // Sort asks ascending by price

    const bestBid = bids[0]?.[0] || 0;
    const bestAsk = asks[0]?.[0] || 1;
    const midPrice = (bestBid + bestAsk) / 2;

    return { bids, asks, midPrice };
  } catch (error) {
    logger.warn({ error, tokenId }, 'Failed to fetch Polymarket orderbook');
    return null;
  }
}

const KALSHI_URL = 'https://trading-api.kalshi.com/trade-api/v2';

/**
 * Fetch Kalshi orderbook for a market
 */
async function fetchKalshiOrderbook(marketId: string): Promise<OrderbookData | null> {
  try {
    const response = await fetch(`${KALSHI_URL}/markets/${marketId}/orderbook`);
    if (!response.ok) return null;

    const data = await response.json() as {
      orderbook?: {
        yes?: Array<[number, number]>;
        no?: Array<[number, number]>;
      };
    };

    // Kalshi returns [price_cents, contracts] for yes and no sides
    const yesOrders = data.orderbook?.yes || [];
    const noOrders = data.orderbook?.no || [];

    // For YES: bids are buy yes orders, asks are from sell yes / buy no
    const bids: [number, number][] = yesOrders
      .map(([priceCents, size]) => [priceCents / 100, size] as [number, number])
      .sort((a, b) => b[0] - a[0]);

    // For asks, use complementary no price (1 - no_price = yes_ask)
    const asks: [number, number][] = noOrders
      .map(([priceCents, size]) => [1 - priceCents / 100, size] as [number, number])
      .sort((a, b) => a[0] - b[0]);

    const bestBid = bids[0]?.[0] || 0;
    const bestAsk = asks[0]?.[0] || 1;
    const midPrice = (bestBid + bestAsk) / 2;

    return { bids, asks, midPrice };
  } catch (error) {
    logger.warn({ error, marketId }, 'Failed to fetch Kalshi orderbook');
    return null;
  }
}

/**
 * Calculate average fill price by walking through orderbook
 */
function calculateFillFromOrderbook(
  orders: [number, number][],  // [price, size] sorted appropriately
  targetSize: number,
  side: 'buy' | 'sell'
): { avgFillPrice: number; totalFilled: number } {
  let totalFilled = 0;
  let totalCost = 0;

  for (const [price, size] of orders) {
    const fillableAtThisLevel = Math.min(size, targetSize - totalFilled);

    if (fillableAtThisLevel <= 0) break;

    totalFilled += fillableAtThisLevel;
    totalCost += fillableAtThisLevel * price;

    if (totalFilled >= targetSize) break;
  }

  if (totalFilled === 0) {
    // No liquidity, return worst-case price
    return {
      avgFillPrice: side === 'buy' ? 1 : 0,
      totalFilled: 0,
    };
  }

  return {
    avgFillPrice: totalCost / totalFilled,
    totalFilled,
  };
}

interface PolymarketOrderResponse {
  orderID?: string;
  order_id?: string;
  success?: boolean;
  errorMsg?: string;
  status?: string;
  transactionsHashes?: string[];
}

interface PolymarketOpenOrder {
  id: string;
  asset_id: string;
  market: string;
  side: 'BUY' | 'SELL';
  original_size: string;
  size_matched: string;
  price: string;
  status: string;
  created_at: string;
  expiration?: string;
  order_type?: string;
}

async function placePolymarketOrder(
  auth: PolymarketApiKeyAuth & { privateKey?: string; funderAddress?: string; signatureType?: number },
  tokenId: string,
  side: OrderSide,
  price: number,
  size: number,
  orderType: OrderType = 'GTC',
  negRisk?: boolean,
  postOnly?: boolean
): Promise<OrderResult> {
  // Validate tick size
  const tickSize = await getPolymarketTickSize(tokenId);
  const tickError = validatePriceTickSize(price, tickSize);
  if (tickError) {
    return { success: false, error: tickError };
  }

  // Validate post-only won't cross spread
  if (postOnly) {
    const postOnlyError = await validatePostOnly(tokenId, side, price);
    if (postOnlyError) {
      return { success: false, error: postOnlyError };
    }
  }

  // Auto-detect negRisk if not provided
  const actualNegRisk = negRisk ?? await getPolymarketNegRiskCached(tokenId);

  // Get fee rate for this token
  const feeRateBps = await getPolymarketFeeRate(tokenId);

  // If private key available, use EIP-712 signed order (required for real CLOB)
  if (auth.privateKey) {
    const signedAuth = { ...auth, privateKey: auth.privateKey };
    return placeSignedPolymarketOrder(signedAuth, tokenId, side, price, size, orderType, actualNegRisk, postOnly, feeRateBps);
  }

  // Fallback: simplified payload (may not work with real CLOB without signing)
  const url = `${POLY_CLOB_URL}/order`;
  const order: Record<string, unknown> = {
    tokenID: tokenId,
    side: side.toUpperCase(),
    price: price.toString(),
    size: size.toString(),
    orderType: orderType,
    feeRateBps: feeRateBps.toString(),
    negRisk: actualNegRisk,
    nonce: getNextNonce(),
  };
  if (postOnly === true) order.postOnly = true;

  const headers = buildPolymarketHeadersForUrl(auth, 'POST', url, order);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });

    const data = (await response.json()) as PolymarketOrderResponse;
    if (!response.ok || data.errorMsg) {
      const { code, message } = parsePolymarketError(data.errorMsg, response.status);
      logger.error({ status: response.status, errorCode: code, error: message }, 'Polymarket order failed');
      return { success: false, error: `[${code}] ${message}` };
    }

    const orderId = data.orderID || data.order_id;
    logger.info({ orderId, tokenId, side, price, size, feeRateBps }, 'Polymarket order placed');
    return { success: true, orderId, status: 'open', transactionHash: data.transactionsHashes?.[0] };
  } catch (error) {
    logger.error({ error }, 'Error placing Polymarket order');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Place a single EIP-712 signed order on Polymarket CLOB.
 * Uses POST /order with the full signed order payload.
 */
async function placeSignedPolymarketOrder(
  auth: PolymarketApiKeyAuth & { privateKey: string; funderAddress?: string; signatureType?: number },
  tokenId: string,
  side: OrderSide,
  price: number,
  size: number,
  orderType: OrderType = 'GTC',
  negRisk?: boolean,
  postOnly?: boolean,
  feeRateBps?: number,
): Promise<OrderResult> {
  const url = `${POLY_CLOB_URL}/order`;

  const signerCfg: SignerConfig = {
    privateKey: auth.privateKey,
    funderAddress: auth.funderAddress,
    signatureType: auth.signatureType,
  };

  const postOrder = buildSignedOrder({
    tokenId,
    price,
    size,
    side: side === 'buy' ? 'buy' : 'sell',
    negRisk,
    feeRateBps,
    nonce: getNextNonce(),
  }, signerCfg);

  // Set owner to API key (required by Polymarket CLOB)
  postOrder.owner = auth.apiKey;
  postOrder.orderType = orderType as 'GTC' | 'GTD' | 'FOK';
  if (postOnly) postOrder.postOnly = true;

  const headers = buildPolymarketHeadersForUrl(auth, 'POST', url, postOrder);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(postOrder),
    });

    const data = (await response.json()) as PolymarketOrderResponse;
    if (!response.ok || data.errorMsg) {
      const { code, message } = parsePolymarketError(data.errorMsg, response.status);
      logger.error({ status: response.status, errorCode: code, error: message }, 'Polymarket signed order failed');
      return { success: false, error: `[${code}] ${message}` };
    }

    const orderId = data.orderID || data.order_id;
    logger.info({ orderId, tokenId, side, price, size, feeRateBps }, 'Polymarket signed order placed');
    return { success: true, orderId, status: 'open', transactionHash: data.transactionsHashes?.[0] };
  } catch (error) {
    logger.error({ error }, 'Error placing Polymarket signed order');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function cancelPolymarketOrder(auth: PolymarketApiKeyAuth, orderId: string): Promise<boolean> {
  const url = `${POLY_CLOB_URL}/order/${orderId}`;
  const headers = buildPolymarketHeadersForUrl(auth, 'DELETE', url);

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.error({ status: response.status, orderId }, 'Failed to cancel Polymarket order');
      return false;
    }

    logger.info({ orderId }, 'Polymarket order cancelled');
    return true;
  } catch (error) {
    logger.error({ error, orderId }, 'Error cancelling Polymarket order');
    return false;
  }
}

async function cancelAllPolymarketOrders(auth: PolymarketApiKeyAuth, marketId?: string): Promise<number> {
  let url = `${POLY_CLOB_URL}/cancel-all`;
  if (marketId) {
    url += `?market=${marketId}`;
  }

  const headers = buildPolymarketHeadersForUrl(auth, 'DELETE', url);

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to cancel all Polymarket orders');
      return 0;
    }

    const data = (await response.json()) as { canceled?: number };
    const count = data.canceled || 0;

    logger.info({ count, marketId }, 'Cancelled Polymarket orders');
    return count;
  } catch (error) {
    logger.error({ error }, 'Error cancelling all Polymarket orders');
    return 0;
  }
}

/**
 * Place multiple Polymarket orders in a single batch request.
 *
 * If private key is available, uses POST /orders with EIP-712 signed orders
 * (up to 15 per request). Otherwise falls back to parallel single-order calls.
 */
async function placePolymarketOrdersBatch(
  auth: PolymarketApiKeyAuth & { privateKey?: string; funderAddress?: string; signatureType?: number },
  orders: Array<{
    tokenId: string;
    side: OrderSide;
    price: number;
    size: number;
    negRisk?: boolean;
    postOnly?: boolean;
  }>
): Promise<OrderResult[]> {
  if (orders.length === 0) return [];

  // If no private key, fall back to parallel individual calls
  if (!auth.privateKey) {
    const results = await Promise.all(
      orders.map(o =>
        placePolymarketOrder(auth, o.tokenId, o.side, o.price, o.size, 'GTC', o.negRisk, o.postOnly)
          .catch(err => ({ success: false, error: err instanceof Error ? err.message : 'Order failed' } as OrderResult))
      )
    );
    logger.info({ total: orders.length, successful: results.filter(r => r.success).length }, 'Polymarket parallel orders placed');
    return results;
  }

  // Build all signed orders
  const signerCfg: SignerConfig = {
    privateKey: auth.privateKey,
    funderAddress: auth.funderAddress,
    signatureType: auth.signatureType,
  };

  const postOrders: PostOrderBody[] = buildSignedOrders(
    orders.map(o => ({
      tokenId: o.tokenId,
      price: o.price,
      size: o.size,
      side: o.side === 'buy' ? 'buy' as const : 'sell' as const,
      negRisk: o.negRisk,
    })),
    signerCfg,
  );

  // Set owner to API key on all orders (required by Polymarket CLOB)
  for (const po of postOrders) {
    po.owner = auth.apiKey;
  }

  // Apply postOnly flag
  for (let i = 0; i < postOrders.length; i++) {
    if (orders[i].postOnly) postOrders[i].postOnly = true;
  }

  // Send in chunks of 15 (Polymarket batch limit)
  const results: OrderResult[] = [];
  for (let i = 0; i < postOrders.length; i += 15) {
    const chunk = postOrders.slice(i, i + 15);
    const url = `${POLY_CLOB_URL}/orders`;
    const headers = buildPolymarketHeadersForUrl(auth, 'POST', url, chunk);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ status: response.status, error, count: chunk.length }, 'Polymarket batch order failed');
        results.push(...chunk.map(() => ({ success: false, error: `HTTP ${response.status}` })));
        continue;
      }

      const data = (await response.json()) as Array<PolymarketOrderResponse>;
      logger.info(
        { count: chunk.length, successful: data.filter(r => r.orderID || r.order_id).length },
        'Polymarket batch orders placed',
      );

      for (const r of data) {
        results.push({
          success: !r.errorMsg,
          orderId: r.orderID || r.order_id,
          error: r.errorMsg,
          status: r.errorMsg ? 'rejected' : 'open',
          transactionHash: r.transactionsHashes?.[0],
        });
      }
    } catch (error) {
      logger.error({ error }, 'Error placing Polymarket batch orders');
      results.push(...chunk.map(() => ({
        success: false,
        error: error instanceof Error ? error.message : 'Batch order failed',
      })));
    }
  }

  logger.info({ total: orders.length, successful: results.filter(r => r.success).length }, 'Polymarket batch orders completed');
  return results;
}

/**
 * Cancel multiple Polymarket orders concurrently.
 *
 * NOTE: The true batch cancel endpoint (DELETE /orders) accepts an array of
 * order IDs. It uses L2 HMAC auth (same as other endpoints), so we can use
 * it directly. Falls back to parallel individual cancels on error.
 */
async function cancelPolymarketOrdersBatch(
  auth: PolymarketApiKeyAuth,
  orderIds: string[]
): Promise<Array<{ orderId: string; success: boolean }>> {
  if (orderIds.length === 0) return [];

  // DELETE /orders with array of IDs uses L2 HMAC auth (no order signing needed)
  const url = `${POLY_CLOB_URL}/orders`;
  const headers = buildPolymarketHeadersForUrl(auth, 'DELETE', url, orderIds);

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(orderIds),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, count: orderIds.length }, 'Polymarket batch cancel failed, falling back to individual');
      // Fallback to parallel individual cancels
      return Promise.all(
        orderIds.map(async (orderId) => ({
          orderId,
          success: await cancelPolymarketOrder(auth, orderId).catch(() => false),
        }))
      );
    }

    const data = (await response.json()) as { canceled?: string[]; not_canceled?: Record<string, string> };
    const canceledSet = new Set(data.canceled || []);
    logger.info(
      { total: orderIds.length, canceled: canceledSet.size, notCanceled: Object.keys(data.not_canceled || {}).length },
      'Polymarket batch cancel completed',
    );

    return orderIds.map(orderId => ({ orderId, success: canceledSet.has(orderId) }));
  } catch (error) {
    logger.error({ error }, 'Error in Polymarket batch cancel, falling back to individual');
    return Promise.all(
      orderIds.map(async (orderId) => ({
        orderId,
        success: await cancelPolymarketOrder(auth, orderId).catch(() => false),
      }))
    );
  }
}

async function getPolymarketOpenOrders(auth: PolymarketApiKeyAuth): Promise<OpenOrder[]> {
  const url = `${POLY_CLOB_URL}/orders?state=OPEN`;
  const headers = buildPolymarketHeadersForUrl(auth, 'GET', url);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to fetch Polymarket orders');
      return [];
    }

    const data = (await response.json()) as PolymarketOpenOrder[];

    return data.map((o) => ({
      orderId: o.id,
      platform: 'polymarket' as const,
      marketId: o.market,
      tokenId: o.asset_id,
      side: o.side.toLowerCase() as OrderSide,
      price: parseFloat(o.price),
      originalSize: parseFloat(o.original_size),
      remainingSize: parseFloat(o.original_size) - parseFloat(o.size_matched),
      filledSize: parseFloat(o.size_matched),
      orderType: (o.order_type as OrderType) || 'GTC',
      status: o.status.toLowerCase() as OrderStatus,
      createdAt: new Date(o.created_at),
      expiration: o.expiration ? new Date(o.expiration) : undefined,
    }));
  } catch (error) {
    logger.error({ error }, 'Error fetching Polymarket orders');
    return [];
  }
}

// =============================================================================
// KALSHI EXECUTION
// =============================================================================

const KALSHI_API_URL = 'https://api.elections.kalshi.com/trade-api/v2';

interface KalshiOrderResponse {
  order?: {
    order_id: string;
    status: string;
    filled_count?: number;
  };
  error?: { message: string };
}

interface KalshiOpenOrder {
  order_id: string;
  ticker: string;
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  type: string;
  yes_price: number;
  no_price: number;
  remaining_count: number;
  count: number;
  created_time: string;
  expiration_time?: string;
  status: string;
}

async function placeKalshiOrder(
  auth: KalshiApiKeyAuth,
  ticker: string,
  side: 'yes' | 'no',
  action: OrderSide,
  price: number,
  count: number,
  orderType: OrderType = 'GTC'
): Promise<OrderResult> {
  const url = `${KALSHI_API_URL}/portfolio/orders`;

  const order = {
    ticker,
    side,
    action,
    type: orderType === 'FOK' ? 'market' : 'limit',
    yes_price: side === 'yes' ? Math.round(price * 100) : undefined,
    no_price: side === 'no' ? Math.round(price * 100) : undefined,
    count,
  };

  const headers = buildKalshiHeadersForUrl(auth, 'POST', url);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(order),
    });

    const data = (await response.json()) as KalshiOrderResponse;

    if (!response.ok || data.error) {
      logger.error({ status: response.status, error: data.error }, 'Kalshi order failed');
      return {
        success: false,
        error: data.error?.message || `HTTP ${response.status}`,
      };
    }

    logger.info({ orderId: data.order?.order_id, ticker, side, action, price, count }, 'Kalshi order placed');

    return {
      success: true,
      orderId: data.order?.order_id,
      status: data.order?.status as OrderStatus || 'open',
      filledSize: data.order?.filled_count,
    };
  } catch (error) {
    logger.error({ error }, 'Error placing Kalshi order');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function cancelKalshiOrder(auth: KalshiApiKeyAuth, orderId: string): Promise<boolean> {
  const url = `${KALSHI_API_URL}/portfolio/orders/${orderId}`;
  const headers = buildKalshiHeadersForUrl(auth, 'DELETE', url);

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.error({ status: response.status, orderId }, 'Failed to cancel Kalshi order');
      return false;
    }

    logger.info({ orderId }, 'Kalshi order cancelled');
    return true;
  } catch (error) {
    logger.error({ error, orderId }, 'Error cancelling Kalshi order');
    return false;
  }
}

async function getKalshiOpenOrders(auth: KalshiApiKeyAuth): Promise<OpenOrder[]> {
  const url = `${KALSHI_API_URL}/portfolio/orders?status=resting`;
  const headers = buildKalshiHeadersForUrl(auth, 'GET', url);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to fetch Kalshi orders');
      return [];
    }

    const data = (await response.json()) as { orders: KalshiOpenOrder[] };

    return (data.orders || []).map((o) => {
      const price = (o.side === 'yes' ? o.yes_price : o.no_price) / 100;

      return {
        orderId: o.order_id,
        platform: 'kalshi' as const,
        marketId: o.ticker,
        outcome: o.side,
        side: o.action as OrderSide,
        price,
        originalSize: o.count,
        remainingSize: o.remaining_count,
        filledSize: o.count - o.remaining_count,
        orderType: o.type === 'market' ? 'FOK' as OrderType : 'GTC' as OrderType,
        status: o.status as OrderStatus,
        createdAt: new Date(o.created_time),
        expiration: o.expiration_time ? new Date(o.expiration_time) : undefined,
      };
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching Kalshi orders');
    return [];
  }
}

/**
 * Place multiple Kalshi orders in a single batch request.
 * Kalshi supports up to 20 orders per batch via POST /portfolio/orders/batched.
 */
async function placeKalshiOrdersBatch(
  auth: KalshiApiKeyAuth,
  orders: Array<{
    ticker: string;
    side: 'yes' | 'no';
    action: OrderSide;
    price: number;
    count: number;
    orderType?: OrderType;
  }>
): Promise<OrderResult[]> {
  if (orders.length === 0) return [];

  const results: OrderResult[] = [];

  // Chunk into batches of 20 (Kalshi limit)
  for (let i = 0; i < orders.length; i += 20) {
    const chunk = orders.slice(i, i + 20);
    const url = `${KALSHI_API_URL}/portfolio/orders/batched`;
    const headers = buildKalshiHeadersForUrl(auth, 'POST', url);

    const body = {
      orders: chunk.map(o => ({
        ticker: o.ticker,
        side: o.side,
        action: o.action,
        type: o.orderType === 'FOK' ? 'market' : 'limit',
        yes_price: o.side === 'yes' ? Math.round(o.price * 100) : undefined,
        no_price: o.side === 'no' ? Math.round(o.price * 100) : undefined,
        count: o.count,
      })),
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ status: response.status, error, count: chunk.length }, 'Kalshi batch order failed');
        results.push(...chunk.map(() => ({ success: false, error: `HTTP ${response.status}` })));
        continue;
      }

      const data = (await response.json()) as { orders?: Array<{ order_id: string; status: string; filled_count?: number }> };
      const respOrders = data.orders || [];

      for (let j = 0; j < chunk.length; j++) {
        const r = respOrders[j];
        if (r?.order_id) {
          results.push({
            success: true,
            orderId: r.order_id,
            status: r.status as OrderStatus || 'open',
            filledSize: r.filled_count,
          });
        } else {
          results.push({ success: false, error: 'No order_id in response' });
        }
      }

      logger.info({ count: chunk.length, successful: respOrders.filter(r => r?.order_id).length }, 'Kalshi batch orders placed');
    } catch (error) {
      logger.error({ error }, 'Error placing Kalshi batch orders');
      results.push(...chunk.map(() => ({
        success: false,
        error: error instanceof Error ? error.message : 'Batch order failed',
      })));
    }
  }

  return results;
}

/**
 * Cancel multiple Kalshi orders in a single batch request.
 * Kalshi supports up to 20 cancels per batch via DELETE /portfolio/orders/batched.
 */
async function cancelKalshiOrdersBatch(
  auth: KalshiApiKeyAuth,
  orderIds: string[],
): Promise<Array<{ orderId: string; success: boolean }>> {
  if (orderIds.length === 0) return [];

  const results: Array<{ orderId: string; success: boolean }> = [];

  for (let i = 0; i < orderIds.length; i += 20) {
    const chunk = orderIds.slice(i, i + 20);
    const url = `${KALSHI_API_URL}/portfolio/orders/batched`;
    const headers = buildKalshiHeadersForUrl(auth, 'DELETE', url);

    const body = {
      orders: chunk.map(id => ({ order_id: id })),
    };

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        logger.error({ status: response.status, count: chunk.length }, 'Kalshi batch cancel failed');
        results.push(...chunk.map(id => ({ orderId: id, success: false })));
        continue;
      }

      logger.info({ count: chunk.length }, 'Kalshi batch cancel completed');
      results.push(...chunk.map(id => ({ orderId: id, success: true })));
    } catch (error) {
      logger.error({ error }, 'Error batch cancelling Kalshi orders');
      results.push(...chunk.map(id => ({ orderId: id, success: false })));
    }
  }

  return results;
}

/**
 * Amend a Kalshi order (change price and/or count without losing queue position).
 * POST /portfolio/orders/{order_id}/amend
 */
async function amendKalshiOrder(
  auth: KalshiApiKeyAuth,
  orderId: string,
  updates: { price?: number; side?: 'yes' | 'no'; count?: number },
): Promise<OrderResult> {
  const url = `${KALSHI_API_URL}/portfolio/orders/${orderId}/amend`;
  const headers = buildKalshiHeadersForUrl(auth, 'POST', url);

  const body: Record<string, unknown> = {};
  if (updates.price != null && updates.side) {
    if (updates.side === 'yes') {
      body.yes_price = Math.round(updates.price * 100);
    } else {
      body.no_price = Math.round(updates.price * 100);
    }
  }
  if (updates.count != null) {
    body.count = updates.count;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as { order?: { order_id: string; status: string } };

    if (!response.ok) {
      logger.error({ status: response.status, orderId }, 'Kalshi order amend failed');
      return { success: false, error: `HTTP ${response.status}` };
    }

    logger.info({ orderId, updates }, 'Kalshi order amended');
    return {
      success: true,
      orderId: data.order?.order_id || orderId,
      status: data.order?.status as OrderStatus || 'open',
    };
  } catch (error) {
    logger.error({ error, orderId }, 'Error amending Kalshi order');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// =============================================================================
// OPINION.TRADE EXECUTION (delegates to exchange module with EIP-712 signing)
// =============================================================================

/**
 * Convert ExecutionConfig opinion fields to OpinionConfig for the exchange module.
 * The exchange module uses the unofficial-opinion-clob-sdk which handles
 * EIP-712 order signing internally — raw REST calls skip signing entirely.
 */
function toOpinionConfig(
  auth: OpinionApiAuth & { privateKey?: string; multiSigAddress?: string; rpcUrl?: string }
): opinion.OpinionConfig {
  return {
    apiKey: auth.apiKey,
    privateKey: auth.privateKey || '',
    vaultAddress: auth.multiSigAddress || '',
    rpcUrl: auth.rpcUrl,
  };
}

async function placeOpinionOrder(
  auth: OpinionApiAuth & { privateKey?: string; multiSigAddress?: string; rpcUrl?: string },
  tokenId: string,
  side: OrderSide,
  price: number,
  size: number,
  orderType: OrderType = 'GTC'
): Promise<OrderResult> {
  if (!auth.privateKey) {
    return { success: false, error: 'Opinion privateKey required for order signing' };
  }
  if (!auth.multiSigAddress) {
    return { success: false, error: 'Opinion multiSigAddress (vaultAddress) required for trading' };
  }

  const config = toOpinionConfig(auth);
  // Opinion SDK needs a marketId (number) — we extract it from context or use 0
  // The tokenId is what the SDK actually uses for order matching
  const result = await opinion.placeOrder(
    config,
    0, // marketId not available at this level — SDK uses tokenId for matching
    tokenId,
    side === 'buy' ? 'BUY' : 'SELL',
    price,
    size,
    orderType === 'FOK' ? 'MARKET' : 'LIMIT'
  );

  return {
    success: result.success,
    orderId: result.orderId,
    status: result.status as OrderStatus | undefined,
    error: result.error,
  };
}

async function cancelOpinionOrder(
  auth: OpinionApiAuth & { privateKey?: string; multiSigAddress?: string; rpcUrl?: string },
  orderId: string
): Promise<boolean> {
  const config = toOpinionConfig(auth);
  return opinion.cancelOrder(config, orderId);
}

async function getOpinionOpenOrders(
  auth: OpinionApiAuth & { privateKey?: string; multiSigAddress?: string; rpcUrl?: string }
): Promise<OpenOrder[]> {
  const config = toOpinionConfig(auth);

  try {
    const orders = await opinion.getOpenOrders(config);

    return orders.map((o) => ({
      orderId: o.orderId,
      platform: 'opinion' as const,
      marketId: o.marketId?.toString() || '',
      tokenId: o.orderId, // tokenId not directly available from getOpenOrders
      side: o.side.toLowerCase() as OrderSide,
      price: parseFloat(o.price),
      originalSize: parseFloat(o.orderShares),
      remainingSize: parseFloat(o.orderShares) - parseFloat(o.filledShares || '0'),
      filledSize: parseFloat(o.filledShares || '0'),
      orderType: 'GTC' as OrderType,
      status: o.status.toLowerCase() as OrderStatus,
      createdAt: new Date(o.createdAt),
    }));
  } catch (error) {
    logger.error({ error }, 'Error fetching Opinion orders');
    return [];
  }
}

async function placeOpinionOrdersBatch(
  auth: OpinionApiAuth & { privateKey?: string; multiSigAddress?: string; rpcUrl?: string },
  orders: Array<{
    marketId: number;
    tokenId: string;
    side: 'BUY' | 'SELL';
    price: number;
    amount: number;
  }>
): Promise<OrderResult[]> {
  if (!auth.privateKey || !auth.multiSigAddress) {
    return orders.map(() => ({
      success: false,
      error: 'Opinion privateKey and multiSigAddress required for order signing',
    }));
  }

  const config = toOpinionConfig(auth);

  const results = await opinion.placeOrdersBatch(config, orders);
  return results.map(r => ({
    success: r.success,
    orderId: r.orderId,
    error: r.error,
  }));
}

async function cancelOpinionOrdersBatch(
  auth: OpinionApiAuth & { privateKey?: string; multiSigAddress?: string; rpcUrl?: string },
  orderIds: string[]
): Promise<Array<{ orderId: string; success: boolean }>> {
  const config = toOpinionConfig(auth);

  return opinion.cancelOrdersBatch(config, orderIds);
}

async function cancelAllOpinionOrders(
  auth: OpinionApiAuth & { privateKey?: string; multiSigAddress?: string; rpcUrl?: string },
  marketId?: string
): Promise<number> {
  const config = toOpinionConfig(auth);

  const result = await opinion.cancelAllOrders(
    config,
    marketId ? parseInt(marketId, 10) : undefined
  );
  return result.cancelled;
}

// =============================================================================
// PREDICTFUN EXECUTION
// =============================================================================

async function placePredictFunOrder(
  config: NonNullable<ExecutionConfig['predictfun']>,
  tokenId: string,
  side: OrderSide,
  price: number,
  size: number,
  marketId: string
): Promise<OrderResult> {
  try {
    const result = await predictfun.createOrder(
      { ...config, dryRun: false },
      {
        marketId,
        tokenId,
        side: side.toUpperCase() as 'BUY' | 'SELL',
        price,
        quantity: size,
        isYieldBearing: true, // Default to yield-bearing
      }
    );

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Order placement failed',
      };
    }

    logger.info({ orderHash: result.orderHash, tokenId, side, price, size }, 'PredictFun order placed');

    return {
      success: true,
      orderId: result.orderHash,
      status: 'open',
    };
  } catch (error) {
    logger.error({ error }, 'Error placing PredictFun order');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function cancelPredictFunOrder(
  config: NonNullable<ExecutionConfig['predictfun']>,
  orderHash: string
): Promise<boolean> {
  try {
    // We need to figure out if it's negRisk/yieldBearing by fetching orders first
    const orders = await predictfun.getOpenOrders(config);
    const order = orders.find(o => o.orderHash === orderHash);

    if (!order) {
      logger.warn({ orderHash }, 'Order not found for cancellation');
      return false;
    }

    const result = await predictfun.cancelOrders(
      config,
      [orderHash],
      { isNegRisk: order.isNegRisk, isYieldBearing: order.isYieldBearing }
    );

    if (!result.success) {
      logger.error({ orderHash, error: result.error }, 'Failed to cancel PredictFun order');
      return false;
    }

    logger.info({ orderHash }, 'PredictFun order cancelled');
    return true;
  } catch (error) {
    logger.error({ error, orderHash }, 'Error cancelling PredictFun order');
    return false;
  }
}

async function cancelAllPredictFunOrders(
  config: NonNullable<ExecutionConfig['predictfun']>
): Promise<number> {
  try {
    const result = await predictfun.cancelAllOrders(config);
    return result.cancelled;
  } catch (error) {
    logger.error({ error }, 'Error cancelling all PredictFun orders');
    return 0;
  }
}

async function getPredictFunOpenOrders(
  config: NonNullable<ExecutionConfig['predictfun']>
): Promise<OpenOrder[]> {
  try {
    const orders = await predictfun.getOpenOrders(config);

    return orders.map((o) => ({
      orderId: o.orderHash,
      platform: 'predictfun' as const,
      marketId: o.marketId,
      tokenId: o.orderHash, // Use hash as tokenId fallback
      side: o.side.toLowerCase() as OrderSide,
      price: parseFloat(o.price),
      originalSize: parseFloat(o.size),
      remainingSize: parseFloat(o.size) - parseFloat(o.filled),
      filledSize: parseFloat(o.filled),
      orderType: 'GTC' as OrderType,
      status: o.status.toLowerCase() as OrderStatus,
      createdAt: new Date(o.createdAt),
    }));
  } catch (error) {
    logger.error({ error }, 'Error fetching PredictFun orders');
    return [];
  }
}

/**
 * Fetch PredictFun orderbook for slippage calculation
 */
async function fetchPredictFunOrderbook(
  config: NonNullable<ExecutionConfig['predictfun']>,
  marketId: string
): Promise<OrderbookData | null> {
  try {
    const data = await predictfun.getOrderbook(config, marketId) as {
      bids?: Array<{ price: string; size: string }>;
      asks?: Array<{ price: string; size: string }>;
    } | null;

    if (!data) return null;

    const bids: [number, number][] = (data.bids || [])
      .map(b => [parseFloat(b.price), parseFloat(b.size)] as [number, number])
      .filter(([price, size]) => !isNaN(price) && !isNaN(size))
      .sort((a, b) => b[0] - a[0]);

    const asks: [number, number][] = (data.asks || [])
      .map(a => [parseFloat(a.price), parseFloat(a.size)] as [number, number])
      .filter(([price, size]) => !isNaN(price) && !isNaN(size))
      .sort((a, b) => a[0] - b[0]);

    const bestBid = bids[0]?.[0] || 0;
    const bestAsk = asks[0]?.[0] || 1;
    const midPrice = (bestBid + bestAsk) / 2;

    return { bids, asks, midPrice };
  } catch (error) {
    logger.warn({ error, marketId }, 'Failed to fetch PredictFun orderbook');
    return null;
  }
}

/**
 * Fetch Opinion orderbook for slippage calculation
 */
async function fetchOpinionOrderbook(tokenId: string): Promise<OrderbookData | null> {
  try {
    const response = await fetch(`https://proxy.opinion.trade:8443/openapi/token/orderbook?tokenId=${encodeURIComponent(tokenId)}`);
    if (!response.ok) return null;

    const data = await response.json() as {
      bids?: Array<{ price: string; size: string }>;
      asks?: Array<{ price: string; size: string }>;
      orderbook?: {
        bids?: Array<{ price: string; size: string }>;
        asks?: Array<{ price: string; size: string }>;
      };
    };

    const orderbook = data.orderbook || data;

    const bids: [number, number][] = (orderbook.bids || [])
      .map(b => [parseFloat(b.price), parseFloat(b.size)] as [number, number])
      .filter(([price, size]) => !isNaN(price) && !isNaN(size))
      .sort((a, b) => b[0] - a[0]);

    const asks: [number, number][] = (orderbook.asks || [])
      .map(a => [parseFloat(a.price), parseFloat(a.size)] as [number, number])
      .filter(([price, size]) => !isNaN(price) && !isNaN(size))
      .sort((a, b) => a[0] - b[0]);

    const bestBid = bids[0]?.[0] || 0;
    const bestAsk = asks[0]?.[0] || 1;
    const midPrice = (bestBid + bestAsk) / 2;

    return { bids, asks, midPrice };
  } catch (error) {
    logger.warn({ error, tokenId }, 'Failed to fetch Opinion orderbook');
    return null;
  }
}

// =============================================================================
// POLYMARKET SETTLEMENT & APPROVAL
// =============================================================================

// USDC contract address on Polygon
const POLY_USDC_ADDRESS = process.env.POLY_USDC_ADDRESS || '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
// Conditional Token Framework address
const POLY_CTF_ADDRESS = process.env.POLY_CTF_ADDRESS || '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

/**
 * Get pending settlements for resolved markets
 */
async function getPolymarketPendingSettlements(
  auth: PolymarketApiKeyAuth,
  funderAddress?: string
): Promise<PendingSettlement[]> {
  const address = funderAddress || auth.address;
  const url = `${POLY_CLOB_URL}/positions?address=${address}`;

  const headers = buildPolymarketHeadersForUrl(auth, 'GET', url);

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const positions = await response.json() as Array<{
      asset_id?: string;
      condition_id?: string;
      market_id?: string;
      size?: string;
      outcome?: string;
      resolved?: boolean;
      resolution?: number;
      claimable?: string;
    }>;

    // Filter to resolved positions with claimable amounts
    return positions
      .filter(p => p.resolved && parseFloat(p.claimable || '0') > 0)
      .map(p => ({
        marketId: p.market_id || p.condition_id || '',
        conditionId: p.condition_id || '',
        tokenId: p.asset_id || '',
        outcome: (p.outcome?.toLowerCase() || 'yes') as 'yes' | 'no',
        size: parseFloat(p.size || '0'),
        claimable: parseFloat(p.claimable || '0'),
        resolutionStatus: 'resolved' as const,
        resolvedAt: undefined, // API doesn't return resolution time
      }));
  } catch (error) {
    logger.error({ error, address }, 'Failed to fetch pending settlements');
    return [];
  }
}

/**
 * Approve USDC spending for CTF exchange (required before first trade)
 * This requires a transaction signing - returns the approval status
 */
async function approvePolymarketUSDC(
  privateKey: string,
  spender: string,
  amount: number = Number.MAX_SAFE_INTEGER
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  // Note: Full ERC20 approval requires web3/ethers and RPC connection
  // This is a placeholder that documents the required flow
  try {
    // In a full implementation, this would:
    // 1. Create web3/ethers instance with Polygon RPC
    // 2. Create USDC contract instance
    // 3. Call approve(spender, amount) and sign with privateKey
    // 4. Wait for transaction confirmation

    logger.warn(
      { spender, amount },
      'USDC approval requires full web3 implementation. Use Polymarket UI for initial approval.'
    );

    return {
      success: false,
      error: 'USDC approval requires web3 integration. Please approve via Polymarket UI for now.',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Approval failed',
    };
  }
}

/**
 * Get current USDC allowance for trading
 */
async function getPolymarketUSDCAllowance(
  ownerAddress: string,
  spenderAddress: string
): Promise<number> {
  try {
    // ERC20 allowance check via RPC
    // This is a read-only call that doesn't require signing
    const allowanceSelector = '0xdd62ed3e'; // allowance(address,address)
    const paddedOwner = ownerAddress.slice(2).toLowerCase().padStart(64, '0');
    const paddedSpender = spenderAddress.slice(2).toLowerCase().padStart(64, '0');
    const data = `${allowanceSelector}${paddedOwner}${paddedSpender}`;

    const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: POLY_USDC_ADDRESS, data }, 'latest'],
        id: 1,
      }),
    });

    const result = await response.json() as { result?: string };
    if (!result.result || result.result === '0x') {
      return 0;
    }

    // USDC has 6 decimals
    const allowanceWei = BigInt(result.result);
    return Number(allowanceWei) / 1e6;
  } catch (error) {
    logger.warn({ error, ownerAddress }, 'Failed to fetch USDC allowance');
    return 0;
  }
}

/**
 * Batch fetch orderbooks for multiple tokens
 */
async function getPolymarketOrderbooksBatch(
  tokenIds: string[]
): Promise<Map<string, OrderbookData | null>> {
  const results = new Map<string, OrderbookData | null>();

  // Fetch in parallel with concurrency limit
  const BATCH_SIZE = 10;
  for (let i = 0; i < tokenIds.length; i += BATCH_SIZE) {
    const batch = tokenIds.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (tokenId) => {
      try {
        const response = await fetch(`${POLY_CLOB_URL}/book?token_id=${tokenId}`);
        if (!response.ok) {
          results.set(tokenId, null);
          return;
        }

        const data = await response.json() as {
          bids?: Array<{ price: string; size: string }>;
          asks?: Array<{ price: string; size: string }>;
        };

        const bids: [number, number][] = (data.bids || [])
          .map((b) => [parseFloat(b.price), parseFloat(b.size)] as [number, number])
          .sort((a, b) => b[0] - a[0]);

        const asks: [number, number][] = (data.asks || [])
          .map((a) => [parseFloat(a.price), parseFloat(a.size)] as [number, number])
          .sort((a, b) => a[0] - b[0]);

        const bestBid = bids[0]?.[0] || 0;
        const bestAsk = asks[0]?.[0] || 1;
        const midPrice = (bestBid + bestAsk) / 2;

        results.set(tokenId, { bids, asks, midPrice });
      } catch {
        results.set(tokenId, null);
      }
    });

    await Promise.all(promises);
  }

  return results;
}

// =============================================================================
// EXECUTION SERVICE
// =============================================================================

export function createExecutionService(config: ExecutionConfig): ExecutionService {
  const maxOrderSize = config.maxOrderSize || 1000; // Default $1000 max

  // ==========================================================================
  // REAL-TIME FILL TRACKING (Polymarket WebSocket)
  // ==========================================================================
  let userWs: UserWebSocket | null = null;
  const trackedFills = new Map<string, TrackedFill>();
  const trackedOrders = new Map<string, TrackedOrder>();
  const fillCallbacks = new Set<(fill: TrackedFill) => void>();
  const orderCallbacks = new Set<(order: TrackedOrder) => void>();
  const fillWaiters = new Map<string, Array<(fill: TrackedFill | null) => void>>();

  // Circuit breaker integration
  let circuitBreaker: CircuitBreaker | null = null;

  function handleFillEvent(event: FillEvent): void {
    const fill: TrackedFill = {
      orderId: event.orderId,
      marketId: event.marketId,
      tokenId: event.tokenId,
      side: event.side.toLowerCase() as OrderSide,
      size: event.size,
      price: event.price,
      status: event.status,
      transactionHash: event.transactionHash,
      timestamp: event.timestamp,
      receivedAt: Date.now(),
    };

    // Update or insert (only if higher priority status)
    const existing = trackedFills.get(event.orderId);
    if (!existing || getStatusPriority(fill.status) > getStatusPriority(existing.status)) {
      trackedFills.set(event.orderId, fill);
      logger.info({ fill }, 'Fill tracked via WebSocket');

      // Notify subscribers
      for (const callback of fillCallbacks) {
        try {
          callback(fill);
        } catch (err) {
          logger.error({ err }, 'Fill callback error');
        }
      }

      // Resolve waiters if CONFIRMED or FAILED
      if (fill.status === 'CONFIRMED' || fill.status === 'FAILED') {
        const waiters = fillWaiters.get(event.orderId);
        if (waiters) {
          for (const resolve of waiters) {
            resolve(fill);
          }
          fillWaiters.delete(event.orderId);
        }
      }
    }
  }

  function handleOrderEvent(event: OrderEvent): void {
    const order: TrackedOrder = {
      orderId: event.orderId,
      marketId: event.marketId,
      tokenId: event.tokenId,
      type: event.type,
      side: event.side.toLowerCase() as OrderSide,
      price: event.price,
      originalSize: event.originalSize,
      sizeMatched: event.sizeMatched,
      timestamp: event.timestamp,
      receivedAt: Date.now(),
    };

    trackedOrders.set(event.orderId, order);
    logger.info({ order }, 'Order event tracked via WebSocket');

    // Notify subscribers
    for (const callback of orderCallbacks) {
      try {
        callback(order);
      } catch (err) {
        logger.error({ err }, 'Order callback error');
      }
    }
  }

  function getStatusPriority(status: TrackedFill['status']): number {
    switch (status) {
      case 'MATCHED': return 1;
      case 'MINED': return 2;
      case 'CONFIRMED': return 3;
      case 'FAILED': return 0;
      default: return -1;
    }
  }

  async function connectFillsWebSocket(): Promise<void> {
    if (!config.polymarket) {
      throw new Error('Polymarket not configured');
    }

    if (userWs?.isConnected()) {
      return;
    }

    const userId = config.polymarket.funderAddress || config.polymarket.apiKey;
    userWs = createUserWebSocket(userId, {
      privateKey: config.polymarket.privateKey || '',
      apiKey: config.polymarket.apiKey,
      apiSecret: config.polymarket.apiSecret,
      apiPassphrase: config.polymarket.apiPassphrase,
      funderAddress: config.polymarket.funderAddress || '',
    });

    userWs.on('fill', handleFillEvent);
    userWs.on('order', handleOrderEvent);
    userWs.on('error', (err) => {
      logger.error({ err }, 'Fills WebSocket error');
    });

    await userWs.connect();
    logger.info('Fills WebSocket connected - real-time order confirmations enabled');
  }

  function disconnectFillsWebSocket(): void {
    if (userWs) {
      userWs.disconnect();
      userWs = null;
      logger.info('Fills WebSocket disconnected');
    }
  }

  // ==========================================================================
  // ORDER HEARTBEAT (Polymarket - orders cancelled if no heartbeat within 10s)
  // ==========================================================================
  let heartbeatId: string | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  const HEARTBEAT_INTERVAL_MS = 8000; // 8s to be safe (10s timeout)

  async function postHeartbeat(existingId?: string): Promise<string> {
    if (!config.polymarket) {
      throw new Error('Polymarket not configured');
    }

    const url = `${POLY_CLOB_URL}/heartbeat`;
    const body = existingId ? { heartbeat_id: existingId } : {};

    const headers = buildPolymarketHeadersForUrl(
      {
        address: config.polymarket.funderAddress || '',
        apiKey: config.polymarket.apiKey,
        apiSecret: config.polymarket.apiSecret,
        apiPassphrase: config.polymarket.apiPassphrase,
      },
      'POST',
      url
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Heartbeat failed: ${response.status} ${text}`);
    }

    const data = await response.json() as { heartbeat_id?: string };
    return data.heartbeat_id || existingId || '';
  }

  async function startHeartbeat(): Promise<string> {
    if (heartbeatInterval) {
      // Already running, just return current ID
      if (heartbeatId) return heartbeatId;
    }

    // Initial heartbeat
    heartbeatId = await postHeartbeat();
    logger.info({ heartbeatId }, 'Polymarket heartbeat started');

    // Start recurring heartbeat
    heartbeatInterval = setInterval(async () => {
      try {
        heartbeatId = await postHeartbeat(heartbeatId || undefined);
        logger.debug({ heartbeatId }, 'Heartbeat sent');
      } catch (err) {
        logger.error({ err }, 'Heartbeat failed - orders may be cancelled');
      }
    }, HEARTBEAT_INTERVAL_MS);

    return heartbeatId;
  }

  async function sendHeartbeat(id: string): Promise<string> {
    heartbeatId = await postHeartbeat(id);
    return heartbeatId;
  }

  function stopHeartbeat(): void {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    heartbeatId = null;
    logger.info('Polymarket heartbeat stopped');
  }

  function isHeartbeatActive(): boolean {
    return heartbeatInterval !== null;
  }

  function waitForFill(orderId: string, timeoutMs = 60000): Promise<TrackedFill | null> {
    // Check if already have a confirmed/failed fill
    const existing = trackedFills.get(orderId);
    if (existing && (existing.status === 'CONFIRMED' || existing.status === 'FAILED')) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        const waiters = fillWaiters.get(orderId);
        if (waiters) {
          const idx = waiters.indexOf(resolve);
          if (idx !== -1) waiters.splice(idx, 1);
          if (waiters.length === 0) fillWaiters.delete(orderId);
        }
        resolve(null); // Timeout - return null
      }, timeoutMs);

      // Add to waiters
      const resolveWrapper = (fill: TrackedFill | null) => {
        clearTimeout(timeout);
        resolve(fill);
      };

      if (!fillWaiters.has(orderId)) {
        fillWaiters.set(orderId, []);
      }
      fillWaiters.get(orderId)!.push(resolveWrapper);
    });
  }

  // ==========================================================================

  function validateOrder(request: OrderRequest): string | null {
    // Circuit breaker check - block orders when tripped
    if (circuitBreaker && !circuitBreaker.canTrade()) {
      const state = circuitBreaker.getState();
      return `Trading blocked by circuit breaker: ${state.tripReason || 'tripped'}. Reset at: ${state.resetAt?.toISOString() || 'manual reset required'}`;
    }

    const notional = request.price * request.size;

    if (notional > maxOrderSize) {
      return `Order size $${notional.toFixed(2)} exceeds max $${maxOrderSize}`;
    }

    if (request.price < 0.01 || request.price > 0.99) {
      return `Price ${request.price} out of range [0.01, 0.99]`;
    }

    if (request.size <= 0) {
      return `Invalid size: ${request.size}`;
    }

    return null;
  }

  async function executeOrder(request: OrderRequest): Promise<OrderResult> {
    // Validate
    const error = validateOrder(request);
    if (error) {
      return { success: false, error };
    }

    // Dry run mode
    if (config.dryRun) {
      logger.info({ ...request, dryRun: true }, 'Dry run order');
      return {
        success: true,
        orderId: `dry_${randomBytes(8).toString('hex')}`,
        status: 'open',
      };
    }

    // Execute on appropriate platform
    if (request.platform === 'polymarket') {
      if (!config.polymarket) {
        return { success: false, error: 'Polymarket not configured' };
      }
      if (!request.tokenId) {
        return { success: false, error: 'tokenId required for Polymarket' };
      }

      return placePolymarketOrder(
        config.polymarket,
        request.tokenId,
        request.side,
        request.price,
        request.size,
        request.orderType,
        request.negRisk,
        request.postOnly
      );
    }

    if (request.platform === 'kalshi') {
      if (!config.kalshi) {
        return { success: false, error: 'Kalshi not configured' };
      }

      const outcome = request.outcome?.toLowerCase() as 'yes' | 'no' || 'yes';

      return placeKalshiOrder(
        config.kalshi,
        request.marketId,
        outcome,
        request.side,
        request.price,
        request.size,
        request.orderType
      );
    }

    if (request.platform === 'opinion') {
      if (!config.opinion) {
        return { success: false, error: 'Opinion not configured' };
      }
      if (!request.tokenId) {
        return { success: false, error: 'tokenId required for Opinion' };
      }

      return placeOpinionOrder(
        config.opinion,
        request.tokenId,
        request.side,
        request.price,
        request.size,
        request.orderType
      );
    }

    if (request.platform === 'predictfun') {
      if (!config.predictfun) {
        return { success: false, error: 'PredictFun not configured' };
      }
      if (!request.tokenId) {
        return { success: false, error: 'tokenId required for PredictFun' };
      }

      return placePredictFunOrder(
        config.predictfun,
        request.tokenId,
        request.side,
        request.price,
        request.size,
        request.marketId
      );
    }

    return { success: false, error: `Unknown platform: ${request.platform}` };
  }

  const service: ExecutionService = {
    async buyLimit(request) {
      return executeOrder({ ...request, side: 'buy', orderType: request.orderType || 'GTC' });
    },

    async sellLimit(request) {
      return executeOrder({ ...request, side: 'sell', orderType: request.orderType || 'GTC' });
    },

    async marketBuy(request) {
      // Market orders use FOK (Fill or Kill)
      // Price is set to max (0.99) to ensure fill
      return executeOrder({ ...request, side: 'buy', price: 0.99, orderType: 'FOK' });
    },

    async marketSell(request) {
      // Price is set to min (0.01) to ensure fill
      return executeOrder({ ...request, side: 'sell', price: 0.01, orderType: 'FOK' });
    },

    async makerBuy(request) {
      return executeOrder({ ...request, side: 'buy', orderType: 'GTC', postOnly: true });
    },

    async makerSell(request) {
      return executeOrder({ ...request, side: 'sell', orderType: 'GTC', postOnly: true });
    },

    async cancelOrder(platform, orderId) {
      if (config.dryRun) {
        logger.info({ platform, orderId, dryRun: true }, 'Dry run cancel');
        return true;
      }

      if (platform === 'polymarket' && config.polymarket) {
        return cancelPolymarketOrder(config.polymarket, orderId);
      }

      if (platform === 'kalshi' && config.kalshi) {
        return cancelKalshiOrder(config.kalshi, orderId);
      }

      if (platform === 'opinion' && config.opinion) {
        return cancelOpinionOrder(config.opinion, orderId);
      }

      if (platform === 'predictfun' && config.predictfun) {
        return cancelPredictFunOrder(config.predictfun, orderId);
      }

      return false;
    },

    async cancelAllOrders(platform, marketId) {
      if (config.dryRun) {
        logger.info({ platform, marketId, dryRun: true }, 'Dry run cancel all');
        return 0;
      }

      let count = 0;

      if ((!platform || platform === 'polymarket') && config.polymarket) {
        count += await cancelAllPolymarketOrders(config.polymarket, marketId);
      }

      // Kalshi: fetch open orders, batch cancel matching ones
      if ((!platform || platform === 'kalshi') && config.kalshi) {
        const orders = await getKalshiOpenOrders(config.kalshi);
        const toCancel = orders
          .filter(o => !marketId || o.marketId === marketId)
          .map(o => o.orderId);
        if (toCancel.length > 0) {
          const results = await cancelKalshiOrdersBatch(config.kalshi, toCancel);
          count += results.filter(r => r.success).length;
        }
      }

      // Opinion: use SDK's cancelAllOrders (handles batch internally)
      if ((!platform || platform === 'opinion') && config.opinion) {
        count += await cancelAllOpinionOrders(config.opinion, marketId);
      }

      // PredictFun has bulk cancel support
      if ((!platform || platform === 'predictfun') && config.predictfun) {
        if (marketId) {
          // Filter by market if specified
          const orders = await getPredictFunOpenOrders(config.predictfun);
          for (const order of orders) {
            if (order.marketId === marketId) {
              if (await cancelPredictFunOrder(config.predictfun, order.orderId)) {
                count++;
              }
            }
          }
        } else {
          count += await cancelAllPredictFunOrders(config.predictfun);
        }
      }

      return count;
    },

    async getOpenOrders(platform) {
      const orders: OpenOrder[] = [];

      if ((!platform || platform === 'polymarket') && config.polymarket) {
        const polyOrders = await getPolymarketOpenOrders(config.polymarket);
        orders.push(...polyOrders);
      }

      if ((!platform || platform === 'kalshi') && config.kalshi) {
        const kalshiOrders = await getKalshiOpenOrders(config.kalshi);
        orders.push(...kalshiOrders);
      }

      if ((!platform || platform === 'opinion') && config.opinion) {
        const opinionOrders = await getOpinionOpenOrders(config.opinion);
        orders.push(...opinionOrders);
      }

      if ((!platform || platform === 'predictfun') && config.predictfun) {
        const predictfunOrders = await getPredictFunOpenOrders(config.predictfun);
        orders.push(...predictfunOrders);
      }

      return orders;
    },

    async getOrder(platform, orderId) {
      const orders = await this.getOpenOrders(platform);
      return orders.find((o) => o.orderId === orderId) || null;
    },

    async estimateFill(request) {
      try {
        let orderbook: OrderbookData | null = null;

        if (request.platform === 'polymarket' && request.tokenId) {
          orderbook = await fetchPolymarketOrderbook(request.tokenId);
        } else if (request.platform === 'kalshi') {
          orderbook = await fetchKalshiOrderbook(request.marketId);
        } else if (request.platform === 'opinion' && request.tokenId) {
          orderbook = await fetchOpinionOrderbook(request.tokenId);
        } else if (request.platform === 'predictfun' && config.predictfun) {
          orderbook = await fetchPredictFunOrderbook(config.predictfun, request.marketId);
        }

        if (!orderbook) {
          return { avgPrice: request.price, filledSize: request.size };
        }

        const orders = request.side === 'buy' ? orderbook.asks : orderbook.bids;
        const { avgFillPrice, totalFilled } = calculateFillFromOrderbook(orders, request.size, request.side);

        return {
          avgPrice: totalFilled > 0 ? avgFillPrice : request.price,
          filledSize: totalFilled,
        };
      } catch {
        return { avgPrice: request.price, filledSize: request.size };
      }
    },

    async protectedBuy(request, maxSlippageOverride) {
      const slippageConfig = {
        maxSlippage: 0.02, // 2% default
        checkOrderbook: true,
        autoCancel: true,
        useLimitOrders: true,
        limitPriceBuffer: 0.01,
        ...config.slippageProtection,
      };

      const maxSlippage = maxSlippageOverride ?? request.maxSlippage ?? slippageConfig.maxSlippage;

      // Estimate slippage before executing
      const slippageEstimate = await this.estimateSlippage({ ...request, side: 'buy' });

      if (slippageEstimate.slippage > maxSlippage) {
        logger.warn(
          { slippage: slippageEstimate.slippage, maxSlippage, request },
          'Slippage protection triggered - order rejected'
        );
        return {
          success: false,
          error: `Slippage ${(slippageEstimate.slippage * 100).toFixed(2)}% exceeds max ${(maxSlippage * 100).toFixed(2)}%`,
        };
      }

      // Use limit order with buffer if enabled
      if (slippageConfig.useLimitOrders) {
        const limitPrice = Math.min(0.99, slippageEstimate.expectedPrice * (1 + slippageConfig.limitPriceBuffer));
        return executeOrder({
          ...request,
          side: 'buy',
          price: limitPrice,
          orderType: 'GTC',
        });
      }

      return executeOrder({ ...request, side: 'buy', orderType: request.orderType || 'GTC' });
    },

    async protectedSell(request, maxSlippageOverride) {
      const slippageConfig = {
        maxSlippage: 0.02,
        checkOrderbook: true,
        autoCancel: true,
        useLimitOrders: true,
        limitPriceBuffer: 0.01,
        ...config.slippageProtection,
      };

      const maxSlippage = maxSlippageOverride ?? request.maxSlippage ?? slippageConfig.maxSlippage;

      // Estimate slippage before executing
      const slippageEstimate = await this.estimateSlippage({ ...request, side: 'sell' });

      if (slippageEstimate.slippage > maxSlippage) {
        logger.warn(
          { slippage: slippageEstimate.slippage, maxSlippage, request },
          'Slippage protection triggered - order rejected'
        );
        return {
          success: false,
          error: `Slippage ${(slippageEstimate.slippage * 100).toFixed(2)}% exceeds max ${(maxSlippage * 100).toFixed(2)}%`,
        };
      }

      // Use limit order with buffer if enabled
      if (slippageConfig.useLimitOrders) {
        const limitPrice = Math.max(0.01, slippageEstimate.expectedPrice * (1 - slippageConfig.limitPriceBuffer));
        return executeOrder({
          ...request,
          side: 'sell',
          price: limitPrice,
          orderType: 'GTC',
        });
      }

      return executeOrder({ ...request, side: 'sell', orderType: request.orderType || 'GTC' });
    },

    async estimateSlippage(request) {
      try {
        // Fetch orderbook based on platform
        let orderbook: { bids: [number, number][]; asks: [number, number][]; midPrice: number } | null = null;

        if (request.platform === 'polymarket' && request.tokenId) {
          orderbook = await fetchPolymarketOrderbook(request.tokenId);
        } else if (request.platform === 'kalshi') {
          orderbook = await fetchKalshiOrderbook(request.marketId);
        } else if (request.platform === 'opinion' && request.tokenId) {
          orderbook = await fetchOpinionOrderbook(request.tokenId);
        } else if (request.platform === 'predictfun' && config.predictfun) {
          orderbook = await fetchPredictFunOrderbook(config.predictfun, request.marketId);
        }

        if (!orderbook || (orderbook.bids.length === 0 && orderbook.asks.length === 0)) {
          // Fallback to heuristic estimate if no orderbook
          const baseSlippage = 0.005;
          const sizeImpact = Math.min(0.05, request.size * 0.0001);
          const estimatedSlippage = baseSlippage + sizeImpact;
          return {
            slippage: estimatedSlippage,
            expectedPrice: request.side === 'buy'
              ? request.price * (1 + estimatedSlippage)
              : request.price * (1 - estimatedSlippage),
          };
        }

        // Calculate average fill price by walking through orderbook
        const { avgFillPrice, totalFilled } = calculateFillFromOrderbook(
          request.side === 'buy' ? orderbook.asks : orderbook.bids,
          request.size,
          request.side
        );

        if (totalFilled < request.size * 0.5) {
          // Less than 50% can be filled - high slippage market
          logger.warn(
            { request, totalFilled, requested: request.size },
            'Orderbook too thin - less than 50% fillable'
          );
        }

        // Calculate slippage relative to mid price
        const midPrice = orderbook.midPrice || request.price;
        const slippage = request.side === 'buy'
          ? (avgFillPrice - midPrice) / midPrice
          : (midPrice - avgFillPrice) / midPrice;

        return {
          slippage: Math.max(0, slippage),
          expectedPrice: avgFillPrice,
        };
      } catch (error) {
        logger.warn({ error, request }, 'Failed to estimate slippage from orderbook');
        // Fallback to heuristic
        const baseSlippage = 0.005;
        const sizeImpact = Math.min(0.05, request.size * 0.0001);
        return {
          slippage: baseSlippage + sizeImpact,
          expectedPrice: request.side === 'buy'
            ? request.price * (1 + baseSlippage + sizeImpact)
            : request.price * (1 - baseSlippage - sizeImpact),
        };
      }
    },

    async placeOrdersBatch(orders) {
      const polyOrders = orders.filter(o => o.platform === 'polymarket');
      const kalshiOrders = orders.filter(o => o.platform === 'kalshi');
      const opinionOrders = orders.filter(o => o.platform === 'opinion');
      const predictfunOrders = orders.filter(o => o.platform === 'predictfun');
      const otherOrders = orders.filter(o => o.platform !== 'opinion' && o.platform !== 'polymarket' && o.platform !== 'kalshi' && o.platform !== 'predictfun');

      const results: OrderResult[] = [];

      // Execute Polymarket batch if we have Polymarket orders and config
      if (polyOrders.length > 0 && config.polymarket) {
        try {
          const batchInput = polyOrders.map(o => ({
            tokenId: o.tokenId!,
            side: o.side,
            price: o.price,
            size: o.size,
            negRisk: o.negRisk,
            postOnly: o.postOnly,
          }));
          const batchResults = await placePolymarketOrdersBatch(config.polymarket, batchInput);
          results.push(...batchResults);
        } catch (err) {
          results.push(...polyOrders.map(() => ({
            success: false,
            error: err instanceof Error ? err.message : 'Batch order failed',
          })));
        }
      } else if (polyOrders.length > 0) {
        results.push(...polyOrders.map(() => ({
          success: false,
          error: 'Polymarket trading not configured',
        })));
      }

      // Execute Kalshi batch if we have Kalshi orders and config
      if (kalshiOrders.length > 0 && config.kalshi) {
        try {
          const batchInput = kalshiOrders.map(o => ({
            ticker: o.marketId,
            side: (o.outcome?.toLowerCase() as 'yes' | 'no') || 'yes',
            action: o.side,
            price: o.price,
            count: o.size,
          }));
          const batchResults = await placeKalshiOrdersBatch(config.kalshi, batchInput);
          results.push(...batchResults);
        } catch (err) {
          results.push(...kalshiOrders.map(() => ({
            success: false,
            error: err instanceof Error ? err.message : 'Batch order failed',
          })));
        }
      } else if (kalshiOrders.length > 0) {
        results.push(...kalshiOrders.map(() => ({
          success: false,
          error: 'Kalshi trading not configured',
        })));
      }

      // Execute Opinion batch if we have Opinion orders and config
      if (opinionOrders.length > 0 && config.opinion) {
        try {
          const batchInput = opinionOrders.map(o => ({
            marketId: parseInt(o.marketId, 10),
            tokenId: o.tokenId!,
            side: o.side.toUpperCase() as 'BUY' | 'SELL',
            price: o.price,
            amount: o.size,
          }));

          const batchResults = await placeOpinionOrdersBatch(config.opinion, batchInput);
          results.push(...batchResults.map(r => ({
            success: r.success,
            orderId: r.orderId,
            error: r.error,
          })));
        } catch (err) {
          // All Opinion orders failed
          results.push(...opinionOrders.map(() => ({
            success: false,
            error: err instanceof Error ? err.message : 'Batch order failed',
          })));
        }
      } else if (opinionOrders.length > 0) {
        // No Opinion config
        results.push(...opinionOrders.map(() => ({
          success: false,
          error: 'Opinion trading not configured',
        })));
      }

      // Execute PredictFun orders (no native batch API — sequential via SDK with EIP-712 signing)
      if (predictfunOrders.length > 0 && config.predictfun) {
        for (const order of predictfunOrders) {
          try {
            const result = await placePredictFunOrder(
              config.predictfun,
              order.tokenId!,
              order.side,
              order.price,
              order.size,
              order.marketId
            );
            results.push(result);
          } catch (err) {
            results.push({
              success: false,
              error: err instanceof Error ? err.message : 'Order failed',
            });
          }
        }
      } else if (predictfunOrders.length > 0) {
        results.push(...predictfunOrders.map(() => ({
          success: false,
          error: 'PredictFun trading not configured',
        })));
      }

      // Execute other orders individually (fallback)
      for (const order of otherOrders) {
        try {
          const result = order.side === 'buy'
            ? await this.buyLimit(order)
            : await this.sellLimit(order);
          results.push(result);
        } catch (err) {
          results.push({
            success: false,
            error: err instanceof Error ? err.message : 'Order failed',
          });
        }
      }

      return results;
    },

    async cancelOrdersBatch(platform, orderIds) {
      if (platform === 'polymarket' && config.polymarket) {
        try {
          return await cancelPolymarketOrdersBatch(config.polymarket, orderIds);
        } catch (err) {
          return orderIds.map(orderId => ({ orderId, success: false }));
        }
      }

      if (platform === 'kalshi' && config.kalshi) {
        try {
          return await cancelKalshiOrdersBatch(config.kalshi, orderIds);
        } catch (err) {
          return orderIds.map(orderId => ({ orderId, success: false }));
        }
      }

      if (platform === 'opinion' && config.opinion) {
        try {
          return await cancelOpinionOrdersBatch(config.opinion, orderIds);
        } catch (err) {
          return orderIds.map(orderId => ({
            orderId,
            success: false,
          }));
        }
      }

      if (platform === 'predictfun' && config.predictfun) {
        // PredictFun cancel requires isNegRisk/isYieldBearing — cancel individually via SDK
        const results: Array<{ orderId: string; success: boolean }> = [];
        for (const orderId of orderIds) {
          const success = await cancelPredictFunOrder(config.predictfun, orderId);
          results.push({ orderId, success });
        }
        return results;
      }

      // Fallback: cancel individually
      const results: Array<{ orderId: string; success: boolean }> = [];
      for (const orderId of orderIds) {
        try {
          const success = await this.cancelOrder(platform, orderId);
          results.push({ orderId, success });
        } catch {
          results.push({ orderId, success: false });
        }
      }
      return results;
    },

    // =========================================================================
    // REAL-TIME FILL TRACKING (Polymarket WebSocket)
    // =========================================================================

    async connectFillsWebSocket() {
      return connectFillsWebSocket();
    },

    disconnectFillsWebSocket() {
      disconnectFillsWebSocket();
    },

    isFillsWebSocketConnected() {
      return userWs?.isConnected() ?? false;
    },

    onFill(callback: (fill: TrackedFill) => void) {
      fillCallbacks.add(callback);
      return () => {
        fillCallbacks.delete(callback);
      };
    },

    onOrder(callback: (order: TrackedOrder) => void) {
      orderCallbacks.add(callback);
      return () => {
        orderCallbacks.delete(callback);
      };
    },

    getTrackedFills() {
      return Array.from(trackedFills.values());
    },

    getTrackedFill(orderId: string) {
      return trackedFills.get(orderId);
    },

    clearOldFills(maxAgeMs = 3600000) { // Default 1 hour
      const now = Date.now();
      let cleared = 0;
      for (const [orderId, fill] of trackedFills) {
        if (now - fill.receivedAt > maxAgeMs) {
          trackedFills.delete(orderId);
          cleared++;
        }
      }
      // Also clear old orders
      for (const [orderId, order] of trackedOrders) {
        if (now - order.receivedAt > maxAgeMs) {
          trackedOrders.delete(orderId);
        }
      }
      return cleared;
    },

    waitForFill(orderId: string, timeoutMs?: number) {
      return waitForFill(orderId, timeoutMs);
    },

    // =========================================================================
    // POLYMARKET ORDER HEARTBEAT
    // =========================================================================

    async startHeartbeat() {
      return startHeartbeat();
    },

    async sendHeartbeat(id: string) {
      return sendHeartbeat(id);
    },

    stopHeartbeat() {
      stopHeartbeat();
    },

    isHeartbeatActive() {
      return isHeartbeatActive();
    },

    // =========================================================================
    // POLYMARKET SETTLEMENT
    // =========================================================================

    async getPendingSettlements() {
      if (!config.polymarket) {
        return [];
      }
      return getPolymarketPendingSettlements(
        config.polymarket,
        config.polymarket.funderAddress
      );
    },

    // =========================================================================
    // POLYMARKET COLLATERAL APPROVAL
    // =========================================================================

    async approveUSDC(amount?: number) {
      if (!config.polymarket?.privateKey) {
        return {
          success: false,
          error: 'Polymarket private key not configured',
        };
      }
      // Approve for both CTF exchanges
      const spender = POLY_CTF_EXCHANGE;
      return approvePolymarketUSDC(config.polymarket.privateKey, spender, amount);
    },

    async getUSDCAllowance() {
      if (!config.polymarket) {
        return 0;
      }
      const owner = config.polymarket.funderAddress || config.polymarket.address;
      return getPolymarketUSDCAllowance(owner, POLY_CTF_EXCHANGE);
    },

    // =========================================================================
    // BATCH ORDERBOOK FETCHING
    // =========================================================================

    async getOrderbooksBatch(tokenIds: string[]) {
      return getPolymarketOrderbooksBatch(tokenIds);
    },

    // =========================================================================
    // CIRCUIT BREAKER INTEGRATION
    // =========================================================================

    setCircuitBreaker(breaker: CircuitBreaker | null) {
      circuitBreaker = breaker;
      if (breaker) {
        logger.info('Circuit breaker enabled for order validation');
      } else {
        logger.info('Circuit breaker disabled');
      }
    },

    getCircuitBreakerState() {
      return circuitBreaker?.getState() ?? null;
    },
  };

  return service;
}

// Export types
export type { PolymarketApiKeyAuth, KalshiApiKeyAuth, OpinionApiAuth };

// Exchange addresses
export const POLYMARKET_EXCHANGES = {
  CTF: POLY_CTF_EXCHANGE,
  NEG_RISK_CTF: POLY_NEG_RISK_CTF_EXCHANGE,
};

// Re-export sub-modules
export * from './smart-router';
export * from './mev-protection';
export * from './circuit-breaker';
export * from './position-manager';
export * from './futures';
export * from './auto-redeem';
export * from './twap';
export * from './bracket-orders';
export * from './trigger-orders';
