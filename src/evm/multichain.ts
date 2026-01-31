/**
 * Multi-Chain EVM Support
 *
 * Balance checks and interactions across multiple EVM chains.
 * Supports: Ethereum, Base, Polygon, Arbitrum, BSC, Optimism, Avalanche
 */

import { JsonRpcProvider, Contract, formatUnits, formatEther } from 'ethers';
import { logger } from '../utils/logger';

// =============================================================================
// CHAIN CONFIGURATION
// =============================================================================

export interface ChainConfig {
  name: string;
  chainId: number;
  rpc: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  explorer: string;
  multicall?: string;
}

export const CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    name: 'Ethereum',
    chainId: 1,
    rpc: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorer: 'https://etherscan.io',
    multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  base: {
    name: 'Base',
    chainId: 8453,
    rpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorer: 'https://basescan.org',
    multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  polygon: {
    name: 'Polygon',
    chainId: 137,
    rpc: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    explorer: 'https://polygonscan.com',
    multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  arbitrum: {
    name: 'Arbitrum',
    chainId: 42161,
    rpc: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorer: 'https://arbiscan.io',
    multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  bsc: {
    name: 'BNB Chain',
    chainId: 56,
    rpc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    explorer: 'https://bscscan.com',
    multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  optimism: {
    name: 'Optimism',
    chainId: 10,
    rpc: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorer: 'https://optimistic.etherscan.io',
    multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  avalanche: {
    name: 'Avalanche',
    chainId: 43114,
    rpc: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    explorer: 'https://snowtrace.io',
    multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
};

export type ChainName = keyof typeof CHAINS;

// =============================================================================
// PROVIDER CACHE
// =============================================================================

const providerCache = new Map<string, JsonRpcProvider>();

export function getProvider(chain: ChainName): JsonRpcProvider {
  const config = CHAINS[chain];
  if (!config) {
    throw new Error(`Unknown chain: ${chain}`);
  }

  let provider = providerCache.get(chain);
  if (!provider) {
    provider = new JsonRpcProvider(config.rpc, config.chainId);
    providerCache.set(chain, provider);
  }

  return provider;
}

export function getChainConfig(chain: ChainName): ChainConfig {
  const config = CHAINS[chain];
  if (!config) {
    throw new Error(`Unknown chain: ${chain}`);
  }
  return config;
}

// =============================================================================
// ABI
// =============================================================================

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

const MULTICALL_ABI = [
  'function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)',
  'function getEthBalance(address addr) view returns (uint256 balance)',
];

// =============================================================================
// BALANCE TYPES
// =============================================================================

export interface TokenBalance {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceRaw: bigint;
}

export interface ChainBalance {
  chain: ChainName;
  chainName: string;
  native: {
    symbol: string;
    balance: string;
    balanceRaw: bigint;
  };
  tokens: TokenBalance[];
}

export interface MultiChainBalance {
  address: string;
  balances: ChainBalance[];
  totalValueUsd?: number;
}

// =============================================================================
// BALANCE FUNCTIONS
// =============================================================================

/**
 * Get native token balance on a chain
 */
export async function getNativeBalance(chain: ChainName, address: string): Promise<{
  symbol: string;
  balance: string;
  balanceRaw: bigint;
}> {
  const provider = getProvider(chain);
  const config = getChainConfig(chain);

  const balance = await provider.getBalance(address);

  return {
    symbol: config.nativeCurrency.symbol,
    balance: formatEther(balance),
    balanceRaw: balance,
  };
}

/**
 * Get ERC20 token balance
 */
export async function getTokenBalance(
  chain: ChainName,
  tokenAddress: string,
  walletAddress: string
): Promise<TokenBalance> {
  const provider = getProvider(chain);
  const token = new Contract(tokenAddress, ERC20_ABI, provider);

  const [balance, decimals, symbol, name] = await Promise.all([
    token.balanceOf(walletAddress),
    token.decimals().catch(() => 18),
    token.symbol().catch(() => 'UNKNOWN'),
    token.name().catch(() => 'Unknown Token'),
  ]);

  return {
    address: tokenAddress,
    symbol,
    name,
    decimals: Number(decimals),
    balance: formatUnits(balance, Number(decimals)),
    balanceRaw: balance,
  };
}

/**
 * Get multiple token balances using multicall (more efficient)
 */
export async function getTokenBalances(
  chain: ChainName,
  tokenAddresses: string[],
  walletAddress: string
): Promise<TokenBalance[]> {
  if (tokenAddresses.length === 0) return [];

  const provider = getProvider(chain);

  // Fetch in parallel (could optimize with multicall contract)
  const results = await Promise.all(
    tokenAddresses.map(async (addr) => {
      try {
        return await getTokenBalance(chain, addr, walletAddress);
      } catch (error) {
        logger.debug({ chain, token: addr, error }, 'Failed to fetch token balance');
        return null;
      }
    })
  );

  return results.filter((r): r is TokenBalance => r !== null && parseFloat(r.balance) > 0);
}

/**
 * Get all balances on a single chain
 */
export async function getChainBalances(
  chain: ChainName,
  address: string,
  tokenAddresses: string[] = []
): Promise<ChainBalance> {
  const config = getChainConfig(chain);

  const [native, tokens] = await Promise.all([
    getNativeBalance(chain, address),
    getTokenBalances(chain, tokenAddresses, address),
  ]);

  return {
    chain,
    chainName: config.name,
    native,
    tokens,
  };
}

/**
 * Get balances across all chains
 */
export async function getMultiChainBalances(
  address: string,
  chains: ChainName[] = ['ethereum', 'base', 'polygon', 'arbitrum', 'bsc'],
  tokenAddresses: Partial<Record<ChainName, string[]>> = {}
): Promise<MultiChainBalance> {
  const balances = await Promise.all(
    chains.map(async (chain) => {
      try {
        return await getChainBalances(chain, address, tokenAddresses[chain] || []);
      } catch (error) {
        logger.warn({ chain, error }, 'Failed to fetch chain balances');
        return null;
      }
    })
  );

  return {
    address,
    balances: balances.filter((b): b is ChainBalance => b !== null),
  };
}

// =============================================================================
// COMMON TOKENS
// =============================================================================

export const CHAIN_TOKENS: Record<ChainName, Record<string, string>> = {
  ethereum: {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    DAI: '0x6B175474E89094C44Da98b954EescdeCB5f8F',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  base: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    USDbC: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
    WETH: '0x4200000000000000000000000000000000000006',
    VIRTUAL: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
  },
  polygon: {
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  },
  arbitrum: {
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    'USDC.e': '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
  },
  bsc: {
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  },
  optimism: {
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    'USDC.e': '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
    USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    WETH: '0x4200000000000000000000000000000000000006',
    OP: '0x4200000000000000000000000000000000000042',
  },
  avalanche: {
    USDC: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    'USDC.e': '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664',
    USDT: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    WAVAX: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  },
};

/**
 * Get common token balances on a chain
 */
export async function getCommonTokenBalances(
  chain: ChainName,
  address: string
): Promise<TokenBalance[]> {
  const tokens = CHAIN_TOKENS[chain];
  if (!tokens) return [];

  return getTokenBalances(chain, Object.values(tokens), address);
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Resolve chain name from string (case-insensitive, aliases)
 */
export function resolveChain(input: string): ChainName | null {
  const normalized = input.toLowerCase().trim();

  // Direct match
  if (normalized in CHAINS) {
    return normalized as ChainName;
  }

  // Aliases
  const aliases: Record<string, ChainName> = {
    eth: 'ethereum',
    mainnet: 'ethereum',
    matic: 'polygon',
    poly: 'polygon',
    arb: 'arbitrum',
    bnb: 'bsc',
    binance: 'bsc',
    op: 'optimism',
    avax: 'avalanche',
  };

  return aliases[normalized] || null;
}

/**
 * Get explorer URL for address
 */
export function getExplorerUrl(chain: ChainName, address: string, type: 'address' | 'tx' = 'address'): string {
  const config = getChainConfig(chain);
  return `${config.explorer}/${type}/${address}`;
}

/**
 * Get explorer URL for token
 */
export function getTokenExplorerUrl(chain: ChainName, tokenAddress: string): string {
  const config = getChainConfig(chain);
  return `${config.explorer}/token/${tokenAddress}`;
}
