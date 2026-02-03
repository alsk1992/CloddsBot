/**
 * MEXC Futures Skill
 *
 * CLI commands for MEXC Futures with database tracking.
 * No KYC required for small amounts, up to 200x leverage.
 */

import * as mx from '../../../exchanges/mexc';
import { logger } from '../../../utils/logger';
import {
  initDatabase,
  type MexcFuturesTrade,
  type MexcFuturesPosition,
  type MexcFuturesFunding,
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

function formatSide(side: number): string {
  switch (side) {
    case 1: return '🟢 OPEN LONG';
    case 2: return '🟢 CLOSE SHORT';
    case 3: return '🔴 OPEN SHORT';
    case 4: return '🔴 CLOSE LONG';
    default: return `SIDE ${side}`;
  }
}

function formatPositionType(type: number): string {
  return type === 1 ? '🟢 LONG' : '🔴 SHORT';
}

function getConfig(): mx.MexcConfig | null {
  const apiKey = process.env.MEXC_API_KEY;
  const apiSecret = process.env.MEXC_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret, dryRun: process.env.DRY_RUN === 'true' };
}

function getUserId(): string {
  const apiKey = process.env.MEXC_API_KEY || '';
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

async function logTrade(result: mx.OrderResult, leverage?: number): Promise<void> {
  try {
    const db = await initDatabase();
    db.logMexcFuturesTrade({
      userId: getUserId(),
      orderId: result.orderId,
      symbol: result.symbol,
      side: result.side,
      vol: result.dealVol,
      price: result.dealAvgPrice || result.price,
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
  if (!config) return 'Set MEXC_API_KEY and MEXC_API_SECRET';

  const balances = await mx.getBalance(config);
  if (balances.length === 0) return 'No balances found';

  const lines = ['**MEXC Balance**', ''];
  for (const b of balances) {
    const pnl = b.unrealisedPnl !== 0 ? ` (uPnL: $${formatNumber(b.unrealisedPnl)})` : '';
    lines.push(`  ${b.currency}: $${formatNumber(b.equity)} (avail: $${formatNumber(b.availableBalance)})${pnl}`);
  }
  return lines.join('\n');
}

async function handlePositions(): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set MEXC_API_KEY and MEXC_API_SECRET';

  const positions = await mx.getPositions(config);
  if (positions.length === 0) return 'No open positions';

  const lines = ['**MEXC Positions**', ''];
  for (const p of positions) {
    const side = formatPositionType(p.positionType);
    const pnlPct = p.positionValue > 0 ? (p.unrealisedPnl / p.positionValue) * 100 : 0;
    lines.push(`  ${side} ${p.symbol} | ${p.holdVol} @ $${p.openAvgPrice.toFixed(2)} | ${p.leverage}x`);
    lines.push(`       Mark: $${p.markPrice.toFixed(2)} | PnL: $${formatNumber(p.unrealisedPnl)} (${formatPct(pnlPct)})`);
    if (p.liquidatePrice > 0) lines.push(`       Liq: $${p.liquidatePrice.toFixed(2)}`);
  }
  return lines.join('\n');
}

async function handleOrders(): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set MEXC_API_KEY and MEXC_API_SECRET';

  const orders = await mx.getOpenOrders(config);
  if (orders.length === 0) return 'No open orders';

  const lines = ['**MEXC Open Orders**', ''];
  for (const o of orders) {
    lines.push(`  [${o.orderId}] ${formatSide(o.side)} ${o.symbol} | ${o.vol} @ $${o.price.toFixed(2)}`);
  }
  return lines.join('\n');
}

// =============================================================================
// TRADING HANDLERS
// =============================================================================

async function handleLong(symbol?: string, volStr?: string, leverageStr?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set MEXC_API_KEY and MEXC_API_SECRET';
  if (!symbol || !volStr) return 'Usage: /mx long <symbol> <vol> [leverage]x\nExample: /mx long BTC_USDT 1 10x';

  const vol = parseFloat(volStr);
  const leverage = parseLeverage(leverageStr);

  const result = await mx.openLong(config, symbol.toUpperCase(), vol, leverage);
  await logTrade(result, leverage);

  return `🟢 LONG ${result.symbol} | ${result.vol} contracts | Order: ${result.orderId}`;
}

async function handleShort(symbol?: string, volStr?: string, leverageStr?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set MEXC_API_KEY and MEXC_API_SECRET';
  if (!symbol || !volStr) return 'Usage: /mx short <symbol> <vol> [leverage]x\nExample: /mx short BTC_USDT 1 10x';

  const vol = parseFloat(volStr);
  const leverage = parseLeverage(leverageStr);

  const result = await mx.openShort(config, symbol.toUpperCase(), vol, leverage);
  await logTrade(result, leverage);

  return `🔴 SHORT ${result.symbol} | ${result.vol} contracts | Order: ${result.orderId}`;
}

async function handleClose(symbol?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set MEXC_API_KEY and MEXC_API_SECRET';
  if (!symbol) return 'Usage: /mx close <symbol>';

  const result = await mx.closePosition(config, symbol.toUpperCase());
  if (!result) return `No open position for ${symbol.toUpperCase()}`;

  await logTrade(result);
  return `Closed ${result.symbol} | ${result.vol} contracts`;
}

async function handleCloseAll(): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set MEXC_API_KEY and MEXC_API_SECRET';

  const results = await mx.closeAllPositions(config);
  if (results.length === 0) return 'No positions to close';

  const lines = ['**Closed Positions:**'];
  for (const r of results) lines.push(`  ${r.symbol}: ${r.vol} contracts`);
  return lines.join('\n');
}

async function handleLeverage(symbol?: string, leverageStr?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set MEXC_API_KEY and MEXC_API_SECRET';
  if (!symbol || !leverageStr) return 'Usage: /mx leverage <symbol> <value>';

  const leverage = parseInt(leverageStr, 10);
  await mx.setLeverage(config, symbol.toUpperCase(), leverage);
  return `Set ${symbol.toUpperCase()} leverage to ${leverage}x`;
}

// =============================================================================
// MARKET DATA HANDLERS
// =============================================================================

async function handlePrice(symbol?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set MEXC_API_KEY and MEXC_API_SECRET';
  if (!symbol) return 'Usage: /mx price <symbol>';

  const price = await mx.getPrice(config, symbol.toUpperCase());
  return `${symbol.toUpperCase()}: $${price.toFixed(2)}`;
}

async function handleFundingRate(symbol?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set MEXC_API_KEY and MEXC_API_SECRET';
  if (!symbol) return 'Usage: /mx funding <symbol>';

  const data = await mx.getFundingRate(config, symbol.toUpperCase());
  const rate = (data.fundingRate * 100).toFixed(4);
  const annualized = (data.fundingRate * 100 * 3 * 365).toFixed(2);
  return `${symbol.toUpperCase()} Funding: ${rate}% (${annualized}% APR) | Mark: $${data.markPrice.toFixed(2)}`;
}

async function handleMarkets(query?: string): Promise<string> {
  const config = getConfig();
  if (!config) return 'Set MEXC_API_KEY and MEXC_API_SECRET';

  let markets = await mx.getMarkets(config);
  if (query) markets = markets.filter(m => m.toUpperCase().includes(query.toUpperCase()));

  const lines = [`**MEXC Markets (${markets.length})**`, ''];
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
  const trades = db.getMexcFuturesTrades(getUserId(), { symbol, limit });

  if (trades.length === 0) return symbol ? `No trades found for ${symbol}` : 'No trades found';

  const lines = ['**MEXC Trade History**', ''];
  for (const t of trades) {
    const pnl = t.realizedPnl ? ` PnL: $${t.realizedPnl.toFixed(2)}` : '';
    lines.push(`  ${formatTime(t.timestamp)} | ${formatSide(t.side)} ${t.symbol} | ${t.vol} @ $${t.price.toFixed(2)}${pnl}`);
  }
  return lines.join('\n');
}

async function handleDbStats(symbol?: string, period?: string): Promise<string> {
  const db = await initDatabase();
  const since = getPeriodMs(period);
  const stats = db.getMexcFuturesStats(getUserId(), { symbol, since });

  if (stats.totalTrades === 0) return 'No trades to analyze';

  const periodLabel = period ? ` (${period})` : '';
  return [
    `**MEXC Stats${symbol ? ` - ${symbol}` : ''}${periodLabel}**`,
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
  const funding = db.getMexcFuturesFunding(getUserId(), { symbol, limit });

  if (funding.length === 0) return 'No funding payments found';

  const total = db.getMexcFuturesFundingTotal(getUserId(), { symbol });
  const lines = [`**MEXC Funding** | Total: $${formatNumber(total)}`, ''];
  for (const f of funding) {
    const sign = f.payment >= 0 ? '+' : '';
    lines.push(`  ${formatTime(f.timestamp)} | ${f.symbol} | ${sign}$${f.payment.toFixed(4)}`);
  }
  return lines.join('\n');
}

async function handleDbPositions(showAll?: string): Promise<string> {
  const db = await initDatabase();
  const openOnly = showAll?.toLowerCase() !== 'all';
  const positions = db.getMexcFuturesPositions(getUserId(), { openOnly });

  if (positions.length === 0) return openOnly ? 'No open positions in DB' : 'No position history';

  const lines = [`**MEXC ${openOnly ? 'DB Positions' : 'Position History'}**`, ''];
  for (const p of positions) {
    const side = formatPositionType(p.positionType);
    const status = p.closedAt ? ` [CLOSED]` : '';
    lines.push(`  ${side} ${p.symbol} | ${p.holdVol} @ $${p.openAvgPrice.toFixed(2)} | ${p.leverage}x${status}`);
  }
  return lines.join('\n');
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

const skill = {
  name: 'mexc-futures',
  description: 'MEXC Futures trading with DB tracking (No KYC, 200x)',
  commands: ['/mx'],
  requires: { env: ['MEXC_API_KEY', 'MEXC_API_SECRET'] },

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
            '**MEXC Futures Commands** (/mx) - No KYC, 200x leverage',
            '',
            '**Account:** balance, positions, orders',
            '**Trading:** long/short <sym> <vol> [lev]x, close <sym>, closeall, leverage <sym> <val>',
            '**Market:** price <sym>, funding <sym>, markets [query]',
            '**Database:** trades, stats, dbfunding, dbpositions [all]',
            '',
            'Note: Use BTC_USDT format (not BTCUSDT)',
          ].join('\n');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, args }, 'MEXC command failed');
      return `Error: ${message}`;
    }
  },
};

export default skill;
