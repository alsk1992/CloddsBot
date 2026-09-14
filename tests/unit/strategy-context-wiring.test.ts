/**
 * Regression tests for strategy context wiring.
 *
 * Before this fix, buildContext() returned `markets: new Map()` and
 * `priceHistory: new Map()` unconditionally, and the built-in strategies only
 * iterated over `ctx.positions`. The combined effect was that no built-in
 * strategy could ever open a position in production:
 *   - arbitrage iterates ctx.markets  -> always empty -> never fired
 *   - mean-reversion / momentum require shares === 0 to enter, but the
 *     portfolio only reports positions already held -> entry unreachable
 *
 * These tests fail if either half of the wiring is reverted.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  createMeanReversionStrategy,
  createMomentumStrategy,
  createArbitrageStrategy,
  createBotManager,
} from '../../src/trading/bots/index';
import type { Market, Platform } from '../../src/types';

/** Minimal in-memory Database stub, enough for createBotManager(). */
function mockDb(): any {
  const tables = new Map<string, any[]>();
  return {
    run(sql: string, params?: any[]) {
      const m = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      if (m) {
        if (!tables.has(m[1])) tables.set(m[1], []);
        return;
      }
      if (sql.startsWith('CREATE INDEX')) return;
      if (sql.includes('INSERT')) {
        const t = sql.match(/INTO\s+(\w+)/);
        if (t) tables.set(t[1], [...(tables.get(t[1]) || []), params]);
      }
    },
    query<T>(): T[] {
      return [] as T[];
    },
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

function market(id: string, platform: Platform, question: string, price: number): Market {
  return {
    id,
    platform,
    slug: id,
    question,
    outcomes: [{ id: 'Yes', name: 'Yes', price, volume24h: 0 }],
    volume24h: 0,
    liquidity: 0,
    resolved: false,
    tags: [],
    url: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Market;
}

function context(overrides: Record<string, unknown> = {}): any {
  return {
    portfolioValue: 10000,
    availableBalance: 10000,
    positions: new Map(),
    recentTrades: [],
    markets: new Map(),
    priceHistory: new Map(),
    timestamp: new Date(),
    isBacktest: true,
    ...overrides,
  };
}

describe('strategy context wiring', () => {
  test('mean reversion can enter from watchlist markets, not just held positions', async () => {
    const markets = new Map<string, Market>();
    markets.set('m1', market('m1', 'polymarket', 'Will X happen?', 0.30));

    // 20 prices averaging ~0.50 make the current 0.30 a strong negative z-score.
    const priceHistory = new Map<string, number[]>();
    priceHistory.set('polymarket:m1:Yes', Array.from({ length: 20 }, (_, i) => (i % 2 ? 0.52 : 0.48)));

    const signals = await createMeanReversionStrategy().evaluate(context({ markets, priceHistory }));

    assert.ok(signals.length > 0, 'expected a buy signal from a watchlist market with no open position');
    assert.equal(signals[0].type, 'buy');
    assert.equal(signals[0].marketId, 'm1');
  });

  test('mean reversion emits nothing when no market data is supplied', async () => {
    const signals = await createMeanReversionStrategy().evaluate(context());
    assert.equal(signals.length, 0);
  });

  test('momentum can enter from watchlist markets', async () => {
    const markets = new Map<string, Market>();
    markets.set('m2', market('m2', 'polymarket', 'Will Y happen?', 0.80));

    // Rising series: short MA well above long MA -> positive momentum.
    const priceHistory = new Map<string, number[]>();
    priceHistory.set(
      'polymarket:m2:Yes',
      Array.from({ length: 20 }, (_, i) => 0.40 + i * 0.02)
    );

    const signals = await createMomentumStrategy().evaluate(context({ markets, priceHistory }));

    assert.ok(signals.length > 0, 'expected a buy signal on a rising watchlist market');
    assert.equal(signals[0].type, 'buy');
  });

  test('arbitrage fires on equivalent markets across platforms', async () => {
    const markets = new Map<string, Market>();
    markets.set('a', market('a', 'polymarket', 'Will BTC exceed $100k in 2026?', 0.40));
    markets.set('b', market('b', 'kalshi', 'Will BTC exceed $100k in 2026?', 0.62));

    const signals = await createArbitrageStrategy().evaluate(context({ markets }));

    assert.ok(signals.length > 0, 'expected arbitrage signals for a 22-point cross-platform spread');
  });

  test('arbitrage stays silent with an empty market map', async () => {
    const signals = await createArbitrageStrategy().evaluate(context());
    assert.equal(signals.length, 0);
  });

  test('seeded price history respects the configured lookback window', async () => {
    // Regression guard for `if (len > lookback) shift()`, which only removed a
    // single entry: a 60-point seeded history stayed at 60 instead of being
    // trimmed to 20. The signal still fires, but the mean/stdDev — and
    // therefore the z-score and confidence — are computed over the wrong
    // window, so entry timing silently drifts from the configured strategy.
    const markets = new Map<string, Market>();
    markets.set('m3', market('m3', 'polymarket', 'Will Z happen?', 0.20));

    // Old regime (first 40 points) sits far from the recent regime (last 20).
    // With a correct 20-point window only the recent regime is in scope.
    const seeded = [
      ...Array.from({ length: 40 }, () => 0.10),
      ...Array.from({ length: 20 }, () => 0.50),
    ];
    const priceHistory = new Map<string, number[]>();
    priceHistory.set('polymarket:m3:Yes', seeded);

    const strategy = createMeanReversionStrategy();
    const signals = await strategy.evaluate(context({ markets, priceHistory }));

    assert.ok(signals.length > 0, 'expected an entry signal');
    const signal = signals[0];

    // Correct window = last 20 seeded points (0.50) plus the 0.20 tick.
    // mean ~= 0.4857, stdDev ~= 0.0782 -> z ~= -3.65 -> confidence clamped to 1.
    // With the buggy `if`, all 60 points remain: mean ~= 0.2311,
    // stdDev ~= 0.1846 -> z ~= -0.17 -> confidence ~= 0.06.
    assert.ok(
      typeof signal.confidence === 'number' && signal.confidence > 0.9,
      `confidence ${signal.confidence} indicates the lookback window was not trimmed to 20`
    );
  });
});

/**
 * These exercise the real buildContext() path through the bot manager.
 * The tests above call evaluate() directly and therefore cannot detect a
 * regression where buildContext stops populating markets/priceHistory.
 */
describe('buildContext data wiring', () => {
  test('evaluateNow surfaces watchlist markets to the strategy', async () => {
    let askedFor = 0;
    const bm = createBotManager(mockDb(), {
      getMarkets: async () => {
        askedFor += 1;
        return [market('w1', 'polymarket', 'Will W happen?', 0.25)];
      },
      getPriceHistory: async () =>
        Array.from({ length: 20 }, (_, i) => (i % 2 ? 0.52 : 0.48)),
    } as any);

    bm.registerStrategy(createMeanReversionStrategy());
    const signals = await bm.evaluateNow('mean-reversion');

    assert.ok(askedFor > 0, 'buildContext must call getMarkets');
    assert.ok(
      signals.length > 0,
      'a depressed watchlist price with a 20-point history must produce a signal'
    );
    assert.equal(signals[0].type, 'buy');
  });

  test('evaluateNow fires arbitrage across two platforms', async () => {
    const bm = createBotManager(mockDb(), {
      getMarkets: async () => [
        market('x', 'polymarket', 'Will BTC exceed $100k in 2026?', 0.40),
        market('y', 'kalshi', 'Will BTC exceed $100k in 2026?', 0.62),
      ],
    } as any);

    bm.registerStrategy(createArbitrageStrategy());
    const signals = await bm.evaluateNow('arbitrage');

    assert.ok(signals.length > 0, 'arbitrage must see both markets through buildContext');
  });

  test('a failing market provider degrades to no signal instead of throwing', async () => {
    const bm = createBotManager(mockDb(), {
      getMarkets: async () => {
        throw new Error('upstream down');
      },
    } as any);

    bm.registerStrategy(createMeanReversionStrategy());
    const signals = await bm.evaluateNow('mean-reversion');
    assert.equal(signals.length, 0);
  });

  test('long seeded history still yields a signal through buildContext', async () => {
    // Guards the if/while truncation bug on the real context path.
    const bm = createBotManager(mockDb(), {
      getMarkets: async () => [market('t1', 'polymarket', 'Will T happen?', 0.20)],
      getPriceHistory: async () => Array.from({ length: 60 }, () => 0.50),
    } as any);

    bm.registerStrategy(createMeanReversionStrategy());
    const signals = await bm.evaluateNow('mean-reversion');
    assert.ok(signals.length > 0, '60 seeded points must not collapse the lookback window');
  });
});
