/**
 * EVM Token Transfers
 *
 * Send ETH and ERC20 tokens across chains.
 */

import { Wallet, Contract, parseUnits, parseEther, formatUnits, formatEther, isAddress } from 'ethers';
import { getProvider, getChainConfig, ChainName } from './multichain';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface TransferRequest {
  chain: ChainName;
  to: string;
  amount: string;          // Human-readable amount
  privateKey: string;
}

export interface TokenTransferRequest extends TransferRequest {
  tokenAddress: string;
}

export interface TransferResult {
  success: boolean;
  txHash?: string;
  from: string;
  to: string;
  amount: string;
  token?: string;          // Token symbol if ERC20
  error?: string;
}

export interface GasEstimate {
  gasLimit: bigint;
  gasPrice: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  estimatedCost: string;   // In native token
}

// =============================================================================
// ABI
// =============================================================================

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate Ethereum address
 */
export function validateAddress(address: string): boolean {
  return isAddress(address);
}

/**
 * Validate transfer amount
 */
export function validateAmount(amount: string): boolean {
  try {
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0;
  } catch {
    return false;
  }
}

// =============================================================================
// GAS ESTIMATION
// =============================================================================

/**
 * Estimate gas for native token transfer
 */
export async function estimateNativeTransferGas(
  chain: ChainName,
  to: string,
  amount: string
): Promise<GasEstimate> {
  const provider = getProvider(chain);
  const config = getChainConfig(chain);

  const value = parseEther(amount);
  const gasLimit = await provider.estimateGas({ to, value });
  const feeData = await provider.getFeeData();

  const gasPrice = feeData.gasPrice || BigInt(0);
  const estimatedCost = formatEther(gasLimit * gasPrice);

  return {
    gasLimit,
    gasPrice,
    maxFeePerGas: feeData.maxFeePerGas || undefined,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    estimatedCost,
  };
}

/**
 * Estimate gas for ERC20 transfer
 */
export async function estimateTokenTransferGas(
  chain: ChainName,
  tokenAddress: string,
  to: string,
  amount: string,
  fromAddress: string
): Promise<GasEstimate> {
  const provider = getProvider(chain);
  const token = new Contract(tokenAddress, ERC20_ABI, provider);

  const decimals = await token.decimals().catch(() => 18);
  const value = parseUnits(amount, Number(decimals));

  // Estimate gas for transfer call
  const gasLimit = await token.transfer.estimateGas(to, value, { from: fromAddress });
  const feeData = await provider.getFeeData();

  const gasPrice = feeData.gasPrice || BigInt(0);
  const estimatedCost = formatEther(gasLimit * gasPrice);

  return {
    gasLimit,
    gasPrice,
    maxFeePerGas: feeData.maxFeePerGas || undefined,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    estimatedCost,
  };
}

// =============================================================================
// TRANSFERS
// =============================================================================

/**
 * Send native token (ETH, MATIC, BNB, etc.)
 */
export async function sendNative(request: TransferRequest): Promise<TransferResult> {
  const { chain, to, amount, privateKey } = request;

  if (!validateAddress(to)) {
    return {
      success: false,
      from: '',
      to,
      amount,
      error: 'Invalid recipient address',
    };
  }

  if (!validateAmount(amount)) {
    return {
      success: false,
      from: '',
      to,
      amount,
      error: 'Invalid amount',
    };
  }

  try {
    const provider = getProvider(chain);
    const config = getChainConfig(chain);
    const wallet = new Wallet(privateKey, provider);

    const value = parseEther(amount);

    // Check balance
    const balance = await provider.getBalance(wallet.address);
    if (balance < value) {
      return {
        success: false,
        from: wallet.address,
        to,
        amount,
        error: `Insufficient ${config.nativeCurrency.symbol} balance`,
      };
    }

    logger.info({
      chain,
      from: wallet.address,
      to,
      amount: `${amount} ${config.nativeCurrency.symbol}`,
    }, 'Sending native token');

    const tx = await wallet.sendTransaction({ to, value });
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: receipt?.hash,
      from: wallet.address,
      to,
      amount,
      token: config.nativeCurrency.symbol,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Native transfer failed');

    return {
      success: false,
      from: '',
      to,
      amount,
      error: message,
    };
  }
}

/**
 * Send ERC20 token
 */
export async function sendToken(request: TokenTransferRequest): Promise<TransferResult> {
  const { chain, to, amount, privateKey, tokenAddress } = request;

  if (!validateAddress(to)) {
    return {
      success: false,
      from: '',
      to,
      amount,
      error: 'Invalid recipient address',
    };
  }

  if (!validateAddress(tokenAddress)) {
    return {
      success: false,
      from: '',
      to,
      amount,
      error: 'Invalid token address',
    };
  }

  if (!validateAmount(amount)) {
    return {
      success: false,
      from: '',
      to,
      amount,
      error: 'Invalid amount',
    };
  }

  try {
    const provider = getProvider(chain);
    const wallet = new Wallet(privateKey, provider);
    const token = new Contract(tokenAddress, ERC20_ABI, wallet);

    // Get token info
    const [decimals, symbol] = await Promise.all([
      token.decimals().catch(() => 18),
      token.symbol().catch(() => 'TOKEN'),
    ]);

    const value = parseUnits(amount, Number(decimals));

    // Check balance
    const balance = await token.balanceOf(wallet.address);
    if (balance < value) {
      return {
        success: false,
        from: wallet.address,
        to,
        amount,
        token: symbol,
        error: `Insufficient ${symbol} balance`,
      };
    }

    logger.info({
      chain,
      token: symbol,
      from: wallet.address,
      to,
      amount,
    }, 'Sending ERC20 token');

    const tx = await token.transfer(to, value);
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: receipt?.hash,
      from: wallet.address,
      to,
      amount,
      token: symbol,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Token transfer failed');

    return {
      success: false,
      from: '',
      to,
      amount,
      error: message,
    };
  }
}

// =============================================================================
// BATCH TRANSFERS
// =============================================================================

export interface BatchTransferItem {
  to: string;
  amount: string;
}

/**
 * Send native token to multiple recipients
 */
export async function sendNativeBatch(
  chain: ChainName,
  recipients: BatchTransferItem[],
  privateKey: string
): Promise<TransferResult[]> {
  const results: TransferResult[] = [];

  for (const { to, amount } of recipients) {
    const result = await sendNative({ chain, to, amount, privateKey });
    results.push(result);

    // Small delay between transactions to avoid nonce issues
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}

/**
 * Send ERC20 token to multiple recipients
 */
export async function sendTokenBatch(
  chain: ChainName,
  tokenAddress: string,
  recipients: BatchTransferItem[],
  privateKey: string
): Promise<TransferResult[]> {
  const results: TransferResult[] = [];

  for (const { to, amount } of recipients) {
    const result = await sendToken({ chain, to, amount, privateKey, tokenAddress });
    results.push(result);

    // Small delay between transactions
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Get pending transaction count (nonce)
 */
export async function getNonce(chain: ChainName, address: string): Promise<number> {
  const provider = getProvider(chain);
  return provider.getTransactionCount(address, 'pending');
}

/**
 * Wait for transaction confirmation
 */
export async function waitForTransaction(
  chain: ChainName,
  txHash: string,
  confirmations = 1
): Promise<boolean> {
  const provider = getProvider(chain);
  const receipt = await provider.waitForTransaction(txHash, confirmations);
  return receipt?.status === 1;
}

/**
 * Speed up transaction by replacing with higher gas
 */
export async function speedUpTransaction(
  chain: ChainName,
  originalTxHash: string,
  privateKey: string,
  gasPriceMultiplier = 1.5
): Promise<TransferResult> {
  try {
    const provider = getProvider(chain);
    const wallet = new Wallet(privateKey, provider);

    const originalTx = await provider.getTransaction(originalTxHash);
    if (!originalTx) {
      return {
        success: false,
        from: wallet.address,
        to: '',
        amount: '0',
        error: 'Original transaction not found',
      };
    }

    const newGasPrice = BigInt(Math.floor(Number(originalTx.gasPrice || 0) * gasPriceMultiplier));

    const tx = await wallet.sendTransaction({
      to: originalTx.to,
      value: originalTx.value,
      data: originalTx.data,
      nonce: originalTx.nonce,
      gasPrice: newGasPrice,
      gasLimit: originalTx.gasLimit,
    });

    const receipt = await tx.wait();

    return {
      success: true,
      txHash: receipt?.hash,
      from: wallet.address,
      to: originalTx.to || '',
      amount: formatEther(originalTx.value),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      from: '',
      to: '',
      amount: '0',
      error: message,
    };
  }
}

/**
 * Cancel pending transaction by sending 0 ETH to self with same nonce
 */
export async function cancelTransaction(
  chain: ChainName,
  nonce: number,
  privateKey: string,
  gasPriceMultiplier = 1.5
): Promise<TransferResult> {
  try {
    const provider = getProvider(chain);
    const wallet = new Wallet(privateKey, provider);
    const feeData = await provider.getFeeData();

    const gasPrice = BigInt(Math.floor(Number(feeData.gasPrice || 0) * gasPriceMultiplier));

    const tx = await wallet.sendTransaction({
      to: wallet.address,
      value: 0n,
      nonce,
      gasPrice,
      gasLimit: 21000n,
    });

    const receipt = await tx.wait();

    return {
      success: true,
      txHash: receipt?.hash,
      from: wallet.address,
      to: wallet.address,
      amount: '0',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      from: '',
      to: '',
      amount: '0',
      error: message,
    };
  }
}
