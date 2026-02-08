/**
 * Percolator HTTP API Routes — REST endpoints for on-chain Solana perpetual futures.
 *
 * Mounted as an Express Router via httpGateway.setPercolatorRouter().
 * All endpoints are prefixed with /api/percolator by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { PercolatorFeed } from '../percolator/feed.js';
import type { PercolatorExecutionService } from '../percolator/execution.js';
import type { PercolatorKeeper } from '../percolator/keeper.js';

export interface PercolatorRouterDeps {
  feed: PercolatorFeed;
  execution: PercolatorExecutionService;
  keeper: PercolatorKeeper | null;
}

export function createPercolatorRouter(deps: PercolatorRouterDeps): Router {
  const router = Router();
  const { feed, execution, keeper } = deps;

  // ── GET /api/percolator/status ──────────────────────────────────────────
  router.get('/status', (_req: Request, res: Response) => {
    try {
      const state = feed.getMarketState();
      const price = feed.getPrice();
      if (!state) {
        res.json({ ok: true, data: { connected: false, price: null, state: null } });
        return;
      }
      res.json({
        ok: true,
        data: {
          connected: true,
          price,
          oraclePriceUsd: state.oraclePriceUsd,
          totalOpenInterest: state.totalOpenInterest.toString(),
          vault: state.vault.toString(),
          insuranceFund: state.insuranceFund.toString(),
          fundingRate: state.fundingRate.toString(),
          spreadBps: state.spreadBps,
          lastCrankSlot: state.lastCrankSlot.toString(),
          bestBid: state.bestBid ? { lpIndex: state.bestBid.lpIndex, priceUsd: state.bestBid.priceUsd } : null,
          bestAsk: state.bestAsk ? { lpIndex: state.bestAsk.lpIndex, priceUsd: state.bestAsk.priceUsd } : null,
          keeperRunning: !!keeper,
        },
      });
    } catch (err) {
      logger.warn({ err }, 'Percolator API: Failed to get status');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/percolator/positions ───────────────────────────────────────
  router.get('/positions', async (_req: Request, res: Response) => {
    try {
      const positions = await execution.getPositions();
      const serialized = positions.map((p) => ({
        accountIndex: p.accountIndex,
        capital: p.capital.toString(),
        positionSize: p.positionSize.toString(),
        entryPrice: p.entryPrice.toString(),
        pnl: p.pnl.toString(),
        fundingIndex: p.fundingIndex.toString(),
        owner: p.owner.toBase58(),
        side: p.positionSize > 0n ? 'long' : 'short',
      }));
      res.json({ ok: true, data: { positions: serialized, count: serialized.length } });
    } catch (err) {
      logger.warn({ err }, 'Percolator API: Failed to get positions');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/percolator/trade ──────────────────────────────────────────
  router.post('/trade', async (req: Request, res: Response) => {
    try {
      const { direction, size } = req.body as { direction?: string; size?: number };
      if (!direction || (direction !== 'long' && direction !== 'short')) {
        res.status(400).json({ ok: false, error: 'Required: direction ("long"|"short")' });
        return;
      }
      if (!size || typeof size !== 'number' || size <= 0) {
        res.status(400).json({ ok: false, error: 'Required: size (positive number in USD)' });
        return;
      }
      const result = direction === 'long'
        ? await execution.marketBuy({ size })
        : await execution.marketSell({ size });

      if (!result.success) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, data: { signature: result.signature, slot: result.slot, direction, size } });
    } catch (err) {
      logger.warn({ err }, 'Percolator API: Trade failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/percolator/deposit ────────────────────────────────────────
  router.post('/deposit', async (req: Request, res: Response) => {
    try {
      const { amount } = req.body as { amount?: number };
      if (!amount || typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({ ok: false, error: 'Required: amount (positive number in USDC)' });
        return;
      }
      const amountUnits = BigInt(Math.round(amount * 1_000_000));
      const result = await execution.deposit(amountUnits);

      if (!result.success) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, data: { signature: result.signature, slot: result.slot, amount } });
    } catch (err) {
      logger.warn({ err }, 'Percolator API: Deposit failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/percolator/withdraw ───────────────────────────────────────
  router.post('/withdraw', async (req: Request, res: Response) => {
    try {
      const { amount } = req.body as { amount?: number };
      if (!amount || typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({ ok: false, error: 'Required: amount (positive number in USDC)' });
        return;
      }
      const amountUnits = BigInt(Math.round(amount * 1_000_000));
      const result = await execution.withdraw(amountUnits);

      if (!result.success) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, data: { signature: result.signature, slot: result.slot, amount } });
    } catch (err) {
      logger.warn({ err }, 'Percolator API: Withdraw failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Percolator API routes initialized');
  return router;
}
