/**
 * 4 Strategies for 15-minute Polymarket Crypto Markets
 *
 * Each strategy:
 *  - Uses real orderbook data (OBI, spread, depth)
 *  - Specifies its preferred order mode (maker/taker/fok/maker_then_taker)
 *  - Logs features for post-trade analysis
 *  - Has individually tunable config
 *
 * 1. Momentum    — Spot moved, poly lagging → maker_then_taker entry
 * 2. Reversion   — Poly overshot on noise   → maker entry (patient, cheap)
 * 3. Penny Clip  — Oscillating in zone, buy dips → maker entry (V4 from firstorder)
 * 4. Expiry Fade — Near expiry, no trend    → taker entry (speed, last chance)
 */

import type {
  CryptoMarket,
  TradeSignal,
  SignalDirection,
  OrderMode,
  OrderbookSnapshot,
} from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Rolling price buffer for oscillation detection */
export interface PriceBuffer {
  prices: Array<{ price: number; ts: number }>;
  push(price: number, ts?: number): void;
  /** Count direction reversals in last N seconds */
  reversals(windowSec: number, minStep: number): number;
  /** Price range in last N seconds */
  range(windowSec: number): number;
  /** Mean price in last N seconds */
  mean(windowSec: number): number;
  /** Movement in last N seconds as pct */
  movePct(windowSec: number): number;
}

export function createPriceBuffer(maxAgeSec = 180): PriceBuffer {
  const prices: Array<{ price: number; ts: number }> = [];

  function prune() {
    const cutoff = Date.now() - maxAgeSec * 1000;
    while (prices.length > 0 && prices[prices.length - 1].ts < cutoff) {
      prices.pop();
    }
    if (prices.length > 2000) {
      prices.length = 2000;
    }
  }

  function inWindow(windowSec: number): Array<{ price: number; ts: number }> {
    const cutoff = Date.now() - windowSec * 1000;
    return prices.filter((p) => p.ts >= cutoff);
  }

  return {
    prices,

    push(price, ts = Date.now()) {
      prices.unshift({ price, ts });
      prune();
    },

    reversals(windowSec, minStep) {
      const window = inWindow(windowSec);
      if (window.length < 3) return 0;
      let count = 0;
      let lastDir: 'up' | 'down' | null = null;

      for (let i = 1; i < window.length; i++) {
        const diff = window[i - 1].price - window[i].price;
        if (Math.abs(diff) < minStep) continue;
        const dir = diff > 0 ? 'up' : 'down';
        if (lastDir && dir !== lastDir) count++;
        lastDir = dir;
      }
      return count;
    },

    range(windowSec) {
      const window = inWindow(windowSec);
      if (window.length === 0) return 0;
      const vals = window.map((p) => p.price);
      return Math.max(...vals) - Math.min(...vals);
    },

    mean(windowSec) {
      const window = inWindow(windowSec);
      if (window.length === 0) return 0;
      return window.reduce((s, p) => s + p.price, 0) / window.length;
    },

    movePct(windowSec) {
      const window = inWindow(windowSec);
      if (window.length < 2) return 0;
      const newest = window[0].price;
      const oldest = window[window.length - 1].price;
      if (oldest === 0) return 0;
      return ((newest - oldest) / oldest) * 100;
    },
  };
}

// =============================================================================
// STRATEGY 1: MOMENTUM
// =============================================================================

export interface MomentumConfig {
  /** Min spot move % to trigger (default 0.15) */
  minSpotMovePct: number;
  /** Max poly price staleness (seconds, default 5) */
  maxPolyStaleSec: number;
  /** Min lag between expected fair value and current poly price (cents, default 0.02) */
  minLagCents: number;
  /** Max spread to enter (pct, default 2.0) */
  maxSpreadPct: number;
  /** Spot move window (seconds, default 30) */
  spotWindowSec: number;
}

export const DEFAULT_MOMENTUM: MomentumConfig = {
  minSpotMovePct: 0.15,
  maxPolyStaleSec: 5,
  minLagCents: 0.02,
  maxSpreadPct: 2.0,
  spotWindowSec: 30,
};

export function evaluateMomentum(
  market: CryptoMarket,
  spotMovePct: number,
  spotWindowSec: number,
  book: OrderbookSnapshot | null,
  polyAgeSec: number,
  cfg: MomentumConfig = DEFAULT_MOMENTUM
): TradeSignal | null {
  if (Math.abs(spotMovePct) < cfg.minSpotMovePct) return null;
  if (polyAgeSec > cfg.maxPolyStaleSec) return null;
  if (book && book.spreadPct > cfg.maxSpreadPct) return null;

  const direction: SignalDirection = spotMovePct > 0 ? 'up' : 'down';
  const tokenId = direction === 'up' ? market.upTokenId : market.downTokenId;
  const price = direction === 'up' ? market.upPrice : market.downPrice;

  // Check if poly has already priced in the move.
  // For a 15-min binary: midpoint is ~0.50, so a 0.15% spot move
  // should push the UP token from 0.50 toward 0.55-0.60 (a few cents).
  // If the token already reflects the move, skip.
  const expectedPolyPrice = 0.50 + Math.abs(spotMovePct) / 100 * 5; // rough scaling: 0.20% → 0.51
  const lagCents = expectedPolyPrice - price; // positive = poly still lagging
  if (lagCents < cfg.minLagCents) return null; // Already priced in or overshot

  const confidence = Math.min(1, Math.abs(spotMovePct) / 0.30);
  const obi = book?.obi ?? 0;

  return {
    strategy: 'momentum',
    asset: market.asset,
    direction,
    tokenId,
    conditionId: market.conditionId,
    price,
    confidence,
    reason: `Spot ${spotMovePct > 0 ? '+' : ''}${spotMovePct.toFixed(3)}% in ${spotWindowSec}s, OBI ${obi.toFixed(2)}`,
    orderMode: 'maker_then_taker',
    features: {
      spotMovePct,
      spotWindowSec,
      polyAgeSec,
      obi,
      spread: book?.spreadPct ?? 0,
      price,
    },
    timestamp: Date.now(),
  };
}

// =============================================================================
// STRATEGY 2: MEAN REVERSION
// =============================================================================

export interface MeanReversionConfig {
  /** Buy when token is this cheap or less (default 0.30) */
  cheapThreshold: number;
  /** Fade when token is this expensive (default 0.72) */
  expensiveThreshold: number;
  /** Min seconds into round (default 120 — spreads stabilized) */
  minRoundAgeSec: number;
  /** Only revert if spot is calm (max spot move %, default 0.08) */
  maxSpotMovePct: number;
  /** Min OBI in our favor (default -0.1 — don't fight order flow) */
  minObi: number;
}

export const DEFAULT_MEAN_REVERSION: MeanReversionConfig = {
  cheapThreshold: 0.30,
  expensiveThreshold: 0.72,
  minRoundAgeSec: 120,
  maxSpotMovePct: 0.08,
  minObi: -0.1,
};

export function evaluateMeanReversion(
  market: CryptoMarket,
  spotMovePct: number,
  roundAgeSec: number,
  book: OrderbookSnapshot | null,
  cfg: MeanReversionConfig = DEFAULT_MEAN_REVERSION
): TradeSignal | null {
  if (roundAgeSec < cfg.minRoundAgeSec) return null;
  if (Math.abs(spotMovePct) > cfg.maxSpotMovePct) return null;

  let direction: SignalDirection;
  let tokenId: string;
  let price: number;

  if (market.upPrice <= cfg.cheapThreshold) {
    direction = 'up';
    tokenId = market.upTokenId;
    price = market.upPrice;
  } else if (market.downPrice <= cfg.cheapThreshold) {
    direction = 'down';
    tokenId = market.downTokenId;
    price = market.downPrice;
  } else if (market.upPrice >= cfg.expensiveThreshold) {
    direction = 'down';
    tokenId = market.downTokenId;
    price = market.downPrice;
  } else if (market.downPrice >= cfg.expensiveThreshold) {
    direction = 'up';
    tokenId = market.upTokenId;
    price = market.upPrice;
  } else {
    return null;
  }

  // Don't fight order flow — check OBI
  const obi = book?.obi ?? 0;
  if (obi < cfg.minObi) return null;

  const confidence = Math.min(1, (1 - price) * 1.5);

  return {
    strategy: 'mean_reversion',
    asset: market.asset,
    direction,
    tokenId,
    conditionId: market.conditionId,
    price,
    confidence,
    reason: `${direction.toUpperCase()} at ${price.toFixed(2)}, spot calm (${spotMovePct.toFixed(3)}%), OBI ${obi.toFixed(2)}`,
    orderMode: 'maker', // Patient — post in spread, 0% fee
    features: {
      spotMovePct,
      roundAgeSec,
      obi,
      spread: book?.spreadPct ?? 0,
      price,
      upPrice: market.upPrice,
      downPrice: market.downPrice,
    },
    timestamp: Date.now(),
  };
}

// =============================================================================
// STRATEGY 3: PENNY CLIPPER (ported from firstorder V4)
// =============================================================================

export interface PennyClipperConfig {
  /** Price zone: min (default 0.08) */
  priceMin: number;
  /** Price zone: max (default 0.50) */
  priceMax: number;
  /** Max spread to trade (cents, default 0.02) */
  maxSpread: number;
  /** Min oscillation range in window (cents, default 0.03) */
  minOscRange: number;
  /** Min reversals in window (default 3) */
  minReversals: number;
  /** Min step to count as reversal (cents, default 0.01) */
  reversalMinStep: number;
  /** Entry discount: must be this many cents below mean (default 0.01) */
  entryDiscount: number;
  /** Lookback window for oscillation (seconds, default 30) */
  oscWindowSec: number;
  /** Confirmation: spot moving toward our direction in last N sec (default 10) */
  confirmWindowSec: number;
}

export const DEFAULT_PENNY_CLIPPER: PennyClipperConfig = {
  priceMin: 0.08,
  priceMax: 0.50,
  maxSpread: 0.02,
  minOscRange: 0.03,
  minReversals: 3,
  reversalMinStep: 0.01,
  entryDiscount: 0.01,
  oscWindowSec: 30,
  confirmWindowSec: 10,
};

export function evaluatePennyClipper(
  market: CryptoMarket,
  spotBuffer: PriceBuffer,
  polyBuffer: PriceBuffer,
  book: OrderbookSnapshot | null,
  cfg: PennyClipperConfig = DEFAULT_PENNY_CLIPPER
): TradeSignal | null {
  if (!book) return null;
  if (book.spread > cfg.maxSpread) return null;

  // Check both sides for price-zone candidates
  const candidates: Array<{ dir: SignalDirection; tokenId: string; price: number }> = [];
  if (market.upPrice >= cfg.priceMin && market.upPrice <= cfg.priceMax) {
    candidates.push({ dir: 'up', tokenId: market.upTokenId, price: market.upPrice });
  }
  if (market.downPrice >= cfg.priceMin && market.downPrice <= cfg.priceMax) {
    candidates.push({ dir: 'down', tokenId: market.downTokenId, price: market.downPrice });
  }
  if (candidates.length === 0) return null;

  // Check oscillation in poly price buffer
  const oscRange = polyBuffer.range(cfg.oscWindowSec);
  if (oscRange < cfg.minOscRange) return null;

  const reversals = polyBuffer.reversals(cfg.oscWindowSec, cfg.reversalMinStep);
  if (reversals < cfg.minReversals) return null;

  // Pick the candidate with the best discount below mean
  const mean = polyBuffer.mean(cfg.oscWindowSec);
  let best: (typeof candidates)[0] | null = null;
  let bestDiscount = 0;

  for (const c of candidates) {
    const discount = mean - c.price;
    if (discount >= cfg.entryDiscount && discount > bestDiscount) {
      best = c;
      bestDiscount = discount;
    }
  }
  if (!best) return null;

  // Confirm: spot should be moving in our direction recently
  const spotMoveRecent = spotBuffer.movePct(cfg.confirmWindowSec);
  const spotConfirms = best.dir === 'up' ? spotMoveRecent > 0 : spotMoveRecent < 0;
  if (!spotConfirms) return null;

  const confidence = Math.min(1, (reversals / 5) * (oscRange / 0.05));

  return {
    strategy: 'penny_clipper',
    asset: market.asset,
    direction: best.dir,
    tokenId: best.tokenId,
    conditionId: market.conditionId,
    price: best.price,
    confidence,
    reason: `${best.dir.toUpperCase()} at ${best.price.toFixed(2)}, ${reversals} reversals, ${(oscRange * 100).toFixed(0)}c range, ${(bestDiscount * 100).toFixed(0)}c below mean`,
    orderMode: 'maker', // Post at best bid, 0% fee — this IS the edge
    features: {
      oscRange,
      reversals,
      discount: bestDiscount,
      mean,
      spotMoveRecent,
      spread: book.spread,
      obi: book.obi,
      price: best.price,
    },
    timestamp: Date.now(),
  };
}

// =============================================================================
// STRATEGY 4: EXPIRY FADE
// =============================================================================

export interface ExpiryFadeConfig {
  /** Max seconds before expiry to trigger (default 300 = 5 min) */
  windowSec: number;
  /** Min seconds before expiry (default 60 — don't enter too late) */
  minSecLeft: number;
  /** Min distance from 0.50 to consider fading (default 0.15) */
  minSkewFromMid: number;
  /** Max recent spot move % (default 0.06 — only when spot is flat) */
  maxRecentSpotMovePct: number;
  /** Max spread to enter (default 2.5%) */
  maxSpreadPct: number;
}

export const DEFAULT_EXPIRY_FADE: ExpiryFadeConfig = {
  windowSec: 300,
  minSecLeft: 60,
  minSkewFromMid: 0.15,
  maxRecentSpotMovePct: 0.06,
  maxSpreadPct: 2.5,
};

export function evaluateExpiryFade(
  market: CryptoMarket,
  spotMovePct: number,
  book: OrderbookSnapshot | null,
  cfg: ExpiryFadeConfig = DEFAULT_EXPIRY_FADE
): TradeSignal | null {
  const secsToExpiry = (market.expiresAt - Date.now()) / 1000;
  if (secsToExpiry > cfg.windowSec || secsToExpiry < cfg.minSecLeft) return null;
  if (Math.abs(spotMovePct) > cfg.maxRecentSpotMovePct) return null;
  if (book && book.spreadPct > cfg.maxSpreadPct) return null;

  const upSkew = Math.abs(market.upPrice - 0.50);
  const downSkew = Math.abs(market.downPrice - 0.50);
  const maxSkew = Math.max(upSkew, downSkew);
  if (maxSkew < cfg.minSkewFromMid) return null;

  // Buy the cheap (underpriced) side
  let direction: SignalDirection;
  let tokenId: string;
  let price: number;

  if (market.upPrice < market.downPrice) {
    direction = 'up';
    tokenId = market.upTokenId;
    price = market.upPrice;
  } else {
    direction = 'down';
    tokenId = market.downTokenId;
    price = market.downPrice;
  }

  const minsLeft = (secsToExpiry / 60).toFixed(1);
  const confidence = Math.min(1, maxSkew * 3);

  return {
    strategy: 'expiry_fade',
    asset: market.asset,
    direction,
    tokenId,
    conditionId: market.conditionId,
    price,
    confidence,
    reason: `${minsLeft}min left, ${direction.toUpperCase()} at ${price.toFixed(2)}, skew ${(maxSkew * 100).toFixed(0)}c`,
    orderMode: 'taker', // Speed — limited time to get filled
    features: {
      secsToExpiry,
      skew: maxSkew,
      spotMovePct,
      obi: book?.obi ?? 0,
      spread: book?.spreadPct ?? 0,
      price,
    },
    timestamp: Date.now(),
  };
}
