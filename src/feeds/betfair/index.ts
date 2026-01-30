/**
 * Betfair Exchange Feed
 * Sports betting exchange with full trading API
 *
 * Features:
 * - Market data (prices, volumes, liquidity)
 * - Full trading (back/lay orders)
 * - Market streaming via WebSocket
 * - Portfolio/positions tracking
 *
 * Docs: https://docs.developer.betfair.com/
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Market, Outcome, PriceUpdate, Platform, Orderbook } from '../../types';
import { logger } from '../../utils/logger';
import { getGlobalFreshnessTracker, type FreshnessTracker } from '../freshness';

// =============================================================================
// CONSTANTS
// =============================================================================

const BETFAIR_API_URL = 'https://api.betfair.com/exchange';
const BETFAIR_IDENTITY_URL = 'https://identitysso.betfair.com/api';
const BETFAIR_STREAM_URL = 'wss://stream-api.betfair.com/api/v1';

// Market types we care about
const MARKET_TYPES = ['WIN', 'MATCH_ODDS', 'OVER_UNDER', 'CORRECT_SCORE'];

// =============================================================================
// TYPES
// =============================================================================

export interface BetfairConfig {
  appKey: string;
  username?: string;
  password?: string;
  /** Session token if already authenticated */
  sessionToken?: string;
  /** Cert-based auth files */
  certPath?: string;
  keyPath?: string;
}

export interface BetfairAuth {
  appKey: string;
  sessionToken: string;
}

interface BetfairRunner {
  selectionId: number;
  runnerName: string;
  handicap?: number;
  sortPriority: number;
  metadata?: Record<string, string>;
}

interface BetfairMarket {
  marketId: string;
  marketName: string;
  marketStartTime?: string;
  totalMatched?: number;
  competition?: { id: string; name: string };
  event?: { id: string; name: string; countryCode?: string };
  eventType?: { id: string; name: string };
  runners: BetfairRunner[];
  description?: {
    marketType: string;
    settleTime?: string;
    turnInPlayEnabled?: boolean;
    inPlayDelay?: number;
  };
}

interface BetfairPriceSize {
  price: number;
  size: number;
}

interface BetfairRunnerBook {
  selectionId: number;
  status: string;
  lastPriceTraded?: number;
  totalMatched?: number;
  ex?: {
    availableToBack: BetfairPriceSize[];
    availableToLay: BetfairPriceSize[];
    tradedVolume?: BetfairPriceSize[];
  };
}

interface BetfairMarketBook {
  marketId: string;
  isMarketDataDelayed?: boolean;
  status: string;
  betDelay?: number;
  bspReconciled?: boolean;
  complete?: boolean;
  inplay?: boolean;
  numberOfWinners?: number;
  numberOfRunners?: number;
  numberOfActiveRunners?: number;
  lastMatchTime?: string;
  totalMatched?: number;
  totalAvailable?: number;
  runners: BetfairRunnerBook[];
}

interface BetfairOrder {
  betId: string;
  marketId: string;
  selectionId: number;
  side: 'BACK' | 'LAY';
  status: string;
  priceSize: { price: number; size: number };
  bspLiability?: number;
  placedDate: string;
  avgPriceMatched?: number;
  sizeMatched?: number;
  sizeRemaining?: number;
  sizeLapsed?: number;
  sizeCancelled?: number;
  sizeVoided?: number;
}

interface BetfairPosition {
  marketId: string;
  selectionId: number;
  matchedPL?: number;
  unmatchedPL?: number;
}

export interface BetfairFeed extends EventEmitter {
  start(): Promise<void>;
  stop(): void;

  // Authentication
  login(): Promise<boolean>;
  logout(): Promise<void>;
  isAuthenticated(): boolean;

  // Market data
  searchMarkets(query: string, options?: { eventTypeIds?: string[]; marketTypes?: string[] }): Promise<Market[]>;
  getMarket(marketId: string): Promise<Market | null>;
  getMarketBook(marketId: string): Promise<BetfairMarketBook | null>;
  getOrderbook(marketId: string, selectionId: number): Promise<Orderbook | null>;

  // Subscriptions
  subscribeToMarket(marketId: string): void;
  unsubscribeFromMarket(marketId: string): void;

  // Trading
  placeBackOrder(marketId: string, selectionId: number, price: number, size: number): Promise<BetfairOrder | null>;
  placeLayOrder(marketId: string, selectionId: number, price: number, size: number): Promise<BetfairOrder | null>;
  cancelOrder(marketId: string, betId: string): Promise<boolean>;
  cancelAllOrders(marketId?: string): Promise<number>;
  getOpenOrders(marketId?: string): Promise<BetfairOrder[]>;

  // Portfolio
  getPositions(): Promise<BetfairPosition[]>;
  getAccountFunds(): Promise<{ available: number; exposure: number; balance: number }>;
}

// =============================================================================
// BETFAIR API CLIENT
// =============================================================================

async function betfairRequest<T>(
  auth: BetfairAuth,
  endpoint: string,
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  const url = `${BETFAIR_API_URL}/betting/rest/v1.0/${endpoint}/`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Application': auth.appKey,
      'X-Authentication': auth.sessionToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ filter: params }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Betfair API error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<T>;
}

async function betfairAccountRequest<T>(
  auth: BetfairAuth,
  endpoint: string
): Promise<T> {
  const url = `${BETFAIR_API_URL}/account/rest/v1.0/${endpoint}/`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Application': auth.appKey,
      'X-Authentication': auth.sessionToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Betfair Account API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// =============================================================================
// BETFAIR FEED IMPLEMENTATION
// =============================================================================

export async function createBetfairFeed(config: BetfairConfig): Promise<BetfairFeed> {
  const emitter = new EventEmitter();
  let auth: BetfairAuth | null = null;
  let ws: WebSocket | null = null;
  let streamConnectionId: number | null = null;
  const subscribedMarkets = new Set<string>();
  const marketCache = new Map<string, BetfairMarket>();
  const priceCache = new Map<string, Map<number, number>>(); // marketId -> selectionId -> price
  let pingInterval: NodeJS.Timeout | null = null;

  // Freshness tracking for WebSocket health monitoring
  const freshnessTracker: FreshnessTracker = getGlobalFreshnessTracker();

  // Convert Betfair market to our Market type
  function convertToMarket(m: BetfairMarket, book?: BetfairMarketBook): Market {
    const outcomes: Outcome[] = m.runners.map((r) => {
      const runnerBook = book?.runners.find((rb) => rb.selectionId === r.selectionId);
      const backPrice = runnerBook?.ex?.availableToBack?.[0]?.price || 0;
      const price = backPrice > 0 ? 1 / backPrice : 0; // Convert odds to probability

      return {
        id: r.selectionId.toString(),
        name: r.runnerName,
        price,
        volume24h: runnerBook?.totalMatched || 0,
      };
    });

    return {
      id: m.marketId,
      platform: 'betfair' as Platform,
      slug: m.marketId.replace(/\./g, '-'),
      question: `${m.event?.name || ''} - ${m.marketName}`.trim(),
      description: m.description?.marketType,
      outcomes,
      volume24h: m.totalMatched || 0,
      liquidity: book?.totalAvailable || 0,
      endDate: m.marketStartTime ? new Date(m.marketStartTime) : undefined,
      resolved: book?.status === 'CLOSED',
      tags: [
        m.eventType?.name || 'sports',
        m.competition?.name,
        m.event?.countryCode,
      ].filter(Boolean) as string[],
      url: `https://www.betfair.com/exchange/plus/market/${m.marketId}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // Connect to streaming API
  function connectStream() {
    if (!auth) return;

    ws = new WebSocket(BETFAIR_STREAM_URL);

    ws.on('open', () => {
      logger.info('Betfair stream connected');

      // Authenticate
      const authMsg = {
        op: 'authentication',
        appKey: auth!.appKey,
        session: auth!.sessionToken,
      };
      ws!.send(JSON.stringify(authMsg));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.op === 'connection') {
          streamConnectionId = msg.connectionId;
          logger.info({ connectionId: streamConnectionId }, 'Betfair stream authenticated');
          emitter.emit('connected');

          // Resubscribe to markets
          for (const marketId of subscribedMarkets) {
            subscribeMarketStream(marketId);
          }

          // Start ping
          pingInterval = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 'heartbeat' }));
            }
          }, 30000);
        }

        if (msg.op === 'mcm') {
          // Market change message
          handleMarketChange(msg);
        }

        if (msg.op === 'status' && msg.statusCode === 'FAILURE') {
          logger.error({ msg }, 'Betfair stream error');
        }
      } catch (err) {
        logger.debug({ err }, 'Failed to parse Betfair stream message');
      }
    });

    ws.on('close', () => {
      logger.warn('Betfair stream disconnected');
      ws = null;
      streamConnectionId = null;

      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }

      // Reconnect after delay
      setTimeout(connectStream, 5000);
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'Betfair stream error');
    });
  }

  function subscribeMarketStream(marketId: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const subMsg = {
      op: 'marketSubscription',
      id: Date.now(),
      marketFilter: { marketIds: [marketId] },
      marketDataFilter: {
        fields: ['EX_BEST_OFFERS_DISP', 'EX_TRADED', 'EX_TRADED_VOL', 'EX_LTP'],
      },
    };

    ws.send(JSON.stringify(subMsg));
    logger.debug({ marketId }, 'Subscribed to Betfair market');
  }

  function handleMarketChange(msg: any) {
    if (!msg.mc) return;

    for (const change of msg.mc) {
      const marketId = change.id;

      if (change.rc) {
        // Runner changes
        for (const rc of change.rc) {
          const selectionId = rc.id;
          const ltp = rc.ltp; // Last traded price

          if (ltp) {
            const marketPrices = priceCache.get(marketId) || new Map();
            const prevPrice = marketPrices.get(selectionId);

            // Record message for freshness tracking
            freshnessTracker.recordMessage('betfair', marketId);

            if (prevPrice !== ltp) {
              marketPrices.set(selectionId, ltp);
              priceCache.set(marketId, marketPrices);

              const probability = 1 / ltp;

              const update: PriceUpdate = {
                platform: 'betfair' as Platform,
                marketId,
                outcomeId: selectionId.toString(),
                price: probability,
                previousPrice: prevPrice ? 1 / prevPrice : undefined,
                timestamp: Date.now(),
              };

              emitter.emit('price', update);
            }
          }
        }
      }
    }
  }

  // Attach methods
  const feed: BetfairFeed = Object.assign(emitter, {
    async start() {
      if (config.sessionToken) {
        auth = { appKey: config.appKey, sessionToken: config.sessionToken };
        connectStream();
      } else if (config.username && config.password) {
        await feed.login();
        connectStream();
      } else {
        throw new Error('Betfair: Either sessionToken or username/password required');
      }

      logger.info('Betfair feed started');
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

      auth = null;
      logger.info('Betfair feed stopped');
      emitter.emit('disconnected');
    },

    async login() {
      if (!config.username || !config.password) {
        throw new Error('Betfair: username and password required for login');
      }

      const url = `${BETFAIR_IDENTITY_URL}/login`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Application': config.appKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          username: config.username,
          password: config.password,
        }),
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'Betfair login failed');
        return false;
      }

      const data = await response.json() as { token?: string; status: string };

      if (data.status === 'SUCCESS' && data.token) {
        auth = { appKey: config.appKey, sessionToken: data.token };
        logger.info('Betfair login successful');
        return true;
      }

      logger.error({ status: data.status }, 'Betfair login failed');
      return false;
    },

    async logout() {
      if (!auth) return;

      try {
        await fetch(`${BETFAIR_IDENTITY_URL}/logout`, {
          method: 'POST',
          headers: {
            'X-Application': auth.appKey,
            'X-Authentication': auth.sessionToken,
          },
        });
      } catch {
        // Ignore logout errors
      }

      auth = null;
    },

    isAuthenticated() {
      return auth !== null;
    },

    async searchMarkets(query: string, options: { marketTypes?: string[]; eventTypeIds?: string[] } = {}) {
      if (!auth) return [];

      try {
        const filter: Record<string, unknown> = {
          textQuery: query,
          marketTypeCodes: options.marketTypes || MARKET_TYPES,
        };

        if (options.eventTypeIds) {
          filter.eventTypeIds = options.eventTypeIds;
        }

        const markets = await betfairRequest<BetfairMarket[]>(
          auth,
          'listMarketCatalogue',
          'POST',
          {
            ...filter,
            maxResults: 100,
            marketProjection: ['COMPETITION', 'EVENT', 'EVENT_TYPE', 'RUNNER_DESCRIPTION', 'MARKET_DESCRIPTION'],
          }
        );

        // Cache markets
        for (const m of markets) {
          marketCache.set(m.marketId, m);
        }

        // Get price data for top markets
        const topMarketIds = markets.slice(0, 20).map((m) => m.marketId);
        const books = await betfairRequest<BetfairMarketBook[]>(
          auth,
          'listMarketBook',
          'POST',
          {
            marketIds: topMarketIds,
            priceProjection: { priceData: ['EX_BEST_OFFERS'] },
          }
        );

        const bookMap = new Map(books.map((b) => [b.marketId, b]));

        return markets.map((m) => convertToMarket(m, bookMap.get(m.marketId)));
      } catch (err) {
        logger.error({ err }, 'Betfair search error');
        return [];
      }
    },

    async getMarket(marketId: string) {
      if (!auth) return null;

      try {
        const markets = await betfairRequest<BetfairMarket[]>(
          auth,
          'listMarketCatalogue',
          'POST',
          {
            marketIds: [marketId],
            marketProjection: ['COMPETITION', 'EVENT', 'EVENT_TYPE', 'RUNNER_DESCRIPTION', 'MARKET_DESCRIPTION'],
          }
        );

        if (markets.length === 0) return null;

        const market = markets[0];
        marketCache.set(marketId, market);

        const book = await feed.getMarketBook(marketId);
        return convertToMarket(market, book || undefined);
      } catch (err) {
        logger.error({ err, marketId }, 'Betfair getMarket error');
        return null;
      }
    },

    async getMarketBook(marketId: string) {
      if (!auth) return null;

      try {
        const books = await betfairRequest<BetfairMarketBook[]>(
          auth,
          'listMarketBook',
          'POST',
          {
            marketIds: [marketId],
            priceProjection: {
              priceData: ['EX_BEST_OFFERS', 'EX_TRADED'],
              virtualise: true,
            },
          }
        );

        return books[0] || null;
      } catch (err) {
        logger.error({ err, marketId }, 'Betfair getMarketBook error');
        return null;
      }
    },

    async getOrderbook(marketId: string, selectionId: number) {
      if (!auth) return null;

      try {
        const book = await feed.getMarketBook(marketId);
        if (!book) return null;

        const runner = book.runners.find((r) => r.selectionId === selectionId);
        if (!runner?.ex) return null;

        const bids = (runner.ex.availableToBack || [])
          .map((p) => [1 / p.price, p.size] as [number, number])
          .slice(0, 10);

        const asks = (runner.ex.availableToLay || [])
          .map((p) => [1 / p.price, p.size] as [number, number])
          .slice(0, 10);

        const bestBid = bids[0]?.[0] || 0;
        const bestAsk = asks[0]?.[0] || 1;

        return {
          platform: 'betfair' as Platform,
          marketId,
          outcomeId: selectionId.toString(),
          bids,
          asks,
          spread: bestAsk - bestBid,
          midPrice: (bestBid + bestAsk) / 2,
          timestamp: Date.now(),
        };
      } catch (err) {
        logger.error({ err, marketId, selectionId }, 'Betfair getOrderbook error');
        return null;
      }
    },

    subscribeToMarket(marketId: string) {
      subscribedMarkets.add(marketId);
      subscribeMarketStream(marketId);

      // Start freshness tracking with polling fallback
      freshnessTracker.track('betfair', marketId, async () => {
        const book = await feed.getMarketBook(marketId);
        if (book?.runners) {
          for (const runner of book.runners) {
            const ltp = runner.lastPriceTraded;
            if (ltp) {
              const marketPrices = priceCache.get(marketId) || new Map();
              const prevPrice = marketPrices.get(runner.selectionId);
              if (prevPrice !== ltp) {
                marketPrices.set(runner.selectionId, ltp);
                priceCache.set(marketId, marketPrices);
                emitter.emit('price', {
                  platform: 'betfair' as Platform,
                  marketId,
                  outcomeId: runner.selectionId.toString(),
                  price: 1 / ltp,
                  previousPrice: prevPrice ? 1 / prevPrice : undefined,
                  timestamp: Date.now(),
                });
              }
            }
          }
        }
      });
    },

    unsubscribeFromMarket(marketId: string) {
      subscribedMarkets.delete(marketId);
      priceCache.delete(marketId);
      freshnessTracker.untrack('betfair', marketId);
    },

    async placeBackOrder(marketId: string, selectionId: number, price: number, size: number) {
      if (!auth) return null;

      try {
        const result = await betfairRequest<{ instructionReports: Array<{ betId: string; status: string; instruction: any }> }>(
          auth,
          'placeOrders',
          'POST',
          {
            marketId,
            instructions: [{
              selectionId,
              handicap: 0,
              side: 'BACK',
              orderType: 'LIMIT',
              limitOrder: {
                size,
                price, // Betfair odds (not probability)
                persistenceType: 'LAPSE',
              },
            }],
          }
        );

        const report = result.instructionReports?.[0];
        if (!report || report.status !== 'SUCCESS') {
          logger.error({ result }, 'Betfair back order failed');
          return null;
        }

        logger.info({ marketId, selectionId, price, size, betId: report.betId }, 'Betfair back order placed');

        return {
          betId: report.betId,
          marketId,
          selectionId,
          side: 'BACK' as const,
          status: 'EXECUTABLE',
          priceSize: { price, size },
          placedDate: new Date().toISOString(),
        };
      } catch (err) {
        logger.error({ err }, 'Betfair placeBackOrder error');
        return null;
      }
    },

    async placeLayOrder(marketId: string, selectionId: number, price: number, size: number) {
      if (!auth) return null;

      try {
        const result = await betfairRequest<{ instructionReports: Array<{ betId: string; status: string }> }>(
          auth,
          'placeOrders',
          'POST',
          {
            marketId,
            instructions: [{
              selectionId,
              handicap: 0,
              side: 'LAY',
              orderType: 'LIMIT',
              limitOrder: {
                size,
                price,
                persistenceType: 'LAPSE',
              },
            }],
          }
        );

        const report = result.instructionReports?.[0];
        if (!report || report.status !== 'SUCCESS') {
          logger.error({ result }, 'Betfair lay order failed');
          return null;
        }

        logger.info({ marketId, selectionId, price, size, betId: report.betId }, 'Betfair lay order placed');

        return {
          betId: report.betId,
          marketId,
          selectionId,
          side: 'LAY' as const,
          status: 'EXECUTABLE',
          priceSize: { price, size },
          placedDate: new Date().toISOString(),
        };
      } catch (err) {
        logger.error({ err }, 'Betfair placeLayOrder error');
        return null;
      }
    },

    async cancelOrder(marketId: string, betId: string) {
      if (!auth) return false;

      try {
        const result = await betfairRequest<{ instructionReports: Array<{ status: string }> }>(
          auth,
          'cancelOrders',
          'POST',
          {
            marketId,
            instructions: [{ betId }],
          }
        );

        return result.instructionReports?.[0]?.status === 'SUCCESS';
      } catch (err) {
        logger.error({ err }, 'Betfair cancelOrder error');
        return false;
      }
    },

    async cancelAllOrders(marketId?: string) {
      if (!auth) return 0;

      try {
        const result = await betfairRequest<{ instructionReports: Array<{ status: string }> }>(
          auth,
          'cancelOrders',
          'POST',
          marketId ? { marketId } : {}
        );

        const cancelled = result.instructionReports?.filter((r) => r.status === 'SUCCESS').length || 0;
        logger.info({ marketId, cancelled }, 'Betfair orders cancelled');
        return cancelled;
      } catch (err) {
        logger.error({ err }, 'Betfair cancelAllOrders error');
        return 0;
      }
    },

    async getOpenOrders(marketId?: string) {
      if (!auth) return [];

      try {
        const result = await betfairRequest<{ currentOrders: BetfairOrder[] }>(
          auth,
          'listCurrentOrders',
          'POST',
          {
            orderProjection: 'EXECUTABLE',
            ...(marketId ? { marketIds: [marketId] } : {}),
          }
        );

        return result.currentOrders || [];
      } catch (err) {
        logger.error({ err }, 'Betfair getOpenOrders error');
        return [];
      }
    },

    async getPositions() {
      if (!auth) return [];

      try {
        // Betfair doesn't have a direct positions endpoint
        // We need to calculate from cleared orders or current orders
        const result = await betfairRequest<{ currentOrders: BetfairOrder[] }>(
          auth,
          'listCurrentOrders',
          'POST',
          { orderProjection: 'ALL' }
        );

        // Group by market and selection
        const positions = new Map<string, BetfairPosition>();

        for (const order of result.currentOrders || []) {
          if (order.sizeMatched && order.sizeMatched > 0) {
            const key = `${order.marketId}_${order.selectionId}`;
            const existing = positions.get(key) || {
              marketId: order.marketId,
              selectionId: order.selectionId,
              matchedPL: 0,
              unmatchedPL: 0,
            };

            // Simplified P&L (would need more logic for accurate calculation)
            const pl = order.side === 'BACK'
              ? (order.avgPriceMatched || 0) * (order.sizeMatched || 0)
              : -(order.avgPriceMatched || 0) * (order.sizeMatched || 0);

            existing.matchedPL = (existing.matchedPL || 0) + pl;
            positions.set(key, existing);
          }
        }

        return Array.from(positions.values());
      } catch (err) {
        logger.error({ err }, 'Betfair getPositions error');
        return [];
      }
    },

    async getAccountFunds() {
      if (!auth) return { available: 0, exposure: 0, balance: 0 };

      try {
        const result = await betfairAccountRequest<{
          availableToBetBalance: number;
          exposure: number;
          balance: number;
        }>(auth, 'getAccountFunds');

        return {
          available: result.availableToBetBalance || 0,
          exposure: result.exposure || 0,
          balance: result.balance || 0,
        };
      } catch (err) {
        logger.error({ err }, 'Betfair getAccountFunds error');
        return { available: 0, exposure: 0, balance: 0 };
      }
    },
  }) as BetfairFeed;

  return feed;
}

// =============================================================================
// EVENT TYPE IDS (for filtering)
// =============================================================================

export const BETFAIR_EVENT_TYPES = {
  SOCCER: '1',
  TENNIS: '2',
  GOLF: '3',
  CRICKET: '4',
  RUGBY_UNION: '5',
  BOXING: '6',
  HORSE_RACING: '7',
  MOTOR_SPORT: '8',
  CYCLING: '11',
  BASKETBALL: '7522',
  AMERICAN_FOOTBALL: '6423',
  BASEBALL: '7511',
  ICE_HOCKEY: '7524',
  POLITICS: '2378961',
  ESPORTS: '27454571',
  SNOOKER: '6422',
  DARTS: '3503',
};
