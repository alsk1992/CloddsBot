/**
 * Opinion.trade Skill
 *
 * CLI commands for Opinion.trade prediction market on BNB Chain.
 */

import { createOpinionFeed, type OpinionFeed } from '../../../feeds/opinion';
import { createExecutionService, type ExecutionService } from '../../../execution';
import { logger } from '../../../utils/logger';

// =============================================================================
// HELPERS
// =============================================================================

function formatNumber(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(decimals) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(decimals) + 'K';
  return n.toFixed(decimals);
}

let feedInstance: OpinionFeed | null = null;
let execInstance: ExecutionService | null = null;

async function getFeed(): Promise<OpinionFeed> {
  if (!feedInstance) {
    feedInstance = await createOpinionFeed({
      apiKey: process.env.OPINION_API_KEY,
    });
    await feedInstance.connect();
  }
  return feedInstance;
}

function getExecution(): ExecutionService | null {
  if (!execInstance) {
    const apiKey = process.env.OPINION_API_KEY;
    const privateKey = process.env.OPINION_PRIVATE_KEY;
    const multiSigAddress = process.env.OPINION_MULTISIG_ADDRESS;

    if (!apiKey) return null;

    execInstance = createExecutionService({
      opinion: {
        apiKey,
        privateKey,
        multiSigAddress,
      },
      dryRun: process.env.DRY_RUN === 'true',
    });
  }
  return execInstance;
}

// =============================================================================
// MARKET DATA HANDLERS
// =============================================================================

async function handleMarkets(query?: string): Promise<string> {
  const feed = await getFeed();
  const markets = await feed.searchMarkets(query || '');

  if (markets.length === 0) {
    return query ? `No markets found for "${query}"` : 'No markets found';
  }

  const lines = ['**Opinion.trade Markets**', ''];

  for (const m of markets.slice(0, 15)) {
    const yesPrice = m.outcomes.find(o => o.name.toLowerCase() === 'yes')?.price || 0;
    lines.push(`  [${m.id}] ${m.question}`);
    lines.push(`       YES: ${(yesPrice * 100).toFixed(0)}c | Vol: $${formatNumber(m.volume24h)}`);
  }

  if (markets.length > 15) {
    lines.push('', `...and ${markets.length - 15} more`);
  }

  return lines.join('\n');
}

async function handleMarket(marketId: string): Promise<string> {
  if (!marketId) {
    return 'Usage: /op market <id>\nExample: /op market 813';
  }

  const feed = await getFeed();
  const market = await feed.getMarket(marketId);

  if (!market) {
    return `Market ${marketId} not found`;
  }

  const lines = [
    `**${market.question}**`,
    '',
    `ID: ${market.id}`,
    `Platform: Opinion.trade`,
    market.description ? `Description: ${market.description}` : '',
    '',
    '**Outcomes:**',
  ];

  for (const o of market.outcomes) {
    lines.push(`  ${o.name}: ${(o.price * 100).toFixed(1)}c`);
  }

  lines.push(
    '',
    `Volume 24h: $${formatNumber(market.volume24h)}`,
    `Liquidity: $${formatNumber(market.liquidity)}`,
    market.endDate ? `End Date: ${market.endDate.toLocaleDateString()}` : '',
    `Resolved: ${market.resolved ? 'Yes' : 'No'}`,
    '',
    `URL: ${market.url}`,
  );

  return lines.filter(l => l !== '').join('\n');
}

async function handlePrice(marketId: string): Promise<string> {
  if (!marketId) {
    return 'Usage: /op price <id>\nExample: /op price 813';
  }

  const feed = await getFeed();
  const market = await feed.getMarket(marketId);

  if (!market) {
    return `Market ${marketId} not found`;
  }

  const lines = [`**${market.question}**`, ''];

  for (const o of market.outcomes) {
    const priceCents = (o.price * 100).toFixed(1);
    lines.push(`  ${o.name}: ${priceCents}c (${o.tokenId || o.id})`);
  }

  return lines.join('\n');
}

async function handleOrderbook(tokenId: string): Promise<string> {
  if (!tokenId) {
    return 'Usage: /op book <tokenId>\nExample: /op book 123456789';
  }

  const feed = await getFeed();
  const orderbook = await feed.getOrderbook('opinion', tokenId);

  if (!orderbook) {
    return `No orderbook found for token ${tokenId}`;
  }

  const lines = [
    `**Orderbook: ${tokenId}**`,
    '',
    `Mid: ${(orderbook.midPrice * 100).toFixed(1)}c | Spread: ${(orderbook.spread * 100).toFixed(2)}c`,
    '',
    '**Bids:**',
  ];

  for (const [price, size] of orderbook.bids.slice(0, 5)) {
    lines.push(`  ${(price * 100).toFixed(1)}c - ${size.toFixed(0)} shares`);
  }

  lines.push('', '**Asks:**');

  for (const [price, size] of orderbook.asks.slice(0, 5)) {
    lines.push(`  ${(price * 100).toFixed(1)}c - ${size.toFixed(0)} shares`);
  }

  return lines.join('\n');
}

// =============================================================================
// TRADING HANDLERS
// =============================================================================

async function handleBuy(
  marketId: string,
  outcome: string,
  price: string,
  size: string
): Promise<string> {
  const exec = getExecution();
  if (!exec) {
    return 'Set OPINION_API_KEY and OPINION_PRIVATE_KEY to trade';
  }

  if (!marketId || !outcome || !price || !size) {
    return 'Usage: /op buy <marketId> <outcome> <price> <size>\nExample: /op buy 813 YES 0.55 100';
  }

  // Get market to find token ID
  const feed = await getFeed();
  const market = await feed.getMarket(marketId);

  if (!market) {
    return `Market ${marketId} not found`;
  }

  const outcomeData = market.outcomes.find(
    o => o.name.toLowerCase() === outcome.toLowerCase()
  );

  if (!outcomeData) {
    return `Outcome "${outcome}" not found. Available: ${market.outcomes.map(o => o.name).join(', ')}`;
  }

  const tokenId = outcomeData.tokenId || outcomeData.id;
  const priceNum = parseFloat(price);
  const sizeNum = parseFloat(size);

  // Circuit breaker pre-trade check
  try {
    const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
    const cb = getGlobalCircuitBreaker();
    if (!cb.canTrade()) {
      const state = cb.getState();
      return `**Trade blocked** — Circuit breaker tripped: ${state.tripReason || 'unknown'}\nUse \`/risk reset\` to re-arm.`;
    }
  } catch { /* circuit breaker non-critical */ }

  const result = await exec.buyLimit({
    platform: 'opinion',
    marketId,
    tokenId,
    outcome: outcomeData.name,
    price: priceNum,
    size: sizeNum,
  });

  // Circuit breaker post-trade recording
  try {
    const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
    const cb = getGlobalCircuitBreaker();
    cb.recordTrade({ pnlUsd: 0, success: result.success, sizeUsd: sizeNum * priceNum, error: result.error });
  } catch { /* circuit breaker non-critical */ }

  if (result.success) {
    try {
      const { getGlobalPositionManager } = await import('../../../execution/position-manager');
      const pm = getGlobalPositionManager();
      pm.updatePosition({
        platform: 'opinion' as any,
        marketId,
        tokenId,
        outcomeName: outcomeData.name,
        side: 'long',
        size: sizeNum,
        entryPrice: result.avgFillPrice || priceNum,
        currentPrice: result.avgFillPrice || priceNum,
        openedAt: new Date(),
      });
    } catch { /* position tracking non-critical */ }
    return `BUY ${outcome} @ ${price} x ${size} (Order: ${result.orderId})`;
  }
  return `Order failed: ${result.error}`;
}

async function handleSell(
  marketId: string,
  outcome: string,
  price: string,
  size: string
): Promise<string> {
  const exec = getExecution();
  if (!exec) {
    return 'Set OPINION_API_KEY and OPINION_PRIVATE_KEY to trade';
  }

  if (!marketId || !outcome || !price || !size) {
    return 'Usage: /op sell <marketId> <outcome> <price> <size>\nExample: /op sell 813 YES 0.60 100';
  }

  // Get market to find token ID
  const feed = await getFeed();
  const market = await feed.getMarket(marketId);

  if (!market) {
    return `Market ${marketId} not found`;
  }

  const outcomeData = market.outcomes.find(
    o => o.name.toLowerCase() === outcome.toLowerCase()
  );

  if (!outcomeData) {
    return `Outcome "${outcome}" not found. Available: ${market.outcomes.map(o => o.name).join(', ')}`;
  }

  const tokenId = outcomeData.tokenId || outcomeData.id;
  const priceNum = parseFloat(price);
  const sizeNum = parseFloat(size);

  // Circuit breaker pre-trade check
  try {
    const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
    const cb = getGlobalCircuitBreaker();
    if (!cb.canTrade()) {
      const state = cb.getState();
      return `**Trade blocked** — Circuit breaker tripped: ${state.tripReason || 'unknown'}\nUse \`/risk reset\` to re-arm.`;
    }
  } catch { /* circuit breaker non-critical */ }

  const result = await exec.sellLimit({
    platform: 'opinion',
    marketId,
    tokenId,
    outcome: outcomeData.name,
    price: priceNum,
    size: sizeNum,
  });

  // Circuit breaker post-trade recording
  try {
    const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
    const cb = getGlobalCircuitBreaker();
    cb.recordTrade({ pnlUsd: 0, success: result.success, sizeUsd: sizeNum * priceNum, error: result.error });
  } catch { /* circuit breaker non-critical */ }

  if (result.success) {
    try {
      const { getGlobalPositionManager } = await import('../../../execution/position-manager');
      const pm = getGlobalPositionManager();
      const existing = pm.getPositionsByPlatform('opinion' as any)
        .find(p => p.tokenId === tokenId && p.status === 'open');
      if (existing) {
        pm.closePosition(existing.id, result.avgFillPrice || priceNum, 'manual');
      }
    } catch { /* position tracking non-critical */ }
    return `SELL ${outcome} @ ${price} x ${size} (Order: ${result.orderId})`;
  }
  return `Order failed: ${result.error}`;
}

async function handleCancel(orderId: string): Promise<string> {
  const exec = getExecution();
  if (!exec) {
    return 'Set OPINION_API_KEY to manage orders';
  }

  if (!orderId) {
    return 'Usage: /op cancel <orderId>';
  }

  const success = await exec.cancelOrder('opinion', orderId);
  return success ? `Order ${orderId} cancelled` : `Failed to cancel order ${orderId}`;
}

async function handleCancelAll(): Promise<string> {
  const exec = getExecution();
  if (!exec) {
    return 'Set OPINION_API_KEY to manage orders';
  }

  const count = await exec.cancelAllOrders('opinion');
  return `Cancelled ${count} order(s)`;
}

async function handleOrders(): Promise<string> {
  const exec = getExecution();
  if (!exec) {
    return 'Set OPINION_API_KEY to view orders';
  }

  const orders = await exec.getOpenOrders('opinion');

  if (orders.length === 0) {
    return 'No open orders';
  }

  const lines = ['**Open Orders**', ''];

  for (const o of orders) {
    lines.push(
      `  [${o.orderId}] ${o.side} ${o.outcome} @ ${(o.price * 100).toFixed(1)}c x ${o.remainingSize}`
    );
  }

  return lines.join('\n');
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

const skill = {
  name: 'opinion',
  description: 'Opinion.trade prediction market (BNB Chain)',
  commands: ['/op'],

  async handle(args: string): Promise<string> {
    const parts = args.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    try {
      switch (cmd) {
        // Market Data
        case 'markets':
        case 'm':
        case '':
        case undefined:
          return handleMarkets(parts.slice(1).join(' ') || undefined);

        case 'market':
          return handleMarket(parts[1]);

        case 'price':
        case 'p':
          return handlePrice(parts[1]);

        case 'book':
        case 'ob':
          return handleOrderbook(parts[1]);

        // Trading
        case 'buy':
        case 'b':
          return handleBuy(parts[1], parts[2], parts[3], parts[4]);

        case 'sell':
        case 's':
          return handleSell(parts[1], parts[2], parts[3], parts[4]);

        case 'cancel':
          return handleCancel(parts[1]);

        case 'cancelall':
          return handleCancelAll();

        case 'orders':
        case 'o':
          return handleOrders();

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
          return [
            '**Opinion.trade Commands**',
            '',
            '**Market Data:**',
            '  /op markets [query]   - Search markets',
            '  /op market <id>       - Market details',
            '  /op price <id>        - Current prices',
            '  /op book <tokenId>    - Orderbook',
            '',
            '**Trading:**',
            '  /op buy <id> <outcome> <price> <size>',
            '  /op sell <id> <outcome> <price> <size>',
            '  /op orders            - Open orders',
            '  /op cancel <orderId>  - Cancel order',
            '  /op cancelall         - Cancel all',
            '',
            '**Risk:**',
            '  /op circuit           - Circuit breaker status',
            '',
            '**Examples:**',
            '  /op markets trump',
            '  /op buy 813 YES 0.55 100',
            '  /op sell 813 NO 0.40 50',
          ].join('\n');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, args }, 'Opinion command failed');
      return `Error: ${message}`;
    }
  },
};

export default skill;
