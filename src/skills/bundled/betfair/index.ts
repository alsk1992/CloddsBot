/**
 * Betfair CLI Skill
 *
 * Commands:
 * /bf markets [query] - Search markets
 * /bf market <id> - Get market details
 * /bf prices <marketId> - Show current prices
 * /bf book <marketId> <selectionId> - Show orderbook
 * /bf back <marketId> <selectionId> <odds> <stake> - Place back order
 * /bf lay <marketId> <selectionId> <odds> <stake> - Place lay order
 * /bf cancel <marketId> <betId> - Cancel order
 * /bf cancelall [marketId] - Cancel all orders
 * /bf orders [marketId] - List open orders
 * /bf balance - Check account balance
 * /bf positions - View open positions
 */

import { createBetfairFeed, BetfairFeed, BETFAIR_EVENT_TYPES } from '../../../feeds/betfair/index';
import { logger } from '../../../utils/logger';

interface BetfairConfig {
  appKey: string;
  sessionToken?: string;
  username?: string;
  password?: string;
}

let feed: BetfairFeed | null = null;

function getConfig(): BetfairConfig | null {
  const appKey = process.env.BETFAIR_APP_KEY;
  if (!appKey) return null;

  return {
    appKey,
    sessionToken: process.env.BETFAIR_SESSION_TOKEN,
    username: process.env.BETFAIR_USERNAME,
    password: process.env.BETFAIR_PASSWORD,
  };
}

async function getFeed(): Promise<BetfairFeed | null> {
  if (feed) return feed;

  const config = getConfig();
  if (!config) {
    return null;
  }

  if (!config.sessionToken && (!config.username || !config.password)) {
    return null;
  }

  try {
    feed = await createBetfairFeed(config);
    await feed.start();
    return feed;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Betfair feed');
    return null;
  }
}

async function handleMarkets(query: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Betfair not configured. Set BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN.';

  try {
    const markets = await f.searchMarkets(query || '');
    if (markets.length === 0) {
      return 'No markets found.';
    }

    let output = `**Betfair Markets** (${markets.length} results)\n\n`;
    for (const market of markets.slice(0, 20)) {
      output += `**${market.question}**\n`;
      output += `  ID: \`${market.id}\`\n`;
      output += `  Volume: £${market.volume24h.toLocaleString()}\n`;
      if (market.outcomes.length > 0) {
        output += `  Top outcomes:\n`;
        for (const o of market.outcomes.slice(0, 3)) {
          const odds = o.price > 0 ? (1 / o.price).toFixed(2) : '-';
          output += `    - ${o.name}: ${odds} odds\n`;
        }
      }
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error searching markets: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleMarket(marketId: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Betfair not configured. Set BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN.';

  try {
    const market = await f.getMarket(marketId);
    if (!market) {
      return `Market ${marketId} not found.`;
    }

    let output = `**${market.question}**\n\n`;
    output += `ID: \`${market.id}\`\n`;
    output += `Volume: £${market.volume24h.toLocaleString()}\n`;
    output += `Liquidity: £${market.liquidity.toLocaleString()}\n`;
    if (market.endDate) {
      output += `Start: ${market.endDate.toLocaleString()}\n`;
    }
    output += `Status: ${market.resolved ? 'Closed' : 'Open'}\n\n`;

    output += `**Selections:**\n`;
    for (const o of market.outcomes) {
      const odds = o.price > 0 ? (1 / o.price).toFixed(2) : '-';
      output += `- **${o.name}** (ID: ${o.id})\n`;
      output += `  Odds: ${odds} | Volume: £${(o.volume24h || 0).toLocaleString()}\n`;
    }

    return output;
  } catch (error) {
    return `Error fetching market: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePrices(marketId: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Betfair not configured. Set BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN.';

  try {
    const book = await f.getMarketBook(marketId);
    if (!book) {
      return `Market ${marketId} not found.`;
    }

    let output = `**Market Prices: ${marketId}**\n\n`;
    output += `Status: ${book.status}\n`;
    output += `Total Matched: £${(book.totalMatched || 0).toLocaleString()}\n`;
    output += `In-play: ${book.inplay ? 'Yes' : 'No'}\n\n`;

    for (const runner of book.runners) {
      output += `**Selection ${runner.selectionId}**\n`;

      if (runner.ex?.availableToBack?.[0]) {
        output += `  Best Back: ${runner.ex.availableToBack[0].price} (£${runner.ex.availableToBack[0].size})\n`;
      }
      if (runner.ex?.availableToLay?.[0]) {
        output += `  Best Lay: ${runner.ex.availableToLay[0].price} (£${runner.ex.availableToLay[0].size})\n`;
      }
      if (runner.lastPriceTraded) {
        output += `  Last Traded: ${runner.lastPriceTraded}\n`;
      }
      output += '\n';
    }

    return output;
  } catch (error) {
    return `Error fetching prices: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBook(marketId: string, selectionId: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Betfair not configured. Set BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN.';

  try {
    const orderbook = await f.getOrderbook(marketId, parseInt(selectionId, 10));
    if (!orderbook) {
      return `Orderbook not found for ${marketId}/${selectionId}.`;
    }

    let output = `**Orderbook: ${marketId} / ${selectionId}**\n\n`;
    output += `Spread: ${(orderbook.spread * 100).toFixed(2)}%\n`;
    output += `Mid Price: ${(orderbook.midPrice * 100).toFixed(1)}% prob\n\n`;

    output += `**Back (Bids):**\n`;
    for (const [prob, size] of orderbook.bids.slice(0, 5)) {
      const odds = (1 / prob).toFixed(2);
      output += `  ${odds} - £${size.toFixed(2)}\n`;
    }

    output += `\n**Lay (Asks):**\n`;
    for (const [prob, size] of orderbook.asks.slice(0, 5)) {
      const odds = (1 / prob).toFixed(2);
      output += `  ${odds} - £${size.toFixed(2)}\n`;
    }

    return output;
  } catch (error) {
    return `Error fetching orderbook: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBack(marketId: string, selectionId: string, odds: string, stake: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Betfair not configured. Set BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN.';

  try {
    const oddsNum = parseFloat(odds);
    const stakeNum = parseFloat(stake);

    if (isNaN(oddsNum) || isNaN(stakeNum)) {
      return 'Invalid odds or stake.';
    }

    // Circuit breaker pre-trade check
    try {
      const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
      const cb = getGlobalCircuitBreaker();
      if (!cb.canTrade()) {
        const state = cb.getState();
        return `**Trade blocked** — Circuit breaker tripped: ${state.tripReason || 'unknown'}\nUse \`/risk reset\` to re-arm.`;
      }
    } catch { /* circuit breaker non-critical */ }

    const result = await f.placeBackOrder(marketId, parseInt(selectionId, 10), oddsNum, stakeNum);

    // Circuit breaker post-trade recording
    try {
      const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
      const cb = getGlobalCircuitBreaker();
      cb.recordTrade({ pnlUsd: 0, success: !!result, sizeUsd: stakeNum, error: result ? undefined : 'Order failed' });
    } catch { /* circuit breaker non-critical */ }

    if (!result) {
      return 'Failed to place back order.';
    }

    // Position tracking - back = long position
    try {
      const { getGlobalPositionManager } = await import('../../../execution/position-manager');
      const pm = getGlobalPositionManager();
      pm.updatePosition({
        platform: 'betfair' as any,
        marketId,
        tokenId: selectionId,
        outcomeName: `Selection ${selectionId}`,
        side: 'long',
        size: stakeNum,
        entryPrice: 1 / oddsNum,
        currentPrice: 1 / oddsNum,
        openedAt: new Date(),
      });
    } catch { /* position tracking non-critical */ }

    return `**Back Order Placed**\n\n` +
      `Bet ID: \`${result.betId}\`\n` +
      `Market: ${result.marketId}\n` +
      `Selection: ${result.selectionId}\n` +
      `Odds: ${result.priceSize.price}\n` +
      `Stake: £${result.priceSize.size}\n` +
      `Status: ${result.status}`;
  } catch (error) {
    return `Error placing back order: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleLay(marketId: string, selectionId: string, odds: string, stake: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Betfair not configured. Set BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN.';

  try {
    const oddsNum = parseFloat(odds);
    const stakeNum = parseFloat(stake);

    if (isNaN(oddsNum) || isNaN(stakeNum)) {
      return 'Invalid odds or stake.';
    }

    // Circuit breaker pre-trade check
    try {
      const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
      const cb = getGlobalCircuitBreaker();
      if (!cb.canTrade()) {
        const state = cb.getState();
        return `**Trade blocked** — Circuit breaker tripped: ${state.tripReason || 'unknown'}\nUse \`/risk reset\` to re-arm.`;
      }
    } catch { /* circuit breaker non-critical */ }

    const result = await f.placeLayOrder(marketId, parseInt(selectionId, 10), oddsNum, stakeNum);

    // Circuit breaker post-trade recording
    try {
      const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
      const cb = getGlobalCircuitBreaker();
      cb.recordTrade({ pnlUsd: 0, success: !!result, sizeUsd: stakeNum, error: result ? undefined : 'Order failed' });
    } catch { /* circuit breaker non-critical */ }

    if (!result) {
      return 'Failed to place lay order.';
    }

    // Position tracking - lay = short position
    try {
      const { getGlobalPositionManager } = await import('../../../execution/position-manager');
      const pm = getGlobalPositionManager();
      pm.updatePosition({
        platform: 'betfair' as any,
        marketId,
        tokenId: selectionId,
        outcomeName: `Selection ${selectionId}`,
        side: 'short',
        size: stakeNum,
        entryPrice: 1 / oddsNum,
        currentPrice: 1 / oddsNum,
        openedAt: new Date(),
      });
    } catch { /* position tracking non-critical */ }

    return `**Lay Order Placed**\n\n` +
      `Bet ID: \`${result.betId}\`\n` +
      `Market: ${result.marketId}\n` +
      `Selection: ${result.selectionId}\n` +
      `Odds: ${result.priceSize.price}\n` +
      `Liability: £${result.priceSize.size}\n` +
      `Status: ${result.status}`;
  } catch (error) {
    return `Error placing lay order: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCancel(marketId: string, betId: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Betfair not configured. Set BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN.';

  try {
    const success = await f.cancelOrder(marketId, betId);
    return success
      ? `Order ${betId} cancelled successfully.`
      : `Failed to cancel order ${betId}.`;
  } catch (error) {
    return `Error cancelling order: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCancelAll(marketId?: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Betfair not configured. Set BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN.';

  try {
    const count = await f.cancelAllOrders(marketId);
    return `Cancelled ${count} orders.`;
  } catch (error) {
    return `Error cancelling orders: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleOrders(marketId?: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Betfair not configured. Set BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN.';

  try {
    const orders = await f.getOpenOrders(marketId);
    if (orders.length === 0) {
      return 'No open orders.';
    }

    let output = `**Open Orders** (${orders.length})\n\n`;
    for (const order of orders) {
      output += `**${order.betId}**\n`;
      output += `  Market: ${order.marketId}\n`;
      output += `  Selection: ${order.selectionId}\n`;
      output += `  Side: ${order.side}\n`;
      output += `  Price: ${order.priceSize.price}\n`;
      output += `  Size: £${order.priceSize.size}\n`;
      output += `  Matched: £${order.sizeMatched || 0}\n`;
      output += `  Remaining: £${order.sizeRemaining || 0}\n`;
      output += `  Status: ${order.status}\n\n`;
    }
    return output;
  } catch (error) {
    return `Error fetching orders: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBalance(): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Betfair not configured. Set BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN.';

  try {
    const funds = await f.getAccountFunds();
    return `**Betfair Account**\n\n` +
      `Balance: £${funds.balance.toLocaleString()}\n` +
      `Available: £${funds.available.toLocaleString()}\n` +
      `Exposure: £${funds.exposure.toLocaleString()}`;
  } catch (error) {
    return `Error fetching balance: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePositions(): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Betfair not configured. Set BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN.';

  try {
    const positions = await f.getPositions();
    if (positions.length === 0) {
      return 'No open positions.';
    }

    let output = `**Open Positions** (${positions.length})\n\n`;
    for (const pos of positions) {
      output += `Market: ${pos.marketId}\n`;
      output += `Selection: ${pos.selectionId}\n`;
      output += `Matched P&L: £${(pos.matchedPL || 0).toFixed(2)}\n`;
      output += `Unmatched P&L: £${(pos.unmatchedPL || 0).toFixed(2)}\n\n`;
    }
    return output;
  } catch (error) {
    return `Error fetching positions: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    case 'markets':
    case 'search':
      return handleMarkets(rest.join(' '));

    case 'market':
      if (!rest[0]) return 'Usage: /bf market <marketId>';
      return handleMarket(rest[0]);

    case 'prices':
    case 'price':
      if (!rest[0]) return 'Usage: /bf prices <marketId>';
      return handlePrices(rest[0]);

    case 'book':
    case 'orderbook':
      if (!rest[0] || !rest[1]) return 'Usage: /bf book <marketId> <selectionId>';
      return handleBook(rest[0], rest[1]);

    case 'back':
      if (rest.length < 4) return 'Usage: /bf back <marketId> <selectionId> <odds> <stake>';
      return handleBack(rest[0], rest[1], rest[2], rest[3]);

    case 'lay':
      if (rest.length < 4) return 'Usage: /bf lay <marketId> <selectionId> <odds> <stake>';
      return handleLay(rest[0], rest[1], rest[2], rest[3]);

    case 'cancel':
      if (rest.length < 2) return 'Usage: /bf cancel <marketId> <betId>';
      return handleCancel(rest[0], rest[1]);

    case 'cancelall':
      return handleCancelAll(rest[0]);

    case 'orders':
      return handleOrders(rest[0]);

    case 'balance':
      return handleBalance();

    case 'positions':
      return handlePositions();

    case 'circuit': {
      try {
        const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
        const cb = getGlobalCircuitBreaker();
        const state = cb.getState();
        return `**Circuit Breaker**\n\n` +
          `Status: ${state.isTripped ? 'TRIPPED' : 'Armed'}\n` +
          `Session PnL: $${state.sessionPnL.toFixed(2)}\n` +
          `Daily trades: ${state.dailyTrades}\n` +
          `Consecutive losses: ${state.consecutiveLosses}\n` +
          `Error rate: ${(state.errorRate * 100).toFixed(0)}%\n` +
          (state.tripReason ? `Trip reason: ${state.tripReason}\n` : '') +
          `\nUse \`/risk trip\` / \`/risk reset\` to manually control.`;
      } catch (e) {
        return `Circuit breaker error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case 'help':
    default:
      return `**Betfair Exchange Commands**

**Market Data:**
  /bf markets [query]           - Search markets
  /bf market <id>               - Get market details
  /bf prices <id>               - Current prices
  /bf book <id> <selection>     - Show orderbook

**Trading:**
  /bf back <id> <sel> <odds> <stake>  - Place back order
  /bf lay <id> <sel> <odds> <stake>   - Place lay order
  /bf cancel <id> <betId>             - Cancel order
  /bf cancelall [id]                  - Cancel all orders
  /bf orders [id]                     - List open orders

**Account:**
  /bf balance                   - Check balance
  /bf positions                 - View positions

**Risk:**
  /bf circuit                   - Circuit breaker status

**Examples:**
  /bf markets premier league
  /bf back 1.234 5678 2.0 10
  /bf lay 1.234 5678 2.1 10`;
  }
}

export default {
  name: 'betfair',
  description: 'Betfair Exchange - Market data, orderbook, and trading on Betfair',
  commands: ['/betfair', '/bf'],
  handle: execute,
};
