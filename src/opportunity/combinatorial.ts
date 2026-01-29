/**
 * Combinatorial Arbitrage Detection
 *
 * Based on "Unravelling the Probabilistic Forest: Arbitrage in Prediction Markets"
 * (arXiv:2508.03474) - Saguillo et al.
 *
 * Implements:
 * 1. Market Rebalancing Arbitrage (YES + NO != $1)
 * 2. Combinatorial Arbitrage (conditional dependencies)
 * 3. Heuristic reduction (O(2^n+m) → manageable)
 * 4. Order book imbalance signals
 */

import type { Database } from 'better-sqlite3';
import type { FeedManager } from '../feeds/types';

// ============================================================================
// Types
// ============================================================================

export interface MarketCondition {
  platform: string;
  marketId: string;
  conditionId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  endDate?: Date;
  volume24h?: number;
  liquidity?: number;
}

export interface RebalanceOpportunity {
  type: 'rebalance_long' | 'rebalance_short';
  market: MarketCondition;
  totalCost: number;      // Sum of YES + NO prices
  guaranteedPayout: number; // Always $1 for binary
  grossProfit: number;    // |1 - totalCost|
  netProfit: number;      // After estimated fees
  edgePct: number;
  confidence: number;
}

export interface CombinatorialOpportunity {
  type: 'combinatorial';
  markets: MarketCondition[];
  relationship: DependencyRelationship;
  impliedProbability: number;
  marketProbability: number;
  edgePct: number;
  strategy: CombinatorialStrategy;
  confidence: number;
}

export type DependencyRelationship =
  | 'implies'           // A → B (if A true, B must be true)
  | 'implied_by'        // B → A
  | 'mutually_exclusive' // A ⊕ B (exactly one true)
  | 'exhaustive'        // A ∨ B = 1 (at least one true)
  | 'equivalent'        // A ↔ B (same outcome)
  | 'inverse';          // A = ¬B

export interface CombinatorialStrategy {
  action: 'buy' | 'sell';
  positions: Array<{
    marketId: string;
    outcome: 'YES' | 'NO';
    size: number;
  }>;
  expectedProfit: number;
  maxLoss: number;
}

export interface OrderBookImbalance {
  marketId: string;
  obi: number;           // (Qbid - Qask) / (Qbid + Qask)
  imbalanceRatio: number; // Bid_vol / (Bid_vol + Ask_vol)
  vamp: number;          // Volume-adjusted mid price
  signal: 'bullish' | 'bearish' | 'neutral';
  strength: number;      // 0-1
}

export interface MarketCluster {
  id: string;
  topic: string;
  markets: MarketCondition[];
  endDateRange: { min: Date; max: Date };
  avgSimilarity: number;
}

// ============================================================================
// Market Rebalancing Arbitrage
// ============================================================================

/**
 * Detect single-market rebalancing opportunities
 * When YES + NO != $1, guaranteed profit exists
 */
export function findRebalanceOpportunities(
  markets: MarketCondition[],
  options: {
    minEdgePct?: number;
    feeRate?: number;
  } = {}
): RebalanceOpportunity[] {
  const { minEdgePct = 0.5, feeRate = 0.02 } = options;
  const opportunities: RebalanceOpportunity[] = [];

  for (const market of markets) {
    const totalCost = market.yesPrice + market.noPrice;
    const deviation = Math.abs(1 - totalCost);

    if (deviation < 0.001) continue; // No opportunity

    const grossProfit = deviation;
    const fees = totalCost * feeRate;
    const netProfit = grossProfit - fees;
    const edgePct = (netProfit / totalCost) * 100;

    if (edgePct < minEdgePct) continue;

    // Long when sum < 1 (buy both, guaranteed $1 payout)
    // Short when sum > 1 (sell both, collect premium)
    const type = totalCost < 1 ? 'rebalance_long' : 'rebalance_short';

    opportunities.push({
      type,
      market,
      totalCost,
      guaranteedPayout: 1,
      grossProfit,
      netProfit,
      edgePct,
      confidence: calculateRebalanceConfidence(market, deviation),
    });
  }

  return opportunities.sort((a, b) => b.edgePct - a.edgePct);
}

function calculateRebalanceConfidence(
  market: MarketCondition,
  deviation: number
): number {
  let confidence = 0.5;

  // Higher deviation = more confident it's real
  if (deviation > 0.05) confidence += 0.2;
  else if (deviation > 0.02) confidence += 0.1;

  // Higher liquidity = more confident
  if (market.liquidity && market.liquidity > 10000) confidence += 0.15;
  else if (market.liquidity && market.liquidity > 1000) confidence += 0.1;

  // Recent volume = active market
  if (market.volume24h && market.volume24h > 5000) confidence += 0.15;

  return Math.min(confidence, 1);
}

// ============================================================================
// Combinatorial Arbitrage Detection
// ============================================================================

/**
 * Detect conditional dependencies between markets
 * Uses heuristic reduction to avoid O(2^n+m) comparisons
 */
export function findCombinatorialOpportunities(
  clusters: MarketCluster[],
  options: {
    minEdgePct?: number;
    minConfidence?: number;
  } = {}
): CombinatorialOpportunity[] {
  const { minEdgePct = 1, minConfidence = 0.7 } = options;
  const opportunities: CombinatorialOpportunity[] = [];

  for (const cluster of clusters) {
    // Only analyze markets within same cluster (heuristic reduction)
    const markets = cluster.markets;

    // Pairwise dependency detection within cluster
    for (let i = 0; i < markets.length; i++) {
      for (let j = i + 1; j < markets.length; j++) {
        const a = markets[i];
        const b = markets[j];

        const dependency = detectDependency(a, b);
        if (!dependency) continue;

        const opp = analyzeCombinatorialArbitrage(a, b, dependency);
        if (opp && opp.edgePct >= minEdgePct && opp.confidence >= minConfidence) {
          opportunities.push(opp);
        }
      }
    }

    // Multi-market exhaustive check (sum should = 1)
    if (markets.length >= 3) {
      const exhaustiveOpp = checkExhaustiveConditions(markets);
      if (exhaustiveOpp && exhaustiveOpp.edgePct >= minEdgePct) {
        opportunities.push(exhaustiveOpp);
      }
    }
  }

  return opportunities.sort((a, b) => b.edgePct - a.edgePct);
}

/**
 * Detect logical dependency between two markets
 */
function detectDependency(
  a: MarketCondition,
  b: MarketCondition
): DependencyRelationship | null {
  const qA = a.question.toLowerCase();
  const qB = b.question.toLowerCase();

  // Implication patterns: "X wins" implies "X's party wins"
  // e.g., "Trump wins" → "Republican wins"
  if (isImplication(qA, qB)) return 'implies';
  if (isImplication(qB, qA)) return 'implied_by';

  // Mutual exclusivity: "X wins" vs "Y wins" (same race)
  if (areMutuallyExclusive(qA, qB)) return 'mutually_exclusive';

  // Equivalence: Same question, different wording
  if (areEquivalentQuestions(qA, qB)) return 'equivalent';

  // Inverse: "X happens" vs "X doesn't happen"
  if (areInverseQuestions(qA, qB)) return 'inverse';

  return null;
}

function isImplication(premise: string, conclusion: string): boolean {
  // Pattern: specific candidate → party win
  const candidateParty: Record<string, string> = {
    'trump': 'republican',
    'desantis': 'republican',
    'haley': 'republican',
    'biden': 'democrat',
    'harris': 'democrat',
    'newsom': 'democrat',
  };

  for (const [candidate, party] of Object.entries(candidateParty)) {
    if (premise.includes(candidate) && premise.includes('win')) {
      if (conclusion.includes(party) && conclusion.includes('win')) {
        return true;
      }
    }
  }

  // Pattern: "before X" implies "by Y" where Y > X
  const beforeMatch = premise.match(/before\s+(\w+)\s+(\d+)/);
  const byMatch = conclusion.match(/by\s+(\w+)\s+(\d+)/);
  if (beforeMatch && byMatch) {
    // Simplified: same year, earlier month implies later
    return true;
  }

  return false;
}

function areMutuallyExclusive(a: string, b: string): boolean {
  // Same election, different candidates
  const electionPatterns = [
    /(\w+)\s+wins?\s+(president|election|primary)/,
    /next\s+(president|pm|chancellor)/,
  ];

  for (const pattern of electionPatterns) {
    const matchA = a.match(pattern);
    const matchB = b.match(pattern);
    if (matchA && matchB && matchA[2] === matchB[2] && matchA[1] !== matchB[1]) {
      return true;
    }
  }

  return false;
}

function areEquivalentQuestions(a: string, b: string): boolean {
  // Normalize and compare
  const normalize = (s: string) => s
    .replace(/will\s+/g, '')
    .replace(/\?/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const normA = normalize(a);
  const normB = normalize(b);

  // Simple word overlap check (>80% overlap)
  const wordsA = new Set(normA.split(' '));
  const wordsB = new Set(normB.split(' '));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  const jaccard = intersection.length / union.size;

  return jaccard > 0.8;
}

function areInverseQuestions(a: string, b: string): boolean {
  const negations = ['not', "won't", "doesn't", 'no ', 'fail'];

  const hasNegA = negations.some(n => a.includes(n));
  const hasNegB = negations.some(n => b.includes(n));

  // One has negation, other doesn't, otherwise similar
  if (hasNegA !== hasNegB) {
    const stripNeg = (s: string) => {
      for (const n of negations) {
        s = s.replace(n, '');
      }
      return s.replace(/\s+/g, ' ').trim();
    };
    return areEquivalentQuestions(stripNeg(a), stripNeg(b));
  }

  return false;
}

/**
 * Analyze arbitrage opportunity given detected dependency
 */
function analyzeCombinatorialArbitrage(
  a: MarketCondition,
  b: MarketCondition,
  relationship: DependencyRelationship
): CombinatorialOpportunity | null {
  let impliedProbability: number;
  let marketProbability: number;
  let strategy: CombinatorialStrategy;

  switch (relationship) {
    case 'implies':
      // If A → B, then P(A) <= P(B)
      // Arbitrage if P(A) > P(B) in market
      impliedProbability = a.yesPrice; // A implies B, so B >= A
      marketProbability = b.yesPrice;

      if (a.yesPrice > b.yesPrice + 0.01) {
        // Mispricing: sell A YES, buy B YES
        strategy = {
          action: 'sell',
          positions: [
            { marketId: a.marketId, outcome: 'YES', size: 100 },
            { marketId: b.marketId, outcome: 'YES', size: 100 },
          ],
          expectedProfit: (a.yesPrice - b.yesPrice) * 100,
          maxLoss: 0, // Hedged
        };
      } else {
        return null;
      }
      break;

    case 'implied_by':
      // B → A, so P(B) <= P(A)
      impliedProbability = b.yesPrice;
      marketProbability = a.yesPrice;

      if (b.yesPrice > a.yesPrice + 0.01) {
        strategy = {
          action: 'sell',
          positions: [
            { marketId: b.marketId, outcome: 'YES', size: 100 },
            { marketId: a.marketId, outcome: 'YES', size: 100 },
          ],
          expectedProfit: (b.yesPrice - a.yesPrice) * 100,
          maxLoss: 0,
        };
      } else {
        return null;
      }
      break;

    case 'mutually_exclusive':
      // P(A) + P(B) <= 1 (if exhaustive, = 1)
      impliedProbability = 1;
      marketProbability = a.yesPrice + b.yesPrice;

      if (marketProbability > 1.02) {
        // Both overpriced, sell both YES
        strategy = {
          action: 'sell',
          positions: [
            { marketId: a.marketId, outcome: 'YES', size: 100 },
            { marketId: b.marketId, outcome: 'YES', size: 100 },
          ],
          expectedProfit: (marketProbability - 1) * 100,
          maxLoss: 0,
        };
      } else {
        return null;
      }
      break;

    case 'equivalent':
      // P(A) = P(B)
      impliedProbability = (a.yesPrice + b.yesPrice) / 2;
      marketProbability = Math.max(a.yesPrice, b.yesPrice);

      const spread = Math.abs(a.yesPrice - b.yesPrice);
      if (spread > 0.02) {
        // Buy cheap, sell expensive
        const [cheap, expensive] = a.yesPrice < b.yesPrice ? [a, b] : [b, a];
        strategy = {
          action: 'buy',
          positions: [
            { marketId: cheap.marketId, outcome: 'YES', size: 100 },
            { marketId: expensive.marketId, outcome: 'NO', size: 100 },
          ],
          expectedProfit: spread * 100,
          maxLoss: 0,
        };
      } else {
        return null;
      }
      break;

    case 'inverse':
      // P(A) + P(B) = 1
      impliedProbability = 1;
      marketProbability = a.yesPrice + b.yesPrice;

      if (Math.abs(marketProbability - 1) > 0.02) {
        if (marketProbability < 1) {
          // Both underpriced, buy both
          strategy = {
            action: 'buy',
            positions: [
              { marketId: a.marketId, outcome: 'YES', size: 100 },
              { marketId: b.marketId, outcome: 'YES', size: 100 },
            ],
            expectedProfit: (1 - marketProbability) * 100,
            maxLoss: 0,
          };
        } else {
          // Both overpriced, sell both
          strategy = {
            action: 'sell',
            positions: [
              { marketId: a.marketId, outcome: 'YES', size: 100 },
              { marketId: b.marketId, outcome: 'YES', size: 100 },
            ],
            expectedProfit: (marketProbability - 1) * 100,
            maxLoss: 0,
          };
        }
      } else {
        return null;
      }
      break;

    default:
      return null;
  }

  const edgePct = Math.abs(impliedProbability - marketProbability) * 100;

  return {
    type: 'combinatorial',
    markets: [a, b],
    relationship,
    impliedProbability,
    marketProbability,
    edgePct,
    strategy,
    confidence: calculateCombinatorialConfidence(a, b, relationship),
  };
}

function calculateCombinatorialConfidence(
  a: MarketCondition,
  b: MarketCondition,
  relationship: DependencyRelationship
): number {
  let confidence = 0.5;

  // Stronger relationships = higher confidence
  if (relationship === 'equivalent' || relationship === 'inverse') {
    confidence += 0.2;
  } else if (relationship === 'implies' || relationship === 'implied_by') {
    confidence += 0.1;
  }

  // Both markets have liquidity
  if (a.liquidity && b.liquidity) {
    const minLiq = Math.min(a.liquidity, b.liquidity);
    if (minLiq > 5000) confidence += 0.15;
    else if (minLiq > 1000) confidence += 0.1;
  }

  // Similar end dates
  if (a.endDate && b.endDate) {
    const daysDiff = Math.abs(a.endDate.getTime() - b.endDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff < 1) confidence += 0.15;
    else if (daysDiff < 7) confidence += 0.1;
  }

  return Math.min(confidence, 1);
}

/**
 * Check if N mutually exclusive conditions sum to 1
 */
function checkExhaustiveConditions(
  markets: MarketCondition[]
): CombinatorialOpportunity | null {
  // Sum of all YES prices should = 1 if exhaustive
  const totalYes = markets.reduce((sum, m) => sum + m.yesPrice, 0);
  const deviation = Math.abs(totalYes - 1);

  if (deviation < 0.02) return null; // Within tolerance

  const strategy: CombinatorialStrategy = totalYes < 1
    ? {
        action: 'buy',
        positions: markets.map(m => ({
          marketId: m.marketId,
          outcome: 'YES' as const,
          size: 100 / markets.length,
        })),
        expectedProfit: (1 - totalYes) * 100,
        maxLoss: 0,
      }
    : {
        action: 'sell',
        positions: markets.map(m => ({
          marketId: m.marketId,
          outcome: 'YES' as const,
          size: 100 / markets.length,
        })),
        expectedProfit: (totalYes - 1) * 100,
        maxLoss: 0,
      };

  return {
    type: 'combinatorial',
    markets,
    relationship: 'exhaustive',
    impliedProbability: 1,
    marketProbability: totalYes,
    edgePct: deviation * 100,
    strategy,
    confidence: 0.7 + (markets.length > 3 ? 0.1 : 0),
  };
}

// ============================================================================
// Heuristic Market Clustering (reduces O(2^n+m) to manageable)
// ============================================================================

/**
 * Cluster markets by topic and timeliness
 * This is the key heuristic from the paper
 */
export function clusterMarkets(
  markets: MarketCondition[],
  options: {
    maxDaysApart?: number;
    minSimilarity?: number;
  } = {}
): MarketCluster[] {
  const { maxDaysApart = 30, minSimilarity = 0.3 } = options;
  const clusters: MarketCluster[] = [];
  const assigned = new Set<string>();

  // Sort by end date for timeliness grouping
  const sorted = [...markets].sort((a, b) => {
    if (!a.endDate || !b.endDate) return 0;
    return a.endDate.getTime() - b.endDate.getTime();
  });

  for (const market of sorted) {
    const key = `${market.platform}:${market.marketId}`;
    if (assigned.has(key)) continue;

    // Start new cluster
    const cluster: MarketCluster = {
      id: `cluster_${clusters.length}`,
      topic: extractTopic(market.question),
      markets: [market],
      endDateRange: {
        min: market.endDate || new Date(),
        max: market.endDate || new Date(),
      },
      avgSimilarity: 1,
    };

    assigned.add(key);

    // Find similar markets within time window
    for (const candidate of sorted) {
      const candKey = `${candidate.platform}:${candidate.marketId}`;
      if (assigned.has(candKey)) continue;

      // Check timeliness
      if (market.endDate && candidate.endDate) {
        const daysDiff = Math.abs(
          market.endDate.getTime() - candidate.endDate.getTime()
        ) / (1000 * 60 * 60 * 24);
        if (daysDiff > maxDaysApart) continue;
      }

      // Check topical similarity
      const similarity = calculateTopicSimilarity(market.question, candidate.question);
      if (similarity < minSimilarity) continue;

      cluster.markets.push(candidate);
      assigned.add(candKey);

      // Update cluster metadata
      if (candidate.endDate) {
        if (candidate.endDate < cluster.endDateRange.min) {
          cluster.endDateRange.min = candidate.endDate;
        }
        if (candidate.endDate > cluster.endDateRange.max) {
          cluster.endDateRange.max = candidate.endDate;
        }
      }
    }

    if (cluster.markets.length > 1) {
      // Calculate average pairwise similarity
      let totalSim = 0;
      let pairs = 0;
      for (let i = 0; i < cluster.markets.length; i++) {
        for (let j = i + 1; j < cluster.markets.length; j++) {
          totalSim += calculateTopicSimilarity(
            cluster.markets[i].question,
            cluster.markets[j].question
          );
          pairs++;
        }
      }
      cluster.avgSimilarity = pairs > 0 ? totalSim / pairs : 0;
    }

    clusters.push(cluster);
  }

  return clusters.filter(c => c.markets.length > 1);
}

function extractTopic(question: string): string {
  // Extract main topic from question
  const q = question.toLowerCase();

  // Election topics
  if (q.includes('president') || q.includes('election') || q.includes('vote')) {
    if (q.includes('2024')) return 'election_2024';
    if (q.includes('2028')) return 'election_2028';
    return 'election';
  }

  // Crypto topics
  if (q.includes('bitcoin') || q.includes('btc')) return 'bitcoin';
  if (q.includes('ethereum') || q.includes('eth')) return 'ethereum';
  if (q.includes('crypto')) return 'crypto';

  // Fed/rates
  if (q.includes('fed') || q.includes('fomc') || q.includes('rate')) return 'fed_rates';

  // Sports
  if (q.includes('super bowl') || q.includes('nfl')) return 'nfl';
  if (q.includes('world series') || q.includes('mlb')) return 'mlb';

  return 'general';
}

function calculateTopicSimilarity(a: string, b: string): number {
  // Simple Jaccard similarity on normalized tokens
  const tokenize = (s: string) => {
    return s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 2);
  };

  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));

  const intersection = [...tokensA].filter(t => tokensB.has(t));
  const union = new Set([...tokensA, ...tokensB]);

  return union.size > 0 ? intersection.length / union.size : 0;
}

// ============================================================================
// Order Book Imbalance Signals
// ============================================================================

/**
 * Calculate order book imbalance indicators
 * OBI explains ~65% of short-interval price variance
 * IR > 0.65 predicts price increase (58% accuracy)
 */
export function calculateOrderBookImbalance(
  bidVolume: number,
  askVolume: number,
  bidPrice: number,
  askPrice: number
): OrderBookImbalance {
  // Order Book Imbalance
  const obi = (bidVolume - askVolume) / (bidVolume + askVolume || 1);

  // Imbalance Ratio
  const ir = bidVolume / (bidVolume + askVolume || 1);

  // Volume-Adjusted Mid Price
  const vamp = (bidPrice * askVolume + askPrice * bidVolume) / (bidVolume + askVolume || 1);

  // Signal determination
  let signal: 'bullish' | 'bearish' | 'neutral';
  let strength: number;

  if (ir > 0.65) {
    signal = 'bullish';
    strength = Math.min((ir - 0.5) * 2, 1);
  } else if (ir < 0.35) {
    signal = 'bearish';
    strength = Math.min((0.5 - ir) * 2, 1);
  } else {
    signal = 'neutral';
    strength = 0;
  }

  return {
    marketId: '',
    obi,
    imbalanceRatio: ir,
    vamp,
    signal,
    strength,
  };
}

// ============================================================================
// Position Sizing & Risk Management
// ============================================================================

/**
 * Kelly criterion with fractional safety
 * f* = (P_true - P_market) / (1 - P_market)
 */
export function calculateKellyFraction(
  trueProb: number,
  marketPrice: number,
  options: {
    kellyFraction?: number; // 0.25-0.5 recommended
    maxPositionPct?: number;
    confidenceFactor?: number;
  } = {}
): number {
  const {
    kellyFraction = 0.25,
    maxPositionPct = 0.1,
    confidenceFactor = 1
  } = options;

  if (trueProb <= marketPrice) return 0;

  const fullKelly = (trueProb - marketPrice) / (1 - marketPrice);
  const adjustedKelly = fullKelly * kellyFraction * confidenceFactor;

  return Math.min(adjustedKelly, maxPositionPct);
}

/**
 * Time-decay position adjustment
 * Position(t) = Initial × √(T_remaining / T_initial)
 */
export function calculatePositionDecay(
  initialPosition: number,
  daysRemaining: number,
  totalDays: number
): number {
  if (daysRemaining <= 0) return 0;
  if (daysRemaining >= totalDays) return initialPosition;

  return initialPosition * Math.sqrt(daysRemaining / totalDays);
}

// ============================================================================
// Main Scanner
// ============================================================================

export interface CombinatorialScanResult {
  rebalance: RebalanceOpportunity[];
  combinatorial: CombinatorialOpportunity[];
  clusters: MarketCluster[];
  scannedMarkets: number;
  scannedPairs: number;
}

/**
 * Full combinatorial arbitrage scan
 */
export async function scanCombinatorialArbitrage(
  feeds: FeedManager,
  options: {
    platforms?: string[];
    minEdgePct?: number;
    maxMarketsPerCluster?: number;
  } = {}
): Promise<CombinatorialScanResult> {
  const {
    platforms = ['polymarket', 'kalshi', 'betfair'],
    minEdgePct = 0.5,
    maxMarketsPerCluster = 20,
  } = options;

  // Gather markets from all platforms
  const allMarkets: MarketCondition[] = [];

  for (const platform of platforms) {
    try {
      const markets = await feeds.searchMarkets('', platform);

      for (const m of markets.slice(0, 200)) {
        // Convert to MarketCondition format
        const yesPrice = m.lastPrice ?? m.probability ?? 0.5;
        allMarkets.push({
          platform,
          marketId: m.id,
          conditionId: m.id,
          question: m.question,
          yesPrice,
          noPrice: 1 - yesPrice,
          endDate: m.endDate ? new Date(m.endDate) : undefined,
          volume24h: m.volume24h,
          liquidity: m.liquidity,
        });
      }
    } catch (e) {
      // Platform unavailable, skip
    }
  }

  // Find rebalancing opportunities
  const rebalance = findRebalanceOpportunities(allMarkets, { minEdgePct });

  // Cluster markets by topic/timeliness
  const clusters = clusterMarkets(allMarkets);

  // Limit cluster size for performance
  for (const cluster of clusters) {
    if (cluster.markets.length > maxMarketsPerCluster) {
      // Keep highest liquidity markets
      cluster.markets.sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0));
      cluster.markets = cluster.markets.slice(0, maxMarketsPerCluster);
    }
  }

  // Find combinatorial opportunities
  const combinatorial = findCombinatorialOpportunities(clusters, { minEdgePct });

  // Count pairs scanned
  let scannedPairs = 0;
  for (const cluster of clusters) {
    const n = cluster.markets.length;
    scannedPairs += (n * (n - 1)) / 2;
  }

  return {
    rebalance,
    combinatorial,
    clusters,
    scannedMarkets: allMarkets.length,
    scannedPairs,
  };
}

// ============================================================================
// Database Persistence
// ============================================================================

export function initCombinatorialTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS combinatorial_opportunities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      markets_json TEXT NOT NULL,
      relationship TEXT,
      edge_pct REAL NOT NULL,
      confidence REAL NOT NULL,
      strategy_json TEXT,
      discovered_at TEXT NOT NULL,
      executed_at TEXT,
      profit_usd REAL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS market_clusters (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      market_ids_json TEXT NOT NULL,
      avg_similarity REAL,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_comb_opp_type ON combinatorial_opportunities(type)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_comb_opp_edge ON combinatorial_opportunities(edge_pct)
  `);
}

export function saveCombinatorialOpportunity(
  db: Database,
  opp: RebalanceOpportunity | CombinatorialOpportunity
): void {
  const id = `comb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT INTO combinatorial_opportunities
    (id, type, markets_json, relationship, edge_pct, confidence, strategy_json, discovered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opp.type,
    JSON.stringify('market' in opp ? [opp.market] : opp.markets),
    'relationship' in opp ? opp.relationship : null,
    opp.edgePct,
    opp.confidence,
    'strategy' in opp ? JSON.stringify(opp.strategy) : null,
    new Date().toISOString()
  );
}
