/**
 * Automation CLI Skill
 *
 * Commands:
 * /auto list - List scheduled jobs
 * /auto cron <schedule> <command> - Create cron job
 * /auto remove <id> - Remove job
 * /auto enable <id> - Enable job
 * /auto disable <id> - Disable job
 * /auto trigger <id> - Manually run a job
 */

// Store command strings for each cron job
const jobCommands = new Map<string, string>();

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const { createCronScheduler, CronSchedules } = await import('../../../automation/cron');

    switch (cmd) {
      case 'list':
      case 'ls': {
        const scheduler = createCronScheduler();
        const jobs = scheduler.list();
        if (!jobs.length) return 'No scheduled jobs configured. Use `/auto cron` to create one.';
        let output = `**Scheduled Jobs** (${jobs.length})\n\n`;
        for (const job of jobs) {
          const cmd = jobCommands.get(job.id);
          output += `[${job.id}] \`${job.schedule}\`\n`;
          if (cmd) output += `  Command: \`${cmd}\`\n`;
          output += `  Enabled: ${job.enabled ? 'yes' : 'no'}\n`;
          if (job.lastRun) output += `  Last run: ${job.lastRun.toISOString()}\n`;
          if (job.nextRun) output += `  Next run: ${job.nextRun.toISOString()}\n`;
          output += '\n';
        }
        return output;
      }

      case 'cron': {
        if (parts.length < 3) {
          return 'Usage: /auto cron <schedule> <command>\n\nExample: /auto cron "*/5 * * * *" portfolio-sync\n\nPresets: EVERY_MINUTE, EVERY_5_MINUTES, EVERY_15_MINUTES, HOURLY, DAILY_MIDNIGHT, DAILY_9AM, WEEKLY_MONDAY_9AM, MONTHLY';
        }
        const schedule = parts[1];
        const command = parts.slice(2).join(' ');
        const id = `job-${Date.now()}`;
        // Resolve preset schedules
        const presetMap: Record<string, string> = CronSchedules;
        const resolvedSchedule = presetMap[schedule.toUpperCase()] || schedule;
        const scheduler = createCronScheduler();
        jobCommands.set(id, command);
        scheduler.add(id, resolvedSchedule, async () => {
          const { logger } = await import('../../../utils/logger');
          logger.info({ jobId: id, command }, 'Cron job fired');
        });
        const job = scheduler.get(id);
        return `**Cron Job Created**\n\nID: ${id}\nSchedule: \`${resolvedSchedule}\`\nCommand: \`${command}\`\nNext run: ${job?.nextRun?.toISOString() || 'calculating...'}`;
      }

      case 'remove':
      case 'delete': {
        if (!parts[1]) return 'Usage: /auto remove <job-id>';
        const scheduler = createCronScheduler();
        const removed = scheduler.remove(parts[1]);
        return removed ? `Job \`${parts[1]}\` removed.` : `Job \`${parts[1]}\` not found.`;
      }

      case 'enable': {
        if (!parts[1]) return 'Usage: /auto enable <job-id>';
        const scheduler = createCronScheduler();
        scheduler.setEnabled(parts[1], true);
        return `Job \`${parts[1]}\` enabled.`;
      }

      case 'disable': {
        if (!parts[1]) return 'Usage: /auto disable <job-id>';
        const scheduler = createCronScheduler();
        scheduler.setEnabled(parts[1], false);
        return `Job \`${parts[1]}\` disabled.`;
      }

      case 'trigger':
      case 'run': {
        if (!parts[1]) return 'Usage: /auto trigger <job-id>';
        const scheduler = createCronScheduler();
        const jobCmd = jobCommands.get(parts[1]);
        await scheduler.trigger(parts[1]);
        return `Job \`${parts[1]}\` triggered manually.${jobCmd ? `\nCommand: \`${jobCmd}\`` : ''}`;
      }

      case 'presets': {
        let output = '**Cron Schedule Presets**\n\n';
        for (const [name, expr] of Object.entries(CronSchedules)) {
          output += `  ${name}: \`${expr}\`\n`;
        }
        return output;
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Automation Commands**

  /auto list                           - List scheduled jobs
  /auto cron <schedule> <command>      - Create cron job
  /auto remove <id>                    - Remove a job
  /auto enable <id>                    - Enable a job
  /auto disable <id>                   - Disable a job
  /auto trigger <id>                   - Manually run a job
  /auto presets                        - Show schedule presets

Cron format: "minute hour day month weekday"`;
}

export default {
  name: 'automation',
  description: 'Schedule cron jobs, manage webhooks, and automate recurring tasks',
  commands: ['/auto', '/automation'],
  handle: execute,
};
