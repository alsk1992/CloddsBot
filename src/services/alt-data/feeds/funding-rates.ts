/**
 * Funding Rates Feed
 *
 * Polls Binance Futures public API for perpetual funding rates (free, no key).
 * Extreme funding rates signal crowded positioning → contrarian signal.
 */

import type { AltDataEvent } from '../types.js';
import { logger } from '../../../utils/logger.js';

const API_URL = 'https://fapi.binance.com/fapi/v1/premiumIndex';
const DEFAULT_INTERVAL_MS = 60_000; // 1 min
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

export interface FundingRatesFeed {
  start(): void;
  stop(): void;
  poll(): Promise<AltDataEvent[]>;
}

interface PremiumIndexEntry {
  symbol: string;
  lastFundingRate: string;
  nextFundingTime: number;
  markPrice: string;
}

export function createFundingRatesFeed(
  onEvent: (event: AltDataEvent) => void,
  symbols: string[] = DEFAULT_SYMBOLS,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): FundingRatesFeed {
  let timer: ReturnType<typeof setInterval> | null = null;
  const lastRates = new Map<string, number>();

  async function poll(): Promise<AltDataEvent[]> {
    const events: AltDataEvent[] = [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(API_URL, { signal: controller.signal });

      if (!res.ok) {
        logger.warn({ status: res.status }, '[funding-rates] API returned non-OK');
        return events;
      }

      let data: PremiumIndexEntry[];
      try {
        data = (await res.json()) as PremiumIndexEntry[];
      } catch {
        logger.debug('[funding-rates] Invalid JSON response');
        return events;
      }

      for (const entry of data) {
        if (!symbols.includes(entry.symbol)) continue;

        const rate = parseFloat(entry.lastFundingRate);
        if (isNaN(rate)) continue;

        // Only emit when rate changes meaningfully (> 0.001% shift)
        const prev = lastRates.get(entry.symbol);
        if (prev !== undefined && Math.abs(rate - prev) < 0.00001) continue;
        lastRates.set(entry.symbol, rate);

        const ratePct = (rate * 100).toFixed(4);
        const direction = rate > 0 ? 'longs paying shorts' : rate < 0 ? 'shorts paying longs' : 'neutral';

        const event: AltDataEvent = {
          id: `fr-${entry.symbol}-${Date.now()}`,
          source: 'funding_rate',
          timestamp: Date.now(),
          text: `${entry.symbol} funding rate: ${ratePct}% (${direction})`,
          numericValue: rate * 100, // Convert to percentage
          categories: ['crypto', 'funding'],
          meta: {
            symbol: entry.symbol,
            markPrice: entry.markPrice,
            nextFundingTime: entry.nextFundingTime,
          },
        };

        events.push(event);
        onEvent(event);
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        logger.warn({ error }, '[funding-rates] Poll failed');
      }
    } finally {
      clearTimeout(timeout);
    }

    return events;
  }

  function start(): void {
    if (timer) return;
    poll().catch((err) => { logger.error({ error: err }, '[funding-rates] Feed poll failed'); });
    timer = setInterval(() => { poll().catch((err) => { logger.error({ error: err }, '[funding-rates] Feed poll failed'); }); }, intervalMs);
    logger.info({ intervalMs, symbols }, '[funding-rates] Feed started');
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, poll };
}
