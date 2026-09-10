/**
 * Usage CLI Skill
 *
 * Commands:
 * /usage - Show usage summary (all time)
 * /usage today - Today's usage
 * /usage week - Last 7 days usage
 * /usage month - Last 30 days usage
 * /usage breakdown [today] - Cost breakdown by model
 * /usage by-model - Break down usage by model
 * /usage by-user - Break down usage by user
 * /usage history - Usage history over time
 * /usage estimate <model> <in> <out> - Estimate cost
 * /usage user <id> [today] - User-specific usage
 * /usage reset - Clear all usage data
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'summary';

  try {
    const { createUsageService } = await import('../../../usage/index');
    const { initDatabase } = await import('../../../db/index');
    const db = await initDatabase();
    const service = createUsageService(db);

    switch (cmd) {
      case 'summary':
      case 'all': {
        const summary = service.getTotalUsage(false);
        return service.formatSummary(summary);
      }

      case 'today': {
        const summary = service.getTotalUsage(true);
        if (summary.totalRequests === 0) {
          return '**Today\'s Usage**\n\nNo usage recorded today.';
        }
        return `**Today's Usage**\n\n` +
          `Requests: ${summary.totalRequests}\n` +
          `Input tokens: ${summary.totalInputTokens.toLocaleString()}\n` +
          `Output tokens: ${summary.totalOutputTokens.toLocaleString()}\n` +
          `Total tokens: ${summary.totalTokens.toLocaleString()}\n` +
          `Estimated cost: $${summary.estimatedCost.toFixed(4)}`;
      }

      case 'week': {
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - 7);
        sinceDate.setHours(0, 0, 0, 0);
        const summary = getUsageSince(db, sinceDate);
        if (summary.totalRequests === 0) {
          return '**Last 7 Days Usage**\n\nNo usage recorded this week.';
        }
        return `**Last 7 Days Usage**\n\n` +
          `Requests: ${summary.totalRequests}\n` +
          `Input tokens: ${summary.totalInputTokens.toLocaleString()}\n` +
          `Output tokens: ${summary.totalOutputTokens.toLocaleString()}\n` +
          `Total tokens: ${summary.totalTokens.toLocaleString()}\n` +
          `Estimated cost: $${summary.estimatedCost.toFixed(4)}`;
      }

      case 'month': {
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - 30);
        sinceDate.setHours(0, 0, 0, 0);
        const summary = getUsageSince(db, sinceDate);
        if (summary.totalRequests === 0) {
          return '**Last 30 Days Usage**\n\nNo usage recorded this month.';
        }
        return `**Last 30 Days Usage**\n\n` +
          `Requests: ${summary.totalRequests}\n` +
          `Input tokens: ${summary.totalInputTokens.toLocaleString()}\n` +
          `Output tokens: ${summary.totalOutputTokens.toLocaleString()}\n` +
          `Total tokens: ${summary.totalTokens.toLocaleString()}\n` +
          `Estimated cost: $${summary.estimatedCost.toFixed(4)}`;
      }

      case 'by-model':
      case 'breakdown':
      case 'costs':
      case 'models': {
        const todayOnly = parts[1]?.toLowerCase() === 'today';
        const summary = service.getTotalUsage(todayOnly);

        if (summary.totalRequests === 0) {
          return `**Cost Breakdown${todayOnly ? ' (Today)' : ''}**\n\nNo usage recorded.`;
        }

        const lines = [`**Cost Breakdown${todayOnly ? ' (Today)' : ''}**\n`];

        for (const [model, data] of Object.entries(summary.byModel)) {
          const modelShort = model.split('-').slice(1, 3).join('-');
          const totalTokens = data.inputTokens + data.outputTokens;
          lines.push(
            `**${modelShort}**\n` +
            `  Requests: ${data.requests}\n` +
            `  Input: ${data.inputTokens.toLocaleString()} tokens\n` +
            `  Output: ${data.outputTokens.toLocaleString()} tokens\n` +
            `  Total: ${totalTokens.toLocaleString()} tokens\n` +
            `  Cost: $${data.cost.toFixed(4)}`
          );
        }

        lines.push(
          `\n**Total: $${summary.estimatedCost.toFixed(4)}** (${summary.totalTokens.toLocaleString()} tokens across ${summary.totalRequests} requests)`
        );

        return lines.join('\n');
      }

      case 'by-user': {
        const records = db.query<{
          user_id: string;
          req_count: number;
          total_input: number;
          total_output: number;
          total_cost: number;
        }>(`SELECT user_id, COUNT(*) as req_count,
            SUM(input_tokens) as total_input,
            SUM(output_tokens) as total_output,
            SUM(estimated_cost) as total_cost
           FROM usage_records GROUP BY user_id ORDER BY total_cost DESC`, []);

        if (!records.length) {
          return '**Usage by User**\n\nNo usage recorded.';
        }

        const lines = ['**Usage by User**\n'];
        for (const row of records) {
          const totalTokens = row.total_input + row.total_output;
          lines.push(
            `**${row.user_id}**\n` +
            `  Requests: ${row.req_count}\n` +
            `  Tokens: ${totalTokens.toLocaleString()}\n` +
            `  Cost: $${row.total_cost.toFixed(4)}`
          );
        }
        return lines.join('\n');
      }

      case 'history': {
        const days = parseInt(parts[1] || '7', 10);
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);
        sinceDate.setHours(0, 0, 0, 0);

        const records = db.query<{
          day: string;
          req_count: number;
          total_tokens: number;
          total_cost: number;
        }>(`SELECT date(timestamp / 1000, 'unixepoch', 'localtime') as day,
            COUNT(*) as req_count,
            SUM(total_tokens) as total_tokens,
            SUM(estimated_cost) as total_cost
           FROM usage_records
           WHERE timestamp >= ?
           GROUP BY day ORDER BY day ASC`, [sinceDate.getTime()]);

        if (!records.length) {
          return `**Usage History (${days} days)**\n\nNo usage recorded.`;
        }

        const lines = [`**Usage History (${days} days)**\n`];
        for (const row of records) {
          const bar = '|'.repeat(Math.min(Math.ceil(row.total_cost * 100), 30));
          lines.push(
            `${row.day} | ${row.req_count} reqs | ${row.total_tokens.toLocaleString()} tokens | $${row.total_cost.toFixed(4)} ${bar}`
          );
        }
        return lines.join('\n');
      }

      case 'estimate': {
        // Estimate cost for a hypothetical request
        const model = parts[1] || 'claude-sonnet-4-6';
        const inputTokens = parseInt(parts[2] || '1000', 10);
        const outputTokens = parseInt(parts[3] || '500', 10);
        const cost = service.estimateCost(model, inputTokens, outputTokens);
        const modelShort = model.split('-').slice(1, 3).join('-');

        return `**Cost Estimate**\n\n` +
          `Model: ${modelShort}\n` +
          `Input: ${inputTokens.toLocaleString()} tokens\n` +
          `Output: ${outputTokens.toLocaleString()} tokens\n` +
          `Estimated cost: $${cost.toFixed(6)}`;
      }

      case 'user': {
        const userId = parts[1] || 'default';
        const todayOnly = parts[2]?.toLowerCase() === 'today';
        const summary = service.getUserUsage(userId, todayOnly);

        if (summary.totalRequests === 0) {
          return `**User Usage: ${userId}**\n\nNo usage recorded.`;
        }
        return `**User Usage: ${userId}${todayOnly ? ' (Today)' : ''}**\n\n` +
          service.formatSummary(summary);
      }

      case 'reset': {
        // Reset by dropping and recreating the table
        db.run('DELETE FROM usage_records');
        return '**Usage Reset**\n\nAll usage records cleared.';
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Helper: query usage since a given date using raw DB query */
function getUsageSince(db: any, since: Date) {
  const records = db.query(
    `SELECT model, input_tokens, output_tokens, estimated_cost
     FROM usage_records WHERE timestamp >= ?`,
    [since.getTime()]
  ) as Array<{ model: string; input_tokens: number; output_tokens: number; estimated_cost: number }>;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let estimatedCost = 0;

  for (const r of records) {
    totalInputTokens += r.input_tokens;
    totalOutputTokens += r.output_tokens;
    estimatedCost += r.estimated_cost;
  }

  return {
    totalRequests: records.length,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    estimatedCost,
  };
}

function helpText(): string {
  return `**Usage Commands**

  /usage                             - Usage summary (all time)
  /usage today                       - Today's usage
  /usage week                        - Last 7 days usage
  /usage month                       - Last 30 days usage
  /usage breakdown [today]           - Cost breakdown by model
  /usage by-model                    - Break down by model
  /usage by-user                     - Break down by user
  /usage history [days]              - Usage history over time
  /usage estimate <model> <in> <out> - Estimate cost
  /usage user <id> [today]           - User-specific usage
  /usage reset                       - Clear all usage data`;
}

export default {
  name: 'usage',
  description: 'Token usage tracking, cost estimation, and usage analytics',
  commands: ['/usage'],
  handle: execute,
};
