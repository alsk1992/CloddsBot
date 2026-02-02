/**
 * Feature Engineering Service
 *
 * Computes trading indicators from tick and orderbook data in real-time.
 */

import { logger } from '../../utils/logger';
import { RollingWindow, RollingStats } from './rolling-window';
import * as indicators from './indicators';
import type {
  FeatureEngineering,
  FeatureConfig,
  TickFeatures,
  OrderbookFeatures,
  CombinedFeatures,
  FeatureSnapshot,
} from './types';

const DEFAULT_TICK_WINDOW = 100;
const DEFAULT_ORDERBOOK_WINDOW = 50;
const DEFAULT_MOMENTUM_LOOKBACK = 20;
const DEFAULT_VOLATILITY_LOOKBACK = 50;

interface TickState {
  prices: RollingWindow<{ price: number; timestamp: number }>;
  returns: RollingStats;
  tickCount: number;
  lastFeatures: TickFeatures | null;
}

interface OrderbookState {
  spreads: RollingStats;
  lastFeatures: OrderbookFeatures | null;
}

interface MarketState {
  tick: TickState;
  orderbook: OrderbookState;
}

function makeKey(platform: string, marketId: string, outcomeId?: string): string {
  return outcomeId ? `${platform}:${marketId}:${outcomeId}` : `${platform}:${marketId}`;
}

/**
 * Create the feature engineering service
 */
export function createFeatureEngineering(config: FeatureConfig = {}): FeatureEngineering {
  const tickWindowSize = config.tickWindowSize ?? DEFAULT_TICK_WINDOW;
  const orderbookWindowSize = config.orderbookWindowSize ?? DEFAULT_ORDERBOOK_WINDOW;
  const momentumLookback = config.momentumLookback ?? DEFAULT_MOMENTUM_LOOKBACK;
  const volatilityLookback = config.volatilityLookback ?? DEFAULT_VOLATILITY_LOOKBACK;

  const markets = new Map<string, MarketState>();
  let ticksProcessed = 0;
  let orderbooksProcessed = 0;

  function getOrCreateMarket(key: string): MarketState {
    let state = markets.get(key);
    if (!state) {
      state = {
        tick: {
          prices: new RollingWindow(tickWindowSize),
          returns: new RollingStats(volatilityLookback),
          tickCount: 0,
          lastFeatures: null,
        },
        orderbook: {
          spreads: new RollingStats(orderbookWindowSize),
          lastFeatures: null,
        },
      };
      markets.set(key, state);
    }
    return state;
  }

  return {
    processTick(update): TickFeatures {
      const key = makeKey(update.platform, update.marketId, update.outcomeId);
      const state = getOrCreateMarket(key);
      const tick = state.tick;

      // Add to price window
      tick.prices.push({ price: update.price, timestamp: update.timestamp });
      tick.tickCount++;
      ticksProcessed++;

      // Compute return if we have previous price
      if (update.prevPrice !== null && update.prevPrice !== 0) {
        const ret = (update.price - update.prevPrice) / update.prevPrice;
        tick.returns.push(ret);
      }

      // Get price history for computations
      const priceHistory = tick.prices.getAll();
      const prices = priceHistory.map(p => p.price);

      // Compute features
      const priceChange = update.prevPrice !== null ? update.price - update.prevPrice : 0;
      const priceChangePct = update.prevPrice !== null && update.prevPrice !== 0
        ? (priceChange / update.prevPrice) * 100
        : 0;

      const momentum = indicators.computeMomentum(prices, momentumLookback);
      const velocity = indicators.computeVelocity(priceHistory, 10000);
      const volatility = tick.returns.stdDev();
      const volatilityPct = volatility * 100;

      const timestamps = priceHistory.map(p => p.timestamp);
      const tickIntensity = indicators.computeTickIntensity(timestamps, 60000);

      const features: TickFeatures = {
        timestamp: update.timestamp,
        platform: update.platform,
        marketId: update.marketId,
        outcomeId: update.outcomeId,
        price: update.price,
        priceChange,
        priceChangePct,
        momentum,
        velocity,
        volatility,
        volatilityPct,
        tickCount: tick.tickCount,
        tickIntensity,
        vwap: null, // Would need volume data
      };

      tick.lastFeatures = features;
      return features;
    },

    processOrderbook(update): OrderbookFeatures {
      const key = makeKey(update.platform, update.marketId, update.outcomeId);
      const state = getOrCreateMarket(key);
      const ob = state.orderbook;
      orderbooksProcessed++;

      // Extract best bid/ask
      const bestBid = update.bids.length > 0 ? update.bids[0][0] : 0;
      const bestAsk = update.asks.length > 0 ? update.asks[0][0] : 0;
      const bestBidSize = update.bids.length > 0 ? update.bids[0][1] : 0;
      const bestAskSize = update.asks.length > 0 ? update.asks[0][1] : 0;

      // Compute features
      const spread = indicators.computeSpread(bestBid, bestAsk);
      const spreadPct = indicators.computeSpreadPct(bestBid, bestAsk);
      const midPrice = indicators.computeMidPrice(bestBid, bestAsk);

      // Track spread history
      ob.spreads.push(spread);

      const bidDepth = indicators.computeDepth(update.bids);
      const askDepth = indicators.computeDepth(update.asks);
      const totalDepth = bidDepth + askDepth;

      const imbalance = indicators.computeImbalance(bidDepth, askDepth);
      const imbalanceRatio = indicators.computeImbalanceRatio(bidDepth, askDepth);

      const weightedBidPrice = indicators.computeWeightedPrice(update.bids);
      const weightedAskPrice = indicators.computeWeightedPrice(update.asks);

      const bidDepthAt1Pct = indicators.computeDepthAtPct(update.bids, midPrice, 1, 'bid');
      const askDepthAt1Pct = indicators.computeDepthAtPct(update.asks, midPrice, 1, 'ask');
      const bidDepthAt5Pct = indicators.computeDepthAtPct(update.bids, midPrice, 5, 'bid');
      const askDepthAt5Pct = indicators.computeDepthAtPct(update.asks, midPrice, 5, 'ask');

      const features: OrderbookFeatures = {
        timestamp: update.timestamp,
        platform: update.platform,
        marketId: update.marketId,
        outcomeId: update.outcomeId,
        spread,
        spreadPct,
        midPrice,
        bidDepth,
        askDepth,
        totalDepth,
        imbalance,
        imbalanceRatio,
        bestBid,
        bestAsk,
        bestBidSize,
        bestAskSize,
        weightedBidPrice,
        weightedAskPrice,
        bidDepthAt1Pct,
        askDepthAt1Pct,
        bidDepthAt5Pct,
        askDepthAt5Pct,
      };

      ob.lastFeatures = features;
      return features;
    },

    getFeatures(platform, marketId, outcomeId): CombinedFeatures | null {
      const key = makeKey(platform, marketId, outcomeId);
      const state = markets.get(key);
      if (!state) return null;

      const tick = state.tick.lastFeatures;
      const orderbook = state.orderbook.lastFeatures;

      if (!tick && !orderbook) return null;

      // Compute derived signals
      const momentum = tick?.momentum ?? 0;
      const imbalance = orderbook?.imbalance ?? 0;
      const spreadChange = state.orderbook.spreads.size() >= 2
        ? (state.orderbook.spreads.latest() ?? 0) - (state.orderbook.spreads.get(1) ?? 0)
        : 0;

      const buyPressure = indicators.computeBuyPressure(momentum, imbalance, spreadChange);
      const sellPressure = indicators.computeSellPressure(momentum, imbalance, spreadChange);
      const trendStrength = indicators.computeTrendStrength(momentum, imbalance);
      const liquidityScore = orderbook
        ? indicators.computeLiquidityScore(orderbook.totalDepth, orderbook.spreadPct)
        : 0;

      return {
        timestamp: Math.max(tick?.timestamp ?? 0, orderbook?.timestamp ?? 0),
        platform,
        marketId,
        outcomeId: outcomeId ?? '',
        tick,
        orderbook,
        signals: {
          buyPressure,
          sellPressure,
          trendStrength,
          liquidityScore,
        },
      };
    },

    getAllFeatures(): FeatureSnapshot[] {
      const snapshots: FeatureSnapshot[] = [];

      for (const [key, state] of markets) {
        const [platform, marketId, outcomeId] = key.split(':');
        const features = this.getFeatures(platform, marketId, outcomeId);
        if (features) {
          snapshots.push({
            timestamp: features.timestamp,
            platform,
            marketId,
            outcomeId: outcomeId ?? '',
            features,
          });
        }
      }

      return snapshots;
    },

    computeHistoricalFeatures(ticks): TickFeatures[] {
      if (ticks.length === 0) return [];

      // Group by market/outcome
      const groups = new Map<string, typeof ticks>();
      for (const tick of ticks) {
        const key = makeKey(tick.platform, tick.marketId, tick.outcomeId);
        const group = groups.get(key) || [];
        group.push(tick);
        groups.set(key, group);
      }

      const allFeatures: TickFeatures[] = [];

      for (const [, group] of groups) {
        // Sort by time
        group.sort((a, b) => a.time.getTime() - b.time.getTime());

        // Create temporary state
        const prices = new RollingWindow<{ price: number; timestamp: number }>(tickWindowSize);
        const returns = new RollingStats(volatilityLookback);
        let tickCount = 0;

        for (const tick of group) {
          const timestamp = tick.time.getTime();
          prices.push({ price: tick.price, timestamp });
          tickCount++;

          if (tick.prevPrice !== null && tick.prevPrice !== 0) {
            const ret = (tick.price - tick.prevPrice) / tick.prevPrice;
            returns.push(ret);
          }

          const priceHistory = prices.getAll();
          const priceArray = priceHistory.map(p => p.price);

          const priceChange = tick.prevPrice !== null ? tick.price - tick.prevPrice : 0;
          const priceChangePct = tick.prevPrice !== null && tick.prevPrice !== 0
            ? (priceChange / tick.prevPrice) * 100
            : 0;

          const features: TickFeatures = {
            timestamp,
            platform: tick.platform,
            marketId: tick.marketId,
            outcomeId: tick.outcomeId,
            price: tick.price,
            priceChange,
            priceChangePct,
            momentum: indicators.computeMomentum(priceArray, momentumLookback),
            velocity: indicators.computeVelocity(priceHistory, 10000),
            volatility: returns.stdDev(),
            volatilityPct: returns.stdDev() * 100,
            tickCount,
            tickIntensity: indicators.computeTickIntensity(
              priceHistory.map(p => p.timestamp),
              60000
            ),
            vwap: null,
          };

          allFeatures.push(features);
        }
      }

      // Sort all by timestamp
      allFeatures.sort((a, b) => a.timestamp - b.timestamp);
      return allFeatures;
    },

    clearMarket(platform, marketId): void {
      // Clear all outcomes for this market
      for (const key of markets.keys()) {
        if (key.startsWith(`${platform}:${marketId}`)) {
          markets.delete(key);
        }
      }
    },

    getStats() {
      return {
        marketsTracked: markets.size,
        ticksProcessed,
        orderbooksProcessed,
      };
    },
  };
}

// Re-export types
export type {
  FeatureEngineering,
  FeatureConfig,
  TickFeatures,
  OrderbookFeatures,
  CombinedFeatures,
  FeatureSnapshot,
} from './types';

// Export indicators for direct use
export { indicators };

// Export threshold helpers
export * from './thresholds';

// Export accessor for global access
export { setFeatureEngine, getFeatureEngine, getMarketFeatures } from './accessor';
