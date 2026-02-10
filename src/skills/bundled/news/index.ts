/**
 * News CLI Skill
 *
 * Commands:
 * /news - Show recent market-moving news
 * /news <query> - Search news by keyword
 * /news for <market> - Find news relevant to a market
 * /news alert <keyword> - Set up a news alert (informational)
 */

import { createNewsFeed, NewsFeed } from '../../../feeds/news/index';
import { logger } from '../../../utils/logger';

let feed: NewsFeed | null = null;

async function getFeed(): Promise<NewsFeed> {
  if (feed) return feed;

  try {
    feed = await createNewsFeed({
      twitter: {
        accounts: ['polyaborama', 'Kalshi', 'MetaculusHQ', 'NateSilver538', 'business'],
        bearerToken: process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN,
      },
    });
    await feed.start();
    return feed;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize news feed');
    throw error;
  }
}

async function handleRecentNews(query?: string): Promise<string> {
  try {
    const f = await getFeed();

    if (query) {
      const items = f.searchNews(query);
      if (items.length === 0) {
        return `No news found matching "${query}".`;
      }

      let output = `**News: "${query}"** (${items.length} results)\n\n`;
      for (const item of items.slice(0, 15)) {
        const ago = getTimeAgo(item.publishedAt);
        output += `**${item.title}**\n`;
        output += `  Source: ${item.source} | ${ago}\n`;
        if (item.url) {
          output += `  ${item.url}\n`;
        }
        if (item.relevantMarkets && item.relevantMarkets.length > 0) {
          output += `  Keywords: ${item.relevantMarkets.join(', ')}\n`;
        }
        output += '\n';
      }
      return output;
    }

    const items = f.getRecentNews(15);
    if (items.length === 0) {
      return 'No recent news available. Feed may still be loading.';
    }

    let output = `**Recent Market-Moving News** (${items.length} items)\n\n`;
    for (const item of items) {
      const ago = getTimeAgo(item.publishedAt);
      output += `**${item.title}**\n`;
      output += `  Source: ${item.source} | ${ago}\n`;
      if (item.url) {
        output += `  ${item.url}\n`;
      }
      if (item.relevantMarkets && item.relevantMarkets.length > 0) {
        output += `  Keywords: ${item.relevantMarkets.join(', ')}\n`;
      }
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error fetching news: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleNewsForMarket(marketQuestion: string): Promise<string> {
  try {
    const f = await getFeed();
    const items = f.getNewsForMarket(marketQuestion);

    if (items.length === 0) {
      return `No news found related to "${marketQuestion}".`;
    }

    let output = `**News for "${marketQuestion}"** (${items.length} results)\n\n`;
    for (const item of items) {
      const ago = getTimeAgo(item.publishedAt);
      output += `**${item.title}**\n`;
      output += `  Source: ${item.source} | ${ago}\n`;
      if (item.url) {
        output += `  ${item.url}\n`;
      }
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error fetching news: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function handleAlert(keyword: string): string {
  if (!keyword) {
    return 'Usage: /news alert <keyword>';
  }
  return `News alerts are not yet implemented. Use \`/alerts\` for price-based alerts instead.\n\nKeyword requested: "${keyword}"`;
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || '';
  const rest = parts.slice(1);

  switch (command) {
    case 'for':
      if (rest.length === 0) return 'Usage: /news for <market question>';
      return handleNewsForMarket(rest.join(' '));

    case 'alert':
      return handleAlert(rest.join(' '));

    case 'help':
      return `**News Commands**

**Browse News:**
  /news                          - Recent market-moving news
  /news <query>                  - Search news by keyword
  /news for <market>             - Find news for a market

**Alerts:**
  /news alert <keyword>          - Set up a news alert

**Examples:**
  /news trump
  /news fed
  /news for "Trump 2028"
  /news alert "fed rate"`;

    default:
      // If there's no recognized subcommand, treat entire args as a search query
      return handleRecentNews(args.trim() || undefined);
  }
}

export default {
  name: 'news',
  description: 'Monitor news and correlate with prediction market movements',
  commands: ['/news'],
  handle: execute,
};
