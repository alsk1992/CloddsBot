/**
 * Market Making Strategy Adapter
 *
 * Wraps the pure engine into a Strategy that BotManager can run.
 * Uses concurrent order placement for Polymarket (parallel single-order calls
 * via Promise.all) and batch cancellation (DELETE /orders).
 * True batch placement (POST /orders) requires EIP-712 order signing — can be
 * added when the signing infrastructure is in place.
 */

import type { Strategy, StrategyConfig, Signal, StrategyContext } from '../bots/index';
import type { ExecutionService } from '../../execution/index';
import type { FeedManager } from '../../feeds/index';
import type { MMConfig, MMState, Quote } from './types';
import { generateQuotes, shouldRequote, computeFairValue, updateEmaFairValue } from './engine';

export interface MMStrategyDeps {
  execution: ExecutionService;
  feeds: FeedManager;
}

/**
 * Create a market making strategy that plugs into BotManager.
 */
export function createMMStrategy(
  mmConfig: MMConfig,
  deps: MMStrategyDeps,
): Strategy {
  // Internal mutable state
  const state: MMState = {
    fairValue: 0,
    emaFairValue: 0,
    inventory: 0,
    realizedPnL: 0,
    fillCount: 0,
    activeBids: [],
    activeAsks: [],
    priceHistory: [],
    lastRequoteAt: 0,
    isQuoting: false,
  };

  let unsubscribe: (() => void) | null = null;

  // Whether this platform supports batch operations
  const supportsBatch = mmConfig.platform === 'polymarket';

  const config: StrategyConfig = {
    id: `mm_${mmConfig.id}`,
    name: `MM: ${mmConfig.outcomeName}`,
    platforms: [mmConfig.platform],
    markets: [mmConfig.marketId],
    intervalMs: mmConfig.requoteIntervalMs,
    maxPositionSize: mmConfig.maxPositionValueUsd,
    maxExposure: mmConfig.maxPositionValueUsd,
    enabled: true,
    dryRun: false,
  };

  /**
   * Cancel all active orders — batch for Polymarket, parallel individual otherwise.
   */
  async function cancelActiveOrders(): Promise<void> {
    const allIds = [...state.activeBids, ...state.activeAsks];
    if (allIds.length === 0) return;

    if (supportsBatch) {
      await deps.execution.cancelOrdersBatch(
        mmConfig.platform as 'polymarket',
        allIds,
      ).catch(() => {});
    } else {
      await Promise.all(
        allIds.map((id) => deps.execution.cancelOrder(mmConfig.platform, id).catch(() => false)),
      );
    }
    state.activeBids = [];
    state.activeAsks = [];
  }

  /**
   * Place all quotes — single batch request for Polymarket, sequential otherwise.
   */
  async function placeQuotes(
    bids: Quote[],
    asks: Quote[],
    fairValue: number,
    skew: number,
  ): Promise<Signal[]> {
    const signals: Signal[] = [];

    if (supportsBatch && (bids.length + asks.length) > 0) {
      // Build batch: all bids + all asks in one request
      const platform = mmConfig.platform;
      const batchOrders = [
        ...bids.map((q) => ({
          platform,
          marketId: mmConfig.marketId,
          tokenId: mmConfig.tokenId,
          side: 'buy' as const,
          price: q.price,
          size: q.size,
          negRisk: mmConfig.negRisk,
          postOnly: true,
        })),
        ...asks.map((q) => ({
          platform,
          marketId: mmConfig.marketId,
          tokenId: mmConfig.tokenId,
          side: 'sell' as const,
          price: q.price,
          size: q.size,
          negRisk: mmConfig.negRisk,
          postOnly: true,
        })),
      ];

      const results = await deps.execution.placeOrdersBatch(batchOrders);

      // Map results back to bids/asks
      let bidIdx = 0;
      let askIdx = 0;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const isBid = i < bids.length;
        const quote = isBid ? bids[bidIdx] : asks[askIdx];
        const level = isBid ? bidIdx + 1 : askIdx + 1;

        if (r.success && r.orderId) {
          if (isBid) {
            state.activeBids.push(r.orderId);
          } else {
            state.activeAsks.push(r.orderId);
          }
          signals.push({
            type: isBid ? 'buy' : 'sell',
            platform: mmConfig.platform,
            marketId: mmConfig.marketId,
            outcome: mmConfig.outcomeName,
            price: quote.price,
            size: quote.size,
            confidence: 1,
            reason: `MM ${isBid ? 'bid' : 'ask'} L${level} @ ${quote.price} (fv=${fairValue.toFixed(2)}, skew=${skew.toFixed(3)})`,
          });
        }

        if (isBid) bidIdx++;
        else askIdx++;
      }
    } else {
      // Sequential fallback for non-batch platforms
      for (let i = 0; i < bids.length; i++) {
        const bid = bids[i];
        const result = await deps.execution.makerBuy({
          platform: mmConfig.platform,
          marketId: mmConfig.marketId,
          tokenId: mmConfig.tokenId,
          price: bid.price,
          size: bid.size,
          negRisk: mmConfig.negRisk,
        });
        if (result.success && result.orderId) {
          state.activeBids.push(result.orderId);
          signals.push({
            type: 'buy',
            platform: mmConfig.platform,
            marketId: mmConfig.marketId,
            outcome: mmConfig.outcomeName,
            price: bid.price,
            size: bid.size,
            confidence: 1,
            reason: `MM bid L${i + 1} @ ${bid.price} (fv=${fairValue.toFixed(2)}, skew=${skew.toFixed(3)})`,
          });
        }
      }

      for (let i = 0; i < asks.length; i++) {
        const ask = asks[i];
        const result = await deps.execution.makerSell({
          platform: mmConfig.platform,
          marketId: mmConfig.marketId,
          tokenId: mmConfig.tokenId,
          price: ask.price,
          size: ask.size,
          negRisk: mmConfig.negRisk,
        });
        if (result.success && result.orderId) {
          state.activeAsks.push(result.orderId);
          signals.push({
            type: 'sell',
            platform: mmConfig.platform,
            marketId: mmConfig.marketId,
            outcome: mmConfig.outcomeName,
            price: ask.price,
            size: ask.size,
            confidence: 1,
            reason: `MM ask L${i + 1} @ ${ask.price} (fv=${fairValue.toFixed(2)}, skew=${skew.toFixed(3)})`,
          });
        }
      }
    }

    return signals;
  }

  // Store ref for getMMState
  const strategyRef: Strategy & { __mmState?: MMState } = {
    config,

    async init() {
      unsubscribe = deps.feeds.subscribePrice(
        mmConfig.platform,
        mmConfig.marketId,
        (update) => {
          state.priceHistory.push(update.price);
          if (state.priceHistory.length > 200) {
            state.priceHistory.shift();
          }
        },
      );
    },

    async evaluate(_ctx: StrategyContext): Promise<Signal[]> {
      if (state.haltReason) return [];

      // 1. Get current orderbook
      const orderbook = await deps.feeds.getOrderbook(
        mmConfig.platform,
        mmConfig.marketId,
      );
      if (!orderbook || orderbook.bids.length === 0 || orderbook.asks.length === 0) {
        return [];
      }

      // 2. Check if requote needed
      const now = Date.now();
      const rawFairValue = computeFairValue(orderbook, mmConfig.fairValueMethod);
      if (
        state.lastRequoteAt > 0 &&
        !shouldRequote(
          rawFairValue,
          state.fairValue,
          mmConfig.requoteThresholdCents,
          now - state.lastRequoteAt,
          mmConfig.requoteIntervalMs,
        )
      ) {
        return [];
      }

      // 3. Batch cancel existing orders
      await cancelActiveOrders();

      // 4. Update fair value state
      state.fairValue = rawFairValue;
      state.emaFairValue = updateEmaFairValue(
        state.emaFairValue || rawFairValue,
        rawFairValue,
        mmConfig.fairValueAlpha,
      );

      // 5. Generate new quotes
      const quotes = generateQuotes(mmConfig, state, orderbook);

      // 6. Batch place all levels
      const signals = await placeQuotes(
        quotes.bids,
        quotes.asks,
        quotes.fairValue,
        quotes.skew,
      );

      state.lastRequoteAt = now;
      state.isQuoting = signals.length > 0;

      return signals;
    },

    onTrade(trade) {
      if (trade.side === 'buy') {
        state.inventory += trade.filled;
      } else {
        state.inventory -= trade.filled;
        state.realizedPnL += trade.filled * (trade.price - state.fairValue);
      }
      state.fillCount++;

      if (state.realizedPnL < -mmConfig.maxLossUsd) {
        state.isQuoting = false;
        state.haltReason = `Max loss exceeded: $${state.realizedPnL.toFixed(2)}`;
      }
    },

    async cleanup() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      await cancelActiveOrders();
      state.isQuoting = false;
    },
  };

  strategyRef.__mmState = state;
  return strategyRef;
}

/**
 * Get current MM state for monitoring/display.
 */
export function getMMState(strategy: Strategy): MMState | null {
  const ref = strategy as Strategy & { __mmState?: MMState };
  return ref.__mmState ?? null;
}
