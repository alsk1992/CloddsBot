/**
 * Market Rotator — 15-min crypto market discovery from Gamma API
 *
 * Fetches active markets, extracts UP/DOWN token pairs,
 * auto-refreshes on round transitions.
 */

import { logger } from '../../utils/logger.js';
import type { HftDivergenceConfig, DivMarket } from './types.js';

const GAMMA_URL = 'https://gamma-api.polymarket.com';

interface GammaMarket {
  condition_id: string;
  question: string;
  tokens: Array<{ token_id: string; outcome: string; price: number }>;
  end_date_iso: string;
  active: boolean;
  closed: boolean;
  neg_risk: boolean;
}

export interface MarketRotator {
  refresh(): Promise<DivMarket[]>;
  getMarket(asset: string): DivMarket | null;
  getActiveMarkets(): DivMarket[];
  updatePrice(conditionId: string, upPrice: number, downPrice: number): void;
  getCurrentSlot(): number;
  start(): void;
  stop(): void;
}

export function createMarketRotator(
  getConfig: () => HftDivergenceConfig
): MarketRotator {
  let markets: DivMarket[] = [];
  let currentSlot = 0;
  let timer: NodeJS.Timeout | null = null;
  let lastRefreshAt = 0;

  function getSlot(): number {
    return Math.floor(Date.now() / 1000 / getConfig().marketDurationSec);
  }

  async function fetchMarkets(): Promise<DivMarket[]> {
    const cfg = getConfig();
    const found: DivMarket[] = [];

    for (const asset of cfg.assets) {
      try {
        const queries = [
          `Will ${asset} go up`,
          `${asset} price`,
          `Will the price of ${asset}`,
        ];

        for (const query of queries) {
          const res = await fetch(
            `${GAMMA_URL}/markets?_limit=10&active=true&closed=false&_q=${encodeURIComponent(query)}`
          );
          if (!res.ok) continue;

          const data = (await res.json()) as GammaMarket[];

          for (const m of data) {
            if (m.closed || !m.active || !m.tokens || m.tokens.length < 2) continue;

            const q = m.question.toLowerCase();
            if (!q.includes(asset.toLowerCase())) continue;

            const expiresAt = new Date(m.end_date_iso).getTime();
            const secsLeft = (expiresAt - Date.now()) / 1000;
            if (secsLeft <= 0 || secsLeft > cfg.marketDurationSec + 60) continue;

            const upToken = m.tokens.find(
              (t) => t.outcome.toLowerCase() === 'yes' || t.outcome.toLowerCase() === 'up'
            );
            const downToken = m.tokens.find(
              (t) => t.outcome.toLowerCase() === 'no' || t.outcome.toLowerCase() === 'down'
            );
            if (!upToken || !downToken) continue;

            // Keep closest-expiry market per asset
            const existing = found.find((f) => f.asset === asset.toUpperCase());
            if (existing && existing.expiresAt <= expiresAt) continue;
            if (existing) {
              found.splice(found.indexOf(existing), 1);
            }

            found.push({
              asset: asset.toUpperCase(),
              conditionId: m.condition_id,
              upTokenId: upToken.token_id,
              downTokenId: downToken.token_id,
              upPrice: upToken.price,
              downPrice: downToken.price,
              expiresAt,
              roundSlot: Math.floor(expiresAt / 1000 / cfg.marketDurationSec),
              negRisk: m.neg_risk ?? true,
              question: m.question,
            });
          }

          if (found.some((f) => f.asset === asset.toUpperCase())) break;
        }
      } catch (err) {
        logger.warn({ err, asset }, 'Market rotator: scan failed');
      }
    }

    return found;
  }

  async function maybeRefresh() {
    const slot = getSlot();
    if (slot !== currentSlot || markets.length === 0) {
      const prev = currentSlot;
      currentSlot = slot;
      if (Date.now() - lastRefreshAt < 10_000) return;
      lastRefreshAt = Date.now();
      markets = await fetchMarkets();
      if (markets.length > 0 && slot !== prev) {
        logger.info(
          { slot, count: markets.length, assets: markets.map((m) => m.asset) },
          'Divergence: new round, markets loaded'
        );
      }
    }
  }

  return {
    async refresh() {
      lastRefreshAt = Date.now();
      currentSlot = getSlot();
      markets = await fetchMarkets();
      return markets;
    },

    getMarket(asset) {
      return markets.find((m) => m.asset === asset.toUpperCase()) ?? null;
    },

    getActiveMarkets() {
      return [...markets];
    },

    updatePrice(conditionId, upPrice, downPrice) {
      const m = markets.find((mk) => mk.conditionId === conditionId);
      if (m) {
        m.upPrice = upPrice;
        m.downPrice = downPrice;
      }
    },

    getCurrentSlot() {
      return getSlot();
    },

    start() {
      timer = setInterval(() => maybeRefresh(), 10_000);
      maybeRefresh();
    },

    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
  };
}
