/**
 * Bybit Handlers
 *
 * Platform handlers for Bybit perpetual futures trading.
 * Migrated from inline switch cases in agents/index.ts.
 */

import type { ToolInput, HandlerResult, HandlersMap, HandlerContext } from './types';
import { errorResult } from './types';
import type { BybitConfig } from '../../exchanges/bybit';
import * as bybit from '../../exchanges/bybit';

// =============================================================================
// HELPERS
// =============================================================================

function getBybitConfig(): { config: BybitConfig; dryRun: boolean } | null {
  const apiKey = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;
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
  const env = getBybitConfig();
  if (!env) return errorResult('Set BYBIT_API_KEY and BYBIT_API_SECRET');
  try {
    const balances = await bybit.getBalance(env.config);
    return JSON.stringify({ balances });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function positionsHandler(
  _toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const env = getBybitConfig();
  if (!env) return errorResult('Set BYBIT_API_KEY and BYBIT_API_SECRET');
  try {
    const positions = await bybit.getPositions(env.config);
    return JSON.stringify({ positions });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function ordersHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const env = getBybitConfig();
  if (!env) return errorResult('Set BYBIT_API_KEY and BYBIT_API_SECRET');
  try {
    const symbol = toolInput.symbol as string | undefined;
    const orders = await bybit.getOpenOrders(env.config, symbol);
    return JSON.stringify({ orders });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function priceHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const env = getBybitConfig();
  if (!env) return errorResult('Set BYBIT_API_KEY and BYBIT_API_SECRET');
  const symbol = toolInput.symbol as string;
  try {
    const price = await bybit.getPrice(env.config, symbol);
    return JSON.stringify({ symbol, price });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function fundingHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const env = getBybitConfig();
  if (!env) return errorResult('Set BYBIT_API_KEY and BYBIT_API_SECRET');
  const symbol = toolInput.symbol as string;
  try {
    const funding = await bybit.getFundingRate(env.config, symbol);
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
  const env = getBybitConfig();
  if (!env) return errorResult('Set BYBIT_API_KEY and BYBIT_API_SECRET');
  const symbol = toolInput.symbol as string;
  const qty = toolInput.qty as number;
  const leverage = toolInput.leverage as number | undefined;
  try {
    const config: BybitConfig = { ...env.config, dryRun: env.dryRun };
    const result = await bybit.openLong(config, symbol, qty, leverage);
    // Log trade to database
    context.db.logBybitFuturesTrade({
      userId: context.userId || '',
      orderId: result.orderId,
      symbol: result.symbol,
      side: 'Buy',
      positionSide: 'Long',
      size: result.cumExecQty,
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
  const env = getBybitConfig();
  if (!env) return errorResult('Set BYBIT_API_KEY and BYBIT_API_SECRET');
  const symbol = toolInput.symbol as string;
  const qty = toolInput.qty as number;
  const leverage = toolInput.leverage as number | undefined;
  try {
    const config: BybitConfig = { ...env.config, dryRun: env.dryRun };
    const result = await bybit.openShort(config, symbol, qty, leverage);
    // Log trade to database
    context.db.logBybitFuturesTrade({
      userId: context.userId || '',
      orderId: result.orderId,
      symbol: result.symbol,
      side: 'Sell',
      positionSide: 'Short',
      size: result.cumExecQty,
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
  const env = getBybitConfig();
  if (!env) return errorResult('Set BYBIT_API_KEY and BYBIT_API_SECRET');
  const symbol = toolInput.symbol as string;
  try {
    const config: BybitConfig = { ...env.config, dryRun: env.dryRun };
    const result = await bybit.closePosition(config, symbol);
    if (!result) {
      return JSON.stringify({ error: `No open position for ${symbol}` });
    }
    // Log trade to database
    context.db.logBybitFuturesTrade({
      userId: context.userId || '',
      orderId: result.orderId,
      symbol: result.symbol,
      side: result.side,
      size: result.cumExecQty,
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

export const bybitHandlers: HandlersMap = {
  // Read-only
  bybit_balance: balanceHandler,
  bybit_positions: positionsHandler,
  bybit_orders: ordersHandler,
  bybit_price: priceHandler,
  bybit_funding: fundingHandler,
  // Trading
  bybit_long: longHandler,
  bybit_short: shortHandler,
  bybit_close: closeHandler,
};

export default bybitHandlers;
