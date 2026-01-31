/**
 * Betfair Exchange Handlers
 *
 * Platform handlers for Betfair Exchange sports betting
 */

import { createBetfairFeed, BetfairFeed, BETFAIR_EVENT_TYPES } from '../../feeds/betfair/index';
import type { ToolInput, HandlerResult, HandlerContext, HandlersMap } from './types';
import { safeHandler } from './types';

let feed: BetfairFeed | null = null;

async function getFeed(): Promise<BetfairFeed | null> {
  if (feed) return feed;

  const appKey = process.env.BETFAIR_APP_KEY;
  const sessionToken = process.env.BETFAIR_SESSION_TOKEN;
  const username = process.env.BETFAIR_USERNAME;
  const password = process.env.BETFAIR_PASSWORD;

  if (!appKey) return null;
  if (!sessionToken && (!username || !password)) return null;

  feed = await createBetfairFeed({ appKey, sessionToken, username, password });
  await feed.start();
  return feed;
}

/**
 * betfair_markets - Search markets
 */
async function marketsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const query = (toolInput.query as string) || '';
  const eventTypeIds = toolInput.event_type_ids as string[] | undefined;
  const marketTypes = toolInput.market_types as string[] | undefined;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Betfair not configured');

    const markets = await f.searchMarkets(query, { eventTypeIds, marketTypes });
    return { markets: markets.slice(0, 20) };
  });
}

/**
 * betfair_market - Get market details
 */
async function marketHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Betfair not configured');

    const market = await f.getMarket(marketId);
    if (!market) throw new Error(`Market ${marketId} not found`);
    return market;
  });
}

/**
 * betfair_prices - Get market book/prices
 */
async function pricesHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Betfair not configured');

    const book = await f.getMarketBook(marketId);
    if (!book) throw new Error(`Market book ${marketId} not found`);
    return book;
  });
}

/**
 * betfair_orderbook - Get orderbook for a selection
 */
async function orderbookHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  const selectionId = toolInput.selection_id as number;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Betfair not configured');

    const orderbook = await f.getOrderbook(marketId, selectionId);
    if (!orderbook) throw new Error(`Orderbook not found`);
    return orderbook;
  });
}

/**
 * betfair_back - Place back order
 */
async function backHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  const selectionId = toolInput.selection_id as number;
  const price = toolInput.price as number; // Odds
  const size = toolInput.size as number; // Stake

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Betfair not configured');

    const order = await f.placeBackOrder(marketId, selectionId, price, size);
    if (!order) throw new Error('Failed to place back order');
    return order;
  });
}

/**
 * betfair_lay - Place lay order
 */
async function layHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  const selectionId = toolInput.selection_id as number;
  const price = toolInput.price as number;
  const size = toolInput.size as number;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Betfair not configured');

    const order = await f.placeLayOrder(marketId, selectionId, price, size);
    if (!order) throw new Error('Failed to place lay order');
    return order;
  });
}

/**
 * betfair_cancel - Cancel order
 */
async function cancelHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  const betId = toolInput.bet_id as string;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Betfair not configured');

    const success = await f.cancelOrder(marketId, betId);
    return { success, betId };
  });
}

/**
 * betfair_cancel_all - Cancel all orders
 */
async function cancelAllHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string | undefined;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Betfair not configured');

    const count = await f.cancelAllOrders(marketId);
    return { cancelled: count };
  });
}

/**
 * betfair_orders - Get open orders
 */
async function ordersHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string | undefined;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Betfair not configured');

    const orders = await f.getOpenOrders(marketId);
    return { orders };
  });
}

/**
 * betfair_positions - Get positions
 */
async function positionsHandler(): Promise<HandlerResult> {
  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Betfair not configured');

    const positions = await f.getPositions();
    return { positions };
  });
}

/**
 * betfair_balance - Get account funds
 */
async function balanceHandler(): Promise<HandlerResult> {
  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Betfair not configured');

    const funds = await f.getAccountFunds();
    return funds;
  });
}

/**
 * betfair_event_types - Get event type IDs
 */
async function eventTypesHandler(): Promise<HandlerResult> {
  return safeHandler(async () => {
    return BETFAIR_EVENT_TYPES;
  });
}

/**
 * All Betfair handlers exported as a map
 */
export const betfairHandlers: HandlersMap = {
  betfair_markets: marketsHandler,
  betfair_market: marketHandler,
  betfair_prices: pricesHandler,
  betfair_orderbook: orderbookHandler,
  betfair_back: backHandler,
  betfair_lay: layHandler,
  betfair_cancel: cancelHandler,
  betfair_cancel_all: cancelAllHandler,
  betfair_orders: ordersHandler,
  betfair_positions: positionsHandler,
  betfair_balance: balanceHandler,
  betfair_event_types: eventTypesHandler,
};

export default betfairHandlers;
