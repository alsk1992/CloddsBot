/**
 * Cron Service - Clawdbot-style scheduled tasks
 *
 * Features:
 * - One-shot and recurring jobs
 * - Cron expressions
 * - Agent wakeups
 * - Alert checking
 * - Market monitoring
 */

import { EventEmitter } from 'eventemitter3';
import { Database } from '../db';
import { FeedManager } from '../feeds';
import { Alert, OutgoingMessage } from '../types';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

/** Schedule types */
export type CronSchedule =
  | { kind: 'at'; atMs: number }           // Run once at specific time
  | { kind: 'every'; everyMs: number; anchorMs?: number }  // Recurring interval
  | { kind: 'cron'; expr: string; tz?: string };           // Cron expression

/** Session target for job execution */
export type CronSessionTarget = 'main' | 'isolated';

/** When to wake the agent */
export type CronWakeMode = 'next-heartbeat' | 'now';

/** Job payload - what to do when triggered */
export type CronPayload =
  | { kind: 'systemEvent'; text: string }
  | {
      kind: 'agentTurn';
      message: string;
      model?: string;
      thinking?: 'off' | 'low' | 'medium' | 'high';
      timeoutSeconds?: number;
      deliver?: boolean;
      channel?: string;
      to?: string;
    }
  | {
      kind: 'alert';
      alertId: string;
    }
  | {
      kind: 'marketCheck';
      marketId: string;
      platform: string;
    }
  | {
      kind: 'alertScan';
    };

/** Job state tracking */
export interface CronJobState {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
  lastDurationMs?: number;
}

/** A scheduled job */
export interface CronJob {
  id: string;
  agentId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  state: CronJobState;
}

/** Input for creating a job */
export type CronJobCreate = Omit<CronJob, 'id' | 'createdAtMs' | 'updatedAtMs' | 'state'> & {
  state?: Partial<CronJobState>;
};

/** Input for updating a job */
export type CronJobPatch = Partial<Omit<CronJob, 'id' | 'createdAtMs' | 'state'>> & {
  state?: Partial<CronJobState>;
};

/** Cron service events */
export type CronEvent =
  | { type: 'job:scheduled'; job: CronJob }
  | { type: 'job:started'; job: CronJob }
  | { type: 'job:completed'; job: CronJob; durationMs: number }
  | { type: 'job:failed'; job: CronJob; error: string }
  | { type: 'job:skipped'; job: CronJob; reason: string };

// =============================================================================
// HELPERS
// =============================================================================

/** Parse simple cron expression to next run time */
function getNextCronTime(expr: string, _tz?: string): number {
  // Simple cron parser - supports: minute hour dayOfMonth month dayOfWeek
  // Format: "0 9 * * *" = 9 AM daily
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) {
    // Invalid, return next minute
    const now = new Date();
    now.setSeconds(0);
    now.setMilliseconds(0);
    now.setMinutes(now.getMinutes() + 1);
    return now.getTime();
  }

  const [minute, hour, _dayOfMonth, _month, _dayOfWeek] = parts;
  const now = new Date();
  const next = new Date(now);

  // Set to specific minute/hour if specified
  if (minute !== '*') {
    next.setMinutes(parseInt(minute, 10));
  }
  if (hour !== '*') {
    next.setHours(parseInt(hour, 10));
  }
  next.setSeconds(0);
  next.setMilliseconds(0);

  // If time already passed today, move to tomorrow
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime();
}

/** Calculate next run time for a schedule */
function calculateNextRun(schedule: CronSchedule, lastRunMs?: number): number {
  const now = Date.now();

  switch (schedule.kind) {
    case 'at':
      return schedule.atMs > now ? schedule.atMs : -1; // -1 = already passed

    case 'every': {
      const anchor = schedule.anchorMs || now;
      const elapsed = now - anchor;
      const intervals = Math.floor(elapsed / schedule.everyMs);
      return anchor + (intervals + 1) * schedule.everyMs;
    }

    case 'cron':
      return getNextCronTime(schedule.expr, schedule.tz);

    default:
      return -1;
  }
}

// =============================================================================
// SERVICE
// =============================================================================

export interface CronServiceDeps {
  db: Database;
  feeds: FeedManager;
  sendMessage: (msg: OutgoingMessage) => Promise<void>;
  /** Execute agent turn (optional) */
  executeAgentTurn?: (message: string, options: {
    model?: string;
    thinking?: string;
    channel?: string;
    to?: string;
  }) => Promise<string>;
}

export interface CronService extends EventEmitter {
  start(): Promise<void>;
  stop(): void;
  status(): { running: boolean; jobCount: number; nextJobAt?: number };
  list(opts?: { includeDisabled?: boolean }): CronJob[];
  get(id: string): CronJob | undefined;
  add(input: CronJobCreate): CronJob;
  update(id: string, patch: CronJobPatch): CronJob | null;
  remove(id: string): boolean;
  run(id: string, mode?: 'due' | 'force'): Promise<boolean>;
}

export function createCronService(deps: CronServiceDeps): CronService {
  const emitter = new EventEmitter() as CronService;
  const jobs = new Map<string, CronJob>();
  const timers = new Map<string, NodeJS.Timeout>();
  let running = false;
  let tickInterval: NodeJS.Timeout | null = null;

  /** Generate unique job ID */
  function generateId(): string {
    return `cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Execute a job based on its payload */
  async function executeJob(job: CronJob): Promise<void> {
    const { payload } = job;

    switch (payload.kind) {
      case 'alertScan':
        await checkAllAlerts();
        break;

      case 'alert':
        await checkSingleAlert(payload.alertId);
        break;

      case 'marketCheck':
        await checkMarket(payload.marketId, payload.platform);
        break;

      case 'agentTurn':
        if (deps.executeAgentTurn) {
          await deps.executeAgentTurn(payload.message, {
            model: payload.model,
            thinking: payload.thinking,
            channel: payload.channel,
            to: payload.to,
          });
        }
        break;

      case 'systemEvent':
        logger.info({ event: payload.text }, 'System event triggered');
        break;
    }
  }

  /** Check all active alerts */
  async function checkAllAlerts(): Promise<void> {
    const activeAlerts = deps.db.getActiveAlerts();
    for (const alert of activeAlerts) {
      try {
        await checkSingleAlert(alert.id);
      } catch (error) {
        logger.error({ alertId: alert.id, error }, 'Error checking alert');
      }
    }
  }

  /** Check a single alert */
  async function checkSingleAlert(alertId: string): Promise<void> {
    const alerts = deps.db.getActiveAlerts();
    const alert = alerts.find((a) => a.id === alertId);
    if (!alert || !alert.marketId || !alert.platform) return;

    const market = await deps.feeds.getMarket(alert.marketId, alert.platform);
    if (!market) return;

    const currentPrice = market.outcomes[0]?.price;
    if (currentPrice === undefined) return;

    let triggered = false;
    let message = '';

    switch (alert.condition.type) {
      case 'price_above':
        if (currentPrice >= alert.condition.threshold) {
          triggered = true;
          message = `📈 Price Alert: ${market.question}\nPrice is now ${(currentPrice * 100).toFixed(1)}¢ (above ${(alert.condition.threshold * 100).toFixed(1)}¢)`;
        }
        break;

      case 'price_below':
        if (currentPrice <= alert.condition.threshold) {
          triggered = true;
          message = `📉 Price Alert: ${market.question}\nPrice is now ${(currentPrice * 100).toFixed(1)}¢ (below ${(alert.condition.threshold * 100).toFixed(1)}¢)`;
        }
        break;
    }

    if (triggered) {
      deps.db.triggerAlert(alert.id);

      const user = deps.db.getUser(alert.userId);
      if (user) {
        await deps.sendMessage({
          platform: user.platform,
          chatId: user.platformUserId,
          text: message,
        });
      }

      logger.info({ alertId: alert.id }, 'Alert triggered');
    }
  }

  /** Check a specific market */
  async function checkMarket(marketId: string, platform: string): Promise<void> {
    const market = await deps.feeds.getMarket(marketId, platform);
    if (market) {
      logger.debug({ marketId, platform, price: market.outcomes[0]?.price }, 'Market checked');
    }
  }

  /** Schedule a job's next execution */
  function scheduleJob(job: CronJob): void {
    // Clear existing timer
    const existing = timers.get(job.id);
    if (existing) {
      clearTimeout(existing);
      timers.delete(job.id);
    }

    if (!job.enabled || !running) return;

    const nextRun = calculateNextRun(job.schedule, job.state.lastRunAtMs);
    if (nextRun < 0) {
      if (job.deleteAfterRun) {
        jobs.delete(job.id);
      }
      return;
    }

    job.state.nextRunAtMs = nextRun;

    const delay = Math.max(0, nextRun - Date.now());
    const timer = setTimeout(async () => {
      timers.delete(job.id);
      await executeJobInternal(job);
    }, delay);

    timers.set(job.id, timer);
    emitter.emit('event', { type: 'job:scheduled', job } as CronEvent);
    logger.debug({ jobId: job.id, name: job.name, nextRun: new Date(nextRun) }, 'Job scheduled');
  }

  /** Execute a job */
  async function executeJobInternal(job: CronJob): Promise<void> {
    if (!job.enabled) {
      emitter.emit('event', { type: 'job:skipped', job, reason: 'disabled' } as CronEvent);
      return;
    }

    job.state.runningAtMs = Date.now();
    emitter.emit('event', { type: 'job:started', job } as CronEvent);
    logger.info({ jobId: job.id, name: job.name }, 'Running cron job');

    const startTime = Date.now();
    try {
      await executeJob(job);

      const durationMs = Date.now() - startTime;
      job.state.lastRunAtMs = startTime;
      job.state.lastStatus = 'ok';
      job.state.lastDurationMs = durationMs;
      job.state.lastError = undefined;
      job.state.runningAtMs = undefined;

      emitter.emit('event', { type: 'job:completed', job, durationMs } as CronEvent);
      logger.info({ jobId: job.id, name: job.name, durationMs }, 'Cron job completed');

      if (job.deleteAfterRun && job.schedule.kind === 'at') {
        jobs.delete(job.id);
      } else {
        scheduleJob(job);
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      job.state.lastRunAtMs = startTime;
      job.state.lastStatus = 'error';
      job.state.lastError = errorMsg;
      job.state.lastDurationMs = durationMs;
      job.state.runningAtMs = undefined;

      emitter.emit('event', { type: 'job:failed', job, error: errorMsg } as CronEvent);
      logger.error({ jobId: job.id, name: job.name, error: errorMsg }, 'Cron job failed');

      if (job.schedule.kind !== 'at') {
        scheduleJob(job);
      }
    }
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  emitter.start = async () => {
    if (running) return;
    running = true;

    logger.info('Starting cron service');

    // Add default alert scan job if none exists
    if (!Array.from(jobs.values()).some((j) => j.payload.kind === 'alertScan')) {
      emitter.add({
        name: 'Alert Scanner',
        description: 'Check all price alerts every 30 seconds',
        enabled: true,
        schedule: { kind: 'every', everyMs: 30000 },
        sessionTarget: 'main',
        wakeMode: 'now',
        payload: { kind: 'alertScan' },
      });
    }

    // Schedule all enabled jobs
    for (const job of jobs.values()) {
      scheduleJob(job);
    }

    // Tick every minute to catch any drift
    tickInterval = setInterval(() => {
      const now = Date.now();
      for (const job of jobs.values()) {
        if (job.enabled && job.state.nextRunAtMs && job.state.nextRunAtMs <= now && !job.state.runningAtMs) {
          scheduleJob(job);
        }
      }
    }, 60000);

    logger.info('Cron service started');
  };

  emitter.stop = () => {
    if (!running) return;
    running = false;

    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();

    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }

    logger.info('Cron service stopped');
  };

  emitter.status = () => {
    let nextJobAt: number | undefined;
    for (const job of jobs.values()) {
      if (job.enabled && job.state.nextRunAtMs) {
        if (!nextJobAt || job.state.nextRunAtMs < nextJobAt) {
          nextJobAt = job.state.nextRunAtMs;
        }
      }
    }

    return { running, jobCount: jobs.size, nextJobAt };
  };

  emitter.list = (opts) => {
    const all = Array.from(jobs.values());
    return opts?.includeDisabled ? all : all.filter((j) => j.enabled);
  };

  emitter.get = (id) => jobs.get(id);

  emitter.add = (input) => {
    const now = Date.now();
    const job: CronJob = {
      id: generateId(),
      ...input,
      createdAtMs: now,
      updatedAtMs: now,
      state: input.state || {},
    };

    jobs.set(job.id, job);
    logger.info({ jobId: job.id, name: job.name }, 'Cron job added');

    if (running && job.enabled) {
      scheduleJob(job);
    }

    return job;
  };

  emitter.update = (id, patch) => {
    const job = jobs.get(id);
    if (!job) return null;

    const updated: CronJob = {
      ...job,
      ...patch,
      id: job.id,
      createdAtMs: job.createdAtMs,
      updatedAtMs: Date.now(),
      state: { ...job.state, ...patch.state },
    };

    jobs.set(id, updated);
    logger.info({ jobId: id, name: updated.name }, 'Cron job updated');

    if (running) {
      scheduleJob(updated);
    }

    return updated;
  };

  emitter.remove = (id) => {
    const job = jobs.get(id);
    if (!job) return false;

    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }

    jobs.delete(id);
    logger.info({ jobId: id, name: job.name }, 'Cron job removed');

    return true;
  };

  emitter.run = async (id, mode = 'due') => {
    const job = jobs.get(id);
    if (!job) return false;

    if (mode === 'due') {
      const nextRun = calculateNextRun(job.schedule, job.state.lastRunAtMs);
      if (nextRun > Date.now()) {
        return false;
      }
    }

    await executeJobInternal(job);
    return true;
  };

  return emitter;
}

// =============================================================================
// LEGACY EXPORT (backward compat)
// =============================================================================

export interface CronManager {
  start(): void;
  stop(): void;
}

export function createCronManager(
  db: Database,
  feeds: FeedManager,
  sendMessage: (msg: OutgoingMessage) => Promise<void>
): CronManager {
  const service = createCronService({ db, feeds, sendMessage });

  return {
    start() {
      service.start();
    },
    stop() {
      service.stop();
    },
  };
}
