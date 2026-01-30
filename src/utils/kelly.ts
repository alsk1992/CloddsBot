/**
 * Kelly Criterion Position Sizing
 *
 * Implements Kelly criterion for optimal bet sizing with various adjustments:
 * - Full Kelly, Half Kelly, Quarter Kelly
 * - Multi-outcome Kelly
 * - Fractional Kelly with custom multiplier
 * - Kelly with edge and probability uncertainty
 * - Portfolio-level Kelly allocation
 */

import { logger } from './logger';

// =============================================================================
// TYPES
// =============================================================================

export interface KellyInput {
  /** Probability of winning (0-1) */
  winProb: number;
  /** Payout odds (e.g., 2.0 = 2:1 odds, you win 2x your stake) */
  odds: number;
  /** Current bankroll/balance */
  bankroll: number;
  /** Confidence in probability estimate (0-1, default: 1) */
  confidence?: number;
}

export interface KellyResult {
  /** Full Kelly bet size */
  fullKelly: number;
  /** Half Kelly bet size (recommended for most traders) */
  halfKelly: number;
  /** Quarter Kelly bet size (conservative) */
  quarterKelly: number;
  /** Kelly fraction (0-1) */
  kellyFraction: number;
  /** Expected value of the bet */
  expectedValue: number;
  /** Whether the bet has positive expected value */
  hasPositiveEV: boolean;
  /** Recommended fraction (adjusted for confidence) */
  recommendedFraction: number;
  /** Recommended bet size */
  recommendedSize: number;
}

export interface MultiOutcomeKellyInput {
  /** Array of outcomes with probabilities and payouts */
  outcomes: Array<{
    name: string;
    probability: number;
    payout: number; // Net payout if this outcome wins (e.g., 0.9 = get $0.90 per $1 bet)
  }>;
  /** Current bankroll */
  bankroll: number;
  /** Confidence in probability estimates */
  confidence?: number;
}

export interface MultiOutcomeKellyResult {
  /** Allocation to each outcome (as fraction of bankroll) */
  allocations: Array<{
    name: string;
    fraction: number;
    amount: number;
    expectedValue: number;
  }>;
  /** Total allocation (should be <= 1) */
  totalAllocation: number;
  /** Expected portfolio return */
  expectedReturn: number;
  /** Whether any bets are recommended */
  hasRecommendedBets: boolean;
}

export interface PortfolioKellyInput {
  /** Multiple betting opportunities */
  opportunities: Array<{
    id: string;
    winProb: number;
    odds: number;
    /** Correlation with other bets (-1 to 1) */
    correlations?: Record<string, number>;
  }>;
  /** Total bankroll */
  bankroll: number;
  /** Maximum allocation per bet (0-1, default: 0.25) */
  maxPerBet?: number;
  /** Confidence in estimates */
  confidence?: number;
}

export interface PortfolioKellyResult {
  /** Allocation to each opportunity */
  allocations: Record<string, { fraction: number; amount: number }>;
  /** Total allocation */
  totalAllocation: number;
  /** Expected portfolio return */
  expectedPortfolioReturn: number;
}

// =============================================================================
// BASIC KELLY CRITERION
// =============================================================================

/**
 * Calculate Kelly criterion for a single binary bet
 *
 * Kelly fraction = (bp - q) / b
 * Where:
 * - b = odds (net odds, e.g., for +200, b = 2)
 * - p = probability of winning
 * - q = probability of losing (1 - p)
 */
export function calculateKelly(input: KellyInput): KellyResult {
  const { winProb, odds, bankroll, confidence = 1 } = input;

  // Validate inputs
  if (winProb <= 0 || winProb >= 1) {
    return createZeroResult(bankroll);
  }

  if (odds <= 0) {
    return createZeroResult(bankroll);
  }

  const loseProb = 1 - winProb;

  // Kelly formula: f* = (bp - q) / b
  // Where b = odds - 1 (net odds)
  const b = odds - 1; // Net odds (what you win per $1 bet)
  const kellyFraction = (b * winProb - loseProb) / b;

  // Expected value
  const expectedValue = winProb * b - loseProb;
  const hasPositiveEV = expectedValue > 0;

  // If negative EV or negative Kelly, don't bet
  if (kellyFraction <= 0 || !hasPositiveEV) {
    return createZeroResult(bankroll);
  }

  // Adjust for confidence (reduce Kelly when uncertain)
  const adjustedFraction = kellyFraction * confidence;

  // Calculate bet sizes
  const fullKelly = bankroll * Math.min(adjustedFraction, 1);
  const halfKelly = fullKelly * 0.5;
  const quarterKelly = fullKelly * 0.25;

  // Recommended fraction (half Kelly is usually recommended)
  const recommendedFraction = adjustedFraction * 0.5;
  const recommendedSize = bankroll * Math.min(recommendedFraction, 0.25); // Cap at 25%

  return {
    fullKelly,
    halfKelly,
    quarterKelly,
    kellyFraction: adjustedFraction,
    expectedValue,
    hasPositiveEV,
    recommendedFraction,
    recommendedSize,
  };
}

function createZeroResult(bankroll: number): KellyResult {
  return {
    fullKelly: 0,
    halfKelly: 0,
    quarterKelly: 0,
    kellyFraction: 0,
    expectedValue: 0,
    hasPositiveEV: false,
    recommendedFraction: 0,
    recommendedSize: 0,
  };
}

// =============================================================================
// PREDICTION MARKET KELLY
// =============================================================================

/**
 * Calculate Kelly for prediction market trades
 *
 * In prediction markets:
 * - Price represents implied probability
 * - If you estimate true probability > price, buy YES
 * - If you estimate true probability < price, buy NO
 */
export function calculatePredictionMarketKelly(
  marketPrice: number,
  estimatedProbability: number,
  bankroll: number,
  confidence: number = 1
): KellyResult {
  // For buying YES shares at price p:
  // You pay p, you win (1-p) if YES wins
  // Odds = (1-p)/p + 1 = 1/p

  if (estimatedProbability > marketPrice) {
    // Buy YES
    const odds = 1 / marketPrice;
    return calculateKelly({
      winProb: estimatedProbability,
      odds,
      bankroll,
      confidence,
    });
  } else if (estimatedProbability < marketPrice) {
    // Buy NO (equivalent to betting against YES)
    const noPrice = 1 - marketPrice;
    const odds = 1 / noPrice;
    const noWinProb = 1 - estimatedProbability;

    return calculateKelly({
      winProb: noWinProb,
      odds,
      bankroll,
      confidence,
    });
  }

  // No edge
  return createZeroResult(bankroll);
}

// =============================================================================
// MULTI-OUTCOME KELLY
// =============================================================================

/**
 * Calculate Kelly for multiple mutually exclusive outcomes
 * (e.g., a multi-choice prediction market)
 *
 * Uses the generalized Kelly criterion for multiple outcomes
 */
export function calculateMultiOutcomeKelly(input: MultiOutcomeKellyInput): MultiOutcomeKellyResult {
  const { outcomes, bankroll, confidence = 1 } = input;

  // Validate probabilities sum to ~1
  const probSum = outcomes.reduce((sum, o) => sum + o.probability, 0);
  if (Math.abs(probSum - 1) > 0.01) {
    logger.warn({ probSum }, 'Multi-outcome probabilities do not sum to 1');
  }

  const allocations: MultiOutcomeKellyResult['allocations'] = [];

  // For each outcome, calculate if there's value
  for (const outcome of outcomes) {
    // Price implied by payout: if you bet $1 and win, you get $payout
    // So implied price = 1/payout (approximately)
    const impliedPrice = 1 / (1 + outcome.payout);

    // If our probability > implied price, there's value
    const edge = outcome.probability - impliedPrice;

    if (edge > 0) {
      // Calculate Kelly fraction for this outcome
      // f = (p - impliedPrice) / (1 - impliedPrice)
      const fraction = (edge / (1 - impliedPrice)) * confidence;
      const amount = bankroll * Math.min(fraction, 0.25); // Cap at 25%
      const ev = edge * amount;

      allocations.push({
        name: outcome.name,
        fraction: Math.max(0, fraction),
        amount: Math.max(0, amount),
        expectedValue: ev,
      });
    } else {
      allocations.push({
        name: outcome.name,
        fraction: 0,
        amount: 0,
        expectedValue: 0,
      });
    }
  }

  const totalAllocation = allocations.reduce((sum, a) => sum + a.fraction, 0);
  const expectedReturn = allocations.reduce((sum, a) => sum + a.expectedValue, 0);
  const hasRecommendedBets = allocations.some((a) => a.amount > 0);

  return {
    allocations,
    totalAllocation,
    expectedReturn,
    hasRecommendedBets,
  };
}

// =============================================================================
// PORTFOLIO KELLY
// =============================================================================

/**
 * Calculate Kelly allocations for a portfolio of bets
 * Accounts for correlations between bets
 */
export function calculatePortfolioKelly(input: PortfolioKellyInput): PortfolioKellyResult {
  const { opportunities, bankroll, maxPerBet = 0.25, confidence = 1 } = input;

  const allocations: Record<string, { fraction: number; amount: number }> = {};
  let totalAllocation = 0;
  let expectedPortfolioReturn = 0;

  // First pass: calculate individual Kelly fractions
  const individualKellys: Array<{ id: string; kelly: number; ev: number }> = [];

  for (const opp of opportunities) {
    const result = calculateKelly({
      winProb: opp.winProb,
      odds: opp.odds,
      bankroll,
      confidence,
    });

    if (result.hasPositiveEV) {
      individualKellys.push({
        id: opp.id,
        kelly: result.kellyFraction,
        ev: result.expectedValue,
      });
    }
  }

  if (individualKellys.length === 0) {
    return { allocations: {}, totalAllocation: 0, expectedPortfolioReturn: 0 };
  }

  // Normalize if total exceeds 100%
  const totalKelly = individualKellys.reduce((sum, k) => sum + k.kelly, 0);
  const scaleFactor = totalKelly > 1 ? 1 / totalKelly : 1;

  // Apply correlations adjustment (simplified)
  // Higher correlation = reduce allocation to avoid concentration
  for (const kelly of individualKellys) {
    const opp = opportunities.find((o) => o.id === kelly.id)!;
    let adjustedFraction = kelly.kelly * scaleFactor;

    // Reduce for correlated bets
    if (opp.correlations) {
      const avgCorrelation = Object.values(opp.correlations).reduce((a, b) => a + Math.abs(b), 0) /
        Object.values(opp.correlations).length;
      adjustedFraction *= 1 - avgCorrelation * 0.3; // Reduce by up to 30% for high correlation
    }

    // Apply max per bet limit
    adjustedFraction = Math.min(adjustedFraction, maxPerBet);

    // Apply half Kelly as default
    adjustedFraction *= 0.5;

    allocations[kelly.id] = {
      fraction: adjustedFraction,
      amount: bankroll * adjustedFraction,
    };

    totalAllocation += adjustedFraction;
    expectedPortfolioReturn += kelly.ev * adjustedFraction;
  }

  return {
    allocations,
    totalAllocation,
    expectedPortfolioReturn,
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert American odds to decimal odds
 */
export function americanToDecimal(american: number): number {
  if (american > 0) {
    return american / 100 + 1;
  } else {
    return 100 / Math.abs(american) + 1;
  }
}

/**
 * Convert decimal odds to probability
 */
export function oddsToProb(odds: number): number {
  return 1 / odds;
}

/**
 * Convert probability to decimal odds
 */
export function probToOdds(prob: number): number {
  return 1 / prob;
}

/**
 * Calculate edge from market price and estimated probability
 */
export function calculateEdge(marketPrice: number, estimatedProbability: number): number {
  return estimatedProbability - marketPrice;
}

/**
 * Calculate optimal fraction for a given edge and variance
 */
export function edgeToKelly(edge: number, odds: number): number {
  if (edge <= 0) return 0;
  // Simplified: edge / (odds - 1)
  const b = odds - 1;
  return edge / b;
}

/**
 * Suggest Kelly fraction based on confidence level
 */
export function suggestKellyFraction(
  confidenceLevel: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
): number {
  const fractions: Record<typeof confidenceLevel, number> = {
    very_high: 0.5,   // Half Kelly
    high: 0.35,       // Third Kelly
    medium: 0.25,     // Quarter Kelly
    low: 0.15,        // Sixth Kelly
    very_low: 0.1,    // Tenth Kelly
  };

  return fractions[confidenceLevel];
}

/**
 * Calculate position size with all safety limits applied
 */
export function calculateSafePositionSize(
  kellyResult: KellyResult,
  maxPositionPct: number = 0.1, // Max 10% of bankroll
  minPositionSize: number = 1,  // Min $1
  maxPositionSize: number = 10000 // Max $10k
): number {
  // Use recommended (half Kelly) as base
  let size = kellyResult.recommendedSize;

  // Apply max % of bankroll
  const bankroll = kellyResult.fullKelly / kellyResult.kellyFraction;
  size = Math.min(size, bankroll * maxPositionPct);

  // Apply absolute limits
  size = Math.max(size, minPositionSize);
  size = Math.min(size, maxPositionSize);

  // Round to 2 decimal places
  return Math.round(size * 100) / 100;
}
