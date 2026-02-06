/**
 * Configuration System - Clawdbot-style config management
 *
 * Features:
 * - JSON5 config file loading
 * - Environment variable substitution
 * - Config validation with Zod
 * - Default values
 * - Config paths resolution
 * - Backup rotation
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';

// =============================================================================
// PATHS
// =============================================================================

/** Resolve ~ to home directory */
function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('~')) {
    return resolve(trimmed.replace(/^~(?=$|[\\/])/, homedir()));
  }
  return resolve(trimmed);
}

function readPackageVersion(): string {
  if (process.env.npm_package_version) {
    return process.env.npm_package_version;
  }
  try {
    const pkgPath = resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {}
  return 'unknown';
}

/** State directory for mutable data */
export function resolveStateDir(env = process.env): string {
  const override = env.CLODDS_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  return join(homedir(), '.clodds');
}

/** Config file path */
export function resolveConfigPath(env = process.env): string {
  const override = env.CLODDS_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  return join(resolveStateDir(env), 'clodds.json');
}

/** Credentials directory */
export function resolveCredentialsDir(env = process.env): string {
  return join(resolveStateDir(env), 'credentials');
}

/** Logs directory */
export function resolveLogsDir(env = process.env): string {
  return join(resolveStateDir(env), 'logs');
}

/** Workspace directory */
export function resolveWorkspaceDir(env = process.env): string {
  const override = env.CLODDS_WORKSPACE?.trim();
  if (override) return resolveUserPath(override);
  return join(homedir(), 'clodds');
}

export const STATE_DIR = resolveStateDir();
export const CONFIG_PATH = resolveConfigPath();
export const CREDENTIALS_DIR = resolveCredentialsDir();
export const LOGS_DIR = resolveLogsDir();
export const WORKSPACE_DIR = resolveWorkspaceDir();
export const DEFAULT_GATEWAY_PORT = 18789;

// =============================================================================
// TYPES
// =============================================================================

export interface AgentConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  workspace?: string;
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
  sandbox?: {
    mode?: 'off' | 'non-main' | 'all';
    allowedTools?: string[];
    deniedTools?: string[];
  };
}

export interface GatewayConfig {
  port?: number;
  bind?: 'loopback' | 'all';
  cors?: boolean | string[];
  auth?: {
    mode?: 'off' | 'token' | 'password';
    token?: string;
    password?: string;
  };
  tailscale?: {
    mode?: 'off' | 'serve' | 'funnel';
    resetOnExit?: boolean;
  };
}

export interface ChannelConfig {
  enabled?: boolean;
  allowFrom?: string[];
  groups?: Record<string, { requireMention?: boolean }>;
  rateLimit?: RateLimitConfig;
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

export interface TelegramConfig extends ChannelConfig {
  botToken?: string;
  webhookUrl?: string;
}

export interface DiscordConfig extends ChannelConfig {
  token?: string;
  guilds?: string[];
  appId?: string;
}

export interface WebChatConfig extends ChannelConfig {
  authToken?: string;
}

export interface SlackConfig extends ChannelConfig {
  botToken?: string;
  appToken?: string;
}

export interface WhatsAppConfig extends ChannelConfig {
  /** Directory to store auth state */
  authDir?: string;
  /** Default account ID when multiple accounts are configured */
  defaultAccountId?: string;
  /** Multiple account definitions (auth per account) */
  accounts?: Record<string, {
    authDir?: string;
    enabled?: boolean;
    name?: string;
    dmPolicy?: 'open' | 'allowlist' | 'pairing' | 'disabled';
    allowFrom?: string[];
    requireMentionInGroups?: boolean;
    groups?: Record<string, { requireMention?: boolean }>;
  }>;
  /** DM policy */
  dmPolicy?: 'open' | 'allowlist' | 'pairing' | 'disabled';
  /** Static allowlist of phone numbers (with country code, no +) */
  allowFrom?: string[];
  /** Whether to require @ mention in groups */
  requireMentionInGroups?: boolean;
}

export interface TeamsConfig extends ChannelConfig {
  /** Microsoft App ID */
  appId?: string;
  /** Microsoft App Password */
  appPassword?: string;
  /** DM policy */
  dmPolicy?: 'pairing' | 'open';
  /** Allowed user IDs */
  allowFrom?: string[];
  /** Allowed teams/channels */
  teamAllowlist?: string[];
}

export interface GoogleChatConfig extends ChannelConfig {
  /** Path to service account credentials JSON */
  credentialsPath?: string;
  /** Service account credentials as JSON object */
  credentials?: {
    client_email: string;
    private_key: string;
    project_id: string;
  };
  /** DM policy */
  dmPolicy?: 'pairing' | 'open';
  /** Allowed user emails */
  allowFrom?: string[];
  /** Space allowlist */
  spaces?: string[];
}

export interface MatrixConfig extends ChannelConfig {
  homeserverUrl?: string;
  accessToken?: string;
  userId?: string;
  dmPolicy?: 'pairing' | 'open';
  allowFrom?: string[];
  roomAllowlist?: string[];
  deviceId?: string;
}

export interface SignalConfig extends ChannelConfig {
  phoneNumber?: string;
  signalCliPath?: string;
  configDir?: string;
  dmPolicy?: 'pairing' | 'open';
  allowFrom?: string[];
  groupAllowlist?: string[];
}

export interface iMessageConfig extends ChannelConfig {
  dmPolicy?: 'pairing' | 'open';
  allowFrom?: string[];
  groupAllowlist?: string[];
  pollInterval?: number;
}

export interface LineConfig extends ChannelConfig {
  channelAccessToken?: string;
  channelSecret?: string;
  webhookPort?: number;
  webhookPath?: string;
  useInternalWebhookServer?: boolean;
}

export interface ChannelsConfig {
  telegram?: TelegramConfig;
  discord?: DiscordConfig;
  webchat?: WebChatConfig;
  slack?: SlackConfig;
  whatsapp?: WhatsAppConfig;
  teams?: TeamsConfig;
  googlechat?: GoogleChatConfig;
  matrix?: MatrixConfig;
  signal?: SignalConfig;
  imessage?: iMessageConfig;
  line?: LineConfig;
}

export interface BrowserConfig {
  enabled?: boolean;
  headless?: boolean;
  executablePath?: string;
  userDataDir?: string;
}

export interface TTSConfig {
  enabled?: boolean;
  provider?: 'elevenlabs' | 'system';
  voice?: string;
  apiKey?: string;
}

export interface CronConfig {
  enabled?: boolean;
  jobs?: Array<{
    id: string;
    schedule: string;
    action: string;
    enabled?: boolean;
  }>;
}

export interface PluginsConfig {
  enabled?: boolean;
  autoEnable?: string[];
  disabled?: string[];
}

export interface LoggingConfig {
  level?: 'debug' | 'info' | 'warn' | 'error';
  file?: boolean;
  json?: boolean;
}

export interface MonitoringTarget {
  platform: string;
  chatId: string;
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

export interface MetaConfig {
  lastTouchedVersion?: string;
  lastTouchedAt?: string;
}

export interface LedgerConfig {
  enabled?: boolean;
  captureAll?: boolean;
  hashIntegrity?: boolean;
  retentionDays?: number;
  onchainAnchor?: boolean;
  anchorChain?: 'solana' | 'polygon' | 'base';
}

export interface CloddsConfig {
  agent?: AgentConfig;
  gateway?: GatewayConfig;
  session?: {
    dmScope?: 'main' | 'per-peer' | 'per-channel-peer';
    reset?: {
      mode?: 'daily' | 'idle' | 'both' | 'manual';
      atHour?: number;
      idleMinutes?: number;
    };
    resetTriggers?: string[];
    cleanup?: {
      enabled?: boolean;
      maxAgeDays?: number;
      idleDays?: number;
    };
  };
  channels?: ChannelsConfig;
  messages?: MessagesConfig;
  feeds?: FeedsConfig;
  marketCache?: MarketCacheConfig;
  marketIndex?: MarketIndexConfig;
  memory?: MemoryAutoConfig;
  positions?: PositionsConfig;
  solana?: SolanaConfig;
  browser?: BrowserConfig;
  tts?: TTSConfig;
  cron?: CronConfig;
  plugins?: PluginsConfig;
  logging?: LoggingConfig;
  http?: HttpRateLimitConfig;
  monitoring?: MonitoringConfig;
  ledger?: LedgerConfig;
  meta?: MetaConfig;
  bittensor?: Partial<import('../bittensor/types').BittensorConfig>;
}

export interface PositionsConfig {
  enabled?: boolean;
  priceUpdateIntervalMs?: number;
  pnlSnapshotsEnabled?: boolean;
  pnlHistoryDays?: number;
}

export interface MarketCacheConfig {
  enabled?: boolean;
  ttlMs?: number;
  cleanupIntervalMs?: number;
}

export interface MarketIndexConfig {
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
}

export interface MemoryAutoConfig {
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
}

export interface MessagesConfig {
  responsePrefix?: string;
  ackReaction?: string;
  queue?: {
    mode?: 'debounce' | 'collect' | 'none';
    debounceMs?: number;
    cap?: number;
  };
  offlineQueue?: OfflineQueueConfig;
}

export interface OfflineQueueConfig {
  enabled?: boolean;
  maxSize?: number;
  maxAgeMs?: number;
  retryIntervalMs?: number;
  maxRetries?: number;
}

export interface RtdsSubscriptionConfig {
  topic: 'crypto_prices' | 'crypto_prices_chainlink' | 'comments';
  type: string;
  filters?: string;
  gammaAuthAddress?: string;
  clobAuth?: {
    key: string;
    secret: string;
    passphrase: string;
  };
}

export interface RtdsConfig {
  enabled?: boolean;
  url?: string;
  pingIntervalMs?: number;
  reconnectDelayMs?: number;
  subscriptions?: RtdsSubscriptionConfig[];
}

export interface FeedsConfig {
  polymarket?: { enabled?: boolean; rtds?: RtdsConfig };
  kalshi?: {
    enabled?: boolean;
    apiKeyId?: string;
    privateKeyPem?: string;
    privateKeyPath?: string;
    /** Legacy email login (deprecated) */
    email?: string;
    /** Legacy password login (deprecated) */
    password?: string;
  };
  manifold?: { enabled?: boolean; apiKey?: string };
  metaculus?: { enabled?: boolean };
  drift?: { enabled?: boolean; betApiUrl?: string; requestTimeoutMs?: number };
  news?: { enabled?: boolean; twitter?: { accounts: string[]; bearerToken?: string; baseUrl?: string; requestTimeoutMs?: number } };
}

export interface SolanaConfig {
  rpcUrl?: string;
  privateKey?: string;
  keypairPath?: string;
}

// =============================================================================
// DEFAULTS
// =============================================================================

export const DEFAULT_CONFIG: CloddsConfig = {
  agent: {
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    temperature: 0.7,
    thinkingLevel: 'medium',
    sandbox: { mode: 'off' },
  },
  gateway: {
    port: DEFAULT_GATEWAY_PORT,
    bind: 'loopback',
    cors: false,
    auth: { mode: 'off' },
    tailscale: { mode: 'off' },
  },
  memory: {
    auto: {
      enabled: true,
      scope: 'user',
      minIntervalMs: 2 * 60 * 1000,
      maxItemsPerType: 5,
      profileUpdateEvery: 6,
      semanticSearchTopK: 5,
      includeMemoryContext: true,
      excludeSensitive: true,
    },
  },
  channels: {},
  messages: {
    offlineQueue: {
      enabled: true,
      maxSize: 200,
      maxAgeMs: 15 * 60 * 1000,
      retryIntervalMs: 5000,
      maxRetries: 10,
    },
  },
  feeds: {
    polymarket: { enabled: true, rtds: { enabled: false } },
    kalshi: { enabled: true },
    manifold: { enabled: true },
    metaculus: { enabled: true },
    drift: { enabled: false },
    news: { enabled: false },
  },
  solana: {},
  browser: {
    enabled: true,
    headless: true,
  },
  tts: {
    enabled: false,
    provider: 'elevenlabs',
  },
  cron: {
    enabled: true,
    jobs: [],
  },
  plugins: {
    enabled: true,
    autoEnable: [],
    disabled: [],
  },
  logging: {
    level: 'info',
    file: true,
    json: false,
  },
  http: {
    enabled: true,
    defaultRateLimit: { maxRequests: 60, windowMs: 60_000 },
    perHost: {},
    retry: {
      enabled: true,
      maxAttempts: 3,
      minDelay: 500,
      maxDelay: 30_000,
      jitter: 0.1,
      backoffMultiplier: 2,
      methods: ['GET', 'HEAD', 'OPTIONS'],
    },
  },
  positions: {
    enabled: true,
    priceUpdateIntervalMs: 5 * 60 * 1000,
    pnlSnapshotsEnabled: true,
    pnlHistoryDays: 90,
  },
  monitoring: {
    enabled: true,
    cooldownMs: 5 * 60 * 1000,
    alertTargets: [],
    email: {
      enabled: false,
      subjectPrefix: 'Clodds',
    },
    providerHealth: {
      enabled: true,
      alertAfterFailures: 3,
      alertOnRecovery: true,
      cooldownMs: 10 * 60 * 1000,
    },
    errors: {
      enabled: true,
      cooldownMs: 5 * 60 * 1000,
      includeStack: true,
    },
    systemHealth: {
      enabled: false,
      intervalMs: 60 * 1000,
      memoryWarnPct: 85,
      diskWarnPct: 90,
      cooldownMs: 30 * 60 * 1000,
    },
  },
  bittensor: {
    enabled: false,
    network: 'mainnet',
  },
};

// =============================================================================
// ENV SUBSTITUTION
// =============================================================================

/** Environment variables that can be used in config */
const ENV_MAPPINGS: Record<string, (cfg: CloddsConfig) => void> = {
  ANTHROPIC_API_KEY: () => {}, // Used directly by agent
  OPENAI_API_KEY: () => {},
  ELEVENLABS_API_KEY: (cfg) => {
    if (cfg.tts) cfg.tts.apiKey = process.env.ELEVENLABS_API_KEY;
  },
  TELEGRAM_BOT_TOKEN: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.telegram) cfg.channels.telegram = {};
    cfg.channels.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
  },
  DISCORD_BOT_TOKEN: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.discord) cfg.channels.discord = {};
    cfg.channels.discord.token = process.env.DISCORD_BOT_TOKEN;
  },
  DISCORD_APP_ID: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.discord) cfg.channels.discord = {};
    cfg.channels.discord.appId = process.env.DISCORD_APP_ID;
  },
  WEBCHAT_TOKEN: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.webchat) cfg.channels.webchat = {};
    cfg.channels.webchat.authToken = process.env.WEBCHAT_TOKEN;
  },
  POSITIONS_PRICE_UPDATE_INTERVAL_MS: (cfg) => {
    if (!cfg.positions) cfg.positions = {};
    const raw = process.env.POSITIONS_PRICE_UPDATE_INTERVAL_MS;
    if (raw) cfg.positions.priceUpdateIntervalMs = Number.parseInt(raw, 10);
  },
  POSITIONS_PRICE_UPDATE_ENABLED: (cfg) => {
    if (!cfg.positions) cfg.positions = {};
    const raw = process.env.POSITIONS_PRICE_UPDATE_ENABLED;
    if (raw) cfg.positions.enabled = raw === '1' || raw.toLowerCase() === 'true';
  },
  POSITIONS_PNL_SNAPSHOTS_ENABLED: (cfg) => {
    if (!cfg.positions) cfg.positions = {};
    const raw = process.env.POSITIONS_PNL_SNAPSHOTS_ENABLED;
    if (raw) cfg.positions.pnlSnapshotsEnabled = raw === '1' || raw.toLowerCase() === 'true';
  },
  POSITIONS_PNL_HISTORY_DAYS: (cfg) => {
    if (!cfg.positions) cfg.positions = {};
    const raw = process.env.POSITIONS_PNL_HISTORY_DAYS;
    if (raw) cfg.positions.pnlHistoryDays = Number.parseInt(raw, 10);
  },
  SESSION_CLEANUP_ENABLED: (cfg) => {
    if (!cfg.session) cfg.session = {};
    if (!cfg.session.cleanup) cfg.session.cleanup = {};
    const raw = process.env.SESSION_CLEANUP_ENABLED;
    if (raw) cfg.session.cleanup.enabled = raw === '1' || raw.toLowerCase() === 'true';
  },
  SESSION_CLEANUP_MAX_AGE_DAYS: (cfg) => {
    if (!cfg.session) cfg.session = {};
    if (!cfg.session.cleanup) cfg.session.cleanup = {};
    const raw = process.env.SESSION_CLEANUP_MAX_AGE_DAYS;
    if (raw) cfg.session.cleanup.maxAgeDays = Number.parseInt(raw, 10);
  },
  SESSION_CLEANUP_IDLE_DAYS: (cfg) => {
    if (!cfg.session) cfg.session = {};
    if (!cfg.session.cleanup) cfg.session.cleanup = {};
    const raw = process.env.SESSION_CLEANUP_IDLE_DAYS;
    if (raw) cfg.session.cleanup.idleDays = Number.parseInt(raw, 10);
  },
  MARKET_CACHE_ENABLED: (cfg) => {
    if (!cfg.marketCache) cfg.marketCache = {};
    const raw = process.env.MARKET_CACHE_ENABLED;
    if (raw) cfg.marketCache.enabled = raw === '1' || raw.toLowerCase() === 'true';
  },
  MARKET_CACHE_TTL_MS: (cfg) => {
    if (!cfg.marketCache) cfg.marketCache = {};
    const raw = process.env.MARKET_CACHE_TTL_MS;
    if (raw) cfg.marketCache.ttlMs = Number.parseInt(raw, 10);
  },
  MARKET_CACHE_CLEANUP_INTERVAL_MS: (cfg) => {
    if (!cfg.marketCache) cfg.marketCache = {};
    const raw = process.env.MARKET_CACHE_CLEANUP_INTERVAL_MS;
    if (raw) cfg.marketCache.cleanupIntervalMs = Number.parseInt(raw, 10);
  },
  MARKET_INDEX_ENABLED: (cfg) => {
    if (!cfg.marketIndex) cfg.marketIndex = {};
    const raw = process.env.MARKET_INDEX_ENABLED;
    if (raw) cfg.marketIndex.enabled = raw === '1' || raw.toLowerCase() === 'true';
  },
  MARKET_INDEX_SYNC_INTERVAL_MS: (cfg) => {
    if (!cfg.marketIndex) cfg.marketIndex = {};
    const raw = process.env.MARKET_INDEX_SYNC_INTERVAL_MS;
    if (raw) cfg.marketIndex.syncIntervalMs = Number.parseInt(raw, 10);
  },
  MARKET_INDEX_STALE_AFTER_MS: (cfg) => {
    if (!cfg.marketIndex) cfg.marketIndex = {};
    const raw = process.env.MARKET_INDEX_STALE_AFTER_MS;
    if (raw) cfg.marketIndex.staleAfterMs = Number.parseInt(raw, 10);
  },
  MARKET_INDEX_LIMIT_PER_PLATFORM: (cfg) => {
    if (!cfg.marketIndex) cfg.marketIndex = {};
    const raw = process.env.MARKET_INDEX_LIMIT_PER_PLATFORM;
    if (raw) cfg.marketIndex.limitPerPlatform = Number.parseInt(raw, 10);
  },
  MARKET_INDEX_STATUS: (cfg) => {
    if (!cfg.marketIndex) cfg.marketIndex = {};
    const raw = process.env.MARKET_INDEX_STATUS;
    if (raw) cfg.marketIndex.status = raw as MarketIndexConfig['status'];
  },
  MARKET_INDEX_EXCLUDE_SPORTS: (cfg) => {
    if (!cfg.marketIndex) cfg.marketIndex = {};
    const raw = process.env.MARKET_INDEX_EXCLUDE_SPORTS;
    if (raw) cfg.marketIndex.excludeSports = raw === '1' || raw.toLowerCase() === 'true';
  },
  MARKET_INDEX_PLATFORMS: (cfg) => {
    if (!cfg.marketIndex) cfg.marketIndex = {};
    const raw = process.env.MARKET_INDEX_PLATFORMS;
    if (raw) {
      cfg.marketIndex.platforms = raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean) as MarketIndexConfig['platforms'];
    }
  },
  MARKET_INDEX_MIN_VOLUME_24H: (cfg) => {
    if (!cfg.marketIndex) cfg.marketIndex = {};
    const raw = process.env.MARKET_INDEX_MIN_VOLUME_24H;
    if (raw) cfg.marketIndex.minVolume24h = Number.parseFloat(raw);
  },
  MARKET_INDEX_MIN_LIQUIDITY: (cfg) => {
    if (!cfg.marketIndex) cfg.marketIndex = {};
    const raw = process.env.MARKET_INDEX_MIN_LIQUIDITY;
    if (raw) cfg.marketIndex.minLiquidity = Number.parseFloat(raw);
  },
  MARKET_INDEX_MIN_OPEN_INTEREST: (cfg) => {
    if (!cfg.marketIndex) cfg.marketIndex = {};
    const raw = process.env.MARKET_INDEX_MIN_OPEN_INTEREST;
    if (raw) cfg.marketIndex.minOpenInterest = Number.parseFloat(raw);
  },
  MARKET_INDEX_MIN_PREDICTIONS: (cfg) => {
    if (!cfg.marketIndex) cfg.marketIndex = {};
    const raw = process.env.MARKET_INDEX_MIN_PREDICTIONS;
    if (raw) cfg.marketIndex.minPredictions = Number.parseInt(raw, 10);
  },
  MARKET_INDEX_EXCLUDE_RESOLVED: (cfg) => {
    if (!cfg.marketIndex) cfg.marketIndex = {};
    const raw = process.env.MARKET_INDEX_EXCLUDE_RESOLVED;
    if (raw) cfg.marketIndex.excludeResolved = raw === '1' || raw.toLowerCase() === 'true';
  },
  MARKET_INDEX_PLATFORM_WEIGHTS: (cfg) => {
    if (!cfg.marketIndex) cfg.marketIndex = {};
    const raw = process.env.MARKET_INDEX_PLATFORM_WEIGHTS;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, number>;
      cfg.marketIndex.platformWeights = parsed as MarketIndexConfig['platformWeights'];
    } catch (error) {
      logger.warn({ error }, 'Failed to parse MARKET_INDEX_PLATFORM_WEIGHTS');
    }
  },
  MEMORY_AUTO_ENABLED: (cfg) => {
    if (!cfg.memory) cfg.memory = {};
    if (!cfg.memory.auto) cfg.memory.auto = {};
    const raw = process.env.MEMORY_AUTO_ENABLED;
    if (raw) cfg.memory.auto.enabled = raw === '1' || raw.toLowerCase() === 'true';
  },
  MEMORY_AUTO_SCOPE: (cfg) => {
    if (!cfg.memory) cfg.memory = {};
    if (!cfg.memory.auto) cfg.memory.auto = {};
    const raw = process.env.MEMORY_AUTO_SCOPE;
    if (raw === 'user' || raw === 'channel') cfg.memory.auto.scope = raw;
  },
  MEMORY_AUTO_MIN_INTERVAL_MS: (cfg) => {
    if (!cfg.memory) cfg.memory = {};
    if (!cfg.memory.auto) cfg.memory.auto = {};
    const raw = process.env.MEMORY_AUTO_MIN_INTERVAL_MS;
    if (raw) cfg.memory.auto.minIntervalMs = Number.parseInt(raw, 10);
  },
  MEMORY_AUTO_MAX_ITEMS_PER_TYPE: (cfg) => {
    if (!cfg.memory) cfg.memory = {};
    if (!cfg.memory.auto) cfg.memory.auto = {};
    const raw = process.env.MEMORY_AUTO_MAX_ITEMS_PER_TYPE;
    if (raw) cfg.memory.auto.maxItemsPerType = Number.parseInt(raw, 10);
  },
  MEMORY_AUTO_PROFILE_UPDATE_EVERY: (cfg) => {
    if (!cfg.memory) cfg.memory = {};
    if (!cfg.memory.auto) cfg.memory.auto = {};
    const raw = process.env.MEMORY_AUTO_PROFILE_UPDATE_EVERY;
    if (raw) cfg.memory.auto.profileUpdateEvery = Number.parseInt(raw, 10);
  },
  MEMORY_AUTO_SEMANTIC_TOPK: (cfg) => {
    if (!cfg.memory) cfg.memory = {};
    if (!cfg.memory.auto) cfg.memory.auto = {};
    const raw = process.env.MEMORY_AUTO_SEMANTIC_TOPK;
    if (raw) cfg.memory.auto.semanticSearchTopK = Number.parseInt(raw, 10);
  },
  MEMORY_AUTO_INCLUDE_CONTEXT: (cfg) => {
    if (!cfg.memory) cfg.memory = {};
    if (!cfg.memory.auto) cfg.memory.auto = {};
    const raw = process.env.MEMORY_AUTO_INCLUDE_CONTEXT;
    if (raw) cfg.memory.auto.includeMemoryContext = raw === '1' || raw.toLowerCase() === 'true';
  },
  MEMORY_AUTO_EXCLUDE_SENSITIVE: (cfg) => {
    if (!cfg.memory) cfg.memory = {};
    if (!cfg.memory.auto) cfg.memory.auto = {};
    const raw = process.env.MEMORY_AUTO_EXCLUDE_SENSITIVE;
    if (raw) cfg.memory.auto.excludeSensitive = raw === '1' || raw.toLowerCase() === 'true';
  },
  SLACK_BOT_TOKEN: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.slack) cfg.channels.slack = {};
    cfg.channels.slack.botToken = process.env.SLACK_BOT_TOKEN;
  },
  SLACK_APP_TOKEN: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.slack) cfg.channels.slack = {};
    cfg.channels.slack.appToken = process.env.SLACK_APP_TOKEN;
  },
  X_BEARER_TOKEN: (cfg) => {
    if (!cfg.feeds) cfg.feeds = {};
    if (!cfg.feeds.news) cfg.feeds.news = { enabled: true };
    if (!cfg.feeds.news.twitter) cfg.feeds.news.twitter = { accounts: [] };
    cfg.feeds.news.twitter.bearerToken = process.env.X_BEARER_TOKEN;
  },
  TWITTER_BEARER_TOKEN: (cfg) => {
    if (!cfg.feeds) cfg.feeds = {};
    if (!cfg.feeds.news) cfg.feeds.news = { enabled: true };
    if (!cfg.feeds.news.twitter) cfg.feeds.news.twitter = { accounts: [] };
    cfg.feeds.news.twitter.bearerToken = process.env.TWITTER_BEARER_TOKEN;
  },
  SOLANA_RPC_URL: (cfg) => {
    if (!cfg.solana) cfg.solana = {};
    cfg.solana.rpcUrl = process.env.SOLANA_RPC_URL;
  },
  SOLANA_PRIVATE_KEY: (cfg) => {
    if (!cfg.solana) cfg.solana = {};
    cfg.solana.privateKey = process.env.SOLANA_PRIVATE_KEY;
  },
  SOLANA_KEYPAIR_PATH: (cfg) => {
    if (!cfg.solana) cfg.solana = {};
    cfg.solana.keypairPath = process.env.SOLANA_KEYPAIR_PATH;
  },
  TEAMS_APP_ID: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.teams) cfg.channels.teams = {};
    cfg.channels.teams.appId = process.env.TEAMS_APP_ID;
  },
  TEAMS_APP_PASSWORD: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.teams) cfg.channels.teams = {};
    cfg.channels.teams.appPassword = process.env.TEAMS_APP_PASSWORD;
  },
  MATRIX_HOMESERVER_URL: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.matrix) cfg.channels.matrix = {};
    cfg.channels.matrix.homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
  },
  MATRIX_ACCESS_TOKEN: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.matrix) cfg.channels.matrix = {};
    cfg.channels.matrix.accessToken = process.env.MATRIX_ACCESS_TOKEN;
  },
  MATRIX_USER_ID: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.matrix) cfg.channels.matrix = {};
    cfg.channels.matrix.userId = process.env.MATRIX_USER_ID;
  },
  SIGNAL_PHONE_NUMBER: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.signal) cfg.channels.signal = {};
    cfg.channels.signal.phoneNumber = process.env.SIGNAL_PHONE_NUMBER;
  },
  SIGNAL_CLI_PATH: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.signal) cfg.channels.signal = {};
    cfg.channels.signal.signalCliPath = process.env.SIGNAL_CLI_PATH;
  },
  SIGNAL_CONFIG_DIR: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.signal) cfg.channels.signal = {};
    cfg.channels.signal.configDir = process.env.SIGNAL_CONFIG_DIR;
  },
  IMESSAGE_ENABLED: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.imessage) cfg.channels.imessage = {};
    cfg.channels.imessage.enabled = process.env.IMESSAGE_ENABLED === '1';
  },
  IMESSAGE_POLL_INTERVAL: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.imessage) cfg.channels.imessage = {};
    const value = process.env.IMESSAGE_POLL_INTERVAL;
    if (value) cfg.channels.imessage.pollInterval = Number.parseInt(value, 10);
  },
  LINE_CHANNEL_ACCESS_TOKEN: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.line) cfg.channels.line = {};
    cfg.channels.line.channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  },
  LINE_CHANNEL_SECRET: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.line) cfg.channels.line = {};
    cfg.channels.line.channelSecret = process.env.LINE_CHANNEL_SECRET;
  },
  LINE_WEBHOOK_PORT: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.line) cfg.channels.line = {};
    const value = process.env.LINE_WEBHOOK_PORT;
    if (value) cfg.channels.line.webhookPort = Number.parseInt(value, 10);
  },
  LINE_WEBHOOK_PATH: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.line) cfg.channels.line = {};
    cfg.channels.line.webhookPath = process.env.LINE_WEBHOOK_PATH;
  },
  GOOGLECHAT_CREDENTIALS_PATH: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.googlechat) cfg.channels.googlechat = {};
    cfg.channels.googlechat.credentialsPath = process.env.GOOGLECHAT_CREDENTIALS_PATH;
  },
  GOOGLECHAT_CLIENT_EMAIL: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.googlechat) cfg.channels.googlechat = {};
    if (!cfg.channels.googlechat.credentials) cfg.channels.googlechat.credentials = {
      client_email: '',
      private_key: '',
      project_id: '',
    };
    cfg.channels.googlechat.credentials.client_email = process.env.GOOGLECHAT_CLIENT_EMAIL || '';
  },
  GOOGLECHAT_PRIVATE_KEY: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.googlechat) cfg.channels.googlechat = {};
    if (!cfg.channels.googlechat.credentials) cfg.channels.googlechat.credentials = {
      client_email: '',
      private_key: '',
      project_id: '',
    };
    cfg.channels.googlechat.credentials.private_key = process.env.GOOGLECHAT_PRIVATE_KEY || '';
  },
  GOOGLECHAT_PROJECT_ID: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.googlechat) cfg.channels.googlechat = {};
    if (!cfg.channels.googlechat.credentials) cfg.channels.googlechat.credentials = {
      client_email: '',
      private_key: '',
      project_id: '',
    };
    cfg.channels.googlechat.credentials.project_id = process.env.GOOGLECHAT_PROJECT_ID || '';
  },
  CLODDS_GATEWAY_TOKEN: (cfg) => {
    if (!cfg.gateway) cfg.gateway = {};
    if (!cfg.gateway.auth) cfg.gateway.auth = {};
    cfg.gateway.auth.token = process.env.CLODDS_GATEWAY_TOKEN;
    cfg.gateway.auth.mode = 'token';
  },
  CLODDS_GATEWAY_PASSWORD: (cfg) => {
    if (!cfg.gateway) cfg.gateway = {};
    if (!cfg.gateway.auth) cfg.gateway.auth = {};
    cfg.gateway.auth.password = process.env.CLODDS_GATEWAY_PASSWORD;
    cfg.gateway.auth.mode = 'password';
  },
  BITTENSOR_ENABLED: (cfg) => {
    if (!cfg.bittensor) cfg.bittensor = {};
    const raw = process.env.BITTENSOR_ENABLED;
    if (raw) cfg.bittensor.enabled = raw === '1' || raw.toLowerCase() === 'true';
  },
  BITTENSOR_NETWORK: (cfg) => {
    if (!cfg.bittensor) cfg.bittensor = {};
    const raw = process.env.BITTENSOR_NETWORK;
    if (raw === 'mainnet' || raw === 'testnet' || raw === 'local') cfg.bittensor.network = raw;
  },
  BITTENSOR_SUBTENSOR_URL: (cfg) => {
    if (!cfg.bittensor) cfg.bittensor = {};
    cfg.bittensor.subtensorUrl = process.env.BITTENSOR_SUBTENSOR_URL;
  },
  BITTENSOR_COLDKEY_PATH: (cfg) => {
    if (!cfg.bittensor) cfg.bittensor = {};
    cfg.bittensor.coldkeyPath = process.env.BITTENSOR_COLDKEY_PATH;
  },
  BITTENSOR_COLDKEY_PASSWORD: (cfg) => {
    if (!cfg.bittensor) cfg.bittensor = {};
    cfg.bittensor.coldkeyPassword = process.env.BITTENSOR_COLDKEY_PASSWORD;
  },
  BITTENSOR_PYTHON_PATH: (cfg) => {
    if (!cfg.bittensor) cfg.bittensor = {};
    cfg.bittensor.pythonPath = process.env.BITTENSOR_PYTHON_PATH;
  },
  BITTENSOR_EARNINGS_POLL_INTERVAL_MS: (cfg) => {
    if (!cfg.bittensor) cfg.bittensor = {};
    const raw = process.env.BITTENSOR_EARNINGS_POLL_INTERVAL_MS;
    if (raw) cfg.bittensor.earningsPollIntervalMs = Number.parseInt(raw, 10);
  },
  CLODDS_GROUP_POLICIES: (cfg) => {
    if (!process.env.CLODDS_GROUP_POLICIES) return;
    try {
      const parsed = JSON.parse(process.env.CLODDS_GROUP_POLICIES) as Record<string, unknown>;
      if (!cfg.channels) cfg.channels = {};
      for (const [channel, value] of Object.entries(parsed)) {
        if (!value || typeof value !== 'object') continue;
        const channelConfig = (cfg.channels as Record<string, any>)[channel] || {};
        channelConfig.groups = value as Record<string, { requireMention?: boolean }>;
        (cfg.channels as Record<string, any>)[channel] = channelConfig;
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to parse CLODDS_GROUP_POLICIES');
    }
  },
};

/** Apply environment variable overrides */
function applyEnvOverrides(cfg: CloddsConfig): CloddsConfig {
  for (const [envKey, applier] of Object.entries(ENV_MAPPINGS)) {
    if (process.env[envKey]) {
      applier(cfg);
    }
  }
  return cfg;
}

/** Substitute ${VAR} patterns in config values */
function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, varName) => {
      const value = process.env[varName];
      if (value === undefined) {
        logger.warn({ varName }, 'Missing environment variable in config');
        return '';
      }
      return value;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVars);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVars(value);
    }
    return result;
  }
  return obj;
}

// =============================================================================
// LOADING
// =============================================================================

/** Parse JSON5 (with comments, trailing commas) */
function parseJson5(text: string): unknown {
  // Simple JSON5 parser - handle comments and trailing commas
  let cleaned = text
    .replace(/\/\*[\s\S]*?\*\//g, '') // Block comments
    .replace(/\/\/.*$/gm, '') // Line comments
    .replace(/,(\s*[}\]])/g, '$1'); // Trailing commas

  // Handle unquoted keys
  cleaned = cleaned.replace(/(\s*)(\w+)(\s*):/g, '$1"$2"$3:');

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to strict JSON
    return JSON.parse(text);
  }
}

/** Deep merge configs */
function deepMerge(target: CloddsConfig, source: CloddsConfig): CloddsConfig {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof CloddsConfig>) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
      if (targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)) {
        result[key] = { ...targetVal, ...sourceVal } as typeof result[typeof key];
      } else {
        result[key] = sourceVal as typeof result[typeof key];
      }
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as typeof result[typeof key];
    }
  }

  return result;
}

/** Load config from file */
export function loadConfig(configPath = CONFIG_PATH): CloddsConfig {
  let userConfig: CloddsConfig = {};

  // Ensure state dir exists
  const stateDir = resolveStateDir();
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  // Load config file if exists
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = parseJson5(raw);
      userConfig = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        ? parsed as CloddsConfig
        : {};
      logger.debug({ configPath }, 'Config loaded');
    } catch (error) {
      logger.error({ configPath, error }, 'Failed to load config');
    }
  }

  // Substitute env vars in config values
  userConfig = substituteEnvVars(userConfig) as CloddsConfig;

  // Merge with defaults
  let config = deepMerge(DEFAULT_CONFIG, userConfig);

  // Apply environment overrides
  config = applyEnvOverrides(config);

  return config;
}

/** Load config and return raw snapshot */
export function loadConfigSnapshot(configPath = CONFIG_PATH): { config: CloddsConfig; raw: string | null; hash: string } {
  let raw: string | null = null;

  if (existsSync(configPath)) {
    raw = readFileSync(configPath, 'utf-8');
  }

  const config = loadConfig(configPath);
  const hash = createHash('sha256').update(raw || '').digest('hex');

  return { config, raw, hash };
}

// =============================================================================
// SAVING
// =============================================================================

const CONFIG_BACKUP_COUNT = 5;

/** Rotate config backups */
function rotateBackups(configPath: string): void {
  const backupBase = `${configPath}.bak`;

  // Delete oldest
  try {
    unlinkSync(`${backupBase}.${CONFIG_BACKUP_COUNT - 1}`);
  } catch {}

  // Shift backups
  for (let i = CONFIG_BACKUP_COUNT - 2; i >= 1; i--) {
    try {
      renameSync(`${backupBase}.${i}`, `${backupBase}.${i + 1}`);
    } catch {}
  }

  // Move current backup
  try {
    renameSync(backupBase, `${backupBase}.1`);
  } catch {}
}

/** Save config to file */
export function saveConfig(config: CloddsConfig, configPath = CONFIG_PATH): void {
  // Ensure directory exists
  const dir = resolve(configPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Backup existing config
  if (existsSync(configPath)) {
    try {
      const existing = readFileSync(configPath, 'utf-8');
      writeFileSync(`${configPath}.bak`, existing);
      rotateBackups(configPath);
    } catch {}
  }

  // Stamp version
  const stamped: CloddsConfig = {
    ...config,
    meta: {
      ...config.meta,
      lastTouchedVersion: readPackageVersion(),
      lastTouchedAt: new Date().toISOString(),
    },
  };

  // Write config
  const content = JSON.stringify(stamped, null, 2);
  writeFileSync(configPath, content, 'utf-8');
  logger.info({ configPath }, 'Config saved');
}

// =============================================================================
// VALIDATION
// =============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/** Validate config structure */
export function validateConfig(config: CloddsConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
  const whatsappPolicies = ['open', 'allowlist', 'pairing', 'disabled'] as const;

  const validateAllowFrom = (path: string, allowFrom: unknown): void => {
    if (!Array.isArray(allowFrom)) {
      errors.push({ path, message: 'allowFrom must be an array of strings' });
      return;
    }
    allowFrom.forEach((entry, idx) => {
      if (typeof entry !== 'string') {
        errors.push({ path: `${path}[${idx}]`, message: 'allowFrom entries must be strings' });
      }
    });
  };

  const validateGroups = (path: string, groups: unknown): void => {
    if (!isRecord(groups)) {
      errors.push({ path, message: 'groups must be an object' });
      return;
    }
    for (const [groupId, groupConfig] of Object.entries(groups)) {
      const groupPath = `${path}.${groupId}`;
      if (!isRecord(groupConfig)) {
        errors.push({ path: groupPath, message: 'group config must be an object' });
        continue;
      }
      if (
        groupConfig.requireMention !== undefined &&
        typeof groupConfig.requireMention !== 'boolean'
      ) {
        errors.push({
          path: `${groupPath}.requireMention`,
          message: 'requireMention must be a boolean',
        });
      }
    }
  };

  // Validate gateway
  if (config.gateway?.port !== undefined) {
    if (typeof config.gateway.port !== 'number' || config.gateway.port < 1 || config.gateway.port > 65535) {
      errors.push({ path: 'gateway.port', message: 'Port must be a number between 1 and 65535' });
    }
  }

  if (config.gateway?.bind && !['loopback', 'all'].includes(config.gateway.bind)) {
    errors.push({ path: 'gateway.bind', message: 'Bind must be "loopback" or "all"' });
  }

  // Validate agent
  if (config.agent?.thinkingLevel && !['off', 'minimal', 'low', 'medium', 'high'].includes(config.agent.thinkingLevel)) {
    errors.push({ path: 'agent.thinkingLevel', message: 'Invalid thinking level' });
  }

  // Validate logging
  if (config.logging?.level && !['debug', 'info', 'warn', 'error'].includes(config.logging.level)) {
    errors.push({ path: 'logging.level', message: 'Invalid log level' });
  }

  // Validate WhatsApp channel config
  const whatsapp = config.channels?.whatsapp;
  if (whatsapp) {
    if (whatsapp.dmPolicy && !whatsappPolicies.includes(whatsapp.dmPolicy)) {
      errors.push({ path: 'channels.whatsapp.dmPolicy', message: 'Invalid dmPolicy value' });
    }

    if (whatsapp.allowFrom !== undefined) {
      validateAllowFrom('channels.whatsapp.allowFrom', whatsapp.allowFrom);
    }

    if (
      whatsapp.requireMentionInGroups !== undefined &&
      typeof whatsapp.requireMentionInGroups !== 'boolean'
    ) {
      errors.push({
        path: 'channels.whatsapp.requireMentionInGroups',
        message: 'requireMentionInGroups must be a boolean',
      });
    }

    if (whatsapp.groups !== undefined) {
      validateGroups('channels.whatsapp.groups', whatsapp.groups);
    }

    if (whatsapp.accounts !== undefined) {
      if (!isRecord(whatsapp.accounts)) {
        errors.push({ path: 'channels.whatsapp.accounts', message: 'accounts must be an object' });
      } else {
        for (const [accountId, accountConfig] of Object.entries(whatsapp.accounts)) {
          const accountPath = `channels.whatsapp.accounts.${accountId}`;
          if (!isRecord(accountConfig)) {
            errors.push({ path: accountPath, message: 'account config must be an object' });
            continue;
          }

          if (accountConfig.dmPolicy && !whatsappPolicies.includes(accountConfig.dmPolicy as any)) {
            errors.push({ path: `${accountPath}.dmPolicy`, message: 'Invalid dmPolicy value' });
          }

          if (accountConfig.allowFrom !== undefined) {
            validateAllowFrom(`${accountPath}.allowFrom`, accountConfig.allowFrom);
          }

          if (
            accountConfig.requireMentionInGroups !== undefined &&
            typeof accountConfig.requireMentionInGroups !== 'boolean'
          ) {
            errors.push({
              path: `${accountPath}.requireMentionInGroups`,
              message: 'requireMentionInGroups must be a boolean',
            });
          }

          if (accountConfig.groups !== undefined) {
            validateGroups(`${accountPath}.groups`, accountConfig.groups);
          }
        }
      }
    }

    if (whatsapp.defaultAccountId !== undefined) {
      const accounts = whatsapp.accounts;
      if (!accounts || !isRecord(accounts) || !accounts[whatsapp.defaultAccountId]) {
        errors.push({
          path: 'channels.whatsapp.defaultAccountId',
          message: 'defaultAccountId must reference an account in channels.whatsapp.accounts',
        });
      } else if (
        isRecord(accounts[whatsapp.defaultAccountId]) &&
        (accounts[whatsapp.defaultAccountId] as Record<string, unknown>).enabled === false
      ) {
        errors.push({
          path: 'channels.whatsapp.defaultAccountId',
          message: 'defaultAccountId references a disabled account',
        });
      }
    }
  }

  // Validate feeds (RTDS)
  const rtds = config.feeds?.polymarket?.rtds;
  if (rtds) {
    if (rtds.enabled && config.feeds?.polymarket?.enabled === false) {
      errors.push({
        path: 'feeds.polymarket.rtds.enabled',
        message: 'RTDS requires feeds.polymarket.enabled to be true',
      });
    }

    if (rtds.url !== undefined && typeof rtds.url !== 'string') {
      errors.push({ path: 'feeds.polymarket.rtds.url', message: 'RTDS url must be a string' });
    }

    if (rtds.pingIntervalMs !== undefined) {
      if (typeof rtds.pingIntervalMs !== 'number' || rtds.pingIntervalMs <= 0) {
        errors.push({
          path: 'feeds.polymarket.rtds.pingIntervalMs',
          message: 'RTDS pingIntervalMs must be a positive number',
        });
      }
    }

    if (rtds.reconnectDelayMs !== undefined) {
      if (typeof rtds.reconnectDelayMs !== 'number' || rtds.reconnectDelayMs <= 0) {
        errors.push({
          path: 'feeds.polymarket.rtds.reconnectDelayMs',
          message: 'RTDS reconnectDelayMs must be a positive number',
        });
      }
    }

    if (rtds.subscriptions !== undefined) {
      if (!Array.isArray(rtds.subscriptions)) {
        errors.push({
          path: 'feeds.polymarket.rtds.subscriptions',
          message: 'RTDS subscriptions must be an array',
        });
      } else {
        const allowedTopics = ['crypto_prices', 'crypto_prices_chainlink', 'comments'];
        rtds.subscriptions.forEach((sub, idx) => {
          if (!sub || typeof sub !== 'object') {
            errors.push({
              path: `feeds.polymarket.rtds.subscriptions[${idx}]`,
              message: 'Subscription must be an object',
            });
            return;
          }

          if (!allowedTopics.includes(sub.topic)) {
            errors.push({
              path: `feeds.polymarket.rtds.subscriptions[${idx}].topic`,
              message: 'Invalid RTDS topic',
            });
          }

          if (typeof sub.type !== 'string' || sub.type.length === 0) {
            errors.push({
              path: `feeds.polymarket.rtds.subscriptions[${idx}].type`,
              message: 'Subscription type must be a non-empty string',
            });
          }

          if (sub.filters !== undefined && typeof sub.filters !== 'string') {
            errors.push({
              path: `feeds.polymarket.rtds.subscriptions[${idx}].filters`,
              message: 'Subscription filters must be a string',
            });
          }

          if (sub.gammaAuthAddress !== undefined && typeof sub.gammaAuthAddress !== 'string') {
            errors.push({
              path: `feeds.polymarket.rtds.subscriptions[${idx}].gammaAuthAddress`,
              message: 'gammaAuthAddress must be a string',
            });
          }

          if (sub.clobAuth !== undefined) {
            if (typeof sub.clobAuth !== 'object' || sub.clobAuth === null) {
              errors.push({
                path: `feeds.polymarket.rtds.subscriptions[${idx}].clobAuth`,
                message: 'clobAuth must be an object',
              });
            } else {
              if (typeof sub.clobAuth.key !== 'string' || sub.clobAuth.key.length === 0) {
                errors.push({
                  path: `feeds.polymarket.rtds.subscriptions[${idx}].clobAuth.key`,
                  message: 'clobAuth.key must be a non-empty string',
                });
              }
              if (typeof sub.clobAuth.secret !== 'string' || sub.clobAuth.secret.length === 0) {
                errors.push({
                  path: `feeds.polymarket.rtds.subscriptions[${idx}].clobAuth.secret`,
                  message: 'clobAuth.secret must be a non-empty string',
                });
              }
              if (typeof sub.clobAuth.passphrase !== 'string' || sub.clobAuth.passphrase.length === 0) {
                errors.push({
                  path: `feeds.polymarket.rtds.subscriptions[${idx}].clobAuth.passphrase`,
                  message: 'clobAuth.passphrase must be a non-empty string',
                });
              }
            }
          }
        });
      }
    }
  }

  // Validate Kalshi feed auth config
  const kalshi = config.feeds?.kalshi;
  if (kalshi?.enabled) {
    const hasApiKey = Boolean(kalshi.apiKeyId);
    const hasPrivateKey = Boolean(kalshi.privateKeyPem || kalshi.privateKeyPath);
    const hasLegacy = Boolean(kalshi.email || kalshi.password);

    if (hasApiKey && !hasPrivateKey) {
      errors.push({
        path: 'feeds.kalshi.privateKeyPem',
        message: 'Kalshi API key auth requires privateKeyPem or privateKeyPath',
      });
    }

    if ((kalshi.privateKeyPem || kalshi.privateKeyPath) && !hasApiKey) {
      errors.push({
        path: 'feeds.kalshi.apiKeyId',
        message: 'Kalshi private key requires apiKeyId',
      });
    }

    if (hasLegacy && !(kalshi.email && kalshi.password)) {
      errors.push({
        path: 'feeds.kalshi.email',
        message: 'Legacy Kalshi auth requires both email and password',
      });
    }
  }

  return errors;
}

// =============================================================================
// CONFIG SERVICE
// =============================================================================

export interface ConfigService {
  /** Get current config */
  get(): CloddsConfig;
  /** Get a specific config value */
  getValue<T>(path: string): T | undefined;
  /** Set a config value */
  setValue(path: string, value: unknown): void;
  /** Reload config from file */
  reload(): CloddsConfig;
  /** Save current config to file */
  save(): void;
  /** Get config hash */
  getHash(): string;
  /** Watch for config changes */
  watch(callback: (config: CloddsConfig) => void): () => void;
}

export function createConfigService(configPath = CONFIG_PATH): ConfigService {
  let { config, hash } = loadConfigSnapshot(configPath);
  const watchers: Array<(config: CloddsConfig) => void> = [];

  return {
    get() {
      return config;
    },

    getValue<T>(path: string): T | undefined {
      const parts = path.split('.');
      let current: unknown = config;

      for (const part of parts) {
        if (current && typeof current === 'object') {
          current = (current as Record<string, unknown>)[part];
        } else {
          return undefined;
        }
      }

      return current as T;
    },

    setValue(path: string, value: unknown) {
      const parts = path.split('.');
      let current: unknown = config;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const obj = current as Record<string, unknown>;
        if (!obj[part] || typeof obj[part] !== 'object') {
          obj[part] = {};
        }
        current = obj[part];
      }

      (current as Record<string, unknown>)[parts[parts.length - 1]] = value;
    },

    reload() {
      const snapshot = loadConfigSnapshot(configPath);
      config = snapshot.config;
      hash = snapshot.hash;

      for (const watcher of watchers) {
        watcher(config);
      }

      return config;
    },

    save() {
      saveConfig(config, configPath);
      hash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    },

    getHash() {
      return hash;
    },

    watch(callback) {
      watchers.push(callback);
      return () => {
        const idx = watchers.indexOf(callback);
        if (idx >= 0) watchers.splice(idx, 1);
      };
    },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export { deepMerge, parseJson5, substituteEnvVars };
