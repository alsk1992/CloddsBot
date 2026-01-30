/**
 * D1 Database Adapter
 */

import type { Env } from '../config';
import type { User, Alert, Position, ArbitrageOpportunity, UserSettings } from '../types';
import { generateId } from '../utils/crypto';

// User operations

export async function getOrCreateUser(
  db: D1Database,
  platform: string,
  platformUserId: string,
  username?: string
): Promise<User> {
  // Try to find existing user
  const existing = await db
    .prepare('SELECT * FROM users WHERE platform = ? AND platform_user_id = ?')
    .bind(platform, platformUserId)
    .first<{
      id: string;
      platform: string;
      platform_user_id: string;
      username: string | null;
      settings: string;
      created_at: number;
      last_active_at: number;
    }>();

  if (existing) {
    // Update last active
    await db
      .prepare('UPDATE users SET last_active_at = ? WHERE id = ?')
      .bind(Date.now(), existing.id)
      .run();

    return {
      id: existing.id,
      platform: existing.platform,
      platformUserId: existing.platform_user_id,
      username: existing.username ?? undefined,
      settings: JSON.parse(existing.settings || '{}'),
      createdAt: existing.created_at,
      lastActiveAt: Date.now(),
    };
  }

  // Create new user
  const now = Date.now();
  const user: User = {
    id: generateId(),
    platform,
    platformUserId,
    username,
    settings: { alertsEnabled: true },
    createdAt: now,
    lastActiveAt: now,
  };

  await db
    .prepare(
      'INSERT INTO users (id, platform, platform_user_id, username, settings, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      user.id,
      user.platform,
      user.platformUserId,
      user.username ?? null,
      JSON.stringify(user.settings),
      user.createdAt,
      user.lastActiveAt
    )
    .run();

  return user;
}

export async function updateUserSettings(
  db: D1Database,
  userId: string,
  settings: Partial<UserSettings>
): Promise<void> {
  const existing = await db
    .prepare('SELECT settings FROM users WHERE id = ?')
    .bind(userId)
    .first<{ settings: string }>();

  const currentSettings = JSON.parse(existing?.settings || '{}');
  const newSettings = { ...currentSettings, ...settings };

  await db
    .prepare('UPDATE users SET settings = ? WHERE id = ?')
    .bind(JSON.stringify(newSettings), userId)
    .run();
}

// Alert operations

export async function createAlert(
  db: D1Database,
  alert: Omit<Alert, 'id' | 'triggered' | 'triggeredAt' | 'createdAt'>
): Promise<Alert> {
  const now = Date.now();
  const newAlert: Alert = {
    ...alert,
    id: generateId(),
    triggered: false,
    createdAt: now,
  };

  await db
    .prepare(
      'INSERT INTO alerts (id, user_id, platform, market_id, market_name, condition_type, threshold, triggered, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      newAlert.id,
      newAlert.userId,
      newAlert.platform,
      newAlert.marketId,
      newAlert.marketName ?? null,
      newAlert.conditionType,
      newAlert.threshold,
      0,
      newAlert.createdAt
    )
    .run();

  return newAlert;
}

export async function listAlerts(db: D1Database, userId: string): Promise<Alert[]> {
  const results = await db
    .prepare('SELECT * FROM alerts WHERE user_id = ? AND triggered = 0 ORDER BY created_at DESC')
    .bind(userId)
    .all<{
      id: string;
      user_id: string;
      platform: string;
      market_id: string;
      market_name: string | null;
      condition_type: string;
      threshold: number;
      triggered: number;
      triggered_at: number | null;
      created_at: number;
    }>();

  return results.results.map((row) => ({
    id: row.id,
    userId: row.user_id,
    platform: row.platform as Alert['platform'],
    marketId: row.market_id,
    marketName: row.market_name ?? undefined,
    conditionType: row.condition_type as Alert['conditionType'],
    threshold: row.threshold,
    triggered: row.triggered === 1,
    triggeredAt: row.triggered_at ?? undefined,
    createdAt: row.created_at,
  }));
}

export async function deleteAlert(db: D1Database, alertId: string, userId: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?')
    .bind(alertId, userId)
    .run();

  return result.meta.changes > 0;
}

export async function triggerAlert(db: D1Database, alertId: string): Promise<void> {
  await db
    .prepare('UPDATE alerts SET triggered = 1, triggered_at = ? WHERE id = ?')
    .bind(Date.now(), alertId)
    .run();
}

// Position operations

export async function addPosition(
  db: D1Database,
  position: Omit<Position, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Position> {
  const now = Date.now();
  const newPosition: Position = {
    ...position,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };

  await db
    .prepare(
      'INSERT INTO positions (id, user_id, platform, market_id, market_question, outcome, side, shares, avg_price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      newPosition.id,
      newPosition.userId,
      newPosition.platform,
      newPosition.marketId,
      newPosition.marketQuestion ?? null,
      newPosition.outcome,
      newPosition.side,
      newPosition.shares,
      newPosition.avgPrice,
      newPosition.createdAt,
      newPosition.updatedAt
    )
    .run();

  return newPosition;
}

export async function listPositions(db: D1Database, userId: string): Promise<Position[]> {
  const results = await db
    .prepare('SELECT * FROM positions WHERE user_id = ? ORDER BY updated_at DESC')
    .bind(userId)
    .all<{
      id: string;
      user_id: string;
      platform: string;
      market_id: string;
      market_question: string | null;
      outcome: string;
      side: string;
      shares: number;
      avg_price: number;
      created_at: number;
      updated_at: number;
    }>();

  return results.results.map((row) => ({
    id: row.id,
    userId: row.user_id,
    platform: row.platform as Position['platform'],
    marketId: row.market_id,
    marketQuestion: row.market_question ?? undefined,
    outcome: row.outcome,
    side: row.side as Position['side'],
    shares: row.shares,
    avgPrice: row.avg_price,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

// Arbitrage operations

export async function saveArbitrage(
  db: D1Database,
  opp: Omit<ArbitrageOpportunity, 'id' | 'foundAt'>
): Promise<ArbitrageOpportunity> {
  const newOpp: ArbitrageOpportunity = {
    ...opp,
    id: generateId(),
    foundAt: Date.now(),
  };

  await db
    .prepare(
      'INSERT INTO arbitrage_history (id, found_at, platform, market_id, market_question, yes_price, no_price, edge_pct, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      newOpp.id,
      newOpp.foundAt,
      newOpp.platform,
      newOpp.marketId,
      newOpp.marketQuestion ?? null,
      newOpp.yesPrice,
      newOpp.noPrice,
      newOpp.edgePct,
      newOpp.mode
    )
    .run();

  return newOpp;
}

export async function getRecentArbitrage(
  db: D1Database,
  limit = 20
): Promise<ArbitrageOpportunity[]> {
  const results = await db
    .prepare(
      'SELECT * FROM arbitrage_history WHERE expired = 0 ORDER BY found_at DESC LIMIT ?'
    )
    .bind(limit)
    .all<{
      id: string;
      found_at: number;
      platform: string;
      market_id: string;
      market_question: string | null;
      yes_price: number;
      no_price: number;
      edge_pct: number;
      mode: string;
    }>();

  return results.results.map((row) => ({
    id: row.id,
    foundAt: row.found_at,
    platform: row.platform as ArbitrageOpportunity['platform'],
    marketId: row.market_id,
    marketQuestion: row.market_question ?? undefined,
    yesPrice: row.yes_price,
    noPrice: row.no_price,
    edgePct: row.edge_pct,
    mode: row.mode as ArbitrageOpportunity['mode'],
  }));
}

export async function expireOldArbitrage(db: D1Database, maxAgeMs = 3600000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  await db
    .prepare('UPDATE arbitrage_history SET expired = 1 WHERE found_at < ? AND expired = 0')
    .bind(cutoff)
    .run();
}
