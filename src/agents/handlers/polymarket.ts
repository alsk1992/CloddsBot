/**
 * Polymarket Handlers
 *
 * Platform handlers for Polymarket prediction market
 *
 * This file contains READ-ONLY handlers. Trading handlers remain in agents/index.ts
 * for now due to their tight coupling with execution services.
 */

import type { ToolInput, HandlerResult, HandlersMap, HandlerContext } from './types';
import { safeHandler, errorResult, successResult } from './types';
import type { PolymarketCredentials } from '../../types';
import { buildPolymarketHeadersForUrl, PolymarketApiKeyAuth } from '../../utils/polymarket-auth';

// =============================================================================
// HELPERS
// =============================================================================

interface PolyApiResponse {
  [key: string]: unknown;
}

/**
 * Get Polymarket credentials from context
 */
function getPolyCreds(context: HandlerContext): PolymarketApiKeyAuth | null {
  const polyCreds = context.tradingContext?.credentials.get('polymarket');
  if (!polyCreds || polyCreds.platform !== 'polymarket') {
    return null;
  }
  const creds = polyCreds.data as PolymarketCredentials;
  return {
    address: creds.funderAddress,
    apiKey: creds.apiKey,
    apiSecret: creds.apiSecret,
    apiPassphrase: creds.apiPassphrase,
  };
}

/**
 * Fetch from Polymarket CLOB API with authentication
 */
async function fetchClob(
  context: HandlerContext,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const method = init?.method ?? 'GET';
  const creds = getPolyCreds(context);
  const authHeaders = creds
    ? buildPolymarketHeadersForUrl(creds, method, url, init?.body as string | undefined)
    : {};

  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...authHeaders,
    },
  });
}

// =============================================================================
// HEALTH & CONFIG HANDLERS
// =============================================================================

async function healthHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  return safeHandler(async () => {
    const response = await fetchClob(context, 'https://clob.polymarket.com/');
    return { ok: response.ok, status: response.status };
  });
}

async function serverTimeHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  return safeHandler(async () => {
    const response = await fetchClob(context, 'https://clob.polymarket.com/time');
    return await response.json();
  });
}

async function getAddressHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const polyCreds = context.tradingContext?.credentials.get('polymarket');
  if (!polyCreds) {
    return errorResult('No Polymarket credentials set up.');
  }
  const creds = polyCreds.data as PolymarketCredentials;
  return successResult({ address: creds.funderAddress });
}

async function collateralAddressHandler(): Promise<HandlerResult> {
  return successResult({
    address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    name: 'USDC on Polygon',
  });
}

async function conditionalAddressHandler(): Promise<HandlerResult> {
  return successResult({
    address: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
    name: 'CTF (Conditional Token Framework)',
  });
}

async function exchangeAddressHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const negRisk = toolInput.neg_risk as boolean;
  if (negRisk) {
    return successResult({
      address: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
      name: 'Neg Risk Exchange (crypto markets)',
    });
  }
  return successResult({
    address: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
    name: 'Regular Exchange',
  });
}

// =============================================================================
// MARKET DATA HANDLERS
// =============================================================================

async function priceHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const tokenId = toolInput.token_id as string;
  const side = toolInput.side as string;

  return safeHandler(async () => {
    const response = await fetchClob(
      context,
      `https://clob.polymarket.com/price?token_id=${tokenId}&side=${side}`
    );
    const data = (await response.json()) as PolyApiResponse;
    return { token_id: tokenId, side, price: data.price };
  });
}

async function negRiskHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const tokenId = toolInput.token_id as string;

  return safeHandler(async () => {
    const response = await fetchClob(
      context,
      `https://clob.polymarket.com/neg-risk?token_id=${tokenId}`
    );
    const data = (await response.json()) as PolyApiResponse;
    return { token_id: tokenId, neg_risk: data.neg_risk };
  });
}

async function orderbookHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const tokenId = toolInput.token_id as string;

  return safeHandler(async () => {
    const response = await fetchClob(
      context,
      `https://clob.polymarket.com/book?token_id=${tokenId}`
    );
    return await response.json();
  });
}

async function midpointHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const tokenId = toolInput.token_id as string;

  return safeHandler(async () => {
    const response = await fetchClob(
      context,
      `https://clob.polymarket.com/midpoint?token_id=${tokenId}`
    );
    const data = (await response.json()) as PolyApiResponse;
    return { token_id: tokenId, midpoint: data.mid };
  });
}

async function spreadHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const tokenId = toolInput.token_id as string;

  return safeHandler(async () => {
    const response = await fetchClob(
      context,
      `https://clob.polymarket.com/spread?token_id=${tokenId}`
    );
    const data = (await response.json()) as PolyApiResponse;
    return { token_id: tokenId, spread: data.spread };
  });
}

async function lastTradeHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const tokenId = toolInput.token_id as string;

  return safeHandler(async () => {
    const response = await fetchClob(
      context,
      `https://clob.polymarket.com/last-trade-price?token_id=${tokenId}`
    );
    const data = (await response.json()) as PolyApiResponse;
    return { token_id: tokenId, price: data.price };
  });
}

async function tickSizeHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const tokenId = toolInput.token_id as string;

  return safeHandler(async () => {
    const response = await fetchClob(
      context,
      `https://clob.polymarket.com/tick-size?token_id=${tokenId}`
    );
    const data = (await response.json()) as PolyApiResponse;
    return { token_id: tokenId, tick_size: data.minimum_tick_size };
  });
}

async function tradesHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const tokenId = toolInput.token_id as string;
  const maker = toolInput.maker as string | undefined;
  const limit = (toolInput.limit as number) || 100;

  return safeHandler(async () => {
    let url = `https://clob.polymarket.com/trades?token_id=${tokenId}&limit=${limit}`;
    if (maker) url += `&maker=${maker}`;
    const response = await fetchClob(context, url);
    return await response.json();
  });
}

// =============================================================================
// MARKET DISCOVERY HANDLERS
// =============================================================================

async function marketsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const nextCursor = toolInput.next_cursor as string | undefined;

  return safeHandler(async () => {
    const url = nextCursor
      ? `https://clob.polymarket.com/markets?next_cursor=${nextCursor}`
      : 'https://clob.polymarket.com/markets';
    const response = await fetch(url);
    return await response.json();
  });
}

async function simplifiedMarketsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const nextCursor = toolInput.next_cursor as string | undefined;

  return safeHandler(async () => {
    const url = nextCursor
      ? `https://clob.polymarket.com/simplified-markets?next_cursor=${nextCursor}`
      : 'https://clob.polymarket.com/simplified-markets';
    const response = await fetch(url);
    return await response.json();
  });
}

async function samplingMarketsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const nextCursor = toolInput.next_cursor as string | undefined;

  return safeHandler(async () => {
    const url = nextCursor
      ? `https://clob.polymarket.com/sampling-markets?next_cursor=${nextCursor}`
      : 'https://clob.polymarket.com/sampling-markets';
    const response = await fetch(url);
    return await response.json();
  });
}

async function marketTradesEventsHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const conditionId = toolInput.condition_id as string;

  return safeHandler(async () => {
    const response = await fetchClob(
      context,
      `https://clob.polymarket.com/markets/${conditionId}/trades`
    );
    return await response.json();
  });
}

async function samplingSimplifiedMarketsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const nextCursor = toolInput.next_cursor as string | undefined;

  return safeHandler(async () => {
    const url = nextCursor
      ? `https://clob.polymarket.com/sampling-simplified-markets?next_cursor=${nextCursor}`
      : 'https://clob.polymarket.com/sampling-simplified-markets';
    const response = await fetch(url);
    return await response.json();
  });
}

async function closedOnlyModeHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  return safeHandler(async () => {
    const response = await fetchClob(context, 'https://clob.polymarket.com/closed-only-mode');
    return await response.json();
  });
}

async function orderbookHashHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const tokenId = toolInput.token_id as string;

  return safeHandler(async () => {
    const response = await fetchClob(
      context,
      `https://clob.polymarket.com/orderbook-hash?token_id=${tokenId}`
    );
    return await response.json();
  });
}

// =============================================================================
// GAMMA API HANDLERS (Public market data)
// =============================================================================

async function eventHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const eventId = toolInput.event_id as string;

  return safeHandler(async () => {
    const response = await fetch(`https://gamma-api.polymarket.com/events/${eventId}`);
    return await response.json();
  });
}

async function eventBySlugHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const slug = toolInput.slug as string;

  return safeHandler(async () => {
    const response = await fetch(`https://gamma-api.polymarket.com/events/slug/${slug}`);
    return await response.json();
  });
}

async function eventsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const limit = (toolInput.limit as number) || 20;
  const offset = (toolInput.offset as number) || 0;
  const active = toolInput.active as boolean | undefined;

  return safeHandler(async () => {
    let url = `https://gamma-api.polymarket.com/events?limit=${limit}&offset=${offset}`;
    if (active !== undefined) url += `&active=${active}`;
    const response = await fetch(url);
    return await response.json();
  });
}

async function searchEventsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const query = toolInput.query as string;

  return safeHandler(async () => {
    const response = await fetch(
      `https://gamma-api.polymarket.com/events?title_like=${encodeURIComponent(query)}`
    );
    return await response.json();
  });
}

async function marketBySlugHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const slug = toolInput.slug as string;

  return safeHandler(async () => {
    const response = await fetch(`https://gamma-api.polymarket.com/markets/slug/${slug}`);
    return await response.json();
  });
}

// =============================================================================
// EXPORT HANDLERS MAP
// =============================================================================

/**
 * All Polymarket handlers exported as a map
 *
 * Note: Trading handlers (buy, sell, cancel, etc.) remain in agents/index.ts
 * due to their complex dependencies on execution services.
 */
export const polymarketHandlers: HandlersMap = {
  // Health & Config
  polymarket_health: healthHandler,
  polymarket_server_time: serverTimeHandler,
  polymarket_get_address: getAddressHandler,
  polymarket_collateral_address: collateralAddressHandler,
  polymarket_conditional_address: conditionalAddressHandler,
  polymarket_exchange_address: exchangeAddressHandler,

  // Market Data
  polymarket_price: priceHandler,
  polymarket_neg_risk: negRiskHandler,
  polymarket_orderbook: orderbookHandler,
  polymarket_midpoint: midpointHandler,
  polymarket_spread: spreadHandler,
  polymarket_last_trade: lastTradeHandler,
  polymarket_tick_size: tickSizeHandler,
  polymarket_trades: tradesHandler,

  // Market Discovery
  polymarket_markets: marketsHandler,
  polymarket_simplified_markets: simplifiedMarketsHandler,
  polymarket_sampling_markets: samplingMarketsHandler,
  polymarket_market_trades_events: marketTradesEventsHandler,
  polymarket_sampling_simplified_markets: samplingSimplifiedMarketsHandler,
  polymarket_closed_only_mode: closedOnlyModeHandler,
  polymarket_orderbook_hash: orderbookHashHandler,

  // Gamma API (public data)
  polymarket_event: eventHandler,
  polymarket_event_by_slug: eventBySlugHandler,
  polymarket_events: eventsHandler,
  polymarket_search_events: searchEventsHandler,
  polymarket_market_by_slug: marketBySlugHandler,
};

export default polymarketHandlers;
