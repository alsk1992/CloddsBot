/**
 * Ledger Hooks Module Tests
 *
 * Integration tests for trade capture via the hooks system.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createMockDb,
  createMockLedgerConfig,
  createMockConstraint,
  MOCK_USER_ID,
  MOCK_SESSION_ID,
} from '../../mocks';

// =============================================================================
// HOOK CONTEXT TYPES
// =============================================================================

interface MockHookContext {
  event: string;
  message?: {
    userId?: string;
    chatId?: string;
    text?: string;
  };
  session?: {
    id?: string;
    userId?: string;
  };
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: unknown;
  data: Record<string, unknown>;
  cancelled?: boolean;
}

// =============================================================================
// CREATE LEDGER HOOKS TESTS
// =============================================================================

describe('createLedgerHooks', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  const { createLedgerHooks } = require('../../../src/ledger/hooks');

  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();
  });

  it('should create hook handlers', () => {
    const config = createMockLedgerConfig();
    const hooks = createLedgerHooks(storage, config);

    assert.ok(hooks.beforeTool, 'Should have beforeTool handler');
    assert.ok(hooks.afterTool, 'Should have afterTool handler');
    assert.strictEqual(typeof hooks.beforeTool, 'function');
    assert.strictEqual(typeof hooks.afterTool, 'function');
  });

  it('should not capture when disabled', () => {
    const config = createMockLedgerConfig({ enabled: false });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_trade',
      toolParams: { market: 'BTC', side: 'buy' },
      session: { id: MOCK_SESSION_ID, userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows.length, 0, 'Should not capture when disabled');
    assert.strictEqual(ctx.data.ledgerDecisionId, undefined);
  });

  it('should capture trading tools', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_trade',
      toolParams: {
        platform: 'polymarket',
        marketId: 'market-123',
        side: 'buy',
        size: 100,
        price: 0.55,
      },
      session: { id: MOCK_SESSION_ID, userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    assert.ok(ctx.data.ledgerDecisionId, 'Should set decision ID');
    assert.ok(ctx.data.ledgerCallId, 'Should set call ID');

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows.length, 1, 'Should capture decision');
    assert.strictEqual(rows[0].category, 'trade');
    assert.strictEqual(rows[0].action, 'execute_trade');
  });

  it('should capture copy trading tools', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'copy_trade',
      toolParams: {
        address: '0x1234',
        amount: 50,
      },
      session: { id: MOCK_SESSION_ID, userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows[0].category, 'copy');
  });

  it('should capture arbitrage tools', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_arbitrage',
      toolParams: {
        sourceMarket: 'polymarket',
        targetMarket: 'kalshi',
      },
      session: { id: MOCK_SESSION_ID, userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows[0].category, 'arbitrage');
  });

  it('should not capture non-trading tools by default', () => {
    const config = createMockLedgerConfig({ enabled: true, captureAll: false });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'search_markets', // Not a trading tool
      toolParams: { query: 'bitcoin' },
      session: { id: MOCK_SESSION_ID, userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows.length, 0);
  });

  it('should capture all tools when captureAll is true', () => {
    const config = createMockLedgerConfig({ enabled: true, captureAll: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'search_markets',
      toolParams: { query: 'bitcoin' },
      session: { id: MOCK_SESSION_ID, userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].category, 'tool'); // Non-trading falls to 'tool'
  });
});

// =============================================================================
// AFTER TOOL (OUTCOME UPDATE) TESTS
// =============================================================================

describe('afterTool hook', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  const { createLedgerHooks } = require('../../../src/ledger/hooks');

  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();
  });

  it('should update outcome after tool completes', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    // Before tool
    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_trade',
      toolParams: { market: 'BTC', side: 'buy' },
      session: { id: MOCK_SESSION_ID, userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);
    const decisionId = ctx.data.ledgerDecisionId;

    // After tool with success
    ctx.toolResult = {
      success: true,
      orderId: 'order-456',
      filledSize: 100,
      avgPrice: 0.54,
    };

    hooks.afterTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    const row = rows.find((r: any) => r.id === decisionId);

    assert.ok(row.outcome, 'Should have outcome');
    assert.strictEqual(row.accurate, 1); // success = true
  });

  it('should handle failed tool result', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_trade',
      toolParams: { market: 'BTC' },
      session: { id: MOCK_SESSION_ID, userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    ctx.toolResult = {
      success: false,
      error: 'Insufficient funds',
    };

    hooks.afterTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows[0].accurate, 0); // success = false
  });

  it('should extract PnL from result', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_trade',
      toolParams: {},
      session: { id: MOCK_SESSION_ID, userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    ctx.toolResult = {
      success: true,
      pnl: 25.50,
    };

    hooks.afterTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows[0].pnl, 25.50);
  });

  it('should handle null result gracefully', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_trade',
      toolParams: {},
      session: { id: MOCK_SESSION_ID, userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    ctx.toolResult = null;
    hooks.afterTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows[0].accurate, 0); // null result = failure
  });

  it('should ignore afterTool without decisionId', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:after',
      toolName: 'search_markets',
      toolResult: { results: [] },
      data: {}, // No ledgerDecisionId
    };

    // Should not throw
    hooks.afterTool(ctx);
    assert.ok(true);
  });
});

// =============================================================================
// MANUAL CAPTURE HELPER TESTS
// =============================================================================

describe('captureOpportunityDecision', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  const { captureOpportunityDecision } = require('../../../src/ledger/hooks');

  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();
  });

  it('should capture opportunity decision', () => {
    const config = createMockLedgerConfig({ enabled: true });

    const id = captureOpportunityDecision(storage, config, {
      userId: MOCK_USER_ID,
      opportunityId: 'opp-123',
      type: 'arbitrage',
      edge: 0.05,
      liquidity: 10000,
      constraints: [createMockConstraint()],
      decision: 'executed',
      reason: 'Edge above threshold',
      confidence: 80,
      platform: 'polymarket',
    });

    assert.ok(id, 'Should return decision ID');

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].category, 'opportunity');
    assert.strictEqual(rows[0].confidence, 80);
  });

  it('should return null when disabled', () => {
    const config = createMockLedgerConfig({ enabled: false });

    const id = captureOpportunityDecision(storage, config, {
      userId: MOCK_USER_ID,
      opportunityId: 'opp-123',
      type: 'arbitrage',
      edge: 0.05,
      liquidity: 10000,
      constraints: [],
      decision: 'executed',
      reason: 'Test',
    });

    assert.strictEqual(id, null);
  });
});

describe('captureCopyDecision', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  const { captureCopyDecision } = require('../../../src/ledger/hooks');

  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();
  });

  it('should capture copy trading decision', () => {
    const config = createMockLedgerConfig({ enabled: true });

    const id = captureCopyDecision(storage, config, {
      userId: MOCK_USER_ID,
      followedAddress: '0xabc123',
      originalTrade: {
        action: 'buy',
        mint: 'SOL',
        solAmount: 1.5,
      },
      constraints: [createMockConstraint()],
      decision: 'executed',
      reason: 'Copied buy from whale',
      platform: 'solana',
    });

    assert.ok(id);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows[0].category, 'copy');
    assert.strictEqual(rows[0].action, 'copy_trade');
  });
});

describe('captureRiskDecision', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  const { captureRiskDecision } = require('../../../src/ledger/hooks');

  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();
  });

  it('should capture approved risk check', () => {
    const config = createMockLedgerConfig({ enabled: true });

    const id = captureRiskDecision(storage, config, {
      userId: MOCK_USER_ID,
      checkType: 'max_exposure',
      proposed: 500,
      current: 200,
      limit: 1000,
      passed: true,
      reason: 'Within exposure limit',
    });

    assert.ok(id);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows[0].category, 'risk');
    assert.strictEqual(rows[0].decision, 'approved');
  });

  it('should capture blocked risk check', () => {
    const config = createMockLedgerConfig({ enabled: true });

    const id = captureRiskDecision(storage, config, {
      userId: MOCK_USER_ID,
      checkType: 'daily_loss',
      proposed: 200,
      current: 900,
      limit: 1000,
      passed: false,
      reason: 'Would exceed daily loss limit',
    });

    assert.ok(id);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows[0].decision, 'blocked');
  });
});

// =============================================================================
// INPUT EXTRACTION TESTS
// =============================================================================

describe('Input extraction', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  const { createLedgerHooks } = require('../../../src/ledger/hooks');

  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();
  });

  it('should extract common trading params', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_trade',
      toolParams: {
        platform: 'polymarket',
        market: 'BTC > 100k',
        marketId: 'market-btc',
        side: 'buy',
        size: 100,
        price: 0.45,
        leverage: 2,
      },
      session: { userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    const inputs = JSON.parse(rows[0].inputs as string);

    assert.strictEqual(inputs.platform, 'polymarket');
    assert.strictEqual(inputs.market, 'BTC > 100k');
    assert.strictEqual(inputs.marketId, 'market-btc');
    assert.strictEqual(inputs.side, 'buy');
    assert.strictEqual(inputs.size, 100);
    assert.strictEqual(inputs.price, 0.45);
    assert.strictEqual(inputs.leverage, 2);
  });

  it('should extract wallet/token params for DeFi', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'swap_tokens',
      toolParams: {
        address: '0x1234',
        wallet: '0xabcd',
        token: 'SOL',
        amount: 5,
      },
      session: { userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    const inputs = JSON.parse(rows[0].inputs as string);

    assert.strictEqual(inputs.address, '0x1234');
    assert.strictEqual(inputs.wallet, '0xabcd');
    assert.strictEqual(inputs.token, 'SOL');
    assert.strictEqual(inputs.amount, 5);
  });
});

// =============================================================================
// CONSTRAINT EXTRACTION TESTS
// =============================================================================

describe('Constraint extraction', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  const { createLedgerHooks } = require('../../../src/ledger/hooks');

  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();
  });

  it('should extract maxSize constraint', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_trade',
      toolParams: {
        maxSize: 1000,
      },
      session: { userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    const constraintRows = db.tables.get('ledger_constraints') || [];
    const maxSizeConstraint = constraintRows.find((c: any) => c.type === 'max_order_size');

    assert.ok(maxSizeConstraint, 'Should have max_order_size constraint');
    assert.strictEqual(maxSizeConstraint.threshold, 1000);
    assert.strictEqual(maxSizeConstraint.passed, 1);
  });

  it('should extract maxExposure constraint', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_trade',
      toolParams: {
        maxExposure: 5000,
      },
      session: { userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    const constraintRows = db.tables.get('ledger_constraints') || [];
    const exposureConstraint = constraintRows.find((c: any) => c.type === 'max_exposure');

    assert.ok(exposureConstraint);
    assert.strictEqual(exposureConstraint.threshold, 5000);
  });

  it('should add default constraint if none specified', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_trade',
      toolParams: {}, // No constraint params
      session: { userId: MOCK_USER_ID },
      data: {},
    };

    hooks.beforeTool(ctx);

    const constraintRows = db.tables.get('ledger_constraints') || [];
    assert.ok(constraintRows.length > 0, 'Should have at least one constraint');
    assert.strictEqual(constraintRows[0].type, 'custom');
    assert.ok(constraintRows[0].rule.includes('permitted'));
  });
});

// =============================================================================
// USER ID RESOLUTION TESTS
// =============================================================================

describe('User ID resolution', () => {
  const { LedgerStorage } = require('../../../src/ledger/storage');
  const { createLedgerHooks } = require('../../../src/ledger/hooks');

  let db: ReturnType<typeof createMockDb>;
  let storage: InstanceType<typeof LedgerStorage>;

  beforeEach(() => {
    db = createMockDb();
    storage = new LedgerStorage(db);
    storage.init();
  });

  it('should prefer session userId', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_trade',
      toolParams: {},
      session: { userId: 'session-user' },
      message: { userId: 'message-user' },
      data: {},
    };

    hooks.beforeTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows[0].user_id, 'session-user');
  });

  it('should fall back to message userId', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_trade',
      toolParams: {},
      session: {}, // No userId
      message: { userId: 'message-user' },
      data: {},
    };

    hooks.beforeTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows[0].user_id, 'message-user');
  });

  it('should use "unknown" as fallback', () => {
    const config = createMockLedgerConfig({ enabled: true });
    const hooks = createLedgerHooks(storage, config);

    const ctx: MockHookContext = {
      event: 'tool:before',
      toolName: 'execute_trade',
      toolParams: {},
      session: {},
      message: {},
      data: {},
    };

    hooks.beforeTool(ctx);

    const rows = db.tables.get('trade_ledger') || [];
    assert.strictEqual(rows[0].user_id, 'unknown');
  });
});

console.log('Hooks tests loaded. Run with: npm test');
