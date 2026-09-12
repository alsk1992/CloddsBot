/**
 * Process-wide pre-trade gate shared by prediction, futures, and swap paths.
 *
 * The gateway installs the active safety sources once. Execution modules that are
 * loaded lazily (for example the futures skill) still consult the same gate.
 */

export interface TradeGateSource {
  canTrade(): boolean;
  getState?(): unknown;
}

export interface TradeGateConfig {
  circuitBreaker?: TradeGateSource | null;
  safety?: TradeGateSource | null;
  maxOrderSize?: number | (() => number | undefined);
}

export interface PreTradeCheck {
  label: string;
  notionalUsd?: number;
  /** Additional caller-specific cap. The strictest positive cap wins. */
  maxOrderSize?: number;
  /** Reject when a USD notional cannot be established. */
  requireNotional?: boolean;
  /** Apply breaker/kill-switch checks but allow a risk-reducing exit over the cap. */
  skipSizeLimit?: boolean;
}

let activeGate: TradeGateConfig | null = null;

export function configurePreTradeGate(config: TradeGateConfig | null): void {
  activeGate = config;
}

function stateReason(source: TradeGateSource, fallback: string): string {
  const state = source.getState?.();
  if (!state || typeof state !== 'object') return fallback;
  const record = state as Record<string, unknown>;
  const reason = record.tripReason ?? record.disabledReason;
  return typeof reason === 'string' && reason ? reason : fallback;
}

function checkSource(source: TradeGateSource | null | undefined, fallback: string): string | null {
  if (!source) return null;
  try {
    return source.canTrade() ? null : stateReason(source, fallback);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `${fallback}: safety check failed (${detail})`;
  }
}

function configuredMaxOrderSize(): number | undefined {
  const configured = activeGate?.maxOrderSize;
  return typeof configured === 'function' ? configured() : configured;
}

export function validatePreTrade(check: PreTradeCheck): string | null {
  const circuitError = checkSource(activeGate?.circuitBreaker, 'circuit breaker is tripped');
  if (circuitError) return `Trading blocked for ${check.label}: ${circuitError}`;

  const safetyError = checkSource(activeGate?.safety, 'trading is disabled by the safety manager');
  if (safetyError) return `Trading blocked for ${check.label}: ${safetyError}`;

  if (check.skipSizeLimit) return null;

  if (check.notionalUsd !== undefined && (!Number.isFinite(check.notionalUsd) || check.notionalUsd <= 0)) {
    return `Trading blocked for ${check.label}: invalid USD notional`;
  }

  if (check.requireNotional && check.notionalUsd === undefined) {
    return `Trading blocked for ${check.label}: USD notional could not be determined`;
  }

  const limits = [configuredMaxOrderSize(), check.maxOrderSize]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const limit = limits.length > 0 ? Math.min(...limits) : undefined;

  if (limit !== undefined && check.notionalUsd !== undefined && check.notionalUsd > limit) {
    return `Trading blocked for ${check.label}: order size $${check.notionalUsd.toFixed(2)} exceeds max $${limit}`;
  }

  return null;
}

