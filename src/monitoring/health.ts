/**
 * Health Check System
 *
 * Features:
 * - Readiness checks: Is the service ready to accept traffic?
 * - Liveness checks: Is the service alive and not stuck?
 * - Component health: Individual subsystem status
 * - Dependency health: External API/service checks
 * - Configurable timeouts and thresholds
 */

import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface ComponentHealth {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  lastCheck?: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface HealthCheckResult {
  status: HealthStatus;
  timestamp: number;
  uptime: number;
  version: string;
  components: ComponentHealth[];
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
    unknown: number;
  };
}

export interface ReadinessResult {
  ready: boolean;
  timestamp: number;
  checks: Array<{ name: string; passed: boolean; error?: string }>;
}

export interface LivenessResult {
  alive: boolean;
  timestamp: number;
  uptime: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    percent: number;
  };
  eventLoop: {
    latencyMs: number;
    healthy: boolean;
  };
}

export interface HealthCheckOptions {
  /** Timeout for individual checks in ms (default: 5000) */
  timeout?: number;
  /** Whether this check is critical for readiness (default: true) */
  critical?: boolean;
  /** Minimum interval between checks in ms (default: 0) */
  cacheMs?: number;
}

export type HealthCheckFn = () => Promise<ComponentHealth>;

// =============================================================================
// HEALTH CHECKER
// =============================================================================

export class HealthChecker {
  private checks: Map<string, { fn: HealthCheckFn; options: HealthCheckOptions; lastResult?: ComponentHealth }> = new Map();
  private readinessChecks: Map<string, { fn: () => Promise<boolean>; options: HealthCheckOptions }> = new Map();
  private startTime: number = Date.now();
  private version: string;

  constructor(version = '1.0.0') {
    this.version = version;
  }

  /**
   * Register a component health check
   */
  registerCheck(name: string, fn: HealthCheckFn, options: HealthCheckOptions = {}): void {
    this.checks.set(name, { fn, options: { timeout: 5000, critical: true, cacheMs: 0, ...options } });
  }

  /**
   * Register a readiness check
   */
  registerReadinessCheck(name: string, fn: () => Promise<boolean>, options: HealthCheckOptions = {}): void {
    this.readinessChecks.set(name, { fn, options: { timeout: 5000, critical: true, ...options } });
  }

  /**
   * Unregister a check
   */
  unregisterCheck(name: string): void {
    this.checks.delete(name);
  }

  /**
   * Unregister a readiness check
   */
  unregisterReadinessCheck(name: string): void {
    this.readinessChecks.delete(name);
  }

  /**
   * Run all health checks and return overall status
   */
  async checkHealth(): Promise<HealthCheckResult> {
    const components: ComponentHealth[] = [];
    const now = Date.now();

    for (const [name, check] of this.checks) {
      try {
        // Check cache
        if (check.lastResult && check.options.cacheMs && check.lastResult.lastCheck) {
          if (now - check.lastResult.lastCheck < check.options.cacheMs) {
            components.push(check.lastResult);
            continue;
          }
        }

        const start = Date.now();
        const result = await Promise.race([
          check.fn(),
          new Promise<ComponentHealth>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), check.options.timeout)
          ),
        ]);
        result.latencyMs = Date.now() - start;
        result.lastCheck = now;

        // Cache result
        check.lastResult = result;
        components.push(result);
      } catch (error) {
        const result: ComponentHealth = {
          name,
          status: 'unhealthy',
          error: error instanceof Error ? error.message : String(error),
          lastCheck: now,
        };
        check.lastResult = result;
        components.push(result);
      }
    }

    // Calculate summary
    const summary = {
      total: components.length,
      healthy: components.filter(c => c.status === 'healthy').length,
      degraded: components.filter(c => c.status === 'degraded').length,
      unhealthy: components.filter(c => c.status === 'unhealthy').length,
      unknown: components.filter(c => c.status === 'unknown').length,
    };

    // Determine overall status
    let status: HealthStatus = 'healthy';
    if (summary.unhealthy > 0) {
      status = 'unhealthy';
    } else if (summary.degraded > 0 || summary.unknown > 0) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: now,
      uptime: Math.floor((now - this.startTime) / 1000),
      version: this.version,
      components,
      summary,
    };
  }

  /**
   * Check if service is ready to accept traffic
   */
  async checkReadiness(): Promise<ReadinessResult> {
    const checks: Array<{ name: string; passed: boolean; error?: string }> = [];

    for (const [name, check] of this.readinessChecks) {
      try {
        const passed = await Promise.race([
          check.fn(),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('Readiness check timeout')), check.options.timeout)
          ),
        ]);
        checks.push({ name, passed });
      } catch (error) {
        checks.push({
          name,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Also check critical health checks
    for (const [name, check] of this.checks) {
      if (check.options.critical && check.lastResult) {
        checks.push({
          name: `health:${name}`,
          passed: check.lastResult.status !== 'unhealthy',
          error: check.lastResult.error,
        });
      }
    }

    const allPassed = checks.every(c => c.passed);

    return {
      ready: allPassed,
      timestamp: Date.now(),
      checks,
    };
  }

  /**
   * Check if service is alive (not stuck)
   */
  async checkLiveness(): Promise<LivenessResult> {
    const memUsage = process.memoryUsage();
    const heapPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    // Check event loop latency
    const eventLoopLatency = await this.measureEventLoopLatency();

    return {
      alive: true,
      timestamp: Date.now(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
        percent: heapPercent,
      },
      eventLoop: {
        latencyMs: eventLoopLatency,
        healthy: eventLoopLatency < 100, // 100ms threshold
      },
    };
  }

  /**
   * Measure event loop latency
   */
  private measureEventLoopLatency(): Promise<number> {
    return new Promise(resolve => {
      const start = Date.now();
      setImmediate(() => {
        resolve(Date.now() - start);
      });
    });
  }

  /**
   * Get uptime in seconds
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }
}

// =============================================================================
// BUILT-IN HEALTH CHECKS
// =============================================================================

/**
 * Create a database health check
 */
export function createDatabaseHealthCheck(
  name: string,
  queryFn: () => Promise<boolean>,
  options: HealthCheckOptions = {}
): HealthCheckFn {
  return async (): Promise<ComponentHealth> => {
    try {
      const start = Date.now();
      const ok = await queryFn();
      const latencyMs = Date.now() - start;

      return {
        name,
        status: ok ? 'healthy' : 'unhealthy',
        latencyMs,
        details: { type: 'database' },
      };
    } catch (error) {
      return {
        name,
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error),
        details: { type: 'database' },
      };
    }
  };
}

/**
 * Create an HTTP dependency health check
 */
export function createHttpHealthCheck(
  name: string,
  url: string,
  options: { expectedStatus?: number; timeout?: number } = {}
): HealthCheckFn {
  const { expectedStatus = 200, timeout = 5000 } = options;

  return async (): Promise<ComponentHealth> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const start = Date.now();
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      const status = response.status === expectedStatus ? 'healthy' : 'degraded';

      return {
        name,
        status,
        latencyMs,
        details: {
          type: 'http',
          url,
          responseStatus: response.status,
          expectedStatus,
        },
      };
    } catch (error) {
      return {
        name,
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error),
        details: { type: 'http', url },
      };
    }
  };
}

/**
 * Create a WebSocket connection health check
 */
export function createWebSocketHealthCheck(
  name: string,
  isConnectedFn: () => boolean,
  getStatsFn?: () => { messagesPerSecond: number; lastMessageAt: number }
): HealthCheckFn {
  return async (): Promise<ComponentHealth> => {
    const connected = isConnectedFn();
    const stats = getStatsFn?.();

    let status: HealthStatus = connected ? 'healthy' : 'unhealthy';

    // Check if connection is stale (no messages in last 60 seconds)
    if (connected && stats) {
      const staleSince = Date.now() - stats.lastMessageAt;
      if (staleSince > 60000) {
        status = 'degraded';
      }
    }

    return {
      name,
      status,
      details: {
        type: 'websocket',
        connected,
        ...(stats && {
          messagesPerSecond: stats.messagesPerSecond,
          lastMessageAt: stats.lastMessageAt,
          staleSinceMs: Date.now() - stats.lastMessageAt,
        }),
      },
    };
  };
}

/**
 * Create a feed health check
 */
export function createFeedHealthCheck(
  name: string,
  platform: string,
  getStatusFn: () => {
    connected: boolean;
    subscriptions: number;
    messagesPerSecond: number;
    lastMessageAt: number;
    errors: number;
  }
): HealthCheckFn {
  return async (): Promise<ComponentHealth> => {
    const status = getStatusFn();

    let health: HealthStatus = 'healthy';
    if (!status.connected) {
      health = 'unhealthy';
    } else if (status.errors > 0 || Date.now() - status.lastMessageAt > 30000) {
      health = 'degraded';
    }

    return {
      name,
      status: health,
      details: {
        type: 'feed',
        platform,
        connected: status.connected,
        subscriptions: status.subscriptions,
        messagesPerSecond: status.messagesPerSecond,
        lastMessageAt: status.lastMessageAt,
        recentErrors: status.errors,
      },
    };
  };
}

/**
 * Create a memory health check
 */
export function createMemoryHealthCheck(
  warnThresholdPct = 80,
  criticalThresholdPct = 95
): HealthCheckFn {
  return async (): Promise<ComponentHealth> => {
    const memUsage = process.memoryUsage();
    const heapPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    let status: HealthStatus = 'healthy';
    if (heapPercent >= criticalThresholdPct) {
      status = 'unhealthy';
    } else if (heapPercent >= warnThresholdPct) {
      status = 'degraded';
    }

    return {
      name: 'memory',
      status,
      details: {
        type: 'memory',
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memUsage.rss / 1024 / 1024),
        heapPercent: Math.round(heapPercent * 100) / 100,
        warnThresholdPct,
        criticalThresholdPct,
      },
    };
  };
}

/**
 * Create an external API health check with circuit breaker pattern
 */
export function createApiHealthCheck(
  name: string,
  checkFn: () => Promise<boolean>,
  options: {
    timeout?: number;
    failureThreshold?: number;
    recoveryTime?: number;
  } = {}
): HealthCheckFn {
  const { timeout = 5000, failureThreshold = 3, recoveryTime = 30000 } = options;

  let consecutiveFailures = 0;
  let circuitOpenedAt: number | null = null;

  return async (): Promise<ComponentHealth> => {
    // Check if circuit is open
    if (circuitOpenedAt) {
      if (Date.now() - circuitOpenedAt < recoveryTime) {
        return {
          name,
          status: 'unhealthy',
          error: 'Circuit breaker open',
          details: {
            type: 'api',
            circuitOpen: true,
            recoversIn: Math.ceil((recoveryTime - (Date.now() - circuitOpenedAt)) / 1000),
          },
        };
      }
      // Try to recover
      circuitOpenedAt = null;
    }

    try {
      const start = Date.now();
      const ok = await Promise.race([
        checkFn(),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('API check timeout')), timeout)
        ),
      ]);
      const latencyMs = Date.now() - start;

      if (ok) {
        consecutiveFailures = 0;
        return {
          name,
          status: 'healthy',
          latencyMs,
          details: { type: 'api', consecutiveFailures: 0 },
        };
      }

      consecutiveFailures++;
      if (consecutiveFailures >= failureThreshold) {
        circuitOpenedAt = Date.now();
      }

      return {
        name,
        status: 'degraded',
        latencyMs,
        details: { type: 'api', consecutiveFailures },
      };
    } catch (error) {
      consecutiveFailures++;
      if (consecutiveFailures >= failureThreshold) {
        circuitOpenedAt = Date.now();
      }

      return {
        name,
        status: consecutiveFailures >= failureThreshold ? 'unhealthy' : 'degraded',
        error: error instanceof Error ? error.message : String(error),
        details: { type: 'api', consecutiveFailures, circuitOpen: !!circuitOpenedAt },
      };
    }
  };
}

// =============================================================================
// DEFAULT INSTANCE
// =============================================================================

export const healthChecker = new HealthChecker();

// Register built-in memory check
healthChecker.registerCheck('memory', createMemoryHealthCheck(), { cacheMs: 5000, critical: false });

// =============================================================================
// EXPORTS
// =============================================================================

export {
  HealthChecker as default,
};
