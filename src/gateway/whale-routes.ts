/**
 * Whale Tracker HTTP API Routes — REST endpoints for monitoring large trades.
 *
 * Mounted as an Express Router via httpGateway.setWhaleRouter().
 * All endpoints are prefixed with /api/whales by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { WhaleTracker } from '../feeds/polymarket/whale-tracker.js';

export interface WhaleRouterDeps {
  tracker: WhaleTracker;
}

export function createWhaleRouter(deps: WhaleRouterDeps): Router {
  const router = Router();
  const { tracker } = deps;

  // ── GET /api/whales/status ────────────────────────────────────────────────
  router.get('/status', (_req: Request, res: Response) => {
    try {
      res.json({
        ok: true,
        data: {
          running: tracker.isRunning(),
          connectionState: tracker.getConnectionState(),
        },
      });
    } catch (err) {
      logger.warn({ err }, 'Whale API: Failed to get status');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/whales/known ─────────────────────────────────────────────────
  // List all known whale profiles
  router.get('/known', (_req: Request, res: Response) => {
    try {
      const whales = tracker.getKnownWhales();
      res.json({ ok: true, data: { whales, count: whales.length } });
    } catch (err) {
      logger.warn({ err }, 'Whale API: Failed to get known whales');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/whales/top ───────────────────────────────────────────────────
  // Get top whales by total value
  router.get('/top', (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const whales = tracker.getTopWhales(limit);
      res.json({ ok: true, data: { whales, count: whales.length } });
    } catch (err) {
      logger.warn({ err }, 'Whale API: Failed to get top whales');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/whales/profitable ────────────────────────────────────────────
  // Get profitable whales (for copy trading candidates)
  router.get('/profitable', (req: Request, res: Response) => {
    try {
      const minWinRate = req.query.minWinRate ? parseFloat(req.query.minWinRate as string) : undefined;
      const minTrades = req.query.minTrades ? parseInt(req.query.minTrades as string, 10) : undefined;
      const whales = tracker.getProfitableWhales(minWinRate, minTrades);
      res.json({ ok: true, data: { whales, count: whales.length } });
    } catch (err) {
      logger.warn({ err }, 'Whale API: Failed to get profitable whales');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/whales/recent-trades ─────────────────────────────────────────
  router.get('/recent-trades', (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const trades = tracker.getRecentTrades(limit);
      res.json({ ok: true, data: { trades, count: trades.length } });
    } catch (err) {
      logger.warn({ err }, 'Whale API: Failed to get recent trades');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/whales/positions ─────────────────────────────────────────────
  // Active whale positions (optionally filtered by marketId)
  router.get('/positions', (req: Request, res: Response) => {
    try {
      const marketId = req.query.marketId as string | undefined;
      const positions = tracker.getActivePositions(marketId);
      res.json({ ok: true, data: { positions, count: positions.length } });
    } catch (err) {
      logger.warn({ err }, 'Whale API: Failed to get positions');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/whales/:address ──────────────────────────────────────────────
  // Get a whale's full profile
  router.get('/:address', (req: Request, res: Response) => {
    try {
      const profile = tracker.getWhaleProfile(req.params.address);
      if (!profile) {
        res.status(404).json({ ok: false, error: `Whale profile for ${req.params.address} not found` });
        return;
      }
      res.json({ ok: true, data: profile });
    } catch (err) {
      logger.warn({ err }, 'Whale API: Failed to get profile');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/whales/:address/signal-strength ──────────────────────────────
  // Calculate copy trading signal strength for an address
  router.get('/:address/signal-strength', (req: Request, res: Response) => {
    try {
      const profile = tracker.getWhaleProfile(req.params.address);
      if (!profile) {
        res.status(404).json({ ok: false, error: `Whale profile for ${req.params.address} not found` });
        return;
      }
      const strength = tracker.calculateSignalStrength(profile);
      res.json({ ok: true, data: { address: req.params.address, signalStrength: strength } });
    } catch (err) {
      logger.warn({ err }, 'Whale API: Failed to calculate signal strength');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/whales/start ────────────────────────────────────────────────
  router.post('/start', async (_req: Request, res: Response) => {
    try {
      await tracker.start();
      res.json({ ok: true, data: { status: 'running' } });
    } catch (err) {
      logger.warn({ err }, 'Whale API: Failed to start');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/whales/stop ─────────────────────────────────────────────────
  router.post('/stop', (_req: Request, res: Response) => {
    try {
      tracker.stop();
      res.json({ ok: true, data: { status: 'stopped' } });
    } catch (err) {
      logger.warn({ err }, 'Whale API: Failed to stop');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/whales/track ────────────────────────────────────────────────
  // Start tracking a specific address
  router.post('/track', (req: Request, res: Response) => {
    try {
      const { address } = req.body as { address?: string };
      if (!address || typeof address !== 'string') {
        res.status(400).json({ ok: false, error: 'Required: address (string)' });
        return;
      }
      tracker.trackAddress(address);
      res.json({ ok: true, data: { address, tracking: true } });
    } catch (err) {
      logger.warn({ err }, 'Whale API: Failed to track');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/whales/untrack ──────────────────────────────────────────────
  // Stop tracking a specific address
  router.post('/untrack', (req: Request, res: Response) => {
    try {
      const { address } = req.body as { address?: string };
      if (!address || typeof address !== 'string') {
        res.status(400).json({ ok: false, error: 'Required: address (string)' });
        return;
      }
      tracker.untrackAddress(address);
      res.json({ ok: true, data: { address, tracking: false } });
    } catch (err) {
      logger.warn({ err }, 'Whale API: Failed to untrack');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/whales/:address/record-close ─────────────────────────────
  // Record a closed position for whale performance tracking
  router.post('/:address/record-close', (req: Request, res: Response) => {
    try {
      const { pnl } = req.body as { pnl?: number };
      if (pnl === undefined || typeof pnl !== 'number') {
        res.status(400).json({ ok: false, error: 'Required: pnl (number)' });
        return;
      }
      tracker.recordClosedPosition(req.params.address, pnl);
      res.json({ ok: true, data: { address: req.params.address, recorded: true } });
    } catch (err) {
      logger.warn({ err }, 'Whale API: Failed to record close');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Whale Tracker API routes initialized');
  return router;
}
