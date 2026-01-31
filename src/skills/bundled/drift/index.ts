/**
 * Drift Protocol CLI Skill
 *
 * Perpetual futures and prediction markets on Solana
 */

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

    const result = await drift.cancelDriftOrder(connection, keypair, {
      orderId: orderId ? parseInt(orderId, 10) : undefined,
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

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
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

    case 'leverage':
    case 'lev':
      return handleLeverage(rest[0], rest[1]);

    case 'help':
    default:
      return `**Drift Protocol**

**Trading:**
  /drift long <market> <size> [price]   Open long
  /drift short <market> <size> [price]  Open short
  /drift cancel [orderId]               Cancel order

**Account:**
  /drift positions                      View positions
  /drift orders                         View orders
  /drift balance                        Check balance
  /drift leverage <market> <amount>     Set leverage

**Markets:** SOL-PERP, BTC-PERP, ETH-PERP (or use index)

**Examples:**
  /drift long SOL-PERP 0.5
  /drift short BTC-PERP 0.01 95000
  /drift positions
  /drift leverage SOL 5`;
  }
}

export default { execute };
