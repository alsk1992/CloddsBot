/**
 * ACP Predictions - Agent forecast tracking with Brier scores
 *
 * Features:
 * - Submit predictions on markets (probability + rationale)
 * - Track outcomes when markets resolve
 * - Calculate Brier scores for accuracy ranking
 * - Public prediction feed
 * - Per-agent accuracy stats
 */

import { randomBytes } from 'crypto';
import { Database } from '../db';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface Prediction {
  id: string;
  agentId: string;
  marketSlug: string;
  marketTitle: string;
  marketCategory?: string;
  probability: number; // 0.0 to 1.0
  rationale: string;
  outcome?: number; // 1 = YES, 0 = NO (null if unresolved)
  brierContribution?: number;
  resolvedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface PredictionStats {
  agentId: string;
  totalPredictions: number;
  resolvedPredictions: number;
  correctPredictions: number; // >50% confidence was right
  brierScore?: number; // Lower is better (0 = perfect, 1 = worst)
  brierSum: number;
  accuracy?: number; // Win rate
  bestCategory?: string;
  worstCategory?: string;
  streakCurrent: number;
  streakBest: number;
  updatedAt: number;
}

export interface PredictionFeedEntry {
  id: string;
  agentId: string;
  agentHandle?: string;
  marketSlug: string;
  marketTitle: string;
  marketCategory?: string;
  probability: number;
  rationale: string;
  createdAt: number;
}

export type MarketCategory = 'politics' | 'pop-culture' | 'economy' | 'crypto-tech' | 'sports' | 'other';

// =============================================================================
// DATABASE SETUP
// =============================================================================

let db: Database | null = null;
let initialized = false;

export function initPredictions(database: Database): void {
  db = database;
  ensureTablesExist();
  initialized = true;
  logger.info('ACP Predictions initialized');
}

function getDb(): Database {
  if (!db) {
    throw new Error('Predictions not initialized. Call initPredictions first.');
  }
  return db;
}

function ensureTablesExist(): void {
  const database = getDb();

  // Main predictions table
  database.run(`
    CREATE TABLE IF NOT EXISTS acp_predictions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      market_slug TEXT NOT NULL,
      market_title TEXT NOT NULL,
      market_category TEXT,
      probability REAL NOT NULL CHECK(probability >= 0 AND probability <= 1),
      rationale TEXT NOT NULL,
      outcome INTEGER,
      brier_contribution REAL,
      resolved_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Indexes for common queries
  database.run('CREATE INDEX IF NOT EXISTS idx_pred_agent ON acp_predictions(agent_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_pred_market ON acp_predictions(market_slug)');
  database.run('CREATE INDEX IF NOT EXISTS idx_pred_created ON acp_predictions(created_at DESC)');
  database.run('CREATE INDEX IF NOT EXISTS idx_pred_unresolved ON acp_predictions(outcome) WHERE outcome IS NULL');

  // Stats cache per agent
  database.run(`
    CREATE TABLE IF NOT EXISTS acp_prediction_stats (
      agent_id TEXT PRIMARY KEY,
      total_predictions INTEGER NOT NULL DEFAULT 0,
      resolved_predictions INTEGER NOT NULL DEFAULT 0,
      correct_predictions INTEGER NOT NULL DEFAULT 0,
      brier_score REAL,
      brier_sum REAL NOT NULL DEFAULT 0,
      accuracy REAL,
      best_category TEXT,
      worst_category TEXT,
      streak_current INTEGER NOT NULL DEFAULT 0,
      streak_best INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `);

  logger.debug('Predictions tables ensured');
}

// =============================================================================
// PREDICTION SERVICE
// =============================================================================

export interface PredictionService {
  // Submit/update predictions
  submit(agentId: string, market: {
    slug: string;
    title: string;
    category?: MarketCategory;
  }, probability: number, rationale: string): Promise<Prediction>;

  // Get predictions
  get(predictionId: string): Promise<Prediction | null>;
  getByAgent(agentId: string, limit?: number): Promise<Prediction[]>;
  getByMarket(marketSlug: string): Promise<Prediction[]>;
  getAgentPredictionForMarket(agentId: string, marketSlug: string): Promise<Prediction | null>;

  // Feed
  getFeed(limit?: number, category?: MarketCategory): Promise<PredictionFeedEntry[]>;

  // Resolution
  resolve(marketSlug: string, outcome: 0 | 1): Promise<number>; // Returns count resolved
  resolveOne(predictionId: string, outcome: 0 | 1): Promise<Prediction>;

  // Stats
  getStats(agentId: string): Promise<PredictionStats | null>;
  recalculateStats(agentId: string): Promise<PredictionStats>;
  getLeaderboard(limit?: number): Promise<Array<PredictionStats & { handle?: string }>>;
}

export function createPredictionService(): PredictionService {
  return {
    async submit(agentId, market, probability, rationale): Promise<Prediction> {
      if (probability < 0 || probability > 1) {
        throw new Error('Probability must be between 0 and 1');
      }
      if (!rationale || rationale.length < 10) {
        throw new Error('Rationale must be at least 10 characters');
      }
      if (rationale.length > 800) {
        throw new Error('Rationale must be at most 800 characters');
      }

      const database = getDb();
      const now = Date.now();

      // Check if agent already has a prediction for this market
      const existing = await this.getAgentPredictionForMarket(agentId, market.slug);

      if (existing) {
        // Update existing prediction
        if (existing.outcome !== undefined && existing.outcome !== null) {
          throw new Error('Cannot update prediction for resolved market');
        }

        database.run(
          `UPDATE acp_predictions
           SET probability = ?, rationale = ?, updated_at = ?
           WHERE id = ?`,
          [probability, rationale, now, existing.id]
        );

        logger.info({ agentId, market: market.slug, probability }, 'Prediction updated');

        return {
          ...existing,
          probability,
          rationale,
          updatedAt: now,
        };
      }

      // Create new prediction
      const id = `pred_${randomBytes(12).toString('hex')}`;

      database.run(
        `INSERT INTO acp_predictions
         (id, agent_id, market_slug, market_title, market_category, probability, rationale, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, agentId, market.slug, market.title, market.category || null, probability, rationale, now, now]
      );

      // Update stats
      await this.recalculateStats(agentId);

      logger.info({ agentId, market: market.slug, probability }, 'Prediction submitted');

      return {
        id,
        agentId,
        marketSlug: market.slug,
        marketTitle: market.title,
        marketCategory: market.category,
        probability,
        rationale,
        createdAt: now,
        updatedAt: now,
      };
    },

    async get(predictionId): Promise<Prediction | null> {
      const database = getDb();
      const rows = database.query<PredictionRow>(
        'SELECT * FROM acp_predictions WHERE id = ?',
        [predictionId]
      );
      return rows.length > 0 ? rowToPrediction(rows[0]) : null;
    },

    async getByAgent(agentId, limit = 50): Promise<Prediction[]> {
      const database = getDb();
      const rows = database.query<PredictionRow>(
        'SELECT * FROM acp_predictions WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
        [agentId, limit]
      );
      return rows.map(rowToPrediction);
    },

    async getByMarket(marketSlug): Promise<Prediction[]> {
      const database = getDb();
      const rows = database.query<PredictionRow>(
        'SELECT * FROM acp_predictions WHERE market_slug = ? ORDER BY created_at DESC',
        [marketSlug]
      );
      return rows.map(rowToPrediction);
    },

    async getAgentPredictionForMarket(agentId, marketSlug): Promise<Prediction | null> {
      const database = getDb();
      const rows = database.query<PredictionRow>(
        'SELECT * FROM acp_predictions WHERE agent_id = ? AND market_slug = ?',
        [agentId, marketSlug]
      );
      return rows.length > 0 ? rowToPrediction(rows[0]) : null;
    },

    async getFeed(limit = 50, category?): Promise<PredictionFeedEntry[]> {
      const database = getDb();

      let sql = `
        SELECT p.*, h.handle as agent_handle
        FROM acp_predictions p
        LEFT JOIN acp_handles h ON p.agent_id = h.agent_id
      `;
      const params: unknown[] = [];

      if (category) {
        sql += ' WHERE p.market_category = ?';
        params.push(category);
      }

      sql += ' ORDER BY p.created_at DESC LIMIT ?';
      params.push(limit);

      const rows = database.query<PredictionRow & { agent_handle?: string }>(sql, params);

      return rows.map(row => ({
        id: row.id,
        agentId: row.agent_id,
        agentHandle: row.agent_handle || undefined,
        marketSlug: row.market_slug,
        marketTitle: row.market_title,
        marketCategory: row.market_category || undefined,
        probability: row.probability,
        rationale: row.rationale,
        createdAt: row.created_at,
      }));
    },

    async resolve(marketSlug, outcome): Promise<number> {
      const database = getDb();
      const now = Date.now();

      // Get all unresolved predictions for this market
      const predictions = database.query<PredictionRow>(
        'SELECT * FROM acp_predictions WHERE market_slug = ? AND outcome IS NULL',
        [marketSlug]
      );

      if (predictions.length === 0) {
        return 0;
      }

      // Update each prediction with outcome and Brier contribution
      for (const row of predictions) {
        const brierContribution = Math.pow(row.probability - outcome, 2);

        database.run(
          `UPDATE acp_predictions
           SET outcome = ?, brier_contribution = ?, resolved_at = ?, updated_at = ?
           WHERE id = ?`,
          [outcome, brierContribution, now, now, row.id]
        );

        // Recalculate agent stats
        await this.recalculateStats(row.agent_id);
      }

      logger.info({ marketSlug, outcome, count: predictions.length }, 'Market predictions resolved');

      return predictions.length;
    },

    async resolveOne(predictionId, outcome): Promise<Prediction> {
      const prediction = await this.get(predictionId);
      if (!prediction) {
        throw new Error('Prediction not found');
      }
      if (prediction.outcome !== undefined && prediction.outcome !== null) {
        throw new Error('Prediction already resolved');
      }

      const database = getDb();
      const now = Date.now();
      const brierContribution = Math.pow(prediction.probability - outcome, 2);

      database.run(
        `UPDATE acp_predictions
         SET outcome = ?, brier_contribution = ?, resolved_at = ?, updated_at = ?
         WHERE id = ?`,
        [outcome, brierContribution, now, now, predictionId]
      );

      await this.recalculateStats(prediction.agentId);

      return {
        ...prediction,
        outcome,
        brierContribution,
        resolvedAt: now,
        updatedAt: now,
      };
    },

    async getStats(agentId): Promise<PredictionStats | null> {
      const database = getDb();
      const rows = database.query<StatsRow>(
        'SELECT * FROM acp_prediction_stats WHERE agent_id = ?',
        [agentId]
      );
      return rows.length > 0 ? rowToStats(rows[0]) : null;
    },

    async recalculateStats(agentId): Promise<PredictionStats> {
      const database = getDb();
      const now = Date.now();

      // Get all predictions for agent
      const predictions = database.query<PredictionRow>(
        'SELECT * FROM acp_predictions WHERE agent_id = ? ORDER BY created_at ASC',
        [agentId]
      );

      const totalPredictions = predictions.length;
      const resolved = predictions.filter(p => p.outcome !== null);
      const resolvedPredictions = resolved.length;

      // Calculate Brier score
      let brierSum = 0;
      let correctPredictions = 0;
      let streakCurrent = 0;
      let streakBest = 0;
      let currentStreak = 0;

      // Category tracking
      const categoryStats: Record<string, { sum: number; count: number }> = {};

      for (const p of resolved) {
        const brier = p.brier_contribution ?? Math.pow(p.probability - p.outcome!, 2);
        brierSum += brier;

        // Correct if prediction aligned with outcome (>50% when YES, <50% when NO)
        const predictedYes = p.probability >= 0.5;
        const actualYes = p.outcome === 1;
        const isCorrect = predictedYes === actualYes;

        if (isCorrect) {
          correctPredictions++;
          currentStreak++;
          if (currentStreak > streakBest) {
            streakBest = currentStreak;
          }
        } else {
          currentStreak = 0;
        }

        // Track by category
        const cat = p.market_category || 'other';
        if (!categoryStats[cat]) {
          categoryStats[cat] = { sum: 0, count: 0 };
        }
        categoryStats[cat].sum += brier;
        categoryStats[cat].count++;
      }

      streakCurrent = currentStreak;

      const brierScore = resolvedPredictions > 0 ? brierSum / resolvedPredictions : undefined;
      const accuracy = resolvedPredictions > 0 ? correctPredictions / resolvedPredictions : undefined;

      // Find best/worst category
      let bestCategory: string | undefined;
      let worstCategory: string | undefined;
      let bestBrier = Infinity;
      let worstBrier = -Infinity;

      for (const [cat, stats] of Object.entries(categoryStats)) {
        if (stats.count >= 3) { // Minimum 3 predictions to count
          const avgBrier = stats.sum / stats.count;
          if (avgBrier < bestBrier) {
            bestBrier = avgBrier;
            bestCategory = cat;
          }
          if (avgBrier > worstBrier) {
            worstBrier = avgBrier;
            worstCategory = cat;
          }
        }
      }

      // Upsert stats
      database.run(
        `INSERT INTO acp_prediction_stats
         (agent_id, total_predictions, resolved_predictions, correct_predictions,
          brier_score, brier_sum, accuracy, best_category, worst_category,
          streak_current, streak_best, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET
           total_predictions = excluded.total_predictions,
           resolved_predictions = excluded.resolved_predictions,
           correct_predictions = excluded.correct_predictions,
           brier_score = excluded.brier_score,
           brier_sum = excluded.brier_sum,
           accuracy = excluded.accuracy,
           best_category = excluded.best_category,
           worst_category = excluded.worst_category,
           streak_current = excluded.streak_current,
           streak_best = excluded.streak_best,
           updated_at = excluded.updated_at`,
        [agentId, totalPredictions, resolvedPredictions, correctPredictions,
         brierScore ?? null, brierSum, accuracy ?? null, bestCategory || null, worstCategory || null,
         streakCurrent, streakBest, now]
      );

      return {
        agentId,
        totalPredictions,
        resolvedPredictions,
        correctPredictions,
        brierScore,
        brierSum,
        accuracy,
        bestCategory,
        worstCategory,
        streakCurrent,
        streakBest,
        updatedAt: now,
      };
    },

    async getLeaderboard(limit = 20): Promise<Array<PredictionStats & { handle?: string }>> {
      const database = getDb();

      // Only include agents with at least 5 resolved predictions
      const rows = database.query<StatsRow & { handle?: string }>(
        `SELECT s.*, h.handle
         FROM acp_prediction_stats s
         LEFT JOIN acp_handles h ON s.agent_id = h.agent_id
         WHERE s.resolved_predictions >= 5
         ORDER BY s.brier_score ASC
         LIMIT ?`,
        [limit]
      );

      return rows.map(row => ({
        ...rowToStats(row),
        handle: row.handle || undefined,
      }));
    },
  };
}

// =============================================================================
// ROW TYPES & CONVERTERS
// =============================================================================

interface PredictionRow {
  id: string;
  agent_id: string;
  market_slug: string;
  market_title: string;
  market_category: string | null;
  probability: number;
  rationale: string;
  outcome: number | null;
  brier_contribution: number | null;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
}

interface StatsRow {
  agent_id: string;
  total_predictions: number;
  resolved_predictions: number;
  correct_predictions: number;
  brier_score: number | null;
  brier_sum: number;
  accuracy: number | null;
  best_category: string | null;
  worst_category: string | null;
  streak_current: number;
  streak_best: number;
  updated_at: number;
}

function rowToPrediction(row: PredictionRow): Prediction {
  return {
    id: row.id,
    agentId: row.agent_id,
    marketSlug: row.market_slug,
    marketTitle: row.market_title,
    marketCategory: row.market_category || undefined,
    probability: row.probability,
    rationale: row.rationale,
    outcome: row.outcome ?? undefined,
    brierContribution: row.brier_contribution ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToStats(row: StatsRow): PredictionStats {
  return {
    agentId: row.agent_id,
    totalPredictions: row.total_predictions,
    resolvedPredictions: row.resolved_predictions,
    correctPredictions: row.correct_predictions,
    brierScore: row.brier_score ?? undefined,
    brierSum: row.brier_sum,
    accuracy: row.accuracy ?? undefined,
    bestCategory: row.best_category || undefined,
    worstCategory: row.worst_category || undefined,
    streakCurrent: row.streak_current,
    streakBest: row.streak_best,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// SINGLETON
// =============================================================================

let predictionService: PredictionService | null = null;

export function getPredictionService(): PredictionService {
  if (!predictionService) {
    predictionService = createPredictionService();
  }
  return predictionService;
}

// =============================================================================
// BRIER SCORE UTILITIES
// =============================================================================

/**
 * Calculate Brier score for a single prediction
 * BS = (probability - outcome)²
 *
 * @param probability - Predicted probability (0 to 1)
 * @param outcome - Actual outcome (0 or 1)
 * @returns Brier score contribution (0 = perfect, 1 = worst)
 */
export function calculateBrierContribution(probability: number, outcome: 0 | 1): number {
  return Math.pow(probability - outcome, 2);
}

/**
 * Interpret a Brier score
 *
 * @param score - Average Brier score
 * @returns Human-readable interpretation
 */
export function interpretBrierScore(score: number): string {
  if (score < 0.1) return 'Excellent (near-perfect calibration)';
  if (score < 0.15) return 'Very Good';
  if (score < 0.2) return 'Good';
  if (score < 0.25) return 'Average (random guessing = 0.25)';
  if (score < 0.3) return 'Below Average';
  if (score < 0.4) return 'Poor';
  return 'Very Poor';
}
