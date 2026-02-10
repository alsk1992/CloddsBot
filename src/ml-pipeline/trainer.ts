/**
 * ML Trainer — Periodic Train / Validate / Deploy Cycle
 *
 * Every trainIntervalMs:
 * 1. Query labeled samples from SQLite
 * 2. Convert CombinedFeatures JSON → MarketFeatures
 * 3. Time-based 80/20 split (older trains, newer validates)
 * 4. Train via existing MLSignalModel.train()
 * 5. Evaluate on holdout set
 * 6. Quality gates → deploy (save) or rollback (load)
 */

import type { Database } from '../db/index.js';
import type { MLSignalModel, MarketFeatures, TrainingData } from '../trading/ml-signals.js';
import type { CombinedFeatures } from '../services/feature-engineering/types.js';
import type { QualityGates, TrainingStats } from './types.js';
import { DEFAULT_QUALITY_GATES } from './types.js';
import { logger } from '../utils/logger.js';

// ── Interface ────────────────────────────────────────────────────────────────

export interface MLTrainer {
  start(): void;
  stop(): void;
  trainNow(): Promise<void>;
  getStats(): TrainingStats;
}

// ── Feature conversion ───────────────────────────────────────────────────────

/**
 * Convert CombinedFeatures (from feature engine) → MarketFeatures (for ML model).
 * Maps available fields and fills unavailable ones with sensible defaults.
 */
export function combinedToMarketFeatures(cf: CombinedFeatures | null): MarketFeatures {
  const tick = cf?.tick;
  const ob = cf?.orderbook;
  const signals = cf?.signals;

  return {
    price: {
      current: tick?.price ?? ob?.midPrice ?? 0.5,
      change1h: tick?.priceChangePct ?? 0,
      change24h: 0,
      volatility24h: tick?.volatilityPct ?? 0,
      rsi14: 50,
      momentum: tick?.momentum ?? 0,
    },
    volume: {
      current24h: 0,
      changeVsAvg: 1,
      buyRatio: signals?.buyPressure ?? 0.5,
    },
    orderbook: {
      bidAskRatio: ob && ob.askDepth > 0 ? ob.bidDepth / ob.askDepth : 1,
      imbalanceScore: ob?.imbalance ?? 0,
      spreadPct: ob?.spreadPct ?? 0.02,
      depth10Pct: ob ? (ob.bidDepthAt5Pct + ob.askDepthAt5Pct) : 0,
    },
    market: {
      daysToExpiry: 30,
      totalVolume: 0,
      marketCap: 0,
      category: 'other',
    },
  };
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createMLTrainer(
  db: Database,
  model: MLSignalModel,
  config: {
    trainIntervalMs: number;
    minTrainingSamples: number;
    outcomeHorizon: string;
    qualityGates: QualityGates;
  },
): MLTrainer {
  let trainTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let training = false;

  const gates: QualityGates = { ...DEFAULT_QUALITY_GATES, ...config.qualityGates };

  const stats: TrainingStats = {
    totalSamples: 0,
    labeledSamples: 0,
    lastTrainTime: null,
    lastTrainAccuracy: null,
    lastTrainAUC: null,
    lastHoldoutAccuracy: null,
    modelDeployed: false,
    trainCycles: 0,
    deployedCycles: 0,
    rejectedCycles: 0,
  };

  // ── Core training cycle ──────────────────────────────────────────────────

  async function trainCycle(): Promise<void> {
    if (stopped || training) return;
    training = true;

    try {
      // 1. Query labeled samples
      const rows = db.query<{
        features_json: string;
        outcome_direction: number;
        outcome_return: number;
        created_at: string;
      }>(
        `SELECT features_json, outcome_direction, outcome_return, created_at
         FROM ml_training_samples
         WHERE outcome_direction IS NOT NULL
         ORDER BY created_at ASC`,
      );

      stats.labeledSamples = rows.length;

      if (rows.length < config.minTrainingSamples) {
        logger.info(
          { labeled: rows.length, required: config.minTrainingSamples },
          '[ml-trainer] Not enough labeled samples, skipping train cycle',
        );
        return;
      }

      // 2. Convert to TrainingData
      const allData: TrainingData[] = rows.map((row) => {
        let combinedFeatures: CombinedFeatures | null = null;
        try {
          combinedFeatures = JSON.parse(row.features_json) as CombinedFeatures;
        } catch {
          // Malformed JSON — use defaults
        }

        return {
          features: combinedToMarketFeatures(combinedFeatures),
          outcome: {
            direction: row.outcome_direction as 1 | -1,
            return: row.outcome_return,
            horizon: config.outcomeHorizon,
          },
          timestamp: new Date(row.created_at),
        };
      });

      // 3. Time-based 80/20 split
      const splitIdx = Math.floor(allData.length * 0.8);
      const trainSet = allData.slice(0, splitIdx);
      const holdoutSet = allData.slice(splitIdx);

      if (trainSet.length < 10 || holdoutSet.length < 5) {
        logger.info(
          { train: trainSet.length, holdout: holdoutSet.length },
          '[ml-trainer] Split too small, skipping',
        );
        return;
      }

      // 4. Train
      const trainResult = await model.train(trainSet);
      stats.trainCycles++;
      stats.lastTrainTime = Date.now();
      stats.lastTrainAccuracy = trainResult.accuracy;
      stats.lastTrainAUC = trainResult.auc;

      // 5. Evaluate on holdout
      let holdoutCorrect = 0;
      const holdoutPredictions: Array<{ prob: number; actual: number }> = [];

      for (const sample of holdoutSet) {
        const prediction = await model.predict(sample.features);
        const predictedDir = prediction.probUp > 0.5 ? 1 : -1;
        if (predictedDir === sample.outcome.direction) holdoutCorrect++;
        holdoutPredictions.push({
          prob: prediction.probUp,
          actual: sample.outcome.direction === 1 ? 1 : 0,
        });
      }

      const holdoutAccuracy = holdoutCorrect / holdoutSet.length;
      const holdoutAUC = calculateAUC(holdoutPredictions);
      stats.lastHoldoutAccuracy = holdoutAccuracy;

      logger.info(
        {
          trainAccuracy: trainResult.accuracy,
          trainAUC: trainResult.auc,
          holdoutAccuracy: Math.round(holdoutAccuracy * 1000) / 1000,
          holdoutAUC: Math.round(holdoutAUC * 1000) / 1000,
          trainSamples: trainSet.length,
          holdoutSamples: holdoutSet.length,
        },
        '[ml-trainer] Training cycle complete',
      );

      // 6. Quality gates
      const passesAccuracy = holdoutAccuracy >= gates.minHoldoutAccuracy;
      const passesAUC = holdoutAUC >= gates.minHoldoutAUC;

      if (passesAccuracy && passesAUC) {
        // Deploy: save model
        model.save();
        stats.modelDeployed = true;
        stats.deployedCycles++;
        logger.info(
          { holdoutAccuracy, holdoutAUC },
          '[ml-trainer] Model DEPLOYED — passes quality gates',
        );
      } else {
        // Rollback: reload previous model
        model.load();
        stats.rejectedCycles++;
        logger.warn(
          {
            holdoutAccuracy,
            holdoutAUC,
            requiredAccuracy: gates.minHoldoutAccuracy,
            requiredAUC: gates.minHoldoutAUC,
          },
          '[ml-trainer] Model REJECTED — failed quality gates, rolled back',
        );
      }
    } catch (error) {
      logger.error({ error }, '[ml-trainer] Training cycle failed');
    } finally {
      training = false;
    }
  }

  // ── AUC calculation ────────────────────────────────────────────────────────

  function calculateAUC(predictions: Array<{ prob: number; actual: number }>): number {
    const sorted = [...predictions].sort((a, b) => b.prob - a.prob);
    let tpCount = 0;
    let auc = 0;

    for (const pred of sorted) {
      if (pred.actual === 1) {
        tpCount++;
      } else {
        auc += tpCount;
      }
    }

    const totalPos = predictions.filter((p) => p.actual === 1).length;
    const totalNeg = predictions.length - totalPos;

    if (totalPos === 0 || totalNeg === 0) return 0.5;
    return auc / (totalPos * totalNeg);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  function start(): void {
    stopped = false;
    trainTimer = setInterval(() => {
      trainCycle().catch((error) => {
        logger.error({ error }, '[ml-trainer] Scheduled train failed');
      });
    }, config.trainIntervalMs);

    logger.info(
      { trainIntervalMs: config.trainIntervalMs, minSamples: config.minTrainingSamples },
      '[ml-trainer] Started',
    );
  }

  function stop(): void {
    stopped = true;
    if (trainTimer) {
      clearInterval(trainTimer);
      trainTimer = null;
    }
    logger.info('[ml-trainer] Stopped');
  }

  async function trainNow(): Promise<void> {
    await trainCycle();
  }

  function getStats(): TrainingStats {
    // Refresh sample counts
    const rows = db.query<{ total: number; labeled: number }>(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN outcome_direction IS NOT NULL THEN 1 ELSE 0 END) as labeled
       FROM ml_training_samples`,
    );
    const { total, labeled } = rows[0] ?? { total: 0, labeled: 0 };
    stats.totalSamples = total;
    stats.labeledSamples = labeled;

    return { ...stats };
  }

  return { start, stop, trainNow, getStats };
}
