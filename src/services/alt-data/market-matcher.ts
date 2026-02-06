/**
 * Market Matcher — Maps alt-data events to active prediction markets
 *
 * Uses embeddings for semantic matching with a keyword/category fallback.
 * Follows the pattern from src/opportunity/matching.ts.
 */

import type { Platform } from '../../types.js';
import type {
  AltDataEvent,
  SentimentResult,
  MarketMatchResult,
  MarketMatcher,
} from './types.js';
import { logger } from '../../utils/logger.js';

// ── Minimal interfaces for dependencies (avoids circular imports) ──────────

interface EmbeddingsLike {
  embed(text: string): Promise<number[]>;
  cosineSimilarity(a: number[], b: number[]): number;
}

interface MarketEntry {
  platform: Platform;
  marketId: string;
  question: string;
  outcomeId?: string;
  tags?: string[];
}

interface FeedManagerLike {
  getMarkets?(): MarketEntry[];
}

// ── Config ─────────────────────────────────────────────────────────────────

interface MarketMatcherConfig {
  minRelevance: number;
  maxResults: number;
  cacheRefreshMs: number;
}

const DEFAULTS: MarketMatcherConfig = {
  minRelevance: 0.6,
  maxResults: 5,
  cacheRefreshMs: 10 * 60 * 1000, // 10 min
};

// ── Category → keyword map for fallback matching ───────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  crypto: ['bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'crypto', 'token', 'defi', 'nft'],
  politics: ['election', 'president', 'vote', 'congress', 'senate', 'governor', 'primary', 'poll', 'democrat', 'republican', 'trump', 'biden'],
  economics: ['fed', 'inflation', 'gdp', 'interest rate', 'recession', 'unemployment', 'cpi', 'jobs report', 'tariff'],
  geopolitical: ['war', 'conflict', 'ukraine', 'russia', 'china', 'taiwan', 'nato', 'ceasefire', 'sanctions', 'missile'],
  sports: ['nba', 'nfl', 'mlb', 'nhl', 'championship', 'playoff', 'super bowl', 'world cup', 'final', 'mvp'],
};

// ── Factory ────────────────────────────────────────────────────────────────

export function createMarketMatcher(
  embeddings: EmbeddingsLike | null,
  feeds: FeedManagerLike | null,
  config?: Partial<MarketMatcherConfig>,
): MarketMatcher {
  const cfg = { ...DEFAULTS, ...config };

  // Cached market embeddings
  let cachedMarkets: MarketEntry[] = [];
  let cachedEmbeddings: Map<string, number[]> = new Map();
  let lastRefresh = 0;

  async function refreshMarkets(): Promise<void> {
    if (!feeds?.getMarkets) {
      cachedMarkets = [];
      cachedEmbeddings = new Map();
      return;
    }

    try {
      cachedMarkets = feeds.getMarkets();
      if (embeddings && cachedMarkets.length > 0) {
        const newCache = new Map<string, number[]>();
        // Embed in batches of 20 to avoid overwhelming
        for (let i = 0; i < cachedMarkets.length; i += 20) {
          const batch = cachedMarkets.slice(i, i + 20);
          const results = await Promise.allSettled(
            batch.map((m) => embeddings.embed(m.question)),
          );
          for (let j = 0; j < results.length; j++) {
            const result = results[j];
            if (result.status === 'fulfilled' && result.value.length > 0) {
              const key = `${batch[j].platform}:${batch[j].marketId}`;
              newCache.set(key, result.value);
            }
          }
        }
        cachedEmbeddings = newCache;
      }
      lastRefresh = Date.now();
      logger.debug({ markets: cachedMarkets.length, embeddings: cachedEmbeddings.size }, '[alt-data] Market cache refreshed');
    } catch (error) {
      logger.warn({ error }, '[alt-data] Failed to refresh market cache');
    }
  }

  async function ensureFresh(): Promise<void> {
    if (Date.now() - lastRefresh > cfg.cacheRefreshMs) {
      await refreshMarkets();
    }
  }

  function keywordMatch(text: string, question: string): number {
    const textLower = text.toLowerCase();
    const questionLower = question.toLowerCase();
    const textTokens = new Set(textLower.split(/\s+/));
    const questionTokens = questionLower.split(/\s+/).filter((t) => t.length > 3);

    if (questionTokens.length === 0) return 0;

    let matches = 0;
    for (const token of questionTokens) {
      if (textTokens.has(token)) matches++;
    }

    return matches / questionTokens.length;
  }

  function categoryMatch(category: string, market: MarketEntry): number {
    const keywords = CATEGORY_KEYWORDS[category];
    if (!keywords) return 0;

    const questionLower = market.question.toLowerCase();
    const tagsLower = (market.tags ?? []).map((t) => t.toLowerCase());

    let matches = 0;
    for (const kw of keywords) {
      if (questionLower.includes(kw) || tagsLower.some((t) => t.includes(kw))) {
        matches++;
      }
    }

    return Math.min(1, matches / 2); // 2+ keyword matches = full score
  }

  async function match(
    event: AltDataEvent,
    sentiment: SentimentResult,
  ): Promise<MarketMatchResult[]> {
    await ensureFresh();

    if (cachedMarkets.length === 0) return [];

    const eventText = `${event.text} ${event.body ?? ''}`;
    const results: MarketMatchResult[] = [];

    // Try embeddings-based matching first
    if (embeddings && cachedEmbeddings.size > 0) {
      try {
        const eventEmbedding = await embeddings.embed(eventText);
        if (eventEmbedding.length > 0) {
          for (const market of cachedMarkets) {
            const key = `${market.platform}:${market.marketId}`;
            const marketEmb = cachedEmbeddings.get(key);
            if (!marketEmb) continue;

            const similarity = embeddings.cosineSimilarity(eventEmbedding, marketEmb);
            if (similarity >= cfg.minRelevance) {
              results.push({
                platform: market.platform,
                marketId: market.marketId,
                outcomeId: market.outcomeId,
                question: market.question,
                relevance: similarity,
                method: 'embedding',
              });
            }
          }
        }
      } catch (error) {
        logger.debug({ error }, '[alt-data] Embeddings match failed, falling back to keywords');
      }
    }

    // Keyword + category fallback (or augment if few embedding matches)
    if (results.length < cfg.maxResults) {
      for (const market of cachedMarkets) {
        // Skip if already matched via embeddings
        if (results.some((r) => r.platform === market.platform && r.marketId === market.marketId)) {
          continue;
        }

        const kwScore = keywordMatch(eventText, market.question);
        const catScore = categoryMatch(sentiment.category, market);
        const combined = Math.max(kwScore, catScore);

        if (combined >= cfg.minRelevance) {
          results.push({
            platform: market.platform,
            marketId: market.marketId,
            outcomeId: market.outcomeId,
            question: market.question,
            relevance: combined,
            method: kwScore >= catScore ? 'keyword' : 'category',
          });
        }
      }
    }

    // Sort by relevance desc, limit results
    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, cfg.maxResults);
  }

  return { match, refreshMarkets };
}
