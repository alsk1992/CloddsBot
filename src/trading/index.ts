/**
 * Trading Module - Complete trading infrastructure
 *
 * Features:
 * - Auto-logging all trades to SQLite database
 * - Execution service (Polymarket, Kalshi)
 * - Trading bot framework with built-in strategies
 * - Risk management
 * - Performance tracking and analytics
 *
 * Usage:
 * ```typescript
 * import { createTradingSystem } from './trading';
 *
 * const trading = createTradingSystem(db, config);
 *
 * // Execute trades (auto-logged)
 * await trading.execution.buyLimit({ platform: 'polymarket', tokenId: '...', price: 0.5, size: 100 });
 *
 * // Register and run bots
 * trading.bots.registerStrategy(createMeanReversionStrategy());
 * await trading.bots.startBot('mean-reversion');
 *
 * // View stats
 * const stats = trading.logger.getStats();
 * ```
 */

import { EventEmitter } from 'eventemitter3';
import { Database } from '../db/index';
import { logger } from '../utils/logger';
import type { Platform } from '../types';

// Re-export sub-modules (avoiding duplicate exports)
export * from './logger';
export * from './bots/index';
export {
  createExecutionService,
  type ExecutionService,
  type ExecutionConfig,
  type OrderRequest,
  type OrderResult,
  type OpenOrder,
} from '../execution/index';
export * from './risk';
export * from './state';
export * from './stream';
export * from './builder';
export * from './accounts';
export * from './safety';
export * from './resilience';
export * from './secrets';
export {
  createBacktestEngine,
  type BacktestEngine,
  type BacktestConfig,
  type BacktestResult,
  type BacktestMetrics,
} from './backtest';
export * from './tracking';
export * from './devtools';
export * from './copy-trading';
export * from './kelly';
export * from './ml-signals';
export * from './market-making/index';

import {
  createTradeLogger,
  TradeLogger,
  Trade,
  TradeFilter,
  TradeStats,
} from './logger';

import {
  createBotManager,
  BotManager,
  BotManagerConfig,
  Strategy,
  StrategyConfig,
  Signal,
  createMeanReversionStrategy,
  createMomentumStrategy,
  createArbitrageStrategy,
} from './bots/index';

import {
  createExecutionService,
  ExecutionService,
  ExecutionConfig,
  OrderRequest,
  OrderResult,
  OpenOrder,
} from '../execution/index';

// =============================================================================
// TYPES
// =============================================================================

export interface TradingSystemConfig {
  /** Execution configuration */
  execution?: ExecutionConfig;
  /** Default check interval for bots (ms) */
  botIntervalMs?: number;
  /** Enable auto-logging (default: true) */
  autoLog?: boolean;
  /** Portfolio value for position sizing */
  portfolioValue?: number;
}

export interface TradingSystem extends EventEmitter {
  /** Trade logger - auto-captures all trades */
  logger: TradeLogger;

  /** Execution service - wrapped with auto-logging */
  execution: ExecutionService;

  /** Bot manager - manage trading strategies */
  bots: BotManager;

  /** Get portfolio state */
  getPortfolio(): Promise<{
    value: number;
    balance: number;
    positions: Array<{
      platform: Platform;
      marketId: string;
      outcome: string;
      shares: number;
      avgPrice: number;
      currentPrice: number;
      pnl: number;
      pnlPct: number;
    }>;
  }>;

  /** Quick stats */
  getStats(filter?: TradeFilter): TradeStats;

  /** Daily PnL summary */
  getDailyPnL(days?: number): Array<{ date: string; pnl: number; trades: number }>;

  /** Export trades to CSV */
  exportTrades(filter?: TradeFilter): string;

  /** Shutdown all bots */
  shutdown(): Promise<void>;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createTradingSystem(db: Database, config: TradingSystemConfig = {}): TradingSystem {
  const emitter = new EventEmitter() as TradingSystem;

  // Create trade logger
  const tradeLogger = createTradeLogger(db);

  // Create raw execution service
  const rawExecution = config.execution
    ? createExecutionService(config.execution)
    : createExecutionService({ dryRun: true });

  // Wrap execution with auto-logging
  const execution = wrapExecutionWithLogging(rawExecution, tradeLogger, config.autoLog !== false);

  // Create bot manager with execute handler
  const botManagerConfig: BotManagerConfig = {
    defaultIntervalMs: config.botIntervalMs || 60000,
    executeOrder: async (signal, strategyId) => {
      const strategy = emitter.bots.getStrategies().find((s) => s.id === strategyId);
      const strategyName = strategy?.name || strategyId;

      // Convert signal to order request
      const orderRequest: OrderRequest = {
        platform: signal.platform as 'polymarket' | 'kalshi',
        marketId: signal.marketId,
        tokenId: signal.meta?.tokenId as string,
        outcome: signal.outcome,
        side: signal.type === 'buy' ? 'buy' : 'sell',
        price: signal.price || 0.5,
        size: signal.size || signal.sizePct
          ? Math.floor((config.portfolioValue || 10000) * (signal.sizePct || 5) / 100 / (signal.price || 0.5))
          : 100,
        orderType: signal.price ? 'GTC' : 'FOK',
      };

      const result = signal.type === 'buy'
        ? await execution.buyLimit(orderRequest)
        : await execution.sellLimit(orderRequest);

      if (result.success) {
        // Trade is already logged by wrapped execution
        // Just return the logged trade
        const trades = tradeLogger.getTrades({ limit: 1 });
        return trades[0] || null;
      }

      return null;
    },
    getPortfolio: async () => {
      const portfolio = await emitter.getPortfolio();
      return {
        value: portfolio.value,
        balance: portfolio.balance,
        positions: portfolio.positions.map((p) => ({
          platform: p.platform,
          marketId: p.marketId,
          outcome: p.outcome,
          shares: p.shares,
          avgPrice: p.avgPrice,
          currentPrice: p.currentPrice,
        })),
      };
    },
  };

  const bots = createBotManager(db, botManagerConfig);

  // Forward events
  tradeLogger.on('trade', (trade) => emitter.emit('trade', trade));
  tradeLogger.on('tradeFilled', (trade) => emitter.emit('tradeFilled', trade));
  tradeLogger.on('tradeCancelled', (trade) => emitter.emit('tradeCancelled', trade));
  bots.on('signals', (data) => emitter.emit('signals', data));
  bots.on('botStarted', (id) => emitter.emit('botStarted', id));
  bots.on('botStopped', (id) => emitter.emit('botStopped', id));

  // Attach components
  Object.assign(emitter, {
    logger: tradeLogger,
    execution,
    bots,

    async getPortfolio() {
      // Get positions from recent trades
      const positions = new Map<string, {
        platform: Platform;
        marketId: string;
        outcome: string;
        shares: number;
        totalCost: number;
        avgPrice: number;
      }>();

      const trades = tradeLogger.getTrades({ status: 'filled' });

      for (const trade of trades) {
        const key = `${trade.platform}:${trade.marketId}:${trade.outcome}`;
        const pos = positions.get(key) || {
          platform: trade.platform,
          marketId: trade.marketId,
          outcome: trade.outcome,
          shares: 0,
          totalCost: 0,
          avgPrice: 0,
        };

        if (trade.side === 'buy') {
          pos.shares += trade.filled;
          pos.totalCost += trade.cost;
        } else {
          pos.shares -= trade.filled;
          pos.totalCost -= trade.filled * pos.avgPrice;
        }

        if (pos.shares > 0) {
          pos.avgPrice = pos.totalCost / pos.shares;
          positions.set(key, pos);
        } else {
          positions.delete(key);
        }
      }

      // Calculate portfolio value (simplified - would need current prices)
      const openPositions = Array.from(positions.values())
        .filter((p) => p.shares > 0)
        .map((p) => ({
          ...p,
          currentPrice: p.avgPrice, // Would need to fetch current price
          pnl: 0,
          pnlPct: 0,
        }));

      const positionsValue = openPositions.reduce((sum, p) => sum + p.shares * p.currentPrice, 0);

      return {
        value: (config.portfolioValue || 10000) + positionsValue,
        balance: (config.portfolioValue || 10000) - positionsValue,
        positions: openPositions,
      };
    },

    getStats(filter) {
      return tradeLogger.getStats(filter);
    },

    getDailyPnL(days = 30) {
      return tradeLogger.getDailyPnL(days);
    },

    exportTrades(filter) {
      return tradeLogger.exportCsv(filter);
    },

    async shutdown() {
      const statuses = bots.getAllBotStatuses();
      for (const status of statuses) {
        if (status.status === 'running' || status.status === 'paused') {
          await bots.stopBot(status.id);
        }
      }
      logger.info('Trading system shutdown complete');
    },
  } as Partial<TradingSystem>);

  logger.info('Trading system initialized');
  return emitter;
}

// =============================================================================
// EXECUTION WRAPPER WITH AUTO-LOGGING
// =============================================================================

function wrapExecutionWithLogging(
  execution: ExecutionService,
  tradeLogger: TradeLogger,
  autoLog: boolean
): ExecutionService {
  if (!autoLog) return execution;

  const wrapMethod = <T extends (...args: any[]) => Promise<OrderResult>>(
    method: T,
    side: 'buy' | 'sell',
    orderType: 'limit' | 'market' | 'maker' | 'protected'
  ): T => {
    return (async (...args: Parameters<T>) => {
      const request = args[0] as OrderRequest;
      const result = await method.apply(execution, args);

      // Log the trade
      if (result.success || result.orderId) {
        tradeLogger.logTrade({
          platform: request.platform,
          marketId: request.marketId,
          outcome: request.outcome || request.tokenId || 'unknown',
          side,
          orderType,
          price: request.price || 0.5,
          size: request.size,
          filled: result.filledSize || 0,
          cost: (request.price || 0.5) * request.size,
          orderId: result.orderId,
          status: result.status === 'filled' ? 'filled'
            : result.status === 'open' ? 'pending'
            : result.status === 'cancelled' ? 'cancelled'
            : result.status === 'expired' || result.status === 'rejected' ? 'failed'
            : 'pending',
          meta: {
            transactionHash: result.transactionHash,
            avgFillPrice: result.avgFillPrice,
          },
        });
      }

      return result;
    }) as T;
  };

  return {
    buyLimit: wrapMethod(execution.buyLimit.bind(execution), 'buy', 'limit'),
    sellLimit: wrapMethod(execution.sellLimit.bind(execution), 'sell', 'limit'),
    marketBuy: wrapMethod(execution.marketBuy.bind(execution), 'buy', 'market'),
    marketSell: wrapMethod(execution.marketSell.bind(execution), 'sell', 'market'),
    makerBuy: wrapMethod(execution.makerBuy.bind(execution), 'buy', 'maker'),
    makerSell: wrapMethod(execution.makerSell.bind(execution), 'sell', 'maker'),
    cancelOrder: execution.cancelOrder.bind(execution),
    cancelAllOrders: execution.cancelAllOrders.bind(execution),
    getOpenOrders: execution.getOpenOrders.bind(execution),
    getOrder: execution.getOrder.bind(execution),
    estimateFill: execution.estimateFill.bind(execution),
    protectedBuy: wrapMethod(execution.protectedBuy.bind(execution), 'buy', 'protected'),
    protectedSell: wrapMethod(execution.protectedSell.bind(execution), 'sell', 'protected'),
    estimateSlippage: execution.estimateSlippage.bind(execution),
    placeOrdersBatch: execution.placeOrdersBatch.bind(execution),
    cancelOrdersBatch: execution.cancelOrdersBatch.bind(execution),
    // Fill WebSocket methods (pass through directly)
    connectFillsWebSocket: execution.connectFillsWebSocket.bind(execution),
    disconnectFillsWebSocket: execution.disconnectFillsWebSocket.bind(execution),
    isFillsWebSocketConnected: execution.isFillsWebSocketConnected.bind(execution),
    onFill: execution.onFill.bind(execution),
    onOrder: execution.onOrder.bind(execution),
    getTrackedFills: execution.getTrackedFills.bind(execution),
    getTrackedFill: execution.getTrackedFill.bind(execution),
    clearOldFills: execution.clearOldFills.bind(execution),
    waitForFill: execution.waitForFill.bind(execution),
    // Heartbeat methods (Polymarket - orders cancelled if no heartbeat)
    startHeartbeat: execution.startHeartbeat.bind(execution),
    sendHeartbeat: execution.sendHeartbeat.bind(execution),
    stopHeartbeat: execution.stopHeartbeat.bind(execution),
    isHeartbeatActive: execution.isHeartbeatActive.bind(execution),
    // Settlement methods (Polymarket)
    getPendingSettlements: execution.getPendingSettlements.bind(execution),
    // Collateral approval methods (Polymarket)
    approveUSDC: execution.approveUSDC.bind(execution),
    getUSDCAllowance: execution.getUSDCAllowance.bind(execution),
    // Batch orderbook fetching
    getOrderbooksBatch: execution.getOrderbooksBatch.bind(execution),
    // Circuit breaker integration
    setCircuitBreaker: execution.setCircuitBreaker.bind(execution),
    getCircuitBreakerState: execution.getCircuitBreakerState.bind(execution),
  };
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

export {
  createMeanReversionStrategy,
  createMomentumStrategy,
  createArbitrageStrategy,
};

// Re-export types (only those not already exported via export *)
// Note: Trade, TradeFilter, TradeStats, TradeLogger are from ./logger
// Strategy, StrategyConfig, Signal, BotManager are from ./bots/index
// OpenOrder, OrderRequest, OrderResult are from ../execution/index (explicitly exported above)
