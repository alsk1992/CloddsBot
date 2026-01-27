/**
 * Cron/Scheduler Types - Clawdbot-style scheduled tasks
 */

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
      checkCondition: boolean;
    }
  | {
      kind: 'marketCheck';
      marketId: string;
      platform: string;
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
