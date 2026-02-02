/**
 * Tick Streamer Types - Real-time WebSocket streaming for tick data
 */

import type { WebSocket } from 'ws';

// =============================================================================
// CLIENT MESSAGES (sent by client)
// =============================================================================

export interface SubscribeMessage {
  type: 'subscribe';
  platform: string;
  marketId: string;
  outcomeId?: string;
  /** Subscribe to price ticks (default: true) */
  ticks?: boolean;
  /** Subscribe to orderbook updates (default: false) */
  orderbook?: boolean;
}

export interface UnsubscribeMessage {
  type: 'unsubscribe';
  platform: string;
  marketId: string;
  outcomeId?: string;
}

export interface PingMessage {
  type: 'ping';
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage | PingMessage;

// =============================================================================
// SERVER MESSAGES (sent to client)
// =============================================================================

export interface TickMessage {
  type: 'tick';
  platform: string;
  marketId: string;
  outcomeId: string;
  price: number;
  prevPrice: number | null;
  timestamp: number;
}

export interface OrderbookMessage {
  type: 'orderbook';
  platform: string;
  marketId: string;
  outcomeId: string;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  spread: number | null;
  midPrice: number | null;
  timestamp: number;
}

export interface SubscribedMessage {
  type: 'subscribed';
  platform: string;
  marketId: string;
  outcomeId?: string;
  ticks: boolean;
  orderbook: boolean;
}

export interface UnsubscribedMessage {
  type: 'unsubscribed';
  platform: string;
  marketId: string;
  outcomeId?: string;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  code?: string;
}

export type ServerMessage =
  | TickMessage
  | OrderbookMessage
  | SubscribedMessage
  | UnsubscribedMessage
  | PongMessage
  | ErrorMessage;

// =============================================================================
// SUBSCRIPTION MANAGEMENT
// =============================================================================

export interface Subscription {
  platform: string;
  marketId: string;
  outcomeId?: string;
  ticks: boolean;
  orderbook: boolean;
}

export interface ClientConnection {
  ws: WebSocket;
  subscriptions: Map<string, Subscription>;
  connectedAt: number;
  lastPing: number;
}

// =============================================================================
// TICK STREAMER SERVICE
// =============================================================================

export interface TickStreamer {
  /**
   * Handle a new WebSocket connection
   */
  handleConnection(ws: WebSocket): void;

  /**
   * Broadcast a price update to all subscribed clients
   */
  broadcastTick(update: {
    platform: string;
    marketId: string;
    outcomeId: string;
    price: number;
    prevPrice: number | null;
    timestamp: number;
  }): void;

  /**
   * Broadcast an orderbook update to all subscribed clients
   */
  broadcastOrderbook(update: {
    platform: string;
    marketId: string;
    outcomeId: string;
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
    spread: number | null;
    midPrice: number | null;
    timestamp: number;
  }): void;

  /**
   * Get current stats
   */
  getStats(): StreamerStats;

  /**
   * Cleanup and stop the streamer
   */
  stop(): void;
}

export interface StreamerStats {
  connectedClients: number;
  totalSubscriptions: number;
  ticksBroadcast: number;
  orderbooksBroadcast: number;
  uptime: number;
}

export interface TickStreamerConfig {
  /** Max subscriptions per client (default: 100) */
  maxSubscriptionsPerClient?: number;
  /** Ping interval in ms (default: 30000) */
  pingIntervalMs?: number;
  /** Connection timeout in ms (default: 60000) */
  connectionTimeoutMs?: number;
}
