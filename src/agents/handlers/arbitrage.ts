/**
 * Arbitrage Handlers
 *
 * Platform handlers for cross-platform arbitrage and price comparison
 *
 * Note: execute_arbitrage remains in agents/index.ts due to complex trading dependencies
 */

import type { ToolInput, HandlerResult, HandlersMap, HandlerContext } from './types';
import { safeHandler, errorResult, successResult } from './types';
import type { Market } from '../../types';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Normalize text for comparison (lowercase, remove special chars)
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// =============================================================================
// ARBITRAGE HANDLERS
// =============================================================================

async function findArbitrageHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.feeds) {
    return errorResult('Feed manager not available');
  }

  const minEdge = (toolInput.min_edge as number) || 1;
  const query = (toolInput.query as string | undefined)?.trim() || '';
  const limit = (toolInput.limit as number) || 10;
  const mode = (toolInput.mode as string) || 'both';
  const minVolume = (toolInput.min_volume as number) || 0;
  const platforms = (toolInput.platforms as string[]) || ['polymarket', 'kalshi', 'manifold'];

  return safeHandler(async () => {
    const opportunities: Array<Record<string, unknown>> = [];

    // Internal YES/NO arbitrage (Polymarket only)
    if (mode === 'both' || mode === 'internal') {
      const polyMarkets = await context.feeds!.searchMarkets(query, 'polymarket');
      for (const market of polyMarkets.slice(0, 60)) {
        if (minVolume && (market.volume24h || 0) < minVolume) continue;
        if (market.outcomes.length < 2) continue;

        const yesOutcome = market.outcomes.find((o) => o.name?.toLowerCase() === 'yes') || market.outcomes[0];
        const noOutcome = market.outcomes.find((o) => o.name?.toLowerCase() === 'no') || market.outcomes[1];
        if (!yesOutcome || !noOutcome) continue;

        const yesPrice = yesOutcome.price ?? 0;
        const noPrice = noOutcome.price ?? 0;
        if (!Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) continue;

        const sum = yesPrice + noPrice;
        const edge = (1 - sum) * 100;

        if (edge >= minEdge) {
          opportunities.push({
            type: 'internal_arb',
            platform: market.platform,
            market: market.question,
            yesPrice: `${Math.round(yesPrice * 100)}¢`,
            noPrice: `${Math.round(noPrice * 100)}¢`,
            sum: `${Math.round(sum * 100)}¢`,
            edge: `${edge.toFixed(2)}%`,
            action: `Buy YES at ${Math.round(yesPrice * 100)}¢ + NO at ${Math.round(noPrice * 100)}¢ = ${edge.toFixed(2)}% edge`,
          });
        }
      }
    }

    // Cross-platform price discrepancies
    if (mode === 'both' || mode === 'cross') {
      const searchResults = await Promise.all(
        platforms.map(async (platform) => ({
          platform,
          markets: await context.feeds!.searchMarkets(query, platform),
        }))
      );

      const grouped = new Map<string, Array<{ platform: string; market: Market; yesPrice: number }>>();
      for (const { platform, markets } of searchResults) {
        for (const market of markets.slice(0, 30)) {
          if (minVolume && (market.volume24h || 0) < minVolume) continue;
          const yesOutcome = market.outcomes.find((o) => o.name?.toLowerCase() === 'yes') || market.outcomes[0];
          if (!yesOutcome || !Number.isFinite(yesOutcome.price)) continue;
          const key = normalize(market.question).split(' ').slice(0, 8).join(' ');
          if (!key) continue;
          const list = grouped.get(key) || [];
          list.push({ platform, market, yesPrice: yesOutcome.price });
          grouped.set(key, list);
        }
      }

      for (const [, entries] of grouped.entries()) {
        const uniquePlatforms = new Set(entries.map((e) => e.platform));
        if (uniquePlatforms.size < 2) continue;

        const sorted = entries.slice().sort((a, b) => a.yesPrice - b.yesPrice);
        const low = sorted[0];
        const high = sorted[sorted.length - 1];
        const spread = (high.yesPrice - low.yesPrice) * 100;
        if (spread < minEdge) continue;

        opportunities.push({
          type: 'cross_platform',
          topic: low.market.question,
          low: { platform: low.platform, price: `${Math.round(low.yesPrice * 100)}¢` },
          high: { platform: high.platform, price: `${Math.round(high.yesPrice * 100)}¢` },
          spread: `${spread.toFixed(2)}%`,
        });
      }
    }

    opportunities.sort((a, b) => {
      const edgeA = Number.parseFloat(String((a.edge as string) ?? (a.spread as string) ?? '0')) || 0;
      const edgeB = Number.parseFloat(String((b.edge as string) ?? (b.spread as string) ?? '0')) || 0;
      return edgeB - edgeA;
    });

    return {
      result: {
        query: query || undefined,
        minEdge: `${minEdge}%`,
        mode,
        opportunities: opportunities.slice(0, limit),
        message: opportunities.length === 0
          ? 'No arbitrage opportunities found above the minimum edge threshold.'
          : `Found ${opportunities.length} opportunities`,
      },
    };
  });
}

async function comparePricesHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.feeds) {
    return errorResult('Feed manager not available');
  }

  const query = toolInput.query as string;

  return safeHandler(async () => {
    // Search across all platforms
    const [polyResults, kalshiResults, manifoldResults] = await Promise.all([
      context.feeds!.searchMarkets(query, 'polymarket'),
      context.feeds!.searchMarkets(query, 'kalshi'),
      context.feeds!.searchMarkets(query, 'manifold'),
    ]);

    const comparisons: Array<Record<string, unknown>> = [];

    // Simple string matching to find similar markets
    for (const poly of polyResults.slice(0, 5)) {
      const comparison: Record<string, unknown> = {
        topic: poly.question.slice(0, 60) + (poly.question.length > 60 ? '...' : ''),
        polymarket: poly.outcomes[0] ? `${Math.round(poly.outcomes[0].price * 100)}¢` : 'N/A',
      };

      // Find matching Kalshi market
      const kalshiMatch = kalshiResults.find(k =>
        k.question.toLowerCase().includes(query.toLowerCase()) ||
        poly.question.toLowerCase().includes(k.question.toLowerCase().split(' ')[0])
      );
      if (kalshiMatch?.outcomes[0]) {
        comparison.kalshi = `${Math.round(kalshiMatch.outcomes[0].price * 100)}¢`;
      }

      // Find matching Manifold market
      const manifoldMatch = manifoldResults.find(m =>
        m.question.toLowerCase().includes(query.toLowerCase()) ||
        poly.question.toLowerCase().includes(m.question.toLowerCase().split(' ')[0])
      );
      if (manifoldMatch?.outcomes[0]) {
        comparison.manifold = `${Math.round(manifoldMatch.outcomes[0].price * 100)}¢`;
      }

      comparisons.push(comparison);
    }

    return {
      result: {
        query,
        comparisons,
        tip: 'Look for price differences > 5% for potential cross-platform arbitrage.',
      },
    };
  });
}

// =============================================================================
// EXPORT HANDLERS MAP
// =============================================================================

/**
 * Arbitrage handlers exported as a map
 *
 * Note: execute_arbitrage remains in agents/index.ts due to its complex
 * dependencies on trading execution (Python scripts, credentials manager).
 */
export const arbitrageHandlers: HandlersMap = {
  find_arbitrage: findArbitrageHandler,
  compare_prices: comparePricesHandler,
};

export default arbitrageHandlers;
