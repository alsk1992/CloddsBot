/**
 * Trading Polymarket CLI Skill
 *
 * Wired to:
 *   - src/feeds/polymarket (createPolymarketFeed - WebSocket, market search, orderbook)
 *   - src/execution (createExecutionService - CLOB order placement/cancellation)
 *
 * Commands:
 * /poly search <query>                     - Search markets
 * /poly market <condition-id>              - Market details
 * /poly book <token-id>                    - View orderbook
 * /poly buy <token-id> <size> [price]      - Buy shares
 * /poly sell <token-id> <size> [price]     - Sell shares
 * /poly positions                          - View open orders
 * /poly orders                             - View open orders
 * /poly cancel <order-id|all>              - Cancel orders
 * /poly balance                            - USDC balance
 * /poly whales                             - Whale activity monitoring
 */

import type { PolymarketFeed } from '../../../feeds/polymarket';
import type { ExecutionService } from '../../../execution';
import { logger } from '../../../utils/logger';

// =============================================================================
// HELPERS
// =============================================================================

function formatNumber(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(decimals) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(decimals) + 'K';
  return n.toFixed(decimals);
}

let feedInstance: PolymarketFeed | null = null;
let execInstance: ExecutionService | null = null;

async function getFeed(): Promise<PolymarketFeed> {
  if (!feedInstance) {
    const { createPolymarketFeed } = await import('../../../feeds/polymarket');
    feedInstance = await createPolymarketFeed();
  }
  return feedInstance;
}

function getExecution(): ExecutionService | null {
  if (!execInstance) {
    const apiKey = process.env.POLY_API_KEY;
    const apiSecret = process.env.POLY_API_SECRET;
    const passphrase = process.env.POLY_API_PASSPHRASE;
    const funderAddress = process.env.POLY_FUNDER_ADDRESS || '';

    if (!apiKey || !apiSecret || !passphrase) return null;

    try {
      const { createExecutionService } = require('../../../execution');
      execInstance = createExecutionService({
        polymarket: {
          address: funderAddress,
          apiKey,
          apiSecret,
          apiPassphrase: passphrase,
          privateKey: process.env.POLY_PRIVATE_KEY,
          funderAddress,
          signatureType: process.env.POLY_SIGNATURE_TYPE ? Number(process.env.POLY_SIGNATURE_TYPE) : undefined,
        },
        dryRun: process.env.DRY_RUN === 'true',
      });
    } catch {
      return null;
    }
  }
  return execInstance;
}

// =============================================================================
// HELP TEXT
// =============================================================================

function helpText(): string {
  return [
    '**Polymarket Trading Commands**',
    '',
    '**Market Data:**',
    '  /poly search <query>                     - Search markets',
    '  /poly market <condition-id>              - Market details',
    '  /poly book <token-id>                    - View orderbook',
    '',
    '**Trading:**',
    '  /poly buy <token-id> <size> <price>      - Buy shares (limit)',
    '  /poly sell <token-id> <size> <price>     - Sell shares (limit)',
    '  /poly orders                             - Open orders',
    '  /poly cancel <order-id>                  - Cancel order',
    '  /poly cancel all                         - Cancel all orders',
    '',
    '**Env vars:** POLY_API_KEY, POLY_API_SECRET, POLY_API_PASSPHRASE',
    '  Optional: POLY_PRIVATE_KEY, POLY_FUNDER_ADDRESS',
    '',
    '**Examples:**',
    '  /poly search bitcoin',
    '  /poly buy 1234567890 100 0.65',
    '  /poly sell 1234567890 50 0.70',
    '  /poly book 1234567890',
  ].join('\n');
}

// =============================================================================
// MARKET DATA HANDLERS
// =============================================================================

async function handleSearch(query: string): Promise<string> {
  if (!query) return 'Usage: /poly search <query>';

  try {
    const feed = await getFeed();
    const markets = await feed.searchMarkets(query);

    if (markets.length === 0) {
      return `No Polymarket markets found for "${query}"`;
    }

    const lines = ['**Polymarket Markets**', ''];

    for (const m of markets.slice(0, 15)) {
      lines.push(`  [${m.id}] ${m.question}`);

      const outcomeStrs = m.outcomes.slice(0, 4).map(o => {
        const tokenSuffix = o.tokenId ? ` (${o.tokenId.slice(0, 8)}...)` : '';
        return `${o.name}: ${(o.price * 100).toFixed(0)}c${tokenSuffix}`;
      });
      lines.push(`       ${outcomeStrs.join(' | ')} | Vol: $${formatNumber(m.volume24h)}`);
    }

    if (markets.length > 15) {
      lines.push('', `...and ${markets.length - 15} more`);
    }

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error searching: ${message}`;
  }
}

async function handleMarket(marketId: string): Promise<string> {
  if (!marketId) return 'Usage: /poly market <condition-id>';

  try {
    const feed = await getFeed();
    const market = await feed.getMarket('polymarket', marketId);

    if (!market) {
      return `Market ${marketId} not found`;
    }

    const lines = [
      `**${market.question}**`,
      '',
      `Condition ID: ${market.id}`,
      `Slug: ${market.slug}`,
      `Platform: Polymarket`,
      market.description ? `Description: ${typeof market.description === 'string' ? market.description.slice(0, 200) : ''}` : '',
      '',
      '**Outcomes:**',
    ];

    for (const o of market.outcomes) {
      const tokenId = o.tokenId || o.id;
      lines.push(`  ${o.name}: ${(o.price * 100).toFixed(1)}c`);
      lines.push(`    Token: ${tokenId}`);
    }

    lines.push(
      '',
      `Volume: $${formatNumber(market.volume24h)}`,
      `Liquidity: $${formatNumber(market.liquidity)}`,
      market.endDate ? `End Date: ${market.endDate.toLocaleDateString()}` : '',
      `Resolved: ${market.resolved ? 'Yes' : 'No'}`,
      '',
      `URL: ${market.url}`,
    );

    return lines.filter(l => l !== '').join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

async function handleOrderbook(tokenId: string): Promise<string> {
  if (!tokenId) return 'Usage: /poly book <token-id>';

  try {
    const feed = await getFeed();
    const orderbook = await feed.getOrderbook('polymarket', tokenId);

    if (!orderbook) {
      return `No orderbook found for token ${tokenId}`;
    }

    const lines = [
      `**Orderbook: ${tokenId.slice(0, 20)}...**`,
      '',
      `Mid: ${(orderbook.midPrice * 100).toFixed(1)}c | Spread: ${(orderbook.spread * 100).toFixed(2)}c`,
      '',
      '**Bids:**',
    ];

    for (const [price, size] of orderbook.bids.slice(0, 5)) {
      lines.push(`  ${(price * 100).toFixed(1)}c - ${formatNumber(size)} shares`);
    }

    lines.push('', '**Asks:**');

    for (const [price, size] of orderbook.asks.slice(0, 5)) {
      lines.push(`  ${(price * 100).toFixed(1)}c - ${formatNumber(size)} shares`);
    }

    // Also show imbalance if enough data
    if (orderbook.bids.length > 0 && orderbook.asks.length > 0) {
      try {
        const { calculateOrderbookImbalance } = await import('../../../execution');
        const imbalance = calculateOrderbookImbalance({
          bids: orderbook.bids,
          asks: orderbook.asks,
          midPrice: orderbook.midPrice,
        });
        lines.push(
          '',
          '**Imbalance:**',
          `  Signal: ${imbalance.signal.toUpperCase()} (${(imbalance.confidence * 100).toFixed(0)}% confidence)`,
          `  Bid/Ask Ratio: ${imbalance.bidAskRatio.toFixed(2)}`,
          `  Score: ${imbalance.imbalanceScore.toFixed(3)}`,
        );
      } catch {
        // Imbalance calculation not available, skip
      }
    }

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

// =============================================================================
// TRADING HANDLERS
// =============================================================================

async function handleBuy(tokenId: string, sizeStr: string, priceStr: string): Promise<string> {
  const exec = getExecution();
  if (!exec) {
    return 'Set POLY_API_KEY, POLY_API_SECRET, and POLY_API_PASSPHRASE to trade on Polymarket.';
  }

  if (!tokenId || !sizeStr) {
    return 'Usage: /poly buy <token-id> <size> <price>\nExample: /poly buy 1234567890 100 0.65';
  }

  const size = parseFloat(sizeStr);
  if (isNaN(size) || size <= 0) {
    return 'Invalid size. Must be a positive number.';
  }

  // If no price, try to use market price with slippage protection
  if (!priceStr) {
    try {
      const result = await exec.protectedBuy({
        platform: 'polymarket',
        marketId: tokenId,
        tokenId,
        price: 0.99, // Will be adjusted by protectedBuy
        size,
      });

      if (result.success) {
        return `BUY ${size} shares (market order, slippage-protected) (Order: ${result.orderId})`;
      }
      return `Order failed: ${result.error}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  }

  const price = parseFloat(priceStr);
  if (isNaN(price) || price < 0.01 || price > 0.99) {
    return 'Invalid price. Must be between 0.01 and 0.99 (e.g., 0.65 for 65c).';
  }

  try {
    // Auto-detect neg_risk for crypto markets
    let negRisk: boolean | undefined;
    try {
      const { checkPolymarketNegRisk } = await import('../../../execution');
      negRisk = await checkPolymarketNegRisk(tokenId);
    } catch {
      // Neg risk check not critical, proceed without
    }

    const result = await exec.buyLimit({
      platform: 'polymarket',
      marketId: tokenId,
      tokenId,
      price,
      size,
      negRisk,
    });

    if (result.success) {
      return [
        `BUY ${size} shares @ ${(price * 100).toFixed(0)}c`,
        `Token: ${tokenId.slice(0, 20)}...`,
        `Order: ${result.orderId}`,
        result.transactionHash ? `Tx: ${result.transactionHash}` : '',
        negRisk ? '(neg-risk market)' : '',
      ].filter(Boolean).join('\n');
    }
    return `Order failed: ${result.error}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

async function handleSell(tokenId: string, sizeStr: string, priceStr: string): Promise<string> {
  const exec = getExecution();
  if (!exec) {
    return 'Set POLY_API_KEY, POLY_API_SECRET, and POLY_API_PASSPHRASE to trade on Polymarket.';
  }

  if (!tokenId || !sizeStr) {
    return 'Usage: /poly sell <token-id> <size> <price>\nExample: /poly sell 1234567890 50 0.70';
  }

  const size = parseFloat(sizeStr);
  if (isNaN(size) || size <= 0) {
    return 'Invalid size. Must be a positive number.';
  }

  if (!priceStr) {
    try {
      const result = await exec.protectedSell({
        platform: 'polymarket',
        marketId: tokenId,
        tokenId,
        price: 0.01, // Will be adjusted by protectedSell
        size,
      });

      if (result.success) {
        return `SELL ${size} shares (market order, slippage-protected) (Order: ${result.orderId})`;
      }
      return `Order failed: ${result.error}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  }

  const price = parseFloat(priceStr);
  if (isNaN(price) || price < 0.01 || price > 0.99) {
    return 'Invalid price. Must be between 0.01 and 0.99.';
  }

  try {
    let negRisk: boolean | undefined;
    try {
      const { checkPolymarketNegRisk } = await import('../../../execution');
      negRisk = await checkPolymarketNegRisk(tokenId);
    } catch {
      // Neg risk check not critical
    }

    const result = await exec.sellLimit({
      platform: 'polymarket',
      marketId: tokenId,
      tokenId,
      price,
      size,
      negRisk,
    });

    if (result.success) {
      return [
        `SELL ${size} shares @ ${(price * 100).toFixed(0)}c`,
        `Token: ${tokenId.slice(0, 20)}...`,
        `Order: ${result.orderId}`,
        result.transactionHash ? `Tx: ${result.transactionHash}` : '',
        negRisk ? '(neg-risk market)' : '',
      ].filter(Boolean).join('\n');
    }
    return `Order failed: ${result.error}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

async function handleOrders(): Promise<string> {
  const exec = getExecution();
  if (!exec) {
    return 'Set POLY_API_KEY, POLY_API_SECRET, and POLY_API_PASSPHRASE to view orders.';
  }

  try {
    const orders = await exec.getOpenOrders('polymarket');

    if (orders.length === 0) {
      return 'No open Polymarket orders';
    }

    const lines = ['**Polymarket Open Orders**', ''];

    for (const o of orders) {
      const tokenDisplay = o.tokenId ? o.tokenId.slice(0, 12) + '...' : o.marketId;
      lines.push(
        `  [${o.orderId.slice(0, 10)}...] ${o.side.toUpperCase()} @ ${(o.price * 100).toFixed(0)}c x ${o.remainingSize}/${o.originalSize}`
      );
      lines.push(`    Token: ${tokenDisplay} | Filled: ${o.filledSize}`);
    }

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

async function handleCancel(orderId: string): Promise<string> {
  const exec = getExecution();
  if (!exec) {
    return 'Set POLY_API_KEY, POLY_API_SECRET, and POLY_API_PASSPHRASE to cancel orders.';
  }

  if (!orderId) {
    return 'Usage: /poly cancel <order-id|all>';
  }

  try {
    if (orderId.toLowerCase() === 'all') {
      const count = await exec.cancelAllOrders('polymarket');
      return `Cancelled ${count} Polymarket order(s)`;
    }

    const success = await exec.cancelOrder('polymarket', orderId);
    return success ? `Order ${orderId} cancelled` : `Failed to cancel order ${orderId}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

async function handleBalance(): Promise<string> {
  // Polymarket balance = USDC on wallet
  const funderAddress = process.env.POLY_FUNDER_ADDRESS;
  if (!funderAddress) {
    return 'Set POLY_FUNDER_ADDRESS to check USDC balance.';
  }

  try {
    // Query USDC balance on Polygon via public RPC
    const USDC_CONTRACT = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC on Polygon
    const balanceData = `0x70a08231000000000000000000000000${funderAddress.slice(2).toLowerCase()}`;

    const response = await fetch('https://polygon-rpc.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: USDC_CONTRACT, data: balanceData }, 'latest'],
        id: 1,
      }),
    });

    const result = await response.json() as { result?: string };
    const rawBalance = parseInt(result.result || '0x0', 16);
    const balance = rawBalance / 1e6; // USDC has 6 decimals

    return [
      '**Polymarket Balance**',
      '',
      `Wallet: ${funderAddress.slice(0, 6)}...${funderAddress.slice(-4)}`,
      `USDC: $${formatNumber(balance)}`,
    ].join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error fetching balance: ${message}`;
  }
}

async function handleWhales(): Promise<string> {
  try {
    // Use the whale tracker module if available
    const { createWhaleTracker } = await import('../../../feeds/polymarket/whale-tracker');
    const tracker = createWhaleTracker();

    // Start the tracker to collect trades
    if (!tracker.isRunning()) {
      await tracker.start();
    }

    // Get recent whale trades
    const trades = tracker.getRecentTrades(10);
    if (!trades || trades.length === 0) {
      // Fall back to top whales
      const topWhales = tracker.getTopWhales(5);
      if (topWhales.length === 0) {
        return 'No whale activity detected yet. The tracker is now running and will collect data.';
      }

      const lines = ['**Top Whales**', ''];
      for (const w of topWhales) {
        lines.push(`  ${w.address.slice(0, 10)}... | $${formatNumber(w.totalValue)} | WR: ${(w.winRate * 100).toFixed(0)}%`);
        lines.push(`    Positions: ${w.positions.length} | Last active: ${w.lastActive.toLocaleTimeString()}`);
      }
      return lines.join('\n');
    }

    const lines = ['**Recent Whale Trades**', ''];
    for (const t of trades) {
      lines.push(`  ${t.side.toUpperCase()} $${formatNumber(t.usdValue)} @ ${(t.price * 100).toFixed(0)}c`);
      lines.push(`    ${t.outcome} on ${t.marketQuestion || t.marketId.slice(0, 20) + '...'}`);
      lines.push(`    Maker: ${t.maker.slice(0, 10)}... | ${new Date(t.timestamp).toLocaleTimeString()}`);
    }

    return lines.join('\n');
  } catch {
    return 'Whale tracking not available. The whale-tracker module may not be configured.';
  }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    switch (cmd) {
      case 'search':
      case 's':
        return handleSearch(parts.slice(1).join(' '));

      case 'market':
      case 'm':
        return handleMarket(parts[1]);

      case 'book':
      case 'orderbook':
      case 'ob':
        return handleOrderbook(parts[1]);

      case 'buy':
      case 'b':
        return handleBuy(parts[1], parts[2], parts[3]);

      case 'sell':
        return handleSell(parts[1], parts[2], parts[3]);

      case 'positions':
      case 'pos':
      case 'orders':
      case 'o':
        return handleOrders();

      case 'cancel':
        return handleCancel(parts[1]);

      case 'balance':
      case 'bal':
        return handleBalance();

      case 'whales':
      case 'whale':
        return handleWhales();

      case 'help':
      default:
        return helpText();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, args }, 'Polymarket command failed');
    return `Error: ${message}`;
  }
}

export default {
  name: 'trading-polymarket',
  description: 'Polymarket trading - CLOB orders, positions, orderbooks',
  commands: ['/poly', '/trading-polymarket'],
  handle: execute,
};
