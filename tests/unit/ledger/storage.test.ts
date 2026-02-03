/**
 * Ledger Storage Module Tests
 *
 * Unit tests for CRUD operations on decision records.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createMockDb,
  createMockDecisionRecord,
  createMockConstraint,
  MOCK_USER_ID,
  MOCK_SESSION_ID,
  assertValidUuid,
} from '../../mocks';

// =============================================================================
// STORAGE INITIALIZATION TESTS
// =============================================================================

describe('LedgerStorage initialization', () => {
  const { LedgerStorage, LEDGER_SCHEMA } = require('../../../src/ledger/storage');

  it('should create tables on init', () => {
    const db = createMockDb();
    const storage = new LedgerStorage(db);

    storage.init();

    assert.ok(db.tables.has('trade_ledger'), 'Should create trade_ledger table');
    assert.ok(db.tables.has('ledger_constraints'), 'Should create ledger_constraints table');
  });

  it('should be idempotent (IF NOT EXISTS)', () => {
    const db = createMockDb();
    const storage = new LedgerStorage(db);

    // Init twice
    storage.init();
    storage.init();

    // Should not throw
    assert.ok(true);
  });

  it('should export schema constant', () => {
    assert.ok(LEDGER_SCHEMA.includes('CREATE TABLE'));
    assert.ok(LEDGER_SCHEMA.includes('trade_ledger'));
    assert.ok(LEDGER_SCHEMA.includes('ledger_constraints'));
  });
});

// =============================================================================
// CAPTURE (INSERT) TESTS
// =============================================================================

describe('LedgerStorage.capture', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();
  });

  it('should capture a decision and return ID', () => {
    const record = createMockDecisionRecord();
    // Remove auto-generated fields
    const { id, timestamp, hash, ...recordData } = record;

    const decisionId = storage.capture(recordData);

    assert.ok(decisionId, 'Should return decision ID');
    assertValidUuid(decisionId);
  });

  it('should store decision in database', () => {
    const record = createMockDecisionRecord();
    const { id, timestamp, hash, ...recordData } = record;

    storage.capture(recordData);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows.length, 1, 'Should have one row');
    assert.strictEqual(rows[0].user_id, MOCK_USER_ID);
  });

  it('should store constraints in separate table', () => {
    const record = createMockDecisionRecord({
      constraints: [
        createMockConstraint({ type: 'max_order_size', passed: true }),
        createMockConstraint({ type: 'max_exposure', passed: false, violation: 'Too high' }),
      ],
    });
    const { id, timestamp, hash, ...recordData } = record;

    storage.capture(recordData);

    const constraintRows = db.tables.get('ledger_constraints') || [];
    assert.strictEqual(constraintRows.length, 2, 'Should have two constraint rows');
  });

  it('should generate hash when hashIntegrity is enabled', () => {
    const record = createMockDecisionRecord();
    const { id, timestamp, hash, ...recordData } = record;

    storage.capture(recordData, { hashIntegrity: true });

    const rows = db.tables.get('trade_ledger') || [];
    assert.ok(rows[0].hash, 'Should have hash');
    assert.strictEqual(rows[0].hash.length, 64);
  });

  it('should not generate hash when hashIntegrity is disabled', () => {
    const record = createMockDecisionRecord();
    const { id, timestamp, hash, ...recordData } = record;

    storage.capture(recordData, { hashIntegrity: false });

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows[0].hash, null);
  });

  it('should auto-generate timestamp', () => {
    const record = createMockDecisionRecord();
    const { id, timestamp, hash, ...recordData } = record;

    const before = Date.now();
    storage.capture(recordData);
    const after = Date.now();

    const rows = db.tables.get('trade_ledger') || [];
    assert.ok(rows[0].timestamp >= before);
    assert.ok(rows[0].timestamp <= after);
  });

  it('should serialize JSON fields', () => {
    const record = createMockDecisionRecord({
      inputs: { complex: { nested: true } },
      analysis: { factors: ['a', 'b'] },
    });
    const { id, timestamp, hash, ...recordData } = record;

    storage.capture(recordData);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(typeof rows[0].inputs, 'string');
    assert.strictEqual(typeof rows[0].constraints, 'string');

    // Verify it's valid JSON
    const parsed = JSON.parse(rows[0].inputs as string);
    assert.deepStrictEqual(parsed.complex, { nested: true });
  });

  it('should handle optional fields as null', () => {
    const record = createMockDecisionRecord({
      sessionId: undefined,
      platform: undefined,
      marketId: undefined,
      analysis: undefined,
      confidence: undefined,
    });
    const { id, timestamp, hash, ...recordData } = record;

    storage.capture(recordData);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows[0].session_id, null);
    assert.strictEqual(rows[0].platform, null);
  });
});

// =============================================================================
// UPDATE OUTCOME TESTS
// =============================================================================

describe('LedgerStorage.updateOutcome', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();
  });

  it('should update outcome data', () => {
    const record = createMockDecisionRecord();
    const { id, timestamp, hash, ...recordData } = record;
    const decisionId = storage.capture(recordData);

    storage.updateOutcome(decisionId, {
      success: true,
      orderId: 'order-123',
      pnl: 25.50,
    });

    const rows = db.tables.get('trade_ledger') || [];
    const row = rows.find((r: any) => r.id === decisionId);

    assert.ok(row.outcome, 'Should have outcome');
    assert.strictEqual(row.pnl, 25.50);
    assert.strictEqual(row.accurate, 1); // success = true
  });

  it('should set accurate to 0 for failed outcomes', () => {
    const record = createMockDecisionRecord();
    const { id, timestamp, hash, ...recordData } = record;
    const decisionId = storage.capture(recordData);

    storage.updateOutcome(decisionId, {
      success: false,
      error: 'Insufficient funds',
    });

    const rows = db.tables.get('trade_ledger') || [];
    const row = rows.find((r: any) => r.id === decisionId);

    assert.strictEqual(row.accurate, 0);
  });

  it('should handle null pnl', () => {
    const record = createMockDecisionRecord();
    const { id, timestamp, hash, ...recordData } = record;
    const decisionId = storage.capture(recordData);

    storage.updateOutcome(decisionId, {
      success: true,
      orderId: 'order-123',
      // No pnl specified
    });

    const rows = db.tables.get('trade_ledger') || [];
    const row = rows.find((r: any) => r.id === decisionId);

    assert.strictEqual(row.pnl, null);
  });
});

// =============================================================================
// GET (SINGLE RECORD) TESTS
// =============================================================================

describe('LedgerStorage.get', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();
  });

  it('should return null for non-existent ID', () => {
    const result = storage.get('non-existent-id');
    assert.strictEqual(result, null);
  });

  it('should retrieve captured decision', () => {
    const record = createMockDecisionRecord({
      userId: 'test-get-user',
      category: 'arbitrage',
    });
    const { id, timestamp, hash, ...recordData } = record;
    const decisionId = storage.capture(recordData);

    const retrieved = storage.get(decisionId);

    assert.ok(retrieved, 'Should retrieve record');
    assert.strictEqual(retrieved.id, decisionId);
    assert.strictEqual(retrieved.userId, 'test-get-user');
    assert.strictEqual(retrieved.category, 'arbitrage');
  });

  it('should deserialize JSON fields', () => {
    const record = createMockDecisionRecord({
      inputs: { foo: 'bar', nested: { value: 123 } },
      constraints: [createMockConstraint()],
    });
    const { id, timestamp, hash, ...recordData } = record;
    const decisionId = storage.capture(recordData);

    const retrieved = storage.get(decisionId);

    assert.ok(retrieved, 'Should retrieve record');
    assert.strictEqual(typeof retrieved.inputs, 'object');
    assert.strictEqual(retrieved.inputs.foo, 'bar');
    assert.ok(Array.isArray(retrieved.constraints));
  });

  it('should include outcome after update', () => {
    const record = createMockDecisionRecord();
    const { id, timestamp, hash, ...recordData } = record;
    const decisionId = storage.capture(recordData);

    storage.updateOutcome(decisionId, {
      success: true,
      pnl: 10,
    });

    const retrieved = storage.get(decisionId);

    assert.ok(retrieved.outcome);
    assert.strictEqual(retrieved.pnl, 10);
    assert.strictEqual(retrieved.accurate, true);
  });
});

// =============================================================================
// LIST (QUERY) TESTS
// =============================================================================

describe('LedgerStorage.list', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();

    // Seed test data
    for (let i = 0; i < 5; i++) {
      const record = createMockDecisionRecord({
        userId: MOCK_USER_ID,
        category: i % 2 === 0 ? 'trade' : 'arbitrage',
        decision: i % 3 === 0 ? 'executed' : 'rejected',
        platform: i % 2 === 0 ? 'polymarket' : 'kalshi',
      });
      const { id, timestamp, hash, ...recordData } = record;
      storage.capture(recordData);
    }
  });

  it('should list decisions for user', () => {
    const results = storage.list(MOCK_USER_ID);

    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
  });

  it('should respect limit option', () => {
    const results = storage.list(MOCK_USER_ID, { limit: 2 });

    assert.strictEqual(results.length, 2);
  });

  it('should filter by category', () => {
    const results = storage.list(MOCK_USER_ID, { category: 'trade' });

    for (const r of results) {
      assert.strictEqual(r.category, 'trade');
    }
  });

  it('should filter by decision', () => {
    const results = storage.list(MOCK_USER_ID, { decision: 'rejected' });

    for (const r of results) {
      assert.strictEqual(r.decision, 'rejected');
    }
  });

  it('should filter by platform', () => {
    const results = storage.list(MOCK_USER_ID, { platform: 'polymarket' });

    for (const r of results) {
      assert.strictEqual(r.platform, 'polymarket');
    }
  });

  it('should return empty array for non-existent user', () => {
    const results = storage.list('non-existent-user');

    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 0);
  });

  it('should combine multiple filters', () => {
    const results = storage.list(MOCK_USER_ID, {
      category: 'trade',
      platform: 'polymarket',
      limit: 10,
    });

    for (const r of results) {
      assert.strictEqual(r.category, 'trade');
      assert.strictEqual(r.platform, 'polymarket');
    }
  });
});

// =============================================================================
// STATS TESTS
// =============================================================================

describe('LedgerStorage.stats', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();
  });

  it('should return stats structure', () => {
    const stats = storage.stats(MOCK_USER_ID);

    assert.ok(stats.period);
    assert.ok(stats.breakdown);
    assert.ok(stats.byCategory);
    assert.ok(Array.isArray(stats.topBlockReasons));
    assert.ok(stats.calibration);
  });

  it('should count decisions correctly', () => {
    // Add some decisions
    for (let i = 0; i < 3; i++) {
      const record = createMockDecisionRecord({ userId: MOCK_USER_ID });
      const { id, timestamp, hash, ...recordData } = record;
      storage.capture(recordData);
    }

    const stats = storage.stats(MOCK_USER_ID);

    assert.strictEqual(stats.totalDecisions, 3);
  });

  it('should break down by decision type', () => {
    // Add executed decisions
    for (let i = 0; i < 2; i++) {
      const record = createMockDecisionRecord({
        userId: MOCK_USER_ID,
        decision: 'executed',
      });
      const { id, timestamp, hash, ...recordData } = record;
      storage.capture(recordData);
    }

    // Add rejected decision
    const rejectedRecord = createMockDecisionRecord({
      userId: MOCK_USER_ID,
      decision: 'rejected',
    });
    const { id, timestamp, hash, ...rejectedData } = rejectedRecord;
    storage.capture(rejectedData);

    const stats = storage.stats(MOCK_USER_ID);

    assert.strictEqual(stats.breakdown.executed, 2);
    assert.strictEqual(stats.breakdown.rejected, 1);
  });

  it('should calculate by category', () => {
    const tradeRecord = createMockDecisionRecord({
      userId: MOCK_USER_ID,
      category: 'trade',
    });
    const { id: tid, timestamp: tt, hash: th, ...tradeData } = tradeRecord;
    storage.capture(tradeData);

    const arbRecord = createMockDecisionRecord({
      userId: MOCK_USER_ID,
      category: 'arbitrage',
    });
    const { id: aid, timestamp: at, hash: ah, ...arbData } = arbRecord;
    storage.capture(arbData);

    const stats = storage.stats(MOCK_USER_ID);

    assert.strictEqual(stats.byCategory.trade, 1);
    assert.strictEqual(stats.byCategory.arbitrage, 1);
  });
});

// =============================================================================
// PRUNE TESTS
// =============================================================================

describe('LedgerStorage.prune', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();
  });

  it('should prune old records', () => {
    // Add an "old" record (simulated by direct DB insert)
    const oldTimestamp = Date.now() - (100 * 24 * 60 * 60 * 1000); // 100 days ago
    db.run(
      `INSERT INTO trade_ledger (id, user_id, timestamp, category, action, inputs, constraints, decision, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['old-id', MOCK_USER_ID, oldTimestamp, 'trade', 'buy', '{}', '[]', 'executed', 'test']
    );

    // Add a recent record
    const record = createMockDecisionRecord({ userId: MOCK_USER_ID });
    const { id, timestamp, hash, ...recordData } = record;
    storage.capture(recordData);

    const beforeCount = (db.tables.get('trade_ledger') || []).length;
    assert.strictEqual(beforeCount, 2);

    // Prune records older than 90 days
    storage.prune(90);

    const afterCount = (db.tables.get('trade_ledger') || []).length;
    assert.strictEqual(afterCount, 1);
  });
});

// =============================================================================
// EXPORT TESTS
// =============================================================================

describe('LedgerStorage.export', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();

    // Add test data
    const record = createMockDecisionRecord({ userId: MOCK_USER_ID });
    const { id, timestamp, hash, ...recordData } = record;
    storage.capture(recordData);
  });

  it('should export as JSON', () => {
    const exported = storage.export(MOCK_USER_ID, 'json');

    assert.strictEqual(typeof exported, 'string');

    const parsed = JSON.parse(exported);
    assert.ok(Array.isArray(parsed));
  });

  it('should export as CSV', () => {
    const exported = storage.export(MOCK_USER_ID, 'csv');

    assert.strictEqual(typeof exported, 'string');
    assert.ok(exported.includes('id,'));
    assert.ok(exported.includes('timestamp,'));
    assert.ok(exported.includes('\n'));
  });

  it('should handle empty export', () => {
    const exported = storage.export('non-existent-user', 'json');

    const parsed = JSON.parse(exported);
    assert.deepStrictEqual(parsed, []);
  });
});

console.log('Storage tests loaded. Run with: npm test');
