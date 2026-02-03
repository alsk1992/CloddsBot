/**
 * Unified Risk Engine
 *
 * Single entry point for all pre-trade validation. Orchestrates:
 * 1. Kill switch check (safety.ts)
 * 2. Circuit breaker check (execution/circuit-breaker.ts)
 * 3. Max order size (trading/risk.ts)
 * 4. Exposure limits (trading/risk.ts)
 * 5. Daily loss limit (safety.ts)
 * 6. Max drawdown (safety.ts)
 * 7. Concentration limit (safety.ts)
 * 8. VaR limit check (var.ts)
 * 9. Volatility regime adjustment (volatility.ts)
 * 10. Kelly sizing recommendation (kelly.ts)
 */

import { logger } from '../utils/logger';
import { createVaRCalculator, type VaRCalculator, type PnLRecord } from './var';
import {
  createVolatilityDetector,
  type VolatilityDetector,
  type VolatilityRegime,
  type VolatilityConfig,
} from './volatility';
import { runStressTest, type StressPosition, type StressResult } from './stress';
import { getRiskDashboard, type RiskDashboard, type DashboardSources } from './dashboard';
import { enforceMaxOrderSize, enforceExposureLimits, type RiskContext } from '../trading/risk';
import type { SafetyManager } from '../trading/safety';
import type {
  CircuitBreaker as ExecCircuitBreaker,
  CircuitBreakerState,
} from '../execution/circuit-breaker';
import type { DynamicKellyCalculator } from '../trading/kelly';
import type { Platform } from '../types';

// =============================================================================
// TYPES
// =============================================================================

export interface TradeRequest {
  /** User ID for exposure/settings lookup */
  userId: string;
  /** Target platform */
  platform: Platform;
  /** Market identifier */
  marketId?: string;
  /** Outcome identifier */
  outcomeId?: string;
  /** Outcome label */
  outcome?: string;
  /** Trade side */
  side: 'buy' | 'sell';
  /** Order size in USD (notional) */
  size: number;
  /** Entry price (0-1 for prediction markets) */
  price: number;
  /** Estimated edge (decimal, e.g. 0.05 for 5%) */
  estimatedEdge?: number;
  /** Confidence in the edge estimate (0-1) */
  confidence?: number;
  /** Category for Kelly lookup */
  category?: string;
}

export interface CheckResult {
  /** Name of the check */
  name: string;
  /** Whether this check passed */
  passed: boolean;
  /** Detail message */
  message: string;
}

export interface RiskDecision {
  /** Whether the trade is approved */
  approved: boolean;
  /** Kelly-adjusted position size (may differ from requested size) */
  adjustedSize?: number;
  /** Reason for rejection (if not approved) */
  reason?: string;
  /** Non-blocking warnings */
  warnings: string[];
  /** Individual check results */
  checks: CheckResult[];
  /** Current volatility regime */
  regime: VolatilityRegime;
}

export interface PortfolioRiskSnapshot {
  /** Total portfolio value */
  totalValue: number;
  /** Number of open positions */
  positionCount: number;
  /** VaR at 95% confidence */
  var95: number;
  /** VaR at 99% confidence */
  var99: number;
  /** CVaR at 95% */
  cvar95: number;
  /** Current volatility regime */
  regime: VolatilityRegime;
  /** Current drawdown percentage */
  drawdownPct: number;
  /** Daily P&L */
  dailyPnL: number;
}

export interface RiskConfig {
  /** VaR limit in USD — reject trades if portfolio VaR exceeds this */
  varLimit?: number;
  /** VaR confidence level for the limit check (default: 0.95) */
  varConfidence?: number;
  /** Volatility detector config */
  volatilityConfig?: Partial<VolatilityConfig>;
  /** VaR rolling window size (default: 100) */
  varWindowSize?: number;
  /** Initial bankroll for Kelly calculations */
  initialBankroll?: number;
}

export interface RiskEngine {
  /** Run all pre-trade checks and return a decision */
  validateTrade(request: TradeRequest): RiskDecision;
  /** Get a snapshot of portfolio-level risk */
  getPortfolioRisk(): PortfolioRiskSnapshot;
  /** Get current volatility regime */
  getRegime(): VolatilityRegime;
  /** Run a stress test scenario */
  runStressTest(scenario?: string): StressResult;
  /** Get the full risk dashboard */
  getDashboard(): RiskDashboard;
  /** Record a completed trade's P&L (feeds VaR + volatility) */
  recordPnL(record: PnLRecord): void;
  /** Get the internal VaR calculator (for advanced queries) */
  getVaRCalculator(): VaRCalculator;
  /** Get the internal volatility detector */
  getVolatilityDetector(): VolatilityDetector;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createRiskEngine(
  config: RiskConfig,
  deps: {
    riskContext: RiskContext;
    safetyManager?: SafetyManager;
    circuitBreaker?: ExecCircuitBreaker;
    kellyCalculator?: DynamicKellyCalculator;
    /** Current open positions for stress tests / concentration */
    getPositions?: () => StressPosition[];
    /** Current position values for HHI calculation */
    getPositionValues?: () => number[];
  }
): RiskEngine {
  // Internal subsystems
  const varCalc = createVaRCalculator({ windowSize: config.varWindowSize ?? 100 });
  const volDetector = createVolatilityDetector(config.volatilityConfig);

  const varLimit = config.varLimit;
  const varConfidence = config.varConfidence ?? 0.95;

  // =========================================================================
  // validateTrade
  // =========================================================================

  function validateTrade(request: TradeRequest): RiskDecision {
    const checks: CheckResult[] = [];
    const warnings: string[] = [];
    const regime = volDetector.getRegime();

    // ---- 1. Kill switch (safety manager) ----
    if (deps.safetyManager) {
      const canTrade = deps.safetyManager.canTrade();
      checks.push({
        name: 'kill_switch',
        passed: canTrade,
        message: canTrade ? 'Trading enabled' : deps.safetyManager.getState().disabledReason || 'Trading disabled',
      });
      if (!canTrade) {
        return {
          approved: false,
          reason: checks[checks.length - 1].message,
          warnings,
          checks,
          regime,
        };
      }
    }

    // ---- 2. Circuit breaker ----
    if (deps.circuitBreaker) {
      const canTrade = deps.circuitBreaker.canTrade();
      const cbState = deps.circuitBreaker.getState();
      checks.push({
        name: 'circuit_breaker',
        passed: canTrade,
        message: canTrade
          ? 'Circuit breaker OK'
          : `Circuit breaker tripped: ${cbState.tripReason}`,
      });
      if (!canTrade) {
        return {
          approved: false,
          reason: checks[checks.length - 1].message,
          warnings,
          checks,
          regime,
        };
      }
    }

    // ---- 3. Max order size ----
    const orderSizeResult = enforceMaxOrderSize(
      deps.riskContext,
      request.size,
      `${request.platform}:${request.marketId || 'unknown'}`
    );
    const orderSizePassed = orderSizeResult === null;
    checks.push({
      name: 'max_order_size',
      passed: orderSizePassed,
      message: orderSizePassed ? 'Order size within limit' : 'Order exceeds max order size',
    });
    if (!orderSizePassed) {
      return {
        approved: false,
        reason: 'Order exceeds max order size',
        warnings,
        checks,
        regime,
      };
    }

    // ---- 4. Exposure limits ----
    const exposureResult = enforceExposureLimits(deps.riskContext, request.userId, {
      platform: request.platform,
      marketId: request.marketId,
      outcomeId: request.outcomeId,
      notional: request.size,
      label: `${request.side} ${request.outcome || request.outcomeId || 'unknown'}`,
    });
    const exposurePassed = exposureResult === null;
    checks.push({
      name: 'exposure_limits',
      passed: exposurePassed,
      message: exposurePassed ? 'Exposure within limits' : 'Exposure limit exceeded',
    });
    if (!exposurePassed) {
      return {
        approved: false,
        reason: 'Exposure limit exceeded',
        warnings,
        checks,
        regime,
      };
    }

    // ---- 5 & 6 & 7. Daily loss, drawdown, concentration (safety manager) ----
    if (deps.safetyManager) {
      const validation = deps.safetyManager.validateTrade({
        platform: request.platform,
        marketId: request.marketId || '',
        outcome: request.outcome || '',
        side: request.side,
        size: request.size,
        price: request.price,
      });
      checks.push({
        name: 'safety_validation',
        passed: validation.allowed,
        message: validation.allowed
          ? 'Safety checks passed (daily loss, drawdown, concentration)'
          : validation.reason || 'Safety validation failed',
      });
      if (!validation.allowed) {
        return {
          approved: false,
          reason: validation.reason || 'Safety validation failed',
          warnings,
          checks,
          regime,
        };
      }
    }

    // ---- 8. VaR limit ----
    if (varLimit !== undefined) {
      const currentVaR = varCalc.calculateAt(varConfidence);
      const varPassed = currentVaR.historicalVaR <= varLimit;
      checks.push({
        name: 'var_limit',
        passed: varPassed,
        message: varPassed
          ? `VaR $${currentVaR.historicalVaR.toFixed(2)} within limit $${varLimit}`
          : `VaR $${currentVaR.historicalVaR.toFixed(2)} exceeds limit $${varLimit}`,
      });
      if (!varPassed) {
        return {
          approved: false,
          reason: `Portfolio VaR ($${currentVaR.historicalVaR.toFixed(2)}) exceeds limit ($${varLimit})`,
          warnings,
          checks,
          regime,
        };
      }

      // Warning at 80% of VaR limit
      if (currentVaR.historicalVaR > varLimit * 0.8) {
        warnings.push(
          `VaR approaching limit: $${currentVaR.historicalVaR.toFixed(2)} / $${varLimit}`
        );
      }
    } else {
      checks.push({ name: 'var_limit', passed: true, message: 'No VaR limit configured' });
    }

    // ---- 9. Volatility regime ----
    const volSnapshot = volDetector.detect();
    checks.push({
      name: 'volatility_regime',
      passed: !volSnapshot.shouldHalt,
      message: volSnapshot.shouldHalt
        ? `EXTREME volatility — trading halted (stddev: ${volSnapshot.rollingStdDev})`
        : `Regime: ${regime} (multiplier: ${volSnapshot.sizeMultiplier}x)`,
    });
    if (volSnapshot.shouldHalt) {
      return {
        approved: false,
        reason: 'Extreme volatility — trading halted',
        warnings,
        checks,
        regime,
      };
    }
    if (regime === 'high') {
      warnings.push('High volatility — position size reduced');
    }

    // ---- 10. Kelly sizing ----
    let adjustedSize = request.size;
    if (deps.kellyCalculator && request.estimatedEdge !== undefined) {
      const kellyResult = deps.kellyCalculator.calculate(
        request.estimatedEdge,
        request.confidence ?? 0.7,
        { category: request.category }
      );

      // Apply volatility regime multiplier to Kelly-recommended size
      const kellySize = kellyResult.positionSize * volSnapshot.sizeMultiplier;

      // Use the smaller of requested size and Kelly recommendation
      adjustedSize = Math.min(request.size, kellySize);
      adjustedSize = Math.round(adjustedSize * 100) / 100;

      checks.push({
        name: 'kelly_sizing',
        passed: true,
        message: `Kelly recommends $${kellySize.toFixed(2)} (fraction: ${kellyResult.kelly}, regime: ${volSnapshot.sizeMultiplier}x)`,
      });

      if (adjustedSize < request.size) {
        warnings.push(
          `Size reduced from $${request.size} to $${adjustedSize} (Kelly + regime adjustment)`
        );
      }

      // Pass through Kelly warnings
      for (const w of kellyResult.warnings) {
        warnings.push(w);
      }
    } else {
      // No Kelly — just apply regime multiplier
      adjustedSize = Math.round(request.size * volSnapshot.sizeMultiplier * 100) / 100;
      checks.push({
        name: 'kelly_sizing',
        passed: true,
        message: 'No Kelly calculator — using regime-adjusted size',
      });
      if (adjustedSize < request.size) {
        warnings.push(
          `Size reduced from $${request.size} to $${adjustedSize} (regime: ${regime})`
        );
      }
    }

    logger.debug(
      {
        trade: `${request.platform}:${request.marketId}`,
        approved: true,
        originalSize: request.size,
        adjustedSize,
        regime,
        checksRun: checks.length,
      },
      'Risk engine: trade approved'
    );

    return {
      approved: true,
      adjustedSize,
      warnings,
      checks,
      regime,
    };
  }

  // =========================================================================
  // Portfolio risk snapshot
  // =========================================================================

  function getPortfolioRisk(): PortfolioRiskSnapshot {
    const var95 = varCalc.calculateAt(0.95);
    const var99 = varCalc.calculateAt(0.99);
    const regime = volDetector.getRegime();

    let drawdownPct = 0;
    let dailyPnL = 0;
    if (deps.safetyManager) {
      const state = deps.safetyManager.getState();
      drawdownPct = state.currentDrawdownPct;
      dailyPnL = state.dailyPnL;
    }

    const positions = deps.getPositions?.() || [];
    const totalValue = positions.reduce((sum, p) => sum + p.value, 0);

    return {
      totalValue: Math.round(totalValue * 100) / 100,
      positionCount: positions.length,
      var95: var95.historicalVaR,
      var99: var99.historicalVaR,
      cvar95: var95.cvar,
      regime,
      drawdownPct: Math.round(drawdownPct * 100) / 100,
      dailyPnL: Math.round(dailyPnL * 100) / 100,
    };
  }

  // =========================================================================
  // Other methods
  // =========================================================================

  function getRegime(): VolatilityRegime {
    return volDetector.getRegime();
  }

  function stressTest(scenario?: string): StressResult {
    const positions = deps.getPositions?.() || [];
    return runStressTest(positions, scenario);
  }

  function getDashboard(): RiskDashboard {
    const cbState = deps.circuitBreaker?.getState();
    const positionValues = deps.getPositionValues?.() || [];

    const sources: DashboardSources = {
      varCalculator: varCalc,
      volatilityDetector: volDetector,
      safetyManager: deps.safetyManager,
      circuitBreakerState: cbState,
      kellyCalculator: deps.kellyCalculator,
      positionValues,
    };

    return getRiskDashboard(sources);
  }

  function recordPnL(record: PnLRecord): void {
    varCalc.addObservation(record);
    volDetector.addObservation(record.pnlPct);
  }

  return {
    validateTrade,
    getPortfolioRisk,
    getRegime,
    runStressTest: stressTest,
    getDashboard,
    recordPnL,
    getVaRCalculator: () => varCalc,
    getVolatilityDetector: () => volDetector,
  };
}
