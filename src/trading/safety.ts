/**
 * Trading Safety - Circuit breakers, correlation risk, and kill switches
 *
 * CRITICAL: This module prevents catastrophic losses
 *
 * Features:
 * - Daily loss circuit breaker
 * - Max drawdown protection
 * - Correlation risk detection
 * - Position concentration limits
 * - Global kill switch
 */

import { EventEmitter } from 'eventemitter3';
import { Database } from '../db/index';
import { logger } from '../utils/logger';
import type { Platform } from '../types';
import type { Trade } from './logger';

// =============================================================================
// TYPES
// =============================================================================

export interface SafetyConfig {
  /** Max daily loss in USD before circuit breaker trips */
  dailyLossLimit: number;
  /** Max daily loss as % of portfolio */
  dailyLossLimitPct?: number;
  /** Max drawdown from peak before stopping */
  maxDrawdownPct: number;
  /** Max correlation between positions (0-1) */
  maxCorrelation: number;
  /** Max % of portfolio in single position */
  maxConcentrationPct: number;
  /** Max positions in same direction (all YES or all NO) */
  maxSameDirectionPositions: number;
  /** Cooldown after circuit breaker trips (ms) */
  cooldownMs: number;
  /** Auto-close positions on circuit breaker? */
  autoCloseOnBreaker: boolean;
  /** Notify channels on safety event */
  notifyChannels?: string[];
}

export interface SafetyState {
  /** Is trading currently allowed? */
  tradingEnabled: boolean;
  /** Reason if disabled */
  disabledReason?: string;
  /** When trading was disabled */
  disabledAt?: Date;
  /** When trading can resume */
  resumeAt?: Date;
  /** Today's realized PnL */
  dailyPnL: number;
  /** Today's trade count */
  dailyTrades: number;
  /** Peak portfolio value (for drawdown) */
  peakValue: number;
  /** Current portfolio value */
  currentValue: number;
  /** Current drawdown % */
  currentDrawdownPct: number;
  /** Active alerts */
  alerts: SafetyAlert[];
}

export interface SafetyAlert {
  type: 'warning' | 'critical' | 'breaker_tripped';
  category: 'daily_loss' | 'drawdown' | 'correlation' | 'concentration' | 'manual';
  message: string;
  value?: number;
  threshold?: number;
  timestamp: Date;
}

export interface PositionRisk {
  platform: Platform;
  marketId: string;
  outcome: string;
  direction: 'long' | 'short';
  exposure: number;
  exposurePct: number;
  correlatedWith: string[];
}

export interface SafetyManager extends EventEmitter {
  /** Check if trading is allowed */
  canTrade(): boolean;

  /** Get current safety state */
  getState(): SafetyState;

  /** Pre-trade validation */
  validateTrade(trade: {
    platform: Platform;
    marketId: string;
    outcome: string;
    side: 'buy' | 'sell';
    size: number;
    price: number;
  }): { allowed: boolean; reason?: string };

  /** Record a completed trade (updates daily PnL) */
  recordTrade(trade: Trade): void;

  /** Update portfolio value (for drawdown tracking) */
  updatePortfolioValue(value: number): void;

  /** Check correlation risk */
  checkCorrelationRisk(positions: PositionRisk[]): {
    safe: boolean;
    correlatedGroups: string[][];
    warning?: string;
  };

  /** Manual kill switch */
  killSwitch(reason: string): void;

  /** Resume trading after manual review */
  resumeTrading(): boolean;

  /** Reset daily counters (call at midnight) */
  resetDaily(): void;

  /** Get safety alerts */
  getAlerts(since?: Date): SafetyAlert[];

  /** Clear alerts */
  clearAlerts(): void;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

const DEFAULT_CONFIG: SafetyConfig = {
  dailyLossLimit: 500,
  dailyLossLimitPct: 5,
  maxDrawdownPct: 20,
  maxCorrelation: 0.8,
  maxConcentrationPct: 25,
  maxSameDirectionPositions: 5,
  cooldownMs: 4 * 60 * 60 * 1000, // 4 hours
  autoCloseOnBreaker: false,
};

export function createSafetyManager(db: Database, config: Partial<SafetyConfig> = {}): SafetyManager {
  const emitter = new EventEmitter() as SafetyManager;
  const cfg: SafetyConfig = { ...DEFAULT_CONFIG, ...config };

  // State
  let state: SafetyState = {
    tradingEnabled: true,
    dailyPnL: 0,
    dailyTrades: 0,
    peakValue: 10000,
    currentValue: 10000,
    currentDrawdownPct: 0,
    alerts: [],
  };

  // Initialize table
  db.run(`
    CREATE TABLE IF NOT EXISTS safety_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      value REAL,
      threshold REAL,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS safety_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      trading_enabled INTEGER DEFAULT 1,
      disabled_reason TEXT,
      disabled_at TEXT,
      resume_at TEXT,
      daily_pnl REAL DEFAULT 0,
      daily_trades INTEGER DEFAULT 0,
      peak_value REAL DEFAULT 10000,
      current_value REAL DEFAULT 10000,
      last_reset TEXT
    )
  `);

  // Load state
  try {
    const rows = db.query<any>(`SELECT * FROM safety_state WHERE id = 1`);
    if (rows.length > 0) {
      const row = rows[0];
      state.tradingEnabled = row.trading_enabled === 1;
      state.disabledReason = row.disabled_reason;
      state.disabledAt = row.disabled_at ? new Date(row.disabled_at) : undefined;
      state.resumeAt = row.resume_at ? new Date(row.resume_at) : undefined;
      state.dailyPnL = row.daily_pnl || 0;
      state.dailyTrades = row.daily_trades || 0;
      state.peakValue = row.peak_value || 10000;
      state.currentValue = row.current_value || 10000;
      state.currentDrawdownPct = state.peakValue > 0
        ? ((state.peakValue - state.currentValue) / state.peakValue) * 100
        : 0;

      // Check if we need to reset daily counters
      const lastReset = row.last_reset ? new Date(row.last_reset) : null;
      const today = new Date().toDateString();
      if (!lastReset || lastReset.toDateString() !== today) {
        state.dailyPnL = 0;
        state.dailyTrades = 0;
      }
    } else {
      // Initialize
      db.run(`INSERT INTO safety_state (id) VALUES (1)`);
    }
  } catch {
    db.run(`INSERT OR IGNORE INTO safety_state (id) VALUES (1)`);
  }

  function saveState(): void {
    db.run(
      `UPDATE safety_state SET
        trading_enabled = ?, disabled_reason = ?, disabled_at = ?, resume_at = ?,
        daily_pnl = ?, daily_trades = ?, peak_value = ?, current_value = ?, last_reset = ?
       WHERE id = 1`,
      [
        state.tradingEnabled ? 1 : 0,
        state.disabledReason || null,
        state.disabledAt?.toISOString() || null,
        state.resumeAt?.toISOString() || null,
        state.dailyPnL,
        state.dailyTrades,
        state.peakValue,
        state.currentValue,
        new Date().toISOString(),
      ]
    );
  }

  function addAlert(alert: Omit<SafetyAlert, 'timestamp'>): void {
    const fullAlert: SafetyAlert = { ...alert, timestamp: new Date() };
    state.alerts.push(fullAlert);

    // Persist
    db.run(
      `INSERT INTO safety_events (type, category, message, value, threshold, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [alert.type, alert.category, alert.message, alert.value || null, alert.threshold || null, fullAlert.timestamp.toISOString()]
    );

    // Emit
    emitter.emit('alert', fullAlert);
    logger.warn({ alert: fullAlert }, 'Safety alert');
  }

  function tripBreaker(category: SafetyAlert['category'], reason: string, value?: number): void {
    state.tradingEnabled = false;
    state.disabledReason = reason;
    state.disabledAt = new Date();
    state.resumeAt = new Date(Date.now() + cfg.cooldownMs);

    addAlert({
      type: 'breaker_tripped',
      category,
      message: reason,
      value,
      threshold: category === 'daily_loss' ? cfg.dailyLossLimit : cfg.maxDrawdownPct,
    });

    saveState();
    emitter.emit('breakerTripped', { category, reason, value });

    logger.error({ category, reason, value, resumeAt: state.resumeAt }, '🚨 CIRCUIT BREAKER TRIPPED');
  }

  function checkLimits(): void {
    // Check daily loss limit
    if (state.dailyPnL < 0 && Math.abs(state.dailyPnL) >= cfg.dailyLossLimit) {
      if (state.tradingEnabled) {
        tripBreaker('daily_loss', `Daily loss limit hit: $${Math.abs(state.dailyPnL).toFixed(2)}`, state.dailyPnL);
      }
    }

    // Check daily loss % limit
    if (cfg.dailyLossLimitPct && state.currentValue > 0) {
      const lossPercent = (Math.abs(state.dailyPnL) / state.currentValue) * 100;
      if (state.dailyPnL < 0 && lossPercent >= cfg.dailyLossLimitPct) {
        if (state.tradingEnabled) {
          tripBreaker('daily_loss', `Daily loss ${lossPercent.toFixed(1)}% exceeds ${cfg.dailyLossLimitPct}% limit`, lossPercent);
        }
      }
    }

    // Check max drawdown
    if (state.currentDrawdownPct >= cfg.maxDrawdownPct) {
      if (state.tradingEnabled) {
        tripBreaker('drawdown', `Drawdown ${state.currentDrawdownPct.toFixed(1)}% exceeds ${cfg.maxDrawdownPct}% limit`, state.currentDrawdownPct);
      }
    }

    // Warning at 80% of limits
    if (state.tradingEnabled) {
      const warningThreshold = 0.8;

      if (state.dailyPnL < 0 && Math.abs(state.dailyPnL) >= cfg.dailyLossLimit * warningThreshold) {
        addAlert({
          type: 'warning',
          category: 'daily_loss',
          message: `Approaching daily loss limit: $${Math.abs(state.dailyPnL).toFixed(2)} / $${cfg.dailyLossLimit}`,
          value: state.dailyPnL,
          threshold: cfg.dailyLossLimit,
        });
      }

      if (state.currentDrawdownPct >= cfg.maxDrawdownPct * warningThreshold) {
        addAlert({
          type: 'warning',
          category: 'drawdown',
          message: `Approaching max drawdown: ${state.currentDrawdownPct.toFixed(1)}% / ${cfg.maxDrawdownPct}%`,
          value: state.currentDrawdownPct,
          threshold: cfg.maxDrawdownPct,
        });
      }
    }
  }

  // Attach methods
  Object.assign(emitter, {
    canTrade() {
      // Check if cooldown expired
      if (!state.tradingEnabled && state.resumeAt && new Date() >= state.resumeAt) {
        // Auto-resume after cooldown
        state.tradingEnabled = true;
        state.disabledReason = undefined;
        state.disabledAt = undefined;
        state.resumeAt = undefined;
        saveState();
        emitter.emit('tradingResumed', { auto: true });
        logger.info('Trading auto-resumed after cooldown');
      }

      return state.tradingEnabled;
    },

    getState() {
      return { ...state };
    },

    validateTrade(trade) {
      // Check if trading is allowed
      if (!emitter.canTrade()) {
        return {
          allowed: false,
          reason: state.disabledReason || 'Trading disabled by safety system',
        };
      }

      // Check position concentration
      const tradeValue = trade.size * trade.price;
      const concentrationPct = (tradeValue / state.currentValue) * 100;

      if (concentrationPct > cfg.maxConcentrationPct) {
        return {
          allowed: false,
          reason: `Position would be ${concentrationPct.toFixed(1)}% of portfolio (max: ${cfg.maxConcentrationPct}%)`,
        };
      }

      return { allowed: true };
    },

    recordTrade(trade) {
      state.dailyTrades++;

      // Update daily PnL if trade has realized PnL
      if (trade.realizedPnL !== undefined) {
        state.dailyPnL += trade.realizedPnL;
        checkLimits();
      }

      saveState();
    },

    updatePortfolioValue(value) {
      state.currentValue = value;

      // Update peak (for drawdown calculation)
      if (value > state.peakValue) {
        state.peakValue = value;
      }

      // Calculate current drawdown
      state.currentDrawdownPct = state.peakValue > 0
        ? ((state.peakValue - value) / state.peakValue) * 100
        : 0;

      checkLimits();
      saveState();
    },

    checkCorrelationRisk(positions) {
      // Group by direction
      const longPositions = positions.filter((p) => p.direction === 'long');
      const shortPositions = positions.filter((p) => p.direction === 'short');

      // Check same-direction concentration
      if (longPositions.length > cfg.maxSameDirectionPositions) {
        return {
          safe: false,
          correlatedGroups: [longPositions.map((p) => p.marketId)],
          warning: `${longPositions.length} long positions exceeds limit of ${cfg.maxSameDirectionPositions}`,
        };
      }

      if (shortPositions.length > cfg.maxSameDirectionPositions) {
        return {
          safe: false,
          correlatedGroups: [shortPositions.map((p) => p.marketId)],
          warning: `${shortPositions.length} short positions exceeds limit of ${cfg.maxSameDirectionPositions}`,
        };
      }

      // Check total exposure in one direction
      const longExposure = longPositions.reduce((sum, p) => sum + p.exposurePct, 0);
      const shortExposure = shortPositions.reduce((sum, p) => sum + p.exposurePct, 0);

      if (longExposure > 80) {
        return {
          safe: false,
          correlatedGroups: [longPositions.map((p) => p.marketId)],
          warning: `${longExposure.toFixed(0)}% exposure to long positions`,
        };
      }

      if (shortExposure > 80) {
        return {
          safe: false,
          correlatedGroups: [shortPositions.map((p) => p.marketId)],
          warning: `${shortExposure.toFixed(0)}% exposure to short positions`,
        };
      }

      // Simple keyword-based correlation check
      const correlatedGroups: string[][] = [];
      const keywords = new Map<string, string[]>();

      for (const pos of positions) {
        // Extract keywords from market ID (simplified)
        const words = pos.marketId.toLowerCase().split(/[-_\s]+/);
        for (const word of words) {
          if (word.length > 3) {
            const existing = keywords.get(word) || [];
            existing.push(pos.marketId);
            keywords.set(word, existing);
          }
        }
      }

      // Find groups with same keyword
      for (const [, markets] of keywords) {
        if (markets.length >= 3) {
          correlatedGroups.push([...new Set(markets)]);
        }
      }

      if (correlatedGroups.length > 0) {
        return {
          safe: true, // Warning but not blocking
          correlatedGroups,
          warning: `Potentially correlated positions detected`,
        };
      }

      return { safe: true, correlatedGroups: [] };
    },

    killSwitch(reason) {
      state.tradingEnabled = false;
      state.disabledReason = `MANUAL KILL: ${reason}`;
      state.disabledAt = new Date();
      state.resumeAt = undefined; // No auto-resume for manual kill

      addAlert({
        type: 'breaker_tripped',
        category: 'manual',
        message: `Manual kill switch activated: ${reason}`,
      });

      saveState();
      emitter.emit('killSwitch', reason);

      logger.error({ reason }, '🚨 MANUAL KILL SWITCH ACTIVATED');
    },

    resumeTrading() {
      if (state.tradingEnabled) {
        return true;
      }

      state.tradingEnabled = true;
      state.disabledReason = undefined;
      state.disabledAt = undefined;
      state.resumeAt = undefined;

      saveState();
      emitter.emit('tradingResumed', { auto: false });

      logger.info('Trading manually resumed');
      return true;
    },

    resetDaily() {
      state.dailyPnL = 0;
      state.dailyTrades = 0;
      state.alerts = state.alerts.filter((a) => a.category !== 'daily_loss');

      saveState();
      logger.info('Daily safety counters reset');
    },

    getAlerts(since) {
      if (since) {
        return state.alerts.filter((a) => a.timestamp >= since);
      }
      return [...state.alerts];
    },

    clearAlerts() {
      state.alerts = [];
    },
  } as Partial<SafetyManager>);

  // Schedule daily reset at midnight
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    emitter.resetDaily();
    // Then reset every 24 hours
    setInterval(() => emitter.resetDaily(), 24 * 60 * 60 * 1000);
  }, msUntilMidnight);

  logger.info({ config: cfg }, 'Safety manager initialized');
  return emitter;
}
