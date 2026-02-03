/**
 * Alert System
 *
 * Features:
 * - Configurable alert thresholds
 * - Discord/Slack webhook integration
 * - Rate limiting for alert spam prevention
 * - Alert levels: info, warning, critical
 * - Alert history and deduplication
 */

import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export type AlertLevel = 'info' | 'warning' | 'critical';

export interface AlertConfig {
  /** Alert name/identifier */
  name: string;
  /** Alert description */
  description?: string;
  /** Alert level */
  level: AlertLevel;
  /** Threshold configuration */
  threshold: AlertThreshold;
  /** Cooldown between alerts in ms (default: 300000 = 5 min) */
  cooldownMs?: number;
  /** Whether this alert is enabled (default: true) */
  enabled?: boolean;
  /** Tags for filtering */
  tags?: string[];
}

export interface AlertThreshold {
  /** Metric name to monitor */
  metric: string;
  /** Comparison operator */
  operator: '>' | '>=' | '<' | '<=' | '==' | '!=';
  /** Threshold value */
  value: number;
  /** Sustained duration before alerting in ms (default: 0) */
  sustainedMs?: number;
  /** Labels to filter metrics */
  labels?: Record<string, string>;
}

export interface Alert {
  id: string;
  name: string;
  level: AlertLevel;
  message: string;
  value?: number;
  threshold?: number;
  timestamp: number;
  source?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface WebhookConfig {
  /** Webhook type */
  type: 'discord' | 'slack' | 'generic';
  /** Webhook URL */
  url: string;
  /** Optional name/identifier */
  name?: string;
  /** Minimum alert level to send (default: 'warning') */
  minLevel?: AlertLevel;
  /** Whether this webhook is enabled (default: true) */
  enabled?: boolean;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Rate limit per minute (default: 10) */
  rateLimitPerMinute?: number;
}

export interface AlertManagerConfig {
  /** Global alert enable/disable */
  enabled?: boolean;
  /** Default cooldown between duplicate alerts in ms */
  defaultCooldownMs?: number;
  /** Maximum alerts to keep in history */
  maxHistorySize?: number;
  /** Webhook configurations */
  webhooks?: WebhookConfig[];
  /** Alert configurations */
  alerts?: AlertConfig[];
}

// =============================================================================
// ALERT MANAGER
// =============================================================================

export class AlertManager {
  private config: Required<AlertManagerConfig>;
  private webhooks: Map<string, WebhookConfig & { lastSent: Map<string, number>; sentCount: number; sentResetAt: number }> = new Map();
  private alertHistory: Alert[] = [];
  private lastAlertTimes: Map<string, number> = new Map();
  private sustainedStates: Map<string, { value: number; startTime: number }> = new Map();
  private alertConfigs: Map<string, AlertConfig> = new Map();

  constructor(config: AlertManagerConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      defaultCooldownMs: config.defaultCooldownMs ?? 300000, // 5 minutes
      maxHistorySize: config.maxHistorySize ?? 1000,
      webhooks: config.webhooks ?? [],
      alerts: config.alerts ?? [],
    };

    // Initialize webhooks
    for (const webhook of this.config.webhooks) {
      this.addWebhook(webhook);
    }

    // Initialize alert configs
    for (const alert of this.config.alerts) {
      this.addAlertConfig(alert);
    }
  }

  /**
   * Add a webhook configuration
   */
  addWebhook(webhook: WebhookConfig): void {
    const name = webhook.name || webhook.url;
    this.webhooks.set(name, {
      ...webhook,
      enabled: webhook.enabled ?? true,
      minLevel: webhook.minLevel ?? 'warning',
      rateLimitPerMinute: webhook.rateLimitPerMinute ?? 10,
      lastSent: new Map(),
      sentCount: 0,
      sentResetAt: Date.now() + 60000,
    });
  }

  /**
   * Remove a webhook
   */
  removeWebhook(name: string): void {
    this.webhooks.delete(name);
  }

  /**
   * Add an alert configuration
   */
  addAlertConfig(config: AlertConfig): void {
    this.alertConfigs.set(config.name, {
      ...config,
      enabled: config.enabled ?? true,
      cooldownMs: config.cooldownMs ?? this.config.defaultCooldownMs,
    });
  }

  /**
   * Remove an alert configuration
   */
  removeAlertConfig(name: string): void {
    this.alertConfigs.delete(name);
  }

  /**
   * Fire an alert
   */
  async fire(alert: Omit<Alert, 'id' | 'timestamp'>): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    const fullAlert: Alert = {
      ...alert,
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    };

    // Check cooldown
    const alertKey = `${alert.name}:${alert.level}`;
    const lastTime = this.lastAlertTimes.get(alertKey);
    const cooldown = this.alertConfigs.get(alert.name)?.cooldownMs ?? this.config.defaultCooldownMs;

    if (lastTime && Date.now() - lastTime < cooldown) {
      logger.debug({ alert: alert.name, cooldownRemaining: cooldown - (Date.now() - lastTime) }, 'Alert suppressed (cooldown)');
      return false;
    }

    // Record alert time
    this.lastAlertTimes.set(alertKey, Date.now());

    // Add to history
    this.alertHistory.push(fullAlert);
    if (this.alertHistory.length > this.config.maxHistorySize) {
      this.alertHistory.shift();
    }

    // Log alert
    const logMethod = alert.level === 'critical' ? 'error' : alert.level === 'warning' ? 'warn' : 'info';
    logger[logMethod]({ alert: fullAlert }, `Alert: ${alert.message}`);

    // Send to webhooks
    await this.sendToWebhooks(fullAlert);

    return true;
  }

  /**
   * Check a metric value against configured alerts
   */
  async checkMetric(metric: string, value: number, labels: Record<string, string> = {}): Promise<void> {
    for (const [name, config] of this.alertConfigs) {
      if (!config.enabled) continue;
      if (config.threshold.metric !== metric) continue;

      // Check labels match
      if (config.threshold.labels) {
        const match = Object.entries(config.threshold.labels).every(([k, v]) => labels[k] === v);
        if (!match) continue;
      }

      // Check threshold
      const triggered = this.evaluateThreshold(config.threshold, value);

      // Handle sustained duration
      if (config.threshold.sustainedMs) {
        const stateKey = `${name}:${JSON.stringify(labels)}`;
        const state = this.sustainedStates.get(stateKey);

        if (triggered) {
          if (!state) {
            // Start tracking
            this.sustainedStates.set(stateKey, { value, startTime: Date.now() });
          } else if (Date.now() - state.startTime >= config.threshold.sustainedMs) {
            // Sustained long enough, fire alert
            await this.fire({
              name,
              level: config.level,
              message: `${name}: ${metric} ${config.threshold.operator} ${config.threshold.value} (current: ${value})`,
              value,
              threshold: config.threshold.value,
              source: metric,
              tags: config.tags,
              metadata: { labels, sustainedMs: Date.now() - state.startTime },
            });
          }
        } else {
          // Reset sustained state
          this.sustainedStates.delete(stateKey);
        }
      } else if (triggered) {
        // Fire immediately
        await this.fire({
          name,
          level: config.level,
          message: `${name}: ${metric} ${config.threshold.operator} ${config.threshold.value} (current: ${value})`,
          value,
          threshold: config.threshold.value,
          source: metric,
          tags: config.tags,
          metadata: { labels },
        });
      }
    }
  }

  /**
   * Evaluate a threshold condition
   */
  private evaluateThreshold(threshold: AlertThreshold, value: number): boolean {
    switch (threshold.operator) {
      case '>': return value > threshold.value;
      case '>=': return value >= threshold.value;
      case '<': return value < threshold.value;
      case '<=': return value <= threshold.value;
      case '==': return value === threshold.value;
      case '!=': return value !== threshold.value;
      default: return false;
    }
  }

  /**
   * Send alert to all configured webhooks
   */
  private async sendToWebhooks(alert: Alert): Promise<void> {
    const levelOrder: Record<AlertLevel, number> = { info: 0, warning: 1, critical: 2 };

    for (const [name, webhook] of this.webhooks) {
      if (!webhook.enabled) continue;

      // Check minimum level
      const minLevelOrder = levelOrder[webhook.minLevel ?? 'warning'];
      const alertLevelOrder = levelOrder[alert.level];
      if (alertLevelOrder < minLevelOrder) continue;

      // Check rate limit
      const now = Date.now();
      if (now > webhook.sentResetAt) {
        webhook.sentCount = 0;
        webhook.sentResetAt = now + 60000;
      }

      if (webhook.sentCount >= (webhook.rateLimitPerMinute ?? 10)) {
        logger.warn({ webhook: name, alert: alert.name }, 'Webhook rate limited');
        continue;
      }

      try {
        await this.sendWebhook(webhook, alert);
        webhook.sentCount++;
      } catch (error) {
        logger.error({ error, webhook: name, alert: alert.name }, 'Failed to send webhook');
      }
    }
  }

  /**
   * Send to a specific webhook
   */
  private async sendWebhook(webhook: WebhookConfig, alert: Alert): Promise<void> {
    let body: unknown;

    switch (webhook.type) {
      case 'discord':
        body = this.formatDiscordPayload(alert);
        break;
      case 'slack':
        body = this.formatSlackPayload(alert);
        break;
      case 'generic':
      default:
        body = alert;
        break;
    }

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...webhook.headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}: ${await response.text()}`);
    }
  }

  /**
   * Format alert for Discord webhook
   */
  private formatDiscordPayload(alert: Alert): unknown {
    const colors: Record<AlertLevel, number> = {
      info: 0x3498db,     // Blue
      warning: 0xf39c12,  // Orange
      critical: 0xe74c3c, // Red
    };

    const emojis: Record<AlertLevel, string> = {
      info: 'information_source',
      warning: 'warning',
      critical: 'rotating_light',
    };

    return {
      embeds: [{
        title: `:${emojis[alert.level]}: ${alert.level.toUpperCase()}: ${alert.name}`,
        description: alert.message,
        color: colors[alert.level],
        fields: [
          ...(alert.value !== undefined ? [{ name: 'Value', value: String(alert.value), inline: true }] : []),
          ...(alert.threshold !== undefined ? [{ name: 'Threshold', value: String(alert.threshold), inline: true }] : []),
          ...(alert.source ? [{ name: 'Source', value: alert.source, inline: true }] : []),
          ...(alert.tags?.length ? [{ name: 'Tags', value: alert.tags.join(', '), inline: true }] : []),
        ],
        timestamp: new Date(alert.timestamp).toISOString(),
        footer: { text: `Alert ID: ${alert.id}` },
      }],
    };
  }

  /**
   * Format alert for Slack webhook
   */
  private formatSlackPayload(alert: Alert): unknown {
    const colors: Record<AlertLevel, string> = {
      info: '#3498db',
      warning: '#f39c12',
      critical: '#e74c3c',
    };

    const emojis: Record<AlertLevel, string> = {
      info: ':information_source:',
      warning: ':warning:',
      critical: ':rotating_light:',
    };

    return {
      attachments: [{
        color: colors[alert.level],
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${emojis[alert.level]} ${alert.level.toUpperCase()}: ${alert.name}`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: alert.message,
            },
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `*Alert ID:* ${alert.id}` },
              { type: 'mrkdwn', text: `*Time:* ${new Date(alert.timestamp).toISOString()}` },
              ...(alert.value !== undefined ? [{ type: 'mrkdwn', text: `*Value:* ${alert.value}` }] : []),
              ...(alert.threshold !== undefined ? [{ type: 'mrkdwn', text: `*Threshold:* ${alert.threshold}` }] : []),
            ],
          },
        ],
      }],
    };
  }

  /**
   * Get alert history
   */
  getHistory(options: { level?: AlertLevel; name?: string; limit?: number; since?: number } = {}): Alert[] {
    let alerts = this.alertHistory;

    if (options.level) {
      alerts = alerts.filter(a => a.level === options.level);
    }

    if (options.name) {
      alerts = alerts.filter(a => a.name === options.name);
    }

    if (options.since !== undefined) {
      const since = options.since;
      alerts = alerts.filter(a => a.timestamp >= since);
    }

    if (options.limit) {
      alerts = alerts.slice(-options.limit);
    }

    return alerts;
  }

  /**
   * Get alert statistics
   */
  getStats(): {
    total: number;
    byLevel: Record<AlertLevel, number>;
    last24h: number;
    lastHour: number;
  } {
    const now = Date.now();
    const hourAgo = now - 3600000;
    const dayAgo = now - 86400000;

    return {
      total: this.alertHistory.length,
      byLevel: {
        info: this.alertHistory.filter(a => a.level === 'info').length,
        warning: this.alertHistory.filter(a => a.level === 'warning').length,
        critical: this.alertHistory.filter(a => a.level === 'critical').length,
      },
      last24h: this.alertHistory.filter(a => a.timestamp >= dayAgo).length,
      lastHour: this.alertHistory.filter(a => a.timestamp >= hourAgo).length,
    };
  }

  /**
   * Clear alert history
   */
  clearHistory(): void {
    this.alertHistory = [];
  }

  /**
   * Clear cooldowns (useful for testing)
   */
  clearCooldowns(): void {
    this.lastAlertTimes.clear();
    this.sustainedStates.clear();
  }

  /**
   * Check if alerts are enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable/disable alerts
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }
}

// =============================================================================
// DEFAULT ALERT CONFIGURATIONS
// =============================================================================

export const DEFAULT_ALERT_CONFIGS: AlertConfig[] = [
  // Memory alerts
  {
    name: 'high_memory_usage',
    description: 'Memory usage above 80%',
    level: 'warning',
    threshold: {
      metric: 'process_memory_percent',
      operator: '>',
      value: 80,
      sustainedMs: 60000,
    },
    cooldownMs: 300000,
    tags: ['system', 'memory'],
  },
  {
    name: 'critical_memory_usage',
    description: 'Memory usage above 95%',
    level: 'critical',
    threshold: {
      metric: 'process_memory_percent',
      operator: '>',
      value: 95,
    },
    cooldownMs: 60000,
    tags: ['system', 'memory'],
  },

  // Error rate alerts
  {
    name: 'high_error_rate',
    description: 'Error rate above 5%',
    level: 'warning',
    threshold: {
      metric: 'http_error_rate',
      operator: '>',
      value: 5,
      sustainedMs: 60000,
    },
    cooldownMs: 300000,
    tags: ['http', 'errors'],
  },
  {
    name: 'critical_error_rate',
    description: 'Error rate above 20%',
    level: 'critical',
    threshold: {
      metric: 'http_error_rate',
      operator: '>',
      value: 20,
    },
    cooldownMs: 60000,
    tags: ['http', 'errors'],
  },

  // Latency alerts
  {
    name: 'high_latency',
    description: 'Average latency above 1000ms',
    level: 'warning',
    threshold: {
      metric: 'http_latency_avg_ms',
      operator: '>',
      value: 1000,
      sustainedMs: 120000,
    },
    cooldownMs: 300000,
    tags: ['http', 'latency'],
  },
  {
    name: 'critical_latency',
    description: 'Average latency above 5000ms',
    level: 'critical',
    threshold: {
      metric: 'http_latency_avg_ms',
      operator: '>',
      value: 5000,
    },
    cooldownMs: 60000,
    tags: ['http', 'latency'],
  },

  // Feed alerts
  {
    name: 'feed_disconnected',
    description: 'Feed disconnected',
    level: 'warning',
    threshold: {
      metric: 'feed_connected',
      operator: '==',
      value: 0,
      sustainedMs: 30000,
    },
    cooldownMs: 300000,
    tags: ['feed', 'connection'],
  },
  {
    name: 'feed_stale',
    description: 'No feed messages in 60 seconds',
    level: 'warning',
    threshold: {
      metric: 'feed_stale_seconds',
      operator: '>',
      value: 60,
    },
    cooldownMs: 300000,
    tags: ['feed', 'stale'],
  },

  // Trading alerts
  {
    name: 'trading_loss',
    description: 'Trading PnL below -$100',
    level: 'warning',
    threshold: {
      metric: 'trading_pnl_usd',
      operator: '<',
      value: -100,
    },
    cooldownMs: 600000,
    tags: ['trading', 'pnl'],
  },
  {
    name: 'trading_critical_loss',
    description: 'Trading PnL below -$500',
    level: 'critical',
    threshold: {
      metric: 'trading_pnl_usd',
      operator: '<',
      value: -500,
    },
    cooldownMs: 300000,
    tags: ['trading', 'pnl'],
  },
];

// =============================================================================
// DEFAULT INSTANCE
// =============================================================================

export const alertManager = new AlertManager({
  alerts: DEFAULT_ALERT_CONFIGS,
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Quick alert helper
 */
export async function sendAlert(
  level: AlertLevel,
  name: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<boolean> {
  return alertManager.fire({
    name,
    level,
    message,
    metadata,
  });
}

/**
 * Send info alert
 */
export async function info(name: string, message: string, metadata?: Record<string, unknown>): Promise<boolean> {
  return sendAlert('info', name, message, metadata);
}

/**
 * Send warning alert
 */
export async function warning(name: string, message: string, metadata?: Record<string, unknown>): Promise<boolean> {
  return sendAlert('warning', name, message, metadata);
}

/**
 * Send critical alert
 */
export async function critical(name: string, message: string, metadata?: Record<string, unknown>): Promise<boolean> {
  return sendAlert('critical', name, message, metadata);
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  AlertManager as default,
};
