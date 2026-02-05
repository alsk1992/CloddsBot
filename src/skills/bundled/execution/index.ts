/**
 * Execution CLI Skill
 *
 * Commands:
 * /exec buy <market> <amount> - Buy on market
 * /exec sell <market> <amount> - Sell on market
 * /exec orders - List open orders
 * /exec cancel <id> - Cancel order
 * /exec slippage <market> <size> - Estimate slippage
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const { createExecutionService } = await import('../../../execution/index');

    // Parse common flags
    const platformIdx = parts.indexOf('--platform');
    const platform = (platformIdx >= 0 ? parts[platformIdx + 1] : 'polymarket') as 'polymarket' | 'kalshi' | 'opinion' | 'predictfun';
    const priceIdx = parts.indexOf('--price');
    const price = priceIdx >= 0 ? parseFloat(parts[priceIdx + 1]) : undefined;
    const slippageIdx = parts.indexOf('--slippage');
    const maxSlippage = slippageIdx >= 0 ? parseFloat(parts[slippageIdx + 1]) / 100 : 0.02;

    const service = createExecutionService({} as any);

    // Lazy circuit breaker getter
    const getCircuitBreaker = async () => {
      const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
      return getGlobalCircuitBreaker();
    };

    switch (cmd) {
      case 'buy': {
        if (parts.length < 3) return 'Usage: /exec buy <market-id> <amount> [--price <p>] [--platform <name>] [--slippage <pct>]';
        const marketId = parts[1];
        const size = parseFloat(parts[2]);
        if (isNaN(size)) return 'Invalid amount.';

        const cb = await getCircuitBreaker();
        if (!cb.canTrade()) {
          const state = cb.getState();
          return `**Trade blocked** — Circuit breaker tripped: ${state.tripReason || 'unknown'}\nUse \`/risk reset\` to re-arm.`;
        }

        const request = { platform, marketId, price: price || 0.50, size };
        const result = price
          ? await service.buyLimit(request)
          : await service.protectedBuy(request, maxSlippage);

        cb.recordTrade({
          pnlUsd: 0,
          success: result.success,
          sizeUsd: size * (price || 0.50),
          error: result.error,
        });

        if (result.success) {
          try {
            const { getGlobalPositionManager } = await import('../../../execution/position-manager');
            const pm = getGlobalPositionManager();
            pm.updatePosition({
              platform: platform as any,
              marketId,
              tokenId: marketId,
              outcomeName: 'Yes',
              side: 'long',
              size,
              entryPrice: result.avgFillPrice || price || 0.50,
              currentPrice: result.avgFillPrice || price || 0.50,
              openedAt: new Date(),
            });
          } catch { /* position tracking non-critical */ }
        }

        let output = `**Buy Order**\n\nPlatform: ${platform}\nMarket: ${marketId}\n`;
        output += `Size: ${size} shares\n`;
        if (price) output += `Price: ${price}\n`;
        output += `Status: ${result.status || (result.success ? 'submitted' : 'failed')}\n`;
        if (result.orderId) output += `Order ID: \`${result.orderId}\`\n`;
        if (result.avgFillPrice) output += `Fill price: ${result.avgFillPrice.toFixed(4)}\n`;
        if (result.error) output += `Error: ${result.error}\n`;
        return output;
      }

      case 'sell': {
        if (parts.length < 3) return 'Usage: /exec sell <market-id> <amount> [--price <p>] [--platform <name>]';
        const marketId = parts[1];
        const size = parseFloat(parts[2]);
        if (isNaN(size)) return 'Invalid amount.';

        const cb = await getCircuitBreaker();
        if (!cb.canTrade()) {
          const state = cb.getState();
          return `**Trade blocked** — Circuit breaker tripped: ${state.tripReason || 'unknown'}\nUse \`/risk reset\` to re-arm.`;
        }

        const request = { platform, marketId, price: price || 0.50, size };
        const result = price
          ? await service.sellLimit(request)
          : await service.protectedSell(request, maxSlippage);

        cb.recordTrade({
          pnlUsd: 0,
          success: result.success,
          sizeUsd: size * (price || 0.50),
          error: result.error,
        });

        if (result.success) {
          try {
            const { getGlobalPositionManager } = await import('../../../execution/position-manager');
            const pm = getGlobalPositionManager();
            const existing = pm.getPositionsByPlatform(platform as any)
              .find(p => p.tokenId === marketId && p.status === 'open');
            if (existing) {
              pm.closePosition(existing.id, result.avgFillPrice || price || 0.50, 'manual');
            }
          } catch { /* position tracking non-critical */ }
        }

        let output = `**Sell Order**\n\nPlatform: ${platform}\nMarket: ${marketId}\n`;
        output += `Size: ${size} shares\n`;
        if (price) output += `Price: ${price}\n`;
        output += `Status: ${result.status || (result.success ? 'submitted' : 'failed')}\n`;
        if (result.orderId) output += `Order ID: \`${result.orderId}\`\n`;
        if (result.avgFillPrice) output += `Fill price: ${result.avgFillPrice.toFixed(4)}\n`;
        if (result.error) output += `Error: ${result.error}\n`;
        return output;
      }

      case 'orders':
      case 'open': {
        const orders = await service.getOpenOrders(platform);
        if (!orders.length) return `No open orders on ${platform}.`;
        let output = `**Open Orders** (${orders.length} on ${platform})\n\n`;
        for (const o of orders) {
          output += `[${o.orderId}] ${o.side.toUpperCase()} ${o.originalSize} @ ${o.price.toFixed(4)}`;
          output += ` | ${o.status} | ${o.marketId}\n`;
        }
        return output;
      }

      case 'cancel': {
        if (!parts[1]) return 'Usage: /exec cancel <order-id> [--platform <name>]';
        if (parts[1] === 'all') {
          const count = await service.cancelAllOrders(platform);
          return `Cancelled ${count} orders on ${platform}.`;
        }
        const success = await service.cancelOrder(platform, parts[1]);
        return success ? `Order \`${parts[1]}\` cancelled.` : `Failed to cancel order \`${parts[1]}\`.`;
      }

      case 'status': {
        if (!parts[1]) return 'Usage: /exec status <order-id> [--platform <name>]';
        const order = await service.getOrder(platform, parts[1]);
        if (!order) return `Order \`${parts[1]}\` not found on ${platform}.`;
        let output = `**Order: \`${order.orderId}\`**\n\n`;
        output += `Platform: ${platform}\n`;
        output += `Market: ${order.marketId}\n`;
        output += `Side: ${order.side}\n`;
        output += `Size: ${order.originalSize} @ ${order.price.toFixed(4)}\n`;
        output += `Status: ${order.status}\n`;
        if (order.filledSize) output += `Filled: ${order.filledSize}\n`;
        return output;
      }

      case 'slippage':
      case 'estimate': {
        if (!parts[1]) return 'Usage: /exec slippage <market-id> <size> [--platform <name>]';
        const marketId = parts[1];
        const size = parseFloat(parts[2] || '100');
        const estimate = await service.estimateSlippage({ platform, marketId, side: 'buy', price: 0.50, size });
        return `**Slippage Estimate**\n\nMarket: ${marketId}\nSize: ${size}\nEstimated slippage: ${(estimate.slippage * 100).toFixed(2)}%\nExpected price: ${estimate.expectedPrice.toFixed(4)}`;
      }

      case 'twap': {
        // /exec twap <side> <market> <total> <price> <slices> <interval>
        const side = parts[1]?.toLowerCase();
        if (!side || (side !== 'buy' && side !== 'sell') || !parts[2] || !parts[3] || !parts[4]) {
          return 'Usage: /exec twap <buy|sell> <market-id> <total> <price> [slices] [interval-sec] [--platform <name>]';
        }
        const marketId = parts[2];
        const totalSize = parseFloat(parts[3]);
        const twapPrice = parseFloat(parts[4]);
        const slices = parts[5] ? parseInt(parts[5], 10) : 5;
        const intervalSec = parts[6] ? parseInt(parts[6], 10) : 30;

        if (isNaN(totalSize) || totalSize <= 0) return 'Invalid total size.';
        if (isNaN(twapPrice) || twapPrice < 0.01 || twapPrice > 0.99) return 'Invalid price (0.01-0.99).';

        const { createTwapOrder } = await import('../../../execution/twap');
        const twap = createTwapOrder(
          service,
          { platform, marketId, tokenId: marketId, side: side as 'buy' | 'sell', price: twapPrice },
          { totalSize, sliceSize: totalSize / slices, intervalMs: intervalSec * 1000 }
        );
        twap.start();

        return `**TWAP Started**\n\n${side.toUpperCase()} ${totalSize} shares @ ${twapPrice}\nPlatform: ${platform}\nSlices: ${slices} every ${intervalSec}s`;
      }

      case 'bracket': {
        // /exec bracket <market> <size> <tp> <sl>
        if (!parts[1] || !parts[2] || !parts[3] || !parts[4]) {
          return 'Usage: /exec bracket <market-id> <size> <tp-price> <sl-price> [--platform <name>]';
        }
        const marketId = parts[1];
        const bracketSize = parseFloat(parts[2]);
        const tp = parseFloat(parts[3]);
        const sl = parseFloat(parts[4]);

        if (isNaN(bracketSize) || bracketSize <= 0) return 'Invalid size.';
        if (isNaN(tp) || tp < 0.01 || tp > 0.99) return 'Invalid take-profit price (0.01-0.99).';
        if (isNaN(sl) || sl < 0.01 || sl > 0.99) return 'Invalid stop-loss price (0.01-0.99).';

        const { createBracketOrder } = await import('../../../execution/bracket-orders');
        const bracket = createBracketOrder(service, {
          platform: platform as 'polymarket' | 'kalshi',
          marketId,
          tokenId: marketId,
          size: bracketSize,
          side: 'long',
          takeProfitPrice: tp,
          stopLossPrice: sl,
        });
        await bracket.start();

        return `**Bracket Set**\n\nTP @ ${tp} / SL @ ${sl} for ${bracketSize} shares\nPlatform: ${platform}\nMarket: ${marketId}`;
      }

      case 'trigger':
      case 'triggers': {
        // /exec trigger <side> <market> <size> <price>
        // /exec triggers (list)
        const triggerSide = parts[1]?.toLowerCase();
        if (cmd === 'triggers' || !triggerSide || triggerSide === 'list') {
          return 'Trigger orders require a price feed. Use /poly trigger for Polymarket triggers.';
        }
        if (triggerSide !== 'buy' && triggerSide !== 'sell') {
          return 'Usage: /exec trigger <buy|sell> <market-id> <size> <trigger-price> [--platform <name>]';
        }
        if (!parts[2] || !parts[3] || !parts[4]) {
          return 'Usage: /exec trigger <buy|sell> <market-id> <size> <trigger-price> [--platform <name>]';
        }

        return `Trigger orders require a price feed subscription. Use /poly trigger for Polymarket triggers with real-time WebSocket feeds.`;
      }

      case 'circuit': {
        const cb = await getCircuitBreaker();
        const state = cb.getState();
        return `**Circuit Breaker**\n\n` +
          `Status: ${state.isTripped ? 'TRIPPED' : 'Armed'}\n` +
          `Session PnL: $${state.sessionPnL.toFixed(2)}\n` +
          `Daily trades: ${state.dailyTrades}\n` +
          `Consecutive losses: ${state.consecutiveLosses}\n` +
          `Error rate: ${(state.errorRate * 100).toFixed(0)}%\n` +
          (state.tripReason ? `Trip reason: ${state.tripReason}\n` : '') +
          `\nUse \`/risk trip\` / \`/risk reset\` to manually control.`;
      }

      case 'redeem': {
        if (platform !== 'polymarket') {
          return 'Redeem is currently only supported for Polymarket.';
        }

        const privateKey = process.env.POLY_PRIVATE_KEY;
        const funderAddress = process.env.POLY_FUNDER_ADDRESS;
        const apiKey = process.env.POLY_API_KEY;
        const apiSecret = process.env.POLY_API_SECRET;
        const passphrase = process.env.POLY_API_PASSPHRASE;

        if (!privateKey || !funderAddress || !apiKey || !apiSecret || !passphrase) {
          return 'Set POLY_PRIVATE_KEY, POLY_FUNDER_ADDRESS, POLY_API_KEY, POLY_API_SECRET, POLY_API_PASSPHRASE to redeem.';
        }

        const { createAutoRedeemer } = await import('../../../execution/auto-redeem');
        const redeemer = createAutoRedeemer({
          polymarketAuth: { address: funderAddress, apiKey, apiSecret, apiPassphrase: passphrase },
          privateKey,
          funderAddress,
          dryRun: process.env.DRY_RUN === 'true',
        });

        const condId = parts[1];
        const tokId = parts[2];

        if (condId && tokId) {
          const result = await redeemer.redeemPosition(condId, tokId);
          return result.success
            ? `Redeemed ${result.shares} shares → $${result.usdcRedeemed.toFixed(2)} USDC${result.txHash ? ` (tx: ${result.txHash})` : ''}`
            : `Redeem failed: ${result.error}`;
        }

        const results = await redeemer.redeemAll();
        if (results.length === 0) return 'No resolved positions to redeem.';

        const ok = results.filter(r => r.success);
        const totalUsdc = ok.reduce((s, r) => s + r.usdcRedeemed, 0);
        return `Redeemed ${ok.length}/${results.length} positions → $${totalUsdc.toFixed(2)} USDC`;
      }

      default:
        return helpText();
    }
  } catch {
    return helpText();
  }
}

function helpText(): string {
  return `**Execution Commands**

  /exec buy <market> <amount>          - Place buy order
  /exec sell <market> <amount>         - Place sell order
  /exec orders                         - List open orders
  /exec cancel <id|all>                - Cancel order(s)
  /exec status <id>                    - Check order status
  /exec slippage <market> <size>       - Estimate slippage

**Advanced Orders:**
  /exec twap <side> <market> <total> <price> [slices] [interval]
  /exec bracket <market> <size> <tp> <sl>
  /exec trigger <side> <market> <size> <price>
  /exec triggers
  /exec redeem [cond-id] [token-id]

**Options:**
  --price <price>                      - Limit price (omit for market order)
  --platform <name>                    - polymarket, kalshi, opinion, predictfun
  --slippage <pct>                     - Max slippage % (default: 2)`;
}

export default {
  name: 'execution',
  description: 'Execute trades on prediction markets with slippage protection',
  commands: ['/exec', '/execute'],
  handle: execute,
};
