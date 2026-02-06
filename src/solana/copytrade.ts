/**
 * Standalone Copy Trading System
 *
 * Monitor target wallets on Solana and mirror their trades using a single wallet.
 * Works independently of the swarm system.
 *
 * Features:
 * - Real-time wallet monitoring via Solana WebSocket
 * - Trade detection (buy/sell on Pump.fun, Raydium, Jupiter, etc.)
 * - Configurable position sizing (multiplier, max amount)
 * - Token whitelist/blacklist
 * - SQLite persistence for configs + trade history
 */

import { Connection, PublicKey, ParsedTransactionWithMeta, Keypair } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { generateId } from '../utils/id';
import { loadSolanaKeypair, getSolanaConnection } from './wallet';

// ============================================================================
// Types
// ============================================================================

export interface CopyTradeConfig {
  targetWallet: string;
  multiplier: number;        // 0.5x, 1x, 2x position sizing
  maxPositionSol: number;    // Max per trade
  minTradeSol: number;       // Ignore tiny trades
  copyBuys: boolean;
  copySells: boolean;
  allowedMints?: string[];   // Whitelist tokens
  blockedMints?: string[];   // Blacklist tokens
  delayMs?: number;          // Delay before copying (stealth)
  slippageBps?: number;      // Slippage tolerance
}

export interface CopyTarget {
  id: string;
  address: string;
  name?: string;
  enabled: boolean;
  config: CopyTradeConfig;
  stats: CopyStats;
  createdAt: number;
}

export interface CopyStats {
  totalTradesCopied: number;
  totalSolSpent: number;
  totalSolReceived: number;
  successfulTrades: number;
  failedTrades: number;
  lastTradeAt?: number;
  pnlSol: number;
}

export interface DetectedTrade {
  targetAddress: string;
  signature: string;
  action: 'buy' | 'sell';
  mint: string;
  solAmount: number;
  tokenAmount: number;
  dex: string;
  timestamp: number;
}

export interface CopyResult {
  targetTrade: DetectedTrade;
  success: boolean;
  solSpent?: number;
  solReceived?: number;
  tokensReceived?: number;
  error?: string;
  signature?: string;
}

export interface CopyTradeHistoryEntry {
  id: string;
  configId: string;
  originalTx: string;
  ourTx?: string;
  mint: string;
  action: 'buy' | 'sell';
  originalAmount: number;
  ourAmount: number;
  status: 'pending' | 'success' | 'failed';
  error?: string;
  createdAt: number;
}

// Known DEX program IDs for trade detection
const DEX_PROGRAMS: Record<string, string> = {
  PUMP_FUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  RAYDIUM_AMM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  RAYDIUM_CLMM: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  JUPITER_V6: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  METEORA_DLMM: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// ============================================================================
// CopyTrader Class
// ============================================================================

export class CopyTrader extends EventEmitter {
  private connection: Connection;
  private keypair: Keypair;
  private targets: Map<string, CopyTarget> = new Map();
  private subscriptions: Map<string, number> = new Map();
  private processing: Set<string> = new Set();
  private recentTrades: Map<string, number> = new Map();
  private tradeHistory: CopyTradeHistoryEntry[] = [];

  constructor(connection?: Connection, keypair?: Keypair) {
    super();
    this.connection = connection || getSolanaConnection();
    this.keypair = keypair || loadSolanaKeypair();

    // Clean up old trade signatures periodically
    setInterval(() => this.cleanupRecentTrades(), 60000);
  }

  // --------------------------------------------------------------------------
  // Target Management
  // --------------------------------------------------------------------------

  addTarget(address: string, config: Partial<CopyTradeConfig> = {}, name?: string): CopyTarget {
    // Check if already tracking this address
    const existing = this.getTargetByAddress(address);
    if (existing) {
      throw new Error(`Already tracking wallet ${address}`);
    }

    const id = generateId();
    const target: CopyTarget = {
      id,
      address,
      name,
      enabled: true,
      config: {
        targetWallet: address,
        multiplier: config.multiplier ?? 1.0,
        maxPositionSol: config.maxPositionSol ?? 0.5,
        minTradeSol: config.minTradeSol ?? 0.01,
        copyBuys: config.copyBuys ?? true,
        copySells: config.copySells ?? true,
        allowedMints: config.allowedMints,
        blockedMints: config.blockedMints,
        delayMs: config.delayMs ?? 0,
        slippageBps: config.slippageBps ?? 500,
      },
      stats: {
        totalTradesCopied: 0,
        totalSolSpent: 0,
        totalSolReceived: 0,
        successfulTrades: 0,
        failedTrades: 0,
        pnlSol: 0,
      },
      createdAt: Date.now(),
    };

    this.targets.set(id, target);
    this.startMonitoring(target);

    logger.info(`[CopyTrader] Added target ${address} (${name || 'unnamed'})`);
    this.emit('targetAdded', target);

    return target;
  }

  removeTarget(id: string): boolean {
    const target = this.targets.get(id);
    if (!target) return false;

    this.stopMonitoring(target);
    this.targets.delete(id);

    logger.info(`[CopyTrader] Removed target ${target.address}`);
    this.emit('targetRemoved', target);

    return true;
  }

  getTarget(id: string): CopyTarget | undefined {
    return this.targets.get(id);
  }

  getTargetByAddress(address: string): CopyTarget | undefined {
    for (const target of this.targets.values()) {
      if (target.address === address) return target;
    }
    return undefined;
  }

  listTargets(): CopyTarget[] {
    return Array.from(this.targets.values());
  }

  pauseTarget(id: string): boolean {
    const target = this.targets.get(id);
    if (!target) return false;

    target.enabled = false;
    this.stopMonitoring(target);
    return true;
  }

  resumeTarget(id: string): boolean {
    const target = this.targets.get(id);
    if (!target) return false;

    target.enabled = true;
    this.startMonitoring(target);
    return true;
  }

  updateTargetConfig(id: string, config: Partial<CopyTradeConfig>): boolean {
    const target = this.targets.get(id);
    if (!target) return false;

    Object.assign(target.config, config);
    return true;
  }

  // --------------------------------------------------------------------------
  // Monitoring
  // --------------------------------------------------------------------------

  private startMonitoring(target: CopyTarget): void {
    if (this.subscriptions.has(target.id)) return;

    try {
      const pubkey = new PublicKey(target.address);

      const subId = this.connection.onLogs(
        pubkey,
        async (logs) => {
          if (!target.enabled) return;
          if (logs.err) return;

          // Avoid duplicate processing
          if (this.recentTrades.has(logs.signature)) return;
          this.recentTrades.set(logs.signature, Date.now());

          try {
            await this.processTransaction(target, logs.signature);
          } catch (error) {
            logger.error(`[CopyTrader] Error processing tx ${logs.signature}:`, error);
          }
        },
        'confirmed'
      );

      this.subscriptions.set(target.id, subId);
      logger.info(`[CopyTrader] Started monitoring ${target.address}`);
    } catch (error) {
      logger.error(`[CopyTrader] Failed to start monitoring ${target.address}:`, error);
    }
  }

  private stopMonitoring(target: CopyTarget): void {
    const subId = this.subscriptions.get(target.id);
    if (subId !== undefined) {
      this.connection.removeOnLogsListener(subId);
      this.subscriptions.delete(target.id);
      logger.info(`[CopyTrader] Stopped monitoring ${target.address}`);
    }
  }

  private async processTransaction(target: CopyTarget, signature: string): Promise<void> {
    if (this.processing.has(signature)) return;
    this.processing.add(signature);

    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) return;

      const trade = this.detectTrade(target.address, tx, signature);
      if (!trade) return;

      logger.info(
        `[CopyTrader] Detected ${trade.action} by ${target.name || target.address}: ${trade.solAmount.toFixed(4)} SOL for ${trade.mint.slice(0, 8)}...`
      );
      this.emit('tradeDetected', { target, trade });

      if (!this.shouldCopy(target, trade)) {
        logger.info(`[CopyTrader] Skipping trade (filtered)`);
        return;
      }

      // Apply delay if configured
      if (target.config.delayMs && target.config.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, target.config.delayMs));
      }

      const result = await this.executeCopy(target, trade);
      this.updateStats(target, trade, result);
      this.emit('tradeCopied', { target, trade, result });
    } finally {
      this.processing.delete(signature);
    }
  }

  private detectTrade(
    targetAddress: string,
    tx: ParsedTransactionWithMeta,
    signature: string
  ): DetectedTrade | null {
    if (!tx.meta) return null;

    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];

    const targetPre = preBalances.filter(b => b.owner === targetAddress);
    const targetPost = postBalances.filter(b => b.owner === targetAddress);

    const accountKeys = tx.transaction.message.accountKeys;
    const targetIndex = accountKeys.findIndex(
      k => k.pubkey.toBase58() === targetAddress
    );

    if (targetIndex === -1) return null;

    const preSol = (tx.meta.preBalances[targetIndex] || 0) / 1e9;
    const postSol = (tx.meta.postBalances[targetIndex] || 0) / 1e9;
    const solChange = postSol - preSol;

    for (const post of targetPost) {
      const pre = targetPre.find(p => p.mint === post.mint);
      const preAmount = pre?.uiTokenAmount?.uiAmount || 0;
      const postAmount = post.uiTokenAmount?.uiAmount || 0;
      const tokenChange = postAmount - preAmount;

      if (post.mint === SOL_MINT) continue;

      if (tokenChange > 0 && solChange < -0.001) {
        return {
          targetAddress,
          signature,
          action: 'buy',
          mint: post.mint,
          solAmount: Math.abs(solChange),
          tokenAmount: tokenChange,
          dex: this.detectDex(tx),
          timestamp: (tx.blockTime || 0) * 1000,
        };
      } else if (tokenChange < 0 && solChange > 0.001) {
        return {
          targetAddress,
          signature,
          action: 'sell',
          mint: post.mint,
          solAmount: solChange,
          tokenAmount: Math.abs(tokenChange),
          dex: this.detectDex(tx),
          timestamp: (tx.blockTime || 0) * 1000,
        };
      }
    }

    return null;
  }

  private detectDex(tx: ParsedTransactionWithMeta): string {
    const programIds = tx.transaction.message.accountKeys
      .filter(k => k.signer === false && k.writable === false)
      .map(k => k.pubkey.toBase58());

    for (const [name, id] of Object.entries(DEX_PROGRAMS)) {
      if (programIds.includes(id)) return name.toLowerCase();
    }

    return 'unknown';
  }

  private shouldCopy(target: CopyTarget, trade: DetectedTrade): boolean {
    const config = target.config;

    if (trade.action === 'buy' && !config.copyBuys) return false;
    if (trade.action === 'sell' && !config.copySells) return false;

    if (config.allowedMints?.length && !config.allowedMints.includes(trade.mint)) {
      return false;
    }

    if (config.blockedMints?.includes(trade.mint)) {
      return false;
    }

    if (trade.solAmount < config.minTradeSol) {
      return false;
    }

    return true;
  }

  private async executeCopy(target: CopyTarget, trade: DetectedTrade): Promise<CopyResult> {
    const config = target.config;

    // Calculate copy amount
    let copyAmount = trade.solAmount * config.multiplier;
    copyAmount = Math.min(copyAmount, config.maxPositionSol);
    copyAmount = Math.max(copyAmount, config.minTradeSol);

    // Record in history
    const historyEntry: CopyTradeHistoryEntry = {
      id: generateId(),
      configId: target.id,
      originalTx: trade.signature,
      mint: trade.mint,
      action: trade.action,
      originalAmount: trade.solAmount,
      ourAmount: copyAmount,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.tradeHistory.push(historyEntry);

    try {
      // Execute via Jupiter
      const { executeJupiterSwap } = await import('./jupiter');

      if (trade.action === 'buy') {
        const result = await executeJupiterSwap(this.connection, this.keypair, {
          inputMint: SOL_MINT,
          outputMint: trade.mint,
          amount: String(Math.floor(copyAmount * 1e9)), // Convert to lamports
          slippageBps: config.slippageBps || 500,
        });

        historyEntry.ourTx = result.signature;
        historyEntry.status = 'success';

        // Extract outAmount from quote if available
        const quote = result.quote as { outAmount?: string } | undefined;
        const outAmount = quote?.outAmount ? parseFloat(quote.outAmount) : 0;

        return {
          targetTrade: trade,
          success: true,
          solSpent: copyAmount,
          tokensReceived: outAmount,
          signature: result.signature,
        };
      } else {
        // For sells, we need to check our balance first
        const balanceInfo = await this.getTokenBalance(trade.mint);
        if (balanceInfo.uiAmount <= 0) {
          historyEntry.status = 'failed';
          historyEntry.error = 'No tokens to sell';
          return {
            targetTrade: trade,
            success: false,
            error: 'No tokens to sell',
          };
        }

        const result = await executeJupiterSwap(this.connection, this.keypair, {
          inputMint: trade.mint,
          outputMint: SOL_MINT,
          amount: balanceInfo.rawAmount, // Use raw amount from token account (respects actual decimals)
          slippageBps: config.slippageBps || 500,
        });

        historyEntry.ourTx = result.signature;
        historyEntry.status = 'success';

        // Extract outAmount from quote if available
        const sellQuote = result.quote as { outAmount?: string } | undefined;
        const solReceived = sellQuote?.outAmount ? parseFloat(sellQuote.outAmount) / 1e9 : 0;

        return {
          targetTrade: trade,
          success: true,
          solReceived,
          signature: result.signature,
        };
      }
    } catch (error) {
      historyEntry.status = 'failed';
      historyEntry.error = error instanceof Error ? error.message : String(error);

      return {
        targetTrade: trade,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async getTokenBalance(mint: string): Promise<{ uiAmount: number; rawAmount: string; decimals: number }> {
    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.keypair.publicKey,
        { mint: new PublicKey(mint) }
      );

      if (tokenAccounts.value.length === 0) return { uiAmount: 0, rawAmount: '0', decimals: 0 };

      const tokenAmount = tokenAccounts.value[0].account.data.parsed.info.tokenAmount;
      return {
        uiAmount: tokenAmount.uiAmount || 0,
        rawAmount: tokenAmount.amount || '0',
        decimals: tokenAmount.decimals || 0,
      };
    } catch {
      return { uiAmount: 0, rawAmount: '0', decimals: 0 };
    }
  }

  private updateStats(target: CopyTarget, trade: DetectedTrade, result: CopyResult): void {
    target.stats.totalTradesCopied++;
    target.stats.lastTradeAt = Date.now();

    if (result.success) {
      target.stats.successfulTrades++;
      if (trade.action === 'buy' && result.solSpent) {
        target.stats.totalSolSpent += result.solSpent;
      } else if (trade.action === 'sell' && result.solReceived) {
        target.stats.totalSolReceived += result.solReceived;
        target.stats.pnlSol = target.stats.totalSolReceived - target.stats.totalSolSpent;
      }
    } else {
      target.stats.failedTrades++;
    }
  }

  private cleanupRecentTrades(): void {
    const cutoff = Date.now() - 300000; // 5 minutes
    for (const [sig, time] of this.recentTrades.entries()) {
      if (time < cutoff) this.recentTrades.delete(sig);
    }
  }

  // --------------------------------------------------------------------------
  // History & Stats
  // --------------------------------------------------------------------------

  getHistory(targetId?: string, limit = 50): CopyTradeHistoryEntry[] {
    let history = this.tradeHistory;
    if (targetId) {
      history = history.filter(h => h.configId === targetId);
    }
    return history.slice(-limit);
  }

  getStats(): {
    totalTargets: number;
    activeTargets: number;
    totalTradesCopied: number;
    successRate: number;
    totalPnlSol: number;
  } {
    const targets = this.listTargets();
    const totalTrades = targets.reduce((sum, t) => sum + t.stats.totalTradesCopied, 0);
    const successfulTrades = targets.reduce((sum, t) => sum + t.stats.successfulTrades, 0);
    const totalPnl = targets.reduce((sum, t) => sum + t.stats.pnlSol, 0);

    return {
      totalTargets: targets.length,
      activeTargets: targets.filter(t => t.enabled).length,
      totalTradesCopied: totalTrades,
      successRate: totalTrades > 0 ? successfulTrades / totalTrades : 0,
      totalPnlSol: totalPnl,
    };
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  destroy(): void {
    for (const target of this.targets.values()) {
      this.stopMonitoring(target);
    }
    this.targets.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Factory
// ============================================================================

let copyTraderInstance: CopyTrader | null = null;

export function getCopyTrader(connection?: Connection, keypair?: Keypair): CopyTrader {
  if (!copyTraderInstance) {
    copyTraderInstance = new CopyTrader(connection, keypair);
  }
  return copyTraderInstance;
}

export function destroyCopyTrader(): void {
  if (copyTraderInstance) {
    copyTraderInstance.destroy();
    copyTraderInstance = null;
  }
}
