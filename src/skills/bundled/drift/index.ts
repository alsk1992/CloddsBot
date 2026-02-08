/**
 * Drift Protocol CLI Skill
 *
 * Perpetual futures and prediction markets on Solana
 */

import { formatHelp } from '../../help.js';
import { wrapSkillError } from '../../errors.js';

const getSolanaModules = async () => {
  const [wallet, drift] = await Promise.all([
    import('../../../solana/wallet'),
    import('../../../solana/drift'),
  ]);
  return { wallet, drift };
};

function isConfigured(): boolean {
  return !!(process.env.SOLANA_PRIVATE_KEY || process.env.SOLANA_KEYPAIR_PATH);
}

function parseMarket(market: string): { marketIndex: number; marketType: 'perp' | 'spot' } {
  // Common perp markets
  const perpMarkets: Record<string, number> = {
    'SOL-PERP': 0,
    'BTC-PERP': 1,
    'ETH-PERP': 2,
    'SOL': 0,
    'BTC': 1,
    'ETH': 2,
  };

  const upper = market.toUpperCase();
  if (perpMarkets[upper] !== undefined) {
    return { marketIndex: perpMarkets[upper], marketType: 'perp' };
  }

  // Try parsing as number
  const index = parseInt(market, 10);
  if (!isNaN(index)) {
    return { marketIndex: index, marketType: 'perp' };
  }

  return { marketIndex: 0, marketType: 'perp' };
}

async function handleLong(market: string, size: string, price?: string): Promise<string> {
  if (!isConfigured()) {
    return 'Drift not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (!market || !size) {
    return 'Usage: /drift long <market> <size> [price]';
  }

  try {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const { marketIndex, marketType } = parseMarket(market);

    const result = await drift.executeDriftDirectOrder(connection, keypair, {
      marketType,
      marketIndex,
      side: 'buy',
      orderType: price ? 'limit' : 'market',
      baseAmount: size,
      price,
    });

    return `**Drift Long Opened**\n\n` +
      `Market: ${market} (index: ${marketIndex})\n` +
      `Size: ${size}\n` +
      `Type: ${price ? `Limit @ ${price}` : 'Market'}\n` +
      `Order ID: ${result.orderId || 'N/A'}\n` +
      `TX: \`${result.txSig}\``;
  } catch (error) {
    return `Long failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleShort(market: string, size: string, price?: string): Promise<string> {
  if (!isConfigured()) {
    return 'Drift not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (!market || !size) {
    return 'Usage: /drift short <market> <size> [price]';
  }

  try {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const { marketIndex, marketType } = parseMarket(market);

    const result = await drift.executeDriftDirectOrder(connection, keypair, {
      marketType,
      marketIndex,
      side: 'sell',
      orderType: price ? 'limit' : 'market',
      baseAmount: size,
      price,
    });

    return `**Drift Short Opened**\n\n` +
      `Market: ${market} (index: ${marketIndex})\n` +
      `Size: ${size}\n` +
      `Type: ${price ? `Limit @ ${price}` : 'Market'}\n` +
      `Order ID: ${result.orderId || 'N/A'}\n` +
      `TX: \`${result.txSig}\``;
  } catch (error) {
    return `Short failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePositions(): Promise<string> {
  if (!isConfigured()) {
    return 'Drift not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const positions = await drift.getDriftPositions(connection, keypair);

    if (!positions || positions.length === 0) {
      return 'No open positions.';
    }

    let output = `**Drift Positions** (${positions.length})\n\n`;
    for (const pos of positions) {
      output += `**Market ${pos.marketIndex}** (${pos.marketType})\n`;
      output += `  Size: ${pos.baseAssetAmount}\n`;
      output += `  Entry: ${pos.entryPrice || 'N/A'}\n`;
      output += `  Unrealized PnL: ${pos.unrealizedPnl || 'N/A'}\n`;
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleOrders(): Promise<string> {
  if (!isConfigured()) {
    return 'Drift not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const orders = await drift.getDriftOrders(connection, keypair);

    if (!orders || orders.length === 0) {
      return 'No open orders.';
    }

    let output = `**Drift Orders** (${orders.length})\n\n`;
    for (const order of orders) {
      output += `**Order ${order.orderId}**\n`;
      output += `  Market: ${order.marketIndex}\n`;
      output += `  Side: ${order.direction}\n`;
      output += `  Price: ${order.price || 'Market'}\n`;
      output += `  Size: ${order.baseAssetAmount}\n`;
      output += `  Filled: ${order.baseAssetAmountFilled || 0}\n`;
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBalance(): Promise<string> {
  if (!isConfigured()) {
    return 'Drift not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const balance = await drift.getDriftBalance(connection, keypair);

    return `**Drift Account**\n\n` +
      `Total Collateral: $${balance.totalCollateral?.toLocaleString() || '0'}\n` +
      `Free Collateral: $${balance.freeCollateral?.toLocaleString() || '0'}\n` +
      `Margin Ratio: ${balance.marginRatio || 'N/A'}%\n` +
      `Unrealized PnL: $${balance.unrealizedPnl?.toLocaleString() || '0'}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCancel(orderId?: string): Promise<string> {
  if (!isConfigured()) {
    return 'Drift not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const parsedOrderId = orderId ? parseInt(orderId, 10) : undefined;
    if (parsedOrderId !== undefined && isNaN(parsedOrderId)) {
      return `Invalid order ID: ${orderId}. Must be a number.`;
    }
    const result = await drift.cancelDriftOrder(connection, keypair, {
      orderId: parsedOrderId,
    });

    return `Order cancelled. TX: \`${result.txSig}\``;
  } catch (error) {
    return `Cancel failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleLeverage(market: string, leverage: string): Promise<string> {
  if (!isConfigured()) {
    return 'Drift not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (!market || !leverage) {
    return 'Usage: /drift leverage <market> <amount>';
  }

  try {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const { marketIndex } = parseMarket(market);
    const leverageNum = parseFloat(leverage);

    const result = await drift.setDriftLeverage(connection, keypair, {
      marketIndex,
      leverage: leverageNum,
    });

    return `Leverage set to ${leverageNum}x for market ${market}. TX: \`${result.txSig}\``;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleModify(orderId: string, newPrice?: string, newSize?: string): Promise<string> {
  if (!isConfigured()) {
    return 'Drift not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (!orderId) {
    return 'Usage: /drift modify <orderId> [price] [size]';
  }

  try {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await drift.modifyDriftOrder(connection, keypair, {
      orderId: parseInt(orderId, 10),
      newPrice,
      newBaseAmount: newSize,
    });

    return `**Order Modified**\n\n` +
      `Order ID: ${result.orderId}\n` +
      (newPrice ? `New Price: ${newPrice}\n` : '') +
      (newSize ? `New Size: ${newSize}\n` : '') +
      `TX: \`${result.txSig}\``;
  } catch (error) {
    return `Modify failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleHealth(): Promise<string> {
  if (!isConfigured()) {
    return 'Drift not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const monitor = drift.createDriftLiquidationMonitor({
      connection,
      accountPubkey: keypair.publicKey.toBase58(),
    });

    const health = await monitor.getAccountHealth();
    monitor.stop();

    let output = `**Drift Account Health**\n\n`;
    output += `Risk Level: **${health.riskLevel.toUpperCase()}**\n`;
    output += `Health Factor: ${health.healthFactor.toFixed(2)}\n`;
    output += `Distance to Liquidation: ${health.distanceToLiquidationPct.toFixed(1)}%\n\n`;
    output += `Total Collateral: $${health.totalCollateral.toFixed(2)}\n`;
    output += `Maintenance Margin: $${health.maintenanceMargin.toFixed(2)}\n`;
    output += `Free Collateral: $${health.freeCollateral.toFixed(2)}\n`;

    if (health.positions.length > 0) {
      output += `\n**Positions** (${health.positions.length})\n`;
      for (const pos of health.positions) {
        const pnlSign = pos.unrealizedPnL >= 0 ? '+' : '';
        output += `\n${pos.marketName}: ${pos.direction.toUpperCase()} ${Math.abs(pos.baseAssetAmount).toFixed(4)}\n`;
        output += `  Entry: $${pos.entryPrice.toFixed(2)} | Current: $${pos.currentPrice.toFixed(2)}\n`;
        output += `  Liq: $${pos.liquidationPrice.toFixed(2)} | PnL: ${pnlSign}$${pos.unrealizedPnL.toFixed(2)}\n`;
        output += `  Leverage: ${pos.leverage.toFixed(1)}x\n`;
      }
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  try {
  switch (cmd) {
    case 'long':
    case 'l':
      return handleLong(rest[0], rest[1], rest[2]);

    case 'short':
    case 's':
      return handleShort(rest[0], rest[1], rest[2]);

    case 'positions':
    case 'pos':
    case 'p':
      return handlePositions();

    case 'orders':
    case 'o':
      return handleOrders();

    case 'balance':
    case 'bal':
    case 'b':
      return handleBalance();

    case 'cancel':
      return handleCancel(rest[0]);

    case 'modify':
      return handleModify(rest[0], rest[1], rest[2]);

    case 'leverage':
    case 'lev':
      return handleLeverage(rest[0], rest[1]);

    case 'health':
      return handleHealth();

    case 'help':
    default:
      return formatHelp({
        name: 'Drift Protocol',
        emoji: '\u{1F30A}',
        description: 'Perpetual futures and prediction markets on Solana',
        sections: [
          {
            title: 'Trading',
            commands: [
              { cmd: '/drift long <market> <size> [price]', description: 'Open long' },
              { cmd: '/drift short <market> <size> [price]', description: 'Open short' },
              { cmd: '/drift cancel [orderId]', description: 'Cancel order(s)' },
              { cmd: '/drift modify <orderId> [price] [size]', description: 'Modify order' },
            ],
          },
          {
            title: 'Account',
            commands: [
              { cmd: '/drift positions', description: 'View positions' },
              { cmd: '/drift orders', description: 'View orders' },
              { cmd: '/drift balance', description: 'Check balance' },
              { cmd: '/drift leverage <market> <amount>', description: 'Set leverage' },
              { cmd: '/drift health', description: 'Account health & liq risk' },
            ],
          },
        ],
        examples: [
          '/drift long SOL-PERP 0.5',
          '/drift short BTC-PERP 0.01 95000',
          '/drift modify 123 96000',
          '/drift health',
        ],
        envVars: [
          { name: 'SOLANA_PRIVATE_KEY', description: 'Solana wallet private key', required: true },
          { name: 'SOLANA_KEYPAIR_PATH', description: 'Path to Solana keypair JSON file (alternative to private key)', required: false },
        ],
        seeAlso: [
          { cmd: '/hl', description: 'Hyperliquid perps trading' },
          { cmd: '/lighter', description: 'Lighter DEX trading' },
          { cmd: '/trading-solana', description: 'Solana spot trading' },
          { cmd: '/positions', description: 'Cross-exchange position viewer' },
        ],
        notes: [
          'Shortcuts: l=long, s=short, p/pos=positions, o=orders, b/bal=balance, lev=leverage',
          'Markets: SOL-PERP, BTC-PERP, ETH-PERP (or use numeric index)',
        ],
      });
  }
  } catch (error) {
    return wrapSkillError('Drift', cmd || 'command', error);
  }
}

export default {
  name: 'drift',
  description: 'Drift Protocol - Perpetual futures and prediction markets on Solana',
  commands: ['/drift'],
  handle: execute,
};
