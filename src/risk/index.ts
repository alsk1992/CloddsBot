/**
 * Risk Management Module
 */

// Feature-engineering circuit breaker (market-condition-aware)
export {
  createCircuitBreaker,
  CONSERVATIVE_CONFIG,
  MODERATE_CONFIG,
  AGGRESSIVE_CONFIG,
  type CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitBreakerState,
  type TripCondition,
  type TripConditionType,
  type TripEvent,
  type TripScope,
  type VolatilityCondition,
  type LiquidityCondition,
  type LossCondition,
  type FailureCondition,
  type SpreadCondition,
  type ManualCondition,
} from './circuit-breaker';

// Unified risk engine
export {
  createRiskEngine,
  type RiskEngine,
  type RiskConfig,
  type RiskDecision,
  type TradeRequest,
  type CheckResult,
  type PortfolioRiskSnapshot,
} from './engine';

// Value-at-Risk
export {
  createVaRCalculator,
  calculateVaR,
  calculateCVaR,
  type VaRCalculator,
  type VaRConfig,
  type VaRResult,
  type PositionVaR,
  type PnLRecord,
} from './var';

// Volatility regime detection
export {
  createVolatilityDetector,
  detectRegime,
  type VolatilityDetector,
  type VolatilityRegime,
  type VolatilityConfig,
  type VolatilitySnapshot,
} from './volatility';

// Stress testing
export {
  runStressTest,
  runAllScenarios,
  getAvailableScenarios,
  type StressResult,
  type StressPosition,
  type StressTestConfig,
  type ScenarioName,
} from './stress';

// Risk dashboard
export {
  getRiskDashboard,
  type RiskDashboard,
  type DashboardSources,
} from './dashboard';

// Re-export execution-level circuit breaker under a distinct name
export {
  createCircuitBreaker as createExecCircuitBreaker,
  getGlobalCircuitBreaker,
  initGlobalCircuitBreaker,
  type CircuitBreaker as ExecCircuitBreaker,
  type CircuitBreakerConfig as ExecCircuitBreakerConfig,
  type CircuitBreakerState as ExecCircuitBreakerState,
  type TradeResult,
  type TripReason,
} from '../execution/circuit-breaker';
