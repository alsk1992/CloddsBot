/** Optional Adanos crypto sentiment feed. */

import type { AltDataEvent } from '../types.js';
import { logger } from '../../../utils/logger.js';

const ENDPOINT = 'https://api.adanos.org/reddit/crypto/v1/trending';
const DEFAULT_INTERVAL_MS = 10_800_000; // 3 hours: 240 requests per 30-day month
const DEFAULT_LIMIT = 20;
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 2_147_483_647;

interface AdanosToken {
  symbol?: unknown;
  name?: unknown;
  sentiment_score?: unknown;
  buzz_score?: unknown;
  mentions?: unknown;
  trend?: unknown;
  bullish_pct?: unknown;
  bearish_pct?: unknown;
}

export interface AdanosFeed {
  start(): void;
  stop(): void;
  poll(): Promise<AltDataEvent[]>;
}

export function createAdanosFeed(
  onEvent: (event: AltDataEvent) => void,
  apiKey: string,
  intervalMs: number = DEFAULT_INTERVAL_MS,
  limit: number = DEFAULT_LIMIT,
): AdanosFeed {
  if (!apiKey.trim()) throw new Error('Adanos API key is required');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Adanos limit must be an integer from 1 to 100');
  if (!Number.isInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) {
    throw new Error(`Adanos interval must be an integer from ${MIN_INTERVAL_MS} to ${MAX_INTERVAL_MS} ms`);
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let generation = 0;
  const snapshots = new Map<string, string>();
  const activeControllers = new Set<AbortController>();

  async function fetchEvents(expectedGeneration?: number): Promise<AltDataEvent[]> {
    const controller = new AbortController();
    activeControllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const url = new URL(ENDPOINT);
      url.searchParams.set('limit', String(limit));
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'X-API-Key': apiKey },
      });
      if (!response.ok) {
        logger.debug({ status: response.status }, '[adanos] Sentiment fetch failed');
        return [];
      }

      const payload = await response.json() as unknown;
      if (!Array.isArray(payload)) {
        logger.debug('[adanos] Invalid sentiment response');
        return [];
      }
      if (expectedGeneration !== undefined && expectedGeneration !== generation) return [];

      const events: AltDataEvent[] = [];
      for (const item of payload as AdanosToken[]) {
        const symbol = typeof item.symbol === 'string' ? item.symbol.trim().toUpperCase() : '';
        const sentiment = typeof item.sentiment_score === 'number' && Number.isFinite(item.sentiment_score)
          ? Math.max(-1, Math.min(1, item.sentiment_score))
          : null;
        if (!/^[A-Z0-9]{1,20}$/.test(symbol) || sentiment === null) continue;

        const mentions = typeof item.mentions === 'number' && Number.isFinite(item.mentions) ? Math.max(0, item.mentions) : 0;
        const buzzScore = typeof item.buzz_score === 'number' && Number.isFinite(item.buzz_score) ? item.buzz_score : null;
        const signature = JSON.stringify([
          sentiment,
          mentions,
          buzzScore,
          item.trend,
          item.bullish_pct,
          item.bearish_pct,
        ]);
        if (snapshots.get(symbol) === signature) continue;
        snapshots.set(symbol, signature);

        const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : symbol;
        const event: AltDataEvent = {
          id: `adanos-${symbol}-${Date.now()}`,
          source: 'adanos_sentiment',
          timestamp: Date.now(),
          text: `${name} (${symbol}) crypto market sentiment`,
          numericValue: sentiment,
          categories: ['crypto', symbol.toLowerCase(), 'adanos'],
          meta: {
            symbol,
            mentions,
            buzzScore,
            trend: item.trend,
            bullishPct: item.bullish_pct,
            bearishPct: item.bearish_pct,
          },
        };
        if (expectedGeneration !== undefined && expectedGeneration !== generation) return [];
        events.push(event);
        onEvent(event);
      }
      return events;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') logger.debug({ error }, '[adanos] Sentiment poll failed');
      return [];
    } finally {
      clearTimeout(timeout);
      activeControllers.delete(controller);
    }
  }

  function poll(): Promise<AltDataEvent[]> {
    return fetchEvents(generation);
  }

  function start(): void {
    if (timer) return;
    const runGeneration = ++generation;
    fetchEvents(runGeneration).catch((error) => logger.error({ error }, '[adanos] Feed poll failed'));
    timer = setInterval(() => {
      fetchEvents(runGeneration).catch((error) => logger.error({ error }, '[adanos] Feed poll failed'));
    }, intervalMs);
    logger.info({ intervalMs, limit }, '[adanos] Feed started');
  }

  function stop(): void {
    generation++;
    if (timer) clearInterval(timer);
    timer = null;
    for (const controller of activeControllers) controller.abort();
    activeControllers.clear();
  }

  return { start, stop, poll };
}
