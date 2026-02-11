/**
 * Trading API Routes — REST endpoints for positions, portfolio, orders,
 * signals, strategies, and orchestrator status.
 *
 * Mounted as a single Express Router via httpGateway.setTradingApiRouter().
 * All endpoints are prefixed with /api by the caller.
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type { ExecutionService } from '../execution/index.js';
import type { TradingOrchestrator, OrchestratorStats } from '../trading/orchestrator.js';
import type { SafetyManager, SafetyState } from '../trading/safety.js';
import type { SignalRouter } from '../signal-router/index.js';
import type { SignalRouterConfig } from '../signal-router/types.js';
import {
  createMeanReversionStrategy,
  createMomentumStrategy,
  type BotManager, type BotStatus, type Strategy, type StrategyConfig, type StrategyContext, type Signal,
} from '../trading/bots/index.js';
import type { TradeLogger } from '../trading/logger.js';
import type { StrategyBuilder, StrategyDefinition } from '../trading/builder.js';
import type { Platform } from '../types.js';
import type { TickRecorder } from '../services/tick-recorder/types.js';
import type { BacktestEngine, BacktestResult } from '../trading/backtest.js';
import type { SignalBus, TradingSignal } from './signal-bus.js';
import type { FeatureEngineering } from '../services/feature-engineering/types.js';
import type { PositionManager } from '../execution/position-manager.js';
import type { MLPipeline } from '../ml-pipeline/index.js';
import { getMMState } from '../trading/market-making/strategy.js';

// ── Dependencies ────────────────────────────────────────────────────────────

export interface TradingApiDeps {
  db: Database;
  execution: ExecutionService | null;
  orchestrator: TradingOrchestrator | null;
  safety: SafetyManager | null;
  signalRouter: SignalRouter | null;
  botManager: BotManager | null;
  tradeLogger: TradeLogger | null;
  tickRecorder: TickRecorder | null;
  backtestEngine: BacktestEngine | null;
  strategyBuilder: StrategyBuilder | null;
  signalBus: SignalBus | null;
  featureEngine: FeatureEngineering | null;
  positionManager: PositionManager | null;
  mlPipeline: MLPipeline | null;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createTradingApiRouter(deps: TradingApiDeps): Router {
  const router = Router();
  const {
    db, execution, orchestrator, safety, signalRouter,
    botManager, tradeLogger, tickRecorder, backtestEngine,
    strategyBuilder, signalBus, featureEngine, positionManager,
    mlPipeline,
  } = deps;

  // ── GET /api/positions ──────────────────────────────────────────────────
  router.get('/positions', (_req: Request, res: Response) => {
    try {
      const userId = 'default';
      const positions = db.getPositions(userId);
      res.json({ positions, count: positions.length });
    } catch (err) {
      logger.warn({ err }, 'API: Failed to get positions');
      res.status(500).json({ error: 'Failed to fetch positions' });
    }
  });

  // ── GET /api/portfolio ──────────────────────────────────────────────────
  router.get('/portfolio', (_req: Request, res: Response) => {
    try {
      const userId = 'default';
      const positions = db.getPositions(userId);

      let totalValue = 0;
      let totalCost = 0;
      let unrealizedPnL = 0;

      const positionSummaries = positions.map((p: any) => {
        const shares = Number(p.shares) || 0;
        const avgPrice = Number(p.avgPrice) || 0;
        const currentPrice = Number(p.currentPrice) || avgPrice;
        const value = shares * currentPrice;
        const cost = shares * avgPrice;
        const pnl = value - cost;
        const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;

        totalValue += value;
        totalCost += cost;
        unrealizedPnL += pnl;

        return {
          id: p.id, platform: p.platform, marketId: p.marketId,
          marketQuestion: p.marketQuestion, outcome: p.outcome,
          shares, avgPrice,
          currentPrice,
          value: Math.round(value * 100) / 100,
          pnl: Math.round(pnl * 100) / 100,
          pnlPct: Math.round(pnlPct * 10) / 10,
        };
      });

      res.json({
        totalValue: Math.round(totalValue * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        unrealizedPnL: Math.round(unrealizedPnL * 100) / 100,
        positionCount: positions.length,
        positions: positionSummaries,
      });
    } catch (err) {
      logger.warn({ err }, 'API: Failed to get portfolio');
      res.status(500).json({ error: 'Failed to fetch portfolio' });
    }
  });

  // ── GET /api/orders ─────────────────────────────────────────────────────
  router.get('/orders', async (req: Request, res: Response) => {
    if (!execution) { res.status(404).json({ error: 'Execution service not available' }); return; }
    try {
      const platform = (req.query.platform as string) || 'polymarket';
      const openOrders = await execution.getOpenOrders(platform as any);
      const recentFills = execution.getTrackedFills ? execution.getTrackedFills() : [];
      res.json({ openOrders: openOrders || [], recentFills: recentFills || [], openCount: openOrders?.length || 0, fillCount: recentFills?.length || 0 });
    } catch (err) {
      logger.warn({ err }, 'API: Failed to get orders');
      res.status(500).json({ error: 'Failed to fetch orders' });
    }
  });

  // ── GET /api/signals/recent ─────────────────────────────────────────────
  router.get('/signals/recent', (req: Request, res: Response) => {
    if (!signalRouter) { res.status(404).json({ error: 'Signal router not enabled' }); return; }
    try {
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const executions = signalRouter.getRecentExecutions(limit);
      const stats = signalRouter.getStats();
      res.json({ executions, stats, count: executions.length });
    } catch (err) {
      logger.warn({ err }, 'API: Failed to get signals');
      res.status(500).json({ error: 'Failed to fetch signals' });
    }
  });

  // ── GET /api/orchestrator ───────────────────────────────────────────────
  router.get('/orchestrator', (_req: Request, res: Response) => {
    try {
      const orchestratorStats: OrchestratorStats | null = orchestrator?.getStats() ?? null;
      const safetyState: SafetyState | null = safety?.getState() ?? null;
      const circuitBreakerState = execution?.getCircuitBreakerState?.() ?? null;
      res.json({
        orchestrator: orchestratorStats ? { paused: orchestrator?.paused ?? false, ...orchestratorStats } : null,
        safety: safetyState,
        circuitBreaker: circuitBreakerState,
      });
    } catch (err) {
      logger.warn({ err }, 'API: Failed to get orchestrator status');
      res.status(500).json({ error: 'Failed to fetch orchestrator status' });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // BOT MANAGER — Strategy lifecycle (start/stop/pause/resume/evaluate)
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/strategies', (_req: Request, res: Response) => {
    if (!botManager) { res.status(404).json({ error: 'Bot manager not available' }); return; }
    try {
      const strategies = botManager.getStrategies();
      const statuses: BotStatus[] = botManager.getAllBotStatuses();
      const combined = strategies.map((cfg) => {
        const status = statuses.find((s) => s.id === cfg.id);
        return {
          id: cfg.id, name: cfg.name, description: cfg.description,
          platforms: cfg.platforms, intervalMs: cfg.intervalMs, dryRun: cfg.dryRun,
          status: status?.status || 'stopped', tradesCount: status?.tradesCount || 0,
          totalPnL: status?.totalPnL || 0, winRate: status?.winRate || 0,
          lastCheck: status?.lastCheck || null, lastError: status?.lastError || null,
        };
      });
      res.json({ strategies: combined, count: combined.length, running: combined.filter((s) => s.status === 'running').length });
    } catch (err) {
      logger.warn({ err }, 'API: Failed to get strategies');
      res.status(500).json({ error: 'Failed to fetch strategies' });
    }
  });

  router.post('/strategies/:id/start', async (req: Request, res: Response) => {
    if (!botManager) { res.status(404).json({ error: 'Bot manager not available' }); return; }
    try {
      const ok = await botManager.startBot(req.params.id);
      if (!ok) { res.status(400).json({ error: 'Strategy not found or already running' }); return; }
      res.json({ success: true, status: botManager.getBotStatus(req.params.id) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to start bot' }); }
  });

  router.post('/strategies/:id/stop', async (req: Request, res: Response) => {
    if (!botManager) { res.status(404).json({ error: 'Bot manager not available' }); return; }
    try {
      await botManager.stopBot(req.params.id);
      res.json({ success: true, status: botManager.getBotStatus(req.params.id) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to stop bot' }); }
  });

  router.post('/strategies/:id/pause', (req: Request, res: Response) => {
    if (!botManager) { res.status(404).json({ error: 'Bot manager not available' }); return; }
    botManager.pauseBot(req.params.id);
    res.json({ success: true, status: botManager.getBotStatus(req.params.id) });
  });

  router.post('/strategies/:id/resume', (req: Request, res: Response) => {
    if (!botManager) { res.status(404).json({ error: 'Bot manager not available' }); return; }
    botManager.resumeBot(req.params.id);
    res.json({ success: true, status: botManager.getBotStatus(req.params.id) });
  });

  router.post('/strategies/:id/evaluate', async (req: Request, res: Response) => {
    if (!botManager) { res.status(404).json({ error: 'Bot manager not available' }); return; }
    try {
      const signals = await botManager.evaluateNow(req.params.id);
      res.json({ signals, count: signals.length });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Evaluation failed' }); }
  });

  // ── GET /api/strategies/:id/mm-state ──────────────────────────────────
  // Market making specific state (inventory, P&L, quotes)
  router.get('/strategies/:id/mm-state', (req: Request, res: Response) => {
    if (!botManager) { res.status(404).json({ error: 'Bot manager not available' }); return; }
    const strategy = botManager.getStrategy(req.params.id);
    if (!strategy) { res.status(404).json({ error: 'Strategy not found' }); return; }
    const mmState = getMMState(strategy);
    if (!mmState) { res.status(404).json({ error: 'Not a market making strategy' }); return; }
    res.json({
      fairValue: mmState.fairValue,
      emaFairValue: mmState.emaFairValue,
      inventory: mmState.inventory,
      realizedPnL: mmState.realizedPnL,
      fillCount: mmState.fillCount,
      activeBids: mmState.activeBids.length,
      activeAsks: mmState.activeAsks.length,
      isQuoting: mmState.isQuoting,
      haltReason: mmState.haltReason ?? null,
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // STRATEGY BUILDER — Create strategies from templates or NL
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/strategy-builder/templates', (_req: Request, res: Response) => {
    if (!strategyBuilder) { res.status(404).json({ error: 'Strategy builder not available' }); return; }
    res.json({ templates: strategyBuilder.listTemplates() });
  });

  router.get('/strategy-builder/templates/:name', (req: Request, res: Response) => {
    if (!strategyBuilder) { res.status(404).json({ error: 'Strategy builder not available' }); return; }
    const params = strategyBuilder.getTemplateParams(req.params.name as any);
    res.json({ template: req.params.name, params });
  });

  router.post('/strategy-builder/create', (req: Request, res: Response) => {
    if (!strategyBuilder) { res.status(404).json({ error: 'Strategy builder not available' }); return; }
    if (!botManager) { res.status(404).json({ error: 'Bot manager not available' }); return; }
    try {
      const definition = req.body as StrategyDefinition;
      const validation = strategyBuilder.validate(definition);
      if (!validation.valid) { res.status(400).json({ error: 'Invalid strategy', errors: validation.errors }); return; }
      const strategy = strategyBuilder.createStrategy(definition);
      botManager.registerStrategy(strategy);
      const userId = (req as any).userId || 'default';
      const id = strategyBuilder.saveDefinition(userId, definition);
      res.json({ success: true, strategyId: strategy.config.id, definitionId: id, config: strategy.config });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to create strategy' }); }
  });

  router.post('/strategy-builder/parse', (req: Request, res: Response) => {
    if (!strategyBuilder) { res.status(404).json({ error: 'Strategy builder not available' }); return; }
    const { text } = req.body as { text?: string };
    if (!text) { res.status(400).json({ error: 'Missing text field' }); return; }
    const result = strategyBuilder.parseNaturalLanguage(text);
    if ('error' in result) { res.status(400).json(result); }
    else { res.json({ definition: result, validation: strategyBuilder.validate(result) }); }
  });

  router.get('/strategy-builder/saved', (req: Request, res: Response) => {
    if (!strategyBuilder) { res.status(404).json({ error: 'Strategy builder not available' }); return; }
    const userId = (req.query.userId as string) || 'default';
    const definitions = strategyBuilder.loadDefinitions(userId);
    res.json({ definitions, count: definitions.length });
  });

  router.delete('/strategy-builder/saved/:id', (req: Request, res: Response) => {
    if (!strategyBuilder) { res.status(404).json({ error: 'Strategy builder not available' }); return; }
    const userId = (req.query.userId as string) || 'default';
    const deleted = strategyBuilder.deleteDefinition(userId, req.params.id);
    res.json({ success: deleted });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TRADES & PNL
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/trades', (req: Request, res: Response) => {
    if (!tradeLogger) { res.status(404).json({ error: 'Trade logger not available' }); return; }
    try {
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const platform = req.query.platform as string | undefined;
      const strategyId = req.query.strategyId as string | undefined;
      const status = req.query.status as string | undefined;
      const trades = tradeLogger.getTrades({ limit, platform: platform as Platform | undefined, strategyId, status: status as any });
      const stats = tradeLogger.getStats({ platform: platform as Platform | undefined, strategyId });
      res.json({ trades, stats, count: trades.length });
    } catch (err) {
      logger.warn({ err }, 'API: Failed to get trades');
      res.status(500).json({ error: 'Failed to fetch trades' });
    }
  });

  router.get('/pnl', (req: Request, res: Response) => {
    if (!tradeLogger) { res.status(404).json({ error: 'Trade logger not available' }); return; }
    try {
      const days = parseInt(req.query.days as string, 10) || 30;
      const dailyPnl = tradeLogger.getDailyPnL(days);
      const totalPnl = dailyPnl.reduce((sum, d) => sum + d.pnl, 0);
      const totalTrades = dailyPnl.reduce((sum, d) => sum + d.trades, 0);
      const profitDays = dailyPnl.filter((d) => d.pnl > 0).length;
      res.json({ dailyPnl, totalPnl: Math.round(totalPnl * 100) / 100, totalTrades, profitDays, totalDays: dailyPnl.length, days });
    } catch (err) {
      logger.warn({ err }, 'API: Failed to get PnL');
      res.status(500).json({ error: 'Failed to fetch PnL data' });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ORDERS
  // ══════════════════════════════════════════════════════════════════════════

  router.post('/orders', async (req: Request, res: Response) => {
    if (!execution) { res.status(404).json({ error: 'Execution service not available' }); return; }
    try {
      const { platform, marketId, tokenId, outcome, side, price, size, orderType, negRisk } = req.body;
      if (!platform || !marketId || !side || !price || !size) {
        res.status(400).json({ error: 'Missing required fields: platform, marketId, side, price, size' }); return;
      }
      const orderRequest = {
        platform: platform as 'polymarket' | 'kalshi' | 'opinion' | 'predictfun',
        marketId, tokenId, outcome, price: Number(price), size: Number(size),
        orderType: orderType || 'GTC', negRisk: negRisk ?? undefined,
      };
      const result = side === 'buy' ? await execution.buyLimit(orderRequest) : await execution.sellLimit(orderRequest);
      res.json({ success: result.success, orderId: result.orderId, status: result.status, filledSize: result.filledSize, avgFillPrice: result.avgFillPrice, error: result.error });
    } catch (err: any) {
      logger.warn({ err }, 'API: Failed to submit order');
      res.status(500).json({ error: err?.message || 'Failed to submit order' });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ORCHESTRATOR & SAFETY
  // ══════════════════════════════════════════════════════════════════════════

  router.post('/orchestrator/pause', (req: Request, res: Response) => {
    if (!orchestrator) { res.status(404).json({ error: 'Orchestrator not available' }); return; }
    const reason = req.body?.reason || 'Paused via API';
    orchestrator.pause(reason);
    res.json({ success: true, paused: true, reason });
  });

  router.post('/orchestrator/resume', (_req: Request, res: Response) => {
    if (!orchestrator) { res.status(404).json({ error: 'Orchestrator not available' }); return; }
    orchestrator.resume();
    res.json({ success: true, paused: false });
  });

  router.post('/safety/kill', (req: Request, res: Response) => {
    if (!safety) { res.status(404).json({ error: 'Safety manager not available' }); return; }
    const reason = req.body?.reason || 'Kill switch via API';
    safety.killSwitch(reason);
    res.json({ success: true, tradingEnabled: false, reason });
  });

  router.post('/safety/resume', (_req: Request, res: Response) => {
    if (!safety) { res.status(404).json({ error: 'Safety manager not available' }); return; }
    const resumed = safety.resumeTrading();
    res.json({ success: resumed, tradingEnabled: resumed });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // BACKTEST — Tick-replay, compare, Monte Carlo
  // ══════════════════════════════════════════════════════════════════════════

  function resolveStrategy(
    strategyType: string | undefined, platform: string,
    marketId: string, outcomeId: string, params?: Record<string, unknown>,
  ): Strategy {
    const plat = platform as Platform;
    const baseConfig: Partial<StrategyConfig> = { platforms: [plat], dryRun: true, params };
    switch (strategyType) {
      case 'mean-reversion': return createMeanReversionStrategy(baseConfig);
      case 'momentum': return createMomentumStrategy(baseConfig);
      case 'buy-and-hold':
      default:
        return {
          config: { id: 'buy-and-hold', name: 'Buy and Hold', platforms: [plat], intervalMs: 60_000 },
          async evaluate(ctx: StrategyContext): Promise<Signal[]> {
            if (ctx.positions.size === 0 && ctx.availableBalance > 10) {
              const ph = ctx.priceHistory.values().next().value as number[] | undefined;
              const price = ph?.[ph.length - 1] ?? 0.5;
              return [{ type: 'buy' as const, platform: plat, marketId, outcome: outcomeId, price, size: Math.floor(ctx.availableBalance * 0.9 / price), confidence: 1, reason: 'Buy and hold entry' }];
            }
            return [];
          },
        };
    }
  }

  function formatBacktestResult(result: BacktestResult) {
    return {
      strategyId: result.strategyId,
      metrics: result.metrics,
      tradeCount: result.trades.length,
      trades: result.trades.slice(0, 100).map((t) => ({
        timestamp: t.timestamp.toISOString(), side: t.side, price: t.price,
        size: t.size, pnl: t.pnl, commission: t.commission, slippage: t.slippage,
      })),
      equityCurve: result.equityCurve.slice(0, 500).map((p) => ({
        timestamp: p.timestamp.toISOString(), equity: Math.round(p.equity * 100) / 100,
      })),
      dailyReturns: result.dailyReturns,
    };
  }

  router.post('/backtest/tick-replay', async (req: Request, res: Response) => {
    if (!backtestEngine) { res.status(404).json({ error: 'Backtest engine not available' }); return; }
    if (!tickRecorder) { res.status(404).json({ error: 'Tick recorder not available' }); return; }
    try {
      const { platform, marketId, outcomeId, startDate, endDate, initialCapital, commissionPct, slippagePct, evalIntervalMs, priceHistorySize, strategyId, strategyParams } = req.body;
      if (!platform || !marketId || !outcomeId) { res.status(400).json({ error: 'Missing required fields: platform, marketId, outcomeId' }); return; }
      const strategy = resolveStrategy(strategyId, platform, marketId, outcomeId, strategyParams);
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 86400000);
      const end = endDate ? new Date(endDate) : new Date();
      const result = await backtestEngine.runFromTickRecorder(strategy, {
        platform: platform as Platform, marketId, outcomeId, startDate: start, endDate: end,
        initialCapital: initialCapital ?? 10_000, commissionPct: commissionPct ?? 0.1, slippagePct: slippagePct ?? 0.05,
        resolutionMs: 0, riskFreeRate: 5, evalIntervalMs: evalIntervalMs ?? 5_000, priceHistorySize: priceHistorySize ?? 200, includeOrderbook: true,
      }, tickRecorder);
      res.json(formatBacktestResult(result));
    } catch (err: any) {
      logger.warn({ err }, 'API: Tick-replay backtest failed');
      res.status(500).json({ error: err?.message || 'Backtest failed' });
    }
  });

  router.post('/backtest/compare', async (req: Request, res: Response) => {
    if (!backtestEngine) { res.status(404).json({ error: 'Backtest engine not available' }); return; }
    if (!tickRecorder) { res.status(404).json({ error: 'Tick recorder not available' }); return; }
    try {
      const { platform, marketId, outcomeId, startDate, endDate, initialCapital, commissionPct, slippagePct, evalIntervalMs, priceHistorySize, strategies: strategyList } = req.body;
      if (!platform || !marketId || !outcomeId) { res.status(400).json({ error: 'Missing required fields: platform, marketId, outcomeId' }); return; }
      const ids = strategyList?.map((s: any) => s.id) ?? ['buy-and-hold', 'mean-reversion', 'momentum'];
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 86400000);
      const end = endDate ? new Date(endDate) : new Date();
      const tickConfig = {
        platform: platform as Platform, marketId, outcomeId, startDate: start, endDate: end,
        initialCapital: initialCapital ?? 10_000, commissionPct: commissionPct ?? 0.1, slippagePct: slippagePct ?? 0.05,
        resolutionMs: 0, riskFreeRate: 5, evalIntervalMs: evalIntervalMs ?? 5_000, priceHistorySize: priceHistorySize ?? 200, includeOrderbook: true,
      };
      const ticks = await tickRecorder.getTicks({ platform: platform as Platform, marketId, outcomeId, startTime: start.getTime(), endTime: end.getTime() });
      const orderbooks = await tickRecorder.getOrderbookSnapshots({ platform: platform as Platform, marketId, outcomeId, startTime: start.getTime(), endTime: end.getTime() });
      const results: ReturnType<typeof formatBacktestResult>[] = [];
      for (const entry of ids) {
        const params = strategyList?.find((s: any) => s.id === entry)?.params;
        const strategy = resolveStrategy(entry, platform, marketId, outcomeId, params);
        const result = await backtestEngine.runWithTicks(strategy, tickConfig, ticks, orderbooks);
        results.push(formatBacktestResult(result));
      }
      const ranking = results.slice().sort((a, b) => b.metrics.sharpeRatio - a.metrics.sharpeRatio).map((r) => r.strategyId);
      res.json({ results, ranking });
    } catch (err: any) {
      logger.warn({ err }, 'API: Backtest compare failed');
      res.status(500).json({ error: err?.message || 'Backtest compare failed' });
    }
  });

  router.post('/backtest/monte-carlo', async (req: Request, res: Response) => {
    if (!backtestEngine) { res.status(404).json({ error: 'Backtest engine not available' }); return; }
    if (!tickRecorder) { res.status(404).json({ error: 'Tick recorder not available' }); return; }
    try {
      const { platform, marketId, outcomeId, startDate, endDate, initialCapital, commissionPct, slippagePct, evalIntervalMs, priceHistorySize, strategyId, strategyParams, simulations } = req.body;
      if (!platform || !marketId || !outcomeId) { res.status(400).json({ error: 'Missing required fields: platform, marketId, outcomeId' }); return; }
      const strategy = resolveStrategy(strategyId, platform, marketId, outcomeId, strategyParams);
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 86400000);
      const end = endDate ? new Date(endDate) : new Date();
      const result = await backtestEngine.runFromTickRecorder(strategy, {
        platform: platform as Platform, marketId, outcomeId, startDate: start, endDate: end,
        initialCapital: initialCapital ?? 10_000, commissionPct: commissionPct ?? 0.1, slippagePct: slippagePct ?? 0.05,
        resolutionMs: 0, riskFreeRate: 5, evalIntervalMs: evalIntervalMs ?? 5_000, priceHistorySize: priceHistorySize ?? 200, includeOrderbook: true,
      }, tickRecorder);
      const numSims = Math.min(simulations ?? 1000, 10_000);
      const mc = backtestEngine.monteCarlo(result, numSims);
      res.json({ backtest: formatBacktestResult(result), monteCarlo: mc });
    } catch (err: any) {
      logger.warn({ err }, 'API: Backtest Monte Carlo failed');
      res.status(500).json({ error: err?.message || 'Backtest Monte Carlo failed' });
    }
  });

  router.get('/backtest/strategies', (_req: Request, res: Response) => {
    res.json({
      strategies: [
        { id: 'buy-and-hold', name: 'Buy and Hold', description: 'Buy once and hold — baseline benchmark', params: [] },
        { id: 'mean-reversion', name: 'Mean Reversion', description: 'Buy below moving average, sell above', params: [
          { name: 'lookbackPeriod', type: 'number', default: 20 },
          { name: 'entryThreshold', type: 'number', default: 2 },
          { name: 'exitThreshold', type: 'number', default: 0.5 },
        ] },
        { id: 'momentum', name: 'Momentum', description: 'Follow price trends using MA crossover', params: [
          { name: 'shortPeriod', type: 'number', default: 5 },
          { name: 'longPeriod', type: 'number', default: 20 },
          { name: 'minMomentum', type: 'number', default: 0.05 },
        ] },
      ],
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ML PIPELINE — Stats, trigger training, backtest ML predictions
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/ml/stats', (_req: Request, res: Response) => {
    if (!mlPipeline) { res.status(404).json({ error: 'ML pipeline not enabled' }); return; }
    res.json({ stats: mlPipeline.getStats(), modelMetrics: mlPipeline.getModel().getMetrics() });
  });

  router.post('/ml/train', async (_req: Request, res: Response) => {
    if (!mlPipeline) { res.status(404).json({ error: 'ML pipeline not enabled' }); return; }
    try {
      await mlPipeline.trainNow();
      res.json({ success: true, stats: mlPipeline.getStats() });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Training failed' }); }
  });

  // POST /api/ml/backtest — Backtest ML model predictions on historical tick data.
  // Uses the trained ML model to generate signals, then backtests them.
  router.post('/ml/backtest', async (req: Request, res: Response) => {
    if (!mlPipeline) { res.status(404).json({ error: 'ML pipeline not enabled' }); return; }
    if (!backtestEngine) { res.status(404).json({ error: 'Backtest engine not available' }); return; }
    if (!tickRecorder) { res.status(404).json({ error: 'Tick recorder not available' }); return; }

    try {
      const { platform, marketId, outcomeId, startDate, endDate, initialCapital, minConfidence } = req.body;
      if (!platform || !marketId || !outcomeId) {
        res.status(400).json({ error: 'Missing required fields: platform, marketId, outcomeId' }); return;
      }

      const model = mlPipeline.getModel();
      const confidenceThreshold = minConfidence ?? 0.3;

      // Create an ML-driven strategy
      const mlStrategy: Strategy = {
        config: { id: 'ml-signal', name: 'ML Signal Model', platforms: [platform as Platform], intervalMs: 30_000 },
        async evaluate(ctx: StrategyContext): Promise<Signal[]> {
          const ph = ctx.priceHistory.values().next().value as number[] | undefined;
          if (!ph || ph.length < 20) return [];
          const price = ph[ph.length - 1];

          // Build features from available context
          const prices = ph.slice(-24);
          const change1h = prices.length > 1 ? (price - prices[0]) / prices[0] * 100 : 0;
          const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
          const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length;
          const volatility = Math.sqrt(variance);
          const gains = prices.slice(1).map((p, i) => Math.max(0, p - prices[i]));
          const losses = prices.slice(1).map((p, i) => Math.max(0, prices[i] - p));
          const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length || 0.001;
          const avgLoss = losses.reduce((a, b) => a + b, 0) / losses.length || 0.001;
          const rs = avgGain / avgLoss;
          const rsi = 100 - 100 / (1 + rs);

          const features = {
            price: { current: price, change1h, change24h: change1h * 2, volatility24h: volatility, rsi14: rsi, momentum: change1h / 100 },
            volume: { current24h: 0, changeVsAvg: 0, buyRatio: 0.5 },
            orderbook: { bidAskRatio: 1, imbalanceScore: 0, spreadPct: 1, depth10Pct: 0 },
            market: { daysToExpiry: 30, totalVolume: 0, marketCap: 0, category: 'crypto' },
          };

          const signal = await model.predict(features);
          if (signal.confidence < confidenceThreshold) return [];

          const hasPosition = ctx.positions.size > 0;
          if (signal.direction === 1 && !hasPosition && ctx.availableBalance > 10) {
            return [{ type: 'buy', platform: platform as Platform, marketId, outcome: outcomeId, price, size: Math.floor(ctx.availableBalance * 0.5 / price), confidence: signal.confidence, reason: `ML buy (conf=${signal.confidence.toFixed(2)}, probUp=${signal.probUp.toFixed(2)})` }];
          } else if (signal.direction === -1 && hasPosition) {
            const pos = ctx.positions.values().next().value as any;
            return [{ type: 'sell', platform: platform as Platform, marketId, outcome: outcomeId, price, size: pos?.size || 0, confidence: signal.confidence, reason: `ML sell (conf=${signal.confidence.toFixed(2)}, probUp=${signal.probUp.toFixed(2)})` }];
          }
          return [];
        },
      };

      const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 86400000);
      const end = endDate ? new Date(endDate) : new Date();

      const result = await backtestEngine.runFromTickRecorder(mlStrategy, {
        platform: platform as Platform, marketId, outcomeId, startDate: start, endDate: end,
        initialCapital: initialCapital ?? 10_000, commissionPct: 0.1, slippagePct: 0.05,
        resolutionMs: 0, riskFreeRate: 5, evalIntervalMs: 30_000, priceHistorySize: 200, includeOrderbook: true,
      }, tickRecorder);

      res.json({
        ...formatBacktestResult(result),
        mlStats: mlPipeline.getStats(),
        modelMetrics: model.getMetrics(),
      });
    } catch (err: any) {
      logger.warn({ err }, 'API: ML backtest failed');
      res.status(500).json({ error: err?.message || 'ML backtest failed' });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SIGNAL ROUTER — Control and configuration
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/signal-router/config', (_req: Request, res: Response) => {
    if (!signalRouter) { res.status(404).json({ error: 'Signal router not enabled' }); return; }
    res.json({ running: signalRouter.isRunning(), stats: signalRouter.getStats() });
  });

  router.post('/signal-router/config', (req: Request, res: Response) => {
    if (!signalRouter) { res.status(404).json({ error: 'Signal router not enabled' }); return; }
    try {
      const updates = req.body as Partial<SignalRouterConfig>;
      const allowed: Partial<SignalRouterConfig> = {};
      if (updates.dryRun !== undefined) allowed.dryRun = updates.dryRun;
      if (updates.minStrength !== undefined) allowed.minStrength = updates.minStrength;
      if (updates.defaultSizeUsd !== undefined) allowed.defaultSizeUsd = updates.defaultSizeUsd;
      if (updates.maxSizeUsd !== undefined) allowed.maxSizeUsd = updates.maxSizeUsd;
      if (updates.maxDailyLoss !== undefined) allowed.maxDailyLoss = updates.maxDailyLoss;
      if (updates.maxConcurrentPositions !== undefined) allowed.maxConcurrentPositions = updates.maxConcurrentPositions;
      if (updates.cooldownMs !== undefined) allowed.cooldownMs = updates.cooldownMs;
      if (updates.orderMode !== undefined) allowed.orderMode = updates.orderMode;
      if (updates.strengthScaling !== undefined) allowed.strengthScaling = updates.strengthScaling;
      if (updates.signalTypes !== undefined) allowed.signalTypes = updates.signalTypes;
      signalRouter.updateConfig(allowed);
      res.json({ updated: allowed, stats: signalRouter.getStats() });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Config update failed' }); }
  });

  router.post('/signal-router/reset', (_req: Request, res: Response) => {
    if (!signalRouter) { res.status(404).json({ error: 'Signal router not enabled' }); return; }
    signalRouter.resetDailyStats();
    res.json({ success: true, stats: signalRouter.getStats() });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // POSITION MANAGER — Live managed positions with TP/SL
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/positions/managed', (_req: Request, res: Response) => {
    if (!positionManager) { res.status(404).json({ error: 'Position manager not available' }); return; }
    try {
      const positions = positionManager.getPositions();
      const stats = positionManager.getStats();
      res.json({ positions, stats });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to fetch managed positions' }); }
  });

  router.post('/positions/managed/:id/close', (req: Request, res: Response) => {
    if (!positionManager) { res.status(404).json({ error: 'Position manager not available' }); return; }
    try {
      const position = positionManager.getPosition(req.params.id);
      if (!position) { res.status(404).json({ error: `Position ${req.params.id} not found` }); return; }
      const closePrice = req.body?.price ?? position.currentPrice;
      positionManager.closePosition(req.params.id, closePrice, 'manual_api_close');
      res.json({ success: true, positionId: req.params.id, closePrice });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to close position' }); }
  });

  router.get('/positions/managed/:id', (req: Request, res: Response) => {
    if (!positionManager) { res.status(404).json({ error: 'Position manager not available' }); return; }
    try {
      const position = positionManager.getPosition(req.params.id);
      if (!position) { res.status(404).json({ error: `Position ${req.params.id} not found` }); return; }
      res.json({ position });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to get position' }); }
  });

  router.get('/positions/managed/by-platform/:platform', (req: Request, res: Response) => {
    if (!positionManager) { res.status(404).json({ error: 'Position manager not available' }); return; }
    try {
      const positions = positionManager.getPositionsByPlatform(req.params.platform as any);
      res.json({ positions, count: positions.length });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to get positions by platform' }); }
  });

  router.post('/positions/managed', (req: Request, res: Response) => {
    if (!positionManager) { res.status(404).json({ error: 'Position manager not available' }); return; }
    try {
      const position = positionManager.updatePosition(req.body);
      res.json({ success: true, position });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to create/update position' }); }
  });

  router.post('/positions/managed/:id/stop-loss', (req: Request, res: Response) => {
    if (!positionManager) { res.status(404).json({ error: 'Position manager not available' }); return; }
    try {
      const { price, percentFromEntry, trailingPercent } = req.body ?? {};
      positionManager.setStopLoss(req.params.id, { price, percentFromEntry, trailingPercent });
      res.json({ success: true, positionId: req.params.id });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to set stop-loss' }); }
  });

  router.post('/positions/managed/:id/take-profit', (req: Request, res: Response) => {
    if (!positionManager) { res.status(404).json({ error: 'Position manager not available' }); return; }
    try {
      const { price, percentFromEntry, partialLevels } = req.body ?? {};
      positionManager.setTakeProfit(req.params.id, { price, percentFromEntry, partialLevels });
      res.json({ success: true, positionId: req.params.id });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to set take-profit' }); }
  });

  router.delete('/positions/managed/:id/stop-loss', (req: Request, res: Response) => {
    if (!positionManager) { res.status(404).json({ error: 'Position manager not available' }); return; }
    try {
      positionManager.removeStopLoss(req.params.id);
      res.json({ success: true, positionId: req.params.id });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to remove stop-loss' }); }
  });

  router.delete('/positions/managed/:id/take-profit', (req: Request, res: Response) => {
    if (!positionManager) { res.status(404).json({ error: 'Position manager not available' }); return; }
    try {
      positionManager.removeTakeProfit(req.params.id);
      res.json({ success: true, positionId: req.params.id });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to remove take-profit' }); }
  });

  router.put('/positions/managed/:id/price', (req: Request, res: Response) => {
    if (!positionManager) { res.status(404).json({ error: 'Position manager not available' }); return; }
    try {
      const { price } = req.body ?? {};
      if (typeof price !== 'number') { res.status(400).json({ error: 'Required: price (number)' }); return; }
      positionManager.updatePrice(req.params.id, price);
      res.json({ success: true, positionId: req.params.id, price });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to update price' }); }
  });

  router.put('/positions/managed/prices', (req: Request, res: Response) => {
    if (!positionManager) { res.status(404).json({ error: 'Position manager not available' }); return; }
    try {
      const { updates } = req.body ?? {};
      if (!Array.isArray(updates)) { res.status(400).json({ error: 'Required: updates (array)' }); return; }
      positionManager.updatePrices(updates);
      res.json({ success: true, count: updates.length });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to update prices' }); }
  });

  router.post('/positions/managed/start', (_req: Request, res: Response) => {
    if (!positionManager) { res.status(404).json({ error: 'Position manager not available' }); return; }
    try {
      positionManager.start();
      res.json({ success: true, monitoring: true });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to start monitoring' }); }
  });

  router.post('/positions/managed/stop', (_req: Request, res: Response) => {
    if (!positionManager) { res.status(404).json({ error: 'Position manager not available' }); return; }
    try {
      positionManager.stop();
      res.json({ success: true, monitoring: false });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to stop monitoring' }); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FEATURE ENGINE — Market indicators
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/features', (req: Request, res: Response) => {
    if (!featureEngine) { res.status(404).json({ error: 'Feature engine not available' }); return; }
    const { platform, marketId, outcomeId } = req.query as { platform?: string; marketId?: string; outcomeId?: string };
    try {
      if (platform && marketId) {
        res.json({ features: featureEngine.getFeatures(platform, marketId, outcomeId) });
      } else {
        res.json({ stats: featureEngine.getStats(), markets: featureEngine.getAllFeatures().slice(0, 50) });
      }
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to fetch features' }); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SIGNALS/STREAM — Server-Sent Events
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/signals/stream', (req: Request, res: Response) => {
    if (!signalBus) { res.status(404).json({ error: 'Signal bus not available' }); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const includeTicks = req.query.ticks === 'true';
    res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    const onSignal = (signal: TradingSignal) => { res.write(`event: signal\ndata: ${JSON.stringify(signal)}\n\n`); };
    signalBus.onSignal(onSignal);

    let onTick: ((update: any) => void) | null = null;
    if (includeTicks) {
      let lastTickTime = 0;
      onTick = (update: any) => {
        const now = Date.now();
        if (now - lastTickTime < 500) return;
        lastTickTime = now;
        res.write(`event: tick\ndata: ${JSON.stringify({ platform: update.platform, marketId: update.marketId, outcomeId: update.outcomeId, price: update.price, timestamp: update.timestamp })}\n\n`);
      };
      signalBus.onTick(onTick);
    }

    const heartbeat = setInterval(() => { res.write(`:heartbeat ${Date.now()}\n\n`); }, 30_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      signalBus.removeListener('signal', onSignal);
      if (onTick) signalBus.removeListener('tick', onTick);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // DASHBOARD — Unified system overview
  // ══════════════════════════════════════════════════════════════════════════

  router.get('/dashboard', (_req: Request, res: Response) => {
    try {
      const signalRouterStatus = signalRouter
        ? { enabled: true, running: signalRouter.isRunning(), stats: signalRouter.getStats() }
        : { enabled: false, running: false, stats: null };
      const orchestratorStatus = orchestrator?.getStats() ?? null;
      const safetyStatus = safety?.getState() ?? null;
      const circuitBreaker = execution?.getCircuitBreakerState?.() ?? null;
      const dbPositions = db.getPositions('default');
      const pmStats = positionManager?.getStats() ?? null;
      const feStats = featureEngine?.getStats() ?? null;
      const bots = botManager?.getAllBotStatuses() ?? [];
      const activeBots = bots.filter((b: BotStatus) => b.status === 'running').length;
      const recentTrades = tradeLogger?.getTrades({ limit: 10 }) ?? [];
      const tradeStats = tradeLogger?.getStats() ?? null;
      const recentSignals = signalRouter?.getRecentExecutions(10) ?? [];
      const mlStats = mlPipeline?.getStats() ?? null;

      res.json({
        timestamp: new Date().toISOString(),
        system: { signalRouter: signalRouterStatus, orchestrator: orchestratorStatus, safety: safetyStatus, circuitBreaker },
        positions: { db: { count: dbPositions.length }, managed: pmStats },
        features: feStats,
        bots: { total: bots.length, active: activeBots, list: bots.map((b: BotStatus) => ({ id: b.id, status: b.status, name: b.name })) },
        trading: {
          stats: tradeStats,
          recentTrades: recentTrades.slice(0, 5).map((t: any) => ({ id: t.id, platform: t.platform, side: t.side, price: t.price, size: t.size, status: t.status, pnl: t.pnl, timestamp: t.timestamp })),
        },
        signals: { recent: recentSignals.slice(0, 5).map((e: any) => ({ id: e.id, type: e.signal?.type, direction: e.signal?.direction, market: e.signal?.marketId, status: e.status, timestamp: e.timestamp })) },
        ml: mlStats,
      });
    } catch (err: any) {
      logger.warn({ err }, 'API: Dashboard failed');
      res.status(500).json({ error: err?.message || 'Dashboard failed' });
    }
  });

  logger.info('Trading API routes initialized');
  return router;
}
