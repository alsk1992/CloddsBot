/**
 * Hyperliquid Skill
 *
 * CLI commands for the dominant perps DEX.
 */

import * as hl from '../../../exchanges/hyperliquid';
import { logger } from '../../../utils/logger';
import { initDatabase, type HyperliquidTrade, type HyperliquidPosition, type HyperliquidFunding } from '../../../db';

// =============================================================================
// HELPERS
// =============================================================================

function formatNumber(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(decimals) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(decimals) + 'K';
  return n.toFixed(decimals);
}

function formatPct(n: number): string {
  return (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function getConfig(): hl.HyperliquidConfig | null {
  const wallet = process.env.HYPERLIQUID_WALLET;
  const privateKey = process.env.HYPERLIQUID_PRIVATE_KEY;

  if (!wallet || !privateKey) return null;

  return {
    walletAddress: wallet,
    privateKey,
    dryRun: process.env.DRY_RUN === 'true',
  };
}

function getUserId(): string {
  // Use wallet address as user ID for CLI
  return process.env.HYPERLIQUID_WALLET || 'default';
}

async function logTrade(trade: Omit<HyperliquidTrade, 'userId'>): Promise<void> {
  try {
    const db = await initDatabase();
    db.logHyperliquidTrade({ ...trade, userId: getUserId() });
  } catch (e) {
    logger.warn({ error: e }, 'Failed to log trade to database');
  }
}

async function logPosition(position: Omit<HyperliquidPosition, 'userId'>): Promise<void> {
  try {
    const db = await initDatabase();
    db.upsertHyperliquidPosition(getUserId(), { ...position, userId: getUserId() });
  } catch (e) {
    logger.warn({ error: e }, 'Failed to log position to database');
  }
}

async function logFunding(funding: Omit<HyperliquidFunding, 'userId'>): Promise<void> {
  try {
    const db = await initDatabase();
    db.logHyperliquidFunding({ ...funding, userId: getUserId() });
  } catch (e) {
    logger.warn({ error: e }, 'Failed to log funding to database');
  }
}

// =============================================================================
// MARKET DATA HANDLERS
// =============================================================================

async function handleStats(): Promise<string> {
  const [hlpStats, funding, meta] = await Promise.all([
    hl.getHlpStats(),
    hl.getFundingRates(),
    hl.getPerpMeta(),
  ]);

  const lines = [
    '**Hyperliquid Stats**',
    '',
    `HLP TVL: $${formatNumber(hlpStats.tvl)}`,
    `HLP APR: ${hlpStats.apr24h.toFixed(2)}%`,
    `24h PnL: $${formatNumber(hlpStats.pnl24h)}`,
    '',
    `Markets: ${meta.universe.length} perps`,
    '',
    '**Top Funding Rates:**',
  ];

  const sorted = [...funding]
    .sort((a, b) => Math.abs(parseFloat(b.funding)) - Math.abs(parseFloat(a.funding)))
    .slice(0, 5);

  for (const f of sorted) {
    const rate = parseFloat(f.funding) * 100;
    const oi = parseFloat(f.openInterest);
    lines.push(`  ${f.coin}: ${rate >= 0 ? '+' : ''}${rate.toFixed(4)}% (OI: $${formatNumber(oi)})`);
  }

  return lines.join('\n');
}

async function handleMarkets(query?: string): Promise<string> {
  const [perpMeta, spotMeta, mids] = await Promise.all([
    hl.getPerpMeta(),
    hl.getSpotMeta(),
    hl.getAllMids(),
  ]);

  const lines = ['**Hyperliquid Markets**', ''];

  let perps = perpMeta.universe;
  if (query) {
    const q = query.toLowerCase();
    perps = perps.filter(p => p.name.toLowerCase().includes(q));
  }

  lines.push(`**Perpetuals (${perps.length}):**`);
  for (const p of perps.slice(0, 15)) {
    const price = parseFloat(mids[p.name] || '0');
    lines.push(`  ${p.name}: $${price.toFixed(2)} (${p.maxLeverage}x max)`);
  }

  if (perps.length > 15) {
    lines.push(`  ...and ${perps.length - 15} more`);
  }

  let spots = spotMeta.universe;
  if (query) {
    const q = query.toLowerCase();
    spots = spots.filter(s => s.name.toLowerCase().includes(q));
  }

  if (spots.length > 0) {
    lines.push('');
    lines.push(`**Spot (${spots.length}):**`);
    for (const s of spots.slice(0, 10)) {
      const price = parseFloat(mids[s.name] || '0');
      lines.push(`  ${s.name}: $${price.toFixed(4)}`);
    }
  }

  return lines.join('\n');
}

async function handlePrice(coin: string): Promise<string> {
  const [mids, meta] = await Promise.all([
    hl.getAllMids(),
    hl.getPerpMeta(),
  ]);

  const coinUpper = coin.toUpperCase();
  const price = mids[coinUpper];

  if (!price) {
    return `Market ${coinUpper} not found`;
  }

  const asset = meta.universe.find(a => a.name === coinUpper);

  return [
    `**${coinUpper}**`,
    `Price: $${parseFloat(price).toFixed(2)}`,
    asset ? `Max Leverage: ${asset.maxLeverage}x` : '',
  ].filter(Boolean).join('\n');
}

async function handleOrderbook(coin: string): Promise<string> {
  const ob = await hl.getOrderbook(coin.toUpperCase());

  const lines = [
    `**${coin.toUpperCase()} Orderbook**`,
    '',
    'Asks:',
  ];

  for (const ask of ob.levels[1].slice(0, 5).reverse()) {
    lines.push(`  $${ask.price.toFixed(2)} | ${formatNumber(ask.size)} (${ask.numOrders})`);
  }

  lines.push('---');

  for (const bid of ob.levels[0].slice(0, 5)) {
    lines.push(`  $${bid.price.toFixed(2)} | ${formatNumber(bid.size)} (${bid.numOrders})`);
  }

  const spread = ob.levels[1][0]?.price && ob.levels[0][0]?.price
    ? ((ob.levels[1][0].price - ob.levels[0][0].price) / ob.levels[0][0].price * 100).toFixed(4)
    : '0';

  lines.push('');
  lines.push(`Spread: ${spread}%`);

  return lines.join('\n');
}

async function handleCandles(coin: string, interval?: string): Promise<string> {
  const tf = (interval as '1m' | '5m' | '15m' | '1h' | '4h' | '1d') || '1h';
  const candles = await hl.getCandles(coin.toUpperCase(), tf);

  if (candles.length === 0) {
    return `No candle data for ${coin}`;
  }

  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const change = prev ? ((latest.close - prev.close) / prev.close * 100) : 0;

  const lines = [
    `**${coin.toUpperCase()} (${tf})**`,
    '',
    `Price: $${latest.close.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`,
    `High: $${latest.high.toFixed(2)}`,
    `Low: $${latest.low.toFixed(2)}`,
    `Volume: $${formatNumber(latest.volume)}`,
    '',
    '**Recent:**',
  ];

  for (const c of candles.slice(-5)) {
    const time = new Date(c.time).toLocaleTimeString();
    const chg = ((c.close - c.open) / c.open * 100);
    lines.push(`  ${time}: $${c.close.toFixed(2)} (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%)`);
  }

  return lines.join('\n');
}

async function handleFunding(coin?: string): Promise<string> {
  if (coin) {
    const now = Date.now();
    const history = await hl.getFundingHistory(coin.toUpperCase(), now - 24 * 60 * 60 * 1000, now);

    if (history.length === 0) {
      return `No funding history for ${coin}`;
    }

    const lines = [
      `**${coin.toUpperCase()} Funding History (24h)**`,
      '',
    ];

    for (const f of history.slice(-8)) {
      const time = new Date(f.time).toLocaleTimeString();
      const rate = parseFloat(f.fundingRate) * 100;
      lines.push(`  ${time}: ${rate >= 0 ? '+' : ''}${rate.toFixed(4)}%`);
    }

    return lines.join('\n');
  }

  // Show predicted funding
  const [funding, predicted] = await Promise.all([
    hl.getFundingRates(),
    hl.getPredictedFundings(),
  ]);

  const lines = [
    '**Current Funding Rates**',
    '',
  ];

  const sorted = [...funding]
    .sort((a, b) => Math.abs(parseFloat(b.funding)) - Math.abs(parseFloat(a.funding)))
    .slice(0, 10);

  for (const f of sorted) {
    const rate = parseFloat(f.funding) * 100;
    const pred = predicted.find(p => p.coin === f.coin);
    const predRate = pred ? parseFloat(pred.predictedFunding) * 100 : 0;
    lines.push(`  ${f.coin}: ${rate >= 0 ? '+' : ''}${rate.toFixed(4)}% (pred: ${predRate >= 0 ? '+' : ''}${predRate.toFixed(4)}%)`);
  }

  lines.push('');
  lines.push('Use `/hl funding <coin>` for history');

  return lines.join('\n');
}

// =============================================================================
// ACCOUNT HANDLERS
// =============================================================================

async function handleBalance(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  const [state, spotBalances, points] = await Promise.all([
    hl.getUserState(config.walletAddress),
    hl.getSpotBalances(config.walletAddress),
    hl.getUserPoints(config.walletAddress),
  ]);

  const margin = state.marginSummary;
  const total = parseFloat(margin.accountValue);
  const used = parseFloat(margin.totalMarginUsed);

  const lines = [
    `**Hyperliquid Balance**`,
    `Wallet: ${config.walletAddress.slice(0, 6)}...${config.walletAddress.slice(-4)}`,
    '',
    '**Perps Account:**',
    `  Total: $${formatNumber(total)}`,
    `  Available: $${formatNumber(total - used)}`,
    `  Margin Used: $${formatNumber(used)}`,
  ];

  const positions = state.assetPositions.filter(ap => parseFloat(ap.position.szi) !== 0);
  if (positions.length > 0) {
    lines.push('');
    lines.push('**Positions:**');
    for (const ap of positions) {
      const p = ap.position;
      const size = parseFloat(p.szi);
      const pnl = parseFloat(p.unrealizedPnl);
      const side = size > 0 ? 'LONG' : 'SHORT';
      lines.push(`  ${p.coin} ${side}: ${Math.abs(size)} @ $${parseFloat(p.entryPx).toFixed(2)} (${pnl >= 0 ? '+' : ''}$${formatNumber(pnl)})`);
    }
  }

  const nonZeroSpot = spotBalances.filter(b => parseFloat(b.total) > 0);
  if (nonZeroSpot.length > 0) {
    lines.push('');
    lines.push('**Spot Balances:**');
    for (const b of nonZeroSpot) {
      lines.push(`  ${b.coin}: ${formatNumber(parseFloat(b.total))}`);
    }
  }

  if (points.total > 0) {
    lines.push('');
    lines.push(`**Points:** ${formatNumber(points.total)} (Rank #${points.rank || 'N/A'})`);
  }

  return lines.join('\n');
}

async function handlePortfolio(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  const portfolio = await hl.getUserPortfolio(config.walletAddress);

  return [
    '**Portfolio Summary**',
    '',
    `Account Value: $${formatNumber(parseFloat(portfolio.accountValue))}`,
    '',
    '**PnL:**',
    `  All Time: $${formatNumber(parseFloat(portfolio.pnl.allTime))}`,
    `  30 Days: $${formatNumber(parseFloat(portfolio.pnl.month))}`,
    `  7 Days: $${formatNumber(parseFloat(portfolio.pnl.week))}`,
    `  Today: $${formatNumber(parseFloat(portfolio.pnl.day))}`,
    '',
    '**Volume:**',
    `  All Time: $${formatNumber(parseFloat(portfolio.vlm.allTime))}`,
    `  30 Days: $${formatNumber(parseFloat(portfolio.vlm.month))}`,
  ].join('\n');
}

async function handleOrders(action?: string, ...args: string[]): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  if (action === 'cancel' && args[0]) {
    const [coin, oid] = args;
    if (!oid) {
      // Cancel all for coin
      const result = await hl.cancelAllOrders(config, coin.toUpperCase());
      return result.success ? `All ${coin.toUpperCase()} orders cancelled` : `Failed: ${result.error}`;
    }
    const result = await hl.cancelOrder(config, coin.toUpperCase(), parseInt(oid));
    return result.success ? `Order ${oid} cancelled` : `Failed: ${result.error}`;
  }

  if (action === 'cancelall') {
    const result = await hl.cancelAllOrders(config);
    return result.success ? 'All orders cancelled' : `Failed: ${result.error}`;
  }

  // List open orders
  const orders = await hl.getFrontendOpenOrders(config.walletAddress);

  if (orders.length === 0) {
    return 'No open orders';
  }

  const lines = ['**Open Orders**', ''];
  for (const o of orders.slice(0, 15)) {
    const time = formatTime(o.timestamp);
    const trigger = o.triggerPx ? ` trigger:$${o.triggerPx}` : '';
    lines.push(`  ${o.coin} ${o.side} ${o.sz}/${o.origSz} @ $${o.limitPx}${trigger}`);
    lines.push(`    ID: ${o.oid} | ${time}`);
  }

  if (orders.length > 15) {
    lines.push(`...and ${orders.length - 15} more`);
  }

  lines.push('');
  lines.push('Cancel: `/hl orders cancel <coin> [orderId]`');
  lines.push('Cancel all: `/hl orders cancelall`');

  return lines.join('\n');
}

async function handleFills(coin?: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  const fills = await hl.getUserFills(config.walletAddress);

  let filtered = fills;
  if (coin) {
    filtered = fills.filter(f => f.coin.toLowerCase() === coin.toLowerCase());
  }

  if (filtered.length === 0) {
    return coin ? `No fills for ${coin}` : 'No recent fills';
  }

  const lines = ['**Recent Fills**', ''];
  for (const f of filtered.slice(0, 10)) {
    const time = formatTime(f.time);
    const pnl = parseFloat(f.closedPnl);
    const pnlStr = pnl !== 0 ? ` PnL: ${pnl >= 0 ? '+' : ''}$${formatNumber(pnl)}` : '';
    lines.push(`  ${f.coin} ${f.side} ${f.sz} @ $${f.px}${pnlStr}`);
    lines.push(`    ${time} | Fee: $${f.fee}`);
  }

  return lines.join('\n');
}

async function handleHistory(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  const orders = await hl.getHistoricalOrders(config.walletAddress);

  if (orders.length === 0) {
    return 'No order history found';
  }

  const lines = ['**Order History**', ''];
  for (const o of orders.slice(0, 15)) {
    const time = formatTime(o.timestamp);
    lines.push(`  ${o.coin} ${o.side} ${o.sz} @ $${o.limitPx} - ${o.status}`);
    lines.push(`    ${time}`);
  }

  return lines.join('\n');
}

// =============================================================================
// TRADING HANDLERS
// =============================================================================

async function handleLong(coin: string, size: string, price?: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  if (!coin || !size) {
    return 'Usage: /hl long <coin> <size> [price]\nExample: /hl long BTC 0.1 45000';
  }

  const coinUpper = coin.toUpperCase();
  const sizeNum = parseFloat(size);
  const priceNum = price ? parseFloat(price) : undefined;
  const isLimit = !!priceNum;

  const result = await hl.placePerpOrder(config, {
    coin: coinUpper,
    side: 'BUY',
    size: sizeNum,
    price: priceNum,
    type: isLimit ? 'LIMIT' : 'MARKET',
  });

  if (result.success) {
    // Log trade to database
    const fillPrice = priceNum || (await hl.getAllMids())[coinUpper];
    const orderIdStr = result.orderId?.toString();
    await logTrade({
      tradeId: orderIdStr,
      orderId: orderIdStr,
      coin: coinUpper,
      side: 'BUY',
      direction: 'LONG',
      size: sizeNum,
      price: parseFloat(String(fillPrice || '0')),
      orderType: isLimit ? 'LIMIT' : 'MARKET',
      timestamp: new Date(),
    });

    return `LONG ${coinUpper} ${size} ${price ? `@ $${price}` : 'MARKET'} (ID: ${result.orderId})`;
  }
  return `Order failed: ${result.error}`;
}

async function handleShort(coin: string, size: string, price?: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  if (!coin || !size) {
    return 'Usage: /hl short <coin> <size> [price]\nExample: /hl short ETH 1 3000';
  }

  const coinUpper = coin.toUpperCase();
  const sizeNum = parseFloat(size);
  const priceNum = price ? parseFloat(price) : undefined;
  const isLimit = !!priceNum;

  const result = await hl.placePerpOrder(config, {
    coin: coinUpper,
    side: 'SELL',
    size: sizeNum,
    price: priceNum,
    type: isLimit ? 'LIMIT' : 'MARKET',
  });

  if (result.success) {
    // Log trade to database
    const fillPrice = priceNum || (await hl.getAllMids())[coinUpper];
    const orderIdStr = result.orderId?.toString();
    await logTrade({
      tradeId: orderIdStr,
      orderId: orderIdStr,
      coin: coinUpper,
      side: 'SELL',
      direction: 'SHORT',
      size: sizeNum,
      price: parseFloat(String(fillPrice || '0')),
      orderType: isLimit ? 'LIMIT' : 'MARKET',
      timestamp: new Date(),
    });

    return `SHORT ${coinUpper} ${size} ${price ? `@ $${price}` : 'MARKET'} (ID: ${result.orderId})`;
  }
  return `Order failed: ${result.error}`;
}

async function handleClose(coin: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  if (!coin) {
    return 'Usage: /hl close <coin>\nExample: /hl close BTC';
  }

  const coinUpper = coin.toUpperCase();
  const state = await hl.getUserState(config.walletAddress);
  const position = state.assetPositions.find(
    ap => ap.position.coin.toLowerCase() === coin.toLowerCase() && parseFloat(ap.position.szi) !== 0
  );

  if (!position) {
    return `No open position for ${coinUpper}`;
  }

  const p = position.position;
  const size = Math.abs(parseFloat(p.szi));
  const isLong = parseFloat(p.szi) > 0;
  const entryPrice = parseFloat(p.entryPx);
  const unrealizedPnl = parseFloat(p.unrealizedPnl);

  const result = await hl.placePerpOrder(config, {
    coin: coinUpper,
    side: isLong ? 'SELL' : 'BUY',
    size,
    type: 'MARKET',
    reduceOnly: true,
  });

  if (result.success) {
    // Log closing trade with PnL
    const mids = await hl.getAllMids();
    const closePrice = parseFloat(String(mids[coinUpper] || '0'));
    const orderIdStr = result.orderId?.toString();

    await logTrade({
      tradeId: orderIdStr,
      orderId: orderIdStr,
      coin: coinUpper,
      side: isLong ? 'SELL' : 'BUY',
      direction: isLong ? 'LONG' : 'SHORT',
      size,
      price: closePrice,
      closedPnl: unrealizedPnl,
      orderType: 'MARKET',
      timestamp: new Date(),
    });

    // Close position in database
    try {
      const db = await initDatabase();
      db.closeHyperliquidPosition(getUserId(), coinUpper, closePrice, 'manual');
    } catch (e) {
      logger.warn({ error: e }, 'Failed to close position in database');
    }

    const pnlStr = unrealizedPnl >= 0 ? `+$${unrealizedPnl.toFixed(2)}` : `-$${Math.abs(unrealizedPnl).toFixed(2)}`;
    return `Closed ${coinUpper} ${isLong ? 'LONG' : 'SHORT'} ${size} @ $${closePrice.toFixed(2)} (PnL: ${pnlStr})`;
  }
  return `Close failed: ${result.error}`;
}

async function handleCloseAll(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  const state = await hl.getUserState(config.walletAddress);
  const positions = state.assetPositions.filter(ap => parseFloat(ap.position.szi) !== 0);

  if (positions.length === 0) {
    return 'No open positions';
  }

  const mids = await hl.getAllMids();
  const results: string[] = [];
  let totalPnl = 0;

  for (const ap of positions) {
    const p = ap.position;
    const size = Math.abs(parseFloat(p.szi));
    const isLong = parseFloat(p.szi) > 0;
    const unrealizedPnl = parseFloat(p.unrealizedPnl);

    const result = await hl.placePerpOrder(config, {
      coin: p.coin,
      side: isLong ? 'SELL' : 'BUY',
      size,
      type: 'MARKET',
      reduceOnly: true,
    });

    if (result.success) {
      const closePrice = parseFloat(String(mids[p.coin] || '0'));
      totalPnl += unrealizedPnl;
      const orderIdStr = result.orderId?.toString();

      // Log closing trade
      await logTrade({
        tradeId: orderIdStr,
        orderId: orderIdStr,
        coin: p.coin,
        side: isLong ? 'SELL' : 'BUY',
        direction: isLong ? 'LONG' : 'SHORT',
        size,
        price: closePrice,
        closedPnl: unrealizedPnl,
        orderType: 'MARKET',
        timestamp: new Date(),
      });

      // Close position in database
      try {
        const db = await initDatabase();
        db.closeHyperliquidPosition(getUserId(), p.coin, closePrice, 'closeall');
      } catch (e) {
        logger.warn({ error: e }, 'Failed to close position in database');
      }

      const pnlStr = unrealizedPnl >= 0 ? `+$${unrealizedPnl.toFixed(2)}` : `-$${Math.abs(unrealizedPnl).toFixed(2)}`;
      results.push(`${p.coin}: closed (${pnlStr})`);
    } else {
      results.push(`${p.coin}: ${result.error}`);
    }
  }

  const totalStr = totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`;
  return ['**Closed Positions:**', '', ...results, '', `Total PnL: ${totalStr}`].join('\n');
}

async function handleLeverage(coin?: string, leverage?: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  if (!coin || !leverage) {
    return 'Usage: /hl leverage <coin> <leverage>\nExample: /hl leverage BTC 10';
  }

  const lev = parseInt(leverage);
  if (lev < 1 || lev > 50) {
    return 'Leverage must be between 1 and 50';
  }

  const result = await hl.updateLeverage(config, coin.toUpperCase(), lev);
  if (result.success) {
    return `${coin.toUpperCase()} leverage set to ${lev}x`;
  }
  return `Failed: ${result.error}`;
}

async function handleMargin(coin: string, amount: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  if (!coin || !amount) {
    return 'Usage: /hl margin <coin> <amount>\nPositive to add, negative to remove\nExample: /hl margin BTC 100';
  }

  const state = await hl.getUserState(config.walletAddress);
  const position = state.assetPositions.find(
    ap => ap.position.coin.toLowerCase() === coin.toLowerCase()
  );

  if (!position) {
    return `No position for ${coin.toUpperCase()}`;
  }

  const isBuy = parseFloat(position.position.szi) > 0;
  const result = await hl.updateIsolatedMargin(config, coin.toUpperCase(), isBuy, parseFloat(amount));

  if (result.success) {
    return `Margin ${parseFloat(amount) >= 0 ? 'added' : 'removed'} for ${coin.toUpperCase()}`;
  }
  return `Failed: ${result.error}`;
}

// =============================================================================
// TWAP HANDLERS
// =============================================================================

async function handleTwap(action?: string, ...args: string[]): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  if (action === 'buy' || action === 'sell') {
    const [coin, size, duration] = args;
    if (!coin || !size || !duration) {
      return `Usage: /hl twap ${action} <coin> <size> <minutes>\nExample: /hl twap buy BTC 1 60`;
    }

    const result = await hl.placeTwapOrder(config, {
      coin: coin.toUpperCase(),
      side: action === 'buy' ? 'BUY' : 'SELL',
      size: parseFloat(size),
      durationMinutes: parseInt(duration),
    });

    if (result.success) {
      return `TWAP ${action.toUpperCase()} ${coin.toUpperCase()} ${size} over ${duration}min (ID: ${result.twapId})`;
    }
    return `TWAP failed: ${result.error}`;
  }

  if (action === 'cancel' && args[0] && args[1]) {
    const [coin, twapId] = args;
    const result = await hl.cancelTwap(config, coin.toUpperCase(), twapId);
    if (result.success) {
      return `TWAP ${twapId} cancelled`;
    }
    return `Cancel failed: ${result.error}`;
  }

  if (action === 'status') {
    const fills = await hl.getUserTwapSliceFills(config.walletAddress);
    if (fills.length === 0) {
      return 'No active TWAP orders';
    }

    const lines = ['**TWAP Fills**', ''];
    for (const f of fills.slice(0, 10)) {
      lines.push(`  ${f.coin} ${f.side} ${f.sz} @ $${f.px} (ID: ${f.twapId})`);
    }
    return lines.join('\n');
  }

  return [
    '**TWAP Commands**',
    '',
    '/hl twap buy <coin> <size> <minutes>',
    '/hl twap sell <coin> <size> <minutes>',
    '/hl twap cancel <coin> <twapId>',
    '/hl twap status',
    '',
    'Example: /hl twap buy BTC 1 60',
  ].join('\n');
}

// =============================================================================
// SPOT HANDLERS
// =============================================================================

async function handleSpot(subcommand?: string, ...args: string[]): Promise<string> {
  const config = getConfig();

  if (subcommand === 'markets') {
    const meta = await hl.getSpotMeta();
    const mids = await hl.getAllMids();

    const lines = ['**Spot Markets**', ''];
    for (const m of meta.universe.slice(0, 20)) {
      const price = parseFloat(mids[m.name] || '0');
      lines.push(`  ${m.name}: $${price.toFixed(4)}`);
    }
    return lines.join('\n');
  }

  if (subcommand === 'book' && args[0]) {
    return handleOrderbook(args[0]);
  }

  if (subcommand === 'buy' || subcommand === 'sell') {
    if (!config) {
      return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
    }

    const [coin, amount, price] = args;
    if (!coin || !amount) {
      return `Usage: /hl spot ${subcommand} <coin> <amount> [price]`;
    }

    const result = await hl.placeSpotOrder(config, {
      coin: coin.toUpperCase(),
      side: subcommand === 'buy' ? 'BUY' : 'SELL',
      size: parseFloat(amount),
      price: price ? parseFloat(price) : 0,
      type: price ? 'LIMIT' : 'MARKET',
    });

    if (result.success) {
      return `Spot ${subcommand} ${coin.toUpperCase()} ${amount} ${price ? `@ $${price}` : 'MARKET'} (ID: ${result.orderId})`;
    }
    return `Order failed: ${result.error}`;
  }

  return [
    '**Spot Commands**',
    '',
    '/hl spot markets',
    '/hl spot book <coin>',
    '/hl spot buy <coin> <amount> [price]',
    '/hl spot sell <coin> <amount> [price]',
  ].join('\n');
}

// =============================================================================
// VAULT HANDLERS
// =============================================================================

async function handleHlp(action?: string, amount?: string): Promise<string> {
  const config = getConfig();

  if (!action || action === 'info') {
    const stats = await hl.getHlpStats();
    return [
      '**HLP Vault**',
      '',
      `TVL: $${formatNumber(stats.tvl)}`,
      `APR: ${stats.apr24h.toFixed(2)}%`,
      `24h PnL: $${formatNumber(stats.pnl24h)}`,
      '',
      '/hl hlp deposit <amount>',
      '/hl hlp withdraw <amount>',
    ].join('\n');
  }

  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  const amountNum = parseFloat(amount || '0');
  if (amountNum <= 0) {
    return 'Invalid amount';
  }

  if (action === 'deposit') {
    const result = await hl.depositToHlp(config, amountNum);
    return result.success ? `Deposited $${formatNumber(amountNum)} to HLP` : `Failed: ${result.error}`;
  }

  if (action === 'withdraw') {
    const result = await hl.withdrawFromHlp(config, amountNum);
    return result.success ? `Withdrew $${formatNumber(amountNum)} from HLP` : `Failed: ${result.error}`;
  }

  return 'Use: /hl hlp [deposit|withdraw] <amount>';
}

async function handleVaults(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  const equities = await hl.getUserVaultEquities(config.walletAddress);

  if (equities.length === 0) {
    return 'No vault positions. Use `/hl hlp deposit <amount>` to invest.';
  }

  const lines = ['**Your Vault Positions**', ''];
  for (const v of equities) {
    lines.push(`  ${v.vaultName}: $${formatNumber(parseFloat(v.equity))}`);
  }

  return lines.join('\n');
}

// =============================================================================
// TRANSFER HANDLERS
// =============================================================================

async function handleTransfer(action?: string, ...args: string[]): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  if (action === 'spot2perp') {
    const [amount] = args;
    if (!amount) return 'Usage: /hl transfer spot2perp <amount>';
    const result = await hl.transferBetweenSpotAndPerp(config, parseFloat(amount), true);
    return result.success ? `Transferred $${amount} to perps` : `Failed: ${result.error}`;
  }

  if (action === 'perp2spot') {
    const [amount] = args;
    if (!amount) return 'Usage: /hl transfer perp2spot <amount>';
    const result = await hl.transferBetweenSpotAndPerp(config, parseFloat(amount), false);
    return result.success ? `Transferred $${amount} to spot` : `Failed: ${result.error}`;
  }

  if (action === 'send') {
    const [address, amount] = args;
    if (!address || !amount) return 'Usage: /hl transfer send <address> <amount>';
    const result = await hl.usdTransfer(config, address, parseFloat(amount));
    return result.success ? `Sent $${amount} to ${address.slice(0, 8)}...` : `Failed: ${result.error}`;
  }

  if (action === 'withdraw') {
    const [address, amount] = args;
    if (!address || !amount) return 'Usage: /hl transfer withdraw <address> <amount>';
    const result = await hl.withdrawToL1(config, address, parseFloat(amount));
    return result.success ? `Withdrawal of $${amount} initiated` : `Failed: ${result.error}`;
  }

  return [
    '**Transfer Commands**',
    '',
    '/hl transfer spot2perp <amount>  - Move to perps',
    '/hl transfer perp2spot <amount>  - Move to spot',
    '/hl transfer send <addr> <amt>   - Send USDC on HL',
    '/hl transfer withdraw <addr> <amt> - Withdraw to L1',
  ].join('\n');
}

// =============================================================================
// INFO HANDLERS
// =============================================================================

async function handleFees(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  const [fees, rateLimit] = await Promise.all([
    hl.getUserFees(config.walletAddress),
    hl.getUserRateLimit(config.walletAddress),
  ]);

  return [
    '**Fees & Limits**',
    '',
    `Maker: ${(fees.makerRate * 100).toFixed(4)}%`,
    `Taker: ${(fees.takerRate * 100).toFixed(4)}%`,
    '',
    '**Rate Limits:**',
    `  ${rateLimit.nRequestsUsed}/${rateLimit.nRequestsCap} requests`,
    `  Volume: $${formatNumber(rateLimit.cumVlm)}`,
  ].join('\n');
}

async function handlePoints(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  const points = await hl.getUserPoints(config.walletAddress);

  return [
    '**Points**',
    '',
    `Total: ${formatNumber(points.total)}`,
    `Today: ${formatNumber(points.daily)}`,
    `Rank: #${points.rank || 'N/A'}`,
  ].join('\n');
}

async function handleReferral(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  const ref = await hl.getUserReferral(config.walletAddress);

  const lines = ['**Referral Info**', ''];

  if (ref.referralCode) {
    lines.push(`Your Code: ${ref.referralCode}`);
  }

  if (ref.referredBy) {
    lines.push(`Referred By: ${ref.referredBy.slice(0, 8)}...`);
  }

  lines.push('');
  lines.push(`Rebates Earned: $${formatNumber(parseFloat(ref.cumReferrerRebate))}`);
  lines.push(`Discount Received: $${formatNumber(parseFloat(ref.cumRefereeDiscount))}`);
  lines.push(`Unclaimed: $${formatNumber(parseFloat(ref.unclaimedRewards))}`);

  if (parseFloat(ref.unclaimedRewards) > 0) {
    lines.push('');
    lines.push('Use `/hl claim` to claim rewards');
  }

  return lines.join('\n');
}

async function handleClaim(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  const result = await hl.claimRewards(config);
  return result.success ? 'Rewards claimed!' : `Failed: ${result.error}`;
}

async function handleLeaderboard(timeframe?: string): Promise<string> {
  const tf = (timeframe as 'day' | 'week' | 'month' | 'allTime') || 'day';
  const leaders = await hl.getLeaderboard(tf);

  const lines = [
    `**Leaderboard (${tf})**`,
    '',
  ];

  for (let i = 0; i < Math.min(10, leaders.length); i++) {
    const l = leaders[i];
    lines.push(`${i + 1}. ${l.address.slice(0, 8)}... $${formatNumber(l.pnl)} (${formatPct(l.roi)})`);
  }

  return lines.join('\n');
}

async function handleSubaccounts(action?: string, ...args: string[]): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY';
  }

  if (action === 'create' && args[0]) {
    const result = await hl.createSubAccount(config, args[0]);
    return result.success ? `Subaccount created: ${result.subAccountUser}` : `Failed: ${result.error}`;
  }

  const subs = await hl.getSubAccounts(config.walletAddress);

  if (subs.length === 0) {
    return 'No subaccounts. Use `/hl sub create <name>` to create one.';
  }

  const lines = ['**Subaccounts**', ''];
  for (const s of subs) {
    lines.push(`  ${s.name}: ${s.subAccountUser.slice(0, 10)}...`);
  }

  return lines.join('\n');
}

// =============================================================================
// DATABASE QUERY HANDLERS
// =============================================================================

async function handleDbTrades(coin?: string, limit?: string): Promise<string> {
  const db = await initDatabase();
  const trades = db.getHyperliquidTrades(getUserId(), {
    coin: coin?.toUpperCase(),
    limit: limit ? parseInt(limit) : 20,
  });

  if (trades.length === 0) {
    return 'No trades in database';
  }

  const lines = ['**Trade History (DB)**', ''];
  for (const t of trades) {
    const pnlStr = t.closedPnl !== undefined
      ? ` PnL: ${t.closedPnl >= 0 ? '+' : ''}$${t.closedPnl.toFixed(2)}`
      : '';
    lines.push(
      `  ${t.timestamp.toLocaleDateString()} ${t.coin} ${t.direction || t.side} ${t.size} @ $${t.price.toFixed(2)}${pnlStr}`
    );
  }
  return lines.join('\n');
}

async function handleDbStats(coin?: string, period?: string): Promise<string> {
  const db = await initDatabase();

  let since: number | undefined;
  if (period) {
    const now = Date.now();
    if (period === 'day' || period === '1d') since = now - 24 * 60 * 60 * 1000;
    else if (period === 'week' || period === '7d') since = now - 7 * 24 * 60 * 60 * 1000;
    else if (period === 'month' || period === '30d') since = now - 30 * 24 * 60 * 60 * 1000;
  }

  const stats = db.getHyperliquidStats(getUserId(), {
    coin: coin?.toUpperCase(),
    since,
  });

  const fundingTotal = db.getHyperliquidFundingTotal(getUserId(), {
    coin: coin?.toUpperCase(),
    since,
  });

  const lines = [
    `**Trade Statistics${coin ? ` (${coin.toUpperCase()})` : ''}${period ? ` - ${period}` : ''}**`,
    '',
    `Total Trades: ${stats.totalTrades}`,
    `Total Volume: $${formatNumber(stats.totalVolume)}`,
    `Total Fees: $${stats.totalFees.toFixed(2)}`,
    `Total PnL: ${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}`,
    `Funding Paid: ${fundingTotal >= 0 ? '+' : ''}$${fundingTotal.toFixed(2)}`,
    '',
    `Win Rate: ${stats.winRate.toFixed(1)}% (${stats.winCount}W / ${stats.lossCount}L)`,
    `Avg Win: $${stats.avgWin.toFixed(2)}`,
    `Avg Loss: $${stats.avgLoss.toFixed(2)}`,
    `Largest Win: $${stats.largestWin.toFixed(2)}`,
    `Largest Loss: $${stats.largestLoss.toFixed(2)}`,
    `Profit Factor: ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}`,
  ];

  if (Object.keys(stats.byCoin).length > 1) {
    lines.push('', '**By Coin:**');
    for (const [c, data] of Object.entries(stats.byCoin)) {
      const pnlStr = data.pnl >= 0 ? '+' : '';
      lines.push(`  ${c}: ${data.trades} trades, ${pnlStr}$${data.pnl.toFixed(2)}`);
    }
  }

  return lines.join('\n');
}

async function handleDbFunding(coin?: string, limit?: string): Promise<string> {
  const db = await initDatabase();
  const funding = db.getHyperliquidFunding(getUserId(), {
    coin: coin?.toUpperCase(),
    limit: limit ? parseInt(limit) : 20,
  });

  if (funding.length === 0) {
    return 'No funding payments in database';
  }

  const lines = ['**Funding History (DB)**', ''];
  let total = 0;
  for (const f of funding) {
    total += f.payment;
    const payStr = f.payment >= 0 ? `+$${f.payment.toFixed(4)}` : `-$${Math.abs(f.payment).toFixed(4)}`;
    lines.push(
      `  ${f.timestamp.toLocaleDateString()} ${f.coin}: ${payStr} (rate: ${(f.fundingRate * 100).toFixed(4)}%)`
    );
  }
  lines.push('', `Total: ${total >= 0 ? '+' : ''}$${total.toFixed(2)}`);
  return lines.join('\n');
}

async function handleDbPositions(openOnly?: string): Promise<string> {
  const db = await initDatabase();
  const positions = db.getHyperliquidPositions(getUserId(), {
    openOnly: openOnly !== 'all',
  });

  if (positions.length === 0) {
    return 'No positions in database';
  }

  const lines = ['**Position History (DB)**', ''];
  for (const p of positions) {
    const status = p.closedAt ? `CLOSED @ $${p.closePrice?.toFixed(2)}` : 'OPEN';
    const pnl = p.closedAt ? p.realizedPnl : p.unrealizedPnl;
    const pnlStr = pnl !== undefined ? ` (${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})` : '';
    lines.push(
      `  ${p.coin} ${p.side} ${p.size} @ $${p.entryPrice.toFixed(2)} - ${status}${pnlStr}`
    );
  }
  return lines.join('\n');
}

async function handleBorrowLend(): Promise<string> {
  const reserves = await hl.getAllBorrowLendReserves();

  if (!reserves || reserves.length === 0) {
    return 'Borrow/Lend not available';
  }

  const lines = ['**Borrow/Lend Rates**', ''];
  for (const r of reserves.slice(0, 8)) {
    lines.push(`**${r.token}**`);
    lines.push(`  Supply: ${parseFloat(r.depositApy).toFixed(2)}% APY`);
    lines.push(`  Borrow: ${parseFloat(r.borrowApy).toFixed(2)}% APY`);
    lines.push(`  Util: ${(parseFloat(r.utilizationRate) * 100).toFixed(1)}%`);
    lines.push('');
  }

  return lines.join('\n');
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const skill = {
  name: 'hyperliquid',
  description: 'Hyperliquid perps DEX (69% market share)',
  commands: [
    {
      name: 'hl',
      description: 'Hyperliquid commands',
      usage: '/hl <command>',
    },
  ],
  requires: { env: ['HYPERLIQUID_PRIVATE_KEY'] },

  async handler(args: string): Promise<string> {
    const parts = args.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    try {
      switch (cmd) {
        // Market Data
        case 'stats':
        case '':
        case undefined:
          return handleStats();
        case 'markets':
        case 'm':
          return handleMarkets(parts[1]);
        case 'price':
        case 'p':
          return parts[1] ? handlePrice(parts[1]) : 'Usage: /hl price <coin>';
        case 'book':
        case 'ob':
          return parts[1] ? handleOrderbook(parts[1]) : 'Usage: /hl book <coin>';
        case 'candles':
        case 'chart':
        case 'c':
          return parts[1] ? handleCandles(parts[1], parts[2]) : 'Usage: /hl candles <coin> [interval]';
        case 'funding':
        case 'f':
          return handleFunding(parts[1]);

        // Account
        case 'balance':
        case 'bal':
        case 'b':
          return handleBalance();
        case 'portfolio':
        case 'pf':
          return handlePortfolio();
        case 'orders':
        case 'o':
          return handleOrders(parts[1], ...parts.slice(2));
        case 'fills':
          return handleFills(parts[1]);
        case 'history':
        case 'h':
          return handleHistory();

        // Trading
        case 'long':
        case 'l':
          return handleLong(parts[1], parts[2], parts[3]);
        case 'short':
        case 's':
          return handleShort(parts[1], parts[2], parts[3]);
        case 'close':
          return parts[1] ? handleClose(parts[1]) : 'Usage: /hl close <coin>';
        case 'closeall':
          return handleCloseAll();
        case 'leverage':
        case 'lev':
          return handleLeverage(parts[1], parts[2]);
        case 'margin':
          return handleMargin(parts[1], parts[2]);

        // TWAP
        case 'twap':
          return handleTwap(parts[1], ...parts.slice(2));

        // Spot
        case 'spot':
          return handleSpot(parts[1], ...parts.slice(2));

        // Vaults
        case 'hlp':
        case 'vault':
          return handleHlp(parts[1], parts[2]);
        case 'vaults':
          return handleVaults();

        // Transfers
        case 'transfer':
        case 'send':
          return handleTransfer(parts[1], ...parts.slice(2));

        // Info
        case 'fees':
          return handleFees();
        case 'points':
          return handlePoints();
        case 'referral':
        case 'ref':
          return handleReferral();
        case 'claim':
          return handleClaim();
        case 'leaderboard':
        case 'lb':
          return handleLeaderboard(parts[1]);
        case 'sub':
        case 'subaccounts':
          return handleSubaccounts(parts[1], ...parts.slice(2));
        case 'lend':
        case 'borrow':
          return handleBorrowLend();

        // Database queries
        case 'trades':
        case 'dbtrades':
          return handleDbTrades(parts[1], parts[2]);
        case 'dbstats':
        case 'tradestats':
          return handleDbStats(parts[1], parts[2]);
        case 'dbfunding':
          return handleDbFunding(parts[1], parts[2]);
        case 'dbpositions':
          return handleDbPositions(parts[1]);

        case 'help':
        default:
          return [
            '**Hyperliquid Commands**',
            '',
            '**Market Data:**',
            '  /hl stats          - HLP stats, funding rates',
            '  /hl markets [q]    - List markets',
            '  /hl price <coin>   - Get price',
            '  /hl book <coin>    - Orderbook',
            '  /hl candles <coin> - OHLCV data',
            '  /hl funding [coin] - Funding rates',
            '',
            '**Account:**',
            '  /hl balance        - Positions & balances',
            '  /hl portfolio      - PnL summary',
            '  /hl orders         - Open orders',
            '  /hl fills          - Recent fills',
            '  /hl history        - Order history',
            '',
            '**Trading:**',
            '  /hl long <coin> <size> [price]',
            '  /hl short <coin> <size> [price]',
            '  /hl close <coin>   - Close position',
            '  /hl closeall       - Close all positions',
            '  /hl leverage <coin> <x>',
            '  /hl twap [buy|sell] <coin> <size> <mins>',
            '',
            '**Transfers:**',
            '  /hl transfer spot2perp <amt>',
            '  /hl transfer send <addr> <amt>',
            '  /hl transfer withdraw <addr> <amt>',
            '',
            '**Other:**',
            '  /hl hlp [deposit|withdraw]',
            '  /hl spot [buy|sell]',
            '  /hl fees, points, referral, lb',
            '',
            '**Database/History:**',
            '  /hl trades [coin] [limit]  - Trade history',
            '  /hl dbstats [coin] [period] - Win rate, PnL stats',
            '  /hl dbfunding [coin]       - Funding payments',
            '  /hl dbpositions [all]      - Position history',
          ].join('\n');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, args }, 'Hyperliquid command failed');
      return `Error: ${message}`;
    }
  },
};

export default skill;
