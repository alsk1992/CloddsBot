/**
 * Alert Service - Price monitoring and notification delivery
 *
 * Features:
 * - Price alerts (above/below threshold)
 * - Volume spike alerts
 * - Edge detection alerts
 * - Delivery via chat channels (Telegram, Discord, etc.)
 * - Persistent storage in SQLite
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '../utils/logger';
import { Database } from '../db/index';
import type { ChannelManager } from '../channels/index';

// =============================================================================
// TYPES
// =============================================================================

export type AlertType = 'price_above' | 'price_below' | 'price_change' | 'volume_spike' | 'edge';
export type AlertStatus = 'active' | 'triggered' | 'disabled' | 'expired';

export interface Alert {
  id: string;
  userId: string;
  platform: 'polymarket' | 'kalshi' | 'all';
  marketId: string;
  marketQuestion?: string;
  type: AlertType;
  threshold: number;
  /** For price_change: percentage threshold */
  changePct?: number;
  /** For volume_spike: time window in seconds */
  timeWindowSecs?: number;
  /** Channel to deliver notification */
  deliveryChannel: string;
  deliveryChatId: string;
  status: AlertStatus;
  createdAt: Date;
  triggeredAt?: Date;
  /** Last checked price */
  lastPrice?: number;
  /** One-time or repeating */
  oneTime: boolean;
  /** Cooldown between triggers (seconds) */
  cooldownSecs?: number;
  lastTriggeredAt?: Date;
}

export interface AlertConfig {
  /** Polling interval in milliseconds */
  pollIntervalMs?: number;
  /** Default cooldown between repeated alerts */
  defaultCooldownSecs?: number;
  /** Deduplication window in seconds (default: 60) */
  deduplicationWindowSecs?: number;
  /** Enable alert deduplication (default: true) */
  enableDeduplication?: boolean;
}

export interface PriceProvider {
  getPrice(platform: string, marketId: string): Promise<number | null>;
  getVolume24h?(platform: string, marketId: string): Promise<number | null>;
}

export interface AlertService extends EventEmitter {
  /** Create a price alert */
  createPriceAlert(params: {
    userId: string;
    platform: 'polymarket' | 'kalshi';
    marketId: string;
    marketQuestion?: string;
    type: 'price_above' | 'price_below';
    threshold: number;
    deliveryChannel: string;
    deliveryChatId: string;
    oneTime?: boolean;
  }): Alert;

  /** Create a price change alert */
  createPriceChangeAlert(params: {
    userId: string;
    platform: 'polymarket' | 'kalshi';
    marketId: string;
    marketQuestion?: string;
    changePct: number;
    timeWindowSecs: number;
    deliveryChannel: string;
    deliveryChatId: string;
  }): Alert;

  /** Create a volume spike alert */
  createVolumeAlert(params: {
    userId: string;
    platform: 'polymarket' | 'kalshi';
    marketId: string;
    marketQuestion?: string;
    threshold: number;
    deliveryChannel: string;
    deliveryChatId: string;
  }): Alert;

  /** Get all alerts for a user */
  getAlerts(userId: string): Alert[];

  /** Get alert by ID */
  getAlert(alertId: string): Alert | null;

  /** Delete an alert */
  deleteAlert(alertId: string): boolean;

  /** Disable an alert */
  disableAlert(alertId: string): boolean;

  /** Enable an alert */
  enableAlert(alertId: string): boolean;

  /** Start monitoring (background loop) */
  startMonitoring(): void;

  /** Stop monitoring */
  stopMonitoring(): void;

  /** Check alerts manually (one iteration) */
  checkAlerts(): Promise<void>;

  /** Format alerts list for chat */
  formatAlertsList(userId: string): string;
}

// =============================================================================
// ALERT SERVICE
// =============================================================================

const DEFAULT_CONFIG: AlertConfig = {
  pollIntervalMs: 10000, // 10 seconds
  defaultCooldownSecs: 300, // 5 minutes
  deduplicationWindowSecs: 60, // 1 minute
  enableDeduplication: true,
};

export function createAlertService(
  priceProvider: PriceProvider,
  channelManager: ChannelManager | null,
  db?: Database,
  configInput?: AlertConfig
): AlertService {
  const config = { ...DEFAULT_CONFIG, ...configInput };
  const emitter = new EventEmitter() as AlertService;
  const alerts = new Map<string, Alert>();
  let monitoringInterval: NodeJS.Timeout | null = null;
  let isMonitoring = false;

  // Track price history for change alerts
  const priceHistory = new Map<string, { price: number; timestamp: number }[]>();

  // Alert deduplication cache: hash -> timestamp
  const deduplicationCache = new Map<string, number>();

  /**
   * Generate deduplication hash for an alert trigger
   */
  function getDeduplicationHash(alert: Alert, currentPrice: number): string {
    // Hash based on: user, market, type, threshold, and price bucket
    const priceBucket = Math.floor(currentPrice * 100); // Round to cents
    return `${alert.userId}:${alert.platform}:${alert.marketId}:${alert.type}:${alert.threshold}:${priceBucket}`;
  }

  /**
   * Check if alert is a duplicate (already sent recently)
   */
  function isDuplicateAlert(hash: string): boolean {
    if (!config.enableDeduplication) return false;

    const lastSent = deduplicationCache.get(hash);
    if (!lastSent) return false;

    const windowMs = (config.deduplicationWindowSecs || 60) * 1000;
    return Date.now() - lastSent < windowMs;
  }

  /**
   * Record alert as sent for deduplication
   */
  function recordAlertSent(hash: string): void {
    if (!config.enableDeduplication) return;
    deduplicationCache.set(hash, Date.now());

    // Clean up old entries periodically
    if (deduplicationCache.size > 1000) {
      const cutoff = Date.now() - (config.deduplicationWindowSecs || 60) * 1000;
      for (const [key, timestamp] of deduplicationCache) {
        if (timestamp < cutoff) {
          deduplicationCache.delete(key);
        }
      }
    }
  }

  // Initialize database if provided
  if (db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        platform TEXT NOT NULL,
        marketId TEXT NOT NULL,
        marketQuestion TEXT,
        type TEXT NOT NULL,
        threshold REAL NOT NULL,
        changePct REAL,
        timeWindowSecs INTEGER,
        deliveryChannel TEXT NOT NULL,
        deliveryChatId TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        triggeredAt TEXT,
        lastPrice REAL,
        oneTime INTEGER NOT NULL,
        cooldownSecs INTEGER,
        lastTriggeredAt TEXT
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(userId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status)`);

    // Load existing alerts
    try {
      // Raw DB row type (SQLite stores bools as integers, dates as strings)
      type AlertRow = Omit<Alert, 'createdAt' | 'triggeredAt' | 'lastTriggeredAt' | 'oneTime'> & {
        createdAt: string;
        triggeredAt: string | null;
        lastTriggeredAt: string | null;
        oneTime: number;
      };
      const rows = db.query<AlertRow>(
        "SELECT * FROM alerts WHERE status = 'active'"
      );
      for (const row of rows) {
        alerts.set(row.id, {
          ...row,
          createdAt: new Date(row.createdAt),
          triggeredAt: row.triggeredAt ? new Date(row.triggeredAt) : undefined,
          lastTriggeredAt: row.lastTriggeredAt ? new Date(row.lastTriggeredAt) : undefined,
          oneTime: Boolean(row.oneTime),
        });
      }
      logger.info({ count: alerts.size }, 'Loaded alerts from database');
    } catch (err) {
      logger.debug('No existing alerts in database');
    }
  }

  function generateId(): string {
    return `alert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function saveAlert(alert: Alert): void {
    alerts.set(alert.id, alert);

    if (db) {
      db.run(
        `INSERT OR REPLACE INTO alerts
         (id, userId, platform, marketId, marketQuestion, type, threshold, changePct, timeWindowSecs,
          deliveryChannel, deliveryChatId, status, createdAt, triggeredAt, lastPrice, oneTime, cooldownSecs, lastTriggeredAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          alert.id,
          alert.userId,
          alert.platform,
          alert.marketId,
          alert.marketQuestion || null,
          alert.type,
          alert.threshold,
          alert.changePct || null,
          alert.timeWindowSecs || null,
          alert.deliveryChannel,
          alert.deliveryChatId,
          alert.status,
          alert.createdAt.toISOString(),
          alert.triggeredAt?.toISOString() || null,
          alert.lastPrice || null,
          alert.oneTime ? 1 : 0,
          alert.cooldownSecs || null,
          alert.lastTriggeredAt?.toISOString() || null,
        ]
      );
    }
  }

  async function deliverAlert(alert: Alert, currentPrice: number): Promise<void> {
    const priceStr = `$${currentPrice.toFixed(3)}`;
    const thresholdStr = `$${alert.threshold.toFixed(3)}`;

    let message = '';
    switch (alert.type) {
      case 'price_above':
        message = `🔔 **Price Alert Triggered**\n\n` +
          `${alert.marketQuestion || alert.marketId}\n\n` +
          `Price is now **${priceStr}** (above ${thresholdStr})`;
        break;
      case 'price_below':
        message = `🔔 **Price Alert Triggered**\n\n` +
          `${alert.marketQuestion || alert.marketId}\n\n` +
          `Price is now **${priceStr}** (below ${thresholdStr})`;
        break;
      case 'price_change':
        message = `🔔 **Price Change Alert**\n\n` +
          `${alert.marketQuestion || alert.marketId}\n\n` +
          `Price changed by ${alert.changePct}% to **${priceStr}**`;
        break;
      case 'volume_spike':
        message = `🔔 **Volume Spike Alert**\n\n` +
          `${alert.marketQuestion || alert.marketId}\n\n` +
          `Volume exceeded threshold of ${alert.threshold.toLocaleString()}`;
        break;
    }

    // Deliver via channel manager
    if (channelManager) {
      try {
        await channelManager.send({
          platform: alert.deliveryChannel,
          chatId: alert.deliveryChatId,
          text: message,
        });
        logger.info({ alertId: alert.id, channel: alert.deliveryChannel }, 'Alert delivered');
      } catch (error) {
        logger.error({ error, alertId: alert.id }, 'Failed to deliver alert');
      }
    }

    // Emit event
    emitter.emit('triggered', alert, currentPrice);
  }

  async function checkAlert(alert: Alert): Promise<boolean> {
    if (alert.status !== 'active') return false;

    // Check cooldown for repeating alerts
    if (!alert.oneTime && alert.lastTriggeredAt && alert.cooldownSecs) {
      const elapsed = (Date.now() - alert.lastTriggeredAt.getTime()) / 1000;
      if (elapsed < alert.cooldownSecs) return false;
    }

    const price = await priceProvider.getPrice(alert.platform, alert.marketId);
    if (price === null) return false;

    alert.lastPrice = price;

    let triggered = false;

    switch (alert.type) {
      case 'price_above':
        triggered = price >= alert.threshold;
        break;
      case 'price_below':
        triggered = price <= alert.threshold;
        break;
      case 'price_change':
        // Check price history
        const key = `${alert.platform}_${alert.marketId}`;
        const history = priceHistory.get(key) || [];
        const now = Date.now();
        const windowMs = (alert.timeWindowSecs || 300) * 1000;

        // Add current price to history
        history.push({ price, timestamp: now });

        // Remove old entries
        const cutoff = now - windowMs;
        const filtered = history.filter((h) => h.timestamp >= cutoff);
        priceHistory.set(key, filtered);

        // Check if price changed by threshold
        if (filtered.length > 1) {
          const oldest = filtered[0].price;
          const changePct = Math.abs((price - oldest) / oldest) * 100;
          triggered = changePct >= (alert.changePct || 5);
        }
        break;
      case 'volume_spike':
        if (priceProvider.getVolume24h) {
          const volume = await priceProvider.getVolume24h(alert.platform, alert.marketId);
          triggered = volume !== null && volume >= alert.threshold;
        }
        break;
    }

    if (triggered) {
      // Check for duplicate alert
      const dedupHash = getDeduplicationHash(alert, price);
      if (isDuplicateAlert(dedupHash)) {
        logger.debug({ alertId: alert.id, dedupHash }, 'Alert deduplicated (already sent recently)');
        return false;
      }

      // Record this alert as sent
      recordAlertSent(dedupHash);

      alert.triggeredAt = new Date();
      alert.lastTriggeredAt = new Date();

      if (alert.oneTime) {
        alert.status = 'triggered';
      }

      saveAlert(alert);
      await deliverAlert(alert, price);
      return true;
    }

    return false;
  }

  // Attach methods to emitter
  Object.assign(emitter, {
    createPriceAlert(params) {
      const alert: Alert = {
        id: generateId(),
        userId: params.userId,
        platform: params.platform,
        marketId: params.marketId,
        marketQuestion: params.marketQuestion,
        type: params.type,
        threshold: params.threshold,
        deliveryChannel: params.deliveryChannel,
        deliveryChatId: params.deliveryChatId,
        status: 'active',
        createdAt: new Date(),
        oneTime: params.oneTime ?? true,
        cooldownSecs: config.defaultCooldownSecs,
      };

      saveAlert(alert);
      logger.info({ alertId: alert.id, type: alert.type, threshold: alert.threshold }, 'Created price alert');

      return alert;
    },

    createPriceChangeAlert(params) {
      const alert: Alert = {
        id: generateId(),
        userId: params.userId,
        platform: params.platform,
        marketId: params.marketId,
        marketQuestion: params.marketQuestion,
        type: 'price_change',
        threshold: 0,
        changePct: params.changePct,
        timeWindowSecs: params.timeWindowSecs,
        deliveryChannel: params.deliveryChannel,
        deliveryChatId: params.deliveryChatId,
        status: 'active',
        createdAt: new Date(),
        oneTime: false, // Price change alerts are repeating
        cooldownSecs: config.defaultCooldownSecs,
      };

      saveAlert(alert);
      logger.info({ alertId: alert.id, changePct: params.changePct }, 'Created price change alert');

      return alert;
    },

    createVolumeAlert(params) {
      const alert: Alert = {
        id: generateId(),
        userId: params.userId,
        platform: params.platform,
        marketId: params.marketId,
        marketQuestion: params.marketQuestion,
        type: 'volume_spike',
        threshold: params.threshold,
        deliveryChannel: params.deliveryChannel,
        deliveryChatId: params.deliveryChatId,
        status: 'active',
        createdAt: new Date(),
        oneTime: true,
        cooldownSecs: config.defaultCooldownSecs,
      };

      saveAlert(alert);
      logger.info({ alertId: alert.id, threshold: params.threshold }, 'Created volume alert');

      return alert;
    },

    getAlerts(userId) {
      return Array.from(alerts.values()).filter((a) => a.userId === userId);
    },

    getAlert(alertId) {
      return alerts.get(alertId) || null;
    },

    deleteAlert(alertId) {
      const existed = alerts.delete(alertId);
      if (existed && db) {
        db.run('DELETE FROM alerts WHERE id = ?', [alertId]);
      }
      return existed;
    },

    disableAlert(alertId) {
      const alert = alerts.get(alertId);
      if (!alert) return false;

      alert.status = 'disabled';
      saveAlert(alert);
      return true;
    },

    enableAlert(alertId) {
      const alert = alerts.get(alertId);
      if (!alert) return false;

      alert.status = 'active';
      saveAlert(alert);
      return true;
    },

    startMonitoring() {
      if (isMonitoring) return;

      isMonitoring = true;
      logger.info({ interval: config.pollIntervalMs }, 'Starting alert monitoring');

      monitoringInterval = setInterval(async () => {
        await emitter.checkAlerts();
      }, config.pollIntervalMs);

      // Initial check
      emitter.checkAlerts();
    },

    stopMonitoring() {
      if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
      }
      isMonitoring = false;
      logger.info('Stopped alert monitoring');
    },

    async checkAlerts() {
      const activeAlerts = Array.from(alerts.values()).filter((a) => a.status === 'active');

      for (const alert of activeAlerts) {
        try {
          await checkAlert(alert);
        } catch (error) {
          logger.error({ error, alertId: alert.id }, 'Error checking alert');
        }
      }
    },

    formatAlertsList(userId) {
      const userAlerts = emitter.getAlerts(userId);

      if (userAlerts.length === 0) {
        return '📭 No active alerts';
      }

      let text = `🔔 **Your Alerts** (${userAlerts.length})\n\n`;

      for (const alert of userAlerts) {
        const statusEmoji = alert.status === 'active' ? '✅' : alert.status === 'triggered' ? '🔔' : '⏸️';
        const question = alert.marketQuestion
          ? alert.marketQuestion.slice(0, 35) + (alert.marketQuestion.length > 35 ? '...' : '')
          : alert.marketId;

        text += `${statusEmoji} **${alert.type.replace('_', ' ')}**\n`;
        text += `   ${question}\n`;

        if (alert.type === 'price_above' || alert.type === 'price_below') {
          text += `   Threshold: $${alert.threshold.toFixed(3)}\n`;
        } else if (alert.type === 'price_change') {
          text += `   Change: ${alert.changePct}% in ${alert.timeWindowSecs}s\n`;
        } else if (alert.type === 'volume_spike') {
          text += `   Volume: ${alert.threshold.toLocaleString()}\n`;
        }

        if (alert.lastPrice) {
          text += `   Last: $${alert.lastPrice.toFixed(3)}\n`;
        }

        text += `   ID: \`${alert.id.slice(0, 12)}\`\n\n`;
      }

      return text;
    },
  } as Partial<AlertService>);

  return emitter;
}

// =============================================================================
// REALTIME ALERTS EXPORTS
// =============================================================================

export {
  createRealtimeAlertsService,
  connectWhaleTracker,
  connectOpportunityFinder,
  type RealtimeAlertsConfig,
  type RealtimeAlertsService,
  type AlertTarget,
} from './realtime';
