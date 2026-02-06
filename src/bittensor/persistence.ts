/**
 * Bittensor Persistence Layer
 * SQLite tables for earnings, miner status, and cost tracking.
 * Uses the Clodds Database interface (sql.js WASM).
 */

import type { Database } from '../db';
import type {
  BittensorPersistence,
  MinerEarnings,
  MinerStatus,
  CostLogEntry,
  EarningsPeriod,
} from './types';

export function createBittensorPersistence(db: Database): BittensorPersistence {
  function init(): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS bittensor_earnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subnet_id INTEGER NOT NULL,
        hotkey TEXT NOT NULL,
        tao_earned REAL NOT NULL DEFAULT 0,
        usd_earned REAL NOT NULL DEFAULT 0,
        api_cost REAL NOT NULL DEFAULT 0,
        infra_cost REAL NOT NULL DEFAULT 0,
        net_profit REAL NOT NULL DEFAULT 0,
        period TEXT NOT NULL DEFAULT 'daily',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS bittensor_miner_status (
        subnet_id INTEGER NOT NULL,
        hotkey TEXT NOT NULL,
        uid INTEGER NOT NULL DEFAULT 0,
        trust REAL NOT NULL DEFAULT 0,
        incentive REAL NOT NULL DEFAULT 0,
        emission REAL NOT NULL DEFAULT 0,
        rank INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(subnet_id, hotkey)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS bittensor_cost_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        amount_usd REAL NOT NULL DEFAULT 0,
        amount_tao REAL NOT NULL DEFAULT 0,
        subnet_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  function saveEarnings(earnings: Omit<MinerEarnings, 'createdAt'>): void {
    db.run(
      `INSERT INTO bittensor_earnings (subnet_id, hotkey, tao_earned, usd_earned, api_cost, infra_cost, net_profit, period)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        earnings.subnetId,
        earnings.hotkey,
        earnings.taoEarned,
        earnings.usdEarned,
        earnings.apiCost,
        earnings.infraCost,
        earnings.netProfit,
        earnings.period,
      ],
    );
  }

  function getEarnings(period: EarningsPeriod, subnetId?: number): MinerEarnings[] {
    // These are SQL expressions (not user input) so safe to inline.
    // They can't be passed as parameterized values since SQLite would
    // treat them as literal strings rather than evaluating them.
    const sinceExpr: Record<EarningsPeriod, string> = {
      hourly: "datetime('now', '-1 hour')",
      daily: "datetime('now', '-1 day')",
      weekly: "datetime('now', '-7 days')",
      monthly: "datetime('now', '-30 days')",
      all: "datetime('1970-01-01')",
    };

    let query = `SELECT * FROM bittensor_earnings WHERE created_at >= ${sinceExpr[period]}`;
    const params: unknown[] = [];

    if (subnetId !== undefined) {
      query += ' AND subnet_id = ?';
      params.push(subnetId);
    }

    query += ' ORDER BY created_at DESC';

    const rows = db.query<{
      subnet_id: number;
      hotkey: string;
      tao_earned: number;
      usd_earned: number;
      api_cost: number;
      infra_cost: number;
      net_profit: number;
      period: string;
      created_at: string;
    }>(query, params);

    return rows.map((row) => ({
      subnetId: row.subnet_id,
      hotkey: row.hotkey,
      taoEarned: row.tao_earned,
      usdEarned: row.usd_earned,
      apiCost: row.api_cost,
      infraCost: row.infra_cost,
      netProfit: row.net_profit,
      period: row.period as EarningsPeriod,
      createdAt: new Date(row.created_at),
    }));
  }

  function saveMinerStatus(status: Omit<MinerStatus, 'updatedAt'>): void {
    db.run(
      `INSERT INTO bittensor_miner_status (subnet_id, hotkey, uid, trust, incentive, emission, rank, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(subnet_id, hotkey) DO UPDATE SET
         uid = excluded.uid,
         trust = excluded.trust,
         incentive = excluded.incentive,
         emission = excluded.emission,
         rank = excluded.rank,
         active = excluded.active,
         updated_at = datetime('now')`,
      [
        status.subnetId,
        status.hotkey,
        status.uid,
        status.trust,
        status.incentive,
        status.emission,
        status.rank,
        status.active ? 1 : 0,
      ],
    );
  }

  function getMinerStatuses(): MinerStatus[] {
    const rows = db.query<{
      subnet_id: number;
      hotkey: string;
      uid: number;
      trust: number;
      incentive: number;
      emission: number;
      rank: number;
      active: number;
      updated_at: string;
    }>('SELECT * FROM bittensor_miner_status ORDER BY subnet_id');

    return rows.map((row) => ({
      subnetId: row.subnet_id,
      hotkey: row.hotkey,
      uid: row.uid,
      trust: row.trust,
      incentive: row.incentive,
      emission: row.emission,
      rank: row.rank,
      active: Boolean(row.active),
      updatedAt: new Date(row.updated_at),
    }));
  }

  function getMinerStatus(subnetId: number, hotkey: string): MinerStatus | null {
    const rows = db.query<{
      subnet_id: number;
      hotkey: string;
      uid: number;
      trust: number;
      incentive: number;
      emission: number;
      rank: number;
      active: number;
      updated_at: string;
    }>('SELECT * FROM bittensor_miner_status WHERE subnet_id = ? AND hotkey = ?', [subnetId, hotkey]);

    if (rows.length === 0) return null;
    const row = rows[0];

    return {
      subnetId: row.subnet_id,
      hotkey: row.hotkey,
      uid: row.uid,
      trust: row.trust,
      incentive: row.incentive,
      emission: row.emission,
      rank: row.rank,
      active: Boolean(row.active),
      updatedAt: new Date(row.updated_at),
    };
  }

  function logCost(entry: Omit<CostLogEntry, 'id' | 'createdAt'>): void {
    db.run(
      `INSERT INTO bittensor_cost_log (category, description, amount_usd, amount_tao, subnet_id)
       VALUES (?, ?, ?, ?, ?)`,
      [
        entry.category,
        entry.description,
        entry.amountUsd,
        entry.amountTao,
        entry.subnetId ?? null,
      ],
    );
  }

  function getCosts(since?: Date): CostLogEntry[] {
    let query = 'SELECT * FROM bittensor_cost_log';
    const params: unknown[] = [];

    if (since) {
      query += ' WHERE created_at >= ?';
      params.push(since.toISOString());
    }

    query += ' ORDER BY created_at DESC';

    const rows = db.query<{
      id: number;
      category: string;
      description: string;
      amount_usd: number;
      amount_tao: number;
      subnet_id: number | null;
      created_at: string;
    }>(query, params);

    return rows.map((row) => ({
      id: row.id,
      category: row.category as CostLogEntry['category'],
      description: row.description,
      amountUsd: row.amount_usd,
      amountTao: row.amount_tao,
      subnetId: row.subnet_id ?? undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  return {
    init,
    saveEarnings,
    getEarnings,
    saveMinerStatus,
    getMinerStatuses,
    getMinerStatus,
    logCost,
    getCosts,
    db,
  };
}
