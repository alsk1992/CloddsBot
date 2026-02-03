/**
 * Hedgehog Markets Type Definitions
 * Solana-based prediction market platform
 */

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Hedgehog market from API
 */
export interface HedgehogApiMarket {
  /** Market public key / ID */
  id: string;
  /** Market title/question */
  title: string;
  /** Market description */
  description?: string;
  /** Category (e.g., 'crypto', 'sports', 'politics') */
  category?: string;
  /** Market status */
  status: 'open' | 'closed' | 'resolved' | 'cancelled';
  /** Market outcomes/options */
  outcomes: HedgehogOutcome[];
  /** Total volume in USD */
  volume?: number;
  /** 24h volume in USD */
  volume24h?: number;
  /** Total liquidity in USD */
  liquidity?: number;
  /** Market end/resolution time (Unix timestamp or ISO string) */
  endTime?: number | string;
  /** Resolution value (0-1 for binary, outcome index for multi) */
  resolution?: number;
  /** Creation timestamp */
  createdAt?: number | string;
  /** Last update timestamp */
  updatedAt?: number | string;
  /** Market creator address */
  creator?: string;
  /** Resolver address */
  resolver?: string;
  /** Market type */
  marketType?: 'binary' | 'categorical' | 'scalar';
  /** Fee rate (basis points) */
  feeRate?: number;
  /** Mint address for the market token */
  mint?: string;
  /** Pool address */
  pool?: string;
  /** Image URL */
  imageUrl?: string;
  /** Tags */
  tags?: string[];
}

/**
 * Hedgehog market outcome
 */
export interface HedgehogOutcome {
  /** Outcome ID */
  id: string;
  /** Token ID on-chain */
  tokenId?: string;
  /** Outcome name (e.g., 'Yes', 'No', or specific option) */
  name: string;
  /** Current price (0-1) */
  price: number;
  /** 24h price change */
  priceChange24h?: number;
  /** 24h volume */
  volume24h?: number;
  /** Total volume */
  volume?: number;
  /** Token mint address */
  mint?: string;
}

/**
 * Hedgehog orderbook entry
 */
export interface HedgehogOrderbookEntry {
  /** Price level */
  price: number;
  /** Size at this price */
  size: number;
}

/**
 * Hedgehog orderbook response
 */
export interface HedgehogOrderbook {
  /** Market ID */
  marketId: string;
  /** Outcome ID */
  outcomeId: string;
  /** Bid orders (buy) */
  bids: HedgehogOrderbookEntry[];
  /** Ask orders (sell) */
  asks: HedgehogOrderbookEntry[];
  /** Timestamp */
  timestamp: number;
}

/**
 * Markets list API response
 */
export interface HedgehogMarketsResponse {
  markets: HedgehogApiMarket[];
  total?: number;
  page?: number;
  pageSize?: number;
}

/**
 * Single market API response
 */
export interface HedgehogMarketResponse {
  market: HedgehogApiMarket;
}

/**
 * Price update from API or WebSocket
 */
export interface HedgehogPriceUpdate {
  marketId: string;
  outcomeId: string;
  price: number;
  previousPrice?: number;
  timestamp: number;
}

// =============================================================================
// WebSocket Types
// =============================================================================

/**
 * WebSocket message types
 */
export type HedgehogWsMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'price'
  | 'orderbook'
  | 'trade'
  | 'heartbeat'
  | 'error';

/**
 * WebSocket subscribe message
 */
export interface HedgehogWsSubscribe {
  type: 'subscribe';
  channel: 'price' | 'orderbook' | 'trades';
  marketId: string;
}

/**
 * WebSocket unsubscribe message
 */
export interface HedgehogWsUnsubscribe {
  type: 'unsubscribe';
  channel: 'price' | 'orderbook' | 'trades';
  marketId: string;
}

/**
 * WebSocket price message
 */
export interface HedgehogWsPrice {
  type: 'price';
  marketId: string;
  outcomeId: string;
  price: number;
  timestamp: number;
}

/**
 * WebSocket orderbook message
 */
export interface HedgehogWsOrderbook {
  type: 'orderbook';
  marketId: string;
  outcomeId: string;
  bids: HedgehogOrderbookEntry[];
  asks: HedgehogOrderbookEntry[];
  timestamp: number;
}

/**
 * WebSocket trade message
 */
export interface HedgehogWsTrade {
  type: 'trade';
  marketId: string;
  outcomeId: string;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  timestamp: number;
  txSignature?: string;
}

/**
 * WebSocket heartbeat message
 */
export interface HedgehogWsHeartbeat {
  type: 'heartbeat';
  timestamp: number;
}

/**
 * WebSocket error message
 */
export interface HedgehogWsError {
  type: 'error';
  code: string;
  message: string;
}

/**
 * Union of all WebSocket messages
 */
export type HedgehogWsMessage =
  | HedgehogWsSubscribe
  | HedgehogWsUnsubscribe
  | HedgehogWsPrice
  | HedgehogWsOrderbook
  | HedgehogWsTrade
  | HedgehogWsHeartbeat
  | HedgehogWsError;

// =============================================================================
// Feed Config Types
// =============================================================================

/**
 * Hedgehog feed configuration
 */
export interface HedgehogFeedConfig {
  /** Base API URL (default: https://api.hedgehog.markets) */
  apiUrl?: string;
  /** WebSocket URL (default: wss://ws.hedgehog.markets) */
  wsUrl?: string;
  /** API key (optional, for higher rate limits) */
  apiKey?: string;
  /** Request timeout in ms (default: 10000) */
  requestTimeoutMs?: number;
  /** Polling interval for price updates in ms (default: 10000) */
  pollIntervalMs?: number;
  /** Enable WebSocket connection (default: true) */
  enableWebSocket?: boolean;
  /** Minimum volume to include markets (default: 0) */
  minVolume?: number;
  /** Categories to filter (optional) */
  categories?: string[];
}
