/**
 * Virtuals Protocol Trading & Agent Creation Integration
 *
 * Buy and sell AI agent tokens on Base chain via bonding curves
 * Supports:
 * - Agent token creation (100 VIRTUAL minimum)
 * - Bonding curve trading (pre-graduation)
 * - DEX trading via Uniswap V2 (post-graduation)
 * - Graduation status tracking (42K VIRTUAL threshold)
 *
 * Docs: https://whitepaper.virtuals.io
 * App: https://app.virtuals.io / https://fun.virtuals.io
 */

import { Wallet, JsonRpcProvider, Contract, parseUnits, formatUnits, ZeroAddress } from 'ethers';
import { logger } from '../utils/logger';
import type { TokenInfo } from './uniswap';

// =============================================================================
// CONSTANTS
// =============================================================================

export const BASE_CHAIN_ID = 8453;
export const BASE_RPC_DEFAULT = 'https://mainnet.base.org';

// VIRTUAL token (native token of Virtuals Protocol)
export const VIRTUAL_TOKEN = '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b';

// Graduation threshold: ~42K VIRTUAL accumulated triggers graduation to Uniswap
export const GRADUATION_THRESHOLD = parseUnits('42000', 18);

// Agent creation cost: 100 VIRTUAL minimum
export const AGENT_CREATION_COST = parseUnits('100', 18);

// Fixed agent token supply: 1 billion tokens
export const AGENT_TOKEN_SUPPLY = parseUnits('1000000000', 18);

// Virtuals Protocol contracts on Base (verified from whitepaper & BaseScan)
export const VIRTUALS_CONTRACTS = {
  // Bonding Proxy - main router for bonding curve trades
  bondingProxy: '0xF66DeA7b3e897cD44A5a231c61B6B4423d613259',
  // Sell Order Execution - executes queued sell orders
  sellExecutor: '0xF8DD39c71A278FE9F4377D009D7627EF140f809e',
  // Creator Token Vault - locks pre-bonding tokens for creators
  creatorVault: '0xdAd686299FB562f89e55DA05F1D96FaBEb2A2E32',
  // Sell Wall Wallet - disburses tokens to pending sell orders
  sellWallet: '0xe2890629EF31b32132003C02B29a50A025dEeE8a',
  // veVIRTUAL Voting Token
  veVirtual: '0x14559863b6E695A8aa4B7e68541d240ac1BBeB2f',
  // Tax Manager
  taxManager: '0x7e26173192d72fd6d75a759f888d61c2cdbb64b1',
};

// Uniswap V2 on Base (for graduated agents)
export const UNISWAP_V2_ROUTER = '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24';
export const UNISWAP_V2_FACTORY = '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6';

// =============================================================================
// TYPES
// =============================================================================

export interface VirtualsQuoteParams {
  agentToken: string;
  amount: string;
  side: 'buy' | 'sell';
  slippageBps?: number;
}

export interface VirtualsQuote {
  agentToken: TokenInfo;
  virtualToken: TokenInfo;
  inputAmount: string;
  outputAmount: string;
  outputAmountMin: string;
  priceImpact: number;
  currentPrice: number;
  newPrice: number;
  isGraduated: boolean;
  route: 'bonding' | 'uniswap';
}

export interface VirtualsSwapParams extends VirtualsQuoteParams {
  recipient?: string;
}

export interface VirtualsSwapResult {
  success: boolean;
  txHash?: string;
  inputAmount: string;
  outputAmount?: string;
  gasUsed?: string;
  error?: string;
  route?: 'bonding' | 'uniswap';
}

export interface AgentTokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  isGraduated: boolean;
  bondingCurve?: {
    virtualReserve: string;
    tokenReserve: string;
    currentPrice: string;
    progressToGraduation: number; // 0-100%
  };
  uniswapPair?: string;
  creator: string;
  createdAt?: number;
}

export interface AgentCreationParams {
  name: string;
  symbol: string;
  description?: string;
  initialVirtualAmount?: string; // Min 100 VIRTUAL
  prePurchaseAmount?: string; // Optional pre-purchase for creator
}

export interface AgentCreationResult {
  success: boolean;
  txHash?: string;
  agentTokenAddress?: string;
  error?: string;
}

export type AgentStatus = 'prototype' | 'sentient' | 'graduated';

// =============================================================================
// ABI FRAGMENTS (from Code4rena audit & verified contracts)
// =============================================================================

// ABIs below verified against the real deployed contracts (code-423n4/2025-04-virtuals-protocol
// audit source) and live-checked on Base mainnet against VIRTUALS_CONTRACTS.bondingProxy — see
// getBondingCurveQuote/buyAgentToken/sellAgentToken for how they fit together. The Bonding
// contract is a SINGLETON that trades on behalf of every agent token — there is no per-token
// bonding contract; buy/sell/state all live behind tokenAddress-parameterized calls here.

// Bonding - singleton bonding-curve manager (VIRTUALS_CONTRACTS.bondingProxy)
const BONDING_PROXY_ABI = [
  'function factory() view returns (address)',
  'function router() view returns (address)',
  'function gradThreshold() view returns (uint256)',
  // No minAmountOut param exists on-chain — Bonding.buy/sell take only (amountIn, tokenAddress).
  // Recipient is always msg.sender (the Router call chain hardcodes `to = msg.sender`), so a
  // custom recipient is not supported for bonding-curve trades (only for graduated/Uniswap trades).
  'function buy(uint256 amountIn, address tokenAddress) payable returns (bool)',
  'function sell(uint256 amountIn, address tokenAddress) returns (bool)',
];

// FFactory - resolves the per-token bonding pair and holds the protocol's buy/sell tax rate
const FFACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) view returns (address)',
  'function buyTax() view returns (uint256)', // whole-number percent, e.g. 1 = 1%
  'function sellTax() view returns (uint256)',
];

// FRouter - getAmountsOut is the router's own quote math; calling it directly guarantees the
// quote matches exactly what buy()/sell() will execute on-chain (no hand-rolled AMM formula
// drift). buy() and sell() themselves are EXECUTOR_ROLE-gated and NOT callable by end users —
// only Bonding (which holds that role) can call them, which is why trades go through Bonding.
const FROUTER_QUOTE_ABI = [
  'function getAmountsOut(address token, address assetToken, uint256 amountIn) view returns (uint256)',
];

// FPair - per-token bonding pool (found via FFactory.getPair(agentToken, VIRTUAL_TOKEN)).
// balance() = agent token reserve, assetBalance() = VIRTUAL reserve (confirmed from FPair.sol:
// tokenA/balance() is the agent token side, tokenB/assetBalance() is the asset side, matching
// the (tokenAddress, assetToken) argument order Bonding.sol itself uses for getPair).
const FPAIR_ABI = [
  'function getReserves() view returns (uint256, uint256)',
  'function assetBalance() view returns (uint256)',
  'function balance() view returns (uint256)',
];

// AgentFactoryV4 - For creating new agents
const AGENT_FACTORY_ABI = [
  'function initFromToken(string name, string symbol, address token) external',
  'function executeApplication(uint256 id, bool canStake) external',
  'function applicationCount() view returns (uint256)',
  'event AgentCreated(uint256 indexed id, address indexed token, address indexed creator)',
];

// AgentVeToken - Staking/voting
const AGENT_VE_TOKEN_ABI = [
  'function stake(uint256 amount, address receiver, address delegatee) external',
  'function delegate(address delegatee) external',
  'function balanceOf(address account) view returns (uint256)',
];

// Standard ERC20
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

// Uniswap V2 Router (for graduated agents)
const UNISWAP_V2_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory)',
  'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
];

// Uniswap V2 Factory
const UNISWAP_V2_FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) view returns (address)',
];

// =============================================================================
// PROVIDER & WALLET
// =============================================================================

// Cached (not re-created per call) — this file's read paths now make several concurrent
// contract calls per operation (bonding proxy, factory, pair, token), and the free default
// RPC visibly rate-limits bursts of fresh connections; reusing one provider avoids piling on
// more connections than the calls themselves require. Mirrors multichain.ts's getProvider().
let baseProviderCache: JsonRpcProvider | null = null;

function getBaseProvider(): JsonRpcProvider {
  if (!baseProviderCache) {
    const customRpc = process.env.BASE_RPC_URL;
    baseProviderCache = new JsonRpcProvider(customRpc || BASE_RPC_DEFAULT, BASE_CHAIN_ID);
  }
  return baseProviderCache;
}

function getBaseWallet(): Wallet {
  const privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('EVM_PRIVATE_KEY environment variable not set');
  }
  return new Wallet(privateKey, getBaseProvider());
}

// =============================================================================
// AGENT STATUS & INFO
// =============================================================================

/**
 * Check if an agent token has graduated from bonding curve to Uniswap
 */
export async function isAgentGraduated(tokenAddress: string): Promise<boolean> {
  const provider = getBaseProvider();

  try {
    // Bonding has no per-token graduated() getter (there is no per-token bonding contract —
    // see BONDING_PROXY_ABI). Graduation is detected the same way the protocol's own
    // _openTradingOnUniswap does it in effect: once graduated, a real Uniswap pair with
    // liquidity exists for (tokenAddress, VIRTUAL_TOKEN).
    const factory = new Contract(UNISWAP_V2_FACTORY, UNISWAP_V2_FACTORY_ABI, provider);
    const pair = await factory.getPair(tokenAddress, VIRTUAL_TOKEN).catch(() => ZeroAddress);

    if (pair !== ZeroAddress) {
      const pairContract = new Contract(pair, ERC20_ABI, provider);
      const liquidity = await pairContract.totalSupply().catch(() => 0n);
      return liquidity > 0n;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Get graduation progress (0-100%)
 */
export async function getGraduationProgress(tokenAddress: string): Promise<number> {
  const provider = getBaseProvider();

  try {
    const bonding = new Contract(VIRTUALS_CONTRACTS.bondingProxy, BONDING_PROXY_ABI, provider);
    const factoryAddr = await bonding.factory();
    const factory = new Contract(factoryAddr, FFACTORY_ABI, provider);
    const pairAddress = await factory.getPair(tokenAddress, VIRTUAL_TOKEN);
    if (pairAddress === ZeroAddress) return 0;
    const pair = new Contract(pairAddress, FPAIR_ABI, provider);

    const [assetBalance, threshold] = await Promise.all([
      pair.assetBalance().catch(() => 0n),
      bonding.gradThreshold().catch(() => GRADUATION_THRESHOLD),
    ]);

    if (threshold === 0n) return 100;

    // Use formatUnits to avoid precision loss on large bigints (42K * 1e18 exceeds Number.MAX_SAFE_INTEGER)
    const assetFloat = parseFloat(formatUnits(assetBalance, 18));
    const thresholdFloat = parseFloat(formatUnits(threshold, 18));
    const progress = thresholdFloat > 0 ? (assetFloat / thresholdFloat) * 100 : 100;
    return Math.min(100, progress);
  } catch {
    return 0;
  }
}

/**
 * Get agent status: prototype, sentient, or graduated
 */
export async function getAgentStatus(tokenAddress: string): Promise<AgentStatus> {
  const graduated = await isAgentGraduated(tokenAddress);
  if (graduated) return 'graduated';

  const progress = await getGraduationProgress(tokenAddress);
  // Sentient = has some traction but not graduated
  if (progress > 10) return 'sentient';

  return 'prototype';
}

/**
 * Get detailed info about an agent token
 */
export async function getAgentTokenInfo(tokenAddress: string): Promise<AgentTokenInfo> {
  const provider = getBaseProvider();
  const token = new Contract(tokenAddress, ERC20_ABI, provider);
  const bonding = new Contract(VIRTUALS_CONTRACTS.bondingProxy, BONDING_PROXY_ABI, provider);

  const [name, symbol, decimals, totalSupply, graduated] = await Promise.all([
    token.name().catch(() => 'Unknown'),
    token.symbol().catch(() => 'UNKNOWN'),
    token.decimals().catch(() => 18),
    token.totalSupply().catch(() => 0n),
    isAgentGraduated(tokenAddress),
  ]);

  const tokenDecimals = Number(decimals);
  const info: AgentTokenInfo = {
    address: tokenAddress,
    name,
    symbol,
    decimals: tokenDecimals,
    totalSupply: formatUnits(totalSupply, tokenDecimals),
    isGraduated: graduated,
    creator: '',
  };

  if (!graduated) {
    // Get bonding curve info from the token's FPair, not the token contract itself
    const factoryAddr = await bonding.factory();
    const factory = new Contract(factoryAddr, FFACTORY_ABI, provider);
    const pairAddress = await factory.getPair(tokenAddress, VIRTUAL_TOKEN);
    const pair = new Contract(pairAddress, FPAIR_ABI, provider);

    const [assetBalance, tokenBalance, threshold] = await Promise.all([
      pairAddress === ZeroAddress ? 0n : pair.assetBalance().catch(() => 0n),
      pairAddress === ZeroAddress ? 0n : pair.balance().catch(() => 0n),
      bonding.gradThreshold().catch(() => GRADUATION_THRESHOLD),
    ]);

    const vReserve = Number(formatUnits(assetBalance, 18));
    const tReserve = Number(formatUnits(tokenBalance, tokenDecimals));
    const currentPrice = tReserve > 0 ? vReserve / tReserve : 0;
    const assetF = parseFloat(formatUnits(assetBalance, 18));
    const thresholdF = parseFloat(formatUnits(threshold, 18));
    const progress = thresholdF > 0 ? (assetF / thresholdF) * 100 : 100;

    info.bondingCurve = {
      virtualReserve: formatUnits(assetBalance, 18),
      tokenReserve: formatUnits(tokenBalance, tokenDecimals),
      currentPrice: currentPrice.toString(),
      progressToGraduation: Math.min(100, progress),
    };
  } else {
    // Get Uniswap pair for graduated agents
    const factory = new Contract(UNISWAP_V2_FACTORY, UNISWAP_V2_FACTORY_ABI, provider);
    const pair = await factory.getPair(tokenAddress, VIRTUAL_TOKEN).catch(() => ZeroAddress);
    if (pair !== ZeroAddress) {
      info.uniswapPair = pair;
    }
  }

  return info;
}

// =============================================================================
// QUOTING
// =============================================================================

/**
 * Get quote for buying/selling agent tokens
 * Automatically routes to bonding curve or Uniswap based on graduation status
 */
export async function getVirtualsQuote(params: VirtualsQuoteParams): Promise<VirtualsQuote> {
  const { agentToken, amount, side, slippageBps = 100 } = params;

  const provider = getBaseProvider();
  const token = new Contract(agentToken, ERC20_ABI, provider);

  // Get token info and graduation status
  const [symbol, decimals, graduated] = await Promise.all([
    token.symbol(),
    token.decimals(),
    isAgentGraduated(agentToken),
  ]);

  const tokenDecimals = Number(decimals);

  if (graduated) {
    // Use Uniswap for graduated agents
    return getUniswapQuote(agentToken, symbol, tokenDecimals, amount, side, slippageBps);
  }

  // Use bonding curve for non-graduated agents
  return getBondingCurveQuote(agentToken, symbol, tokenDecimals, amount, side, slippageBps);
}

async function getBondingCurveQuote(
  agentToken: string,
  symbol: string,
  tokenDecimals: number,
  amount: string,
  side: 'buy' | 'sell',
  slippageBps: number
): Promise<VirtualsQuote> {
  const provider = getBaseProvider();
  const bonding = new Contract(VIRTUALS_CONTRACTS.bondingProxy, BONDING_PROXY_ABI, provider);
  const factoryAddr: string = await bonding.factory();
  const factory = new Contract(factoryAddr, FFACTORY_ABI, provider);
  const routerAddr: string = await bonding.router();
  const router = new Contract(routerAddr, FROUTER_QUOTE_ABI, provider);

  const pairAddress: string = await factory.getPair(agentToken, VIRTUAL_TOKEN);
  if (pairAddress === ZeroAddress) {
    throw new Error(`No bonding curve pair found for ${agentToken}`);
  }
  const pair = new Contract(pairAddress, FPAIR_ABI, provider);

  // Get reserves (balance() = agent token reserve, assetBalance() = VIRTUAL reserve)
  const [tokenBalance, assetBalance, buyTax, sellTax] = await Promise.all([
    pair.balance(),
    pair.assetBalance(),
    factory.buyTax(),
    factory.sellTax(),
  ]);

  const vReserve = BigInt(assetBalance);
  const tReserve = BigInt(tokenBalance);

  if (tReserve === 0n || vReserve === 0n) {
    throw new Error('Bonding curve has no liquidity (zero reserves)');
  }

  const currentPrice = Number(formatUnits(vReserve, 18)) / Number(formatUnits(tReserve, tokenDecimals));

  let inputAmount: bigint;
  let outputAmount: bigint;
  let newPrice: number;

  // Mirrors FRouter.buy/sell exactly (see FROUTER_QUOTE_ABI comment): buy taxes amountIn
  // before quoting against the VIRTUAL reserve; sell quotes the raw amountIn against the
  // token reserve (passing ZeroAddress, matching the real sell() call) then taxes amountOut.
  if (side === 'buy') {
    inputAmount = parseUnits(amount, 18); // VIRTUAL
    const txFee = (inputAmount * BigInt(buyTax)) / 100n;
    const netIn = inputAmount - txFee;
    outputAmount = await router.getAmountsOut(agentToken, VIRTUAL_TOKEN, netIn);

    const newVReserve = vReserve + netIn;
    const newTReserve = tReserve - outputAmount;
    const newTReserveFloat = Number(formatUnits(newTReserve, tokenDecimals));
    newPrice = newTReserveFloat > 0
      ? Number(formatUnits(newVReserve, 18)) / newTReserveFloat
      : currentPrice;
  } else {
    inputAmount = parseUnits(amount, tokenDecimals);
    const rawOut: bigint = await router.getAmountsOut(agentToken, ZeroAddress, inputAmount);
    const txFee = (rawOut * BigInt(sellTax)) / 100n;
    outputAmount = rawOut - txFee;

    const newVReserve = vReserve - rawOut;
    const newTReserve = tReserve + inputAmount;
    const newTReserveFloat = Number(formatUnits(newTReserve, tokenDecimals));
    newPrice = newTReserveFloat > 0
      ? Number(formatUnits(newVReserve, 18)) / newTReserveFloat
      : currentPrice;
  }

  // Clamp slippage to valid range
  const clampedSlippage = Math.max(0, Math.min(slippageBps, 10000));
  const outputAmountMin = (outputAmount * BigInt(10000 - clampedSlippage)) / 10000n;
  const priceImpact = currentPrice > 0
    ? Math.abs((newPrice - currentPrice) / currentPrice) * 100
    : 0;
  const outputDecimals = side === 'buy' ? tokenDecimals : 18;
  const inputDecimals = side === 'buy' ? 18 : tokenDecimals;

  return {
    agentToken: { address: agentToken, symbol, decimals: tokenDecimals },
    virtualToken: { address: VIRTUAL_TOKEN, symbol: 'VIRTUAL', decimals: 18 },
    inputAmount: formatUnits(inputAmount, inputDecimals),
    outputAmount: formatUnits(outputAmount, outputDecimals),
    outputAmountMin: formatUnits(outputAmountMin, outputDecimals),
    priceImpact,
    currentPrice,
    newPrice,
    isGraduated: false,
    route: 'bonding',
  };
}

async function getUniswapQuote(
  agentToken: string,
  symbol: string,
  tokenDecimals: number,
  amount: string,
  side: 'buy' | 'sell',
  slippageBps: number
): Promise<VirtualsQuote> {
  const provider = getBaseProvider();
  const router = new Contract(UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_ABI, provider);

  const path = side === 'buy'
    ? [VIRTUAL_TOKEN, agentToken]
    : [agentToken, VIRTUAL_TOKEN];

  const inputDecimals = side === 'buy' ? 18 : tokenDecimals;
  const outputDecimals = side === 'buy' ? tokenDecimals : 18;
  const inputAmount = parseUnits(amount, inputDecimals);

  const amounts = await router.getAmountsOut(inputAmount, path);
  const outputAmount = amounts[1];
  const clampedSlippage = Math.max(0, Math.min(slippageBps, 10000));
  const outputAmountMin = (outputAmount * BigInt(10000 - clampedSlippage)) / 10000n;

  // Price = VIRTUAL per agent token (consistent with bonding curve convention)
  const inputFloat = Number(formatUnits(inputAmount, inputDecimals));
  const outputFloat = Number(formatUnits(outputAmount, outputDecimals));
  const currentPrice = side === 'buy'
    ? (inputFloat > 0 && outputFloat > 0 ? inputFloat / outputFloat : 0)
    : (inputFloat > 0 && outputFloat > 0 ? outputFloat / inputFloat : 0);
  const priceImpact = 0; // Would need spot price comparison

  return {
    agentToken: { address: agentToken, symbol, decimals: tokenDecimals },
    virtualToken: { address: VIRTUAL_TOKEN, symbol: 'VIRTUAL', decimals: 18 },
    inputAmount: formatUnits(inputAmount, inputDecimals),
    outputAmount: formatUnits(outputAmount, outputDecimals),
    outputAmountMin: formatUnits(outputAmountMin, outputDecimals),
    priceImpact,
    currentPrice,
    newPrice: currentPrice,
    isGraduated: true,
    route: 'uniswap',
  };
}

// =============================================================================
// TRADING
// =============================================================================

/**
 * Buy agent tokens with VIRTUAL
 * Automatically routes to bonding curve or Uniswap
 */
export async function buyAgentToken(params: VirtualsSwapParams): Promise<VirtualsSwapResult> {
  const { agentToken, amount, slippageBps = 100 } = params;

  try {
    const wallet = getBaseWallet();
    const recipient = params.recipient || wallet.address;
    const quote = await getVirtualsQuote({ agentToken, amount, side: 'buy', slippageBps });

    if (!quote.isGraduated && params.recipient && params.recipient !== wallet.address) {
      throw new Error(
        'Bonding-curve buys always credit the caller (Bonding.buy has no recipient param) — a custom recipient is only supported after graduation.'
      );
    }

    const inputAmount = parseUnits(amount, 18);
    const virtualToken = new Contract(VIRTUAL_TOKEN, ERC20_ABI, wallet);

    let tx;
    if (quote.isGraduated) {
      const spender = UNISWAP_V2_ROUTER;
      const allowance = await virtualToken.allowance(wallet.address, spender);
      if (allowance < inputAmount) {
        logger.info({ spender }, 'Approving VIRTUAL spend');
        const approveTx = await virtualToken.approve(spender, inputAmount);
        await approveTx.wait();
      }

      // Uniswap swap
      const router = new Contract(UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_ABI, wallet);
      const minOut = parseUnits(quote.outputAmountMin, quote.agentToken.decimals);
      const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min

      logger.info({ route: 'uniswap', agentToken, amount }, 'Executing Uniswap buy');
      tx = await router.swapExactTokensForTokens(
        inputAmount,
        minOut,
        [VIRTUAL_TOKEN, agentToken],
        recipient,
        deadline
      );
    } else {
      const bonding = new Contract(VIRTUALS_CONTRACTS.bondingProxy, BONDING_PROXY_ABI, wallet);
      const spender: string = await bonding.router(); // FRouter pulls the ERC20 itself — see FROUTER_QUOTE_ABI comment
      const allowance = await virtualToken.allowance(wallet.address, spender);
      if (allowance < inputAmount) {
        logger.info({ spender }, 'Approving VIRTUAL spend');
        const approveTx = await virtualToken.approve(spender, inputAmount);
        await approveTx.wait();
      }

      // Bonding.buy(amountIn, tokenAddress) has no minAmountOut param — re-quote immediately
      // before sending and abort if the price has moved past the user's slippage tolerance,
      // since there is no atomic on-chain protection to fall back on.
      const freshQuote = await getBondingCurveQuote(agentToken, quote.agentToken.symbol, quote.agentToken.decimals, amount, 'buy', slippageBps);
      const freshOut = parseUnits(freshQuote.outputAmount, quote.agentToken.decimals);
      const minOut = parseUnits(quote.outputAmountMin, quote.agentToken.decimals);
      if (freshOut < minOut) {
        throw new Error(
          `Bonding curve price moved beyond slippage tolerance (fresh quote ${freshQuote.outputAmount} < min ${quote.outputAmountMin})`
        );
      }

      logger.info({ route: 'bonding', agentToken, amount }, 'Executing bonding curve buy');
      tx = await bonding.buy(inputAmount, agentToken);
    }

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      return {
        success: false,
        txHash: receipt?.hash,
        inputAmount: amount,
        error: `Buy reverted on-chain (txHash: ${receipt?.hash})`,
      };
    }

    logger.info({ txHash: receipt.hash, route: quote.route }, 'Virtuals buy complete');

    return {
      success: true,
      txHash: receipt.hash,
      inputAmount: amount,
      outputAmount: quote.outputAmount,
      gasUsed: receipt.gasUsed.toString(),
      route: quote.route,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ agentToken, amount, error: message }, 'Virtuals buy failed');
    return { success: false, inputAmount: amount, error: message };
  }
}

/**
 * Sell agent tokens for VIRTUAL
 * Automatically routes to bonding curve or Uniswap
 */
export async function sellAgentToken(params: VirtualsSwapParams): Promise<VirtualsSwapResult> {
  const { agentToken, amount, slippageBps = 100 } = params;

  try {
    const wallet = getBaseWallet();
    const recipient = params.recipient || wallet.address;
    const quote = await getVirtualsQuote({ agentToken, amount, side: 'sell', slippageBps });

    if (!quote.isGraduated && params.recipient && params.recipient !== wallet.address) {
      throw new Error(
        'Bonding-curve sells always credit the caller (Bonding.sell has no recipient param) — a custom recipient is only supported after graduation.'
      );
    }

    const token = new Contract(agentToken, ERC20_ABI, wallet);
    const inputAmount = parseUnits(amount, quote.agentToken.decimals);

    let tx;
    if (quote.isGraduated) {
      const spender = UNISWAP_V2_ROUTER;
      const allowance = await token.allowance(wallet.address, spender);
      if (allowance < inputAmount) {
        logger.info({ spender }, 'Approving agent token spend');
        const approveTx = await token.approve(spender, inputAmount);
        await approveTx.wait();
      }

      // Uniswap swap
      const router = new Contract(UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_ABI, wallet);
      const minOut = parseUnits(quote.outputAmountMin, 18);
      const deadline = Math.floor(Date.now() / 1000) + 300;

      logger.info({ route: 'uniswap', agentToken, amount }, 'Executing Uniswap sell');
      tx = await router.swapExactTokensForTokens(
        inputAmount,
        minOut,
        [agentToken, VIRTUAL_TOKEN],
        recipient,
        deadline
      );
    } else {
      const bonding = new Contract(VIRTUALS_CONTRACTS.bondingProxy, BONDING_PROXY_ABI, wallet);
      const spender: string = await bonding.router();
      const allowance = await token.allowance(wallet.address, spender);
      if (allowance < inputAmount) {
        logger.info({ spender }, 'Approving agent token spend');
        const approveTx = await token.approve(spender, inputAmount);
        await approveTx.wait();
      }

      // See buyAgentToken: Bonding.sell(amountIn, tokenAddress) has no minAmountOut param either.
      const freshQuote = await getBondingCurveQuote(agentToken, quote.agentToken.symbol, quote.agentToken.decimals, amount, 'sell', slippageBps);
      const freshOut = parseUnits(freshQuote.outputAmount, 18);
      const minOut = parseUnits(quote.outputAmountMin, 18);
      if (freshOut < minOut) {
        throw new Error(
          `Bonding curve price moved beyond slippage tolerance (fresh quote ${freshQuote.outputAmount} < min ${quote.outputAmountMin})`
        );
      }

      logger.info({ route: 'bonding', agentToken, amount }, 'Executing bonding curve sell');
      tx = await bonding.sell(inputAmount, agentToken);
    }

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      return {
        success: false,
        txHash: receipt?.hash,
        inputAmount: amount,
        error: `Sell reverted on-chain (txHash: ${receipt?.hash})`,
      };
    }

    logger.info({ txHash: receipt.hash, route: quote.route }, 'Virtuals sell complete');

    return {
      success: true,
      txHash: receipt.hash,
      inputAmount: amount,
      outputAmount: quote.outputAmount,
      gasUsed: receipt.gasUsed.toString(),
      route: quote.route,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ agentToken, amount, error: message }, 'Virtuals sell failed');
    return { success: false, inputAmount: amount, error: message };
  }
}

// =============================================================================
// BALANCE UTILITIES
// =============================================================================

/**
 * Get VIRTUAL token balance
 */
export async function getVirtualBalance(address?: string): Promise<string> {
  const provider = getBaseProvider();
  const owner = address || getBaseWallet().address;
  const token = new Contract(VIRTUAL_TOKEN, ERC20_ABI, provider);

  const balance = await token.balanceOf(owner);
  return formatUnits(balance, 18);
}

/**
 * Get agent token balance
 */
export async function getAgentTokenBalance(agentToken: string, address?: string): Promise<string> {
  const provider = getBaseProvider();
  const owner = address || getBaseWallet().address;
  const token = new Contract(agentToken, ERC20_ABI, provider);

  const [balance, decimals] = await Promise.all([
    token.balanceOf(owner),
    token.decimals(),
  ]);

  return formatUnits(balance, Number(decimals));
}

/**
 * Get all agent token balances for an address
 */
export async function getAgentTokenBalances(
  agentTokens: string[],
  address?: string
): Promise<Map<string, string>> {
  const balances = new Map<string, string>();
  const results = await Promise.all(
    agentTokens.map(token => getAgentTokenBalance(token, address).catch(() => '0'))
  );

  agentTokens.forEach((token, i) => {
    if (parseFloat(results[i]) > 0) {
      balances.set(token, results[i]);
    }
  });

  return balances;
}

// =============================================================================
// AGENT DISCOVERY (via API)
// =============================================================================

const VIRTUALS_API = 'https://api.virtuals.io/api';

export interface VirtualsApiAgent {
  id: string;
  name: string;
  symbol: string;
  tokenAddress: string;
  description?: string;
  image?: string;
  marketCap: number;
  price: number;
  priceChange24h?: number;
  volume24h: number;
  holders: number;
  status: 'prototype' | 'sentient' | 'graduated';
  createdAt: string;
}

/**
 * Search for agents via Virtuals API
 */
export async function searchAgents(query: string, limit = 20): Promise<VirtualsApiAgent[]> {
  try {
    const url = `${VIRTUALS_API}/agents?search=${encodeURIComponent(query)}&limit=${limit}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json() as { agents?: VirtualsApiAgent[]; data?: VirtualsApiAgent[] };
    return data.agents || data.data || [];
  } catch (error) {
    logger.warn({ error, query }, 'Virtuals API search failed');
    return [];
  }
}

/**
 * Get trending agents
 */
export async function getTrendingAgents(limit = 10): Promise<VirtualsApiAgent[]> {
  try {
    const url = `${VIRTUALS_API}/agents?sortBy=volume24h&sortOrder=desc&limit=${limit}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json() as { agents?: VirtualsApiAgent[]; data?: VirtualsApiAgent[] };
    return data.agents || data.data || [];
  } catch (error) {
    logger.warn({ error }, 'Failed to fetch trending agents');
    return [];
  }
}

/**
 * Get newly launched agents
 */
export async function getNewAgents(limit = 10): Promise<VirtualsApiAgent[]> {
  try {
    const url = `${VIRTUALS_API}/agents?sortBy=createdAt&sortOrder=desc&limit=${limit}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json() as { agents?: VirtualsApiAgent[]; data?: VirtualsApiAgent[] };
    return data.agents || data.data || [];
  } catch (error) {
    logger.warn({ error }, 'Failed to fetch new agents');
    return [];
  }
}

/**
 * Get agent by token address
 */
export async function getAgentByToken(tokenAddress: string): Promise<VirtualsApiAgent | null> {
  try {
    const url = `${VIRTUALS_API}/agents/${tokenAddress}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json() as VirtualsApiAgent | { agent?: VirtualsApiAgent };
    if ('agent' in data && data.agent) {
      return data.agent;
    }
    if ('id' in data && (data as VirtualsApiAgent).id) {
      return data as VirtualsApiAgent;
    }
    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// STAKING (veVIRTUAL)
// =============================================================================

export interface StakeParams {
  amount: string;
  receiver?: string;
  delegatee?: string;
}

export interface StakeResult {
  success: boolean;
  txHash?: string;
  amount: string;
  error?: string;
}

/**
 * Stake VIRTUAL tokens for veVIRTUAL
 */
export async function stakeVirtual(params: StakeParams): Promise<StakeResult> {
  const { amount } = params;

  try {
    const wallet = getBaseWallet();
    const receiver = params.receiver || wallet.address;
    const delegatee = params.delegatee || wallet.address;

    // Approve VIRTUAL spend
    const virtualToken = new Contract(VIRTUAL_TOKEN, ERC20_ABI, wallet);
    const stakeAmount = parseUnits(amount, 18);
    const allowance = await virtualToken.allowance(wallet.address, VIRTUALS_CONTRACTS.veVirtual);

    if (allowance < stakeAmount) {
      logger.info('Approving VIRTUAL for staking');
      const approveTx = await virtualToken.approve(VIRTUALS_CONTRACTS.veVirtual, stakeAmount);
      await approveTx.wait();
    }

    // Stake
    const veToken = new Contract(VIRTUALS_CONTRACTS.veVirtual, AGENT_VE_TOKEN_ABI, wallet);
    logger.info({ amount, receiver, delegatee }, 'Staking VIRTUAL');
    const tx = await veToken.stake(stakeAmount, receiver, delegatee);
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      return { success: false, amount, error: `Stake reverted on-chain (txHash: ${receipt?.hash})` };
    }

    logger.info({ txHash: receipt.hash }, 'Stake complete');
    return { success: true, txHash: receipt.hash, amount };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ amount, error: message }, 'Stake failed');
    return { success: false, amount, error: message };
  }
}

/**
 * Get veVIRTUAL balance
 */
export async function getVeVirtualBalance(address?: string): Promise<string> {
  const provider = getBaseProvider();
  const owner = address || getBaseWallet().address;
  const veToken = new Contract(VIRTUALS_CONTRACTS.veVirtual, AGENT_VE_TOKEN_ABI, provider);

  const balance = await veToken.balanceOf(owner);
  return formatUnits(balance, 18);
}

/**
 * Delegate voting power
 */
export async function delegateVotingPower(delegatee: string): Promise<StakeResult> {
  try {
    const wallet = getBaseWallet();
    const veToken = new Contract(VIRTUALS_CONTRACTS.veVirtual, AGENT_VE_TOKEN_ABI, wallet);

    logger.info({ delegatee }, 'Delegating voting power');
    const tx = await veToken.delegate(delegatee);
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      return { success: false, amount: '0', error: `Delegation reverted on-chain (txHash: ${receipt?.hash})` };
    }

    logger.info({ txHash: receipt.hash }, 'Delegation complete');
    return { success: true, txHash: receipt.hash, amount: '0' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ delegatee, error: message }, 'Delegation failed');
    return { success: false, amount: '0', error: message };
  }
}

// =============================================================================
// AGENT CREATION (via fun.virtuals.io API)
// =============================================================================

/**
 * Note: Agent creation requires:
 * 1. 100 VIRTUAL tokens minimum
 * 2. Metadata (name, symbol, description, image)
 * 3. Interaction with fun.virtuals.io frontend or API
 *
 * The on-chain AgentFactory requires MINTER_ROLE which is restricted.
 * For programmatic agent creation, use the Virtuals API.
 */

export interface CreateAgentViaApiParams {
  name: string;
  symbol: string;
  description: string;
  imageUrl?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

/**
 * Create agent via Virtuals API (requires API key)
 * Note: This is a placeholder - actual API may require authentication
 */
export async function createAgentViaApi(
  params: CreateAgentViaApiParams,
  apiKey?: string
): Promise<AgentCreationResult> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['X-API-KEY'] = apiKey;
    }

    const response = await fetch(`${VIRTUALS_API}/agents/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: params.name,
        symbol: params.symbol,
        description: params.description,
        image: params.imageUrl,
        socials: {
          twitter: params.twitter,
          telegram: params.telegram,
          website: params.website,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `API error: ${response.status} - ${error}` };
    }

    const data = await response.json() as { tokenAddress?: string; txHash?: string };
    return {
      success: true,
      txHash: data.txHash,
      agentTokenAddress: data.tokenAddress,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ params, error: message }, 'Agent creation failed');
    return { success: false, error: message };
  }
}

/**
 * Check if user has enough VIRTUAL for agent creation
 */
export async function canCreateAgent(address?: string): Promise<{
  canCreate: boolean;
  balance: string;
  required: string;
  shortfall: string;
}> {
  const balance = await getVirtualBalance(address);
  const required = formatUnits(AGENT_CREATION_COST, 18);
  const balanceNum = parseFloat(balance);
  const requiredNum = parseFloat(required);

  return {
    canCreate: balanceNum >= requiredNum,
    balance,
    required,
    shortfall: balanceNum < requiredNum ? (requiredNum - balanceNum).toString() : '0',
  };
}
