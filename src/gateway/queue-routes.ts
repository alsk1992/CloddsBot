/**
 * Execution Queue HTTP API Routes — REST endpoints for BullMQ job status.
 *
 * Mounted as an Express Router via httpGateway.setQueueRouter().
 * All endpoints are prefixed with /api/queue by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { ExecutionProducer } from '../queue/jobs/index.js';

export interface QueueRouterDeps {
  producer: ExecutionProducer;
}

export function createQueueRouter(deps: QueueRouterDeps): Router {
  const router = Router();
  const { producer } = deps;

  // ── GET /api/queue/jobs/:id ───────────────────────────────────────────────
  // Get status of a queued job
  router.get('/jobs/:id', async (req: Request, res: Response) => {
    try {
      const status = await producer.getJobStatus(req.params.id);
      if (!status) {
        res.status(404).json({ ok: false, error: `Job ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: status });
    } catch (err) {
      logger.warn({ err }, 'Queue API: Get job status failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/queue/jobs/:id/wait ─────────────────────────────────────────
  // Wait for a job to complete (with timeout)
  router.post('/jobs/:id/wait', async (req: Request, res: Response) => {
    try {
      const timeoutMs = req.body?.timeoutMs ?? 30000;
      const status = await producer.waitForJob(req.params.id, timeoutMs);
      res.json({ ok: true, data: status });
    } catch (err) {
      logger.warn({ err }, 'Queue API: Wait for job failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Execution Queue API routes initialized');
  return router;
}
