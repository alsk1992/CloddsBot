/**
 * Analytics CLI Skill
 *
 * Commands:
 * /analytics - View opportunity analytics summary
 * /analytics stats [--period Nd] - Performance statistics
 * /analytics platforms - Platform pair performance
 * /analytics opportunities [--type X] - Browse opportunities
 */

import type { Database } from '../../../db/index';

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'summary';

  try {
    const { createOpportunityAnalytics } = await import('../../../opportunity/analytics');
    const { createDatabase } = await import('../../../db/index');
    const db: Database = createDatabase();
    const analytics = createOpportunityAnalytics(db);

    switch (cmd) {
      case 'summary':
      case 'stats': {
        const periodFlag = parts.find((p: string) => p.match(/^\d+d$/));
        const days = periodFlag ? parseInt(periodFlag) : 30;
        const stats = analytics.getStats({ days });
        let output = `**Opportunity Analytics** (${days}d)\n\n`;
        output += `Total found: ${stats.totalFound}\n`;
        output += `Taken: ${stats.taken}\n`;
        output += `Win rate: ${(stats.winRate * 100).toFixed(1)}%\n`;
        output += `Total profit: $${stats.totalProfit.toLocaleString()}\n`;
        output += `Avg edge: ${stats.avgEdge.toFixed(2)}%\n`;
        return output;
      }

      case 'platforms': {
        const pairs = analytics.getPlatformPairs();
        if (!pairs.length) return 'No platform pair data yet.';
        let output = '**Platform Pair Performance**\n\n';
        for (const p of pairs) {
          output += `${p.platforms.join(' <-> ')}: ${p.count} opps, ${(p.winRate * 100).toFixed(0)}% WR, $${p.totalProfit.toFixed(2)} profit\n`;
        }
        return output;
      }

      case 'opportunities':
      case 'list': {
        const typeFlag = parts.indexOf('--type');
        const type = typeFlag >= 0 ? parts[typeFlag + 1] : undefined;
        const opps = analytics.getOpportunities({ type, limit: 20 });
        if (!opps.length) return 'No opportunities recorded yet.';
        let output = `**Recent Opportunities** (${opps.length})\n\n`;
        for (const o of opps) {
          output += `[${o.status}] ${o.type} — edge ${o.edgePct.toFixed(2)}%, score ${o.score}\n`;
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
  return `**Analytics Commands**

  /analytics                         - Summary stats
  /analytics stats [--period 7d]     - Performance statistics
  /analytics platforms               - Platform pair performance
  /analytics opportunities [--type X] - Browse opportunities`;
}

export default {
  name: 'analytics',
  description: 'Opportunity analytics, win rates, and performance tracking',
  commands: ['/analytics'],
  handle: execute,
};
