/**
 * Trade Ledger - Database Storage
 *
 * Persistence layer for decision records.
 */

import { randomUUID } from 'crypto';
import type {
  DecisionRecord,
  DecisionOutcomeData,
  ListDecisionsOptions,
  LedgerStats,
  ConfidenceCalibration,
  ConfidenceBucket,
  DecisionBreakdown,
  DecisionCategory,
  StatsOptions,
} from './types';
import { hashDecision } from './hash';

// Database interface (matches Clodds db pattern)
export interface LedgerDb {
  run(sql: string, params?: unknown[]): void;
  get<T>(sql: string, params?: unknown[]): T | undefined;
  all<T>(sql: string, params?: unknown[]): T[];
}

// =============================================================================
// SCHEMA
// =============================================================================

export const LEDGER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS trade_ledger (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    timestamp INTEGER NOT NULL,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    platform TEXT,
    market_id TEXT,
    inputs TEXT,
    analysis TEXT,
    constraints TEXT,
    confidence INTEGER,
    decision TEXT NOT NULL,
    reason TEXT,
    outcome TEXT,
    pnl REAL,
    accurate INTEGER,
    hash TEXT,
    anchor_tx TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_ledger_user_timestamp ON trade_ledger(user_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_ledger_category ON trade_ledger(category);
  CREATE INDEX IF NOT EXISTS idx_ledger_decision ON trade_ledger(decision);

  CREATE TABLE IF NOT EXISTS ledger_constraints (
    id TEXT PRIMARY KEY,
    ledger_id TEXT NOT NULL,
    type TEXT NOT NULL,
    rule TEXT NOT NULL,
    threshold REAL,
    actual REAL,
    passed INTEGER NOT NULL,
    violation TEXT,
    metadata TEXT,
    FOREIGN KEY (ledger_id) REFERENCES trade_ledger(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_constraints_ledger ON ledger_constraints(ledger_id);
`;

// =============================================================================
// STORAGE CLASS
// =============================================================================

export class LedgerStorage {
  constructor(private db: LedgerDb) {}

  /**
   * Initialize schema
   */
  init(): void {
    const statements = LEDGER_SCHEMA.split(';').filter((s) => s.trim());
    for (const stmt of statements) {
      this.db.run(stmt);
    }
  }

  /**
   * Capture a new decision
   */
  capture(
    record: Omit<DecisionRecord, 'id' | 'timestamp' | 'hash'>,
    options?: { hashIntegrity?: boolean }
  ): string {
    const id = randomUUID();
    const timestamp = Date.now();
    const hash = options?.hashIntegrity ? hashDecision({ ...record, timestamp }) : undefined;

    this.db.run(
      `INSERT INTO trade_ledger
       (id, user_id, session_id, timestamp, category, action, platform, market_id,
        inputs, analysis, constraints, confidence, decision, reason, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.userId,
        record.sessionId || null,
        timestamp,
        record.category,
        record.action,
        record.platform || null,
        record.marketId || null,
        JSON.stringify(record.inputs),
        record.analysis ? JSON.stringify(record.analysis) : null,
        JSON.stringify(record.constraints),
        record.confidence ?? null,
        record.decision,
        record.reason,
        hash || null,
      ]
    );

    // Insert constraint details
    for (const constraint of record.constraints) {
      this.db.run(
        `INSERT INTO ledger_constraints
         (id, ledger_id, type, rule, threshold, actual, passed, violation, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          id,
          constraint.type,
          constraint.rule,
          constraint.threshold ?? null,
          constraint.actual ?? null,
          constraint.passed ? 1 : 0,
          constraint.violation || null,
          constraint.metadata ? JSON.stringify(constraint.metadata) : null,
        ]
      );
    }

    return id;
  }

  /**
   * Update with outcome after execution
   */
  updateOutcome(id: string, outcome: DecisionOutcomeData): void {
    const pnl = outcome.pnl ?? null;
    const accurate = outcome.success !== undefined ? (outcome.success ? 1 : 0) : null;

    this.db.run(
      `UPDATE trade_ledger SET outcome = ?, pnl = ?, accurate = ? WHERE id = ?`,
      [JSON.stringify(outcome), pnl, accurate, id]
    );
  }

  /**
   * Get a single decision by ID
   */
  get(id: string): DecisionRecord | null {
    const row = this.db.get<{
      id: string;
      user_id: string;
      session_id: string | null;
      timestamp: number;
      category: string;
      action: string;
      platform: string | null;
      market_id: string | null;
      inputs: string;
      analysis: string | null;
      constraints: string;
      confidence: number | null;
      decision: string;
      reason: string;
      outcome: string | null;
      pnl: number | null;
      accurate: number | null;
      hash: string | null;
      anchor_tx: string | null;
    }>(`SELECT * FROM trade_ledger WHERE id = ?`, [id]);

    if (!row) return null;

    return this.rowToRecord(row);
  }

  /**
   * List decisions for a user
   */
  list(userId: string, options: ListDecisionsOptions = {}): DecisionRecord[] {
    const { limit = 50, offset = 0, category, decision, platform, startTime, endTime } = options;

    let sql = `SELECT * FROM trade_ledger WHERE user_id = ?`;
    const params: unknown[] = [userId];

    if (category) {
      sql += ` AND category = ?`;
      params.push(category);
    }
    if (decision) {
      sql += ` AND decision = ?`;
      params.push(decision);
    }
    if (platform) {
      sql += ` AND platform = ?`;
      params.push(platform);
    }
    if (startTime) {
      sql += ` AND timestamp >= ?`;
      params.push(startTime);
    }
    if (endTime) {
      sql += ` AND timestamp <= ?`;
      params.push(endTime);
    }

    sql += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.all<{
      id: string;
      user_id: string;
      session_id: string | null;
      timestamp: number;
      category: string;
      action: string;
      platform: string | null;
      market_id: string | null;
      inputs: string;
      analysis: string | null;
      constraints: string;
      confidence: number | null;
      decision: string;
      reason: string;
      outcome: string | null;
      pnl: number | null;
      accurate: number | null;
      hash: string | null;
      anchor_tx: string | null;
    }>(sql, params);

    return rows.map((row) => this.rowToRecord(row));
  }

  /**
   * Get statistics for a user
   */
  stats(userId: string, options: StatsOptions = {}): LedgerStats {
    const { period = '7d', category } = options;

    const startTime = this.periodToTimestamp(period);

    let whereClause = `user_id = ? AND timestamp >= ?`;
    const params: unknown[] = [userId, startTime];

    if (category) {
      whereClause += ` AND category = ?`;
      params.push(category);
    }

    // Total count
    const total =
      this.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM trade_ledger WHERE ${whereClause}`, params)
        ?.count || 0;

    // Breakdown by decision
    const breakdownRows = this.db.all<{ decision: string; count: number }>(
      `SELECT decision, COUNT(*) as count FROM trade_ledger WHERE ${whereClause} GROUP BY decision`,
      params
    );
    const breakdown: DecisionBreakdown = {
      approved: 0,
      rejected: 0,
      skipped: 0,
      blocked: 0,
      executed: 0,
      failed: 0,
    };
    for (const row of breakdownRows) {
      if (row.decision in breakdown) {
        breakdown[row.decision as keyof DecisionBreakdown] = row.count;
      }
    }

    // By category
    const categoryRows = this.db.all<{ category: string; count: number }>(
      `SELECT category, COUNT(*) as count FROM trade_ledger WHERE ${whereClause} GROUP BY category`,
      params
    );
    const byCategory: Record<DecisionCategory, number> = {
      trade: 0,
      copy: 0,
      arbitrage: 0,
      opportunity: 0,
      risk: 0,
      tool: 0,
    };
    for (const row of categoryRows) {
      if (row.category in byCategory) {
        byCategory[row.category as DecisionCategory] = row.count;
      }
    }

    // Top block reasons
    const blockReasons = this.db.all<{ reason: string; count: number }>(
      `SELECT reason, COUNT(*) as count FROM trade_ledger
       WHERE ${whereClause} AND decision IN ('rejected', 'blocked', 'skipped')
       GROUP BY reason ORDER BY count DESC LIMIT 10`,
      params
    );

    // Calibration
    const calibration = this.calculateCalibration(userId, startTime);

    // Average confidence
    const avgConf = this.db.get<{ avg: number }>(
      `SELECT AVG(confidence) as avg FROM trade_ledger WHERE ${whereClause} AND confidence IS NOT NULL`,
      params
    );

    // P&L total
    const pnlResult = this.db.get<{ total: number; wins: number; total_with_pnl: number }>(
      `SELECT SUM(pnl) as total,
              SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
              COUNT(*) as total_with_pnl
       FROM trade_ledger WHERE ${whereClause} AND pnl IS NOT NULL`,
      params
    );

    return {
      period,
      totalDecisions: total,
      breakdown,
      byCategory,
      topBlockReasons: blockReasons.map((r) => ({ reason: r.reason, count: r.count })),
      calibration,
      avgConfidence: avgConf?.avg,
      pnlTotal: pnlResult?.total,
      winRate: pnlResult?.total_with_pnl ? ((pnlResult.wins ?? 0) / pnlResult.total_with_pnl) * 100 : undefined,
    };
  }

  /**
   * Get confidence calibration data
   */
  calibration(userId: string): ConfidenceCalibration {
    return this.calculateCalibration(userId, 0);
  }

  /**
   * Prune old records
   */
  prune(retentionDays: number): number {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    // Delete constraints first (foreign key)
    this.db.run(
      `DELETE FROM ledger_constraints WHERE ledger_id IN
       (SELECT id FROM trade_ledger WHERE timestamp < ?)`,
      [cutoff]
    );

    const countResult = this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM trade_ledger WHERE timestamp < ?`,
      [cutoff]
    );
    const count = countResult?.count ?? 0;

    this.db.run(`DELETE FROM trade_ledger WHERE timestamp < ?`, [cutoff]);

    return count;
  }

  /**
   * Export decisions to JSON or CSV
   */
  export(userId: string, format: 'json' | 'csv'): string {
    const records = this.list(userId, { limit: 10000 });

    if (format === 'json') {
      return JSON.stringify(records, null, 2);
    }

    // CSV format
    const headers = [
      'id',
      'timestamp',
      'category',
      'action',
      'platform',
      'decision',
      'reason',
      'confidence',
      'pnl',
      'accurate',
    ];
    const rows = records.map((r) => [
      r.id,
      new Date(r.timestamp).toISOString(),
      r.category,
      r.action,
      r.platform || '',
      r.decision,
      `"${(r.reason || '').replace(/"/g, '""')}"`,
      r.confidence ?? '',
      r.pnl ?? '',
      r.accurate ?? '',
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  // =============================================================================
  // PRIVATE HELPERS
  // =============================================================================

  private rowToRecord(row: {
    id: string;
    user_id: string;
    session_id: string | null;
    timestamp: number;
    category: string;
    action: string;
    platform: string | null;
    market_id: string | null;
    inputs: string;
    analysis: string | null;
    constraints: string;
    confidence: number | null;
    decision: string;
    reason: string;
    outcome: string | null;
    pnl: number | null;
    accurate: number | null;
    hash: string | null;
    anchor_tx: string | null;
  }): DecisionRecord {
    const safeParse = (json: string | null, fallback: unknown = {}): unknown => {
      if (!json) return undefined;
      try { return JSON.parse(json); } catch { return fallback; }
    };

    return {
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id ?? undefined,
      timestamp: row.timestamp,
      category: row.category as DecisionCategory,
      action: row.action,
      platform: row.platform ?? undefined,
      marketId: row.market_id ?? undefined,
      inputs: safeParse(row.inputs, {}) as DecisionRecord['inputs'],
      analysis: safeParse(row.analysis) as DecisionRecord['analysis'],
      constraints: (safeParse(row.constraints, []) ?? []) as DecisionRecord['constraints'],
      confidence: row.confidence ?? undefined,
      decision: row.decision as DecisionRecord['decision'],
      reason: row.reason,
      outcome: safeParse(row.outcome) as DecisionRecord['outcome'],
      pnl: row.pnl ?? undefined,
      accurate: row.accurate !== null ? row.accurate === 1 : undefined,
      hash: row.hash ?? undefined,
      anchorTx: row.anchor_tx ?? undefined,
    };
  }

  private periodToTimestamp(period: string): number {
    const now = Date.now();
    switch (period) {
      case '24h':
        return now - 24 * 60 * 60 * 1000;
      case '7d':
        return now - 7 * 24 * 60 * 60 * 1000;
      case '30d':
        return now - 30 * 24 * 60 * 60 * 1000;
      case '90d':
        return now - 90 * 24 * 60 * 60 * 1000;
      case 'all':
      default:
        return 0;
    }
  }

  private calculateCalibration(userId: string, startTime: number): ConfidenceCalibration {
    const buckets: ConfidenceBucket[] = [
      { range: '0-19', min: 0, max: 19, count: 0, accurate: 0, accuracyRate: 0 },
      { range: '20-39', min: 20, max: 39, count: 0, accurate: 0, accuracyRate: 0 },
      { range: '40-59', min: 40, max: 59, count: 0, accurate: 0, accuracyRate: 0 },
      { range: '60-79', min: 60, max: 79, count: 0, accurate: 0, accuracyRate: 0 },
      { range: '80-100', min: 80, max: 100, count: 0, accurate: 0, accuracyRate: 0 },
    ];

    const rows = this.db.all<{ confidence: number; accurate: number }>(
      `SELECT confidence, accurate FROM trade_ledger
       WHERE user_id = ? AND timestamp >= ? AND confidence IS NOT NULL AND accurate IS NOT NULL`,
      [userId, startTime]
    );

    let totalWithOutcome = 0;
    let totalAccurate = 0;

    for (const row of rows) {
      const bucket = buckets.find((b) => row.confidence >= b.min && row.confidence <= b.max);
      if (bucket) {
        bucket.count++;
        if (row.accurate === 1) {
          bucket.accurate++;
          totalAccurate++;
        }
        totalWithOutcome++;
      }
    }

    // Calculate accuracy rates
    for (const bucket of buckets) {
      bucket.accuracyRate = bucket.count > 0 ? (bucket.accurate / bucket.count) * 100 : 0;
    }

    return {
      buckets,
      overallAccuracy: totalWithOutcome > 0 ? (totalAccurate / totalWithOutcome) * 100 : 0,
      totalWithOutcome,
    };
  }
}
