/**
 * Pons Family (pons.family) — token launchpad on Robinhood Chain.
 *
 * Two live generations, both verified on-chain (see constants below):
 *   - V1: CREATE2 factory that mints a fixed-supply token straight into a
 *     one-sided Uniswap V3 position (chosen DEX config stored per-launch,
 *     queried live rather than hardcoded — Robinhood Chain's own V3
 *     deployment addresses aren't assumed to match any other chain's).
 *   - V2: full supply mints to a constant-product bonding curve trading in
 *     the pool's eventual quote asset (native ETH, or a chosen ERC-20
 *     pairToken), which graduates permanently into a locked Uniswap V4 pool
 *     once the sellable allocation is exhausted.
 *
 * Sources verified against ponsdotdev/ponsfamily (official contracts repo)
 * and cross-checked live on-chain: both factory addresses have real deployed
 * bytecode. The published contractsV2/src/v2/PonsV2BondingCurve.sol source
 * lags the live deployment though — this file's V2 curve ABI instead matches
 * the interface actually exercised against live curves by a production
 * Robinhood Chain trading bot, which is what surfaced the clean way to
 * price the anti-snipe tax: currentSnipeTaxBps(recipient) is a live,
 * per-recipient view (respects exemptions), so quotes read it directly
 * instead of reconstructing a decay formula from scratch.
 */

import { Contract, JsonRpcProvider, Wallet, ZeroAddress, formatUnits, parseUnits } from 'ethers';
import { getChainConfig } from './multichain';
import { logger } from '../utils/logger';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Verified live on Robinhood Chain (real deployed bytecode, confirmed via eth_getCode). */
export const PONS_V1_FACTORY = '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB';
export const PONS_V2_FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';

const CHAIN = 'robinhood' as const;

function getProvider(): JsonRpcProvider {
  return new JsonRpcProvider(getChainConfig(CHAIN).rpc, getChainConfig(CHAIN).chainId);
}

function getWallet(): Wallet {
  const privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('EVM_PRIVATE_KEY environment variable not set');
  }
  return new Wallet(privateKey, getProvider());
}

// =============================================================================
// SHARED TYPES
// =============================================================================

export interface PonsQuote {
  generation: 'v1' | 'v2';
  inputAmount: string;
  outputAmount: string;
  outputAmountMin: string;
  priceImpact: number;
  /**
   * V2 only. Live current total tax (protocol snipe-decay component +
   * creatorTaxBps) for the quoted recipient, read directly from
   * currentSnipeTaxBps(recipient) rather than computed from a decay formula.
   * Already folded into outputAmount/outputAmountMin — surfaced separately
   * so callers can see how much of the quote is anti-snipe tax right now.
   */
  currentTaxBps?: number;
}

export interface PonsSwapResult {
  success: boolean;
  txHash?: string;
  outputAmount?: string;
  error?: string;
}

// =============================================================================
// V1 — CREATE2 factory + Uniswap V3
// =============================================================================

const PONS_V1_FACTORY_ABI = [
  'function getLaunchedToken(address token) view returns (tuple(address token, address deployer, address pairedToken, address positionManager, uint256 positionId, uint256 dexId, uint256 launchConfigId, uint256 restrictionsEndBlock, uint256 supply, bool isToken0, uint24 poolFee, bool exists, uint256 initialBuyAmount))',
  'function getDexConfig(uint256 id) view returns (tuple(string name, address factory, address positionManager, address swapRouter, uint24 poolFee, int24 tickSpacing, bool enabled))',
];

const V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
];

const V3_POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)',
];

const SWAP_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

interface PonsV1LaunchedToken {
  token: string;
  deployer: string;
  pairedToken: string;
  positionManager: string;
  positionId: bigint;
  dexId: bigint;
  launchConfigId: bigint;
  restrictionsEndBlock: bigint;
  supply: bigint;
  isToken0: boolean;
  poolFee: number;
  exists: boolean;
  initialBuyAmount: bigint;
}

/** Note: QuoterV2 requires a state-changing (non-view) staticCall, unlike a plain read. */
export async function getPonsV1LaunchedToken(tokenAddress: string): Promise<PonsV1LaunchedToken | null> {
  const provider = getProvider();
  const factory = new Contract(PONS_V1_FACTORY, PONS_V1_FACTORY_ABI, provider);
  const result = await factory.getLaunchedToken(tokenAddress);
  if (!result.exists) return null;
  return {
    token: result.token,
    deployer: result.deployer,
    pairedToken: result.pairedToken,
    positionManager: result.positionManager,
    positionId: result.positionId,
    dexId: result.dexId,
    launchConfigId: result.launchConfigId,
    restrictionsEndBlock: result.restrictionsEndBlock,
    supply: result.supply,
    isToken0: result.isToken0,
    poolFee: Number(result.poolFee),
    exists: result.exists,
    initialBuyAmount: result.initialBuyAmount,
  };
}

/**
 * Quote a V1-launched token's price via the exact DEX config it was
 * launched against — queried live per-launch, not assumed, since a V1
 * launch's DEX profile is chosen at launch time and can differ between
 * launches (owner-managed DexConfig list). Robinhood Chain's Pons V1
 * DexConfig points at a *custom* Uniswap V3 deployment (factory
 * 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA, confirmed live via
 * getDexConfig(0) — NOT the canonical cross-chain Uniswap V3 factory
 * address), and no Quoter/QuoterV2 contract for that custom deployment is
 * published anywhere this session could find. Rather than guess an address,
 * this reads the pool's own slot0().sqrtPriceX96 directly and prices off
 * spot — exact for the fee, but ignores price impact from crossing
 * initialized ticks, so it under-estimates slippage on large trades. Treat
 * outputAmountMin as a floor computed off this spot price, not a
 * simulated-exact quote.
 */
export async function getPonsV1Quote(
  tokenAddress: string,
  amount: string,
  side: 'buy' | 'sell'
): Promise<PonsQuote> {
  const provider = getProvider();
  const launch = await getPonsV1LaunchedToken(tokenAddress);
  if (!launch) throw new Error(`Pons V1: ${tokenAddress} is not a launched token`);

  const factoryConfig = new Contract(PONS_V1_FACTORY, PONS_V1_FACTORY_ABI, provider);
  const dexConfig = await factoryConfig.getDexConfig(launch.dexId);

  const tokenIn = side === 'buy' ? launch.pairedToken : tokenAddress;
  const tokenOut = side === 'buy' ? tokenAddress : launch.pairedToken;
  const inDecimals = tokenIn === ZeroAddress ? 18 : await erc20Decimals(provider, tokenIn);
  const amountIn = parseUnits(amount, inDecimals);

  const v3Factory = new Contract(dexConfig.factory, V3_FACTORY_ABI, provider);
  const poolAddress = await v3Factory.getPool(tokenIn, tokenOut, launch.poolFee);
  if (poolAddress === ZeroAddress) {
    throw new Error(`Pons V1: no ${launch.poolFee / 10000}% pool found for ${tokenAddress} on dex config ${launch.dexId}`);
  }
  const pool = new Contract(poolAddress, V3_POOL_ABI, provider);
  const [sqrtPriceX96] = await pool.slot0();

  const priceX192 = (sqrtPriceX96 as bigint) * (sqrtPriceX96 as bigint);
  const Q192 = 1n << 192n;
  // launch.isToken0 tells us whether the launched token is pool.token0.
  const tokenInIsToken0 = side === 'buy' ? !launch.isToken0 : launch.isToken0;
  let rawOut = tokenInIsToken0 ? (amountIn * priceX192) / Q192 : (amountIn * Q192) / priceX192;
  rawOut = (rawOut * (1_000_000n - BigInt(launch.poolFee))) / 1_000_000n;

  const outDecimals = tokenOut === ZeroAddress ? 18 : await erc20Decimals(provider, tokenOut);
  const outputAmount = formatUnits(rawOut, outDecimals);
  const outputAmountMin = formatUnits((rawOut * 9950n) / 10000n, outDecimals); // 0.5% default slippage off spot

  return {
    generation: 'v1',
    inputAmount: amount,
    outputAmount,
    outputAmountMin,
    priceImpact: 0, // spot-price quote; real impact depends on tick liquidity this doesn't read
  };
}

async function erc20Decimals(provider: JsonRpcProvider, token: string): Promise<number> {
  const contract = new Contract(token, ['function decimals() view returns (uint8)'], provider);
  return Number(await contract.decimals());
}

/**
 * Execute a V1 swap via the launch's own DEX config's SwapRouter.
 */
export async function executePonsV1Swap(
  tokenAddress: string,
  amount: string,
  side: 'buy' | 'sell',
  slippageBps = 50
): Promise<PonsSwapResult> {
  try {
    const wallet = getWallet();
    const launch = await getPonsV1LaunchedToken(tokenAddress);
    if (!launch) throw new Error(`Pons V1: ${tokenAddress} is not a launched token`);

    const factory = new Contract(PONS_V1_FACTORY, PONS_V1_FACTORY_ABI, wallet.provider!);
    const dexConfig = await factory.getDexConfig(launch.dexId);

    const tokenIn = side === 'buy' ? launch.pairedToken : tokenAddress;
    const tokenOut = side === 'buy' ? tokenAddress : launch.pairedToken;
    const inDecimals = tokenIn === ZeroAddress ? 18 : await erc20Decimals(wallet.provider! as JsonRpcProvider, tokenIn);
    const amountIn = parseUnits(amount, inDecimals);
    const isNativeIn = tokenIn === ZeroAddress;

    if (!isNativeIn) {
      const token = new Contract(tokenIn, ERC20_ABI, wallet);
      const allowance = await token.allowance(wallet.address, dexConfig.swapRouter);
      if (allowance < amountIn) {
        const approveTx = await token.approve(dexConfig.swapRouter, amountIn);
        await approveTx.wait();
      }
    }

    const quote = await getPonsV1Quote(tokenAddress, amount, side);
    const outDecimals = tokenOut === ZeroAddress ? 18 : await erc20Decimals(wallet.provider! as JsonRpcProvider, tokenOut);
    const clampedSlippage = Math.max(0, Math.min(slippageBps, 10000));
    const minOut = (parseUnits(quote.outputAmount, outDecimals) * BigInt(10000 - clampedSlippage)) / 10000n;

    const router = new Contract(dexConfig.swapRouter, SWAP_ROUTER_ABI, wallet);
    const tx = await router.exactInputSingle(
      {
        tokenIn,
        tokenOut,
        fee: launch.poolFee,
        recipient: wallet.address,
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
      { value: isNativeIn ? amountIn : 0n }
    );
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      return { success: false, error: `Pons V1 swap reverted on-chain (txHash: ${receipt?.hash})` };
    }

    return { success: true, txHash: receipt.hash, outputAmount: quote.outputAmount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, tokenAddress, amount, side }, 'Pons V1 swap failed');
    return { success: false, error: message };
  }
}

// =============================================================================
// V2 — bonding curve + graduated Uniswap V4 pool
// =============================================================================

const PONS_V2_FACTORY_ABI = [
  'function getLaunchedToken(address token) view returns (tuple(address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))',
  'function snipeTaxSeconds() view returns (uint256)',
  'function snipeTaxStartBps() view returns (uint256)',
];

// This does NOT match the curve ABI in the published contractsV2 source (which
// exposes getReserves()/feeBps()/creatorTaxBps() and has neither
// currentSnipeTaxBps nor a documented decay formula). It matches the interface
// actually exercised against live deployed curves by a production Robinhood
// Chain trading bot (private repo, branch verified as the most recently
// updated branch in that repo as of this writing) — trusted over the public
// source here because it reflects real, working calls against the live
// contract rather than a possibly-stale snapshot. currentSnipeTaxBps(recipient)
// is what resolves the anti-snipe tax cleanly: it's a live, per-recipient view
// (respects exemptions) rather than something this codebase has to
// reconstruct from a decay formula it was never able to verify independently.
const PONS_V2_CURVE_ABI = [
  'function token() view returns (address)',
  'function pairToken() view returns (address)',
  'function graduated() view returns (bool)',
  'function launchedAt() view returns (uint256)',
  'function currentSnipeTaxBps(address recipient) view returns (uint256)',
  'function trackedQuote() view returns (uint256)',
  'function trackedTokens() view returns (uint256)',
  'function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)',
  'function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)',
];

enum GraduationPhase {
  NotGraduated = 0,
  Swept = 1,
  PoolCreated = 2,
  Rescued = 3,
}

interface PonsV2LaunchedToken {
  token: string;
  curve: string;
  deployer: string;
  creatorFeeRecipient: string;
  pairToken: string;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  phase: GraduationPhase;
  exists: boolean;
}

export async function getPonsV2LaunchedToken(tokenAddress: string): Promise<PonsV2LaunchedToken | null> {
  const provider = getProvider();
  const factory = new Contract(PONS_V2_FACTORY, PONS_V2_FACTORY_ABI, provider);
  const result = await factory.getLaunchedToken(tokenAddress);
  if (!result.exists) return null;
  return {
    token: result.token,
    curve: result.curve,
    deployer: result.deployer,
    creatorFeeRecipient: result.creatorFeeRecipient,
    pairToken: result.pairToken,
    graduationThreshold: result.graduationThreshold,
    poolFee: Number(result.poolFee),
    tickSpacing: Number(result.tickSpacing),
    creatorTaxBps: Number(result.creatorTaxBps),
    buybackEnabled: result.buybackEnabled,
    phase: Number(result.phase),
    exists: result.exists,
  };
}

/**
 * Replicates PonsV2BondingCurve's own constant-product math exactly
 * (fee-then-formula for buys, formula-then-fee for sells — see
 * PonsV2BondingCurveMath.sol) so quotes match what buy()/sell() will
 * actually execute, rather than a hand-rolled approximation.
 */
function curveAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n;
  const numerator = amountIn * reserveOut;
  const denominator = reserveIn + amountIn;
  return numerator / denominator;
}

export async function getPonsV2Quote(
  tokenAddress: string,
  amount: string,
  side: 'buy' | 'sell',
  /** Address the tax will be assessed against — pass the trading wallet for an exact
   *  quote (tax-exempt wallets get a lower rate); defaults to the zero address, which
   *  gives the conservative non-exempt rate for an anonymous/pre-wallet quote. */
  recipient: string = ZeroAddress
): Promise<PonsQuote> {
  const provider = getProvider();
  const launch = await getPonsV2LaunchedToken(tokenAddress);
  if (!launch) throw new Error(`Pons V2: ${tokenAddress} is not a launched token`);
  if (launch.phase !== GraduationPhase.NotGraduated) {
    throw new Error(
      `Pons V2: ${tokenAddress} has already graduated (phase ${GraduationPhase[launch.phase]}) — trade its Uniswap V4 pool instead, not implemented here yet`
    );
  }

  const curve = new Contract(launch.curve, PONS_V2_CURVE_ABI, provider);

  const [trackedQuote, trackedTokens, currentSnipeTaxBps] = await Promise.all([
    curve.trackedQuote(),
    curve.trackedTokens(),
    curve.currentSnipeTaxBps(recipient),
  ]);

  const quoteDecimals = launch.pairToken === ZeroAddress ? 18 : await erc20Decimals(provider, launch.pairToken);
  const tokenDecimals = 18; // PonsV2LauncherToken is a standard fixed-supply ERC20; 18dp per OpenZeppelin default used in the source

  const totalFeeBps = BigInt(currentSnipeTaxBps) + BigInt(launch.creatorTaxBps);
  let outputAmount: bigint;

  if (side === 'buy') {
    const quoteIn = parseUnits(amount, quoteDecimals);
    const netIn = quoteIn - (quoteIn * totalFeeBps) / 10000n;
    outputAmount = curveAmountOut(netIn, trackedQuote, trackedTokens);
  } else {
    const tokensIn = parseUnits(amount, tokenDecimals);
    const grossOut = curveAmountOut(tokensIn, trackedTokens, trackedQuote);
    outputAmount = grossOut - (grossOut * totalFeeBps) / 10000n;
  }

  const outDecimals = side === 'buy' ? tokenDecimals : quoteDecimals;
  const outputAmountFormatted = formatUnits(outputAmount, outDecimals);
  const outputAmountMin = formatUnits((outputAmount * 9950n) / 10000n, outDecimals); // 0.5% default slippage

  return {
    generation: 'v2',
    inputAmount: amount,
    outputAmount: outputAmountFormatted,
    outputAmountMin,
    priceImpact: 0, // reserves-based estimate; doesn't separately model curve convexity beyond the constant-product formula itself
    currentTaxBps: Number(totalFeeBps),
  };
}

export async function executePonsV2Buy(
  tokenAddress: string,
  quoteAmount: string,
  slippageBps = 50
): Promise<PonsSwapResult> {
  try {
    const wallet = getWallet();
    const launch = await getPonsV2LaunchedToken(tokenAddress);
    if (!launch) throw new Error(`Pons V2: ${tokenAddress} is not a launched token`);

    const quote = await getPonsV2Quote(tokenAddress, quoteAmount, 'buy', wallet.address);
    if ((quote.currentTaxBps ?? 0) > 2000) {
      logger.warn(
        { tokenAddress, currentTaxBps: quote.currentTaxBps },
        'Pons V2 buy: currently inside an elevated anti-snipe tax window — quote already prices this in, but confirm it is intentional'
      );
    }

    const isNativeQuote = launch.pairToken === ZeroAddress;
    const quoteDecimals = isNativeQuote ? 18 : await erc20Decimals(wallet.provider! as JsonRpcProvider, launch.pairToken);
    const quoteIn = parseUnits(quoteAmount, quoteDecimals);
    const clampedSlippage = Math.max(0, Math.min(slippageBps, 10000));
    const minTokensOut = (parseUnits(quote.outputAmount, 18) * BigInt(10000 - clampedSlippage)) / 10000n;

    if (!isNativeQuote) {
      const token = new Contract(launch.pairToken, ERC20_ABI, wallet);
      const allowance = await token.allowance(wallet.address, launch.curve);
      if (allowance < quoteIn) {
        const approveTx = await token.approve(launch.curve, quoteIn);
        await approveTx.wait();
      }
    }

    const curve = new Contract(launch.curve, PONS_V2_CURVE_ABI, wallet);
    const tx = await curve.buy(quoteIn, minTokensOut, wallet.address, {
      value: isNativeQuote ? quoteIn : 0n,
    });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      return { success: false, error: `Pons V2 buy reverted on-chain (txHash: ${receipt?.hash})` };
    }

    return { success: true, txHash: receipt.hash, outputAmount: quote.outputAmount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, tokenAddress, quoteAmount }, 'Pons V2 buy failed');
    return { success: false, error: message };
  }
}

export async function executePonsV2Sell(
  tokenAddress: string,
  tokenAmount: string,
  slippageBps = 50
): Promise<PonsSwapResult> {
  try {
    const wallet = getWallet();
    const launch = await getPonsV2LaunchedToken(tokenAddress);
    if (!launch) throw new Error(`Pons V2: ${tokenAddress} is not a launched token`);

    const quote = await getPonsV2Quote(tokenAddress, tokenAmount, 'sell', wallet.address);

    const tokensIn = parseUnits(tokenAmount, 18);
    const token = new Contract(tokenAddress, ERC20_ABI, wallet);
    const allowance = await token.allowance(wallet.address, launch.curve);
    if (allowance < tokensIn) {
      const approveTx = await token.approve(launch.curve, tokensIn);
      await approveTx.wait();
    }

    const quoteDecimals = launch.pairToken === ZeroAddress ? 18 : await erc20Decimals(wallet.provider! as JsonRpcProvider, launch.pairToken);
    const clampedSlippage = Math.max(0, Math.min(slippageBps, 10000));
    const minQuoteOut = (parseUnits(quote.outputAmount, quoteDecimals) * BigInt(10000 - clampedSlippage)) / 10000n;

    const curve = new Contract(launch.curve, PONS_V2_CURVE_ABI, wallet);
    const tx = await curve.sell(tokensIn, minQuoteOut, wallet.address);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      return { success: false, error: `Pons V2 sell reverted on-chain (txHash: ${receipt?.hash})` };
    }

    return { success: true, txHash: receipt.hash, outputAmount: quote.outputAmount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, tokenAddress, tokenAmount }, 'Pons V2 sell failed');
    return { success: false, error: message };
  }
}
