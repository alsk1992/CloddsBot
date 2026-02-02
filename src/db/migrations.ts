/**
 * Database Migrations - Versioned schema management
 *
 * IMPORTANT: Self-Creating Tables Pattern
 * ========================================
 * Modules now self-create their tables on init using `CREATE TABLE IF NOT EXISTS`.
 * This avoids relying on migrations which can cause issues for less technical users.
 *
 * Modules with self-creating tables:
 * - src/usage/index.ts          -> usage_records
 * - src/memory/index.ts         -> user_memory, daily_logs
 * - src/pairing/index.ts        -> pairing_requests, paired_users
 * - src/alerts/index.ts         -> alerts
 * - src/embeddings/index.ts     -> embeddings_cache
 * - src/history/index.ts        -> trade_history
 * - src/solana/swarm-presets.ts -> swarm_presets
 * - src/opportunity/index.ts    -> market_links, opportunities, platform_pair_stats, etc.
 * - src/arbitrage/index.ts      -> arbitrage_matches, arbitrage_opportunities
 * - src/acp/persistence.ts      -> acp_agents, acp_services, acp_agreements, etc.
 * - src/acp/identity.ts         -> acp_handles, acp_takeover_bids, acp_referrals, etc.
 * - src/acp/predictions.ts      -> acp_predictions
 *
 * This migrations file is kept for backwards compatibility with existing DBs.
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
export type MigrationStep = string | ((db: Database) => void);

export interface Migration {
  /** Migration version (sequential number) */
  version: number;
  /** Migration name for display */
  name: string;
  /** SQL to apply migration */
  up: MigrationStep;
  /** SQL to revert migration */
  down: MigrationStep;
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
    name: 'core_schema',
    up: `
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

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(enabled, triggered);
      CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(key);
      CREATE INDEX IF NOT EXISTS idx_credentials_user ON trading_credentials(user_id);
      CREATE INDEX IF NOT EXISTS idx_credentials_user_platform ON trading_credentials(user_id, platform);
      CREATE INDEX IF NOT EXISTS idx_markets_platform_market ON markets(platform, market_id);
      CREATE INDEX IF NOT EXISTS idx_users_platform_userid ON users(platform, platform_user_id);
    `,
    down: `
      DROP TABLE IF EXISTS paired_users;
      DROP TABLE IF EXISTS pairing_requests;
      DROP TABLE IF EXISTS trading_credentials;
      DROP TABLE IF EXISTS markets;
      DROP TABLE IF EXISTS positions;
      DROP TABLE IF EXISTS alerts;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS users;
    `,
  },

  {
    version: 2,
    name: 'trading_support_tables',
    up: `
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

      CREATE INDEX IF NOT EXISTS idx_watched_wallets_user ON watched_wallets(user_id);
      CREATE INDEX IF NOT EXISTS idx_paper_positions_user ON paper_positions(user_id);
      CREATE INDEX IF NOT EXISTS idx_paper_trades_user ON paper_trades(user_id);
    `,
    down: `
      DROP TABLE IF EXISTS alert_settings;
      DROP TABLE IF EXISTS paper_trades;
      DROP TABLE IF EXISTS paper_positions;
      DROP TABLE IF EXISTS paper_trading_settings;
      DROP TABLE IF EXISTS auto_copy_settings;
      DROP TABLE IF EXISTS watched_wallets;
    `,
  },

  {
    version: 3,
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
    version: 4,
    name: 'memory_tables',
    up: `
      -- User memory entries
      CREATE TABLE IF NOT EXISTS user_memory (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        channel TEXT NOT NULL,
        type TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        expiresAt TEXT,
        UNIQUE(userId, channel, key)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_user_channel
      ON user_memory(userId, channel);

      CREATE INDEX IF NOT EXISTS idx_memory_type
      ON user_memory(userId, channel, type);

      -- Daily logs
      CREATE TABLE IF NOT EXISTS daily_logs (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        channel TEXT NOT NULL,
        date TEXT NOT NULL,
        summary TEXT NOT NULL,
        messageCount INTEGER NOT NULL,
        topics TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE(userId, channel, date)
      );
    `,
    down: `
      DROP TABLE IF EXISTS daily_logs;
      DROP TABLE IF EXISTS user_memory;
    `,
  },

  {
    version: 5,
    name: 'embeddings_cache',
    up: `
      CREATE TABLE IF NOT EXISTS embeddings_cache (
        id TEXT PRIMARY KEY,
        contentHash TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        vector TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_embeddings_hash
      ON embeddings_cache(contentHash);
    `,
    down: `
      DROP TABLE IF EXISTS embeddings_cache;
    `,
  },

  {
    version: 6,
    name: 'identity_links',
    up: `
      CREATE TABLE IF NOT EXISTS identity_links (
        id TEXT PRIMARY KEY,
        primaryChannel TEXT NOT NULL,
        primaryUserId TEXT NOT NULL,
        linkedChannel TEXT NOT NULL,
        linkedUserId TEXT NOT NULL,
        linkMethod TEXT NOT NULL DEFAULT 'manual',
        displayName TEXT,
        createdAt TEXT NOT NULL,
        UNIQUE(linkedChannel, linkedUserId)
      );

      CREATE INDEX IF NOT EXISTS idx_identity_primary
      ON identity_links(primaryChannel, primaryUserId);

      CREATE INDEX IF NOT EXISTS idx_identity_linked
      ON identity_links(linkedChannel, linkedUserId);
    `,
    down: `
      DROP TABLE IF EXISTS identity_links;
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
  {
    version: 8,
    name: 'schema_alignment_2026_01',
    up: (db) => {
      const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
      const ensureIdentifier = (name: string) => {
        if (!identifier.test(name)) {
          throw new Error(`Unsafe SQL identifier: ${name}`);
        }
      };

      const tableExists = (table: string): boolean => {
        const rows = db.query<{ name: string }>(
          'SELECT name FROM sqlite_master WHERE type = ? AND name = ?',
          ['table', table]
        );
        return rows.length > 0;
      };

      const getColumns = (table: string): string[] => {
        ensureIdentifier(table);
        const rows = db.query<{ name: string }>(`PRAGMA table_info(${table})`);
        return Array.isArray(rows) ? rows.map((row) => row.name) : [];
      };

      const addColumnIfMissing = (table: string, column: string, type: string, defaultSql?: string) => {
        ensureIdentifier(table);
        ensureIdentifier(column);
        const columns = getColumns(table);
        if (columns.includes(column)) return;
        const defaultClause = defaultSql ? ` DEFAULT ${defaultSql}` : '';
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}${defaultClause}`);
      };

      const createCoreTables = () => {
        db.run(`
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

          CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            type TEXT NOT NULL,
            name TEXT,
            market_id TEXT,
            platform TEXT,
            channel TEXT,
            chat_id TEXT,
            condition TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            triggered INTEGER DEFAULT 0,
            trigger_count INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            last_triggered_at INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id)
          );

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

          CREATE TABLE IF NOT EXISTS markets (
            platform TEXT NOT NULL,
            market_id TEXT NOT NULL,
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (platform, market_id)
          );

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

          CREATE TABLE IF NOT EXISTS cron_jobs (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );

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

          CREATE TABLE IF NOT EXISTS watched_wallets (
            user_id TEXT NOT NULL,
            address TEXT NOT NULL,
            platform TEXT NOT NULL DEFAULT 'polymarket',
            nickname TEXT,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, address),
            FOREIGN KEY (user_id) REFERENCES users(id)
          );

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

          CREATE TABLE IF NOT EXISTS paper_trading_settings (
            user_id TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 0,
            balance REAL NOT NULL DEFAULT 10000,
            starting_balance REAL NOT NULL DEFAULT 10000,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
          );

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

          CREATE TABLE IF NOT EXISTS pairing_requests (
            code TEXT PRIMARY KEY,
            channel TEXT NOT NULL,
            userId TEXT NOT NULL,
            username TEXT,
            createdAt TEXT NOT NULL,
            expiresAt TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS paired_users (
            channel TEXT NOT NULL,
            userId TEXT NOT NULL,
            username TEXT,
            pairedAt TEXT NOT NULL,
            pairedBy TEXT NOT NULL DEFAULT 'allowlist',
            isOwner INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (channel, userId)
          );
        `);
      };

      const createAuxTables = () => {
        db.run(`
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

          CREATE TABLE IF NOT EXISTS user_memory (
            id TEXT PRIMARY KEY,
            userId TEXT NOT NULL,
            channel TEXT NOT NULL,
            type TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            expiresAt TEXT,
            UNIQUE(userId, channel, key)
          );

          CREATE TABLE IF NOT EXISTS daily_logs (
            id TEXT PRIMARY KEY,
            userId TEXT NOT NULL,
            channel TEXT NOT NULL,
            date TEXT NOT NULL,
            summary TEXT NOT NULL,
            messageCount INTEGER NOT NULL,
            topics TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            UNIQUE(userId, channel, date)
          );

          CREATE TABLE IF NOT EXISTS embeddings_cache (
            id TEXT PRIMARY KEY,
            contentHash TEXT UNIQUE NOT NULL,
            content TEXT NOT NULL,
            vector TEXT NOT NULL,
            createdAt TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS identity_links (
            id TEXT PRIMARY KEY,
            primaryChannel TEXT NOT NULL,
            primaryUserId TEXT NOT NULL,
            linkedChannel TEXT NOT NULL,
            linkedUserId TEXT NOT NULL,
            linkMethod TEXT NOT NULL DEFAULT 'manual',
            displayName TEXT,
            createdAt TEXT NOT NULL,
            UNIQUE(linkedChannel, linkedUserId)
          );

          CREATE TABLE IF NOT EXISTS installed_skills (
            slug TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            directory TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            installed_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
        `);
      };

      const ensureIndexes = () => {
        db.run(`
          CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
          CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(enabled, triggered);
          CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
          CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
          CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(key);
          CREATE INDEX IF NOT EXISTS idx_credentials_user ON trading_credentials(user_id);
          CREATE INDEX IF NOT EXISTS idx_credentials_user_platform ON trading_credentials(user_id, platform);
          CREATE INDEX IF NOT EXISTS idx_markets_platform_market ON markets(platform, market_id);
          CREATE INDEX IF NOT EXISTS idx_users_platform_userid ON users(platform, platform_user_id);
          CREATE INDEX IF NOT EXISTS idx_watched_wallets_user ON watched_wallets(user_id);
          CREATE INDEX IF NOT EXISTS idx_paper_positions_user ON paper_positions(user_id);
          CREATE INDEX IF NOT EXISTS idx_paper_trades_user ON paper_trades(user_id);
          CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_records(session_id);
          CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_id);
          CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records(timestamp);
          CREATE INDEX IF NOT EXISTS idx_memory_user_channel ON user_memory(userId, channel);
          CREATE INDEX IF NOT EXISTS idx_memory_type ON user_memory(userId, channel, type);
          CREATE INDEX IF NOT EXISTS idx_embeddings_hash ON embeddings_cache(contentHash);
          CREATE INDEX IF NOT EXISTS idx_identity_primary ON identity_links(primaryChannel, primaryUserId);
          CREATE INDEX IF NOT EXISTS idx_identity_linked ON identity_links(linkedChannel, linkedUserId);
        `);
      };

      const alignUsers = () => {
        addColumnIfMissing('users', 'settings', 'TEXT', "'{}'");
        addColumnIfMissing('users', 'last_active_at', 'INTEGER');
        const cols = getColumns('users');
        if (cols.includes('updated_at')) {
          db.run('UPDATE users SET last_active_at = updated_at WHERE last_active_at IS NULL');
        } else if (cols.includes('created_at')) {
          db.run('UPDATE users SET last_active_at = created_at WHERE last_active_at IS NULL');
        }
      };

      const alignSessions = () => {
        addColumnIfMissing('sessions', 'chat_id', 'TEXT');
        addColumnIfMissing('sessions', 'chat_type', 'TEXT', "'dm'");
        addColumnIfMissing('sessions', 'context', 'TEXT', "'{}'");
        addColumnIfMissing('sessions', 'updated_at', 'INTEGER');

        const cols = getColumns('sessions');
        if (cols.includes('key')) {
          db.run('UPDATE sessions SET chat_id = key WHERE chat_id IS NULL');
        }
        db.run("UPDATE sessions SET chat_type = 'dm' WHERE chat_type IS NULL");
        if (cols.includes('last_activity')) {
          db.run('UPDATE sessions SET updated_at = last_activity WHERE updated_at IS NULL');
        }
        if (cols.includes('created_at')) {
          db.run('UPDATE sessions SET updated_at = created_at WHERE updated_at IS NULL');
        }
      };

      const alignAlerts = () => {
        addColumnIfMissing('alerts', 'type', 'TEXT', "'price'");
        addColumnIfMissing('alerts', 'name', 'TEXT');
        addColumnIfMissing('alerts', 'condition', 'TEXT');
        addColumnIfMissing('alerts', 'enabled', 'INTEGER', '1');
        addColumnIfMissing('alerts', 'trigger_count', 'INTEGER', '0');
        addColumnIfMissing('alerts', 'last_triggered_at', 'INTEGER');

        const cols = getColumns('alerts');
        if (cols.includes('active')) {
          db.run('UPDATE alerts SET enabled = active WHERE enabled IS NULL');
        }
        if (cols.includes('market_name')) {
          db.run('UPDATE alerts SET name = market_name WHERE name IS NULL');
        }

        if (cols.includes('condition_type') && cols.includes('threshold')) {
          const rows = db.query<{ id: string; condition_type: string | null; threshold: number | null }>(
            'SELECT id, condition_type, threshold FROM alerts WHERE condition IS NULL OR condition = ""'
          );
          for (const row of rows) {
            if (row.threshold === null || row.threshold === undefined) continue;
            const condition = {
              type: row.condition_type || 'price_above',
              threshold: row.threshold,
            };
            db.run('UPDATE alerts SET condition = ? WHERE id = ?', [JSON.stringify(condition), row.id]);
          }
        }
      };

      const alignPositions = () => {
        addColumnIfMissing('positions', 'current_price', 'REAL');
        addColumnIfMissing('positions', 'opened_at', 'INTEGER');
        addColumnIfMissing('positions', 'updated_at', 'INTEGER');
        addColumnIfMissing('positions', 'outcome_id', 'TEXT');

        const cols = getColumns('positions');
        if (cols.includes('created_at')) {
          db.run('UPDATE positions SET opened_at = created_at WHERE opened_at IS NULL');
        }
        db.run('UPDATE positions SET updated_at = opened_at WHERE updated_at IS NULL AND opened_at IS NOT NULL');
        db.run('UPDATE positions SET current_price = avg_price WHERE current_price IS NULL');
        db.run("UPDATE positions SET outcome_id = market_id || '-' || outcome WHERE outcome_id IS NULL");
      };

      const alignTradingCredentials = () => {
        addColumnIfMissing('trading_credentials', 'enabled', 'INTEGER', '1');
        addColumnIfMissing('trading_credentials', 'last_used_at', 'INTEGER');
        addColumnIfMissing('trading_credentials', 'failed_attempts', 'INTEGER', '0');
        db.run('UPDATE trading_credentials SET enabled = 1 WHERE enabled IS NULL');
        db.run('UPDATE trading_credentials SET failed_attempts = 0 WHERE failed_attempts IS NULL');
      };

      const alignPairing = () => {
        addColumnIfMissing('pairing_requests', 'userId', 'TEXT');
        addColumnIfMissing('pairing_requests', 'createdAt', 'TEXT');
        addColumnIfMissing('pairing_requests', 'expiresAt', 'TEXT');
        addColumnIfMissing('paired_users', 'userId', 'TEXT');
        addColumnIfMissing('paired_users', 'pairedAt', 'TEXT');
        addColumnIfMissing('paired_users', 'pairedBy', 'TEXT', "'allowlist'");
        addColumnIfMissing('paired_users', 'isOwner', 'INTEGER', '0');

        const pairingCols = getColumns('pairing_requests');
        if (pairingCols.includes('user_id')) {
          db.run('UPDATE pairing_requests SET userId = user_id WHERE userId IS NULL');
        }
        if (pairingCols.includes('created_at')) {
          db.run('UPDATE pairing_requests SET createdAt = created_at WHERE createdAt IS NULL');
        }
        if (pairingCols.includes('expires_at')) {
          db.run('UPDATE pairing_requests SET expiresAt = expires_at WHERE expiresAt IS NULL');
        }

        const pairedCols = getColumns('paired_users');
        if (pairedCols.includes('user_id')) {
          db.run('UPDATE paired_users SET userId = user_id WHERE userId IS NULL');
        }
        if (pairedCols.includes('paired_at')) {
          db.run('UPDATE paired_users SET pairedAt = paired_at WHERE pairedAt IS NULL');
        }
        if (pairedCols.includes('pairing_method')) {
          db.run('UPDATE paired_users SET pairedBy = pairing_method WHERE pairedBy IS NULL');
        }
        if (pairedCols.includes('is_owner')) {
          db.run('UPDATE paired_users SET isOwner = is_owner WHERE isOwner IS NULL');
        }
      };

      const alignMarketCache = () => {
        if (!tableExists('market_cache')) return;
        db.run(`
          INSERT OR IGNORE INTO markets (platform, market_id, data, updated_at)
          SELECT platform, market_id, data, updated_at FROM market_cache
        `);
      };

      const migrateLegacyMemory = () => {
        if (!tableExists('memory_entries')) return;
        const rows = db.query<{
          id: string;
          user_id: string;
          platform: string;
          type: string;
          key: string;
          value: string;
          created_at: number;
          updated_at: number;
          expires_at: number | null;
        }>('SELECT * FROM memory_entries');

        for (const row of rows) {
          db.run(
            `
            INSERT OR IGNORE INTO user_memory (
              id, userId, channel, type, key, value, createdAt, updatedAt, expiresAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              row.id,
              row.user_id,
              row.platform,
              row.type,
              row.key,
              row.value,
              new Date(row.created_at).toISOString(),
              new Date(row.updated_at).toISOString(),
              row.expires_at ? new Date(row.expires_at).toISOString() : null,
            ]
          );
        }
      };

      const migrateLegacyLogs = () => {
        if (!tableExists('conversation_logs')) return;
        const rows = db.query<{
          id: string;
          user_id: string;
          platform: string;
          date: string;
          summary: string | null;
          messages: string;
          created_at: number;
        }>('SELECT * FROM conversation_logs');

        for (const row of rows) {
          db.run(
            `
            INSERT OR IGNORE INTO daily_logs (
              id, userId, channel, date, summary, messageCount, topics, createdAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              row.id,
              row.user_id,
              row.platform,
              row.date,
              row.summary || '',
              0,
              JSON.stringify([]),
              new Date(row.created_at).toISOString(),
            ]
          );
        }
      };

      createCoreTables();
      createAuxTables();
      ensureIndexes();

      if (tableExists('users')) alignUsers();
      if (tableExists('sessions')) alignSessions();
      if (tableExists('alerts')) alignAlerts();
      if (tableExists('positions')) alignPositions();
      if (tableExists('trading_credentials')) alignTradingCredentials();
      if (tableExists('pairing_requests') && tableExists('paired_users')) alignPairing();
      if (tableExists('markets')) alignMarketCache();
      if (tableExists('user_memory')) migrateLegacyMemory();
      if (tableExists('daily_logs')) migrateLegacyLogs();
    },
    down: '',
  },
  {
    version: 9,
    name: 'cron_jobs_and_alert_targets',
    up: (db) => {
      const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
      const ensureIdentifier = (name: string) => {
        if (!identifier.test(name)) {
          throw new Error(`Unsafe SQL identifier: ${name}`);
        }
      };

      const getColumns = (table: string): string[] => {
        ensureIdentifier(table);
        const rows = db.query<{ name: string }>(`PRAGMA table_info(${table})`);
        return Array.isArray(rows) ? rows.map((row) => row.name) : [];
      };

      const addColumnIfMissing = (table: string, column: string, type: string, defaultSql?: string) => {
        ensureIdentifier(table);
        ensureIdentifier(column);
        const columns = getColumns(table);
        if (columns.includes(column)) return;
        const defaultClause = defaultSql ? ` DEFAULT ${defaultSql}` : '';
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}${defaultClause}`);
      };

      addColumnIfMissing('alerts', 'channel', 'TEXT');
      addColumnIfMissing('alerts', 'chat_id', 'TEXT');

      db.run(`
        CREATE TABLE IF NOT EXISTS cron_jobs (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          enabled INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    },
    down: `
      DROP TABLE IF EXISTS cron_jobs;
    `,
  },
  {
    version: 10,
    name: 'stop_loss_triggers',
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS stop_loss_triggers (
          user_id TEXT NOT NULL,
          platform TEXT NOT NULL,
          outcome_id TEXT NOT NULL,
          market_id TEXT,
          status TEXT NOT NULL,
          triggered_at INTEGER NOT NULL,
          last_price REAL,
          last_error TEXT,
          cooldown_until INTEGER,
          PRIMARY KEY (user_id, platform, outcome_id)
        );
      `);
    },
    down: `
      DROP TABLE IF EXISTS stop_loss_triggers;
    `,
  },
  {
    version: 11,
    name: 'portfolio_snapshots',
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS portfolio_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          total_value REAL NOT NULL,
          total_pnl REAL NOT NULL,
          total_pnl_pct REAL NOT NULL,
          total_cost_basis REAL NOT NULL,
          positions_count INTEGER NOT NULL,
          by_platform TEXT,
          created_at INTEGER NOT NULL
        );
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user ON portfolio_snapshots(user_id);');
      db.run('CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_created_at ON portfolio_snapshots(created_at);');
    },
    down: `
      DROP TABLE IF EXISTS portfolio_snapshots;
    `,
  },
  {
    version: 12,
    name: 'swarm_presets',
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS swarm_presets (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('strategy', 'token', 'wallet_group')),
          description TEXT,
          config TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(user_id, name)
        );
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_swarm_presets_user ON swarm_presets(user_id);');
      db.run('CREATE INDEX IF NOT EXISTS idx_swarm_presets_type ON swarm_presets(user_id, type);');
    },
    down: `
      DROP TABLE IF EXISTS swarm_presets;
    `,
  },
  {
    version: 13,
    name: 'acp_commerce_tables',
    // NOTE: ACP tables now self-create on init (persistence.ts, identity.ts, predictions.ts)
    // This migration kept for backwards compat with existing DBs
    up: (db) => {
      // Agent profiles for commerce registry
      db.run(`
        CREATE TABLE IF NOT EXISTS acp_agents (
          id TEXT PRIMARY KEY,
          address TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          description TEXT,
          avatar TEXT,
          website TEXT,
          capabilities TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          total_transactions INTEGER NOT NULL DEFAULT 0,
          successful_transactions INTEGER NOT NULL DEFAULT 0,
          average_rating REAL NOT NULL DEFAULT 0,
          total_ratings INTEGER NOT NULL DEFAULT 0,
          dispute_rate REAL NOT NULL DEFAULT 0,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_agents_address ON acp_agents(address);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_agents_status ON acp_agents(status);');

      // Service listings
      db.run(`
        CREATE TABLE IF NOT EXISTS acp_services (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          capability_name TEXT NOT NULL,
          capability_category TEXT NOT NULL,
          capability_description TEXT,
          pricing_model TEXT NOT NULL,
          pricing_amount TEXT NOT NULL,
          pricing_currency TEXT NOT NULL,
          description TEXT NOT NULL,
          endpoint TEXT,
          sla_availability REAL,
          sla_response_time INTEGER,
          sla_throughput INTEGER,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (agent_id) REFERENCES acp_agents(id)
        );
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_services_agent ON acp_services(agent_id);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_services_category ON acp_services(capability_category);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_services_enabled ON acp_services(enabled);');

      // Proof-of-agreement records
      db.run(`
        CREATE TABLE IF NOT EXISTS acp_agreements (
          id TEXT PRIMARY KEY,
          hash TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          parties TEXT NOT NULL,
          terms TEXT NOT NULL,
          total_value TEXT,
          currency TEXT,
          start_date INTEGER,
          end_date INTEGER,
          escrow_id TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          version INTEGER NOT NULL DEFAULT 1,
          previous_version_hash TEXT,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_agreements_hash ON acp_agreements(hash);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_agreements_status ON acp_agreements(status);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_agreements_escrow ON acp_agreements(escrow_id);');

      // Escrow transactions
      db.run(`
        CREATE TABLE IF NOT EXISTS acp_escrows (
          id TEXT PRIMARY KEY,
          chain TEXT NOT NULL,
          buyer TEXT NOT NULL,
          seller TEXT NOT NULL,
          arbiter TEXT,
          amount TEXT NOT NULL,
          token_mint TEXT,
          release_conditions TEXT NOT NULL,
          refund_conditions TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          description TEXT,
          agreement_hash TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          escrow_address TEXT,
          tx_signatures TEXT,
          funded_at INTEGER,
          completed_at INTEGER,
          created_at INTEGER NOT NULL
        );
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_escrows_buyer ON acp_escrows(buyer);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_escrows_seller ON acp_escrows(seller);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_escrows_status ON acp_escrows(status);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_escrows_agreement ON acp_escrows(agreement_hash);');

      // Service ratings
      db.run(`
        CREATE TABLE IF NOT EXISTS acp_ratings (
          id TEXT PRIMARY KEY,
          service_id TEXT NOT NULL,
          rater_address TEXT NOT NULL,
          rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
          comment TEXT,
          agreement_id TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (service_id) REFERENCES acp_services(id),
          UNIQUE(service_id, rater_address, agreement_id)
        );
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_ratings_service ON acp_ratings(service_id);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_ratings_rater ON acp_ratings(rater_address);');
    },
    down: `
      DROP TABLE IF EXISTS acp_ratings;
      DROP TABLE IF EXISTS acp_escrows;
      DROP TABLE IF EXISTS acp_agreements;
      DROP TABLE IF EXISTS acp_services;
      DROP TABLE IF EXISTS acp_agents;
    `,
  },
  // Migration 14: ACP Identity System - handles, takeovers, referrals
  // NOTE: Identity tables now self-create on init (identity.ts)
  // This migration kept for backwards compat with existing DBs
  {
    version: 14,
    name: 'acp_identity_system',
    up: (db: Database) => {
      // Handles - unique @name identifiers
      db.run(`
        CREATE TABLE IF NOT EXISTS acp_handles (
          handle TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES acp_agents(id),
          owner_address TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          transferred_at INTEGER,
          previous_owner TEXT,
          UNIQUE(handle)
        );
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_handles_owner ON acp_handles(owner_address);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_handles_agent ON acp_handles(agent_id);');

      // Takeover bids - offers to buy handles
      db.run(`
        CREATE TABLE IF NOT EXISTS acp_takeover_bids (
          id TEXT PRIMARY KEY,
          handle TEXT NOT NULL REFERENCES acp_handles(handle),
          bidder_address TEXT NOT NULL,
          amount TEXT NOT NULL,
          currency TEXT NOT NULL DEFAULT 'SOL',
          escrow_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER
        );
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_bids_handle ON acp_takeover_bids(handle);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_bids_bidder ON acp_takeover_bids(bidder_address);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_bids_status ON acp_takeover_bids(status);');

      // Referrals - who referred who, fee sharing
      db.run(`
        CREATE TABLE IF NOT EXISTS acp_referrals (
          id TEXT PRIMARY KEY,
          referrer_address TEXT NOT NULL,
          referred_agent_id TEXT NOT NULL REFERENCES acp_agents(id),
          referral_code TEXT NOT NULL,
          fee_share_bps INTEGER NOT NULL DEFAULT 500,
          total_earned TEXT NOT NULL DEFAULT '0',
          created_at INTEGER NOT NULL,
          UNIQUE(referred_agent_id)
        );
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_referrals_referrer ON acp_referrals(referrer_address);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_referrals_code ON acp_referrals(referral_code);');

      // Agent profiles - public profile data
      db.run(`
        CREATE TABLE IF NOT EXISTS acp_profiles (
          agent_id TEXT PRIMARY KEY REFERENCES acp_agents(id),
          handle TEXT REFERENCES acp_handles(handle),
          display_name TEXT,
          bio TEXT,
          avatar_url TEXT,
          website_url TEXT,
          twitter_handle TEXT,
          github_handle TEXT,
          featured INTEGER NOT NULL DEFAULT 0,
          verified INTEGER NOT NULL DEFAULT 0,
          total_revenue TEXT NOT NULL DEFAULT '0',
          total_transactions INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_profiles_handle ON acp_profiles(handle);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_profiles_featured ON acp_profiles(featured);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_profiles_verified ON acp_profiles(verified);');

      // Leaderboard cache - precomputed rankings
      db.run(`
        CREATE TABLE IF NOT EXISTS acp_leaderboard (
          agent_id TEXT PRIMARY KEY REFERENCES acp_agents(id),
          handle TEXT,
          rank_revenue INTEGER,
          rank_transactions INTEGER,
          rank_rating INTEGER,
          score REAL NOT NULL DEFAULT 0,
          period TEXT NOT NULL DEFAULT 'all_time',
          updated_at INTEGER NOT NULL
        );
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_leaderboard_score ON acp_leaderboard(score DESC);');
      db.run('CREATE INDEX IF NOT EXISTS idx_acp_leaderboard_period ON acp_leaderboard(period);');
    },
    down: `
      DROP TABLE IF EXISTS acp_leaderboard;
      DROP TABLE IF EXISTS acp_profiles;
      DROP TABLE IF EXISTS acp_referrals;
      DROP TABLE IF EXISTS acp_takeover_bids;
      DROP TABLE IF EXISTS acp_handles;
    `,
  },
  // Note: Prediction tables are created directly by src/acp/predictions.ts on init
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

function ensureSchemaVersionTable(db: Database): void {
  db.run('CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL, applied_at INTEGER NOT NULL)');
}

function getLegacySchemaVersion(db: Database): number {
  try {
    const rows = db.query<{ version: number }>(
      'SELECT version FROM _schema_version ORDER BY version DESC LIMIT 1'
    );
    return rows[0]?.version || 0;
  } catch {
    return 0;
  }
}

export function createMigrationRunner(db: Database): MigrationRunner {
  ensureSchemaVersionTable(db);
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
    const current = results[0]?.version || 0;
    if (current > 0) return current;
    return getLegacySchemaVersion(db);
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
      if (typeof migration.up === 'string') {
        // Execute migration SQL (may contain multiple statements)
        const statements = migration.up
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const sql of statements) {
          db.run(sql);
        }
      } else {
        migration.up(db);
      }

      // Record migration
      db.run(
        'INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.name, Date.now()]
      );
      ensureSchemaVersionTable(db);
      db.run('INSERT INTO _schema_version (version, applied_at) VALUES (?, ?)', [migration.version, Date.now()]);

      logger.info({ version: migration.version }, 'Migration applied');
    } catch (error) {
      logger.error({ error, version: migration.version }, 'Migration failed');
      throw error;
    }
  }

  function revertMigration(migration: Migration): void {
    logger.info({ version: migration.version, name: migration.name }, 'Reverting migration');

    try {
      if (typeof migration.down === 'string') {
        const statements = migration.down
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const sql of statements) {
          db.run(sql);
        }
      } else {
        migration.down(db);
      }

      db.run('DELETE FROM _migrations WHERE version = ?', [migration.version]);
      ensureSchemaVersionTable(db);
      db.run('INSERT INTO _schema_version (version, applied_at) VALUES (?, ?)', [
        migration.version - 1,
        Date.now(),
      ]);

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
