/**
 * Tick Streamer Service - Real-time WebSocket streaming for tick data
 *
 * Bridges feed events to WebSocket clients with subscription management.
 * Clients can subscribe to specific platform/market combinations.
 */

import type { WebSocket } from 'ws';
import { logger } from '../../utils/logger';
import type {
  TickStreamer,
  TickStreamerConfig,
  ClientConnection,
  Subscription,
  ClientMessage,
  ServerMessage,
  StreamerStats,
} from './types';

const DEFAULT_MAX_SUBSCRIPTIONS = 100;
const DEFAULT_PING_INTERVAL_MS = 30000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 60000;

/**
 * Create a subscription key for indexing
 */
function makeSubKey(platform: string, marketId: string, outcomeId?: string): string {
  return outcomeId ? `${platform}:${marketId}:${outcomeId}` : `${platform}:${marketId}`;
}

/**
 * Create a market key (without outcome) for broadcast matching
 */
function makeMarketKey(platform: string, marketId: string): string {
  return `${platform}:${marketId}`;
}

/**
 * Create the tick streamer service
 */
export function createTickStreamer(config: TickStreamerConfig = {}): TickStreamer {
  const maxSubscriptions = config.maxSubscriptionsPerClient ?? DEFAULT_MAX_SUBSCRIPTIONS;
  const pingIntervalMs = config.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const connectionTimeoutMs = config.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;

  /** All connected clients */
  const clients = new Set<ClientConnection>();

  /** Index: subscription key -> set of clients subscribed */
  const tickSubscribers = new Map<string, Set<ClientConnection>>();
  const orderbookSubscribers = new Map<string, Set<ClientConnection>>();

  /** Stats */
  let ticksBroadcast = 0;
  let orderbooksBroadcast = 0;
  const startTime = Date.now();

  /** Ping interval handle */
  let pingInterval: NodeJS.Timeout | null = null;

  /**
   * Send a message to a client
   */
  function send(client: ClientConnection, message: ServerMessage): void {
    if (client.ws.readyState === 1) {
      // WebSocket.OPEN
      try {
        client.ws.send(JSON.stringify(message));
      } catch (err) {
        logger.error({ err }, 'Failed to send message to client');
      }
    }
  }

  /**
   * Add a subscription for a client
   */
  function addSubscription(client: ClientConnection, sub: Subscription): void {
    const key = makeSubKey(sub.platform, sub.marketId, sub.outcomeId);
    const marketKey = makeMarketKey(sub.platform, sub.marketId);

    // Store subscription on client
    client.subscriptions.set(key, sub);

    // Add to subscriber indexes (use market key for broadcast matching)
    if (sub.ticks) {
      if (!tickSubscribers.has(marketKey)) {
        tickSubscribers.set(marketKey, new Set());
      }
      tickSubscribers.get(marketKey)!.add(client);
    }

    if (sub.orderbook) {
      if (!orderbookSubscribers.has(marketKey)) {
        orderbookSubscribers.set(marketKey, new Set());
      }
      orderbookSubscribers.get(marketKey)!.add(client);
    }

    logger.debug(
      { platform: sub.platform, marketId: sub.marketId, ticks: sub.ticks, orderbook: sub.orderbook },
      'Client subscribed'
    );
  }

  /**
   * Remove a subscription for a client
   */
  function removeSubscription(
    client: ClientConnection,
    platform: string,
    marketId: string,
    outcomeId?: string
  ): boolean {
    const key = makeSubKey(platform, marketId, outcomeId);
    const marketKey = makeMarketKey(platform, marketId);
    const sub = client.subscriptions.get(key);

    if (!sub) {
      return false;
    }

    client.subscriptions.delete(key);

    // Remove from subscriber indexes
    tickSubscribers.get(marketKey)?.delete(client);
    orderbookSubscribers.get(marketKey)?.delete(client);

    // Clean up empty sets
    if (tickSubscribers.get(marketKey)?.size === 0) {
      tickSubscribers.delete(marketKey);
    }
    if (orderbookSubscribers.get(marketKey)?.size === 0) {
      orderbookSubscribers.delete(marketKey);
    }

    logger.debug({ platform, marketId }, 'Client unsubscribed');
    return true;
  }

  /**
   * Remove all subscriptions for a client
   */
  function removeAllSubscriptions(client: ClientConnection): void {
    for (const [, sub] of client.subscriptions) {
      removeSubscription(client, sub.platform, sub.marketId, sub.outcomeId);
    }
  }

  /**
   * Handle an incoming message from a client
   */
  function handleMessage(client: ClientConnection, data: string): void {
    let message: ClientMessage;

    try {
      message = JSON.parse(data) as ClientMessage;
    } catch {
      send(client, { type: 'error', message: 'Invalid JSON', code: 'INVALID_JSON' });
      return;
    }

    switch (message.type) {
      case 'subscribe': {
        // Check subscription limit
        if (client.subscriptions.size >= maxSubscriptions) {
          send(client, {
            type: 'error',
            message: `Max subscriptions (${maxSubscriptions}) reached`,
            code: 'MAX_SUBSCRIPTIONS',
          });
          return;
        }

        const sub: Subscription = {
          platform: message.platform,
          marketId: message.marketId,
          outcomeId: message.outcomeId,
          ticks: message.ticks !== false, // Default true
          orderbook: message.orderbook === true, // Default false
        };

        addSubscription(client, sub);

        send(client, {
          type: 'subscribed',
          platform: sub.platform,
          marketId: sub.marketId,
          outcomeId: sub.outcomeId,
          ticks: sub.ticks,
          orderbook: sub.orderbook,
        });
        break;
      }

      case 'unsubscribe': {
        const removed = removeSubscription(
          client,
          message.platform,
          message.marketId,
          message.outcomeId
        );

        if (removed) {
          send(client, {
            type: 'unsubscribed',
            platform: message.platform,
            marketId: message.marketId,
            outcomeId: message.outcomeId,
          });
        } else {
          send(client, {
            type: 'error',
            message: 'Subscription not found',
            code: 'NOT_SUBSCRIBED',
          });
        }
        break;
      }

      case 'ping': {
        client.lastPing = Date.now();
        send(client, { type: 'pong', timestamp: Date.now() });
        break;
      }

      default: {
        send(client, {
          type: 'error',
          message: `Unknown message type: ${(message as any).type}`,
          code: 'UNKNOWN_TYPE',
        });
      }
    }
  }

  /**
   * Handle a client disconnection
   */
  function handleDisconnect(client: ClientConnection): void {
    removeAllSubscriptions(client);
    clients.delete(client);
    logger.info({ subscriptionCount: client.subscriptions.size }, 'WebSocket client disconnected');
  }

  /**
   * Start ping interval to detect dead connections
   */
  function startPingInterval(): void {
    if (pingInterval) return;

    pingInterval = setInterval(() => {
      const now = Date.now();

      for (const client of clients) {
        // Check if connection has timed out
        if (now - client.lastPing > connectionTimeoutMs) {
          logger.warn('Client timed out, closing connection');
          client.ws.close();
          handleDisconnect(client);
          continue;
        }

        // Send ping
        send(client, { type: 'pong', timestamp: now });
      }
    }, pingIntervalMs);
  }

  /**
   * Stop ping interval
   */
  function stopPingInterval(): void {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }

  // Start the ping interval
  startPingInterval();

  return {
    handleConnection(ws: WebSocket): void {
      const client: ClientConnection = {
        ws,
        subscriptions: new Map(),
        connectedAt: Date.now(),
        lastPing: Date.now(),
      };

      clients.add(client);
      logger.info({ totalClients: clients.size }, 'WebSocket client connected to tick stream');

      ws.on('message', (data) => {
        client.lastPing = Date.now();
        handleMessage(client, data.toString());
      });

      ws.on('close', () => {
        handleDisconnect(client);
      });

      ws.on('error', (err) => {
        logger.error({ err }, 'WebSocket client error');
        handleDisconnect(client);
      });
    },

    broadcastTick(update): void {
      const marketKey = makeMarketKey(update.platform, update.marketId);
      const subscribers = tickSubscribers.get(marketKey);

      if (!subscribers || subscribers.size === 0) {
        return;
      }

      const message: ServerMessage = {
        type: 'tick',
        platform: update.platform,
        marketId: update.marketId,
        outcomeId: update.outcomeId,
        price: update.price,
        prevPrice: update.prevPrice,
        timestamp: update.timestamp,
      };

      for (const client of subscribers) {
        send(client, message);
      }

      ticksBroadcast++;
    },

    broadcastOrderbook(update): void {
      const marketKey = makeMarketKey(update.platform, update.marketId);
      const subscribers = orderbookSubscribers.get(marketKey);

      if (!subscribers || subscribers.size === 0) {
        return;
      }

      const message: ServerMessage = {
        type: 'orderbook',
        platform: update.platform,
        marketId: update.marketId,
        outcomeId: update.outcomeId,
        bids: update.bids,
        asks: update.asks,
        spread: update.spread,
        midPrice: update.midPrice,
        timestamp: update.timestamp,
      };

      for (const client of subscribers) {
        send(client, message);
      }

      orderbooksBroadcast++;
    },

    getStats(): StreamerStats {
      let totalSubscriptions = 0;
      for (const client of clients) {
        totalSubscriptions += client.subscriptions.size;
      }

      return {
        connectedClients: clients.size,
        totalSubscriptions,
        ticksBroadcast,
        orderbooksBroadcast,
        uptime: Date.now() - startTime,
      };
    },

    stop(): void {
      stopPingInterval();

      // Close all client connections
      for (const client of clients) {
        client.ws.close();
      }
      clients.clear();
      tickSubscribers.clear();
      orderbookSubscribers.clear();

      logger.info('Tick streamer stopped');
    },
  };
}

export type { TickStreamer, TickStreamerConfig, StreamerStats } from './types';
