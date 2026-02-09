/**
 * Kalshi Handlers
 *
 * All 78 Kalshi platform handlers migrated from agents/index.ts switch cases.
 * Uses direct HTTP calls to the Kalshi REST API with RSA-PSS authentication.
 */

import type { ToolInput, HandlerResult, HandlersMap, HandlerContext } from './types';
import { errorResult } from './types';
import type { KalshiCredentials } from '../../types';
import { buildKalshiHeadersForUrl, type KalshiApiKeyAuth } from '../../utils/kalshi-auth';
import { enforceMaxOrderSize, enforceExposureLimits } from '../../trading/risk';

// =============================================================================
// CONSTANTS & HELPERS
// =============================================================================

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2';

/**
 * Get Kalshi credentials from handler context
 */
function getKalshiCreds(context: HandlerContext): { data: KalshiCredentials } | null {
  const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
  if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') return null;
  return kalshiCreds as { data: KalshiCredentials; platform: string };
}

/**
 * Build KalshiApiKeyAuth from KalshiCredentials
 */
function toApiKeyAuth(creds: KalshiCredentials): KalshiApiKeyAuth | null {
  if (!creds.apiKeyId || !creds.privateKeyPem) return null;
  return { apiKeyId: creds.apiKeyId, privateKeyPem: creds.privateKeyPem };
}

/**
 * Make an unauthenticated GET request to the Kalshi API
 */
async function kalshiGet(path: string): Promise<string> {
  const url = `${KALSHI_API_BASE}${path}`;
  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    return JSON.stringify(data);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

/**
 * Make an authenticated request to the Kalshi API
 */
async function kalshiAuthFetch(
  auth: KalshiApiKeyAuth,
  method: string,
  path: string,
  body?: unknown
): Promise<string> {
  const url = `${KALSHI_API_BASE}${path}`;
  const headers = buildKalshiHeadersForUrl(auth, method, url);
  const fetchOptions: RequestInit = {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(url, fetchOptions);
    const data = await response.json();
    return JSON.stringify(data);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

/**
 * Require auth credentials from context, returning auth object or error string
 */
function requireAuth(context: HandlerContext): KalshiApiKeyAuth | string {
  const kalshiCreds = getKalshiCreds(context);
  if (!kalshiCreds) return errorResult('No Kalshi credentials set up. Use setup_kalshi_credentials first.');
  const auth = toApiKeyAuth(kalshiCreds.data);
  if (!auth) return errorResult('Kalshi API key credentials required (apiKeyId + privateKeyPem).');
  return auth;
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
async function ordersHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
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
  return kalshiGet('/exchange/status');
}

/**
 * kalshi_exchange_schedule - Get exchange schedule (no auth required)
 */
async function exchangeScheduleHandler(_toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  return kalshiGet('/exchange/schedule');
}

/**
 * kalshi_announcements - Get exchange announcements (no auth required)
 */
async function announcementsHandler(_toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  return kalshiGet('/exchange/announcements');
}

// =============================================================================
// AUTHENTICATED REST API HANDLERS
// =============================================================================

/**
 * kalshi_positions - Get current positions
 */
async function positionsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/portfolio/positions');
}

/**
 * kalshi_search - Search for markets
 */
async function searchHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const query = toolInput.query as string | undefined;
  const params = new URLSearchParams({ status: 'open' });
  if (query) params.set('query', query);
  return kalshiGet(`/markets?${params.toString()}`);
}

/**
 * kalshi_market - Get market details
 */
async function marketHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const ticker = toolInput.ticker as string;
  return kalshiGet(`/markets/${encodeURIComponent(ticker)}`);
}

/**
 * kalshi_balance - Get account balance
 */
async function balanceHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/portfolio/balance');
}

/**
 * kalshi_orderbook - Get orderbook for a market
 */
async function orderbookHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const ticker = toolInput.ticker as string;
  return kalshiGet(`/markets/${encodeURIComponent(ticker)}/orderbook`);
}

/**
 * kalshi_market_trades - Get recent trades for a market
 */
async function marketTradesHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const ticker = toolInput.ticker as string | undefined;
  const limit = toolInput.limit as number | undefined;
  if (ticker) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return kalshiGet(`/markets/${encodeURIComponent(ticker)}/trades${qs ? `?${qs}` : ''}`);
  }
  // No ticker: list all trades
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return kalshiGet(`/markets/trades${qs ? `?${qs}` : ''}`);
}

/**
 * kalshi_candlesticks - Get candlestick data
 */
async function candlesticksHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const seriesTicker = toolInput.series_ticker as string;
  const ticker = toolInput.ticker as string;
  const interval = toolInput.interval as number | undefined;
  const params = new URLSearchParams({ series_ticker: seriesTicker });
  if (interval) params.set('period_interval', String(interval));
  return kalshiGet(`/markets/${encodeURIComponent(ticker)}/candlesticks?${params.toString()}`);
}

/**
 * kalshi_events - List events
 */
async function eventsHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const status = toolInput.status as string | undefined;
  const seriesTicker = toolInput.series_ticker as string | undefined;
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (seriesTicker) params.set('series_ticker', seriesTicker);
  const qs = params.toString();
  return kalshiGet(`/events${qs ? `?${qs}` : ''}`);
}

/**
 * kalshi_event - Get event details
 */
async function eventHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const eventTicker = toolInput.event_ticker as string;
  return kalshiGet(`/events/${encodeURIComponent(eventTicker)}`);
}

/**
 * kalshi_series - List series
 */
async function seriesHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const category = toolInput.category as string | undefined;
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  const qs = params.toString();
  return kalshiGet(`/series${qs ? `?${qs}` : ''}`);
}

/**
 * kalshi_series_info - Get series info
 */
async function seriesInfoHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const seriesTicker = toolInput.series_ticker as string;
  return kalshiGet(`/series/${encodeURIComponent(seriesTicker)}`);
}

/**
 * kalshi_market_order - Place a market order with risk checks
 */
async function marketOrderHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
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
  return kalshiAuthFetch(auth, 'POST', '/portfolio/orders', {
    ticker,
    side,
    action,
    count,
    type: 'market',
  });
}

/**
 * kalshi_batch_create_orders - Batch create orders with risk checks
 */
async function batchCreateOrdersHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
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
  return kalshiAuthFetch(auth, 'POST', '/portfolio/orders/batched', { orders });
}

/**
 * kalshi_batch_cancel_orders - Batch cancel orders
 */
async function batchCancelOrdersHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const orderIds = toolInput.order_ids as string[];
  return kalshiAuthFetch(auth, 'DELETE', '/portfolio/orders/batched', { order_ids: orderIds });
}

/**
 * kalshi_cancel_all - Cancel all open orders
 */
async function cancelAllHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'DELETE', '/portfolio/orders');
}

/**
 * kalshi_get_order - Get order details
 */
async function getOrderHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const orderId = toolInput.order_id as string;
  return kalshiAuthFetch(auth, 'GET', `/portfolio/orders/${encodeURIComponent(orderId)}`);
}

/**
 * kalshi_amend_order - Amend an existing order
 */
async function amendOrderHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const orderId = toolInput.order_id as string;
  const price = toolInput.price as number | undefined;
  const count = toolInput.count as number | undefined;
  const body: Record<string, unknown> = {};
  if (price !== undefined) body.price = price;
  if (count !== undefined) body.count = count;
  return kalshiAuthFetch(auth, 'PATCH', `/portfolio/orders/${encodeURIComponent(orderId)}`, body);
}

/**
 * kalshi_decrease_order - Decrease order size
 */
async function decreaseOrderHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const orderId = toolInput.order_id as string;
  const reduceBy = toolInput.reduce_by as number;
  return kalshiAuthFetch(auth, 'POST', `/portfolio/orders/${encodeURIComponent(orderId)}/decrease`, { reduce_by: reduceBy });
}

/**
 * kalshi_queue_position - Get queue position for an order
 */
async function queuePositionHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const orderId = toolInput.order_id as string;
  return kalshiAuthFetch(auth, 'GET', `/portfolio/orders/${encodeURIComponent(orderId)}/position`);
}

/**
 * kalshi_queue_positions - Get all queue positions
 */
async function queuePositionsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/portfolio/orders/queue-positions');
}

/**
 * kalshi_fills - Get fill history
 */
async function fillsHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const ticker = toolInput.ticker as string | undefined;
  const limit = toolInput.limit as number | undefined;
  const params = new URLSearchParams();
  if (ticker) params.set('ticker', ticker);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return kalshiAuthFetch(auth, 'GET', `/portfolio/fills${qs ? `?${qs}` : ''}`);
}

/**
 * kalshi_settlements - Get settlement history
 */
async function settlementsHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const limit = toolInput.limit as number | undefined;
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return kalshiAuthFetch(auth, 'GET', `/portfolio/settlements${qs ? `?${qs}` : ''}`);
}

/**
 * kalshi_account_limits - Get account limits
 */
async function accountLimitsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/portfolio/account/limits');
}

/**
 * kalshi_api_keys - List API keys
 */
async function apiKeysHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/portfolio/api-keys');
}

/**
 * kalshi_create_api_key - Create a new API key
 */
async function createApiKeyHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'POST', '/portfolio/api-keys', {});
}

/**
 * kalshi_delete_api_key - Delete an API key
 */
async function deleteApiKeyHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const apiKey = toolInput.api_key as string;
  return kalshiAuthFetch(auth, 'DELETE', `/portfolio/api-keys/${encodeURIComponent(apiKey)}`);
}

/**
 * kalshi_fee_changes - Get fee changes
 */
async function feeChangesHandler(_toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  return kalshiGet('/exchange/fee-changes');
}

/**
 * kalshi_user_data_timestamp - Get user data timestamp
 */
async function userDataTimestampHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/portfolio/user-data/timestamp');
}

/**
 * kalshi_batch_candlesticks - Get batch candlestick data for multiple tickers
 */
async function batchCandlesticksHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const tickers = toolInput.tickers as unknown[];
  // Fetch candlesticks for each ticker in parallel
  try {
    const results = await Promise.all(
      (tickers as Array<{ ticker: string; series_ticker: string; interval?: number }>).map(async (t) => {
        const params = new URLSearchParams({ series_ticker: t.series_ticker });
        if (t.interval) params.set('period_interval', String(t.interval));
        const url = `${KALSHI_API_BASE}/markets/${encodeURIComponent(t.ticker)}/candlesticks?${params.toString()}`;
        const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
        return { ticker: t.ticker, data: await response.json() };
      })
    );
    return JSON.stringify(results);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

/**
 * kalshi_event_metadata - Get event metadata
 */
async function eventMetadataHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const eventTicker = toolInput.event_ticker as string;
  return kalshiGet(`/events/${encodeURIComponent(eventTicker)}/metadata`);
}

/**
 * kalshi_event_candlesticks - Get event candlestick data
 */
async function eventCandlesticksHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const eventTicker = toolInput.event_ticker as string;
  const interval = toolInput.interval as number | undefined;
  const params = new URLSearchParams();
  if (interval) params.set('period_interval', String(interval));
  const qs = params.toString();
  return kalshiGet(`/events/${encodeURIComponent(eventTicker)}/candlesticks${qs ? `?${qs}` : ''}`);
}

/**
 * kalshi_forecast_history - Get forecast history
 */
async function forecastHistoryHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const seriesTicker = toolInput.series_ticker as string;
  const eventTicker = toolInput.event_ticker as string;
  return kalshiGet(`/series/${encodeURIComponent(seriesTicker)}/events/${encodeURIComponent(eventTicker)}/forecast-history`);
}

/**
 * kalshi_multivariate_events - Get multivariate events
 */
async function multivariateEventsHandler(_toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  return kalshiGet('/events?with_nested_markets=true&status=open');
}

/**
 * kalshi_create_order_group - Create an order group
 */
async function createOrderGroupHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const orders = toolInput.orders as unknown[];
  const maxLoss = toolInput.max_loss as number | undefined;
  const body: Record<string, unknown> = { orders };
  if (maxLoss !== undefined) body.max_loss = maxLoss;
  return kalshiAuthFetch(auth, 'POST', '/portfolio/order-groups', body);
}

/**
 * kalshi_order_groups - List order groups
 */
async function orderGroupsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/portfolio/order-groups');
}

/**
 * kalshi_order_group - Get order group details
 */
async function orderGroupHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const groupId = toolInput.group_id as string;
  return kalshiAuthFetch(auth, 'GET', `/portfolio/order-groups/${encodeURIComponent(groupId)}`);
}

/**
 * kalshi_order_group_limit - Set order group limit
 */
async function orderGroupLimitHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const groupId = toolInput.group_id as string;
  const maxLoss = toolInput.max_loss as number;
  return kalshiAuthFetch(auth, 'PUT', `/portfolio/order-groups/${encodeURIComponent(groupId)}/max-loss`, { max_loss: maxLoss });
}

/**
 * kalshi_order_group_trigger - Trigger order group
 */
async function orderGroupTriggerHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const groupId = toolInput.group_id as string;
  return kalshiAuthFetch(auth, 'POST', `/portfolio/order-groups/${encodeURIComponent(groupId)}/trigger`, {});
}

/**
 * kalshi_order_group_reset - Reset order group
 */
async function orderGroupResetHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const groupId = toolInput.group_id as string;
  return kalshiAuthFetch(auth, 'POST', `/portfolio/order-groups/${encodeURIComponent(groupId)}/reset`, {});
}

/**
 * kalshi_delete_order_group - Delete order group
 */
async function deleteOrderGroupHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const groupId = toolInput.group_id as string;
  return kalshiAuthFetch(auth, 'DELETE', `/portfolio/order-groups/${encodeURIComponent(groupId)}`);
}

/**
 * kalshi_resting_order_value - Get resting order value
 */
async function restingOrderValueHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/portfolio/resting-order-value');
}

/**
 * kalshi_create_subaccount - Create a subaccount
 */
async function createSubaccountHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const name = toolInput.name as string;
  return kalshiAuthFetch(auth, 'POST', '/portfolio/subaccounts', { name });
}

/**
 * kalshi_subaccount_balances - Get subaccount balances
 */
async function subaccountBalancesHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/portfolio/subaccounts/balance');
}

/**
 * kalshi_subaccount_transfer - Transfer between subaccounts
 */
async function subaccountTransferHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const fromId = toolInput.from_id as string;
  const toId = toolInput.to_id as string;
  const amount = toolInput.amount as number;
  return kalshiAuthFetch(auth, 'POST', '/portfolio/subaccounts/transfer', {
    from_id: fromId,
    to_id: toId,
    amount,
  });
}

/**
 * kalshi_subaccount_transfers - List subaccount transfers
 */
async function subaccountTransfersHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/portfolio/subaccounts/transfers');
}

/**
 * kalshi_comms_id - Get communications ID
 */
async function commsIdHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/portfolio/communications-id');
}

/**
 * kalshi_create_rfq - Create a request for quote
 */
async function createRfqHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const ticker = toolInput.ticker as string;
  const side = toolInput.side as string;
  const count = toolInput.count as number;
  const minPrice = toolInput.min_price as number | undefined;
  const maxPrice = toolInput.max_price as number | undefined;
  const body: Record<string, unknown> = { ticker, side, count };
  if (minPrice !== undefined) body.min_price = minPrice;
  if (maxPrice !== undefined) body.max_price = maxPrice;
  return kalshiAuthFetch(auth, 'POST', '/rfqs', body);
}

/**
 * kalshi_rfqs - List RFQs
 */
async function rfqsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/rfqs');
}

/**
 * kalshi_rfq - Get RFQ details
 */
async function rfqHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const rfqId = toolInput.rfq_id as string;
  return kalshiAuthFetch(auth, 'GET', `/rfqs/${encodeURIComponent(rfqId)}`);
}

/**
 * kalshi_cancel_rfq - Cancel an RFQ
 */
async function cancelRfqHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const rfqId = toolInput.rfq_id as string;
  return kalshiAuthFetch(auth, 'DELETE', `/rfqs/${encodeURIComponent(rfqId)}`);
}

/**
 * kalshi_create_quote - Create a quote for an RFQ
 */
async function createQuoteHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const rfqId = toolInput.rfq_id as string;
  const price = toolInput.price as number;
  return kalshiAuthFetch(auth, 'POST', `/rfqs/${encodeURIComponent(rfqId)}/quotes`, { price });
}

/**
 * kalshi_quotes - List quotes
 */
async function quotesHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/rfqs/quotes');
}

/**
 * kalshi_quote - Get quote details
 */
async function quoteHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const quoteId = toolInput.quote_id as string;
  return kalshiAuthFetch(auth, 'GET', `/rfqs/quotes/${encodeURIComponent(quoteId)}`);
}

/**
 * kalshi_cancel_quote - Cancel a quote
 */
async function cancelQuoteHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const quoteId = toolInput.quote_id as string;
  return kalshiAuthFetch(auth, 'DELETE', `/rfqs/quotes/${encodeURIComponent(quoteId)}`);
}

/**
 * kalshi_accept_quote - Accept a quote
 */
async function acceptQuoteHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const quoteId = toolInput.quote_id as string;
  return kalshiAuthFetch(auth, 'POST', `/rfqs/quotes/${encodeURIComponent(quoteId)}/accept`, {});
}

/**
 * kalshi_confirm_quote - Confirm a quote
 */
async function confirmQuoteHandler(toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  const quoteId = toolInput.quote_id as string;
  return kalshiAuthFetch(auth, 'POST', `/rfqs/quotes/${encodeURIComponent(quoteId)}/confirm`, {});
}

/**
 * kalshi_collections - List collections
 */
async function collectionsHandler(_toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  return kalshiGet('/collections');
}

/**
 * kalshi_collection - Get collection details
 */
async function collectionHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const collectionTicker = toolInput.collection_ticker as string;
  return kalshiGet(`/collections/${encodeURIComponent(collectionTicker)}`);
}

/**
 * kalshi_collection_lookup - Lookup collection
 */
async function collectionLookupHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const collectionTicker = toolInput.collection_ticker as string;
  return kalshiGet(`/collections/${encodeURIComponent(collectionTicker)}/lookup`);
}

/**
 * kalshi_collection_lookup_history - Get collection lookup history
 */
async function collectionLookupHistoryHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const collectionTicker = toolInput.collection_ticker as string;
  return kalshiGet(`/collections/${encodeURIComponent(collectionTicker)}/lookup/history`);
}

/**
 * kalshi_live_data - Get live data
 */
async function liveDataHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const dataType = toolInput.data_type as string;
  const milestoneId = toolInput.milestone_id as string;
  return kalshiGet(`/live-data/${encodeURIComponent(dataType)}/${encodeURIComponent(milestoneId)}`);
}

/**
 * kalshi_live_data_batch - Get batch live data
 */
async function liveDataBatchHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const requests = toolInput.requests as unknown[];
  const url = `${KALSHI_API_BASE}/live-data/batch`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
    const data = await response.json();
    return JSON.stringify(data);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

/**
 * kalshi_milestones - List milestones
 */
async function milestonesHandler(_toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  return kalshiGet('/milestones');
}

/**
 * kalshi_milestone - Get milestone details
 */
async function milestoneHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const milestoneId = toolInput.milestone_id as string;
  return kalshiGet(`/milestones/${encodeURIComponent(milestoneId)}`);
}

/**
 * kalshi_structured_targets - List structured targets
 */
async function structuredTargetsHandler(_toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  return kalshiGet('/structured-targets');
}

/**
 * kalshi_structured_target - Get structured target details
 */
async function structuredTargetHandler(toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  const targetId = toolInput.target_id as string;
  return kalshiGet(`/structured-targets/${encodeURIComponent(targetId)}`);
}

/**
 * kalshi_incentives - Get incentives
 */
async function incentivesHandler(_toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  return kalshiGet('/incentives');
}

/**
 * kalshi_fcm_orders - Get FCM orders
 */
async function fcmOrdersHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/portfolio/fcm/orders');
}

/**
 * kalshi_fcm_positions - Get FCM positions
 */
async function fcmPositionsHandler(_toolInput: ToolInput, context: HandlerContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  if (typeof auth === 'string') return auth;
  return kalshiAuthFetch(auth, 'GET', '/portfolio/fcm/positions');
}

/**
 * kalshi_search_tags - Search by tags
 */
async function searchTagsHandler(_toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  return kalshiGet('/markets/search/tags');
}

/**
 * kalshi_search_sports - Search sports markets
 */
async function searchSportsHandler(_toolInput: ToolInput, _context: HandlerContext): Promise<HandlerResult> {
  return kalshiGet('/markets/search/sports');
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
  // Authenticated REST API handlers
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
