/**
 * LCX Liberty DEX Integration
 *
 * Optional extra route source next to Uniswap and 1inch. It is only used when
 * LCX_API_KEY is set (free key: https://dex.lcx.com/dashboard).
 * Supports Ethereum, Arbitrum, Optimism, Base, Polygon. Same-chain swaps only.
 * API docs: https://dex.lcx.com/docs
 */

import { Wallet, JsonRpcProvider, Contract, parseUnits, formatUnits } from 'ethers';
import { logger } from '../utils/logger';
import type { EvmChain, TokenInfo } from './uniswap';
import { resolveToken, getTokenInfo } from './uniswap';
import { getChainConfig } from './multichain';

// =============================================================================
// TYPES
// =============================================================================

export interface LcxQuoteParams {
  chain: EvmChain;
  fromToken: string;
  toToken: string;
  amount: string;
  slippageBps?: number;
}

export interface LcxQuote {
  fromToken: TokenInfo;
  toToken: TokenInfo;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  protocols: string[];
  quoteId: string;
  expiresAt: number;
}

export interface LcxSwapParams extends LcxQuoteParams {
  recipient?: string;
}

export interface LcxSwapResult {
  success: boolean;
  txHash?: string;
  fromAmount: string;
  toAmount?: string;
  gasUsed?: string;
  error?: string;
}

/** Quote as returned by POST /v1/quote (amounts are integer strings in base units) */
export interface LcxApiQuote {
  quoteId: string;
  chainId: number;
  input: { token: string; amount: string; decimals: number };
  output: { token: string; amount: string; decimals: number; minimumAmount: string };
  spender: string;
  venues?: string[];
  expiresAt: number;
}

interface LcxApiBuild {
  swap: { chainId: number; to: string; data: string; value: string };
  minAmountOut: string;
  routerDeployed: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const LCX_API_BASE = 'https://swap-api.lcx.com/v1';
const LCX_TIMEOUT_MS = 10_000;

// The API uses the zero address for the native coin (not 0xEeee...)
const LCX_NATIVE_TOKEN = '0x0000000000000000000000000000000000000000';

// Published router per chain. Quotes and builds that point anywhere else are rejected.
const LCX_ROUTERS: Record<EvmChain, string> = {
  ethereum: '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0',
  arbitrum: '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0',
  optimism: '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0',
  base: '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0',
  polygon: '0x0000000000654902B6Ed6cC240cc81CB4c4a3dff',
};

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

// =============================================================================
// API CLIENT
// =============================================================================

function getLcxApiKey(): string {
  const apiKey = process.env.LCX_API_KEY;
  if (!apiKey) {
    throw new Error('LCX_API_KEY environment variable not set');
  }
  return apiKey;
}

async function lcxPost<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const apiKey = getLcxApiKey();

  const response = await fetch(`${LCX_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LCX_TIMEOUT_MS),
  });

  // Errors are JSON too: { success: false, code, error, message }
  const text = await response.text();
  let json: { success?: boolean; data?: T; code?: string; message?: string } | undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON (e.g. a proxy error page); reported as raw text below
  }

  if (!response.ok || !json?.success || !json.data) {
    const reason = json?.code ? `${json.code}: ${json.message ?? ''}` : text;
    throw new Error(`LCX Liberty DEX API error (${response.status}): ${reason}`);
  }

  return json.data;
}

function getLcxChain(chain: EvmChain): { chainId: number; router: string } {
  const router = LCX_ROUTERS[chain];
  if (!router) {
    throw new Error(`Chain ${chain} not supported by LCX Liberty DEX`);
  }
  return { chainId: getChainConfig(chain).chainId, router };
}

function sameAddress(a: string | undefined, b: string): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

function ensure(condition: boolean, what: string): void {
  if (!condition) {
    throw new Error(`LCX Liberty DEX response rejected: ${what}`);
  }
}

// =============================================================================
// WALLET AND TOKENS
// =============================================================================

function getEvmWallet(chain: EvmChain): Wallet {
  const privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('EVM_PRIVATE_KEY environment variable not set');
  }
  return new Wallet(privateKey, new JsonRpcProvider(getChainConfig(chain).rpc));
}

function resolveTokenAddress(symbol: string, chain: EvmChain): string {
  const upper = symbol.toUpperCase();
  if (upper === 'ETH' || upper === 'NATIVE') {
    return LCX_NATIVE_TOKEN;
  }

  const resolved = resolveToken(symbol, chain);
  if (!resolved) {
    throw new Error(`Cannot resolve token: ${symbol} on ${chain}`);
  }
  return resolved;
}

/** Resolve both tokens and convert the human-readable amount to base units */
async function prepareTrade(params: LcxQuoteParams) {
  const { chain, fromToken, toToken, amount } = params;
  const tokenInfo = async (address: string): Promise<TokenInfo> =>
    address === LCX_NATIVE_TOKEN ? { address, symbol: 'ETH', decimals: 18 } : getTokenInfo(address, chain);

  const [fromInfo, toInfo] = await Promise.all([
    tokenInfo(resolveTokenAddress(fromToken, chain)),
    tokenInfo(resolveTokenAddress(toToken, chain)),
  ]);

  return { fromInfo, toInfo, amountIn: parseUnits(amount, fromInfo.decimals) };
}

// =============================================================================
// QUOTING
// =============================================================================

/**
 * Request a quote for `amountIn` base units and check that it describes exactly
 * that trade on the published router.
 */
export async function requestLcxQuote(
  chain: EvmChain,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  slippageBps = 50
): Promise<LcxApiQuote> {
  const { chainId, router } = getLcxChain(chain);

  const { quote } = await lcxPost<{ quote: LcxApiQuote }>('/quote', {
    chainId,
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    slippageBps,
  });

  ensure(sameAddress(quote.spender, router), `spender ${quote.spender} is not the published router`);
  ensure(quote.chainId === chainId, `quote is for chain ${quote.chainId}`);
  ensure(BigInt(quote.input.amount) === amountIn, 'quoted input amount differs from the request');
  ensure(sameAddress(quote.input.token, tokenIn), 'quoted input token differs from the request');
  ensure(sameAddress(quote.output.token, tokenOut), 'quoted output token differs from the request');

  return quote;
}

/**
 * Turn a validated quote into a transaction for `recipient` and check it before use.
 */
export async function buildLcxSwap(
  chain: EvmChain,
  quote: LcxApiQuote,
  recipient: string,
  slippageBps = 50
): Promise<{ to: string; data: string; value: bigint }> {
  const { chainId, router } = getLcxChain(chain);

  const build = await lcxPost<LcxApiBuild>('/build', {
    quoteId: quote.quoteId,
    recipient,
    slippageBps,
  });

  const { swap } = build;
  const expectedValue = sameAddress(quote.input.token, LCX_NATIVE_TOKEN) ? BigInt(quote.input.amount) : 0n;

  ensure(sameAddress(swap.to, router), `swap target ${swap.to} is not the published router`);
  ensure(swap.chainId === chainId, `swap is for chain ${swap.chainId}`);
  ensure(build.routerDeployed === true, 'router is not deployed on this chain');
  ensure(BigInt(build.minAmountOut) === BigInt(quote.output.minimumAmount), 'minAmountOut differs from the quote');
  ensure(BigInt(swap.value) === expectedValue, 'transaction value differs from the native amount sold');

  return { to: swap.to, data: swap.data, value: BigInt(swap.value) };
}

export async function getLcxQuote(params: LcxQuoteParams): Promise<LcxQuote> {
  const { chain, fromToken, toToken, amount, slippageBps = 50 } = params;

  const { fromInfo, toInfo, amountIn } = await prepareTrade(params);
  const quote = await requestLcxQuote(chain, fromInfo.address, toInfo.address, amountIn, slippageBps);

  const toAmount = formatUnits(BigInt(quote.output.amount), toInfo.decimals);
  const toAmountMin = formatUnits(BigInt(quote.output.minimumAmount), toInfo.decimals);

  logger.debug(
    { chain, fromToken, toToken, amount, toAmount, venues: quote.venues },
    'LCX Liberty DEX quote'
  );

  return {
    fromToken: fromInfo,
    toToken: toInfo,
    fromAmount: amount,
    toAmount,
    toAmountMin,
    protocols: quote.venues ?? [],
    quoteId: quote.quoteId,
    expiresAt: quote.expiresAt,
  };
}

// =============================================================================
// SWAP EXECUTION
// =============================================================================

export async function executeLcxSwap(params: LcxSwapParams): Promise<LcxSwapResult> {
  const { chain, fromToken, toToken, amount, slippageBps = 50 } = params;

  try {
    const wallet = getEvmWallet(chain);
    const recipient = params.recipient || wallet.address;

    const { fromInfo, toInfo, amountIn } = await prepareTrade(params);
    const quote = await requestLcxQuote(chain, fromInfo.address, toInfo.address, amountIn, slippageBps);

    // Approve exactly the amount being sold, to the router the quote was checked against
    if (fromInfo.address !== LCX_NATIVE_TOKEN) {
      const token = new Contract(fromInfo.address, ERC20_ABI, wallet);
      const allowance: bigint = await token.allowance(wallet.address, quote.spender);

      if (allowance < amountIn) {
        logger.info({ token: fromInfo.address, router: quote.spender }, 'Approving LCX Liberty DEX router');
        const approveTx = await token.approve(quote.spender, amountIn);
        await approveTx.wait();
      }
    }

    const swap = await buildLcxSwap(chain, quote, recipient, slippageBps);

    logger.info(
      { chain, fromToken, toToken, amount, estimatedOut: quote.output.amount },
      'Executing LCX Liberty DEX swap'
    );

    const tx = await wallet.sendTransaction({ to: swap.to, data: swap.data, value: swap.value });

    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error('Transaction receipt is null');
    }

    if (receipt.status !== 1) {
      throw new Error(`Transaction reverted on-chain (txHash: ${receipt.hash})`);
    }

    logger.info({ txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() }, 'LCX Liberty DEX swap complete');

    return {
      success: true,
      txHash: receipt.hash,
      fromAmount: amount,
      toAmount: formatUnits(BigInt(quote.output.amount), toInfo.decimals),
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ chain, fromToken, toToken, amount, error: message }, 'LCX Liberty DEX swap failed');

    return {
      success: false,
      fromAmount: amount,
      error: message,
    };
  }
}
