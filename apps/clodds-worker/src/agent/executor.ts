/**
 * Tool Executor
 * Executes tool calls and returns results
 */

import type { Env } from '../config';
import type { Platform, User, ArbitrageOpportunity } from '../types';
import { searchMarkets, getMarket, getOrderbook, getActiveMarkets } from '../feeds';
import { getPolymarketPrice } from '../feeds/polymarket';
import {
  createAlert,
  listAlerts,
  deleteAlert,
  listPositions,
  getRecentArbitrage,
} from '../storage/d1';
import { formatPrice, formatKelly, formatMarket } from '../utils/format';

export interface ToolContext {
  env: Env;
  user: User;
}

export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'search_markets':
        return await executeSearchMarkets(input, ctx);

      case 'get_market':
        return await executeGetMarket(input, ctx);

      case 'get_price':
        return await executeGetPrice(input, ctx);

      case 'compare_prices':
        return await executeComparePrices(input, ctx);

      case 'find_arbitrage':
        return await executeFindArbitrage(input, ctx);

      case 'get_portfolio':
        return await executeGetPortfolio(input, ctx);

      case 'create_alert':
        return await executeCreateAlert(input, ctx);

      case 'list_alerts':
        return await executeListAlerts(input, ctx);

      case 'delete_alert':
        return await executeDeleteAlert(input, ctx);

      case 'calculate_kelly':
        return executeCalculateKelly(input);

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    console.error(`Tool execution error (${name}):`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Tool execution failed',
    };
  }
}

async function executeSearchMarkets(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const query = input.query as string;
  const platform = input.platform as Platform | undefined;
  const limit = (input.limit as number) || 10;

  const markets = await searchMarkets(query, ctx.env, platform, limit);

  if (markets.length === 0) {
    return {
      success: true,
      result: 'No markets found matching your query.',
    };
  }

  const formatted = markets.map((m) => ({
    id: m.id,
    platform: m.platform,
    question: m.question,
    price: m.outcomes[0]?.price,
    priceFormatted: formatPrice(m.outcomes[0]?.price ?? 0),
    volume24h: m.volume24h,
    url: m.url,
  }));

  return { success: true, result: formatted };
}

async function executeGetMarket(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const marketId = input.market_id as string;
  const platform = input.platform as Platform;

  const market = await getMarket(marketId, platform, ctx.env);

  if (!market) {
    return { success: false, error: 'Market not found' };
  }

  return {
    success: true,
    result: {
      ...market,
      formatted: formatMarket(market),
    },
  };
}

async function executeGetPrice(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const marketId = input.market_id as string;
  const platform = input.platform as Platform;

  if (platform === 'polymarket') {
    const price = await getPolymarketPrice(marketId, ctx.env);
    if (price === null) {
      return { success: false, error: 'Could not fetch price' };
    }
    return {
      success: true,
      result: { price, formatted: formatPrice(price) },
    };
  }

  // For other platforms, get the market
  const market = await getMarket(marketId, platform, ctx.env);
  if (!market || market.outcomes.length === 0) {
    return { success: false, error: 'Market not found' };
  }

  const price = market.outcomes[0].price;
  return {
    success: true,
    result: { price, formatted: formatPrice(price) },
  };
}

async function executeComparePrices(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const query = input.query as string;

  // Search all platforms
  const markets = await searchMarkets(query, ctx.env, undefined, 20);

  if (markets.length === 0) {
    return {
      success: true,
      result: 'No markets found matching your query.',
    };
  }

  // Group by platform
  const byPlatform: Record<string, typeof markets> = {};
  for (const m of markets) {
    if (!byPlatform[m.platform]) {
      byPlatform[m.platform] = [];
    }
    byPlatform[m.platform].push(m);
  }

  const comparison = Object.entries(byPlatform).map(([platform, pMarkets]) => ({
    platform,
    markets: pMarkets.slice(0, 3).map((m) => ({
      question: m.question,
      price: m.outcomes[0]?.price,
      priceFormatted: formatPrice(m.outcomes[0]?.price ?? 0),
    })),
  }));

  return { success: true, result: comparison };
}

async function executeFindArbitrage(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const minEdge = (input.min_edge as number) || 1;
  const limit = (input.limit as number) || 10;
  const query = input.query as string | undefined;

  // Get active markets
  let markets = query
    ? await searchMarkets(query, ctx.env, undefined, 100)
    : await getActiveMarkets(ctx.env, undefined, 100);

  const opportunities: ArbitrageOpportunity[] = [];

  for (const market of markets) {
    if (market.outcomes.length < 2) continue;

    const yesOutcome = market.outcomes.find((o) =>
      o.name.toLowerCase() === 'yes' || o.name.toLowerCase().includes('yes')
    );
    const noOutcome = market.outcomes.find((o) =>
      o.name.toLowerCase() === 'no' || o.name.toLowerCase().includes('no')
    );

    if (!yesOutcome || !noOutcome) continue;

    const sum = yesOutcome.price + noOutcome.price;
    const edgePct = (1 - sum) * 100;

    if (edgePct >= minEdge) {
      opportunities.push({
        id: `${market.platform}-${market.id}`,
        platform: market.platform,
        marketId: market.id,
        marketQuestion: market.question,
        yesPrice: yesOutcome.price,
        noPrice: noOutcome.price,
        edgePct: edgePct / 100,
        mode: 'internal',
        foundAt: Date.now(),
      });
    }
  }

  // Sort by edge descending
  opportunities.sort((a, b) => b.edgePct - a.edgePct);

  // Also fetch recent from DB
  const recentDb = await getRecentArbitrage(ctx.env.DB, limit);

  const allOpps = [...opportunities, ...recentDb]
    .slice(0, limit)
    .map((opp) => ({
      ...opp,
      edgePctFormatted: `${(opp.edgePct * 100).toFixed(2)}%`,
      sumFormatted: formatPrice(opp.yesPrice + opp.noPrice),
    }));

  return { success: true, result: allOpps };
}

async function executeGetPortfolio(
  _input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const positions = await listPositions(ctx.env.DB, ctx.user.id);

  if (positions.length === 0) {
    return {
      success: true,
      result: 'No positions tracked. Use add_position to manually track positions.',
    };
  }

  const formatted = positions.map((p) => ({
    ...p,
    avgPriceFormatted: formatPrice(p.avgPrice),
    currentValue: `${p.shares} shares @ ${formatPrice(p.avgPrice)}`,
  }));

  return { success: true, result: formatted };
}

async function executeCreateAlert(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const alert = await createAlert(ctx.env.DB, {
    userId: ctx.user.id,
    platform: input.platform as Platform,
    marketId: input.market_id as string,
    marketName: input.market_name as string | undefined,
    conditionType: input.condition_type as 'price_above' | 'price_below' | 'price_change_pct',
    threshold: input.threshold as number,
  });

  return {
    success: true,
    result: {
      alertId: alert.id,
      message: `Alert created: ${alert.conditionType} ${formatPrice(alert.threshold)}`,
    },
  };
}

async function executeListAlerts(
  _input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const alerts = await listAlerts(ctx.env.DB, ctx.user.id);

  if (alerts.length === 0) {
    return { success: true, result: 'No active alerts.' };
  }

  const formatted = alerts.map((a) => ({
    id: a.id,
    market: a.marketName || a.marketId,
    platform: a.platform,
    condition: `${a.conditionType} ${formatPrice(a.threshold)}`,
  }));

  return { success: true, result: formatted };
}

async function executeDeleteAlert(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const alertId = input.alert_id as string;
  const deleted = await deleteAlert(ctx.env.DB, alertId, ctx.user.id);

  if (!deleted) {
    return { success: false, error: 'Alert not found or already deleted' };
  }

  return { success: true, result: { message: 'Alert deleted' } };
}

function executeCalculateKelly(input: Record<string, unknown>): ToolResult {
  const marketPrice = input.market_price as number;
  const estimatedProb = input.estimated_probability as number;
  const bankroll = input.bankroll as number;

  if (marketPrice <= 0 || marketPrice >= 1) {
    return { success: false, error: 'Market price must be between 0 and 1' };
  }

  if (estimatedProb <= 0 || estimatedProb >= 1) {
    return { success: false, error: 'Estimated probability must be between 0 and 1' };
  }

  if (bankroll <= 0) {
    return { success: false, error: 'Bankroll must be positive' };
  }

  const formatted = formatKelly(marketPrice, estimatedProb, bankroll);

  // Calculate values
  const edge = estimatedProb - marketPrice;
  const odds = 1 / marketPrice - 1;
  const kellyFraction = (odds * estimatedProb - (1 - estimatedProb)) / odds;
  const safeFraction = Math.max(0, Math.min(0.25, kellyFraction / 4));
  const betSize = bankroll * safeFraction;

  return {
    success: true,
    result: {
      formatted,
      edge,
      fullKelly: kellyFraction,
      quarterKelly: safeFraction,
      recommendedBetSize: betSize,
    },
  };
}
