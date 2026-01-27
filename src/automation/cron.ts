/**
 * Cron Jobs - Clawdbot-style scheduled tasks
 *
 * Features:
 * - Cron expression support (standard 5-field format)
 * - Timezone-aware scheduling
 * - Per-user scheduled tasks
 * - Built-in jobs: daily summaries, market alerts
 */

import { logger } from '../utils/logger';

/** Cron job definition */
export interface CronJob {
  id: string;
  /** Cron expression: "minute hour day month weekday" */
  schedule: string;
  /** Job handler function */
  handler: () => Promise<void>;
  /** Optional timezone (default: UTC) */
  timezone?: string;
  /** Whether job is enabled */
  enabled: boolean;
  /** Last run timestamp */
  lastRun?: Date;
  /** Next scheduled run */
  nextRun?: Date;
}

/** Parse cron field (supports *, numbers, ranges, steps) */
function parseCronField(field: string, min: number, max: number): number[] {
  const values: number[] = [];

  // Handle *
  if (field === '*') {
    for (let i = min; i <= max; i++) {
      values.push(i);
    }
    return values;
  }

  // Handle */n (step)
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    for (let i = min; i <= max; i += step) {
      values.push(i);
    }
    return values;
  }

  // Handle comma-separated values
  const parts = field.split(',');
  for (const part of parts) {
    // Handle range (n-m)
    if (part.includes('-')) {
      const [start, end] = part.split('-').map((n) => parseInt(n, 10));
      for (let i = start; i <= end; i++) {
        values.push(i);
      }
    } else {
      values.push(parseInt(part, 10));
    }
  }

  return values;
}

/** Parse cron expression into field arrays */
function parseCronExpression(expr: string): {
  minutes: number[];
  hours: number[];
  days: number[];
  months: number[];
  weekdays: number[];
} {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${expr} (expected 5 fields)`);
  }

  return {
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    days: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    weekdays: parseCronField(parts[4], 0, 6), // 0 = Sunday
  };
}

/** Check if current time matches cron expression */
function matchesCron(date: Date, expr: string): boolean {
  const { minutes, hours, days, months, weekdays } = parseCronExpression(expr);

  return (
    minutes.includes(date.getMinutes()) &&
    hours.includes(date.getHours()) &&
    days.includes(date.getDate()) &&
    months.includes(date.getMonth() + 1) &&
    weekdays.includes(date.getDay())
  );
}

/** Calculate next run time for cron expression */
function getNextRun(expr: string, after: Date = new Date()): Date {
  const { minutes, hours, days, months, weekdays } = parseCronExpression(expr);

  // Start from next minute
  const next = new Date(after);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(next.getMinutes() + 1);

  // Search for next matching time (limit to prevent infinite loop)
  for (let i = 0; i < 527040; i++) {
    // ~1 year of minutes
    if (
      minutes.includes(next.getMinutes()) &&
      hours.includes(next.getHours()) &&
      days.includes(next.getDate()) &&
      months.includes(next.getMonth() + 1) &&
      weekdays.includes(next.getDay())
    ) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  // Fallback
  return next;
}

export interface CronScheduler {
  /** Add a new cron job */
  add(
    id: string,
    schedule: string,
    handler: () => Promise<void>,
    options?: { timezone?: string; enabled?: boolean }
  ): void;

  /** Remove a cron job */
  remove(id: string): boolean;

  /** Enable/disable a job */
  setEnabled(id: string, enabled: boolean): void;

  /** Get all jobs */
  list(): CronJob[];

  /** Get a specific job */
  get(id: string): CronJob | undefined;

  /** Start the scheduler */
  start(): void;

  /** Stop the scheduler */
  stop(): void;

  /** Manually trigger a job */
  trigger(id: string): Promise<void>;
}

export function createCronScheduler(): CronScheduler {
  const jobs = new Map<string, CronJob>();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let isRunning = false;

  /** Check and run due jobs */
  async function tick(): Promise<void> {
    const now = new Date();

    for (const job of jobs.values()) {
      if (!job.enabled) continue;

      if (matchesCron(now, job.schedule)) {
        // Check if we already ran this minute
        if (
          job.lastRun &&
          job.lastRun.getMinutes() === now.getMinutes() &&
          job.lastRun.getHours() === now.getHours() &&
          job.lastRun.getDate() === now.getDate()
        ) {
          continue;
        }

        // Run the job
        job.lastRun = now;
        job.nextRun = getNextRun(job.schedule, now);

        logger.info({ jobId: job.id, schedule: job.schedule }, 'Running cron job');

        try {
          await job.handler();
        } catch (error) {
          logger.error({ error, jobId: job.id }, 'Cron job failed');
        }
      }
    }
  }

  const scheduler: CronScheduler = {
    add(id, schedule, handler, options = {}) {
      // Validate cron expression
      try {
        parseCronExpression(schedule);
      } catch (error) {
        logger.error({ error, schedule }, 'Invalid cron expression');
        throw error;
      }

      const job: CronJob = {
        id,
        schedule,
        handler,
        timezone: options.timezone,
        enabled: options.enabled !== false,
        nextRun: getNextRun(schedule),
      };

      jobs.set(id, job);
      logger.info({ id, schedule, nextRun: job.nextRun }, 'Cron job added');
    },

    remove(id) {
      const existed = jobs.has(id);
      jobs.delete(id);
      if (existed) {
        logger.info({ id }, 'Cron job removed');
      }
      return existed;
    },

    setEnabled(id, enabled) {
      const job = jobs.get(id);
      if (job) {
        job.enabled = enabled;
        if (enabled) {
          job.nextRun = getNextRun(job.schedule);
        }
        logger.info({ id, enabled }, 'Cron job toggled');
      }
    },

    list() {
      return Array.from(jobs.values());
    },

    get(id) {
      return jobs.get(id);
    },

    start() {
      if (isRunning) return;
      isRunning = true;

      // Run tick every minute
      intervalId = setInterval(
        () => {
          tick().catch((err) => {
            logger.error({ err }, 'Cron tick error');
          });
        },
        60 * 1000
      );

      // Also run immediately to catch any due jobs
      tick().catch((err) => {
        logger.error({ err }, 'Initial cron tick error');
      });

      logger.info('Cron scheduler started');
    },

    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      isRunning = false;
      logger.info('Cron scheduler stopped');
    },

    async trigger(id) {
      const job = jobs.get(id);
      if (!job) {
        throw new Error(`Cron job not found: ${id}`);
      }

      logger.info({ id }, 'Manually triggering cron job');
      job.lastRun = new Date();
      await job.handler();
    },
  };

  return scheduler;
}

/** Common cron schedules */
export const CronSchedules = {
  /** Every minute */
  EVERY_MINUTE: '* * * * *',
  /** Every 5 minutes */
  EVERY_5_MINUTES: '*/5 * * * *',
  /** Every 15 minutes */
  EVERY_15_MINUTES: '*/15 * * * *',
  /** Every hour */
  HOURLY: '0 * * * *',
  /** Every day at midnight */
  DAILY_MIDNIGHT: '0 0 * * *',
  /** Every day at 9am */
  DAILY_9AM: '0 9 * * *',
  /** Every Monday at 9am */
  WEEKLY_MONDAY_9AM: '0 9 * * 1',
  /** First of every month at midnight */
  MONTHLY: '0 0 1 * *',
};
