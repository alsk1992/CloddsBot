/**
 * Lighter Skill
 *
 * CLI commands for the Lighter orderbook DEX on Arbitrum.
 */

import { Wallet } from 'ethers';
import * as lighter from '../../../exchanges/lighter/index.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// HELPERS
// =============================================================================

function formatNumber(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(decimals) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(decimals) + 'K';
  return n.toFixed(decimals);
}

function getConfig(): lighter.LighterConfig | null {
  const privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) return null;

  const wallet = new Wallet(privateKey);

  return {
    walletAddress: wallet.address,
    privateKey,
    apiKey: process.env.LIGHTER_API_KEY,
    dryRun: process.env.DRY_RUN === 'true',
  };
}

// =============================================================================
// HANDLERS
// =============================================================================

async function handleMarkets(): Promise<string> {
  const markets = await lighter.getMarkets();

  if (markets.length === 0) {
    return 'No markets available';
  }

  const lines = ['**Lighter Markets**', ''];
  for (const m of markets) {
    lines.push(`  ${m.name} — ${m.baseToken}/${m.quoteToken} (min: ${m.minOrderSize})`);
  }

  return lines.join('\n');
}

async function handlePrice(market: string): Promise<string> {
  if (!market) return 'Usage: /lighter price <market>';

  const price = await lighter.getPrice(market);

  return [
    `**${market}**`,
    `Bid: $${price.bid.toFixed(2)}`,
    `Ask: $${price.ask.toFixed(2)}`,
    `Mid: $${price.mid.toFixed(2)}`,
    `Spread: ${price.bid > 0 ? ((price.ask - price.bid) / price.bid * 100).toFixed(4) : '0'}%`,
  ].join('\n');
}

async function handleBook(market: string): Promise<string> {
  if (!market) return 'Usage: /lighter book <market>';

  const ob = await lighter.getOrderbook(market);

  const lines = [`**${market} Orderbook**`, '', 'Asks:'];

  for (const ask of ob.asks.slice(0, 5).reverse()) {
    lines.push(`  $${ask.price.toFixed(2)} | ${formatNumber(ask.size)}`);
  }

  lines.push('---');

  for (const bid of ob.bids.slice(0, 5)) {
    lines.push(`  $${bid.price.toFixed(2)} | ${formatNumber(bid.size)}`);
  }

  return lines.join('\n');
}

async function handleBalance(): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set EVM_PRIVATE_KEY to use Lighter';

  const balances = await lighter.getBalance(config);

  if (balances.length === 0) {
    return 'No balances found';
  }

  const lines = ['**Lighter Balances**', ''];
  for (const b of balances) {
    lines.push(`  ${b.token}: ${b.total} (available: ${b.available})`);
  }

  return lines.join('\n');
}

async function handlePositions(): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set EVM_PRIVATE_KEY to use Lighter';

  const positions = await lighter.getPositions(config);

  if (positions.length === 0) {
    return 'No open positions';
  }

  const lines = ['**Lighter Positions**', ''];
  for (const p of positions) {
    const pnl = parseFloat(p.unrealizedPnl);
    const pnlStr = pnl >= 0 ? `+$${formatNumber(pnl)}` : `-$${formatNumber(Math.abs(pnl))}`;
    lines.push(`  ${p.market} ${p.side} ${p.size} @ $${p.entryPrice} (${pnlStr})`);
    lines.push(`    Mark: $${p.markPrice} | Lev: ${p.leverage}x | Liq: $${p.liquidationPrice}`);
  }

  return lines.join('\n');
}

async function handleOrders(): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set EVM_PRIVATE_KEY to use Lighter';

  const orders = await lighter.getOpenOrders(config);

  if (orders.length === 0) {
    return 'No open orders';
  }

  const lines = ['**Lighter Open Orders**', ''];
  for (const o of orders) {
    lines.push(`  ${o.market} ${o.side} ${o.size} @ $${o.price} (filled: ${o.filled})`);
    lines.push(`    ID: ${o.orderId}`);
  }

  return lines.join('\n');
}

async function handleLong(market: string, size: string, price?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set EVM_PRIVATE_KEY to use Lighter';

  if (!market || !size) {
    return 'Usage: /lighter long <market> <size> [price]\nExample: /lighter long ETH-USD 1 3000';
  }

  const result = await lighter.placeOrder(config, {
    market,
    side: 'BUY',
    size: parseFloat(size),
    price: price ? parseFloat(price) : undefined,
    type: price ? 'LIMIT' : 'MARKET',
  });

  if (result.success) {
    return `LONG ${market} ${size} ${price ? `@ $${price}` : 'MARKET'} (ID: ${result.orderId})`;
  }
  return `Order failed: ${result.error}`;
}

async function handleShort(market: string, size: string, price?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set EVM_PRIVATE_KEY to use Lighter';

  if (!market || !size) {
    return 'Usage: /lighter short <market> <size> [price]\nExample: /lighter short BTC-USD 0.1 45000';
  }

  const result = await lighter.placeOrder(config, {
    market,
    side: 'SELL',
    size: parseFloat(size),
    price: price ? parseFloat(price) : undefined,
    type: price ? 'LIMIT' : 'MARKET',
  });

  if (result.success) {
    return `SHORT ${market} ${size} ${price ? `@ $${price}` : 'MARKET'} (ID: ${result.orderId})`;
  }
  return `Order failed: ${result.error}`;
}

async function handleClose(market: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set EVM_PRIVATE_KEY to use Lighter';

  if (!market) return 'Usage: /lighter close <market>';

  const positions = await lighter.getPositions(config);
  const pos = positions.find(p => p.market.toLowerCase() === market.toLowerCase());

  if (!pos) {
    return `No open position for ${market}`;
  }

  const size = parseFloat(pos.size);
  const result = await lighter.placeOrder(config, {
    market: pos.market,
    side: pos.side === 'LONG' ? 'SELL' : 'BUY',
    size,
    type: 'MARKET',
    reduceOnly: true,
  });

  if (result.success) {
    const pnl = parseFloat(pos.unrealizedPnl);
    const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    return `Closed ${pos.market} ${pos.side} ${pos.size} (PnL: ${pnlStr})`;
  }
  return `Close failed: ${result.error}`;
}

async function handleCloseAll(): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set EVM_PRIVATE_KEY to use Lighter';

  const positions = await lighter.getPositions(config);

  if (positions.length === 0) {
    return 'No open positions';
  }

  const results: string[] = [];
  let totalPnl = 0;

  for (const pos of positions) {
    const size = parseFloat(pos.size);
    const pnl = parseFloat(pos.unrealizedPnl);

    const result = await lighter.placeOrder(config, {
      market: pos.market,
      side: pos.side === 'LONG' ? 'SELL' : 'BUY',
      size,
      type: 'MARKET',
      reduceOnly: true,
    });

    if (result.success) {
      totalPnl += pnl;
      const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
      results.push(`${pos.market}: closed (${pnlStr})`);
    } else {
      results.push(`${pos.market}: ${result.error}`);
    }
  }

  const totalStr = totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`;
  return ['**Closed Positions:**', '', ...results, '', `Total PnL: ${totalStr}`].join('\n');
}

async function handleCancel(orderId: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set EVM_PRIVATE_KEY to use Lighter';

  if (!orderId) return 'Usage: /lighter cancel <orderId>';

  const result = await lighter.cancelOrder(config, orderId);
  return result.success ? `Order ${orderId} cancelled` : `Failed: ${result.error}`;
}

async function handleCancelAll(): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set EVM_PRIVATE_KEY to use Lighter';

  const result = await lighter.cancelAllOrders(config);
  return result.success ? 'All orders cancelled' : `Failed: ${result.error}`;
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const skill = {
  name: 'lighter',
  description: 'Lighter orderbook DEX on Arbitrum',
  commands: [
    {
      name: 'lighter',
      description: 'Lighter DEX commands',
      usage: '/lighter <command>',
    },
  ],
  requires: { env: ['EVM_PRIVATE_KEY'] },

  async handler(args: string): Promise<string> {
    const parts = args.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    try {
      switch (cmd) {
        case 'markets':
        case 'm':
          return handleMarkets();
        case 'price':
        case 'p':
          return parts[1] ? handlePrice(parts[1]) : 'Usage: /lighter price <market>';
        case 'book':
        case 'ob':
          return parts[1] ? handleBook(parts[1]) : 'Usage: /lighter book <market>';
        case 'balance':
        case 'bal':
        case 'b':
          return handleBalance();
        case 'positions':
        case 'pos':
          return handlePositions();
        case 'orders':
        case 'o':
          return handleOrders();
        case 'long':
        case 'l':
          return handleLong(parts[1], parts[2], parts[3]);
        case 'short':
        case 's':
          return handleShort(parts[1], parts[2], parts[3]);
        case 'close':
          return parts[1] ? handleClose(parts[1]) : 'Usage: /lighter close <market>';
        case 'closeall':
          return handleCloseAll();
        case 'cancel':
          return parts[1] ? handleCancel(parts[1]) : 'Usage: /lighter cancel <orderId>';
        case 'cancelall':
          return handleCancelAll();

        case 'help':
        case '':
        case undefined:
        default:
          return [
            '**Lighter Commands**',
            '',
            '**Market Data:**',
            '  /lighter markets       - List markets',
            '  /lighter price <mkt>   - Get price',
            '  /lighter book <mkt>    - Orderbook',
            '',
            '**Account:**',
            '  /lighter balance       - Show balances',
            '  /lighter positions     - Open positions',
            '  /lighter orders        - Open orders',
            '',
            '**Trading:**',
            '  /lighter long <mkt> <size> [price]',
            '  /lighter short <mkt> <size> [price]',
            '  /lighter close <mkt>   - Close position',
            '  /lighter closeall      - Close all positions',
            '  /lighter cancel <id>   - Cancel order',
            '  /lighter cancelall     - Cancel all orders',
          ].join('\n');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, args }, 'Lighter command failed');
      return `Error: ${message}`;
    }
  },
};

export default skill;
