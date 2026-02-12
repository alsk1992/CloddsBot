/**
 * Market Scanner — Round-based market discovery and rotation
 *
 * Tracks round slots (unix_ts / roundDurationSec) and automatically fetches new markets
 * when rounds transition. Enforces timing gates: min round age, min time left.
 *
 * Discovery method: Direct slug-based queries (e.g., btc-updown-5m-1770935700)
 * This ensures reliable discovery of time-duration-specific markets.
 */

import { logger } from '../../utils/logger.js';
import type { CryptoMarket, CryptoHftConfig, RoundState } from './types.js';

const GAMMA_URL = 'https://gamma-api.polymarket.com';

/** Raw Gamma API market shape */
interface GammaMarket {
  condition_id: string;
  question_id: string;
  question: string;
  tokens: Array<{ token_id: string; outcome: string; price: number }>;
  end_date_iso: string;
  active: boolean;
  closed: boolean;
  neg_risk: boolean;
  volume: string;
  liquidity: string;
  slug: string;
}

export interface MarketScanner {
  /** Fetch fresh markets from Gamma. Call on round transitions. */
  refresh(): Promise<CryptoMarket[]>;
  /** Get current round state (slot, timing, markets) */
  getRound(): RoundState;
  /** Get market for a specific asset in current round */
  getMarket(asset: string): CryptoMarket | null;
  /** Check if we're in a tradeable window (not too early, not too late) */
  canTrade(): { ok: boolean; reason?: string };
  /** Start auto-refresh loop (checks for new rounds every 10s) */
  start(): void;
  stop(): void;
  /** Update live prices from WS/feed data */
  updatePrice(conditionId: string, upPrice: number, downPrice: number): void;
}

export function createMarketScanner(config: CryptoHftConfig | (() => CryptoHftConfig)): MarketScanner {
  const getConfig = typeof config === 'function' ? config : () => config;
  let markets: CryptoMarket[] = [];
  let currentSlot = 0;
  let refreshTimer: NodeJS.Timeout | null = null;
  let lastRefreshAt = 0;

  function getCurrentSlot(): number {
    return Math.floor(Date.now() / 1000 / getConfig().roundDurationSec);
  }

  function getSlotExpiry(slot: number): number {
    return (slot + 1) * getConfig().roundDurationSec * 1000;
  }

  function getRoundState(): RoundState {
    const cfg = getConfig();
    const now = Date.now();
    const slot = getCurrentSlot();
    const expiresAt = getSlotExpiry(slot);
    const timeLeftSec = Math.max(0, (expiresAt - now) / 1000);
    const ageSec = cfg.roundDurationSec - timeLeftSec;

    return {
      slot,
      expiresAt,
      markets,
      ageSec,
      timeLeftSec,
    };
  }

  async function fetchMarkets(): Promise<CryptoMarket[]> {
    const cfg = getConfig();
    const found: CryptoMarket[] = [];

    // Determine duration label (5m or 15m)
    const durationLabel = cfg.roundDurationSec === 300 ? '5m' : '15m';

    for (const asset of cfg.assets) {
      try {
        // Calculate current market slot and build slug
        // E.g., for 5-min: btc-updown-5m-1770935700
        // The timestamp is floored to the slot boundary: floor(now / 300) * 300
        const nowSec = Math.floor(Date.now() / 1000);
        const slotStart = Math.floor(nowSec / cfg.roundDurationSec) * cfg.roundDurationSec;
        const slug = `${asset.toLowerCase()}-updown-${durationLabel}-${slotStart}`;

        // Try direct slug query first (most reliable)
        const slugRes = await fetch(
          `${GAMMA_URL}/markets?slug=${encodeURIComponent(slug)}&active=true&closed=false`
        );

        if (slugRes.ok) {
          const slugData = (await slugRes.json()) as GammaMarket[];
          if (slugData.length > 0) {
            const m = slugData[0]; // slug should return exactly 1 result
            if (!m.closed && m.active && m.tokens && m.tokens.length >= 2) {
              const upToken = m.tokens.find(
                (t) => t.outcome.toLowerCase() === 'yes' || t.outcome.toLowerCase() === 'up'
              );
              const downToken = m.tokens.find(
                (t) => t.outcome.toLowerCase() === 'no' || t.outcome.toLowerCase() === 'down'
              );

              if (upToken && downToken) {
                const expiresAt = new Date(m.end_date_iso).getTime();
                const roundSlot = Math.floor(expiresAt / 1000 / cfg.roundDurationSec);

                found.push({
                  asset: asset.toUpperCase(),
                  conditionId: m.condition_id,
                  questionId: m.question_id,
                  upTokenId: upToken.token_id,
                  downTokenId: downToken.token_id,
                  upPrice: upToken.price,
                  downPrice: downToken.price,
                  expiresAt,
                  roundSlot,
                  negRisk: m.neg_risk ?? true,
                  question: m.question,
                });

                logger.debug({ asset, slug, slot: roundSlot }, 'Found market by slug');
                continue; // Successfully found, move to next asset
              }
            }
          }
        }

        // Fallback: try generic search if slug query fails (between rounds, market not yet live)
        const searchQueries = [
          `Will ${asset} go up`,
          `${asset} price`,
          `${asset}-updown`,
        ];

        for (const query of searchQueries) {
          const searchRes = await fetch(
            `${GAMMA_URL}/markets?_limit=10&active=true&closed=false&_q=${encodeURIComponent(query)}`
          );
          if (!searchRes.ok) continue;

          const searchData = (await searchRes.json()) as GammaMarket[];

          for (const m of searchData) {
            if (m.closed || !m.active) continue;
            if (!m.tokens || m.tokens.length < 2) continue;

            // Verify this is the right duration market
            const q = m.question.toLowerCase();
            if (!q.includes(asset.toLowerCase())) continue;

            // Filter by duration: must expire within roundDuration + buffer
            const expiresAt = new Date(m.end_date_iso).getTime();
            const now = Date.now();
            const secsLeft = (expiresAt - now) / 1000;

            if (secsLeft <= 0 || secsLeft > cfg.roundDurationSec + 60) continue;

            // Verify slug matches expected pattern
            if (!m.slug.includes(`-${durationLabel}-`)) continue;

            // Find UP/YES and DOWN/NO tokens
            const upToken = m.tokens.find(
              (t) => t.outcome.toLowerCase() === 'yes' || t.outcome.toLowerCase() === 'up'
            );
            const downToken = m.tokens.find(
              (t) => t.outcome.toLowerCase() === 'no' || t.outcome.toLowerCase() === 'down'
            );
            if (!upToken || !downToken) continue;

            // Skip if already found a closer-expiry market for this asset
            const existing = found.find((f) => f.asset === asset.toUpperCase());
            if (existing && existing.expiresAt <= expiresAt) continue;
            if (existing) {
              const idx = found.indexOf(existing);
              found.splice(idx, 1);
            }

            const roundSlot = Math.floor(expiresAt / 1000 / cfg.roundDurationSec);

            found.push({
              asset: asset.toUpperCase(),
              conditionId: m.condition_id,
              questionId: m.question_id,
              upTokenId: upToken.token_id,
              downTokenId: downToken.token_id,
              upPrice: upToken.price,
              downPrice: downToken.price,
              expiresAt,
              roundSlot,
              negRisk: m.neg_risk ?? true,
              question: m.question,
            });

            logger.debug({ asset, slug: m.slug, slot: roundSlot }, 'Found market by search');
          }

          // Found one for this asset, stop trying queries
          if (found.some((f) => f.asset === asset.toUpperCase())) break;
        }
      } catch (err) {
        logger.warn({ err, asset }, 'Market scan failed for asset');
      }
    }

    return found;
  }

  async function maybeRefresh() {
    const slot = getCurrentSlot();

    // New round started, or we have no markets
    if (slot !== currentSlot || markets.length === 0) {
      const prevSlot = currentSlot;
      currentSlot = slot;

      // Don't spam Gamma — rate limit to once per 10s
      if (Date.now() - lastRefreshAt < 10_000) return;
      lastRefreshAt = Date.now();

      markets = await fetchMarkets();

      if (markets.length > 0 && slot !== prevSlot) {
        logger.info(
          {
            slot,
            markets: markets.map((m) => `${m.asset}(${((m.expiresAt - Date.now()) / 1000).toFixed(0)}s)`),
          },
          'New round — markets loaded'
        );
      }
    }
  }

  return {
    async refresh() {
      lastRefreshAt = Date.now();
      currentSlot = getCurrentSlot();
      markets = await fetchMarkets();
      return markets;
    },

    getRound() {
      return getRoundState();
    },

    getMarket(asset) {
      return markets.find((m) => m.asset === asset.toUpperCase()) ?? null;
    },

    canTrade() {
      const cfg = getConfig();
      const round = getRoundState();

      if (round.markets.length === 0) {
        return { ok: false, reason: 'No active markets' };
      }
      if (round.ageSec < cfg.minRoundAgeSec) {
        return { ok: false, reason: `Round too young (${round.ageSec.toFixed(0)}s < ${cfg.minRoundAgeSec}s)` };
      }
      if (round.timeLeftSec < cfg.minTimeLeftSec) {
        return { ok: false, reason: `Too close to expiry (${round.timeLeftSec.toFixed(0)}s < ${cfg.minTimeLeftSec}s)` };
      }
      return { ok: true };
    },

    start() {
      // Check for new rounds every 10 seconds
      refreshTimer = setInterval(() => maybeRefresh(), 10_000);
      // Immediate first refresh
      maybeRefresh();
    },

    stop() {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    },

    updatePrice(conditionId, upPrice, downPrice) {
      const m = markets.find((mk) => mk.conditionId === conditionId);
      if (m) {
        m.upPrice = upPrice;
        m.downPrice = downPrice;
      }
    },
  };
}
