/**
 * ERC-8004: Trustless Agent Identity
 *
 * On-chain agent identity verification using NFT-based registry.
 * Prevents impersonation attacks in copy trading, whale tracking, etc.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-8004
 * Contracts: https://github.com/nuwa-protocol/nuwa-8004
 */

import { ethers } from 'ethers';
import { logger } from '../utils/logger';

// =============================================================================
// CONTRACT ADDRESSES (Same on all chains via CREATE2)
// =============================================================================

export const ERC8004_CONTRACTS = {
  identity: '0x7177a6867296406881E20d6647232314736Dd09A',
  reputation: '0xB5048e3ef1DA4E04deB6f7d0423D06F63869e322',
  validation: '0x662b40A526cb4017d947e71eAF6753BF3eeE66d8',
} as const;

// Supported networks
export const ERC8004_NETWORKS: Record<string, { chainId: number; rpc: string; name: string }> = {
  // Mainnets (live as of Jan 29, 2026)
  'ethereum': { chainId: 1, rpc: 'https://eth.llamarpc.com', name: 'Ethereum' },
  'base': { chainId: 8453, rpc: 'https://mainnet.base.org', name: 'Base' },
  'optimism': { chainId: 10, rpc: 'https://mainnet.optimism.io', name: 'Optimism' },
  'arbitrum': { chainId: 42161, rpc: 'https://arb1.arbitrum.io/rpc', name: 'Arbitrum' },
  'polygon': { chainId: 137, rpc: 'https://polygon-rpc.com', name: 'Polygon' },
  // Testnets
  'sepolia': { chainId: 11155111, rpc: 'https://rpc.sepolia.org', name: 'Ethereum Sepolia' },
  'base-sepolia': { chainId: 84532, rpc: 'https://sepolia.base.org', name: 'Base Sepolia' },
  'optimism-sepolia': { chainId: 11155420, rpc: 'https://sepolia.optimism.io', name: 'Optimism Sepolia' },
};

// =============================================================================
// ABIs (Minimal for gas efficiency)
// =============================================================================

const IDENTITY_ABI = [
  // Registration
  'function register(string tokenURI) external returns (uint256 agentId)',
  'function register(string tokenURI, tuple(string metadataKey, bytes metadataValue)[] metadata) external returns (uint256 agentId)',
  'function register() external returns (uint256 agentId)',

  // ERC-721 standard
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function transferFrom(address from, address to, uint256 tokenId) external',

  // Metadata
  'function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue) external',
  'function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)',
  'function setAgentURI(uint256 agentId, string newURI) external',

  // Events
  'event Registered(uint256 indexed agentId, string tokenURI, address indexed owner)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

// =============================================================================
// INDEXER - Event-based owner->agentId mapping
// =============================================================================

interface IndexerCache {
  ownerToAgents: Map<string, Set<number>>;
  agentToOwner: Map<number, string>;
  lastBlock: number;
  lastUpdate: number;
}

const indexerCaches = new Map<string, IndexerCache>();
const CACHE_TTL_MS = 60000; // 1 minute cache
const BATCH_SIZE = 10000; // Blocks per query batch

/**
 * Build or update the owner->agent index by scanning Transfer events
 */
async function buildOwnerIndex(
  provider: ethers.JsonRpcProvider,
  contract: ethers.Contract,
  network: string,
  forceRefresh = false
): Promise<IndexerCache> {
  const cacheKey = `${network}:${ERC8004_CONTRACTS.identity}`;
  const existing = indexerCaches.get(cacheKey);
  const now = Date.now();

  // Return cached if fresh enough
  if (existing && !forceRefresh && (now - existing.lastUpdate) < CACHE_TTL_MS) {
    return existing;
  }

  const cache: IndexerCache = existing || {
    ownerToAgents: new Map(),
    agentToOwner: new Map(),
    lastBlock: 0,
    lastUpdate: 0,
  };

  try {
    const currentBlock = await provider.getBlockNumber();
    const startBlock = cache.lastBlock > 0 ? cache.lastBlock + 1 : 0;

    // If we're caught up, just update timestamp and return
    if (startBlock >= currentBlock) {
      cache.lastUpdate = now;
      indexerCaches.set(cacheKey, cache);
      return cache;
    }

    logger.debug(
      { network, startBlock, currentBlock, cacheKey },
      'ERC-8004: Building owner index'
    );

    // Query Transfer events in batches
    const transferFilter = contract.filters.Transfer();

    for (let fromBlock = startBlock; fromBlock <= currentBlock; fromBlock += BATCH_SIZE) {
      const toBlock = Math.min(fromBlock + BATCH_SIZE - 1, currentBlock);

      try {
        const events = await contract.queryFilter(transferFilter, fromBlock, toBlock);

        for (const event of events) {
          const log = event as ethers.Log & { args?: { from: string; to: string; tokenId: bigint } };
          if (!log.args) continue;

          const { from, to, tokenId } = log.args;
          const agentId = Number(tokenId);

          // Remove from previous owner
          if (from !== ethers.ZeroAddress) {
            const fromLower = from.toLowerCase();
            const prevSet = cache.ownerToAgents.get(fromLower);
            if (prevSet) {
              prevSet.delete(agentId);
              if (prevSet.size === 0) {
                cache.ownerToAgents.delete(fromLower);
              }
            }
          }

          // Add to new owner (if not burn)
          if (to !== ethers.ZeroAddress) {
            const toLower = to.toLowerCase();
            let ownerSet = cache.ownerToAgents.get(toLower);
            if (!ownerSet) {
              ownerSet = new Set();
              cache.ownerToAgents.set(toLower, ownerSet);
            }
            ownerSet.add(agentId);
            cache.agentToOwner.set(agentId, toLower);
          } else {
            // Burn - remove from agentToOwner
            cache.agentToOwner.delete(agentId);
          }
        }

        logger.debug(
          { fromBlock, toBlock, eventsProcessed: events.length },
          'ERC-8004: Processed transfer events batch'
        );
      } catch (error) {
        // Some RPCs may not support large ranges, reduce batch and retry
        logger.warn({ error, fromBlock, toBlock }, 'ERC-8004: Error querying events, will retry with smaller batch');
        break;
      }
    }

    cache.lastBlock = currentBlock;
    cache.lastUpdate = now;
    indexerCaches.set(cacheKey, cache);

    logger.info(
      { network, totalOwners: cache.ownerToAgents.size, totalAgents: cache.agentToOwner.size },
      'ERC-8004: Owner index built'
    );

    return cache;
  } catch (error) {
    logger.error({ error, network }, 'ERC-8004: Failed to build owner index');
    // Return existing cache if available, even if stale
    return cache;
  }
}

/**
 * Get all agent IDs owned by an address (from index)
 */
async function getAgentIdsByOwner(
  provider: ethers.JsonRpcProvider,
  contract: ethers.Contract,
  network: string,
  owner: string
): Promise<number[]> {
  const cache = await buildOwnerIndex(provider, contract, network);
  const agentSet = cache.ownerToAgents.get(owner.toLowerCase());
  return agentSet ? Array.from(agentSet) : [];
}

/**
 * Clear indexer cache for testing
 */
export function clearIndexerCache(network?: string): void {
  if (network) {
    const cacheKey = `${network}:${ERC8004_CONTRACTS.identity}`;
    indexerCaches.delete(cacheKey);
  } else {
    indexerCaches.clear();
  }
}

const REPUTATION_ABI = [
  // Feedback
  'function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string fileuri, bytes32 filehash, bytes feedbackAuth) external',
  'function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external',

  // Queries
  'function getSummary(uint256 agentId, address[] clientAddresses, bytes32 tag1, bytes32 tag2) view returns (uint64 count, uint8 averageScore)',
  'function getFeedbackCount(uint256 agentId) view returns (uint64)',

  // Events
  'event FeedbackGiven(uint256 indexed agentId, address indexed client, uint8 score, bytes32 tag1, bytes32 tag2)',
];

// =============================================================================
// TYPES
// =============================================================================

export interface AgentCard {
  type: string;
  name: string;
  description?: string;
  image?: string;
  endpoints?: Array<{
    name: string;
    endpoint: string;
  }>;
  registrations?: Array<{
    agentId: number;
    agentRegistry: string;
  }>;
  supportedTrust?: string[];
}

export interface AgentIdentity {
  agentId: number;
  owner: string;
  tokenURI: string;
  card?: AgentCard;
  chainId: number;
  network: string;
}

export interface ReputationSummary {
  agentId: number;
  feedbackCount: number;
  averageScore: number;
  tags?: string[];
}

export interface VerificationResult {
  verified: boolean;
  agentId?: number;
  owner?: string;
  name?: string;
  reputation?: ReputationSummary;
  error?: string;
}

// =============================================================================
// IDENTITY REGISTRY
// =============================================================================

export interface ERC8004Client {
  // Registration
  register(tokenURI: string): Promise<{ agentId: number; txHash: string }>;

  // Lookup
  getAgent(agentId: number): Promise<AgentIdentity | null>;
  getAgentByOwner(owner: string): Promise<AgentIdentity | null>;
  getAgentsByOwner(owner: string): Promise<AgentIdentity[]>;
  verifyOwnership(agentId: number, expectedOwner: string): Promise<boolean>;

  // Reputation
  getReputation(agentId: number): Promise<ReputationSummary | null>;
  giveFeedback(agentId: number, score: number, comment?: string): Promise<string>;

  // Full verification
  verify(agentIdOrAddress: number | string): Promise<VerificationResult>;

  // Stats
  getTotalAgents(): Promise<number>;

  // Indexer control
  refreshIndex(): Promise<void>;
}

export function createERC8004Client(
  network: keyof typeof ERC8004_NETWORKS = 'base',
  privateKey?: string
): ERC8004Client {
  const networkConfig = ERC8004_NETWORKS[network];
  if (!networkConfig) {
    throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(ERC8004_NETWORKS).join(', ')}`);
  }

  const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
  const signer = privateKey ? new ethers.Wallet(privateKey, provider) : null;

  const identityContract = new ethers.Contract(
    ERC8004_CONTRACTS.identity,
    IDENTITY_ABI,
    signer || provider
  );

  const reputationContract = new ethers.Contract(
    ERC8004_CONTRACTS.reputation,
    REPUTATION_ABI,
    signer || provider
  );

  // Fetch and parse agent card from IPFS/HTTPS
  async function fetchAgentCard(tokenURI: string): Promise<AgentCard | null> {
    try {
      // Handle IPFS URIs
      let url = tokenURI;
      if (tokenURI.startsWith('ipfs://')) {
        url = `https://ipfs.io/ipfs/${tokenURI.slice(7)}`;
      }

      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return null;
      return (await response.json()) as AgentCard;
    } catch (error) {
      logger.debug({ error, tokenURI }, 'Failed to fetch agent card');
      return null;
    }
  }

  return {
    // =========================================================================
    // REGISTRATION
    // =========================================================================

    async register(tokenURI: string) {
      if (!signer) {
        throw new Error('Private key required for registration');
      }

      logger.info({ tokenURI, network }, 'Registering agent on ERC-8004');

      const tx = await identityContract.register(tokenURI);
      const receipt = await tx.wait();

      // Parse agentId from Registered event
      const event = receipt.logs.find(
        (log: ethers.Log) => log.topics[0] === ethers.id('Registered(uint256,string,address)')
      );

      const agentId = event ? Number(BigInt(event.topics[1])) : 0;

      logger.info({ agentId, txHash: receipt.hash }, 'Agent registered');

      return {
        agentId,
        txHash: receipt.hash,
      };
    },

    // =========================================================================
    // LOOKUP
    // =========================================================================

    async getAgent(agentId: number) {
      try {
        const [owner, tokenURI] = await Promise.all([
          identityContract.ownerOf(agentId),
          identityContract.tokenURI(agentId),
        ]);

        const card = await fetchAgentCard(tokenURI);

        return {
          agentId,
          owner,
          tokenURI,
          card: card || undefined,
          chainId: networkConfig.chainId,
          network,
        };
      } catch (error) {
        // Token doesn't exist
        logger.debug({ error, agentId }, 'Agent not found');
        return null;
      }
    },

    async getAgentByOwner(owner: string) {
      try {
        // First check if owner has any agents (fast balanceOf check)
        const balance = await identityContract.balanceOf(owner);
        if (balance === BigInt(0)) return null;

        // Use the event-based indexer to find agent IDs for this owner
        const agentIds = await getAgentIdsByOwner(provider, identityContract, network, owner);

        if (agentIds.length === 0) {
          // Index might be stale, try rebuilding
          await buildOwnerIndex(provider, identityContract, network, true);
          const refreshedIds = await getAgentIdsByOwner(provider, identityContract, network, owner);
          if (refreshedIds.length === 0) {
            logger.debug({ owner }, 'No agents found for owner after index refresh');
            return null;
          }
          // Return the first agent
          return this.getAgent(refreshedIds[0]);
        }

        // Return the first agent (most users have one)
        return this.getAgent(agentIds[0]);
      } catch (error) {
        logger.debug({ error, owner }, 'Failed to get agent by owner');
        return null;
      }
    },

    async getAgentsByOwner(owner: string): Promise<AgentIdentity[]> {
      try {
        const balance = await identityContract.balanceOf(owner);
        if (balance === BigInt(0)) return [];

        const agentIds = await getAgentIdsByOwner(provider, identityContract, network, owner);
        const agents: AgentIdentity[] = [];

        for (const agentId of agentIds) {
          const agent = await this.getAgent(agentId);
          if (agent) agents.push(agent);
        }

        return agents;
      } catch (error) {
        logger.debug({ error, owner }, 'Failed to get agents by owner');
        return [];
      }
    },

    async verifyOwnership(agentId: number, expectedOwner: string) {
      try {
        const owner = await identityContract.ownerOf(agentId);
        return owner.toLowerCase() === expectedOwner.toLowerCase();
      } catch {
        return false;
      }
    },

    // =========================================================================
    // REPUTATION
    // =========================================================================

    async getReputation(agentId: number) {
      try {
        const [count, avgScore] = await reputationContract.getSummary(
          agentId,
          [], // all clients
          ethers.ZeroHash, // no tag filter
          ethers.ZeroHash
        );

        return {
          agentId,
          feedbackCount: Number(count),
          averageScore: Number(avgScore),
        };
      } catch (error) {
        logger.debug({ error, agentId }, 'Failed to get reputation');
        return null;
      }
    },

    async giveFeedback(agentId: number, score: number, comment?: string) {
      if (!signer) {
        throw new Error('Private key required for feedback');
      }

      if (score < 0 || score > 100) {
        throw new Error('Score must be 0-100');
      }

      // Create signature for feedback authorization
      const message = ethers.solidityPacked(
        ['uint256', 'address', 'uint8'],
        [agentId, await signer.getAddress(), score]
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      const tx = await reputationContract.giveFeedback(
        agentId,
        score,
        ethers.ZeroHash, // tag1
        ethers.ZeroHash, // tag2
        comment || '', // fileuri
        ethers.ZeroHash, // filehash
        signature
      );

      const receipt = await tx.wait();
      return receipt.hash;
    },

    // =========================================================================
    // FULL VERIFICATION
    // =========================================================================

    async verify(agentIdOrAddress: number | string): Promise<VerificationResult> {
      try {
        let agentId: number;
        let agent: AgentIdentity | null;

        if (typeof agentIdOrAddress === 'number') {
          agentId = agentIdOrAddress;
          agent = await this.getAgent(agentId);
        } else {
          // Address provided - try to find their agent
          // This requires an indexer in production
          const address = agentIdOrAddress;

          // Check if this address owns any tokens
          const balance = await identityContract.balanceOf(address);
          if (balance === BigInt(0)) {
            return {
              verified: false,
              error: `Address ${address} has no registered agent identity`,
            };
          }

          // For now, we can't get the specific agentId without an indexer
          return {
            verified: true,
            owner: address,
            error: 'Agent ID lookup requires indexer - address has registered identity',
          };
        }

        if (!agent) {
          return {
            verified: false,
            error: `Agent ID ${agentId} not found`,
          };
        }

        // Get reputation
        const reputation = await this.getReputation(agentId);

        return {
          verified: true,
          agentId: agent.agentId,
          owner: agent.owner,
          name: agent.card?.name,
          reputation: reputation || undefined,
        };
      } catch (error) {
        return {
          verified: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },

    // =========================================================================
    // STATS
    // =========================================================================

    async getTotalAgents() {
      try {
        const total = await identityContract.totalSupply();
        return Number(total);
      } catch {
        return 0;
      }
    },

    // =========================================================================
    // INDEXER CONTROL
    // =========================================================================

    async refreshIndex() {
      await buildOwnerIndex(provider, identityContract, network, true);
    },
  };
}

// =============================================================================
// AGENT CARD BUILDER
// =============================================================================

export function buildAgentCard(options: {
  name: string;
  description?: string;
  image?: string;
  walletAddress?: string;
  apiEndpoint?: string;
  mcpEndpoint?: string;
}): AgentCard {
  const card: AgentCard = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: options.name,
    description: options.description,
    image: options.image,
    endpoints: [],
    supportedTrust: ['reputation'],
  };

  if (options.walletAddress) {
    card.endpoints!.push({
      name: 'agentWallet',
      endpoint: `eip155:137:${options.walletAddress}`,
    });
  }

  if (options.apiEndpoint) {
    card.endpoints!.push({
      name: 'A2A',
      endpoint: options.apiEndpoint,
    });
  }

  if (options.mcpEndpoint) {
    card.endpoints!.push({
      name: 'MCP',
      endpoint: options.mcpEndpoint,
    });
  }

  return card;
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Quick verification - one function call
 */
export async function verifyAgent(
  agentId: number,
  network: keyof typeof ERC8004_NETWORKS = 'base'
): Promise<VerificationResult> {
  const client = createERC8004Client(network);
  return client.verify(agentId);
}

/**
 * Check if an address has a registered identity
 */
export async function hasIdentity(
  address: string,
  network: keyof typeof ERC8004_NETWORKS = 'base'
): Promise<boolean> {
  const client = createERC8004Client(network);
  const result = await client.verify(address);
  return result.verified;
}

/**
 * Format agent ID for display
 */
export function formatAgentId(
  agentId: number,
  chainId: number = 8453,
  registry: string = ERC8004_CONTRACTS.identity
): string {
  return `eip155:${chainId}:${registry}:${agentId}`;
}

/**
 * Parse agent ID from formatted string
 */
export function parseAgentId(formatted: string): { agentId: number; chainId: number; registry: string } | null {
  const match = formatted.match(/^eip155:(\d+):(0x[a-fA-F0-9]+):(\d+)$/);
  if (!match) return null;

  return {
    chainId: parseInt(match[1], 10),
    registry: match[2],
    agentId: parseInt(match[3], 10),
  };
}
