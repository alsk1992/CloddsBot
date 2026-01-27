/**
 * Session Manager - Clawdbot-style session management
 *
 * Features:
 * - Session scopes: main, per-peer, per-channel-peer
 * - Daily reset at configurable hour
 * - Idle reset after configurable minutes
 * - Manual reset via commands
 */

import { Session, SessionContext, User, IncomingMessage, ConversationMessage, Config } from '../types';

// Re-export Session type for consumers
export type { Session } from '../types';
import { Database } from '../db';
import { logger } from '../utils/logger';

export type DmScope = 'main' | 'per-peer' | 'per-channel-peer';

export interface SessionConfig {
  dmScope: DmScope;
  reset: {
    mode: 'daily' | 'idle' | 'both' | 'manual';
    atHour: number;
    idleMinutes: number;
  };
  resetTriggers: string[];
}

export interface SessionManager {
  getOrCreateSession: (message: IncomingMessage) => Promise<Session>;
  getSession: (key: string) => Session | undefined;
  updateSession: (session: Session) => void;
  deleteSession: (key: string) => void;
  /** Add a message to conversation history */
  addToHistory: (session: Session, role: 'user' | 'assistant', content: string) => void;
  /** Get conversation history for Claude API */
  getHistory: (session: Session) => ConversationMessage[];
  /** Clear conversation history */
  clearHistory: (session: Session) => void;
  /** Reset a session by ID (clears history, keeps context) */
  reset: (sessionId: string) => void;
  /** Check and perform scheduled resets */
  checkScheduledResets: () => void;
  /** Get session config */
  getConfig: () => SessionConfig;
}

/** Max conversation history to keep (prevent unbounded growth) */
const MAX_HISTORY_LENGTH = 20;

/** Default session configuration */
const DEFAULT_CONFIG: SessionConfig = {
  dmScope: 'per-channel-peer',
  reset: {
    mode: 'manual',
    atHour: 4, // 4 AM
    idleMinutes: 60,
  },
  resetTriggers: ['/new', '/reset'],
};

/**
 * Generate a session key based on scope
 */
function generateSessionKey(
  message: IncomingMessage,
  scope: DmScope,
  agentId: string = 'main'
): string {
  const isGroup = message.chatType === 'group';

  if (isGroup) {
    // Groups always get their own key
    return `agent:${agentId}:${message.platform}:group:${message.chatId}`;
  }

  // DM scoping
  switch (scope) {
    case 'main':
      // All DMs share one session (per agent)
      return `agent:${agentId}:dm:main`;

    case 'per-peer':
      // Isolate by sender across all channels
      return `agent:${agentId}:dm:peer:${message.userId}`;

    case 'per-channel-peer':
    default:
      // Isolate by channel + sender (most specific)
      return `agent:${agentId}:${message.platform}:dm:${message.chatId}:${message.userId}`;
  }
}

export function createSessionManager(db: Database, configInput?: Config['session']): SessionManager {
  const sessions = new Map<string, Session>();

  // Merge with defaults
  const config: SessionConfig = {
    dmScope: configInput?.dmScope || DEFAULT_CONFIG.dmScope,
    reset: {
      mode: configInput?.reset?.mode || DEFAULT_CONFIG.reset.mode,
      atHour: configInput?.reset?.atHour ?? DEFAULT_CONFIG.reset.atHour,
      idleMinutes: configInput?.reset?.idleMinutes ?? DEFAULT_CONFIG.reset.idleMinutes,
    },
    resetTriggers: configInput?.resetTriggers || DEFAULT_CONFIG.resetTriggers,
  };

  logger.info({ config }, 'Session manager initialized');

  // Track last reset date for daily reset
  let lastDailyResetDate: string | null = null;

  // Schedule daily reset check
  const dailyResetInterval = setInterval(() => {
    if (config.reset.mode === 'daily' || config.reset.mode === 'both') {
      checkDailyReset();
    }
  }, 60000); // Check every minute

  // Schedule idle reset check
  const idleResetInterval = setInterval(() => {
    if (config.reset.mode === 'idle' || config.reset.mode === 'both') {
      checkIdleResets();
    }
  }, 60000); // Check every minute

  function checkDailyReset() {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const currentHour = now.getHours();

    // Only reset once per day at the configured hour
    if (currentHour === config.reset.atHour && lastDailyResetDate !== today) {
      logger.info({ hour: config.reset.atHour }, 'Performing daily session reset');

      // Clear all sessions
      for (const [key, session] of sessions) {
        session.context.conversationHistory = [];
        db.updateSession(session);
      }

      lastDailyResetDate = today;
      logger.info({ sessionsReset: sessions.size }, 'Daily reset complete');
    }
  }

  function checkIdleResets() {
    const now = Date.now();
    const idleThreshold = config.reset.idleMinutes * 60 * 1000;
    let resetCount = 0;

    for (const [key, session] of sessions) {
      const idleTime = now - session.updatedAt.getTime();
      if (idleTime > idleThreshold && session.context.conversationHistory.length > 0) {
        session.context.conversationHistory = [];
        session.updatedAt = new Date();
        db.updateSession(session);
        resetCount++;
        logger.debug({ sessionKey: key, idleMinutes: Math.round(idleTime / 60000) }, 'Session reset due to idle');
      }
    }

    if (resetCount > 0) {
      logger.info({ resetCount }, 'Idle sessions reset');
    }
  }

  return {
    async getOrCreateSession(message: IncomingMessage): Promise<Session> {
      const key = generateSessionKey(message, config.dmScope);

      // Check memory cache first
      let session = sessions.get(key);
      if (session) {
        return session;
      }

      // Check database
      session = db.getSession(key);
      if (session) {
        sessions.set(key, session);
        return session;
      }

      // Ensure user exists
      let user = db.getUserByPlatformId(message.platform, message.userId);
      if (!user) {
        user = {
          id: crypto.randomUUID(),
          platform: message.platform,
          platformUserId: message.userId,
          settings: {
            alertsEnabled: true,
            digestEnabled: false,
            defaultPlatforms: ['polymarket'],
            notifyOnEdge: false,
            edgeThreshold: 0.1,
          },
          createdAt: new Date(),
          lastActiveAt: new Date(),
        };
        db.createUser(user);
      }

      // Create new session
      session = {
        id: crypto.randomUUID(),
        key,
        userId: user.id,
        channel: message.platform,
        chatId: message.chatId,
        chatType: message.chatType,
        context: {
          messageCount: 0,
          lastMarkets: [],
          preferences: {},
          conversationHistory: [],
        },
        history: [],
        lastActivity: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      db.createSession(session);
      sessions.set(key, session);

      logger.info({ key, scope: config.dmScope }, 'Created new session');
      return session;
    },

    getSession(key: string): Session | undefined {
      return sessions.get(key) || db.getSession(key);
    },

    updateSession(session: Session): void {
      session.updatedAt = new Date();
      sessions.set(session.key, session);
      db.updateSession(session);
    },

    deleteSession(key: string): void {
      sessions.delete(key);
      db.deleteSession(key);
    },

    addToHistory(session: Session, role: 'user' | 'assistant', content: string): void {
      if (!session.context.conversationHistory) {
        session.context.conversationHistory = [];
      }

      session.context.conversationHistory.push({
        role,
        content,
        timestamp: Date.now(),
      });

      // Trim to max length (keep most recent)
      if (session.context.conversationHistory.length > MAX_HISTORY_LENGTH) {
        session.context.conversationHistory = session.context.conversationHistory.slice(-MAX_HISTORY_LENGTH);
      }

      this.updateSession(session);
    },

    getHistory(session: Session): ConversationMessage[] {
      return session.context.conversationHistory || [];
    },

    clearHistory(session: Session): void {
      session.context.conversationHistory = [];
      this.updateSession(session);
      logger.info({ sessionKey: session.key }, 'Conversation history cleared');
    },

    reset(sessionId: string): void {
      const session = sessions.get(sessionId);
      if (session) {
        session.history = [];
        session.context.conversationHistory = [];
        session.lastActivity = new Date();
        this.updateSession(session);
        logger.info({ sessionId }, 'Session reset');
      }
    },

    checkScheduledResets(): void {
      if (config.reset.mode === 'daily' || config.reset.mode === 'both') {
        checkDailyReset();
      }
      if (config.reset.mode === 'idle' || config.reset.mode === 'both') {
        checkIdleResets();
      }
    },

    getConfig(): SessionConfig {
      return config;
    },
  };
}
