/**
 * ML Collector — Feature Capture & Outcome Labeling
 *
 * Hooks into signal router events to snapshot features at signal time,
 * then periodically labels outcomes by comparing current vs entry price.
 */

import type { Database } from '../db/index.js';
import type { SignalRouter } from '../signal-router/router.js';
import type { TradeLogger } from '../trading/logger.js';
import type { SignalExecution } from '../signal-router/types.js';
import type { CombinedFeatures } from '../services/feature-engineering/types.js';
import { getMarketFeatures } from '../services/feature-engineering/index.js';
import { logger } from '../utils/logger.js';
import { HORIZON_MS } from './types.js';
import { randomUUID } from 'crypto';

// ── Interface ────────────────────────────────────────────────────────────────

export interface MLCollector {
  start(signalRouter: SignalRouter, tradeLogger: TradeLogger | null): void;
  stop(): void;
  getSampleCount(): { total: number; labeled: number; unlabeled: number };
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createMLCollector(
  db: Database,
  config: {
    outcomeHorizon: string;
    labelIntervalMs: number;
    cleanupDays: number;
  },
): MLCollector {
  let labelTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let boundSignalRouter: SignalRouter | null = null;
  let boundTradeLogger: TradeLogger | null = null;

  // Ensure table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS ml_training_samples (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL UNIQUE,
      platform TEXT NOT NULL,
      market_id TEXT NOT NULL,
      outcome_id TEXT,
      signal_type TEXT NOT NULL,
      signal_direction TEXT NOT NULL,
      signal_strength REAL NOT NULL,
      features_json TEXT NOT NULL,
      entry_price REAL,
      ml_prob_up REAL,
      ml_confidence REAL,
      outcome_direction INTEGER,
      outcome_return REAL,
      outcome_horizon TEXT,
      outcome_labeled_at TEXT,
      trade_id TEXT,
      realized_pnl REAL,
      created_at TEXT NOT NULL
    )
  `);

  // Create indexes (ignore if already exist)
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_mts_platform ON ml_training_samples(platform)',
    'CREATE INDEX IF NOT EXISTS idx_mts_created ON ml_training_samples(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_mts_labeled ON ml_training_samples(outcome_labeled_at)',
    'CREATE INDEX IF NOT EXISTS idx_mts_trade ON ml_training_samples(trade_id)',
  ];
  for (const idx of indexes) {
    db.run(idx);
  }

  // ── Capture ──────────────────────────────────────────────────────────────

  function captureSignal(exec: SignalExecution): void {
    if (stopped) return;

    const { signal } = exec;

    // Snapshot current features
    const features = getMarketFeatures(signal.platform, signal.marketId, signal.outcomeId);

    const id = randomUUID();
    const now = new Date().toISOString();

    try {
      db.run(
        `INSERT OR IGNORE INTO ml_training_samples
         (id, signal_id, platform, market_id, outcome_id, signal_type,
          signal_direction, signal_strength, features_json, entry_price,
          outcome_horizon, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          exec.id,
          signal.platform,
          signal.marketId,
          signal.outcomeId || null,
          signal.type,
          signal.direction,
          signal.strength,
          JSON.stringify(features),
          exec.orderPrice ?? features?.tick?.price ?? null,
          config.outcomeHorizon,
          now,
        ],
      );
    } catch (error) {
      logger.warn({ error, signalId: exec.id }, '[ml-collector] Failed to capture sample');
    }
  }

  // ── Label timer ──────────────────────────────────────────────────────────

  function labelOutcomes(): void {
    if (stopped) return;

    const horizonMs = HORIZON_MS[config.outcomeHorizon] ?? HORIZON_MS['1h'];
    const cutoff = new Date(Date.now() - horizonMs).toISOString();

    // Get unlabeled samples that are old enough
    const unlabeled = db.query<{
      id: string;
      platform: string;
      market_id: string;
      outcome_id: string | null;
      entry_price: number | null;
    }>(
      `SELECT id, platform, market_id, outcome_id, entry_price
       FROM ml_training_samples
       WHERE outcome_direction IS NULL
         AND created_at < ?
       LIMIT 100`,
      [cutoff],
    );

    if (unlabeled.length === 0) return;

    let labeled = 0;
    for (const sample of unlabeled) {
      const features = getMarketFeatures(
        sample.platform,
        sample.market_id,
        sample.outcome_id ?? undefined,
      );

      const currentPrice = features?.tick?.price ?? features?.orderbook?.midPrice;
      const entryPrice = sample.entry_price;

      if (currentPrice == null || entryPrice == null || entryPrice === 0) continue;

      const returnPct = (currentPrice - entryPrice) / entryPrice;
      const direction = returnPct >= 0 ? 1 : -1;

      try {
        db.run(
          `UPDATE ml_training_samples
           SET outcome_direction = ?,
               outcome_return = ?,
               outcome_labeled_at = ?
           WHERE id = ?`,
          [direction, returnPct, new Date().toISOString(), sample.id],
        );
        labeled++;
      } catch (error) {
        logger.warn({ error, sampleId: sample.id }, '[ml-collector] Label failed');
      }
    }

    if (labeled > 0) {
      logger.info({ labeled, checked: unlabeled.length }, '[ml-collector] Labeled outcomes');
    }
  }

  // ── Cleanup old samples ──────────────────────────────────────────────────

  function cleanup(): void {
    const cutoff = new Date(Date.now() - config.cleanupDays * 24 * 60 * 60 * 1000).toISOString();
    db.run(`DELETE FROM ml_training_samples WHERE created_at < ?`, [cutoff]);
  }

  // ── Trade linking ────────────────────────────────────────────────────────

  function linkTrade(data: { entryId: string; exitId: string; realizedPnL: number }): void {
    // Try to match by recent signal executions
    // The trade logger emits 'tradesLinked' — we backfill realized_pnl
    try {
      db.run(
        `UPDATE ml_training_samples
         SET realized_pnl = ?
         WHERE trade_id = ?`,
        [data.realizedPnL, data.entryId],
      );
    } catch {
      // Best-effort linking
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  function start(signalRouter: SignalRouter, tradeLogger: TradeLogger | null): void {
    stopped = false;
    boundSignalRouter = signalRouter;
    boundTradeLogger = tradeLogger;

    signalRouter.on('executed', captureSignal);
    signalRouter.on('dry_run', captureSignal);

    if (tradeLogger) {
      tradeLogger.on('tradesLinked', linkTrade);
    }

    // Start label timer
    labelTimer = setInterval(labelOutcomes, config.labelIntervalMs);

    // Run cleanup once on start
    cleanup();

    logger.info(
      { horizon: config.outcomeHorizon, labelIntervalMs: config.labelIntervalMs },
      '[ml-collector] Started',
    );
  }

  function stop(): void {
    stopped = true;
    if (labelTimer) {
      clearInterval(labelTimer);
      labelTimer = null;
    }
    if (boundSignalRouter) {
      boundSignalRouter.off('executed', captureSignal);
      boundSignalRouter.off('dry_run', captureSignal);
      boundSignalRouter = null;
    }
    if (boundTradeLogger) {
      boundTradeLogger.off('tradesLinked', linkTrade);
      boundTradeLogger = null;
    }
    logger.info('[ml-collector] Stopped');
  }

  function getSampleCount(): { total: number; labeled: number; unlabeled: number } {
    const rows = db.query<{ total: number; labeled: number }>(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN outcome_direction IS NOT NULL THEN 1 ELSE 0 END) as labeled
       FROM ml_training_samples`,
    );
    const { total, labeled } = rows[0] ?? { total: 0, labeled: 0 };
    return { total, labeled, unlabeled: total - labeled };
  }

  return { start, stop, getSampleCount };
}
