/**
 * Cross-Asset Correlation Arbitrage
 *
 * Finds arbitrage opportunities between correlated markets:
 * - Same event on different platforms
 * - Related events (e.g., "Trump wins" implies "Republican wins presidency")
 * - Time-shifted markets (e.g., BTC > $100k by Jan vs by Feb)
 * - Conditional probabilities (e.g., if A then B)
 *
 * Uses correlation analysis to find mispriced relationships.
 */

import { logger } from '../utils/logger';
import type { Platform, Market } from '../types';
import type { FeedManager } from '../feeds/index';
import type { Database } from '../db/index';

// =============================================================================
// TYPES
// =============================================================================

export type CorrelationType = 'identical' | 'implies' | 'mutually_exclusive' | 'time_shifted' | 'partial';

export interface CorrelatedPair {
  /** First market */
  marketA: {
    platform: Platform;
    marketId: string;
    question: string;
    price: number;
    outcome: string;
  };
  /** Second market */
  marketB: {
    platform: Platform;
    marketId: string;
    question: string;
    price: number;
    outcome: string;
  };
  /** Correlation type */
  correlationType: CorrelationType;
  /** Expected correlation coefficient (-1 to 1) */
  expectedCorrelation: number;
  /** Theoretical price relationship */
  theoreticalRelationship: string;
  /** Implied correlation from prices */
  impliedCorrelation: number;
  /** Mispricing amount (in probability points) */
  mispricing: number;
  /** Confidence in the correlation (0-1) */
  confidence: number;
}

export interface CorrelationArbitrageOpportunity {
  /** Opportunity ID */
  id: string;
  /** Correlated pair */
  pair: CorrelatedPair;
  /** Recommended trades */
  trades: Array<{
    platform: Platform;
    marketId: string;
    outcome: string;
    action: 'buy' | 'sell';
    price: number;
    rationale: string;
  }>;
  /** Expected edge % */
  edgePct: number;
  /** Risk assessment */
  risk: 'low' | 'medium' | 'high';
  /** Explanation of the arbitrage */
  explanation: string;
  /** When discovered */
  discoveredAt: Date;
}

export interface CorrelationConfig {
  /** Minimum correlation to consider (default: 0.7) */
  minCorrelation?: number;
  /** Minimum mispricing to report (default: 0.02 = 2%) */
  minMispricing?: number;
  /** Platforms to analyze */
  platforms?: Platform[];
  /** Categories to look for correlations */
  categories?: string[];
}

export interface CorrelationFinder {
  /** Find correlated market pairs */
  findCorrelatedPairs(): Promise<CorrelatedPair[]>;

  /** Find arbitrage opportunities from correlations */
  findArbitrage(): Promise<CorrelationArbitrageOpportunity[]>;

  /** Check if two markets are correlated */
  checkCorrelation(marketA: Market, marketB: Market): Promise<CorrelatedPair | null>;

  /** Add a known correlation rule */
  addCorrelationRule(rule: CorrelationRule): void;

  /** Get stored correlation rules */
  getCorrelationRules(): CorrelationRule[];
}

export interface CorrelationRule {
  /** Rule ID */
  id: string;
  /** Pattern to match market A */
  patternA: RegExp | string;
  /** Pattern to match market B */
  patternB: RegExp | string;
  /** Correlation type */
  type: CorrelationType;
  /** Expected correlation */
  correlation: number;
  /** Description */
  description: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<CorrelationConfig> = {
  minCorrelation: 0.7,
  minMispricing: 0.02,
  platforms: ['polymarket', 'kalshi'],
  categories: ['politics', 'crypto', 'economics'],
};

// Built-in correlation rules for common relationships
const BUILTIN_RULES: CorrelationRule[] = [
  // Political implications
  {
    id: 'trump_wins_implies_republican',
    patternA: /trump.*win.*president|trump.*elected/i,
    patternB: /republican.*win.*president/i,
    type: 'implies',
    correlation: 1.0,
    description: 'Trump winning implies Republican wins presidency',
  },
  {
    id: 'biden_wins_implies_democrat',
    patternA: /biden.*win.*president|biden.*elected/i,
    patternB: /democrat.*win.*president/i,
    type: 'implies',
    correlation: 1.0,
    description: 'Biden winning implies Democrat wins presidency',
  },
  {
    id: 'trump_biden_mutually_exclusive',
    patternA: /trump.*win.*president/i,
    patternB: /biden.*win.*president/i,
    type: 'mutually_exclusive',
    correlation: -1.0,
    description: 'Trump and Biden cannot both win',
  },

  // Crypto time-shifted
  {
    id: 'btc_100k_time_shift',
    patternA: /bitcoin.*100.*k.*(jan|january)/i,
    patternB: /bitcoin.*100.*k.*(feb|february)/i,
    type: 'implies',
    correlation: 1.0,
    description: 'If BTC hits $100k by Jan, it will also hit by Feb',
  },
  {
    id: 'eth_10k_time_shift',
    patternA: /ethereum.*10.*k.*(jan|january)/i,
    patternB: /ethereum.*10.*k.*(feb|february)/i,
    type: 'implies',
    correlation: 1.0,
    description: 'If ETH hits $10k by Jan, it will also hit by Feb',
  },

  // Economic correlations
  {
    id: 'fed_rate_cut_implies',
    patternA: /fed.*cut.*rate.*(jan|january)/i,
    patternB: /fed.*cut.*rate.*(march|q1)/i,
    type: 'implies',
    correlation: 1.0,
    description: 'If Fed cuts in Jan, they will have cut by March',
  },
  {
    id: 'recession_gdp',
    patternA: /recession.*202/i,
    patternB: /gdp.*negative.*202/i,
    type: 'partial',
    correlation: 0.8,
    description: 'Recession and negative GDP are highly correlated',
  },
];

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createCorrelationFinder(
  feeds: FeedManager,
  db: Database,
  config: CorrelationConfig = {}
): CorrelationFinder {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const customRules: CorrelationRule[] = [...BUILTIN_RULES];

  // ==========================================================================
  // CORRELATION DETECTION
  // ==========================================================================

  function matchesPattern(text: string, pattern: RegExp | string): boolean {
    if (typeof pattern === 'string') {
      return text.toLowerCase().includes(pattern.toLowerCase());
    }
    return pattern.test(text);
  }

  function findMatchingRule(marketA: Market, marketB: Market): CorrelationRule | null {
    for (const rule of customRules) {
      // Check both orderings
      if (
        (matchesPattern(marketA.question, rule.patternA) && matchesPattern(marketB.question, rule.patternB)) ||
        (matchesPattern(marketA.question, rule.patternB) && matchesPattern(marketB.question, rule.patternA))
      ) {
        return rule;
      }
    }
    return null;
  }

  function calculateTheoreticalProbability(
    priceA: number,
    priceB: number,
    rule: CorrelationRule
  ): { expectedB: number; mispricing: number } {
    switch (rule.type) {
      case 'identical':
        // Identical events should have same price
        return {
          expectedB: priceA,
          mispricing: Math.abs(priceA - priceB),
        };

      case 'implies':
        // If A implies B, then P(B) >= P(A)
        // B should be at least as high as A
        return {
          expectedB: Math.max(priceA, priceB),
          mispricing: priceA > priceB ? priceA - priceB : 0,
        };

      case 'mutually_exclusive':
        // P(A) + P(B) <= 1
        // If sum > 1, there's arbitrage
        const sum = priceA + priceB;
        return {
          expectedB: Math.min(priceB, 1 - priceA),
          mispricing: sum > 1 ? sum - 1 : 0,
        };

      case 'time_shifted':
        // Earlier deadline implies later deadline
        // Later deadline should be >= earlier
        return {
          expectedB: Math.max(priceA, priceB),
          mispricing: priceA > priceB ? priceA - priceB : 0,
        };

      case 'partial':
        // Partial correlation - use correlation coefficient
        const impliedB = priceA * rule.correlation + 0.5 * (1 - Math.abs(rule.correlation));
        return {
          expectedB: impliedB,
          mispricing: Math.abs(priceB - impliedB) * Math.abs(rule.correlation),
        };

      default:
        return { expectedB: priceB, mispricing: 0 };
    }
  }

  async function checkCorrelation(marketA: Market, marketB: Market): Promise<CorrelatedPair | null> {
    const rule = findMatchingRule(marketA, marketB);
    if (!rule) return null;

    const priceA = marketA.outcomes[0]?.price || 0.5;
    const priceB = marketB.outcomes[0]?.price || 0.5;

    const { expectedB, mispricing } = calculateTheoreticalProbability(priceA, priceB, rule);

    if (mispricing < cfg.minMispricing) return null;

    // Calculate implied correlation from prices
    const impliedCorrelation = rule.type === 'identical'
      ? 1 - Math.abs(priceA - priceB)
      : rule.type === 'mutually_exclusive'
      ? -1 + (priceA + priceB)
      : rule.correlation;

    return {
      marketA: {
        platform: marketA.platform,
        marketId: marketA.id,
        question: marketA.question,
        price: priceA,
        outcome: marketA.outcomes[0]?.name || 'YES',
      },
      marketB: {
        platform: marketB.platform,
        marketId: marketB.id,
        question: marketB.question,
        price: priceB,
        outcome: marketB.outcomes[0]?.name || 'YES',
      },
      correlationType: rule.type,
      expectedCorrelation: rule.correlation,
      theoreticalRelationship: rule.description,
      impliedCorrelation,
      mispricing,
      confidence: Math.min(1, 0.5 + mispricing * 5), // Higher mispricing = more confidence
    };
  }

  // ==========================================================================
  // ARBITRAGE FINDING
  // ==========================================================================

  async function findCorrelatedPairs(): Promise<CorrelatedPair[]> {
    const pairs: CorrelatedPair[] = [];
    const allMarkets: Market[] = [];

    // Fetch markets from all platforms
    for (const platform of cfg.platforms) {
      try {
        const markets = await feeds.searchMarkets('', platform);
        allMarkets.push(...markets.slice(0, 100)); // Limit per platform
      } catch (error) {
        logger.warn({ platform, error }, 'Failed to fetch markets for correlation');
      }
    }

    // Check all pairs
    for (let i = 0; i < allMarkets.length; i++) {
      for (let j = i + 1; j < allMarkets.length; j++) {
        const marketA = allMarkets[i];
        const marketB = allMarkets[j];

        const pair = await checkCorrelation(marketA, marketB);
        if (pair) {
          pairs.push(pair);
        }
      }
    }

    // Sort by mispricing
    pairs.sort((a, b) => b.mispricing - a.mispricing);

    logger.info({ pairsFound: pairs.length }, 'Correlation scan complete');
    return pairs;
  }

  async function findArbitrage(): Promise<CorrelationArbitrageOpportunity[]> {
    const pairs = await findCorrelatedPairs();
    const opportunities: CorrelationArbitrageOpportunity[] = [];

    for (const pair of pairs) {
      if (pair.mispricing < cfg.minMispricing) continue;

      const trades: CorrelationArbitrageOpportunity['trades'] = [];
      let explanation = '';
      let risk: 'low' | 'medium' | 'high' = 'medium';

      switch (pair.correlationType) {
        case 'identical':
          // Buy on cheaper platform, sell on more expensive
          if (pair.marketA.price < pair.marketB.price) {
            trades.push({
              platform: pair.marketA.platform,
              marketId: pair.marketA.marketId,
              outcome: pair.marketA.outcome,
              action: 'buy',
              price: pair.marketA.price,
              rationale: 'Cheaper price for identical outcome',
            });
            trades.push({
              platform: pair.marketB.platform,
              marketId: pair.marketB.marketId,
              outcome: pair.marketB.outcome,
              action: 'sell',
              price: pair.marketB.price,
              rationale: 'More expensive price for identical outcome',
            });
          } else {
            trades.push({
              platform: pair.marketB.platform,
              marketId: pair.marketB.marketId,
              outcome: pair.marketB.outcome,
              action: 'buy',
              price: pair.marketB.price,
              rationale: 'Cheaper price for identical outcome',
            });
            trades.push({
              platform: pair.marketA.platform,
              marketId: pair.marketA.marketId,
              outcome: pair.marketA.outcome,
              action: 'sell',
              price: pair.marketA.price,
              rationale: 'More expensive price for identical outcome',
            });
          }
          explanation = `Same event priced differently across platforms. Buy low, sell high.`;
          risk = 'low';
          break;

        case 'implies':
          // If A implies B but P(A) > P(B), buy B
          if (pair.marketA.price > pair.marketB.price) {
            trades.push({
              platform: pair.marketB.platform,
              marketId: pair.marketB.marketId,
              outcome: pair.marketB.outcome,
              action: 'buy',
              price: pair.marketB.price,
              rationale: `Should be >= ${pair.marketA.price} since ${pair.theoreticalRelationship}`,
            });
          }
          explanation = `Implication relationship violated. ${pair.theoreticalRelationship}`;
          risk = 'medium';
          break;

        case 'mutually_exclusive':
          // If P(A) + P(B) > 1, sell both
          if (pair.marketA.price + pair.marketB.price > 1) {
            trades.push({
              platform: pair.marketA.platform,
              marketId: pair.marketA.marketId,
              outcome: pair.marketA.outcome,
              action: 'sell',
              price: pair.marketA.price,
              rationale: 'Sum of mutually exclusive events > 100%',
            });
            trades.push({
              platform: pair.marketB.platform,
              marketId: pair.marketB.marketId,
              outcome: pair.marketB.outcome,
              action: 'sell',
              price: pair.marketB.price,
              rationale: 'Sum of mutually exclusive events > 100%',
            });
          }
          explanation = `Mutually exclusive events sum to ${((pair.marketA.price + pair.marketB.price) * 100).toFixed(1)}%.`;
          risk = 'low';
          break;

        case 'time_shifted':
          // Earlier deadline higher priced than later - arbitrage
          if (pair.marketA.price > pair.marketB.price) {
            trades.push({
              platform: pair.marketB.platform,
              marketId: pair.marketB.marketId,
              outcome: pair.marketB.outcome,
              action: 'buy',
              price: pair.marketB.price,
              rationale: 'Later deadline should be >= earlier deadline price',
            });
          }
          explanation = `Time-shifted market mispricing. ${pair.theoreticalRelationship}`;
          risk = 'medium';
          break;

        case 'partial':
          // More complex - skip for now
          continue;
      }

      if (trades.length > 0) {
        opportunities.push({
          id: `corr_${pair.marketA.marketId}_${pair.marketB.marketId}_${Date.now()}`,
          pair,
          trades,
          edgePct: pair.mispricing * 100,
          risk,
          explanation,
          discoveredAt: new Date(),
        });
      }
    }

    logger.info({ opportunitiesFound: opportunities.length }, 'Correlation arbitrage scan complete');
    return opportunities;
  }

  // ==========================================================================
  // RULE MANAGEMENT
  // ==========================================================================

  function addCorrelationRule(rule: CorrelationRule): void {
    customRules.push(rule);

    // Persist to database
    try {
      db.run(
        `INSERT OR REPLACE INTO correlation_rules (id, pattern_a, pattern_b, type, correlation, description)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          rule.id,
          rule.patternA.toString(),
          rule.patternB.toString(),
          rule.type,
          rule.correlation,
          rule.description,
        ]
      );
    } catch (error) {
      logger.warn({ error }, 'Failed to persist correlation rule');
    }

    logger.info({ ruleId: rule.id }, 'Correlation rule added');
  }

  function getCorrelationRules(): CorrelationRule[] {
    return [...customRules];
  }

  // Initialize database table
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS correlation_rules (
        id TEXT PRIMARY KEY,
        pattern_a TEXT NOT NULL,
        pattern_b TEXT NOT NULL,
        type TEXT NOT NULL,
        correlation REAL NOT NULL,
        description TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Load custom rules from database
    const savedRules = db.query<{
      id: string;
      pattern_a: string;
      pattern_b: string;
      type: string;
      correlation: number;
      description: string;
    }>('SELECT * FROM correlation_rules');

    for (const row of savedRules) {
      customRules.push({
        id: row.id,
        patternA: new RegExp(row.pattern_a.replace(/^\/|\/[a-z]*$/g, ''), 'i'),
        patternB: new RegExp(row.pattern_b.replace(/^\/|\/[a-z]*$/g, ''), 'i'),
        type: row.type as CorrelationType,
        correlation: row.correlation,
        description: row.description,
      });
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize correlation rules table');
  }

  return {
    findCorrelatedPairs,
    findArbitrage,
    checkCorrelation,
    addCorrelationRule,
    getCorrelationRules,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export { BUILTIN_RULES as DEFAULT_CORRELATION_RULES };
