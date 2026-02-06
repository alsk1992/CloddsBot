/**
 * Feature Engineering Types
 */

export interface TickFeatures {
  timestamp: number;
  platform: string;
  marketId: string;
  outcomeId: string;

  // Price features
  price: number;
  priceChange: number;
  priceChangePct: number;
  momentum: number;           // Price change over N ticks
  velocity: number;           // Rate of price change (per second)

  // Volatility
  volatility: number;         // Rolling std dev of returns
  volatilityPct: number;      // As percentage

  // Volume/Activity
  tickCount: number;          // Ticks in window
  tickIntensity: number;      // Ticks per second

  // VWAP (if volume available)
  vwap: number | null;
}

export interface OrderbookFeatures {
  timestamp: number;
  platform: string;
  marketId: string;
  outcomeId: string;

  // Spread features
  spread: number;
  spreadPct: number;
  midPrice: number;

  // Depth features
  bidDepth: number;           // Total bid volume
  askDepth: number;           // Total ask volume
  totalDepth: number;

  // Imbalance
  imbalance: number;          // (bid - ask) / (bid + ask), range [-1, 1]
  imbalanceRatio: number;     // bid / ask

  // Top of book
  bestBid: number;
  bestAsk: number;
  bestBidSize: number;
  bestAskSize: number;

  // Weighted prices
  weightedBidPrice: number;   // Volume-weighted avg bid
  weightedAskPrice: number;   // Volume-weighted avg ask

  // Depth at levels
  bidDepthAt1Pct: number;     // Volume within 1% of mid
  askDepthAt1Pct: number;
  bidDepthAt5Pct: number;     // Volume within 5% of mid
  askDepthAt5Pct: number;
}

export interface CombinedFeatures {
  timestamp: number;
  platform: string;
  marketId: string;
  outcomeId: string;

  // Tick features
  tick: TickFeatures | null;

  // Orderbook features
  orderbook: OrderbookFeatures | null;

  // Derived signals
  signals: {
    buyPressure: number;      // Composite buy signal [0, 1]
    sellPressure: number;     // Composite sell signal [0, 1]
    trendStrength: number;    // Momentum + imbalance signal [-1, 1]
    liquidityScore: number;   // Depth + spread quality [0, 1]
  };
}

export interface FeatureConfig {
  /** Rolling window size for tick features (default: 100) */
  tickWindowSize?: number;
  /** Rolling window size for orderbook features (default: 50) */
  orderbookWindowSize?: number;
  /** Momentum lookback in ticks (default: 20) */
  momentumLookback?: number;
  /** Volatility lookback in ticks (default: 50) */
  volatilityLookback?: number;
  /** Minimum absolute momentum to emit a signal (default: 0.02) */
  signalMomentumThreshold?: number;
  /** Minimum volatility to emit a signal (default: 0.05) */
  signalVolatilityThreshold?: number;
}

export interface FeatureSnapshot {
  timestamp: number;
  platform: string;
  marketId: string;
  outcomeId: string;
  features: CombinedFeatures;
}

export interface FeatureEngineering {
  /**
   * Process a price tick and compute features
   */
  processTick(update: {
    platform: string;
    marketId: string;
    outcomeId: string;
    price: number;
    prevPrice: number | null;
    timestamp: number;
  }): TickFeatures;

  /**
   * Process an orderbook update and compute features
   */
  processOrderbook(update: {
    platform: string;
    marketId: string;
    outcomeId: string;
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
    timestamp: number;
  }): OrderbookFeatures;

  /**
   * Get combined features for a market
   */
  getFeatures(platform: string, marketId: string, outcomeId?: string): CombinedFeatures | null;

  /**
   * Get all current feature snapshots
   */
  getAllFeatures(): FeatureSnapshot[];

  /**
   * Compute features from historical tick data (batch mode)
   */
  computeHistoricalFeatures(ticks: Array<{
    time: Date;
    platform: string;
    marketId: string;
    outcomeId: string;
    price: number;
    prevPrice: number | null;
  }>): TickFeatures[];

  /**
   * Clear feature state for a market
   */
  clearMarket(platform: string, marketId: string): void;

  /**
   * Attach an EventEmitter that will receive 'signal' events when thresholds
   * are crossed during processTick().
   */
  setEmitter(emitter: import('events').EventEmitter): void;

  /**
   * Get service stats
   */
  getStats(): {
    marketsTracked: number;
    ticksProcessed: number;
    orderbooksProcessed: number;
  };
}
