/**
 * Lighter — Orderbook DEX on Arbitrum
 *
 * Full-featured integration for the Lighter on-chain orderbook.
 * Uses REST API via fetch (no npm deps).
 *
 * @see https://docs.lighter.xyz
 */

import { logger } from '../../utils/logger';

// =============================================================================
// CONSTANTS
// =============================================================================

const API_URL = 'https://api.lighter.xyz';

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

export async function getMarkets(): Promise<LighterMarket[]> {
  const data = await httpRequest<{ markets: LighterMarket[] }>('/api/v1/markets');
  return data.markets || [];
}

export async function getOrderbook(market: string, depth = 20): Promise<LighterOrderbook> {
  const data = await httpRequest<{
    bids: Array<{ price: string; size: string }>;
    asks: Array<{ price: string; size: string }>;
  }>(`/api/v1/orderbook/${encodeURIComponent(market)}?depth=${depth}`);

  return {
    market,
    bids: (data.bids || []).map(l => ({ price: parseFloat(l.price), size: parseFloat(l.size) })),
    asks: (data.asks || []).map(l => ({ price: parseFloat(l.price), size: parseFloat(l.size) })),
    timestamp: Date.now(),
  };
}

export async function getPrice(market: string): Promise<{ bid: number; ask: number; mid: number }> {
  const ob = await getOrderbook(market, 1);
  const bid = ob.bids[0]?.price || 0;
  const ask = ob.asks[0]?.price || 0;
  const mid = bid && ask ? (bid + ask) / 2 : bid || ask;
  return { bid, ask, mid };
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
          reduceOnly: params.reduceOnly || false,
          postOnly: params.postOnly || false,
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
