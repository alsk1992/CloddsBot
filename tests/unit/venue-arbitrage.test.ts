import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createVenueArbitragePlanner,
  findVenueArbitragePlans,
  type VenueQuote,
} from '../../src/trading/venue-arbitrage';

const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);

function makeQuote(overrides: Partial<VenueQuote>): VenueQuote {
  return {
    instrumentId: 'election-yes',
    platform: 'polymarket',
    marketId: 'poly-yes',
    outcome: 'YES',
    bid: 0.49,
    ask: 0.5,
    bidSize: 400,
    askSize: 400,
    timestamp: NOW,
    ...overrides,
  };
}

describe('venue arbitrage planner', () => {
  it('finds a net-positive crossed venue arbitrage plan', () => {
    const plans = findVenueArbitragePlans(
      [
        makeQuote({
          platform: 'polymarket',
          marketId: 'poly-1',
          bid: 0.47,
          ask: 0.48,
          askSize: 300,
        }),
        makeQuote({
          platform: 'kalshi',
          marketId: 'kalshi-1',
          bid: 0.51,
          ask: 0.52,
          bidSize: 250,
        }),
      ],
      {
        enabled: true,
        minNetEdgeBps: 25,
        minTargetProfitUsd: 0.5,
        maxNotionalUsd: 200,
      },
      NOW
    );

    assert.equal(plans.length, 1);
    assert.equal(plans[0].buyPlatform, 'polymarket');
    assert.equal(plans[0].sellPlatform, 'kalshi');
    assert.equal(plans[0].executionStyle, 'taker_taker');
    assert.equal(plans[0].legs[0].side, 'sell');
    assert.equal(plans[0].legs[1].side, 'buy');
    assert.ok(plans[0].netEdgeBps > 0);
    assert.ok(plans[0].expectedNetUsd > 0);
  });

  it('drops stale quotes before planning', () => {
    const plans = findVenueArbitragePlans(
      [
        makeQuote({
          platform: 'polymarket',
          marketId: 'poly-1',
          bid: 0.48,
          ask: 0.49,
          timestamp: NOW - 5_000,
        }),
        makeQuote({
          platform: 'kalshi',
          marketId: 'kalshi-1',
          bid: 0.52,
          ask: 0.53,
        }),
      ],
      {
        enabled: true,
        maxQuoteAgeMs: 1_500,
      },
      NOW
    );

    assert.equal(plans.length, 0);
  });

  it('penalizes slower venues enough to prefer the faster route', () => {
    const plans = findVenueArbitragePlans(
      [
        makeQuote({
          platform: 'polymarket',
          marketId: 'poly-1',
          bid: 0.48,
          ask: 0.49,
        }),
        makeQuote({
          platform: 'kalshi',
          marketId: 'kalshi-fast',
          bid: 0.53,
          ask: 0.54,
          latencyMs: 250,
        }),
        makeQuote({
          platform: 'predictit',
          marketId: 'predictit-slow',
          bid: 0.53,
          ask: 0.54,
          latencyMs: 1_800,
          takerFeeBps: 120,
        }),
      ],
      {
        enabled: true,
        platforms: ['polymarket', 'kalshi', 'predictit'],
        minNetEdgeBps: 10,
        minTargetProfitUsd: 0.25,
        latencyPenaltyBpsPerSecond: 20,
      },
      NOW
    );

    assert.equal(plans[0].sellPlatform, 'kalshi');
    assert.ok(plans[0].score > plans[1].score);
  });

  it('supports maker-taker execution sequencing', () => {
    const planner = createVenueArbitragePlanner({
      enabled: true,
      executionStyle: 'maker_taker',
      minNetEdgeBps: 10,
      minTargetProfitUsd: 0.25,
    });

    const plans = planner.findPlans(
      [
        makeQuote({
          platform: 'polymarket',
          marketId: 'poly-1',
          bid: 0.47,
          ask: 0.48,
        }),
        makeQuote({
          platform: 'kalshi',
          marketId: 'kalshi-1',
          bid: 0.51,
          ask: 0.52,
        }),
      ],
      NOW
    );

    assert.equal(plans.length, 1);
    assert.equal(plans[0].legs[0].side, 'buy');
    assert.equal(plans[0].legs[0].role, 'maker');
    assert.equal(plans[0].legs[1].side, 'sell');
    assert.equal(plans[0].legs[1].role, 'taker');
  });

  it('can surface queue-based maker opportunities when crossed-market mode is disabled', () => {
    const plans = findVenueArbitragePlans(
      [
        makeQuote({
          platform: 'polymarket',
          marketId: 'poly-1',
          bid: 0.49,
          ask: 0.5,
        }),
        makeQuote({
          platform: 'kalshi',
          marketId: 'kalshi-1',
          bid: 0.495,
          ask: 0.53,
        }),
      ],
      {
        enabled: true,
        executionStyle: 'maker_taker',
        requireCrossedMarket: false,
        minNetEdgeBps: 10,
        minTargetProfitUsd: 0.1,
      },
      NOW
    );

    assert.equal(plans.length, 1);
    assert.equal(plans[0].grossSpread, 0.005);
    assert.equal(plans[0].legs[0].price, 0.49);
    assert.equal(plans[0].legs[1].price, 0.495);
  });
});
