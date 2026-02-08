/**
 * Alerts HTTP API Routes — REST endpoints for price/volume alert CRUD.
 *
 * Mounted as an Express Router via httpGateway.setAlertsRouter().
 * All endpoints are prefixed with /api/alerts by the caller.
 *
 * NOTE: AlertService is NOT instantiated in gateway by default.
 * We use a lazy getter pattern — the service is created on first access.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { AlertService } from '../alerts/index.js';

export interface AlertsRouterDeps {
  getService: () => AlertService | null;
}

export function createAlertsRouter(deps: AlertsRouterDeps): Router {
  const router = Router();

  function svc(): AlertService {
    const s = deps.getService();
    if (!s) throw new Error('Alert service not available');
    return s;
  }

  // ── GET /api/alerts ───────────────────────────────────────────────────────
  // List alerts for a user
  router.get('/', (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string) || 'default';
      const alerts = svc().getAlerts(userId);
      res.json({ ok: true, data: { alerts, count: alerts.length } });
    } catch (err) {
      logger.warn({ err }, 'Alerts API: List failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/alerts/:id ───────────────────────────────────────────────────
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const alert = svc().getAlert(req.params.id);
      if (!alert) {
        res.status(404).json({ ok: false, error: `Alert ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: alert });
    } catch (err) {
      logger.warn({ err }, 'Alerts API: Get failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/alerts/price ────────────────────────────────────────────────
  // Create a price alert (above/below threshold)
  router.post('/price', (req: Request, res: Response) => {
    try {
      const { userId, platform, marketId, marketQuestion, type, threshold,
              deliveryChannel, deliveryChatId, oneTime } = req.body as Record<string, any>;
      if (!platform || !marketId || !type || threshold === undefined) {
        res.status(400).json({ ok: false, error: 'Required: platform, marketId, type, threshold' });
        return;
      }
      if (type !== 'price_above' && type !== 'price_below') {
        res.status(400).json({ ok: false, error: 'type must be "price_above" or "price_below"' });
        return;
      }
      const alert = svc().createPriceAlert({
        userId: userId || 'default', platform, marketId, marketQuestion,
        type, threshold, deliveryChannel: deliveryChannel || 'http',
        deliveryChatId: deliveryChatId || '', oneTime,
      });
      res.json({ ok: true, data: alert });
    } catch (err) {
      logger.warn({ err }, 'Alerts API: Create price alert failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/alerts/price-change ─────────────────────────────────────────
  // Create a price change alert (% change in time window)
  router.post('/price-change', (req: Request, res: Response) => {
    try {
      const { userId, platform, marketId, marketQuestion, changePct, timeWindowSecs,
              deliveryChannel, deliveryChatId } = req.body as Record<string, any>;
      if (!platform || !marketId || !changePct || !timeWindowSecs) {
        res.status(400).json({ ok: false, error: 'Required: platform, marketId, changePct, timeWindowSecs' });
        return;
      }
      const alert = svc().createPriceChangeAlert({
        userId: userId || 'default', platform, marketId, marketQuestion,
        changePct, timeWindowSecs, deliveryChannel: deliveryChannel || 'http',
        deliveryChatId: deliveryChatId || '',
      });
      res.json({ ok: true, data: alert });
    } catch (err) {
      logger.warn({ err }, 'Alerts API: Create price change alert failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/alerts/volume ───────────────────────────────────────────────
  // Create a volume spike alert
  router.post('/volume', (req: Request, res: Response) => {
    try {
      const { userId, platform, marketId, marketQuestion, threshold,
              deliveryChannel, deliveryChatId } = req.body as Record<string, any>;
      if (!platform || !marketId || !threshold) {
        res.status(400).json({ ok: false, error: 'Required: platform, marketId, threshold' });
        return;
      }
      const alert = svc().createVolumeAlert({
        userId: userId || 'default', platform, marketId, marketQuestion,
        threshold, deliveryChannel: deliveryChannel || 'http',
        deliveryChatId: deliveryChatId || '',
      });
      res.json({ ok: true, data: alert });
    } catch (err) {
      logger.warn({ err }, 'Alerts API: Create volume alert failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── PUT /api/alerts/:id/enable ────────────────────────────────────────────
  router.put('/:id/enable', (req: Request, res: Response) => {
    try {
      const ok = svc().enableAlert(req.params.id);
      if (!ok) {
        res.status(404).json({ ok: false, error: `Alert ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: { id: req.params.id, enabled: true } });
    } catch (err) {
      logger.warn({ err }, 'Alerts API: Enable failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── PUT /api/alerts/:id/disable ───────────────────────────────────────────
  router.put('/:id/disable', (req: Request, res: Response) => {
    try {
      const ok = svc().disableAlert(req.params.id);
      if (!ok) {
        res.status(404).json({ ok: false, error: `Alert ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: { id: req.params.id, enabled: false } });
    } catch (err) {
      logger.warn({ err }, 'Alerts API: Disable failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── DELETE /api/alerts/:id ────────────────────────────────────────────────
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const ok = svc().deleteAlert(req.params.id);
      if (!ok) {
        res.status(404).json({ ok: false, error: `Alert ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: { id: req.params.id, deleted: true } });
    } catch (err) {
      logger.warn({ err }, 'Alerts API: Delete failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/alerts/start-monitoring ─────────────────────────────────────
  router.post('/start-monitoring', (_req: Request, res: Response) => {
    try {
      svc().startMonitoring();
      res.json({ ok: true, data: { monitoring: true } });
    } catch (err) {
      logger.warn({ err }, 'Alerts API: Start monitoring failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/alerts/stop-monitoring ──────────────────────────────────────
  router.post('/stop-monitoring', (_req: Request, res: Response) => {
    try {
      svc().stopMonitoring();
      res.json({ ok: true, data: { monitoring: false } });
    } catch (err) {
      logger.warn({ err }, 'Alerts API: Stop monitoring failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Alerts API routes initialized');
  return router;
}
