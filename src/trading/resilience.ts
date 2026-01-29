/**
 * Trading Resilience - Retry logic, reconnection, and error recovery
 *
 * Features:
 * - Exponential backoff retry
 * - Connection health monitoring
 * - Automatic reconnection
 * - Rate limit awareness
 * - Graceful degradation
 */

import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface RetryConfig {
  /** Max retry attempts */
  maxRetries: number;
  /** Initial delay in ms */
  initialDelayMs: number;
  /** Max delay in ms */
  maxDelayMs: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Jitter factor (0-1) */
  jitterFactor: number;
  /** Retryable error codes */
  retryableErrors: string[];
  /** Timeout per attempt */
  timeoutMs: number;
}

export interface RateLimitState {
  /** Requests made in current window */
  requests: number;
  /** Window start time */
  windowStart: Date;
  /** Remaining requests */
  remaining: number;
  /** When limit resets */
  resetAt?: Date;
  /** Is currently rate limited */
  isLimited: boolean;
}

export interface HealthState {
  /** Is connection healthy */
  healthy: boolean;
  /** Last successful request */
  lastSuccess?: Date;
  /** Last error */
  lastError?: { message: string; at: Date };
  /** Consecutive failures */
  consecutiveFailures: number;
  /** Latency (ms) */
  latencyMs?: number;
}

export interface ResilientExecutor {
  /** Execute with retry logic */
  execute<T>(
    fn: () => Promise<T>,
    options?: Partial<RetryConfig>
  ): Promise<T>;

  /** Execute with timeout */
  withTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T>;

  /** Check rate limit before request */
  checkRateLimit(key: string): { allowed: boolean; waitMs?: number };

  /** Record a request (for rate limiting) */
  recordRequest(key: string, success: boolean): void;

  /** Get health state */
  getHealth(key?: string): HealthState;

  /** Reset health state */
  resetHealth(key: string): void;

  /** Get rate limit state */
  getRateLimitState(key: string): RateLimitState;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'RATE_LIMITED',
    '429',
    '500',
    '502',
    '503',
    '504',
  ],
  timeoutMs: 30000,
};

// Rate limits per platform (requests per minute)
const PLATFORM_RATE_LIMITS: Record<string, { rpm: number; burstLimit: number }> = {
  polymarket: { rpm: 60, burstLimit: 10 },
  kalshi: { rpm: 30, burstLimit: 5 },
  manifold: { rpm: 60, burstLimit: 10 },
  default: { rpm: 60, burstLimit: 10 },
};

export function createResilientExecutor(defaultConfig?: Partial<RetryConfig>): ResilientExecutor {
  const config = { ...DEFAULT_RETRY_CONFIG, ...defaultConfig };
  const healthStates = new Map<string, HealthState>();
  const rateLimitStates = new Map<string, RateLimitState>();

  function calculateDelay(attempt: number): number {
    // Exponential backoff with jitter
    const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
    const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
    const jitter = cappedDelay * config.jitterFactor * (Math.random() * 2 - 1);
    return Math.max(0, cappedDelay + jitter);
  }

  function isRetryableError(error: unknown): boolean {
    if (!error) return false;

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as any)?.code || (error as any)?.status;

    // Check error codes
    for (const retryable of config.retryableErrors) {
      if (errorCode?.toString() === retryable) return true;
      if (errorMessage.includes(retryable)) return true;
    }

    // Network errors
    if (errorMessage.includes('fetch failed')) return true;
    if (errorMessage.includes('network')) return true;
    if (errorMessage.includes('timeout')) return true;

    return false;
  }

  function getHealthState(key: string): HealthState {
    let state = healthStates.get(key);
    if (!state) {
      state = {
        healthy: true,
        consecutiveFailures: 0,
      };
      healthStates.set(key, state);
    }
    return state;
  }

  function getRateLimitStateInternal(key: string): RateLimitState {
    let state = rateLimitStates.get(key);
    const now = new Date();

    if (!state) {
      state = {
        requests: 0,
        windowStart: now,
        remaining: PLATFORM_RATE_LIMITS[key]?.rpm || PLATFORM_RATE_LIMITS.default.rpm,
        isLimited: false,
      };
      rateLimitStates.set(key, state);
    }

    // Reset window if expired (1 minute)
    const windowMs = 60 * 1000;
    if (now.getTime() - state.windowStart.getTime() > windowMs) {
      state.requests = 0;
      state.windowStart = now;
      state.remaining = PLATFORM_RATE_LIMITS[key]?.rpm || PLATFORM_RATE_LIMITS.default.rpm;
      state.isLimited = false;
      state.resetAt = undefined;
    }

    return state;
  }

  return {
    async execute<T>(fn: () => Promise<T>, options?: Partial<RetryConfig>): Promise<T> {
      const cfg = { ...config, ...options };
      let lastError: unknown;

      for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
        try {
          // Execute with timeout
          const result = await this.withTimeout(fn, cfg.timeoutMs);
          return result;
        } catch (error) {
          lastError = error;

          // Check if retryable
          if (!isRetryableError(error) || attempt === cfg.maxRetries) {
            throw error;
          }

          // Calculate delay
          const delayMs = calculateDelay(attempt);

          logger.warn(
            {
              attempt: attempt + 1,
              maxRetries: cfg.maxRetries,
              delayMs,
              error: error instanceof Error ? error.message : String(error),
            },
            'Retrying after error'
          );

          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      throw lastError;
    },

    async withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
      return Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    },

    checkRateLimit(key: string) {
      const state = getRateLimitStateInternal(key);
      const limits = PLATFORM_RATE_LIMITS[key] || PLATFORM_RATE_LIMITS.default;

      // Check burst limit
      if (state.requests >= limits.burstLimit) {
        // Need to wait for window reset
        const windowMs = 60 * 1000;
        const waitMs = windowMs - (Date.now() - state.windowStart.getTime());
        return { allowed: false, waitMs: Math.max(0, waitMs) };
      }

      // Check RPM limit
      if (state.remaining <= 0) {
        state.isLimited = true;
        const waitMs = state.resetAt
          ? Math.max(0, state.resetAt.getTime() - Date.now())
          : 60 * 1000;
        return { allowed: false, waitMs };
      }

      return { allowed: true };
    },

    recordRequest(key: string, success: boolean) {
      const state = getRateLimitStateInternal(key);
      state.requests++;
      state.remaining = Math.max(0, state.remaining - 1);

      // Update health
      const health = getHealthState(key);
      if (success) {
        health.healthy = true;
        health.lastSuccess = new Date();
        health.consecutiveFailures = 0;
      } else {
        health.consecutiveFailures++;
        health.lastError = { message: 'Request failed', at: new Date() };
        if (health.consecutiveFailures >= 3) {
          health.healthy = false;
        }
      }
    },

    getHealth(key) {
      if (key) {
        return getHealthState(key);
      }

      // Aggregate health across all keys
      let healthy = true;
      let consecutiveFailures = 0;
      let lastSuccess: Date | undefined;
      let lastError: { message: string; at: Date } | undefined;

      for (const state of healthStates.values()) {
        if (!state.healthy) healthy = false;
        consecutiveFailures = Math.max(consecutiveFailures, state.consecutiveFailures);
        if (!lastSuccess || (state.lastSuccess && state.lastSuccess > lastSuccess)) {
          lastSuccess = state.lastSuccess;
        }
        if (!lastError || (state.lastError && state.lastError.at > lastError.at)) {
          lastError = state.lastError;
        }
      }

      return { healthy, consecutiveFailures, lastSuccess, lastError };
    },

    resetHealth(key: string) {
      healthStates.set(key, {
        healthy: true,
        consecutiveFailures: 0,
      });
    },

    getRateLimitState(key: string) {
      return getRateLimitStateInternal(key);
    },
  };
}

// =============================================================================
// RETRY DECORATORS
// =============================================================================

/**
 * Wrap a function with retry logic
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config?: Partial<RetryConfig>
): T {
  const executor = createResilientExecutor(config);

  return (async (...args: Parameters<T>) => {
    return executor.execute(() => fn(...args));
  }) as T;
}

/**
 * Wrap a function with rate limiting
 */
export function withRateLimit<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  key: string,
  executor?: ResilientExecutor
): T {
  const exec = executor || createResilientExecutor();

  return (async (...args: Parameters<T>) => {
    const check = exec.checkRateLimit(key);

    if (!check.allowed && check.waitMs) {
      logger.debug({ key, waitMs: check.waitMs }, 'Rate limit - waiting');
      await new Promise((resolve) => setTimeout(resolve, check.waitMs));
    }

    try {
      const result = await fn(...args);
      exec.recordRequest(key, true);
      return result;
    } catch (error) {
      exec.recordRequest(key, false);
      throw error;
    }
  }) as T;
}
