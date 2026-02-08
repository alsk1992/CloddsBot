/**
 * Opportunity Finder HTTP API Routes — REST endpoints for cross-platform arbitrage.
 *
 * Mounted as an Express Router via httpGateway.setOpportunityRouter().
 * All endpoints are prefixed with /api/opportunities by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { OpportunityFinder } from '../opportunity/index.js';
import type { Platform } from '../types.js';

export interface OpportunityRouterDeps {
  finder: OpportunityFinder;
}

export function createOpportunityRouter(deps: OpportunityRouterDeps): Router {
  const router = Router();
  const { finder } = deps;

  // ── POST /api/opportunities/scan ──────────────────────────────────────────
  // Scan for opportunities with optional filters
  router.post('/scan', async (req: Request, res: Response) => {
    try {
      const { query, platforms, minEdge, minLiquidity, limit, sortBy, types } =
        req.body as Record<string, any>;
      const opportunities = await finder.scan({ query, platforms: platforms as Platform[] | undefined, minEdge, minLiquidity, limit, sortBy, types });
      res.json({ ok: true, data: { opportunities, count: opportunities.length } });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Scan failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/opportunities/active ─────────────────────────────────────────
  // List currently active opportunities
  router.get('/active', (_req: Request, res: Response) => {
    try {
      const opportunities = finder.getActive();
      res.json({ ok: true, data: { opportunities, count: opportunities.length } });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Failed to get active');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/opportunities/analytics ──────────────────────────────────────
  // Historical analytics / statistics
  router.get('/analytics', (req: Request, res: Response) => {
    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : undefined;
      const platform = req.query.platform as Platform | undefined;
      const stats = finder.getAnalytics({ days, platform });
      res.json({ ok: true, data: stats });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Analytics failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/opportunities/platform-pairs ─────────────────────────────────
  // Get platform pairs with arb frequency
  router.get('/platform-pairs', (_req: Request, res: Response) => {
    try {
      const pairs = finder.getPlatformPairs();
      res.json({ ok: true, data: { pairs, count: pairs.length } });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Platform pairs failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/opportunities/:id ────────────────────────────────────────────
  // Get a specific opportunity by ID
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const opportunity = finder.get(req.params.id);
      if (!opportunity) {
        res.status(404).json({ ok: false, error: `Opportunity ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: opportunity });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Failed to get opportunity');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/opportunities/realtime/start ────────────────────────────────
  router.post('/realtime/start', async (_req: Request, res: Response) => {
    try {
      await finder.startRealtime();
      res.json({ ok: true, data: { status: 'scanning' } });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Failed to start realtime');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/opportunities/realtime/stop ─────────────────────────────────
  router.post('/realtime/stop', (_req: Request, res: Response) => {
    try {
      finder.stopRealtime();
      res.json({ ok: true, data: { status: 'stopped' } });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Failed to stop realtime');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/opportunities/:id/take ──────────────────────────────────────
  // Mark opportunity as taken (with optional fill prices)
  router.post('/:id/take', (req: Request, res: Response) => {
    try {
      const opportunity = finder.get(req.params.id);
      if (!opportunity) {
        res.status(404).json({ ok: false, error: `Opportunity ${req.params.id} not found` });
        return;
      }
      const { fillPrices } = req.body as { fillPrices?: Record<string, number> };
      finder.markTaken(req.params.id, fillPrices);
      res.json({ ok: true, data: { id: req.params.id, status: 'taken' } });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Failed to mark taken');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/opportunities/:id/outcome ───────────────────────────────────
  // Record outcome for a taken opportunity
  router.post('/:id/outcome', (req: Request, res: Response) => {
    try {
      const opportunity = finder.get(req.params.id);
      if (!opportunity) {
        res.status(404).json({ ok: false, error: `Opportunity ${req.params.id} not found` });
        return;
      }
      const outcome = req.body as Record<string, any>;
      finder.recordOutcome(req.params.id, outcome as any);
      res.json({ ok: true, data: { id: req.params.id, outcomeRecorded: true } });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Failed to record outcome');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/opportunities/:id/estimate ──────────────────────────────────
  // Estimate execution plan for a given size
  router.post('/:id/estimate', (req: Request, res: Response) => {
    try {
      const opportunity = finder.get(req.params.id);
      if (!opportunity) {
        res.status(404).json({ ok: false, error: `Opportunity ${req.params.id} not found` });
        return;
      }
      const { size } = req.body as { size?: number };
      if (!size || typeof size !== 'number' || size <= 0) {
        res.status(400).json({ ok: false, error: 'Required: size (positive number)' });
        return;
      }
      const plan = finder.estimateExecution(opportunity, size);
      res.json({ ok: true, data: plan });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Estimate failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/opportunities/:id/risk ──────────────────────────────────────
  // Model risk for a given position size
  router.post('/:id/risk', (req: Request, res: Response) => {
    try {
      const opportunity = finder.get(req.params.id);
      if (!opportunity) {
        res.status(404).json({ ok: false, error: `Opportunity ${req.params.id} not found` });
        return;
      }
      const { positionSize } = req.body as { positionSize?: number };
      if (!positionSize || typeof positionSize !== 'number' || positionSize <= 0) {
        res.status(400).json({ ok: false, error: 'Required: positionSize (positive number)' });
        return;
      }
      const risk = finder.modelRisk(opportunity, positionSize);
      res.json({ ok: true, data: risk });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Risk model failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/opportunities/linked-markets ───────────────────────────────
  // Get linked markets for a given market key
  router.get('/linked-markets', (req: Request, res: Response) => {
    try {
      const marketKey = req.query.marketKey as string | undefined;
      if (!marketKey) {
        res.status(400).json({ ok: false, error: 'Required query param: marketKey' });
        return;
      }
      const links = finder.getLinkedMarkets(marketKey);
      res.json({ ok: true, data: { links, count: links.length } });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Linked markets failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/opportunities/link-markets ──────────────────────────────────
  // Manually link two markets as equivalent
  router.post('/link-markets', (req: Request, res: Response) => {
    try {
      const { marketA, marketB, confidence } = req.body as { marketA?: string; marketB?: string; confidence?: number };
      if (!marketA || !marketB) {
        res.status(400).json({ ok: false, error: 'Required: marketA, marketB' });
        return;
      }
      finder.linkMarkets(marketA, marketB, confidence);
      res.json({ ok: true, data: { linked: true, marketA, marketB } });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Link markets failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── DELETE /api/opportunities/link-markets ────────────────────────────────
  // Unlink two markets
  router.delete('/link-markets', (req: Request, res: Response) => {
    try {
      const { marketA, marketB } = req.body as { marketA?: string; marketB?: string };
      if (!marketA || !marketB) {
        res.status(400).json({ ok: false, error: 'Required: marketA, marketB' });
        return;
      }
      finder.unlinkMarkets(marketA, marketB);
      res.json({ ok: true, data: { unlinked: true, marketA, marketB } });
    } catch (err) {
      logger.warn({ err }, 'Opportunity API: Unlink markets failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Opportunity Finder API routes initialized');
  return router;
}
