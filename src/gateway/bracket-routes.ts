/**
 * Bracket Orders HTTP API Routes — REST endpoints for OCO (TP + SL) orders.
 *
 * Mounted as an Express Router via httpGateway.setBracketRouter().
 * All endpoints are prefixed with /api/bracket by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { ExecutionService } from '../execution/index.js';
import {
  createBracketOrder,
  getActivePersistedBracketOrders,
  getPersistedBracketOrder,
  deletePersistedBracketOrder,
  type BracketOrder,
} from '../execution/bracket-orders.js';

export interface BracketRouterDeps {
  execution: ExecutionService;
}

/** Track active in-memory bracket order instances */
const activeOrders = new Map<string, BracketOrder>();

export function createBracketRouter(deps: BracketRouterDeps): Router {
  const router = Router();
  const { execution } = deps;

  // ── GET /api/bracket/orders ───────────────────────────────────────────────
  // List active bracket orders (optionally filtered by userId)
  router.get('/orders', (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string | undefined;
      const orders = getActivePersistedBracketOrders(userId);
      res.json({ ok: true, data: { orders, count: orders.length } });
    } catch (err) {
      logger.warn({ err }, 'Bracket API: Failed to list orders');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/bracket/:id ─────────────────────────────────────────────────
  // Get a single bracket order by ID
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const order = getPersistedBracketOrder(req.params.id);
      if (!order) {
        res.status(404).json({ ok: false, error: `Bracket order ${req.params.id} not found` });
        return;
      }
      const active = activeOrders.get(req.params.id);
      const status = active ? active.getStatus() : undefined;
      res.json({ ok: true, data: { ...order, liveStatus: status } });
    } catch (err) {
      logger.warn({ err }, 'Bracket API: Failed to get order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/bracket/create ─────────────────────────────────────────────
  // Create and start a new bracket order (TP + SL)
  router.post('/create', async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, any>;
      const { platform, marketId, tokenId, outcome, size, side,
              takeProfitPrice, stopLossPrice, takeProfitSizePct, negRisk,
              pollIntervalMs, autoStart, userId } = body;

      if (!platform || !size || !takeProfitPrice || !stopLossPrice) {
        res.status(400).json({ ok: false, error: 'Required: platform, size, takeProfitPrice, stopLossPrice' });
        return;
      }
      if (side && side !== 'long' && side !== 'short') {
        res.status(400).json({ ok: false, error: 'side must be "long" or "short"' });
        return;
      }

      const order = createBracketOrder(
        execution,
        {
          platform, marketId: marketId || '', tokenId, outcome,
          size, side: side || 'long', takeProfitPrice, stopLossPrice,
          takeProfitSizePct, negRisk, pollIntervalMs,
        },
        { userId: userId || 'default' },
      );

      activeOrders.set(order.id, order);
      order.on('completed', () => activeOrders.delete(order.id));
      order.on('cancelled', () => activeOrders.delete(order.id));

      if (autoStart !== false) {
        await order.start();
      }

      const status = order.getStatus();
      res.json({ ok: true, data: { id: order.id, status } });
    } catch (err) {
      logger.warn({ err }, 'Bracket API: Failed to create order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/bracket/:id/cancel ─────────────────────────────────────────
  router.post('/:id/cancel', async (req: Request, res: Response) => {
    try {
      const order = activeOrders.get(req.params.id);
      if (!order) {
        res.status(404).json({ ok: false, error: `Active bracket order ${req.params.id} not found` });
        return;
      }
      await order.cancel();
      res.json({ ok: true, data: { id: req.params.id, status: 'cancelled' } });
    } catch (err) {
      logger.warn({ err }, 'Bracket API: Failed to cancel order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── DELETE /api/bracket/:id ──────────────────────────────────────────────
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const persisted = getPersistedBracketOrder(req.params.id);
      if (!persisted) {
        res.status(404).json({ ok: false, error: `Bracket order ${req.params.id} not found` });
        return;
      }
      const active = activeOrders.get(req.params.id);
      if (active) {
        active.cancel().catch(() => {});
        activeOrders.delete(req.params.id);
      }
      deletePersistedBracketOrder(req.params.id);
      res.json({ ok: true, data: { id: req.params.id, deleted: true } });
    } catch (err) {
      logger.warn({ err }, 'Bracket API: Failed to delete order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Bracket Orders API routes initialized');
  return router;
}
