/**
 * Cron Service - Clawdbot-style scheduled tasks
 *
 * Features:
 * - One-shot and recurring jobs
 * - Cron expressions
 * - Agent wakeups
 * - Alert checking
 * - Market monitoring
 */

import { EventEmitter } from 'eventemitter3';
import { randomUUID } from 'crypto';
import { generateId as generateSecureId } from '../utils/id';
import { join } from 'path';
import { Database } from '../db';
import { FeedManager } from '../feeds';
import type {
  Alert,
  Config,
  ManifoldCredentials,
  Market,
  OutgoingMessage,
  Platform,
  PolymarketCredentials,
  Position,
  User,
  KalshiCredentials,
} from '../types';
import type { CredentialsManager } from '../types';
import { buildKalshiHeadersForUrl } from '../utils/kalshi-auth';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

/** Schedule types */
export type CronSchedule =
  | { kind: 'at'; atMs: number }           // Run once at specific time
  | { kind: 'every'; everyMs: number; anchorMs?: number }  // Recurring interval
  | { kind: 'cron'; expr: string; tz?: string };           // Cron expression

/** Session target for job execution */
export type CronSessionTarget = 'main' | 'isolated';

/** When to wake the agent */
export type CronWakeMode = 'next-heartbeat' | 'now';

/** Job payload - what to do when triggered */
export type CronPayload =
  | { kind: 'systemEvent'; text: string }
  | {
      kind: 'agentTurn';
      message: string;
      model?: string;
      thinking?: 'off' | 'low' | 'medium' | 'high';
      timeoutSeconds?: number;
      deliver?: boolean;
      channel?: string;
      to?: string;
    }
  | {
      kind: 'alert';
      alertId: string;
    }
  | {
      kind: 'marketCheck';
      marketId: string;
      platform: string;
    }
  | {
      kind: 'alertScan';
    }
  | {
      kind: 'portfolioSync';
    }
  | {
      kind: 'dailyDigest';
    }
  | {
      kind: 'stopLossScan';
    };

/** Job state tracking */
export interface CronJobState {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
  lastDurationMs?: number;
}

/** A scheduled job */
export interface CronJob {
  id: string;
  agentId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  state: CronJobState;
}

/** Input for creating a job */
export type CronJobCreate = Omit<CronJob, 'id' | 'createdAtMs' | 'updatedAtMs' | 'state'> & {
  state?: Partial<CronJobState>;
};

/** Input for updating a job */
export type CronJobPatch = Partial<Omit<CronJob, 'id' | 'createdAtMs' | 'state'>> & {
  state?: Partial<CronJobState>;
};

/** Cron service events */
export type CronEvent =
  | { type: 'job:scheduled'; job: CronJob }
  | { type: 'job:started'; job: CronJob }
  | { type: 'job:completed'; job: CronJob; durationMs: number }
  | { type: 'job:failed'; job: CronJob; error: string }
  | { type: 'job:skipped'; job: CronJob; reason: string };

// =============================================================================
// HELPERS
// =============================================================================

/** Parse simple cron expression to next run time */
function getNextCronTime(expr: string, _tz?: string): number {
  // Simple cron parser - supports: minute hour dayOfMonth month dayOfWeek
  // Format: "0 9 * * *" = 9 AM daily
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) {
    // Invalid, return next minute
    const now = new Date();
    now.setSeconds(0);
    now.setMilliseconds(0);
    now.setMinutes(now.getMinutes() + 1);
    return now.getTime();
  }

  const [minute, hour, _dayOfMonth, _month, _dayOfWeek] = parts;
  const now = new Date();
  const next = new Date(now);

  // Set to specific minute/hour if specified
  if (minute !== '*') {
    next.setMinutes(parseInt(minute, 10));
  }
  if (hour !== '*') {
    next.setHours(parseInt(hour, 10));
  }
  next.setSeconds(0);
  next.setMilliseconds(0);

  // If time already passed today, move to tomorrow
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime();
}

/** Calculate next run time for a schedule */
function calculateNextRun(schedule: CronSchedule, lastRunMs?: number): number {
  const now = Date.now();

  switch (schedule.kind) {
    case 'at':
      return schedule.atMs > now ? schedule.atMs : -1; // -1 = already passed

    case 'every': {
      if (!schedule.everyMs || schedule.everyMs <= 0) return -1; // invalid interval
      const anchor = schedule.anchorMs || now;
      const elapsed = now - anchor;
      const intervals = Math.floor(elapsed / schedule.everyMs);
      return anchor + (intervals + 1) * schedule.everyMs;
    }

    case 'cron':
      return getNextCronTime(schedule.expr, schedule.tz);

    default:
      return -1;
  }
}

// =============================================================================
// SERVICE
// =============================================================================

export interface CronServiceDeps {
  db: Database;
  feeds: FeedManager;
  sendMessage: (msg: OutgoingMessage) => Promise<string | null>;
  config?: Config;
  credentials?: CredentialsManager;
  /** Execute agent turn (optional) */
  executeAgentTurn?: (message: string, options: {
    model?: string;
    thinking?: string;
    channel?: string;
    to?: string;
  }) => Promise<string>;
}

export interface CronService extends EventEmitter {
  start(): Promise<void>;
  stop(): void;
  status(): { running: boolean; jobCount: number; nextJobAt?: number };
  list(opts?: { includeDisabled?: boolean }): CronJob[];
  get(id: string): CronJob | undefined;
  add(input: CronJobCreate): CronJob;
  update(id: string, patch: CronJobPatch): CronJob | null;
  remove(id: string): boolean;
  run(id: string, mode?: 'due' | 'force'): Promise<boolean>;
}

export function createCronService(deps: CronServiceDeps): CronService {
  const emitter = new EventEmitter() as CronService;
  const jobs = new Map<string, CronJob>();
  const timers = new Map<string, NodeJS.Timeout>();
  let running = false;
  let tickInterval: NodeJS.Timeout | null = null;
  const digestSentOn = new Map<string, string>();

  const alertDefaults = {
    priceChangeThresholdPct: deps.config?.alerts?.priceChange?.threshold ?? 5,
    priceChangeWindowSecs: deps.config?.alerts?.priceChange?.windowSecs ?? 600,
    volumeSpikeMultiplier: deps.config?.alerts?.volumeSpike?.multiplier ?? 3,
  };

  /** Generate unique job ID */
  function generateId(): string {
    return generateSecureId('cron');
  }

  function persistJob(job: CronJob): void {
    job.updatedAtMs = Date.now();
    deps.db.upsertCronJob({
      id: job.id,
      data: JSON.stringify(job),
      enabled: job.enabled,
      createdAtMs: job.createdAtMs,
      updatedAtMs: job.updatedAtMs,
    });
  }

  function loadPersistedJobs(): void {
    const records = deps.db.listCronJobs();
    if (records.length === 0) return;
    for (const record of records) {
      try {
        const parsed = JSON.parse(record.data) as CronJob;
        if (!parsed || typeof parsed !== 'object' || !parsed.id) continue;
        const job: CronJob = {
          ...parsed,
          enabled: record.enabled,
          createdAtMs: record.createdAtMs ?? parsed.createdAtMs ?? Date.now(),
          updatedAtMs: record.updatedAtMs ?? parsed.updatedAtMs ?? Date.now(),
          state: parsed.state || {},
        };
        jobs.set(job.id, job);
      } catch (error) {
        logger.warn({ error, jobId: record.id }, 'Failed to parse persisted cron job');
      }
    }
  }

  function formatCents(price: number): string {
    return `${(price * 100).toFixed(1)}¢`;
  }

  function getPrimaryOutcome(market: Market): { name: string; price: number; previousPrice?: number } | null {
    if (!market?.outcomes?.length) return null;
    const yesOutcome = market.outcomes.find((o) => o.name?.toLowerCase() === 'yes');
    const outcome = yesOutcome || market.outcomes[0];
    if (!outcome || typeof outcome.price !== 'number') return null;
    return {
      name: outcome.name,
      price: outcome.price,
      previousPrice: outcome.previousPrice,
    };
  }

  function normalizeThresholdPct(value: number): number {
    if (!Number.isFinite(value)) return alertDefaults.priceChangeThresholdPct;
    return value < 1 ? value * 100 : value;
  }

function resolveAlertRecipient(userId: string): { platform: string; chatId: string } | null {
  const latest = deps.db.getLatestSessionForUser(userId);
  if (latest) {
    return { platform: latest.channel, chatId: latest.chatId };
  }
  const user = deps.db.getUser(userId);
  if (!user) return null;
  return { platform: user.platform, chatId: user.platformUserId };
}


  /** Execute a job based on its payload */
  async function executeJob(job: CronJob): Promise<void> {
    const { payload } = job;

    switch (payload.kind) {
      case 'alertScan':
        await checkAllAlerts();
        break;

      case 'alert':
        await checkSingleAlert(payload.alertId);
        break;

      case 'marketCheck':
        await checkMarket(payload.marketId, payload.platform);
        break;

      case 'portfolioSync':
        await syncAllPortfolios();
        break;

      case 'dailyDigest':
        await runDailyDigest();
        break;

      case 'stopLossScan':
        await scanStopLosses();
        break;

      case 'agentTurn':
        if (deps.executeAgentTurn) {
          await deps.executeAgentTurn(payload.message, {
            model: payload.model,
            thinking: payload.thinking,
            channel: payload.channel,
            to: payload.to,
          });
        }
        break;

      case 'systemEvent':
        logger.info({ event: payload.text }, 'System event triggered');
        break;
    }
  }

  /** Check all active alerts */
  async function checkAllAlerts(): Promise<void> {
    const activeAlerts = deps.db.getActiveAlerts();
    for (const alert of activeAlerts) {
      try {
        await checkSingleAlert(alert.id);
      } catch (error) {
        logger.error({ alertId: alert.id, error }, 'Error checking alert');
      }
    }
  }

  /** Check a single alert */
  async function checkSingleAlert(alertId: string): Promise<void> {
    const alerts = deps.db.getActiveAlerts();
    const alert = alerts.find((a) => a.id === alertId);
    if (!alert || !alert.marketId || !alert.platform) return;

    const market = await deps.feeds.getMarket(alert.marketId, alert.platform);
    if (!market) return;

    const outcome = getPrimaryOutcome(market);
    if (!outcome) return;

    const currentPrice = outcome.price;
    const windowSecs = alert.condition.timeWindowSecs ?? alertDefaults.priceChangeWindowSecs;
    const previousMarket = deps.db.getCachedMarket(alert.platform, alert.marketId, windowSecs * 1000);
    const previousOutcome = previousMarket ? getPrimaryOutcome(previousMarket) : null;
    const previousPrice = previousOutcome?.price ?? outcome.previousPrice;
    const currentVolume = market.volume24h ?? 0;
    const previousVolume = previousMarket?.volume24h ?? 0;

    let triggered = false;
    let message = '';

    switch (alert.condition.type) {
      case 'price_above':
        if (currentPrice >= alert.condition.threshold) {
          triggered = true;
          message = `📈 Price Alert: ${market.question}\nPrice is now ${(currentPrice * 100).toFixed(1)}¢ (above ${(alert.condition.threshold * 100).toFixed(1)}¢)`;
        }
        break;

      case 'price_below':
        if (currentPrice <= alert.condition.threshold) {
          triggered = true;
          message = `📉 Price Alert: ${market.question}\nPrice is now ${(currentPrice * 100).toFixed(1)}¢ (below ${(alert.condition.threshold * 100).toFixed(1)}¢)`;
        }
        break;

      case 'price_change_pct': {
        if (previousPrice === undefined || previousPrice <= 0) break;
        const thresholdPct = normalizeThresholdPct(alert.condition.threshold);
        const changePct = ((currentPrice - previousPrice) / previousPrice) * 100;
        const direction = alert.condition.direction ?? 'any';
        const directionMatch =
          direction === 'any'
            ? Math.abs(changePct) >= thresholdPct
            : direction === 'up'
              ? changePct >= thresholdPct
              : changePct <= -thresholdPct;
        if (directionMatch) {
          triggered = true;
          const arrow = changePct >= 0 ? '📈' : '📉';
          message =
            `${arrow} Price Change Alert: ${market.question}\n` +
            `Price moved ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% ` +
            `(${formatCents(previousPrice)} → ${formatCents(currentPrice)})`;
        }
        break;
      }

      case 'volume_spike': {
        const multiplier = Number.isFinite(alert.condition.threshold)
          ? alert.condition.threshold
          : alertDefaults.volumeSpikeMultiplier;
        if (previousVolume > 0 && currentVolume / previousVolume >= multiplier) {
          triggered = true;
          const ratio = currentVolume / previousVolume;
          message =
            `📊 Volume Spike: ${market.question}\n` +
            `24h volume is ${ratio.toFixed(2)}x (${currentVolume.toLocaleString()} vs ${previousVolume.toLocaleString()})`;
        }
        break;
      }
    }

    deps.db.cacheMarket(market);

    if (triggered) {
      deps.db.triggerAlert(alert.id);

      const target = alert.channel && alert.chatId
        ? { platform: alert.channel, chatId: alert.chatId }
        : resolveAlertRecipient(alert.userId);
      if (target) {
        await deps.sendMessage({
          platform: target.platform,
          chatId: target.chatId,
          text: message,
        });
      }

      logger.info({ alertId: alert.id }, 'Alert triggered');
    }
  }

  /** Check a specific market */
  async function checkMarket(marketId: string, platform: string): Promise<void> {
    const market = await deps.feeds.getMarket(marketId, platform);
    if (market) {
      logger.debug({ marketId, platform, price: market.outcomes[0]?.price }, 'Market checked');
    }
  }

  function parseDigestTime(raw: string | undefined): { hour: number; minute: number } | null {
    if (!raw) return { hour: 9, minute: 0 };
    const parts = raw.split(':').map((p) => p.trim()).filter(Boolean);
    const hour = Number.parseInt(parts[0] ?? '', 10);
    const minute = Number.parseInt(parts[1] ?? '0', 10);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
    if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
    return { hour, minute };
  }

  function shouldSendDigest(user: User, now: Date, windowMinutes: number): boolean {
    if (!user.settings?.digestEnabled) return false;
    const time = parseDigestTime(user.settings.digestTime);
    if (!time) return false;
    const today = now.toISOString().slice(0, 10);
    if (digestSentOn.get(user.id) === today) return false;

    if (now.getHours() !== time.hour) return false;
    const minute = now.getMinutes();
    return minute >= time.minute && minute < time.minute + windowMinutes;
  }

  function buildPosition(params: {
    platform: Platform;
    marketId: string;
    marketQuestion: string;
    outcome: string;
    outcomeId: string;
    side: string;
    shares: number;
    avgPrice: number;
    currentPrice: number;
  }): Position {
    // Guard against NaN propagation: if any numeric input is not finite, treat as 0
    const shares = Number.isFinite(params.shares) ? params.shares : 0;
    const avgPrice = Number.isFinite(params.avgPrice) ? params.avgPrice : 0;
    const currentPrice = Number.isFinite(params.currentPrice) ? params.currentPrice : 0;

    const value = shares * currentPrice;
    const pnl = shares * (currentPrice - avgPrice);
    const pnlPct = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;
    return {
      id: randomUUID(),
      platform: params.platform,
      marketId: params.marketId,
      marketQuestion: params.marketQuestion,
      outcome: params.outcome,
      outcomeId: params.outcomeId,
      side: (params.side === 'YES' || params.side === 'NO' ? params.side : params.side.toUpperCase() === 'LONG' ? 'YES' : 'NO') as 'YES' | 'NO',
      shares,
      avgPrice,
      currentPrice,
      pnl,
      pnlPct,
      value,
      openedAt: new Date(),
    };
  }

  function normalizeSide(outcome: string | undefined): 'YES' | 'NO' {
    return outcome && outcome.toString().toUpperCase().includes('NO') ? 'NO' : 'YES';
  }

  function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value === null || value === undefined) return null;
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeKalshiPrice(value: unknown): number | null {
    const num = toNumber(value);
    if (num === null) return null;
    return num > 1 ? num / 100 : num;
  }

  async function runDailyDigest(): Promise<void> {
    const users = deps.db.listUsers();
    if (users.length === 0) return;

    const now = new Date();
    const windowMinutes = 5;

    // Prune stale digest-sent entries from previous days
    const today = now.toISOString().slice(0, 10);
    const toDelete: string[] = [];
    for (const [userId, sentDate] of digestSentOn) {
      if (sentDate !== today) toDelete.push(userId);
    }
    for (const userId of toDelete) {
      digestSentOn.delete(userId);
    }

    for (const user of users) {
      if (!shouldSendDigest(user, now, windowMinutes)) continue;

      const positions = deps.db.getPositions(user.id);
      const alerts = deps.db.getAlerts(user.id).filter((a) => a.enabled && !a.triggered);
      const news = deps.feeds.getRecentNews(5);

      const lines: string[] = [];
      lines.push(`📬 Daily Digest — ${now.toLocaleDateString()}`);

      if (positions.length > 0) {
        const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
        const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
        lines.push(
          `Portfolio: $${totalValue.toFixed(2)} (${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)})`
        );
        const topPositions = [...positions]
          .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
          .slice(0, 3);
        for (const pos of topPositions) {
          lines.push(
            `• ${pos.marketQuestion.slice(0, 60)} — ${pos.side} ${formatCents(pos.currentPrice)} ` +
            `(${pos.pnl >= 0 ? '+' : ''}$${pos.pnl.toFixed(2)})`
          );
        }
      } else {
        lines.push('Portfolio: no tracked positions yet.');
      }

      if (alerts.length > 0) {
        lines.push(`Active alerts: ${alerts.length}`);
      }

      if (news.length > 0) {
        lines.push('', 'Top news:');
        for (const item of news.slice(0, 3)) {
          lines.push(`• ${item.title} (${item.source})`);
        }
      }

      const target = resolveAlertRecipient(user.id);
      if (!target) continue;
      await deps.sendMessage({
        platform: target.platform,
        chatId: target.chatId,
        text: lines.join('\n'),
      });
      digestSentOn.set(user.id, now.toISOString().slice(0, 10));
    }
  }

  async function fetchPolymarketPositions(
    userId: string,
    creds: PolymarketCredentials
  ): Promise<Position[]> {
    const address = creds.funderAddress;
    if (!address) return [];

    const response = await fetch(`https://data-api.polymarket.com/positions?user=${address}`);
    if (!response.ok) {
      throw new Error(`Polymarket positions fetch failed: ${response.status}`);
    }
    const data = await response.json() as Array<Record<string, unknown>>;
    const positions: Position[] = [];

    for (const item of data || []) {
      const marketId =
        (item.conditionId as string) ||
        (item.condition_id as string) ||
        (item.marketId as string) ||
        (item.market_id as string) ||
        (item.market as string);
      if (!marketId) continue;
      const outcome = (item.outcome as string) || 'YES';
      const side = normalizeSide(outcome);
      const shares = toNumber(item.size ?? item.shares ?? item.balance) ?? 0;
      if (shares <= 0) continue;
      const avgPrice = toNumber(item.avgPrice ?? item.avg_price ?? item.entryPrice ?? item.entry_price) ?? 0;
      const currentPrice = toNumber(item.currentPrice ?? item.current_price ?? item.price) ?? avgPrice;
      const outcomeId = (item.tokenId as string) || (item.token_id as string) || `${marketId}-${side}`;
      const marketQuestion =
        (item.title as string) ||
        (item.market as string) ||
        (item.question as string) ||
        marketId;

      positions.push(
        buildPosition({
          platform: 'polymarket',
          marketId,
          marketQuestion,
          outcome,
          outcomeId,
          side,
          shares,
          avgPrice: avgPrice > 0 ? avgPrice : currentPrice,
          currentPrice,
        })
      );
    }

    await deps.credentials?.markSuccess(userId, 'polymarket');
    return positions;
  }

  async function fetchKalshiPositions(
    userId: string,
    creds: KalshiCredentials
  ): Promise<Position[]> {
    const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
    let headers: Record<string, string> | undefined;

    if (creds.apiKeyId && creds.privateKeyPem) {
      headers = buildKalshiHeadersForUrl(
        { apiKeyId: creds.apiKeyId, privateKeyPem: creds.privateKeyPem },
        'GET',
        `${KALSHI_API_BASE}/portfolio/positions`
      );
    } else if (creds.email && creds.password) {
      const loginRes = await fetch(`${KALSHI_API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creds.email, password: creds.password }),
      });
      if (!loginRes.ok) {
        throw new Error(`Kalshi login failed: ${loginRes.status}`);
      }
      const loginData = await loginRes.json() as { token: string };
      headers = { Authorization: `Bearer ${loginData.token}` };
    } else {
      return [];
    }

    const posRes = await fetch(`${KALSHI_API_BASE}/portfolio/positions`, { headers });
    if (!posRes.ok) {
      throw new Error(`Kalshi positions fetch failed: ${posRes.status}`);
    }
    const posData = await posRes.json() as { market_positions?: Array<Record<string, unknown>> };
    const marketCache = new Map<string, Record<string, unknown>>();
    const positions: Position[] = [];

    for (const entry of posData.market_positions || []) {
      const ticker = entry.ticker as string;
      if (!ticker) continue;
      const rawPosition = toNumber(entry.position ?? entry.shares ?? entry.count) ?? 0;
      if (rawPosition === 0) continue;
      const side: 'YES' | 'NO' = rawPosition >= 0 ? 'YES' : 'NO';
      const shares = Math.abs(rawPosition);

      let market = marketCache.get(ticker);
      if (!market) {
        const marketRes = await fetch(`${KALSHI_API_BASE}/markets/${ticker}`, { headers });
        if (marketRes.ok) {
          const marketJson = await marketRes.json() as { market?: Record<string, unknown> };
          market = (marketJson.market || marketJson) as Record<string, unknown>;
          marketCache.set(ticker, market);
        }
      }

      const marketQuestion = (market?.title as string) || (entry.market as string) || ticker;
      const yesPrice = normalizeKalshiPrice(
        market?.yes_bid ?? market?.yes_ask ?? market?.yes_price ?? market?.last_price
      ) ?? 0.5;
      const currentPrice = side === 'YES' ? yesPrice : Math.max(0, 1 - yesPrice);

      let avgPrice =
        normalizeKalshiPrice(entry.avg_price ?? entry.average_price ?? entry.avg_entry_price) ??
        null;
      if (avgPrice === null) {
        const totalTraded = toNumber(entry.total_traded ?? entry.cost_basis);
        if (totalTraded && shares > 0) {
          avgPrice = normalizeKalshiPrice(totalTraded / shares);
        }
      }
      avgPrice = avgPrice ?? currentPrice;

      positions.push(
        buildPosition({
          platform: 'kalshi',
          marketId: ticker,
          marketQuestion,
          outcome: side,
          outcomeId: `${ticker}-${side}`,
          side,
          shares,
          avgPrice,
          currentPrice,
        })
      );
    }

    await deps.credentials?.markSuccess(userId, 'kalshi');
    return positions;
  }

  async function fetchManifoldPositions(
    userId: string,
    creds: ManifoldCredentials
  ): Promise<Position[]> {
    if (!creds.apiKey) return [];
    const headers = { Authorization: `Key ${creds.apiKey}` };

    const meRes = await fetch('https://api.manifold.markets/v0/me', { headers });
    if (!meRes.ok) {
      throw new Error(`Manifold /me failed: ${meRes.status}`);
    }
    const meData = await meRes.json() as { id?: string; name?: string };
    if (!meData.id) return [];

    const betsRes = await fetch(`https://api.manifold.markets/v0/bets?userId=${meData.id}&limit=1000`, { headers });
    if (!betsRes.ok) {
      throw new Error(`Manifold bets fetch failed: ${betsRes.status}`);
    }
    const bets = await betsRes.json() as Array<Record<string, unknown>>;
    const byMarket = new Map<string, {
      question?: string;
      yesShares: number;
      noShares: number;
      yesInvested: number;
      noInvested: number;
    }>();

    for (const bet of bets || []) {
      if (bet.isSold || bet.isCancelled) continue;
      const marketId = bet.contractId as string;
      if (!marketId) continue;
      const entry = byMarket.get(marketId) || {
        question: bet.contractQuestion as string | undefined,
        yesShares: 0,
        noShares: 0,
        yesInvested: 0,
        noInvested: 0,
      };
      const shares = toNumber(bet.shares) ?? 0;
      const amount = toNumber(bet.amount) ?? 0;
      if ((bet.outcome as string) === 'YES') {
        entry.yesShares += shares;
        entry.yesInvested += amount;
      } else if ((bet.outcome as string) === 'NO') {
        entry.noShares += shares;
        entry.noInvested += amount;
      }
      if (!entry.question && bet.contractQuestion) {
        entry.question = bet.contractQuestion as string;
      }
      byMarket.set(marketId, entry);
    }

    const marketCache = new Map<string, Record<string, unknown>>();
    const positions: Position[] = [];

    for (const [marketId, entry] of byMarket.entries()) {
      if (entry.yesShares <= 0 && entry.noShares <= 0) continue;

      let market = marketCache.get(marketId);
      if (!market) {
        const marketRes = await fetch(`https://api.manifold.markets/v0/market/${marketId}`);
        if (marketRes.ok) {
          market = await marketRes.json() as Record<string, unknown>;
          marketCache.set(marketId, market);
        }
      }

      const question = (market?.question as string) || entry.question || marketId;
      const prob = toNumber(market?.probability) ?? 0.5;

      // Skip positions with invalid probability (would produce NaN downstream)
      if (!Number.isFinite(prob)) continue;

      if (entry.yesShares > 0) {
        const rawAvg = entry.yesShares > 0 ? entry.yesInvested / entry.yesShares : prob;
        const avg = Number.isFinite(rawAvg) ? rawAvg : prob;
        positions.push(
          buildPosition({
            platform: 'manifold',
            marketId,
            marketQuestion: question,
            outcome: 'YES',
            outcomeId: `${marketId}-YES`,
            side: 'YES',
            shares: entry.yesShares,
            avgPrice: avg,
            currentPrice: prob,
          })
        );
      }

      if (entry.noShares > 0) {
        const noPrice = Math.max(0, 1 - prob);
        const rawAvg = entry.noShares > 0 ? entry.noInvested / entry.noShares : noPrice;
        const avg = Number.isFinite(rawAvg) ? rawAvg : noPrice;
        positions.push(
          buildPosition({
            platform: 'manifold',
            marketId,
            marketQuestion: question,
            outcome: 'NO',
            outcomeId: `${marketId}-NO`,
            side: 'NO',
            shares: entry.noShares,
            avgPrice: avg,
            currentPrice: noPrice,
          })
        );
      }
    }

    await deps.credentials?.markSuccess(userId, 'manifold');
    return positions;
  }

  async function syncAllPortfolios(): Promise<void> {
    const credentials = deps.credentials;
    if (!credentials) {
      logger.warn('Portfolio sync skipped: credentials manager not configured');
      return;
    }

    const credentialUsers = deps.db.query<{ user_id: string }>(
      'SELECT DISTINCT user_id FROM trading_credentials WHERE enabled = 1'
    );
    const userIds = credentialUsers.map((row) => row.user_id);
    if (userIds.length === 0) return;

    for (const userId of userIds) {
      const user = deps.db.getUser(userId);
      if (!user) continue;

      const platforms = await credentials.listUserPlatforms(userId);
      if (platforms.length === 0) continue;

      for (const platform of platforms) {
        try {
          let positions: Position[] | null = null;
          if (platform === 'polymarket') {
            const creds = await credentials.getCredentials<PolymarketCredentials>(userId, 'polymarket');
            if (creds) positions = await fetchPolymarketPositions(userId, creds);
          } else if (platform === 'kalshi') {
            const creds = await credentials.getCredentials<KalshiCredentials>(userId, 'kalshi');
            if (creds) positions = await fetchKalshiPositions(userId, creds);
          } else if (platform === 'manifold') {
            const creds = await credentials.getCredentials<ManifoldCredentials>(userId, 'manifold');
            if (creds) positions = await fetchManifoldPositions(userId, creds);
          } else if (platform === 'hyperliquid') {
            const creds = await credentials.getCredentials<{ walletAddress: string; privateKey: string }>(userId, 'hyperliquid' as Platform);
            if (creds) {
              const hl = await import('../exchanges/hyperliquid/index');
              const state = await hl.getUserState(creds.walletAddress);
              positions = state.assetPositions
                .filter((ap) => parseFloat(ap.position.szi) !== 0)
                .map((ap) => {
                  const p = ap.position;
                  const shares = Math.abs(parseFloat(p.szi));
                  const entryPrice = parseFloat(p.entryPx);
                  const uPnl = parseFloat(p.unrealizedPnl);
                  const isLong = parseFloat(p.szi) > 0;
                  const currentPrice = shares > 0 ? entryPrice + uPnl / shares : entryPrice;
                  return buildPosition({
                    platform: 'hyperliquid',
                    marketId: p.coin,
                    marketQuestion: `${p.coin} Perp`,
                    outcome: isLong ? 'Long' : 'Short',
                    outcomeId: `hl_${p.coin}_${isLong ? 'long' : 'short'}`,
                    side: isLong ? 'LONG' : 'SHORT',
                    shares,
                    avgPrice: entryPrice,
                    currentPrice,
                  });
                });
            }
          } else if (platform === 'binance') {
            const creds = await credentials.getCredentials<{ apiKey: string; apiSecret: string }>(userId, 'binance' as Platform);
            if (creds) {
              const bin = await import('../exchanges/binance-futures/index');
              const rawPositions = await bin.getPositions(creds);
              positions = rawPositions
                .filter((p) => p.positionAmt !== 0)
                .map((p) => {
                  const isLong = p.positionAmt > 0;
                  return buildPosition({
                    platform: 'binance',
                    marketId: p.symbol,
                    marketQuestion: `${p.symbol} Perp`,
                    outcome: isLong ? 'Long' : 'Short',
                    outcomeId: `binance_${p.symbol}_${p.positionSide}`,
                    side: isLong ? 'LONG' : 'SHORT',
                    shares: Math.abs(p.positionAmt),
                    avgPrice: p.entryPrice,
                    currentPrice: p.markPrice,
                  });
                });
            }
          } else if (platform === 'bybit') {
            const creds = await credentials.getCredentials<{ apiKey: string; apiSecret: string }>(userId, 'bybit' as Platform);
            if (creds) {
              const bb = await import('../exchanges/bybit/index');
              const rawPositions = await bb.getPositions(creds);
              positions = rawPositions
                .filter((p) => p.size !== 0)
                .map((p) => {
                  const isLong = p.side === 'Buy';
                  return buildPosition({
                    platform: 'bybit',
                    marketId: p.symbol,
                    marketQuestion: `${p.symbol} Perp`,
                    outcome: isLong ? 'Long' : 'Short',
                    outcomeId: `bybit_${p.symbol}_${p.side}`,
                    side: isLong ? 'LONG' : 'SHORT',
                    shares: p.size,
                    avgPrice: p.entryPrice,
                    currentPrice: p.markPrice,
                  });
                });
            }
          } else if (platform === 'mexc') {
            const creds = await credentials.getCredentials<{ apiKey: string; apiSecret: string }>(userId, 'mexc' as Platform);
            if (creds) {
              const mx = await import('../exchanges/mexc/index');
              const rawPositions = await mx.getPositions(creds);
              positions = rawPositions
                .filter((p) => p.holdVol !== 0)
                .map((p) => {
                  const isLong = p.positionType === 1;
                  return buildPosition({
                    platform: 'mexc',
                    marketId: p.symbol,
                    marketQuestion: `${p.symbol} Perp`,
                    outcome: isLong ? 'Long' : 'Short',
                    outcomeId: `mexc_${p.symbol}_${isLong ? 'long' : 'short'}`,
                    side: isLong ? 'LONG' : 'SHORT',
                    shares: p.holdVol,
                    avgPrice: p.openAvgPrice,
                    currentPrice: p.markPrice,
                  });
                });
            }
          }

          if (!positions) continue;

          const existing = deps.db.getPositions(userId).filter((p) => p.platform === platform);
          const currentIds = new Set(positions.map((p) => p.outcomeId));

          for (const position of positions) {
            deps.db.upsertPosition(userId, position);
          }

          for (const position of existing) {
            if (!currentIds.has(position.outcomeId)) {
              deps.db.deletePosition(position.id);
            }
          }

          logger.info(
            { userId, platform, positions: positions.length, removed: Math.max(0, existing.length - currentIds.size) },
            'Portfolio sync complete'
          );
        } catch (error) {
          logger.warn({ error, userId, platform }, 'Portfolio sync failed');
          await credentials.markFailure(userId, platform);
        }
      }

      // Create portfolio snapshot after syncing all platforms for this user
      try {
        const allPositions = deps.db.getPositions(userId);
        if (allPositions.length > 0) {
          // Guard: skip positions with NaN values to prevent poisoning totals
          const validPositions = allPositions.filter(p =>
            Number.isFinite(p.value) && Number.isFinite(p.shares) && Number.isFinite(p.avgPrice)
          );
          const totalValue = validPositions.reduce((sum, p) => sum + p.value, 0);
          const totalCostBasis = validPositions.reduce((sum, p) => sum + (p.shares * p.avgPrice), 0);
          const totalPnl = totalValue - totalCostBasis;
          const totalPnlPct = totalCostBasis > 0 ? (totalPnl / totalCostBasis) * 100 : 0;

          const byPlatform: Record<string, { value: number; pnl: number }> = {};
          for (const p of validPositions) {
            const entry = byPlatform[p.platform] || { value: 0, pnl: 0 };
            entry.value += p.value;
            entry.pnl += p.value - (p.shares * p.avgPrice);
            byPlatform[p.platform] = entry;
          }

          deps.db.createPortfolioSnapshot({
            userId,
            totalValue,
            totalPnl,
            totalPnlPct,
            totalCostBasis,
            positionsCount: allPositions.length,
            byPlatform,
          });
          logger.debug({ userId, totalValue, positionsCount: allPositions.length }, 'Portfolio snapshot created');
        }
      } catch (error) {
        logger.warn({ error, userId }, 'Failed to create portfolio snapshot');
      }
    }

    // Clean up old snapshots (>90 days)
    try {
      const cutoffMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
      deps.db.deletePortfolioSnapshotsBefore(cutoffMs);
    } catch (error) {
      logger.warn({ error }, 'Failed to clean up old portfolio snapshots');
    }
  }

  function normalizeStopLossPct(value: number | undefined): number | null {
    if (value === undefined || value === null) return null;
    if (!Number.isFinite(value)) return null;
    if (value <= 0) return null;
    return value >= 1 ? value / 100 : value;
  }

  async function executeStopLoss(
    user: User,
    position: Position
  ): Promise<{ status: 'executed' | 'failed' | 'dry-run' | 'skipped'; output?: string; error?: string }> {
    if (!deps.credentials) {
      return { status: 'skipped', error: 'Credentials manager not configured' };
    }

    if (!Number.isFinite(position.shares) || position.shares <= 0) {
      return { status: 'skipped', error: 'No position size' };
    }

    const dryRun = deps.config?.trading?.dryRun !== false;
    if (dryRun) {
      return { status: 'dry-run' };
    }

    const platform = position.platform;

    if (platform === 'polymarket') {
      const creds = await deps.credentials.getCredentials<PolymarketCredentials>(user.id, 'polymarket');
      if (!creds) return { status: 'skipped', error: 'Missing Polymarket credentials' };
      const tokenId = position.outcomeId;
      const size = position.shares;
      try {
        // Use execution module directly for market sell
        const { createExecutionService } = await import('../execution');
        const execSvc = createExecutionService({
          polymarket: {
            address: creds.funderAddress,
            apiKey: creds.apiKey,
            apiSecret: creds.apiSecret,
            apiPassphrase: creds.apiPassphrase,
            privateKey: creds.privateKey,
            funderAddress: creds.funderAddress,
          },
          dryRun: false,
        });
        const result = await execSvc.marketSell({ platform: 'polymarket', marketId: tokenId, tokenId, size });
        await deps.credentials.markSuccess(user.id, 'polymarket');
        return { status: 'executed', output: JSON.stringify(result) };
      } catch (err: unknown) {
        const error = err as Error;
        await deps.credentials.markFailure(user.id, 'polymarket');
        return { status: 'failed', error: error.message };
      }
    }

    if (platform === 'kalshi') {
      const creds = await deps.credentials.getCredentials<KalshiCredentials>(user.id, 'kalshi');
      if (!creds) return { status: 'skipped', error: 'Missing Kalshi credentials' };
      const ticker = position.marketId;
      const side = position.side.toLowerCase();
      const count = Math.round(position.shares);
      try {
        const url = 'https://api.elections.kalshi.com/trade-api/v2/portfolio/orders';
        if (!creds.apiKeyId || !creds.privateKeyPem) return { status: 'skipped', error: 'Missing Kalshi API key or private key' };
        const auth = { apiKeyId: creds.apiKeyId, privateKeyPem: creds.privateKeyPem };
        const headers = { ...buildKalshiHeadersForUrl(auth, 'POST', url), 'Content-Type': 'application/json' };
        const body = JSON.stringify({ ticker, action: 'sell', side, count, type: 'market' });
        const response = await fetch(url, { method: 'POST', headers, body });
        const data = await response.json();
        await deps.credentials.markSuccess(user.id, 'kalshi');
        return { status: 'executed', output: JSON.stringify(data) };
      } catch (err: unknown) {
        const error = err as Error;
        await deps.credentials.markFailure(user.id, 'kalshi');
        return { status: 'failed', error: error.message };
      }
    }

    if (platform === 'manifold') {
      const creds = await deps.credentials.getCredentials<ManifoldCredentials>(user.id, 'manifold');
      if (!creds) return { status: 'skipped', error: 'Missing Manifold credentials' };
      const apiKey = creds.apiKey;
      const body: Record<string, unknown> = {
        contractId: position.marketId,
        outcome: position.side,
        shares: position.shares,
      };
      try {
        const response = await fetch(`https://api.manifold.markets/v0/market/${position.marketId}/sell`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Key ${apiKey}`,
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const errorText = await response.text();
          await deps.credentials.markFailure(user.id, 'manifold');
          return { status: 'failed', error: errorText };
        }
        await deps.credentials.markSuccess(user.id, 'manifold');
        const result = await response.json();
        return { status: 'executed', output: JSON.stringify(result) };
      } catch (err: unknown) {
        const error = err as Error;
        await deps.credentials.markFailure(user.id, 'manifold');
        return { status: 'failed', error: error.message };
      }
    }

    return { status: 'skipped', error: `Unsupported platform: ${platform}` };
  }

  async function scanStopLosses(): Promise<void> {
    const users = deps.db.listUsers();
    if (users.length === 0) return;

    const cooldownMs = deps.config?.trading?.stopLossCooldownMs ?? 10 * 60 * 1000;
    const now = Date.now();

    for (const user of users) {
      const stopLossPct = normalizeStopLossPct(user.settings?.stopLossPct);
      if (!stopLossPct) continue;

      const positions = deps.db.getPositions(user.id);
      if (positions.length === 0) continue;

      for (const position of positions) {
        if (!position.avgPrice || !position.currentPrice) continue;
        const threshold = position.avgPrice * (1 - stopLossPct);
        if (position.currentPrice > threshold) continue;

        const existing = deps.db.getStopLossTrigger(user.id, position.platform, position.outcomeId);
        if (existing?.cooldownUntil && existing.cooldownUntil.getTime() > now) {
          continue;
        }

        const result = await executeStopLoss(user, position);

        const cooldownUntil = new Date(now + cooldownMs);
        deps.db.upsertStopLossTrigger({
          userId: user.id,
          platform: position.platform,
          outcomeId: position.outcomeId,
          marketId: position.marketId,
          status: result.status,
          triggeredAt: new Date(now),
          lastPrice: position.currentPrice,
          lastError: result.error,
          cooldownUntil,
        });

        const target = resolveAlertRecipient(user.id);
        if (target) {
          const lines = [
            '🛑 Stop-loss triggered',
            `${position.marketQuestion || position.marketId} (${position.platform})`,
            `Side: ${position.side}`,
            `Price: ${position.currentPrice.toFixed(4)} (avg ${position.avgPrice.toFixed(4)})`,
            `Threshold: ${threshold.toFixed(4)} (${Math.round(stopLossPct * 100)}%)`,
            result.status === 'executed' ? `Sold ${position.shares} shares.` : `Status: ${result.status}`,
          ];
          if (result.error) {
            lines.push(`Error: ${result.error}`);
          }
          if (result.status === 'dry-run') {
            lines.push('Dry run enabled - no trade executed.');
          }
          await deps.sendMessage({
            platform: target.platform,
            chatId: target.chatId,
            text: lines.join('\n'),
          });
        }
      }
    }
  }

  /** Schedule a job's next execution */
  function scheduleJob(job: CronJob): void {
    // Clear existing timer
    const existing = timers.get(job.id);
    if (existing) {
      clearTimeout(existing);
      timers.delete(job.id);
    }

    if (!job.enabled || !running) return;

    const nextRun = calculateNextRun(job.schedule, job.state.lastRunAtMs);
    if (nextRun < 0) {
      if (job.deleteAfterRun) {
        jobs.delete(job.id);
      }
      return;
    }

    job.state.nextRunAtMs = nextRun;

    const delay = Math.max(0, nextRun - Date.now());
    const timer = setTimeout(() => {
      timers.delete(job.id);
      executeJobInternal(job).catch(error => {
        logger.error({ error, jobId: job.id, name: job.name }, 'Cron job execution failed');
      });
    }, delay);

    timers.set(job.id, timer);
    emitter.emit('event', { type: 'job:scheduled', job } as CronEvent);
    logger.debug({ jobId: job.id, name: job.name, nextRun: new Date(nextRun) }, 'Job scheduled');
    persistJob(job);
  }

  /** Execute a job */
  async function executeJobInternal(job: CronJob): Promise<void> {
    if (!job.enabled) {
      emitter.emit('event', { type: 'job:skipped', job, reason: 'disabled' } as CronEvent);
      return;
    }

    // Prevent concurrent execution of the same job
    if (job.state.runningAtMs) {
      emitter.emit('event', { type: 'job:skipped', job, reason: 'already running' } as CronEvent);
      logger.debug({ jobId: job.id, name: job.name }, 'Skipping cron job: already running');
      return;
    }

    job.state.runningAtMs = Date.now();
    emitter.emit('event', { type: 'job:started', job } as CronEvent);
    logger.info({ jobId: job.id, name: job.name }, 'Running cron job');

    const startTime = Date.now();
    try {
      await executeJob(job);

      const durationMs = Date.now() - startTime;
      job.state.lastRunAtMs = startTime;
      job.state.lastStatus = 'ok';
      job.state.lastDurationMs = durationMs;
      job.state.lastError = undefined;
      job.state.runningAtMs = undefined;

      emitter.emit('event', { type: 'job:completed', job, durationMs } as CronEvent);
      logger.info({ jobId: job.id, name: job.name, durationMs }, 'Cron job completed');
      persistJob(job);

      if (job.deleteAfterRun && job.schedule.kind === 'at') {
        jobs.delete(job.id);
      } else {
        scheduleJob(job);
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      job.state.lastRunAtMs = startTime;
      job.state.lastStatus = 'error';
      job.state.lastError = errorMsg;
      job.state.lastDurationMs = durationMs;
      job.state.runningAtMs = undefined;

      emitter.emit('event', { type: 'job:failed', job, error: errorMsg } as CronEvent);
      logger.error({ jobId: job.id, name: job.name, error: errorMsg }, 'Cron job failed');
      persistJob(job);

      if (job.schedule.kind !== 'at') {
        scheduleJob(job);
      }
    }
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  emitter.start = async () => {
    if (running) return;
    running = true;

    logger.info('Starting cron service');

    const cronConfig = deps.config?.cron ?? {};
    if (cronConfig.enabled === false) {
      logger.info('Cron service disabled by configuration');
      running = false;
      return;
    }
    const alertScanIntervalMs = cronConfig.alertScanIntervalMs ?? 30000;
    const digestIntervalMs = cronConfig.digestIntervalMs ?? 5 * 60 * 1000;
    const portfolioSyncIntervalMs = cronConfig.portfolioSyncIntervalMs ?? 60 * 60 * 1000;
    const stopLossIntervalMs = cronConfig.stopLossIntervalMs ?? 2 * 60 * 1000;

    if (jobs.size === 0) {
      loadPersistedJobs();
    }

    // Add default alert scan job if none exists
    if (!Array.from(jobs.values()).some((j) => j.payload.kind === 'alertScan')) {
      emitter.add({
        name: 'Alert Scanner',
        description: 'Check all price alerts every 30 seconds',
        enabled: true,
        schedule: { kind: 'every', everyMs: alertScanIntervalMs },
        sessionTarget: 'main',
        wakeMode: 'now',
        payload: { kind: 'alertScan' },
      });
    }

    if (!Array.from(jobs.values()).some((j) => j.payload.kind === 'portfolioSync')) {
      emitter.add({
        name: 'Portfolio Sync',
        description: 'Sync portfolio positions from linked trading accounts',
        enabled: true,
        schedule: { kind: 'every', everyMs: portfolioSyncIntervalMs },
        sessionTarget: 'main',
        wakeMode: 'now',
        payload: { kind: 'portfolioSync' },
      });
    }

    if (!Array.from(jobs.values()).some((j) => j.payload.kind === 'dailyDigest')) {
      emitter.add({
        name: 'Daily Digest',
        description: 'Send daily digest messages to users who enabled it',
        enabled: true,
        schedule: { kind: 'every', everyMs: digestIntervalMs },
        sessionTarget: 'main',
        wakeMode: 'now',
        payload: { kind: 'dailyDigest' },
      });
    }

    if (
      stopLossIntervalMs > 0 &&
      !Array.from(jobs.values()).some((j) => j.payload.kind === 'stopLossScan')
    ) {
      emitter.add({
        name: 'Stop-Loss Scanner',
        description: 'Monitor positions and execute stop-loss orders',
        enabled: true,
        schedule: { kind: 'every', everyMs: stopLossIntervalMs },
        sessionTarget: 'main',
        wakeMode: 'now',
        payload: { kind: 'stopLossScan' },
      });
    }

    // Schedule all enabled jobs
    for (const job of jobs.values()) {
      scheduleJob(job);
    }

    // Tick every minute to catch any drift
    tickInterval = setInterval(() => {
      const now = Date.now();
      for (const job of jobs.values()) {
        if (job.enabled && job.state.nextRunAtMs && job.state.nextRunAtMs <= now && !job.state.runningAtMs) {
          scheduleJob(job);
        }
      }
    }, 60000);

    logger.info('Cron service started');
  };

  emitter.stop = () => {
    if (!running) return;
    running = false;

    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();

    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }

    logger.info('Cron service stopped');
  };

  emitter.status = () => {
    let nextJobAt: number | undefined;
    for (const job of jobs.values()) {
      if (job.enabled && job.state.nextRunAtMs) {
        if (!nextJobAt || job.state.nextRunAtMs < nextJobAt) {
          nextJobAt = job.state.nextRunAtMs;
        }
      }
    }

    return { running, jobCount: jobs.size, nextJobAt };
  };

  emitter.list = (opts) => {
    const all = Array.from(jobs.values());
    return opts?.includeDisabled ? all : all.filter((j) => j.enabled);
  };

  emitter.get = (id) => jobs.get(id);

  emitter.add = (input) => {
    const now = Date.now();
    const job: CronJob = {
      id: generateId(),
      ...input,
      createdAtMs: now,
      updatedAtMs: now,
      state: input.state || {},
    };

    jobs.set(job.id, job);
    logger.info({ jobId: job.id, name: job.name }, 'Cron job added');

    if (running && job.enabled) {
      scheduleJob(job);
    }

    persistJob(job);
    return job;
  };

  emitter.update = (id, patch) => {
    const job = jobs.get(id);
    if (!job) return null;

    const updated: CronJob = {
      ...job,
      ...patch,
      id: job.id,
      createdAtMs: job.createdAtMs,
      updatedAtMs: Date.now(),
      state: { ...job.state, ...patch.state },
    };

    jobs.set(id, updated);
    logger.info({ jobId: id, name: updated.name }, 'Cron job updated');

    if (running) {
      scheduleJob(updated);
    }

    persistJob(updated);
    return updated;
  };

  emitter.remove = (id) => {
    const job = jobs.get(id);
    if (!job) return false;

    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }

    jobs.delete(id);
    deps.db.deleteCronJob(id);
    logger.info({ jobId: id, name: job.name }, 'Cron job removed');

    return true;
  };

  emitter.run = async (id, mode = 'due') => {
    const job = jobs.get(id);
    if (!job) return false;

    if (mode === 'due') {
      const nextRun = calculateNextRun(job.schedule, job.state.lastRunAtMs);
      if (nextRun > Date.now()) {
        return false;
      }
    }

    await executeJobInternal(job);
    return true;
  };

  return emitter;
}

// =============================================================================
// LEGACY EXPORT (backward compat)
// =============================================================================

export interface CronManager {
  start(): void;
  stop(): void;
}

export function createCronManager(
  db: Database,
  feeds: FeedManager,
  sendMessage: (msg: OutgoingMessage) => Promise<string | null>
): CronManager {
  const service = createCronService({ db, feeds, sendMessage });

  return {
    start() {
      service.start().catch(error => {
        logger.error({ error }, 'Cron service start failed');
      });
    },
    stop() {
      service.stop();
    },
  };
}
