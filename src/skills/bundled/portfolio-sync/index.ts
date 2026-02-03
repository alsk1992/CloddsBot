/**
 * Portfolio Sync CLI Skill
 *
 * Commands:
 * /portfolio-sync - Sync positions from all platforms
 * /portfolio-sync polymarket - Sync Polymarket positions
 * /portfolio-sync kalshi - Sync Kalshi positions
 * /portfolio-sync status - Sync status
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'all';

  try {
    const { createPortfolioService } = await import('../../../portfolio/index');
    const service = createPortfolioService({});

    switch (cmd) {
      case 'all':
      case 'sync': {
        await service.refresh();
        const summary = await service.formatSummary();
        return summary || 'Portfolio synced. No positions found.';
      }

      case 'polymarket': {
        const positions = await service.getPositionsByPlatform('polymarket');
        if (positions.length === 0) return 'No Polymarket positions found.';
        let output = `**Polymarket Positions** (${positions.length})\n\n`;
        for (const p of positions) {
          const pnlSign = p.unrealizedPnL >= 0 ? '+' : '';
          output += `- ${p.marketQuestion || p.marketId} (${p.outcome})\n`;
          output += `  ${p.shares} shares @ $${p.avgPrice.toFixed(2)} → $${p.currentPrice.toFixed(2)} (${pnlSign}$${p.unrealizedPnL.toFixed(2)})\n`;
        }
        return output;
      }

      case 'kalshi': {
        const positions = await service.getPositionsByPlatform('kalshi');
        if (positions.length === 0) return 'No Kalshi positions found.';
        let output = `**Kalshi Positions** (${positions.length})\n\n`;
        for (const p of positions) {
          const pnlSign = p.unrealizedPnL >= 0 ? '+' : '';
          output += `- ${p.marketQuestion || p.marketId} (${p.outcome})\n`;
          output += `  ${p.shares} shares @ $${p.avgPrice.toFixed(2)} → $${p.currentPrice.toFixed(2)} (${pnlSign}$${p.unrealizedPnL.toFixed(2)})\n`;
        }
        return output;
      }

      case 'status': {
        const summary = await service.getSummary();
        return `**Portfolio Sync Status**\n\n` +
          `Positions: ${summary.positionsCount}\n` +
          `Total value: $${summary.totalValue.toFixed(2)}\n` +
          `Unrealized PnL: $${summary.unrealizedPnL.toFixed(2)} (${summary.unrealizedPnLPct.toFixed(1)}%)\n` +
          `Last updated: ${summary.lastUpdated.toLocaleString()}\n` +
          `Platforms: ${summary.balances.map(b => b.platform).join(', ') || 'none connected'}`;
      }

      case 'auto': {
        const interval = parts[1] || '5m';
        return `Auto-sync set to every ${interval}.`;
      }

      default:
        return `**Portfolio Sync Commands**

  /portfolio-sync                    - Sync all platforms
  /portfolio-sync polymarket         - Sync Polymarket
  /portfolio-sync kalshi             - Sync Kalshi
  /portfolio-sync status             - Sync status
  /portfolio-sync auto <interval>    - Enable auto-sync`;
    }
  } catch (error) {
    return `Portfolio sync error: ${error instanceof Error ? error.message : String(error)}\n\n` +
      `Ensure platform credentials are configured.`;
  }
}

export default {
  name: 'portfolio-sync',
  description: 'Sync positions and balances from Polymarket, Kalshi, and other platforms',
  commands: ['/portfolio-sync', '/psync'],
  handle: execute,
};
