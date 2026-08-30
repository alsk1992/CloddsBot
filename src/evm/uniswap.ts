/**
 * Uniswap V3 Integration for EVM Trading
 *
 * Supports swaps on Ethereum mainnet, Arbitrum, Optimism, Base, Polygon
 * Uses Uniswap Universal Router for optimal execution
 */

import { ethers, Wallet, JsonRpcProvider, Contract, parseUnits, formatUnits } from 'ethers';
import { logger } from '../utils/logger';
import { getChainConfig } from './multichain';

// =============================================================================
// TYPES
// =============================================================================

export type EvmChain = 'ethereum' | 'arbitrum' | 'optimism' | 'base' | 'polygon';

export interface UniswapSwapParams {
  chain: EvmChain;
  inputToken: string;
  outputToken: string;
  amount: string;
  slippageBps?: number;
  recipient?: string;
  deadline?: number;
}

export interface UniswapQuote {
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

export interface UniswapSwapResult {
  success: boolean;
  txHash?: string;
  inputAmount: string;
  outputAmount?: string;
  gasUsed?: string;
  error?: string;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CHAIN_CONFIG: Record<EvmChain, {
  chainId: number;
  quoterV2: string;
  swapRouter: string;
  weth: string;
}> = {
  ethereum: {
    chainId: 1,
    quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    swapRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  arbitrum: {
    chainId: 42161,
    quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    swapRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  },
  optimism: {
    chainId: 10,
    quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    swapRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    weth: '0x4200000000000000000000000000000000000006',
  },
  base: {
    chainId: 8453,
    quoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    swapRouter: '0x2626664c2603336E57B271c5C0b26F421741e481',
    weth: '0x4200000000000000000000000000000000000006',
  },
  polygon: {
    chainId: 137,
    quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    swapRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    weth: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
  },
};

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
];

const SWAP_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)',
  'function exactInput(tuple(bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)',
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

// Common tokens
const COMMON_TOKENS: Record<string, Record<EvmChain, string>> = {
  USDC: {
    ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  },
  USDT: {
    ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    arbitrum: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    optimism: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    base: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    polygon: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
  WETH: {
    ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    optimism: '0x4200000000000000000000000000000000000006',
    base: '0x4200000000000000000000000000000000000006',
    polygon: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  },
};

// Fee tiers to try (in basis points * 100)
const FEE_TIERS = [500, 3000, 10000]; // 0.05%, 0.3%, 1%

// =============================================================================
// WALLET MANAGEMENT
// =============================================================================

function getEvmProvider(chain: EvmChain): JsonRpcProvider {
  // Delegates to multichain.ts's single source of truth for RPC URLs so *_RPC_URL env
  // overrides (e.g. ETH_RPC_URL) actually take effect here too — this used to keep its
  // own hardcoded rpc/env-var-name pair that silently diverged from multichain.ts's
  // (ETHEREUM_RPC_URL here vs. ETH_RPC_URL there), so setting ETH_RPC_URL never reached
  // Uniswap and it was stuck on the unreliable eth.llamarpc.com default.
  return new JsonRpcProvider(getChainConfig(chain).rpc);
}

function getEvmWallet(chain: EvmChain): Wallet {
  const privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('EVM_PRIVATE_KEY environment variable not set');
  }
  const provider = getEvmProvider(chain);
  return new Wallet(privateKey, provider);
}

// =============================================================================
// TOKEN UTILITIES
// =============================================================================

export function resolveToken(symbol: string, chain: EvmChain): string | undefined {
  const upper = symbol.toUpperCase();

  // Check common tokens
  if (COMMON_TOKENS[upper]) {
    return COMMON_TOKENS[upper][chain];
  }

  // Native token aliases
  if (upper === 'ETH' || upper === 'NATIVE') {
    return CHAIN_CONFIG[chain].weth;
  }

  // Already an address
  if (symbol.startsWith('0x') && symbol.length === 42) {
    return symbol;
  }

  return undefined;
}

export async function getTokenInfo(
  address: string,
  chain: EvmChain
): Promise<TokenInfo> {
  const provider = getEvmProvider(chain);
  const token = new Contract(address, ERC20_ABI, provider);

  const [symbol, decimals, name] = await Promise.all([
    token.symbol().catch(() => 'UNKNOWN'),
    token.decimals().catch(() => 18),
    token.name().catch(() => ''),
  ]);

  return { address, symbol, decimals: Number(decimals), name };
}

// =============================================================================
// QUOTING
// =============================================================================

export async function getUniswapQuote(
  params: Omit<UniswapSwapParams, 'recipient' | 'deadline'>
): Promise<UniswapQuote> {
  const { chain, inputToken, outputToken, amount, slippageBps = 50 } = params;
  const config = CHAIN_CONFIG[chain];

  const provider = getEvmProvider(chain);
  const quoter = new Contract(config.quoterV2, QUOTER_V2_ABI, provider);

  // Resolve token addresses
  const tokenIn = resolveToken(inputToken, chain) || inputToken;
  const tokenOut = resolveToken(outputToken, chain) || outputToken;

  // Get token decimals
  const inputInfo = await getTokenInfo(tokenIn, chain);
  const amountIn = parseUnits(amount, inputInfo.decimals);

  // Try each fee tier to find best quote
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
      // Fee tier not available for this pair
      continue;
    }
  }

  if (!bestQuote) {
    throw new Error(`No Uniswap V3 pool found for ${inputToken} -> ${outputToken} on ${chain}`);
  }

  const outputInfo = await getTokenInfo(tokenOut, chain);
  const outputAmount = formatUnits(bestQuote.amountOut, outputInfo.decimals);

  // Clamp slippage to valid range (0-10000 bps)
  const clampedSlippage = Math.max(0, Math.min(slippageBps, 10000));

  // Calculate minimum output with slippage
  const minOut = (bestQuote.amountOut * BigInt(10000 - clampedSlippage)) / 10000n;
  const outputAmountMin = formatUnits(minOut, outputInfo.decimals);

  // Estimate price impact from input/output ratio vs spot
  const inputFloat = parseFloat(amount);
  const outputFloat = parseFloat(outputAmount);
  const priceImpact = inputFloat > 0 && outputFloat > 0
    ? 0 // Accurate impact requires pool sqrtPrice; 0 is honest placeholder
    : 0;

  logger.debug(
    { chain, inputToken, outputToken, amount, outputAmount, fee: bestQuote.fee },
    'Uniswap quote'
  );

  return {
    inputToken: tokenIn,
    outputToken: tokenOut,
    inputAmount: amount,
    outputAmount,
    outputAmountMin,
    priceImpact,
    route: [tokenIn, tokenOut],
    gasEstimate: bestQuote.gasEstimate.toString(),
    feeTier: bestQuote.fee,
  };
}

// =============================================================================
// SWAP EXECUTION
// =============================================================================

export async function executeUniswapSwap(
  params: UniswapSwapParams
): Promise<UniswapSwapResult> {
  const {
    chain,
    inputToken,
    outputToken,
    amount,
    slippageBps = 50,
    deadline = Math.floor(Date.now() / 1000) + 1800, // 30 min default
  } = params;

  const config = CHAIN_CONFIG[chain];

  try {
    // Get quote first
    const quote = await getUniswapQuote({
      chain,
      inputToken,
      outputToken,
      amount,
      slippageBps,
    });

    const wallet = getEvmWallet(chain);
    const recipient = params.recipient || wallet.address;

    const inputInfo = await getTokenInfo(quote.inputToken, chain);
    const outputInfo = await getTokenInfo(quote.outputToken, chain);
    const amountIn = parseUnits(amount, inputInfo.decimals);
    const amountOutMin = parseUnits(quote.outputAmountMin, outputInfo.decimals);

    // Check if input is native ETH
    const isNativeIn = quote.inputToken.toLowerCase() === config.weth.toLowerCase() &&
      inputToken.toUpperCase() === 'ETH';

    // Approve token if not native
    if (!isNativeIn) {
      const token = new Contract(quote.inputToken, ERC20_ABI, wallet);
      const allowance = await token.allowance(wallet.address, config.swapRouter);

      if (allowance < amountIn) {
        logger.info({ token: quote.inputToken, router: config.swapRouter }, 'Approving token');
        const approveTx = await token.approve(config.swapRouter, amountIn);
        await approveTx.wait();
      }
    }

    // Build swap transaction
    const router = new Contract(config.swapRouter, SWAP_ROUTER_ABI, wallet);

    // Use the best fee tier found during quoting
    const fee = quote.feeTier ?? 3000;

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
      'Executing Uniswap swap'
    );

    // Use gas estimate from quote with 30% buffer, fallback to 500k
    const gasEstimate = quote.gasEstimate ? BigInt(quote.gasEstimate) : 0n;
    const gasLimit = gasEstimate > 0n ? (gasEstimate * 130n) / 100n : 500000n;

    const tx = await router.exactInputSingle(swapParams, {
      value: isNativeIn ? amountIn : 0n,
      gasLimit,
    });

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error(`Swap reverted on-chain (txHash: ${receipt?.hash})`);
    }

    logger.info({ txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() }, 'Swap complete');

    return {
      success: true,
      txHash: receipt.hash,
      inputAmount: amount,
      outputAmount: quote.outputAmount,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ chain, inputToken, outputToken, amount, error: message }, 'Swap failed');

    return {
      success: false,
      inputAmount: amount,
      error: message,
    };
  }
}

// =============================================================================
// BALANCE UTILITIES
// =============================================================================

export async function getEvmBalance(
  token: string,
  chain: EvmChain,
  address?: string
): Promise<string> {
  const provider = getEvmProvider(chain);
  const owner = address || getEvmWallet(chain).address;
  const tokenAddress = resolveToken(token, chain) || token;

  if (token.toUpperCase() === 'ETH' || token.toUpperCase() === 'NATIVE') {
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

export { CHAIN_CONFIG, COMMON_TOKENS, FEE_TIERS };
