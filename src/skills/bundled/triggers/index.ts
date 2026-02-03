/**
 * Triggers CLI Skill
 *
 * Commands:
 * /triggers list - List active triggers
 * /triggers create <event> <action> - Create trigger
 * /triggers delete <id> - Delete trigger
 * /triggers cron <expr> <action> - Create cron trigger
 * /triggers events - List available events
 */

import type { CronJob, CronJobCreate } from '../../../cron/index';

// In-memory cron service instance (lazy init)
let cronInstance: any = null;

async function getCronService() {
  if (cronInstance) return cronInstance;
  try {
    const { createCronService } = await import('../../../cron/index');
    const { initDatabase } = await import('../../../db/index');
    const db = await initDatabase();
    cronInstance = createCronService({
      db,
      feeds: null as any, // Triggers don't need feeds
      sendMessage: async () => null,
    });
    return cronInstance;
  } catch {
    return null;
  }
}

function formatJob(job: CronJob): string {
  const schedule = job.schedule.kind === 'cron'
    ? job.schedule.expr
    : job.schedule.kind === 'every'
      ? `every ${job.schedule.everyMs / 1000}s`
      : `at ${new Date(job.schedule.atMs).toLocaleString()}`;
  const status = job.enabled ? 'active' : 'disabled';
  const next = job.state.nextRunAtMs ? new Date(job.state.nextRunAtMs).toLocaleString() : 'n/a';
  return `**${job.id}** ${job.name} [${status}]\n  Schedule: ${schedule}\n  Next: ${next}\n  Payload: ${job.payload.kind}`;
}

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const cron = await getCronService();

    switch (cmd) {
      case 'list':
      case 'active': {
        if (!cron) return 'Cron service not available.';
        const jobs = cron.list({ includeDisabled: true });
        if (jobs.length === 0) return 'No active triggers or cron jobs.';
        let output = `**Active Triggers** (${jobs.length})\n\n`;
        for (const job of jobs) {
          output += formatJob(job) + '\n\n';
        }
        const status = cron.status();
        output += `Service: ${status.running ? 'running' : 'stopped'} | Jobs: ${status.jobCount}`;
        return output;
      }

      case 'create': {
        const event = parts[1];
        const action = parts.slice(2).join(' ');
        if (!event || !action) return 'Usage: /triggers create <event> <action>';
        if (!cron) return 'Cron service not available.';
        const job = cron.add({
          name: `trigger:${event}`,
          enabled: true,
          schedule: { kind: 'every', everyMs: 60000 },
          sessionTarget: 'main' as const,
          wakeMode: 'next-heartbeat' as const,
          payload: { kind: 'systemEvent' as const, text: `Event "${event}" triggered: ${action}` },
        });
        return `Trigger created (ID: ${job.id})\nEvent: ${event}\nAction: ${action}`;
      }

      case 'delete':
      case 'remove': {
        if (!parts[1]) return 'Usage: /triggers delete <trigger-id>';
        if (!cron) return 'Cron service not available.';
        const removed = cron.remove(parts[1]);
        return removed
          ? `Trigger ${parts[1]} deleted.`
          : `Trigger ${parts[1]} not found.`;
      }

      case 'cron': {
        const expr = parts[1];
        const action = parts.slice(2).join(' ');
        if (!expr || !action) return 'Usage: /triggers cron <cron-expression> <action>\n\nExample: /triggers cron "0 9 * * *" "check portfolio"';
        if (!cron) return 'Cron service not available.';
        const job = cron.add({
          name: `cron:${expr}`,
          enabled: true,
          schedule: { kind: 'cron' as const, expr },
          sessionTarget: 'main' as const,
          wakeMode: 'next-heartbeat' as const,
          payload: { kind: 'agentTurn' as const, message: action },
        });
        return `Cron trigger created (ID: ${job.id})\nSchedule: ${expr}\nAction: ${action}`;
      }

      case 'hooks':
        return 'Event hooks are managed via the hooks configuration file.\nSee the Clodds docs for hook setup.';

      case 'events':
        return `**Available Events**

message, response, tool:before, tool:after, agent:start, agent:stop, gateway:connect, gateway:disconnect, trade:executed, alert:triggered, feed:update`;

      default:
        return helpText();
    }
  } catch (error) {
    return `Triggers error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Triggers Commands**

  /triggers list                     - List active triggers
  /triggers create <event> <action>  - Create event trigger
  /triggers delete <id>              - Delete trigger
  /triggers cron <expr> <action>     - Create cron trigger
  /triggers hooks                    - List event hooks
  /triggers events                   - Available event types`;
}

export default {
  name: 'triggers',
  description: 'Event triggers, cron schedules, and webhook hooks',
  commands: ['/triggers', '/trigger'],
  handle: execute,
};
