/**
 * Dynamic Kelly Criterion Position Sizing
 *
 * Features:
 * - Adaptive Kelly based on recent performance
 * - Drawdown-adjusted sizing
 * - Volatility-based Kelly scaling
 * - Category-specific Kelly multipliers
 * - Anti-martingale scaling (reduce after losses, increase after wins)
 */

import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface KellyConfig {
  /** Base Kelly multiplier (default: 0.25 = quarter Kelly) */
  baseMultiplier?: number;
  /** Maximum Kelly fraction allowed (default: 0.25) */
  maxKelly?: number;
  /** Minimum Kelly fraction (default: 0.01) */
  minKelly?: number;
  /** Number of trades to consider for recent performance (default: 20) */
  lookbackTrades?: number;
  /** Maximum drawdown before reducing size (default: 0.15 = 15%) */
  maxDrawdown?: number;
  /** Reduce Kelly by this factor when in drawdown (default: 0.5) */
  drawdownReduction?: number;
  /** Increase Kelly by this factor when on winning streak (default: 1.25) */
  winStreakBoost?: number;
  /** Number of consecutive wins to trigger boost (default: 3) */
  winStreakThreshold?: number;
  /** Enable volatility-based scaling (default: true) */
  volatilityScaling?: boolean;
  /** Target volatility for returns (default: 0.10 = 10%) */
  targetVolatility?: number;
}

export interface TradeRecord {
  /** Trade ID */
  id: string;
  /** Profit/loss as decimal (e.g., 0.05 = 5% profit) */
  pnlPct: number;
  /** Whether trade was a win */
  won: boolean;
  /** Category (optional, for category-specific Kelly) */
  category?: string;
  /** Timestamp */
  timestamp: Date;
  /** Edge estimate at entry */
  estimatedEdge?: number;
  /** Actual realized edge */
  realizedEdge?: number;
}

export interface KellyState {
  /** Current bankroll */
  bankroll: number;
  /** Peak bankroll (for drawdown calculation) */
  peakBankroll: number;
  /** Current drawdown as decimal */
  currentDrawdown: number;
  /** Recent trades for lookback */
  recentTrades: TradeRecord[];
  /** Win rate over lookback period */
  recentWinRate: number;
  /** Average return over lookback period */
  recentAvgReturn: number;
  /** Volatility of recent returns */
  recentVolatility: number;
  /** Current win streak */
  winStreak: number;
  /** Current loss streak */
  lossStreak: number;
  /** Category-specific win rates */
  categoryWinRates: Map<string, { wins: number; total: number; winRate: number }>;
}

export interface DynamicKellyResult {
  /** Final recommended Kelly fraction */
  kelly: number;
  /** Base Kelly before adjustments */
  baseKelly: number;
  /** Recommended position size in currency */
  positionSize: number;
  /** Adjustments applied */
  adjustments: KellyAdjustment[];
  /** Risk metrics */
  risk: {
    /** Current drawdown */
    drawdown: number;
    /** Recent win rate */
    recentWinRate: number;
    /** Volatility */
    volatility: number;
    /** Win streak */
    winStreak: number;
  };
  /** Confidence in sizing */
  confidence: number;
  /** Warning messages */
  warnings: string[];
}

export interface KellyAdjustment {
  /** Adjustment type */
  type: 'confidence' | 'drawdown' | 'win_streak' | 'volatility' | 'category' | 'sample_size';
  /** Multiplier applied */
  multiplier: number;
  /** Reason for adjustment */
  reason: string;
}

export interface DynamicKellyCalculator {
  /** Calculate Kelly for an opportunity */
  calculate(
    edge: number,
    confidence: number,
    options?: {
      category?: string;
      odds?: number;  // For non-binary bets
      winRate?: number;  // If known from similar trades
    }
  ): DynamicKellyResult;

  /** Record a trade outcome */
  recordTrade(trade: TradeRecord): void;

  /** Update bankroll */
  updateBankroll(newBankroll: number): void;

  /** Get current state */
  getState(): KellyState;

  /** Reset state */
  reset(): void;

  /** Get category-specific Kelly recommendation */
  getCategoryKelly(category: string, baseEdge: number): number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<KellyConfig> = {
  baseMultiplier: 0.25,
  maxKelly: 0.25,
  minKelly: 0.01,
  lookbackTrades: 20,
  maxDrawdown: 0.15,
  drawdownReduction: 0.5,
  winStreakBoost: 1.25,
  winStreakThreshold: 3,
  volatilityScaling: true,
  targetVolatility: 0.10,
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createDynamicKellyCalculator(
  initialBankroll: number,
  config: KellyConfig = {}
): DynamicKellyCalculator {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // State
  let bankroll = initialBankroll;
  let peakBankroll = initialBankroll;
  const recentTrades: TradeRecord[] = [];
  let winStreak = 0;
  let lossStreak = 0;
  const categoryStats = new Map<string, { wins: number; total: number; winRate: number }>();

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  function getCurrentDrawdown(): number {
    if (peakBankroll <= 0) return 0;
    return Math.max(0, (peakBankroll - bankroll) / peakBankroll);
  }

  function getRecentWinRate(): number {
    if (recentTrades.length === 0) return 0.5;
    const wins = recentTrades.filter(t => t.won).length;
    return wins / recentTrades.length;
  }

  function getRecentAvgReturn(): number {
    if (recentTrades.length === 0) return 0;
    const sum = recentTrades.reduce((acc, t) => acc + t.pnlPct, 0);
    return sum / recentTrades.length;
  }

  function getRecentVolatility(): number {
    if (recentTrades.length < 2) return cfg.targetVolatility;

    const returns = recentTrades.map(t => t.pnlPct);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  function getBaseKelly(edge: number, odds: number, winRate?: number): number {
    // Full Kelly formula: f = (bp - q) / b
    // where b = odds, p = win probability, q = 1 - p

    // If win rate provided, use it directly
    // Otherwise, estimate from edge
    const p = winRate || Math.min(0.95, Math.max(0.05, 0.5 + edge / 2));
    const q = 1 - p;

    // For binary markets, odds are typically 1:1 (b = 1)
    // For other odds, calculate accordingly
    const fullKelly = (odds * p - q) / odds;

    return Math.max(0, fullKelly);
  }

  // ==========================================================================
  // MAIN CALCULATION
  // ==========================================================================

  function calculate(
    edge: number,
    confidence: number,
    options: {
      category?: string;
      odds?: number;
      winRate?: number;
    } = {}
  ): DynamicKellyResult {
    const { category, odds = 1, winRate } = options;
    const adjustments: KellyAdjustment[] = [];
    const warnings: string[] = [];

    // 1. Calculate base Kelly
    const fullKelly = getBaseKelly(edge, odds, winRate);
    let kelly = fullKelly * cfg.baseMultiplier;

    adjustments.push({
      type: 'confidence',
      multiplier: cfg.baseMultiplier,
      reason: `Base ${(cfg.baseMultiplier * 100).toFixed(0)}% Kelly`,
    });

    // 2. Apply confidence adjustment
    if (confidence < 1) {
      kelly *= confidence;
      adjustments.push({
        type: 'confidence',
        multiplier: confidence,
        reason: `Confidence adjustment: ${(confidence * 100).toFixed(0)}%`,
      });
    }

    // 3. Apply drawdown adjustment
    const drawdown = getCurrentDrawdown();
    if (drawdown > 0.05) {  // Start reducing at 5% drawdown
      const drawdownFactor = drawdown >= cfg.maxDrawdown
        ? cfg.drawdownReduction
        : 1 - (drawdown / cfg.maxDrawdown) * (1 - cfg.drawdownReduction);

      kelly *= drawdownFactor;
      adjustments.push({
        type: 'drawdown',
        multiplier: drawdownFactor,
        reason: `Drawdown ${(drawdown * 100).toFixed(1)}%: reducing size`,
      });

      if (drawdown >= cfg.maxDrawdown) {
        warnings.push(`At max drawdown (${(cfg.maxDrawdown * 100).toFixed(0)}%) - size significantly reduced`);
      }
    }

    // 4. Apply win streak boost
    if (winStreak >= cfg.winStreakThreshold) {
      const boostFactor = Math.min(cfg.winStreakBoost, 1 + (winStreak - cfg.winStreakThreshold + 1) * 0.05);
      kelly *= boostFactor;
      adjustments.push({
        type: 'win_streak',
        multiplier: boostFactor,
        reason: `Win streak (${winStreak}): boosting size`,
      });
    }

    // 5. Apply loss streak reduction
    if (lossStreak >= 2) {
      const reductionFactor = Math.max(0.5, 1 - lossStreak * 0.1);
      kelly *= reductionFactor;
      adjustments.push({
        type: 'win_streak',
        multiplier: reductionFactor,
        reason: `Loss streak (${lossStreak}): reducing size`,
      });
      warnings.push(`On losing streak - size reduced for risk management`);
    }

    // 6. Apply volatility scaling
    if (cfg.volatilityScaling) {
      const recentVol = getRecentVolatility();
      if (recentVol > 0) {
        const volRatio = cfg.targetVolatility / recentVol;
        const volFactor = Math.max(0.5, Math.min(1.5, volRatio));
        kelly *= volFactor;
        adjustments.push({
          type: 'volatility',
          multiplier: volFactor,
          reason: `Volatility adjustment: ${(recentVol * 100).toFixed(1)}% vs target ${(cfg.targetVolatility * 100).toFixed(0)}%`,
        });
      }
    }

    // 7. Apply category-specific adjustment
    if (category) {
      const catStats = categoryStats.get(category);
      if (catStats && catStats.total >= 5) {
        // Adjust based on category performance
        const catWinRate = catStats.winRate;
        const overallWinRate = getRecentWinRate();

        if (catWinRate > overallWinRate + 0.1) {
          // Category performing well - slight boost
          const catBoost = Math.min(1.2, 1 + (catWinRate - overallWinRate));
          kelly *= catBoost;
          adjustments.push({
            type: 'category',
            multiplier: catBoost,
            reason: `Category "${category}" outperforming: ${(catWinRate * 100).toFixed(0)}% win rate`,
          });
        } else if (catWinRate < overallWinRate - 0.1) {
          // Category underperforming - reduce
          const catReduction = Math.max(0.7, 1 - (overallWinRate - catWinRate));
          kelly *= catReduction;
          adjustments.push({
            type: 'category',
            multiplier: catReduction,
            reason: `Category "${category}" underperforming: ${(catWinRate * 100).toFixed(0)}% win rate`,
          });
        }
      }
    }

    // 8. Apply sample size adjustment (less confident with few trades)
    if (recentTrades.length < 10) {
      const sampleFactor = 0.5 + (recentTrades.length / 10) * 0.5;
      kelly *= sampleFactor;
      adjustments.push({
        type: 'sample_size',
        multiplier: sampleFactor,
        reason: `Small sample (${recentTrades.length} trades): conservative sizing`,
      });
    }

    // 9. Apply bounds
    kelly = Math.max(cfg.minKelly, Math.min(cfg.maxKelly, kelly));

    // Calculate position size
    const positionSize = Math.round(bankroll * kelly * 100) / 100;

    // Calculate confidence in sizing
    const recentWinRate = getRecentWinRate();
    const vol = getRecentVolatility();
    const sizeConfidence =
      0.4 * Math.min(1, recentTrades.length / cfg.lookbackTrades) +  // Sample size
      0.3 * (recentWinRate >= 0.5 ? 1 : recentWinRate * 2) +          // Performance
      0.3 * (1 - Math.min(1, drawdown / cfg.maxDrawdown));            // Drawdown

    return {
      kelly: Math.round(kelly * 10000) / 10000,
      baseKelly: Math.round(fullKelly * cfg.baseMultiplier * 10000) / 10000,
      positionSize,
      adjustments,
      risk: {
        drawdown,
        recentWinRate,
        volatility: vol,
        winStreak,
      },
      confidence: Math.round(sizeConfidence * 100) / 100,
      warnings,
    };
  }

  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================

  function recordTrade(trade: TradeRecord): void {
    // Add to recent trades
    recentTrades.push(trade);

    // Trim to lookback window
    while (recentTrades.length > cfg.lookbackTrades) {
      recentTrades.shift();
    }

    // Update win/loss streak
    if (trade.won) {
      winStreak++;
      lossStreak = 0;
    } else {
      lossStreak++;
      winStreak = 0;
    }

    // Update category stats
    if (trade.category) {
      const existing = categoryStats.get(trade.category) || { wins: 0, total: 0, winRate: 0 };
      existing.total++;
      if (trade.won) existing.wins++;
      existing.winRate = existing.wins / existing.total;
      categoryStats.set(trade.category, existing);
    }

    logger.debug({ trade: trade.id, won: trade.won, winStreak, lossStreak }, 'Kelly: trade recorded');
  }

  function updateBankroll(newBankroll: number): void {
    bankroll = newBankroll;
    if (newBankroll > peakBankroll) {
      peakBankroll = newBankroll;
    }
    logger.debug({ bankroll, peakBankroll, drawdown: getCurrentDrawdown() }, 'Kelly: bankroll updated');
  }

  function getState(): KellyState {
    return {
      bankroll,
      peakBankroll,
      currentDrawdown: getCurrentDrawdown(),
      recentTrades: [...recentTrades],
      recentWinRate: getRecentWinRate(),
      recentAvgReturn: getRecentAvgReturn(),
      recentVolatility: getRecentVolatility(),
      winStreak,
      lossStreak,
      categoryWinRates: new Map(categoryStats),
    };
  }

  function reset(): void {
    bankroll = initialBankroll;
    peakBankroll = initialBankroll;
    recentTrades.length = 0;
    winStreak = 0;
    lossStreak = 0;
    categoryStats.clear();
    logger.info('Kelly: state reset');
  }

  function getCategoryKelly(category: string, baseEdge: number): number {
    const catStats = categoryStats.get(category);
    if (!catStats || catStats.total < 3) {
      // Not enough data - use conservative estimate
      return calculate(baseEdge, 0.6, { category }).kelly;
    }

    // Use category-specific win rate
    return calculate(baseEdge, 1, { category, winRate: catStats.winRate }).kelly;
  }

  return {
    calculate,
    recordTrade,
    updateBankroll,
    getState,
    reset,
    getCategoryKelly,
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Simple Kelly calculation for quick estimates
 */
export function simpleKelly(edge: number, confidence: number = 1, multiplier: number = 0.25): number {
  // f = edge * confidence * multiplier
  const kelly = edge * confidence * multiplier;
  return Math.max(0, Math.min(0.25, kelly));
}

/**
 * Calculate optimal bet size for a series of bets
 */
export function optimalBetSize(
  bankroll: number,
  opportunities: Array<{ edge: number; confidence: number }>,
  correlationFactor: number = 1  // 1 = uncorrelated, <1 = correlated
): number {
  if (opportunities.length === 0) return 0;

  // For correlated bets, we need to reduce size
  // Use the geometric mean of edges for uncorrelated, arithmetic for correlated
  const totalEdge = opportunities.reduce((sum, o) => sum + o.edge * o.confidence, 0);
  const avgEdge = totalEdge / opportunities.length;

  // Adjusted Kelly for multiple bets
  const adjustedKelly = simpleKelly(avgEdge, 1, 0.25 * correlationFactor);

  // Total across all bets
  return Math.round(bankroll * adjustedKelly * 100) / 100;
}
