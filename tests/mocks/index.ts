/**
 * Test Mocks and Fixtures
 *
 * Reusable mock utilities for Clodds test suite.
 */

import type { LedgerDb } from '../../src/ledger/storage';
import type {
  DecisionRecord,
  DecisionCategory,
  DecisionOutcome,
  ConstraintEvaluation,
  LedgerConfig,
  ApiKeyData,
  SubscriptionTier,
} from '../../src/ledger/types';

// =============================================================================
// IN-MEMORY DATABASE MOCK
// =============================================================================

export interface MockRow {
  [key: string]: unknown;
}

export function createMockDb(): LedgerDb & {
  tables: Map<string, MockRow[]>;
  queries: string[];
  reset(): void;
} {
  const tables = new Map<string, MockRow[]>();
  const queries: string[] = [];

  function parseInsert(sql: string, params: unknown[]): { table: string; row: MockRow } | null {
    const match = sql.match(/INSERT INTO (\w+)\s*\(([^)]+)\)/i);
    if (!match) return null;

    const table = match[1];
    const columns = match[2].split(',').map(c => c.trim());
    const row: MockRow = {};

    columns.forEach((col, i) => {
      row[col] = params[i];
    });

    return { table, row };
  }

  function parseSelect(sql: string, params: unknown[]): { table: string; where: Record<string, unknown> } | null {
    const tableMatch = sql.match(/FROM (\w+)/i);
    if (!tableMatch) return null;

    const table = tableMatch[1];
    const where: Record<string, unknown> = {};

    // Simple WHERE parsing
    const whereMatch = sql.match(/WHERE (.+?)(?:ORDER|LIMIT|GROUP|$)/i);
    if (whereMatch && params.length > 0) {
      const conditions = whereMatch[1].split(/AND/i);
      let paramIndex = 0;

      for (const cond of conditions) {
        const colMatch = cond.match(/(\w+)\s*=\s*\?/);
        if (colMatch && paramIndex < params.length) {
          where[colMatch[1]] = params[paramIndex++];
        }
      }
    }

    return { table, where };
  }

  return {
    tables,
    queries,

    run(sql: string, params: unknown[] = []): void {
      queries.push(sql);

      if (sql.trim().toUpperCase().startsWith('CREATE')) {
        const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
        if (match && !tables.has(match[1])) {
          tables.set(match[1], []);
        }
        return;
      }

      if (sql.trim().toUpperCase().startsWith('INSERT')) {
        const parsed = parseInsert(sql, params);
        if (parsed) {
          if (!tables.has(parsed.table)) {
            tables.set(parsed.table, []);
          }
          tables.get(parsed.table)!.push(parsed.row);
        }
        return;
      }

      if (sql.trim().toUpperCase().startsWith('UPDATE')) {
        const tableMatch = sql.match(/UPDATE (\w+)/i);
        if (!tableMatch) return;

        const table = tableMatch[1];
        const rows = tables.get(table) || [];

        // Simple update: find by id (last param) and update
        const idParam = params[params.length - 1];
        const row = rows.find(r => r.id === idParam);
        if (row) {
          // Extract SET fields
          const setMatch = sql.match(/SET (.+?) WHERE/i);
          if (setMatch) {
            const setFields = setMatch[1].split(',');
            let paramIndex = 0;
            for (const field of setFields) {
              const colMatch = field.match(/(\w+)\s*=\s*\?/);
              if (colMatch && paramIndex < params.length - 1) {
                row[colMatch[1]] = params[paramIndex++];
              }
            }
          }
        }
        return;
      }

      if (sql.trim().toUpperCase().startsWith('DELETE')) {
        const tableMatch = sql.match(/DELETE FROM (\w+)/i);
        if (!tableMatch) return;

        const table = tableMatch[1];
        const rows = tables.get(table) || [];

        // Simple delete by condition
        if (params.length > 0) {
          const newRows = rows.filter(r => {
            // Check timestamp condition
            if (sql.includes('timestamp <')) {
              return (r.timestamp as number) >= (params[0] as number);
            }
            return true;
          });
          tables.set(table, newRows);
        }
        return;
      }
    },

    get<T>(sql: string, params: unknown[] = []): T | undefined {
      queries.push(sql);

      const parsed = parseSelect(sql, params);
      if (!parsed) return undefined;

      const rows = tables.get(parsed.table) || [];

      // Handle aggregate functions
      if (sql.toUpperCase().includes('COUNT(*)')) {
        let filtered = rows;
        if (Object.keys(parsed.where).length > 0) {
          filtered = rows.filter(row =>
            Object.entries(parsed.where).every(([k, v]) => row[k] === v)
          );
        }
        return { count: filtered.length } as T;
      }

      if (sql.toUpperCase().includes('AVG(')) {
        const avgMatch = sql.match(/AVG\((\w+)\)/i);
        if (avgMatch) {
          const col = avgMatch[1];
          let filtered = rows.filter(r => r[col] !== null && r[col] !== undefined);
          if (Object.keys(parsed.where).length > 0) {
            filtered = filtered.filter(row =>
              Object.entries(parsed.where).every(([k, v]) => row[k] === v)
            );
          }
          const sum = filtered.reduce((acc, r) => acc + (r[col] as number), 0);
          return { avg: filtered.length > 0 ? sum / filtered.length : null } as T;
        }
      }

      if (sql.toUpperCase().includes('SUM(')) {
        let filtered = rows;
        if (Object.keys(parsed.where).length > 0) {
          filtered = rows.filter(row =>
            Object.entries(parsed.where).every(([k, v]) => row[k] === v)
          );
        }
        const pnlCol = sql.match(/SUM\((\w+)\)/i)?.[1] || 'pnl';
        const withPnl = filtered.filter(r => r[pnlCol] !== null);
        const total = withPnl.reduce((acc, r) => acc + (r[pnlCol] as number || 0), 0);
        const wins = withPnl.filter(r => (r[pnlCol] as number) > 0).length;
        return {
          total,
          wins,
          total_with_pnl: withPnl.length,
        } as T;
      }

      // Handle changes() for delete count
      if (sql.includes('changes()')) {
        return { changes: 0 } as T;
      }

      // Simple row lookup
      const match = rows.find(row =>
        Object.entries(parsed.where).every(([k, v]) => row[k] === v)
      );

      return match as T;
    },

    all<T>(sql: string, params: unknown[] = []): T[] {
      queries.push(sql);

      const parsed = parseSelect(sql, params);
      if (!parsed) return [];

      const rows = tables.get(parsed.table) || [];

      // Handle GROUP BY
      if (sql.toUpperCase().includes('GROUP BY')) {
        const groupMatch = sql.match(/GROUP BY (\w+)/i);
        if (groupMatch) {
          const groupCol = groupMatch[1];
          const groups = new Map<unknown, MockRow[]>();

          let filtered = rows;
          if (Object.keys(parsed.where).length > 0) {
            filtered = rows.filter(row =>
              Object.entries(parsed.where).every(([k, v]) => row[k] === v)
            );
          }

          for (const row of filtered) {
            const key = row[groupCol];
            if (!groups.has(key)) {
              groups.set(key, []);
            }
            groups.get(key)!.push(row);
          }

          return Array.from(groups.entries()).map(([key, groupRows]) => ({
            [groupCol]: key,
            count: groupRows.length,
          })) as T[];
        }
      }

      // Filter by where conditions
      let result = rows;
      if (Object.keys(parsed.where).length > 0) {
        result = rows.filter(row =>
          Object.entries(parsed.where).every(([k, v]) => row[k] === v)
        );
      }

      // Handle ORDER BY and LIMIT
      const limitMatch = sql.match(/LIMIT (\d+)/i);
      if (limitMatch) {
        const limit = parseInt(limitMatch[1], 10);
        result = result.slice(0, limit);
      }

      return result as T[];
    },

    reset(): void {
      tables.clear();
      queries.length = 0;
    },
  };
}

// =============================================================================
// LEDGER FIXTURES
// =============================================================================

export const MOCK_USER_ID = 'test-user-123';
export const MOCK_SESSION_ID = 'session-abc';

export function createMockConstraint(overrides: Partial<ConstraintEvaluation> = {}): ConstraintEvaluation {
  return {
    type: 'max_order_size',
    rule: 'Maximum order size $1000',
    threshold: 1000,
    actual: 500,
    passed: true,
    ...overrides,
  };
}

export function createMockDecisionRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: MOCK_USER_ID,
    sessionId: MOCK_SESSION_ID,
    timestamp: Date.now(),
    category: 'trade' as DecisionCategory,
    action: 'buy_shares',
    platform: 'polymarket',
    marketId: 'market-123',
    inputs: {
      platform: 'polymarket',
      marketId: 'market-123',
      side: 'buy',
      size: 100,
      price: 0.55,
    },
    analysis: {
      observations: ['Price moved 5%'],
      factors: { confidence: 0.7 },
    },
    constraints: [createMockConstraint()],
    confidence: 75,
    decision: 'executed' as DecisionOutcome,
    reason: 'Positive edge detected',
    ...overrides,
  };
}

export function createMockLedgerConfig(overrides: Partial<LedgerConfig> = {}): LedgerConfig {
  return {
    enabled: true,
    captureAll: false,
    hashIntegrity: true,
    retentionDays: 90,
    onchainAnchor: false,
    ...overrides,
  };
}

// =============================================================================
// API KEY FIXTURES
// =============================================================================

export function createMockApiKeyData(overrides: Partial<ApiKeyData> = {}): ApiKeyData {
  const now = Date.now();
  return {
    id: `clodds_${Math.random().toString(16).slice(2, 18)}`,
    secretHash: 'mock-hash-' + Math.random().toString(36).slice(2),
    owner: '0x1234567890abcdef1234567890abcdef12345678',
    name: 'Test Key',
    tier: 'free' as SubscriptionTier,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: 0,
    active: true,
    dailyPrompts: 0,
    dailyResetAt: now + 86400000,
    referralCode: 'TESTCODE',
    totalSpent: 0,
    referralEarnings: 0,
    ...overrides,
  };
}

// =============================================================================
// WEBSOCKET MOCK
// =============================================================================

export interface MockWebSocket {
  url: string;
  readyState: number;
  messages: unknown[];
  listeners: Map<string, Array<(data: unknown) => void>>;
  send(data: string): void;
  close(): void;
  addEventListener(event: string, cb: (data: unknown) => void): void;
  removeEventListener(event: string, cb: (data: unknown) => void): void;
  emit(event: string, data: unknown): void;
}

export function createMockWebSocket(url: string): MockWebSocket {
  const listeners = new Map<string, Array<(data: unknown) => void>>();

  return {
    url,
    readyState: 1, // OPEN
    messages: [],
    listeners,

    send(data: string): void {
      this.messages.push(JSON.parse(data));
    },

    close(): void {
      this.readyState = 3; // CLOSED
      this.emit('close', {});
    },

    addEventListener(event: string, cb: (data: unknown) => void): void {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(cb);
    },

    removeEventListener(event: string, cb: (data: unknown) => void): void {
      const cbs = listeners.get(event) || [];
      const idx = cbs.indexOf(cb);
      if (idx >= 0) {
        cbs.splice(idx, 1);
      }
    },

    emit(event: string, data: unknown): void {
      const cbs = listeners.get(event) || [];
      for (const cb of cbs) {
        cb(data);
      }
    },
  };
}

// =============================================================================
// HTTP MOCK
// =============================================================================

export interface MockHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockHttpClient {
  requests: Array<{ method: string; url: string; body?: unknown }>;
  responses: MockHttpResponse[];
  mockResponse(response: MockHttpResponse): void;
  fetch(url: string, options?: { method?: string; body?: string }): Promise<Response>;
  reset(): void;
}

export function createMockHttpClient(): MockHttpClient {
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  const responses: MockHttpResponse[] = [];

  return {
    requests,
    responses,

    mockResponse(response: MockHttpResponse): void {
      responses.push(response);
    },

    async fetch(url: string, options: { method?: string; body?: string } = {}): Promise<Response> {
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : undefined;

      requests.push({ method, url, body });

      const mockRes = responses.shift() || { status: 200, headers: {}, body: {} };

      return {
        ok: mockRes.status >= 200 && mockRes.status < 300,
        status: mockRes.status,
        headers: new Headers(mockRes.headers),
        json: async () => mockRes.body,
        text: async () => JSON.stringify(mockRes.body),
      } as Response;
    },

    reset(): void {
      requests.length = 0;
      responses.length = 0;
    },
  };
}

// =============================================================================
// MARKET DATA FIXTURES
// =============================================================================

export const MOCK_MARKET = {
  id: 'market-btc-100k',
  question: 'Will Bitcoin reach $100k by end of 2024?',
  outcomes: ['Yes', 'No'],
  prices: { Yes: 0.45, No: 0.55 },
  volume: 1000000,
  liquidity: 500000,
  endDate: new Date('2024-12-31').getTime(),
  platform: 'polymarket',
};

export const MOCK_ORDERBOOK = {
  bids: [
    { price: 0.44, size: 1000 },
    { price: 0.43, size: 2000 },
    { price: 0.42, size: 3000 },
  ],
  asks: [
    { price: 0.46, size: 1000 },
    { price: 0.47, size: 2000 },
    { price: 0.48, size: 3000 },
  ],
};

export const MOCK_POSITION = {
  marketId: 'market-btc-100k',
  outcome: 'Yes',
  size: 500,
  avgPrice: 0.42,
  currentPrice: 0.45,
  unrealizedPnl: 15,
  realizedPnl: 0,
};

// =============================================================================
// TIMING UTILITIES
// =============================================================================

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function mockTimestamp(offset: number = 0): number {
  return Date.now() + offset;
}

// =============================================================================
// ASSERTION HELPERS
// =============================================================================

export function assertValidHash(hash: string): void {
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error(`Invalid SHA-256 hash: ${hash}`);
  }
}

export function assertValidUuid(uuid: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }
}
