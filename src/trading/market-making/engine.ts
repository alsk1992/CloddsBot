/**
 * Market Making Engine - Pure Calculation Functions
 *
 * All functions are pure — no I/O, no state mutation, fully testable.
 */

import { computeWeightedPrice, computeVolatility, computeReturns } from '../../services/feature-engineering/indicators';
import type { MMConfig, MMState, Quote, QuoteResult } from './types';
import type { Orderbook } from '../../types';

/**
 * Compute fair value from orderbook based on configured method
 */
export function computeFairValue(
  orderbook: Orderbook,
  method: MMConfig['fairValueMethod'],
): number {
  switch (method) {
    case 'mid_price':
      return orderbook.midPrice;

    case 'weighted_mid': {
      if (orderbook.bids.length === 0 || orderbook.asks.length === 0) {
        return orderbook.midPrice;
      }
      const bestBid = orderbook.bids[0];
      const bestAsk = orderbook.asks[0];
      const totalSize = bestBid[1] + bestAsk[1];
      if (totalSize === 0) return orderbook.midPrice;
      // Size-weighted: heavier side pulls fair value toward it
      return (bestBid[0] * bestAsk[1] + bestAsk[0] * bestBid[1]) / totalSize;
    }

    case 'vwap': {
      const topBids = orderbook.bids.slice(0, 5);
      const topAsks = orderbook.asks.slice(0, 5);
      const bidVwap = computeWeightedPrice(topBids);
      const askVwap = computeWeightedPrice(topAsks);
      if (bidVwap === 0 && askVwap === 0) return orderbook.midPrice;
      if (bidVwap === 0) return askVwap;
      if (askVwap === 0) return bidVwap;
      return (bidVwap + askVwap) / 2;
    }

    case 'ema':
      // EMA method uses the mid price as raw input; the EMA smoothing
      // happens externally via updateEmaFairValue
      return orderbook.midPrice;

    default:
      return orderbook.midPrice;
  }
}

/**
 * Update EMA fair value given new observation
 */
export function updateEmaFairValue(
  currentEma: number,
  newValue: number,
  alpha: number,
): number {
  if (currentEma === 0) return newValue;
  return alpha * newValue + (1 - alpha) * currentEma;
}

/**
 * Compute inventory skew offset in cents.
 * Positive inventory (long) → positive skew → lower bid, higher ask
 * This discourages buying more and encourages selling.
 */
export function computeSkew(
  inventory: number,
  maxInventory: number,
  skewFactor: number,
  baseSpreadCents: number,
): number {
  if (maxInventory === 0 || skewFactor === 0) return 0;
  const normalizedInventory = Math.max(-1, Math.min(1, inventory / maxInventory));
  return normalizedInventory * skewFactor * baseSpreadCents / 100;
}

/**
 * Compute volatility-adjusted spread.
 * Higher volatility → wider spread to avoid adverse selection.
 */
export function computeAdjustedSpread(
  baseSpreadCents: number,
  volatility: number,
  volatilityMultiplier: number,
  minSpreadCents: number,
  maxSpreadCents: number,
): number {
  const volAdjustment = 1 + volatility * volatilityMultiplier;
  const adjustedCents = baseSpreadCents * volAdjustment;
  return Math.max(minSpreadCents, Math.min(maxSpreadCents, adjustedCents));
}

/**
 * Clamp price to valid prediction market range [0.01, 0.99].
 * Round to nearest cent.
 */
export function clampPrice(price: number): number {
  const rounded = Math.round(price * 100) / 100;
  return Math.max(0.01, Math.min(0.99, rounded));
}

/**
 * Check if inventory limits would be exceeded by a new order.
 */
export function wouldExceedInventory(
  currentInventory: number,
  orderSize: number,
  side: 'buy' | 'sell',
  maxInventory: number,
): boolean {
  const newInventory = side === 'buy'
    ? currentInventory + orderSize
    : currentInventory - orderSize;
  return Math.abs(newInventory) > maxInventory;
}

/**
 * Determine if requote is needed based on fair value change or time elapsed.
 */
export function shouldRequote(
  currentFairValue: number,
  lastQuotedFairValue: number,
  thresholdCents: number,
  timeSinceLastQuoteMs: number,
  requoteIntervalMs: number,
): boolean {
  // Always requote if enough time has passed
  if (timeSinceLastQuoteMs >= requoteIntervalMs) return true;

  // Requote if fair value moved more than threshold
  const priceDiffCents = Math.abs(currentFairValue - lastQuotedFairValue) * 100;
  return priceDiffCents >= thresholdCents;
}

/**
 * Generate bid and ask quotes.
 * Core function — combines fair value, spread, skew, and sizing.
 */
export function generateQuotes(
  config: MMConfig,
  state: MMState,
  orderbook: Orderbook,
): QuoteResult {
  // 1. Compute raw fair value
  const rawFairValue = computeFairValue(orderbook, config.fairValueMethod);

  // 2. Smooth with EMA
  const emaFairValue = updateEmaFairValue(
    state.emaFairValue || rawFairValue,
    rawFairValue,
    config.fairValueAlpha,
  );

  // 3. Compute volatility from price history
  const returns = computeReturns(state.priceHistory);
  const volatility = computeVolatility(returns);

  // 4. Compute volatility-adjusted spread
  const spreadCents = computeAdjustedSpread(
    config.baseSpreadCents,
    volatility,
    config.volatilityMultiplier,
    config.minSpreadCents,
    config.maxSpreadCents,
  );
  const halfSpread = spreadCents / 100 / 2;

  // 5. Compute inventory skew
  const skew = computeSkew(
    state.inventory,
    config.maxInventory,
    config.skewFactor,
    config.baseSpreadCents,
  );

  // 6. Generate multi-level quotes
  const numLevels = Math.max(1, config.maxOrdersPerSide);
  const levelSpacing = (config.levelSpacingCents ?? config.baseSpreadCents) / 100;
  const sizeDecay = config.levelSizeDecay ?? 0.5;

  const bids: Quote[] = [];
  const asks: Quote[] = [];
  let cumulativeBuySize = 0;
  let cumulativeSellSize = 0;

  for (let i = 0; i < numLevels; i++) {
    const levelOffset = i * levelSpacing;
    const levelSize = Math.max(1, Math.round(config.orderSize * Math.pow(sizeDecay, i)));

    // Bid levels: each further below fair value
    const bidPrice = clampPrice(emaFairValue - halfSpread - skew - levelOffset);
    if (!wouldExceedInventory(state.inventory, cumulativeBuySize + levelSize, 'buy', config.maxInventory)) {
      bids.push({ side: 'buy', price: bidPrice, size: levelSize });
      cumulativeBuySize += levelSize;
    }

    // Ask levels: each further above fair value
    const askPrice = clampPrice(emaFairValue + halfSpread + skew + levelOffset);
    if (!wouldExceedInventory(state.inventory, cumulativeSellSize + levelSize, 'sell', config.maxInventory)) {
      asks.push({ side: 'sell', price: askPrice, size: levelSize });
      cumulativeSellSize += levelSize;
    }
  }

  return {
    bid: bids[0] ?? null,
    ask: asks[0] ?? null,
    bids,
    asks,
    fairValue: emaFairValue,
    spread: spreadCents,
    skew,
    volatility,
  };
}
