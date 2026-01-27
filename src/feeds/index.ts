/**
 * Feed Manager - Market data from prediction platforms
 */

import { EventEmitter } from 'eventemitter3';
import { createPolymarketFeed } from './polymarket/index';
import { createKalshiFeed } from './kalshi/index';
import { createManifoldFeed } from './manifold/index';
import { createMetaculusFeed } from './metaculus/index';
import { createPredictItFeed } from './predictit/index';
import { createDriftFeed } from './drift/index';
import { createNewsFeed, NewsFeed } from './news/index';
import { analyzeEdge, calculateKelly, EdgeAnalysis } from './external/index';
import { logger } from '../utils/logger';
import type { Config, Market, PriceUpdate, Orderbook, NewsItem, Platform } from '../types';

export interface FeedManager extends EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;

  // Market data
  getMarket(marketId: string, platform?: string): Promise<Market | null>;
  searchMarkets(query: string, platform?: string): Promise<Market[]>;
  getPrice(platform: string, marketId: string): Promise<number | null>;
  getOrderbook(platform: string, marketId: string): Promise<Orderbook | null>;

  // Subscriptions
  subscribePrice(
    platform: string,
    marketId: string,
    callback: (update: PriceUpdate) => void
  ): () => void;

  // News
  getRecentNews(limit?: number): NewsItem[];
  searchNews(query: string): NewsItem[];
  getNewsForMarket(marketQuestion: string): NewsItem[];

  // Edge detection
  analyzeEdge(
    marketId: string,
    question: string,
    price: number,
    category: 'politics' | 'economics' | 'sports' | 'other'
  ): Promise<EdgeAnalysis>;
  calculateKelly(price: number, estimate: number, bankroll: number): {
    fullKelly: number;
    halfKelly: number;
    quarterKelly: number;
  };
}

interface FeedAdapter {
  connect?(): Promise<void>;
  start?(): Promise<void>;
  disconnect?(): void;
  stop?(): void;
  searchMarkets(query: string): Promise<Market[]>;
  getMarket(id: string): Promise<Market | null>;
  subscribeToMarket?(id: string): void;
  unsubscribeFromMarket?(id: string): void;
  on?(event: string, handler: (...args: unknown[]) => void): void;
}

export async function createFeedManager(config: Config['feeds']): Promise<FeedManager> {
  const emitter = new EventEmitter() as FeedManager;
  const feeds = new Map<string, FeedAdapter>();
  let newsFeed: NewsFeed | null = null;

  // Initialize Polymarket
  if (config.polymarket?.enabled) {
    logger.info('Initializing Polymarket feed');
    const polymarket = await createPolymarketFeed();
    feeds.set('polymarket', polymarket as unknown as FeedAdapter);

    polymarket.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });
  }

  // Initialize Kalshi
  if (config.kalshi?.enabled) {
    logger.info('Initializing Kalshi feed');
    const kalshi = await createKalshiFeed({
      email: config.kalshi.email,
      password: config.kalshi.password,
    });
    feeds.set('kalshi', kalshi as unknown as FeedAdapter);

    kalshi.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });
  }

  // Initialize Manifold
  if (config.manifold?.enabled) {
    logger.info('Initializing Manifold feed');
    const manifold = await createManifoldFeed();
    feeds.set('manifold', manifold as unknown as FeedAdapter);

    manifold.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });
  }

  // Initialize Metaculus
  if (config.metaculus?.enabled) {
    logger.info('Initializing Metaculus feed');
    const metaculus = await createMetaculusFeed();
    feeds.set('metaculus', metaculus as unknown as FeedAdapter);
  }

  // Initialize PredictIt (read-only)
  // Always enable PredictIt since it's free and read-only
  logger.info('Initializing PredictIt feed (read-only)');
  const predictit = await createPredictItFeed();
  feeds.set('predictit', predictit as unknown as FeedAdapter);

  // Initialize Drift BET (Solana)
  if (config.drift?.enabled) {
    logger.info('Initializing Drift BET feed');
    const drift = await createDriftFeed();
    feeds.set('drift', drift as unknown as FeedAdapter);

    drift.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });
  }

  // Initialize News feed
  if (config.news?.enabled) {
    logger.info('Initializing News feed');
    newsFeed = await createNewsFeed({
      twitter: config.news.twitter,
    });

    newsFeed.on('news', (item: NewsItem) => {
      emitter.emit('news', item);
    });
  }

  // Start method
  emitter.start = async () => {
    const startPromises: Promise<void>[] = [];

    for (const [name, feed] of feeds) {
      logger.info(`Starting ${name} feed`);
      if (feed.start) {
        startPromises.push(feed.start());
      } else if (feed.connect) {
        startPromises.push(feed.connect());
      }
    }

    if (newsFeed) {
      startPromises.push(newsFeed.start());
    }

    await Promise.all(startPromises);
    logger.info('All feeds started');
  };

  // Stop method
  emitter.stop = async () => {
    for (const [name, feed] of feeds) {
      logger.info(`Stopping ${name} feed`);
      if (feed.stop) {
        feed.stop();
      } else if (feed.disconnect) {
        feed.disconnect();
      }
    }

    if (newsFeed) {
      newsFeed.stop();
    }
  };

  // Get market by ID
  emitter.getMarket = async (marketId: string, platform?: string): Promise<Market | null> => {
    if (platform) {
      const feed = feeds.get(platform);
      if (feed) {
        return feed.getMarket(marketId);
      }
      return null;
    }

    // Try all feeds
    for (const [, feed] of feeds) {
      const market = await feed.getMarket(marketId);
      if (market) return market;
    }
    return null;
  };

  // Search markets
  emitter.searchMarkets = async (query: string, platform?: string): Promise<Market[]> => {
    const results: Market[] = [];

    if (platform) {
      const feed = feeds.get(platform);
      if (feed) {
        const markets = await feed.searchMarkets(query);
        results.push(...markets);
      }
    } else {
      // Search all feeds in parallel
      const searches = [...feeds].map(async ([name, feed]) => {
        try {
          const markets = await feed.searchMarkets(query);
          return markets;
        } catch (error) {
          logger.warn(`Search failed for ${name}:`, error);
          return [];
        }
      });

      const allResults = await Promise.all(searches);
      for (const markets of allResults) {
        results.push(...markets);
      }
    }

    // Sort by volume (descending)
    return results.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
  };

  // Get price
  emitter.getPrice = async (platform: string, marketId: string): Promise<number | null> => {
    const market = await emitter.getMarket(marketId, platform);
    if (market && market.outcomes.length > 0) {
      return market.outcomes[0].price;
    }
    return null;
  };

  // Get orderbook (placeholder)
  emitter.getOrderbook = async (_platform: string, _marketId: string): Promise<Orderbook | null> => {
    // TODO: Implement orderbook fetching for platforms that support it
    return null;
  };

  // Subscribe to price updates
  emitter.subscribePrice = (
    platform: string,
    marketId: string,
    callback: (update: PriceUpdate) => void
  ): (() => void) => {
    const feed = feeds.get(platform) as FeedAdapter & {
      subscribeToMarket?: (id: string) => void;
      unsubscribeFromMarket?: (id: string) => void;
    };

    if (feed?.subscribeToMarket) {
      feed.subscribeToMarket(marketId);
    }

    // Listen for price events matching this market
    const handler = (update: PriceUpdate) => {
      if (update.platform === platform && update.marketId === marketId) {
        callback(update);
      }
    };

    emitter.on('price', handler);

    return () => {
      emitter.off('price', handler);
      if (feed?.unsubscribeFromMarket) {
        feed.unsubscribeFromMarket(marketId);
      }
    };
  };

  // News methods
  emitter.getRecentNews = (limit = 20): NewsItem[] => {
    if (!newsFeed) return [];
    return newsFeed.getRecentNews(limit);
  };

  emitter.searchNews = (query: string): NewsItem[] => {
    if (!newsFeed) return [];
    return newsFeed.searchNews(query);
  };

  emitter.getNewsForMarket = (marketQuestion: string): NewsItem[] => {
    if (!newsFeed) return [];
    return newsFeed.getNewsForMarket(marketQuestion);
  };

  // Edge detection
  emitter.analyzeEdge = async (
    marketId: string,
    question: string,
    price: number,
    category: 'politics' | 'economics' | 'sports' | 'other'
  ): Promise<EdgeAnalysis> => {
    return analyzeEdge(marketId, question, price, category);
  };

  emitter.calculateKelly = (price: number, estimate: number, bankroll: number) => {
    return calculateKelly(price, estimate, bankroll);
  };

  return emitter;
}
