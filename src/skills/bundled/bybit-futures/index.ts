/**
 * Bybit Futures Skill
 *
 * CLI commands for Bybit Futures with database tracking.
 */

import * as bb from '../../../exchanges/bybit';
import { logger } from '../../../utils/logger';
import {
  initDatabase,
  type BybitFuturesTrade,
  type BybitFuturesPosition,
  type BybitFuturesFunding,
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

function getConfig(): bb.BybitConfig | null {
  const apiKey = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return {
    apiKey,
    apiSecret,
    testnet: process.env.BYBIT_TESTNET === 'true',
    dryRun: process.env.DRY_RUN === 'true',
  };
}

function getUserId(): string {
  const apiKey = process.env.BYBIT_API_KEY || '';
  return apiKey.slice(0, 16) || 'default';
}

function getPeriodMs(period?: string): number | undefined {
  if (!period) return undefined;
  const now = Date.now();
  switch (period.toLowerCase()) {
    case 'day': case '1d': return now - 24 * 60 * 60 * 1000;
    case 'week': case '7d': return now - 7 * 24 * 60 * 60 * 1000;
    case 'month': case '30d': return now - 30 * 24 * 60 * 60 * 1000;
    default: return undefined;
  }
}

function parseLeverage(leverageStr?: string): number | undefined {
  if (!leverageStr) return undefined;
  const match = leverageStr.match(/^(\d+)x?$/i);
  return match ? parseInt(match[1], 10) : undefined;
}

async function logTrade(result: bb.OrderResult, leverage?: number): Promise<void> {
  try {
    const db = await initDatabase();
    db.logBybitFuturesTrade({
      userId: getUserId(),
      orderId: result.orderId,
      symbol: result.symbol,
      side: result.side,
      size: result.cumExecQty,
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
  if (!config) return 'Set BYBIT_API_KEY and BYBIT_API_SECRET';

  const balances = await bb.getBalance(config);
  if (balances.length === 0) return 'No balances found';

  const lines = ['**Bybit Balance**', ''];
  for (const b of balances) {
    const pnl = b.unrealisedPnl !== 0 ? ` (uPnL: $${formatNumber(b.unrealisedPnl)})` : '';
    lines.push(`  ${b.coin}: $${formatNumber(b.equity)} (avail: $${formatNumber(b.availableBalance)})${pnl}`);
  }
  return lines.join('\n');
}

async function handlePositions(): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set BYBIT_API_KEY and BYBIT_API_SECRET';

  const positions = await bb.getPositions(config);
  if (positions.length === 0) return 'No open positions';

  const lines = ['**Bybit Positions**', ''];
  for (const p of positions) {
    const side = p.side === 'Buy' ? '🟢 LONG' : '🔴 SHORT';
    const pnlPct = (p.unrealisedPnl / p.positionValue) * 100;
    lines.push(`  ${side} ${p.symbol} | ${p.size} @ $${p.entryPrice.toFixed(2)} | ${p.leverage}x`);
    lines.push(`       Mark: $${p.markPrice.toFixed(2)} | PnL: $${formatNumber(p.unrealisedPnl)} (${formatPct(pnlPct)})`);
    if (p.liqPrice > 0) lines.push(`       Liq: $${p.liqPrice.toFixed(2)}`);
  }
  return lines.join('\n');
}

async function handleOrders(): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set BYBIT_API_KEY and BYBIT_API_SECRET';

  const orders = await bb.getOpenOrders(config);
  if (orders.length === 0) return 'No open orders';

  const lines = ['**Bybit Open Orders**', ''];
  for (const o of orders) {
    lines.push(`  [${o.orderId}] ${o.side} ${o.symbol} | ${o.qty} @ $${o.price.toFixed(2)} | ${o.orderType}`);
  }
  return lines.join('\n');
}

// =============================================================================
// TRADING HANDLERS
// =============================================================================

async function handleLong(symbol?: string, sizeStr?: string, leverageStr?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set BYBIT_API_KEY and BYBIT_API_SECRET';
  if (!symbol || !sizeStr) return 'Usage: /bb long <symbol> <size> [leverage]x\nExample: /bb long BTCUSDT 0.01 10x';

  const size = parseFloat(sizeStr);
  const leverage = parseLeverage(leverageStr);

  const result = await bb.openLong(config, symbol.toUpperCase(), size, leverage);
  await logTrade(result, leverage);

  return `🟢 LONG ${result.symbol} | ${result.qty} | Order: ${result.orderId}`;
}

async function handleShort(symbol?: string, sizeStr?: string, leverageStr?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set BYBIT_API_KEY and BYBIT_API_SECRET';
  if (!symbol || !sizeStr) return 'Usage: /bb short <symbol> <size> [leverage]x\nExample: /bb short BTCUSDT 0.01 10x';

  const size = parseFloat(sizeStr);
  const leverage = parseLeverage(leverageStr);

  const result = await bb.openShort(config, symbol.toUpperCase(), size, leverage);
  await logTrade(result, leverage);

  return `🔴 SHORT ${result.symbol} | ${result.qty} | Order: ${result.orderId}`;
}

async function handleClose(symbol?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set BYBIT_API_KEY and BYBIT_API_SECRET';
  if (!symbol) return 'Usage: /bb close <symbol>';

  const result = await bb.closePosition(config, symbol.toUpperCase());
  if (!result) return `No open position for ${symbol.toUpperCase()}`;

  await logTrade(result);
  return `Closed ${result.symbol} | ${result.qty}`;
}

async function handleCloseAll(): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set BYBIT_API_KEY and BYBIT_API_SECRET';

  const results = await bb.closeAllPositions(config);
  if (results.length === 0) return 'No positions to close';

  const lines = ['**Closed Positions:**'];
  for (const r of results) lines.push(`  ${r.symbol}: ${r.qty}`);
  return lines.join('\n');
}

async function handleLeverage(symbol?: string, leverageStr?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set BYBIT_API_KEY and BYBIT_API_SECRET';
  if (!symbol || !leverageStr) return 'Usage: /bb leverage <symbol> <value>';

  const leverage = parseInt(leverageStr, 10);
  await bb.setLeverage(config, symbol.toUpperCase(), leverage);
  return `Set ${symbol.toUpperCase()} leverage to ${leverage}x`;
}

// =============================================================================
// MARKET DATA HANDLERS
// =============================================================================

async function handlePrice(symbol?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set BYBIT_API_KEY and BYBIT_API_SECRET';
  if (!symbol) return 'Usage: /bb price <symbol>';

  const price = await bb.getPrice(config, symbol.toUpperCase());
  return `${symbol.toUpperCase()}: $${price.toFixed(2)}`;
}

async function handleFundingRate(symbol?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set BYBIT_API_KEY and BYBIT_API_SECRET';
  if (!symbol) return 'Usage: /bb funding <symbol>';

  const data = await bb.getFundingRate(config, symbol.toUpperCase());
  const rate = (data.fundingRate * 100).toFixed(4);
  const annualized = (data.fundingRate * 100 * 3 * 365).toFixed(2);
  return `${symbol.toUpperCase()} Funding: ${rate}% (${annualized}% APR) | Mark: $${data.markPrice.toFixed(2)}`;
}

async function handleMarkets(query?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set BYBIT_API_KEY and BYBIT_API_SECRET';

  let markets = await bb.getMarkets(config);
  if (query) markets = markets.filter(m => m.toUpperCase().includes(query.toUpperCase()));

  const lines = [`**Bybit Markets (${markets.length})**`, ''];
  for (const m of markets.slice(0, 30)) lines.push(`  ${m}`);
  if (markets.length > 30) lines.push(`  ...and ${markets.length - 30} more`);
  return lines.join('\n');
}

// =============================================================================
// DATABASE HANDLERS
// =============================================================================

async function handleDbTrades(symbol?: string, limitStr?: string): Promise<string> {
  const db = await initDatabase();
  const limit = limitStr ? parseInt(limitStr, 10) : 20;
  const trades = db.getBybitFuturesTrades(getUserId(), { symbol, limit });

  if (trades.length === 0) return symbol ? `No trades found for ${symbol}` : 'No trades found';

  const lines = ['**Bybit Trade History**', ''];
  for (const t of trades) {
    const pnl = t.closedPnl ? ` PnL: $${t.closedPnl.toFixed(2)}` : '';
    const side = t.side === 'Buy' ? '🟢 BUY' : '🔴 SELL';
    lines.push(`  ${formatTime(t.timestamp)} | ${side} ${t.symbol} | ${t.size} @ $${t.price.toFixed(2)}${pnl}`);
  }
  return lines.join('\n');
}

async function handleDbStats(symbol?: string, period?: string): Promise<string> {
  const db = await initDatabase();
  const since = getPeriodMs(period);
  const stats = db.getBybitFuturesStats(getUserId(), { symbol, since });

  if (stats.totalTrades === 0) return 'No trades to analyze';

  const periodLabel = period ? ` (${period})` : '';
  return [
    `**Bybit Stats${symbol ? ` - ${symbol}` : ''}${periodLabel}**`,
    '',
    `Trades: ${stats.totalTrades} | Volume: $${formatNumber(stats.totalVolume)}`,
    `Total PnL: $${formatNumber(stats.totalPnl)} | Win Rate: ${formatPct(stats.winRate)}`,
    `Wins: ${stats.winCount} | Losses: ${stats.lossCount}`,
    `Profit Factor: ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}`,
  ].join('\n');
}

async function handleDbFunding(symbol?: string, limitStr?: string): Promise<string> {
  const db = await initDatabase();
  const limit = limitStr ? parseInt(limitStr, 10) : 20;
  const funding = db.getBybitFuturesFunding(getUserId(), { symbol, limit });

  if (funding.length === 0) return 'No funding payments found';

  const total = db.getBybitFuturesFundingTotal(getUserId(), { symbol });
  const lines = [`**Bybit Funding** | Total: $${formatNumber(total)}`, ''];
  for (const f of funding) {
    const sign = f.payment >= 0 ? '+' : '';
    lines.push(`  ${formatTime(f.timestamp)} | ${f.symbol} | ${sign}$${f.payment.toFixed(4)}`);
  }
  return lines.join('\n');
}

async function handleDbPositions(showAll?: string): Promise<string> {
  const db = await initDatabase();
  const openOnly = showAll?.toLowerCase() !== 'all';
  const positions = db.getBybitFuturesPositions(getUserId(), { openOnly });

  if (positions.length === 0) return openOnly ? 'No open positions in DB' : 'No position history';

  const lines = [`**Bybit ${openOnly ? 'DB Positions' : 'Position History'}**`, ''];
  for (const p of positions) {
    const side = p.side === 'Buy' ? '🟢 LONG' : '🔴 SHORT';
    const status = p.closedAt ? ` [CLOSED]` : '';
    lines.push(`  ${side} ${p.symbol} | ${p.size} @ $${p.entryPrice.toFixed(2)} | ${p.leverage}x${status}`);
  }
  return lines.join('\n');
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

const skill = {
  name: 'bybit-futures',
  description: 'Bybit Futures trading with DB tracking',
  commands: ['/bb'],
  requires: { env: ['BYBIT_API_KEY', 'BYBIT_API_SECRET'] },

  async handle(args: string): Promise<string> {
    const parts = args.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    try {
      switch (cmd) {
        case 'balance': case 'bal': return handleBalance();
        case 'positions': case 'pos': return handlePositions();
        case 'orders': return handleOrders();
        case 'long': case 'l': return handleLong(parts[1], parts[2], parts[3]);
        case 'short': case 's': return handleShort(parts[1], parts[2], parts[3]);
        case 'close': return handleClose(parts[1]);
        case 'closeall': return handleCloseAll();
        case 'leverage': case 'lev': return handleLeverage(parts[1], parts[2]);
        case 'price': case 'p': return handlePrice(parts[1]);
        case 'funding': case 'fr': return handleFundingRate(parts[1]);
        case 'markets': case 'm': return handleMarkets(parts[1]);
        case 'trades': return handleDbTrades(parts[1], parts[2]);
        case 'dbstats': case 'stats': return handleDbStats(parts[1], parts[2]);
        case 'dbfunding': return handleDbFunding(parts[1], parts[2]);
        case 'dbpositions': return handleDbPositions(parts[1]);
        default:
          return [
            '**Bybit Futures Commands** (/bb)',
            '',
            '**Account:** balance, positions, orders',
            '**Trading:** long/short <sym> <size> [lev]x, close <sym>, closeall, leverage <sym> <val>',
            '**Market:** price <sym>, funding <sym>, markets [query]',
            '**Database:** trades, stats, dbfunding, dbpositions [all]',
          ].join('\n');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, args }, 'Bybit command failed');
      return `Error: ${message}`;
    }
  },
};

export default skill;
