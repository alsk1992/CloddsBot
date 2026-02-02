/**
 * TimescaleDB Connection Pool
 * Manages PostgreSQL/TimescaleDB connections with automatic reconnection
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { logger } from '../../utils/logger';

export interface TimescaleClient {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  getClient(): Promise<PoolClient>;
  isConnected(): boolean;
  close(): Promise<void>;
}

export interface TimescaleConfig {
  connectionString: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

export function createTimescaleClient(config: TimescaleConfig): TimescaleClient {
  let pool: Pool | null = null;
  let connected = false;

  const initPool = () => {
    if (pool) return;

    pool = new Pool({
      connectionString: config.connectionString,
      max: config.maxConnections ?? 10,
      idleTimeoutMillis: config.idleTimeoutMs ?? 30000,
      connectionTimeoutMillis: config.connectionTimeoutMs ?? 10000,
    });

    pool.on('connect', () => {
      connected = true;
      logger.debug('TimescaleDB client connected');
    });

    pool.on('error', (err) => {
      connected = false;
      logger.error({ err }, 'TimescaleDB pool error');
    });

    pool.on('remove', () => {
      // Check if we still have active connections
      if (pool && pool.totalCount === 0) {
        connected = false;
      }
    });
  };

  const ensurePool = (): Pool => {
    if (!pool) {
      initPool();
    }
    return pool!;
  };

  return {
    async query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      const p = ensurePool();
      try {
        const result = await p.query<T>(sql, params);
        connected = true;
        return result;
      } catch (err) {
        connected = false;
        throw err;
      }
    },

    async getClient(): Promise<PoolClient> {
      const p = ensurePool();
      const client = await p.connect();
      connected = true;
      return client;
    },

    isConnected(): boolean {
      return connected && pool !== null && pool.totalCount > 0;
    },

    async close(): Promise<void> {
      if (pool) {
        await pool.end();
        pool = null;
        connected = false;
        logger.info('TimescaleDB pool closed');
      }
    },
  };
}

/**
 * Health check for TimescaleDB connection
 */
export async function checkTimescaleHealth(client: TimescaleClient): Promise<{
  connected: boolean;
  version?: string;
  timescaleVersion?: string;
  error?: string;
}> {
  try {
    const versionResult = await client.query<{ version: string }>('SELECT version()');
    const pgVersion = versionResult.rows[0]?.version;

    // Try to get TimescaleDB version (will fail if not installed)
    let timescaleVersion: string | undefined;
    try {
      const tsResult = await client.query<{ extversion: string }>(
        "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'"
      );
      timescaleVersion = tsResult.rows[0]?.extversion;
    } catch {
      // TimescaleDB extension not installed - that's OK, we can work without it
    }

    return {
      connected: true,
      version: pgVersion,
      timescaleVersion,
    };
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
