/**
 * Memory Service - Clawdbot-style persistent memory and daily logs
 *
 * Features:
 * - Per-user memory (facts, preferences, notes)
 * - Daily conversation logs
 * - Session summaries
 * - Searchable context retrieval
 */

import * as fs from 'fs';
import * as path from 'path';
import { Database } from '../db/index';
import { logger } from '../utils/logger';
import { createEmbeddingsService, EmbeddingsService, EmbeddingConfig } from '../embeddings/index';
import { createHybridSearchService, HybridSearchService } from '../search/index';

// Re-export context management
export * from './context';

/** Memory entry types */
export type MemoryType = 'fact' | 'preference' | 'note' | 'summary' | 'context';

/** A single memory entry */
export interface MemoryEntry {
  id: string;
  userId: string;
  channel: string;
  type: MemoryType;
  key: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

/** Daily log entry */
export interface DailyLogEntry {
  id: string;
  userId: string;
  channel: string;
  date: string; // YYYY-MM-DD
  summary: string;
  messageCount: number;
  topics: string[];
  createdAt: Date;
}

/** Database row types */
interface MemoryRow {
  id: string;
  userId: string;
  channel: string;
  type: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

interface DailyLogRow {
  id: string;
  userId: string;
  channel: string;
  date: string;
  summary: string;
  messageCount: number;
  topics: string;
  createdAt: string;
}

export interface MemoryService {
  /** Store a memory entry */
  remember(
    userId: string,
    channel: string,
    type: MemoryType,
    key: string,
    value: string,
    expiresInHours?: number
  ): void;

  /** Retrieve a memory by key */
  recall(userId: string, channel: string, key: string): MemoryEntry | null;

  /** Retrieve memories by type */
  recallByType(userId: string, channel: string, type: MemoryType): MemoryEntry[];

  /** Retrieve all memories for a user */
  recallAll(userId: string, channel: string): MemoryEntry[];

  /** Search memories by value content (keyword) */
  search(userId: string, channel: string, query: string): MemoryEntry[];

  /** Semantic search using vector embeddings */
  semanticSearch(
    userId: string,
    channel: string,
    query: string,
    topK?: number
  ): Promise<Array<{ entry: MemoryEntry; score: number }>>;

  /** Forget (delete) a memory by key */
  forget(userId: string, channel: string, key: string): boolean;

  /** Forget all memories of a type */
  forgetByType(userId: string, channel: string, type: MemoryType): number;

  /** Log a daily summary */
  logDaily(
    userId: string,
    channel: string,
    date: string,
    summary: string,
    messageCount: number,
    topics: string[]
  ): void;

  /** Get daily log for a date */
  getDailyLog(userId: string, channel: string, date: string): DailyLogEntry | null;

  /** Get recent daily logs */
  getRecentLogs(userId: string, channel: string, days?: number): DailyLogEntry[];

  /** Build context string from memory for the agent */
  buildContextString(userId: string, channel: string): string;

  /** Clean up expired memories */
  cleanup(): number;
}

/** Generate a unique ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/** Get today's date in YYYY-MM-DD format */
function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createMemoryService(
  db: Database,
  memoryDir?: string,
  embeddingConfig?: Partial<EmbeddingConfig>
): MemoryService {
  // Initialize embeddings service for semantic search
  const embeddings = createEmbeddingsService(db, embeddingConfig);
  // Initialize hybrid search (vector + BM25) - Clawdbot style
  const hybridSearch = createHybridSearchService(embeddings);
  // Initialize database tables
  db.run(`
    CREATE TABLE IF NOT EXISTS user_memory (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      channel TEXT NOT NULL,
      type TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      expiresAt TEXT,
      UNIQUE(userId, channel, key)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_user_channel
    ON user_memory(userId, channel)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_type
    ON user_memory(userId, channel, type)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_logs (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      channel TEXT NOT NULL,
      date TEXT NOT NULL,
      summary TEXT NOT NULL,
      messageCount INTEGER NOT NULL,
      topics TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      UNIQUE(userId, channel, date)
    )
  `);

  // Set up memory directory for file-based storage (optional)
  if (memoryDir) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  // Schedule cleanup every hour
  setInterval(() => {
    const cleaned = service.cleanup();
    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up expired memories');
    }
  }, 60 * 60 * 1000);

  const service: MemoryService = {
    remember(userId, channel, type, key, value, expiresInHours) {
      const now = new Date();
      const expiresAt = expiresInHours
        ? new Date(now.getTime() + expiresInHours * 60 * 60 * 1000)
        : null;

      // Upsert memory entry
      db.run(
        `
        INSERT INTO user_memory (id, userId, channel, type, key, value, createdAt, updatedAt, expiresAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(userId, channel, key) DO UPDATE SET
          type = excluded.type,
          value = excluded.value,
          updatedAt = excluded.updatedAt,
          expiresAt = excluded.expiresAt
      `,
        [
          generateId(),
          userId,
          channel,
          type,
          key,
          value,
          now.toISOString(),
          now.toISOString(),
          expiresAt?.toISOString() || null,
        ]
      );

      logger.debug({ userId, channel, type, key }, 'Memory stored');
    },

    recall(userId, channel, key) {
      const rows = db.query<MemoryRow>(
        'SELECT * FROM user_memory WHERE userId = ? AND channel = ? AND key = ?',
        [userId, channel, key]
      );

      if (rows.length === 0) return null;

      const row = rows[0];

      // Check expiry
      if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
        this.forget(userId, channel, key);
        return null;
      }

      return {
        id: row.id,
        userId: row.userId,
        channel: row.channel,
        type: row.type as MemoryType,
        key: row.key,
        value: row.value,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
        expiresAt: row.expiresAt ? new Date(row.expiresAt) : undefined,
      };
    },

    recallByType(userId, channel, type) {
      const rows = db.query<MemoryRow>(
        'SELECT * FROM user_memory WHERE userId = ? AND channel = ? AND type = ? ORDER BY updatedAt DESC',
        [userId, channel, type]
      );

      const now = new Date();
      return rows
        .filter((row) => !row.expiresAt || new Date(row.expiresAt) > now)
        .map((row) => ({
          id: row.id,
          userId: row.userId,
          channel: row.channel,
          type: row.type as MemoryType,
          key: row.key,
          value: row.value,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
          expiresAt: row.expiresAt ? new Date(row.expiresAt) : undefined,
        }));
    },

    recallAll(userId, channel) {
      const rows = db.query<MemoryRow>(
        'SELECT * FROM user_memory WHERE userId = ? AND channel = ? ORDER BY updatedAt DESC',
        [userId, channel]
      );

      const now = new Date();
      return rows
        .filter((row) => !row.expiresAt || new Date(row.expiresAt) > now)
        .map((row) => ({
          id: row.id,
          userId: row.userId,
          channel: row.channel,
          type: row.type as MemoryType,
          key: row.key,
          value: row.value,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
          expiresAt: row.expiresAt ? new Date(row.expiresAt) : undefined,
        }));
    },

    search(userId, channel, query) {
      const queryLower = query.toLowerCase();
      const rows = db.query<MemoryRow>(
        'SELECT * FROM user_memory WHERE userId = ? AND channel = ? AND (LOWER(key) LIKE ? OR LOWER(value) LIKE ?) ORDER BY updatedAt DESC',
        [userId, channel, `%${queryLower}%`, `%${queryLower}%`]
      );

      const now = new Date();
      return rows
        .filter((row) => !row.expiresAt || new Date(row.expiresAt) > now)
        .map((row) => ({
          id: row.id,
          userId: row.userId,
          channel: row.channel,
          type: row.type as MemoryType,
          key: row.key,
          value: row.value,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
          expiresAt: row.expiresAt ? new Date(row.expiresAt) : undefined,
        }));
    },

    async semanticSearch(userId, channel, query, topK = 5) {
      // Get all memories for user
      const allMemories = this.recallAll(userId, channel);
      if (allMemories.length === 0) return [];

      // Use hybrid search (vector + BM25) - Clawdbot style
      // This catches both semantic similarity AND exact keyword matches
      const results = await hybridSearch.search(
        query,
        allMemories,
        (entry) => `${entry.key}: ${entry.value}`,
        topK
      );

      return results.map((r) => ({
        entry: r.item,
        score: r.score,
      }));
    },

    forget(userId, channel, key) {
      // Check if entry exists first
      const existing = this.recall(userId, channel, key);
      if (!existing) return false;

      db.run(
        'DELETE FROM user_memory WHERE userId = ? AND channel = ? AND key = ?',
        [userId, channel, key]
      );
      return true;
    },

    forgetByType(userId, channel, type) {
      // Count before deleting
      const existing = this.recallByType(userId, channel, type);
      const count = existing.length;

      db.run(
        'DELETE FROM user_memory WHERE userId = ? AND channel = ? AND type = ?',
        [userId, channel, type]
      );
      return count;
    },

    logDaily(userId, channel, date, summary, messageCount, topics) {
      const now = new Date();

      db.run(
        `
        INSERT INTO daily_logs (id, userId, channel, date, summary, messageCount, topics, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(userId, channel, date) DO UPDATE SET
          summary = excluded.summary,
          messageCount = excluded.messageCount,
          topics = excluded.topics
      `,
        [
          generateId(),
          userId,
          channel,
          date,
          summary,
          messageCount,
          JSON.stringify(topics),
          now.toISOString(),
        ]
      );

      logger.debug({ userId, channel, date }, 'Daily log saved');
    },

    getDailyLog(userId, channel, date) {
      const rows = db.query<DailyLogRow>(
        'SELECT * FROM daily_logs WHERE userId = ? AND channel = ? AND date = ?',
        [userId, channel, date]
      );

      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        id: row.id,
        userId: row.userId,
        channel: row.channel,
        date: row.date,
        summary: row.summary,
        messageCount: row.messageCount,
        topics: JSON.parse(row.topics) as string[],
        createdAt: new Date(row.createdAt),
      };
    },

    getRecentLogs(userId, channel, days = 7) {
      const rows = db.query<DailyLogRow>(
        'SELECT * FROM daily_logs WHERE userId = ? AND channel = ? ORDER BY date DESC LIMIT ?',
        [userId, channel, days]
      );

      return rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        channel: row.channel,
        date: row.date,
        summary: row.summary,
        messageCount: row.messageCount,
        topics: JSON.parse(row.topics) as string[],
        createdAt: new Date(row.createdAt),
      }));
    },

    buildContextString(userId, channel) {
      const parts: string[] = [];

      // Add user facts
      const facts = this.recallByType(userId, channel, 'fact');
      if (facts.length > 0) {
        parts.push('## User Facts');
        for (const fact of facts.slice(0, 10)) {
          parts.push(`- ${fact.key}: ${fact.value}`);
        }
      }

      // Add preferences
      const prefs = this.recallByType(userId, channel, 'preference');
      if (prefs.length > 0) {
        parts.push('\n## User Preferences');
        for (const pref of prefs.slice(0, 10)) {
          parts.push(`- ${pref.key}: ${pref.value}`);
        }
      }

      // Add recent notes
      const notes = this.recallByType(userId, channel, 'note');
      if (notes.length > 0) {
        parts.push('\n## Recent Notes');
        for (const note of notes.slice(0, 5)) {
          parts.push(`- ${note.key}: ${note.value}`);
        }
      }

      // Add recent daily summaries
      const logs = this.getRecentLogs(userId, channel, 3);
      if (logs.length > 0) {
        parts.push('\n## Recent Conversation Summaries');
        for (const log of logs) {
          parts.push(`- ${log.date}: ${log.summary}`);
        }
      }

      return parts.join('\n');
    },

    cleanup() {
      // Count expired entries first
      const expiredRows = db.query<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM user_memory WHERE expiresAt IS NOT NULL AND expiresAt < datetime("now")'
      );
      const count = expiredRows[0]?.cnt || 0;

      if (count > 0) {
        db.run(
          'DELETE FROM user_memory WHERE expiresAt IS NOT NULL AND expiresAt < datetime("now")'
        );
      }
      return count;
    },
  };

  return service;
}
