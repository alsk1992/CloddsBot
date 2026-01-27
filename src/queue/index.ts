/**
 * Message Queue - Clawdbot-style message batching
 *
 * Features:
 * - Debounce mode: Wait for typing to stop
 * - Collect mode: Batch rapid messages
 * - Configurable timing and caps
 * - Ack reactions when processing starts
 */

import { IncomingMessage, Config } from '../types';
import { logger } from '../utils/logger';

export interface QueueConfig {
  mode: 'debounce' | 'collect' | 'none';
  debounceMs: number;
  cap: number;
  responsePrefix?: string;
  ackReaction?: string;
}

export interface QueuedMessage {
  message: IncomingMessage;
  queuedAt: number;
}

export interface MessageQueue {
  /** Add a message to the queue, returns true if should process now */
  enqueue(message: IncomingMessage): Promise<boolean>;
  
  /** Get all queued messages for a chat and clear the queue */
  flush(chatKey: string): IncomingMessage[];
  
  /** Set callback for when queue is ready to process */
  onReady(callback: (chatKey: string, messages: IncomingMessage[]) => Promise<void>): void;
  
  /** Get queue config */
  getConfig(): QueueConfig;
}

const DEFAULT_CONFIG: QueueConfig = {
  mode: 'none',
  debounceMs: 1000,
  cap: 20,
};

/**
 * Generate a chat key for queue grouping
 */
function getChatKey(message: IncomingMessage): string {
  return `${message.platform}:${message.chatId}`;
}

export function createMessageQueue(configInput?: Config['messages']): MessageQueue {
  const config: QueueConfig = {
    mode: configInput?.queue?.mode || DEFAULT_CONFIG.mode,
    debounceMs: configInput?.queue?.debounceMs ?? DEFAULT_CONFIG.debounceMs,
    cap: configInput?.queue?.cap ?? DEFAULT_CONFIG.cap,
    responsePrefix: configInput?.responsePrefix,
    ackReaction: configInput?.ackReaction,
  };

  // Queued messages by chat key
  const queues = new Map<string, QueuedMessage[]>();
  
  // Debounce timers by chat key
  const timers = new Map<string, NodeJS.Timeout>();
  
  // Ready callback
  let readyCallback: ((chatKey: string, messages: IncomingMessage[]) => Promise<void>) | null = null;

  logger.info({ config }, 'Message queue initialized');

  function triggerReady(chatKey: string) {
    const queue = queues.get(chatKey);
    if (!queue || queue.length === 0) return;

    const messages = queue.map(q => q.message);
    queues.delete(chatKey);
    timers.delete(chatKey);

    logger.info({ chatKey, messageCount: messages.length }, 'Queue ready, processing');

    if (readyCallback) {
      readyCallback(chatKey, messages).catch(err => {
        logger.error({ err, chatKey }, 'Error in queue ready callback');
      });
    }
  }

  return {
    async enqueue(message: IncomingMessage): Promise<boolean> {
      // If mode is none, process immediately
      if (config.mode === 'none') {
        return true;
      }

      const chatKey = getChatKey(message);
      const now = Date.now();

      // Initialize queue if needed
      if (!queues.has(chatKey)) {
        queues.set(chatKey, []);
      }

      const queue = queues.get(chatKey)!;

      // Add to queue
      queue.push({ message, queuedAt: now });

      // Check cap - if reached, process immediately
      if (queue.length >= config.cap) {
        logger.info({ chatKey, cap: config.cap }, 'Queue cap reached, processing');
        
        // Clear any pending timer
        const timer = timers.get(chatKey);
        if (timer) {
          clearTimeout(timer);
          timers.delete(chatKey);
        }

        triggerReady(chatKey);
        return false; // Already processed via callback
      }

      if (config.mode === 'debounce') {
        // Debounce: Reset timer on each message
        const existingTimer = timers.get(chatKey);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        const timer = setTimeout(() => {
          triggerReady(chatKey);
        }, config.debounceMs);

        timers.set(chatKey, timer);
        return false; // Will process via callback
      }

      if (config.mode === 'collect') {
        // Collect: Start timer on first message, collect until timer fires
        if (!timers.has(chatKey)) {
          const timer = setTimeout(() => {
            triggerReady(chatKey);
          }, config.debounceMs);

          timers.set(chatKey, timer);
        }
        return false; // Will process via callback
      }

      return true;
    },

    flush(chatKey: string): IncomingMessage[] {
      const queue = queues.get(chatKey);
      if (!queue) return [];

      const messages = queue.map(q => q.message);
      queues.delete(chatKey);

      // Clear timer
      const timer = timers.get(chatKey);
      if (timer) {
        clearTimeout(timer);
        timers.delete(chatKey);
      }

      return messages;
    },

    onReady(callback: (chatKey: string, messages: IncomingMessage[]) => Promise<void>): void {
      readyCallback = callback;
    },

    getConfig(): QueueConfig {
      return config;
    },
  };
}

/**
 * Combine multiple messages into one for the agent
 */
export function combineMessages(messages: IncomingMessage[]): IncomingMessage {
  if (messages.length === 0) {
    throw new Error('Cannot combine empty message array');
  }

  if (messages.length === 1) {
    return messages[0];
  }

  // Use the last message as the base, combine text
  const base = messages[messages.length - 1];
  const combinedText = messages.map(m => m.text).join('\n\n');

  return {
    ...base,
    text: combinedText,
  };
}
