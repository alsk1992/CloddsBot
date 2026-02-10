/**
 * Smart Router HTTP API Routes — REST endpoints for cross-platform order routing.
 *
 * Mounted as an Express Router via httpGateway.setRoutingRouter().
 * All endpoints are prefixed with /api/routing by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { SmartRouter } from '../execution/smart-router.js';

export interface RoutingRouterDeps {
  router: SmartRouter;
}

export function createRoutingRouter(deps: RoutingRouterDeps): Router {
  const expressRouter = Router();
  const { router: smartRouter } = deps;

  // ── POST /api/routing/quote ───────────────────────────────────────────────
  // Find best route for an order across all enabled platforms
  expressRouter.post('/quote', async (req: Request, res: Response) => {
    try {
      const { marketId, alternativeIds, side, size, limitPrice } = req.body as Record<string, any>;
      if (!marketId || !side || !size) {
        res.status(400).json({ ok: false, error: 'Required: marketId, side, size' });
        return;
      }
      if (side !== 'buy' && side !== 'sell') {
        res.status(400).json({ ok: false, error: 'side must be "buy" or "sell"' });
        return;
      }
      const result = await smartRouter.findBestRoute({ marketId, alternativeIds, side, size, limitPrice });
      res.json({ ok: true, data: result });
    } catch (err) {
      logger.warn({ err }, 'Routing API: Quote failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/routing/quotes ──────────────────────────────────────────────
  // Get quotes from all enabled platforms
  expressRouter.post('/quotes', async (req: Request, res: Response) => {
    try {
      const { marketId, alternativeIds, side, size, limitPrice } = req.body as Record<string, any>;
      if (!marketId || !side || !size) {
        res.status(400).json({ ok: false, error: 'Required: marketId, side, size' });
        return;
      }
      const quotes = await smartRouter.getQuotes({ marketId, alternativeIds, side, size, limitPrice });
      res.json({ ok: true, data: { quotes, count: quotes.length } });
    } catch (err) {
      logger.warn({ err }, 'Routing API: Quotes failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/routing/compare ─────────────────────────────────────────────
  // Compare routes across platforms (same as quote with full breakdown)
  expressRouter.post('/compare', async (req: Request, res: Response) => {
    try {
      const { marketId, alternativeIds, side, size, limitPrice } = req.body as Record<string, any>;
      if (!marketId || !side || !size) {
        res.status(400).json({ ok: false, error: 'Required: marketId, side, size' });
        return;
      }
      const result = await smartRouter.compareRoutes({ marketId, alternativeIds, side, size, limitPrice });
      res.json({ ok: true, data: result });
    } catch (err) {
      logger.warn({ err }, 'Routing API: Compare failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── PUT /api/routing/config ───────────────────────────────────────────────
  // Update smart router configuration
  expressRouter.put('/config', (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, any>;
      smartRouter.updateConfig(body);
      res.json({ ok: true, data: { updated: true } });
    } catch (err) {
      logger.warn({ err }, 'Routing API: Config update failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Smart Router API routes initialized');
  return expressRouter;
}
