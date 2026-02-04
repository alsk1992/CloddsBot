/**
 * Market Making Engine - Types & Configuration
 */

export interface MMConfig {
  /** Unique market maker ID */
  id: string;
  /** Platform to trade on */
  platform: 'polymarket' | 'kalshi';
  /** Market ID */
  marketId: string;
  /** Token ID (Polymarket) or ticker (Kalshi) */
  tokenId: string;
  /** Outcome name for display */
  outcomeName: string;
  /** Whether market uses negative risk (Polymarket crypto 15-min) */
  negRisk?: boolean;

  // === Spread Parameters ===
  /** Base half-spread in cents (e.g., 2 = quote +-$0.02 from fair value) */
  baseSpreadCents: number;
  /** Minimum spread in cents (floor) */
  minSpreadCents: number;
  /** Maximum spread in cents (cap) */
  maxSpreadCents: number;

  // === Sizing ===
  /** Order size per side in shares */
  orderSize: number;
  /** Maximum inventory (absolute shares) before skewing aggressively */
  maxInventory: number;
  /** Inventory skew factor (0 = no skew, 1 = full skew) */
  skewFactor: number;

  // === Volatility Adjustment ===
  /** Multiply spread by this * recent volatility */
  volatilityMultiplier: number;
  /** EMA alpha for smoothing fair value (0-1, lower = smoother) */
  fairValueAlpha: number;

  // === Fair Value Method ===
  /** How to compute fair value */
  fairValueMethod: 'mid_price' | 'weighted_mid' | 'vwap' | 'ema';

  // === Quote Lifecycle ===
  /** Requote interval in ms (how often to cancel+replace) */
  requoteIntervalMs: number;
  /** Minimum price change (cents) to trigger requote */
  requoteThresholdCents: number;

  // === Risk ===
  /** Max position value in USD */
  maxPositionValueUsd: number;
  /** Max loss before halting (USD) */
  maxLossUsd: number;
  /** Max open orders per side */
  maxOrdersPerSide: number;
  /** Spacing between price levels in cents (default: same as baseSpreadCents) */
  levelSpacingCents?: number;
  /** Size decay per level (0-1, e.g. 0.5 = each level is 50% of previous) */
  levelSizeDecay?: number;
}

export interface MMState {
  /** Current fair value estimate */
  fairValue: number;
  /** EMA-smoothed fair value */
  emaFairValue: number;
  /** Current inventory (positive = long, negative = short) */
  inventory: number;
  /** Realized P&L since start */
  realizedPnL: number;
  /** Number of fills */
  fillCount: number;
  /** Active bid order IDs */
  activeBids: string[];
  /** Active ask order IDs */
  activeAsks: string[];
  /** Recent price history for volatility */
  priceHistory: number[];
  /** Last requote timestamp */
  lastRequoteAt: number;
  /** Whether MM is actively quoting */
  isQuoting: boolean;
  /** Reason if halted */
  haltReason?: string;
}

export interface Quote {
  side: 'buy' | 'sell';
  price: number;
  size: number;
}

export interface QuoteResult {
  /** Best bid (first level), null if inventory maxed */
  bid: Quote | null;
  /** Best ask (first level), null if inventory maxed */
  ask: Quote | null;
  /** All bid levels (closest to fair value first) */
  bids: Quote[];
  /** All ask levels (closest to fair value first) */
  asks: Quote[];
  fairValue: number;
  spread: number;
  skew: number;
  volatility: number;
}
