import type { FeedManager } from '../feeds/index';
import {
  DEFAULT_VENUE_LATENCY_MS,
  findVenueArbitragePlans,
  type VenueArbitrageExecutionStyle,
  type VenueArbitragePlan,
  type VenueArbitragePlannerConfig,
  type VenueQuote,
} from '../trading/venue-arbitrage';
import {
  findMultiHopArbitragePlans,
  type ArbitrageHopQuote,
  type MultiHopArbitragePlan,
  type MultiHopArbitragePlannerConfig,
} from '../trading/multi-hop-arbitrage';
import type { Market, Orderbook, Platform, TradeVenue } from '../types';
import type { MarketIdentity } from './links';
import type { Opportunity, OpportunityFinder, OpportunityMarket } from './index';
import type { NormalizedOutcome, OutcomeNormalizer } from './outcomes';

type FeedLookup = Pick<FeedManager, 'getMarket' | 'getOrderbook'>;

export interface OpportunityHftPlannerConfig extends Partial<VenueArbitragePlannerConfig> {
  /** Prefer refreshing prices from live orderbooks when feeds are available. */
  refreshQuotes?: boolean;
  /** Override target size. Defaults to the tightest recommended/top-of-book size. */
  size?: number;
}

export interface LinkedMarketVenuePlanOptions extends Partial<VenueArbitragePlannerConfig> {
  marketKey: string;
  normalizedOutcome?: NormalizedOutcome;
}

export interface OpportunityStepQuote {
  platform: Platform;
  marketId: string;
  tokenId?: string;
  recommendedSize: number;
  outcome: string;
  normalizedOutcome: NormalizedOutcome;
  action: 'buy' | 'sell';
  source: 'feed_orderbook' | 'opportunity_snapshot';
  lookupId: string;
  bid: number;
  ask: number;
  executablePrice: number;
  executableSize: number;
  quoteAgeMs: number;
  latencyMs: number;
  warnings: string[];
}

export interface OpportunityHftInstruction {
  order: number;
  platform: Platform;
  marketId: string;
  tokenId?: string;
  outcome: string;
  normalizedOutcome: NormalizedOutcome;
  action: 'buy' | 'sell';
  price: number;
  size: number;
  source: 'feed_orderbook' | 'opportunity_snapshot';
  latencyMs: number;
  quoteAgeMs: number;
  rationale: string;
}

export interface OpportunityHftExecutionPlan {
  targetSize: number;
  entryCost: number;
  entryCredit: number;
  referenceNotional: number;
  projectedEdgeUsd: number;
  steps: OpportunityHftInstruction[];
  warnings: string[];
}

export interface OpportunityHftPlanResult {
  opportunityId: string;
  opportunityType: Opportunity['type'];
  marketQuotes: OpportunityStepQuote[];
  venuePlans: VenueArbitragePlan[];
  execution: OpportunityHftExecutionPlan;
  warnings: string[];
}

export interface LinkedMarketVenuePlanResult {
  marketKey: string;
  normalizedOutcome: NormalizedOutcome;
  identity: MarketIdentity | undefined;
  quotes: VenueQuote[];
  plans: VenueArbitragePlan[];
  skipped: Array<{ platform: Platform; marketId: string; reason: string }>;
  warnings: string[];
}

function normalizeVenueConfig(
  config: OpportunityHftPlannerConfig | LinkedMarketVenuePlanOptions,
  defaultPlatforms: TradeVenue[]
): VenueArbitragePlannerConfig {
  const {
    refreshQuotes: _refreshQuotes,
    size: _size,
    marketKey: _marketKey,
    normalizedOutcome: _normalizedOutcome,
    ...venueConfig
  } = config as OpportunityHftPlannerConfig & LinkedMarketVenuePlanOptions;

  return {
    enabled: true,
    platforms: venueConfig.platforms ?? defaultPlatforms,
    ...venueConfig,
  };
}

function bestBid(orderbook: Orderbook | null, fallback: number): number {
  return orderbook?.bids[0]?.[0] ?? fallback;
}

function bestAsk(orderbook: Orderbook | null, fallback: number): number {
  return orderbook?.asks[0]?.[0] ?? fallback;
}

function bestBidSize(orderbook: Orderbook | null, fallback: number): number {
  return orderbook?.bids[0]?.[1] ?? fallback;
}

function bestAskSize(orderbook: Orderbook | null, fallback: number): number {
  return orderbook?.asks[0]?.[1] ?? fallback;
}

function venueLatency(platform: TradeVenue): number {
  return DEFAULT_VENUE_LATENCY_MS[platform] ?? 1_000;
}

function normalizeBinaryOrderbookToNo(orderbook: Orderbook): Orderbook {
  const bids = orderbook.asks
    .map(([price, size]) => [Number((1 - price).toFixed(4)), size] as [number, number])
    .filter(([price, size]) => price > 0 && price < 1 && size > 0)
    .sort((a, b) => b[0] - a[0]);

  const asks = orderbook.bids
    .map(([price, size]) => [Number((1 - price).toFixed(4)), size] as [number, number])
    .filter(([price, size]) => price > 0 && price < 1 && size > 0)
    .sort((a, b) => a[0] - b[0]);

  const bid = bids[0]?.[0] ?? 0;
  const ask = asks[0]?.[0] ?? 0;

  return {
    ...orderbook,
    bids,
    asks,
    spread: bid > 0 && ask > 0 ? ask - bid : 0,
    midPrice: bid > 0 && ask > 0 ? (bid + ask) / 2 : 1 - orderbook.midPrice,
  };
}

function outcomeLookupId(market: OpportunityMarket): string {
  if ((market.platform === 'polymarket' || market.platform === 'opinion') && market.tokenId) {
    return market.tokenId;
  }
  return market.marketId;
}

function selectOutcome(
  market: Market,
  normalizer: OutcomeNormalizer,
  normalizedOutcome: NormalizedOutcome,
  fallbackOutcome?: string
) {
  if (normalizedOutcome === 'YES') return normalizer.findYes(market.outcomes);
  if (normalizedOutcome === 'NO') return normalizer.findNo(market.outcomes);
  return market.outcomes.find((outcome) => outcome.name === fallbackOutcome) ?? market.outcomes[0];
}

async function loadOrderbookForMarket(
  feeds: FeedLookup,
  platform: Platform,
  marketId: string,
  tokenId: string | undefined,
  normalizedOutcome: NormalizedOutcome
): Promise<{ lookupId: string; orderbook: Orderbook | null }> {
  const lookupId = ((platform === 'polymarket' || platform === 'opinion') && tokenId) ? tokenId : marketId;
  let orderbook = await feeds.getOrderbook(platform, lookupId);

  if (!orderbook && lookupId !== marketId) {
    orderbook = await feeds.getOrderbook(platform, marketId);
  }

  if (orderbook && normalizedOutcome === 'NO' && lookupId === marketId) {
    orderbook = normalizeBinaryOrderbookToNo(orderbook);
  }

  return { lookupId, orderbook };
}

async function buildStepQuote(
  market: OpportunityMarket,
  feeds: FeedLookup | undefined,
  refreshQuotes: boolean,
  nowMs: number
): Promise<OpportunityStepQuote> {
  const warnings: string[] = [];
  const fallbackBid = market.bidPrice ?? market.price;
  const fallbackAsk = market.askPrice ?? market.price;
  const fallbackSize = Math.max(market.recommendedSize, 1);
  const latencyMs = venueLatency(market.platform as TradeVenue);
  const lookupId = outcomeLookupId(market);

  let source: OpportunityStepQuote['source'] = 'opportunity_snapshot';
  let bid = fallbackBid;
  let ask = fallbackAsk;
  let executableSize = fallbackSize;
  let quoteAgeMs = 0;

  if (refreshQuotes && feeds) {
    try {
      const { orderbook } = await loadOrderbookForMarket(
        feeds,
        market.platform,
        market.marketId,
        market.tokenId,
        market.normalizedOutcome
      );

      if (orderbook) {
        source = 'feed_orderbook';
        bid = bestBid(orderbook, fallbackBid);
        ask = bestAsk(orderbook, fallbackAsk);
        executableSize = market.action === 'buy'
          ? bestAskSize(orderbook, fallbackSize)
          : bestBidSize(orderbook, fallbackSize);
        quoteAgeMs = Math.max(0, nowMs - orderbook.timestamp);
      } else {
        warnings.push('live_orderbook_unavailable');
      }
    } catch {
      warnings.push('live_orderbook_fetch_failed');
    }
  }

  if ((market.platform === 'polymarket' || market.platform === 'opinion') && !market.tokenId) {
    warnings.push('outcome_token_missing');
  }

  const executablePrice = market.action === 'buy' ? ask : bid;
  if (!(executablePrice > 0)) {
    warnings.push('executable_price_invalid');
  }

  return {
    platform: market.platform,
    marketId: market.marketId,
    tokenId: market.tokenId,
    recommendedSize: market.recommendedSize,
    outcome: market.outcome,
    normalizedOutcome: market.normalizedOutcome,
    action: market.action,
    source,
    lookupId,
    bid,
    ask,
    executablePrice,
    executableSize,
    quoteAgeMs,
    latencyMs,
    warnings,
  };
}

function buildOpportunityExecutionPlan(
  opportunity: Opportunity,
  quotes: OpportunityStepQuote[],
  requestedSize?: number
): OpportunityHftExecutionPlan {
  const warnings = quotes.flatMap((quote) => quote.warnings);
  const validQuotes = quotes.filter((quote) => quote.executablePrice > 0);
  const capacity = validQuotes.length > 0
    ? Math.min(...validQuotes.map((quote) => Math.max(1, Math.min(quote.executableSize, quote.recommendedSize))))
    : 0;
  const requested = requestedSize && requestedSize > 0 ? requestedSize : undefined;
  const targetSize = requested !== undefined
    ? (capacity > 0 ? Math.min(requested, capacity) : requested)
    : capacity;

  const orderedQuotes = [...validQuotes].sort((a, b) => {
    const actionRank = a.action === 'sell' ? 0 : 1;
    const otherActionRank = b.action === 'sell' ? 0 : 1;
    if (actionRank !== otherActionRank) return actionRank - otherActionRank;
    if (a.source !== b.source) return a.source === 'feed_orderbook' ? -1 : 1;
    if (a.quoteAgeMs !== b.quoteAgeMs) return a.quoteAgeMs - b.quoteAgeMs;
    return a.latencyMs - b.latencyMs;
  });

  const steps = orderedQuotes.map((quote, index) => ({
    order: index + 1,
    platform: quote.platform,
    marketId: quote.marketId,
    tokenId: quote.tokenId,
    outcome: quote.outcome,
    normalizedOutcome: quote.normalizedOutcome,
    action: quote.action,
    price: quote.executablePrice,
    size: Math.min(targetSize, quote.executableSize),
    source: quote.source,
    latencyMs: quote.latencyMs,
    quoteAgeMs: quote.quoteAgeMs,
    rationale: quote.action === 'sell'
      ? 'lead with the rich leg to lock edge before hedging'
      : 'complete the hedge after the higher-priority legs are staged',
  }));

  const entryCost = steps
    .filter((step) => step.action === 'buy')
    .reduce((sum, step) => sum + step.price * step.size, 0);
  const entryCredit = steps
    .filter((step) => step.action === 'sell')
    .reduce((sum, step) => sum + step.price * step.size, 0);
  const referenceNotional = Math.max(entryCost, entryCredit, targetSize);
  const projectedEdgeUsd = referenceNotional * (opportunity.edgePct / 100);

  if (steps.some((step) => step.source !== 'feed_orderbook')) {
    warnings.push('snapshot_prices_used_for_some_legs');
  }
  if (requested !== undefined && capacity > 0 && requested > capacity) {
    warnings.push('requested_size_clipped_to_top_of_book');
  }
  if (opportunity.markets.some((market) => market.normalizedOutcome === 'NO')) {
    warnings.push('binary_no_leg_execution_depends_on_venue_semantics');
  }
  if (steps.length !== opportunity.markets.length) {
    warnings.push('some_legs_missing_valid_executable_price');
  }

  return {
    targetSize,
    entryCost,
    entryCredit,
    referenceNotional,
    projectedEdgeUsd,
    steps,
    warnings: [...new Set(warnings)],
  };
}

function buildVenueQuotesFromOpportunity(
  opportunity: Opportunity,
  stepQuotes: OpportunityStepQuote[]
): VenueQuote[] {
  const normalizedOutcome = opportunity.markets[0]?.normalizedOutcome;
  if (!normalizedOutcome || opportunity.markets.some((market) => market.normalizedOutcome !== normalizedOutcome)) {
    return [];
  }

  return stepQuotes
    .filter((quote) => quote.bid > 0 && quote.ask > 0)
    .map((quote) => ({
      instrumentId: `${opportunity.id}:${normalizedOutcome}`,
      platform: quote.platform as TradeVenue,
      marketId: quote.marketId,
      outcome: normalizedOutcome,
      bid: quote.bid,
      ask: quote.ask,
      bidSize: quote.action === 'sell' ? quote.executableSize : Math.max(quote.executableSize, 1),
      askSize: quote.action === 'buy' ? quote.executableSize : Math.max(quote.executableSize, 1),
      timestamp: Date.now() - quote.quoteAgeMs,
      latencyMs: quote.latencyMs,
    }));
}

export async function planOpportunityHft(
  opportunity: Opportunity,
  config: OpportunityHftPlannerConfig = {},
  feeds?: FeedLookup
): Promise<OpportunityHftPlanResult> {
  const nowMs = Date.now();
  const refreshQuotes = config.refreshQuotes ?? true;
  const marketQuotes = await Promise.all(
    opportunity.markets.map((market) => buildStepQuote(market, feeds, refreshQuotes, nowMs))
  );

  const execution = buildOpportunityExecutionPlan(opportunity, marketQuotes, config.size);
  const venueQuotes = buildVenueQuotesFromOpportunity(opportunity, marketQuotes);
  const defaultPlatforms = [...new Set(venueQuotes.map((quote) => quote.platform))];
  const venuePlans = venueQuotes.length >= 2
    ? findVenueArbitragePlans(venueQuotes, normalizeVenueConfig(config, defaultPlatforms), nowMs)
    : [];

  const warnings = [...execution.warnings];
  if (venueQuotes.length < 2) warnings.push('same_outcome_cross_venue_plan_unavailable');
  if (venueQuotes.length >= 2 && venuePlans.length === 0) warnings.push('no_live_crossed_venue_plan_found');

  return {
    opportunityId: opportunity.id,
    opportunityType: opportunity.type,
    marketQuotes,
    venuePlans,
    execution,
    warnings: [...new Set(warnings)],
  };
}

export async function planLinkedVenueArbitrage(
  finder: Pick<OpportunityFinder, 'linker' | 'normalizer'>,
  feeds: FeedLookup,
  options: LinkedMarketVenuePlanOptions
): Promise<LinkedMarketVenuePlanResult> {
  const normalizedOutcome = options.normalizedOutcome ?? 'YES';
  const identity = finder.linker.getIdentity(options.marketKey);
  const quotes: VenueQuote[] = [];
  const skipped: LinkedMarketVenuePlanResult['skipped'] = [];
  const warnings: string[] = [];
  const nowMs = Date.now();

  if (!identity) {
    return {
      marketKey: options.marketKey,
      normalizedOutcome,
      identity: undefined,
      quotes: [],
      plans: [],
      skipped: [{ platform: options.marketKey.split(':')[0] as Platform, marketId: options.marketKey.split(':')[1] || '', reason: 'market_identity_not_found' }],
      warnings: ['market_identity_not_found'],
    };
  }

  for (const linkedMarket of identity.markets) {
    try {
      const market = await feeds.getMarket(linkedMarket.marketId, linkedMarket.platform);
      if (!market) {
        skipped.push({ platform: linkedMarket.platform, marketId: linkedMarket.marketId, reason: 'market_not_found' });
        continue;
      }

      const outcome = selectOutcome(market, finder.normalizer, normalizedOutcome);
      if (!outcome) {
        skipped.push({ platform: linkedMarket.platform, marketId: linkedMarket.marketId, reason: 'outcome_not_resolved' });
        continue;
      }

      const { lookupId, orderbook } = await loadOrderbookForMarket(
        feeds,
        linkedMarket.platform,
        linkedMarket.marketId,
        outcome.tokenId,
        normalizedOutcome
      );

      if (!orderbook) {
        skipped.push({ platform: linkedMarket.platform, marketId: linkedMarket.marketId, reason: 'orderbook_unavailable' });
        continue;
      }

      const bid = bestBid(orderbook, outcome.price);
      const ask = bestAsk(orderbook, outcome.price);
      if (!(bid > 0) || !(ask > 0)) {
        skipped.push({ platform: linkedMarket.platform, marketId: linkedMarket.marketId, reason: 'orderbook_incomplete' });
        continue;
      }

      quotes.push({
        instrumentId: identity.canonicalId,
        platform: linkedMarket.platform as TradeVenue,
        marketId: linkedMarket.marketId,
        outcome: normalizedOutcome,
        bid,
        ask,
        bidSize: bestBidSize(orderbook, 1),
        askSize: bestAskSize(orderbook, 1),
        timestamp: orderbook.timestamp,
        latencyMs: venueLatency(linkedMarket.platform as TradeVenue),
        maxOrderSize: Math.max(bestBidSize(orderbook, 1), bestAskSize(orderbook, 1)),
      });

      if (lookupId !== linkedMarket.marketId) {
        warnings.push(`outcome_level_lookup:${linkedMarket.platform}:${lookupId}`);
      }
    } catch {
      skipped.push({ platform: linkedMarket.platform, marketId: linkedMarket.marketId, reason: 'quote_build_failed' });
    }
  }

  const defaultPlatforms = [...new Set(quotes.map((quote) => quote.platform))];
  const plans = quotes.length >= 2
    ? findVenueArbitragePlans(quotes, normalizeVenueConfig(options, defaultPlatforms), nowMs)
    : [];

  if (quotes.length < 2) warnings.push('insufficient_live_quotes');
  if (quotes.length >= 2 && plans.length === 0) warnings.push('no_live_crossed_venue_plan_found');

  return {
    marketKey: options.marketKey,
    normalizedOutcome,
    identity,
    quotes,
    plans,
    skipped,
    warnings: [...new Set(warnings)],
  };
}

export function planMultiHopHft(
  hops: ArbitrageHopQuote[],
  config: MultiHopArbitragePlannerConfig = {}
): MultiHopArbitragePlan[] {
  return findMultiHopArbitragePlans(hops, {
    enabled: true,
    ...config,
  });
}
