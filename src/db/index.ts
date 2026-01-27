/**
 * Database - SQLite (sql.js WASM) for local persistence
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { logger } from '../utils/logger';
import type { User, Session, Alert, Position, Market, Platform, TradingCredentials } from '../types';

const DB_DIR = join(homedir(), '.clodds');
const DB_FILE = join(DB_DIR, 'clodds.db');

export interface Database {
  close(): void;
  save(): void;

  // Raw SQL access (for custom queries)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(sql: string, params?: any[]): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T>(sql: string, params?: any[]): T[];

  // Users
  getUserByPlatformId(platform: string, platformUserId: string): User | undefined;
  getUser(userId: string): User | undefined;
  createUser(user: User): void;
  updateUserActivity(userId: string): void;

  // Sessions
  getSession(key: string): Session | undefined;
  createSession(session: Session): void;
  updateSession(session: Session): void;
  deleteSession(key: string): void;

  // Alerts
  getAlerts(userId: string): Alert[];
  getActiveAlerts(): Alert[];
  createAlert(alert: Alert): void;
  updateAlert(alert: Alert): void;
  deleteAlert(alertId: string): void;
  triggerAlert(alertId: string): void;

  // Positions
  getPositions(userId: string): Position[];
  upsertPosition(userId: string, position: Position): void;
  deletePosition(positionId: string): void;

  // Market cache
  cacheMarket(market: Market): void;
  getCachedMarket(platform: string, marketId: string): Market | undefined;

  // Trading Credentials (per-user, encrypted)
  getTradingCredentials(userId: string, platform: Platform): TradingCredentials | null;
  createTradingCredentials(creds: TradingCredentials): void;
  updateTradingCredentials(creds: TradingCredentials): void;
  deleteTradingCredentials(userId: string, platform: Platform): void;
  listUserTradingPlatforms(userId: string): Platform[];
}

let dbInstance: Database | null = null;
let sqlJsDb: SqlJsDatabase | null = null;

export async function initDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;

  // Ensure directory exists
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  logger.info(`Opening database: ${DB_FILE}`);

  // Initialize sql.js
  const SQL = await initSqlJs();

  // Load existing database or create new
  if (existsSync(DB_FILE)) {
    const buffer = readFileSync(DB_FILE);
    sqlJsDb = new SQL.Database(buffer);
  } else {
    sqlJsDb = new SQL.Database();
  }

  const db = sqlJsDb;

  // Create tables
  db.run(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      username TEXT,
      settings TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      UNIQUE(platform, platform_user_id)
    );

    -- Alerts table
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT,
      market_id TEXT,
      platform TEXT,
      condition TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      triggered INTEGER DEFAULT 0,
      trigger_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_triggered_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Positions table
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      market_id TEXT NOT NULL,
      market_question TEXT,
      outcome TEXT NOT NULL,
      outcome_id TEXT NOT NULL,
      side TEXT NOT NULL,
      shares REAL NOT NULL,
      avg_price REAL NOT NULL,
      current_price REAL,
      opened_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, platform, market_id, outcome_id)
    );

    -- Market cache table
    CREATE TABLE IF NOT EXISTS markets (
      platform TEXT NOT NULL,
      market_id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (platform, market_id)
    );

    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT,
      key TEXT PRIMARY KEY,
      user_id TEXT,
      channel TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      chat_type TEXT NOT NULL,
      context TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Trading Credentials table (per-user, encrypted)
    CREATE TABLE IF NOT EXISTS trading_credentials (
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      mode TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_used_at INTEGER,
      failed_attempts INTEGER DEFAULT 0,
      cooldown_until INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, platform),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Watched wallets table (for whale tracking)
    CREATE TABLE IF NOT EXISTS watched_wallets (
      user_id TEXT NOT NULL,
      address TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'polymarket',
      nickname TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, address),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Auto-copy settings (for copy trading)
    CREATE TABLE IF NOT EXISTS auto_copy_settings (
      user_id TEXT NOT NULL,
      target_address TEXT NOT NULL,
      max_size REAL NOT NULL,
      size_multiplier REAL NOT NULL DEFAULT 0.5,
      min_confidence REAL NOT NULL DEFAULT 0.55,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, target_address),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Paper trading settings
    CREATE TABLE IF NOT EXISTS paper_trading_settings (
      user_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      balance REAL NOT NULL DEFAULT 10000,
      starting_balance REAL NOT NULL DEFAULT 10000,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Paper trading positions
    CREATE TABLE IF NOT EXISTS paper_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      market_name TEXT,
      side TEXT NOT NULL,
      size REAL NOT NULL,
      entry_price REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Paper trading trade history
    CREATE TABLE IF NOT EXISTS paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      market_name TEXT,
      side TEXT NOT NULL,
      size REAL NOT NULL,
      price REAL NOT NULL,
      pnl REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Alert settings (for whale alerts, new market alerts, etc.)
    CREATE TABLE IF NOT EXISTS alert_settings (
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      min_size REAL,
      threshold REAL,
      markets TEXT,
      categories TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, type),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Pairing requests (pending DM access)
    CREATE TABLE IF NOT EXISTS pairing_requests (
      code TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      userId TEXT NOT NULL,
      username TEXT,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    );

    -- Paired users (approved DM access)
    CREATE TABLE IF NOT EXISTS paired_users (
      channel TEXT NOT NULL,
      userId TEXT NOT NULL,
      username TEXT,
      pairedAt TEXT NOT NULL,
      pairedBy TEXT NOT NULL DEFAULT 'allowlist',
      isOwner INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (channel, userId)
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
    CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_credentials_user ON trading_credentials(user_id);
    CREATE INDEX IF NOT EXISTS idx_watched_wallets_user ON watched_wallets(user_id);
    CREATE INDEX IF NOT EXISTS idx_paper_positions_user ON paper_positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_paper_trades_user ON paper_trades(user_id);
  `);

  // Save after schema creation
  saveDb();

  function saveDb() {
    if (!sqlJsDb) return;
    const data = sqlJsDb.export();
    const buffer = Buffer.from(data);
    writeFileSync(DB_FILE, buffer);
  }

  // Helper to get single row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getOne<T>(sql: string, params: any[] = []): T | undefined {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row as T;
    }
    stmt.free();
    return undefined;
  }

  // Helper to get all rows
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getAll<T>(sql: string, params: any[] = []): T[] {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  // Helper to run statement
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function run(sql: string, params: any[] = []): void {
    db.run(sql, params);
    saveDb();
  }

  // Helper to query multiple rows
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function query<T>(sql: string, params: any[] = []): T[] {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  // Helper to parse row into typed object
  function parseUser(row: Record<string, unknown> | undefined): User | undefined {
    if (!row) return undefined;
    return {
      id: row.id as string,
      platform: row.platform as string,
      platformUserId: row.platform_user_id as string,
      username: row.username as string | undefined,
      settings: JSON.parse((row.settings as string) || '{}'),
      createdAt: new Date(row.created_at as number),
      lastActiveAt: new Date(row.last_active_at as number),
    };
  }

  function parseSession(row: Record<string, unknown> | undefined): Session | undefined {
    if (!row) return undefined;
    const context = JSON.parse((row.context as string) || '{}');
    return {
      id: row.id as string,
      key: row.key as string,
      userId: row.user_id as string,
      channel: row.channel as string,
      chatId: row.chat_id as string,
      chatType: row.chat_type as 'dm' | 'group',
      context,
      history: context.conversationHistory || [],
      lastActivity: row.last_activity ? new Date(row.last_activity as number) : new Date(row.updated_at as number),
      createdAt: new Date(row.created_at as number),
      updatedAt: new Date(row.updated_at as number),
    };
  }

  function parseAlert(row: Record<string, unknown>): Alert {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      type: row.type as Alert['type'],
      name: row.name as string | undefined,
      marketId: row.market_id as string | undefined,
      platform: row.platform as Platform | undefined,
      condition: JSON.parse((row.condition as string) || '{}'),
      enabled: Boolean(row.enabled),
      triggered: Boolean(row.triggered),
      createdAt: new Date(row.created_at as number),
      lastTriggeredAt: row.last_triggered_at ? new Date(row.last_triggered_at as number) : undefined,
    };
  }

  function parsePosition(row: Record<string, unknown>): Position {
    const shares = row.shares as number;
    const avgPrice = row.avg_price as number;
    const currentPrice = (row.current_price as number) || avgPrice;
    const value = shares * currentPrice;
    const pnl = shares * (currentPrice - avgPrice);
    const pnlPct = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;

    return {
      id: row.id as string,
      platform: row.platform as Platform,
      marketId: row.market_id as string,
      marketQuestion: row.market_question as string,
      outcome: row.outcome as string,
      outcomeId: row.outcome_id as string,
      side: row.side as 'YES' | 'NO',
      shares,
      avgPrice,
      currentPrice,
      pnl,
      pnlPct,
      value,
      openedAt: new Date(row.opened_at as number),
    };
  }

  function parseTradingCredentials(row: Record<string, unknown> | undefined): TradingCredentials | null {
    if (!row) return null;
    return {
      userId: row.user_id as string,
      platform: row.platform as Platform,
      mode: row.mode as TradingCredentials['mode'],
      encryptedData: row.encrypted_data as string,
      enabled: Boolean(row.enabled),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at as number) : undefined,
      failedAttempts: row.failed_attempts as number,
      cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until as number) : undefined,
      createdAt: new Date(row.created_at as number),
      updatedAt: new Date(row.updated_at as number),
    };
  }

  dbInstance = {
    close() {
      saveDb();
      db.close();
      sqlJsDb = null;
      dbInstance = null;
    },

    save() {
      saveDb();
    },

    // Users
    getUserByPlatformId(platform: string, platformUserId: string): User | undefined {
      return parseUser(
        getOne('SELECT * FROM users WHERE platform = ? AND platform_user_id = ?', [platform, platformUserId])
      );
    },

    getUser(userId: string): User | undefined {
      return parseUser(getOne('SELECT * FROM users WHERE id = ?', [userId]));
    },

    createUser(user: User): void {
      run(
        'INSERT INTO users (id, platform, platform_user_id, username, settings, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          user.id,
          user.platform,
          user.platformUserId,
          user.username,
          JSON.stringify(user.settings),
          user.createdAt.getTime(),
          user.lastActiveAt.getTime(),
        ]
      );
    },

    updateUserActivity(userId: string): void {
      run('UPDATE users SET last_active_at = ? WHERE id = ?', [Date.now(), userId]);
    },

    // Sessions
    getSession(key: string): Session | undefined {
      return parseSession(getOne('SELECT * FROM sessions WHERE key = ?', [key]));
    },

    createSession(session: Session): void {
      run(
        'INSERT INTO sessions (id, key, user_id, channel, chat_id, chat_type, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          session.id,
          session.key,
          session.userId,
          session.channel,
          session.chatId,
          session.chatType,
          JSON.stringify(session.context),
          session.createdAt.getTime(),
          session.updatedAt.getTime(),
        ]
      );
    },

    updateSession(session: Session): void {
      run('UPDATE sessions SET context = ?, updated_at = ? WHERE key = ?', [
        JSON.stringify(session.context),
        session.updatedAt.getTime(),
        session.key,
      ]);
    },

    deleteSession(key: string): void {
      run('DELETE FROM sessions WHERE key = ?', [key]);
    },

    // Alerts
    getAlerts(userId: string): Alert[] {
      return getAll<Record<string, unknown>>('SELECT * FROM alerts WHERE user_id = ?', [userId]).map(parseAlert);
    },

    getActiveAlerts(): Alert[] {
      return getAll<Record<string, unknown>>('SELECT * FROM alerts WHERE enabled = 1 AND triggered = 0').map(
        parseAlert
      );
    },

    createAlert(alert: Alert): void {
      run(
        'INSERT INTO alerts (id, user_id, type, name, market_id, platform, condition, enabled, triggered, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          alert.id,
          alert.userId,
          alert.type,
          alert.name || null,
          alert.marketId || null,
          alert.platform || null,
          JSON.stringify(alert.condition),
          alert.enabled ? 1 : 0,
          alert.triggered ? 1 : 0,
          alert.createdAt.getTime(),
        ]
      );
    },

    updateAlert(alert: Alert): void {
      run('UPDATE alerts SET name = ?, condition = ?, enabled = ? WHERE id = ?', [
        alert.name || null,
        JSON.stringify(alert.condition),
        alert.enabled ? 1 : 0,
        alert.id,
      ]);
    },

    deleteAlert(alertId: string): void {
      run('DELETE FROM alerts WHERE id = ?', [alertId]);
    },

    triggerAlert(alertId: string): void {
      run('UPDATE alerts SET triggered = 1, trigger_count = trigger_count + 1, last_triggered_at = ? WHERE id = ?', [
        Date.now(),
        alertId,
      ]);
    },

    // Positions
    getPositions(userId: string): Position[] {
      return getAll<Record<string, unknown>>('SELECT * FROM positions WHERE user_id = ?', [userId]).map(parsePosition);
    },

    upsertPosition(userId: string, position: Position): void {
      run(
        `INSERT INTO positions (id, user_id, platform, market_id, market_question, outcome, outcome_id, side, shares, avg_price, current_price, opened_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, platform, market_id, outcome_id) DO UPDATE SET
           shares = excluded.shares,
           avg_price = excluded.avg_price,
           current_price = excluded.current_price,
           updated_at = excluded.updated_at`,
        [
          position.id,
          userId,
          position.platform,
          position.marketId,
          position.marketQuestion,
          position.outcome,
          position.outcomeId,
          position.side,
          position.shares,
          position.avgPrice,
          position.currentPrice,
          position.openedAt.getTime(),
          Date.now(),
        ]
      );
    },

    deletePosition(positionId: string): void {
      run('DELETE FROM positions WHERE id = ?', [positionId]);
    },

    // Markets cache
    cacheMarket(market: Market): void {
      run('INSERT OR REPLACE INTO markets (platform, market_id, data, updated_at) VALUES (?, ?, ?, ?)', [
        market.platform,
        market.id,
        JSON.stringify(market),
        Date.now(),
      ]);
    },

    getCachedMarket(platform: string, marketId: string): Market | undefined {
      const row = getOne<{ data: string }>('SELECT * FROM markets WHERE platform = ? AND market_id = ?', [
        platform,
        marketId,
      ]);
      return row ? JSON.parse(row.data) : undefined;
    },

    // Trading Credentials
    getTradingCredentials(userId: string, platform: Platform): TradingCredentials | null {
      return parseTradingCredentials(
        getOne('SELECT * FROM trading_credentials WHERE user_id = ? AND platform = ?', [userId, platform])
      );
    },

    createTradingCredentials(creds: TradingCredentials): void {
      run(
        'INSERT INTO trading_credentials (user_id, platform, mode, encrypted_data, enabled, last_used_at, failed_attempts, cooldown_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          creds.userId,
          creds.platform,
          creds.mode,
          creds.encryptedData,
          creds.enabled ? 1 : 0,
          creds.lastUsedAt?.getTime() || null,
          creds.failedAttempts,
          creds.cooldownUntil?.getTime() || null,
          creds.createdAt.getTime(),
          creds.updatedAt.getTime(),
        ]
      );
    },

    updateTradingCredentials(creds: TradingCredentials): void {
      run(
        'UPDATE trading_credentials SET encrypted_data = ?, enabled = ?, last_used_at = ?, failed_attempts = ?, cooldown_until = ?, updated_at = ? WHERE user_id = ? AND platform = ?',
        [
          creds.encryptedData,
          creds.enabled ? 1 : 0,
          creds.lastUsedAt?.getTime() || null,
          creds.failedAttempts,
          creds.cooldownUntil?.getTime() || null,
          creds.updatedAt.getTime(),
          creds.userId,
          creds.platform,
        ]
      );
    },

    deleteTradingCredentials(userId: string, platform: Platform): void {
      run('DELETE FROM trading_credentials WHERE user_id = ? AND platform = ?', [userId, platform]);
    },

    listUserTradingPlatforms(userId: string): Platform[] {
      const rows = getAll<{ platform: string }>(
        'SELECT platform FROM trading_credentials WHERE user_id = ? AND enabled = 1',
        [userId]
      );
      return rows.map((r) => r.platform as Platform);
    },

    // Raw SQL access
    run,
    query,
  };

  return dbInstance;
}

// Sync wrapper for backwards compatibility
export function createDatabase(): Database {
  // Return a proxy that initializes lazily
  let initialized = false;
  let db: Database;

  const lazyInit = async () => {
    if (!initialized) {
      db = await initDatabase();
      initialized = true;
    }
    return db;
  };

  // Start initialization immediately
  const initPromise = lazyInit();

  // Return proxy that waits for initialization
  return new Proxy({} as Database, {
    get(_target, prop) {
      if (prop === 'then') return undefined; // Not a promise
      return (...args: unknown[]) => {
        if (initialized && db) {
          return (db as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string](...args);
        }
        // If not initialized yet, wait
        return initPromise.then((d) =>
          (d as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string](...args)
        );
      };
    },
  });
}
