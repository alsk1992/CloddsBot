/**
 * PredictIt CLI Skill (Read-Only)
 *
 * Commands:
 * /pi search [query] - Search markets
 * /pi market <id> - Get market details
 * /pi all - List all active markets
 */

import { createPredictItFeed, PredictItFeed } from '../../../feeds/predictit/index';
import { logger } from '../../../utils/logger';

let feed: PredictItFeed | null = null;

async function getFeed(): Promise<PredictItFeed> {
  if (feed) return feed;

  try {
    feed = await createPredictItFeed();
    await feed.connect();
    return feed;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize PredictIt feed');
    throw error;
  }
}

async function handleSearch(query: string): Promise<string> {
  const f = await getFeed();

  try {
    const markets = await f.searchMarkets(query || 'president');
    if (markets.length === 0) {
      return 'No markets found.';
    }

    let output = `**PredictIt Markets** (${markets.length} results)\n\n`;
    for (const market of markets.slice(0, 15)) {
      output += `**${market.question}**\n`;
      output += `  ID: \`${market.id}\`\n`;
      if (market.outcomes.length > 0) {
        output += `  Contracts:\n`;
        for (const o of market.outcomes.slice(0, 5)) {
          const price = o.price ? `${(o.price * 100).toFixed(0)}¢` : '-';
          output += `    - ${o.name}: ${price}\n`;
        }
      }
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error searching markets: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleMarket(marketId: string): Promise<string> {
  const f = await getFeed();

  try {
    const market = await f.getMarket(marketId);
    if (!market) {
      return `Market ${marketId} not found.`;
    }

    let output = `**${market.question}**\n\n`;
    output += `ID: \`${market.id}\`\n`;
    output += `Status: ${market.resolved ? 'Closed' : 'Open'}\n`;
    output += `URL: ${market.url}\n\n`;

    output += `**Contracts:**\n`;
    for (const o of market.outcomes) {
      const price = o.price ? `${(o.price * 100).toFixed(0)}¢` : '-';
      const prevPrice = o.previousPrice ? `${(o.previousPrice * 100).toFixed(0)}¢` : '-';
      output += `- **${o.name}**\n`;
      output += `  Last Trade: ${price}\n`;
      output += `  Previous Close: ${prevPrice}\n`;
    }

    return output;
  } catch (error) {
    return `Error fetching market: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleAll(): Promise<string> {
  const f = await getFeed();

  try {
    const markets = await f.getAllMarkets();
    if (markets.length === 0) {
      return 'No markets found.';
    }

    let output = `**All PredictIt Markets** (${markets.length})\n\n`;
    for (const market of markets.slice(0, 25)) {
      output += `**${market.question}** (\`${market.id}\`)\n`;
      if (market.outcomes.length > 0) {
        const topOutcome = market.outcomes[0];
        const price = topOutcome.price ? `${(topOutcome.price * 100).toFixed(0)}¢` : '-';
        output += `  ${topOutcome.name}: ${price}\n`;
      }
    }
    return output;
  } catch (error) {
    return `Error fetching markets: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    case 'search':
    case 'markets':
      return handleSearch(rest.join(' '));

    case 'market':
    case 'm':
      if (!rest[0]) return 'Usage: /pi market <id>';
      return handleMarket(rest[0]);

    case 'all':
    case 'list':
      return handleAll();

    case 'help':
    default:
      return `**PredictIt Commands** (Read-Only)

  /pi search [query]      - Search markets
  /pi market <id>         - Get market details
  /pi all                 - List all markets

**Examples:**
  /pi search election
  /pi market 6867

Note: PredictIt is read-only (no trading API).`;
  }
}

export default { execute };
