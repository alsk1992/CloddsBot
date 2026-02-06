/**
 * HFT Divergence Strategy — Types
 *
 * Matches firstorder.rs strategy tag encoding:
 *   {ASSET}_{DIR}_s{bucket}_w{window}
 *   e.g. BTC_DOWN_s12-14_w15
 */

// ── Config ──────────────────────────────────────────────────────────────────

export interface ThresholdBucket {
  min: number;  // e.g. 0.08
  max: number;  // e.g. 0.10, Infinity for "0.20+"
}

export interface HftDivergenceConfig {
  // Market selection
  assets: string[];                    // ['BTC', 'ETH', 'SOL', 'XRP']
  marketDurationSec: number;           // 900 (15 min)

  // Signal detection — matches firstorder.rs strategy encoding
  windows: number[];                   // [5, 10, 15, 30, 60, 90, 120] seconds
  thresholdBuckets: ThresholdBucket[];
  minSpotMovePct: number;              // 0.08
  maxPolyFreshnessSec: number;         // 5
  maxPolyMidForEntry: number;          // 0.85 — skip if poly already moved too far

  // Execution
  defaultSizeUsd: number;              // 20
  maxPositionSizeUsd: number;          // 100
  maxConcurrentPositions: number;      // 3
  preferMaker: boolean;                // true
  makerTimeoutMs: number;              // 15000
  takerBufferCents: number;            // 0.01
  negRisk: boolean;                    // true (15-min markets)

  // Exit rules
  takeProfitPct: number;               // 15
  stopLossPct: number;                 // 25
  trailingStopPct: number;             // 8
  trailingActivationPct: number;       // 10
  forceExitSec: number;                // 30
  timeExitSec: number;                 // 120 (sell 2min before expiry)

  // Risk
  maxDailyLossUsd: number;             // 200
  cooldownAfterLossSec: number;        // 30
  cooldownAfterExitSec: number;        // 15
  dryRun: boolean;                     // true (safe default)
}

// ── Signal ──────────────────────────────────────────────────────────────────

export type Direction = 'up' | 'down';

export interface DivergenceSignal {
  asset: string;
  direction: Direction;
  spotMovePct: number;
  windowSec: number;
  polyMidPrice: number;
  polyFreshnessSec: number;
  spotPrice: number;
  /** Threshold bucket label: "s08-10", "s10-12", "s20+" */
  bucket: string;
  /** Full strategy tag: "BTC_DOWN_s12-14_w15" */
  strategyTag: string;
  /** Window-only tag: "BTC_DOWN_w15" */
  windowTag: string;
  /** Threshold-only tag: "BTC_DOWN_s12-14" */
  thresholdTag: string;
  confidence: number;
  timestamp: number;
}

// ── Market ──────────────────────────────────────────────────────────────────

export interface DivMarket {
  asset: string;
  conditionId: string;
  upTokenId: string;
  downTokenId: string;
  upPrice: number;
  downPrice: number;
  expiresAt: number;
  roundSlot: number;
  negRisk: boolean;
  question: string;
}

// ── Position ────────────────────────────────────────────────────────────────

export interface DivPosition {
  id: string;
  asset: string;
  direction: Direction;
  tokenId: string;
  conditionId: string;
  strategyTag: string;
  entryPrice: number;
  currentPrice: number;
  shares: number;
  costUsd: number;
  highWaterMark: number;
  trailingActivated: boolean;
  enteredAt: number;
  expiresAt: number;
}

export type DivExitReason =
  | 'take_profit'
  | 'stop_loss'
  | 'trailing_stop'
  | 'time_exit'
  | 'force_exit'
  | 'manual';

export interface DivClosedPosition extends DivPosition {
  exitPrice: number;
  exitReason: DivExitReason;
  exitedAt: number;
  pnlUsd: number;
  pnlPct: number;
  holdTimeSec: number;
}

export interface ExitSignal {
  positionId: string;
  reason: DivExitReason;
  exitPrice: number;
}

// ── Stats ───────────────────────────────────────────────────────────────────

export interface DivStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  dailyPnlUsd: number;
  openPositions: number;
  bestTradePct: number;
  worstTradePct: number;
  avgHoldTimeSec: number;
  /** Signals generated per strategy tag */
  signalCounts: Record<string, number>;
}
