/**
 * Virtuals Protocol Feed
 * AI Agent marketplace on Base chain
 *
 * Features:
 * - Agent discovery and search
 * - Token prices from bonding curves
 * - Market cap and volume tracking
 * - Agent metadata (personality, capabilities)
 *
 * API: https://api.virtuals.io
 * Contracts: Base chain (8453)
 */

import { EventEmitter } from 'events';
import { JsonRpcProvider, Contract, formatUnits } from 'ethers';
import { Market, Outcome, PriceUpdate, Platform } from '../../types';
import { logger } from '../../utils/logger';
import { getGlobalFreshnessTracker, type FreshnessTracker } from '../freshness';

// =============================================================================
// CONSTANTS
// =============================================================================

const VIRTUALS_API_BASE = 'https://api.virtuals.io/api';
const BASE_RPC_DEFAULT = 'https://mainnet.base.org';
const BASE_CHAIN_ID = 8453;

// VIRTUAL token address on Base
const VIRTUAL_TOKEN = '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b';

// Virtuals Protocol contracts on Base
// Note: Individual agent tokens have their own bonding curves - trades go directly to agent token contracts
// The Bonding Proxy is the main router for coordinated trades
const VIRTUALS_BONDING_PROXY = '0xF66DeA7b3e897cD44A5a231c61B6B4423d613259';
const VIRTUALS_SELL_EXECUTOR = '0xF8DD39c71A278FE9F4377D009D7627EF140f809e';
const VIRTUALS_CREATOR_VAULT = '0xdAd686299FB562f89e55DA05F1D96FaBEb2A2E32';

// Rate limiting
const RATE_LIMIT_DELAY_MS = 100; // 10 req/sec

// =============================================================================
// TYPES
// =============================================================================

export type AgentStatus = 'prototype' | 'sentient' | 'graduated';

export interface VirtualsAgent {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  tokenAddress: string;
  creatorAddress: string;
  category?: string;
  personality?: string;
  capabilities?: string[];
  status?: AgentStatus;
  socials?: {
    twitter?: string;
    telegram?: string;
    website?: string;
  };
  stats: {
    price: number;
    priceChange24h?: number;
    marketCap: number;
    volume24h: number;
    holders: number;
    totalSupply: number;
    circulatingSupply: number;
  };
  bondingCurve?: {
    virtualReserve: number;
    tokenReserve: number;
    k: number;
    progressToGraduation?: number; // 0-100%
  };
  uniswapPair?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VirtualsAgentList {
  agents: VirtualsAgent[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VirtualsFeed extends EventEmitter {
  connect: () => Promise<void>;
  disconnect: () => void;
  searchMarkets: (query: string) => Promise<Market[]>;
  getMarket: (agentId: string) => Promise<Market | null>;
  getAgent: (agentId: string) => Promise<VirtualsAgent | null>;
  getAgents: (options?: {
    category?: string;
    sortBy?: 'marketCap' | 'volume24h' | 'priceChange24h' | 'holders';
    sortOrder?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  }) => Promise<VirtualsAgentList>;
  getTrendingAgents: (limit?: number) => Promise<VirtualsAgent[]>;
  getNewAgents: (limit?: number) => Promise<VirtualsAgent[]>;
  subscribeToMarket: (agentId: string) => void;
  unsubscribeFromMarket: (agentId: string) => void;
  // Graduation tracking
  isAgentGraduated: (tokenAddress: string) => Promise<boolean>;
  getGraduationProgress: (tokenAddress: string) => Promise<number>;
  getBondingCurvePrice: (tokenAddress: string) => Promise<number | null>;
}

// Graduation threshold: ~42K VIRTUAL accumulated triggers graduation to Uniswap
const GRADUATION_THRESHOLD = 42000;

// =============================================================================
// ABI FRAGMENTS (from Code4rena audit)
// =============================================================================

// Bonding curve contract (per-agent token)
const BONDING_ABI = [
  'function assetBalance() view returns (uint256)', // VIRTUAL accumulated
  'function tokenBalance() view returns (uint256)', // Agent tokens in curve
  'function graduated() view returns (bool)',
  'function gradThreshold() view returns (uint256)',
  'function k() view returns (uint256)',
  'function getAmountOut(uint256 amountIn, bool isBuy) view returns (uint256)',
];

const ERC20_ABI = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

// =============================================================================
// FEED IMPLEMENTATION
// =============================================================================

export async function createVirtualsFeed(config?: {
  privateKey?: string;
  rpcUrl?: string;
  minMarketCap?: number;
  categories?: string[];
}): Promise<VirtualsFeed> {
  const emitter = new EventEmitter();
  let provider: JsonRpcProvider | null = null;
  let pollInterval: NodeJS.Timeout | null = null;
  const subscribedAgents = new Set<string>();
  const priceCache = new Map<string, number>();
  let lastRequestTime = 0;

  // Freshness tracking
  const freshnessTracker: FreshnessTracker = getGlobalFreshnessTracker();

  const rpcUrl = config?.rpcUrl || process.env.BASE_RPC_URL || BASE_RPC_DEFAULT;
  const minMarketCap = config?.minMarketCap || 0;

  // Rate-limited fetch
  async function rateLimitedFetch(url: string): Promise<Response> {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();

    return fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
  }

  // Initialize provider
  function initProvider(): void {
    if (!provider) {
      provider = new JsonRpcProvider(rpcUrl, BASE_CHAIN_ID);
      logger.info({ rpcUrl }, 'Virtuals: Provider initialized');
    }
  }

  // Emit price update
  function emitAgentPrice(agentId: string, tokenAddress: string, price: number): void {
    const previousPrice = priceCache.get(agentId);
    if (previousPrice !== undefined && previousPrice === price) return;

    freshnessTracker.recordMessage('virtuals', agentId);

    const update: PriceUpdate = {
      platform: 'virtuals',
      marketId: agentId,
      outcomeId: tokenAddress,
      price,
      previousPrice,
      timestamp: Date.now(),
    };
    priceCache.set(agentId, price);
    emitter.emit('price', update);
  }

  // Fetch agent from API
  async function fetchAgent(agentId: string): Promise<VirtualsAgent | null> {
    try {
      const response = await rateLimitedFetch(`${VIRTUALS_API_BASE}/agents/${agentId}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Virtuals API error: ${response.status}`);
      }
      const data = await response.json() as { agent?: VirtualsAgent } | VirtualsAgent;
      if ('agent' in data && data.agent) {
        return data.agent;
      }
      if ('id' in data && (data as VirtualsAgent).id) {
        return data as VirtualsAgent;
      }
      return null;
    } catch (error) {
      logger.warn({ error, agentId }, 'Virtuals: Failed to fetch agent');
      return null;
    }
  }

  // Fetch agents list from API
  async function fetchAgents(params?: {
    category?: string;
    sortBy?: string;
    sortOrder?: string;
    page?: number;
    pageSize?: number;
    search?: string;
  }): Promise<VirtualsAgentList> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.category) queryParams.set('category', params.category);
      if (params?.sortBy) queryParams.set('sortBy', params.sortBy);
      if (params?.sortOrder) queryParams.set('sortOrder', params.sortOrder);
      if (params?.page) queryParams.set('page', params.page.toString());
      if (params?.pageSize) queryParams.set('pageSize', params.pageSize.toString());
      if (params?.search) queryParams.set('search', params.search);
      if (minMarketCap > 0) queryParams.set('minMarketCap', minMarketCap.toString());

      const url = `${VIRTUALS_API_BASE}/agents?${queryParams}`;
      const response = await rateLimitedFetch(url);

      if (!response.ok) {
        throw new Error(`Virtuals API error: ${response.status}`);
      }

      const data = await response.json() as VirtualsAgentList | { data: VirtualsAgentList };
      return 'data' in data ? data.data : data;
    } catch (error) {
      logger.warn({ error }, 'Virtuals: Failed to fetch agents');
      return { agents: [], total: 0, page: 1, pageSize: 20 };
    }
  }

  // Convert agent to Market format
  function agentToMarket(agent: VirtualsAgent): Market {
    const outcomes: Outcome[] = [
      {
        id: agent.tokenAddress,
        tokenId: agent.tokenAddress,
        name: agent.symbol,
        price: agent.stats.price,
        priceChange24h: agent.stats.priceChange24h,
        volume24h: agent.stats.volume24h,
      },
    ];

    return {
      id: agent.id,
      platform: 'virtuals' as Platform,
      slug: agent.symbol.toLowerCase(),
      question: agent.name,
      description: agent.description || agent.personality,
      outcomes,
      volume24h: agent.stats.volume24h,
      liquidity: agent.stats.marketCap,
      endDate: undefined, // AI agents don't expire
      resolved: false,
      tags: agent.category ? [agent.category, 'AI Agent'] : ['AI Agent'],
      url: `https://app.virtuals.io/agents/${agent.id}`,
      createdAt: new Date(agent.createdAt),
      updatedAt: new Date(agent.updatedAt),
    };
  }

  // Poll prices for subscribed agents
  async function pollPrices(): Promise<void> {
    if (subscribedAgents.size === 0) return;

    for (const agentId of subscribedAgents) {
      try {
        const agent = await fetchAgent(agentId);
        if (agent) {
          emitAgentPrice(agentId, agent.tokenAddress, agent.stats.price);
        }
      } catch (error) {
        logger.warn({ error, agentId }, 'Virtuals: Poll price error');
      }
    }
  }

  // Get price from bonding curve contract
  async function getBondingCurvePrice(tokenAddress: string): Promise<number | null> {
    if (!provider) return null;

    try {
      const contract = new Contract(tokenAddress, BONDING_ABI, provider);
      const [assetBalance, tokenBalance] = await Promise.all([
        contract.assetBalance(),
        contract.tokenBalance(),
      ]);

      // Price = assetBalance (VIRTUAL) / tokenBalance (agent tokens)
      const vReserve = Number(formatUnits(assetBalance, 18));
      const tReserve = Number(formatUnits(tokenBalance, 18));
      const price = tReserve > 0 ? vReserve / tReserve : 0;
      return price;
    } catch (error) {
      logger.debug({ error, tokenAddress }, 'Virtuals: Failed to get bonding curve price');
      return null;
    }
  }

  // Check if agent has graduated to Uniswap
  async function isAgentGraduated(tokenAddress: string): Promise<boolean> {
    if (!provider) return false;

    try {
      const contract = new Contract(tokenAddress, BONDING_ABI, provider);
      return await contract.graduated();
    } catch {
      return false;
    }
  }

  // Get graduation progress (0-100%)
  async function getGraduationProgress(tokenAddress: string): Promise<number> {
    if (!provider) return 0;

    try {
      const contract = new Contract(tokenAddress, BONDING_ABI, provider);
      const [assetBalance, threshold] = await Promise.all([
        contract.assetBalance(),
        contract.gradThreshold().catch(() => BigInt(GRADUATION_THRESHOLD) * BigInt(10 ** 18)),
      ]);

      if (threshold === 0n) return 100;
      const progress = (Number(assetBalance) / Number(threshold)) * 100;
      return Math.min(100, progress);
    } catch {
      return 0;
    }
  }

  return Object.assign(emitter, {
    async connect(): Promise<void> {
      initProvider();

      // Start polling every 30 seconds
      pollInterval = setInterval(pollPrices, 30000);

      logger.info('Virtuals: Feed connected');
      emitter.emit('connected');
    },

    disconnect(): void {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      provider = null;
      logger.info('Virtuals: Feed disconnected');
      emitter.emit('disconnected');
    },

    async searchMarkets(query: string): Promise<Market[]> {
      const result = await fetchAgents({ search: query, pageSize: 20 });
      return result.agents.map(agentToMarket);
    },

    async getMarket(agentId: string): Promise<Market | null> {
      const agent = await fetchAgent(agentId);
      if (!agent) return null;
      return agentToMarket(agent);
    },

    async getAgent(agentId: string): Promise<VirtualsAgent | null> {
      return fetchAgent(agentId);
    },

    async getAgents(options?: {
      category?: string;
      sortBy?: 'marketCap' | 'volume24h' | 'priceChange24h' | 'holders';
      sortOrder?: 'asc' | 'desc';
      page?: number;
      pageSize?: number;
    }): Promise<VirtualsAgentList> {
      return fetchAgents(options);
    },

    async getTrendingAgents(limit = 10): Promise<VirtualsAgent[]> {
      const result = await fetchAgents({
        sortBy: 'volume24h',
        sortOrder: 'desc',
        pageSize: limit,
      });
      return result.agents;
    },

    async getNewAgents(limit = 10): Promise<VirtualsAgent[]> {
      const result = await fetchAgents({
        sortBy: 'createdAt',
        sortOrder: 'desc',
        pageSize: limit,
      });
      return result.agents;
    },

    subscribeToMarket(agentId: string): void {
      subscribedAgents.add(agentId);

      freshnessTracker.track('virtuals', agentId, async () => {
        const agent = await fetchAgent(agentId);
        if (agent) {
          emitAgentPrice(agentId, agent.tokenAddress, agent.stats.price);
        }
      });
    },

    unsubscribeFromMarket(agentId: string): void {
      subscribedAgents.delete(agentId);
      priceCache.delete(agentId);
      freshnessTracker.untrack('virtuals', agentId);
    },

    // Graduation tracking methods
    isAgentGraduated,
    getGraduationProgress,
    getBondingCurvePrice,
  }) as VirtualsFeed;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  VIRTUAL_TOKEN,
  BASE_CHAIN_ID,
  VIRTUALS_BONDING_PROXY,
  VIRTUALS_SELL_EXECUTOR,
  VIRTUALS_CREATOR_VAULT,
  GRADUATION_THRESHOLD,
};
