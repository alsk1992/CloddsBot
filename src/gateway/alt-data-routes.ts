/**
 * Alt Data HTTP API Routes — REST endpoints for alternative data / sentiment.
 *
 * Mounted as an Express Router via httpGateway.setAltDataRouter().
 * All endpoints are prefixed with /api/alt-data by the caller.
 *
 * NOTE: AltDataService is created inside gateway's start() function,
 * so we use a lazy getter pattern.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { AltDataService } from '../services/alt-data/index.js';

export interface AltDataRouterDeps {
  getService: () => AltDataService | null;
}

export function createAltDataRouter(deps: AltDataRouterDeps): Router {
  const router = Router();

  function svc(): AltDataService {
    const s = deps.getService();
    if (!s) throw new Error('Alt data service not available');
    return s;
  }

  // ── GET /api/alt-data/signals ─────────────────────────────────────────────
  // Recent alt-data signals
  router.get('/signals', (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const signals = svc().getRecentSignals(limit);
      res.json({ ok: true, data: { signals, count: signals.length } });
    } catch (err) {
      logger.warn({ err }, 'Alt Data API: Signals failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/alt-data/sentiment/:marketId ─────────────────────────────────
  // Market-specific sentiment
  router.get('/sentiment/:marketId', (req: Request, res: Response) => {
    try {
      const sentiment = svc().getMarketSentiment(req.params.marketId);
      if (!sentiment) {
        res.json({ ok: true, data: null });
        return;
      }
      res.json({ ok: true, data: sentiment });
    } catch (err) {
      logger.warn({ err }, 'Alt Data API: Sentiment failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/alt-data/stats ───────────────────────────────────────────────
  // Service statistics
  router.get('/stats', (_req: Request, res: Response) => {
    try {
      const stats = svc().getStats();
      res.json({ ok: true, data: stats });
    } catch (err) {
      logger.warn({ err }, 'Alt Data API: Stats failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Alt Data API routes initialized');
  return router;
}
