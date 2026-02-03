/**
 * Multi-Leg Risk Modeling for Arbitrage
 *
 * Models the risks associated with multi-leg arbitrage strategies:
 * - Execution risk (legs not filling)
 * - Partial fill risk (only some legs execute)
 * - Timing risk (prices move between executions)
 * - Platform risk (withdrawal limits, delays)
 * - Correlation risk (outcomes not independent)
 */

import type { Platform, Orderbook } from '../types';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface ArbitrageLeg {
  /** Platform for this leg */
  platform: Platform;
  /** Market ID */
  marketId: string;
  /** Outcome ID (token ID) */
  outcomeId: string;
  /** Side: buy or sell */
  side: 'buy' | 'sell';
  /** Target price */
  price: number;
  /** Target size in shares */
  size: number;
  /** Available liquidity at target price */
  liquidityAtPrice: number;
  /** Order book if available */
  orderbook?: Orderbook;
  /** Estimated execution time (ms) */
  estimatedExecTimeMs?: number;
}

export interface RiskModelInput {
  /** All legs of the arbitrage */
  legs: ArbitrageLeg[];
  /** Total position size in USD */
  positionSize: number;
  /** Expected edge % */
  expectedEdge: number;
  /** Time horizon until market close (ms) */
  timeHorizonMs?: number;
  /** Are outcomes on the same underlying event? */
  sameEvent: boolean;
}

export interface RiskModelOutput {
  /** Overall risk score (0-100, higher = more risk) */
  riskScore: number;
  /** Risk category */
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  /** Probability of full execution (0-1) */
  fullExecutionProb: number;
  /** Expected P&L if fully executed */
  expectedPnL: number;
  /** Worst-case P&L (95th percentile) */
  worstCasePnL: number;
  /** Value at Risk (95%) */
  var95: number;
  /** Maximum drawdown exposure */
  maxDrawdown: number;
  /** Risk-adjusted return (Sharpe-like) */
  riskAdjustedReturn: number;
  /** Breakdown by risk type */
  riskBreakdown: RiskBreakdown;
  /** Recommendations */
  recommendations: string[];
  /** Adjusted position sizing */
  adjustedPositionSize: number;
  /** Execution sequence recommendation */
  executionSequence: number[];
}

export interface RiskBreakdown {
  /** Execution risk - probability of legs not filling */
  executionRisk: {
    score: number;
    legFillProbs: number[];
    partialFillRisk: number;
  };
  /** Timing risk - prices moving between executions */
  timingRisk: {
    score: number;
    expectedSlippage: number;
    maxSlippage: number;
    priceVolatility: number;
  };
  /** Platform risk - platform-specific issues */
  platformRisk: {
    score: number;
    withdrawalRisk: number;
    counterpartyRisk: number;
    platformScores: Record<Platform, number>;
  };
  /** Liquidity risk - insufficient depth */
  liquidityRisk: {
    score: number;
    liquidityDepth: number;
    impactCost: number;
    fillProbability: number;
  };
  /** Correlation risk - outcomes not independent */
  correlationRisk: {
    score: number;
    correlation: number;
    diversificationBenefit: number;
  };
}

export interface RiskModeler {
  /** Model risk for an arbitrage opportunity */
  modelRisk(input: RiskModelInput): RiskModelOutput;

  /** Calculate optimal execution sequence */
  optimizeSequence(legs: ArbitrageLeg[]): number[];

  /** Calculate position size limits based on risk */
  calculatePositionLimit(
    legs: ArbitrageLeg[],
    maxRiskScore: number,
    accountBalance: number
  ): number;

  /** Estimate slippage for a given size */
  estimateSlippage(leg: ArbitrageLeg, size: number): number;

  /** Calculate probability of full fill */
  calculateFillProbability(legs: ArbitrageLeg[]): number;
}

// =============================================================================
// PLATFORM RISK SCORES (0-100, lower = safer)
// =============================================================================

const PLATFORM_RISK_SCORES: Record<Platform, number> = {
  polymarket: 20,   // Established, on-chain settlement
  kalshi: 15,       // CFTC regulated
  manifold: 35,     // Play money / smaller
  metaculus: 40,    // Forecasting focus, less liquid
  predictit: 30,    // CFTC regulated but older
  predictfun: 35,   // Solana-based prediction market
  drift: 45,        // Solana-based, newer
  betfair: 10,      // Highly established
  smarkets: 15,     // Established, lower fees
  opinion: 40,      // BNB Chain, newer platform
  virtuals: 50,     // Base chain AI agents, high volatility
  hedgehog: 40,     // Solana-based prediction market, newer
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createRiskModeler(): RiskModeler {
  /**
   * Calculate fill probability for a single leg
   */
  function calculateLegFillProb(leg: ArbitrageLeg): number {
    // Base probability from liquidity ratio
    const liquidityRatio = leg.liquidityAtPrice / leg.size;
    let fillProb = Math.min(1, liquidityRatio);

    // Adjust for side (sells are typically harder)
    if (leg.side === 'sell') {
      fillProb *= 0.95;
    }

    // Adjust for platform
    const platformRisk = PLATFORM_RISK_SCORES[leg.platform] || 50;
    fillProb *= 1 - platformRisk / 200;

    // Adjust for price proximity to extremes
    if (leg.price < 0.05 || leg.price > 0.95) {
      fillProb *= 0.85; // Extreme prices are harder to fill
    }

    return Math.max(0.1, Math.min(0.99, fillProb));
  }

  /**
   * Estimate slippage for a given size
   */
  function estimateSlippage(leg: ArbitrageLeg, size: number): number {
    if (leg.orderbook) {
      // Calculate slippage from orderbook
      const book = leg.side === 'buy' ? leg.orderbook.asks : leg.orderbook.bids;
      let remainingSize = size;
      let totalCost = 0;
      let bestPrice = book[0]?.[0] || leg.price;

      for (const [price, levelSize] of book) {
        const fillSize = Math.min(remainingSize, levelSize);
        totalCost += fillSize * price;
        remainingSize -= fillSize;
        if (remainingSize <= 0) break;
      }

      if (remainingSize > 0) {
        // Not enough liquidity - estimate with high slippage
        totalCost += remainingSize * (bestPrice * 1.1);
      }

      const avgPrice = totalCost / size;
      return Math.abs(avgPrice - leg.price) / leg.price;
    }

    // Estimate from liquidity ratio
    const liquidityRatio = leg.liquidityAtPrice / size;
    if (liquidityRatio >= 2) return 0.001; // Very low slippage
    if (liquidityRatio >= 1) return 0.005;
    if (liquidityRatio >= 0.5) return 0.02;
    if (liquidityRatio >= 0.25) return 0.05;
    return 0.1; // High slippage
  }

  /**
   * Calculate correlation between legs
   */
  function calculateCorrelation(legs: ArbitrageLeg[], sameEvent: boolean): number {
    if (sameEvent) {
      // Same event = high negative correlation for YES/NO
      // Check if we're buying opposite outcomes
      const hasBuyYes = legs.some(l => l.side === 'buy' && !l.outcomeId.includes('no'));
      const hasBuyNo = legs.some(l => l.side === 'buy' && l.outcomeId.includes('no'));

      if (hasBuyYes && hasBuyNo) {
        return -0.95; // Perfect hedge
      }
      return 0.8; // Same direction = high positive correlation
    }

    // Cross-platform same question
    const uniquePlatforms = new Set(legs.map(l => l.platform));
    if (uniquePlatforms.size > 1) {
      return 0.7; // Correlated but not perfectly
    }

    return 0.3; // Different events, some correlation from market conditions
  }

  /**
   * Calculate optimal execution sequence
   * Priority: lowest slippage + highest liquidity first
   */
  function optimizeSequence(legs: ArbitrageLeg[]): number[] {
    return legs
      .map((leg, index) => ({
        index,
        priority:
          leg.liquidityAtPrice / leg.size +
          (1 / (estimateSlippage(leg, leg.size) + 0.001)) +
          (leg.side === 'sell' ? -0.5 : 0), // Prioritize buys
      }))
      .sort((a, b) => b.priority - a.priority)
      .map(item => item.index);
  }

  /**
   * Model risk for an arbitrage opportunity
   */
  function modelRisk(input: RiskModelInput): RiskModelOutput {
    const { legs, positionSize, expectedEdge, timeHorizonMs = 86400000, sameEvent } = input;

    // ==========================================================================
    // EXECUTION RISK
    // ==========================================================================

    const legFillProbs = legs.map(calculateLegFillProb);
    const fullExecutionProb = legFillProbs.reduce((acc, p) => acc * p, 1);

    // Partial fill risk - what if only some legs execute?
    // This is the probability of N-1 legs filling but last one failing
    const partialFillRisk = legs.reduce((acc, _, i) => {
      const othersProb = legFillProbs.filter((_, j) => j !== i).reduce((a, p) => a * p, 1);
      const thisFails = 1 - legFillProbs[i];
      return acc + othersProb * thisFails;
    }, 0);

    const executionRiskScore = (1 - fullExecutionProb) * 50 + partialFillRisk * 30;

    // ==========================================================================
    // TIMING RISK
    // ==========================================================================

    const slippages = legs.map(leg => estimateSlippage(leg, leg.size));
    const expectedSlippage = slippages.reduce((a, b) => a + b, 0) / slippages.length;
    const maxSlippage = Math.max(...slippages);

    // Estimate price volatility from execution times
    const avgExecTime = legs.reduce((acc, leg) => acc + (leg.estimatedExecTimeMs || 1000), 0) / legs.length;
    const priceVolatility = Math.sqrt(avgExecTime / 1000) * 0.005; // 0.5% per sqrt(second)

    const timingRiskScore = expectedSlippage * 200 + priceVolatility * 100;

    // ==========================================================================
    // PLATFORM RISK
    // ==========================================================================

    const platformScores: Record<Platform, number> = {} as Record<Platform, number>;
    let totalPlatformRisk = 0;

    for (const leg of legs) {
      const score = PLATFORM_RISK_SCORES[leg.platform] || 50;
      platformScores[leg.platform] = score;
      totalPlatformRisk += score;
    }

    const avgPlatformRisk = totalPlatformRisk / legs.length;
    const withdrawalRisk = legs.some(l => l.platform === 'drift') ? 30 : 10; // Solana = higher
    const counterpartyRisk = avgPlatformRisk * 0.3;

    const platformRiskScore = avgPlatformRisk * 0.5 + withdrawalRisk * 0.3 + counterpartyRisk * 0.2;

    // ==========================================================================
    // LIQUIDITY RISK
    // ==========================================================================

    const minLiquidityRatio = Math.min(...legs.map(l => l.liquidityAtPrice / l.size));
    const liquidityDepth = legs.reduce((acc, l) => acc + l.liquidityAtPrice, 0);
    const impactCost = expectedSlippage * positionSize;
    const fillProbability = fullExecutionProb;

    const liquidityRiskScore =
      minLiquidityRatio < 0.5 ? 60 :
      minLiquidityRatio < 1 ? 40 :
      minLiquidityRatio < 2 ? 20 : 10;

    // ==========================================================================
    // CORRELATION RISK
    // ==========================================================================

    const correlation = calculateCorrelation(legs, sameEvent);
    const diversificationBenefit = correlation < 0 ? Math.abs(correlation) * 0.5 : 0;

    const correlationRiskScore =
      correlation > 0.8 ? 30 :
      correlation > 0.5 ? 20 :
      correlation > 0 ? 10 :
      0; // Negative correlation is good

    // ==========================================================================
    // AGGREGATE RISK
    // ==========================================================================

    const weights = {
      execution: 0.3,
      timing: 0.2,
      platform: 0.15,
      liquidity: 0.25,
      correlation: 0.1,
    };

    const riskScore =
      executionRiskScore * weights.execution +
      timingRiskScore * weights.timing +
      platformRiskScore * weights.platform +
      liquidityRiskScore * weights.liquidity +
      correlationRiskScore * weights.correlation;

    const riskLevel: 'low' | 'medium' | 'high' | 'extreme' =
      riskScore < 20 ? 'low' :
      riskScore < 40 ? 'medium' :
      riskScore < 60 ? 'high' : 'extreme';

    // ==========================================================================
    // P&L CALCULATIONS
    // ==========================================================================

    const expectedPnL = positionSize * (expectedEdge / 100) * fullExecutionProb;
    const worstCasePnL = -positionSize * partialFillRisk * 0.5; // Lose half on partial fill
    const var95 = -positionSize * (1 - fullExecutionProb) * 0.3; // 30% loss on failure
    const maxDrawdown = positionSize; // Could lose entire position in worst case

    const riskAdjustedReturn = expectedPnL > 0 && Math.abs(worstCasePnL) > 0
      ? expectedPnL / Math.abs(worstCasePnL)
      : 0;

    // ==========================================================================
    // RECOMMENDATIONS
    // ==========================================================================

    const recommendations: string[] = [];

    if (executionRiskScore > 40) {
      recommendations.push('High execution risk - reduce position size or use limit orders');
    }
    if (liquidityRiskScore > 40) {
      recommendations.push('Low liquidity - consider splitting order across multiple fills');
    }
    if (timingRiskScore > 30) {
      recommendations.push('Timing risk elevated - execute legs quickly or atomically');
    }
    if (platformRiskScore > 30) {
      recommendations.push('Platform risk present - monitor for withdrawal/settlement issues');
    }
    if (partialFillRisk > 0.3) {
      recommendations.push('High partial fill risk - consider reducing size or hedging');
    }
    if (correlation > 0.7) {
      recommendations.push('High correlation - consider diversifying across events');
    }

    // Adjust position size based on risk
    const riskMultiplier = Math.max(0.1, 1 - riskScore / 100);
    const adjustedPositionSize = positionSize * riskMultiplier;

    if (adjustedPositionSize < positionSize * 0.5) {
      recommendations.push(`Reduce position to $${adjustedPositionSize.toFixed(2)} based on risk`);
    }

    return {
      riskScore,
      riskLevel,
      fullExecutionProb,
      expectedPnL,
      worstCasePnL,
      var95,
      maxDrawdown,
      riskAdjustedReturn,
      riskBreakdown: {
        executionRisk: {
          score: executionRiskScore,
          legFillProbs,
          partialFillRisk,
        },
        timingRisk: {
          score: timingRiskScore,
          expectedSlippage,
          maxSlippage,
          priceVolatility,
        },
        platformRisk: {
          score: platformRiskScore,
          withdrawalRisk,
          counterpartyRisk,
          platformScores,
        },
        liquidityRisk: {
          score: liquidityRiskScore,
          liquidityDepth,
          impactCost,
          fillProbability,
        },
        correlationRisk: {
          score: correlationRiskScore,
          correlation,
          diversificationBenefit,
        },
      },
      recommendations,
      adjustedPositionSize,
      executionSequence: optimizeSequence(legs),
    };
  }

  /**
   * Calculate position size limit based on risk tolerance
   */
  function calculatePositionLimit(
    legs: ArbitrageLeg[],
    maxRiskScore: number,
    accountBalance: number
  ): number {
    // Start with maximum and reduce based on risk
    let testSize = accountBalance;

    // Binary search for optimal size
    let low = 0;
    let high = accountBalance;

    for (let i = 0; i < 10; i++) {
      const mid = (low + high) / 2;
      const scaledLegs = legs.map(leg => ({
        ...leg,
        size: leg.size * (mid / accountBalance),
      }));

      const riskOutput = modelRisk({
        legs: scaledLegs,
        positionSize: mid,
        expectedEdge: 1, // Placeholder
        sameEvent: false,
      });

      if (riskOutput.riskScore <= maxRiskScore) {
        low = mid;
        testSize = mid;
      } else {
        high = mid;
      }
    }

    return testSize;
  }

  /**
   * Calculate probability of full fill for all legs
   */
  function calculateFillProbability(legs: ArbitrageLeg[]): number {
    return legs.map(calculateLegFillProb).reduce((acc, p) => acc * p, 1);
  }

  return {
    modelRisk,
    optimizeSequence,
    calculatePositionLimit,
    estimateSlippage,
    calculateFillProbability,
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Quick risk check for an opportunity
 */
export function quickRiskCheck(
  edgePct: number,
  totalLiquidity: number,
  positionSize: number,
  numLegs: number
): { safe: boolean; reason?: string } {
  // Must have positive edge
  if (edgePct <= 0) {
    return { safe: false, reason: 'No positive edge' };
  }

  // Liquidity must be at least 2x position
  if (totalLiquidity < positionSize * 2) {
    return { safe: false, reason: 'Insufficient liquidity' };
  }

  // Edge should be enough to cover potential slippage
  const estimatedSlippage = numLegs * 0.5; // 0.5% per leg rough estimate
  if (edgePct < estimatedSlippage * 2) {
    return { safe: false, reason: 'Edge too small vs expected slippage' };
  }

  // Multi-leg requires higher edge
  if (numLegs > 2 && edgePct < 2) {
    return { safe: false, reason: 'Multi-leg requires higher edge' };
  }

  return { safe: true };
}

/**
 * Calculate max position size for given risk tolerance
 */
export function calculateMaxPosition(
  accountBalance: number,
  edgePct: number,
  numLegs: number,
  riskTolerance: 'conservative' | 'moderate' | 'aggressive' = 'moderate'
): number {
  const baseMax = accountBalance * 0.1; // Never more than 10% of account

  const riskMultiplier = {
    conservative: 0.25,
    moderate: 0.5,
    aggressive: 1.0,
  }[riskTolerance];

  const edgeMultiplier = Math.min(1, edgePct / 5); // Scale with edge

  const legPenalty = Math.max(0.5, 1 - (numLegs - 2) * 0.1); // Penalty for more legs

  return baseMax * riskMultiplier * edgeMultiplier * legPenalty;
}
