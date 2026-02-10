/**
 * Copy Trading HTTP API Routes — REST endpoints for whale copy trading.
 *
 * Mounted as an Express Router via httpGateway.setCopyTradingRouter().
 * All endpoints are prefixed with /api/copy-trading by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { CopyTradingService } from '../trading/copy-trading.js';

export interface CopyTradingRouterDeps {
  service: CopyTradingService;
}

export function createCopyTradingRouter(deps: CopyTradingRouterDeps): Router {
  const router = Router();
  const { service } = deps;

  // ── GET /api/copy-trading/stats ───────────────────────────────────────────
  router.get('/stats', (_req: Request, res: Response) => {
    try {
      const stats = service.getStats();
      res.json({ ok: true, data: { ...stats, running: service.isRunning() } });
    } catch (err) {
      logger.warn({ err }, 'Copy Trading API: Failed to get stats');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/copy-trading/followed ────────────────────────────────────────
  router.get('/followed', (_req: Request, res: Response) => {
    try {
      const addresses = service.getFollowedAddresses();
      res.json({ ok: true, data: { addresses, count: addresses.length } });
    } catch (err) {
      logger.warn({ err }, 'Copy Trading API: Failed to get followed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/copy-trading/trades ──────────────────────────────────────────
  router.get('/trades', (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const trades = service.getCopiedTrades(limit);
      res.json({ ok: true, data: { trades, count: trades.length } });
    } catch (err) {
      logger.warn({ err }, 'Copy Trading API: Failed to get trades');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/copy-trading/positions ───────────────────────────────────────
  router.get('/positions', (_req: Request, res: Response) => {
    try {
      const positions = service.getOpenPositions();
      res.json({ ok: true, data: { positions, count: positions.length } });
    } catch (err) {
      logger.warn({ err }, 'Copy Trading API: Failed to get positions');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/copy-trading/start ──────────────────────────────────────────
  router.post('/start', (_req: Request, res: Response) => {
    try {
      if (service.isRunning()) {
        res.status(400).json({ ok: false, error: 'Copy trading is already running' });
        return;
      }
      service.start();
      res.json({ ok: true, data: { status: 'running' } });
    } catch (err) {
      logger.warn({ err }, 'Copy Trading API: Failed to start');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/copy-trading/stop ───────────────────────────────────────────
  router.post('/stop', (_req: Request, res: Response) => {
    try {
      if (!service.isRunning()) {
        res.status(400).json({ ok: false, error: 'Copy trading is not running' });
        return;
      }
      service.stop();
      res.json({ ok: true, data: { status: 'stopped' } });
    } catch (err) {
      logger.warn({ err }, 'Copy Trading API: Failed to stop');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/copy-trading/follow ─────────────────────────────────────────
  router.post('/follow', (req: Request, res: Response) => {
    try {
      const { address } = req.body as { address?: string };
      if (!address || typeof address !== 'string') {
        res.status(400).json({ ok: false, error: 'Required: address (string)' });
        return;
      }
      service.follow(address);
      res.json({ ok: true, data: { address, followed: true } });
    } catch (err) {
      logger.warn({ err }, 'Copy Trading API: Failed to follow');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/copy-trading/unfollow ───────────────────────────────────────
  router.post('/unfollow', (req: Request, res: Response) => {
    try {
      const { address } = req.body as { address?: string };
      if (!address || typeof address !== 'string') {
        res.status(400).json({ ok: false, error: 'Required: address (string)' });
        return;
      }
      service.unfollow(address);
      res.json({ ok: true, data: { address, unfollowed: true } });
    } catch (err) {
      logger.warn({ err }, 'Copy Trading API: Failed to unfollow');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/copy-trading/close/:tradeId ─────────────────────────────────
  router.post('/close/:tradeId', async (req: Request, res: Response) => {
    try {
      await service.closePosition(req.params.tradeId);
      res.json({ ok: true, data: { tradeId: req.params.tradeId, closed: true } });
    } catch (err) {
      logger.warn({ err }, 'Copy Trading API: Failed to close position');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/copy-trading/close-all ──────────────────────────────────────
  router.post('/close-all', async (_req: Request, res: Response) => {
    try {
      await service.closeAllPositions();
      res.json({ ok: true, data: { closedAll: true } });
    } catch (err) {
      logger.warn({ err }, 'Copy Trading API: Failed to close all positions');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── PUT /api/copy-trading/config ──────────────────────────────────────────
  router.put('/config', (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, any>;
      service.updateConfig(body);
      res.json({ ok: true, data: { updated: true } });
    } catch (err) {
      logger.warn({ err }, 'Copy Trading API: Failed to update config');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Copy Trading API routes initialized');
  return router;
}
