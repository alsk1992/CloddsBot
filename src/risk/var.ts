/**
 * Value-at-Risk (VaR) and Conditional VaR (Expected Shortfall)
 *
 * Provides portfolio-level and per-position risk metrics:
 * - Historical VaR using rolling P&L window
 * - Parametric VaR assuming normal distribution
 * - CVaR (average loss beyond VaR threshold)
 * - Configurable confidence levels (95%, 99%)
 */

// =============================================================================
// TYPES
// =============================================================================

export interface VaRConfig {
  /** Number of trades in the rolling window (default: 100) */
  windowSize: number;
  /** Confidence level as decimal, e.g. 0.95 (default: 0.95) */
  confidenceLevel: number;
}

export interface VaRResult {
  /** Historical VaR — the loss at the confidence percentile */
  historicalVaR: number;
  /** Parametric VaR assuming normal distribution */
  parametricVaR: number;
  /** Conditional VaR (Expected Shortfall) — average loss beyond VaR */
  cvar: number;
  /** Confidence level used */
  confidenceLevel: number;
  /** Number of observations in the window */
  sampleSize: number;
  /** Mean P&L in the window */
  meanPnL: number;
  /** Standard deviation of P&L */
  stdDev: number;
}

export interface PositionVaR {
  /** Position identifier (e.g. "polymarket:market123:YES") */
  positionId: string;
  /** VaR for this position */
  var95: number;
  /** Contribution to portfolio VaR (approximate) */
  varContribution: number;
}

export interface PnLRecord {
  /** P&L in USD */
  pnlUsd: number;
  /** P&L as percentage */
  pnlPct: number;
  /** Position identifier (optional, for per-position VaR) */
  positionId?: string;
  /** Timestamp */
  timestamp: Date;
}

const DEFAULT_CONFIG: VaRConfig = {
  windowSize: 100,
  confidenceLevel: 0.95,
};

// =============================================================================
// CALCULATOR
// =============================================================================

export interface VaRCalculator {
  /** Add a P&L observation */
  addObservation(record: PnLRecord): void;
  /** Calculate portfolio-level VaR at default confidence */
  calculate(): VaRResult;
  /** Calculate VaR at a specific confidence level */
  calculateAt(confidenceLevel: number): VaRResult;
  /** Calculate per-position VaR */
  positionVaR(): PositionVaR[];
  /** Get the rolling P&L window */
  getWindow(): PnLRecord[];
  /** Reset all observations */
  reset(): void;
}

export function createVaRCalculator(config: Partial<VaRConfig> = {}): VaRCalculator {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const window: PnLRecord[] = [];

  function addObservation(record: PnLRecord): void {
    window.push(record);
    while (window.length > cfg.windowSize) {
      window.shift();
    }
  }

  function computeStats(values: number[]): { mean: number; stdDev: number } {
    if (values.length === 0) return { mean: 0, stdDev: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    return { mean, stdDev: Math.sqrt(variance) };
  }

  /** Normal distribution inverse CDF (Beasley-Springer-Moro approximation) */
  function normInv(p: number): number {
    const a = [
      -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
      1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0,
    ];
    const b = [
      -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
      6.680131188771972e1, -1.328068155288572e1,
    ];
    const c = [
      -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
      -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0,
    ];
    const d = [
      7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
      3.754408661907416e0,
    ];

    const pLow = 0.02425;
    const pHigh = 1 - pLow;

    let q: number, r: number;

    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
      );
    } else if (p <= pHigh) {
      q = p - 0.5;
      r = q * q;
      return (
        ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
      );
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
      );
    }
  }

  function calculateAt(confidenceLevel: number): VaRResult {
    const pnls = window.map((r) => r.pnlUsd);

    if (pnls.length < 2) {
      return {
        historicalVaR: 0,
        parametricVaR: 0,
        cvar: 0,
        confidenceLevel,
        sampleSize: pnls.length,
        meanPnL: pnls.length === 1 ? pnls[0] : 0,
        stdDev: 0,
      };
    }

    const { mean, stdDev } = computeStats(pnls);

    // Historical VaR: sort losses and pick the percentile
    const sorted = [...pnls].sort((a, b) => a - b);
    const index = Math.floor((1 - confidenceLevel) * sorted.length);
    const historicalVaR = -sorted[Math.max(0, index)];

    // Parametric VaR: assume normal distribution
    const zScore = normInv(confidenceLevel);
    const parametricVaR = -(mean - zScore * stdDev);

    // CVaR (Expected Shortfall): average of losses beyond VaR
    const tailCount = Math.max(1, index + 1);
    const tailLosses = sorted.slice(0, tailCount);
    const cvar = -(tailLosses.reduce((a, b) => a + b, 0) / tailLosses.length);

    return {
      historicalVaR: Math.max(0, historicalVaR),
      parametricVaR: Math.max(0, parametricVaR),
      cvar: Math.max(0, cvar),
      confidenceLevel,
      sampleSize: pnls.length,
      meanPnL: Math.round(mean * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
    };
  }

  function calculate(): VaRResult {
    return calculateAt(cfg.confidenceLevel);
  }

  function positionVaR(): PositionVaR[] {
    // Group observations by positionId
    const byPosition = new Map<string, number[]>();
    for (const record of window) {
      const id = record.positionId || 'unknown';
      const existing = byPosition.get(id) || [];
      existing.push(record.pnlUsd);
      byPosition.set(id, existing);
    }

    const portfolioVar = calculate();
    const results: PositionVaR[] = [];

    for (const [positionId, pnls] of byPosition) {
      if (pnls.length < 2) {
        results.push({ positionId, var95: 0, varContribution: 0 });
        continue;
      }

      const sorted = [...pnls].sort((a, b) => a - b);
      const index = Math.max(0, Math.floor(0.05 * sorted.length));
      const posVar = -sorted[index];

      results.push({
        positionId,
        var95: Math.max(0, posVar),
        varContribution: portfolioVar.historicalVaR > 0
          ? Math.max(0, posVar) / portfolioVar.historicalVaR
          : 0,
      });
    }

    return results.sort((a, b) => b.var95 - a.var95);
  }

  return {
    addObservation,
    calculate,
    calculateAt,
    positionVaR,
    getWindow: () => [...window],
    reset: () => { window.length = 0; },
  };
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Quick VaR calculation from an array of P&L values
 */
export function calculateVaR(pnls: number[], confidenceLevel: number = 0.95): number {
  if (pnls.length < 2) return 0;
  const sorted = [...pnls].sort((a, b) => a - b);
  const index = Math.max(0, Math.floor((1 - confidenceLevel) * sorted.length));
  return Math.max(0, -sorted[index]);
}

/**
 * Quick CVaR (Expected Shortfall) from an array of P&L values
 */
export function calculateCVaR(pnls: number[], confidenceLevel: number = 0.95): number {
  if (pnls.length < 2) return 0;
  const sorted = [...pnls].sort((a, b) => a - b);
  const tailCount = Math.max(1, Math.floor((1 - confidenceLevel) * sorted.length) + 1);
  const tailLosses = sorted.slice(0, tailCount);
  return Math.max(0, -(tailLosses.reduce((a, b) => a + b, 0) / tailLosses.length));
}
