/**
 * Order Persistence - Database persistence for TWAP and Bracket orders
 *
 * Self-creates tables on init (follows the pattern from migrations.ts comment).
 * Allows TWAP and bracket orders to survive restarts.
 */

import type { Database } from '../db';
import { logger } from '../utils/logger';

// Database instance - must be set before use
let db: Database | null = null;

export function initOrderPersistence(database: Database): void {
  db = database;
  ensureTables();
  logger.info('Order persistence initialized');
}

function getDb(): Database {
  if (!db) {
    throw new Error('Order persistence not initialized. Call initOrderPersistence first.');
  }
  return db;
}

// =============================================================================
// TYPES
// =============================================================================

export interface PersistedTwapOrder {
  id: string;
  userId: string;
  platform: string;
  marketId: string;
  tokenId?: string;
  outcome?: string;
  side: 'buy' | 'sell';
  price: number;
  totalSize: number;
  sliceSize: number;
  intervalMs: number;
  maxDurationMs?: number;
  jitter?: number;
  priceLimit?: number;
  orderType: 'GTC' | 'FOK';
  negRisk?: boolean;
  // Progress tracking
  filledSize: number;
  totalCost: number;
  slicesCompleted: number;
  status: 'pending' | 'executing' | 'completed' | 'cancelled' | 'failed';
  startedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedBracketOrder {
  id: string;
  userId: string;
  platform: string;
  marketId: string;
  tokenId?: string;
  outcome?: string;
  size: number;
  side: 'long' | 'short';
  takeProfitPrice: number;
  stopLossPrice: number;
  takeProfitSizePct: number;
  negRisk?: boolean;
  pollIntervalMs: number;
  // Order IDs
  takeProfitOrderId?: string;
  stopLossOrderId?: string;
  // Status
  status: 'pending' | 'active' | 'take_profit_hit' | 'stop_loss_hit' | 'cancelled' | 'failed';
  filledSide?: 'take_profit' | 'stop_loss';
  fillPrice?: number;
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// TABLE INITIALIZATION
// =============================================================================

function ensureTables(): void {
  const database = getDb();

  database.run(`
    CREATE TABLE IF NOT EXISTS twap_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      market_id TEXT NOT NULL,
      token_id TEXT,
      outcome TEXT,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      total_size REAL NOT NULL,
      slice_size REAL NOT NULL,
      interval_ms INTEGER NOT NULL,
      max_duration_ms INTEGER,
      jitter REAL,
      price_limit REAL,
      order_type TEXT NOT NULL DEFAULT 'GTC',
      neg_risk INTEGER,
      filled_size REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      slices_completed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS bracket_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      market_id TEXT NOT NULL,
      token_id TEXT,
      outcome TEXT,
      size REAL NOT NULL,
      side TEXT NOT NULL,
      take_profit_price REAL NOT NULL,
      stop_loss_price REAL NOT NULL,
      take_profit_size_pct REAL NOT NULL DEFAULT 1,
      neg_risk INTEGER,
      poll_interval_ms INTEGER NOT NULL DEFAULT 2000,
      take_profit_order_id TEXT,
      stop_loss_order_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      filled_side TEXT,
      fill_price REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Indexes for querying active orders
  database.run('CREATE INDEX IF NOT EXISTS idx_twap_orders_user ON twap_orders(user_id);');
  database.run('CREATE INDEX IF NOT EXISTS idx_twap_orders_status ON twap_orders(status);');
  database.run('CREATE INDEX IF NOT EXISTS idx_twap_orders_active ON twap_orders(status) WHERE status IN ("pending", "executing");');
  database.run('CREATE INDEX IF NOT EXISTS idx_bracket_orders_user ON bracket_orders(user_id);');
  database.run('CREATE INDEX IF NOT EXISTS idx_bracket_orders_status ON bracket_orders(status);');
  database.run('CREATE INDEX IF NOT EXISTS idx_bracket_orders_active ON bracket_orders(status) WHERE status IN ("pending", "active");');

  logger.debug('Order persistence tables initialized');
}

// =============================================================================
// TWAP ORDER PERSISTENCE
// =============================================================================

export function saveTwapOrder(order: PersistedTwapOrder): void {
  const db = getDb();
  
  db.run(
    `INSERT OR REPLACE INTO twap_orders (
      id, user_id, platform, market_id, token_id, outcome, side, price,
      total_size, slice_size, interval_ms, max_duration_ms, jitter, price_limit,
      order_type, neg_risk, filled_size, total_cost, slices_completed, status,
      started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      order.id,
      order.userId,
      order.platform,
      order.marketId,
      order.tokenId ?? null,
      order.outcome ?? null,
      order.side,
      order.price,
      order.totalSize,
      order.sliceSize,
      order.intervalMs,
      order.maxDurationMs ?? null,
      order.jitter ?? null,
      order.priceLimit ?? null,
      order.orderType,
      order.negRisk ? 1 : 0,
      order.filledSize,
      order.totalCost,
      order.slicesCompleted,
      order.status,
      order.startedAt ?? null,
      order.createdAt,
      order.updatedAt,
    ]
  );
}

export function updateTwapProgress(
  orderId: string,
  progress: {
    filledSize: number;
    totalCost: number;
    slicesCompleted: number;
    status: PersistedTwapOrder['status'];
    startedAt?: number;
  }
): void {
  const db = getDb();
  
  db.run(
    `UPDATE twap_orders SET
      filled_size = ?,
      total_cost = ?,
      slices_completed = ?,
      status = ?,
      started_at = COALESCE(?, started_at),
      updated_at = ?
    WHERE id = ?`,
    [
      progress.filledSize,
      progress.totalCost,
      progress.slicesCompleted,
      progress.status,
      progress.startedAt ?? null,
      Date.now(),
      orderId,
    ]
  );
}

export function getTwapOrder(orderId: string): PersistedTwapOrder | null {
  const db = getDb();
  
  const rows = db.query<{
    id: string;
    user_id: string;
    platform: string;
    market_id: string;
    token_id: string | null;
    outcome: string | null;
    side: string;
    price: number;
    total_size: number;
    slice_size: number;
    interval_ms: number;
    max_duration_ms: number | null;
    jitter: number | null;
    price_limit: number | null;
    order_type: string;
    neg_risk: number;
    filled_size: number;
    total_cost: number;
    slices_completed: number;
    status: string;
    started_at: number | null;
    created_at: number;
    updated_at: number;
  }>('SELECT * FROM twap_orders WHERE id = ?', [orderId]);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    marketId: row.market_id,
    tokenId: row.token_id ?? undefined,
    outcome: row.outcome ?? undefined,
    side: row.side as 'buy' | 'sell',
    price: row.price,
    totalSize: row.total_size,
    sliceSize: row.slice_size,
    intervalMs: row.interval_ms,
    maxDurationMs: row.max_duration_ms ?? undefined,
    jitter: row.jitter ?? undefined,
    priceLimit: row.price_limit ?? undefined,
    orderType: row.order_type as 'GTC' | 'FOK',
    negRisk: row.neg_risk === 1,
    filledSize: row.filled_size,
    totalCost: row.total_cost,
    slicesCompleted: row.slices_completed,
    status: row.status as PersistedTwapOrder['status'],
    startedAt: row.started_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getActiveTwapOrders(userId?: string): PersistedTwapOrder[] {
  const db = getDb();
  
  const sql = userId
    ? 'SELECT * FROM twap_orders WHERE status IN ("pending", "executing") AND user_id = ?'
    : 'SELECT * FROM twap_orders WHERE status IN ("pending", "executing")';

  const rows = db.query<{
    id: string;
    user_id: string;
    platform: string;
    market_id: string;
    token_id: string | null;
    outcome: string | null;
    side: string;
    price: number;
    total_size: number;
    slice_size: number;
    interval_ms: number;
    max_duration_ms: number | null;
    jitter: number | null;
    price_limit: number | null;
    order_type: string;
    neg_risk: number;
    filled_size: number;
    total_cost: number;
    slices_completed: number;
    status: string;
    started_at: number | null;
    created_at: number;
    updated_at: number;
  }>(sql, userId ? [userId] : []);

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    marketId: row.market_id,
    tokenId: row.token_id ?? undefined,
    outcome: row.outcome ?? undefined,
    side: row.side as 'buy' | 'sell',
    price: row.price,
    totalSize: row.total_size,
    sliceSize: row.slice_size,
    intervalMs: row.interval_ms,
    maxDurationMs: row.max_duration_ms ?? undefined,
    jitter: row.jitter ?? undefined,
    priceLimit: row.price_limit ?? undefined,
    orderType: row.order_type as 'GTC' | 'FOK',
    negRisk: row.neg_risk === 1,
    filledSize: row.filled_size,
    totalCost: row.total_cost,
    slicesCompleted: row.slices_completed,
    status: row.status as PersistedTwapOrder['status'],
    startedAt: row.started_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function deleteTwapOrder(orderId: string): void {
  const db = getDb();
  db.run('DELETE FROM twap_orders WHERE id = ?', [orderId]);
}

// =============================================================================
// BRACKET ORDER PERSISTENCE
// =============================================================================

export function saveBracketOrder(order: PersistedBracketOrder): void {
  const db = getDb();
  
  db.run(
    `INSERT OR REPLACE INTO bracket_orders (
      id, user_id, platform, market_id, token_id, outcome, size, side,
      take_profit_price, stop_loss_price, take_profit_size_pct, neg_risk,
      poll_interval_ms, take_profit_order_id, stop_loss_order_id, status,
      filled_side, fill_price, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      order.id,
      order.userId,
      order.platform,
      order.marketId,
      order.tokenId ?? null,
      order.outcome ?? null,
      order.size,
      order.side,
      order.takeProfitPrice,
      order.stopLossPrice,
      order.takeProfitSizePct,
      order.negRisk ? 1 : 0,
      order.pollIntervalMs,
      order.takeProfitOrderId ?? null,
      order.stopLossOrderId ?? null,
      order.status,
      order.filledSide ?? null,
      order.fillPrice ?? null,
      order.createdAt,
      order.updatedAt,
    ]
  );
}

export function updateBracketStatus(
  orderId: string,
  update: {
    takeProfitOrderId?: string;
    stopLossOrderId?: string;
    status: PersistedBracketOrder['status'];
    filledSide?: 'take_profit' | 'stop_loss';
    fillPrice?: number;
  }
): void {
  const db = getDb();
  
  db.run(
    `UPDATE bracket_orders SET
      take_profit_order_id = COALESCE(?, take_profit_order_id),
      stop_loss_order_id = COALESCE(?, stop_loss_order_id),
      status = ?,
      filled_side = COALESCE(?, filled_side),
      fill_price = COALESCE(?, fill_price),
      updated_at = ?
    WHERE id = ?`,
    [
      update.takeProfitOrderId ?? null,
      update.stopLossOrderId ?? null,
      update.status,
      update.filledSide ?? null,
      update.fillPrice ?? null,
      Date.now(),
      orderId,
    ]
  );
}

export function getBracketOrder(orderId: string): PersistedBracketOrder | null {
  const db = getDb();
  
  const rows = db.query<{
    id: string;
    user_id: string;
    platform: string;
    market_id: string;
    token_id: string | null;
    outcome: string | null;
    size: number;
    side: string;
    take_profit_price: number;
    stop_loss_price: number;
    take_profit_size_pct: number;
    neg_risk: number;
    poll_interval_ms: number;
    take_profit_order_id: string | null;
    stop_loss_order_id: string | null;
    status: string;
    filled_side: string | null;
    fill_price: number | null;
    created_at: number;
    updated_at: number;
  }>('SELECT * FROM bracket_orders WHERE id = ?', [orderId]);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    marketId: row.market_id,
    tokenId: row.token_id ?? undefined,
    outcome: row.outcome ?? undefined,
    size: row.size,
    side: row.side as 'long' | 'short',
    takeProfitPrice: row.take_profit_price,
    stopLossPrice: row.stop_loss_price,
    takeProfitSizePct: row.take_profit_size_pct,
    negRisk: row.neg_risk === 1,
    pollIntervalMs: row.poll_interval_ms,
    takeProfitOrderId: row.take_profit_order_id ?? undefined,
    stopLossOrderId: row.stop_loss_order_id ?? undefined,
    status: row.status as PersistedBracketOrder['status'],
    filledSide: (row.filled_side as 'take_profit' | 'stop_loss') ?? undefined,
    fillPrice: row.fill_price ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getActiveBracketOrders(userId?: string): PersistedBracketOrder[] {
  const db = getDb();
  
  const sql = userId
    ? 'SELECT * FROM bracket_orders WHERE status IN ("pending", "active") AND user_id = ?'
    : 'SELECT * FROM bracket_orders WHERE status IN ("pending", "active")';

  const rows = db.query<{
    id: string;
    user_id: string;
    platform: string;
    market_id: string;
    token_id: string | null;
    outcome: string | null;
    size: number;
    side: string;
    take_profit_price: number;
    stop_loss_price: number;
    take_profit_size_pct: number;
    neg_risk: number;
    poll_interval_ms: number;
    take_profit_order_id: string | null;
    stop_loss_order_id: string | null;
    status: string;
    filled_side: string | null;
    fill_price: number | null;
    created_at: number;
    updated_at: number;
  }>(sql, userId ? [userId] : []);

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    marketId: row.market_id,
    tokenId: row.token_id ?? undefined,
    outcome: row.outcome ?? undefined,
    size: row.size,
    side: row.side as 'long' | 'short',
    takeProfitPrice: row.take_profit_price,
    stopLossPrice: row.stop_loss_price,
    takeProfitSizePct: row.take_profit_size_pct,
    negRisk: row.neg_risk === 1,
    pollIntervalMs: row.poll_interval_ms,
    takeProfitOrderId: row.take_profit_order_id ?? undefined,
    stopLossOrderId: row.stop_loss_order_id ?? undefined,
    status: row.status as PersistedBracketOrder['status'],
    filledSide: (row.filled_side as 'take_profit' | 'stop_loss') ?? undefined,
    fillPrice: row.fill_price ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function deleteBracketOrder(orderId: string): void {
  const db = getDb();
  db.run('DELETE FROM bracket_orders WHERE id = ?', [orderId]);
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Clean up old completed/cancelled orders older than specified days
 */
export function cleanupOldOrders(olderThanDays: number = 30): void {
  const db = getDb();

  const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  db.run(
    'DELETE FROM twap_orders WHERE status IN ("completed", "cancelled", "failed") AND updated_at < ?',
    [cutoffTime]
  );

  db.run(
    'DELETE FROM bracket_orders WHERE status IN ("take_profit_hit", "stop_loss_hit", "cancelled", "failed") AND updated_at < ?',
    [cutoffTime]
  );

  logger.debug({ olderThanDays }, 'Cleaned up old TWAP and bracket orders');
}
