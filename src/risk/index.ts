/**
 * Risk Management Module
 */

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
