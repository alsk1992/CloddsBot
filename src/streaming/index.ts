/**
 * Streaming Service - Clawdbot-style block streaming with chunking
 *
 * Features:
 * - Stream agent responses in real-time (send partial messages)
 * - Chunk long messages for platform limits (Telegram: 4096 chars, Discord: 2000)
 * - Typing indicator management
 * - Block boundary detection (paragraphs, code blocks)
 */

import { logger } from '../utils/logger';
import type { OutgoingMessage } from '../types';

/** Platform-specific message limits */
const PLATFORM_LIMITS: Record<string, number> = {
  telegram: 4096,
  discord: 2000,
  webchat: 10000, // No real limit, but reasonable
};

/** Default chunk size if platform unknown */
const DEFAULT_LIMIT = 2000;

/** Configuration for streaming */
export interface StreamConfig {
  /** Enable streaming (send partial messages as they arrive) */
  enabled?: boolean;
  /** Minimum characters before sending a partial update */
  minChunkSize?: number;
  /** Maximum time between updates (ms) */
  flushIntervalMs?: number;
  /** Send typing indicators */
  typingIndicator?: boolean;
}

const DEFAULT_CONFIG: Required<StreamConfig> = {
  enabled: true,
  minChunkSize: 100,
  flushIntervalMs: 500,
  typingIndicator: true,
};

/** Streaming context for a single response */
export interface StreamContext {
  platform: string;
  chatId: string;
  messageId?: string; // For editing messages (like Discord)
  buffer: string;
  lastFlush: number;
  isClosed: boolean;
}

/** Callback for sending messages */
export type SendCallback = (msg: OutgoingMessage) => Promise<void>;

/** Callback for editing messages */
export type EditCallback = (msg: OutgoingMessage & { messageId: string }) => Promise<void>;

/** Callback for typing indicator */
export type TypingCallback = (platform: string, chatId: string) => Promise<void>;

export interface StreamingService {
  /** Get the config */
  getConfig(): Required<StreamConfig>;

  /** Chunk a message for a platform's character limit */
  chunkMessage(text: string, platform: string): string[];

  /** Create a new streaming context */
  createContext(platform: string, chatId: string): StreamContext;

  /** Append text to a stream context */
  append(ctx: StreamContext, text: string): void;

  /** Flush the buffer immediately */
  flush(ctx: StreamContext): Promise<void>;

  /** Close the stream and send any remaining content */
  close(ctx: StreamContext): Promise<void>;

  /** Set the send callback */
  setSendCallback(callback: SendCallback): void;

  /** Set the typing callback */
  setTypingCallback(callback: TypingCallback): void;
}

/**
 * Split text at natural boundaries (paragraphs, code blocks, sentences)
 */
function splitAtBoundary(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitPoint = maxLength;

    // Try to split at paragraph boundary (double newline)
    const paragraphEnd = remaining.lastIndexOf('\n\n', maxLength);
    if (paragraphEnd > maxLength * 0.5) {
      splitPoint = paragraphEnd + 2;
    } else {
      // Try to split at single newline
      const lineEnd = remaining.lastIndexOf('\n', maxLength);
      if (lineEnd > maxLength * 0.5) {
        splitPoint = lineEnd + 1;
      } else {
        // Try to split at sentence boundary
        const sentenceEnd = remaining.lastIndexOf('. ', maxLength);
        if (sentenceEnd > maxLength * 0.5) {
          splitPoint = sentenceEnd + 2;
        } else {
          // Try to split at space
          const spaceEnd = remaining.lastIndexOf(' ', maxLength);
          if (spaceEnd > maxLength * 0.5) {
            splitPoint = spaceEnd + 1;
          }
          // Otherwise, hard split at maxLength
        }
      }
    }

    chunks.push(remaining.slice(0, splitPoint).trimEnd());
    remaining = remaining.slice(splitPoint).trimStart();
  }

  return chunks;
}

/**
 * Handle code blocks specially - don't split in the middle of them
 */
function chunkWithCodeBlocks(text: string, maxLength: number): string[] {
  // Simple regex to find code blocks
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks: Array<{ start: number; end: number; content: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    codeBlocks.push({
      start: match.index,
      end: match.index + match[0].length,
      content: match[0],
    });
  }

  // If no code blocks, use simple splitting
  if (codeBlocks.length === 0) {
    return splitAtBoundary(text, maxLength);
  }

  // Split while respecting code block boundaries
  const chunks: string[] = [];
  let currentChunk = '';
  let position = 0;

  for (const block of codeBlocks) {
    // Add text before code block
    const beforeBlock = text.slice(position, block.start);

    // Check if adding this text + code block exceeds limit
    if (currentChunk.length + beforeBlock.length + block.content.length > maxLength) {
      // First, handle the text before the block
      if (currentChunk.length + beforeBlock.length > maxLength) {
        // Need to split the text before
        const availableSpace = maxLength - currentChunk.length;
        const beforeChunks = splitAtBoundary(beforeBlock, availableSpace);

        for (let i = 0; i < beforeChunks.length; i++) {
          if (i === 0 && currentChunk) {
            currentChunk += beforeChunks[i];
            if (currentChunk.length >= maxLength * 0.8) {
              chunks.push(currentChunk.trim());
              currentChunk = '';
            }
          } else if (i < beforeChunks.length - 1) {
            chunks.push(beforeChunks[i].trim());
          } else {
            currentChunk = beforeChunks[i];
          }
        }
      } else {
        currentChunk += beforeBlock;
      }

      // If code block itself is too large, we have to split it
      if (block.content.length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        // Split code block (not ideal, but necessary)
        const codeChunks = splitAtBoundary(block.content, maxLength);
        for (const codeChunk of codeChunks) {
          chunks.push(codeChunk.trim());
        }
      } else {
        // Start new chunk with code block
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = block.content;
      }
    } else {
      currentChunk += beforeBlock + block.content;
    }

    position = block.end;
  }

  // Add remaining text after last code block
  const remaining = text.slice(position);
  if (remaining) {
    if (currentChunk.length + remaining.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      const remainingChunks = splitAtBoundary(remaining, maxLength);
      chunks.push(...remainingChunks.map((c) => c.trim()));
    } else {
      currentChunk += remaining;
      chunks.push(currentChunk.trim());
    }
  } else if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter((c) => c.length > 0);
}

export function createStreamingService(configInput?: StreamConfig): StreamingService {
  const config: Required<StreamConfig> = { ...DEFAULT_CONFIG, ...configInput };

  let sendCallback: SendCallback | null = null;
  let typingCallback: TypingCallback | null = null;

  // Active streaming contexts
  const contexts = new Map<string, StreamContext>();

  // Flush interval timer
  let flushTimer: ReturnType<typeof setInterval> | null = null;

  if (config.enabled) {
    // Start periodic flush check
    flushTimer = setInterval(() => {
      const now = Date.now();
      for (const ctx of contexts.values()) {
        if (
          !ctx.isClosed &&
          ctx.buffer.length >= config.minChunkSize &&
          now - ctx.lastFlush >= config.flushIntervalMs
        ) {
          service.flush(ctx).catch((err) => {
            logger.error('Stream flush error:', err);
          });
        }
      }
    }, config.flushIntervalMs);
  }

  const service: StreamingService = {
    getConfig() {
      return config;
    },

    chunkMessage(text: string, platform: string): string[] {
      const limit = PLATFORM_LIMITS[platform] || DEFAULT_LIMIT;
      return chunkWithCodeBlocks(text, limit);
    },

    createContext(platform: string, chatId: string): StreamContext {
      const key = `${platform}:${chatId}`;
      const ctx: StreamContext = {
        platform,
        chatId,
        buffer: '',
        lastFlush: Date.now(),
        isClosed: false,
      };
      contexts.set(key, ctx);

      // Send typing indicator
      if (config.typingIndicator && typingCallback) {
        typingCallback(platform, chatId).catch((err) => {
          logger.debug('Typing indicator error:', err);
        });
      }

      return ctx;
    },

    append(ctx: StreamContext, text: string): void {
      if (ctx.isClosed) {
        logger.warn('Attempted to append to closed stream');
        return;
      }
      ctx.buffer += text;
    },

    async flush(ctx: StreamContext): Promise<void> {
      if (ctx.buffer.length === 0 || !sendCallback) {
        return;
      }

      const chunks = this.chunkMessage(ctx.buffer, ctx.platform);

      for (const chunk of chunks) {
        await sendCallback({
          platform: ctx.platform,
          chatId: ctx.chatId,
          text: chunk,
        });
      }

      ctx.buffer = '';
      ctx.lastFlush = Date.now();
    },

    async close(ctx: StreamContext): Promise<void> {
      if (ctx.isClosed) return;

      ctx.isClosed = true;

      // Final flush
      if (ctx.buffer.length > 0 && sendCallback) {
        await this.flush(ctx);
      }

      // Remove from active contexts
      const key = `${ctx.platform}:${ctx.chatId}`;
      contexts.delete(key);
    },

    setSendCallback(callback: SendCallback): void {
      sendCallback = callback;
    },

    setTypingCallback(callback: TypingCallback): void {
      typingCallback = callback;
    },
  };

  return service;
}

/**
 * Utility function: Chunk a message for a platform's character limit
 * This is the simple interface for most use cases.
 */
export function chunkForPlatform(text: string, platform: string): string[] {
  const limit = PLATFORM_LIMITS[platform] || DEFAULT_LIMIT;
  return chunkWithCodeBlocks(text, limit);
}
