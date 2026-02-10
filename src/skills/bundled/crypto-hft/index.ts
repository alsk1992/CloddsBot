/**
 * Crypto HFT Skill — Chat commands for 15-minute crypto market trading
 *
 * Commands:
 *   /crypto-hft start [assets] [--size N] [--dry-run] [--preset NAME]
 *   /crypto-hft stop
 *   /crypto-hft status
 *   /crypto-hft positions
 *   /crypto-hft markets
 *   /crypto-hft config --tp 15 --sl 12 --size 20
 *   /crypto-hft enable <strategy>
 *   /crypto-hft disable <strategy>
 *   /crypto-hft preset list
 *   /crypto-hft preset save <name>
 *   /crypto-hft preset load <name>
 *   /crypto-hft preset delete <name>
 *   /crypto-hft round
 */

import {
  createCryptoHftEngine,
  DEFAULT_CONFIG,
  type CryptoHftEngine,
} from '../../../strategies/crypto-hft/index.js';
import { createMarketScanner } from '../../../strategies/crypto-hft/market-scanner.js';
import { savePreset, loadPreset, deletePreset, listPresets } from '../../../strategies/crypto-hft/presets.js';
import type { CryptoFeed } from '../../../feeds/crypto/index.js';
import type { ExecutionService } from '../../../execution/index.js';
import { formatHelp } from '../../help.js';
import { wrapSkillError } from '../../errors.js';

// ── Lazy service instances ──────────────────────────────────────────────────

let feedInstance: CryptoFeed | null = null;
let execInstance: ExecutionService | null = null;
let engine: CryptoHftEngine | null = null;

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

    const apiKey = process.env.POLY_API_KEY || '';
    const apiSecret = process.env.POLY_API_SECRET || '';
    const apiPassphrase = process.env.POLY_API_PASSPHRASE || '';

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

  try {
  switch (cmd) {
    case 'start': {
      if (engine) return 'Already running. `/crypto-hft stop` first.';

      const feed = await getFeed();
      if (!feed) return 'Crypto feed not available. Check that Binance WS is reachable.';
      const exec = await getExecution();

      // Check for preset
      const presetIdx = args.indexOf('--preset');
      let presetConfig: Record<string, any> = {};
      let presetStrategies: Record<string, boolean> | null = null;

      if (presetIdx !== -1) {
        const presetName = args.slice(presetIdx + 9).trim().split(/\s+/)[0];
        const preset = loadPreset(presetName);
        if (!preset) return `Preset "${presetName}" not found. Use \`/crypto-hft preset list\`.`;
        presetConfig = preset.config;
        presetStrategies = preset.strategies;
      }

      // Parse inline flags (override preset)
      const assetArg = parts[1] && !parts[1].startsWith('-') ? parts[1] : null;
      const assets = assetArg ? assetArg.toUpperCase().split(',') : (presetConfig.assets ?? DEFAULT_CONFIG.assets);
      const dryRun = args.includes('--dry-run') || args.includes('--dry') || (presetConfig.dryRun ?? DEFAULT_CONFIG.dryRun);
      const sizeMatch = args.match(/--size\s+(\d+)/);
      const sizeUsd = sizeMatch ? parseInt(sizeMatch[1], 10) : (presetConfig.sizeUsd ?? DEFAULT_CONFIG.sizeUsd);

      engine = createCryptoHftEngine(feed, exec, {
        ...presetConfig,
        assets,
        sizeUsd,
        dryRun,
      });

      if (presetStrategies) {
        for (const [name, val] of Object.entries(presetStrategies)) {
          engine.setStrategyEnabled(name, val);
        }
      }

      await engine.start();

      const mode = dryRun ? 'DRY RUN' : 'LIVE';
      const strats = Object.entries(engine.getEnabledStrategies()).filter(([, v]) => v).map(([k]) => k);
      return [
        `**Crypto HFT Started [${mode}]**`,
        `Assets: ${assets.join(', ')}`,
        `Size: $${sizeUsd}/trade`,
        `Strategies: ${strats.join(', ')}`,
        `TP: ${engine.getConfig().takeProfitPct}% | SL: ${engine.getConfig().stopLossPct}%`,
        `Ratchet: ${engine.getConfig().ratchetEnabled ? 'ON' : 'OFF'} | Trailing: ${engine.getConfig().trailingEnabled ? 'ON' : 'OFF'}`,
        `Entry: ${engine.getConfig().entryOrder.mode} | Exit: ${engine.getConfig().exitOrder.mode}`,
      ].join('\n');
    }

    case 'stop': {
      if (!engine) return 'Not running.';
      const stats = engine.getStats();
      engine.stop();
      engine = null;
      // Clean up feed and execution service to prevent resource leaks
      if (feedInstance) {
        try { feedInstance.stop(); } catch { /* best effort */ }
        feedInstance = null;
      }
      if (execInstance) {
        try { (execInstance as any).cleanup?.(); } catch { /* best effort */ }
        execInstance = null;
      }
      return `Stopped. ${stats.totalTrades} trades, ${fmtUsd(stats.netPnlUsd)} net, ${stats.winRate.toFixed(0)}% WR, fees: $${stats.feesUsd.toFixed(2)}`;
    }

    case 'status': {
      if (!engine) return 'Not running. `/crypto-hft start`';
      const s = engine.getStats();
      const r = engine.getRoundInfo();
      const p = engine.getPositions();

      let out = `**Crypto HFT Status**\n`;
      out += `Round: #${r.slot} | ${r.ageSec.toFixed(0)}s old | ${r.timeLeftSec.toFixed(0)}s left | ${r.canTrade ? 'TRADING' : 'WAITING'}\n`;
      out += `Markets: ${engine.getMarkets().length} | Open: ${s.openPositions}\n`;
      out += `Trades: ${s.totalTrades} (${s.wins}W/${s.losses}L) ${s.winRate.toFixed(0)}% WR\n`;
      out += `Gross: ${fmtUsd(s.grossPnlUsd)} | Fees: $${s.feesUsd.toFixed(2)} | Net: ${fmtUsd(s.netPnlUsd)}\n`;
      out += `Today: ${fmtUsd(s.dailyPnlUsd)} | Best: ${fmtPct(s.bestTradePct)} | Worst: ${fmtPct(s.worstTradePct)}\n`;
      out += `Maker: entry ${s.makerEntryRate.toFixed(0)}% / exit ${s.makerExitRate.toFixed(0)}%\n`;

      if (Object.keys(s.exitReasons).length > 0) {
        out += `Exits: ${Object.entries(s.exitReasons).map(([k, v]) => `${k}(${v})`).join(', ')}\n`;
      }

      if (p.length > 0) {
        out += `\n**Open Positions:**\n`;
        for (const pos of p) {
          const pnl = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
          const secsLeft = Math.max(0, (pos.expiresAt - Date.now()) / 1000);
          out += `  ${pos.asset} ${pos.direction.toUpperCase()} @ ${pos.entryPrice.toFixed(2)} -> ${pos.currentPrice.toFixed(2)} (${fmtPct(pnl)}) [${pos.strategy}] ${secsLeft.toFixed(0)}s left\n`;
        }
      }
      return out;
    }

    case 'positions': {
      if (!engine) return 'Not running.';
      const closed = engine.getClosed().slice(-20);
      if (closed.length === 0) return 'No closed trades yet.';

      let out = `**Last ${closed.length} Trades:**\n`;
      for (const c of closed.reverse()) {
        out += `  ${c.asset} ${c.direction.toUpperCase()} ${fmtPct(c.netPnlPct)} (${fmtUsd(c.netPnlUsd)}) [${c.strategy}] ${c.exitReason} ${c.holdTimeSec.toFixed(0)}s ${c.wasMakerEntry ? 'M' : 'T'}->${c.wasMakerExit ? 'M' : 'T'}\n`;
      }
      return out;
    }

    case 'markets': {
      const assets = parts[1] ? parts[1].toUpperCase().split(',') : DEFAULT_CONFIG.assets;
      const scanner = createMarketScanner({ ...DEFAULT_CONFIG, assets });
      const markets = await scanner.refresh();
      if (markets.length === 0) return 'No active 15-min crypto markets.';

      let out = `**Active Markets (${markets.length}):**\n`;
      for (const m of markets) {
        const secsLeft = ((m.expiresAt - Date.now()) / 1000).toFixed(0);
        out += `  ${m.asset}: UP ${m.upPrice.toFixed(2)} / DOWN ${m.downPrice.toFixed(2)} -- ${secsLeft}s left -- round #${m.roundSlot}\n`;
      }
      return out;
    }

    case 'round': {
      if (!engine) return 'Not running.';
      const r = engine.getRoundInfo();
      return `Round #${r.slot} | Age: ${r.ageSec.toFixed(0)}s | Left: ${r.timeLeftSec.toFixed(0)}s | ${r.canTrade ? 'CAN TRADE' : 'WAITING'}`;
    }

    case 'config': {
      if (!engine) return 'Not running.';

      const updates: Record<string, any> = {};
      const pairs: Array<[RegExp, string, (v: string) => any]> = [
        [/--tp\s+(\d+)/, 'takeProfitPct', Number],
        [/--sl\s+(\d+)/, 'stopLossPct', Number],
        [/--size\s+(\d+)/, 'sizeUsd', Number],
        [/--max-pos\s+(\d+)/, 'maxPositions', Number],
        [/--max-loss\s+(\d+)/, 'maxDailyLossUsd', Number],
        [/--ratchet\s+(on|off)/, 'ratchetEnabled', (v: string) => v === 'on'],
        [/--trailing\s+(on|off)/, 'trailingEnabled', (v: string) => v === 'on'],
      ];

      for (const [re, key, transform] of pairs) {
        const m = args.match(re);
        if (m) updates[key] = transform(m[1]);
      }

      if (Object.keys(updates).length === 0) {
        const c = engine.getConfig();
        return [
          '**Current Config:**',
          `Size: $${c.sizeUsd} | Max Pos: ${c.maxPositions} | Max Loss: $${c.maxDailyLossUsd}`,
          `TP: ${c.takeProfitPct}% | SL: ${c.stopLossPct}%`,
          `Ratchet: ${c.ratchetEnabled ? 'ON' : 'OFF'} | Trailing: ${c.trailingEnabled ? 'ON' : 'OFF'}`,
          `Entry: ${c.entryOrder.mode} | Exit: ${c.exitOrder.mode}`,
          `Min time left: ${c.minTimeLeftSec}s | Force exit: ${c.forceExitSec}s`,
          '',
          'Set: `/crypto-hft config --tp 15 --sl 12 --ratchet on`',
        ].join('\n');
      }

      engine.updateConfig(updates);
      return `Updated: ${Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(', ')}`;
    }

    case 'enable': {
      if (!engine) return 'Not running.';
      const s = parts[1];
      if (!s) return 'Usage: `/crypto-hft enable momentum`';
      engine.setStrategyEnabled(s, true);
      return `Enabled: ${s}`;
    }

    case 'disable': {
      if (!engine) return 'Not running.';
      const s = parts[1];
      if (!s) return 'Usage: `/crypto-hft disable expiry_fade`';
      engine.setStrategyEnabled(s, false);
      return `Disabled: ${s}`;
    }

    case 'preset': {
      const sub = parts[1]?.toLowerCase() || 'list';

      if (sub === 'list') {
        const presets = listPresets();
        if (presets.length === 0) return 'No presets.';
        let out = '**Presets:**\n';
        for (const p of presets) {
          const strats = Object.entries(p.strategies).filter(([, v]) => v).map(([k]) => k);
          out += `  **${p.name}** -- ${p.description || 'No description'}\n    Strategies: ${strats.join(', ')}\n`;
        }
        return out;
      }

      if (sub === 'save') {
        if (!engine) return 'Not running.';
        const name = parts[2];
        if (!name) return 'Usage: `/crypto-hft preset save my_preset`';
        const cfg = engine.getConfig();
        const strats = engine.getEnabledStrategies();
        savePreset(name, cfg, strats);
        return `Saved preset: ${name}`;
      }

      if (sub === 'load') {
        const name = parts[2];
        if (!name) return 'Usage: `/crypto-hft preset load scalper`';
        const preset = loadPreset(name);
        if (!preset) return `Preset "${name}" not found.`;

        if (engine) {
          engine.updateConfig(preset.config);
          for (const [k, v] of Object.entries(preset.strategies)) {
            engine.setStrategyEnabled(k, v);
          }
          return `Loaded preset "${name}" into running engine.`;
        }
        return `Preset "${name}" found. Use \`/crypto-hft start --preset ${name}\` to start with it.`;
      }

      if (sub === 'delete') {
        const name = parts[2];
        if (!name) return 'Usage: `/crypto-hft preset delete my_preset`';
        if (deletePreset(name)) return `Deleted: ${name}`;
        return `Preset "${name}" not found (built-in presets can't be deleted).`;
      }

      return 'Usage: `/crypto-hft preset [list|save|load|delete] [name]`';
    }

    default:
      return formatHelp({
        name: 'Crypto HFT',
        emoji: '\u26A1',
        description: 'Trade 15-minute crypto binary markets on Polymarket with 4 automated strategies.',
        sections: [
          {
            title: 'Start/Stop',
            commands: [
              { cmd: '/crypto-hft start [BTC,ETH] [--size 20] [--dry-run] [--preset scalper]', description: 'Start the HFT engine' },
              { cmd: '/crypto-hft stop', description: 'Stop engine and show summary' },
            ],
          },
          {
            title: 'Monitor',
            commands: [
              { cmd: '/crypto-hft status', description: 'Stats, open positions, round info' },
              { cmd: '/crypto-hft positions', description: 'Recent closed trades' },
              { cmd: '/crypto-hft markets', description: 'Active 15-min markets' },
              { cmd: '/crypto-hft round', description: 'Current round timing' },
            ],
          },
          {
            title: 'Configure',
            commands: [
              { cmd: '/crypto-hft config [--tp N] [--sl N] [--ratchet on/off]', description: 'View or update config' },
              { cmd: '/crypto-hft enable <strategy>', description: 'Enable a strategy' },
              { cmd: '/crypto-hft disable <strategy>', description: 'Disable a strategy' },
            ],
          },
          {
            title: 'Presets',
            commands: [
              { cmd: '/crypto-hft preset list', description: 'Show all presets' },
              { cmd: '/crypto-hft preset save <name>', description: 'Save current config as preset' },
              { cmd: '/crypto-hft preset load <name>', description: 'Load a preset' },
              { cmd: '/crypto-hft preset delete <name>', description: 'Delete a preset' },
            ],
          },
        ],
        envVars: [
          { name: 'POLY_PRIVATE_KEY', description: 'Polymarket wallet private key (or PRIVATE_KEY)', required: true },
          { name: 'POLY_API_KEY', description: 'Polymarket CLOB API key', required: true },
          { name: 'POLY_API_SECRET', description: 'Polymarket CLOB API secret', required: true },
          { name: 'POLY_API_PASSPHRASE', description: 'Polymarket CLOB API passphrase', required: true },
          { name: 'POLY_FUNDER_ADDRESS', description: 'Polymarket funder wallet address', required: true },
          { name: 'DRY_RUN', description: 'Set to "true" for paper trading' },
        ],
        seeAlso: [
          { cmd: '/hl', description: 'Hyperliquid perps trading' },
          { cmd: '/copy', description: 'Copy trading' },
          { cmd: '/execution', description: 'Execution service controls' },
          { cmd: '/strategy', description: 'Strategy management' },
        ],
        notes: [
          'Shortcut: `/hft` is an alias for `/crypto-hft`.',
          'Strategies: momentum, mean_reversion, penny_clipper, expiry_fade.',
          'Built-in presets: conservative, aggressive, scalper, momentum_only.',
        ],
      });
  }
  } catch (error) {
    return wrapSkillError('Crypto HFT', cmd || 'command', error);
  }
}

// ── Skill Registration ──────────────────────────────────────────────────────

export default {
  name: 'crypto-hft',
  description: 'Trade 15-minute crypto binary markets on Polymarket with 4 automated strategies',
  commands: ['/crypto-hft', '/hft'],
  handle: execute,
};
