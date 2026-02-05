/**
 * Trading Kalshi CLI Skill
 *
 * Wired to:
 *   - src/feeds/kalshi (createKalshiFeed - market data, orderbook, WebSocket)
 *   - src/execution (createExecutionService - order placement/cancellation)
 *
 * Commands:
 * /kalshi search <query>                    - Search Kalshi markets
 * /kalshi market <ticker>                   - Market details
 * /kalshi book <ticker>                     - View orderbook
 * /kalshi buy <ticker> <contracts> <price>  - Buy YES contracts
 * /kalshi sell <ticker> <contracts> <price> - Sell YES contracts
 * /kalshi positions                         - View open orders (positions)
 * /kalshi orders                            - View open orders
 * /kalshi cancel <order-id|all>             - Cancel orders
 * /kalshi balance                           - Account balance
 * /kalshi events [query]                    - Browse events
 * /kalshi event <event-ticker>              - Event details + markets
 */

import type { KalshiFeed, KalshiEventResult } from '../../../feeds/kalshi';
import type { ExecutionService, TwapOrder, BracketOrder } from '../../../execution';
import { logger } from '../../../utils/logger';

// Advanced order state
const activeTwaps = new Map<string, TwapOrder>();
const activeBrackets = new Map<string, BracketOrder>();
let nextOrderId = 1;

// =============================================================================
// HELPERS
// =============================================================================

function formatNumber(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(decimals) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(decimals) + 'K';
  return n.toFixed(decimals);
}

let feedInstance: KalshiFeed | null = null;
let execInstance: ExecutionService | null = null;

async function getCircuitBreaker() {
  const { getGlobalCircuitBreaker } = await import('../../../execution/circuit-breaker');
  return getGlobalCircuitBreaker();
}

async function getFeed(): Promise<KalshiFeed> {
  if (!feedInstance) {
    const { createKalshiFeed } = await import('../../../feeds/kalshi');
    feedInstance = await createKalshiFeed({
      apiKeyId: process.env.KALSHI_API_KEY_ID,
      privateKeyPem: process.env.KALSHI_PRIVATE_KEY,
      privateKeyPath: process.env.KALSHI_PRIVATE_KEY_PATH,
    });
    await feedInstance.connect();
  }
  return feedInstance;
}

function getExecution(): ExecutionService | null {
  if (!execInstance) {
    const apiKeyId = process.env.KALSHI_API_KEY_ID;
    const privateKeyPem = process.env.KALSHI_PRIVATE_KEY;

    if (!apiKeyId || !privateKeyPem) return null;

    try {
      const { createExecutionService } = require('../../../execution');
      const { normalizeKalshiPrivateKey } = require('../../../utils/kalshi-auth');
      execInstance = createExecutionService({
        kalshi: {
          apiKeyId,
          privateKeyPem: normalizeKalshiPrivateKey(privateKeyPem),
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
    '**Kalshi Trading Commands**',
    '',
    '**Market Data:**',
    '  /kalshi search <query>                    - Search markets',
    '  /kalshi market <ticker>                   - Market details',
    '  /kalshi book <ticker>                     - View orderbook',
    '  /kalshi events [query]                    - Browse events',
    '  /kalshi event <event-ticker>              - Event details + markets',
    '',
    '**Trading:**',
    '  /kalshi buy <ticker> <contracts> <price>  - Buy YES contracts',
    '  /kalshi sell <ticker> <contracts> <price> - Sell YES contracts',
    '  /kalshi orders                            - Open orders',
    '  /kalshi cancel <order-id>                 - Cancel order',
    '  /kalshi cancel all                        - Cancel all orders',
    '',
    '**Advanced Orders:**',
    '  /kalshi twap <buy|sell> <ticker> <total> <price> [slices] [interval-sec]',
    '  /kalshi twap status                    - Active TWAP progress',
    '  /kalshi twap cancel <id>               - Cancel TWAP',
    '  /kalshi bracket <ticker> <size> <tp> <sl>',
    '  /kalshi bracket status                 - Active brackets',
    '  /kalshi bracket cancel <id>            - Cancel bracket',
    '',
    '**Cross-Platform:**',
    '  /kalshi route <ticker> <buy|sell> <size> - Compare prices across platforms',
    '',
    '**Env vars:** KALSHI_API_KEY_ID, KALSHI_PRIVATE_KEY (or KALSHI_PRIVATE_KEY_PATH)',
    '',
    '**Examples:**',
    '  /kalshi search bitcoin',
    '  /kalshi buy KXBTC-24JAN01 10 0.65',
    '  /kalshi sell KXBTC-24JAN01 5 0.70',
  ].join('\n');
}

// =============================================================================
// MARKET DATA HANDLERS
// =============================================================================

async function handleSearch(query: string): Promise<string> {
  if (!query) return 'Usage: /kalshi search <query>';

  try {
    const feed = await getFeed();
    const markets = await feed.searchMarkets(query);

    if (markets.length === 0) {
      return `No Kalshi markets found for "${query}"`;
    }

    const lines = ['**Kalshi Markets**', ''];

    for (const m of markets.slice(0, 15)) {
      const yesPrice = m.outcomes.find(o => o.name === 'Yes')?.price || 0;
      const noPrice = m.outcomes.find(o => o.name === 'No')?.price || 0;
      lines.push(`  [${m.id}] ${m.question}`);
      lines.push(`       YES: ${(yesPrice * 100).toFixed(0)}c | NO: ${(noPrice * 100).toFixed(0)}c | Vol: $${formatNumber(m.volume24h)}`);
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

async function handleMarket(ticker: string): Promise<string> {
  if (!ticker) return 'Usage: /kalshi market <ticker>';

  try {
    const feed = await getFeed();
    const market = await feed.getMarket(ticker);

    if (!market) {
      return `Market ${ticker} not found`;
    }

    const lines = [
      `**${market.question}**`,
      '',
      `Ticker: ${market.id}`,
      `Platform: Kalshi`,
      market.description ? `Description: ${market.description}` : '',
      '',
      '**Outcomes:**',
    ];

    for (const o of market.outcomes) {
      lines.push(`  ${o.name}: ${(o.price * 100).toFixed(1)}c`);
    }

    lines.push(
      '',
      `Volume 24h: $${formatNumber(market.volume24h)}`,
      `Liquidity: $${formatNumber(market.liquidity)}`,
      market.endDate ? `Closes: ${market.endDate.toLocaleDateString()}` : '',
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

async function handleOrderbook(ticker: string): Promise<string> {
  if (!ticker) return 'Usage: /kalshi book <ticker>';

  try {
    const feed = await getFeed();
    const orderbook = await feed.getOrderbook(ticker);

    if (!orderbook) {
      return `No orderbook found for ${ticker}`;
    }

    const lines = [
      `**Orderbook: ${ticker}**`,
      '',
      `Mid: ${(orderbook.midPrice * 100).toFixed(1)}c | Spread: ${(orderbook.spread * 100).toFixed(2)}c`,
      '',
      '**Bids (YES):**',
    ];

    for (const [price, size] of orderbook.bids.slice(0, 5)) {
      lines.push(`  ${(price * 100).toFixed(1)}c - ${size.toFixed(0)} contracts`);
    }

    lines.push('', '**Asks (YES):**');

    for (const [price, size] of orderbook.asks.slice(0, 5)) {
      lines.push(`  ${(price * 100).toFixed(1)}c - ${size.toFixed(0)} contracts`);
    }

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

async function handleEvents(query?: string): Promise<string> {
  try {
    const feed = await getFeed();
    const events = await feed.getEvents({ status: 'open', limit: 20 });

    if (events.length === 0) {
      return 'No open Kalshi events found.';
    }

    // Filter by query if provided
    const filtered = query
      ? events.filter(e =>
          e.title.toLowerCase().includes(query.toLowerCase()) ||
          e.eventTicker.toLowerCase().includes(query.toLowerCase()) ||
          e.category.toLowerCase().includes(query.toLowerCase())
        )
      : events;

    if (filtered.length === 0) {
      return `No Kalshi events matching "${query}"`;
    }

    const lines = ['**Kalshi Events**', ''];

    for (const e of filtered.slice(0, 15)) {
      const marketCount = e.markets.length;
      lines.push(`  [${e.eventTicker}] ${e.title}`);
      lines.push(`       Category: ${e.category} | ${marketCount} market${marketCount !== 1 ? 's' : ''}`);
    }

    if (filtered.length > 15) {
      lines.push('', `...and ${filtered.length - 15} more`);
    }

    lines.push('', 'Use `/kalshi event <event-ticker>` to see markets in an event.');

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error fetching events: ${message}`;
  }
}

async function handleEvent(eventTicker: string): Promise<string> {
  if (!eventTicker) return 'Usage: /kalshi event <event-ticker>';

  try {
    const feed = await getFeed();
    const event = await feed.getEvent(eventTicker);

    if (!event) {
      return `Event ${eventTicker} not found`;
    }

    const lines = [
      `**${event.title}**`,
      '',
      `Event: ${event.eventTicker}`,
      `Category: ${event.category}`,
      '',
      `**Markets (${event.markets.length}):**`,
    ];

    for (const m of event.markets) {
      const yesPrice = m.outcomes.find(o => o.name === 'Yes')?.price || 0;
      const noPrice = m.outcomes.find(o => o.name === 'No')?.price || 0;
      const status = m.resolved ? '(resolved)' : '';
      lines.push(`  [${m.id}] ${m.question} ${status}`);
      lines.push(`       YES: ${(yesPrice * 100).toFixed(0)}c | NO: ${(noPrice * 100).toFixed(0)}c | Vol: $${formatNumber(m.volume24h)}`);
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

async function handleBuy(ticker: string, contractsStr: string, priceStr: string): Promise<string> {
  const exec = getExecution();
  if (!exec) {
    return 'Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY to trade on Kalshi.';
  }

  if (!ticker || !contractsStr || !priceStr) {
    return 'Usage: /kalshi buy <ticker> <contracts> <price>\nExample: /kalshi buy KXBTC-24JAN01 10 0.65';
  }

  const contracts = parseInt(contractsStr, 10);
  const price = parseFloat(priceStr);

  if (isNaN(contracts) || contracts <= 0) {
    return 'Invalid number of contracts. Must be a positive integer.';
  }

  if (isNaN(price) || price < 0.01 || price > 0.99) {
    return 'Invalid price. Must be between 0.01 and 0.99 (e.g., 0.65 for 65c).';
  }

  try {
    const cb = await getCircuitBreaker();
    if (!cb.canTrade()) {
      const state = cb.getState();
      return `**Trade blocked** — Circuit breaker tripped: ${state.tripReason || 'unknown'}\nUse \`/risk reset\` to re-arm.`;
    }

    const result = await exec.buyLimit({
      platform: 'kalshi',
      marketId: ticker,
      outcome: 'yes',
      price,
      size: contracts,
    });

    cb.recordTrade({
      pnlUsd: 0,
      success: result.success,
      sizeUsd: contracts * price,
      error: result.error,
    });

    if (result.success) {
      try {
        const { getGlobalPositionManager } = await import('../../../execution/position-manager');
        const pm = getGlobalPositionManager();
        pm.updatePosition({
          platform: 'kalshi',
          marketId: ticker,
          tokenId: ticker,
          outcomeName: 'Yes',
          side: 'long',
          size: contracts,
          entryPrice: result.avgFillPrice || price,
          currentPrice: result.avgFillPrice || price,
          openedAt: new Date(),
        });
      } catch { /* position tracking non-critical */ }

      return `BUY YES ${contracts} contracts @ ${(price * 100).toFixed(0)}c on ${ticker} (Order: ${result.orderId})`;
    }
    return `Order failed: ${result.error}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

async function handleSell(ticker: string, contractsStr: string, priceStr: string): Promise<string> {
  const exec = getExecution();
  if (!exec) {
    return 'Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY to trade on Kalshi.';
  }

  if (!ticker || !contractsStr || !priceStr) {
    return 'Usage: /kalshi sell <ticker> <contracts> <price>\nExample: /kalshi sell KXBTC-24JAN01 5 0.70';
  }

  const contracts = parseInt(contractsStr, 10);
  const price = parseFloat(priceStr);

  if (isNaN(contracts) || contracts <= 0) {
    return 'Invalid number of contracts. Must be a positive integer.';
  }

  if (isNaN(price) || price < 0.01 || price > 0.99) {
    return 'Invalid price. Must be between 0.01 and 0.99.';
  }

  try {
    const cb = await getCircuitBreaker();
    if (!cb.canTrade()) {
      const state = cb.getState();
      return `**Trade blocked** — Circuit breaker tripped: ${state.tripReason || 'unknown'}\nUse \`/risk reset\` to re-arm.`;
    }

    const result = await exec.sellLimit({
      platform: 'kalshi',
      marketId: ticker,
      outcome: 'yes',
      price,
      size: contracts,
    });

    cb.recordTrade({
      pnlUsd: 0,
      success: result.success,
      sizeUsd: contracts * price,
      error: result.error,
    });

    if (result.success) {
      try {
        const { getGlobalPositionManager } = await import('../../../execution/position-manager');
        const pm = getGlobalPositionManager();
        const existing = pm.getPositionsByPlatform('kalshi')
          .find(p => p.tokenId === ticker && p.status === 'open');
        if (existing) {
          pm.closePosition(existing.id, result.avgFillPrice || price, 'manual');
        }
      } catch { /* position tracking non-critical */ }

      return `SELL YES ${contracts} contracts @ ${(price * 100).toFixed(0)}c on ${ticker} (Order: ${result.orderId})`;
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
    return 'Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY to view orders.';
  }

  try {
    const orders = await exec.getOpenOrders('kalshi');

    if (orders.length === 0) {
      return 'No open Kalshi orders';
    }

    const lines = ['**Kalshi Open Orders**', ''];

    for (const o of orders) {
      lines.push(
        `  [${o.orderId}] ${o.marketId} - ${o.side.toUpperCase()} ${o.outcome?.toUpperCase() || 'YES'} @ ${(o.price * 100).toFixed(0)}c x ${o.remainingSize}/${o.originalSize}`
      );
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
    return 'Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY to cancel orders.';
  }

  if (!orderId) {
    return 'Usage: /kalshi cancel <order-id|all>';
  }

  try {
    if (orderId.toLowerCase() === 'all') {
      const count = await exec.cancelAllOrders('kalshi');
      return `Cancelled ${count} Kalshi order(s)`;
    }

    const success = await exec.cancelOrder('kalshi', orderId);
    return success ? `Order ${orderId} cancelled` : `Failed to cancel order ${orderId}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

async function handleBalance(): Promise<string> {
  // Kalshi balance requires authenticated API call
  const apiKeyId = process.env.KALSHI_API_KEY_ID;
  const privateKeyPem = process.env.KALSHI_PRIVATE_KEY;

  if (!apiKeyId || !privateKeyPem) {
    return 'Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY to check balance.';
  }

  try {
    const { buildKalshiHeadersForUrl, normalizeKalshiPrivateKey } = await import('../../../utils/kalshi-auth');
    const auth = { apiKeyId, privateKeyPem: normalizeKalshiPrivateKey(privateKeyPem) };
    const url = 'https://api.elections.kalshi.com/trade-api/v2/portfolio/balance';
    const headers = buildKalshiHeadersForUrl(auth, 'GET', url);

    const response = await fetch(url, {
      headers: { ...headers, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return `Failed to fetch balance: HTTP ${response.status}`;
    }

    const data = await response.json() as { balance?: number; portfolio_value?: number };
    const balance = (data.balance || 0) / 100; // Kalshi returns cents
    const portfolioValue = (data.portfolio_value || 0) / 100;

    return [
      '**Kalshi Balance**',
      '',
      `Cash: $${formatNumber(balance)}`,
      `Portfolio: $${formatNumber(portfolioValue)}`,
      `Total: $${formatNumber(balance + portfolioValue)}`,
    ].join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error fetching balance: ${message}`;
  }
}

// =============================================================================
// ADVANCED ORDER HANDLERS
// =============================================================================

async function handleTwap(subCmdOrSide: string, ticker?: string, totalStr?: string, priceStr?: string, slicesStr?: string, intervalStr?: string): Promise<string> {
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
    if (!ticker) return 'Usage: /kalshi twap cancel <id>';
    const twap = activeTwaps.get(ticker);
    if (!twap) return `TWAP order ${ticker} not found. Active: ${[...activeTwaps.keys()].join(', ') || 'none'}`;
    await twap.cancel();
    activeTwaps.delete(ticker);
    return `TWAP ${ticker} cancelled.`;
  }

  // Create new TWAP: twap <buy|sell> <ticker> <total> <price> [slices] [interval-sec]
  const side = subCmdOrSide?.toLowerCase();
  if (side !== 'buy' && side !== 'sell') {
    return 'Usage: /kalshi twap <buy|sell> <ticker> <total> <price> [slices] [interval-sec]\n  /kalshi twap status\n  /kalshi twap cancel <id>';
  }

  const exec = getExecution();
  if (!exec) {
    return 'Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY to trade.';
  }

  if (!ticker || !totalStr || !priceStr) {
    return 'Usage: /kalshi twap <buy|sell> <ticker> <total> <price> [slices] [interval-sec]';
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
    const { createTwapOrder } = await import('../../../execution');
    const id = `twap_${nextOrderId++}`;

    const twap = createTwapOrder(
      exec,
      { platform: 'kalshi', marketId: ticker, tokenId: ticker, side: side as 'buy' | 'sell', price },
      { totalSize, sliceSize: totalSize / slices, intervalMs: intervalSec * 1000 }
    );

    activeTwaps.set(id, twap);

    twap.on('completed', () => { activeTwaps.delete(id); });
    twap.on('cancelled', () => { activeTwaps.delete(id); });

    twap.start();

    return `TWAP started: ${side.toUpperCase()} ${totalSize} contracts @ ${(price * 100).toFixed(0)}c on ${ticker} in ${slices} slices every ${intervalSec}s (ID: ${id})`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

async function handleBracket(subCmdOrTicker: string, sizeStrOrId?: string, tpPriceStr?: string, slPriceStr?: string): Promise<string> {
  // Sub-commands: status, cancel
  if (subCmdOrTicker === 'status') {
    if (activeBrackets.size === 0) return 'No active bracket orders.';
    const lines = ['**Active Bracket Orders**', ''];
    for (const [id, bracket] of activeBrackets) {
      const s = bracket.getStatus();
      lines.push(`  [${id}] TP: ${s.takeProfitOrderId?.slice(0, 10) || '—'}... | SL: ${s.stopLossOrderId?.slice(0, 10) || '—'}... | ${s.status}`);
      if (s.filledSide) lines.push(`    Filled: ${s.filledSide} @ ${s.fillPrice ? (s.fillPrice * 100).toFixed(1) + 'c' : '—'}`);
    }
    return lines.join('\n');
  }

  if (subCmdOrTicker === 'cancel') {
    if (!sizeStrOrId) return 'Usage: /kalshi bracket cancel <id>';
    const bracket = activeBrackets.get(sizeStrOrId);
    if (!bracket) return `Bracket ${sizeStrOrId} not found. Active: ${[...activeBrackets.keys()].join(', ') || 'none'}`;
    await bracket.cancel();
    activeBrackets.delete(sizeStrOrId);
    return `Bracket ${sizeStrOrId} cancelled.`;
  }

  // Create new bracket: bracket <ticker> <size> <tp> <sl>
  const exec = getExecution();
  if (!exec) {
    return 'Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY to trade.';
  }

  const ticker = subCmdOrTicker;
  if (!ticker || !sizeStrOrId || !tpPriceStr || !slPriceStr) {
    return 'Usage: /kalshi bracket <ticker> <size> <tp-price> <sl-price>\n  /kalshi bracket status\n  /kalshi bracket cancel <id>';
  }

  const size = parseFloat(sizeStrOrId);
  const tpPrice = parseFloat(tpPriceStr);
  const slPrice = parseFloat(slPriceStr);

  if (isNaN(size) || size <= 0) return 'Invalid size.';
  if (isNaN(tpPrice) || tpPrice < 0.01 || tpPrice > 0.99) return 'Invalid take-profit price (0.01-0.99).';
  if (isNaN(slPrice) || slPrice < 0.01 || slPrice > 0.99) return 'Invalid stop-loss price (0.01-0.99).';

  try {
    const { createBracketOrder } = await import('../../../execution');
    const id = `bracket_${nextOrderId++}`;

    const bracket = createBracketOrder(exec, {
      platform: 'kalshi',
      marketId: ticker,
      tokenId: ticker,
      size,
      side: 'long',
      takeProfitPrice: tpPrice,
      stopLossPrice: slPrice,
    });

    activeBrackets.set(id, bracket);

    bracket.on('take_profit_hit', () => { activeBrackets.delete(id); });
    bracket.on('stop_loss_hit', () => { activeBrackets.delete(id); });
    bracket.on('cancelled', () => { activeBrackets.delete(id); });

    await bracket.start();

    return `Bracket set: TP @ ${(tpPrice * 100).toFixed(0)}c / SL @ ${(slPrice * 100).toFixed(0)}c for ${size} contracts on ${ticker} (ID: ${id})`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

async function handleTrigger(_subCmd: string, _args: string[]): Promise<string> {
  return 'Trigger orders require real-time price feeds. Kalshi WebSocket only supports subscribed tickers.\n\nUse `/kalshi watch <ticker>` for polling or `/poly trigger` for Polymarket triggers with real-time WebSocket feeds.';
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

      case 'events':
        return handleEvents(parts.slice(1).join(' ') || undefined);

      case 'event':
      case 'e':
        return handleEvent(parts[1]);

      case 'twap':
        return handleTwap(parts[1], parts[2], parts[3], parts[4], parts[5], parts[6]);

      case 'bracket':
        return handleBracket(parts[1], parts[2], parts[3], parts[4]);

      case 'trigger':
      case 'triggers':
        return handleTrigger(parts[1], parts.slice(2));

      case 'route':
      case 'compare': {
        if (!parts[1] || !parts[2] || !parts[3]) {
          return 'Usage: /kalshi route <ticker> <buy|sell> <size>';
        }
        const routeMarketId = parts[1];
        const routeSide = parts[2] as 'buy' | 'sell';
        const routeSize = parseFloat(parts[3]);

        if (routeSide !== 'buy' && routeSide !== 'sell') return 'Side must be buy or sell.';
        if (isNaN(routeSize) || routeSize <= 0) return 'Invalid size.';

        try {
          const { createSmartRouter } = await import('../../../execution/smart-router');
          const { createFeedManager } = await import('../../../feeds/index');
          const feeds = await createFeedManager({
            polymarket: { enabled: true },
            kalshi: { enabled: true },
            manifold: { enabled: false },
            metaculus: { enabled: false },
            drift: { enabled: false },
            news: { enabled: false },
          } as any);
          const router = createSmartRouter(feeds, { mode: 'balanced' });
          const routeResult = await router.findBestRoute({ marketId: routeMarketId, side: routeSide, size: routeSize });

          let output = `**Route: ${routeSide.toUpperCase()} ${routeSize} on ${routeMarketId}**\n\n`;
          output += `Best: ${routeResult.bestRoute.platform} @ ${(routeResult.bestRoute.netPrice * 100).toFixed(1)}c\n`;
          output += `Fees: $${routeResult.bestRoute.estimatedFees.toFixed(4)}\n`;
          output += `Slippage: ${routeResult.bestRoute.slippage.toFixed(2)}%\n\n`;
          if (routeResult.allRoutes.length > 1) {
            output += `**All Platforms:**\n`;
            for (const r of routeResult.allRoutes) {
              output += `  ${r.platform}: ${(r.netPrice * 100).toFixed(1)}c (fees: $${r.estimatedFees.toFixed(4)})\n`;
            }
          }
          output += `\n${routeResult.recommendation}`;
          return output;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return `Route error: ${message}`;
        }
      }

      case 'circuit': {
        const cb = await getCircuitBreaker();
        const state = cb.getState();
        return `**Circuit Breaker**\n\n` +
          `Status: ${state.isTripped ? 'TRIPPED' : 'Armed'}\n` +
          `Session PnL: $${state.sessionPnL.toFixed(2)}\n` +
          `Daily trades: ${state.dailyTrades}\n` +
          `Consecutive losses: ${state.consecutiveLosses}\n` +
          `Error rate: ${(state.errorRate * 100).toFixed(0)}%\n` +
          (state.tripReason ? `Trip reason: ${state.tripReason}\n` : '') +
          `\nUse \`/risk trip\` / \`/risk reset\` to manually control.`;
      }

      case 'help':
      default:
        return helpText();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, args }, 'Kalshi command failed');
    return `Error: ${message}`;
  }
}

export default {
  name: 'trading-kalshi',
  description: 'Kalshi trading - search markets, place orders, manage positions',
  commands: ['/kalshi', '/trading-kalshi'],
  handle: execute,
};
