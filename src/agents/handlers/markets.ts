/**
 * Market & Portfolio Handlers
 *
 * Platform handlers for market search, portfolio management, alerts, and news
 */

import type { ToolInput, HandlerResult, HandlersMap, HandlerContext } from './types';
import { safeHandler, errorResult, successResult } from './types';
import type { Platform, Alert } from '../../types';
import { randomUUID } from 'crypto';

// =============================================================================
// MARKET SEARCH HANDLERS
// =============================================================================

async function searchMarketsHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const query = toolInput.query as string;
  const platform = toolInput.platform as string | undefined;

  if (!context.feeds) {
    return errorResult('Feed manager not available');
  }

  return safeHandler(async () => {
    const markets = await context.feeds!.searchMarkets(query, platform);

    if (markets.length === 0) {
      return { result: 'No markets found.' };
    }

    return {
      result: markets.slice(0, 8).map(m => ({
        id: m.id,
        platform: m.platform,
        question: m.question,
        outcomes: m.outcomes.slice(0, 3).map(o => ({
          name: o.name,
          price: o.price,
          priceCents: `${Math.round(o.price * 100)}¢`,
        })),
        volume24h: m.volume24h,
        url: m.url,
      })),
    };
  });
}

async function getMarketHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  const platform = toolInput.platform as string;

  if (!context.feeds) {
    return errorResult('Feed manager not available');
  }

  return safeHandler(async () => {
    const market = await context.feeds!.getMarket(marketId, platform);

    if (!market) {
      throw new Error('Market not found');
    }

    return {
      result: {
        ...market,
        outcomes: market.outcomes.map(o => ({
          ...o,
          priceCents: `${Math.round(o.price * 100)}¢`,
        })),
      },
    };
  });
}

// =============================================================================
// PORTFOLIO HANDLERS
// =============================================================================

async function getPortfolioHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const positions = context.db.getPositions(context.userId);

  if (positions.length === 0) {
    return successResult({ result: 'No positions tracked. Use add_position to track manually.' });
  }

  const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
  const totalCost = totalValue - totalPnl;

  return successResult({
    result: {
      positions: positions.map(p => ({
        ...p,
        pnlFormatted: `${p.pnl >= 0 ? '+' : ''}$${p.pnl.toFixed(2)} (${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(1)}%)`,
      })),
      summary: {
        totalValue: `$${totalValue.toFixed(2)}`,
        totalPnl: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`,
        totalPnlPct: totalCost > 0 ? `${((totalPnl / totalCost) * 100).toFixed(1)}%` : '0%',
      },
    },
  });
}

async function getPortfolioHistoryHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const sinceMs = typeof toolInput.since_ms === 'number' ? toolInput.since_ms : undefined;
  const limit = typeof toolInput.limit === 'number' ? toolInput.limit : undefined;
  const order = toolInput.order === 'asc' ? 'asc' : toolInput.order === 'desc' ? 'desc' : undefined;

  const snapshots = context.db.getPortfolioSnapshots(context.userId, {
    sinceMs,
    limit,
    order,
  });

  return successResult({
    result: {
      count: snapshots.length,
      snapshots: snapshots.map((snap) => ({
        ...snap,
        createdAt: snap.createdAt.toISOString(),
      })),
    },
  });
}

async function addPositionHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const position = {
    id: randomUUID(),
    platform: toolInput.platform as Platform,
    marketId: toolInput.market_id as string,
    marketQuestion: toolInput.market_question as string,
    outcome: toolInput.outcome as string,
    outcomeId: `${toolInput.market_id}-${toolInput.outcome}`,
    side: toolInput.side as 'YES' | 'NO',
    shares: toolInput.shares as number,
    avgPrice: toolInput.avg_price as number,
    currentPrice: toolInput.avg_price as number,
    pnl: 0,
    pnlPct: 0,
    value: (toolInput.shares as number) * (toolInput.avg_price as number),
    openedAt: new Date(),
  };

  context.db.upsertPosition(context.userId, position);
  return successResult({ result: 'Position added successfully', position });
}

// =============================================================================
// ALERT HANDLERS
// =============================================================================

async function createAlertHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId || !context.sessionId) {
    return errorResult('Session context not available');
  }

  // Get session info from context
  const session = context.db.getSession(context.sessionId);
  if (!session) {
    return errorResult('Session not found');
  }

  const alert: Alert = {
    id: randomUUID(),
    userId: context.userId,
    type: 'price',
    name: toolInput.market_name as string,
    marketId: toolInput.market_id as string,
    platform: toolInput.platform as Platform,
    channel: session.channel,
    chatId: session.chatId,
    condition: {
      type: toolInput.condition_type as 'price_above' | 'price_below' | 'price_change_pct',
      threshold: toolInput.threshold as number,
    },
    enabled: true,
    triggered: false,
    createdAt: new Date(),
  };

  context.db.createAlert(alert);
  return successResult({
    result: 'Alert created!',
    alert: {
      id: alert.id,
      condition: `${alert.condition.type} ${alert.condition.threshold}`,
    },
  });
}

async function listAlertsHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const alerts = context.db.getAlerts(context.userId);

  if (alerts.length === 0) {
    return successResult({ result: 'No active alerts.' });
  }

  return successResult({
    result: alerts.map(a => ({
      id: a.id,
      name: a.name,
      platform: a.platform,
      condition: `${a.condition.type} ${a.condition.threshold}`,
      enabled: a.enabled,
      triggered: a.triggered,
    })),
  });
}

async function deleteAlertHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  context.db.deleteAlert(toolInput.alert_id as string);
  return successResult({ result: 'Alert deleted.' });
}

// =============================================================================
// NEWS HANDLERS
// =============================================================================

async function getRecentNewsHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.feeds) {
    return errorResult('Feed manager not available');
  }

  const limit = (toolInput.limit as number) || 10;
  const news = context.feeds.getRecentNews(limit);

  if (news.length === 0) {
    return successResult({ result: 'No recent news available.' });
  }

  return successResult({
    result: news.map(n => ({
      title: n.title,
      source: n.source,
      publishedAt: n.publishedAt,
      relevantMarkets: n.relevantMarkets,
      url: n.url,
    })),
  });
}

async function searchNewsHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.feeds) {
    return errorResult('Feed manager not available');
  }

  const query = toolInput.query as string;
  const news = context.feeds.searchNews(query);

  if (news.length === 0) {
    return successResult({ result: 'No news found for that query.' });
  }

  return successResult({
    result: news.slice(0, 10).map(n => ({
      title: n.title,
      source: n.source,
      publishedAt: n.publishedAt,
      url: n.url,
    })),
  });
}

async function getNewsForMarketHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.feeds) {
    return errorResult('Feed manager not available');
  }

  const question = toolInput.market_question as string;
  const news = context.feeds.getNewsForMarket(question);

  if (news.length === 0) {
    return successResult({ result: 'No relevant news found.' });
  }

  return successResult({
    result: news.map(n => ({
      title: n.title,
      source: n.source,
      publishedAt: n.publishedAt,
      url: n.url,
    })),
  });
}

// =============================================================================
// EDGE DETECTION HANDLERS
// =============================================================================

async function analyzeEdgeHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.feeds) {
    return errorResult('Feed manager not available');
  }

  return safeHandler(async () => {
    const analysis = await context.feeds!.analyzeEdge(
      toolInput.market_id as string,
      toolInput.market_question as string,
      toolInput.current_price as number,
      toolInput.category as 'politics' | 'economics' | 'sports' | 'other'
    );

    return {
      result: {
        marketPrice: `${Math.round(analysis.marketPrice * 100)}¢`,
        fairValue: `${Math.round(analysis.fairValue * 100)}¢`,
        edge: `${analysis.edge >= 0 ? '+' : ''}${Math.round(analysis.edge * 100)}¢`,
        edgePct: `${analysis.edgePct >= 0 ? '+' : ''}${analysis.edgePct.toFixed(1)}%`,
        confidence: analysis.confidence,
        sources: analysis.sources.map(s => ({
          name: s.name,
          probability: `${Math.round(s.probability * 100)}%`,
          type: s.type,
        })),
      },
    };
  });
}

async function calculateKellyHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.feeds) {
    return errorResult('Feed manager not available');
  }

  const marketPrice = toolInput.market_price as number;
  const estimatedProbability = toolInput.estimated_probability as number;
  const bankroll = toolInput.bankroll as number;

  const result = context.feeds.calculateKelly(marketPrice, estimatedProbability, bankroll);

  return successResult({
    result: {
      recommendation: 'Use half-Kelly or quarter-Kelly for safety',
      fullKelly: `$${result.fullKelly.toFixed(2)}`,
      halfKelly: `$${result.halfKelly.toFixed(2)} (recommended)`,
      quarterKelly: `$${result.quarterKelly.toFixed(2)} (conservative)`,
    },
  });
}

// =============================================================================
// EXPORT HANDLERS MAP
// =============================================================================

export const marketsHandlers: HandlersMap = {
  // Market search
  search_markets: searchMarketsHandler,
  get_market: getMarketHandler,

  // Portfolio
  get_portfolio: getPortfolioHandler,
  get_portfolio_history: getPortfolioHistoryHandler,
  add_position: addPositionHandler,

  // Alerts
  create_alert: createAlertHandler,
  list_alerts: listAlertsHandler,
  delete_alert: deleteAlertHandler,

  // News
  get_recent_news: getRecentNewsHandler,
  search_news: searchNewsHandler,
  get_news_for_market: getNewsForMarketHandler,

  // Edge detection
  analyze_edge: analyzeEdgeHandler,
  calculate_kelly: calculateKellyHandler,
};

export default marketsHandlers;
