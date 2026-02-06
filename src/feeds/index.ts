/**
 * Feed Manager - Market data from prediction platforms
 */

import { EventEmitter } from 'eventemitter3';
import { createPolymarketFeed } from './polymarket/index';
import { createPolymarketRtds, PolymarketRtds } from './polymarket/rtds';
import { createKalshiFeed } from './kalshi/index';
import { createManifoldFeed } from './manifold/index';
import { createMetaculusFeed } from './metaculus/index';
import { createPredictItFeed } from './predictit/index';
import { createDriftFeed } from './drift/index';
import { createBetfairFeed, BetfairFeed } from './betfair/index';
import { createSmarketsFeed, SmarketsFeed } from './smarkets/index';
import { createOpinionFeed, OpinionFeed } from './opinion/index';
import { createVirtualsFeed, VirtualsFeed } from './virtuals/index';
import { createPredictFunFeed, PredictFunFeed } from './predictfun/index';
import { createHedgehogFeed, HedgehogFeed } from './hedgehog/index';
import { createNewsFeed, NewsFeed } from './news/index';
import { analyzeEdge, calculateKelly, EdgeAnalysis } from './external/index';
import { createMarketCache, type MarketCacheKey } from '../cache/index';
import { logger } from '../utils/logger';
import { getGlobalFeedRegistry } from './registry';
import { registerAllFeeds } from './descriptors';
import type { Config, Market, PriceUpdate, OrderbookUpdate, Orderbook, NewsItem, Platform } from '../types';

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

  // Cache stats
  getCacheStats(): { hits: number; misses: number; size: number; hitRate: number };
  clearCache(): void;

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
  getRtdsEvents?(): PolymarketRtds | null;
}

interface FeedAdapter {
  connect?(): Promise<void>;
  start?(): Promise<void>;
  disconnect?(): void;
  stop?(): void;
  searchMarkets(query: string): Promise<Market[]>;
  getMarket(id: string): Promise<Market | null>;
  getOrderbook?(platform: string, marketId: string): Promise<Orderbook | null>;
  subscribeToMarket?(id: string): void;
  unsubscribeFromMarket?(id: string): void;
  on?(event: string, handler: (...args: unknown[]) => void): void;
}

export async function createFeedManager(config: Config['feeds']): Promise<FeedManager> {
  const emitter = new EventEmitter() as FeedManager;
  const feeds = new Map<string, FeedAdapter>();
  let newsFeed: NewsFeed | null = null;
  let polymarketRtds: PolymarketRtds | null = null;

  // Market cache for getMarket lookups (30s TTL, max 500 entries)
  const marketCache = createMarketCache<Market | null>({
    maxSize: 500,
    defaultTtl: 30000,
    onEvict: (key, _value, reason) => {
      if (reason !== 'manual') {
        logger.debug({ platform: key.platform, marketId: key.marketId, reason }, 'Market cache eviction');
      }
    },
  });

  // Subscription tracking for deduplication
  const activeSubscriptions = new Map<string, Set<(update: PriceUpdate) => void>>();

  // Initialize feed registry (non-blocking, registers descriptors only)
  registerAllFeeds();
  const registry = getGlobalFeedRegistry();

  // Helper to mark feeds as active in registry
  const trackFeed = (name: string, feed: FeedAdapter) => {
    feeds.set(name, feed);
    registry.markActive(name);
  };

  // Initialize Polymarket
  if (config.polymarket?.enabled) {
    logger.info('Initializing Polymarket feed');
    const polymarket = await createPolymarketFeed();
    trackFeed('polymarket', polymarket as unknown as FeedAdapter);

    polymarket.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });

    polymarket.on('orderbook', (update: OrderbookUpdate) => {
      emitter.emit('orderbook', update);
    });

    if (config.polymarket.rtds?.enabled) {
      polymarketRtds = createPolymarketRtds({
        enabled: true,
        url: config.polymarket.rtds.url,
        pingIntervalMs: config.polymarket.rtds.pingIntervalMs,
        reconnectDelayMs: config.polymarket.rtds.reconnectDelayMs,
        subscriptions: config.polymarket.rtds.subscriptions,
      });

      polymarketRtds.on('rtds', (msg) => {
        emitter.emit('rtds', msg);
      });
    }
  }

  // Initialize Kalshi
  if (config.kalshi?.enabled) {
    logger.info('Initializing Kalshi feed');
    const kalshi = await createKalshiFeed({
      apiKeyId: config.kalshi.apiKeyId,
      privateKeyPem: config.kalshi.privateKeyPem,
      privateKeyPath: config.kalshi.privateKeyPath,
      email: config.kalshi.email,
      password: config.kalshi.password,
    });
    trackFeed('kalshi', kalshi as unknown as FeedAdapter);

    kalshi.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });
  }

  // Initialize Manifold
  if (config.manifold?.enabled) {
    logger.info('Initializing Manifold feed');
    const manifold = await createManifoldFeed();
    trackFeed('manifold', manifold as unknown as FeedAdapter);

    manifold.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });
  }

  // Initialize Metaculus
  if (config.metaculus?.enabled) {
    logger.info('Initializing Metaculus feed');
    const metaculus = await createMetaculusFeed();
    trackFeed('metaculus', metaculus as unknown as FeedAdapter);
  }

  // Initialize PredictIt (read-only)
  // Always enable PredictIt since it's free and read-only
  logger.info('Initializing PredictIt feed (read-only)');
  const predictit = await createPredictItFeed();
  trackFeed('predictit', predictit as unknown as FeedAdapter);

  // Initialize Drift BET (Solana)
  if (config.drift?.enabled) {
    logger.info('Initializing Drift BET feed');
    const drift = await createDriftFeed({
      betApiUrl: config.drift.betApiUrl,
      requestTimeoutMs: config.drift.requestTimeoutMs,
    });
    trackFeed('drift', drift as unknown as FeedAdapter);

    drift.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });
  }

  // Initialize Betfair (sports betting exchange)
  if ((config as any).betfair?.enabled) {
    logger.info('Initializing Betfair feed');
    const betfairConfig = (config as any).betfair;
    const betfair = await createBetfairFeed({
      appKey: betfairConfig.appKey,
      username: betfairConfig.username,
      password: betfairConfig.password,
      sessionToken: betfairConfig.sessionToken,
    });
    trackFeed('betfair', betfair as unknown as FeedAdapter);

    betfair.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });
  }

  // Initialize Smarkets (betting exchange with lower fees)
  if ((config as any).smarkets?.enabled) {
    logger.info('Initializing Smarkets feed');
    const smarketsConfig = (config as any).smarkets;
    const smarkets = await createSmarketsFeed({
      apiToken: smarketsConfig.apiToken,
      sessionToken: smarketsConfig.sessionToken,
    });
    trackFeed('smarkets', smarkets as unknown as FeedAdapter);

    smarkets.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });
  }

  // Initialize Opinion.trade (BNB Chain prediction market)
  if ((config as any).opinion?.enabled) {
    logger.info('Initializing Opinion.trade feed');
    const opinionConfig = (config as any).opinion;
    const opinion = await createOpinionFeed({
      apiKey: opinionConfig.apiKey,
    });
    trackFeed('opinion', opinion as unknown as FeedAdapter);

    opinion.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });

    opinion.on('orderbook', (update: OrderbookUpdate) => {
      emitter.emit('orderbook', update);
    });
  }

  // Initialize Virtuals Protocol (Base chain AI agents)
  if ((config as any).virtuals?.enabled) {
    logger.info('Initializing Virtuals Protocol feed');
    const virtualsConfig = (config as any).virtuals;
    const virtuals = await createVirtualsFeed({
      privateKey: virtualsConfig.privateKey,
      rpcUrl: virtualsConfig.rpcUrl,
      minMarketCap: virtualsConfig.minMarketCap,
      categories: virtualsConfig.categories,
    });
    trackFeed('virtuals', virtuals as unknown as FeedAdapter);

    virtuals.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });
  }

  // Initialize Predict.fun (BNB Chain prediction market)
  if ((config as any).predictfun?.enabled) {
    logger.info('Initializing Predict.fun feed');
    const predictfunConfig = (config as any).predictfun;
    const predictfun = await createPredictFunFeed({
      apiKey: predictfunConfig.apiKey,
    });
    trackFeed('predictfun', predictfun as unknown as FeedAdapter);

    predictfun.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });
  }

  // Initialize Hedgehog Markets (Solana prediction market)
  if ((config as any).hedgehog?.enabled) {
    logger.info('Initializing Hedgehog Markets feed');
    const hedgehogConfig = (config as any).hedgehog;
    const hedgehog = await createHedgehogFeed({
      apiKey: hedgehogConfig.apiKey,
      wsUrl: hedgehogConfig.wsUrl,
      pollIntervalMs: hedgehogConfig.pollIntervalMs,
      minVolume: hedgehogConfig.minVolume,
      categories: hedgehogConfig.categories,
    });
    trackFeed('hedgehog', hedgehog as unknown as FeedAdapter);

    hedgehog.on('price', (update: PriceUpdate) => {
      emitter.emit('price', update);
    });

    hedgehog.on('orderbook', (update: OrderbookUpdate) => {
      emitter.emit('orderbook', update);
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

  // Start method — per-feed error isolation so one broken feed doesn't block the rest
  emitter.start = async () => {
    const startPromises: Promise<void>[] = [];

    for (const [name, feed] of feeds) {
      logger.info(`Starting ${name} feed`);
      const p = (feed.start ? feed.start() : feed.connect ? feed.connect() : Promise.resolve())
        .catch((error: unknown) => {
          logger.error({ error, feed: name }, `Failed to start ${name} feed — skipping`);
        });
      startPromises.push(p);
    }

    if (newsFeed) {
      startPromises.push(
        newsFeed.start().catch((error: unknown) => {
          logger.error({ error }, 'Failed to start news feed — skipping');
        })
      );
    }
    if (polymarketRtds) {
      startPromises.push(
        polymarketRtds.start().catch((error: unknown) => {
          logger.error({ error }, 'Failed to start Polymarket RTDS — skipping');
        })
      );
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
      registry.markInactive(name);
    }

    if (newsFeed) {
      newsFeed.stop();
    }
    if (polymarketRtds) {
      await polymarketRtds.stop();
    }
  };

  // Get market by ID (with caching)
  emitter.getMarket = async (marketId: string, platform?: string): Promise<Market | null> => {
    const cacheKey: MarketCacheKey = { platform, marketId };

    // Check cache first
    const cached = marketCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    let market: Market | null = null;

    if (platform) {
      const feed = feeds.get(platform);
      if (feed) {
        market = await feed.getMarket(marketId);
      }
    } else {
      // Try all feeds
      for (const [, feed] of feeds) {
        market = await feed.getMarket(marketId);
        if (market) break;
      }
    }

    // Cache the result (including null to avoid repeated lookups)
    marketCache.set(cacheKey, market);
    return market;
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

  // Get orderbook
  emitter.getOrderbook = async (platform: string, marketId: string): Promise<Orderbook | null> => {
    const feed = feeds.get(platform) as FeedAdapter | undefined;

    if (feed?.getOrderbook) {
      return feed.getOrderbook(platform, marketId);
    }

    if (feed?.getMarket) {
      const market = await feed.getMarket(marketId);
      if (!market || !market.outcomes.length) return null;
      const outcome = market.outcomes[0];
      if (!Number.isFinite(outcome.price)) return null;
      const sizeSource = outcome.volume24h || market.volume24h || 0;
      const size = Math.max(1, sizeSource > 0 ? sizeSource : 1);
      return {
        platform: market.platform,
        marketId: market.id,
        outcomeId: outcome.id,
        bids: [[outcome.price, size]],
        asks: [[outcome.price, size]],
        spread: 0,
        midPrice: outcome.price,
        timestamp: Date.now(),
      };
    }

    return null;
  };

  // Subscribe to price updates (with deduplication)
  emitter.subscribePrice = (
    platform: string,
    marketId: string,
    callback: (update: PriceUpdate) => void
  ): (() => void) => {
    const subKey = `${platform}:${marketId}`;
    const feed = feeds.get(platform) as FeedAdapter & {
      subscribeToMarket?: (id: string) => void;
      unsubscribeFromMarket?: (id: string) => void;
    };

    // Get or create subscription set for this market
    let callbacks = activeSubscriptions.get(subKey);
    const isFirstSubscription = !callbacks || callbacks.size === 0;

    if (!callbacks) {
      callbacks = new Set();
      activeSubscriptions.set(subKey, callbacks);
    }

    // Only subscribe to feed if this is the first callback for this market
    if (isFirstSubscription && feed?.subscribeToMarket) {
      feed.subscribeToMarket(marketId);
      logger.debug({ platform, marketId }, 'New market subscription');
    }

    callbacks.add(callback);

    // Listen for price events matching this market (shared handler)
    const handler = (update: PriceUpdate) => {
      if (update.platform === platform && update.marketId === marketId) {
        callback(update);
      }
    };

    emitter.on('price', handler);

    return () => {
      emitter.off('price', handler);

      // Remove callback from set
      const subs = activeSubscriptions.get(subKey);
      if (subs) {
        subs.delete(callback);

        // Only unsubscribe from feed if no more callbacks
        if (subs.size === 0) {
          activeSubscriptions.delete(subKey);
          if (feed?.unsubscribeFromMarket) {
            feed.unsubscribeFromMarket(marketId);
            logger.debug({ platform, marketId }, 'Market subscription removed');
          }
        }
      }
    };
  };

  emitter.getRtdsEvents = () => polymarketRtds;

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

  // Cache stats and management
  emitter.getCacheStats = () => {
    const stats = marketCache.stats();
    return {
      hits: stats.hits,
      misses: stats.misses,
      size: stats.size,
      hitRate: stats.hitRate,
    };
  };

  emitter.clearCache = () => {
    marketCache.clear();
    logger.info('Market cache cleared');
  };

  return emitter;
}

// Re-export freshness tracking
export * from './freshness';

// Re-export feed registry
export { getGlobalFeedRegistry, FeedCapability } from './registry';
export type { FeedRegistry, FeedDescriptor, FeedSummary, FeedCategory, ConnectionType } from './registry';
export { registerAllFeeds } from './descriptors';
