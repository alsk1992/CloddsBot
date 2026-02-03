/**
 * Router CLI Skill
 *
 * Commands:
 * /router status - Smart order router status
 * /router config - Router configuration
 * /router set mode <best_price|best_liquidity|balanced> - Set routing mode
 * /router route <order> - Route an order
 */

import type { RoutingMode } from '../../../execution/smart-router';

let routerConfig: { mode: RoutingMode; maxSlippage: number; preferMaker: boolean; allowSplitting: boolean } = {
  mode: 'balanced',
  maxSlippage: 1,
  preferMaker: true,
  allowSplitting: false,
};

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const { createSmartRouter, PLATFORM_FEES, EXECUTION_TIMES } = await import('../../../execution/smart-router');

    switch (cmd) {
      case 'status': {
        const platforms = Object.keys(PLATFORM_FEES);
        const avgExec = Object.values(EXECUTION_TIMES).reduce((a, b) => a + (b ?? 0), 0) / Object.keys(EXECUTION_TIMES).length;
        return `**Smart Order Router**\n\n` +
          `Mode: ${routerConfig.mode}\n` +
          `Enabled platforms: ${platforms.join(', ')}\n` +
          `Max slippage: ${routerConfig.maxSlippage}%\n` +
          `Prefer maker: ${routerConfig.preferMaker}\n` +
          `Order splitting: ${routerConfig.allowSplitting ? 'enabled' : 'disabled'}\n` +
          `Avg execution time: ${Math.round(avgExec)}ms`;
      }

      case 'config': {
        let output = `**Router Config**\n\n`;
        output += `Mode: ${routerConfig.mode}\n`;
        output += `Max slippage: ${routerConfig.maxSlippage}%\n`;
        output += `Prefer maker: ${routerConfig.preferMaker}\n`;
        output += `Allow splitting: ${routerConfig.allowSplitting}\n\n`;
        output += `**Platform Fees (taker/maker bps)**\n`;
        for (const [platform, fees] of Object.entries(PLATFORM_FEES)) {
          if (fees) output += `  ${platform}: ${fees.takerBps}/${fees.makerBps}\n`;
        }
        return output;
      }

      case 'set': {
        if (parts[1] === 'mode') {
          const mode = parts[2] as RoutingMode;
          if (!['best_price', 'best_liquidity', 'lowest_fee', 'balanced'].includes(mode || '')) {
            return 'Usage: /router set mode <best_price|best_liquidity|lowest_fee|balanced>';
          }
          routerConfig.mode = mode;
          return `Router mode set to **${mode}**.`;
        }
        if (parts[1] === 'slippage') {
          const val = parseFloat(parts[2]);
          if (isNaN(val)) return 'Usage: /router set slippage <percent>';
          routerConfig.maxSlippage = val;
          return `Max slippage set to ${val}%.`;
        }
        if (parts[1] === 'splitting') {
          routerConfig.allowSplitting = parts[2] === 'on' || parts[2] === 'true';
          return `Order splitting ${routerConfig.allowSplitting ? 'enabled' : 'disabled'}.`;
        }
        return 'Usage: /router set <mode|slippage|splitting> <value>';
      }

      case 'route': {
        const order = parts.slice(1).join(' ');
        if (!order) return 'Usage: /router route <platform> <market> <side> <size>\n\nExample: /router route polymarket btc-100k buy 100';
        // Parse: platform marketId side size
        const [, marketId, side, sizeStr] = parts;
        if (!marketId || !side || !sizeStr) {
          return 'Usage: /router route <market-id> <buy|sell> <size>';
        }
        const size = parseFloat(sizeStr);
        if (isNaN(size)) return 'Invalid size.';

        const { createFeedManager } = await import('../../../feeds/index');
        const feeds = await createFeedManager({} as any);
        const router = createSmartRouter(feeds, routerConfig);
        const result = await router.findBestRoute({
          marketId,
          side: side as 'buy' | 'sell',
          size,
        });
        let output = `**Routing Result**\n\n`;
        output += `Best: ${result.bestRoute.platform} @ $${result.bestRoute.netPrice.toFixed(4)}\n`;
        output += `Fees: $${result.bestRoute.estimatedFees.toFixed(4)}\n`;
        output += `Slippage: ${result.bestRoute.slippage.toFixed(2)}%\n`;
        output += `Maker: ${result.bestRoute.isMaker}\n\n`;
        if (result.allRoutes.length > 1) {
          output += `**All Routes**\n`;
          for (const r of result.allRoutes) {
            output += `  ${r.platform}: $${r.netPrice.toFixed(4)} (fees: $${r.estimatedFees.toFixed(4)}, slip: ${r.slippage.toFixed(2)}%)\n`;
          }
        }
        output += `\n${result.recommendation}`;
        return output;
      }

      default:
        return `**Router Commands**

  /router status                     - Router status
  /router config                     - Configuration
  /router set mode <mode>            - Set routing mode
  /router set slippage <pct>         - Set max slippage
  /router set splitting <on|off>     - Toggle order splitting
  /router route <market> <side> <sz> - Route an order

Modes: best_price, best_liquidity, lowest_fee, balanced`;
    }
  } catch (error) {
    return `Router error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export default {
  name: 'router',
  description: 'Smart order routing across platforms for best price and liquidity',
  commands: ['/router', '/route'],
  handle: execute,
};
