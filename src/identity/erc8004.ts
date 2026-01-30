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
  // Testnets (live)
  'sepolia': { chainId: 11155111, rpc: 'https://rpc.sepolia.org', name: 'Ethereum Sepolia' },
  'base-sepolia': { chainId: 84532, rpc: 'https://sepolia.base.org', name: 'Base Sepolia' },
  'optimism-sepolia': { chainId: 11155420, rpc: 'https://sepolia.optimism.io', name: 'Optimism Sepolia' },
  // Mainnets (pending deployment)
  'ethereum': { chainId: 1, rpc: 'https://eth.llamarpc.com', name: 'Ethereum' },
  'base': { chainId: 8453, rpc: 'https://mainnet.base.org', name: 'Base' },
  'optimism': { chainId: 10, rpc: 'https://mainnet.optimism.io', name: 'Optimism' },
  'arbitrum': { chainId: 42161, rpc: 'https://arb1.arbitrum.io/rpc', name: 'Arbitrum' },
  'polygon': { chainId: 137, rpc: 'https://polygon-rpc.com', name: 'Polygon' },
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
  verifyOwnership(agentId: number, expectedOwner: string): Promise<boolean>;

  // Reputation
  getReputation(agentId: number): Promise<ReputationSummary | null>;
  giveFeedback(agentId: number, score: number, comment?: string): Promise<string>;

  // Full verification
  verify(agentIdOrAddress: number | string): Promise<VerificationResult>;

  // Stats
  getTotalAgents(): Promise<number>;
}

export function createERC8004Client(
  network: keyof typeof ERC8004_NETWORKS = 'base-sepolia',
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
      return await response.json();
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
        // Check if owner has any agents
        const balance = await identityContract.balanceOf(owner);
        if (balance === 0n) return null;

        // Unfortunately ERC-721 doesn't have a direct owner->tokenId lookup
        // We'd need to iterate or use an indexer. For now, return null
        // In production, use The Graph or similar indexer
        logger.debug({ owner }, 'getAgentByOwner requires indexer - not implemented');
        return null;
      } catch (error) {
        logger.debug({ error, owner }, 'Failed to get agent by owner');
        return null;
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
          if (balance === 0n) {
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
  network: keyof typeof ERC8004_NETWORKS = 'base-sepolia'
): Promise<VerificationResult> {
  const client = createERC8004Client(network);
  return client.verify(agentId);
}

/**
 * Check if an address has a registered identity
 */
export async function hasIdentity(
  address: string,
  network: keyof typeof ERC8004_NETWORKS = 'base-sepolia'
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
