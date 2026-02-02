/**
 * Wallet Tracking Handlers
 *
 * Handlers for watching wallets and auto-copy settings
 * Note: Complex API handlers (get_wallet_trades, copy_trade) remain in agents/index.ts
 */

import type { ToolInput, HandlerResult, HandlersMap, HandlerContext } from './types';
import { successResult, errorResult } from './types';

// =============================================================================
// WALLET WATCH HANDLERS
// =============================================================================

async function watchWalletHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const address = (toolInput.address as string).toLowerCase();
  const platform = (toolInput.platform as string) || 'polymarket';
  const nickname = toolInput.nickname as string | undefined;

  context.db.run(`
    INSERT OR REPLACE INTO watched_wallets (user_id, address, platform, nickname, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `, [context.userId, address, platform, nickname || null]);

  const displayAddr = nickname
    ? `"${nickname}" (${address.slice(0, 6)}...${address.slice(-4)})`
    : `${address.slice(0, 6)}...${address.slice(-4)}`;

  return successResult({
    result: {
      message: `Now watching wallet ${displayAddr}`,
      address,
      platform,
      tip: 'You will receive alerts when this wallet makes trades.',
    },
  });
}

async function unwatchWalletHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const address = (toolInput.address as string).toLowerCase();
  context.db.run(
    'DELETE FROM watched_wallets WHERE user_id = ? AND address = ?',
    [context.userId, address]
  );

  return successResult({
    result: {
      message: `Stopped watching ${address.slice(0, 6)}...${address.slice(-4)}`,
    },
  });
}

async function listWatchedWalletsHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const wallets = context.db.query<{
    address: string;
    platform: string;
    nickname: string | null;
    created_at: string;
  }>(
    'SELECT address, platform, nickname, created_at FROM watched_wallets WHERE user_id = ?',
    [context.userId]
  );

  if (wallets.length === 0) {
    return successResult({
      result: {
        message: 'No wallets being watched. Use watch_wallet to start tracking.',
      },
    });
  }

  return successResult({
    result: {
      count: wallets.length,
      wallets: wallets.map(w => ({
        address: `${w.address.slice(0, 6)}...${w.address.slice(-4)}`,
        fullAddress: w.address,
        platform: w.platform,
        nickname: w.nickname,
        since: w.created_at,
      })),
    },
  });
}

// =============================================================================
// AUTO-COPY HANDLERS
// =============================================================================

async function enableAutoCopyHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const address = (toolInput.address as string).toLowerCase();
  const maxSize = toolInput.max_size as number;
  const sizeMultiplier = (toolInput.size_multiplier as number) || 0.5;
  const minConfidence = (toolInput.min_confidence as number) || 0.55;

  context.db.run(`
    INSERT OR REPLACE INTO auto_copy_settings (user_id, target_address, max_size, size_multiplier, min_confidence, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
  `, [context.userId, address, maxSize, sizeMultiplier, minConfidence]);

  return successResult({
    result: {
      message: `Auto-copy enabled for ${address.slice(0, 6)}...${address.slice(-4)}`,
      settings: {
        maxSize: `$${maxSize}`,
        sizeMultiplier: `${sizeMultiplier * 100}%`,
        minConfidence: `${minConfidence * 100}%`,
      },
      warning: '⚠️ Auto-copy executes real trades automatically. Use with caution.',
    },
  });
}

async function disableAutoCopyHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const address = (toolInput.address as string).toLowerCase();
  context.db.run(
    'UPDATE auto_copy_settings SET enabled = 0 WHERE user_id = ? AND target_address = ?',
    [context.userId, address]
  );

  return successResult({
    result: {
      message: `Auto-copy disabled for ${address.slice(0, 6)}...${address.slice(-4)}`,
    },
  });
}

async function listAutoCopyHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const settings = context.db.query<{
    target_address: string;
    max_size: number;
    size_multiplier: number;
    min_confidence: number;
  }>(
    'SELECT target_address, max_size, size_multiplier, min_confidence FROM auto_copy_settings WHERE user_id = ? AND enabled = 1',
    [context.userId]
  );

  if (settings.length === 0) {
    return successResult({
      result: {
        message: 'No auto-copy wallets configured. Use enable_auto_copy to set one up.',
      },
    });
  }

  return successResult({
    result: {
      count: settings.length,
      wallets: settings.map(s => ({
        address: `${s.target_address.slice(0, 6)}...${s.target_address.slice(-4)}`,
        fullAddress: s.target_address,
        maxSize: `$${s.max_size}`,
        sizeMultiplier: `${s.size_multiplier * 100}%`,
        minConfidence: `${s.min_confidence * 100}%`,
      })),
    },
  });
}

// =============================================================================
// ALERT HANDLERS (Whale & Volume)
// =============================================================================

async function whaleAlertsHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const enabled = toolInput.enabled as boolean;
  const minSize = (toolInput.min_size as number) || 10000;
  const platform = (toolInput.platform as string) || 'polymarket';

  context.db.run(`
    INSERT OR REPLACE INTO user_alert_settings (user_id, alert_type, enabled, config, updated_at)
    VALUES (?, 'whale', ?, ?, datetime('now'))
  `, [context.userId, enabled ? 1 : 0, JSON.stringify({ minSize, platform })]);

  return successResult({
    result: {
      message: enabled
        ? `Whale alerts enabled for trades over $${minSize.toLocaleString()}`
        : 'Whale alerts disabled',
      platform,
      minSize: enabled ? `$${minSize.toLocaleString()}` : undefined,
    },
  });
}

async function volumeSpikeAlertsHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const enabled = toolInput.enabled as boolean;
  const multiplier = (toolInput.multiplier as number) || 3;
  const platform = (toolInput.platform as string) || 'polymarket';

  context.db.run(`
    INSERT OR REPLACE INTO user_alert_settings (user_id, alert_type, enabled, config, updated_at)
    VALUES (?, 'volume_spike', ?, ?, datetime('now'))
  `, [context.userId, enabled ? 1 : 0, JSON.stringify({ multiplier, platform })]);

  return successResult({
    result: {
      message: enabled
        ? `Volume spike alerts enabled for ${multiplier}x normal volume`
        : 'Volume spike alerts disabled',
      platform,
      multiplier: enabled ? `${multiplier}x` : undefined,
    },
  });
}

async function newMarketAlertsHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId) {
    return errorResult('User ID not available');
  }

  const enabled = toolInput.enabled as boolean;
  const categories = toolInput.categories as string[] | undefined;
  const platform = (toolInput.platform as string) || 'polymarket';

  context.db.run(`
    INSERT OR REPLACE INTO user_alert_settings (user_id, alert_type, enabled, config, updated_at)
    VALUES (?, 'new_market', ?, ?, datetime('now'))
  `, [context.userId, enabled ? 1 : 0, JSON.stringify({ categories, platform })]);

  return successResult({
    result: {
      message: enabled
        ? 'New market alerts enabled'
        : 'New market alerts disabled',
      platform,
      categories: enabled ? (categories || ['all']) : undefined,
    },
  });
}

// =============================================================================
// EXPORT HANDLERS MAP
// =============================================================================

export const walletsHandlers: HandlersMap = {
  // Wallet watching
  watch_wallet: watchWalletHandler,
  unwatch_wallet: unwatchWalletHandler,
  list_watched_wallets: listWatchedWalletsHandler,

  // Auto-copy
  enable_auto_copy: enableAutoCopyHandler,
  disable_auto_copy: disableAutoCopyHandler,
  list_auto_copy: listAutoCopyHandler,

  // Alerts
  whale_alerts: whaleAlertsHandler,
  volume_spike_alerts: volumeSpikeAlertsHandler,
  new_market_alerts: newMarketAlertsHandler,
};

export default walletsHandlers;
