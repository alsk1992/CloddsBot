import { afterEach, describe, it } from 'node:test';
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
