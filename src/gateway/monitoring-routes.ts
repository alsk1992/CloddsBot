/**
 * Monitoring HTTP API Routes — REST endpoints for system health and metrics.
 *
 * Mounted as an Express Router via httpGateway.setMonitoringRouter().
 * All endpoints are prefixed with /api/monitoring by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import { getSystemHealth } from '../infra/index.js';
import type { ProviderHealthMonitor } from '../providers/index.js';

export interface MonitoringRouterDeps {
  providerHealth: ProviderHealthMonitor | null;
}

export function createMonitoringRouter(deps: MonitoringRouterDeps): Router {
  const router = Router();
  const { providerHealth } = deps;

  // ── GET /api/monitoring/health ────────────────────────────────────────────
  // System health (hostname, memory, CPU, uptime)
  router.get('/health', async (_req: Request, res: Response) => {
    try {
      const health = await getSystemHealth();
      res.json({ ok: true, data: health });
    } catch (err) {
      logger.warn({ err }, 'Monitoring API: Health check failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/monitoring/providers ─────────────────────────────────────────
  // LLM provider health status
  router.get('/providers', (_req: Request, res: Response) => {
    try {
      if (!providerHealth) {
        res.json({ ok: true, data: { available: false, message: 'Provider health monitor not enabled' } });
        return;
      }
      const snapshot = providerHealth.getSnapshot();
      res.json({ ok: true, data: { ...snapshot, running: providerHealth.isRunning() } });
    } catch (err) {
      logger.warn({ err }, 'Monitoring API: Provider health failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/monitoring/process ───────────────────────────────────────────
  // Node.js process info
  router.get('/process', (_req: Request, res: Response) => {
    try {
      const mem = process.memoryUsage();
      res.json({
        ok: true,
        data: {
          pid: process.pid,
          uptime: process.uptime(),
          nodeVersion: process.version,
          memory: {
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            external: mem.external,
          },
          cpuUsage: process.cpuUsage(),
        },
      });
    } catch (err) {
      logger.warn({ err }, 'Monitoring API: Process info failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Monitoring API routes initialized');
  return router;
}
