/**
 * Bot State Persistence - Save and restore bot progress
 *
 * Features:
 * - Checkpoint price history for technical analysis
 * - Persist positions and unrealized PnL
 * - Save strategy parameters with versioning
 * - Auto-recover on restart
 */

import { Database } from '../db/index';
import { logger } from '../utils/logger';
import type { Platform } from '../types';

// =============================================================================
// TYPES
// =============================================================================

export interface BotCheckpoint {
  strategyId: string;
  /** Price history per market (for technical indicators) */
  priceHistory: Record<string, number[]>;
  /** Current positions */
  positions: BotPosition[];
  /** Strategy parameters (versioned) */
  params: Record<string, unknown>;
  paramsVersion: number;
  /** Evaluation state */
  lastEvaluatedAt: Date;
  evaluationCount: number;
  /** Performance at checkpoint */
  totalPnL: number;
  unrealizedPnL: number;
  winRate: number;
  tradesCount: number;
  /** Signals pending execution */
  pendingSignals: PendingSignal[];
  /** Created at */
  createdAt: Date;
}

export interface BotPosition {
  platform: Platform;
  marketId: string;
  outcome: string;
  tokenId?: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  entryTime: Date;
  lastUpdated: Date;
}

export interface PendingSignal {
  type: 'buy' | 'sell' | 'close';
  platform: Platform;
  marketId: string;
  outcome: string;
  price?: number;
  size?: number;
  reason?: string;
  createdAt: Date;
}

export interface StrategyVersion {
  strategyId: string;
  version: number;
  params: Record<string, unknown>;
  createdAt: Date;
  note?: string;
}

export interface BotStateManager {
  /** Save checkpoint for a bot */
  saveCheckpoint(checkpoint: BotCheckpoint): void;

  /** Load latest checkpoint */
  loadCheckpoint(strategyId: string): BotCheckpoint | null;

  /** List all checkpoints for a bot */
  listCheckpoints(strategyId: string, limit?: number): BotCheckpoint[];

  /** Save strategy parameters (creates new version) */
  saveParams(strategyId: string, params: Record<string, unknown>, note?: string): number;

  /** Load strategy parameters */
  loadParams(strategyId: string, version?: number): StrategyVersion | null;

  /** List parameter versions */
  listParamVersions(strategyId: string): StrategyVersion[];

  /** Save position state */
  savePosition(strategyId: string, position: BotPosition): void;

  /** Load positions for a bot */
  loadPositions(strategyId: string): BotPosition[];

  /** Clear position (when closed) */
  clearPosition(strategyId: string, marketId: string, outcome: string): void;

  /** Get all bots with state */
  listBotsWithState(): string[];

  /** Delete all state for a bot */
  deleteState(strategyId: string): void;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createBotStateManager(db: Database): BotStateManager {
  // Initialize tables
  db.run(`
    CREATE TABLE IF NOT EXISTS bot_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id TEXT NOT NULL,
      price_history_json TEXT,
      positions_json TEXT,
      params_json TEXT,
      params_version INTEGER DEFAULT 1,
      last_evaluated_at TEXT,
      evaluation_count INTEGER DEFAULT 0,
      total_pnl REAL DEFAULT 0,
      unrealized_pnl REAL DEFAULT 0,
      win_rate REAL DEFAULT 0,
      trades_count INTEGER DEFAULT 0,
      pending_signals_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(strategy_id, created_at)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bot_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      market_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      token_id TEXT,
      shares REAL NOT NULL,
      avg_price REAL NOT NULL,
      current_price REAL,
      unrealized_pnl REAL,
      unrealized_pnl_pct REAL,
      entry_time TEXT,
      last_updated TEXT NOT NULL,
      UNIQUE(strategy_id, platform, market_id, outcome)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS strategy_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      params_json TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(strategy_id, version)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_checkpoints_strategy ON bot_checkpoints(strategy_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_positions_strategy ON bot_positions(strategy_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_versions_strategy ON strategy_versions(strategy_id)`);

  return {
    saveCheckpoint(checkpoint) {
      db.run(
        `INSERT OR REPLACE INTO bot_checkpoints
         (strategy_id, price_history_json, positions_json, params_json, params_version,
          last_evaluated_at, evaluation_count, total_pnl, unrealized_pnl, win_rate,
          trades_count, pending_signals_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          checkpoint.strategyId,
          JSON.stringify(checkpoint.priceHistory),
          JSON.stringify(checkpoint.positions),
          JSON.stringify(checkpoint.params),
          checkpoint.paramsVersion,
          checkpoint.lastEvaluatedAt.toISOString(),
          checkpoint.evaluationCount,
          checkpoint.totalPnL,
          checkpoint.unrealizedPnL,
          checkpoint.winRate,
          checkpoint.tradesCount,
          JSON.stringify(checkpoint.pendingSignals),
          checkpoint.createdAt.toISOString(),
        ]
      );

      logger.debug({ strategyId: checkpoint.strategyId }, 'Checkpoint saved');
    },

    loadCheckpoint(strategyId) {
      const rows = db.query<any>(
        `SELECT * FROM bot_checkpoints WHERE strategy_id = ? ORDER BY created_at DESC LIMIT 1`,
        [strategyId]
      );

      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        strategyId: row.strategy_id,
        priceHistory: row.price_history_json ? JSON.parse(row.price_history_json) : {},
        positions: row.positions_json ? JSON.parse(row.positions_json) : [],
        params: row.params_json ? JSON.parse(row.params_json) : {},
        paramsVersion: row.params_version || 1,
        lastEvaluatedAt: row.last_evaluated_at ? new Date(row.last_evaluated_at) : new Date(),
        evaluationCount: row.evaluation_count || 0,
        totalPnL: row.total_pnl || 0,
        unrealizedPnL: row.unrealized_pnl || 0,
        winRate: row.win_rate || 0,
        tradesCount: row.trades_count || 0,
        pendingSignals: row.pending_signals_json ? JSON.parse(row.pending_signals_json) : [],
        createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      };
    },

    listCheckpoints(strategyId, limit = 10) {
      const rows = db.query<any>(
        `SELECT * FROM bot_checkpoints WHERE strategy_id = ? ORDER BY created_at DESC LIMIT ?`,
        [strategyId, limit]
      );

      return rows.map((row) => ({
        strategyId: row.strategy_id,
        priceHistory: row.price_history_json ? JSON.parse(row.price_history_json) : {},
        positions: row.positions_json ? JSON.parse(row.positions_json) : [],
        params: row.params_json ? JSON.parse(row.params_json) : {},
        paramsVersion: row.params_version || 1,
        lastEvaluatedAt: row.last_evaluated_at ? new Date(row.last_evaluated_at) : new Date(),
        evaluationCount: row.evaluation_count || 0,
        totalPnL: row.total_pnl || 0,
        unrealizedPnL: row.unrealized_pnl || 0,
        winRate: row.win_rate || 0,
        tradesCount: row.trades_count || 0,
        pendingSignals: row.pending_signals_json ? JSON.parse(row.pending_signals_json) : [],
        createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      }));
    },

    saveParams(strategyId, params, note) {
      // Get next version
      const rows = db.query<{ maxVersion: number }>(
        `SELECT MAX(version) as maxVersion FROM strategy_versions WHERE strategy_id = ?`,
        [strategyId]
      );
      const nextVersion = (rows[0]?.maxVersion || 0) + 1;

      db.run(
        `INSERT INTO strategy_versions (strategy_id, version, params_json, note, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [strategyId, nextVersion, JSON.stringify(params), note || null, new Date().toISOString()]
      );

      logger.info({ strategyId, version: nextVersion }, 'Strategy params saved');
      return nextVersion;
    },

    loadParams(strategyId, version) {
      const query = version
        ? `SELECT * FROM strategy_versions WHERE strategy_id = ? AND version = ?`
        : `SELECT * FROM strategy_versions WHERE strategy_id = ? ORDER BY version DESC LIMIT 1`;

      const rows = db.query<any>(query, version ? [strategyId, version] : [strategyId]);

      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        strategyId: row.strategy_id,
        version: row.version,
        params: JSON.parse(row.params_json),
        createdAt: new Date(row.created_at),
        note: row.note,
      };
    },

    listParamVersions(strategyId) {
      const rows = db.query<any>(
        `SELECT * FROM strategy_versions WHERE strategy_id = ? ORDER BY version DESC`,
        [strategyId]
      );

      return rows.map((row) => ({
        strategyId: row.strategy_id,
        version: row.version,
        params: JSON.parse(row.params_json),
        createdAt: new Date(row.created_at),
        note: row.note,
      }));
    },

    savePosition(strategyId, position) {
      // Guard: if shares <= 0, delete the position instead of saving invalid state
      if (position.shares <= 0) {
        logger.warn(
          { strategyId, marketId: position.marketId, outcome: position.outcome, shares: position.shares },
          'Attempted to save position with non-positive shares, deleting instead'
        );
        db.run(
          `DELETE FROM bot_positions WHERE strategy_id = ? AND market_id = ? AND outcome = ?`,
          [strategyId, position.marketId, position.outcome]
        );
        return;
      }

      db.run(
        `INSERT OR REPLACE INTO bot_positions
         (strategy_id, platform, market_id, outcome, token_id, shares, avg_price,
          current_price, unrealized_pnl, unrealized_pnl_pct, entry_time, last_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          strategyId,
          position.platform,
          position.marketId,
          position.outcome,
          position.tokenId || null,
          position.shares,
          position.avgPrice,
          position.currentPrice,
          position.unrealizedPnL,
          position.unrealizedPnLPct,
          position.entryTime.toISOString(),
          position.lastUpdated.toISOString(),
        ]
      );
    },

    loadPositions(strategyId) {
      const rows = db.query<any>(
        `SELECT * FROM bot_positions WHERE strategy_id = ? AND shares > 0`,
        [strategyId]
      );

      return rows.map((row) => ({
        platform: row.platform as Platform,
        marketId: row.market_id,
        outcome: row.outcome,
        tokenId: row.token_id,
        shares: row.shares,
        avgPrice: row.avg_price,
        currentPrice: row.current_price || row.avg_price,
        unrealizedPnL: row.unrealized_pnl || 0,
        unrealizedPnLPct: row.unrealized_pnl_pct || 0,
        entryTime: new Date(row.entry_time),
        lastUpdated: new Date(row.last_updated),
      }));
    },

    clearPosition(strategyId, marketId, outcome) {
      db.run(
        `DELETE FROM bot_positions WHERE strategy_id = ? AND market_id = ? AND outcome = ?`,
        [strategyId, marketId, outcome]
      );
    },

    listBotsWithState() {
      const rows = db.query<{ strategy_id: string }>(
        `SELECT DISTINCT strategy_id FROM bot_checkpoints
         UNION
         SELECT DISTINCT strategy_id FROM bot_positions
         UNION
         SELECT DISTINCT strategy_id FROM strategy_versions`
      );

      return rows.map((r) => r.strategy_id);
    },

    deleteState(strategyId) {
      try {
        db.run('BEGIN TRANSACTION');
        db.run(`DELETE FROM bot_checkpoints WHERE strategy_id = ?`, [strategyId]);
        db.run(`DELETE FROM bot_positions WHERE strategy_id = ?`, [strategyId]);
        db.run(`DELETE FROM strategy_versions WHERE strategy_id = ?`, [strategyId]);
        db.run('COMMIT');
      } catch (err) {
        try { db.run('ROLLBACK'); } catch { /* rollback best-effort */ }
        logger.error({ strategyId, err }, 'Failed to delete bot state');
        throw err;
      }

      logger.info({ strategyId }, 'Bot state deleted');
    },
  };
}
