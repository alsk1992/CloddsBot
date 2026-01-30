/**
 * Execution Service - Native TypeScript order execution
 *
 * Features:
 * - Limit orders (GTC)
 * - Market orders (FOK)
 * - Maker orders (POST_ONLY)
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

// =============================================================================
// TYPES
// =============================================================================

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'GTC' | 'FOK' | 'GTD' | 'POST_ONLY';
export type OrderStatus = 'pending' | 'open' | 'filled' | 'cancelled' | 'expired' | 'rejected';

export interface OrderRequest {
  platform: 'polymarket' | 'kalshi';
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
  platform: 'polymarket' | 'kalshi';
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

  // Maker orders (POST_ONLY - avoid taker fees)
  makerBuy(request: Omit<OrderRequest, 'side' | 'orderType'>): Promise<OrderResult>;
  makerSell(request: Omit<OrderRequest, 'side' | 'orderType'>): Promise<OrderResult>;

  // Slippage-protected orders (checks slippage before executing)
  protectedBuy(request: Omit<OrderRequest, 'side'>, maxSlippage?: number): Promise<OrderResult>;
  protectedSell(request: Omit<OrderRequest, 'side'>, maxSlippage?: number): Promise<OrderResult>;

  // Slippage estimation
  estimateSlippage(request: OrderRequest): Promise<{ slippage: number; expectedPrice: number }>;

  // Order management
  cancelOrder(platform: 'polymarket' | 'kalshi', orderId: string): Promise<boolean>;
  cancelAllOrders(platform?: 'polymarket' | 'kalshi', marketId?: string): Promise<number>;
  getOpenOrders(platform?: 'polymarket' | 'kalshi'): Promise<OpenOrder[]>;
  getOrder(platform: 'polymarket' | 'kalshi', orderId: string): Promise<OpenOrder | null>;

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
  negRisk?: boolean
): Promise<OrderResult> {
  const url = `${POLY_CLOB_URL}/order`;

  // Build order payload
  // Note: The CLOB API auto-detects neg_risk from token_id, but we can pass it explicitly
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
        request.negRisk
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
      return executeOrder({ ...request, side: 'buy', orderType: 'POST_ONLY' });
    },

    async makerSell(request) {
      return executeOrder({ ...request, side: 'sell', orderType: 'POST_ONLY' });
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
  };

  return service;
}

// Export types
export type { PolymarketApiKeyAuth, KalshiApiKeyAuth };

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
