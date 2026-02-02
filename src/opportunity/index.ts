/**
 * Opportunity Finding Module - Cross-platform arbitrage and edge detection
 *
 * Features:
 * - Semantic market matching using embeddings
 * - Liquidity-adjusted opportunity scoring
 * - Market identity database with manual linking
 * - Real-time price subscriptions
 * - Full platform coverage (8+ platforms)
 * - Outcome normalization (YES/NO mapping, inverse markets)
 * - Opportunity persistence and analytics
 * - Edge analysis integration (Kelly sizing, external benchmarks)
 *
 * Usage:
 * ```typescript
 * import { createOpportunityFinder } from './opportunity';
 *
 * const finder = createOpportunityFinder(db, feeds, embeddings, config);
 *
 * // Find opportunities
 * const opps = await finder.scan({ minEdge: 1, platforms: ['polymarket', 'kalshi'] });
 *
 * // Subscribe to real-time opportunities
 * finder.on('opportunity', (opp) => console.log('New opportunity:', opp));
 * await finder.startRealtime();
 *
 * // Link markets manually
 * finder.linkMarkets('polymarket:abc123', 'kalshi:xyz789');
 *
 * // Get analytics
 * const stats = finder.getAnalytics({ days: 30 });
 * ```
 */

import { EventEmitter } from 'eventemitter3';
import type { Database } from '../db/index';
import type { FeedManager } from '../feeds/index';
import type { EmbeddingsService } from '../embeddings/index';
import type { Platform, Market, Outcome } from '../types';
import { logger } from '../utils/logger';

// Re-export sub-modules
export * from './matching';
export * from './scoring';
export * from './outcomes';
export * from './analytics';
export * from './links';
export * from './combinatorial';
export * from './executor';
export * from './risk';
export * from './correlation';

import { createMarketMatcher, MarketMatcher, MarketMatch } from './matching';
import { createOpportunityScorer, OpportunityScorer, ScoredOpportunity } from './scoring';
import { createOutcomeNormalizer, OutcomeNormalizer, NormalizedOutcome } from './outcomes';
import { createOpportunityAnalytics, OpportunityAnalytics } from './analytics';
import { createMarketLinker, MarketLinker, MarketLink } from './links';
import { createRiskModeler, RiskModeler, RiskModelOutput, ArbitrageLeg } from './risk';
import { getPlatformFeeRate } from './combinatorial';

// =============================================================================
// TYPES
// =============================================================================

export interface OpportunityFinderConfig {
  /** Minimum edge % to report (default: 0.5) */
  minEdge?: number;
  /** Minimum liquidity $ to consider (default: 100) */
  minLiquidity?: number;
  /** Platforms to scan (default: all) */
  platforms?: Platform[];
  /** Enable real-time subscriptions (default: false) */
  realtime?: boolean;
  /** Scan interval in ms for polling mode (default: 10000) */
  scanIntervalMs?: number;
  /** Opportunity TTL in ms (default: 60000) */
  opportunityTtlMs?: number;
  /** Use semantic matching (default: true if embeddings available) */
  semanticMatching?: boolean;
  /** Similarity threshold for semantic matching (default: 0.85) */
  similarityThreshold?: number;
  /** Include internal arbitrage (YES+NO < $1) (default: true) */
  includeInternal?: boolean;
  /** Include cross-platform arbitrage (default: true) */
  includeCross?: boolean;
  /** Include edge opportunities vs fair value (default: true) */
  includeEdge?: boolean;
}

export interface Opportunity {
  /** Unique opportunity ID */
  id: string;
  /** Opportunity type */
  type: 'internal' | 'cross_platform' | 'edge';
  /** Markets involved */
  markets: OpportunityMarket[];
  /** Calculated spread/edge % (net of platform fees) */
  edgePct: number;
  /** Profit per $100 bet (gross, before fees) */
  profitPer100: number;
  /** Liquidity-adjusted score (0-100) */
  score: number;
  /** Confidence level (0-1) */
  confidence: number;
  /** Recommended Kelly fraction */
  kellyFraction: number;
  /** Estimated slippage % at $100 size */
  estimatedSlippage: number;
  /** Total available liquidity $ */
  totalLiquidity: number;
  /** Execution recommendation */
  execution: ExecutionPlan;
  /** When discovered */
  discoveredAt: Date;
  /** When expires (stale) */
  expiresAt: Date;
  /** Status */
  status: 'active' | 'taken' | 'expired' | 'closed';
  /** Outcome tracking */
  outcome?: OpportunityOutcome;
  /** Match verification info for cross-platform opportunities */
  matchVerification?: {
    /** How the markets were matched */
    method: 'semantic' | 'text' | 'manual' | 'slug';
    /** Similarity score (0-1) */
    similarity: number;
    /** Verification confidence (0-1) */
    verificationConfidence?: number;
    /** Any warnings about the match */
    warnings?: string[];
  };
}

export interface OpportunityMarket {
  /** Platform */
  platform: Platform;
  /** Market ID on platform */
  marketId: string;
  /** Market question/title */
  question: string;
  /** Outcome to trade */
  outcome: string;
  /** Normalized outcome (YES/NO/OTHER) */
  normalizedOutcome: NormalizedOutcome;
  /** Current price */
  price: number;
  /** Bid price */
  bidPrice?: number;
  /** Ask price */
  askPrice?: number;
  /** Spread % */
  spreadPct?: number;
  /** Available liquidity at this price */
  liquidity: number;
  /** 24h volume */
  volume24h: number;
  /** Action to take */
  action: 'buy' | 'sell';
  /** Recommended size */
  recommendedSize: number;
}

export interface ExecutionPlan {
  /** Order of execution */
  steps: ExecutionStep[];
  /** Total estimated cost */
  totalCost: number;
  /** Total estimated profit */
  estimatedProfit: number;
  /** Time sensitivity (seconds until stale) */
  timeSensitivity: number;
  /** Risk level */
  risk: 'low' | 'medium' | 'high';
  /** Warnings */
  warnings: string[];
}

export interface ExecutionStep {
  /** Step order */
  order: number;
  /** Platform */
  platform: Platform;
  /** Market ID */
  marketId: string;
  /** Action */
  action: 'buy' | 'sell';
  /** Outcome */
  outcome: string;
  /** Price */
  price: number;
  /** Size */
  size: number;
  /** Order type recommendation */
  orderType: 'market' | 'limit' | 'maker';
}

export interface OpportunityOutcome {
  /** Was opportunity taken */
  taken: boolean;
  /** Actual fill prices */
  fillPrices?: Record<string, number>;
  /** Actual P&L */
  realizedPnL?: number;
  /** Closed at */
  closedAt?: Date;
  /** Notes */
  notes?: string;
}

export interface OpportunityScanOptions {
  /** Query to filter markets */
  query?: string;
  /** Platforms to scan */
  platforms?: Platform[];
  /** Minimum edge % */
  minEdge?: number;
  /** Minimum liquidity */
  minLiquidity?: number;
  /** Maximum results */
  limit?: number;
  /** Sort by */
  sortBy?: 'edge' | 'score' | 'liquidity' | 'profit';
  /** Include types */
  types?: Array<'internal' | 'cross_platform' | 'edge'>;
}

export interface OpportunityStats {
  /** Total opportunities found */
  totalFound: number;
  /** Opportunities taken */
  taken: number;
  /** Win rate % */
  winRate: number;
  /** Total profit */
  totalProfit: number;
  /** Average edge % */
  avgEdge: number;
  /** Best performing platform pair */
  bestPlatformPair?: { platforms: [Platform, Platform]; winRate: number; profit: number };
  /** By type */
  byType: Record<string, { count: number; winRate: number; profit: number }>;
  /** By platform */
  byPlatform: Record<Platform, { count: number; winRate: number; profit: number }>;
}

export interface OpportunityFinder extends EventEmitter {
  /** Scan for opportunities */
  scan(options?: OpportunityScanOptions): Promise<Opportunity[]>;

  /** Get active opportunities */
  getActive(): Opportunity[];

  /** Get opportunity by ID */
  get(id: string): Opportunity | undefined;

  /** Start real-time scanning */
  startRealtime(): Promise<void>;

  /** Stop real-time scanning */
  stopRealtime(): void;

  /** Link two markets as equivalent */
  linkMarkets(marketA: string, marketB: string, confidence?: number): void;

  /** Unlink markets */
  unlinkMarkets(marketA: string, marketB: string): void;

  /** Get linked markets for a market */
  getLinkedMarkets(marketKey: string): MarketLink[];

  /** Mark opportunity as taken */
  markTaken(id: string, fillPrices?: Record<string, number>): void;

  /** Record opportunity outcome */
  recordOutcome(id: string, outcome: OpportunityOutcome): void;

  /** Get analytics */
  getAnalytics(options?: { days?: number; platform?: Platform }): OpportunityStats;

  /** Get all platform pairs with opportunities */
  getPlatformPairs(): Array<{ platforms: [Platform, Platform]; count: number; avgEdge: number }>;

  /** Estimate execution for opportunity */
  estimateExecution(opportunity: Opportunity, size: number): ExecutionPlan;

  /** Model risk for an opportunity */
  modelRisk(opportunity: Opportunity, positionSize: number): RiskModelOutput;

  /** Sub-components */
  matcher: MarketMatcher;
  scorer: OpportunityScorer;
  normalizer: OutcomeNormalizer;
  analytics: OpportunityAnalytics;
  linker: MarketLinker;
  riskModeler: RiskModeler;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const ALL_PLATFORMS: Platform[] = [
  'polymarket',
  'kalshi',
  'manifold',
  'metaculus',
  'predictit',
  'drift',
  'betfair',
  'smarkets',
];

const DEFAULT_CONFIG: Required<OpportunityFinderConfig> = {
  minEdge: 0.5,
  minLiquidity: 100,
  platforms: ALL_PLATFORMS,
  realtime: false,
  scanIntervalMs: 10000,
  opportunityTtlMs: 60000,
  semanticMatching: true,
  similarityThreshold: 0.85,
  includeInternal: true,
  includeCross: true,
  includeEdge: true,
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createOpportunityFinder(
  db: Database,
  feeds: FeedManager,
  embeddings?: EmbeddingsService,
  config: OpportunityFinderConfig = {}
): OpportunityFinder {
  // Filter out undefined values to preserve defaults
  const definedConfig = Object.fromEntries(
    Object.entries(config).filter(([_, v]) => v !== undefined)
  ) as OpportunityFinderConfig;
  const cfg = { ...DEFAULT_CONFIG, ...definedConfig };
  const emitter = new EventEmitter() as OpportunityFinder;

  // Initialize sub-components
  const matcher = createMarketMatcher(db, embeddings, {
    semanticEnabled: cfg.semanticMatching && !!embeddings,
    similarityThreshold: cfg.similarityThreshold,
  });

  const scorer = createOpportunityScorer({
    minLiquidity: cfg.minLiquidity,
  });

  const normalizer = createOutcomeNormalizer();

  const analytics = createOpportunityAnalytics(db);

  const linker = createMarketLinker(db);

  const riskModeler = createRiskModeler();

  // State
  const activeOpportunities = new Map<string, Opportunity>();
  let scanInterval: ReturnType<typeof setInterval> | null = null;
  let isScanning = false;

  // Initialize DB tables
  initializeTables(db);

  // ==========================================================================
  // CORE SCANNING
  // ==========================================================================

  async function scan(options: OpportunityScanOptions = {}): Promise<Opportunity[]> {
    const {
      query,
      platforms = cfg.platforms,
      minEdge = cfg.minEdge,
      minLiquidity = cfg.minLiquidity,
      limit = 50,
      sortBy = 'score',
      types = ['internal', 'cross_platform', 'edge'],
    } = options;

    const opportunities: Opportunity[] = [];

    try {
      // Fetch markets from all platforms
      const marketsByPlatform = await fetchMarkets(platforms, query);

      // 1. Internal arbitrage (YES + NO < $1)
      if (types.includes('internal') && cfg.includeInternal) {
        const internal = await findInternalArbitrage(marketsByPlatform, minEdge, minLiquidity);
        opportunities.push(...internal);
      }

      // 2. Cross-platform arbitrage
      if (types.includes('cross_platform') && cfg.includeCross) {
        const cross = await findCrossPlatformArbitrage(marketsByPlatform, minEdge, minLiquidity);
        opportunities.push(...cross);
      }

      // 3. Edge vs fair value
      if (types.includes('edge') && cfg.includeEdge) {
        const edge = await findEdgeOpportunities(marketsByPlatform, minEdge, minLiquidity);
        opportunities.push(...edge);
      }

      // Score all opportunities
      for (const opp of opportunities) {
        const scored = scorer.score(opp);
        Object.assign(opp, scored);
      }

      // Sort
      opportunities.sort((a, b) => {
        switch (sortBy) {
          case 'edge':
            return b.edgePct - a.edgePct;
          case 'liquidity':
            return b.totalLiquidity - a.totalLiquidity;
          case 'profit':
            return b.profitPer100 - a.profitPer100;
          case 'score':
          default:
            return b.score - a.score;
        }
      });

      // Update active opportunities
      const now = Date.now();
      for (const opp of opportunities) {
        if (!activeOpportunities.has(opp.id)) {
          activeOpportunities.set(opp.id, opp);
          emitter.emit('opportunity', opp);
          analytics.recordDiscovery(opp as unknown as Parameters<typeof analytics.recordDiscovery>[0]);
        }
      }

      // Expire old opportunities
      for (const [id, opp] of Array.from(activeOpportunities.entries())) {
        if (opp.expiresAt.getTime() < now) {
          opp.status = 'expired';
          activeOpportunities.delete(id);
          emitter.emit('expired', opp);
          analytics.recordExpiry(opp as unknown as Parameters<typeof analytics.recordExpiry>[0]);
        }
      }

      return opportunities.slice(0, limit);
    } catch (error) {
      logger.error({ error }, 'Opportunity scan failed');
      return [];
    }
  }

  async function fetchMarkets(
    platforms: Platform[],
    query?: string
  ): Promise<Map<Platform, Market[]>> {
    const result = new Map<Platform, Market[]>();

    const fetches = platforms.map(async (platform) => {
      try {
        // Use searchMarkets for both cases - empty query returns recent/popular
        const markets = await feeds.searchMarkets(query || '', platform);
        result.set(platform, markets.slice(0, 100));
      } catch (error) {
        logger.warn({ error, platform }, 'Failed to fetch markets');
        result.set(platform, []);
      }
    });

    await Promise.all(fetches);
    return result;
  }

  // ==========================================================================
  // INTERNAL ARBITRAGE (YES + NO < $1)
  // ==========================================================================

  async function findInternalArbitrage(
    marketsByPlatform: Map<Platform, Market[]>,
    minEdge: number,
    minLiquidity: number
  ): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = [];

    for (const [platform, markets] of marketsByPlatform) {
      for (const market of markets) {
        // Only binary markets
        if (market.outcomes.length !== 2) continue;

        const yesOutcome = normalizer.findYes(market.outcomes);
        const noOutcome = normalizer.findNo(market.outcomes);

        if (!yesOutcome || !noOutcome) continue;

        const yesPrice = yesOutcome.price;
        const noPrice = noOutcome.price;

        if (!isValidPrice(yesPrice) || !isValidPrice(noPrice)) continue;

        const sum = yesPrice + noPrice;
        const grossEdgePct = (1 - sum) * 100;

        // Calculate fee-adjusted edge (taker fees on both YES and NO)
        // Note: Polymarket has 0% fees on most markets, so this preserves the edge
        const feeRate = getPlatformFeeRate(platform);
        const totalFees = sum * feeRate; // Fees on total cost
        const netEdgePct = grossEdgePct - (totalFees * 100);
        const edgePct = netEdgePct;

        if (edgePct < minEdge) continue;

        const liquidity = Math.min(
          yesOutcome.volume24h || minLiquidity,
          noOutcome.volume24h || minLiquidity
        );

        if (liquidity < minLiquidity) continue;

        const profitPer100 = (edgePct / 100) * 100;

        const opp: Opportunity = {
          id: `internal_${platform}_${market.id}_${Date.now()}`,
          type: 'internal',
          markets: [
            {
              platform,
              marketId: market.id,
              question: market.question,
              outcome: yesOutcome.name || 'YES',
              normalizedOutcome: 'YES',
              price: yesPrice,
              liquidity: yesOutcome.volume24h || 0,
              volume24h: yesOutcome.volume24h || 0,
              action: 'buy',
              recommendedSize: Math.min(100, liquidity * 0.1),
            },
            {
              platform,
              marketId: market.id,
              question: market.question,
              outcome: noOutcome.name || 'NO',
              normalizedOutcome: 'NO',
              price: noPrice,
              liquidity: noOutcome.volume24h || 0,
              volume24h: noOutcome.volume24h || 0,
              action: 'buy',
              recommendedSize: Math.min(100, liquidity * 0.1),
            },
          ],
          edgePct,
          profitPer100,
          score: 0, // Will be scored later
          confidence: 0.9, // High confidence for internal arb
          kellyFraction: 0,
          estimatedSlippage: 0,
          totalLiquidity: liquidity,
          execution: createExecutionPlan('internal', platform, market, yesPrice, noPrice),
          discoveredAt: new Date(),
          expiresAt: new Date(Date.now() + cfg.opportunityTtlMs),
          status: 'active',
        };

        opportunities.push(opp);
      }
    }

    return opportunities;
  }

  // ==========================================================================
  // CROSS-PLATFORM ARBITRAGE
  // ==========================================================================

  async function findCrossPlatformArbitrage(
    marketsByPlatform: Map<Platform, Market[]>,
    minEdge: number,
    minLiquidity: number
  ): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = [];

    // Get all markets in flat array
    const allMarkets: Array<{ platform: Platform; market: Market }> = [];
    for (const [platform, markets] of marketsByPlatform) {
      for (const market of markets) {
        allMarkets.push({ platform, market });
      }
    }

    // Find matches using semantic matching
    const matches = await matcher.findMatches(allMarkets);

    for (const match of matches) {
      if (match.markets.length < 2) continue;

      // SAFETY CHECK: Skip matches that need human review
      if (match.needsReview) {
        logger.warn(
          {
            canonicalId: match.canonicalId,
            warnings: match.verification?.warnings,
            confidence: match.verification?.confidence,
            markets: match.markets.map((m) => ({
              platform: m.platform,
              id: m.market.id,
              question: m.market.question.slice(0, 80),
            })),
          },
          'Cross-platform match SKIPPED - needs human review before arbitrage'
        );
        continue;
      }

      // Get prices for same outcome across platforms
      const pricesByPlatform: Array<{
        platform: Platform;
        market: Market;
        yesPrice: number;
        noPrice: number;
        liquidity: number;
      }> = [];

      for (const { platform, market } of match.markets) {
        const yesOutcome = normalizer.findYes(market.outcomes);
        const noOutcome = normalizer.findNo(market.outcomes);

        if (!yesOutcome || !isValidPrice(yesOutcome.price)) continue;

        pricesByPlatform.push({
          platform,
          market,
          yesPrice: yesOutcome.price,
          noPrice: noOutcome?.price || 1 - yesOutcome.price,
          liquidity: Math.min(yesOutcome.volume24h || 0, noOutcome?.volume24h || 0),
        });
      }

      if (pricesByPlatform.length < 2) continue;

      // Sort by YES price to find low/high
      pricesByPlatform.sort((a, b) => a.yesPrice - b.yesPrice);

      const lowest = pricesByPlatform[0];
      const highest = pricesByPlatform[pricesByPlatform.length - 1];

      // Strategy 1: Buy YES on low, Sell YES on high (if platforms support selling)
      const grossSpreadYes = (highest.yesPrice - lowest.yesPrice) * 100;

      // Strategy 2: Buy YES on low, Buy NO on high (if NO + YES_low < $1)
      const combinedCost = lowest.yesPrice + highest.noPrice;
      const grossCrossEdge = (1 - combinedCost) * 100;

      // Calculate fee-adjusted edges (fees on both platforms)
      const lowestFeeRate = getPlatformFeeRate(lowest.platform);
      const highestFeeRate = getPlatformFeeRate(highest.platform);
      const totalFeesPct = (lowestFeeRate + highestFeeRate) * 100;

      const spreadYes = grossSpreadYes - totalFeesPct;
      const crossEdge = grossCrossEdge - totalFeesPct;

      const edgePct = Math.max(spreadYes, crossEdge);

      if (edgePct < minEdge) continue;

      const liquidity = Math.min(lowest.liquidity, highest.liquidity);
      if (liquidity < minLiquidity) continue;

      const profitPer100 = (edgePct / 100) * 100;

      const opp: Opportunity = {
        id: `cross_${lowest.platform}_${highest.platform}_${match.canonicalId}_${Date.now()}`,
        type: 'cross_platform',
        markets: [
          {
            platform: lowest.platform,
            marketId: lowest.market.id,
            question: lowest.market.question,
            outcome: 'YES',
            normalizedOutcome: 'YES',
            price: lowest.yesPrice,
            liquidity: lowest.liquidity,
            volume24h: lowest.market.volume24h || 0,
            action: 'buy',
            recommendedSize: Math.min(100, liquidity * 0.1),
          },
          {
            platform: highest.platform,
            marketId: highest.market.id,
            question: highest.market.question,
            outcome: crossEdge > spreadYes ? 'NO' : 'YES',
            normalizedOutcome: crossEdge > spreadYes ? 'NO' : 'YES',
            price: crossEdge > spreadYes ? highest.noPrice : highest.yesPrice,
            liquidity: highest.liquidity,
            volume24h: highest.market.volume24h || 0,
            action: crossEdge > spreadYes ? 'buy' : 'sell',
            recommendedSize: Math.min(100, liquidity * 0.1),
          },
        ],
        edgePct,
        profitPer100,
        score: 0,
        confidence: match.similarity,
        kellyFraction: 0,
        estimatedSlippage: 0,
        totalLiquidity: liquidity,
        execution: createCrossExecutionPlan(lowest, highest, crossEdge > spreadYes),
        discoveredAt: new Date(),
        expiresAt: new Date(Date.now() + cfg.opportunityTtlMs),
        status: 'active',
        matchVerification: {
          method: match.method,
          similarity: match.similarity,
          verificationConfidence: match.verification?.confidence,
          warnings: match.verification?.warnings,
        },
      };

      opportunities.push(opp);
    }

    return opportunities;
  }

  // ==========================================================================
  // EDGE VS FAIR VALUE
  // ==========================================================================

  async function findEdgeOpportunities(
    marketsByPlatform: Map<Platform, Market[]>,
    minEdge: number,
    minLiquidity: number
  ): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = [];

    // Get external fair value estimates (if available)
    // Note: This requires external benchmarks integration - returns empty if not configured
    const fairValues = new Map<string, { probability: number; confidence: number; source: string }>();

    for (const [platform, markets] of marketsByPlatform) {
      for (const market of markets) {
        // Check if we have a fair value estimate for this market
        const fairValue = findFairValue(market, fairValues);
        if (!fairValue) continue;

        const yesOutcome = normalizer.findYes(market.outcomes);
        if (!yesOutcome || !isValidPrice(yesOutcome.price)) continue;

        const marketPrice = yesOutcome.price;
        const edge = fairValue.probability - marketPrice;
        const edgePct = Math.abs(edge) * 100;

        if (edgePct < minEdge) continue;

        const liquidity = yesOutcome.volume24h || 0;
        if (liquidity < minLiquidity) continue;

        // If fair value > market price, buy YES; else buy NO
        const action = edge > 0 ? 'buy' : 'sell';
        const outcome = edge > 0 ? 'YES' : 'NO';

        const opp: Opportunity = {
          id: `edge_${platform}_${market.id}_${Date.now()}`,
          type: 'edge',
          markets: [
            {
              platform,
              marketId: market.id,
              question: market.question,
              outcome,
              normalizedOutcome: outcome as NormalizedOutcome,
              price: marketPrice,
              liquidity,
              volume24h: market.volume24h || 0,
              action,
              recommendedSize: Math.min(100, liquidity * 0.05),
            },
          ],
          edgePct,
          profitPer100: edgePct, // Simplified
          score: 0,
          confidence: fairValue.confidence,
          kellyFraction: calculateKelly(edgePct / 100, fairValue.confidence),
          estimatedSlippage: 0,
          totalLiquidity: liquidity,
          execution: createEdgeExecutionPlan(platform, market, action, outcome, marketPrice),
          discoveredAt: new Date(),
          expiresAt: new Date(Date.now() + cfg.opportunityTtlMs),
          status: 'active',
        };

        opportunities.push(opp);
      }
    }

    return opportunities;
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  function isValidPrice(price: number | undefined): price is number {
    return typeof price === 'number' && Number.isFinite(price) && price > 0 && price < 1;
  }

  function createExecutionPlan(
    type: string,
    platform: Platform,
    market: Market,
    yesPrice: number,
    noPrice: number
  ): ExecutionPlan {
    return {
      steps: [
        {
          order: 1,
          platform,
          marketId: market.id,
          action: 'buy',
          outcome: 'YES',
          price: yesPrice,
          size: 50,
          orderType: 'limit',
        },
        {
          order: 2,
          platform,
          marketId: market.id,
          action: 'buy',
          outcome: 'NO',
          price: noPrice,
          size: 50,
          orderType: 'limit',
        },
      ],
      totalCost: (yesPrice + noPrice) * 50,
      estimatedProfit: (1 - yesPrice - noPrice) * 50,
      timeSensitivity: 30,
      risk: 'low',
      warnings: [],
    };
  }

  function createCrossExecutionPlan(
    lowest: { platform: Platform; market: Market; yesPrice: number },
    highest: { platform: Platform; market: Market; noPrice: number; yesPrice: number },
    buyNo: boolean
  ): ExecutionPlan {
    const warnings: string[] = [];

    // Check for execution risks
    if (lowest.platform !== highest.platform) {
      warnings.push('Cross-platform execution requires accounts on both platforms');
    }

    return {
      steps: [
        {
          order: 1,
          platform: lowest.platform,
          marketId: lowest.market.id,
          action: 'buy',
          outcome: 'YES',
          price: lowest.yesPrice,
          size: 50,
          orderType: 'limit',
        },
        {
          order: 2,
          platform: highest.platform,
          marketId: highest.market.id,
          action: buyNo ? 'buy' : 'sell',
          outcome: buyNo ? 'NO' : 'YES',
          price: buyNo ? highest.noPrice : highest.yesPrice,
          size: 50,
          orderType: 'limit',
        },
      ],
      totalCost: buyNo
        ? (lowest.yesPrice + highest.noPrice) * 50
        : lowest.yesPrice * 50,
      estimatedProfit: buyNo
        ? (1 - lowest.yesPrice - highest.noPrice) * 50
        : (highest.yesPrice - lowest.yesPrice) * 50,
      timeSensitivity: 15, // Cross-platform is more time-sensitive
      risk: 'medium',
      warnings,
    };
  }

  function createEdgeExecutionPlan(
    platform: Platform,
    market: Market,
    action: 'buy' | 'sell',
    outcome: string,
    price: number
  ): ExecutionPlan {
    return {
      steps: [
        {
          order: 1,
          platform,
          marketId: market.id,
          action,
          outcome,
          price,
          size: 50,
          orderType: 'limit',
        },
      ],
      totalCost: action === 'buy' ? price * 50 : 0,
      estimatedProfit: 0, // Unknown until resolution
      timeSensitivity: 60, // Less time-sensitive
      risk: 'medium',
      warnings: ['Edge trades depend on fair value estimate accuracy'],
    };
  }

  function findFairValue(
    market: Market,
    fairValues: Map<string, { probability: number; confidence: number; source: string }>
  ): { probability: number; confidence: number; source: string } | undefined {
    // Try exact match by market ID
    const direct = fairValues.get(`${market.platform}:${market.id}`);
    if (direct) return direct;

    // Try by normalized question
    const normalizedQ = normalizeQuestion(market.question);
    for (const [key, value] of fairValues) {
      if (normalizeQuestion(key).includes(normalizedQ.slice(0, 50))) {
        return value;
      }
    }

    return undefined;
  }

  function normalizeQuestion(q: string): string {
    return q
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function calculateKelly(edge: number, confidence: number): number {
    // Kelly = (bp - q) / b where b=odds, p=win prob, q=lose prob
    // Simplified for binary: kelly = edge * confidence
    const fullKelly = edge * confidence;
    // Use quarter Kelly for safety
    return Math.max(0, Math.min(0.25, fullKelly * 0.25));
  }

  // ==========================================================================
  // REAL-TIME
  // ==========================================================================

  async function startRealtime(): Promise<void> {
    if (isScanning) return;
    isScanning = true;

    logger.info('Starting real-time opportunity scanning');

    // Initial scan
    await scan();

    // Set up polling
    scanInterval = setInterval(async () => {
      if (isScanning) {
        await scan();
      }
    }, cfg.scanIntervalMs);

    // Subscribe to price updates
    for (const platform of cfg.platforms) {
      try {
        feeds.on('priceUpdate', (update) => {
          if (update.platform === platform) {
            handlePriceUpdate(update);
          }
        });
      } catch (error) {
        logger.warn({ error, platform }, 'Failed to subscribe to price updates');
      }
    }

    emitter.emit('started');
  }

  function stopRealtime(): void {
    isScanning = false;

    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }

    logger.info('Stopped real-time opportunity scanning');
    emitter.emit('stopped');
  }

  function handlePriceUpdate(update: { platform: Platform; marketId: string; price: number }): void {
    // Check if this affects any active opportunities
    for (const [id, opp] of activeOpportunities) {
      const affected = opp.markets.find(
        (m) => m.platform === update.platform && m.marketId === update.marketId
      );

      if (affected) {
        // Update price and recalculate
        affected.price = update.price;
        const rescored = scorer.score(opp);
        Object.assign(opp, rescored);

        // Check if still valid
        if (opp.edgePct < cfg.minEdge) {
          opp.status = 'expired';
          activeOpportunities.delete(id);
          emitter.emit('expired', opp);
        } else {
          emitter.emit('updated', opp);
        }
      }
    }
  }

  // ==========================================================================
  // MARKET LINKING
  // ==========================================================================

  function linkMarkets(marketA: string, marketB: string, confidence = 1.0): void {
    linker.link(marketA, marketB, confidence);
    matcher.addManualLink(marketA, marketB);
    logger.info({ marketA, marketB, confidence }, 'Markets linked');
  }

  function unlinkMarkets(marketA: string, marketB: string): void {
    linker.unlink(marketA, marketB);
    matcher.removeManualLink(marketA, marketB);
    logger.info({ marketA, marketB }, 'Markets unlinked');
  }

  function getLinkedMarkets(marketKey: string): MarketLink[] {
    return linker.getLinks(marketKey);
  }

  // ==========================================================================
  // TRACKING
  // ==========================================================================

  function markTaken(id: string, fillPrices?: Record<string, number>): void {
    const opp = activeOpportunities.get(id);
    if (opp) {
      opp.status = 'taken';
      opp.outcome = { taken: true, fillPrices };
      analytics.recordTaken(opp as unknown as Parameters<typeof analytics.recordTaken>[0]);
      emitter.emit('taken', opp);
    }
  }

  function recordOutcome(id: string, outcome: OpportunityOutcome): void {
    const activeOpp = activeOpportunities.get(id);
    const storedOpp = analytics.getOpportunity(id);

    if (activeOpp) {
      activeOpp.outcome = outcome;
      activeOpp.status = 'closed';
      analytics.recordOutcome(activeOpp as unknown as Parameters<typeof analytics.recordOutcome>[0]);
      emitter.emit('closed', activeOpp);
    } else if (storedOpp) {
      // Update stored record directly via analytics
      analytics.recordOutcome({
        id: storedOpp.id,
        type: storedOpp.type,
        markets: JSON.parse(storedOpp.markets),
        edgePct: storedOpp.edgePct,
        profitPer100: storedOpp.profitPer100,
        score: storedOpp.score,
        confidence: storedOpp.confidence,
        totalLiquidity: storedOpp.totalLiquidity,
        status: 'closed',
        discoveredAt: storedOpp.discoveredAt,
        expiresAt: storedOpp.expiresAt,
        outcome,
      });
    }
  }

  function getAnalytics(options?: { days?: number; platform?: Platform }): OpportunityStats {
    return analytics.getStats(options);
  }

  function getPlatformPairs(): Array<{ platforms: [Platform, Platform]; count: number; avgEdge: number }> {
    return analytics.getPlatformPairs();
  }

  function estimateExecution(opportunity: Opportunity, size: number): ExecutionPlan {
    return scorer.estimateExecution(opportunity, size);
  }

  function modelRisk(opportunity: Opportunity, positionSize: number): RiskModelOutput {
    // Convert opportunity markets to arbitrage legs
    const legs: ArbitrageLeg[] = opportunity.markets.map((m) => ({
      platform: m.platform,
      marketId: m.marketId,
      outcomeId: m.outcome,
      side: m.action,
      price: m.price,
      size: m.recommendedSize,
      liquidityAtPrice: m.liquidity,
    }));

    // Determine if same event (internal arb vs cross-platform)
    const sameEvent = opportunity.type === 'internal';

    return riskModeler.modelRisk({
      legs,
      positionSize,
      expectedEdge: opportunity.edgePct,
      sameEvent,
    });
  }

  // ==========================================================================
  // ATTACH TO EMITTER
  // ==========================================================================

  Object.assign(emitter, {
    scan,
    getActive: () => Array.from(activeOpportunities.values()),
    get: (id: string) => activeOpportunities.get(id),
    startRealtime,
    stopRealtime,
    linkMarkets,
    unlinkMarkets,
    getLinkedMarkets,
    markTaken,
    recordOutcome,
    getAnalytics,
    getPlatformPairs,
    estimateExecution,
    modelRisk,
    matcher,
    scorer,
    normalizer,
    analytics,
    linker,
    riskModeler,
  } as Partial<OpportunityFinder>);

  logger.info({ platforms: cfg.platforms.length, minEdge: cfg.minEdge }, 'Opportunity finder initialized');

  return emitter;
}

// =============================================================================
// DATABASE INITIALIZATION
// =============================================================================

function initializeTables(db: Database): void {
  // Market links table
  db.run(`
    CREATE TABLE IF NOT EXISTS market_links (
      id TEXT PRIMARY KEY,
      market_a TEXT NOT NULL,
      market_b TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      source TEXT DEFAULT 'manual',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE(market_a, market_b)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_market_links_a ON market_links(market_a)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_market_links_b ON market_links(market_b)`);

  // Opportunity history table
  db.run(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      markets TEXT NOT NULL,
      edge_pct REAL NOT NULL,
      profit_per_100 REAL NOT NULL,
      score REAL NOT NULL,
      confidence REAL NOT NULL,
      total_liquidity REAL,
      status TEXT DEFAULT 'active',
      discovered_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      taken INTEGER DEFAULT 0,
      fill_prices TEXT,
      realized_pnl REAL,
      closed_at INTEGER,
      notes TEXT
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_opportunities_type ON opportunities(type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_opportunities_discovered ON opportunities(discovered_at)`);

  // Platform pair stats table
  db.run(`
    CREATE TABLE IF NOT EXISTS platform_pair_stats (
      platform_a TEXT NOT NULL,
      platform_b TEXT NOT NULL,
      total_opportunities INTEGER DEFAULT 0,
      taken INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      total_profit REAL DEFAULT 0,
      avg_edge REAL DEFAULT 0,
      last_updated INTEGER,
      PRIMARY KEY (platform_a, platform_b)
    )
  `);

  // Opportunity attribution table for performance analytics
  db.run(`
    CREATE TABLE IF NOT EXISTS opportunity_attribution (
      opportunity_id TEXT PRIMARY KEY,
      edge_source TEXT NOT NULL DEFAULT 'unknown',
      discovered_at INTEGER NOT NULL,
      executed_at INTEGER,
      closed_at INTEGER,
      expected_slippage REAL,
      actual_slippage REAL,
      fill_rate REAL,
      execution_time_ms INTEGER,
      FOREIGN KEY (opportunity_id) REFERENCES opportunities(id)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_attribution_source ON opportunity_attribution(edge_source)`);
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

export type {
  MarketMatch,
  MarketLink,
  ScoredOpportunity,
  NormalizedOutcome,
};

// Re-export verification types for match quality inspection
export type { MatchVerification, ExtractedEntities } from './matching';
