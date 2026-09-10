/**
 * Bot Manager + Trading Wiring Tests
 *
 * Tests: BotManager creation, strategy registration, getStrategy, callbacks,
 * TradeLogger sharing, adapter registration, and strategy builder.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// HELPERS
// ============================================================================

function createMockDb() {
  const tables = new Map<string, any[]>();
  return {
    run(sql: string, params?: any[]) {
      const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      if (createMatch) {
        const name = createMatch[1];
        if (!tables.has(name)) tables.set(name, []);
        return;
      }
      if (sql.startsWith('CREATE INDEX')) return;
      if (sql.includes('INSERT')) {
        const tableMatch = sql.match(/INTO\s+(\w+)/);
        if (tableMatch) {
          const rows = tables.get(tableMatch[1]) || [];
          rows.push(params);
          tables.set(tableMatch[1], rows);
        }
        return;
      }
    },
    query<T>(_sql: string, _params?: any[]): T[] {
      return [] as T[];
    },
    _tables: tables,
    close() {},
    save() {},
    withConnection: async <T>(fn: (db: any) => T) => fn({} as any),
    backupNow() {},
    getVersion: () => 1,
    setVersion: () => {},
    getPositions: () => [],
    listPositionsForPricing: () => [],
    createPortfolioSnapshot: () => {},
    deletePortfolioSnapshotsBefore: () => {},
    pruneMarketCache: () => 0,
  };
}

// ============================================================================
// BOT MANAGER CORE
// ============================================================================

describe('BotManager', () => {
  let createBotManager: any;
  let createMeanReversionStrategy: any;
  let createMomentumStrategy: any;
  let createArbitrageStrategy: any;

  beforeEach(async () => {
    const mod = await import('../../src/trading/bots/index.js');
    createBotManager = mod.createBotManager;
    createMeanReversionStrategy = mod.createMeanReversionStrategy;
    createMomentumStrategy = mod.createMomentumStrategy;
    createArbitrageStrategy = mod.createArbitrageStrategy;
  });

  it('creates bot manager with default config', () => {
    const db = createMockDb();
    const bm = createBotManager(db);
    assert.ok(bm);
    assert.equal(typeof bm.registerStrategy, 'function');
    assert.equal(typeof bm.getStrategies, 'function');
    assert.equal(typeof bm.getStrategy, 'function');
    assert.equal(typeof bm.startBot, 'function');
    assert.equal(typeof bm.stopBot, 'function');
  });

  it('registers and lists strategies', () => {
    const db = createMockDb();
    const bm = createBotManager(db);

    bm.registerStrategy(createMeanReversionStrategy());
    bm.registerStrategy(createMomentumStrategy());
    bm.registerStrategy(createArbitrageStrategy());

    const strategies = bm.getStrategies();
    assert.equal(strategies.length, 3);
    assert.ok(strategies.find((s: any) => s.id === 'mean-reversion'));
    assert.ok(strategies.find((s: any) => s.id === 'momentum'));
    assert.ok(strategies.find((s: any) => s.id === 'arbitrage'));
  });

  it('getStrategy returns Strategy by ID', () => {
    const db = createMockDb();
    const bm = createBotManager(db);
    const strategy = createMeanReversionStrategy();
    bm.registerStrategy(strategy);

    const found = bm.getStrategy('mean-reversion');
    assert.ok(found);
    assert.equal(found.config.id, 'mean-reversion');
    assert.equal(typeof found.evaluate, 'function');
  });

  it('getStrategy returns null for unknown ID', () => {
    const db = createMockDb();
    const bm = createBotManager(db);
    assert.equal(bm.getStrategy('nonexistent'), null);
  });

  it('returns bot statuses', () => {
    const db = createMockDb();
    const bm = createBotManager(db);
    bm.registerStrategy(createMeanReversionStrategy());

    const statuses = bm.getAllBotStatuses();
    assert.ok(Array.isArray(statuses));
  });

  it('getTradeLogger returns a logger instance', () => {
    const db = createMockDb();
    const bm = createBotManager(db);
    const logger = bm.getTradeLogger();
    assert.ok(logger);
    assert.equal(typeof logger.logTrade, 'function');
    assert.equal(typeof logger.getTrades, 'function');
  });
});

// ============================================================================
// SHARED TRADE LOGGER
// ============================================================================

describe('BotManager with shared TradeLogger', () => {
  let createBotManager: any;
  let createTradeLogger: any;

  beforeEach(async () => {
    const botsMod = await import('../../src/trading/bots/index.js');
    createBotManager = botsMod.createBotManager;
    const loggerMod = await import('../../src/trading/logger.js');
    createTradeLogger = loggerMod.createTradeLogger;
  });

  it('uses external tradeLogger when provided', () => {
    const db = createMockDb();
    const sharedLogger = createTradeLogger(db);
    const bm = createBotManager(db, { tradeLogger: sharedLogger });

    // getTradeLogger should return the same instance
    const internal = bm.getTradeLogger();
    assert.equal(internal, sharedLogger, 'Should use the shared TradeLogger instance');
  });

  it('creates own tradeLogger when not provided', () => {
    const db = createMockDb();
    const bm = createBotManager(db);
    const logger = bm.getTradeLogger();
    assert.ok(logger);
    assert.equal(typeof logger.logTrade, 'function');
  });
});

// ============================================================================
// BOT MANAGER WITH CALLBACKS
// ============================================================================

describe('BotManager with execution callbacks', () => {
  let createBotManager: any;

  beforeEach(async () => {
    const mod = await import('../../src/trading/bots/index.js');
    createBotManager = mod.createBotManager;
  });

  it('accepts executeOrder callback', () => {
    const db = createMockDb();
    const calls: any[] = [];
    const bm = createBotManager(db, {
      executeOrder: async (signal: any, strategyId: string) => {
        calls.push({ signal, strategyId });
        return null;
      },
    });
    assert.ok(bm);
  });

  it('accepts getPrice callback', () => {
    const db = createMockDb();
    const bm = createBotManager(db, {
      getPrice: async () => 0.55,
    });
    assert.ok(bm);
  });

  it('accepts getMarket callback', () => {
    const db = createMockDb();
    const bm = createBotManager(db, {
      getMarket: async () => null,
    });
    assert.ok(bm);
  });

  it('accepts getPortfolio callback', () => {
    const db = createMockDb();
    const bm = createBotManager(db, {
      getPortfolio: async () => ({ value: 10000, balance: 5000, positions: [] }),
    });
    assert.ok(bm);
  });
});

// ============================================================================
// STRATEGY BUILDER
// ============================================================================

describe('StrategyBuilder', () => {
  let createStrategyBuilder: any;

  beforeEach(async () => {
    const mod = await import('../../src/trading/builder.js');
    createStrategyBuilder = mod.createStrategyBuilder;
  });

  it('creates strategy builder', () => {
    const db = createMockDb();
    const sb = createStrategyBuilder(db);
    assert.ok(sb);
    assert.equal(typeof sb.listTemplates, 'function');
    assert.equal(typeof sb.createStrategy, 'function');
    assert.equal(typeof sb.validate, 'function');
    assert.equal(typeof sb.parseNaturalLanguage, 'function');
  });

  it('lists available templates', () => {
    const db = createMockDb();
    const sb = createStrategyBuilder(db);
    const templates = sb.listTemplates();
    assert.ok(Array.isArray(templates));
    assert.ok(templates.length > 0);
  });

  it('validates a strategy definition', () => {
    const db = createMockDb();
    const sb = createStrategyBuilder(db);

    // Missing required fields should fail
    const result = sb.validate({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });
});

// ============================================================================
// TRADING ADAPTERS
// ============================================================================

describe('Trading Adapters', () => {
  let createCryptoHftAdapter: any;
  let createDivergenceAdapter: any;

  beforeEach(async () => {
    const mod = await import('../../src/trading/adapters/index.js');
    createCryptoHftAdapter = mod.createCryptoHftAdapter;
    createDivergenceAdapter = mod.createDivergenceAdapter;
  });

  it('creates crypto HFT adapter as Strategy', () => {
    const mockFeed = { on: () => {}, off: () => {}, start: async () => {}, stop: () => {} } as any;
    const adapter = createCryptoHftAdapter({ feed: mockFeed, execution: null });

    assert.ok(adapter);
    assert.equal(adapter.config.id, 'crypto-hft');
    assert.equal(adapter.config.name, 'Crypto HFT');
    assert.equal(typeof adapter.evaluate, 'function');
    assert.ok(adapter.config.platforms.includes('polymarket'));
  });

  it('creates divergence adapter as Strategy', () => {
    const mockFeed = { on: () => {}, off: () => {}, start: async () => {}, stop: () => {} } as any;
    const adapter = createDivergenceAdapter({ feed: mockFeed, execution: null });

    assert.ok(adapter);
    assert.equal(adapter.config.id, 'hft-divergence');
    assert.equal(adapter.config.name, 'HFT Divergence');
    assert.equal(typeof adapter.evaluate, 'function');
  });

  it('crypto HFT adapter evaluate returns empty when engine not started', async () => {
    const mockFeed = { on: () => {}, off: () => {}, start: async () => {}, stop: () => {} } as any;
    const adapter = createCryptoHftAdapter({ feed: mockFeed, execution: null });

    const signals = await adapter.evaluate({
      portfolioValue: 10000,
      availableBalance: 5000,
      positions: new Map(),
      recentTrades: [],
      markets: new Map(),
      priceHistory: new Map(),
      timestamp: new Date(),
      isBacktest: false,
    });

    assert.ok(Array.isArray(signals));
    assert.equal(signals.length, 0);
  });

  it('divergence adapter evaluate returns empty when engine not started', async () => {
    const mockFeed = { on: () => {}, off: () => {}, start: async () => {}, stop: () => {} } as any;
    const adapter = createDivergenceAdapter({ feed: mockFeed, execution: null });

    const signals = await adapter.evaluate({
      portfolioValue: 10000,
      availableBalance: 5000,
      positions: new Map(),
      recentTrades: [],
      markets: new Map(),
      priceHistory: new Map(),
      timestamp: new Date(),
      isBacktest: false,
    });

    assert.ok(Array.isArray(signals));
    assert.equal(signals.length, 0);
  });

  it('adapters can be registered in BotManager', async () => {
    const { createBotManager } = await import('../../src/trading/bots/index.js');
    const db = createMockDb();
    const bm = createBotManager(db);
    const mockFeed = { on: () => {}, off: () => {}, start: async () => {}, stop: () => {} } as any;

    bm.registerStrategy(createCryptoHftAdapter({ feed: mockFeed, execution: null }));
    bm.registerStrategy(createDivergenceAdapter({ feed: mockFeed, execution: null }));

    const strategies = bm.getStrategies();
    assert.ok(strategies.find((s: any) => s.id === 'crypto-hft'));
    assert.ok(strategies.find((s: any) => s.id === 'hft-divergence'));
  });
});

// ============================================================================
// CONFIG ENV VARS
// ============================================================================

describe('Config env var overrides', () => {
  it('maps Discord credentials into the runtime channel config', async () => {
    const previousToken = process.env.DISCORD_BOT_TOKEN;
    const previousAppId = process.env.DISCORD_APP_ID;
    process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
    process.env.DISCORD_APP_ID = 'test-discord-app-id';

    try {
      const { loadConfig } = await import('../../src/utils/config.js');
      const config = await loadConfig('/dev/null');

      assert.deepEqual(config.channels?.discord, {
        enabled: true,
        token: 'test-discord-token',
        appId: 'test-discord-app-id',
      });
    } finally {
      if (previousToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
      else process.env.DISCORD_BOT_TOKEN = previousToken;
      if (previousAppId === undefined) delete process.env.DISCORD_APP_ID;
      else process.env.DISCORD_APP_ID = previousAppId;
    }
  });

  it('MARKET_MAKING_ENABLED sets config.trading.marketMaking.enabled', async () => {
    // Save and set env
    const prev = process.env.MARKET_MAKING_ENABLED;
    process.env.MARKET_MAKING_ENABLED = 'true';

    try {
      // Dynamically reload to pick up env
      const { loadConfig } = await import('../../src/utils/config.js');
      const config = await loadConfig('/dev/null'); // nonexistent file → uses defaults + env overrides

      assert.ok(config.trading?.marketMaking);
      assert.equal(config.trading!.marketMaking!.enabled, true);
    } finally {
      if (prev === undefined) delete process.env.MARKET_MAKING_ENABLED;
      else process.env.MARKET_MAKING_ENABLED = prev;
    }
  });

  it('CRYPTO_HFT_ENABLED sets config.trading.cryptoHft.enabled', async () => {
    const prev = process.env.CRYPTO_HFT_ENABLED;
    process.env.CRYPTO_HFT_ENABLED = '1';

    try {
      const { loadConfig } = await import('../../src/utils/config.js');
      const config = await loadConfig('/dev/null');

      assert.ok(config.trading?.cryptoHft);
      assert.equal(config.trading!.cryptoHft!.enabled, true);
    } finally {
      if (prev === undefined) delete process.env.CRYPTO_HFT_ENABLED;
      else process.env.CRYPTO_HFT_ENABLED = prev;
    }
  });

  it('HFT_DIVERGENCE_ENABLED sets config.trading.hftDivergence.enabled', async () => {
    const prev = process.env.HFT_DIVERGENCE_ENABLED;
    process.env.HFT_DIVERGENCE_ENABLED = 'true';

    try {
      const { loadConfig } = await import('../../src/utils/config.js');
      const config = await loadConfig('/dev/null');

      assert.ok(config.trading?.hftDivergence);
      assert.equal(config.trading!.hftDivergence!.enabled, true);
    } finally {
      if (prev === undefined) delete process.env.HFT_DIVERGENCE_ENABLED;
      else process.env.HFT_DIVERGENCE_ENABLED = prev;
    }
  });
});
