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
      PROGRAM_ID
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
        decimals: reserve.state.liquidity.mintDecimals,
        depositRate: reserve.calculateSupplyAPY() * 100,
        borrowRate: reserve.calculateBorrowAPY() * 100,
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
      PROGRAM_ID
    );

    if (!market) {
      return null;
    }

    // Refresh market data
    await market.loadReserves();

    const obligation = await market.getObligationByWallet(
      keypair.publicKey,
      new VanillaObligation(PROGRAM_ID)
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

    const stats = obligation.stats;
    const ltv = obligation.loanToValue();

    return {
      address: obligation.obligationAddress.toBase58(),
      owner: keypair.publicKey.toBase58(),
      deposits,
      borrows,
      totalDepositValue: stats.userTotalDeposit?.toString() || '0',
      totalBorrowValue: stats.userTotalBorrow?.toString() || '0',
      borrowLimit: stats.borrowLimit?.toString() || '0',
      liquidationThreshold: stats.liquidationLtv?.toString() || '0',
      healthFactor: ltv > 0 ? (1 / ltv) : Infinity,
      ltv: ltv * 100,
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
    PROGRAM_ID
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
    keypair,
    new VanillaObligation(PROGRAM_ID),
    true,  // useV2Ixs
    undefined,  // scopeRefreshConfig
    400000,  // extraComputeBudget
    true,  // includeAtaIxs
  );

  const txs = await action.getTransactions();
  let signature = '';

  for (const tx of txs) {
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
    PROGRAM_ID
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
    keypair,
    new VanillaObligation(PROGRAM_ID),
    true,  // useV2Ixs
    undefined,  // scopeRefreshConfig
    400000,  // extraComputeBudget
    true,  // includeAtaIxs
  );

  const txs = await action.getTransactions();
  let signature = '';

  for (const tx of txs) {
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
    PROGRAM_ID
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
    keypair,
    new VanillaObligation(PROGRAM_ID),
    true,  // useV2Ixs
    undefined,  // scopeRefreshConfig
    400000,  // extraComputeBudget
    true,  // includeAtaIxs
  );

  const txs = await action.getTransactions();
  let signature = '';

  for (const tx of txs) {
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
    PROGRAM_ID
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
    keypair,
    new VanillaObligation(PROGRAM_ID),
    true,  // useV2Ixs
    undefined,  // scopeRefreshConfig
    BigInt(currentSlot),  // currentSlot
    undefined,  // payer
    400000,  // extraComputeBudget
    true,  // includeAtaIxs
  );

  const txs = await action.getTransactions();
  let signature = '';

  for (const tx of txs) {
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
    const kamino = new Kamino('mainnet-beta', connection);

    const strategies = await kamino.getStrategies();
    const results: KaminoStrategyInfo[] = [];

    for (const strategy of strategies) {
      try {
        const sharePrice = await kamino.getStrategySharePrice(strategy.address);

        results.push({
          address: strategy.address.toBase58(),
          name: strategy.strategyLookupTable?.toBase58() || 'Unknown',
          tokenAMint: strategy.tokenAMint.toBase58(),
          tokenBMint: strategy.tokenBMint.toBase58(),
          tokenASymbol: 'TokenA',
          tokenBSymbol: 'TokenB',
          protocol: strategy.strategyDex?.toString() || 'Unknown',
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
    const kamino = new Kamino('mainnet-beta', connection);

    const strategy = await kamino.getStrategyByAddress(new PublicKey(strategyAddress));
    if (!strategy) {
      return null;
    }

    const sharePrice = await kamino.getStrategySharePrice(new PublicKey(strategyAddress));

    return {
      address: strategyAddress,
      name: strategy.strategyLookupTable?.toBase58() || 'Unknown',
      tokenAMint: strategy.tokenAMint.toBase58(),
      tokenBMint: strategy.tokenBMint.toBase58(),
      tokenASymbol: 'TokenA',
      tokenBSymbol: 'TokenB',
      protocol: strategy.strategyDex?.toString() || 'Unknown',
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
    const kamino = new Kamino('mainnet-beta', connection);

    if (strategyAddress) {
      const strategy = await kamino.getStrategyByAddress(new PublicKey(strategyAddress));
      if (!strategy) {
        return [];
      }

      const holders = await kamino.getStrategyHolders(strategy);
      const userHolding = holders.find((h: any) =>
        h.holderPubkey.equals(keypair.publicKey)
      );

      if (!userHolding) {
        return [];
      }

      return [{
        strategyAddress,
        shares: userHolding.shares.toString(),
        tokenAAmount: '0',
        tokenBAmount: '0',
        valueUsd: '0',
      }];
    }

    // Get shares across all strategies
    const strategies = await kamino.getStrategies();
    const results: KaminoUserShares[] = [];

    for (const strategy of strategies) {
      try {
        const holders = await kamino.getStrategyHolders(strategy);
        const userHolding = holders.find((h: any) =>
          h.holderPubkey.equals(keypair.publicKey)
        );

        if (userHolding && userHolding.shares.gt(new Decimal(0))) {
          results.push({
            strategyAddress: strategy.address.toBase58(),
            shares: userHolding.shares.toString(),
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
  const kamino = new Kamino('mainnet-beta', connection);

  const strategy = await kamino.getStrategyByAddress(new PublicKey(params.strategyAddress));
  if (!strategy) {
    throw new Error(`Strategy not found: ${params.strategyAddress}`);
  }

  const tokenAAmount = new Decimal(params.tokenAAmount);
  const tokenBAmount = params.tokenBAmount ? new Decimal(params.tokenBAmount) : new Decimal(0);

  const depositIx = await kamino.deposit(
    { strategy, address: new PublicKey(params.strategyAddress) },
    tokenAAmount,
    tokenBAmount,
    keypair.publicKey
  );

  const tx = new Transaction().add(depositIx);
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
  const kamino = new Kamino('mainnet-beta', connection);

  const strategy = await kamino.getStrategyByAddress(new PublicKey(params.strategyAddress));
  if (!strategy) {
    throw new Error(`Strategy not found: ${params.strategyAddress}`);
  }

  const tx = new Transaction();

  if (params.withdrawAll) {
    // withdrawAllShares returns an array of instructions or null
    const withdrawIxns = await kamino.withdrawAllShares(
      { strategy, address: new PublicKey(params.strategyAddress) },
      keypair.publicKey
    );
    if (!withdrawIxns || withdrawIxns.length === 0) {
      throw new Error('No shares to withdraw');
    }
    tx.add(...withdrawIxns);
  } else if (params.shares) {
    // withdrawShares returns a single instruction
    const withdrawIx = await kamino.withdrawShares(
      { strategy, address: new PublicKey(params.strategyAddress) },
      new Decimal(params.shares),
      keypair.publicKey
    );
    if (!withdrawIx) {
      throw new Error('Failed to create withdraw instruction');
    }
    tx.add(withdrawIx);
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
    const kamino = new Kamino('mainnet-beta', connection);

    const price = await kamino.getStrategySharePrice(new PublicKey(strategyAddress));
    return price?.toString() || '0';
  } catch (error) {
    console.error('Failed to get share price:', error);
    return '0';
  }
}
