/**
 * Claude-powered summarization for context compaction
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';

export type SummarizerFn = (text: string, maxTokens: number) => Promise<string>;

interface ClaudeSummarizerOptions {
  apiKey?: string;
  model?: string;
}

const DEFAULT_SUMMARY_MODEL = process.env.CLODDS_SUMMARY_MODEL || 'claude-haiku-4-5-20251001';

export function createClaudeSummarizer(options: ClaudeSummarizerOptions = {}): SummarizerFn | undefined {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return undefined;

  const client = new Anthropic({ apiKey });
  const model = options.model || DEFAULT_SUMMARY_MODEL;

  return async (text: string, maxTokens: number): Promise<string> => {
    const targetTokens = Math.max(128, Math.min(1200, Math.floor(maxTokens)));

    try {
      const response = await client.messages.create({
        model,
        max_tokens: targetTokens,
        system:
          'You are a summarizer that compresses conversation history for future context. '
          + 'Preserve key facts, decisions, constraints, and open questions. Be concise and structured.',
        messages: [
          {
            role: 'user',
            content:
              'Summarize the following conversation history for future context. '
              + 'Focus on durable facts and decisions.\n\n'
              + text,
          },
        ],
      });

      const summary = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as Anthropic.TextBlock).text)
        .join('\n')
        .trim();

      return summary || '[Summary unavailable]';
    } catch (error) {
      logger.warn({ error }, 'Claude summarizer failed, falling back to naive summary');
      // Naive fallback: truncate the input.
      const maxChars = targetTokens * 4;
      return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[...truncated]` : text;
    }
  };
}
