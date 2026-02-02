/**
 * Agent Registry for Agent Commerce Protocol
 *
 * Registry for agents to list and discover services:
 * - Register agent capabilities
 * - List services with pricing
 * - Search by capability/price/reputation
 * - Track service history and ratings
 */

import { createHash, randomBytes } from 'crypto';
import { logger } from '../utils/logger';
import { createAgentPersistence, createRatingPersistence, type AgentPersistence, type RatingPersistence } from './persistence';

// =============================================================================
// TYPES
// =============================================================================

export type AgentStatus = 'active' | 'inactive' | 'suspended';
export type ServiceCategory =
  | 'compute'
  | 'data'
  | 'analytics'
  | 'trading'
  | 'content'
  | 'research'
  | 'automation'
  | 'other';

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  category: ServiceCategory;
  version?: string;
}

export interface ServicePricing {
  model: 'per_request' | 'per_minute' | 'per_token' | 'flat' | 'custom';
  amount: string;
  currency: string;
  minimumCharge?: string;
  maximumCharge?: string;
}

export interface ServiceListing {
  id: string;
  agentId: string;
  capability: AgentCapability;
  pricing: ServicePricing;
  description: string;
  endpoint?: string;
  sla?: {
    availabilityPercent: number;
    maxResponseTimeMs: number;
    maxThroughput?: number;
  };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AgentProfile {
  id: string;
  address: string;
  name: string;
  description?: string;
  avatar?: string;
  website?: string;
  capabilities: AgentCapability[];
  services: ServiceListing[];
  status: AgentStatus;
  reputation: AgentReputation;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface AgentReputation {
  totalTransactions: number;
  successfulTransactions: number;
  averageRating: number;
  totalRatings: number;
  responseTimeAvgMs: number;
  disputeRate: number;
}

export interface ServiceRating {
  id: string;
  serviceId: string;
  raterAddress: string;
  rating: number; // 1-5
  review?: string;
  transactionId?: string;
  createdAt: number;
}

export interface SearchFilters {
  category?: ServiceCategory;
  capabilities?: string[];
  maxPrice?: string;
  minRating?: number;
  minTransactions?: number;
  status?: AgentStatus;
  query?: string;
}

export interface RegistryService {
  // Agent management
  registerAgent(profile: Omit<AgentProfile, 'id' | 'reputation' | 'createdAt' | 'updatedAt'>): Promise<AgentProfile>;
  getAgent(agentId: string): Promise<AgentProfile | null>;
  getAgentByAddress(address: string): Promise<AgentProfile | null>;
  updateAgent(agentId: string, updates: Partial<AgentProfile>): Promise<AgentProfile>;
  deactivateAgent(agentId: string): Promise<void>;

  // Service management
  listService(agentId: string, service: Omit<ServiceListing, 'id' | 'agentId' | 'createdAt' | 'updatedAt'>): Promise<ServiceListing>;
  getService(serviceId: string): Promise<ServiceListing | null>;
  updateService(serviceId: string, updates: Partial<ServiceListing>): Promise<ServiceListing>;
  removeService(serviceId: string): Promise<void>;

  // Discovery
  searchAgents(filters: SearchFilters): Promise<AgentProfile[]>;
  searchServices(filters: SearchFilters): Promise<ServiceListing[]>;
  getTopAgents(category?: ServiceCategory, limit?: number): Promise<AgentProfile[]>;
  getServicesByCapability(capability: string): Promise<ServiceListing[]>;

  // Reputation
  rateService(serviceId: string, raterAddress: string, rating: number, review?: string, transactionId?: string): Promise<ServiceRating>;
  getServiceRatings(serviceId: string): Promise<ServiceRating[]>;
  getAgentRatings(agentId: string): Promise<ServiceRating[]>;
  recordTransaction(agentId: string, success: boolean, responseTimeMs?: number): Promise<void>;

  // Stats
  getStats(): Promise<RegistryStats>;
}

export interface RegistryStats {
  totalAgents: number;
  activeAgents: number;
  totalServices: number;
  activeServices: number;
  totalTransactions: number;
  byCategory: Record<ServiceCategory, number>;
}

// =============================================================================
// STORAGE (in-memory cache backed by database)
// =============================================================================

// In-memory caches for fast access - populated from DB on first access
const agentStore = new Map<string, AgentProfile>();
const addressIndex = new Map<string, string>(); // address -> agentId
const serviceStore = new Map<string, ServiceListing>();
const ratingStore = new Map<string, ServiceRating[]>(); // serviceId -> ratings

// Database persistence (lazy-loaded)
let persistence: AgentPersistence | null = null;
let ratingPersist: RatingPersistence | null = null;
let cacheLoaded = false;

function getPersistence(): AgentPersistence {
  if (!persistence) {
    persistence = createAgentPersistence();
  }
  return persistence;
}

function getRatingPersist(): RatingPersistence {
  if (!ratingPersist) {
    ratingPersist = createRatingPersistence();
  }
  return ratingPersist;
}

async function ensureCacheLoaded(): Promise<void> {
  if (cacheLoaded) return;

  try {
    const agents = await getPersistence().list();
    for (const agent of agents) {
      agentStore.set(agent.id, agent);
      addressIndex.set(agent.address, agent.id);
      for (const service of agent.services) {
        serviceStore.set(service.id, service);
      }
    }
    cacheLoaded = true;
    logger.debug({ agentCount: agents.length }, 'Registry cache loaded from database');
  } catch (error) {
    // If persistence not initialized yet, just use in-memory
    logger.debug('Registry using in-memory only (persistence not initialized)');
    cacheLoaded = true;
  }
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(6).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

function createEmptyReputation(): AgentReputation {
  return {
    totalTransactions: 0,
    successfulTransactions: 0,
    averageRating: 0,
    totalRatings: 0,
    responseTimeAvgMs: 0,
    disputeRate: 0,
  };
}

function updateAverageRating(current: AgentReputation, newRating: number): AgentReputation {
  const totalRatings = current.totalRatings + 1;
  const averageRating = ((current.averageRating * current.totalRatings) + newRating) / totalRatings;

  return {
    ...current,
    totalRatings,
    averageRating: Math.round(averageRating * 100) / 100,
  };
}

function matchesFilters(agent: AgentProfile, filters: SearchFilters): boolean {
  if (filters.status && agent.status !== filters.status) return false;

  if (filters.minRating && agent.reputation.averageRating < filters.minRating) return false;

  if (filters.minTransactions && agent.reputation.totalTransactions < filters.minTransactions) return false;

  if (filters.category) {
    const hasCategory = agent.capabilities.some(c => c.category === filters.category);
    if (!hasCategory) return false;
  }

  if (filters.capabilities?.length) {
    const agentCapNames = agent.capabilities.map(c => c.name.toLowerCase());
    const hasAll = filters.capabilities.every(cap =>
      agentCapNames.some(name => name.includes(cap.toLowerCase()))
    );
    if (!hasAll) return false;
  }

  if (filters.query) {
    const query = filters.query.toLowerCase();
    const searchable = `${agent.name} ${agent.description || ''} ${agent.capabilities.map(c => c.name).join(' ')}`.toLowerCase();
    if (!searchable.includes(query)) return false;
  }

  return true;
}

function serviceMatchesFilters(service: ServiceListing, agent: AgentProfile, filters: SearchFilters): boolean {
  if (!service.enabled) return false;

  if (filters.category && service.capability.category !== filters.category) return false;

  if (filters.maxPrice) {
    const maxPriceBigInt = BigInt(filters.maxPrice);
    const servicePriceBigInt = BigInt(service.pricing.amount);
    if (servicePriceBigInt > maxPriceBigInt) return false;
  }

  if (filters.minRating && agent.reputation.averageRating < filters.minRating) return false;

  if (filters.capabilities?.length) {
    const capName = service.capability.name.toLowerCase();
    const matches = filters.capabilities.some(cap => capName.includes(cap.toLowerCase()));
    if (!matches) return false;
  }

  if (filters.query) {
    const query = filters.query.toLowerCase();
    const searchable = `${service.capability.name} ${service.description}`.toLowerCase();
    if (!searchable.includes(query)) return false;
  }

  return true;
}

export function createRegistryService(): RegistryService {
  return {
    // Agent management
    async registerAgent(profile): Promise<AgentProfile> {
      await ensureCacheLoaded();

      // Check if address already registered (check DB too)
      if (addressIndex.has(profile.address)) {
        throw new Error('Address already registered');
      }

      // Also check database
      try {
        const existingAgent = await getPersistence().getByAddress(profile.address);
        if (existingAgent) {
          throw new Error('Address already registered');
        }
      } catch {
        // Persistence not ready, continue with in-memory only
      }

      const id = generateId('agent');
      const now = Date.now();

      const agent: AgentProfile = {
        ...profile,
        id,
        services: [],
        reputation: createEmptyReputation(),
        createdAt: now,
        updatedAt: now,
      };

      // Save to cache
      agentStore.set(id, agent);
      addressIndex.set(profile.address, id);

      // Persist to database
      try {
        await getPersistence().save(agent);
      } catch (error) {
        logger.debug({ error }, 'Could not persist agent (persistence not initialized)');
      }

      logger.info({ agentId: id, name: profile.name }, 'Agent registered');

      return agent;
    },

    async getAgent(agentId: string): Promise<AgentProfile | null> {
      await ensureCacheLoaded();
      return agentStore.get(agentId) || null;
    },

    async getAgentByAddress(address: string): Promise<AgentProfile | null> {
      await ensureCacheLoaded();
      const agentId = addressIndex.get(address);
      if (!agentId) return null;
      return agentStore.get(agentId) || null;
    },

    async updateAgent(agentId: string, updates: Partial<AgentProfile>): Promise<AgentProfile> {
      await ensureCacheLoaded();
      const agent = agentStore.get(agentId);
      if (!agent) throw new Error('Agent not found');

      const updated: AgentProfile = {
        ...agent,
        ...updates,
        id: agent.id, // Prevent ID change
        address: agent.address, // Prevent address change
        reputation: agent.reputation, // Prevent reputation manipulation
        createdAt: agent.createdAt,
        updatedAt: Date.now(),
      };

      // Update cache
      agentStore.set(agentId, updated);

      // Persist to database
      try {
        await getPersistence().save(updated);
      } catch (error) {
        logger.debug({ error }, 'Could not persist agent update');
      }

      logger.info({ agentId }, 'Agent updated');

      return updated;
    },

    async deactivateAgent(agentId: string): Promise<void> {
      await ensureCacheLoaded();
      const agent = agentStore.get(agentId);
      if (!agent) throw new Error('Agent not found');

      agent.status = 'inactive';
      agent.updatedAt = Date.now();

      // Disable all services
      for (const service of agent.services) {
        service.enabled = false;
      }

      // Update cache
      agentStore.set(agentId, agent);

      // Persist to database
      try {
        await getPersistence().save(agent);
      } catch (error) {
        logger.debug({ error }, 'Could not persist agent deactivation');
      }

      logger.info({ agentId }, 'Agent deactivated');
    },

    // Service management
    async listService(agentId: string, service): Promise<ServiceListing> {
      await ensureCacheLoaded();
      const agent = agentStore.get(agentId);
      if (!agent) throw new Error('Agent not found');

      const id = generateId('svc');
      const now = Date.now();

      const listing: ServiceListing = {
        ...service,
        id,
        agentId,
        createdAt: now,
        updatedAt: now,
      };

      // Update cache
      serviceStore.set(id, listing);
      agent.services.push(listing);
      agent.updatedAt = now;
      agentStore.set(agentId, agent);

      // Persist to database
      try {
        await getPersistence().saveService(agentId, listing);
      } catch (error) {
        logger.debug({ error }, 'Could not persist service');
      }

      logger.info({ serviceId: id, agentId, capability: service.capability.name }, 'Service listed');

      return listing;
    },

    async getService(serviceId: string): Promise<ServiceListing | null> {
      await ensureCacheLoaded();
      return serviceStore.get(serviceId) || null;
    },

    async updateService(serviceId: string, updates: Partial<ServiceListing>): Promise<ServiceListing> {
      await ensureCacheLoaded();
      const service = serviceStore.get(serviceId);
      if (!service) throw new Error('Service not found');

      const updated: ServiceListing = {
        ...service,
        ...updates,
        id: service.id,
        agentId: service.agentId,
        createdAt: service.createdAt,
        updatedAt: Date.now(),
      };

      // Update cache
      serviceStore.set(serviceId, updated);

      // Update in agent's services array
      const agent = agentStore.get(service.agentId);
      if (agent) {
        const idx = agent.services.findIndex(s => s.id === serviceId);
        if (idx >= 0) {
          agent.services[idx] = updated;
          agentStore.set(agent.id, agent);
        }
      }

      // Persist to database
      try {
        await getPersistence().saveService(service.agentId, updated);
      } catch (error) {
        logger.debug({ error }, 'Could not persist service update');
      }

      logger.info({ serviceId }, 'Service updated');
      return updated;
    },

    async removeService(serviceId: string): Promise<void> {
      await ensureCacheLoaded();
      const service = serviceStore.get(serviceId);
      if (!service) throw new Error('Service not found');

      // Update cache
      serviceStore.delete(serviceId);

      // Remove from agent's services
      const agent = agentStore.get(service.agentId);
      if (agent) {
        agent.services = agent.services.filter(s => s.id !== serviceId);
        agent.updatedAt = Date.now();
        agentStore.set(agent.id, agent);

        // Persist full agent to database (will update services)
        try {
          await getPersistence().save(agent);
        } catch (error) {
          logger.debug({ error }, 'Could not persist service removal');
        }
      }

      logger.info({ serviceId, agentId: service.agentId }, 'Service removed');
    },

    // Discovery
    async searchAgents(filters: SearchFilters): Promise<AgentProfile[]> {
      await ensureCacheLoaded();
      const results: AgentProfile[] = [];

      for (const agent of agentStore.values()) {
        if (matchesFilters(agent, filters)) {
          results.push(agent);
        }
      }

      // Sort by reputation
      return results.sort((a, b) => {
        const scoreA = a.reputation.averageRating * Math.log10(a.reputation.totalTransactions + 1);
        const scoreB = b.reputation.averageRating * Math.log10(b.reputation.totalTransactions + 1);
        return scoreB - scoreA;
      });
    },

    async searchServices(filters: SearchFilters): Promise<ServiceListing[]> {
      await ensureCacheLoaded();
      const results: ServiceListing[] = [];

      for (const service of serviceStore.values()) {
        const agent = agentStore.get(service.agentId);
        if (agent && serviceMatchesFilters(service, agent, filters)) {
          results.push(service);
        }
      }

      // Sort by agent reputation and price
      return results.sort((a, b) => {
        const agentA = agentStore.get(a.agentId);
        const agentB = agentStore.get(b.agentId);
        const ratingA = agentA?.reputation.averageRating || 0;
        const ratingB = agentB?.reputation.averageRating || 0;
        return ratingB - ratingA;
      });
    },

    async getTopAgents(category?: ServiceCategory, limit = 10): Promise<AgentProfile[]> {
      const filters: SearchFilters = { status: 'active' };
      if (category) filters.category = category;

      const agents = await this.searchAgents(filters);
      return agents.slice(0, limit);
    },

    async getServicesByCapability(capability: string): Promise<ServiceListing[]> {
      return this.searchServices({ capabilities: [capability] });
    },

    // Reputation
    async rateService(serviceId: string, raterAddress: string, rating: number, review?: string, transactionId?: string): Promise<ServiceRating> {
      await ensureCacheLoaded();
      const service = serviceStore.get(serviceId);
      if (!service) throw new Error('Service not found');

      if (rating < 1 || rating > 5) throw new Error('Rating must be 1-5');

      const ratingId = generateId('rating');
      const serviceRating: ServiceRating = {
        id: ratingId,
        serviceId,
        raterAddress,
        rating,
        review,
        transactionId,
        createdAt: Date.now(),
      };

      // Store rating in cache
      const ratings = ratingStore.get(serviceId) || [];
      ratings.push(serviceRating);
      ratingStore.set(serviceId, ratings);

      // Update agent reputation
      const agent = agentStore.get(service.agentId);
      if (agent) {
        agent.reputation = updateAverageRating(agent.reputation, rating);
        agent.updatedAt = Date.now();
        agentStore.set(agent.id, agent);

        // Persist agent reputation update
        try {
          await getPersistence().save(agent);
        } catch (error) {
          logger.debug({ error }, 'Could not persist agent reputation update');
        }
      }

      // Persist rating to database
      try {
        await getRatingPersist().save(serviceRating);
      } catch (error) {
        logger.debug({ error }, 'Could not persist rating');
      }

      logger.info({ serviceId, rating, rater: raterAddress }, 'Service rated');

      return serviceRating;
    },

    async getServiceRatings(serviceId: string): Promise<ServiceRating[]> {
      // Try to get from database first
      try {
        const dbRatings = await getRatingPersist().getForService(serviceId);
        if (dbRatings.length > 0) {
          ratingStore.set(serviceId, dbRatings);
          return dbRatings;
        }
      } catch {
        // Fall through to cache
      }
      return ratingStore.get(serviceId) || [];
    },

    async getAgentRatings(agentId: string): Promise<ServiceRating[]> {
      await ensureCacheLoaded();
      const agent = agentStore.get(agentId);
      if (!agent) return [];

      const allRatings: ServiceRating[] = [];
      for (const service of agent.services) {
        const ratings = await this.getServiceRatings(service.id);
        allRatings.push(...ratings);
      }

      return allRatings.sort((a, b) => b.createdAt - a.createdAt);
    },

    async recordTransaction(agentId: string, success: boolean, responseTimeMs?: number): Promise<void> {
      await ensureCacheLoaded();
      const agent = agentStore.get(agentId);
      if (!agent) return;

      agent.reputation.totalTransactions++;
      if (success) {
        agent.reputation.successfulTransactions++;
      } else {
        agent.reputation.disputeRate =
          (agent.reputation.totalTransactions - agent.reputation.successfulTransactions) /
          agent.reputation.totalTransactions;
      }

      if (responseTimeMs !== undefined) {
        const total = agent.reputation.responseTimeAvgMs * (agent.reputation.totalTransactions - 1);
        agent.reputation.responseTimeAvgMs = (total + responseTimeMs) / agent.reputation.totalTransactions;
      }

      agent.updatedAt = Date.now();
      agentStore.set(agentId, agent);

      // Persist reputation update
      try {
        await getPersistence().save(agent);
      } catch (error) {
        logger.debug({ error }, 'Could not persist transaction record');
      }
    },

    // Stats
    async getStats(): Promise<RegistryStats> {
      await ensureCacheLoaded();
      const byCategory: Record<ServiceCategory, number> = {
        compute: 0,
        data: 0,
        analytics: 0,
        trading: 0,
        content: 0,
        research: 0,
        automation: 0,
        other: 0,
      };

      let activeAgents = 0;
      let activeServices = 0;
      let totalTransactions = 0;

      for (const agent of agentStore.values()) {
        if (agent.status === 'active') activeAgents++;
        totalTransactions += agent.reputation.totalTransactions;

        for (const service of agent.services) {
          if (service.enabled) {
            activeServices++;
            byCategory[service.capability.category]++;
          }
        }
      }

      return {
        totalAgents: agentStore.size,
        activeAgents,
        totalServices: serviceStore.size,
        activeServices,
        totalTransactions,
        byCategory,
      };
    },
  };
}

// =============================================================================
// SINGLETON & EXPORTS
// =============================================================================

let registryService: RegistryService | null = null;

export function getRegistryService(): RegistryService {
  if (!registryService) {
    registryService = createRegistryService();
  }
  return registryService;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a capability definition
 */
export function createCapability(
  name: string,
  category: ServiceCategory,
  description: string,
  version?: string
): AgentCapability {
  return {
    id: generateId('cap'),
    name,
    category,
    description,
    version,
  };
}

/**
 * Create pricing configuration
 */
export function createPricing(
  model: ServicePricing['model'],
  amount: string,
  currency: string = 'USDC'
): ServicePricing {
  return {
    model,
    amount,
    currency,
  };
}

/**
 * Common capabilities
 */
export const CommonCapabilities = {
  // Compute
  llmInference: createCapability('LLM Inference', 'compute', 'Large language model inference'),
  imageGeneration: createCapability('Image Generation', 'compute', 'AI image generation'),
  codeExecution: createCapability('Code Execution', 'compute', 'Secure code execution sandbox'),

  // Data
  priceFeeds: createCapability('Price Feeds', 'data', 'Real-time cryptocurrency prices'),
  onChainData: createCapability('On-Chain Data', 'data', 'Blockchain data queries'),
  socialData: createCapability('Social Data', 'data', 'Social media metrics and sentiment'),

  // Analytics
  technicalAnalysis: createCapability('Technical Analysis', 'analytics', 'Chart pattern and indicator analysis'),
  sentimentAnalysis: createCapability('Sentiment Analysis', 'analytics', 'Market sentiment scoring'),
  riskAnalysis: createCapability('Risk Analysis', 'analytics', 'Portfolio and trade risk assessment'),

  // Trading
  orderExecution: createCapability('Order Execution', 'trading', 'DEX trade execution'),
  copyTrading: createCapability('Copy Trading', 'trading', 'Follow and copy trades'),
  arbitrage: createCapability('Arbitrage', 'trading', 'Cross-DEX arbitrage execution'),

  // Content
  contentGeneration: createCapability('Content Generation', 'content', 'Text and media creation'),
  translation: createCapability('Translation', 'content', 'Multi-language translation'),

  // Research
  marketResearch: createCapability('Market Research', 'research', 'Deep market analysis'),
  tokenResearch: createCapability('Token Research', 'research', 'Token fundamentals analysis'),

  // Automation
  alerts: createCapability('Alerts', 'automation', 'Custom alert conditions'),
  scheduling: createCapability('Scheduling', 'automation', 'Scheduled task execution'),
};
