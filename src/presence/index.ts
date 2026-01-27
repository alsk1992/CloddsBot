/**
 * Presence Service - Typing indicators and online status
 *
 * Features:
 * - Send typing indicators while processing
 * - Track user presence (online/offline/away)
 * - Per-platform typing API integration
 */

import { logger } from '../utils/logger';

/** Typing indicator state */
interface TypingState {
  chatId: string;
  platform: string;
  startedAt: Date;
  intervalId?: ReturnType<typeof setInterval>;
}

/** Platform-specific typing sender */
export type TypingSender = (chatId: string) => Promise<void>;

export interface PresenceService {
  /** Start showing typing indicator */
  startTyping(platform: string, chatId: string): void;

  /** Stop showing typing indicator */
  stopTyping(platform: string, chatId: string): void;

  /** Register a platform's typing sender */
  registerTypingSender(platform: string, sender: TypingSender): void;

  /** Check if currently typing */
  isTyping(platform: string, chatId: string): boolean;

  /** Stop all typing indicators */
  stopAll(): void;
}

export function createPresenceService(): PresenceService {
  // Active typing states by platform:chatId
  const typingStates = new Map<string, TypingState>();

  // Platform-specific typing senders
  const typingSenders = new Map<string, TypingSender>();

  // Typing indicator refresh interval (most platforms need refresh every 5s)
  const TYPING_REFRESH_MS = 4000;

  // Max typing duration (safety timeout)
  const MAX_TYPING_MS = 120000; // 2 minutes

  function getKey(platform: string, chatId: string): string {
    return `${platform}:${chatId}`;
  }

  async function sendTyping(platform: string, chatId: string): Promise<void> {
    const sender = typingSenders.get(platform);
    if (!sender) {
      logger.debug({ platform }, 'No typing sender registered for platform');
      return;
    }

    try {
      await sender(chatId);
    } catch (error) {
      logger.debug({ error, platform, chatId }, 'Failed to send typing indicator');
    }
  }

  const service: PresenceService = {
    startTyping(platform, chatId) {
      const key = getKey(platform, chatId);

      // Already typing?
      if (typingStates.has(key)) {
        return;
      }

      // Send initial typing indicator
      sendTyping(platform, chatId);

      // Set up refresh interval
      const intervalId = setInterval(() => {
        const state = typingStates.get(key);
        if (!state) {
          clearInterval(intervalId);
          return;
        }

        // Check timeout
        const elapsed = Date.now() - state.startedAt.getTime();
        if (elapsed > MAX_TYPING_MS) {
          logger.warn({ platform, chatId, elapsed }, 'Typing indicator timeout');
          service.stopTyping(platform, chatId);
          return;
        }

        // Refresh typing indicator
        sendTyping(platform, chatId);
      }, TYPING_REFRESH_MS);

      typingStates.set(key, {
        chatId,
        platform,
        startedAt: new Date(),
        intervalId,
      });

      logger.debug({ platform, chatId }, 'Started typing indicator');
    },

    stopTyping(platform, chatId) {
      const key = getKey(platform, chatId);
      const state = typingStates.get(key);

      if (!state) {
        return;
      }

      // Clear interval
      if (state.intervalId) {
        clearInterval(state.intervalId);
      }

      typingStates.delete(key);
      logger.debug({ platform, chatId }, 'Stopped typing indicator');
    },

    registerTypingSender(platform, sender) {
      typingSenders.set(platform, sender);
      logger.debug({ platform }, 'Registered typing sender');
    },

    isTyping(platform, chatId) {
      return typingStates.has(getKey(platform, chatId));
    },

    stopAll() {
      for (const [key, state] of typingStates) {
        if (state.intervalId) {
          clearInterval(state.intervalId);
        }
      }
      typingStates.clear();
      logger.debug('Stopped all typing indicators');
    },
  };

  return service;
}

/**
 * Typing indicator wrapper - use with async operations
 *
 * Example:
 * ```ts
 * const result = await withTyping(presence, 'telegram', chatId, async () => {
 *   return await generateResponse(message);
 * });
 * ```
 */
export async function withTyping<T>(
  presence: PresenceService,
  platform: string,
  chatId: string,
  fn: () => Promise<T>
): Promise<T> {
  presence.startTyping(platform, chatId);
  try {
    return await fn();
  } finally {
    presence.stopTyping(platform, chatId);
  }
}
