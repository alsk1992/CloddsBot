/**
 * Feature Engineering Thresholds
 *
 * Helper functions for signal-based trading decisions.
 * All functions return boolean to indicate pass/fail for trading filters.
 */

import type { CombinedFeatures } from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface FeatureThresholds {
  /** Minimum liquidity score [0, 1] to proceed (default: 0.3) */
  minLiquidityScore: number;
  /** Maximum volatility % to allow trading (default: 5.0) */
  maxVolatilityPct: number;
  /** Minimum volatility % for meaningful price action (default: 0.1) */
  minVolatilityPct: number;
  /** Maximum spread % to allow trading (default: 2.0) */
  maxSpreadPct: number;
  /** Minimum trend strength [-1, 1] for trend trades (default: 0.3) */
  minTrendStrength: number;
  /** Minimum buy pressure [0, 1] for buys (default: 0.4) */
  minBuyPressure: number;
  /** Minimum sell pressure [0, 1] for sells (default: 0.4) */
  minSellPressure: number;
  /** Minimum imbalance ratio to detect directional pressure (default: 1.5) */
  minImbalanceRatio: number;
  /** Minimum tick intensity (ticks/second) to confirm activity (default: 0.1) */
  minTickIntensity: number;
}

export const DEFAULT_THRESHOLDS: FeatureThresholds = {
  minLiquidityScore: 0.3,
  maxVolatilityPct: 5.0,
  minVolatilityPct: 0.1,
  maxSpreadPct: 2.0,
  minTrendStrength: 0.3,
  minBuyPressure: 0.4,
  minSellPressure: 0.4,
  minImbalanceRatio: 1.5,
  minTickIntensity: 0.1,
};

// =============================================================================
// LIQUIDITY CHECKS
// =============================================================================

/**
 * Check if market has sufficient liquidity
 *
 * @param features - Combined features for the market
 * @param min - Minimum liquidity score (default: 0.3)
 * @returns true if liquidity is sufficient
 */
export function checkLiquidity(
  features: CombinedFeatures | null,
  min = DEFAULT_THRESHOLDS.minLiquidityScore
): boolean {
  if (!features) return true; // No data - don't block
  return features.signals.liquidityScore >= min;
}

/**
 * Get liquidity score or null if unavailable
 */
export function getLiquidityScore(features: CombinedFeatures | null): number | null {
  return features?.signals.liquidityScore ?? null;
}

// =============================================================================
// VOLATILITY CHECKS
// =============================================================================

/**
 * Check if volatility is within acceptable range
 *
 * @param features - Combined features for the market
 * @param min - Minimum volatility % (default: 0.1)
 * @param max - Maximum volatility % (default: 5.0)
 * @returns true if volatility is within range
 */
export function checkVolatility(
  features: CombinedFeatures | null,
  min = DEFAULT_THRESHOLDS.minVolatilityPct,
  max = DEFAULT_THRESHOLDS.maxVolatilityPct
): boolean {
  if (!features?.tick) return true; // No data - don't block
  const vol = features.tick.volatilityPct;
  return vol >= min && vol <= max;
}

/**
 * Check if volatility is too high for safe trading
 */
export function isHighVolatility(
  features: CombinedFeatures | null,
  max = DEFAULT_THRESHOLDS.maxVolatilityPct
): boolean {
  if (!features?.tick) return false;
  return features.tick.volatilityPct > max;
}

/**
 * Get volatility percentage or null if unavailable
 */
export function getVolatilityPct(features: CombinedFeatures | null): number | null {
  return features?.tick?.volatilityPct ?? null;
}

// =============================================================================
// SPREAD CHECKS
// =============================================================================

/**
 * Check if spread is acceptable for trading
 *
 * @param features - Combined features for the market
 * @param maxPct - Maximum spread % (default: 2.0)
 * @returns true if spread is acceptable
 */
export function checkSpread(
  features: CombinedFeatures | null,
  maxPct = DEFAULT_THRESHOLDS.maxSpreadPct
): boolean {
  if (!features?.orderbook) return true; // No data - don't block
  return features.orderbook.spreadPct <= maxPct;
}

/**
 * Get spread percentage or null if unavailable
 */
export function getSpreadPct(features: CombinedFeatures | null): number | null {
  return features?.orderbook?.spreadPct ?? null;
}

// =============================================================================
// TREND / MOMENTUM CHECKS
// =============================================================================

/**
 * Check if there's a strong enough trend for trend-following strategies
 *
 * @param features - Combined features for the market
 * @param min - Minimum absolute trend strength (default: 0.3)
 * @returns true if trend is strong enough
 */
export function checkTrendStrength(
  features: CombinedFeatures | null,
  min = DEFAULT_THRESHOLDS.minTrendStrength
): boolean {
  if (!features) return false;
  return Math.abs(features.signals.trendStrength) >= min;
}

/**
 * Get trend direction: 'bullish', 'bearish', or 'neutral'
 */
export function getTrendDirection(
  features: CombinedFeatures | null,
  threshold = DEFAULT_THRESHOLDS.minTrendStrength
): 'bullish' | 'bearish' | 'neutral' {
  if (!features) return 'neutral';
  const strength = features.signals.trendStrength;
  if (strength >= threshold) return 'bullish';
  if (strength <= -threshold) return 'bearish';
  return 'neutral';
}

// =============================================================================
// PRESSURE / IMBALANCE CHECKS
// =============================================================================

/**
 * Check if buy pressure supports a buy order
 */
export function checkBuyPressure(
  features: CombinedFeatures | null,
  min = DEFAULT_THRESHOLDS.minBuyPressure
): boolean {
  if (!features) return true;
  return features.signals.buyPressure >= min;
}

/**
 * Check if sell pressure supports a sell order
 */
export function checkSellPressure(
  features: CombinedFeatures | null,
  min = DEFAULT_THRESHOLDS.minSellPressure
): boolean {
  if (!features) return true;
  return features.signals.sellPressure >= min;
}

/**
 * Check orderbook imbalance for directional bias
 */
export function checkImbalance(
  features: CombinedFeatures | null,
  minRatio = DEFAULT_THRESHOLDS.minImbalanceRatio
): { hasImbalance: boolean; direction: 'buy' | 'sell' | 'neutral' } {
  if (!features?.orderbook) {
    return { hasImbalance: false, direction: 'neutral' };
  }

  const ratio = features.orderbook.imbalanceRatio;
  if (ratio >= minRatio) {
    return { hasImbalance: true, direction: 'buy' };
  }
  if (ratio <= 1 / minRatio) {
    return { hasImbalance: true, direction: 'sell' };
  }
  return { hasImbalance: false, direction: 'neutral' };
}

// =============================================================================
// ACTIVITY CHECKS
// =============================================================================

/**
 * Check if market has sufficient activity (tick intensity)
 */
export function checkActivity(
  features: CombinedFeatures | null,
  minIntensity = DEFAULT_THRESHOLDS.minTickIntensity
): boolean {
  if (!features?.tick) return true;
  return features.tick.tickIntensity >= minIntensity;
}

// =============================================================================
// COMPOSITE CHECKS
// =============================================================================

export interface MarketConditionResult {
  tradeable: boolean;
  reasons: string[];
  score: number; // 0-100
}

/**
 * Comprehensive market condition check
 *
 * Returns a score and list of issues that may prevent trading.
 */
export function checkMarketConditions(
  features: CombinedFeatures | null,
  thresholds: Partial<FeatureThresholds> = {}
): MarketConditionResult {
  const cfg = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const reasons: string[] = [];
  let score = 100;

  if (!features) {
    return { tradeable: true, reasons: ['no_feature_data'], score: 50 };
  }

  // Liquidity check
  if (!checkLiquidity(features, cfg.minLiquidityScore)) {
    reasons.push(`low_liquidity (${features.signals.liquidityScore.toFixed(2)} < ${cfg.minLiquidityScore})`);
    score -= 30;
  }

  // Spread check
  if (!checkSpread(features, cfg.maxSpreadPct)) {
    const spreadPct = features.orderbook?.spreadPct ?? 0;
    reasons.push(`high_spread (${spreadPct.toFixed(2)}% > ${cfg.maxSpreadPct}%)`);
    score -= 25;
  }

  // Volatility check
  if (isHighVolatility(features, cfg.maxVolatilityPct)) {
    const volPct = features.tick?.volatilityPct ?? 0;
    reasons.push(`high_volatility (${volPct.toFixed(2)}% > ${cfg.maxVolatilityPct}%)`);
    score -= 20;
  }

  // Activity check
  if (!checkActivity(features, cfg.minTickIntensity)) {
    reasons.push(`low_activity`);
    score -= 10;
  }

  return {
    tradeable: reasons.length === 0,
    reasons,
    score: Math.max(0, score),
  };
}

/**
 * Quick check if a market is suitable for arbitrage execution
 */
export function isArbitrageReady(
  features: CombinedFeatures | null,
  thresholds?: Partial<FeatureThresholds>
): boolean {
  const cfg = { ...DEFAULT_THRESHOLDS, ...thresholds };

  // Must pass liquidity and spread checks
  return checkLiquidity(features, cfg.minLiquidityScore) &&
         checkSpread(features, cfg.maxSpreadPct);
}

/**
 * Quick check if market conditions favor a specific trade direction
 */
export function favorsTrade(
  features: CombinedFeatures | null,
  side: 'buy' | 'sell',
  thresholds?: Partial<FeatureThresholds>
): boolean {
  const cfg = { ...DEFAULT_THRESHOLDS, ...thresholds };

  if (!features) return true; // No data - don't block

  if (side === 'buy') {
    return checkBuyPressure(features, cfg.minBuyPressure);
  } else {
    return checkSellPressure(features, cfg.minSellPressure);
  }
}

/**
 * Calculate an adaptive stop loss based on volatility
 *
 * @param baseStopPct - Base stop loss percentage
 * @param features - Market features
 * @param multiplier - Volatility multiplier (default: 1.0)
 * @returns Adjusted stop loss percentage
 */
export function adaptiveStopLoss(
  baseStopPct: number,
  features: CombinedFeatures | null,
  multiplier = 1.0
): number {
  if (!features?.tick?.volatilityPct) return baseStopPct;

  // Add volatility to base stop loss
  const volAdjustment = features.tick.volatilityPct * multiplier;
  return baseStopPct + volAdjustment;
}

/**
 * Calculate an adaptive take profit based on trend and volatility
 *
 * @param baseTpPct - Base take profit percentage
 * @param features - Market features
 * @param multiplier - Adjustment multiplier (default: 1.0)
 * @returns Adjusted take profit percentage
 */
export function adaptiveTakeProfit(
  baseTpPct: number,
  features: CombinedFeatures | null,
  multiplier = 1.0
): number {
  if (!features?.tick?.volatilityPct) return baseTpPct;

  // In high volatility, use wider TP; in trending markets, extend TP
  const volAdjustment = features.tick.volatilityPct * 0.5 * multiplier;
  const trendAdjustment = Math.abs(features.signals.trendStrength) * baseTpPct * 0.3;

  return baseTpPct + volAdjustment + trendAdjustment;
}
