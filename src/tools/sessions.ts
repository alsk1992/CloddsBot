/**
 * Session Tools - Clawdbot-style cross-session communication
 *
 * Tools:
 * - sessions_list: List active sessions
 * - sessions_history: Get session transcript
 * - sessions_send: Send message to another session
 * - sessions_spawn: Spawn a sub-agent session
 */

import { logger } from '../utils/logger';
import type { SessionManager } from '../sessions/index';
import type { Session, ConversationMessage } from '../types';

/** Session info for listing */
export interface SessionInfo {
  id: string;
  key: string;
  userId: string;
  channel: string;
  chatId: string;
  chatType: 'dm' | 'group';
  messageCount: number;
  createdAt: Date;
  lastActivity: Date;
}

/** History entry */
export interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** Send options */
export interface SendOptions {
  /** Wait for reply */
  waitForReply?: boolean;
  /** Timeout for reply in ms */
  replyTimeout?: number;
  /** Skip announcing the message source */
  announceSkip?: boolean;
  /** Skip waiting for reply */
  replySkip?: boolean;
}

/** Send result */
export interface SendResult {
  success: boolean;
  error?: string;
  reply?: string;
}

export interface SessionTools {
  /** List all active sessions */
  list(): SessionInfo[];

  /** Get history for a session */
  history(sessionId: string, limit?: number): HistoryEntry[];

  /** Send a message to another session */
  send(
    targetSessionId: string,
    message: string,
    options?: SendOptions
  ): Promise<SendResult>;

  /** Get status of current session */
  status(sessionId: string): SessionInfo | null;
}

export function createSessionTools(
  sessionManager: SessionManager,
  sendMessage: (
    sessionId: string,
    message: string,
    fromSessionId?: string
  ) => Promise<string | null>
): SessionTools {
  // Track all sessions (sessionManager may not expose this directly)
  const knownSessions = new Map<string, Session>();

  return {
    list(): SessionInfo[] {
      // In real implementation, would get from sessionManager
      // For now, return known sessions
      const sessions: SessionInfo[] = [];

      for (const session of knownSessions.values()) {
        sessions.push({
          id: session.id,
          key: session.key,
          userId: session.userId,
          channel: session.channel,
          chatId: session.chatId,
          chatType: session.chatType,
          messageCount: session.context.messageCount,
          createdAt: session.createdAt,
          lastActivity: session.lastActivity,
        });
      }

      return sessions;
    },

    history(sessionId, limit = 50): HistoryEntry[] {
      const session = knownSessions.get(sessionId);
      if (!session) {
        logger.warn({ sessionId }, 'Session not found for history');
        return [];
      }

      const history = session.history || session.context.conversationHistory || [];
      const entries = history.slice(-limit).map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
      }));

      return entries;
    },

    async send(targetSessionId, message, options = {}): Promise<SendResult> {
      const session = knownSessions.get(targetSessionId);
      if (!session) {
        return {
          success: false,
          error: `Session not found: ${targetSessionId}`,
        };
      }

      logger.info(
        { targetSessionId, messageLength: message.length },
        'Sending cross-session message'
      );

      try {
        // Format message with source info unless skipped
        let formattedMessage = message;
        if (!options.announceSkip) {
          formattedMessage = `[Cross-session message]\n\n${message}`;
        }

        // Send the message
        const reply = await sendMessage(targetSessionId, formattedMessage);

        // Wait for reply if requested
        if (options.waitForReply && !options.replySkip) {
          return {
            success: true,
            reply: reply || undefined,
          };
        }

        return { success: true };
      } catch (error) {
        logger.error({ error, targetSessionId }, 'Cross-session send failed');
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Send failed',
        };
      }
    },

    status(sessionId): SessionInfo | null {
      const session = knownSessions.get(sessionId);
      if (!session) return null;

      return {
        id: session.id,
        key: session.key,
        userId: session.userId,
        channel: session.channel,
        chatId: session.chatId,
        chatType: session.chatType,
        messageCount: session.context.messageCount,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
      };
    },
  };
}

/**
 * Format session list for display
 */
export function formatSessionList(sessions: SessionInfo[]): string {
  if (sessions.length === 0) {
    return 'No active sessions.';
  }

  const lines = ['**Active Sessions:**\n'];

  for (const s of sessions) {
    const ago = Math.floor((Date.now() - s.lastActivity.getTime()) / 60000);
    lines.push(`• **${s.id.slice(0, 8)}** (${s.channel}/${s.chatType})`);
    lines.push(`  User: ${s.userId.slice(0, 20)}, Messages: ${s.messageCount}, Last: ${ago}m ago`);
  }

  return lines.join('\n');
}
