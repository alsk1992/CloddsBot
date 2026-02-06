/**
 * Embeddings Service - Vector embeddings for semantic search
 *
 * Features:
 * - Generate embeddings using OpenAI API (text-embedding-3-small)
 * - Local neural embeddings using transformers.js (no API key required)
 * - Store embeddings in SQLite for caching
 * - Cosine similarity search
 * - Batch embedding generation
 */

import { Database } from '../db/index';
import { logger } from '../utils/logger';
import { generateId as generateSecureId } from '../utils/id';

// Transformers.js types
export type Pipeline = (texts: string | string[], options?: { pooling?: string; normalize?: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;

// Lazy-loaded transformers.js pipeline
let localPipeline: Pipeline | null = null;
let pipelinePromise: Promise<Pipeline> | null = null;
const LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2'; // 384-dim, fast & good quality

/**
 * Initialize transformers.js pipeline (lazy-loaded, singleton)
 */
export async function getTransformersPipeline(): Promise<Pipeline> {
  if (localPipeline) return localPipeline;

  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    try {
      // Dynamic import to avoid loading heavy model at startup
      const { pipeline, env } = await import('@xenova/transformers');

      // Configure transformers.js
      env.cacheDir = './.transformers-cache';
      env.allowLocalModels = true;

      logger.info({ model: LOCAL_MODEL }, 'Loading local embedding model...');

      // Create feature-extraction pipeline
      const pipe = await pipeline('feature-extraction', LOCAL_MODEL, {
        quantized: true, // Use quantized model for faster inference
      });

      localPipeline = pipe as unknown as Pipeline;
      logger.info({ model: LOCAL_MODEL }, 'Local embedding model loaded');

      return localPipeline;
    } catch (error) {
      logger.error({ error }, 'Failed to load transformers.js model');
      throw error;
    }
  })();

  return pipelinePromise;
}

/** Embedding vector (array of floats) */
export type EmbeddingVector = number[];

/** Embedding entry stored in database */
export interface EmbeddingEntry {
  id: string;
  contentHash: string;
  content: string;
  vector: EmbeddingVector;
  createdAt: Date;
}

/** Search result with similarity score */
export interface SearchResult<T> {
  item: T;
  score: number;
}

/** Embedding provider configuration */
export interface EmbeddingConfig {
  /** Provider: 'openai' | 'voyage' | 'local' */
  provider: 'openai' | 'voyage' | 'local';
  /** API key for the provider */
  apiKey?: string;
  /** Model name (e.g., 'text-embedding-3-small') */
  model?: string;
  /** Vector dimensions */
  dimensions?: number;
}

export interface EmbeddingsService {
  /** Generate embedding for a single text */
  embed(text: string): Promise<EmbeddingVector>;

  /** Generate embeddings for multiple texts (batch) */
  embedBatch(texts: string[]): Promise<EmbeddingVector[]>;

  /** Calculate cosine similarity between two vectors */
  cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number;

  /** Find most similar items to a query */
  search<T>(
    query: string,
    items: T[],
    getContent: (item: T) => string,
    topK?: number
  ): Promise<SearchResult<T>[]>;

  /** Get cached embedding by content hash */
  getCached(contentHash: string): EmbeddingVector | null;

  /** Cache an embedding */
  cache(contentHash: string, content: string, vector: EmbeddingVector): void;
}

/** Default configuration - local first like Clawdbot */
const DEFAULT_CONFIG: EmbeddingConfig = {
  provider: 'local', // Default to local, no API key needed
  model: 'text-embedding-3-small', // Used if provider is 'openai'
  dimensions: 256, // Local embedding dimensions
};

/** Simple hash function for caching */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/** Database row for embedding cache */
interface EmbeddingRow {
  id: string;
  contentHash: string;
  content: string;
  vector: string; // JSON-stringified array
  createdAt: string;
}

export function createEmbeddingsService(
  db: Database,
  configInput?: Partial<EmbeddingConfig>
): EmbeddingsService {
  const config: EmbeddingConfig = { ...DEFAULT_CONFIG, ...configInput };

  // Initialize database table
  db.run(`
    CREATE TABLE IF NOT EXISTS embeddings_cache (
      id TEXT PRIMARY KEY,
      contentHash TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      vector TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_embeddings_hash
    ON embeddings_cache(contentHash)
  `);

  // In-memory cache for frequently accessed embeddings
  const memoryCache = new Map<string, EmbeddingVector>();

  /**
   * Generate embedding using OpenAI API
   */
  async function generateOpenAIEmbedding(text: string): Promise<EmbeddingVector> {
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key required for embeddings');
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data[0].embedding;
  }

  /**
   * Generate embeddings in batch using OpenAI API
   */
  async function generateOpenAIEmbeddingBatch(
    texts: string[]
  ): Promise<EmbeddingVector[]> {
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key required for embeddings');
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'text-embedding-3-small',
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  /**
   * Generate embedding using transformers.js (neural network, runs locally)
   * Uses all-MiniLM-L6-v2 model - 384 dimensions, good quality
   */
  async function generateTransformersEmbedding(text: string): Promise<EmbeddingVector> {
    const pipe = await getTransformersPipeline();

    // Generate embedding
    const output = await pipe(text, {
      pooling: 'mean',
      normalize: true,
    });

    // Convert Float32Array to regular array
    return Array.from(output.data);
  }

  /**
   * Generate embeddings in batch using transformers.js
   */
  async function generateTransformersEmbeddingBatch(texts: string[]): Promise<EmbeddingVector[]> {
    const pipe = await getTransformersPipeline();

    // Process texts in batches for efficiency
    const batchSize = 8;
    const results: EmbeddingVector[] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const outputs = await pipe(batch, {
        pooling: 'mean',
        normalize: true,
      });

      // Handle batch output - dims[0] is batch size, dims[1] is embedding size
      const embeddingSize = outputs.dims[1];
      for (let j = 0; j < batch.length; j++) {
        const start = j * embeddingSize;
        const embedding = Array.from(outputs.data.slice(start, start + embeddingSize));
        results.push(embedding);
      }
    }

    return results;
  }

  /**
   * Simple fallback embedding (bag-of-words) - used if transformers.js fails
   */
  function generateSimpleEmbedding(text: string): EmbeddingVector {
    const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const wordCounts = new Map<string, number>();

    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    const vectorSize = 384; // Match transformers.js dimension
    const vector = new Array(vectorSize).fill(0);

    wordCounts.forEach((count, word) => {
      const hash = Math.abs(hashContent(word).charCodeAt(0)) % vectorSize;
      vector[hash] += count;
    });

    // Normalize
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }

    return vector;
  }

  /**
   * Generate local embedding with transformers.js (fallback to simple if fails)
   */
  async function generateLocalEmbedding(text: string): Promise<EmbeddingVector> {
    try {
      return await generateTransformersEmbedding(text);
    } catch (error) {
      logger.warn({ error }, 'Transformers.js failed, using simple fallback');
      return generateSimpleEmbedding(text);
    }
  }

  /**
   * Generate local embeddings in batch
   */
  async function generateLocalEmbeddingBatch(texts: string[]): Promise<EmbeddingVector[]> {
    try {
      return await generateTransformersEmbeddingBatch(texts);
    } catch (error) {
      logger.warn({ error }, 'Transformers.js batch failed, using simple fallback');
      return texts.map(generateSimpleEmbedding);
    }
  }

  const service: EmbeddingsService = {
    async embed(text: string): Promise<EmbeddingVector> {
      const contentHash = hashContent(text);

      // Check memory cache
      if (memoryCache.has(contentHash)) {
        return memoryCache.get(contentHash)!;
      }

      // Check database cache
      const cached = this.getCached(contentHash);
      if (cached) {
        memoryCache.set(contentHash, cached);
        return cached;
      }

      // Generate new embedding
      // Auto-select provider like Clawdbot: local → OpenAI (if key) → local fallback
      let vector: EmbeddingVector;
      const hasOpenAIKey = !!(config.apiKey || process.env.OPENAI_API_KEY);

      if (config.provider === 'openai' && hasOpenAIKey) {
        vector = await generateOpenAIEmbedding(text);
        logger.debug('Generated OpenAI embedding');
      } else {
        // Default: local embeddings using transformers.js (no API key needed)
        vector = await generateLocalEmbedding(text);
        logger.debug('Generated local embedding using transformers.js');
      }

      // Cache the result
      this.cache(contentHash, text, vector);
      memoryCache.set(contentHash, vector);

      return vector;
    },

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
      // Check which texts need embedding
      const results: (EmbeddingVector | null)[] = texts.map((text) => {
        const contentHash = hashContent(text);
        if (memoryCache.has(contentHash)) {
          return memoryCache.get(contentHash)!;
        }
        const cached = this.getCached(contentHash);
        if (cached) {
          memoryCache.set(contentHash, cached);
          return cached;
        }
        return null;
      });

      // Find texts that need embedding
      const needsEmbedding: Array<{ index: number; text: string }> = [];
      for (let i = 0; i < texts.length; i++) {
        if (results[i] === null) {
          needsEmbedding.push({ index: i, text: texts[i] });
        }
      }

      if (needsEmbedding.length > 0) {
        let newEmbeddings: EmbeddingVector[];
        const hasOpenAIKey = !!(config.apiKey || process.env.OPENAI_API_KEY);

        if (config.provider === 'openai' && hasOpenAIKey) {
          newEmbeddings = await generateOpenAIEmbeddingBatch(
            needsEmbedding.map((item) => item.text)
          );
        } else {
          // Default: local embeddings using transformers.js
          newEmbeddings = await generateLocalEmbeddingBatch(
            needsEmbedding.map((item) => item.text)
          );
        }

        // Update results and cache
        for (let i = 0; i < needsEmbedding.length; i++) {
          const { index, text } = needsEmbedding[i];
          const vector = newEmbeddings[i];
          results[index] = vector;

          const contentHash = hashContent(text);
          this.cache(contentHash, text, vector);
          memoryCache.set(contentHash, vector);
        }
      }

      return results as EmbeddingVector[];
    },

    cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
      if (a.length !== b.length) {
        // Handle dimension mismatch (local vs API embeddings)
        const minLen = Math.min(a.length, b.length);
        a = a.slice(0, minLen);
        b = b.slice(0, minLen);
      }

      let dotProduct = 0;
      let magnitudeA = 0;
      let magnitudeB = 0;

      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        magnitudeA += a[i] * a[i];
        magnitudeB += b[i] * b[i];
      }

      magnitudeA = Math.sqrt(magnitudeA);
      magnitudeB = Math.sqrt(magnitudeB);

      if (magnitudeA === 0 || magnitudeB === 0) return 0;

      return dotProduct / (magnitudeA * magnitudeB);
    },

    async search<T>(
      query: string,
      items: T[],
      getContent: (item: T) => string,
      topK: number = 5
    ): Promise<SearchResult<T>[]> {
      if (items.length === 0) return [];

      // Get query embedding
      const queryEmbedding = await this.embed(query);

      // Get embeddings for all items
      const contents = items.map(getContent);
      const embeddings = await this.embedBatch(contents);

      // Calculate similarities
      const results: SearchResult<T>[] = items.map((item, i) => ({
        item,
        score: this.cosineSimilarity(queryEmbedding, embeddings[i]),
      }));

      // Sort by score descending and take top K
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, topK);
    },

    getCached(contentHash: string): EmbeddingVector | null {
      const rows = db.query<EmbeddingRow>(
        'SELECT * FROM embeddings_cache WHERE contentHash = ?',
        [contentHash]
      );

      if (rows.length === 0) return null;

      try {
        return JSON.parse(rows[0].vector);
      } catch {
        return null;
      }
    },

    cache(contentHash: string, content: string, vector: EmbeddingVector): void {
      const id = generateSecureId('emb');
      const vectorJson = JSON.stringify(vector);

      db.run(
        `
        INSERT OR REPLACE INTO embeddings_cache (id, contentHash, content, vector, createdAt)
        VALUES (?, ?, ?, ?, ?)
      `,
        [id, contentHash, content, vectorJson, new Date().toISOString()]
      );
    },
  };

  return service;
}
