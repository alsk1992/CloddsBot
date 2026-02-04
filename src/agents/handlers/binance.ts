/**
 * Binance Futures Handlers
 *
 * Platform handlers for Binance Futures perpetual trading.
 * Migrated from inline switch cases in agents/index.ts.
 */

import type { ToolInput, HandlerResult, HandlersMap, HandlerContext } from './types';
import { errorResult, successResult } from './types';
import type { BinanceFuturesConfig } from '../../exchanges/binance-futures';
import * as binanceFutures from '../../exchanges/binance-futures';

// =============================================================================
// HELPERS
// =============================================================================

function getBinanceConfig(): { config: BinanceFuturesConfig; dryRun: boolean } | null {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return {
    config: { apiKey, apiSecret },
    dryRun: process.env.DRY_RUN === 'true',
  };
}

// =============================================================================
// READ-ONLY HANDLERS
// =============================================================================

async function balanceHandler(
  _toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const env = getBinanceConfig();
  if (!env) return errorResult('Set BINANCE_API_KEY and BINANCE_API_SECRET');
  try {
    const balances = await binanceFutures.getBalance(env.config);
    return JSON.stringify({ balances });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function positionsHandler(
  _toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const env = getBinanceConfig();
  if (!env) return errorResult('Set BINANCE_API_KEY and BINANCE_API_SECRET');
  try {
    const positions = await binanceFutures.getPositions(env.config);
    return JSON.stringify({ positions });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function ordersHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const env = getBinanceConfig();
  if (!env) return errorResult('Set BINANCE_API_KEY and BINANCE_API_SECRET');
  try {
    const symbol = toolInput.symbol as string | undefined;
    const orders = await binanceFutures.getOpenOrders(env.config, symbol);
    return JSON.stringify({ orders });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function priceHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const env = getBinanceConfig();
  if (!env) return errorResult('Set BINANCE_API_KEY and BINANCE_API_SECRET');
  const symbol = toolInput.symbol as string;
  try {
    const price = await binanceFutures.getPrice(env.config, symbol);
    return JSON.stringify({ symbol, price });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function fundingHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const env = getBinanceConfig();
  if (!env) return errorResult('Set BINANCE_API_KEY and BINANCE_API_SECRET');
  const symbol = toolInput.symbol as string;
  try {
    const funding = await binanceFutures.getFundingRate(env.config, symbol);
    return JSON.stringify(funding);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// =============================================================================
// TRADING HANDLERS
// =============================================================================

async function longHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const env = getBinanceConfig();
  if (!env) return errorResult('Set BINANCE_API_KEY and BINANCE_API_SECRET');
  const symbol = toolInput.symbol as string;
  const quantity = toolInput.quantity as number;
  const leverage = toolInput.leverage as number | undefined;
  try {
    const config: BinanceFuturesConfig = { ...env.config, dryRun: env.dryRun };
    const result = await binanceFutures.openLong(config, symbol, quantity, leverage);
    // Log trade to database
    context.db.logBinanceFuturesTrade({
      userId: context.userId || '',
      orderId: String(result.orderId),
      symbol: result.symbol,
      side: 'BUY',
      positionSide: 'LONG',
      size: result.executedQty,
      price: result.avgPrice || 0,
      leverage,
      timestamp: new Date(),
    });
    return JSON.stringify({ success: true, order: result });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function shortHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const env = getBinanceConfig();
  if (!env) return errorResult('Set BINANCE_API_KEY and BINANCE_API_SECRET');
  const symbol = toolInput.symbol as string;
  const quantity = toolInput.quantity as number;
  const leverage = toolInput.leverage as number | undefined;
  try {
    const config: BinanceFuturesConfig = { ...env.config, dryRun: env.dryRun };
    const result = await binanceFutures.openShort(config, symbol, quantity, leverage);
    // Log trade to database
    context.db.logBinanceFuturesTrade({
      userId: context.userId || '',
      orderId: String(result.orderId),
      symbol: result.symbol,
      side: 'SELL',
      positionSide: 'SHORT',
      size: result.executedQty,
      price: result.avgPrice || 0,
      leverage,
      timestamp: new Date(),
    });
    return JSON.stringify({ success: true, order: result });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function closeHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const env = getBinanceConfig();
  if (!env) return errorResult('Set BINANCE_API_KEY and BINANCE_API_SECRET');
  const symbol = toolInput.symbol as string;
  try {
    const config: BinanceFuturesConfig = { ...env.config, dryRun: env.dryRun };
    const result = await binanceFutures.closePosition(config, symbol);
    if (!result) {
      return JSON.stringify({ error: `No open position for ${symbol}` });
    }
    // Log trade to database
    context.db.logBinanceFuturesTrade({
      userId: context.userId || '',
      orderId: String(result.orderId),
      symbol: result.symbol,
      side: result.side,
      positionSide: result.positionSide,
      size: result.executedQty,
      price: result.avgPrice || 0,
      timestamp: new Date(),
    });
    return JSON.stringify({ success: true, order: result });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// =============================================================================
// EXPORT HANDLERS MAP
// =============================================================================

export const binanceHandlers: HandlersMap = {
  // Read-only
  binance_futures_balance: balanceHandler,
  binance_futures_positions: positionsHandler,
  binance_futures_orders: ordersHandler,
  binance_futures_price: priceHandler,
  binance_futures_funding: fundingHandler,
  // Trading
  binance_futures_long: longHandler,
  binance_futures_short: shortHandler,
  binance_futures_close: closeHandler,
};

export default binanceHandlers;
