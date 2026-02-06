/**
 * Bittensor HTTP API Endpoints
 * Express router for /api/bittensor/* endpoints.
 */

import { Router, type Request, type Response } from 'express';
import type { BittensorService, EarningsPeriod } from './types';

export function createBittensorRouter(service: BittensorService): Router {
  const router = Router();

  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const status = await service.getStatus();
      res.json({ ok: true, data: status });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.get('/wallet', async (_req: Request, res: Response) => {
    try {
      const wallet = await service.getWalletInfo();
      if (!wallet) {
        res.status(404).json({ ok: false, error: 'Wallet not loaded' });
        return;
      }
      res.json({ ok: true, data: wallet });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.get('/earnings', async (req: Request, res: Response) => {
    try {
      const period = (req.query['period'] as EarningsPeriod) ?? 'daily';
      const validPeriods: EarningsPeriod[] = ['hourly', 'daily', 'weekly', 'monthly', 'all'];
      if (!validPeriods.includes(period)) {
        res.status(400).json({ ok: false, error: `Invalid period. Use: ${validPeriods.join(', ')}` });
        return;
      }
      const earnings = await service.getEarnings(period);
      res.json({ ok: true, data: earnings });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.get('/miners', async (_req: Request, res: Response) => {
    try {
      const statuses = await service.getMinerStatuses();
      res.json({ ok: true, data: statuses });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.get('/subnets', async (_req: Request, res: Response) => {
    try {
      const subnets = await service.getSubnets();
      res.json({ ok: true, data: subnets });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.post('/register', async (req: Request, res: Response) => {
    try {
      const { subnetId, hotkeyName } = req.body as { subnetId?: number; hotkeyName?: string };
      if (!subnetId || typeof subnetId !== 'number') {
        res.status(400).json({ ok: false, error: 'subnetId (number) is required' });
        return;
      }
      const result = await service.registerOnSubnet(subnetId, hotkeyName);
      res.json({ ok: result.success, message: result.message });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.post('/start', async (req: Request, res: Response) => {
    try {
      const { subnetId } = req.body as { subnetId?: number };
      if (!subnetId || typeof subnetId !== 'number') {
        res.status(400).json({ ok: false, error: 'subnetId (number) is required' });
        return;
      }
      const result = await service.startMining(subnetId);
      res.json({ ok: result.success, message: result.message });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.post('/stop', async (req: Request, res: Response) => {
    try {
      const { subnetId } = req.body as { subnetId?: number };
      if (!subnetId || typeof subnetId !== 'number') {
        res.status(400).json({ ok: false, error: 'subnetId (number) is required' });
        return;
      }
      const result = await service.stopMining(subnetId);
      res.json({ ok: result.success, message: result.message });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  return router;
}
