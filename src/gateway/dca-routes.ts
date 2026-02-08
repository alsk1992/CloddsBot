/**
 * DCA HTTP API Routes — REST endpoints for Dollar-Cost Averaging orders.
 *
 * Mounted as an Express Router via httpGateway.setDCARouter().
 * All endpoints are prefixed with /api/dca by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import {
  saveDCAOrder,
  getDCAOrder,
  getActiveDCAOrders,
  updateDCAProgress,
  deleteDCAOrder,
  type PersistedDCAOrder,
} from '../execution/dca-persistence.js';

/** Enrich a persisted order with computed fields for API responses */
function enrichOrder(order: PersistedDCAOrder) {
  const maxCycles = order.maxCycles ?? Math.ceil(order.totalAmount / order.amountPerCycle);
  const cyclesRemaining = Math.max(0, maxCycles - order.cyclesCompleted);
  return {
    ...order,
    intervalSec: Math.round(order.cycleIntervalMs / 1000),
    cyclesRemaining,
    totalSpent: order.totalCost,
  };
}

export function createDCARouter(): Router {
  const router = Router();

  // ── GET /api/dca/orders ─────────────────────────────────────────────────
  // List active DCA orders (optionally filtered by userId query param)
  router.get('/orders', (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string | undefined;
      const orders = getActiveDCAOrders(userId).map(enrichOrder);
      res.json({ ok: true, data: { orders, count: orders.length } });
    } catch (err) {
      logger.warn({ err }, 'DCA API: Failed to get orders');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/dca/:id ──────────────────────────────────────────────────
  // Get a single DCA order by ID
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const order = getDCAOrder(req.params.id);
      if (!order) {
        res.status(404).json({ ok: false, error: `DCA order ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: enrichOrder(order) });
    } catch (err) {
      logger.warn({ err }, 'DCA API: Failed to get order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/dca/create ────────────────────────────────────────────────
  // Create a new DCA order
  // Accepts intervalSec (from API docs) and converts to cycleIntervalMs internally
  router.post('/create', (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, any>;
      const { platform, marketId, tokenId, outcome, side, totalAmount, amountPerCycle, price, maxPrice, maxCycles, negRisk } = body;

      // Accept either intervalSec (documented) or cycleIntervalMs (internal)
      const intervalSec = body.intervalSec as number | undefined;
      const cycleIntervalMs = body.cycleIntervalMs as number | undefined;
      const resolvedIntervalMs = intervalSec ? intervalSec * 1000 : cycleIntervalMs;

      if (!platform || !totalAmount || !amountPerCycle || !resolvedIntervalMs) {
        res.status(400).json({ ok: false, error: 'Required: platform, totalAmount, amountPerCycle, intervalSec (or cycleIntervalMs)' });
        return;
      }
      if (side && side !== 'buy' && side !== 'sell') {
        res.status(400).json({ ok: false, error: 'side must be "buy" or "sell"' });
        return;
      }

      const now = Date.now();
      const order: PersistedDCAOrder = {
        id: body.id || `dca_${now}_${Math.random().toString(36).slice(2, 8)}`,
        userId: body.userId || 'default',
        platform,
        marketId: marketId || '',
        tokenId: tokenId ?? undefined,
        outcome: outcome ?? undefined,
        side: (side as 'buy' | 'sell') || 'buy',
        price: price ?? 0,
        totalAmount,
        amountPerCycle,
        cycleIntervalMs: resolvedIntervalMs,
        maxPrice: maxPrice ?? undefined,
        maxCycles: maxCycles ?? undefined,
        negRisk: negRisk ?? undefined,
        investedAmount: 0,
        totalShares: 0,
        totalCost: 0,
        cyclesCompleted: 0,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        extraConfig: body.extraConfig ?? undefined,
      };

      saveDCAOrder(order);
      res.json({ ok: true, data: enrichOrder(order) });
    } catch (err) {
      logger.warn({ err }, 'DCA API: Failed to create order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/dca/:id/pause ─────────────────────────────────────────────
  router.post('/:id/pause', (req: Request, res: Response) => {
    try {
      const order = getDCAOrder(req.params.id);
      if (!order) {
        res.status(404).json({ ok: false, error: `DCA order ${req.params.id} not found` });
        return;
      }
      if (order.status !== 'active' && order.status !== 'pending') {
        res.status(400).json({ ok: false, error: `Cannot pause order with status: ${order.status}` });
        return;
      }
      updateDCAProgress(req.params.id, {
        investedAmount: order.investedAmount,
        totalShares: order.totalShares,
        totalCost: order.totalCost,
        cyclesCompleted: order.cyclesCompleted,
        status: 'paused',
      });
      res.json({ ok: true, data: { id: req.params.id, status: 'paused' } });
    } catch (err) {
      logger.warn({ err }, 'DCA API: Failed to pause order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/dca/:id/resume ────────────────────────────────────────────
  router.post('/:id/resume', (req: Request, res: Response) => {
    try {
      const order = getDCAOrder(req.params.id);
      if (!order) {
        res.status(404).json({ ok: false, error: `DCA order ${req.params.id} not found` });
        return;
      }
      if (order.status !== 'paused') {
        res.status(400).json({ ok: false, error: `Cannot resume order with status: ${order.status}` });
        return;
      }
      updateDCAProgress(req.params.id, {
        investedAmount: order.investedAmount,
        totalShares: order.totalShares,
        totalCost: order.totalCost,
        cyclesCompleted: order.cyclesCompleted,
        status: 'active',
        nextCycleAtMs: Date.now() + order.cycleIntervalMs,
      });
      res.json({ ok: true, data: { id: req.params.id, status: 'active' } });
    } catch (err) {
      logger.warn({ err }, 'DCA API: Failed to resume order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── DELETE /api/dca/:id ─────────────────────────────────────────────────
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const order = getDCAOrder(req.params.id);
      if (!order) {
        res.status(404).json({ ok: false, error: `DCA order ${req.params.id} not found` });
        return;
      }
      deleteDCAOrder(req.params.id);
      res.json({ ok: true, data: { id: req.params.id, deleted: true } });
    } catch (err) {
      logger.warn({ err }, 'DCA API: Failed to delete order');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('DCA API routes initialized');
  return router;
}
