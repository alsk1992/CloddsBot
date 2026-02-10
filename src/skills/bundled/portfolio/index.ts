/**
 * Portfolio CLI Skill
 *
 * Commands:
 * /portfolio - Show portfolio summary
 * /portfolio positions - Active positions
 * /portfolio pnl - P&L breakdown
 * /portfolio sync - Sync from exchanges
 * /portfolio risk - Risk metrics (concentration, correlation)
 * /portfolio exposure - Category exposure breakdown
 * /portfolio history - Portfolio value history
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'summary';

  try {
    const mod = await import('../../../portfolio/index');
    const { createPortfolioService } = mod;

    // Build config from environment variables
    const config: Record<string, unknown> = {};
    if (process.env.POLY_API_KEY && process.env.POLY_API_SECRET && process.env.POLY_API_PASSPHRASE) {
      config.polymarket = {
        key: process.env.POLY_API_KEY,
        secret: process.env.POLY_API_SECRET,
        passphrase: process.env.POLY_API_PASSPHRASE,
      };
    }
    if (process.env.KALSHI_API_KEY && process.env.KALSHI_PRIVATE_KEY) {
      config.kalshi = {
        apiKey: process.env.KALSHI_API_KEY,
        privateKey: process.env.KALSHI_PRIVATE_KEY,
      };
    }
    if (process.env.HL_WALLET_ADDRESS && process.env.HL_PRIVATE_KEY) {
      config.hyperliquid = {
        walletAddress: process.env.HL_WALLET_ADDRESS,
        privateKey: process.env.HL_PRIVATE_KEY,
      };
    }
    if (process.env.BINANCE_FUTURES_KEY && process.env.BINANCE_FUTURES_SECRET) {
      config.binance = {
        apiKey: process.env.BINANCE_FUTURES_KEY,
        apiSecret: process.env.BINANCE_FUTURES_SECRET,
      };
    }
    if (process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET) {
      config.bybit = {
        apiKey: process.env.BYBIT_API_KEY,
        apiSecret: process.env.BYBIT_API_SECRET,
      };
    }
    if (process.env.MEXC_API_KEY && process.env.MEXC_API_SECRET) {
      config.mexc = {
        apiKey: process.env.MEXC_API_KEY,
        apiSecret: process.env.MEXC_API_SECRET,
      };
    }

    const hasAnyPlatform =
      config.polymarket || config.kalshi || config.hyperliquid ||
      config.binance || config.bybit || config.mexc;
    if (!hasAnyPlatform && cmd !== 'help' && cmd !== 'history') {
      return '**Portfolio**\n\nNo platform credentials configured.\n\n' +
        'Set environment variables to connect:\n' +
        '- Polymarket: `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_API_PASSPHRASE`\n' +
        '- Kalshi: `KALSHI_API_KEY`, `KALSHI_PRIVATE_KEY`\n' +
        '- Hyperliquid: `HL_WALLET_ADDRESS`, `HL_PRIVATE_KEY`\n' +
        '- Binance Futures: `BINANCE_FUTURES_KEY`, `BINANCE_FUTURES_SECRET`\n' +
        '- Bybit: `BYBIT_API_KEY`, `BYBIT_API_SECRET`\n' +
        '- MEXC: `MEXC_API_KEY`, `MEXC_API_SECRET`\n\n' +
        'Or use `/creds set <platform> <key> <value>` to store credentials.';
    }

    const service = createPortfolioService(config as any);

    switch (cmd) {
      case 'summary':
      case '': {
        const summary = await service.getSummary();
        const pnlSign = summary.unrealizedPnL >= 0 ? '+' : '';

        let text = `**Portfolio Summary**\n\n`;
        text += `**Total Value:** $${summary.totalValue.toFixed(2)}\n`;
        text += `**Positions:** ${summary.positionsCount}\n`;
        text += `**Unrealized P&L:** ${pnlSign}$${summary.unrealizedPnL.toFixed(2)} (${pnlSign}${summary.unrealizedPnLPct.toFixed(1)}%)\n`;
        text += `**Realized P&L:** $${summary.realizedPnL.toFixed(2)}\n\n`;

        text += `**Balances:**\n`;
        for (const bal of summary.balances) {
          let balLine = `  ${bal.platform}: $${bal.total.toFixed(2)}`;
          if (bal.locked > 0) {
            balLine += ` ($${bal.available.toFixed(2)} avail, $${bal.locked.toFixed(2)} locked)`;
          }
          text += balLine + '\n';
        }

        text += `\n_Updated: ${summary.lastUpdated.toLocaleTimeString()}_`;
        return text;
      }

      case 'positions':
      case 'pos': {
        await service.refresh();
        const summary = await service.getSummary();
        const positions = summary.positions;

        if (positions.length === 0) {
          return 'No open positions';
        }

        let text = `**Open Positions** (${positions.length})\n\n`;

        for (const pos of positions) {
          const pnlSign = pos.unrealizedPnL >= 0 ? '+' : '';
          const question = pos.marketQuestion
            ? pos.marketQuestion.slice(0, 40) + (pos.marketQuestion.length > 40 ? '...' : '')
            : pos.marketId.slice(0, 20);

          text += `**${question}** [${pos.platform}]\n`;

          if (pos.side) {
            // Futures position
            const leverageStr = pos.leverage ? ` ${pos.leverage}x` : '';
            const liqStr = pos.liquidationPrice ? ` | liq $${pos.liquidationPrice.toFixed(2)}` : '';
            text += `  ${pos.side.toUpperCase()}${leverageStr}: ${pos.shares.toFixed(4)} @ $${pos.currentPrice.toFixed(2)}\n`;
            text += `  ${pnlSign}$${pos.unrealizedPnL.toFixed(2)} (${pnlSign}${pos.unrealizedPnLPct.toFixed(1)}%)${liqStr}\n\n`;
          } else {
            // Prediction market position
            text += `  ${pos.outcome}: ${pos.shares.toFixed(2)} @ $${pos.currentPrice.toFixed(3)}\n`;
            text += `  ${pnlSign}$${pos.unrealizedPnL.toFixed(2)} (${pnlSign}${pos.unrealizedPnLPct.toFixed(1)}%)\n\n`;
          }
        }

        return text;
      }

      case 'pnl': {
        const summary = await service.getSummary();
        const pnlSign = (v: number) => v >= 0 ? '+' : '';

        let output = '**P&L Breakdown**\n\n';
        output += `Unrealized P&L: ${pnlSign(summary.unrealizedPnL)}$${summary.unrealizedPnL.toFixed(2)} (${pnlSign(summary.unrealizedPnLPct)}${summary.unrealizedPnLPct.toFixed(1)}%)\n`;
        output += `Realized P&L: ${pnlSign(summary.realizedPnL)}$${summary.realizedPnL.toFixed(2)}\n`;
        output += `Total Cost Basis: $${summary.totalCostBasis.toFixed(2)}\n`;
        output += `Current Value: $${summary.totalValue.toFixed(2)}\n\n`;

        if (summary.positions.length > 0) {
          output += '**By Position:**\n\n';
          const sorted = [...summary.positions].sort((a, b) => b.unrealizedPnL - a.unrealizedPnL);
          for (const pos of sorted) {
            const label = pos.marketQuestion
              ? pos.marketQuestion.slice(0, 35) + (pos.marketQuestion.length > 35 ? '...' : '')
              : pos.marketId.slice(0, 20);
            const platformTag = pos.side ? ` [${pos.platform}]` : '';
            output += `  ${pnlSign(pos.unrealizedPnL)}$${pos.unrealizedPnL.toFixed(2)} | ${label} (${pos.outcome})${platformTag}\n`;
          }
        }

        return output;
      }

      case 'sync':
      case 'refresh': {
        await service.refresh();
        const summary = await service.getSummary();
        return `**Portfolio Synced**\n\n` +
          `Positions: ${summary.positionsCount}\n` +
          `Total Value: $${summary.totalValue.toFixed(2)}\n` +
          `Balances: ${summary.balances.map(b => `${b.platform}: $${b.available.toFixed(2)}`).join(', ')}\n` +
          `Updated: ${summary.lastUpdated.toLocaleTimeString()}`;
      }

      case 'risk': {
        const risk = await service.getPortfolioRiskMetrics();
        const conc = risk.concentrationRisk;

        let output = '**Portfolio Risk**\n\n';
        output += `Risk Level: **${conc.riskLevel.toUpperCase()}**\n`;
        output += `Concentration (HHI): ${conc.hhi}\n`;
        output += `Largest Position: ${conc.largestPositionPct.toFixed(1)}%\n`;
        output += `Top 3 Positions: ${conc.top3Pct.toFixed(1)}%\n`;
        output += `Diversification Score: ${conc.diversificationScore}/100\n`;
        output += `Portfolio Correlation: ${risk.correlationMatrix.portfolioCorrelation.toFixed(2)}\n\n`;

        if (risk.correlationMatrix.highCorrelationPairs.length > 0) {
          output += '**High Correlations:**\n';
          for (const pair of risk.correlationMatrix.highCorrelationPairs) {
            output += `  ${pair.positionA.slice(0, 15)} <-> ${pair.positionB.slice(0, 15)}: ${pair.correlation.toFixed(2)} (${pair.reason})\n`;
          }
          output += '\n';
        }

        if (risk.hedgedPositions.length > 0) {
          output += '**Hedged Pairs:**\n';
          for (const hedge of risk.hedgedPositions) {
            output += `  ${hedge.longPosition.slice(0, 15)} / ${hedge.shortPosition.slice(0, 15)} (ratio: ${hedge.hedgeRatio.toFixed(2)})\n`;
          }
          output += '\n';
        }

        output += '**Platform Exposure:**\n';
        for (const p of risk.platformExposure) {
          output += `  ${p.platform}: ${p.positionCount} positions, $${p.totalValue.toFixed(2)} (${p.valuePercent.toFixed(1)}%)\n`;
        }

        return output;
      }

      case 'exposure': {
        const exposure = await service.getCategoryExposure();
        if (exposure.length === 0) {
          return '**Category Exposure**\n\nNo positions to analyze.';
        }

        let output = '**Category Exposure**\n\n';
        output += '| Category | Positions | Value | % |\n|----------|-----------|-------|---|\n';
        for (const cat of exposure) {
          output += `| ${cat.category} | ${cat.positionCount} | $${cat.totalValue.toFixed(2)} | ${cat.valuePercent.toFixed(1)}% |\n`;
        }
        return output;
      }

      case 'value': {
        const totalValue = await service.getTotalValue();
        return `**Total Portfolio Value:** $${totalValue.toFixed(2)}`;
      }

      case 'platform': {
        const platform = parts[1]?.toLowerCase();
        if (!platform) {
          return 'Usage: /portfolio platform <name>\n\nSupported: polymarket, kalshi, hyperliquid, binance, bybit, mexc';
        }
        const positions = await service.getPositionsByPlatform(platform);
        if (positions.length === 0) {
          return `**${platform} Positions**\n\nNo positions on ${platform}.`;
        }
        let output = `**${platform} Positions** (${positions.length})\n\n`;
        for (const pos of positions) {
          const label = pos.marketQuestion
            ? pos.marketQuestion.slice(0, 40) + (pos.marketQuestion.length > 40 ? '...' : '')
            : pos.marketId.slice(0, 20);
          const pnlSign = pos.unrealizedPnL >= 0 ? '+' : '';
          output += `**${label}**\n`;
          if (pos.side) {
            const leverageStr = pos.leverage ? ` ${pos.leverage}x` : '';
            output += `  ${pos.side.toUpperCase()}${leverageStr}: ${pos.shares.toFixed(4)} @ $${pos.currentPrice.toFixed(2)}\n`;
          } else {
            output += `  ${pos.outcome}: ${pos.shares.toFixed(2)} @ $${pos.currentPrice.toFixed(3)}\n`;
          }
          output += `  ${pnlSign}$${pos.unrealizedPnL.toFixed(2)} (${pnlSign}${pos.unrealizedPnLPct.toFixed(1)}%)\n\n`;
        }
        return output;
      }

      case 'history':
      case 'hist': {
        const timeframeArg = parts[1]?.toLowerCase() || '7d';
        const tfMatch = timeframeArg.match(/^(\d+)([dhw])$/);
        let sinceDays = 7;
        if (tfMatch) {
          const num = parseInt(tfMatch[1], 10);
          const unit = tfMatch[2];
          if (unit === 'h') sinceDays = num / 24;
          else if (unit === 'w') sinceDays = num * 7;
          else sinceDays = num;
        }
        const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

        try {
          const dbMod: any = await import('../../../db/index');
          const db = dbMod.getDatabase ? dbMod.getDatabase() : dbMod.createDatabase();
          if (!db) {
            return '**Portfolio History**\n\nDatabase not available. Snapshots are taken during cron sync.';
          }

          // Try to find the user — use first user since this is a CLI skill
          const users = (db as any).listUsers();
          if (users.length === 0) {
            return '**Portfolio History**\n\nNo user account found. Snapshots are created during scheduled portfolio syncs.';
          }
          const userId = users[0].id;

          const snapshots: Array<{
            totalValue: number;
            totalPnl: number;
            totalPnlPct: number;
            totalCostBasis: number;
            positionsCount: number;
            createdAt: Date;
          }> = (db as any).getPortfolioSnapshots(userId, {
            sinceMs,
            order: 'asc',
            limit: 200,
          });

          if (snapshots.length === 0) {
            return '**Portfolio History**\n\n' +
              'No snapshots yet. Snapshots are taken automatically during hourly portfolio sync.\n\n' +
              'Run `/portfolio sync` to trigger a sync now.';
          }

          const first = snapshots[0];
          const last = snapshots[snapshots.length - 1];
          const valueChange = last.totalValue - first.totalValue;
          const valueChangePct = first.totalValue > 0 ? (valueChange / first.totalValue) * 100 : 0;
          const sign = (v: number) => v >= 0 ? '+' : '';

          const peak = Math.max(...snapshots.map((s: { totalValue: number }) => s.totalValue));
          const low = Math.min(...snapshots.map((s: { totalValue: number }) => s.totalValue));

          let output = `**Portfolio History** (${timeframeArg})\n\n`;
          output += `Start: $${first.totalValue.toFixed(2)} | End: $${last.totalValue.toFixed(2)}\n`;
          output += `Change: ${sign(valueChange)}$${valueChange.toFixed(2)} (${sign(valueChangePct)}${valueChangePct.toFixed(1)}%)\n`;
          output += `Peak: $${peak.toFixed(2)} | Low: $${low.toFixed(2)}\n\n`;

          // ASCII sparkline
          if (snapshots.length >= 2) {
            const sparkChars = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];
            const values = snapshots.map((s: { totalValue: number }) => s.totalValue);
            const min = Math.min(...values);
            const max = Math.max(...values);
            const range = max - min || 1;
            const sparkline = values
              .map((v: number) => {
                const idx = Math.min(Math.floor(((v - min) / range) * (sparkChars.length - 1)), sparkChars.length - 1);
                return sparkChars[idx];
              })
              .join('');
            output += `${sparkline}\n\n`;
          }

          // Table of last 10 data points
          const tail = snapshots.slice(-10);
          output += '| Date | Value | P&L | Positions |\n|------|-------|-----|----------|\n';
          for (const snap of tail) {
            const date = new Date(snap.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const pnlStr = `${sign(snap.totalPnl)}$${snap.totalPnl.toFixed(2)}`;
            output += `| ${date} | $${snap.totalValue.toFixed(2)} | ${pnlStr} | ${snap.positionsCount} |\n`;
          }

          return output;
        } catch {
          return '**Portfolio History**\n\nCould not load snapshots. Ensure the database is configured.';
        }
      }

      default:
        return helpText();
    }
  } catch {
    return helpText();
  }
}

function helpText(): string {
  return `**Portfolio Commands**

  /portfolio                         - Summary
  /portfolio positions               - Active positions
  /portfolio pnl                     - P&L breakdown
  /portfolio sync                    - Sync from exchanges
  /portfolio risk                    - Risk metrics
  /portfolio exposure                - Category exposure
  /portfolio value                   - Total portfolio value
  /portfolio platform <name>         - Positions by platform
  /portfolio history [7d|30d|90d]    - Portfolio value history`;
}

export default {
  name: 'portfolio',
  description: 'Track your positions and P&L across prediction markets and futures exchanges',
  commands: ['/portfolio', '/pf'],
  handle: execute,
};
