/**
 * Heartbeats - Clawdbot-style proactive awareness checks
 *
 * Features:
 * - Periodic "thinking of you" messages
 * - Context-aware prompts based on user activity
 * - Configurable intervals per user
 * - Market alert digests
 */

import { logger } from '../utils/logger';
import { CronScheduler } from './cron';

/** Heartbeat configuration */
export interface HeartbeatConfig {
  /** Whether heartbeats are enabled */
  enabled: boolean;
  /** Default interval in hours */
  defaultIntervalHours?: number;
  /** Quiet hours start (0-23) */
  quietHoursStart?: number;
  /** Quiet hours end (0-23) */
  quietHoursEnd?: number;
  /** Prompt to generate heartbeat message */
  prompt?: string;
}

/** User heartbeat state */
interface UserHeartbeatState {
  userId: string;
  channel: string;
  chatId: string;
  intervalHours: number;
  lastHeartbeat?: Date;
  lastActivity?: Date;
  enabled: boolean;
}

/** Message sender function type */
export type HeartbeatSender = (
  channel: string,
  chatId: string,
  message: string
) => Promise<void>;

/** Message generator function type */
export type HeartbeatGenerator = (
  userId: string,
  context: {
    lastActivity?: Date;
    lastHeartbeat?: Date;
    hoursInactive: number;
  }
) => Promise<string | null>;

export interface HeartbeatService {
  /** Register a user for heartbeats */
  register(
    userId: string,
    channel: string,
    chatId: string,
    intervalHours?: number
  ): void;

  /** Unregister a user */
  unregister(userId: string): void;

  /** Update user activity (resets heartbeat timer) */
  recordActivity(userId: string): void;

  /** Set user's heartbeat interval */
  setInterval(userId: string, hours: number): void;

  /** Enable/disable heartbeats for user */
  setEnabled(userId: string, enabled: boolean): void;

  /** Get all registered users */
  getRegistered(): UserHeartbeatState[];

  /** Manually trigger heartbeat check */
  check(): Promise<void>;

  /** Start the heartbeat scheduler */
  start(): void;

  /** Stop the heartbeat scheduler */
  stop(): void;
}

const DEFAULT_CONFIG: Required<HeartbeatConfig> = {
  enabled: true,
  defaultIntervalHours: 24,
  quietHoursStart: 22, // 10 PM
  quietHoursEnd: 8, // 8 AM
  prompt: 'Generate a brief, friendly check-in message for the user. Keep it natural and not robotic. If there are relevant market updates, mention them briefly.',
};

export function createHeartbeatService(
  config: HeartbeatConfig,
  scheduler: CronScheduler,
  sender: HeartbeatSender,
  generator: HeartbeatGenerator
): HeartbeatService {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const users = new Map<string, UserHeartbeatState>();
  let cronJobId: string | null = null;

  /** Check if current time is in quiet hours */
  function isQuietHours(): boolean {
    const hour = new Date().getHours();
    const { quietHoursStart, quietHoursEnd } = fullConfig;

    if (quietHoursStart < quietHoursEnd) {
      return hour >= quietHoursStart && hour < quietHoursEnd;
    } else {
      // Wraps around midnight
      return hour >= quietHoursStart || hour < quietHoursEnd;
    }
  }

  /** Check if user should receive heartbeat */
  function shouldSendHeartbeat(state: UserHeartbeatState): boolean {
    if (!state.enabled) return false;

    const now = new Date();
    const lastContact = state.lastHeartbeat || state.lastActivity;

    if (!lastContact) {
      // Never contacted - wait for first activity
      return false;
    }

    const hoursSinceContact =
      (now.getTime() - lastContact.getTime()) / (1000 * 60 * 60);

    return hoursSinceContact >= state.intervalHours;
  }

  const service: HeartbeatService = {
    register(userId, channel, chatId, intervalHours) {
      users.set(userId, {
        userId,
        channel,
        chatId,
        intervalHours: intervalHours || fullConfig.defaultIntervalHours,
        enabled: true,
      });

      logger.info(
        { userId, channel, intervalHours: intervalHours || fullConfig.defaultIntervalHours },
        'User registered for heartbeats'
      );
    },

    unregister(userId) {
      users.delete(userId);
      logger.info({ userId }, 'User unregistered from heartbeats');
    },

    recordActivity(userId) {
      const state = users.get(userId);
      if (state) {
        state.lastActivity = new Date();
      }
    },

    setInterval(userId, hours) {
      const state = users.get(userId);
      if (state) {
        state.intervalHours = hours;
        logger.info({ userId, hours }, 'Heartbeat interval updated');
      }
    },

    setEnabled(userId, enabled) {
      const state = users.get(userId);
      if (state) {
        state.enabled = enabled;
        logger.info({ userId, enabled }, 'Heartbeat enabled status updated');
      }
    },

    getRegistered() {
      return Array.from(users.values());
    },

    async check() {
      if (!fullConfig.enabled) return;
      if (isQuietHours()) {
        logger.debug('Skipping heartbeat check during quiet hours');
        return;
      }

      for (const state of users.values()) {
        if (!shouldSendHeartbeat(state)) continue;

        try {
          const hoursSinceActivity = state.lastActivity
            ? (Date.now() - state.lastActivity.getTime()) / (1000 * 60 * 60)
            : 0;

          // Generate message
          const message = await generator(state.userId, {
            lastActivity: state.lastActivity,
            lastHeartbeat: state.lastHeartbeat,
            hoursInactive: hoursSinceActivity,
          });

          if (!message) {
            logger.debug({ userId: state.userId }, 'Heartbeat generator returned null');
            continue;
          }

          // Send message
          await sender(state.channel, state.chatId, message);
          state.lastHeartbeat = new Date();

          logger.info(
            { userId: state.userId, channel: state.channel },
            'Heartbeat sent'
          );
        } catch (error) {
          logger.error(
            { error, userId: state.userId },
            'Failed to send heartbeat'
          );
        }
      }
    },

    start() {
      if (!fullConfig.enabled) {
        logger.info('Heartbeats disabled');
        return;
      }

      // Run heartbeat check every hour
      cronJobId = 'heartbeat-check';
      scheduler.add(cronJobId, '0 * * * *', async () => {
        await service.check();
      });

      logger.info('Heartbeat service started');
    },

    stop() {
      if (cronJobId) {
        scheduler.remove(cronJobId);
        cronJobId = null;
      }
      logger.info('Heartbeat service stopped');
    },
  };

  return service;
}
