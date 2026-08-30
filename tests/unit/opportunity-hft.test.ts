import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Market, Orderbook, Platform } from '../../src/types';
import type { MarketIdentity } from '../../src/opportunity/links';
import type { Opportunity } from '../../src/opportunity';
import { createOutcomeNormalizer } from '../../src/opportunity/outcomes';
import { planLinkedVenueArbitrage, planOpportunityHft } from '../../src/opportunity/hft';

function makeOrderbook(platform: Platform, marketId: string, bids: Array<[number, number]>, asks: Array<[number, number]>): Orderbook {
  return {
    platform,
    marketId,
    outcomeId: marketId,
    bids,
    asks,
    spread: (asks[0]?.[0] ?? 0) - (bids[0]?.[0] ?? 0),
    midPrice: ((asks[0]?.[0] ?? 0) + (bids[0]?.[0] ?? 0)) / 2,
    timestamp: Date.now(),
  };
}

function makeMarket(platform: Platform, marketId: string, question: string, yesTokenId?: string, noTokenId?: string): Market {
  return {
    id: marketId,
    platform,
    slug: marketId,
    question,
    outcomes: [
      { id: `${marketId}-yes`, tokenId: yesTokenId, name: 'YES', price: 0.5, volume24h: 1_000 },
      { id: `${marketId}-no`, tokenId: noTokenId, name: 'NO', price: 0.5, volume24h: 1_000 },
    ],
    volume24h: 1_000,
    liquidity: 1_000,
    resolved: false,
    tags: [],
    url: `https://example.com/${marketId}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeOpportunity(): Opportunity {
  return {
    id: 'cross-opp-1',
    type: 'cross_platform',
    markets: [
      {
        platform: 'polymarket',
        marketId: 'poly-cond-1',
        tokenId: 'poly-yes-1',
        question: 'Will X happen?',
        outcome: 'YES',
        normalizedOutcome: 'YES',
        price: 0.48,
        liquidity: 1_000,
        volume24h: 1_000,
        action: 'buy',
        recommendedSize: 40,
      },
      {
        platform: 'kalshi',
        marketId: 'KXHAPPEN',
        question: 'Will X happen?',
        outcome: 'YES',
        normalizedOutcome: 'YES',
        price: 0.52,
        liquidity: 1_000,
        volume24h: 1_000,
        action: 'sell',
        recommendedSize: 50,
      },
    ],
    edgePct: 4,
    profitPer100: 4,
    score: 70,
    confidence: 0.9,
    kellyFraction: 0.02,
    estimatedSlippage: 0.2,
    totalLiquidity: 1_000,
    execution: {
      steps: [],
      totalCost: 0,
      estimatedProfit: 0,
      timeSensitivity: 15,
      risk: 'medium',
      warnings: [],
    },
    discoveredAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    status: 'active',
    matchVerification: {
      method: 'manual',
      similarity: 1,
    },
  };
}

describe('opportunity hft integration', () => {
  it('builds a live venue plan from an opportunity and uses outcome token ids for polymarket', async () => {
    const lookups: string[] = [];
    const feeds = {
      async getMarket() {
        return null;
      },
      async getOrderbook(platform: string, marketId: string) {
        lookups.push(`${platform}:${marketId}`);
        if (platform === 'polymarket' && marketId === 'poly-yes-1') {
          return makeOrderbook('polymarket', marketId, [[0.47, 100]], [[0.48, 30]]);
        }
        if (platform === 'kalshi' && marketId === 'KXHAPPEN') {
          return makeOrderbook('kalshi', marketId, [[0.52, 20]], [[0.53, 100]]);
        }
        return null;
      },
    };

    const result = await planOpportunityHft(makeOpportunity(), {
      refreshQuotes: true,
      size: 100,
      minNetEdgeBps: 10,
      minTargetProfitUsd: 0,
      maxNotionalUsd: 500,
    }, feeds);

    assert.ok(lookups.includes('polymarket:poly-yes-1'));
    assert.equal(result.execution.targetSize, 20);
    assert.equal(result.execution.steps[0].action, 'sell');
    assert.equal(result.marketQuotes[0].source, 'feed_orderbook');
    assert.equal(result.venuePlans.length, 1);
    assert.equal(result.venuePlans[0].buyPlatform, 'polymarket');
    assert.equal(result.venuePlans[0].sellPlatform, 'kalshi');
    assert.ok(result.execution.warnings.includes('requested_size_clipped_to_top_of_book'));
  });

  it('builds live linked-market venue plans from market identity groups', async () => {
    const lookups: string[] = [];
    const identity: MarketIdentity = {
      canonicalId: 'event-1',
      markets: [
        { platform: 'polymarket', marketId: 'poly-cond-1', confidence: 1 },
        { platform: 'kalshi', marketId: 'KXHAPPEN', confidence: 1 },
      ],
      primary: { platform: 'polymarket', marketId: 'poly-cond-1' },
    };
    const finder = {
      linker: {
        getIdentity: () => identity,
      },
      normalizer: createOutcomeNormalizer(),
    };
    const feeds = {
      async getMarket(marketId: string, platform?: string) {
        if (platform === 'polymarket') return makeMarket('polymarket', marketId, 'Will X happen?', 'poly-yes-1', 'poly-no-1');
        if (platform === 'kalshi') return makeMarket('kalshi', marketId, 'Will X happen?');
        return null;
      },
      async getOrderbook(platform: string, marketId: string) {
        lookups.push(`${platform}:${marketId}`);
        if (platform === 'polymarket' && marketId === 'poly-yes-1') {
          return makeOrderbook('polymarket', marketId, [[0.47, 40]], [[0.48, 30]]);
        }
        if (platform === 'kalshi' && marketId === 'KXHAPPEN') {
          return makeOrderbook('kalshi', marketId, [[0.52, 20]], [[0.53, 50]]);
        }
        return null;
      },
    };

    const result = await planLinkedVenueArbitrage(finder as any, feeds, {
      marketKey: 'polymarket:poly-cond-1',
      normalizedOutcome: 'YES',
      minNetEdgeBps: 10,
      minTargetProfitUsd: 0,
      maxNotionalUsd: 500,
    });

    assert.ok(lookups.includes('polymarket:poly-yes-1'));
    assert.equal(result.identity?.canonicalId, 'event-1');
    assert.equal(result.quotes.length, 2);
    assert.equal(result.plans.length, 1);
    assert.equal(result.plans[0].buyPlatform, 'polymarket');
    assert.equal(result.plans[0].sellPlatform, 'kalshi');
  });

  it('derives NO-side pricing from binary yes orderbooks when venue lookup is market-level only', async () => {
    const identity: MarketIdentity = {
      canonicalId: 'event-2',
      markets: [
        { platform: 'polymarket', marketId: 'poly-cond-2', confidence: 1 },
        { platform: 'kalshi', marketId: 'KXNOMODE', confidence: 1 },
      ],
      primary: { platform: 'polymarket', marketId: 'poly-cond-2' },
    };
    const finder = {
      linker: {
        getIdentity: () => identity,
      },
      normalizer: createOutcomeNormalizer(),
    };
    const feeds = {
      async getMarket(marketId: string, platform?: string) {
        if (platform === 'polymarket') return makeMarket('polymarket', marketId, 'Will X happen?', 'poly-yes-2', 'poly-no-2');
        if (platform === 'kalshi') return makeMarket('kalshi', marketId, 'Will X happen?');
        return null;
      },
      async getOrderbook(platform: string, marketId: string) {
        if (platform === 'polymarket' && marketId === 'poly-no-2') {
          return makeOrderbook('polymarket', marketId, [[0.37, 30]], [[0.38, 25]]);
        }
        if (platform === 'kalshi' && marketId === 'KXNOMODE') {
          return makeOrderbook('kalshi', marketId, [[0.59, 20]], [[0.61, 20]]);
        }
        return null;
      },
    };

    const result = await planLinkedVenueArbitrage(finder as any, feeds, {
      marketKey: 'kalshi:KXNOMODE',
      normalizedOutcome: 'NO',
      minNetEdgeBps: 10,
      minTargetProfitUsd: 0,
      maxNotionalUsd: 500,
    });

    const kalshiNoQuote = result.quotes.find((quote) => quote.platform === 'kalshi');
    assert.ok(kalshiNoQuote);
    assert.equal(kalshiNoQuote?.bid, 0.39);
    assert.equal(kalshiNoQuote?.ask, 0.41);
    assert.equal(result.plans.length, 1);
    assert.equal(result.plans[0].buyPlatform, 'polymarket');
    assert.equal(result.plans[0].sellPlatform, 'kalshi');
  });
});
