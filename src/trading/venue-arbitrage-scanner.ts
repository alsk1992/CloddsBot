import type { Connection } from '@solana/web3.js';
import {
  getJupiterQuote,
  type JupiterQuoteResult,
} from '../solana/jupiter';
import {
  getMeteoraDlmmQuote,
  type MeteoraDlmmQuote,
} from '../solana/meteora';
import {
  getOrcaWhirlpoolQuote,
  type OrcaWhirlpoolQuote,
} from '../solana/orca';
import {
  selectBestPool,
  type DexName,
  type UnifiedPoolInfo,
} from '../solana/pools';
import {
  getRaydiumQuote,
  type RaydiumQuote,
} from '../solana/raydium';
import {
  getTokenList,
  type TokenListEntry,
} from '../solana/tokenlist';
import { getSolanaConnection } from '../solana/wallet';
import {
  getOneInchQuote,
  type OneInchQuote,
} from '../evm/oneinch';
import {
  pancakeQuote,
  type PancakeChain,
  type PancakeQuote,
} from '../evm/pancakeswap';
import {
  getUniswapQuote,
  type EvmChain,
  type UniswapQuote,
} from '../evm/uniswap';
import {
  getMarkets as getLighterMarkets,
  getOrderbook as getLighterOrderbook,
  type LighterMarket,
  type LighterOrderbook,
  type LighterOrderbookLevel,
} from '../exchanges/lighter';
import type { TradeVenue } from '../types';
import {
  findVenueArbitragePlans,
  type VenueArbitrageExecutionStyle,
  type VenueArbitragePlan,
  type VenueArbitragePlannerConfig,
  type VenueQuote,
} from './venue-arbitrage';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const DEFAULT_SOLANA_SCAN_VENUES: SolanaScanVenue[] = ['jupiter', 'raydium', 'orca', 'meteora'];
const DEFAULT_EVM_SCAN_VENUES: EvmScanVenue[] = ['uniswap', 'oneinch', 'pancakeswap', 'lighter'];
const STABLE_QUOTES = new Set(['USD', 'USDC', 'USDT', 'DAI']);

export type SolanaScanVenue = 'jupiter' | 'raydium' | 'orca' | 'meteora';
export type EvmScanVenue = 'uniswap' | 'oneinch' | 'pancakeswap' | 'lighter';

export interface VenueArbitrageScanRequestBase {
  baseToken: string;
  quoteToken: string;
  quoteSize: number;
  slippageBps?: number;
  minNetEdgeBps?: number;
  minTargetProfitUsd?: number;
  executionStyle?: VenueArbitrageExecutionStyle;
  requireCrossedMarket?: boolean;
  maxQuoteAgeMs?: number;
  maxLatencyMs?: number;
  latencyPenaltyBpsPerSecond?: number;
  stalePenaltyBps?: number;
  onlyDirectRoutes?: boolean;
  limitPlans?: number;
}

export interface SolanaVenueArbitrageScanRequest extends VenueArbitrageScanRequestBase {
  family: 'solana';
  rpcUrl?: string;
  venues?: SolanaScanVenue[];
}

export interface EvmVenueArbitrageScanRequest extends VenueArbitrageScanRequestBase {
  family: 'evm';
  chain: EvmChain;
  venues?: EvmScanVenue[];
  lighterMarket?: string;
}

export interface CrossVenueArbitrageScanRequest extends VenueArbitrageScanRequestBase {
  family: 'cross';
  chain: EvmChain;
  rpcUrl?: string;
  solanaVenues?: SolanaScanVenue[];
  evmVenues?: EvmScanVenue[];
  lighterMarket?: string;
}

export type VenueArbitrageLiveScanRequest =
  | SolanaVenueArbitrageScanRequest
  | EvmVenueArbitrageScanRequest
  | CrossVenueArbitrageScanRequest;

export interface ScannedVenueQuote {
  quote: VenueQuote;
  family: 'solana' | 'evm';
  chain: 'solana' | EvmChain;
  description?: string;
  route?: string;
  poolAddress?: string;
  marketName?: string;
  partial?: boolean;
}

export interface SkippedVenue {
  venue: TradeVenue;
  reason: string;
}

export interface VenueArbitrageScanResult {
  request: VenueArbitrageLiveScanRequest;
  scannedAt: number;
  quotes: ScannedVenueQuote[];
  skipped: SkippedVenue[];
  warnings: string[];
  plans: VenueArbitragePlan[];
}

interface ResolvedSolanaToken {
  mint: string;
  symbol: string;
  decimals: number;
}

interface SolanaScanContext {
  request: SolanaVenueArbitrageScanRequest;
  instrumentId: string;
  connection: Connection;
  base: ResolvedSolanaToken;
  quote: ResolvedSolanaToken;
  quoteSizeRaw: string;
}

interface EvmScanContext {
  request: EvmVenueArbitrageScanRequest;
  instrumentId: string;
}

interface ScannerDeps {
  getTokenList: typeof getTokenList;
  getSolanaConnection: typeof getSolanaConnection;
  getJupiterQuote: typeof getJupiterQuote;
  getRaydiumQuote: typeof getRaydiumQuote;
  selectBestPool: typeof selectBestPool;
  getOrcaWhirlpoolQuote: typeof getOrcaWhirlpoolQuote;
  getMeteoraDlmmQuote: typeof getMeteoraDlmmQuote;
  getUniswapQuote: typeof getUniswapQuote;
  getOneInchQuote: typeof getOneInchQuote;
  pancakeQuote: typeof pancakeQuote;
  getLighterMarkets: typeof getLighterMarkets;
  getLighterOrderbook: typeof getLighterOrderbook;
}

const defaultDeps: ScannerDeps = {
  getTokenList,
  getSolanaConnection,
  getJupiterQuote,
  getRaydiumQuote,
  selectBestPool,
  getOrcaWhirlpoolQuote,
  getMeteoraDlmmQuote,
  getUniswapQuote,
  getOneInchQuote,
  pancakeQuote,
  getLighterMarkets,
  getLighterOrderbook,
};

export interface WeightedFill {
  averagePrice: number;
  filledSize: number;
  complete: boolean;
  notional: number;
}

function looksLikeSolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function numberString(value: number, maxFractionDigits = 12): string {
  return value.toLocaleString('en-US', {
    useGrouping: false,
    maximumFractionDigits: maxFractionDigits,
  });
}

function parseNumeric(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toRawAmount(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  const scaled = Math.floor(amount * 10 ** decimals);
  if (!Number.isFinite(scaled) || scaled <= 0 || scaled > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Amount too large or too small after scaling: ${amount}`);
  }
  return String(scaled);
}

function fromRawAmount(amount: string, decimals: number): number {
  const numeric = parseNumeric(amount);
  return numeric / 10 ** decimals;
}

function uniqueNonEmpty(values: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function stableQuoteMatches(left: string, right: string): boolean {
  const a = normalizeSymbol(left);
  const b = normalizeSymbol(right);
  return a === b || (STABLE_QUOTES.has(a) && STABLE_QUOTES.has(b));
}

function labelVenue(venue: TradeVenue, chain?: 'solana' | EvmChain): string {
  return chain && chain !== 'solana' ? `${venue}:${chain}` : venue;
}

function instrumentId(baseToken: string, quoteToken: string): string {
  return `${normalizeSymbol(baseToken)}/${normalizeSymbol(quoteToken)}`;
}

export function computeWeightedAverageFill(
  levels: LighterOrderbookLevel[],
  targetSize: number
): WeightedFill | null {
  if (!Number.isFinite(targetSize) || targetSize <= 0) return null;

  let remaining = targetSize;
  let filledSize = 0;
  let notional = 0;

  for (const level of levels) {
    if (!Number.isFinite(level.price) || !Number.isFinite(level.size)) continue;
    if (level.price <= 0 || level.size <= 0) continue;
    const size = Math.min(level.size, remaining);
    if (size <= 0) continue;
    filledSize += size;
    notional += size * level.price;
    remaining -= size;
    if (remaining <= 1e-12) break;
  }

  if (filledSize <= 0) return null;
  return {
    averagePrice: notional / filledSize,
    filledSize,
    complete: remaining <= 1e-9,
    notional,
  };
}

function buildScannedQuote(input: {
  family: 'solana' | 'evm';
  chain: 'solana' | EvmChain;
  platform: TradeVenue;
  instrumentId: string;
  marketId: string;
  outcome: string;
  ask: number;
  bid: number;
  askSize: number;
  bidSize: number;
  latencyMs: number;
  description?: string;
  route?: string;
  poolAddress?: string;
  marketName?: string;
  partial?: boolean;
}): ScannedVenueQuote {
  return {
    family: input.family,
    chain: input.chain,
    description: input.description,
    route: input.route,
    poolAddress: input.poolAddress,
    marketName: input.marketName,
    partial: input.partial,
    quote: {
      instrumentId: input.instrumentId,
      platform: input.platform,
      marketId: input.marketId,
      outcome: input.outcome,
      bid: input.bid,
      ask: input.ask,
      bidSize: input.bidSize,
      askSize: input.askSize,
      timestamp: Date.now(),
      latencyMs: input.latencyMs,
      maxOrderSize: Math.min(input.bidSize, input.askSize),
    },
  };
}

function buildPlannerConfig(
  request: VenueArbitrageLiveScanRequest,
  platforms: TradeVenue[]
): VenueArbitragePlannerConfig {
  return {
    enabled: true,
    platforms,
    executionStyle: request.executionStyle ?? 'taker_taker',
    minNetEdgeBps: request.minNetEdgeBps ?? 0,
    minTargetProfitUsd: request.minTargetProfitUsd ?? 0,
    minSize: 0.000001,
    maxSize: 1_000_000,
    maxNotionalUsd: request.quoteSize,
    maxQuoteAgeMs: request.maxQuoteAgeMs ?? 30_000,
    maxLatencyMs: request.maxLatencyMs ?? 20_000,
    latencyPenaltyBpsPerSecond: request.latencyPenaltyBpsPerSecond ?? 12,
    stalePenaltyBps: request.stalePenaltyBps ?? 0,
    inventoryPenaltyBpsPer100Usd: 0,
    maxInventoryUsd: 0,
    requireCrossedMarket: request.requireCrossedMarket ?? true,
  };
}

export function finalizeVenueArbitrageScan(
  request: VenueArbitrageLiveScanRequest,
  quotes: ScannedVenueQuote[],
  skipped: SkippedVenue[] = [],
  warnings: string[] = []
): VenueArbitrageScanResult {
  const uniquePlatforms = [...new Set(quotes.map((entry) => entry.quote.platform))];
  const plans = uniquePlatforms.length >= 2
    ? findVenueArbitragePlans(
        quotes.map((entry) => entry.quote),
        buildPlannerConfig(request, uniquePlatforms),
        Date.now()
      )
    : [];

  return {
    request,
    scannedAt: Date.now(),
    quotes: quotes.slice().sort((a, b) => {
      if (a.quote.ask !== b.quote.ask) return a.quote.ask - b.quote.ask;
      return b.quote.bid - a.quote.bid;
    }),
    skipped,
    warnings,
    plans: plans.slice(0, request.limitPlans ?? 5),
  };
}

export function formatVenueArbitrageScanResult(result: VenueArbitrageScanResult): string {
  const familyLabel = result.request.family === 'evm'
    ? `EVM (${result.request.chain})`
    : result.request.family === 'cross'
      ? `Cross-chain (Solana + ${result.request.chain})`
      : 'Solana';

  const lines = [
    '**Venue Arbitrage Scan**',
    `Family: ${familyLabel}`,
    `Pair: ${instrumentId(result.request.baseToken, result.request.quoteToken)}`,
    `Quote size: ${numberString(result.request.quoteSize, 6)} ${normalizeSymbol(result.request.quoteToken)}`,
    `Quotes: ${result.quotes.length} | Plans: ${result.plans.length} | Skipped: ${result.skipped.length}`,
  ];

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  if (result.quotes.length > 0) {
    lines.push('');
    lines.push('**Quotes**');
    for (const entry of result.quotes) {
      const latency = Math.round(entry.quote.latencyMs ?? 0);
      lines.push(
        `${labelVenue(entry.quote.platform, entry.chain)} | ask ${numberString(entry.quote.ask, 6)} | bid ${numberString(entry.quote.bid, 6)} | size ${numberString(Math.min(entry.quote.askSize, entry.quote.bidSize), 6)} | latency ${latency}ms`
      );
      if (entry.marketName) lines.push(`  Market: ${entry.marketName}`);
      if (entry.poolAddress) lines.push(`  Pool: ${entry.poolAddress}`);
      if (entry.route) lines.push(`  Route: ${entry.route}`);
      if (entry.description) lines.push(`  Note: ${entry.description}`);
      if (entry.partial) lines.push('  Note: partial book fill at requested size');
    }
  }

  if (result.plans.length > 0) {
    lines.push('');
    lines.push('**Plans**');
    result.plans.forEach((plan, index) => {
      const buyPrice = plan.legs.find((leg) => leg.side === 'buy')?.price ?? plan.grossSpread;
      const sellPrice = plan.legs.find((leg) => leg.side === 'sell')?.price ?? 0;
      lines.push(
        `${index + 1}. Buy ${plan.buyPlatform} @ ${numberString(buyPrice, 6)} | Sell ${plan.sellPlatform} @ ${numberString(sellPrice, 6)} | edge ${numberString(plan.netEdgeBps, 2)} bps | net $${numberString(plan.expectedNetUsd, 4)} | size ${numberString(plan.size, 6)}`
      );
      if (plan.warnings.length > 0) {
        lines.push(`  Warnings: ${plan.warnings.join(', ')}`);
      }
    });
  } else if (result.quotes.length >= 2) {
    lines.push('');
    lines.push('No net-positive crossed plans met the current thresholds.');
  }

  if (result.skipped.length > 0) {
    lines.push('');
    lines.push('**Skipped Venues**');
    for (const skipped of result.skipped) {
      lines.push(`  ${skipped.venue}: ${skipped.reason}`);
    }
  }

  return lines.join('\n');
}

async function resolveSolanaTokenSpec(
  input: string,
  tokens: TokenListEntry[]
): Promise<ResolvedSolanaToken> {
  const trimmed = input.trim();
  const upper = normalizeSymbol(trimmed);

  if (upper === 'SOL') {
    return { mint: SOL_MINT, symbol: 'SOL', decimals: 9 };
  }

  if (looksLikeSolanaAddress(trimmed)) {
    const match = tokens.find((token) => token.address === trimmed);
    if (!match || !Number.isFinite(match.decimals)) {
      throw new Error(`Solana mint not found in token list: ${trimmed}`);
    }
    return {
      mint: match.address,
      symbol: match.symbol || trimmed,
      decimals: match.decimals ?? 0,
    };
  }

  const match = tokens.find((token) => normalizeSymbol(token.symbol || '') === upper);
  if (!match || !Number.isFinite(match.decimals)) {
    throw new Error(`Solana token symbol not found: ${input}`);
  }

  return {
    mint: match.address,
    symbol: match.symbol || input,
    decimals: match.decimals ?? 0,
  };
}

function routeFromJupiter(quote: JupiterQuoteResult): string {
  return uniqueNonEmpty(quote.routePlan.map((step) => step.swapInfo?.label)).join(' -> ');
}

function descriptionFromPriceImpact(
  buyImpact: number,
  sellImpact: number,
  extra?: string
): string | undefined {
  const parts = [
    Number.isFinite(buyImpact) && buyImpact > 0 ? `buy impact ${numberString(buyImpact, 4)}%` : undefined,
    Number.isFinite(sellImpact) && sellImpact > 0 ? `sell impact ${numberString(sellImpact, 4)}%` : undefined,
    extra,
  ];
  return uniqueNonEmpty(parts).join(' | ') || undefined;
}

async function timeQuote<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const startedAt = Date.now();
  const value = await fn();
  return { value, latencyMs: Date.now() - startedAt };
}

async function getSolanaPool(
  deps: ScannerDeps,
  connection: Connection,
  dex: DexName,
  baseMint: string,
  quoteMint: string
): Promise<UnifiedPoolInfo | null> {
  return deps.selectBestPool(connection, {
    tokenMints: [baseMint, quoteMint],
    preferredDexes: [dex],
    limit: 1,
  });
}

async function quoteJupiterVenue(
  ctx: SolanaScanContext,
  deps: ScannerDeps
): Promise<ScannedVenueQuote> {
  const { value: buyQuote, latencyMs } = await timeQuote(() =>
    deps.getJupiterQuote({
      inputMint: ctx.quote.mint,
      outputMint: ctx.base.mint,
      amount: ctx.quoteSizeRaw,
      slippageBps: ctx.request.slippageBps,
      swapMode: 'ExactIn',
      onlyDirectRoutes: ctx.request.onlyDirectRoutes,
    })
  );

  const baseAmount = fromRawAmount(buyQuote.outAmount, ctx.base.decimals);
  if (baseAmount <= 0) throw new Error('Jupiter returned zero base amount');

  const sellQuote = await deps.getJupiterQuote({
    inputMint: ctx.base.mint,
    outputMint: ctx.quote.mint,
    amount: buyQuote.outAmount,
    slippageBps: ctx.request.slippageBps,
    swapMode: 'ExactIn',
    onlyDirectRoutes: ctx.request.onlyDirectRoutes,
  });
  const quoteRecovered = fromRawAmount(sellQuote.outAmount, ctx.quote.decimals);

  return buildScannedQuote({
    family: 'solana',
    chain: 'solana',
    platform: 'jupiter',
    instrumentId: ctx.instrumentId,
    marketId: `jupiter:${ctx.base.mint}:${ctx.quote.mint}`,
    outcome: ctx.instrumentId,
    ask: ctx.request.quoteSize / baseAmount,
    bid: quoteRecovered / baseAmount,
    askSize: baseAmount,
    bidSize: baseAmount,
    latencyMs,
    route: uniqueNonEmpty([routeFromJupiter(buyQuote), routeFromJupiter(sellQuote)]).join(' || ') || undefined,
    description: descriptionFromPriceImpact(
      parseNumeric(buyQuote.priceImpactPct),
      parseNumeric(sellQuote.priceImpactPct)
    ),
  });
}

async function quoteRaydiumVenue(
  ctx: SolanaScanContext,
  deps: ScannerDeps
): Promise<ScannedVenueQuote> {
  const { value: buyQuote, latencyMs } = await timeQuote(() =>
    deps.getRaydiumQuote({
      inputMint: ctx.quote.mint,
      outputMint: ctx.base.mint,
      amount: ctx.quoteSizeRaw,
      slippageBps: ctx.request.slippageBps,
      swapMode: 'BaseIn',
    })
  );

  const baseAmountRaw = buyQuote.outAmount || '';
  const baseAmount = fromRawAmount(baseAmountRaw, ctx.base.decimals);
  if (baseAmount <= 0) throw new Error('Raydium returned zero base amount');

  const sellQuote = await deps.getRaydiumQuote({
    inputMint: ctx.base.mint,
    outputMint: ctx.quote.mint,
    amount: baseAmountRaw,
    slippageBps: ctx.request.slippageBps,
    swapMode: 'BaseIn',
  });
  const quoteRecovered = fromRawAmount(sellQuote.outAmount || '', ctx.quote.decimals);

  return buildScannedQuote({
    family: 'solana',
    chain: 'solana',
    platform: 'raydium',
    instrumentId: ctx.instrumentId,
    marketId: `raydium:${ctx.base.mint}:${ctx.quote.mint}`,
    outcome: ctx.instrumentId,
    ask: ctx.request.quoteSize / baseAmount,
    bid: quoteRecovered / baseAmount,
    askSize: baseAmount,
    bidSize: baseAmount,
    latencyMs,
    description: descriptionFromPriceImpact(
      buyQuote.priceImpact ?? 0,
      sellQuote.priceImpact ?? 0
    ),
  });
}

async function quoteOrcaVenue(
  ctx: SolanaScanContext,
  deps: ScannerDeps
): Promise<ScannedVenueQuote> {
  const pool = await getSolanaPool(deps, ctx.connection, 'orca', ctx.base.mint, ctx.quote.mint);
  if (!pool) throw new Error('No Orca pool found for pair');

  const { value: buyQuote, latencyMs } = await timeQuote(() =>
    deps.getOrcaWhirlpoolQuote({
      poolAddress: pool.address,
      inputMint: ctx.quote.mint,
      amount: ctx.quoteSizeRaw,
      slippageBps: ctx.request.slippageBps,
    })
  );

  const baseAmountRaw = buyQuote.amountOut || buyQuote.outAmount || '';
  const baseAmount = fromRawAmount(baseAmountRaw, ctx.base.decimals);
  if (baseAmount <= 0) throw new Error('Orca returned zero base amount');

  const sellQuote = await deps.getOrcaWhirlpoolQuote({
    poolAddress: pool.address,
    inputMint: ctx.base.mint,
    amount: baseAmountRaw,
    slippageBps: ctx.request.slippageBps,
  });
  const quoteRecovered = fromRawAmount(sellQuote.amountOut || sellQuote.outAmount || '', ctx.quote.decimals);

  return buildScannedQuote({
    family: 'solana',
    chain: 'solana',
    platform: 'orca',
    instrumentId: ctx.instrumentId,
    marketId: `orca:${pool.address}`,
    outcome: ctx.instrumentId,
    ask: ctx.request.quoteSize / baseAmount,
    bid: quoteRecovered / baseAmount,
    askSize: baseAmount,
    bidSize: baseAmount,
    latencyMs,
    poolAddress: pool.address,
    description: pool.liquidity ? `pool liquidity ${numberString(pool.liquidity, 2)}` : undefined,
  });
}

async function quoteMeteoraVenue(
  ctx: SolanaScanContext,
  deps: ScannerDeps
): Promise<ScannedVenueQuote> {
  const pool = await getSolanaPool(deps, ctx.connection, 'meteora', ctx.base.mint, ctx.quote.mint);
  if (!pool) throw new Error('No Meteora pool found for pair');

  const { value: buyQuote, latencyMs } = await timeQuote(() =>
    deps.getMeteoraDlmmQuote(ctx.connection, {
      poolAddress: pool.address,
      inputMint: ctx.quote.mint,
      inAmount: ctx.quoteSizeRaw,
      slippageBps: ctx.request.slippageBps,
    })
  );

  const baseAmount = fromRawAmount(buyQuote.outAmount, ctx.base.decimals);
  if (baseAmount <= 0) throw new Error('Meteora returned zero base amount');

  const sellQuote = await deps.getMeteoraDlmmQuote(ctx.connection, {
    poolAddress: pool.address,
    inputMint: ctx.base.mint,
    inAmount: buyQuote.outAmount,
    slippageBps: ctx.request.slippageBps,
  });
  const quoteRecovered = fromRawAmount(sellQuote.outAmount, ctx.quote.decimals);

  return buildScannedQuote({
    family: 'solana',
    chain: 'solana',
    platform: 'meteora',
    instrumentId: ctx.instrumentId,
    marketId: `meteora:${pool.address}`,
    outcome: ctx.instrumentId,
    ask: ctx.request.quoteSize / baseAmount,
    bid: quoteRecovered / baseAmount,
    askSize: baseAmount,
    bidSize: baseAmount,
    latencyMs,
    poolAddress: pool.address,
    description: descriptionFromPriceImpact(
      buyQuote.priceImpact ?? 0,
      sellQuote.priceImpact ?? 0,
      pool.liquidity ? `pool liquidity ${numberString(pool.liquidity, 2)}` : undefined
    ),
  });
}

async function collectSolanaQuotes(
  request: SolanaVenueArbitrageScanRequest,
  deps: ScannerDeps
): Promise<{ quotes: ScannedVenueQuote[]; skipped: SkippedVenue[] }> {
  const tokens = await deps.getTokenList();
  const base = await resolveSolanaTokenSpec(request.baseToken, tokens);
  const quote = await resolveSolanaTokenSpec(request.quoteToken, tokens);
  const connection = deps.getSolanaConnection({ rpcUrl: request.rpcUrl });
  const instrument = instrumentId(request.baseToken, request.quoteToken);
  const quoteSizeRaw = toRawAmount(request.quoteSize, quote.decimals);
  const ctx: SolanaScanContext = {
    request,
    instrumentId: instrument,
    connection,
    base,
    quote,
    quoteSizeRaw,
  };

  const venues = request.venues ?? DEFAULT_SOLANA_SCAN_VENUES;
  const quotes: ScannedVenueQuote[] = [];
  const skipped: SkippedVenue[] = [];

  const settled = await Promise.allSettled(venues.map(async (venue) => {
    switch (venue) {
      case 'jupiter':
        return quoteJupiterVenue(ctx, deps);
      case 'raydium':
        return quoteRaydiumVenue(ctx, deps);
      case 'orca':
        return quoteOrcaVenue(ctx, deps);
      case 'meteora':
        return quoteMeteoraVenue(ctx, deps);
      default:
        throw new Error(`Unsupported Solana venue: ${venue}`);
    }
  }));

  settled.forEach((result, index) => {
    const venue = venues[index];
    if (result.status === 'fulfilled') {
      quotes.push(result.value);
      return;
    }
    skipped.push({
      venue,
      reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });

  return { quotes, skipped };
}

async function quoteUniswapVenue(
  ctx: EvmScanContext,
  deps: ScannerDeps
): Promise<ScannedVenueQuote> {
  const quoteSize = numberString(ctx.request.quoteSize);
  const { value: buyQuote, latencyMs } = await timeQuote(() =>
    deps.getUniswapQuote({
      chain: ctx.request.chain,
      inputToken: ctx.request.quoteToken,
      outputToken: ctx.request.baseToken,
      amount: quoteSize,
      slippageBps: ctx.request.slippageBps,
    })
  );

  const baseAmount = parseNumeric(buyQuote.outputAmount);
  if (baseAmount <= 0) throw new Error('Uniswap returned zero base amount');

  const sellQuote = await deps.getUniswapQuote({
    chain: ctx.request.chain,
    inputToken: ctx.request.baseToken,
    outputToken: ctx.request.quoteToken,
    amount: numberString(baseAmount),
    slippageBps: ctx.request.slippageBps,
  });
  const quoteRecovered = parseNumeric(sellQuote.outputAmount);

  return buildScannedQuote({
    family: 'evm',
    chain: ctx.request.chain,
    platform: 'uniswap',
    instrumentId: ctx.instrumentId,
    marketId: `uniswap:${ctx.request.chain}:${buyQuote.inputToken}:${buyQuote.outputToken}:${buyQuote.feeTier ?? 'best'}`,
    outcome: ctx.instrumentId,
    ask: ctx.request.quoteSize / baseAmount,
    bid: quoteRecovered / baseAmount,
    askSize: baseAmount,
    bidSize: baseAmount,
    latencyMs,
    route: buyQuote.route.join(' -> '),
    description: `fee tier ${buyQuote.feeTier ?? 'best'} | gas ${buyQuote.gasEstimate ?? '0'}`,
  });
}

async function quoteOneInchVenue(
  ctx: EvmScanContext,
  deps: ScannerDeps
): Promise<ScannedVenueQuote> {
  const quoteSize = numberString(ctx.request.quoteSize);
  const { value: buyQuote, latencyMs } = await timeQuote(() =>
    deps.getOneInchQuote({
      chain: ctx.request.chain,
      fromToken: ctx.request.quoteToken,
      toToken: ctx.request.baseToken,
      amount: quoteSize,
      slippageBps: ctx.request.slippageBps,
    })
  );

  const baseAmount = parseNumeric(buyQuote.toAmount);
  if (baseAmount <= 0) throw new Error('1inch returned zero base amount');

  const sellQuote = await deps.getOneInchQuote({
    chain: ctx.request.chain,
    fromToken: ctx.request.baseToken,
    toToken: ctx.request.quoteToken,
    amount: numberString(baseAmount),
    slippageBps: ctx.request.slippageBps,
  });
  const quoteRecovered = parseNumeric(sellQuote.toAmount);

  return buildScannedQuote({
    family: 'evm',
    chain: ctx.request.chain,
    platform: 'oneinch',
    instrumentId: ctx.instrumentId,
    marketId: `oneinch:${ctx.request.chain}:${buyQuote.fromToken.address}:${buyQuote.toToken.address}`,
    outcome: ctx.instrumentId,
    ask: ctx.request.quoteSize / baseAmount,
    bid: quoteRecovered / baseAmount,
    askSize: baseAmount,
    bidSize: baseAmount,
    latencyMs,
    route: uniqueNonEmpty([...buyQuote.protocols, ...sellQuote.protocols]).join(' -> ') || undefined,
    description: `gas ${buyQuote.estimatedGas}`,
  });
}

function pancakeChainFor(chain: EvmChain): PancakeChain | null {
  if (chain === 'ethereum' || chain === 'arbitrum' || chain === 'base') return chain;
  return null;
}

async function quotePancakeVenue(
  ctx: EvmScanContext,
  deps: ScannerDeps
): Promise<ScannedVenueQuote> {
  const pancakeChain = pancakeChainFor(ctx.request.chain);
  if (!pancakeChain) {
    throw new Error(`PancakeSwap quoting is not supported on ${ctx.request.chain}`);
  }

  const quoteSize = numberString(ctx.request.quoteSize);
  const { value: buyQuote, latencyMs } = await timeQuote(() =>
    deps.pancakeQuote({
      chain: pancakeChain,
      inputToken: ctx.request.quoteToken,
      outputToken: ctx.request.baseToken,
      amount: quoteSize,
      slippageBps: ctx.request.slippageBps,
    })
  );

  const baseAmount = parseNumeric(buyQuote.outputAmount);
  if (baseAmount <= 0) throw new Error('PancakeSwap returned zero base amount');

  const sellQuote = await deps.pancakeQuote({
    chain: pancakeChain,
    inputToken: ctx.request.baseToken,
    outputToken: ctx.request.quoteToken,
    amount: numberString(baseAmount),
    slippageBps: ctx.request.slippageBps,
  });
  const quoteRecovered = parseNumeric(sellQuote.outputAmount);

  return buildScannedQuote({
    family: 'evm',
    chain: ctx.request.chain,
    platform: 'pancakeswap',
    instrumentId: ctx.instrumentId,
    marketId: `pancakeswap:${ctx.request.chain}:${buyQuote.inputToken}:${buyQuote.outputToken}:${buyQuote.feeTier ?? 'best'}`,
    outcome: ctx.instrumentId,
    ask: ctx.request.quoteSize / baseAmount,
    bid: quoteRecovered / baseAmount,
    askSize: baseAmount,
    bidSize: baseAmount,
    latencyMs,
    route: buyQuote.route.join(' -> '),
    description: `fee tier ${buyQuote.feeTier ?? 'best'} | gas ${buyQuote.gasEstimate ?? '0'}`,
  });
}

function resolveLighterMarket(
  markets: LighterMarket[],
  baseToken: string,
  quoteToken: string,
  explicitMarket?: string
): LighterMarket | null {
  if (explicitMarket) {
    const target = explicitMarket.trim().toLowerCase();
    return markets.find((market) =>
      market.id.toLowerCase() === target || market.name.toLowerCase() === target
    ) || null;
  }

  const base = normalizeSymbol(baseToken);
  const quote = normalizeSymbol(quoteToken);

  return markets.find((market) => {
    const marketBase = normalizeSymbol(market.baseToken);
    const marketQuote = normalizeSymbol(market.quoteToken);
    return marketBase === base && stableQuoteMatches(marketQuote, quote);
  }) || null;
}

async function quoteLighterVenue(
  ctx: EvmScanContext,
  deps: ScannerDeps
): Promise<ScannedVenueQuote> {
  if (ctx.request.chain !== 'arbitrum') {
    throw new Error('Lighter is only available on Arbitrum');
  }

  const markets = await deps.getLighterMarkets();
  const market = resolveLighterMarket(
    markets,
    ctx.request.baseToken,
    ctx.request.quoteToken,
    ctx.request.lighterMarket
  );
  if (!market) {
    throw new Error(`No Lighter market found for ${ctx.request.baseToken}/${ctx.request.quoteToken}`);
  }

  const { value: orderbook, latencyMs } = await timeQuote(() =>
    deps.getLighterOrderbook(market.id || market.name, 25)
  );

  const bestBid = orderbook.bids[0]?.price ?? 0;
  const bestAsk = orderbook.asks[0]?.price ?? 0;
  const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  if (mid <= 0) throw new Error('Lighter orderbook is empty');

  const targetBaseSize = ctx.request.quoteSize / mid;
  const asks = orderbook.asks.slice().sort((a, b) => a.price - b.price);
  const bids = orderbook.bids.slice().sort((a, b) => b.price - a.price);
  const askFill = computeWeightedAverageFill(asks, targetBaseSize);
  const bidFill = computeWeightedAverageFill(bids, targetBaseSize);
  if (!askFill || !bidFill) throw new Error('Insufficient Lighter depth for requested size');

  return buildScannedQuote({
    family: 'evm',
    chain: ctx.request.chain,
    platform: 'lighter',
    instrumentId: ctx.instrumentId,
    marketId: `lighter:${market.id}`,
    outcome: ctx.instrumentId,
    ask: askFill.averagePrice,
    bid: bidFill.averagePrice,
    askSize: askFill.filledSize,
    bidSize: bidFill.filledSize,
    latencyMs,
    marketName: market.name,
    description: `top bid ${numberString(bestBid, 6)} | top ask ${numberString(bestAsk, 6)}`,
    partial: !askFill.complete || !bidFill.complete,
  });
}

async function collectEvmQuotes(
  request: EvmVenueArbitrageScanRequest,
  deps: ScannerDeps
): Promise<{ quotes: ScannedVenueQuote[]; skipped: SkippedVenue[] }> {
  const venues = request.venues ?? DEFAULT_EVM_SCAN_VENUES;
  const ctx: EvmScanContext = {
    request,
    instrumentId: instrumentId(request.baseToken, request.quoteToken),
  };

  const quotes: ScannedVenueQuote[] = [];
  const skipped: SkippedVenue[] = [];

  const settled = await Promise.allSettled(venues.map(async (venue) => {
    switch (venue) {
      case 'uniswap':
        return quoteUniswapVenue(ctx, deps);
      case 'oneinch':
        return quoteOneInchVenue(ctx, deps);
      case 'pancakeswap':
        return quotePancakeVenue(ctx, deps);
      case 'lighter':
        return quoteLighterVenue(ctx, deps);
      default:
        throw new Error(`Unsupported EVM venue: ${venue}`);
    }
  }));

  settled.forEach((result, index) => {
    const venue = venues[index];
    if (result.status === 'fulfilled') {
      quotes.push(result.value);
      return;
    }
    skipped.push({
      venue,
      reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });

  return { quotes, skipped };
}

export async function scanVenueArbitrage(
  request: VenueArbitrageLiveScanRequest,
  overrides: Partial<ScannerDeps> = {}
): Promise<VenueArbitrageScanResult> {
  const deps: ScannerDeps = { ...defaultDeps, ...overrides };

  if (!Number.isFinite(request.quoteSize) || request.quoteSize <= 0) {
    throw new Error('quoteSize must be a positive number');
  }

  if (request.family === 'solana') {
    const { quotes, skipped } = await collectSolanaQuotes(request, deps);
    return finalizeVenueArbitrageScan(request, quotes, skipped);
  }

  if (request.family === 'evm') {
    const { quotes, skipped } = await collectEvmQuotes(request, deps);
    return finalizeVenueArbitrageScan(request, quotes, skipped);
  }

  const solanaRequest: SolanaVenueArbitrageScanRequest = {
    family: 'solana',
    baseToken: request.baseToken,
    quoteToken: request.quoteToken,
    quoteSize: request.quoteSize,
    slippageBps: request.slippageBps,
    minNetEdgeBps: request.minNetEdgeBps,
    minTargetProfitUsd: request.minTargetProfitUsd,
    executionStyle: request.executionStyle,
    requireCrossedMarket: request.requireCrossedMarket,
    maxQuoteAgeMs: request.maxQuoteAgeMs,
    maxLatencyMs: request.maxLatencyMs,
    latencyPenaltyBpsPerSecond: request.latencyPenaltyBpsPerSecond,
    stalePenaltyBps: request.stalePenaltyBps,
    onlyDirectRoutes: request.onlyDirectRoutes,
    limitPlans: request.limitPlans,
    rpcUrl: request.rpcUrl,
    venues: request.solanaVenues,
  };

  const evmRequest: EvmVenueArbitrageScanRequest = {
    family: 'evm',
    chain: request.chain,
    baseToken: request.baseToken,
    quoteToken: request.quoteToken,
    quoteSize: request.quoteSize,
    slippageBps: request.slippageBps,
    minNetEdgeBps: request.minNetEdgeBps,
    minTargetProfitUsd: request.minTargetProfitUsd,
    executionStyle: request.executionStyle,
    requireCrossedMarket: request.requireCrossedMarket,
    maxQuoteAgeMs: request.maxQuoteAgeMs,
    maxLatencyMs: request.maxLatencyMs,
    latencyPenaltyBpsPerSecond: request.latencyPenaltyBpsPerSecond,
    stalePenaltyBps: request.stalePenaltyBps,
    onlyDirectRoutes: request.onlyDirectRoutes,
    limitPlans: request.limitPlans,
    venues: request.evmVenues,
    lighterMarket: request.lighterMarket,
  };

  const [solanaResult, evmResult] = await Promise.all([
    collectSolanaQuotes(solanaRequest, deps),
    collectEvmQuotes(evmRequest, deps),
  ]);

  return finalizeVenueArbitrageScan(
    request,
    [...solanaResult.quotes, ...evmResult.quotes],
    [...solanaResult.skipped, ...evmResult.skipped],
    ['Cross-chain comparison assumes pre-positioned inventory on both chains.']
  );
}

export {
  DEFAULT_EVM_SCAN_VENUES,
  DEFAULT_SOLANA_SCAN_VENUES,
};
