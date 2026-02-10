/**
 * Divergence Position Manager — TP/SL/Trailing/Time exits + risk gates
 *
 * Simpler than crypto-hft positions.ts (no ratchet/depth/stale/stagnant).
 * Focused on the exit rules that matter for divergence trades.
 */

import { logger } from '../../utils/logger.js';
import type {
  HftDivergenceConfig,
  DivPosition,
  DivClosedPosition,
  DivExitReason,
  ExitSignal,
  DivStats,
  Direction,
} from './types.js';

export interface DivPositionManager {
  open(params: {
    asset: string;
    direction: Direction;
    tokenId: string;
    conditionId: string;
    strategyTag: string;
    entryPrice: number;
    shares: number;
    expiresAt: number;
  }): DivPosition;

  /** Update position price + check all exit conditions */
  tick(positionId: string, currentPrice: number): void;

  /** Check all positions for exits */
  checkExits(now?: number): ExitSignal[];

  /** Close a position after execution */
  close(positionId: string, exitPrice: number, reason: DivExitReason): DivClosedPosition | null;

  /** Risk gate: can we open a new position? */
  canOpen(asset?: string): { ok: boolean; reason?: string };

  getOpen(): DivPosition[];
  getClosed(): DivClosedPosition[];
  getStats(): DivStats;
  resetDaily(): void;
}

export function createDivPositionManager(
  getConfig: () => HftDivergenceConfig
): DivPositionManager {
  const positions = new Map<string, DivPosition>();
  const closed: DivClosedPosition[] = [];
  let dailyPnl = 0;
  let lastLossAt = 0;
  let lastExitAt = 0;
  let nextId = 1;
  const signalCounts = new Map<string, number>();

  return {
    open(params) {
      const id = `div-${nextId++}`;
      const pos: DivPosition = {
        id,
        asset: params.asset,
        direction: params.direction,
        tokenId: params.tokenId,
        conditionId: params.conditionId,
        strategyTag: params.strategyTag,
        entryPrice: params.entryPrice,
        currentPrice: params.entryPrice,
        shares: params.shares,
        costUsd: params.entryPrice * params.shares,
        highWaterMark: params.entryPrice,
        trailingActivated: false,
        enteredAt: Date.now(),
        expiresAt: params.expiresAt,
      };
      positions.set(id, pos);
      signalCounts.set(params.strategyTag, (signalCounts.get(params.strategyTag) ?? 0) + 1);
      if (signalCounts.size > 1000) {
        const oldest = signalCounts.keys().next().value;
        if (oldest !== undefined) signalCounts.delete(oldest);
      }

      logger.info(
        { id, asset: pos.asset, dir: pos.direction, tag: pos.strategyTag, price: pos.entryPrice.toFixed(2), shares: pos.shares },
        'Div position opened'
      );
      return pos;
    },

    tick(positionId, currentPrice) {
      const pos = positions.get(positionId);
      if (!pos) return;
      pos.currentPrice = currentPrice;

      // Update HWM
      if (currentPrice > pos.highWaterMark) {
        pos.highWaterMark = currentPrice;
      }

      // Check trailing activation
      const config = getConfig();
      if (pos.entryPrice <= 0) return;
      const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
      if (pnlPct >= config.trailingActivationPct) {
        pos.trailingActivated = true;
      }
    },

    checkExits(now = Date.now()) {
      const config = getConfig();
      const exits: ExitSignal[] = [];

      for (const pos of positions.values()) {
        const price = pos.currentPrice;
        if (pos.entryPrice <= 0) continue;
        const pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
        const timeLeftSec = (pos.expiresAt - now) / 1000;

        // 1. Force exit — absolute deadline
        if (timeLeftSec <= config.forceExitSec) {
          exits.push({ positionId: pos.id, reason: 'force_exit', exitPrice: price });
          continue;
        }

        // 2. Take profit
        if (pnlPct >= config.takeProfitPct) {
          exits.push({ positionId: pos.id, reason: 'take_profit', exitPrice: price });
          continue;
        }

        // 3. Stop loss
        if (pnlPct <= -config.stopLossPct) {
          exits.push({ positionId: pos.id, reason: 'stop_loss', exitPrice: price });
          continue;
        }

        // 4. Trailing stop (only after activation)
        if (pos.trailingActivated && pos.highWaterMark > pos.entryPrice && pos.highWaterMark > 0) {
          const dropFromHigh = ((pos.highWaterMark - price) / pos.highWaterMark) * 100;
          if (dropFromHigh >= config.trailingStopPct) {
            exits.push({ positionId: pos.id, reason: 'trailing_stop', exitPrice: price });
            continue;
          }
        }

        // 5. Time exit — approaching expiry
        if (timeLeftSec <= config.timeExitSec) {
          exits.push({ positionId: pos.id, reason: 'time_exit', exitPrice: price });
          continue;
        }
      }

      return exits;
    },

    close(positionId, exitPrice, reason) {
      const pos = positions.get(positionId);
      if (!pos) return null;
      positions.delete(positionId);

      const now = Date.now();
      const pnlUsd = (exitPrice - pos.entryPrice) * pos.shares;
      const pnlPct = pos.costUsd > 0 ? (pnlUsd / pos.costUsd) * 100 : 0;
      const holdTimeSec = (now - pos.enteredAt) / 1000;

      dailyPnl += pnlUsd;
      lastExitAt = now;
      if (reason === 'stop_loss') lastLossAt = now;

      const result: DivClosedPosition = {
        ...pos,
        exitPrice,
        exitReason: reason,
        exitedAt: now,
        pnlUsd,
        pnlPct,
        holdTimeSec,
      };
      closed.push(result);
      if (closed.length > 5000) {
        closed.splice(0, closed.length - 5000);
      }

      logger.info(
        {
          id: positionId,
          tag: pos.strategyTag,
          reason,
          pnl: pnlUsd.toFixed(3),
          pct: pnlPct.toFixed(1) + '%',
          hold: holdTimeSec.toFixed(0) + 's',
        },
        'Div position closed'
      );
      return result;
    },

    canOpen(asset) {
      const config = getConfig();
      const now = Date.now();

      if (positions.size >= config.maxConcurrentPositions) {
        return { ok: false, reason: `Max positions (${config.maxConcurrentPositions})` };
      }
      if (dailyPnl <= -config.maxDailyLossUsd) {
        return { ok: false, reason: `Daily loss limit ($${config.maxDailyLossUsd})` };
      }
      if (config.cooldownAfterLossSec > 0 && now - lastLossAt < config.cooldownAfterLossSec * 1000) {
        return { ok: false, reason: 'Loss cooldown' };
      }
      if (config.cooldownAfterExitSec > 0 && now - lastExitAt < config.cooldownAfterExitSec * 1000) {
        return { ok: false, reason: 'Exit cooldown' };
      }
      // One position per asset
      if (asset) {
        for (const pos of positions.values()) {
          if (pos.asset === asset) {
            return { ok: false, reason: `Already in ${asset}` };
          }
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
      const wins = closed.filter((c) => c.pnlUsd > 0);
      const losses = closed.filter((c) => c.pnlUsd <= 0);
      const gross = closed.reduce((s, c) => s + c.pnlUsd, 0);
      const holdTimes = closed.map((c) => c.holdTimeSec);

      return {
        totalTrades: closed.length,
        wins: wins.length,
        losses: losses.length,
        winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
        grossPnlUsd: gross,
        netPnlUsd: gross, // no fee tracking in divergence (fees handled by execution layer)
        dailyPnlUsd: dailyPnl,
        openPositions: positions.size,
        bestTradePct: closed.length > 0 ? Math.max(...closed.map((c) => c.pnlPct)) : 0,
        worstTradePct: closed.length > 0 ? Math.min(...closed.map((c) => c.pnlPct)) : 0,
        avgHoldTimeSec: holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0,
        signalCounts: Object.fromEntries(signalCounts),
      };
    },

    resetDaily() {
      dailyPnl = 0;
      lastLossAt = 0;
      lastExitAt = 0;
    },
  };
}
