/**
 * Polymarket User WebSocket - Per-User Fill Notifications
 *
 * Each user gets their own authenticated WebSocket connection
 * to receive real-time fill notifications for their orders.
 *
 * Protocol (from Polymarket docs):
 * 1. Connect to wss://ws-subscriptions-clob.polymarket.com/ws/user
 * 2. Send subscription: {"type": "subscribe", "channel": "user", "auth": {...}}
 * 3. Send JSON ping {"type": "ping"} every 10 seconds
 * 4. Receive trade/order events
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';
import type { PolymarketCredentials } from '../../types.js';
import { buildPolymarketHeadersForUrl } from '../../utils/polymarket-auth.js';

const USER_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/user';
const PING_INTERVAL_MS = 10000; // 10 seconds per Polymarket docs
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BACKOFF_MULTIPLIER = 1.5;

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

export interface OrderEvent {
  orderId: string;
  marketId: string;
  tokenId: string;
  type: 'PLACEMENT' | 'UPDATE' | 'CANCELLATION';
  side: 'BUY' | 'SELL';
  price: number;
  originalSize: number;
  sizeMatched: number;
  timestamp: number;
}

export interface UserWebSocketEvents {
  fill: (event: FillEvent) => void;
  order: (event: OrderEvent) => void;
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
  let subscribed = false;
  let reconnectAttempts = 0;
  let currentReconnectDelay = RECONNECT_DELAY_MS;

  const sendSubscription = (): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Build auth headers for subscription message
    const authHeaders = buildPolymarketHeadersForUrl(
      {
        address: credentials.funderAddress,
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        apiPassphrase: credentials.apiPassphrase,
      },
      'GET',
      USER_WS_URL
    );

    // Send subscription with embedded auth
    const subscribeMsg = {
      type: 'subscribe',
      channel: 'user',
      auth: {
        apiKey: credentials.apiKey,
        secret: credentials.apiSecret,
        passphrase: credentials.apiPassphrase,
        // Include HMAC headers for additional auth
        ...authHeaders,
      },
    };

    ws.send(JSON.stringify(subscribeMsg));
    logger.info({ userId }, 'Sent user channel subscription');
  };

  const sendPing = (): void => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  };

  const connect = async (): Promise<void> => {
    if (ws && connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // Close stale socket before creating new one
        if (ws) { try { ws.close(); } catch { /* */ } ws = null; }
        const socket = new WebSocket(USER_WS_URL);
        ws = socket;

        socket.on('open', () => {
          if (ws !== socket) { try { socket.close(); } catch { /* */ } return; }
          connected = true;
          subscribed = false;
          logger.info({ userId }, 'User WebSocket connected');
          // Cancel pending reconnect — we're already connected
          if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }

          // Send subscription message
          sendSubscription();

          // Start JSON ping keepalive (every 10s per Polymarket docs)
          pingInterval = setInterval(sendPing, PING_INTERVAL_MS);

          emitter.emit('connected');
          resolve();
        });

        socket.on('message', (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString());

            // Handle pong response
            if (message.type === 'pong') {
              return;
            }

            // Handle subscription confirmation (must be type=subscribed AND channel=user)
            if (message.type === 'subscribed' && message.channel === 'user') {
              if (!subscribed) {
                subscribed = true;
                reconnectAttempts = 0; // Reset on successful subscription
                currentReconnectDelay = RECONNECT_DELAY_MS;
                logger.info({ userId }, 'User channel subscription confirmed');
              }
            }

            // Handle trade events (fills)
            if (message.event_type === 'trade' || message.type === 'trade') {
              const fill: FillEvent = {
                orderId: message.order_id || message.id || '',
                marketId: message.market || message.condition_id || '',
                tokenId: message.asset_id || message.token_id || '',
                side: (message.side?.toUpperCase() || 'BUY') as 'BUY' | 'SELL',
                size: parseFloat(message.size || message.matched_amount || '0'),
                price: parseFloat(message.price || '0'),
                status: (message.status?.toUpperCase() || 'MATCHED') as FillEvent['status'],
                timestamp: message.timestamp ? new Date(message.timestamp).getTime() : Date.now(),
                transactionHash: message.transaction_hash || message.transactionHash,
              };

              logger.info({ userId, fill }, 'Fill notification received');
              emitter.emit('fill', fill);
            }

            // Handle order events (placements, updates, cancellations)
            if (message.event_type === 'order' || message.type === 'order') {
              const validOrderTypes = new Set<OrderEvent['type']>(['PLACEMENT', 'UPDATE', 'CANCELLATION']);
              const rawType = (message.order_type || '').toUpperCase();
              const orderType: OrderEvent['type'] = validOrderTypes.has(rawType as OrderEvent['type'])
                ? (rawType as OrderEvent['type'])
                : 'UPDATE';

              const orderEvent: OrderEvent = {
                orderId: message.order_id || message.id || '',
                marketId: message.market || message.condition_id || '',
                tokenId: message.asset_id || message.token_id || '',
                type: orderType,
                side: (message.side?.toUpperCase() || 'BUY') as 'BUY' | 'SELL',
                price: parseFloat(message.price || '0'),
                originalSize: parseFloat(message.original_size || message.size || '0'),
                sizeMatched: parseFloat(message.size_matched || '0'),
                timestamp: message.timestamp ? new Date(message.timestamp).getTime() : Date.now(),
              };

              logger.info({ userId, orderEvent }, 'Order event received');
              emitter.emit('order', orderEvent);
            }

          } catch (err) {
            logger.error({ userId, err, data: data.toString() }, 'Failed to parse WS message');
          }
        });

        socket.on('close', (code, reason) => {
          if (ws !== socket) return; // Stale socket, ignore
          connected = false;
          subscribed = false;
          if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
          }

          logger.info({ userId, code, reason: reason.toString() }, 'User WebSocket disconnected');
          emitter.emit('disconnected');

          // Auto-reconnect after delay (unless intentionally closed or max attempts reached)
          if (code !== 1000) {
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
              logger.error({ userId, attempts: reconnectAttempts }, 'Max reconnect attempts reached, giving up');
              emitter.emit('error', new Error(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`));
              return;
            }

            reconnectAttempts++;
            logger.info({ userId, attempt: reconnectAttempts, delay: currentReconnectDelay }, 'Scheduling WebSocket reconnection');

            reconnectTimeout = setTimeout(() => {
              logger.info({ userId, attempt: reconnectAttempts }, 'Attempting WebSocket reconnection');
              connect().catch(err => {
                logger.error({ userId, err }, 'Reconnection failed');
              });
            }, currentReconnectDelay);

            // Exponential backoff
            currentReconnectDelay = Math.min(currentReconnectDelay * RECONNECT_BACKOFF_MULTIPLIER, 60000);
          }
        });

        socket.on('error', (error) => {
          logger.error({ userId, error }, 'User WebSocket error');
          emitter.emit('error', error);
          reject(error);
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
    subscribed = false;
  };

  const isConnected = (): boolean => connected && subscribed;

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
  const connecting = new Map<string, Promise<UserWebSocket>>();

  return {
    async getOrCreate(userId: string, credentials: PolymarketCredentials): Promise<UserWebSocket> {
      const conn = connections.get(userId);
      if (conn?.isConnected()) return conn;

      // Deduplicate concurrent calls: if a connection attempt is already
      // in-flight for this userId, return the same promise instead of
      // creating a second WebSocket.
      const inflight = connecting.get(userId);
      if (inflight) return inflight;

      const promise = (async () => {
        try {
          conn?.disconnect();
          const newConn = createUserWebSocket(userId, credentials);
          connections.set(userId, newConn);
          await newConn.connect();
          return newConn;
        } finally {
          connecting.delete(userId);
        }
      })();

      connecting.set(userId, promise);
      return promise;
    },

    disconnect(userId: string): void {
      const conn = connections.get(userId);
      if (conn) {
        conn.disconnect();
        connections.delete(userId);
      }
      connecting.delete(userId);
    },

    disconnectAll(): void {
      for (const [userId, conn] of connections) {
        conn.disconnect();
        connections.delete(userId);
      }
      connecting.clear();
    },
  };
}
