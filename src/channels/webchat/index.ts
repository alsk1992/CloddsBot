/**
 * WebChat Channel - WebSocket-based browser chat interface
 *
 * Allows users to chat with Clodds via a web browser.
 * Uses WebSocket for real-time communication.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import type { IncomingMessage, OutgoingMessage } from '../../types';

export interface WebChatConfig {
  enabled: boolean;
  // Auth handled via gateway token
}

export interface WebChatCallbacks {
  onMessage: (message: IncomingMessage) => Promise<void>;
}

export interface WebChatChannel {
  start(wss: WebSocketServer): void;
  stop(): void;
  sendMessage(msg: OutgoingMessage): Promise<void>;
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
      message: 'Connected to Clodds. Send { "type": "auth", "token": "..." } to authenticate.',
    }));

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        session.lastActivity = new Date();

        switch (message.type) {
          case 'auth':
            // Simple token auth - in production, verify against gateway token
            if (message.token) {
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

              logger.info({ sessionId, userId: session.userId }, 'WebChat: Authenticated');
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

            if (!message.text || typeof message.text !== 'string') {
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
              chatId: sessionId, // Use session as chat
              chatType: 'dm',
              text: message.text.trim(),
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

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

          default:
            ws.send(JSON.stringify({
              type: 'error',
              message: `Unknown message type: ${message.type}`,
            }));
        }
      } catch (error) {
        logger.error({ error, sessionId }, 'WebChat: Error processing message');
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format',
        }));
      }
    });

    ws.on('close', () => {
      logger.info({ sessionId }, 'WebChat: Connection closed');

      // Clean up user socket tracking
      const userId = session.userId;
      const userSessionIds = userSockets.get(userId);
      if (userSessionIds) {
        userSessionIds.delete(sessionId);
        if (userSessionIds.size === 0) {
          userSockets.delete(userId);
        }
      }

      sessions.delete(sessionId);
    });

    ws.on('error', (error) => {
      logger.error({ error, sessionId }, 'WebChat: WebSocket error');
    });
  }

  return {
    start(wss: WebSocketServer): void {
      logger.info('WebChat: Starting channel');

      // Handle upgrades for /chat path
      wss.on('connection', (ws, req) => {
        // Only handle /chat connections
        if (req.url !== '/chat') return;

        const sessionId = randomUUID();
        handleConnection(ws, sessionId);
      });

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
            logger.info({ sessionId }, 'WebChat: Closed idle connection');
          }
        }
      }, 60000); // Check every minute

      logger.info('WebChat: Channel started');
    },

    stop(): void {
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

    async sendMessage(msg: OutgoingMessage): Promise<void> {
      // Find session by chatId (sessionId)
      const session = sessions.get(msg.chatId);

      if (session?.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({
          type: 'message',
          text: msg.text,
          parseMode: msg.parseMode,
          buttons: msg.buttons,
          timestamp: new Date().toISOString(),
        }));
      } else {
        logger.warn({ chatId: msg.chatId }, 'WebChat: Session not found or closed');
      }
    },

    getConnectedUsers(): string[] {
      return Array.from(userSockets.keys());
    },
  };
}
