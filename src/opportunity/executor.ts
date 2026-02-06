/**
 * Opportunity Auto-Executor - Automatically execute detected arbitrage opportunities
 *
 * Features:
 * - Listen to opportunity events and auto-execute
 * - Risk limits (max position, daily loss, concurrent trades)
 * - Execution confirmation before committing
 * - Outcome tracking and PnL recording
 * - Configurable filters (min edge, platforms, liquidity)
 *
 * Usage:
 * ```typescript
 * const executor = createOpportunityExecutor(finder, execution, config);
 * executor.start();
 *
 * // Listen for execution events
 * executor.on('executed', (opp, result) => console.log('Executed:', opp.id));
 * executor.on('skipped', (opp, reason) => console.log('Skipped:', reason));
 *
 * // Check stats
 * const stats = executor.getStats();
 * ```
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '../utils/logger';
import { generateId as generateSecureId } from '../utils/id';
import type { Platform } from '../types';
import type { OpportunityFinder, Opportunity, ExecutionStep } from './index';
import type { ExecutionService, OrderResult } from '../execution/index';
import { getMarketFeatures, checkLiquidity, checkSpread, isArbitrageReady, type FeatureThresholds } from '../services/feature-engineering';
import type { CircuitBreaker } from '../risk/circuit-breaker';
import type { SmartRouter } from '../execution/smart-router';

// =============================================================================
// TYPES
// =============================================================================

export interface OpportunityExecutorConfig {
  /** Minimum edge % to execute (default: 1.0) */
  minEdge?: number;
  /** Minimum liquidity $ (default: 500) */
  minLiquidity?: number;
  /** Maximum position size per trade $ (default: 100) */
  maxPositionSize?: number;
  /** Maximum daily loss $ (default: 500) */
  maxDailyLoss?: number;
  /** Maximum concurrent positions (default: 3) */
  maxConcurrentPositions?: number;
  /** Platforms to execute on (default: ['polymarket', 'kalshi']) */
  enabledPlatforms?: Platform[];
  /** Opportunity types to execute (default: ['internal']) */
  enabledTypes?: Array<'internal' | 'cross_platform' | 'edge'>;
  /** Use maker orders when possible (default: true) */
  preferMakerOrders?: boolean;
  /** Dry run mode - log but don't execute (default: true) */
  dryRun?: boolean;
  /** Confirmation delay ms before executing (default: 0) */
  confirmationDelayMs?: number;
  /** Skip if price moved more than this % (default: 0.5) */
  maxPriceSlippage?: number;
  /** Enable feature-based filtering (default: true) */
  useFeatureFilters?: boolean;
  /** Feature thresholds for filtering (overrides defaults) */
  featureThresholds?: Partial<FeatureThresholds>;
  /** Circuit breaker for risk management */
  circuitBreaker?: CircuitBreaker;
}

export interface ExecutionResult {
  opportunityId: string;
  success: boolean;
  steps: StepResult[];
  totalCost: number;
  expectedProfit: number;
  actualProfit?: number;
  error?: string;
  executedAt: Date;
}

export interface StepResult {
  step: ExecutionStep;
  orderResult: OrderResult;
  fillPrice?: number;
  fillSize?: number;
}

export interface ExecutorStats {
  totalOpportunitiesSeen: number;
  totalExecuted: number;
  totalSkipped: number;
  totalProfit: number;
  totalLoss: number;
  winRate: number;
  avgEdge: number;
  currentDailyPnL: number;
  currentOpenPositions: number;
  skipReasons: Record<string, number>;
}

export interface OpportunityExecutor extends EventEmitter {
  /** Start auto-execution */
  start(): void;

  /** Stop auto-execution */
  stop(): void;

  /** Check if running */
  isRunning(): boolean;

  /** Manually execute an opportunity */
  execute(opportunity: Opportunity): Promise<ExecutionResult>;

  /** Get execution stats */
  getStats(): ExecutorStats;

  /** Get recent executions */
  getRecentExecutions(limit?: number): ExecutionResult[];

  /** Reset daily stats */
  resetDailyStats(): void;

  /** Update config */
  updateConfig(config: Partial<OpportunityExecutorConfig>): void;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

const DEFAULT_CONFIG: Required<OpportunityExecutorConfig> = {
  minEdge: 1.0,
  minLiquidity: 500,
  maxPositionSize: 100,
  maxDailyLoss: 500,
  maxConcurrentPositions: 3,
  enabledPlatforms: ['polymarket', 'kalshi'],
  enabledTypes: ['internal'],
  preferMakerOrders: true,
  dryRun: true, // Safe default
  confirmationDelayMs: 0,
  maxPriceSlippage: 0.5,
  useFeatureFilters: true,
  featureThresholds: {},
  circuitBreaker: undefined as unknown as CircuitBreaker, // Optional - set at runtime
};

export function createOpportunityExecutor(
  finder: OpportunityFinder,
  execution: ExecutionService | null,
  config: OpportunityExecutorConfig = {},
  smartRouter?: SmartRouter | null
): OpportunityExecutor {
  const emitter = new EventEmitter() as OpportunityExecutor;
  let cfg = { ...DEFAULT_CONFIG, ...config };

  let running = false;
  let opportunityHandler: ((opp: Opportunity) => void) | null = null;

  // Stats tracking
  const stats: ExecutorStats = {
    totalOpportunitiesSeen: 0,
    totalExecuted: 0,
    totalSkipped: 0,
    totalProfit: 0,
    totalLoss: 0,
    winRate: 0,
    avgEdge: 0,
    currentDailyPnL: 0,
    currentOpenPositions: 0,
    skipReasons: {},
  };

  const recentExecutions: ExecutionResult[] = [];
  const openPositions = new Set<string>();

  function recordSkip(reason: string): void {
    stats.totalSkipped++;
    stats.skipReasons[reason] = (stats.skipReasons[reason] || 0) + 1;
  }

  function shouldExecute(opp: Opportunity): { execute: boolean; reason?: string } {
    stats.totalOpportunitiesSeen++;

    // Check circuit breaker first
    if (cfg.circuitBreaker) {
      for (const market of opp.markets) {
        if (!cfg.circuitBreaker.canTrade(market.platform, market.marketId)) {
          return { execute: false, reason: 'circuit_breaker_tripped' };
        }
      }
    }

    // Check edge threshold
    if (opp.edgePct < cfg.minEdge) {
      return { execute: false, reason: `edge_too_low (${opp.edgePct.toFixed(2)}% < ${cfg.minEdge}%)` };
    }

    // Check liquidity
    if (opp.totalLiquidity < cfg.minLiquidity) {
      return { execute: false, reason: `liquidity_too_low ($${opp.totalLiquidity} < $${cfg.minLiquidity})` };
    }

    // Check type
    if (!cfg.enabledTypes.includes(opp.type)) {
      return { execute: false, reason: `type_disabled (${opp.type})` };
    }

    // Check platforms
    const platforms = opp.markets.map((m) => m.platform);
    if (!platforms.every((p) => cfg.enabledPlatforms.includes(p))) {
      return { execute: false, reason: `platform_disabled (${platforms.join(', ')})` };
    }

    // Check daily loss limit
    if (stats.currentDailyPnL <= -cfg.maxDailyLoss) {
      return { execute: false, reason: `daily_loss_limit_reached ($${stats.currentDailyPnL})` };
    }

    // Check concurrent positions
    if (openPositions.size >= cfg.maxConcurrentPositions) {
      return { execute: false, reason: `max_concurrent_positions (${openPositions.size}/${cfg.maxConcurrentPositions})` };
    }

    // Check if already taken
    if (opp.status !== 'active') {
      return { execute: false, reason: `opportunity_not_active (${opp.status})` };
    }

    // Feature-based checks (if enabled)
    if (cfg.useFeatureFilters) {
      for (const market of opp.markets) {
        const features = getMarketFeatures(market.platform, market.marketId, market.outcome);

        // Skip if features unavailable - don't block execution
        if (!features) continue;

        // Check if market is ready for arbitrage (liquidity + spread)
        if (!isArbitrageReady(features, cfg.featureThresholds)) {
          const liquidityScore = features.signals.liquidityScore;
          const spreadPct = features.orderbook?.spreadPct ?? 0;
          logger.debug(
            { oppId: opp.id, market: market.marketId, liquidityScore, spreadPct },
            'Skip arb: market conditions unfavorable'
          );
          return {
            execute: false,
            reason: `feature_check_failed (liquidity=${liquidityScore.toFixed(2)}, spread=${spreadPct.toFixed(2)}%)`,
          };
        }
      }
    }

    return { execute: true };
  }

  async function executeOpportunity(opp: Opportunity): Promise<ExecutionResult> {
    const result: ExecutionResult = {
      opportunityId: opp.id,
      success: false,
      steps: [],
      totalCost: 0,
      expectedProfit: opp.execution.estimatedProfit,
      executedAt: new Date(),
    };

    logger.info(
      { oppId: opp.id, type: opp.type, edge: opp.edgePct, dryRun: cfg.dryRun },
      'Executing opportunity'
    );

    openPositions.add(opp.id);

    try {
      // Try to improve routing via SmartRouter for each step
      const routeOverrides = new Map<number, { platform: string; price: number }>();
      if (smartRouter) {
        for (const step of opp.execution.steps) {
          try {
            const route = await smartRouter.findBestRoute({
              marketId: step.marketId,
              side: step.action as 'buy' | 'sell',
              size: Math.min(step.size, cfg.maxPositionSize / step.price),
            });
            if (route.bestRoute && route.bestRoute.platform !== step.platform) {
              routeOverrides.set(step.order, {
                platform: route.bestRoute.platform,
                price: route.bestRoute.price,
              });
              logger.info(
                { step: step.order, from: step.platform, to: route.bestRoute.platform, savings: route.totalSavings },
                'SmartRouter rerouted execution step'
              );
            }
          } catch (error) {
            logger.debug({ error, step: step.order }, 'SmartRouter routing failed — using original platform');
          }
        }
      }

      // Execute each step in order
      for (const step of opp.execution.steps) {
        const override = routeOverrides.get(step.order);
        const effectivePlatform = override?.platform ?? step.platform;
        const effectivePrice = override?.price ?? step.price;

        // Use GTC order type; postOnly ensures maker-only execution if preferred
        const orderType = step.orderType === 'market' ? 'FOK' : 'GTC';
        const postOnly = cfg.preferMakerOrders && step.orderType !== 'market';

        // Determine size (capped by maxPositionSize)
        const maxSize = cfg.maxPositionSize / effectivePrice;
        const size = Math.min(step.size, maxSize);

        let orderResult: OrderResult;

        if (cfg.dryRun) {
          // Simulate order
          orderResult = {
            success: true,
            orderId: generateSecureId('dry'),
            status: 'filled',
            filledSize: size,
            avgFillPrice: effectivePrice,
          };
          logger.info({ step, dryRun: true, platform: effectivePlatform }, 'Dry run order');
        } else if (execution) {
          // Real execution (using routed platform + price)
          if (step.action === 'buy') {
            orderResult = await execution.buyLimit({
              platform: effectivePlatform as 'polymarket' | 'kalshi',
              marketId: step.marketId,
              tokenId: step.marketId,
              outcome: step.outcome,
              price: effectivePrice,
              size,
              orderType,
              postOnly,
            });
          } else {
            orderResult = await execution.sellLimit({
              platform: effectivePlatform as 'polymarket' | 'kalshi',
              marketId: step.marketId,
              tokenId: step.marketId,
              outcome: step.outcome,
              price: effectivePrice,
              size,
              orderType,
              postOnly,
            });
          }
        } else {
          // No execution service available but dryRun=false - treat as error
          logger.error({ step }, 'Cannot execute: no execution service configured');
          orderResult = {
            success: false,
            error: 'No execution service configured',
          };
        }

        const stepResult: StepResult = {
          step,
          orderResult,
          fillPrice: orderResult.avgFillPrice,
          fillSize: orderResult.filledSize,
        };

        result.steps.push(stepResult);
        result.totalCost += (orderResult.filledSize || size) * effectivePrice;

        if (!orderResult.success) {
          result.error = `Step ${step.order} failed: ${orderResult.error}`;
          logger.error({ step, error: orderResult.error }, 'Execution step failed');
          break;
        }
      }

      // Check if all steps succeeded
      result.success = result.steps.every((s) => s.orderResult.success);

      if (result.success) {
        stats.totalExecuted++;

        // Mark opportunity as taken
        const fillPrices: Record<string, number> = {};
        for (const stepResult of result.steps) {
          const key = `${stepResult.step.platform}:${stepResult.step.marketId}`;
          fillPrices[key] = stepResult.fillPrice || stepResult.step.price;
        }
        finder.markTaken(opp.id, fillPrices);

        // Calculate actual profit (simplified - would need settlement tracking)
        result.actualProfit = result.expectedProfit;
        stats.totalProfit += result.actualProfit;
        stats.currentDailyPnL += result.actualProfit;

        // Update win rate
        stats.winRate = stats.totalProfit > 0
          ? (stats.totalExecuted / (stats.totalExecuted + stats.totalSkipped)) * 100
          : 0;

        logger.info(
          { oppId: opp.id, profit: result.actualProfit, totalCost: result.totalCost },
          'Opportunity executed successfully'
        );

        cfg.circuitBreaker?.recordTrade({ success: true, pnl: result.actualProfit });
        emitter.emit('executed', opp, result);
      } else {
        recordSkip('execution_failed');
        logger.warn({ oppId: opp.id, error: result.error }, 'Opportunity execution failed');
        cfg.circuitBreaker?.recordTrade({ success: false });
        emitter.emit('failed', opp, result);
      }
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : 'Unknown error';
      recordSkip('execution_error');
      logger.error({ oppId: opp.id, error }, 'Opportunity execution error');
      emitter.emit('error', opp, error);
    } finally {
      openPositions.delete(opp.id);
    }

    recentExecutions.unshift(result);
    if (recentExecutions.length > 100) {
      recentExecutions.pop();
    }

    return result;
  }

  async function handleOpportunity(opp: Opportunity): Promise<void> {
    const { execute, reason } = shouldExecute(opp);

    if (!execute) {
      recordSkip(reason!);
      logger.debug({ oppId: opp.id, reason }, 'Skipping opportunity');
      emitter.emit('skipped', opp, reason);
      return;
    }

    // Optional confirmation delay
    if (cfg.confirmationDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, cfg.confirmationDelayMs));

      // Re-check opportunity is still active
      const current = finder.get(opp.id);
      if (!current || current.status !== 'active') {
        recordSkip('expired_during_delay');
        return;
      }
    }

    await executeOpportunity(opp);
  }

  // Attach methods
  Object.assign(emitter, {
    start() {
      if (running) return;

      running = true;
      opportunityHandler = (opp: Opportunity) => {
        handleOpportunity(opp).catch((error) => {
          logger.error({ error }, 'Error handling opportunity');
        });
      };

      finder.on('opportunity', opportunityHandler);
      logger.info({ config: cfg }, 'Opportunity executor started');
      emitter.emit('started');
    },

    stop() {
      if (!running) return;

      running = false;
      if (opportunityHandler) {
        finder.off('opportunity', opportunityHandler);
        opportunityHandler = null;
      }

      logger.info('Opportunity executor stopped');
      emitter.emit('stopped');
    },

    isRunning() {
      return running;
    },

    async execute(opportunity: Opportunity) {
      return executeOpportunity(opportunity);
    },

    getStats() {
      return { ...stats };
    },

    getRecentExecutions(limit = 20) {
      return recentExecutions.slice(0, limit);
    },

    resetDailyStats() {
      stats.currentDailyPnL = 0;
      logger.info('Daily stats reset');
    },

    updateConfig(newConfig: Partial<OpportunityExecutorConfig>) {
      cfg = { ...cfg, ...newConfig };
      logger.info({ config: cfg }, 'Executor config updated');
    },
  } as Partial<OpportunityExecutor>);

  return emitter;
}

export type { OpportunityExecutorConfig as ExecutorConfig };
