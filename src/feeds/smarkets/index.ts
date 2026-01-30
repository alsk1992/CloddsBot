/**
 * Smarkets Exchange Feed
 * Betting exchange with lower fees than Betfair (2% vs 5%)
 *
 * Features:
 * - Market data (prices, volumes)
 * - Full trading (back/lay orders)
 * - WebSocket streaming
 * - Politics, sports, entertainment
 *
 * Docs: https://docs.smarkets.com/
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Market, Outcome, PriceUpdate, Platform, Orderbook } from '../../types';
import { logger } from '../../utils/logger';
import { getGlobalFreshnessTracker, type FreshnessTracker } from '../freshness';

// =============================================================================
// CONSTANTS
// =============================================================================

const SMARKETS_API_URL = 'https://api.smarkets.com/v3';
const SMARKETS_STREAM_URL = 'wss://stream.smarkets.com/v1';

// =============================================================================
// TYPES
// =============================================================================

export interface SmarketsConfig {
  /** API token (from account settings) */
  apiToken?: string;
  /** Session token for trading */
  sessionToken?: string;
}

interface SmarketsEvent {
  id: string;
  name: string;
  slug: string;
  start_datetime?: string;
  end_datetime?: string;
  state: string;
  type: { name: string; domain: string };
  parent_id?: string;
}

interface SmarketsMarket {
  id: string;
  event_id: string;
  name: string;
  slug: string;
  state: string;
  market_type: { name: string };
  winner_count: number;
  display_order: number;
  description?: string;
}

interface SmarketsContract {
  id: string;
  market_id: string;
  name: string;
  slug: string;
  state: string;
  display_order: number;
}

interface SmarketsQuote {
  contract_id: string;
  bids: Array<{ price: number; quantity: number }>;
  offers: Array<{ price: number; quantity: number }>;
  last_executed_price?: number;
  volume?: number;
}

interface SmarketsOrder {
  id: string;
  market_id: string;
  contract_id: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  quantity_filled: number;
  state: string;
  created: string;
}

export interface SmarketsFeed extends EventEmitter {
  start(): Promise<void>;
  stop(): void;

  // Market data
  searchMarkets(query: string, options?: { eventTypes?: string[] }): Promise<Market[]>;
  getMarket(marketId: string): Promise<Market | null>;
  getQuotes(marketId: string): Promise<SmarketsQuote[]>;
  getOrderbook(marketId: string, contractId: string): Promise<Orderbook | null>;

  // Subscriptions
  subscribeToMarket(marketId: string): void;
  unsubscribeFromMarket(marketId: string): void;

  // Trading
  placeBuyOrder(marketId: string, contractId: string, price: number, quantity: number): Promise<SmarketsOrder | null>;
  placeSellOrder(marketId: string, contractId: string, price: number, quantity: number): Promise<SmarketsOrder | null>;
  cancelOrder(orderId: string): Promise<boolean>;
  cancelAllOrders(marketId?: string): Promise<number>;
  getOpenOrders(marketId?: string): Promise<SmarketsOrder[]>;

  // Account
  getBalance(): Promise<{ available: number; exposure: number; total: number }>;

  // Check auth
  isAuthenticated(): boolean;
}

// =============================================================================
// SMARKETS FEED IMPLEMENTATION
// =============================================================================

export async function createSmarketsFeed(config: SmarketsConfig = {}): Promise<SmarketsFeed> {
  const emitter = new EventEmitter();
  let ws: WebSocket | null = null;
  const subscribedMarkets = new Set<string>();
  const priceCache = new Map<string, Map<string, number>>(); // marketId -> contractId -> price
  const marketCache = new Map<string, { market: SmarketsMarket; event: SmarketsEvent }>();
  const contractCache = new Map<string, SmarketsContract[]>();
  let pingInterval: NodeJS.Timeout | null = null;

  // Freshness tracking for WebSocket health monitoring
  const freshnessTracker: FreshnessTracker = getGlobalFreshnessTracker();

  const apiToken = config.apiToken || process.env.SMARKETS_API_TOKEN;
  const sessionToken = config.sessionToken || process.env.SMARKETS_SESSION_TOKEN;

  // API request helper
  async function apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T | null> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    if (sessionToken) {
      headers['Authorization'] = `Session-Token ${sessionToken}`;
    } else if (apiToken) {
      headers['Authorization'] = `Bearer ${apiToken}`;
    }

    try {
      const response = await fetch(`${SMARKETS_API_URL}${endpoint}`, {
        ...options,
        headers: { ...headers, ...options?.headers },
      });

      if (!response.ok) {
        logger.error({ status: response.status, endpoint }, 'Smarkets API error');
        return null;
      }

      return await response.json() as T;
    } catch (err) {
      logger.error({ err, endpoint }, 'Smarkets API fetch error');
      return null;
    }
  }

  // Convert to our Market type
  function convertToMarket(
    market: SmarketsMarket,
    event: SmarketsEvent,
    contracts: SmarketsContract[],
    quotes?: SmarketsQuote[]
  ): Market {
    const quotesMap = new Map(quotes?.map((q) => [q.contract_id, q]));

    const outcomes: Outcome[] = contracts.map((c) => {
      const quote = quotesMap.get(c.id);
      // Smarkets prices are in percentage (0-100)
      const backPrice = quote?.bids?.[0]?.price || 0;
      const price = backPrice / 100;

      return {
        id: c.id,
        name: c.name,
        price,
        volume24h: quote?.volume || 0,
      };
    });

    return {
      id: market.id,
      platform: 'smarkets' as Platform,
      slug: market.slug,
      question: `${event.name} - ${market.name}`,
      description: market.description,
      outcomes,
      volume24h: outcomes.reduce((sum, o) => sum + o.volume24h, 0),
      liquidity: 0, // Would need separate calculation
      endDate: event.end_datetime ? new Date(event.end_datetime) : undefined,
      resolved: market.state === 'settled',
      tags: [event.type.domain, event.type.name].filter(Boolean),
      url: `https://smarkets.com/event/${event.id}/${market.slug}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // Connect WebSocket
  function connectStream() {
    if (!sessionToken) {
      logger.warn('Smarkets: No session token, streaming disabled');
      return;
    }

    ws = new WebSocket(SMARKETS_STREAM_URL);

    ws.on('open', () => {
      logger.info('Smarkets stream connected');

      // Authenticate
      ws!.send(JSON.stringify({
        type: 'authentication',
        session_token: sessionToken,
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'authenticated') {
          logger.info('Smarkets stream authenticated');
          emitter.emit('connected');

          // Resubscribe
          for (const marketId of subscribedMarkets) {
            subscribeMarketStream(marketId);
          }

          // Ping
          pingInterval = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }));
            }
          }, 30000);
        }

        if (msg.type === 'quote_updated') {
          handleQuoteUpdate(msg);
        }
      } catch (err) {
        logger.debug({ err }, 'Failed to parse Smarkets message');
      }
    });

    ws.on('close', () => {
      logger.warn('Smarkets stream disconnected');
      ws = null;

      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }

      setTimeout(connectStream, 5000);
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'Smarkets stream error');
    });
  }

  function subscribeMarketStream(marketId: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: 'subscribe',
      market_id: marketId,
    }));
  }

  function handleQuoteUpdate(msg: any) {
    const { market_id, contract_id, bids, offers, last_executed_price } = msg;

    // Record message for freshness tracking
    freshnessTracker.recordMessage('smarkets', market_id);

    const marketPrices = priceCache.get(market_id) || new Map();
    const prevPrice = marketPrices.get(contract_id);
    const newPrice = (bids?.[0]?.price || last_executed_price || 0) / 100;

    if (prevPrice !== newPrice) {
      marketPrices.set(contract_id, newPrice);
      priceCache.set(market_id, marketPrices);

      const update: PriceUpdate = {
        platform: 'smarkets' as Platform,
        marketId: market_id,
        outcomeId: contract_id,
        price: newPrice,
        previousPrice: prevPrice,
        timestamp: Date.now(),
      };

      emitter.emit('price', update);
    }
  }

  // Attach methods
  const feed: SmarketsFeed = Object.assign(emitter, {
    async start() {
      connectStream();
      logger.info('Smarkets feed started');
    },

    stop() {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }

      if (ws) {
        ws.close();
        ws = null;
      }

      logger.info('Smarkets feed stopped');
      emitter.emit('disconnected');
    },

    async searchMarkets(query: string, options: Record<string, unknown> = {}) {
      // Search events
      const eventsData = await apiRequest<{ events: SmarketsEvent[] }>(
        `/events/?search=${encodeURIComponent(query)}&state=live,upcoming&limit=50`
      );

      if (!eventsData?.events) return [];

      const results: Market[] = [];

      // Fetch markets for each event
      for (const event of eventsData.events.slice(0, 10)) {
        const marketsData = await apiRequest<{ markets: SmarketsMarket[] }>(
          `/events/${event.id}/markets/`
        );

        if (!marketsData?.markets) continue;

        for (const market of marketsData.markets) {
          // Cache
          marketCache.set(market.id, { market, event });

          // Fetch contracts
          const contractsData = await apiRequest<{ contracts: SmarketsContract[] }>(
            `/markets/${market.id}/contracts/`
          );

          const contracts = contractsData?.contracts || [];
          contractCache.set(market.id, contracts);

          // Fetch quotes
          const quotesData = await apiRequest<{ quotes: SmarketsQuote[] }>(
            `/markets/${market.id}/quotes/`
          );

          results.push(convertToMarket(market, event, contracts, quotesData?.quotes));
        }
      }

      return results;
    },

    async getMarket(marketId: string) {
      // Try cache first
      const cached = marketCache.get(marketId);

      if (cached) {
        const contracts = contractCache.get(marketId) || [];
        const quotesData = await apiRequest<{ quotes: SmarketsQuote[] }>(
          `/markets/${marketId}/quotes/`
        );
        return convertToMarket(cached.market, cached.event, contracts, quotesData?.quotes);
      }

      // Fetch market
      const marketData = await apiRequest<{ market: SmarketsMarket }>(`/markets/${marketId}/`);
      if (!marketData?.market) return null;

      // Fetch event
      const eventData = await apiRequest<{ event: SmarketsEvent }>(
        `/events/${marketData.market.event_id}/`
      );
      if (!eventData?.event) return null;

      // Cache
      marketCache.set(marketId, { market: marketData.market, event: eventData.event });

      // Fetch contracts
      const contractsData = await apiRequest<{ contracts: SmarketsContract[] }>(
        `/markets/${marketId}/contracts/`
      );
      const contracts = contractsData?.contracts || [];
      contractCache.set(marketId, contracts);

      // Fetch quotes
      const quotesData = await apiRequest<{ quotes: SmarketsQuote[] }>(
        `/markets/${marketId}/quotes/`
      );

      return convertToMarket(marketData.market, eventData.event, contracts, quotesData?.quotes);
    },

    async getQuotes(marketId: string) {
      const data = await apiRequest<{ quotes: SmarketsQuote[] }>(`/markets/${marketId}/quotes/`);
      return data?.quotes || [];
    },

    async getOrderbook(marketId: string, contractId: string) {
      const quotes = await feed.getQuotes(marketId);
      const quote = quotes.find((q) => q.contract_id === contractId);

      if (!quote) return null;

      const bids = (quote.bids || [])
        .map((b) => [b.price / 100, b.quantity / 100] as [number, number])
        .slice(0, 10);

      const offers = (quote.offers || [])
        .map((o) => [o.price / 100, o.quantity / 100] as [number, number])
        .slice(0, 10);

      const bestBid = bids[0]?.[0] || 0;
      const bestOffer = offers[0]?.[0] || 1;

      return {
        platform: 'smarkets' as Platform,
        marketId,
        outcomeId: contractId,
        bids,
        asks: offers,
        spread: bestOffer - bestBid,
        midPrice: (bestBid + bestOffer) / 2,
        timestamp: Date.now(),
      };
    },

    subscribeToMarket(marketId: string) {
      subscribedMarkets.add(marketId);
      subscribeMarketStream(marketId);

      // Start freshness tracking with polling fallback
      freshnessTracker.track('smarkets', marketId, async () => {
        const quotes = await feed.getQuotes(marketId);
        for (const quote of quotes) {
          const marketPrices = priceCache.get(marketId) || new Map();
          const prevPrice = marketPrices.get(quote.contract_id);
          const newPrice = (quote.bids?.[0]?.price || quote.last_executed_price || 0) / 100;
          if (prevPrice !== newPrice && newPrice > 0) {
            marketPrices.set(quote.contract_id, newPrice);
            priceCache.set(marketId, marketPrices);
            emitter.emit('price', {
              platform: 'smarkets' as Platform,
              marketId,
              outcomeId: quote.contract_id,
              price: newPrice,
              previousPrice: prevPrice,
              timestamp: Date.now(),
            });
          }
        }
      });
    },

    unsubscribeFromMarket(marketId: string) {
      subscribedMarkets.delete(marketId);
      priceCache.delete(marketId);
      freshnessTracker.untrack('smarkets', marketId);
    },

    async placeBuyOrder(marketId: string, contractId: string, price: number, quantity: number) {
      if (!sessionToken) {
        logger.error('Smarkets: Session token required for trading');
        return null;
      }

      const data = await apiRequest<{ order: SmarketsOrder }>('/orders/', {
        method: 'POST',
        body: JSON.stringify({
          market_id: marketId,
          contract_id: contractId,
          side: 'buy',
          price: Math.round(price * 100), // Convert to percentage
          quantity: Math.round(quantity * 100), // Convert to pence
        }),
      });

      if (data?.order) {
        logger.info({ orderId: data.order.id, marketId, contractId, price, quantity }, 'Smarkets buy order placed');
      }

      return data?.order || null;
    },

    async placeSellOrder(marketId: string, contractId: string, price: number, quantity: number) {
      if (!sessionToken) {
        logger.error('Smarkets: Session token required for trading');
        return null;
      }

      const data = await apiRequest<{ order: SmarketsOrder }>('/orders/', {
        method: 'POST',
        body: JSON.stringify({
          market_id: marketId,
          contract_id: contractId,
          side: 'sell',
          price: Math.round(price * 100),
          quantity: Math.round(quantity * 100),
        }),
      });

      if (data?.order) {
        logger.info({ orderId: data.order.id, marketId, contractId, price, quantity }, 'Smarkets sell order placed');
      }

      return data?.order || null;
    },

    async cancelOrder(orderId: string) {
      if (!sessionToken) return false;

      const response = await apiRequest<{}>(`/orders/${orderId}/`, {
        method: 'DELETE',
      });

      return response !== null;
    },

    async cancelAllOrders(marketId?: string) {
      if (!sessionToken) return 0;

      const endpoint = marketId ? `/orders/?market_id=${marketId}` : '/orders/';
      const data = await apiRequest<{ orders: SmarketsOrder[] }>(endpoint);

      if (!data?.orders) return 0;

      let cancelled = 0;
      for (const order of data.orders) {
        if (await feed.cancelOrder(order.id)) {
          cancelled++;
        }
      }

      return cancelled;
    },

    async getOpenOrders(marketId?: string) {
      if (!sessionToken) return [];

      const endpoint = marketId
        ? `/orders/?market_id=${marketId}&state=live`
        : '/orders/?state=live';

      const data = await apiRequest<{ orders: SmarketsOrder[] }>(endpoint);
      return data?.orders || [];
    },

    async getBalance() {
      if (!sessionToken) {
        return { available: 0, exposure: 0, total: 0 };
      }

      const data = await apiRequest<{
        available_balance: number;
        exposure: number;
        balance: number;
      }>('/members/account/');

      if (!data) {
        return { available: 0, exposure: 0, total: 0 };
      }

      return {
        available: (data.available_balance || 0) / 100,
        exposure: (data.exposure || 0) / 100,
        total: (data.balance || 0) / 100,
      };
    },

    isAuthenticated() {
      return !!sessionToken;
    },
  }) as SmarketsFeed;

  return feed;
}

// =============================================================================
// EVENT TYPE DOMAINS
// =============================================================================

export const SMARKETS_DOMAINS = {
  POLITICS: 'politics',
  SPORT: 'sport',
  ENTERTAINMENT: 'entertainment',
  CURRENT_AFFAIRS: 'current_affairs',
  ESPORTS: 'esports',
};
