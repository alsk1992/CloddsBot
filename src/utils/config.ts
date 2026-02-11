/**
 * Configuration loading and management
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import JSON5 from 'json5';
import { config as dotenvConfig } from 'dotenv';
import type { Config } from '../types';
import { createLogger } from './logger';

const logger = createLogger('config');

// Load .env file — check ~/.clodds/.env first (onboard writes here), then CWD
dotenvConfig({ path: join(homedir(), '.clodds', '.env') });
dotenvConfig(); // CWD fallback (won't override existing vars)

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('~')) {
    return resolve(trimmed.replace(/^~(?=$|[\\/])/, homedir()));
  }
  return resolve(trimmed);
}

export function resolveStateDir(env = process.env): string {
  const override = env.CLODDS_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  return join(homedir(), '.clodds');
}

export function resolveConfigPath(env = process.env): string {
  const override = env.CLODDS_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  return join(resolveStateDir(env), 'clodds.json');
}

export function resolveWorkspaceDir(env = process.env): string {
  const override = env.CLODDS_WORKSPACE?.trim();
  if (override) return resolveUserPath(override);
  return join(homedir(), 'clodds');
}

const CONFIG_DIR = resolveStateDir();
const CONFIG_FILE = resolveConfigPath();

const DEFAULT_CONFIG: Config = {
  gateway: {
    port: 18789,
    auth: {},
  },
  agents: {
    defaults: {
      workspace: resolveWorkspaceDir(),
      model: { primary: 'anthropic/claude-opus-4-6' },
    },
  },
  session: {
    cleanup: {
      enabled: true,
      maxAgeDays: 30,
      idleDays: 14,
    },
  },
  channels: {
    telegram: {
      enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      dmPolicy: 'pairing',
      allowFrom: [],
    },
    webchat: {
      enabled: true, // WebChat enabled by default
    },
    matrix: process.env.MATRIX_ACCESS_TOKEN && process.env.MATRIX_HOMESERVER_URL && process.env.MATRIX_USER_ID
      ? {
          enabled: true,
          homeserverUrl: process.env.MATRIX_HOMESERVER_URL,
          accessToken: process.env.MATRIX_ACCESS_TOKEN,
          userId: process.env.MATRIX_USER_ID,
          dmPolicy: 'pairing',
          allowFrom: [],
        }
      : undefined,
    signal: process.env.SIGNAL_PHONE_NUMBER
      ? {
          enabled: true,
          phoneNumber: process.env.SIGNAL_PHONE_NUMBER,
          signalCliPath: process.env.SIGNAL_CLI_PATH,
          configDir: process.env.SIGNAL_CONFIG_DIR,
          dmPolicy: 'pairing',
          allowFrom: [],
        }
      : undefined,
    imessage: process.env.IMESSAGE_ENABLED === '1'
      ? {
          enabled: true,
          pollInterval: process.env.IMESSAGE_POLL_INTERVAL
            ? (Number.parseInt(process.env.IMESSAGE_POLL_INTERVAL, 10) || undefined)
            : undefined,
        }
      : undefined,
    line: process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET
      ? {
          enabled: true,
          channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
          channelSecret: process.env.LINE_CHANNEL_SECRET,
          webhookPort: process.env.LINE_WEBHOOK_PORT
            ? (Number.parseInt(process.env.LINE_WEBHOOK_PORT, 10) || undefined)
            : undefined,
          webhookPath: process.env.LINE_WEBHOOK_PATH,
        }
      : undefined,
    googlechat: process.env.GOOGLECHAT_CREDENTIALS_PATH
      ? {
          enabled: true,
          credentialsPath: process.env.GOOGLECHAT_CREDENTIALS_PATH,
          dmPolicy: 'pairing',
          allowFrom: [],
        }
      : process.env.GOOGLECHAT_CLIENT_EMAIL && process.env.GOOGLECHAT_PRIVATE_KEY && process.env.GOOGLECHAT_PROJECT_ID
        ? {
            enabled: true,
            credentials: {
              client_email: process.env.GOOGLECHAT_CLIENT_EMAIL,
              private_key: process.env.GOOGLECHAT_PRIVATE_KEY,
              project_id: process.env.GOOGLECHAT_PROJECT_ID,
            },
            dmPolicy: 'pairing',
            allowFrom: [],
          }
        : undefined,
  },
  feeds: {
    polymarket: { enabled: true, rtds: { enabled: false } },
    kalshi: { enabled: true },
    manifold: { enabled: true },
    metaculus: { enabled: true },
    drift: { enabled: false }, // Solana - disabled by default
    news: { enabled: false },
  },
  marketCache: {
    enabled: true,
    ttlMs: 30 * 60 * 1000,
    cleanupIntervalMs: 15 * 60 * 1000,
  },
  marketIndex: {
    enabled: true,
    syncIntervalMs: 6 * 60 * 60 * 1000,
    staleAfterMs: 7 * 24 * 60 * 60 * 1000,
    limitPerPlatform: 300,
    status: 'open',
    excludeSports: true,
    platforms: ['polymarket', 'kalshi', 'manifold', 'metaculus'],
    minVolume24h: 0,
    minLiquidity: 0,
    minOpenInterest: 0,
    minPredictions: 0,
    excludeResolved: false,
    platformWeights: {
      polymarket: 1,
      kalshi: 1,
      manifold: 1,
      metaculus: 1,
    },
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
  trading: {
    enabled: false,
    dryRun: true,
    maxOrderSize: 100,
    maxDailyLoss: 200,
    stopLossCooldownMs: 10 * 60 * 1000,
  },
  arbitrageExecution: {
    enabled: false,
    dryRun: true,
    minEdge: 1.0,
    minLiquidity: 500,
    maxPositionSize: 100,
    maxDailyLoss: 500,
    maxConcurrentPositions: 3,
    platforms: ['polymarket', 'kalshi'],
    preferMakerOrders: true,
    confirmationDelayMs: 0,
  },
  whaleTracking: {
    enabled: false,
    minTradeSize: 10000,
    minPositionSize: 50000,
    platforms: ['polymarket'],
    realtime: true,
    pollIntervalMs: 30 * 1000,
  },
  copyTrading: {
    enabled: false,
    dryRun: true,
    followedAddresses: [],
    sizingMode: 'fixed',
    fixedSize: 100,
    proportionalMultiplier: 0.1,
    portfolioPercentage: 1,
    maxPositionSize: 500,
    copyDelayMs: 5000,
  },
  smartRouting: {
    enabled: true,
    mode: 'balanced',
    platforms: ['polymarket', 'kalshi'],
    maxSlippage: 1,
    preferMaker: true,
    allowSplitting: false,
  },
  evmDex: {
    enabled: false,
    defaultChain: 'ethereum',
    slippageBps: 50,
    mevProtection: 'basic',
    maxPriceImpact: 3,
  },
  realtimeAlerts: {
    enabled: false,
    targets: [],
    whaleTrades: {
      enabled: true,
      minSize: 50000,
      cooldownMs: 300000,
    },
    arbitrage: {
      enabled: true,
      minEdge: 2,
      cooldownMs: 600000,
    },
    priceMovement: {
      enabled: true,
      minChangePct: 5,
      windowMs: 300000,
    },
    copyTrading: {
      enabled: true,
      onCopied: true,
      onFailed: true,
    },
  },
  alerts: {
    priceChange: { threshold: 5, windowSecs: 600 },
    volumeSpike: { multiplier: 3 },
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
  cron: {
    enabled: true,
    alertScanIntervalMs: 30 * 1000,
    digestIntervalMs: 5 * 60 * 1000,
    portfolioSyncIntervalMs: 60 * 60 * 1000,
    stopLossIntervalMs: 2 * 60 * 1000,
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
  positions: {
    enabled: true,
    priceUpdateIntervalMs: 5 * 60 * 1000,
    pnlSnapshotsEnabled: true,
    pnlHistoryDays: 90,
  },
  messages: {
    offlineQueue: {
      enabled: true,
      maxSize: 200,
      maxAgeMs: 15 * 60 * 1000,
      retryIntervalMs: 5000,
      maxRetries: 10,
    },
  },
};

/**
 * Substitute environment variables in config values
 * Supports ${VAR_NAME} syntax
 */
function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, varName) => {
      return process.env[varName] || '';
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

/**
 * Deep merge two objects
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = (target as Record<string, unknown>)[key];

    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }
  return result;
}

/**
 * Load configuration from file and environment
 */
export async function loadConfig(customPath?: string): Promise<Config> {
  let fileConfig: Partial<Config> = {};

  // Try to load config file
  const configPath = customPath || CONFIG_FILE;
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      fileConfig = JSON5.parse(content) as Partial<Config>;
    } catch (err) {
      logger.error({ configPath, error: err }, 'Failed to parse config file');
    }
  }

  // Merge with defaults
  const merged = deepMerge(DEFAULT_CONFIG, fileConfig);

  // Substitute environment variables
  const config = substituteEnvVars(merged) as Config;

  // Apply trading feature env overrides
  const envBool = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true';
  if (process.env.MARKET_MAKING_ENABLED) {
    if (!config.trading) config.trading = { enabled: false, dryRun: true, maxOrderSize: 100, maxDailyLoss: 200 };
    config.trading.marketMaking = {
      ...config.trading.marketMaking,
      enabled: envBool(process.env.MARKET_MAKING_ENABLED),
    };
  }
  if (process.env.MARKET_MAKING_SPREAD_BPS) {
    if (!config.trading) config.trading = { enabled: false, dryRun: true, maxOrderSize: 100, maxDailyLoss: 200 };
    if (!config.trading.marketMaking) config.trading.marketMaking = { enabled: false };
    const spreadBpsParsed = parseInt(process.env.MARKET_MAKING_SPREAD_BPS, 10);
    (config.trading.marketMaking as any).spreadBps = Number.isNaN(spreadBpsParsed) ? 50 : spreadBpsParsed;
  }
  if (process.env.CRYPTO_HFT_ENABLED) {
    if (!config.trading) config.trading = { enabled: false, dryRun: true, maxOrderSize: 100, maxDailyLoss: 200 };
    config.trading.cryptoHft = {
      ...config.trading.cryptoHft,
      enabled: envBool(process.env.CRYPTO_HFT_ENABLED),
    };
  }
  if (process.env.HFT_DIVERGENCE_ENABLED) {
    if (!config.trading) config.trading = { enabled: false, dryRun: true, maxOrderSize: 100, maxDailyLoss: 200 };
    config.trading.hftDivergence = {
      ...config.trading.hftDivergence,
      enabled: envBool(process.env.HFT_DIVERGENCE_ENABLED),
    };
  }

  // Apply Percolator env var overrides
  if (process.env.PERCOLATOR_ENABLED || process.env.PERCOLATOR_SLAB) {
    if (!config.feeds) (config as any).feeds = {};
    const pc = (config.feeds as any).percolator ?? {};
    if (process.env.PERCOLATOR_ENABLED) pc.enabled = envBool(process.env.PERCOLATOR_ENABLED);
    if (process.env.PERCOLATOR_RPC_URL) pc.rpcUrl = process.env.PERCOLATOR_RPC_URL;
    if (process.env.PERCOLATOR_PROGRAM_ID) pc.programId = process.env.PERCOLATOR_PROGRAM_ID;
    if (process.env.PERCOLATOR_SLAB) pc.slabAddress = process.env.PERCOLATOR_SLAB;
    if (process.env.PERCOLATOR_MATCHER_PROGRAM) pc.matcherProgram = process.env.PERCOLATOR_MATCHER_PROGRAM;
    if (process.env.PERCOLATOR_MATCHER_CONTEXT) pc.matcherContext = process.env.PERCOLATOR_MATCHER_CONTEXT;
    if (process.env.PERCOLATOR_ORACLE) pc.oracleAddress = process.env.PERCOLATOR_ORACLE;
    if (process.env.PERCOLATOR_LP_INDEX) {
      const parsed = parseInt(process.env.PERCOLATOR_LP_INDEX, 10);
      if (!Number.isNaN(parsed)) pc.lpIndex = parsed;
    }
    if (process.env.PERCOLATOR_KEEPER_ENABLED) pc.keeperEnabled = envBool(process.env.PERCOLATOR_KEEPER_ENABLED);
    if (process.env.PERCOLATOR_DRY_RUN) pc.dryRun = envBool(process.env.PERCOLATOR_DRY_RUN);
    (config.feeds as any).percolator = pc;
  }

  // Apply group policies from env JSON
  if (process.env.CLODDS_GROUP_POLICIES) {
    try {
      const parsed = JSON.parse(process.env.CLODDS_GROUP_POLICIES) as Record<string, unknown>;
      if (!config.channels) config.channels = {};
      for (const [channel, value] of Object.entries(parsed)) {
        if (!value || typeof value !== 'object') continue;
        const channelConfig = (config.channels as Record<string, any>)[channel] || {};
        channelConfig.groups = value as Record<string, { requireMention?: boolean }>;
        (config.channels as Record<string, any>)[channel] = channelConfig;
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to parse CLODDS_GROUP_POLICIES');
    }
  }

  return config;
}

export { CONFIG_DIR, CONFIG_FILE };
