/**
 * Database Migrations - Versioned schema management
 *
 * Features:
 * - Sequential migration execution
 * - Up/down migrations
 * - Migration tracking
 * - Automatic migration on startup
 */

import { Database } from './index';
import { logger } from '../utils/logger';

/** Migration definition */
export interface Migration {
  /** Migration version (sequential number) */
  version: number;
  /** Migration name for display */
  name: string;
  /** SQL to apply migration */
  up: string;
  /** SQL to revert migration */
  down: string;
}

/** Migration status */
export interface MigrationStatus {
  version: number;
  name: string;
  appliedAt: Date;
}

/** All migrations in order */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        username TEXT,
        display_name TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(platform, platform_user_id)
      );

      -- Sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'per-peer',
        context TEXT DEFAULT '{}',
        history TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL
      );

      -- Alerts table
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        market_id TEXT NOT NULL,
        market_name TEXT,
        condition_type TEXT NOT NULL,
        threshold REAL NOT NULL,
        current_value REAL,
        active INTEGER NOT NULL DEFAULT 1,
        triggered INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      -- Positions table
      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        market_id TEXT NOT NULL,
        market_question TEXT,
        outcome TEXT NOT NULL,
        outcome_id TEXT,
        side TEXT NOT NULL,
        shares REAL NOT NULL,
        avg_price REAL NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(key);
      CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
      CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
    `,
    down: `
      DROP TABLE IF EXISTS positions;
      DROP TABLE IF EXISTS alerts;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS users;
    `,
  },

  {
    version: 2,
    name: 'pairing_tables',
    up: `
      -- Pairing requests
      CREATE TABLE IF NOT EXISTS pairing_requests (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT,
        code TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      -- Paired users
      CREATE TABLE IF NOT EXISTS paired_users (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT,
        is_owner INTEGER NOT NULL DEFAULT 0,
        pairing_method TEXT,
        paired_at INTEGER NOT NULL,
        UNIQUE(channel, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_pairing_code ON pairing_requests(channel, code);
      CREATE INDEX IF NOT EXISTS idx_paired_channel ON paired_users(channel);
    `,
    down: `
      DROP TABLE IF EXISTS paired_users;
      DROP TABLE IF EXISTS pairing_requests;
    `,
  },

  {
    version: 3,
    name: 'credentials_table',
    up: `
      -- Encrypted trading credentials
      CREATE TABLE IF NOT EXISTS trading_credentials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        encrypted_data TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'manual',
        cooldown_until INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, platform)
      );
    `,
    down: `
      DROP TABLE IF EXISTS trading_credentials;
    `,
  },

  {
    version: 4,
    name: 'usage_tracking',
    up: `
      -- Usage records for token/cost tracking
      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        estimated_cost REAL NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_records(session_id);
      CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_id);
      CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records(timestamp);
    `,
    down: `
      DROP TABLE IF EXISTS usage_records;
    `,
  },

  {
    version: 5,
    name: 'memory_tables',
    up: `
      -- User memory entries
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        type TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        embedding TEXT,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Conversation logs
      CREATE TABLE IF NOT EXISTS conversation_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        date TEXT NOT NULL,
        summary TEXT,
        messages TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_user ON memory_entries(user_id, platform);
      CREATE INDEX IF NOT EXISTS idx_memory_key ON memory_entries(user_id, key);
      CREATE INDEX IF NOT EXISTS idx_convlog_user ON conversation_logs(user_id, platform, date);
    `,
    down: `
      DROP TABLE IF EXISTS conversation_logs;
      DROP TABLE IF EXISTS memory_entries;
    `,
  },

  {
    version: 6,
    name: 'market_cache',
    up: `
      -- Market cache for offline access
      CREATE TABLE IF NOT EXISTS market_cache (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        market_id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(platform, market_id)
      );

      CREATE INDEX IF NOT EXISTS idx_market_cache_platform ON market_cache(platform);
    `,
    down: `
      DROP TABLE IF EXISTS market_cache;
    `,
  },

  {
    version: 7,
    name: 'installed_skills',
    up: `
      -- Installed skills from registry
      CREATE TABLE IF NOT EXISTS installed_skills (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        directory TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        installed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
    down: `
      DROP TABLE IF EXISTS installed_skills;
    `,
  },
];

export interface MigrationRunner {
  /** Get current database version */
  getCurrentVersion(): number;

  /** Get all applied migrations */
  getAppliedMigrations(): MigrationStatus[];

  /** Get pending migrations */
  getPendingMigrations(): Migration[];

  /** Run all pending migrations */
  migrate(): void;

  /** Rollback to a specific version */
  rollbackTo(version: number): void;

  /** Rollback last migration */
  rollbackLast(): void;

  /** Reset database (rollback all) */
  reset(): void;
}

export function createMigrationRunner(db: Database): MigrationRunner {
  // Create migrations tracking table
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  function getCurrentVersion(): number {
    const results = db.query<{ version: number }>(
      'SELECT MAX(version) as version FROM _migrations'
    );
    return results[0]?.version || 0;
  }

  function getAppliedMigrations(): MigrationStatus[] {
    const rows = db.query<{ version: number; name: string; applied_at: number }>(
      'SELECT version, name, applied_at FROM _migrations ORDER BY version'
    );
    return rows.map((row) => ({
      version: row.version,
      name: row.name,
      appliedAt: new Date(row.applied_at),
    }));
  }

  function getPendingMigrations(): Migration[] {
    const currentVersion = getCurrentVersion();
    return MIGRATIONS.filter((m) => m.version > currentVersion);
  }

  function applyMigration(migration: Migration): void {
    logger.info({ version: migration.version, name: migration.name }, 'Applying migration');

    try {
      // Execute migration SQL (may contain multiple statements)
      const statements = migration.up
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const sql of statements) {
        db.run(sql);
      }

      // Record migration
      db.run(
        'INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.name, Date.now()]
      );

      logger.info({ version: migration.version }, 'Migration applied');
    } catch (error) {
      logger.error({ error, version: migration.version }, 'Migration failed');
      throw error;
    }
  }

  function revertMigration(migration: Migration): void {
    logger.info({ version: migration.version, name: migration.name }, 'Reverting migration');

    try {
      const statements = migration.down
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const sql of statements) {
        db.run(sql);
      }

      db.run('DELETE FROM _migrations WHERE version = ?', [migration.version]);

      logger.info({ version: migration.version }, 'Migration reverted');
    } catch (error) {
      logger.error({ error, version: migration.version }, 'Rollback failed');
      throw error;
    }
  }

  return {
    getCurrentVersion,
    getAppliedMigrations,
    getPendingMigrations,

    migrate() {
      const pending = getPendingMigrations();

      if (pending.length === 0) {
        logger.info('Database is up to date');
        return;
      }

      logger.info({ count: pending.length }, 'Running migrations');

      for (const migration of pending) {
        applyMigration(migration);
      }

      logger.info({ version: getCurrentVersion() }, 'Migrations complete');
    },

    rollbackTo(version) {
      const current = getCurrentVersion();
      if (version >= current) {
        logger.info('Nothing to rollback');
        return;
      }

      // Get migrations to revert (in reverse order)
      const toRevert = MIGRATIONS.filter(
        (m) => m.version > version && m.version <= current
      ).reverse();

      for (const migration of toRevert) {
        revertMigration(migration);
      }
    },

    rollbackLast() {
      const current = getCurrentVersion();
      if (current === 0) {
        logger.info('Nothing to rollback');
        return;
      }

      const migration = MIGRATIONS.find((m) => m.version === current);
      if (migration) {
        revertMigration(migration);
      }
    },

    reset() {
      this.rollbackTo(0);
    },
  };
}

/** Get all defined migrations */
export function getMigrations(): Migration[] {
  return [...MIGRATIONS];
}

/** Add a new migration programmatically */
export function addMigration(migration: Migration): void {
  MIGRATIONS.push(migration);
  MIGRATIONS.sort((a, b) => a.version - b.version);
}
