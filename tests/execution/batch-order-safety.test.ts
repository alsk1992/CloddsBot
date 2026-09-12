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
});
