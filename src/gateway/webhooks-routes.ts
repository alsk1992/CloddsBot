/**
 * Webhooks HTTP API Routes — REST endpoints for webhook management.
 *
 * Mounted as an Express Router via httpGateway.setWebhooksRouter().
 * All endpoints are prefixed with /api/webhooks by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';

/** Minimal WebhookManager shape */
export interface WebhookManagerLike {
  list(): Array<{ id: string; path: string; description?: string; enabled: boolean; createdAt?: number }>;
  get(id: string): { id: string; path: string; description?: string; enabled: boolean; createdAt?: number } | undefined;
  unregister(id: string): boolean;
  setEnabled(id: string, enabled: boolean): void;
  regenerateSecret(id: string): string | null;
}

export interface WebhooksRouterDeps {
  manager: WebhookManagerLike;
}

export function createWebhooksRouter(deps: WebhooksRouterDeps): Router {
  const router = Router();
  const { manager } = deps;

  // ── GET /api/webhooks ─────────────────────────────────────────────────────
  // List all registered webhooks
  router.get('/', (_req: Request, res: Response) => {
    try {
      const webhooks = manager.list();
      res.json({ ok: true, data: { webhooks, count: webhooks.length } });
    } catch (err) {
      logger.warn({ err }, 'Webhooks API: List failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/webhooks/:id ─────────────────────────────────────────────────
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const webhook = manager.get(req.params.id);
      if (!webhook) {
        res.status(404).json({ ok: false, error: `Webhook ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: webhook });
    } catch (err) {
      logger.warn({ err }, 'Webhooks API: Get failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── PUT /api/webhooks/:id/enable ──────────────────────────────────────────
  router.put('/:id/enable', (req: Request, res: Response) => {
    try {
      const webhook = manager.get(req.params.id);
      if (!webhook) {
        res.status(404).json({ ok: false, error: `Webhook ${req.params.id} not found` });
        return;
      }
      manager.setEnabled(req.params.id, true);
      res.json({ ok: true, data: { id: req.params.id, enabled: true } });
    } catch (err) {
      logger.warn({ err }, 'Webhooks API: Enable failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── PUT /api/webhooks/:id/disable ─────────────────────────────────────────
  router.put('/:id/disable', (req: Request, res: Response) => {
    try {
      const webhook = manager.get(req.params.id);
      if (!webhook) {
        res.status(404).json({ ok: false, error: `Webhook ${req.params.id} not found` });
        return;
      }
      manager.setEnabled(req.params.id, false);
      res.json({ ok: true, data: { id: req.params.id, enabled: false } });
    } catch (err) {
      logger.warn({ err }, 'Webhooks API: Disable failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── DELETE /api/webhooks/:id ──────────────────────────────────────────────
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const ok = manager.unregister(req.params.id);
      if (!ok) {
        res.status(404).json({ ok: false, error: `Webhook ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: { id: req.params.id, deleted: true } });
    } catch (err) {
      logger.warn({ err }, 'Webhooks API: Delete failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/webhooks/:id/regenerate-secret ──────────────────────────────
  router.post('/:id/regenerate-secret', (req: Request, res: Response) => {
    try {
      const secret = manager.regenerateSecret(req.params.id);
      if (!secret) {
        res.status(404).json({ ok: false, error: `Webhook ${req.params.id} not found` });
        return;
      }
      res.json({ ok: true, data: { id: req.params.id, secret } });
    } catch (err) {
      logger.warn({ err }, 'Webhooks API: Regenerate secret failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Webhooks API routes initialized');
  return router;
}
