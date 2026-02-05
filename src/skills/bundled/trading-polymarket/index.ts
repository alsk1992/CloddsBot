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
import type { TwapOrder, BracketOrder, TriggerOrderManager, AutoRedeemer } from '../../../execution';
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

// Advanced order state
const activeTwaps = new Map<string, TwapOrder>();
const activeBrackets = new Map<string, BracketOrder>();
let triggerManager: TriggerOrderManager | null = null;
let autoRedeemer: AutoRedeemer | null = null;
let nextOrderId = 1;

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
    '**Advanced Orders:**',
    '  /poly redeem                              - Redeem all resolved positions',
    '  /poly redeem <cond-id> <token-id>         - Redeem specific position',
    '  /poly twap <buy|sell> <token> <total> <price> [slices] [interval-sec]',
    '  /poly twap status                         - Active TWAP progress',
    '  /poly twap cancel <id>                    - Cancel a TWAP',
    '  /poly bracket <token> <size> <tp> <sl>    - TP + SL bracket',
    '  /poly bracket status                      - Active brackets',
    '  /poly bracket cancel <id>                 - Cancel a bracket',
    '  /poly trigger buy <token> <size> <price> [limit]  - Buy when price drops',
    '  /poly trigger sell <token> <size> <price> [limit] - Sell when price rises',
    '  /poly trigger cancel <id>                 - Cancel a trigger',
    '  /poly triggers                            - List active triggers',
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
// ADVANCED ORDER HANDLERS
// =============================================================================

async function handleRedeem(conditionId?: string, tokenId?: string): Promise<string> {
  const privateKey = process.env.POLY_PRIVATE_KEY;
  const funderAddress = process.env.POLY_FUNDER_ADDRESS;
  const apiKey = process.env.POLY_API_KEY;
  const apiSecret = process.env.POLY_API_SECRET;
  const passphrase = process.env.POLY_API_PASSPHRASE;

  if (!privateKey || !funderAddress || !apiKey || !apiSecret || !passphrase) {
    return 'Set POLY_PRIVATE_KEY, POLY_FUNDER_ADDRESS, POLY_API_KEY, POLY_API_SECRET, POLY_API_PASSPHRASE to redeem.';
  }

  try {
    if (!autoRedeemer) {
      const { createAutoRedeemer } = await import('../../../execution');
      autoRedeemer = createAutoRedeemer({
        polymarketAuth: { address: funderAddress, apiKey, apiSecret, apiPassphrase: passphrase },
        privateKey,
        funderAddress,
        dryRun: process.env.DRY_RUN === 'true',
      });
    }

    if (conditionId && tokenId) {
      const result = await autoRedeemer.redeemPosition(conditionId, tokenId);
      if (result.success) {
        return [
          '**Redemption Successful**',
          '',
          `Condition: ${result.conditionId}`,
          `Token: ${result.tokenId}`,
          `Shares: ${result.shares}`,
          `USDC: $${result.usdcRedeemed.toFixed(2)}`,
          result.txHash ? `Tx: ${result.txHash}` : '',
        ].filter(Boolean).join('\n');
      }
      return `Redemption failed: ${result.error}`;
    }

    const results = await autoRedeemer.redeemAll();
    if (results.length === 0) {
      return 'No resolved positions to redeem.';
    }

    const lines = ['**Redemption Results**', ''];
    for (const r of results) {
      const status = r.success ? 'OK' : 'FAIL';
      lines.push(`  [${status}] ${r.conditionId.slice(0, 12)}... | ${r.shares} shares | $${r.usdcRedeemed.toFixed(2)} USDC`);
      if (r.txHash) lines.push(`    Tx: ${r.txHash}`);
      if (r.error) lines.push(`    Error: ${r.error}`);
    }

    const successes = results.filter(r => r.success);
    const totalUsdc = successes.reduce((s, r) => s + r.usdcRedeemed, 0);
    lines.push('', `Total: ${successes.length}/${results.length} redeemed, $${totalUsdc.toFixed(2)} USDC`);

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

async function handleTwap(subCmdOrSide: string, tokenIdOrId?: string, totalStr?: string, priceStr?: string, slicesStr?: string, intervalStr?: string): Promise<string> {
  // Sub-commands: status, cancel
  if (subCmdOrSide === 'status') {
    if (activeTwaps.size === 0) return 'No active TWAP orders.';
    const lines = ['**Active TWAP Orders**', ''];
    for (const [id, twap] of activeTwaps) {
      const p = twap.getProgress();
      const pct = p.totalSize > 0 ? ((p.filledSize / p.totalSize) * 100).toFixed(0) : '0';
      lines.push(`  [${id}] ${pct}% filled | ${p.filledSize}/${p.totalSize} | ${p.slicesCompleted}/${p.slicesTotal} slices | avg ${(p.avgFillPrice * 100).toFixed(1)}c | ${p.status}`);
    }
    return lines.join('\n');
  }

  if (subCmdOrSide === 'cancel') {
    if (!tokenIdOrId) return 'Usage: /poly twap cancel <id>';
    const twap = activeTwaps.get(tokenIdOrId);
    if (!twap) return `TWAP order ${tokenIdOrId} not found. Active: ${[...activeTwaps.keys()].join(', ') || 'none'}`;
    await twap.cancel();
    activeTwaps.delete(tokenIdOrId);
    return `TWAP ${tokenIdOrId} cancelled.`;
  }

  // Create new TWAP: twap <buy|sell> <token> <total> <price> [slices] [interval-sec]
  const side = subCmdOrSide?.toLowerCase();
  if (side !== 'buy' && side !== 'sell') {
    return 'Usage: /poly twap <buy|sell> <token> <total> <price> [slices] [interval-sec]\n  /poly twap status\n  /poly twap cancel <id>';
  }

  const exec = getExecution();
  if (!exec) {
    return 'Set POLY_API_KEY, POLY_API_SECRET, and POLY_API_PASSPHRASE to trade.';
  }

  const tokenId = tokenIdOrId;
  if (!tokenId || !totalStr || !priceStr) {
    return 'Usage: /poly twap <buy|sell> <token> <total> <price> [slices] [interval-sec]';
  }

  const totalSize = parseFloat(totalStr);
  const price = parseFloat(priceStr);
  const slices = slicesStr ? parseInt(slicesStr, 10) : 5;
  const intervalSec = intervalStr ? parseInt(intervalStr, 10) : 30;

  if (isNaN(totalSize) || totalSize <= 0) return 'Invalid total size.';
  if (isNaN(price) || price < 0.01 || price > 0.99) return 'Invalid price (0.01-0.99).';
  if (isNaN(slices) || slices < 1) return 'Invalid slices count.';
  if (isNaN(intervalSec) || intervalSec < 1) return 'Invalid interval.';

  try {
    let negRisk: boolean | undefined;
    try {
      const { checkPolymarketNegRisk } = await import('../../../execution');
      negRisk = await checkPolymarketNegRisk(tokenId);
    } catch { /* non-critical */ }

    const { createTwapOrder } = await import('../../../execution');
    const id = `twap_${nextOrderId++}`;
    const sliceSize = totalSize / slices;

    const twap = createTwapOrder(
      exec,
      { platform: 'polymarket', marketId: tokenId, tokenId, side: side as 'buy' | 'sell', price, negRisk },
      { totalSize, sliceSize, intervalMs: intervalSec * 1000 }
    );

    activeTwaps.set(id, twap);

    twap.on('completed', () => { activeTwaps.delete(id); });
    twap.on('cancelled', () => { activeTwaps.delete(id); });

    twap.start();

    return `TWAP started: ${side.toUpperCase()} ${totalSize} shares @ ${(price * 100).toFixed(0)}c in ${slices} slices every ${intervalSec}s (ID: ${id})`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

async function handleBracket(subCmdOrToken: string, sizeStrOrId?: string, tpPriceStr?: string, slPriceStr?: string): Promise<string> {
  // Sub-commands: status, cancel
  if (subCmdOrToken === 'status') {
    if (activeBrackets.size === 0) return 'No active bracket orders.';
    const lines = ['**Active Bracket Orders**', ''];
    for (const [id, bracket] of activeBrackets) {
      const s = bracket.getStatus();
      lines.push(`  [${id}] TP: ${s.takeProfitOrderId?.slice(0, 10) || '—'}... | SL: ${s.stopLossOrderId?.slice(0, 10) || '—'}... | ${s.status}`);
      if (s.filledSide) lines.push(`    Filled: ${s.filledSide} @ ${s.fillPrice ? (s.fillPrice * 100).toFixed(1) + 'c' : '—'}`);
    }
    return lines.join('\n');
  }

  if (subCmdOrToken === 'cancel') {
    if (!sizeStrOrId) return 'Usage: /poly bracket cancel <id>';
    const bracket = activeBrackets.get(sizeStrOrId);
    if (!bracket) return `Bracket ${sizeStrOrId} not found. Active: ${[...activeBrackets.keys()].join(', ') || 'none'}`;
    await bracket.cancel();
    activeBrackets.delete(sizeStrOrId);
    return `Bracket ${sizeStrOrId} cancelled.`;
  }

  // Create new bracket: bracket <token> <size> <tp> <sl>
  const exec = getExecution();
  if (!exec) {
    return 'Set POLY_API_KEY, POLY_API_SECRET, and POLY_API_PASSPHRASE to trade.';
  }

  const tokenId = subCmdOrToken;
  if (!tokenId || !sizeStrOrId || !tpPriceStr || !slPriceStr) {
    return 'Usage: /poly bracket <token> <size> <tp-price> <sl-price>\n  /poly bracket status\n  /poly bracket cancel <id>';
  }

  const size = parseFloat(sizeStrOrId);
  const tpPrice = parseFloat(tpPriceStr);
  const slPrice = parseFloat(slPriceStr);

  if (isNaN(size) || size <= 0) return 'Invalid size.';
  if (isNaN(tpPrice) || tpPrice < 0.01 || tpPrice > 0.99) return 'Invalid take-profit price (0.01-0.99).';
  if (isNaN(slPrice) || slPrice < 0.01 || slPrice > 0.99) return 'Invalid stop-loss price (0.01-0.99).';

  try {
    let negRisk: boolean | undefined;
    try {
      const { checkPolymarketNegRisk } = await import('../../../execution');
      negRisk = await checkPolymarketNegRisk(tokenId);
    } catch { /* non-critical */ }

    const { createBracketOrder } = await import('../../../execution');
    const id = `bracket_${nextOrderId++}`;

    const bracket = createBracketOrder(exec, {
      platform: 'polymarket',
      marketId: tokenId,
      tokenId,
      size,
      side: 'long',
      takeProfitPrice: tpPrice,
      stopLossPrice: slPrice,
      negRisk,
    });

    activeBrackets.set(id, bracket);

    bracket.on('take_profit_hit', () => { activeBrackets.delete(id); });
    bracket.on('stop_loss_hit', () => { activeBrackets.delete(id); });
    bracket.on('cancelled', () => { activeBrackets.delete(id); });

    await bracket.start();

    return `Bracket set: TP @ ${(tpPrice * 100).toFixed(0)}c / SL @ ${(slPrice * 100).toFixed(0)}c for ${size} shares (ID: ${id})`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

async function handleTrigger(subCmd: string, args: string[]): Promise<string> {
  // List triggers
  if (subCmd === 'list' || !subCmd) {
    if (!triggerManager) return 'No trigger orders. Use /poly trigger buy or /poly trigger sell to create one.';
    const triggers = triggerManager.getTriggers();
    if (triggers.length === 0) return 'No trigger orders.';

    const lines = ['**Trigger Orders**', ''];
    for (const t of triggers) {
      const cond = t.config.condition;
      const condStr = cond.type === 'price_below' ? `<= ${(cond.price * 100).toFixed(0)}c`
        : cond.type === 'price_above' ? `>= ${(cond.price * 100).toFixed(0)}c`
        : cond.type === 'price_cross' ? `cross ${(cond.price * 100).toFixed(0)}c ${cond.direction}`
        : `spread < ${cond.maxSpread}`;
      const { order } = t.config;
      lines.push(`  [${t.id}] ${order.side.toUpperCase()} ${order.size} when ${condStr} | ${t.status}`);
      lines.push(`    Token: ${(t.config.tokenId || t.config.marketId).slice(0, 20)}...`);
      if (t.triggeredAt) lines.push(`    Triggered: ${t.triggeredAt.toLocaleTimeString()}`);
    }
    return lines.join('\n');
  }

  // Cancel trigger
  if (subCmd === 'cancel') {
    if (!args[0]) return 'Usage: /poly trigger cancel <trigger-id>';
    if (!triggerManager) return 'No active trigger manager.';
    triggerManager.cancelTrigger(args[0]);
    return `Trigger ${args[0]} cancelled.`;
  }

  // Create trigger: buy/sell <token> <size> <trigger-price> [limit-price]
  const side = subCmd.toLowerCase();
  if (side !== 'buy' && side !== 'sell') {
    return [
      'Usage:',
      '  /poly trigger buy <token> <size> <trigger-price> [limit-price]',
      '  /poly trigger sell <token> <size> <trigger-price> [limit-price]',
      '  /poly trigger cancel <trigger-id>',
      '  /poly triggers  (or /poly trigger list)',
    ].join('\n');
  }

  const exec = getExecution();
  if (!exec) {
    return 'Set POLY_API_KEY, POLY_API_SECRET, and POLY_API_PASSPHRASE to trade.';
  }

  const [tokenId, sizeStr, triggerPriceStr, limitPriceStr] = args;
  if (!tokenId || !sizeStr || !triggerPriceStr) {
    return `Usage: /poly trigger ${side} <token> <size> <trigger-price> [limit-price]`;
  }

  const size = parseFloat(sizeStr);
  const triggerPrice = parseFloat(triggerPriceStr);
  const limitPrice = limitPriceStr ? parseFloat(limitPriceStr) : undefined;

  if (isNaN(size) || size <= 0) return 'Invalid size.';
  if (isNaN(triggerPrice) || triggerPrice < 0.01 || triggerPrice > 0.99) return 'Invalid trigger price (0.01-0.99).';
  if (limitPrice !== undefined && (isNaN(limitPrice) || limitPrice < 0.01 || limitPrice > 0.99)) return 'Invalid limit price (0.01-0.99).';

  try {
    if (!triggerManager) {
      const feed = await getFeed();
      const { createTriggerOrderManager } = await import('../../../execution');
      triggerManager = createTriggerOrderManager(exec, feed);
      triggerManager.start();
    }

    const conditionType = side === 'buy' ? 'price_below' : 'price_above';

    const triggerId = triggerManager.addTrigger({
      platform: 'polymarket',
      marketId: tokenId,
      tokenId,
      condition: { type: conditionType, price: triggerPrice },
      order: {
        side: side as 'buy' | 'sell',
        size,
        price: limitPrice,
      },
    });

    const condDesc = side === 'buy'
      ? `price <= ${(triggerPrice * 100).toFixed(0)}c`
      : `price >= ${(triggerPrice * 100).toFixed(0)}c`;
    const limitDesc = limitPrice ? ` @ ${(limitPrice * 100).toFixed(0)}c limit` : ' (market)';

    return `Trigger set: ${side.toUpperCase()} ${size} shares when ${condDesc}${limitDesc} (ID: ${triggerId})`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
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

      case 'redeem':
        return handleRedeem(parts[1], parts[2]);

      case 'twap':
        return handleTwap(parts[1], parts[2], parts[3], parts[4], parts[5], parts[6]);

      case 'bracket':
        return handleBracket(parts[1], parts[2], parts[3], parts[4]);

      case 'trigger':
        return handleTrigger(parts[1], parts.slice(2));

      case 'triggers':
        return handleTrigger('list', []);

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
