/**
 * DCA (Dollar-Cost Averaging) Execution Engine
 *
 * Splits a total investment across multiple timed cycles.
 * Each cycle places an order via ExecutionService, then schedules the next.
 * Supports pause/resume/cancel and persists to DB for restart recovery.
 *
 * Mirrors the TWAP pattern (EventEmitter, persistence, progress tracking).
 */

import { EventEmitter } from 'eventemitter3';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import type { ExecutionService, OrderRequest, OrderResult } from './index.js';
import {
  saveDCAOrder,
  updateDCAProgress,
  getDCAOrder,
  getActiveDCAOrders,
  deleteDCAOrder,
  type PersistedDCAOrder,
} from './dca-persistence.js';

// =============================================================================
// TYPES
// =============================================================================

export interface DCAConfig {
  /** Total amount to invest */
  totalAmount: number;
  /** Amount per cycle */
  amountPerCycle: number;
  /** Time between cycles in ms */
  cycleIntervalMs: number;
  /** Stop if market price exceeds this */
  maxPrice?: number;
  /** Max number of cycles (alternative to totalAmount) */
  maxCycles?: number;
  /** Delay before starting (ms since epoch) */
  startAtMs?: number;
}

export interface DCAProgress {
  totalAmount: number;
  investedAmount: number;
  remainingAmount: number;
  cyclesCompleted: number;
  cyclesTotal: number;
  totalShares: number;
  avgPrice: number;
  status: PersistedDCAOrder['status'];
  nextCycleAt?: Date;
  startedAt?: Date;
}

export interface DCAOrder extends EventEmitter {
  id: string;
  start(): void;
  pause(): void;
  resume(): void;
  cancel(): Promise<void>;
  getProgress(): DCAProgress;
}

export interface DCAOrderOptions {
  userId?: string;
  orderId?: string;
  restoredProgress?: {
    investedAmount: number;
    totalShares: number;
    totalCost: number;
    cyclesCompleted: number;
  };
}

// =============================================================================
// ACTIVE ORDER TRACKING
// =============================================================================

const activeOrders = new Map<string, DCAOrder>();

export function getActiveDCAOrder(id: string): DCAOrder | undefined {
  return activeOrders.get(id);
}

export function getAllActiveDCAOrders(): DCAOrder[] {
  return Array.from(activeOrders.values());
}

// =============================================================================
// FACTORY
// =============================================================================

export function createDCAOrder(
  executionService: ExecutionService,
  orderRequest: Omit<OrderRequest, 'size' | 'orderType'>,
  dcaConfig: DCAConfig,
  options?: DCAOrderOptions,
  extraConfig?: Record<string, any>
): DCAOrder {
  const emitter = new EventEmitter() as DCAOrder;
  const orderId = options?.orderId ?? randomUUID();
  (emitter as any).extraConfig = extraConfig;

  let investedAmount = options?.restoredProgress?.investedAmount ?? 0;
  let totalShares = options?.restoredProgress?.totalShares ?? 0;
  let totalCost = options?.restoredProgress?.totalCost ?? 0;
  let cyclesCompleted = options?.restoredProgress?.cyclesCompleted ?? 0;
  let status: PersistedDCAOrder['status'] = 'pending';
  let startedAt: number | undefined;
  let nextCycleAtMs: number | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const maxCycles = dcaConfig.maxCycles ?? Math.ceil(dcaConfig.totalAmount / dcaConfig.amountPerCycle);
  const totalAmount = dcaConfig.totalAmount;

  // Persist on creation
  const now = Date.now();
  const persisted: PersistedDCAOrder = {
    id: orderId,
    userId: options?.userId ?? 'anonymous',
    platform: orderRequest.platform,
    marketId: orderRequest.marketId,
    tokenId: orderRequest.tokenId,
    outcome: orderRequest.outcome,
    side: orderRequest.side,
    price: orderRequest.price,
    totalAmount,
    amountPerCycle: dcaConfig.amountPerCycle,
    cycleIntervalMs: dcaConfig.cycleIntervalMs,
    maxPrice: dcaConfig.maxPrice,
    maxCycles: dcaConfig.maxCycles,
    negRisk: orderRequest.negRisk,
    investedAmount,
    totalShares,
    totalCost,
    cyclesCompleted,
    status: 'pending',
    startedAt: undefined,
    createdAt: now,
    updatedAt: now,
    extraConfig,
  };

  try { saveDCAOrder(persisted); } catch (e) { logger.warn({ err: e }, 'Failed to persist DCA order'); }

  function persist(): void {
    try {
      updateDCAProgress(orderId, {
        investedAmount,
        totalShares,
        totalCost,
        cyclesCompleted,
        status,
        nextCycleAtMs,
        startedAt,
      });
    } catch (e) { logger.warn({ err: e }, 'Failed to update DCA progress'); }
  }

  function getProgress(): DCAProgress {
    return {
      totalAmount,
      investedAmount,
      remainingAmount: totalAmount - investedAmount,
      cyclesCompleted,
      cyclesTotal: maxCycles,
      totalShares,
      avgPrice: totalShares > 0 ? totalCost / totalShares : 0,
      status,
      nextCycleAt: nextCycleAtMs ? new Date(nextCycleAtMs) : undefined,
      startedAt: startedAt ? new Date(startedAt) : undefined,
    };
  }

  async function executeCycle(): Promise<void> {
    if (status !== 'active') return;

    // Check if done
    if (cyclesCompleted >= maxCycles || investedAmount >= totalAmount) {
      status = 'completed';
      persist();
      activeOrders.delete(orderId);
      emitter.emit('complete', getProgress());
      return;
    }

    // Calculate this cycle's size in shares (amount / price)
    const remainingBudget = totalAmount - investedAmount;
    const cycleBudget = Math.min(dcaConfig.amountPerCycle, remainingBudget);
    const cycleShares = Math.floor(cycleBudget / orderRequest.price);

    if (cycleShares <= 0) {
      status = 'completed';
      persist();
      activeOrders.delete(orderId);
      emitter.emit('complete', getProgress());
      return;
    }

    try {
      const result: OrderResult = orderRequest.side === 'sell'
        ? await executionService.sellLimit({ ...orderRequest, size: cycleShares, orderType: 'GTC' })
        : await executionService.buyLimit({ ...orderRequest, size: cycleShares, orderType: 'GTC' });

      if (result.success) {
        const fillPrice = result.avgFillPrice ?? orderRequest.price;
        const cost = cycleShares * fillPrice;
        investedAmount += cost;
        totalShares += cycleShares;
        totalCost += cost;
        cyclesCompleted++;

        emitter.emit('cycle', { cycle: cyclesCompleted, shares: cycleShares, price: fillPrice, progress: getProgress() });
      } else {
        emitter.emit('cycle_failed', { cycle: cyclesCompleted + 1, error: result.error });
      }
    } catch (err: any) {
      emitter.emit('error', err);
    }

    persist();
    scheduleNext();
  }

  function scheduleNext(): void {
    if (status !== 'active') return;
    if (cyclesCompleted >= maxCycles || investedAmount >= totalAmount) {
      status = 'completed';
      persist();
      activeOrders.delete(orderId);
      emitter.emit('complete', getProgress());
      return;
    }
    nextCycleAtMs = Date.now() + dcaConfig.cycleIntervalMs;
    timer = setTimeout(executeCycle, dcaConfig.cycleIntervalMs);
  }

  function start(): void {
    if (status !== 'pending' && status !== 'paused') return;
    status = 'active';
    startedAt = startedAt ?? Date.now();
    activeOrders.set(orderId, emitter);

    const delay = dcaConfig.startAtMs ? Math.max(0, dcaConfig.startAtMs - Date.now()) : 0;
    if (delay > 0) {
      nextCycleAtMs = Date.now() + delay;
      timer = setTimeout(executeCycle, delay);
    } else {
      executeCycle();
    }
    persist();
    emitter.emit('started', getProgress());
  }

  function pause(): void {
    if (status !== 'active') return;
    status = 'paused';
    if (timer) { clearTimeout(timer); timer = null; }
    nextCycleAtMs = undefined;
    persist();
    emitter.emit('paused', getProgress());
  }

  function resumeOrder(): void {
    if (status !== 'paused') return;
    status = 'active';
    scheduleNext();
    persist();
    emitter.emit('resumed', getProgress());
  }

  async function cancel(): Promise<void> {
    status = 'cancelled';
    if (timer) { clearTimeout(timer); timer = null; }
    nextCycleAtMs = undefined;
    persist();
    activeOrders.delete(orderId);
    emitter.emit('cancelled', getProgress());
  }

  emitter.id = orderId;
  emitter.start = start;
  emitter.pause = pause;
  emitter.resume = resumeOrder;
  emitter.cancel = cancel;
  emitter.getProgress = getProgress;

  return emitter;
}

// =============================================================================
// RESUME FROM DB
// =============================================================================

export function resumeDCAOrders(executionService: ExecutionService): DCAOrder[] {
  const orders: DCAOrder[] = [];
  let persisted: PersistedDCAOrder[];
  try {
    persisted = getActiveDCAOrders();
  } catch {
    return orders;
  }

  for (const p of persisted) {
    const orderRequest: Omit<OrderRequest, 'size' | 'orderType'> = {
      platform: p.platform as OrderRequest['platform'],
      marketId: p.marketId,
      tokenId: p.tokenId,
      outcome: p.outcome,
      side: p.side,
      price: p.price,
      negRisk: p.negRisk,
    };

    const config: DCAConfig = {
      totalAmount: p.totalAmount,
      amountPerCycle: p.amountPerCycle,
      cycleIntervalMs: p.cycleIntervalMs,
      maxPrice: p.maxPrice,
      maxCycles: p.maxCycles,
    };

    const order = createDCAOrder(executionService, orderRequest, config, {
      userId: p.userId,
      orderId: p.id,
      restoredProgress: {
        investedAmount: p.investedAmount,
        totalShares: p.totalShares,
        totalCost: p.totalCost,
        cyclesCompleted: p.cyclesCompleted,
      },
    });

    if (p.status === 'active') {
      order.start();
    }

    orders.push(order);
  }

  if (orders.length > 0) {
    logger.info({ count: orders.length }, 'Resumed DCA orders from persistence');
  }

  return orders;
}
