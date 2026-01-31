/**
 * Virtuals Protocol Handlers
 *
 * Platform handlers for Virtuals Protocol AI Agent marketplace on Base
 */

import { createVirtualsFeed, VirtualsFeed, VirtualsAgent } from '../../feeds/virtuals/index';
import type { ToolInput, HandlerResult, HandlerContext, HandlersMap } from './types';
import { safeHandler } from './types';

let feed: VirtualsFeed | null = null;

async function getFeed(): Promise<VirtualsFeed> {
  if (feed) return feed;

  const rpcUrl = process.env.BASE_RPC_URL;
  feed = await createVirtualsFeed({ rpcUrl });
  await feed.connect();
  return feed;
}

/**
 * virtuals_search - Search agents
 */
async function searchHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const query = (toolInput.query as string) || '';

  return safeHandler(async () => {
    const f = await getFeed();
    const markets = await f.searchMarkets(query);
    return { agents: markets.slice(0, 20) };
  });
}

/**
 * virtuals_agent - Get agent details
 */
async function agentHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const agentId = toolInput.agent_id as string;

  return safeHandler(async () => {
    const f = await getFeed();
    const agent = await f.getAgent(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    return agent;
  });
}

/**
 * virtuals_agents - List agents
 */
async function agentsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const category = toolInput.category as string | undefined;
  const sortBy = toolInput.sort_by as 'marketCap' | 'volume24h' | 'priceChange24h' | 'holders' | undefined;
  const sortOrder = toolInput.sort_order as 'asc' | 'desc' | undefined;
  const page = toolInput.page as number | undefined;
  const pageSize = toolInput.page_size as number | undefined;

  return safeHandler(async () => {
    const f = await getFeed();
    const result = await f.getAgents({ category, sortBy, sortOrder, page, pageSize });
    return result;
  });
}

/**
 * virtuals_trending - Get trending agents
 */
async function trendingHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const limit = (toolInput.limit as number) || 10;

  return safeHandler(async () => {
    const f = await getFeed();
    const agents = await f.getTrendingAgents(limit);
    return { agents };
  });
}

/**
 * virtuals_new - Get new agents
 */
async function newHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const limit = (toolInput.limit as number) || 10;

  return safeHandler(async () => {
    const f = await getFeed();
    const agents = await f.getNewAgents(limit);
    return { agents };
  });
}

/**
 * virtuals_price - Get bonding curve price
 */
async function priceHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const tokenAddress = toolInput.token_address as string;

  return safeHandler(async () => {
    const f = await getFeed();
    const price = await f.getBondingCurvePrice(tokenAddress);
    if (price === null) throw new Error(`Could not fetch price for ${tokenAddress}`);
    return { tokenAddress, price };
  });
}

/**
 * virtuals_graduation - Check graduation status
 */
async function graduationHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const tokenAddress = toolInput.token_address as string;

  return safeHandler(async () => {
    const f = await getFeed();
    const [isGraduated, progress] = await Promise.all([
      f.isAgentGraduated(tokenAddress),
      f.getGraduationProgress(tokenAddress),
    ]);
    return { tokenAddress, isGraduated, progressPercent: progress };
  });
}

/**
 * virtuals_market - Get market representation
 */
async function marketHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const agentId = toolInput.agent_id as string;

  return safeHandler(async () => {
    const f = await getFeed();
    const market = await f.getMarket(agentId);
    if (!market) throw new Error(`Agent ${agentId} not found`);
    return market;
  });
}

/**
 * All Virtuals handlers exported as a map
 */
export const virtualsHandlers: HandlersMap = {
  virtuals_search: searchHandler,
  virtuals_agent: agentHandler,
  virtuals_agents: agentsHandler,
  virtuals_trending: trendingHandler,
  virtuals_new: newHandler,
  virtuals_price: priceHandler,
  virtuals_graduation: graduationHandler,
  virtuals_market: marketHandler,
};

export default virtualsHandlers;
