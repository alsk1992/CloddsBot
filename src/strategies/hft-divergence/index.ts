/**
 * HFT Divergence Strategy — Module entry point
 *
 * Detects spot vs Polymarket price divergences across multiple
 * time windows and threshold buckets, generating strategy-tagged
 * signals matching CLAUDE.md encoding: BTC_DOWN_s12-14_w15
 */

export { createHftDivergenceEngine, type HftDivergenceEngine } from './strategy.js';
export { createDivergenceDetector, type DivergenceDetector } from './detector.js';
export { createMarketRotator, type MarketRotator } from './market-rotator.js';
export { createDivPositionManager, type DivPositionManager } from './position-manager.js';
export type {
  HftDivergenceConfig,
  ThresholdBucket,
  DivergenceSignal,
  Direction,
  DivMarket,
  DivPosition,
  DivClosedPosition,
  DivExitReason,
  ExitSignal,
  DivStats,
} from './types.js';
