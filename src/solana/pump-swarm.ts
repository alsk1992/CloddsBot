/**
 * Pump.fun Swarm Trading System
 *
 * Coordinates multiple wallets to execute trades on Pump.fun tokens.
 * Supports atomic execution via Jito bundles or staggered sequential execution.
 */

import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';
import bs58 from 'bs58';

// ============================================================================
// Types
// ============================================================================

export interface SwarmWallet {
  id: string;
  keypair: Keypair;
  publicKey: string;
  balance: number;
  positions: Map<string, number>; // mint -> token amount
  lastTradeAt: number;
  enabled: boolean;
}

export interface SwarmConfig {
  rpcUrl: string;
  wallets: SwarmWallet[];
  maxConcurrentTrades: number;
  rateLimitMs: number;
  bundleEnabled: boolean;
  jitoTipLamports: number;
  defaultSlippageBps: number;
  staggerDelayMs: number;
  amountVariancePct: number;
}

export interface SwarmTradeParams {
  mint: string;
  action: 'buy' | 'sell';
  amountPerWallet: number | string; // SOL for buy, tokens or "100%" for sell
  denominatedInSol?: boolean;
  slippageBps?: number;
  priorityFeeLamports?: number;
  pool?: string;
  useBundle?: boolean;
  walletIds?: string[]; // Specific wallets, or all if omitted
}

export interface SwarmTradeResult {
  success: boolean;
  mint: string;
  action: 'buy' | 'sell';
  walletResults: WalletTradeResult[];
  bundleId?: string;
  totalAmount: number;
  avgPrice?: number;
  executionTimeMs: number;
}

export interface WalletTradeResult {
  walletId: string;
  publicKey: string;
  success: boolean;
  signature?: string;
  amount?: number;
  price?: number;
  error?: string;
}

export interface SwarmPosition {
  mint: string;
  totalAmount: number;
  byWallet: Map<string, number>;
  entryPrice?: number;
  currentPrice?: number;
  unrealizedPnl?: number;
}

// ============================================================================
// Constants
// ============================================================================

const PUMPPORTAL_API = 'https://pumpportal.fun/api';
const JITO_BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf';
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bVmkdzeF3DY3kfvJf3hXba',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

// ============================================================================
// Wallet Pool Management
// ============================================================================

export function loadWalletsFromEnv(): SwarmWallet[] {
  const wallets: SwarmWallet[] = [];

  // Load SOLANA_PRIVATE_KEY as wallet 0
  const mainKey = process.env.SOLANA_PRIVATE_KEY;
  if (mainKey) {
    try {
      const keypair = loadKeypairFromString(mainKey);
      wallets.push({
        id: 'wallet_0',
        keypair,
        publicKey: keypair.publicKey.toBase58(),
        balance: 0,
        positions: new Map(),
        lastTradeAt: 0,
        enabled: true,
      });
    } catch (e) {
      console.error('Failed to load SOLANA_PRIVATE_KEY:', e);
    }
  }

  // Load SOLANA_SWARM_KEY_1, SOLANA_SWARM_KEY_2, etc.
  for (let i = 1; i <= 20; i++) {
    const key = process.env[`SOLANA_SWARM_KEY_${i}`];
    if (!key) continue;

    try {
      const keypair = loadKeypairFromString(key);
      wallets.push({
        id: `wallet_${i}`,
        keypair,
        publicKey: keypair.publicKey.toBase58(),
        balance: 0,
        positions: new Map(),
        lastTradeAt: 0,
        enabled: true,
      });
    } catch (e) {
      console.error(`Failed to load SOLANA_SWARM_KEY_${i}:`, e);
    }
  }

  return wallets;
}

function loadKeypairFromString(keyStr: string): Keypair {
  // Try base58
  try {
    const decoded = bs58.decode(keyStr);
    if (decoded.length === 64) {
      return Keypair.fromSecretKey(decoded);
    }
  } catch {}

  // Try JSON array
  try {
    const arr = JSON.parse(keyStr);
    if (Array.isArray(arr)) {
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
  } catch {}

  // Try hex
  try {
    const hex = keyStr.replace(/^0x/, '');
    const bytes = Buffer.from(hex, 'hex');
    if (bytes.length === 64) {
      return Keypair.fromSecretKey(bytes);
    }
  } catch {}

  throw new Error('Invalid key format');
}

// ============================================================================
// PumpFun Swarm Class
// ============================================================================

export class PumpFunSwarm extends EventEmitter {
  private connection: Connection;
  private wallets: Map<string, SwarmWallet>;
  private config: SwarmConfig;

  constructor(config: Partial<SwarmConfig> = {}) {
    super();

    const rpcUrl = config.rpcUrl || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');

    const loadedWallets = config.wallets || loadWalletsFromEnv();
    this.wallets = new Map(loadedWallets.map(w => [w.id, w]));

    this.config = {
      rpcUrl,
      wallets: loadedWallets,
      maxConcurrentTrades: config.maxConcurrentTrades ?? 5,
      rateLimitMs: config.rateLimitMs ?? 5000,
      bundleEnabled: config.bundleEnabled ?? true,
      jitoTipLamports: config.jitoTipLamports ?? 10000,
      defaultSlippageBps: config.defaultSlippageBps ?? 500,
      staggerDelayMs: config.staggerDelayMs ?? 200,
      amountVariancePct: config.amountVariancePct ?? 5,
    };
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  getWallets(): SwarmWallet[] {
    return Array.from(this.wallets.values());
  }

  getWallet(id: string): SwarmWallet | undefined {
    return this.wallets.get(id);
  }

  getEnabledWallets(): SwarmWallet[] {
    return this.getWallets().filter(w => w.enabled);
  }

  enableWallet(id: string): void {
    const wallet = this.wallets.get(id);
    if (wallet) wallet.enabled = true;
  }

  disableWallet(id: string): void {
    const wallet = this.wallets.get(id);
    if (wallet) wallet.enabled = false;
  }

  async refreshBalances(): Promise<Map<string, number>> {
    const balances = new Map<string, number>();

    await Promise.all(
      this.getWallets().map(async (wallet) => {
        try {
          const balance = await this.connection.getBalance(wallet.keypair.publicKey);
          wallet.balance = balance / 1e9; // Convert lamports to SOL
          balances.set(wallet.id, wallet.balance);
        } catch (e) {
          console.error(`Failed to get balance for ${wallet.id}:`, e);
        }
      })
    );

    return balances;
  }

  getSwarmPosition(mint: string): SwarmPosition {
    const byWallet = new Map<string, number>();
    let totalAmount = 0;

    for (const wallet of this.wallets.values()) {
      const amount = wallet.positions.get(mint) || 0;
      if (amount > 0) {
        byWallet.set(wallet.id, amount);
        totalAmount += amount;
      }
    }

    return { mint, totalAmount, byWallet };
  }

  // --------------------------------------------------------------------------
  // Coordinated Trading
  // --------------------------------------------------------------------------

  async coordinatedBuy(params: SwarmTradeParams): Promise<SwarmTradeResult> {
    const startTime = Date.now();
    const wallets = this.selectWallets(params.walletIds);

    if (wallets.length === 0) {
      return {
        success: false,
        mint: params.mint,
        action: 'buy',
        walletResults: [],
        totalAmount: 0,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const useBundle = params.useBundle ?? this.config.bundleEnabled;

    if (useBundle && wallets.length > 1) {
      return this.executeBundledTrade(params, wallets, startTime);
    } else {
      return this.executeStaggeredTrade(params, wallets, startTime);
    }
  }

  async coordinatedSell(params: SwarmTradeParams): Promise<SwarmTradeResult> {
    const startTime = Date.now();
    const wallets = this.selectWallets(params.walletIds);

    if (wallets.length === 0) {
      return {
        success: false,
        mint: params.mint,
        action: 'sell',
        walletResults: [],
        totalAmount: 0,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Filter to wallets with positions
    const walletsWithPosition = wallets.filter(w => {
      const pos = w.positions.get(params.mint);
      return pos && pos > 0;
    });

    if (walletsWithPosition.length === 0) {
      return {
        success: false,
        mint: params.mint,
        action: 'sell',
        walletResults: [],
        totalAmount: 0,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const useBundle = params.useBundle ?? this.config.bundleEnabled;

    if (useBundle && walletsWithPosition.length > 1) {
      return this.executeBundledTrade(params, walletsWithPosition, startTime);
    } else {
      return this.executeStaggeredTrade(params, walletsWithPosition, startTime);
    }
  }

  // --------------------------------------------------------------------------
  // Bundle Execution (Atomic via Jito)
  // --------------------------------------------------------------------------

  private async executeBundledTrade(
    params: SwarmTradeParams,
    wallets: SwarmWallet[],
    startTime: number
  ): Promise<SwarmTradeResult> {
    const walletResults: WalletTradeResult[] = [];
    const transactions: VersionedTransaction[] = [];

    // Build transactions for each wallet
    for (const wallet of wallets) {
      try {
        const amount = this.calculateAmount(params.amountPerWallet, wallet, params.mint);
        const tx = await this.buildTransaction(wallet, params, amount);
        if (tx) {
          transactions.push(tx);
          walletResults.push({
            walletId: wallet.id,
            publicKey: wallet.publicKey,
            success: false, // Will update after submission
            amount,
          });
        }
      } catch (e) {
        walletResults.push({
          walletId: wallet.id,
          publicKey: wallet.publicKey,
          success: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (transactions.length === 0) {
      return {
        success: false,
        mint: params.mint,
        action: params.action,
        walletResults,
        totalAmount: 0,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Submit via Jito bundle
    try {
      const bundleId = await this.submitJitoBundle(transactions);

      // Mark all as successful
      for (const result of walletResults) {
        if (!result.error) {
          result.success = true;
        }
      }

      // Update positions
      this.updatePositionsAfterTrade(walletResults, params);

      const totalAmount = walletResults
        .filter(r => r.success)
        .reduce((sum, r) => sum + (r.amount || 0), 0);

      return {
        success: true,
        mint: params.mint,
        action: params.action,
        walletResults,
        bundleId,
        totalAmount,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (bundleError) {
      // Fallback to staggered execution
      console.warn('Bundle submission failed, falling back to staggered:', bundleError);
      return this.executeStaggeredTrade(params, wallets, startTime);
    }
  }

  private async submitJitoBundle(transactions: VersionedTransaction[]): Promise<string> {
    // Add tip transaction
    const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];

    // Serialize transactions
    const serializedTxs = transactions.map(tx =>
      Buffer.from(tx.serialize()).toString('base64')
    );

    const response = await fetch(`${JITO_BLOCK_ENGINE}/api/v1/bundles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [serializedTxs],
      }),
    });

    if (!response.ok) {
      throw new Error(`Jito bundle submission failed: ${response.status}`);
    }

    const result = await response.json() as { result?: string; error?: { message: string } };

    if (result.error) {
      throw new Error(`Jito error: ${result.error.message}`);
    }

    return result.result || 'bundle_submitted';
  }

  // --------------------------------------------------------------------------
  // Staggered Execution (Sequential with delays)
  // --------------------------------------------------------------------------

  private async executeStaggeredTrade(
    params: SwarmTradeParams,
    wallets: SwarmWallet[],
    startTime: number
  ): Promise<SwarmTradeResult> {
    const walletResults: WalletTradeResult[] = [];

    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];

      // Rate limiting
      const timeSinceLastTrade = Date.now() - wallet.lastTradeAt;
      if (timeSinceLastTrade < this.config.rateLimitMs) {
        await sleep(this.config.rateLimitMs - timeSinceLastTrade);
      }

      // Stagger delay between wallets
      if (i > 0) {
        const delay = this.config.staggerDelayMs + Math.random() * this.config.staggerDelayMs;
        await sleep(delay);
      }

      try {
        const amount = this.calculateAmount(params.amountPerWallet, wallet, params.mint);
        const result = await this.executeSingleTrade(wallet, params, amount);
        walletResults.push(result);

        wallet.lastTradeAt = Date.now();
      } catch (e) {
        walletResults.push({
          walletId: wallet.id,
          publicKey: wallet.publicKey,
          success: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Update positions
    this.updatePositionsAfterTrade(walletResults, params);

    const successCount = walletResults.filter(r => r.success).length;
    const totalAmount = walletResults
      .filter(r => r.success)
      .reduce((sum, r) => sum + (r.amount || 0), 0);

    return {
      success: successCount > 0,
      mint: params.mint,
      action: params.action,
      walletResults,
      totalAmount,
      executionTimeMs: Date.now() - startTime,
    };
  }

  private async executeSingleTrade(
    wallet: SwarmWallet,
    params: SwarmTradeParams,
    amount: number
  ): Promise<WalletTradeResult> {
    const tx = await this.buildTransaction(wallet, params, amount);
    if (!tx) {
      return {
        walletId: wallet.id,
        publicKey: wallet.publicKey,
        success: false,
        error: 'Failed to build transaction',
      };
    }

    // Sign and send
    tx.sign([wallet.keypair]);
    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    // Confirm
    await this.connection.confirmTransaction(signature, 'confirmed');

    return {
      walletId: wallet.id,
      publicKey: wallet.publicKey,
      success: true,
      signature,
      amount,
    };
  }

  // --------------------------------------------------------------------------
  // Transaction Building
  // --------------------------------------------------------------------------

  private async buildTransaction(
    wallet: SwarmWallet,
    params: SwarmTradeParams,
    amount: number
  ): Promise<VersionedTransaction | null> {
    const apiKey = process.env.PUMPPORTAL_API_KEY;
    const url = apiKey
      ? `${PUMPPORTAL_API}/trade-local?api-key=${apiKey}`
      : `${PUMPPORTAL_API}/trade-local`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: wallet.publicKey,
        action: params.action,
        mint: params.mint,
        amount: amount,
        denominatedInSol: params.denominatedInSol ?? (params.action === 'buy'),
        slippage: (params.slippageBps ?? this.config.defaultSlippageBps) / 100,
        priorityFee: params.priorityFeeLamports ?? 10000,
        pool: params.pool ?? 'auto',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`PumpPortal API error: ${response.status} - ${text}`);
    }

    const txData = await response.arrayBuffer();
    return VersionedTransaction.deserialize(new Uint8Array(txData));
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private selectWallets(walletIds?: string[]): SwarmWallet[] {
    if (walletIds && walletIds.length > 0) {
      return walletIds
        .map(id => this.wallets.get(id))
        .filter((w): w is SwarmWallet => w !== undefined && w.enabled);
    }
    return this.getEnabledWallets();
  }

  private calculateAmount(
    baseAmount: number | string,
    wallet: SwarmWallet,
    mint: string
  ): number {
    let amount: number;

    if (typeof baseAmount === 'string' && baseAmount.endsWith('%')) {
      // Percentage of position
      const pct = parseFloat(baseAmount) / 100;
      const position = wallet.positions.get(mint) || 0;
      amount = position * pct;
    } else {
      amount = typeof baseAmount === 'string' ? parseFloat(baseAmount) : baseAmount;
    }

    // Apply variance
    if (this.config.amountVariancePct > 0) {
      const variance = amount * (this.config.amountVariancePct / 100);
      amount += (Math.random() - 0.5) * 2 * variance;
    }

    return Math.max(0, amount);
  }

  private updatePositionsAfterTrade(
    results: WalletTradeResult[],
    params: SwarmTradeParams
  ): void {
    for (const result of results) {
      if (!result.success || !result.amount) continue;

      const wallet = this.wallets.get(result.walletId);
      if (!wallet) continue;

      const currentPosition = wallet.positions.get(params.mint) || 0;

      if (params.action === 'buy') {
        // Estimate tokens received (rough - actual comes from chain)
        wallet.positions.set(params.mint, currentPosition + result.amount * 1000000);
      } else {
        // Reduce position
        const newPosition = Math.max(0, currentPosition - result.amount);
        if (newPosition > 0) {
          wallet.positions.set(params.mint, newPosition);
        } else {
          wallet.positions.delete(params.mint);
        }
      }
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Factory Function
// ============================================================================

let swarmInstance: PumpFunSwarm | null = null;

export function getSwarm(config?: Partial<SwarmConfig>): PumpFunSwarm {
  if (!swarmInstance || config) {
    swarmInstance = new PumpFunSwarm(config);
  }
  return swarmInstance;
}

export function createSwarm(config?: Partial<SwarmConfig>): PumpFunSwarm {
  return new PumpFunSwarm(config);
}
