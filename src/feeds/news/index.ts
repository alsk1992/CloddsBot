/**
 * News Feed - RSS and Twitter monitoring for market-moving news
 */

import { EventEmitter } from 'events';
import { XMLParser } from 'fast-xml-parser';
import { NewsItem } from '../../types';
import { logger } from '../../utils/logger';

const RSS_FEEDS = [
  { name: 'Reuters Politics', url: 'https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best&best-sectors=political-general' },
  { name: 'AP News', url: 'https://rsshub.app/apnews/topics/apf-politics' },
  { name: 'Politico', url: 'https://www.politico.com/rss/politicopicks.xml' },
  { name: 'FiveThirtyEight', url: 'https://fivethirtyeight.com/politics/feed/' },
];

// Keywords that often move prediction markets
const MARKET_KEYWORDS = [
  // Politics
  'trump', 'biden', 'election', 'poll', 'polling', 'campaign', 'candidate',
  'republican', 'democrat', 'congress', 'senate', 'house', 'vote', 'ballot',
  'indictment', 'trial', 'verdict', 'impeach',
  // Economics
  'fed', 'federal reserve', 'rate cut', 'rate hike', 'inflation', 'cpi',
  'fomc', 'powell', 'interest rate', 'gdp', 'recession', 'employment',
  'jobs report', 'unemployment',
  // Crypto
  'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'sec', 'etf',
  // Sports
  'injury', 'injured', 'out for', 'ruled out', 'questionable',
];

export interface NewsFeed extends EventEmitter {
  start(): Promise<void>;
  stop(): void;
  getRecentNews(limit?: number): NewsItem[];
  searchNews(query: string): NewsItem[];
  getNewsForMarket(marketQuestion: string): NewsItem[];
}

interface RSSItem {
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  'dc:creator'?: string;
  author?: string;
}

export async function createNewsFeed(config?: {
  twitter?: { accounts: string[] };
}): Promise<NewsFeed> {
  const emitter = new EventEmitter() as NewsFeed;
  const newsCache: NewsItem[] = [];
  let pollInterval: NodeJS.Timeout | null = null;
  const parser = new XMLParser({ ignoreAttributes: false });

  async function fetchRSSFeed(feedUrl: string, feedName: string): Promise<NewsItem[]> {
    try {
      const response = await fetch(feedUrl, {
        headers: { 'User-Agent': 'Clodds/1.0 News Aggregator' },
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch ${feedName}: ${response.status}`);
        return [];
      }

      const xml = await response.text();
      const result = parser.parse(xml);

      const items: RSSItem[] = result?.rss?.channel?.item ||
                               result?.feed?.entry ||
                               [];

      return items.slice(0, 10).map((item, idx) => ({
        id: `${feedName}-${Date.now()}-${idx}`,
        source: feedName,
        sourceType: 'rss' as const,
        author: item['dc:creator'] || item.author,
        title: item.title || '',
        content: item.description,
        url: item.link || '',
        publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
        relevantMarkets: findRelevantMarkets(item.title || '', item.description || ''),
      }));
    } catch (error) {
      logger.error(`Error fetching ${feedName}:`, error);
      return [];
    }
  }

  function findRelevantMarkets(title: string, content: string): string[] {
    const text = `${title} ${content}`.toLowerCase();
    const matches: string[] = [];

    for (const keyword of MARKET_KEYWORDS) {
      if (text.includes(keyword.toLowerCase())) {
        matches.push(keyword);
      }
    }

    return [...new Set(matches)];
  }

  function isMarketMoving(item: NewsItem): boolean {
    return (item.relevantMarkets?.length || 0) >= 2;
  }

  async function pollAllFeeds(): Promise<void> {
    logger.info('Polling news feeds...');

    for (const feed of RSS_FEEDS) {
      const items = await fetchRSSFeed(feed.url, feed.name);

      for (const item of items) {
        // Check if we already have this news item
        const exists = newsCache.some(
          cached => cached.title === item.title && cached.source === item.source
        );

        if (!exists) {
          newsCache.unshift(item);

          // Emit event for market-moving news
          if (isMarketMoving(item)) {
            emitter.emit('news', item);
            logger.info(`Market-moving news: ${item.title}`);
          }
        }
      }
    }

    // Keep cache at reasonable size
    while (newsCache.length > 500) {
      newsCache.pop();
    }
  }

  // Assign methods to emitter
  emitter.start = async () => {
    logger.info('Starting news feed...');
    await pollAllFeeds();
    // Poll every 5 minutes
    pollInterval = setInterval(pollAllFeeds, 5 * 60 * 1000);
  };

  emitter.stop = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    logger.info('News feed stopped');
  };

  emitter.getRecentNews = (limit = 20) => {
    return newsCache.slice(0, limit);
  };

  emitter.searchNews = (query: string) => {
    const queryLower = query.toLowerCase();
    return newsCache.filter(item =>
      item.title.toLowerCase().includes(queryLower) ||
      item.content?.toLowerCase().includes(queryLower)
    );
  };

  emitter.getNewsForMarket = (marketQuestion: string) => {
    const words = marketQuestion.toLowerCase().split(/\s+/);
    const significantWords = words.filter(w => w.length > 3);

    return newsCache.filter(item => {
      const text = `${item.title} ${item.content || ''}`.toLowerCase();
      return significantWords.some(word => text.includes(word));
    }).slice(0, 10);
  };

  return emitter;
}
