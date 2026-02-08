/**
 * TWAP/Iceberg HTTP API Routes — REST endpoints for time-weighted average price orders.
 *
 * Mounted as an Express Router via httpGateway.setTwapRouter().
 * All endpoints are prefixed with /api/twap by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { ExecutionService } from '../execution/index.js';
import {
  createTwapOrder,
  createIcebergOrder,
  getActivePersistedTwapOrders,
  getPersistedTwapOrder,
  deletePersistedTwapOrder,
  type TwapOrder,
} from '../execution/twap.js';

export interface TwapRouterDeps {
  execution: ExecutionService;
}

/** Track active in-memory TWAP order instances for cancel/progress */
const activeOrders = new Map<string, TwapOrder>();

export function createTwapRouter(deps: TwapRouterDeps): Router {
  const router = Router();
  const { execution } = deps;

  // ── GET /api/twap/orders ──────────────────────────────────────────────────
  // List active TWAP orders (optionally filtered by userId)
  router.get('/orders', (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string | undefined;
      const orders = getActivePersistedTwapOrders(userId);
      res.json({ ok: true, data: { orders, count: orders.length } });
    } catch (err) {
      logger.warn({ err }, 'TWAP API: Failed to list orders');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/twap/:id ────────────────────────────────────────────────────
  // Get a single TWAP order by ID
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const order = getPersistedTwapOrder(req.params.id);
      if (!order) {
        res.status(404).json({ ok: false, error: `TWAP order ${req.params.id} not found` });
        return;
      }
      const active = activeOrders.get(req.params.id);
      const progress = active ? active.getProgress() : undefined;
      res.json({ ok: true, data: { ...order, progress } });
    } catch (err) {
      logger.warn({ err }, 'TWAP API: Failed to get order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/twap/create ────────────────────────────────────────────────
  // Create and optionally start a new TWAP order
  router.post('/create', (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, any>;
      const { platform, marketId, tokenId, outcome, side, price, negRisk,
              totalSize, sliceSize, intervalMs, maxDurationMs, jitter, priceLimit, orderType,
              autoStart, userId } = body;

      if (!platform || !totalSize || !sliceSize || !intervalMs) {
        res.status(400).json({ ok: false, error: 'Required: platform, totalSize, sliceSize, intervalMs' });
        return;
      }
      if (side && side !== 'buy' && side !== 'sell') {
        res.status(400).json({ ok: false, error: 'side must be "buy" or "sell"' });
        return;
      }

      const order = createTwapOrder(
        execution,
        { platform, marketId: marketId || '', tokenId, outcome, side: side || 'buy', price: price ?? 0, negRisk },
        { totalSize, sliceSize, intervalMs, maxDurationMs, jitter, priceLimit, orderType },
        { userId: userId || 'default' },
      );

      activeOrders.set(order.id, order);
      order.on('completed', () => activeOrders.delete(order.id));
      order.on('cancelled', () => activeOrders.delete(order.id));

      if (autoStart !== false) {
        order.start();
      }

      const progress = order.getProgress();
      res.json({ ok: true, data: { id: order.id, progress } });
    } catch (err) {
      logger.warn({ err }, 'TWAP API: Failed to create order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/twap/iceberg ───────────────────────────────────────────────
  // Create an Iceberg order (TWAP variant with visible size)
  router.post('/iceberg', (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, any>;
      const { platform, marketId, tokenId, outcome, side, price, negRisk,
              totalSize, sliceSize, intervalMs, maxDurationMs, jitter, priceLimit, orderType,
              visibleSize, autoReplenish } = body;

      if (!platform || !totalSize || !sliceSize || !intervalMs || !visibleSize) {
        res.status(400).json({ ok: false, error: 'Required: platform, totalSize, sliceSize, intervalMs, visibleSize' });
        return;
      }

      const order = createIcebergOrder(
        execution,
        { platform, marketId: marketId || '', tokenId, outcome, side: side || 'buy', price: price ?? 0, negRisk },
        { totalSize, sliceSize, intervalMs, maxDurationMs, jitter, priceLimit, orderType, visibleSize, autoReplenish: autoReplenish ?? true },
      );

      activeOrders.set(order.id, order);
      order.on('completed', () => activeOrders.delete(order.id));
      order.on('cancelled', () => activeOrders.delete(order.id));
      order.start();

      const progress = order.getProgress();
      res.json({ ok: true, data: { id: order.id, progress } });
    } catch (err) {
      logger.warn({ err }, 'TWAP API: Failed to create iceberg order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/twap/:id/cancel ────────────────────────────────────────────
  router.post('/:id/cancel', async (req: Request, res: Response) => {
    try {
      const order = activeOrders.get(req.params.id);
      if (!order) {
        res.status(404).json({ ok: false, error: `Active TWAP order ${req.params.id} not found` });
        return;
      }
      await order.cancel();
      res.json({ ok: true, data: { id: req.params.id, status: 'cancelled' } });
    } catch (err) {
      logger.warn({ err }, 'TWAP API: Failed to cancel order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── DELETE /api/twap/:id ─────────────────────────────────────────────────
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const persisted = getPersistedTwapOrder(req.params.id);
      if (!persisted) {
        res.status(404).json({ ok: false, error: `TWAP order ${req.params.id} not found` });
        return;
      }
      // Cancel if still active
      const active = activeOrders.get(req.params.id);
      if (active) {
        active.cancel().catch(() => {});
        activeOrders.delete(req.params.id);
      }
      deletePersistedTwapOrder(req.params.id);
      res.json({ ok: true, data: { id: req.params.id, deleted: true } });
    } catch (err) {
      logger.warn({ err }, 'TWAP API: Failed to delete order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('TWAP API routes initialized');
  return router;
}
