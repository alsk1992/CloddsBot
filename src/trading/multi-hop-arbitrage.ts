import type { Platform } from '../types';

export type SettlementDomain = 'cex' | 'solana' | 'evm' | 'offchain';
export type PathExecutionHint = 'market' | 'atomic_bundle' | 'exact_in';
export type PathSettlementStrategy = 'standard' | 'solana_atomic_bundle' | 'evm_exact_in';

export interface ArbitrageHopQuote {
  platform: Platform;
  marketId: string;
  fromAsset: string;
  toAsset: string;
  /** Output units received per 1 unit of input before fees/slippage. */
  rate: number;
  /** Max input capacity in units of fromAsset. */
  maxInputSize: number;
  /** Optional USD mark for one unit of fromAsset. Used for sizing/profit display. */
  inputAssetUsd?: number;
  timestamp?: number | Date;
  latencyMs?: number;
  feeBps?: number;
  slippageBps?: number;
  settlement?: SettlementDomain;
  atomicEligible?: boolean;
  exactInOnly?: boolean;
}

export interface MultiHopArbitragePlannerConfig {
  enabled?: boolean;
  maxHops?: number;
  minNetEdgeBps?: number;
  minTargetProfitUsd?: number;
  maxNotionalUsd?: number;
  maxQuoteAgeMs?: number;
  maxLatencyMs?: number;
  atomicSolanaBundles?: boolean;
  evmEntryMode?: 'exact_in';
}

export interface MultiHopArbitrageInstruction {
  order: number;
  platform: Platform;
  marketId: string;
  fromAsset: string;
  toAsset: string;
  inputSize: number;
  expectedOutputSize: number;
  latencyMs: number;
  feeBps: number;
  slippageBps: number;
  settlement: SettlementDomain;
  executionHint: PathExecutionHint;
  atomicGroup?: string;
  exactIn: boolean;
}

export interface MultiHopArbitragePlan {
  cycleId: string;
  startAsset: string;
  hopCount: number;
  inputSize: number;
  expectedOutputSize: number;
  expectedProfitUnits: number;
  expectedProfitUsd?: number;
  netEdgeBps: number;
  totalFeeBps: number;
  totalSlippageBps: number;
  totalLatencyMs: number;
  settlementStrategy: PathSettlementStrategy;
  warnings: string[];
  instructions: MultiHopArbitrageInstruction[];
}

const DEFAULT_CONFIG: Required<MultiHopArbitragePlannerConfig> = {
  enabled: false,
  maxHops: 4,
  minNetEdgeBps: 20,
  minTargetProfitUsd: 1,
  maxNotionalUsd: 500,
  maxQuoteAgeMs: 1_500,
  maxLatencyMs: 2_000,
  atomicSolanaBundles: true,
  evmEntryMode: 'exact_in',
};

function mergeConfig(
  base: Required<MultiHopArbitragePlannerConfig>,
  next: MultiHopArbitragePlannerConfig
): Required<MultiHopArbitragePlannerConfig> {
  const merged = { ...base } as Required<MultiHopArbitragePlannerConfig>;

  for (const [key, value] of Object.entries(next) as Array<
    [keyof MultiHopArbitragePlannerConfig, MultiHopArbitragePlannerConfig[keyof MultiHopArbitragePlannerConfig]]
  >) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}

function toMillis(value: number | Date | undefined): number | null {
  if (value === undefined) return null;
  return value instanceof Date ? value.getTime() : value;
}

function getAgeMs(hop: ArbitrageHopQuote, nowMs: number): number {
  const ts = toMillis(hop.timestamp);
  if (ts === null) return 0;
  return Math.max(0, nowMs - ts);
}

function getLatencyMs(hop: ArbitrageHopQuote): number {
  return hop.latencyMs ?? 1_000;
}

function getFeeBps(hop: ArbitrageHopQuote): number {
  return hop.feeBps ?? 0;
}

function getSlippageBps(hop: ArbitrageHopQuote): number {
  return hop.slippageBps ?? 0;
}

function getSettlement(hop: ArbitrageHopQuote): SettlementDomain {
  return hop.settlement ?? 'offchain';
}

function hopKey(hop: ArbitrageHopQuote): string {
  return `${hop.platform}:${hop.marketId}:${hop.fromAsset}:${hop.toAsset}`;
}

function canonicalCycleId(path: ArbitrageHopQuote[]): string {
  const tokens = path.map(hopKey);
  const rotations = tokens.map((_, index) => tokens.slice(index).concat(tokens.slice(0, index)).join('>'));
  return rotations.sort()[0];
}

function determineSettlementStrategy(
  hops: ArbitrageHopQuote[],
  cfg: Required<MultiHopArbitragePlannerConfig>
): PathSettlementStrategy {
  const settlements = hops.map(getSettlement);
  const touchesEvm = settlements.some((settlement) => settlement === 'evm');
  if (
    cfg.atomicSolanaBundles &&
    settlements.every((settlement) => settlement === 'solana') &&
    hops.every((hop) => hop.atomicEligible !== false)
  ) {
    return 'solana_atomic_bundle';
  }

  if (
    cfg.evmEntryMode === 'exact_in' &&
    touchesEvm &&
    settlements.every((settlement) => settlement === 'evm' || settlement === 'offchain')
  ) {
    return 'evm_exact_in';
  }

  return 'standard';
}

function buildInstructions(
  hops: ArbitrageHopQuote[],
  inputSize: number,
  strategy: PathSettlementStrategy,
  cycleId: string
): MultiHopArbitrageInstruction[] {
  const atomicGroup = strategy === 'solana_atomic_bundle' ? `bundle:${cycleId}` : undefined;
  let currentSize = inputSize;

  return hops.map((hop, index) => {
    const feeBps = getFeeBps(hop);
    const slippageBps = getSlippageBps(hop);
    const netRate = hop.rate * (1 - (feeBps + slippageBps) / 10_000);
    const expectedOutputSize = currentSize * netRate;

    const instruction: MultiHopArbitrageInstruction = {
      order: index + 1,
      platform: hop.platform,
      marketId: hop.marketId,
      fromAsset: hop.fromAsset,
      toAsset: hop.toAsset,
      inputSize: currentSize,
      expectedOutputSize,
      latencyMs: getLatencyMs(hop),
      feeBps,
      slippageBps,
      settlement: getSettlement(hop),
      executionHint: strategy === 'solana_atomic_bundle'
        ? 'atomic_bundle'
        : strategy === 'evm_exact_in'
          ? 'exact_in'
          : 'market',
      atomicGroup,
      exactIn: strategy === 'evm_exact_in' || hop.exactInOnly === true,
    };

    currentSize = expectedOutputSize;
    return instruction;
  });
}

function buildWarnings(
  hops: ArbitrageHopQuote[],
  cfg: Required<MultiHopArbitragePlannerConfig>,
  nowMs: number
): string[] {
  const warnings: string[] = [];
  const settlements = new Set(hops.map(getSettlement));
  const maxLatency = Math.max(...hops.map(getLatencyMs));
  const maxAge = Math.max(...hops.map((hop) => getAgeMs(hop, nowMs)));

  if (settlements.size > 1) warnings.push('mixed_settlement_domains');
  if (maxLatency > cfg.maxLatencyMs * 0.75) warnings.push('latency_budget_tight');
  if (maxAge > cfg.maxQuoteAgeMs * 0.5) warnings.push('quotes_nearing_stale_threshold');

  if (
    hops.some((hop) => getSettlement(hop) === 'solana') &&
    !hops.every((hop) => hop.atomicEligible !== false)
  ) {
    warnings.push('solana_path_not_fully_atomic');
  }

  return warnings;
}

function buildPlan(
  hops: ArbitrageHopQuote[],
  startInputCap: number,
  netMultiplier: number,
  cfg: Required<MultiHopArbitragePlannerConfig>,
  nowMs: number
): MultiHopArbitragePlan | null {
  if (hops.length < 2 || hops.length > cfg.maxHops) return null;
  if (netMultiplier <= 1) return null;

  const firstHop = hops[0];
  const notionalCap = firstHop.inputAssetUsd
    ? cfg.maxNotionalUsd / firstHop.inputAssetUsd
    : Number.POSITIVE_INFINITY;
  const inputSize = Math.min(startInputCap, notionalCap);
  if (!Number.isFinite(inputSize) || inputSize <= 0) return null;

  const expectedOutputSize = inputSize * netMultiplier;
  const expectedProfitUnits = expectedOutputSize - inputSize;
  const expectedProfitUsd = firstHop.inputAssetUsd !== undefined
    ? expectedProfitUnits * firstHop.inputAssetUsd
    : undefined;
  const netEdgeBps = (netMultiplier - 1) * 10_000;
  if (netEdgeBps < cfg.minNetEdgeBps) return null;
  if (expectedProfitUsd !== undefined && expectedProfitUsd < cfg.minTargetProfitUsd) return null;

  const totalFeeBps = hops.reduce((sum, hop) => sum + getFeeBps(hop), 0);
  const totalSlippageBps = hops.reduce((sum, hop) => sum + getSlippageBps(hop), 0);
  const totalLatencyMs = hops.reduce((sum, hop) => sum + getLatencyMs(hop), 0);
  const cycleId = canonicalCycleId(hops);
  const settlementStrategy = determineSettlementStrategy(hops, cfg);
  const instructions = buildInstructions(hops, inputSize, settlementStrategy, cycleId);
  const warnings = buildWarnings(hops, cfg, nowMs);
  if (expectedProfitUsd === undefined) warnings.push('usd_profit_unresolved');

  return {
    cycleId,
    startAsset: firstHop.fromAsset,
    hopCount: hops.length,
    inputSize,
    expectedOutputSize,
    expectedProfitUnits,
    expectedProfitUsd,
    netEdgeBps,
    totalFeeBps,
    totalSlippageBps,
    totalLatencyMs,
    settlementStrategy,
    warnings,
    instructions,
  };
}

export function findMultiHopArbitragePlans(
  hops: ArbitrageHopQuote[],
  config: MultiHopArbitragePlannerConfig = {},
  now: number | Date = Date.now()
): MultiHopArbitragePlan[] {
  const cfg = mergeConfig(DEFAULT_CONFIG, config);
  if (!cfg.enabled) return [];

  const nowMs = toMillis(now) ?? Date.now();
  const eligible = hops.filter((hop) => {
    if (hop.rate <= 0 || hop.maxInputSize <= 0) return false;
    if (getAgeMs(hop, nowMs) > cfg.maxQuoteAgeMs) return false;
    if (getLatencyMs(hop) > cfg.maxLatencyMs) return false;
    return true;
  });

  const adjacency = new Map<string, ArbitrageHopQuote[]>();
  for (const hop of eligible) {
    if (!adjacency.has(hop.fromAsset)) adjacency.set(hop.fromAsset, []);
    adjacency.get(hop.fromAsset)!.push(hop);
  }

  const results = new Map<string, MultiHopArbitragePlan>();

  function explore(
    startAsset: string,
    currentAsset: string,
    path: ArbitrageHopQuote[],
    visitedAssets: Set<string>,
    visitedHops: Set<string>,
    currentOutputPerUnit: number,
    startInputCap: number
  ): void {
    if (path.length >= cfg.maxHops) return;

    for (const hop of adjacency.get(currentAsset) ?? []) {
      const key = hopKey(hop);
      if (visitedHops.has(key)) continue;
      if (hop.toAsset !== startAsset && visitedAssets.has(hop.toAsset)) continue;

      const hopNetRate = hop.rate * (1 - (getFeeBps(hop) + getSlippageBps(hop)) / 10_000);
      if (hopNetRate <= 0) continue;

      const maxStartThroughHop = hop.maxInputSize / currentOutputPerUnit;
      const nextStartInputCap = Math.min(startInputCap, maxStartThroughHop);
      if (!Number.isFinite(nextStartInputCap) || nextStartInputCap <= 0) continue;

      const nextPath = [...path, hop];
      const nextOutputPerUnit = currentOutputPerUnit * hopNetRate;
      const nextVisitedHops = new Set(visitedHops);
      nextVisitedHops.add(key);

      if (hop.toAsset === startAsset && nextPath.length >= 2) {
        const plan = buildPlan(nextPath, nextStartInputCap, nextOutputPerUnit, cfg, nowMs);
        if (plan && !results.has(plan.cycleId)) {
          // Every rotation of the same physical cycle shares one cycleId and the same
          // economic value (up to floating-point noise from multiplication order), so
          // keep whichever rotation is discovered first instead of comparing noisy
          // netEdgeBps floats — that comparison made the winning rotation arbitrary.
          results.set(plan.cycleId, plan);
        }
        continue;
      }

      if (nextPath.length < cfg.maxHops) {
        const nextVisitedAssets = new Set(visitedAssets);
        nextVisitedAssets.add(hop.toAsset);
        explore(
          startAsset,
          hop.toAsset,
          nextPath,
          nextVisitedAssets,
          nextVisitedHops,
          nextOutputPerUnit,
          nextStartInputCap
        );
      }
    }
  }

  for (const startAsset of adjacency.keys()) {
    explore(startAsset, startAsset, [], new Set([startAsset]), new Set(), 1, Number.POSITIVE_INFINITY);
  }

  return [...results.values()].sort((a, b) => {
    if (b.netEdgeBps !== a.netEdgeBps) return b.netEdgeBps - a.netEdgeBps;
    return (b.expectedProfitUsd ?? 0) - (a.expectedProfitUsd ?? 0);
  });
}

export { DEFAULT_CONFIG as DEFAULT_MULTI_HOP_ARBITRAGE_CONFIG };
