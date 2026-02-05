/**
 * Polymarket Whale Tracker
 *
 * Monitors large trades and positions on Polymarket to identify whale activity.
 * Uses a combination of:
 * - CLOB WebSocket for real-time order flow
 * - REST API for position snapshots
 * - Subgraph for historical analysis
 *
 * Use cases:
 * - Copy trading whale positions
 * - Early signal detection for market moves
 * - Liquidity analysis
 */

import { EventEmitter } from 'eventemitter3';
import WebSocket from 'ws';
import { logger } from '../../utils/logger';

// =============================================================================
// RETRY HELPER
// =============================================================================

interface RetryConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  config: RetryConfig = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    timeoutMs = 30000,
  } = config;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Add timeout using AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Retry on 5xx errors or rate limits (429)
      if (response.status >= 500 || response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);

        if (attempt < maxRetries) {
          logger.debug({ url, status: response.status, waitMs, attempt }, 'Retrying request');
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }
      }

      return response;
    } catch (error) {
      lastError = error as Error;

      // Don't retry on abort (timeout)
      if ((error as Error).name === 'AbortError') {
        logger.warn({ url, timeoutMs }, 'Request timed out');
        if (attempt < maxRetries) {
          const waitMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }
        throw new Error(`Request timed out after ${maxRetries + 1} attempts: ${url}`);
      }

      // Retry on network errors
      if (attempt < maxRetries) {
        const waitMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
        logger.debug({ url, error: (error as Error).message, waitMs, attempt }, 'Retrying after error');
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
    }
  }

  throw lastError || new Error(`Failed to fetch after ${maxRetries + 1} attempts: ${url}`);
}

// =============================================================================
// TYPES
// =============================================================================

export interface WhaleConfig {
  /** Minimum trade size in $ to be considered a whale (default: 10000) */
  minTradeSize?: number;
  /** Minimum position size in $ to track (default: 50000) */
  minPositionSize?: number;
  /** Market IDs to track (default: all active markets) */
  marketIds?: string[];
  /** Poll interval for position snapshots in ms (default: 60000) */
  pollIntervalMs?: number;
  /** Enable real-time WebSocket tracking (default: true) */
  enableRealtime?: boolean;
}

export type MarketCategory = 'politics' | 'crypto' | 'sports' | 'entertainment' | 'science' | 'economics' | 'other';

export interface WhaleTrade {
  id: string;
  timestamp: Date;
  marketId: string;
  marketQuestion?: string;
  tokenId: string;
  outcome: 'Yes' | 'No';
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  usdValue: number;
  maker: string;
  taker: string;
  transactionHash?: string;
  /** Market category for performance tracking */
  category?: MarketCategory;
}

export interface WhalePosition {
  id: string;
  address: string;
  marketId: string;
  marketQuestion?: string;
  tokenId: string;
  outcome: 'Yes' | 'No';
  size: number;
  avgEntryPrice: number;
  usdValue: number;
  unrealizedPnl?: number;
  lastUpdated: Date;
}

/** Performance stats for a specific category */
export interface CategoryPerformance {
  category: MarketCategory;
  wins: number;
  losses: number;
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  avgReturn: number;
}

export interface WhaleProfile {
  address: string;
  totalValue: number;
  winRate: number;
  avgReturn: number;
  positions: WhalePosition[];
  recentTrades: WhaleTrade[];
  firstSeen: Date;
  lastActive: Date;
  /** Performance breakdown by market category */
  categoryPerformance?: Map<MarketCategory, CategoryPerformance>;
}

export interface CopyTradeSignal {
  /** Whale address initiating the trade */
  whaleAddress: string;
  /** Whale profile info */
  whaleProfile: WhaleProfile;
  /** The trade to copy */
  trade: WhaleTrade;
  /** Suggested position size (percentage of whale's position) */
  suggestedSizePct: number;
  /** Signal strength (0-1 based on whale's track record) */
  signalStrength: number;
  /** Recommended action */
  action: 'buy' | 'sell' | 'skip';
  /** Reason for recommendation */
  reason: string;
}

export interface WhaleTrackerEvents {
  trade: (trade: WhaleTrade) => void;
  positionOpened: (position: WhalePosition) => void;
  positionClosed: (position: WhalePosition, pnl: number) => void;
  positionChanged: (position: WhalePosition, change: number) => void;
  newWhale: (profile: WhaleProfile) => void;
  /** Copy trading signal when a profitable whale makes a move */
  copySignal: (signal: CopyTradeSignal) => void;
  /** WebSocket connection state change */
  connectionState: (state: 'connected' | 'disconnected' | 'reconnecting') => void;
  error: (error: Error) => void;
}

export interface WhaleTracker extends EventEmitter<keyof WhaleTrackerEvents> {
  start(): Promise<void>;
  stop(): void;
  isRunning(): boolean;
  getKnownWhales(): WhaleProfile[];
  getWhaleProfile(address: string): WhaleProfile | undefined;
  getTopWhales(limit?: number): WhaleProfile[];
  getRecentTrades(limit?: number): WhaleTrade[];
  getActivePositions(marketId?: string): WhalePosition[];
  trackAddress(address: string): void;
  untrackAddress(address: string): void;
  /** Get WebSocket connection state */
  getConnectionState(): 'connected' | 'disconnected' | 'reconnecting';
  /** Get profitable whales suitable for copy trading */
  getProfitableWhales(minWinRate?: number, minTrades?: number): WhaleProfile[];
  /** Record a position closure for win rate tracking */
  recordClosedPosition(address: string, pnl: number): void;
  /** Calculate signal strength for a whale */
  calculateSignalStrength(profile: WhaleProfile): number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const CLOB_REST_URL = 'https://clob.polymarket.com';
const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

const DEFAULT_CONFIG: Required<WhaleConfig> = {
  minTradeSize: 10000,
  minPositionSize: 50000,
  marketIds: [],
  pollIntervalMs: 60000,
  enableRealtime: true,
};

// =============================================================================
// CATEGORY DETECTION
// =============================================================================

const CATEGORY_KEYWORDS: Record<MarketCategory, string[]> = {
  politics: ['trump', 'biden', 'election', 'president', 'congress', 'senate', 'republican', 'democrat', 'vote', 'poll', 'governor', 'mayor', 'political', 'party', 'cabinet', 'impeach'],
  crypto: ['bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'crypto', 'token', 'coin', 'blockchain', 'defi', 'nft', 'altcoin', 'memecoin', 'doge', 'xrp'],
  sports: ['nfl', 'nba', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'baseball', 'hockey', 'tennis', 'golf', 'ufc', 'boxing', 'championship', 'super bowl', 'world cup', 'playoffs', 'finals'],
  entertainment: ['movie', 'film', 'oscar', 'grammy', 'emmy', 'celebrity', 'actor', 'actress', 'album', 'music', 'netflix', 'disney', 'tv show', 'streaming'],
  science: ['nasa', 'spacex', 'climate', 'weather', 'hurricane', 'earthquake', 'pandemic', 'vaccine', 'fda', 'research', 'study', 'discovery', 'ai', 'artificial intelligence'],
  economics: ['fed', 'interest rate', 'inflation', 'gdp', 'unemployment', 'recession', 'stock', 'market', 'dow', 's&p', 'nasdaq', 'earnings', 'ipo', 'merger'],
  other: [],
};

/**
 * Detect market category from question text
 */
export function detectMarketCategory(question: string): MarketCategory {
  const lowerQuestion = question.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [MarketCategory, string[]][]) {
    if (category === 'other') continue;
    for (const keyword of keywords) {
      if (lowerQuestion.includes(keyword)) {
        return category;
      }
    }
  }

  return 'other';
}

// Known whale addresses (can be extended)
const KNOWN_WHALES = new Set<string>([
  // Add known whale addresses here
]);

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createWhaleTracker(config: WhaleConfig = {}): WhaleTracker {
  const emitter = new EventEmitter() as WhaleTracker;
  const cfg = { ...DEFAULT_CONFIG, ...config };

  let running = false;
  let ws: WebSocket | null = null;
  let pollInterval: NodeJS.Timeout | null = null;
  let reconnectTimeout: NodeJS.Timeout | null = null;
  let pingInterval: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  let connectionState: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';

  // State
  const whaleProfiles = new Map<string, WhaleProfile>();
  const activePositions = new Map<string, WhalePosition>();
  const recentTrades: WhaleTrade[] = [];
  const trackedAddresses = new Set<string>(KNOWN_WHALES);
  const closedPositionsByWhale = new Map<string, { wins: number; losses: number; totalPnl: number }>();

  // ==========================================================================
  // REST API HELPERS
  // ==========================================================================

  async function fetchMarketTrades(marketId: string, maxPages = 5): Promise<WhaleTrade[]> {
    const allTrades: WhaleTrade[] = [];
    let nextCursor: string | undefined;

    try {
      for (let page = 0; page < maxPages; page++) {
        const url = nextCursor
          ? `${CLOB_REST_URL}/trades?market=${marketId}&limit=100&cursor=${nextCursor}`
          : `${CLOB_REST_URL}/trades?market=${marketId}&limit=100`;

        const response = await fetchWithRetry(url, {}, { maxRetries: 3, baseDelayMs: 1000, timeoutMs: 15000 });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const json = await response.json() as { data?: any[]; next_cursor?: string } | any[];

        // Handle both array response and paginated response
        const data = Array.isArray(json) ? json : (json.data || []);
        nextCursor = Array.isArray(json) ? undefined : json.next_cursor;

        const trades = data
          .filter((t: any) => {
            const usdValue = parseFloat(t.price) * parseFloat(t.size);
            return usdValue >= cfg.minTradeSize;
          })
          .map((t: any) => ({
            id: t.id || `${t.market}_${t.timestamp}`,
            timestamp: new Date(t.timestamp || t.match_time),
            marketId: t.market || marketId,
            tokenId: t.asset_id,
            outcome: t.outcome || (t.side === 'BUY' ? 'Yes' : 'No'),
            side: t.side?.toUpperCase() || 'BUY',
            price: parseFloat(t.price),
            size: parseFloat(t.size),
            usdValue: parseFloat(t.price) * parseFloat(t.size),
            maker: t.maker_address || t.maker,
            taker: t.taker_address || t.taker,
            transactionHash: t.transaction_hash,
          }));

        allTrades.push(...trades);

        // Stop if no more pages
        if (!nextCursor || data.length < 100) break;
      }

      return allTrades;
    } catch (error) {
      logger.error({ marketId, error }, 'Failed to fetch market trades after retries');
      return allTrades; // Return what we got so far
    }
  }

  async function fetchAddressPositions(address: string, maxPages = 3): Promise<WhalePosition[]> {
    const allPositions: WhalePosition[] = [];
    let offset = 0;
    const limit = 100;

    try {
      for (let page = 0; page < maxPages; page++) {
        const response = await fetchWithRetry(
          `${GAMMA_API_URL}/positions?address=${address}&limit=${limit}&offset=${offset}`,
          {},
          { maxRetries: 3, baseDelayMs: 1000, timeoutMs: 15000 }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json() as any[];
        const positions = data
          .filter((p: any) => {
            const usdValue = parseFloat(p.currentValue || p.size * p.price || 0);
            return usdValue >= cfg.minPositionSize;
          })
          .map((p: any) => ({
            id: `${address}_${p.market}_${p.outcome}`,
            address,
            marketId: p.market || p.conditionId,
            marketQuestion: p.title || p.question,
            tokenId: p.asset_id || p.tokenId,
            outcome: p.outcome || 'Yes',
            size: parseFloat(p.size || p.amount || 0),
            avgEntryPrice: parseFloat(p.avgPrice || p.averageBuyPrice || 0),
            usdValue: parseFloat(p.currentValue || p.size * p.price || 0),
            unrealizedPnl: parseFloat(p.pnl || p.unrealizedPnl || 0),
            lastUpdated: new Date(p.updatedAt || Date.now()),
          }));

        allPositions.push(...positions);

        // Stop if no more data
        if (data.length < limit) break;
        offset += limit;
      }

      return allPositions;
    } catch (error) {
      logger.error({ address, error }, 'Failed to fetch positions after retries');
      return allPositions; // Return what we got so far
    }
  }

  async function fetchTopTraders(): Promise<string[]> {
    try {
      const response = await fetchWithRetry(
        `${GAMMA_API_URL}/leaderboard?limit=100&sortBy=volume`,
        {},
        { maxRetries: 2, baseDelayMs: 1000, timeoutMs: 10000 }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as any[];
      return data.map((t) => t.address || t.user);
    } catch (error) {
      logger.error({ error }, 'Failed to fetch top traders');
      return [];
    }
  }

  // ==========================================================================
  // WEBSOCKET HANDLING
  // ==========================================================================

  function connectWebSocket(): void {
    if (ws) {
      ws.close();
    }

    connectionState = 'reconnecting';
    emitter.emit('connectionState', connectionState);

    ws = new WebSocket(CLOB_WS_URL);

    ws.on('open', () => {
      logger.info('Whale tracker WebSocket connected');
      connectionState = 'connected';
      reconnectAttempts = 0;
      emitter.emit('connectionState', connectionState);

      // Subscribe to trade events for tracked markets
      const markets = cfg.marketIds.length > 0 ? cfg.marketIds : ['*'];
      for (const marketId of markets) {
        ws?.send(JSON.stringify({
          type: 'subscribe',
          channel: 'trades',
          market: marketId,
        }));
      }

      // Start JSON heartbeat ping (Polymarket requires JSON ping every 10s)
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 10000); // Ping every 10 seconds per Polymarket docs
    });

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        // Handle pong response (JSON pong, not WebSocket pong)
        if (message.type === 'pong') {
          logger.debug('WebSocket JSON pong received');
          return;
        }

        if (message.type === 'trade' || message.event_type === 'trade') {
          handleTradeMessage(message);
        }
      } catch (error) {
        logger.error({ error, data: data.toString().slice(0, 200) }, 'Failed to parse WS message');
      }
    });

    ws.on('close', (code, reason) => {
      logger.info({ code, reason: reason.toString() }, 'Whale tracker WebSocket disconnected');
      connectionState = 'disconnected';
      emitter.emit('connectionState', connectionState);

      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }

      if (running) {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 60s
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 60000);
        reconnectAttempts++;

        logger.info({ delay, attempt: reconnectAttempts }, 'Scheduling WebSocket reconnect');
        reconnectTimeout = setTimeout(() => {
          logger.info('Reconnecting whale tracker WebSocket');
          connectWebSocket();
        }, delay);
      }
    });

    ws.on('error', (error) => {
      logger.error({ error }, 'Whale tracker WebSocket error');
      emitter.emit('error', error);
    });
  }

  function handleTradeMessage(message: any): void {
    const price = parseFloat(message.price || 0);
    const size = parseFloat(message.size || message.amount || 0);
    const usdValue = price * size;

    // Filter by minimum size
    if (usdValue < cfg.minTradeSize) {
      return;
    }

    const trade: WhaleTrade = {
      id: message.id || `${message.market}_${Date.now()}`,
      timestamp: new Date(message.timestamp || message.match_time || Date.now()),
      marketId: message.market || message.condition_id,
      marketQuestion: message.question || message.title,
      tokenId: message.asset_id || message.token_id,
      outcome: message.outcome || (message.side === 'BUY' ? 'Yes' : 'No'),
      side: (message.side || 'BUY').toUpperCase(),
      price,
      size,
      usdValue,
      maker: message.maker_address || message.maker || 'unknown',
      taker: message.taker_address || message.taker || 'unknown',
      transactionHash: message.transaction_hash,
    };

    // Track the trade
    recentTrades.unshift(trade);
    if (recentTrades.length > 1000) {
      recentTrades.pop();
    }

    // Check if it's from a tracked whale
    const isKnownWhale = trackedAddresses.has(trade.maker) || trackedAddresses.has(trade.taker);

    logger.info(
      {
        marketId: trade.marketId,
        side: trade.side,
        size: trade.size,
        usdValue: trade.usdValue,
        isKnownWhale,
      },
      'Whale trade detected'
    );

    emitter.emit('trade', trade);

    // Add unknown whales to tracking
    if (!trackedAddresses.has(trade.maker) && trade.usdValue >= cfg.minTradeSize * 5) {
      trackedAddresses.add(trade.maker);
      logger.info({ address: trade.maker }, 'New whale discovered');
    }
    if (!trackedAddresses.has(trade.taker) && trade.usdValue >= cfg.minTradeSize * 5) {
      trackedAddresses.add(trade.taker);
      logger.info({ address: trade.taker }, 'New whale discovered');
    }

    // Emit copy trading signal if from a profitable whale
    emitCopySignalIfProfitable(trade);
  }

  function emitCopySignalIfProfitable(trade: WhaleTrade): void {
    // Check both maker and taker
    const addresses = [trade.maker, trade.taker].filter((a) => a && a !== 'unknown');

    for (const address of addresses) {
      const profile = whaleProfiles.get(address);
      if (!profile) continue;

      // Only emit signals for whales with good track records
      const signalStrength = calculateSignalStrengthInternal(profile);
      if (signalStrength < 0.5) continue; // Need at least 50% signal strength

      const stats = closedPositionsByWhale.get(address);
      const totalTrades = stats ? stats.wins + stats.losses : 0;
      if (totalTrades < 5) continue; // Need at least 5 trades for reliability

      const winRate = stats ? stats.wins / totalTrades : 0;
      if (winRate < 0.55) continue; // Need at least 55% win rate

      // Determine if this is a buy or sell for copy trading
      const isBuyer = trade.taker === address && trade.side === 'BUY';
      const isSeller = trade.taker === address && trade.side === 'SELL';

      if (!isBuyer && !isSeller) continue; // Taker is the one initiating

      const signal: CopyTradeSignal = {
        whaleAddress: address,
        whaleProfile: profile,
        trade,
        suggestedSizePct: Math.min(50, signalStrength * 100), // Cap at 50% of whale's size
        signalStrength,
        action: isBuyer ? 'buy' : 'sell',
        reason: `Whale ${address.slice(0, 8)}... (${(winRate * 100).toFixed(0)}% WR, ${totalTrades} trades) ${isBuyer ? 'bought' : 'sold'} $${trade.usdValue.toFixed(0)}`,
      };

      logger.info(
        {
          whale: address.slice(0, 8),
          action: signal.action,
          size: trade.usdValue,
          winRate: winRate * 100,
          signalStrength,
        },
        'Copy trading signal'
      );

      emitter.emit('copySignal', signal);
    }
  }

  function calculateSignalStrengthInternal(profile: WhaleProfile): number {
    const stats = closedPositionsByWhale.get(profile.address);
    if (!stats) return 0;

    const totalTrades = stats.wins + stats.losses;
    if (totalTrades < 3) return 0;

    const winRate = stats.wins / totalTrades;
    const avgPnl = stats.totalPnl / totalTrades;

    // Signal strength based on:
    // - Win rate (40% weight)
    // - Number of trades / confidence (30% weight)
    // - Average PnL (30% weight)

    const winRateScore = Math.max(0, (winRate - 0.5) * 2); // 0 at 50%, 1 at 100%
    const tradeCountScore = Math.min(1, totalTrades / 20); // 1 at 20+ trades
    const pnlScore = avgPnl > 0 ? Math.min(1, avgPnl / 1000) : 0; // 1 at $1000 avg PnL

    return winRateScore * 0.4 + tradeCountScore * 0.3 + pnlScore * 0.3;
  }

  // ==========================================================================
  // POLLING
  // ==========================================================================

  async function pollPositions(): Promise<void> {
    logger.debug({ whaleCount: trackedAddresses.size }, 'Polling whale positions');

    for (const address of trackedAddresses) {
      try {
        const positions = await fetchAddressPositions(address);

        for (const position of positions) {
          const key = position.id;
          const existing = activePositions.get(key);

          if (!existing) {
            // New position
            activePositions.set(key, position);
            emitter.emit('positionOpened', position);
          } else if (Math.abs(position.size - existing.size) > 0.01) {
            // Position changed
            const change = position.size - existing.size;
            activePositions.set(key, position);

            if (position.size === 0) {
              const pnl = position.unrealizedPnl || 0;
              activePositions.delete(key);
              // Record for win rate tracking
              const recordFn = (emitter as WhaleTracker).recordClosedPosition;
              if (recordFn) {
                recordFn(address, pnl);
              }
              emitter.emit('positionClosed', position, pnl);
            } else {
              emitter.emit('positionChanged', position, change);
            }
          }
        }

        // Update profile
        updateWhaleProfile(address, positions);
      } catch (error) {
        logger.error({ address, error }, 'Failed to poll positions');
      }
    }
  }

  function updateWhaleProfile(address: string, positions: WhalePosition[]): void {
    const existing = whaleProfiles.get(address);
    const totalValue = positions.reduce((sum, p) => sum + p.usdValue, 0);

    const profile: WhaleProfile = {
      address,
      totalValue,
      winRate: existing?.winRate || 0,
      avgReturn: existing?.avgReturn || 0,
      positions,
      recentTrades: recentTrades.filter(
        (t) => t.maker === address || t.taker === address
      ).slice(0, 50),
      firstSeen: existing?.firstSeen || new Date(),
      lastActive: new Date(),
    };

    const isNew = !existing;
    whaleProfiles.set(address, profile);

    if (isNew && totalValue >= cfg.minPositionSize) {
      emitter.emit('newWhale', profile);
    }
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  Object.assign(emitter, {
    async start(): Promise<void> {
      if (running) return;

      running = true;
      logger.info({ config: cfg }, 'Starting whale tracker');

      // Fetch initial top traders
      const topTraders = await fetchTopTraders();
      for (const address of topTraders) {
        trackedAddresses.add(address);
      }

      // Connect WebSocket for real-time trades
      if (cfg.enableRealtime) {
        connectWebSocket();
      }

      // Start position polling
      await pollPositions();
      pollInterval = setInterval(pollPositions, cfg.pollIntervalMs);

      logger.info({ whaleCount: trackedAddresses.size }, 'Whale tracker started');
    },

    stop(): void {
      if (!running) return;

      running = false;

      if (ws) {
        ws.close(1000, 'Stopping');
        ws = null;
      }

      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }

      logger.info('Whale tracker stopped');
    },

    isRunning(): boolean {
      return running;
    },

    getKnownWhales(): WhaleProfile[] {
      return Array.from(whaleProfiles.values());
    },

    getWhaleProfile(address: string): WhaleProfile | undefined {
      return whaleProfiles.get(address);
    },

    getTopWhales(limit = 10): WhaleProfile[] {
      return Array.from(whaleProfiles.values())
        .sort((a, b) => b.totalValue - a.totalValue)
        .slice(0, limit);
    },

    getRecentTrades(limit = 100): WhaleTrade[] {
      return recentTrades.slice(0, limit);
    },

    getActivePositions(marketId?: string): WhalePosition[] {
      const positions = Array.from(activePositions.values());
      if (marketId) {
        return positions.filter((p) => p.marketId === marketId);
      }
      return positions;
    },

    trackAddress(address: string): void {
      trackedAddresses.add(address);
      logger.info({ address }, 'Now tracking address');
    },

    untrackAddress(address: string): void {
      trackedAddresses.delete(address);
      logger.info({ address }, 'Stopped tracking address');
    },

    getConnectionState(): 'connected' | 'disconnected' | 'reconnecting' {
      return connectionState;
    },

    getProfitableWhales(minWinRate = 0.55, minTrades = 5): WhaleProfile[] {
      const profitable: WhaleProfile[] = [];

      for (const [address, profile] of whaleProfiles) {
        const stats = closedPositionsByWhale.get(address);
        if (!stats) continue;

        const totalTrades = stats.wins + stats.losses;
        if (totalTrades < minTrades) continue;

        const winRate = stats.wins / totalTrades;
        if (winRate < minWinRate) continue;

        // Update profile with calculated stats
        profile.winRate = winRate * 100;
        profile.avgReturn = totalTrades > 0 ? stats.totalPnl / totalTrades : 0;

        profitable.push(profile);
      }

      // Sort by win rate, then by total value
      return profitable.sort((a, b) => {
        if (Math.abs(a.winRate - b.winRate) > 1) {
          return b.winRate - a.winRate;
        }
        return b.totalValue - a.totalValue;
      });
    },

    recordClosedPosition(address: string, pnl: number): void {
      const stats = closedPositionsByWhale.get(address) || {
        wins: 0,
        losses: 0,
        totalPnl: 0,
      };

      if (pnl > 0) {
        stats.wins++;
      } else {
        stats.losses++;
      }
      stats.totalPnl += pnl;

      closedPositionsByWhale.set(address, stats);

      // Update profile win rate
      const profile = whaleProfiles.get(address);
      if (profile) {
        const totalTrades = stats.wins + stats.losses;
        profile.winRate = totalTrades > 0 ? (stats.wins / totalTrades) * 100 : 0;
        profile.avgReturn = totalTrades > 0 ? stats.totalPnl / totalTrades : 0;
      }

      logger.debug(
        {
          address: address.slice(0, 8),
          pnl,
          wins: stats.wins,
          losses: stats.losses,
          winRate: ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1),
        },
        'Recorded closed position'
      );
    },

    calculateSignalStrength(profile: WhaleProfile): number {
      return calculateSignalStrengthInternal(profile);
    },
  } as Partial<WhaleTracker>);

  return emitter;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if an address is likely a whale based on trade history
 */
export async function isWhaleAddress(address: string, minVolume = 100000): Promise<boolean> {
  try {
    const response = await fetch(
      `${GAMMA_API_URL}/user-stats?address=${address}`
    );

    if (!response.ok) {
      return false;
    }

    const stats = await response.json() as any;
    const volume = parseFloat(stats.totalVolume || stats.volume || 0);

    return volume >= minVolume;
  } catch {
    return false;
  }
}

/**
 * Get whale activity summary for a market
 */
export async function getMarketWhaleActivity(
  marketId: string,
  minSize = 10000
): Promise<{
  totalWhaleVolume: number;
  buyVolume: number;
  sellVolume: number;
  topBuyers: string[];
  topSellers: string[];
}> {
  try {
    const response = await fetch(
      `${CLOB_REST_URL}/trades?market=${marketId}&limit=500`
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const trades = await response.json() as any[];

    let buyVolume = 0;
    let sellVolume = 0;
    const buyerVolumes = new Map<string, number>();
    const sellerVolumes = new Map<string, number>();

    for (const trade of trades) {
      const usdValue = parseFloat(trade.price) * parseFloat(trade.size);
      if (usdValue < minSize) continue;

      const maker = trade.maker_address || trade.maker;
      const taker = trade.taker_address || trade.taker;
      const side = trade.side?.toUpperCase();

      if (side === 'BUY') {
        buyVolume += usdValue;
        buyerVolumes.set(taker, (buyerVolumes.get(taker) || 0) + usdValue);
      } else {
        sellVolume += usdValue;
        sellerVolumes.set(taker, (sellerVolumes.get(taker) || 0) + usdValue);
      }
    }

    const topBuyers = Array.from(buyerVolumes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([addr]) => addr);

    const topSellers = Array.from(sellerVolumes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([addr]) => addr);

    return {
      totalWhaleVolume: buyVolume + sellVolume,
      buyVolume,
      sellVolume,
      topBuyers,
      topSellers,
    };
  } catch (error) {
    logger.error({ marketId, error }, 'Failed to get market whale activity');
    return {
      totalWhaleVolume: 0,
      buyVolume: 0,
      sellVolume: 0,
      topBuyers: [],
      topSellers: [],
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { CLOB_WS_URL, CLOB_REST_URL, GAMMA_API_URL, KNOWN_WHALES };
