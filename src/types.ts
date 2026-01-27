/**
 * Clodds - Core Type Definitions
 * Claude + Odds: AI assistant for prediction markets
 */

// =============================================================================
// PLATFORMS
// =============================================================================

export type Platform =
  | 'polymarket'
  | 'kalshi'
  | 'manifold'
  | 'metaculus'
  | 'drift'
  | 'predictit'
  | 'betfair';

// =============================================================================
// MARKETS
// =============================================================================

export interface Market {
  id: string;
  platform: Platform;
  slug: string;
  question: string;
  description?: string;
  outcomes: Outcome[];
  volume24h: number;
  liquidity: number;
  endDate?: Date;
  resolved: boolean;
  resolutionValue?: number;
  tags: string[];
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Outcome {
  id: string;
  tokenId?: string;
  name: string;
  price: number;
  previousPrice?: number;
  priceChange24h?: number;
  volume24h: number;
}

export interface Orderbook {
  platform: Platform;
  marketId: string;
  outcomeId: string;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  spread: number;
  midPrice: number;
  timestamp: number;
}

// =============================================================================
// POSITIONS
// =============================================================================

export interface Position {
  id: string;
  platform: Platform;
  marketId: string;
  marketQuestion: string;
  outcome: string;
  outcomeId: string;
  side: 'YES' | 'NO';
  shares: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  value: number;
  openedAt: Date;
}

export interface Portfolio {
  userId: string;
  positions: Position[];
  totalValue: number;
  totalPnl: number;
  totalPnlPct: number;
  byPlatform: Record<Platform, { value: number; pnl: number }>;
}

// =============================================================================
// ALERTS
// =============================================================================

export type AlertType = 'price' | 'volume' | 'news' | 'edge';

export interface Alert {
  id: string;
  userId: string;
  type: AlertType;
  name?: string;
  marketId?: string;
  platform?: Platform;
  condition: AlertCondition;
  enabled: boolean;
  triggered: boolean;
  createdAt: Date;
  lastTriggeredAt?: Date;
}

export interface AlertCondition {
  type: 'price_above' | 'price_below' | 'price_change_pct' | 'volume_spike';
  threshold: number;
  timeWindowSecs?: number;
  direction?: 'up' | 'down' | 'any';
}

// =============================================================================
// NEWS
// =============================================================================

export interface NewsItem {
  id: string;
  source: string;
  sourceType: 'twitter' | 'rss';
  author?: string;
  title: string;
  content?: string;
  url: string;
  publishedAt: Date;
  relevantMarkets?: string[];
  sentiment?: number;
}

export interface EdgeSignal {
  id: string;
  marketId: string;
  platform: Platform;
  marketQuestion: string;
  currentPrice: number;
  fairValue: number;
  edge: number;
  confidence: number;
  source: string;
  reasoning?: string;
  createdAt: Date;
}

// =============================================================================
// USERS & SESSIONS
// =============================================================================

export interface User {
  id: string;
  platform: string;
  platformUserId: string;
  username?: string;
  settings: UserSettings;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface UserSettings {
  alertsEnabled: boolean;
  digestEnabled: boolean;
  digestTime?: string;
  defaultPlatforms: Platform[];
  notifyOnEdge: boolean;
  edgeThreshold: number;
  /** Max single order size in USD for trading */
  maxOrderSize?: number;
}

// =============================================================================
// PER-USER TRADING CREDENTIALS (Clawdbot-style architecture)
// =============================================================================

/**
 * Credential types matching Clawdbot's auth profile system
 */
export type CredentialMode = 'api_key' | 'oauth' | 'wallet';

export interface TradingCredentials {
  userId: string;
  platform: Platform;
  mode: CredentialMode;
  /** Encrypted credentials JSON - decrypt at runtime */
  encryptedData: string;
  /** Whether trading is enabled for this user/platform */
  enabled: boolean;
  /** Last successful use */
  lastUsedAt?: Date;
  /** Cooldown tracking for failed auth */
  failedAttempts: number;
  cooldownUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Polymarket credentials (decrypted form)
 */
export interface PolymarketCredentials {
  privateKey: string;
  funderAddress: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
}

/**
 * Kalshi credentials (decrypted form)
 */
export interface KalshiCredentials {
  email: string;
  password: string;
}

/**
 * Manifold credentials (decrypted form)
 */
export interface ManifoldCredentials {
  apiKey: string;
}

/**
 * Union of all platform credentials
 */
export type PlatformCredentials =
  | { platform: 'polymarket'; data: PolymarketCredentials }
  | { platform: 'kalshi'; data: KalshiCredentials }
  | { platform: 'manifold'; data: ManifoldCredentials };

/**
 * Trading execution context passed to tools
 * (Matches Clawdbot's factory pattern)
 */
export interface TradingContext {
  userId: string;
  sessionKey: string;
  credentials: Map<Platform, PlatformCredentials>;
  /** Max single order in USD */
  maxOrderSize: number;
  /** Whether to actually execute or just simulate */
  dryRun: boolean;
}

export interface Session {
  id: string;
  key: string;
  userId: string;
  channel: string;
  chatId: string;
  chatType: 'dm' | 'group';
  context: SessionContext;
  /** Conversation history (Clawdbot compatibility) */
  history: ConversationMessage[];
  /** Last activity timestamp for idle detection */
  lastActivity: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionContext {
  messageCount: number;
  lastMarkets: string[];
  preferences: Record<string, unknown>;
  /** Conversation history for multi-turn context (last N messages) */
  conversationHistory: ConversationMessage[];
  /** Model override for this session (Clawdbot-style) */
  modelOverride?: string;
  /** Current model (Clawdbot chat command) */
  model?: string;
  /** Thinking level: off, minimal, low, medium, high */
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
  /** Verbose mode */
  verbose?: boolean;
  /** Routed agent ID (Clawdbot-style multi-agent) */
  routedAgentId?: string;
  /** Routed agent system prompt override */
  routedAgentPrompt?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// =============================================================================
// MESSAGES
// =============================================================================

/** File attachment in a message */
export interface MessageAttachment {
  /** Attachment type */
  type: 'image' | 'video' | 'audio' | 'document' | 'voice' | 'sticker';
  /** URL or file path */
  url?: string;
  /** Base64 encoded data */
  data?: string;
  /** MIME type */
  mimeType?: string;
  /** Filename */
  filename?: string;
  /** File size in bytes */
  size?: number;
  /** Image/video dimensions */
  width?: number;
  height?: number;
  /** Duration for audio/video in seconds */
  duration?: number;
  /** Caption */
  caption?: string;
}

/** Thread/reply context */
export interface ThreadContext {
  /** Thread ID (platform-specific) */
  threadId?: string;
  /** Message being replied to */
  replyToMessageId?: string;
  /** Whether this is the thread root */
  isThreadRoot?: boolean;
}

export interface IncomingMessage {
  id: string;
  platform: string;
  userId: string;
  chatId: string;
  chatType: 'dm' | 'group';
  text: string;
  /** Thread/reply context */
  thread?: ThreadContext;
  /** Attachments */
  attachments?: MessageAttachment[];
  /** @deprecated Use thread.replyToMessageId */
  replyToMessageId?: string;
  timestamp: Date;
}

export interface OutgoingMessage {
  platform: string;
  chatId: string;
  text: string;
  parseMode?: 'HTML' | 'Markdown';
  buttons?: MessageButton[][];
  /** Thread/reply context */
  thread?: ThreadContext;
  /** Attachments to send */
  attachments?: MessageAttachment[];
}

export interface MessageButton {
  text: string;
  callbackData?: string;
  url?: string;
}

// =============================================================================
// FEEDS
// =============================================================================

export interface PriceUpdate {
  platform: Platform;
  marketId: string;
  outcomeId: string;
  price: number;
  previousPrice?: number;
  timestamp: number;
}

export interface OrderbookUpdate {
  platform: Platform;
  marketId: string;
  outcomeId: string;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  timestamp: number;
}

// =============================================================================
// SKILLS
// =============================================================================

export interface Skill {
  name: string;
  description: string;
  path: string;
  content: string;
  enabled: boolean;
}

// =============================================================================
// CONFIG
// =============================================================================

export interface Config {
  gateway: {
    port: number;
    auth: { token?: string };
  };
  agents: {
    defaults: {
      workspace: string;
      model: { primary: string; fallbacks?: string[] };
      rateLimit?: {
        maxRequests: number;
        windowMs: number;
      };
    };
  };
  channels: {
    telegram?: {
      enabled: boolean;
      botToken: string;
      dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled';
      allowFrom?: string[];
    };
    discord?: {
      enabled: boolean;
      token: string;
      dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
      allowFrom?: string[];
    };
    webchat?: {
      enabled: boolean;
    };
    whatsapp?: {
      enabled: boolean;
      authDir?: string;
      dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
      allowFrom?: string[];
      requireMentionInGroups?: boolean;
    };
    slack?: {
      enabled: boolean;
      botToken: string;
      appToken: string;
      dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
      allowFrom?: string[];
    };
  };
  feeds: {
    polymarket: { enabled: boolean };
    kalshi: { enabled: boolean; email?: string; password?: string };
    manifold: { enabled: boolean; apiKey?: string };
    metaculus: { enabled: boolean };
    drift: { enabled: boolean };
    news: { enabled: boolean; twitter?: { accounts: string[] } };
  };
  trading?: {
    enabled: boolean;
    dryRun: boolean;
    maxOrderSize: number;
    maxDailyLoss: number;
    polymarket?: {
      privateKey: string;
      funderAddress: string;
      apiKey: string;
      apiSecret: string;
      apiPassphrase: string;
    };
    kalshi?: {
      email: string;
      password: string;
    };
    manifold?: {
      apiKey: string;
    };
  };
  alerts: {
    priceChange: { threshold: number; windowSecs: number };
    volumeSpike: { multiplier: number };
  };
  /** Session configuration (Clawdbot-style) */
  session?: {
    /** How to scope DM sessions */
    dmScope?: 'main' | 'per-peer' | 'per-channel-peer';
    /** Session reset configuration */
    reset?: {
      /** Reset mode: daily, idle, or manual only */
      mode?: 'daily' | 'idle' | 'both' | 'manual';
      /** Hour to reset (0-23) for daily mode */
      atHour?: number;
      /** Minutes of inactivity before reset for idle mode */
      idleMinutes?: number;
    };
    /** Commands that trigger session reset */
    resetTriggers?: string[];
  };
  /** Message queue configuration (Clawdbot-style) */
  messages?: {
    /** Prefix for all bot responses */
    responsePrefix?: string;
    /** Reaction to show when processing */
    ackReaction?: string;
    /** Message queue settings */
    queue?: {
      /** Queue mode: debounce waits for typing to stop, collect batches messages */
      mode?: 'debounce' | 'collect' | 'none';
      /** Milliseconds to wait in debounce mode */
      debounceMs?: number;
      /** Max messages to collect */
      cap?: number;
    };
  };
}
