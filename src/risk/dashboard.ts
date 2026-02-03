/**
 * Risk Dashboard
 *
 * Aggregates real-time risk metrics from all risk subsystems into a
 * single snapshot for display and monitoring.
 */

import type { VaRCalculator } from './var';
import type { VolatilityDetector, VolatilityRegime } from './volatility';
import type { SafetyManager } from '../trading/safety';
import type { CircuitBreakerState } from '../execution/circuit-breaker';
import type { DynamicKellyCalculator } from '../trading/kelly';

// =============================================================================
// TYPES
// =============================================================================

export interface RiskDashboard {
  /** Portfolio Value-at-Risk at 95% confidence */
  portfolioVaR95: number;
  /** Portfolio Value-at-Risk at 99% confidence */
  portfolioVaR99: number;
  /** Conditional VaR (Expected Shortfall) at 95% */
  cvar95: number;
  /** Current volatility regime */
  regime: VolatilityRegime;
  /** Volatility-based position size multiplier */
  regimeSizeMultiplier: number;
  /** Execution circuit breaker status */
  circuitBreakerTripped: boolean;
  /** Circuit breaker trip reason, if tripped */
  circuitBreakerReason?: string;
  /** Today's realized P&L */
  dailyPnL: number;
  /** Daily loss limit configured */
  dailyLossLimit: number;
  /** Daily loss utilization (0-1) */
  dailyLossUtilization: number;
  /** Maximum drawdown configured (percentage) */
  maxDrawdown: number;
  /** Current drawdown from peak (percentage) */
  currentDrawdown: number;
  /** Number of open positions */
  openPositions: number;
  /** Herfindahl-Hirschman Index for position concentration (0-10000) */
  concentrationHHI: number;
  /** Whether kill switch is active */
  killSwitchActive: boolean;
  /** Current Kelly fraction recommendation */
  kellyFraction: number;
  /** Aggregate warnings from all subsystems */
  warnings: string[];
  /** Timestamp of this snapshot */
  timestamp: Date;
}

export interface DashboardSources {
  varCalculator?: VaRCalculator;
  volatilityDetector?: VolatilityDetector;
  safetyManager?: SafetyManager;
  circuitBreakerState?: CircuitBreakerState;
  kellyCalculator?: DynamicKellyCalculator;
  /** Current open position values, for concentration calculation */
  positionValues?: number[];
  /** Override daily loss limit (defaults to 500 if SafetyManager config not available) */
  dailyLossLimit?: number;
  /** Override max drawdown % (defaults to 20 if SafetyManager config not available) */
  maxDrawdownPct?: number;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Calculate Herfindahl-Hirschman Index from position values.
 * HHI = sum of (market share %)^2. Range: 0 (perfectly diversified) to 10000 (single position).
 */
function calculateHHI(values: number[]): number {
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0 || values.length === 0) return 0;
  return values.reduce((sum, v) => {
    const share = (v / total) * 100;
    return sum + share * share;
  }, 0);
}

/**
 * Build a risk dashboard snapshot from available subsystem data.
 *
 * All sources are optional — the dashboard gracefully degrades when
 * a subsystem is not available, filling in safe defaults.
 */
export function getRiskDashboard(sources: DashboardSources = {}): RiskDashboard {
  const warnings: string[] = [];

  // VaR
  let portfolioVaR95 = 0;
  let portfolioVaR99 = 0;
  let cvar95 = 0;

  if (sources.varCalculator) {
    const var95 = sources.varCalculator.calculateAt(0.95);
    const var99 = sources.varCalculator.calculateAt(0.99);
    portfolioVaR95 = var95.historicalVaR;
    portfolioVaR99 = var99.historicalVaR;
    cvar95 = var95.cvar;

    if (var95.sampleSize < 10) {
      warnings.push(`VaR based on only ${var95.sampleSize} observations — low confidence`);
    }
  }

  // Volatility regime
  let regime: VolatilityRegime = 'normal';
  let regimeSizeMultiplier = 1.0;

  if (sources.volatilityDetector) {
    const snapshot = sources.volatilityDetector.detect();
    regime = snapshot.regime;
    regimeSizeMultiplier = snapshot.sizeMultiplier;

    if (snapshot.shouldHalt) {
      warnings.push('EXTREME volatility — trading should halt');
    } else if (regime === 'high') {
      warnings.push('HIGH volatility regime — position sizes reduced');
    }
  }

  // Safety manager
  let dailyPnL = 0;
  let dailyLossLimit = sources.dailyLossLimit ?? 500;
  let maxDrawdown = sources.maxDrawdownPct ?? 20;
  let currentDrawdown = 0;
  let killSwitchActive = false;

  if (sources.safetyManager) {
    const state = sources.safetyManager.getState();
    dailyPnL = state.dailyPnL;
    currentDrawdown = state.currentDrawdownPct;
    killSwitchActive = !state.tradingEnabled && state.disabledReason?.includes('KILL') === true;

    if (killSwitchActive) {
      warnings.push('KILL SWITCH ACTIVE — all trading halted');
    }

    for (const alert of state.alerts) {
      if (alert.type === 'warning' || alert.type === 'critical') {
        warnings.push(alert.message);
      }
    }
  }

  const dailyLossUtilization =
    dailyPnL < 0 && dailyLossLimit > 0 ? Math.min(1, Math.abs(dailyPnL) / dailyLossLimit) : 0;

  // Circuit breaker
  let circuitBreakerTripped = false;
  let circuitBreakerReason: string | undefined;

  if (sources.circuitBreakerState) {
    circuitBreakerTripped = sources.circuitBreakerState.isTripped;
    circuitBreakerReason = sources.circuitBreakerState.tripReason;

    if (circuitBreakerTripped) {
      warnings.push(`Circuit breaker tripped: ${circuitBreakerReason}`);
    }
  }

  // Kelly
  let kellyFraction = 0.25;

  if (sources.kellyCalculator) {
    const state = sources.kellyCalculator.getState();
    // Use the recent average Kelly; fallback to default
    kellyFraction = state.currentDrawdown > 0.1 ? 0.1 : 0.25;
  }

  // Concentration
  const positionValues = sources.positionValues || [];
  const concentrationHHI = Math.round(calculateHHI(positionValues));

  if (concentrationHHI > 5000 && positionValues.length > 1) {
    warnings.push(`High concentration (HHI: ${concentrationHHI}) — consider diversifying`);
  }

  return {
    portfolioVaR95: Math.round(portfolioVaR95 * 100) / 100,
    portfolioVaR99: Math.round(portfolioVaR99 * 100) / 100,
    cvar95: Math.round(cvar95 * 100) / 100,
    regime,
    regimeSizeMultiplier,
    circuitBreakerTripped,
    circuitBreakerReason,
    dailyPnL: Math.round(dailyPnL * 100) / 100,
    dailyLossLimit,
    dailyLossUtilization: Math.round(dailyLossUtilization * 100) / 100,
    maxDrawdown,
    currentDrawdown: Math.round(currentDrawdown * 100) / 100,
    openPositions: positionValues.length,
    concentrationHHI,
    killSwitchActive,
    kellyFraction,
    warnings,
    timestamp: new Date(),
  };
}
