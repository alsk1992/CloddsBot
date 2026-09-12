import { afterEach, describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createFuturesExecutionService } from '../../src/execution/futures';
import { FuturesService } from '../../src/trading/futures';
import { configurePreTradeGate } from '../../src/trading/pre-trade';

afterEach(() => configurePreTradeGate(null));

describe('futures pre-trade enforcement', () => {
  it('blocks the exported execution engine above maxOrderSize', async () => {
    configurePreTradeGate({ maxOrderSize: 500 });
    const service = createFuturesExecutionService({
      binance: { apiKey: 'test', secretKey: 'test' },
      dryRun: true,
    });

    const result = await service.placeLimitOrder({
      platform: 'binance',
      symbol: 'BTCUSDT',
      side: 'long',
      size: 0.01,
      price: 60_000,
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /exceeds max \$500/);
  });

  it('blocks the dynamically loaded futures engine above maxOrderSize', async () => {
    configurePreTradeGate({ maxOrderSize: 500 });
    const service = new FuturesService([{
      exchange: 'binance',
      credentials: { apiKey: 'test', apiSecret: 'test' },
      dryRun: true,
    }]);

    await assert.rejects(
      service.placeOrder('binance', {
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'LIMIT',
        size: 0.01,
        price: 60_000,
      }),
      /exceeds max \$500/
    );
  });

  it('checks the breaker before attempting market-price discovery', async () => {
    configurePreTradeGate({
      circuitBreaker: {
        canTrade: () => false,
        getState: () => ({ tripReason: 'max_loss' }),
      },
      maxOrderSize: 500,
    });
    const service = createFuturesExecutionService({
      binance: { apiKey: 'test', secretKey: 'test' },
      dryRun: true,
    });

    const result = await service.placeMarketOrder({
      platform: 'binance',
      symbol: 'BTCUSDT',
      side: 'long',
      size: 0.001,
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /max_loss/);
  });

  it('values MEXC contract volume with the venue contract multiplier', async () => {
    configurePreTradeGate({ maxOrderSize: 500 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      const data = url.includes('/contract/detail')
        ? [{ symbol: 'BTC_USDT', contractSize: 0.0001 }]
        : { lastPrice: '60000' };
      return new Response(JSON.stringify({ code: 0, data }), { status: 200 });
    };

    try {
      const service = createFuturesExecutionService({
        mexc: { apiKey: 'test', secretKey: 'test' },
        dryRun: true,
      });
      const result = await service.placeMarketOrder({
        platform: 'mexc',
        symbol: 'BTC_USDT',
        side: 'long',
        size: 10,
      });

      assert.equal(result.success, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

const priceHints = [
  { name: 'price', fields: { price: 1 } },
  { name: 'stopPrice', fields: { stopPrice: 1 } },
  { name: 'both price fields', fields: { price: 1, stopPrice: 1 } },
];

// Keep price discovery offline while exercising the actual venue response parsing.
function mockExecutionPrice(t: TestContext, price: number | string = 60_000) {
  return t.mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input));
    assert.equal(init?.method, 'GET');
    let body: unknown;
    switch (url.pathname) {
      case '/fapi/v1/premiumIndex':
        body = { markPrice: String(price) };
        break;
      case '/api/v1/contract/ticker':
        body = { code: 0, data: { lastPrice: String(price) } };
        break;
      case '/api/v1/contract/detail':
        body = { code: 0, data: [{ symbol: 'BTC_USDT', contractSize: 0.0001 }] };
        break;
      default:
        assert.fail(`Unexpected request: ${url.pathname}`);
    }
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

for (const platform of ['binance', 'mexc'] as const) {
  const symbol = platform === 'mexc' ? 'BTC_USDT' : 'BTCUSDT';
  // Both sizes are worth $600 at the venue price, including MEXC's multiplier.
  const size = platform === 'mexc' ? 100 : 0.01;

  describe(`${platform} market-order valuation`, () => {
    for (const hint of priceHints) {
      for (const orderType of ['MARKET', undefined] as const) {
        it(`execution engine ignores ${hint.name} for ${orderType ?? 'default MARKET'} orders`, async (t) => {
          configurePreTradeGate({ maxOrderSize: 500 });
          const priceLookup = mockExecutionPrice(t);
          const service = createFuturesExecutionService({
            [platform]: { apiKey: 'test', secretKey: 'test' },
            dryRun: true,
          });

          const result = await service.openLong({
            platform, symbol, size, orderType, ...hint.fields,
          });

          assert.equal(result.success, false);
          assert.match(result.error ?? '', /order size \$600\.00 exceeds max \$500/);
          assert.ok(priceLookup.mock.callCount() > 0);
        });
      }

      it(`trading engine ignores ${hint.name} for MARKET orders`, async (t) => {
        configurePreTradeGate({ maxOrderSize: 500 });
        const service = new FuturesService([{
          exchange: platform,
          credentials: { apiKey: 'test', apiSecret: 'test' },
          dryRun: true,
        }]);
        const priceLookup = platform === 'mexc'
          ? t.mock.method(service, 'getMarkets', async () => [
            { symbol, markPrice: 60_000, contractSize: 0.0001 },
          ])
          : t.mock.method(service, 'getTickerPrice', async () => [
            { symbol, price: 60_000, timestamp: Date.now() },
          ]);

        await assert.rejects(service.placeOrder(platform, {
          symbol, side: 'BUY', type: 'MARKET', size, ...hint.fields,
        }), /order size \$600\.00 exceeds max \$500/);
        assert.equal(priceLookup.mock.callCount(), 1);
      });
    }

    it('execution engine permits an under-cap market order despite a high price hint', async (t) => {
      configurePreTradeGate({ maxOrderSize: 500 });
      mockExecutionPrice(t);
      const service = createFuturesExecutionService({
        [platform]: { apiKey: 'test', secretKey: 'test' },
        dryRun: true,
      });

      const result = await service.openLong({
        platform, symbol, size: size / 10, price: 1_000_000, orderType: 'MARKET',
      });

      assert.equal(result.success, true);
    });
  });
}

describe('futures market-price discovery failures', () => {
  for (const price of [0, -1, 'invalid']) {
    it(`execution engine rejects venue price ${price} despite valid caller prices`, async (t) => {
      configurePreTradeGate({ maxOrderSize: 500 });
      mockExecutionPrice(t, price);
      const service = createFuturesExecutionService({
        binance: { apiKey: 'test', secretKey: 'test' },
        dryRun: true,
      });

      const result = await service.openLong({
        platform: 'binance', symbol: 'BTCUSDT', size: 1, price: 1, stopPrice: 1,
      });

      assert.equal(result.success, false);
      assert.match(result.error ?? '', /No valid Binance mark price/);
    });
  }

  it('trading engine rejects a missing quote despite valid caller prices', async (t) => {
    configurePreTradeGate({ maxOrderSize: 500 });
    const service = new FuturesService([{
      exchange: 'binance',
      credentials: { apiKey: 'test', apiSecret: 'test' },
      dryRun: true,
    }]);
    t.mock.method(service, 'getTickerPrice', async () => []);

    await assert.rejects(service.placeOrder('binance', {
      symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', size: 1, price: 1, stopPrice: 1,
    }), /USD notional could not be determined/);
  });
});

describe('futures limit-order valuation', () => {
  it('keeps using the submitted limit price without market-price discovery', async (t) => {
    configurePreTradeGate({ maxOrderSize: 500 });
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      assert.fail('Limit orders must not need a market quote');
    });
    const executionService = createFuturesExecutionService({
      binance: { apiKey: 'test', secretKey: 'test' },
      dryRun: true,
    });
    const tradingService = new FuturesService([{
      exchange: 'binance',
      credentials: { apiKey: 'test', apiSecret: 'test' },
      dryRun: true,
    }]);

    const result = await executionService.placeLimitOrder({
      platform: 'binance', symbol: 'BTCUSDT', side: 'long', size: 0.01, price: 40_000,
    });
    assert.equal(result.success, true);
    await tradingService.placeOrder('binance', {
      symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', size: 0.01, price: 40_000,
    });
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});
