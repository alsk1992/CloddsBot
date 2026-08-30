/**
 * 1inch Aggregator Integration
 *
 * Provides optimal DEX routing across multiple exchanges
 * Supports Ethereum, Arbitrum, Optimism, Base, Polygon
 */

import { ethers, Wallet, JsonRpcProvider, Contract, parseUnits, formatUnits } from 'ethers';
import { logger } from '../utils/logger';
import type { EvmChain, TokenInfo } from './uniswap';
import { resolveToken, getTokenInfo } from './uniswap';
import { getChainConfig } from './multichain';

// =============================================================================
// TYPES
// =============================================================================

export interface OneInchQuoteParams {
  chain: EvmChain;
  fromToken: string;
  toToken: string;
  amount: string;
  slippageBps?: number;
}

export interface OneInchQuote {
  fromToken: TokenInfo;
  toToken: TokenInfo;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  protocols: string[];
  estimatedGas: string;
}

export interface OneInchSwapParams extends OneInchQuoteParams {
  recipient?: string;
  allowPartialFill?: boolean;
  disableEstimate?: boolean;
}

export interface OneInchSwapResult {
  success: boolean;
  txHash?: string;
  fromAmount: string;
  toAmount?: string;
  gasUsed?: string;
  error?: string;
}

// Field names verified live against 1inch's own official generated types
// (1inch/1inch-sdk-go's aggregation_types.gen.go QuoteResponse/SwapResponse structs) —
// the API's actual wire format uses dstAmount/gas, not toAmount/estimatedGas.
interface OneInchApiQuoteResponse {
  dstAmount: string;
  protocols?: unknown[][];
  gas?: number;
}

interface OneInchApiSwapResponse {
  tx: {
    from: string;
    to: string;
    data: string;
    value: string;
    gasPrice: string;
    gas: number;
  };
  dstAmount: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

// api.1inch.dev is the deprecated legacy host (1inch's migration notice points
// integrators at api.1inch.com; confirmed against the official 1inch/1inch-sdk-go
// example, which defaults ApiUrl to "https://api.1inch.com"). v6.0 is still the
// correct path version — the same SDK's aggregation client hardcodes apiVersion = "v6.0".
const ONE_INCH_API_BASE = 'https://api.1inch.com/swap/v6.0';

const CHAIN_IDS: Record<EvmChain, number> = {
  ethereum: 1,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  polygon: 137,
};

const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

// =============================================================================
// API CLIENT
// =============================================================================

function getOneInchApiKey(): string {
  const apiKey = process.env.ONEINCH_API_KEY;
  if (!apiKey) {
    throw new Error('ONEINCH_API_KEY environment variable not set');
  }
  return apiKey;
}

async function oneInchFetch<T>(endpoint: string, chainId: number): Promise<T> {
  const url = `${ONE_INCH_API_BASE}/${chainId}${endpoint}`;
  const apiKey = getOneInchApiKey();

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`1inch API error (${response.status}): ${text}`);
  }

  return response.json() as Promise<T>;
}

// =============================================================================
// WALLET
// =============================================================================

function getEvmProvider(chain: EvmChain): JsonRpcProvider {
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
// TOKEN RESOLUTION
// =============================================================================

function resolveTokenAddress(symbol: string, chain: EvmChain): string {
  // Native token
  if (symbol.toUpperCase() === 'ETH' || symbol.toUpperCase() === 'NATIVE') {
    return NATIVE_TOKEN_ADDRESS;
  }

  // Try to resolve from common tokens
  const resolved = resolveToken(symbol, chain);
  if (resolved) {
    return resolved;
  }

  // Assume it's already an address
  if (symbol.startsWith('0x') && symbol.length === 42) {
    return symbol;
  }

  throw new Error(`Cannot resolve token: ${symbol} on ${chain}`);
}

// =============================================================================
// QUOTING
// =============================================================================

export async function getOneInchQuote(
  params: OneInchQuoteParams
): Promise<OneInchQuote> {
  const { chain, fromToken, toToken, amount, slippageBps = 100 } = params;
  const chainId = CHAIN_IDS[chain];

  const fromAddress = resolveTokenAddress(fromToken, chain);
  const toAddress = resolveTokenAddress(toToken, chain);

  // Get token info
  const isNativeFrom = fromAddress === NATIVE_TOKEN_ADDRESS;
  const isNativeTo = toAddress === NATIVE_TOKEN_ADDRESS;

  const fromInfo: TokenInfo = isNativeFrom
    ? { address: fromAddress, symbol: 'ETH', decimals: 18 }
    : await getTokenInfo(fromAddress, chain);

  const toInfo: TokenInfo = isNativeTo
    ? { address: toAddress, symbol: 'ETH', decimals: 18 }
    : await getTokenInfo(toAddress, chain);

  const fromAmountWei = parseUnits(amount, fromInfo.decimals);

  const queryParams = new URLSearchParams({
    src: fromAddress,
    dst: toAddress,
    amount: fromAmountWei.toString(),
  });

  const response = await oneInchFetch<OneInchApiQuoteResponse>(
    `/quote?${queryParams}`,
    chainId
  );

  const toAmount = formatUnits(BigInt(response.dstAmount), toInfo.decimals);
  const toAmountMin = formatUnits(
    (BigInt(response.dstAmount) * BigInt(10000 - slippageBps)) / 10000n,
    toInfo.decimals
  );

  // Extract protocol names
  const protocols: string[] = [];
  if (response.protocols) {
    for (const route of response.protocols) {
      for (const step of route) {
        if (Array.isArray(step)) {
          for (const hop of step) {
            if (hop && typeof hop === 'object' && 'name' in hop) {
              const name = (hop as { name: string }).name;
              if (!protocols.includes(name)) {
                protocols.push(name);
              }
            }
          }
        }
      }
    }
  }

  logger.debug(
    { chain, fromToken, toToken, amount, toAmount, protocols },
    '1inch quote'
  );

  return {
    fromToken: fromInfo,
    toToken: toInfo,
    fromAmount: amount,
    toAmount,
    toAmountMin,
    protocols,
    estimatedGas: response.gas?.toString() ?? '0',
  };
}

// =============================================================================
// SWAP EXECUTION
// =============================================================================

export async function executeOneInchSwap(
  params: OneInchSwapParams
): Promise<OneInchSwapResult> {
  const {
    chain,
    fromToken,
    toToken,
    amount,
    slippageBps = 100,
    allowPartialFill = false,
    disableEstimate = false,
  } = params;

  const chainId = CHAIN_IDS[chain];

  try {
    const wallet = getEvmWallet(chain);
    const recipient = params.recipient || wallet.address;

    const fromAddress = resolveTokenAddress(fromToken, chain);
    const toAddress = resolveTokenAddress(toToken, chain);

    const isNativeFrom = fromAddress === NATIVE_TOKEN_ADDRESS;

    // Get token info and calculate amount
    const fromInfo: TokenInfo = isNativeFrom
      ? { address: fromAddress, symbol: 'ETH', decimals: 18 }
      : await getTokenInfo(fromAddress, chain);

    const fromAmountWei = parseUnits(amount, fromInfo.decimals);

    // Approve 1inch router if not native token
    if (!isNativeFrom) {
      // Get 1inch router address
      const routerResponse = await oneInchFetch<{ address: string }>(
        '/approve/spender',
        chainId
      );
      const routerAddress = routerResponse.address;

      const token = new Contract(fromAddress, ERC20_ABI, wallet);
      const allowance = await token.allowance(wallet.address, routerAddress);

      if (allowance < fromAmountWei) {
        logger.info({ token: fromAddress, router: routerAddress }, 'Approving 1inch router');
        const approveTx = await token.approve(routerAddress, fromAmountWei);
        await approveTx.wait();
      }
    }

    // Build swap transaction
    const queryParams = new URLSearchParams({
      src: fromAddress,
      dst: toAddress,
      amount: fromAmountWei.toString(),
      from: wallet.address,
      receiver: recipient,
      slippage: (slippageBps / 100).toString(),
      allowPartialFill: allowPartialFill.toString(),
      disableEstimate: disableEstimate.toString(),
    });

    const swapResponse = await oneInchFetch<OneInchApiSwapResponse>(
      `/swap?${queryParams}`,
      chainId
    );

    logger.info(
      { chain, fromToken, toToken, amount, estimatedOut: swapResponse.dstAmount },
      'Executing 1inch swap'
    );

    const MAX_GAS_LIMIT = 5_000_000n;
    const apiGasLimit = BigInt(swapResponse.tx.gas);
    const gasLimit = apiGasLimit > MAX_GAS_LIMIT ? MAX_GAS_LIMIT : apiGasLimit;

    const tx = await wallet.sendTransaction({
      to: swapResponse.tx.to,
      data: swapResponse.tx.data,
      value: BigInt(swapResponse.tx.value),
      gasLimit,
      gasPrice: BigInt(swapResponse.tx.gasPrice),
    });

    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error('Transaction receipt is null');
    }

    if (receipt.status !== 1) {
      throw new Error(`Transaction reverted on-chain (txHash: ${receipt.hash})`);
    }

    // Get output token info for formatting
    const isNativeTo = toAddress === NATIVE_TOKEN_ADDRESS;
    const toInfo: TokenInfo = isNativeTo
      ? { address: toAddress, symbol: 'ETH', decimals: 18 }
      : await getTokenInfo(toAddress, chain);

    const toAmount = formatUnits(BigInt(swapResponse.dstAmount), toInfo.decimals);

    logger.info({ txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() }, '1inch swap complete');

    return {
      success: true,
      txHash: receipt.hash,
      fromAmount: amount,
      toAmount,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ chain, fromToken, toToken, amount, error: message }, '1inch swap failed');

    return {
      success: false,
      fromAmount: amount,
      error: message,
    };
  }
}

// =============================================================================
// PROTOCOL DISCOVERY
// =============================================================================

export async function getOneInchProtocols(chain: EvmChain): Promise<string[]> {
  const chainId = CHAIN_IDS[chain];

  interface ProtocolInfo {
    id: string;
    title: string;
  }

  const response = await oneInchFetch<{ protocols: ProtocolInfo[] }>(
    '/liquidity-sources',
    chainId
  );

  return response.protocols.map((p) => p.id);
}

// =============================================================================
// BEST ROUTE COMPARISON
// =============================================================================

export interface RouteComparison {
  best: 'uniswap' | '1inch';
  uniswapQuote?: {
    outputAmount: string;
    priceImpact: number;
  };
  oneInchQuote?: {
    outputAmount: string;
    protocols: string[];
  };
  savings?: string;
}

export async function compareDexRoutes(
  params: OneInchQuoteParams
): Promise<RouteComparison> {
  const { getUniswapQuote } = await import('./uniswap');

  const results: RouteComparison = {
    best: 'uniswap',
  };

  // Get Uniswap quote
  try {
    const uniQuote = await getUniswapQuote({
      chain: params.chain,
      inputToken: params.fromToken,
      outputToken: params.toToken,
      amount: params.amount,
      slippageBps: params.slippageBps,
    });

    results.uniswapQuote = {
      outputAmount: uniQuote.outputAmount,
      priceImpact: uniQuote.priceImpact,
    };
  } catch (e) {
    logger.debug({ error: (e as Error).message }, 'Uniswap quote failed');
  }

  // Get 1inch quote
  try {
    const oneInchQuote = await getOneInchQuote(params);

    results.oneInchQuote = {
      outputAmount: oneInchQuote.toAmount,
      protocols: oneInchQuote.protocols,
    };
  } catch (e) {
    logger.debug({ error: (e as Error).message }, '1inch quote failed');
  }

  // Compare and determine best
  if (results.uniswapQuote && results.oneInchQuote) {
    const uniOut = parseFloat(results.uniswapQuote.outputAmount);
    const oneInchOut = parseFloat(results.oneInchQuote.outputAmount);

    if (oneInchOut > uniOut) {
      results.best = '1inch';
      results.savings = uniOut > 0
        ? ((oneInchOut - uniOut) / uniOut * 100).toFixed(2) + '%'
        : 'N/A';
    } else {
      results.best = 'uniswap';
      results.savings = oneInchOut > 0
        ? ((uniOut - oneInchOut) / oneInchOut * 100).toFixed(2) + '%'
        : 'N/A';
    }
  } else if (results.oneInchQuote && !results.uniswapQuote) {
    results.best = '1inch';
  }

  logger.info(
    { best: results.best, savings: results.savings },
    'Route comparison complete'
  );

  return results;
}

// =============================================================================
// EXPORTS
// =============================================================================

export { CHAIN_IDS, NATIVE_TOKEN_ADDRESS };
