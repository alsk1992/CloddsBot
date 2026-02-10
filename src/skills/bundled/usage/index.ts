/**
 * Usage CLI Skill
 *
 * Commands:
 * /usage - Show usage summary (all time)
 * /usage today - Today's usage
 * /usage reset - Reset usage data
 * /usage breakdown - Cost breakdown by model
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

      case 'reset': {
        // Reset by dropping and recreating the table
        db.run('DELETE FROM usage_records');
        return '**Usage Reset**\n\nAll usage records cleared.';
      }

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

      case 'estimate': {
        // Estimate cost for a hypothetical request
        const model = parts[1] || 'claude-sonnet-4-20250514';
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

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Usage Commands**

  /usage                             - Usage summary (all time)
  /usage today                       - Today's usage
  /usage breakdown [today]           - Cost breakdown by model
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
