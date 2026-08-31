import {
  Connection,
  Keypair,
  PublicKey,
  AccountInfo,
  ComputeBudgetProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import * as SplToken from '@solana/spl-token';
const TOKEN_PROGRAM_ID = SplToken.TOKEN_PROGRAM_ID;
// Neither a named import nor a namespace property access for
// TOKEN_2022_PROGRAM_ID typechecks here — this project's huge Solana
// dependency tree pulls in many conflicting nested copies of
// @solana/spl-token (0.1.8 through 0.4.15, some pre-dating Token-2022) and
// TS ends up resolving this file's reference against one that lacks it,
// even though --traceResolution confirms the real top-level import
// resolves to the current 0.4.15 copy that does have it. The Token-2022
// program ID is a fixed, immutable Solana program address (never
// changes) — hardcoding it sidesteps the resolver conflict entirely and
// matches this same file's existing pattern of hardcoding other
// well-known program IDs (see getBondingCurveTokenAccount below).
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
import {
  PumpSdk,
  OnlinePumpSdk,
  getBuyTokenAmountFromSolAmount,
  getBuySolAmountFromTokenAmount,
  getSellSolAmountFromTokenAmount,
} from '@pump-fun/pump-sdk';
import { signAndSendTransaction } from './wallet';
import BN from 'bn.js';

// ============================================================================
// Constants
// ============================================================================

/** Pump.fun main program ID */
export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

/** Pump.fun Mayhem program ID (Token2022 support) */
export const PUMP_MAYHEM_PROGRAM_ID = new PublicKey('MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e');

/** Bonding curve IDL discriminator - first 8 bytes to verify account type */
const BONDING_CURVE_DISCRIMINATOR = Buffer.from([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]);

/** Token decimals for Pump.fun tokens (always 6) */
const TOKEN_DECIMALS = 6;

/** SOL decimals */
const SOL_DECIMALS = 9;

/** Total supply of all pump.fun tokens (1 billion with 6 decimals) */
const TOTAL_SUPPLY = 1_000_000_000 * (10 ** TOKEN_DECIMALS);

/** Tokens available for bonding (about 800 million) */
const BONDING_SUPPLY = 800_000_000 * (10 ** TOKEN_DECIMALS);

// ============================================================================
// Types
// ============================================================================

export interface PumpFunTradeParams {
  mint: string;
  action: 'buy' | 'sell';
  amount: number | string;
  denominatedInSol: boolean;
  slippageBps?: number;
  priorityFeeLamports?: number;
  pool?: string;
}

export interface PumpFunTradeResult {
  signature: string;
  endpoint: string;
}

export interface BondingCurveState {
  /** Virtual token reserves (used for price calculation) */
  virtualTokenReserves: BN;
  /** Virtual SOL reserves (used for price calculation) */
  virtualSolReserves: BN;
  /** Real token reserves (actual tokens in curve) */
  realTokenReserves: BN;
  /** Real SOL reserves (actual SOL in curve) */
  realSolReserves: BN;
  /** Total tokens bought from the curve */
  tokenTotalSupply: BN;
  /** Whether the bonding curve is complete (graduated) */
  complete: boolean;
  /** Whether this is a mayhem mode token (Token2022) */
  isMayhemMode?: boolean;
}

export interface TokenPriceInfo {
  /** Price per token in SOL */
  priceInSol: number;
  /** Price per token in USD (if SOL price provided) */
  priceInUsd?: number;
  /** Market cap in SOL */
  marketCapSol: number;
  /** Market cap in USD (if SOL price provided) */
  marketCapUsd?: number;
  /** Bonding curve progress (0-1) */
  bondingProgress: number;
  /** Whether token has graduated to PumpSwap */
  graduated: boolean;
  /** Real SOL in the bonding curve */
  liquiditySol: number;
  /** Tokens remaining in curve */
  tokensRemaining: number;
}

export interface BuyQuote {
  /** Tokens you'll receive */
  tokensOut: BN;
  /** SOL cost including fee */
  solCost: BN;
  /** Fee amount in SOL */
  fee: BN;
  /** Price impact percentage */
  priceImpact: number;
  /** New price after purchase */
  newPrice: number;
}

export interface SellQuote {
  /** SOL you'll receive */
  solOut: BN;
  /** Fee amount in SOL */
  fee: BN;
  /** Price impact percentage */
  priceImpact: number;
  /** New price after sale */
  newPrice: number;
}

// ============================================================================
// Bonding Curve Address Derivation
// ============================================================================

/**
 * Derive the bonding curve PDA for a token mint
 */
export function getBondingCurveAddress(
  mint: PublicKey,
  programId: PublicKey = PUMP_PROGRAM_ID
): PublicKey {
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    programId
  );
  return bondingCurve;
}

/**
 * Derive the associated bonding curve token account
 */
export function getBondingCurveTokenAccount(
  mint: PublicKey,
  programId: PublicKey = PUMP_PROGRAM_ID
): PublicKey {
  const bondingCurve = getBondingCurveAddress(mint, programId);
  const [tokenAccount] = PublicKey.findProgramAddressSync(
    [
      bondingCurve.toBuffer(),
      new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(),
      mint.toBuffer(),
    ],
    new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
  );
  return tokenAccount;
}

// ============================================================================
// On-Chain State Parsing
// ============================================================================

/**
 * Parse bonding curve account data
 */
export function parseBondingCurveState(data: Buffer): BondingCurveState | null {
  // Verify discriminator
  if (!data.subarray(0, 8).equals(BONDING_CURVE_DISCRIMINATOR)) {
    return null;
  }

  // Account can be 81, 82, or 244 bytes depending on version
  if (data.length < 81) {
    return null;
  }

  // Parse reserves (all 8-byte little-endian u64)
  const virtualTokenReserves = new BN(data.subarray(8, 16), 'le');
  const virtualSolReserves = new BN(data.subarray(16, 24), 'le');
  const realTokenReserves = new BN(data.subarray(24, 32), 'le');
  const realSolReserves = new BN(data.subarray(32, 40), 'le');
  const tokenTotalSupply = new BN(data.subarray(40, 48), 'le');
  const complete = data[48] === 1;

  // Check for mayhem mode flag (byte 81 in extended accounts)
  let isMayhemMode = false;
  if (data.length >= 82) {
    isMayhemMode = data[81] === 1;
  }

  return {
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    realSolReserves,
    tokenTotalSupply,
    complete,
    isMayhemMode,
  };
}

/**
 * Fetch and parse bonding curve state from chain
 */
export async function getBondingCurveState(
  connection: Connection,
  mint: PublicKey | string
): Promise<BondingCurveState | null> {
  const mintPubkey = typeof mint === 'string' ? new PublicKey(mint) : mint;

  // Try main program first
  let bondingCurve = getBondingCurveAddress(mintPubkey, PUMP_PROGRAM_ID);
  let accountInfo = await connection.getAccountInfo(bondingCurve);

  // If not found, try Mayhem program
  if (!accountInfo) {
    bondingCurve = getBondingCurveAddress(mintPubkey, PUMP_MAYHEM_PROGRAM_ID);
    accountInfo = await connection.getAccountInfo(bondingCurve);
  }

  if (!accountInfo) {
    return null;
  }

  return parseBondingCurveState(accountInfo.data as Buffer);
}

// ============================================================================
// Price Calculations
// ============================================================================

/**
 * Calculate current token price from bonding curve state
 */
export function calculatePrice(state: BondingCurveState): number {
  if (state.virtualTokenReserves.isZero()) {
    return 0;
  }

  const virtualSol = state.virtualSolReserves.toNumber() / (10 ** SOL_DECIMALS);
  const virtualTokens = state.virtualTokenReserves.toNumber() / (10 ** TOKEN_DECIMALS);

  return virtualSol / virtualTokens;
}

/**
 * Calculate bonding curve progress (0-1)
 */
export function calculateBondingProgress(state: BondingCurveState): number {
  if (state.complete) return 1;

  // Progress = tokens sold / tokens available for bonding
  const tokensSold = BONDING_SUPPLY - state.realTokenReserves.toNumber();
  return Math.min(1, Math.max(0, tokensSold / BONDING_SUPPLY));
}

/**
 * Get comprehensive price info for a token
 */
export async function getTokenPriceInfo(
  connection: Connection,
  mint: PublicKey | string,
  solPriceUsd?: number
): Promise<TokenPriceInfo | null> {
  const state = await getBondingCurveState(connection, mint);
  if (!state) return null;

  const priceInSol = calculatePrice(state);
  const bondingProgress = calculateBondingProgress(state);
  const liquiditySol = state.realSolReserves.toNumber() / (10 ** SOL_DECIMALS);
  const tokensRemaining = state.realTokenReserves.toNumber() / (10 ** TOKEN_DECIMALS);

  // Market cap = total supply * price
  const totalSupplyTokens = TOTAL_SUPPLY / (10 ** TOKEN_DECIMALS);
  const marketCapSol = totalSupplyTokens * priceInSol;

  return {
    priceInSol,
    priceInUsd: solPriceUsd ? priceInSol * solPriceUsd : undefined,
    marketCapSol,
    marketCapUsd: solPriceUsd ? marketCapSol * solPriceUsd : undefined,
    bondingProgress,
    graduated: state.complete,
    liquiditySol,
    tokensRemaining,
  };
}

/**
 * Calculate buy quote - how many tokens for X SOL
 *
 * Offline flat-rate estimate only (no RPC round-trip) — pump.fun's real fee
 * is market-cap-tiered, not a flat rate, and can vary per token. Measured
 * live at 100bps total (95bps protocol + 5bps creator) for one real token
 * during development, but do not treat that as a fixed constant either.
 * getPumpFunQuote / buildPumpFunTradeInstructions in this same file
 * compute the actual fee-tier-aware quote via the official SDK and are what
 * actual trade execution relies on — use this only for a fast
 * instant-display estimate where an RPC call isn't worth the latency.
 */
export function calculateBuyQuote(
  state: BondingCurveState,
  solAmount: BN,
  feeBps: number = 100
): BuyQuote {
  const fee = solAmount.muln(feeBps).divn(10000);
  const solAfterFee = solAmount.sub(fee);

  // Constant product formula: k = virtualSol * virtualToken
  // After buy: (virtualSol + solIn) * (virtualToken - tokensOut) = k
  // tokensOut = virtualToken - k / (virtualSol + solIn)
  // tokensOut = virtualToken * solIn / (virtualSol + solIn)

  const tokensOut = state.virtualTokenReserves
    .mul(solAfterFee)
    .div(state.virtualSolReserves.add(solAfterFee));

  // Calculate new price after purchase
  const newVirtualSol = state.virtualSolReserves.add(solAfterFee);
  const newVirtualToken = state.virtualTokenReserves.sub(tokensOut);
  const newPrice = newVirtualSol.toNumber() / newVirtualToken.toNumber() / (10 ** (SOL_DECIMALS - TOKEN_DECIMALS));

  const currentPrice = calculatePrice(state);
  const priceImpact = ((newPrice - currentPrice) / currentPrice) * 100;

  return {
    tokensOut,
    solCost: solAmount,
    fee,
    priceImpact,
    newPrice,
  };
}

/**
 * Calculate sell quote - how much SOL for X tokens
 *
 * See calculateBuyQuote — same offline flat-rate-estimate caveat applies.
 */
export function calculateSellQuote(
  state: BondingCurveState,
  tokenAmount: BN,
  feeBps: number = 100
): SellQuote {
  // Constant product formula
  // solOut = virtualSol * tokensIn / (virtualToken + tokensIn)

  const solBeforeFee = state.virtualSolReserves
    .mul(tokenAmount)
    .div(state.virtualTokenReserves.add(tokenAmount));

  const fee = solBeforeFee.muln(feeBps).divn(10000);
  const solOut = solBeforeFee.sub(fee);

  // Calculate new price after sale
  const newVirtualSol = state.virtualSolReserves.sub(solBeforeFee);
  const newVirtualToken = state.virtualTokenReserves.add(tokenAmount);
  const newPrice = newVirtualSol.toNumber() / newVirtualToken.toNumber() / (10 ** (SOL_DECIMALS - TOKEN_DECIMALS));

  const currentPrice = calculatePrice(state);
  const priceImpact = ((currentPrice - newPrice) / currentPrice) * 100;

  return {
    solOut,
    fee,
    priceImpact,
    newPrice,
  };
}

/**
 * Calculate how much SOL needed to buy X tokens
 */
export function calculateSolForTokens(
  state: BondingCurveState,
  tokenAmount: BN,
  feeBps: number = 100
): BN {
  // Guard: cannot buy more tokens than the virtual reserve holds
  if (tokenAmount.gte(state.virtualTokenReserves)) {
    throw new Error('tokenAmount exceeds virtualTokenReserves — not enough liquidity');
  }

  // Rearranged from buy formula:
  // solIn = virtualSol * tokensOut / (virtualToken - tokensOut)
  const solBeforeFee = state.virtualSolReserves
    .mul(tokenAmount)
    .div(state.virtualTokenReserves.sub(tokenAmount));

  // Add fee
  return solBeforeFee.muln(10000).divn(10000 - feeBps);
}

// ============================================================================
// Trading via the official @pump-fun/pump-sdk
// ============================================================================
//
// Builds and signs bonding-curve buy/sell instructions entirely locally
// against the on-chain Pump program — no third-party relay API is
// involved in constructing or relaying the transaction. Verified against
// live mainnet during development: fetches the real Global/FeeConfig
// accounts (fee-tier-aware, not a hardcoded flat rate), detects Token-2022
// vs classic SPL per-mint (newer/Mayhem-mode tokens use Token-2022), and
// produces the exact same instruction shape the protocol's own SDK ships
// with test coverage for.

const ONE_BILLION_SUPPLY = new BN(TOTAL_SUPPLY);

async function detectTokenProgram(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) {
    throw new Error(`Pump.fun: mint account not found: ${mint.toBase58()}`);
  }
  return info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

/**
 * PumpPortal's `pool` param used to route trades across other DEXes
 * entirely (raydium, launchlab, raydium-cpmm, bonk) via its own
 * aggregation, not just Pump's bonding curve — a caller passing
 * pool: 'raydium' actually traded on Raydium through PumpPortal's relay.
 * This codebase's local instruction builder only knows the Pump bonding
 * curve program (and, separately, PumpSwap for graduated tokens via
 * pumpswap.ts) — it has no equivalent multi-DEX routing. Silently
 * ignoring an unsupported pool value would execute a materially
 * different trade than requested, so this fails loudly instead. Use the
 * dedicated raydium.ts/meteora.ts/etc. integrations directly for
 * non-Pump.fun DEXes.
 */
export function assertSupportedPumpPool(pool: string | undefined): void {
  if (pool !== undefined && pool !== 'pump' && pool !== 'auto') {
    throw new Error(
      `Pump.fun: pool "${pool}" is not supported here — this codebase trades directly against the Pump bonding curve program (and PumpSwap for graduated tokens via pumpswap.ts/PumpSwapBuilder), not through a multi-DEX relay. ` +
      'For raydium/launchlab/raydium-cpmm/bonk, use the dedicated integration for that DEX instead.'
    );
  }
}

export interface PumpFunTradeInstructionsResult {
  instructions: TransactionInstruction[];
  /** Token amount in raw units (6dp) actually used to build the instruction. */
  amount: BN;
  /** SOL amount in lamports actually used to build the instruction (pre-slippage). */
  solAmount: BN;
  tokenProgram: PublicKey;
}

/**
 * Build real Pump bonding-curve buy/sell instructions locally. Shared by
 * both the single-wallet path (executePumpFunTrade below) and the swarm
 * path (PumpFunBuilder in swarm-builders.ts) so the SDK plumbing — token
 * program detection, Global/FeeConfig/BondingCurve fetch, quote math,
 * graduated-token guard — lives in exactly one place.
 */
export async function buildPumpFunTradeInstructions(
  connection: Connection,
  user: PublicKey,
  params: {
    mint: string;
    action: 'buy' | 'sell';
    amount: number | string;
    denominatedInSol: boolean;
    /** Percentage, e.g. 1 = 1% (this is the SDK's own convention — NOT basis points). */
    slippagePercent?: number;
  }
): Promise<PumpFunTradeInstructionsResult> {
  const mint = new PublicKey(params.mint);
  const tokenProgram = await detectTokenProgram(connection, mint);
  const slippage = params.slippagePercent ?? 1;
  const rawAmount = Number(params.amount);

  const onlineSdk = new OnlinePumpSdk(connection);
  const pumpSdk = new PumpSdk();

  const [global, feeConfig] = await Promise.all([
    onlineSdk.fetchGlobal(),
    onlineSdk.fetchFeeConfig().catch(() => null),
  ]);

  if (params.action === 'buy') {
    const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
      await onlineSdk.fetchBuyState(mint, user, tokenProgram);

    if (bondingCurve.complete) {
      throw new Error(`Pump.fun: ${params.mint} has graduated to PumpSwap — bonding-curve buy is no longer available for this token`);
    }

    const mintSupply = bondingCurve.isMayhemMode ? global.tokenTotalSupply : ONE_BILLION_SUPPLY;

    let solAmount: BN;
    let amount: BN;
    if (params.denominatedInSol) {
      solAmount = new BN(Math.floor(rawAmount * 1e9));
      amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply, bondingCurve, amount: solAmount, quoteMint: PublicKey.default });
    } else {
      amount = new BN(Math.floor(rawAmount * 10 ** TOKEN_DECIMALS));
      solAmount = getBuySolAmountFromTokenAmount({ global, feeConfig, mintSupply, bondingCurve, amount, quoteMint: PublicKey.default });
    }

    const instructions = await pumpSdk.buyInstructions({
      global, bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo,
      mint, user, amount, solAmount, slippage, tokenProgram,
    });

    return { instructions, amount, solAmount, tokenProgram };
  }

  // sell
  if (params.denominatedInSol) {
    // The protocol's sell instruction is always token-amount-denominated;
    // there's no on-chain-supported "sell enough tokens to net exactly X
    // SOL" and the SDK doesn't expose an inverse quote for it either.
    // Every real caller in this codebase sells with denominatedInSol:
    // false — fail clearly here instead of guessing a conversion.
    throw new Error('Pump.fun: sell amount must be denominated in tokens (denominatedInSol: false), not SOL');
  }

  const { bondingCurveAccountInfo, bondingCurve } = await onlineSdk.fetchSellState(mint, user, tokenProgram);

  if (bondingCurve.complete) {
    throw new Error(`Pump.fun: ${params.mint} has graduated to PumpSwap — bonding-curve sell is no longer available for this token`);
  }

  const mintSupply = bondingCurve.isMayhemMode ? global.tokenTotalSupply : ONE_BILLION_SUPPLY;
  const amount = new BN(Math.floor(rawAmount * 10 ** TOKEN_DECIMALS));
  const solAmount = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply, bondingCurve, amount });

  const instructions = await pumpSdk.sellInstructions({
    global, bondingCurveAccountInfo, bondingCurve, mint, user, amount, solAmount, slippage,
    tokenProgram, mayhemMode: bondingCurve.isMayhemMode,
  });

  return { instructions, amount, solAmount, tokenProgram };
}

/**
 * Execute a trade on Pump.fun: builds real bonding-curve instructions
 * locally via buildPumpFunTradeInstructions, then signs and sends directly.
 */
export async function executePumpFunTrade(
  connection: Connection,
  keypair: Keypair,
  params: PumpFunTradeParams
): Promise<PumpFunTradeResult> {
  assertSupportedPumpPool(params.pool);

  const { instructions, solAmount } = await buildPumpFunTradeInstructions(connection, keypair.publicKey, {
    mint: params.mint,
    action: params.action,
    amount: params.amount,
    denominatedInSol: params.denominatedInSol,
    slippagePercent: params.slippageBps !== undefined ? params.slippageBps / 100 : undefined,
  });

  const allInstructions = [...instructions];
  if (params.priorityFeeLamports) {
    const computeUnitLimit = 200_000;
    const microLamports = Math.max(1, Math.floor((params.priorityFeeLamports * 1_000_000) / computeUnitLimit));
    allInstructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
    );
  }

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: blockhash,
    instructions: allInstructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);

  const signature = await signAndSendTransaction(connection, keypair, tx);

  return { signature, endpoint: `local:@pump-fun/pump-sdk (${params.action} ${solAmount.toString()} lamports-equiv)` };
}

// ============================================================================
// Local quote
// ============================================================================

export interface PumpFunQuote {
  inputAmount: string;
  outputAmount: string;
  fee: string;
  priceImpact: number;
}

/**
 * Get a buy/sell quote computed locally via the official SDK's fee-tier-aware
 * bonding-curve math (no network call to any third-party quote API).
 */
export async function getPumpFunQuote(params: {
  mint: string;
  action: 'buy' | 'sell';
  amount: string;
  pool?: string;
  connection?: Connection;
}): Promise<PumpFunQuote | null> {
  try {
    assertSupportedPumpPool(params.pool);
    const connection = params.connection ?? new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
    const mint = new PublicKey(params.mint);
    const tokenProgram = await detectTokenProgram(connection, mint);
    const onlineSdk = new OnlinePumpSdk(connection);

    const [global, feeConfig] = await Promise.all([
      onlineSdk.fetchGlobal(),
      onlineSdk.fetchFeeConfig().catch(() => null),
    ]);

    // A throwaway pubkey is fine here — fetchBuyState/fetchSellState only
    // use `user` to derive the caller's own (irrelevant-to-the-quote) ATA.
    const probeUser = PublicKey.default;
    const rawAmount = Number(params.amount);

    if (params.action === 'buy') {
      const { bondingCurve } = await onlineSdk.fetchBuyState(mint, probeUser, tokenProgram);
      const mintSupply = bondingCurve.isMayhemMode ? global.tokenTotalSupply : ONE_BILLION_SUPPLY;
      const solAmount = new BN(Math.floor(rawAmount * 1e9));
      const tokensOut = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply, bondingCurve, amount: solAmount, quoteMint: PublicKey.default });
      // Informational only — the protocol's real fee-tier lookup (used above
      // via feeConfig) isn't exposed as a standalone breakout by the public
      // SDK API, so this is the flat global rate as an approximation.
      // outputAmount itself is exact; this field is display-only.
      const flatFeeBps = global.feeBasisPoints.add(global.creatorFeeBasisPoints);
      const approxFee = solAmount.mul(flatFeeBps).divn(10_000);
      return {
        inputAmount: solAmount.toString(),
        outputAmount: tokensOut.toString(),
        fee: approxFee.toString(),
        priceImpact: 0,
      };
    }

    // fetchBuyState (not fetchSellState) is used here even for a sell quote:
    // it returns the same bondingCurve data without fetchSellState's extra
    // "associated token account must already exist" requirement, which a
    // throwaway probe address would never satisfy.
    const { bondingCurve } = await onlineSdk.fetchBuyState(mint, probeUser, tokenProgram);
    const mintSupply = bondingCurve.isMayhemMode ? global.tokenTotalSupply : ONE_BILLION_SUPPLY;
    const amount = new BN(Math.floor(rawAmount * 10 ** TOKEN_DECIMALS));
    const solOut = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply, bondingCurve, amount });
    // Same informational-approximation caveat as the buy branch above.
    const flatFeeBps = global.feeBasisPoints.add(global.creatorFeeBasisPoints);
    const grossApprox = solOut.muln(10_000).div(new BN(10_000).sub(flatFeeBps));
    const approxFee = BN.max(grossApprox.sub(solOut), new BN(0));
    return {
      inputAmount: amount.toString(),
      outputAmount: solOut.toString(),
      fee: approxFee.toString(),
      priceImpact: 0,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Token Info from Pump.fun API
// ============================================================================

export interface PumpTokenInfo {
  mint: string;
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  creator?: string;
  createdTimestamp?: number;
  pumpswapPool?: string;
  complete: boolean;
  virtualSolReserves?: number;
  virtualTokenReserves?: number;
  bondingCurve?: string;
  associatedBondingCurve?: string;
  marketCap?: number;
  usdMarketCap?: number;
}

/**
 * Fetch token info from Pump.fun frontend API
 */
export async function getTokenInfo(mint: string): Promise<PumpTokenInfo | null> {
  try {
    const response = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}?sync=true`, {
      headers: {
        'Accept': 'application/json',
        'Origin': 'https://pump.fun',
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json() as PumpTokenInfo;
  } catch {
    return null;
  }
}

// ============================================================================
// Graduation Check
// ============================================================================

/**
 * Check if a token has graduated to PumpSwap
 */
export async function isGraduated(
  connection: Connection,
  mint: PublicKey | string
): Promise<{ graduated: boolean; pumpswapPool?: string }> {
  const state = await getBondingCurveState(connection, mint);

  if (state?.complete) {
    // Try to get PumpSwap pool from API
    const mintStr = typeof mint === 'string' ? mint : mint.toBase58();
    const info = await getTokenInfo(mintStr);
    return {
      graduated: true,
      pumpswapPool: info?.pumpswapPool,
    };
  }

  return { graduated: false };
}

// ============================================================================
// Market Cap Calculation
// ============================================================================

/**
 * Calculate market cap for a pump.fun token
 * All pump.fun tokens have 1 billion supply
 */
export function calculateMarketCap(priceInSol: number, solPriceUsd?: number): {
  marketCapSol: number;
  marketCapUsd?: number;
} {
  const totalSupply = 1_000_000_000; // 1 billion tokens
  const marketCapSol = totalSupply * priceInSol;

  return {
    marketCapSol,
    marketCapUsd: solPriceUsd ? marketCapSol * solPriceUsd : undefined,
  };
}

// ============================================================================
// Token Balance
// ============================================================================

export interface TokenBalance {
  mint: string;
  balance: number;
  balanceRaw: string;
  decimals: number;
}

/**
 * Get token balance for a wallet
 */
export async function getTokenBalance(
  connection: Connection,
  owner: PublicKey | string,
  mint: PublicKey | string
): Promise<TokenBalance | null> {
  const ownerPubkey = typeof owner === 'string' ? new PublicKey(owner) : owner;
  const mintPubkey = typeof mint === 'string' ? new PublicKey(mint) : mint;

  try {
    // Find ATA
    const [ata] = PublicKey.findProgramAddressSync(
      [
        ownerPubkey.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mintPubkey.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );

    const accountInfo = await connection.getAccountInfo(ata);
    if (!accountInfo) {
      return null;
    }

    // Parse token account data (SPL Token layout)
    const data = accountInfo.data;
    const amount = new BN(data.subarray(64, 72), 'le');

    return {
      mint: mintPubkey.toBase58(),
      balance: amount.toNumber() / (10 ** TOKEN_DECIMALS),
      balanceRaw: amount.toString(),
      decimals: TOKEN_DECIMALS,
    };
  } catch {
    return null;
  }
}

/**
 * Get all Pump.fun token holdings for a wallet
 * Returns tokens with non-zero balances
 */
export async function getUserPumpTokens(
  connection: Connection,
  owner: PublicKey | string
): Promise<TokenBalance[]> {
  const ownerPubkey = typeof owner === 'string' ? new PublicKey(owner) : owner;

  try {
    // Get all token accounts for the wallet
    const tokenAccounts = await connection.getTokenAccountsByOwner(ownerPubkey, {
      programId: TOKEN_PROGRAM_ID,
    });

    const balances: TokenBalance[] = [];

    for (const { account } of tokenAccounts.value) {
      const data = account.data;
      const mint = new PublicKey(data.subarray(0, 32));
      const amount = new BN(data.subarray(64, 72), 'le');

      if (amount.isZero()) continue;

      // Check if this is a pump.fun token by verifying bonding curve exists
      const bondingCurve = getBondingCurveAddress(mint, PUMP_PROGRAM_ID);
      const bondingAccount = await connection.getAccountInfo(bondingCurve);

      // Also check Mayhem program
      if (!bondingAccount) {
        const mayhemBondingCurve = getBondingCurveAddress(mint, PUMP_MAYHEM_PROGRAM_ID);
        const mayhemAccount = await connection.getAccountInfo(mayhemBondingCurve);
        if (!mayhemAccount) continue; // Not a pump.fun token
      }

      balances.push({
        mint: mint.toBase58(),
        balance: amount.toNumber() / (10 ** TOKEN_DECIMALS),
        balanceRaw: amount.toString(),
        decimals: TOKEN_DECIMALS,
      });
    }

    return balances;
  } catch {
    return [];
  }
}

// ============================================================================
// Smart Routing
// ============================================================================

/**
 * Determine best execution venue for a token
 * Returns 'pump' for active bonding curve, 'pump-amm' (PumpSwap) for graduated tokens
 */
export async function getBestPool(
  connection: Connection,
  mint: PublicKey | string
): Promise<{ pool: 'pump' | 'pump-amm'; pumpswapPool?: string }> {
  const graduation = await isGraduated(connection, mint);

  if (graduation.graduated) {
    return { pool: 'pump-amm', pumpswapPool: graduation.pumpswapPool };
  }

  return { pool: 'pump' };
}
