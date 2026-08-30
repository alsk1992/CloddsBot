import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { signAndSendTransaction } from './wallet.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// ============================================
// Types
// ============================================

export interface DbcConfigParams {
  quoteMint?: string;
  initialMarketCap?: number;
  migrationMarketCap?: number;
  totalTokenSupply?: number;
  tokenDecimals?: number;
  migrationOption?: number;
  startingFeeBps?: number;
  endingFeeBps?: number;
  feeDecayPeriods?: number;
  feeDecayDurationSec?: number;
  dynamicFeeEnabled?: boolean;
  creatorTradingFeePercent?: number;
  feeClaimer?: string;
  leftoverReceiver?: string;
  partnerLiquidityPct?: number;
  creatorLiquidityPct?: number;
  partnerLockedPct?: number;
  creatorLockedPct?: number;
  tokenType?: number;
  collectFeeMode?: number;
  migrationFeeOption?: number;
  migrationFeePercentage?: number;
  creatorMigrationFeePercentage?: number;
  poolCreationFee?: number;
}

export interface DbcPoolParams {
  configAddress?: string;
  name: string;
  symbol: string;
  uri: string;
  config?: DbcConfigParams;
}

export interface DbcPoolStatus {
  found: boolean;
  poolAddress: string;
  baseMint: string;
  configAddress: string;
  creator: string;
  isMigrated: boolean;
  quoteReserve: string;
  migrationThreshold: string;
  progressPercent: string;
  fees: {
    creatorBase: string;
    creatorQuote: string;
    partnerBase: string;
    partnerQuote: string;
  } | null;
}

export interface DbcSwapParams {
  poolAddress: string;
  amountIn: string;
  minimumAmountOut?: string;
  swapBaseForQuote: boolean;
}

export interface DbcQuote {
  amountIn: string;
  amountOut: string;
  minimumAmountOut: string;
  direction: string;
}

// ============================================
// Helpers
// ============================================

/**
 * String-safe lamport conversion to avoid JS floating-point bugs.
 */
export function toLamports(amount: number | string, decimals: number): BN {
  const str = String(amount);
  const [whole, frac = ''] = str.split('.');
  const padded = frac.padEnd(decimals, '0').slice(0, decimals);
  const raw = (whole + padded).replace(/^0+/, '') || '0';
  return new BN(raw);
}

/**
 * Lazy-load the DBC SDK client.
 */
async function getDbcClient(connection: Connection) {
  const sdk = await import('@meteora-ag/dynamic-bonding-curve-sdk');
  const Client = (sdk as any).DynamicBondingCurveClient || sdk.DynamicBondingCurveClient;
  if (!Client) {
    throw new Error('Meteora DBC SDK not available.');
  }
  return Client.create(connection, 'confirmed');
}

async function getDbcSdk() {
  return await import('@meteora-ag/dynamic-bonding-curve-sdk');
}

// ============================================
// Build config parameters
// ============================================

function buildConfigParams(sdk: any, params: DbcConfigParams) {
  const {
    totalTokenSupply = 1_000_000_000,
    tokenDecimals = 6,
    initialMarketCap = 30,
    migrationMarketCap = 500,
    migrationOption = 1,
    startingFeeBps = 500,
    endingFeeBps = 100,
    feeDecayPeriods = 10,
    feeDecayDurationSec = 3600,
    dynamicFeeEnabled = true,
    creatorTradingFeePercent = 80,
    partnerLiquidityPct = 0,
    creatorLiquidityPct = 5,
    partnerLockedPct = 50,
    creatorLockedPct = 45,
    tokenType = 0,
    collectFeeMode = 0,
    migrationFeeOption = 6,
    migrationFeePercentage = 15,
    creatorMigrationFeePercentage = 50,
    poolCreationFee = 0,
  } = params;

  const TokenDecimal = sdk.TokenDecimal;
  const TokenType = sdk.TokenType;
  const ActivationType = sdk.ActivationType;
  const CollectFeeMode = sdk.CollectFeeMode;
  const MigrationOption = sdk.MigrationOption;
  const MigrationFeeOption = sdk.MigrationFeeOption;
  const BaseFeeMode = sdk.BaseFeeMode;

  const decimalMap: Record<number, number> = { 6: 6, 7: 7, 8: 8, 9: 9 };
  const tokenDecimalEnum = (decimalMap[tokenDecimals] ?? 6) as number;

  const buildCurveWithMarketCap = sdk.buildCurveWithMarketCap;
  if (!buildCurveWithMarketCap) {
    throw new Error('buildCurveWithMarketCap not found in DBC SDK');
  }

  const configParameters = buildCurveWithMarketCap({
    totalTokenSupply,
    tokenType: tokenType === 1 ? TokenType.Token2022 : TokenType.SPL,
    tokenBaseDecimal: tokenDecimalEnum,
    tokenQuoteDecimal: TokenDecimal?.NINE ?? 9,
    tokenUpdateAuthority: 0,
    lockedVestingParams: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    leftover: 0,
    baseFeeParams: {
      baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: {
        startingFeeBps,
        endingFeeBps,
        numberOfPeriod: feeDecayPeriods,
        totalDuration: feeDecayDurationSec,
      },
    },
    dynamicFeeEnabled,
    activationType: ActivationType.Timestamp,
    collectFeeMode: collectFeeMode === 1 ? CollectFeeMode.OutputToken : CollectFeeMode.QuoteToken,
    creatorTradingFeePercentage: creatorTradingFeePercent,
    poolCreationFee,
    migrationOption: migrationOption === 0 ? MigrationOption.MET_DAMM : MigrationOption.MET_DAMM_V2,
    migrationFeeOption: migrationFeeOption === 6 ? MigrationFeeOption.Customizable : migrationFeeOption,
    migrationFee: {
      feePercentage: migrationFeePercentage,
      creatorFeePercentage: creatorMigrationFeePercentage,
    },
    partnerPermanentLockedLiquidityPercentage: partnerLockedPct,
    partnerLiquidityPercentage: partnerLiquidityPct,
    creatorPermanentLockedLiquidityPercentage: creatorLockedPct,
    creatorLiquidityPercentage: creatorLiquidityPct,
    enableFirstSwapWithMinFee: true,
    initialMarketCap,
    migrationMarketCap,
  });

  return configParameters;
}

// ============================================
// Core functions
// ============================================

/**
 * Create a DBC config on-chain.
 */
export async function createDbcConfig(
  connection: Connection,
  keypair: Keypair,
  params: DbcConfigParams
): Promise<{ configAddress: string; signature: string }> {
  const sdk = await getDbcSdk();
  const client = await getDbcClient(connection);
  const configParameters = buildConfigParams(sdk, params);

  const configKeypair = Keypair.generate();
  const quoteMint = new PublicKey(params.quoteMint || SOL_MINT);
  const feeClaimer = new PublicKey(params.feeClaimer || keypair.publicKey.toBase58());
  const leftoverReceiver = new PublicKey(params.leftoverReceiver || keypair.publicKey.toBase58());

  const tx: Transaction = await client.partner.createConfig({
    config: configKeypair.publicKey,
    feeClaimer,
    leftoverReceiver,
    quoteMint,
    payer: keypair.publicKey,
    ...configParameters,
  });

  tx.partialSign(configKeypair);
  const signature = await signAndSendTransaction(connection, keypair, tx);

  return {
    configAddress: configKeypair.publicKey.toBase58(),
    signature,
  };
}

/**
 * Create a DBC pool (token + bonding curve). Creates config if no configAddress given.
 */
export async function createDbcPool(
  connection: Connection,
  keypair: Keypair,
  params: DbcPoolParams
): Promise<{ baseMint: string; poolAddress: string; configAddress: string; signature: string }> {
  const sdk = await getDbcSdk();
  const client = await getDbcClient(connection);

  let configAddress: PublicKey;

  if (params.configAddress) {
    configAddress = new PublicKey(params.configAddress);
  } else {
    // Create config + pool in one flow
    const configParams = params.config || {};
    const configParameters = buildConfigParams(sdk, configParams);

    const configKeypair = Keypair.generate();
    const baseMintKeypair = Keypair.generate();
    const quoteMint = new PublicKey(configParams.quoteMint || SOL_MINT);
    const feeClaimer = new PublicKey(configParams.feeClaimer || keypair.publicKey.toBase58());
    const leftoverReceiver = new PublicKey(configParams.leftoverReceiver || keypair.publicKey.toBase58());

    const tx: Transaction = await client.pool.createConfigAndPool({
      config: configKeypair.publicKey,
      feeClaimer,
      leftoverReceiver,
      quoteMint,
      payer: keypair.publicKey,
      ...configParameters,
      preCreatePoolParam: {
        name: params.name,
        symbol: params.symbol,
        uri: params.uri,
        poolCreator: keypair.publicKey,
        baseMint: baseMintKeypair.publicKey,
      },
    });

    tx.partialSign(configKeypair);
    tx.partialSign(baseMintKeypair);
    const signature = await signAndSendTransaction(connection, keypair, tx);

    // Derive pool address: deriveDbcPoolAddress(quoteMint, baseMint, config) -> PublicKey
    const derivePool = sdk.deriveDbcPoolAddress;
    let poolAddr = '';
    if (derivePool) {
      try {
        const poolPda = derivePool(quoteMint, baseMintKeypair.publicKey, configKeypair.publicKey);
        poolAddr = poolPda.toBase58();
      } catch {
        poolAddr = 'derived-after-confirm';
      }
    }

    return {
      baseMint: baseMintKeypair.publicKey.toBase58(),
      poolAddress: poolAddr,
      configAddress: configKeypair.publicKey.toBase58(),
      signature,
    };
  }

  // Create pool with existing config
  const baseMintKeypair = Keypair.generate();
  const tx: Transaction = await client.pool.createPool({
    name: params.name,
    symbol: params.symbol,
    uri: params.uri,
    payer: keypair.publicKey,
    poolCreator: keypair.publicKey,
    config: configAddress,
    baseMint: baseMintKeypair.publicKey,
  });

  tx.partialSign(baseMintKeypair);
  const signature = await signAndSendTransaction(connection, keypair, tx);

  // Derive pool address
  const configState = await client.state.getPoolConfig(configAddress);
  const quoteMint = configState.quoteMint as PublicKey;
  const derivePool = sdk.deriveDbcPoolAddress;
  let poolAddr = '';
  if (derivePool) {
    try {
      const poolPda = derivePool(quoteMint, baseMintKeypair.publicKey, configAddress);
      poolAddr = poolPda.toBase58();
    } catch {
      poolAddr = 'derived-after-confirm';
    }
  }

  return {
    baseMint: baseMintKeypair.publicKey.toBase58(),
    poolAddress: poolAddr,
    configAddress: configAddress.toBase58(),
    signature,
  };
}

/**
 * Create a DBC pool with an initial buy in a single flow.
 */
export async function createDbcPoolWithFirstBuy(
  connection: Connection,
  keypair: Keypair,
  params: DbcPoolParams & { buyAmountLamports: string }
): Promise<{ baseMint: string; poolAddress: string; configAddress: string; signatures: string[] }> {
  const sdk = await getDbcSdk();
  const client = await getDbcClient(connection);

  const configParams = params.config || {};
  const configParameters = buildConfigParams(sdk, configParams);

  const configKeypair = Keypair.generate();
  const baseMintKeypair = Keypair.generate();
  const quoteMint = new PublicKey(configParams.quoteMint || SOL_MINT);
  const feeClaimer = new PublicKey(configParams.feeClaimer || keypair.publicKey.toBase58());
  const leftoverReceiver = new PublicKey(configParams.leftoverReceiver || keypair.publicKey.toBase58());

  const result = await client.pool.createConfigAndPoolWithFirstBuy({
    config: configKeypair.publicKey,
    feeClaimer,
    leftoverReceiver,
    quoteMint,
    payer: keypair.publicKey,
    ...configParameters,
    preCreatePoolParam: {
      name: params.name,
      symbol: params.symbol,
      uri: params.uri,
      poolCreator: keypair.publicKey,
      baseMint: baseMintKeypair.publicKey,
    },
    firstBuyParam: {
      buyer: keypair.publicKey,
      buyAmount: new BN(params.buyAmountLamports),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    },
  });

  const signatures: string[] = [];

  // Sign and send config tx
  const configTx: Transaction = result.createConfigTx;
  configTx.partialSign(configKeypair);
  const configSig = await signAndSendTransaction(connection, keypair, configTx);
  signatures.push(configSig);

  // Sign and send pool tx
  const poolTx: Transaction = result.createPoolTx;
  poolTx.partialSign(baseMintKeypair);
  const poolSig = await signAndSendTransaction(connection, keypair, poolTx);
  signatures.push(poolSig);

  // Sign and send buy tx if present
  if (result.swapBuyTx) {
    const buySig = await signAndSendTransaction(connection, keypair, result.swapBuyTx);
    signatures.push(buySig);
  }

  const derivePool = sdk.deriveDbcPoolAddress;
  let poolAddr = '';
  if (derivePool) {
    try {
      const poolPda = derivePool(quoteMint, baseMintKeypair.publicKey, configKeypair.publicKey);
      poolAddr = poolPda.toBase58();
    } catch {
      poolAddr = 'derived-after-confirm';
    }
  }

  return {
    baseMint: baseMintKeypair.publicKey.toBase58(),
    poolAddress: poolAddr,
    configAddress: configKeypair.publicKey.toBase58(),
    signatures,
  };
}

/**
 * Check pool status (migration progress, fees).
 */
export async function getDbcPoolStatus(
  connection: Connection,
  baseMint: string
): Promise<DbcPoolStatus> {
  const client = await getDbcClient(connection);

  const poolAccount = await client.state.getPoolByBaseMint(baseMint);
  if (!poolAccount) {
    return {
      found: false,
      poolAddress: '',
      baseMint,
      configAddress: '',
      creator: '',
      isMigrated: false,
      quoteReserve: '0',
      migrationThreshold: '0',
      progressPercent: '0',
      fees: null,
    };
  }

  const poolAddress = poolAccount.publicKey.toBase58();
  const pool = poolAccount.account;
  const configPk = (pool as any).config || (pool as any).poolConfig;

  let progress = 0;
  try {
    progress = await client.state.getPoolCurveProgress(poolAddress);
  } catch { /* pool may not support progress query */ }

  let fees = null;
  try {
    const feeMetrics = await client.state.getPoolFeeMetrics(poolAddress);
    fees = {
      creatorBase: feeMetrics.current.creatorBaseFee.toString(),
      creatorQuote: feeMetrics.current.creatorQuoteFee.toString(),
      partnerBase: feeMetrics.current.partnerBaseFee.toString(),
      partnerQuote: feeMetrics.current.partnerQuoteFee.toString(),
    };
  } catch { /* fee metrics may fail for fresh pools */ }

  const isMigrated = (pool as any).migrated ?? false;
  const quoteReserve = ((pool as any).quoteReserve || (pool as any).totalQuoteReserve || new BN(0)).toString();

  let migrationThreshold = '0';
  try {
    const threshold = await client.state.getPoolMigrationQuoteThreshold(poolAddress);
    migrationThreshold = threshold.toString();
  } catch { /* threshold may not be available */ }

  return {
    found: true,
    poolAddress,
    baseMint,
    configAddress: configPk ? (configPk.toBase58 ? configPk.toBase58() : String(configPk)) : '',
    creator: (pool as any).creator ? ((pool as any).creator.toBase58 ? (pool as any).creator.toBase58() : String((pool as any).creator)) : '',
    isMigrated,
    quoteReserve,
    migrationThreshold,
    progressPercent: (progress * 100).toFixed(2),
    fees,
  };
}

/**
 * Swap on a DBC bonding curve pool.
 */
export async function swapOnDbcPool(
  connection: Connection,
  keypair: Keypair,
  params: DbcSwapParams
): Promise<{ signature: string; direction: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.pool.swap({
    owner: keypair.publicKey,
    pool: new PublicKey(params.poolAddress),
    amountIn: new BN(params.amountIn),
    minimumAmountOut: new BN(params.minimumAmountOut || '0'),
    swapBaseForQuote: params.swapBaseForQuote,
    referralTokenAccount: null,
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return {
    signature,
    direction: params.swapBaseForQuote ? 'SELL (base->quote)' : 'BUY (quote->base)',
  };
}

/**
 * Get swap quote for a DBC pool.
 */
export async function getDbcSwapQuote(
  connection: Connection,
  params: {
    poolAddress: string;
    amountIn: string;
    swapBaseForQuote: boolean;
  }
): Promise<DbcQuote> {
  const sdk = await getDbcSdk();
  const client = await getDbcClient(connection);

  const poolAddress = new PublicKey(params.poolAddress);
  const pool = await client.state.getPool(poolAddress);
  const configPk = (pool as any).config || (pool as any).poolConfig;
  const config = await client.state.getPoolConfig(configPk);

  const getCurrentPointFn = sdk.getCurrentPoint;
  const ActivationType = sdk.ActivationType;
  let currentPoint = new BN(0);
  if (getCurrentPointFn && ActivationType) {
    try {
      currentPoint = await getCurrentPointFn(connection, ActivationType.Timestamp);
    } catch { /* fallback to 0 */ }
  }

  const quoteResult = client.pool.swapQuote({
    virtualPool: pool,
    config,
    swapBaseForQuote: params.swapBaseForQuote,
    amountIn: new BN(params.amountIn),
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    currentPoint,
  });

  return {
    amountIn: params.amountIn,
    amountOut: quoteResult.outputAmount?.toString() || '0',
    minimumAmountOut: quoteResult.minimumAmountOut?.toString() || '0',
    direction: params.swapBaseForQuote ? 'SELL (base->quote)' : 'BUY (quote->base)',
  };
}

/**
 * Claim creator trading fees from a DBC pool.
 */
export async function claimDbcCreatorFees(
  connection: Connection,
  keypair: Keypair,
  poolAddress: string
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const u64Max = new BN('18446744073709551615');
  const tx: Transaction = await client.creator.claimCreatorTradingFee({
    creator: keypair.publicKey,
    payer: keypair.publicKey,
    pool: new PublicKey(poolAddress),
    maxBaseAmount: u64Max,
    maxQuoteAmount: u64Max,
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Claim partner trading fees from a DBC pool.
 */
export async function claimDbcPartnerFees(
  connection: Connection,
  keypair: Keypair,
  poolAddress: string
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const u64Max = new BN('18446744073709551615');
  const tx: Transaction = await client.partner.claimPartnerTradingFee({
    feeClaimer: keypair.publicKey,
    payer: keypair.publicKey,
    pool: new PublicKey(poolAddress),
    maxBaseAmount: u64Max,
    maxQuoteAmount: u64Max,
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

// ============================================
// Migration Service
// ============================================

/**
 * Migrate a DBC pool to DAMM V1.
 */
export async function migrateToDammV1(
  connection: Connection,
  keypair: Keypair,
  params: { poolAddress: string; dammConfig: string }
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.migration.migrateToDammV1({
    payer: keypair.publicKey,
    virtualPool: new PublicKey(params.poolAddress),
    dammConfig: new PublicKey(params.dammConfig),
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Migrate a DBC pool to DAMM V2.
 */
export async function migrateToDammV2(
  connection: Connection,
  keypair: Keypair,
  params: { poolAddress: string; dammConfig: string }
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const result = await client.migration.migrateToDammV2({
    payer: keypair.publicKey,
    virtualPool: new PublicKey(params.poolAddress),
    dammConfig: new PublicKey(params.dammConfig),
  });

  const tx = result.transaction;
  tx.partialSign(result.firstPositionNftKeypair);
  tx.partialSign(result.secondPositionNftKeypair);
  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Create a locker for locked vesting after migration.
 */
export async function createDbcLocker(
  connection: Connection,
  keypair: Keypair,
  poolAddress: string
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.migration.createLocker({
    payer: keypair.publicKey,
    virtualPool: new PublicKey(poolAddress),
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Lock DAMM V1 LP token for creator or partner.
 */
export async function lockDammV1LpToken(
  connection: Connection,
  keypair: Keypair,
  params: { poolAddress: string; dammConfig: string; isPartner: boolean }
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.migration.lockDammV1LpToken({
    payer: keypair.publicKey,
    virtualPool: new PublicKey(params.poolAddress),
    dammConfig: new PublicKey(params.dammConfig),
    isPartner: params.isPartner,
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Claim DAMM V1 LP token for creator or partner.
 */
export async function claimDammV1LpToken(
  connection: Connection,
  keypair: Keypair,
  params: { poolAddress: string; dammConfig: string; isPartner: boolean }
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.migration.claimDammV1LpToken({
    payer: keypair.publicKey,
    virtualPool: new PublicKey(params.poolAddress),
    dammConfig: new PublicKey(params.dammConfig),
    isPartner: params.isPartner,
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Withdraw leftover tokens after migration.
 */
export async function withdrawLeftover(
  connection: Connection,
  keypair: Keypair,
  poolAddress: string
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.migration.withdrawLeftover({
    payer: keypair.publicKey,
    virtualPool: new PublicKey(poolAddress),
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Create DAMM V1 migration metadata.
 */
export async function createDammV1MigrationMetadata(
  connection: Connection,
  keypair: Keypair,
  params: { poolAddress: string; config: string }
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.migration.createDammV1MigrationMetadata({
    payer: keypair.publicKey,
    virtualPool: new PublicKey(params.poolAddress),
    config: new PublicKey(params.config),
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

// ============================================
// Pool Service (additional methods)
// ============================================

/**
 * Create pool with an existing config and optional first buy.
 */
export async function createDbcPoolWithExistingConfigAndBuy(
  connection: Connection,
  keypair: Keypair,
  params: {
    name: string;
    symbol: string;
    uri: string;
    configAddress: string;
    buyAmountLamports?: string;
  }
): Promise<{ baseMint: string; poolAddress: string; signatures: string[] }> {
  const sdk = await getDbcSdk();
  const client = await getDbcClient(connection);

  const baseMintKeypair = Keypair.generate();
  const configPk = new PublicKey(params.configAddress);

  const createPoolParam = {
    name: params.name,
    symbol: params.symbol,
    uri: params.uri,
    payer: keypair.publicKey,
    poolCreator: keypair.publicKey,
    config: configPk,
    baseMint: baseMintKeypair.publicKey,
  };

  const signatures: string[] = [];

  if (params.buyAmountLamports) {
    const result = await client.pool.createPoolWithFirstBuy({
      createPoolParam,
      firstBuyParam: {
        buyer: keypair.publicKey,
        buyAmount: new BN(params.buyAmountLamports),
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      },
    });

    const poolTx: Transaction = result.createPoolTx;
    poolTx.partialSign(baseMintKeypair);
    signatures.push(await signAndSendTransaction(connection, keypair, poolTx));

    if (result.swapBuyTx) {
      signatures.push(await signAndSendTransaction(connection, keypair, result.swapBuyTx));
    }
  } else {
    const tx: Transaction = await client.pool.createPool(createPoolParam);
    tx.partialSign(baseMintKeypair);
    signatures.push(await signAndSendTransaction(connection, keypair, tx));
  }

  const configState = await client.state.getPoolConfig(configPk);
  const quoteMint = configState.quoteMint as PublicKey;
  const derivePool = sdk.deriveDbcPoolAddress;
  let poolAddr = '';
  if (derivePool) {
    try {
      const poolPda = derivePool(quoteMint, baseMintKeypair.publicKey, configPk);
      poolAddr = poolPda.toBase58();
    } catch {
      poolAddr = 'derived-after-confirm';
    }
  }

  return {
    baseMint: baseMintKeypair.publicKey.toBase58(),
    poolAddress: poolAddr,
    signatures,
  };
}

/**
 * Create pool with partner and creator first buys.
 */
export async function createDbcPoolWithPartnerAndCreatorBuy(
  connection: Connection,
  keypair: Keypair,
  params: {
    name: string;
    symbol: string;
    uri: string;
    configAddress: string;
    partnerBuy?: { wallet: string; amount: string; receiver: string };
    creatorBuy?: { wallet: string; amount: string; receiver: string };
  }
): Promise<{ baseMint: string; poolAddress: string; signatures: string[] }> {
  const sdk = await getDbcSdk();
  const client = await getDbcClient(connection);

  const baseMintKeypair = Keypair.generate();
  const configPk = new PublicKey(params.configAddress);

  const result = await client.pool.createPoolWithPartnerAndCreatorFirstBuy({
    createPoolParam: {
      name: params.name,
      symbol: params.symbol,
      uri: params.uri,
      payer: keypair.publicKey,
      poolCreator: keypair.publicKey,
      config: configPk,
      baseMint: baseMintKeypair.publicKey,
    },
    partnerFirstBuyParam: params.partnerBuy ? {
      partner: new PublicKey(params.partnerBuy.wallet),
      receiver: new PublicKey(params.partnerBuy.receiver),
      buyAmount: new BN(params.partnerBuy.amount),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    } : undefined,
    creatorFirstBuyParam: params.creatorBuy ? {
      creator: new PublicKey(params.creatorBuy.wallet),
      receiver: new PublicKey(params.creatorBuy.receiver),
      buyAmount: new BN(params.creatorBuy.amount),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    } : undefined,
  });

  const signatures: string[] = [];

  const poolTx: Transaction = result.createPoolTx;
  poolTx.partialSign(baseMintKeypair);
  signatures.push(await signAndSendTransaction(connection, keypair, poolTx));

  if (result.partnerSwapBuyTx) {
    signatures.push(await signAndSendTransaction(connection, keypair, result.partnerSwapBuyTx));
  }
  if (result.creatorSwapBuyTx) {
    signatures.push(await signAndSendTransaction(connection, keypair, result.creatorSwapBuyTx));
  }

  const configState = await client.state.getPoolConfig(configPk);
  const quoteMint = configState.quoteMint as PublicKey;
  const derivePool = sdk.deriveDbcPoolAddress;
  let poolAddr = '';
  if (derivePool) {
    try {
      const poolPda = derivePool(quoteMint, baseMintKeypair.publicKey, configPk);
      poolAddr = poolPda.toBase58();
    } catch {
      poolAddr = 'derived-after-confirm';
    }
  }

  return {
    baseMint: baseMintKeypair.publicKey.toBase58(),
    poolAddress: poolAddr,
    signatures,
  };
}

/**
 * Swap V2 with ExactIn, PartialFill, or ExactOut modes.
 */
export async function swapOnDbcPoolV2(
  connection: Connection,
  keypair: Keypair,
  params: {
    poolAddress: string;
    swapBaseForQuote: boolean;
    swapMode: number; // 0=ExactIn, 1=PartialFill, 2=ExactOut
    amountIn?: string;
    minimumAmountOut?: string;
    amountOut?: string;
    maximumAmountIn?: string;
  }
): Promise<{ signature: string; direction: string }> {
  const sdk = await getDbcSdk();
  const client = await getDbcClient(connection);

  const SwapMode = sdk.SwapMode;
  const pool = new PublicKey(params.poolAddress);

  let swap2Params: any;
  const base = {
    owner: keypair.publicKey,
    pool,
    swapBaseForQuote: params.swapBaseForQuote,
    referralTokenAccount: null,
  };

  if (params.swapMode === 2 && SwapMode) {
    swap2Params = {
      ...base,
      swapMode: SwapMode.ExactOut,
      amountOut: new BN(params.amountOut || '0'),
      maximumAmountIn: new BN(params.maximumAmountIn || '18446744073709551615'),
    };
  } else if (params.swapMode === 1 && SwapMode) {
    swap2Params = {
      ...base,
      swapMode: SwapMode.PartialFill,
      amountIn: new BN(params.amountIn || '0'),
      minimumAmountOut: new BN(params.minimumAmountOut || '0'),
    };
  } else {
    swap2Params = {
      ...base,
      swapMode: SwapMode?.ExactIn ?? 0,
      amountIn: new BN(params.amountIn || '0'),
      minimumAmountOut: new BN(params.minimumAmountOut || '0'),
    };
  }

  const tx: Transaction = await client.pool.swap2(swap2Params);
  const signature = await signAndSendTransaction(connection, keypair, tx);
  return {
    signature,
    direction: params.swapBaseForQuote ? 'SELL (base->quote)' : 'BUY (quote->base)',
  };
}

/**
 * Get swap quote V2 with ExactIn, PartialFill, or ExactOut modes.
 */
export async function getDbcSwapQuoteV2(
  connection: Connection,
  params: {
    poolAddress: string;
    swapBaseForQuote: boolean;
    swapMode: number; // 0=ExactIn, 1=PartialFill, 2=ExactOut
    amountIn?: string;
    amountOut?: string;
  }
): Promise<{ amountIn: string; amountOut: string; minimumAmountOut?: string; maximumAmountIn?: string; direction: string }> {
  const sdk = await getDbcSdk();
  const client = await getDbcClient(connection);

  const SwapMode = sdk.SwapMode;
  const poolAddress = new PublicKey(params.poolAddress);
  const pool = await client.state.getPool(poolAddress);
  const configPk = (pool as any).config || (pool as any).poolConfig;
  const config = await client.state.getPoolConfig(configPk);

  const getCurrentPointFn = sdk.getCurrentPoint;
  const ActivationType = sdk.ActivationType;
  let currentPoint = new BN(0);
  if (getCurrentPointFn && ActivationType) {
    try {
      currentPoint = await getCurrentPointFn(connection, ActivationType.Timestamp);
    } catch { /* fallback */ }
  }

  let quoteParams: any;
  const base = {
    virtualPool: pool,
    config,
    swapBaseForQuote: params.swapBaseForQuote,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    currentPoint,
  };

  if (params.swapMode === 2 && SwapMode) {
    quoteParams = { ...base, swapMode: SwapMode.ExactOut, amountOut: new BN(params.amountOut || '0') };
  } else if (params.swapMode === 1 && SwapMode) {
    quoteParams = { ...base, swapMode: SwapMode.PartialFill, amountIn: new BN(params.amountIn || '0') };
  } else {
    quoteParams = { ...base, swapMode: SwapMode?.ExactIn ?? 0, amountIn: new BN(params.amountIn || '0') };
  }

  const result = client.pool.swapQuote2(quoteParams);
  return {
    amountIn: result.excludedFeeInputAmount?.toString() || params.amountIn || '0',
    amountOut: result.outputAmount?.toString() || '0',
    minimumAmountOut: result.minimumAmountOut?.toString(),
    maximumAmountIn: result.maximumAmountIn?.toString(),
    direction: params.swapBaseForQuote ? 'SELL (base->quote)' : 'BUY (quote->base)',
  };
}

// ============================================
// Partner Service (additional methods)
// ============================================

/**
 * Create partner metadata.
 */
export async function createPartnerMetadata(
  connection: Connection,
  keypair: Keypair,
  params: { name: string; website: string; logo: string }
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.partner.createPartnerMetadata({
    name: params.name,
    website: params.website,
    logo: params.logo,
    feeClaimer: keypair.publicKey,
    payer: keypair.publicKey,
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Partner withdraw surplus from a pool.
 */
export async function partnerWithdrawSurplus(
  connection: Connection,
  keypair: Keypair,
  poolAddress: string
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.partner.partnerWithdrawSurplus({
    feeClaimer: keypair.publicKey,
    virtualPool: new PublicKey(poolAddress),
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Partner withdraw migration fee from a pool.
 */
export async function partnerWithdrawMigrationFee(
  connection: Connection,
  keypair: Keypair,
  poolAddress: string
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.partner.partnerWithdrawMigrationFee({
    virtualPool: new PublicKey(poolAddress),
    sender: keypair.publicKey,
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Claim partner pool creation fee.
 */
export async function claimPartnerPoolCreationFee(
  connection: Connection,
  keypair: Keypair,
  params: { poolAddress: string; feeReceiver: string }
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.partner.claimPartnerPoolCreationFee({
    virtualPool: new PublicKey(params.poolAddress),
    feeReceiver: new PublicKey(params.feeReceiver),
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Claim partner trading fee V2 (non-SOL quote mint).
 */
export async function claimDbcPartnerFeesV2(
  connection: Connection,
  keypair: Keypair,
  params: { poolAddress: string; receiver: string }
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const u64Max = new BN('18446744073709551615');
  const tx: Transaction = await client.partner.claimPartnerTradingFee2({
    feeClaimer: keypair.publicKey,
    payer: keypair.publicKey,
    pool: new PublicKey(params.poolAddress),
    maxBaseAmount: u64Max,
    maxQuoteAmount: u64Max,
    receiver: new PublicKey(params.receiver),
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

// ============================================
// Creator Service (additional methods)
// ============================================

/**
 * Create pool metadata (name, website, logo).
 */
export async function createPoolMetadata(
  connection: Connection,
  keypair: Keypair,
  params: { poolAddress: string; name: string; website: string; logo: string }
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.creator.createPoolMetadata({
    virtualPool: new PublicKey(params.poolAddress),
    name: params.name,
    website: params.website,
    logo: params.logo,
    creator: keypair.publicKey,
    payer: keypair.publicKey,
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Creator withdraw surplus from a pool.
 */
export async function creatorWithdrawSurplus(
  connection: Connection,
  keypair: Keypair,
  poolAddress: string
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.creator.creatorWithdrawSurplus({
    creator: keypair.publicKey,
    virtualPool: new PublicKey(poolAddress),
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Transfer pool creator to a new wallet.
 */
export async function transferPoolCreator(
  connection: Connection,
  keypair: Keypair,
  params: { poolAddress: string; newCreator: string }
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.creator.transferPoolCreator({
    virtualPool: new PublicKey(params.poolAddress),
    creator: keypair.publicKey,
    newCreator: new PublicKey(params.newCreator),
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Creator withdraw migration fee from a pool.
 */
export async function creatorWithdrawMigrationFee(
  connection: Connection,
  keypair: Keypair,
  poolAddress: string
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const tx: Transaction = await client.creator.creatorWithdrawMigrationFee({
    virtualPool: new PublicKey(poolAddress),
    sender: keypair.publicKey,
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

/**
 * Claim creator trading fee V2 (non-SOL quote mint).
 */
export async function claimDbcCreatorFeesV2(
  connection: Connection,
  keypair: Keypair,
  params: { poolAddress: string; receiver: string }
): Promise<{ signature: string }> {
  const client = await getDbcClient(connection);

  const u64Max = new BN('18446744073709551615');
  const tx: Transaction = await client.creator.claimCreatorTradingFee2({
    creator: keypair.publicKey,
    payer: keypair.publicKey,
    pool: new PublicKey(params.poolAddress),
    maxBaseAmount: u64Max,
    maxQuoteAmount: u64Max,
    receiver: new PublicKey(params.receiver),
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);
  return { signature };
}

// ============================================
// State Service (additional query methods)
// ============================================

/**
 * Get all DBC pool configs.
 */
export async function getDbcPoolConfigs(
  connection: Connection
): Promise<Array<{ address: string; config: any }>> {
  const client = await getDbcClient(connection);
  const configs = await client.state.getPoolConfigs();
  return configs.map((c: any) => ({
    address: c.publicKey.toBase58(),
    config: c.account,
  }));
}

/**
 * Get pool configs by owner.
 */
export async function getDbcPoolConfigsByOwner(
  connection: Connection,
  owner: string
): Promise<Array<{ address: string; config: any }>> {
  const client = await getDbcClient(connection);
  const configs = await client.state.getPoolConfigsByOwner(owner);
  return configs.map((c: any) => ({
    address: c.publicKey.toBase58(),
    config: c.account,
  }));
}

/**
 * Get all DBC pools.
 */
/**
 * Fetches EVERY DBC pool ever created — there is no pagination/filter option
 * in the underlying SDK's client.state.getPools(). Verified live: the RPC
 * response is large enough to exceed V8's max string length
 * (0x1fffffe8 chars), so this crashes the whole process with an opaque
 * "Cannot create a string longer than..." error, not a catchable app-level
 * failure. Guarded here so callers get a clear message pointing at the
 * filtered alternatives instead. Use getDbcPoolsByConfig, getDbcPoolsByCreator,
 * or (for a single known token) the SDK's own client.state.getPoolByBaseMint.
 */
export async function getDbcPools(
  _connection: Connection
): Promise<Array<{ address: string; pool: any }>> {
  throw new Error(
    'getDbcPools() is unfiltered and will crash the process on live mainnet (RPC response exceeds V8\'s max string length). ' +
    'Use getDbcPoolsByConfig(connection, configAddress) or getDbcPoolsByCreator(connection, creatorAddress) instead.'
  );
}

/**
 * Get pools by config address.
 */
export async function getDbcPoolsByConfig(
  connection: Connection,
  configAddress: string
): Promise<Array<{ address: string; pool: any }>> {
  const client = await getDbcClient(connection);
  const pools = await client.state.getPoolsByConfig(configAddress);
  return pools.map((p: any) => ({
    address: p.publicKey.toBase58(),
    pool: p.account,
  }));
}

/**
 * Get pools by creator address.
 */
export async function getDbcPoolsByCreator(
  connection: Connection,
  creator: string
): Promise<Array<{ address: string; pool: any }>> {
  const client = await getDbcClient(connection);
  const pools = await client.state.getPoolsByCreator(creator);
  return pools.map((p: any) => ({
    address: p.publicKey.toBase58(),
    pool: p.account,
  }));
}

/**
 * Get pool metadata.
 */
export async function getDbcPoolMetadata(
  connection: Connection,
  poolAddress: string
): Promise<unknown[]> {
  const client = await getDbcClient(connection);
  return await client.state.getPoolMetadata(poolAddress);
}

/**
 * Get partner metadata.
 */
export async function getDbcPartnerMetadata(
  connection: Connection,
  partnerAddress: string
): Promise<unknown[]> {
  const client = await getDbcClient(connection);
  return await client.state.getPartnerMetadata(partnerAddress);
}

/**
 * Get DAMM V1 lock escrow details.
 */
export async function getDbcLockEscrow(
  connection: Connection,
  lockEscrowAddress: string
): Promise<any | null> {
  const client = await getDbcClient(connection);
  return await client.state.getDammV1LockEscrow(lockEscrowAddress);
}

/**
 * Get detailed fee breakdown for a pool.
 */
export async function getDbcPoolFeeBreakdown(
  connection: Connection,
  poolAddress: string
): Promise<{
  creator: { unclaimedBase: string; unclaimedQuote: string; claimedBase: string; claimedQuote: string; totalBase: string; totalQuote: string };
  partner: { unclaimedBase: string; unclaimedQuote: string; claimedBase: string; claimedQuote: string; totalBase: string; totalQuote: string };
}> {
  const client = await getDbcClient(connection);
  const breakdown = await client.state.getPoolFeeBreakdown(poolAddress);
  return {
    creator: {
      unclaimedBase: breakdown.creator.unclaimedBaseFee.toString(),
      unclaimedQuote: breakdown.creator.unclaimedQuoteFee.toString(),
      claimedBase: breakdown.creator.claimedBaseFee.toString(),
      claimedQuote: breakdown.creator.claimedQuoteFee.toString(),
      totalBase: breakdown.creator.totalBaseFee.toString(),
      totalQuote: breakdown.creator.totalQuoteFee.toString(),
    },
    partner: {
      unclaimedBase: breakdown.partner.unclaimedBaseFee.toString(),
      unclaimedQuote: breakdown.partner.unclaimedQuoteFee.toString(),
      claimedBase: breakdown.partner.claimedBaseFee.toString(),
      claimedQuote: breakdown.partner.claimedQuoteFee.toString(),
      totalBase: breakdown.partner.totalBaseFee.toString(),
      totalQuote: breakdown.partner.totalQuoteFee.toString(),
    },
  };
}

/**
 * Get all fees for pools by config.
 */
export async function getDbcPoolsFeesByConfig(
  connection: Connection,
  configAddress: string
): Promise<Array<{ poolAddress: string; partnerBase: string; partnerQuote: string; creatorBase: string; creatorQuote: string; totalBase: string; totalQuote: string }>> {
  const client = await getDbcClient(connection);
  const fees = await client.state.getPoolsFeesByConfig(configAddress);
  return fees.map((f: any) => ({
    poolAddress: f.poolAddress.toBase58(),
    partnerBase: f.partnerBaseFee.toString(),
    partnerQuote: f.partnerQuoteFee.toString(),
    creatorBase: f.creatorBaseFee.toString(),
    creatorQuote: f.creatorQuoteFee.toString(),
    totalBase: f.totalTradingBaseFee.toString(),
    totalQuote: f.totalTradingQuoteFee.toString(),
  }));
}

/**
 * Get all fees for pools by creator.
 */
export async function getDbcPoolsFeesByCreator(
  connection: Connection,
  creator: string
): Promise<Array<{ poolAddress: string; partnerBase: string; partnerQuote: string; creatorBase: string; creatorQuote: string; totalBase: string; totalQuote: string }>> {
  const client = await getDbcClient(connection);
  const fees = await client.state.getPoolsFeesByCreator(creator);
  return fees.map((f: any) => ({
    poolAddress: f.poolAddress.toBase58(),
    partnerBase: f.partnerBaseFee.toString(),
    partnerQuote: f.partnerQuoteFee.toString(),
    creatorBase: f.creatorBaseFee.toString(),
    creatorQuote: f.creatorQuoteFee.toString(),
    totalBase: f.totalTradingBaseFee.toString(),
    totalQuote: f.totalTradingQuoteFee.toString(),
  }));
}

/**
 * Get DAMM V1 migration metadata.
 */
export async function getDbcMigrationMetadata(
  connection: Connection,
  poolAddress: string
): Promise<any> {
  const client = await getDbcClient(connection);
  return await client.state.getDammV1MigrationMetadata(new PublicKey(poolAddress));
}
