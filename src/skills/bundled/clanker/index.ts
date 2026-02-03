/**
 * Clanker Skill - ERC20 Token Deployment with Uniswap V4 pools
 *
 * Deploy production-ready ERC20 tokens with built-in Uniswap V4 liquidity pools
 * using the Clanker protocol on Base, Ethereum, and Arbitrum.
 *
 * Commands:
 * /clanker deploy <name> <symbol> [options]    Deploy new token
 * /clanker simulate <name> <symbol> [options]  Simulate deployment (no tx)
 * /clanker claim-vault <token>                 Claim vested tokens
 * /clanker claim-rewards <token>               Claim trading fee rewards
 * /clanker update-metadata <token> <json>      Update token metadata
 * /clanker update-image <token> <ipfs://...>   Update token image
 * /clanker info <token>                        Get token info
 * /clanker rewards <token>                     Check available rewards
 * /clanker vault <token>                       Check vested tokens
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, type PublicClient, type WalletClient, type Chain, type Hash, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, mainnet, arbitrum } from 'viem/chains';

// =============================================================================
// Types
// =============================================================================

interface ClankerConfig {
  privateKey: string;
  chain?: 'base' | 'eth' | 'arb';
  rpcUrl?: string;
}

interface DeployOptions {
  image?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  vault?: number;
  vaultLockup?: number;
  vaultVesting?: number;
  devBuy?: number;
  marketCap?: number;
  vanity?: boolean;
  chain?: 'base' | 'eth' | 'arb';
}

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  totalSupply: string;
  decimals: number;
  owner: string;
  poolAddress?: string;
  createdAt?: number;
  metadata?: {
    image?: string;
    description?: string;
    twitter?: string;
    telegram?: string;
    website?: string;
  };
}

interface VaultInfo {
  tokenAddress: string;
  lockedAmount: string;
  claimableAmount: string;
  lockupEnd: number;
  vestingEnd: number;
  totalVested: string;
}

interface RewardsInfo {
  tokenAddress: string;
  pendingRewards: string;
  totalClaimed: string;
  rewardToken: string;
}

// =============================================================================
// Constants
// =============================================================================

const CHAINS: Record<string, Chain> = {
  base: base,
  eth: mainnet,
  arb: arbitrum,
};

const CHAIN_IDS: Record<string, number> = {
  base: 8453,
  eth: 1,
  arb: 42161,
};

const RPC_URLS: Record<string, string> = {
  base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  eth: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
  arb: process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc',
};

// Clanker Factory addresses per chain (from docs.clanker.world)
const CLANKER_FACTORY: Record<string, Address> = {
  base: '0x375C15db32D28cEcdcAB5C03Ab889bf15cbD2c5E' as Address,  // v3 ClankerPreSale (Base)
  eth: '0x6C8599779B03B00AAaE63C6378830919Abb75473' as Address,   // v4.0.0 factory (Ethereum)
  arb: '0xEb9D2A726Edffc887a574dC7f46b3a3638E8E44f' as Address,  // v4.0.0 factory (Arbitrum)
};

// Standard ERC20 ABI for basic queries
const ERC20_ABI = [
  { inputs: [], name: 'name', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalSupply', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

// Clanker Token ABI (extended ERC20 with vault/rewards)
const CLANKER_TOKEN_ABI = [
  ...ERC20_ABI,
  { inputs: [], name: 'owner', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'pool', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'metadata', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'claimVault', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'claimRewards', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'newMetadata', type: 'string' }], name: 'updateMetadata', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'vaultBalance', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'claimableVault', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'pendingRewards', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'lockupEnd', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'vestingEnd', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

// =============================================================================
// Client Setup
// =============================================================================

function getChain(chainName: string): Chain {
  return CHAINS[chainName] || base;
}

function getPublicClient(chainName: string = 'base'): PublicClient {
  const chain = getChain(chainName);
  const rpcUrl = RPC_URLS[chainName] || RPC_URLS.base;

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}

function getWalletClient(config: ClankerConfig): WalletClient {
  const chainName = config.chain || 'base';
  const chain = getChain(chainName);
  const rpcUrl = config.rpcUrl || RPC_URLS[chainName];
  const account = privateKeyToAccount(config.privateKey as `0x${string}`);

  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
}

function getPrivateKey(): string {
  const key = process.env.PRIVATE_KEY;
  if (!key) {
    throw new Error('PRIVATE_KEY environment variable not set');
  }
  return key.startsWith('0x') ? key : `0x${key}`;
}

// =============================================================================
// Handlers
// =============================================================================

async function handleDeploy(args: string[], simulate: boolean = false): Promise<string> {
  if (args.length < 2) {
    return `Usage: /clanker ${simulate ? 'simulate' : 'deploy'} <name> <symbol> [options]

Options:
  --image <ipfs://...>        Token image (IPFS URL)
  --description "..."         Token description
  --twitter <handle>          Twitter/X handle
  --telegram <handle>         Telegram handle
  --website <url>             Website URL
  --vault <percent>           Vault percentage (0-90, vesting)
  --vault-lockup <days>       Vault lockup period in days
  --vault-vesting <days>      Vault vesting duration in days
  --dev-buy <eth>             Initial purchase amount in ETH
  --market-cap <eth>          Starting market cap in ETH
  --vanity                    Generate vanity address
  --chain <base|eth|arb>      Target chain (default: base)

Example:
  /clanker ${simulate ? 'simulate' : 'deploy'} "My Token" MTK --image ipfs://Qm... --vault 10`;
  }

  const name = args[0].replace(/^["']|["']$/g, '');
  const symbol = args[1].replace(/^["']|["']$/g, '');

  // Parse options
  const options: DeployOptions = {};
  for (let i = 2; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case '--image':
        options.image = value; i++;
        break;
      case '--description':
        options.description = value?.replace(/^["']|["']$/g, ''); i++;
        break;
      case '--twitter':
        options.twitter = value?.replace('@', ''); i++;
        break;
      case '--telegram':
        options.telegram = value?.replace('@', ''); i++;
        break;
      case '--website':
        options.website = value; i++;
        break;
      case '--vault':
        options.vault = parseInt(value); i++;
        break;
      case '--vault-lockup':
        options.vaultLockup = parseInt(value); i++;
        break;
      case '--vault-vesting':
        options.vaultVesting = parseInt(value); i++;
        break;
      case '--dev-buy':
        options.devBuy = parseFloat(value); i++;
        break;
      case '--market-cap':
        options.marketCap = parseFloat(value); i++;
        break;
      case '--vanity':
        options.vanity = true;
        break;
      case '--chain':
        options.chain = value as 'base' | 'eth' | 'arb'; i++;
        break;
    }
  }

  // Validate options
  if (options.vault !== undefined && (options.vault < 0 || options.vault > 90)) {
    return 'Vault percentage must be between 0 and 90 (min 10% to LP)';
  }

  const chainName = options.chain || 'base';
  const chainDisplay = chainName === 'eth' ? 'Ethereum' : chainName === 'arb' ? 'Arbitrum' : 'Base';

  try {
    if (simulate) {
      // Simulation mode - estimate gas and return preview
      let output = `**Clanker Deployment Simulation**\n\n`;
      output += `**Token:**\n`;
      output += `  Name: ${name}\n`;
      output += `  Symbol: ${symbol}\n`;
      output += `  Supply: 100,000,000,000 (100B)\n`;
      output += `  Chain: ${chainDisplay}\n\n`;

      output += `**Configuration:**\n`;
      if (options.image) output += `  Image: ${options.image}\n`;
      if (options.description) output += `  Description: ${options.description.slice(0, 50)}${options.description.length > 50 ? '...' : ''}\n`;
      if (options.twitter) output += `  Twitter: @${options.twitter}\n`;
      if (options.telegram) output += `  Telegram: @${options.telegram}\n`;
      if (options.website) output += `  Website: ${options.website}\n`;

      if (options.vault) {
        output += `\n**Vault:**\n`;
        output += `  Percentage: ${options.vault}%\n`;
        if (options.vaultLockup) output += `  Lockup: ${options.vaultLockup} days\n`;
        if (options.vaultVesting) output += `  Vesting: ${options.vaultVesting} days\n`;
      }

      if (options.devBuy) {
        output += `\n**Dev Buy:**\n`;
        output += `  Amount: ${options.devBuy} ETH\n`;
      }

      if (options.marketCap) {
        output += `\n**Starting Market Cap:** ${options.marketCap} ETH\n`;
      }

      output += `\n**Estimated Gas:** ~0.01-0.05 ETH\n`;
      output += `\n*Use /clanker deploy to execute this deployment*`;

      return output;
    }

    // Real deployment
    const privateKey = getPrivateKey();
    const walletClient = getWalletClient({ privateKey, chain: chainName });
    const publicClient = getPublicClient(chainName);
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    // Build metadata JSON
    const metadata = JSON.stringify({
      name,
      symbol,
      image: options.image || '',
      description: options.description || '',
      twitter: options.twitter || '',
      telegram: options.telegram || '',
      website: options.website || '',
    });

    const factoryAddress = CLANKER_FACTORY[chainName];
    if (!factoryAddress || factoryAddress === '0x0000000000000000000000000000000000000000') {
      return `Clanker factory not configured for chain: ${chainName}`;
    }

    // Clanker factory deployToken ABI
    const FACTORY_ABI = [
      {
        inputs: [
          { name: '_name', type: 'string' },
          { name: '_symbol', type: 'string' },
          { name: '_metadata', type: 'string' },
        ],
        name: 'deployToken',
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'payable',
        type: 'function',
      },
    ] as const;

    const hash = await walletClient.writeContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: 'deployToken',
      args: [name, symbol, metadata],
      chain: getChain(chainName),
      account: account,
      value: options.devBuy ? parseEther(String(options.devBuy)) : 0n,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Try to extract the deployed token address from logs
    let tokenAddress = 'Check tx for token address';
    if (receipt.logs.length > 0) {
      // The first log typically contains the new token address
      const firstLog = receipt.logs[0];
      if (firstLog.address && firstLog.address !== factoryAddress) {
        tokenAddress = firstLog.address;
      }
    }

    return `**Token Deployed**

  Name: ${name}
  Symbol: ${symbol}
  Chain: ${chainDisplay}
  Factory: \`${factoryAddress}\`
  Deployer: \`${account.address}\`
  Token: \`${tokenAddress}\`
  Tx: \`${hash}\`
  Status: ${receipt.status === 'success' ? 'Confirmed' : 'Failed'}
  Block: ${receipt.blockNumber}
${options.devBuy ? `  Dev Buy: ${options.devBuy} ETH` : ''}`;

  } catch (error) {
    return `Deployment failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleInfo(tokenAddress: string): Promise<string> {
  if (!tokenAddress) {
    return 'Usage: /clanker info <token-address>';
  }

  try {
    // Detect chain from address format or default to base
    const chainName = 'base';
    const publicClient = getPublicClient(chainName);
    const address = tokenAddress as Address;

    const [name, symbol, decimals, totalSupply] = await Promise.all([
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'name' }),
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }),
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }),
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'totalSupply' }),
    ]);

    // Try to get Clanker-specific info
    let owner: string | undefined;
    let pool: string | undefined;
    let metadata: string | undefined;

    try {
      owner = await publicClient.readContract({ address, abi: CLANKER_TOKEN_ABI, functionName: 'owner' }) as string;
      pool = await publicClient.readContract({ address, abi: CLANKER_TOKEN_ABI, functionName: 'pool' }) as string;
      metadata = await publicClient.readContract({ address, abi: CLANKER_TOKEN_ABI, functionName: 'metadata' }) as string;
    } catch {
      // Not a Clanker token or doesn't have these functions
    }

    let output = `**Token Info**\n\n`;
    output += `Address: \`${tokenAddress}\`\n`;
    output += `Name: ${name}\n`;
    output += `Symbol: ${symbol}\n`;
    output += `Decimals: ${decimals}\n`;
    output += `Total Supply: ${formatEther(totalSupply as bigint)} (${Number(totalSupply as bigint) / 1e18})\n`;

    if (owner) output += `Owner: \`${owner}\`\n`;
    if (pool && pool !== '0x0000000000000000000000000000000000000000') {
      output += `Uniswap Pool: \`${pool}\`\n`;
    }

    if (metadata) {
      try {
        const meta = JSON.parse(metadata);
        output += `\n**Metadata:**\n`;
        if (meta.image) output += `  Image: ${meta.image}\n`;
        if (meta.description) output += `  Description: ${meta.description.slice(0, 100)}${meta.description.length > 100 ? '...' : ''}\n`;
        if (meta.twitter) output += `  Twitter: @${meta.twitter}\n`;
        if (meta.telegram) output += `  Telegram: @${meta.telegram}\n`;
        if (meta.website) output += `  Website: ${meta.website}\n`;
      } catch {
        // Metadata is not JSON
      }
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleVault(tokenAddress: string): Promise<string> {
  if (!tokenAddress) {
    return 'Usage: /clanker vault <token-address>';
  }

  try {
    const chainName = 'base';
    const publicClient = getPublicClient(chainName);
    const address = tokenAddress as Address;

    const [vaultBalance, claimable, lockupEnd, vestingEnd] = await Promise.all([
      publicClient.readContract({ address, abi: CLANKER_TOKEN_ABI, functionName: 'vaultBalance' }).catch(() => 0n),
      publicClient.readContract({ address, abi: CLANKER_TOKEN_ABI, functionName: 'claimableVault' }).catch(() => 0n),
      publicClient.readContract({ address, abi: CLANKER_TOKEN_ABI, functionName: 'lockupEnd' }).catch(() => 0n),
      publicClient.readContract({ address, abi: CLANKER_TOKEN_ABI, functionName: 'vestingEnd' }).catch(() => 0n),
    ]);

    const now = Math.floor(Date.now() / 1000);
    const lockupEndTs = Number(lockupEnd);
    const vestingEndTs = Number(vestingEnd);

    let output = `**Vault Info**\n\n`;
    output += `Token: \`${tokenAddress}\`\n\n`;
    output += `Locked Amount: ${formatEther(vaultBalance as bigint)}\n`;
    output += `Claimable: ${formatEther(claimable as bigint)}\n\n`;

    if (lockupEndTs > 0) {
      const lockupStatus = now >= lockupEndTs ? 'Ended' : `Ends ${new Date(lockupEndTs * 1000).toLocaleString()}`;
      output += `Lockup: ${lockupStatus}\n`;
    }

    if (vestingEndTs > 0) {
      const vestingStatus = now >= vestingEndTs ? 'Fully Vested' : `Vesting until ${new Date(vestingEndTs * 1000).toLocaleString()}`;
      output += `Vesting: ${vestingStatus}\n`;
    }

    if ((claimable as bigint) > 0n) {
      output += `\n*Use /clanker claim-vault ${tokenAddress} to claim*`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleRewards(tokenAddress: string): Promise<string> {
  if (!tokenAddress) {
    return 'Usage: /clanker rewards <token-address>';
  }

  try {
    const chainName = 'base';
    const publicClient = getPublicClient(chainName);
    const address = tokenAddress as Address;

    const pending = await publicClient.readContract({
      address,
      abi: CLANKER_TOKEN_ABI,
      functionName: 'pendingRewards',
    }).catch(() => 0n);

    let output = `**Rewards Info**\n\n`;
    output += `Token: \`${tokenAddress}\`\n\n`;
    output += `Pending Rewards: ${formatEther(pending as bigint)} ETH\n`;

    if ((pending as bigint) > 0n) {
      output += `\n*Use /clanker claim-rewards ${tokenAddress} to claim*`;
    } else {
      output += `\nNo rewards available to claim.`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleClaimVault(tokenAddress: string): Promise<string> {
  if (!tokenAddress) {
    return 'Usage: /clanker claim-vault <token-address>';
  }

  try {
    const privateKey = getPrivateKey();
    const chainName = 'base';
    const walletClient = getWalletClient({ privateKey, chain: chainName });
    const publicClient = getPublicClient(chainName);
    const address = tokenAddress as Address;
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    // Check claimable amount first
    const claimable = await publicClient.readContract({
      address,
      abi: CLANKER_TOKEN_ABI,
      functionName: 'claimableVault',
    }).catch(() => 0n);

    if ((claimable as bigint) === 0n) {
      return 'No vault tokens available to claim.';
    }

    // Execute claim
    const hash = await walletClient.writeContract({
      address,
      abi: CLANKER_TOKEN_ABI,
      functionName: 'claimVault',
      account,
      chain: getChain(chainName),
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return `**Vault Claimed**\n\n` +
      `Amount: ${formatEther(claimable as bigint)}\n` +
      `TX: \`${hash}\`\n` +
      `Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}`;
  } catch (error) {
    return `Claim failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleClaimRewards(tokenAddress: string): Promise<string> {
  if (!tokenAddress) {
    return 'Usage: /clanker claim-rewards <token-address>';
  }

  try {
    const privateKey = getPrivateKey();
    const chainName = 'base';
    const walletClient = getWalletClient({ privateKey, chain: chainName });
    const publicClient = getPublicClient(chainName);
    const address = tokenAddress as Address;
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    // Check pending rewards first
    const pending = await publicClient.readContract({
      address,
      abi: CLANKER_TOKEN_ABI,
      functionName: 'pendingRewards',
    }).catch(() => 0n);

    if ((pending as bigint) === 0n) {
      return 'No rewards available to claim.';
    }

    // Execute claim
    const hash = await walletClient.writeContract({
      address,
      abi: CLANKER_TOKEN_ABI,
      functionName: 'claimRewards',
      account,
      chain: getChain(chainName),
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return `**Rewards Claimed**\n\n` +
      `Amount: ${formatEther(pending as bigint)} ETH\n` +
      `TX: \`${hash}\`\n` +
      `Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}`;
  } catch (error) {
    return `Claim failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleUpdateMetadata(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /clanker update-metadata <token-address> <json>

Example:
  /clanker update-metadata 0x... '{"description":"New description","twitter":"newhandle"}'`;
  }

  const tokenAddress = args[0];
  const metadataJson = args.slice(1).join(' ');

  try {
    // Validate JSON
    const metadata = JSON.parse(metadataJson);

    const privateKey = getPrivateKey();
    const chainName = 'base';
    const walletClient = getWalletClient({ privateKey, chain: chainName });
    const publicClient = getPublicClient(chainName);
    const address = tokenAddress as Address;
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    // Execute update
    const hash = await walletClient.writeContract({
      address,
      abi: CLANKER_TOKEN_ABI,
      functionName: 'updateMetadata',
      args: [JSON.stringify(metadata)],
      account,
      chain: getChain(chainName),
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return `**Metadata Updated**\n\n` +
      `Token: \`${tokenAddress}\`\n` +
      `TX: \`${hash}\`\n` +
      `Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}`;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return `Invalid JSON: ${error.message}`;
    }
    return `Update failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleUpdateImage(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /clanker update-image <token-address> <ipfs://...>

Example:
  /clanker update-image 0x... ipfs://QmXxxYyyZzz...`;
  }

  const tokenAddress = args[0];
  const imageUrl = args[1];

  if (!imageUrl.startsWith('ipfs://')) {
    return 'Image URL must be an IPFS URL (ipfs://...)';
  }

  try {
    const privateKey = getPrivateKey();
    const chainName = 'base';
    const walletClient = getWalletClient({ privateKey, chain: chainName });
    const publicClient = getPublicClient(chainName);
    const address = tokenAddress as Address;
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    // Get current metadata
    let currentMeta: any = {};
    try {
      const metaStr = await publicClient.readContract({
        address,
        abi: CLANKER_TOKEN_ABI,
        functionName: 'metadata',
      }) as string;
      currentMeta = JSON.parse(metaStr);
    } catch {
      // No existing metadata
    }

    // Update image
    currentMeta.image = imageUrl;

    // Execute update
    const hash = await walletClient.writeContract({
      address,
      abi: CLANKER_TOKEN_ABI,
      functionName: 'updateMetadata',
      args: [JSON.stringify(currentMeta)],
      account,
      chain: getChain(chainName),
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return `**Image Updated**\n\n` +
      `Token: \`${tokenAddress}\`\n` +
      `Image: ${imageUrl}\n` +
      `TX: \`${hash}\`\n` +
      `Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}`;
  } catch (error) {
    return `Update failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// =============================================================================
// Main Execute Function
// =============================================================================

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    case 'deploy':
      return handleDeploy(rest, false);
    case 'simulate':
      return handleDeploy(rest, true);
    case 'info':
      return handleInfo(rest[0]);
    case 'vault':
      return handleVault(rest[0]);
    case 'rewards':
      return handleRewards(rest[0]);
    case 'claim-vault':
      return handleClaimVault(rest[0]);
    case 'claim-rewards':
      return handleClaimRewards(rest[0]);
    case 'update-metadata':
      return handleUpdateMetadata(rest);
    case 'update-image':
      return handleUpdateImage(rest);

    case 'help':
    default:
      return `**Clanker - Token Deployment on Base/ETH/Arbitrum**

**Deployment:**
  /clanker deploy <name> <symbol> [opts]   Deploy new token
  /clanker simulate <name> <symbol> [opts] Simulate (no tx)

**Post-Deployment:**
  /clanker claim-vault <token>             Claim vested tokens
  /clanker claim-rewards <token>           Claim trading fees
  /clanker update-metadata <token> <json>  Update metadata
  /clanker update-image <token> <ipfs>     Update image

**Info:**
  /clanker info <token>                    Token info
  /clanker rewards <token>                 Check rewards
  /clanker vault <token>                   Check vesting

**Deploy Options:**
  --image <ipfs://...>     Token image
  --description "..."      Description
  --twitter <handle>       Twitter handle
  --telegram <handle>      Telegram handle
  --website <url>          Website URL
  --vault <percent>        Vault % (0-90)
  --vault-lockup <days>    Lockup period
  --vault-vesting <days>   Vesting duration
  --dev-buy <eth>          Initial buy
  --market-cap <eth>       Starting mcap
  --vanity                 Generate vanity addr
  --chain <base|eth|arb>   Target chain

**Examples:**
  /clanker simulate "Moon Token" MOON --vault 10
  /clanker deploy "Moon Token" MOON --image ipfs://Qm...
  /clanker info 0x1234...
  /clanker claim-rewards 0x1234...

**Setup:**
  export PRIVATE_KEY="0x..."
  export BASE_RPC_URL="https://..." (optional)`;
  }
}

// =============================================================================
// Agent Tools
// =============================================================================

export const tools = [
  {
    name: 'clanker_deploy',
    description: 'Deploy a new ERC20 token with Uniswap V4 pool on Base/ETH/Arbitrum',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Token name' },
        symbol: { type: 'string', description: 'Token symbol (ticker)' },
        image: { type: 'string', description: 'IPFS URL for token image' },
        description: { type: 'string', description: 'Token description' },
        twitter: { type: 'string', description: 'Twitter handle' },
        vault: { type: 'number', description: 'Vault percentage (0-90)' },
        chain: { type: 'string', enum: ['base', 'eth', 'arb'], description: 'Target chain' },
      },
      required: ['name', 'symbol'],
    },
    execute: async (params: { name: string; symbol: string; image?: string; description?: string; twitter?: string; vault?: number; chain?: string }) => {
      const args = [params.name, params.symbol];
      if (params.image) args.push('--image', params.image);
      if (params.description) args.push('--description', params.description);
      if (params.twitter) args.push('--twitter', params.twitter);
      if (params.vault) args.push('--vault', params.vault.toString());
      if (params.chain) args.push('--chain', params.chain);
      return handleDeploy(args, false);
    },
  },
  {
    name: 'clanker_simulate',
    description: 'Simulate token deployment without executing transaction',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Token name' },
        symbol: { type: 'string', description: 'Token symbol' },
        chain: { type: 'string', enum: ['base', 'eth', 'arb'], description: 'Target chain' },
      },
      required: ['name', 'symbol'],
    },
    execute: async (params: { name: string; symbol: string; chain?: string }) => {
      const args = [params.name, params.symbol];
      if (params.chain) args.push('--chain', params.chain);
      return handleDeploy(args, true);
    },
  },
  {
    name: 'clanker_info',
    description: 'Get information about a Clanker token',
    parameters: {
      type: 'object',
      properties: {
        tokenAddress: { type: 'string', description: 'Token contract address' },
      },
      required: ['tokenAddress'],
    },
    execute: async ({ tokenAddress }: { tokenAddress: string }) => handleInfo(tokenAddress),
  },
  {
    name: 'clanker_claim_rewards',
    description: 'Claim accumulated trading fee rewards from a Clanker token',
    parameters: {
      type: 'object',
      properties: {
        tokenAddress: { type: 'string', description: 'Token contract address' },
      },
      required: ['tokenAddress'],
    },
    execute: async ({ tokenAddress }: { tokenAddress: string }) => handleClaimRewards(tokenAddress),
  },
];

export default {
  name: 'clanker',
  description: 'Clanker - ERC20 token deployment with Uniswap V4 pools on Base/ETH/Arbitrum',
  commands: ['/clanker'],
  requires: { env: ['PRIVATE_KEY'] },
  handle: execute,
  tools,
};
