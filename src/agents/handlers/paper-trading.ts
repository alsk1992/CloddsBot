/**
 * Paper Trading Handlers
 *
 * Simulated trading with virtual balance for practice and testing strategies
 */

import type { ToolInput, HandlerResult, HandlersMap, HandlerContext } from './types';
import { errorResult, successResult } from './types';

// =============================================================================
// PAPER TRADING HANDLERS
// =============================================================================

async function paperTradingModeHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const enabled = toolInput.enabled as boolean;
  const startingBalance = (toolInput.starting_balance as number) || 10000;

  context.db.run(`
    INSERT OR REPLACE INTO paper_trading_settings (user_id, enabled, balance, starting_balance, created_at)
    VALUES (?, ?, COALESCE((SELECT balance FROM paper_trading_settings WHERE user_id = ?), ?), ?, datetime('now'))
  `, [context.userId, enabled ? 1 : 0, context.userId, startingBalance, startingBalance]);

  return successResult({
    result: {
      mode: enabled ? 'PAPER TRADING ENABLED' : 'REAL TRADING MODE',
      message: enabled
        ? `Paper trading active with $${startingBalance.toLocaleString()} virtual balance. All trades are simulated.`
        : 'Paper trading disabled. ⚠️ All trades will use real funds.',
    },
  });
}

async function paperBalanceHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const settings = context.db.query<{ balance: number; starting_balance: number }>(
    'SELECT balance, starting_balance FROM paper_trading_settings WHERE user_id = ?',
    [context.userId]
  )[0];

  if (!settings) {
    return successResult({ result: { message: 'Paper trading not set up. Use paper_trading_mode to enable.' } });
  }

  const pnl = settings.balance - settings.starting_balance;
  const pnlPct = (pnl / settings.starting_balance) * 100;

  return successResult({
    result: {
      balance: `$${settings.balance.toLocaleString()}`,
      startingBalance: `$${settings.starting_balance.toLocaleString()}`,
      pnl: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
      pnlPct: `${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`,
    },
  });
}

async function paperPositionsHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const positions = context.db.query<{
    market_id: string;
    market_name: string;
    side: string;
    size: number;
    entry_price: number;
  }>(
    'SELECT market_id, market_name, side, size, entry_price FROM paper_positions WHERE user_id = ?',
    [context.userId]
  );

  if (positions.length === 0) {
    return successResult({ result: { message: 'No paper trading positions. Start trading to build your portfolio!' } });
  }

  return successResult({
    result: {
      count: positions.length,
      positions: positions.map(p => ({
        market: p.market_name.slice(0, 40) + (p.market_name.length > 40 ? '...' : ''),
        side: p.side,
        size: p.size,
        entryPrice: `${Math.round(p.entry_price * 100)}¢`,
      })),
    },
  });
}

async function paperResetHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const startingBalance = (toolInput.starting_balance as number) || 10000;

  context.db.run('DELETE FROM paper_positions WHERE user_id = ?', [context.userId]);
  context.db.run('DELETE FROM paper_trades WHERE user_id = ?', [context.userId]);
  context.db.run(`
    UPDATE paper_trading_settings SET balance = ?, starting_balance = ? WHERE user_id = ?
  `, [startingBalance, startingBalance, context.userId]);

  return successResult({
    result: {
      message: `Paper trading account reset to $${startingBalance.toLocaleString()}`,
      balance: `$${startingBalance.toLocaleString()}`,
    },
  });
}

async function paperHistoryHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const trades = context.db.query<{
    market_name: string;
    side: string;
    size: number;
    price: number;
    pnl: number;
    created_at: string;
  }>(
    'SELECT market_name, side, size, price, pnl, created_at FROM paper_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
    [context.userId]
  );

  const stats = context.db.query<{
    total_trades: number;
    winning_trades: number;
    total_pnl: number;
  }>(
    `SELECT COUNT(*) as total_trades, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades, SUM(pnl) as total_pnl
     FROM paper_trades WHERE user_id = ?`,
    [context.userId]
  )[0];

  return successResult({
    result: {
      stats: {
        totalTrades: stats?.total_trades || 0,
        winRate: stats?.total_trades ? `${((stats.winning_trades / stats.total_trades) * 100).toFixed(1)}%` : 'N/A',
        totalPnl: `$${(stats?.total_pnl || 0).toFixed(2)}`,
      },
      recentTrades: trades.map(t => ({
        market: t.market_name.slice(0, 30) + '...',
        side: t.side,
        size: t.size,
        price: `${Math.round(t.price * 100)}¢`,
        pnl: `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}`,
        date: t.created_at,
      })),
    },
  });
}

// =============================================================================
// EXPORT HANDLERS MAP
// =============================================================================

export const paperTradingHandlers: HandlersMap = {
  paper_trading_mode: paperTradingModeHandler,
  paper_balance: paperBalanceHandler,
  paper_positions: paperPositionsHandler,
  paper_reset: paperResetHandler,
  paper_history: paperHistoryHandler,
};

export default paperTradingHandlers;
