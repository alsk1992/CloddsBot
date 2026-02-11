/**
 * Fear & Greed Index Feed
 *
 * Polls the Alternative.me Crypto Fear & Greed Index (free, no API key).
 * Returns a value from 0 (Extreme Fear) to 100 (Extreme Greed).
 */

import type { AltDataEvent } from '../types.js';
import { logger } from '../../../utils/logger.js';

const API_URL = 'https://api.alternative.me/fng/?limit=1';
const DEFAULT_INTERVAL_MS = 3_600_000; // 1 hour

export interface FearGreedFeed {
  start(): void;
  stop(): void;
  /** Force a poll right now */
  poll(): Promise<AltDataEvent | null>;
}

export function createFearGreedFeed(
  onEvent: (event: AltDataEvent) => void,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): FearGreedFeed {
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastValue: number | null = null;

  async function poll(): Promise<AltDataEvent | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(API_URL, { signal: controller.signal });

      if (!res.ok) {
        logger.warn({ status: res.status }, '[fear-greed] API returned non-OK');
        return null;
      }

      let json: { data?: Array<{ value: string; value_classification: string; timestamp: string }> };
      try {
        json = (await res.json()) as typeof json;
      } catch {
        logger.debug('[fear-greed] Invalid JSON response');
        return null;
      }

      const entry = json.data?.[0];
      if (!entry) return null;

      const value = parseInt(entry.value, 10);
      if (isNaN(value)) return null;

      // Skip if unchanged
      if (value === lastValue) return null;
      lastValue = value;

      const event: AltDataEvent = {
        id: `fng-${entry.timestamp}`,
        source: 'fear_greed',
        timestamp: Date.now(),
        text: `Crypto Fear & Greed Index: ${value} (${entry.value_classification})`,
        numericValue: value,
        categories: ['crypto', 'sentiment'],
        meta: { classification: entry.value_classification },
      };

      onEvent(event);
      return event;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        logger.warn({ error }, '[fear-greed] Poll failed');
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  function start(): void {
    if (timer) return;
    // Initial poll
    poll().catch((err) => { logger.error({ error: err }, '[fear-greed] Feed poll failed'); });
    timer = setInterval(() => { poll().catch((err) => { logger.error({ error: err }, '[fear-greed] Feed poll failed'); }); }, intervalMs);
    logger.info({ intervalMs }, '[fear-greed] Feed started');
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, poll };
}
