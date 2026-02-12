/**
 * Presets — Save/load named strategy configurations
 *
 * Persisted to ~/.clodds/crypto-hft-presets.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../../utils/logger.js';
import type { CryptoHftConfig, StrategyPreset } from './types.js';

const PRESETS_DIR = join(homedir(), '.clodds');
const PRESETS_FILE = join(PRESETS_DIR, 'crypto-hft-presets.json');

function ensureDir() {
  if (!existsSync(PRESETS_DIR)) {
    mkdirSync(PRESETS_DIR, { recursive: true });
  }
}

function loadAll(): Record<string, StrategyPreset> {
  try {
    if (!existsSync(PRESETS_FILE)) return {};
    const raw = readFileSync(PRESETS_FILE, 'utf-8');
    return JSON.parse(raw) as Record<string, StrategyPreset>;
  } catch (err) {
    logger.warn({ err }, 'Failed to load presets file');
    return {};
  }
}

function saveAll(presets: Record<string, StrategyPreset>) {
  ensureDir();
  writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2));
}

// ── Public API ──────────────────────────────────────────────────────────────

export function savePreset(
  name: string,
  config: Partial<CryptoHftConfig>,
  strategies: Record<string, boolean>,
  description = ''
): StrategyPreset {
  const presets = loadAll();
  const preset: StrategyPreset = {
    name,
    description,
    config,
    strategies,
    createdAt: Date.now(),
  };
  presets[name] = preset;
  saveAll(presets);
  logger.info({ name }, 'Preset saved');
  return preset;
}

export function loadPreset(name: string): StrategyPreset | null {
  const presets = loadAll();
  // Check built-ins first
  const builtIn = BUILT_IN_PRESETS[name];
  if (builtIn) return builtIn;
  return presets[name] ?? null;
}

export function deletePreset(name: string): boolean {
  const presets = loadAll();
  if (!(name in presets)) return false;
  delete presets[name];
  saveAll(presets);
  return true;
}

export function listPresets(): StrategyPreset[] {
  const saved = loadAll();
  const all = { ...BUILT_IN_PRESETS, ...saved };
  return Object.values(all).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Built-in Presets ────────────────────────────────────────────────────────

export const BUILT_IN_PRESETS: Record<string, StrategyPreset> = {
  conservative: {
    name: 'conservative',
    description: 'Low risk, maker-only, tight stops. Good starting point.',
    config: {
      sizeUsd: 10,
      maxPositions: 2,
      maxDailyLossUsd: 50,
      takeProfitPct: 10,
      stopLossPct: 8,
      dryRun: true,
      minTimeLeftSec: 180,
      stopLossCooldownSec: 60,
    },
    strategies: {
      momentum: false,
      mean_reversion: true,
      penny_clipper: true,
      expiry_fade: false,
    },
    createdAt: 0,
  },

  aggressive: {
    name: 'aggressive',
    description: 'Higher size, all strategies, wider stops.',
    config: {
      sizeUsd: 50,
      maxPositions: 4,
      maxDailyLossUsd: 200,
      takeProfitPct: 20,
      stopLossPct: 15,
      dryRun: false,
      minTimeLeftSec: 130,
      stopLossCooldownSec: 30,
    },
    strategies: {
      momentum: true,
      mean_reversion: true,
      penny_clipper: true,
      expiry_fade: true,
    },
    createdAt: 0,
  },

  scalper: {
    name: 'scalper',
    description: 'Penny clipper only. Tight range, maker entries, quick exits.',
    config: {
      sizeUsd: 20,
      maxPositions: 3,
      maxDailyLossUsd: 100,
      takeProfitPct: 5,
      stopLossPct: 5,
      dryRun: true,
      ratchetEnabled: true,
      trailingEnabled: false,
      stagnantDurationSec: 10,
      staleProfitPct: 5,
    },
    strategies: {
      momentum: false,
      mean_reversion: false,
      penny_clipper: true,
      expiry_fade: false,
    },
    createdAt: 0,
  },

  momentum_only: {
    name: 'momentum_only',
    description: 'Pure momentum. Ride spot moves, maker_then_taker entries.',
    config: {
      sizeUsd: 30,
      maxPositions: 3,
      maxDailyLossUsd: 150,
      takeProfitPct: 15,
      stopLossPct: 12,
      dryRun: true,
      ratchetEnabled: true,
      trailingEnabled: true,
    },
    strategies: {
      momentum: true,
      mean_reversion: false,
      penny_clipper: false,
      expiry_fade: false,
    },
    createdAt: 0,
  },

  '5min-btc': {
    name: '5min-btc',
    description: '5-minute BTC markets. Fast execution, aggressive exits.',
    config: {
      assets: ['BTC'],
      roundDurationSec: 300,
      minTimeLeftSec: 50,
      minRoundAgeSec: 10,
      forceExitSec: 10,
      warmupSec: 30,
      sizeUsd: 15,
      maxPositions: 1,
      maxDailyLossUsd: 100,
      takeProfitPct: 12,
      stopLossPct: 10,
      dryRun: true,
      // Faster execution for 5-min cadence
      entryOrder: {
        mode: 'maker_then_taker',
        makerTimeoutMs: 10_000,
        takerBufferCents: 0.01,
        makerExitBufferCents: 0.01,
      },
      exitOrder: {
        mode: 'maker_then_taker',
        makerTimeoutMs: 500,
        takerBufferCents: 0.01,
        makerExitBufferCents: 0.01,
      },
      sellCooldownMs: 1_000,
      maxOrderbookStaleMs: 3_000,
      ratchetEnabled: true,
      trailingEnabled: true,
      trailingLatePct: 5,
      trailingMidPct: 8,
      trailingWidePct: 12,
    },
    strategies: {
      momentum: true,
      mean_reversion: true,
      penny_clipper: true,
      expiry_fade: true,
    },
    createdAt: 0,
  },

  '5min-btc-conservative': {
    name: '5min-btc-conservative',
    description: '5-minute BTC, conservative entry/exit for testing.',
    config: {
      assets: ['BTC'],
      roundDurationSec: 300,
      minTimeLeftSec: 60,
      minRoundAgeSec: 15,
      forceExitSec: 15,
      warmupSec: 30,
      sizeUsd: 10,
      maxPositions: 1,
      maxDailyLossUsd: 50,
      takeProfitPct: 10,
      stopLossPct: 8,
      dryRun: true,
      entryOrder: {
        mode: 'maker_then_taker',
        makerTimeoutMs: 15_000,
        takerBufferCents: 0.01,
        makerExitBufferCents: 0.01,
      },
      exitOrder: {
        mode: 'maker_then_taker',
        makerTimeoutMs: 1_000,
        takerBufferCents: 0.01,
        makerExitBufferCents: 0.01,
      },
      sellCooldownMs: 2_000,
      maxOrderbookStaleMs: 5_000,
      ratchetEnabled: false,
      trailingEnabled: true,
      trailingLatePct: 3,
      trailingMidPct: 5,
      trailingWidePct: 8,
    },
    strategies: {
      momentum: false,
      mean_reversion: true,
      penny_clipper: true,
      expiry_fade: false,
    },
    createdAt: 0,
  },

  '1h-all': {
    name: '1h-all',
    description: '1-hour markets for all assets (BTC, ETH, SOL, XRP).',
    config: {
      assets: ['BTC', 'ETH', 'SOL', 'XRP'],
      roundDurationSec: 3600,
      minTimeLeftSec: 180,
      minRoundAgeSec: 60,
      forceExitSec: 60,
      warmupSec: 60,
      sizeUsd: 20,
      maxPositions: 3,
      maxDailyLossUsd: 200,
      takeProfitPct: 15,
      stopLossPct: 12,
      dryRun: true,
      sellCooldownMs: 2_000,
      ratchetEnabled: true,
      trailingEnabled: true,
    },
    strategies: {
      momentum: true,
      mean_reversion: true,
      penny_clipper: true,
      expiry_fade: true,
    },
    createdAt: 0,
  },

  '4h-all': {
    name: '4h-all',
    description: '4-hour markets for all assets. Swing trading focus.',
    config: {
      assets: ['BTC', 'ETH', 'SOL', 'XRP'],
      roundDurationSec: 14400,
      minTimeLeftSec: 600,
      minRoundAgeSec: 120,
      forceExitSec: 120,
      warmupSec: 120,
      sizeUsd: 30,
      maxPositions: 4,
      maxDailyLossUsd: 300,
      takeProfitPct: 18,
      stopLossPct: 15,
      dryRun: true,
      ratchetEnabled: true,
      trailingEnabled: true,
      trailingLatePct: 10,
      trailingMidPct: 12,
      trailingWidePct: 15,
    },
    strategies: {
      momentum: true,
      mean_reversion: true,
      penny_clipper: false,
      expiry_fade: false,
    },
    createdAt: 0,
  },

  'daily-all': {
    name: 'daily-all',
    description: 'Daily markets for all assets. Position trading.',
    config: {
      assets: ['BTC', 'ETH', 'SOL', 'XRP'],
      roundDurationSec: 86400,
      minTimeLeftSec: 3600,
      minRoundAgeSec: 600,
      forceExitSec: 600,
      warmupSec: 300,
      sizeUsd: 50,
      maxPositions: 4,
      maxDailyLossUsd: 500,
      takeProfitPct: 20,
      stopLossPct: 18,
      dryRun: true,
      ratchetEnabled: true,
      ratchetConfirmTicks: 5,
      trailingEnabled: true,
      trailingLatePct: 12,
      trailingMidPct: 15,
      trailingWidePct: 20,
    },
    strategies: {
      momentum: true,
      mean_reversion: true,
      penny_clipper: false,
      expiry_fade: false,
    },
    createdAt: 0,
  },
};
