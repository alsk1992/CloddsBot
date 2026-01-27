/**
 * Retry Infrastructure - Clawdbot-style exponential backoff with jitter
 *
 * Features:
 * - Exponential backoff with configurable min/max delays
 * - Jitter support to prevent thundering herd
 * - Custom retry predicates per error type
 * - Server-provided retry-after extraction
 * - Per-provider retry policies
 * - onRetry callbacks for observability
 */

import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Minimum delay in ms (default: 500) */
  minDelay?: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelay?: number;
  /** Jitter factor 0-1 (default: 0.1 = ±10%) */
  jitter?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Custom predicate to determine if error is retryable */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** Extract retry-after from error/response (returns ms) */
  extractRetryAfter?: (error: Error) => number | null;
  /** Callback on each retry attempt */
  onRetry?: (info: RetryInfo) => void;
  /** Timeout per attempt in ms */
  timeout?: number;
}

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  delay: number;
  error: Error;
  willRetry: boolean;
}

export interface RetryPolicy {
  name: string;
  config: RetryConfig;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export class RetryableError extends Error {
  readonly retryable = true;
  readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'RetryableError';
    this.retryAfter = retryAfter;
  }
}

export class RateLimitError extends RetryableError {
  readonly statusCode: number;

  constructor(message: string, statusCode = 429, retryAfter?: number) {
    super(message, retryAfter);
    this.name = 'RateLimitError';
    this.statusCode = statusCode;
  }
}

export class TransientError extends RetryableError {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'TransientError';
    this.statusCode = statusCode;
  }
}

export class NonRetryableError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

// =============================================================================
// DEFAULT RETRY PREDICATE
// =============================================================================

/**
 * Default retry predicate - determines if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  // Explicitly marked retryable/non-retryable
  if ('retryable' in error) {
    return (error as RetryableError).retryable;
  }

  // Network errors
  if (error.name === 'FetchError' || error.name === 'AbortError') {
    return true;
  }

  // Check error message for common transient patterns
  const message = error.message.toLowerCase();
  const transientPatterns = [
    'econnreset',
    'econnrefused',
    'etimedout',
    'socket hang up',
    'network error',
    'failed to fetch',
    'connection reset',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
    '429',
    '500',
    '502',
    '503',
    '504',
  ];

  return transientPatterns.some(pattern => message.includes(pattern));
}

/**
 * Extract retry-after from common error patterns
 */
export function extractRetryAfterFromError(error: Error): number | null {
  // Check for explicit retryAfter property
  if ('retryAfter' in error && typeof (error as RetryableError).retryAfter === 'number') {
    return (error as RetryableError).retryAfter!;
  }

  // Check error message for retry-after hints
  const message = error.message;

  // Pattern: "retry after X seconds" or "retry_after: X"
  const retryMatch = message.match(/retry[_\s-]?after[:\s]+(\d+)/i);
  if (retryMatch) {
    const value = parseInt(retryMatch[1], 10);
    // Assume seconds if small, ms if large
    return value < 1000 ? value * 1000 : value;
  }

  // Telegram-style: "Too Many Requests: retry after 35"
  const telegramMatch = message.match(/retry after (\d+)/i);
  if (telegramMatch) {
    return parseInt(telegramMatch[1], 10) * 1000;
  }

  return null;
}

// =============================================================================
// DELAY CALCULATION
// =============================================================================

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateDelay(
  attempt: number,
  config: Required<Pick<RetryConfig, 'minDelay' | 'maxDelay' | 'jitter' | 'backoffMultiplier'>>
): number {
  // Exponential backoff: minDelay * (multiplier ^ attempt)
  const exponentialDelay = config.minDelay * Math.pow(config.backoffMultiplier, attempt - 1);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelay);

  // Apply jitter (±jitter%)
  const jitterRange = cappedDelay * config.jitter;
  const jitter = (Math.random() * 2 - 1) * jitterRange;

  return Math.round(cappedDelay + jitter);
}

/**
 * Sleep for specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// RETRY EXECUTOR
// =============================================================================

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    minDelay = 500,
    maxDelay = 30000,
    jitter = 0.1,
    backoffMultiplier = 2,
    shouldRetry = isRetryableError,
    extractRetryAfter = extractRetryAfterFromError,
    onRetry,
    timeout,
  } = config;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Execute with optional timeout
      if (timeout) {
        return await withTimeout(fn(), timeout);
      }
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const willRetry = attempt < maxAttempts && shouldRetry(lastError, attempt);

      // Calculate delay
      let delay: number;
      const serverRetryAfter = extractRetryAfter(lastError);
      if (serverRetryAfter !== null) {
        // Use server-provided retry-after
        delay = Math.min(serverRetryAfter, maxDelay);
      } else {
        delay = calculateDelay(attempt, { minDelay, maxDelay, jitter, backoffMultiplier });
      }

      // Notify via callback
      const retryInfo: RetryInfo = {
        attempt,
        maxAttempts,
        delay,
        error: lastError,
        willRetry,
      };

      if (onRetry) {
        onRetry(retryInfo);
      }

      logger.debug({
        attempt,
        maxAttempts,
        delay,
        willRetry,
        error: lastError.message,
      }, 'Retry attempt');

      if (!willRetry) {
        break;
      }

      // Wait before retry
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Execute with timeout
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TransientError(`Operation timed out after ${ms}ms`));
    }, ms);

    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

// =============================================================================
// PRE-BUILT RETRY POLICIES
// =============================================================================

export const RETRY_POLICIES: Record<string, RetryPolicy> = {
  /** Default policy for most APIs */
  default: {
    name: 'default',
    config: {
      maxAttempts: 3,
      minDelay: 500,
      maxDelay: 30000,
      jitter: 0.1,
      backoffMultiplier: 2,
    },
  },

  /** Conservative policy for rate-limited APIs */
  conservative: {
    name: 'conservative',
    config: {
      maxAttempts: 5,
      minDelay: 1000,
      maxDelay: 60000,
      jitter: 0.2,
      backoffMultiplier: 2,
    },
  },

  /** Aggressive policy for critical operations */
  aggressive: {
    name: 'aggressive',
    config: {
      maxAttempts: 10,
      minDelay: 100,
      maxDelay: 10000,
      jitter: 0.1,
      backoffMultiplier: 1.5,
    },
  },

  /** Discord API policy */
  discord: {
    name: 'discord',
    config: {
      maxAttempts: 3,
      minDelay: 500,
      maxDelay: 30000,
      jitter: 0.1,
      backoffMultiplier: 2,
      shouldRetry: (error) => {
        const msg = error.message.toLowerCase();
        // Discord-specific retryable errors
        return msg.includes('429') ||
               msg.includes('500') ||
               msg.includes('502') ||
               msg.includes('503') ||
               msg.includes('504') ||
               isRetryableError(error);
      },
    },
  },

  /** Telegram API policy */
  telegram: {
    name: 'telegram',
    config: {
      maxAttempts: 3,
      minDelay: 400,
      maxDelay: 30000,
      jitter: 0.1,
      backoffMultiplier: 2,
      shouldRetry: (error) => {
        const msg = error.message;
        // Telegram-specific retry patterns
        return /retry after \d+/i.test(msg) ||
               /flood/i.test(msg) ||
               isRetryableError(error);
      },
      extractRetryAfter: (error) => {
        // Telegram format: "Too Many Requests: retry after 35"
        const match = error.message.match(/retry after (\d+)/i);
        if (match) {
          return parseInt(match[1], 10) * 1000;
        }
        return extractRetryAfterFromError(error);
      },
    },
  },

  /** OpenAI API policy */
  openai: {
    name: 'openai',
    config: {
      maxAttempts: 3,
      minDelay: 500,
      maxDelay: 60000,
      jitter: 0.1,
      backoffMultiplier: 2,
      shouldRetry: (error) => {
        const msg = error.message.toLowerCase();
        // OpenAI-specific
        return msg.includes('rate limit') ||
               msg.includes('overloaded') ||
               msg.includes('capacity') ||
               isRetryableError(error);
      },
    },
  },

  /** Anthropic API policy */
  anthropic: {
    name: 'anthropic',
    config: {
      maxAttempts: 3,
      minDelay: 500,
      maxDelay: 60000,
      jitter: 0.1,
      backoffMultiplier: 2,
      shouldRetry: (error) => {
        const msg = error.message.toLowerCase();
        // Anthropic-specific
        return msg.includes('overloaded') ||
               msg.includes('rate limit') ||
               isRetryableError(error);
      },
    },
  },
};

/**
 * Get retry policy by name
 */
export function getRetryPolicy(name: string): RetryPolicy {
  return RETRY_POLICIES[name] || RETRY_POLICIES.default;
}

// =============================================================================
// FETCH WITH RETRY
// =============================================================================

export interface FetchWithRetryOptions extends RetryConfig {
  /** Parse response as JSON */
  json?: boolean;
  /** Extract retry-after from response headers */
  parseHeaders?: boolean;
}

/**
 * Fetch with automatic retry on transient errors
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const { json = false, parseHeaders = true, ...retryConfig } = options;

  return withRetry(async () => {
    const response = await fetch(url, init);

    // Check for retryable status codes
    if (!response.ok) {
      const statusCode = response.status;

      // Rate limit
      if (statusCode === 429) {
        let retryAfter: number | undefined;
        if (parseHeaders) {
          const retryAfterHeader = response.headers.get('retry-after');
          if (retryAfterHeader) {
            // Can be seconds or HTTP-date
            const parsed = parseInt(retryAfterHeader, 10);
            retryAfter = isNaN(parsed) ? undefined : parsed * 1000;
          }
        }
        throw new RateLimitError(`Rate limited: ${statusCode}`, statusCode, retryAfter);
      }

      // Server errors (5xx) are transient
      if (statusCode >= 500) {
        throw new TransientError(`Server error: ${statusCode}`, statusCode);
      }

      // Client errors (4xx except 429) are not retryable
      if (statusCode >= 400) {
        const body = await response.text();
        throw new NonRetryableError(`Request failed: ${statusCode} - ${body}`);
      }
    }

    return response;
  }, {
    ...retryConfig,
    onRetry: (info) => {
      logger.warn({
        url,
        attempt: info.attempt,
        maxAttempts: info.maxAttempts,
        delay: info.delay,
        error: info.error.message,
      }, 'Fetch retry');
      retryConfig.onRetry?.(info);
    },
  });
}

/**
 * Fetch JSON with retry
 */
export async function fetchJsonWithRetry<T>(
  url: string,
  init?: RequestInit,
  options: FetchWithRetryOptions = {}
): Promise<T> {
  const response = await fetchWithRetry(url, init, options);
  return response.json() as Promise<T>;
}

// =============================================================================
// RETRY WRAPPER FACTORY
// =============================================================================

/**
 * Create a retry wrapper with pre-configured options
 */
export function createRetryWrapper(defaultConfig: RetryConfig = {}) {
  return {
    /**
     * Execute function with retry
     */
    async execute<T>(fn: () => Promise<T>, config?: RetryConfig): Promise<T> {
      return withRetry(fn, { ...defaultConfig, ...config });
    },

    /**
     * Fetch with retry
     */
    async fetch(url: string, init?: RequestInit, config?: FetchWithRetryOptions): Promise<Response> {
      return fetchWithRetry(url, init, { ...defaultConfig, ...config });
    },

    /**
     * Fetch JSON with retry
     */
    async fetchJson<T>(url: string, init?: RequestInit, config?: FetchWithRetryOptions): Promise<T> {
      return fetchJsonWithRetry<T>(url, init, { ...defaultConfig, ...config });
    },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export const retry = {
  withRetry,
  withTimeout,
  fetchWithRetry,
  fetchJsonWithRetry,
  createWrapper: createRetryWrapper,
  policies: RETRY_POLICIES,
  getPolicy: getRetryPolicy,
  calculateDelay,
  sleep,
  isRetryable: isRetryableError,
  extractRetryAfter: extractRetryAfterFromError,
};
