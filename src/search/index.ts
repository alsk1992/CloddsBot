/**
 * Hybrid Search - Clawdbot-style Vector + BM25 retrieval
 *
 * Features:
 * - BM25 keyword search (catches exact matches vectors miss)
 * - Vector semantic search (catches meaning vectors excel at)
 * - Reciprocal Rank Fusion to combine results
 * - Configurable weights for each method
 */

import type { EmbeddingsService, SearchResult } from '../embeddings/index';

/** BM25 parameters */
const BM25_K1 = 1.5; // Term frequency saturation
const BM25_B = 0.75; // Length normalization

/** Search configuration */
export interface HybridSearchConfig {
  /** Weight for vector search results (0-1) */
  vectorWeight?: number;
  /** Weight for BM25 keyword results (0-1) */
  bm25Weight?: number;
  /** Minimum score threshold */
  minScore?: number;
}

const DEFAULT_CONFIG: HybridSearchConfig = {
  vectorWeight: 0.5,
  bm25Weight: 0.5,
  minScore: 0.1,
};

/** Tokenize text for BM25 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Calculate IDF for a term */
function calculateIDF(term: string, documents: string[][]): number {
  const docsWithTerm = documents.filter((doc) => doc.includes(term)).length;
  if (docsWithTerm === 0) return 0;
  return Math.log((documents.length - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1);
}

/** Calculate BM25 score for a document */
function bm25Score(
  queryTerms: string[],
  docTerms: string[],
  avgDocLen: number,
  idfScores: Map<string, number>
): number {
  let score = 0;
  const docLen = docTerms.length;

  for (const term of queryTerms) {
    const tf = docTerms.filter((t) => t === term).length;
    if (tf === 0) continue;

    const idf = idfScores.get(term) || 0;
    const tfNormalized =
      (tf * (BM25_K1 + 1)) /
      (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLen)));

    score += idf * tfNormalized;
  }

  return score;
}

/** BM25 search implementation */
export function bm25Search<T>(
  query: string,
  items: T[],
  getContent: (item: T) => string,
  topK: number = 5
): SearchResult<T>[] {
  if (items.length === 0) return [];

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  // Tokenize all documents
  const tokenizedDocs = items.map((item) => tokenize(getContent(item)));
  const avgDocLen =
    tokenizedDocs.reduce((sum, doc) => sum + doc.length, 0) / tokenizedDocs.length;

  // Calculate IDF for query terms
  const idfScores = new Map<string, number>();
  for (const term of queryTerms) {
    idfScores.set(term, calculateIDF(term, tokenizedDocs));
  }

  // Score all documents
  const results: SearchResult<T>[] = items.map((item, i) => ({
    item,
    score: bm25Score(queryTerms, tokenizedDocs[i], avgDocLen, idfScores),
  }));

  // Normalize scores to 0-1 range
  const maxScore = Math.max(...results.map((r) => r.score));
  if (maxScore > 0) {
    for (const result of results) {
      result.score /= maxScore;
    }
  }

  // Sort and return top K
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Reciprocal Rank Fusion - combines multiple ranked lists
 * RRF(d) = Σ 1/(k + rank(d)) where k=60 is standard
 */
function reciprocalRankFusion<T>(
  rankedLists: SearchResult<T>[][],
  weights: number[],
  k: number = 60
): SearchResult<T>[] {
  const scoreMap = new Map<T, number>();

  for (let listIdx = 0; listIdx < rankedLists.length; listIdx++) {
    const list = rankedLists[listIdx];
    const weight = weights[listIdx] || 1;

    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank].item;
      const rrfScore = weight / (k + rank + 1);
      scoreMap.set(item, (scoreMap.get(item) || 0) + rrfScore);
    }
  }

  // Convert to array and sort
  const results: SearchResult<T>[] = Array.from(scoreMap.entries()).map(
    ([item, score]) => ({ item, score })
  );
  results.sort((a, b) => b.score - a.score);

  return results;
}

export interface HybridSearchService {
  /** Hybrid search combining vector and BM25 */
  search<T>(
    query: string,
    items: T[],
    getContent: (item: T) => string,
    topK?: number
  ): Promise<SearchResult<T>[]>;

  /** BM25-only search (fast, keyword-based) */
  keywordSearch<T>(
    query: string,
    items: T[],
    getContent: (item: T) => string,
    topK?: number
  ): SearchResult<T>[];

  /** Vector-only search (semantic) */
  vectorSearch<T>(
    query: string,
    items: T[],
    getContent: (item: T) => string,
    topK?: number
  ): Promise<SearchResult<T>[]>;
}

export function createHybridSearchService(
  embeddings: EmbeddingsService,
  configInput?: Partial<HybridSearchConfig>
): HybridSearchService {
  const config: HybridSearchConfig = { ...DEFAULT_CONFIG, ...configInput };

  return {
    async search<T>(
      query: string,
      items: T[],
      getContent: (item: T) => string,
      topK: number = 5
    ): Promise<SearchResult<T>[]> {
      if (items.length === 0) return [];

      // Run both searches in parallel
      const [vectorResults, bm25Results] = await Promise.all([
        embeddings.search(query, items, getContent, topK * 2),
        Promise.resolve(bm25Search(query, items, getContent, topK * 2)),
      ]);

      // Combine with RRF
      const combined = reciprocalRankFusion(
        [vectorResults, bm25Results],
        [config.vectorWeight!, config.bm25Weight!]
      );

      // Filter by minimum score and return top K
      return combined
        .filter((r) => r.score >= config.minScore!)
        .slice(0, topK);
    },

    keywordSearch<T>(
      query: string,
      items: T[],
      getContent: (item: T) => string,
      topK: number = 5
    ): SearchResult<T>[] {
      return bm25Search(query, items, getContent, topK);
    },

    async vectorSearch<T>(
      query: string,
      items: T[],
      getContent: (item: T) => string,
      topK: number = 5
    ): Promise<SearchResult<T>[]> {
      return embeddings.search(query, items, getContent, topK);
    },
  };
}
