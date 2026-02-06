/**
 * Alt Data → Signal Pipeline — Type Definitions
 *
 * Ingests alternative data (news, Reddit, Fear & Greed, funding rates)
 * and generates sentiment-based TradingSignals on the signal bus.
 */

import type { Platform } from '../../types.js';

// ── Source types ────────────────────────────────────────────────────────────

export type AltDataSourceType =
  | 'news_headline'
  | 'reddit_post'
  | 'fear_greed'
  | 'funding_rate';

// ── Core events ────────────────────────────────────────────────────────────

export interface AltDataEvent {
  id: string;
  source: AltDataSourceType;
  timestamp: number;
  text: string;
  body?: string;
  url?: string;
  author?: string;
  /** For Fear & Greed (0-100) or funding rate (%) */
  numericValue?: number;
  categories: string[];
  meta?: Record<string, unknown>;
}

// ── Sentiment analysis ─────────────────────────────────────────────────────

export type SentimentLabel =
  | 'very_bearish'
  | 'bearish'
  | 'neutral'
  | 'bullish'
  | 'very_bullish';

export interface SentimentResult {
  /** -1 (very bearish) to +1 (very bullish) */
  score: number;
  /** 0 to 1 */
  confidence: number;
  label: SentimentLabel;
  matchedKeywords: string[];
  category: string;
}

// ── Market matching ────────────────────────────────────────────────────────

export interface MarketMatchResult {
  platform: Platform;
  marketId: string;
  outcomeId?: string;
  question: string;
  /** 0 to 1 */
  relevance: number;
  method: 'embedding' | 'keyword' | 'category';
}

// ── Composite signal ───────────────────────────────────────────────────────

export interface AltDataSignal {
  event: AltDataEvent;
  sentiment: SentimentResult;
  matchedMarkets: MarketMatchResult[];
  generatedAt: number;
}

// ── Configuration ──────────────────────────────────────────────────────────

export interface AltDataConfig {
  enabled?: boolean;
  minSentimentConfidence?: number;
  minMarketRelevance?: number;
  /** Max event age in ms (default: 300_000 = 5 min) */
  maxAgeMs?: number;

  // Fear & Greed
  fearGreedEnabled?: boolean;
  fearGreedIntervalMs?: number;

  // Funding rates
  fundingRatesEnabled?: boolean;
  fundingRatesIntervalMs?: number;
  fundingRatesSymbols?: string[];

  // Reddit
  redditEnabled?: boolean;
  redditIntervalMs?: number;
  redditSubreddits?: string[];
}

// ── Service interface ──────────────────────────────────────────────────────

export interface AltDataService {
  start(): Promise<void>;
  stop(): void;
  /** Get recent signals (newest first) */
  getRecentSignals(limit?: number): AltDataSignal[];
  /** Get aggregated sentiment for a specific market */
  getMarketSentiment(marketId: string): {
    score: number;
    confidence: number;
    sources: number;
  } | null;
  /** Service statistics */
  getStats(): {
    eventsProcessed: number;
    signalsEmitted: number;
    activeFeeds: string[];
  };
}

// ── Sentiment analyzer interface ───────────────────────────────────────────

export interface SentimentAnalyzer {
  analyze(event: AltDataEvent): SentimentResult;
}

// ── Market matcher interface ───────────────────────────────────────────────

export interface MarketMatcher {
  match(event: AltDataEvent, sentiment: SentimentResult): Promise<MarketMatchResult[]>;
  refreshMarkets(): Promise<void>;
}
