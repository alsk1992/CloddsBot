/**
 * Alt Data Pipeline Tests
 *
 * Tests sentiment analyzer, market matcher, feeds, and full orchestrator.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// SENTIMENT ANALYZER
// ============================================================================

describe('sentiment analyzer', () => {
  let analyzer: { analyze: (event: any) => any };

  beforeEach(async () => {
    const mod = await import('../../src/services/alt-data/sentiment.js');
    analyzer = mod.createSentimentAnalyzer();
  });

  it('scores bullish text positively', () => {
    const result = analyzer.analyze({
      id: 'test-1',
      source: 'news_headline',
      timestamp: Date.now(),
      text: 'Bitcoin rally continues as ETF approved, bullish momentum building',
      categories: ['crypto'],
    });

    assert.ok(result.score > 0, `Expected positive score, got ${result.score}`);
    assert.ok(result.confidence > 0, 'Expected non-zero confidence');
    assert.ok(result.matchedKeywords.length > 0, 'Expected matched keywords');
    assert.equal(result.category, 'crypto');
  });

  it('scores bearish text negatively', () => {
    const result = analyzer.analyze({
      id: 'test-2',
      source: 'news_headline',
      timestamp: Date.now(),
      text: 'Massive crash as liquidation cascade hits crypto markets, hack confirmed',
      categories: ['crypto'],
    });

    assert.ok(result.score < 0, `Expected negative score, got ${result.score}`);
    assert.ok(result.confidence > 0, 'Expected non-zero confidence');
  });

  it('handles negation (not bullish → bearish)', () => {
    const result = analyzer.analyze({
      id: 'test-3',
      source: 'news_headline',
      timestamp: Date.now(),
      text: 'Analysts say market is not bullish at all',
      categories: ['crypto'],
    });

    // "not bullish" should flip to bearish → negative score
    assert.ok(result.score < 0, `Expected negative score after negation, got ${result.score}`);
  });

  it('scores Fear & Greed numeric value', () => {
    const extreme_fear = analyzer.analyze({
      id: 'fng-1',
      source: 'fear_greed',
      timestamp: Date.now(),
      text: 'Fear & Greed: 10',
      numericValue: 10,
      categories: ['crypto'],
    });

    assert.ok(extreme_fear.score < -0.5, `Expected very bearish for value 10, got ${extreme_fear.score}`);
    assert.equal(extreme_fear.label, 'very_bearish');

    const extreme_greed = analyzer.analyze({
      id: 'fng-2',
      source: 'fear_greed',
      timestamp: Date.now(),
      text: 'Fear & Greed: 90',
      numericValue: 90,
      categories: ['crypto'],
    });

    assert.ok(extreme_greed.score > 0.5, `Expected very bullish for value 90, got ${extreme_greed.score}`);
    assert.equal(extreme_greed.label, 'very_bullish');
  });

  it('scores funding rate as contrarian signal', () => {
    // Positive funding = crowded longs → contrarian bearish
    const positive_funding = analyzer.analyze({
      id: 'fr-1',
      source: 'funding_rate',
      timestamp: Date.now(),
      text: 'BTCUSDT funding: 0.05%',
      numericValue: 0.05,
      categories: ['crypto'],
    });

    assert.ok(positive_funding.score < 0, `Expected negative score for positive funding, got ${positive_funding.score}`);

    // Negative funding = crowded shorts → contrarian bullish
    const negative_funding = analyzer.analyze({
      id: 'fr-2',
      source: 'funding_rate',
      timestamp: Date.now(),
      text: 'BTCUSDT funding: -0.05%',
      numericValue: -0.05,
      categories: ['crypto'],
    });

    assert.ok(negative_funding.score > 0, `Expected positive score for negative funding, got ${negative_funding.score}`);
  });

  it('uses Adanos numeric sentiment without keyword rescoring', () => {
    const result = analyzer.analyze({
      id: 'adanos-1',
      source: 'adanos_sentiment',
      timestamp: Date.now(),
      text: 'Bitcoin market sentiment',
      numericValue: -0.42,
      categories: ['crypto'],
      meta: { mentions: 100 },
    });
    assert.equal(result.score, -0.42);
    assert.equal(result.label, 'bearish');
    assert.ok(result.confidence > 0.6);
  });

  it('returns neutral for empty/irrelevant text', () => {
    const result = analyzer.analyze({
      id: 'test-4',
      source: 'news_headline',
      timestamp: Date.now(),
      text: 'The weather is nice today in San Francisco',
      categories: ['general'],
    });

    assert.equal(result.label, 'neutral');
    assert.equal(result.confidence, 0);
  });

  it('detects politics category', () => {
    const result = analyzer.analyze({
      id: 'test-5',
      source: 'news_headline',
      timestamp: Date.now(),
      text: 'Candidate wins landslide victory in election after endorsement',
      categories: ['politics'],
    });

    assert.equal(result.category, 'politics');
    assert.ok(result.score > 0, 'Expected positive score for winning');
  });

  it('detects economics category', () => {
    const result = analyzer.analyze({
      id: 'test-6',
      source: 'news_headline',
      timestamp: Date.now(),
      text: 'Fed announces rate cut amid recession fears and rising unemployment',
      categories: ['economics'],
    });

    assert.equal(result.category, 'economics');
    assert.ok(result.matchedKeywords.length >= 2, 'Expected multiple keyword matches');
  });
});

// ============================================================================
// MARKET MATCHER
// ============================================================================

describe('market matcher', () => {
  it('matches by keyword overlap', async () => {
    const mod = await import('../../src/services/alt-data/market-matcher.js');
    const matcher = mod.createMarketMatcher(null, {
      getMarkets: () => [
        { platform: 'polymarket' as const, marketId: 'btc-100k', question: 'Will Bitcoin reach $100k by end of 2026?', tags: ['crypto', 'bitcoin'] },
        { platform: 'polymarket' as const, marketId: 'fed-rate', question: 'Will the Fed cut interest rates in March?', tags: ['economics', 'fed'] },
        { platform: 'kalshi' as const, marketId: 'rain-ny', question: 'Will it rain in New York tomorrow?', tags: ['weather'] },
      ],
    }, { minRelevance: 0.2 });

    await matcher.refreshMarkets();

    const results = await matcher.match(
      {
        id: 'test-1',
        source: 'news_headline',
        timestamp: Date.now(),
        text: 'Bitcoin surges past $95,000 as crypto market rallies',
        categories: ['crypto'],
      },
      { score: 0.6, confidence: 0.7, label: 'bullish', matchedKeywords: ['rally'], category: 'crypto' },
    );

    // Should match the Bitcoin market, not the rain market
    assert.ok(results.length > 0, 'Expected at least one match');
    const btcMatch = results.find((r: any) => r.marketId === 'btc-100k');
    assert.ok(btcMatch, 'Expected Bitcoin market to match');
  });

  it('matches by category', async () => {
    const mod = await import('../../src/services/alt-data/market-matcher.js');
    const matcher = mod.createMarketMatcher(null, {
      getMarkets: () => [
        { platform: 'polymarket' as const, marketId: 'election-2026', question: 'Who will win the 2026 election?', tags: ['politics', 'election'] },
      ],
    }, { minRelevance: 0.2 });

    await matcher.refreshMarkets();

    const results = await matcher.match(
      {
        id: 'test-2',
        source: 'news_headline',
        timestamp: Date.now(),
        text: 'Major endorsement changes race dynamics',
        categories: ['politics'],
      },
      { score: 0.4, confidence: 0.5, label: 'bullish', matchedKeywords: ['endorsement'], category: 'politics' },
    );

    assert.ok(results.length > 0, 'Expected category-based match');
    assert.equal(results[0].method, 'category');
  });

  it('returns empty when no markets loaded', async () => {
    const mod = await import('../../src/services/alt-data/market-matcher.js');
    const matcher = mod.createMarketMatcher(null, null);

    const results = await matcher.match(
      {
        id: 'test-3',
        source: 'news_headline',
        timestamp: Date.now(),
        text: 'Something happened',
        categories: [],
      },
      { score: 0, confidence: 0, label: 'neutral', matchedKeywords: [], category: 'general' },
    );

    assert.equal(results.length, 0);
  });
});

// ============================================================================
// ORCHESTRATOR (full pipeline)
// ============================================================================

describe('alt-data service', () => {
  it('processes events through full pipeline', async () => {
    const mod = await import('../../src/services/alt-data/index.js');
    const { EventEmitter } = await import('events');

    // Mock signal bus
    const signalBus = new EventEmitter() as any;
    signalBus.connectFeeds = () => {};
    signalBus.disconnectFeeds = () => {};
    signalBus.onTick = () => {};
    signalBus.onOrderbook = () => {};
    signalBus.onSignal = () => {};

    const emittedSignals: any[] = [];
    signalBus.on('signal', (s: any) => emittedSignals.push(s));

    const service = mod.createAltDataService({
      config: {
        enabled: true,
        fearGreedEnabled: false,
        fundingRatesEnabled: false,
        redditEnabled: false,
        minSentimentConfidence: 0.1,
        minMarketRelevance: 0.1,
      },
      signalBus,
      feeds: {
        getMarkets: () => [
          { platform: 'polymarket' as const, marketId: 'btc-100k', question: 'Will Bitcoin reach $100k?', tags: ['crypto'] },
        ],
      } as any,
      embeddings: null,
    });

    await service.start();

    const stats = service.getStats();
    assert.ok(Array.isArray(stats.activeFeeds));
    assert.equal(stats.eventsProcessed, 0);
    assert.equal(stats.signalsEmitted, 0);

    service.stop();
  });

  it('getRecentSignals returns empty initially', async () => {
    const mod = await import('../../src/services/alt-data/index.js');
    const { EventEmitter } = await import('events');

    const signalBus = new EventEmitter() as any;
    signalBus.connectFeeds = () => {};
    signalBus.disconnectFeeds = () => {};
    signalBus.onTick = () => {};
    signalBus.onOrderbook = () => {};
    signalBus.onSignal = () => {};

    const service = mod.createAltDataService({
      config: { enabled: true, fearGreedEnabled: false, fundingRatesEnabled: false, redditEnabled: false },
      signalBus,
    });

    const signals = service.getRecentSignals();
    assert.equal(signals.length, 0);

    const sentiment = service.getMarketSentiment('nonexistent');
    assert.equal(sentiment, null);
  });
});

// ============================================================================
// FEAR & GREED FEED
// ============================================================================

describe('fear-greed feed', () => {
  it('creates feed with start/stop lifecycle', async () => {
    const mod = await import('../../src/services/alt-data/feeds/fear-greed.js');

    const events: any[] = [];
    const feed = mod.createFearGreedFeed(
      (event) => events.push(event),
      60_000_000, // very long interval so it won't auto-poll during test
    );

    // Just verify it has the right interface
    assert.equal(typeof feed.start, 'function');
    assert.equal(typeof feed.stop, 'function');
    assert.equal(typeof feed.poll, 'function');
  });
});

// ============================================================================
// FUNDING RATES FEED
// ============================================================================

describe('funding-rates feed', () => {
  it('creates feed with start/stop lifecycle', async () => {
    const mod = await import('../../src/services/alt-data/feeds/funding-rates.js');

    const events: any[] = [];
    const feed = mod.createFundingRatesFeed(
      (event) => events.push(event),
      ['BTCUSDT'],
      60_000_000,
    );

    assert.equal(typeof feed.start, 'function');
    assert.equal(typeof feed.stop, 'function');
    assert.equal(typeof feed.poll, 'function');
  });
});

// ============================================================================
// REDDIT FEED
// ============================================================================

describe('reddit feed', () => {
  it('creates feed with start/stop lifecycle', async () => {
    const mod = await import('../../src/services/alt-data/feeds/reddit.js');

    const events: any[] = [];
    const feed = mod.createRedditFeed(
      (event) => events.push(event),
      ['testsubreddit'],
      60_000_000,
    );

    assert.equal(typeof feed.start, 'function');
    assert.equal(typeof feed.stop, 'function');
    assert.equal(typeof feed.poll, 'function');
  });
});

describe('Adanos feed', () => {
  it('rejects unsafe polling intervals', async () => {
    const mod = await import('../../src/services/alt-data/feeds/adanos.js');
    assert.throws(() => mod.createAdanosFeed(() => {}, process.env.PATH ?? '', 0), /Adanos interval/);
    assert.throws(() => mod.createAdanosFeed(() => {}, process.env.PATH ?? '', 2_147_483_648), /Adanos interval/);
  });

  it('emits validated changed sentiment snapshots', async () => {
    const originalFetch = globalThis.fetch;
    let bullishPct = 60;
    globalThis.fetch = (async (_url: URL, init?: RequestInit) => {
      assert.equal((init?.headers as Record<string, string>)['X-API-Key'], process.env.PATH);
      return new Response(JSON.stringify([
        { symbol: 'btc', name: 'Bitcoin', sentiment_score: 0.35, buzz_score: 72, mentions: 150, trend: 'rising', bullish_pct: bullishPct },
        { symbol: '../bad', sentiment_score: 0.5 },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    try {
      const mod = await import('../../src/services/alt-data/feeds/adanos.js');
      const emitted: any[] = [];
      const feed = mod.createAdanosFeed((event) => emitted.push(event), process.env.PATH ?? '', 60_000, 10);
      const first = await feed.poll();
      const second = await feed.poll();
      bullishPct = 61;
      const changed = await feed.poll();
      assert.equal(first.length, 1);
      assert.equal(second.length, 0);
      assert.equal(changed.length, 1);
      assert.equal(emitted[0].source, 'adanos_sentiment');
      assert.equal(emitted[0].numericValue, 0.35);
      assert.equal(emitted[0].meta.symbol, 'BTC');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not emit an in-flight manual poll after stop', async () => {
    const originalFetch = globalThis.fetch;
    let resolveFetch!: (response: Response) => void;
    globalThis.fetch = (() => new Promise<Response>((resolve) => { resolveFetch = resolve; })) as typeof fetch;
    try {
      const mod = await import('../../src/services/alt-data/feeds/adanos.js');
      const emitted: any[] = [];
      const feed = mod.createAdanosFeed((event) => emitted.push(event), process.env.PATH ?? '', 60_000, 10);
      const pending = feed.poll();
      feed.stop();
      resolveFetch(new Response(JSON.stringify([
        { symbol: 'BTC', sentiment_score: 0.5, mentions: 100 },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      await pending;
      assert.equal(emitted.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
