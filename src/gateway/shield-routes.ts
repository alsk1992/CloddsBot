/**
 * Shield HTTP API Routes — REST endpoints for security scanning.
 *
 * Mounted as an Express Router via httpGateway.setShieldRouter().
 * All endpoints are prefixed with /api/shield by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import { getSecurityShield, type SecurityShield } from '../security/shield.js';

export function createShieldRouter(): Router {
  const router = Router();

  function shield(): SecurityShield {
    return getSecurityShield();
  }

  // ── POST /api/shield/scan ───────────────────────────────────────────────
  // Scan code for malicious patterns
  router.post('/scan', (req: Request, res: Response) => {
    try {
      const { code } = req.body as { code?: string };
      if (!code || typeof code !== 'string') {
        res.status(400).json({ ok: false, error: 'Required: code (string)' });
        return;
      }
      const result = shield().scanCode(code);
      res.json({ ok: true, data: result });
    } catch (err) {
      logger.warn({ err }, 'Shield API: Scan failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/shield/check ──────────────────────────────────────────────
  // Check if an address is safe (auto-detects chain)
  router.post('/check', async (req: Request, res: Response) => {
    try {
      const { address, chain } = req.body as { address?: string; chain?: string };
      if (!address || typeof address !== 'string') {
        res.status(400).json({ ok: false, error: 'Required: address (string)' });
        return;
      }
      const result = await shield().checkAddress(address, chain);
      res.json({ ok: true, data: result });
    } catch (err) {
      logger.warn({ err }, 'Shield API: Check failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/shield/validate ───────────────────────────────────────────
  // Pre-flight transaction validation
  router.post('/validate', async (req: Request, res: Response) => {
    try {
      const { destination, amount, token } = req.body as { destination?: string; amount?: number; token?: string };
      if (!destination || typeof destination !== 'string') {
        res.status(400).json({ ok: false, error: 'Required: destination (string)' });
        return;
      }
      if (amount === undefined || typeof amount !== 'number') {
        res.status(400).json({ ok: false, error: 'Required: amount (number)' });
        return;
      }
      const result = await shield().validateTx({ destination, amount, token });
      res.json({ ok: true, data: result });
    } catch (err) {
      logger.warn({ err }, 'Shield API: Validate failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/shield/stats ───────────────────────────────────────────────
  // Scanner statistics
  router.get('/stats', (_req: Request, res: Response) => {
    try {
      const stats = shield().getStats();
      res.json({ ok: true, data: stats });
    } catch (err) {
      logger.warn({ err }, 'Shield API: Stats failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Shield API routes initialized');
  return router;
}
