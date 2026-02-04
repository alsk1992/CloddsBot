/**
 * Kalshi Handlers
 *
 * All 78 Kalshi platform handlers migrated from agents/index.ts switch cases.
 * Includes execution-service-based trading, no-auth exchange info,
 * and credential-based Python CLI handlers.
 */

import { execSync } from 'child_process';
import { join } from 'path';
import type { ToolInput, HandlerResult, HandlersMap, HandlerContext } from './types';
import { errorResult } from './types';
import type { KalshiCredentials } from '../../types';
import { enforceMaxOrderSize, enforceExposureLimits } from '../../trading/risk';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Build environment variables for Kalshi Python CLI
 */
function buildKalshiEnv(creds: KalshiCredentials): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (creds.apiKeyId && creds.privateKeyPem) {
    env.KALSHI_API_KEY_ID = creds.apiKeyId;
    env.KALSHI_PRIVATE_KEY = creds.privateKeyPem;
  }
  if (creds.email && creds.password) {
    env.KALSHI_EMAIL = creds.email;
    env.KALSHI_PASSWORD = creds.password;
  }
  return env;
}

/**
 * Get Kalshi credentials from handler context
 */
function getKalshiCreds(context: HandlerContext): { data: KalshiCredentials } | null {
  const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
  if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') return null;
  return kalshiCreds as { data: KalshiCredentials; platform: string };
}

/**
 * Get the trading directory path (relative to this file's location)
 */
function getTradingDir(): string {
  return join(__dirname, '..', '..', '..', 'trading');
}

/**
 * Execute a Kalshi Python CLI command with credentials
 */
function execKalshiPython(cmd: string, userEnv: NodeJS.ProcessEnv): string {
  try {
    const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
    return output.trim();
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
  }
}

// =============================================================================
// EXECUTION-SERVICE-BASED HANDLERS
// =============================================================================

/**
 * kalshi_buy - Place a buy limit order via execution service
 */
async function buyHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const ticker = toolInput.ticker as string;
  const side = toolInput.side as string;
  const count = toolInput.count as number;
  const price = toolInput.price as number;
  const notional = count * (price > 1 ? price / 100 : price);
  const userId = context.userId || '';
  const maxError = enforceMaxOrderSize(context, notional, 'kalshi_buy');
  if (maxError) return maxError;
  const exposureError = enforceExposureLimits(context, userId, {
    platform: 'kalshi',
    marketId: ticker,
    outcomeId: side,
    notional,
    label: 'kalshi_buy',
  });
  if (exposureError) return exposureError;

  const execSvc = context.tradingContext?.executionService;
  if (execSvc) {
    try {
      const result = await execSvc.buyLimit({
        platform: 'kalshi',
        marketId: ticker,
        outcome: side,
        price: price > 1 ? price / 100 : price,
        size: count,
        orderType: 'GTC',
      });
      if (result.success) {
        await context.credentials?.markSuccess(userId, 'kalshi');
        return JSON.stringify({
          result: 'Order placed',
          orderId: result.orderId,
          filledSize: result.filledSize,
          avgFillPrice: result.avgFillPrice,
          status: result.status,
        });
      } else {
        return JSON.stringify({ error: 'Order failed', details: result.error });
      }
    } catch (err: unknown) {
      return JSON.stringify({ error: 'Order failed', details: (err as Error).message });
    }
  }

  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) {
    return JSON.stringify({ error: 'No trading service configured. Set up trading credentials in config.' });
  }
  return JSON.stringify({ error: 'Trading execution not available. Configure trading.enabled=true in config with Kalshi credentials.' });
}

/**
 * kalshi_sell - Place a sell limit order via execution service
 */
async function sellHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const ticker = toolInput.ticker as string;
  const side = toolInput.side as string;
  const count = toolInput.count as number;
  const price = toolInput.price as number;
  const userId = context.userId || '';

  const execSvc = context.tradingContext?.executionService;
  if (execSvc) {
    try {
      const result = await execSvc.sellLimit({
        platform: 'kalshi',
        marketId: ticker,
        outcome: side,
        price: price > 1 ? price / 100 : price,
        size: count,
        orderType: 'GTC',
      });
      if (result.success) {
        await context.credentials?.markSuccess(userId, 'kalshi');
        return JSON.stringify({
          result: 'Sell order placed',
          orderId: result.orderId,
          filledSize: result.filledSize,
          avgFillPrice: result.avgFillPrice,
          status: result.status,
        });
      } else {
        return JSON.stringify({ error: 'Sell failed', details: result.error });
      }
    } catch (err: unknown) {
      return JSON.stringify({ error: 'Sell failed', details: (err as Error).message });
    }
  }

  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) {
    return JSON.stringify({ error: 'No trading service configured. Set up trading credentials in config.' });
  }
  return JSON.stringify({ error: 'Trading execution not available. Configure trading.enabled=true in config with Kalshi credentials.' });
}

/**
 * kalshi_orders - Get open orders via execution service
 */
async function ordersHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const execSvc = context.tradingContext?.executionService;
  if (execSvc) {
    try {
      const orders = await execSvc.getOpenOrders('kalshi');
      return JSON.stringify({
        result: orders.map(o => ({
          orderId: o.orderId,
          marketId: o.marketId,
          outcome: o.outcome,
          side: o.side,
          price: o.price,
          originalSize: o.originalSize,
          remainingSize: o.remainingSize,
          filledSize: o.filledSize,
          status: o.status,
          createdAt: o.createdAt,
        })),
      });
    } catch (err: unknown) {
      return JSON.stringify({ error: 'Orders fetch failed', details: (err as Error).message });
    }
  }

  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) {
    return JSON.stringify({ error: 'No trading service configured. Set up trading credentials in config.' });
  }
  return JSON.stringify({ error: 'Trading execution not available. Configure trading.enabled=true in config with Kalshi credentials.' });
}

/**
 * kalshi_cancel - Cancel an order via execution service
 */
async function cancelHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const orderId = toolInput.order_id as string;

  const execSvc = context.tradingContext?.executionService;
  if (execSvc) {
    try {
      const success = await execSvc.cancelOrder('kalshi', orderId);
      if (success) {
        return JSON.stringify({ result: 'Order cancelled', orderId });
      } else {
        return JSON.stringify({ error: 'Cancel failed', details: 'Order not found or already filled' });
      }
    } catch (err: unknown) {
      return JSON.stringify({ error: 'Cancel failed', details: (err as Error).message });
    }
  }

  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) {
    return JSON.stringify({ error: 'No trading service configured. Set up trading credentials in config.' });
  }
  return JSON.stringify({ error: 'Trading execution not available. Configure trading.enabled=true in config with Kalshi credentials.' });
}

// =============================================================================
// NO-AUTH EXCHANGE INFO HANDLERS
// =============================================================================

/**
 * kalshi_exchange_status - Get exchange status (no auth required)
 */
async function exchangeStatusHandler(_toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py exchange_status`;
  try {
    const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
    return output.trim();
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
  }
}

/**
 * kalshi_exchange_schedule - Get exchange schedule (no auth required)
 */
async function exchangeScheduleHandler(_toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py exchange_schedule`;
  try {
    const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
    return output.trim();
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
  }
}

/**
 * kalshi_announcements - Get exchange announcements (no auth required)
 */
async function announcementsHandler(_toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py announcements`;
  try {
    const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
    return output.trim();
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
  }
}

// =============================================================================
// CREDENTIAL-BASED PYTHON HANDLERS
// =============================================================================

/**
 * kalshi_positions - Get current positions
 */
async function positionsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up. Use setup_kalshi_credentials first.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py positions`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  try {
    const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
    return JSON.stringify({ result: output.trim() });
  } catch (error: unknown) {
    return JSON.stringify({ error: 'Failed to get positions', details: (error as { stderr?: string; message?: string }).stderr || (error as { message?: string }).message });
  }
}

/**
 * kalshi_search - Search for markets
 */
async function searchHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up. Use setup_kalshi_credentials first.');
  const query = toolInput.query as string | undefined;
  const tradingDir = getTradingDir();
  const cmd = query
    ? `cd ${tradingDir} && python3 kalshi.py search "${query}"`
    : `cd ${tradingDir} && python3 kalshi.py search`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_market - Get market details
 */
async function marketHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up. Use setup_kalshi_credentials first.');
  const ticker = toolInput.ticker as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py market ${ticker}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_balance - Get account balance
 */
async function balanceHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up. Use setup_kalshi_credentials first.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py balance`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_orderbook - Get orderbook for a market
 */
async function orderbookHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const ticker = toolInput.ticker as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py orderbook ${ticker}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_market_trades - Get recent trades for a market
 */
async function marketTradesHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const ticker = toolInput.ticker as string | undefined;
  const limit = toolInput.limit as number | undefined;
  const tradingDir = getTradingDir();
  let cmd = `cd ${tradingDir} && python3 kalshi.py market_trades`;
  if (ticker) cmd += ` --ticker ${ticker}`;
  if (limit) cmd += ` --limit ${limit}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_candlesticks - Get candlestick data
 */
async function candlesticksHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const seriesTicker = toolInput.series_ticker as string;
  const ticker = toolInput.ticker as string;
  const interval = toolInput.interval as number | undefined;
  const tradingDir = getTradingDir();
  let cmd = `cd ${tradingDir} && python3 kalshi.py candlesticks ${seriesTicker} ${ticker}`;
  if (interval) cmd += ` --interval ${interval}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_events - List events
 */
async function eventsHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const status = toolInput.status as string | undefined;
  const seriesTicker = toolInput.series_ticker as string | undefined;
  const tradingDir = getTradingDir();
  let cmd = `cd ${tradingDir} && python3 kalshi.py events`;
  if (status) cmd += ` --status ${status}`;
  if (seriesTicker) cmd += ` --series ${seriesTicker}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_event - Get event details
 */
async function eventHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const eventTicker = toolInput.event_ticker as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py event ${eventTicker}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_series - List series
 */
async function seriesHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const category = toolInput.category as string | undefined;
  const tradingDir = getTradingDir();
  let cmd = `cd ${tradingDir} && python3 kalshi.py series`;
  if (category) cmd += ` --category ${category}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_series_info - Get series info
 */
async function seriesInfoHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const seriesTicker = toolInput.series_ticker as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py series_info ${seriesTicker}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_market_order - Place a market order with risk checks
 */
async function marketOrderHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const ticker = toolInput.ticker as string;
  const side = toolInput.side as string;
  const action = toolInput.action as string;
  const count = toolInput.count as number;
  const userId = context.userId || '';
  if (action?.toLowerCase() === 'buy') {
    const maxError = enforceMaxOrderSize(context, count, 'kalshi_market_order');
    if (maxError) return maxError;
    const exposureError = enforceExposureLimits(context, userId, {
      platform: 'kalshi',
      marketId: ticker,
      outcomeId: side,
      notional: count,
      label: 'kalshi_market_order',
    });
    if (exposureError) return exposureError;
  }
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py market_order ${ticker} ${side} ${action} ${count}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_batch_create_orders - Batch create orders with risk checks
 */
async function batchCreateOrdersHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const orders = toolInput.orders as unknown[];
  const userId = context.userId || '';
  if (Array.isArray(orders) && orders.length > 0) {
    let total = 0;
    const perKey = new Map<string, number>();
    for (const order of orders) {
      if (!order || typeof order !== 'object') continue;
      const raw = order as Record<string, unknown>;
      const action = String(raw.action || '').toLowerCase();
      if (action && action !== 'buy') continue;
      const count = Number(raw.count);
      if (!Number.isFinite(count) || count <= 0) continue;
      const priceRaw = raw.yes_price ?? raw.no_price ?? raw.price ?? raw.yesPrice ?? raw.noPrice;
      const priceNum = Number(priceRaw);
      if (!Number.isFinite(priceNum) || priceNum <= 0) continue;
      const price = priceNum > 1 ? priceNum / 100 : priceNum;
      const notional = count * price;
      total += notional;
      const ticker = String(raw.ticker || '');
      const side = String(raw.side || '');
      const key = `${ticker}:${side}`;
      perKey.set(key, (perKey.get(key) || 0) + notional);
    }
    const maxError = enforceMaxOrderSize(context, total, 'kalshi_batch_create_orders');
    if (maxError) return maxError;
    for (const [key, notional] of perKey) {
      const [ticker, side] = key.split(':');
      const exposureError = enforceExposureLimits(context, userId, {
        platform: 'kalshi',
        marketId: ticker,
        outcomeId: side,
        notional,
        label: 'kalshi_batch_create_orders',
      });
      if (exposureError) return exposureError;
    }
  }
  const tradingDir = getTradingDir();
  const ordersJson = JSON.stringify(orders).replace(/"/g, '\\"');
  const cmd = `cd ${tradingDir} && python3 kalshi.py batch_create_orders "${ordersJson}"`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_batch_cancel_orders - Batch cancel orders
 */
async function batchCancelOrdersHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const orderIds = toolInput.order_ids as string[];
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py batch_cancel_orders ${orderIds.join(',')}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_cancel_all - Cancel all open orders
 */
async function cancelAllHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py cancel_all`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_get_order - Get order details
 */
async function getOrderHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const orderId = toolInput.order_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py get_order ${orderId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_amend_order - Amend an existing order
 */
async function amendOrderHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const orderId = toolInput.order_id as string;
  const price = toolInput.price as number | undefined;
  const count = toolInput.count as number | undefined;
  const tradingDir = getTradingDir();
  let cmd = `cd ${tradingDir} && python3 kalshi.py amend_order ${orderId}`;
  if (price) cmd += ` --price ${price}`;
  if (count) cmd += ` --count ${count}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_decrease_order - Decrease order size
 */
async function decreaseOrderHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const orderId = toolInput.order_id as string;
  const reduceBy = toolInput.reduce_by as number;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py decrease_order ${orderId} ${reduceBy}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_queue_position - Get queue position for an order
 */
async function queuePositionHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const orderId = toolInput.order_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py queue_position ${orderId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_queue_positions - Get all queue positions
 */
async function queuePositionsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py queue_positions`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_fills - Get fill history
 */
async function fillsHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const ticker = toolInput.ticker as string | undefined;
  const limit = toolInput.limit as number | undefined;
  const tradingDir = getTradingDir();
  let cmd = `cd ${tradingDir} && python3 kalshi.py fills`;
  if (ticker) cmd += ` --ticker ${ticker}`;
  if (limit) cmd += ` --limit ${limit}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_settlements - Get settlement history
 */
async function settlementsHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const limit = toolInput.limit as number | undefined;
  const tradingDir = getTradingDir();
  let cmd = `cd ${tradingDir} && python3 kalshi.py settlements`;
  if (limit) cmd += ` --limit ${limit}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_account_limits - Get account limits
 */
async function accountLimitsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py account_limits`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_api_keys - List API keys
 */
async function apiKeysHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py api_keys`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_create_api_key - Create a new API key
 */
async function createApiKeyHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py create_api_key`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_delete_api_key - Delete an API key
 */
async function deleteApiKeyHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const apiKey = toolInput.api_key as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py delete_api_key ${apiKey}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_fee_changes - Get fee changes
 */
async function feeChangesHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py fee_changes`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_user_data_timestamp - Get user data timestamp
 */
async function userDataTimestampHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py user_data_timestamp`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_batch_candlesticks - Get batch candlestick data
 */
async function batchCandlesticksHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tickers = toolInput.tickers as unknown[];
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py batch_candlesticks '${JSON.stringify(tickers)}'`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_event_metadata - Get event metadata
 */
async function eventMetadataHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const eventTicker = toolInput.event_ticker as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py event_metadata ${eventTicker}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_event_candlesticks - Get event candlestick data
 */
async function eventCandlesticksHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const seriesTicker = toolInput.series_ticker as string;
  const eventTicker = toolInput.event_ticker as string;
  const interval = toolInput.interval as number | undefined;
  const tradingDir = getTradingDir();
  let cmd = `cd ${tradingDir} && python3 kalshi.py event_candlesticks ${seriesTicker} ${eventTicker}`;
  if (interval) cmd += ` --interval ${interval}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_forecast_history - Get forecast history
 */
async function forecastHistoryHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const seriesTicker = toolInput.series_ticker as string;
  const eventTicker = toolInput.event_ticker as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py forecast_history ${seriesTicker} ${eventTicker}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_multivariate_events - Get multivariate events
 */
async function multivariateEventsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py multivariate_events`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_create_order_group - Create an order group
 */
async function createOrderGroupHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const orders = toolInput.orders as unknown[];
  const maxLoss = toolInput.max_loss as number | undefined;
  const tradingDir = getTradingDir();
  let cmd = `cd ${tradingDir} && python3 kalshi.py create_order_group '${JSON.stringify(orders)}'`;
  if (maxLoss) cmd += ` --max_loss ${maxLoss}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_order_groups - List order groups
 */
async function orderGroupsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py order_groups`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_order_group - Get order group details
 */
async function orderGroupHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const groupId = toolInput.group_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py order_group ${groupId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_order_group_limit - Set order group limit
 */
async function orderGroupLimitHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const groupId = toolInput.group_id as string;
  const maxLoss = toolInput.max_loss as number;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py order_group_limit ${groupId} ${maxLoss}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_order_group_trigger - Trigger order group
 */
async function orderGroupTriggerHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const groupId = toolInput.group_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py order_group_trigger ${groupId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_order_group_reset - Reset order group
 */
async function orderGroupResetHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const groupId = toolInput.group_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py order_group_reset ${groupId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_delete_order_group - Delete order group
 */
async function deleteOrderGroupHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const groupId = toolInput.group_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py delete_order_group ${groupId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_resting_order_value - Get resting order value
 */
async function restingOrderValueHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py resting_order_value`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_create_subaccount - Create a subaccount
 */
async function createSubaccountHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const name = toolInput.name as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py create_subaccount "${name}"`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_subaccount_balances - Get subaccount balances
 */
async function subaccountBalancesHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py subaccount_balances`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_subaccount_transfer - Transfer between subaccounts
 */
async function subaccountTransferHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const fromId = toolInput.from_id as string;
  const toId = toolInput.to_id as string;
  const amount = toolInput.amount as number;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py subaccount_transfer ${fromId} ${toId} ${amount}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_subaccount_transfers - List subaccount transfers
 */
async function subaccountTransfersHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py subaccount_transfers`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_comms_id - Get communications ID
 */
async function commsIdHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py comms_id`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_create_rfq - Create a request for quote
 */
async function createRfqHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const ticker = toolInput.ticker as string;
  const side = toolInput.side as string;
  const count = toolInput.count as number;
  const minPrice = toolInput.min_price as number | undefined;
  const maxPrice = toolInput.max_price as number | undefined;
  const tradingDir = getTradingDir();
  let cmd = `cd ${tradingDir} && python3 kalshi.py create_rfq ${ticker} ${side} ${count}`;
  if (minPrice) cmd += ` --min_price ${minPrice}`;
  if (maxPrice) cmd += ` --max_price ${maxPrice}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_rfqs - List RFQs
 */
async function rfqsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py rfqs`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_rfq - Get RFQ details
 */
async function rfqHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const rfqId = toolInput.rfq_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py rfq ${rfqId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_cancel_rfq - Cancel an RFQ
 */
async function cancelRfqHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const rfqId = toolInput.rfq_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py cancel_rfq ${rfqId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_create_quote - Create a quote for an RFQ
 */
async function createQuoteHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const rfqId = toolInput.rfq_id as string;
  const price = toolInput.price as number;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py create_quote ${rfqId} ${price}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_quotes - List quotes
 */
async function quotesHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py quotes`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_quote - Get quote details
 */
async function quoteHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const quoteId = toolInput.quote_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py quote ${quoteId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_cancel_quote - Cancel a quote
 */
async function cancelQuoteHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const quoteId = toolInput.quote_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py cancel_quote ${quoteId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_accept_quote - Accept a quote
 */
async function acceptQuoteHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const quoteId = toolInput.quote_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py accept_quote ${quoteId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_confirm_quote - Confirm a quote
 */
async function confirmQuoteHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const quoteId = toolInput.quote_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py confirm_quote ${quoteId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_collections - List collections
 */
async function collectionsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py collections`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_collection - Get collection details
 */
async function collectionHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const collectionTicker = toolInput.collection_ticker as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py collection ${collectionTicker}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_collection_lookup - Lookup collection
 */
async function collectionLookupHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const collectionTicker = toolInput.collection_ticker as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py collection_lookup ${collectionTicker}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_collection_lookup_history - Get collection lookup history
 */
async function collectionLookupHistoryHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const collectionTicker = toolInput.collection_ticker as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py collection_lookup_history ${collectionTicker}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_live_data - Get live data
 */
async function liveDataHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const dataType = toolInput.data_type as string;
  const milestoneId = toolInput.milestone_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py live_data ${dataType} ${milestoneId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_live_data_batch - Get batch live data
 */
async function liveDataBatchHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const requests = toolInput.requests as unknown[];
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py live_data_batch '${JSON.stringify(requests)}'`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_milestones - List milestones
 */
async function milestonesHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py milestones`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_milestone - Get milestone details
 */
async function milestoneHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const milestoneId = toolInput.milestone_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py milestone ${milestoneId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_structured_targets - List structured targets
 */
async function structuredTargetsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py structured_targets`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_structured_target - Get structured target details
 */
async function structuredTargetHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const targetId = toolInput.target_id as string;
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py structured_target ${targetId}`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_incentives - Get incentives
 */
async function incentivesHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py incentives`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_fcm_orders - Get FCM orders
 */
async function fcmOrdersHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py fcm_orders`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_fcm_positions - Get FCM positions
 */
async function fcmPositionsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py fcm_positions`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_search_tags - Search by tags
 */
async function searchTagsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py search_tags`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

/**
 * kalshi_search_sports - Search sports markets
 */
async function searchSportsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up.');
  const tradingDir = getTradingDir();
  const cmd = `cd ${tradingDir} && python3 kalshi.py search_sports`;
  const userEnv = buildKalshiEnv(kalshiCreds.data);
  return execKalshiPython(cmd, userEnv);
}

// =============================================================================
// EXPORT MAP
// =============================================================================

export const kalshiHandlers: HandlersMap = {
  // Execution-service-based
  kalshi_buy: buyHandler,
  kalshi_sell: sellHandler,
  kalshi_orders: ordersHandler,
  kalshi_cancel: cancelHandler,
  // No-auth exchange info
  kalshi_exchange_status: exchangeStatusHandler,
  kalshi_exchange_schedule: exchangeScheduleHandler,
  kalshi_announcements: announcementsHandler,
  // Credential-based Python handlers
  kalshi_positions: positionsHandler,
  kalshi_search: searchHandler,
  kalshi_market: marketHandler,
  kalshi_balance: balanceHandler,
  kalshi_orderbook: orderbookHandler,
  kalshi_market_trades: marketTradesHandler,
  kalshi_candlesticks: candlesticksHandler,
  kalshi_events: eventsHandler,
  kalshi_event: eventHandler,
  kalshi_series: seriesHandler,
  kalshi_series_info: seriesInfoHandler,
  kalshi_market_order: marketOrderHandler,
  kalshi_batch_create_orders: batchCreateOrdersHandler,
  kalshi_batch_cancel_orders: batchCancelOrdersHandler,
  kalshi_cancel_all: cancelAllHandler,
  kalshi_get_order: getOrderHandler,
  kalshi_amend_order: amendOrderHandler,
  kalshi_decrease_order: decreaseOrderHandler,
  kalshi_queue_position: queuePositionHandler,
  kalshi_queue_positions: queuePositionsHandler,
  kalshi_fills: fillsHandler,
  kalshi_settlements: settlementsHandler,
  kalshi_account_limits: accountLimitsHandler,
  kalshi_api_keys: apiKeysHandler,
  kalshi_create_api_key: createApiKeyHandler,
  kalshi_delete_api_key: deleteApiKeyHandler,
  kalshi_fee_changes: feeChangesHandler,
  kalshi_user_data_timestamp: userDataTimestampHandler,
  kalshi_batch_candlesticks: batchCandlesticksHandler,
  kalshi_event_metadata: eventMetadataHandler,
  kalshi_event_candlesticks: eventCandlesticksHandler,
  kalshi_forecast_history: forecastHistoryHandler,
  kalshi_multivariate_events: multivariateEventsHandler,
  kalshi_create_order_group: createOrderGroupHandler,
  kalshi_order_groups: orderGroupsHandler,
  kalshi_order_group: orderGroupHandler,
  kalshi_order_group_limit: orderGroupLimitHandler,
  kalshi_order_group_trigger: orderGroupTriggerHandler,
  kalshi_order_group_reset: orderGroupResetHandler,
  kalshi_delete_order_group: deleteOrderGroupHandler,
  kalshi_resting_order_value: restingOrderValueHandler,
  kalshi_create_subaccount: createSubaccountHandler,
  kalshi_subaccount_balances: subaccountBalancesHandler,
  kalshi_subaccount_transfer: subaccountTransferHandler,
  kalshi_subaccount_transfers: subaccountTransfersHandler,
  kalshi_comms_id: commsIdHandler,
  kalshi_create_rfq: createRfqHandler,
  kalshi_rfqs: rfqsHandler,
  kalshi_rfq: rfqHandler,
  kalshi_cancel_rfq: cancelRfqHandler,
  kalshi_create_quote: createQuoteHandler,
  kalshi_quotes: quotesHandler,
  kalshi_quote: quoteHandler,
  kalshi_cancel_quote: cancelQuoteHandler,
  kalshi_accept_quote: acceptQuoteHandler,
  kalshi_confirm_quote: confirmQuoteHandler,
  kalshi_collections: collectionsHandler,
  kalshi_collection: collectionHandler,
  kalshi_collection_lookup: collectionLookupHandler,
  kalshi_collection_lookup_history: collectionLookupHistoryHandler,
  kalshi_live_data: liveDataHandler,
  kalshi_live_data_batch: liveDataBatchHandler,
  kalshi_milestones: milestonesHandler,
  kalshi_milestone: milestoneHandler,
  kalshi_structured_targets: structuredTargetsHandler,
  kalshi_structured_target: structuredTargetHandler,
  kalshi_incentives: incentivesHandler,
  kalshi_fcm_orders: fcmOrdersHandler,
  kalshi_fcm_positions: fcmPositionsHandler,
  kalshi_search_tags: searchTagsHandler,
  kalshi_search_sports: searchSportsHandler,
};

export default kalshiHandlers;
