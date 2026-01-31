/**
 * Odos Swap Aggregator Integration
 *
 * DEX aggregation across multiple chains.
 * Finds best routes and executes swaps.
 */

import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits, MaxUint256 } from 'ethers';
import { getProvider, getChainConfig, ChainName, CHAINS } from './multichain';
import { logger } from '../utils/logger';

// =============================================================================
// ODOS API
// =============================================================================

const ODOS_API_BASE = 'https://api.odos.xyz';

// Chain IDs that Odos supports
const ODOS_SUPPORTED_CHAINS: Record<ChainName, number> = {
  ethereum: 1,
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  bsc: 56,
  optimism: 10,
  avalanche: 43114,
};

// Native token address placeholder (used by Odos)
const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000';

// =============================================================================
// TYPES
// =============================================================================

export interface OdosQuoteRequest {
  chain: ChainName;
  inputToken: string;      // Token address or 'ETH'/'native'
  outputToken: string;     // Token address or 'ETH'/'native'
  amount: string;          // Human-readable amount
  slippageBps?: number;    // Default 50 (0.5%)
  userAddress?: string;    // For quote accuracy
}

export interface OdosQuote {
  inputToken: string;
  inputAmount: string;
  inputAmountRaw: bigint;
  outputToken: string;
  outputAmount: string;
  outputAmountRaw: bigint;
  priceImpact: number;
  gasEstimate: bigint;
  route: string[];
  pathId: string;         // Used to assemble transaction
}

export interface OdosSwapRequest extends OdosQuoteRequest {
  privateKey: string;
  maxSlippageBps?: number;
}

export interface OdosSwapResult {
  success: boolean;
  txHash?: string;
  inputAmount: string;
  outputAmount: string;
  error?: string;
}

interface OdosApiQuoteResponse {
  pathId: string;
  inTokens: string[];
  outTokens: string[];
  inAmounts: string[];
  outAmounts: string[];
  gasEstimate: number;
  priceImpact: number;
  pathViz?: { protocol: string }[];
}

interface OdosApiAssembleResponse {
  transaction: {
    to: string;
    data: string;
    value: string;
    gas: number;
  };
  outputTokens: { amount: string }[];
}

// =============================================================================
// TOKEN HELPERS
// =============================================================================

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

function normalizeTokenAddress(token: string): string {
  const lower = token.toLowerCase();
  if (lower === 'eth' || lower === 'native' || lower === 'matic' || lower === 'bnb' || lower === 'avax') {
    return NATIVE_TOKEN;
  }
  return token;
}

async function getTokenDecimals(chain: ChainName, tokenAddress: string): Promise<number> {
  if (tokenAddress === NATIVE_TOKEN) {
    return 18;
  }

  const provider = getProvider(chain);
  const token = new Contract(tokenAddress, ERC20_ABI, provider);

  try {
    return Number(await token.decimals());
  } catch {
    return 18;
  }
}

// =============================================================================
// QUOTE
// =============================================================================

/**
 * Get swap quote from Odos
 */
export async function getOdosQuote(request: OdosQuoteRequest): Promise<OdosQuote> {
  const chainId = ODOS_SUPPORTED_CHAINS[request.chain];
  if (!chainId) {
    throw new Error(`Chain ${request.chain} not supported by Odos`);
  }

  const inputToken = normalizeTokenAddress(request.inputToken);
  const outputToken = normalizeTokenAddress(request.outputToken);
  const slippageBps = request.slippageBps ?? 50;

  // Get decimals for input token
  const decimals = await getTokenDecimals(request.chain, inputToken);
  const inputAmountRaw = parseUnits(request.amount, decimals);

  // Build quote request
  const quoteBody = {
    chainId,
    inputTokens: [{ tokenAddress: inputToken, amount: inputAmountRaw.toString() }],
    outputTokens: [{ tokenAddress: outputToken, proportion: 1 }],
    slippageLimitPercent: slippageBps / 100,
    userAddr: request.userAddress || '0x0000000000000000000000000000000000000001',
    referralCode: 0,
    disableRFQs: true,
    compact: true,
  };

  const response = await fetch(`${ODOS_API_BASE}/sor/quote/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quoteBody),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Odos quote failed: ${response.status} ${text}`);
  }

  const data = await response.json() as OdosApiQuoteResponse;

  // Get output decimals
  const outputDecimals = await getTokenDecimals(request.chain, outputToken);
  const outputAmountRaw = BigInt(data.outAmounts[0]);

  return {
    inputToken,
    inputAmount: request.amount,
    inputAmountRaw,
    outputToken,
    outputAmount: formatUnits(outputAmountRaw, outputDecimals),
    outputAmountRaw,
    priceImpact: data.priceImpact,
    gasEstimate: BigInt(data.gasEstimate),
    route: data.pathViz?.map(p => p.protocol) || [],
    pathId: data.pathId,
  };
}

// =============================================================================
// APPROVE
// =============================================================================

/**
 * Approve token spending for Odos router
 */
async function ensureApproval(
  chain: ChainName,
  tokenAddress: string,
  spender: string,
  amount: bigint,
  wallet: Wallet
): Promise<string | null> {
  if (tokenAddress === NATIVE_TOKEN) {
    return null; // Native tokens don't need approval
  }

  const token = new Contract(tokenAddress, ERC20_ABI, wallet);
  const currentAllowance = await token.allowance(wallet.address, spender);

  if (currentAllowance >= amount) {
    return null; // Already approved
  }

  logger.info({ token: tokenAddress, spender, amount: amount.toString() }, 'Approving token');

  const tx = await token.approve(spender, MaxUint256);
  const receipt = await tx.wait();

  return receipt.hash;
}

// =============================================================================
// SWAP
// =============================================================================

/**
 * Execute swap via Odos
 */
export async function executeOdosSwap(request: OdosSwapRequest): Promise<OdosSwapResult> {
  try {
    // Get quote first
    const quote = await getOdosQuote({
      chain: request.chain,
      inputToken: request.inputToken,
      outputToken: request.outputToken,
      amount: request.amount,
      slippageBps: request.slippageBps,
    });

    const chainId = ODOS_SUPPORTED_CHAINS[request.chain];
    const provider = getProvider(request.chain);
    const wallet = new Wallet(request.privateKey, provider);

    // Assemble transaction
    const assembleBody = {
      userAddr: wallet.address,
      pathId: quote.pathId,
      simulate: false,
    };

    const assembleResponse = await fetch(`${ODOS_API_BASE}/sor/assemble`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assembleBody),
    });

    if (!assembleResponse.ok) {
      const text = await assembleResponse.text();
      throw new Error(`Odos assemble failed: ${assembleResponse.status} ${text}`);
    }

    const assembled = await assembleResponse.json() as OdosApiAssembleResponse;
    const tx = assembled.transaction;

    // Approve if needed (for ERC20 input)
    if (quote.inputToken !== NATIVE_TOKEN) {
      await ensureApproval(
        request.chain,
        quote.inputToken,
        tx.to,
        quote.inputAmountRaw,
        wallet
      );
    }

    // Execute swap
    logger.info({
      chain: request.chain,
      input: `${quote.inputAmount} ${request.inputToken}`,
      output: `${quote.outputAmount} ${request.outputToken}`,
    }, 'Executing Odos swap');

    const txResponse = await wallet.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value),
      gasLimit: BigInt(Math.floor(tx.gas * 1.2)), // 20% buffer
    });

    const receipt = await txResponse.wait();

    // Get actual output from receipt or use quote estimate
    const outputDecimals = await getTokenDecimals(request.chain, quote.outputToken);
    const actualOutput = assembled.outputTokens?.[0]?.amount
      ? formatUnits(BigInt(assembled.outputTokens[0].amount), outputDecimals)
      : quote.outputAmount;

    return {
      success: true,
      txHash: receipt?.hash,
      inputAmount: quote.inputAmount,
      outputAmount: actualOutput,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Odos swap failed');

    return {
      success: false,
      inputAmount: request.amount,
      outputAmount: '0',
      error: message,
    };
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Swap native token (ETH/MATIC/BNB) to ERC20
 */
export async function swapNativeToToken(
  chain: ChainName,
  outputToken: string,
  amount: string,
  privateKey: string,
  slippageBps = 50
): Promise<OdosSwapResult> {
  return executeOdosSwap({
    chain,
    inputToken: 'native',
    outputToken,
    amount,
    privateKey,
    slippageBps,
  });
}

/**
 * Swap ERC20 to native token
 */
export async function swapTokenToNative(
  chain: ChainName,
  inputToken: string,
  amount: string,
  privateKey: string,
  slippageBps = 50
): Promise<OdosSwapResult> {
  return executeOdosSwap({
    chain,
    inputToken,
    outputToken: 'native',
    amount,
    privateKey,
    slippageBps,
  });
}

/**
 * Swap between two ERC20 tokens
 */
export async function swapTokens(
  chain: ChainName,
  inputToken: string,
  outputToken: string,
  amount: string,
  privateKey: string,
  slippageBps = 50
): Promise<OdosSwapResult> {
  return executeOdosSwap({
    chain,
    inputToken,
    outputToken,
    amount,
    privateKey,
    slippageBps,
  });
}

/**
 * Get supported chains
 */
export function getSupportedChains(): ChainName[] {
  return Object.keys(ODOS_SUPPORTED_CHAINS) as ChainName[];
}
