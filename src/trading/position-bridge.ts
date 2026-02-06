/**
 * Position Bridge — Wires the PositionManager into the live trading pipeline.
 *
 * Connects three data flows:
 *   1. Signal bus ticks → PositionManager.updatePrice() (live price feed)
 *   2. Signal router fills → PositionManager.updatePosition() (new positions)
 *   3. PositionManager triggers → ExecutionService.sellLimit() (auto-exits)
 *
 * Also connects to the orchestrator's guarded execution so that all
 * exit orders go through safety checks.
 */

import { logger } from '../utils/logger.js';
import type { SignalBus, TickUpdate } from '../gateway/signal-bus.js';
import type { ExecutionService, OrderRequest } from '../execution/index.js';
import type {
  PositionManager,
  Position,
  PositionClose,
} from '../execution/position-manager.js';
import type { SignalRouter } from '../signal-router/index.js';
import type { SignalExecution } from '../signal-router/types.js';
import type { Platform } from '../types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PositionBridgeConfig {
  /** Auto-set stop-loss % on new positions from signal router (default: 15) */
  defaultStopLossPct: number;
  /** Auto-set take-profit % on new positions from signal router (default: 25) */
  defaultTakeProfitPct: number;
  /** Enable trailing stop (default: true) */
  enableTrailingStop: boolean;
  /** Trailing stop % from high water mark (default: 8) */
  trailingStopPct: number;
}

export interface PositionBridge {
  /** Start the bridge (subscribe to events). */
  start(): void;
  /** Stop the bridge (unsubscribe). */
  stop(): void;
  /** Whether bridge is active. */
  readonly active: boolean;
}

const DEFAULTS: PositionBridgeConfig = {
  defaultStopLossPct: 15,
  defaultTakeProfitPct: 25,
  enableTrailingStop: true,
  trailingStopPct: 8,
};

// ── Execute-close callback factory ──────────────────────────────────────────
// Extracted so the gateway can create it independently and pass it to
// createPositionManager({ executeClose }) before the bridge exists.

export function createPositionCloseCallback(
  execution: ExecutionService | null,
): (position: Position, reason: string) => Promise<boolean> {
  return async (position: Position, reason: string): Promise<boolean> => {
    if (!execution) {
      logger.warn({ positionId: position.id, reason }, '[position-bridge] No execution service — cannot close');
      return false;
    }

    try {
      const orderRequest: OrderRequest = {
        platform: position.platform as 'polymarket' | 'kalshi' | 'opinion' | 'predictfun',
        marketId: position.marketId,
        tokenId: position.tokenId || undefined,
        outcome: position.outcomeName || undefined,
        side: position.side === 'long' ? 'sell' : 'buy',
        price: position.currentPrice,
        size: position.size,
        orderType: 'FOK',
      };

      const result = position.side === 'long'
        ? await execution.sellLimit(orderRequest)
        : await execution.buyLimit(orderRequest);

      if (result.success) {
        logger.info(
          {
            positionId: position.id,
            reason,
            closePrice: position.currentPrice,
            orderId: result.orderId,
          },
          '[position-bridge] Position closed via execution',
        );
        return true;
      }

      logger.warn(
        { positionId: position.id, reason, error: result.error },
        '[position-bridge] Close order failed',
      );
      return false;
    } catch (error) {
      logger.error(
        { error, positionId: position.id, reason },
        '[position-bridge] Close execution error',
      );
      return false;
    }
  };
}

// ── Factory ─────────────────────────────────────────────────────────────────

export interface PositionBridgeDeps {
  positionManager: PositionManager;
  signalBus: SignalBus;
  signalRouter: SignalRouter | null;
  config?: Partial<PositionBridgeConfig>;
}

export function createPositionBridge(deps: PositionBridgeDeps): PositionBridge {
  const { positionManager, signalBus, signalRouter } = deps;
  const cfg = { ...DEFAULTS, ...deps.config };

  let isActive = false;

  // Track which markets have tracked positions (for efficient tick filtering)
  const trackedMarkets = new Set<string>();

  // ── 1. Signal bus ticks → price updates ─────────────────────────────────

  function onTick(update: TickUpdate): void {
    const key = `${update.marketId}:${update.outcomeId}`;
    if (!trackedMarkets.has(key)) return;

    const posId = `${update.platform}:${update.marketId}:${update.outcomeId}`;
    positionManager.updatePrice(posId, update.price);
  }

  // ── 2. Signal router fills → new positions ──────────────────────────────

  function onSignalExecuted(exec: SignalExecution): void {
    if (exec.status !== 'executed') return;
    if (!exec.orderPrice || !exec.orderSize) return;

    const signal = exec.signal;
    const platform = signal.platform as Platform;
    const tokenId = signal.outcomeId || '';
    const marketKey = `${signal.marketId}:${tokenId}`;

    // Register position in manager
    const position = positionManager.updatePosition({
      platform,
      marketId: signal.marketId,
      tokenId,
      outcomeName: tokenId,
      side: signal.direction === 'buy' ? 'long' : 'short',
      size: exec.orderSize,
      entryPrice: exec.orderPrice,
      currentPrice: exec.orderPrice,
      openedAt: new Date(exec.timestamp),
      tags: [signal.type],
    });

    // Track this market for tick updates
    trackedMarkets.add(marketKey);

    // Auto-set stop-loss
    positionManager.setStopLoss(position.id, {
      percentFromEntry: cfg.defaultStopLossPct,
      trailingPercent: cfg.enableTrailingStop ? cfg.trailingStopPct : undefined,
    });

    // Auto-set take-profit
    positionManager.setTakeProfit(position.id, {
      percentFromEntry: cfg.defaultTakeProfitPct,
    });

    logger.info(
      {
        positionId: position.id,
        market: signal.marketId,
        direction: signal.direction,
        size: exec.orderSize,
        price: exec.orderPrice,
        sl: position.stopLoss,
        tp: position.takeProfit,
      },
      '[position-bridge] Position tracked with TP/SL',
    );
  }

  // ── 3. Position closed → cleanup tracking ───────────────────────────────

  function onPositionClosed(event: PositionClose): void {
    const pos = event.position;
    const marketKey = `${pos.marketId}:${pos.tokenId}`;

    // Check if any other positions still track this market
    const remaining = positionManager.getPositions().some(
      (p) => p.marketId === pos.marketId && p.tokenId === pos.tokenId && p.status === 'open',
    );
    if (!remaining) {
      trackedMarkets.delete(marketKey);
    }

    logger.info(
      {
        positionId: pos.id,
        reason: event.reason,
        realizedPnL: event.realizedPnL,
        closePrice: event.closePrice,
      },
      '[position-bridge] Position closed',
    );
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  return {
    get active() {
      return isActive;
    },

    start() {
      if (isActive) return;

      // Subscribe to signal bus ticks for price updates
      signalBus.onTick(onTick);

      // Subscribe to signal router executed events for position tracking
      if (signalRouter) {
        signalRouter.on('executed', onSignalExecuted);
      }

      // Subscribe to position manager close events for cleanup
      positionManager.on('position_closed', onPositionClosed);

      // Start position manager's periodic trigger check
      positionManager.start();

      isActive = true;
      logger.info(
        {
          stopLossPct: cfg.defaultStopLossPct,
          takeProfitPct: cfg.defaultTakeProfitPct,
          trailingStopPct: cfg.enableTrailingStop ? cfg.trailingStopPct : 'disabled',
        },
        '[position-bridge] Started',
      );
    },

    stop() {
      if (!isActive) return;

      signalBus.removeListener('tick', onTick);
      if (signalRouter) {
        signalRouter.removeListener('executed', onSignalExecuted);
      }
      positionManager.removeListener('position_closed', onPositionClosed);
      positionManager.stop();

      trackedMarkets.clear();
      isActive = false;
      logger.info('[position-bridge] Stopped');
    },
  };
}
