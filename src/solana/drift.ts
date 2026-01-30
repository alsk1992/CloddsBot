import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'eventemitter3';
import { logger } from '../utils/logger';

// =============================================================================
// ORDER TYPES
// =============================================================================

export interface DriftDirectOrderParams {
  marketType: 'perp' | 'spot';
  marketIndex: number;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  baseAmount: string;
  price?: string;
}

export interface DriftDirectOrderResult {
  orderId: string | number;
}

// =============================================================================
// LIQUIDATION MONITORING TYPES
// =============================================================================

export interface DriftPosition {
  marketIndex: number;
  marketName: string;
  baseAssetAmount: number;
  quoteAssetAmount: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  liquidationPrice: number;
  leverage: number;
  direction: 'long' | 'short';
}

export interface DriftAccountHealth {
  /** Account public key */
  accountPubkey: string;
  /** Total collateral in USD */
  totalCollateral: number;
  /** Maintenance margin requirement */
  maintenanceMargin: number;
  /** Health factor (1.0 = at liquidation, > 1.0 = safe) */
  healthFactor: number;
  /** Free collateral available */
  freeCollateral: number;
  /** Distance to liquidation as percentage */
  distanceToLiquidationPct: number;
  /** Risk level */
  riskLevel: 'safe' | 'warning' | 'danger' | 'critical';
  /** All open positions */
  positions: DriftPosition[];
  /** Timestamp of this snapshot */
  timestamp: Date;
}

export type LiquidationAlertLevel = 'warning' | 'danger' | 'critical' | 'liquidated';

export interface LiquidationAlert {
  id: string;
  accountPubkey: string;
  level: LiquidationAlertLevel;
  healthFactor: number;
  totalCollateral: number;
  maintenanceMargin: number;
  distanceToLiquidationPct: number;
  positions: DriftPosition[];
  timestamp: Date;
  message: string;
}

export interface DriftLiquidationMonitorConfig {
  /** RPC connection */
  connection: Connection;
  /** Account to monitor (public key) */
  accountPubkey: string;
  /** Polling interval in milliseconds (default: 5000) */
  pollIntervalMs?: number;
  /** Health factor threshold for warning (default: 1.5) */
  warningThreshold?: number;
  /** Health factor threshold for danger (default: 1.2) */
  dangerThreshold?: number;
  /** Health factor threshold for critical (default: 1.05) */
  criticalThreshold?: number;
  /** Callback for alerts */
  onAlert?: (alert: LiquidationAlert) => void | Promise<void>;
}

export interface DriftLiquidationMonitor extends EventEmitter {
  /** Start monitoring */
  start(): Promise<void>;
  /** Stop monitoring */
  stop(): void;
  /** Get current account health */
  getAccountHealth(): Promise<DriftAccountHealth>;
  /** Check health once (manual trigger) */
  checkHealth(): Promise<DriftAccountHealth>;
  /** Get all positions */
  getPositions(): Promise<DriftPosition[]>;
  /** Calculate liquidation price for a position */
  calculateLiquidationPrice(position: DriftPosition, collateral: number): number;
  /** Check if monitoring is active */
  isActive(): boolean;
}

export async function executeDriftDirectOrder(
  connection: Connection,
  keypair: Keypair,
  params: DriftDirectOrderParams
): Promise<DriftDirectOrderResult> {
  const driftSdk = await import('@drift-labs/sdk') as any;
  const anchor = await import('@coral-xyz/anchor');

  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const driftClient = new driftSdk.DriftClient({
    connection,
    wallet: provider.wallet,
    env: 'mainnet-beta',
  });

  await driftClient.subscribe();

  const direction = params.side === 'buy' ? driftSdk.PositionDirection.LONG : driftSdk.PositionDirection.SHORT;
  const orderType = params.orderType === 'market' ? driftSdk.OrderType.MARKET : driftSdk.OrderType.LIMIT;

  const baseAmount = new driftSdk.BN(params.baseAmount);
  const price = params.price ? new driftSdk.BN(params.price) : undefined;

  let orderId: string | number;
  if (params.marketType === 'perp') {
    const txSig = await driftClient.placePerpOrder({
      marketIndex: params.marketIndex,
      direction,
      baseAssetAmount: baseAmount,
      orderType,
      price,
    });
    orderId = txSig;
  } else {
    const txSig = await driftClient.placeSpotOrder({
      marketIndex: params.marketIndex,
      direction,
      baseAssetAmount: baseAmount,
      orderType,
      price,
    });
    orderId = txSig;
  }

  await driftClient.unsubscribe();

  return { orderId };
}

// =============================================================================
// LIQUIDATION MONITOR IMPLEMENTATION
// =============================================================================

const DEFAULT_MONITOR_CONFIG = {
  pollIntervalMs: 5000,
  warningThreshold: 1.5,
  dangerThreshold: 1.2,
  criticalThreshold: 1.05,
};

export function createDriftLiquidationMonitor(
  config: DriftLiquidationMonitorConfig
): DriftLiquidationMonitor {
  const cfg = { ...DEFAULT_MONITOR_CONFIG, ...config };
  const emitter = new EventEmitter() as DriftLiquidationMonitor;

  let isMonitoring = false;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let driftClient: any = null;
  let lastAlertLevel: LiquidationAlertLevel | null = null;

  async function initializeClient(): Promise<any> {
    if (driftClient) return driftClient;

    try {
      const driftSdk = await import('@drift-labs/sdk');
      const anchor = await import('@coral-xyz/anchor');

      // Create a read-only wallet for monitoring
      const dummyWallet = {
        publicKey: new PublicKey(cfg.accountPubkey),
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any) => txs,
      };

      const provider = new anchor.AnchorProvider(cfg.connection, dummyWallet as any, {
        commitment: 'confirmed',
      });

      driftClient = new (driftSdk as any).DriftClient({
        connection: cfg.connection,
        wallet: provider.wallet,
        env: 'mainnet-beta',
        userStats: true,
        perpMarketIndexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], // SOL, BTC, ETH, etc.
        spotMarketIndexes: [0, 1, 2, 3], // USDC, SOL, etc.
        accountSubscription: {
          type: 'polling',
          accountLoader: new (driftSdk as any).BulkAccountLoader(
            cfg.connection,
            'confirmed',
            cfg.pollIntervalMs
          ),
        },
      });

      await driftClient.subscribe();
      logger.info({ account: cfg.accountPubkey }, 'Drift client initialized for monitoring');

      return driftClient;
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Drift client');
      throw error;
    }
  }

  function getRiskLevel(healthFactor: number): DriftAccountHealth['riskLevel'] {
    if (healthFactor <= 1.0) return 'critical';
    if (healthFactor <= cfg.criticalThreshold) return 'critical';
    if (healthFactor <= cfg.dangerThreshold) return 'danger';
    if (healthFactor <= cfg.warningThreshold) return 'warning';
    return 'safe';
  }

  function getAlertLevel(healthFactor: number): LiquidationAlertLevel | null {
    if (healthFactor <= 1.0) return 'liquidated';
    if (healthFactor <= cfg.criticalThreshold) return 'critical';
    if (healthFactor <= cfg.dangerThreshold) return 'danger';
    if (healthFactor <= cfg.warningThreshold) return 'warning';
    return null;
  }

  async function getPositions(): Promise<DriftPosition[]> {
    const client = await initializeClient();
    const positions: DriftPosition[] = [];

    try {
      const user = client.getUser();
      if (!user) return positions;

      const perpPositions = user.getPerpPositions();
      const driftSdk = await import('@drift-labs/sdk');

      for (const perpPos of perpPositions) {
        if (perpPos.baseAssetAmount.isZero()) continue;

        const marketIndex = perpPos.marketIndex;
        const perpMarket = client.getPerpMarketAccount(marketIndex);
        if (!perpMarket) continue;

        const baseAmount = perpPos.baseAssetAmount.toNumber() / 1e9;
        const quoteAmount = perpPos.quoteAssetAmount.toNumber() / 1e6;
        const direction: 'long' | 'short' = baseAmount > 0 ? 'long' : 'short';

        // Get oracle price
        const oraclePrice = client.getOracleDataForPerpMarket(marketIndex);
        const currentPrice = oraclePrice?.price.toNumber() / 1e6 || 0;

        // Calculate entry price
        const entryPrice = Math.abs(quoteAmount / baseAmount);

        // Calculate unrealized PnL
        const positionValue = Math.abs(baseAmount) * currentPrice;
        const costBasis = Math.abs(quoteAmount);
        const unrealizedPnL = direction === 'long'
          ? positionValue - costBasis
          : costBasis - positionValue;

        // Calculate liquidation price (simplified)
        const maintenanceMarginRatio = 0.05; // 5% for most perps
        const collateral = user.getTotalCollateral().toNumber() / 1e6;
        const liquidationPrice = calculateLiquidationPriceForPosition(
          baseAmount,
          entryPrice,
          collateral,
          maintenanceMarginRatio,
          direction
        );

        // Calculate leverage
        const leverage = positionValue / collateral;

        positions.push({
          marketIndex,
          marketName: getMarketName(marketIndex),
          baseAssetAmount: baseAmount,
          quoteAssetAmount: quoteAmount,
          entryPrice,
          currentPrice,
          unrealizedPnL,
          liquidationPrice,
          leverage,
          direction,
        });
      }

      return positions;
    } catch (error) {
      logger.error({ error }, 'Failed to get Drift positions');
      return positions;
    }
  }

  function calculateLiquidationPriceForPosition(
    baseAmount: number,
    entryPrice: number,
    collateral: number,
    maintenanceMarginRatio: number,
    direction: 'long' | 'short'
  ): number {
    const absBase = Math.abs(baseAmount);
    if (absBase === 0) return 0;

    // For longs: liq price = entry - (collateral - maintenance) / position size
    // For shorts: liq price = entry + (collateral - maintenance) / position size
    const maintenanceMargin = absBase * entryPrice * maintenanceMarginRatio;
    const buffer = collateral - maintenanceMargin;

    if (direction === 'long') {
      return Math.max(0, entryPrice - buffer / absBase);
    } else {
      return entryPrice + buffer / absBase;
    }
  }

  function getMarketName(marketIndex: number): string {
    const markets: Record<number, string> = {
      0: 'SOL-PERP',
      1: 'BTC-PERP',
      2: 'ETH-PERP',
      3: 'APT-PERP',
      4: 'MATIC-PERP',
      5: 'ARB-PERP',
      6: 'DOGE-PERP',
      7: 'BNB-PERP',
      8: 'SUI-PERP',
      9: 'PEPE-PERP',
    };
    return markets[marketIndex] || `PERP-${marketIndex}`;
  }

  async function getAccountHealth(): Promise<DriftAccountHealth> {
    const client = await initializeClient();

    try {
      const user = client.getUser();
      if (!user) {
        throw new Error('User account not found');
      }

      const totalCollateral = user.getTotalCollateral().toNumber() / 1e6;
      const maintenanceMargin = user.getMaintenanceMarginRequirement().toNumber() / 1e6;
      const freeCollateral = user.getFreeCollateral().toNumber() / 1e6;

      // Health factor = collateral / maintenance margin
      const healthFactor = maintenanceMargin > 0 ? totalCollateral / maintenanceMargin : Infinity;

      // Distance to liquidation
      const distanceToLiquidationPct = maintenanceMargin > 0
        ? ((totalCollateral - maintenanceMargin) / maintenanceMargin) * 100
        : 100;

      const positions = await getPositions();
      const riskLevel = getRiskLevel(healthFactor);

      return {
        accountPubkey: cfg.accountPubkey,
        totalCollateral,
        maintenanceMargin,
        healthFactor,
        freeCollateral,
        distanceToLiquidationPct,
        riskLevel,
        positions,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get account health');
      throw error;
    }
  }

  async function checkHealth(): Promise<DriftAccountHealth> {
    const health = await getAccountHealth();

    const alertLevel = getAlertLevel(health.healthFactor);

    // Only alert if level changed or worsened
    if (alertLevel && (!lastAlertLevel || alertLevel !== lastAlertLevel)) {
      const alert: LiquidationAlert = {
        id: `drift_liq_${cfg.accountPubkey}_${Date.now()}`,
        accountPubkey: cfg.accountPubkey,
        level: alertLevel,
        healthFactor: health.healthFactor,
        totalCollateral: health.totalCollateral,
        maintenanceMargin: health.maintenanceMargin,
        distanceToLiquidationPct: health.distanceToLiquidationPct,
        positions: health.positions,
        timestamp: new Date(),
        message: formatAlertMessage(health, alertLevel),
      };

      logger.warn(
        {
          level: alertLevel,
          healthFactor: health.healthFactor,
          distanceToLiquidation: health.distanceToLiquidationPct,
        },
        'Drift liquidation alert'
      );

      emitter.emit('alert', alert);

      if (cfg.onAlert) {
        await cfg.onAlert(alert);
      }

      lastAlertLevel = alertLevel;
    } else if (!alertLevel) {
      lastAlertLevel = null;
    }

    emitter.emit('health', health);
    return health;
  }

  function formatAlertMessage(health: DriftAccountHealth, level: LiquidationAlertLevel): string {
    const emoji = level === 'liquidated' ? '🚨💀' : level === 'critical' ? '🚨' : level === 'danger' ? '⚠️' : '⚡';
    const levelText = level.toUpperCase();

    let msg = `${emoji} **DRIFT ${levelText} ALERT**\n\n`;
    msg += `Health Factor: **${health.healthFactor.toFixed(2)}**\n`;
    msg += `Distance to Liquidation: **${health.distanceToLiquidationPct.toFixed(1)}%**\n`;
    msg += `Total Collateral: $${health.totalCollateral.toFixed(2)}\n`;
    msg += `Maintenance Margin: $${health.maintenanceMargin.toFixed(2)}\n\n`;

    if (health.positions.length > 0) {
      msg += '**Positions at Risk:**\n';
      for (const pos of health.positions) {
        const pnlSign = pos.unrealizedPnL >= 0 ? '+' : '';
        msg += `• ${pos.marketName}: ${pos.direction.toUpperCase()} ${Math.abs(pos.baseAssetAmount).toFixed(4)}\n`;
        msg += `  Entry: $${pos.entryPrice.toFixed(2)} | Current: $${pos.currentPrice.toFixed(2)}\n`;
        msg += `  Liq Price: $${pos.liquidationPrice.toFixed(2)} | PnL: ${pnlSign}$${pos.unrealizedPnL.toFixed(2)}\n`;
      }
    }

    if (level === 'critical' || level === 'liquidated') {
      msg += '\n⚡ **IMMEDIATE ACTION REQUIRED** - Add collateral or reduce positions!';
    }

    return msg;
  }

  async function start(): Promise<void> {
    if (isMonitoring) return;

    await initializeClient();
    isMonitoring = true;

    // Initial check
    await checkHealth();

    // Start polling
    pollInterval = setInterval(async () => {
      try {
        await checkHealth();
      } catch (error) {
        logger.error({ error }, 'Error during health check');
      }
    }, cfg.pollIntervalMs);

    logger.info({ account: cfg.accountPubkey, interval: cfg.pollIntervalMs }, 'Drift liquidation monitor started');
    emitter.emit('started');
  }

  function stop(): void {
    if (!isMonitoring) return;

    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    if (driftClient) {
      driftClient.unsubscribe().catch(() => {});
      driftClient = null;
    }

    isMonitoring = false;
    lastAlertLevel = null;

    logger.info('Drift liquidation monitor stopped');
    emitter.emit('stopped');
  }

  function isActive(): boolean {
    return isMonitoring;
  }

  function calculateLiquidationPrice(position: DriftPosition, collateral: number): number {
    return calculateLiquidationPriceForPosition(
      position.baseAssetAmount,
      position.entryPrice,
      collateral,
      0.05, // Default maintenance margin ratio
      position.direction
    );
  }

  // Attach methods to emitter
  Object.assign(emitter, {
    start,
    stop,
    getAccountHealth,
    checkHealth,
    getPositions,
    calculateLiquidationPrice,
    isActive,
  });

  return emitter;
}
