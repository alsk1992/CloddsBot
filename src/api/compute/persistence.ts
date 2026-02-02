/**
 * Persistence Layer - SQLite-based storage for compute API
 *
 * Stores: balances, jobs, usage stats, used tx hashes
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import type { ComputeService } from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface PersistenceLayer {
  // Balances
  getBalance(wallet: string): WalletBalanceRow | null;
  upsertBalance(wallet: string, available: number, pending: number, totalDeposited: number, totalSpent: number): void;

  // Jobs
  getJob(jobId: string): JobRow | null;
  getJobsByWallet(wallet: string, limit?: number): JobRow[];
  createJob(job: JobRow): void;
  updateJob(jobId: string, updates: Partial<JobRow>): void;
  cleanupOldJobs(maxAgeMs: number): number;

  // Used transactions (prevent replay)
  isTransactionUsed(txHash: string): boolean;
  markTransactionUsed(txHash: string, wallet: string, amount: number): void;

  // Usage stats
  recordUsage(wallet: string, service: ComputeService, cost: number, durationMs: number): void;
  getUsage(wallet: string, period: 'day' | 'week' | 'month' | 'all'): UsageRow[];

  // Rate limiting
  getRequestCount(wallet: string, windowMs: number): number;
  getIpRequestCount(ip: string, windowMs: number): number;
  recordRequest(wallet: string, ip: string): void;

  close(): void;
}

export interface WalletBalanceRow {
  wallet: string;
  available: number;
  pending: number;
  total_deposited: number;
  total_spent: number;
  created_at: number;
  updated_at: number;
}

export interface JobRow {
  job_id: string;
  request_id: string;
  wallet: string;
  service: string;
  status: string;
  payload: string;
  result: string | null;
  error: string | null;
  cost: number;
  usage: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export interface UsageRow {
  wallet: string;
  service: string;
  requests: number;
  total_cost: number;
  total_duration_ms: number;
  period_start: number;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createPersistenceLayer(dbPath?: string): PersistenceLayer {
  // Default to data directory
  const dataDir = process.env.CLODDS_DATA_DIR || '/tmp/clodds-data';
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const finalPath = dbPath || join(dataDir, 'compute.db');
  const db = new Database(finalPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS balances (
      wallet TEXT PRIMARY KEY,
      available REAL DEFAULT 0,
      pending REAL DEFAULT 0,
      total_deposited REAL DEFAULT 0,
      total_spent REAL DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      wallet TEXT NOT NULL,
      service TEXT NOT NULL,
      status TEXT NOT NULL,
      payload TEXT,
      result TEXT,
      error TEXT,
      cost REAL DEFAULT 0,
      usage TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_wallet ON jobs(wallet);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

    CREATE TABLE IF NOT EXISTS used_transactions (
      tx_hash TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      amount REAL NOT NULL,
      used_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS usage_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      service TEXT NOT NULL,
      cost REAL NOT NULL,
      duration_ms INTEGER NOT NULL,
      recorded_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_usage_wallet ON usage_stats(wallet);
    CREATE INDEX IF NOT EXISTS idx_usage_recorded ON usage_stats(recorded_at);

    CREATE TABLE IF NOT EXISTS rate_limit_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT,
      ip TEXT,
      requested_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_rate_wallet ON rate_limit_requests(wallet, requested_at);
    CREATE INDEX IF NOT EXISTS idx_rate_ip ON rate_limit_requests(ip, requested_at);
  `);

  // Prepared statements
  const stmts = {
    getBalance: db.prepare('SELECT * FROM balances WHERE wallet = ?'),
    upsertBalance: db.prepare(`
      INSERT INTO balances (wallet, available, pending, total_deposited, total_spent, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(wallet) DO UPDATE SET
        available = excluded.available,
        pending = excluded.pending,
        total_deposited = excluded.total_deposited,
        total_spent = excluded.total_spent,
        updated_at = excluded.updated_at
    `),

    getJob: db.prepare('SELECT * FROM jobs WHERE job_id = ?'),
    getJobsByWallet: db.prepare('SELECT * FROM jobs WHERE wallet = ? ORDER BY created_at DESC LIMIT ?'),
    createJob: db.prepare(`
      INSERT INTO jobs (job_id, request_id, wallet, service, status, payload, cost, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateJob: db.prepare(`
      UPDATE jobs SET status = ?, result = ?, error = ?, cost = ?, usage = ?, started_at = ?, completed_at = ?
      WHERE job_id = ?
    `),
    cleanupJobs: db.prepare('DELETE FROM jobs WHERE completed_at IS NOT NULL AND completed_at < ?'),

    isTransactionUsed: db.prepare('SELECT 1 FROM used_transactions WHERE tx_hash = ?'),
    markTransactionUsed: db.prepare('INSERT INTO used_transactions (tx_hash, wallet, amount) VALUES (?, ?, ?)'),

    recordUsage: db.prepare('INSERT INTO usage_stats (wallet, service, cost, duration_ms) VALUES (?, ?, ?, ?)'),
    getUsageDay: db.prepare(`
      SELECT wallet, service, COUNT(*) as requests, SUM(cost) as total_cost, SUM(duration_ms) as total_duration_ms
      FROM usage_stats WHERE wallet = ? AND recorded_at > ? GROUP BY service
    `),

    getRequestCount: db.prepare('SELECT COUNT(*) as cnt FROM rate_limit_requests WHERE wallet = ? AND requested_at > ?'),
    getIpRequestCount: db.prepare('SELECT COUNT(*) as cnt FROM rate_limit_requests WHERE ip = ? AND requested_at > ?'),
    recordRequest: db.prepare('INSERT INTO rate_limit_requests (wallet, ip) VALUES (?, ?)'),
    cleanupRateLimit: db.prepare('DELETE FROM rate_limit_requests WHERE requested_at < ?'),
  };

  // Cleanup old rate limit entries periodically
  setInterval(() => {
    const cutoff = Date.now() - 3600000; // 1 hour
    stmts.cleanupRateLimit.run(cutoff);
  }, 300000); // Every 5 minutes

  return {
    getBalance(wallet: string): WalletBalanceRow | null {
      return stmts.getBalance.get(wallet.toLowerCase()) as WalletBalanceRow | null;
    },

    upsertBalance(wallet: string, available: number, pending: number, totalDeposited: number, totalSpent: number): void {
      stmts.upsertBalance.run(wallet.toLowerCase(), available, pending, totalDeposited, totalSpent, Date.now());
    },

    getJob(jobId: string): JobRow | null {
      return stmts.getJob.get(jobId) as JobRow | null;
    },

    getJobsByWallet(wallet: string, limit: number = 50): JobRow[] {
      return stmts.getJobsByWallet.all(wallet.toLowerCase(), limit) as JobRow[];
    },

    createJob(job: JobRow): void {
      stmts.createJob.run(
        job.job_id,
        job.request_id,
        job.wallet.toLowerCase(),
        job.service,
        job.status,
        job.payload,
        job.cost,
        job.created_at
      );
    },

    updateJob(jobId: string, updates: Partial<JobRow>): void {
      const current = stmts.getJob.get(jobId) as JobRow | null;
      if (!current) return;

      stmts.updateJob.run(
        updates.status ?? current.status,
        updates.result ?? current.result,
        updates.error ?? current.error,
        updates.cost ?? current.cost,
        updates.usage ?? current.usage,
        updates.started_at ?? current.started_at,
        updates.completed_at ?? current.completed_at,
        jobId
      );
    },

    cleanupOldJobs(maxAgeMs: number): number {
      const cutoff = Date.now() - maxAgeMs;
      const result = stmts.cleanupJobs.run(cutoff);
      return result.changes;
    },

    isTransactionUsed(txHash: string): boolean {
      return !!stmts.isTransactionUsed.get(txHash.toLowerCase());
    },

    markTransactionUsed(txHash: string, wallet: string, amount: number): void {
      stmts.markTransactionUsed.run(txHash.toLowerCase(), wallet.toLowerCase(), amount);
    },

    recordUsage(wallet: string, service: ComputeService, cost: number, durationMs: number): void {
      stmts.recordUsage.run(wallet.toLowerCase(), service, cost, durationMs);
    },

    getUsage(wallet: string, period: 'day' | 'week' | 'month' | 'all'): UsageRow[] {
      const periodMs = {
        day: 86400000,
        week: 604800000,
        month: 2592000000,
        all: Date.now(), // Everything
      };
      const cutoff = Date.now() - periodMs[period];
      return stmts.getUsageDay.all(wallet.toLowerCase(), cutoff) as UsageRow[];
    },

    getRequestCount(wallet: string, windowMs: number): number {
      const cutoff = Date.now() - windowMs;
      const result = stmts.getRequestCount.get(wallet.toLowerCase(), cutoff) as { cnt: number };
      return result.cnt;
    },

    getIpRequestCount(ip: string, windowMs: number): number {
      const cutoff = Date.now() - windowMs;
      const result = stmts.getIpRequestCount.get(ip, cutoff) as { cnt: number };
      return result.cnt;
    },

    recordRequest(wallet: string, ip: string): void {
      stmts.recordRequest.run(wallet?.toLowerCase() || '', ip || '');
    },

    close(): void {
      db.close();
    },
  };
}
