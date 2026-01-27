/**
 * Polymarket User WebSocket - Per-User Fill Notifications
 *
 * Each user gets their own authenticated WebSocket connection
 * to receive real-time fill notifications for their orders.
 *
 * Based on Clawdbot's per-session isolation pattern.
 */

import WebSocket from 'ws';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';
import type { PolymarketCredentials } from '../../types.js';

const USER_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/user';

export interface FillEvent {
  orderId: string;
  marketId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  status: 'MATCHED' | 'MINED' | 'CONFIRMED' | 'FAILED';
  timestamp: number;
  transactionHash?: string;
}

export interface UserWebSocketEvents {
  fill: (event: FillEvent) => void;
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
}

export interface UserWebSocket extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  on<K extends keyof UserWebSocketEvents>(event: K, listener: UserWebSocketEvents[K]): this;
  emit<K extends keyof UserWebSocketEvents>(event: K, ...args: Parameters<UserWebSocketEvents[K]>): boolean;
}

/**
 * Generate HMAC signature for Polymarket WebSocket auth
 */
function generateSignature(
  apiKey: string,
  apiSecret: string,
  timestamp: string,
  method: string,
  path: string
): string {
  const message = timestamp + method + path;
  const hmac = crypto.createHmac('sha256', Buffer.from(apiSecret, 'base64'));
  hmac.update(message);
  return hmac.digest('base64');
}

/**
 * Create authenticated WebSocket connection for a user
 */
export function createUserWebSocket(
  userId: string,
  credentials: PolymarketCredentials
): UserWebSocket {
  const emitter = new EventEmitter() as UserWebSocket;
  let ws: WebSocket | null = null;
  let pingInterval: NodeJS.Timeout | null = null;
  let reconnectTimeout: NodeJS.Timeout | null = null;
  let connected = false;

  const connect = async (): Promise<void> => {
    if (ws && connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // Generate auth headers
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signature = generateSignature(
          credentials.apiKey,
          credentials.apiSecret,
          timestamp,
          'GET',
          '/ws/user'
        );

        ws = new WebSocket(USER_WS_URL, {
          headers: {
            'POLY-ADDRESS': credentials.funderAddress,
            'POLY-SIGNATURE': signature,
            'POLY-TIMESTAMP': timestamp,
            'POLY-API-KEY': credentials.apiKey,
            'POLY-PASSPHRASE': credentials.apiPassphrase,
          },
        });

        ws.on('open', () => {
          connected = true;
          logger.info({ userId }, 'User WebSocket connected');

          // Start ping/pong keepalive (every 30s)
          pingInterval = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
              ws.ping();
            }
          }, 30000);

          emitter.emit('connected');
          resolve();
        });

        ws.on('message', (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString());

            // Handle different message types
            if (message.event_type === 'trade' || message.type === 'trade') {
              const fill: FillEvent = {
                orderId: message.order_id || message.orderId,
                marketId: message.market || message.marketId,
                tokenId: message.asset_id || message.tokenId,
                side: message.side?.toUpperCase() || 'BUY',
                size: parseFloat(message.size || message.matched_amount || '0'),
                price: parseFloat(message.price || '0'),
                status: message.status || 'MATCHED',
                timestamp: message.timestamp || Date.now(),
                transactionHash: message.transaction_hash || message.transactionHash,
              };

              logger.info({ userId, fill }, 'Fill notification received');
              emitter.emit('fill', fill);
            }
          } catch (err) {
            logger.error({ userId, err, data: data.toString() }, 'Failed to parse WS message');
          }
        });

        ws.on('close', (code, reason) => {
          connected = false;
          if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
          }

          logger.info({ userId, code, reason: reason.toString() }, 'User WebSocket disconnected');
          emitter.emit('disconnected');

          // Auto-reconnect after 5 seconds (unless intentionally closed)
          if (code !== 1000) {
            reconnectTimeout = setTimeout(() => {
              logger.info({ userId }, 'Attempting WebSocket reconnection');
              connect().catch(err => {
                logger.error({ userId, err }, 'Reconnection failed');
              });
            }, 5000);
          }
        });

        ws.on('error', (error) => {
          logger.error({ userId, error }, 'User WebSocket error');
          emitter.emit('error', error);
          reject(error);
        });

        ws.on('pong', () => {
          // Keepalive confirmed
        });

      } catch (err) {
        reject(err);
      }
    });
  };

  const disconnect = (): void => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    if (ws) {
      ws.close(1000, 'User disconnect');
      ws = null;
    }
    connected = false;
  };

  const isConnected = (): boolean => connected;

  emitter.connect = connect;
  emitter.disconnect = disconnect;
  emitter.isConnected = isConnected;

  return emitter;
}

/**
 * Manager for multiple user WebSocket connections
 * (One connection per user with active trading)
 */
export interface UserWebSocketManager {
  getOrCreate(userId: string, credentials: PolymarketCredentials): Promise<UserWebSocket>;
  disconnect(userId: string): void;
  disconnectAll(): void;
}

export function createUserWebSocketManager(): UserWebSocketManager {
  const connections = new Map<string, UserWebSocket>();

  return {
    async getOrCreate(userId: string, credentials: PolymarketCredentials): Promise<UserWebSocket> {
      let conn = connections.get(userId);

      if (!conn || !conn.isConnected()) {
        conn = createUserWebSocket(userId, credentials);
        connections.set(userId, conn);
        await conn.connect();
      }

      return conn;
    },

    disconnect(userId: string): void {
      const conn = connections.get(userId);
      if (conn) {
        conn.disconnect();
        connections.delete(userId);
      }
    },

    disconnectAll(): void {
      for (const [userId, conn] of connections) {
        conn.disconnect();
        connections.delete(userId);
      }
    },
  };
}
