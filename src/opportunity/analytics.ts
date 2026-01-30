/**
 * Opportunity Analytics - Track and analyze opportunity performance
 *
 * Features:
 * - Opportunity discovery tracking
 * - Win/loss recording
 * - Platform pair analysis
 * - Historical performance stats
 * - Pattern detection
 */

import type { Database } from '../db/index';
import type { Platform } from '../types';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface OpportunityRecord {
  id: string;
  type: 'internal' | 'cross_platform' | 'edge';
  markets: string; // JSON string
  edgePct: number;
  profitPer100: number;
  score: number;
  confidence: number;
  totalLiquidity: number;
  status: 'active' | 'taken' | 'expired' | 'closed';
  discoveredAt: Date;
  expiresAt: Date;
  taken: boolean;
  fillPrices?: Record<string, number>;
  realizedPnL?: number;
  closedAt?: Date;
  notes?: string;
}

export interface OpportunityStats {
  totalFound: number;
  taken: number;
  winRate: number;
  totalProfit: number;
  avgEdge: number;
  avgScore: number;
  bestPlatformPair?: {
    platforms: [Platform, Platform];
    winRate: number;
    profit: number;
    count: number;
  };
  byType: Record<string, {
    count: number;
    taken: number;
    winRate: number;
    profit: number;
    avgEdge: number;
  }>;
  byPlatform: Record<Platform, {
    count: number;
    taken: number;
    winRate: number;
    profit: number;
  }>;
}

export interface PlatformPairStats {
  platforms: [Platform, Platform];
  count: number;
  taken: number;
  wins: number;
  totalProfit: number;
  avgEdge: number;
  winRate: number;
}

// =============================================================================
// PERFORMANCE ATTRIBUTION TYPES
// =============================================================================

export interface PerformanceAttribution {
  /** Attribution by edge source */
  byEdgeSource: {
    priceLag: AttributionBucket;      // Edge from stale prices
    liquidityGap: AttributionBucket;  // Edge from liquidity imbalance
    informationEdge: AttributionBucket; // Edge from better info
    unknown: AttributionBucket;
  };
  /** Attribution by time of day (hour UTC) */
  byHour: Record<number, AttributionBucket>;
  /** Attribution by day of week (0=Sunday) */
  byDayOfWeek: Record<number, AttributionBucket>;
  /** Attribution by edge size bucket */
  byEdgeBucket: {
    tiny: AttributionBucket;    // < 1%
    small: AttributionBucket;   // 1-2%
    medium: AttributionBucket;  // 2-5%
    large: AttributionBucket;   // 5-10%
    huge: AttributionBucket;    // > 10%
  };
  /** Attribution by liquidity bucket */
  byLiquidityBucket: {
    low: AttributionBucket;     // < $500
    medium: AttributionBucket;  // $500 - $5000
    high: AttributionBucket;    // > $5000
  };
  /** Attribution by confidence bucket */
  byConfidenceBucket: {
    low: AttributionBucket;     // < 0.7
    medium: AttributionBucket;  // 0.7 - 0.9
    high: AttributionBucket;    // > 0.9
  };
  /** Execution quality metrics */
  executionQuality: {
    avgSlippagePct: number;
    avgExecutionTimeMs: number;
    fillRatePct: number;
    partialFills: number;
  };
  /** Edge decay analysis */
  edgeDecay: {
    avgLifespanMs: number;
    medianLifespanMs: number;
    decayByMinute: Record<number, number>; // Remaining edge by minute
  };
}

export interface AttributionBucket {
  count: number;
  taken: number;
  wins: number;
  losses: number;
  totalPnL: number;
  avgPnL: number;
  winRate: number;
  avgEdge: number;
}

export type EdgeSource = 'priceLag' | 'liquidityGap' | 'informationEdge' | 'unknown';

export interface AttributionInput {
  opportunityId: string;
  edgeSource?: EdgeSource;
  discoveredAt: Date;
  executedAt?: Date;
  closedAt?: Date;
  expectedSlippage?: number;
  actualSlippage?: number;
  fillRate?: number;
  executionTimeMs?: number;
}

export interface OpportunityAnalytics {
  /** Record an opportunity discovery */
  recordDiscovery(opportunity: OpportunityInput): void;

  /** Record an opportunity was taken */
  recordTaken(opportunity: OpportunityInput): void;

  /** Record opportunity expiry */
  recordExpiry(opportunity: OpportunityInput): void;

  /** Record final outcome */
  recordOutcome(opportunity: OpportunityInput): void;

  /** Get opportunity by ID */
  getOpportunity(id: string): OpportunityRecord | undefined;

  /** Get stats */
  getStats(options?: { days?: number; platform?: Platform; type?: string }): OpportunityStats;

  /** Get platform pair statistics */
  getPlatformPairs(): PlatformPairStats[];

  /** Get opportunities by filters */
  getOpportunities(filters?: {
    type?: string;
    status?: string;
    platform?: Platform;
    minEdge?: number;
    since?: Date;
    limit?: number;
  }): OpportunityRecord[];

  /** Get best performing strategies */
  getBestStrategies(options?: { days?: number; minSamples?: number }): Array<{
    type: string;
    platformPair?: [Platform, Platform];
    winRate: number;
    avgProfit: number;
    samples: number;
  }>;

  /** Cleanup old records */
  cleanup(olderThanDays?: number): number;

  /** Record attribution data for an opportunity */
  recordAttribution(input: AttributionInput): void;

  /** Get performance attribution analysis */
  getPerformanceAttribution(options?: { days?: number }): PerformanceAttribution;

  /** Classify edge source based on opportunity characteristics */
  classifyEdgeSource(opportunity: OpportunityInput): EdgeSource;

  /** Get edge decay analysis for a specific opportunity type */
  getEdgeDecayAnalysis(options?: { type?: string; days?: number }): {
    avgLifespanMs: number;
    decayCurve: Array<{ minutesSinceDiscovery: number; remainingEdgePct: number }>;
  };
}

interface OpportunityInput {
  id: string;
  type: 'internal' | 'cross_platform' | 'edge';
  markets: Array<{
    platform: Platform;
    marketId: string;
    [key: string]: unknown;
  }>;
  edgePct: number;
  profitPer100: number;
  score: number;
  confidence: number;
  totalLiquidity: number;
  status: 'active' | 'taken' | 'expired' | 'closed';
  discoveredAt: Date;
  expiresAt: Date;
  outcome?: {
    taken: boolean;
    fillPrices?: Record<string, number>;
    realizedPnL?: number;
    closedAt?: Date;
    notes?: string;
  };
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createOpportunityAnalytics(db: Database): OpportunityAnalytics {
  function recordDiscovery(opportunity: OpportunityInput): void {
    try {
      db.run(
        `INSERT OR REPLACE INTO opportunities
         (id, type, markets, edge_pct, profit_per_100, score, confidence,
          total_liquidity, status, discovered_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          opportunity.id,
          opportunity.type,
          JSON.stringify(opportunity.markets),
          opportunity.edgePct,
          opportunity.profitPer100,
          opportunity.score,
          opportunity.confidence,
          opportunity.totalLiquidity,
          'active',
          opportunity.discoveredAt.getTime(),
          opportunity.expiresAt.getTime(),
        ]
      );

      // Update platform pair stats
      updatePlatformPairStats(opportunity, 'discovery');
    } catch (error) {
      logger.warn({ error, id: opportunity.id }, 'Failed to record discovery');
    }
  }

  function recordTaken(opportunity: OpportunityInput): void {
    try {
      const fillPrices = opportunity.outcome?.fillPrices
        ? JSON.stringify(opportunity.outcome.fillPrices)
        : null;

      db.run(
        `UPDATE opportunities
         SET status = 'taken', taken = 1, fill_prices = ?
         WHERE id = ?`,
        [fillPrices, opportunity.id]
      );

      // Update platform pair stats
      updatePlatformPairStats(opportunity, 'taken');
    } catch (error) {
      logger.warn({ error, id: opportunity.id }, 'Failed to record taken');
    }
  }

  function recordExpiry(opportunity: OpportunityInput): void {
    try {
      db.run(
        `UPDATE opportunities SET status = 'expired' WHERE id = ?`,
        [opportunity.id]
      );
    } catch (error) {
      logger.warn({ error, id: opportunity.id }, 'Failed to record expiry');
    }
  }

  function recordOutcome(opportunity: OpportunityInput): void {
    try {
      const outcome = opportunity.outcome;
      if (!outcome) return;

      const fillPrices = outcome.fillPrices ? JSON.stringify(outcome.fillPrices) : null;

      db.run(
        `UPDATE opportunities
         SET status = 'closed',
             taken = ?,
             fill_prices = ?,
             realized_pnl = ?,
             closed_at = ?,
             notes = ?
         WHERE id = ?`,
        [
          outcome.taken ? 1 : 0,
          fillPrices,
          outcome.realizedPnL || null,
          outcome.closedAt?.getTime() || Date.now(),
          outcome.notes || null,
          opportunity.id,
        ]
      );

      // Update platform pair stats with outcome
      if (outcome.taken && outcome.realizedPnL !== undefined) {
        updatePlatformPairStats(opportunity, outcome.realizedPnL >= 0 ? 'win' : 'loss', outcome.realizedPnL);
      }
    } catch (error) {
      logger.warn({ error, id: opportunity.id }, 'Failed to record outcome');
    }
  }

  function updatePlatformPairStats(
    opportunity: OpportunityInput,
    event: 'discovery' | 'taken' | 'win' | 'loss',
    profit?: number
  ): void {
    if (opportunity.type !== 'cross_platform' || opportunity.markets.length < 2) {
      return;
    }

    const platforms = opportunity.markets
      .map((m) => m.platform)
      .sort() as [Platform, Platform];

    const [platformA, platformB] = platforms;

    try {
      // Ensure row exists
      db.run(
        `INSERT OR IGNORE INTO platform_pair_stats (platform_a, platform_b)
         VALUES (?, ?)`,
        [platformA, platformB]
      );

      switch (event) {
        case 'discovery':
          db.run(
            `UPDATE platform_pair_stats
             SET total_opportunities = total_opportunities + 1,
                 avg_edge = (avg_edge * total_opportunities + ?) / (total_opportunities + 1),
                 last_updated = ?
             WHERE platform_a = ? AND platform_b = ?`,
            [opportunity.edgePct, Date.now(), platformA, platformB]
          );
          break;

        case 'taken':
          db.run(
            `UPDATE platform_pair_stats
             SET taken = taken + 1, last_updated = ?
             WHERE platform_a = ? AND platform_b = ?`,
            [Date.now(), platformA, platformB]
          );
          break;

        case 'win':
          db.run(
            `UPDATE platform_pair_stats
             SET wins = wins + 1, total_profit = total_profit + ?, last_updated = ?
             WHERE platform_a = ? AND platform_b = ?`,
            [profit || 0, Date.now(), platformA, platformB]
          );
          break;

        case 'loss':
          db.run(
            `UPDATE platform_pair_stats
             SET total_profit = total_profit + ?, last_updated = ?
             WHERE platform_a = ? AND platform_b = ?`,
            [profit || 0, Date.now(), platformA, platformB]
          );
          break;
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to update platform pair stats');
    }
  }

  function getOpportunity(id: string): OpportunityRecord | undefined {
    try {
      const rows = db.query<{
        id: string;
        type: string;
        markets: string;
        edge_pct: number;
        profit_per_100: number;
        score: number;
        confidence: number;
        total_liquidity: number;
        status: string;
        discovered_at: number;
        expires_at: number;
        taken: number;
        fill_prices: string | null;
        realized_pnl: number | null;
        closed_at: number | null;
        notes: string | null;
      }>(
        'SELECT * FROM opportunities WHERE id = ?',
        [id]
      );

      if (rows.length === 0) return undefined;

      const row = rows[0];
      return {
        id: row.id,
        type: row.type as OpportunityRecord['type'],
        markets: row.markets,
        edgePct: row.edge_pct,
        profitPer100: row.profit_per_100,
        score: row.score,
        confidence: row.confidence,
        totalLiquidity: row.total_liquidity,
        status: row.status as OpportunityRecord['status'],
        discoveredAt: new Date(row.discovered_at),
        expiresAt: new Date(row.expires_at),
        taken: row.taken === 1,
        fillPrices: row.fill_prices ? JSON.parse(row.fill_prices) : undefined,
        realizedPnL: row.realized_pnl ?? undefined,
        closedAt: row.closed_at ? new Date(row.closed_at) : undefined,
        notes: row.notes ?? undefined,
      };
    } catch (error) {
      logger.warn({ error, id }, 'Failed to get opportunity');
      return undefined;
    }
  }

  function getStats(options?: {
    days?: number;
    platform?: Platform;
    type?: string;
  }): OpportunityStats {
    const { days = 30, platform, type } = options || {};

    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
      // Build query
      let whereClause = 'WHERE discovered_at > ?';
      const params: unknown[] = [sinceMs];

      if (type) {
        whereClause += ' AND type = ?';
        params.push(type);
      }

      if (platform) {
        whereClause += ' AND markets LIKE ?';
        params.push(`%"platform":"${platform}"%`);
      }

      // Get totals
      const totals = db.query<{
        total: number;
        taken: number;
        wins: number;
        total_profit: number;
        avg_edge: number;
        avg_score: number;
      }>(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN taken = 1 THEN 1 ELSE 0 END) as taken,
           SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) as wins,
           SUM(COALESCE(realized_pnl, 0)) as total_profit,
           AVG(edge_pct) as avg_edge,
           AVG(score) as avg_score
         FROM opportunities ${whereClause}`,
        params
      );

      const total = totals[0] || {
        total: 0,
        taken: 0,
        wins: 0,
        total_profit: 0,
        avg_edge: 0,
        avg_score: 0,
      };

      // Get by type
      const byTypeRows = db.query<{
        type: string;
        count: number;
        taken: number;
        wins: number;
        profit: number;
        avg_edge: number;
      }>(
        `SELECT
           type,
           COUNT(*) as count,
           SUM(CASE WHEN taken = 1 THEN 1 ELSE 0 END) as taken,
           SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) as wins,
           SUM(COALESCE(realized_pnl, 0)) as profit,
           AVG(edge_pct) as avg_edge
         FROM opportunities ${whereClause}
         GROUP BY type`,
        params
      );

      const byType: OpportunityStats['byType'] = {};
      for (const row of byTypeRows) {
        byType[row.type] = {
          count: row.count,
          taken: row.taken,
          winRate: row.taken > 0 ? (row.wins / row.taken) * 100 : 0,
          profit: row.profit,
          avgEdge: row.avg_edge,
        };
      }

      // Get by platform (approximate from JSON)
      const byPlatform: OpportunityStats['byPlatform'] = {} as OpportunityStats['byPlatform'];

      // Get best platform pair
      const pairRows = db.query<{
        platform_a: string;
        platform_b: string;
        total_opportunities: number;
        taken: number;
        wins: number;
        total_profit: number;
      }>(
        `SELECT * FROM platform_pair_stats
         WHERE taken > 0
         ORDER BY (CAST(wins AS REAL) / taken) DESC, total_profit DESC
         LIMIT 1`
      );

      let bestPlatformPair: OpportunityStats['bestPlatformPair'];
      if (pairRows.length > 0) {
        const pair = pairRows[0];
        bestPlatformPair = {
          platforms: [pair.platform_a as Platform, pair.platform_b as Platform],
          winRate: pair.taken > 0 ? (pair.wins / pair.taken) * 100 : 0,
          profit: pair.total_profit,
          count: pair.total_opportunities,
        };
      }

      return {
        totalFound: total.total,
        taken: total.taken,
        winRate: total.taken > 0 ? (total.wins / total.taken) * 100 : 0,
        totalProfit: total.total_profit,
        avgEdge: total.avg_edge,
        avgScore: total.avg_score,
        bestPlatformPair,
        byType,
        byPlatform,
      };
    } catch (error) {
      logger.warn({ error }, 'Failed to get stats');
      return {
        totalFound: 0,
        taken: 0,
        winRate: 0,
        totalProfit: 0,
        avgEdge: 0,
        avgScore: 0,
        byType: {},
        byPlatform: {} as OpportunityStats['byPlatform'],
      };
    }
  }

  function getPlatformPairs(): PlatformPairStats[] {
    try {
      const rows = db.query<{
        platform_a: string;
        platform_b: string;
        total_opportunities: number;
        taken: number;
        wins: number;
        total_profit: number;
        avg_edge: number;
      }>(
        `SELECT * FROM platform_pair_stats
         WHERE total_opportunities > 0
         ORDER BY total_opportunities DESC`
      );

      return rows.map((row) => ({
        platforms: [row.platform_a as Platform, row.platform_b as Platform],
        count: row.total_opportunities,
        taken: row.taken,
        wins: row.wins,
        totalProfit: row.total_profit,
        avgEdge: row.avg_edge,
        winRate: row.taken > 0 ? (row.wins / row.taken) * 100 : 0,
      }));
    } catch (error) {
      logger.warn({ error }, 'Failed to get platform pairs');
      return [];
    }
  }

  function getOpportunities(filters?: {
    type?: string;
    status?: string;
    platform?: Platform;
    minEdge?: number;
    since?: Date;
    limit?: number;
  }): OpportunityRecord[] {
    const { type, status, platform, minEdge, since, limit = 100 } = filters || {};

    try {
      let whereClause = 'WHERE 1=1';
      const params: unknown[] = [];

      if (type) {
        whereClause += ' AND type = ?';
        params.push(type);
      }

      if (status) {
        whereClause += ' AND status = ?';
        params.push(status);
      }

      if (platform) {
        whereClause += ' AND markets LIKE ?';
        params.push(`%"platform":"${platform}"%`);
      }

      if (minEdge !== undefined) {
        whereClause += ' AND edge_pct >= ?';
        params.push(minEdge);
      }

      if (since) {
        whereClause += ' AND discovered_at >= ?';
        params.push(since.getTime());
      }

      params.push(limit);

      const rows = db.query<{
        id: string;
        type: string;
        markets: string;
        edge_pct: number;
        profit_per_100: number;
        score: number;
        confidence: number;
        total_liquidity: number;
        status: string;
        discovered_at: number;
        expires_at: number;
        taken: number;
        fill_prices: string | null;
        realized_pnl: number | null;
        closed_at: number | null;
        notes: string | null;
      }>(
        `SELECT * FROM opportunities ${whereClause}
         ORDER BY discovered_at DESC LIMIT ?`,
        params
      );

      return rows.map((row) => ({
        id: row.id,
        type: row.type as OpportunityRecord['type'],
        markets: row.markets,
        edgePct: row.edge_pct,
        profitPer100: row.profit_per_100,
        score: row.score,
        confidence: row.confidence,
        totalLiquidity: row.total_liquidity,
        status: row.status as OpportunityRecord['status'],
        discoveredAt: new Date(row.discovered_at),
        expiresAt: new Date(row.expires_at),
        taken: row.taken === 1,
        fillPrices: row.fill_prices ? JSON.parse(row.fill_prices) : undefined,
        realizedPnL: row.realized_pnl ?? undefined,
        closedAt: row.closed_at ? new Date(row.closed_at) : undefined,
        notes: row.notes ?? undefined,
      }));
    } catch (error) {
      logger.warn({ error }, 'Failed to get opportunities');
      return [];
    }
  }

  function getBestStrategies(options?: {
    days?: number;
    minSamples?: number;
  }): Array<{
    type: string;
    platformPair?: [Platform, Platform];
    winRate: number;
    avgProfit: number;
    samples: number;
  }> {
    const { days = 30, minSamples = 5 } = options || {};
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
      // Get by type
      const byType = db.query<{
        type: string;
        samples: number;
        wins: number;
        avg_profit: number;
      }>(
        `SELECT
           type,
           COUNT(*) as samples,
           SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) as wins,
           AVG(COALESCE(realized_pnl, 0)) as avg_profit
         FROM opportunities
         WHERE taken = 1 AND discovered_at > ? AND status = 'closed'
         GROUP BY type
         HAVING COUNT(*) >= ?
         ORDER BY (CAST(wins AS REAL) / COUNT(*)) DESC`,
        [sinceMs, minSamples]
      );

      const results: Array<{
        type: string;
        platformPair?: [Platform, Platform];
        winRate: number;
        avgProfit: number;
        samples: number;
      }> = byType.map((row) => ({
        type: row.type,
        winRate: row.samples > 0 ? (row.wins / row.samples) * 100 : 0,
        avgProfit: row.avg_profit,
        samples: row.samples,
      }));

      // Add platform pairs
      const pairs = db.query<{
        platform_a: string;
        platform_b: string;
        taken: number;
        wins: number;
        total_profit: number;
      }>(
        `SELECT * FROM platform_pair_stats
         WHERE taken >= ?
         ORDER BY (CAST(wins AS REAL) / taken) DESC`,
        [minSamples]
      );

      for (const pair of pairs) {
        results.push({
          type: 'cross_platform',
          platformPair: [pair.platform_a as Platform, pair.platform_b as Platform],
          winRate: pair.taken > 0 ? (pair.wins / pair.taken) * 100 : 0,
          avgProfit: pair.taken > 0 ? pair.total_profit / pair.taken : 0,
          samples: pair.taken,
        });
      }

      return results.sort((a, b) => b.winRate - a.winRate);
    } catch (error) {
      logger.warn({ error }, 'Failed to get best strategies');
      return [];
    }
  }

  function cleanup(olderThanDays = 90): number {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    try {
      // Count before deletion
      const before = db.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM opportunities WHERE discovered_at < ? AND status IN ('expired', 'closed')`,
        [cutoff]
      );
      const toDelete = before[0]?.count || 0;

      db.run(
        `DELETE FROM opportunities WHERE discovered_at < ? AND status IN ('expired', 'closed')`,
        [cutoff]
      );

      logger.info({ deleted: toDelete, olderThanDays }, 'Cleaned up old opportunities');
      return toDelete;
    } catch (error) {
      logger.warn({ error }, 'Failed to cleanup opportunities');
      return 0;
    }
  }

  // ===========================================================================
  // PERFORMANCE ATTRIBUTION
  // ===========================================================================

  function recordAttribution(input: AttributionInput): void {
    try {
      db.run(
        `INSERT OR REPLACE INTO opportunity_attribution
         (opportunity_id, edge_source, discovered_at, executed_at, closed_at,
          expected_slippage, actual_slippage, fill_rate, execution_time_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.opportunityId,
          input.edgeSource || 'unknown',
          input.discoveredAt.getTime(),
          input.executedAt?.getTime() || null,
          input.closedAt?.getTime() || null,
          input.expectedSlippage || null,
          input.actualSlippage || null,
          input.fillRate || null,
          input.executionTimeMs || null,
        ]
      );
    } catch (error) {
      logger.warn({ error, id: input.opportunityId }, 'Failed to record attribution');
    }
  }

  function classifyEdgeSource(opportunity: OpportunityInput): EdgeSource {
    // Classify based on opportunity characteristics
    const markets = opportunity.markets;
    if (markets.length < 2) return 'unknown';

    // Check for price lag (large time difference between platform updates)
    // This would require price timestamp data - simplified heuristic here

    // Check for liquidity gap (one platform has much more liquidity)
    // Would need liquidity data per leg

    // For now, use edge magnitude as a heuristic
    if (opportunity.edgePct > 5) {
      // Large edges often come from price lag
      return 'priceLag';
    } else if (opportunity.edgePct > 2) {
      // Medium edges often from liquidity gaps
      return 'liquidityGap';
    } else if (opportunity.confidence > 0.9) {
      // High confidence small edges might be information advantage
      return 'informationEdge';
    }

    return 'unknown';
  }

  function createEmptyBucket(): AttributionBucket {
    return {
      count: 0,
      taken: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0,
      avgPnL: 0,
      winRate: 0,
      avgEdge: 0,
    };
  }

  function getPerformanceAttribution(options?: { days?: number }): PerformanceAttribution {
    const { days = 30 } = options || {};
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

    // Initialize attribution structure
    const attribution: PerformanceAttribution = {
      byEdgeSource: {
        priceLag: createEmptyBucket(),
        liquidityGap: createEmptyBucket(),
        informationEdge: createEmptyBucket(),
        unknown: createEmptyBucket(),
      },
      byHour: {},
      byDayOfWeek: {},
      byEdgeBucket: {
        tiny: createEmptyBucket(),
        small: createEmptyBucket(),
        medium: createEmptyBucket(),
        large: createEmptyBucket(),
        huge: createEmptyBucket(),
      },
      byLiquidityBucket: {
        low: createEmptyBucket(),
        medium: createEmptyBucket(),
        high: createEmptyBucket(),
      },
      byConfidenceBucket: {
        low: createEmptyBucket(),
        medium: createEmptyBucket(),
        high: createEmptyBucket(),
      },
      executionQuality: {
        avgSlippagePct: 0,
        avgExecutionTimeMs: 0,
        fillRatePct: 100,
        partialFills: 0,
      },
      edgeDecay: {
        avgLifespanMs: 0,
        medianLifespanMs: 0,
        decayByMinute: {},
      },
    };

    // Initialize hour and day buckets
    for (let h = 0; h < 24; h++) {
      attribution.byHour[h] = createEmptyBucket();
    }
    for (let d = 0; d < 7; d++) {
      attribution.byDayOfWeek[d] = createEmptyBucket();
    }

    try {
      // Get all opportunities with outcomes
      const rows = db.query<{
        id: string;
        type: string;
        edge_pct: number;
        confidence: number;
        total_liquidity: number;
        discovered_at: number;
        taken: number;
        realized_pnl: number | null;
        closed_at: number | null;
      }>(
        `SELECT id, type, edge_pct, confidence, total_liquidity,
                discovered_at, taken, realized_pnl, closed_at
         FROM opportunities
         WHERE discovered_at > ? AND status = 'closed'`,
        [sinceMs]
      );

      // Get attribution data
      const attrRows = db.query<{
        opportunity_id: string;
        edge_source: string;
        expected_slippage: number | null;
        actual_slippage: number | null;
        fill_rate: number | null;
        execution_time_ms: number | null;
      }>(
        `SELECT * FROM opportunity_attribution WHERE opportunity_id IN (
           SELECT id FROM opportunities WHERE discovered_at > ?
         )`,
        [sinceMs]
      );

      const attrMap = new Map(attrRows.map((r) => [r.opportunity_id, r]));

      // Process each opportunity
      let totalSlippage = 0;
      let totalExecTime = 0;
      let execCount = 0;
      const lifespans: number[] = [];

      for (const row of rows) {
        const discoveredDate = new Date(row.discovered_at);
        const hour = discoveredDate.getUTCHours();
        const dayOfWeek = discoveredDate.getUTCDay();
        const pnl = row.realized_pnl || 0;
        const isWin = pnl > 0;
        const isTaken = row.taken === 1;

        // Get edge bucket
        let edgeBucket: keyof typeof attribution.byEdgeBucket;
        if (row.edge_pct < 1) edgeBucket = 'tiny';
        else if (row.edge_pct < 2) edgeBucket = 'small';
        else if (row.edge_pct < 5) edgeBucket = 'medium';
        else if (row.edge_pct < 10) edgeBucket = 'large';
        else edgeBucket = 'huge';

        // Get liquidity bucket
        let liquidityBucket: keyof typeof attribution.byLiquidityBucket;
        if (row.total_liquidity < 500) liquidityBucket = 'low';
        else if (row.total_liquidity < 5000) liquidityBucket = 'medium';
        else liquidityBucket = 'high';

        // Get confidence bucket
        let confidenceBucket: keyof typeof attribution.byConfidenceBucket;
        if (row.confidence < 0.7) confidenceBucket = 'low';
        else if (row.confidence < 0.9) confidenceBucket = 'medium';
        else confidenceBucket = 'high';

        // Get edge source
        const attr = attrMap.get(row.id);
        const edgeSource = (attr?.edge_source || 'unknown') as EdgeSource;

        // Update buckets helper
        const updateBucket = (bucket: AttributionBucket) => {
          bucket.count++;
          bucket.avgEdge = (bucket.avgEdge * (bucket.count - 1) + row.edge_pct) / bucket.count;
          if (isTaken) {
            bucket.taken++;
            bucket.totalPnL += pnl;
            if (isWin) bucket.wins++;
            else bucket.losses++;
          }
          bucket.avgPnL = bucket.taken > 0 ? bucket.totalPnL / bucket.taken : 0;
          bucket.winRate = bucket.taken > 0 ? (bucket.wins / bucket.taken) * 100 : 0;
        };

        // Update all relevant buckets
        updateBucket(attribution.byEdgeSource[edgeSource]);
        updateBucket(attribution.byHour[hour]);
        updateBucket(attribution.byDayOfWeek[dayOfWeek]);
        updateBucket(attribution.byEdgeBucket[edgeBucket]);
        updateBucket(attribution.byLiquidityBucket[liquidityBucket]);
        updateBucket(attribution.byConfidenceBucket[confidenceBucket]);

        // Execution quality
        if (attr && isTaken) {
          if (attr.actual_slippage !== null) {
            totalSlippage += attr.actual_slippage;
            execCount++;
          }
          if (attr.execution_time_ms !== null) {
            totalExecTime += attr.execution_time_ms;
          }
          if (attr.fill_rate !== null && attr.fill_rate < 100) {
            attribution.executionQuality.partialFills++;
          }
        }

        // Lifespan calculation
        if (row.closed_at) {
          lifespans.push(row.closed_at - row.discovered_at);
        }
      }

      // Finalize execution quality
      if (execCount > 0) {
        attribution.executionQuality.avgSlippagePct = totalSlippage / execCount;
        attribution.executionQuality.avgExecutionTimeMs = totalExecTime / execCount;
      }

      // Calculate lifespan stats
      if (lifespans.length > 0) {
        lifespans.sort((a, b) => a - b);
        attribution.edgeDecay.avgLifespanMs =
          lifespans.reduce((a, b) => a + b, 0) / lifespans.length;
        attribution.edgeDecay.medianLifespanMs =
          lifespans[Math.floor(lifespans.length / 2)];
      }

      return attribution;
    } catch (error) {
      logger.warn({ error }, 'Failed to get performance attribution');
      return attribution;
    }
  }

  function getEdgeDecayAnalysis(options?: {
    type?: string;
    days?: number;
  }): {
    avgLifespanMs: number;
    decayCurve: Array<{ minutesSinceDiscovery: number; remainingEdgePct: number }>;
  } {
    const { type, days = 30 } = options || {};
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
      let whereClause = 'WHERE discovered_at > ? AND status IN (?, ?)';
      const params: unknown[] = [sinceMs, 'closed', 'expired'];

      if (type) {
        whereClause += ' AND type = ?';
        params.push(type);
      }

      const rows = db.query<{
        discovered_at: number;
        expires_at: number;
        closed_at: number | null;
        edge_pct: number;
      }>(
        `SELECT discovered_at, expires_at, closed_at, edge_pct
         FROM opportunities ${whereClause}`,
        params
      );

      if (rows.length === 0) {
        return { avgLifespanMs: 0, decayCurve: [] };
      }

      const lifespans: number[] = [];
      const edgeByMinute: Record<number, number[]> = {};

      for (const row of rows) {
        const lifespan = (row.closed_at || row.expires_at) - row.discovered_at;
        lifespans.push(lifespan);

        // Build decay curve (simplified - assume linear decay)
        const lifespanMinutes = Math.ceil(lifespan / 60000);
        for (let m = 0; m <= lifespanMinutes && m <= 60; m++) {
          if (!edgeByMinute[m]) edgeByMinute[m] = [];
          // Assume edge decays linearly to 0 at expiry
          const remainingPct = Math.max(0, (1 - m / lifespanMinutes) * row.edge_pct);
          edgeByMinute[m].push(remainingPct);
        }
      }

      const avgLifespanMs = lifespans.reduce((a, b) => a + b, 0) / lifespans.length;

      const decayCurve: Array<{ minutesSinceDiscovery: number; remainingEdgePct: number }> = [];
      for (const [minute, edges] of Object.entries(edgeByMinute)) {
        const avgEdge = edges.reduce((a, b) => a + b, 0) / edges.length;
        decayCurve.push({
          minutesSinceDiscovery: parseInt(minute),
          remainingEdgePct: avgEdge,
        });
      }

      decayCurve.sort((a, b) => a.minutesSinceDiscovery - b.minutesSinceDiscovery);

      return { avgLifespanMs, decayCurve };
    } catch (error) {
      logger.warn({ error }, 'Failed to get edge decay analysis');
      return { avgLifespanMs: 0, decayCurve: [] };
    }
  }

  return {
    recordDiscovery,
    recordTaken,
    recordExpiry,
    recordOutcome,
    getOpportunity,
    getStats,
    getPlatformPairs,
    getOpportunities,
    getBestStrategies,
    cleanup,
    recordAttribution,
    getPerformanceAttribution,
    classifyEdgeSource,
    getEdgeDecayAnalysis,
  };
}
