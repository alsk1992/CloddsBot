/**
 * Trade Execution Service - Execute trades across platforms
 *
 * Supports Polymarket, Kalshi, Hyperliquid, DEXs (Jupiter, Uniswap, Aerodrome)
 */

import { logger } from '../../utils/logger';
import { buildPolymarketHeadersForUrl, type PolymarketApiKeyAuth } from '../../utils/polymarket-auth';
import { placePerpOrder, type HyperliquidConfig, type PerpOrder } from '../../exchanges/hyperliquid';
import { openLong, openShort, type BinanceFuturesConfig } from '../../exchanges/binance-futures';
import { openLong as bybitOpenLong, openShort as bybitOpenShort, type BybitConfig } from '../../exchanges/bybit';
import { openLong as mexcOpenLong, openShort as mexcOpenShort, type MexcConfig } from '../../exchanges/mexc';
import { createDriftTrading, type DriftTradingConfig } from '../../feeds/drift/trading';
import { executeJupiterSwap, type JupiterSwapParams } from '../../solana/jupiter';
import { executeUniswapSwap, type UniswapSwapParams, type EvmChain } from '../../evm/uniswap';
import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import type {
  ComputeRequest,
  TradeRequest,
  TradeResponse,
  TradePlatform,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface TradeExecutor {
  /** Execute a trade */
  execute(request: ComputeRequest): Promise<TradeResponse>;
  /** Get supported platforms */
  getPlatforms(): TradePlatform[];
  /** Check if platform is available */
  isAvailable(platform: TradePlatform): boolean;
  /** Get platform config */
  getPlatformConfig(platform: TradePlatform): PlatformConfig | null;
}

export interface TradeExecutorConfig {
  /** Polymarket API credentials */
  polymarket?: {
    address: string;
    apiKey: string;
    apiSecret: string;
    passphrase: string;
  };
  /** Kalshi API credentials */
  kalshi?: {
    apiKey: string;
    apiSecret: string;
  };
  /** Hyperliquid API credentials */
  hyperliquid?: {
    apiKey: string;
    apiSecret: string;
  };
  /** Binance API credentials */
  binance?: {
    apiKey: string;
    apiSecret: string;
  };
  /** Bybit API credentials */
  bybit?: {
    apiKey: string;
    apiSecret: string;
  };
  /** MEXC API credentials */
  mexc?: {
    apiKey: string;
    apiSecret: string;
  };
  /** Drift config (uses Solana privateKey) */
  drift?: {
    rpcUrl?: string;
  };
  /** Private key for DEX trading */
  privateKey?: string;
  /** Default slippage tolerance (default: 1%) */
  defaultSlippage?: number;
  /** Dry run mode */
  dryRun?: boolean;
}

export interface PlatformConfig {
  name: string;
  type: 'prediction' | 'cex' | 'dex';
  chains?: string[];
  minSize: number;
  maxSize: number;
  fees: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const PLATFORM_CONFIGS: Record<TradePlatform, PlatformConfig> = {
  polymarket: {
    name: 'Polymarket',
    type: 'prediction',
    chains: ['polygon'],
    minSize: 1,
    maxSize: 100000,
    fees: 0,
  },
  kalshi: {
    name: 'Kalshi',
    type: 'prediction',
    minSize: 1,
    maxSize: 25000,
    fees: 0.07,
  },
  hyperliquid: {
    name: 'Hyperliquid',
    type: 'dex',
    chains: ['arbitrum'],
    minSize: 10,
    maxSize: 1000000,
    fees: 0.00025,
  },
  binance: {
    name: 'Binance',
    type: 'cex',
    minSize: 10,
    maxSize: 10000000,
    fees: 0.001,
  },
  bybit: {
    name: 'Bybit',
    type: 'cex',
    minSize: 10,
    maxSize: 10000000,
    fees: 0.001,
  },
  mexc: {
    name: 'MEXC',
    type: 'cex',
    minSize: 10,
    maxSize: 5000000,
    fees: 0.0006,
  },
  drift: {
    name: 'Drift',
    type: 'prediction',
    chains: ['solana'],
    minSize: 1,
    maxSize: 100000,
    fees: 0.001,
  },
  jupiter: {
    name: 'Jupiter',
    type: 'dex',
    chains: ['solana'],
    minSize: 0.01,
    maxSize: 1000000,
    fees: 0.003,
  },
  uniswap: {
    name: 'Uniswap',
    type: 'dex',
    chains: ['ethereum', 'arbitrum', 'polygon', 'optimism'],
    minSize: 1,
    maxSize: 10000000,
    fees: 0.003,
  },
  aerodrome: {
    name: 'Aerodrome',
    type: 'dex',
    chains: ['base'],
    minSize: 1,
    maxSize: 1000000,
    fees: 0.003,
  },
};

const DEFAULT_CONFIG: Required<Pick<TradeExecutorConfig, 'defaultSlippage' | 'dryRun'>> = {
  defaultSlippage: 0.01,
  dryRun: false,
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createTradeExecutor(config: TradeExecutorConfig = {}): TradeExecutor {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  function getPlatforms(): TradePlatform[] {
    return Object.keys(PLATFORM_CONFIGS) as TradePlatform[];
  }

  function isAvailable(platform: TradePlatform): boolean {
    switch (platform) {
      case 'polymarket':
        return !!(config.polymarket?.apiKey);
      case 'kalshi':
        return !!(config.kalshi?.apiKey);
      case 'hyperliquid':
        return !!(config.hyperliquid?.apiKey);
      case 'binance':
        return !!(config.binance?.apiKey);
      case 'jupiter':
      case 'uniswap':
      case 'aerodrome':
        return !!(config.privateKey);
      default:
        return false;
    }
  }

  function getPlatformConfig(platform: TradePlatform): PlatformConfig | null {
    return PLATFORM_CONFIGS[platform] || null;
  }

  async function execute(request: ComputeRequest): Promise<TradeResponse> {
    const payload = request.payload as TradeRequest;
    const {
      platform,
      marketId,
      side,
      size,
      sizeType,
      price,
      orderType,
      outcome,
      slippagePct = cfg.defaultSlippage,
    } = payload;

    const platformConfig = PLATFORM_CONFIGS[platform];
    if (!platformConfig) {
      throw new Error(`Unknown platform: ${platform}`);
    }

    if (!isAvailable(platform)) {
      throw new Error(`Platform ${platform} not configured. Add API credentials.`);
    }

    // Validate size
    const sizeUsd = sizeType === 'usd' ? size : size * (price || 0);
    if (sizeUsd < platformConfig.minSize) {
      throw new Error(`Size too small. Minimum: $${platformConfig.minSize}`);
    }
    if (sizeUsd > platformConfig.maxSize) {
      throw new Error(`Size too large. Maximum: $${platformConfig.maxSize}`);
    }

    logger.info({
      requestId: request.id,
      platform,
      marketId,
      side,
      size,
      orderType,
    }, 'Executing trade');

    // Dry run mode
    if (cfg.dryRun) {
      return {
        orderId: `dry_${Date.now()}`,
        status: 'filled',
        fillPrice: price || 0.5,
        filledSize: size,
        fee: sizeUsd * platformConfig.fees,
      };
    }

    // Execute based on platform
    switch (platform) {
      case 'polymarket':
        return executePolymarket(payload);
      case 'kalshi':
        return executeKalshi(payload);
      case 'hyperliquid':
        return executeHyperliquid(payload);
      case 'binance':
        return executeBinance(payload);
      case 'bybit':
        return executeBybit(payload);
      case 'mexc':
        return executeMexc(payload);
      case 'drift':
        return executeDrift(payload);
      case 'jupiter':
        return executeJupiter(payload);
      case 'uniswap':
        return executeUniswap(payload);
      case 'aerodrome':
        return executeAerodrome(payload);
      default:
        throw new Error(`Platform ${platform} execution not implemented`);
    }
  }

  async function executePolymarket(payload: TradeRequest): Promise<TradeResponse> {
    const creds = config.polymarket;
    if (!creds) throw new Error('Polymarket not configured');

    const auth: PolymarketApiKeyAuth = {
      address: creds.address,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      apiPassphrase: creds.passphrase,
    };

    const url = 'https://clob.polymarket.com/order';
    const orderBody = {
      market: payload.marketId,
      side: payload.side.toUpperCase(),
      size: payload.size,
      price: payload.price,
      type: payload.orderType.toUpperCase(),
    };

    const headers = buildPolymarketHeadersForUrl(auth, 'POST', url, orderBody);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(orderBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Polymarket error: ${error}`);
    }

    const data = await response.json() as {
      orderID: string;
      status: string;
      filledPrice?: number;
      filledSize?: number;
    };

    return {
      orderId: data.orderID,
      status: data.status === 'MATCHED' ? 'filled' : 'pending',
      fillPrice: data.filledPrice,
      filledSize: data.filledSize,
    };
  }

  async function executeKalshi(payload: TradeRequest): Promise<TradeResponse> {
    const creds = config.kalshi;
    if (!creds) throw new Error('Kalshi not configured');

    const response = await fetch('https://trading-api.kalshi.com/trade-api/v2/portfolio/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${creds.apiKey}`,
      },
      body: JSON.stringify({
        ticker: payload.marketId,
        side: payload.side,
        count: payload.sizeType === 'shares' ? payload.size : Math.floor(payload.size / (payload.price || 0.5)),
        type: payload.orderType,
        yes_price: payload.outcome === 'yes' ? Math.round((payload.price || 0.5) * 100) : undefined,
        no_price: payload.outcome === 'no' ? Math.round((payload.price || 0.5) * 100) : undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Kalshi error: ${error}`);
    }

    const data = await response.json() as {
      order: { order_id: string; status: string };
    };

    return {
      orderId: data.order.order_id,
      status: data.order.status === 'executed' ? 'filled' : 'pending',
    };
  }

  async function executeHyperliquid(payload: TradeRequest): Promise<TradeResponse> {
    const creds = config.hyperliquid;
    if (!creds) throw new Error('Hyperliquid not configured');

    const hlConfig: HyperliquidConfig = {
      walletAddress: '', // Derived from private key by placePerpOrder
      privateKey: creds.apiSecret,
    };

    const order: PerpOrder = {
      coin: payload.marketId,
      side: payload.side.toUpperCase() as 'BUY' | 'SELL',
      size: payload.size,
      price: payload.price,
      type: payload.orderType === 'market' ? 'MARKET' : 'LIMIT',
    };

    const result = await placePerpOrder(hlConfig, order);

    if (!result.success) {
      throw new Error(`Hyperliquid error: ${result.error || 'Unknown error'}`);
    }

    return {
      orderId: String(result.orderId ?? ''),
      status: 'pending',
    };
  }

  async function executeBinance(payload: TradeRequest): Promise<TradeResponse> {
    const creds = config.binance;
    if (!creds) throw new Error('Binance not configured');

    const bnConfig: BinanceFuturesConfig = {
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
    };

    const symbol = payload.marketId.replace('/', '');
    const quantity = payload.size;

    const result = payload.side === 'buy'
      ? await openLong(bnConfig, symbol, quantity)
      : await openShort(bnConfig, symbol, quantity);

    return {
      orderId: String(result.orderId),
      status: result.status === 'FILLED' ? 'filled' : result.status === 'PARTIALLY_FILLED' ? 'partial' : 'pending',
      fillPrice: result.avgPrice || result.price,
      filledSize: result.executedQty,
    };
  }

  async function executeBybit(payload: TradeRequest): Promise<TradeResponse> {
    const creds = config.bybit;
    if (!creds) throw new Error('Bybit not configured');

    const bybitConfig: BybitConfig = {
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
    };

    const symbol = payload.marketId.replace('/', '');
    const quantity = payload.size;

    const result = payload.side === 'buy'
      ? await bybitOpenLong(bybitConfig, symbol, quantity)
      : await bybitOpenShort(bybitConfig, symbol, quantity);

    return {
      orderId: String(result.orderId),
      status: result.orderStatus === 'Filled' ? 'filled' : result.orderStatus === 'PartiallyFilled' ? 'partial' : 'pending',
      fillPrice: result.avgPrice,
      filledSize: result.cumExecQty,
    };
  }

  async function executeMexc(payload: TradeRequest): Promise<TradeResponse> {
    const creds = config.mexc;
    if (!creds) throw new Error('MEXC not configured');

    const mexcConfig: MexcConfig = {
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
    };

    const symbol = payload.marketId.replace('/', '_'); // MEXC uses underscore
    const quantity = payload.size;

    const result = payload.side === 'buy'
      ? await mexcOpenLong(mexcConfig, symbol, quantity)
      : await mexcOpenShort(mexcConfig, symbol, quantity);

    return {
      orderId: String(result.orderId),
      status: result.state === 0 ? 'pending' : result.state === 1 ? 'partial' : 'filled',
      fillPrice: result.dealAvgPrice,
      filledSize: result.dealVol,
    };
  }

  // Drift trading instance (lazy init)
  let driftTrading: ReturnType<typeof createDriftTrading> | null = null;

  async function executeDrift(payload: TradeRequest): Promise<TradeResponse> {
    if (!config.privateKey) throw new Error('Private key not configured for Drift');

    // Lazy init Drift trading
    if (!driftTrading) {
      const driftConfig: DriftTradingConfig = {
        privateKey: config.privateKey,
        rpcUrl: config.drift?.rpcUrl || process.env.SOLANA_RPC_URL,
        dryRun: cfg.dryRun,
      };
      driftTrading = createDriftTrading(driftConfig);
      await driftTrading.initialize();
    }

    // marketId should be the market index (0=BTC, 1=ETH, etc.)
    const marketIndex = parseInt(payload.marketId, 10) || 0;
    const amount = payload.size;
    const isLimit = payload.orderType === 'limit' && payload.price != null;

    // Drift BET: outcome is 'yes' or 'no', side is 'buy' or 'sell'
    // For simplicity: buy=long (YES), sell=short (NO)
    let order: Awaited<ReturnType<typeof driftTrading.buyYes>> = null;

    if (payload.side === 'buy') {
      order = isLimit
        ? await driftTrading.limitBuyYes(marketIndex, amount, payload.price!)
        : await driftTrading.buyYes(marketIndex, amount, payload.price);
    } else {
      order = isLimit
        ? await driftTrading.limitSellYes(marketIndex, amount, payload.price!)
        : await driftTrading.sellYes(marketIndex, amount, payload.price);
    }

    if (!order) {
      throw new Error('Drift order failed');
    }

    return {
      orderId: order.orderId,
      status: order.status === 'filled' ? 'filled' : 'pending',
      fillPrice: order.price,
      filledSize: order.baseAssetAmount,
    };
  }

  async function executeJupiter(payload: TradeRequest): Promise<TradeResponse> {
    if (!config.privateKey) throw new Error('Private key not configured for DEX');

    // Derive keypair from private key (base58-encoded)
    const keypair = Keypair.fromSecretKey(bs58.decode(config.privateKey));
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
    );

    // marketId format: "inputMint/outputMint"
    const [inputMint, outputMint] = payload.marketId.split('/');
    if (!inputMint || !outputMint) {
      throw new Error('Jupiter marketId must be in format "inputMint/outputMint"');
    }

    const params: JupiterSwapParams = {
      inputMint,
      outputMint,
      amount: String(payload.size),
      slippageBps: payload.slippagePct ? Math.round(payload.slippagePct * 10000) : undefined,
    };

    const result = await executeJupiterSwap(connection, keypair, params);

    return {
      orderId: result.signature,
      status: 'filled',
      txHash: result.signature,
      filledSize: result.outAmount ? Number(result.outAmount) : undefined,
    };
  }

  async function executeUniswap(payload: TradeRequest): Promise<TradeResponse> {
    if (!config.privateKey) throw new Error('Private key not configured for DEX');

    // marketId format: "inputToken/outputToken" or "inputToken/outputToken@chain"
    const [tokenPart, chainPart] = payload.marketId.split('@');
    const [inputToken, outputToken] = tokenPart.split('/');
    if (!inputToken || !outputToken) {
      throw new Error('Uniswap marketId must be in format "inputToken/outputToken" or "inputToken/outputToken@chain"');
    }

    const chain = (chainPart || 'ethereum') as EvmChain;

    const params: UniswapSwapParams = {
      chain,
      inputToken,
      outputToken,
      amount: String(payload.size),
      slippageBps: payload.slippagePct ? Math.round(payload.slippagePct * 10000) : undefined,
    };

    const result = await executeUniswapSwap(params);

    if (!result.success) {
      throw new Error(`Uniswap error: ${result.error || 'Unknown error'}`);
    }

    return {
      orderId: result.txHash || '',
      status: 'filled',
      txHash: result.txHash,
      filledSize: result.outputAmount ? Number(result.outputAmount) : undefined,
    };
  }

  async function executeAerodrome(payload: TradeRequest): Promise<TradeResponse> {
    if (!config.privateKey) throw new Error('Private key not configured for DEX');

    // Aerodrome uses a Velodrome V2 router interface incompatible with Uniswap V3.
    // For Base chain swaps, use Uniswap with marketId "token/token@base" instead.
    throw new Error(
      'Aerodrome is not yet supported. For Base chain swaps, use the "uniswap" platform with marketId format "inputToken/outputToken@base" instead.'
    );
  }

  return {
    execute,
    getPlatforms,
    isAvailable,
    getPlatformConfig,
  };
}
