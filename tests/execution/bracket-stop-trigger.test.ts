import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBracketOrder, type BracketOrder, type BracketOrderConfig } from '../../src/execution/bracket-orders';
import type { ExecutionService } from '../../src/execution';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Wait until an observable condition holds. Used as an explicit "the poll has
 * entered this async call" signal instead of guessing timing with sleeps.
 */
function waitUntil(condition: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`timed out waiting for ${what}`));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

/**
 * Give an in-flight poll continuation time to (wrongly) act on a stale result.
 * Race tests assert nothing misfires during this window.
 */
function misfireWindow(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 100));
}

interface MockHandlers {
  sellLimit?: () => { success: boolean; orderId?: string; status?: string };
  getExecutablePrice?: () => number | null | Promise<number | null>;
  getOrder?: (
    orderId: string
  ) => { id: string; status: string; price?: number } | null | Promise<{ id: string; status: string; price?: number } | null>;
  cancelOrder?: (orderId: string) => boolean | Promise<boolean>;
}

function createMockService(handlers: MockHandlers = {}) {
  const calls: string[] = [];
  const service = {
    async sellLimit(request: { price: number }) {
      calls.push(`limit:${request.price}`);
      if (handlers.sellLimit) return handlers.sellLimit();
      return { success: true, orderId: 'take-profit', status: 'open' as const };
    },
    async getOrder(_platform: string, orderId: string) {
      calls.push(`get-order:${orderId}`);
      if (handlers.getOrder) return handlers.getOrder(orderId);
      return { id: 'take-profit', status: 'open', price: 0.8 };
    },
    async getExecutablePrice() {
      calls.push('price');
      if (handlers.getExecutablePrice) return handlers.getExecutablePrice();
      return null;
    },
    async cancelOrder(_platform: string, orderId: string) {
      calls.push(`cancel:${orderId}`);
      if (handlers.cancelOrder) return handlers.cancelOrder(orderId);
      return true;
    },
    async marketSell() {
      calls.push('market-sell');
      return { success: true, orderId: 'stop-exit', status: 'filled' as const, avgFillPrice: 0.39 };
    },
  } as unknown as ExecutionService;
  return { service, calls };
}

function captureEvents(bracket: BracketOrder): string[] {
  const events: string[] = [];
  for (const name of ['take_profit_hit', 'stop_loss_hit', 'failed', 'cancelled']) {
    bracket.on(name, () => events.push(name));
  }
  return events;
}

/** User cancel legitimately emits 'cancelled'; a racing poll must not emit these. */
function assertNoFillEvents(events: string[]): void {
  for (const name of ['take_profit_hit', 'stop_loss_hit', 'failed']) {
    assert.equal(events.includes(name), false, `unexpected ${name} event`);
  }
}

function baseConfig(): BracketOrderConfig {
  return {
    platform: 'polymarket',
    marketId: 'market-1',
    tokenId: 'token-1',
    size: 10,
    side: 'long',
    takeProfitPrice: 0.8,
    stopLossPrice: 0.4,
  };
}

function waitForEvent(emitter: NodeJS.EventEmitter, event: string): Promise<unknown> {
  return new Promise(resolve => emitter.once(event, resolve));
}

describe('bracket stop-loss trigger', () => {
  it('does not rest a sell limit at the stop-loss price', async () => {
    const { service, calls } = createMockService({ getExecutablePrice: () => 0.6 });
    const bracket = createBracketOrder(service, { ...baseConfig(), pollIntervalMs: 5 }, { orderId: 'bracket-no-trigger' });

    await bracket.start();
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.deepEqual(calls.filter(call => call.startsWith('limit:')), ['limit:0.8']);
    assert.equal(calls.includes('market-sell'), false);
    await bracket.cancel();
  });

  it('cancels the take-profit before submitting a market exit after the bid crosses', async () => {
    const { service, calls } = createMockService({ getExecutablePrice: () => 0.39 });
    const bracket = createBracketOrder(service, { ...baseConfig(), pollIntervalMs: 5 }, { orderId: 'bracket-triggered' });
    const triggered = waitForEvent(bracket, 'stop_loss_hit');

    await bracket.start();
    await triggered;

    assert.deepEqual(calls.filter(call => call.startsWith('limit:')), ['limit:0.8']);
    assert.ok(calls.indexOf('cancel:take-profit') < calls.indexOf('market-sell'));
    assert.equal(bracket.getStatus().status, 'stop_loss_hit');
    assert.equal(bracket.getStatus().stopLossOrderId, 'stop-exit');
    assert.equal(bracket.getStatus().fillPrice, 0.39);
  });

  it('does not sell when cancel lands while the executable price lookup is pending', async () => {
    const priceGate = deferred<number | null>();
    const { service, calls } = createMockService({ getExecutablePrice: () => priceGate.promise });
    const bracket = createBracketOrder(service, { ...baseConfig(), pollIntervalMs: 5 }, { orderId: 'bracket-race-price' });
    const events = captureEvents(bracket);

    await bracket.start();
    await waitUntil(() => calls.includes('price'), 'poll to enter the price query');

    await bracket.cancel();
    priceGate.resolve(0.39);
    await misfireWindow();

    assert.equal(calls.includes('market-sell'), false);
    assert.equal(bracket.getStatus().status, 'cancelled');
    assertNoFillEvents(events);
  });

  it('does not sell when cancel lands during the price lookup with no take-profit order', async () => {
    // A placement that succeeds without an order id leaves the off-book stop
    // as the only protection. With no take-profit to cancel first, nothing
    // backstops the post-price-lookup guard: a stale crossed price must not
    // submit the exit.
    const priceGate = deferred<number | null>();
    const { service, calls } = createMockService({
      sellLimit: () => ({ success: true, status: 'open' }),
      getExecutablePrice: () => priceGate.promise,
    });
    const bracket = createBracketOrder(service, { ...baseConfig(), pollIntervalMs: 5 }, { orderId: 'bracket-race-price-no-tp' });
    const events = captureEvents(bracket);

    await bracket.start();
    await waitUntil(() => calls.includes('price'), 'poll to enter the price query');

    await bracket.cancel();
    priceGate.resolve(0.39);
    await misfireWindow();

    assert.equal(calls.includes('market-sell'), false);
    assert.equal(bracket.getStatus().status, 'cancelled');
    assertNoFillEvents(events);
  });

  it('does not sell when cancel lands while the poll awaits the take-profit cancellation', async () => {
    const cancelGates: Array<Deferred<boolean>> = [];
    const { service, calls } = createMockService({
      getExecutablePrice: () => 0.39,
      cancelOrder: () => {
        const gate = deferred<boolean>();
        cancelGates.push(gate);
        return gate.promise;
      },
    });
    const bracket = createBracketOrder(service, { ...baseConfig(), pollIntervalMs: 5 }, { orderId: 'bracket-race-cancel' });
    const events = captureEvents(bracket);

    await bracket.start();
    await waitUntil(() => cancelGates.length >= 1, 'poll to enter the take-profit cancellation');

    const cancelPromise = bracket.cancel();
    assert.equal(bracket.getStatus().status, 'cancelled');
    assert.equal(cancelGates.length, 2, 'poll and user cancel must issue separate cancel calls');

    cancelGates[0].resolve(true);
    await misfireWindow();

    assert.equal(calls.includes('market-sell'), false);
    assert.equal(bracket.getStatus().status, 'cancelled');
    assertNoFillEvents(events);

    cancelGates[1].resolve(true);
    await cancelPromise;
  });

  it('does not mark take-profit filled when cancel lands while its fill check is pending', async () => {
    const tpGate = deferred<{ id: string; status: string; price: number } | null>();
    const { service, calls } = createMockService({
      getOrder: orderId => (orderId === 'take-profit' ? tpGate.promise : null),
    });
    const bracket = createBracketOrder(service, { ...baseConfig(), pollIntervalMs: 5 }, { orderId: 'bracket-race-tp-fill' });
    const events = captureEvents(bracket);

    await bracket.start();
    await waitUntil(() => calls.includes('get-order:take-profit'), 'poll to enter the TP fill check');

    await bracket.cancel();
    tpGate.resolve({ id: 'take-profit', status: 'filled', price: 0.8 });
    await misfireWindow();

    assert.equal(bracket.getStatus().status, 'cancelled');
    assert.equal(bracket.getStatus().filledSide, undefined);
    assertNoFillEvents(events);
  });

  it('does not mark legacy stop filled when cancel lands while its fill check is pending', async () => {
    const slGate = deferred<{ id: string; status: string; price: number } | null>();
    const { service, calls } = createMockService({
      getOrder: orderId => {
        if (orderId === 'take-profit') return { id: 'take-profit', status: 'open', price: 0.8 };
        if (orderId === 'legacy-stop') return slGate.promise;
        return null;
      },
    });
    const bracket = createBracketOrder(
      service,
      { ...baseConfig(), pollIntervalMs: 5 },
      {
        orderId: 'bracket-race-legacy-sl',
        restoredOrderIds: { takeProfitOrderId: 'take-profit', stopLossOrderId: 'legacy-stop' },
      }
    );
    const events = captureEvents(bracket);

    await bracket.start();
    await waitUntil(() => calls.includes('get-order:legacy-stop'), 'poll to enter the legacy SL fill check');

    await bracket.cancel();
    slGate.resolve({ id: 'legacy-stop', status: 'filled', price: 0.39 });
    await misfireWindow();

    assert.equal(bracket.getStatus().status, 'cancelled');
    assert.equal(bracket.getStatus().filledSide, undefined);
    assertNoFillEvents(events);
  });
});
