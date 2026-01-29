/**
 * Custom Tracking - Easily add columns and metrics to track
 *
 * Features:
 * - Define custom columns without schema changes
 * - Track any metric per trade/bot/signal
 * - Time-series tracking for custom values
 * - Easy hooks in bot code
 * - Query and aggregate custom data
 */

import { Database } from '../db/index';
import { logger } from '../utils/logger';
import type { Platform } from '../types';

// =============================================================================
// TYPES
// =============================================================================

export type TrackingValueType = 'number' | 'string' | 'boolean' | 'json';

export interface TrackingColumn {
  /** Column name (snake_case) */
  name: string;
  /** Display name */
  label: string;
  /** Value type */
  type: TrackingValueType;
  /** Description */
  description?: string;
  /** Default value */
  defaultValue?: unknown;
  /** Category for grouping */
  category?: string;
  /** Whether to show in summaries */
  showInSummary?: boolean;
  /** Aggregation method for summaries */
  aggregation?: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'last';
}

export interface TrackingEntry {
  /** Entity type (trade, bot, signal, position, custom) */
  entityType: string;
  /** Entity ID */
  entityId: string;
  /** Column name */
  column: string;
  /** Value */
  value: unknown;
  /** Timestamp */
  timestamp: Date;
  /** Optional metadata */
  meta?: Record<string, unknown>;
}

export interface TimeSeriesPoint {
  timestamp: Date;
  value: number;
  meta?: Record<string, unknown>;
}

export interface TrackingQuery {
  entityType?: string;
  entityId?: string;
  column?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

export interface TrackingManager {
  // Column management
  /** Define a new tracking column */
  defineColumn(column: TrackingColumn): void;

  /** Get all defined columns */
  getColumns(category?: string): TrackingColumn[];

  /** Remove a column definition */
  removeColumn(name: string): void;

  // Data tracking
  /** Track a value */
  track(entry: Omit<TrackingEntry, 'timestamp'>): void;

  /** Track multiple values at once */
  trackBatch(entries: Array<Omit<TrackingEntry, 'timestamp'>>): void;

  /** Get tracked values */
  get(query: TrackingQuery): TrackingEntry[];

  /** Get latest value for an entity+column */
  getLatest(entityType: string, entityId: string, column: string): unknown;

  /** Get time series for a column */
  getTimeSeries(
    entityType: string,
    entityId: string,
    column: string,
    startDate?: Date,
    endDate?: Date
  ): TimeSeriesPoint[];

  // Aggregations
  /** Get summary stats for a column */
  getSummary(column: string, entityType?: string): {
    count: number;
    sum?: number;
    avg?: number;
    min?: number;
    max?: number;
    latest?: unknown;
  };

  /** Get aggregated values grouped by entity */
  getByEntity(column: string, aggregation: TrackingColumn['aggregation']): Array<{
    entityType: string;
    entityId: string;
    value: unknown;
  }>;

  // Convenience methods for common tracking
  /** Track a trade metric */
  trackTrade(tradeId: string, column: string, value: unknown, meta?: Record<string, unknown>): void;

  /** Track a bot metric */
  trackBot(botId: string, column: string, value: unknown, meta?: Record<string, unknown>): void;

  /** Track a signal metric */
  trackSignal(signalId: string, column: string, value: unknown, meta?: Record<string, unknown>): void;

  /** Track a custom time series */
  trackTimeSeries(seriesName: string, value: number, meta?: Record<string, unknown>): void;

  // Export
  /** Export tracking data to CSV */
  exportCsv(query?: TrackingQuery): string;

  /** Export column definitions */
  exportSchema(): string;
}

// =============================================================================
// PREDEFINED COLUMNS
// =============================================================================

export const BUILTIN_COLUMNS: TrackingColumn[] = [
  // Trade columns
  {
    name: 'slippage_pct',
    label: 'Slippage %',
    type: 'number',
    category: 'trade',
    description: 'Difference between expected and actual fill price',
    aggregation: 'avg',
    showInSummary: true,
  },
  {
    name: 'latency_ms',
    label: 'Latency (ms)',
    type: 'number',
    category: 'trade',
    description: 'Time from signal to fill',
    aggregation: 'avg',
    showInSummary: true,
  },
  {
    name: 'market_sentiment',
    label: 'Market Sentiment',
    type: 'string',
    category: 'trade',
    description: 'Market sentiment at time of trade (bullish/bearish/neutral)',
  },
  {
    name: 'confidence_score',
    label: 'Confidence',
    type: 'number',
    category: 'trade',
    description: 'Strategy confidence in the trade (0-1)',
    aggregation: 'avg',
  },
  {
    name: 'volatility',
    label: 'Volatility',
    type: 'number',
    category: 'trade',
    description: 'Market volatility at entry',
    aggregation: 'avg',
  },
  {
    name: 'spread_at_entry',
    label: 'Spread at Entry',
    type: 'number',
    category: 'trade',
    description: 'Bid-ask spread when entering',
    aggregation: 'avg',
  },

  // Bot columns
  {
    name: 'signals_generated',
    label: 'Signals Generated',
    type: 'number',
    category: 'bot',
    description: 'Total signals generated this session',
    aggregation: 'sum',
  },
  {
    name: 'signals_executed',
    label: 'Signals Executed',
    type: 'number',
    category: 'bot',
    description: 'Signals that resulted in trades',
    aggregation: 'sum',
  },
  {
    name: 'signals_skipped',
    label: 'Signals Skipped',
    type: 'number',
    category: 'bot',
    description: 'Signals skipped (risk limits, etc)',
    aggregation: 'sum',
  },
  {
    name: 'evaluation_time_ms',
    label: 'Eval Time (ms)',
    type: 'number',
    category: 'bot',
    description: 'Time to evaluate strategy',
    aggregation: 'avg',
  },
  {
    name: 'memory_usage_mb',
    label: 'Memory (MB)',
    type: 'number',
    category: 'bot',
    description: 'Memory usage',
    aggregation: 'last',
  },

  // Market columns
  {
    name: 'volume_24h',
    label: 'Volume 24h',
    type: 'number',
    category: 'market',
    description: '24h trading volume',
    aggregation: 'last',
  },
  {
    name: 'liquidity_score',
    label: 'Liquidity',
    type: 'number',
    category: 'market',
    description: 'Liquidity score (0-100)',
    aggregation: 'avg',
  },
  {
    name: 'price_impact',
    label: 'Price Impact',
    type: 'number',
    category: 'market',
    description: 'Estimated price impact of trade',
    aggregation: 'avg',
  },

  // Custom/user columns
  {
    name: 'notes',
    label: 'Notes',
    type: 'string',
    category: 'custom',
    description: 'Free-form notes',
  },
  {
    name: 'tags',
    label: 'Tags',
    type: 'json',
    category: 'custom',
    description: 'Custom tags array',
  },
  {
    name: 'external_id',
    label: 'External ID',
    type: 'string',
    category: 'custom',
    description: 'ID from external system',
  },
];

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createTrackingManager(db: Database): TrackingManager {
  const columns = new Map<string, TrackingColumn>();

  // Initialize tables
  db.run(`
    CREATE TABLE IF NOT EXISTS tracking_columns (
      name TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      default_value TEXT,
      category TEXT,
      show_in_summary INTEGER DEFAULT 0,
      aggregation TEXT,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tracking_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      column_name TEXT NOT NULL,
      value_text TEXT,
      value_number REAL,
      value_json TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_tracking_entity ON tracking_data(entity_type, entity_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tracking_column ON tracking_data(column_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tracking_time ON tracking_data(created_at)`);

  // Load existing columns
  try {
    const rows = db.query<any>(`SELECT * FROM tracking_columns`);
    for (const row of rows) {
      columns.set(row.name, {
        name: row.name,
        label: row.label,
        type: row.type as TrackingValueType,
        description: row.description,
        defaultValue: row.default_value ? JSON.parse(row.default_value) : undefined,
        category: row.category,
        showInSummary: row.show_in_summary === 1,
        aggregation: row.aggregation as TrackingColumn['aggregation'],
      });
    }
  } catch {
    // First run
  }

  // Register built-in columns if not exists
  for (const col of BUILTIN_COLUMNS) {
    if (!columns.has(col.name)) {
      columns.set(col.name, col);
      db.run(
        `INSERT OR IGNORE INTO tracking_columns
         (name, label, type, description, default_value, category, show_in_summary, aggregation, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          col.name,
          col.label,
          col.type,
          col.description || null,
          col.defaultValue !== undefined ? JSON.stringify(col.defaultValue) : null,
          col.category || null,
          col.showInSummary ? 1 : 0,
          col.aggregation || null,
          new Date().toISOString(),
        ]
      );
    }
  }

  function storeValue(entry: TrackingEntry): void {
    const col = columns.get(entry.column);
    const type = col?.type || 'string';

    let valueText: string | null = null;
    let valueNumber: number | null = null;
    let valueJson: string | null = null;

    switch (type) {
      case 'number':
        valueNumber = typeof entry.value === 'number' ? entry.value : parseFloat(String(entry.value));
        break;
      case 'boolean':
        valueNumber = entry.value ? 1 : 0;
        break;
      case 'json':
        valueJson = JSON.stringify(entry.value);
        break;
      default:
        valueText = String(entry.value);
    }

    db.run(
      `INSERT INTO tracking_data
       (entity_type, entity_id, column_name, value_text, value_number, value_json, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.entityType,
        entry.entityId,
        entry.column,
        valueText,
        valueNumber,
        valueJson,
        entry.meta ? JSON.stringify(entry.meta) : null,
        entry.timestamp.toISOString(),
      ]
    );
  }

  function parseValue(row: any, type: TrackingValueType): unknown {
    switch (type) {
      case 'number':
        return row.value_number;
      case 'boolean':
        return row.value_number === 1;
      case 'json':
        return row.value_json ? JSON.parse(row.value_json) : null;
      default:
        return row.value_text;
    }
  }

  return {
    defineColumn(column) {
      columns.set(column.name, column);

      db.run(
        `INSERT OR REPLACE INTO tracking_columns
         (name, label, type, description, default_value, category, show_in_summary, aggregation, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM tracking_columns WHERE name = ?), ?))`,
        [
          column.name,
          column.label,
          column.type,
          column.description || null,
          column.defaultValue !== undefined ? JSON.stringify(column.defaultValue) : null,
          column.category || null,
          column.showInSummary ? 1 : 0,
          column.aggregation || null,
          column.name,
          new Date().toISOString(),
        ]
      );

      logger.info({ column: column.name, type: column.type }, 'Tracking column defined');
    },

    getColumns(category) {
      const all = Array.from(columns.values());
      return category ? all.filter((c) => c.category === category) : all;
    },

    removeColumn(name) {
      columns.delete(name);
      db.run(`DELETE FROM tracking_columns WHERE name = ?`, [name]);
      // Optionally delete data: db.run(`DELETE FROM tracking_data WHERE column_name = ?`, [name]);
    },

    track(entry) {
      const fullEntry: TrackingEntry = {
        ...entry,
        timestamp: new Date(),
      };
      storeValue(fullEntry);
    },

    trackBatch(entries) {
      const timestamp = new Date();
      for (const entry of entries) {
        storeValue({ ...entry, timestamp });
      }
    },

    get(query) {
      let sql = `SELECT * FROM tracking_data WHERE 1=1`;
      const params: any[] = [];

      if (query.entityType) {
        sql += ` AND entity_type = ?`;
        params.push(query.entityType);
      }
      if (query.entityId) {
        sql += ` AND entity_id = ?`;
        params.push(query.entityId);
      }
      if (query.column) {
        sql += ` AND column_name = ?`;
        params.push(query.column);
      }
      if (query.startDate) {
        sql += ` AND created_at >= ?`;
        params.push(query.startDate.toISOString());
      }
      if (query.endDate) {
        sql += ` AND created_at <= ?`;
        params.push(query.endDate.toISOString());
      }

      sql += ` ORDER BY created_at DESC`;

      if (query.limit) {
        sql += ` LIMIT ?`;
        params.push(query.limit);
      }

      const rows = db.query<any>(sql, params);

      return rows.map((row) => {
        const col = columns.get(row.column_name);
        return {
          entityType: row.entity_type,
          entityId: row.entity_id,
          column: row.column_name,
          value: parseValue(row, col?.type || 'string'),
          timestamp: new Date(row.created_at),
          meta: row.meta_json ? JSON.parse(row.meta_json) : undefined,
        };
      });
    },

    getLatest(entityType, entityId, column) {
      const rows = db.query<any>(
        `SELECT * FROM tracking_data
         WHERE entity_type = ? AND entity_id = ? AND column_name = ?
         ORDER BY created_at DESC LIMIT 1`,
        [entityType, entityId, column]
      );

      if (rows.length === 0) return undefined;

      const col = columns.get(column);
      return parseValue(rows[0], col?.type || 'string');
    },

    getTimeSeries(entityType, entityId, column, startDate, endDate) {
      let sql = `SELECT created_at, value_number, meta_json FROM tracking_data
                 WHERE entity_type = ? AND entity_id = ? AND column_name = ?`;
      const params: any[] = [entityType, entityId, column];

      if (startDate) {
        sql += ` AND created_at >= ?`;
        params.push(startDate.toISOString());
      }
      if (endDate) {
        sql += ` AND created_at <= ?`;
        params.push(endDate.toISOString());
      }

      sql += ` ORDER BY created_at ASC`;

      const rows = db.query<any>(sql, params);

      return rows.map((row) => ({
        timestamp: new Date(row.created_at),
        value: row.value_number || 0,
        meta: row.meta_json ? JSON.parse(row.meta_json) : undefined,
      }));
    },

    getSummary(column, entityType) {
      let sql = `SELECT
        COUNT(*) as count,
        SUM(value_number) as sum,
        AVG(value_number) as avg,
        MIN(value_number) as min,
        MAX(value_number) as max
       FROM tracking_data WHERE column_name = ?`;
      const params: any[] = [column];

      if (entityType) {
        sql += ` AND entity_type = ?`;
        params.push(entityType);
      }

      const rows = db.query<any>(sql, params);
      const row = rows[0] || {};

      // Get latest
      const latestRows = db.query<any>(
        `SELECT * FROM tracking_data WHERE column_name = ? ORDER BY created_at DESC LIMIT 1`,
        [column]
      );
      const col = columns.get(column);
      const latest = latestRows.length > 0 ? parseValue(latestRows[0], col?.type || 'string') : undefined;

      return {
        count: row.count || 0,
        sum: row.sum,
        avg: row.avg,
        min: row.min,
        max: row.max,
        latest,
      };
    },

    getByEntity(column, aggregation = 'last') {
      const aggFunc = {
        sum: 'SUM(value_number)',
        avg: 'AVG(value_number)',
        min: 'MIN(value_number)',
        max: 'MAX(value_number)',
        count: 'COUNT(*)',
        last: 'value_number', // Will use subquery
      }[aggregation || 'last'];

      let sql: string;
      if (aggregation === 'last') {
        sql = `SELECT entity_type, entity_id, value_number as value, value_text, value_json
               FROM tracking_data t1
               WHERE column_name = ?
               AND created_at = (
                 SELECT MAX(created_at) FROM tracking_data t2
                 WHERE t2.entity_type = t1.entity_type
                 AND t2.entity_id = t1.entity_id
                 AND t2.column_name = t1.column_name
               )`;
      } else {
        sql = `SELECT entity_type, entity_id, ${aggFunc} as value
               FROM tracking_data
               WHERE column_name = ?
               GROUP BY entity_type, entity_id`;
      }

      const rows = db.query<any>(sql, [column]);
      const col = columns.get(column);

      return rows.map((row) => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
        value: aggregation === 'last' ? parseValue(row, col?.type || 'string') : row.value,
      }));
    },

    trackTrade(tradeId, column, value, meta) {
      this.track({ entityType: 'trade', entityId: tradeId, column, value, meta });
    },

    trackBot(botId, column, value, meta) {
      this.track({ entityType: 'bot', entityId: botId, column, value, meta });
    },

    trackSignal(signalId, column, value, meta) {
      this.track({ entityType: 'signal', entityId: signalId, column, value, meta });
    },

    trackTimeSeries(seriesName, value, meta) {
      this.track({ entityType: 'timeseries', entityId: seriesName, column: 'value', value, meta });
    },

    exportCsv(query = {}) {
      const entries = this.get({ ...query, limit: query.limit || 10000 });

      const headers = ['entity_type', 'entity_id', 'column', 'value', 'timestamp'];
      const rows = entries.map((e) => [
        e.entityType,
        e.entityId,
        e.column,
        typeof e.value === 'object' ? JSON.stringify(e.value) : String(e.value),
        e.timestamp.toISOString(),
      ]);

      return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    },

    exportSchema() {
      const cols = this.getColumns();
      return JSON.stringify(cols, null, 2);
    },
  };
}

// =============================================================================
// TRACKING HOOKS FOR STRATEGIES
// =============================================================================

export interface TrackingHooks {
  /** Called before trade execution */
  beforeTrade?: (context: {
    signal: any;
    market: any;
    tracking: TrackingManager;
  }) => Record<string, unknown>;

  /** Called after trade execution */
  afterTrade?: (context: {
    trade: any;
    result: any;
    tracking: TrackingManager;
  }) => Record<string, unknown>;

  /** Called on each strategy evaluation */
  onEvaluate?: (context: {
    strategyId: string;
    signals: any[];
    duration: number;
    tracking: TrackingManager;
  }) => Record<string, unknown>;

  /** Called on position update */
  onPositionUpdate?: (context: {
    position: any;
    tracking: TrackingManager;
  }) => Record<string, unknown>;
}

/**
 * Create a strategy wrapper that auto-tracks metrics
 */
export function withTracking<T extends { evaluate: Function }>(
  strategy: T,
  tracking: TrackingManager,
  hooks?: TrackingHooks
): T {
  const original = strategy.evaluate.bind(strategy);

  (strategy as any).evaluate = async function (...args: any[]) {
    const startTime = Date.now();

    const signals = await original(...args);

    const duration = Date.now() - startTime;

    // Track evaluation time
    tracking.trackBot((strategy as any).config?.id || 'unknown', 'evaluation_time_ms', duration);

    // Track signals
    tracking.trackBot((strategy as any).config?.id || 'unknown', 'signals_generated', signals.length);

    // Call hook
    if (hooks?.onEvaluate) {
      const extra = hooks.onEvaluate({
        strategyId: (strategy as any).config?.id || 'unknown',
        signals,
        duration,
        tracking,
      });

      if (extra) {
        for (const [key, value] of Object.entries(extra)) {
          tracking.trackBot((strategy as any).config?.id || 'unknown', key, value);
        }
      }
    }

    return signals;
  };

  return strategy;
}
