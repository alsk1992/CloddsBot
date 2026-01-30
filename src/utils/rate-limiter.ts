/**
 * API Rate Limit Tracking
 *
 * Tracks API usage per endpoint and enforces rate limits.
 * Supports multiple strategies: sliding window, token bucket.
 */

import { logger } from './logger';

// =============================================================================
// TYPES
// =============================================================================

export interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in ms (default: 60000 = 1 minute) */
  windowMs: number;
  /** Strategy: 'sliding' or 'token_bucket' (default: 'sliding') */
  strategy?: 'sliding' | 'token_bucket';
  /** Token refill rate per second (for token bucket) */
  refillRate?: number;
  /** Retry after delay in ms (default: 1000) */
  retryAfterMs?: number;
}

export interface RateLimitStatus {
  /** Remaining requests in current window */
  remaining: number;
  /** When the limit resets (ms since epoch) */
  resetAt: number;
  /** Whether currently limited */
  isLimited: boolean;
  /** Time until reset in ms */
  retryAfterMs: number;
}

export interface EndpointStats {
  /** Total requests made */
  totalRequests: number;
  /** Requests in current window */
  windowRequests: number;
  /** Times rate limited */
  timesLimited: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** Error count */
  errorCount: number;
  /** Last request time */
  lastRequestAt: number;
}

export interface RateLimiter {
  /** Check if request can be made */
  canRequest(endpoint: string): boolean;

  /** Record a request (returns true if allowed) */
  recordRequest(endpoint: string): boolean;

  /** Record request completion with latency */
  recordComplete(endpoint: string, latencyMs: number, success: boolean): void;

  /** Get current limit status for endpoint */
  getStatus(endpoint: string): RateLimitStatus;

  /** Get stats for endpoint */
  getStats(endpoint: string): EndpointStats;

  /** Get all endpoint stats */
  getAllStats(): Map<string, EndpointStats>;

  /** Wait until request can be made */
  waitForSlot(endpoint: string): Promise<void>;

  /** Set config for specific endpoint */
  setEndpointConfig(endpoint: string, config: Partial<RateLimitConfig>): void;

  /** Clear all tracking data */
  reset(): void;
}

// =============================================================================
// DEFAULT RATE LIMITS BY PLATFORM
// =============================================================================

export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Polymarket
  'polymarket:clob': { maxRequests: 100, windowMs: 60000 },
  'polymarket:gamma': { maxRequests: 60, windowMs: 60000 },
  'polymarket:order': { maxRequests: 10, windowMs: 1000 },

  // Kalshi
  'kalshi:api': { maxRequests: 100, windowMs: 60000 },
  'kalshi:order': { maxRequests: 10, windowMs: 1000 },
  'kalshi:ws': { maxRequests: 5, windowMs: 1000 },

  // Manifold
  'manifold:api': { maxRequests: 100, windowMs: 60000 },

  // Betfair
  'betfair:api': { maxRequests: 20, windowMs: 1000 },
  'betfair:exchange': { maxRequests: 5, windowMs: 1000 },

  // Smarkets
  'smarkets:api': { maxRequests: 60, windowMs: 60000 },

  // Drift
  'drift:api': { maxRequests: 30, windowMs: 60000 },

  // Default for unknown endpoints
  'default': { maxRequests: 60, windowMs: 60000 },
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

interface WindowEntry {
  timestamp: number;
  latencyMs?: number;
  success?: boolean;
}

interface EndpointState {
  requests: WindowEntry[];
  config: RateLimitConfig;
  stats: EndpointStats;
}

export function createRateLimiter(
  defaultConfig: Partial<RateLimitConfig> = {}
): RateLimiter {
  const baseConfig: RateLimitConfig = {
    maxRequests: 60,
    windowMs: 60000,
    strategy: 'sliding',
    retryAfterMs: 1000,
    ...defaultConfig,
  };

  const endpoints = new Map<string, EndpointState>();

  /**
   * Get or create endpoint state
   */
  function getEndpoint(endpoint: string): EndpointState {
    let state = endpoints.get(endpoint);

    if (!state) {
      // Find matching config from defaults
      const defaultLimit = DEFAULT_RATE_LIMITS[endpoint] || DEFAULT_RATE_LIMITS['default'];
      // User config (baseConfig) takes precedence over defaults
      const config = { ...defaultLimit, ...baseConfig };

      state = {
        requests: [],
        config,
        stats: {
          totalRequests: 0,
          windowRequests: 0,
          timesLimited: 0,
          avgLatencyMs: 0,
          errorCount: 0,
          lastRequestAt: 0,
        },
      };

      endpoints.set(endpoint, state);
    }

    return state;
  }

  /**
   * Clean old requests from window
   */
  function cleanWindow(state: EndpointState): void {
    const now = Date.now();
    const cutoff = now - state.config.windowMs;
    state.requests = state.requests.filter((r) => r.timestamp > cutoff);
    state.stats.windowRequests = state.requests.length;
  }

  /**
   * Check if request can be made
   */
  function canRequest(endpoint: string): boolean {
    const state = getEndpoint(endpoint);
    cleanWindow(state);
    return state.requests.length < state.config.maxRequests;
  }

  /**
   * Record a request
   */
  function recordRequest(endpoint: string): boolean {
    const state = getEndpoint(endpoint);
    cleanWindow(state);

    if (state.requests.length >= state.config.maxRequests) {
      state.stats.timesLimited++;
      logger.warn(
        {
          endpoint,
          current: state.requests.length,
          max: state.config.maxRequests,
        },
        'Rate limit exceeded'
      );
      return false;
    }

    state.requests.push({ timestamp: Date.now() });
    state.stats.totalRequests++;
    state.stats.windowRequests = state.requests.length;
    state.stats.lastRequestAt = Date.now();

    return true;
  }

  /**
   * Record request completion
   */
  function recordComplete(endpoint: string, latencyMs: number, success: boolean): void {
    const state = getEndpoint(endpoint);

    // Update latency average (exponential moving average)
    const alpha = 0.2;
    if (state.stats.avgLatencyMs === 0) {
      state.stats.avgLatencyMs = latencyMs;
    } else {
      state.stats.avgLatencyMs = alpha * latencyMs + (1 - alpha) * state.stats.avgLatencyMs;
    }

    if (!success) {
      state.stats.errorCount++;
    }

    // Update latest request with latency info
    const latest = state.requests[state.requests.length - 1];
    if (latest) {
      latest.latencyMs = latencyMs;
      latest.success = success;
    }
  }

  /**
   * Get current limit status
   */
  function getStatus(endpoint: string): RateLimitStatus {
    const state = getEndpoint(endpoint);
    cleanWindow(state);

    const remaining = Math.max(0, state.config.maxRequests - state.requests.length);
    const isLimited = remaining === 0;

    // Calculate reset time
    const oldestRequest = state.requests[0];
    const resetAt = oldestRequest
      ? oldestRequest.timestamp + state.config.windowMs
      : Date.now();

    return {
      remaining,
      resetAt,
      isLimited,
      retryAfterMs: isLimited ? Math.max(0, resetAt - Date.now()) : 0,
    };
  }

  /**
   * Get stats for endpoint
   */
  function getStats(endpoint: string): EndpointStats {
    const state = getEndpoint(endpoint);
    cleanWindow(state);
    return { ...state.stats };
  }

  /**
   * Get all endpoint stats
   */
  function getAllStats(): Map<string, EndpointStats> {
    const result = new Map<string, EndpointStats>();

    for (const [endpoint, state] of endpoints) {
      cleanWindow(state);
      result.set(endpoint, { ...state.stats });
    }

    return result;
  }

  /**
   * Wait until request can be made
   */
  async function waitForSlot(endpoint: string): Promise<void> {
    const status = getStatus(endpoint);

    if (!status.isLimited) {
      return;
    }

    const waitTime = Math.max(status.retryAfterMs, getEndpoint(endpoint).config.retryAfterMs || 1000);

    logger.debug({ endpoint, waitTime }, 'Waiting for rate limit slot');

    await new Promise((resolve) => setTimeout(resolve, waitTime));

    // Recursive check in case still limited
    if (!canRequest(endpoint)) {
      await waitForSlot(endpoint);
    }
  }

  /**
   * Set config for specific endpoint
   */
  function setEndpointConfig(endpoint: string, config: Partial<RateLimitConfig>): void {
    const state = getEndpoint(endpoint);
    state.config = { ...state.config, ...config };
  }

  /**
   * Reset all tracking
   */
  function reset(): void {
    endpoints.clear();
  }

  return {
    canRequest,
    recordRequest,
    recordComplete,
    getStatus,
    getStats,
    getAllStats,
    waitForSlot,
    setEndpointConfig,
    reset,
  };
}

// =============================================================================
// GLOBAL RATE LIMITER
// =============================================================================

let globalRateLimiter: RateLimiter | null = null;

export function getGlobalRateLimiter(): RateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = createRateLimiter();
  }
  return globalRateLimiter;
}

// =============================================================================
// RATE-LIMITED FETCH HELPER
// =============================================================================

export interface RateLimitedFetchOptions extends RequestInit {
  /** Endpoint key for rate limiting */
  endpoint: string;
  /** Whether to wait if rate limited (default: true) */
  waitIfLimited?: boolean;
  /** Max retries on rate limit (default: 3) */
  maxRetries?: number;
}

/**
 * Fetch with automatic rate limiting
 */
export async function rateLimitedFetch(
  url: string,
  options: RateLimitedFetchOptions
): Promise<Response> {
  const { endpoint, waitIfLimited = true, maxRetries = 3, ...fetchOptions } = options;
  const limiter = getGlobalRateLimiter();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check rate limit
    if (!limiter.canRequest(endpoint)) {
      if (!waitIfLimited) {
        throw new Error(`Rate limited for endpoint: ${endpoint}`);
      }

      if (attempt >= maxRetries) {
        throw new Error(`Rate limit exceeded after ${maxRetries} retries for endpoint: ${endpoint}`);
      }

      await limiter.waitForSlot(endpoint);
    }

    // Record request
    limiter.recordRequest(endpoint);

    const startTime = Date.now();
    try {
      const response = await fetch(url, fetchOptions);
      const latency = Date.now() - startTime;

      limiter.recordComplete(endpoint, latency, response.ok);

      // Check for rate limit response
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : limiter.getStatus(endpoint).retryAfterMs || 1000;

        logger.warn({ endpoint, waitMs, attempt }, 'Received 429, backing off');

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
      }

      return response;
    } catch (error) {
      const latency = Date.now() - startTime;
      limiter.recordComplete(endpoint, latency, false);
      throw error;
    }
  }

  throw new Error('Unreachable');
}
