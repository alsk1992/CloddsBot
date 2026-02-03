/**
 * Drift Protocol SDK Skill
 *
 * CLI commands for Drift Protocol perpetual futures trading on Solana.
 * Uses direct SDK integration (no gateway required).
 */

import { Connection, Keypair } from '@solana/web3.js';
import {
  executeDriftDirectOrder,
  cancelDriftOrder,
  getDriftOrders,
  getDriftPositions,
  getDriftBalance,
  modifyDriftOrder,
  setDriftLeverage,
  type DriftPositionInfo,
  type DriftOrderInfo,
  type DriftBalanceInfo,
} from '../../../solana/drift';
import { logger } from '../../../utils/logger';
import * as bs58Module from 'bs58';

const bs58 = (bs58Module as { default?: typeof bs58Module }).default || bs58Module;

// =============================================================================
// HELPERS
// =============================================================================

function formatNumber(n: number | string, decimals = 2): string {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '0';
  if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(decimals) + 'B';
  if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(decimals) + 'M';
  if (Math.abs(num) >= 1e3) return (num / 1e3).toFixed(decimals) + 'K';
  return num.toFixed(decimals);
}

function formatPnl(pnl: number | string): string {
  const num = typeof pnl === 'string' ? parseFloat(pnl) : pnl;
  if (isNaN(num)) return '$0';
  const sign = num >= 0 ? '+' : '';
  return `${sign}$${formatNumber(Math.abs(num))}`;
}

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  return new Connection(rpcUrl, 'confirmed');
}

function getKeypair(): Keypair | null {
  const privateKey = process.env.DRIFT_PRIVATE_KEY;
  if (!privateKey) return null;

  try {
    // Try base58 first
    if (!privateKey.startsWith('[')) {
      const decoded = bs58.decode(privateKey);
      return Keypair.fromSecretKey(decoded);
    }
    // Try JSON array
    const array = JSON.parse(privateKey);
    return Keypair.fromSecretKey(Uint8Array.from(array));
  } catch {
    return null;
  }
}

// Market index mapping
const MARKET_INDICES: Record<string, number> = {
  'BTC': 0, 'BTC-PERP': 0,
  'ETH': 1, 'ETH-PERP': 1,
  'SOL': 2, 'SOL-PERP': 2,
  'MATIC': 3, 'MATIC-PERP': 3,
  'ARB': 4, 'ARB-PERP': 4,
  'DOGE': 5, 'DOGE-PERP': 5,
  'BNB': 6, 'BNB-PERP': 6,
  'SUI': 7, 'SUI-PERP': 7,
  'PEPE': 8, 'PEPE-PERP': 8,
  'OP': 9, 'OP-PERP': 9,
};

const INDEX_TO_SYMBOL: Record<number, string> = {
  0: 'BTC', 1: 'ETH', 2: 'SOL', 3: 'MATIC', 4: 'ARB',
  5: 'DOGE', 6: 'BNB', 7: 'SUI', 8: 'PEPE', 9: 'OP',
};

function getMarketIndex(coin: string): number | null {
  const key = coin.toUpperCase();
  return MARKET_INDICES[key] ?? null;
}

function getSymbol(marketIndex: number): string {
  return INDEX_TO_SYMBOL[marketIndex] || `MARKET-${marketIndex}`;
}

// =============================================================================
// HANDLERS
// =============================================================================

async function handleBalance(): Promise<string> {
  const connection = getConnection();
  const keypair = getKeypair();
  if (!keypair) {
    return 'DRIFT_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  try {
    const balance: DriftBalanceInfo = await getDriftBalance(connection, keypair);

    return [
      '**Drift Account Balance**',
      '',
      `Collateral: $${formatNumber(balance.totalCollateral)}`,
      `Free Collateral: $${formatNumber(balance.freeCollateral)}`,
      `Maintenance Margin: $${formatNumber(balance.maintenanceMargin)}`,
      `Account Equity: $${formatNumber(balance.accountEquity)}`,
      `Health Factor: ${balance.healthFactor.toFixed(1)}%`,
    ].join('\n');
  } catch (error) {
    logger.error('Failed to get Drift balance', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to get balance'}`;
  }
}

async function handlePositions(): Promise<string> {
  const connection = getConnection();
  const keypair = getKeypair();
  if (!keypair) {
    return 'DRIFT_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  try {
    const positions: DriftPositionInfo[] = await getDriftPositions(connection, keypair);

    if (positions.length === 0) {
      return 'No open positions';
    }

    const lines = ['**Drift Positions**', ''];

    for (const pos of positions) {
      const baseAmount = parseFloat(pos.baseAssetAmount);
      const direction = baseAmount > 0 ? 'LONG' : 'SHORT';
      const size = Math.abs(baseAmount);
      const symbol = getSymbol(pos.marketIndex);
      lines.push(`${symbol} ${direction}`);
      lines.push(`  Size: ${formatNumber(size)} | Entry: $${formatNumber(pos.entryPrice)}`);
      lines.push(`  Quote: $${formatNumber(pos.quoteAssetAmount)}`);
      lines.push('');
    }

    return lines.join('\n').trim();
  } catch (error) {
    logger.error('Failed to get Drift positions', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to get positions'}`;
  }
}

async function handleOrders(): Promise<string> {
  const connection = getConnection();
  const keypair = getKeypair();
  if (!keypair) {
    return 'DRIFT_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  try {
    const orders: DriftOrderInfo[] = await getDriftOrders(connection, keypair);

    if (orders.length === 0) {
      return 'No open orders';
    }

    const lines = ['**Drift Open Orders**', ''];

    for (const order of orders) {
      const symbol = getSymbol(order.marketIndex);
      lines.push(`[${order.orderId}] ${symbol} ${order.direction.toUpperCase()} ${order.orderType}`);
      lines.push(`  Size: ${formatNumber(order.baseAssetAmount)} @ $${formatNumber(order.price)}`);
      lines.push('');
    }

    return lines.join('\n').trim();
  } catch (error) {
    logger.error('Failed to get Drift orders', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to get orders'}`;
  }
}

async function handleLong(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 2) {
    return 'Usage: /drift long <coin> <size> [price]\nExample: /drift long BTC 0.1';
  }

  const [coin, sizeStr, priceStr] = parts;
  const marketIndex = getMarketIndex(coin);
  if (marketIndex === null) {
    return `Unknown market: ${coin}. Supported: BTC, ETH, SOL, MATIC, ARB, DOGE, BNB, SUI, PEPE, OP`;
  }

  const size = parseFloat(sizeStr);
  if (isNaN(size) || size <= 0) {
    return 'Invalid size. Must be a positive number.';
  }

  const price = priceStr ? parseFloat(priceStr) : undefined;
  const orderType = price ? 'limit' : 'market';

  const connection = getConnection();
  const keypair = getKeypair();
  if (!keypair) {
    return 'DRIFT_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  if (process.env.DRY_RUN === 'true') {
    return `[DRY RUN] Would open LONG ${size} ${coin.toUpperCase()} @ ${price ? `$${price}` : 'market'}`;
  }

  try {
    const result = await executeDriftDirectOrder(connection, keypair, {
      marketIndex,
      marketType: 'perp',
      side: 'buy',
      baseAmount: size.toString(),
      price: price?.toString(),
      orderType,
    });

    return [
      `**Order Placed**`,
      `${coin.toUpperCase()} LONG ${orderType.toUpperCase()}`,
      `Size: ${size}`,
      price ? `Price: $${price}` : 'Price: Market',
      `Order ID: ${result.orderId}`,
    ].join('\n');
  } catch (error) {
    logger.error('Failed to place Drift order', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to place order'}`;
  }
}

async function handleShort(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 2) {
    return 'Usage: /drift short <coin> <size> [price]\nExample: /drift short ETH 1 2500';
  }

  const [coin, sizeStr, priceStr] = parts;
  const marketIndex = getMarketIndex(coin);
  if (marketIndex === null) {
    return `Unknown market: ${coin}. Supported: BTC, ETH, SOL, MATIC, ARB, DOGE, BNB, SUI, PEPE, OP`;
  }

  const size = parseFloat(sizeStr);
  if (isNaN(size) || size <= 0) {
    return 'Invalid size. Must be a positive number.';
  }

  const price = priceStr ? parseFloat(priceStr) : undefined;
  const orderType = price ? 'limit' : 'market';

  const connection = getConnection();
  const keypair = getKeypair();
  if (!keypair) {
    return 'DRIFT_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  if (process.env.DRY_RUN === 'true') {
    return `[DRY RUN] Would open SHORT ${size} ${coin.toUpperCase()} @ ${price ? `$${price}` : 'market'}`;
  }

  try {
    const result = await executeDriftDirectOrder(connection, keypair, {
      marketIndex,
      marketType: 'perp',
      side: 'sell',
      baseAmount: size.toString(),
      price: price?.toString(),
      orderType,
    });

    return [
      `**Order Placed**`,
      `${coin.toUpperCase()} SHORT ${orderType.toUpperCase()}`,
      `Size: ${size}`,
      price ? `Price: $${price}` : 'Price: Market',
      `Order ID: ${result.orderId}`,
    ].join('\n');
  } catch (error) {
    logger.error('Failed to place Drift order', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to place order'}`;
  }
}

async function handleClose(args: string): Promise<string> {
  const coin = args.trim().toUpperCase();
  if (!coin) {
    return 'Usage: /drift close <coin>\nExample: /drift close BTC';
  }

  const marketIndex = getMarketIndex(coin);
  if (marketIndex === null) {
    return `Unknown market: ${coin}. Supported: BTC, ETH, SOL, MATIC, ARB, DOGE, BNB, SUI, PEPE, OP`;
  }

  const connection = getConnection();
  const keypair = getKeypair();
  if (!keypair) {
    return 'DRIFT_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  try {
    // Get position to determine direction and size
    const positions = await getDriftPositions(connection, keypair, marketIndex);
    const position = positions[0];

    if (!position) {
      return `No open position for ${coin}`;
    }

    const baseAmount = parseFloat(position.baseAssetAmount);
    if (baseAmount === 0) {
      return `No open position for ${coin}`;
    }

    const side = baseAmount > 0 ? 'sell' : 'buy';
    const size = Math.abs(baseAmount);

    if (process.env.DRY_RUN === 'true') {
      return `[DRY RUN] Would close ${coin} position (${size} ${baseAmount > 0 ? 'LONG' : 'SHORT'})`;
    }

    const result = await executeDriftDirectOrder(connection, keypair, {
      marketIndex,
      marketType: 'perp',
      side,
      baseAmount: size.toString(),
      orderType: 'market',
    });

    return [
      `**Position Closed**`,
      `${coin} closed at market`,
      `Order ID: ${result.orderId}`,
    ].join('\n');
  } catch (error) {
    logger.error('Failed to close Drift position', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to close position'}`;
  }
}

async function handleCancel(args: string): Promise<string> {
  const arg = args.trim();

  const connection = getConnection();
  const keypair = getKeypair();
  if (!keypair) {
    return 'DRIFT_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  if (process.env.DRY_RUN === 'true') {
    return `[DRY RUN] Would cancel order(s): ${arg || 'all'}`;
  }

  try {
    // Check if it's a market name or order ID
    const marketIndex = getMarketIndex(arg);

    if (marketIndex !== null) {
      // Cancel all orders for market
      const result = await cancelDriftOrder(connection, keypair, {
        marketIndex,
        marketType: 'perp',
      });
      return `Cancelled ${result.cancelled.length} order(s) for ${arg.toUpperCase()}. TX: ${result.txSig}`;
    } else if (arg) {
      // Cancel by order ID
      const orderId = parseInt(arg);
      if (isNaN(orderId)) {
        return 'Invalid order ID. Use /drift cancel <orderId> or /drift cancel <coin>';
      }
      const result = await cancelDriftOrder(connection, keypair, { orderId });
      return result.cancelled.length > 0
        ? `Order ${orderId} cancelled. TX: ${result.txSig}`
        : `Failed to cancel order ${orderId}`;
    } else {
      return 'Usage: /drift cancel <orderId> or /drift cancel <coin>';
    }
  } catch (error) {
    logger.error('Failed to cancel Drift order', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to cancel order'}`;
  }
}

async function handleCancelAll(): Promise<string> {
  const connection = getConnection();
  const keypair = getKeypair();
  if (!keypair) {
    return 'DRIFT_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  if (process.env.DRY_RUN === 'true') {
    return '[DRY RUN] Would cancel all orders';
  }

  try {
    // Cancel orders for all markets
    let totalCancelled = 0;
    for (let i = 0; i <= 9; i++) {
      try {
        const result = await cancelDriftOrder(connection, keypair, {
          marketIndex: i,
          marketType: 'perp',
        });
        totalCancelled += result.cancelled.length;
      } catch {
        // Ignore errors for individual markets
      }
    }
    return `Cancelled ${totalCancelled} order(s)`;
  } catch (error) {
    logger.error('Failed to cancel all Drift orders', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to cancel orders'}`;
  }
}

async function handleLeverage(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 2) {
    return 'Usage: /drift leverage <coin> <value>\nExample: /drift leverage BTC 5';
  }

  const [coin, leverageStr] = parts;
  const marketIndex = getMarketIndex(coin);
  if (marketIndex === null) {
    return `Unknown market: ${coin}. Supported: BTC, ETH, SOL, MATIC, ARB, DOGE, BNB, SUI, PEPE, OP`;
  }

  const leverage = parseInt(leverageStr);
  if (isNaN(leverage) || leverage < 1 || leverage > 20) {
    return 'Invalid leverage. Must be between 1 and 20.';
  }

  const connection = getConnection();
  const keypair = getKeypair();
  if (!keypair) {
    return 'DRIFT_PRIVATE_KEY not configured. Set it in environment variables.';
  }

  if (process.env.DRY_RUN === 'true') {
    return `[DRY RUN] Would set ${coin.toUpperCase()} leverage to ${leverage}x`;
  }

  try {
    const result = await setDriftLeverage(connection, keypair, {
      marketIndex,
      leverage,
    });

    return `Set ${coin.toUpperCase()} leverage to ${result.leverage}x. TX: ${result.txSig}`;
  } catch (error) {
    logger.error('Failed to set Drift leverage', error);
    return `Error: ${error instanceof Error ? error.message : 'Failed to set leverage'}`;
  }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export async function handle(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || '';
  const rest = parts.slice(1).join(' ');

  switch (command) {
    case '':
    case 'help':
      return [
        '**Drift Protocol SDK Commands**',
        '',
        '`/drift balance` - Account balance & margin',
        '`/drift positions` - Open positions',
        '`/drift orders` - Open orders',
        '`/drift long <coin> <size> [price]` - Open long',
        '`/drift short <coin> <size> [price]` - Open short',
        '`/drift close <coin>` - Close position',
        '`/drift cancel <orderId|coin>` - Cancel order(s)',
        '`/drift cancelall` - Cancel all orders',
        '`/drift leverage <coin> <1-20>` - Set leverage',
      ].join('\n');

    case 'balance':
    case 'b':
      return handleBalance();

    case 'positions':
    case 'pos':
    case 'p':
      return handlePositions();

    case 'orders':
    case 'o':
      return handleOrders();

    case 'long':
    case 'l':
      return handleLong(rest);

    case 'short':
    case 's':
      return handleShort(rest);

    case 'close':
      return handleClose(rest);

    case 'cancel':
      return handleCancel(rest);

    case 'cancelall':
      return handleCancelAll();

    case 'leverage':
    case 'lev':
      return handleLeverage(rest);

    default:
      return `Unknown command: ${command}. Use /drift help for available commands.`;
  }
}

export default {
  name: 'drift-sdk',
  description: 'Drift Protocol SDK - Direct SDK integration for perpetual futures trading on Solana',
  commands: ['/drift-sdk'],
  requires: { env: ['SOLANA_PRIVATE_KEY'] },
  handle,
};
