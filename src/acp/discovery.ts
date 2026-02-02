/**
 * Agent Discovery Protocol for Agent Commerce Protocol
 *
 * Intelligent discovery mechanism for finding agents:
 * - Semantic search by capability
 * - Price optimization
 * - Reputation-weighted ranking
 * - Auto-negotiation
 * - Service matching
 */

import { logger } from '../utils/logger';
import {
  getRegistryService,
  AgentProfile,
  ServiceListing,
  ServiceCategory,
  SearchFilters,
} from './registry';
import { getAgreementService, createServiceAgreement, Agreement } from './agreement';
import { getEscrowService, EscrowConfig, Escrow } from './escrow';

// =============================================================================
// TYPES
// =============================================================================

export interface DiscoveryRequest {
  /** What the agent needs */
  need: string;
  /** Preferred categories */
  categories?: ServiceCategory[];
  /** Maximum price willing to pay */
  maxPrice?: string;
  /** Minimum acceptable rating */
  minRating?: number;
  /** Required capabilities (keywords) */
  requiredCapabilities?: string[];
  /** Preferred capabilities (nice to have) */
  preferredCapabilities?: string[];
  /** Deadline for service completion */
  deadline?: number;
  /** Buyer address */
  buyerAddress: string;
}

export interface DiscoveryMatch {
  agent: AgentProfile;
  service: ServiceListing;
  score: number;
  reasons: string[];
  estimatedCost: string;
  estimatedDelivery?: number;
}

export interface NegotiationRequest {
  match: DiscoveryMatch;
  buyerAddress: string;
  proposedPrice?: string;
  proposedDeadline?: number;
  customTerms?: string[];
}

export interface NegotiationResult {
  accepted: boolean;
  counterOffer?: {
    price: string;
    deadline?: number;
    terms?: string[];
  };
  agreement?: Agreement;
  escrow?: Escrow;
}

export interface DiscoveryService {
  /** Find agents/services matching a need */
  discover(request: DiscoveryRequest): Promise<DiscoveryMatch[]>;

  /** Get best match for a need */
  findBest(request: DiscoveryRequest): Promise<DiscoveryMatch | null>;

  /** Initiate negotiation with an agent */
  negotiate(request: NegotiationRequest): Promise<NegotiationResult>;

  /** Auto-negotiate and create agreement */
  autoNegotiate(request: DiscoveryRequest): Promise<NegotiationResult | null>;

  /** Get recommendations based on history */
  getRecommendations(buyerAddress: string, limit?: number): Promise<DiscoveryMatch[]>;

  /** Check if a service can meet requirements */
  canFulfill(service: ServiceListing, requirements: DiscoveryRequest): boolean;
}

// =============================================================================
// SCORING
// =============================================================================

interface ScoringWeights {
  relevance: number;
  reputation: number;
  price: number;
  availability: number;
  experience: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  relevance: 0.35,
  reputation: 0.25,
  price: 0.20,
  availability: 0.10,
  experience: 0.10,
};

function calculateRelevanceScore(service: ServiceListing, request: DiscoveryRequest): number {
  let score = 0;
  const maxScore = 100;

  // Category match
  if (request.categories?.includes(service.capability.category)) {
    score += 30;
  }

  // Required capabilities match
  if (request.requiredCapabilities?.length) {
    const capName = service.capability.name.toLowerCase();
    const capDesc = service.capability.description.toLowerCase();
    const matched = request.requiredCapabilities.filter(
      cap => capName.includes(cap.toLowerCase()) || capDesc.includes(cap.toLowerCase())
    );
    score += (matched.length / request.requiredCapabilities.length) * 40;
  } else {
    score += 20; // No specific requirements
  }

  // Preferred capabilities bonus
  if (request.preferredCapabilities?.length) {
    const capName = service.capability.name.toLowerCase();
    const matched = request.preferredCapabilities.filter(cap => capName.includes(cap.toLowerCase()));
    score += (matched.length / request.preferredCapabilities.length) * 20;
  }

  // Keyword match in need description
  if (request.need) {
    const needWords = request.need.toLowerCase().split(/\s+/);
    const serviceText = `${service.capability.name} ${service.description}`.toLowerCase();
    const matchedWords = needWords.filter(word => word.length > 3 && serviceText.includes(word));
    score += Math.min((matchedWords.length / needWords.length) * 10, 10);
  }

  return Math.min(score, maxScore);
}

function calculateReputationScore(agent: AgentProfile): number {
  const { averageRating, totalTransactions, successfulTransactions, disputeRate } = agent.reputation;

  // Base score from rating (0-50)
  let score = (averageRating / 5) * 50;

  // Experience bonus (0-30)
  const experienceBonus = Math.min(Math.log10(totalTransactions + 1) * 10, 30);
  score += experienceBonus;

  // Success rate bonus (0-15)
  if (totalTransactions > 0) {
    const successRate = successfulTransactions / totalTransactions;
    score += successRate * 15;
  }

  // Dispute penalty
  score -= disputeRate * 20;

  return Math.max(0, Math.min(score, 100));
}

function calculatePriceScore(service: ServiceListing, maxPrice?: string): number {
  if (!maxPrice) return 50; // Neutral if no budget specified

  const servicePrice = BigInt(service.pricing.amount);
  const budget = BigInt(maxPrice);

  if (servicePrice > budget) {
    return 0; // Over budget
  }

  // Score based on how much under budget
  const savingsRatio = Number(budget - servicePrice) / Number(budget);
  return Math.min(50 + savingsRatio * 50, 100);
}

function calculateAvailabilityScore(service: ServiceListing): number {
  if (!service.enabled) return 0;

  let score = 50; // Base score for being available

  if (service.sla) {
    // Availability SLA bonus
    score += (service.sla.availabilityPercent - 90) * 2; // Bonus for >90%

    // Response time bonus
    if (service.sla.maxResponseTimeMs < 1000) {
      score += 20;
    } else if (service.sla.maxResponseTimeMs < 5000) {
      score += 10;
    }
  }

  return Math.min(score, 100);
}

function calculateOverallScore(
  service: ServiceListing,
  agent: AgentProfile,
  request: DiscoveryRequest,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): { score: number; reasons: string[] } {
  const relevance = calculateRelevanceScore(service, request);
  const reputation = calculateReputationScore(agent);
  const price = calculatePriceScore(service, request.maxPrice);
  const availability = calculateAvailabilityScore(service);
  const experience = Math.min(Math.log10(agent.reputation.totalTransactions + 1) * 25, 100);

  const score =
    relevance * weights.relevance +
    reputation * weights.reputation +
    price * weights.price +
    availability * weights.availability +
    experience * weights.experience;

  const reasons: string[] = [];

  if (relevance > 70) reasons.push('Highly relevant to your needs');
  if (reputation > 80) reasons.push('Excellent reputation');
  if (price > 80) reasons.push('Great value for price');
  if (agent.reputation.totalTransactions > 100) reasons.push('Experienced provider');
  if (service.sla?.availabilityPercent && service.sla.availabilityPercent > 99) reasons.push('High availability SLA');

  return { score, reasons };
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createDiscoveryService(): DiscoveryService {
  const registry = getRegistryService();
  const agreements = getAgreementService();

  return {
    async discover(request: DiscoveryRequest): Promise<DiscoveryMatch[]> {
      // Build search filters
      const filters: SearchFilters = {
        status: 'active',
      };

      if (request.categories?.length === 1) {
        filters.category = request.categories[0];
      }

      if (request.maxPrice) {
        filters.maxPrice = request.maxPrice;
      }

      if (request.minRating) {
        filters.minRating = request.minRating;
      }

      if (request.requiredCapabilities?.length) {
        filters.capabilities = request.requiredCapabilities;
      }

      // Search services
      const services = await registry.searchServices(filters);

      // Score and rank matches
      const matches: DiscoveryMatch[] = [];

      for (const service of services) {
        const agent = await registry.getAgent(service.agentId);
        if (!agent || agent.status !== 'active') continue;

        // Check if can fulfill
        if (!this.canFulfill(service, request)) continue;

        const { score, reasons } = calculateOverallScore(service, agent, request);

        matches.push({
          agent,
          service,
          score,
          reasons,
          estimatedCost: service.pricing.amount,
          estimatedDelivery: request.deadline,
        });
      }

      // Sort by score descending
      matches.sort((a, b) => b.score - a.score);

      logger.info({
        need: request.need,
        matchCount: matches.length,
        topScore: matches[0]?.score,
      }, 'Discovery completed');

      return matches;
    },

    async findBest(request: DiscoveryRequest): Promise<DiscoveryMatch | null> {
      const matches = await this.discover(request);
      return matches[0] || null;
    },

    async negotiate(request: NegotiationRequest): Promise<NegotiationResult> {
      const { match, buyerAddress, proposedPrice, proposedDeadline, customTerms } = request;

      // Simple auto-accept logic for now
      // In production, this would involve actual negotiation protocol

      const acceptPrice = proposedPrice
        ? BigInt(proposedPrice) >= BigInt(match.service.pricing.amount)
        : true;

      const acceptDeadline = proposedDeadline
        ? proposedDeadline >= Date.now() + 24 * 60 * 60 * 1000 // At least 24h
        : true;

      if (!acceptPrice || !acceptDeadline) {
        // Counter offer
        return {
          accepted: false,
          counterOffer: {
            price: match.service.pricing.amount,
            deadline: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
            terms: ['Standard service terms apply'],
          },
        };
      }

      // Create agreement
      const price = proposedPrice || match.service.pricing.amount;
      const deadline = proposedDeadline || Date.now() + 7 * 24 * 60 * 60 * 1000;

      const agreementConfig = createServiceAgreement(
        buyerAddress,
        match.agent.address,
        `${match.service.capability.name}: ${match.service.description}`,
        price,
        match.service.pricing.currency,
        deadline
      );

      // Add custom terms
      if (customTerms?.length) {
        for (const term of customTerms) {
          agreementConfig.terms.push({
            id: `custom_${Date.now()}`,
            type: 'custom',
            description: term,
          });
        }
      }

      const agreement = await agreements.create(agreementConfig);

      logger.info({
        agreementId: agreement.id,
        buyer: buyerAddress,
        seller: match.agent.address,
        price,
      }, 'Negotiation successful');

      return {
        accepted: true,
        agreement,
      };
    },

    async autoNegotiate(request: DiscoveryRequest): Promise<NegotiationResult | null> {
      const bestMatch = await this.findBest(request);
      if (!bestMatch) {
        logger.warn({ need: request.need }, 'No matching services found');
        return null;
      }

      return this.negotiate({
        match: bestMatch,
        buyerAddress: request.buyerAddress,
        proposedPrice: request.maxPrice,
        proposedDeadline: request.deadline,
      });
    },

    async getRecommendations(buyerAddress: string, limit = 5): Promise<DiscoveryMatch[]> {
      // Get buyer's past agreements
      const pastAgreements = await agreements.list(buyerAddress);

      // Extract categories and capabilities from past interactions
      const preferredCategories: ServiceCategory[] = [];
      const preferredCapabilities: string[] = [];

      // For now, return top agents in various categories
      const topAgents = await registry.getTopAgents(undefined, limit);

      const matches: DiscoveryMatch[] = [];
      for (const agent of topAgents) {
        const topService = agent.services.find(s => s.enabled);
        if (topService) {
          matches.push({
            agent,
            service: topService,
            score: calculateReputationScore(agent),
            reasons: ['Top-rated provider', 'Recommended based on reputation'],
            estimatedCost: topService.pricing.amount,
          });
        }
      }

      return matches;
    },

    canFulfill(service: ServiceListing, requirements: DiscoveryRequest): boolean {
      if (!service.enabled) return false;

      // Price check
      if (requirements.maxPrice) {
        if (BigInt(service.pricing.amount) > BigInt(requirements.maxPrice)) {
          return false;
        }
      }

      // Category check
      if (requirements.categories?.length) {
        if (!requirements.categories.includes(service.capability.category)) {
          return false;
        }
      }

      // Required capabilities check
      if (requirements.requiredCapabilities?.length) {
        const capText = `${service.capability.name} ${service.capability.description}`.toLowerCase();
        const hasAll = requirements.requiredCapabilities.every(cap =>
          capText.includes(cap.toLowerCase())
        );
        if (!hasAll) return false;
      }

      return true;
    },
  };
}

// =============================================================================
// SINGLETON & EXPORTS
// =============================================================================

let discoveryService: DiscoveryService | null = null;

export function getDiscoveryService(): DiscoveryService {
  if (!discoveryService) {
    discoveryService = createDiscoveryService();
  }
  return discoveryService;
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Quick search for a service
 */
export async function findService(
  need: string,
  buyerAddress: string,
  options?: {
    category?: ServiceCategory;
    maxPrice?: string;
    minRating?: number;
  }
): Promise<DiscoveryMatch | null> {
  const discovery = getDiscoveryService();

  return discovery.findBest({
    need,
    buyerAddress,
    categories: options?.category ? [options.category] : undefined,
    maxPrice: options?.maxPrice,
    minRating: options?.minRating,
  });
}

/**
 * Quick negotiate and create agreement
 */
export async function quickHire(
  need: string,
  buyerAddress: string,
  maxPrice?: string
): Promise<NegotiationResult | null> {
  const discovery = getDiscoveryService();

  return discovery.autoNegotiate({
    need,
    buyerAddress,
    maxPrice,
  });
}
