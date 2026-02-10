/**
 * Provider Health Monitoring - periodic availability checks with status tracking
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import type { ProviderManager } from './index';

export interface ProviderHealthStatus {
  provider: string;
  available: boolean;
  lastCheckedAt: number;
  consecutiveFailures: number;
  lastError?: string;
}

export interface ProviderHealthSnapshot {
  checkedAt: number;
  statuses: ProviderHealthStatus[];
}

export interface ProviderHealthMonitor extends EventEmitter {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  getSnapshot(): ProviderHealthSnapshot;
}

export interface ProviderHealthConfig {
  intervalMs?: number;
  failureWarnThreshold?: number;
}

const DEFAULT_CONFIG: Required<ProviderHealthConfig> = {
  intervalMs: Number(process.env.CLODDS_PROVIDER_HEALTH_INTERVAL_MS) || 30_000,
  failureWarnThreshold: Number(process.env.CLODDS_PROVIDER_HEALTH_WARN_AFTER) || 3,
};

function now(): number {
  return Date.now();
}

export function createProviderHealthMonitor(
  providers: ProviderManager,
  configInput: ProviderHealthConfig = {}
): ProviderHealthMonitor {
  const config = { ...DEFAULT_CONFIG, ...configInput };
  const statuses = new Map<string, ProviderHealthStatus>();
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function checkOnce(): Promise<void> {
    const checkedAt = now();
    const availability = await providers.checkAvailability();

    for (const [provider, available] of Object.entries(availability)) {
      const prev = statuses.get(provider);
      const consecutiveFailures = available ? 0 : (prev?.consecutiveFailures ?? 0) + 1;

      const next: ProviderHealthStatus = {
        provider,
        available,
        lastCheckedAt: checkedAt,
        consecutiveFailures,
        lastError: available ? undefined : prev?.lastError ?? 'Unavailable',
      };

      statuses.set(provider, next);

      if (!available && consecutiveFailures >= config.failureWarnThreshold) {
        logger.warn(
          { provider, consecutiveFailures },
          'Provider health check failing repeatedly'
        );
      }
    }

    const snapshot = getSnapshot();
    monitor.emit('health', snapshot);
    logger.debug({ snapshot }, 'Provider health snapshot');
  }

  function getSnapshot(): ProviderHealthSnapshot {
    return {
      checkedAt: now(),
      statuses: Array.from(statuses.values()).sort((a, b) => a.provider.localeCompare(b.provider)),
    };
  }

  const monitor: ProviderHealthMonitor = Object.assign(new EventEmitter(), {
    start() {
      if (running) return;
      running = true;

      // Kick off immediately, then schedule.
      void checkOnce().catch((error) => {
        logger.warn({ error }, 'Initial provider health check failed');
      });

      timer = setInterval(() => {
        void checkOnce().catch((error) => {
          logger.warn({ error }, 'Provider health check failed');
        });
      }, config.intervalMs);
      if (timer.unref) timer.unref();

      logger.info({ intervalMs: config.intervalMs }, 'Provider health monitor started');
    },

    stop() {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      monitor.removeAllListeners();
      logger.info('Provider health monitor stopped');
    },

    isRunning() {
      return running;
    },

    getSnapshot,
  });

  return monitor;
}
