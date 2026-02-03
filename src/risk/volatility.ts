/**
 * Volatility Regime Detection
 *
 * Classifies market conditions into regimes and adjusts position sizing:
 * - low: calm markets, slightly larger positions (1.2x)
 * - normal: baseline conditions (1.0x)
 * - high: elevated volatility, half size (0.5x)
 * - extreme: crisis conditions, quarter size or halt (0.25x)
 *
 * Uses rolling standard deviation and ATR-style calculations.
 */

// =============================================================================
// TYPES
// =============================================================================

export type VolatilityRegime = 'low' | 'normal' | 'high' | 'extreme';

export interface VolatilityConfig {
  /** Number of trades/observations to look back (default: 30) */
  lookbackWindow: number;
  /** Stddev threshold for low-to-normal boundary (default: 0.5) */
  lowThreshold: number;
  /** Stddev threshold for normal-to-high boundary (default: 1.5) */
  highThreshold: number;
  /** Stddev threshold for high-to-extreme boundary (default: 3.0) */
  extremeThreshold: number;
  /** Position size multiplier for each regime */
  regimeMultipliers: Record<VolatilityRegime, number>;
  /** Halt trading in extreme regime instead of reducing size (default: false) */
  haltOnExtreme: boolean;
}

export interface VolatilitySnapshot {
  /** Current regime classification */
  regime: VolatilityRegime;
  /** Position size multiplier for this regime */
  sizeMultiplier: number;
  /** Rolling standard deviation of P&L */
  rollingStdDev: number;
  /** Average True Range (ATR) of recent P&L */
  atr: number;
  /** Mean P&L in the window */
  meanPnL: number;
  /** Number of observations in the window */
  sampleSize: number;
  /** Whether trading should halt (extreme + haltOnExtreme) */
  shouldHalt: boolean;
}

const DEFAULT_CONFIG: VolatilityConfig = {
  lookbackWindow: 30,
  lowThreshold: 0.5,
  highThreshold: 1.5,
  extremeThreshold: 3.0,
  regimeMultipliers: {
    low: 1.2,
    normal: 1.0,
    high: 0.5,
    extreme: 0.25,
  },
  haltOnExtreme: false,
};

// =============================================================================
// DETECTOR
// =============================================================================

export interface VolatilityDetector {
  /** Add a P&L observation */
  addObservation(pnlPct: number): void;
  /** Detect current volatility regime */
  detect(): VolatilitySnapshot;
  /** Get the position size multiplier for current regime */
  getSizeMultiplier(): number;
  /** Get current regime */
  getRegime(): VolatilityRegime;
  /** Get the rolling P&L window */
  getWindow(): number[];
  /** Reset observations */
  reset(): void;
}

export function createVolatilityDetector(config: Partial<VolatilityConfig> = {}): VolatilityDetector {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const window: number[] = [];

  // Baseline calibration — computed from the first full window of data.
  // Until we have enough data, use the config thresholds directly.
  let baselineStdDev: number | null = null;

  function addObservation(pnlPct: number): void {
    window.push(pnlPct);
    while (window.length > cfg.lookbackWindow) {
      window.shift();
    }

    // Calibrate baseline from first full window
    if (baselineStdDev === null && window.length >= cfg.lookbackWindow) {
      baselineStdDev = computeStdDev(window);
    }
  }

  function computeStdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  function computeATR(values: number[]): number {
    if (values.length < 2) return 0;
    let totalRange = 0;
    for (let i = 1; i < values.length; i++) {
      totalRange += Math.abs(values[i] - values[i - 1]);
    }
    return totalRange / (values.length - 1);
  }

  function classifyRegime(stdDev: number): VolatilityRegime {
    // If we have a baseline, classify relative to it using z-score of volatility.
    // Otherwise use absolute thresholds (as percentages).
    const threshold = baselineStdDev ?? 1;
    const ratio = threshold > 0 ? stdDev / threshold : stdDev;

    if (ratio <= cfg.lowThreshold) return 'low';
    if (ratio <= cfg.highThreshold) return 'normal';
    if (ratio <= cfg.extremeThreshold) return 'high';
    return 'extreme';
  }

  function detect(): VolatilitySnapshot {
    if (window.length < 2) {
      return {
        regime: 'normal',
        sizeMultiplier: cfg.regimeMultipliers.normal,
        rollingStdDev: 0,
        atr: 0,
        meanPnL: window.length === 1 ? window[0] : 0,
        sampleSize: window.length,
        shouldHalt: false,
      };
    }

    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const stdDev = computeStdDev(window);
    const atr = computeATR(window);
    const regime = classifyRegime(stdDev);
    const sizeMultiplier = cfg.regimeMultipliers[regime];

    return {
      regime,
      sizeMultiplier,
      rollingStdDev: Math.round(stdDev * 10000) / 10000,
      atr: Math.round(atr * 10000) / 10000,
      meanPnL: Math.round(mean * 10000) / 10000,
      sampleSize: window.length,
      shouldHalt: regime === 'extreme' && cfg.haltOnExtreme,
    };
  }

  function getSizeMultiplier(): number {
    return detect().sizeMultiplier;
  }

  function getRegime(): VolatilityRegime {
    return detect().regime;
  }

  return {
    addObservation,
    detect,
    getSizeMultiplier,
    getRegime,
    getWindow: () => [...window],
    reset: () => {
      window.length = 0;
      baselineStdDev = null;
    },
  };
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * One-shot regime detection from an array of P&L percentages
 */
export function detectRegime(pnlPcts: number[], config: Partial<VolatilityConfig> = {}): VolatilitySnapshot {
  const detector = createVolatilityDetector({ ...config, lookbackWindow: pnlPcts.length || 30 });
  for (const pnl of pnlPcts) {
    detector.addObservation(pnl);
  }
  return detector.detect();
}
