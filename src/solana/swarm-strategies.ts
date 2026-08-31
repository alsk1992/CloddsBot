/**
 * Smart Swarm Strategy Execution System
 *
 * Enables complex multi-step trading strategies:
 * - Scale-In/Scale-Out: Gradual entry/exit over price levels
 * - Snipe + Exit: Fast entry with automatic take-profit/stop-loss
 * - Split Strategy: Different wallets do different actions
 * - TWAP/VWAP: Time/volume weighted execution
 * - Conditional: If/then triggers based on price/volume
 * - Arbitrage: Buy on one DEX, sell on another
 * - Rotation: Exit one token, enter another atomically
 * - Market Making: Quote both sides with spread
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { generateId as generateSecureId } from '../utils/id';
import type { DexType } from './swarm-builders';
import type { ExecutionMode } from './pump-swarm';

// ============================================================================
// Strategy Types
// ============================================================================

export type StrategyType =
  | 'scale_in'
  | 'scale_out'
  | 'snipe_exit'
  | 'split'
  | 'twap'
  | 'vwap'
  | 'conditional'
  | 'arbitrage'
  | 'rotation'
  | 'market_make'
  | 'custom';

export type TriggerType = 'price_above' | 'price_below' | 'time' | 'volume' | 'manual' | 'immediate';

export type ActionType = 'buy' | 'sell' | 'cancel' | 'wait' | 'notify';

export interface PriceLevel {
  price: number;
  percent: number; // % of total to execute at this level
}

export interface StrategyStep {
  id: string;
  action: ActionType;
  trigger: TriggerType;
  triggerValue?: number | string;
  params: StepParams;
  dependsOn?: string[];
  timeout?: number;
  retries?: number;
  completed?: boolean;
  result?: StepResult;
}

export interface StepParams {
  mint?: string;
  amount?: number | string;
  amountPercent?: number;
  walletIds?: string[];
  slippageBps?: number;
  pool?: 'pump' | 'raydium' | 'auto';
  executionMode?: ExecutionMode;
  dex?: DexType;
  poolAddress?: string;
}

export interface StepResult {
  success: boolean;
  signature?: string;
  solAmount?: number;
  tokenAmount?: number;
  actualPrice?: number;
  error?: string;
  executedAt: number;
}

export interface Strategy {
  id: string;
  name: string;
  type: StrategyType;
  description?: string;
  mint: string;
  steps: StrategyStep[];
  config: StrategyConfig;
  status: StrategyStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface StrategyConfig {
  totalBudgetSol?: number;
  maxSlippageBps?: number;
  defaultPool?: 'pump' | 'raydium' | 'auto';
  startDelay?: number;
  stepDelay?: number;
  maxDuration?: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  maxLossPerStep?: number;
  walletIds?: string[];
  walletAllocation?: Map<string, number>;
  priceCheckIntervalMs?: number;
  dex?: 'pumpfun' | 'bags' | 'meteora' | 'auto';
  poolAddress?: string;
}

export type StrategyStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface StrategyResult {
  strategyId: string;
  status: StrategyStatus;
  stepsCompleted: number;
  totalSteps: number;
  totalSolSpent: number;
  totalSolReceived: number;
  totalTokensBought: number;
  totalTokensSold: number;
  pnl: number;
  pnlPercent: number;
  executionTimeMs: number;
  stepResults: StepResult[];
  errors: string[];
}

// ============================================================================
// Strategy Builder - Fluent API
// ============================================================================

export class StrategyBuilder {
  private strategy: Partial<Strategy>;
  private stepCounter = 0;

  constructor(name: string, mint: string) {
    this.strategy = {
      id: generateSecureId('strategy'),
      name,
      mint,
      steps: [],
      config: {},
      status: 'pending',
      createdAt: Date.now(),
    };
  }

  type(t: StrategyType): this {
    this.strategy.type = t;
    return this;
  }

  describe(desc: string): this {
    this.strategy.description = desc;
    return this;
  }

  budget(sol: number): this {
    this.strategy.config = { ...this.strategy.config, totalBudgetSol: sol };
    return this;
  }

  maxSlippage(bps: number): this {
    this.strategy.config = { ...this.strategy.config, maxSlippageBps: bps };
    return this;
  }

  wallets(ids: string[]): this {
    this.strategy.config = { ...this.strategy.config, walletIds: ids };
    return this;
  }

  stopLoss(percent: number): this {
    this.strategy.config = { ...this.strategy.config, stopLossPercent: percent };
    return this;
  }

  takeProfit(percent: number): this {
    this.strategy.config = { ...this.strategy.config, takeProfitPercent: percent };
    return this;
  }

  buyNow(amount: number | string, opts?: Partial<StepParams>): this {
    return this.addStep('buy', 'immediate', undefined, { amount, ...opts });
  }

  sellNow(amount: number | string, opts?: Partial<StepParams>): this {
    return this.addStep('sell', 'immediate', undefined, { amount, ...opts });
  }

  buyAt(price: number, amount: number | string, opts?: Partial<StepParams>): this {
    return this.addStep('buy', 'price_below', price, { amount, ...opts });
  }

  sellAt(price: number, amount: number | string, opts?: Partial<StepParams>): this {
    return this.addStep('sell', 'price_above', price, { amount, ...opts });
  }

  buyAtTime(timestamp: number, amount: number | string, opts?: Partial<StepParams>): this {
    return this.addStep('buy', 'time', timestamp, { amount, ...opts });
  }

  sellAtTime(timestamp: number, amount: number | string, opts?: Partial<StepParams>): this {
    return this.addStep('sell', 'time', timestamp, { amount, ...opts });
  }

  sellPercentAt(price: number, percent: number, opts?: Partial<StepParams>): this {
    return this.addStep('sell', 'price_above', price, { amountPercent: percent, ...opts });
  }

  wait(ms: number): this {
    return this.addStep('wait', 'time', Date.now() + ms, {});
  }

  step(action: ActionType, trigger: TriggerType, triggerValue: number | string | undefined, params: StepParams): this {
    return this.addStep(action, trigger, triggerValue, params);
  }

  private addStep(
    action: ActionType,
    trigger: TriggerType,
    triggerValue: number | string | undefined,
    params: StepParams
  ): this {
    const step: StrategyStep = {
      id: `step_${++this.stepCounter}`,
      action,
      trigger,
      triggerValue,
      params: { mint: this.strategy.mint, ...params },
    };
    this.strategy.steps!.push(step);
    return this;
  }

  build(): Strategy {
    if (!this.strategy.type) {
      this.strategy.type = 'custom';
    }
    return this.strategy as Strategy;
  }
}

// ============================================================================
// Pre-built Strategy Templates
// ============================================================================

export const StrategyTemplates = {
  /**
   * Scale-In: Buy in stages as price drops
   */
  scaleIn(mint: string, totalSol: number, levels: PriceLevel[], currentPrice: number): Strategy {
    const builder = new StrategyBuilder('Scale-In', mint)
      .type('scale_in')
      .describe('Buy gradually at lower prices')
      .budget(totalSol);

    for (const level of levels) {
      const targetPrice = currentPrice * (1 - (100 - level.price) / 100);
      const amount = (totalSol * level.percent) / 100;
      if (level.price >= 100) {
        builder.buyNow(amount);
      } else {
        builder.buyAt(targetPrice, amount);
      }
    }

    return builder.build();
  },

  /**
   * Scale-Out: Sell in stages as price rises
   */
  scaleOut(mint: string, levels: PriceLevel[], currentPrice: number): Strategy {
    const builder = new StrategyBuilder('Scale-Out', mint)
      .type('scale_out')
      .describe('Sell gradually at higher prices');

    for (const level of levels) {
      const targetPrice = currentPrice * (1 + level.price / 100);
      builder.sellPercentAt(targetPrice, level.percent);
    }

    return builder.build();
  },

  /**
   * Snipe + Exit: Fast entry with TP/SL
   */
  snipeExit(
    mint: string,
    buySol: number,
    takeProfitPercent: number,
    stopLossPercent: number,
    currentPrice: number
  ): Strategy {
    const tpPrice = currentPrice * (1 + takeProfitPercent / 100);
    const slPrice = currentPrice * (1 - stopLossPercent / 100);

    return new StrategyBuilder('Snipe + Exit', mint)
      .type('snipe_exit')
      .describe(`Entry with ${takeProfitPercent}% TP / ${stopLossPercent}% SL`)
      .budget(buySol)
      .takeProfit(takeProfitPercent)
      .stopLoss(stopLossPercent)
      .buyNow(buySol)
      .sellPercentAt(tpPrice, 100)
      .sellPercentAt(slPrice, 100)
      .build();
  },

  /**
   * TWAP: Time-Weighted Average Price
   */
  twap(mint: string, action: 'buy' | 'sell', totalAmount: number, intervals: number, intervalMs: number): Strategy {
    const builder = new StrategyBuilder(`TWAP ${action.toUpperCase()}`, mint)
      .type('twap')
      .describe(`${action} over ${intervals} intervals`);

    const amountPerInterval = totalAmount / intervals;
    let timestamp = Date.now();

    for (let i = 0; i < intervals; i++) {
      if (i === 0) {
        if (action === 'buy') builder.buyNow(amountPerInterval);
        else builder.sellNow(amountPerInterval);
      } else {
        timestamp += intervalMs;
        if (action === 'buy') builder.buyAtTime(timestamp, amountPerInterval);
        else builder.sellAtTime(timestamp, amountPerInterval);
      }
    }

    return builder.build();
  },

  /**
   * Split: Different wallets do different actions
   */
  split(
    mint: string,
    buyWallets: string[],
    sellWallets: string[],
    buyAmountEach: number,
    sellAmountEach: number
  ): Strategy {
    const builder = new StrategyBuilder('Split Strategy', mint)
      .type('split')
      .describe('Coordinated buy/sell across wallets');

    builder.buyNow(buyAmountEach, { walletIds: buyWallets, executionMode: 'parallel' });
    builder.sellNow(sellAmountEach, { walletIds: sellWallets, executionMode: 'parallel' });

    return builder.build();
  },

  /**
   * Rotation: Exit one token, enter another
   */
  rotation(exitMint: string, enterMint: string, sellPercent: number): Strategy {
    return new StrategyBuilder('Rotation', exitMint)
      .type('rotation')
      .describe(`Rotate from ${exitMint.slice(0, 8)} to ${enterMint.slice(0, 8)}`)
      .sellNow(`${sellPercent}%`, { mint: exitMint })
      .buyNow('all', { mint: enterMint })
      .build();
  },

  /**
   * DCA: Dollar Cost Average
   */
  dca(mint: string, amountPerBuy: number, numBuys: number, intervalMs: number): Strategy {
    return StrategyTemplates.twap(mint, 'buy', amountPerBuy * numBuys, numBuys, intervalMs);
  },

  /**
   * Ladder Buy: Buy at multiple price levels
   */
  ladderBuy(mint: string, totalSol: number, numLevels: number, priceDropPercent: number, currentPrice: number): Strategy {
    const builder = new StrategyBuilder('Ladder Buy', mint)
      .type('scale_in')
      .describe(`Buy at ${numLevels} levels, ${priceDropPercent}% apart`)
      .budget(totalSol);

    const amountPerLevel = totalSol / numLevels;

    for (let i = 0; i < numLevels; i++) {
      const dropPercent = i * priceDropPercent;
      const targetPrice = currentPrice * (1 - dropPercent / 100);

      if (i === 0) {
        builder.buyNow(amountPerLevel);
      } else {
        builder.buyAt(targetPrice, amountPerLevel);
      }
    }

    return builder.build();
  },

  /**
   * Ladder Sell: Sell at multiple price levels
   */
  ladderSell(mint: string, numLevels: number, priceRisePercent: number, currentPrice: number): Strategy {
    const builder = new StrategyBuilder('Ladder Sell', mint)
      .type('scale_out')
      .describe(`Sell at ${numLevels} levels, ${priceRisePercent}% apart`);

    const percentPerLevel = 100 / numLevels;

    for (let i = 0; i < numLevels; i++) {
      const risePercent = (i + 1) * priceRisePercent;
      const targetPrice = currentPrice * (1 + risePercent / 100);
      builder.sellPercentAt(targetPrice, percentPerLevel);
    }

    return builder.build();
  },

  /**
   * Accumulate: Buy dips, hold pumps
   */
  accumulate(mint: string, budgetSol: number, dipPercent: number, numDips: number): Strategy {
    const builder = new StrategyBuilder('Accumulate', mint)
      .type('conditional')
      .describe(`Buy ${numDips} dips of ${dipPercent}%`)
      .budget(budgetSol);

    const amountPerDip = budgetSol / numDips;

    // Each step triggers on price drop from previous
    for (let i = 0; i < numDips; i++) {
      builder.step('buy', 'price_below', dipPercent * (i + 1), { amount: amountPerDip });
    }

    return builder.build();
  },

  /**
   * Pump and Dump Defense: Auto-sell on sudden price spike
   */
  pumpDefense(mint: string, triggerPumpPercent: number, sellPercent: number, currentPrice: number): Strategy {
    const triggerPrice = currentPrice * (1 + triggerPumpPercent / 100);

    return new StrategyBuilder('Pump Defense', mint)
      .type('conditional')
      .describe(`Auto-sell ${sellPercent}% if price pumps ${triggerPumpPercent}%`)
      .sellPercentAt(triggerPrice, sellPercent)
      .build();
  },
};

// ============================================================================
// Strategy Executor
// ============================================================================

export class StrategyExecutor extends EventEmitter {
  private activeStrategies: Map<string, Strategy> = new Map();
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private swarm: SwarmInterface;
  private priceSource?: PriceSource;

  constructor(swarm: SwarmInterface, priceSource?: PriceSource) {
    super();
    this.swarm = swarm;
    this.priceSource = priceSource;
  }

  /**
   * Execute a strategy
   */
  async execute(strategy: Strategy): Promise<StrategyResult> {
    logger.info({ strategyId: strategy.id, type: strategy.type, steps: strategy.steps.length }, 'Starting strategy');

    strategy.status = 'running';
    strategy.startedAt = Date.now();
    this.activeStrategies.set(strategy.id, strategy);

    const result: StrategyResult = {
      strategyId: strategy.id,
      status: 'running',
      stepsCompleted: 0,
      totalSteps: strategy.steps.length,
      totalSolSpent: 0,
      totalSolReceived: 0,
      totalTokensBought: 0,
      totalTokensSold: 0,
      pnl: 0,
      pnlPercent: 0,
      executionTimeMs: 0,
      stepResults: [],
      errors: [],
    };

    try {
      // Apply start delay if configured
      if (strategy.config.startDelay) {
        await this.delay(strategy.config.startDelay);
      }

      // Execute each step
      for (const step of strategy.steps) {
        const currentStatus = strategy.status as StrategyStatus;
        if (currentStatus === 'cancelled' || currentStatus === 'failed') break;
        if (currentStatus === 'paused') {
          await this.waitForResume(strategy.id);
        }

        // Check dependencies
        if (step.dependsOn?.length) {
          const allDepsComplete = step.dependsOn.every((depId) => {
            const dep = strategy.steps.find((s) => s.id === depId);
            return dep?.completed && dep?.result?.success;
          });
          if (!allDepsComplete) {
            result.errors.push(`Step ${step.id}: dependencies not met`);
            continue;
          }
        }

        // Wait for trigger
        const triggered = await this.waitForTrigger(strategy, step);
        if (!triggered) {
          result.errors.push(`Step ${step.id}: trigger timeout`);
          continue;
        }

        // Execute the step
        const stepResult = await this.executeStep(strategy, step);
        step.completed = true;
        step.result = stepResult;
        result.stepResults.push(stepResult);

        if (stepResult.success) {
          result.stepsCompleted++;
          if (step.action === 'buy') {
            result.totalSolSpent += stepResult.solAmount ?? 0;
            result.totalTokensBought += stepResult.tokenAmount ?? 0;
          } else if (step.action === 'sell') {
            result.totalSolReceived += stepResult.solAmount ?? 0;
            result.totalTokensSold += stepResult.tokenAmount ?? 0;
          }
        } else if (stepResult.error) {
          result.errors.push(`Step ${step.id}: ${stepResult.error}`);
        }

        // Check risk limits
        if (this.shouldStop(strategy, result)) {
          logger.info({ strategyId: strategy.id }, 'Strategy stopped by risk limits');
          break;
        }

        // Apply step delay
        if (strategy.config.stepDelay) {
          await this.delay(strategy.config.stepDelay);
        }
      }

      // Final calculations
      result.pnl = result.totalSolReceived - result.totalSolSpent;
      result.pnlPercent = result.totalSolSpent > 0 ? (result.pnl / result.totalSolSpent) * 100 : 0;
      result.executionTimeMs = Date.now() - (strategy.startedAt || Date.now());
      result.status = result.stepsCompleted === result.totalSteps ? 'completed' : 'failed';

      strategy.status = result.status;
      strategy.completedAt = Date.now();
    } catch (error) {
      result.status = 'failed';
      result.errors.push(error instanceof Error ? error.message : String(error));
      strategy.status = 'failed';
      logger.error({ error, strategyId: strategy.id }, 'Strategy execution failed');
    } finally {
      this.activeStrategies.delete(strategy.id);
    }

    this.emit('complete', result);
    return result;
  }

  /**
   * Wait for trigger condition
   */
  private async waitForTrigger(strategy: Strategy, step: StrategyStep): Promise<boolean> {
    const timeout = step.timeout || strategy.config.maxDuration || 86400000; // 24h default
    const startTime = Date.now();

    switch (step.trigger) {
      case 'immediate':
        return true;

      case 'time': {
        const targetTime = step.triggerValue as number;
        const waitMs = Math.max(0, targetTime - Date.now());
        if (waitMs > 0 && waitMs < timeout) {
          await this.delay(waitMs);
        }
        return true;
      }

      case 'price_above':
      case 'price_below': {
        const targetPrice = step.triggerValue as number;
        const checkInterval = strategy.config.priceCheckIntervalMs || 1000;

        while (Date.now() - startTime < timeout) {
          if (strategy.status !== 'running') return false;

          const price = await this.getPrice(strategy.mint);
          if (price !== null) {
            if (step.trigger === 'price_above' && price >= targetPrice) return true;
            if (step.trigger === 'price_below' && price <= targetPrice) return true;
          }
          await this.delay(checkInterval);
        }
        return false;
      }

      case 'manual':
        return new Promise((resolve) => {
          const handler = () => resolve(true);
          this.once(`trigger:${strategy.id}:${step.id}`, handler);
          setTimeout(() => {
            this.off(`trigger:${strategy.id}:${step.id}`, handler);
            resolve(false);
          }, timeout);
        });

      default:
        return true;
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(strategy: Strategy, step: StrategyStep): Promise<StepResult> {
    const result: StepResult = { success: false, executedAt: Date.now() };

    try {
      switch (step.action) {
        case 'wait':
          result.success = true;
          break;

        case 'notify':
          this.emit('notify', { strategy, step });
          result.success = true;
          break;

        case 'buy': {
          const buyResult = await this.swarm.coordinatedBuy({
            mint: step.params.mint || strategy.mint,
            action: 'buy',
            amountPerWallet: step.params.amount ?? 0,
            slippageBps: step.params.slippageBps ?? strategy.config.maxSlippageBps,
            pool: step.params.pool || strategy.config.defaultPool,
            executionMode: step.params.executionMode,
            walletIds: step.params.walletIds || strategy.config.walletIds,
            dex: step.params.dex || strategy.config.dex,
            poolAddress: step.params.poolAddress || strategy.config.poolAddress,
          });
          result.success = buyResult.success;
          result.solAmount = buyResult.totalSolSpent;
          result.tokenAmount = buyResult.totalTokens;
          if (buyResult.errors?.length) result.error = buyResult.errors.join('; ');
          break;
        }

        case 'sell': {
          const sellResult = await this.swarm.coordinatedSell({
            mint: step.params.mint || strategy.mint,
            action: 'sell',
            amountPerWallet: step.params.amount ?? step.params.amountPercent ?? 0,
            slippageBps: step.params.slippageBps ?? strategy.config.maxSlippageBps,
            pool: step.params.pool || strategy.config.defaultPool,
            executionMode: step.params.executionMode,
            walletIds: step.params.walletIds || strategy.config.walletIds,
            dex: step.params.dex || strategy.config.dex,
            poolAddress: step.params.poolAddress || strategy.config.poolAddress,
          });
          result.success = sellResult.success;
          result.solAmount = sellResult.totalSolReceived;
          result.tokenAmount = sellResult.totalTokens;
          if (sellResult.errors?.length) result.error = sellResult.errors.join('; ');
          break;
        }

        case 'cancel':
          result.success = true;
          break;
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
  }

  /**
   * Check if strategy should stop
   */
  private shouldStop(strategy: Strategy, result: StrategyResult): boolean {
    const { stopLossPercent, takeProfitPercent, maxDuration } = strategy.config;

    if (result.totalSolSpent > 0) {
      const pnlPercent = ((result.totalSolReceived - result.totalSolSpent) / result.totalSolSpent) * 100;

      if (stopLossPercent && pnlPercent <= -stopLossPercent) {
        logger.warn({ strategyId: strategy.id, pnlPercent }, 'Stop loss triggered');
        return true;
      }

      if (takeProfitPercent && pnlPercent >= takeProfitPercent) {
        logger.info({ strategyId: strategy.id, pnlPercent }, 'Take profit triggered');
        return true;
      }
    }

    if (maxDuration && strategy.startedAt && Date.now() - strategy.startedAt >= maxDuration) {
      return true;
    }

    return false;
  }

  /**
   * Get current price
   */
  private async getPrice(mint: string): Promise<number | null> {
    // Check cache (5s TTL)
    const cached = this.priceCache.get(mint);
    if (cached && Date.now() - cached.timestamp < 5000) {
      return cached.price;
    }

    // Fetch from price source
    if (this.priceSource) {
      try {
        const price = await this.priceSource.getPrice(mint);
        if (price !== null) {
          this.priceCache.set(mint, { price, timestamp: Date.now() });
        }
        return price;
      } catch {
        return cached?.price || null;
      }
    }

    return null;
  }

  /**
   * Wait for strategy resume
   */
  private async waitForResume(strategyId: string): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const strategy = this.activeStrategies.get(strategyId);
        if (!strategy || strategy.status !== 'paused') {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Control methods
  cancel(strategyId: string): boolean {
    const strategy = this.activeStrategies.get(strategyId);
    if (strategy) {
      strategy.status = 'cancelled';
      this.emit('cancelled', strategyId);
      return true;
    }
    return false;
  }

  pause(strategyId: string): boolean {
    const strategy = this.activeStrategies.get(strategyId);
    if (strategy && strategy.status === 'running') {
      strategy.status = 'paused';
      this.emit('paused', strategyId);
      return true;
    }
    return false;
  }

  resume(strategyId: string): boolean {
    const strategy = this.activeStrategies.get(strategyId);
    if (strategy && strategy.status === 'paused') {
      strategy.status = 'running';
      this.emit('resumed', strategyId);
      return true;
    }
    return false;
  }

  trigger(strategyId: string, stepId: string): void {
    this.emit(`trigger:${strategyId}:${stepId}`);
  }

  getActive(): Strategy[] {
    return Array.from(this.activeStrategies.values());
  }

  getStrategy(id: string): Strategy | undefined {
    return this.activeStrategies.get(id);
  }
}

// ============================================================================
// Interfaces for external dependencies
// ============================================================================

export interface SwarmInterface {
  coordinatedBuy(params: SwarmTradeParams): Promise<SwarmTradeResult>;
  coordinatedSell(params: SwarmTradeParams): Promise<SwarmTradeResult>;
}

export interface SwarmTradeParams {
  mint: string;
  action: 'buy' | 'sell';
  amountPerWallet: number | string;
  slippageBps?: number;
  pool?: string;
  executionMode?: ExecutionMode;
  walletIds?: string[];
  dex?: DexType;
  poolAddress?: string;
}

export interface SwarmTradeResult {
  success: boolean;
  totalSolSpent?: number;
  totalSolReceived?: number;
  totalTokens?: number;
  errors?: string[];
}

export interface PriceSource {
  getPrice(mint: string): Promise<number | null>;
}
