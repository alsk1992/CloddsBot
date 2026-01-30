/**
 * Trading Circuit Breaker
 *
 * Safety mechanism that halts trading when conditions are triggered:
 * - Maximum loss threshold exceeded
 * - Too many consecutive losses
 * - Error rate too high
 * - Unusual market volatility
 * - Manual kill switch
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface CircuitBreakerConfig {
  /** Maximum loss in USD before tripping (default: 1000) */
  maxLossUsd: number;
  /** Maximum loss as % of balance before tripping (default: 10) */
  maxLossPct: number;
  /** Maximum consecutive losses before tripping (default: 5) */
  maxConsecutiveLosses: number;
  /** Error rate threshold (0-1) before tripping (default: 0.5) */
  maxErrorRate: number;
  /** Minimum trades before error rate applies (default: 10) */
  minTradesForErrorRate: number;
  /** Reset timeout in ms (default: 3600000 = 1 hour) */
  resetTimeoutMs: number;
  /** Cool-down period after trip in ms (default: 300000 = 5 min) */
  cooldownMs: number;
  /** Maximum position size in USD (default: 10000) */
  maxPositionSize: number;
  /** Maximum daily trades (default: 100) */
  maxDailyTrades: number;
  /** Check interval in ms (default: 10000) */
  checkIntervalMs: number;
}

export type TripReason =
  | 'max_loss'
  | 'max_loss_pct'
  | 'consecutive_losses'
  | 'high_error_rate'
  | 'max_position'
  | 'max_daily_trades'
  | 'manual'
  | 'system_error';

export interface CircuitBreakerState {
  /** Whether circuit is tripped */
  isTripped: boolean;
  /** Reason for trip (if tripped) */
  tripReason?: TripReason;
  /** When circuit was tripped */
  trippedAt?: Date;
  /** When circuit will auto-reset */
  resetAt?: Date;
  /** Current consecutive losses */
  consecutiveLosses: number;
  /** Current session P&L */
  sessionPnL: number;
  /** Current error rate */
  errorRate: number;
  /** Total trades today */
  dailyTrades: number;
  /** Open position size */
  openPositionSize: number;
}

export interface TradeResult {
  /** P&L in USD */
  pnlUsd: number;
  /** Was trade successful */
  success: boolean;
  /** Trade size in USD */
  sizeUsd: number;
  /** Error message if failed */
  error?: string;
}

export interface CircuitBreaker extends EventEmitter {
  /** Check if trading is allowed */
  canTrade(): boolean;

  /** Record a trade result */
  recordTrade(result: TradeResult): void;

  /** Record a system error */
  recordError(error: Error | string): void;

  /** Manually trip the circuit */
  trip(reason: TripReason): void;

  /** Manually reset the circuit */
  reset(): void;

  /** Get current state */
  getState(): CircuitBreakerState;

  /** Update open position size */
  updatePositionSize(sizeUsd: number): void;

  /** Start monitoring */
  start(): void;

  /** Stop monitoring */
  stop(): void;
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxLossUsd: 1000,
  maxLossPct: 10,
  maxConsecutiveLosses: 5,
  maxErrorRate: 0.5,
  minTradesForErrorRate: 10,
  resetTimeoutMs: 3600000, // 1 hour
  cooldownMs: 300000, // 5 minutes
  maxPositionSize: 10000,
  maxDailyTrades: 100,
  checkIntervalMs: 10000,
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createCircuitBreaker(
  config: Partial<CircuitBreakerConfig> = {},
  initialBalance: number = 10000
): CircuitBreaker {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const emitter = new EventEmitter() as CircuitBreaker;

  // State
  let isTripped = false;
  let tripReason: TripReason | undefined;
  let trippedAt: Date | undefined;
  let consecutiveLosses = 0;
  let sessionPnL = 0;
  let dailyTrades = 0;
  let openPositionSize = 0;
  let totalTrades = 0;
  let errorCount = 0;
  let checkInterval: ReturnType<typeof setInterval> | null = null;
  let dailyResetTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Trip the circuit breaker
   */
  function trip(reason: TripReason): void {
    if (isTripped) return;

    isTripped = true;
    tripReason = reason;
    trippedAt = new Date();

    logger.error(
      {
        reason,
        sessionPnL,
        consecutiveLosses,
        errorRate: getErrorRate(),
        dailyTrades,
      },
      'Circuit breaker TRIPPED'
    );

    emitter.emit('tripped', { reason, state: getState() });

    // Schedule auto-reset
    setTimeout(() => {
      if (isTripped && tripReason === reason) {
        reset();
      }
    }, cfg.resetTimeoutMs);
  }

  /**
   * Reset the circuit breaker
   */
  function reset(): void {
    logger.info({ previousReason: tripReason }, 'Circuit breaker RESET');

    isTripped = false;
    tripReason = undefined;
    trippedAt = undefined;
    consecutiveLosses = 0;
    errorCount = 0;

    emitter.emit('reset', { state: getState() });
  }

  /**
   * Check if trading is allowed
   */
  function canTrade(): boolean {
    if (isTripped) {
      return false;
    }

    // Check position size
    if (openPositionSize >= cfg.maxPositionSize) {
      trip('max_position');
      return false;
    }

    // Check daily trades
    if (dailyTrades >= cfg.maxDailyTrades) {
      trip('max_daily_trades');
      return false;
    }

    return true;
  }

  /**
   * Get current error rate
   */
  function getErrorRate(): number {
    if (totalTrades < cfg.minTradesForErrorRate) {
      return 0;
    }
    return errorCount / totalTrades;
  }

  /**
   * Record a trade result
   */
  function recordTrade(result: TradeResult): void {
    totalTrades++;
    dailyTrades++;
    sessionPnL += result.pnlUsd;

    if (result.success && result.pnlUsd >= 0) {
      consecutiveLosses = 0;
    } else {
      consecutiveLosses++;
      if (!result.success) {
        errorCount++;
      }
    }

    // Check trip conditions
    checkConditions();

    emitter.emit('trade', { result, state: getState() });
  }

  /**
   * Record a system error
   */
  function recordError(error: Error | string): void {
    errorCount++;
    totalTrades++;

    logger.warn({ error: typeof error === 'string' ? error : error.message }, 'Trade error recorded');

    checkConditions();

    emitter.emit('error', { error, state: getState() });
  }

  /**
   * Check all trip conditions
   */
  function checkConditions(): void {
    if (isTripped) return;

    // Check max loss USD
    if (sessionPnL <= -cfg.maxLossUsd) {
      trip('max_loss');
      return;
    }

    // Check max loss percentage
    const lossPct = (sessionPnL / initialBalance) * -100;
    if (lossPct >= cfg.maxLossPct) {
      trip('max_loss_pct');
      return;
    }

    // Check consecutive losses
    if (consecutiveLosses >= cfg.maxConsecutiveLosses) {
      trip('consecutive_losses');
      return;
    }

    // Check error rate
    const errorRate = getErrorRate();
    if (errorRate >= cfg.maxErrorRate) {
      trip('high_error_rate');
      return;
    }
  }

  /**
   * Update open position size
   */
  function updatePositionSize(sizeUsd: number): void {
    openPositionSize = sizeUsd;

    if (openPositionSize >= cfg.maxPositionSize && !isTripped) {
      trip('max_position');
    }
  }

  /**
   * Get current state
   */
  function getState(): CircuitBreakerState {
    return {
      isTripped,
      tripReason,
      trippedAt,
      resetAt: trippedAt ? new Date(trippedAt.getTime() + cfg.resetTimeoutMs) : undefined,
      consecutiveLosses,
      sessionPnL,
      errorRate: getErrorRate(),
      dailyTrades,
      openPositionSize,
    };
  }

  /**
   * Start monitoring
   */
  function start(): void {
    // Periodic check
    checkInterval = setInterval(() => {
      checkConditions();
    }, cfg.checkIntervalMs);

    // Daily reset at midnight
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msToMidnight = midnight.getTime() - now.getTime();

    dailyResetTimeout = setTimeout(() => {
      dailyTrades = 0;
      sessionPnL = 0;
      logger.info('Daily trading counters reset');

      // Set up next day's reset
      setInterval(() => {
        dailyTrades = 0;
        sessionPnL = 0;
        logger.info('Daily trading counters reset');
      }, 86400000); // 24 hours
    }, msToMidnight);

    logger.info({ config: cfg }, 'Circuit breaker started');
    emitter.emit('started');
  }

  /**
   * Stop monitoring
   */
  function stop(): void {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }

    if (dailyResetTimeout) {
      clearTimeout(dailyResetTimeout);
      dailyResetTimeout = null;
    }

    logger.info('Circuit breaker stopped');
    emitter.emit('stopped');
  }

  // Attach methods
  Object.assign(emitter, {
    canTrade,
    recordTrade,
    recordError,
    trip,
    reset,
    getState,
    updatePositionSize,
    start,
    stop,
  });

  return emitter;
}

// =============================================================================
// GLOBAL CIRCUIT BREAKER
// =============================================================================

let globalCircuitBreaker: CircuitBreaker | null = null;

export function getGlobalCircuitBreaker(): CircuitBreaker {
  if (!globalCircuitBreaker) {
    globalCircuitBreaker = createCircuitBreaker();
  }
  return globalCircuitBreaker;
}

export function initGlobalCircuitBreaker(
  config: Partial<CircuitBreakerConfig>,
  balance: number
): CircuitBreaker {
  globalCircuitBreaker = createCircuitBreaker(config, balance);
  return globalCircuitBreaker;
}
