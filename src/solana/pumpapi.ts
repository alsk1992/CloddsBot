import { Connection, Keypair, PublicKey, AccountInfo } from '@solana/web3.js';
import { signAndSendVersionedTransaction } from './wallet';
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
 */
export function calculateBuyQuote(
  state: BondingCurveState,
  solAmount: BN,
  feeBps: number = 100 // 1% default fee
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
 */
export function calculateSellQuote(
  state: BondingCurveState,
  tokenAmount: BN,
  feeBps: number = 100 // 1% default fee
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
// Trading via PumpPortal
// ============================================================================

/**
 * Execute a trade on Pump.fun via PumpPortal API
 */
export async function executePumpFunTrade(
  connection: Connection,
  keypair: Keypair,
  params: PumpFunTradeParams
): Promise<PumpFunTradeResult> {
  const endpoint = process.env.PUMPFUN_LOCAL_TX_URL || 'https://pumpportal.fun/api/trade-local';

  const body = {
    publicKey: keypair.publicKey.toBase58(),
    action: params.action,
    mint: params.mint,
    amount: params.amount,
    denominatedInSol: params.denominatedInSol ? 'true' : 'false',
    slippage: params.slippageBps !== undefined ? params.slippageBps / 100 : 1,
    priorityFee: params.priorityFeeLamports !== undefined
      ? params.priorityFeeLamports / 1_000_000_000
      : undefined,
    pool: params.pool || 'pump',
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Pump.fun trade-local error: ${response.status}${errorText ? ` - ${errorText}` : ''}`);
  }

  const txBytes = new Uint8Array(await response.arrayBuffer());
  const signature = await signAndSendVersionedTransaction(connection, keypair, txBytes);

  return { signature, endpoint };
}

// ============================================================================
// Quote via PumpPortal
// ============================================================================

export interface PumpPortalQuote {
  inputAmount: string;
  outputAmount: string;
  fee: string;
  priceImpact: number;
}

/**
 * Get a swap quote from PumpPortal
 */
export async function getPumpPortalQuote(params: {
  mint: string;
  action: 'buy' | 'sell';
  amount: string;
  pool?: string;
}): Promise<PumpPortalQuote | null> {
  try {
    const endpoint = `https://pumpportal.fun/api/quote?mint=${params.mint}&action=${params.action}&amount=${params.amount}&pool=${params.pool || 'pump'}`;
    const response = await fetch(endpoint);

    if (!response.ok) {
      return null;
    }

    return await response.json() as PumpPortalQuote;
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
    const { TOKEN_PROGRAM_ID } = await import('@solana/spl-token');

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
    const { TOKEN_PROGRAM_ID } = await import('@solana/spl-token');

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
