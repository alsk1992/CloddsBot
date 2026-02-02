/**
 * Opinion.trade Handlers
 *
 * Platform handlers for Opinion.trade BNB Chain prediction market
 */

import * as opinion from '../../exchanges/opinion';
import type { ToolInput, HandlerResult, HandlerContext, HandlersMap } from './types';
import { safeHandler, errorResult, successResult } from './types';

// API Base URL
const API_BASE = 'https://proxy.opinion.trade:8443/openapi';

// Helper to get API key
function getApiKey(): string {
  return process.env.OPINION_API_KEY || '';
}

// Helper to get trading config
function getTradingConfig(): opinion.OpinionConfig {
  return {
    apiKey: process.env.OPINION_API_KEY || '',
    privateKey: process.env.OPINION_PRIVATE_KEY || '',
    vaultAddress: process.env.OPINION_VAULT_ADDRESS || '',
    dryRun: process.env.DRY_RUN === 'true',
  };
}

/**
 * opinion_markets - List markets
 */
async function marketsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const status = (toolInput.status as string) || 'active';
  const limit = (toolInput.limit as number) || 50;

  return safeHandler(async () => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status !== 'all') params.append('status', status);

    const response = await fetch(`${API_BASE}/market?${params}`, {
      headers: { 'apikey': getApiKey() },
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json() as { code: number; msg?: string; result?: unknown };
    if (data.code !== 0) throw new Error(data.msg || 'Request failed');
    return data.result;
  });
}

/**
 * opinion_market - Get market details
 */
async function marketHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;

  return safeHandler(async () => {
    const response = await fetch(`${API_BASE}/market/${marketId}`, {
      headers: { 'apikey': getApiKey() },
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json() as { code: number; msg?: string; result?: unknown };
    if (data.code !== 0) throw new Error(data.msg || 'Request failed');
    return data.result;
  });
}

/**
 * opinion_price - Get token price
 */
async function priceHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const tokenId = toolInput.token_id as string;

  return safeHandler(async () => {
    const response = await fetch(`${API_BASE}/token/latest-price?tokenId=${tokenId}`, {
      headers: { 'apikey': getApiKey() },
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json() as { code: number; msg?: string; result?: unknown };
    if (data.code !== 0) throw new Error(data.msg || 'Request failed');
    return data.result;
  });
}

/**
 * opinion_orderbook - Get orderbook
 */
async function orderbookHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const tokenId = toolInput.token_id as string;
  const depth = (toolInput.depth as number) || 10;

  return safeHandler(async () => {
    const response = await fetch(`${API_BASE}/token/orderbook?tokenId=${tokenId}&depth=${depth}`, {
      headers: { 'apikey': getApiKey() },
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json() as { code: number; msg?: string; result?: unknown };
    if (data.code !== 0) throw new Error(data.msg || 'Request failed');
    return data.result;
  });
}

/**
 * opinion_price_history - Get price history
 */
async function priceHistoryHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const tokenId = toolInput.token_id as string;
  const interval = (toolInput.interval as string) || '1h';
  const limit = (toolInput.limit as number) || 100;

  return safeHandler(async () => {
    const params = new URLSearchParams({
      tokenId,
      interval,
      limit: String(limit),
    });

    const response = await fetch(`${API_BASE}/token/price-history?${params}`, {
      headers: { 'apikey': getApiKey() },
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json() as { code: number; msg?: string; result?: unknown };
    if (data.code !== 0) throw new Error(data.msg || 'Request failed');
    return data.result;
  });
}

/**
 * opinion_quote_tokens - Get quote tokens
 */
async function quoteTokensHandler(): Promise<HandlerResult> {
  return safeHandler(async () => {
    const response = await fetch(`${API_BASE}/quote-token`, {
      headers: { 'apikey': getApiKey() },
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json() as { code: number; msg?: string; result?: unknown };
    if (data.code !== 0) throw new Error(data.msg || 'Request failed');
    return data.result;
  });
}

/**
 * opinion_place_order - Place an order
 */
async function placeOrderHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const marketId = toolInput.market_id as number;
  const tokenId = toolInput.token_id as string;
  const side = toolInput.side as 'BUY' | 'SELL';
  const price = toolInput.price as number;
  const amount = toolInput.amount as number;
  const orderType = (toolInput.order_type as 'LIMIT' | 'MARKET') || 'LIMIT';

  const config = getTradingConfig();

  return safeHandler(async () => {
    const result = await opinion.placeOrder(config, marketId, tokenId, side, price, amount, orderType);
    return result;
  });
}

/**
 * opinion_cancel_order - Cancel an order
 */
async function cancelOrderHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const orderId = toolInput.order_id as string;
  const config = getTradingConfig();

  return safeHandler(async () => {
    const result = await opinion.cancelOrder(config, orderId);
    return result;
  });
}

/**
 * opinion_cancel_all_orders - Cancel all orders
 */
async function cancelAllOrdersHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as number | undefined;
  const config = getTradingConfig();

  return safeHandler(async () => {
    const result = await opinion.cancelAllOrders(config, marketId);
    return result;
  });
}

/**
 * opinion_orders - Get open orders
 */
async function ordersHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as number | undefined;
  const config = getTradingConfig();

  return safeHandler(async () => {
    const result = await opinion.getOpenOrders(config, marketId);
    return result;
  });
}

/**
 * opinion_positions - Get positions
 */
async function positionsHandler(): Promise<HandlerResult> {
  const config = getTradingConfig();

  return safeHandler(async () => {
    const result = await opinion.getPositions(config);
    return result;
  });
}

/**
 * opinion_balances - Get balances
 */
async function balancesHandler(): Promise<HandlerResult> {
  const config = getTradingConfig();

  return safeHandler(async () => {
    const result = await opinion.getBalances(config);
    return result;
  });
}

/**
 * opinion_trades - Get trade history
 */
async function tradesHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as number | undefined;
  const config = getTradingConfig();

  return safeHandler(async () => {
    const result = await opinion.getTrades(config, marketId);
    return result;
  });
}

/**
 * opinion_redeem - Redeem shares for winning positions
 */
async function redeemHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as number;
  const config = getTradingConfig();

  return safeHandler(async () => {
    const result = await opinion.redeem(config, marketId);
    return result;
  });
}

/**
 * opinion_categorical_market - Get categorical market info
 */
async function categoricalMarketHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;

  return safeHandler(async () => {
    const response = await fetch(`${API_BASE}/market/categorical/${marketId}`, {
      headers: { 'apikey': getApiKey() },
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json() as { code: number; msg?: string; result?: unknown };
    if (data.code !== 0) throw new Error(data.msg || 'Request failed');
    return data.result;
  });
}

/**
 * opinion_fee_rates - Get fee rates
 */
async function feeRatesHandler(): Promise<HandlerResult> {
  return safeHandler(async () => {
    const response = await fetch(`${API_BASE}/fee-rates`, {
      headers: { 'apikey': getApiKey() },
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json() as { code: number; msg?: string; result?: unknown };
    if (data.code !== 0) throw new Error(data.msg || 'Request failed');
    return data.result;
  });
}

/**
 * opinion_order_by_id - Get order by ID
 */
async function orderByIdHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const orderId = toolInput.order_id as string;
  const config = getTradingConfig();

  return safeHandler(async () => {
    const response = await fetch(`${API_BASE}/order/${orderId}`, {
      headers: { 'apikey': config.apiKey },
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json() as { code: number; msg?: string; result?: unknown };
    if (data.code !== 0) throw new Error(data.msg || 'Request failed');
    return data.result;
  });
}

/**
 * opinion_enable_trading - Enable trading on the account
 */
async function enableTradingHandler(): Promise<HandlerResult> {
  const config = getTradingConfig();

  return safeHandler(async () => {
    const result = await opinion.enableTrading(config);
    return result;
  });
}

/**
 * opinion_split - Split collateral into outcome tokens
 */
async function splitHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as number;
  const amount = toolInput.amount as number;
  const config = getTradingConfig();

  return safeHandler(async () => {
    const result = await opinion.split(config, marketId, amount);
    return result;
  });
}

/**
 * opinion_merge - Merge outcome tokens back into collateral
 */
async function mergeHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as number;
  const amount = toolInput.amount as number;
  const config = getTradingConfig();

  return safeHandler(async () => {
    const result = await opinion.merge(config, marketId, amount);
    return result;
  });
}

/**
 * All Opinion handlers exported as a map
 */
export const opinionHandlers: HandlersMap = {
  opinion_markets: marketsHandler,
  opinion_market: marketHandler,
  opinion_price: priceHandler,
  opinion_orderbook: orderbookHandler,
  opinion_price_history: priceHistoryHandler,
  opinion_quote_tokens: quoteTokensHandler,
  opinion_place_order: placeOrderHandler,
  opinion_cancel_order: cancelOrderHandler,
  opinion_cancel_all_orders: cancelAllOrdersHandler,
  opinion_orders: ordersHandler,
  opinion_positions: positionsHandler,
  opinion_balances: balancesHandler,
  opinion_trades: tradesHandler,
  opinion_redeem: redeemHandler,
  opinion_categorical_market: categoricalMarketHandler,
  opinion_fee_rates: feeRatesHandler,
  opinion_order_by_id: orderByIdHandler,
  opinion_enable_trading: enableTradingHandler,
  opinion_split: splitHandler,
  opinion_merge: mergeHandler,
};

export default opinionHandlers;
