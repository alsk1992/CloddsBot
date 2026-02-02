/**
 * Circuit Breaker - Halt trading when conditions become unfavorable
 *
 * Features:
 * - Volatility-based trip conditions using feature engineering
 * - Loss-based trip (daily/hourly loss limits)
 * - Consecutive failure trip
 * - Market-wide or per-market circuit breakers
 * - Auto-reset after cooldown or manual reset
 * - Event-driven notifications
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '../utils/logger';
import {
  getMarketFeatures,
  getVolatilityPct,
  getLiquidityScore,
} from '../services/feature-engineering';

// =============================================================================
// TYPES
// =============================================================================

export type TripConditionType = 'volatility' | 'liquidity' | 'loss' | 'failures' | 'spread' | 'manual';
export type TripScope = 'global' | 'platform' | 'market';
export type LossWindow = 'hourly' | 'daily' | 'weekly';

export interface VolatilityCondition {
  type: 'volatility';
  maxVolatilityPct: number;
  scope: TripScope;
  platforms?: string[];
}

export interface LiquidityCondition {
  type: 'liquidity';
  minLiquidityScore: number;
  scope: TripScope;
}

export interface LossCondition {
  type: 'loss';
  maxLossPct: number;
  window: LossWindow;
}

export interface FailureCondition {
  type: 'failures';
  maxConsecutive: number;
}

export interface SpreadCondition {
  type: 'spread';
  maxSpreadPct: number;
  scope: TripScope;
}

export interface ManualCondition {
  type: 'manual';
  reason: string;
}

export type TripCondition =
  | VolatilityCondition
  | LiquidityCondition
  | LossCondition
  | FailureCondition
  | SpreadCondition
  | ManualCondition;

export interface CircuitBreakerConfig {
  conditions: TripCondition[];
  cooldownMs?: number;
  autoReset?: boolean;
  checkIntervalMs?: number;
  enabled?: boolean;
}

export interface TripEvent {
  condition: TripCondition;
  timestamp: Date;
  details: Record<string, unknown>;
  scope: TripScope;
  platform?: string;
  marketId?: string;
}

export interface CircuitBreakerState {
  tripped: boolean;
  trippedAt?: Date;
  tripEvent?: TripEvent;
  resetAt?: Date;
  tripHistory: TripEvent[];
  consecutiveFailures: number;
  losses: {
    hourly: number;
    daily: number;
    weekly: number;
  };
}

export interface CircuitBreakerEvents {
  tripped: (event: TripEvent) => void;
  reset: (manual: boolean) => void;
  warning: (condition: TripCondition, details: Record<string, unknown>) => void;
}

export interface CircuitBreaker extends EventEmitter<keyof CircuitBreakerEvents> {
  canTrade(platform?: string, marketId?: string): boolean;
  checkCondition(condition: TripCondition, platform?: string, marketId?: string): {
    tripped: boolean;
    details: Record<string, unknown>;
  };
  recordTrade(result: { success: boolean; pnl?: number }): void;
  trip(reason: string): void;
  reset(): void;
  getState(): CircuitBreakerState;
  updateConfig(config: Partial<CircuitBreakerConfig>): void;
  startMonitoring(): void;
  stopMonitoring(): void;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

const DEFAULT_CONFIG: Required<CircuitBreakerConfig> = {
  conditions: [],
  cooldownMs: 300000,
  autoReset: false,
  checkIntervalMs: 10000,
  enabled: true,
};

export function createCircuitBreaker(config: CircuitBreakerConfig): CircuitBreaker {
  const emitter = new EventEmitter() as CircuitBreaker;
  let cfg = { ...DEFAULT_CONFIG, ...config };

  const state: CircuitBreakerState = {
    tripped: false,
    tripHistory: [],
    consecutiveFailures: 0,
    losses: { hourly: 0, daily: 0, weekly: 0 },
  };

  let monitoringInterval: NodeJS.Timeout | null = null;
  let lossResetIntervals: NodeJS.Timeout[] = [];
  const marketTrips = new Map<string, TripEvent>();

  function checkVolatilityCondition(
    condition: VolatilityCondition,
    platform?: string,
    marketId?: string
  ): { tripped: boolean; details: Record<string, unknown> } {
    if (condition.scope === 'market' && platform && marketId) {
      const features = getMarketFeatures(platform, marketId);
      const volatilityPct = getVolatilityPct(features);

      if (volatilityPct !== null && volatilityPct > condition.maxVolatilityPct) {
        return {
          tripped: true,
          details: { volatilityPct, maxVolatilityPct: condition.maxVolatilityPct, platform, marketId },
        };
      }
    }
    return { tripped: false, details: {} };
  }

  function checkLiquidityCondition(
    condition: LiquidityCondition,
    platform?: string,
    marketId?: string
  ): { tripped: boolean; details: Record<string, unknown> } {
    if (condition.scope === 'market' && platform && marketId) {
      const features = getMarketFeatures(platform, marketId);
      const liquidityScore = getLiquidityScore(features);

      if (liquidityScore !== null && liquidityScore < condition.minLiquidityScore) {
        return {
          tripped: true,
          details: { liquidityScore, minLiquidityScore: condition.minLiquidityScore, platform, marketId },
        };
      }
    }
    return { tripped: false, details: {} };
  }

  function checkLossCondition(condition: LossCondition): { tripped: boolean; details: Record<string, unknown> } {
    const loss = state.losses[condition.window];
    const lossAbs = Math.abs(loss);

    if (loss < 0 && lossAbs >= condition.maxLossPct) {
      return {
        tripped: true,
        details: { lossPct: lossAbs, maxLossPct: condition.maxLossPct, window: condition.window },
      };
    }
    return { tripped: false, details: {} };
  }

  function checkFailureCondition(condition: FailureCondition): { tripped: boolean; details: Record<string, unknown> } {
    if (state.consecutiveFailures >= condition.maxConsecutive) {
      return {
        tripped: true,
        details: { consecutiveFailures: state.consecutiveFailures, maxConsecutive: condition.maxConsecutive },
      };
    }
    return { tripped: false, details: {} };
  }

  function checkSpreadCondition(
    condition: SpreadCondition,
    platform?: string,
    marketId?: string
  ): { tripped: boolean; details: Record<string, unknown> } {
    if (condition.scope === 'market' && platform && marketId) {
      const features = getMarketFeatures(platform, marketId);
      const spreadPct = features?.orderbook?.spreadPct;

      if (spreadPct !== undefined && spreadPct > condition.maxSpreadPct) {
        return {
          tripped: true,
          details: { spreadPct, maxSpreadPct: condition.maxSpreadPct, platform, marketId },
        };
      }
    }
    return { tripped: false, details: {} };
  }

  function checkConditionInternal(
    condition: TripCondition,
    platform?: string,
    marketId?: string
  ): { tripped: boolean; details: Record<string, unknown> } {
    switch (condition.type) {
      case 'volatility':
        return checkVolatilityCondition(condition, platform, marketId);
      case 'liquidity':
        return checkLiquidityCondition(condition, platform, marketId);
      case 'loss':
        return checkLossCondition(condition);
      case 'failures':
        return checkFailureCondition(condition);
      case 'spread':
        return checkSpreadCondition(condition, platform, marketId);
      case 'manual':
        return { tripped: false, details: {} };
      default:
        return { tripped: false, details: {} };
    }
  }

  function checkAllConditions(platform?: string, marketId?: string): TripEvent | null {
    for (const condition of cfg.conditions) {
      const result = checkConditionInternal(condition, platform, marketId);
      if (result.tripped) {
        return {
          condition,
          timestamp: new Date(),
          details: result.details,
          scope: (condition as any).scope || 'global',
          platform,
          marketId,
        };
      }
    }
    return null;
  }

  function tripBreaker(event: TripEvent): void {
    if (state.tripped) return;

    state.tripped = true;
    state.trippedAt = event.timestamp;
    state.tripEvent = event;
    state.tripHistory.push(event);

    if (state.tripHistory.length > 100) {
      state.tripHistory.shift();
    }

    if (cfg.autoReset && cfg.cooldownMs > 0) {
      state.resetAt = new Date(Date.now() + cfg.cooldownMs);
      setTimeout(() => {
        if (state.tripped && cfg.autoReset) {
          resetBreaker(false);
        }
      }, cfg.cooldownMs);
    }

    logger.warn({ condition: event.condition.type, details: event.details, resetAt: state.resetAt }, 'Circuit breaker tripped');
    emitter.emit('tripped', event);
  }

  function resetBreaker(manual: boolean): void {
    if (!state.tripped) return;

    state.tripped = false;
    state.trippedAt = undefined;
    state.tripEvent = undefined;
    state.resetAt = undefined;
    state.consecutiveFailures = 0;

    logger.info({ manual }, 'Circuit breaker reset');
    emitter.emit('reset', manual);
  }

  function setupLossResets(): void {
    for (const interval of lossResetIntervals) clearInterval(interval);
    lossResetIntervals = [];

    lossResetIntervals.push(setInterval(() => { state.losses.hourly = 0; }, 60 * 60 * 1000));
    lossResetIntervals.push(setInterval(() => { state.losses.daily = 0; }, 24 * 60 * 60 * 1000));
    lossResetIntervals.push(setInterval(() => { state.losses.weekly = 0; }, 7 * 24 * 60 * 60 * 1000));
  }

  function runMonitoringCheck(): void {
    if (!cfg.enabled || state.tripped) return;
    const tripEvent = checkAllConditions();
    if (tripEvent) tripBreaker(tripEvent);
  }

  Object.assign(emitter, {
    canTrade(platform?: string, marketId?: string): boolean {
      if (!cfg.enabled) return true;
      if (state.tripped) return false;

      if (platform && marketId) {
        const key = `${platform}:${marketId}`;
        if (marketTrips.has(key)) return false;
      }

      const tripEvent = checkAllConditions(platform, marketId);
      if (tripEvent) {
        if (tripEvent.scope === 'market' && platform && marketId) {
          marketTrips.set(`${platform}:${marketId}`, tripEvent);
          emitter.emit('warning', tripEvent.condition, tripEvent.details);
          return false;
        }
        tripBreaker(tripEvent);
        return false;
      }
      return true;
    },

    checkCondition(condition: TripCondition, platform?: string, marketId?: string) {
      return checkConditionInternal(condition, platform, marketId);
    },

    recordTrade(result: { success: boolean; pnl?: number }): void {
      if (result.success) {
        state.consecutiveFailures = 0;
      } else {
        state.consecutiveFailures++;
      }

      if (result.pnl !== undefined && result.pnl < 0) {
        const lossPct = Math.abs(result.pnl);
        state.losses.hourly -= lossPct;
        state.losses.daily -= lossPct;
        state.losses.weekly -= lossPct;
      }

      if (!state.tripped) {
        const tripEvent = checkAllConditions();
        if (tripEvent) tripBreaker(tripEvent);
      }
    },

    trip(reason: string): void {
      const event: TripEvent = {
        condition: { type: 'manual', reason },
        timestamp: new Date(),
        details: { reason },
        scope: 'global',
      };
      tripBreaker(event);
    },

    reset(): void {
      resetBreaker(true);
      marketTrips.clear();
    },

    getState(): CircuitBreakerState {
      return { ...state, tripHistory: [...state.tripHistory] };
    },

    updateConfig(newConfig: Partial<CircuitBreakerConfig>): void {
      cfg = { ...cfg, ...newConfig };
      logger.info({ config: cfg }, 'Circuit breaker config updated');
    },

    startMonitoring(): void {
      if (monitoringInterval) return;
      setupLossResets();
      monitoringInterval = setInterval(runMonitoringCheck, cfg.checkIntervalMs);
      logger.info({ intervalMs: cfg.checkIntervalMs }, 'Circuit breaker monitoring started');
    },

    stopMonitoring(): void {
      if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
      }
      for (const interval of lossResetIntervals) clearInterval(interval);
      lossResetIntervals = [];
      logger.info('Circuit breaker monitoring stopped');
    },
  } as Partial<CircuitBreaker>);

  return emitter;
}

// =============================================================================
// PRESETS
// =============================================================================

export const CONSERVATIVE_CONFIG: CircuitBreakerConfig = {
  conditions: [
    { type: 'volatility', maxVolatilityPct: 5, scope: 'global' },
    { type: 'liquidity', minLiquidityScore: 0.4, scope: 'market' },
    { type: 'loss', maxLossPct: 3, window: 'daily' },
    { type: 'failures', maxConsecutive: 3 },
    { type: 'spread', maxSpreadPct: 2, scope: 'market' },
  ],
  cooldownMs: 600000,
  autoReset: false,
};

export const MODERATE_CONFIG: CircuitBreakerConfig = {
  conditions: [
    { type: 'volatility', maxVolatilityPct: 10, scope: 'global' },
    { type: 'liquidity', minLiquidityScore: 0.3, scope: 'market' },
    { type: 'loss', maxLossPct: 5, window: 'daily' },
    { type: 'failures', maxConsecutive: 5 },
    { type: 'spread', maxSpreadPct: 3, scope: 'market' },
  ],
  cooldownMs: 300000,
  autoReset: true,
};

export const AGGRESSIVE_CONFIG: CircuitBreakerConfig = {
  conditions: [
    { type: 'volatility', maxVolatilityPct: 20, scope: 'global' },
    { type: 'loss', maxLossPct: 10, window: 'daily' },
    { type: 'failures', maxConsecutive: 10 },
  ],
  cooldownMs: 60000,
  autoReset: true,
};
