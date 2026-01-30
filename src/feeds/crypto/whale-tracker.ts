/**
 * Unified Crypto Whale Tracker
 *
 * Tracks large transactions and whale wallets across multiple chains:
 * - Solana (via Birdeye/Helius)
 * - EVM chains (via Alchemy/Etherscan)
 *
 * Features:
 * - Real-time transaction monitoring
 * - Whale wallet tracking
 * - Position/PnL tracking
 * - Copy trading signals
 * - Cross-chain whale correlation
 */

import { EventEmitter } from 'eventemitter3';
import WebSocket from 'ws';
import { logger } from '../../utils/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyData = any;

// =============================================================================
// TYPES
// =============================================================================

export type Chain = 'solana' | 'ethereum' | 'polygon' | 'arbitrum' | 'base' | 'optimism';

export interface WhaleTrackerConfig {
  /** Chains to track */
  chains?: Chain[];
  /** Minimum transaction value in USD to track (default: 50000) */
  minTxValueUsd?: number;
  /** Minimum wallet value to be considered a whale (default: 1000000) */
  minWhaleValueUsd?: number;
  /** Addresses to always track */
  watchedAddresses?: string[];
  /** Poll interval in ms (default: 30000) */
  pollIntervalMs?: number;
  /** API keys */
  apiKeys?: {
    birdeye?: string;
    helius?: string;
    alchemy?: string;
    etherscan?: string;
  };
}

export interface WhaleTransaction {
  id: string;
  chain: Chain;
  hash: string;
  timestamp: Date;
  from: string;
  to: string;
  /** Token address or 'native' for SOL/ETH */
  token: string;
  tokenSymbol: string;
  tokenName?: string;
  amount: number;
  amountUsd: number;
  type: 'transfer' | 'swap' | 'bridge' | 'stake' | 'unstake' | 'unknown';
  /** For swaps */
  swapDetails?: {
    tokenIn: string;
    tokenInSymbol: string;
    amountIn: number;
    tokenOut: string;
    tokenOutSymbol: string;
    amountOut: number;
    dex?: string;
  };
}

export interface WhaleWallet {
  address: string;
  chain: Chain;
  /** Labels like 'exchange', 'fund', 'smart_money' */
  labels: string[];
  /** Total portfolio value in USD */
  totalValueUsd: number;
  /** Top token holdings */
  holdings: TokenHolding[];
  /** Recent transactions */
  recentTxCount: number;
  /** First seen */
  firstSeen?: Date;
  /** Last active */
  lastActive: Date;
  /** Tracked PnL */
  pnl?: {
    realized: number;
    unrealized: number;
    winRate: number;
    avgReturn: number;
  };
}

export interface TokenHolding {
  token: string;
  symbol: string;
  name?: string;
  amount: number;
  valueUsd: number;
  pctOfPortfolio: number;
  avgEntryPrice?: number;
  currentPrice: number;
  pnlPct?: number;
}

export interface WhaleAlert {
  id: string;
  type: 'large_transfer' | 'whale_buy' | 'whale_sell' | 'accumulation' | 'distribution';
  chain: Chain;
  wallet: string;
  transaction?: WhaleTransaction;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
}

export interface CryptoWhaleEvents {
  transaction: (tx: WhaleTransaction) => void;
  alert: (alert: WhaleAlert) => void;
  walletUpdate: (wallet: WhaleWallet) => void;
  connected: (chain: Chain) => void;
  disconnected: (chain: Chain, error?: Error) => void;
  error: (error: Error, chain?: Chain) => void;
}

export interface CryptoWhaleTracker extends EventEmitter<keyof CryptoWhaleEvents> {
  start(): Promise<void>;
  stop(): void;
  isRunning(): boolean;

  // Wallet management
  watchWallet(address: string, chain?: Chain): void;
  unwatchWallet(address: string, chain?: Chain): void;
  getWatchedWallets(): Map<string, WhaleWallet>;

  // Data queries
  getWallet(address: string, chain: Chain): Promise<WhaleWallet | null>;
  getRecentTransactions(chain?: Chain, limit?: number): WhaleTransaction[];
  getTopWhales(chain: Chain, limit?: number): Promise<WhaleWallet[]>;

  // Stats
  getStats(): {
    running: boolean;
    chains: Chain[];
    watchedWallets: number;
    transactionsTracked: number;
    alertsGenerated: number;
  };
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<WhaleTrackerConfig> = {
  chains: ['solana', 'ethereum'],
  minTxValueUsd: 50000,
  minWhaleValueUsd: 1000000,
  watchedAddresses: [],
  pollIntervalMs: 30000,
  apiKeys: {},
};

// API endpoints
const BIRDEYE_API = 'https://public-api.birdeye.so';
const BIRDEYE_WS = 'wss://public-api.birdeye.so/socket';
const HELIUS_API = 'https://api.helius.xyz/v0';
const ALCHEMY_API_BASE = 'https://eth-mainnet.g.alchemy.com/v2';
const ETHERSCAN_API = 'https://api.etherscan.io/api';

// Chain-specific config
const CHAIN_CONFIG: Record<Chain, {
  nativeToken: string;
  nativeSymbol: string;
  decimals: number;
  explorerUrl: string;
}> = {
  solana: {
    nativeToken: 'So11111111111111111111111111111111111111112',
    nativeSymbol: 'SOL',
    decimals: 9,
    explorerUrl: 'https://solscan.io',
  },
  ethereum: {
    nativeToken: '0x0000000000000000000000000000000000000000',
    nativeSymbol: 'ETH',
    decimals: 18,
    explorerUrl: 'https://etherscan.io',
  },
  polygon: {
    nativeToken: '0x0000000000000000000000000000000000001010',
    nativeSymbol: 'MATIC',
    decimals: 18,
    explorerUrl: 'https://polygonscan.com',
  },
  arbitrum: {
    nativeToken: '0x0000000000000000000000000000000000000000',
    nativeSymbol: 'ETH',
    decimals: 18,
    explorerUrl: 'https://arbiscan.io',
  },
  base: {
    nativeToken: '0x0000000000000000000000000000000000000000',
    nativeSymbol: 'ETH',
    decimals: 18,
    explorerUrl: 'https://basescan.org',
  },
  optimism: {
    nativeToken: '0x0000000000000000000000000000000000000000',
    nativeSymbol: 'ETH',
    decimals: 18,
    explorerUrl: 'https://optimistic.etherscan.io',
  },
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createCryptoWhaleTracker(
  config: WhaleTrackerConfig = {}
): CryptoWhaleTracker {
  const emitter = new EventEmitter() as CryptoWhaleTracker;
  const cfg = { ...DEFAULT_CONFIG, ...config };

  let running = false;
  const watchedWallets = new Map<string, WhaleWallet>();
  const recentTransactions: WhaleTransaction[] = [];
  const pollIntervals = new Map<Chain, NodeJS.Timeout>();
  const websockets = new Map<Chain, WebSocket>();

  let transactionsTracked = 0;
  let alertsGenerated = 0;

  // ==========================================================================
  // UTILITY FUNCTIONS
  // ==========================================================================

  function getWalletKey(address: string, chain: Chain): string {
    return `${chain}:${address.toLowerCase()}`;
  }

  async function fetchWithRetry(
    url: string,
    options: RequestInit = {},
    retries = 3
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(15000),
        });

        if (response.status === 429) {
          const waitMs = Math.pow(2, i) * 1000;
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        return response;
      } catch (error) {
        lastError = error as Error;
        if (i < retries - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
        }
      }
    }

    throw lastError || new Error('Fetch failed');
  }

  function generateAlert(
    type: WhaleAlert['type'],
    chain: Chain,
    wallet: string,
    message: string,
    severity: WhaleAlert['severity'],
    transaction?: WhaleTransaction
  ): void {
    const alert: WhaleAlert = {
      id: `${chain}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      chain,
      wallet,
      transaction,
      severity,
      message,
      timestamp: new Date(),
    };

    alertsGenerated++;
    emitter.emit('alert', alert);
    logger.info({ alert }, 'Whale alert generated');
  }

  // ==========================================================================
  // SOLANA TRACKING (Birdeye)
  // ==========================================================================

  async function startSolanaTracking(): Promise<void> {
    if (!cfg.chains.includes('solana')) return;

    const apiKey = cfg.apiKeys?.birdeye;
    if (!apiKey) {
      logger.warn('No Birdeye API key - Solana tracking will use limited endpoints');
    }

    // Start WebSocket for real-time transactions
    if (apiKey) {
      connectSolanaWebSocket(apiKey);
    }

    // Start polling for wallet updates
    const pollInterval = setInterval(async () => {
      await pollSolanaWallets();
    }, cfg.pollIntervalMs);

    pollIntervals.set('solana', pollInterval);

    // Initial poll
    await pollSolanaWallets();

    emitter.emit('connected', 'solana');
    logger.info('Solana whale tracking started');
  }

  function connectSolanaWebSocket(apiKey: string): void {
    try {
      const ws = new WebSocket(BIRDEYE_WS, {
        headers: { 'X-API-KEY': apiKey },
      });

      ws.on('open', () => {
        logger.info('Birdeye WebSocket connected');

        // Subscribe to large transactions
        ws.send(JSON.stringify({
          type: 'SUBSCRIBE_LARGE_TRADE_TXS',
          data: { minUsd: cfg.minTxValueUsd },
        }));

        // Subscribe to watched wallets
        for (const [key, wallet] of Array.from(watchedWallets.entries())) {
          if (key.startsWith('solana:')) {
            ws.send(JSON.stringify({
              type: 'SUBSCRIBE_WALLET_TXS',
              data: { wallet: wallet.address },
            }));
          }
        }
      });

      ws.on('message', (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString());
          handleSolanaWsMessage(msg);
        } catch (err: unknown) {
          logger.debug({ err }, 'Failed to parse Birdeye WS message');
        }
      });

      ws.on('error', (err: Error) => {
        logger.error({ err }, 'Birdeye WebSocket error');
        emitter.emit('error', err as Error, 'solana');
      });

      ws.on('close', () => {
        logger.warn('Birdeye WebSocket closed');
        emitter.emit('disconnected', 'solana');

        // Reconnect after delay
        if (running) {
          setTimeout(() => {
            if (running) connectSolanaWebSocket(apiKey);
          }, 5000);
        }
      });

      websockets.set('solana', ws);
    } catch (err) {
      logger.error({ err }, 'Failed to connect Birdeye WebSocket');
    }
  }

  function handleSolanaWsMessage(msg: any): void {
    if (msg.type === 'LARGE_TRADE_TX' || msg.type === 'WALLET_TX') {
      const tx = parseSolanaTransaction(msg.data);
      if (tx && tx.amountUsd >= cfg.minTxValueUsd) {
        processTransaction(tx);
      }
    }
  }

  function parseSolanaTransaction(data: any): WhaleTransaction | null {
    try {
      const tx: WhaleTransaction = {
        id: data.txHash || data.signature,
        chain: 'solana',
        hash: data.txHash || data.signature,
        timestamp: new Date(data.blockTime * 1000 || Date.now()),
        from: data.owner || data.source,
        to: data.destination || '',
        token: data.address || 'native',
        tokenSymbol: data.symbol || 'SOL',
        tokenName: data.name,
        amount: parseFloat(data.amount || data.tokenAmount || 0),
        amountUsd: parseFloat(data.valueUsd || data.usdValue || 0),
        type: data.type === 'swap' ? 'swap' : 'transfer',
      };

      if (data.type === 'swap' && data.swap) {
        tx.swapDetails = {
          tokenIn: data.swap.tokenIn?.address || '',
          tokenInSymbol: data.swap.tokenIn?.symbol || '',
          amountIn: parseFloat(data.swap.amountIn || 0),
          tokenOut: data.swap.tokenOut?.address || '',
          tokenOutSymbol: data.swap.tokenOut?.symbol || '',
          amountOut: parseFloat(data.swap.amountOut || 0),
          dex: data.swap.source,
        };
      }

      return tx;
    } catch (err) {
      logger.debug({ err, data }, 'Failed to parse Solana transaction');
      return null;
    }
  }

  async function pollSolanaWallets(): Promise<void> {
    const apiKey = cfg.apiKeys?.birdeye;
    if (!apiKey) return;

    for (const [key, wallet] of Array.from(watchedWallets.entries())) {
      if (!key.startsWith('solana:')) continue;

      try {
        const response = await fetchWithRetry(
          `${BIRDEYE_API}/v1/wallet/token_list?wallet=${wallet.address}`,
          { headers: { 'X-API-KEY': apiKey } }
        );

        if (!response.ok) continue;

        const data = await response.json() as any;
        const holdings: TokenHolding[] = (data.data?.items || []).map((item: any) => ({
          token: item.address,
          symbol: item.symbol,
          name: item.name,
          amount: parseFloat(item.uiAmount || 0),
          valueUsd: parseFloat(item.valueUsd || 0),
          pctOfPortfolio: 0,
          currentPrice: parseFloat(item.priceUsd || 0),
        }));

        const totalValue = holdings.reduce((sum, h) => sum + h.valueUsd, 0);
        holdings.forEach(h => {
          h.pctOfPortfolio = totalValue > 0 ? (h.valueUsd / totalValue) * 100 : 0;
        });

        wallet.holdings = holdings.sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 20);
        wallet.totalValueUsd = totalValue;
        wallet.lastActive = new Date();

        emitter.emit('walletUpdate', wallet);
      } catch (err) {
        logger.debug({ err, address: wallet.address }, 'Failed to poll Solana wallet');
      }
    }
  }

  async function fetchSolanaWallet(address: string): Promise<WhaleWallet | null> {
    const apiKey = cfg.apiKeys?.birdeye;
    if (!apiKey) {
      logger.warn('No Birdeye API key for Solana wallet fetch');
      return null;
    }

    try {
      const response = await fetchWithRetry(
        `${BIRDEYE_API}/v1/wallet/token_list?wallet=${address}`,
        { headers: { 'X-API-KEY': apiKey } }
      );

      if (!response.ok) return null;

      const data = await response.json() as any;
      const holdings: TokenHolding[] = (data.data?.items || []).map((item: any) => ({
        token: item.address,
        symbol: item.symbol,
        name: item.name,
        amount: parseFloat(item.uiAmount || 0),
        valueUsd: parseFloat(item.valueUsd || 0),
        pctOfPortfolio: 0,
        currentPrice: parseFloat(item.priceUsd || 0),
      }));

      const totalValue = holdings.reduce((sum, h) => sum + h.valueUsd, 0);
      holdings.forEach(h => {
        h.pctOfPortfolio = totalValue > 0 ? (h.valueUsd / totalValue) * 100 : 0;
      });

      return {
        address,
        chain: 'solana',
        labels: totalValue >= cfg.minWhaleValueUsd ? ['whale'] : [],
        totalValueUsd: totalValue,
        holdings: holdings.sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 20),
        recentTxCount: 0,
        lastActive: new Date(),
      };
    } catch (err) {
      logger.error({ err, address }, 'Failed to fetch Solana wallet');
      return null;
    }
  }

  // ==========================================================================
  // EVM TRACKING (Alchemy/Etherscan)
  // ==========================================================================

  async function startEvmTracking(chain: Chain): Promise<void> {
    if (!cfg.chains.includes(chain)) return;

    const alchemyKey = cfg.apiKeys?.alchemy;
    const etherscanKey = cfg.apiKeys?.etherscan;

    if (!alchemyKey && !etherscanKey) {
      logger.warn({ chain }, 'No API keys for EVM tracking');
      return;
    }

    // Start polling for wallet updates and transactions
    const pollInterval = setInterval(async () => {
      await pollEvmChain(chain);
    }, cfg.pollIntervalMs);

    pollIntervals.set(chain, pollInterval);

    // Initial poll
    await pollEvmChain(chain);

    emitter.emit('connected', chain);
    logger.info({ chain }, 'EVM whale tracking started');
  }

  async function pollEvmChain(chain: Chain): Promise<void> {
    const alchemyKey = cfg.apiKeys?.alchemy;

    // Poll watched wallets
    for (const [key, wallet] of Array.from(watchedWallets.entries())) {
      if (!key.startsWith(`${chain}:`)) continue;

      try {
        const updatedWallet = await fetchEvmWallet(wallet.address, chain);
        if (updatedWallet) {
          watchedWallets.set(key, updatedWallet);
          emitter.emit('walletUpdate', updatedWallet);
        }
      } catch (err) {
        logger.debug({ err, address: wallet.address, chain }, 'Failed to poll EVM wallet');
      }
    }

    // Fetch recent large transactions using Alchemy
    if (alchemyKey) {
      try {
        await fetchRecentEvmTransactions(chain, alchemyKey);
      } catch (err) {
        logger.debug({ err, chain }, 'Failed to fetch recent EVM transactions');
      }
    }
  }

  async function fetchEvmWallet(address: string, chain: Chain): Promise<WhaleWallet | null> {
    const alchemyKey = cfg.apiKeys?.alchemy;
    if (!alchemyKey) return null;

    const baseUrl = getAlchemyUrl(chain, alchemyKey);

    try {
      // Get token balances
      const response = await fetchWithRetry(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'alchemy_getTokenBalances',
          params: [address],
          id: 1,
        }),
      });

      if (!response.ok) return null;

      const data = await response.json() as any;
      const tokenBalances = data.result?.tokenBalances || [];

      // Get native balance
      const nativeResponse = await fetchWithRetry(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [address, 'latest'],
          id: 2,
        }),
      });

      const nativeData = await nativeResponse.json() as any;
      const nativeBalance = parseInt(nativeData.result || '0', 16) / 1e18;

      // Build holdings list (simplified - would need price API for full USD values)
      const holdings: TokenHolding[] = [
        {
          token: CHAIN_CONFIG[chain].nativeToken,
          symbol: CHAIN_CONFIG[chain].nativeSymbol,
          amount: nativeBalance,
          valueUsd: 0, // Would need price lookup
          pctOfPortfolio: 0,
          currentPrice: 0,
        },
      ];

      // Add ERC20 tokens (first 10 with balance)
      for (const tb of tokenBalances.slice(0, 10)) {
        if (tb.tokenBalance && tb.tokenBalance !== '0x0') {
          holdings.push({
            token: tb.contractAddress,
            symbol: 'TOKEN',
            amount: parseInt(tb.tokenBalance, 16) / 1e18,
            valueUsd: 0,
            pctOfPortfolio: 0,
            currentPrice: 0,
          });
        }
      }

      return {
        address,
        chain,
        labels: [],
        totalValueUsd: 0, // Would need price aggregation
        holdings,
        recentTxCount: 0,
        lastActive: new Date(),
      };
    } catch (err) {
      logger.error({ err, address, chain }, 'Failed to fetch EVM wallet');
      return null;
    }
  }

  async function fetchRecentEvmTransactions(chain: Chain, apiKey: string): Promise<void> {
    const baseUrl = getAlchemyUrl(chain, apiKey);

    try {
      // Get latest block
      const blockResponse = await fetchWithRetry(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        }),
      });

      const blockData = await blockResponse.json() as any;
      const latestBlock = parseInt(blockData.result, 16);

      // Get asset transfers in last ~100 blocks
      const transferResponse = await fetchWithRetry(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'alchemy_getAssetTransfers',
          params: [{
            fromBlock: `0x${(latestBlock - 100).toString(16)}`,
            toBlock: 'latest',
            category: ['external', 'erc20'],
            withMetadata: true,
            maxCount: '0x64', // 100 results
          }],
          id: 2,
        }),
      });

      const transferData = await transferResponse.json() as any;
      const transfers = transferData.result?.transfers || [];

      for (const t of transfers) {
        // Filter for large transactions (rough estimate without USD conversion)
        const value = parseFloat(t.value || 0);
        if (value < 10) continue; // Skip small transfers

        const tx: WhaleTransaction = {
          id: `${chain}_${t.hash}_${t.uniqueId || 0}`,
          chain,
          hash: t.hash,
          timestamp: new Date(t.metadata?.blockTimestamp || Date.now()),
          from: t.from,
          to: t.to || '',
          token: t.rawContract?.address || 'native',
          tokenSymbol: t.asset || CHAIN_CONFIG[chain].nativeSymbol,
          amount: value,
          amountUsd: 0, // Would need price lookup
          type: 'transfer',
        };

        processTransaction(tx);
      }
    } catch (err) {
      logger.debug({ err, chain }, 'Failed to fetch EVM transactions');
    }
  }

  function getAlchemyUrl(chain: Chain, apiKey: string): string {
    const chainUrls: Record<Chain, string> = {
      ethereum: `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`,
      polygon: `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`,
      arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${apiKey}`,
      base: `https://base-mainnet.g.alchemy.com/v2/${apiKey}`,
      optimism: `https://opt-mainnet.g.alchemy.com/v2/${apiKey}`,
      solana: '', // Not applicable
    };
    return chainUrls[chain] || chainUrls.ethereum;
  }

  // ==========================================================================
  // TRANSACTION PROCESSING
  // ==========================================================================

  function processTransaction(tx: WhaleTransaction): void {
    // Store transaction
    recentTransactions.unshift(tx);
    if (recentTransactions.length > 1000) {
      recentTransactions.pop();
    }
    transactionsTracked++;

    // Emit event
    emitter.emit('transaction', tx);

    // Generate alerts based on transaction type and size
    const severity = tx.amountUsd >= 1000000 ? 'critical'
      : tx.amountUsd >= 500000 ? 'high'
      : tx.amountUsd >= 100000 ? 'medium'
      : 'low';

    if (tx.type === 'swap' && tx.swapDetails) {
      generateAlert(
        tx.swapDetails.amountOut > 0 ? 'whale_buy' : 'whale_sell',
        tx.chain,
        tx.from,
        `${tx.tokenSymbol} ${tx.type}: $${tx.amountUsd.toLocaleString()} on ${tx.chain}`,
        severity,
        tx
      );
    } else if (tx.amountUsd >= cfg.minTxValueUsd) {
      generateAlert(
        'large_transfer',
        tx.chain,
        tx.from,
        `Large ${tx.tokenSymbol} transfer: $${tx.amountUsd.toLocaleString()} on ${tx.chain}`,
        severity,
        tx
      );
    }

    // Auto-track new whales
    if (tx.amountUsd >= cfg.minWhaleValueUsd * 0.5) {
      const fromKey = getWalletKey(tx.from, tx.chain);
      if (!watchedWallets.has(fromKey)) {
        logger.info({ address: tx.from, chain: tx.chain, txValue: tx.amountUsd }, 'Auto-tracking new whale');
        emitter.watchWallet(tx.from, tx.chain);
      }
    }
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  Object.assign(emitter, {
    async start(): Promise<void> {
      if (running) return;
      running = true;

      logger.info({ chains: cfg.chains }, 'Starting crypto whale tracker');

      // Add initial watched addresses
      for (const addr of cfg.watchedAddresses) {
        for (const chain of cfg.chains) {
          emitter.watchWallet(addr, chain);
        }
      }

      // Start chain-specific tracking
      const startPromises: Promise<void>[] = [];

      if (cfg.chains.includes('solana')) {
        startPromises.push(startSolanaTracking());
      }

      for (const chain of cfg.chains) {
        if (chain !== 'solana') {
          startPromises.push(startEvmTracking(chain));
        }
      }

      await Promise.all(startPromises);
    },

    stop(): void {
      if (!running) return;
      running = false;

      // Stop all WebSockets
      for (const [chain, ws] of Array.from(websockets.entries())) {
        ws.close();
        logger.debug({ chain }, 'Closed WebSocket');
      }
      websockets.clear();

      // Stop all polling
      for (const [chain, interval] of Array.from(pollIntervals.entries())) {
        clearInterval(interval);
        logger.debug({ chain }, 'Stopped polling');
      }
      pollIntervals.clear();

      logger.info('Crypto whale tracker stopped');
    },

    isRunning(): boolean {
      return running;
    },

    watchWallet(address: string, chain?: Chain): void {
      const chains = chain ? [chain] : cfg.chains;

      for (const c of chains) {
        const key = getWalletKey(address, c);
        if (!watchedWallets.has(key)) {
          const wallet: WhaleWallet = {
            address,
            chain: c,
            labels: [],
            totalValueUsd: 0,
            holdings: [],
            recentTxCount: 0,
            lastActive: new Date(),
          };
          watchedWallets.set(key, wallet);
          logger.info({ address, chain: c }, 'Now watching wallet');

          // Subscribe on WebSocket if connected
          const ws = websockets.get(c);
          if (ws?.readyState === WebSocket.OPEN && c === 'solana') {
            ws.send(JSON.stringify({
              type: 'SUBSCRIBE_WALLET_TXS',
              data: { wallet: address },
            }));
          }
        }
      }
    },

    unwatchWallet(address: string, chain?: Chain): void {
      const chains = chain ? [chain] : cfg.chains;

      for (const c of chains) {
        const key = getWalletKey(address, c);
        watchedWallets.delete(key);
        logger.info({ address, chain: c }, 'Stopped watching wallet');
      }
    },

    getWatchedWallets(): Map<string, WhaleWallet> {
      return new Map(watchedWallets);
    },

    async getWallet(address: string, chain: Chain): Promise<WhaleWallet | null> {
      const key = getWalletKey(address, chain);

      // Return cached if available
      if (watchedWallets.has(key)) {
        return watchedWallets.get(key)!;
      }

      // Fetch fresh
      if (chain === 'solana') {
        return fetchSolanaWallet(address);
      } else {
        return fetchEvmWallet(address, chain);
      }
    },

    getRecentTransactions(chain?: Chain, limit = 100): WhaleTransaction[] {
      let txs = recentTransactions;
      if (chain) {
        txs = txs.filter(t => t.chain === chain);
      }
      return txs.slice(0, limit);
    },

    async getTopWhales(chain: Chain, limit = 20): Promise<WhaleWallet[]> {
      // Return from cache sorted by value
      const chainWallets = Array.from(watchedWallets.values())
        .filter(w => w.chain === chain)
        .sort((a, b) => b.totalValueUsd - a.totalValueUsd)
        .slice(0, limit);

      return chainWallets;
    },

    getStats() {
      return {
        running,
        chains: cfg.chains,
        watchedWallets: watchedWallets.size,
        transactionsTracked,
        alertsGenerated,
      };
    },
  } as Partial<CryptoWhaleTracker>);

  return emitter;
}

// =============================================================================
// EXPORTS
// =============================================================================

export { CHAIN_CONFIG };
