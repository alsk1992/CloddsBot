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
  buildKalshiHeadersForUrl,
  KalshiApiKeyAuth,
} from '../utils/kalshi-auth';
import {
  buildOpinionHeaders,
  OpinionApiAuth,
} from '../utils/opinion-auth';
import * as predictfun from '../exchanges/predictfun';

// =============================================================================
// TYPES
// =============================================================================

export type OrderSide = 'buy' | 'sell';
// Note: Polymarket supports GTC, GTD, FOK. POST_ONLY is achieved via postOnly boolean flag.
export type OrderType = 'GTC' | 'FOK' | 'GTD';
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
}

export interface ExecutionConfig {
  polymarket?: PolymarketApiKeyAuth & {
    privateKey?: string;  // For signing (optional, uses API key auth)
    funderAddress?: string;
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
  cancelOrdersBatch(platform: 'polymarket' | 'opinion', orderIds: string[]): Promise<Array<{ orderId: string; success: boolean }>>;

  // Utilities
  estimateFill(request: OrderRequest): Promise<{ avgPrice: number; filledSize: number }>;
}

// =============================================================================
// POLYMARKET EXECUTION
// =============================================================================

const POLY_CLOB_URL = 'https://clob.polymarket.com';

// Exchange contract addresses
const POLY_CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const POLY_NEG_RISK_CTF_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';

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

// =============================================================================
// ORDERBOOK FETCHING FOR SLIPPAGE CALCULATION
// =============================================================================

interface OrderbookData {
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
  auth: PolymarketApiKeyAuth,
  tokenId: string,
  side: OrderSide,
  price: number,
  size: number,
  orderType: OrderType = 'GTC',
  negRisk?: boolean,
  postOnly?: boolean
): Promise<OrderResult> {
  const url = `${POLY_CLOB_URL}/order`;

  // Build order payload
  // Note: The CLOB API auto-detects neg_risk from token_id, but we can pass it explicitly
  // Supported orderTypes: GTC, GTD, FOK (for market orders)
  // postOnly is a separate boolean parameter for GTC/GTD to ensure maker-only execution
  const order: Record<string, unknown> = {
    tokenID: tokenId,
    side: side.toUpperCase(),
    price: price.toString(),
    size: size.toString(),
    orderType: orderType,
    feeRateBps: '0', // Let API calculate
  };

  // If neg_risk is explicitly specified, include it
  if (negRisk !== undefined) {
    order.negRisk = negRisk;
  }

  // postOnly ensures order only adds liquidity (rejected if would take)
  if (postOnly === true) {
    order.postOnly = true;
  }

  const headers = buildPolymarketHeadersForUrl(auth, 'POST', url, order);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(order),
    });

    const data = (await response.json()) as PolymarketOrderResponse;

    if (!response.ok || data.errorMsg) {
      logger.error({ status: response.status, error: data.errorMsg }, 'Polymarket order failed');
      return {
        success: false,
        error: data.errorMsg || `HTTP ${response.status}`,
      };
    }

    const orderId = data.orderID || data.order_id;
    logger.info({ orderId, tokenId, side, price, size }, 'Polymarket order placed');

    return {
      success: true,
      orderId,
      status: 'open',
      transactionHash: data.transactionsHashes?.[0],
    };
  } catch (error) {
    logger.error({ error }, 'Error placing Polymarket order');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
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
 * Place multiple Polymarket orders in a single batch request (max 15).
 * Uses POST /orders endpoint.
 */
async function placePolymarketOrdersBatch(
  auth: PolymarketApiKeyAuth,
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
  if (orders.length > 15) {
    logger.warn({ count: orders.length }, 'Polymarket batch limit is 15, splitting');
  }

  // Process in chunks of 15
  const results: OrderResult[] = [];
  for (let i = 0; i < orders.length; i += 15) {
    const chunk = orders.slice(i, i + 15);
    const url = `${POLY_CLOB_URL}/orders`;

    const payload = chunk.map(o => {
      const order: Record<string, unknown> = {
        tokenID: o.tokenId,
        side: o.side.toUpperCase(),
        price: o.price.toString(),
        size: o.size.toString(),
        orderType: 'GTC',
        feeRateBps: '0',
      };
      if (o.negRisk !== undefined) order.negRisk = o.negRisk;
      if (o.postOnly === true) order.postOnly = true;
      return order;
    });

    const headers = buildPolymarketHeadersForUrl(auth, 'POST', url, payload);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

  return results;
}

/**
 * Cancel multiple Polymarket orders in a single batch request.
 * Uses DELETE /orders endpoint with array of order IDs.
 */
async function cancelPolymarketOrdersBatch(
  auth: PolymarketApiKeyAuth,
  orderIds: string[]
): Promise<Array<{ orderId: string; success: boolean }>> {
  if (orderIds.length === 0) return [];

  const url = `${POLY_CLOB_URL}/orders`;
  const headers = buildPolymarketHeadersForUrl(auth, 'DELETE', url, orderIds);

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(orderIds),
    });

    if (!response.ok) {
      logger.error({ status: response.status, count: orderIds.length }, 'Polymarket batch cancel failed');
      return orderIds.map(orderId => ({ orderId, success: false }));
    }

    const data = (await response.json()) as { canceled?: string[]; not_canceled?: Record<string, string> };
    const canceledSet = new Set(data.canceled || []);
    logger.info(
      { total: orderIds.length, canceled: canceledSet.size, notCanceled: Object.keys(data.not_canceled || {}).length },
      'Polymarket batch cancel completed',
    );

    return orderIds.map(orderId => ({ orderId, success: canceledSet.has(orderId) }));
  } catch (error) {
    logger.error({ error }, 'Error cancelling Polymarket orders batch');
    return orderIds.map(orderId => ({ orderId, success: false }));
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

// =============================================================================
// OPINION.TRADE EXECUTION
// =============================================================================

const OPINION_API_URL = 'https://proxy.opinion.trade:8443/openapi';

interface OpinionOrderResponse {
  orderId?: string;
  order_id?: string;
  success?: boolean;
  error?: string;
  message?: string;
  status?: string;
}

interface OpinionOpenOrder {
  id: string;
  orderId: string;
  marketId: number;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: string;
  size: string;
  filledSize: string;
  status: string;
  createdAt: string;
  type?: string;
}

async function placeOpinionOrder(
  auth: OpinionApiAuth & { privateKey?: string; multiSigAddress?: string },
  tokenId: string,
  side: OrderSide,
  price: number,
  size: number,
  orderType: OrderType = 'GTC'
): Promise<OrderResult> {
  const url = `${OPINION_API_URL}/order`;

  const order = {
    tokenId,
    side: side.toUpperCase(),
    price: price.toString(),
    size: size.toString(),
    type: orderType === 'FOK' ? 'MARKET' : 'LIMIT',
  };

  const headers = buildOpinionHeaders(auth);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(order),
    });

    const data = (await response.json()) as OpinionOrderResponse;

    if (!response.ok || data.error) {
      logger.error({ status: response.status, error: data.error || data.message }, 'Opinion order failed');
      return {
        success: false,
        error: data.error || data.message || `HTTP ${response.status}`,
      };
    }

    const orderId = data.orderId || data.order_id;
    logger.info({ orderId, tokenId, side, price, size }, 'Opinion order placed');

    return {
      success: true,
      orderId,
      status: 'open',
    };
  } catch (error) {
    logger.error({ error }, 'Error placing Opinion order');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function cancelOpinionOrder(auth: OpinionApiAuth, orderId: string): Promise<boolean> {
  const url = `${OPINION_API_URL}/order/${orderId}`;
  const headers = buildOpinionHeaders(auth);

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      logger.error({ status: response.status, orderId }, 'Failed to cancel Opinion order');
      return false;
    }

    logger.info({ orderId }, 'Opinion order cancelled');
    return true;
  } catch (error) {
    logger.error({ error, orderId }, 'Error cancelling Opinion order');
    return false;
  }
}

async function getOpinionOpenOrders(auth: OpinionApiAuth): Promise<OpenOrder[]> {
  const url = `${OPINION_API_URL}/orders?status=OPEN`;
  const headers = buildOpinionHeaders(auth);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to fetch Opinion orders');
      return [];
    }

    const data = (await response.json()) as { orders?: OpinionOpenOrder[] } | OpinionOpenOrder[];
    const orders = Array.isArray(data) ? data : (data.orders || []);

    return orders.map((o) => ({
      orderId: o.orderId || o.id,
      platform: 'opinion' as const,
      marketId: o.marketId?.toString() || '',
      tokenId: o.tokenId,
      side: o.side.toLowerCase() as OrderSide,
      price: parseFloat(o.price),
      originalSize: parseFloat(o.size),
      remainingSize: parseFloat(o.size) - parseFloat(o.filledSize || '0'),
      filledSize: parseFloat(o.filledSize || '0'),
      orderType: (o.type === 'MARKET' ? 'FOK' : 'GTC') as OrderType,
      status: o.status.toLowerCase() as OrderStatus,
      createdAt: new Date(o.createdAt),
    }));
  } catch (error) {
    logger.error({ error }, 'Error fetching Opinion orders');
    return [];
  }
}

async function placeOpinionOrdersBatch(
  auth: OpinionApiAuth & { privateKey?: string; multiSigAddress?: string },
  orders: Array<{
    marketId: number;
    tokenId: string;
    side: 'BUY' | 'SELL';
    price: number;
    amount: number;
  }>
): Promise<OrderResult[]> {
  const url = `${OPINION_API_URL}/orders/batch`;
  const headers = buildOpinionHeaders(auth);

  const orderInputs = orders.map(o => ({
    marketId: o.marketId,
    tokenId: o.tokenId,
    price: o.price.toString(),
    side: o.side,
    orderType: 'LIMIT_ORDER',
    ...(o.side === 'BUY'
      ? { makerAmountInQuoteToken: o.amount.toString() }
      : { makerAmountInBaseToken: o.amount.toString() }),
  }));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: orderInputs }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, 'Opinion batch order failed');
      return orders.map(() => ({ success: false, error: `HTTP ${response.status}` }));
    }

    const data = (await response.json()) as Array<{ orderId?: string; id?: string; error?: string }>;
    logger.info({ count: orders.length, successful: data.filter(r => r.orderId || r.id).length }, 'Opinion batch orders placed');

    return data.map(r => ({
      success: !r.error,
      orderId: r.orderId || r.id,
      error: r.error,
    }));
  } catch (error) {
    logger.error({ error }, 'Error placing Opinion batch orders');
    return orders.map(() => ({
      success: false,
      error: error instanceof Error ? error.message : 'Batch order failed',
    }));
  }
}

async function cancelOpinionOrdersBatch(
  auth: OpinionApiAuth,
  orderIds: string[]
): Promise<Array<{ orderId: string; success: boolean }>> {
  const url = `${OPINION_API_URL}/orders/cancel/batch`;
  const headers = buildOpinionHeaders(auth);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds }),
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'Opinion batch cancel failed');
      return orderIds.map(orderId => ({ orderId, success: false }));
    }

    const data = (await response.json()) as Array<{ orderId?: string; success?: boolean; error?: string }>;
    logger.info({ count: orderIds.length, successful: data.filter(r => r.success !== false).length }, 'Opinion batch cancel completed');

    return orderIds.map((orderId, i) => ({
      orderId,
      success: data[i]?.success !== false && !data[i]?.error,
    }));
  } catch (error) {
    logger.error({ error }, 'Error cancelling Opinion orders batch');
    return orderIds.map(orderId => ({ orderId, success: false }));
  }
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
    const response = await fetch(`${OPINION_API_URL}/token/orderbook?tokenId=${encodeURIComponent(tokenId)}`);
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
// EXECUTION SERVICE
// =============================================================================

export function createExecutionService(config: ExecutionConfig): ExecutionService {
  const maxOrderSize = config.maxOrderSize || 1000; // Default $1000 max

  function validateOrder(request: OrderRequest): string | null {
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

      // Kalshi doesn't have cancel-all endpoint, need to cancel individually
      if ((!platform || platform === 'kalshi') && config.kalshi) {
        const orders = await getKalshiOpenOrders(config.kalshi);
        for (const order of orders) {
          if (!marketId || order.marketId === marketId) {
            if (await cancelKalshiOrder(config.kalshi, order.orderId)) {
              count++;
            }
          }
        }
      }

      // Opinion doesn't have cancel-all endpoint, need to cancel individually
      if ((!platform || platform === 'opinion') && config.opinion) {
        const orders = await getOpinionOpenOrders(config.opinion);
        for (const order of orders) {
          if (!marketId || order.marketId === marketId) {
            if (await cancelOpinionOrder(config.opinion, order.orderId)) {
              count++;
            }
          }
        }
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
      const opinionOrders = orders.filter(o => o.platform === 'opinion');
      const otherOrders = orders.filter(o => o.platform !== 'opinion' && o.platform !== 'polymarket');

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
