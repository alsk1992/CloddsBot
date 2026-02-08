/**
 * Payments / x402 HTTP API Routes — REST endpoints for payment status and history.
 *
 * Mounted as an Express Router via httpGateway.setPaymentsRouter().
 * All endpoints are prefixed with /api/payments by the caller.
 *
 * NOTE: x402Client is created conditionally in gateway — lazy getter.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { X402Client } from '../payments/x402/index.js';

export interface PaymentsRouterDeps {
  getClient: () => X402Client | null;
}

export function createPaymentsRouter(deps: PaymentsRouterDeps): Router {
  const router = Router();

  function client(): X402Client {
    const c = deps.getClient();
    if (!c) throw new Error('x402 payments client not available');
    return c;
  }

  // ── GET /api/payments/status ──────────────────────────────────────────────
  // Check if payments are configured
  router.get('/status', (_req: Request, res: Response) => {
    try {
      const c = deps.getClient();
      res.json({
        ok: true,
        data: { configured: c ? c.isConfigured() : false },
      });
    } catch (err) {
      logger.warn({ err }, 'Payments API: Status failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/payments/history ─────────────────────────────────────────────
  // Get payment history
  router.get('/history', (_req: Request, res: Response) => {
    try {
      const history = client().getPaymentHistory();
      res.json({ ok: true, data: { payments: history, count: history.length } });
    } catch (err) {
      logger.warn({ err }, 'Payments API: History failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/payments/balance/:network ────────────────────────────────────
  // Get balance for a specific network
  router.get('/balance/:network', async (req: Request, res: Response) => {
    try {
      const network = req.params.network as any;
      const balance = await client().getBalance(network);
      if (!balance) {
        res.json({ ok: true, data: null });
        return;
      }
      res.json({ ok: true, data: balance });
    } catch (err) {
      logger.warn({ err }, 'Payments API: Balance failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/payments/address/:network ────────────────────────────────────
  // Get wallet address for a specific network
  router.get('/address/:network', (req: Request, res: Response) => {
    try {
      const network = req.params.network as any;
      const address = client().getAddress(network);
      res.json({ ok: true, data: { network, address } });
    } catch (err) {
      logger.warn({ err }, 'Payments API: Address failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Payments API routes initialized');
  return router;
}
