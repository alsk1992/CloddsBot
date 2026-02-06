/**
 * Bittensor Module Tests
 *
 * Tests persistence layer, agent handler, and HTTP router.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// =============================================================================
// MOCK DATABASE (minimal Database interface for bittensor persistence)
// =============================================================================

interface MockDb {
  run(sql: string, params?: unknown[]): void;
  query<T>(sql: string, params?: unknown[]): T[];
}

function createInMemoryDb(): MockDb {
  const tables = new Map<string, Array<Record<string, unknown>>>();
  let autoId = 1;

  return {
    run(sql: string, params: unknown[] = []): void {
      const trimmed = sql.trim().toUpperCase();

      if (trimmed.startsWith('CREATE TABLE')) {
        const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
        if (match && !tables.has(match[1])) {
          tables.set(match[1], []);
        }
        return;
      }

      if (trimmed.startsWith('INSERT')) {
        const tableMatch = sql.match(/INSERT INTO (\w+)\s*\(([^)]+)\)/i);
        if (!tableMatch) return;

        const table = tableMatch[1];
        const columns = tableMatch[2].split(',').map(c => c.trim());

        // Handle ON CONFLICT (upsert)
        const hasConflict = sql.toUpperCase().includes('ON CONFLICT');
        const rows = tables.get(table) ?? [];

        if (hasConflict) {
          // Find unique constraint columns from ON CONFLICT clause
          const conflictMatch = sql.match(/ON CONFLICT\(([^)]+)\)/i);
          if (conflictMatch) {
            const conflictCols = conflictMatch[1].split(',').map(c => c.trim());
            const existing = rows.find(row =>
              conflictCols.every((col, _) => {
                const colIdx = columns.indexOf(col);
                return colIdx >= 0 && row[col] === params[colIdx];
              })
            );

            if (existing) {
              // Update existing row
              columns.forEach((col, i) => {
                existing[col] = params[i];
              });
              existing['updated_at'] = new Date().toISOString();
              return;
            }
          }
        }

        const row: Record<string, unknown> = { id: autoId++ };
        columns.forEach((col, i) => {
          row[col] = params[i];
        });
        row['created_at'] = row['created_at'] ?? new Date().toISOString();
        row['updated_at'] = row['updated_at'] ?? new Date().toISOString();

        if (!tables.has(table)) tables.set(table, []);
        tables.get(table)!.push(row);
        return;
      }
    },

    query<T>(sql: string, params: unknown[] = []): T[] {
      const tableMatch = sql.match(/FROM (\w+)/i);
      if (!tableMatch) return [];

      const table = tableMatch[1];
      let rows = [...(tables.get(table) ?? [])];

      // Simple WHERE filtering
      const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s*$)/i);
      if (whereMatch) {
        const whereClause = whereMatch[1];
        // Handle parameterized equality conditions
        let paramIdx = 0;
        const conditions = whereClause.split(/\s+AND\s+/i);
        for (const cond of conditions) {
          if (cond.includes('>=')) {
            // Skip time-based conditions for simplicity — include all
            continue;
          }
          const colMatch = cond.match(/(\w+)\s*=\s*\?/);
          if (colMatch && paramIdx < params.length) {
            const col = colMatch[1];
            const val = params[paramIdx++];
            rows = rows.filter(r => r[col] === val);
          }
        }
      }

      // ORDER BY DESC
      if (sql.toUpperCase().includes('ORDER BY') && sql.toUpperCase().includes('DESC')) {
        rows.reverse();
      }

      return rows as T[];
    },
  };
}

// =============================================================================
// PERSISTENCE TESTS
// =============================================================================

describe('bittensor persistence', () => {
  let db: MockDb;
  let persistence: ReturnType<typeof import('../../src/bittensor/persistence').createBittensorPersistence>;

  beforeEach(async () => {
    db = createInMemoryDb();
    const { createBittensorPersistence } = await import('../../src/bittensor/persistence');
    persistence = createBittensorPersistence(db as any);
    persistence.init();
  });

  it('init creates all three tables', () => {
    // No error thrown = tables created successfully
    // Calling init again should also not throw (IF NOT EXISTS)
    persistence.init();
  });

  it('saveEarnings and getEarnings round-trip', () => {
    persistence.saveEarnings({
      subnetId: 64,
      hotkey: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
      taoEarned: 1.5,
      usdEarned: 255,
      apiCost: 0,
      infraCost: 10,
      netProfit: 245,
      period: 'daily',
    });

    const earnings = persistence.getEarnings('all');
    assert.equal(earnings.length, 1);
    assert.equal(earnings[0].subnetId, 64);
    assert.equal(earnings[0].taoEarned, 1.5);
    assert.equal(earnings[0].usdEarned, 255);
    assert.equal(earnings[0].netProfit, 245);
    assert.equal(earnings[0].period, 'daily');
  });

  it('saveMinerStatus and getMinerStatus round-trip', () => {
    persistence.saveMinerStatus({
      subnetId: 64,
      hotkey: '5HotKeyABC',
      uid: 42,
      trust: 0.85,
      incentive: 0.72,
      emission: 0.001,
      rank: 15,
      active: true,
    });

    const status = persistence.getMinerStatus(64, '5HotKeyABC');
    assert.ok(status);
    assert.equal(status.subnetId, 64);
    assert.equal(status.uid, 42);
    assert.equal(status.trust, 0.85);
    assert.equal(status.incentive, 0.72);
    assert.equal(status.rank, 15);
  });

  it('saveMinerStatus upserts on conflict', () => {
    persistence.saveMinerStatus({
      subnetId: 64,
      hotkey: '5HotKeyABC',
      uid: 42,
      trust: 0.5,
      incentive: 0.3,
      emission: 0.001,
      rank: 50,
      active: true,
    });

    // Update same subnet_id + hotkey
    persistence.saveMinerStatus({
      subnetId: 64,
      hotkey: '5HotKeyABC',
      uid: 42,
      trust: 0.9,
      incentive: 0.8,
      emission: 0.002,
      rank: 5,
      active: true,
    });

    const statuses = persistence.getMinerStatuses();
    // Should only have 1 row (upserted), not 2
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].trust, 0.9);
    assert.equal(statuses[0].rank, 5);
  });

  it('getMinerStatuses returns all rows', () => {
    persistence.saveMinerStatus({
      subnetId: 64,
      hotkey: '5HotKeyA',
      uid: 1,
      trust: 0.5,
      incentive: 0.3,
      emission: 0.001,
      rank: 10,
      active: true,
    });

    persistence.saveMinerStatus({
      subnetId: 1,
      hotkey: '5HotKeyB',
      uid: 2,
      trust: 0.7,
      incentive: 0.6,
      emission: 0.003,
      rank: 3,
      active: false,
    });

    const statuses = persistence.getMinerStatuses();
    assert.equal(statuses.length, 2);
  });

  it('logCost and getCosts round-trip', () => {
    persistence.logCost({
      category: 'registration',
      description: 'Registered on subnet 64',
      amountUsd: 29.75,
      amountTao: 0.175,
      subnetId: 64,
    });

    persistence.logCost({
      category: 'gpu',
      description: 'A100 hourly',
      amountUsd: 1.5,
      amountTao: 0,
    });

    const costs = persistence.getCosts();
    assert.equal(costs.length, 2);
    // Order may vary in mock — check both exist
    const categories = costs.map(c => c.category).sort();
    assert.deepEqual(categories, ['gpu', 'registration']);
    const regCost = costs.find(c => c.category === 'registration')!;
    assert.equal(regCost.amountTao, 0.175);
  });

  it('getMinerStatus returns null for missing entry', () => {
    const result = persistence.getMinerStatus(999, 'nonexistent');
    assert.equal(result, null);
  });
});

// =============================================================================
// HANDLER TESTS
// =============================================================================

describe('bittensor handler', () => {
  it('returns error when service is not set', async () => {
    const { bittensorHandlers, setBittensorService } = await import(
      '../../src/agents/handlers/bittensor'
    );

    setBittensorService(null);

    const result = await bittensorHandlers.bittensor({ action: 'status' });
    assert.ok(result);
    // Handler returns a JSON string
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    assert.ok(text.includes('not enabled'), `Expected "not enabled" in: ${text}`);
  });

  it('returns status when service is set', async () => {
    const { bittensorHandlers, setBittensorService } = await import(
      '../../src/agents/handlers/bittensor'
    );

    const mockService = {
      async getStatus() {
        return {
          connected: true,
          network: 'testnet' as const,
          walletLoaded: true,
          activeMiners: [],
          totalTaoEarned: 5.0,
          totalUsdEarned: 850,
        };
      },
      async getWalletInfo() { return null; },
      async getEarnings() { return []; },
      async getMinerStatuses() { return []; },
      async getSubnets() { return []; },
      async registerOnSubnet() { return { success: false, message: 'mock' }; },
      async startMining() { return { success: false, message: 'mock' }; },
      async stopMining() { return { success: false, message: 'mock' }; },
      async start() {},
      async stop() {},
    };

    setBittensorService(mockService);

    const result = await bittensorHandlers.bittensor({ action: 'status' });
    assert.ok(result);
    // Handler returns JSON string via safeHandler → successResult
    const parsed = JSON.parse(result as string);
    assert.equal(parsed.result.connected, true);
    assert.equal(parsed.result.network, 'testnet');
    assert.equal(parsed.result.totalTaoEarned, 5.0);

    // Clean up
    setBittensorService(null);
  });

  it('returns earnings for a period', async () => {
    const { bittensorHandlers, setBittensorService } = await import(
      '../../src/agents/handlers/bittensor'
    );

    const mockEarnings = [
      {
        subnetId: 64,
        hotkey: '5Test',
        taoEarned: 2.5,
        usdEarned: 425,
        apiCost: 0,
        infraCost: 10,
        netProfit: 415,
        period: 'daily' as const,
        createdAt: new Date(),
      },
    ];

    const mockService = {
      async getStatus() {
        return { connected: true, network: 'mainnet' as const, walletLoaded: true, activeMiners: [], totalTaoEarned: 0, totalUsdEarned: 0 };
      },
      async getWalletInfo() { return null; },
      async getEarnings() { return mockEarnings; },
      async getMinerStatuses() { return []; },
      async getSubnets() { return []; },
      async registerOnSubnet() { return { success: false, message: 'mock' }; },
      async startMining() { return { success: false, message: 'mock' }; },
      async stopMining() { return { success: false, message: 'mock' }; },
      async start() {},
      async stop() {},
    };

    setBittensorService(mockService);

    const result = await bittensorHandlers.bittensor({ action: 'earnings', period: 'daily' });
    assert.ok(result);
    const parsed = JSON.parse(result as string);
    assert.equal(parsed.result.period, 'daily');
    assert.equal(parsed.result.totalTao, 2.5);
    assert.equal(parsed.result.totalUsd, 425);

    setBittensorService(null);
  });

  it('returns error for unknown action', async () => {
    const { bittensorHandlers, setBittensorService } = await import(
      '../../src/agents/handlers/bittensor'
    );

    const mockService = {
      async getStatus() {
        return { connected: false, network: 'testnet' as const, walletLoaded: false, activeMiners: [], totalTaoEarned: 0, totalUsdEarned: 0 };
      },
      async getWalletInfo() { return null; },
      async getEarnings() { return []; },
      async getMinerStatuses() { return []; },
      async getSubnets() { return []; },
      async registerOnSubnet() { return { success: false, message: 'mock' }; },
      async startMining() { return { success: false, message: 'mock' }; },
      async stopMining() { return { success: false, message: 'mock' }; },
      async start() {},
      async stop() {},
    };

    setBittensorService(mockService);

    const result = await bittensorHandlers.bittensor({ action: 'invalidAction' });
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    assert.ok(text.includes('Unknown') || text.includes('error'));

    setBittensorService(null);
  });

  it('requires subnetId for start/stop/register', async () => {
    const { bittensorHandlers, setBittensorService } = await import(
      '../../src/agents/handlers/bittensor'
    );

    const mockService = {
      async getStatus() {
        return { connected: true, network: 'mainnet' as const, walletLoaded: true, activeMiners: [], totalTaoEarned: 0, totalUsdEarned: 0 };
      },
      async getWalletInfo() { return null; },
      async getEarnings() { return []; },
      async getMinerStatuses() { return []; },
      async getSubnets() { return []; },
      async registerOnSubnet() { return { success: true, message: 'ok' }; },
      async startMining() { return { success: true, message: 'ok' }; },
      async stopMining() { return { success: true, message: 'ok' }; },
      async start() {},
      async stop() {},
    };

    setBittensorService(mockService);

    for (const action of ['start', 'stop', 'register']) {
      const result = await bittensorHandlers.bittensor({ action });
      const text = typeof result === 'string' ? result : JSON.stringify(result);
      assert.ok(text.includes('subnetId') || text.includes('required'), `${action} should require subnetId`);
    }

    setBittensorService(null);
  });
});

// =============================================================================
// ROUTER TESTS
// =============================================================================

describe('bittensor router', () => {
  it('creates a router with all expected routes', async () => {
    const { createBittensorRouter } = await import('../../src/bittensor/server');

    const mockService = {
      async getStatus() {
        return { connected: true, network: 'mainnet' as const, walletLoaded: true, activeMiners: [], totalTaoEarned: 0, totalUsdEarned: 0 };
      },
      async getWalletInfo() { return null; },
      async getEarnings() { return []; },
      async getMinerStatuses() { return []; },
      async getSubnets() { return []; },
      async registerOnSubnet() { return { success: false, message: 'mock' }; },
      async startMining() { return { success: false, message: 'mock' }; },
      async stopMining() { return { success: false, message: 'mock' }; },
      async start() {},
      async stop() {},
    };

    const router = createBittensorRouter(mockService);
    assert.ok(router);

    // Router should have route handlers registered
    const routes = (router as any).stack
      ?.map((layer: any) => ({
        path: layer.route?.path,
        methods: layer.route?.methods ? Object.keys(layer.route.methods) : [],
      }))
      .filter((r: any) => r.path);

    assert.ok(routes.length >= 8, `Expected at least 8 routes, got ${routes.length}`);

    const paths = routes.map((r: any) => `${r.methods[0].toUpperCase()} ${r.path}`);
    assert.ok(paths.includes('GET /status'), 'Missing GET /status');
    assert.ok(paths.includes('GET /wallet'), 'Missing GET /wallet');
    assert.ok(paths.includes('GET /earnings'), 'Missing GET /earnings');
    assert.ok(paths.includes('GET /miners'), 'Missing GET /miners');
    assert.ok(paths.includes('GET /subnets'), 'Missing GET /subnets');
    assert.ok(paths.includes('POST /register'), 'Missing POST /register');
    assert.ok(paths.includes('POST /start'), 'Missing POST /start');
    assert.ok(paths.includes('POST /stop'), 'Missing POST /stop');
  });
});
