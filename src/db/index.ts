/**
 * Database - SQLite (sql.js WASM) for local persistence
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { logger } from '../utils/logger';
import { resolveStateDir } from '../utils/config';
import type {
  User,
  Session,
  Alert,
  Position,
  PortfolioSnapshot,
  Market,
  Platform,
  TradingCredentials,
  MarketIndexEntry,
} from '../types';

const DB_DIR = resolveStateDir();
const DB_FILE = join(DB_DIR, 'clodds.db');
const BACKUP_DIR = join(DB_DIR, 'backups');

// Hyperliquid types
export interface HyperliquidTrade {
  id?: number;
  userId: string;
  tradeId?: string;
  orderId?: string;
  coin: string;
  side: 'BUY' | 'SELL';
  direction?: 'LONG' | 'SHORT';
  size: number;
  price: number;
  fee?: number;
  feeToken?: string;
  closedPnl?: number;
  orderType?: string;
  isMaker?: boolean;
  leverage?: number;
  timestamp: Date;
  createdAt?: Date;
}

export interface HyperliquidPosition {
  id?: number;
  userId: string;
  coin: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  markPrice?: number;
  liquidationPrice?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  leverage?: number;
  marginUsed?: number;
  openedAt: Date;
  closedAt?: Date;
  closePrice?: number;
  closeReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface HyperliquidFunding {
  id?: number;
  userId: string;
  coin: string;
  fundingRate: number;
  payment: number;
  positionSize: number;
  timestamp: Date;
  createdAt?: Date;
}

export interface HyperliquidStats {
  totalTrades: number;
  totalVolume: number;
  totalFees: number;
  totalPnl: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  byCoin: Record<string, {
    trades: number;
    volume: number;
    pnl: number;
    fees: number;
  }>;
}

// Binance Futures types
export interface BinanceFuturesTrade {
  id?: number;
  userId: string;
  tradeId?: string;
  orderId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  positionSide?: 'LONG' | 'SHORT' | 'BOTH';
  size: number;
  price: number;
  commission?: number;
  commissionAsset?: string;
  realizedPnl?: number;
  orderType?: string;
  isMaker?: boolean;
  leverage?: number;
  timestamp: Date;
  createdAt?: Date;
}

export interface BinanceFuturesPosition {
  id?: number;
  userId: string;
  symbol: string;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  size: number;
  entryPrice: number;
  markPrice?: number;
  liquidationPrice?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  leverage?: number;
  marginType?: 'cross' | 'isolated';
  isolatedMargin?: number;
  openedAt: Date;
  closedAt?: Date;
  closePrice?: number;
  closeReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BinanceFuturesFunding {
  id?: number;
  userId: string;
  symbol: string;
  fundingRate: number;
  payment: number;
  positionSize: number;
  timestamp: Date;
  createdAt?: Date;
}

export interface BinanceFuturesStats {
  totalTrades: number;
  totalVolume: number;
  totalFees: number;
  totalPnl: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  bySymbol: Record<string, {
    trades: number;
    volume: number;
    pnl: number;
    fees: number;
  }>;
}

// Bybit Futures types
export interface BybitFuturesTrade {
  id?: number;
  userId: string;
  tradeId?: string;
  orderId?: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  positionSide?: 'Long' | 'Short';
  size: number;
  price: number;
  commission?: number;
  commissionAsset?: string;
  closedPnl?: number;
  orderType?: string;
  isMaker?: boolean;
  leverage?: number;
  timestamp: Date;
  createdAt?: Date;
}

export interface BybitFuturesPosition {
  id?: number;
  userId: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  size: number;
  entryPrice: number;
  markPrice?: number;
  liquidationPrice?: number;
  unrealizedPnl?: number;
  cumRealisedPnl?: number;
  leverage?: number;
  tradeMode?: 'cross' | 'isolated';
  positionMargin?: number;
  openedAt: Date;
  closedAt?: Date;
  closePrice?: number;
  closeReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BybitFuturesFunding {
  id?: number;
  userId: string;
  symbol: string;
  fundingRate: number;
  payment: number;
  positionSize: number;
  timestamp: Date;
  createdAt?: Date;
}

export interface BybitFuturesStats {
  totalTrades: number;
  totalVolume: number;
  totalFees: number;
  totalPnl: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  bySymbol: Record<string, {
    trades: number;
    volume: number;
    pnl: number;
    fees: number;
  }>;
}

// MEXC Futures types
export interface MexcFuturesTrade {
  id?: number;
  userId: string;
  tradeId?: string;
  orderId?: string;
  symbol: string;
  side: number; // 1=Open Long, 2=Close Short, 3=Open Short, 4=Close Long
  vol: number;
  price: number;
  fee?: number;
  feeAsset?: string;
  realizedPnl?: number;
  orderType?: number;
  isMaker?: boolean;
  leverage?: number;
  timestamp: Date;
  createdAt?: Date;
}

export interface MexcFuturesPosition {
  id?: number;
  userId: string;
  symbol: string;
  positionType: number; // 1=Long, 2=Short
  holdVol: number;
  openAvgPrice: number;
  markPrice?: number;
  liquidationPrice?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  leverage?: number;
  marginMode?: number; // 1=Isolated, 2=Cross
  positionMargin?: number;
  openedAt: Date;
  closedAt?: Date;
  closePrice?: number;
  closeReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MexcFuturesFunding {
  id?: number;
  userId: string;
  symbol: string;
  fundingRate: number;
  payment: number;
  positionSize: number;
  timestamp: Date;
  createdAt?: Date;
}

export interface MexcFuturesStats {
  totalTrades: number;
  totalVolume: number;
  totalFees: number;
  totalPnl: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  bySymbol: Record<string, {
    trades: number;
    volume: number;
    pnl: number;
    fees: number;
  }>;
}

// Opinion.trade types
export interface OpinionTrade {
  id?: number;
  oddsUserId: string;
  orderId: string;
  marketId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  orderType: 'LIMIT' | 'MARKET';
  status?: string;
  filledSize?: number;
  avgFillPrice?: number;
  fee?: number;
  txHash?: string;
  timestamp: Date;
  createdAt?: Date;
}

// Predict.fun types
export interface PredictFunTrade {
  id?: number;
  oddsUserId: string;
  orderHash: string;
  marketId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  status?: string;
  filledQuantity?: number;
  avgFillPrice?: number;
  fee?: number;
  txHash?: string;
  isNegRisk?: boolean;
  isYieldBearing?: boolean;
  timestamp: Date;
  createdAt?: Date;
}

// Polymarket types
export interface PolymarketTrade {
  id?: number;
  oddsUserId: string;
  orderId: string;
  marketId: string;
  tokenId: string;
  conditionId?: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  orderType: 'LIMIT' | 'MARKET';
  status?: string;
  filledSize?: number;
  avgFillPrice?: number;
  fee?: number;
  txHash?: string;
  timestamp: Date;
  createdAt?: Date;
}

// Kalshi types
export interface KalshiTrade {
  id?: number;
  oddsUserId: string;
  orderId: string;
  marketId: string;
  ticker: string;
  side: 'yes' | 'no';
  price: number;
  count: number;
  orderType: 'limit' | 'market';
  status?: string;
  filledCount?: number;
  avgFillPrice?: number;
  fee?: number;
  action?: string;
  timestamp: Date;
  createdAt?: Date;
}

// Drift Protocol types
export interface DriftTrade {
  id?: number;
  oddsUserId: string;
  orderId?: string;
  marketIndex: number;
  marketType: 'perp' | 'spot';
  direction: 'long' | 'short';
  baseAmount: number;
  quoteAmount?: number;
  price?: number;
  orderType: 'market' | 'limit' | 'postOnly';
  status?: string;
  filledAmount?: number;
  avgFillPrice?: number;
  leverage?: number;
  txSig?: string;
  timestamp: Date;
  createdAt?: Date;
}

// Manifold types
export interface ManifoldTrade {
  id?: number;
  oddsUserId: string;
  betId: string;
  contractId: string;
  outcome: string;
  amount: number;
  shares: number;
  probabilityBefore?: number;
  probabilityAfter?: number;
  status?: string;
  fee?: number;
  timestamp: Date;
  createdAt?: Date;
}

// Solana DEX types
export interface SolanaDexTrade {
  id?: number;
  oddsUserId: string;
  txSig: string;
  dex: 'jupiter' | 'raydium' | 'orca' | 'meteora';
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  inputSymbol?: string;
  outputSymbol?: string;
  priceImpact?: number;
  slippage?: number;
  fee?: number;
  route?: string;
  timestamp: Date;
  createdAt?: Date;
}

// Jupiter-specific swap tracking
export interface JupiterSwap {
  id?: number;
  oddsUserId: string;
  txSig: string;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  inputSymbol?: string;
  outputSymbol?: string;
  priceImpactPct?: number;
  slippageBps?: number;
  routePlan?: string;
  numHops?: number;
  priorityFee?: number;
  timestamp: Date;
  createdAt?: Date;
}

// Raydium pool tracking
export interface RaydiumPool {
  id?: number;
  poolId: string;
  baseMint: string;
  quoteMint: string;
  baseSymbol?: string;
  quoteSymbol?: string;
  liquidity?: number;
  volume24h?: number;
  feeRate?: number;
  version?: string;
  lastUpdated: Date;
}

// Orca Whirlpool position
export interface OrcaPosition {
  id?: number;
  oddsUserId: string;
  positionAddress: string;
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  tickLower?: number;
  tickUpper?: number;
  liquidity?: string;
  feeOwedA?: string;
  feeOwedB?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Meteora DLMM pool
export interface MeteoraPool {
  id?: number;
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  tokenXSymbol?: string;
  tokenYSymbol?: string;
  binStep?: number;
  activeId?: number;
  liquidity?: number;
  feeRate?: number;
  lastUpdated: Date;
}

// Pump.fun token
export interface PumpToken {
  id?: number;
  mint: string;
  name?: string;
  symbol?: string;
  creator?: string;
  bondingCurve?: string;
  marketCap?: number;
  virtualSolReserves?: number;
  virtualTokenReserves?: number;
  totalSupply?: string;
  holderCount?: number;
  isGraduated?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Drift position
export interface DriftPosition {
  id?: number;
  oddsUserId: string;
  marketIndex: number;
  marketType: 'perp' | 'spot';
  baseAssetAmount: string;
  quoteAssetAmount?: string;
  entryPrice?: string;
  unrealizedPnl?: string;
  liquidationPrice?: string;
  leverage?: number;
  updatedAt: Date;
}

// EVM swap types
export interface EvmSwapTrade {
  id?: number;
  oddsUserId: string;
  txHash: string;
  chainId: number;
  dex: 'uniswap' | 'sushiswap' | '1inch' | 'pancakeswap' | 'other';
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  tokenInSymbol?: string;
  tokenOutSymbol?: string;
  priceImpact?: number;
  slippage?: number;
  gasUsed?: number;
  gasPrice?: number;
  timestamp: Date;
  createdAt?: Date;
}

export interface Database {
  close(): void;
  save(): void;
  withConnection<T>(fn: (db: Database) => T | Promise<T>): Promise<T>;
  backupNow(): void;
  getVersion(): number;
  setVersion(version: number): void;

  // Raw SQL access (for custom queries)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(sql: string, params?: any[]): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T>(sql: string, params?: any[]): T[];

  // Users
  getUserByPlatformId(platform: string, platformUserId: string): User | undefined;
  getUser(userId: string): User | undefined;
  listUsers(): User[];
  createUser(user: User): void;
  updateUserActivity(userId: string): void;
  updateUserSettings(userId: string, settings: Partial<User['settings']>): boolean;
  updateUserSettingsByPlatform(platform: string, platformUserId: string, settings: Partial<User['settings']>): boolean;

  // Sessions
  getSession(key: string): Session | undefined;
  getLatestSessionForUser(userId: string): {
    channel: string;
    chatId: string;
    chatType: 'dm' | 'group';
    updatedAt: Date;
  } | undefined;
  getLatestSessionForChat(platform: string, chatId: string): Session | undefined;
  createSession(session: Session): void;
  updateSession(session: Session): void;
  deleteSession(key: string): void;
  deleteSessionsBefore(cutoffMs: number): number;

  // Cron jobs
  listCronJobs(): Array<{
    id: string;
    data: string;
    enabled: boolean;
    createdAtMs: number;
    updatedAtMs: number;
  }>;
  getCronJob(id: string): {
    id: string;
    data: string;
    enabled: boolean;
    createdAtMs: number;
    updatedAtMs: number;
  } | undefined;
  upsertCronJob(record: {
    id: string;
    data: string;
    enabled: boolean;
    createdAtMs?: number;
    updatedAtMs?: number;
  }): void;
  deleteCronJob(id: string): void;

  // Alerts
  getAlerts(userId: string): Alert[];
  getActiveAlerts(): Alert[];
  createAlert(alert: Alert): void;
  updateAlert(alert: Alert): void;
  deleteAlert(alertId: string): void;
  triggerAlert(alertId: string): void;

  // Positions
  getPositions(userId: string): Position[];
  listPositionsForPricing(): Array<{
    id: string;
    userId: string;
    platform: Platform;
    marketId: string;
    outcomeId: string;
    outcome: string;
  }>;
  updatePositionPrice(positionId: string, currentPrice: number): void;
  upsertPosition(userId: string, position: Position): void;
  deletePosition(positionId: string): void;

  // Portfolio P&L snapshots
  createPortfolioSnapshot(snapshot: {
    userId: string;
    totalValue: number;
    totalPnl: number;
    totalPnlPct: number;
    totalCostBasis: number;
    positionsCount: number;
    byPlatform: Record<string, { value: number; pnl: number }>;
    createdAt?: Date;
  }): void;
  getPortfolioSnapshots(
    userId: string,
    options?: { sinceMs?: number; limit?: number; order?: 'asc' | 'desc' }
  ): PortfolioSnapshot[];
  deletePortfolioSnapshotsBefore(cutoffMs: number): void;

  // Stop-loss triggers
  getStopLossTrigger(userId: string, platform: Platform, outcomeId: string): {
    userId: string;
    platform: Platform;
    outcomeId: string;
    marketId?: string;
    status: string;
    triggeredAt: Date;
    lastPrice?: number;
    lastError?: string;
    cooldownUntil?: Date;
  } | undefined;
  upsertStopLossTrigger(record: {
    userId: string;
    platform: Platform;
    outcomeId: string;
    marketId?: string;
    status: string;
    triggeredAt: Date;
    lastPrice?: number;
    lastError?: string;
    cooldownUntil?: Date;
  }): void;
  deleteStopLossTrigger(userId: string, platform: Platform, outcomeId: string): void;

  // Market cache
  cacheMarket(market: Market): void;
  getCachedMarket(platform: string, marketId: string, maxAgeMs?: number): Market | undefined;
  pruneMarketCache(cutoffMs: number): number;

  // Market index (semantic search)
  upsertMarketIndex(entry: MarketIndexEntry): void;
  getMarketIndexHash(platform: Platform, marketId: string): string | null;
  getMarketIndexEmbedding(platform: Platform, marketId: string): { contentHash: string; vector: number[] } | null;
  upsertMarketIndexEmbedding(
    platform: Platform,
    marketId: string,
    contentHash: string,
    vector: number[]
  ): void;
  listMarketIndex(options?: {
    platform?: Platform;
    limit?: number;
    textQuery?: string;
  }): MarketIndexEntry[];
  countMarketIndex(platform?: Platform): number;
  pruneMarketIndex(cutoffMs: number, platform?: Platform): number;

  // Trading Credentials (per-user, encrypted)
  getTradingCredentials(userId: string, platform: Platform): TradingCredentials | null;
  createTradingCredentials(creds: TradingCredentials): void;
  updateTradingCredentials(creds: TradingCredentials): void;
  deleteTradingCredentials(userId: string, platform: Platform): void;
  listUserTradingPlatforms(userId: string): Platform[];

  // Hyperliquid trades
  logHyperliquidTrade(trade: HyperliquidTrade): void;
  getHyperliquidTrades(userId: string, options?: {
    coin?: string;
    limit?: number;
    since?: number;
  }): HyperliquidTrade[];
  getHyperliquidStats(userId: string, options?: {
    coin?: string;
    since?: number;
  }): HyperliquidStats;

  // Hyperliquid positions
  upsertHyperliquidPosition(userId: string, position: HyperliquidPosition): void;
  getHyperliquidPositions(userId: string, options?: {
    coin?: string;
    openOnly?: boolean;
  }): HyperliquidPosition[];
  closeHyperliquidPosition(userId: string, coin: string, closePrice: number, reason?: string): void;

  // Hyperliquid funding
  logHyperliquidFunding(funding: HyperliquidFunding): void;
  getHyperliquidFunding(userId: string, options?: {
    coin?: string;
    limit?: number;
    since?: number;
  }): HyperliquidFunding[];
  getHyperliquidFundingTotal(userId: string, options?: {
    coin?: string;
    since?: number;
  }): number;

  // Binance Futures trades
  logBinanceFuturesTrade(trade: BinanceFuturesTrade): void;
  getBinanceFuturesTrades(userId: string, options?: {
    symbol?: string;
    limit?: number;
    since?: number;
  }): BinanceFuturesTrade[];
  getBinanceFuturesStats(userId: string, options?: {
    symbol?: string;
    since?: number;
  }): BinanceFuturesStats;

  // Binance Futures positions
  upsertBinanceFuturesPosition(userId: string, position: BinanceFuturesPosition): void;
  getBinanceFuturesPositions(userId: string, options?: {
    symbol?: string;
    openOnly?: boolean;
  }): BinanceFuturesPosition[];
  closeBinanceFuturesPosition(userId: string, symbol: string, closePrice: number, reason?: string): void;

  // Binance Futures funding
  logBinanceFuturesFunding(funding: BinanceFuturesFunding): void;
  getBinanceFuturesFunding(userId: string, options?: {
    symbol?: string;
    limit?: number;
    since?: number;
  }): BinanceFuturesFunding[];
  getBinanceFuturesFundingTotal(userId: string, options?: {
    symbol?: string;
    since?: number;
  }): number;

  // Bybit Futures trades
  logBybitFuturesTrade(trade: BybitFuturesTrade): void;
  getBybitFuturesTrades(userId: string, options?: {
    symbol?: string;
    limit?: number;
    since?: number;
  }): BybitFuturesTrade[];
  getBybitFuturesStats(userId: string, options?: {
    symbol?: string;
    since?: number;
  }): BybitFuturesStats;

  // Bybit Futures positions
  upsertBybitFuturesPosition(userId: string, position: BybitFuturesPosition): void;
  getBybitFuturesPositions(userId: string, options?: {
    symbol?: string;
    openOnly?: boolean;
  }): BybitFuturesPosition[];
  closeBybitFuturesPosition(userId: string, symbol: string, closePrice: number, reason?: string): void;

  // Bybit Futures funding
  logBybitFuturesFunding(funding: BybitFuturesFunding): void;
  getBybitFuturesFunding(userId: string, options?: {
    symbol?: string;
    limit?: number;
    since?: number;
  }): BybitFuturesFunding[];
  getBybitFuturesFundingTotal(userId: string, options?: {
    symbol?: string;
    since?: number;
  }): number;

  // MEXC Futures trades
  logMexcFuturesTrade(trade: MexcFuturesTrade): void;
  getMexcFuturesTrades(userId: string, options?: {
    symbol?: string;
    limit?: number;
    since?: number;
  }): MexcFuturesTrade[];
  getMexcFuturesStats(userId: string, options?: {
    symbol?: string;
    since?: number;
  }): MexcFuturesStats;

  // MEXC Futures positions
  upsertMexcFuturesPosition(userId: string, position: MexcFuturesPosition): void;
  getMexcFuturesPositions(userId: string, options?: {
    symbol?: string;
    openOnly?: boolean;
  }): MexcFuturesPosition[];
  closeMexcFuturesPosition(userId: string, symbol: string, closePrice: number, reason?: string): void;

  // MEXC Futures funding
  logMexcFuturesFunding(funding: MexcFuturesFunding): void;
  getMexcFuturesFunding(userId: string, options?: {
    symbol?: string;
    limit?: number;
    since?: number;
  }): MexcFuturesFunding[];
  getMexcFuturesFundingTotal(userId: string, options?: {
    symbol?: string;
    since?: number;
  }): number;

  // Opinion.trade trades
  logOpinionTrade(trade: OpinionTrade): void;
  getOpinionTrades(userId: string, options?: {
    marketId?: string;
    limit?: number;
    since?: number;
  }): OpinionTrade[];

  // Predict.fun trades
  logPredictFunTrade(trade: PredictFunTrade): void;
  getPredictFunTrades(userId: string, options?: {
    marketId?: string;
    limit?: number;
    since?: number;
  }): PredictFunTrade[];

  // Polymarket trades
  logPolymarketTrade(trade: PolymarketTrade): void;
  getPolymarketTrades(userId: string, options?: {
    marketId?: string;
    limit?: number;
    since?: number;
  }): PolymarketTrade[];

  // Kalshi trades
  logKalshiTrade(trade: KalshiTrade): void;
  getKalshiTrades(userId: string, options?: {
    marketId?: string;
    ticker?: string;
    limit?: number;
    since?: number;
  }): KalshiTrade[];

  // Drift trades
  logDriftTrade(trade: DriftTrade): void;
  getDriftTrades(userId: string, options?: {
    marketIndex?: number;
    marketType?: string;
    limit?: number;
    since?: number;
  }): DriftTrade[];

  // Manifold trades
  logManifoldTrade(trade: ManifoldTrade): void;
  getManifoldTrades(userId: string, options?: {
    contractId?: string;
    limit?: number;
    since?: number;
  }): ManifoldTrade[];

  // Solana DEX trades
  logSolanaDexTrade(trade: SolanaDexTrade): void;
  getSolanaDexTrades(userId: string, options?: {
    dex?: string;
    limit?: number;
    since?: number;
  }): SolanaDexTrade[];

  // EVM swap trades
  logEvmSwapTrade(trade: EvmSwapTrade): void;
  getEvmSwapTrades(userId: string, options?: {
    chainId?: number;
    dex?: string;
    limit?: number;
    since?: number;
  }): EvmSwapTrade[];

  // Jupiter swaps
  logJupiterSwap(swap: JupiterSwap): void;
  getJupiterSwaps(userId: string, limit?: number): JupiterSwap[];

  // Drift trades
  logDriftTrade(trade: DriftTrade): void;
  getDriftTrades(userId: string, options?: { marketIndex?: number; limit?: number }): DriftTrade[];

  // Drift positions
  upsertDriftPosition(position: DriftPosition): void;
  getDriftPositions(userId: string): DriftPosition[];

  // Pump.fun tokens
  upsertPumpToken(token: PumpToken): void;
  getPumpToken(mint: string): PumpToken | null;
}

let dbInstance: Database | null = null;
let sqlJsDb: SqlJsDatabase | null = null;
let dbInitPromise: Promise<Database> | null = null;
let backupInterval: ReturnType<typeof setInterval> | null = null;

export async function initDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    // Ensure directory exists
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true });
    }

    logger.info(`Opening database: ${DB_FILE}`);

    // Initialize sql.js
    const SQL = await initSqlJs();

    // Load existing database or create new
    if (existsSync(DB_FILE)) {
      const buffer = readFileSync(DB_FILE);
      sqlJsDb = new SQL.Database(buffer);
    } else {
      sqlJsDb = new SQL.Database();
    }

    const db = sqlJsDb;

    // Create tables
    db.run(`
    CREATE TABLE IF NOT EXISTS _schema_version (
      version INTEGER NOT NULL,
      applied_at INTEGER NOT NULL
    );

    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      username TEXT,
      settings TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      UNIQUE(platform, platform_user_id)
    );

    -- Alerts table
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT,
      market_id TEXT,
      platform TEXT,
      channel TEXT,
      chat_id TEXT,
      condition TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      triggered INTEGER DEFAULT 0,
      trigger_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_triggered_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Positions table
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      market_id TEXT NOT NULL,
      market_question TEXT,
      outcome TEXT NOT NULL,
      outcome_id TEXT NOT NULL,
      side TEXT NOT NULL,
      shares REAL NOT NULL,
      avg_price REAL NOT NULL,
      current_price REAL,
      opened_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, platform, market_id, outcome_id)
    );

    -- Portfolio P&L snapshots
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      total_value REAL NOT NULL,
      total_pnl REAL NOT NULL,
      total_pnl_pct REAL NOT NULL,
      total_cost_basis REAL NOT NULL,
      positions_count INTEGER NOT NULL,
      by_platform TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Stop-loss triggers
    CREATE TABLE IF NOT EXISTS stop_loss_triggers (
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      outcome_id TEXT NOT NULL,
      market_id TEXT,
      status TEXT NOT NULL,
      triggered_at INTEGER NOT NULL,
      last_price REAL,
      last_error TEXT,
      cooldown_until INTEGER,
      PRIMARY KEY (user_id, platform, outcome_id)
    );

    -- Market cache table
    CREATE TABLE IF NOT EXISTS markets (
      platform TEXT NOT NULL,
      market_id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (platform, market_id)
    );

    -- Market index table (semantic search)
    CREATE TABLE IF NOT EXISTS market_index (
      platform TEXT NOT NULL,
      market_id TEXT NOT NULL,
      slug TEXT,
      question TEXT NOT NULL,
      description TEXT,
      outcomes_json TEXT,
      tags_json TEXT,
      status TEXT,
      url TEXT,
      end_date INTEGER,
      resolved INTEGER,
      volume_24h REAL,
      liquidity REAL,
      open_interest REAL,
      predictions INTEGER,
      content_hash TEXT,
      updated_at INTEGER NOT NULL,
      raw_json TEXT,
      PRIMARY KEY (platform, market_id)
    );

    CREATE INDEX IF NOT EXISTS idx_market_index_platform ON market_index(platform);
    CREATE INDEX IF NOT EXISTS idx_market_index_updated ON market_index(updated_at);
    CREATE INDEX IF NOT EXISTS idx_market_index_hash ON market_index(content_hash);

    -- Market index embeddings (persistent vectors)
    CREATE TABLE IF NOT EXISTS market_index_embeddings (
      platform TEXT NOT NULL,
      market_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      vector TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (platform, market_id)
    );

    CREATE INDEX IF NOT EXISTS idx_market_index_embeddings_hash ON market_index_embeddings(content_hash);

    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT,
      key TEXT PRIMARY KEY,
      user_id TEXT,
      channel TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      chat_type TEXT NOT NULL,
      context TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Cron jobs table
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Trading Credentials table (per-user, encrypted)
    CREATE TABLE IF NOT EXISTS trading_credentials (
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      mode TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_used_at INTEGER,
      failed_attempts INTEGER DEFAULT 0,
      cooldown_until INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, platform),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Watched wallets table (for whale tracking)
    CREATE TABLE IF NOT EXISTS watched_wallets (
      user_id TEXT NOT NULL,
      address TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'polymarket',
      nickname TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, address),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Auto-copy settings (for copy trading)
    CREATE TABLE IF NOT EXISTS auto_copy_settings (
      user_id TEXT NOT NULL,
      target_address TEXT NOT NULL,
      max_size REAL NOT NULL,
      size_multiplier REAL NOT NULL DEFAULT 0.5,
      min_confidence REAL NOT NULL DEFAULT 0.55,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, target_address),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Paper trading settings
    CREATE TABLE IF NOT EXISTS paper_trading_settings (
      user_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      balance REAL NOT NULL DEFAULT 10000,
      starting_balance REAL NOT NULL DEFAULT 10000,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Paper trading positions
    CREATE TABLE IF NOT EXISTS paper_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      market_name TEXT,
      side TEXT NOT NULL,
      size REAL NOT NULL,
      entry_price REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Paper trading trade history
    CREATE TABLE IF NOT EXISTS paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      market_name TEXT,
      side TEXT NOT NULL,
      size REAL NOT NULL,
      price REAL NOT NULL,
      pnl REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Alert settings (for whale alerts, new market alerts, etc.)
    CREATE TABLE IF NOT EXISTS alert_settings (
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      min_size REAL,
      threshold REAL,
      markets TEXT,
      categories TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, type),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Pairing requests (pending DM access)
    CREATE TABLE IF NOT EXISTS pairing_requests (
      code TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      userId TEXT NOT NULL,
      username TEXT,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    );

    -- Paired users (approved DM access)
    CREATE TABLE IF NOT EXISTS paired_users (
      channel TEXT NOT NULL,
      userId TEXT NOT NULL,
      username TEXT,
      pairedAt TEXT NOT NULL,
      pairedBy TEXT NOT NULL DEFAULT 'allowlist',
      isOwner INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (channel, userId)
    );

    -- Hyperliquid trades table
    CREATE TABLE IF NOT EXISTS hyperliquid_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      trade_id TEXT,
      order_id TEXT,
      coin TEXT NOT NULL,
      side TEXT NOT NULL,
      direction TEXT,
      size REAL NOT NULL,
      price REAL NOT NULL,
      fee REAL DEFAULT 0,
      fee_token TEXT DEFAULT 'USDC',
      closed_pnl REAL,
      order_type TEXT,
      is_maker INTEGER DEFAULT 0,
      leverage INTEGER,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_hl_trades_user ON hyperliquid_trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_hl_trades_coin ON hyperliquid_trades(coin);
    CREATE INDEX IF NOT EXISTS idx_hl_trades_timestamp ON hyperliquid_trades(timestamp);

    -- Hyperliquid positions history
    CREATE TABLE IF NOT EXISTS hyperliquid_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      coin TEXT NOT NULL,
      side TEXT NOT NULL,
      size REAL NOT NULL,
      entry_price REAL NOT NULL,
      mark_price REAL,
      liquidation_price REAL,
      unrealized_pnl REAL,
      realized_pnl REAL DEFAULT 0,
      leverage INTEGER,
      margin_used REAL,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      close_price REAL,
      close_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_hl_positions_user ON hyperliquid_positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_hl_positions_coin ON hyperliquid_positions(coin);
    CREATE INDEX IF NOT EXISTS idx_hl_positions_open ON hyperliquid_positions(closed_at);

    -- Hyperliquid funding payments
    CREATE TABLE IF NOT EXISTS hyperliquid_funding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      coin TEXT NOT NULL,
      funding_rate REAL NOT NULL,
      payment REAL NOT NULL,
      position_size REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_hl_funding_user ON hyperliquid_funding(user_id);
    CREATE INDEX IF NOT EXISTS idx_hl_funding_coin ON hyperliquid_funding(coin);
    CREATE INDEX IF NOT EXISTS idx_hl_funding_timestamp ON hyperliquid_funding(timestamp);

    -- Binance Futures trades table
    CREATE TABLE IF NOT EXISTS binance_futures_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      trade_id TEXT,
      order_id TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      position_side TEXT,
      size REAL NOT NULL,
      price REAL NOT NULL,
      commission REAL DEFAULT 0,
      commission_asset TEXT DEFAULT 'USDT',
      realized_pnl REAL,
      order_type TEXT,
      is_maker INTEGER DEFAULT 0,
      leverage INTEGER,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_binance_trades_user ON binance_futures_trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_binance_trades_symbol ON binance_futures_trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_binance_trades_timestamp ON binance_futures_trades(timestamp);

    -- Binance Futures positions history
    CREATE TABLE IF NOT EXISTS binance_futures_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      position_side TEXT NOT NULL,
      size REAL NOT NULL,
      entry_price REAL NOT NULL,
      mark_price REAL,
      liquidation_price REAL,
      unrealized_pnl REAL,
      realized_pnl REAL DEFAULT 0,
      leverage INTEGER,
      margin_type TEXT,
      isolated_margin REAL,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      close_price REAL,
      close_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_binance_positions_user ON binance_futures_positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_binance_positions_symbol ON binance_futures_positions(symbol);
    CREATE INDEX IF NOT EXISTS idx_binance_positions_open ON binance_futures_positions(closed_at);

    -- Binance Futures funding payments
    CREATE TABLE IF NOT EXISTS binance_futures_funding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      funding_rate REAL NOT NULL,
      payment REAL NOT NULL,
      position_size REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_binance_funding_user ON binance_futures_funding(user_id);
    CREATE INDEX IF NOT EXISTS idx_binance_funding_symbol ON binance_futures_funding(symbol);
    CREATE INDEX IF NOT EXISTS idx_binance_funding_timestamp ON binance_futures_funding(timestamp);

    -- Bybit Futures trades table
    CREATE TABLE IF NOT EXISTS bybit_futures_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      trade_id TEXT,
      order_id TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      position_side TEXT,
      size REAL NOT NULL,
      price REAL NOT NULL,
      commission REAL DEFAULT 0,
      commission_asset TEXT DEFAULT 'USDT',
      closed_pnl REAL,
      order_type TEXT,
      is_maker INTEGER DEFAULT 0,
      leverage INTEGER,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_bybit_trades_user ON bybit_futures_trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_bybit_trades_symbol ON bybit_futures_trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_bybit_trades_timestamp ON bybit_futures_trades(timestamp);

    -- Bybit Futures positions history
    CREATE TABLE IF NOT EXISTS bybit_futures_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      size REAL NOT NULL,
      entry_price REAL NOT NULL,
      mark_price REAL,
      liquidation_price REAL,
      unrealized_pnl REAL,
      cum_realised_pnl REAL DEFAULT 0,
      leverage INTEGER,
      trade_mode TEXT,
      position_margin REAL,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      close_price REAL,
      close_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_bybit_positions_user ON bybit_futures_positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_bybit_positions_symbol ON bybit_futures_positions(symbol);
    CREATE INDEX IF NOT EXISTS idx_bybit_positions_open ON bybit_futures_positions(closed_at);

    -- Bybit Futures funding payments
    CREATE TABLE IF NOT EXISTS bybit_futures_funding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      funding_rate REAL NOT NULL,
      payment REAL NOT NULL,
      position_size REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_bybit_funding_user ON bybit_futures_funding(user_id);
    CREATE INDEX IF NOT EXISTS idx_bybit_funding_symbol ON bybit_futures_funding(symbol);
    CREATE INDEX IF NOT EXISTS idx_bybit_funding_timestamp ON bybit_futures_funding(timestamp);

    -- MEXC Futures trades table
    CREATE TABLE IF NOT EXISTS mexc_futures_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      trade_id TEXT,
      order_id TEXT,
      symbol TEXT NOT NULL,
      side INTEGER NOT NULL,
      vol REAL NOT NULL,
      price REAL NOT NULL,
      fee REAL DEFAULT 0,
      fee_asset TEXT DEFAULT 'USDT',
      realized_pnl REAL,
      order_type INTEGER,
      is_maker INTEGER DEFAULT 0,
      leverage INTEGER,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_mexc_trades_user ON mexc_futures_trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_mexc_trades_symbol ON mexc_futures_trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_mexc_trades_timestamp ON mexc_futures_trades(timestamp);

    -- MEXC Futures positions history
    CREATE TABLE IF NOT EXISTS mexc_futures_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      position_type INTEGER NOT NULL,
      hold_vol REAL NOT NULL,
      open_avg_price REAL NOT NULL,
      mark_price REAL,
      liquidation_price REAL,
      unrealized_pnl REAL,
      realized_pnl REAL DEFAULT 0,
      leverage INTEGER,
      margin_mode INTEGER,
      position_margin REAL,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      close_price REAL,
      close_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_mexc_positions_user ON mexc_futures_positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_mexc_positions_symbol ON mexc_futures_positions(symbol);
    CREATE INDEX IF NOT EXISTS idx_mexc_positions_open ON mexc_futures_positions(closed_at);

    -- MEXC Futures funding payments
    CREATE TABLE IF NOT EXISTS mexc_futures_funding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      funding_rate REAL NOT NULL,
      payment REAL NOT NULL,
      position_size REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_mexc_funding_user ON mexc_futures_funding(user_id);
    CREATE INDEX IF NOT EXISTS idx_mexc_funding_symbol ON mexc_futures_funding(symbol);
    CREATE INDEX IF NOT EXISTS idx_mexc_funding_timestamp ON mexc_futures_funding(timestamp);

    -- Opinion.trade trades table
    CREATE TABLE IF NOT EXISTS opinion_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      size REAL NOT NULL,
      order_type TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      filled_size REAL DEFAULT 0,
      avg_fill_price REAL,
      fee REAL DEFAULT 0,
      tx_hash TEXT,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_opinion_trades_user ON opinion_trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_opinion_trades_market ON opinion_trades(market_id);
    CREATE INDEX IF NOT EXISTS idx_opinion_trades_timestamp ON opinion_trades(timestamp);

    -- Predict.fun trades table
    CREATE TABLE IF NOT EXISTS predictfun_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      order_hash TEXT NOT NULL,
      market_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      status TEXT DEFAULT 'open',
      filled_quantity REAL DEFAULT 0,
      avg_fill_price REAL,
      fee REAL DEFAULT 0,
      tx_hash TEXT,
      is_neg_risk INTEGER DEFAULT 0,
      is_yield_bearing INTEGER DEFAULT 1,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_predictfun_trades_user ON predictfun_trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_predictfun_trades_market ON predictfun_trades(market_id);
    CREATE INDEX IF NOT EXISTS idx_predictfun_trades_timestamp ON predictfun_trades(timestamp);

    -- Polymarket trades table
    CREATE TABLE IF NOT EXISTS polymarket_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      condition_id TEXT,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      size REAL NOT NULL,
      order_type TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      filled_size REAL DEFAULT 0,
      avg_fill_price REAL,
      fee REAL DEFAULT 0,
      tx_hash TEXT,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_polymarket_trades_user ON polymarket_trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_polymarket_trades_market ON polymarket_trades(market_id);
    CREATE INDEX IF NOT EXISTS idx_polymarket_trades_timestamp ON polymarket_trades(timestamp);

    -- Kalshi trades table
    CREATE TABLE IF NOT EXISTS kalshi_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      count INTEGER NOT NULL,
      order_type TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      filled_count INTEGER DEFAULT 0,
      avg_fill_price REAL,
      fee REAL DEFAULT 0,
      action TEXT,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_kalshi_trades_user ON kalshi_trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_kalshi_trades_market ON kalshi_trades(market_id);
    CREATE INDEX IF NOT EXISTS idx_kalshi_trades_ticker ON kalshi_trades(ticker);
    CREATE INDEX IF NOT EXISTS idx_kalshi_trades_timestamp ON kalshi_trades(timestamp);

    -- Drift Protocol trades table
    CREATE TABLE IF NOT EXISTS drift_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      order_id TEXT,
      market_index INTEGER NOT NULL,
      market_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      base_amount REAL NOT NULL,
      quote_amount REAL,
      price REAL,
      order_type TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      filled_amount REAL DEFAULT 0,
      avg_fill_price REAL,
      leverage REAL,
      tx_sig TEXT,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_drift_trades_user ON drift_trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_drift_trades_market ON drift_trades(market_index);
    CREATE INDEX IF NOT EXISTS idx_drift_trades_timestamp ON drift_trades(timestamp);

    -- Manifold Markets trades table
    CREATE TABLE IF NOT EXISTS manifold_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      bet_id TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      amount REAL NOT NULL,
      shares REAL NOT NULL,
      probability_before REAL,
      probability_after REAL,
      status TEXT DEFAULT 'filled',
      fee REAL DEFAULT 0,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_manifold_trades_user ON manifold_trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_manifold_trades_contract ON manifold_trades(contract_id);
    CREATE INDEX IF NOT EXISTS idx_manifold_trades_timestamp ON manifold_trades(timestamp);

    -- Solana DEX trades table (Jupiter, Raydium, Orca, Meteora)
    CREATE TABLE IF NOT EXISTS solana_dex_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      tx_sig TEXT NOT NULL,
      dex TEXT NOT NULL,
      input_mint TEXT NOT NULL,
      output_mint TEXT NOT NULL,
      input_amount REAL NOT NULL,
      output_amount REAL NOT NULL,
      input_symbol TEXT,
      output_symbol TEXT,
      price_impact REAL,
      slippage REAL,
      fee REAL DEFAULT 0,
      route TEXT,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_solana_dex_trades_user ON solana_dex_trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_solana_dex_trades_dex ON solana_dex_trades(dex);
    CREATE INDEX IF NOT EXISTS idx_solana_dex_trades_timestamp ON solana_dex_trades(timestamp);

    -- Jupiter swaps table (detailed route tracking)
    CREATE TABLE IF NOT EXISTS jupiter_swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      tx_sig TEXT NOT NULL UNIQUE,
      input_mint TEXT NOT NULL,
      output_mint TEXT NOT NULL,
      input_amount TEXT NOT NULL,
      output_amount TEXT NOT NULL,
      input_symbol TEXT,
      output_symbol TEXT,
      price_impact_pct REAL,
      slippage_bps INTEGER,
      route_plan TEXT,
      num_hops INTEGER,
      priority_fee INTEGER,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_jupiter_swaps_user ON jupiter_swaps(user_id);
    CREATE INDEX IF NOT EXISTS idx_jupiter_swaps_timestamp ON jupiter_swaps(timestamp);

    -- Raydium pools tracking
    CREATE TABLE IF NOT EXISTS raydium_pools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_id TEXT NOT NULL UNIQUE,
      base_mint TEXT NOT NULL,
      quote_mint TEXT NOT NULL,
      base_symbol TEXT,
      quote_symbol TEXT,
      liquidity REAL,
      volume_24h REAL,
      fee_rate REAL,
      version TEXT,
      last_updated INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_raydium_pools_mints ON raydium_pools(base_mint, quote_mint);

    -- Orca Whirlpool positions
    CREATE TABLE IF NOT EXISTS orca_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      position_address TEXT NOT NULL,
      pool_address TEXT NOT NULL,
      token_a_mint TEXT NOT NULL,
      token_b_mint TEXT NOT NULL,
      tick_lower INTEGER,
      tick_upper INTEGER,
      liquidity TEXT,
      fee_owed_a TEXT,
      fee_owed_b TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_orca_positions_user ON orca_positions(user_id);

    -- Meteora DLMM pools
    CREATE TABLE IF NOT EXISTS meteora_pools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_address TEXT NOT NULL UNIQUE,
      token_x_mint TEXT NOT NULL,
      token_y_mint TEXT NOT NULL,
      token_x_symbol TEXT,
      token_y_symbol TEXT,
      bin_step INTEGER,
      active_id INTEGER,
      liquidity REAL,
      fee_rate REAL,
      last_updated INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meteora_pools_mints ON meteora_pools(token_x_mint, token_y_mint);

    -- Pump.fun tokens
    CREATE TABLE IF NOT EXISTS pump_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL UNIQUE,
      name TEXT,
      symbol TEXT,
      creator TEXT,
      bonding_curve TEXT,
      market_cap REAL,
      virtual_sol_reserves REAL,
      virtual_token_reserves REAL,
      total_supply TEXT,
      holder_count INTEGER,
      is_graduated INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pump_tokens_symbol ON pump_tokens(symbol);
    CREATE INDEX IF NOT EXISTS idx_pump_tokens_market_cap ON pump_tokens(market_cap);

    -- Drift trades (perpetuals)
    CREATE TABLE IF NOT EXISTS drift_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      tx_sig TEXT NOT NULL,
      market_index INTEGER NOT NULL,
      market_type TEXT NOT NULL,
      order_id INTEGER,
      direction TEXT NOT NULL,
      base_asset_amount TEXT NOT NULL,
      quote_asset_amount TEXT,
      price TEXT,
      fee TEXT,
      pnl TEXT,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_drift_trades_user ON drift_trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_drift_trades_market ON drift_trades(market_index);
    CREATE INDEX IF NOT EXISTS idx_drift_trades_timestamp ON drift_trades(timestamp);

    -- Drift positions
    CREATE TABLE IF NOT EXISTS drift_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      market_index INTEGER NOT NULL,
      market_type TEXT NOT NULL,
      base_asset_amount TEXT NOT NULL,
      quote_asset_amount TEXT,
      entry_price TEXT,
      unrealized_pnl TEXT,
      liquidation_price TEXT,
      leverage REAL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, market_index, market_type),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_drift_positions_user ON drift_positions(user_id);

    -- EVM swap trades table (Uniswap, Sushiswap, 1inch, etc.)
    CREATE TABLE IF NOT EXISTS evm_swap_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      dex TEXT NOT NULL,
      token_in TEXT NOT NULL,
      token_out TEXT NOT NULL,
      amount_in REAL NOT NULL,
      amount_out REAL NOT NULL,
      token_in_symbol TEXT,
      token_out_symbol TEXT,
      price_impact REAL,
      slippage REAL,
      gas_used REAL,
      gas_price REAL,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_evm_swap_trades_user ON evm_swap_trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_evm_swap_trades_chain ON evm_swap_trades(chain_id);
    CREATE INDEX IF NOT EXISTS idx_evm_swap_trades_dex ON evm_swap_trades(dex);
    CREATE INDEX IF NOT EXISTS idx_evm_swap_trades_timestamp ON evm_swap_trades(timestamp);

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(enabled, triggered);
    CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user ON portfolio_snapshots(user_id);
    CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_created_at ON portfolio_snapshots(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(key);
    CREATE INDEX IF NOT EXISTS idx_credentials_user ON trading_credentials(user_id);
    CREATE INDEX IF NOT EXISTS idx_credentials_user_platform ON trading_credentials(user_id, platform);
    CREATE INDEX IF NOT EXISTS idx_markets_platform_market ON markets(platform, market_id);
    CREATE INDEX IF NOT EXISTS idx_users_platform_userid ON users(platform, platform_user_id);
    CREATE INDEX IF NOT EXISTS idx_watched_wallets_user ON watched_wallets(user_id);
    CREATE INDEX IF NOT EXISTS idx_paper_positions_user ON paper_positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_paper_trades_user ON paper_trades(user_id);
  `);

    // Backfill new columns on existing databases
    try {
      db.run('ALTER TABLE market_index ADD COLUMN content_hash TEXT');
    } catch {
      // Column already exists or table missing; ignore.
    }
    // Silently add columns if missing - errors mean column already exists
    try { db.run('ALTER TABLE market_index ADD COLUMN volume_24h REAL'); } catch { /* Column exists */ }
    try { db.run('ALTER TABLE market_index ADD COLUMN liquidity REAL'); } catch { /* Column exists */ }
    try { db.run('ALTER TABLE market_index ADD COLUMN open_interest REAL'); } catch { /* Column exists */ }
    try { db.run('ALTER TABLE market_index ADD COLUMN predictions INTEGER'); } catch { /* Column exists */ }

    // Ensure embeddings table exists for older DBs
    db.run(`
      CREATE TABLE IF NOT EXISTS market_index_embeddings (
        platform TEXT NOT NULL,
        market_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        vector TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (platform, market_id)
      );
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_market_index_embeddings_hash ON market_index_embeddings(content_hash)');

    // Save after schema creation
    saveDb();

  function saveDb() {
    if (!sqlJsDb) return;
    const data = sqlJsDb.export();
    const buffer = Buffer.from(data);
    writeFileSync(DB_FILE, buffer);
  }

  function getBackupConfig(): { enabled: boolean; intervalMs: number; maxFiles: number } {
    const intervalMinutes = Number.parseInt(process.env.CLODDS_DB_BACKUP_INTERVAL_MINUTES || '60', 10);
    const maxFiles = Number.parseInt(process.env.CLODDS_DB_BACKUP_MAX || '10', 10);
    const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
    return {
      enabled: intervalMinutes > 0 && maxFiles > 0,
      intervalMs,
      maxFiles,
    };
  }

  function ensureBackupDir(): void {
    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true });
    }
  }

  function listBackupFiles(): Array<{ name: string; path: string; mtimeMs: number }> {
    if (!existsSync(BACKUP_DIR)) return [];
    return readdirSync(BACKUP_DIR)
      .filter((name) => name.endsWith('.db'))
      .map((name) => {
        const path = join(BACKUP_DIR, name);
        const stats = statSync(path);
        return { name, path, mtimeMs: stats.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  function pruneBackups(maxFiles: number): void {
    const files = listBackupFiles();
    if (files.length <= maxFiles) return;
    const toDelete = files.slice(maxFiles);
    for (const file of toDelete) {
      try {
        unlinkSync(file.path);
      } catch (error) {
        logger.warn({ error, file: file.name }, 'Failed to delete old backup');
      }
    }
  }

  function createBackup(): void {
    if (!sqlJsDb) return;
    ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = join(BACKUP_DIR, `clodds-${timestamp}.db`);
    const data = sqlJsDb.export();
    writeFileSync(filePath, Buffer.from(data));

    const { maxFiles } = getBackupConfig();
    pruneBackups(maxFiles);
  }

  // Helper to get single row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getOne<T>(sql: string, params: any[] = []): T | undefined {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        return row as T;
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  // Helper to get all rows
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getAll<T>(sql: string, params: any[] = []): T[] {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const results: T[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
      }
      return results;
    } finally {
      stmt.free();
    }
  }

  // Helper to run statement
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function run(sql: string, params: any[] = []): void {
    db.run(sql, params);
    saveDb();
  }

  // Helper to query multiple rows
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function query<T>(sql: string, params: any[] = []): T[] {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const results: T[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
      }
      return results;
    } finally {
      stmt.free();
    }
  }

  // Helper to parse row into typed object
  function parseUser(row: Record<string, unknown> | undefined): User | undefined {
    if (!row) return undefined;
    return {
      id: row.id as string,
      platform: row.platform as string,
      platformUserId: row.platform_user_id as string,
      username: row.username as string | undefined,
      settings: JSON.parse((row.settings as string) || '{}'),
      createdAt: new Date(row.created_at as number),
      lastActiveAt: new Date(row.last_active_at as number),
    };
  }

  function extractAccountIdFromSessionKey(key: string): string | undefined {
    const parts = key.split(':');
    if (parts.length < 4) return undefined;
    const platform = parts[2];
    if (platform !== 'whatsapp') return undefined;
    const candidate = parts[3];
    if (candidate === 'group' || candidate === 'dm') return undefined;
    return candidate || undefined;
  }

  function parseSession(row: Record<string, unknown> | undefined): Session | undefined {
    if (!row) return undefined;
    const context = JSON.parse((row.context as string) || '{}');
    return {
      id: row.id as string,
      key: row.key as string,
      userId: row.user_id as string,
      channel: row.channel as string,
      accountId: extractAccountIdFromSessionKey(row.key as string),
      chatId: row.chat_id as string,
      chatType: row.chat_type as 'dm' | 'group',
      context,
      history: context.conversationHistory || [],
      lastActivity: row.last_activity ? new Date(row.last_activity as number) : new Date(row.updated_at as number),
      createdAt: new Date(row.created_at as number),
      updatedAt: new Date(row.updated_at as number),
    };
  }

  function parseAlert(row: Record<string, unknown>): Alert {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      type: row.type as Alert['type'],
      name: row.name as string | undefined,
      marketId: row.market_id as string | undefined,
      platform: row.platform as Platform | undefined,
      channel: row.channel as string | undefined,
      chatId: row.chat_id as string | undefined,
      condition: JSON.parse((row.condition as string) || '{}'),
      enabled: Boolean(row.enabled),
      triggered: Boolean(row.triggered),
      createdAt: new Date(row.created_at as number),
      lastTriggeredAt: row.last_triggered_at ? new Date(row.last_triggered_at as number) : undefined,
    };
  }

  function parsePosition(row: Record<string, unknown>): Position {
    const shares = row.shares as number;
    const avgPrice = row.avg_price as number;
    const currentPrice = (row.current_price as number) || avgPrice;
    const value = shares * currentPrice;
    const pnl = shares * (currentPrice - avgPrice);
    const pnlPct = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;

    return {
      id: row.id as string,
      platform: row.platform as Platform,
      marketId: row.market_id as string,
      marketQuestion: row.market_question as string,
      outcome: row.outcome as string,
      outcomeId: row.outcome_id as string,
      side: row.side as 'YES' | 'NO',
      shares,
      avgPrice,
      currentPrice,
      pnl,
      pnlPct,
      value,
      openedAt: new Date(row.opened_at as number),
    };
  }

  function parsePortfolioSnapshot(row: Record<string, unknown>): PortfolioSnapshot {
    const byPlatformRaw = row.by_platform as string | null | undefined;
    let byPlatform: Record<string, { value: number; pnl: number }> = {};
    if (byPlatformRaw) {
      try {
        byPlatform = JSON.parse(byPlatformRaw);
      } catch {
        byPlatform = {};
      }
    }

    return {
      userId: row.user_id as string,
      totalValue: Number(row.total_value || 0),
      totalPnl: Number(row.total_pnl || 0),
      totalPnlPct: Number(row.total_pnl_pct || 0),
      totalCostBasis: Number(row.total_cost_basis || 0),
      positionsCount: Number(row.positions_count || 0),
      byPlatform,
      createdAt: new Date(row.created_at as number),
    };
  }

  function parseTradingCredentials(row: Record<string, unknown> | undefined): TradingCredentials | null {
    if (!row) return null;
    return {
      userId: row.user_id as string,
      platform: row.platform as Platform,
      mode: row.mode as TradingCredentials['mode'],
      encryptedData: row.encrypted_data as string,
      enabled: Boolean(row.enabled),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at as number) : undefined,
      failedAttempts: row.failed_attempts as number,
      cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until as number) : undefined,
      createdAt: new Date(row.created_at as number),
      updatedAt: new Date(row.updated_at as number),
    };
  }

    const instance: Database = {
      close() {
        saveDb();
        db.close();
        sqlJsDb = null;
        dbInstance = null;
        dbInitPromise = null;
      if (backupInterval) {
        clearInterval(backupInterval);
        backupInterval = null;
      }
    },

    save() {
      saveDb();
    },

    backupNow() {
      createBackup();
    },

    getVersion(): number {
      try {
        const row = getOne<{ version: number }>(
          'SELECT version FROM _schema_version ORDER BY version DESC LIMIT 1'
        );
        return row?.version ?? 0;
      } catch {
        return 0;
      }
    },

    setVersion(version: number): void {
      run('CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL, applied_at INTEGER NOT NULL)');
      run('INSERT INTO _schema_version (version, applied_at) VALUES (?, ?)', [version, Date.now()]);
    },

    // Users
    getUserByPlatformId(platform: string, platformUserId: string): User | undefined {
      return parseUser(
        getOne(
          'SELECT id, platform, platform_user_id, username, settings, created_at, last_active_at FROM users WHERE platform = ? AND platform_user_id = ?',
          [platform, platformUserId]
        )
      );
    },

    getUser(userId: string): User | undefined {
      return parseUser(
        getOne(
          'SELECT id, platform, platform_user_id, username, settings, created_at, last_active_at FROM users WHERE id = ?',
          [userId]
        )
      );
    },

    listUsers(): User[] {
      return getAll<Record<string, unknown>>(
        'SELECT id, platform, platform_user_id, username, settings, created_at, last_active_at FROM users'
      )
        .map(parseUser)
        .filter((user): user is User => Boolean(user));
    },

    createUser(user: User): void {
      run(
        'INSERT INTO users (id, platform, platform_user_id, username, settings, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          user.id,
          user.platform,
          user.platformUserId,
          user.username ?? null,
          JSON.stringify(user.settings),
          user.createdAt.getTime(),
          user.lastActiveAt.getTime(),
        ]
      );
    },

    updateUserActivity(userId: string): void {
      run('UPDATE users SET last_active_at = ? WHERE id = ?', [Date.now(), userId]);
    },

    updateUserSettings(userId: string, settings: Partial<User['settings']>): boolean {
      const user = instance.getUser(userId);
      if (!user) return false;
      const next = { ...user.settings, ...settings };
      run('UPDATE users SET settings = ? WHERE id = ?', [JSON.stringify(next), userId]);
      return true;
    },

    updateUserSettingsByPlatform(platform: string, platformUserId: string, settings: Partial<User['settings']>): boolean {
      const user = instance.getUserByPlatformId(platform, platformUserId);
      if (!user) return false;
      return instance.updateUserSettings(user.id, settings);
    },

    // Sessions
    getSession(key: string): Session | undefined {
      return parseSession(
        getOne(
          'SELECT id, key, user_id, channel, chat_id, chat_type, context, created_at, updated_at FROM sessions WHERE key = ?',
          [key]
        )
      );
    },

    getLatestSessionForUser(userId: string) {
      const row = getOne<{
        channel: string;
        chat_id: string;
        chat_type: 'dm' | 'group';
        updated_at: number;
      }>(
        'SELECT channel, chat_id, chat_type, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
        [userId]
      );
      if (!row) return undefined;
      return {
        channel: row.channel,
        chatId: row.chat_id,
        chatType: row.chat_type,
        updatedAt: new Date(row.updated_at),
      };
    },

    getLatestSessionForChat(platform: string, chatId: string): Session | undefined {
      return parseSession(
        getOne(
          'SELECT id, key, user_id, channel, chat_id, chat_type, context, created_at, updated_at FROM sessions WHERE channel = ? AND chat_id = ? ORDER BY updated_at DESC LIMIT 1',
          [platform, chatId]
        )
      );
    },

    createSession(session: Session): void {
      run(
        'INSERT INTO sessions (id, key, user_id, channel, chat_id, chat_type, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          session.id,
          session.key,
          session.userId,
          session.channel,
          session.chatId,
          session.chatType,
          JSON.stringify(session.context),
          session.createdAt.getTime(),
          session.updatedAt.getTime(),
        ]
      );
    },

    updateSession(session: Session): void {
      run('UPDATE sessions SET context = ?, updated_at = ? WHERE key = ?', [
        JSON.stringify(session.context),
        session.updatedAt.getTime(),
        session.key,
      ]);
    },

    deleteSession(key: string): void {
      run('DELETE FROM sessions WHERE key = ?', [key]);
    },

    deleteSessionsBefore(cutoffMs: number): number {
      const rows = getAll<{ key: string }>('SELECT key FROM sessions WHERE updated_at < ?', [cutoffMs]);
      if (rows.length === 0) return 0;
      run('DELETE FROM sessions WHERE updated_at < ?', [cutoffMs]);
      return rows.length;
    },

    // Cron jobs
    listCronJobs() {
      return getAll<Record<string, unknown>>(
        'SELECT id, data, enabled, created_at, updated_at FROM cron_jobs ORDER BY created_at ASC'
      ).map((row) => ({
        id: row.id as string,
        data: row.data as string,
        enabled: Boolean(row.enabled),
        createdAtMs: row.created_at as number,
        updatedAtMs: row.updated_at as number,
      }));
    },

    getCronJob(id: string) {
      const row = getOne<Record<string, unknown>>(
        'SELECT id, data, enabled, created_at, updated_at FROM cron_jobs WHERE id = ?',
        [id]
      );
      if (!row) return undefined;
      return {
        id: row.id as string,
        data: row.data as string,
        enabled: Boolean(row.enabled),
        createdAtMs: row.created_at as number,
        updatedAtMs: row.updated_at as number,
      };
    },

    upsertCronJob(record) {
      const existing = record.createdAtMs ? null : this.getCronJob(record.id);
      const createdAtMs = record.createdAtMs ?? existing?.createdAtMs ?? Date.now();
      const updatedAtMs = record.updatedAtMs ?? Date.now();
      run(
        `INSERT INTO cron_jobs (id, data, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           data = excluded.data,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
        [record.id, record.data, record.enabled ? 1 : 0, createdAtMs, updatedAtMs]
      );
    },

    deleteCronJob(id: string): void {
      run('DELETE FROM cron_jobs WHERE id = ?', [id]);
    },

    // Alerts
    getAlerts(userId: string): Alert[] {
      return getAll<Record<string, unknown>>(
        'SELECT id, user_id, type, name, market_id, platform, channel, chat_id, condition, enabled, triggered, trigger_count, created_at, last_triggered_at FROM alerts WHERE user_id = ?',
        [userId]
      ).map(parseAlert);
    },

    getActiveAlerts(): Alert[] {
      return getAll<Record<string, unknown>>(
        'SELECT id, user_id, type, name, market_id, platform, channel, chat_id, condition, enabled, triggered, trigger_count, created_at, last_triggered_at FROM alerts WHERE enabled = 1 AND triggered = 0'
      ).map(parseAlert);
    },

    createAlert(alert: Alert): void {
      run(
        'INSERT INTO alerts (id, user_id, type, name, market_id, platform, channel, chat_id, condition, enabled, triggered, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          alert.id,
          alert.userId,
          alert.type,
          alert.name || null,
          alert.marketId || null,
          alert.platform || null,
          alert.channel || null,
          alert.chatId || null,
          JSON.stringify(alert.condition),
          alert.enabled ? 1 : 0,
          alert.triggered ? 1 : 0,
          alert.createdAt.getTime(),
        ]
      );
    },

    updateAlert(alert: Alert): void {
      run('UPDATE alerts SET name = ?, condition = ?, enabled = ?, channel = ?, chat_id = ? WHERE id = ?', [
        alert.name || null,
        JSON.stringify(alert.condition),
        alert.enabled ? 1 : 0,
        alert.channel || null,
        alert.chatId || null,
        alert.id,
      ]);
    },

    deleteAlert(alertId: string): void {
      run('DELETE FROM alerts WHERE id = ?', [alertId]);
    },

    triggerAlert(alertId: string): void {
      run('UPDATE alerts SET triggered = 1, trigger_count = trigger_count + 1, last_triggered_at = ? WHERE id = ?', [
        Date.now(),
        alertId,
      ]);
    },

    // Positions
    getPositions(userId: string): Position[] {
      return getAll<Record<string, unknown>>(
        'SELECT id, user_id, platform, market_id, market_question, outcome, outcome_id, side, shares, avg_price, current_price, opened_at, updated_at FROM positions WHERE user_id = ?',
        [userId]
      ).map(parsePosition);
    },

    listPositionsForPricing() {
      return getAll<Record<string, unknown>>(
        'SELECT id, user_id, platform, market_id, outcome_id, outcome FROM positions'
      ).map((row) => ({
        id: row.id as string,
        userId: row.user_id as string,
        platform: row.platform as Platform,
        marketId: row.market_id as string,
        outcomeId: row.outcome_id as string,
        outcome: row.outcome as string,
      }));
    },

    updatePositionPrice(positionId: string, currentPrice: number): void {
      run(
        'UPDATE positions SET current_price = ?, updated_at = ? WHERE id = ?',
        [currentPrice, Date.now(), positionId]
      );
    },

    upsertPosition(userId: string, position: Position): void {
      run(
        `INSERT INTO positions (id, user_id, platform, market_id, market_question, outcome, outcome_id, side, shares, avg_price, current_price, opened_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, platform, market_id, outcome_id) DO UPDATE SET
           shares = excluded.shares,
           avg_price = excluded.avg_price,
           current_price = excluded.current_price,
           updated_at = excluded.updated_at`,
        [
          position.id,
          userId,
          position.platform,
          position.marketId,
          position.marketQuestion,
          position.outcome,
          position.outcomeId,
          position.side,
          position.shares,
          position.avgPrice,
          position.currentPrice,
          position.openedAt.getTime(),
          Date.now(),
        ]
      );
    },

    deletePosition(positionId: string): void {
      run('DELETE FROM positions WHERE id = ?', [positionId]);
    },

    // Portfolio snapshots
    createPortfolioSnapshot(snapshot): void {
      const createdAt = snapshot.createdAt?.getTime() ?? Date.now();
      run(
        `INSERT INTO portfolio_snapshots (user_id, total_value, total_pnl, total_pnl_pct, total_cost_basis, positions_count, by_platform, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.userId,
          snapshot.totalValue,
          snapshot.totalPnl,
          snapshot.totalPnlPct,
          snapshot.totalCostBasis,
          snapshot.positionsCount,
          snapshot.byPlatform ? JSON.stringify(snapshot.byPlatform) : null,
          createdAt,
        ]
      );
    },

    getPortfolioSnapshots(userId: string, options = {}): PortfolioSnapshot[] {
      const sinceMs = options.sinceMs ?? 0;
      const limit = options.limit ?? 200;
      const order = options.order === 'asc' ? 'ASC' : 'DESC';
      const rows = getAll<Record<string, unknown>>(
        `SELECT user_id, total_value, total_pnl, total_pnl_pct, total_cost_basis, positions_count, by_platform, created_at
         FROM portfolio_snapshots
         WHERE user_id = ? AND created_at >= ?
         ORDER BY created_at ${order}
         LIMIT ?`,
        [userId, sinceMs, limit]
      );
      return rows.map(parsePortfolioSnapshot);
    },

    deletePortfolioSnapshotsBefore(cutoffMs: number): void {
      run('DELETE FROM portfolio_snapshots WHERE created_at < ?', [cutoffMs]);
    },

    // Stop-loss triggers
    getStopLossTrigger(userId: string, platform: Platform, outcomeId: string) {
      const row = getOne<{
        user_id: string;
        platform: Platform;
        outcome_id: string;
        market_id?: string;
        status: string;
        triggered_at: number;
        last_price?: number;
        last_error?: string;
        cooldown_until?: number;
      }>(
        'SELECT user_id, platform, outcome_id, market_id, status, triggered_at, last_price, last_error, cooldown_until FROM stop_loss_triggers WHERE user_id = ? AND platform = ? AND outcome_id = ?',
        [userId, platform, outcomeId]
      );
      if (!row) return undefined;
      return {
        userId: row.user_id,
        platform: row.platform,
        outcomeId: row.outcome_id,
        marketId: row.market_id,
        status: row.status,
        triggeredAt: new Date(row.triggered_at),
        lastPrice: row.last_price ?? undefined,
        lastError: row.last_error ?? undefined,
        cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until) : undefined,
      };
    },

    upsertStopLossTrigger(record: {
      userId: string;
      platform: Platform;
      outcomeId: string;
      marketId?: string;
      status: string;
      triggeredAt: Date;
      lastPrice?: number;
      lastError?: string;
      cooldownUntil?: Date;
    }): void {
      run(
        `
        INSERT INTO stop_loss_triggers (user_id, platform, outcome_id, market_id, status, triggered_at, last_price, last_error, cooldown_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, platform, outcome_id) DO UPDATE SET
          market_id = excluded.market_id,
          status = excluded.status,
          triggered_at = excluded.triggered_at,
          last_price = excluded.last_price,
          last_error = excluded.last_error,
          cooldown_until = excluded.cooldown_until
        `,
        [
          record.userId,
          record.platform,
          record.outcomeId,
          record.marketId ?? null,
          record.status,
          record.triggeredAt.getTime(),
          record.lastPrice ?? null,
          record.lastError ?? null,
          record.cooldownUntil ? record.cooldownUntil.getTime() : null,
        ]
      );
    },

    deleteStopLossTrigger(userId: string, platform: Platform, outcomeId: string): void {
      run('DELETE FROM stop_loss_triggers WHERE user_id = ? AND platform = ? AND outcome_id = ?', [
        userId,
        platform,
        outcomeId,
      ]);
    },

    // Markets cache
    cacheMarket(market: Market): void {
      run('INSERT OR REPLACE INTO markets (platform, market_id, data, updated_at) VALUES (?, ?, ?, ?)', [
        market.platform,
        market.id,
        JSON.stringify(market),
        Date.now(),
      ]);
    },

    getCachedMarket(platform: string, marketId: string, maxAgeMs?: number): Market | undefined {
      const row = getOne<{ data: string; updated_at: number }>(
        'SELECT data, updated_at FROM markets WHERE platform = ? AND market_id = ?',
        [platform, marketId]
      );
      if (!row) return undefined;
      if (maxAgeMs && row.updated_at < Date.now() - maxAgeMs) {
        run('DELETE FROM markets WHERE platform = ? AND market_id = ?', [platform, marketId]);
        return undefined;
      }
      return JSON.parse(row.data);
    },

    pruneMarketCache(cutoffMs: number): number {
      const rows = getAll<{ count: number }>(
        'SELECT COUNT(*) as count FROM markets WHERE updated_at < ?',
        [cutoffMs]
      );
      const count = rows[0]?.count ?? 0;
      if (count > 0) {
        run('DELETE FROM markets WHERE updated_at < ?', [cutoffMs]);
      }
      return count;
    },

    // Market index
    upsertMarketIndex(entry: MarketIndexEntry): void {
      run(
        `INSERT OR REPLACE INTO market_index (
          platform, market_id, slug, question, description, outcomes_json, tags_json,
          status, url, end_date, resolved, volume_24h, liquidity, open_interest, predictions,
          content_hash, updated_at, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.platform,
          entry.marketId,
          entry.slug || null,
          entry.question,
          entry.description || null,
          entry.outcomesJson || null,
          entry.tagsJson || null,
          entry.status || null,
          entry.url || null,
          entry.endDate ? entry.endDate.getTime() : null,
          entry.resolved ? 1 : 0,
          entry.volume24h ?? null,
          entry.liquidity ?? null,
          entry.openInterest ?? null,
          entry.predictions ?? null,
          entry.contentHash || null,
          entry.updatedAt.getTime(),
          entry.rawJson || null,
        ]
      );
    },

    getMarketIndexHash(platform: Platform, marketId: string): string | null {
      const row = getOne<{ content_hash: string | null }>(
        'SELECT content_hash FROM market_index WHERE platform = ? AND market_id = ?',
        [platform, marketId]
      );
      return row?.content_hash ?? null;
    },

    getMarketIndexEmbedding(platform: Platform, marketId: string): { contentHash: string; vector: number[] } | null {
      const row = getOne<{ content_hash: string; vector: string }>(
        'SELECT content_hash, vector FROM market_index_embeddings WHERE platform = ? AND market_id = ?',
        [platform, marketId]
      );
      if (!row) return null;
      try {
        const vector = JSON.parse(row.vector) as number[];
        return { contentHash: row.content_hash, vector };
      } catch {
        return null;
      }
    },

    upsertMarketIndexEmbedding(
      platform: Platform,
      marketId: string,
      contentHash: string,
      vector: number[]
    ): void {
      run(
        `INSERT OR REPLACE INTO market_index_embeddings (
          platform, market_id, content_hash, vector, updated_at
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          platform,
          marketId,
          contentHash,
          JSON.stringify(vector),
          Date.now(),
        ]
      );
    },

    listMarketIndex(options = {}): MarketIndexEntry[] {
      const params: unknown[] = [];
      const where: string[] = [];

      if (options.platform) {
        where.push('platform = ?');
        params.push(options.platform);
      }

      if (options.textQuery) {
        where.push('(question LIKE ? OR description LIKE ? OR tags_json LIKE ?)');
        const like = `%${options.textQuery}%`;
        params.push(like, like, like);
      }

      let sql = 'SELECT * FROM market_index';
      if (where.length > 0) {
        sql += ` WHERE ${where.join(' AND ')}`;
      }
      sql += ' ORDER BY updated_at DESC';
      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<{
        platform: Platform;
        market_id: string;
        slug: string | null;
        question: string;
        description: string | null;
        outcomes_json: string | null;
        tags_json: string | null;
        status: string | null;
        url: string | null;
        end_date: number | null;
        resolved: number | null;
        volume_24h: number | null;
        liquidity: number | null;
        open_interest: number | null;
        predictions: number | null;
        content_hash: string | null;
        updated_at: number;
        raw_json: string | null;
      }>(sql, params as Array<string | number>);

      return rows.map((row) => ({
        platform: row.platform,
        marketId: row.market_id,
        slug: row.slug ?? undefined,
        question: row.question,
        description: row.description ?? undefined,
        outcomesJson: row.outcomes_json ?? undefined,
        tagsJson: row.tags_json ?? undefined,
        status: row.status ?? undefined,
        url: row.url ?? undefined,
        endDate: row.end_date ? new Date(row.end_date) : undefined,
        resolved: Boolean(row.resolved),
        volume24h: row.volume_24h ?? undefined,
        liquidity: row.liquidity ?? undefined,
        openInterest: row.open_interest ?? undefined,
        predictions: row.predictions ?? undefined,
        contentHash: row.content_hash ?? undefined,
        updatedAt: new Date(row.updated_at),
        rawJson: row.raw_json ?? undefined,
      }));
    },

    countMarketIndex(platform?: Platform): number {
      if (platform) {
        const rows = getAll<{ count: number }>(
          'SELECT COUNT(*) as count FROM market_index WHERE platform = ?',
          [platform]
        );
        return rows[0]?.count ?? 0;
      }
      const rows = getAll<{ count: number }>('SELECT COUNT(*) as count FROM market_index');
      return rows[0]?.count ?? 0;
    },

    pruneMarketIndex(cutoffMs: number, platform?: Platform): number {
      if (platform) {
        const rows = getAll<{ count: number }>(
          'SELECT COUNT(*) as count FROM market_index WHERE platform = ? AND updated_at < ?',
          [platform, cutoffMs]
        );
        const count = rows[0]?.count ?? 0;
        if (count > 0) {
          run('DELETE FROM market_index WHERE platform = ? AND updated_at < ?', [platform, cutoffMs]);
          run('DELETE FROM market_index_embeddings WHERE platform = ? AND updated_at < ?', [platform, cutoffMs]);
        }
        return count;
      }
      const rows = getAll<{ count: number }>(
        'SELECT COUNT(*) as count FROM market_index WHERE updated_at < ?',
        [cutoffMs]
      );
      const count = rows[0]?.count ?? 0;
      if (count > 0) {
        run('DELETE FROM market_index WHERE updated_at < ?', [cutoffMs]);
        run('DELETE FROM market_index_embeddings WHERE updated_at < ?', [cutoffMs]);
      }
      return count;
    },

    // Trading Credentials
    getTradingCredentials(userId: string, platform: Platform): TradingCredentials | null {
      return parseTradingCredentials(
        getOne(
          'SELECT user_id, platform, mode, encrypted_data, enabled, last_used_at, failed_attempts, cooldown_until, created_at, updated_at FROM trading_credentials WHERE user_id = ? AND platform = ?',
          [userId, platform]
        )
      );
    },

    createTradingCredentials(creds: TradingCredentials): void {
      run(
        'INSERT INTO trading_credentials (user_id, platform, mode, encrypted_data, enabled, last_used_at, failed_attempts, cooldown_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          creds.userId,
          creds.platform,
          creds.mode,
          creds.encryptedData,
          creds.enabled ? 1 : 0,
          creds.lastUsedAt?.getTime() || null,
          creds.failedAttempts,
          creds.cooldownUntil?.getTime() || null,
          creds.createdAt.getTime(),
          creds.updatedAt.getTime(),
        ]
      );
    },

    updateTradingCredentials(creds: TradingCredentials): void {
      run(
        'UPDATE trading_credentials SET encrypted_data = ?, enabled = ?, last_used_at = ?, failed_attempts = ?, cooldown_until = ?, updated_at = ? WHERE user_id = ? AND platform = ?',
        [
          creds.encryptedData,
          creds.enabled ? 1 : 0,
          creds.lastUsedAt?.getTime() || null,
          creds.failedAttempts,
          creds.cooldownUntil?.getTime() || null,
          creds.updatedAt.getTime(),
          creds.userId,
          creds.platform,
        ]
      );
    },

    deleteTradingCredentials(userId: string, platform: Platform): void {
      run('DELETE FROM trading_credentials WHERE user_id = ? AND platform = ?', [userId, platform]);
    },

    listUserTradingPlatforms(userId: string): Platform[] {
      const rows = getAll<{ platform: string }>(
        'SELECT platform FROM trading_credentials WHERE user_id = ? AND enabled = 1',
        [userId]
      );
      return rows.map((r) => r.platform as Platform);
    },

    // Hyperliquid trades
    logHyperliquidTrade(trade: HyperliquidTrade): void {
      run(
        `INSERT INTO hyperliquid_trades (
          user_id, trade_id, order_id, coin, side, direction, size, price,
          fee, fee_token, closed_pnl, order_type, is_maker, leverage, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trade.userId,
          trade.tradeId || null,
          trade.orderId || null,
          trade.coin,
          trade.side,
          trade.direction || null,
          trade.size,
          trade.price,
          trade.fee || 0,
          trade.feeToken || 'USDC',
          trade.closedPnl || null,
          trade.orderType || null,
          trade.isMaker ? 1 : 0,
          trade.leverage || null,
          trade.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getHyperliquidTrades(userId: string, options = {}): HyperliquidTrade[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM hyperliquid_trades WHERE user_id = ?';

      if (options.coin) {
        sql += ' AND coin = ?';
        params.push(options.coin);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        userId: row.user_id as string,
        tradeId: row.trade_id as string | undefined,
        orderId: row.order_id as string | undefined,
        coin: row.coin as string,
        side: row.side as 'BUY' | 'SELL',
        direction: row.direction as 'LONG' | 'SHORT' | undefined,
        size: row.size as number,
        price: row.price as number,
        fee: row.fee as number,
        feeToken: row.fee_token as string,
        closedPnl: row.closed_pnl as number | undefined,
        orderType: row.order_type as string | undefined,
        isMaker: Boolean(row.is_maker),
        leverage: row.leverage as number | undefined,
        timestamp: new Date(row.timestamp as number),
        createdAt: new Date(row.created_at as number),
      }));
    },

    getHyperliquidStats(userId: string, options = {}): HyperliquidStats {
      const params: (string | number)[] = [userId];
      let whereClause = 'WHERE user_id = ?';

      if (options.coin) {
        whereClause += ' AND coin = ?';
        params.push(options.coin);
      }
      if (options.since) {
        whereClause += ' AND timestamp >= ?';
        params.push(options.since);
      }

      // Get aggregate stats
      const statsRow = getOne<{
        total_trades: number;
        total_volume: number;
        total_fees: number;
        total_pnl: number;
        win_count: number;
        loss_count: number;
        avg_win: number;
        avg_loss: number;
        largest_win: number;
        largest_loss: number;
      }>(
        `SELECT
          COUNT(*) as total_trades,
          COALESCE(SUM(size * price), 0) as total_volume,
          COALESCE(SUM(fee), 0) as total_fees,
          COALESCE(SUM(closed_pnl), 0) as total_pnl,
          COALESCE(SUM(CASE WHEN closed_pnl > 0 THEN 1 ELSE 0 END), 0) as win_count,
          COALESCE(SUM(CASE WHEN closed_pnl < 0 THEN 1 ELSE 0 END), 0) as loss_count,
          COALESCE(AVG(CASE WHEN closed_pnl > 0 THEN closed_pnl END), 0) as avg_win,
          COALESCE(AVG(CASE WHEN closed_pnl < 0 THEN closed_pnl END), 0) as avg_loss,
          COALESCE(MAX(closed_pnl), 0) as largest_win,
          COALESCE(MIN(closed_pnl), 0) as largest_loss
        FROM hyperliquid_trades ${whereClause}`,
        params
      );

      // Get stats by coin
      const coinRows = getAll<{
        coin: string;
        trades: number;
        volume: number;
        pnl: number;
        fees: number;
      }>(
        `SELECT
          coin,
          COUNT(*) as trades,
          COALESCE(SUM(size * price), 0) as volume,
          COALESCE(SUM(closed_pnl), 0) as pnl,
          COALESCE(SUM(fee), 0) as fees
        FROM hyperliquid_trades ${whereClause}
        GROUP BY coin`,
        params
      );

      const byCoin: Record<string, { trades: number; volume: number; pnl: number; fees: number }> = {};
      for (const row of coinRows) {
        byCoin[row.coin] = {
          trades: row.trades,
          volume: row.volume,
          pnl: row.pnl,
          fees: row.fees,
        };
      }

      const totalWins = statsRow?.avg_win ? statsRow.avg_win * (statsRow?.win_count || 0) : 0;
      const totalLosses = statsRow?.avg_loss ? Math.abs(statsRow.avg_loss) * (statsRow?.loss_count || 0) : 0;
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

      return {
        totalTrades: statsRow?.total_trades || 0,
        totalVolume: statsRow?.total_volume || 0,
        totalFees: statsRow?.total_fees || 0,
        totalPnl: statsRow?.total_pnl || 0,
        winCount: statsRow?.win_count || 0,
        lossCount: statsRow?.loss_count || 0,
        winRate: statsRow?.total_trades ? ((statsRow?.win_count || 0) / statsRow.total_trades) * 100 : 0,
        avgWin: statsRow?.avg_win || 0,
        avgLoss: statsRow?.avg_loss || 0,
        largestWin: statsRow?.largest_win || 0,
        largestLoss: statsRow?.largest_loss || 0,
        profitFactor,
        byCoin,
      };
    },

    // Hyperliquid positions
    upsertHyperliquidPosition(userId: string, position: HyperliquidPosition): void {
      run(
        `INSERT INTO hyperliquid_positions (
          user_id, coin, side, size, entry_price, mark_price, liquidation_price,
          unrealized_pnl, realized_pnl, leverage, margin_used, opened_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, coin) WHERE closed_at IS NULL DO UPDATE SET
          size = excluded.size,
          entry_price = excluded.entry_price,
          mark_price = excluded.mark_price,
          liquidation_price = excluded.liquidation_price,
          unrealized_pnl = excluded.unrealized_pnl,
          realized_pnl = excluded.realized_pnl,
          leverage = excluded.leverage,
          margin_used = excluded.margin_used,
          updated_at = excluded.updated_at`,
        [
          userId,
          position.coin,
          position.side,
          position.size,
          position.entryPrice,
          position.markPrice || null,
          position.liquidationPrice || null,
          position.unrealizedPnl || null,
          position.realizedPnl || 0,
          position.leverage || null,
          position.marginUsed || null,
          position.openedAt.getTime(),
          Date.now(),
          Date.now(),
        ]
      );
    },

    getHyperliquidPositions(userId: string, options = {}): HyperliquidPosition[] {
      const params: (string | number | null)[] = [userId];
      let sql = 'SELECT * FROM hyperliquid_positions WHERE user_id = ?';

      if (options.coin) {
        sql += ' AND coin = ?';
        params.push(options.coin);
      }
      if (options.openOnly) {
        sql += ' AND closed_at IS NULL';
      }

      sql += ' ORDER BY opened_at DESC';

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        userId: row.user_id as string,
        coin: row.coin as string,
        side: row.side as 'LONG' | 'SHORT',
        size: row.size as number,
        entryPrice: row.entry_price as number,
        markPrice: row.mark_price as number | undefined,
        liquidationPrice: row.liquidation_price as number | undefined,
        unrealizedPnl: row.unrealized_pnl as number | undefined,
        realizedPnl: row.realized_pnl as number | undefined,
        leverage: row.leverage as number | undefined,
        marginUsed: row.margin_used as number | undefined,
        openedAt: new Date(row.opened_at as number),
        closedAt: row.closed_at ? new Date(row.closed_at as number) : undefined,
        closePrice: row.close_price as number | undefined,
        closeReason: row.close_reason as string | undefined,
        createdAt: new Date(row.created_at as number),
        updatedAt: new Date(row.updated_at as number),
      }));
    },

    closeHyperliquidPosition(userId: string, coin: string, closePrice: number, reason?: string): void {
      run(
        `UPDATE hyperliquid_positions
         SET closed_at = ?, close_price = ?, close_reason = ?, updated_at = ?
         WHERE user_id = ? AND coin = ? AND closed_at IS NULL`,
        [Date.now(), closePrice, reason || 'manual', Date.now(), userId, coin]
      );
    },

    // Hyperliquid funding
    logHyperliquidFunding(funding: HyperliquidFunding): void {
      run(
        `INSERT INTO hyperliquid_funding (
          user_id, coin, funding_rate, payment, position_size, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          funding.userId,
          funding.coin,
          funding.fundingRate,
          funding.payment,
          funding.positionSize,
          funding.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getHyperliquidFunding(userId: string, options = {}): HyperliquidFunding[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM hyperliquid_funding WHERE user_id = ?';

      if (options.coin) {
        sql += ' AND coin = ?';
        params.push(options.coin);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        userId: row.user_id as string,
        coin: row.coin as string,
        fundingRate: row.funding_rate as number,
        payment: row.payment as number,
        positionSize: row.position_size as number,
        timestamp: new Date(row.timestamp as number),
        createdAt: new Date(row.created_at as number),
      }));
    },

    getHyperliquidFundingTotal(userId: string, options = {}): number {
      const params: (string | number)[] = [userId];
      let whereClause = 'WHERE user_id = ?';

      if (options.coin) {
        whereClause += ' AND coin = ?';
        params.push(options.coin);
      }
      if (options.since) {
        whereClause += ' AND timestamp >= ?';
        params.push(options.since);
      }

      const row = getOne<{ total: number }>(
        `SELECT COALESCE(SUM(payment), 0) as total FROM hyperliquid_funding ${whereClause}`,
        params
      );
      return row?.total || 0;
    },

    // =========================================================================
    // BINANCE FUTURES
    // =========================================================================

    logBinanceFuturesTrade(trade: BinanceFuturesTrade): void {
      run(
        `INSERT INTO binance_futures_trades (
          user_id, trade_id, order_id, symbol, side, position_side, size, price,
          commission, commission_asset, realized_pnl, order_type, is_maker, leverage, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trade.userId,
          trade.tradeId || null,
          trade.orderId || null,
          trade.symbol,
          trade.side,
          trade.positionSide || null,
          trade.size,
          trade.price,
          trade.commission || 0,
          trade.commissionAsset || 'USDT',
          trade.realizedPnl || null,
          trade.orderType || null,
          trade.isMaker ? 1 : 0,
          trade.leverage || null,
          trade.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getBinanceFuturesTrades(userId: string, options = {}): BinanceFuturesTrade[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM binance_futures_trades WHERE user_id = ?';

      if (options.symbol) {
        sql += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        userId: row.user_id as string,
        tradeId: row.trade_id as string | undefined,
        orderId: row.order_id as string | undefined,
        symbol: row.symbol as string,
        side: row.side as 'BUY' | 'SELL',
        positionSide: row.position_side as 'LONG' | 'SHORT' | 'BOTH' | undefined,
        size: row.size as number,
        price: row.price as number,
        commission: row.commission as number | undefined,
        commissionAsset: row.commission_asset as string | undefined,
        realizedPnl: row.realized_pnl as number | undefined,
        orderType: row.order_type as string | undefined,
        isMaker: row.is_maker === 1,
        leverage: row.leverage as number | undefined,
        timestamp: new Date(row.timestamp as number),
        createdAt: row.created_at ? new Date(row.created_at as number) : undefined,
      }));
    },

    getBinanceFuturesStats(userId: string, options = {}): BinanceFuturesStats {
      const params: (string | number)[] = [userId];
      let whereClause = 'WHERE user_id = ?';

      if (options.symbol) {
        whereClause += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.since) {
        whereClause += ' AND timestamp >= ?';
        params.push(options.since);
      }

      const statsRow = getOne<Record<string, number>>(
        `SELECT
          COUNT(*) as total_trades,
          COALESCE(SUM(size * price), 0) as total_volume,
          COALESCE(SUM(commission), 0) as total_fees,
          COALESCE(SUM(realized_pnl), 0) as total_pnl,
          COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) as win_count,
          COUNT(CASE WHEN realized_pnl < 0 THEN 1 END) as loss_count,
          COALESCE(AVG(CASE WHEN realized_pnl > 0 THEN realized_pnl END), 0) as avg_win,
          COALESCE(AVG(CASE WHEN realized_pnl < 0 THEN realized_pnl END), 0) as avg_loss,
          COALESCE(MAX(realized_pnl), 0) as largest_win,
          COALESCE(MIN(realized_pnl), 0) as largest_loss
        FROM binance_futures_trades ${whereClause}`,
        params
      );

      const bySymbolRows = getAll<{ symbol: string; trades: number; volume: number; pnl: number; fees: number }>(
        `SELECT
          symbol,
          COUNT(*) as trades,
          COALESCE(SUM(size * price), 0) as volume,
          COALESCE(SUM(realized_pnl), 0) as pnl,
          COALESCE(SUM(commission), 0) as fees
        FROM binance_futures_trades ${whereClause}
        GROUP BY symbol`,
        params
      );

      const totalTrades = statsRow?.total_trades || 0;
      const winCount = statsRow?.win_count || 0;
      const lossCount = statsRow?.loss_count || 0;
      const totalWins = statsRow?.avg_win ? statsRow.avg_win * winCount : 0;
      const totalLosses = statsRow?.avg_loss ? Math.abs(statsRow.avg_loss) * lossCount : 0;

      return {
        totalTrades,
        totalVolume: statsRow?.total_volume || 0,
        totalFees: statsRow?.total_fees || 0,
        totalPnl: statsRow?.total_pnl || 0,
        winCount,
        lossCount,
        winRate: totalTrades > 0 ? (winCount / totalTrades) * 100 : 0,
        avgWin: statsRow?.avg_win || 0,
        avgLoss: statsRow?.avg_loss || 0,
        largestWin: statsRow?.largest_win || 0,
        largestLoss: statsRow?.largest_loss || 0,
        profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
        bySymbol: Object.fromEntries(bySymbolRows.map((r) => [r.symbol, { trades: r.trades, volume: r.volume, pnl: r.pnl, fees: r.fees }])),
      };
    },

    upsertBinanceFuturesPosition(userId: string, position: BinanceFuturesPosition): void {
      run(
        `INSERT INTO binance_futures_positions (
          user_id, symbol, position_side, size, entry_price, mark_price, liquidation_price,
          unrealized_pnl, realized_pnl, leverage, margin_type, isolated_margin, opened_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, symbol) WHERE closed_at IS NULL DO UPDATE SET
          size = excluded.size,
          entry_price = excluded.entry_price,
          mark_price = excluded.mark_price,
          liquidation_price = excluded.liquidation_price,
          unrealized_pnl = excluded.unrealized_pnl,
          realized_pnl = excluded.realized_pnl,
          leverage = excluded.leverage,
          margin_type = excluded.margin_type,
          isolated_margin = excluded.isolated_margin,
          updated_at = excluded.updated_at`,
        [
          userId,
          position.symbol,
          position.positionSide,
          position.size,
          position.entryPrice,
          position.markPrice || null,
          position.liquidationPrice || null,
          position.unrealizedPnl || null,
          position.realizedPnl || 0,
          position.leverage || null,
          position.marginType || null,
          position.isolatedMargin || null,
          position.openedAt.getTime(),
          Date.now(),
          Date.now(),
        ]
      );
    },

    getBinanceFuturesPositions(userId: string, options = {}): BinanceFuturesPosition[] {
      const params: (string | number | null)[] = [userId];
      let sql = 'SELECT * FROM binance_futures_positions WHERE user_id = ?';

      if (options.symbol) {
        sql += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.openOnly) {
        sql += ' AND closed_at IS NULL';
      }

      sql += ' ORDER BY opened_at DESC';

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        userId: row.user_id as string,
        symbol: row.symbol as string,
        positionSide: row.position_side as 'LONG' | 'SHORT' | 'BOTH',
        size: row.size as number,
        entryPrice: row.entry_price as number,
        markPrice: row.mark_price as number | undefined,
        liquidationPrice: row.liquidation_price as number | undefined,
        unrealizedPnl: row.unrealized_pnl as number | undefined,
        realizedPnl: row.realized_pnl as number | undefined,
        leverage: row.leverage as number | undefined,
        marginType: row.margin_type as 'cross' | 'isolated' | undefined,
        isolatedMargin: row.isolated_margin as number | undefined,
        openedAt: new Date(row.opened_at as number),
        closedAt: row.closed_at ? new Date(row.closed_at as number) : undefined,
        closePrice: row.close_price as number | undefined,
        closeReason: row.close_reason as string | undefined,
        createdAt: row.created_at ? new Date(row.created_at as number) : undefined,
        updatedAt: row.updated_at ? new Date(row.updated_at as number) : undefined,
      }));
    },

    closeBinanceFuturesPosition(userId: string, symbol: string, closePrice: number, reason?: string): void {
      run(
        `UPDATE binance_futures_positions
         SET closed_at = ?, close_price = ?, close_reason = ?, updated_at = ?
         WHERE user_id = ? AND symbol = ? AND closed_at IS NULL`,
        [Date.now(), closePrice, reason || 'manual', Date.now(), userId, symbol]
      );
    },

    logBinanceFuturesFunding(funding: BinanceFuturesFunding): void {
      run(
        `INSERT INTO binance_futures_funding (
          user_id, symbol, funding_rate, payment, position_size, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          funding.userId,
          funding.symbol,
          funding.fundingRate,
          funding.payment,
          funding.positionSize,
          funding.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getBinanceFuturesFunding(userId: string, options = {}): BinanceFuturesFunding[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM binance_futures_funding WHERE user_id = ?';

      if (options.symbol) {
        sql += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        userId: row.user_id as string,
        symbol: row.symbol as string,
        fundingRate: row.funding_rate as number,
        payment: row.payment as number,
        positionSize: row.position_size as number,
        timestamp: new Date(row.timestamp as number),
        createdAt: row.created_at ? new Date(row.created_at as number) : undefined,
      }));
    },

    getBinanceFuturesFundingTotal(userId: string, options = {}): number {
      const params: (string | number)[] = [userId];
      let whereClause = 'WHERE user_id = ?';

      if (options.symbol) {
        whereClause += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.since) {
        whereClause += ' AND timestamp >= ?';
        params.push(options.since);
      }

      const row = getOne<{ total: number }>(
        `SELECT COALESCE(SUM(payment), 0) as total FROM binance_futures_funding ${whereClause}`,
        params
      );
      return row?.total || 0;
    },

    // =========================================================================
    // BYBIT FUTURES
    // =========================================================================

    logBybitFuturesTrade(trade: BybitFuturesTrade): void {
      run(
        `INSERT INTO bybit_futures_trades (
          user_id, trade_id, order_id, symbol, side, position_side, size, price,
          commission, commission_asset, closed_pnl, order_type, is_maker, leverage, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trade.userId,
          trade.tradeId || null,
          trade.orderId || null,
          trade.symbol,
          trade.side,
          trade.positionSide || null,
          trade.size,
          trade.price,
          trade.commission || 0,
          trade.commissionAsset || 'USDT',
          trade.closedPnl || null,
          trade.orderType || null,
          trade.isMaker ? 1 : 0,
          trade.leverage || null,
          trade.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getBybitFuturesTrades(userId: string, options = {}): BybitFuturesTrade[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM bybit_futures_trades WHERE user_id = ?';

      if (options.symbol) {
        sql += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        userId: row.user_id as string,
        tradeId: row.trade_id as string | undefined,
        orderId: row.order_id as string | undefined,
        symbol: row.symbol as string,
        side: row.side as 'Buy' | 'Sell',
        positionSide: row.position_side as 'Long' | 'Short' | undefined,
        size: row.size as number,
        price: row.price as number,
        commission: row.commission as number | undefined,
        commissionAsset: row.commission_asset as string | undefined,
        closedPnl: row.closed_pnl as number | undefined,
        orderType: row.order_type as string | undefined,
        isMaker: row.is_maker === 1,
        leverage: row.leverage as number | undefined,
        timestamp: new Date(row.timestamp as number),
        createdAt: row.created_at ? new Date(row.created_at as number) : undefined,
      }));
    },

    getBybitFuturesStats(userId: string, options = {}): BybitFuturesStats {
      const params: (string | number)[] = [userId];
      let whereClause = 'WHERE user_id = ?';

      if (options.symbol) {
        whereClause += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.since) {
        whereClause += ' AND timestamp >= ?';
        params.push(options.since);
      }

      const statsRow = getOne<Record<string, number>>(
        `SELECT
          COUNT(*) as total_trades,
          COALESCE(SUM(size * price), 0) as total_volume,
          COALESCE(SUM(commission), 0) as total_fees,
          COALESCE(SUM(closed_pnl), 0) as total_pnl,
          COUNT(CASE WHEN closed_pnl > 0 THEN 1 END) as win_count,
          COUNT(CASE WHEN closed_pnl < 0 THEN 1 END) as loss_count,
          COALESCE(AVG(CASE WHEN closed_pnl > 0 THEN closed_pnl END), 0) as avg_win,
          COALESCE(AVG(CASE WHEN closed_pnl < 0 THEN closed_pnl END), 0) as avg_loss,
          COALESCE(MAX(closed_pnl), 0) as largest_win,
          COALESCE(MIN(closed_pnl), 0) as largest_loss
        FROM bybit_futures_trades ${whereClause}`,
        params
      );

      const bySymbolRows = getAll<{ symbol: string; trades: number; volume: number; pnl: number; fees: number }>(
        `SELECT
          symbol,
          COUNT(*) as trades,
          COALESCE(SUM(size * price), 0) as volume,
          COALESCE(SUM(closed_pnl), 0) as pnl,
          COALESCE(SUM(commission), 0) as fees
        FROM bybit_futures_trades ${whereClause}
        GROUP BY symbol`,
        params
      );

      const totalTrades = statsRow?.total_trades || 0;
      const winCount = statsRow?.win_count || 0;
      const lossCount = statsRow?.loss_count || 0;
      const totalWins = statsRow?.avg_win ? statsRow.avg_win * winCount : 0;
      const totalLosses = statsRow?.avg_loss ? Math.abs(statsRow.avg_loss) * lossCount : 0;

      return {
        totalTrades,
        totalVolume: statsRow?.total_volume || 0,
        totalFees: statsRow?.total_fees || 0,
        totalPnl: statsRow?.total_pnl || 0,
        winCount,
        lossCount,
        winRate: totalTrades > 0 ? (winCount / totalTrades) * 100 : 0,
        avgWin: statsRow?.avg_win || 0,
        avgLoss: statsRow?.avg_loss || 0,
        largestWin: statsRow?.largest_win || 0,
        largestLoss: statsRow?.largest_loss || 0,
        profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
        bySymbol: Object.fromEntries(bySymbolRows.map((r) => [r.symbol, { trades: r.trades, volume: r.volume, pnl: r.pnl, fees: r.fees }])),
      };
    },

    upsertBybitFuturesPosition(userId: string, position: BybitFuturesPosition): void {
      run(
        `INSERT INTO bybit_futures_positions (
          user_id, symbol, side, size, entry_price, mark_price, liquidation_price,
          unrealized_pnl, cum_realised_pnl, leverage, trade_mode, position_margin, opened_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, symbol) WHERE closed_at IS NULL DO UPDATE SET
          size = excluded.size,
          entry_price = excluded.entry_price,
          mark_price = excluded.mark_price,
          liquidation_price = excluded.liquidation_price,
          unrealized_pnl = excluded.unrealized_pnl,
          cum_realised_pnl = excluded.cum_realised_pnl,
          leverage = excluded.leverage,
          trade_mode = excluded.trade_mode,
          position_margin = excluded.position_margin,
          updated_at = excluded.updated_at`,
        [
          userId,
          position.symbol,
          position.side,
          position.size,
          position.entryPrice,
          position.markPrice || null,
          position.liquidationPrice || null,
          position.unrealizedPnl || null,
          position.cumRealisedPnl || 0,
          position.leverage || null,
          position.tradeMode || null,
          position.positionMargin || null,
          position.openedAt.getTime(),
          Date.now(),
          Date.now(),
        ]
      );
    },

    getBybitFuturesPositions(userId: string, options = {}): BybitFuturesPosition[] {
      const params: (string | number | null)[] = [userId];
      let sql = 'SELECT * FROM bybit_futures_positions WHERE user_id = ?';

      if (options.symbol) {
        sql += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.openOnly) {
        sql += ' AND closed_at IS NULL';
      }

      sql += ' ORDER BY opened_at DESC';

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        userId: row.user_id as string,
        symbol: row.symbol as string,
        side: row.side as 'Buy' | 'Sell',
        size: row.size as number,
        entryPrice: row.entry_price as number,
        markPrice: row.mark_price as number | undefined,
        liquidationPrice: row.liquidation_price as number | undefined,
        unrealizedPnl: row.unrealized_pnl as number | undefined,
        cumRealisedPnl: row.cum_realised_pnl as number | undefined,
        leverage: row.leverage as number | undefined,
        tradeMode: row.trade_mode as 'cross' | 'isolated' | undefined,
        positionMargin: row.position_margin as number | undefined,
        openedAt: new Date(row.opened_at as number),
        closedAt: row.closed_at ? new Date(row.closed_at as number) : undefined,
        closePrice: row.close_price as number | undefined,
        closeReason: row.close_reason as string | undefined,
        createdAt: row.created_at ? new Date(row.created_at as number) : undefined,
        updatedAt: row.updated_at ? new Date(row.updated_at as number) : undefined,
      }));
    },

    closeBybitFuturesPosition(userId: string, symbol: string, closePrice: number, reason?: string): void {
      run(
        `UPDATE bybit_futures_positions
         SET closed_at = ?, close_price = ?, close_reason = ?, updated_at = ?
         WHERE user_id = ? AND symbol = ? AND closed_at IS NULL`,
        [Date.now(), closePrice, reason || 'manual', Date.now(), userId, symbol]
      );
    },

    logBybitFuturesFunding(funding: BybitFuturesFunding): void {
      run(
        `INSERT INTO bybit_futures_funding (
          user_id, symbol, funding_rate, payment, position_size, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          funding.userId,
          funding.symbol,
          funding.fundingRate,
          funding.payment,
          funding.positionSize,
          funding.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getBybitFuturesFunding(userId: string, options = {}): BybitFuturesFunding[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM bybit_futures_funding WHERE user_id = ?';

      if (options.symbol) {
        sql += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        userId: row.user_id as string,
        symbol: row.symbol as string,
        fundingRate: row.funding_rate as number,
        payment: row.payment as number,
        positionSize: row.position_size as number,
        timestamp: new Date(row.timestamp as number),
        createdAt: row.created_at ? new Date(row.created_at as number) : undefined,
      }));
    },

    getBybitFuturesFundingTotal(userId: string, options = {}): number {
      const params: (string | number)[] = [userId];
      let whereClause = 'WHERE user_id = ?';

      if (options.symbol) {
        whereClause += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.since) {
        whereClause += ' AND timestamp >= ?';
        params.push(options.since);
      }

      const row = getOne<{ total: number }>(
        `SELECT COALESCE(SUM(payment), 0) as total FROM bybit_futures_funding ${whereClause}`,
        params
      );
      return row?.total || 0;
    },

    // =========================================================================
    // MEXC FUTURES
    // =========================================================================

    logMexcFuturesTrade(trade: MexcFuturesTrade): void {
      run(
        `INSERT INTO mexc_futures_trades (
          user_id, trade_id, order_id, symbol, side, vol, price,
          fee, fee_asset, realized_pnl, order_type, is_maker, leverage, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trade.userId,
          trade.tradeId || null,
          trade.orderId || null,
          trade.symbol,
          trade.side,
          trade.vol,
          trade.price,
          trade.fee || 0,
          trade.feeAsset || 'USDT',
          trade.realizedPnl || null,
          trade.orderType || null,
          trade.isMaker ? 1 : 0,
          trade.leverage || null,
          trade.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getMexcFuturesTrades(userId: string, options = {}): MexcFuturesTrade[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM mexc_futures_trades WHERE user_id = ?';

      if (options.symbol) {
        sql += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        userId: row.user_id as string,
        tradeId: row.trade_id as string | undefined,
        orderId: row.order_id as string | undefined,
        symbol: row.symbol as string,
        side: row.side as number,
        vol: row.vol as number,
        price: row.price as number,
        fee: row.fee as number | undefined,
        feeAsset: row.fee_asset as string | undefined,
        realizedPnl: row.realized_pnl as number | undefined,
        orderType: row.order_type as number | undefined,
        isMaker: row.is_maker === 1,
        leverage: row.leverage as number | undefined,
        timestamp: new Date(row.timestamp as number),
        createdAt: row.created_at ? new Date(row.created_at as number) : undefined,
      }));
    },

    getMexcFuturesStats(userId: string, options = {}): MexcFuturesStats {
      const params: (string | number)[] = [userId];
      let whereClause = 'WHERE user_id = ?';

      if (options.symbol) {
        whereClause += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.since) {
        whereClause += ' AND timestamp >= ?';
        params.push(options.since);
      }

      const statsRow = getOne<Record<string, number>>(
        `SELECT
          COUNT(*) as total_trades,
          COALESCE(SUM(vol * price), 0) as total_volume,
          COALESCE(SUM(fee), 0) as total_fees,
          COALESCE(SUM(realized_pnl), 0) as total_pnl,
          COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) as win_count,
          COUNT(CASE WHEN realized_pnl < 0 THEN 1 END) as loss_count,
          COALESCE(AVG(CASE WHEN realized_pnl > 0 THEN realized_pnl END), 0) as avg_win,
          COALESCE(AVG(CASE WHEN realized_pnl < 0 THEN realized_pnl END), 0) as avg_loss,
          COALESCE(MAX(realized_pnl), 0) as largest_win,
          COALESCE(MIN(realized_pnl), 0) as largest_loss
        FROM mexc_futures_trades ${whereClause}`,
        params
      );

      const bySymbolRows = getAll<{ symbol: string; trades: number; volume: number; pnl: number; fees: number }>(
        `SELECT
          symbol,
          COUNT(*) as trades,
          COALESCE(SUM(vol * price), 0) as volume,
          COALESCE(SUM(realized_pnl), 0) as pnl,
          COALESCE(SUM(fee), 0) as fees
        FROM mexc_futures_trades ${whereClause}
        GROUP BY symbol`,
        params
      );

      const totalTrades = statsRow?.total_trades || 0;
      const winCount = statsRow?.win_count || 0;
      const lossCount = statsRow?.loss_count || 0;
      const totalWins = statsRow?.avg_win ? statsRow.avg_win * winCount : 0;
      const totalLosses = statsRow?.avg_loss ? Math.abs(statsRow.avg_loss) * lossCount : 0;

      return {
        totalTrades,
        totalVolume: statsRow?.total_volume || 0,
        totalFees: statsRow?.total_fees || 0,
        totalPnl: statsRow?.total_pnl || 0,
        winCount,
        lossCount,
        winRate: totalTrades > 0 ? (winCount / totalTrades) * 100 : 0,
        avgWin: statsRow?.avg_win || 0,
        avgLoss: statsRow?.avg_loss || 0,
        largestWin: statsRow?.largest_win || 0,
        largestLoss: statsRow?.largest_loss || 0,
        profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
        bySymbol: Object.fromEntries(bySymbolRows.map((r) => [r.symbol, { trades: r.trades, volume: r.volume, pnl: r.pnl, fees: r.fees }])),
      };
    },

    upsertMexcFuturesPosition(userId: string, position: MexcFuturesPosition): void {
      run(
        `INSERT INTO mexc_futures_positions (
          user_id, symbol, position_type, hold_vol, open_avg_price, mark_price, liquidation_price,
          unrealized_pnl, realized_pnl, leverage, margin_mode, position_margin, opened_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, symbol) WHERE closed_at IS NULL DO UPDATE SET
          hold_vol = excluded.hold_vol,
          open_avg_price = excluded.open_avg_price,
          mark_price = excluded.mark_price,
          liquidation_price = excluded.liquidation_price,
          unrealized_pnl = excluded.unrealized_pnl,
          realized_pnl = excluded.realized_pnl,
          leverage = excluded.leverage,
          margin_mode = excluded.margin_mode,
          position_margin = excluded.position_margin,
          updated_at = excluded.updated_at`,
        [
          userId,
          position.symbol,
          position.positionType,
          position.holdVol,
          position.openAvgPrice,
          position.markPrice || null,
          position.liquidationPrice || null,
          position.unrealizedPnl || null,
          position.realizedPnl || 0,
          position.leverage || null,
          position.marginMode || null,
          position.positionMargin || null,
          position.openedAt.getTime(),
          Date.now(),
          Date.now(),
        ]
      );
    },

    getMexcFuturesPositions(userId: string, options = {}): MexcFuturesPosition[] {
      const params: (string | number | null)[] = [userId];
      let sql = 'SELECT * FROM mexc_futures_positions WHERE user_id = ?';

      if (options.symbol) {
        sql += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.openOnly) {
        sql += ' AND closed_at IS NULL';
      }

      sql += ' ORDER BY opened_at DESC';

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        userId: row.user_id as string,
        symbol: row.symbol as string,
        positionType: row.position_type as number,
        holdVol: row.hold_vol as number,
        openAvgPrice: row.open_avg_price as number,
        markPrice: row.mark_price as number | undefined,
        liquidationPrice: row.liquidation_price as number | undefined,
        unrealizedPnl: row.unrealized_pnl as number | undefined,
        realizedPnl: row.realized_pnl as number | undefined,
        leverage: row.leverage as number | undefined,
        marginMode: row.margin_mode as number | undefined,
        positionMargin: row.position_margin as number | undefined,
        openedAt: new Date(row.opened_at as number),
        closedAt: row.closed_at ? new Date(row.closed_at as number) : undefined,
        closePrice: row.close_price as number | undefined,
        closeReason: row.close_reason as string | undefined,
        createdAt: row.created_at ? new Date(row.created_at as number) : undefined,
        updatedAt: row.updated_at ? new Date(row.updated_at as number) : undefined,
      }));
    },

    closeMexcFuturesPosition(userId: string, symbol: string, closePrice: number, reason?: string): void {
      run(
        `UPDATE mexc_futures_positions
         SET closed_at = ?, close_price = ?, close_reason = ?, updated_at = ?
         WHERE user_id = ? AND symbol = ? AND closed_at IS NULL`,
        [Date.now(), closePrice, reason || 'manual', Date.now(), userId, symbol]
      );
    },

    logMexcFuturesFunding(funding: MexcFuturesFunding): void {
      run(
        `INSERT INTO mexc_futures_funding (
          user_id, symbol, funding_rate, payment, position_size, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          funding.userId,
          funding.symbol,
          funding.fundingRate,
          funding.payment,
          funding.positionSize,
          funding.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getMexcFuturesFunding(userId: string, options = {}): MexcFuturesFunding[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM mexc_futures_funding WHERE user_id = ?';

      if (options.symbol) {
        sql += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        userId: row.user_id as string,
        symbol: row.symbol as string,
        fundingRate: row.funding_rate as number,
        payment: row.payment as number,
        positionSize: row.position_size as number,
        timestamp: new Date(row.timestamp as number),
        createdAt: row.created_at ? new Date(row.created_at as number) : undefined,
      }));
    },

    getMexcFuturesFundingTotal(userId: string, options = {}): number {
      const params: (string | number)[] = [userId];
      let whereClause = 'WHERE user_id = ?';

      if (options.symbol) {
        whereClause += ' AND symbol = ?';
        params.push(options.symbol);
      }
      if (options.since) {
        whereClause += ' AND timestamp >= ?';
        params.push(options.since);
      }

      const row = getOne<{ total: number }>(
        `SELECT COALESCE(SUM(payment), 0) as total FROM mexc_futures_funding ${whereClause}`,
        params
      );
      return row?.total || 0;
    },

    // Opinion.trade trades
    logOpinionTrade(trade: OpinionTrade): void {
      run(
        `INSERT INTO opinion_trades (
          user_id, order_id, market_id, token_id, side, price, size, order_type,
          status, filled_size, avg_fill_price, fee, tx_hash, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trade.oddsUserId,
          trade.orderId,
          trade.marketId,
          trade.tokenId,
          trade.side,
          trade.price,
          trade.size,
          trade.orderType,
          trade.status || 'open',
          trade.filledSize || 0,
          trade.avgFillPrice || trade.price,
          trade.fee || 0,
          trade.txHash || null,
          trade.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getOpinionTrades(userId: string, options: { marketId?: string; limit?: number; since?: number } = {}): OpinionTrade[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM opinion_trades WHERE user_id = ?';

      if (options.marketId) {
        sql += ' AND market_id = ?';
        params.push(options.marketId);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        oddsUserId: row.user_id as string,
        orderId: row.order_id as string,
        marketId: row.market_id as string,
        tokenId: row.token_id as string,
        side: row.side as 'BUY' | 'SELL',
        price: row.price as number,
        size: row.size as number,
        orderType: row.order_type as 'LIMIT' | 'MARKET',
        status: row.status as string,
        filledSize: row.filled_size as number,
        avgFillPrice: row.avg_fill_price as number,
        fee: row.fee as number,
        txHash: row.tx_hash as string | undefined,
        timestamp: new Date(row.timestamp as number),
        createdAt: new Date(row.created_at as number),
      }));
    },

    // Predict.fun trades
    logPredictFunTrade(trade: PredictFunTrade): void {
      run(
        `INSERT INTO predictfun_trades (
          user_id, order_hash, market_id, token_id, side, price, quantity,
          status, filled_quantity, avg_fill_price, fee, tx_hash,
          is_neg_risk, is_yield_bearing, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trade.oddsUserId,
          trade.orderHash,
          trade.marketId,
          trade.tokenId,
          trade.side,
          trade.price,
          trade.quantity,
          trade.status || 'open',
          trade.filledQuantity || 0,
          trade.avgFillPrice || trade.price,
          trade.fee || 0,
          trade.txHash || null,
          trade.isNegRisk ? 1 : 0,
          trade.isYieldBearing !== false ? 1 : 0,
          trade.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getPredictFunTrades(userId: string, options: { marketId?: string; limit?: number; since?: number } = {}): PredictFunTrade[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM predictfun_trades WHERE user_id = ?';

      if (options.marketId) {
        sql += ' AND market_id = ?';
        params.push(options.marketId);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        oddsUserId: row.user_id as string,
        orderHash: row.order_hash as string,
        marketId: row.market_id as string,
        tokenId: row.token_id as string,
        side: row.side as 'BUY' | 'SELL',
        price: row.price as number,
        quantity: row.quantity as number,
        status: row.status as string,
        filledQuantity: row.filled_quantity as number,
        avgFillPrice: row.avg_fill_price as number,
        fee: row.fee as number,
        txHash: row.tx_hash as string | undefined,
        isNegRisk: row.is_neg_risk === 1,
        isYieldBearing: row.is_yield_bearing === 1,
        timestamp: new Date(row.timestamp as number),
        createdAt: new Date(row.created_at as number),
      }));
    },

    // Polymarket trades
    logPolymarketTrade(trade: PolymarketTrade): void {
      run(
        `INSERT INTO polymarket_trades (
          user_id, order_id, market_id, token_id, condition_id, side, price, size, order_type,
          status, filled_size, avg_fill_price, fee, tx_hash, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trade.oddsUserId,
          trade.orderId,
          trade.marketId,
          trade.tokenId,
          trade.conditionId || null,
          trade.side,
          trade.price,
          trade.size,
          trade.orderType,
          trade.status || 'open',
          trade.filledSize || 0,
          trade.avgFillPrice || trade.price,
          trade.fee || 0,
          trade.txHash || null,
          trade.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getPolymarketTrades(userId: string, options: { marketId?: string; limit?: number; since?: number } = {}): PolymarketTrade[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM polymarket_trades WHERE user_id = ?';

      if (options.marketId) {
        sql += ' AND market_id = ?';
        params.push(options.marketId);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        oddsUserId: row.user_id as string,
        orderId: row.order_id as string,
        marketId: row.market_id as string,
        tokenId: row.token_id as string,
        conditionId: row.condition_id as string | undefined,
        side: row.side as 'BUY' | 'SELL',
        price: row.price as number,
        size: row.size as number,
        orderType: row.order_type as 'LIMIT' | 'MARKET',
        status: row.status as string,
        filledSize: row.filled_size as number,
        avgFillPrice: row.avg_fill_price as number,
        fee: row.fee as number,
        txHash: row.tx_hash as string | undefined,
        timestamp: new Date(row.timestamp as number),
        createdAt: new Date(row.created_at as number),
      }));
    },

    // Kalshi trades
    logKalshiTrade(trade: KalshiTrade): void {
      run(
        `INSERT INTO kalshi_trades (
          user_id, order_id, market_id, ticker, side, price, count, order_type,
          status, filled_count, avg_fill_price, fee, action, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trade.oddsUserId,
          trade.orderId,
          trade.marketId,
          trade.ticker,
          trade.side,
          trade.price,
          trade.count,
          trade.orderType,
          trade.status || 'open',
          trade.filledCount || 0,
          trade.avgFillPrice || trade.price,
          trade.fee || 0,
          trade.action || null,
          trade.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getKalshiTrades(userId: string, options: { marketId?: string; ticker?: string; limit?: number; since?: number } = {}): KalshiTrade[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM kalshi_trades WHERE user_id = ?';

      if (options.marketId) {
        sql += ' AND market_id = ?';
        params.push(options.marketId);
      }
      if (options.ticker) {
        sql += ' AND ticker = ?';
        params.push(options.ticker);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        oddsUserId: row.user_id as string,
        orderId: row.order_id as string,
        marketId: row.market_id as string,
        ticker: row.ticker as string,
        side: row.side as 'yes' | 'no',
        price: row.price as number,
        count: row.count as number,
        orderType: row.order_type as 'limit' | 'market',
        status: row.status as string,
        filledCount: row.filled_count as number,
        avgFillPrice: row.avg_fill_price as number,
        fee: row.fee as number,
        action: row.action as string | undefined,
        timestamp: new Date(row.timestamp as number),
        createdAt: new Date(row.created_at as number),
      }));
    },

    // Drift trades
    logDriftTrade(trade: DriftTrade): void {
      run(
        `INSERT INTO drift_trades (
          user_id, order_id, market_index, market_type, direction, base_amount, quote_amount,
          price, order_type, status, filled_amount, avg_fill_price, leverage, tx_sig, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trade.oddsUserId,
          trade.orderId || null,
          trade.marketIndex,
          trade.marketType,
          trade.direction,
          trade.baseAmount,
          trade.quoteAmount || null,
          trade.price || null,
          trade.orderType,
          trade.status || 'open',
          trade.filledAmount || 0,
          trade.avgFillPrice || trade.price || null,
          trade.leverage || null,
          trade.txSig || null,
          trade.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getDriftTrades(userId: string, options: { marketIndex?: number; marketType?: string; limit?: number; since?: number } = {}): DriftTrade[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM drift_trades WHERE user_id = ?';

      if (options.marketIndex !== undefined) {
        sql += ' AND market_index = ?';
        params.push(options.marketIndex);
      }
      if (options.marketType) {
        sql += ' AND market_type = ?';
        params.push(options.marketType);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        oddsUserId: row.user_id as string,
        orderId: row.order_id as string | undefined,
        marketIndex: row.market_index as number,
        marketType: row.market_type as 'perp' | 'spot',
        direction: row.direction as 'long' | 'short',
        baseAmount: row.base_amount as number,
        quoteAmount: row.quote_amount as number | undefined,
        price: row.price as number | undefined,
        orderType: row.order_type as 'market' | 'limit' | 'postOnly',
        status: row.status as string,
        filledAmount: row.filled_amount as number,
        avgFillPrice: row.avg_fill_price as number | undefined,
        leverage: row.leverage as number | undefined,
        txSig: row.tx_sig as string | undefined,
        timestamp: new Date(row.timestamp as number),
        createdAt: new Date(row.created_at as number),
      }));
    },

    // Manifold trades
    logManifoldTrade(trade: ManifoldTrade): void {
      run(
        `INSERT INTO manifold_trades (
          user_id, bet_id, contract_id, outcome, amount, shares,
          probability_before, probability_after, status, fee, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trade.oddsUserId,
          trade.betId,
          trade.contractId,
          trade.outcome,
          trade.amount,
          trade.shares,
          trade.probabilityBefore || null,
          trade.probabilityAfter || null,
          trade.status || 'filled',
          trade.fee || 0,
          trade.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getManifoldTrades(userId: string, options: { contractId?: string; limit?: number; since?: number } = {}): ManifoldTrade[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM manifold_trades WHERE user_id = ?';

      if (options.contractId) {
        sql += ' AND contract_id = ?';
        params.push(options.contractId);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        oddsUserId: row.user_id as string,
        betId: row.bet_id as string,
        contractId: row.contract_id as string,
        outcome: row.outcome as string,
        amount: row.amount as number,
        shares: row.shares as number,
        probabilityBefore: row.probability_before as number | undefined,
        probabilityAfter: row.probability_after as number | undefined,
        status: row.status as string,
        fee: row.fee as number,
        timestamp: new Date(row.timestamp as number),
        createdAt: new Date(row.created_at as number),
      }));
    },

    // Solana DEX trades
    logSolanaDexTrade(trade: SolanaDexTrade): void {
      run(
        `INSERT INTO solana_dex_trades (
          user_id, tx_sig, dex, input_mint, output_mint, input_amount, output_amount,
          input_symbol, output_symbol, price_impact, slippage, fee, route, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trade.oddsUserId,
          trade.txSig,
          trade.dex,
          trade.inputMint,
          trade.outputMint,
          trade.inputAmount,
          trade.outputAmount,
          trade.inputSymbol || null,
          trade.outputSymbol || null,
          trade.priceImpact || null,
          trade.slippage || null,
          trade.fee || 0,
          trade.route || null,
          trade.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getSolanaDexTrades(userId: string, options: { dex?: string; limit?: number; since?: number } = {}): SolanaDexTrade[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM solana_dex_trades WHERE user_id = ?';

      if (options.dex) {
        sql += ' AND dex = ?';
        params.push(options.dex);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        oddsUserId: row.user_id as string,
        txSig: row.tx_sig as string,
        dex: row.dex as 'jupiter' | 'raydium' | 'orca' | 'meteora',
        inputMint: row.input_mint as string,
        outputMint: row.output_mint as string,
        inputAmount: row.input_amount as number,
        outputAmount: row.output_amount as number,
        inputSymbol: row.input_symbol as string | undefined,
        outputSymbol: row.output_symbol as string | undefined,
        priceImpact: row.price_impact as number | undefined,
        slippage: row.slippage as number | undefined,
        fee: row.fee as number,
        route: row.route as string | undefined,
        timestamp: new Date(row.timestamp as number),
        createdAt: new Date(row.created_at as number),
      }));
    },

    // EVM swap trades
    logEvmSwapTrade(trade: EvmSwapTrade): void {
      run(
        `INSERT INTO evm_swap_trades (
          user_id, tx_hash, chain_id, dex, token_in, token_out, amount_in, amount_out,
          token_in_symbol, token_out_symbol, price_impact, slippage, gas_used, gas_price, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trade.oddsUserId,
          trade.txHash,
          trade.chainId,
          trade.dex,
          trade.tokenIn,
          trade.tokenOut,
          trade.amountIn,
          trade.amountOut,
          trade.tokenInSymbol || null,
          trade.tokenOutSymbol || null,
          trade.priceImpact || null,
          trade.slippage || null,
          trade.gasUsed || null,
          trade.gasPrice || null,
          trade.timestamp.getTime(),
          Date.now(),
        ]
      );
    },

    getEvmSwapTrades(userId: string, options: { chainId?: number; dex?: string; limit?: number; since?: number } = {}): EvmSwapTrade[] {
      const params: (string | number)[] = [userId];
      let sql = 'SELECT * FROM evm_swap_trades WHERE user_id = ?';

      if (options.chainId !== undefined) {
        sql += ' AND chain_id = ?';
        params.push(options.chainId);
      }
      if (options.dex) {
        sql += ' AND dex = ?';
        params.push(options.dex);
      }
      if (options.since) {
        sql += ' AND timestamp >= ?';
        params.push(options.since);
      }

      sql += ' ORDER BY timestamp DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = getAll<Record<string, unknown>>(sql, params);
      return rows.map((row) => ({
        id: row.id as number,
        oddsUserId: row.user_id as string,
        txHash: row.tx_hash as string,
        chainId: row.chain_id as number,
        dex: row.dex as 'uniswap' | 'sushiswap' | '1inch' | 'pancakeswap' | 'other',
        tokenIn: row.token_in as string,
        tokenOut: row.token_out as string,
        amountIn: row.amount_in as number,
        amountOut: row.amount_out as number,
        tokenInSymbol: row.token_in_symbol as string | undefined,
        tokenOutSymbol: row.token_out_symbol as string | undefined,
        priceImpact: row.price_impact as number | undefined,
        slippage: row.slippage as number | undefined,
        gasUsed: row.gas_used as number | undefined,
        gasPrice: row.gas_price as number | undefined,
        timestamp: new Date(row.timestamp as number),
        createdAt: new Date(row.created_at as number),
      }));
    },

    // Jupiter swaps
    logJupiterSwap(swap: JupiterSwap): void {
      run(
        `INSERT OR REPLACE INTO jupiter_swaps (
          user_id, tx_sig, input_mint, output_mint, input_amount, output_amount,
          input_symbol, output_symbol, price_impact_pct, slippage_bps, route_plan,
          num_hops, priority_fee, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          swap.oddsUserId, swap.txSig, swap.inputMint, swap.outputMint,
          swap.inputAmount, swap.outputAmount, swap.inputSymbol || null,
          swap.outputSymbol || null, swap.priceImpactPct || null,
          swap.slippageBps || null, swap.routePlan || null, swap.numHops || null,
          swap.priorityFee || null, swap.timestamp.getTime(), Date.now(),
        ]
      );
    },

    getJupiterSwaps(userId: string, limit = 50): JupiterSwap[] {
      const rows = getAll<Record<string, unknown>>(
        'SELECT * FROM jupiter_swaps WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?',
        [userId, limit]
      );
      return rows.map((r) => ({
        id: r.id as number,
        oddsUserId: r.user_id as string,
        txSig: r.tx_sig as string,
        inputMint: r.input_mint as string,
        outputMint: r.output_mint as string,
        inputAmount: r.input_amount as string,
        outputAmount: r.output_amount as string,
        inputSymbol: r.input_symbol as string | undefined,
        outputSymbol: r.output_symbol as string | undefined,
        priceImpactPct: r.price_impact_pct as number | undefined,
        slippageBps: r.slippage_bps as number | undefined,
        routePlan: r.route_plan as string | undefined,
        numHops: r.num_hops as number | undefined,
        priorityFee: r.priority_fee as number | undefined,
        timestamp: new Date(r.timestamp as number),
        createdAt: new Date(r.created_at as number),
      }));
    },

    // Drift positions
    upsertDriftPosition(position: DriftPosition): void {
      run(
        `INSERT OR REPLACE INTO drift_positions (
          user_id, market_index, market_type, base_asset_amount, quote_asset_amount,
          entry_price, unrealized_pnl, liquidation_price, leverage, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          position.oddsUserId, position.marketIndex, position.marketType,
          position.baseAssetAmount, position.quoteAssetAmount || null,
          position.entryPrice || null, position.unrealizedPnl || null,
          position.liquidationPrice || null, position.leverage || null, Date.now(),
        ]
      );
    },

    getDriftPositions(userId: string): DriftPosition[] {
      const rows = getAll<Record<string, unknown>>(
        'SELECT * FROM drift_positions WHERE user_id = ? ORDER BY market_index',
        [userId]
      );
      return rows.map((r) => ({
        id: r.id as number,
        oddsUserId: r.user_id as string,
        marketIndex: r.market_index as number,
        marketType: r.market_type as 'perp' | 'spot',
        baseAssetAmount: r.base_asset_amount as string,
        quoteAssetAmount: r.quote_asset_amount as string | undefined,
        entryPrice: r.entry_price as string | undefined,
        unrealizedPnl: r.unrealized_pnl as string | undefined,
        liquidationPrice: r.liquidation_price as string | undefined,
        leverage: r.leverage as number | undefined,
        updatedAt: new Date(r.updated_at as number),
      }));
    },

    // Pump.fun tokens
    upsertPumpToken(token: PumpToken): void {
      run(
        `INSERT OR REPLACE INTO pump_tokens (
          mint, name, symbol, creator, bonding_curve, market_cap,
          virtual_sol_reserves, virtual_token_reserves, total_supply,
          holder_count, is_graduated, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          token.mint, token.name || null, token.symbol || null, token.creator || null,
          token.bondingCurve || null, token.marketCap || null,
          token.virtualSolReserves || null, token.virtualTokenReserves || null,
          token.totalSupply || null, token.holderCount || null,
          token.isGraduated ? 1 : 0, token.createdAt.getTime(), Date.now(),
        ]
      );
    },

    getPumpToken(mint: string): PumpToken | null {
      const row = getOne<Record<string, unknown>>(
        'SELECT * FROM pump_tokens WHERE mint = ?',
        [mint]
      );
      if (!row) return null;
      return {
        id: row.id as number,
        mint: row.mint as string,
        name: row.name as string | undefined,
        symbol: row.symbol as string | undefined,
        creator: row.creator as string | undefined,
        bondingCurve: row.bonding_curve as string | undefined,
        marketCap: row.market_cap as number | undefined,
        virtualSolReserves: row.virtual_sol_reserves as number | undefined,
        virtualTokenReserves: row.virtual_token_reserves as number | undefined,
        totalSupply: row.total_supply as string | undefined,
        holderCount: row.holder_count as number | undefined,
        isGraduated: (row.is_graduated as number) === 1,
        createdAt: new Date(row.created_at as number),
        updatedAt: new Date(row.updated_at as number),
      };
    },

    // Raw SQL access
    run,
    query,

    async withConnection<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
      return fn(dbInstance!);
    },
  };

    dbInstance = instance;

    const backupConfig = getBackupConfig();
    if (backupConfig.enabled && !backupInterval) {
      ensureBackupDir();
      backupInterval = setInterval(() => {
        try {
          createBackup();
        } catch (error) {
          logger.warn({ error }, 'Database backup failed');
        }
      }, backupConfig.intervalMs);
    }

    return instance;
  })();

  return dbInitPromise;
}

// Sync wrapper for backwards compatibility
export function createDatabase(): Database {
  // Return a proxy that initializes lazily
  let initialized = false;
  let db: Database;

  const lazyInit = async () => {
    if (!initialized) {
      db = await initDatabase();
      initialized = true;
    }
    return db;
  };

  // Start initialization immediately
  const initPromise = lazyInit();

  // Return proxy that waits for initialization
  return new Proxy({} as Database, {
    get(_target, prop) {
      if (prop === 'then') return undefined; // Not a promise
      return (...args: unknown[]) => {
        if (initialized && db) {
          return (db as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string](...args);
        }
        // If not initialized yet, wait
        return initPromise.then((d) =>
          (d as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string](...args)
        );
      };
    },
  });
}
