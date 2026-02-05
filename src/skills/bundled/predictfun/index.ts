/**
 * Predict.fun Skill
 *
 * CLI commands for Predict.fun prediction market on BNB Chain.
 */

import * as predictfun from '../../../exchanges/predictfun';
import type {
  PredictFunConfig,
  PredictFunPosition,
  PredictFunOrder,
  PredictFunBalance,
} from '../../../exchanges/predictfun';
import { logger } from '../../../utils/logger';

// =============================================================================
// HELPERS
// =============================================================================

function formatNumber(n: number | string, decimals = 2): string {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '0';
  if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(decimals) + 'B';
  if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(decimals) + 'M';
  if (Math.abs(num) >= 1e3) return (num / 1e3).toFixed(decimals) + 'K';
  return num.toFixed(decimals);
}

function getConfig(): PredictFunConfig | null {
  const privateKey = process.env.PREDICTFUN_PRIVATE_KEY;
  if (!privateKey) return null;

  return {
    privateKey,
    apiKey: process.env.PREDICTFUN_API_KEY,
    dryRun: process.env.DRY_RUN === 'true',
  };
}

// =============================================================================
// MARKET DATA HANDLERS
// =============================================================================

async function handleMarkets(query?: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'PREDICTFUN_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  try {
    // query can be used as status filter (active, closed) or first/after pagination
    const options = query ? { status: query, first: 50 } : { first: 50 };
    const markets = await predictfun.getMarkets(config, options);

    if (!Array.isArray(markets) || markets.length === 0) {
      return query ? `No markets found for "${query}"` : 'No markets found';
    }

    const lines = ['**Predict.fun Markets**', ''];

    for (const m of (markets as Array<{ id: string; question: string; outcomes?: Array<{ name: string; price?: number }> }>).slice(0, 15)) {
      const yesPrice = m.outcomes?.find((o: { name: string }) => o.name.toLowerCase() === 'yes')?.price || 0;
      lines.push(`  [${m.id}] ${m.question}`);
      lines.push(`       YES: ${(yesPrice * 100).toFixed(0)}c`);
    }

    if (markets.length > 15) {
      lines.push('', `...and ${markets.length - 15} more`);
    }

    return lines.join('\n');
  } catch (error) {
    logger.error('Failed to get Predict.fun markets', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to get markets'}`;
  }
}

async function handleMarket(marketId: string): Promise<string> {
  if (!marketId) {
    return 'Usage: /pf market <id>\nExample: /pf market abc123';
  }

  const config = getConfig();
  if (!config) {
    return 'PREDICTFUN_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  try {
    const market = await predictfun.getMarket(config, marketId) as {
      id: string;
      question: string;
      description?: string;
      outcomes?: Array<{ name: string; price?: number }>;
      volume?: number;
    } | null;

    if (!market) {
      return `Market ${marketId} not found`;
    }

    const lines = [
      `**${market.question}**`,
      '',
      `ID: ${market.id}`,
      `Platform: Predict.fun`,
      market.description ? `Description: ${market.description}` : '',
      '',
      '**Outcomes:**',
    ];

    if (market.outcomes) {
      for (const outcome of market.outcomes) {
        const price = outcome.price || 0;
        lines.push(`  ${outcome.name}: ${(price * 100).toFixed(0)}c`);
      }
    }

    if (market.volume) {
      lines.push('', `Volume: $${formatNumber(market.volume)}`);
    }

    return lines.filter(Boolean).join('\n');
  } catch (error) {
    logger.error('Failed to get Predict.fun market', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to get market'}`;
  }
}

async function handleOrderbook(marketId: string): Promise<string> {
  if (!marketId) {
    return 'Usage: /pf book <marketId>\nExample: /pf book abc123';
  }

  const config = getConfig();
  if (!config) {
    return 'PREDICTFUN_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  try {
    const orderbook = await predictfun.getOrderbook(config, marketId) as {
      bids?: Array<{ price: number; size: number }>;
      asks?: Array<{ price: number; size: number }>;
    } | null;

    if (!orderbook) {
      return `No orderbook for market ${marketId}`;
    }

    const lines = ['**Orderbook**', ''];

    lines.push('ASKS (Sell orders):');
    const asks = orderbook.asks?.slice(0, 5) || [];
    for (const ask of asks.reverse()) {
      lines.push(`  ${(ask.price * 100).toFixed(1)}c | ${formatNumber(ask.size)}`);
    }

    lines.push('---');

    lines.push('BIDS (Buy orders):');
    const bids = orderbook.bids?.slice(0, 5) || [];
    for (const bid of bids) {
      lines.push(`  ${(bid.price * 100).toFixed(1)}c | ${formatNumber(bid.size)}`);
    }

    return lines.join('\n');
  } catch (error) {
    logger.error('Failed to get Predict.fun orderbook', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to get orderbook'}`;
  }
}

// =============================================================================
// ACCOUNT HANDLERS
// =============================================================================

async function handleBalance(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'PREDICTFUN_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  try {
    const balance: PredictFunBalance = await predictfun.getBalance(config);

    return [
      '**Predict.fun Balance**',
      '',
      `USDT: $${formatNumber(balance.usdtBalance)}`,
    ].join('\n');
  } catch (error) {
    logger.error('Failed to get Predict.fun balance', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to get balance'}`;
  }
}

async function handlePositions(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'PREDICTFUN_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  try {
    const positions: PredictFunPosition[] = await predictfun.getPositions(config);

    if (positions.length === 0) {
      return 'No open positions';
    }

    const lines = ['**Predict.fun Positions**', ''];

    for (const pos of positions) {
      lines.push(`${pos.marketTitle || pos.marketId}`);
      lines.push(`  ${pos.outcome}: ${formatNumber(pos.shares)} shares @ ${formatNumber(parseFloat(pos.avgEntryPrice) * 100)}c`);
      if (pos.currentPrice) {
        const avgEntry = parseFloat(pos.avgEntryPrice);
        const current = parseFloat(pos.currentPrice);
        const pnlPct = avgEntry > 0 ? ((current - avgEntry) / avgEntry * 100).toFixed(1) : '0';
        lines.push(`  Current: ${formatNumber(current * 100)}c (${pnlPct}%)`);
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  } catch (error) {
    logger.error('Failed to get Predict.fun positions', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to get positions'}`;
  }
}

async function handleOrders(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'PREDICTFUN_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  try {
    const orders: PredictFunOrder[] = await predictfun.getOpenOrders(config);

    if (orders.length === 0) {
      return 'No open orders';
    }

    const lines = ['**Predict.fun Open Orders**', ''];

    for (const order of orders) {
      lines.push(`[${order.orderHash.slice(0, 10)}...] ${order.marketId}`);
      lines.push(`  ${order.side} ${formatNumber(order.size)} @ ${formatNumber(parseFloat(order.price) * 100)}c`);
      lines.push('');
    }

    return lines.join('\n').trim();
  } catch (error) {
    logger.error('Failed to get Predict.fun orders', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to get orders'}`;
  }
}

// =============================================================================
// TRADING HANDLERS
// =============================================================================

async function handleBuy(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 4) {
    return 'Usage: /pf buy <marketId> <outcome> <price> <size>\nExample: /pf buy market-123 YES 0.55 100';
  }

  const [marketId, outcome, priceStr, sizeStr] = parts;
  const price = parseFloat(priceStr);
  const size = parseFloat(sizeStr);

  if (isNaN(price) || price <= 0 || price >= 1) {
    return 'Invalid price. Must be between 0 and 1 (e.g., 0.55 for 55c).';
  }

  if (isNaN(size) || size <= 0) {
    return 'Invalid size. Must be a positive number.';
  }

  const config = getConfig();
  if (!config) {
    return 'PREDICTFUN_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  if (process.env.DRY_RUN === 'true') {
    return `[DRY RUN] Would BUY ${size} ${outcome.toUpperCase()} @ ${(price * 100).toFixed(0)}c on ${marketId}`;
  }

  try {
    // Get market info to find tokenId for the outcome
    const market = await predictfun.getMarket(config, marketId) as {
      id: string;
      outcomes?: Array<{ name: string; tokenId: string }>;
    } | null;

    if (!market || !market.outcomes) {
      return `Market ${marketId} not found or has no outcomes`;
    }

    const outcomeInfo = market.outcomes.find((o) => o.name.toUpperCase() === outcome.toUpperCase());
    if (!outcomeInfo) {
      return `Outcome "${outcome}" not found in market. Available: ${market.outcomes.map(o => o.name).join(', ')}`;
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

    const result = await predictfun.createOrder(config, {
      marketId,
      tokenId: outcomeInfo.tokenId,
      side: 'BUY',
      price,
      quantity: size,
    });

    // Circuit breaker post-trade recording
    try {
      const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
      const cb = getGlobalCircuitBreaker();
      cb.recordTrade({ pnlUsd: 0, success: result.success, sizeUsd: size * price, error: result.error });
    } catch { /* circuit breaker non-critical */ }

    if (!result.success) {
      return `Failed to place order: ${result.error}`;
    }

    // Position tracking
    try {
      const { getGlobalPositionManager } = await import('../../../execution/position-manager');
      const pm = getGlobalPositionManager();
      pm.updatePosition({
        platform: 'predictfun' as any,
        marketId,
        tokenId: outcomeInfo.tokenId,
        outcomeName: outcome.toUpperCase(),
        side: 'long',
        size,
        entryPrice: price,
        currentPrice: price,
        openedAt: new Date(),
      });
    } catch { /* position tracking non-critical */ }

    return [
      '**Order Placed**',
      `Market: ${marketId}`,
      `BUY ${outcome.toUpperCase()} ${size} @ ${(price * 100).toFixed(0)}c`,
      `Order Hash: ${result.orderHash || result.orderId}`,
    ].join('\n');
  } catch (error) {
    logger.error('Failed to place Predict.fun order', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to place order'}`;
  }
}

async function handleSell(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 4) {
    return 'Usage: /pf sell <marketId> <outcome> <price> <size>\nExample: /pf sell market-123 NO 0.40 50';
  }

  const [marketId, outcome, priceStr, sizeStr] = parts;
  const price = parseFloat(priceStr);
  const size = parseFloat(sizeStr);

  if (isNaN(price) || price <= 0 || price >= 1) {
    return 'Invalid price. Must be between 0 and 1 (e.g., 0.40 for 40c).';
  }

  if (isNaN(size) || size <= 0) {
    return 'Invalid size. Must be a positive number.';
  }

  const config = getConfig();
  if (!config) {
    return 'PREDICTFUN_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  if (process.env.DRY_RUN === 'true') {
    return `[DRY RUN] Would SELL ${size} ${outcome.toUpperCase()} @ ${(price * 100).toFixed(0)}c on ${marketId}`;
  }

  try {
    // Get market info to find tokenId for the outcome
    const market = await predictfun.getMarket(config, marketId) as {
      id: string;
      outcomes?: Array<{ name: string; tokenId: string }>;
    } | null;

    if (!market || !market.outcomes) {
      return `Market ${marketId} not found or has no outcomes`;
    }

    const outcomeInfo = market.outcomes.find((o) => o.name.toUpperCase() === outcome.toUpperCase());
    if (!outcomeInfo) {
      return `Outcome "${outcome}" not found in market. Available: ${market.outcomes.map(o => o.name).join(', ')}`;
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

    const result = await predictfun.createOrder(config, {
      marketId,
      tokenId: outcomeInfo.tokenId,
      side: 'SELL',
      price,
      quantity: size,
    });

    // Circuit breaker post-trade recording
    try {
      const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
      const cb = getGlobalCircuitBreaker();
      cb.recordTrade({ pnlUsd: 0, success: result.success, sizeUsd: size * price, error: result.error });
    } catch { /* circuit breaker non-critical */ }

    if (!result.success) {
      return `Failed to place order: ${result.error}`;
    }

    // Position tracking - close existing position on sell
    try {
      const { getGlobalPositionManager } = await import('../../../execution/position-manager');
      const pm = getGlobalPositionManager();
      const existing = pm.getPositionsByPlatform('predictfun' as any)
        .find(p => p.tokenId === outcomeInfo.tokenId && p.status === 'open');
      if (existing) {
        pm.closePosition(existing.id, price, 'manual');
      }
    } catch { /* position tracking non-critical */ }

    return [
      '**Order Placed**',
      `Market: ${marketId}`,
      `SELL ${outcome.toUpperCase()} ${size} @ ${(price * 100).toFixed(0)}c`,
      `Order Hash: ${result.orderHash || result.orderId}`,
    ].join('\n');
  } catch (error) {
    logger.error('Failed to place Predict.fun order', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to place order'}`;
  }
}

async function handleCancel(orderHash: string): Promise<string> {
  if (!orderHash) {
    return 'Usage: /pf cancel <orderHash>\nExample: /pf cancel 0x123...';
  }

  const config = getConfig();
  if (!config) {
    return 'PREDICTFUN_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  if (process.env.DRY_RUN === 'true') {
    return `[DRY RUN] Would cancel order ${orderHash}`;
  }

  try {
    // Need to get orders to find the order details for cancellation
    const orders = await predictfun.getOpenOrders(config);
    const order = orders.find(o => o.orderHash === orderHash || o.orderHash.startsWith(orderHash));

    if (!order) {
      return `Order ${orderHash} not found in open orders`;
    }

    const result = await predictfun.cancelOrders(config, [orderHash], {
      isNegRisk: order.isNegRisk,
      isYieldBearing: order.isYieldBearing,
    });
    return result.success ? `Order ${orderHash} cancelled` : `Failed to cancel order: ${result.error}`;
  } catch (error) {
    logger.error('Failed to cancel Predict.fun order', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to cancel order'}`;
  }
}

async function handleCancelAll(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'PREDICTFUN_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  if (process.env.DRY_RUN === 'true') {
    return '[DRY RUN] Would cancel all orders';
  }

  try {
    const result = await predictfun.cancelAllOrders(config);
    return `Cancelled ${result.cancelled} order(s)`;
  } catch (error) {
    logger.error('Failed to cancel all Predict.fun orders', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to cancel orders'}`;
  }
}

async function handleRedeem(conditionId: string): Promise<string> {
  if (!conditionId) {
    return 'Usage: /pf redeem <conditionId>\nExample: /pf redeem 0x123...';
  }

  const config = getConfig();
  if (!config) {
    return 'PREDICTFUN_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  if (process.env.DRY_RUN === 'true') {
    return `[DRY RUN] Would redeem positions for ${conditionId}`;
  }

  try {
    // Get positions to find the position details for this condition
    const positions = await predictfun.getPositions(config);
    const position = positions.find(p => p.conditionId === conditionId);

    if (!position) {
      return `No position found for condition ${conditionId}`;
    }

    // Determine indexSet from the position's indexSet (usually "1" or "2")
    const indexSet = position.indexSet === '1' ? 1 : 2;

    const result = await predictfun.redeemPositions(
      config,
      conditionId,
      indexSet as 1 | 2,
      {
        isNegRisk: position.isNegRisk,
        isYieldBearing: position.isYieldBearing,
      }
    );
    return result.success ? `Redeemed positions for ${conditionId}` : `Failed to redeem: ${result.error}`;
  } catch (error) {
    logger.error('Failed to redeem Predict.fun positions', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to redeem'}`;
  }
}

async function handleMerge(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 2) {
    return 'Usage: /pf merge <conditionId> <amount>\nExample: /pf merge 0x123... 100';
  }

  const [conditionId, amountStr] = parts;
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    return 'Invalid amount. Must be a positive number.';
  }

  const config = getConfig();
  if (!config) {
    return 'PREDICTFUN_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  if (process.env.DRY_RUN === 'true') {
    return `[DRY RUN] Would merge ${amount} tokens for ${conditionId}`;
  }

  try {
    // Get positions to find the market for this condition
    const positions = await predictfun.getPositions(config);
    const position = positions.find(p => p.conditionId === conditionId);

    if (!position) {
      return `No position found for condition ${conditionId}`;
    }

    const result = await predictfun.mergePositions(
      config,
      conditionId,
      amount,
      {
        isNegRisk: position.isNegRisk,
        isYieldBearing: position.isYieldBearing,
      }
    );
    return result.success ? `Merged ${amount} tokens for ${conditionId}` : `Failed to merge: ${result.error}`;
  } catch (error) {
    logger.error('Failed to merge Predict.fun positions', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to merge'}`;
  }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export async function handle(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || '';
  const rest = parts.slice(1).join(' ');

  switch (command) {
    case '':
    case 'help':
      return [
        '**Predict.fun Commands**',
        '',
        '`/pf markets [query]` - Search markets',
        '`/pf market <id>` - Market details',
        '`/pf book <marketId>` - Orderbook',
        '`/pf balance` - Account balance',
        '`/pf positions` - Open positions',
        '`/pf orders` - Open orders',
        '`/pf buy <marketId> <outcome> <price> <size>` - Buy',
        '`/pf sell <marketId> <outcome> <price> <size>` - Sell',
        '`/pf cancel <orderHash>` - Cancel order',
        '`/pf cancelall` - Cancel all orders',
        '`/pf redeem <conditionId>` - Redeem settled',
        '`/pf merge <conditionId> <amount>` - Merge tokens',
        '`/pf circuit` - Circuit breaker status',
      ].join('\n');

    case 'markets':
    case 'm':
      return handleMarkets(rest || undefined);

    case 'market':
      return handleMarket(rest);

    case 'book':
    case 'orderbook':
    case 'ob':
      return handleOrderbook(rest);

    case 'balance':
    case 'b':
      return handleBalance();

    case 'positions':
    case 'pos':
    case 'p':
      return handlePositions();

    case 'orders':
    case 'o':
      return handleOrders();

    case 'buy':
      return handleBuy(rest);

    case 'sell':
      return handleSell(rest);

    case 'cancel':
      return handleCancel(rest);

    case 'cancelall':
      return handleCancelAll();

    case 'redeem':
      return handleRedeem(rest);

    case 'merge':
      return handleMerge(rest);

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

    default:
      return `Unknown command: ${command}. Use /pf help for available commands.`;
  }
}

export default {
  name: 'predictfun',
  description: 'Predict.fun prediction market on BNB Chain - trade, manage positions, and browse markets',
  commands: ['/predictfun', '/pf'],
  handle,
};
