/**
 * Usage Tracking - Clawdbot-style token and cost tracking
 *
 * Features:
 * - Track tokens per request (input/output)
 * - Cost estimation based on model pricing
 * - Per-user usage aggregation
 * - Session-level and daily totals
 * - Usage footer modes: off, tokens, full
 */

import { Database } from '../db/index';
import { logger } from '../utils/logger';

/** Model pricing (per 1M tokens) */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-5-20250514': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-haiku-3-5-20250514': { input: 0.25, output: 1.25 },
  // Fallback for unknown models
  default: { input: 3.0, output: 15.0 },
};

/** Usage record */
export interface UsageRecord {
  id: string;
  sessionId: string;
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  timestamp: Date;
}

/** Usage summary */
export interface UsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  byModel: Record<
    string,
    {
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cost: number;
    }
  >;
}

/** Footer display mode */
export type UsageFooterMode = 'off' | 'tokens' | 'full';

export interface UsageService {
  /** Record usage for a request */
  record(
    sessionId: string,
    userId: string,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): UsageRecord;

  /** Get usage for a session */
  getSessionUsage(sessionId: string): UsageSummary;

  /** Get usage for a user (optionally for today only) */
  getUserUsage(userId: string, todayOnly?: boolean): UsageSummary;

  /** Get total usage across all users */
  getTotalUsage(todayOnly?: boolean): UsageSummary;

  /** Format usage for footer display */
  formatFooter(record: UsageRecord, mode: UsageFooterMode): string;

  /** Format summary for display */
  formatSummary(summary: UsageSummary): string;

  /** Estimate cost for tokens */
  estimateCost(model: string, inputTokens: number, outputTokens: number): number;
}

/** Generate unique ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export function createUsageService(db: Database): UsageService {
  // Initialize database table
  db.run(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      estimated_cost REAL NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_usage_session
    ON usage_records(session_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_usage_user
    ON usage_records(user_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_usage_timestamp
    ON usage_records(timestamp)
  `);

  /** Calculate estimated cost */
  function calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }

  /** Build summary from records */
  function buildSummary(
    records: Array<{
      model: string;
      input_tokens: number;
      output_tokens: number;
      estimated_cost: number;
    }>
  ): UsageSummary {
    const summary: UsageSummary = {
      totalRequests: records.length,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      byModel: {},
    };

    for (const record of records) {
      summary.totalInputTokens += record.input_tokens;
      summary.totalOutputTokens += record.output_tokens;
      summary.totalTokens += record.input_tokens + record.output_tokens;
      summary.estimatedCost += record.estimated_cost;

      if (!summary.byModel[record.model]) {
        summary.byModel[record.model] = {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
        };
      }

      summary.byModel[record.model].requests++;
      summary.byModel[record.model].inputTokens += record.input_tokens;
      summary.byModel[record.model].outputTokens += record.output_tokens;
      summary.byModel[record.model].cost += record.estimated_cost;
    }

    return summary;
  }

  const service: UsageService = {
    record(sessionId, userId, model, inputTokens, outputTokens) {
      const totalTokens = inputTokens + outputTokens;
      const estimatedCost = calculateCost(model, inputTokens, outputTokens);
      const id = generateId();
      const timestamp = new Date();

      db.run(
        `INSERT INTO usage_records (id, session_id, user_id, model, input_tokens, output_tokens, total_tokens, estimated_cost, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          sessionId,
          userId,
          model,
          inputTokens,
          outputTokens,
          totalTokens,
          estimatedCost,
          timestamp.getTime(),
        ]
      );

      logger.debug(
        {
          sessionId,
          model,
          inputTokens,
          outputTokens,
          estimatedCost: estimatedCost.toFixed(6),
        },
        'Usage recorded'
      );

      return {
        id,
        sessionId,
        userId,
        model,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCost,
        timestamp,
      };
    },

    getSessionUsage(sessionId) {
      const records = db.query<{
        model: string;
        input_tokens: number;
        output_tokens: number;
        estimated_cost: number;
      }>('SELECT model, input_tokens, output_tokens, estimated_cost FROM usage_records WHERE session_id = ?', [
        sessionId,
      ]);

      return buildSummary(records);
    },

    getUserUsage(userId, todayOnly = false) {
      let query =
        'SELECT model, input_tokens, output_tokens, estimated_cost FROM usage_records WHERE user_id = ?';
      const params: (string | number)[] = [userId];

      if (todayOnly) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        query += ' AND timestamp >= ?';
        params.push(todayStart.getTime());
      }

      const records = db.query<{
        model: string;
        input_tokens: number;
        output_tokens: number;
        estimated_cost: number;
      }>(query, params);

      return buildSummary(records);
    },

    getTotalUsage(todayOnly = false) {
      let query =
        'SELECT model, input_tokens, output_tokens, estimated_cost FROM usage_records';
      const params: number[] = [];

      if (todayOnly) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        query += ' WHERE timestamp >= ?';
        params.push(todayStart.getTime());
      }

      const records = db.query<{
        model: string;
        input_tokens: number;
        output_tokens: number;
        estimated_cost: number;
      }>(query, params);

      return buildSummary(records);
    },

    formatFooter(record, mode) {
      if (mode === 'off') {
        return '';
      }

      if (mode === 'tokens') {
        return `\n\n_${record.totalTokens.toLocaleString()} tokens_`;
      }

      // Full mode
      const modelShort = record.model.split('-').slice(1, 3).join('-');
      return `\n\n_${modelShort} • ${record.inputTokens.toLocaleString()}→${record.outputTokens.toLocaleString()} tokens • $${record.estimatedCost.toFixed(4)}_`;
    },

    formatSummary(summary) {
      const lines = [
        `**Usage Summary**`,
        `Requests: ${summary.totalRequests}`,
        `Input tokens: ${summary.totalInputTokens.toLocaleString()}`,
        `Output tokens: ${summary.totalOutputTokens.toLocaleString()}`,
        `Total tokens: ${summary.totalTokens.toLocaleString()}`,
        `Estimated cost: $${summary.estimatedCost.toFixed(4)}`,
      ];

      if (Object.keys(summary.byModel).length > 1) {
        lines.push('', '**By Model:**');
        for (const [model, data] of Object.entries(summary.byModel)) {
          const modelShort = model.split('-').slice(1, 3).join('-');
          lines.push(
            `• ${modelShort}: ${data.requests} requests, ${data.inputTokens + data.outputTokens} tokens, $${data.cost.toFixed(4)}`
          );
        }
      }

      return lines.join('\n');
    },

    estimateCost(model, inputTokens, outputTokens) {
      return calculateCost(model, inputTokens, outputTokens);
    },
  };

  return service;
}
