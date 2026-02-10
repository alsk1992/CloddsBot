/**
 * Market Index CLI Skill
 *
 * Commands:
 * /markets search <query> - Search markets
 * /markets trending - Trending markets
 * /markets stats - Index statistics
 * /markets sync - Force sync
 * /markets browse [category] - Browse by category
 */

import { logger } from '../../../utils/logger';

function helpText(): string {
  return `**Market Index Commands**

  /markets search <query>            - Search markets across all platforms
  /markets stats                     - Index statistics (by platform)
  /markets sync [--platform X]       - Force sync from platforms
  /markets browse [category]         - Browse by category

**Examples:**
  /markets search trump 2028
  /markets stats
  /markets sync --platform polymarket
  /markets browse politics`;
}

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const { createDatabase } = await import('../../../db/index');
    const { createEmbeddingsService } = await import('../../../embeddings/index');
    const { createMarketIndexService } = await import('../../../market-index/index');

    const db = createDatabase();
    const embeddings = createEmbeddingsService(db);
    const indexService = createMarketIndexService(db, embeddings);

    switch (cmd) {
      case 'search': {
        const query = parts.slice(1).join(' ');
        if (!query) return 'Usage: /markets search <query>\n\nExample: /markets search trump 2028';

        const results = await indexService.search({ query, limit: 10 });
        if (results.length === 0) {
          return `**Search: "${query}"**\n\nNo markets found. Try running \`/markets sync\` first to populate the index.`;
        }

        let output = `**Search: "${query}"** (${results.length} results)\n\n`;
        for (const r of results) {
          const score = (r.score * 100).toFixed(1);
          const platform = r.item.platform;
          const status = r.item.status || 'unknown';
          output += `[${platform}] ${r.item.question}\n`;
          output += `  Status: ${status} | Score: ${score}%`;
          if (r.item.url) output += ` | ${r.item.url}`;
          output += '\n\n';
        }
        return output;
      }

      case 'trending': {
        // Search for high-volume recent markets
        const results = await indexService.search({ query: 'trending popular', limit: 10 });
        if (results.length === 0) {
          return '**Trending Markets**\n\nNo markets indexed yet. Run `/markets sync` first.';
        }

        let output = `**Trending Markets** (${results.length})\n\n`;
        for (const r of results) {
          output += `[${r.item.platform}] ${r.item.question}\n`;
          if (r.item.volume24h) output += `  Volume 24h: $${r.item.volume24h.toLocaleString()}`;
          if (r.item.liquidity) output += ` | Liquidity: $${r.item.liquidity.toLocaleString()}`;
          output += '\n\n';
        }
        return output;
      }

      case 'stats': {
        const stats = indexService.stats();
        let output = `**Market Index Stats**\n\n`;
        output += `Total indexed: ${stats.total}\n`;
        output += `By platform:\n`;
        for (const [platform, count] of Object.entries(stats.byPlatform)) {
          output += `  ${platform}: ${count}\n`;
        }
        if (stats.lastSyncAt) {
          output += `\nLast sync: ${stats.lastSyncAt.toISOString()}\n`;
          if (stats.lastSyncIndexed !== undefined) output += `Last sync indexed: ${stats.lastSyncIndexed}\n`;
          if (stats.lastSyncDurationMs !== undefined) output += `Duration: ${stats.lastSyncDurationMs}ms\n`;
          if (stats.lastPruned) output += `Pruned: ${stats.lastPruned}\n`;
        } else {
          output += `\nLast sync: Never (run \`/markets sync\`)`;
        }
        return output;
      }

      case 'sync': {
        const platformFlag = parts.indexOf('--platform');
        const platforms = platformFlag >= 0 && parts[platformFlag + 1]
          ? [parts[platformFlag + 1] as 'polymarket' | 'kalshi' | 'manifold' | 'metaculus']
          : undefined;

        const syncMsg = platforms
          ? `Syncing ${platforms.join(', ')}...`
          : 'Syncing all platforms (polymarket, kalshi, manifold, metaculus)...';

        const result = await indexService.sync({ platforms });
        let output = `**Market Index Sync Complete**\n\n${syncMsg}\n\n`;
        output += `Total indexed: ${result.indexed}\n`;
        output += `By platform:\n`;
        for (const [platform, count] of Object.entries(result.byPlatform)) {
          output += `  ${platform}: ${count}\n`;
        }
        return output;
      }

      case 'browse': {
        const category = parts.slice(1).join(' ') || '';
        if (!category) {
          return '**Browse Markets**\n\nCategories: politics, crypto, sports, economics, science, entertainment, tech, weather\n\nUsage: /markets browse <category>';
        }

        const results = await indexService.search({ query: category, limit: 15 });
        if (results.length === 0) {
          return `**Browse: ${category}**\n\nNo markets found for this category. Try syncing first with \`/markets sync\`.`;
        }

        let output = `**Browse: ${category}** (${results.length} results)\n\n`;
        for (const r of results) {
          output += `[${r.item.platform}] ${r.item.question}\n`;
          if (r.item.url) output += `  ${r.item.url}\n`;
          output += '\n';
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

export default {
  name: 'market-index',
  description: 'Search, discover, and browse indexed markets across all platforms',
  commands: ['/markets', '/market-index'],
  handle: execute,
};
