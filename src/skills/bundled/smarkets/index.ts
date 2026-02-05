/**
 * Smarkets CLI Skill
 *
 * Commands:
 * /sm markets [query] - Search markets
 * /sm market <id> - Get market details
 * /sm prices <marketId> - Show current prices
 * /sm book <marketId> <contractId> - Show orderbook
 * /sm buy <marketId> <contractId> <price> <quantity> - Place buy order
 * /sm sell <marketId> <contractId> <price> <quantity> - Place sell order
 * /sm cancel <orderId> - Cancel order
 * /sm cancelall [marketId] - Cancel all orders
 * /sm orders [marketId] - List open orders
 * /sm balance - Check account balance
 */

import { createSmarketsFeed, SmarketsFeed, SMARKETS_DOMAINS } from '../../../feeds/smarkets/index';
import { logger } from '../../../utils/logger';

let feed: SmarketsFeed | null = null;

async function getFeed(): Promise<SmarketsFeed | null> {
  if (feed) return feed;

  const sessionToken = process.env.SMARKETS_SESSION_TOKEN;
  const apiToken = process.env.SMARKETS_API_TOKEN;

  if (!sessionToken && !apiToken) {
    return null;
  }

  try {
    feed = await createSmarketsFeed({ sessionToken, apiToken });
    await feed.start();
    return feed;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Smarkets feed');
    return null;
  }
}

async function handleMarkets(query: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Smarkets not configured. Set SMARKETS_SESSION_TOKEN or SMARKETS_API_TOKEN.';

  try {
    const markets = await f.searchMarkets(query || '');
    if (markets.length === 0) {
      return 'No markets found.';
    }

    let output = `**Smarkets Markets** (${markets.length} results)\n\n`;
    for (const market of markets.slice(0, 20)) {
      output += `**${market.question}**\n`;
      output += `  ID: \`${market.id}\`\n`;
      output += `  Volume: £${market.volume24h.toLocaleString()}\n`;
      if (market.outcomes.length > 0) {
        output += `  Outcomes:\n`;
        for (const o of market.outcomes.slice(0, 4)) {
          output += `    - ${o.name}: ${(o.price * 100).toFixed(1)}%\n`;
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
  if (!f) return 'Smarkets not configured. Set SMARKETS_SESSION_TOKEN or SMARKETS_API_TOKEN.';

  try {
    const market = await f.getMarket(marketId);
    if (!market) {
      return `Market ${marketId} not found.`;
    }

    let output = `**${market.question}**\n\n`;
    output += `ID: \`${market.id}\`\n`;
    output += `Volume: £${market.volume24h.toLocaleString()}\n`;
    if (market.endDate) {
      output += `End: ${market.endDate.toLocaleString()}\n`;
    }
    output += `Status: ${market.resolved ? 'Settled' : 'Open'}\n`;
    output += `Tags: ${market.tags.join(', ')}\n\n`;

    output += `**Contracts:**\n`;
    for (const o of market.outcomes) {
      output += `- **${o.name}** (ID: ${o.id})\n`;
      output += `  Price: ${(o.price * 100).toFixed(1)}% | Volume: £${(o.volume24h || 0).toLocaleString()}\n`;
    }

    return output;
  } catch (error) {
    return `Error fetching market: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePrices(marketId: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Smarkets not configured. Set SMARKETS_SESSION_TOKEN or SMARKETS_API_TOKEN.';

  try {
    const quotes = await f.getQuotes(marketId);
    if (quotes.length === 0) {
      return `No quotes for market ${marketId}.`;
    }

    let output = `**Market Prices: ${marketId}**\n\n`;

    for (const quote of quotes) {
      output += `**Contract ${quote.contract_id}**\n`;

      if (quote.bids?.[0]) {
        output += `  Best Bid: ${quote.bids[0].price}% (£${(quote.bids[0].quantity / 100).toFixed(2)})\n`;
      }
      if (quote.offers?.[0]) {
        output += `  Best Offer: ${quote.offers[0].price}% (£${(quote.offers[0].quantity / 100).toFixed(2)})\n`;
      }
      if (quote.last_executed_price) {
        output += `  Last Traded: ${quote.last_executed_price}%\n`;
      }
      if (quote.volume) {
        output += `  Volume: £${(quote.volume / 100).toLocaleString()}\n`;
      }
      output += '\n';
    }

    return output;
  } catch (error) {
    return `Error fetching prices: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBook(marketId: string, contractId: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Smarkets not configured. Set SMARKETS_SESSION_TOKEN or SMARKETS_API_TOKEN.';

  try {
    const orderbook = await f.getOrderbook(marketId, contractId);
    if (!orderbook) {
      return `Orderbook not found for ${marketId}/${contractId}.`;
    }

    let output = `**Orderbook: ${marketId} / ${contractId}**\n\n`;
    output += `Spread: ${(orderbook.spread * 100).toFixed(2)}%\n`;
    output += `Mid Price: ${(orderbook.midPrice * 100).toFixed(1)}%\n\n`;

    output += `**Bids (Buy):**\n`;
    for (const [price, size] of orderbook.bids.slice(0, 5)) {
      output += `  ${(price * 100).toFixed(1)}% - £${size.toFixed(2)}\n`;
    }

    output += `\n**Offers (Sell):**\n`;
    for (const [price, size] of orderbook.asks.slice(0, 5)) {
      output += `  ${(price * 100).toFixed(1)}% - £${size.toFixed(2)}\n`;
    }

    return output;
  } catch (error) {
    return `Error fetching orderbook: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBuy(marketId: string, contractId: string, price: string, quantity: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Smarkets not configured. Set SMARKETS_SESSION_TOKEN.';
  if (!f.isAuthenticated()) return 'Smarkets: Session token required for trading.';

  try {
    const priceNum = parseFloat(price);
    const quantityNum = parseFloat(quantity);

    if (isNaN(priceNum) || isNaN(quantityNum)) {
      return 'Invalid price or quantity.';
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

    const result = await f.placeBuyOrder(marketId, contractId, priceNum, quantityNum);

    // Circuit breaker post-trade recording
    try {
      const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
      const cb = getGlobalCircuitBreaker();
      cb.recordTrade({ pnlUsd: 0, success: !!result, sizeUsd: quantityNum / 100, error: result ? undefined : 'Order failed' });
    } catch { /* circuit breaker non-critical */ }

    if (!result) {
      return 'Failed to place buy order.';
    }

    // Position tracking
    try {
      const { getGlobalPositionManager } = await import('../../../execution/position-manager');
      const pm = getGlobalPositionManager();
      pm.updatePosition({
        platform: 'smarkets' as any,
        marketId,
        tokenId: contractId,
        outcomeName: `Contract ${contractId}`,
        side: 'long',
        size: quantityNum / 100,
        entryPrice: priceNum / 100,
        currentPrice: priceNum / 100,
        openedAt: new Date(),
      });
    } catch { /* position tracking non-critical */ }

    return `**Buy Order Placed**\n\n` +
      `Order ID: \`${result.id}\`\n` +
      `Market: ${result.market_id}\n` +
      `Contract: ${result.contract_id}\n` +
      `Price: ${result.price}%\n` +
      `Quantity: £${(result.quantity / 100).toFixed(2)}\n` +
      `Status: ${result.state}`;
  } catch (error) {
    return `Error placing buy order: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleSell(marketId: string, contractId: string, price: string, quantity: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Smarkets not configured. Set SMARKETS_SESSION_TOKEN.';
  if (!f.isAuthenticated()) return 'Smarkets: Session token required for trading.';

  try {
    const priceNum = parseFloat(price);
    const quantityNum = parseFloat(quantity);

    if (isNaN(priceNum) || isNaN(quantityNum)) {
      return 'Invalid price or quantity.';
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

    const result = await f.placeSellOrder(marketId, contractId, priceNum, quantityNum);

    // Circuit breaker post-trade recording
    try {
      const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
      const cb = getGlobalCircuitBreaker();
      cb.recordTrade({ pnlUsd: 0, success: !!result, sizeUsd: quantityNum / 100, error: result ? undefined : 'Order failed' });
    } catch { /* circuit breaker non-critical */ }

    if (!result) {
      return 'Failed to place sell order.';
    }

    // Position tracking - close existing position on sell
    try {
      const { getGlobalPositionManager } = await import('../../../execution/position-manager');
      const pm = getGlobalPositionManager();
      const existing = pm.getPositionsByPlatform('smarkets' as any)
        .find(p => p.tokenId === contractId && p.status === 'open');
      if (existing) {
        pm.closePosition(existing.id, priceNum / 100, 'manual');
      }
    } catch { /* position tracking non-critical */ }

    return `**Sell Order Placed**\n\n` +
      `Order ID: \`${result.id}\`\n` +
      `Market: ${result.market_id}\n` +
      `Contract: ${result.contract_id}\n` +
      `Price: ${result.price}%\n` +
      `Quantity: £${(result.quantity / 100).toFixed(2)}\n` +
      `Status: ${result.state}`;
  } catch (error) {
    return `Error placing sell order: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCancel(orderId: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Smarkets not configured. Set SMARKETS_SESSION_TOKEN.';
  if (!f.isAuthenticated()) return 'Smarkets: Session token required for trading.';

  try {
    const success = await f.cancelOrder(orderId);
    return success
      ? `Order ${orderId} cancelled successfully.`
      : `Failed to cancel order ${orderId}.`;
  } catch (error) {
    return `Error cancelling order: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCancelAll(marketId?: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Smarkets not configured. Set SMARKETS_SESSION_TOKEN.';
  if (!f.isAuthenticated()) return 'Smarkets: Session token required for trading.';

  try {
    const count = await f.cancelAllOrders(marketId);
    return `Cancelled ${count} orders.`;
  } catch (error) {
    return `Error cancelling orders: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleOrders(marketId?: string): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Smarkets not configured. Set SMARKETS_SESSION_TOKEN.';
  if (!f.isAuthenticated()) return 'Smarkets: Session token required for trading.';

  try {
    const orders = await f.getOpenOrders(marketId);
    if (orders.length === 0) {
      return 'No open orders.';
    }

    let output = `**Open Orders** (${orders.length})\n\n`;
    for (const order of orders) {
      output += `**${order.id}**\n`;
      output += `  Market: ${order.market_id}\n`;
      output += `  Contract: ${order.contract_id}\n`;
      output += `  Side: ${order.side.toUpperCase()}\n`;
      output += `  Price: ${order.price}%\n`;
      output += `  Quantity: £${(order.quantity / 100).toFixed(2)}\n`;
      output += `  Filled: £${(order.quantity_filled / 100).toFixed(2)}\n`;
      output += `  Status: ${order.state}\n\n`;
    }
    return output;
  } catch (error) {
    return `Error fetching orders: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBalance(): Promise<string> {
  const f = await getFeed();
  if (!f) return 'Smarkets not configured. Set SMARKETS_SESSION_TOKEN.';
  if (!f.isAuthenticated()) return 'Smarkets: Session token required.';

  try {
    const funds = await f.getBalance();
    return `**Smarkets Account**\n\n` +
      `Total: £${funds.total.toLocaleString()}\n` +
      `Available: £${funds.available.toLocaleString()}\n` +
      `Exposure: £${funds.exposure.toLocaleString()}`;
  } catch (error) {
    return `Error fetching balance: ${error instanceof Error ? error.message : String(error)}`;
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
      if (!rest[0]) return 'Usage: /sm market <marketId>';
      return handleMarket(rest[0]);

    case 'prices':
    case 'price':
      if (!rest[0]) return 'Usage: /sm prices <marketId>';
      return handlePrices(rest[0]);

    case 'book':
    case 'orderbook':
      if (!rest[0] || !rest[1]) return 'Usage: /sm book <marketId> <contractId>';
      return handleBook(rest[0], rest[1]);

    case 'buy':
      if (rest.length < 4) return 'Usage: /sm buy <marketId> <contractId> <price> <quantity>';
      return handleBuy(rest[0], rest[1], rest[2], rest[3]);

    case 'sell':
      if (rest.length < 4) return 'Usage: /sm sell <marketId> <contractId> <price> <quantity>';
      return handleSell(rest[0], rest[1], rest[2], rest[3]);

    case 'cancel':
      if (!rest[0]) return 'Usage: /sm cancel <orderId>';
      return handleCancel(rest[0]);

    case 'cancelall':
      return handleCancelAll(rest[0]);

    case 'orders':
      return handleOrders(rest[0]);

    case 'balance':
      return handleBalance();

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
      return `**Smarkets Exchange Commands**

**Market Data:**
  /sm markets [query]           - Search markets
  /sm market <id>               - Get market details
  /sm prices <id>               - Current prices
  /sm book <id> <contract>      - Show orderbook

**Trading:**
  /sm buy <id> <cont> <price> <qty>   - Place buy order
  /sm sell <id> <cont> <price> <qty>  - Place sell order
  /sm cancel <orderId>                - Cancel order
  /sm cancelall [id]                  - Cancel all orders
  /sm orders [id]                     - List open orders

**Account:**
  /sm balance                   - Check balance

**Risk:**
  /sm circuit                   - Circuit breaker status

**Examples:**
  /sm markets uk election
  /sm buy 12345 67890 0.55 10
  /sm sell 12345 67890 0.60 10`;
  }
}

export default {
  name: 'smarkets',
  description: 'Smarkets exchange - search markets, trade, manage orders, and check balances',
  commands: ['/smarkets', '/sm'],
  handle: execute,
};
