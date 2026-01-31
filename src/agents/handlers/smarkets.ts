/**
 * Smarkets Exchange Handlers
 *
 * Platform handlers for Smarkets betting exchange
 */

import { createSmarketsFeed, SmarketsFeed, SMARKETS_DOMAINS } from '../../feeds/smarkets/index';
import type { ToolInput, HandlerResult, HandlerContext, HandlersMap } from './types';
import { safeHandler } from './types';

let feed: SmarketsFeed | null = null;

async function getFeed(): Promise<SmarketsFeed | null> {
  if (feed) return feed;

  const sessionToken = process.env.SMARKETS_SESSION_TOKEN;
  const apiToken = process.env.SMARKETS_API_TOKEN;

  if (!sessionToken && !apiToken) return null;

  feed = await createSmarketsFeed({ sessionToken, apiToken });
  await feed.start();
  return feed;
}

/**
 * smarkets_markets - Search markets
 */
async function marketsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const query = (toolInput.query as string) || '';
  const eventTypes = toolInput.event_types as string[] | undefined;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Smarkets not configured');

    const markets = await f.searchMarkets(query, { eventTypes });
    return { markets: markets.slice(0, 20) };
  });
}

/**
 * smarkets_market - Get market details
 */
async function marketHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Smarkets not configured');

    const market = await f.getMarket(marketId);
    if (!market) throw new Error(`Market ${marketId} not found`);
    return market;
  });
}

/**
 * smarkets_quotes - Get quotes for a market
 */
async function quotesHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Smarkets not configured');

    const quotes = await f.getQuotes(marketId);
    return { quotes };
  });
}

/**
 * smarkets_orderbook - Get orderbook for a contract
 */
async function orderbookHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  const contractId = toolInput.contract_id as string;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Smarkets not configured');

    const orderbook = await f.getOrderbook(marketId, contractId);
    if (!orderbook) throw new Error(`Orderbook not found`);
    return orderbook;
  });
}

/**
 * smarkets_buy - Place buy order
 */
async function buyHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  const contractId = toolInput.contract_id as string;
  const price = toolInput.price as number; // 0-1 probability
  const quantity = toolInput.quantity as number;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Smarkets not configured');
    if (!f.isAuthenticated()) throw new Error('Session token required for trading');

    const order = await f.placeBuyOrder(marketId, contractId, price, quantity);
    if (!order) throw new Error('Failed to place buy order');
    return order;
  });
}

/**
 * smarkets_sell - Place sell order
 */
async function sellHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  const contractId = toolInput.contract_id as string;
  const price = toolInput.price as number;
  const quantity = toolInput.quantity as number;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Smarkets not configured');
    if (!f.isAuthenticated()) throw new Error('Session token required for trading');

    const order = await f.placeSellOrder(marketId, contractId, price, quantity);
    if (!order) throw new Error('Failed to place sell order');
    return order;
  });
}

/**
 * smarkets_cancel - Cancel order
 */
async function cancelHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const orderId = toolInput.order_id as string;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Smarkets not configured');
    if (!f.isAuthenticated()) throw new Error('Session token required for trading');

    const success = await f.cancelOrder(orderId);
    return { success, orderId };
  });
}

/**
 * smarkets_cancel_all - Cancel all orders
 */
async function cancelAllHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string | undefined;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Smarkets not configured');
    if (!f.isAuthenticated()) throw new Error('Session token required for trading');

    const count = await f.cancelAllOrders(marketId);
    return { cancelled: count };
  });
}

/**
 * smarkets_orders - Get open orders
 */
async function ordersHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string | undefined;

  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Smarkets not configured');
    if (!f.isAuthenticated()) throw new Error('Session token required');

    const orders = await f.getOpenOrders(marketId);
    return { orders };
  });
}

/**
 * smarkets_balance - Get account balance
 */
async function balanceHandler(): Promise<HandlerResult> {
  return safeHandler(async () => {
    const f = await getFeed();
    if (!f) throw new Error('Smarkets not configured');
    if (!f.isAuthenticated()) throw new Error('Session token required');

    const balance = await f.getBalance();
    return balance;
  });
}

/**
 * smarkets_domains - Get domain constants
 */
async function domainsHandler(): Promise<HandlerResult> {
  return safeHandler(async () => {
    return SMARKETS_DOMAINS;
  });
}

/**
 * All Smarkets handlers exported as a map
 */
export const smarketsHandlers: HandlersMap = {
  smarkets_markets: marketsHandler,
  smarkets_market: marketHandler,
  smarkets_quotes: quotesHandler,
  smarkets_orderbook: orderbookHandler,
  smarkets_buy: buyHandler,
  smarkets_sell: sellHandler,
  smarkets_cancel: cancelHandler,
  smarkets_cancel_all: cancelAllHandler,
  smarkets_orders: ordersHandler,
  smarkets_balance: balanceHandler,
  smarkets_domains: domainsHandler,
};

export default smarketsHandlers;
