/**
 * Market Making Strategy Adapter
 *
 * Wraps the pure engine into a Strategy that BotManager can run.
 */

import type { Strategy, StrategyConfig, Signal, StrategyContext } from '../bots/index';
import type { ExecutionService } from '../../execution/index';
import type { FeedManager } from '../../feeds/index';
import type { MMConfig, MMState } from './types';
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
      // Check if halted
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

      // 3. Cancel existing orders
      const cancelPromises = [...state.activeBids, ...state.activeAsks].map((orderId) =>
        deps.execution.cancelOrder(mmConfig.platform, orderId).catch(() => false),
      );
      await Promise.all(cancelPromises);
      state.activeBids = [];
      state.activeAsks = [];

      // 4. Update fair value state
      state.fairValue = rawFairValue;
      state.emaFairValue = updateEmaFairValue(
        state.emaFairValue || rawFairValue,
        rawFairValue,
        mmConfig.fairValueAlpha,
      );

      // 5. Generate new quotes
      const quotes = generateQuotes(mmConfig, state, orderbook);

      // 6. Place new orders via makerBuy/makerSell (all levels)
      const signals: Signal[] = [];

      for (const bid of quotes.bids) {
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
            reason: `MM bid L${signals.filter(s => s.type === 'buy').length + 1} @ ${bid.price} (fv=${quotes.fairValue.toFixed(2)}, skew=${quotes.skew.toFixed(3)})`,
          });
        }
      }

      for (const ask of quotes.asks) {
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
            reason: `MM ask L${signals.filter(s => s.type === 'sell').length + 1} @ ${ask.price} (fv=${quotes.fairValue.toFixed(2)}, skew=${quotes.skew.toFixed(3)})`,
          });
        }
      }

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
      const cancelPromises = [...state.activeBids, ...state.activeAsks].map((orderId) =>
        deps.execution.cancelOrder(mmConfig.platform, orderId).catch(() => false),
      );
      await Promise.all(cancelPromises);
      state.activeBids = [];
      state.activeAsks = [];
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
