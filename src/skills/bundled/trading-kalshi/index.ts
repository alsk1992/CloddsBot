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
 * /kalshi book <ticker>                     - View orderbook (REST snapshot)
 * /kalshi buy <ticker> <contracts> <price>  - Buy YES contracts
 * /kalshi sell <ticker> <contracts> <price> - Sell YES contracts
 * /kalshi positions                         - View open orders (positions)
 * /kalshi orders                            - View open orders
 * /kalshi cancel <order-id|all>             - Cancel orders
 * /kalshi balance                           - Account balance
 * /kalshi events [query]                    - Browse events
 * /kalshi event <event-ticker>              - Event details + markets
 *
 * Real-Time Streaming (WebSocket):
 * /kalshi stream <ticker> [channels]        - Start streaming (ticker,trade,orderbook)
 * /kalshi stream-fills                      - Stream your order fills
 * /kalshi streams                           - List active streams
 * /kalshi unstream <ticker>                 - Stop streaming
 * /kalshi unstream-fills                    - Stop fill notifications
 * /kalshi realtime-book <ticker>            - Get real-time orderbook from WebSocket
 */

import type {
  KalshiFeed,
  KalshiEventResult,
  KalshiTradeEvent,
  KalshiOrderbookDelta,
  KalshiOrderbookSnapshot,
  KalshiFillEvent,
  KalshiChannel,
} from '../../../feeds/kalshi';
import type { ExecutionService, TwapOrder, BracketOrder, TriggerOrderManager } from '../../../execution';
import type { PriceUpdate } from '../../../types';
import { logger } from '../../../utils/logger';

// Advanced order state
const activeTwaps = new Map<string, TwapOrder>();
const activeBrackets = new Map<string, BracketOrder>();
let triggerManager: TriggerOrderManager | null = null;
let nextOrderId = 1;

// Polling-based price subscriptions for trigger orders
const priceSubscriptions = new Map<string, Set<(update: PriceUpdate) => void>>();
let pricePollingInterval: NodeJS.Timeout | null = null;
const PRICE_POLL_INTERVAL_MS = 5000; // Poll every 5 seconds

// Active stream subscriptions
interface StreamSubscription {
  ticker: string;
  channels: KalshiChannel[];
  startTime: number;
  messageCount: number;
}
const activeStreams = new Map<string, StreamSubscription>();
let fillsSubscribed = false;

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
// POLLING-BASED PRICE FEED FOR TRIGGERS
// =============================================================================

/**
 * Start polling prices for subscribed tickers
 */
function startPricePolling(): void {
  if (pricePollingInterval) return;

  pricePollingInterval = setInterval(async () => {
    if (priceSubscriptions.size === 0) return;

    const feed = await getFeed();

    for (const [ticker, callbacks] of priceSubscriptions) {
      try {
        const market = await feed.getMarket(ticker);
        if (!market) continue;

        const yesPrice = market.outcomes.find(o => o.name === 'Yes')?.price ?? 0;

        const update: PriceUpdate = {
          platform: 'kalshi',
          marketId: ticker,
          outcomeId: `${ticker}-yes`,
          price: yesPrice,
          timestamp: Date.now(),
        };

        for (const cb of callbacks) {
          try {
            cb(update);
          } catch (err) {
            logger.warn({ err, ticker }, 'Error in price callback');
          }
        }
      } catch (err) {
        logger.warn({ err, ticker }, 'Error polling Kalshi price');
      }
    }
  }, PRICE_POLL_INTERVAL_MS);

  logger.info('Kalshi price polling started');
}

/**
 * Stop price polling if no subscribers
 */
function stopPricePollingIfEmpty(): void {
  if (priceSubscriptions.size === 0 && pricePollingInterval) {
    clearInterval(pricePollingInterval);
    pricePollingInterval = null;
    logger.info('Kalshi price polling stopped');
  }
}

/**
 * Create a feed manager wrapper that provides subscribePrice for triggers
 */
function createPollingFeedManager() {
  return {
    subscribePrice: (
      _platform: string,
      marketId: string,
      callback: (update: PriceUpdate) => void
    ): (() => void) => {
      // Add subscription
      if (!priceSubscriptions.has(marketId)) {
        priceSubscriptions.set(marketId, new Set());
      }
      priceSubscriptions.get(marketId)!.add(callback);

      // Start polling if needed
      startPricePolling();

      // Return unsubscribe function
      return () => {
        const callbacks = priceSubscriptions.get(marketId);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) {
            priceSubscriptions.delete(marketId);
          }
        }
        stopPricePollingIfEmpty();
      };
    },
  };
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
    '  /kalshi trigger buy <ticker> <size> <price> [limit]  - Buy when price drops',
    '  /kalshi trigger sell <ticker> <size> <price> [limit] - Sell when price rises',
    '  /kalshi trigger list                   - Active triggers',
    '  /kalshi trigger cancel <id>            - Cancel trigger',
    '',
    '**Cross-Platform:**',
    '  /kalshi route <ticker> <buy|sell> <size> - Compare prices across platforms',
    '',
    '**Real-Time Streaming (WebSocket):**',
    '  /kalshi stream <ticker> [channels]       - Start streaming (ticker,trade,orderbook)',
    '  /kalshi stream-fills                     - Stream your order fills',
    '  /kalshi streams                          - List active streams',
    '  /kalshi unstream <ticker>                - Stop streaming a market',
    '  /kalshi unstream-fills                   - Stop fill notifications',
    '  /kalshi realtime-book <ticker>           - Get real-time orderbook from stream',
    '',
    '**Env vars:** KALSHI_API_KEY_ID, KALSHI_PRIVATE_KEY (or KALSHI_PRIVATE_KEY_PATH)',
    '',
    '**Examples:**',
    '  /kalshi search bitcoin',
    '  /kalshi buy KXBTC-24JAN01 10 0.65',
    '  /kalshi sell KXBTC-24JAN01 5 0.70',
    '  /kalshi stream KXBTC-24JAN01 ticker,trade',
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
// STREAMING HANDLERS (WebSocket)
// =============================================================================

async function handleStream(ticker: string, channelsArg?: string): Promise<string> {
  if (!ticker) {
    return 'Usage: /kalshi stream <ticker> [channels]\nChannels: ticker, trade, orderbook (comma-separated)\nExample: /kalshi stream KXBTC-24JAN01 ticker,trade';
  }

  const feed = await getFeed();

  // Parse channels (default to ticker only)
  const validChannels: KalshiChannel[] = ['ticker', 'orderbook_delta', 'trade', 'fill'];
  const requestedChannels: KalshiChannel[] = [];

  if (channelsArg) {
    const parts = channelsArg.toLowerCase().split(',').map(s => s.trim());
    for (const p of parts) {
      if (p === 'ticker' || p === 'price') requestedChannels.push('ticker');
      else if (p === 'orderbook' || p === 'book' || p === 'orderbook_delta') requestedChannels.push('orderbook_delta');
      else if (p === 'trade' || p === 'trades') requestedChannels.push('trade');
    }
  }

  const channels: KalshiChannel[] = requestedChannels.length > 0 ? requestedChannels : ['ticker'];

  // Check if already streaming
  const existing = activeStreams.get(ticker);
  if (existing) {
    // Add new channels to existing subscription
    const newChannels = channels.filter(c => !existing.channels.includes(c));
    if (newChannels.length === 0) {
      return `Already streaming ${ticker} with channels: ${existing.channels.join(', ')}`;
    }
    feed.subscribeToMarket(ticker, newChannels);
    existing.channels.push(...newChannels);
    return `Added channels [${newChannels.join(', ')}] to ${ticker} stream.\nActive channels: ${existing.channels.join(', ')}`;
  }

  // Subscribe with event handlers
  feed.subscribeToMarket(ticker, channels);

  // Track subscription
  activeStreams.set(ticker, {
    ticker,
    channels,
    startTime: Date.now(),
    messageCount: 0,
  });

  // Set up event listeners (only once per feed)
  setupStreamListeners(feed);

  const channelList = channels.join(', ');
  const notes: string[] = [];
  if (channels.includes('orderbook_delta')) {
    notes.push('orderbook_delta requires auth and will receive snapshot first');
  }

  return [
    `**Streaming ${ticker}**`,
    '',
    `Channels: ${channelList}`,
    `Started: ${new Date().toISOString()}`,
    '',
    'Events will be logged. Use `/kalshi streams` to check status.',
    'Use `/kalshi unstream ${ticker}` to stop.',
    notes.length > 0 ? `\nNote: ${notes.join(', ')}` : '',
  ].join('\n');
}

async function handleStreamFills(): Promise<string> {
  if (fillsSubscribed) {
    return 'Already subscribed to fill notifications.';
  }

  const feed = await getFeed();
  feed.subscribeToFills();
  fillsSubscribed = true;

  // Set up fill listener
  setupStreamListeners(feed);

  return [
    '**Subscribed to Order Fills**',
    '',
    'You will receive notifications when your orders fill.',
    'Use `/kalshi unstream-fills` to stop.',
  ].join('\n');
}

async function handleStreams(): Promise<string> {
  if (activeStreams.size === 0 && !fillsSubscribed) {
    return 'No active streams. Use `/kalshi stream <ticker>` to start.';
  }

  const lines = ['**Active Kalshi Streams**', ''];

  if (fillsSubscribed) {
    lines.push('**Fills:** Subscribed (account-wide)');
    lines.push('');
  }

  for (const [ticker, sub] of activeStreams) {
    const elapsed = Math.floor((Date.now() - sub.startTime) / 1000);
    lines.push(`**${ticker}**`);
    lines.push(`  Channels: ${sub.channels.join(', ')}`);
    lines.push(`  Running: ${elapsed}s`);
    lines.push(`  Messages: ${sub.messageCount}`);
  }

  return lines.join('\n');
}

async function handleUnstream(ticker: string): Promise<string> {
  if (!ticker) {
    return 'Usage: /kalshi unstream <ticker>';
  }

  const sub = activeStreams.get(ticker);
  if (!sub) {
    return `Not streaming ${ticker}. Use \`/kalshi streams\` to see active streams.`;
  }

  const feed = await getFeed();
  feed.unsubscribeFromMarket(ticker);
  activeStreams.delete(ticker);

  return `Stopped streaming ${ticker}. Received ${sub.messageCount} messages.`;
}

async function handleUnstreamFills(): Promise<string> {
  if (!fillsSubscribed) {
    return 'Not subscribed to fills.';
  }

  const feed = await getFeed();
  feed.unsubscribeFromFills();
  fillsSubscribed = false;

  return 'Unsubscribed from order fills.';
}

async function handleRealtimeBook(ticker: string): Promise<string> {
  if (!ticker) {
    return 'Usage: /kalshi realtime-book <ticker>\nRequires active orderbook stream. Use `/kalshi stream <ticker> orderbook` first.';
  }

  const feed = await getFeed();
  const ob = feed.getRealtimeOrderbook(ticker);

  if (!ob) {
    const sub = activeStreams.get(ticker);
    if (!sub || !sub.channels.includes('orderbook_delta')) {
      return `No real-time orderbook for ${ticker}. Start streaming with:\n/kalshi stream ${ticker} orderbook`;
    }
    return `Orderbook for ${ticker} is stale or not yet received. Wait for snapshot.`;
  }

  const lines = [
    `**Real-Time Orderbook: ${ticker}**`,
    '',
    `Mid: ${(ob.midPrice * 100).toFixed(1)}c | Spread: ${(ob.spread * 100).toFixed(2)}c`,
    '',
    '**Bids (YES)**',
  ];

  for (const [price, size] of ob.bids.slice(0, 5)) {
    lines.push(`  ${(price * 100).toFixed(0)}c: ${size}`);
  }

  lines.push('', '**Asks (YES)**');
  for (const [price, size] of ob.asks.slice(0, 5)) {
    lines.push(`  ${(price * 100).toFixed(0)}c: ${size}`);
  }

  lines.push('', `Updated: ${new Date(ob.timestamp).toISOString()}`);

  return lines.join('\n');
}

// Set up event listeners for streaming (only once)
let listenersSetup = false;
function setupStreamListeners(feed: KalshiFeed): void {
  if (listenersSetup) return;
  listenersSetup = true;

  feed.on('price', (update: { marketId: string; price: number; previousPrice?: number }) => {
    const sub = activeStreams.get(update.marketId);
    if (sub) {
      sub.messageCount++;
      logger.info({
        type: 'price',
        ticker: update.marketId,
        price: (update.price * 100).toFixed(1) + 'c',
        change: update.previousPrice ? ((update.price - update.previousPrice) * 100).toFixed(2) + 'c' : undefined,
      }, 'Kalshi price update');
    }
  });

  feed.on('trade', (trade: KalshiTradeEvent) => {
    const sub = activeStreams.get(trade.marketId);
    if (sub) {
      sub.messageCount++;
      logger.info({
        type: 'trade',
        ticker: trade.marketId,
        side: trade.side,
        price: (trade.price * 100).toFixed(1) + 'c',
        count: trade.count,
        taker: trade.takerSide,
      }, 'Kalshi trade');
    }
  });

  feed.on('orderbook_snapshot', (snap: KalshiOrderbookSnapshot) => {
    const sub = activeStreams.get(snap.marketId);
    if (sub) {
      sub.messageCount++;
      logger.info({
        type: 'orderbook_snapshot',
        ticker: snap.marketId,
        yesLevels: snap.yes.length,
        noLevels: snap.no.length,
        seq: snap.seq,
      }, 'Kalshi orderbook snapshot');
    }
  });

  feed.on('orderbook_delta', (delta: KalshiOrderbookDelta) => {
    const sub = activeStreams.get(delta.marketId);
    if (sub) {
      sub.messageCount++;
      // Only log significant deltas to avoid spam
      if (Math.abs(delta.delta) >= 10) {
        logger.debug({
          type: 'orderbook_delta',
          ticker: delta.marketId,
          side: delta.side,
          price: (delta.price * 100).toFixed(0) + 'c',
          delta: delta.delta,
          seq: delta.seq,
        }, 'Kalshi orderbook delta');
      }
    }
  });

  feed.on('fill', (fill: KalshiFillEvent) => {
    if (fillsSubscribed) {
      logger.info({
        type: 'fill',
        ticker: fill.marketId,
        orderId: fill.orderId,
        side: fill.side,
        action: fill.action,
        count: fill.count,
        price: (fill.price * 100).toFixed(1) + 'c',
        isTaker: fill.isTaker,
      }, 'Kalshi order filled');
    }
  });
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
  if (tpPrice <= slPrice) return 'Take-profit price must be higher than stop-loss price for a long bracket.';

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

async function handleTrigger(subCmd: string, args: string[]): Promise<string> {
  // List triggers
  if (subCmd === 'list' || !subCmd) {
    if (!triggerManager) return 'No trigger orders. Use `/kalshi trigger buy` or `/kalshi trigger sell` to create one.';
    const triggers = triggerManager.getTriggers();
    if (triggers.length === 0) return 'No trigger orders.';

    const lines = ['**Trigger Orders**', ''];
    for (const t of triggers) {
      const cond = t.config.condition;
      const condStr = cond.type === 'price_below' ? `≤ ${(cond.price * 100).toFixed(0)}c`
        : cond.type === 'price_above' ? `≥ ${(cond.price * 100).toFixed(0)}c`
        : `${cond.type}`;
      lines.push(`  [${t.id}] ${t.config.marketId} ${t.config.order.side.toUpperCase()} ${t.config.order.size} when ${condStr} | ${t.status}`);
    }
    return lines.join('\n');
  }

  // Cancel trigger
  if (subCmd === 'cancel') {
    if (!args[0]) return 'Usage: /kalshi trigger cancel <trigger-id>';
    if (!triggerManager) return 'No active trigger manager.';
    triggerManager.cancelTrigger(args[0]);
    return `Trigger ${args[0]} cancelled.`;
  }

  // Create trigger: /kalshi trigger buy <ticker> <size> <trigger-price> [limit-price]
  const side = subCmd?.toLowerCase();
  if (side !== 'buy' && side !== 'sell') {
    return [
      '**Trigger Order Usage:**',
      '  /kalshi trigger buy <ticker> <size> <trigger-price> [limit-price]',
      '  /kalshi trigger sell <ticker> <size> <trigger-price> [limit-price]',
      '  /kalshi trigger list',
      '  /kalshi trigger cancel <id>',
      '',
      'Polls price every 5s. Executes when price crosses trigger.',
      'Buy triggers when price ≤ trigger, sell triggers when price ≥ trigger.',
    ].join('\n');
  }

  const [ticker, sizeStr, triggerStr, limitStr] = args;
  if (!ticker || !sizeStr || !triggerStr) {
    return `Usage: /kalshi trigger ${side} <ticker> <size> <trigger-price> [limit-price]`;
  }

  const size = parseInt(sizeStr, 10);
  const triggerPrice = parseFloat(triggerStr) / 100; // Convert cents to decimal
  const limitPrice = limitStr ? parseFloat(limitStr) / 100 : undefined;

  if (isNaN(size) || size <= 0) return 'Invalid size.';
  if (isNaN(triggerPrice) || triggerPrice < 0.01 || triggerPrice > 0.99) return 'Invalid trigger price (1-99 cents).';
  if (limitPrice !== undefined && (isNaN(limitPrice) || limitPrice < 0.01 || limitPrice > 0.99)) return 'Invalid limit price (1-99 cents).';

  const exec = getExecution();
  if (!exec) return 'Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY to trade.';

  try {
    if (!triggerManager) {
      const { createTriggerOrderManager } = await import('../../../execution');
      const feedManager = createPollingFeedManager();
      triggerManager = createTriggerOrderManager(exec, feedManager);
      triggerManager.start();
    }

    const conditionType = side === 'buy' ? 'price_below' : 'price_above';

    const triggerId = triggerManager.addTrigger({
      platform: 'kalshi',
      marketId: ticker.toUpperCase(),
      outcome: 'yes',
      condition: { type: conditionType, price: triggerPrice },
      order: {
        side,
        size,
        price: limitPrice,
        orderType: limitPrice ? 'GTC' : 'FOK',
      },
      oneShot: true,
    });

    const actionStr = side === 'buy' ? 'drops to' : 'rises to';
    const priceStr = limitPrice
      ? `limit @ ${(limitPrice * 100).toFixed(0)}c`
      : 'market order';

    return [
      `**Trigger Created** (ID: ${triggerId})`,
      '',
      `${side.toUpperCase()} ${size} contracts of ${ticker.toUpperCase()}`,
      `When price ${actionStr} ${(triggerPrice * 100).toFixed(0)}c → ${priceStr}`,
      '',
      `Polling every ${PRICE_POLL_INTERVAL_MS / 1000}s. Use \`/kalshi trigger list\` to view.`,
    ].join('\n');
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

      // Streaming commands (WebSocket)
      case 'stream':
      case 'subscribe':
        return handleStream(parts[1], parts[2]);

      case 'stream-fills':
      case 'fills':
        return handleStreamFills();

      case 'streams':
      case 'subscriptions':
        return handleStreams();

      case 'unstream':
      case 'unsubscribe':
        return handleUnstream(parts[1]);

      case 'unstream-fills':
        return handleUnstreamFills();

      case 'realtime-book':
      case 'rtbook':
      case 'live-book':
        return handleRealtimeBook(parts[1]);

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
