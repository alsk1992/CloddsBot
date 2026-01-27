/**
 * Model Failover - Automatic fallback when primary model fails
 *
 * Features:
 * - Primary/fallback model chains
 * - Circuit breaker pattern (track failures)
 * - Auto-recovery after cooldown
 * - Per-model rate limit tracking
 */

import { logger } from '../utils/logger';

/** Model status */
interface ModelStatus {
  name: string;
  available: boolean;
  failureCount: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  cooldownUntil?: Date;
}

/** Failover configuration */
export interface FailoverConfig {
  /** Primary model */
  primary: string;
  /** Fallback models in order of preference */
  fallbacks: string[];
  /** Number of failures before circuit opens */
  failureThreshold?: number;
  /** Cooldown period in ms after circuit opens */
  cooldownMs?: number;
  /** Reset failure count after this many successes */
  successResetThreshold?: number;
}

const DEFAULT_CONFIG: Required<Omit<FailoverConfig, 'primary' | 'fallbacks'>> = {
  failureThreshold: 3,
  cooldownMs: 60000, // 1 minute
  successResetThreshold: 2,
};

export interface ModelFailover {
  /** Get the current best available model */
  getModel(): string;

  /** Report a successful call */
  reportSuccess(model: string): void;

  /** Report a failed call */
  reportFailure(model: string, error?: Error): void;

  /** Check if a specific model is available */
  isAvailable(model: string): boolean;

  /** Get status of all models */
  getStatus(): ModelStatus[];

  /** Force reset a model's circuit breaker */
  reset(model: string): void;

  /** Reset all circuit breakers */
  resetAll(): void;
}

export function createModelFailover(configInput: FailoverConfig): ModelFailover {
  const config = {
    ...DEFAULT_CONFIG,
    ...configInput,
  };

  // All models in preference order
  const allModels = [config.primary, ...config.fallbacks];

  // Model status tracking
  const statuses = new Map<string, ModelStatus>();

  // Initialize statuses
  for (const model of allModels) {
    statuses.set(model, {
      name: model,
      available: true,
      failureCount: 0,
    });
  }

  function checkCooldown(status: ModelStatus): boolean {
    if (!status.cooldownUntil) return true;

    if (new Date() > status.cooldownUntil) {
      // Cooldown expired, reset circuit breaker
      status.available = true;
      status.failureCount = 0;
      status.cooldownUntil = undefined;
      logger.info({ model: status.name }, 'Model cooldown expired, circuit closed');
      return true;
    }

    return false;
  }

  const failover: ModelFailover = {
    getModel(): string {
      // Find first available model
      for (const model of allModels) {
        const status = statuses.get(model)!;

        // Check cooldown
        checkCooldown(status);

        if (status.available) {
          return model;
        }
      }

      // All models unavailable - return primary anyway (may have recovered)
      logger.warn('All models unavailable, returning primary');
      return config.primary;
    },

    reportSuccess(model: string) {
      const status = statuses.get(model);
      if (!status) {
        logger.warn({ model }, 'Unknown model in success report');
        return;
      }

      status.lastSuccess = new Date();

      // Decrement failure count on success
      if (status.failureCount > 0) {
        status.failureCount = Math.max(0, status.failureCount - 1);
      }

      // Reset circuit if enough successes
      if (status.failureCount === 0 && !status.available) {
        status.available = true;
        status.cooldownUntil = undefined;
        logger.info({ model }, 'Model recovered, circuit closed');
      }
    },

    reportFailure(model: string, error?: Error) {
      const status = statuses.get(model);
      if (!status) {
        logger.warn({ model }, 'Unknown model in failure report');
        return;
      }

      status.failureCount++;
      status.lastFailure = new Date();

      logger.warn(
        {
          model,
          failureCount: status.failureCount,
          threshold: config.failureThreshold,
          error: error?.message,
        },
        'Model failure reported'
      );

      // Open circuit breaker if threshold reached
      if (status.failureCount >= config.failureThreshold) {
        status.available = false;
        status.cooldownUntil = new Date(Date.now() + config.cooldownMs);

        logger.warn(
          {
            model,
            cooldownUntil: status.cooldownUntil,
          },
          'Model circuit breaker opened'
        );
      }
    },

    isAvailable(model: string): boolean {
      const status = statuses.get(model);
      if (!status) return false;

      checkCooldown(status);
      return status.available;
    },

    getStatus(): ModelStatus[] {
      // Update cooldowns before returning
      for (const status of statuses.values()) {
        checkCooldown(status);
      }

      return Array.from(statuses.values());
    },

    reset(model: string) {
      const status = statuses.get(model);
      if (!status) return;

      status.available = true;
      status.failureCount = 0;
      status.cooldownUntil = undefined;
      logger.info({ model }, 'Model circuit breaker manually reset');
    },

    resetAll() {
      for (const status of statuses.values()) {
        status.available = true;
        status.failureCount = 0;
        status.cooldownUntil = undefined;
      }
      logger.info('All model circuit breakers reset');
    },
  };

  return failover;
}

/** Default failover chain for Claude models */
export const DEFAULT_CLAUDE_FAILOVER: FailoverConfig = {
  primary: 'claude-sonnet-4-20250514',
  fallbacks: [
    'claude-haiku-3-5-20250514',
    'claude-opus-4-5-20250514',
  ],
  failureThreshold: 3,
  cooldownMs: 60000,
};
