import type { TradeVenue } from '../types';

export type VenueArbitrageExecutionStyle =
  | 'taker_taker'
  | 'maker_taker'
  | 'maker_maker';

export interface VenueQuote {
  /** Cross-venue normalized key for the same contract/outcome. */
  instrumentId: string;
  platform: TradeVenue;
  marketId: string;
  outcome: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  /** Milliseconds since epoch or Date for staleness checks. */
  timestamp?: number | Date;
  /** Optional venue-specific execution latency override. */
  latencyMs?: number;
  /** Optional venue-specific fee overrides. */
  takerFeeBps?: number;
  makerFeeBps?: number;
  /** Existing inventory on the venue in USD notional. */
  inventoryUsd?: number;
  /** Per-venue cap in shares/contracts. */
  maxOrderSize?: number;
}

export interface VenueArbitragePlannerConfig {
  enabled?: boolean;
  platforms?: TradeVenue[];
  executionStyle?: VenueArbitrageExecutionStyle;
  minNetEdgeBps?: number;
  minTargetProfitUsd?: number;
  minSize?: number;
  maxSize?: number;
  maxNotionalUsd?: number;
  maxQuoteAgeMs?: number;
  maxLatencyMs?: number;
  latencyPenaltyBpsPerSecond?: number;
  stalePenaltyBps?: number;
  inventoryPenaltyBpsPer100Usd?: number;
  maxInventoryUsd?: number;
  requireCrossedMarket?: boolean;
}

export interface VenueArbitrageLeg {
  order: number;
  platform: TradeVenue;
  marketId: string;
  outcome: string;
  side: 'buy' | 'sell';
  role: 'maker' | 'taker';
  price: number;
  size: number;
  feeBps: number;
  latencyMs: number;
  quoteAgeMs: number;
  reason: string;
}

export interface VenueArbitragePlan {
  instrumentId: string;
  buyPlatform: TradeVenue;
  sellPlatform: TradeVenue;
  buyMarketId: string;
  sellMarketId: string;
  outcome: string;
  executionStyle: VenueArbitrageExecutionStyle;
  size: number;
  notionalUsd: number;
  grossSpread: number;
  grossEdgeBps: number;
  netEdgeBps: number;
  expectedNetUsd: number;
  feesBps: number;
  latencyPenaltyBps: number;
  stalePenaltyBps: number;
  inventoryPenaltyBps: number;
  score: number;
  warnings: string[];
  legs: VenueArbitrageLeg[];
}

export interface VenueArbitragePlanner {
  getConfig(): Required<VenueArbitragePlannerConfig>;
  updateConfig(next: Partial<VenueArbitragePlannerConfig>): void;
  findPlans(quotes: VenueQuote[], now?: number | Date): VenueArbitragePlan[];
  rankPlans(plans: VenueArbitragePlan[]): VenueArbitragePlan[];
}

const DEFAULT_TAKER_FEE_BPS: Partial<Record<TradeVenue, number>> = {
  polymarket: 0,
  kalshi: 120,
  manifold: 0,
  metaculus: 0,
  predictit: 1000,
  predictfun: 0,
  opinion: 50,
  drift: 10,
  betfair: 200,
  smarkets: 200,
  hyperliquid: 4.5,
  binance: 10,
  bybit: 10,
  mexc: 20,
  jupiter: 30,
  raydium: 25,
  orca: 25,
  meteora: 20,
  uniswap: 30,
  oneinch: 35,
  pancakeswap: 25,
  lighter: 6,
};

const DEFAULT_MAKER_FEE_BPS: Partial<Record<TradeVenue, number>> = {
  polymarket: 0,
  kalshi: 17,
  manifold: 0,
  metaculus: 0,
  predictit: 0,
  predictfun: 0,
  opinion: 10,
  drift: 0,
  betfair: 0,
  smarkets: 0,
  hyperliquid: 1.5,
  binance: 2,
  bybit: 1,
  mexc: 0,
  jupiter: 0,
  raydium: 0,
  orca: 0,
  meteora: 0,
  uniswap: 0,
  oneinch: 0,
  pancakeswap: 0,
  lighter: 0,
};

const DEFAULT_EXECUTION_LATENCY_MS: Partial<Record<TradeVenue, number>> = {
  polymarket: 500,
  kalshi: 800,
  manifold: 300,
  metaculus: 300,
  predictit: 2000,
  predictfun: 600,
  opinion: 700,
  drift: 400,
  betfair: 600,
  smarkets: 700,
  hyperliquid: 150,
  binance: 120,
  bybit: 140,
  mexc: 160,
  jupiter: 180,
  raydium: 120,
  orca: 120,
  meteora: 140,
  uniswap: 220,
  oneinch: 260,
  pancakeswap: 240,
  lighter: 90,
};

const DEFAULT_CONFIG: Required<VenueArbitragePlannerConfig> = {
  enabled: false,
  platforms: ['polymarket', 'kalshi'],
  executionStyle: 'taker_taker',
  minNetEdgeBps: 15,
  minTargetProfitUsd: 1,
  minSize: 1,
  maxSize: 1000,
  maxNotionalUsd: 500,
  maxQuoteAgeMs: 1_500,
  maxLatencyMs: 2_000,
  latencyPenaltyBpsPerSecond: 12,
  stalePenaltyBps: 4,
  inventoryPenaltyBpsPer100Usd: 0.5,
  maxInventoryUsd: 2_500,
  requireCrossedMarket: true,
};

function mergeConfig(
  base: Required<VenueArbitragePlannerConfig>,
  next: VenueArbitragePlannerConfig
): Required<VenueArbitragePlannerConfig> {
  const merged = { ...base } as Required<VenueArbitragePlannerConfig>;

  for (const [key, value] of Object.entries(next) as Array<
    [keyof VenueArbitragePlannerConfig, VenueArbitragePlannerConfig[keyof VenueArbitragePlannerConfig]]
  >) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value;
    }
  }

  return merged;
}

function toMillis(value: number | Date | undefined): number | null {
  if (value === undefined) return null;
  return value instanceof Date ? value.getTime() : value;
}

function getQuoteAgeMs(quote: VenueQuote, nowMs: number): number {
  const ts = toMillis(quote.timestamp);
  if (ts === null) return 0;
  return Math.max(0, nowMs - ts);
}

function getLatencyMs(quote: VenueQuote): number {
  return quote.latencyMs ?? DEFAULT_EXECUTION_LATENCY_MS[quote.platform] ?? 1_000;
}

function getFeeBps(quote: VenueQuote, role: 'maker' | 'taker'): number {
  if (role === 'maker') {
    return quote.makerFeeBps ?? DEFAULT_MAKER_FEE_BPS[quote.platform] ?? 0;
  }
  return quote.takerFeeBps ?? DEFAULT_TAKER_FEE_BPS[quote.platform] ?? 100;
}

function getLegBlueprints(
  style: VenueArbitrageExecutionStyle
): Array<{ side: 'buy' | 'sell'; role: 'maker' | 'taker'; reason: string }> {
  switch (style) {
    case 'maker_taker':
      return [
        { side: 'buy', role: 'maker', reason: 'rest on the cheap venue and lean inventory before hedging' },
        { side: 'sell', role: 'taker', reason: 'aggress the rich venue once entry is queued' },
      ];
    case 'maker_maker':
      return [
        { side: 'buy', role: 'maker', reason: 'join the cheap venue queue and avoid crossing the spread' },
        { side: 'sell', role: 'maker', reason: 'quote the rich venue and capture edge passively' },
      ];
    case 'taker_taker':
    default:
      return [
        { side: 'sell', role: 'taker', reason: 'hit the rich venue first to lock the visible edge' },
        { side: 'buy', role: 'taker', reason: 'complete the hedge immediately on the cheap venue' },
      ];
  }
}

function getPlannedPrice(
  quote: VenueQuote,
  side: 'buy' | 'sell',
  role: 'maker' | 'taker'
): number {
  if (side === 'buy') return role === 'maker' ? quote.bid : quote.ask;
  return role === 'maker' ? quote.ask : quote.bid;
}

function clampSize(
  buy: VenueQuote,
  sell: VenueQuote,
  cfg: Required<VenueArbitragePlannerConfig>
): number {
  const referencePrice = Math.max(buy.ask, 0.01);
  const byNotional = cfg.maxNotionalUsd / referencePrice;
  const venueCaps = [buy.maxOrderSize, sell.maxOrderSize].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
  );

  return Math.min(
    buy.askSize,
    sell.bidSize,
    cfg.maxSize,
    byNotional,
    ...(venueCaps.length > 0 ? venueCaps : [Number.POSITIVE_INFINITY])
  );
}

function inventoryPenaltyBps(
  buy: VenueQuote,
  sell: VenueQuote,
  cfg: Required<VenueArbitragePlannerConfig>
): number {
  const totalInventory = Math.max(0, Math.abs(buy.inventoryUsd ?? 0) + Math.abs(sell.inventoryUsd ?? 0));
  const cappedInventory = Math.min(totalInventory, cfg.maxInventoryUsd);
  return (cappedInventory / 100) * cfg.inventoryPenaltyBpsPer100Usd;
}

function stalePenaltyBps(
  buyAgeMs: number,
  sellAgeMs: number,
  cfg: Required<VenueArbitragePlannerConfig>
): number {
  const worstAge = Math.max(buyAgeMs, sellAgeMs);
  if (cfg.maxQuoteAgeMs <= 0 || worstAge <= 0) return 0;
  return (worstAge / cfg.maxQuoteAgeMs) * cfg.stalePenaltyBps;
}

function latencyPenaltyBps(
  buyLatencyMs: number,
  sellLatencyMs: number,
  cfg: Required<VenueArbitragePlannerConfig>
): number {
  const worstLatencyMs = Math.max(buyLatencyMs, sellLatencyMs);
  return (worstLatencyMs / 1_000) * cfg.latencyPenaltyBpsPerSecond;
}

function buildLegs(
  buy: VenueQuote,
  sell: VenueQuote,
  size: number,
  style: VenueArbitrageExecutionStyle,
  buyAgeMs: number,
  sellAgeMs: number
): VenueArbitrageLeg[] {
  const blueprints = getLegBlueprints(style);

  return blueprints.map((step, index) => {
    const source = step.side === 'buy' ? buy : sell;
    return {
      order: index + 1,
      platform: source.platform,
      marketId: source.marketId,
      outcome: source.outcome,
      side: step.side,
      role: step.role,
      price: getPlannedPrice(source, step.side, step.role),
      size,
      feeBps: getFeeBps(source, step.role),
      latencyMs: getLatencyMs(source),
      quoteAgeMs: step.side === 'buy' ? buyAgeMs : sellAgeMs,
      reason: step.reason,
    };
  });
}

function scorePlan(netEdgeBps: number, expectedNetUsd: number, size: number): number {
  const liquidityBoost = Math.sqrt(Math.max(size, 1));
  return netEdgeBps * liquidityBoost + expectedNetUsd * 10;
}

function rankPlans(plans: VenueArbitragePlan[]): VenueArbitragePlan[] {
  return [...plans].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.netEdgeBps !== a.netEdgeBps) return b.netEdgeBps - a.netEdgeBps;
    return b.expectedNetUsd - a.expectedNetUsd;
  });
}

function buildPlan(
  buy: VenueQuote,
  sell: VenueQuote,
  cfg: Required<VenueArbitragePlannerConfig>,
  nowMs: number
): VenueArbitragePlan | null {
  if (buy.platform === sell.platform) return null;
  if (!cfg.platforms.includes(buy.platform) || !cfg.platforms.includes(sell.platform)) return null;
  if (buy.ask <= 0 || sell.bid <= 0) return null;
  if (buy.outcome !== sell.outcome) return null;

  const displayedSpread = sell.bid - buy.ask;
  if (displayedSpread <= 0 && cfg.requireCrossedMarket) return null;

  const buyAgeMs = getQuoteAgeMs(buy, nowMs);
  const sellAgeMs = getQuoteAgeMs(sell, nowMs);
  if (buyAgeMs > cfg.maxQuoteAgeMs || sellAgeMs > cfg.maxQuoteAgeMs) return null;

  const buyLatencyMs = getLatencyMs(buy);
  const sellLatencyMs = getLatencyMs(sell);
  if (buyLatencyMs > cfg.maxLatencyMs || sellLatencyMs > cfg.maxLatencyMs) return null;

  const size = clampSize(buy, sell, cfg);
  if (!Number.isFinite(size) || size < cfg.minSize) return null;

  const legs = buildLegs(buy, sell, size, cfg.executionStyle, buyAgeMs, sellAgeMs);
  const buyLeg = legs.find((leg) => leg.side === 'buy');
  const sellLeg = legs.find((leg) => leg.side === 'sell');
  if (!buyLeg || !sellLeg) return null;

  const grossSpread = sellLeg.price - buyLeg.price;
  if (grossSpread <= 0) return null;

  const notionalUsd = size * buyLeg.price;
  const feesBps = legs.reduce((sum, leg) => sum + leg.feeBps, 0);
  const latencyPenalty = latencyPenaltyBps(buyLatencyMs, sellLatencyMs, cfg);
  const stalePenalty = stalePenaltyBps(buyAgeMs, sellAgeMs, cfg);
  const inventoryPenalty = inventoryPenaltyBps(buy, sell, cfg);
  const grossEdgeBps = (grossSpread / Math.max(buyLeg.price, 0.0001)) * 10_000;
  const netEdgeBps = grossEdgeBps - feesBps - latencyPenalty - stalePenalty - inventoryPenalty;
  const expectedNetUsd = notionalUsd * (netEdgeBps / 10_000);

  if (netEdgeBps < cfg.minNetEdgeBps) return null;
  if (expectedNetUsd < cfg.minTargetProfitUsd) return null;

  const warnings: string[] = [];
  if (Math.max(buyAgeMs, sellAgeMs) > cfg.maxQuoteAgeMs * 0.5) warnings.push('quotes_nearing_stale_threshold');
  if (Math.max(buyLatencyMs, sellLatencyMs) > cfg.maxLatencyMs * 0.75) warnings.push('latency_budget_tight');
  if ((Math.abs(buy.inventoryUsd ?? 0) + Math.abs(sell.inventoryUsd ?? 0)) > cfg.maxInventoryUsd * 0.5) {
    warnings.push('inventory_skew_elevated');
  }

  return {
    instrumentId: buy.instrumentId,
    buyPlatform: buy.platform,
    sellPlatform: sell.platform,
    buyMarketId: buy.marketId,
    sellMarketId: sell.marketId,
    outcome: buy.outcome,
    executionStyle: cfg.executionStyle,
    size,
    notionalUsd,
    grossSpread,
    grossEdgeBps,
    netEdgeBps,
    expectedNetUsd,
    feesBps,
    latencyPenaltyBps: latencyPenalty,
    stalePenaltyBps: stalePenalty,
    inventoryPenaltyBps: inventoryPenalty,
    score: scorePlan(netEdgeBps, expectedNetUsd, size),
    warnings,
    legs,
  };
}

export function findVenueArbitragePlans(
  quotes: VenueQuote[],
  config: VenueArbitragePlannerConfig = {},
  now: number | Date = Date.now()
): VenueArbitragePlan[] {
  const cfg = mergeConfig(DEFAULT_CONFIG, config);
  if (!cfg.enabled) return [];

  const nowMs = toMillis(now) ?? Date.now();
  const grouped = new Map<string, VenueQuote[]>();

  for (const quote of quotes) {
    if (!grouped.has(quote.instrumentId)) grouped.set(quote.instrumentId, []);
    grouped.get(quote.instrumentId)!.push(quote);
  }

  const plans: VenueArbitragePlan[] = [];
  for (const groupQuotes of grouped.values()) {
    for (const buy of groupQuotes) {
      for (const sell of groupQuotes) {
        const plan = buildPlan(buy, sell, cfg, nowMs);
        if (plan) plans.push(plan);
      }
    }
  }

  return rankPlans(plans);
}

export function createVenueArbitragePlanner(
  config: VenueArbitragePlannerConfig = {}
): VenueArbitragePlanner {
  let cfg = mergeConfig(DEFAULT_CONFIG, config);

  return {
    getConfig(): Required<VenueArbitragePlannerConfig> {
      return { ...cfg, platforms: [...cfg.platforms] };
    },
    updateConfig(next: Partial<VenueArbitragePlannerConfig>): void {
      cfg = mergeConfig(cfg, next);
    },
    findPlans(quotes: VenueQuote[], now?: number | Date): VenueArbitragePlan[] {
      return findVenueArbitragePlans(quotes, cfg, now ?? Date.now());
    },
    rankPlans,
  };
}

export {
  DEFAULT_CONFIG as DEFAULT_VENUE_ARBITRAGE_CONFIG,
  DEFAULT_EXECUTION_LATENCY_MS as DEFAULT_VENUE_LATENCY_MS,
  DEFAULT_MAKER_FEE_BPS as DEFAULT_VENUE_MAKER_FEES_BPS,
  DEFAULT_TAKER_FEE_BPS as DEFAULT_VENUE_TAKER_FEES_BPS,
};
