/**
 * Memory LanceDB Backend Extension
 * Provides vector storage using LanceDB for long-term memory
 *
 * LanceDB is a serverless vector database with native embedding support
 */

import { logger } from '../../utils/logger';
import { generateId as generateSecureId } from '../../utils/id';
import { getTransformersPipeline } from '../../embeddings/index';
import * as path from 'path';

export interface LanceDBConfig {
  enabled: boolean;
  /** Database directory path */
  dbPath?: string;
  /** Table name for memories */
  tableName?: string;
  /** Embedding model to use */
  embeddingModel?: 'openai' | 'cohere' | 'local';
  /** OpenAI API key for embeddings */
  openaiApiKey?: string;
  /** Cohere API key for embeddings */
  cohereApiKey?: string;
  /** Local embedding model path */
  localModelPath?: string;
  /** Embedding dimensions */
  dimensions?: number;
}

export interface MemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  timestamp: number;
  source: string;
  importance: number;
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;
  distance: number;
}

export interface LanceDBExtension {
  /** Initialize the database */
  initialize(): Promise<void>;
  /** Add a memory entry */
  addMemory(content: string, metadata?: Record<string, unknown>, source?: string): Promise<string>;
  /** Search memories by vector similarity */
  searchMemories(query: string, limit?: number, filter?: Record<string, unknown>): Promise<SearchResult[]>;
  /** Get memory by ID */
  getMemory(id: string): Promise<MemoryEntry | null>;
  /** Update memory importance */
  updateImportance(id: string, importance: number): Promise<void>;
  /** Delete memory */
  deleteMemory(id: string): Promise<void>;
  /** Get all memories for a source */
  getMemoriesBySource(source: string, limit?: number): Promise<MemoryEntry[]>;
  /** Compact database (remove old/low-importance entries) */
  compact(maxEntries?: number, minImportance?: number): Promise<number>;
  /** Export memories to JSON */
  exportMemories(): Promise<MemoryEntry[]>;
  /** Import memories from JSON */
  importMemories(entries: MemoryEntry[]): Promise<number>;
  /** Close the database */
  close(): Promise<void>;
}

interface LanceTable {
  add(data: unknown[]): Promise<void>;
  search(query: number[]): { limit(n: number): { execute(): Promise<unknown[]> } };
  delete(filter: string): Promise<void>;
  countRows(): Promise<number>;
}

interface LanceDB {
  openTable(name: string): Promise<LanceTable>;
  createTable(name: string, data: unknown[]): Promise<LanceTable>;
  tableNames(): Promise<string[]>;
}

export async function createLanceDBExtension(config: LanceDBConfig): Promise<LanceDBExtension> {
  const dbPath = config.dbPath || path.join(process.env.HOME || '.', '.clodds', 'memory.lance');
  const tableName = config.tableName || 'memories';
  const dimensions = config.dimensions || (config.embeddingModel === 'local' ? 384 : 1536);

  let db: LanceDB | null = null;
  let table: LanceTable | null = null;

  async function getEmbedding(text: string): Promise<number[]> {
    switch (config.embeddingModel) {
      case 'openai':
        return getOpenAIEmbedding(text);
      case 'cohere':
        return getCohereEmbedding(text);
      case 'local':
        return getLocalEmbedding(text);
      default:
        // Fallback to simple hash-based pseudo-embedding
        return getSimpleEmbedding(text);
    }
  }

  async function getOpenAIEmbedding(text: string): Promise<number[]> {
    if (!config.openaiApiKey) {
      throw new Error('OpenAI API key required for embeddings');
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  }

  async function getCohereEmbedding(text: string): Promise<number[]> {
    if (!config.cohereApiKey) {
      throw new Error('Cohere API key required for embeddings');
    }

    const response = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.cohereApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'embed-english-v3.0',
        texts: [text],
        input_type: 'search_query',
      }),
    });

    if (!response.ok) {
      throw new Error(`Cohere API error: ${response.status}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings[0];
  }

  async function getLocalEmbedding(text: string): Promise<number[]> {
    try {
      const pipe = await getTransformersPipeline();
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
    } catch (error) {
      logger.warn({ error }, 'Transformers.js failed, falling back to hash embeddings');
      return getSimpleEmbedding(text);
    }
  }

  function getSimpleEmbedding(text: string): number[] {
    // Simple hash-based pseudo-embedding for fallback
    const embedding = new Array(dimensions).fill(0);
    const words = text.toLowerCase().split(/\s+/);

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      for (let j = 0; j < word.length; j++) {
        const idx = (word.charCodeAt(j) * (i + 1) * (j + 1)) % dimensions;
        embedding[idx] += 1 / (i + 1);
      }
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0)) || 1;
    return embedding.map((v) => v / norm);
  }

  function generateId(): string {
    return generateSecureId('mem');
  }

  const extension: LanceDBExtension = {
    async initialize(): Promise<void> {
      try {
        // Dynamic import for LanceDB
        const lancedb = await import('lancedb').catch(() => null);

        if (!lancedb) {
          logger.warn('LanceDB not installed, using in-memory fallback');
          // Create in-memory fallback
          const memories = new Map<string, MemoryEntry>();

          (db as unknown) = {
            async openTable() {
              return table;
            },
            async createTable(name: string, data: unknown[]) {
              for (const entry of data as MemoryEntry[]) {
                memories.set(entry.id, entry);
              }
              return table;
            },
            async tableNames() {
              return [tableName];
            },
          };

          table = {
            async add(data: unknown[]) {
              for (const entry of data as MemoryEntry[]) {
                memories.set(entry.id, entry);
              }
            },
            search(query: number[]) {
              return {
                limit(n: number) {
                  return {
                    async execute() {
                      // Simple cosine similarity search
                      const results: Array<{ entry: MemoryEntry; distance: number }> = [];
                      for (const entry of memories.values()) {
                        if (!entry.embedding) continue;
                        const similarity = cosineSimilarity(query, entry.embedding);
                        results.push({ entry, distance: 1 - similarity });
                      }
                      results.sort((a, b) => a.distance - b.distance);
                      return results.slice(0, n);
                    },
                  };
                },
              };
            },
            async delete(filter: string) {
              const match = filter.match(/id\s*=\s*'([^']+)'/);
              if (match) {
                memories.delete(match[1]);
              }
            },
            async countRows() {
              return memories.size;
            },
          } as LanceTable;

          return;
        }

        // Real LanceDB initialization
        db = await lancedb.connect(dbPath);
        const tables = await db!.tableNames();

        if (tables.includes(tableName)) {
          table = await db!.openTable(tableName);
        } else {
          // Create table with initial schema
          table = await db!.createTable(tableName, [
            {
              id: 'init',
              content: '',
              embedding: new Array(dimensions).fill(0),
              metadata: {},
              timestamp: Date.now(),
              source: 'system',
              importance: 0,
            },
          ]);
        }

        logger.info({ dbPath, tableName }, 'LanceDB initialized');
      } catch (error) {
        logger.error({ error }, 'Failed to initialize LanceDB');
        throw error;
      }
    },

    async addMemory(
      content: string,
      metadata?: Record<string, unknown>,
      source?: string
    ): Promise<string> {
      if (!table) throw new Error('Database not initialized');

      const id = generateId();
      const embedding = await getEmbedding(content);

      const entry: MemoryEntry = {
        id,
        content,
        embedding,
        metadata: metadata || {},
        timestamp: Date.now(),
        source: source || 'unknown',
        importance: 1.0,
      };

      await table.add([entry]);
      logger.debug({ id, source }, 'Added memory');

      return id;
    },

    async searchMemories(
      query: string,
      limit?: number,
      filter?: Record<string, unknown>
    ): Promise<SearchResult[]> {
      if (!table) throw new Error('Database not initialized');

      const queryEmbedding = await getEmbedding(query);
      const results = await table.search(queryEmbedding).limit(limit || 10).execute();

      return (results as Array<{ entry?: MemoryEntry; distance?: number } & MemoryEntry>).map((r) => ({
        entry: r.entry || (r as MemoryEntry),
        score: 1 - (r.distance || 0),
        distance: r.distance || 0,
      }));
    },

    async getMemory(id: string): Promise<MemoryEntry | null> {
      if (!table) throw new Error('Database not initialized');

      // LanceDB doesn't have direct get by ID, search with filter
      const results = await table.search(new Array(dimensions).fill(0)).limit(1000).execute();
      const found = (results as MemoryEntry[]).find((r) => r.id === id);
      return found || null;
    },

    async updateImportance(id: string, importance: number): Promise<void> {
      if (!table) throw new Error('Database not initialized');

      const memory = await extension.getMemory(id);
      if (memory) {
        memory.importance = importance;
        await table.delete(`id = '${id}'`);
        await table.add([memory]);
      }
    },

    async deleteMemory(id: string): Promise<void> {
      if (!table) throw new Error('Database not initialized');
      await table.delete(`id = '${id}'`);
    },

    async getMemoriesBySource(source: string, limit?: number): Promise<MemoryEntry[]> {
      if (!table) throw new Error('Database not initialized');

      const results = await table.search(new Array(dimensions).fill(0)).limit(limit || 100).execute();
      return (results as MemoryEntry[]).filter((r) => r.source === source);
    },

    async compact(maxEntries?: number, minImportance?: number): Promise<number> {
      if (!table) throw new Error('Database not initialized');

      const max = maxEntries || 10000;
      const minImp = minImportance || 0.1;

      const count = await table.countRows();
      if (count <= max) return 0;

      // Get all entries, sort by importance and timestamp
      const results = await table.search(new Array(dimensions).fill(0)).limit(count).execute();
      const entries = (results as MemoryEntry[])
        .filter((r) => r.importance >= minImp)
        .sort((a, b) => b.importance - a.importance || b.timestamp - a.timestamp)
        .slice(0, max);

      // Delete entries not in the kept list
      const keepIds = new Set(entries.map((e) => e.id));
      let deleted = 0;

      for (const entry of results as MemoryEntry[]) {
        if (!keepIds.has(entry.id)) {
          await table.delete(`id = '${entry.id}'`);
          deleted++;
        }
      }

      logger.info({ deleted, remaining: max }, 'Compacted memory database');
      return deleted;
    },

    async exportMemories(): Promise<MemoryEntry[]> {
      if (!table) throw new Error('Database not initialized');

      const count = await table.countRows();
      const results = await table.search(new Array(dimensions).fill(0)).limit(count).execute();
      return results as MemoryEntry[];
    },

    async importMemories(entries: MemoryEntry[]): Promise<number> {
      if (!table) throw new Error('Database not initialized');

      await table.add(entries);
      return entries.length;
    },

    async close(): Promise<void> {
      // LanceDB doesn't require explicit close
      db = null;
      table = null;
      logger.info('LanceDB closed');
    },
  };

  return extension;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB)) || 0;
}
