/**
 * Alt Data Service — Orchestrator
 *
 * Ingests alternative data feeds, runs sentiment analysis, matches to markets,
 * and emits TradingSignals on the signal bus when confidence thresholds are met.
 */

import type { SignalBus, TradingSignal } from '../../types/signal-bus.js';
import type { AltDataConfig, AltDataEvent, AltDataSignal, AltDataService } from './types.js';
export type { AltDataService };
import { createSentimentAnalyzer } from './sentiment.js';
import { createMarketMatcher } from './market-matcher.js';
import { createFearGreedFeed, type FearGreedFeed } from './feeds/fear-greed.js';
import { createFundingRatesFeed, type FundingRatesFeed } from './feeds/funding-rates.js';
import { createRedditFeed, type RedditFeed } from './feeds/reddit.js';
import { createAdanosFeed, type AdanosFeed } from './feeds/adanos.js';
import { logger } from '../../utils/logger.js';

// ── Config defaults ────────────────────────────────────────────────────────

const DEFAULTS: Required<AltDataConfig> = {
  enabled: true,
  minSentimentConfidence: 0.3,
  minMarketRelevance: 0.6,
  maxAgeMs: 300_000,
  fearGreedEnabled: true,
  fearGreedIntervalMs: 3_600_000,
  fundingRatesEnabled: true,
  fundingRatesIntervalMs: 60_000,
  fundingRatesSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  redditEnabled: false,
  redditIntervalMs: 300_000,
  redditSubreddits: ['polymarket', 'cryptocurrency', 'wallstreetbets'],
  adanosEnabled: false,
  adanosApiKey: '',
  adanosIntervalMs: 10_800_000,
  adanosLimit: 20,
};

// ── Dependencies (loose coupling) ──────────────────────────────────────────

export interface EmbeddingsLike {
  embed(text: string): Promise<number[]>;
  cosineSimilarity(a: number[], b: number[]): number;
}

export interface FeedManagerLike {
  getMarkets?(): Array<{
    platform: import('../../types.js').Platform;
    marketId: string;
    question: string;
    outcomeId?: string;
    tags?: string[];
  }>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

// ── Factory ────────────────────────────────────────────────────────────────

export interface AltDataServiceOptions {
  config: AltDataConfig;
  signalBus: SignalBus;
  feeds?: FeedManagerLike | null;
  embeddings?: EmbeddingsLike | null;
}

// Max distinct markets to track sentiment for (prevents unbounded growth)
const MAX_SENTIMENT_CACHE_SIZE = 500;

export function createAltDataService(opts: AltDataServiceOptions): AltDataService {
  const cfg = { ...DEFAULTS, ...opts.config };
  const { signalBus } = opts;

  // Core engine
  const analyzer = createSentimentAnalyzer();
  const matcher = createMarketMatcher(
    opts.embeddings ?? null,
    opts.feeds ?? null,
    { minRelevance: cfg.minMarketRelevance },
  );

  // State
  const recentSignals: AltDataSignal[] = [];
  const marketSentimentCache = new Map<string, { scores: number[]; confidences: number[]; lastUpdated: number }>();
  let eventsProcessed = 0;
  let signalsEmitted = 0;
  let stopped = false;
  const MAX_RECENT = 200;

  // Feeds
  let fearGreedFeed: FearGreedFeed | null = null;
  let fundingRatesFeed: FundingRatesFeed | null = null;
  let redditFeed: RedditFeed | null = null;
  let adanosFeed: AdanosFeed | null = null;

  // News bridge listener (stored for cleanup on stop)
  let newsListener: ((...args: unknown[]) => void) | null = null;

  // Serial event processing queue (prevents unbounded async fan-out)
  const eventQueue: AltDataEvent[] = [];
  const MAX_QUEUE = 100;
  let draining = false;

  // ── Cache eviction ─────────────────────────────────────────────────────

  function evictStaleCacheEntries(): void {
    if (marketSentimentCache.size <= MAX_SENTIMENT_CACHE_SIZE) return;
    // Evict oldest entries (by lastUpdated) until we're at 80% capacity
    const target = Math.floor(MAX_SENTIMENT_CACHE_SIZE * 0.8);
    const entries = [...marketSentimentCache.entries()].sort(
      (a, b) => a[1].lastUpdated - b[1].lastUpdated,
    );
    const toRemove = entries.length - target;
    for (let i = 0; i < toRemove; i++) {
      marketSentimentCache.delete(entries[i][0]);
    }
  }

  // ── Event processing pipeline ──────────────────────────────────────────

  async function processEvent(event: AltDataEvent): Promise<void> {
    // Guard: don't emit after stop()
    if (stopped) return;

    eventsProcessed++;

    // 1. Sentiment analysis
    const sentiment = analyzer.analyze(event);

    // 2. Check confidence threshold
    if (sentiment.confidence < cfg.minSentimentConfidence) return;

    // 3. Market matching
    const matchedMarkets = await matcher.match(event, sentiment);

    // Re-check stopped after async work
    if (stopped) return;

    // 4. Build composite signal
    const altSignal: AltDataSignal = {
      event,
      sentiment,
      matchedMarkets,
      generatedAt: Date.now(),
    };

    // Store recent signals (append to end, read from tail — O(1) append)
    recentSignals.push(altSignal);
    if (recentSignals.length > MAX_RECENT) recentSignals.splice(0, recentSignals.length - MAX_RECENT);

    // 5. Emit TradingSignal for each matched market
    for (const market of matchedMarkets) {
      // Update per-market sentiment cache
      const cacheKey = `${market.platform}:${market.marketId}`;
      let entry = marketSentimentCache.get(cacheKey);
      if (!entry) {
        entry = { scores: [], confidences: [], lastUpdated: 0 };
        marketSentimentCache.set(cacheKey, entry);
      }
      entry.scores.push(sentiment.score);
      entry.confidences.push(sentiment.confidence);
      entry.lastUpdated = Date.now();
      // Keep rolling window of 20 scores per market
      if (entry.scores.length > 20) {
        entry.scores.shift();
        entry.confidences.shift();
      }

      // Skip neutral signals — no actionable direction
      const direction = sentiment.score > 0 ? 'buy' as const : sentiment.score < 0 ? 'sell' as const : null;
      if (!direction) continue;

      const signal: TradingSignal = {
        type: 'sentiment_shift',
        platform: market.platform,
        marketId: market.marketId,
        outcomeId: market.outcomeId ?? '',
        strength: sentiment.confidence * market.relevance,
        direction,
        features: {
          sentimentScore: sentiment.score,
          sentimentConfidence: sentiment.confidence,
          marketRelevance: market.relevance,
        },
        timestamp: Date.now(),
      };

      signalBus.emit('signal', signal);
      signalsEmitted++;

      logger.debug(
        {
          source: event.source,
          market: market.question.slice(0, 60),
          score: sentiment.score.toFixed(2),
          strength: signal.strength.toFixed(2),
          direction: signal.direction,
        },
        '[alt-data] Signal emitted',
      );
    }

    // Evict stale cache entries once per event (not per market match)
    evictStaleCacheEntries();
  }

  function onFeedEvent(event: AltDataEvent): void {
    if (stopped) return;
    // Check age — skip stale events
    if (Date.now() - event.timestamp > cfg.maxAgeMs) return;
    // Enqueue and drain serially (prevents unbounded concurrent embeds)
    if (eventQueue.length >= MAX_QUEUE) return; // back-pressure: drop if full
    eventQueue.push(event);
    drainQueue();
  }

  async function drainQueue(): Promise<void> {
    if (draining) return;
    draining = true;
    while (eventQueue.length > 0 && !stopped) {
      const event = eventQueue.shift()!;
      await processEvent(event).catch((error) => {
        logger.warn({ error, source: event.source }, '[alt-data] Event processing failed');
      });
    }
    draining = false;
  }

  // ── Service lifecycle ──────────────────────────────────────────────────

  async function start(): Promise<void> {
    stopped = false;

    // Pre-warm market embeddings in background (don't block gateway startup)
    matcher.refreshMarkets().catch((err) =>
      logger.warn({ error: err }, '[alt-data] Background market refresh failed'),
    );

    // Start enabled feeds
    if (cfg.fearGreedEnabled) {
      fearGreedFeed = createFearGreedFeed(onFeedEvent, cfg.fearGreedIntervalMs);
      fearGreedFeed.start();
    }

    if (cfg.fundingRatesEnabled) {
      fundingRatesFeed = createFundingRatesFeed(onFeedEvent, cfg.fundingRatesSymbols, cfg.fundingRatesIntervalMs);
      fundingRatesFeed.start();
    }

    if (cfg.redditEnabled) {
      redditFeed = createRedditFeed(onFeedEvent, cfg.redditSubreddits, cfg.redditIntervalMs);
      redditFeed.start();
    }

    if (cfg.adanosEnabled) {
      if (cfg.adanosApiKey) {
        adanosFeed = createAdanosFeed(onFeedEvent, cfg.adanosApiKey, cfg.adanosIntervalMs, cfg.adanosLimit);
        adanosFeed.start();
      } else {
        logger.warn('[alt-data] Adanos feed enabled without ADANOS_API_KEY; feed disabled');
      }
    }

    // Bridge existing news events if FeedManager is available
    if (opts.feeds?.on) {
      newsListener = (item: unknown) => {
        const newsItem = item as { id?: string; title?: string; content?: string; url?: string; author?: string; source?: string };
        if (!newsItem?.title) return;

        const event: AltDataEvent = {
          id: `news-${newsItem.id ?? Date.now()}`,
          source: 'news_headline',
          timestamp: Date.now(),
          text: newsItem.title,
          body: newsItem.content?.slice(0, 500),
          url: newsItem.url,
          author: newsItem.author,
          categories: ['news'],
          meta: { originalSource: newsItem.source },
        };

        onFeedEvent(event);
      };
      opts.feeds.on('news', newsListener);
    }

    const activeFeeds = getActiveFeeds();
    logger.info({ feeds: activeFeeds, eventsProcessed, signalsEmitted }, '[alt-data] Service started');
  }

  function stop(): void {
    stopped = true;
    // Remove news bridge listener to prevent leak on reload
    if (newsListener && opts.feeds?.removeListener) {
      opts.feeds.removeListener('news', newsListener);
    }
    newsListener = null;
    fearGreedFeed?.stop();
    fundingRatesFeed?.stop();
    redditFeed?.stop();
    adanosFeed?.stop();
    fearGreedFeed = null;
    fundingRatesFeed = null;
    redditFeed = null;
    adanosFeed = null;
    // Clear pending queue
    eventQueue.length = 0;
    logger.info({ eventsProcessed, signalsEmitted }, '[alt-data] Service stopped');
  }

  function getActiveFeeds(): string[] {
    const active: string[] = [];
    if (fearGreedFeed) active.push('fear_greed');
    if (fundingRatesFeed) active.push('funding_rates');
    if (redditFeed) active.push('reddit');
    if (adanosFeed) active.push('adanos');
    if (opts.feeds?.on) active.push('news_bridge');
    return active;
  }

  function getRecentSignals(limit = 20): AltDataSignal[] {
    // Signals stored oldest-first; return newest-first
    const start = Math.max(0, recentSignals.length - limit);
    return recentSignals.slice(start).reverse();
  }

  function getMarketSentiment(marketId: string): { score: number; confidence: number; sources: number } | null {
    // Aggregate across all platforms for this marketId
    const allScores: number[] = [];
    const allConfs: number[] = [];
    for (const [key, entry] of marketSentimentCache) {
      if (key.endsWith(`:${marketId}`)) {
        allScores.push(...entry.scores);
        allConfs.push(...entry.confidences);
      }
    }
    if (allScores.length === 0) return null;
    const avgScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    const avgConf = allConfs.reduce((a, b) => a + b, 0) / allConfs.length;
    return {
      score: avgScore,
      confidence: avgConf,
      sources: allScores.length,
    };
  }

  function getStats() {
    return {
      eventsProcessed,
      signalsEmitted,
      activeFeeds: getActiveFeeds(),
    };
  }

  return {
    start,
    stop,
    getRecentSignals,
    getMarketSentiment,
    getStats,
  };
}
