/**
 * Predict.fun Handlers
 *
 * Platform handlers for Predict.fun (BNB Chain prediction market).
 * Migrated from inline switch cases in agents/index.ts.
 */

import type { ToolInput, HandlerResult, HandlersMap, HandlerContext } from './types';
import * as predictfun from '../../exchanges/predictfun';

// =============================================================================
// HELPERS
// =============================================================================

type PredictFunApiResponse = Record<string, unknown>;

function apiKey(): string {
  return process.env.PREDICTFUN_API_KEY || '';
}

function getPredictFunConfig() {
  const privateKey = process.env.PREDICTFUN_PRIVATE_KEY;
  const predictAccount = process.env.PREDICTFUN_PREDICT_ACCOUNT;
  if (!privateKey) return null;
  return {
    privateKey,
    predictAccount,
    apiKey: process.env.PREDICTFUN_API_KEY,
    dryRun: process.env.DRY_RUN === 'true',
  };
}

async function apiFetch(url: string): Promise<Response> {
  return fetch(url, { headers: { 'x-api-key': apiKey() } });
}

// =============================================================================
// MARKET DATA HANDLERS (read-only, API key only)
// =============================================================================

async function marketsHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const first = (toolInput.first as number) || 50;
  const after = toolInput.after as string;
  try {
    const params = new URLSearchParams({ first: String(first) });
    if (after) params.append('after', after);
    const response = await apiFetch(`https://api.predict.fun/v1/markets?${params}`);
    if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
    const data = await response.json() as { success?: boolean; cursor?: string; data?: Array<Record<string, unknown>> };
    if (!data.success) return JSON.stringify({ error: 'Request failed' });
    return JSON.stringify({
      cursor: data.cursor,
      markets: (data.data || []).map((m) => ({
        id: m.id,
        title: m.title,
        question: m.question,
        status: m.status,
        isNegRisk: m.isNegRisk,
        feeRateBps: m.feeRateBps,
        outcomes: m.outcomes,
      })),
    });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function marketHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  try {
    const response = await apiFetch(`https://api.predict.fun/v1/markets/${marketId}`);
    if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
    const data = await response.json() as PredictFunApiResponse;
    if (!data.success) return JSON.stringify({ error: 'Market not found' });
    return JSON.stringify(data.data);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function orderbookHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  try {
    const response = await apiFetch(`https://api.predict.fun/v1/markets/${marketId}/orderbook`);
    if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
    const data = await response.json() as PredictFunApiResponse;
    if (!data.success) return JSON.stringify({ error: 'Orderbook not found' });
    return JSON.stringify(data.data);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function marketStatsHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  try {
    const response = await apiFetch(`https://api.predict.fun/v1/markets/${marketId}/statistics`);
    if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
    const data = await response.json() as PredictFunApiResponse;
    if (!data.success) return JSON.stringify({ error: 'Stats not found' });
    return JSON.stringify(data.data);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function lastSaleHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  try {
    const response = await apiFetch(`https://api.predict.fun/v1/markets/${marketId}/last-sale`);
    if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
    const data = await response.json() as PredictFunApiResponse;
    if (!data.success) return JSON.stringify({ error: 'No sales data' });
    return JSON.stringify(data.data);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function categoriesHandler(
  _toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  try {
    const response = await apiFetch('https://api.predict.fun/v1/categories');
    if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
    const data = await response.json() as PredictFunApiResponse;
    if (!data.success) return JSON.stringify({ error: 'Failed to get categories' });
    return JSON.stringify(data.data);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function categoryHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const slug = toolInput.slug as string;
  try {
    const response = await apiFetch(`https://api.predict.fun/v1/categories/${slug}`);
    if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
    const data = await response.json() as PredictFunApiResponse;
    if (!data.success) return JSON.stringify({ error: 'Category not found' });
    return JSON.stringify(data.data);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function ordersHandler(
  _toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  try {
    const response = await apiFetch('https://api.predict.fun/v1/orders');
    if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
    const data = await response.json() as PredictFunApiResponse;
    return JSON.stringify(data.success ? data.data : { error: 'Failed to get orders' });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function positionsHandler(
  _toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  try {
    const response = await apiFetch('https://api.predict.fun/v1/positions');
    if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
    const data = await response.json() as PredictFunApiResponse;
    return JSON.stringify(data.success ? data.data : { error: 'Failed to get positions' });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function accountHandler(
  _toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  try {
    const response = await apiFetch('https://api.predict.fun/v1/account');
    if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
    const data = await response.json() as PredictFunApiResponse;
    return JSON.stringify(data.success ? data.data : { error: 'Failed to get account' });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function activityHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const limit = (toolInput.limit as number) || 50;
  try {
    const response = await apiFetch(`https://api.predict.fun/v1/account/activity?limit=${limit}`);
    if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
    const data = await response.json() as PredictFunApiResponse;
    return JSON.stringify(data.success ? data.data : { error: 'Failed to get activity' });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function orderByHashHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const orderHash = toolInput.order_hash as string;
  try {
    const response = await apiFetch(`https://api.predict.fun/v1/orders/${orderHash}`);
    if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function matchesHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  const limit = (toolInput.limit as number) || 50;
  try {
    let url = `https://api.predict.fun/v1/matches?limit=${limit}`;
    if (marketId) url += `&market_id=${marketId}`;
    const response = await apiFetch(url);
    if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// =============================================================================
// TRADING HANDLERS (require private key or execution service)
// =============================================================================

async function createOrderHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  const tokenId = toolInput.token_id as string;
  const side = (toolInput.side as string).toUpperCase() as 'BUY' | 'SELL';
  const price = toolInput.price as number;
  const quantity = toolInput.quantity as number;
  const feeRateBps = toolInput.fee_rate_bps as number | undefined;
  const isNegRisk = toolInput.is_neg_risk as boolean | undefined;
  const isYieldBearing = toolInput.is_yield_bearing as boolean | undefined;

  // Try ExecutionService first (from trading context)
  const execSvc = context.tradingContext?.executionService;
  if (execSvc) {
    try {
      const result = side === 'BUY'
        ? await execSvc.buyLimit({
            platform: 'predictfun',
            marketId,
            tokenId,
            price,
            size: quantity,
            negRisk: isNegRisk,
          })
        : await execSvc.sellLimit({
            platform: 'predictfun',
            marketId,
            tokenId,
            price,
            size: quantity,
            negRisk: isNegRisk,
          });

      if (result.success) {
        context.db.logPredictFunTrade({
          oddsUserId: process.env.PREDICTFUN_PREDICT_ACCOUNT || 'eoa',
          orderHash: result.orderId || '',
          marketId,
          tokenId,
          side,
          price,
          quantity,
          status: 'open',
          timestamp: new Date(),
        });
      }

      return JSON.stringify({
        success: result.success,
        orderHash: result.orderId,
        status: result.status,
        error: result.error,
      });
    } catch (err: unknown) {
      // Fall through to direct call
    }
  }

  // Fallback: Direct call with env vars
  const config = getPredictFunConfig();
  if (!config) {
    return JSON.stringify({
      error: 'Predict.fun trading requires PREDICTFUN_PRIVATE_KEY env var or configured ExecutionService',
      docs: 'https://dev.predict.fun/how-to-create-or-cancel-orders-679306m0',
    });
  }

  try {
    const result = await predictfun.createOrder(config, {
      marketId,
      tokenId,
      side,
      price,
      quantity,
      feeRateBps,
      isNegRisk,
      isYieldBearing,
    });

    if (result.success) {
      context.db.logPredictFunTrade({
        oddsUserId: config.predictAccount || 'eoa',
        orderHash: result.orderHash || '',
        marketId,
        tokenId,
        side,
        price,
        quantity,
        status: 'open',
        timestamp: new Date(),
      });
    }

    return JSON.stringify(result);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function cancelOrdersHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const orderHashes = toolInput.order_hashes as string[];
  const isNegRisk = (toolInput.is_neg_risk as boolean) || false;
  const isYieldBearing = (toolInput.is_yield_bearing as boolean) ?? true;

  // Try ExecutionService first
  const execSvc = context.tradingContext?.executionService;
  if (execSvc && orderHashes.length > 0) {
    try {
      const results: Array<{ orderHash: string; success: boolean }> = [];
      for (const orderHash of orderHashes) {
        const success = await execSvc.cancelOrder('predictfun', orderHash);
        results.push({ orderHash, success });
      }
      const cancelled = results.filter(r => r.success).length;
      return JSON.stringify({ success: cancelled > 0, cancelled, results });
    } catch (err: unknown) {
      // Fall through to direct call
    }
  }

  // Fallback: Direct call with env vars
  const config = getPredictFunConfig();
  if (!config) {
    return JSON.stringify({ error: 'Predict.fun requires PREDICTFUN_PRIVATE_KEY or configured ExecutionService' });
  }

  try {
    const result = await predictfun.cancelOrders(config, orderHashes, { isNegRisk, isYieldBearing });
    return JSON.stringify(result);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function redeemPositionsHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const config = getPredictFunConfig();
  if (!config) return JSON.stringify({ error: 'Predict.fun requires PREDICTFUN_PRIVATE_KEY' });

  const conditionId = toolInput.condition_id as string;
  const indexSetInput = toolInput.index_set as number;
  const indexSet = (indexSetInput === 1 || indexSetInput === 2) ? indexSetInput : 1;
  const isNegRisk = (toolInput.is_neg_risk as boolean) || false;
  const isYieldBearing = (toolInput.is_yield_bearing as boolean) ?? true;
  const amountStr = toolInput.amount as string | undefined;
  const amount = amountStr ? BigInt(amountStr) : undefined;

  try {
    const result = await predictfun.redeemPositions(config, conditionId, indexSet, {
      isNegRisk,
      isYieldBearing,
      amount,
    });
    return JSON.stringify(result);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function mergePositionsHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const config = getPredictFunConfig();
  if (!config) return JSON.stringify({ error: 'Predict.fun requires PREDICTFUN_PRIVATE_KEY' });

  const conditionId = toolInput.condition_id as string;
  const amount = toolInput.amount as number;
  const isNegRisk = (toolInput.is_neg_risk as boolean) || false;
  const isYieldBearing = (toolInput.is_yield_bearing as boolean) ?? true;

  try {
    const result = await predictfun.mergePositions(config, conditionId, amount, {
      isNegRisk,
      isYieldBearing,
    });
    return JSON.stringify(result);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function setApprovalsHandler(
  _toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const config = getPredictFunConfig();
  if (!config) return JSON.stringify({ error: 'Predict.fun requires PREDICTFUN_PRIVATE_KEY' });

  try {
    const result = await predictfun.setApprovals(config);
    return JSON.stringify(result);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function balanceHandler(
  _toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const privateKey = process.env.PREDICTFUN_PRIVATE_KEY;
  const predictAccount = process.env.PREDICTFUN_PREDICT_ACCOUNT;
  if (!privateKey) return JSON.stringify({ error: 'Predict.fun requires PREDICTFUN_PRIVATE_KEY' });

  try {
    const config = {
      privateKey,
      predictAccount,
      apiKey: process.env.PREDICTFUN_API_KEY,
    };
    const balance = await predictfun.getBalance(config);
    return JSON.stringify(balance);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// =============================================================================
// EXPORT HANDLERS MAP
// =============================================================================

export const predictfunHandlers: HandlersMap = {
  // Market data (read-only)
  predictfun_markets: marketsHandler,
  predictfun_market: marketHandler,
  predictfun_orderbook: orderbookHandler,
  predictfun_market_stats: marketStatsHandler,
  predictfun_last_sale: lastSaleHandler,
  predictfun_categories: categoriesHandler,
  predictfun_category: categoryHandler,
  predictfun_orders: ordersHandler,
  predictfun_positions: positionsHandler,
  predictfun_account: accountHandler,
  predictfun_activity: activityHandler,
  predictfun_order_by_hash: orderByHashHandler,
  predictfun_matches: matchesHandler,
  // Trading
  predictfun_create_order: createOrderHandler,
  predictfun_cancel_orders: cancelOrdersHandler,
  predictfun_redeem_positions: redeemPositionsHandler,
  predictfun_merge_positions: mergePositionsHandler,
  predictfun_set_approvals: setApprovalsHandler,
  predictfun_balance: balanceHandler,
};

export default predictfunHandlers;
