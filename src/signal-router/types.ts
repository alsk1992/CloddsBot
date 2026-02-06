/**
 * Signal Router — Type Definitions
 *
 * Routes TradingSignals from the signal bus through risk validation
 * and position sizing into the execution service.
 */

import type { Platform } from '../types.js';
import type { TradingSignal } from '../gateway/signal-bus.js';

// ── Configuration ────────────────────────────────────────────────────────────

export interface SignalRouterConfig {
  /** Master switch (default: false — opt-in) */
  enabled?: boolean;
  /** Log signals but don't execute (default: true — safe) */
  dryRun?: boolean;

  // Filtering
  /** Which signal types to route (default: all) */
  signalTypes?: TradingSignal['type'][];
  /** Minimum signal strength to act on, 0-1 (default: 0.5) */
  minStrength?: number;
  /** Market IDs to skip */
  excludedMarkets?: string[];
  /** Only execute on these platforms (default: ['polymarket', 'kalshi']) */
  enabledPlatforms?: Platform[];

  // Sizing
  /** Base position size in USD (default: 10) */
  defaultSizeUsd?: number;
  /** Maximum position size in USD (default: 100) */
  maxSizeUsd?: number;
  /** Scale size by signal strength (default: true) */
  strengthScaling?: boolean;

  // Risk
  /** Maximum daily loss before halting in USD (default: 200) */
  maxDailyLoss?: number;
  /** Maximum concurrent open positions (default: 5) */
  maxConcurrentPositions?: number;
  /** Per-market cooldown in ms between trades (default: 120_000 = 2 min) */
  cooldownMs?: number;

  // Execution
  /** Order type: maker (post-only), limit, or market (default: 'maker') */
  orderMode?: 'maker' | 'limit' | 'market';
  /** Maximum slippage as decimal (default: 0.02 = 2%) */
  maxSlippage?: number;
  /** Use smart router for platform selection (default: true) */
  useSmartRouter?: boolean;
  /** Filter on feature engine market conditions (default: true) */
  useFeatureFilters?: boolean;
}

// ── Execution tracking ───────────────────────────────────────────────────────

export interface SignalExecution {
  id: string;
  signal: TradingSignal;
  status: 'executed' | 'rejected' | 'dry_run' | 'failed';
  /** Rejection or failure reason */
  reason?: string;
  orderSize?: number;
  orderPrice?: number;
  orderId?: string;
  fillPrice?: number;
  timestamp: number;
}

// ── Statistics ────────────────────────────────────────────────────────────────

export interface SignalRouterStats {
  signalsReceived: number;
  signalsExecuted: number;
  signalsRejected: number;
  signalsFailed: number;
  dryRunCount: number;
  currentDailyPnL: number;
  currentOpenPositions: number;
  skipReasons: Record<string, number>;
}
