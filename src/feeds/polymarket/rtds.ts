/**
 * Polymarket RTDS Client - Real-Time Data Socket (comments + crypto prices)
 *
 * Docs:
 * - https://docs.polymarket.com/developers/RTDS/RTDS-overview
 * - https://docs.polymarket.com/developers/RTDS/RTDS-crypto-prices
 * - https://docs.polymarket.com/developers/RTDS/RTDS-comments
 */

import { EventEmitter } from 'eventemitter3';
import WebSocket from 'ws';
import { logger } from '../../utils/logger';

export type RtdsTopic = 'crypto_prices' | 'crypto_prices_chainlink' | 'comments';

export interface RtdsSubscription {
  topic: RtdsTopic;
  type: string;
  filters?: string;
  gammaAuthAddress?: string;
  clobAuth?: {
    key: string;
    secret: string;
    passphrase: string;
  };
}

export interface RtdsConfig {
  enabled?: boolean;
  url?: string;
  pingIntervalMs?: number;
  reconnectDelayMs?: number;
  subscriptions?: RtdsSubscription[];
}

export interface RtdsMessage {
  topic: string;
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface PolymarketRtds extends EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;
  updateSubscriptions(subscriptions: RtdsSubscription[]): void;
}

const DEFAULT_URL = 'wss://ws-live-data.polymarket.com';
const DEFAULT_PING_INTERVAL_MS = 5000;
const DEFAULT_RECONNECT_DELAY_MS = 5000;

function defaultSubscriptions(): RtdsSubscription[] {
  return [
    { topic: 'crypto_prices', type: 'update' },
    { topic: 'crypto_prices_chainlink', type: '*' },
    { topic: 'comments', type: 'comment_created' },
  ];
}

function normalizeSubscriptions(subscriptions?: RtdsSubscription[]): RtdsSubscription[] {
  if (!subscriptions || subscriptions.length === 0) {
    return defaultSubscriptions();
  }
  return subscriptions;
}

export function createPolymarketRtds(config: RtdsConfig = {}): PolymarketRtds {
  const emitter = new EventEmitter() as PolymarketRtds;
  const url = config.url || DEFAULT_URL;
  const pingIntervalMs = config.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const reconnectDelayMs = config.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;

  let ws: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let subscriptions = normalizeSubscriptions(config.subscriptions);

  function sendSubscriptions(action: 'subscribe' | 'unsubscribe', subs: RtdsSubscription[]) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (subs.length === 0) return;

    const payload = {
      action,
      subscriptions: subs.map((sub) => ({
        topic: sub.topic,
        type: sub.type,
        filters: sub.filters,
        clob_auth: sub.clobAuth,
        gamma_auth: sub.gammaAuthAddress ? { address: sub.gammaAuthAddress } : undefined,
      })),
    };

    ws.send(JSON.stringify(payload));
  }

  function startPing(): void {
    if (pingTimer) return;
    pingTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        if (typeof ws.ping === 'function') {
          ws.ping();
        } else {
          ws.send('PING');
        }
      } catch (error) {
        logger.debug({ error }, 'RTDS ping failed');
      }
    }, pingIntervalMs);
  }

  function stopPing(): void {
    if (!pingTimer) return;
    clearInterval(pingTimer);
    pingTimer = null;
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  }

  function connect(): void {
    if (ws) return;
    stopping = false;
    logger.info({ url }, 'Connecting to Polymarket RTDS');
    ws = new WebSocket(url);

    ws.on('open', () => {
      logger.info('Polymarket RTDS connected');
      sendSubscriptions('subscribe', subscriptions);
      startPing();
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as RtdsMessage;
        emitter.emit('rtds', msg);

        if (msg.topic === 'crypto_prices' || msg.topic === 'crypto_prices_chainlink') {
          emitter.emit('rtds:crypto', msg);
        }

        if (msg.topic === 'comments') {
          emitter.emit('rtds:comment', msg);
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to parse RTDS message');
      }
    });

    ws.on('error', (error) => {
      logger.warn({ error }, 'Polymarket RTDS error');
    });

    ws.on('close', () => {
      logger.warn('Polymarket RTDS disconnected');
      ws = null;
      stopPing();
      if (!stopping) {
        scheduleReconnect();
      }
    });
  }

  emitter.start = async () => {
    if (!config.enabled) return;
    connect();
  };

  emitter.stop = async () => {
    stopping = true;
    stopPing();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  };

  emitter.updateSubscriptions = (next: RtdsSubscription[]) => {
    const normalized = normalizeSubscriptions(next);
    const previous = subscriptions;
    subscriptions = normalized;

    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (previous.length > 0) {
      sendSubscriptions('unsubscribe', previous);
    }
    if (normalized.length > 0) {
      sendSubscriptions('subscribe', normalized);
    }
  };

  return emitter;
}
