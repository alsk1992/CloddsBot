/**
 * ENS Skill - Primary Name on L2s
 *
 * Set primary ENS name on Base and other L2 chains via Reverse Registrar.
 *
 * Commands:
 * /ens set <name.eth>           Set primary name
 * /ens verify <address>         Verify primary name
 * /ens resolve <name.eth>       Resolve name to address
 */

import { createPublicClient, createWalletClient, http, namehash, type Address, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, mainnet, arbitrum, optimism } from 'viem/chains';
import { normalize } from 'viem/ens';

// Reverse Registrar addresses
const REVERSE_REGISTRAR: Record<string, Address> = {
  base: '0x0000000000D8e504002cC26E3Ec46D81971C1664',
  arbitrum: '0x0000000000D8e504002cC26E3Ec46D81971C1664',
  optimism: '0x0000000000D8e504002cC26E3Ec46D81971C1664',
  ethereum: '0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb',
};

const CHAINS = {
  base,
  arbitrum,
  optimism,
  ethereum: mainnet,
  eth: mainnet,
  arb: arbitrum,
  op: optimism,
};

const RPC_URLS: Record<string, string> = {
  base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  arbitrum: process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc',
  optimism: process.env.OP_RPC_URL || 'https://mainnet.optimism.io',
  ethereum: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
};

const REVERSE_ABI = [
  {
    inputs: [{ name: 'name', type: 'string' }],
    name: 'setName',
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

function getChainKey(chain: string): string {
  const aliases: Record<string, string> = {
    eth: 'ethereum',
    arb: 'arbitrum',
    op: 'optimism',
  };
  return aliases[chain.toLowerCase()] || chain.toLowerCase();
}

function getPublicClient(chainKey: string) {
  const chain = CHAINS[chainKey as keyof typeof CHAINS] || base;
  const rpcUrl = RPC_URLS[chainKey] || RPC_URLS.base;
  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}

function getWalletClient(chainKey: string) {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error('PRIVATE_KEY not set');

  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey as `0x${string}` : `0x${privateKey}`);
  const chain = CHAINS[chainKey as keyof typeof CHAINS] || base;
  const rpcUrl = RPC_URLS[chainKey] || RPC_URLS.base;

  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
}

async function handleSet(name: string, chainArg: string = 'base'): Promise<string> {
  if (!name) {
    return `Usage: /ens set <name.eth> [--chain base|eth|arb|op]

Example:
  /ens set myname.eth
  /ens set myname.eth --chain arbitrum`;
  }

  const chainKey = getChainKey(chainArg);
  const reverseRegistrar = REVERSE_REGISTRAR[chainKey];

  if (!reverseRegistrar) {
    return `Chain "${chainArg}" not supported. Use: base, ethereum, arbitrum, optimism`;
  }

  try {
    const walletClient = getWalletClient(chainKey);
    const publicClient = getPublicClient(chainKey);

    // Normalize ENS name
    const normalizedName = normalize(name);

    // Set primary name
    const hash = await walletClient.writeContract({
      address: reverseRegistrar,
      abi: REVERSE_ABI,
      functionName: 'setName',
      args: [normalizedName],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const chainDisplay = chainKey.charAt(0).toUpperCase() + chainKey.slice(1);

    return `**Primary Name Set!**

Name: ${normalizedName}
Chain: ${chainDisplay}
Address: \`${walletClient.account.address}\`
TX: \`${hash}\`
Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}

Your address now resolves to ${normalizedName} on ${chainDisplay}!`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('revert')) {
      return `Transaction reverted. Make sure:\n1. You own the ENS name\n2. Forward resolution is set (name → your address)\n3. You have ETH for gas on ${chainArg}`;
    }
    return `Error: ${msg}`;
  }
}

async function handleVerify(address: string, chainArg: string = 'base'): Promise<string> {
  if (!address) {
    return 'Usage: /ens verify <address> [--chain base|eth|arb|op]';
  }

  const chainKey = getChainKey(chainArg);

  try {
    const client = getPublicClient(chainKey);

    // Get ENS name for address (reverse resolution)
    const ensName = await client.getEnsName({
      address: address as Address,
    }).catch(() => null);

    if (!ensName) {
      return `No primary name set for \`${address}\` on ${chainKey}.`;
    }

    // Verify forward resolution
    const resolvedAddress = await client.getEnsAddress({
      name: normalize(ensName),
    }).catch(() => null);

    const chainDisplay = chainKey.charAt(0).toUpperCase() + chainKey.slice(1);

    if (resolvedAddress?.toLowerCase() === address.toLowerCase()) {
      return `**Primary Name Verified!**

Address: \`${address}\`
Name: ${ensName}
Chain: ${chainDisplay}

Reverse: ${address} → ${ensName}
Forward: ${ensName} → ${resolvedAddress}

Bi-directional resolution confirmed!`;
    }

    return `**Partial Configuration**

Address: \`${address}\`
Reverse Name: ${ensName}
Forward Resolution: ${resolvedAddress || 'Not set'}

The forward resolution doesn't match. Update it at app.ens.domains`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleResolve(name: string): Promise<string> {
  if (!name) {
    return 'Usage: /ens resolve <name.eth>';
  }

  try {
    // Use Ethereum mainnet for ENS resolution
    const client = getPublicClient('ethereum');
    const normalizedName = normalize(name);

    const address = await client.getEnsAddress({
      name: normalizedName,
    });

    if (!address) {
      return `No address found for ${normalizedName}`;
    }

    return `**ENS Resolution**

Name: ${normalizedName}
Address: \`${address}\``;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';

  // Parse --chain flag
  const chainIdx = parts.indexOf('--chain');
  const chainArg = chainIdx !== -1 ? parts[chainIdx + 1] : 'base';
  const filteredParts = parts.filter((_, i) => i !== chainIdx && i !== chainIdx + 1);

  switch (command) {
    case 'set':
      return handleSet(filteredParts[1], chainArg);
    case 'verify':
      return handleVerify(filteredParts[1], chainArg);
    case 'resolve':
      return handleResolve(filteredParts[1]);
    case 'help':
    default:
      return getHelp();
  }
}

function getHelp(): string {
  return `**ENS - Primary Name on L2**

/ens set <name.eth>          Set primary name on Base
/ens set <name.eth> --chain arb  Set on Arbitrum
/ens verify <address>        Check if primary name is set
/ens resolve <name.eth>      Resolve name to address

**Supported Chains:**
- base (default)
- ethereum / eth
- arbitrum / arb
- optimism / op

**Prerequisites:**
1. Own an ENS name
2. Forward resolution set (name → address)
3. Native token for gas

**Example:**
/ens set myname.eth
/ens verify 0x1234...`;
}

export const tools = [
  {
    name: 'ens_set_primary',
    description: 'Set primary ENS name on Base or other L2',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'ENS name (e.g., myname.eth)' },
        chain: { type: 'string', enum: ['base', 'ethereum', 'arbitrum', 'optimism'], description: 'Target chain' },
      },
      required: ['name'],
    },
    execute: async ({ name, chain }: { name: string; chain?: string }) => handleSet(name, chain || 'base'),
  },
  {
    name: 'ens_verify',
    description: 'Verify if an address has a primary ENS name set',
    parameters: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Wallet address' },
        chain: { type: 'string', description: 'Chain to check' },
      },
      required: ['address'],
    },
    execute: async ({ address, chain }: { address: string; chain?: string }) => handleVerify(address, chain || 'base'),
  },
  {
    name: 'ens_resolve',
    description: 'Resolve an ENS name to its address',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'ENS name to resolve' } },
      required: ['name'],
    },
    execute: async ({ name }: { name: string }) => handleResolve(name),
  },
];

export default {
  name: 'ens',
  description: 'ENS - Set and verify primary ENS names on Base and other L2 chains',
  commands: ['/ens'],
  requires: { env: ['PRIVATE_KEY'] },
  handle: execute,
  tools,
};
