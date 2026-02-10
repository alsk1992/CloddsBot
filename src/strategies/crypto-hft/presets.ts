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
};
