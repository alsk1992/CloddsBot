/**
 * DCA Order Persistence - Database persistence for DCA orders
 *
 * Follows the same pattern as order-persistence.ts.
 * Self-creates table on init.
 */

import type { Database } from '../db/index.js';
import { logger } from '../utils/logger.js';

let db: Database | null = null;

export function initDCAPersistence(database: Database): void {
  db = database;
  ensureTable();
  logger.info('DCA persistence initialized');
}

function getDb(): Database {
  if (!db) throw new Error('DCA persistence not initialized. Call initDCAPersistence first.');
  return db;
}

// =============================================================================
// TYPES
// =============================================================================

export interface PersistedDCAOrder {
  id: string;
  userId: string;
  platform: string;
  marketId: string;
  tokenId?: string;
  outcome?: string;
  side: 'buy' | 'sell';
  price: number;
  totalAmount: number;
  amountPerCycle: number;
  cycleIntervalMs: number;
  maxPrice?: number;
  maxCycles?: number;
  negRisk?: boolean;
  // Progress
  investedAmount: number;
  totalShares: number;
  totalCost: number;
  cyclesCompleted: number;
  status: 'pending' | 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  nextCycleAtMs?: number;
  startedAt?: number;
  createdAt: number;
  updatedAt: number;
  extraConfig?: Record<string, any>;
}

// =============================================================================
// TABLE
// =============================================================================

function ensureTable(): void {
  const database = getDb();

  database.run(`
    CREATE TABLE IF NOT EXISTS dca_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      market_id TEXT NOT NULL,
      token_id TEXT,
      outcome TEXT,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      total_amount REAL NOT NULL,
      amount_per_cycle REAL NOT NULL,
      cycle_interval_ms INTEGER NOT NULL,
      max_price REAL,
      max_cycles INTEGER,
      neg_risk INTEGER,
      invested_amount REAL NOT NULL DEFAULT 0,
      total_shares REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      cycles_completed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      next_cycle_at_ms INTEGER,
      started_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      extra_config TEXT
    );
  `);

  // Migration: add extra_config column if missing (existing DBs)
  try {
    database.run('ALTER TABLE dca_orders ADD COLUMN extra_config TEXT');
  } catch { /* column already exists */ }

  database.run('CREATE INDEX IF NOT EXISTS idx_dca_orders_user ON dca_orders(user_id);');
  database.run('CREATE INDEX IF NOT EXISTS idx_dca_orders_status ON dca_orders(status);');
  database.run('CREATE INDEX IF NOT EXISTS idx_dca_orders_active ON dca_orders(status) WHERE status IN ("pending", "active");');

  logger.debug('DCA persistence table initialized');
}

// =============================================================================
// CRUD
// =============================================================================

export function saveDCAOrder(order: PersistedDCAOrder): void {
  const d = getDb();
  d.run(
    `INSERT OR REPLACE INTO dca_orders (
      id, user_id, platform, market_id, token_id, outcome, side, price,
      total_amount, amount_per_cycle, cycle_interval_ms, max_price, max_cycles,
      neg_risk, invested_amount, total_shares, total_cost, cycles_completed,
      status, next_cycle_at_ms, started_at, created_at, updated_at, extra_config
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      order.id, order.userId, order.platform, order.marketId,
      order.tokenId ?? null, order.outcome ?? null, order.side, order.price,
      order.totalAmount, order.amountPerCycle, order.cycleIntervalMs,
      order.maxPrice ?? null, order.maxCycles ?? null,
      order.negRisk ? 1 : 0,
      order.investedAmount, order.totalShares, order.totalCost, order.cyclesCompleted,
      order.status, order.nextCycleAtMs ?? null, order.startedAt ?? null,
      order.createdAt, order.updatedAt,
      order.extraConfig ? JSON.stringify(order.extraConfig) : null,
    ]
  );
}

export function updateDCAProgress(
  orderId: string,
  progress: {
    investedAmount: number;
    totalShares: number;
    totalCost: number;
    cyclesCompleted: number;
    status: PersistedDCAOrder['status'];
    nextCycleAtMs?: number;
    startedAt?: number;
  }
): void {
  const d = getDb();
  d.run(
    `UPDATE dca_orders SET
      invested_amount = ?, total_shares = ?, total_cost = ?,
      cycles_completed = ?, status = ?,
      next_cycle_at_ms = ?, started_at = COALESCE(?, started_at),
      updated_at = ?
    WHERE id = ?`,
    [
      progress.investedAmount, progress.totalShares, progress.totalCost,
      progress.cyclesCompleted, progress.status,
      progress.nextCycleAtMs ?? null, progress.startedAt ?? null,
      Date.now(), orderId,
    ]
  );
}

export function getDCAOrder(orderId: string): PersistedDCAOrder | null {
  const d = getDb();
  const rows = d.query<{
    id: string; user_id: string; platform: string; market_id: string;
    token_id: string | null; outcome: string | null; side: string; price: number;
    total_amount: number; amount_per_cycle: number; cycle_interval_ms: number;
    max_price: number | null; max_cycles: number | null; neg_risk: number;
    invested_amount: number; total_shares: number; total_cost: number;
    cycles_completed: number; status: string; next_cycle_at_ms: number | null;
    started_at: number | null; created_at: number; updated_at: number;
  }>('SELECT * FROM dca_orders WHERE id = ?', [orderId]);

  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

export function getActiveDCAOrders(userId?: string): PersistedDCAOrder[] {
  const d = getDb();
  const sql = userId
    ? 'SELECT * FROM dca_orders WHERE status IN ("pending", "active") AND user_id = ? ORDER BY created_at'
    : 'SELECT * FROM dca_orders WHERE status IN ("pending", "active") ORDER BY created_at';
  const params = userId ? [userId] : [];
  return d.query<any>(sql, params).map(mapRow);
}

export function deleteDCAOrder(orderId: string): void {
  getDb().run('DELETE FROM dca_orders WHERE id = ?', [orderId]);
}

function mapRow(r: any): PersistedDCAOrder {
  let extraConfig: Record<string, any> | undefined;
  if (r.extra_config) {
    try { extraConfig = JSON.parse(r.extra_config); } catch { /* ignore */ }
  }
  return {
    id: r.id,
    userId: r.user_id,
    platform: r.platform,
    marketId: r.market_id,
    tokenId: r.token_id ?? undefined,
    outcome: r.outcome ?? undefined,
    side: r.side as 'buy' | 'sell',
    price: r.price,
    totalAmount: r.total_amount,
    amountPerCycle: r.amount_per_cycle,
    cycleIntervalMs: r.cycle_interval_ms,
    maxPrice: r.max_price ?? undefined,
    maxCycles: r.max_cycles ?? undefined,
    negRisk: r.neg_risk === 1,
    investedAmount: r.invested_amount,
    totalShares: r.total_shares,
    totalCost: r.total_cost,
    cyclesCompleted: r.cycles_completed,
    status: r.status as PersistedDCAOrder['status'],
    nextCycleAtMs: r.next_cycle_at_ms ?? undefined,
    startedAt: r.started_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    extraConfig,
  };
}
