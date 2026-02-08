/**
 * Token Audit HTTP API Routes — REST endpoints for GoPlus token security auditing.
 *
 * Mounted as an Express Router via httpGateway.setAuditRouter().
 * All endpoints are prefixed with /api/audit by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import { createTokenSecurityService, type TokenSecurityService } from '../token-security/index.js';

let _service: TokenSecurityService | null = null;
function getService(): TokenSecurityService {
  if (!_service) _service = createTokenSecurityService();
  return _service;
}

export function createAuditRouter(): Router {
  const router = Router();

  // ── GET /api/audit/:address ─────────────────────────────────────────────
  // Audit a token contract by address. Chain auto-detected or passed via query.
  router.get('/:address', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const chain = (req.query.chain as string) || autoDetectChain(address);
      if (!address) {
        res.status(400).json({ ok: false, error: 'Required: address param' });
        return;
      }
      const result = await getService().auditToken(address, chain);
      res.json({ ok: true, data: result });
    } catch (err) {
      logger.warn({ err }, 'Audit API: Token audit failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/audit/:address/safe ────────────────────────────────────────
  // Quick boolean safety check
  router.get('/:address/safe', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const chain = (req.query.chain as string) || autoDetectChain(address);
      const safe = await getService().isSafe(address, chain);
      res.json({ ok: true, data: { address, chain, safe } });
    } catch (err) {
      logger.warn({ err }, 'Audit API: Safety check failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Audit API routes initialized');
  return router;
}

function autoDetectChain(address: string): string {
  if (address.startsWith('0x') && address.length === 42) return 'ethereum';
  return 'solana';
}
