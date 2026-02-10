/**
 * Copy Trading CLI Skill
 *
 * Commands:
 * /copy follow <address> - Start following a wallet
 * /copy unfollow <address> - Stop following
 * /copy list - List followed wallets
 * /copy status - Copy trading status
 * /copy trades - Recent copied trades
 * /copy close <id> - Close a copied position
 * /copy config - View/update config
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const { createCopyTradingService } = await import('../../../trading/copy-trading');
    const { createWhaleTracker } = await import('../../../feeds/polymarket/whale-tracker');

    // Create whale tracker (provides trade signals) and copy service
    const tracker = createWhaleTracker();
    const config = {
      followedAddresses: [],
      dryRun: true,
    };
    const service = createCopyTradingService(tracker, null, config);

    switch (cmd) {
      case 'follow': {
        if (!parts[1]) return 'Usage: /copy follow <address> [--size <amount>] [--delay <ms>]';
        const addr = parts[1];
        service.follow(addr);
        const sizeIdx = parts.indexOf('--size');
        const size = sizeIdx >= 0 ? parts[sizeIdx + 1] : '100';
        const delayIdx = parts.indexOf('--delay');
        const delay = delayIdx >= 0 ? parts[delayIdx + 1] : '5000';
        return `**Following Wallet**\n\nAddress: \`${addr}\`\nSize: $${size}\nDelay: ${delay}ms\nStatus: Active\nMode: Dry run (use /copy config set dryRun false to go live)`;
      }

      case 'unfollow': {
        if (!parts[1]) return 'Usage: /copy unfollow <address>';
        service.unfollow(parts[1]);
        return `Unfollowed \`${parts[1]}\`.`;
      }

      case 'list':
      case 'ls': {
        const addrs = service.getFollowedAddresses();
        if (!addrs.length) return 'No wallets being followed. Use `/copy follow <address>` to start.';
        let output = `**Followed Wallets** (${addrs.length})\n\n`;
        for (const addr of addrs) {
          output += `  \`${addr}\`\n`;
        }
        return output;
      }

      case 'status': {
        const stats = service.getStats();
        let output = '**Copy Trading Status**\n\n';
        output += `Active: ${service.isRunning() ? 'Yes' : 'No'}\n`;
        output += `Following: ${stats.followedAddresses} wallets\n`;
        output += `Total copied: ${stats.totalCopied} trades\n`;
        output += `Total skipped: ${stats.totalSkipped}\n`;
        output += `Open positions: ${stats.openPositions}\n`;
        output += `Win rate: ${stats.winRate.toFixed(1)}%\n`;
        output += `Total P&L: $${stats.totalPnl.toFixed(2)}\n`;
        output += `Avg return: ${stats.avgReturn.toFixed(2)}%\n`;
        return output;
      }

      case 'trades': {
        const limit = parseInt(parts[1] || '10');
        const trades = service.getCopiedTrades(limit);
        if (!trades.length) return 'No copied trades yet.';
        let output = `**Recent Copied Trades** (last ${trades.length})\n\n`;
        for (const t of trades) {
          output += `[${t.status}] ${t.side} $${t.size.toFixed(2)} @ ${t.entryPrice.toFixed(4)}`;
          if (t.pnl !== undefined) output += ` | P&L: $${t.pnl.toFixed(2)}`;
          output += `\n  From: \`${t.originalTrade.maker.slice(0, 10)}...\`\n`;
        }
        return output;
      }

      case 'positions':
      case 'open': {
        const positions = service.getOpenPositions();
        if (!positions.length) return 'No open copied positions.';
        let output = `**Open Copied Positions** (${positions.length})\n\n`;
        for (const p of positions) {
          output += `[${p.id}] ${p.side} $${p.size.toFixed(2)} @ ${p.entryPrice.toFixed(4)}\n`;
          output += `  Status: ${p.status}\n`;
        }
        return output;
      }

      case 'close': {
        if (!parts[1]) return 'Usage: /copy close <trade-id> or /copy close all';
        if (parts[1] === 'all') {
          await service.closeAllPositions();
          return 'All copied positions closed.';
        }
        await service.closePosition(parts[1]);
        return `Position \`${parts[1]}\` closed.`;
      }

      case 'start': {
        service.start();
        return 'Copy trading started. Monitoring followed wallets for new trades.';
      }

      case 'stop': {
        service.stop();
        return 'Copy trading stopped.';
      }

      case 'config': {
        const sub = parts[1]?.toLowerCase();
        if (sub === 'set') {
          const key = parts[2];
          const value = parts[3];
          if (!key || !value) return 'Usage: /copy config set <key> <value>';
          const updates: Record<string, unknown> = {};
          if (key === 'dryRun') updates.dryRun = value === 'true';
          else if (key === 'fixedSize') updates.fixedSize = parseFloat(value);
          else if (key === 'maxPosition') updates.maxPositionSize = parseFloat(value);
          else if (key === 'minTradeSize') updates.minTradeSize = parseFloat(value);
          else if (key === 'copyDelay') updates.copyDelayMs = parseInt(value);
          else if (key === 'stopLoss') updates.stopLoss = parseFloat(value);
          else if (key === 'takeProfit') updates.takeProfit = parseFloat(value);
          else return `Unknown config key: ${key}`;
          service.updateConfig(updates);
          return `Config updated: ${key} = ${value}`;
        }
        return `**Copy Trading Config**\n\n` +
          `Sizing: fixed ($100)\n` +
          `Max position: $500\n` +
          `Min trade size: $1,000\n` +
          `Copy delay: 5,000ms\n` +
          `Max slippage: 2%\n` +
          `Dry run: true\n\n` +
          `Use \`/copy config set <key> <value>\` to change.\n` +
          `Keys: dryRun, fixedSize, maxPosition, minTradeSize, copyDelay, stopLoss, takeProfit`;
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Copy Trading Commands**

  /copy follow <address>              - Follow a wallet
  /copy unfollow <address>            - Stop following
  /copy list                          - List followed wallets
  /copy status                        - Current stats
  /copy trades [n]                    - Recent copied trades
  /copy positions                     - Open positions
  /copy close <id|all>                - Close position(s)
  /copy start                         - Start copy trading
  /copy stop                          - Stop copy trading
  /copy config                        - View config
  /copy config set <key> <value>      - Update config`;
}

export default {
  name: 'copy-trading',
  description: 'Automatically copy trades from successful wallets on Polymarket and crypto',
  commands: ['/copy', '/copytrade'],
  handle: execute,
};
