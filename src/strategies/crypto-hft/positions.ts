/**
 * Position Manager — Full exit logic ported from firstorder.rs
 *
 * Exits (priority order):
 *  1. Force exit (< forceExitSec before expiry)
 *  2. Take profit
 *  3. Stop loss
 *  4. Ratchet floor (progressive giveback from confirmed high)
 *  5. Trailing stop (time-aware: tightens near expiry)
 *  6. Depth collapse (depth -60%, price dropping)
 *  7. Stale profit (up +9%, bid unchanged 7s)
 *  8. Stagnant profit (at +3% for 13s, no progress)
 *  9. Time exit (< minTimeLeftSec)
 */

import { logger } from '../../utils/logger.js';
import { takerFeePct } from './types.js';
import type {
  CryptoHftConfig,
  OpenPosition,
  ClosedPosition,
  ExitReason,
  SignalDirection,
  HftStats,
  OrderbookSnapshot,
} from './types.js';

// ── Ratchet Floor Table (from firstorder.rs Jan 19 2026) ────────────────────
// confirmedHighPct → floorPct
// Progressive giveback: higher highs get tighter floors

const RATCHET_TABLE: Array<[number, number]> = [
  [100, 94],
  [50, 44],
  [40, 35],
  [30, 25],
  [25, 20],
  [20, 15],
  [15, 10],
  [10, 6],
  [8, 4],
  [6, 3],
  [5, 2],
  [4, 1],
  [3, 0],
  [2, -2],
  [1, -4],
];
const RATCHET_DEFAULT_FLOOR = -12; // Initial stop before any confirmed high

function getRatchetFloor(confirmedHighPct: number): number {
  for (const [threshold, floor] of RATCHET_TABLE) {
    if (confirmedHighPct >= threshold) return floor;
  }
  return RATCHET_DEFAULT_FLOOR;
}

// ── Trailing stop table (from firstorder.rs, profit-based) ──────────────────

function getProfitTrailPct(highPnlPct: number): number {
  if (highPnlPct >= 20) return 12;
  if (highPnlPct >= 15) return 10;
  if (highPnlPct >= 10) return 7;
  if (highPnlPct >= 5) return 5;
  return 8; // wide, let it develop
}

function getTimeTrailPct(timeLeftSec: number): number {
  if (timeLeftSec > 420) return 15; // >7 min
  if (timeLeftSec > 180) return 10; // 3-7 min
  return 7; // <3 min — tight
}

// ── Position Manager ────────────────────────────────────────────────────────

export interface PositionManager {
  open(params: {
    strategy: string;
    asset: string;
    direction: SignalDirection;
    tokenId: string;
    conditionId: string;
    entryPrice: number;
    shares: number;
    expiresAt: number;
    wasMaker: boolean;
  }): OpenPosition;

  /** Check all positions for exit conditions. Returns exits to execute. */
  checkExits(
    getBook: (tokenId: string) => OrderbookSnapshot | null,
    now?: number
  ): Array<{ position: OpenPosition; reason: ExitReason; exitPrice: number; useMaker: boolean }>;

  /** Record a price tick for a position. Updates HWM, staleness, etc. */
  tick(positionId: string, price: number, book: OrderbookSnapshot | null): void;

  /** Mark a position closed after execution. */
  close(positionId: string, exitPrice: number, reason: ExitReason, wasMaker: boolean): ClosedPosition | null;

  /** Can we open a new position? */
  canOpen(asset?: string, direction?: SignalDirection): { ok: boolean; reason?: string };

  getOpen(): OpenPosition[];
  getClosed(): ClosedPosition[];
  getStats(): HftStats;
  resetDaily(): void;
}

export function createPositionManager(getConfig: () => CryptoHftConfig): PositionManager {
  const positions = new Map<string, OpenPosition>();
  const closed: ClosedPosition[] = [];
  let dailyPnl = 0;
  let lastStopLossAt = 0;
  let nextId = 1;

  // Per coin+direction exit cooldowns
  const exitCooldowns = new Map<string, number>();

  function cooldownKey(asset: string, direction: SignalDirection): string {
    return `${asset}_${direction}`;
  }

  return {
    open(params) {
      const id = `hft-${nextId++}`;
      const entryFeePct = params.wasMaker ? 0 : takerFeePct(params.entryPrice);
      const now = Date.now();

      const pos: OpenPosition = {
        id,
        strategy: params.strategy,
        asset: params.asset,
        direction: params.direction,
        tokenId: params.tokenId,
        conditionId: params.conditionId,
        entryPrice: params.entryPrice,
        currentPrice: params.entryPrice,
        shares: params.shares,
        costUsd: params.entryPrice * params.shares,
        wasMakerEntry: params.wasMaker,
        entryFeePct,
        highWaterMark: params.entryPrice,
        hwmConfirmCount: 0,
        confirmedHigh: params.entryPrice,
        enteredAt: now,
        expiresAt: params.expiresAt,
        lastBidPrice: params.entryPrice,
        bidUnchangedSince: now,
        lastProgressAt: now,
        lastProgressPct: 0,
        initialDepth: 0,
        highPnlPct: 0,
        lowPnlPct: 0,
        wasEverPositive: false,
      };

      positions.set(id, pos);
      logger.info(
        {
          id,
          strategy: pos.strategy,
          asset: pos.asset,
          dir: pos.direction,
          price: pos.entryPrice.toFixed(2),
          shares: pos.shares,
          maker: pos.wasMakerEntry,
          fee: entryFeePct.toFixed(2) + '%',
        },
        'Position opened'
      );
      return pos;
    },

    tick(positionId, price, book) {
      const config = getConfig();
      const pos = positions.get(positionId);
      if (!pos) return;

      pos.currentPrice = price;
      if (pos.entryPrice <= 0) return;
      const pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;

      // Track PnL extremes
      if (pnlPct > pos.highPnlPct) pos.highPnlPct = pnlPct;
      if (pnlPct < pos.lowPnlPct) pos.lowPnlPct = pnlPct;
      if (pnlPct > 0) pos.wasEverPositive = true;

      // HWM + confirmation (ratchet needs confirmed highs, not spikes)
      if (price > pos.highWaterMark) {
        pos.highWaterMark = price;
        pos.hwmConfirmCount = 1;
      } else {
        const nearHigh = pos.highWaterMark > 0
          && (Math.abs(price - pos.highWaterMark) / pos.highWaterMark * 100
            < config.ratchetConfirmTolerancePct);
        if (nearHigh) {
          pos.hwmConfirmCount++;
          if (pos.hwmConfirmCount >= config.ratchetConfirmTicks) {
            pos.confirmedHigh = pos.highWaterMark;
          }
        } else {
          pos.hwmConfirmCount = 0;
        }
      }

      // Bid staleness tracking
      if (book) {
        if (pos.initialDepth === 0) {
          pos.initialDepth = book.bidDepth + book.askDepth;
        }
        if (book.bestBid !== pos.lastBidPrice) {
          pos.lastBidPrice = book.bestBid;
          pos.bidUnchangedSince = Date.now();
        }
      }

      // Stagnant tracking — progress = PnL improved by >1% since last check
      if (Math.abs(pnlPct - pos.lastProgressPct) > 1) {
        pos.lastProgressAt = Date.now();
        pos.lastProgressPct = pnlPct;
      }
    },

    checkExits(getBook, now = Date.now()) {
      const config = getConfig();
      const exits: Array<{ position: OpenPosition; reason: ExitReason; exitPrice: number; useMaker: boolean }> = [];

      for (const pos of positions.values()) {
        const book = getBook(pos.tokenId);
        const price = book?.bestBid ?? pos.currentPrice;
        if (pos.entryPrice <= 0) continue;
        const pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
        const timeLeftSec = (pos.expiresAt - now) / 1000;
        const holdSec = (now - pos.enteredAt) / 1000;

        // 1. Force exit — absolute deadline
        if (timeLeftSec <= config.forceExitSec) {
          exits.push({ position: pos, reason: 'force_exit', exitPrice: price, useMaker: false });
          continue;
        }

        // 2. Take profit
        if (pnlPct >= config.takeProfitPct) {
          exits.push({ position: pos, reason: 'take_profit', exitPrice: price, useMaker: config.makerExitsForTpOnly });
          continue;
        }

        // 3. Stop loss — always taker (speed matters when losing)
        if (pnlPct <= -config.stopLossPct) {
          exits.push({ position: pos, reason: 'stop_loss', exitPrice: price, useMaker: false });
          continue;
        }

        // 4. Ratchet floor (progressive giveback from confirmed high)
        if (config.ratchetEnabled) {
          const confirmedHighPct = ((pos.confirmedHigh - pos.entryPrice) / pos.entryPrice) * 100;
          const floor = getRatchetFloor(confirmedHighPct);
          if (pnlPct <= floor) {
            exits.push({ position: pos, reason: 'ratchet_floor', exitPrice: price, useMaker: false });
            continue;
          }
        }

        // 5. Trailing stop (time-aware: tighter near expiry)
        if (config.trailingEnabled && pos.highPnlPct > 0) {
          const profitTrail = getProfitTrailPct(pos.highPnlPct);
          const timeTrail = getTimeTrailPct(timeLeftSec);
          const trail = Math.min(profitTrail, timeTrail);
          const dropFromHigh = pos.highPnlPct - pnlPct;

          if (dropFromHigh >= trail) {
            exits.push({ position: pos, reason: 'trailing_stop', exitPrice: price, useMaker: false });
            continue;
          }
        }

        // 6. Depth collapse
        if (book && pos.initialDepth > 0) {
          const currentDepth = book.bidDepth + book.askDepth;
          const depthChangePct = ((currentDepth - pos.initialDepth) / pos.initialDepth) * 100;
          const priceDropping = price < pos.currentPrice;

          if (depthChangePct <= -config.depthCollapseThresholdPct && priceDropping && pnlPct >= 2) {
            exits.push({ position: pos, reason: 'depth_collapse', exitPrice: price, useMaker: false });
            continue;
          }
        }

        // 7. Stale profit (bid unchanged while in profit)
        if (pnlPct >= config.staleProfitPct) {
          const bidStaleSec = (now - pos.bidUnchangedSince) / 1000;
          if (bidStaleSec >= config.staleProfitBidUnchangedSec) {
            exits.push({ position: pos, reason: 'stale_profit', exitPrice: price, useMaker: true });
            continue;
          }
        }

        // 8. Stagnant profit (at +3% for 13s, no progress)
        if (pnlPct >= config.stagnantProfitPct && pnlPct < config.takeProfitPct) {
          const stagnantSec = (now - pos.lastProgressAt) / 1000;
          if (stagnantSec >= config.stagnantDurationSec) {
            exits.push({ position: pos, reason: 'stagnant_profit', exitPrice: price, useMaker: true });
            continue;
          }
        }

        // 9. Time exit (approaching min time left)
        if (timeLeftSec <= config.minTimeLeftSec) {
          exits.push({ position: pos, reason: 'time_exit', exitPrice: price, useMaker: config.makerExitsForTpOnly });
          continue;
        }
      }

      return exits;
    },

    close(positionId, exitPrice, reason, wasMaker) {
      const pos = positions.get(positionId);
      if (!pos) return null;

      positions.delete(positionId);

      const exitFeePct = wasMaker ? 0 : takerFeePct(exitPrice);
      const pnlPct = pos.entryPrice > 0 ? ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0;
      const grossPnlUsd = (exitPrice - pos.entryPrice) * pos.shares;
      const entryFeeUsd = (pos.entryFeePct / 100) * pos.entryPrice * pos.shares;
      const exitFeeUsd = (exitFeePct / 100) * exitPrice * pos.shares;
      const netPnlUsd = grossPnlUsd - entryFeeUsd - exitFeeUsd;
      const netPnlPct = pos.costUsd > 0 ? (netPnlUsd / pos.costUsd) * 100 : 0;
      const holdTimeSec = (Date.now() - pos.enteredAt) / 1000;

      dailyPnl += netPnlUsd;
      if (reason === 'stop_loss') lastStopLossAt = Date.now();

      // Set exit cooldown for this coin+direction
      exitCooldowns.set(cooldownKey(pos.asset, pos.direction), Date.now());

      const result: ClosedPosition = {
        ...pos,
        exitPrice,
        exitReason: reason,
        exitedAt: Date.now(),
        wasMakerExit: wasMaker,
        exitFeePct,
        pnlUsd: grossPnlUsd,
        pnlPct,
        netPnlUsd,
        netPnlPct,
        holdTimeSec,
      };
      closed.push(result);
      if (closed.length > 5000) {
        closed.splice(0, closed.length - 5000);
      }

      logger.info(
        {
          id: positionId,
          strat: pos.strategy,
          asset: pos.asset,
          dir: pos.direction,
          reason,
          gross: grossPnlUsd.toFixed(3),
          net: netPnlUsd.toFixed(3),
          pct: netPnlPct.toFixed(1) + '%',
          hold: holdTimeSec.toFixed(0) + 's',
          makerEntry: pos.wasMakerEntry,
          makerExit: wasMaker,
        },
        'Position closed'
      );
      return result;
    },

    canOpen(asset, direction) {
      const config = getConfig();
      if (positions.size >= config.maxPositions) {
        return { ok: false, reason: `Max positions (${config.maxPositions})` };
      }
      if (dailyPnl <= -config.maxDailyLossUsd) {
        return { ok: false, reason: `Daily loss limit ($${config.maxDailyLossUsd})` };
      }
      // Stop loss cooldown
      if (config.stopLossCooldownSec > 0 && Date.now() - lastStopLossAt < config.stopLossCooldownSec * 1000) {
        const left = Math.ceil((config.stopLossCooldownSec * 1000 - (Date.now() - lastStopLossAt)) / 1000);
        return { ok: false, reason: `SL cooldown: ${left}s` };
      }
      // Already have position on this asset?
      if (asset) {
        for (const pos of positions.values()) {
          if (pos.asset === asset) {
            return { ok: false, reason: `Already in ${asset}` };
          }
        }
      }
      // Exit cooldown per coin+direction
      if (asset && direction) {
        const key = cooldownKey(asset, direction);
        const lastExit = exitCooldowns.get(key);
        if (lastExit && Date.now() - lastExit < config.exitCooldownSec * 1000) {
          const left = Math.ceil((config.exitCooldownSec * 1000 - (Date.now() - lastExit)) / 1000);
          return { ok: false, reason: `Exit cooldown ${asset} ${direction}: ${left}s` };
        }
      }
      return { ok: true };
    },

    getOpen() {
      return [...positions.values()];
    },

    getClosed() {
      return [...closed];
    },

    getStats() {
      const wins = closed.filter((c) => c.netPnlUsd > 0);
      const losses = closed.filter((c) => c.netPnlUsd <= 0);
      const grossPnl = closed.reduce((s, c) => s + c.pnlUsd, 0);
      const fees = closed.reduce((s, c) => {
        const entryFee = (c.entryFeePct / 100) * c.entryPrice * c.shares;
        const exitFee = (c.exitFeePct / 100) * c.exitPrice * c.shares;
        return s + entryFee + exitFee;
      }, 0);
      const netPnl = closed.reduce((s, c) => s + c.netPnlUsd, 0);
      const holdTimes = closed.map((c) => c.holdTimeSec);
      const makerEntries = closed.filter((c) => c.wasMakerEntry).length;
      const makerExits = closed.filter((c) => c.wasMakerExit).length;

      const exitReasons: Record<string, number> = {};
      for (const c of closed) {
        exitReasons[c.exitReason] = (exitReasons[c.exitReason] ?? 0) + 1;
      }

      return {
        totalTrades: closed.length,
        wins: wins.length,
        losses: losses.length,
        winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
        grossPnlUsd: grossPnl,
        feesUsd: fees,
        netPnlUsd: netPnl,
        dailyPnlUsd: dailyPnl,
        openPositions: positions.size,
        bestTradePct: closed.length > 0 ? Math.max(...closed.map((c) => c.netPnlPct)) : 0,
        worstTradePct: closed.length > 0 ? Math.min(...closed.map((c) => c.netPnlPct)) : 0,
        avgHoldTimeSec: holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0,
        makerEntryRate: closed.length > 0 ? (makerEntries / closed.length) * 100 : 0,
        makerExitRate: closed.length > 0 ? (makerExits / closed.length) * 100 : 0,
        exitReasons,
      };
    },

    resetDaily() {
      dailyPnl = 0;
      lastStopLossAt = 0;
      exitCooldowns.clear();
    },
  };
}
