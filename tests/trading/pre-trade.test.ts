import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { configurePreTradeGate, validatePreTrade } from '../../src/trading/pre-trade';

afterEach(() => configurePreTradeGate(null));

describe('shared pre-trade gate', () => {
  it('blocks every route when the circuit breaker is tripped', () => {
    configurePreTradeGate({
      circuitBreaker: {
        canTrade: () => false,
        getState: () => ({ tripReason: 'max_loss' }),
      },
      maxOrderSize: 1000,
    });

    assert.match(
      validatePreTrade({ label: 'Solana swap', notionalUsd: 10 }) ?? '',
      /max_loss/
    );
  });

  it('uses the strictest global and caller-specific order cap', () => {
    configurePreTradeGate({ maxOrderSize: 1000 });

    assert.match(
      validatePreTrade({ label: 'futures order', notionalUsd: 501, maxOrderSize: 500 }) ?? '',
      /exceeds max \$500/
    );
    assert.equal(
      validatePreTrade({ label: 'futures order', notionalUsd: 500, maxOrderSize: 500 }),
      null
    );
  });

  it('fails closed when a route requires a missing notional', () => {
    configurePreTradeGate({ maxOrderSize: 1000 });
    assert.match(
      validatePreTrade({ label: 'market order', requireNotional: true }) ?? '',
      /could not be determined/
    );
  });

  it('allows risk-reducing exits over the size cap but still honors kill switches', () => {
    configurePreTradeGate({ maxOrderSize: 100 });
    assert.equal(
      validatePreTrade({ label: 'close position', notionalUsd: 500, skipSizeLimit: true }),
      null
    );

    configurePreTradeGate({
      safety: { canTrade: () => false, getState: () => ({ disabledReason: 'manual stop' }) },
      maxOrderSize: 100,
    });
    assert.match(
      validatePreTrade({ label: 'close position', notionalUsd: 500, skipSizeLimit: true }) ?? '',
      /manual stop/
    );
  });
});
