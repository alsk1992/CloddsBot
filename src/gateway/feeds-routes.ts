/**
 * Feeds Manager HTTP API Routes — REST endpoints for market data feeds.
 *
 * Mounted as an Express Router via httpGateway.setFeedsRouter().
 * All endpoints are prefixed with /api/feeds by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';

/** Minimal FeedManager shape (avoids importing the full module) */
export interface FeedManagerLike {
  searchMarkets(query: string, platform?: string): Promise<any[]>;
  getMarket(marketId: string, platform?: string): Promise<any | null>;
  getPrice(platform: string, marketId: string): Promise<number | null>;
  getOrderbook(platform: string, marketId: string): Promise<any | null>;
  getRecentNews(limit?: number): any[];
  searchNews(query: string): any[];
  getNewsForMarket(marketQuestion: string): any[];
  getCacheStats(): { hits: number; misses: number; size: number; hitRate: number };
  clearCache(): void;
  analyzeEdge(marketId: string, question: string, price: number, category: string): Promise<any>;
  calculateKelly(price: number, estimate: number, bankroll: number): { fullKelly: number; halfKelly: number; quarterKelly: number };
}

export interface FeedsRouterDeps {
  feeds: FeedManagerLike;
}

export function createFeedsRouter(deps: FeedsRouterDeps): Router {
  const router = Router();
  const { feeds } = deps;

  // ── GET /api/feeds/cache-stats ────────────────────────────────────────────
  // Cache hit/miss statistics
  router.get('/cache-stats', (_req: Request, res: Response) => {
    try {
      const stats = feeds.getCacheStats();
      res.json({ ok: true, data: stats });
    } catch (err) {
      logger.warn({ err }, 'Feeds API: Cache stats failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/feeds/cache/clear ───────────────────────────────────────────
  router.post('/cache/clear', (_req: Request, res: Response) => {
    try {
      feeds.clearCache();
      res.json({ ok: true, data: { cleared: true } });
    } catch (err) {
      logger.warn({ err }, 'Feeds API: Cache clear failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/feeds/search ─────────────────────────────────────────────────
  // Search markets across all feeds
  router.get('/search', async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      const platform = req.query.platform as string | undefined;
      if (!query) {
        res.status(400).json({ ok: false, error: 'Required query param: q' });
        return;
      }
      const markets = await feeds.searchMarkets(query, platform);
      res.json({ ok: true, data: { markets, count: markets.length } });
    } catch (err) {
      logger.warn({ err }, 'Feeds API: Search failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/feeds/news ───────────────────────────────────────────────────
  // Get recent news items
  router.get('/news', (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const news = feeds.getRecentNews(limit);
      res.json({ ok: true, data: { news, count: news.length } });
    } catch (err) {
      logger.warn({ err }, 'Feeds API: News failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/feeds/news/search ────────────────────────────────────────────
  router.get('/news/search', (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        res.status(400).json({ ok: false, error: 'Required query param: q' });
        return;
      }
      const news = feeds.searchNews(query);
      res.json({ ok: true, data: { news, count: news.length } });
    } catch (err) {
      logger.warn({ err }, 'Feeds API: News search failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/feeds/market/:marketId ───────────────────────────────────────
  // Get a single market by ID
  router.get('/market/:marketId', async (req: Request, res: Response) => {
    try {
      const platform = req.query.platform as string | undefined;
      const market = await feeds.getMarket(req.params.marketId, platform);
      if (!market) {
        res.status(404).json({ ok: false, error: `Market ${req.params.marketId} not found` });
        return;
      }
      res.json({ ok: true, data: market });
    } catch (err) {
      logger.warn({ err }, 'Feeds API: Get market failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/feeds/price/:platform/:marketId ──────────────────────────────
  // Get current price for a market
  router.get('/price/:platform/:marketId', async (req: Request, res: Response) => {
    try {
      const price = await feeds.getPrice(req.params.platform, req.params.marketId);
      res.json({ ok: true, data: { platform: req.params.platform, marketId: req.params.marketId, price } });
    } catch (err) {
      logger.warn({ err }, 'Feeds API: Get price failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── GET /api/feeds/orderbook/:platform/:marketId ──────────────────────────
  // Get orderbook for a market
  router.get('/orderbook/:platform/:marketId', async (req: Request, res: Response) => {
    try {
      const orderbook = await feeds.getOrderbook(req.params.platform, req.params.marketId);
      if (!orderbook) {
        res.status(404).json({ ok: false, error: 'Orderbook not available' });
        return;
      }
      res.json({ ok: true, data: orderbook });
    } catch (err) {
      logger.warn({ err }, 'Feeds API: Get orderbook failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/feeds/analyze-edge ──────────────────────────────────────────
  // Edge detection for a market position
  router.post('/analyze-edge', async (req: Request, res: Response) => {
    try {
      const { marketId, question, price, category } = req.body as Record<string, any>;
      if (!marketId || !question || price === undefined) {
        res.status(400).json({ ok: false, error: 'Required: marketId, question, price' });
        return;
      }
      const edge = await feeds.analyzeEdge(marketId, question, price, category || 'other');
      res.json({ ok: true, data: edge });
    } catch (err) {
      logger.warn({ err }, 'Feeds API: Analyze edge failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/feeds/kelly ─────────────────────────────────────────────────
  // Kelly criterion sizing
  router.post('/kelly', (req: Request, res: Response) => {
    try {
      const { price, estimate, bankroll } = req.body as Record<string, any>;
      if (price === undefined || estimate === undefined || bankroll === undefined) {
        res.status(400).json({ ok: false, error: 'Required: price, estimate, bankroll' });
        return;
      }
      const kelly = feeds.calculateKelly(price, estimate, bankroll);
      res.json({ ok: true, data: kelly });
    } catch (err) {
      logger.warn({ err }, 'Feeds API: Kelly calculation failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Feeds Manager API routes initialized');
  return router;
}
