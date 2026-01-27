/**
 * Automation Module - Cron jobs, webhooks, heartbeats, and scheduled tasks
 */

export { createCronScheduler, CronSchedules } from './cron';
export type { CronJob, CronScheduler } from './cron';

export { createWebhookManager, createWebhookMiddleware } from './webhooks';
export type { Webhook, WebhookManager } from './webhooks';

export { createHeartbeatService } from './heartbeats';
export type { HeartbeatConfig, HeartbeatService, HeartbeatSender, HeartbeatGenerator } from './heartbeats';
