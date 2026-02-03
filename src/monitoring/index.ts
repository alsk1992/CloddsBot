/**
 * Monitoring & Alerting - health checks + error notifications.
 *
 * This module provides:
 * - Prometheus-compatible metrics (metrics.ts)
 * - Health check endpoints (health.ts)
 * - Alert thresholds and webhooks (alerts.ts)
 * - Legacy monitoring service (below)
 */

import type { OutgoingMessage, Config, MonitoringTarget } from '../types';
import type { ProviderHealthMonitor, ProviderHealthSnapshot } from '../providers';
import { createEmailTool } from '../tools/email';
import { getSystemHealth } from '../infra';
import { logger } from '../utils/logger';

// Re-export new monitoring modules
export * from './metrics';
export * from './health';
export * from './alerts';

export interface MonitoringService {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

type AlertTarget = MonitoringTarget;

function now(): number {
  return Date.now();
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message || String(error);
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function truncate(text: string, max = 3500): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

export function createMonitoringService(options: {
  config?: Config['monitoring'];
  providerHealth?: ProviderHealthMonitor | null;
  sendMessage: (message: OutgoingMessage) => Promise<string | null>;
  resolveAccountId?: (target: MonitoringTarget) => Promise<string | undefined> | string | undefined;
}): MonitoringService {
  const emailTool = createEmailTool();
  const providerHealth = options.providerHealth ?? null;
  const config = options.config ?? {};

  let running = false;
  let systemTimer: NodeJS.Timeout | null = null;
  const lastSent = new Map<string, number>();
  const providerState = new Map<string, { available: boolean; notifiedDown: boolean }>();

  const processHandlers: Array<{
    event: 'unhandledRejection' | 'uncaughtException' | 'warning';
    handler: (...args: any[]) => void;
  }> = [];

  function shouldSend(key: string, cooldownMs: number): boolean {
    const last = lastSent.get(key);
    const nowTime = now();
    if (last && nowTime - last < cooldownMs) return false;
    lastSent.set(key, nowTime);
    return true;
  }

  function getTargets(): AlertTarget[] {
    return Array.isArray(config.alertTargets) ? config.alertTargets : [];
  }

  function buildAlertMessage(title: string, body: string): string {
    return `ALERT: ${title}\n${body}`;
  }

  async function sendAlert(
    key: string,
    title: string,
    body: string,
    opts?: { cooldownMs?: number; subjectPrefix?: string }
  ): Promise<void> {
    if (config.enabled === false) return;
    const cooldownMs = opts?.cooldownMs ?? config.cooldownMs ?? 5 * 60 * 1000;
    if (!shouldSend(key, cooldownMs)) return;

    const targets = getTargets();
    const text = truncate(buildAlertMessage(title, body));

    if (targets.length === 0 && !config.email?.to?.length && !config.email?.enabled) {
      logger.warn({ title }, 'Monitoring alert suppressed (no targets configured)');
      return;
    }

    for (const target of targets) {
      try {
        const resolvedAccountId = target.accountId
          ? target.accountId
          : options.resolveAccountId
            ? await options.resolveAccountId(target)
            : undefined;
        await options.sendMessage({
          platform: target.platform,
          chatId: target.chatId,
          accountId: resolvedAccountId,
          text,
          thread: target.threadId ? { threadId: target.threadId } : undefined,
        });
      } catch (error) {
        logger.warn({ error, target }, 'Failed to send monitoring alert');
      }
    }

    const emailConfig = config.email;
    if (emailConfig?.enabled && emailConfig.to && emailConfig.to.length > 0) {
      if (!emailTool.isAvailable()) {
        logger.warn('Email tool not available; skipping email alert');
      } else {
        const from = emailConfig.from || 'clodds@localhost';
        const subjectPrefix = opts?.subjectPrefix ?? emailConfig.subjectPrefix ?? 'Clodds';
        const subject = `[${subjectPrefix}] ${title}`;
        try {
          await emailTool.send({
            from: { email: from },
            to: emailConfig.to,
            subject,
            text: `${title}\n\n${body}`,
          });
        } catch (error) {
          logger.warn({ error }, 'Failed to send email alert');
        }
      }
    }
  }

  function handleProviderHealth(snapshot: ProviderHealthSnapshot): void {
    const healthConfig = config.providerHealth;
    if (healthConfig?.enabled === false) return;

    const alertAfter = healthConfig?.alertAfterFailures ?? 3;
    const alertOnRecovery = healthConfig?.alertOnRecovery !== false;
    const cooldownMs = healthConfig?.cooldownMs ?? 10 * 60 * 1000;

    for (const status of snapshot.statuses) {
      const prev = providerState.get(status.provider);
      providerState.set(status.provider, {
        available: status.available,
        notifiedDown: prev?.notifiedDown ?? false,
      });

      if (!status.available) {
        const shouldAlert =
          status.consecutiveFailures >= alertAfter && (!prev || prev.available || !prev.notifiedDown);
        if (shouldAlert) {
          providerState.set(status.provider, {
            available: false,
            notifiedDown: true,
          });
          void sendAlert(
            `provider:${status.provider}:down`,
            `${status.provider} provider unavailable`,
            `Consecutive failures: ${status.consecutiveFailures}\nLast checked: ${new Date(
              status.lastCheckedAt
            ).toISOString()}\nLast error: ${status.lastError || 'Unknown'}`,
            { cooldownMs }
          );
        }
      } else if (prev && !prev.available && alertOnRecovery) {
        providerState.set(status.provider, {
          available: true,
          notifiedDown: false,
        });
        void sendAlert(
          `provider:${status.provider}:up`,
          `${status.provider} provider recovered`,
          `Recovered at ${new Date(status.lastCheckedAt).toISOString()}`,
          { cooldownMs }
        );
      }
    }
  }

  async function checkSystemHealth(): Promise<void> {
    const systemConfig = config.systemHealth;
    if (!systemConfig?.enabled) return;

    try {
      const health = await getSystemHealth();
      const memoryWarn = systemConfig.memoryWarnPct ?? 85;
      const diskWarn = systemConfig.diskWarnPct ?? 90;
      const cooldownMs = systemConfig.cooldownMs ?? 30 * 60 * 1000;

      if (health.memory.percent >= memoryWarn) {
        await sendAlert(
          'system:memory',
          'High memory usage',
          `Memory used: ${health.memory.percent.toFixed(1)}% (${(health.memory.used / 1024 / 1024 / 1024).toFixed(
            1
          )}GB/${(health.memory.total / 1024 / 1024 / 1024).toFixed(1)}GB)`,
          { cooldownMs }
        );
      }

      if (health.disk && health.disk.percent >= diskWarn) {
        await sendAlert(
          'system:disk',
          'Low disk space',
          `Disk used: ${health.disk.percent.toFixed(1)}% (${(health.disk.used / 1024 / 1024 / 1024).toFixed(
            1
          )}GB/${(health.disk.total / 1024 / 1024 / 1024).toFixed(1)}GB)`,
          { cooldownMs }
        );
      }
    } catch (error) {
      logger.warn({ error }, 'System health check failed');
    }
  }

  function attachProcessHandlers(): void {
    if (config.errors?.enabled === false) return;
    const cooldownMs = config.errors?.cooldownMs ?? 5 * 60 * 1000;
    const includeStack = config.errors?.includeStack !== false;

    const onUnhandledRejection = (reason: unknown) => {
      const details = includeStack ? formatError(reason) : String(reason);
      void sendAlert(
        'error:unhandledRejection',
        'Unhandled promise rejection',
        truncate(details),
        { cooldownMs }
      );
    };

    const onUncaughtException = (error: Error) => {
      const details = includeStack ? formatError(error) : error.message;
      void sendAlert(
        'error:uncaughtException',
        'Uncaught exception',
        truncate(details),
        { cooldownMs }
      );
    };

    const onWarning = (warning: Error) => {
      const details = includeStack ? formatError(warning) : warning.message;
      void sendAlert('error:warning', 'Process warning', truncate(details), { cooldownMs });
    };

    process.on('unhandledRejection', onUnhandledRejection);
    process.on('uncaughtException', onUncaughtException);
    process.on('warning', onWarning);

    processHandlers.push(
      { event: 'unhandledRejection', handler: onUnhandledRejection },
      { event: 'uncaughtException', handler: onUncaughtException },
      { event: 'warning', handler: onWarning }
    );
  }

  function detachProcessHandlers(): void {
    for (const entry of processHandlers) {
      process.off(entry.event, entry.handler);
    }
    processHandlers.length = 0;
  }

  function startSystemTimer(): void {
    if (!config.systemHealth?.enabled) return;
    const intervalMs = config.systemHealth.intervalMs ?? 60 * 1000;
    if (systemTimer) clearInterval(systemTimer);
    void checkSystemHealth();
    systemTimer = setInterval(() => {
      void checkSystemHealth();
    }, intervalMs);
  }

  return {
    start() {
      if (running) return;
      if (config.enabled === false) {
        logger.info('Monitoring disabled by config');
        return;
      }
      running = true;

      if (providerHealth && config.providerHealth?.enabled !== false) {
        providerHealth.on('health', handleProviderHealth);
      }

      attachProcessHandlers();
      startSystemTimer();

      logger.info('Monitoring service started');
    },

    stop() {
      if (!running) return;
      running = false;

      if (providerHealth) {
        providerHealth.off('health', handleProviderHealth);
      }

      detachProcessHandlers();

      if (systemTimer) {
        clearInterval(systemTimer);
        systemTimer = null;
      }

      logger.info('Monitoring service stopped');
    },

    isRunning() {
      return running;
    },
  };
}
