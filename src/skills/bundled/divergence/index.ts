/**
 * Divergence Skill — Chat commands for spot vs poly divergence trading
 *
 * Commands:
 *   /div start [assets] [--size N] [--dry-run]
 *   /div stop
 *   /div status
 *   /div positions
 *   /div markets
 *   /div config [--tp N] [--sl N] [--size N] [--windows 5,10,30]
 */

import type { CryptoFeed } from '../../../feeds/crypto/index.js';
import type { ExecutionService } from '../../../execution/index.js';
import type { HftDivergenceEngine } from '../../../strategies/hft-divergence/strategy.js';

// ── Lazy service instances ──────────────────────────────────────────────────

let feedInstance: CryptoFeed | null = null;
let execInstance: ExecutionService | null = null;
let engine: HftDivergenceEngine | null = null;

async function getFeed(): Promise<CryptoFeed | null> {
  if (feedInstance) return feedInstance;
  try {
    const { createCryptoFeed } = await import('../../../feeds/crypto/index.js');
    feedInstance = createCryptoFeed();
    feedInstance.start();
    return feedInstance;
  } catch {
    return null;
  }
}

async function getExecution(): Promise<ExecutionService | null> {
  if (execInstance) return execInstance;
  try {
    const privateKey = process.env.POLY_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!privateKey) return null;

    const apiKey = process.env.POLY_API_KEY ?? '';
    const apiSecret = process.env.POLY_API_SECRET ?? '';
    const apiPassphrase = process.env.POLY_API_PASSPHRASE ?? '';

    const { createExecutionService } = await import('../../../execution/index.js');
    execInstance = createExecutionService({
      polymarket: {
        privateKey,
        address: process.env.POLY_FUNDER_ADDRESS ?? '',
        funderAddress: process.env.POLY_FUNDER_ADDRESS,
        apiKey,
        apiSecret,
        apiPassphrase,
      },
      dryRun: process.env.DRY_RUN === 'true',
    });
    return execInstance;
  } catch {
    return null;
  }
}

// ── Formatters ──────────────────────────────────────────────────────────────

function fmtUsd(n: number): string { return (n >= 0 ? '+' : '') + '$' + Math.abs(n).toFixed(2); }
function fmtPct(n: number): string { return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; }

// ── Command Handler ─────────────────────────────────────────────────────────

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  switch (cmd) {
    case 'start': {
      if (engine) return 'Already running. `/div stop` first.';

      const feed = await getFeed();
      if (!feed) return 'Crypto feed not available. Check that Binance WS is reachable.';
      const exec = await getExecution();

      const assetArg = parts[1] && !parts[1].startsWith('-') ? parts[1] : null;
      const assets = assetArg ? assetArg.toUpperCase().split(',') : ['BTC', 'ETH', 'SOL', 'XRP'];
      const dryRun = args.includes('--dry-run') || args.includes('--dry') || !exec;
      const sizeMatch = args.match(/--size\s+(\d+)/);
      const defaultSizeUsd = sizeMatch ? parseInt(sizeMatch[1], 10) : 20;

      const { createHftDivergenceEngine } = await import('../../../strategies/hft-divergence/strategy.js');
      engine = createHftDivergenceEngine(feed, exec, { assets, defaultSizeUsd, dryRun });
      await engine.start();

      const mode = dryRun ? 'DRY RUN' : 'LIVE';
      const cfg = engine.getConfig();
      return [
        `**Divergence Trading Started [${mode}]**`,
        `Assets: ${assets.join(', ')}`,
        `Size: $${defaultSizeUsd}/trade | Windows: ${cfg.windows.join(', ')}s`,
        `TP: ${cfg.takeProfitPct}% | SL: ${cfg.stopLossPct}% | Trailing: ${cfg.trailingStopPct}% (at +${cfg.trailingActivationPct}%)`,
        `Min spot move: ${cfg.minSpotMovePct}% | Max poly stale: ${cfg.maxPolyFreshnessSec}s`,
      ].join('\n');
    }

    case 'stop': {
      if (!engine) return 'Not running.';
      const stats = engine.getStats();
      engine.stop();
      engine = null;
      return `Stopped. ${stats.totalTrades} trades, ${fmtUsd(stats.netPnlUsd)} net, ${stats.winRate.toFixed(0)}% WR`;
    }

    case 'status': {
      if (!engine) return 'Not running. `/div start`';
      const s = engine.getStats();
      const r = engine.getRoundInfo();
      const p = engine.getPositions();

      let out = `**Divergence Status**\n`;
      out += `Round: #${r.slot} | ${r.timeLeftSec.toFixed(0)}s left\n`;
      out += `Markets: ${engine.getMarkets().length} | Open: ${s.openPositions}\n`;
      out += `Trades: ${s.totalTrades} (${s.wins}W/${s.losses}L) ${s.winRate.toFixed(0)}% WR\n`;
      out += `PnL: ${fmtUsd(s.netPnlUsd)} | Today: ${fmtUsd(s.dailyPnlUsd)}\n`;
      out += `Best: ${fmtPct(s.bestTradePct)} | Worst: ${fmtPct(s.worstTradePct)}\n`;

      if (Object.keys(s.signalCounts).length > 0) {
        const top = Object.entries(s.signalCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
        out += `Top tags: ${top.map(([k, v]) => `${k}(${v})`).join(', ')}\n`;
      }

      if (p.length > 0) {
        out += `\n**Open Positions:**\n`;
        for (const pos of p) {
          const pnl = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
          const secsLeft = Math.max(0, (pos.expiresAt - Date.now()) / 1000);
          out += `  ${pos.asset} ${pos.direction.toUpperCase()} @ ${pos.entryPrice.toFixed(2)} -> ${pos.currentPrice.toFixed(2)} (${fmtPct(pnl)}) [${pos.strategyTag}] ${secsLeft.toFixed(0)}s left\n`;
        }
      }
      return out;
    }

    case 'positions': {
      if (!engine) return 'Not running.';
      const closed = engine.getClosed().slice(-20);
      if (closed.length === 0) return 'No closed trades yet.';

      let out = `**Last ${closed.length} Trades:**\n`;
      for (const c of [...closed].reverse()) {
        out += `  ${c.asset} ${c.direction.toUpperCase()} ${fmtPct(c.pnlPct)} (${fmtUsd(c.pnlUsd)}) [${c.strategyTag}] ${c.exitReason} ${c.holdTimeSec.toFixed(0)}s\n`;
      }
      return out;
    }

    case 'markets': {
      if (!engine) {
        // Allow market check without running engine
        const { createMarketRotator } = await import('../../../strategies/hft-divergence/market-rotator.js');
        const defaultCfg = {
          assets: parts[1] ? parts[1].toUpperCase().split(',') : ['BTC', 'ETH', 'SOL', 'XRP'],
          marketDurationSec: 900,
          windows: [], thresholdBuckets: [], minSpotMovePct: 0.08,
          maxPolyFreshnessSec: 5, maxPolyMidForEntry: 0.85,
          defaultSizeUsd: 20, maxPositionSizeUsd: 100, maxConcurrentPositions: 3,
          preferMaker: true, makerTimeoutMs: 15000, takerBufferCents: 0.01, negRisk: true,
          takeProfitPct: 15, stopLossPct: 25, trailingStopPct: 8, trailingActivationPct: 10,
          forceExitSec: 30, timeExitSec: 120, maxDailyLossUsd: 200,
          cooldownAfterLossSec: 30, cooldownAfterExitSec: 15, dryRun: true,
        };
        const rotator = createMarketRotator(() => defaultCfg);
        const markets = await rotator.refresh();
        if (markets.length === 0) return 'No active 15-min crypto markets.';
        let out = `**Active Markets (${markets.length}):**\n`;
        for (const m of markets) {
          const secsLeft = ((m.expiresAt - Date.now()) / 1000).toFixed(0);
          out += `  ${m.asset}: UP ${m.upPrice.toFixed(2)} / DOWN ${m.downPrice.toFixed(2)} -- ${secsLeft}s left\n`;
        }
        return out;
      }

      const markets = engine.getMarkets();
      if (markets.length === 0) return 'No active markets.';
      let out = `**Active Markets (${markets.length}):**\n`;
      for (const m of markets) {
        const secsLeft = ((m.expiresAt - Date.now()) / 1000).toFixed(0);
        out += `  ${m.asset}: UP ${m.upPrice.toFixed(2)} / DOWN ${m.downPrice.toFixed(2)} -- ${secsLeft}s left\n`;
      }
      return out;
    }

    case 'config': {
      if (!engine) return 'Not running.';

      const updates: Record<string, any> = {};
      const pairs: Array<[RegExp, string, (v: string) => any]> = [
        [/--tp\s+(\d+)/, 'takeProfitPct', Number],
        [/--sl\s+(\d+)/, 'stopLossPct', Number],
        [/--size\s+(\d+)/, 'defaultSizeUsd', Number],
        [/--max-pos\s+(\d+)/, 'maxConcurrentPositions', Number],
        [/--max-loss\s+(\d+)/, 'maxDailyLossUsd', Number],
        [/--trailing\s+(\d+)/, 'trailingStopPct', Number],
      ];

      // Special: --windows 5,10,30
      const winMatch = args.match(/--windows\s+([\d,]+)/);
      if (winMatch) {
        updates.windows = winMatch[1].split(',').map(Number).filter((n) => n > 0);
      }

      for (const [re, key, transform] of pairs) {
        const m = args.match(re);
        if (m) updates[key] = transform(m[1]);
      }

      if (Object.keys(updates).length === 0) {
        const c = engine.getConfig();
        return [
          '**Current Config:**',
          `Size: $${c.defaultSizeUsd} | Max Pos: ${c.maxConcurrentPositions} | Max Loss: $${c.maxDailyLossUsd}`,
          `TP: ${c.takeProfitPct}% | SL: ${c.stopLossPct}%`,
          `Trailing: ${c.trailingStopPct}% (activates at +${c.trailingActivationPct}%)`,
          `Windows: ${c.windows.join(', ')}s`,
          `Min spot move: ${c.minSpotMovePct}% | Max poly stale: ${c.maxPolyFreshnessSec}s`,
          '',
          'Set: `/div config --tp 20 --sl 30 --windows 5,10,30`',
        ].join('\n');
      }

      engine.updateConfig(updates);
      return `Updated: ${Object.entries(updates).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`).join(', ')}`;
    }

    default:
      return [
        '**Divergence Trading -- Spot vs Poly Price Lag**',
        '',
        '**Start/Stop:**',
        '  `/div start [BTC,ETH] [--size 20] [--dry-run]`',
        '  `/div stop`',
        '',
        '**Monitor:**',
        '  `/div status` -- Stats, open positions, signal counts',
        '  `/div positions` -- Recent closed trades with strategy tags',
        '  `/div markets` -- Active 15-min markets',
        '',
        '**Configure:**',
        '  `/div config [--tp N] [--sl N] [--size N] [--windows 5,10,30]`',
        '',
        '**Strategy tags:** `BTC_DOWN_s12-14_w15` = 0.12-0.14% spot drop over 15s window',
      ].join('\n');
  }
}

// ── Skill Registration ──────────────────────────────────────────────────────

export default {
  name: 'divergence',
  description: 'Spot vs Polymarket divergence trading on 15-minute crypto markets',
  commands: ['/divergence', '/div'],
  handle: execute,
};
