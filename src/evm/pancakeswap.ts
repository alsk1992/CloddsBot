/**
 * PancakeSwap V3 Integration for Multi-chain DEX Trading
 *
 * Supports swaps on BNB Chain (primary), Ethereum, Arbitrum, Base.
 * Uses QuoterV2 + SmartRouter V3 ABIs via ethers (no extra npm deps).
 *
 * @see https://docs.pancakeswap.finance
 */

import { ethers, Wallet, JsonRpcProvider, Contract, parseUnits, formatUnits, MaxUint256 } from 'ethers';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export type PancakeChain = 'bsc' | 'ethereum' | 'arbitrum' | 'base';

export interface PancakeSwapParams {
  chain: PancakeChain;
  inputToken: string;
  outputToken: string;
  amount: string;
  slippageBps?: number;
  recipient?: string;
  deadline?: number;
}

export interface PancakeQuote {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  outputAmount: string;
  outputAmountMin: string;
  priceImpact: number;
  route: string[];
  gasEstimate?: string;
  feeTier?: number;
}

export interface PancakeSwapResult {
  success: boolean;
  txHash?: string;
  inputAmount: string;
  outputAmount?: string;
  gasUsed?: string;
  error?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CHAIN_CONFIG: Record<PancakeChain, {
  chainId: number;
  rpc: string;
  quoterV2: string;
  swapRouter: string;
  weth: string;
}> = {
  bsc: {
    chainId: 56,
    rpc: 'https://bsc-dataseed1.binance.org',
    quoterV2: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
    swapRouter: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
    weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  },
  ethereum: {
    chainId: 1,
    rpc: 'https://eth.llamarpc.com',
    quoterV2: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
    swapRouter: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  arbitrum: {
    chainId: 42161,
    rpc: 'https://arb1.arbitrum.io/rpc',
    quoterV2: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
    swapRouter: '0x32226588378236Fd0c7c4053999F88aC0e5cAc77',
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  },
  base: {
    chainId: 8453,
    rpc: 'https://mainnet.base.org',
    quoterV2: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
    swapRouter: '0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86',
    weth: '0x4200000000000000000000000000000000000006',
  },
};

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

const SWAP_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)',
  'function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory results)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
];

// Common tokens per chain
const COMMON_TOKENS: Record<string, Partial<Record<PancakeChain, string>>> = {
  CAKE: {
    bsc: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
    ethereum: '0x152649eA73beAb28c5b49B26eb48f7EAD6d4c0bA',
    arbitrum: '0x1b896893dfc86bb67Cf57767b17E4ae3b70a96c2',
    base: '0x3055913c90Fcc1A6CE9a358911721eEb942013A1',
  },
  WBNB: {
    bsc: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  },
  USDC: {
    bsc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  USDT: {
    bsc: '0x55d398326f99059fF775485246999027B3197955',
    ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    arbitrum: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  WETH: {
    ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    base: '0x4200000000000000000000000000000000000006',
  },
};

// Fee tiers to try (PancakeSwap V3 fee tiers)
const FEE_TIERS = [100, 500, 2500, 10000]; // 0.01%, 0.05%, 0.25%, 1%

// =============================================================================
// WALLET MANAGEMENT
// =============================================================================

function getPancakeProvider(chain: PancakeChain): JsonRpcProvider {
  const config = CHAIN_CONFIG[chain];
  const envKey = chain === 'bsc' ? 'BSC_RPC_URL' : `${chain.toUpperCase()}_RPC_URL`;
  const customRpc = process.env[envKey];
  return new JsonRpcProvider(customRpc || config.rpc);
}

function getPancakeWallet(chain: PancakeChain): Wallet {
  const privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('EVM_PRIVATE_KEY environment variable not set');
  }
  const provider = getPancakeProvider(chain);
  return new Wallet(privateKey, provider);
}

// =============================================================================
// TOKEN UTILITIES
// =============================================================================

export function resolvePancakeToken(symbol: string, chain: PancakeChain): string | undefined {
  const upper = symbol.toUpperCase();

  if (COMMON_TOKENS[upper]?.[chain]) {
    return COMMON_TOKENS[upper][chain];
  }

  // Native token aliases
  if (chain === 'bsc' && (upper === 'BNB' || upper === 'NATIVE')) {
    return CHAIN_CONFIG.bsc.weth;
  }
  if (upper === 'ETH' || upper === 'NATIVE') {
    return CHAIN_CONFIG[chain].weth;
  }

  // Already an address
  if (symbol.startsWith('0x') && symbol.length === 42) {
    return symbol;
  }

  return undefined;
}

async function getTokenInfo(address: string, chain: PancakeChain): Promise<{
  address: string;
  symbol: string;
  decimals: number;
}> {
  const provider = getPancakeProvider(chain);
  const token = new Contract(address, ERC20_ABI, provider);

  const [symbol, decimals] = await Promise.all([
    token.symbol().catch(() => 'UNKNOWN'),
    token.decimals().catch(() => 18),
  ]);

  return { address, symbol, decimals: Number(decimals) };
}

// =============================================================================
// QUOTING
// =============================================================================

export async function pancakeQuote(
  params: Omit<PancakeSwapParams, 'recipient' | 'deadline'>
): Promise<PancakeQuote> {
  const { chain, inputToken, outputToken, amount, slippageBps = 50 } = params;
  const config = CHAIN_CONFIG[chain];

  const provider = getPancakeProvider(chain);
  const quoter = new Contract(config.quoterV2, QUOTER_V2_ABI, provider);

  const tokenIn = resolvePancakeToken(inputToken, chain) || inputToken;
  const tokenOut = resolvePancakeToken(outputToken, chain) || outputToken;

  const inputInfo = await getTokenInfo(tokenIn, chain);
  const amountIn = parseUnits(amount, inputInfo.decimals);

  let bestQuote: { amountOut: bigint; fee: number; gasEstimate: bigint } | null = null;

  for (const fee of FEE_TIERS) {
    try {
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      });

      const amountOut = result[0] as bigint;
      const gasEstimate = result[3] as bigint;

      if (!bestQuote || amountOut > bestQuote.amountOut) {
        bestQuote = { amountOut, fee, gasEstimate };
      }
    } catch {
      continue;
    }
  }

  if (!bestQuote) {
    throw new Error(`No PancakeSwap V3 pool found for ${inputToken} -> ${outputToken} on ${chain}`);
  }

  const outputInfo = await getTokenInfo(tokenOut, chain);
  const outputAmount = formatUnits(bestQuote.amountOut, outputInfo.decimals);

  const clampedSlippage = Math.max(0, Math.min(slippageBps, 10000));
  const minOut = (bestQuote.amountOut * BigInt(10000 - clampedSlippage)) / 10000n;
  const outputAmountMin = formatUnits(minOut, outputInfo.decimals);

  logger.debug(
    { chain, inputToken, outputToken, amount, outputAmount, fee: bestQuote.fee },
    'PancakeSwap quote'
  );

  return {
    inputToken: tokenIn,
    outputToken: tokenOut,
    inputAmount: amount,
    outputAmount,
    outputAmountMin,
    priceImpact: 0,
    route: [tokenIn, tokenOut],
    gasEstimate: bestQuote.gasEstimate.toString(),
    feeTier: bestQuote.fee,
  };
}

// =============================================================================
// SWAP EXECUTION
// =============================================================================

export async function pancakeSwap(params: PancakeSwapParams): Promise<PancakeSwapResult> {
  const {
    chain,
    inputToken,
    outputToken,
    amount,
    slippageBps = 50,
    deadline = Math.floor(Date.now() / 1000) + 1800,
  } = params;

  const config = CHAIN_CONFIG[chain];

  try {
    const quote = await pancakeQuote({ chain, inputToken, outputToken, amount, slippageBps });

    const wallet = getPancakeWallet(chain);
    const recipient = params.recipient || wallet.address;

    const inputInfo = await getTokenInfo(quote.inputToken, chain);
    const outputInfo = await getTokenInfo(quote.outputToken, chain);
    const amountIn = parseUnits(amount, inputInfo.decimals);
    const amountOutMin = parseUnits(quote.outputAmountMin, outputInfo.decimals);

    const isNativeIn =
      quote.inputToken.toLowerCase() === config.weth.toLowerCase() &&
      (inputToken.toUpperCase() === 'BNB' || inputToken.toUpperCase() === 'ETH' || inputToken.toUpperCase() === 'NATIVE');

    // Approve token if not native
    if (!isNativeIn) {
      const token = new Contract(quote.inputToken, ERC20_ABI, wallet);
      const allowance = await token.allowance(wallet.address, config.swapRouter);

      if (allowance < amountIn) {
        logger.info({ token: quote.inputToken, router: config.swapRouter }, 'Approving token for PancakeSwap');
        const approveTx = await token.approve(config.swapRouter, MaxUint256);
        await approveTx.wait();
      }
    }

    const router = new Contract(config.swapRouter, SWAP_ROUTER_ABI, wallet);
    const fee = quote.feeTier || 2500;

    const swapParams = {
      tokenIn: quote.inputToken,
      tokenOut: quote.outputToken,
      fee,
      recipient,
      amountIn,
      amountOutMinimum: amountOutMin,
      sqrtPriceLimitX96: 0n,
    };

    logger.info(
      { chain, inputToken, outputToken, amount, amountOutMin: quote.outputAmountMin },
      'Executing PancakeSwap swap'
    );

    const gasEstimate = quote.gasEstimate ? BigInt(quote.gasEstimate) : 0n;
    const gasLimit = gasEstimate > 0n ? (gasEstimate * 130n) / 100n : 500000n;

    const tx = await router.exactInputSingle(swapParams, {
      value: isNativeIn ? amountIn : 0n,
      gasLimit,
    });

    const receipt = await tx.wait();

    logger.info({ txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() }, 'PancakeSwap swap complete');

    return {
      success: true,
      txHash: receipt.hash,
      inputAmount: amount,
      outputAmount: quote.outputAmount,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ chain, inputToken, outputToken, amount, error: message }, 'PancakeSwap swap failed');

    return {
      success: false,
      inputAmount: amount,
      error: message,
    };
  }
}

// =============================================================================
// PRICE UTILITY
// =============================================================================

export async function pancakeGetPrice(
  chain: PancakeChain,
  tokenA: string,
  tokenB: string
): Promise<{ price: number; invertedPrice: number }> {
  const quote = await pancakeQuote({
    chain,
    inputToken: tokenA,
    outputToken: tokenB,
    amount: '1',
  });

  const price = parseFloat(quote.outputAmount);
  return {
    price,
    invertedPrice: price > 0 ? 1 / price : 0,
  };
}

// =============================================================================
// BALANCE UTILITY
// =============================================================================

export async function pancakeGetBalance(
  token: string,
  chain: PancakeChain,
  address?: string
): Promise<string> {
  const provider = getPancakeProvider(chain);
  const owner = address || getPancakeWallet(chain).address;
  const tokenAddress = resolvePancakeToken(token, chain) || token;

  const upper = token.toUpperCase();
  if (upper === 'BNB' || upper === 'ETH' || upper === 'NATIVE') {
    const balance = await provider.getBalance(owner);
    return formatUnits(balance, 18);
  }

  const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
  const [balance, decimals] = await Promise.all([
    tokenContract.balanceOf(owner),
    tokenContract.decimals(),
  ]);

  return formatUnits(balance, Number(decimals));
}

// =============================================================================
// EXPORTS
// =============================================================================

export { CHAIN_CONFIG as PANCAKE_CHAIN_CONFIG, COMMON_TOKENS as PANCAKE_TOKENS, FEE_TIERS as PANCAKE_FEE_TIERS };
