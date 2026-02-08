/**
 * Embeddings HTTP API Routes — REST endpoints for text embedding and similarity search.
 *
 * Mounted as an Express Router via httpGateway.setEmbeddingsRouter().
 * All endpoints are prefixed with /api/embeddings by the caller.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import type { EmbeddingsService } from '../embeddings/index.js';

export interface EmbeddingsRouterDeps {
  embeddings: EmbeddingsService;
}

export function createEmbeddingsRouter(deps: EmbeddingsRouterDeps): Router {
  const router = Router();
  const { embeddings } = deps;

  // ── POST /api/embeddings/embed ────────────────────────────────────────────
  // Generate embedding for a single text
  router.post('/embed', async (req: Request, res: Response) => {
    try {
      const { text } = req.body as Record<string, any>;
      if (!text || typeof text !== 'string') {
        res.status(400).json({ ok: false, error: 'Required: text (string)' });
        return;
      }
      const vector = await embeddings.embed(text);
      res.json({ ok: true, data: { vector, dimensions: vector.length } });
    } catch (err) {
      logger.warn({ err }, 'Embeddings API: Embed failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/embeddings/embed-batch ──────────────────────────────────────
  // Generate embeddings for multiple texts
  router.post('/embed-batch', async (req: Request, res: Response) => {
    try {
      const { texts } = req.body as Record<string, any>;
      if (!Array.isArray(texts) || texts.length === 0) {
        res.status(400).json({ ok: false, error: 'Required: texts (string[])' });
        return;
      }
      const vectors = await embeddings.embedBatch(texts);
      res.json({ ok: true, data: { vectors, count: vectors.length } });
    } catch (err) {
      logger.warn({ err }, 'Embeddings API: Embed batch failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/embeddings/similarity ───────────────────────────────────────
  // Cosine similarity between two vectors
  router.post('/similarity', (req: Request, res: Response) => {
    try {
      const { a, b } = req.body as Record<string, any>;
      if (!Array.isArray(a) || !Array.isArray(b)) {
        res.status(400).json({ ok: false, error: 'Required: a (number[]), b (number[])' });
        return;
      }
      const score = embeddings.cosineSimilarity(a, b);
      res.json({ ok: true, data: { score } });
    } catch (err) {
      logger.warn({ err }, 'Embeddings API: Similarity failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/embeddings/search ───────────────────────────────────────────
  // Semantic search over a list of items
  router.post('/search', async (req: Request, res: Response) => {
    try {
      const { query, items, topK } = req.body as Record<string, any>;
      if (!query || typeof query !== 'string') {
        res.status(400).json({ ok: false, error: 'Required: query (string)' });
        return;
      }
      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ ok: false, error: 'Required: items (string[])' });
        return;
      }
      const results = await embeddings.search(
        query,
        items,
        (item: string) => item,
        topK,
      );
      res.json({ ok: true, data: { results, count: results.length } });
    } catch (err) {
      logger.warn({ err }, 'Embeddings API: Search failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── POST /api/embeddings/cache/clear ──────────────────────────────────────
  // Clear embedding cache
  router.post('/cache/clear', (_req: Request, res: Response) => {
    try {
      embeddings.clearCache();
      res.json({ ok: true, data: { cleared: true } });
    } catch (err) {
      logger.warn({ err }, 'Embeddings API: Clear cache failed');
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  logger.info('Embeddings API routes initialized');
  return router;
}
