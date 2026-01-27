/**
 * Polymarket Feed - Real-time market data via WebSocket
 *
 * Docs: https://docs.polymarket.com/
 * WS: wss://ws-subscriptions-clob.polymarket.com/ws/market
 */

import { EventEmitter } from 'eventemitter3';
import WebSocket from 'ws';
import { logger } from '../../utils/logger';
import type { Market, PriceUpdate, Orderbook, Platform } from '../../types';

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const REST_URL = 'https://clob.polymarket.com';
const GAMMA_URL = 'https://gamma-api.polymarket.com';

export interface PolymarketFeed extends EventEmitter {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getMarket: (platform: string, marketId: string) => Promise<Market | null>;
  searchMarkets: (query: string) => Promise<Market[]>;
  getPrice: (platform: string, marketId: string) => Promise<number | null>;
  getOrderbook: (platform: string, marketId: string) => Promise<Orderbook | null>;
  subscribePrice: (
    platform: string,
    marketId: string,
    callback: (update: PriceUpdate) => void
  ) => () => void;
}

interface PolymarketMarket {
  condition_id: string;
  question_id: string;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: number;
  }>;
  question: string;
  description: string;
  end_date_iso: string;
  active: boolean;
  closed: boolean;
  volume: string;
  liquidity: string;
  slug: string;
}

export async function createPolymarketFeed(): Promise<PolymarketFeed> {
  const emitter = new EventEmitter() as PolymarketFeed;
  let ws: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  const subscriptions = new Map<string, Set<(update: PriceUpdate) => void>>();
  const marketCache = new Map<string, Market>();

  function connect() {
    if (ws) return;

    logger.info('Connecting to Polymarket WebSocket');
    ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      logger.info('Polymarket WebSocket connected');

      // Resubscribe to all markets
      for (const marketId of subscriptions.keys()) {
        subscribeToMarket(marketId);
      }
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleMessage(message);
      } catch (err) {
        logger.error({ err }, 'Failed to parse Polymarket message');
      }
    });

    ws.on('close', () => {
      logger.warn('Polymarket WebSocket disconnected');
      ws = null;
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'Polymarket WebSocket error');
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 5000);
  }

  function subscribeToMarket(marketId: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(
      JSON.stringify({
        type: 'market',
        assets_ids: [marketId],
      })
    );
  }

  function handleMessage(message: unknown) {
    // Handle price updates from WebSocket
    // TODO: Parse actual Polymarket message format
    if (message && typeof message === 'object' && 'price' in message) {
      const update = message as {
        asset_id: string;
        price: number;
        timestamp: number;
      };
      const priceUpdate: PriceUpdate = {
        platform: 'polymarket',
        marketId: update.asset_id,
        outcomeId: update.asset_id,
        price: update.price,
        timestamp: update.timestamp || Date.now(),
      };

      emitter.emit('price', priceUpdate);

      // Notify subscribers
      const callbacks = subscriptions.get(update.asset_id);
      if (callbacks) {
        for (const callback of callbacks) {
          callback(priceUpdate);
        }
      }
    }
  }

  // Fetch market data from REST API
  async function fetchMarket(marketId: string): Promise<Market | null> {
    try {
      const res = await fetch(`${GAMMA_URL}/markets/${marketId}`);
      if (!res.ok) return null;

      const data = (await res.json()) as PolymarketMarket;
      return convertMarket(data);
    } catch (err) {
      logger.error({ err, marketId }, 'Failed to fetch market');
      return null;
    }
  }

  // Search markets
  async function searchMarketsREST(query: string): Promise<Market[]> {
    try {
      const res = await fetch(
        `${GAMMA_URL}/markets?_limit=20&active=true&closed=false&_q=${encodeURIComponent(query)}`
      );
      if (!res.ok) return [];

      const data = (await res.json()) as PolymarketMarket[];
      return data.map(convertMarket);
    } catch (err) {
      logger.error({ err, query }, 'Failed to search markets');
      return [];
    }
  }

  function convertMarket(data: PolymarketMarket): Market {
    return {
      id: data.condition_id,
      platform: 'polymarket' as Platform,
      slug: data.slug,
      question: data.question,
      description: data.description,
      outcomes: data.tokens.map((t) => ({
        id: t.token_id,
        tokenId: t.token_id,
        name: t.outcome,
        price: t.price,
        volume24h: 0,
      })),
      volume24h: parseFloat(data.volume) || 0,
      liquidity: parseFloat(data.liquidity) || 0,
      endDate: data.end_date_iso ? new Date(data.end_date_iso) : undefined,
      resolved: data.closed,
      tags: [],
      url: `https://polymarket.com/event/${data.slug}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  emitter.start = async () => {
    connect();
  };

  emitter.stop = async () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  };

  emitter.getMarket = async (_platform: string, marketId: string) => {
    // Check cache first
    const cached = marketCache.get(marketId);
    if (cached) return cached;

    // Fetch from API
    const market = await fetchMarket(marketId);
    if (market) {
      marketCache.set(marketId, market);
    }
    return market;
  };

  emitter.searchMarkets = async (query: string) => {
    return searchMarketsREST(query);
  };

  emitter.getPrice = async (_platform: string, marketId: string) => {
    const market = await emitter.getMarket('polymarket', marketId);
    if (market && market.outcomes.length > 0) {
      return market.outcomes[0].price;
    }
    return null;
  };

  emitter.getOrderbook = async (
    _platform: string,
    _marketId: string
  ): Promise<Orderbook | null> => {
    // TODO: Implement orderbook fetching
    return null;
  };

  emitter.subscribePrice = (
    _platform: string,
    marketId: string,
    callback: (update: PriceUpdate) => void
  ) => {
    if (!subscriptions.has(marketId)) {
      subscriptions.set(marketId, new Set());
      subscribeToMarket(marketId);
    }
    subscriptions.get(marketId)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = subscriptions.get(marketId);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          subscriptions.delete(marketId);
        }
      }
    };
  };

  return emitter;
}
