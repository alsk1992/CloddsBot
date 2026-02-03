/**
 * ERC-8004 Skill - Trustless Agent Identity
 *
 * Register AI agents on Ethereum with verifiable on-chain identity.
 *
 * Commands:
 * /agent-id register           Register your agent
 * /agent-id info <id>          Get agent info
 * /agent-id lookup <address>   Find agent by address
 */

import { createPublicClient, createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';

// Contract addresses
const IDENTITY_REGISTRY: Record<string, Address> = {
  mainnet: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  sepolia: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
};

const REPUTATION_REGISTRY: Record<string, Address> = {
  mainnet: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  sepolia: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
};

const IDENTITY_ABI = [
  {
    inputs: [{ name: 'agentURI', type: 'string' }],
    name: 'register',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'agentId', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'agentId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'newURI', type: 'string' }],
    name: 'setTokenURI',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

function getPublicClient(network: 'mainnet' | 'sepolia' = 'mainnet') {
  const chain = network === 'mainnet' ? mainnet : sepolia;
  const rpcUrl = network === 'mainnet'
    ? (process.env.ETH_RPC_URL || 'https://eth.llamarpc.com')
    : (process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org');

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}

function getWalletClient(network: 'mainnet' | 'sepolia' = 'mainnet') {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error('PRIVATE_KEY not set');

  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey as `0x${string}` : `0x${privateKey}`);
  const chain = network === 'mainnet' ? mainnet : sepolia;
  const rpcUrl = network === 'mainnet'
    ? (process.env.ETH_RPC_URL || 'https://eth.llamarpc.com')
    : (process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org');

  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
}

async function handleRegister(options: {
  name?: string;
  description?: string;
  image?: string;
  testnet?: boolean;
}): Promise<string> {
  try {
    const network = options.testnet ? 'sepolia' : 'mainnet';
    const walletClient = getWalletClient(network);
    const publicClient = getPublicClient(network);
    const registryAddress = IDENTITY_REGISTRY[network];

    // Create registration JSON
    const registration = {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: options.name || `Agent ${walletClient.account.address.slice(0, 8)}`,
      description: options.description || 'An AI agent registered via Clodds',
      image: options.image || '',
      active: true,
      registrations: [],
    };

    // For full implementation, upload to IPFS first
    // For now, use data URI
    const dataUri = `data:application/json;base64,${Buffer.from(JSON.stringify(registration)).toString('base64')}`;

    const hash = await walletClient.writeContract({
      address: registryAddress,
      abi: IDENTITY_ABI,
      functionName: 'register',
      args: [dataUri],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Get the agent ID from events (simplified)
    const totalSupply = await publicClient.readContract({
      address: registryAddress,
      abi: IDENTITY_ABI,
      functionName: 'totalSupply',
    });

    const networkDisplay = network === 'mainnet' ? 'Ethereum Mainnet' : 'Sepolia Testnet';

    return `**Agent Registered!**

**Name:** ${registration.name}
**Agent ID:** ~${totalSupply}
**Network:** ${networkDisplay}
**Owner:** \`${walletClient.account.address}\`

TX: \`${hash}\`
Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}

Your agent now has a verifiable on-chain identity!
View at: https://www.8004.org/agent/${totalSupply}`;
  } catch (error) {
    return `Registration failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleInfo(agentId: string, testnet: boolean = false): Promise<string> {
  if (!agentId) {
    return 'Usage: /agent-id info <agent-id>';
  }

  try {
    const network = testnet ? 'sepolia' : 'mainnet';
    const client = getPublicClient(network);
    const registryAddress = IDENTITY_REGISTRY[network];

    const [owner, tokenURI] = await Promise.all([
      client.readContract({
        address: registryAddress,
        abi: IDENTITY_ABI,
        functionName: 'ownerOf',
        args: [BigInt(agentId)],
      }),
      client.readContract({
        address: registryAddress,
        abi: IDENTITY_ABI,
        functionName: 'tokenURI',
        args: [BigInt(agentId)],
      }),
    ]);

    // Parse metadata if it's a data URI
    let metadata: any = {};
    if (tokenURI.startsWith('data:application/json')) {
      const base64 = tokenURI.split(',')[1];
      metadata = JSON.parse(Buffer.from(base64, 'base64').toString());
    }

    const networkDisplay = network === 'mainnet' ? 'Ethereum' : 'Sepolia';

    let output = `**Agent #${agentId}**\n\n`;
    output += `Network: ${networkDisplay}\n`;
    output += `Owner: \`${owner}\`\n`;

    if (metadata.name) output += `Name: ${metadata.name}\n`;
    if (metadata.description) output += `Description: ${metadata.description}\n`;
    if (metadata.image) output += `Image: ${metadata.image}\n`;
    if (metadata.active !== undefined) output += `Active: ${metadata.active ? 'Yes' : 'No'}\n`;

    output += `\nView: https://www.8004.org/agent/${agentId}`;

    return output;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('ERC721')) {
      return `Agent #${agentId} not found.`;
    }
    return `Error: ${msg}`;
  }
}

async function handleLookup(address: string, testnet: boolean = false): Promise<string> {
  if (!address) {
    return 'Usage: /agent-id lookup <address>';
  }

  // Note: Full implementation would query Transfer events to find owned agents
  return `**Agent Lookup**

Address: \`${address}\`

To find agents owned by this address, visit:
https://www.8004.org/address/${address}

Or use the Agent0 SDK for programmatic access.`;
}

async function handleReputation(agentId: string): Promise<string> {
  if (!agentId) {
    return 'Usage: /agent-id reputation <agent-id>';
  }

  // Note: Full implementation would query Reputation Registry
  return `**Agent Reputation**

Agent ID: #${agentId}

*Reputation queries require the full Agent0 SDK.*

View reputation at: https://www.8004.org/agent/${agentId}#reputation`;
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';

  // Parse flags
  const testnet = args.includes('--testnet') || args.includes('--sepolia');
  const nameMatch = args.match(/--name\s+"([^"]+)"/);
  const descMatch = args.match(/--description\s+"([^"]+)"/);
  const imageMatch = args.match(/--image\s+(\S+)/);

  switch (command) {
    case 'register':
      return handleRegister({
        name: nameMatch?.[1],
        description: descMatch?.[1],
        image: imageMatch?.[1],
        testnet,
      });
    case 'info':
      return handleInfo(parts[1], testnet);
    case 'lookup':
      return handleLookup(parts[1], testnet);
    case 'reputation':
      return handleReputation(parts[1]);
    case 'help':
    default:
      return getHelp();
  }
}

function getHelp(): string {
  return `**ERC-8004 - Agent Identity**

/agent-id register                  Register agent
/agent-id register --name "Bot"     With custom name
/agent-id info <id>                 Get agent info
/agent-id lookup <address>          Find by address
/agent-id reputation <id>           Check reputation

**Options:**
--name "Name"           Agent name
--description "Desc"    Description
--image <url>           Avatar URL
--testnet               Use Sepolia

**Contracts:**
- Mainnet: 0x8004A169...
- Sepolia: 0x8004A818...

Website: https://www.8004.org
Spec: EIP-8004`;
}

export const tools = [
  {
    name: 'erc8004_register',
    description: 'Register an AI agent identity on Ethereum via ERC-8004',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Agent display name' },
        description: { type: 'string', description: 'Agent description' },
        testnet: { type: 'boolean', description: 'Use Sepolia testnet' },
      },
    },
    execute: async (params: { name?: string; description?: string; testnet?: boolean }) =>
      handleRegister(params),
  },
  {
    name: 'erc8004_info',
    description: 'Get information about a registered agent',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID number' },
        testnet: { type: 'boolean', description: 'Check on testnet' },
      },
      required: ['agentId'],
    },
    execute: async ({ agentId, testnet }: { agentId: string; testnet?: boolean }) =>
      handleInfo(agentId, testnet),
  },
];

export default {
  name: 'erc8004',
  description: 'Register AI agents on Ethereum with verifiable on-chain identity via ERC-8004',
  commands: ['/erc8004'],
  requires: { env: ['PRIVATE_KEY'] },
  handle: execute,
  tools,
};
