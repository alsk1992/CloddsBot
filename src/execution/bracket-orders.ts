/**
 * OCO Bracket Orders - One-Cancels-Other stop-loss + take-profit pairs
 *
 * Features:
 * - Pairs a take-profit limit with a stop-loss limit
 * - When one fills, automatically cancels the other
 * - Supports Polymarket and Kalshi
 * - Polling-based fill detection
 * - Database persistence (survives restarts)
 */

import { EventEmitter } from 'eventemitter3';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import type { ExecutionService, OrderResult } from './index';
import {
  saveBracketOrder,
  updateBracketStatus,
  getBracketOrder,
  getActiveBracketOrders,
  deleteBracketOrder,
  type PersistedBracketOrder,
} from './order-persistence';

// =============================================================================
// TYPES
// =============================================================================

export interface BracketOrderConfig {
  /** The platform for this bracket */
  platform: 'polymarket' | 'kalshi';
  /** Market identifier */
  marketId: string;
  /** Token ID (Polymarket) */
  tokenId?: string;
  /** Outcome (Kalshi) */
  outcome?: string;
  /** Current position size */
  size: number;
  /** Current position side */
  side: 'long' | 'short';
  /** Take-profit sell price */
  takeProfitPrice: number;
  /** Stop-loss sell price */
  stopLossPrice: number;
  /** Partial take-profit (fraction of size, 0-1). Defaults to 1 (full) */
  takeProfitSizePct?: number;
  /** NegRisk flag for Polymarket crypto markets */
  negRisk?: boolean;
  /** Poll interval for fill detection in ms (default: 2000) */
  pollIntervalMs?: number;
}

export interface BracketStatus {
  takeProfitOrderId?: string;
  stopLossOrderId?: string;
  status: 'pending' | 'active' | 'take_profit_hit' | 'stop_loss_hit' | 'cancelled' | 'failed';
  filledSide?: 'take_profit' | 'stop_loss';
  fillPrice?: number;
  realizedPnL?: number;
}

export interface BracketOrder extends EventEmitter {
  /** Unique order ID */
  id: string;
  /** Place both orders and begin monitoring */
  start(): Promise<void>;
  /** Cancel both orders */
  cancel(): Promise<void>;
  /** Get current bracket status */
  getStatus(): BracketStatus;
}

export interface BracketOrderOptions {
  /** User ID for persistence */
  userId?: string;
  /** Existing order ID (for resuming) */
  orderId?: string;
  /** Restored order IDs (for resuming) */
  restoredOrderIds?: {
    takeProfitOrderId?: string;
    stopLossOrderId?: string;
  };
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createBracketOrder(
  executionService: ExecutionService,
  config: BracketOrderConfig,
  options?: BracketOrderOptions
): BracketOrder {
  const emitter = new EventEmitter() as BracketOrder;

  const orderId = options?.orderId ?? randomUUID();
  const userId = options?.userId ?? 'anonymous';
  const pollIntervalMs = config.pollIntervalMs ?? 2000;
  const takeProfitSizePct = config.takeProfitSizePct ?? 1;

  let takeProfitOrderId: string | undefined = options?.restoredOrderIds?.takeProfitOrderId;
  let stopLossOrderId: string | undefined = options?.restoredOrderIds?.stopLossOrderId;
  let status: BracketStatus['status'] = options?.restoredOrderIds ? 'active' : 'pending';
  let filledSide: BracketStatus['filledSide'];
  let fillPrice: number | undefined;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Save to database on creation (unless resuming)
  if (!options?.orderId) {
    try {
      const now = Date.now();
      saveBracketOrder({
        id: orderId,
        userId,
        platform: config.platform,
        marketId: config.marketId,
        tokenId: config.tokenId,
        outcome: config.outcome,
        size: config.size,
        side: config.side,
        takeProfitPrice: config.takeProfitPrice,
        stopLossPrice: config.stopLossPrice,
        takeProfitSizePct,
        negRisk: config.negRisk,
        pollIntervalMs,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      logger.warn({ error: String(err) }, 'Failed to persist bracket order');
    }
  }

  /**
   * Build order base params
   */
  function buildBaseOrder() {
    return {
      platform: config.platform as 'polymarket' | 'kalshi',
      marketId: config.marketId,
      tokenId: config.tokenId,
      outcome: config.outcome,
      negRisk: config.negRisk,
    };
  }

  /**
   * Place the take-profit order
   */
  async function placeTakeProfit(): Promise<OrderResult> {
    const tpSize = Math.round(config.size * takeProfitSizePct * 100) / 100;

    return executionService.sellLimit({
      ...buildBaseOrder(),
      price: config.takeProfitPrice,
      size: tpSize,
    });
  }

  /**
   * Place the stop-loss order
   */
  async function placeStopLoss(): Promise<OrderResult> {
    return executionService.sellLimit({
      ...buildBaseOrder(),
      price: config.stopLossPrice,
      size: config.size,
    });
  }

  /**
   * Check if an order has filled
   */
  async function checkOrderFilled(orderId: string): Promise<{ filled: boolean; price?: number }> {
    try {
      const order = await executionService.getOrder(config.platform, orderId);
      if (!order) return { filled: false };

      if (order.status === 'filled') {
        return { filled: true, price: order.price };
      }

      return { filled: false };
    } catch {
      return { filled: false };
    }
  }

  /**
   * Cancel the other side when one fills
   */
  async function cancelOtherSide(sideToCancel: 'take_profit' | 'stop_loss'): Promise<void> {
    const orderId = sideToCancel === 'take_profit' ? takeProfitOrderId : stopLossOrderId;
    if (!orderId) return;

    try {
      await executionService.cancelOrder(config.platform, orderId);
      logger.info(
        { side: sideToCancel, orderId },
        'Bracket: cancelled other side'
      );
    } catch (error) {
      logger.warn(
        { side: sideToCancel, orderId, error: String(error) },
        'Bracket: failed to cancel other side'
      );
    }
  }

  /**
   * Poll for fills
   */
  async function pollForFills(): Promise<void> {
    if (status !== 'active') return;

    // Check take-profit
    if (takeProfitOrderId) {
      const tp = await checkOrderFilled(takeProfitOrderId);
      if (tp.filled) {
        status = 'take_profit_hit';
        filledSide = 'take_profit';
        fillPrice = tp.price;
        cleanup();

        // Persist status
        try {
          updateBracketStatus(orderId, {
            status: 'take_profit_hit',
            filledSide: 'take_profit',
            fillPrice: tp.price,
          });
        } catch (err) {
          logger.warn({ error: String(err) }, 'Failed to persist bracket TP hit');
        }

        await cancelOtherSide('stop_loss');

        logger.info(
          { fillPrice: tp.price, side: 'take_profit', orderId },
          'Bracket: take-profit hit'
        );

        emitter.emit('take_profit_hit', {
          orderId: takeProfitOrderId,
          fillPrice: tp.price,
          status: getStatusSnapshot(),
        });
        return;
      }
    }

    // Check stop-loss
    if (stopLossOrderId) {
      const sl = await checkOrderFilled(stopLossOrderId);
      if (sl.filled) {
        status = 'stop_loss_hit';
        filledSide = 'stop_loss';
        fillPrice = sl.price;
        cleanup();

        // Persist status
        try {
          updateBracketStatus(orderId, {
            status: 'stop_loss_hit',
            filledSide: 'stop_loss',
            fillPrice: sl.price,
          });
        } catch (err) {
          logger.warn({ error: String(err) }, 'Failed to persist bracket SL hit');
        }

        await cancelOtherSide('take_profit');

        logger.info(
          { fillPrice: sl.price, side: 'stop_loss', orderId },
          'Bracket: stop-loss hit'
        );

        emitter.emit('stop_loss_hit', {
          orderId: stopLossOrderId,
          fillPrice: sl.price,
          status: getStatusSnapshot(),
        });
        return;
      }
    }
  }

  /**
   * Build status snapshot
   */
  function getStatusSnapshot(): BracketStatus {
    return {
      takeProfitOrderId,
      stopLossOrderId,
      status,
      filledSide,
      fillPrice,
    };
  }

  /**
   * Clean up poll timer
   */
  function cleanup(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async function start(): Promise<void> {
    // Handle resumed orders - already active, just start polling
    if (status === 'active' && (takeProfitOrderId || stopLossOrderId)) {
      logger.info(
        { orderId, takeProfitOrderId, stopLossOrderId },
        'Bracket order: resuming polling for existing orders'
      );

      pollTimer = setInterval(() => {
        pollForFills().catch((err) => {
          logger.error({ error: String(err) }, 'Bracket poll error');
        });
      }, pollIntervalMs);

      emitter.emit('active', getStatusSnapshot());
      return;
    }

    if (status !== 'pending') return;

    logger.info(
      {
        orderId,
        platform: config.platform,
        marketId: config.marketId,
        tp: config.takeProfitPrice,
        sl: config.stopLossPrice,
        size: config.size,
      },
      'Bracket order: placing TP + SL'
    );

    // Place both orders
    const [tpResult, slResult] = await Promise.allSettled([
      placeTakeProfit(),
      placeStopLoss(),
    ]);

    // Process take-profit result
    if (tpResult.status === 'fulfilled' && tpResult.value.success) {
      takeProfitOrderId = tpResult.value.orderId;
    } else {
      const err = tpResult.status === 'rejected'
        ? String(tpResult.reason)
        : tpResult.value.error;
      logger.error({ error: err }, 'Bracket: failed to place take-profit');
    }

    // Process stop-loss result
    if (slResult.status === 'fulfilled' && slResult.value.success) {
      stopLossOrderId = slResult.value.orderId;
    } else {
      const err = slResult.status === 'rejected'
        ? String(slResult.reason)
        : slResult.value.error;
      logger.error({ error: err }, 'Bracket: failed to place stop-loss');
    }

    // Need at least one order to be active
    if (!takeProfitOrderId && !stopLossOrderId) {
      status = 'failed';
      // Persist failed status
      try {
        updateBracketStatus(orderId, { status: 'failed' });
      } catch (err) {
        logger.warn({ error: String(err) }, 'Failed to persist bracket failure');
      }
      emitter.emit('failed', { error: 'Both bracket orders failed to place' });
      return;
    }

    status = 'active';

    // Persist active status with order IDs
    try {
      updateBracketStatus(orderId, {
        takeProfitOrderId,
        stopLossOrderId,
        status: 'active',
      });
    } catch (err) {
      logger.warn({ error: String(err) }, 'Failed to persist bracket active status');
    }

    // Start polling
    pollTimer = setInterval(() => {
      pollForFills().catch((err) => {
        logger.error({ error: String(err) }, 'Bracket poll error');
      });
    }, pollIntervalMs);

    logger.info({ orderId, takeProfitOrderId, stopLossOrderId }, 'Bracket order active');
    emitter.emit('active', getStatusSnapshot());
  }

  async function cancel(): Promise<void> {
    if (status !== 'active') return;

    status = 'cancelled';
    cleanup();

    // Persist cancelled status
    try {
      updateBracketStatus(orderId, { status: 'cancelled' });
    } catch (err) {
      logger.warn({ error: String(err) }, 'Failed to persist bracket cancellation');
    }

    const cancellations: Promise<boolean>[] = [];
    if (takeProfitOrderId) {
      cancellations.push(executionService.cancelOrder(config.platform, takeProfitOrderId));
    }
    if (stopLossOrderId) {
      cancellations.push(executionService.cancelOrder(config.platform, stopLossOrderId));
    }

    await Promise.allSettled(cancellations);

    logger.info({ orderId }, 'Bracket order cancelled');
    emitter.emit('cancelled', getStatusSnapshot());
  }

  function getStatus(): BracketStatus {
    return getStatusSnapshot();
  }

  Object.assign(emitter, { id: orderId, start, cancel, getStatus });

  return emitter;
}

// =============================================================================
// PERSISTENCE HELPERS
// =============================================================================

/**
 * Resume a bracket order from persisted state.
 * Only resumes if order IDs are available and status is 'active'.
 */
export function resumeBracketOrder(
  executionService: ExecutionService,
  persisted: PersistedBracketOrder
): BracketOrder | null {
  // Only resume active orders that have order IDs
  if (persisted.status !== 'active') {
    return null;
  }

  if (!persisted.takeProfitOrderId && !persisted.stopLossOrderId) {
    logger.warn(
      { orderId: persisted.id },
      'Cannot resume bracket order without order IDs'
    );
    return null;
  }

  const config: BracketOrderConfig = {
    platform: persisted.platform as 'polymarket' | 'kalshi',
    marketId: persisted.marketId,
    tokenId: persisted.tokenId,
    outcome: persisted.outcome,
    size: persisted.size,
    side: persisted.side,
    takeProfitPrice: persisted.takeProfitPrice,
    stopLossPrice: persisted.stopLossPrice,
    takeProfitSizePct: persisted.takeProfitSizePct,
    negRisk: persisted.negRisk,
    pollIntervalMs: persisted.pollIntervalMs,
  };

  const bracket = createBracketOrder(executionService, config, {
    userId: persisted.userId,
    orderId: persisted.id,
    restoredOrderIds: {
      takeProfitOrderId: persisted.takeProfitOrderId,
      stopLossOrderId: persisted.stopLossOrderId,
    },
  });

  // For resumed orders, we need to start polling immediately
  // since they were already active
  return bracket;
}

/**
 * Get all active bracket orders that need to be resumed
 */
export function getActivePersistedBracketOrders(userId?: string): PersistedBracketOrder[] {
  return getActiveBracketOrders(userId);
}

/**
 * Get a specific persisted bracket order
 */
export function getPersistedBracketOrder(orderId: string): PersistedBracketOrder | null {
  return getBracketOrder(orderId);
}

/**
 * Delete a persisted bracket order
 */
export function deletePersistedBracketOrder(orderId: string): void {
  deleteBracketOrder(orderId);
}
