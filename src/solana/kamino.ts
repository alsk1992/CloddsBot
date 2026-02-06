/**
 * Kamino Finance SDK Integration
 *
 * Lending (klend-sdk): deposit, withdraw, borrow, repay
 * Liquidity Vaults (kliquidity-sdk): strategies, vault deposit/withdraw
 */

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { signAndSendTransaction } from './wallet';
import BN from 'bn.js';
import Decimal from 'decimal.js';

// ============================================
// LENDING INTERFACES
// ============================================

export interface KaminoMarketInfo {
  address: string;
  name: string;
  reserves: KaminoReserveInfo[];
}

export interface KaminoReserveInfo {
  address: string;
  symbol: string;
  mint: string;
  decimals: number;
  depositRate: number;
  borrowRate: number;
  totalDeposits: string;
  totalBorrows: string;
  availableLiquidity: string;
  utilizationRate: number;
  ltv: number;
  liquidationThreshold: number;
}

export interface KaminoObligationInfo {
  address: string;
  owner: string;
  deposits: KaminoPositionInfo[];
  borrows: KaminoPositionInfo[];
  totalDepositValue: string;
  totalBorrowValue: string;
  borrowLimit: string;
  liquidationThreshold: string;
  healthFactor: number;
  ltv: number;
}

export interface KaminoPositionInfo {
  reserveAddress: string;
  symbol: string;
  mint: string;
  amount: string;
  amountUsd: string;
}

export interface KaminoDepositParams {
  reserveMint: string;
  amount: string;
  marketAddress?: string;
}

export interface KaminoWithdrawParams {
  reserveMint: string;
  amount: string;
  withdrawAll?: boolean;
  marketAddress?: string;
}

export interface KaminoBorrowParams {
  reserveMint: string;
  amount: string;
  marketAddress?: string;
}

export interface KaminoRepayParams {
  reserveMint: string;
  amount: string;
  repayAll?: boolean;
  marketAddress?: string;
}

export interface KaminoLendingResult {
  signature: string;
  amount?: string;
  symbol?: string;
}

// ============================================
// LIQUIDITY/VAULT INTERFACES
// ============================================

export interface KaminoStrategyInfo {
  address: string;
  name: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  protocol: string;
  sharePrice: string;
  tvl: string;
  apy: number;
  status: 'active' | 'paused' | 'deprecated';
}

export interface KaminoUserShares {
  strategyAddress: string;
  shares: string;
  tokenAAmount: string;
  tokenBAmount: string;
  valueUsd: string;
}

export interface KaminoVaultDepositParams {
  strategyAddress: string;
  tokenAAmount: string;
  tokenBAmount?: string;
}

export interface KaminoVaultWithdrawParams {
  strategyAddress: string;
  shares?: string;
  withdrawAll?: boolean;
}

export interface KaminoVaultResult {
  signature: string;
  strategyAddress: string;
  shares?: string;
  tokenAAmount?: string;
  tokenBAmount?: string;
}

// ============================================
// MAIN MARKET ADDRESS
// ============================================

const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';

// ============================================
// LENDING FUNCTIONS
// ============================================

/**
 * Get all Kamino lending markets with their reserves
 * @param connection - Solana RPC connection
 * @returns Array of markets with reserve details (APY, utilization, LTV)
 */
export async function getKaminoMarkets(
  connection: Connection
): Promise<KaminoMarketInfo[]> {
  try {
    const { KaminoMarket, PROGRAM_ID } = await import('@kamino-finance/klend-sdk');

    const market = await KaminoMarket.load(
      connection,
      new PublicKey(KAMINO_MAIN_MARKET),
      PROGRAM_ID as any
    );

    if (!market) {
      return [];
    }

    const reserves: KaminoReserveInfo[] = [];
    for (const [, reserve] of market.reserves) {
      reserves.push({
        address: reserve.address.toBase58(),
        symbol: reserve.symbol || 'UNKNOWN',
        mint: reserve.getLiquidityMint().toBase58(),
        decimals: (reserve.state.liquidity.mintDecimals as BN).toNumber(),
        depositRate: (reserve as any).calculateSupplyAPR() * 100,
        borrowRate: (reserve as any).calculateBorrowAPR() * 100,
        totalDeposits: reserve.getTotalSupply().toString(),
        totalBorrows: reserve.getBorrowedAmount().toString(),
        availableLiquidity: reserve.getLiquidityAvailableAmount().toString(),
        utilizationRate: reserve.calculateUtilizationRatio() * 100,
        ltv: reserve.state.config.loanToValuePct,
        liquidationThreshold: reserve.state.config.liquidationThresholdPct,
      });
    }

    return [{
      address: KAMINO_MAIN_MARKET,
      name: 'Kamino Main Market',
      reserves,
    }];
  } catch (error) {
    console.error('Failed to get Kamino markets:', error);
    return [];
  }
}

/**
 * Get reserves for a specific Kamino market
 * @param connection - Solana RPC connection
 * @param marketAddress - Market address (defaults to main market)
 * @returns Array of reserves with rates and utilization
 */
export async function getKaminoReserves(
  connection: Connection,
  marketAddress?: string
): Promise<KaminoReserveInfo[]> {
  const markets = await getKaminoMarkets(connection);
  const market = markets.find(m =>
    m.address === (marketAddress || KAMINO_MAIN_MARKET)
  );
  return market?.reserves || [];
}

/**
 * Get user's lending obligation (deposits, borrows, health factor)
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair
 * @param marketAddress - Market address (defaults to main market)
 * @returns Obligation with positions and health metrics, or null if none
 */
export async function getKaminoObligation(
  connection: Connection,
  keypair: Keypair,
  marketAddress?: string
): Promise<KaminoObligationInfo | null> {
  try {
    const { KaminoMarket, VanillaObligation, PROGRAM_ID } = await import('@kamino-finance/klend-sdk');

    const market = await KaminoMarket.load(
      connection,
      new PublicKey(marketAddress || KAMINO_MAIN_MARKET),
      PROGRAM_ID as any
    );

    if (!market) {
      return null;
    }

    // Refresh market data
    await market.loadReserves();

    const obligation = await market.getObligationByWallet(
      keypair.publicKey,
      new VanillaObligation(PROGRAM_ID as any)
    );
    if (!obligation) {
      return null;
    }

    // deposits and borrows are Maps - convert to arrays
    const deposits: KaminoPositionInfo[] = [];
    for (const [reserveAddress, deposit] of obligation.deposits) {
      const reserve = market.getReserveByAddress(reserveAddress);
      deposits.push({
        reserveAddress: reserveAddress.toBase58(),
        symbol: reserve?.symbol || 'UNKNOWN',
        mint: reserve?.getLiquidityMint().toBase58() || '',
        amount: (deposit as any).amount?.toString() || '0',
        amountUsd: (deposit as any).marketValue?.toString() || '0',
      });
    }

    const borrows: KaminoPositionInfo[] = [];
    for (const [reserveAddress, borrow] of obligation.borrows) {
      const reserve = market.getReserveByAddress(reserveAddress);
      borrows.push({
        reserveAddress: reserveAddress.toBase58(),
        symbol: reserve?.symbol || 'UNKNOWN',
        mint: reserve?.getLiquidityMint().toBase58() || '',
        amount: (borrow as any).amount?.toString() || '0',
        amountUsd: (borrow as any).marketValue?.toString() || '0',
      });
    }

    const state = obligation.state;
    const ltv = obligation.loanToValue();
    const ltvNum = ltv instanceof Decimal ? ltv.toNumber() : Number(ltv);

    return {
      address: obligation.obligationAddress.toBase58(),
      owner: keypair.publicKey.toBase58(),
      deposits,
      borrows,
      totalDepositValue: (state as any).userTotalDeposit?.toString() || '0',
      totalBorrowValue: (state as any).userTotalBorrow?.toString() || '0',
      borrowLimit: (state as any).borrowLimit?.toString() || '0',
      liquidationThreshold: (state as any).liquidationLtv?.toString() || '0',
      healthFactor: ltvNum > 0 ? (1 / ltvNum) : Infinity,
      ltv: ltvNum * 100,
    };
  } catch (error) {
    console.error('Failed to get Kamino obligation:', error);
    return null;
  }
}

/**
 * Deposit collateral to Kamino lending
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair (signs transaction)
 * @param params - Deposit params: reserveMint, amount (in base units)
 * @returns Transaction signature and amount deposited
 */
export async function depositToKamino(
  connection: Connection,
  keypair: Keypair,
  params: KaminoDepositParams
): Promise<KaminoLendingResult> {
  const { KaminoMarket, KaminoAction, VanillaObligation, PROGRAM_ID } =
    await import('@kamino-finance/klend-sdk');

  const market = await KaminoMarket.load(
    connection,
    new PublicKey(params.marketAddress || KAMINO_MAIN_MARKET),
    PROGRAM_ID as any
  );

  if (!market) {
    throw new Error('Failed to load Kamino market');
  }

  const reserve = market.getReserveByMint(new PublicKey(params.reserveMint));
  if (!reserve) {
    throw new Error(`Reserve not found for mint: ${params.reserveMint}`);
  }

  const amount = new BN(params.amount);

  const action = await KaminoAction.buildDepositTxns(
    market,
    amount,
    reserve.getLiquidityMint(),
    keypair.publicKey,
    new VanillaObligation(PROGRAM_ID as any),
    400000,  // extraComputeBudget
    true,  // includeAtaIxs
  );

  const txns = await action.getTransactions();
  const allTxs = [txns.preLendingTxn, txns.lendingTxn, txns.postLendingTxn].filter(Boolean) as Transaction[];
  let signature = '';

  for (const tx of allTxs) {
    signature = await signAndSendTransaction(connection, keypair, tx);
  }

  return {
    signature,
    amount: params.amount,
    symbol: reserve.symbol,
  };
}

/**
 * Withdraw collateral from Kamino lending
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair (signs transaction)
 * @param params - Withdraw params: reserveMint, amount, withdrawAll flag
 * @returns Transaction signature and amount withdrawn
 */
export async function withdrawFromKamino(
  connection: Connection,
  keypair: Keypair,
  params: KaminoWithdrawParams
): Promise<KaminoLendingResult> {
  const { KaminoMarket, KaminoAction, VanillaObligation, PROGRAM_ID } =
    await import('@kamino-finance/klend-sdk');

  const market = await KaminoMarket.load(
    connection,
    new PublicKey(params.marketAddress || KAMINO_MAIN_MARKET),
    PROGRAM_ID as any
  );

  if (!market) {
    throw new Error('Failed to load Kamino market');
  }

  const reserve = market.getReserveByMint(new PublicKey(params.reserveMint));
  if (!reserve) {
    throw new Error(`Reserve not found for mint: ${params.reserveMint}`);
  }

  const amount = params.withdrawAll ? 'max' : new BN(params.amount);

  const action = await KaminoAction.buildWithdrawTxns(
    market,
    amount,
    reserve.getLiquidityMint(),
    keypair.publicKey,
    new VanillaObligation(PROGRAM_ID as any),
    400000,  // extraComputeBudget
    true,  // includeAtaIxs
  );

  const txns = await action.getTransactions();
  const allTxs = [txns.preLendingTxn, txns.lendingTxn, txns.postLendingTxn].filter(Boolean) as Transaction[];
  let signature = '';

  for (const tx of allTxs) {
    signature = await signAndSendTransaction(connection, keypair, tx);
  }

  return {
    signature,
    amount: params.amount,
    symbol: reserve.symbol,
  };
}

/**
 * Borrow assets from Kamino lending (requires collateral)
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair (signs transaction)
 * @param params - Borrow params: reserveMint, amount (in base units)
 * @returns Transaction signature and amount borrowed
 */
export async function borrowFromKamino(
  connection: Connection,
  keypair: Keypair,
  params: KaminoBorrowParams
): Promise<KaminoLendingResult> {
  const { KaminoMarket, KaminoAction, VanillaObligation, PROGRAM_ID } =
    await import('@kamino-finance/klend-sdk');

  const market = await KaminoMarket.load(
    connection,
    new PublicKey(params.marketAddress || KAMINO_MAIN_MARKET),
    PROGRAM_ID as any
  );

  if (!market) {
    throw new Error('Failed to load Kamino market');
  }

  const reserve = market.getReserveByMint(new PublicKey(params.reserveMint));
  if (!reserve) {
    throw new Error(`Reserve not found for mint: ${params.reserveMint}`);
  }

  const amount = new BN(params.amount);

  const action = await KaminoAction.buildBorrowTxns(
    market,
    amount,
    reserve.getLiquidityMint(),
    keypair.publicKey,
    new VanillaObligation(PROGRAM_ID as any),
    400000,  // extraComputeBudget
    true,  // includeAtaIxs
  );

  const txns = await action.getTransactions();
  const allTxs = [txns.preLendingTxn, txns.lendingTxn, txns.postLendingTxn].filter(Boolean) as Transaction[];
  let signature = '';

  for (const tx of allTxs) {
    signature = await signAndSendTransaction(connection, keypair, tx);
  }

  return {
    signature,
    amount: params.amount,
    symbol: reserve.symbol,
  };
}

/**
 * Repay borrowed assets to Kamino lending
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair (signs transaction)
 * @param params - Repay params: reserveMint, amount, repayAll flag
 * @returns Transaction signature and amount repaid
 */
export async function repayToKamino(
  connection: Connection,
  keypair: Keypair,
  params: KaminoRepayParams
): Promise<KaminoLendingResult> {
  const { KaminoMarket, KaminoAction, VanillaObligation, PROGRAM_ID } =
    await import('@kamino-finance/klend-sdk');

  const market = await KaminoMarket.load(
    connection,
    new PublicKey(params.marketAddress || KAMINO_MAIN_MARKET),
    PROGRAM_ID as any
  );

  if (!market) {
    throw new Error('Failed to load Kamino market');
  }

  const reserve = market.getReserveByMint(new PublicKey(params.reserveMint));
  if (!reserve) {
    throw new Error(`Reserve not found for mint: ${params.reserveMint}`);
  }

  const amount = params.repayAll ? 'max' : new BN(params.amount);

  // Get current slot for repay
  const currentSlot = await connection.getSlot();

  const action = await KaminoAction.buildRepayTxns(
    market,
    amount,
    reserve.getLiquidityMint(),
    keypair.publicKey,
    new VanillaObligation(PROGRAM_ID as any),
    currentSlot,  // currentSlot
    undefined,  // payer
    400000,  // extraComputeBudget
    true,  // includeAtaIxs
  );

  const txns = await action.getTransactions();
  const allTxs = [txns.preLendingTxn, txns.lendingTxn, txns.postLendingTxn].filter(Boolean) as Transaction[];
  let signature = '';

  for (const tx of allTxs) {
    signature = await signAndSendTransaction(connection, keypair, tx);
  }

  return {
    signature,
    amount: params.amount,
    symbol: reserve.symbol,
  };
}

// ============================================
// LIQUIDITY/VAULT FUNCTIONS
// ============================================

/**
 * Get all Kamino liquidity vault strategies
 * @param connection - Solana RPC connection
 * @returns Array of strategies with share prices and token pairs
 */
export async function getKaminoStrategies(
  connection: Connection
): Promise<KaminoStrategyInfo[]> {
  try {
    const { Kamino } = await import('@kamino-finance/kliquidity-sdk');
    const kamino = new Kamino('mainnet-beta', connection as any);

    const strategies = await kamino.getStrategies();
    const results: KaminoStrategyInfo[] = [];

    for (const strategy of strategies) {
      if (!strategy) continue;
      try {
        const strategyPk = (strategy as any).address ?? (strategy as any).strategyPubkey;
        const sharePrice = await kamino.getStrategySharePrice(strategyPk ?? new PublicKey(0));

        results.push({
          address: strategyPk?.toBase58?.() || 'unknown',
          name: (strategy as any).strategyLookupTable?.toBase58() || 'Unknown',
          tokenAMint: strategy.tokenAMint.toBase58(),
          tokenBMint: strategy.tokenBMint.toBase58(),
          tokenASymbol: 'TokenA',
          tokenBSymbol: 'TokenB',
          protocol: (strategy as any).strategyDex?.toString() || 'Unknown',
          sharePrice: sharePrice?.toString() || '0',
          tvl: '0',
          apy: 0,
          status: 'active',
        });
      } catch {
        // Skip strategies that fail to load
      }
    }

    return results;
  } catch (error) {
    console.error('Failed to get Kamino strategies:', error);
    return [];
  }
}

/**
 * Get details for a specific Kamino strategy
 * @param connection - Solana RPC connection
 * @param strategyAddress - Strategy public key
 * @returns Strategy info or null if not found
 */
export async function getKaminoStrategy(
  connection: Connection,
  strategyAddress: string
): Promise<KaminoStrategyInfo | null> {
  try {
    const { Kamino } = await import('@kamino-finance/kliquidity-sdk');
    const kamino = new Kamino('mainnet-beta', connection as any);

    const strategy = await kamino.getStrategyByAddress(new PublicKey(strategyAddress));
    if (!strategy) {
      return null;
    }

    const sharePrice = await kamino.getStrategySharePrice(new PublicKey(strategyAddress));

    return {
      address: strategyAddress,
      name: (strategy as any).strategyLookupTable?.toBase58() || 'Unknown',
      tokenAMint: strategy.tokenAMint.toBase58(),
      tokenBMint: strategy.tokenBMint.toBase58(),
      tokenASymbol: 'TokenA',
      tokenBSymbol: 'TokenB',
      protocol: (strategy as any).strategyDex?.toString() || 'Unknown',
      sharePrice: sharePrice?.toString() || '0',
      tvl: '0',
      apy: 0,
      status: 'active',
    };
  } catch (error) {
    console.error('Failed to get Kamino strategy:', error);
    return null;
  }
}

/**
 * Get user's vault shares across strategies
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair
 * @param strategyAddress - Optional: filter to specific strategy
 * @returns Array of user's share holdings
 */
export async function getKaminoUserShares(
  connection: Connection,
  keypair: Keypair,
  strategyAddress?: string
): Promise<KaminoUserShares[]> {
  try {
    const { Kamino } = await import('@kamino-finance/kliquidity-sdk');
    const kamino = new Kamino('mainnet-beta', connection as any);

    if (strategyAddress) {
      const strategy = await kamino.getStrategyByAddress(new PublicKey(strategyAddress));
      if (!strategy) {
        return [];
      }

      const holders = await kamino.getStrategyHolders(new PublicKey(strategyAddress));
      const userHolding = holders.find((h: any) =>
        h.holderPubkey.equals(keypair.publicKey)
      );

      if (!userHolding) {
        return [];
      }

      return [{
        strategyAddress,
        shares: ((userHolding as any).shares ?? (userHolding as any).amount)?.toString() || '0',
        tokenAAmount: '0',
        tokenBAmount: '0',
        valueUsd: '0',
      }];
    }

    // Get shares across all strategies
    const strategies = await kamino.getStrategies();
    const results: KaminoUserShares[] = [];

    for (const strategy of strategies) {
      if (!strategy) continue;
      try {
        const strategyPk = (strategy as any).address ?? (strategy as any).strategyPubkey;
        const holders = await kamino.getStrategyHolders(strategyPk ?? new PublicKey(0));
        const userHolding = holders.find((h: any) =>
          h.holderPubkey.equals(keypair.publicKey)
        );

        const shares = (userHolding as any)?.shares ?? (userHolding as any)?.amount;
        if (userHolding && shares && (shares instanceof Decimal ? shares.gt(new Decimal(0)) : Number(shares) > 0)) {
          results.push({
            strategyAddress: strategyPk?.toBase58?.() || 'unknown',
            shares: shares.toString(),
            tokenAAmount: '0',
            tokenBAmount: '0',
            valueUsd: '0',
          });
        }
      } catch {
        // Skip strategies that fail
      }
    }

    return results;
  } catch (error) {
    console.error('Failed to get Kamino user shares:', error);
    return [];
  }
}

/**
 * Deposit tokens to a Kamino liquidity vault strategy
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair (signs transaction)
 * @param params - Deposit params: strategyAddress, tokenAAmount, tokenBAmount
 * @returns Transaction signature and deposited amounts
 */
export async function depositToKaminoVault(
  connection: Connection,
  keypair: Keypair,
  params: KaminoVaultDepositParams
): Promise<KaminoVaultResult> {
  const { Kamino } = await import('@kamino-finance/kliquidity-sdk');
  const kamino = new Kamino('mainnet-beta', connection as any);

  const strategy = await kamino.getStrategyByAddress(new PublicKey(params.strategyAddress));
  if (!strategy) {
    throw new Error(`Strategy not found: ${params.strategyAddress}`);
  }

  const tokenAAmount = new Decimal(params.tokenAAmount);
  const tokenBAmount = params.tokenBAmount ? new Decimal(params.tokenBAmount) : new Decimal(0);

  const depositIx = await kamino.deposit(
    new PublicKey(params.strategyAddress) as any,
    tokenAAmount,
    tokenBAmount,
    keypair.publicKey
  );

  const tx = new Transaction().add(depositIx as any);
  const signature = await signAndSendTransaction(connection, keypair, tx);

  return {
    signature,
    strategyAddress: params.strategyAddress,
    tokenAAmount: params.tokenAAmount,
    tokenBAmount: params.tokenBAmount,
  };
}

/**
 * Withdraw from a Kamino liquidity vault strategy
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair (signs transaction)
 * @param params - Withdraw params: strategyAddress, shares or withdrawAll
 * @returns Transaction signature and withdrawn shares
 */
export async function withdrawFromKaminoVault(
  connection: Connection,
  keypair: Keypair,
  params: KaminoVaultWithdrawParams
): Promise<KaminoVaultResult> {
  const { Kamino } = await import('@kamino-finance/kliquidity-sdk');
  const kamino = new Kamino('mainnet-beta', connection as any);

  const strategy = await kamino.getStrategyByAddress(new PublicKey(params.strategyAddress));
  if (!strategy) {
    throw new Error(`Strategy not found: ${params.strategyAddress}`);
  }

  const tx = new Transaction();

  if (params.withdrawAll) {
    const withdrawIxns = await kamino.withdrawAllShares(
      new PublicKey(params.strategyAddress) as any,
      keypair.publicKey
    );
    const ixnsList = withdrawIxns as any;
    if (!ixnsList || (Array.isArray(ixnsList) && ixnsList.length === 0)) {
      throw new Error('No shares to withdraw');
    }
    if (Array.isArray(ixnsList)) {
      tx.add(...ixnsList);
    } else {
      tx.add(ixnsList);
    }
  } else if (params.shares) {
    const withdrawIx = await kamino.withdrawShares(
      new PublicKey(params.strategyAddress) as any,
      new Decimal(params.shares),
      keypair.publicKey
    );
    if (!withdrawIx) {
      throw new Error('Failed to create withdraw instruction');
    }
    tx.add(withdrawIx as any);
  } else {
    throw new Error('Must specify shares or withdrawAll');
  }
  const signature = await signAndSendTransaction(connection, keypair, tx);

  return {
    signature,
    strategyAddress: params.strategyAddress,
    shares: params.shares,
  };
}

/**
 * Get current share price for a Kamino vault strategy
 * @param connection - Solana RPC connection
 * @param strategyAddress - Strategy public key
 * @returns Share price as string (Decimal)
 */
export async function getKaminoSharePrice(
  connection: Connection,
  strategyAddress: string
): Promise<string> {
  try {
    const { Kamino } = await import('@kamino-finance/kliquidity-sdk');
    const kamino = new Kamino('mainnet-beta', connection as any);

    const strategy = await kamino.getStrategyByAddress(new PublicKey(strategyAddress));
    const price = strategy ? await kamino.getStrategySharePrice(new PublicKey(strategyAddress)) : null;
    return price?.toString() || '0';
  } catch (error) {
    console.error('Failed to get share price:', error);
    return '0';
  }
}
