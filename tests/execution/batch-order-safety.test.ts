import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCircuitBreaker } from '../../src/execution/circuit-breaker';
import { createExecutionService } from '../../src/execution';

function order(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'polymarket' as const,
    marketId: 'market-1',
    tokenId: 'token-1',
    outcome: 'yes' as const,
    side: 'buy' as const,
    price: 0.5,
    size: 10,
    ...overrides,
  };
}

describe('batch order pre-trade safety', () => {
  it('returns dry-run results without requiring venue configuration', async () => {
    const service = createExecutionService({ dryRun: true });

    const results = await service.placeOrdersBatch([
      order(),
      order({ platform: 'kalshi', marketId: 'KX-TEST', tokenId: undefined }),
    ]);

    assert.equal(results.length, 2);
    assert.ok(results.every(result => result.success));
    assert.ok(results.every(result => result.orderId?.startsWith('dry_')));
  });

  it('rejects invalid and oversized items before dry-run handling', async () => {
    const service = createExecutionService({ dryRun: true, maxOrderSize: 100 });

    const results = await service.placeOrdersBatch([
      order({ price: Number.NaN }),
      order({ price: 0.9, size: 200 }),
      order({ price: 0.5, size: 10 }),
    ]);

    assert.match(results[0].error ?? '', /must be finite numbers/);
    assert.match(results[1].error ?? '', /exceeds max \$100/);
    assert.equal(results[2].success, true);
    assert.ok(results[2].orderId?.startsWith('dry_'));
  });

  it('blocks every batch item when the circuit breaker is tripped', async () => {
    const service = createExecutionService({ dryRun: true });
    const breaker = createCircuitBreaker();
    breaker.trip('manual');
    service.setCircuitBreaker(breaker);

    const results = await service.placeOrdersBatch([order(), order({ marketId: 'market-2' })]);

    assert.equal(results.length, 2);
    assert.ok(results.every(result => !result.success));
    assert.ok(results.every(result => result.error?.includes('circuit breaker')));
    breaker.stop();
  });

  it('values Opinion BUY size as quote-token spend for the maxOrderSize cap', async () => {
    const service = createExecutionService({ dryRun: true, maxOrderSize: 100 });

    // price*size = $100 would incorrectly pass; quote spend is $1000 and must fail.
    const oversized = await service.placeOrdersBatch([
      order({ platform: 'opinion', price: 0.1, size: 1000, tokenId: '1-0' }),
    ]);
    assert.match(oversized[0].error ?? '', /exceeds max \$100/);

    // Quote spend of $100 at price 0.10 is exactly at the cap and must pass.
    const ok = await service.placeOrdersBatch([
      order({ platform: 'opinion', price: 0.1, size: 100, tokenId: '1-0' }),
    ]);
    assert.equal(ok[0].success, true);
    assert.ok(ok[0].orderId?.startsWith('dry_'));

    // Opinion SELL still uses price * size (base shares).
    const sellOversized = await service.placeOrdersBatch([
      order({ platform: 'opinion', side: 'sell', price: 0.5, size: 300, tokenId: '1-0' }),
    ]);
    assert.match(sellOversized[0].error ?? '', /exceeds max \$100/);
  });

  it('records fallback batch orders to the circuit breaker only once', async () => {
    // dryRun must be false so the unknown venue reaches the per-order fallback
    // (dry-run short-circuits before platform dispatch).
    const service = createExecutionService({ dryRun: false });
    const breaker = createCircuitBreaker({
      maxLossUsd: 1_000_000,
      maxConsecutiveLosses: 100,
      maxErrorRate: 1,
      minTradesForErrorRate: 1000,
      maxDailyTrades: 1000,
    });
    service.setCircuitBreaker(breaker);

    const results = await service.placeOrdersBatch([
      // Untyped/unknown venue hits the per-order fallback path.
      order({ platform: 'betfair' as 'polymarket' }),
    ]);

    assert.equal(results.length, 1);
    assert.equal(results[0].success, false);
    assert.match(results[0].error ?? '', /Unknown platform/);
    assert.equal(breaker.getState().dailyTrades, 1);
    breaker.stop();
  });
});
