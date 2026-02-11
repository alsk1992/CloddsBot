/**
 * Polymarket Feed - Real-time market data via WebSocket
 *
 * Docs: https://docs.polymarket.com/
 * WS: wss://ws-subscriptions-clob.polymarket.com/ws/market
 */

import { EventEmitter } from 'eventemitter3';
import WebSocket from 'ws';
import { logger } from '../../utils/logger';
import type { Market, PriceUpdate, Orderbook, OrderbookUpdate, Platform } from '../../types';
import { getGlobalFreshnessTracker, type FreshnessTracker } from '../freshness';

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

interface PolymarketOrderbookResponse {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

export async function createPolymarketFeed(): Promise<PolymarketFeed> {
  const emitter = new EventEmitter() as PolymarketFeed;
  let ws: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let initialSubscriptionSent = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_DELAY = 60000; // 60s max
  const subscriptions = new Map<string, Set<(update: PriceUpdate) => void>>();
  const lastPrices = new Map<string, number>();

  // Market cache with TTL and size limit to prevent memory leaks
  const MARKET_CACHE_MAX_SIZE = 1000;
  const MARKET_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  const marketCache = new Map<string, { market: Market; cachedAt: number }>();

  function getFromMarketCache(marketId: string): Market | undefined {
    const entry = marketCache.get(marketId);
    if (!entry) return undefined;
    // Check TTL
    if (Date.now() - entry.cachedAt > MARKET_CACHE_TTL_MS) {
      marketCache.delete(marketId);
      return undefined;
    }
    return entry.market;
  }

  function setInMarketCache(marketId: string, market: Market): void {
    // Enforce size limit (LRU-style: delete oldest entries)
    if (marketCache.size >= MARKET_CACHE_MAX_SIZE) {
      // Delete first 10% of entries (oldest by insertion order)
      const toDelete = Math.floor(MARKET_CACHE_MAX_SIZE * 0.1);
      let deleted = 0;
      for (const key of marketCache.keys()) {
        if (deleted >= toDelete) break;
        marketCache.delete(key);
        deleted++;
      }
    }
    marketCache.set(marketId, { market, cachedAt: Date.now() });
  }

  // Freshness tracking for WebSocket health monitoring
  const freshnessTracker: FreshnessTracker = getGlobalFreshnessTracker();

  function connect() {
    if (ws) return;

    logger.info('Connecting to Polymarket WebSocket');
    const socket = new WebSocket(WS_URL);
    ws = socket;

    socket.on('open', () => {
      if (ws !== socket) { try { socket.close(); } catch { /* */ } return; }
      logger.info('Polymarket WebSocket connected');
      reconnectAttempts = 0;
      // Cancel pending reconnect — we're already connected
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      initialSubscriptionSent = false;

      // Resubscribe to all markets
      const assetIds = Array.from(subscriptions.keys());
      if (assetIds.length > 0) {
        sendInitialSubscription(assetIds);
      }
    });

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleMessage(message);
      } catch (err) {
        logger.error({ err }, 'Failed to parse Polymarket message');
      }
    });

    socket.on('close', () => {
      if (ws !== socket) return; // Stale socket, ignore
      logger.warn('Polymarket WebSocket disconnected');
      ws = null;
      scheduleReconnect();
    });

    socket.on('error', (err) => {
      logger.error({ err }, 'Polymarket WebSocket error');
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
    reconnectAttempts++;
    logger.info({ delay, attempt: reconnectAttempts }, 'Polymarket reconnecting...');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function sendInitialSubscription(assetIds: string[]) {
    if (!ws || ws.readyState !== WebSocket.OPEN || assetIds.length === 0) return;

    ws.send(
      JSON.stringify({
        type: 'market',
        assets_ids: assetIds,
        initial_dump: true,
        custom_feature_enabled: true,
      })
    );
    initialSubscriptionSent = true;
  }

  function subscribeToMarket(marketId: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (!initialSubscriptionSent) {
      sendInitialSubscription([marketId]);
      return;
    }

    ws.send(
      JSON.stringify({
        assets_ids: [marketId],
        operation: 'subscribe',
        initial_dump: true,
        custom_feature_enabled: true,
      })
    );
  }

  function toNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function toTimestamp(value: unknown): number {
    const parsed = toNumber(value);
    return parsed && parsed > 0 ? Math.floor(parsed) : Date.now();
  }

  function pickMidPrice(bestBid: number | null, bestAsk: number | null, fallback?: number | null): number | null {
    if (bestBid !== null && bestAsk !== null) {
      return (bestBid + bestAsk) / 2;
    }
    if (bestBid !== null) return bestBid;
    if (bestAsk !== null) return bestAsk;
    return fallback ?? null;
  }

  function emitPriceUpdate(assetId: string, marketId: string, price: number, timestamp: number) {
    const previousPrice = lastPrices.get(assetId);
    lastPrices.set(assetId, price);

    // Record message for freshness tracking
    freshnessTracker.recordMessage('polymarket', assetId);

    const priceUpdate: PriceUpdate = {
      platform: 'polymarket',
      marketId,
      outcomeId: assetId,
      price,
      previousPrice,
      timestamp,
    };

    emitter.emit('price', priceUpdate);

    const callbacks = subscriptions.get(assetId);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(priceUpdate);
      }
    }
  }

  function emitOrderbookUpdate(
    assetId: string,
    marketId: string,
    bids: Array<[number, number]>,
    asks: Array<[number, number]>,
    timestamp: number
  ) {
    const orderbookUpdate: OrderbookUpdate = {
      platform: 'polymarket' as Platform,
      marketId,
      outcomeId: assetId,
      bids,
      asks,
      timestamp,
    };

    emitter.emit('orderbook', orderbookUpdate);
  }

  function handleMessage(message: unknown) {
    if (!message || typeof message !== 'object') return;
    const msg = message as Record<string, unknown>;
    const eventType = msg.event_type as string | undefined;
    if (!eventType) return;

    switch (eventType) {
      case 'book': {
        const assetId = msg.asset_id as string | undefined;
        const marketId = (msg.market as string | undefined) || assetId;
        if (!assetId || !marketId) return;

        const bidsRaw = (msg.bids || msg.buys) as Array<{ price?: string | number; size?: string | number }> | undefined;
        const asksRaw = (msg.asks || msg.sells) as Array<{ price?: string | number; size?: string | number }> | undefined;

        let bestBid: number | null = null;
        let bestAsk: number | null = null;

        // Parse bids with sizes for orderbook recording
        const bids: Array<[number, number]> = [];
        if (Array.isArray(bidsRaw)) {
          for (const bid of bidsRaw) {
            const price = toNumber(bid?.price);
            const size = toNumber(bid?.size) ?? 0;
            if (price === null) continue;
            bids.push([price, size]);
            if (bestBid === null || price > bestBid) bestBid = price;
          }
          // Sort bids descending by price
          bids.sort((a, b) => b[0] - a[0]);
        }

        // Parse asks with sizes for orderbook recording
        const asks: Array<[number, number]> = [];
        if (Array.isArray(asksRaw)) {
          for (const ask of asksRaw) {
            const price = toNumber(ask?.price);
            const size = toNumber(ask?.size) ?? 0;
            if (price === null) continue;
            asks.push([price, size]);
            if (bestAsk === null || price < bestAsk) bestAsk = price;
          }
          // Sort asks ascending by price
          asks.sort((a, b) => a[0] - b[0]);
        }

        const timestamp = toTimestamp(msg.timestamp);

        // Emit orderbook update for tick recording
        if (bids.length > 0 || asks.length > 0) {
          emitOrderbookUpdate(assetId, marketId, bids, asks, timestamp);
        }

        // Emit price update from mid price
        const mid = pickMidPrice(bestBid, bestAsk);
        if (mid !== null) {
          emitPriceUpdate(assetId, marketId, mid, timestamp);
        }
        return;
      }
      case 'price_change': {
        const marketId = msg.market as string | undefined;
        const timestamp = toTimestamp(msg.timestamp);
        const priceChanges = msg.price_changes as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(priceChanges)) {
          for (const change of priceChanges) {
            const assetId = change.asset_id as string | undefined;
            if (!assetId) continue;
            const bestBid = toNumber(change.best_bid);
            const bestAsk = toNumber(change.best_ask);
            const price = pickMidPrice(bestBid, bestAsk, toNumber(change.price));
            if (price === null) continue;
            emitPriceUpdate(assetId, marketId || assetId, price, timestamp);
          }
          return;
        }

        // Legacy schema fallback (pre-2025-09-15)
        const legacyAssetId = msg.asset_id as string | undefined;
        const legacyChanges = msg.changes as Array<Record<string, unknown>> | undefined;
        if (legacyAssetId && Array.isArray(legacyChanges)) {
          for (const change of legacyChanges) {
            const price = toNumber(change.price);
            if (price === null) continue;
            emitPriceUpdate(legacyAssetId, marketId || legacyAssetId, price, timestamp);
          }
        }
        return;
      }
      case 'best_bid_ask': {
        const assetId = msg.asset_id as string | undefined;
        const marketId = (msg.market as string | undefined) || assetId;
        if (!assetId || !marketId) return;
        const bestBid = toNumber(msg.best_bid);
        const bestAsk = toNumber(msg.best_ask);
        const price = pickMidPrice(bestBid, bestAsk);
        if (price === null) return;
        emitPriceUpdate(assetId, marketId, price, toTimestamp(msg.timestamp));
        return;
      }
      case 'last_trade_price': {
        const assetId = msg.asset_id as string | undefined;
        const marketId = (msg.market as string | undefined) || assetId;
        if (!assetId || !marketId) return;
        const price = toNumber(msg.price);
        if (price === null) return;
        emitPriceUpdate(assetId, marketId, price, toTimestamp(msg.timestamp));
        return;
      }
      case 'tick_size_change':
      case 'new_market':
        return;
      case 'market_resolved': {
        const marketId = (msg.market as string | undefined) || (msg.condition_id as string | undefined);
        if (marketId) {
          emitter.emit('market_resolved', {
            marketId,
            conditionId: msg.condition_id as string | undefined,
            timestamp: toTimestamp(msg.timestamp),
          });
        }
        return;
      }
      default:
        return;
    }
  }

  // Fetch market data from REST API
  async function fetchMarket(marketId: string): Promise<Market | null> {
    try {
      const res = await fetch(`${GAMMA_URL}/markets/${marketId}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;

      const data = (await res.json()) as PolymarketMarket;
      return convertMarket(data);
    } catch (err) {
      logger.error({ err, marketId }, 'Failed to fetch market');
      return null;
    }
  }

  async function fetchOrderbook(tokenId: string): Promise<Orderbook | null> {
    try {
      const res = await fetch(`${REST_URL}/orderbook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_id: tokenId }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        logger.warn({ tokenId, status: res.status }, 'Polymarket orderbook fetch failed');
        return null;
      }

      const data = (await res.json()) as PolymarketOrderbookResponse;
      const bids = (data.bids || [])
        .map((bid) => [Number.parseFloat(bid.price), Number.parseFloat(bid.size)] as [number, number])
        .filter((entry) => Number.isFinite(entry[0]) && Number.isFinite(entry[1]))
        .sort((a, b) => b[0] - a[0]);

      const asks = (data.asks || [])
        .map((ask) => [Number.parseFloat(ask.price), Number.parseFloat(ask.size)] as [number, number])
        .filter((entry) => Number.isFinite(entry[0]) && Number.isFinite(entry[1]))
        .sort((a, b) => a[0] - b[0]);

      if (bids.length === 0 && asks.length === 0) {
        return null;
      }

      const bestBid = bids.length ? bids[0][0] : null;
      const bestAsk = asks.length ? asks[0][0] : null;
      const mid = bestBid !== null && bestAsk !== null
        ? (bestBid + bestAsk) / 2
        : bestBid ?? bestAsk ?? 0;
      const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : 0;

      return {
        platform: 'polymarket',
        marketId: tokenId,
        outcomeId: tokenId,
        bids,
        asks,
        spread,
        midPrice: mid,
        timestamp: Date.now(),
      };
    } catch (err) {
      logger.error({ err, tokenId }, 'Failed to fetch orderbook');
      return null;
    }
  }

  // Search markets
  async function searchMarketsREST(query: string): Promise<Market[]> {
    try {
      const res = await fetch(
        `${GAMMA_URL}/markets?_limit=20&active=true&closed=false&_q=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(15000) }
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
    // Check cache first (with TTL)
    const cached = getFromMarketCache(marketId);
    if (cached) return cached;

    // Fetch from API
    const market = await fetchMarket(marketId);
    if (market) {
      setInMarketCache(marketId, market);
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
    marketId: string
  ): Promise<Orderbook | null> => {
    return fetchOrderbook(marketId);
  };

  emitter.subscribePrice = (
    _platform: string,
    marketId: string,
    callback: (update: PriceUpdate) => void
  ) => {
    if (!subscriptions.has(marketId)) {
      subscriptions.set(marketId, new Set());
      subscribeToMarket(marketId);

      // Start freshness tracking with polling fallback
      freshnessTracker.track('polymarket', marketId, async () => {
        // Polling fallback: fetch orderbook and emit update
        const orderbook = await fetchOrderbook(marketId);
        if (orderbook && orderbook.midPrice) {
          emitPriceUpdate(marketId, marketId, orderbook.midPrice, Date.now());
        }
      });
    }
    subscriptions.get(marketId)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = subscriptions.get(marketId);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          subscriptions.delete(marketId);
          lastPrices.delete(marketId); // Clean up lastPrices to prevent memory leak
          freshnessTracker.untrack('polymarket', marketId);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                assets_ids: [marketId],
                operation: 'unsubscribe',
                custom_feature_enabled: true,
              })
            );
          }
        }
      }
    };
  };

  return emitter;
}

export * from './whale-tracker';
export * from './user-ws';
export * from './rtds';
