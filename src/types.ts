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
  | 'predictfun'
  | 'betfair'
  | 'smarkets'
  | 'opinion'
  | 'virtuals'
  | 'hedgehog'
  | 'agentbets'
  | 'hyperliquid'
  | 'binance'
  | 'bybit'
  | 'mexc'
  | 'percolator';

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

export interface MarketIndexEntry {
  platform: Platform;
  marketId: string;
  slug?: string;
  question: string;
  description?: string;
  outcomesJson?: string;
  tagsJson?: string;
  status?: string;
  url?: string;
  endDate?: Date;
  resolved: boolean;
  updatedAt: Date;
  volume24h?: number;
  liquidity?: number;
  openInterest?: number;
  predictions?: number;
  contentHash?: string;
  rawJson?: string;
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
  byPlatform: Partial<Record<Platform, { value: number; pnl: number }>>;
}

export interface PortfolioSnapshot {
  userId: string;
  totalValue: number;
  totalPnl: number;
  totalPnlPct: number;
  totalCostBasis: number;
  positionsCount: number;
  byPlatform: Record<string, { value: number; pnl: number }>;
  createdAt: Date;
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
  /** Channel to deliver alert (e.g., telegram, discord) */
  channel?: string;
  /** Chat ID to deliver alert */
  chatId?: string;
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
  /** Max exposure per position (USD cost basis) */
  maxPositionValue?: number;
  /** Max total exposure across all positions (USD cost basis) */
  maxTotalExposure?: number;
  /** Stop-loss trigger percentage (e.g. 0.2 for 20%) */
  stopLossPct?: number;
}

// =============================================================================
// PER-USER TRADING CREDENTIALS (Clawdbot-style architecture)
// =============================================================================

/**
 * Credential types matching Clawdbot's auth profile system
 */
export type CredentialMode = 'api_key' | 'oauth' | 'wallet' | 'legacy_login';

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
  /** 0=EOA, 1=POLY_PROXY (Magic Link), 2=POLY_GNOSIS_SAFE (MetaMask/browser) */
  signatureType?: number;
}

/**
 * Kalshi credentials (decrypted form)
 */
export interface KalshiCredentials {
  /** API key ID from Kalshi */
  apiKeyId?: string;
  /** RSA private key in PEM format (or base64-encoded PEM) */
  privateKeyPem?: string;
  /** Legacy email login (deprecated) */
  email?: string;
  /** Legacy password login (deprecated) */
  password?: string;
}

/**
 * Manifold credentials (decrypted form)
 */
export interface ManifoldCredentials {
  apiKey: string;
}

/**
 * Betfair credentials (decrypted form)
 */
export interface BetfairCredentials {
  appKey: string;
  username?: string;
  password?: string;
  sessionToken?: string;
}

/**
 * Drift/Solana credentials (decrypted form)
 */
export interface DriftCredentials {
  /** Solana private key (base58) */
  privateKey?: string;
  /** Path to keypair file */
  keypairPath?: string;
}

/**
 * Smarkets credentials (decrypted form)
 */
export interface SmarketsCredentials {
  apiToken?: string;
  sessionToken?: string;
}

/**
 * Opinion.trade credentials (decrypted form)
 */
export interface OpinionCredentials {
  /** API key for market data */
  apiKey: string;
  /** Wallet private key for trading (BNB Chain) */
  privateKey?: string;
  /** Vault/funder address */
  multiSigAddress?: string;
  /** BNB Chain RPC URL (default: https://bsc-dataseed.binance.org) */
  rpcUrl?: string;
}

/**
 * Virtuals Protocol credentials (decrypted form)
 */
export interface VirtualsCredentials {
  /** EVM wallet private key for trading (Base chain) */
  privateKey?: string;
  /** Base chain RPC URL (default: https://mainnet.base.org) */
  rpcUrl?: string;
}

/**
 * Hedgehog Markets credentials (decrypted form)
 */
export interface HedgehogCredentials {
  /** Solana wallet private key (base58) */
  privateKey?: string;
  /** Path to keypair file */
  keypairPath?: string;
  /** API key for higher rate limits */
  apiKey?: string;
  /** Solana RPC URL (default: https://api.mainnet-beta.solana.com) */
  rpcUrl?: string;
}

/**
 * Union of all platform credentials
 */
export type PlatformCredentials =
  | { platform: 'polymarket'; data: PolymarketCredentials }
  | { platform: 'kalshi'; data: KalshiCredentials }
  | { platform: 'manifold'; data: ManifoldCredentials }
  | { platform: 'betfair'; data: BetfairCredentials }
  | { platform: 'drift'; data: DriftCredentials }
  | { platform: 'smarkets'; data: SmarketsCredentials }
  | { platform: 'opinion'; data: OpinionCredentials }
  | { platform: 'virtuals'; data: VirtualsCredentials }
  | { platform: 'hedgehog'; data: HedgehogCredentials };

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
  /** Execution service for placing orders (null if not configured) */
  executionService?: ExecutionServiceRef;
}

/** Platform type for prediction markets */
export type PredictionPlatform = 'polymarket' | 'kalshi' | 'opinion' | 'predictfun';

/** Order result from execution service */
export interface OrderResultRef {
  success: boolean;
  orderId?: string;
  error?: string;
  avgFillPrice?: number;
  filledSize?: number;
  status?: 'pending' | 'open' | 'filled' | 'cancelled' | 'expired' | 'rejected';
  transactionHash?: string;
}

/** Open order from execution service */
export interface OpenOrderRef {
  orderId: string;
  platform: PredictionPlatform;
  marketId: string;
  tokenId?: string;
  outcome?: string;
  side: 'buy' | 'sell';
  price: number;
  originalSize: number;
  remainingSize: number;
  filledSize: number;
  orderType: string;
  status: string;
  createdAt: Date;
  expiration?: Date;
}

/** Minimal interface for execution service (to avoid circular imports) */
export interface ExecutionServiceRef {
  buyLimit(request: {
    platform: PredictionPlatform;
    marketId: string;
    tokenId?: string;
    outcome?: string;
    price: number;
    size: number;
    orderType?: 'GTC' | 'FOK' | 'GTD';
    postOnly?: boolean;
    negRisk?: boolean;
  }): Promise<OrderResultRef>;
  sellLimit(request: {
    platform: PredictionPlatform;
    marketId: string;
    tokenId?: string;
    outcome?: string;
    price: number;
    size: number;
    orderType?: 'GTC' | 'FOK' | 'GTD';
    postOnly?: boolean;
    negRisk?: boolean;
  }): Promise<OrderResultRef>;
  marketBuy(request: {
    platform: PredictionPlatform;
    marketId: string;
    tokenId?: string;
    outcome?: string;
    size: number;
  }): Promise<OrderResultRef>;
  marketSell(request: {
    platform: PredictionPlatform;
    marketId: string;
    tokenId?: string;
    outcome?: string;
    size: number;
  }): Promise<OrderResultRef>;
  makerBuy(request: {
    platform: PredictionPlatform;
    marketId: string;
    tokenId?: string;
    outcome?: string;
    price: number;
    size: number;
  }): Promise<OrderResultRef>;
  makerSell(request: {
    platform: PredictionPlatform;
    marketId: string;
    tokenId?: string;
    outcome?: string;
    price: number;
    size: number;
  }): Promise<OrderResultRef>;
  cancelOrder(platform: PredictionPlatform, orderId: string): Promise<boolean>;
  cancelAllOrders(platform?: PredictionPlatform, marketId?: string): Promise<number>;
  getOpenOrders(platform?: PredictionPlatform): Promise<OpenOrderRef[]>;
  placeOrdersBatch(orders: Array<{
    platform: PredictionPlatform;
    marketId: string;
    tokenId?: string;
    outcome?: string;
    side: 'buy' | 'sell';
    price: number;
    size: number;
  }>): Promise<OrderResultRef[]>;
  cancelOrdersBatch(platform: 'opinion', orderIds: string[]): Promise<Array<{ orderId: string; success: boolean }>>;
}

export interface Session {
  id: string;
  key: string;
  userId: string;
  channel: string;
  /** Optional account ID for multi-account channels */
  accountId?: string;
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
  /** Checkpoint for conversation resumption */
  checkpoint?: {
    createdAt: number;
    messageCount: number;
    summary?: string;
    history: ConversationMessage[];
  };
  /** Last time a checkpoint was restored */
  checkpointRestoredAt?: number;
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
  /** Optional account ID for multi-account channels */
  accountId?: string;
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
  /** Optional account ID for multi-account channels */
  accountId?: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  buttons?: MessageButton[][];
  /** Thread/reply context */
  thread?: ThreadContext;
  /** Attachments to send */
  attachments?: MessageAttachment[];
}

export interface ReactionMessage {
  platform: string;
  chatId: string;
  messageId: string;
  emoji: string;
  remove?: boolean;
  /** Optional account ID for multi-account channels */
  accountId?: string;
  /** Optional sender JID for group messages */
  participant?: string;
  /** Whether the target message was sent by this bot */
  fromMe?: boolean;
}

export interface PollMessage {
  platform: string;
  chatId: string;
  question: string;
  options: string[];
  multiSelect?: boolean;
  /** Optional account ID for multi-account channels */
  accountId?: string;
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
  subcommands?: Array<{ name: string; description: string; category: string }>;
}

// =============================================================================
// CONFIG
// =============================================================================

export interface Config {
  gateway: {
    port: number;
    cors?: boolean | string[];
    auth: { token?: string };
  };
  positions?: {
    enabled?: boolean;
    priceUpdateIntervalMs?: number;
    pnlSnapshotsEnabled?: boolean;
    pnlHistoryDays?: number;
  };
  marketIndex?: {
    enabled?: boolean;
    syncIntervalMs?: number;
    staleAfterMs?: number;
    limitPerPlatform?: number;
    status?: 'open' | 'closed' | 'settled' | 'all';
    excludeSports?: boolean;
    platforms?: Array<'polymarket' | 'kalshi' | 'manifold' | 'metaculus'>;
    minVolume24h?: number;
    minLiquidity?: number;
    minOpenInterest?: number;
    minPredictions?: number;
    excludeResolved?: boolean;
    platformWeights?: Partial<Record<'polymarket' | 'kalshi' | 'manifold' | 'metaculus', number>>;
  };
  opportunityFinder?: {
    /** Enable opportunity finder (default: true) */
    enabled?: boolean;
    /** Minimum edge % to report (default: 0.5) */
    minEdge?: number;
    /** Minimum liquidity $ to consider (default: 100) */
    minLiquidity?: number;
    /** Platforms to scan */
    platforms?: Platform[];
    /** Enable real-time scanning (default: false) */
    realtime?: boolean;
    /** Scan interval in ms (default: 10000) */
    scanIntervalMs?: number;
    /** Use semantic matching (default: true) */
    semanticMatching?: boolean;
    /** Similarity threshold (default: 0.85) */
    similarityThreshold?: number;
    /** Include internal arbitrage YES+NO<$1 (default: true) */
    includeInternal?: boolean;
    /** Include cross-platform arbitrage (default: true) */
    includeCross?: boolean;
    /** Include edge vs fair value (default: true) */
    includeEdge?: boolean;
  };
  arbitrageExecution?: {
    /** Enable auto-execution of arbitrage opportunities (default: false) */
    enabled?: boolean;
    /** Dry run mode - log but don't execute (default: true) */
    dryRun?: boolean;
    /** Minimum edge % to execute (default: 1.0) */
    minEdge?: number;
    /** Minimum liquidity $ (default: 500) */
    minLiquidity?: number;
    /** Maximum position size per trade $ (default: 100) */
    maxPositionSize?: number;
    /** Maximum daily loss $ (default: 500) */
    maxDailyLoss?: number;
    /** Maximum concurrent positions (default: 3) */
    maxConcurrentPositions?: number;
    /** Platforms to execute on */
    platforms?: Platform[];
    /** Use maker orders when possible (default: true) */
    preferMakerOrders?: boolean;
    /** Confirmation delay ms before executing (default: 0) */
    confirmationDelayMs?: number;
  };
  whaleTracking?: {
    /** Enable whale tracking (default: false) */
    enabled?: boolean;
    /** Minimum trade size in USD to track (default: 10000) */
    minTradeSize?: number;
    /** Minimum position size in USD to track (default: 50000) */
    minPositionSize?: number;
    /** Platforms to track (default: ['polymarket']) */
    platforms?: Platform[];
    /** Enable real-time WebSocket monitoring (default: true) */
    realtime?: boolean;
    /** Poll interval in ms for REST fallback (default: 30000) */
    pollIntervalMs?: number;
  };
  copyTrading?: {
    /** Enable copy trading (default: false) */
    enabled?: boolean;
    /** Dry run mode - simulate but don't execute (default: true) */
    dryRun?: boolean;
    /** Wallet addresses to follow */
    followedAddresses?: string[];
    /** Sizing mode: fixed, proportional, or percentage */
    sizingMode?: 'fixed' | 'proportional' | 'percentage';
    /** Fixed size in USD per copied trade (default: 100) */
    fixedSize?: number;
    /** Proportional multiplier of whale size (default: 0.1) */
    proportionalMultiplier?: number;
    /** Percentage of portfolio per trade (default: 1) */
    portfolioPercentage?: number;
    /** Max position size in USD (default: 500) */
    maxPositionSize?: number;
    /** Delay in ms before copying (default: 5000) */
    copyDelayMs?: number;
  };
  smartRouting?: {
    /** Enable smart order routing (default: true) */
    enabled?: boolean;
    /** Routing mode (default: 'balanced') */
    mode?: 'best_price' | 'best_liquidity' | 'lowest_fee' | 'balanced';
    /** Platforms to route across */
    platforms?: Platform[];
    /** Max slippage in percent (default: 1) */
    maxSlippage?: number;
    /** Prefer maker orders for rebates (default: true) */
    preferMaker?: boolean;
    /** Allow splitting orders across platforms (default: false) */
    allowSplitting?: boolean;
  };
  evmDex?: {
    /** Enable EVM DEX trading (default: false) */
    enabled?: boolean;
    /** Default chain (default: 'ethereum') */
    defaultChain?: 'ethereum' | 'arbitrum' | 'optimism' | 'base' | 'polygon';
    /** Default slippage in bps (default: 50) */
    slippageBps?: number;
    /** MEV protection level (default: 'basic') */
    mevProtection?: 'none' | 'basic' | 'aggressive';
    /** Max price impact in percent (default: 3) */
    maxPriceImpact?: number;
  };
  realtimeAlerts?: {
    /** Enable real-time alerts (default: false) */
    enabled?: boolean;
    /** Alert targets - where to send notifications */
    targets?: Array<{
      platform: string;
      chatId: string;
      accountId?: string;
    }>;
    /** Whale trade alerts config */
    whaleTrades?: {
      enabled?: boolean;
      /** Min trade size to alert (default: 50000) */
      minSize?: number;
      /** Cooldown per address in ms (default: 300000 = 5 min) */
      cooldownMs?: number;
    };
    /** Arbitrage opportunity alerts config */
    arbitrage?: {
      enabled?: boolean;
      /** Min edge % to alert (default: 2) */
      minEdge?: number;
      /** Cooldown per opportunity in ms (default: 600000 = 10 min) */
      cooldownMs?: number;
    };
    /** Price movement alerts config */
    priceMovement?: {
      enabled?: boolean;
      /** Min price change % to alert (default: 5) */
      minChangePct?: number;
      /** Time window in ms (default: 300000 = 5 min) */
      windowMs?: number;
    };
    /** Copy trading alerts config */
    copyTrading?: {
      enabled?: boolean;
      /** Alert on trade copied */
      onCopied?: boolean;
      /** Alert on copy failed */
      onFailed?: boolean;
    };
  };
  memory?: {
    auto?: {
      enabled?: boolean;
      scope?: 'user' | 'channel';
      minIntervalMs?: number;
      maxItemsPerType?: number;
      profileUpdateEvery?: number;
      semanticSearchTopK?: number;
      includeMemoryContext?: boolean;
      excludeSensitive?: boolean;
    };
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
      groups?: Record<string, { requireMention?: boolean }>;
      rateLimit?: RateLimitConfig;
    };
    discord?: {
      enabled: boolean;
      token: string;
      appId?: string;
      dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
      allowFrom?: string[];
      groups?: Record<string, { requireMention?: boolean }>;
      rateLimit?: RateLimitConfig;
    };
    webchat?: {
      enabled: boolean;
      authToken?: string;
      rateLimit?: RateLimitConfig;
    };
    whatsapp?: {
      enabled: boolean;
      authDir?: string;
      defaultAccountId?: string;
      accounts?: Record<string, {
        authDir?: string;
        enabled?: boolean;
        name?: string;
        dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
        allowFrom?: string[];
        requireMentionInGroups?: boolean;
        groups?: Record<string, { requireMention?: boolean }>;
      }>;
      dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
      allowFrom?: string[];
      requireMentionInGroups?: boolean;
      groups?: Record<string, { requireMention?: boolean }>;
      rateLimit?: RateLimitConfig;
    };
    slack?: {
      enabled: boolean;
      botToken: string;
      appToken: string;
      dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
      allowFrom?: string[];
      groups?: Record<string, { requireMention?: boolean }>;
      rateLimit?: RateLimitConfig;
    };
    teams?: {
      enabled: boolean;
      appId: string;
      appPassword: string;
      dmPolicy?: 'pairing' | 'open';
      allowFrom?: string[];
      teamAllowlist?: string[];
      groups?: Record<string, { requireMention?: boolean }>;
      rateLimit?: RateLimitConfig;
    };
    googlechat?: {
      enabled: boolean;
      credentialsPath?: string;
      credentials?: {
        client_email: string;
        private_key: string;
        project_id: string;
      };
      dmPolicy?: 'pairing' | 'open';
      allowFrom?: string[];
      spaces?: string[];
      groups?: Record<string, { requireMention?: boolean }>;
      rateLimit?: RateLimitConfig;
    };
    matrix?: {
      enabled: boolean;
      homeserverUrl: string;
      accessToken: string;
      userId: string;
      dmPolicy?: 'pairing' | 'open';
      allowFrom?: string[];
      roomAllowlist?: string[];
      deviceId?: string;
      groups?: Record<string, { requireMention?: boolean }>;
      rateLimit?: RateLimitConfig;
    };
    signal?: {
      enabled: boolean;
      phoneNumber: string;
      signalCliPath?: string;
      configDir?: string;
      dmPolicy?: 'pairing' | 'open';
      allowFrom?: string[];
      groupAllowlist?: string[];
      groups?: Record<string, { requireMention?: boolean }>;
      rateLimit?: RateLimitConfig;
    };
    imessage?: {
      enabled: boolean;
      dmPolicy?: 'pairing' | 'open';
      allowFrom?: string[];
      groupAllowlist?: string[];
      pollInterval?: number;
      groups?: Record<string, { requireMention?: boolean }>;
      rateLimit?: RateLimitConfig;
    };
    line?: {
      enabled: boolean;
      channelAccessToken: string;
      channelSecret: string;
      webhookPort?: number;
      webhookPath?: string;
      useInternalWebhookServer?: boolean;
      groups?: Record<string, { requireMention?: boolean }>;
      rateLimit?: RateLimitConfig;
    };
  };
  feeds: {
    polymarket: {
      enabled: boolean;
      rtds?: {
        enabled?: boolean;
        url?: string;
        pingIntervalMs?: number;
        reconnectDelayMs?: number;
        subscriptions?: Array<{
          topic: 'crypto_prices' | 'crypto_prices_chainlink' | 'comments';
          type: string;
          filters?: string;
          gammaAuthAddress?: string;
          clobAuth?: { key: string; secret: string; passphrase: string };
        }>;
      };
    };
    kalshi: {
      enabled: boolean;
      apiKeyId?: string;
      privateKeyPem?: string;
      privateKeyPath?: string;
      /** Legacy email login (deprecated) */
      email?: string;
      /** Legacy password login (deprecated) */
      password?: string;
    };
    manifold: { enabled: boolean; apiKey?: string };
    metaculus: { enabled: boolean };
    drift: { enabled: boolean; betApiUrl?: string; requestTimeoutMs?: number };
    betfair?: {
      enabled: boolean;
      appKey: string;
      username?: string;
      password?: string;
      sessionToken?: string;
      certPath?: string;
      keyPath?: string;
    };
    smarkets?: {
      enabled: boolean;
      apiToken?: string;
      sessionToken?: string;
    };
    opinion?: {
      enabled: boolean;
      /** API key for Opinion.trade */
      apiKey?: string;
      /** Wallet private key for trading (BNB Chain) */
      privateKey?: string;
      /** Vault/funder address */
      multiSigAddress?: string;
      /** BNB Chain RPC URL (default: https://bsc-dataseed.binance.org) */
      rpcUrl?: string;
    };
    virtuals?: {
      enabled: boolean;
      /** EVM wallet private key for trading (Base chain) */
      privateKey?: string;
      /** Base chain RPC URL (default: https://mainnet.base.org) */
      rpcUrl?: string;
      /** Minimum market cap to include agents (default: 0) */
      minMarketCap?: number;
      /** Categories to filter (e.g., ['Entertainment', 'Productivity']) */
      categories?: string[];
    };
    hedgehog?: {
      enabled: boolean;
      /** API key for Hedgehog Markets (optional, for higher rate limits) */
      apiKey?: string;
      /** Solana wallet private key for trading (base58) */
      privateKey?: string;
      /** Path to keypair file */
      keypairPath?: string;
      /** Solana RPC URL (default: https://api.mainnet-beta.solana.com) */
      rpcUrl?: string;
      /** WebSocket URL (default: wss://ws.hedgehog.markets) */
      wsUrl?: string;
      /** Polling interval in ms (default: 10000) */
      pollIntervalMs?: number;
      /** Minimum volume to include markets (default: 0) */
      minVolume?: number;
      /** Categories to filter (optional) */
      categories?: string[];
    };
    news: {
      enabled: boolean;
      twitter?: {
        accounts: string[];
        bearerToken?: string;
        baseUrl?: string;
        requestTimeoutMs?: number;
      };
    };
    percolator?: import('./percolator/types').PercolatorConfig;
  };
  solana?: {
    rpcUrl?: string;
    privateKey?: string;
    keypairPath?: string;
  };
  /** x402 payment configuration */
  x402?: {
    enabled?: boolean;
    /** Default network (base, base-sepolia, solana, solana-devnet) */
    network?: 'base' | 'base-sepolia' | 'solana' | 'solana-devnet';
    /** EVM private key for Base payments */
    evmPrivateKey?: string;
    /** Solana private key for Solana payments */
    solanaPrivateKey?: string;
    /** Facilitator URL (default: Coinbase) */
    facilitatorUrl?: string;
    /** Auto-approve payments under this USD amount */
    autoApproveLimit?: number;
    /** Dry run mode */
    dryRun?: boolean;
    /** Server config for receiving payments */
    server?: {
      /** Address to receive payments */
      payToAddress?: string;
      /** Network to receive on */
      network?: 'base' | 'base-sepolia' | 'solana' | 'solana-devnet';
    };
  };
  trading?: {
    enabled: boolean;
    dryRun: boolean;
    maxOrderSize: number;
    maxDailyLoss: number;
    stopLossCooldownMs?: number;
    polymarket?: {
      /** Wallet address (used in POLY-ADDRESS header) */
      address: string;
      apiKey: string;
      apiSecret: string;
      apiPassphrase: string;
      /** Private key for L1 signing (optional, for advanced operations) */
      privateKey?: string;
    };
    kalshi?: {
      /** API key ID from Kalshi dashboard */
      apiKeyId: string;
      /** RSA private key in PEM format */
      privateKeyPem: string;
    };
    manifold?: {
      apiKey: string;
    };
    opinion?: {
      /** API key for Opinion.trade */
      apiKey: string;
      /** Wallet private key for trading (BNB Chain) */
      privateKey: string;
      /** Vault/funder address */
      vaultAddress: string;
      /** BNB Chain RPC URL (optional) */
      rpcUrl?: string;
    };
    predictfun?: {
      /** Wallet private key for trading (BNB Chain) */
      privateKey: string;
      /** Smart wallet/deposit address (optional) */
      predictAccount?: string;
      /** BNB Chain RPC URL (optional) */
      rpcUrl?: string;
      /** API key (optional) */
      apiKey?: string;
    };
    /** Crypto HFT adapter config */
    cryptoHft?: {
      enabled?: boolean;
      [key: string]: unknown;
    };
    /** HFT divergence adapter config */
    hftDivergence?: {
      enabled?: boolean;
      [key: string]: unknown;
    };
    /** Market making config */
    marketMaking?: {
      enabled?: boolean;
      [key: string]: unknown;
    };
  };
  /** Futures/perpetuals trading configuration */
  futures?: {
    enabled: boolean;
    dryRun?: boolean;
    defaultLeverage?: number;
    maxPositionSize?: number;
    binance?: {
      apiKey: string;
      secretKey: string;
      testnet?: boolean;
    };
    bybit?: {
      apiKey: string;
      secretKey: string;
      testnet?: boolean;
    };
    mexc?: {
      apiKey: string;
      secretKey: string;
    };
    hyperliquid?: {
      privateKey: string;
      vaultAddress?: string;
      testnet?: boolean;
    };
  };
  alerts: {
    priceChange: { threshold: number; windowSecs: number };
    volumeSpike: { multiplier: number };
  };
  http?: HttpRateLimitConfig;
  cron?: {
    enabled?: boolean;
    alertScanIntervalMs?: number;
    digestIntervalMs?: number;
    portfolioSyncIntervalMs?: number;
    stopLossIntervalMs?: number;
  };
  monitoring?: MonitoringConfig;
  marketCache?: {
    enabled?: boolean;
    ttlMs?: number;
    cleanupIntervalMs?: number;
  };
  /** Tick recorder for TimescaleDB historical data storage */
  tickRecorder?: {
    /** Enable tick recording (default: false) */
    enabled: boolean;
    /** PostgreSQL/TimescaleDB connection string */
    connectionString: string;
    /** Batch size before flushing to DB (default: 100) */
    batchSize?: number;
    /** Flush interval in ms (default: 1000) */
    flushIntervalMs?: number;
    /** Retention period in days (default: 365) */
    retentionDays?: number;
    /** Platforms to record (default: all enabled) */
    platforms?: Platform[];
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
    /** Cleanup configuration */
    cleanup?: {
      /** Whether to delete old sessions */
      enabled?: boolean;
      /** Max age in days before deletion */
      maxAgeDays?: number;
      /** Only delete sessions with no recent activity */
      idleDays?: number;
    };
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
    /** Offline outbound message queue settings */
    offlineQueue?: OfflineQueueConfig;
  };
  /** Execution queue (Redis/BullMQ) for decoupling gateway from order execution */
  queue?: {
    /** Enable execution queue (default: false, uses direct execution) */
    enabled?: boolean;
    /** Redis connection */
    redis?: {
      /** Redis host (default: localhost) */
      host?: string;
      /** Redis port (default: 6379) */
      port?: number;
      /** Redis password (optional) */
      password?: string;
    };
    /** Worker concurrency - max simultaneous jobs (default: 10) */
    concurrency?: number;
    /** Job timeout in ms (default: 30000) */
    timeoutMs?: number;
  };
  /** Alternative data sentiment pipeline */
  altData?: import('./services/alt-data/types').AltDataConfig;
  /** Signal router — routes signals to execution */
  signalRouter?: import('./signal-router/types').SignalRouterConfig;
  /** ML training pipeline — learn from signal outcomes */
  mlPipeline?: import('./ml-pipeline/types').MLPipelineConfig;
  /** Bittensor subnet mining configuration */
  bittensor?: import('./bittensor/types').BittensorConfig;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  perUser?: boolean;
}

export interface HttpRetryConfig {
  enabled?: boolean;
  maxAttempts?: number;
  minDelay?: number;
  maxDelay?: number;
  jitter?: number;
  backoffMultiplier?: number;
  methods?: string[];
}

export interface HttpRateLimitConfig {
  enabled?: boolean;
  defaultRateLimit?: RateLimitConfig;
  perHost?: Record<string, RateLimitConfig>;
  retry?: HttpRetryConfig;
}

export interface OfflineQueueConfig {
  enabled?: boolean;
  maxSize?: number;
  maxAgeMs?: number;
  retryIntervalMs?: number;
  maxRetries?: number;
}

export interface MonitoringTarget {
  platform: string;
  chatId: string;
  /** Optional account ID for multi-account channels */
  accountId?: string;
  threadId?: string;
}

export interface MonitoringConfig {
  enabled?: boolean;
  cooldownMs?: number;
  alertTargets?: MonitoringTarget[];
  email?: {
    enabled?: boolean;
    from?: string;
    to?: string[];
    subjectPrefix?: string;
  };
  providerHealth?: {
    enabled?: boolean;
    alertAfterFailures?: number;
    alertOnRecovery?: boolean;
    cooldownMs?: number;
  };
  errors?: {
    enabled?: boolean;
    cooldownMs?: number;
    includeStack?: boolean;
  };
  systemHealth?: {
    enabled?: boolean;
    intervalMs?: number;
    memoryWarnPct?: number;
    diskWarnPct?: number;
    cooldownMs?: number;
  };
}
