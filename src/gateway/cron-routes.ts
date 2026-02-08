/**
 * Cron Service HTTP API Routes — REST endpoints for scheduled job CRUD.
 *
 * Mounted as an Express Router via httpGateway.setCronRouter().
 * All endpoints are prefixed with /api/cron by the caller.
 *
 * NOTE: CronService is created inside startCronService() — lazy getter.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { CronService } from '../cron/index.js';

export interface CronRouterDeps {
  getService: () => CronService | null;
}

export function createCronRouter(deps: CronRouterDeps): Router {
  const router = Router();

  function svc(): CronService {
    const s = deps.getService();
    if (!s) throw new Error('Cron service not available');
    return s;
  }

  // ── GET /api/cron/status ──────────────────────────────────────────────────
  // Service status (running, job count, next job)
  router.get('/status', (_req: Request, res: Response) => {
    try {
      const status = svc().status();
      res.json({ ok: true, data: status });
    } catch (err) {
      logger.warn({ err }, 'Cron API: Status failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/cron/jobs ────────────────────────────────────────────────────
  // List all scheduled jobs
  router.get('/jobs', (req: Request, res: Response) => {
    try {
      const includeDisabled = req.query.includeDisabled === 'true';
      const jobs = svc().list({ includeDisabled });
      res.json({ ok: true, data: { jobs, count: jobs.length } });
    } catch (err) {
      logger.warn({ err }, 'Cron API: List failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/cron/jobs/:id ────────────────────────────────────────────────
  // Get a specific job
  router.get('/jobs/:id', (req: Request, res: Response) => {
    try {
      const job = svc().get(req.params.id);
      if (!job) {
        res.status(404).json({ ok: false, error: `Job ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: job });
    } catch (err) {
      logger.warn({ err }, 'Cron API: Get failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/cron/jobs ───────────────────────────────────────────────────
  // Create a new scheduled job
  router.post('/jobs', (req: Request, res: Response) => {
    try {
      const input = req.body;
      if (!input || !input.name || !input.schedule || !input.payload) {
        res.status(400).json({ ok: false, error: 'Required: name, schedule, payload' });
        return;
      }
      const job = svc().add(input);
      res.json({ ok: true, data: job });
    } catch (err) {
      logger.warn({ err }, 'Cron API: Add failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── PATCH /api/cron/jobs/:id ──────────────────────────────────────────────
  // Update a scheduled job
  router.patch('/jobs/:id', (req: Request, res: Response) => {
    try {
      const job = svc().update(req.params.id, req.body);
      if (!job) {
        res.status(404).json({ ok: false, error: `Job ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: job });
    } catch (err) {
      logger.warn({ err }, 'Cron API: Update failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── DELETE /api/cron/jobs/:id ─────────────────────────────────────────────
  // Remove a scheduled job
  router.delete('/jobs/:id', (req: Request, res: Response) => {
    try {
      const ok = svc().remove(req.params.id);
      if (!ok) {
        res.status(404).json({ ok: false, error: `Job ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: { id: req.params.id, deleted: true } });
    } catch (err) {
      logger.warn({ err }, 'Cron API: Remove failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/cron/jobs/:id/run ───────────────────────────────────────────
  // Run a job immediately
  router.post('/jobs/:id/run', async (req: Request, res: Response) => {
    try {
      const mode = (req.body?.mode as 'due' | 'force') || 'force';
      const ran = await svc().run(req.params.id, mode);
      if (!ran) {
        res.status(404).json({ ok: false, error: `Job ${req.params.id} not found or not due` });
        return;
      }
      res.json({ ok: true, data: { id: req.params.id, ran: true, mode } });
    } catch (err) {
      logger.warn({ err }, 'Cron API: Run failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Cron API routes initialized');
  return router;
}
