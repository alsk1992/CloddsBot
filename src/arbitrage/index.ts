/**
 * Cross-Platform Arbitrage Service
 *
 * Detects price discrepancies across prediction markets:
 * - Polymarket, Kalshi, Manifold, Metaculus, PredictIt, Drift, Betfair
 *
 * Features:
 * - Real-time price comparison
 * - Arbitrage opportunity detection
 * - Alert notifications
 * - Historical tracking
 * - Automatic matching via question similarity
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '../utils/logger';
import { generateId as generateSecureId } from '../utils/id';
import { Database } from '../db/index';
import type { Platform, Market, PriceUpdate } from '../types';

// =============================================================================
// TYPES
// =============================================================================

export interface ArbitrageOpportunity {
  id: string;
  /** Matched market pair */
  markets: ArbitrageMarketPair[];
  /** Type of arbitrage */
  type: 'same_event' | 'correlated' | 'cross_platform';
  /** Buy on this platform at this price */
  buyPlatform: Platform;
  buyMarketId: string;
  buyOutcome: string;
  buyPrice: number;
  /** Sell on this platform at this price */
  sellPlatform: Platform;
  sellMarketId: string;
  sellOutcome: string;
  sellPrice: number;
  /** Price difference (edge) */
  spread: number;
  spreadPct: number;
  /** Estimated profit per $100 bet */
  profitPer100: number;
  /** Confidence in the match (0-1) */
  confidence: number;
  /** Liquidity available */
  buyLiquidity?: number;
  sellLiquidity?: number;
  /** Timestamps */
  detectedAt: Date;
  expiresAt?: Date;
  /** Whether opportunity is still valid */
  isActive: boolean;
}

export interface ArbitrageMarketPair {
  platform: Platform;
  marketId: string;
  question: string;
  outcome: string;
  price: number;
  volume24h?: number;
  liquidity?: number;
}

export interface MarketMatch {
  id: string;
  markets: Array<{
    platform: Platform;
    marketId: string;
    question: string;
  }>;
  similarity: number;
  matchedBy: 'manual' | 'slug' | 'question' | 'embedding';
  createdAt: Date;
}

export interface ArbitrageConfig {
  /** Minimum spread to consider (default 0.02 = 2%) */
  minSpread?: number;
  /** Minimum confidence for auto-matching (default 0.8) */
  minMatchConfidence?: number;
  /** Platforms to monitor */
  platforms?: Platform[];
  /** Poll interval in ms (default 10000) */
  pollIntervalMs?: number;
  /** Maximum age of opportunity before expiring (ms) */
  opportunityTtlMs?: number;
}

export interface ArbitrageService extends EventEmitter {
  /** Start monitoring for arbitrage */
  start(): void;

  /** Stop monitoring */
  stop(): void;

  /** Manually add a market match */
  addMatch(match: Omit<MarketMatch, 'id' | 'createdAt'>): MarketMatch;

  /** Remove a market match */
  removeMatch(matchId: string): boolean;

  /** Get all matches */
  getMatches(): MarketMatch[];

  /** Get active arbitrage opportunities */
  getOpportunities(): ArbitrageOpportunity[];

  /** Get opportunity by ID */
  getOpportunity(id: string): ArbitrageOpportunity | null;

  /** Manually check for arbitrage (one iteration) */
  checkArbitrage(): Promise<ArbitrageOpportunity[]>;

  /** Compare two specific markets */
  compareMarkets(
    platform1: Platform,
    marketId1: string,
    platform2: Platform,
    marketId2: string
  ): Promise<ArbitrageOpportunity | null>;

  /** Auto-match markets by question similarity */
  autoMatchMarkets(query: string): Promise<MarketMatch[]>;

  /** Get price for a market from cache */
  getPrice(platform: Platform, marketId: string): number | null;

  /** Format opportunities for display */
  formatOpportunities(): string;

  /** Get stats */
  getStats(): {
    matchCount: number;
    activeOpportunities: number;
    avgSpread: number;
    platforms: Platform[];
  };
}

// =============================================================================
// PRICE PROVIDERS (interfaces for feed integration)
// =============================================================================

export interface PriceProvider {
  platform: Platform;
  getPrice(marketId: string, outcome?: string): Promise<number | null>;
  getMarket?(marketId: string): Promise<Market | null>;
  searchMarkets?(query: string): Promise<Market[]>;
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: Required<ArbitrageConfig> = {
  minSpread: 0.02,
  minMatchConfidence: 0.8,
  platforms: ['polymarket', 'kalshi', 'manifold', 'predictit', 'drift', 'betfair'],
  pollIntervalMs: 10000,
  opportunityTtlMs: 60000,
};

// =============================================================================
// ARBITRAGE SERVICE IMPLEMENTATION
// =============================================================================

export function createArbitrageService(
  priceProviders: Map<Platform, PriceProvider>,
  db?: Database,
  configInput?: ArbitrageConfig
): ArbitrageService {
  const config = { ...DEFAULT_CONFIG, ...configInput };
  const emitter = new EventEmitter() as ArbitrageService;

  const matches = new Map<string, MarketMatch>();
  const opportunities = new Map<string, ArbitrageOpportunity>();
  const priceCache = new Map<string, { price: number; timestamp: number }>();

  let pollInterval: NodeJS.Timeout | null = null;
  let isRunning = false;

  // Initialize database
  if (db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS arbitrage_matches (
        id TEXT PRIMARY KEY,
        markets_json TEXT NOT NULL,
        similarity REAL NOT NULL,
        matched_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS arbitrage_opportunities (
        id TEXT PRIMARY KEY,
        markets_json TEXT NOT NULL,
        type TEXT NOT NULL,
        buy_platform TEXT NOT NULL,
        buy_market_id TEXT NOT NULL,
        buy_outcome TEXT NOT NULL,
        buy_price REAL NOT NULL,
        sell_platform TEXT NOT NULL,
        sell_market_id TEXT NOT NULL,
        sell_outcome TEXT NOT NULL,
        sell_price REAL NOT NULL,
        spread REAL NOT NULL,
        spread_pct REAL NOT NULL,
        profit_per_100 REAL NOT NULL,
        confidence REAL NOT NULL,
        detected_at TEXT NOT NULL,
        is_active INTEGER NOT NULL
      )
    `);

    // Load existing matches
    try {
      const rows = db.query<{
        id: string;
        markets_json: string;
        similarity: number;
        matched_by: string;
        created_at: string;
      }>('SELECT * FROM arbitrage_matches');

      for (const row of rows) {
        const match: MarketMatch = {
          id: row.id,
          markets: JSON.parse(row.markets_json),
          similarity: row.similarity,
          matchedBy: row.matched_by as MarketMatch['matchedBy'],
          createdAt: new Date(row.created_at),
        };
        matches.set(match.id, match);
      }

      logger.info({ count: matches.size }, 'Loaded arbitrage matches');
    } catch {
      logger.debug('No existing arbitrage matches');
    }
  }

  // Generate ID
  function generateId(prefix: string): string {
    return generateSecureId(prefix);
  }

  // Cache key
  function cacheKey(platform: Platform, marketId: string): string {
    return `${platform}:${marketId}`;
  }

  // Get price from cache or fetch
  async function fetchPrice(platform: Platform, marketId: string, outcome?: string): Promise<number | null> {
    const key = cacheKey(platform, marketId);
    const cached = priceCache.get(key);
    const now = Date.now();

    // Use cache if fresh (< 5 seconds)
    if (cached && now - cached.timestamp < 5000) {
      return cached.price;
    }

    // Evict stale entries to prevent unbounded growth
    if (priceCache.size > 10_000) {
      for (const [k, v] of priceCache) {
        if (now - v.timestamp > 60_000) priceCache.delete(k);
      }
    }

    const provider = priceProviders.get(platform);
    if (!provider) return null;

    const price = await provider.getPrice(marketId, outcome);
    if (price !== null) {
      priceCache.set(key, { price, timestamp: now });
    }

    return price;
  }

  // Calculate arbitrage between two prices
  function calculateArbitrage(
    buyPrice: number,
    sellPrice: number
  ): { spread: number; spreadPct: number; profitPer100: number } | null {
    if (buyPrice <= 0 || sellPrice <= 0) return null;
    if (buyPrice >= sellPrice) return null;

    const spread = sellPrice - buyPrice;
    const spreadPct = (spread / buyPrice) * 100;

    // Profit calculation: buy at buyPrice, sell at sellPrice
    // If we bet $100 at buyPrice, we get $100/buyPrice shares
    // If we sell at sellPrice, we get (100/buyPrice) * sellPrice
    const profitPer100 = (100 / buyPrice) * sellPrice - 100;

    return { spread, spreadPct, profitPer100 };
  }

  // Check arbitrage for a specific match
  async function checkMatchArbitrage(match: MarketMatch): Promise<ArbitrageOpportunity | null> {
    if (match.markets.length < 2) return null;

    // Fetch prices for all markets in the match
    const prices: Array<{ platform: Platform; marketId: string; question: string; price: number }> = [];

    for (const m of match.markets) {
      const price = await fetchPrice(m.platform, m.marketId);
      if (price !== null) {
        prices.push({ ...m, price });
      }
    }

    if (prices.length < 2) return null;

    // Find best arbitrage opportunity
    let bestOpportunity: ArbitrageOpportunity | null = null;
    let bestSpread = 0;

    for (let i = 0; i < prices.length; i++) {
      for (let j = 0; j < prices.length; j++) {
        if (i === j) continue;

        const arb = calculateArbitrage(prices[i].price, prices[j].price);
        if (arb && arb.spreadPct > bestSpread && arb.spreadPct >= config.minSpread * 100) {
          bestSpread = arb.spreadPct;

          bestOpportunity = {
            id: generateId('arb'),
            markets: prices.map((p) => ({
              platform: p.platform,
              marketId: p.marketId,
              question: p.question,
              outcome: 'Yes',
              price: p.price,
            })),
            type: 'cross_platform',
            buyPlatform: prices[i].platform,
            buyMarketId: prices[i].marketId,
            buyOutcome: 'Yes',
            buyPrice: prices[i].price,
            sellPlatform: prices[j].platform,
            sellMarketId: prices[j].marketId,
            sellOutcome: 'Yes',
            sellPrice: prices[j].price,
            spread: arb.spread,
            spreadPct: arb.spreadPct,
            profitPer100: arb.profitPer100,
            confidence: match.similarity,
            detectedAt: new Date(),
            expiresAt: new Date(Date.now() + config.opportunityTtlMs),
            isActive: true,
          };
        }
      }
    }

    return bestOpportunity;
  }

  // Simple question similarity
  function questionSimilarity(q1: string, q2: string): number {
    const normalize = (s: string) =>
      s.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 2);

    const words1 = new Set(normalize(q1));
    const words2 = new Set(normalize(q2));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  // Save match to database
  function saveMatch(match: MarketMatch): void {
    matches.set(match.id, match);

    if (db) {
      db.run(
        `INSERT OR REPLACE INTO arbitrage_matches (id, markets_json, similarity, matched_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          match.id,
          JSON.stringify(match.markets),
          match.similarity,
          match.matchedBy,
          match.createdAt.toISOString(),
        ]
      );
    }
  }

  // Save opportunity to database
  function saveOpportunity(opp: ArbitrageOpportunity): void {
    opportunities.set(opp.id, opp);

    if (db) {
      db.run(
        `INSERT OR REPLACE INTO arbitrage_opportunities
         (id, markets_json, type, buy_platform, buy_market_id, buy_outcome, buy_price,
          sell_platform, sell_market_id, sell_outcome, sell_price, spread, spread_pct,
          profit_per_100, confidence, detected_at, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          opp.id,
          JSON.stringify(opp.markets),
          opp.type,
          opp.buyPlatform,
          opp.buyMarketId,
          opp.buyOutcome,
          opp.buyPrice,
          opp.sellPlatform,
          opp.sellMarketId,
          opp.sellOutcome,
          opp.sellPrice,
          opp.spread,
          opp.spreadPct,
          opp.profitPer100,
          opp.confidence,
          opp.detectedAt.toISOString(),
          opp.isActive ? 1 : 0,
        ]
      );
    }
  }

  // Expire old opportunities
  function expireOpportunities(): void {
    const now = Date.now();

    for (const [id, opp] of opportunities) {
      if (opp.expiresAt && opp.expiresAt.getTime() < now) {
        opp.isActive = false;
        opportunities.delete(id);
      }
    }
  }

  // Attach methods
  Object.assign(emitter, {
    start() {
      if (isRunning) return;
      isRunning = true;

      logger.info({ config }, 'Starting arbitrage service');

      // Poll for arbitrage
      pollInterval = setInterval(async () => {
        await emitter.checkArbitrage();
      }, config.pollIntervalMs);

      // Initial check
      emitter.checkArbitrage();
    },

    stop() {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      isRunning = false;
      logger.info('Arbitrage service stopped');
    },

    addMatch(matchData) {
      const match: MarketMatch = {
        id: generateId('match'),
        markets: matchData.markets,
        similarity: matchData.similarity,
        matchedBy: matchData.matchedBy,
        createdAt: new Date(),
      };

      saveMatch(match);
      logger.info({ matchId: match.id, markets: match.markets.length }, 'Added arbitrage match');

      return match;
    },

    removeMatch(matchId) {
      const existed = matches.delete(matchId);

      if (existed && db) {
        db.run('DELETE FROM arbitrage_matches WHERE id = ?', [matchId]);
      }

      return existed;
    },

    getMatches() {
      return Array.from(matches.values());
    },

    getOpportunities() {
      expireOpportunities();
      return Array.from(opportunities.values()).filter((o) => o.isActive);
    },

    getOpportunity(id) {
      return opportunities.get(id) || null;
    },

    async checkArbitrage() {
      expireOpportunities();

      const newOpportunities: ArbitrageOpportunity[] = [];

      for (const match of matches.values()) {
        try {
          const opp = await checkMatchArbitrage(match);

          if (opp) {
            // Check if we already have this opportunity
            const existing = Array.from(opportunities.values()).find(
              (o) =>
                o.buyPlatform === opp.buyPlatform &&
                o.buyMarketId === opp.buyMarketId &&
                o.sellPlatform === opp.sellPlatform &&
                o.sellMarketId === opp.sellMarketId
            );

            if (!existing) {
              saveOpportunity(opp);
              newOpportunities.push(opp);
              emitter.emit('opportunity', opp);

              logger.info(
                {
                  id: opp.id,
                  buy: `${opp.buyPlatform}:${opp.buyPrice.toFixed(3)}`,
                  sell: `${opp.sellPlatform}:${opp.sellPrice.toFixed(3)}`,
                  spreadPct: opp.spreadPct.toFixed(2),
                },
                'Arbitrage opportunity detected'
              );
            } else {
              // Update existing opportunity prices
              existing.buyPrice = opp.buyPrice;
              existing.sellPrice = opp.sellPrice;
              existing.spread = opp.spread;
              existing.spreadPct = opp.spreadPct;
              existing.profitPer100 = opp.profitPer100;
              existing.expiresAt = opp.expiresAt;
            }
          }
        } catch (err) {
          logger.error({ err, matchId: match.id }, 'Error checking arbitrage');
        }
      }

      return newOpportunities;
    },

    async compareMarkets(platform1, marketId1, platform2, marketId2) {
      const price1 = await fetchPrice(platform1, marketId1);
      const price2 = await fetchPrice(platform2, marketId2);

      if (price1 === null || price2 === null) return null;

      // Try both directions
      const arb1 = calculateArbitrage(price1, price2);
      const arb2 = calculateArbitrage(price2, price1);

      const best = arb1 && arb2
        ? (arb1.spreadPct > arb2.spreadPct ? { arb: arb1, buy: 1 } : { arb: arb2, buy: 2 })
        : arb1 ? { arb: arb1, buy: 1 }
        : arb2 ? { arb: arb2, buy: 2 }
        : null;

      if (!best || best.arb.spreadPct < config.minSpread * 100) return null;

      const [buyPlatform, buyMarketId, buyPrice, sellPlatform, sellMarketId, sellPrice] =
        best.buy === 1
          ? [platform1, marketId1, price1, platform2, marketId2, price2]
          : [platform2, marketId2, price2, platform1, marketId1, price1];

      return {
        id: generateId('arb'),
        markets: [
          { platform: platform1, marketId: marketId1, question: '', outcome: 'Yes', price: price1 },
          { platform: platform2, marketId: marketId2, question: '', outcome: 'Yes', price: price2 },
        ],
        type: 'cross_platform' as const,
        buyPlatform,
        buyMarketId,
        buyOutcome: 'Yes',
        buyPrice,
        sellPlatform,
        sellMarketId,
        sellOutcome: 'Yes',
        sellPrice,
        spread: best.arb.spread,
        spreadPct: best.arb.spreadPct,
        profitPer100: best.arb.profitPer100,
        confidence: 1.0,
        detectedAt: new Date(),
        expiresAt: new Date(Date.now() + config.opportunityTtlMs),
        isActive: true,
      };
    },

    async autoMatchMarkets(query) {
      const newMatches: MarketMatch[] = [];
      const searchResults: Array<{ platform: Platform; markets: Market[] }> = [];

      // Search across all platforms
      for (const provider of priceProviders.values()) {
        if (provider.searchMarkets) {
          try {
            const markets = await provider.searchMarkets(query);
            if (markets.length > 0) {
              searchResults.push({ platform: provider.platform, markets });
            }
          } catch (err) {
            logger.debug({ err, platform: provider.platform }, 'Search failed');
          }
        }
      }

      // Match markets across platforms
      for (let i = 0; i < searchResults.length; i++) {
        for (let j = i + 1; j < searchResults.length; j++) {
          const results1 = searchResults[i];
          const results2 = searchResults[j];

          for (const m1 of results1.markets.slice(0, 10)) {
            for (const m2 of results2.markets.slice(0, 10)) {
              const similarity = questionSimilarity(m1.question, m2.question);

              if (similarity >= config.minMatchConfidence) {
                const match = emitter.addMatch({
                  markets: [
                    { platform: results1.platform, marketId: m1.id, question: m1.question },
                    { platform: results2.platform, marketId: m2.id, question: m2.question },
                  ],
                  similarity,
                  matchedBy: 'question',
                });

                newMatches.push(match);
              }
            }
          }
        }
      }

      return newMatches;
    },

    getPrice(platform, marketId) {
      const cached = priceCache.get(cacheKey(platform, marketId));
      return cached?.price ?? null;
    },

    formatOpportunities() {
      const active = emitter.getOpportunities();

      if (active.length === 0) {
        return '📊 No active arbitrage opportunities';
      }

      let text = `🔄 **Arbitrage Opportunities** (${active.length})\n\n`;

      for (const opp of active.slice(0, 10)) {
        text += `**${opp.spreadPct.toFixed(1)}% spread**\n`;
        text += `  📉 Buy on ${opp.buyPlatform}: $${opp.buyPrice.toFixed(3)}\n`;
        text += `  📈 Sell on ${opp.sellPlatform}: $${opp.sellPrice.toFixed(3)}\n`;
        text += `  💰 Profit per $100: $${opp.profitPer100.toFixed(2)}\n`;
        text += `  🎯 Confidence: ${(opp.confidence * 100).toFixed(0)}%\n\n`;
      }

      return text;
    },

    getStats() {
      const active = emitter.getOpportunities();
      const avgSpread = active.length > 0
        ? active.reduce((sum, o) => sum + o.spreadPct, 0) / active.length
        : 0;

      return {
        matchCount: matches.size,
        activeOpportunities: active.length,
        avgSpread,
        platforms: config.platforms,
      };
    },
  } as Partial<ArbitrageService>);

  return emitter;
}

// =============================================================================
// UTILITY: Create price provider from feed
// =============================================================================

export function feedToPriceProvider(
  platform: Platform,
  feed: {
    getMarket?: (id: string) => Promise<Market | null>;
    searchMarkets?: (query: string) => Promise<Market[]>;
  }
): PriceProvider {
  return {
    platform,
    async getPrice(marketId, outcome) {
      if (!feed.getMarket) return null;

      const market = await feed.getMarket(marketId);
      if (!market) return null;

      const outcomeData = outcome
        ? market.outcomes.find((o) => o.name.toLowerCase() === outcome.toLowerCase())
        : market.outcomes[0];

      return outcomeData?.price ?? null;
    },
    getMarket: feed.getMarket,
    searchMarkets: feed.searchMarkets,
  };
}
