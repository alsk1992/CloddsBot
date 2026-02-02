/**
 * Smart Order Router
 *
 * Routes orders to the best platform based on:
 * - Price (best bid/ask)
 * - Liquidity (available size at price)
 * - Fees (maker/taker)
 * - Speed (execution latency)
 *
 * Supports:
 * - Polymarket
 * - Kalshi
 * - EVM DEXes (Uniswap, 1inch)
 * - Solana DEXes (Jupiter, Raydium)
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '../utils/logger';
import type { Platform, Orderbook } from '../types';
import type { FeedManager } from '../feeds/index';
import { getMarketFeatures, getLiquidityScore, getSpreadPct } from '../services/feature-engineering';

// =============================================================================
// TYPES
// =============================================================================

export type RoutingMode = 'best_price' | 'best_liquidity' | 'lowest_fee' | 'balanced';

export interface SmartRouterConfig {
  /** Routing optimization mode (default: 'balanced') */
  mode?: RoutingMode;
  /** Enabled platforms for routing */
  enabledPlatforms?: Platform[];
  /** Maximum acceptable slippage % (default: 1) */
  maxSlippage?: number;
  /** Prefer maker orders when possible (default: true) */
  preferMaker?: boolean;
  /** Split orders across platforms if beneficial (default: false) */
  allowSplitting?: boolean;
  /** Maximum number of platforms to split across (default: 3) */
  maxSplitPlatforms?: number;
  /** Minimum improvement % to justify split (default: 0.5) */
  minSplitImprovement?: number;
  /** Use feature-based scoring for route selection (default: true) */
  useFeatureScoring?: boolean;
  /** Weight for liquidity score in balanced mode (default: 0.2) */
  liquidityWeight?: number;
}

export interface RouteQuote {
  platform: Platform;
  price: number;
  availableSize: number;
  estimatedFees: number;
  netPrice: number; // price + fees
  slippage: number;
  executionTimeMs?: number;
  isMaker: boolean;
}

export interface RoutingResult {
  bestRoute: RouteQuote;
  allRoutes: RouteQuote[];
  splitRoutes?: RouteQuote[];
  totalSavings: number;
  recommendation: string;
}

export interface OrderRouteParams {
  /** Market identifier (matched across platforms) */
  marketId: string;
  /** Alternative identifiers for cross-platform matching */
  alternativeIds?: Record<Platform, string>;
  /** Order side */
  side: 'buy' | 'sell';
  /** Order size in $ */
  size: number;
  /** Limit price (optional for market orders) */
  limitPrice?: number;
}

export interface SmartRouterEvents {
  routeFound: (result: RoutingResult) => void;
  routingFailed: (error: Error, params: OrderRouteParams) => void;
  priceUpdate: (platform: Platform, price: number) => void;
}

export interface SmartRouter extends EventEmitter<keyof SmartRouterEvents> {
  findBestRoute(params: OrderRouteParams): Promise<RoutingResult>;
  getQuotes(params: OrderRouteParams): Promise<RouteQuote[]>;
  compareRoutes(params: OrderRouteParams): Promise<RoutingResult>;
  updateConfig(config: Partial<SmartRouterConfig>): void;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<SmartRouterConfig> = {
  mode: 'balanced',
  enabledPlatforms: ['polymarket', 'kalshi'],
  maxSlippage: 1,
  preferMaker: true,
  allowSplitting: false,
  maxSplitPlatforms: 3,
  minSplitImprovement: 0.5,
  useFeatureScoring: true,
  liquidityWeight: 0.2,
};

// Platform fee structures (in basis points)
// NOTE: These are defaults/estimates. Actual fees vary:
// - Polymarket: 0 fees on most markets; 15-min crypto markets have dynamic fees (up to ~315bps at 50/50 odds)
// - Kalshi: Formula-based fees 0.07*C*P*(1-P), averaging ~120bps, capped at ~200bps
const PLATFORM_FEES: Partial<Record<Platform, { takerBps: number; makerBps: number }>> = {
  polymarket: { takerBps: 0, makerBps: 0 }, // Zero fees on most markets (15-min crypto markets have dynamic fees)
  kalshi: { takerBps: 120, makerBps: 17 }, // Average ~1.2% taker, ~0.17% maker (formula-based, varies by price)
  manifold: { takerBps: 0, makerBps: 0 }, // No fees
  metaculus: { takerBps: 0, makerBps: 0 }, // No fees
  predictit: { takerBps: 500, makerBps: 500 }, // 5% on profits (10% total on winning trades)
  drift: { takerBps: 100, makerBps: -25 }, // Estimated
  betfair: { takerBps: 200, makerBps: 0 }, // Varies by market (2-5% commission on net winnings)
  smarkets: { takerBps: 200, makerBps: 0 }, // 2% commission
};

// Average execution times (ms)
const EXECUTION_TIMES: Partial<Record<Platform, number>> = {
  polymarket: 500,
  kalshi: 800,
  manifold: 300,
  metaculus: 300,
  predictit: 2000,
  drift: 400,
  betfair: 600,
  smarkets: 700,
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createSmartRouter(
  feeds: FeedManager,
  config: SmartRouterConfig = {}
): SmartRouter {
  const emitter = new EventEmitter() as SmartRouter;
  let cfg = { ...DEFAULT_CONFIG, ...config };

  // ==========================================================================
  // PRICE FETCHING
  // ==========================================================================

  async function fetchOrderbook(platform: Platform, marketId: string): Promise<Orderbook | null> {
    try {
      return await feeds.getOrderbook(platform, marketId);
    } catch (error) {
      logger.debug({ platform, marketId, error }, 'Failed to fetch orderbook');
      return null;
    }
  }

  async function fetchPrice(platform: Platform, marketId: string): Promise<number | null> {
    try {
      return await feeds.getPrice(platform, marketId);
    } catch (error) {
      logger.debug({ platform, marketId, error }, 'Failed to fetch price');
      return null;
    }
  }

  // ==========================================================================
  // FEE CALCULATION
  // ==========================================================================

  function calculateFees(platform: Platform, size: number, isMaker: boolean): number {
    const fees = PLATFORM_FEES[platform] || { takerBps: 100, makerBps: 0 };
    const bps = isMaker ? fees.makerBps : fees.takerBps;
    return (size * bps) / 10000;
  }

  // ==========================================================================
  // SLIPPAGE CALCULATION
  // ==========================================================================

  function calculateSlippage(
    orderbook: Orderbook | null,
    side: 'buy' | 'sell',
    size: number,
    limitPrice?: number
  ): { fillPrice: number; slippage: number; availableSize: number } {
    if (!orderbook) {
      return { fillPrice: limitPrice || 0.5, slippage: 0, availableSize: 0 };
    }

    // Orderbook levels are [price, size] tuples
    const levels = side === 'buy' ? orderbook.asks : orderbook.bids;
    if (levels.length === 0) {
      return { fillPrice: limitPrice || 0.5, slippage: 0, availableSize: 0 };
    }

    let remainingSize = size;
    let totalCost = 0;
    let filledSize = 0;

    for (const [price, levelSize] of levels) {
      const fillAmount = Math.min(remainingSize, levelSize);
      totalCost += fillAmount * price;
      filledSize += fillAmount;
      remainingSize -= fillAmount;

      if (remainingSize <= 0) break;
    }

    const fillPrice = filledSize > 0 ? totalCost / filledSize : levels[0][0];
    const bestBid = orderbook.bids[0]?.[0] || 0;
    const bestAsk = orderbook.asks[0]?.[0] || 1;
    const midPrice = (bestBid + bestAsk) / 2 || fillPrice;
    const slippage = Math.abs(fillPrice - midPrice) / midPrice * 100;

    return { fillPrice, slippage, availableSize: filledSize };
  }

  // ==========================================================================
  // QUOTE GENERATION
  // ==========================================================================

  async function getQuoteForPlatform(
    platform: Platform,
    params: OrderRouteParams
  ): Promise<RouteQuote | null> {
    const marketId = params.alternativeIds?.[platform] || params.marketId;

    // Fetch orderbook for slippage calculation
    const orderbook = await fetchOrderbook(platform, marketId);
    const { fillPrice, slippage, availableSize } = calculateSlippage(
      orderbook,
      params.side,
      params.size,
      params.limitPrice
    );

    // Skip if no liquidity
    if (availableSize === 0 && !params.limitPrice) {
      return null;
    }

    // Determine if we can be a maker
    const canBeMaker = cfg.preferMaker && params.limitPrice !== undefined &&
      ((params.side === 'buy' && params.limitPrice < fillPrice) ||
        (params.side === 'sell' && params.limitPrice > fillPrice));

    const isMaker = canBeMaker;
    const fees = calculateFees(platform, params.size, isMaker);
    const price = canBeMaker ? params.limitPrice! : fillPrice;
    const netPrice = params.side === 'buy' ? price + fees / params.size : price - fees / params.size;

    return {
      platform,
      price,
      availableSize: Math.max(availableSize, params.size), // If we have limit, assume we can fill
      estimatedFees: fees,
      netPrice,
      slippage,
      executionTimeMs: EXECUTION_TIMES[platform] || 1000,
      isMaker,
    };
  }

  // ==========================================================================
  // ROUTE SELECTION
  // ==========================================================================

  function selectBestRoute(quotes: RouteQuote[], side: 'buy' | 'sell', params: OrderRouteParams): RouteQuote {
    const sorted = [...quotes].sort((a, b) => {
      switch (cfg.mode) {
        case 'best_price':
          return side === 'buy' ? a.netPrice - b.netPrice : b.netPrice - a.netPrice;

        case 'best_liquidity':
          return b.availableSize - a.availableSize;

        case 'lowest_fee':
          return a.estimatedFees - b.estimatedFees;

        case 'balanced':
        default: {
          // Weighted score: 50% price, 30% liquidity (from orderbook), 20% fees
          let scoreA = (side === 'buy' ? -a.netPrice : a.netPrice) * 0.5 +
            a.availableSize / 10000 * 0.3 +
            -a.estimatedFees / 100 * 0.2;
          let scoreB = (side === 'buy' ? -b.netPrice : b.netPrice) * 0.5 +
            b.availableSize / 10000 * 0.3 +
            -b.estimatedFees / 100 * 0.2;

          // Add feature-based liquidity scoring (if enabled)
          if (cfg.useFeatureScoring) {
            const marketIdA = params.alternativeIds?.[a.platform] || params.marketId;
            const marketIdB = params.alternativeIds?.[b.platform] || params.marketId;

            const featuresA = getMarketFeatures(a.platform, marketIdA);
            const featuresB = getMarketFeatures(b.platform, marketIdB);

            // Boost score for markets with better liquidity scores
            const liquidityScoreA = getLiquidityScore(featuresA) ?? 0.5;
            const liquidityScoreB = getLiquidityScore(featuresB) ?? 0.5;

            scoreA += liquidityScoreA * cfg.liquidityWeight;
            scoreB += liquidityScoreB * cfg.liquidityWeight;

            // Penalize wide spreads
            const spreadA = getSpreadPct(featuresA) ?? 0;
            const spreadB = getSpreadPct(featuresB) ?? 0;

            scoreA -= spreadA * 0.05; // Slight penalty for spread
            scoreB -= spreadB * 0.05;
          }

          return scoreB - scoreA;
        }
      }
    });

    return sorted[0];
  }

  function calculateSplitRoutes(
    quotes: RouteQuote[],
    params: OrderRouteParams
  ): RouteQuote[] | undefined {
    if (!cfg.allowSplitting || quotes.length < 2) {
      return undefined;
    }

    // Sort by net price
    const sorted = [...quotes].sort((a, b) =>
      params.side === 'buy' ? a.netPrice - b.netPrice : b.netPrice - a.netPrice
    );

    // Calculate if splitting is beneficial
    const splits: RouteQuote[] = [];
    let remainingSize = params.size;

    for (let i = 0; i < Math.min(sorted.length, cfg.maxSplitPlatforms); i++) {
      if (remainingSize <= 0) break;

      const quote = sorted[i];
      const fillSize = Math.min(remainingSize, quote.availableSize);

      if (fillSize > 0) {
        splits.push({
          ...quote,
          availableSize: fillSize,
          estimatedFees: calculateFees(quote.platform, fillSize, quote.isMaker),
        });
        remainingSize -= fillSize;
      }
    }

    // Check if split is better than single route
    if (splits.length <= 1) {
      return undefined;
    }

    const singleCost = sorted[0].netPrice * params.size;
    const splitCost = splits.reduce((sum, s) => sum + s.netPrice * s.availableSize, 0);
    const improvement = (singleCost - splitCost) / singleCost * 100;

    if (improvement < cfg.minSplitImprovement) {
      return undefined;
    }

    return splits;
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  Object.assign(emitter, {
    async findBestRoute(params: OrderRouteParams): Promise<RoutingResult> {
      const quotes = await emitter.getQuotes(params);

      if (quotes.length === 0) {
        const error = new Error('No routes available');
        emitter.emit('routingFailed', error, params);
        throw error;
      }

      const bestRoute = selectBestRoute(quotes, params.side, params);
      const splitRoutes = calculateSplitRoutes(quotes, params);

      // Calculate savings compared to worst route
      const worstPrice = params.side === 'buy'
        ? Math.max(...quotes.map((q) => q.netPrice))
        : Math.min(...quotes.map((q) => q.netPrice));
      const totalSavings = Math.abs(bestRoute.netPrice - worstPrice) * params.size;

      const result: RoutingResult = {
        bestRoute,
        allRoutes: quotes,
        splitRoutes,
        totalSavings,
        recommendation: splitRoutes
          ? `Split across ${splitRoutes.length} platforms for ${cfg.minSplitImprovement}%+ improvement`
          : `Route to ${bestRoute.platform} (${bestRoute.isMaker ? 'maker' : 'taker'})`,
      };

      logger.info(
        {
          marketId: params.marketId,
          side: params.side,
          size: params.size,
          bestPlatform: bestRoute.platform,
          netPrice: bestRoute.netPrice,
          savings: totalSavings,
        },
        'Route found'
      );

      emitter.emit('routeFound', result);
      return result;
    },

    async getQuotes(params: OrderRouteParams): Promise<RouteQuote[]> {
      const quotes: RouteQuote[] = [];

      const quotePromises = cfg.enabledPlatforms.map(async (platform) => {
        try {
          const quote = await getQuoteForPlatform(platform, params);
          if (quote && quote.slippage <= cfg.maxSlippage) {
            quotes.push(quote);
            emitter.emit('priceUpdate', platform, quote.price);
          }
        } catch (error) {
          logger.debug({ platform, error }, 'Quote failed');
        }
      });

      await Promise.all(quotePromises);
      return quotes;
    },

    async compareRoutes(params: OrderRouteParams): Promise<RoutingResult> {
      return emitter.findBestRoute(params);
    },

    updateConfig(newConfig: Partial<SmartRouterConfig>): void {
      cfg = { ...cfg, ...newConfig };
      logger.info({ config: cfg }, 'Router config updated');
    },
  } as Partial<SmartRouter>);

  return emitter;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Quick comparison of prices across platforms
 */
export async function quickPriceCompare(
  feeds: FeedManager,
  marketId: string,
  platforms: Platform[] = ['polymarket', 'kalshi']
): Promise<Record<Platform, number | null>> {
  const prices: Record<Platform, number | null> = {} as Record<Platform, number | null>;

  await Promise.all(
    platforms.map(async (platform) => {
      try {
        prices[platform] = await feeds.getPrice(platform, marketId);
      } catch {
        prices[platform] = null;
      }
    })
  );

  return prices;
}

// =============================================================================
// EXPORTS
// =============================================================================

export { PLATFORM_FEES, EXECUTION_TIMES };
