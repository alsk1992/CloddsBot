/**
 * Signal Router — Core Implementation
 *
 * Subscribes to TradingSignals on the signal bus, validates against
 * risk checks, sizes positions, and routes to the execution service.
 *
 * Processes signals serially to prevent concurrent order fan-out.
 * Dry-run by default — opt-in to live execution.
 */

import { EventEmitter } from 'eventemitter3';
import type { SignalBus, TradingSignal } from '../types/signal-bus.js';
import type { ExecutionService, OrderResult } from '../execution/index.js';
import type { SmartRouter } from '../execution/smart-router.js';
import type { MLSignalModel } from '../trading/ml-signals.js';
import type { Platform } from '../types.js';
import { getMarketFeatures } from '../services/feature-engineering/index.js';
import { combinedToMarketFeatures } from '../ml-pipeline/trainer.js';
import { logger } from '../utils/logger.js';
import type { SignalRouterConfig, SignalExecution, SignalRouterStats } from './types.js';

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: Required<SignalRouterConfig> = {
  enabled: false,
  dryRun: true,
  signalTypes: [],          // empty = accept all types
  minStrength: 0.5,
  excludedMarkets: [],
  enabledPlatforms: ['polymarket', 'kalshi'] as Platform[],
  defaultSizeUsd: 10,
  maxSizeUsd: 100,
  strengthScaling: true,
  maxDailyLoss: 200,
  maxConcurrentPositions: 5,
  cooldownMs: 120_000,
  orderMode: 'maker',
  maxSlippage: 0.02,
  useSmartRouter: true,
  useFeatureFilters: true,
};

const MAX_RECENT = 200;
const MAX_QUEUE = 50;

// ── Interface ────────────────────────────────────────────────────────────────

export interface SignalRouter extends EventEmitter {
  start(signalBus: SignalBus): void;
  stop(): void;
  isRunning(): boolean;
  getStats(): SignalRouterStats;
  getRecentExecutions(limit?: number): SignalExecution[];
  resetDailyStats(): void;
  updateConfig(config: Partial<SignalRouterConfig>): void;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createSignalRouter(
  execution: ExecutionService | null,
  config: SignalRouterConfig,
  smartRouter?: SmartRouter | null,
  mlModel?: MLSignalModel | null,
): SignalRouter {
  const emitter = new EventEmitter() as SignalRouter;
  let cfg = { ...DEFAULTS, ...config };

  let running = false;
  let stopped = false;
  let signalHandler: ((signal: TradingSignal) => void) | null = null;

  // Serial queue
  const signalQueue: TradingSignal[] = [];
  let draining = false;

  // State
  const recentExecutions: SignalExecution[] = [];
  const marketCooldowns = new Map<string, number>();
  const openPositions = new Set<string>();
  let dailyResetTimer: ReturnType<typeof setInterval> | null = null;

  const stats: SignalRouterStats = {
    signalsReceived: 0,
    signalsExecuted: 0,
    signalsRejected: 0,
    signalsFailed: 0,
    dryRunCount: 0,
    currentDailyPnL: 0,
    currentOpenPositions: 0,
    skipReasons: {},
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  function marketKey(signal: TradingSignal): string {
    return `${signal.platform}:${signal.marketId}`;
  }

  function recordSkip(reason: string): void {
    stats.signalsRejected++;
    stats.skipReasons[reason] = (stats.skipReasons[reason] ?? 0) + 1;
  }

  function recordExecution(exec: SignalExecution): void {
    recentExecutions.push(exec);
    if (recentExecutions.length > MAX_RECENT) {
      recentExecutions.splice(0, recentExecutions.length - MAX_RECENT);
    }
    emitter.emit(exec.status, exec);
  }

  function isOnCooldown(key: string): boolean {
    const until = marketCooldowns.get(key);
    return until !== undefined && Date.now() < until;
  }

  function setCooldown(key: string): void {
    marketCooldowns.set(key, Date.now() + cfg.cooldownMs);
    if (marketCooldowns.size > 10_000) {
      const now = Date.now();
      for (const [k, until] of marketCooldowns) {
        if (now >= until) marketCooldowns.delete(k);
      }
    }
  }

  // ── Validation ───────────────────────────────────────────────────────────

  function shouldRoute(signal: TradingSignal): { route: boolean; reason?: string } {
    stats.signalsReceived++;

    // Signal type filter
    if (cfg.signalTypes.length > 0 && !cfg.signalTypes.includes(signal.type)) {
      return { route: false, reason: `type_filtered (${signal.type})` };
    }

    // Direction filter — skip neutral
    if (signal.direction === 'neutral') {
      return { route: false, reason: 'neutral_direction' };
    }

    // Strength filter
    if (signal.strength < cfg.minStrength) {
      return { route: false, reason: `low_strength (${signal.strength.toFixed(2)} < ${cfg.minStrength})` };
    }

    // Platform filter
    if (!cfg.enabledPlatforms.includes(signal.platform as Platform)) {
      return { route: false, reason: `platform_disabled (${signal.platform})` };
    }

    // Market exclusion
    if (cfg.excludedMarkets.includes(signal.marketId)) {
      return { route: false, reason: 'market_excluded' };
    }

    // Per-market cooldown
    const key = marketKey(signal);
    if (isOnCooldown(key)) {
      return { route: false, reason: 'cooldown' };
    }

    // Daily loss limit
    if (stats.currentDailyPnL <= -cfg.maxDailyLoss) {
      return { route: false, reason: `daily_loss_limit ($${stats.currentDailyPnL.toFixed(2)})` };
    }

    // Concurrent positions
    if (openPositions.size >= cfg.maxConcurrentPositions) {
      return { route: false, reason: `max_concurrent (${openPositions.size}/${cfg.maxConcurrentPositions})` };
    }

    return { route: true };
  }

  // ── Execution ────────────────────────────────────────────────────────────

  async function processSignal(signal: TradingSignal): Promise<void> {
    if (stopped) return;

    const decision = shouldRoute(signal);
    if (!decision.route) {
      recordSkip(decision.reason!);
      logger.debug({ type: signal.type, market: signal.marketId, reason: decision.reason }, '[signal-router] Rejected');
      recordExecution({
        id: `sr-${Date.now()}-${stats.signalsReceived}`,
        signal,
        status: 'rejected',
        reason: decision.reason,
        timestamp: Date.now(),
      });
      return;
    }

    // Price discovery via feature engine
    const features = getMarketFeatures(signal.platform, signal.marketId, signal.outcomeId);
    let price: number | null = null;

    if (features?.orderbook) {
      // Use best bid for sells, best ask for buys
      price = signal.direction === 'buy'
        ? features.orderbook.bestAsk
        : features.orderbook.bestBid;

      // Feature-based filters
      if (cfg.useFeatureFilters) {
        const { liquidityScore } = features.signals;
        const spreadPct = features.orderbook.spreadPct;

        if (liquidityScore < 0.2) {
          recordSkip('low_liquidity');
          recordExecution({
            id: `sr-${Date.now()}-${stats.signalsReceived}`,
            signal,
            status: 'rejected',
            reason: `low_liquidity (${liquidityScore.toFixed(2)})`,
            timestamp: Date.now(),
          });
          return;
        }

        if (spreadPct > 3.0) {
          recordSkip('wide_spread');
          recordExecution({
            id: `sr-${Date.now()}-${stats.signalsReceived}`,
            signal,
            status: 'rejected',
            reason: `wide_spread (${spreadPct.toFixed(2)}%)`,
            timestamp: Date.now(),
          });
          return;
        }
      }
    } else if (features?.tick) {
      price = features.tick.price;
    }

    // No price data → reject (don't trade blind)
    if (price === null || price <= 0 || price >= 1) {
      recordSkip('no_price_data');
      recordExecution({
        id: `sr-${Date.now()}-${stats.signalsReceived}`,
        signal,
        status: 'rejected',
        reason: 'no_price_data',
        timestamp: Date.now(),
      });
      return;
    }

    // ML confidence modulation (before sizing)
    if (mlModel) {
      try {
        const mlFeatures = combinedToMarketFeatures(features);
        const mlSignal = await mlModel.predict(mlFeatures);

        // ML disagrees strongly → reject
        const mlAgrees =
          (signal.direction === 'buy' && mlSignal.direction === 1) ||
          (signal.direction === 'sell' && mlSignal.direction === -1);
        if (!mlAgrees && mlSignal.confidence > 0.3) {
          recordSkip('ml_disagrees');
          recordExecution({
            id: `sr-${Date.now()}-${stats.signalsReceived}`,
            signal,
            status: 'rejected',
            reason: `ml_disagrees (conf=${mlSignal.confidence.toFixed(2)}, dir=${mlSignal.direction})`,
            timestamp: Date.now(),
          });
          return;
        }

        // Modulate strength: at confidence=0 → 50% size, at confidence=1 → 100% size
        signal.strength *= (0.5 + 0.5 * mlSignal.confidence);

        logger.debug(
          { mlDir: mlSignal.direction, mlConf: mlSignal.confidence, adjStrength: signal.strength.toFixed(3) },
          '[signal-router] ML confidence applied',
        );
      } catch (error) {
        // ML failure is non-fatal — proceed without modulation
        logger.debug({ error }, '[signal-router] ML prediction failed, proceeding without');
      }
    }

    // Position sizing
    let size = cfg.defaultSizeUsd;
    if (cfg.strengthScaling) {
      size = cfg.defaultSizeUsd * signal.strength;
    }
    size = Math.min(size, cfg.maxSizeUsd);
    size = Math.max(1, Math.round(size)); // Min $1, round to whole

    const key = marketKey(signal);

    // Dry run — log but don't execute
    if (cfg.dryRun) {
      stats.dryRunCount++;
      setCooldown(key);
      const exec: SignalExecution = {
        id: `sr-${Date.now()}-${stats.signalsReceived}`,
        signal,
        status: 'dry_run',
        orderSize: size,
        orderPrice: price,
        timestamp: Date.now(),
      };
      recordExecution(exec);
      logger.info(
        { type: signal.type, market: signal.marketId, direction: signal.direction, size, price: price.toFixed(3), strength: signal.strength.toFixed(2) },
        '[signal-router] DRY RUN — would execute',
      );
      return;
    }

    // Live execution
    if (!execution) {
      recordSkip('no_execution_service');
      recordExecution({
        id: `sr-${Date.now()}-${stats.signalsReceived}`,
        signal,
        status: 'rejected',
        reason: 'no_execution_service',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      const orderRequest = {
        platform: signal.platform as 'polymarket' | 'kalshi' | 'opinion' | 'predictfun',
        marketId: signal.marketId,
        tokenId: signal.outcomeId || undefined,
        outcome: signal.outcomeId || undefined,
        price,
        size,
        maxSlippage: cfg.maxSlippage,
      };

      let result: OrderResult;

      if (cfg.orderMode === 'maker') {
        result = signal.direction === 'buy'
          ? await execution.makerBuy(orderRequest)
          : await execution.makerSell(orderRequest);
      } else if (cfg.orderMode === 'market') {
        result = signal.direction === 'buy'
          ? await execution.marketBuy(orderRequest)
          : await execution.marketSell(orderRequest);
      } else {
        result = signal.direction === 'buy'
          ? await execution.buyLimit(orderRequest)
          : await execution.sellLimit(orderRequest);
      }

      if (stopped) return; // Check after async

      stats.signalsExecuted++;
      openPositions.add(key);
      stats.currentOpenPositions = openPositions.size;
      setCooldown(key);

      const exec: SignalExecution = {
        id: `sr-${Date.now()}-${stats.signalsReceived}`,
        signal,
        status: 'executed',
        orderSize: size,
        orderPrice: price,
        orderId: result.orderId,
        timestamp: Date.now(),
      };
      recordExecution(exec);

      logger.info(
        { type: signal.type, market: signal.marketId, direction: signal.direction, size, price: price.toFixed(3), orderId: result.orderId },
        '[signal-router] Order placed',
      );
    } catch (error) {
      stats.signalsFailed++;
      const exec: SignalExecution = {
        id: `sr-${Date.now()}-${stats.signalsReceived}`,
        signal,
        status: 'failed',
        reason: (error as Error).message,
        orderSize: size,
        orderPrice: price,
        timestamp: Date.now(),
      };
      recordExecution(exec);

      logger.warn(
        { error, market: signal.marketId, direction: signal.direction },
        '[signal-router] Execution failed',
      );
    }
  }

  // ── Serial drain queue ───────────────────────────────────────────────────

  async function drainQueue(): Promise<void> {
    if (draining) return;
    draining = true;
    while (signalQueue.length > 0 && !stopped) {
      const signal = signalQueue.shift()!;
      await processSignal(signal);
    }
    draining = false;
  }

  function enqueueSignal(signal: TradingSignal): void {
    if (stopped) return;
    if (signalQueue.length >= MAX_QUEUE) return; // back-pressure
    signalQueue.push(signal);
    drainQueue().catch((error) => {
      logger.warn({ error }, '[signal-router] Queue drain failed');
    });
  }

  // ── Daily reset ──────────────────────────────────────────────────────────

  function checkDailyReset(): void {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      resetDailyStats();
    }
  }

  function resetDailyStats(): void {
    stats.currentDailyPnL = 0;
    openPositions.clear();
    stats.currentOpenPositions = 0;
    marketCooldowns.clear();
    logger.info('[signal-router] Daily stats reset');
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  function start(signalBus: SignalBus): void {
    if (running) return;
    stopped = false;
    running = true;

    // Subscribe to signal bus
    signalHandler = (signal: TradingSignal) => enqueueSignal(signal);
    signalBus.onSignal(signalHandler);

    // Daily reset check every minute
    dailyResetTimer = setInterval(checkDailyReset, 60_000);

    logger.info(
      { dryRun: cfg.dryRun, minStrength: cfg.minStrength, orderMode: cfg.orderMode, maxSize: cfg.maxSizeUsd },
      '[signal-router] Started',
    );
  }

  function stop(): void {
    stopped = true;
    running = false;
    signalHandler = null;
    signalQueue.length = 0;

    if (dailyResetTimer) {
      clearInterval(dailyResetTimer);
      dailyResetTimer = null;
    }

    logger.info(
      { executed: stats.signalsExecuted, rejected: stats.signalsRejected, dryRuns: stats.dryRunCount },
      '[signal-router] Stopped',
    );
  }

  // ── Public API ───────────────────────────────────────────────────────────

  Object.assign(emitter, {
    start,
    stop,
    isRunning: () => running,
    getStats: () => ({ ...stats }),
    getRecentExecutions: (limit = 20): SignalExecution[] => {
      const start = Math.max(0, recentExecutions.length - limit);
      return recentExecutions.slice(start).reverse();
    },
    resetDailyStats,
    updateConfig: (newConfig: Partial<SignalRouterConfig>) => {
      cfg = { ...cfg, ...newConfig };
      logger.info({ config: { dryRun: cfg.dryRun, minStrength: cfg.minStrength, maxSize: cfg.maxSizeUsd } }, '[signal-router] Config updated');
    },
  });

  return emitter;
}
