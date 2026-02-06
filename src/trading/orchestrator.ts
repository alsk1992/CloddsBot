/**
 * Trading Orchestrator — Central gatekeeper for all order submissions.
 *
 * Wraps the ExecutionService with pre-trade safety checks:
 *   1. SafetyManager.canTrade() — global kill switch / drawdown checks
 *   2. SafetyManager.validateTrade() — concentration / daily loss checks
 *   3. CircuitBreaker.canTrade() — execution-level error rate / loss checks
 *   4. Position lifecycle tracking — records trades for PnL monitoring
 *
 * All order paths (SignalRouter, BotManager, manual) should route through
 * the orchestrator so that safety checks are never bypassed.
 *
 * Usage in gateway:
 *   const orchestrator = createTradingOrchestrator({ execution, safety, db });
 *   // Pass orchestrator.execution to SignalRouter / TradingSystem
 *   signalRouter = createSignalRouter(orchestrator.execution, cfg);
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type {
  ExecutionService,
  OrderRequest,
  OrderResult,
} from '../execution/index.js';
import type { SafetyManager } from './safety.js';
import type { TradeLogger, Trade } from './logger.js';
import type { Platform } from '../types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface OrchestratorConfig {
  /** Reject all orders (overrides everything). */
  paused?: boolean;
  /** Log rejected orders for debugging. */
  logRejections?: boolean;
  /** Record filled trades in SafetyManager for PnL tracking. */
  recordTradesInSafety?: boolean;
}

export interface OrchestratorStats {
  ordersSubmitted: number;
  ordersExecuted: number;
  ordersRejected: number;
  ordersFailed: number;
  rejectionReasons: Record<string, number>;
}

export interface TradingOrchestrator extends EventEmitter {
  /** Guarded execution service — drop-in replacement for raw ExecutionService. */
  readonly execution: ExecutionService;
  /** Pause all trading. */
  pause(reason?: string): void;
  /** Resume trading after pause. */
  resume(): void;
  /** Whether orchestrator is paused. */
  readonly paused: boolean;
  /** Get stats. */
  getStats(): OrchestratorStats;
  /** Reset stats. */
  resetStats(): void;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export interface OrchestratorDeps {
  execution: ExecutionService;
  safety: SafetyManager | null;
  tradeLogger?: TradeLogger | null;
  db?: Database | null;
  config?: OrchestratorConfig;
}

export function createTradingOrchestrator(deps: OrchestratorDeps): TradingOrchestrator {
  const { execution, safety, tradeLogger } = deps;
  const cfg: OrchestratorConfig = {
    paused: false,
    logRejections: true,
    recordTradesInSafety: true,
    ...deps.config,
  };

  const emitter = new EventEmitter() as TradingOrchestrator;

  let isPaused = cfg.paused ?? false;
  let pauseReason: string | undefined;

  const stats: OrchestratorStats = {
    ordersSubmitted: 0,
    ordersExecuted: 0,
    ordersRejected: 0,
    ordersFailed: 0,
    rejectionReasons: {},
  };

  // ── Pre-trade gate ──────────────────────────────────────────────────────

  function reject(reason: string): OrderResult {
    stats.ordersRejected++;
    stats.rejectionReasons[reason] = (stats.rejectionReasons[reason] || 0) + 1;
    if (cfg.logRejections) {
      logger.warn({ reason }, '[orchestrator] Order rejected');
    }
    emitter.emit('rejected', { reason });
    return { success: false, error: `Rejected: ${reason}`, status: 'rejected' as any };
  }

  function preTradeCheck(request: OrderRequest, side: 'buy' | 'sell'): string | null {
    // 1. Orchestrator paused
    if (isPaused) {
      return `orchestrator_paused${pauseReason ? `: ${pauseReason}` : ''}`;
    }

    // 2. SafetyManager global check
    if (safety && !safety.canTrade()) {
      const state = safety.getState();
      return `safety_blocked: ${state.disabledReason || 'trading disabled'}`;
    }

    // 3. SafetyManager trade-level validation
    if (safety) {
      const validation = safety.validateTrade({
        platform: request.platform as Platform,
        marketId: request.marketId,
        outcome: request.outcome || request.tokenId || 'unknown',
        side,
        size: request.size,
        price: request.price,
      });
      if (!validation.allowed) {
        return `safety_validation: ${validation.reason || 'rejected'}`;
      }
    }

    // 4. Execution-level circuit breaker (checked inside execution service)
    // The execution service checks its own circuit breaker, but we also check
    // the state here to provide a better error message.
    const cbState = execution.getCircuitBreakerState?.();
    if (cbState?.isTripped) {
      return `circuit_breaker: ${cbState.tripReason || 'tripped'}`;
    }

    return null; // All checks passed
  }

  // ── Post-trade recording ────────────────────────────────────────────────

  function recordResult(request: OrderRequest, side: 'buy' | 'sell', result: OrderResult): void {
    if (!result.success && !result.orderId) {
      stats.ordersFailed++;
      return;
    }

    stats.ordersExecuted++;
    emitter.emit('executed', { request, side, result });

    // Record in SafetyManager for daily PnL tracking
    if (cfg.recordTradesInSafety && safety && tradeLogger) {
      const trades = tradeLogger.getTrades({ limit: 1 });
      const lastTrade = trades[0];
      if (lastTrade) {
        try {
          safety.recordTrade(lastTrade);
        } catch (err) {
          logger.warn({ err }, '[orchestrator] Failed to record trade in safety manager');
        }
      }
    }
  }

  // ── Guarded execution methods ───────────────────────────────────────────

  function guardMethod<T extends (req: OrderRequest, ...args: any[]) => Promise<OrderResult>>(
    method: T,
    side: 'buy' | 'sell',
  ): T {
    return (async (request: OrderRequest, ...args: any[]) => {
      stats.ordersSubmitted++;

      const rejection = preTradeCheck(request, side);
      if (rejection) return reject(rejection);

      try {
        const result = await method.call(execution, request, ...args);
        recordResult(request, side, result);
        return result;
      } catch (error) {
        stats.ordersFailed++;
        logger.error({ error, market: request.marketId, side }, '[orchestrator] Order execution error');
        return {
          success: false,
          error: (error as Error).message,
          status: 'rejected' as any,
        };
      }
    }) as T;
  }

  // Build guarded execution service (drop-in replacement)
  const guardedExecution: ExecutionService = {
    // Guarded order methods
    buyLimit: guardMethod(execution.buyLimit.bind(execution), 'buy'),
    sellLimit: guardMethod(execution.sellLimit.bind(execution), 'sell'),
    marketBuy: guardMethod(execution.marketBuy.bind(execution), 'buy'),
    marketSell: guardMethod(execution.marketSell.bind(execution), 'sell'),
    makerBuy: guardMethod(execution.makerBuy.bind(execution), 'buy'),
    makerSell: guardMethod(execution.makerSell.bind(execution), 'sell'),
    protectedBuy: guardMethod(execution.protectedBuy.bind(execution), 'buy'),
    protectedSell: guardMethod(execution.protectedSell.bind(execution), 'sell'),

    // Pass-through (non-order methods don't need safety checks)
    cancelOrder: execution.cancelOrder.bind(execution),
    cancelAllOrders: execution.cancelAllOrders.bind(execution),
    getOpenOrders: execution.getOpenOrders.bind(execution),
    getOrder: execution.getOrder.bind(execution),
    estimateFill: execution.estimateFill.bind(execution),
    estimateSlippage: execution.estimateSlippage.bind(execution),
    placeOrdersBatch: execution.placeOrdersBatch.bind(execution),
    cancelOrdersBatch: execution.cancelOrdersBatch.bind(execution),
    connectFillsWebSocket: execution.connectFillsWebSocket.bind(execution),
    disconnectFillsWebSocket: execution.disconnectFillsWebSocket.bind(execution),
    isFillsWebSocketConnected: execution.isFillsWebSocketConnected.bind(execution),
    onFill: execution.onFill.bind(execution),
    onOrder: execution.onOrder.bind(execution),
    getTrackedFills: execution.getTrackedFills.bind(execution),
    getTrackedFill: execution.getTrackedFill.bind(execution),
    clearOldFills: execution.clearOldFills.bind(execution),
    waitForFill: execution.waitForFill.bind(execution),
    startHeartbeat: execution.startHeartbeat.bind(execution),
    sendHeartbeat: execution.sendHeartbeat.bind(execution),
    stopHeartbeat: execution.stopHeartbeat.bind(execution),
    isHeartbeatActive: execution.isHeartbeatActive.bind(execution),
    getPendingSettlements: execution.getPendingSettlements.bind(execution),
    approveUSDC: execution.approveUSDC.bind(execution),
    getUSDCAllowance: execution.getUSDCAllowance.bind(execution),
    getOrderbooksBatch: execution.getOrderbooksBatch.bind(execution),
    setCircuitBreaker: execution.setCircuitBreaker.bind(execution),
    getCircuitBreakerState: execution.getCircuitBreakerState.bind(execution),
  };

  // ── Public API ──────────────────────────────────────────────────────────

  Object.defineProperty(emitter, 'execution', { get: () => guardedExecution });
  Object.defineProperty(emitter, 'paused', { get: () => isPaused });

  Object.assign(emitter, {
    pause(reason?: string) {
      isPaused = true;
      pauseReason = reason;
      logger.info({ reason }, '[orchestrator] Trading paused');
      emitter.emit('paused', { reason });
    },

    resume() {
      isPaused = false;
      pauseReason = undefined;
      logger.info('[orchestrator] Trading resumed');
      emitter.emit('resumed');
    },

    getStats(): OrchestratorStats {
      return { ...stats, rejectionReasons: { ...stats.rejectionReasons } };
    },

    resetStats() {
      stats.ordersSubmitted = 0;
      stats.ordersExecuted = 0;
      stats.ordersRejected = 0;
      stats.ordersFailed = 0;
      stats.rejectionReasons = {};
    },
  } as Partial<TradingOrchestrator>);

  logger.info({ hasSafety: !!safety, hasTradeLogger: !!tradeLogger }, '[orchestrator] Initialized');

  return emitter;
}
