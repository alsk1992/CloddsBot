/**
 * Trigger Orders HTTP API Routes — REST endpoints for conditional/sniper orders.
 *
 * Mounted as an Express Router via httpGateway.setTriggerRouter().
 * All endpoints are prefixed with /api/triggers by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { TriggerOrderManager } from '../execution/trigger-orders.js';

export interface TriggerRouterDeps {
  manager: TriggerOrderManager;
}

export function createTriggerRouter(deps: TriggerRouterDeps): Router {
  const router = Router();
  const { manager } = deps;

  // ── GET /api/triggers ────────────────────────────────────────────────────
  // List all triggers
  router.get('/', (_req: Request, res: Response) => {
    try {
      const triggers = manager.getTriggers();
      res.json({ ok: true, data: { triggers, count: triggers.length } });
    } catch (err) {
      logger.warn({ err }, 'Trigger API: Failed to list triggers');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/triggers/:id ────────────────────────────────────────────────
  // Get a specific trigger by ID
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const trigger = manager.getTrigger(req.params.id);
      if (!trigger) {
        res.status(404).json({ ok: false, error: `Trigger ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: trigger });
    } catch (err) {
      logger.warn({ err }, 'Trigger API: Failed to get trigger');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/triggers/create ────────────────────────────────────────────
  // Create a new trigger order
  router.post('/create', (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, any>;
      const { platform, marketId, tokenId, outcome, condition, order, negRisk, expiresAt, oneShot } = body;

      if (!platform || !condition || !order) {
        res.status(400).json({ ok: false, error: 'Required: platform, condition, order' });
        return;
      }

      const validTypes = ['price_above', 'price_below', 'price_cross', 'spread_below'];
      if (!condition.type || !validTypes.includes(condition.type)) {
        res.status(400).json({ ok: false, error: `condition.type must be one of: ${validTypes.join(', ')}` });
        return;
      }

      if (!order.side || (order.side !== 'buy' && order.side !== 'sell')) {
        res.status(400).json({ ok: false, error: 'order.side must be "buy" or "sell"' });
        return;
      }
      if (!order.size || typeof order.size !== 'number' || order.size <= 0) {
        res.status(400).json({ ok: false, error: 'order.size must be a positive number' });
        return;
      }

      const triggerId = manager.addTrigger({
        platform,
        marketId: marketId || '',
        tokenId,
        outcome,
        condition,
        order,
        negRisk,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        oneShot: oneShot ?? true,
      });

      res.json({ ok: true, data: { id: triggerId } });
    } catch (err) {
      logger.warn({ err }, 'Trigger API: Failed to create trigger');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/triggers/:id/cancel ────────────────────────────────────────
  router.post('/:id/cancel', (req: Request, res: Response) => {
    try {
      const trigger = manager.getTrigger(req.params.id);
      if (!trigger) {
        res.status(404).json({ ok: false, error: `Trigger ${req.params.id} not found` });
        return;
      }
      manager.cancelTrigger(req.params.id);
      res.json({ ok: true, data: { id: req.params.id, status: 'cancelled' } });
    } catch (err) {
      logger.warn({ err }, 'Trigger API: Failed to cancel trigger');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/triggers/start ─────────────────────────────────────────────
  // Start monitoring all triggers
  router.post('/start', (_req: Request, res: Response) => {
    try {
      manager.start();
      res.json({ ok: true, data: { status: 'monitoring' } });
    } catch (err) {
      logger.warn({ err }, 'Trigger API: Failed to start monitoring');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/triggers/stop ──────────────────────────────────────────────
  // Stop monitoring all triggers
  router.post('/stop', (_req: Request, res: Response) => {
    try {
      manager.stop();
      res.json({ ok: true, data: { status: 'stopped' } });
    } catch (err) {
      logger.warn({ err }, 'Trigger API: Failed to stop monitoring');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Trigger Orders API routes initialized');
  return router;
}
