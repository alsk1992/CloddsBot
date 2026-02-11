/**
 * WebChat Channel - WebSocket-based browser chat interface
 *
 * Allows users to chat with Clodds via a web browser.
 * Uses WebSocket for real-time communication.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import type { IncomingMessage, OutgoingMessage, MessageAttachment } from '../../types';

export interface WebChatConfig {
  enabled: boolean;
  authToken?: string;
}

export interface WebChatCallbacks {
  onMessage: (message: IncomingMessage) => Promise<void>;
}

export interface WebChatChannel {
  start(wss: WebSocketServer): void;
  stop(): void;
  sendMessage(msg: OutgoingMessage): Promise<string | null>;
  isConnected?: (message?: OutgoingMessage) => boolean;
  editMessage?: (msg: OutgoingMessage & { messageId: string }) => Promise<void>;
  deleteMessage?: (msg: OutgoingMessage & { messageId: string }) => Promise<void>;
  getConnectedUsers(): string[];
}

interface ChatSession {
  id: string;
  ws: WebSocket;
  userId: string;
  authenticated: boolean;
  lastActivity: Date;
}

export function createWebChatChannel(
  config: WebChatConfig,
  callbacks: WebChatCallbacks
): WebChatChannel {
  const sessions = new Map<string, ChatSession>();
  const userSockets = new Map<string, Set<string>>(); // userId -> sessionIds
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let wssRef: WebSocketServer | null = null;
  let connectionHandler: ((ws: WebSocket, req: import('http').IncomingMessage) => void) | null = null;

  function broadcastToUser(userId: string, message: object): void {
    const sessionIds = userSockets.get(userId);
    if (!sessionIds) return;

    const payload = JSON.stringify(message);
    for (const sessionId of sessionIds) {
      const session = sessions.get(sessionId);
      if (session?.ws.readyState === WebSocket.OPEN) {
        session.ws.send(payload);
      }
    }
  }

  function handleConnection(ws: WebSocket, sessionId: string): void {
    // Replace any existing connection using this sessionId (silently close old socket)
    const existing = sessions.get(sessionId);
    if (existing && existing.ws !== ws) {
      logger.info({ sessionId, oldState: existing.ws.readyState }, 'WebChat: Replacing old connection (silent)');
      // Detach old socket handlers so it can't interfere
      existing.ws.removeAllListeners();
      // Do NOT close the old socket — let it die naturally.
      // Sending close(4001) triggers the client's onclose → reconnect → eviction loop.

      // Clean up old session's user socket tracking
      const oldUserSessions = userSockets.get(existing.userId);
      if (oldUserSessions) {
        oldUserSessions.delete(sessionId);
        if (oldUserSessions.size === 0) {
          userSockets.delete(existing.userId);
        }
      }
    }

    const session: ChatSession = {
      id: sessionId,
      ws,
      userId: `web-${sessionId.slice(0, 8)}`, // Temporary ID until auth
      authenticated: false,
      lastActivity: new Date(),
    };

    sessions.set(sessionId, session);
    logger.info({ sessionId }, 'WebChat: New connection');

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      sessionId,
      message: 'Connected to Clodds. Send { "type": "auth", "token": "..." } to authenticate (token required if configured).',
    }));

    ws.on('message', async (data: Buffer) => {
      try {
        // Guard against oversized messages (1MB limit)
        if (data.length > 1024 * 1024) {
          ws.send(JSON.stringify({ type: 'error', message: 'Message too large' }));
          return;
        }
        const message = JSON.parse(data.toString());
        session.lastActivity = new Date();

        switch (message.type) {
          case 'auth':
            if (config.authToken && message.token !== config.authToken) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid token',
              }));
              logger.warn({ sessionId }, 'WebChat: Invalid auth token');
              return;
            }
            if (message.token || !config.authToken) {
              session.authenticated = true;
              session.userId = message.userId || `web-${sessionId.slice(0, 8)}`;

              // Track user sockets
              if (!userSockets.has(session.userId)) {
                userSockets.set(session.userId, new Set());
              }
              userSockets.get(session.userId)!.add(sessionId);

              ws.send(JSON.stringify({
                type: 'authenticated',
                userId: session.userId,
              }));

              logger.info({ sessionId, userId: session.userId, wsVersion: message._wsVersion || 0, totalSessions: sessions.size }, 'WebChat: Authenticated');
            } else {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Missing token',
              }));
            }
            break;

          case 'message':
            if (!session.authenticated) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Not authenticated. Send auth first.',
              }));
              return;
            }

            const attachments: MessageAttachment[] = Array.isArray(message.attachments)
              ? message.attachments
              : [];

            if ((!message.text || typeof message.text !== 'string') && attachments.length === 0) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Missing or invalid text field',
              }));
              return;
            }

            // Convert to IncomingMessage
            const incomingMessage: IncomingMessage = {
              id: randomUUID(),
              platform: 'webchat',
              userId: session.userId,
              chatId: session.id, // Use current session id (updated by switch)
              chatType: 'dm',
              text: typeof message.text === 'string' ? message.text.trim() : '',
              attachments: attachments.length > 0 ? attachments : undefined,
              timestamp: new Date(),
            };

            // Acknowledge receipt
            ws.send(JSON.stringify({
              type: 'ack',
              messageId: incomingMessage.id,
            }));

            // Process through callbacks
            await callbacks.onMessage(incomingMessage);
            break;

          case 'edit':
            if (!session.authenticated) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Not authenticated. Send auth first.',
              }));
              return;
            }
            if (!message.messageId || typeof message.messageId !== 'string') {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Missing messageId for edit',
              }));
              return;
            }
            ws.send(JSON.stringify({
              type: 'edit',
              messageId: message.messageId,
              text: message.text || '',
            }));
            break;

          case 'delete':
            if (!session.authenticated) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Not authenticated. Send auth first.',
              }));
              return;
            }
            if (!message.messageId || typeof message.messageId !== 'string') {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Missing messageId for delete',
              }));
              return;
            }
            ws.send(JSON.stringify({
              type: 'delete',
              messageId: message.messageId,
            }));
            break;

          case 'switch':
            if (!session.authenticated) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Not authenticated. Send auth first.',
              }));
              return;
            }
            if (message.sessionId && typeof message.sessionId === 'string') {
              // Remove old session mapping, create new one
              const oldSessionId = session.id;
              sessions.delete(oldSessionId);

              const newSessionId = message.sessionId;

              // Silently replace any existing connection at the target session
              const existingAtNew = sessions.get(newSessionId);
              if (existingAtNew && existingAtNew.ws !== ws) {
                existingAtNew.ws.removeAllListeners();
                // Don't close — let it die naturally to avoid reconnect loops
                sessions.delete(newSessionId);
              }

              session.id = newSessionId;
              sessions.set(newSessionId, session);

              // Update user socket tracking
              const userSessions = userSockets.get(session.userId);
              if (userSessions) {
                userSessions.delete(oldSessionId);
                userSockets.get(session.userId)!.add(newSessionId);
              }

              ws.send(JSON.stringify({
                type: 'switched',
                sessionId: newSessionId,
              }));
              logger.info({ oldSessionId, newSessionId, userId: session.userId }, 'WebChat: Session switched');
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

          default:
            ws.send(JSON.stringify({
              type: 'error',
              message: `Unknown message type: ${typeof message.type === 'string' ? message.type.slice(0, 50) : 'invalid'}`,
            }));
        }
      } catch (error) {
        logger.error({ error, sessionId: session.id }, 'WebChat: Error processing message');
        try {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to process message',
          }));
        } catch { /* socket may already be closed */ }
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      // Use session.id (not the closure's sessionId) since it may have been updated by switch
      const currentId = session.id;
      logger.info({ sessionId: currentId, code, reason: reason?.toString() || '' }, 'WebChat: Connection closed');

      // Only clean up if this session still owns the map entry (not evicted by a replacement)
      const mapped = sessions.get(currentId);
      if (!mapped || mapped.ws !== ws) return;

      // Clean up user socket tracking
      const userId = session.userId;
      const userSessionIds = userSockets.get(userId);
      if (userSessionIds) {
        userSessionIds.delete(currentId);
        if (userSessionIds.size === 0) {
          userSockets.delete(userId);
        }
      }

      sessions.delete(currentId);
    });

    ws.on('error', (error) => {
      logger.error({ error, sessionId: session.id }, 'WebChat: WebSocket error');
    });
  }

  return {
    start(wss: WebSocketServer): void {
      logger.info('WebChat: Starting channel');

      // Remove any previous listener to prevent double-registration on reload
      if (wssRef && connectionHandler) {
        wssRef.off('connection', connectionHandler);
      }

      wssRef = wss;

      // Handle upgrades for /chat path
      connectionHandler = (ws, req) => {
        // Only handle /chat connections
        const url = req.url || '';
        if (!url.startsWith('/chat')) return;

        // Support sessionId from URL query param
        let sessionId: string;
        try {
          const parsed = new URL(url, 'http://localhost');
          sessionId = parsed.searchParams.get('sessionId') || randomUUID();
        } catch {
          sessionId = randomUUID();
        }
        handleConnection(ws, sessionId);
      };
      wss.on('connection', connectionHandler);

      // Heartbeat to clean up dead connections
      heartbeatInterval = setInterval(() => {
        const now = new Date();
        const timeout = 5 * 60 * 1000; // 5 minutes

        for (const [sessionId, session] of sessions) {
          if (now.getTime() - session.lastActivity.getTime() > timeout) {
            if (session.ws.readyState === WebSocket.OPEN) {
              session.ws.close(4000, 'Idle timeout');
            }
            sessions.delete(sessionId);

            // Clean up user socket tracking
            const userSessionIds = userSockets.get(session.userId);
            if (userSessionIds) {
              userSessionIds.delete(sessionId);
              if (userSessionIds.size === 0) {
                userSockets.delete(session.userId);
              }
            }

            logger.info({ sessionId }, 'WebChat: Closed idle connection');
          }
        }
      }, 60000); // Check every minute

      logger.info('WebChat: Channel started');
    },

    stop(): void {
      // Remove WSS connection listener to prevent double-registration on reload
      if (wssRef && connectionHandler) {
        wssRef.off('connection', connectionHandler);
        connectionHandler = null;
        wssRef = null;
      }

      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      // Close all connections
      for (const [, session] of sessions) {
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.close(1000, 'Server shutting down');
        }
      }

      sessions.clear();
      userSockets.clear();
      logger.info('WebChat: Channel stopped');
    },

    async sendMessage(msg: OutgoingMessage): Promise<string | null> {
      // Find session by chatId (sessionId)
      const session = sessions.get(msg.chatId);
      const messageId = (msg as { messageId?: string }).messageId ?? randomUUID();

      if (session?.ws.readyState === WebSocket.OPEN) {
        try {
          session.ws.send(JSON.stringify({
            type: 'message',
            messageId,
            text: msg.text,
            parseMode: msg.parseMode,
            buttons: msg.buttons,
            attachments: msg.attachments || [],
            timestamp: new Date().toISOString(),
          }));
        } catch (err) {
          logger.warn({ chatId: msg.chatId, err }, 'WebChat: Send failed (connection closed mid-send)');
          throw new Error('WebChat session not connected');
        }
        return messageId;
      } else {
        logger.warn({ chatId: msg.chatId }, 'WebChat: Session not found or closed');
        throw new Error('WebChat session not connected');
      }
    },

    async editMessage(msg: OutgoingMessage & { messageId: string }): Promise<void> {
      const session = sessions.get(msg.chatId);
      if (session?.ws.readyState === WebSocket.OPEN) {
        try {
          session.ws.send(JSON.stringify({
            type: 'edit',
            messageId: msg.messageId,
            text: msg.text,
            parseMode: msg.parseMode,
          }));
        } catch {
          // Connection closed between readyState check and send — ignore
        }
      }
    },

    async deleteMessage(msg: OutgoingMessage & { messageId: string }): Promise<void> {
      const session = sessions.get(msg.chatId);
      if (session?.ws.readyState === WebSocket.OPEN) {
        try {
          session.ws.send(JSON.stringify({
            type: 'delete',
            messageId: msg.messageId,
          }));
        } catch {
          // Connection closed between readyState check and send — ignore
        }
      }
    },

    getConnectedUsers(): string[] {
      return Array.from(userSockets.keys());
    },

    isConnected(message?: OutgoingMessage): boolean {
      if (!message) {
        return sessions.size > 0;
      }
      const session = sessions.get(message.chatId);
      return Boolean(session && session.ws.readyState === WebSocket.OPEN);
    },
  };
}
