/**
 * Signal Bus — Typed event hub for feed → consumer fan-out with error isolation.
 *
 * Subscribes to FeedManager 'price' and 'orderbook' events once, then safely
 * distributes updates to all registered consumers.  A single listener throwing
 * never takes down the others.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import type { Platform } from '../types';
import type { FeedManager } from '../feeds/index';

// Re-export shared types from public module
export type { TickUpdate, OrderbookUpdate, TradingSignal, SignalBus } from '../types/signal-bus.js';
import type { TickUpdate, OrderbookUpdate, TradingSignal, SignalBus } from '../types/signal-bus.js';

// ── Factory ─────────────────────────────────────────────────────────────────

export function createSignalBus(): SignalBus {
  const bus = new EventEmitter() as SignalBus;
  bus.setMaxListeners(50); // plenty of room for all consumers

  let currentFeeds: FeedManager | null = null;
  let priceHandler: ((update: any) => void) | null = null;
  let orderbookHandler: ((update: any) => void) | null = null;

  // Override emit so ALL events (tick, orderbook, signal) get error isolation.
  // The feature engine calls emitter.emit('signal', ...) directly — without this
  // override that would bypass safeEmit and one listener throwing kills the rest.
  const originalEmit = bus.emit.bind(bus);
  bus.emit = (event: string | symbol, ...args: unknown[]): boolean => {
    if (typeof event !== 'string') return originalEmit(event, ...args);
    const listeners = bus.rawListeners(event);
    for (const listener of listeners) {
      try {
        (listener as (...a: unknown[]) => void)(...args);
      } catch (error) {
        logger.error({ error, event }, 'Signal bus listener error — isolated');
      }
    }
    return listeners.length > 0;
  };

  bus.connectFeeds = (feeds: FeedManager) => {
    // Disconnect previous feeds (if any) before re-wiring
    bus.disconnectFeeds();

    currentFeeds = feeds;

    priceHandler = (update: any) => bus.emit('tick', update);
    orderbookHandler = (update: any) => bus.emit('orderbook', update);

    feeds.on('price', priceHandler);
    feeds.on('orderbook', orderbookHandler);

    logger.info('Signal bus connected to feeds');
  };

  bus.disconnectFeeds = () => {
    if (currentFeeds && priceHandler) {
      currentFeeds.removeListener('price', priceHandler);
    }
    if (currentFeeds && orderbookHandler) {
      currentFeeds.removeListener('orderbook', orderbookHandler);
    }
    priceHandler = null;
    orderbookHandler = null;
    currentFeeds = null;
  };

  bus.onTick = (handler) => bus.on('tick', handler);
  bus.onOrderbook = (handler) => bus.on('orderbook', handler);
  bus.onSignal = (handler) => bus.on('signal', handler);

  return bus;
}
