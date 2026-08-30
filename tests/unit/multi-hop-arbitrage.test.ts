import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMultiHopArbitragePlans,
  type ArbitrageHopQuote,
} from '../../src/trading/multi-hop-arbitrage';

const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);

function makeHop(overrides: Partial<ArbitrageHopQuote>): ArbitrageHopQuote {
  return {
    platform: 'hyperliquid',
    marketId: 'hop-1',
    fromAsset: 'USDC',
    toAsset: 'SOL',
    rate: 0.0068,
    maxInputSize: 1_000,
    inputAssetUsd: 1,
    timestamp: NOW,
    latencyMs: 120,
    feeBps: 4,
    slippageBps: 2,
    settlement: 'cex',
    atomicEligible: false,
    ...overrides,
  };
}

describe('multi-hop arbitrage planner', () => {
  it('finds a profitable three-hop cycle', () => {
    const plans = findMultiHopArbitragePlans(
      [
        makeHop({
          platform: 'binance',
          marketId: 'usdc-sol',
          fromAsset: 'USDC',
          toAsset: 'SOL',
          rate: 0.0068,
          settlement: 'cex',
        }),
        makeHop({
          platform: 'hyperliquid',
          marketId: 'sol-jup',
          fromAsset: 'SOL',
          toAsset: 'JUP',
          rate: 145,
          maxInputSize: 6.8,
          inputAssetUsd: 147,
          settlement: 'cex',
        }),
        makeHop({
          platform: 'bybit',
          marketId: 'jup-usdc',
          fromAsset: 'JUP',
          toAsset: 'USDC',
          rate: 1.03,
          maxInputSize: 986,
          inputAssetUsd: 1.01,
          settlement: 'cex',
        }),
      ],
      {
        enabled: true,
        maxHops: 4,
        minNetEdgeBps: 10,
        minTargetProfitUsd: 0.5,
        maxNotionalUsd: 500,
      },
      NOW
    );

    assert.equal(plans.length, 1);
    assert.equal(plans[0].hopCount, 3);
    assert.equal(plans[0].startAsset, 'USDC');
    assert.ok(plans[0].netEdgeBps > 0);
    assert.ok((plans[0].expectedProfitUsd ?? 0) > 0);
  });

  it('marks all-solana paths as atomic bundles when every hop is bundle-eligible', () => {
    const plans = findMultiHopArbitragePlans(
      [
        makeHop({
          platform: 'percolator',
          marketId: 'usdc-sol',
          fromAsset: 'USDC',
          toAsset: 'SOL',
          rate: 0.0069,
          settlement: 'solana',
          atomicEligible: true,
        }),
        makeHop({
          platform: 'percolator',
          marketId: 'sol-bonk',
          fromAsset: 'SOL',
          toAsset: 'BONK',
          rate: 120_000,
          maxInputSize: 6.9,
          inputAssetUsd: 145,
          settlement: 'solana',
          atomicEligible: true,
        }),
        makeHop({
          platform: 'percolator',
          marketId: 'bonk-usdc',
          fromAsset: 'BONK',
          toAsset: 'USDC',
          rate: 0.00123,
          maxInputSize: 828_000,
          inputAssetUsd: 0.0012,
          settlement: 'solana',
          atomicEligible: true,
        }),
      ],
      {
        enabled: true,
        maxHops: 4,
        minNetEdgeBps: 10,
        minTargetProfitUsd: 0.1,
      },
      NOW
    );

    assert.equal(plans.length, 1);
    assert.equal(plans[0].settlementStrategy, 'solana_atomic_bundle');
    assert.ok(plans[0].instructions.every((instruction) => instruction.executionHint === 'atomic_bundle'));
    assert.ok(plans[0].instructions.every((instruction) => instruction.atomicGroup));
  });

  it('marks all-evm paths as exact-in for deterministic entry sizing', () => {
    const plans = findMultiHopArbitragePlans(
      [
        makeHop({
          platform: 'opinion',
          marketId: 'usdc-eth',
          fromAsset: 'USDC',
          toAsset: 'ETH',
          rate: 0.00031,
          settlement: 'evm',
          feeBps: 8,
        }),
        makeHop({
          platform: 'opinion',
          marketId: 'eth-virtual',
          fromAsset: 'ETH',
          toAsset: 'VIRTUAL',
          rate: 3_500,
          maxInputSize: 0.31,
          inputAssetUsd: 3_200,
          settlement: 'evm',
          feeBps: 10,
        }),
        makeHop({
          platform: 'opinion',
          marketId: 'virtual-usdc',
          fromAsset: 'VIRTUAL',
          toAsset: 'USDC',
          rate: 0.93,
          maxInputSize: 1_100,
          inputAssetUsd: 0.92,
          settlement: 'evm',
          feeBps: 8,
          exactInOnly: true,
        }),
      ],
      {
        enabled: true,
        maxHops: 4,
        minNetEdgeBps: 10,
        minTargetProfitUsd: 0.1,
      },
      NOW
    );

    assert.equal(plans.length, 1);
    assert.equal(plans[0].settlementStrategy, 'evm_exact_in');
    assert.ok(plans[0].instructions.every((instruction) => instruction.exactIn));
    assert.ok(plans[0].instructions.every((instruction) => instruction.executionHint === 'exact_in'));
  });
});
