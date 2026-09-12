import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBracketOrder } from '../../src/execution/bracket-orders';
import type { ExecutionService } from '../../src/execution';

function createService(getPrice: () => number | null) {
  const calls: string[] = [];
  const service = {
    async sellLimit(request: { price: number }) {
      calls.push(`limit:${request.price}`);
      return { success: true, orderId: 'take-profit', status: 'open' as const };
    },
    async getOrder() {
      return { id: 'take-profit', status: 'open', price: 0.8 };
    },
    async getExecutablePrice() {
      calls.push('price');
      return getPrice();
    },
    async cancelOrder() {
      calls.push('cancel-take-profit');
      return true;
    },
    async marketSell() {
      calls.push('market-sell');
      return { success: true, orderId: 'stop-exit', status: 'filled' as const, avgFillPrice: 0.39 };
    },
  } as unknown as ExecutionService;
  return { service, calls };
}

function waitForEvent(emitter: NodeJS.EventEmitter, event: string): Promise<unknown> {
  return new Promise(resolve => emitter.once(event, resolve));
}

describe('bracket stop-loss trigger', () => {
  it('does not rest a sell limit at the stop-loss price', async () => {
    const { service, calls } = createService(() => 0.6);
    const bracket = createBracketOrder(service, {
      platform: 'polymarket',
      marketId: 'market-1',
      tokenId: 'token-1',
      size: 10,
      side: 'long',
      takeProfitPrice: 0.8,
      stopLossPrice: 0.4,
      pollIntervalMs: 5,
    }, { orderId: 'bracket-no-trigger' });

    await bracket.start();
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.deepEqual(calls.filter(call => call.startsWith('limit:')), ['limit:0.8']);
    assert.equal(calls.includes('market-sell'), false);
    await bracket.cancel();
  });

  it('cancels the take-profit before submitting a market exit after the bid crosses', async () => {
    const { service, calls } = createService(() => 0.39);
    const bracket = createBracketOrder(service, {
      platform: 'polymarket',
      marketId: 'market-1',
      tokenId: 'token-1',
      size: 10,
      side: 'long',
      takeProfitPrice: 0.8,
      stopLossPrice: 0.4,
      pollIntervalMs: 5,
    }, { orderId: 'bracket-triggered' });
    const triggered = waitForEvent(bracket, 'stop_loss_hit');

    await bracket.start();
    await triggered;

    assert.deepEqual(calls.filter(call => call.startsWith('limit:')), ['limit:0.8']);
    assert.ok(calls.indexOf('cancel-take-profit') < calls.indexOf('market-sell'));
    assert.equal(bracket.getStatus().status, 'stop_loss_hit');
    assert.equal(bracket.getStatus().stopLossOrderId, 'stop-exit');
    assert.equal(bracket.getStatus().fillPrice, 0.39);
  });
});
