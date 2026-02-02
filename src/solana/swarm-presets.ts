/**
 * Swarm Preset System
 *
 * Save and reuse swarm trading configurations:
 * - Strategy presets (execution mode, slippage, pool)
 * - Token presets (mint-specific settings)
 * - Wallet group presets (named wallet combinations)
 */

import { randomUUID } from 'crypto';
import { createDatabase, type Database } from '../db';
import type { ExecutionMode, SwarmTradeParams } from './pump-swarm';

// ============================================================================
// Types
// ============================================================================

export type PresetType = 'strategy' | 'token' | 'wallet_group';

export interface SwarmPresetConfig {
  // Token presets
  mint?: string;

  // Trade params
  amountPerWallet?: number | string;
  denominatedInSol?: boolean;
  slippageBps?: number;
  priorityFeeLamports?: number;
  pool?: 'pump' | 'raydium' | 'auto';
  executionMode?: ExecutionMode;

  // Wallet selection
  walletIds?: string[];

  // Advanced
  amountVariancePct?: number;
  autoRefreshPositions?: boolean;
}

export interface SwarmPreset {
  id: string;
  userId: string;
  name: string;
  type: PresetType;
  description?: string;
  config: SwarmPresetConfig;
  createdAt: Date;
  updatedAt: Date;
}

interface DbPresetRow {
  id: string;
  user_id: string;
  name: string;
  type: string;
  description: string | null;
  config: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Built-in Presets (Always Available, No DB)
// ============================================================================

const BUILTIN_PRESETS: SwarmPreset[] = [
  {
    id: 'builtin_fast',
    userId: 'system',
    name: 'fast',
    type: 'strategy',
    description: 'Speed priority - parallel execution with 5% slippage',
    config: {
      executionMode: 'parallel',
      slippageBps: 500,
      pool: 'auto',
    },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
  {
    id: 'builtin_atomic',
    userId: 'system',
    name: 'atomic',
    type: 'strategy',
    description: 'All-or-nothing execution via Jito bundles',
    config: {
      executionMode: 'multi-bundle',
      slippageBps: 500,
      pool: 'auto',
    },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
  {
    id: 'builtin_stealth',
    userId: 'system',
    name: 'stealth',
    type: 'strategy',
    description: 'Pattern avoidance - sequential with variance',
    config: {
      executionMode: 'sequential',
      slippageBps: 300,
      pool: 'auto',
      amountVariancePct: 10,
    },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
  {
    id: 'builtin_aggressive',
    userId: 'system',
    name: 'aggressive',
    type: 'strategy',
    description: 'High volatility tokens - parallel with 10% slippage',
    config: {
      executionMode: 'parallel',
      slippageBps: 1000,
      pool: 'pump',
    },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
  {
    id: 'builtin_safe',
    userId: 'system',
    name: 'safe',
    type: 'strategy',
    description: 'Conservative - bundle with 2% slippage',
    config: {
      executionMode: 'bundle',
      slippageBps: 200,
      pool: 'auto',
    },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
];

// ============================================================================
// Preset Service
// ============================================================================

export interface SwarmPresetService {
  // CRUD
  create(userId: string, preset: Omit<SwarmPreset, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<SwarmPreset>;
  get(userId: string, name: string): Promise<SwarmPreset | null>;
  list(userId: string, type?: PresetType): Promise<SwarmPreset[]>;
  update(userId: string, name: string, changes: Partial<SwarmPresetConfig & { description?: string }>): Promise<SwarmPreset | null>;
  delete(userId: string, name: string): Promise<boolean>;

  // Apply preset to trade params
  applyToParams(preset: SwarmPreset, baseParams: SwarmTradeParams): SwarmTradeParams;

  // Built-in presets (no DB, always available)
  getBuiltIn(name: string): SwarmPreset | null;
  listBuiltIn(): SwarmPreset[];
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

function rowToPreset(row: DbPresetRow): SwarmPreset {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type as PresetType,
    description: row.description || undefined,
    config: JSON.parse(row.config) as SwarmPresetConfig,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function createSwarmPresetService(): SwarmPresetService {
  const db = createDatabase();

  // Self-create tables on init (no migrations required)
  db.run(`
    CREATE TABLE IF NOT EXISTS swarm_presets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('strategy', 'token', 'wallet_group')),
      description TEXT,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, name)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_swarm_presets_user
    ON swarm_presets(user_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_swarm_presets_type
    ON swarm_presets(user_id, type)
  `);

  return {
    async create(userId, preset) {
      const id = randomUUID();
      const name = normalizeName(preset.name);
      const now = new Date().toISOString();

      // Check if name conflicts with built-in
      if (BUILTIN_PRESETS.some(p => p.name === name)) {
        throw new Error(`Cannot use reserved preset name: ${name}`);
      }

      db.run(
        `INSERT INTO swarm_presets (id, user_id, name, type, description, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, name, preset.type, preset.description || null, JSON.stringify(preset.config), now, now]
      );

      return {
        id,
        userId,
        name,
        type: preset.type,
        description: preset.description,
        config: preset.config,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      };
    },

    async get(userId, name) {
      const normalizedName = normalizeName(name);

      // Check built-in first
      const builtin = BUILTIN_PRESETS.find(p => p.name === normalizedName);
      if (builtin) return builtin;

      // Then check user presets
      const rows = db.query<DbPresetRow>(
        'SELECT * FROM swarm_presets WHERE user_id = ? AND name = ?',
        [userId, normalizedName]
      );

      if (rows.length === 0) return null;
      return rowToPreset(rows[0]);
    },

    async list(userId, type?) {
      const presets: SwarmPreset[] = [];

      // Add built-in presets (optionally filtered by type)
      for (const builtin of BUILTIN_PRESETS) {
        if (!type || builtin.type === type) {
          presets.push(builtin);
        }
      }

      // Add user presets
      let sql = 'SELECT * FROM swarm_presets WHERE user_id = ?';
      const params: (string | null)[] = [userId];

      if (type) {
        sql += ' AND type = ?';
        params.push(type);
      }

      sql += ' ORDER BY name';

      const rows = db.query<DbPresetRow>(sql, params);
      for (const row of rows) {
        presets.push(rowToPreset(row));
      }

      return presets;
    },

    async update(userId, name, changes) {
      const normalizedName = normalizeName(name);

      // Cannot update built-in presets
      if (BUILTIN_PRESETS.some(p => p.name === normalizedName)) {
        throw new Error(`Cannot modify built-in preset: ${name}`);
      }

      // Get existing preset
      const existing = await this.get(userId, normalizedName);
      if (!existing) return null;

      const now = new Date().toISOString();
      const { description, ...configChanges } = changes;
      const newConfig = { ...existing.config, ...configChanges };
      const newDescription = description !== undefined ? description : existing.description;

      db.run(
        `UPDATE swarm_presets SET config = ?, description = ?, updated_at = ? WHERE user_id = ? AND name = ?`,
        [JSON.stringify(newConfig), newDescription || null, now, userId, normalizedName]
      );

      return {
        ...existing,
        config: newConfig,
        description: newDescription,
        updatedAt: new Date(now),
      };
    },

    async delete(userId, name) {
      const normalizedName = normalizeName(name);

      // Cannot delete built-in presets
      if (BUILTIN_PRESETS.some(p => p.name === normalizedName)) {
        throw new Error(`Cannot delete built-in preset: ${name}`);
      }

      // Check if preset exists first
      const existing = await this.get(userId, normalizedName);
      if (!existing || existing.userId === 'system') {
        return false;
      }

      db.run(
        'DELETE FROM swarm_presets WHERE user_id = ? AND name = ?',
        [userId, normalizedName]
      );

      return true;
    },

    applyToParams(preset, baseParams) {
      const config = preset.config;
      const result = { ...baseParams };

      // Apply config values if they exist and aren't already set in baseParams
      if (config.mint && !result.mint) {
        result.mint = config.mint;
      }
      if (config.amountPerWallet !== undefined && !result.amountPerWallet) {
        result.amountPerWallet = config.amountPerWallet;
      }
      if (config.denominatedInSol !== undefined && result.denominatedInSol === undefined) {
        result.denominatedInSol = config.denominatedInSol;
      }
      if (config.slippageBps !== undefined && !result.slippageBps) {
        result.slippageBps = config.slippageBps;
      }
      if (config.priorityFeeLamports !== undefined && !result.priorityFeeLamports) {
        result.priorityFeeLamports = config.priorityFeeLamports;
      }
      if (config.pool && !result.pool) {
        result.pool = config.pool;
      }
      if (config.executionMode && !result.executionMode) {
        result.executionMode = config.executionMode;
      }
      if (config.walletIds && config.walletIds.length > 0 && !result.walletIds) {
        result.walletIds = config.walletIds;
      }

      return result;
    },

    getBuiltIn(name) {
      const normalizedName = normalizeName(name);
      return BUILTIN_PRESETS.find(p => p.name === normalizedName) || null;
    },

    listBuiltIn() {
      return [...BUILTIN_PRESETS];
    },
  };
}

// ============================================================================
// Singleton Instance
// ============================================================================

let presetServiceInstance: SwarmPresetService | null = null;

export function getSwarmPresetService(): SwarmPresetService {
  if (!presetServiceInstance) {
    presetServiceInstance = createSwarmPresetService();
  }
  return presetServiceInstance;
}

export function resetSwarmPresetService(): void {
  presetServiceInstance = null;
}
