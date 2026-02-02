/**
 * Production Utilities
 *
 * Health checks, error tracking, and graceful shutdown handling
 */

import { logger } from './logger';

// =============================================================================
// HEALTH CHECK
// =============================================================================

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  uptime: number;
  version: string;
  checks: {
    database: CheckResult;
    memory: CheckResult;
    externalApis?: Record<string, CheckResult>;
  };
}

export interface CheckResult {
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  latencyMs?: number;
}

const startTime = Date.now();

/**
 * Check database health
 */
export function checkDatabase(db: { query: <T>(sql: string) => T[] }): CheckResult {
  const start = Date.now();
  try {
    db.query('SELECT 1');
    return {
      status: 'pass',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      status: 'fail',
      message: err instanceof Error ? err.message : 'Database check failed',
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Check memory usage
 */
export function checkMemory(): CheckResult {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const usagePercent = (used.heapUsed / used.heapTotal) * 100;

  if (usagePercent > 90) {
    return {
      status: 'fail',
      message: `Heap usage critical: ${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercent.toFixed(1)}%)`,
    };
  }

  if (usagePercent > 75) {
    return {
      status: 'warn',
      message: `Heap usage high: ${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercent.toFixed(1)}%)`,
    };
  }

  return {
    status: 'pass',
    message: `${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercent.toFixed(1)}%)`,
  };
}

/**
 * Check external API health
 */
export async function checkExternalApi(
  name: string,
  url: string,
  timeoutMs: number = 5000
): Promise<CheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (res.ok) {
      return { status: 'pass', latencyMs };
    }

    return {
      status: 'warn',
      message: `HTTP ${res.status}`,
      latencyMs,
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      status: 'fail',
      message: err instanceof Error ? err.message : 'Request failed',
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Run full health check
 */
export async function runHealthCheck(
  db: { query: <T>(sql: string) => T[] },
  options?: {
    checkExternalApis?: boolean;
  }
): Promise<HealthStatus> {
  const dbCheck = checkDatabase(db);
  const memoryCheck = checkMemory();

  let externalApis: Record<string, CheckResult> | undefined;

  if (options?.checkExternalApis) {
    const [polymarket] = await Promise.all([
      checkExternalApi('polymarket', 'https://clob.polymarket.com/', 5000),
    ]);
    externalApis = { polymarket };
  }

  // Determine overall status
  const allChecks = [dbCheck, memoryCheck];
  if (externalApis) {
    allChecks.push(...Object.values(externalApis));
  }

  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (allChecks.some(c => c.status === 'fail')) {
    status = 'unhealthy';
  } else if (allChecks.some(c => c.status === 'warn')) {
    status = 'degraded';
  }

  return {
    status,
    timestamp: Date.now(),
    uptime: Date.now() - startTime,
    version: process.env.npm_package_version || '0.1.0',
    checks: {
      database: dbCheck,
      memory: memoryCheck,
      externalApis,
    },
  };
}

// =============================================================================
// ERROR TRACKING
// =============================================================================

interface ErrorEvent {
  timestamp: number;
  error: string;
  stack?: string;
  context?: Record<string, unknown>;
  handler?: string;
  userId?: string;
}

const recentErrors: ErrorEvent[] = [];
const MAX_RECENT_ERRORS = 100;
const errorCounts = new Map<string, number>();

/**
 * Track an error
 */
export function trackError(
  err: Error | string,
  context?: {
    handler?: string;
    userId?: string;
    extra?: Record<string, unknown>;
  }
): void {
  const error = err instanceof Error ? err : new Error(err);
  const errorKey = `${error.name}:${error.message.slice(0, 100)}`;

  // Increment error count
  errorCounts.set(errorKey, (errorCounts.get(errorKey) || 0) + 1);

  // Add to recent errors (ring buffer)
  const event: ErrorEvent = {
    timestamp: Date.now(),
    error: error.message,
    stack: error.stack,
    handler: context?.handler,
    userId: context?.userId,
    context: context?.extra,
  };

  recentErrors.push(event);
  if (recentErrors.length > MAX_RECENT_ERRORS) {
    recentErrors.shift();
  }

  // Log with structured data
  logger.error({
    err: error,
    handler: context?.handler,
    userId: context?.userId,
    ...context?.extra,
  }, 'Tracked error');
}

/**
 * Get error statistics
 */
export function getErrorStats(): {
  recentCount: number;
  topErrors: Array<{ error: string; count: number }>;
  recentErrors: ErrorEvent[];
} {
  const topErrors = Array.from(errorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([error, count]) => ({ error, count }));

  return {
    recentCount: recentErrors.length,
    topErrors,
    recentErrors: recentErrors.slice(-20),
  };
}

/**
 * Clear error stats (for testing or reset)
 */
export function clearErrorStats(): void {
  recentErrors.length = 0;
  errorCounts.clear();
}

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================

type ShutdownHandler = () => Promise<void> | void;
const shutdownHandlers: ShutdownHandler[] = [];
let isShuttingDown = false;

/**
 * Register a shutdown handler
 */
export function onShutdown(handler: ShutdownHandler): void {
  shutdownHandlers.push(handler);
}

/**
 * Perform graceful shutdown
 */
export async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress');
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, 'Starting graceful shutdown');

  const timeout = setTimeout(() => {
    logger.error('Shutdown timeout - forcing exit');
    process.exit(1);
  }, 30000); // 30s timeout

  try {
    for (const handler of shutdownHandlers) {
      try {
        await handler();
      } catch (err) {
        logger.error({ err }, 'Shutdown handler failed');
      }
    }

    clearTimeout(timeout);
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    clearTimeout(timeout);
    logger.error({ err }, 'Shutdown failed');
    process.exit(1);
  }
}

/**
 * Setup shutdown signal handlers
 */
export function setupShutdownHandlers(): void {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    trackError(err, { handler: 'uncaughtException' });
    logger.fatal({ err }, 'Uncaught exception');
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    trackError(err, { handler: 'unhandledRejection' });
    logger.error({ err }, 'Unhandled rejection');
  });
}

// =============================================================================
// REQUEST TRACKING (for rate limiting awareness)
// =============================================================================

interface RequestMetrics {
  total: number;
  byHandler: Map<string, number>;
  byUser: Map<string, number>;
  errors: number;
  lastMinute: number[];
}

const metrics: RequestMetrics = {
  total: 0,
  byHandler: new Map(),
  byUser: new Map(),
  errors: 0,
  lastMinute: [],
};

/**
 * Track a request
 */
export function trackRequest(handler: string, userId?: string): void {
  metrics.total++;
  metrics.byHandler.set(handler, (metrics.byHandler.get(handler) || 0) + 1);
  if (userId) {
    metrics.byUser.set(userId, (metrics.byUser.get(userId) || 0) + 1);
  }

  // Track requests per minute
  const now = Date.now();
  metrics.lastMinute.push(now);
  // Clean old entries
  const oneMinuteAgo = now - 60000;
  metrics.lastMinute = metrics.lastMinute.filter(t => t > oneMinuteAgo);
}

/**
 * Track a request error
 */
export function trackRequestError(): void {
  metrics.errors++;
}

/**
 * Get request metrics
 */
export function getRequestMetrics(): {
  total: number;
  errors: number;
  requestsPerMinute: number;
  topHandlers: Array<{ handler: string; count: number }>;
  topUsers: Array<{ userId: string; count: number }>;
} {
  const topHandlers = Array.from(metrics.byHandler.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([handler, count]) => ({ handler, count }));

  const topUsers = Array.from(metrics.byUser.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([userId, count]) => ({ userId, count }));

  return {
    total: metrics.total,
    errors: metrics.errors,
    requestsPerMinute: metrics.lastMinute.length,
    topHandlers,
    topUsers,
  };
}
