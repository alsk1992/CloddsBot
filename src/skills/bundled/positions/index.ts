/**
 * Positions CLI Skill
 *
 * Commands:
 * /positions - View all open positions
 * /positions <id> - View position details
 * /positions stop-loss <id> <price> - Set stop-loss
 * /positions take-profit <id> <price> - Set take-profit
 * /positions close <id> - Close position
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'list';

  try {
    const { getGlobalPositionManager } = await import('../../../execution/position-manager');
    const manager = getGlobalPositionManager();

    switch (cmd) {
      case 'list':
      case '': {
        const positions = manager.getPositions();
        if (positions.length === 0) return 'No open positions.';
        const stats = manager.getStats();
        let output = `**Open Positions** (${stats.openPositions})\n\n`;
        for (const p of positions) {
          if (p.status !== 'open') continue;
          const pnlSign = p.unrealizedPnL >= 0 ? '+' : '';
          output += `**${p.id}** ${p.platform} ${p.side} ${p.outcomeName}\n`;
          output += `  ${p.size} shares @ $${p.entryPrice.toFixed(2)} → $${p.currentPrice.toFixed(2)}`;
          output += ` (${pnlSign}${p.unrealizedPnLPct.toFixed(1)}%)`;
          if (p.stopLoss) output += ` SL:$${p.stopLoss.toFixed(2)}`;
          if (p.takeProfit) output += ` TP:$${p.takeProfit.toFixed(2)}`;
          output += '\n';
        }
        output += `\nTotal unrealized PnL: $${stats.totalUnrealizedPnL.toFixed(2)}`;
        return output;
      }

      case 'stop-loss':
      case 'sl': {
        if (!parts[1] || !parts[2]) return 'Usage: /positions stop-loss <position-id> <price>';
        const price = parseFloat(parts[2]);
        if (isNaN(price)) return 'Invalid price.';
        manager.setStopLoss(parts[1], { price });
        return `Stop-loss set for position ${parts[1]} at $${price.toFixed(2)}.`;
      }

      case 'take-profit':
      case 'tp': {
        if (!parts[1] || !parts[2]) return 'Usage: /positions take-profit <position-id> <price>';
        const price = parseFloat(parts[2]);
        if (isNaN(price)) return 'Invalid price.';
        manager.setTakeProfit(parts[1], { price });
        return `Take-profit set for position ${parts[1]} at $${price.toFixed(2)}.`;
      }

      case 'trailing':
      case 'trail': {
        if (!parts[1] || !parts[2]) return 'Usage: /positions trailing <position-id> <distance%>';
        const pct = parseFloat(parts[2]);
        if (isNaN(pct)) return 'Invalid percentage.';
        manager.setStopLoss(parts[1], { trailingPercent: pct });
        return `Trailing stop set for position ${parts[1]} at ${pct}% distance.`;
      }

      case 'close': {
        if (!parts[1]) return 'Usage: /positions close <position-id>';
        const pos = manager.getPosition(parts[1]);
        if (!pos) return `Position ${parts[1]} not found.`;
        manager.closePosition(parts[1], pos.currentPrice, 'manual');
        return `Closed position ${parts[1]} at $${pos.currentPrice.toFixed(2)}.`;
      }

      case 'close-all': {
        const positions = manager.getPositions().filter(p => p.status === 'open');
        if (positions.length === 0) return 'No open positions to close.';
        for (const p of positions) {
          manager.closePosition(p.id, p.currentPrice, 'manual');
        }
        return `Closed ${positions.length} positions.`;
      }

      default: {
        // Treat as position ID lookup
        const pos = manager.getPosition(cmd);
        if (!pos) return `Position "${cmd}" not found. Use \`/positions list\` to see all.`;
        const pnlSign = pos.unrealizedPnL >= 0 ? '+' : '';
        let output = `**Position ${pos.id}**\n\n`;
        output += `Platform: ${pos.platform}\n`;
        output += `Market: ${pos.marketId}\n`;
        output += `Outcome: ${pos.outcomeName}\n`;
        output += `Side: ${pos.side}\n`;
        output += `Size: ${pos.size} shares\n`;
        output += `Entry: $${pos.entryPrice.toFixed(2)}\n`;
        output += `Current: $${pos.currentPrice.toFixed(2)}\n`;
        output += `PnL: ${pnlSign}$${pos.unrealizedPnL.toFixed(2)} (${pnlSign}${pos.unrealizedPnLPct.toFixed(1)}%)\n`;
        output += `Opened: ${pos.openedAt.toLocaleString()}\n`;
        if (pos.stopLoss) output += `Stop-loss: $${pos.stopLoss.toFixed(2)}\n`;
        if (pos.takeProfit) output += `Take-profit: $${pos.takeProfit.toFixed(2)}\n`;
        if (pos.trailingStop) output += `Trailing stop: ${pos.trailingStop}%\n`;
        output += `Status: ${pos.status}`;
        return output;
      }
    }
  } catch (error) {
    return `Position manager error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export default {
  name: 'positions',
  description: 'Position management with stop-loss, take-profit, and trailing stops',
  commands: ['/positions', '/pos'],
  handle: execute,
};
