/**
 * Risk Engine HTTP API Routes — REST endpoints for portfolio risk management.
 *
 * Mounted as an Express Router via httpGateway.setRiskRouter().
 * All endpoints are prefixed with /api/risk by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { RiskEngine } from '../risk/engine.js';

export interface RiskRouterDeps {
  engine: RiskEngine;
}

export function createRiskRouter(deps: RiskRouterDeps): Router {
  const router = Router();
  const { engine } = deps;

  // ── GET /api/risk/portfolio ───────────────────────────────────────────────
  // Get portfolio risk snapshot (VaR, CVaR, drawdown, daily PnL)
  router.get('/portfolio', (_req: Request, res: Response) => {
    try {
      const snapshot = engine.getPortfolioRisk();
      res.json({ ok: true, data: snapshot });
    } catch (err) {
      logger.warn({ err }, 'Risk API: Failed to get portfolio risk');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/risk/regime ──────────────────────────────────────────────────
  // Get current volatility regime
  router.get('/regime', (_req: Request, res: Response) => {
    try {
      const regime = engine.getRegime();
      res.json({ ok: true, data: { regime } });
    } catch (err) {
      logger.warn({ err }, 'Risk API: Failed to get regime');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/risk/dashboard ───────────────────────────────────────────────
  // Full risk dashboard with all metrics
  router.get('/dashboard', (_req: Request, res: Response) => {
    try {
      const dashboard = engine.getDashboard();
      res.json({ ok: true, data: dashboard });
    } catch (err) {
      logger.warn({ err }, 'Risk API: Failed to get dashboard');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/risk/validate-trade ─────────────────────────────────────────
  // Pre-trade risk validation
  router.post('/validate-trade', (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, any>;
      const { userId, platform, marketId, outcomeId, outcome, side, size, price,
              estimatedEdge, confidence, category } = body;

      if (!platform || !side || !size || !price) {
        res.status(400).json({ ok: false, error: 'Required: platform, side, size, price' });
        return;
      }
      if (side !== 'buy' && side !== 'sell') {
        res.status(400).json({ ok: false, error: 'side must be "buy" or "sell"' });
        return;
      }

      const decision = engine.validateTrade({
        userId: userId || 'default',
        platform, marketId, outcomeId, outcome, side, size, price,
        estimatedEdge, confidence, category,
      });
      res.json({ ok: true, data: decision });
    } catch (err) {
      logger.warn({ err }, 'Risk API: Trade validation failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/risk/stress-test ────────────────────────────────────────────
  // Run a stress test (optional scenario name)
  router.post('/stress-test', (req: Request, res: Response) => {
    try {
      const { scenario } = req.body as { scenario?: string };
      const result = engine.runStressTest(scenario);
      res.json({ ok: true, data: result });
    } catch (err) {
      logger.warn({ err }, 'Risk API: Stress test failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/risk/record-pnl ────────────────────────────────────────────
  // Record completed trade PnL
  router.post('/record-pnl', (req: Request, res: Response) => {
    try {
      const { pnlUsd, pnlPct, positionId, timestamp } = req.body as Record<string, any>;
      if (pnlUsd === undefined || typeof pnlUsd !== 'number') {
        res.status(400).json({ ok: false, error: 'Required: pnlUsd (number)' });
        return;
      }
      if (pnlPct === undefined || typeof pnlPct !== 'number') {
        res.status(400).json({ ok: false, error: 'Required: pnlPct (number)' });
        return;
      }
      engine.recordPnL({
        pnlUsd,
        pnlPct,
        positionId,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
      });
      res.json({ ok: true, data: { recorded: true } });
    } catch (err) {
      logger.warn({ err }, 'Risk API: Record PnL failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Risk Engine API routes initialized');
  return router;
}
