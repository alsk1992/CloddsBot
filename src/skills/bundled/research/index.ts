/**
 * Research CLI Skill
 *
 * Commands:
 * /research <query> - Research a prediction market question
 * /research baserate <event> - Look up base rates
 * /research resolution <market-id> - Resolution rules for a market
 * /research markets <query> - Search indexed markets
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const { createMarketIndexService } = await import('../../../market-index/index');
    const { createDatabase } = await import('../../../db/index');
    const { createEmbeddingsService } = await import('../../../embeddings/index');
    const db = createDatabase();
    const embeddings = createEmbeddingsService(db);
    const indexService = createMarketIndexService(db, embeddings);

    switch (cmd) {
      case 'markets':
      case 'search': {
        const query = parts.slice(1).join(' ');
        if (!query) return 'Usage: /research markets <query>';
        const results = await indexService.search({ query, limit: 10 });
        if (!results.length) return `No markets found matching "${query}".`;
        let output = `**Market Search: "${query}"** (${results.length} results)\n\n`;
        for (const r of results) {
          const entry = r.item as any;
          output += `**${entry.question}**\n`;
          output += `  Platform: ${entry.platform} | ID: ${entry.marketId}\n`;
          if (entry.probability !== null && entry.probability !== undefined) {
            output += `  Current probability: ${(entry.probability * 100).toFixed(1)}%\n`;
          }
          if (entry.volume) output += `  Volume: $${entry.volume.toFixed(0)}\n`;
          output += '\n';
        }
        return output;
      }

      case 'baserate':
      case 'base-rate': {
        const query = parts.slice(1).join(' ');
        if (!query) return 'Usage: /research baserate <event description>';
        // Search market index for similar past markets
        const results = await indexService.search({ query, limit: 5 });
        let output = `**Base Rate Research: "${query}"**\n\n`;
        if (results.length > 0) {
          output += `Found ${results.length} related markets:\n\n`;
          for (const r of results) {
            const entry = r.item as any;
            output += `- ${entry.question}`;
            if (entry.probability !== null && entry.probability !== undefined) {
              output += ` (${(entry.probability * 100).toFixed(1)}%)`;
            }
            output += ` [${entry.platform}]\n`;
          }
          output += '\nThese market probabilities can serve as reference points for base rate estimation.';
        } else {
          output += 'No similar markets found in index. Try syncing with `/market-index sync`.';
        }
        return output;
      }

      case 'resolution': {
        if (!parts[1]) return 'Usage: /research resolution <market-id>';
        const marketId = parts[1];
        const results = await indexService.search({ query: marketId, limit: 1 });
        if (!results.length) return `Market \`${marketId}\` not found in index.`;
        const entry = results[0].item;
        let output = `**Resolution: ${entry.question}**\n\n`;
        output += `Platform: ${entry.platform}\n`;
        output += `Market ID: ${entry.marketId}\n`;
        if (entry.endDate) output += `End date: ${entry.endDate}\n`;
        if (entry.description) output += `\nDescription:\n${entry.description}\n`;
        return output;
      }

      case 'stats': {
        const stats = indexService.stats();
        let output = '**Market Index Stats**\n\n';
        output += `Total markets: ${stats.total}\n`;
        for (const [platform, count] of Object.entries(stats.byPlatform)) {
          output += `  ${platform}: ${count}\n`;
        }
        if (stats.lastSyncAt) output += `\nLast sync: ${stats.lastSyncAt.toISOString()}\n`;
        return output;
      }

      case 'sync': {
        const result = await indexService.sync();
        return `**Index Synced**\n\nIndexed: ${result.indexed} markets\n${Object.entries(result.byPlatform).map(([p, n]) => `  ${p}: ${n}`).join('\n')}`;
      }

      case 'help':
        return helpText();

      default: {
        // Treat as a general research query - search the market index
        const query = args.trim();
        if (query) {
          const results = await indexService.search({ query, limit: 10 });
          if (!results.length) return `No markets found for "${query}". Try /research sync to update the index.`;
          let output = `**Research: "${query}"** (${results.length} results)\n\n`;
          for (const r of results) {
            const entry = r.item as any;
            output += `**${entry.question}**\n`;
            output += `  Platform: ${entry.platform}`;
            if (entry.probability !== null && entry.probability !== undefined) {
              output += ` | Prob: ${(entry.probability * 100).toFixed(1)}%`;
            }
            if (entry.volume) output += ` | Vol: $${entry.volume.toFixed(0)}`;
            output += '\n\n';
          }
          return output;
        }
        return helpText();
      }
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Research Commands**

  /research <query>                    - Search markets & research a topic
  /research markets <query>            - Search indexed markets
  /research baserate <event>           - Base rate estimation from similar markets
  /research resolution <market-id>     - Resolution rules & description
  /research stats                      - Market index statistics
  /research sync                       - Sync market index

Shortcuts:
  /baserate <event>                    - Base rate lookup`;
}

export default {
  name: 'research',
  description: 'Research prediction markets - base rates, resolution rules, historical data',
  commands: ['/research', '/baserate'],
  handle: execute,
};
