/**
 * Binance Futures Skill
 *
 * CLI commands for Binance Futures with database tracking.
 */

import * as bf from '../../../exchanges/binance-futures';
import { logger } from '../../../utils/logger';
import {
  initDatabase,
  type BinanceFuturesTrade,
  type BinanceFuturesPosition,
  type BinanceFuturesFunding,
} from '../../../db';

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
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function formatTime(ts: number | Date): string {
  const date = ts instanceof Date ? ts : new Date(ts);
  return date.toLocaleString();
}

function getConfig(): bf.BinanceFuturesConfig | null {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return {
    apiKey,
    apiSecret,
    testnet: process.env.BINANCE_TESTNET === 'true',
    dryRun: process.env.DRY_RUN === 'true',
  };
}

function getUserId(): string {
  const apiKey = process.env.BINANCE_API_KEY || '';
  return apiKey.slice(0, 16) || 'default';
}

function getPeriodMs(period?: string): number | undefined {
  if (!period) return undefined;
  const now = Date.now();
  switch (period.toLowerCase()) {
    case 'day':
    case '1d':
      return now - 24 * 60 * 60 * 1000;
    case 'week':
    case '7d':
      return now - 7 * 24 * 60 * 60 * 1000;
    case 'month':
    case '30d':
      return now - 30 * 24 * 60 * 60 * 1000;
    default:
      return undefined;
  }
}

function parseLeverage(leverageStr?: string): number | undefined {
  if (!leverageStr) return undefined;
  const match = leverageStr.match(/^(\d+)x?$/i);
  return match ? parseInt(match[1], 10) : undefined;
}

async function logTrade(
  result: bf.OrderResult,
  direction: 'LONG' | 'SHORT',
  leverage?: number
): Promise<void> {
  try {
    const db = await initDatabase();
    db.logBinanceFuturesTrade({
      userId: getUserId(),
      orderId: result.orderId.toString(),
      symbol: result.symbol,
      side: result.side,
      positionSide: direction,
      size: result.executedQty,
      price: result.avgPrice || result.price,
      leverage,
      timestamp: new Date(),
    });
  } catch (e) {
    logger.warn({ error: e }, 'Failed to log trade');
  }
}

// =============================================================================
// ACCOUNT HANDLERS
// =============================================================================

async function handleBalance(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set BINANCE_API_KEY and BINANCE_API_SECRET to check balance';
  }

  const balances = await bf.getBalance(config);
  if (balances.length === 0) {
    return 'No balances found';
  }

  const lines = ['**Binance Futures Balance**', ''];
  for (const b of balances) {
    const pnl = b.unrealizedProfit !== 0 ? ` (uPnL: $${formatNumber(b.unrealizedProfit)})` : '';
    lines.push(`  ${b.asset}: $${formatNumber(b.balance)} (avail: $${formatNumber(b.availableBalance)})${pnl}`);
  }

  return lines.join('\n');
}

async function handlePositions(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set BINANCE_API_KEY and BINANCE_API_SECRET to view positions';
  }

  const positions = await bf.getPositions(config);
  if (positions.length === 0) {
    return 'No open positions';
  }

  const lines = ['**Binance Futures Positions**', ''];
  for (const p of positions) {
    const side = p.positionAmt > 0 ? '🟢 LONG' : '🔴 SHORT';
    const pnlPct = (p.unrealizedProfit / (Math.abs(p.positionAmt) * p.entryPrice)) * 100;
    lines.push(
      `  ${side} ${p.symbol} | ${Math.abs(p.positionAmt)} @ $${p.entryPrice.toFixed(2)} | ${p.leverage}x`
    );
    lines.push(
      `       Mark: $${p.markPrice.toFixed(2)} | PnL: $${formatNumber(p.unrealizedProfit)} (${formatPct(pnlPct)})`
    );
    if (p.liquidationPrice > 0) {
      lines.push(`       Liq: $${p.liquidationPrice.toFixed(2)}`);
    }
  }

  return lines.join('\n');
}

async function handleOrders(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set BINANCE_API_KEY and BINANCE_API_SECRET to view orders';
  }

  const orders = await bf.getOpenOrders(config);
  if (orders.length === 0) {
    return 'No open orders';
  }

  const lines = ['**Binance Futures Open Orders**', ''];
  for (const o of orders) {
    lines.push(
      `  [${o.orderId}] ${o.side} ${o.symbol} | ${o.origQty} @ $${o.price.toFixed(2)} | ${o.type}`
    );
  }

  return lines.join('\n');
}

// =============================================================================
// TRADING HANDLERS
// =============================================================================

async function handleLong(symbol?: string, sizeStr?: string, leverageStr?: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set BINANCE_API_KEY and BINANCE_API_SECRET to trade';
  }
  if (!symbol || !sizeStr) {
    return 'Usage: /bf long <symbol> <size> [leverage]x\nExample: /bf long BTCUSDT 0.01 10x';
  }

  const size = parseFloat(sizeStr);
  const leverage = parseLeverage(leverageStr);

  const result = await bf.openLong(config, symbol.toUpperCase(), size, leverage);
  await logTrade(result, 'LONG', leverage);

  const price = result.avgPrice || 'MARKET';
  return `🟢 LONG ${result.symbol} | ${result.executedQty} @ $${price} | Order: ${result.orderId}`;
}

async function handleShort(symbol?: string, sizeStr?: string, leverageStr?: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set BINANCE_API_KEY and BINANCE_API_SECRET to trade';
  }
  if (!symbol || !sizeStr) {
    return 'Usage: /bf short <symbol> <size> [leverage]x\nExample: /bf short BTCUSDT 0.01 10x';
  }

  const size = parseFloat(sizeStr);
  const leverage = parseLeverage(leverageStr);

  const result = await bf.openShort(config, symbol.toUpperCase(), size, leverage);
  await logTrade(result, 'SHORT', leverage);

  const price = result.avgPrice || 'MARKET';
  return `🔴 SHORT ${result.symbol} | ${result.executedQty} @ $${price} | Order: ${result.orderId}`;
}

async function handleClose(symbol?: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set BINANCE_API_KEY and BINANCE_API_SECRET to trade';
  }
  if (!symbol) {
    return 'Usage: /bf close <symbol>\nExample: /bf close BTCUSDT';
  }

  const result = await bf.closePosition(config, symbol.toUpperCase());
  if (!result) {
    return `No open position for ${symbol.toUpperCase()}`;
  }

  // Log as closing trade
  try {
    const db = await initDatabase();
    db.logBinanceFuturesTrade({
      userId: getUserId(),
      orderId: result.orderId.toString(),
      symbol: result.symbol,
      side: result.side,
      size: result.executedQty,
      price: result.avgPrice || result.price,
      timestamp: new Date(),
    });
  } catch (e) {
    logger.warn({ error: e }, 'Failed to log close trade');
  }

  return `Closed ${result.symbol} | ${result.executedQty} @ $${result.avgPrice || 'MARKET'}`;
}

async function handleCloseAll(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set BINANCE_API_KEY and BINANCE_API_SECRET to trade';
  }

  const results = await bf.closeAllPositions(config);
  if (results.length === 0) {
    return 'No positions to close';
  }

  const lines = ['**Closed Positions:**'];
  for (const r of results) {
    lines.push(`  ${r.symbol}: ${r.executedQty} @ $${r.avgPrice || 'MARKET'}`);
  }

  return lines.join('\n');
}

async function handleLeverage(symbol?: string, leverageStr?: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set BINANCE_API_KEY and BINANCE_API_SECRET to set leverage';
  }
  if (!symbol || !leverageStr) {
    return 'Usage: /bf leverage <symbol> <value>\nExample: /bf leverage BTCUSDT 10';
  }

  const leverage = parseInt(leverageStr, 10);
  await bf.setLeverage(config, symbol.toUpperCase(), leverage);
  return `Set ${symbol.toUpperCase()} leverage to ${leverage}x`;
}

// =============================================================================
// MARKET DATA HANDLERS
// =============================================================================

async function handlePrice(symbol?: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set BINANCE_API_KEY and BINANCE_API_SECRET';
  }
  if (!symbol) {
    return 'Usage: /bf price <symbol>\nExample: /bf price BTCUSDT';
  }

  const price = await bf.getPrice(config, symbol.toUpperCase());
  return `${symbol.toUpperCase()}: $${price.toFixed(2)}`;
}

async function handleFundingRate(symbol?: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set BINANCE_API_KEY and BINANCE_API_SECRET';
  }
  if (!symbol) {
    return 'Usage: /bf funding <symbol>\nExample: /bf funding BTCUSDT';
  }

  const data = await bf.getFundingRate(config, symbol.toUpperCase());
  const rate = (data.fundingRate * 100).toFixed(4);
  const annualized = (data.fundingRate * 100 * 3 * 365).toFixed(2);
  return `${symbol.toUpperCase()} Funding: ${rate}% (${annualized}% APR) | Mark: $${data.markPrice.toFixed(2)}`;
}

async function handleMarkets(query?: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'Set BINANCE_API_KEY and BINANCE_API_SECRET';
  }

  let markets = await bf.getMarkets(config);
  if (query) {
    const q = query.toUpperCase();
    markets = markets.filter(m => m.includes(q));
  }

  const lines = [`**Binance Futures Markets (${markets.length})**`, ''];
  for (const m of markets.slice(0, 30)) {
    lines.push(`  ${m}`);
  }
  if (markets.length > 30) {
    lines.push(`  ...and ${markets.length - 30} more`);
  }

  return lines.join('\n');
}

// =============================================================================
// DATABASE HANDLERS
// =============================================================================

async function handleDbTrades(symbol?: string, limitStr?: string): Promise<string> {
  const db = await initDatabase();
  const limit = limitStr ? parseInt(limitStr, 10) : 20;
  const trades = db.getBinanceFuturesTrades(getUserId(), { symbol, limit });

  if (trades.length === 0) {
    return symbol ? `No trades found for ${symbol}` : 'No trades found';
  }

  const lines = ['**Binance Futures Trade History**', ''];
  for (const t of trades) {
    const pnl = t.realizedPnl ? ` PnL: $${t.realizedPnl.toFixed(2)}` : '';
    const side = t.side === 'BUY' ? '🟢 BUY' : '🔴 SELL';
    lines.push(
      `  ${formatTime(t.timestamp)} | ${side} ${t.symbol} | ${t.size} @ $${t.price.toFixed(2)}${pnl}`
    );
  }

  return lines.join('\n');
}

async function handleDbStats(symbol?: string, period?: string): Promise<string> {
  const db = await initDatabase();
  const since = getPeriodMs(period);
  const stats = db.getBinanceFuturesStats(getUserId(), { symbol, since });

  if (stats.totalTrades === 0) {
    return 'No trades to analyze';
  }

  const periodLabel = period ? ` (${period})` : '';
  const lines = [
    `**Binance Futures Stats${symbol ? ` - ${symbol}` : ''}${periodLabel}**`,
    '',
    `Trades: ${stats.totalTrades}`,
    `Volume: $${formatNumber(stats.totalVolume)}`,
    `Fees: $${formatNumber(stats.totalFees)}`,
    '',
    `**Performance:**`,
    `Total PnL: $${formatNumber(stats.totalPnl)}`,
    `Win Rate: ${formatPct(stats.winRate)}`,
    `Wins: ${stats.winCount} | Losses: ${stats.lossCount}`,
    `Profit Factor: ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}`,
  ];

  return lines.join('\n');
}

async function handleDbFunding(symbol?: string, limitStr?: string): Promise<string> {
  const db = await initDatabase();
  const limit = limitStr ? parseInt(limitStr, 10) : 20;
  const funding = db.getBinanceFuturesFunding(getUserId(), { symbol, limit });

  if (funding.length === 0) {
    return symbol ? `No funding payments for ${symbol}` : 'No funding payments found';
  }

  const total = db.getBinanceFuturesFundingTotal(getUserId(), { symbol });
  const lines = [
    `**Binance Futures Funding${symbol ? ` - ${symbol}` : ''}**`,
    `Total: $${formatNumber(total)}`,
    '',
  ];

  for (const f of funding) {
    const sign = f.payment >= 0 ? '+' : '';
    lines.push(
      `  ${formatTime(f.timestamp)} | ${f.symbol} | ${sign}$${f.payment.toFixed(4)}`
    );
  }

  return lines.join('\n');
}

async function handleDbPositions(showAll?: string): Promise<string> {
  const db = await initDatabase();
  const openOnly = showAll?.toLowerCase() !== 'all';
  const positions = db.getBinanceFuturesPositions(getUserId(), { openOnly });

  if (positions.length === 0) {
    return openOnly ? 'No open positions in DB' : 'No position history';
  }

  const label = openOnly ? 'DB Positions (Open)' : 'Position History';
  const lines = [`**Binance Futures ${label}**`, ''];

  for (const p of positions) {
    const side = p.positionSide === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
    const status = p.closedAt ? ` [CLOSED @ $${p.closePrice?.toFixed(2)}]` : '';
    lines.push(
      `  ${side} ${p.symbol} | ${p.size} @ $${p.entryPrice.toFixed(2)} | ${p.leverage}x${status}`
    );
  }

  return lines.join('\n');
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

const skill = {
  name: 'binance-futures',
  description: 'Binance Futures trading with DB tracking',
  commands: ['/bf'],
  requires: { env: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'] },

  async handle(args: string): Promise<string> {
    const parts = args.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    try {
      switch (cmd) {
        // Account
        case 'balance':
        case 'bal':
          return handleBalance();
        case 'positions':
        case 'pos':
          return handlePositions();
        case 'orders':
          return handleOrders();

        // Trading
        case 'long':
        case 'l':
          return handleLong(parts[1], parts[2], parts[3]);
        case 'short':
        case 's':
          return handleShort(parts[1], parts[2], parts[3]);
        case 'close':
          return handleClose(parts[1]);
        case 'closeall':
          return handleCloseAll();
        case 'leverage':
        case 'lev':
          return handleLeverage(parts[1], parts[2]);

        // Market Data
        case 'price':
        case 'p':
          return handlePrice(parts[1]);
        case 'funding':
        case 'fr':
          return handleFundingRate(parts[1]);
        case 'markets':
        case 'm':
          return handleMarkets(parts[1]);

        // Database
        case 'trades':
          return handleDbTrades(parts[1], parts[2]);
        case 'dbstats':
        case 'stats':
          return handleDbStats(parts[1], parts[2]);
        case 'dbfunding':
          return handleDbFunding(parts[1], parts[2]);
        case 'dbpositions':
          return handleDbPositions(parts[1]);

        case 'help':
        case '':
        case undefined:
        default:
          return [
            '**Binance Futures Commands** (/bf)',
            '',
            '**Account:**',
            '  /bf balance        - Margin balance',
            '  /bf positions      - Open positions',
            '  /bf orders         - Open orders',
            '',
            '**Trading:**',
            '  /bf long <sym> <size> [lev]x   - Open long',
            '  /bf short <sym> <size> [lev]x  - Open short',
            '  /bf close <symbol>             - Close position',
            '  /bf closeall                   - Close all',
            '  /bf leverage <sym> <value>     - Set leverage',
            '',
            '**Market Data:**',
            '  /bf price <symbol>    - Current price',
            '  /bf funding <symbol>  - Funding rate',
            '  /bf markets [query]   - List markets',
            '',
            '**Database:**',
            '  /bf trades [sym] [limit]   - Trade history',
            '  /bf stats [sym] [period]   - Performance stats',
            '  /bf dbfunding [sym]        - Funding history',
            '  /bf dbpositions [all]      - Position history',
          ].join('\n');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, args }, 'Binance Futures command failed');
      return `Error: ${message}`;
    }
  },
};

export default skill;
