/**
 * MarginFi SDK Integration
 *
 * Lending: deposit, withdraw, borrow, repay
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createLogger } from '../utils/logger';

const logger = createLogger('solana:marginfi');

// ============================================
// INTERFACES
// ============================================

export interface MarginfiAccountInfo {
  address: string;
  owner: string;
  deposits: MarginfiPositionInfo[];
  borrows: MarginfiPositionInfo[];
  totalDepositValue: string;
  totalBorrowValue: string;
  healthFactor: number;
  ltv: number;
}

export interface MarginfiBankInfo {
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

export interface MarginfiPositionInfo {
  bankAddress: string;
  symbol: string;
  mint: string;
  amount: string;
  amountUsd: string;
}

export interface MarginfiDepositParams {
  bankMint: string;
  amount: string;
}

export interface MarginfiWithdrawParams {
  bankMint: string;
  amount: string;
  withdrawAll?: boolean;
}

export interface MarginfiBorrowParams {
  bankMint: string;
  amount: string;
}

export interface MarginfiRepayParams {
  bankMint: string;
  amount: string;
  repayAll?: boolean;
}

export interface MarginfiResult {
  signature: string;
  amount?: string;
  symbol?: string;
}

// ============================================
// FUNCTIONS
// ============================================

/**
 * Get user's marginfi account with positions
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair
 * @returns Account info with deposits, borrows, and health, or null if none
 */
export async function getMarginfiAccount(
  connection: Connection,
  keypair: Keypair
): Promise<MarginfiAccountInfo | null> {
  try {
    const { MarginfiClient, getConfig, MarginRequirementType } = await import('@mrgnlabs/marginfi-client-v2');
    const anchor = await import('@coral-xyz/anchor');

    const config = getConfig('production');
    const wallet = new anchor.Wallet(keypair);
    const client = await MarginfiClient.fetch(config, wallet as any, connection);

    const accounts = await client.getMarginfiAccountsForAuthority(keypair.publicKey);
    if (!accounts || accounts.length === 0) {
      return null;
    }

    const account = accounts[0];
    const deposits: MarginfiPositionInfo[] = [];
    const borrows: MarginfiPositionInfo[] = [];
    let totalDepositValue = 0;
    let totalBorrowValue = 0;

    for (const balance of account.activeBalances) {
      try {
        const bank = client.getBankByPk(balance.bankPk);
        if (!bank) continue;
        const oraclePrice = client.getOraclePriceByBank(bank.address);
        if (!oraclePrice) continue;

        const symbol = bank.tokenSymbol || 'UNKNOWN';
        const mint = bank.mint.toBase58();
        const { assets: assetsQty, liabilities: liabsQty } = balance.computeQuantityUi(bank);
        const { assets: assetsUsd, liabilities: liabsUsd } = balance.computeUsdValue(bank, oraclePrice);

        const depositAmount = assetsQty.toNumber();
        const borrowAmount = liabsQty.toNumber();
        const depositUsd = assetsUsd.toNumber();
        const borrowUsd = liabsUsd.toNumber();

        if (depositAmount > 0) {
          deposits.push({
            bankAddress: balance.bankPk.toBase58(),
            symbol,
            mint,
            amount: depositAmount.toString(),
            amountUsd: depositUsd.toString(),
          });
          totalDepositValue += depositUsd;
        }

        if (borrowAmount > 0) {
          borrows.push({
            bankAddress: balance.bankPk.toBase58(),
            symbol,
            mint,
            amount: borrowAmount.toString(),
            amountUsd: borrowUsd.toString(),
          });
          totalBorrowValue += borrowUsd;
        }
      } catch {
        // Skip balances that fail to parse
      }
    }

    const { assets: maintAssets, liabilities: maintLiabs } = account.computeHealthComponents(
      MarginRequirementType.Maintenance
    );
    const healthFactor = maintLiabs.isZero() ? Infinity : maintAssets.dividedBy(maintLiabs).toNumber();
    const ltv = totalDepositValue > 0 ? (totalBorrowValue / totalDepositValue) * 100 : 0;

    return {
      address: account.address.toBase58(),
      owner: keypair.publicKey.toBase58(),
      deposits,
      borrows,
      totalDepositValue: totalDepositValue.toString(),
      totalBorrowValue: totalBorrowValue.toString(),
      healthFactor,
      ltv,
    };
  } catch (error) {
    logger.error({ error }, 'Failed to get MarginFi account');
    return null;
  }
}

/**
 * Get all MarginFi banks (lending pools) with rates and utilization
 * @param connection - Solana RPC connection
 * @returns Array of banks with APY, utilization, and LTV
 */
export async function getMarginfiBanks(
  connection: Connection
): Promise<MarginfiBankInfo[]> {
  try {
    const { MarginfiClient, getConfig, MarginRequirementType, PriceBias } = await import(
      '@mrgnlabs/marginfi-client-v2'
    );

    const config = getConfig('production');
    const readOnlyWallet = {
      publicKey: PublicKey.default,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any) => txs,
    };
    const client = await MarginfiClient.fetch(config, readOnlyWallet as any, connection);

    const banks: MarginfiBankInfo[] = [];

    for (const [, bank] of client.banks) {
      try {
        const oraclePrice = client.getOraclePriceByBank(bank.address);
        if (!oraclePrice) continue;

        const { lendingRate, borrowingRate } = bank.computeInterestRates();
        const totalDeposits = bank
          .computeAssetUsdValue(oraclePrice, bank.totalAssetShares, MarginRequirementType.Equity, PriceBias.None)
          .toNumber();
        const totalBorrows = bank
          .computeLiabilityUsdValue(oraclePrice, bank.totalLiabilityShares, MarginRequirementType.Equity, PriceBias.None)
          .toNumber();
        const utilization = totalDeposits > 0 ? (totalBorrows / totalDeposits) * 100 : 0;

        banks.push({
          address: bank.address.toBase58(),
          symbol: bank.tokenSymbol || 'UNKNOWN',
          mint: bank.mint.toBase58(),
          decimals: bank.mintDecimals,
          depositRate: lendingRate.toNumber() * 100,
          borrowRate: borrowingRate.toNumber() * 100,
          totalDeposits: totalDeposits.toString(),
          totalBorrows: totalBorrows.toString(),
          availableLiquidity: (totalDeposits - totalBorrows).toString(),
          utilizationRate: utilization,
          ltv: bank.config.assetWeightInit.toNumber(),
          liquidationThreshold: bank.config.assetWeightMaint.toNumber(),
        });
      } catch {
        // Skip banks that fail to parse
      }
    }

    return banks;
  } catch (error) {
    logger.error({ error }, 'Failed to get MarginFi banks');
    return [];
  }
}

/**
 * Deposit collateral to MarginFi
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair (signs transaction)
 * @param params - Deposit params: bankMint, amount (in base units)
 * @returns Transaction signature and amount deposited
 */
export async function marginfiDeposit(
  connection: Connection,
  keypair: Keypair,
  params: MarginfiDepositParams
): Promise<MarginfiResult> {
  const { MarginfiClient, getConfig } = await import('@mrgnlabs/marginfi-client-v2');
  const anchor = await import('@coral-xyz/anchor');

  const config = getConfig('production');
  const wallet = new anchor.Wallet(keypair);
  const client = await MarginfiClient.fetch(config, wallet as any, connection);

  const bank = client.getBankByMint(params.bankMint);
  if (!bank) {
    throw new Error(`Bank not found for mint: ${params.bankMint}`);
  }

  // Get or create marginfi account
  const accounts = await client.getMarginfiAccountsForAuthority(keypair.publicKey);
  const account = accounts?.[0] ?? (await client.createMarginfiAccount());

  const signature = await account.deposit(params.amount, bank.address);

  return {
    signature,
    amount: params.amount,
    symbol: bank.tokenSymbol,
  };
}

/**
 * Withdraw collateral from MarginFi
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair (signs transaction)
 * @param params - Withdraw params: bankMint, amount, withdrawAll flag
 * @returns Transaction signature and amount withdrawn
 */
export async function marginfiWithdraw(
  connection: Connection,
  keypair: Keypair,
  params: MarginfiWithdrawParams
): Promise<MarginfiResult> {
  const { MarginfiClient, getConfig } = await import('@mrgnlabs/marginfi-client-v2');
  const anchor = await import('@coral-xyz/anchor');

  const config = getConfig('production');
  const wallet = new anchor.Wallet(keypair);
  const client = await MarginfiClient.fetch(config, wallet as any, connection);

  const bank = client.getBankByMint(params.bankMint);
  if (!bank) {
    throw new Error(`Bank not found for mint: ${params.bankMint}`);
  }

  const accounts = await client.getMarginfiAccountsForAuthority(keypair.publicKey);
  const account = accounts?.[0];
  if (!account) throw new Error('No MarginFi account found');

  const amount = params.withdrawAll ? 0 : params.amount;
  const signatures = await account.withdraw(amount, bank.address, params.withdrawAll);

  return {
    signature: signatures[signatures.length - 1],
    amount: params.amount,
    symbol: bank.tokenSymbol,
  };
}

/**
 * Borrow assets from MarginFi (requires collateral)
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair (signs transaction)
 * @param params - Borrow params: bankMint, amount (in base units)
 * @returns Transaction signature and amount borrowed
 */
export async function marginfiBorrow(
  connection: Connection,
  keypair: Keypair,
  params: MarginfiBorrowParams
): Promise<MarginfiResult> {
  const { MarginfiClient, getConfig } = await import('@mrgnlabs/marginfi-client-v2');
  const anchor = await import('@coral-xyz/anchor');

  const config = getConfig('production');
  const wallet = new anchor.Wallet(keypair);
  const client = await MarginfiClient.fetch(config, wallet as any, connection);

  const bank = client.getBankByMint(params.bankMint);
  if (!bank) {
    throw new Error(`Bank not found for mint: ${params.bankMint}`);
  }

  const accounts = await client.getMarginfiAccountsForAuthority(keypair.publicKey);
  const account = accounts?.[0];
  if (!account) throw new Error('No MarginFi account found. Deposit collateral first.');

  const signatures = await account.borrow(params.amount, bank.address);

  return {
    signature: signatures[signatures.length - 1],
    amount: params.amount,
    symbol: bank.tokenSymbol,
  };
}

/**
 * Repay borrowed assets to MarginFi
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair (signs transaction)
 * @param params - Repay params: bankMint, amount, repayAll flag
 * @returns Transaction signature and amount repaid
 */
export async function marginfiRepay(
  connection: Connection,
  keypair: Keypair,
  params: MarginfiRepayParams
): Promise<MarginfiResult> {
  const { MarginfiClient, getConfig } = await import('@mrgnlabs/marginfi-client-v2');
  const anchor = await import('@coral-xyz/anchor');

  const config = getConfig('production');
  const wallet = new anchor.Wallet(keypair);
  const client = await MarginfiClient.fetch(config, wallet as any, connection);

  const bank = client.getBankByMint(params.bankMint);
  if (!bank) {
    throw new Error(`Bank not found for mint: ${params.bankMint}`);
  }

  const accounts = await client.getMarginfiAccountsForAuthority(keypair.publicKey);
  const account = accounts?.[0];
  if (!account) throw new Error('No MarginFi account found');

  const amount = params.repayAll ? 0 : params.amount;
  const signature = await account.repay(amount, bank.address, params.repayAll);

  return {
    signature,
    amount: params.amount,
    symbol: bank.tokenSymbol,
  };
}

/**
 * Get health factor and risk level for user's MarginFi position
 * @param connection - Solana RPC connection
 * @param keypair - User's wallet keypair
 * @returns Account info with health metrics, or null if no account
 */
export async function getMarginfiHealth(
  connection: Connection,
  keypair: Keypair
): Promise<MarginfiAccountInfo | null> {
  return getMarginfiAccount(connection, keypair);
}
