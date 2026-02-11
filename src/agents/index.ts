/**
 * Agent Manager
 * Handles AI agent instances and message routing
 */

import Anthropic from '@anthropic-ai/sdk';
import { spawn, spawnSync, ChildProcess, execSync, execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { generateId as generateSecureId } from '../utils/id';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  Session,
  IncomingMessage,
  OutgoingMessage,
  ReactionMessage,
  PollMessage,
  Config,
  Alert,
  Platform,
  TradingContext,
  PolymarketCredentials,
  KalshiCredentials,
  ManifoldCredentials,
  Market,
  ExecutionServiceRef,
} from '../types';
import { logger } from '../utils/logger';
import { ToolRegistry, inferToolMetadata, CORE_TOOL_NAMES, detectToolHints, type ToolMetadata } from './tool-registry.js';
import { createSkillManager, SkillManager } from '../skills/loader';
import { FeedManager } from '../feeds';
import { Database } from '../db';
import type { CredentialsManager } from '../types';
// credentials module is private (gitignored) — lazy-load at runtime
const _credPath = '../credentials/index.js';
const _loadCredentials = () => import(_credPath).then(m => m.createCredentialsManager) as Promise<(db: import('../db').Database) => CredentialsManager>;
import { SessionManager } from '../sessions';
import { MemoryService, createClaudeSummarizer } from '../memory';
import { RateLimiter, RateLimitConfig, access, AccessControl, sanitize, detectInjection } from '../security/index';
import { execApprovals } from '../permissions';
import { hooks, HooksService, AgentHookContext, ToolHookContext, ToolCallResult, AgentStartResult, CompactionContext } from '../hooks/index';
import { createContextManager, ContextManager, estimateTokens, ContextConfig } from '../memory/context';
import { TranscriptionOptions } from '../media';
import { createSqlTool, SqlTool } from '../tools/sql';
import { WebhookTool } from '../tools/webhooks';
import { createDockerTool, DockerTool } from '../tools/docker';
import { createEmbeddingsService, EmbeddingsService } from '../embeddings';
import { selectAdaptiveModel, getModelStrategy } from '../models';
import { createSubagentManager, SubagentManager, ToolExecutor } from './subagents';
import { createFileTool, FileTool } from '../tools/files';
import { createShellHistoryTool, ShellHistoryTool } from '../tools/shell-history';
import { createGitTool, GitTool } from '../tools/git';
import { createEmailTool, EmailTool } from '../tools/email';
import { createSmsTool, SmsTool } from '../tools/sms';
import { createTranscriptionTool, TranscriptionTool } from '../tools/transcription';
import { buildKalshiHeadersForUrl, KalshiApiKeyAuth, normalizeKalshiPrivateKey } from '../utils/kalshi-auth';
import { buildPolymarketHeadersForUrl, PolymarketApiKeyAuth } from '../utils/polymarket-auth';
import {
  executePumpFunTrade,
  getBondingCurveState,
  getTokenPriceInfo,
  calculateBuyQuote,
  calculateSellQuote,
  isGraduated,
  getTokenInfo,
  getPumpPortalQuote,
  getTokenBalance,
  getUserPumpTokens,
  getBestPool,
} from '../solana/pumpapi';
import {
  executeJupiterSwap,
  getJupiterQuote,
  createJupiterLimitOrder,
  cancelJupiterLimitOrder,
  batchCancelJupiterLimitOrders,
  listJupiterLimitOrders,
  getJupiterLimitOrder,
  getJupiterLimitOrderHistory,
  getJupiterTradeHistory,
  getJupiterLimitOrderFee,
  listJupiterLimitOrdersByMint,
  cancelExpiredJupiterLimitOrder,
  createJupiterDCA,
  closeJupiterDCA,
  depositJupiterDCA,
  withdrawJupiterDCA,
  listJupiterDCAs,
  listClosedJupiterDCAs,
  getJupiterDCA,
  getJupiterDCABalance,
  getJupiterDCAFillHistory,
  getJupiterDCAAvailableTokens,
} from '../solana/jupiter';
import { getSolanaConnection, loadSolanaKeypair } from '../solana/wallet';
import {
  executeMeteoraDlmmSwap,
  executeMeteoraDlmmSwapExactOut,
  executeMeteoraDlmmSwapWithPriceImpact,
  getMeteoraDlmmQuoteExactOut,
  initializeMeteoraDlmmPosition,
  createEmptyMeteoraDlmmPosition,
  getMeteoraDlmmPositionsByUser,
  getAllMeteoraDlmmPositionsByUser,
  addMeteoraDlmmLiquidity,
  removeMeteoraDlmmLiquidity,
  closeMeteoraDlmmPosition,
  claimMeteoraDlmmSwapFee,
  claimAllMeteoraDlmmSwapFees,
  claimMeteoraDlmmLMReward,
  claimAllMeteoraDlmmRewards,
  getMeteoraDlmmActiveBin,
  getMeteoraDlmmFeeInfo,
  getMeteoraDlmmDynamicFee,
  getMeteoraDlmmEmissionRate,
  createMeteoraDlmmPool,
  createCustomizableMeteoraDlmmPool,
} from '../solana/meteora';
import {
  executeRaydiumSwap,
  getRaydiumQuote,
  getClmmPositions,
  createClmmPosition,
  increaseClmmLiquidity,
  decreaseClmmLiquidity,
  closeClmmPosition,
  harvestClmmRewards,
  addAmmLiquidity,
  removeAmmLiquidity,
  swapClmm,
  createClmmPool,
  getClmmConfigs,
} from '../solana/raydium';
import {
  executeOrcaWhirlpoolSwap,
  getOrcaWhirlpoolQuote,
  openOrcaFullRangePosition,
  openOrcaConcentratedPosition,
  fetchOrcaPositionsForOwner,
  fetchOrcaPositionsInWhirlpool,
  increaseOrcaLiquidity,
  decreaseOrcaLiquidity,
  harvestOrcaPosition,
  harvestAllOrcaPositionFees,
  closeOrcaPosition,
  createOrcaSplashPool,
  createOrcaConcentratedLiquidityPool,
  fetchOrcaWhirlpoolsByTokenPair,
} from '../solana/orca';
import { executeDriftDirectOrder } from '../solana/drift';
import { listMeteoraDlmmPools } from '../solana/meteora';
import { listRaydiumPools } from '../solana/raydium';
import { listOrcaWhirlpoolPools } from '../solana/orca';
import { selectBestPool, selectBestPoolWithResolvedMints } from '../solana/pools';
import { getMeteoraDlmmQuote } from '../solana/meteora';
import { wormholeQuote, wormholeBridge, wormholeRedeem, usdcBridgeAuto, usdcQuoteAuto } from '../bridge/wormhole';
import { isRetryableError, withRetry, RETRY_POLICIES } from '../infra/retry';
import { createMarketIndexService, MarketIndexService } from '../market-index';
import { enforceExposureLimits, enforceMaxOrderSize } from '../trading/risk';
// binanceFutures — migrated to handlers/binance.ts
// bybit — migrated to handlers/bybit.ts
import * as mexc from '../exchanges/mexc';
// hyperliquid — migrated to handlers/hyperliquid.ts
import * as opinion from '../exchanges/opinion';
// predictfun — migrated to handlers/predictfun.ts
import { dispatchHandler, hasHandler } from './handlers';

// Background process tracking
const backgroundProcesses: Map<string, {
  process: ChildProcess;
  name: string;
  startedAt: Date;
  userId: string;
  logs: string[];
}> = new Map();

export interface AgentContext {
  session: Session;
  feeds: FeedManager;
  db: Database;
  sessionManager: SessionManager;
  skills: SkillManager;
  credentials: CredentialsManager;
  transcription: TranscriptionTool;
  files: FileTool;
  shellHistory: ShellHistoryTool;
  git: GitTool;
  email: EmailTool;
  sms: SmsTool;
  sql: SqlTool;
  webhooks?: WebhookTool;
  docker: DockerTool;
  subagents: SubagentManager;
  marketIndex: MarketIndexService;
  marketIndexConfig?: Config['marketIndex'];
  tradingContext: TradingContext | null;  // null if user hasn't set up credentials
  sendMessage: (msg: OutgoingMessage) => Promise<string | null>;
  editMessage?: (msg: OutgoingMessage & { messageId: string }) => Promise<void>;
  deleteMessage?: (msg: OutgoingMessage & { messageId: string }) => Promise<void>;
  reactMessage?: (msg: ReactionMessage) => Promise<void>;
  createPoll?: (msg: PollMessage) => Promise<string | null>;
  /** Add message to conversation history */
  addToHistory: (role: 'user' | 'assistant', content: string) => void;
  /** Clear conversation history */
  clearHistory: () => void;
}

export interface AgentManager {
  handleMessage: (message: IncomingMessage, session: Session) => Promise<string | null>;
  dispose: () => void;
  /** Reload skills from disk */
  reloadSkills: () => void;
  /** Notify the agent that config changed */
  reloadConfig: (config: Config) => void;
  /** Get enabled skill names + descriptions for command palette */
  getSkillCommands: () => Array<{ name: string; description: string; subcommands?: Array<{ name: string; description: string; category: string }> }>;
}

const SYSTEM_PROMPT = `You are Clodds, an AI assistant for prediction markets. Claude + Odds.

You help users:
- Track prediction markets across platforms (Polymarket, Kalshi, Manifold, Metaculus, PredictIt)
- Manage their portfolio and positions
- Set up price alerts
- Research markets (base rates, resolution rules, historical data)
- Find edge (comparing market prices to external models like 538, CME FedWatch)
- Monitor news that affects markets

Be concise and direct. Use data when available. Format responses for chat (keep it readable on mobile).

When presenting prices, use cents format (e.g., "45¢" not "0.45").
When presenting changes, use percentage format (e.g., "+5.2%").

{{SKILLS}}

Available platforms: polymarket, kalshi, manifold, metaculus, predictit

Remember: You're chatting via Telegram/Discord. Keep responses concise but informative.`;

// JSON Schema type for tool input schemas (supports nested objects/arrays)
type JsonSchemaProperty = {
  type: string;
  description?: string;
  enum?: (string | number | boolean)[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: unknown;
  additionalProperties?: boolean | JsonSchemaProperty;
};

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
  metadata?: {
    platform?: string;
    category?: string;
    categories?: string[];
    tags?: string[];
    core?: boolean;
  };
}

// Type guard for Polymarket credentials
function isPolymarketCredentials(creds: PolymarketCredentials | KalshiCredentials | ManifoldCredentials): creds is PolymarketCredentials {
  return 'privateKey' in creds && 'funderAddress' in creds;
}

// Type guard for Kalshi credentials
function isKalshiCredentials(creds: PolymarketCredentials | KalshiCredentials | ManifoldCredentials): creds is KalshiCredentials {
  return (
    ('apiKeyId' in creds && 'privateKeyPem' in creds) ||
    ('email' in creds && 'password' in creds)
  );
}

// Type guard for Manifold credentials
function isManifoldCredentials(creds: PolymarketCredentials | KalshiCredentials | ManifoldCredentials): creds is ManifoldCredentials {
  return 'apiKey' in creds && !('privateKey' in creds);
}

// Generic API response types for common patterns
interface KalshiBalanceResponse {
  balance?: number;
  portfolio_value?: number;
  pnl?: number;
}

interface PolymarketBookResponse {
  asks?: Array<{ price: string }>;
  bids?: Array<{ price: string }>;
}

interface PolymarketMarketResponse {
  tokens?: Array<{ token_id: string; outcome: string }>;
  question?: string;
}

interface PolymarketTradeResponse {
  id?: string;
  hash?: string;
  price?: string;
  size?: string;
  outcome?: string;
  asset_id?: string;
  token_id?: string;
  side?: string;
}

// EVM chain type for DEX operations
type EvmChain = 'ethereum' | 'arbitrum' | 'optimism' | 'base' | 'polygon';
const VALID_EVM_CHAINS = new Set<string>(['ethereum', 'arbitrum', 'optimism', 'base', 'polygon']);

function toEvmChain(chain: string): EvmChain {
  if (VALID_EVM_CHAINS.has(chain)) {
    return chain as EvmChain;
  }
  return 'ethereum'; // Default to ethereum if invalid
}

// Generic API response wrapper - used for untyped API responses
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse<T = Record<string, unknown>> = T;

const STREAM_TOOL_CALLS_ENABLED = process.env.CLODDS_STREAM_TOOL_CALLS !== '0';
const TOOL_STREAM_DELAY_MS = Math.max(0, Number(process.env.CLODDS_STREAM_TOOL_DELAY_MS || 750));
const STREAM_RESPONSES_ENABLED = process.env.CLODDS_STREAM_RESPONSES !== '0';
const STREAM_RESPONSE_INTERVAL_MS = Math.max(150, Number(process.env.CLODDS_STREAM_RESPONSE_INTERVAL_MS || 500));
const STREAM_RESPONSE_PLATFORMS = new Set([
  'telegram',
  'discord',
  'slack',
  'whatsapp',
  'matrix',
  'teams',
  'webchat',
]);
const MEMORY_EXTRACT_MODEL = process.env.CLODDS_MEMORY_EXTRACT_MODEL || process.env.CLODDS_SUMMARY_MODEL || 'claude-3-5-haiku-20241022';
const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const DRIFT_GATEWAY_URL = process.env.DRIFT_GATEWAY_URL || 'http://localhost:8080';

function getKalshiApiKeyAuth(creds: KalshiCredentials): KalshiApiKeyAuth | null {
  if (creds.apiKeyId && creds.privateKeyPem) {
    return { apiKeyId: creds.apiKeyId, privateKeyPem: creds.privateKeyPem };
  }
  return null;
}

function getPolymarketApiKeyAuth(creds: PolymarketCredentials): PolymarketApiKeyAuth | null {
  if (creds.funderAddress && creds.apiKey && creds.apiSecret && creds.apiPassphrase) {
    return {
      address: creds.funderAddress,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      apiPassphrase: creds.apiPassphrase,
    };
  }
  return null;
}

function buildPolymarketAuthHeadersForContext(
  context: AgentContext,
  method: string,
  url: string,
  body?: unknown
): Record<string, string> {
  const polyCreds = context.tradingContext?.credentials.get('polymarket');
  if (!polyCreds || polyCreds.platform !== 'polymarket') {
    return {};
  }

  const auth = getPolymarketApiKeyAuth(polyCreds.data as PolymarketCredentials);
  if (!auth) {
    return {};
  }

  return buildPolymarketHeadersForUrl(auth, method, url, body);
}

type MemoryExtractionResult = {
  profile_summary?: string | null;
  summary?: string | null;
  facts?: Array<{ key: string; value: string }>;
  preferences?: Array<{ key: string; value: string }>;
  notes?: Array<{ key: string; value: string }>;
  topics?: string[];
};

function sanitizeMemoryText(text: string): string {
  return text.replace(/<private>[\s\S]*?<\/private>/gi, '').trim();
}

function containsSensitiveMemory(text: string): boolean {
  const lowered = text.toLowerCase();
  const patterns = [
    'api key',
    'secret',
    'private key',
    'seed phrase',
    'mnemonic',
    'password',
    'ssn',
    'social security',
    'credit card',
  ];
  if (patterns.some((p) => lowered.includes(p))) return true;

  const regexPatterns = [
    /sk-[a-z0-9]{10,}/i,
    /xox[abprs]-\d{6,}-\d{6,}-[a-z0-9-]{10,}/i,
    /-----BEGIN[^\n]*PRIVATE KEY-----/i,
    /eyJ[a-z0-9-_]+\.[a-z0-9-_]+\.[a-z0-9-_]+/i,
  ];
  return regexPatterns.some((re) => re.test(text));
}

function safeParseJsonObject<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch {
    return null;
  }
}

function limitItems<T extends { key?: string; value?: string }>(items: T[] | undefined, max: number): T[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && item.key && item.value)
    .slice(0, max)
    .map((item) => ({
      ...item,
      key: String(item.key).slice(0, 120),
      value: String(item.value).slice(0, 500),
    })) as T[];
}

async function extractMemoryWithClaude(
  client: Anthropic,
  text: string,
  maxItems: number
): Promise<MemoryExtractionResult | null> {
  const response = await client.messages.create({
    model: MEMORY_EXTRACT_MODEL,
    max_tokens: 700,
    system:
      'You extract durable user memory from conversations. '
      + 'Return ONLY valid JSON with keys: profile_summary, summary, facts, preferences, notes, topics. '
      + 'facts/preferences/notes are arrays of {key, value}. Keep items concise.',
    messages: [
      {
        role: 'user',
        content:
          'Extract durable user memory from the following turn. '
          + `Limit each list to ${maxItems} items. `
          + 'If no items, use empty arrays. Use null for missing summaries.\n\n'
          + text,
      },
    ],
  });

  const raw = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('\n')
    .trim();

  return safeParseJsonObject<MemoryExtractionResult>(raw);
}

async function fetchPolymarketClob(
  context: AgentContext,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const method = init?.method ?? 'GET';
  const authHeaders = buildPolymarketAuthHeadersForContext(context, method, url, init?.body);
  const headers = {
    ...(init?.headers ?? {}),
    ...authHeaders,
  } as Record<string, string>;

  return fetch(url, {
    ...init,
    headers,
  });
}

async function driftGatewayRequest(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: Record<string, unknown>
): Promise<ApiResponse> {
  let url = `${DRIFT_GATEWAY_URL}${path}`;
  const init: RequestInit = { method };

  if (body && Object.keys(body).length > 0) {
    if (method === 'GET') {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;
        params.set(key, String(value));
      }
      const suffix = params.toString();
      if (suffix) {
        url = `${url}?${suffix}`;
      }
    } else {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
  }

  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Gateway error: ${response.status}`);
  }

  return await response.json() as ApiResponse;
}


function buildTools(): ToolDefinition[] {
  return [
    // Market tools
    {
      name: 'search_markets',
      description: 'Search prediction markets by keyword across all platforms. Returns top results with current prices.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "Trump 2028", "Fed rate cut", "Bitcoin 100k")' },
          platform: {
            type: 'string',
            description: 'Optional: filter to specific platform',
            enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit'],
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_market',
      description: 'Get detailed info about a specific market including all outcomes and prices',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'The market ID or slug' },
          platform: {
            type: 'string',
            description: 'The platform',
            enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit'],
          },
        },
        required: ['market_id', 'platform'],
      },
    },
    {
      name: 'market_index_sync',
      description: 'Sync market index for semantic search (Polymarket, Kalshi, Manifold, Metaculus).',
      input_schema: {
        type: 'object',
        properties: {
          platforms: {
            type: 'array',
            description: 'Optional list of platforms to sync',
            items: { type: 'string', enum: ['polymarket', 'kalshi', 'manifold', 'metaculus'] },
          },
          limit_per_platform: {
            type: 'number',
            description: 'Max markets to index per platform (default 500)',
          },
          status: {
            type: 'string',
            description: 'Market status filter',
            enum: ['open', 'closed', 'settled', 'all'],
          },
          exclude_sports: {
            type: 'boolean',
            description: 'Exclude sports-related markets (default true)',
          },
          min_volume_24h: {
            type: 'number',
            description: 'Minimum 24h volume threshold (best-effort per platform)',
          },
          min_liquidity: {
            type: 'number',
            description: 'Minimum liquidity threshold (best-effort per platform)',
          },
          min_open_interest: {
            type: 'number',
            description: 'Minimum open interest threshold (Kalshi only)',
          },
          min_predictions: {
            type: 'number',
            description: 'Minimum number of predictions (Metaculus only)',
          },
          exclude_resolved: {
            type: 'boolean',
            description: 'Exclude resolved markets regardless of status filter',
          },
        },
      },
    },
    {
      name: 'market_index_search',
      description: 'Semantic search over indexed markets.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          platform: {
            type: 'string',
            description: 'Optional platform filter',
            enum: ['polymarket', 'kalshi', 'manifold', 'metaculus'],
          },
          limit: { type: 'number', description: 'Max results (default 10)' },
          max_candidates: { type: 'number', description: 'Max candidates to consider (default 1500)' },
          min_score: { type: 'number', description: 'Minimum similarity score to include' },
          platform_weights: {
            type: 'object',
            description: 'Optional per-platform weights (overrides config)',
            additionalProperties: { type: 'number' },
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'market_index_stats',
      description: 'Get indexed market counts by platform.',
      input_schema: {
        type: 'object',
        properties: {
          platforms: {
            type: 'array',
            description: 'Optional list of platforms to report',
            items: { type: 'string', enum: ['polymarket', 'kalshi', 'manifold', 'metaculus'] },
          },
        },
      },
    },
    {
      name: 'market_index_last_sync',
      description: 'Get the last market index sync summary.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'market_index_prune',
      description: 'Prune stale indexed markets.',
      input_schema: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            description: 'Optional platform to prune',
            enum: ['polymarket', 'kalshi', 'manifold', 'metaculus'],
          },
          stale_after_ms: {
            type: 'number',
            description: 'Age in ms beyond which entries are removed',
          },
        },
      },
    },

    // Portfolio tools
    {
      name: 'get_portfolio',
      description: 'Get user\'s portfolio: all positions with current value and P&L',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_portfolio_history',
      description: 'Get portfolio P&L history snapshots for the user',
      input_schema: {
        type: 'object',
        properties: {
          since_ms: { type: 'number', description: 'Only return snapshots after this timestamp (ms)' },
          limit: { type: 'number', description: 'Max snapshots to return (default 200)' },
          order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default desc)' },
        },
      },
    },
    {
      name: 'add_position',
      description: 'Manually track a position (for platforms without API sync)',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Platform name' },
          market_id: { type: 'string', description: 'Market ID' },
          market_question: { type: 'string', description: 'Market question text' },
          outcome: { type: 'string', description: 'Outcome name (e.g., "Yes", "No", "Trump")' },
          side: { type: 'string', description: 'YES or NO', enum: ['YES', 'NO'] },
          shares: { type: 'number', description: 'Number of shares' },
          avg_price: { type: 'number', description: 'Average entry price (0.0-1.0)' },
        },
        required: ['platform', 'market_id', 'market_question', 'outcome', 'side', 'shares', 'avg_price'],
      },
    },

    // Alert tools
    {
      name: 'create_alert',
      description: 'Create a price alert for a market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          platform: { type: 'string', description: 'Platform' },
          market_name: { type: 'string', description: 'Market name (for display)' },
          condition_type: {
            type: 'string',
            description: 'Alert condition',
            enum: ['price_above', 'price_below', 'price_change_pct'],
          },
          threshold: { type: 'number', description: 'Threshold (0.0-1.0 for price, percentage for change)' },
        },
        required: ['market_id', 'platform', 'condition_type', 'threshold'],
      },
    },
    {
      name: 'list_alerts',
      description: 'List all active alerts for the user',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'delete_alert',
      description: 'Delete an alert',
      input_schema: {
        type: 'object',
        properties: {
          alert_id: { type: 'string', description: 'Alert ID to delete' },
        },
        required: ['alert_id'],
      },
    },

    // News tools
    {
      name: 'get_recent_news',
      description: 'Get recent market-moving news',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of items (default 10)' },
        },
      },
    },
    {
      name: 'search_news',
      description: 'Search news by keyword',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_news_for_market',
      description: 'Get news relevant to a specific market',
      input_schema: {
        type: 'object',
        properties: {
          market_question: { type: 'string', description: 'The market question to find news for' },
        },
        required: ['market_question'],
      },
    },

    // Edge detection tools
    {
      name: 'analyze_edge',
      description: 'Analyze potential edge by comparing market price to external models (538, CME FedWatch, polls)',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          market_question: { type: 'string', description: 'Market question' },
          current_price: { type: 'number', description: 'Current market price (0.0-1.0)' },
          category: {
            type: 'string',
            description: 'Market category for finding relevant external data',
            enum: ['politics', 'economics', 'sports', 'other'],
          },
        },
        required: ['market_id', 'market_question', 'current_price', 'category'],
      },
    },
    {
      name: 'calculate_kelly',
      description: 'Calculate Kelly criterion bet sizing given edge estimate',
      input_schema: {
        type: 'object',
        properties: {
          market_price: { type: 'number', description: 'Current market price (0.0-1.0)' },
          estimated_probability: { type: 'number', description: 'Your estimated true probability (0.0-1.0)' },
          bankroll: { type: 'number', description: 'Available bankroll in dollars' },
        },
        required: ['market_price', 'estimated_probability', 'bankroll'],
      },
    },

    // ============================================
    // WHALE TRACKING & COPY TRADING TOOLS
    // ============================================

    {
      name: 'watch_wallet',
      description: 'Start tracking a wallet/user for real-time trade alerts. Get notified when they buy/sell.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (0x...) or username depending on platform' },
          platform: { type: 'string', description: 'Platform', enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit', 'drift'], default: 'polymarket' },
          nickname: { type: 'string', description: 'Optional nickname for this wallet (e.g., "Whale #1")' },
        },
        required: ['address'],
      },
    },
    {
      name: 'unwatch_wallet',
      description: 'Stop tracking a wallet address',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address to stop watching' },
        },
        required: ['address'],
      },
    },
    {
      name: 'list_watched_wallets',
      description: 'List all wallets you are currently tracking',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_wallet_trades',
      description: 'Get recent trades for a specific wallet/user',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address or username depending on platform' },
          platform: { type: 'string', description: 'Platform', enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit', 'drift'], default: 'polymarket' },
          limit: { type: 'number', description: 'Number of trades (default 20)' },
        },
        required: ['address'],
      },
    },
    {
      name: 'get_wallet_positions',
      description: 'Get current positions for a wallet/user',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address or username depending on platform' },
          platform: { type: 'string', description: 'Platform', enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit', 'drift'], default: 'polymarket' },
        },
        required: ['address'],
      },
    },
    {
      name: 'get_wallet_pnl',
      description: 'Get P&L stats for a wallet/user',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address or username depending on platform' },
          platform: { type: 'string', description: 'Platform', enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit', 'drift'], default: 'polymarket' },
        },
        required: ['address'],
      },
    },
    {
      name: 'get_top_traders',
      description: 'Get leaderboard of top traders/forecasters by profit, ROI, or accuracy',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Platform', enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit', 'drift'], default: 'polymarket' },
          sort_by: { type: 'string', description: 'Sort criteria', enum: ['profit', 'roi', 'volume', 'win_rate', 'accuracy'], default: 'profit' },
          period: { type: 'string', description: 'Time period', enum: ['24h', '7d', '30d', 'all'], default: '7d' },
          limit: { type: 'number', description: 'Number of traders (default 10)' },
        },
      },
    },
    {
      name: 'copy_trade',
      description: 'Copy a specific trade from a wallet (manual copy trading)',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet to copy from' },
          trade_id: { type: 'string', description: 'Trade ID to copy' },
          size_multiplier: { type: 'number', description: 'Size multiplier (0.1 = 10% of their size, 1.0 = same size)', default: 0.5 },
        },
        required: ['address', 'trade_id'],
      },
    },
    {
      name: 'enable_auto_copy',
      description: 'Enable automatic copy trading for a wallet',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet to auto-copy' },
          max_size: { type: 'number', description: 'Maximum position size per trade in dollars' },
          size_multiplier: { type: 'number', description: 'Size multiplier (0.1 = 10% of their size)', default: 0.5 },
          min_confidence: { type: 'number', description: 'Only copy if wallet has > this win rate (0-1)', default: 0.55 },
        },
        required: ['address', 'max_size'],
      },
    },
    {
      name: 'disable_auto_copy',
      description: 'Disable automatic copy trading for a wallet',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet to stop auto-copying' },
        },
        required: ['address'],
      },
    },
    {
      name: 'list_auto_copy',
      description: 'List all wallets with auto-copy enabled and their settings',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },

    // ============================================
    // ARBITRAGE & CROSS-PLATFORM TOOLS
    // ============================================

    {
      name: 'find_arbitrage',
      description: 'Find arbitrage opportunities where YES + NO prices sum to < 1 or cross-platform price discrepancies',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional search query to narrow markets' },
          min_edge: { type: 'number', description: 'Minimum edge % to report (default 1%)', default: 1 },
          limit: { type: 'number', description: 'Max opportunities to return (default 10)' },
          mode: {
            type: 'string',
            description: 'internal (YES+NO) | cross (price gaps) | both',
            enum: ['internal', 'cross', 'both'],
          },
          min_volume: { type: 'number', description: 'Minimum 24h volume filter (default 0)' },
          platforms: {
            type: 'array',
            description: 'Platforms to scan',
            items: { type: 'string', enum: ['polymarket', 'kalshi', 'manifold'] },
          },
        },
      },
    },
    {
      name: 'compare_prices',
      description: 'Compare prices for the same event across multiple platforms',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query to find matching markets' },
        },
        required: ['query'],
      },
    },
    {
      name: 'execute_arbitrage',
      description: 'Execute a YES+NO arbitrage trade (buy both YES and NO when sum < $1 for guaranteed profit)',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID or slug to arbitrage' },
          platform: { type: 'string', description: 'Platform', enum: ['polymarket'], default: 'polymarket' },
          size: { type: 'number', description: 'Size in dollars per side' },
        },
        required: ['market_id', 'size'],
      },
    },

    // ============================================
    // PAPER TRADING MODE
    // ============================================

    {
      name: 'paper_trading_mode',
      description: 'Enable or disable paper trading mode. In paper mode, all trades are simulated.',
      input_schema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'true to enable paper trading, false to use real money' },
          starting_balance: { type: 'number', description: 'Starting virtual balance (default $10,000)', default: 10000 },
        },
        required: ['enabled'],
      },
    },
    {
      name: 'paper_balance',
      description: 'Get current paper trading balance and P&L',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'paper_positions',
      description: 'Get all paper trading positions',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'paper_reset',
      description: 'Reset paper trading account to starting balance',
      input_schema: {
        type: 'object',
        properties: {
          starting_balance: { type: 'number', description: 'New starting balance', default: 10000 },
        },
      },
    },
    {
      name: 'paper_history',
      description: 'Get paper trading trade history and performance stats',
      input_schema: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Time period', enum: ['24h', '7d', '30d', 'all'], default: 'all' },
        },
      },
    },

    // ============================================
    // WHALE ALERTS & NOTIFICATIONS
    // ============================================

    {
      name: 'whale_alerts',
      description: 'Enable or configure whale alerts for large trades',
      input_schema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'Enable whale alerts' },
          min_size: { type: 'number', description: 'Minimum trade size to alert (in dollars)', default: 10000 },
          markets: { type: 'array', description: 'Market IDs to watch (empty = all markets)', items: { type: 'string' } },
        },
        required: ['enabled'],
      },
    },
    {
      name: 'new_market_alerts',
      description: 'Get alerts when new markets are created',
      input_schema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'Enable new market alerts' },
          categories: {
            type: 'array',
            description: 'Categories to watch (empty = all)',
            items: { type: 'string', enum: ['politics', 'crypto', 'sports', 'entertainment', 'science', 'economics'] },
          },
        },
        required: ['enabled'],
      },
    },
    {
      name: 'volume_spike_alerts',
      description: 'Get alerts when markets have unusual volume spikes',
      input_schema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'Enable volume spike alerts' },
          threshold_multiplier: { type: 'number', description: 'Alert when volume is X times normal (default 3)', default: 3 },
        },
        required: ['enabled'],
      },
    },

    // ============================================
    // TRADING EXECUTION TOOLS
    // ============================================

    // Polymarket trading
    {
      name: 'polymarket_buy',
      description: 'Buy shares on Polymarket (limit order GTC). Use polymarket_orderbook first to get the real buyPrice from /price endpoint — do NOT use raw book bids/asks which may show AMM extremes.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID of the outcome to buy' },
          price: { type: 'number', description: 'Price per share (0.01-0.99). Use buyPrice from polymarket_orderbook, NOT raw book ask.' },
          size: { type: 'number', description: 'Number of shares to buy' },
        },
        required: ['token_id', 'price', 'size'],
      },
    },
    {
      name: 'polymarket_sell',
      description: 'Sell shares on Polymarket (limit order GTC). Use polymarket_orderbook first to get the real sellPrice from /price endpoint. Set price to sellPrice for immediate fill.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID of the outcome to sell' },
          size: { type: 'number', description: 'Number of shares to sell' },
          price: { type: 'number', description: 'Price per share. Use sellPrice from polymarket_orderbook for instant fill.' },
        },
        required: ['token_id', 'size'],
      },
    },
    {
      name: 'polymarket_positions',
      description: 'Get current Polymarket positions with live CLOB prices (buyPrice, sellPrice, midpoint) for accurate P&L tracking and sell decisions.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'polymarket_cancel_all',
      description: 'Cancel all open orders on Polymarket',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'polymarket_orderbook',
      description: 'Get orderbook + real tradeable prices for a Polymarket token. Returns buyPrice (best ask), sellPrice (best bid), midpoint, spread, and lastTradePrice from official CLOB endpoints. Also includes raw book depth. IMPORTANT: Use buyPrice/sellPrice for actual trading prices — raw bids/asks may show AMM extremes.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to get orderbook for' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_balance',
      description: 'Get USDC balance on Polymarket (available funds for trading)',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'polymarket_cancel',
      description: 'Cancel a specific order on Polymarket by order ID',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID to cancel' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'polymarket_orders',
      description: 'Get all open orders on Polymarket',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'polymarket_market_sell',
      description: 'Market sell - immediately sell shares at best available bid. Sells at the real sellPrice (NOT 0.01). If size not specified, sells entire position.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to sell' },
          size: { type: 'number', description: 'Number of shares to sell (omit to sell all)' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_market_buy',
      description: 'Market buy - spend a specific USDC amount to buy shares at the real buyPrice from CLOB /price endpoint. Uses FOK (fill or kill) for immediate execution.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to buy' },
          amount: { type: 'number', description: 'USDC amount to spend (e.g., 50 for $50)' },
        },
        required: ['token_id', 'amount'],
      },
    },
    {
      name: 'polymarket_maker_buy',
      description: 'POST-ONLY maker buy - places order that MUST add liquidity (sit on book). If order would cross spread, it gets REJECTED instead of taking. ONLY 15-minute crypto markets have taker fees. Hourly, daily, and all other Polymarket markets have ZERO trading fees.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to buy' },
          price: { type: 'number', description: 'Price (0.01-0.99). Must be BELOW current ask to be maker.' },
          size: { type: 'number', description: 'Number of shares' },
        },
        required: ['token_id', 'price', 'size'],
      },
    },
    {
      name: 'polymarket_maker_sell',
      description: 'POST-ONLY maker sell - places order that MUST add liquidity (sit on book). If order would cross spread, it gets REJECTED instead of taking. ONLY 15-minute crypto markets have taker fees. Hourly, daily, and all other Polymarket markets have ZERO trading fees.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to sell' },
          price: { type: 'number', description: 'Price (0.01-0.99). Must be ABOVE current bid to be maker.' },
          size: { type: 'number', description: 'Number of shares' },
        },
        required: ['token_id', 'price', 'size'],
      },
    },
    {
      name: 'polymarket_fee_rate',
      description: 'Check if a market has trading fees. ONLY 15-minute crypto markets have taker fees (~1-1.5%). All other Polymarket markets (hourly, daily, politics, sports, etc.) have ZERO trading fees.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to check' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_midpoint',
      description: 'Get the midpoint price for a token (average of best bid and ask). Faster than full orderbook.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_spread',
      description: 'Get the bid-ask spread for a token. Shows how much slippage you might face.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_last_trade',
      description: 'Get the last trade price for a token.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_tick_size',
      description: 'Get the tick size (minimum price increment) for a token. Returns "0.1", "0.01", "0.001", or "0.0001".',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_trades',
      description: 'Get trade history for your account. Shows recent fills with prices and sizes.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market (condition_id)' },
          token_id: { type: 'string', description: 'Optional: filter by token' },
        },
      },
    },
    {
      name: 'polymarket_cancel_market',
      description: 'Cancel all orders for a specific market or token. More targeted than cancel_all.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market condition_id to cancel orders for' },
          token_id: { type: 'string', description: 'Optional: specific token to cancel' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'polymarket_estimate_fill',
      description: 'Estimate the fill price for a market order before executing. Shows expected slippage.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
          side: { type: 'string', description: 'BUY or SELL', enum: ['BUY', 'SELL'] },
          amount: { type: 'number', description: 'Amount (USDC for BUY, shares for SELL)' },
        },
        required: ['token_id', 'side', 'amount'],
      },
    },
    {
      name: 'polymarket_market_info',
      description: 'Get detailed info about a market by condition_id. Shows all outcomes, tokens, volume, liquidity.',
      input_schema: {
        type: 'object',
        properties: {
          condition_id: { type: 'string', description: 'Market condition ID' },
        },
        required: ['condition_id'],
      },
    },
    {
      name: 'orderbook_imbalance',
      description: 'Analyze orderbook imbalance to detect directional pressure. Returns bid/ask volume ratio, imbalance score (-1 to +1), directional signal (bullish/bearish/neutral), and timing recommendation. Use this before trading to find optimal entry timing.',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Platform (polymarket or kalshi)', enum: ['polymarket', 'kalshi'] },
          market_id: { type: 'string', description: 'Token ID (Polymarket) or ticker (Kalshi)' },
          depth_levels: { type: 'number', description: 'Number of price levels to analyze (default: 5)' },
        },
        required: ['platform', 'market_id'],
      },
    },

    // ========== HEALTH & CONFIG ==========
    {
      name: 'polymarket_health',
      description: 'Check if Polymarket CLOB server is up and running.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_server_time',
      description: 'Get Polymarket server timestamp.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_get_address',
      description: 'Get your signer wallet address.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_collateral_address',
      description: 'Get the USDC contract address on Polygon.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_conditional_address',
      description: 'Get the Conditional Token Framework (CTF) contract address.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_exchange_address',
      description: 'Get the exchange contract address.',
      input_schema: {
        type: 'object',
        properties: {
          neg_risk: { type: 'boolean', description: 'If true, returns neg_risk exchange (for crypto markets)' },
        },
      },
    },

    // ========== ADDITIONAL MARKET DATA ==========
    {
      name: 'polymarket_price',
      description: 'Get the best price for a specific side (BUY or SELL).',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
          side: { type: 'string', description: 'BUY or SELL', enum: ['BUY', 'SELL'] },
        },
        required: ['token_id', 'side'],
      },
    },
    {
      name: 'polymarket_neg_risk',
      description: 'Check if a token is in a negative risk market. Use the /fee-rate endpoint to check fees — only 15-min crypto markets have fees.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
        },
        required: ['token_id'],
      },
    },

    // ========== BATCH MARKET DATA ==========
    {
      name: 'polymarket_midpoints_batch',
      description: 'Get midpoint prices for multiple tokens at once.',
      input_schema: {
        type: 'object',
        properties: {
          token_ids: { type: 'array', items: { type: 'string' }, description: 'Array of token IDs' },
        },
        required: ['token_ids'],
      },
    },
    {
      name: 'polymarket_prices_batch',
      description: 'Get best prices for multiple tokens at once.',
      input_schema: {
        type: 'object',
        properties: {
          requests: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                token_id: { type: 'string' },
                side: { type: 'string', enum: ['BUY', 'SELL'] },
              },
            },
            description: 'Array of {token_id, side} objects',
          },
        },
        required: ['requests'],
      },
    },
    {
      name: 'polymarket_spreads_batch',
      description: 'Get spreads for multiple tokens at once.',
      input_schema: {
        type: 'object',
        properties: {
          token_ids: { type: 'array', items: { type: 'string' }, description: 'Array of token IDs' },
        },
        required: ['token_ids'],
      },
    },
    {
      name: 'polymarket_orderbooks_batch',
      description: 'Get orderbooks for multiple tokens at once.',
      input_schema: {
        type: 'object',
        properties: {
          token_ids: { type: 'array', items: { type: 'string' }, description: 'Array of token IDs' },
        },
        required: ['token_ids'],
      },
    },
    {
      name: 'polymarket_last_trades_batch',
      description: 'Get last trade prices for multiple tokens at once.',
      input_schema: {
        type: 'object',
        properties: {
          token_ids: { type: 'array', items: { type: 'string' }, description: 'Array of token IDs' },
        },
        required: ['token_ids'],
      },
    },

    // ========== MARKET DISCOVERY ==========
    {
      name: 'polymarket_markets',
      description: 'Get active markets (returns 25 per page, use next_cursor to paginate).',
      input_schema: {
        type: 'object',
        properties: {
          next_cursor: { type: 'string', description: 'Pagination cursor for next page' },
          limit: { type: 'number', description: 'Results per page (default 25, max 100)' },
        },
      },
    },
    {
      name: 'polymarket_simplified_markets',
      description: 'Get simplified market list (returns 25 per page, use next_cursor to paginate).',
      input_schema: {
        type: 'object',
        properties: {
          next_cursor: { type: 'string', description: 'Pagination cursor' },
          limit: { type: 'number', description: 'Results per page (default 25, max 100)' },
        },
      },
    },
    {
      name: 'polymarket_sampling_markets',
      description: 'Get featured/trending markets (returns 25 per page, use next_cursor to paginate).',
      input_schema: {
        type: 'object',
        properties: {
          next_cursor: { type: 'string', description: 'Pagination cursor' },
          limit: { type: 'number', description: 'Results per page (default 25, max 100)' },
        },
      },
    },
    {
      name: 'polymarket_market_trades_events',
      description: 'Get trade events for a specific market.',
      input_schema: {
        type: 'object',
        properties: {
          condition_id: { type: 'string', description: 'Market condition ID' },
        },
        required: ['condition_id'],
      },
    },

    // ========== ORDER OPERATIONS ==========
    {
      name: 'polymarket_get_order',
      description: 'Get details of a specific order by ID.',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'polymarket_post_orders_batch',
      description: 'Post multiple orders at once (batch).',
      input_schema: {
        type: 'object',
        properties: {
          orders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                token_id: { type: 'string' },
                price: { type: 'number' },
                size: { type: 'number' },
                side: { type: 'string', enum: ['BUY', 'SELL'] },
              },
            },
            description: 'Array of order objects',
          },
        },
        required: ['orders'],
      },
    },
    {
      name: 'polymarket_cancel_orders_batch',
      description: 'Cancel multiple orders at once by IDs.',
      input_schema: {
        type: 'object',
        properties: {
          order_ids: { type: 'array', items: { type: 'string' }, description: 'Array of order IDs to cancel' },
        },
        required: ['order_ids'],
      },
    },

    // ========== API KEY MANAGEMENT ==========
    {
      name: 'polymarket_create_api_key',
      description: 'Create a new API key for your wallet.',
      input_schema: {
        type: 'object',
        properties: {
          nonce: { type: 'number', description: 'Nonce for key derivation (default 0)' },
        },
      },
    },
    {
      name: 'polymarket_derive_api_key',
      description: 'Derive existing API key if you lost credentials but have private key.',
      input_schema: {
        type: 'object',
        properties: {
          nonce: { type: 'number', description: 'Nonce used when creating (default 0)' },
        },
      },
    },
    {
      name: 'polymarket_get_api_keys',
      description: 'List all your API keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_delete_api_key',
      description: 'Delete your current API key.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_create_readonly_api_key',
      description: 'Create a read-only API key (can view but not trade).',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_get_readonly_api_keys',
      description: 'List all read-only API keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_delete_readonly_api_key',
      description: 'Delete a read-only API key.',
      input_schema: {
        type: 'object',
        properties: {
          api_key: { type: 'string', description: 'The read-only API key to delete' },
        },
        required: ['api_key'],
      },
    },
    {
      name: 'polymarket_validate_readonly_api_key',
      description: 'Validate a read-only API key (public endpoint).',
      input_schema: {
        type: 'object',
        properties: {
          api_key: { type: 'string', description: 'The read-only API key to validate' },
        },
        required: ['api_key'],
      },
    },

    // ========== BALANCE & ALLOWANCE ==========
    {
      name: 'polymarket_get_balance_allowance',
      description: 'Get current balance and trading allowance for USDC or conditional tokens.',
      input_schema: {
        type: 'object',
        properties: {
          asset_type: { type: 'string', description: 'COLLATERAL (USDC) or CONDITIONAL (tokens)', enum: ['COLLATERAL', 'CONDITIONAL'] },
          token_id: { type: 'string', description: 'Token ID (required for CONDITIONAL)' },
        },
        required: ['asset_type'],
      },
    },
    {
      name: 'polymarket_update_balance_allowance',
      description: 'Refresh your balance and allowance cache.',
      input_schema: {
        type: 'object',
        properties: {
          asset_type: { type: 'string', description: 'COLLATERAL (USDC) or CONDITIONAL (tokens)', enum: ['COLLATERAL', 'CONDITIONAL'] },
          token_id: { type: 'string', description: 'Token ID (required for CONDITIONAL)' },
        },
        required: ['asset_type'],
      },
    },

    // ========== ADVANCED FEATURES ==========
    {
      name: 'polymarket_heartbeat',
      description: 'Send heartbeat to keep orders alive. If not sent within 10s, all orders cancelled.',
      input_schema: {
        type: 'object',
        properties: {
          heartbeat_id: { type: 'string', description: 'Heartbeat ID from previous call (omit for first call)' },
        },
      },
    },
    {
      name: 'polymarket_is_order_scoring',
      description: 'Check if an order is scoring (earning rewards).',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID to check' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'polymarket_are_orders_scoring',
      description: 'Check if multiple orders are scoring.',
      input_schema: {
        type: 'object',
        properties: {
          order_ids: { type: 'array', items: { type: 'string' }, description: 'Order IDs to check' },
        },
        required: ['order_ids'],
      },
    },
    {
      name: 'polymarket_notifications',
      description: 'Get your notifications.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_drop_notifications',
      description: 'Delete/dismiss notifications.',
      input_schema: {
        type: 'object',
        properties: {
          notification_ids: { type: 'array', items: { type: 'string' }, description: 'Notification IDs to delete' },
        },
        required: ['notification_ids'],
      },
    },
    {
      name: 'polymarket_closed_only_mode',
      description: 'Check if CLOB is in closed-only mode (no new orders).',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_orderbook_hash',
      description: 'Get the hash of an orderbook (for detecting changes efficiently).',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_sampling_simplified_markets',
      description: 'Get sampling (featured) markets in simplified format for display.',
      input_schema: {
        type: 'object',
        properties: {
          next_cursor: { type: 'string', description: 'Pagination cursor (omit for first page)' },
        },
      },
    },

    // Polymarket Gamma API - Events & Markets
    {
      name: 'polymarket_event',
      description: 'Get event details by ID from Polymarket Gamma API.',
      input_schema: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Event ID' },
        },
        required: ['event_id'],
      },
    },
    {
      name: 'polymarket_event_by_slug',
      description: 'Get event details by slug from Polymarket Gamma API.',
      input_schema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Event slug (URL-friendly name)' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'polymarket_events',
      description: 'Get list of events from Polymarket. Returns active/open events by default.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 20)' },
          offset: { type: 'number', description: 'Pagination offset (default 0)' },
        },
      },
    },
    {
      name: 'polymarket_search_events',
      description: 'Search Polymarket events by keyword.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'polymarket_crypto_markets',
      description: 'Find current live crypto Up/Down markets on Polymarket. Returns token IDs, prices, and orderbook for BTC, ETH, SOL, XRP across 15-minute, hourly, and daily timeframes.',
      input_schema: {
        type: 'object',
        properties: {
          coin: { type: 'string', description: 'Coin: BTC, ETH, SOL, XRP, or ALL (default ALL)', enum: ['BTC', 'ETH', 'SOL', 'XRP', 'ALL'] },
          timeframe: { type: 'string', description: 'Timeframe: 15m, 1h, daily, or ALL (default ALL)', enum: ['15m', '1h', 'daily', 'ALL'] },
        },
      },
    },
    {
      name: 'polymarket_event_tags',
      description: 'Get tags associated with an event.',
      input_schema: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Event ID' },
        },
        required: ['event_id'],
      },
    },
    {
      name: 'polymarket_market_by_slug',
      description: 'Get market details by slug from Polymarket Gamma API.',
      input_schema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Market slug (URL-friendly name)' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'polymarket_market_tags',
      description: 'Get tags associated with a market.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market/condition ID' },
        },
        required: ['market_id'],
      },
    },

    // Polymarket Gamma API - Series
    {
      name: 'polymarket_series',
      description: 'Get series by ID or list all series (grouped events like "2024 Election").',
      input_schema: {
        type: 'object',
        properties: {
          series_id: { type: 'string', description: 'Series ID (optional, lists all if omitted)' },
        },
      },
    },
    {
      name: 'polymarket_series_list',
      description: 'Get list of all series.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },

    // Polymarket Gamma API - Tags
    {
      name: 'polymarket_tags',
      description: 'Get list of all tags used to categorize markets.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'polymarket_tag',
      description: 'Get tag details by ID.',
      input_schema: {
        type: 'object',
        properties: {
          tag_id: { type: 'string', description: 'Tag ID' },
        },
        required: ['tag_id'],
      },
    },
    {
      name: 'polymarket_tag_by_slug',
      description: 'Get tag details by slug.',
      input_schema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Tag slug' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'polymarket_tag_relations',
      description: 'Get related tags for a tag.',
      input_schema: {
        type: 'object',
        properties: {
          tag_id: { type: 'string', description: 'Tag ID' },
        },
        required: ['tag_id'],
      },
    },

    // Polymarket Gamma API - Sports
    {
      name: 'polymarket_sports',
      description: 'Get list of all sports/betting categories on Polymarket.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_teams',
      description: 'Get list of teams, optionally filtered by sport.',
      input_schema: {
        type: 'object',
        properties: {
          sport: { type: 'string', description: 'Sport to filter by (optional)' },
        },
      },
    },

    // Polymarket Gamma API - Comments
    {
      name: 'polymarket_comments',
      description: 'Get comments on a market.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market/condition ID' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'polymarket_user_comments',
      description: 'Get comments made by a user.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['address'],
      },
    },

    // Polymarket Data API - Portfolio & Analytics
    {
      name: 'polymarket_positions_value',
      description: 'Get total value of positions for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (optional, uses configured if omitted)' },
        },
      },
    },
    {
      name: 'polymarket_closed_positions',
      description: 'Get closed/settled positions for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (optional)' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'polymarket_pnl_timeseries',
      description: 'Get P&L over time for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (optional)' },
          interval: { type: 'string', description: 'Time interval: 1h, 1d, 1w, 1m (default 1d)' },
        },
      },
    },
    {
      name: 'polymarket_overall_pnl',
      description: 'Get overall/total P&L for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (optional)' },
        },
      },
    },
    {
      name: 'polymarket_user_rank',
      description: 'Get leaderboard rank for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (optional)' },
        },
      },
    },
    {
      name: 'polymarket_leaderboard',
      description: 'Get top traders leaderboard.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 100)' },
        },
      },
    },
    {
      name: 'polymarket_top_holders',
      description: 'Get top holders for a market.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market/condition ID' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'polymarket_user_activity',
      description: 'Get activity feed for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (optional)' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'polymarket_open_interest',
      description: 'Get open interest for a market.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market/condition ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'polymarket_live_volume',
      description: 'Get live trading volume, optionally for a specific event.',
      input_schema: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Event ID (optional)' },
        },
      },
    },
    {
      name: 'polymarket_price_history',
      description: 'Get historical price data for a token.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
          interval: { type: 'string', description: 'Time interval: 1m, 5m, 15m, 1h, 4h, 1d (default 1h)' },
          limit: { type: 'number', description: 'Number of data points (default 100)' },
        },
        required: ['token_id'],
      },
    },

    // Polymarket Rewards API
    {
      name: 'polymarket_daily_rewards',
      description: 'Get your daily reward earnings from market making.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_market_rewards',
      description: 'Get rewards info for a specific market.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market/condition ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'polymarket_reward_markets',
      description: 'Get list of markets with active reward programs.',
      input_schema: { type: 'object', properties: {} },
    },

    // Polymarket Profiles API
    {
      name: 'polymarket_profile',
      description: 'Get public profile for a wallet address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address' },
        },
        required: ['address'],
      },
    },

    // Kalshi trading
    {
      name: 'kalshi_buy',
      description: 'Buy contracts on Kalshi. Executes a real trade.',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker (e.g., INXD-24JAN10-T5805)' },
          side: { type: 'string', description: 'yes or no', enum: ['yes', 'no'] },
          count: { type: 'number', description: 'Number of contracts' },
          price: { type: 'number', description: 'Price in cents (1-99)' },
        },
        required: ['ticker', 'side', 'count', 'price'],
      },
    },
    {
      name: 'kalshi_sell',
      description: 'Sell contracts on Kalshi. Executes a real trade.',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker' },
          side: { type: 'string', description: 'yes or no', enum: ['yes', 'no'] },
          count: { type: 'number', description: 'Number of contracts' },
          price: { type: 'number', description: 'Price in cents (1-99)' },
        },
        required: ['ticker', 'side', 'count', 'price'],
      },
    },
    {
      name: 'kalshi_positions',
      description: 'Get current Kalshi positions and balance',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'kalshi_search',
      description: 'Search for Kalshi markets',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (optional)' },
          status: { type: 'string', description: 'Market status filter', enum: ['open', 'closed', 'settled'] },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
    {
      name: 'kalshi_market',
      description: 'Get detailed information about a specific Kalshi market',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker (e.g., FED-24MAR-T525)' },
        },
        required: ['ticker'],
      },
    },
    {
      name: 'kalshi_balance',
      description: 'Get Kalshi account balance',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'kalshi_orders',
      description: 'Get all open orders on Kalshi',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'kalshi_cancel',
      description: 'Cancel a Kalshi order',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID to cancel' },
        },
        required: ['order_id'],
      },
    },

    // ========== KALSHI - EXCHANGE INFO ==========
    {
      name: 'kalshi_exchange_status',
      description: 'Get current Kalshi exchange operational status (trading hours, maintenance)',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_exchange_schedule',
      description: 'Get Kalshi trading hours and schedule',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_announcements',
      description: 'Get platform-wide Kalshi announcements',
      input_schema: { type: 'object', properties: {} },
    },

    // ========== KALSHI - MARKET DATA ==========
    {
      name: 'kalshi_orderbook',
      description: 'Get orderbook (bid/ask depth) for a Kalshi market',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker' },
        },
        required: ['ticker'],
      },
    },
    {
      name: 'kalshi_market_trades',
      description: 'Get recent trades for a market or across all markets',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker (optional - omit for all markets)' },
          limit: { type: 'number', description: 'Max trades to return (default 100)' },
        },
      },
    },
    {
      name: 'kalshi_candlesticks',
      description: 'Get candlestick/OHLC data for price history',
      input_schema: {
        type: 'object',
        properties: {
          series_ticker: { type: 'string', description: 'Series ticker (e.g., FED)' },
          ticker: { type: 'string', description: 'Market ticker' },
          interval: { type: 'number', description: 'Interval: 1 (1min), 60 (1hr), or 1440 (1day)', enum: [1, 60, 1440] },
        },
        required: ['series_ticker', 'ticker'],
      },
    },

    // ========== KALSHI - EVENTS & SERIES ==========
    {
      name: 'kalshi_events',
      description: 'List Kalshi events (groups of related markets)',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status', enum: ['open', 'closed', 'settled'] },
          series_ticker: { type: 'string', description: 'Filter by series' },
        },
      },
    },
    {
      name: 'kalshi_event',
      description: 'Get specific event with all its markets',
      input_schema: {
        type: 'object',
        properties: {
          event_ticker: { type: 'string', description: 'Event ticker' },
        },
        required: ['event_ticker'],
      },
    },
    {
      name: 'kalshi_series',
      description: 'List all Kalshi series (categories of events)',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter by category (optional)' },
        },
      },
    },
    {
      name: 'kalshi_series_info',
      description: 'Get specific series details',
      input_schema: {
        type: 'object',
        properties: {
          series_ticker: { type: 'string', description: 'Series ticker' },
        },
        required: ['series_ticker'],
      },
    },

    // ========== KALSHI - ADVANCED TRADING ==========
    {
      name: 'kalshi_market_order',
      description: 'Place a market order (immediate execution at best price)',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker' },
          side: { type: 'string', description: 'yes or no', enum: ['yes', 'no'] },
          action: { type: 'string', description: 'buy or sell', enum: ['buy', 'sell'] },
          count: { type: 'number', description: 'Number of contracts' },
        },
        required: ['ticker', 'side', 'action', 'count'],
      },
    },
    {
      name: 'kalshi_batch_create_orders',
      description: 'Create multiple orders in one request (up to 20)',
      input_schema: {
        type: 'object',
        properties: {
          orders: { type: 'array', description: 'Array of order objects with ticker, side, action, count, type, yes_price' },
        },
        required: ['orders'],
      },
    },
    {
      name: 'kalshi_batch_cancel_orders',
      description: 'Cancel multiple orders in one request',
      input_schema: {
        type: 'object',
        properties: {
          order_ids: { type: 'array', items: { type: 'string' }, description: 'Array of order IDs to cancel' },
        },
        required: ['order_ids'],
      },
    },
    {
      name: 'kalshi_cancel_all',
      description: 'Cancel ALL open orders on Kalshi',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_get_order',
      description: 'Get details of a specific order',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'kalshi_amend_order',
      description: 'Modify an existing order price and/or count',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID to modify' },
          price: { type: 'number', description: 'New price in cents (optional)' },
          count: { type: 'number', description: 'New contract count (optional)' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'kalshi_decrease_order',
      description: 'Reduce the quantity of an existing order',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID to modify' },
          reduce_by: { type: 'number', description: 'Number of contracts to reduce by' },
        },
        required: ['order_id', 'reduce_by'],
      },
    },
    {
      name: 'kalshi_queue_position',
      description: 'Get queue position for a resting order (how many contracts ahead)',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'kalshi_queue_positions',
      description: 'Get queue positions for all resting orders',
      input_schema: { type: 'object', properties: {} },
    },

    // ========== KALSHI - PORTFOLIO ==========
    {
      name: 'kalshi_fills',
      description: 'Get trade fills (executed trades history)',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Filter by market ticker (optional)' },
          limit: { type: 'number', description: 'Max fills to return (default 100)' },
        },
      },
    },
    {
      name: 'kalshi_settlements',
      description: 'Get settlement history (resolved positions)',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max settlements to return (default 100)' },
        },
      },
    },

    // ========== KALSHI - ACCOUNT ==========
    {
      name: 'kalshi_account_limits',
      description: 'Get API rate limits for your account tier',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_api_keys',
      description: 'List all API keys for your Kalshi account',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_create_api_key',
      description: 'Generate a new API key (returns private key once - save it!)',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_delete_api_key',
      description: 'Delete an API key',
      input_schema: {
        type: 'object',
        properties: {
          api_key: { type: 'string', description: 'API key to delete' },
        },
        required: ['api_key'],
      },
    },

    // Kalshi Exchange Info Extended
    {
      name: 'kalshi_fee_changes',
      description: 'Get upcoming series fee changes on Kalshi',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_user_data_timestamp',
      description: 'Get timestamp of last user data update (useful for caching)',
      input_schema: { type: 'object', properties: {} },
    },

    // Kalshi Market Data Batch
    {
      name: 'kalshi_batch_candlesticks',
      description: 'Get candlesticks for multiple Kalshi markets in one request',
      input_schema: {
        type: 'object',
        properties: {
          tickers: { type: 'array', description: 'Array of {series_ticker, ticker, period_interval} objects' },
        },
        required: ['tickers'],
      },
    },

    // Kalshi Events Extended
    {
      name: 'kalshi_event_metadata',
      description: 'Get metadata for a Kalshi event (rules, resolution criteria)',
      input_schema: {
        type: 'object',
        properties: {
          event_ticker: { type: 'string', description: 'Event ticker' },
        },
        required: ['event_ticker'],
      },
    },
    {
      name: 'kalshi_event_candlesticks',
      description: 'Get candlestick data for a Kalshi event',
      input_schema: {
        type: 'object',
        properties: {
          series_ticker: { type: 'string', description: 'Series ticker' },
          event_ticker: { type: 'string', description: 'Event ticker' },
          interval: { type: 'number', description: 'Interval: 1 (min), 60 (hour), 1440 (day)', default: 60 },
        },
        required: ['series_ticker', 'event_ticker'],
      },
    },
    {
      name: 'kalshi_forecast_history',
      description: 'Get forecast percentile history for a Kalshi event',
      input_schema: {
        type: 'object',
        properties: {
          series_ticker: { type: 'string', description: 'Series ticker' },
          event_ticker: { type: 'string', description: 'Event ticker' },
        },
        required: ['series_ticker', 'event_ticker'],
      },
    },
    {
      name: 'kalshi_multivariate_events',
      description: 'Get multivariate events (events with multiple correlated markets)',
      input_schema: { type: 'object', properties: {} },
    },

    // Kalshi Order Groups (Bracket/OCO Orders)
    {
      name: 'kalshi_create_order_group',
      description: 'Create an order group (bracket/OCO orders) on Kalshi',
      input_schema: {
        type: 'object',
        properties: {
          orders: { type: 'array', description: 'Array of order objects' },
          max_loss: { type: 'number', description: 'Max loss in cents (optional)' },
        },
        required: ['orders'],
      },
    },
    {
      name: 'kalshi_order_groups',
      description: 'List all Kalshi order groups',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_order_group',
      description: 'Get a specific Kalshi order group',
      input_schema: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Order group ID' },
        },
        required: ['group_id'],
      },
    },
    {
      name: 'kalshi_order_group_limit',
      description: 'Update max loss limit for a Kalshi order group',
      input_schema: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Order group ID' },
          max_loss: { type: 'number', description: 'Max loss in cents' },
        },
        required: ['group_id', 'max_loss'],
      },
    },
    {
      name: 'kalshi_order_group_trigger',
      description: 'Manually trigger a Kalshi order group',
      input_schema: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Order group ID' },
        },
        required: ['group_id'],
      },
    },
    {
      name: 'kalshi_order_group_reset',
      description: 'Reset a Kalshi order group to initial state',
      input_schema: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Order group ID' },
        },
        required: ['group_id'],
      },
    },
    {
      name: 'kalshi_delete_order_group',
      description: 'Delete a Kalshi order group',
      input_schema: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Order group ID' },
        },
        required: ['group_id'],
      },
    },

    // Kalshi Portfolio Extended
    {
      name: 'kalshi_resting_order_value',
      description: 'Get total value of resting orders on Kalshi',
      input_schema: { type: 'object', properties: {} },
    },

    // Kalshi Subaccounts
    {
      name: 'kalshi_create_subaccount',
      description: 'Create a new Kalshi subaccount',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Subaccount name' },
        },
        required: ['name'],
      },
    },
    {
      name: 'kalshi_subaccount_balances',
      description: 'Get balances for all Kalshi subaccounts',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_subaccount_transfer',
      description: 'Transfer funds between Kalshi subaccounts',
      input_schema: {
        type: 'object',
        properties: {
          from_id: { type: 'string', description: 'Source subaccount ID' },
          to_id: { type: 'string', description: 'Destination subaccount ID' },
          amount: { type: 'number', description: 'Amount in cents' },
        },
        required: ['from_id', 'to_id', 'amount'],
      },
    },
    {
      name: 'kalshi_subaccount_transfers',
      description: 'Get transfer history between Kalshi subaccounts',
      input_schema: { type: 'object', properties: {} },
    },

    // Kalshi Communications (RFQ/Quotes - Block Trading)
    {
      name: 'kalshi_comms_id',
      description: 'Get your Kalshi communications/RFQ user ID',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_create_rfq',
      description: 'Create a Request for Quote (RFQ) on Kalshi for block trading',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker' },
          side: { type: 'string', description: 'yes or no', enum: ['yes', 'no'] },
          count: { type: 'number', description: 'Number of contracts' },
          min_price: { type: 'number', description: 'Min acceptable price in cents (optional)' },
          max_price: { type: 'number', description: 'Max acceptable price in cents (optional)' },
        },
        required: ['ticker', 'side', 'count'],
      },
    },
    {
      name: 'kalshi_rfqs',
      description: 'List all your Kalshi RFQs',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_rfq',
      description: 'Get a specific Kalshi RFQ',
      input_schema: {
        type: 'object',
        properties: {
          rfq_id: { type: 'string', description: 'RFQ ID' },
        },
        required: ['rfq_id'],
      },
    },
    {
      name: 'kalshi_cancel_rfq',
      description: 'Cancel a Kalshi RFQ',
      input_schema: {
        type: 'object',
        properties: {
          rfq_id: { type: 'string', description: 'RFQ ID' },
        },
        required: ['rfq_id'],
      },
    },
    {
      name: 'kalshi_create_quote',
      description: 'Create a quote in response to a Kalshi RFQ',
      input_schema: {
        type: 'object',
        properties: {
          rfq_id: { type: 'string', description: 'RFQ ID to respond to' },
          price: { type: 'number', description: 'Price in cents' },
        },
        required: ['rfq_id', 'price'],
      },
    },
    {
      name: 'kalshi_quotes',
      description: 'List all your Kalshi quotes',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_quote',
      description: 'Get a specific Kalshi quote',
      input_schema: {
        type: 'object',
        properties: {
          quote_id: { type: 'string', description: 'Quote ID' },
        },
        required: ['quote_id'],
      },
    },
    {
      name: 'kalshi_cancel_quote',
      description: 'Cancel a Kalshi quote',
      input_schema: {
        type: 'object',
        properties: {
          quote_id: { type: 'string', description: 'Quote ID' },
        },
        required: ['quote_id'],
      },
    },
    {
      name: 'kalshi_accept_quote',
      description: 'Accept a Kalshi quote (as the RFQ creator)',
      input_schema: {
        type: 'object',
        properties: {
          quote_id: { type: 'string', description: 'Quote ID' },
        },
        required: ['quote_id'],
      },
    },
    {
      name: 'kalshi_confirm_quote',
      description: 'Confirm a Kalshi quote (as quote creator, after acceptance)',
      input_schema: {
        type: 'object',
        properties: {
          quote_id: { type: 'string', description: 'Quote ID' },
        },
        required: ['quote_id'],
      },
    },

    // Kalshi Multivariate Collections
    {
      name: 'kalshi_collections',
      description: 'List all Kalshi multivariate event collections',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_collection',
      description: 'Get a specific Kalshi multivariate collection',
      input_schema: {
        type: 'object',
        properties: {
          collection_ticker: { type: 'string', description: 'Collection ticker' },
        },
        required: ['collection_ticker'],
      },
    },
    {
      name: 'kalshi_collection_lookup',
      description: 'Get market lookup for a Kalshi multivariate collection',
      input_schema: {
        type: 'object',
        properties: {
          collection_ticker: { type: 'string', description: 'Collection ticker' },
        },
        required: ['collection_ticker'],
      },
    },
    {
      name: 'kalshi_collection_lookup_history',
      description: 'Get lookup history for a Kalshi multivariate collection',
      input_schema: {
        type: 'object',
        properties: {
          collection_ticker: { type: 'string', description: 'Collection ticker' },
        },
        required: ['collection_ticker'],
      },
    },

    // Kalshi Live Data
    {
      name: 'kalshi_live_data',
      description: 'Get live data for a Kalshi milestone (weather, sports, etc)',
      input_schema: {
        type: 'object',
        properties: {
          data_type: { type: 'string', description: 'Type of data (e.g., weather, sports)' },
          milestone_id: { type: 'string', description: 'Milestone ID' },
        },
        required: ['data_type', 'milestone_id'],
      },
    },
    {
      name: 'kalshi_live_data_batch',
      description: 'Get live data for multiple Kalshi milestones in batch',
      input_schema: {
        type: 'object',
        properties: {
          requests: { type: 'array', description: 'Array of {type, milestone_id} objects' },
        },
        required: ['requests'],
      },
    },

    // Kalshi Milestones
    {
      name: 'kalshi_milestones',
      description: 'List all Kalshi milestones',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_milestone',
      description: 'Get a specific Kalshi milestone',
      input_schema: {
        type: 'object',
        properties: {
          milestone_id: { type: 'string', description: 'Milestone ID' },
        },
        required: ['milestone_id'],
      },
    },

    // Kalshi Structured Targets
    {
      name: 'kalshi_structured_targets',
      description: 'List all Kalshi structured targets',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_structured_target',
      description: 'Get a specific Kalshi structured target',
      input_schema: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'Structured target ID' },
        },
        required: ['target_id'],
      },
    },

    // Kalshi Incentives
    {
      name: 'kalshi_incentives',
      description: 'Get available Kalshi incentive programs',
      input_schema: { type: 'object', properties: {} },
    },

    // Kalshi FCM (Futures Commission Merchant)
    {
      name: 'kalshi_fcm_orders',
      description: 'Get Kalshi FCM orders (for institutional accounts)',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_fcm_positions',
      description: 'Get Kalshi FCM positions (for institutional accounts)',
      input_schema: { type: 'object', properties: {} },
    },

    // Kalshi Search/Discovery
    {
      name: 'kalshi_search_tags',
      description: 'Get Kalshi search tags organized by category',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_search_sports',
      description: 'Get Kalshi sports filters for search',
      input_schema: { type: 'object', properties: {} },
    },

    // Manifold betting
    {
      name: 'manifold_bet',
      description: 'Place a bet on Manifold Markets using Mana',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          amount: { type: 'number', description: 'Mana amount to bet' },
          outcome: { type: 'string', description: 'YES or NO', enum: ['YES', 'NO'] },
          limit_prob: { type: 'number', description: 'Optional limit order probability (0.0-1.0)' },
        },
        required: ['market_id', 'amount', 'outcome'],
      },
    },
    {
      name: 'manifold_sell',
      description: 'Sell shares on Manifold Markets',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          outcome: { type: 'string', description: 'YES or NO', enum: ['YES', 'NO'] },
          shares: { type: 'number', description: 'Number of shares (omit to sell all)' },
        },
        required: ['market_id', 'outcome'],
      },
    },
    {
      name: 'manifold_search',
      description: 'Search for Manifold markets',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'manifold_market',
      description: 'Get detailed information about a Manifold market by ID or slug',
      input_schema: {
        type: 'object',
        properties: {
          id_or_slug: { type: 'string', description: 'Market ID or slug' },
        },
        required: ['id_or_slug'],
      },
    },
    {
      name: 'manifold_balance',
      description: 'Get your Mana balance on Manifold',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'manifold_positions',
      description: 'Get your current positions on Manifold Markets',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'manifold_bets',
      description: 'Get your bet history on Manifold',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Filter by market ID (optional)' },
        },
      },
    },
    {
      name: 'manifold_cancel',
      description: 'Cancel a limit order on Manifold',
      input_schema: {
        type: 'object',
        properties: {
          bet_id: { type: 'string', description: 'Bet ID to cancel' },
        },
        required: ['bet_id'],
      },
    },
    {
      name: 'manifold_multiple_choice',
      description: 'Place a bet on a multiple choice market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          answer_id: { type: 'string', description: 'Answer ID to bet on' },
          amount: { type: 'number', description: 'Mana amount' },
        },
        required: ['market_id', 'answer_id', 'amount'],
      },
    },

    // ============================================
    // MANIFOLD - USER ENDPOINTS
    // ============================================
    {
      name: 'manifold_get_user',
      description: 'Get a Manifold user by their username',
      input_schema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Username to look up' },
        },
        required: ['username'],
      },
    },
    {
      name: 'manifold_get_user_lite',
      description: 'Get basic display info for a Manifold user',
      input_schema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Username to look up' },
        },
        required: ['username'],
      },
    },
    {
      name: 'manifold_get_user_by_id',
      description: 'Get a Manifold user by their ID',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID to look up' },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'manifold_get_user_by_id_lite',
      description: 'Get basic display info for a Manifold user by ID',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID to look up' },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'manifold_get_me',
      description: 'Get your own Manifold user profile with full details',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'manifold_get_user_portfolio',
      description: 'Get live portfolio metrics for a Manifold user',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID (optional, defaults to self)' },
        },
      },
    },
    {
      name: 'manifold_get_user_portfolio_history',
      description: 'Get portfolio value history for a Manifold user',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID' },
          period: { type: 'string', description: 'Time period: daily, weekly, monthly, allTime', enum: ['daily', 'weekly', 'monthly', 'allTime'] },
        },
        required: ['user_id', 'period'],
      },
    },
    {
      name: 'manifold_list_users',
      description: 'List Manifold users ordered by creation date descending',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 1000)' },
          before: { type: 'string', description: 'Cursor for pagination' },
        },
      },
    },

    // ============================================
    // MANIFOLD - GROUP/TOPIC ENDPOINTS
    // ============================================
    {
      name: 'manifold_get_groups',
      description: 'List all Manifold topics/groups ordered by creation date',
      input_schema: {
        type: 'object',
        properties: {
          before_time: { type: 'number', description: 'Unix timestamp for pagination' },
          available_to_user_id: { type: 'string', description: 'Filter to groups available to this user' },
        },
      },
    },
    {
      name: 'manifold_get_group',
      description: 'Get a Manifold topic/group by slug',
      input_schema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Group slug' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'manifold_get_group_by_id',
      description: 'Get a Manifold topic/group by ID',
      input_schema: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Group ID' },
        },
        required: ['group_id'],
      },
    },

    // ============================================
    // MANIFOLD - MARKET ENDPOINTS (EXTENDED)
    // ============================================
    {
      name: 'manifold_list_markets',
      description: 'List Manifold markets with filtering and sorting',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 500)' },
          sort: { type: 'string', description: 'Sort field', enum: ['created-time', 'updated-time', 'last-bet-time', 'last-comment-time'] },
          order: { type: 'string', description: 'Sort order', enum: ['asc', 'desc'] },
          before: { type: 'string', description: 'Cursor for pagination' },
          user_id: { type: 'string', description: 'Filter by creator user ID' },
          group_id: { type: 'string', description: 'Filter by group/topic ID' },
        },
      },
    },
    {
      name: 'manifold_get_market_by_slug',
      description: 'Get a Manifold market by its URL slug',
      input_schema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Market slug from URL' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'manifold_get_probability',
      description: 'Get current probability for a market (max 1s cache)',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'manifold_get_probabilities',
      description: 'Get probabilities for multiple markets at once',
      input_schema: {
        type: 'object',
        properties: {
          market_ids: { type: 'array', items: { type: 'string' }, description: 'Array of market IDs' },
        },
        required: ['market_ids'],
      },
    },
    {
      name: 'manifold_get_market_positions',
      description: 'Get position information for a market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          order: { type: 'string', description: 'Sort by profit or shares', enum: ['profit', 'shares'] },
          top: { type: 'number', description: 'Get top N positions' },
          bottom: { type: 'number', description: 'Get bottom N positions' },
          user_id: { type: 'string', description: 'Filter by specific user' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'manifold_get_user_metrics',
      description: 'Get user contract metrics with corresponding contract data',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID' },
          limit: { type: 'number', description: 'Max results' },
          offset: { type: 'number', description: 'Offset for pagination' },
          order: { type: 'string', description: 'Sort order', enum: ['desc', 'asc'] },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'manifold_create_market',
      description: 'Create a new Manifold market (requires auth)',
      input_schema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Market question' },
          outcome_type: { type: 'string', description: 'Market type', enum: ['BINARY', 'MULTIPLE_CHOICE', 'PSEUDO_NUMERIC', 'POLL', 'BOUNTIED_QUESTION'] },
          description: { type: 'string', description: 'Market description (markdown)' },
          close_time: { type: 'number', description: 'Unix timestamp when market closes' },
          initial_prob: { type: 'number', description: 'Initial probability for binary (1-99)' },
          min: { type: 'number', description: 'Min value for numeric markets' },
          max: { type: 'number', description: 'Max value for numeric markets' },
          answers: { type: 'array', items: { type: 'string' }, description: 'Answers for multiple choice' },
          group_ids: { type: 'array', items: { type: 'string' }, description: 'Topic IDs to add market to' },
          visibility: { type: 'string', description: 'Market visibility', enum: ['public', 'unlisted'] },
        },
        required: ['question', 'outcome_type'],
      },
    },
    {
      name: 'manifold_add_answer',
      description: 'Add an answer to a multiple choice market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          text: { type: 'string', description: 'Answer text' },
        },
        required: ['market_id', 'text'],
      },
    },
    {
      name: 'manifold_add_liquidity',
      description: 'Add Mana to a market liquidity pool',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          amount: { type: 'number', description: 'Mana amount to add' },
        },
        required: ['market_id', 'amount'],
      },
    },
    {
      name: 'manifold_add_bounty',
      description: 'Add bounty reward to a market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          amount: { type: 'number', description: 'Mana amount to add as bounty' },
        },
        required: ['market_id', 'amount'],
      },
    },
    {
      name: 'manifold_award_bounty',
      description: 'Award bounty to a comment/answer',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          comment_id: { type: 'string', description: 'Comment ID to award' },
          amount: { type: 'number', description: 'Mana amount to award' },
        },
        required: ['market_id', 'comment_id', 'amount'],
      },
    },
    {
      name: 'manifold_close_market',
      description: 'Set or update the close time for a market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          close_time: { type: 'number', description: 'Unix timestamp for new close time' },
        },
        required: ['market_id', 'close_time'],
      },
    },
    {
      name: 'manifold_manage_topic',
      description: 'Add or remove a topic tag from a market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          group_id: { type: 'string', description: 'Topic/group ID' },
          remove: { type: 'boolean', description: 'Set true to remove instead of add' },
        },
        required: ['market_id', 'group_id'],
      },
    },
    {
      name: 'manifold_resolve_market',
      description: 'Resolve a market you created',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          outcome: { type: 'string', description: 'Resolution: YES, NO, MKT, CANCEL (or answerId for MC)' },
          probability_int: { type: 'number', description: 'For MKT resolution: probability 0-100' },
        },
        required: ['market_id', 'outcome'],
      },
    },

    // ============================================
    // MANIFOLD - BETTING ENDPOINTS (EXTENDED)
    // ============================================
    {
      name: 'manifold_multi_bet',
      description: 'Place multiple YES bets on a sums-to-one multiple choice market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          answer_ids: { type: 'array', items: { type: 'string' }, description: 'Answer IDs to bet on' },
          amount: { type: 'number', description: 'Total Mana amount' },
        },
        required: ['market_id', 'answer_ids', 'amount'],
      },
    },

    // ============================================
    // MANIFOLD - COMMENT ENDPOINTS
    // ============================================
    {
      name: 'manifold_get_comments',
      description: 'Get comments for a market or user',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Filter by market ID' },
          market_slug: { type: 'string', description: 'Filter by market slug' },
          user_id: { type: 'string', description: 'Filter by user ID' },
          limit: { type: 'number', description: 'Max results (default 1000)' },
          page: { type: 'number', description: 'Page number for pagination' },
        },
      },
    },
    {
      name: 'manifold_create_comment',
      description: 'Create a comment on a market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          content: { type: 'string', description: 'Comment content (markdown)' },
        },
        required: ['market_id', 'content'],
      },
    },

    // ============================================
    // MANIFOLD - TRANSACTION ENDPOINTS
    // ============================================
    {
      name: 'manifold_get_transactions',
      description: 'Get transaction history',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 100)' },
          offset: { type: 'number', description: 'Offset for pagination' },
          before: { type: 'string', description: 'Get transactions before this ID' },
          after: { type: 'string', description: 'Get transactions after this ID' },
          to_id: { type: 'string', description: 'Filter by recipient' },
          from_id: { type: 'string', description: 'Filter by sender' },
          category: { type: 'string', description: 'Filter by category' },
        },
      },
    },
    {
      name: 'manifold_send_mana',
      description: 'Send Mana to other users',
      input_schema: {
        type: 'object',
        properties: {
          to_ids: { type: 'array', items: { type: 'string' }, description: 'User IDs to send to' },
          amount: { type: 'number', description: 'Mana amount per recipient' },
          message: { type: 'string', description: 'Optional message' },
        },
        required: ['to_ids', 'amount'],
      },
    },

    // ============================================
    // MANIFOLD - LEAGUE ENDPOINTS
    // ============================================
    {
      name: 'manifold_get_leagues',
      description: 'Get league standings for a user or season',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID to get standings for' },
          season: { type: 'number', description: 'Season number' },
          cohort: { type: 'string', description: 'Cohort name' },
        },
      },
    },

    // ============================================
    // METACULUS (Forecasting Platform - Read Only)
    // ============================================
    {
      name: 'metaculus_search',
      description: 'Search for Metaculus forecasting questions',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term' },
          status: { type: 'string', description: 'Question status', enum: ['open', 'closed', 'resolved'] },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'metaculus_question',
      description: 'Get details about a Metaculus question by ID',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'string', description: 'Question ID' },
        },
        required: ['question_id'],
      },
    },
    {
      name: 'metaculus_tournaments',
      description: 'List Metaculus tournaments/competitions',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'metaculus_tournament_questions',
      description: 'Get questions in a Metaculus tournament',
      input_schema: {
        type: 'object',
        properties: {
          tournament_id: { type: 'string', description: 'Tournament ID' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
        required: ['tournament_id'],
      },
    },

    // ============================================
    // PREDICTIT (Read Only - No Trading API)
    // ============================================
    {
      name: 'predictit_search',
      description: 'Search for PredictIt markets',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'predictit_market',
      description: 'Get details about a PredictIt market by ID',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'predictit_all_markets',
      description: 'Get all PredictIt markets (full snapshot)',
      input_schema: { type: 'object', properties: {} },
    },

    // ============================================
    // DRIFT BET (Solana Prediction Markets - Read Only)
    // ============================================
    {
      name: 'drift_search',
      description: 'Search for Drift BET prediction markets on Solana',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term' },
        },
        required: ['query'],
      },
    },
    {
      name: 'drift_market',
      description: 'Get details about a Drift BET market by index',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'string', description: 'Market index' },
        },
        required: ['market_index'],
      },
    },
    {
      name: 'drift_all_markets',
      description: 'Get all Drift BET markets',
      input_schema: { type: 'object', properties: {} },
    },

    // ============================================
    // COINGECKO API (Crypto Prices - like Clawdbot's crypto-price)
    // ============================================

    {
      name: 'coingecko_price',
      description: 'Get current price for a cryptocurrency. Returns price in USD plus 24h change.',
      input_schema: {
        type: 'object',
        properties: {
          coin_id: { type: 'string', description: 'CoinGecko coin ID (e.g., bitcoin, ethereum, solana)' },
          include_market_cap: { type: 'boolean', description: 'Include market cap data (default false)' },
          include_24hr_vol: { type: 'boolean', description: 'Include 24h volume (default false)' },
        },
        required: ['coin_id'],
      },
    },
    {
      name: 'coingecko_prices',
      description: 'Get prices for multiple cryptocurrencies at once',
      input_schema: {
        type: 'object',
        properties: {
          coin_ids: { type: 'string', description: 'Comma-separated coin IDs (e.g., bitcoin,ethereum,solana)' },
          vs_currency: { type: 'string', description: 'Target currency (default: usd)' },
        },
        required: ['coin_ids'],
      },
    },
    {
      name: 'coingecko_coin_info',
      description: 'Get detailed info about a cryptocurrency including description, links, market data',
      input_schema: {
        type: 'object',
        properties: {
          coin_id: { type: 'string', description: 'CoinGecko coin ID' },
        },
        required: ['coin_id'],
      },
    },
    {
      name: 'coingecko_market_chart',
      description: 'Get historical price data for charting (OHLC candles)',
      input_schema: {
        type: 'object',
        properties: {
          coin_id: { type: 'string', description: 'CoinGecko coin ID' },
          days: { type: 'string', description: 'Number of days (1, 7, 14, 30, 90, 180, 365, max)' },
          interval: { type: 'string', description: 'Data interval: daily, hourly (auto-selected based on days if not specified)' },
        },
        required: ['coin_id', 'days'],
      },
    },
    {
      name: 'coingecko_trending',
      description: 'Get trending cryptocurrencies (top 7 by search popularity)',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'coingecko_search',
      description: 'Search for coins by name or symbol',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., bitcoin, btc, ethereum)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'coingecko_markets',
      description: 'Get top cryptocurrencies by market cap with prices and 24h changes',
      input_schema: {
        type: 'object',
        properties: {
          per_page: { type: 'number', description: 'Number of results (default 100, max 250)' },
          page: { type: 'number', description: 'Page number (default 1)' },
          order: { type: 'string', description: 'Sort order', enum: ['market_cap_desc', 'market_cap_asc', 'volume_desc', 'volume_asc'] },
        },
      },
    },
    {
      name: 'coingecko_global',
      description: 'Get global crypto market data (total market cap, BTC dominance, etc.)',
      input_schema: { type: 'object', properties: {} },
    },

    // ============================================
    // YAHOO FINANCE API (Stocks - like Clawdbot's yahoo-finance)
    // ============================================

    {
      name: 'yahoo_quote',
      description: 'Get real-time stock quote with price, change, volume, market cap',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol (e.g., AAPL, GOOGL, TSLA)' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'yahoo_quotes',
      description: 'Get quotes for multiple stocks at once',
      input_schema: {
        type: 'object',
        properties: {
          symbols: { type: 'string', description: 'Comma-separated ticker symbols (e.g., AAPL,GOOGL,MSFT)' },
        },
        required: ['symbols'],
      },
    },
    {
      name: 'yahoo_chart',
      description: 'Get historical price data for a stock (OHLCV)',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol' },
          range: { type: 'string', description: 'Time range', enum: ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max'] },
          interval: { type: 'string', description: 'Data interval', enum: ['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo'] },
        },
        required: ['symbol', 'range'],
      },
    },
    {
      name: 'yahoo_search',
      description: 'Search for stock tickers by company name',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (company name or partial ticker)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'yahoo_options',
      description: 'Get options chain data for a stock',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol' },
          expiration: { type: 'string', description: 'Expiration date (YYYY-MM-DD), omit for nearest expiration' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'yahoo_news',
      description: 'Get recent news articles for a stock',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'yahoo_fundamentals',
      description: 'Get fundamental data: P/E, EPS, dividend yield, revenue, etc.',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'yahoo_earnings',
      description: 'Get earnings history and upcoming earnings date',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol' },
        },
        required: ['symbol'],
      },
    },

    // ============================================
    // OPINION.TRADE API (BNB Chain Prediction Market)
    // ============================================

    {
      name: 'opinion_markets',
      description: 'List all Opinion.trade prediction markets with optional filters',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status', enum: ['active', 'resolved', 'all'] },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'opinion_market',
      description: 'Get detailed info about a specific Opinion.trade market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'opinion_price',
      description: 'Get latest trade price for an Opinion.trade token',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID (yes or no token)' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'opinion_orderbook',
      description: 'Get orderbook depth for an Opinion.trade token',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
          depth: { type: 'number', description: 'Orderbook depth (default 10)' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'opinion_price_history',
      description: 'Get historical prices for an Opinion.trade token',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
          interval: { type: 'string', description: 'Time interval', enum: ['1h', '4h', '1d', '1w'] },
          limit: { type: 'number', description: 'Number of data points (default 100)' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'opinion_quote_tokens',
      description: 'List available quote tokens (currencies) on Opinion.trade',
      input_schema: { type: 'object', properties: {} },
    },
    // Opinion.trade TRADING tools (requires SDK/wallet)
    {
      name: 'opinion_place_order',
      description: 'Place a buy or sell order on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          token_id: { type: 'string', description: 'Token ID (YES or NO token)' },
          side: { type: 'string', description: 'Order side', enum: ['BUY', 'SELL'] },
          order_type: { type: 'string', description: 'Order type', enum: ['LIMIT', 'MARKET'] },
          price: { type: 'number', description: 'Limit price (0.01-0.99), ignored for MARKET orders' },
          amount: { type: 'number', description: 'Amount in quote token (e.g., USDT)' },
        },
        required: ['market_id', 'token_id', 'side', 'order_type', 'amount'],
      },
    },
    {
      name: 'opinion_cancel_order',
      description: 'Cancel an open order on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID to cancel' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'opinion_cancel_all_orders',
      description: 'Cancel all open orders on Opinion.trade, optionally filtered by market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: only cancel orders for this market' },
          side: { type: 'string', description: 'Optional: only cancel BUY or SELL orders', enum: ['BUY', 'SELL'] },
        },
      },
    },
    {
      name: 'opinion_orders',
      description: 'Get your open orders on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market' },
          status: { type: 'string', description: 'Order status filter', enum: ['open', 'filled', 'cancelled', 'all'] },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
    {
      name: 'opinion_positions',
      description: 'Get your positions on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market' },
        },
      },
    },
    {
      name: 'opinion_balances',
      description: 'Get your token balances on Opinion.trade',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'opinion_trades',
      description: 'Get your trade history on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'opinion_redeem',
      description: 'Redeem winnings from a resolved Opinion.trade market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID to redeem from' },
        },
        required: ['market_id'],
      },
    },
    // Opinion.trade - MISSING METHODS (8 added for 100% API coverage)
    {
      name: 'opinion_categorical_market',
      description: 'Get detailed info for a categorical (multi-outcome) Opinion.trade market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'number', description: 'Categorical market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'opinion_fee_rates',
      description: 'Get maker/taker fee rates for an Opinion.trade token',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to check fees for' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'opinion_order_by_id',
      description: 'Get full details for a specific Opinion.trade order',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'opinion_place_orders_batch',
      description: 'Place multiple orders on Opinion.trade in a single batch',
      input_schema: {
        type: 'object',
        properties: {
          orders: {
            type: 'array',
            description: 'Array of orders to place',
            items: {
              type: 'object',
              properties: {
                market_id: { type: 'string', description: 'Market ID' },
                token_id: { type: 'string', description: 'Token ID' },
                side: { type: 'string', enum: ['BUY', 'SELL'] },
                order_type: { type: 'string', enum: ['LIMIT', 'MARKET'] },
                price: { type: 'number', description: 'Price (0.01-0.99)' },
                amount: { type: 'number', description: 'Amount' },
              },
            },
          },
        },
        required: ['orders'],
      },
    },
    {
      name: 'opinion_cancel_orders_batch',
      description: 'Cancel multiple orders on Opinion.trade in a single batch',
      input_schema: {
        type: 'object',
        properties: {
          order_ids: {
            type: 'array',
            description: 'Array of order IDs to cancel',
            items: { type: 'string' },
          },
        },
        required: ['order_ids'],
      },
    },
    {
      name: 'opinion_enable_trading',
      description: 'Enable trading on Opinion.trade by approving tokens for exchange contract (one-time setup)',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'opinion_split',
      description: 'Split collateral (USDT) into YES+NO outcome tokens on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'number', description: 'Market ID' },
          amount: { type: 'number', description: 'Amount of collateral to split' },
        },
        required: ['market_id', 'amount'],
      },
    },
    {
      name: 'opinion_merge',
      description: 'Merge YES+NO outcome tokens back into collateral (USDT) on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'number', description: 'Market ID' },
          amount: { type: 'number', description: 'Amount of outcome tokens to merge' },
        },
        required: ['market_id', 'amount'],
      },
    },

    // ============================================
    // PREDICT.FUN API (BNB Chain Prediction Market)
    // ============================================

    {
      name: 'predictfun_markets',
      description: 'List Predict.fun prediction markets with pagination',
      input_schema: {
        type: 'object',
        properties: {
          first: { type: 'number', description: 'Number of results (default 50)' },
          after: { type: 'string', description: 'Cursor for pagination' },
        },
      },
    },
    {
      name: 'predictfun_market',
      description: 'Get detailed info about a specific Predict.fun market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'predictfun_orderbook',
      description: 'Get orderbook for a Predict.fun market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'predictfun_market_stats',
      description: 'Get statistics for a Predict.fun market (volume, liquidity)',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'predictfun_last_sale',
      description: 'Get last sale info for a Predict.fun market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'predictfun_categories',
      description: 'List all Predict.fun market categories',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'predictfun_category',
      description: 'Get a specific category and its markets by slug',
      input_schema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Category slug (e.g., crypto, sports, politics)' },
        },
        required: ['slug'],
      },
    },
    // Predict.fun TRADING tools (requires API key + wallet)
    {
      name: 'predictfun_create_order',
      description: 'Create an order on Predict.fun (requires signed order via SDK)',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          side: { type: 'string', description: 'Order side', enum: ['BUY', 'SELL'] },
          outcome: { type: 'string', description: 'Outcome to trade', enum: ['YES', 'NO'] },
          strategy: { type: 'string', description: 'Order strategy', enum: ['LIMIT', 'MARKET'] },
          price: { type: 'number', description: 'Price per share (0.01-0.99) for LIMIT orders' },
          amount: { type: 'number', description: 'Amount in USDT' },
          slippage_bps: { type: 'number', description: 'Slippage tolerance in basis points (default 100 = 1%)' },
        },
        required: ['market_id', 'side', 'outcome', 'strategy', 'amount'],
      },
    },
    {
      name: 'predictfun_cancel_orders',
      description: 'Cancel orders on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          order_hashes: { type: 'string', description: 'Comma-separated order hashes to cancel' },
        },
        required: ['order_hashes'],
      },
    },
    {
      name: 'predictfun_orders',
      description: 'Get your orders on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market' },
          status: { type: 'string', description: 'Order status', enum: ['open', 'filled', 'cancelled'] },
        },
      },
    },
    {
      name: 'predictfun_positions',
      description: 'Get your positions on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market' },
        },
      },
    },
    {
      name: 'predictfun_account',
      description: 'Get your Predict.fun account info',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'predictfun_activity',
      description: 'Get your trading activity on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    // Predict.fun - MISSING METHODS (6 added for 100% API coverage)
    {
      name: 'predictfun_order_by_hash',
      description: 'Get a specific order by its hash on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          order_hash: { type: 'string', description: 'Order hash' },
        },
        required: ['order_hash'],
      },
    },
    {
      name: 'predictfun_redeem_positions',
      description: 'Redeem winning positions from resolved Predict.fun markets',
      input_schema: {
        type: 'object',
        properties: {
          condition_id: { type: 'string', description: 'Condition ID from position' },
          index_set: { type: 'number', description: 'Index set (1 or 2)', enum: [1, 2] },
          amount: { type: 'number', description: 'Amount to redeem (optional, defaults to full balance)' },
        },
        required: ['condition_id', 'index_set'],
      },
    },
    {
      name: 'predictfun_merge_positions',
      description: 'Merge YES+NO positions back to collateral on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          condition_id: { type: 'string', description: 'Condition ID' },
          amount: { type: 'number', description: 'Amount of positions to merge' },
        },
        required: ['condition_id', 'amount'],
      },
    },
    {
      name: 'predictfun_set_approvals',
      description: 'Set token approvals for trading on Predict.fun (one-time setup)',
      input_schema: {
        type: 'object',
        properties: {
          is_yield_bearing: { type: 'boolean', description: 'For yield-bearing collateral (default false)' },
        },
      },
    },
    {
      name: 'predictfun_balance',
      description: 'Get your USDT balance on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'predictfun_matches',
      description: 'Get matched trades/fills for your orders on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },

    // ============================================
    // DRIFT BET API (Solana Prediction Market) - EXPANDED
    // ============================================

    // Drift Gateway trading endpoints (self-hosted)
    {
      name: 'drift_place_order',
      description: 'Place an order on Drift BET prediction markets',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'number', description: 'Market index' },
          market_type: { type: 'string', description: 'Market type', enum: ['perp', 'spot'] },
          side: { type: 'string', description: 'Order side', enum: ['buy', 'sell'] },
          order_type: { type: 'string', description: 'Order type', enum: ['limit', 'market', 'oracle'] },
          price: { type: 'number', description: 'Price for limit orders' },
          amount: { type: 'number', description: 'Order size' },
          reduce_only: { type: 'boolean', description: 'Reduce only flag (default false)' },
          post_only: { type: 'boolean', description: 'Post only flag (default false)' },
        },
        required: ['market_index', 'market_type', 'side', 'order_type', 'amount'],
      },
    },
    {
      name: 'drift_cancel_order',
      description: 'Cancel an order on Drift',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'number', description: 'Order ID to cancel' },
          market_index: { type: 'number', description: 'Market index' },
          market_type: { type: 'string', description: 'Market type', enum: ['perp', 'spot'] },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'drift_cancel_all_orders',
      description: 'Cancel all orders on Drift, optionally filtered by market',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'number', description: 'Optional: market index filter' },
          market_type: { type: 'string', description: 'Optional: market type filter', enum: ['perp', 'spot'] },
        },
      },
    },
    {
      name: 'drift_orders',
      description: 'Get your open orders on Drift',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'number', description: 'Optional: filter by market' },
          market_type: { type: 'string', description: 'Optional: filter by type', enum: ['perp', 'spot'] },
        },
      },
    },
    {
      name: 'drift_positions',
      description: 'Get your positions on Drift',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'number', description: 'Optional: filter by market' },
        },
      },
    },
    {
      name: 'drift_balance',
      description: 'Get your collateral balance on Drift',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'drift_leverage',
      description: 'Get or set account leverage on Drift',
      input_schema: {
        type: 'object',
        properties: {
          set_leverage: { type: 'number', description: 'Optional: set new max leverage' },
        },
      },
    },
    {
      name: 'drift_orderbook',
      description: 'Get L2 orderbook for a Drift market',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'number', description: 'Market index' },
          market_type: { type: 'string', description: 'Market type', enum: ['perp', 'spot'] },
          depth: { type: 'number', description: 'Orderbook depth (default 10)' },
        },
        required: ['market_index', 'market_type'],
      },
    },
    // Drift - Additional methods for 100% coverage
    {
      name: 'drift_markets',
      description: 'Get all available Drift markets (spot and perp)',
      input_schema: {
        type: 'object',
        properties: {
          market_type: { type: 'string', description: 'Filter by type', enum: ['perp', 'spot'] },
        },
      },
    },
    {
      name: 'drift_market_info',
      description: 'Get detailed info for a specific Drift market',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'number', description: 'Market index' },
        },
        required: ['market_index'],
      },
    },
    {
      name: 'drift_margin_info',
      description: 'Get account margin requirements on Drift',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'drift_collateral',
      description: 'Get maintenance collateral balance on Drift',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'drift_modify_order',
      description: 'Modify an existing order on Drift (change price/size)',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'number', description: 'Order ID to modify' },
          new_price: { type: 'number', description: 'New price' },
          new_size: { type: 'number', description: 'New size' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'drift_cancel_and_place',
      description: 'Atomically cancel existing orders and place new ones on Drift',
      input_schema: {
        type: 'object',
        properties: {
          cancel_order_ids: {
            type: 'array',
            description: 'Order IDs to cancel',
            items: { type: 'number' },
          },
          new_orders: {
            type: 'array',
            description: 'New orders to place',
            items: {
              type: 'object',
              properties: {
                market_index: { type: 'number' },
                market_type: { type: 'string' },
                side: { type: 'string' },
                order_type: { type: 'string' },
                price: { type: 'number' },
                amount: { type: 'number' },
              },
            },
          },
        },
        required: ['new_orders'],
      },
    },
    {
      name: 'drift_transaction_events',
      description: 'Get transaction history/events on Drift',
      input_schema: {
        type: 'object',
        properties: {
          signature: { type: 'string', description: 'Optional: transaction signature to fetch details' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },

    // ============================================
    // CENTRALIZED FUTURES EXCHANGES
    // ============================================

    // Binance Futures
    {
      name: 'binance_futures_balance',
      description: 'Get Binance Futures USDT-M account balance',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'binance_futures_positions',
      description: 'Get open positions on Binance Futures',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'binance_futures_orders',
      description: 'Get open orders on Binance Futures',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Optional: filter by symbol (e.g., BTCUSDT)' },
        },
      },
    },
    {
      name: 'binance_futures_long',
      description: 'Open a long position on Binance Futures',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair (e.g., BTCUSDT)' },
          quantity: { type: 'number', description: 'Position size' },
          leverage: { type: 'number', description: 'Leverage (1-125)' },
        },
        required: ['symbol', 'quantity'],
      },
    },
    {
      name: 'binance_futures_short',
      description: 'Open a short position on Binance Futures',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair (e.g., BTCUSDT)' },
          quantity: { type: 'number', description: 'Position size' },
          leverage: { type: 'number', description: 'Leverage (1-125)' },
        },
        required: ['symbol', 'quantity'],
      },
    },
    {
      name: 'binance_futures_close',
      description: 'Close a position on Binance Futures',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair to close (e.g., BTCUSDT)' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'binance_futures_price',
      description: 'Get current mark price for a Binance Futures symbol',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair (e.g., BTCUSDT)' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'binance_futures_funding',
      description: 'Get funding rate for a Binance Futures symbol',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair (e.g., BTCUSDT)' },
        },
        required: ['symbol'],
      },
    },

    // Bybit Futures
    {
      name: 'bybit_balance',
      description: 'Get Bybit account balance',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'bybit_positions',
      description: 'Get open positions on Bybit',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'bybit_orders',
      description: 'Get open orders on Bybit',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Optional: filter by symbol (e.g., BTCUSDT)' },
        },
      },
    },
    {
      name: 'bybit_long',
      description: 'Open a long position on Bybit',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair (e.g., BTCUSDT)' },
          qty: { type: 'number', description: 'Position size' },
          leverage: { type: 'number', description: 'Leverage (1-100)' },
        },
        required: ['symbol', 'qty'],
      },
    },
    {
      name: 'bybit_short',
      description: 'Open a short position on Bybit',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair (e.g., BTCUSDT)' },
          qty: { type: 'number', description: 'Position size' },
          leverage: { type: 'number', description: 'Leverage (1-100)' },
        },
        required: ['symbol', 'qty'],
      },
    },
    {
      name: 'bybit_close',
      description: 'Close a position on Bybit',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair to close (e.g., BTCUSDT)' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'bybit_price',
      description: 'Get current mark price for a Bybit symbol',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair (e.g., BTCUSDT)' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'bybit_funding',
      description: 'Get funding rate for a Bybit symbol',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair (e.g., BTCUSDT)' },
        },
        required: ['symbol'],
      },
    },

    // MEXC Futures
    {
      name: 'mexc_balance',
      description: 'Get MEXC Futures account balance',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'mexc_positions',
      description: 'Get open positions on MEXC Futures',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'mexc_orders',
      description: 'Get open orders on MEXC Futures',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Optional: filter by symbol (e.g., BTC_USDT)' },
        },
      },
    },
    {
      name: 'mexc_long',
      description: 'Open a long position on MEXC Futures (no KYC, 200x leverage)',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair (e.g., BTC_USDT - note underscore)' },
          vol: { type: 'number', description: 'Number of contracts' },
          leverage: { type: 'number', description: 'Leverage (1-200)' },
        },
        required: ['symbol', 'vol'],
      },
    },
    {
      name: 'mexc_short',
      description: 'Open a short position on MEXC Futures (no KYC, 200x leverage)',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair (e.g., BTC_USDT - note underscore)' },
          vol: { type: 'number', description: 'Number of contracts' },
          leverage: { type: 'number', description: 'Leverage (1-200)' },
        },
        required: ['symbol', 'vol'],
      },
    },
    {
      name: 'mexc_close',
      description: 'Close a position on MEXC Futures',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair to close (e.g., BTC_USDT)' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'mexc_price',
      description: 'Get current mark price for a MEXC Futures symbol',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair (e.g., BTC_USDT)' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'mexc_funding',
      description: 'Get funding rate for a MEXC Futures symbol',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Trading pair (e.g., BTC_USDT)' },
        },
        required: ['symbol'],
      },
    },

    // Hyperliquid (69% perps market share)
    {
      name: 'hyperliquid_balance',
      description: 'Get Hyperliquid account balance and positions',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'hyperliquid_positions',
      description: 'Get open perp positions on Hyperliquid',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'hyperliquid_orders',
      description: 'Get open orders on Hyperliquid',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'hyperliquid_long',
      description: 'Open a long position on Hyperliquid',
      input_schema: {
        type: 'object',
        properties: {
          coin: { type: 'string', description: 'Asset (e.g., BTC, ETH)' },
          size: { type: 'number', description: 'Position size' },
          price: { type: 'number', description: 'Limit price (omit for market order)' },
          leverage: { type: 'number', description: 'Leverage (1-50)' },
        },
        required: ['coin', 'size'],
      },
    },
    {
      name: 'hyperliquid_short',
      description: 'Open a short position on Hyperliquid',
      input_schema: {
        type: 'object',
        properties: {
          coin: { type: 'string', description: 'Asset (e.g., BTC, ETH)' },
          size: { type: 'number', description: 'Position size' },
          price: { type: 'number', description: 'Limit price (omit for market order)' },
          leverage: { type: 'number', description: 'Leverage (1-50)' },
        },
        required: ['coin', 'size'],
      },
    },
    {
      name: 'hyperliquid_close',
      description: 'Close a position on Hyperliquid',
      input_schema: {
        type: 'object',
        properties: {
          coin: { type: 'string', description: 'Asset to close (e.g., BTC)' },
        },
        required: ['coin'],
      },
    },
    {
      name: 'hyperliquid_cancel',
      description: 'Cancel an order on Hyperliquid',
      input_schema: {
        type: 'object',
        properties: {
          coin: { type: 'string', description: 'Asset' },
          oid: { type: 'number', description: 'Order ID to cancel' },
        },
        required: ['coin', 'oid'],
      },
    },
    {
      name: 'hyperliquid_cancel_all',
      description: 'Cancel all orders on Hyperliquid',
      input_schema: {
        type: 'object',
        properties: {
          coin: { type: 'string', description: 'Optional: only cancel orders for this asset' },
        },
      },
    },
    {
      name: 'hyperliquid_price',
      description: 'Get current mid prices on Hyperliquid',
      input_schema: {
        type: 'object',
        properties: {
          coin: { type: 'string', description: 'Optional: specific asset' },
        },
      },
    },
    {
      name: 'hyperliquid_funding',
      description: 'Get funding rates on Hyperliquid',
      input_schema: {
        type: 'object',
        properties: {
          coin: { type: 'string', description: 'Optional: specific asset' },
        },
      },
    },
    {
      name: 'hyperliquid_leverage',
      description: 'Set leverage for a Hyperliquid position',
      input_schema: {
        type: 'object',
        properties: {
          coin: { type: 'string', description: 'Asset' },
          leverage: { type: 'number', description: 'Leverage (1-50)' },
          isCross: { type: 'boolean', description: 'Cross margin mode (default: false = isolated)' },
        },
        required: ['coin', 'leverage'],
      },
    },

    // ============================================
    // SOLANA WALLET + AGGREGATORS (Jupiter + Pump.fun)
    // ============================================
    {
      name: 'solana_address',
      description: 'Get your Solana wallet public address.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'solana_jupiter_swap',
      description: 'Swap tokens on Solana using Jupiter (aggregates major DEXes).',
      input_schema: {
        type: 'object',
        properties: {
          input_mint: { type: 'string', description: 'Input mint address' },
          output_mint: { type: 'string', description: 'Output mint address' },
          amount: { type: 'string', description: 'Amount in smallest units (string integer)' },
          slippage_bps: { type: 'number', description: 'Slippage in basis points (default 50)' },
          swap_mode: { type: 'string', description: 'ExactIn or ExactOut', enum: ['ExactIn', 'ExactOut'] },
          priority_fee_lamports: { type: 'number', description: 'Optional priority fee in lamports' },
          only_direct_routes: { type: 'boolean', description: 'Restrict to direct routes only' },
        },
        required: ['input_mint', 'output_mint', 'amount'],
      },
    },
    {
      name: 'solana_jupiter_quote',
      description: 'Get a Jupiter swap quote without executing. Use for price discovery.',
      input_schema: {
        type: 'object',
        properties: {
          input_mint: { type: 'string', description: 'Input mint address' },
          output_mint: { type: 'string', description: 'Output mint address' },
          amount: { type: 'string', description: 'Amount in smallest units' },
          slippage_bps: { type: 'number', description: 'Slippage in basis points' },
          swap_mode: { type: 'string', enum: ['ExactIn', 'ExactOut'] },
        },
        required: ['input_mint', 'output_mint', 'amount'],
      },
    },
    {
      name: 'solana_jupiter_limit_order_create',
      description: 'Create a Jupiter limit order. Order executes when market reaches target price.',
      input_schema: {
        type: 'object',
        properties: {
          input_mint: { type: 'string', description: 'Token to sell' },
          output_mint: { type: 'string', description: 'Token to buy' },
          in_amount: { type: 'string', description: 'Amount to sell (smallest units)' },
          out_amount: { type: 'string', description: 'Amount to receive (smallest units)' },
          expired_at_ms: { type: 'number', description: 'Expiration timestamp in milliseconds (optional)' },
        },
        required: ['input_mint', 'output_mint', 'in_amount', 'out_amount'],
      },
    },
    {
      name: 'solana_jupiter_limit_order_cancel',
      description: 'Cancel a Jupiter limit order.',
      input_schema: {
        type: 'object',
        properties: {
          order_pubkey: { type: 'string', description: 'Order public key to cancel' },
        },
        required: ['order_pubkey'],
      },
    },
    {
      name: 'solana_jupiter_limit_orders_list',
      description: 'List open Jupiter limit orders for a wallet.',
      input_schema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Wallet address (defaults to your wallet)' },
          input_mint: { type: 'string', description: 'Filter by input mint' },
          output_mint: { type: 'string', description: 'Filter by output mint' },
        },
      },
    },
    {
      name: 'solana_jupiter_limit_order_get',
      description: 'Get details of a specific Jupiter limit order.',
      input_schema: {
        type: 'object',
        properties: {
          order_pubkey: { type: 'string', description: 'Order public key' },
        },
        required: ['order_pubkey'],
      },
    },
    {
      name: 'solana_jupiter_limit_order_history',
      description: 'Get limit order history (filled/cancelled) for a wallet.',
      input_schema: {
        type: 'object',
        properties: {
          wallet: { type: 'string', description: 'Wallet address' },
          take: { type: 'number', description: 'Number of results (default 50)' },
        },
        required: ['wallet'],
      },
    },
    {
      name: 'solana_jupiter_trade_history',
      description: 'Get trade fill history for a wallet.',
      input_schema: {
        type: 'object',
        properties: {
          wallet: { type: 'string', description: 'Wallet address' },
          take: { type: 'number', description: 'Number of results (default 50)' },
        },
        required: ['wallet'],
      },
    },
    {
      name: 'solana_jupiter_dca_create',
      description: 'Create a Jupiter DCA (Dollar Cost Averaging) order for automated periodic swaps.',
      input_schema: {
        type: 'object',
        properties: {
          input_mint: { type: 'string', description: 'Token to sell' },
          output_mint: { type: 'string', description: 'Token to buy' },
          in_amount: { type: 'string', description: 'Total amount to DCA (smallest units)' },
          in_amount_per_cycle: { type: 'string', description: 'Amount per swap cycle' },
          cycle_seconds_apart: { type: 'number', description: 'Seconds between swaps (min 30)' },
          min_out_amount_per_cycle: { type: 'string', description: 'Min output per cycle (optional)' },
          max_out_amount_per_cycle: { type: 'string', description: 'Max output per cycle (optional)' },
          start_at_ms: { type: 'number', description: 'Start time in ms (optional)' },
        },
        required: ['input_mint', 'output_mint', 'in_amount', 'in_amount_per_cycle', 'cycle_seconds_apart'],
      },
    },
    {
      name: 'solana_jupiter_dca_close',
      description: 'Close a Jupiter DCA order and withdraw remaining funds.',
      input_schema: {
        type: 'object',
        properties: {
          dca_pubkey: { type: 'string', description: 'DCA account public key' },
        },
        required: ['dca_pubkey'],
      },
    },
    {
      name: 'solana_jupiter_dca_deposit',
      description: 'Deposit additional funds into an existing DCA order.',
      input_schema: {
        type: 'object',
        properties: {
          dca_pubkey: { type: 'string', description: 'DCA account public key' },
          amount: { type: 'string', description: 'Amount to deposit (smallest units)' },
        },
        required: ['dca_pubkey', 'amount'],
      },
    },
    {
      name: 'solana_jupiter_dca_withdraw',
      description: 'Withdraw funds from a DCA order.',
      input_schema: {
        type: 'object',
        properties: {
          dca_pubkey: { type: 'string', description: 'DCA account public key' },
          withdraw_in_amount: { type: 'string', description: 'Amount of input token to withdraw' },
          withdraw_out_amount: { type: 'string', description: 'Amount of output token to withdraw' },
        },
        required: ['dca_pubkey'],
      },
    },
    {
      name: 'solana_jupiter_dca_list',
      description: 'List active DCA orders for a wallet.',
      input_schema: {
        type: 'object',
        properties: {
          user: { type: 'string', description: 'Wallet address (defaults to your wallet)' },
          input_mint: { type: 'string', description: 'Filter by input mint' },
          output_mint: { type: 'string', description: 'Filter by output mint' },
        },
      },
    },
    {
      name: 'solana_jupiter_dca_get',
      description: 'Get details of a specific DCA account.',
      input_schema: {
        type: 'object',
        properties: {
          dca_pubkey: { type: 'string', description: 'DCA account public key' },
        },
        required: ['dca_pubkey'],
      },
    },
    {
      name: 'solana_jupiter_dca_balance',
      description: 'Get current balances for a DCA account.',
      input_schema: {
        type: 'object',
        properties: {
          dca_pubkey: { type: 'string', description: 'DCA account public key' },
        },
        required: ['dca_pubkey'],
      },
    },
    {
      name: 'solana_jupiter_dca_fills',
      description: 'Get fill history for a DCA account.',
      input_schema: {
        type: 'object',
        properties: {
          dca_pubkey: { type: 'string', description: 'DCA account public key' },
        },
        required: ['dca_pubkey'],
      },
    },
    {
      name: 'pumpfun_trade',
      description: 'Trade tokens on pump.fun using local transaction signing.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'buy or sell', enum: ['buy', 'sell'] },
          mint: { type: 'string', description: 'Token mint address' },
          amount: { type: 'string', description: 'Amount to trade (number or percent string like "50%")' },
          denominated_in_sol: { type: 'boolean', description: 'If true, amount is in SOL; otherwise token units' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 100 = 1%)' },
          priority_fee_lamports: { type: 'number', description: 'Optional priority fee in lamports' },
          pool: { type: 'string', description: 'Optional pool override (e.g., pump)' },
        },
        required: ['action', 'mint', 'amount', 'denominated_in_sol'],
      },
    },
    {
      name: 'pumpfun_trending',
      description: 'Get trending tokens on Pump.fun.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of results (default 20)' },
          offset: { type: 'number', description: 'Pagination offset' },
          include_nsfw: { type: 'boolean', description: 'Include NSFW tokens' },
        },
      },
    },
    {
      name: 'pumpfun_new',
      description: 'Get recently created tokens on Pump.fun.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of results (default 20)' },
          offset: { type: 'number', description: 'Pagination offset' },
          include_nsfw: { type: 'boolean', description: 'Include NSFW tokens' },
        },
      },
    },
    {
      name: 'pumpfun_live',
      description: 'Get currently trading (live) tokens on Pump.fun.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of results (default 20)' },
          offset: { type: 'number', description: 'Pagination offset' },
          include_nsfw: { type: 'boolean', description: 'Include NSFW tokens' },
        },
      },
    },
    {
      name: 'pumpfun_graduated',
      description: 'Get tokens that graduated to PumpSwap from Pump.fun.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of results (default 20)' },
          offset: { type: 'number', description: 'Pagination offset' },
          include_nsfw: { type: 'boolean', description: 'Include NSFW tokens' },
        },
      },
    },
    {
      name: 'pumpfun_search',
      description: 'Search Pump.fun tokens by name or symbol.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (name or symbol)' },
          limit: { type: 'number', description: 'Number of results (default 20)' },
          offset: { type: 'number', description: 'Pagination offset' },
          include_nsfw: { type: 'boolean', description: 'Include NSFW tokens' },
        },
        required: ['query'],
      },
    },
    {
      name: 'pumpfun_volatile',
      description: 'Get high volatility tokens on Pump.fun.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of results (default 20)' },
          offset: { type: 'number', description: 'Pagination offset' },
          include_nsfw: { type: 'boolean', description: 'Include NSFW tokens' },
        },
      },
    },
    {
      name: 'pumpfun_token',
      description: 'Get full token info from Pump.fun by mint address.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'pumpfun_price',
      description: 'Get current price and 24h stats for a Pump.fun token.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'pumpfun_holders',
      description: 'Get top holders for a Pump.fun token.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
          limit: { type: 'number', description: 'Number of results (default 20)' },
          offset: { type: 'number', description: 'Pagination offset' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'pumpfun_trades',
      description: 'Get recent trades for a Pump.fun token.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
          limit: { type: 'number', description: 'Number of results (default 50)' },
          offset: { type: 'number', description: 'Pagination offset' },
          minimum_size: { type: 'number', description: 'Minimum trade size in SOL' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'pumpfun_chart',
      description: 'Get OHLCV price chart data for a Pump.fun token.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
          interval: { type: 'string', description: 'Interval: 1m, 5m, 15m, 1h, 4h, 1d', enum: ['1m', '5m', '15m', '1h', '4h', '1d'] },
          limit: { type: 'number', description: 'Number of candles (default 100)' },
          offset: { type: 'number', description: 'Pagination offset' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'pumpfun_create',
      description: 'Create a new token on Pump.fun.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Token name' },
          symbol: { type: 'string', description: 'Token symbol/ticker' },
          description: { type: 'string', description: 'Token description' },
          image_url: { type: 'string', description: 'Token image URL' },
          twitter: { type: 'string', description: 'Twitter URL' },
          telegram: { type: 'string', description: 'Telegram URL' },
          website: { type: 'string', description: 'Website URL' },
          initial_buy_sol: { type: 'number', description: 'Initial buy amount in SOL' },
        },
        required: ['name', 'symbol', 'description'],
      },
    },
    {
      name: 'pumpfun_claim',
      description: 'Claim creator fees for a Pump.fun token you created.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'pumpfun_koth',
      description: 'Get King of the Hill tokens on Pump.fun (30-35K mcap range).',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'pumpfun_for_you',
      description: 'Get personalized token recommendations on Pump.fun.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'pumpfun_similar',
      description: 'Get tokens similar to a given Pump.fun token.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address to find similar tokens for' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'pumpfun_user_coins',
      description: 'Get all tokens created by a specific wallet address on Pump.fun.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address of the creator' },
        },
        required: ['address'],
      },
    },
    {
      name: 'pumpfun_metas',
      description: 'Get trending narratives/metas (popular keywords) on Pump.fun.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'pumpfun_latest_trades',
      description: 'Get latest trades across all tokens on Pump.fun platform.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of results (default 50)' },
        },
      },
    },
    {
      name: 'pumpfun_sol_price',
      description: 'Get current SOL price from Pump.fun.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'pumpfun_ipfs_upload',
      description: 'Upload token metadata to IPFS for Pump.fun token creation.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Token name' },
          symbol: { type: 'string', description: 'Token symbol' },
          description: { type: 'string', description: 'Token description' },
          image_url: { type: 'string', description: 'Image URL to upload' },
          twitter: { type: 'string', description: 'Twitter URL' },
          telegram: { type: 'string', description: 'Telegram URL' },
          website: { type: 'string', description: 'Website URL' },
        },
        required: ['name', 'symbol', 'description'],
      },
    },
    // Pump.fun On-Chain Tools
    {
      name: 'pumpfun_bonding_curve',
      description: 'Get on-chain bonding curve state for a Pump.fun token including virtual/real reserves.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'pumpfun_price_onchain',
      description: 'Get token price calculated directly from on-chain bonding curve state (more accurate than API).',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
          sol_price_usd: { type: 'number', description: 'Optional SOL price in USD for USD conversion' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'pumpfun_buy_quote',
      description: 'Calculate how many tokens you get for X SOL on Pump.fun, with price impact.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
          sol_amount: { type: 'number', description: 'SOL amount to spend' },
          fee_bps: { type: 'number', description: 'Fee in basis points (default 100 = 1%)' },
        },
        required: ['mint', 'sol_amount'],
      },
    },
    {
      name: 'pumpfun_sell_quote',
      description: 'Calculate how much SOL you get for X tokens on Pump.fun, with price impact.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
          token_amount: { type: 'number', description: 'Token amount to sell (in token units, not lamports)' },
          fee_bps: { type: 'number', description: 'Fee in basis points (default 100 = 1%)' },
        },
        required: ['mint', 'token_amount'],
      },
    },
    {
      name: 'pumpfun_graduation_check',
      description: 'Check if a Pump.fun token has graduated to PumpSwap.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'pumpfun_portal_quote',
      description: 'Get swap quote from PumpPortal API (supports both pump and raydium pools).',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
          action: { type: 'string', enum: ['buy', 'sell'], description: 'Buy or sell' },
          amount: { type: 'string', description: 'Amount (SOL for buy, tokens for sell)' },
          pool: { type: 'string', description: 'Pool to use: pump, raydium, or auto' },
        },
        required: ['mint', 'action', 'amount'],
      },
    },
    {
      name: 'pumpfun_balance',
      description: 'Get token balance for a wallet on a Pump.fun token.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
          owner: { type: 'string', description: 'Wallet address (defaults to your wallet)' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'pumpfun_holdings',
      description: 'Get all Pump.fun tokens held by a wallet.',
      input_schema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Wallet address (defaults to your wallet)' },
        },
      },
    },
    {
      name: 'pumpfun_best_pool',
      description: 'Determine best execution venue for a token (pump bonding curve or PumpSwap after graduation).',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
        },
        required: ['mint'],
      },
    },
    // Pump.fun Swarm Trading
    {
      name: 'swarm_wallets',
      description: 'List all wallets in the Pump.fun trading swarm.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'swarm_balances',
      description: 'Get SOL balances for all swarm wallets.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'swarm_buy',
      description: 'Execute coordinated buy across up to 20 swarm wallets. Supports Pump.fun (default), Bags.fm, and Meteora DLMM.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
          amount_per_wallet: { type: 'number', description: 'SOL amount per wallet' },
          wallet_ids: { type: 'array', items: { type: 'string' }, description: 'Specific wallet IDs (optional)' },
          execution_mode: { type: 'string', enum: ['parallel', 'bundle', 'multi-bundle', 'sequential'], description: 'Execution mode: parallel (fastest), bundle (atomic ≤5), multi-bundle (atomic >5), sequential (stealthy)' },
          slippage_bps: { type: 'number', description: 'Slippage in basis points' },
          pool: { type: 'string', description: 'Pool: pump, raydium, auto (for pumpfun only)' },
          preset: { type: 'string', description: 'Preset name to apply (fast, atomic, stealth, aggressive, safe, or custom)' },
          dex: { type: 'string', enum: ['pumpfun', 'bags', 'meteora', 'auto'], description: 'DEX to use: pumpfun (default), bags (Bags.fm), meteora (DLMM), or auto' },
          pool_address: { type: 'string', description: 'Specific pool address (for Meteora)' },
        },
        required: ['mint', 'amount_per_wallet'],
      },
    },
    {
      name: 'swarm_sell',
      description: 'Execute coordinated sell across up to 20 swarm wallets. Supports Pump.fun (default), Bags.fm, and Meteora DLMM.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
          amount_per_wallet: { type: 'string', description: 'Amount per wallet (number or "100%" for full sell)' },
          wallet_ids: { type: 'array', items: { type: 'string' }, description: 'Specific wallet IDs (optional)' },
          execution_mode: { type: 'string', enum: ['parallel', 'bundle', 'multi-bundle', 'sequential'], description: 'Execution mode: parallel (fastest), bundle (atomic ≤5), multi-bundle (atomic >5), sequential (stealthy)' },
          slippage_bps: { type: 'number', description: 'Slippage in basis points' },
          pool: { type: 'string', description: 'Pool: pump, raydium, auto (for pumpfun only)' },
          preset: { type: 'string', description: 'Preset name to apply (fast, atomic, stealth, aggressive, safe, or custom)' },
          dex: { type: 'string', enum: ['pumpfun', 'bags', 'meteora', 'auto'], description: 'DEX to use: pumpfun (default), bags (Bags.fm), meteora (DLMM), or auto' },
          pool_address: { type: 'string', description: 'Specific pool address (for Meteora)' },
        },
        required: ['mint', 'amount_per_wallet'],
      },
    },
    {
      name: 'swarm_position',
      description: 'Get cached swarm position for a Pump.fun token across all wallets.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'swarm_refresh',
      description: 'Refresh token positions from chain for all swarm wallets. Required before selling.',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address to refresh positions for' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'swarm_enable',
      description: 'Enable a wallet in the trading swarm.',
      input_schema: {
        type: 'object',
        properties: {
          wallet_id: { type: 'string', description: 'Wallet ID to enable' },
        },
        required: ['wallet_id'],
      },
    },
    {
      name: 'swarm_disable',
      description: 'Disable a wallet in the trading swarm.',
      input_schema: {
        type: 'object',
        properties: {
          wallet_id: { type: 'string', description: 'Wallet ID to disable' },
        },
        required: ['wallet_id'],
      },
    },
    // Swarm Presets
    {
      name: 'swarm_preset_save',
      description: 'Save a swarm trading preset for reuse. Presets store execution settings that can be applied to trades.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Preset name (unique per user, case-insensitive)' },
          type: { type: 'string', enum: ['strategy', 'token', 'wallet_group'], description: 'Preset type: strategy (trading settings), token (mint-specific), wallet_group (wallet combinations)' },
          description: { type: 'string', description: 'Optional description' },
          config: {
            type: 'object',
            description: 'Preset configuration',
            properties: {
              mint: { type: 'string', description: 'Token mint address (for token presets)' },
              amountPerWallet: { type: 'number', description: 'Default SOL amount per wallet' },
              slippageBps: { type: 'number', description: 'Slippage in basis points (500 = 5%)' },
              pool: { type: 'string', enum: ['pump', 'raydium', 'auto'], description: 'Pool preference' },
              executionMode: { type: 'string', enum: ['parallel', 'bundle', 'multi-bundle', 'sequential'], description: 'Execution mode' },
              walletIds: { type: 'array', items: { type: 'string' }, description: 'Wallet IDs for wallet_group presets' },
              amountVariancePct: { type: 'number', description: 'Random variance percentage for amounts' },
              dex: { type: 'string', enum: ['pumpfun', 'bags', 'meteora', 'auto'], description: 'DEX to use: pumpfun (default), bags, meteora, auto' },
              poolAddress: { type: 'string', description: 'Specific pool address (for Meteora)' },
            },
          },
          user_id: { type: 'string', description: 'User ID (optional, defaults to agent_user)' },
        },
        required: ['name', 'type', 'config'],
      },
    },
    {
      name: 'swarm_preset_list',
      description: 'List saved swarm presets. Includes both user presets and built-in presets (fast, atomic, stealth, aggressive, safe).',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['strategy', 'token', 'wallet_group'], description: 'Filter by preset type' },
          user_id: { type: 'string', description: 'User ID (optional, defaults to agent_user)' },
        },
      },
    },
    {
      name: 'swarm_preset_get',
      description: 'Get a specific swarm preset by name. Returns full configuration details.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Preset name to retrieve' },
          user_id: { type: 'string', description: 'User ID (optional, defaults to agent_user)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'swarm_preset_delete',
      description: 'Delete a saved swarm preset. Built-in presets cannot be deleted.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Preset name to delete' },
          user_id: { type: 'string', description: 'User ID (optional, defaults to agent_user)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'meteora_dlmm_swap',
      description: 'Swap tokens on Meteora DLMM using direct on-chain transaction.',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          input_mint: { type: 'string', description: 'Input token mint' },
          output_mint: { type: 'string', description: 'Output token mint' },
          in_amount: { type: 'string', description: 'Input amount in base units (string integer)' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
          allow_partial_fill: { type: 'boolean', description: 'Allow partial fills' },
          max_extra_bin_arrays: { type: 'number', description: 'Max extra bin arrays (default 3)' },
        },
        required: ['pool_address', 'input_mint', 'output_mint', 'in_amount'],
      },
    },
    {
      name: 'raydium_swap',
      description: 'Swap tokens on Raydium using Raydium transaction API.',
      input_schema: {
        type: 'object',
        properties: {
          input_mint: { type: 'string', description: 'Input token mint' },
          output_mint: { type: 'string', description: 'Output token mint' },
          amount: { type: 'string', description: 'Amount in base units (string integer)' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
          swap_mode: { type: 'string', description: 'BaseIn or BaseOut', enum: ['BaseIn', 'BaseOut'] },
          tx_version: { type: 'string', description: 'V0 or LEGACY', enum: ['V0', 'LEGACY'] },
          compute_unit_price_micro_lamports: { type: 'number', description: 'Optional compute unit price' },
        },
        required: ['input_mint', 'output_mint', 'amount'],
      },
    },
    {
      name: 'orca_whirlpool_swap',
      description: 'Swap tokens on Orca Whirlpools directly.',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'Whirlpool pool address' },
          input_mint: { type: 'string', description: 'Input token mint' },
          amount: { type: 'string', description: 'Input amount in base units (string integer)' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
        },
        required: ['pool_address', 'input_mint', 'amount'],
      },
    },
    {
      name: 'drift_direct_place_order',
      description: 'Place a Drift order directly via Drift SDK (spot or perp).',
      input_schema: {
        type: 'object',
        properties: {
          market_type: { type: 'string', description: 'perp or spot', enum: ['perp', 'spot'] },
          market_index: { type: 'number', description: 'Market index' },
          side: { type: 'string', description: 'buy or sell', enum: ['buy', 'sell'] },
          order_type: { type: 'string', description: 'limit or market', enum: ['limit', 'market'] },
          base_amount: { type: 'string', description: 'Base asset amount (string integer)' },
          price: { type: 'string', description: 'Price in native units (string integer)' },
        },
        required: ['market_type', 'market_index', 'side', 'order_type', 'base_amount'],
      },
    },
    {
      name: 'meteora_dlmm_pools',
      description: 'List Meteora DLMM pools (optionally filtered by token mints).',
      input_schema: {
        type: 'object',
        properties: {
          token_symbols: { type: 'array', items: { type: 'string' }, description: 'Token symbols (e.g., SOL, USDC)' },
          token_mints: { type: 'array', items: { type: 'string' }, description: 'Token mint addresses to match' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'raydium_pools',
      description: 'List Raydium pools from the public pool list API.',
      input_schema: {
        type: 'object',
        properties: {
          token_symbols: { type: 'array', items: { type: 'string' }, description: 'Token symbols (e.g., SOL, USDC)' },
          token_mints: { type: 'array', items: { type: 'string' }, description: 'Token mint addresses to match' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'raydium_quote',
      description: 'Get a swap quote from Raydium without executing',
      input_schema: {
        type: 'object',
        properties: {
          input_mint: { type: 'string', description: 'Input token mint' },
          output_mint: { type: 'string', description: 'Output token mint' },
          amount: { type: 'string', description: 'Amount in base units (lamports for SOL)' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
          swap_mode: { type: 'string', description: 'BaseIn or BaseOut', enum: ['BaseIn', 'BaseOut'] },
        },
        required: ['input_mint', 'output_mint', 'amount'],
      },
    },
    // Raydium CLMM (Concentrated Liquidity) Tools
    {
      name: 'raydium_clmm_positions',
      description: 'List your Raydium CLMM (concentrated liquidity) positions',
      input_schema: {
        type: 'object',
        properties: {
          pool_id: { type: 'string', description: 'Optional: filter by pool ID' },
        },
      },
    },
    {
      name: 'raydium_clmm_create_position',
      description: 'Create a new concentrated liquidity position in a Raydium CLMM pool',
      input_schema: {
        type: 'object',
        properties: {
          pool_id: { type: 'string', description: 'CLMM pool ID' },
          price_lower: { type: 'number', description: 'Lower price bound' },
          price_upper: { type: 'number', description: 'Upper price bound' },
          base_amount: { type: 'string', description: 'Amount of base token in lamports' },
          base_in: { type: 'boolean', description: 'true=mintA is input, false=mintB is input' },
          slippage: { type: 'number', description: 'Slippage tolerance (0.01 = 1%)' },
        },
        required: ['pool_id', 'price_lower', 'price_upper', 'base_amount'],
      },
    },
    {
      name: 'raydium_clmm_increase_liquidity',
      description: 'Add more liquidity to an existing Raydium CLMM position',
      input_schema: {
        type: 'object',
        properties: {
          pool_id: { type: 'string', description: 'CLMM pool ID' },
          position_nft_mint: { type: 'string', description: 'Position NFT mint address' },
          amount_a: { type: 'string', description: 'Amount of token A to add (lamports)' },
          amount_b: { type: 'string', description: 'Amount of token B to add (lamports)' },
          slippage: { type: 'number', description: 'Slippage tolerance (0.05 = 5%)' },
        },
        required: ['pool_id', 'position_nft_mint'],
      },
    },
    {
      name: 'raydium_clmm_decrease_liquidity',
      description: 'Remove liquidity from a Raydium CLMM position',
      input_schema: {
        type: 'object',
        properties: {
          pool_id: { type: 'string', description: 'CLMM pool ID' },
          position_nft_mint: { type: 'string', description: 'Position NFT mint address' },
          liquidity: { type: 'string', description: 'Amount of liquidity to remove (raw)' },
          percent_bps: { type: 'number', description: 'Or specify percentage in bps (5000 = 50%)' },
          close_position: { type: 'boolean', description: 'Close position after removing all liquidity' },
          slippage: { type: 'number', description: 'Slippage tolerance' },
        },
        required: ['pool_id', 'position_nft_mint'],
      },
    },
    {
      name: 'raydium_clmm_close_position',
      description: 'Close a Raydium CLMM position (must have zero liquidity)',
      input_schema: {
        type: 'object',
        properties: {
          pool_id: { type: 'string', description: 'CLMM pool ID' },
          position_nft_mint: { type: 'string', description: 'Position NFT mint address' },
        },
        required: ['pool_id', 'position_nft_mint'],
      },
    },
    {
      name: 'raydium_clmm_harvest',
      description: 'Harvest rewards from Raydium CLMM positions',
      input_schema: {
        type: 'object',
        properties: {
          pool_id: { type: 'string', description: 'Optional: harvest only from specific pool' },
        },
      },
    },
    {
      name: 'raydium_clmm_swap',
      description: 'Swap directly on a specific Raydium CLMM pool',
      input_schema: {
        type: 'object',
        properties: {
          pool_id: { type: 'string', description: 'CLMM pool ID' },
          input_mint: { type: 'string', description: 'Input token mint' },
          amount_in: { type: 'string', description: 'Amount to swap (lamports)' },
          slippage: { type: 'number', description: 'Slippage tolerance (0.01 = 1%)' },
        },
        required: ['pool_id', 'input_mint', 'amount_in'],
      },
    },
    // Raydium AMM (V4) Liquidity Tools
    {
      name: 'raydium_amm_add_liquidity',
      description: 'Add liquidity to a Raydium AMM (v4) pool',
      input_schema: {
        type: 'object',
        properties: {
          pool_id: { type: 'string', description: 'AMM pool ID' },
          amount_a: { type: 'string', description: 'Amount of token A (lamports)' },
          amount_b: { type: 'string', description: 'Amount of token B (lamports)' },
          fixed_side: { type: 'string', description: 'Which side is fixed: a or b', enum: ['a', 'b'] },
          slippage: { type: 'number', description: 'Slippage tolerance (0.01 = 1%)' },
        },
        required: ['pool_id'],
      },
    },
    {
      name: 'raydium_amm_remove_liquidity',
      description: 'Remove liquidity from a Raydium AMM (v4) pool',
      input_schema: {
        type: 'object',
        properties: {
          pool_id: { type: 'string', description: 'AMM pool ID' },
          lp_amount: { type: 'string', description: 'Amount of LP tokens to burn (lamports)' },
          slippage: { type: 'number', description: 'Slippage tolerance (0.1 = 10%)' },
        },
        required: ['pool_id', 'lp_amount'],
      },
    },
    {
      name: 'raydium_clmm_create_pool',
      description: 'Create a new Raydium CLMM pool',
      input_schema: {
        type: 'object',
        properties: {
          mint_a: { type: 'string', description: 'Token A mint address' },
          mint_b: { type: 'string', description: 'Token B mint address' },
          initial_price: { type: 'number', description: 'Initial pool price (A per B)' },
          config_index: { type: 'number', description: 'Fee tier config index (default 0)' },
        },
        required: ['mint_a', 'mint_b', 'initial_price'],
      },
    },
    {
      name: 'raydium_clmm_configs',
      description: 'Get available Raydium CLMM fee tier configurations',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'orca_whirlpool_pools',
      description: 'List Orca Whirlpool pools from offchain metadata.',
      input_schema: {
        type: 'object',
        properties: {
          token_symbols: { type: 'array', items: { type: 'string' }, description: 'Token symbols (e.g., SOL, USDC)' },
          token_mints: { type: 'array', items: { type: 'string' }, description: 'Token mint addresses to match' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'orca_whirlpool_quote',
      description: 'Get a swap quote from Orca Whirlpools without executing',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'Whirlpool pool address' },
          input_mint: { type: 'string', description: 'Input token mint' },
          amount: { type: 'string', description: 'Amount in base units (lamports for SOL)' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
        },
        required: ['pool_address', 'input_mint', 'amount'],
      },
    },
    // Orca LP Management Tools
    {
      name: 'orca_open_full_range_position',
      description: 'Open a full-range LP position in an Orca Whirlpool',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'Whirlpool pool address' },
          token_amount_a: { type: 'string', description: 'Amount of token A in base units' },
          token_amount_b: { type: 'string', description: 'Amount of token B in base units (optional)' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
        },
        required: ['pool_address', 'token_amount_a'],
      },
    },
    {
      name: 'orca_open_concentrated_position',
      description: 'Open a concentrated LP position with custom tick range in Orca Whirlpool',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'Whirlpool pool address' },
          token_amount_a: { type: 'string', description: 'Amount of token A in base units' },
          token_amount_b: { type: 'string', description: 'Amount of token B in base units (optional)' },
          tick_lower_index: { type: 'number', description: 'Lower tick index' },
          tick_upper_index: { type: 'number', description: 'Upper tick index' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
        },
        required: ['pool_address', 'token_amount_a', 'tick_lower_index', 'tick_upper_index'],
      },
    },
    {
      name: 'orca_fetch_positions',
      description: 'Fetch all Orca LP positions owned by a wallet',
      input_schema: {
        type: 'object',
        properties: {
          owner_address: { type: 'string', description: 'Wallet address (uses configured wallet if omitted)' },
        },
      },
    },
    {
      name: 'orca_increase_liquidity',
      description: 'Add more liquidity to an existing Orca position',
      input_schema: {
        type: 'object',
        properties: {
          position_address: { type: 'string', description: 'Position address' },
          token_amount_a: { type: 'string', description: 'Amount of token A to add' },
          token_amount_b: { type: 'string', description: 'Amount of token B to add' },
          liquidity_amount: { type: 'string', description: 'Liquidity amount (alternative to token amounts)' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
        },
        required: ['position_address'],
      },
    },
    {
      name: 'orca_decrease_liquidity',
      description: 'Remove liquidity from an existing Orca position',
      input_schema: {
        type: 'object',
        properties: {
          position_address: { type: 'string', description: 'Position address' },
          token_amount_a: { type: 'string', description: 'Amount of token A to remove' },
          token_amount_b: { type: 'string', description: 'Amount of token B to remove' },
          liquidity_amount: { type: 'string', description: 'Liquidity amount (alternative to token amounts)' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
        },
        required: ['position_address'],
      },
    },
    {
      name: 'orca_harvest_position',
      description: 'Harvest fees and rewards from an Orca position',
      input_schema: {
        type: 'object',
        properties: {
          position_address: { type: 'string', description: 'Position address' },
        },
        required: ['position_address'],
      },
    },
    {
      name: 'orca_close_position',
      description: 'Close an Orca position and reclaim rent',
      input_schema: {
        type: 'object',
        properties: {
          position_address: { type: 'string', description: 'Position address' },
        },
        required: ['position_address'],
      },
    },
    {
      name: 'orca_create_pool',
      description: 'Create a new Orca Whirlpool (splash or concentrated)',
      input_schema: {
        type: 'object',
        properties: {
          token_mint_a: { type: 'string', description: 'Token A mint address' },
          token_mint_b: { type: 'string', description: 'Token B mint address' },
          pool_type: { type: 'string', description: 'splash or concentrated', enum: ['splash', 'concentrated'] },
          tick_spacing: { type: 'number', description: 'Tick spacing (for concentrated pools)' },
          initial_price: { type: 'number', description: 'Initial price (default 1.0)' },
        },
        required: ['token_mint_a', 'token_mint_b'],
      },
    },
    {
      name: 'orca_fetch_positions_in_pool',
      description: 'Fetch all LP positions in a specific Orca Whirlpool',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'Whirlpool pool address' },
        },
        required: ['pool_address'],
      },
    },
    {
      name: 'orca_find_pools_by_pair',
      description: 'Find Orca Whirlpools for a specific token pair',
      input_schema: {
        type: 'object',
        properties: {
          token_mint_a: { type: 'string', description: 'Token A mint address' },
          token_mint_b: { type: 'string', description: 'Token B mint address' },
        },
        required: ['token_mint_a', 'token_mint_b'],
      },
    },
    {
      name: 'orca_harvest_all_positions',
      description: 'Harvest fees and rewards from multiple Orca positions',
      input_schema: {
        type: 'object',
        properties: {
          position_addresses: { type: 'array', items: { type: 'string' }, description: 'Array of position addresses' },
        },
        required: ['position_addresses'],
      },
    },
    {
      name: 'meteora_dlmm_quote',
      description: 'Get a swap quote from Meteora DLMM without executing',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          input_mint: { type: 'string', description: 'Input token mint' },
          in_amount: { type: 'string', description: 'Amount in base units (lamports for SOL)' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
        },
        required: ['pool_address', 'input_mint', 'in_amount'],
      },
    },
    // Meteora LP Management Tools
    {
      name: 'meteora_dlmm_quote_exact_out',
      description: 'Get a swap quote with exact output amount from Meteora DLMM',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          output_mint: { type: 'string', description: 'Output token mint' },
          out_amount: { type: 'string', description: 'Exact output amount in base units' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
        },
        required: ['pool_address', 'output_mint', 'out_amount'],
      },
    },
    {
      name: 'meteora_dlmm_swap_exact_out',
      description: 'Execute a Meteora DLMM swap with exact output amount',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          input_mint: { type: 'string', description: 'Input token mint' },
          output_mint: { type: 'string', description: 'Output token mint' },
          out_amount: { type: 'string', description: 'Exact output amount in base units' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
        },
        required: ['pool_address', 'input_mint', 'output_mint', 'out_amount'],
      },
    },
    {
      name: 'meteora_dlmm_open_position',
      description: 'Open a new LP position on Meteora DLMM with liquidity',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          total_x_amount: { type: 'string', description: 'Amount of token X in base units' },
          total_y_amount: { type: 'string', description: 'Amount of token Y in base units' },
          strategy_type: { type: 'string', description: 'Strategy type', enum: ['Spot', 'BidAsk', 'Curve'] },
          min_bin_id: { type: 'number', description: 'Minimum bin ID (optional)' },
          max_bin_id: { type: 'number', description: 'Maximum bin ID (optional)' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
        },
        required: ['pool_address', 'total_x_amount', 'total_y_amount'],
      },
    },
    {
      name: 'meteora_dlmm_fetch_positions',
      description: 'Fetch LP positions for a user on Meteora DLMM',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address (optional - fetches all pools if omitted)' },
          user_address: { type: 'string', description: 'User wallet address (uses configured wallet if omitted)' },
        },
      },
    },
    {
      name: 'meteora_dlmm_add_liquidity',
      description: 'Add liquidity to an existing Meteora DLMM position',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          position_address: { type: 'string', description: 'Position address' },
          total_x_amount: { type: 'string', description: 'Amount of token X to add' },
          total_y_amount: { type: 'string', description: 'Amount of token Y to add' },
          strategy_type: { type: 'string', description: 'Strategy type', enum: ['Spot', 'BidAsk', 'Curve'] },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
        },
        required: ['pool_address', 'position_address'],
      },
    },
    {
      name: 'meteora_dlmm_remove_liquidity',
      description: 'Remove liquidity from a Meteora DLMM position',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          position_address: { type: 'string', description: 'Position address' },
          from_bin_id: { type: 'number', description: 'Starting bin ID' },
          to_bin_id: { type: 'number', description: 'Ending bin ID' },
          bps: { type: 'number', description: 'Percentage in basis points (5000 = 50%)' },
          should_claim_and_close: { type: 'boolean', description: 'Claim rewards and close position' },
        },
        required: ['pool_address', 'position_address', 'from_bin_id', 'to_bin_id', 'bps'],
      },
    },
    {
      name: 'meteora_dlmm_close_position',
      description: 'Close a Meteora DLMM position and recover rent',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          position_address: { type: 'string', description: 'Position address' },
        },
        required: ['pool_address', 'position_address'],
      },
    },
    {
      name: 'meteora_dlmm_claim_fees',
      description: 'Claim swap fees from a Meteora DLMM position',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          position_address: { type: 'string', description: 'Position address' },
        },
        required: ['pool_address', 'position_address'],
      },
    },
    {
      name: 'meteora_dlmm_claim_rewards',
      description: 'Claim LM rewards from a Meteora DLMM position',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          position_address: { type: 'string', description: 'Position address' },
        },
        required: ['pool_address', 'position_address'],
      },
    },
    {
      name: 'meteora_dlmm_claim_all',
      description: 'Claim all rewards (fees + LM) from a Meteora DLMM position',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          position_address: { type: 'string', description: 'Position address' },
        },
        required: ['pool_address', 'position_address'],
      },
    },
    {
      name: 'meteora_dlmm_pool_info',
      description: 'Get detailed info about a Meteora DLMM pool (active bin, fees, emissions)',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          info_type: { type: 'string', description: 'Type of info', enum: ['active_bin', 'fee_info', 'dynamic_fee', 'emission_rate', 'all'] },
        },
        required: ['pool_address'],
      },
    },
    {
      name: 'meteora_dlmm_create_pool',
      description: 'Create a new Meteora DLMM pool',
      input_schema: {
        type: 'object',
        properties: {
          token_x: { type: 'string', description: 'Token X mint address' },
          token_y: { type: 'string', description: 'Token Y mint address' },
          bin_step: { type: 'number', description: 'Bin step size' },
          active_id: { type: 'number', description: 'Initial active bin ID (default 0)' },
          fee_bps: { type: 'number', description: 'Fee in basis points' },
          customizable: { type: 'boolean', description: 'Create customizable permissionless pool' },
        },
        required: ['token_x', 'token_y', 'bin_step'],
      },
    },
    {
      name: 'meteora_dlmm_create_empty_position',
      description: 'Create an empty Meteora DLMM position without initial liquidity',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          min_bin_id: { type: 'number', description: 'Minimum bin ID' },
          max_bin_id: { type: 'number', description: 'Maximum bin ID' },
        },
        required: ['pool_address', 'min_bin_id', 'max_bin_id'],
      },
    },
    {
      name: 'meteora_dlmm_swap_with_price_impact',
      description: 'Execute Meteora DLMM swap with price impact constraint',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          input_mint: { type: 'string', description: 'Input token mint' },
          output_mint: { type: 'string', description: 'Output token mint' },
          in_amount: { type: 'string', description: 'Input amount in base units' },
          max_price_impact_bps: { type: 'number', description: 'Maximum allowed price impact in bps' },
        },
        required: ['pool_address', 'input_mint', 'output_mint', 'in_amount', 'max_price_impact_bps'],
      },
    },
    {
      name: 'meteora_dlmm_claim_all_fees',
      description: 'Claim swap fees from multiple Meteora DLMM positions',
      input_schema: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'DLMM pool address' },
          position_addresses: { type: 'array', items: { type: 'string' }, description: 'Array of position addresses' },
        },
        required: ['pool_address', 'position_addresses'],
      },
    },
    {
      name: 'solana_best_pool',
      description: 'Select the best liquidity pool across Meteora, Raydium, and Orca.',
      input_schema: {
        type: 'object',
        properties: {
          token_symbols: { type: 'array', items: { type: 'string' }, description: 'Token symbols (e.g., SOL, USDC)' },
          token_mints: { type: 'array', items: { type: 'string' }, description: 'Token mint addresses to match' },
          sort_by: { type: 'string', description: 'Sort by liquidity or volume24h', enum: ['liquidity', 'volume24h'] },
          preferred_dexes: {
            type: 'array',
            description: 'Optional DEX preference order',
            items: { type: 'string', enum: ['meteora', 'raydium', 'orca'] },
          },
          limit: { type: 'number', description: 'Max pools to consider (default 50)' },
        },
      },
    },
    {
      name: 'solana_auto_swap',
      description: 'Auto-select the best pool and execute a swap (Meteora, Raydium, or Orca).',
      input_schema: {
        type: 'object',
        properties: {
          input_mint: { type: 'string', description: 'Input token mint (optional if using symbols)' },
          output_mint: { type: 'string', description: 'Output token mint (optional if using symbols)' },
          token_symbols: { type: 'array', items: { type: 'string' }, description: 'Token symbols (e.g., SOL, USDC)' },
          amount: { type: 'string', description: 'Input amount in base units (string integer)' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
          sort_by: { type: 'string', description: 'Sort by liquidity or volume24h', enum: ['liquidity', 'volume24h'] },
          preferred_dexes: {
            type: 'array',
            description: 'Optional DEX preference order',
            items: { type: 'string', enum: ['meteora', 'raydium', 'orca'] },
          },
        },
        required: ['amount'],
      },
    },
    {
      name: 'solana_auto_route',
      description: 'Compare pool liquidity/volume across DEXes without executing a swap.',
      input_schema: {
        type: 'object',
        properties: {
          token_symbols: { type: 'array', items: { type: 'string' }, description: 'Token symbols (e.g., SOL, USDC)' },
          token_mints: { type: 'array', items: { type: 'string' }, description: 'Token mint addresses to match' },
          sort_by: { type: 'string', description: 'Sort by liquidity or volume24h', enum: ['liquidity', 'volume24h'] },
          preferred_dexes: {
            type: 'array',
            description: 'Optional DEX preference order',
            items: { type: 'string', enum: ['meteora', 'raydium', 'orca'] },
          },
          limit: { type: 'number', description: 'Max pools to return (default 20)' },
        },
      },
    },
    {
      name: 'solana_auto_quote',
      description: 'Compare best-DEX quotes (Meteora, Raydium, Orca) without executing.',
      input_schema: {
        type: 'object',
        properties: {
          token_symbols: { type: 'array', items: { type: 'string' }, description: 'Token symbols (e.g., SOL, USDC)' },
          token_mints: { type: 'array', items: { type: 'string' }, description: 'Token mint addresses to match' },
          amount: { type: 'string', description: 'Input amount in base units (string integer)' },
          slippage_bps: { type: 'number', description: 'Slippage in bps (default 50)' },
          sort_by: { type: 'string', description: 'Sort by liquidity or volume24h', enum: ['liquidity', 'volume24h'] },
          preferred_dexes: {
            type: 'array',
            description: 'Optional DEX preference order',
            items: { type: 'string', enum: ['meteora', 'raydium', 'orca'] },
          },
        },
        required: ['amount'],
      },
    },

    // ============================================
    // BAGS.FM TOOLS (Solana Token Launchpad)
    // ============================================

    {
      name: 'bags_quote',
      description: 'Get swap quote on Bags.fm',
      input_schema: {
        type: 'object',
        properties: {
          input_mint: { type: 'string', description: 'Input token mint address' },
          output_mint: { type: 'string', description: 'Output token mint address' },
          amount: { type: 'string', description: 'Amount in smallest unit (lamports for SOL where 1 SOL = 1000000000, or token base units)' },
        },
        required: ['input_mint', 'output_mint', 'amount'],
      },
    },
    {
      name: 'bags_swap',
      description: 'Execute swap on Bags.fm',
      input_schema: {
        type: 'object',
        properties: {
          input_mint: { type: 'string', description: 'Input token mint address' },
          output_mint: { type: 'string', description: 'Output token mint address' },
          amount: { type: 'string', description: 'Amount in smallest unit (lamports for SOL where 1 SOL = 1000000000, or token base units)' },
        },
        required: ['input_mint', 'output_mint', 'amount'],
      },
    },
    {
      name: 'bags_pools',
      description: 'List all Bags.fm pools',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'bags_trending',
      description: 'Get trending tokens on Bags.fm by volume',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'bags_token',
      description: 'Get full token info (metadata, creators, fees, market data)',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'bags_creators',
      description: 'Get token creators and fee shares',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'bags_lifetime_fees',
      description: 'Get total fees collected for a token',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'bags_fees',
      description: 'Check claimable fees for a wallet',
      input_schema: {
        type: 'object',
        properties: {
          wallet: { type: 'string', description: 'Wallet address' },
        },
        required: ['wallet'],
      },
    },
    {
      name: 'bags_claim',
      description: 'Claim accumulated fees',
      input_schema: {
        type: 'object',
        properties: {
          wallet: { type: 'string', description: 'Wallet address (optional, uses configured wallet)' },
        },
      },
    },
    {
      name: 'bags_claim_events',
      description: 'Get claim history for a token',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
          from: { type: 'number', description: 'Start timestamp (optional)' },
          to: { type: 'number', description: 'End timestamp (optional)' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'bags_claim_stats',
      description: 'Get per-claimer statistics for a token',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'bags_launch',
      description: 'Launch a new token on Bags.fm',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Token name' },
          symbol: { type: 'string', description: 'Token symbol' },
          description: { type: 'string', description: 'Token description' },
          image_url: { type: 'string', description: 'Token image URL (optional)' },
          twitter: { type: 'string', description: 'Twitter handle (optional)' },
          website: { type: 'string', description: 'Website URL (optional)' },
          telegram: { type: 'string', description: 'Telegram URL (optional)' },
          initial_sol: { type: 'number', description: 'Initial buy amount in SOL (optional)' },
        },
        required: ['name', 'symbol', 'description'],
      },
    },
    {
      name: 'bags_fee_config',
      description: 'Create fee share configuration for a token',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
          fee_claimers: {
            type: 'array',
            description: 'Array of { user: wallet, userBps: bps }. BPS must sum to 10000',
            items: {
              type: 'object',
              properties: {
                user: { type: 'string' },
                userBps: { type: 'number' },
              },
            },
          },
        },
        required: ['mint', 'fee_claimers'],
      },
    },
    {
      name: 'bags_wallet_lookup',
      description: 'Lookup wallet by social handle',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: 'Social provider', enum: ['twitter', 'github', 'kick', 'tiktok', 'instagram', 'onlyfans', 'solana', 'apple', 'google', 'email', 'moltbook'] },
          username: { type: 'string', description: 'Username' },
        },
        required: ['provider', 'username'],
      },
    },
    {
      name: 'bags_bulk_wallet_lookup',
      description: 'Bulk lookup wallets by social handles',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: 'Social provider', enum: ['twitter', 'github', 'kick', 'tiktok', 'instagram', 'onlyfans', 'solana', 'apple', 'google', 'email', 'moltbook'] },
          usernames: { type: 'array', items: { type: 'string' }, description: 'Usernames' },
        },
        required: ['provider', 'usernames'],
      },
    },
    {
      name: 'bags_partner_config',
      description: 'Create partner referral key',
      input_schema: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
        },
        required: ['mint'],
      },
    },
    {
      name: 'bags_partner_claim',
      description: 'Claim partner referral fees',
      input_schema: {
        type: 'object',
        properties: {
          wallet: { type: 'string', description: 'Wallet address (optional)' },
        },
      },
    },
    {
      name: 'bags_partner_stats',
      description: 'Get partner statistics',
      input_schema: {
        type: 'object',
        properties: {
          partner_key: { type: 'string', description: 'Partner key' },
        },
        required: ['partner_key'],
      },
    },

    // ============================================
    // EVM DEX TRADING TOOLS
    // ============================================

    {
      name: 'evm_swap',
      description: 'Swap tokens on EVM chains (Ethereum, Arbitrum, Optimism, Base, Polygon) using Uniswap V3 or 1inch.',
      input_schema: {
        type: 'object',
        properties: {
          chain: {
            type: 'string',
            description: 'EVM chain to use',
            enum: ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon'],
            default: 'ethereum',
          },
          input_token: { type: 'string', description: 'Input token symbol (e.g., USDC, WETH) or address' },
          output_token: { type: 'string', description: 'Output token symbol or address' },
          amount: { type: 'string', description: 'Amount to swap (in token units, e.g., "100" for 100 USDC)' },
          slippage_bps: { type: 'number', description: 'Slippage tolerance in basis points (default 50 = 0.5%)' },
          dex: { type: 'string', description: 'DEX to use', enum: ['uniswap', '1inch', 'auto'], default: 'auto' },
        },
        required: ['input_token', 'output_token', 'amount'],
      },
    },
    {
      name: 'evm_quote',
      description: 'Get swap quote without executing (compare Uniswap vs 1inch).',
      input_schema: {
        type: 'object',
        properties: {
          chain: {
            type: 'string',
            description: 'EVM chain',
            enum: ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon'],
            default: 'ethereum',
          },
          input_token: { type: 'string', description: 'Input token symbol or address' },
          output_token: { type: 'string', description: 'Output token symbol or address' },
          amount: { type: 'string', description: 'Amount to swap' },
        },
        required: ['input_token', 'output_token', 'amount'],
      },
    },
    {
      name: 'evm_balance',
      description: 'Get token balances on an EVM chain.',
      input_schema: {
        type: 'object',
        properties: {
          chain: {
            type: 'string',
            description: 'EVM chain',
            enum: ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon'],
            default: 'ethereum',
          },
          tokens: {
            type: 'array',
            items: { type: 'string' },
            description: 'Token symbols to check (e.g., ["ETH", "USDC", "WETH"])',
          },
        },
      },
    },
    {
      name: 'wormhole_quote',
      description: 'Quote a Wormhole transfer (Token Bridge or CCTP).',
      input_schema: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Mainnet, Testnet, or Devnet (default Mainnet)' },
          protocol: { type: 'string', enum: ['token_bridge', 'cctp'], description: 'Bridge protocol' },
          source_chain: { type: 'string', description: 'Source chain name (e.g., Solana, Ethereum, Base)' },
          destination_chain: { type: 'string', description: 'Destination chain name' },
          source_address: { type: 'string', description: 'Optional source address (defaults to wallet signer if available)' },
          destination_address: { type: 'string', description: 'Destination address on target chain' },
          token_address: { type: 'string', description: 'Token address or "native" (Token Bridge only)' },
          amount: { type: 'string', description: 'Amount to transfer' },
          amount_units: { type: 'string', enum: ['human', 'atomic'], description: 'Amount units (default human)' },
          automatic: { type: 'boolean', description: 'Use relayer/automatic delivery if supported' },
          payload_base64: { type: 'string', description: 'Optional payload (base64)' },
          destination_native_gas: { type: 'string', description: 'Optional native gas dropoff amount' },
          destination_native_gas_units: { type: 'string', enum: ['human', 'atomic'], description: 'Native gas units (default human)' },
          source_rpc_url: { type: 'string', description: 'Optional override for source RPC URL' },
          destination_rpc_url: { type: 'string', description: 'Optional override for destination RPC URL' },
        },
        required: ['source_chain', 'destination_chain', 'destination_address', 'amount'],
      },
    },
    {
      name: 'wormhole_bridge',
      description: 'Execute a Wormhole transfer (Token Bridge or CCTP).',
      input_schema: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Mainnet, Testnet, or Devnet (default Mainnet)' },
          protocol: { type: 'string', enum: ['token_bridge', 'cctp'], description: 'Bridge protocol' },
          source_chain: { type: 'string', description: 'Source chain name (e.g., Solana, Ethereum, Base)' },
          destination_chain: { type: 'string', description: 'Destination chain name' },
          destination_address: { type: 'string', description: 'Destination address on target chain' },
          token_address: { type: 'string', description: 'Token address or "native" (Token Bridge only)' },
          amount: { type: 'string', description: 'Amount to transfer' },
          amount_units: { type: 'string', enum: ['human', 'atomic'], description: 'Amount units (default human)' },
          automatic: { type: 'boolean', description: 'Use relayer/automatic delivery if supported' },
          payload_base64: { type: 'string', description: 'Optional payload (base64)' },
          destination_native_gas: { type: 'string', description: 'Optional native gas dropoff amount' },
          destination_native_gas_units: { type: 'string', enum: ['human', 'atomic'], description: 'Native gas units (default human)' },
          attest_timeout_ms: { type: 'number', description: 'Timeout for attestation (ms, default 60000)' },
          skip_redeem: { type: 'boolean', description: 'Skip manual redeem even if automatic=false' },
          source_rpc_url: { type: 'string', description: 'Optional override for source RPC URL' },
          destination_rpc_url: { type: 'string', description: 'Optional override for destination RPC URL' },
        },
        required: ['source_chain', 'destination_chain', 'destination_address', 'amount'],
      },
    },
    {
      name: 'wormhole_redeem',
      description: 'Redeem a previously initiated Wormhole transfer.',
      input_schema: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Mainnet, Testnet, or Devnet (default Mainnet)' },
          protocol: { type: 'string', enum: ['token_bridge', 'cctp'], description: 'Bridge protocol' },
          source_chain: { type: 'string', description: 'Source chain name' },
          destination_chain: { type: 'string', description: 'Destination chain name' },
          source_txid: { type: 'string', description: 'Source chain transaction id' },
          attest_timeout_ms: { type: 'number', description: 'Timeout for attestation (ms, default 60000)' },
          source_rpc_url: { type: 'string', description: 'Optional override for source RPC URL' },
          destination_rpc_url: { type: 'string', description: 'Optional override for destination RPC URL' },
        },
        required: ['source_chain', 'destination_chain', 'source_txid'],
      },
    },
    {
      name: 'usdc_quote',
      description: 'Quote a USDC transfer via Wormhole CCTP (Ethereum, Polygon, etc.).',
      input_schema: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Mainnet, Testnet, or Devnet (default Mainnet)' },
          source_chain: { type: 'string', description: 'Source chain name (e.g., Ethereum, Polygon)' },
          destination_chain: { type: 'string', description: 'Destination chain name' },
          source_address: { type: 'string', description: 'Optional source address (defaults to wallet signer if available)' },
          destination_address: { type: 'string', description: 'Destination address on target chain' },
          amount: { type: 'string', description: 'Amount to transfer' },
          amount_units: { type: 'string', enum: ['human', 'atomic'], description: 'Amount units (default human)' },
          automatic: { type: 'boolean', description: 'Use relayer/automatic delivery if supported' },
          payload_base64: { type: 'string', description: 'Optional payload (base64)' },
          destination_native_gas: { type: 'string', description: 'Optional native gas dropoff amount' },
          destination_native_gas_units: { type: 'string', enum: ['human', 'atomic'], description: 'Native gas units (default human)' },
          source_rpc_url: { type: 'string', description: 'Optional override for source RPC URL' },
          destination_rpc_url: { type: 'string', description: 'Optional override for destination RPC URL' },
        },
        required: ['source_chain', 'destination_chain', 'destination_address', 'amount'],
      },
    },
    {
      name: 'usdc_quote_auto',
      description: 'Quote USDC via CCTP when supported, otherwise fall back to Token Bridge.',
      input_schema: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Mainnet, Testnet, or Devnet (default Mainnet)' },
          source_chain: { type: 'string', description: 'Source chain name (e.g., Ethereum, Polygon)' },
          destination_chain: { type: 'string', description: 'Destination chain name' },
          source_address: { type: 'string', description: 'Optional source address (defaults to wallet signer if available)' },
          destination_address: { type: 'string', description: 'Destination address on target chain' },
          token_address: { type: 'string', description: 'Token address for Token Bridge fallback' },
          amount: { type: 'string', description: 'Amount to transfer' },
          amount_units: { type: 'string', enum: ['human', 'atomic'], description: 'Amount units (default human)' },
          automatic: { type: 'boolean', description: 'Use relayer/automatic delivery if supported' },
          payload_base64: { type: 'string', description: 'Optional payload (base64)' },
          destination_native_gas: { type: 'string', description: 'Optional native gas dropoff amount' },
          destination_native_gas_units: { type: 'string', enum: ['human', 'atomic'], description: 'Native gas units (default human)' },
          source_rpc_url: { type: 'string', description: 'Optional override for source RPC URL' },
          destination_rpc_url: { type: 'string', description: 'Optional override for destination RPC URL' },
        },
        required: ['source_chain', 'destination_chain', 'destination_address', 'amount'],
      },
    },
    {
      name: 'usdc_bridge',
      description: 'Bridge USDC via Wormhole CCTP (Ethereum, Polygon, etc.).',
      input_schema: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Mainnet, Testnet, or Devnet (default Mainnet)' },
          source_chain: { type: 'string', description: 'Source chain name (e.g., Ethereum, Polygon)' },
          destination_chain: { type: 'string', description: 'Destination chain name' },
          destination_address: { type: 'string', description: 'Destination address on target chain' },
          amount: { type: 'string', description: 'Amount to transfer' },
          amount_units: { type: 'string', enum: ['human', 'atomic'], description: 'Amount units (default human)' },
          automatic: { type: 'boolean', description: 'Use relayer/automatic delivery if supported' },
          payload_base64: { type: 'string', description: 'Optional payload (base64)' },
          destination_native_gas: { type: 'string', description: 'Optional native gas dropoff amount' },
          destination_native_gas_units: { type: 'string', enum: ['human', 'atomic'], description: 'Native gas units (default human)' },
          attest_timeout_ms: { type: 'number', description: 'Timeout for attestation (ms, default 60000)' },
          skip_redeem: { type: 'boolean', description: 'Skip manual redeem even if automatic=false' },
          source_rpc_url: { type: 'string', description: 'Optional override for source RPC URL' },
          destination_rpc_url: { type: 'string', description: 'Optional override for destination RPC URL' },
        },
        required: ['source_chain', 'destination_chain', 'destination_address', 'amount'],
      },
    },
    {
      name: 'usdc_bridge_auto',
      description: 'Bridge USDC via CCTP when supported, otherwise fall back to Token Bridge.',
      input_schema: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Mainnet, Testnet, or Devnet (default Mainnet)' },
          source_chain: { type: 'string', description: 'Source chain name (e.g., Ethereum, Polygon)' },
          destination_chain: { type: 'string', description: 'Destination chain name' },
          destination_address: { type: 'string', description: 'Destination address on target chain' },
          token_address: { type: 'string', description: 'Token address for Token Bridge fallback' },
          amount: { type: 'string', description: 'Amount to transfer' },
          amount_units: { type: 'string', enum: ['human', 'atomic'], description: 'Amount units (default human)' },
          automatic: { type: 'boolean', description: 'Use relayer/automatic delivery if supported' },
          payload_base64: { type: 'string', description: 'Optional payload (base64)' },
          destination_native_gas: { type: 'string', description: 'Optional native gas dropoff amount' },
          destination_native_gas_units: { type: 'string', enum: ['human', 'atomic'], description: 'Native gas units (default human)' },
          attest_timeout_ms: { type: 'number', description: 'Timeout for attestation (ms, default 60000)' },
          skip_redeem: { type: 'boolean', description: 'Skip manual redeem even if automatic=false' },
          source_rpc_url: { type: 'string', description: 'Optional override for source RPC URL' },
          destination_rpc_url: { type: 'string', description: 'Optional override for destination RPC URL' },
        },
        required: ['source_chain', 'destination_chain', 'destination_address', 'amount'],
      },
    },

    // ============================================
    // METACULUS API (Forecasting Platform) - EXPANDED (127 endpoints)
    // ============================================

    {
      name: 'metaculus_submit_prediction',
      description: 'Submit a prediction/forecast to a Metaculus question',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'number', description: 'Question ID to predict on' },
          prediction: { type: 'number', description: 'Your prediction (0-1 for binary, or numeric value)' },
          confidence_lower: { type: 'number', description: 'Lower bound of confidence interval (for numeric questions)' },
          confidence_upper: { type: 'number', description: 'Upper bound of confidence interval (for numeric questions)' },
        },
        required: ['question_id', 'prediction'],
      },
    },
    {
      name: 'metaculus_my_predictions',
      description: 'Get your prediction history on Metaculus',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    // Metaculus - Additional endpoints for comprehensive coverage
    {
      name: 'metaculus_bulk_predict',
      description: 'Submit predictions to multiple Metaculus questions at once',
      input_schema: {
        type: 'object',
        properties: {
          predictions: {
            type: 'array',
            description: 'Array of predictions',
            items: {
              type: 'object',
              properties: {
                question_id: { type: 'number' },
                prediction: { type: 'number' },
              },
            },
          },
        },
        required: ['predictions'],
      },
    },
    {
      name: 'metaculus_prediction_history',
      description: 'Get prediction history for a specific Metaculus question',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'number', description: 'Question ID' },
        },
        required: ['question_id'],
      },
    },
    {
      name: 'metaculus_categories',
      description: 'List all Metaculus question categories',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'metaculus_category',
      description: 'Get a specific Metaculus category by ID',
      input_schema: {
        type: 'object',
        properties: {
          category_id: { type: 'number', description: 'Category ID' },
        },
        required: ['category_id'],
      },
    },
    {
      name: 'metaculus_comments',
      description: 'Get comments on a Metaculus question',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'number', description: 'Optional: filter by question' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'metaculus_post_comment',
      description: 'Post a comment on a Metaculus question',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'number', description: 'Question ID' },
          comment: { type: 'string', description: 'Comment text' },
          parent_id: { type: 'number', description: 'Optional: parent comment ID for replies' },
        },
        required: ['question_id', 'comment'],
      },
    },
    {
      name: 'metaculus_projects',
      description: 'List Metaculus projects/tournaments',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'metaculus_project',
      description: 'Get details for a specific Metaculus project',
      input_schema: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'Project ID' },
        },
        required: ['project_id'],
      },
    },
    {
      name: 'metaculus_project_questions',
      description: 'Get all questions in a Metaculus project',
      input_schema: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'Project ID' },
          status: { type: 'string', description: 'Filter by status', enum: ['open', 'closed', 'resolved'] },
        },
        required: ['project_id'],
      },
    },
    {
      name: 'metaculus_join_project',
      description: 'Join a Metaculus project/tournament',
      input_schema: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'Project ID to join' },
        },
        required: ['project_id'],
      },
    },
    {
      name: 'metaculus_notifications',
      description: 'Get your Metaculus notifications',
      input_schema: {
        type: 'object',
        properties: {
          unread_only: { type: 'boolean', description: 'Only show unread (default false)' },
        },
      },
    },
    {
      name: 'metaculus_mark_notifications_read',
      description: 'Mark Metaculus notifications as read',
      input_schema: {
        type: 'object',
        properties: {
          notification_ids: {
            type: 'array',
            description: 'Notification IDs to mark read (omit for all)',
            items: { type: 'number' },
          },
        },
      },
    },
    {
      name: 'metaculus_user_profile',
      description: 'Get a Metaculus user profile',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'number', description: 'User ID' },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'metaculus_user_stats',
      description: 'Get forecasting statistics for a Metaculus user',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'number', description: 'User ID' },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'metaculus_leaderboard',
      description: 'Get Metaculus leaderboard/rankings',
      input_schema: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'Optional: project-specific leaderboard' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'metaculus_create_question',
      description: 'Create a new question on Metaculus (requires permissions)',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Question title' },
          description: { type: 'string', description: 'Full question description' },
          resolution_criteria: { type: 'string', description: 'How question will be resolved' },
          type: { type: 'string', description: 'Question type', enum: ['binary', 'numeric', 'date'] },
          close_time: { type: 'string', description: 'When predictions close (ISO date)' },
          resolve_time: { type: 'string', description: 'When question resolves (ISO date)' },
          project_id: { type: 'number', description: 'Optional: add to project' },
        },
        required: ['title', 'description', 'resolution_criteria', 'type', 'close_time', 'resolve_time'],
      },
    },
    {
      name: 'metaculus_about_numbers',
      description: 'Get Metaculus platform statistics (total questions, users, predictions)',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'metaculus_question_summaries',
      description: 'Get AI-generated summaries for Metaculus questions',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'number', description: 'Question ID' },
        },
        required: ['question_id'],
      },
    },
    {
      name: 'metaculus_vote',
      description: 'Vote on a Metaculus question (upvote/downvote)',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'number', description: 'Question ID' },
          direction: { type: 'number', description: 'Vote direction: 1 (up), -1 (down), 0 (remove)' },
        },
        required: ['question_id', 'direction'],
      },
    },

    // ============================================
    // QMD (MARKDOWN SEARCH) TOOLS
    // ============================================

    {
      name: 'qmd_search',
      description: 'Search local markdown collections via qmd (BM25 by default).',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          mode: { type: 'string', description: 'Search mode', enum: ['search', 'vsearch', 'query'] },
          collection: { type: 'string', description: 'Optional collection name' },
          limit: { type: 'number', description: 'Max results' },
          json: { type: 'boolean', description: 'Return JSON output' },
          files: { type: 'boolean', description: 'Return file-only output (JSON)' },
          all: { type: 'boolean', description: 'Return all matches above threshold' },
          full: { type: 'boolean', description: 'Include full document content' },
          min_score: { type: 'number', description: 'Minimum score threshold' },
          timeout_ms: { type: 'number', description: 'Override timeout in ms' },
        },
        required: ['query'],
      },
    },
    {
      name: 'qmd_get',
      description: 'Retrieve a markdown document via qmd by path or #docid.',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Path or #docid' },
          json: { type: 'boolean', description: 'Return JSON output' },
          full: { type: 'boolean', description: 'Include full document content' },
          timeout_ms: { type: 'number', description: 'Override timeout in ms' },
        },
        required: ['target'],
      },
    },
    {
      name: 'qmd_multi_get',
      description: 'Retrieve multiple markdown documents via qmd.',
      input_schema: {
        type: 'object',
        properties: {
          targets: {
            type: 'array',
            description: 'List of paths or #docids',
            items: { type: 'string' },
          },
          json: { type: 'boolean', description: 'Return JSON output' },
          timeout_ms: { type: 'number', description: 'Override timeout in ms' },
        },
        required: ['targets'],
      },
    },
    {
      name: 'qmd_status',
      description: 'Show qmd index status.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'qmd_update',
      description: 'Incrementally update the qmd index.',
      input_schema: {
        type: 'object',
        properties: {
          timeout_ms: { type: 'number', description: 'Override timeout in ms' },
        },
      },
    },
    {
      name: 'qmd_embed',
      description: 'Update qmd embeddings (slow).',
      input_schema: {
        type: 'object',
        properties: {
          timeout_ms: { type: 'number', description: 'Override timeout in ms' },
        },
      },
    },
    {
      name: 'qmd_collection_add',
      description: 'Add a markdown collection to qmd.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Collection path' },
          name: { type: 'string', description: 'Collection name' },
          mask: { type: 'string', description: 'Glob mask (e.g., "**/*.md")' },
          timeout_ms: { type: 'number', description: 'Override timeout in ms' },
        },
        required: ['path', 'name'],
      },
    },
    {
      name: 'qmd_context_add',
      description: 'Attach a description to a qmd collection.',
      input_schema: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection URI (e.g., qmd://notes)' },
          description: { type: 'string', description: 'Context description' },
          timeout_ms: { type: 'number', description: 'Override timeout in ms' },
        },
        required: ['collection', 'description'],
      },
    },

    // ============================================
    // EXECUTION & BOT TOOLS (like Clawdbot's exec)
    // ============================================

    {
      name: 'exec_python',
      description: 'Execute a Python script. Can run trading scripts, data analysis, or custom automation. The script runs in the workspace directory.',
      input_schema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Python code to execute' },
          timeout: { type: 'number', description: 'Timeout in seconds (default 30)' },
        },
        required: ['code'],
      },
    },
    {
      name: 'exec_shell',
      description: 'Execute a shell command. Use for pip install, git, file operations, etc.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          timeout: { type: 'number', description: 'Timeout in seconds (default 30)' },
        },
        required: ['command'],
      },
    },
    {
      name: 'start_bot',
      description: 'Start a trading bot as a background process. The bot runs until stopped.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Bot name for identification' },
          script: { type: 'string', description: 'Python script path or code' },
          args: { type: 'string', description: 'Command line arguments' },
        },
        required: ['name', 'script'],
      },
    },
    {
      name: 'stop_bot',
      description: 'Stop a running background bot',
      input_schema: {
        type: 'object',
        properties: {
          bot_id: { type: 'string', description: 'Bot ID to stop' },
        },
        required: ['bot_id'],
      },
    },
    {
      name: 'list_bots',
      description: 'List all running background bots with their status',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_bot_logs',
      description: 'Get recent logs from a background bot',
      input_schema: {
        type: 'object',
        properties: {
          bot_id: { type: 'string', description: 'Bot ID' },
          lines: { type: 'number', description: 'Number of recent lines (default 50)' },
        },
        required: ['bot_id'],
      },
    },

    // ============================================
    // FILE & WORKSPACE TOOLS
    // ============================================

    {
      name: 'write_file',
      description: 'Write content to a file in the workspace',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
          content: { type: 'string', description: 'File content' },
          append: { type: 'boolean', description: 'Append instead of overwrite' },
          create_dirs: { type: 'boolean', description: 'Create parent directories if missing' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'read_file',
      description: 'Read a file from the workspace',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
          max_bytes: { type: 'number', description: 'Maximum bytes to read (default 512KB)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'edit_file',
      description: 'Apply search/replace edits to a file in the workspace',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
          edits: {
            type: 'array',
            description: 'List of edits to apply',
            items: {
              type: 'object',
              properties: {
                find: { type: 'string', description: 'Search string or regex source' },
                replace: { type: 'string', description: 'Replacement text' },
                all: { type: 'boolean', description: 'Replace all occurrences' },
              },
              required: ['find', 'replace'],
            },
          },
          create_if_missing: { type: 'boolean', description: 'Create file if missing' },
        },
        required: ['path', 'edits'],
      },
    },
    {
      name: 'list_files',
      description: 'List files in a workspace directory',
      input_schema: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Directory path (default workspace root)' },
          recursive: { type: 'boolean', description: 'Recurse into subdirectories' },
          limit: { type: 'number', description: 'Max entries to return' },
          include_dirs: { type: 'boolean', description: 'Include directories in results' },
        },
      },
    },
    {
      name: 'search_files',
      description: 'Search files in workspace for a query string',
      input_schema: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Directory path (default workspace root)' },
          query: { type: 'string', description: 'Search string (plain text)' },
          recursive: { type: 'boolean', description: 'Recurse into subdirectories' },
          limit: { type: 'number', description: 'Max results' },
        },
        required: ['query'],
      },
    },
    {
      name: 'shell_history_list',
      description: 'List recent shell history entries',
      input_schema: {
        type: 'object',
        properties: {
          shell: { type: 'string', description: 'Shell type', enum: ['auto', 'zsh', 'bash', 'fish'] },
          limit: { type: 'number', description: 'Max entries to return' },
          query: { type: 'string', description: 'Optional substring filter' },
        },
      },
    },
    {
      name: 'shell_history_search',
      description: 'Search shell history for a query string',
      input_schema: {
        type: 'object',
        properties: {
          shell: { type: 'string', description: 'Shell type', enum: ['auto', 'zsh', 'bash', 'fish'] },
          limit: { type: 'number', description: 'Max entries to return' },
          query: { type: 'string', description: 'Search string' },
        },
        required: ['query'],
      },
    },
    {
      name: 'git_status',
      description: 'Get git status for a repo in the workspace',
      input_schema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Repo path relative to workspace' },
        },
      },
    },
    {
      name: 'git_diff',
      description: 'Get git diff output',
      input_schema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Repo path relative to workspace' },
          args: { type: 'array', description: 'Additional git diff args', items: { type: 'string' } },
        },
      },
    },
    {
      name: 'git_log',
      description: 'Get git log entries',
      input_schema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Repo path relative to workspace' },
          limit: { type: 'number', description: 'Max commits to return' },
        },
      },
    },
    {
      name: 'git_show',
      description: 'Show git commit details',
      input_schema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Git ref (default HEAD)' },
          cwd: { type: 'string', description: 'Repo path relative to workspace' },
        },
      },
    },
    {
      name: 'git_rev_parse',
      description: 'Resolve a git ref',
      input_schema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Git ref (default HEAD)' },
          cwd: { type: 'string', description: 'Repo path relative to workspace' },
        },
      },
    },
    {
      name: 'git_branch',
      description: 'List git branches',
      input_schema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Repo path relative to workspace' },
        },
      },
    },
    {
      name: 'git_add',
      description: 'Stage files for commit',
      input_schema: {
        type: 'object',
        properties: {
          paths: { type: 'array', description: 'Paths to add', items: { type: 'string' } },
          cwd: { type: 'string', description: 'Repo path relative to workspace' },
        },
        required: ['paths'],
      },
    },
    {
      name: 'git_commit',
      description: 'Create a git commit',
      input_schema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' },
          cwd: { type: 'string', description: 'Repo path relative to workspace' },
        },
        required: ['message'],
      },
    },
    {
      name: 'email_send',
      description: 'Send an email via SMTP/sendmail',
      input_schema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'From address (email or Name <email>)' },
          to: { type: 'array', description: 'Recipients', items: { type: 'string' } },
          cc: { type: 'array', description: 'CC recipients', items: { type: 'string' } },
          bcc: { type: 'array', description: 'BCC recipients', items: { type: 'string' } },
          subject: { type: 'string', description: 'Email subject' },
          text: { type: 'string', description: 'Email body text' },
          reply_to: { type: 'string', description: 'Reply-to address' },
          dry_run: { type: 'boolean', description: 'Dry run without sending' },
        },
        required: ['from', 'to', 'subject', 'text'],
      },
    },
    {
      name: 'sms_send',
      description: 'Send an SMS via Twilio',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Destination phone number' },
          body: { type: 'string', description: 'Message body' },
          from: { type: 'string', description: 'Override sender number' },
          dry_run: { type: 'boolean', description: 'Dry run without sending' },
        },
        required: ['to', 'body'],
      },
    },
    {
      name: 'transcribe_audio',
      description: 'Transcribe speech from an audio file in the workspace using OpenAI or local CLI engines (whisper/vosk)',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Audio file path relative to workspace' },
          engine: {
            type: 'string',
            description: 'Optional engine override',
            enum: ['openai', 'whisper', 'vosk'],
          },
          language: { type: 'string', description: 'Optional language hint (e.g., en, en-US, es)' },
          prompt: { type: 'string', description: 'Optional prompt to guide transcription' },
          model: { type: 'string', description: 'Optional model override (OpenAI only)' },
          temperature: { type: 'number', description: 'Optional sampling temperature (OpenAI only)' },
          timestamps: { type: 'boolean', description: 'Include segment timestamps when supported' },
          timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 60000)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'sql_query',
      description: 'Run a safe, read-only SQL query against the local Clodds database (SELECT/WITH/PRAGMA/EXPLAIN/VALUES only)',
      input_schema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL query to execute (read-only)' },
          params: { type: 'array', description: 'Optional parameter values in order', items: { type: 'string' } },
          max_rows: { type: 'number', description: 'Maximum rows to return (default 200, hard max 2000)' },
        },
        required: ['sql'],
      },
    },
    {
      name: 'register_webhook',
      description: 'Register an inbound HTTP webhook that triggers the agent or slash commands',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Optional webhook id (auto-generated if omitted)' },
          path: { type: 'string', description: 'Webhook path, e.g. /webhook/alerts' },
          description: { type: 'string', description: 'Optional description' },
          rate_limit: { type: 'number', description: 'Optional requests-per-minute limit' },
          enabled: { type: 'boolean', description: 'Whether the webhook starts enabled' },
          secret: { type: 'string', description: 'Optional pre-shared secret (auto-generated if omitted)' },
          target_platform: { type: 'string', description: 'Where to send the response (e.g., telegram, slack)' },
          target_chat_id: { type: 'string', description: 'Destination chat/channel id' },
          target_user_id: { type: 'string', description: 'User id for session scoping' },
          target_username: { type: 'string', description: 'Optional username for context' },
          template: { type: 'string', description: 'Optional template; use {{payload}} to inject JSON payload' },
        },
        required: ['path', 'target_platform', 'target_chat_id', 'target_user_id'],
      },
    },
    {
      name: 'list_webhooks',
      description: 'List registered webhooks',
      input_schema: {
        type: 'object',
        properties: {
          include_secrets: { type: 'boolean', description: 'Include webhook secrets in the response' },
        },
      },
    },
    {
      name: 'delete_webhook',
      description: 'Delete (unregister) a webhook',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Webhook id' },
        },
        required: ['id'],
      },
    },
    {
      name: 'enable_webhook',
      description: 'Enable or disable a webhook',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Webhook id' },
          enabled: { type: 'boolean', description: 'Whether the webhook is enabled' },
        },
        required: ['id', 'enabled'],
      },
    },
    {
      name: 'rotate_webhook_secret',
      description: 'Rotate a webhook secret (invalidates old signatures)',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Webhook id' },
        },
        required: ['id'],
      },
    },
    {
      name: 'sign_webhook_payload',
      description: 'Create a valid HMAC signature for a webhook payload (for testing)',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Webhook id' },
          payload: { type: 'string', description: 'Payload JSON string or raw string' },
        },
        required: ['id', 'payload'],
      },
    },
    {
      name: 'trigger_webhook',
      description: 'Trigger a webhook locally (for testing)',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Webhook id' },
          payload: { type: 'string', description: 'Payload JSON string or raw string' },
          signature: { type: 'string', description: 'Optional signature override' },
        },
        required: ['id', 'payload'],
      },
    },
    {
      name: 'docker_list_containers',
      description: 'List Docker containers on this machine',
      input_schema: {
        type: 'object',
        properties: {
          all: { type: 'boolean', description: 'Include stopped containers (default true)' },
        },
      },
    },
    {
      name: 'docker_list_images',
      description: 'List Docker images on this machine',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'docker_run',
      description: 'Run a Docker container with workspace mounted at /workspace',
      input_schema: {
        type: 'object',
        properties: {
          image: { type: 'string', description: 'Image to run (e.g., node:20, python:3.11)' },
          name: { type: 'string', description: 'Optional container name' },
          command: { type: 'array', description: 'Optional command/args', items: { type: 'string' } },
          detach: { type: 'boolean', description: 'Run detached (default true)' },
          workdir: { type: 'string', description: 'Working directory inside container' },
          network: { type: 'string', description: 'Docker network name (optional)' },
        },
        required: ['image'],
      },
    },
    {
      name: 'docker_stop',
      description: 'Stop a running Docker container',
      input_schema: {
        type: 'object',
        properties: {
          container: { type: 'string', description: 'Container name or id' },
          timeout_seconds: { type: 'number', description: 'Graceful stop timeout seconds (default 10)' },
        },
        required: ['container'],
      },
    },
    {
      name: 'docker_remove',
      description: 'Remove a Docker container',
      input_schema: {
        type: 'object',
        properties: {
          container: { type: 'string', description: 'Container name or id' },
          force: { type: 'boolean', description: 'Force removal (default false)' },
        },
        required: ['container'],
      },
    },
    {
      name: 'docker_logs',
      description: 'Fetch recent logs from a Docker container',
      input_schema: {
        type: 'object',
        properties: {
          container: { type: 'string', description: 'Container name or id' },
          tail: { type: 'number', description: 'Number of lines to tail (default 200)' },
        },
        required: ['container'],
      },
    },

    // ============================================
    // CREDENTIAL ONBOARDING TOOLS
    // ============================================

    {
      name: 'setup_polymarket_credentials',
      description: 'Set up Polymarket trading credentials for this user. Required before trading on Polymarket.',
      input_schema: {
        type: 'object',
        properties: {
          private_key: { type: 'string', description: 'Ethereum private key (0x...)' },
          funder_address: { type: 'string', description: 'Wallet address (0x...)' },
          api_key: { type: 'string', description: 'Polymarket API key' },
          api_secret: { type: 'string', description: 'Polymarket API secret' },
          api_passphrase: { type: 'string', description: 'Polymarket API passphrase' },
        },
        required: ['private_key', 'funder_address', 'api_key', 'api_secret', 'api_passphrase'],
      },
    },
    {
      name: 'setup_kalshi_credentials',
      description: 'Set up Kalshi trading credentials for this user. Required before trading on Kalshi.',
      input_schema: {
        type: 'object',
        properties: {
          api_key_id: { type: 'string', description: 'Kalshi API key ID' },
          private_key_pem: { type: 'string', description: 'Kalshi API private key (PEM or base64-encoded PEM)' },
        },
        required: ['api_key_id', 'private_key_pem'],
      },
    },
    {
      name: 'setup_manifold_credentials',
      description: 'Set up Manifold trading credentials for this user. Required before betting on Manifold.',
      input_schema: {
        type: 'object',
        properties: {
          api_key: { type: 'string', description: 'Manifold API key (from settings page)' },
        },
        required: ['api_key'],
      },
    },
    {
      name: 'list_trading_credentials',
      description: 'List which platforms the user has trading credentials set up for',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'delete_trading_credentials',
      description: 'Delete trading credentials for a platform',
      input_schema: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            description: 'Platform to delete credentials for',
            enum: ['polymarket', 'kalshi', 'manifold'],
          },
        },
        required: ['platform'],
      },
    },

    // ============================================
    // SESSION MANAGEMENT TOOLS
    // ============================================

    {
      name: 'clear_conversation_history',
      description: 'Clear the conversation history to start fresh. Use when user wants to reset context.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'save_session_checkpoint',
      description: 'Save a checkpoint of the current session history for later resumption.',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Optional checkpoint summary' },
        },
      },
    },
    {
      name: 'restore_session_checkpoint',
      description: 'Restore the most recent session checkpoint.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    // ============================================
    // MESSAGE TOOLS
    // ============================================
    {
      name: 'edit_message',
      description: 'Edit a previously sent message (platform must support edits).',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Platform (e.g., telegram, slack, discord, webchat)' },
          chat_id: { type: 'string', description: 'Chat/channel ID' },
          message_id: { type: 'string', description: 'Message ID to edit' },
          text: { type: 'string', description: 'New message text' },
          account_id: { type: 'string', description: 'Account ID (for multi-account channels)' },
        },
        required: ['platform', 'chat_id', 'message_id', 'text'],
      },
    },
    {
      name: 'delete_message',
      description: 'Delete a previously sent message (platform must support deletes).',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Platform (e.g., telegram, slack, discord, webchat)' },
          chat_id: { type: 'string', description: 'Chat/channel ID' },
          message_id: { type: 'string', description: 'Message ID to delete' },
          account_id: { type: 'string', description: 'Account ID (for multi-account channels)' },
        },
        required: ['platform', 'chat_id', 'message_id'],
      },
    },
    {
      name: 'react_message',
      description: 'Add or remove a reaction to a message (platform must support reactions).',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Platform (e.g., whatsapp, telegram, discord)' },
          chat_id: { type: 'string', description: 'Chat/channel ID' },
          message_id: { type: 'string', description: 'Message ID to react to' },
          emoji: { type: 'string', description: 'Emoji reaction (e.g., 👍, ✅)' },
          remove: { type: 'boolean', description: 'Remove the reaction instead of adding' },
          participant: { type: 'string', description: 'Sender JID (WhatsApp group messages)' },
          from_me: { type: 'boolean', description: 'Whether the target message was sent by this bot' },
          account_id: { type: 'string', description: 'Account ID (for multi-account channels)' },
        },
        required: ['platform', 'chat_id', 'message_id', 'emoji'],
      },
    },
    {
      name: 'create_poll',
      description: 'Create a poll in a chat (platform must support polls).',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Platform (e.g., whatsapp, telegram)' },
          chat_id: { type: 'string', description: 'Chat/channel ID' },
          question: { type: 'string', description: 'Poll question' },
          options: { type: 'array', items: { type: 'string' }, description: 'Poll options' },
          multi_select: { type: 'boolean', description: 'Allow multiple selections' },
          account_id: { type: 'string', description: 'Account ID (for multi-account channels)' },
        },
        required: ['platform', 'chat_id', 'question', 'options'],
      },
    },
    // ============================================
    // SUBAGENT TOOLS
    // ============================================
    {
      name: 'subagent_start',
      description: 'Start a background subagent task. Returns the subagent run ID.',
      input_schema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Task description for the subagent' },
          id: { type: 'string', description: 'Optional run ID (auto-generated if omitted)' },
          model: { type: 'string', description: 'Optional model override' },
          thinking_mode: {
            type: 'string',
            description: 'Optional thinking mode',
            enum: ['none', 'basic', 'extended', 'chain-of-thought'],
          },
          max_turns: { type: 'number', description: 'Max turns before stopping' },
          timeout_ms: { type: 'number', description: 'Timeout in ms' },
          tools: {
            type: 'array',
            description: 'Optional allowlist of tool names for subagent',
            items: { type: 'string' },
          },
          background: {
            type: 'boolean',
            description: 'Run in background (default true)',
          },
        },
        required: ['task'],
      },
    },
    {
      name: 'subagent_pause',
      description: 'Pause a running subagent by ID.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Subagent run ID' },
        },
        required: ['id'],
      },
    },
    {
      name: 'subagent_resume',
      description: 'Resume a paused subagent by ID.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Subagent run ID' },
          background: { type: 'boolean', description: 'Run in background (default true)' },
        },
        required: ['id'],
      },
    },
    {
      name: 'subagent_status',
      description: 'Get subagent status by ID.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Subagent run ID' },
        },
        required: ['id'],
      },
    },
    {
      name: 'subagent_progress',
      description: 'Update subagent progress message/percent.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Subagent run ID' },
          message: { type: 'string', description: 'Progress message' },
          percent: { type: 'number', description: 'Progress percent (0-100)' },
        },
        required: ['id'],
      },
    },
    // ========================================================================
    // ACP - Agent Commerce Protocol
    // ========================================================================
    {
      name: 'acp_register_agent',
      description: 'Register a new agent in the ACP registry for service discovery.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Agent name' },
          address: { type: 'string', description: 'Solana wallet address' },
          description: { type: 'string', description: 'Agent description' },
        },
        required: ['name', 'address'],
      },
    },
    {
      name: 'acp_list_service',
      description: 'List a service under an agent for others to discover and use.',
      input_schema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Agent ID to list service under' },
          name: { type: 'string', description: 'Service name' },
          category: {
            type: 'string',
            description: 'Service category',
            enum: ['compute', 'data', 'analytics', 'trading', 'content', 'research', 'automation', 'other'],
          },
          price: { type: 'string', description: 'Price per request' },
          currency: { type: 'string', description: 'Currency (SOL, USDC)', enum: ['SOL', 'USDC'] },
          description: { type: 'string', description: 'Service description' },
        },
        required: ['agent_id', 'name'],
      },
    },
    {
      name: 'acp_get_agent',
      description: 'Get details about a registered agent.',
      input_schema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Agent ID' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'acp_search_services',
      description: 'Search for services in the ACP registry.',
      input_schema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Filter by category',
            enum: ['compute', 'data', 'analytics', 'trading', 'content', 'research', 'automation', 'other'],
          },
          max_price: { type: 'string', description: 'Maximum price' },
          min_rating: { type: 'number', description: 'Minimum rating (1-5)' },
          query: { type: 'string', description: 'Search query' },
        },
      },
    },
    {
      name: 'acp_discover',
      description: 'Discover and rank services based on your needs using AI scoring.',
      input_schema: {
        type: 'object',
        properties: {
          need: { type: 'string', description: 'What you need (e.g., "image generation", "price data")' },
          buyer_address: { type: 'string', description: 'Your Solana address' },
          max_price: { type: 'string', description: 'Maximum price willing to pay' },
        },
        required: ['need', 'buyer_address'],
      },
    },
    {
      name: 'acp_quick_hire',
      description: 'Auto-negotiate and create agreement with best matching service.',
      input_schema: {
        type: 'object',
        properties: {
          need: { type: 'string', description: 'What you need' },
          buyer_address: { type: 'string', description: 'Your Solana address' },
          max_price: { type: 'string', description: 'Maximum price' },
        },
        required: ['need', 'buyer_address'],
      },
    },
    {
      name: 'acp_create_agreement',
      description: 'Create a service agreement between buyer and seller.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Agreement title' },
          buyer: { type: 'string', description: 'Buyer Solana address' },
          seller: { type: 'string', description: 'Seller Solana address' },
          price: { type: 'string', description: 'Agreement price' },
          currency: { type: 'string', description: 'Currency (SOL, USDC)', enum: ['SOL', 'USDC'] },
          description: { type: 'string', description: 'Agreement description' },
        },
        required: ['title', 'buyer', 'seller', 'price'],
      },
    },
    {
      name: 'acp_sign_agreement',
      description: 'Sign an agreement with your private key.',
      input_schema: {
        type: 'object',
        properties: {
          agreement_id: { type: 'string', description: 'Agreement ID' },
          private_key: { type: 'string', description: 'Base58 encoded private key' },
        },
        required: ['agreement_id', 'private_key'],
      },
    },
    {
      name: 'acp_get_agreement',
      description: 'Get agreement details.',
      input_schema: {
        type: 'object',
        properties: {
          agreement_id: { type: 'string', description: 'Agreement ID' },
        },
        required: ['agreement_id'],
      },
    },
    {
      name: 'acp_list_agreements',
      description: 'List all agreements for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Solana address' },
        },
        required: ['address'],
      },
    },
    {
      name: 'acp_create_escrow',
      description: 'Create an on-chain escrow for secure payment.',
      input_schema: {
        type: 'object',
        properties: {
          buyer: { type: 'string', description: 'Buyer Solana address' },
          seller: { type: 'string', description: 'Seller Solana address' },
          amount: { type: 'string', description: 'Amount in lamports' },
          arbiter: { type: 'string', description: 'Optional arbiter address for disputes' },
          rpc_url: { type: 'string', description: 'Solana RPC URL' },
        },
        required: ['buyer', 'seller', 'amount'],
      },
    },
    {
      name: 'acp_fund_escrow',
      description: 'Fund an escrow (buyer only).',
      input_schema: {
        type: 'object',
        properties: {
          escrow_id: { type: 'string', description: 'Escrow ID' },
          private_key: { type: 'string', description: 'Buyer private key (base58)' },
        },
        required: ['escrow_id', 'private_key'],
      },
    },
    {
      name: 'acp_release_escrow',
      description: 'Release escrow funds to seller (buyer or arbiter).',
      input_schema: {
        type: 'object',
        properties: {
          escrow_id: { type: 'string', description: 'Escrow ID' },
          private_key: { type: 'string', description: 'Buyer or arbiter private key (base58)' },
        },
        required: ['escrow_id', 'private_key'],
      },
    },
    {
      name: 'acp_refund_escrow',
      description: 'Refund escrow to buyer (seller, expired buyer, or arbiter).',
      input_schema: {
        type: 'object',
        properties: {
          escrow_id: { type: 'string', description: 'Escrow ID' },
          private_key: { type: 'string', description: 'Authorized party private key (base58)' },
        },
        required: ['escrow_id', 'private_key'],
      },
    },
    {
      name: 'acp_get_escrow',
      description: 'Get escrow details.',
      input_schema: {
        type: 'object',
        properties: {
          escrow_id: { type: 'string', description: 'Escrow ID' },
        },
        required: ['escrow_id'],
      },
    },
    {
      name: 'acp_list_escrows',
      description: 'List all escrows for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Solana address' },
        },
        required: ['address'],
      },
    },
    {
      name: 'acp_rate_service',
      description: 'Rate a service (1-5 stars).',
      input_schema: {
        type: 'object',
        properties: {
          service_id: { type: 'string', description: 'Service ID' },
          rater_address: { type: 'string', description: 'Your Solana address' },
          rating: { type: 'number', description: 'Rating 1-5' },
          review: { type: 'string', description: 'Optional review text' },
        },
        required: ['service_id', 'rater_address', 'rating'],
      },
    },
    // ACP Identity - Handles
    {
      name: 'acp_register_handle',
      description: 'Register a unique @handle for an agent. Handles are unique identifiers like @myagent.',
      input_schema: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'Desired handle (3-20 chars, lowercase, no spaces)' },
          agent_id: { type: 'string', description: 'Agent ID to link' },
          owner_address: { type: 'string', description: 'Owner Solana address' },
        },
        required: ['handle', 'agent_id', 'owner_address'],
      },
    },
    {
      name: 'acp_get_handle',
      description: 'Look up a handle to find the associated agent.',
      input_schema: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'Handle to look up (with or without @)' },
        },
        required: ['handle'],
      },
    },
    {
      name: 'acp_check_handle',
      description: 'Check if a handle is available for registration.',
      input_schema: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'Handle to check' },
        },
        required: ['handle'],
      },
    },
    // ACP Identity - Takeovers
    {
      name: 'acp_create_bid',
      description: 'Create a takeover bid for a handle. Funds are held in escrow.',
      input_schema: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'Handle to bid on' },
          bidder_address: { type: 'string', description: 'Your Solana address' },
          amount: { type: 'string', description: 'Bid amount in lamports' },
          currency: { type: 'string', description: 'Currency (default: SOL)' },
        },
        required: ['handle', 'bidder_address', 'amount'],
      },
    },
    {
      name: 'acp_accept_bid',
      description: 'Accept a takeover bid and transfer handle ownership.',
      input_schema: {
        type: 'object',
        properties: {
          bid_id: { type: 'string', description: 'Bid ID to accept' },
          owner_address: { type: 'string', description: 'Current owner address (for verification)' },
        },
        required: ['bid_id', 'owner_address'],
      },
    },
    {
      name: 'acp_reject_bid',
      description: 'Reject a takeover bid and refund the bidder.',
      input_schema: {
        type: 'object',
        properties: {
          bid_id: { type: 'string', description: 'Bid ID to reject' },
          owner_address: { type: 'string', description: 'Current owner address (for verification)' },
        },
        required: ['bid_id', 'owner_address'],
      },
    },
    {
      name: 'acp_list_bids',
      description: 'List takeover bids for a handle or by a bidder.',
      input_schema: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'Handle to list bids for' },
          bidder_address: { type: 'string', description: 'Or list bids by this address' },
        },
      },
    },
    // ACP Identity - Referrals
    {
      name: 'acp_get_referral_code',
      description: 'Generate a referral code for an address. Earns 5% of referred agent fees.',
      input_schema: {
        type: 'object',
        properties: {
          referrer_address: { type: 'string', description: 'Your Solana address' },
        },
        required: ['referrer_address'],
      },
    },
    {
      name: 'acp_use_referral_code',
      description: 'Apply a referral code to an agent (one-time only).',
      input_schema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Referral code to use' },
          agent_id: { type: 'string', description: 'Agent ID to apply referral to' },
        },
        required: ['code', 'agent_id'],
      },
    },
    {
      name: 'acp_get_referral_stats',
      description: 'Get referral statistics for an address.',
      input_schema: {
        type: 'object',
        properties: {
          referrer_address: { type: 'string', description: 'Referrer address' },
        },
        required: ['referrer_address'],
      },
    },
    // ACP Identity - Profiles
    {
      name: 'acp_get_profile',
      description: 'Get public profile for an agent.',
      input_schema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Agent ID' },
          handle: { type: 'string', description: 'Or look up by handle' },
        },
      },
    },
    {
      name: 'acp_update_profile',
      description: 'Update agent public profile.',
      input_schema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Agent ID to update' },
          display_name: { type: 'string', description: 'Display name' },
          bio: { type: 'string', description: 'Short bio (max 280 chars)' },
          avatar_url: { type: 'string', description: 'Avatar image URL' },
          website_url: { type: 'string', description: 'Website URL' },
          twitter_handle: { type: 'string', description: 'Twitter handle' },
          github_handle: { type: 'string', description: 'GitHub handle' },
        },
        required: ['agent_id'],
      },
    },
    // ACP Identity - Leaderboard
    {
      name: 'acp_get_leaderboard',
      description: 'Get top agents by score.',
      input_schema: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'Number of entries (default: 10)' },
          period: { type: 'string', description: 'Period: all_time, monthly, weekly (default: all_time)' },
        },
      },
    },
    // ACP Predictions - Brier score tracking
    {
      name: 'acp_submit_prediction',
      description: 'Submit a probability prediction on a market. Agent must provide rationale (10-800 chars).',
      input_schema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Agent ID submitting prediction' },
          market_slug: { type: 'string', description: 'Market identifier (e.g., will-trump-win-2024)' },
          market_title: { type: 'string', description: 'Market title/question' },
          market_category: { type: 'string', enum: ['politics', 'pop-culture', 'economy', 'crypto-tech', 'sports', 'other'], description: 'Market category' },
          probability: { type: 'number', description: 'Predicted probability 0.0-1.0 (e.g., 0.72 = 72% YES)' },
          rationale: { type: 'string', description: 'Reasoning for prediction (10-800 chars, required)' },
        },
        required: ['agent_id', 'market_slug', 'market_title', 'probability', 'rationale'],
      },
    },
    {
      name: 'acp_get_prediction',
      description: 'Get a specific prediction by ID.',
      input_schema: {
        type: 'object',
        properties: {
          prediction_id: { type: 'string', description: 'Prediction ID' },
        },
        required: ['prediction_id'],
      },
    },
    {
      name: 'acp_get_predictions_by_agent',
      description: 'Get all predictions by an agent.',
      input_schema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Agent ID' },
          limit: { type: 'number', description: 'Max results (default: 20)' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'acp_get_predictions_by_market',
      description: 'Get all predictions for a market. Shows agent consensus.',
      input_schema: {
        type: 'object',
        properties: {
          market_slug: { type: 'string', description: 'Market identifier' },
        },
        required: ['market_slug'],
      },
    },
    {
      name: 'acp_get_prediction_feed',
      description: 'Get recent predictions from all agents (public feed).',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default: 20)' },
          category: { type: 'string', enum: ['politics', 'pop-culture', 'economy', 'crypto-tech', 'sports', 'other'], description: 'Filter by category' },
        },
      },
    },
    {
      name: 'acp_resolve_market',
      description: 'Resolve a market and calculate Brier scores for all predictions.',
      input_schema: {
        type: 'object',
        properties: {
          market_slug: { type: 'string', description: 'Market identifier' },
          outcome: { type: 'number', enum: [0, 1], description: 'Outcome: 1=YES, 0=NO' },
        },
        required: ['market_slug', 'outcome'],
      },
    },
    {
      name: 'acp_get_prediction_stats',
      description: 'Get prediction accuracy stats for an agent (Brier score, win rate, streaks).',
      input_schema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Agent ID' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'acp_get_prediction_leaderboard',
      description: 'Get top agents ranked by Brier score (lower=better). Min 5 resolved predictions.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default: 10)' },
        },
      },
    },
    // Bittensor mining
    {
      name: 'bittensor',
      description: 'Manage Bittensor subnet mining - check status, earnings, wallet, start/stop miners, register on subnets.',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'earnings', 'wallet', 'miners', 'subnets', 'start', 'stop', 'register'],
            description: 'The action to perform',
          },
          period: {
            type: 'string',
            enum: ['hourly', 'daily', 'weekly', 'monthly', 'all'],
            description: 'Earnings period (for earnings action)',
          },
          subnetId: { type: 'number', description: 'Subnet ID (for start/stop/register)' },
          hotkeyName: { type: 'string', description: 'Hotkey name (for register)' },
        },
        required: ['action'],
      },
    },
    // Tool search meta-tool (always included in core set)
    {
      name: 'tool_search',
      description: 'Search for specialized tools by platform, category, or keyword. Use this BEFORE attempting to use a tool that is not in your current tool set. Returns tool definitions you can use in follow-up requests. Available platforms include: polymarket, kalshi, manifold, metaculus, drift, opinion, predictfun, binance, bybit, mexc, hyperliquid, solana, pumpfun, bags, meteora, raydium, orca, coingecko, yahoo, acp, docker, git. Categories include: trading, market_data, portfolio, discovery, admin, infrastructure, defi, alerts.',
      input_schema: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            description: 'Platform to search: polymarket, kalshi, manifold, metaculus, drift, opinion, predictfun, binance, bybit, mexc, hyperliquid, solana, pumpfun, bags, meteora, raydium, orca, coingecko, yahoo, acp, docker, git',
          },
          category: {
            type: 'string',
            description: 'Tool category: trading, market_data, portfolio, discovery, admin, infrastructure, defi, alerts',
          },
          query: {
            type: 'string',
            description: 'Keyword search: "buy order", "balance", "swap", "liquidity" etc.',
          },
        },
      },
      metadata: {
        category: 'admin',
        tags: ['meta', 'search', 'discovery', 'tools'],
        core: true,
      },
    },
  ];
}

type QmdCommandResult = {
  stdout: string;
  stderr: string;
  status: number | null;
  error?: NodeJS.ErrnoException;
};

function buildQmdEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const bunBin = join(homedir(), '.bun', 'bin');
  env.PATH = [bunBin, env.PATH || ''].filter(Boolean).join(':');
  return env;
}

function runQmdCommand(args: string[], timeoutMs: number): QmdCommandResult {
  const result = spawnSync('qmd', args, {
    encoding: 'utf-8',
    env: buildQmdEnv(),
    timeout: timeoutMs,
  });
  return {
    stdout: (result.stdout || '').toString(),
    stderr: (result.stderr || '').toString(),
    status: result.status,
    error: result.error as NodeJS.ErrnoException | undefined,
  };
}

function formatQmdResult(result: QmdCommandResult, expectJson: boolean): string {
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      return JSON.stringify({
        error: 'qmd not found',
        hint: 'Install with: bun install -g https://github.com/tobi/qmd',
      });
    }
    return JSON.stringify({
      error: 'Failed to run qmd',
      message: result.error.message,
    });
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    return JSON.stringify({
      error: 'qmd command failed',
      status: result.status,
      stderr: result.stderr.trim() || undefined,
      stdout: result.stdout.trim() || undefined,
    });
  }

  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();

  if (expectJson && stdout) {
    try {
      const parsed = JSON.parse(stdout);
      return JSON.stringify({ result: parsed, stderr: stderr || undefined });
    } catch {
      return JSON.stringify({
        result: stdout,
        warning: 'Failed to parse qmd JSON output',
        stderr: stderr || undefined,
      });
    }
  }

  return JSON.stringify({
    result: stdout,
    stderr: stderr || undefined,
  });
}

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: AgentContext
): Promise<string> {
  const { feeds, db, session, subagents: subagentManager } = context;
  const userId = session.userId;

  try {
    switch (toolName) {
      // Market tools
      case 'search_markets': {
        const query = toolInput.query as string;
        const platform = toolInput.platform as string | undefined;
        const markets = await feeds.searchMarkets(query, platform);

        if (markets.length === 0) {
          return JSON.stringify({ result: 'No markets found.' });
        }

        return JSON.stringify({
          result: markets.slice(0, 8).map(m => ({
            id: m.id,
            platform: m.platform,
            question: m.question,
            outcomes: m.outcomes.slice(0, 3).map(o => ({
              name: o.name,
              price: o.price,
              priceCents: `${Math.round(o.price * 100)}¢`,
            })),
            volume24h: m.volume24h,
            url: m.url,
          })),
        });
      }

      case 'get_market': {
        const marketId = toolInput.market_id as string;
        const platform = toolInput.platform as string;
        const market = await feeds.getMarket(marketId, platform);

        if (!market) {
          return JSON.stringify({ error: 'Market not found' });
        }

        return JSON.stringify({
          result: {
            ...market,
            outcomes: market.outcomes.map(o => ({
              ...o,
              priceCents: `${Math.round(o.price * 100)}¢`,
            })),
          },
        });
      }

      case 'market_index_sync': {
        const platforms = toolInput.platforms as Platform[] | undefined;
        const limitPerPlatform = toolInput.limit_per_platform as number | undefined;
        const status = toolInput.status as 'open' | 'closed' | 'settled' | 'all' | undefined;
        const excludeSports = toolInput.exclude_sports as boolean | undefined;
        const minVolume24h = toolInput.min_volume_24h as number | undefined;
        const minLiquidity = toolInput.min_liquidity as number | undefined;
        const minOpenInterest = toolInput.min_open_interest as number | undefined;
        const minPredictions = toolInput.min_predictions as number | undefined;
        const excludeResolved = toolInput.exclude_resolved as boolean | undefined;

        const result = await context.marketIndex.sync({
          platforms,
          limitPerPlatform,
          status,
          excludeSports,
          minVolume24h,
          minLiquidity,
          minOpenInterest,
          minPredictions,
          excludeResolved,
        });

        return JSON.stringify({
          result: {
            indexed: result.indexed,
            byPlatform: result.byPlatform,
          },
        });
      }

      case 'market_index_search': {
        const query = toolInput.query as string;
        const platform = toolInput.platform as Platform | undefined;
        const limit = toolInput.limit as number | undefined;
        const maxCandidates = toolInput.max_candidates as number | undefined;
        const minScore = toolInput.min_score as number | undefined;
        const platformWeights = toolInput.platform_weights as Record<string, number> | undefined;

        const results = await context.marketIndex.search({
          query,
          platform,
          limit,
          maxCandidates,
          minScore,
          platformWeights: (platformWeights as Record<Platform, number> | undefined)
            ?? context.marketIndexConfig?.platformWeights,
        });

        return JSON.stringify({
          result: results.map((r) => ({
            score: Number(r.score.toFixed(4)),
            market: {
              platform: r.item.platform,
              id: r.item.marketId,
              slug: r.item.slug,
              question: r.item.question,
              description: r.item.description,
              url: r.item.url,
              status: r.item.status,
              endDate: r.item.endDate,
              resolved: r.item.resolved,
              volume24h: r.item.volume24h,
              liquidity: r.item.liquidity,
              openInterest: r.item.openInterest,
              predictions: r.item.predictions,
            },
          })),
        });
      }

      case 'market_index_stats': {
        const platforms = toolInput.platforms as Platform[] | undefined;
        const stats = context.marketIndex.stats(platforms);
        return JSON.stringify({ result: stats });
      }

      case 'market_index_last_sync': {
        const stats = context.marketIndex.stats();
        return JSON.stringify({
          result: {
            lastSyncAt: stats.lastSyncAt,
            lastSyncIndexed: stats.lastSyncIndexed,
            lastSyncByPlatform: stats.lastSyncByPlatform,
            lastSyncDurationMs: stats.lastSyncDurationMs,
            lastPruned: stats.lastPruned,
          },
        });
      }

      case 'market_index_prune': {
        const platform = toolInput.platform as Platform | undefined;
        const staleAfterMs = toolInput.stale_after_ms as number | undefined;
        const cutoff = Date.now() - (staleAfterMs ?? 7 * 24 * 60 * 60 * 1000);
        const removed = db.pruneMarketIndex(cutoff, platform);
        return JSON.stringify({
          result: {
            removed,
            cutoffMs: cutoff,
            platform: platform ?? 'all',
          },
        });
      }

      // Portfolio tools
      case 'get_portfolio': {
        const positions = db.getPositions(userId);

        if (positions.length === 0) {
          return JSON.stringify({ result: 'No positions tracked. Use add_position to track manually.' });
        }

        const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
        const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
        const totalCost = totalValue - totalPnl;

        return JSON.stringify({
          result: {
            positions: positions.map(p => ({
              ...p,
              pnlFormatted: `${p.pnl >= 0 ? '+' : ''}$${p.pnl.toFixed(2)} (${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(1)}%)`,
            })),
            summary: {
              totalValue: `$${totalValue.toFixed(2)}`,
              totalPnl: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`,
              totalPnlPct: totalCost > 0 ? `${((totalPnl / totalCost) * 100).toFixed(1)}%` : '0%',
            },
          },
        });
      }

      case 'get_portfolio_history': {
        const sinceMs = typeof toolInput.since_ms === 'number' ? (toolInput.since_ms as number) : undefined;
        const limit = typeof toolInput.limit === 'number' ? (toolInput.limit as number) : undefined;
        const order = toolInput.order === 'asc' ? 'asc' : toolInput.order === 'desc' ? 'desc' : undefined;

        const snapshots = db.getPortfolioSnapshots(userId, {
          sinceMs,
          limit,
          order,
        });

        return JSON.stringify({
          result: {
            count: snapshots.length,
            snapshots: snapshots.map((snap) => ({
              ...snap,
              createdAt: snap.createdAt.toISOString(),
            })),
          },
        });
      }

      case 'add_position': {
        const position = {
          id: crypto.randomUUID(),
          platform: toolInput.platform as Platform,
          marketId: toolInput.market_id as string,
          marketQuestion: toolInput.market_question as string,
          outcome: toolInput.outcome as string,
          outcomeId: `${toolInput.market_id}-${toolInput.outcome}`,
          side: toolInput.side as 'YES' | 'NO',
          shares: toolInput.shares as number,
          avgPrice: toolInput.avg_price as number,
          currentPrice: toolInput.avg_price as number,
          pnl: 0,
          pnlPct: 0,
          value: (toolInput.shares as number) * (toolInput.avg_price as number),
          openedAt: new Date(),
        };

        db.upsertPosition(userId, position);
        return JSON.stringify({ result: 'Position added successfully', position });
      }

      // Alert tools
      case 'create_alert': {
        const alert: Alert = {
          id: crypto.randomUUID(),
          userId,
          type: 'price',
          name: toolInput.market_name as string,
          marketId: toolInput.market_id as string,
          platform: toolInput.platform as Platform,
          channel: session.channel,
          chatId: session.chatId,
          condition: {
            type: toolInput.condition_type as 'price_above' | 'price_below' | 'price_change_pct',
            threshold: toolInput.threshold as number,
          },
          enabled: true,
          triggered: false,
          createdAt: new Date(),
        };

        db.createAlert(alert);
        return JSON.stringify({
          result: 'Alert created!',
          alert: {
            id: alert.id,
            condition: `${alert.condition.type} ${alert.condition.threshold}`,
          },
        });
      }

      case 'list_alerts': {
        const alerts = db.getAlerts(userId);

        if (alerts.length === 0) {
          return JSON.stringify({ result: 'No active alerts.' });
        }

        return JSON.stringify({
          result: alerts.map(a => ({
            id: a.id,
            name: a.name,
            platform: a.platform,
            condition: `${a.condition.type} ${a.condition.threshold}`,
            enabled: a.enabled,
            triggered: a.triggered,
          })),
        });
      }

      case 'delete_alert': {
        db.deleteAlert(toolInput.alert_id as string);
        return JSON.stringify({ result: 'Alert deleted.' });
      }

      // News tools
      case 'get_recent_news': {
        const limit = (toolInput.limit as number) || 10;
        const news = feeds.getRecentNews(limit);

        if (news.length === 0) {
          return JSON.stringify({ result: 'No recent news available.' });
        }

        return JSON.stringify({
          result: news.map(n => ({
            title: n.title,
            source: n.source,
            publishedAt: n.publishedAt,
            relevantMarkets: n.relevantMarkets,
            url: n.url,
          })),
        });
      }

      case 'search_news': {
        const query = toolInput.query as string;
        const news = feeds.searchNews(query);

        if (news.length === 0) {
          return JSON.stringify({ result: 'No news found for that query.' });
        }

        return JSON.stringify({
          result: news.slice(0, 10).map(n => ({
            title: n.title,
            source: n.source,
            publishedAt: n.publishedAt,
            url: n.url,
          })),
        });
      }

      case 'get_news_for_market': {
        const question = toolInput.market_question as string;
        const news = feeds.getNewsForMarket(question);

        if (news.length === 0) {
          return JSON.stringify({ result: 'No relevant news found.' });
        }

        return JSON.stringify({
          result: news.map(n => ({
            title: n.title,
            source: n.source,
            publishedAt: n.publishedAt,
            url: n.url,
          })),
        });
      }

      // Edge detection tools
      case 'analyze_edge': {
        const analysis = await feeds.analyzeEdge(
          toolInput.market_id as string,
          toolInput.market_question as string,
          toolInput.current_price as number,
          toolInput.category as 'politics' | 'economics' | 'sports' | 'other'
        );

        return JSON.stringify({
          result: {
            marketPrice: `${Math.round(analysis.marketPrice * 100)}¢`,
            fairValue: `${Math.round(analysis.fairValue * 100)}¢`,
            edge: `${analysis.edge >= 0 ? '+' : ''}${Math.round(analysis.edge * 100)}¢`,
            edgePct: `${analysis.edgePct >= 0 ? '+' : ''}${analysis.edgePct.toFixed(1)}%`,
            confidence: analysis.confidence,
            sources: analysis.sources.map(s => ({
              name: s.name,
              probability: `${Math.round(s.probability * 100)}%`,
              type: s.type,
            })),
          },
        });
      }

      case 'calculate_kelly': {
        const result = feeds.calculateKelly(
          toolInput.market_price as number,
          toolInput.estimated_probability as number,
          toolInput.bankroll as number
        );

        return JSON.stringify({
          result: {
            recommendation: 'Use half-Kelly or quarter-Kelly for safety',
            fullKelly: `$${result.fullKelly.toFixed(2)}`,
            halfKelly: `$${result.halfKelly.toFixed(2)} (recommended)`,
            quarterKelly: `$${result.quarterKelly.toFixed(2)} (conservative)`,
          },
        });
      }

      // ============================================
      // WHALE TRACKING & COPY TRADING HANDLERS
      // ============================================

      case 'watch_wallet': {
        const address = (toolInput.address as string).toLowerCase();
        const platform = (toolInput.platform as string) || 'polymarket';
        const nickname = toolInput.nickname as string | undefined;

        // Save to database
        db.run(`
          INSERT OR REPLACE INTO watched_wallets (user_id, address, platform, nickname, created_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `, [userId, address, platform, nickname || null]);

        return JSON.stringify({
          result: {
            message: `Now watching wallet ${nickname ? `"${nickname}" (${address.slice(0,6)}...${address.slice(-4)})` : `${address.slice(0,6)}...${address.slice(-4)}`}`,
            address,
            platform,
            tip: 'You will receive alerts when this wallet makes trades.',
          },
        });
      }

      case 'unwatch_wallet': {
        const address = (toolInput.address as string).toLowerCase();
        db.run('DELETE FROM watched_wallets WHERE user_id = ? AND address = ?', [userId, address]);
        return JSON.stringify({ result: { message: `Stopped watching ${address.slice(0,6)}...${address.slice(-4)}` } });
      }

      case 'list_watched_wallets': {
        const wallets = db.query<{ address: string; platform: string; nickname: string | null; created_at: string }>(
          'SELECT address, platform, nickname, created_at FROM watched_wallets WHERE user_id = ?',
          [userId]
        );

        if (wallets.length === 0) {
          return JSON.stringify({ result: { message: 'No wallets being watched. Use watch_wallet to start tracking.' } });
        }

        return JSON.stringify({
          result: {
            count: wallets.length,
            wallets: wallets.map(w => ({
              address: `${w.address.slice(0,6)}...${w.address.slice(-4)}`,
              fullAddress: w.address,
              platform: w.platform,
              nickname: w.nickname,
              since: w.created_at,
            })),
          },
        });
      }

      case 'get_wallet_trades': {
        const address = toolInput.address as string;
        const limit = (toolInput.limit as number) || 20;
        const platform = (toolInput.platform as string) || 'polymarket';

        let trades: Record<string, unknown>[] = [];

        if (platform === 'polymarket') {
          const response = await fetchPolymarketClob(context, `https://clob.polymarket.com/trades?maker=${address}&limit=${limit}`);
          const data = await response.json() as unknown[];
          trades = (data || []).slice(0, limit).map((t: any) => ({
            market: t.market || 'Unknown',
            side: t.side,
            size: t.size,
            price: `${Math.round(parseFloat(t.price) * 100)}¢`,
            timestamp: t.timestamp,
          }));
        } else if (platform === 'kalshi') {
          // Try to use authenticated API if user has credentials
          const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
          if (kalshiCreds && kalshiCreds.platform === 'kalshi') {
            try {
              const creds = kalshiCreds.data as KalshiCredentials;
              const fillsUrl = `${KALSHI_API_BASE}/fills?limit=${limit}`;

              const apiKeyAuth = getKalshiApiKeyAuth(creds);
              if (apiKeyAuth) {
                const headers = buildKalshiHeadersForUrl(apiKeyAuth, 'GET', fillsUrl);
                const fillsRes = await fetch(fillsUrl, { headers });
                if (!fillsRes.ok) {
                  throw new Error(`Kalshi API error: ${fillsRes.status}`);
                }
                const fillsData = await fillsRes.json() as { fills?: Record<string, unknown>[] };
                trades = (fillsData.fills || []).map((f) => ({
                  ticker: f.ticker,
                  side: f.side,
                  count: f.count,
                  price: `${f.price}¢`,
                  timestamp: f.created_time,
                }));
                await context.credentials.markSuccess(userId, 'kalshi');
              } else if (creds.email && creds.password) {
                // Legacy email/password login fallback
                const loginRes = await fetch(`${KALSHI_API_BASE}/login`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: creds.email, password: creds.password }),
                });
                if (loginRes.ok) {
                  const loginData = await loginRes.json() as { token: string };
                  const fillsRes = await fetch(fillsUrl, {
                    headers: { Authorization: `Bearer ${loginData.token}` },
                  });
                  const fillsData = await fillsRes.json() as { fills?: Record<string, unknown>[] };
                  trades = (fillsData.fills || []).map((f) => ({
                    ticker: f.ticker,
                    side: f.side,
                    count: f.count,
                    price: `${f.price}¢`,
                    timestamp: f.created_time,
                  }));
                  await context.credentials.markSuccess(userId, 'kalshi');
                }
              } else {
                trades = [{ error: 'Kalshi credentials missing. Use setup_kalshi_credentials.' }];
              }
            } catch (err) {
              await context.credentials.markFailure(userId, 'kalshi');
              trades = [{ error: 'Kalshi API error. Try again later.' }];
            }
          } else {
            trades = [{ message: 'Kalshi wallet tracking requires credentials. Use setup_kalshi_credentials first.' }];
          }
        } else if (platform === 'manifold') {
          const response = await fetch(`https://api.manifold.markets/v0/bets?userId=${address}&limit=${limit}`);
          const data = await response.json() as Array<Record<string, unknown>>;
          trades = data.slice(0, limit).map((t) => ({
            market: t.contractSlug || 'Unknown',
            side: t.outcome,
            size: t.amount,
            price: `${Math.round(((t.probAfter as number) || 0) * 100)}¢`,
            timestamp: t.createdTime,
          }));
        } else if (platform === 'metaculus') {
          const response = await fetch(`https://www.metaculus.com/api2/users/${address}/predictions/?limit=${limit}`);
          const data = await response.json() as { results?: Array<Record<string, unknown>> };
          trades = (data.results || []).slice(0, limit).map((t) => ({
            question: t.question_title || 'Unknown',
            prediction: `${Math.round(((t.prediction as number) || 0) * 100)}%`,
            timestamp: t.created_time,
          }));
        } else if (platform === 'predictit') {
          trades = [{
            message: 'PredictIt API limitation: No public user trade history endpoint.',
            suggestion: 'Use PredictIt website or export your data from your account settings.',
            note: 'Market data (prices, volumes) is still available via search_markets.',
          }];
        } else if (platform === 'drift') {
          const response = await fetch(`https://bet.drift.trade/api/users/${address}/trades?limit=${limit}`);
          const data = await response.json() as Array<Record<string, unknown>>;
          trades = data.slice(0, limit).map((t) => ({
            market: t.marketName || 'Unknown',
            side: t.side,
            size: t.size,
            price: `${Math.round(parseFloat(String(t.price) || '0') * 100)}¢`,
            timestamp: t.timestamp,
          }));
        }

        return JSON.stringify({
          result: {
            platform,
            address: address.length > 12 ? `${address.slice(0,6)}...${address.slice(-4)}` : address,
            trades,
          },
        });
      }

      case 'get_wallet_positions': {
        const address = toolInput.address as string;
        const platform = (toolInput.platform as string) || 'polymarket';

        let positions: Record<string, unknown>[] = [];

        if (platform === 'polymarket') {
          const response = await fetch(`https://data-api.polymarket.com/positions?user=${address}`);
          const data = await response.json() as Array<Record<string, unknown>>;
          positions = data.map((p) => ({
            market: p.title || p.market || 'Unknown',
            outcome: p.outcome,
            size: p.size,
            avgPrice: `${Math.round(parseFloat(String(p.avgPrice) || '0') * 100)}¢`,
            currentPrice: `${Math.round(parseFloat(String(p.currentPrice) || '0') * 100)}¢`,
            pnl: p.pnl ? `$${parseFloat(String(p.pnl)).toFixed(2)}` : 'N/A',
          }));
        } else if (platform === 'kalshi') {
          // Try to use authenticated API if user has credentials
          const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
          if (kalshiCreds && kalshiCreds.platform === 'kalshi') {
            try {
              const creds = kalshiCreds.data as KalshiCredentials;
              const positionsUrl = `${KALSHI_API_BASE}/portfolio/positions`;
              const apiKeyAuth = getKalshiApiKeyAuth(creds);

              if (apiKeyAuth) {
                const headers = buildKalshiHeadersForUrl(apiKeyAuth, 'GET', positionsUrl);
                const posRes = await fetch(positionsUrl, { headers });
                if (!posRes.ok) {
                  throw new Error(`Kalshi API error: ${posRes.status}`);
                }
                const posData = await posRes.json() as { market_positions?: Record<string, unknown>[] };
                positions = (posData.market_positions || []).map((p) => ({
                  ticker: p.ticker,
                  side: (p.position as number) > 0 ? 'Yes' : 'No',
                  count: Math.abs(p.position as number),
                  avgPrice: `${p.total_traded ? Math.round(((p.realized_pnl as number) || 0) / (p.total_traded as number) * 100) : 0}¢`,
                  marketPrice: `${p.market_exposure || 0}¢`,
                }));
                await context.credentials.markSuccess(userId, 'kalshi');
              } else if (creds.email && creds.password) {
                const loginRes = await fetch(`${KALSHI_API_BASE}/login`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: creds.email, password: creds.password }),
                });
                if (loginRes.ok) {
                  const loginData = await loginRes.json() as { token: string };
                  const posRes = await fetch(positionsUrl, {
                    headers: { Authorization: `Bearer ${loginData.token}` },
                  });
                  const posData = await posRes.json() as { market_positions?: Record<string, unknown>[] };
                  positions = (posData.market_positions || []).map((p) => ({
                    ticker: p.ticker,
                    side: (p.position as number) > 0 ? 'Yes' : 'No',
                    count: Math.abs(p.position as number),
                    avgPrice: `${p.total_traded ? Math.round(((p.realized_pnl as number) || 0) / (p.total_traded as number) * 100) : 0}¢`,
                    marketPrice: `${p.market_exposure || 0}¢`,
                  }));
                  await context.credentials.markSuccess(userId, 'kalshi');
                }
              } else {
                positions = [{ error: 'Kalshi credentials missing. Use setup_kalshi_credentials.' }];
              }
            } catch (err) {
              await context.credentials.markFailure(userId, 'kalshi');
              positions = [{ error: 'Kalshi API error. Try again later.' }];
            }
          } else {
            positions = [{ message: 'Kalshi positions require credentials. Use setup_kalshi_credentials first.' }];
          }
        } else if (platform === 'manifold') {
          const response = await fetch(`https://api.manifold.markets/v0/bets?userId=${address}`);
          const data = await response.json() as Array<{ contractId?: string; contractSlug?: string; shares?: number; amount?: number }>;
          const byMarket = new Map<string, { market: string | undefined; shares: number; totalCost: number }>();
          for (const bet of data) {
            if (bet.contractId && !byMarket.has(bet.contractId)) {
              byMarket.set(bet.contractId, { market: bet.contractSlug, shares: 0, totalCost: 0 });
            }
            const pos = bet.contractId ? byMarket.get(bet.contractId) : undefined;
            if (pos) {
              pos.shares += bet.shares || 0;
              pos.totalCost += bet.amount || 0;
            }
          }
          positions = Array.from(byMarket.values()).filter(p => p.shares > 0);
        } else if (platform === 'metaculus') {
          const response = await fetch(`https://www.metaculus.com/api2/users/${address}/predictions/`);
          const data = await response.json() as { results?: Array<Record<string, unknown>> };
          positions = (data.results || []).slice(0, 20).map((p) => ({
            question: p.question_title || 'Unknown',
            prediction: `${Math.round(((p.prediction as number) || 0) * 100)}%`,
            status: p.question_status,
          }));
        } else if (platform === 'predictit') {
          positions = [{
            message: 'PredictIt API limitation: No public user positions endpoint.',
            suggestion: 'Check your positions on the PredictIt website or mobile app.',
            note: 'Market data (prices, volumes) is still available via search_markets.',
          }];
        } else if (platform === 'drift') {
          const response = await fetch(`https://bet.drift.trade/api/users/${address}/positions`);
          const data = await response.json() as Array<Record<string, unknown>>;
          positions = data.map((p) => ({
            market: p.marketName || 'Unknown',
            side: p.side,
            size: p.size,
            entryPrice: `${Math.round(parseFloat(String(p.entryPrice || 0)) * 100)}¢`,
          }));
        }

        return JSON.stringify({
          result: {
            platform,
            address: address.length > 12 ? `${address.slice(0,6)}...${address.slice(-4)}` : address,
            positions,
          },
        });
      }

      case 'get_wallet_pnl': {
        const address = toolInput.address as string;
        const platform = (toolInput.platform as string) || 'polymarket';

        let pnlData: any = {};

        if (platform === 'polymarket') {
          // PnL endpoint removed — compute from positions data
          const [openRes, closedRes] = await Promise.all([
            fetch(`https://data-api.polymarket.com/positions?user=${address}&sizeThreshold=.1`),
            fetch(`https://data-api.polymarket.com/positions?user=${address}&status=closed&sizeThreshold=.1`),
          ]);
          const openPositions = await openRes.json() as Array<{ currentValue?: number; initialValue?: number; cashPnl?: number; percentPnl?: number; size?: number }>;
          const closedPositions = await closedRes.json() as Array<{ cashPnl?: number; percentPnl?: number; size?: number }>;
          const realizedPnl = (Array.isArray(closedPositions) ? closedPositions : []).reduce((sum, p) => sum + (p.cashPnl || 0), 0);
          const unrealizedPnl = (Array.isArray(openPositions) ? openPositions : []).reduce((sum, p) => sum + ((p.currentValue || 0) - (p.initialValue || 0)), 0);
          const allTrades = [...(Array.isArray(closedPositions) ? closedPositions : [])];
          const wins = allTrades.filter(p => (p.cashPnl || 0) > 0).length;
          pnlData = {
            totalPnl: `$${(realizedPnl + unrealizedPnl).toFixed(2)}`,
            realizedPnl: `$${realizedPnl.toFixed(2)}`,
            unrealizedPnl: `$${unrealizedPnl.toFixed(2)}`,
            winRate: allTrades.length > 0 ? `${((wins / allTrades.length) * 100).toFixed(1)}%` : 'N/A',
            tradesCount: allTrades.length || 'N/A',
          };
        } else if (platform === 'kalshi') {
          // Try to use authenticated API if user has credentials
          const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
          if (kalshiCreds && kalshiCreds.platform === 'kalshi') {
            try {
              const creds = kalshiCreds.data as KalshiCredentials;
              const balanceUrl = `${KALSHI_API_BASE}/portfolio/balance`;
              const apiKeyAuth = getKalshiApiKeyAuth(creds);

              if (apiKeyAuth) {
                const headers = buildKalshiHeadersForUrl(apiKeyAuth, 'GET', balanceUrl);
                const balRes = await fetch(balanceUrl, { headers });
                if (!balRes.ok) {
                  throw new Error(`Kalshi API error: ${balRes.status}`);
                }
                const balData = await balRes.json() as KalshiBalanceResponse;
                pnlData = {
                  balance: balData.balance !== undefined ? `$${(balData.balance / 100).toFixed(2)}` : 'N/A',
                  portfolioValue: balData.portfolio_value !== undefined ? `$${(balData.portfolio_value / 100).toFixed(2)}` : 'N/A',
                  pnl: balData.pnl !== undefined ? `$${(balData.pnl / 100).toFixed(2)}` : 'N/A',
                };
                await context.credentials.markSuccess(userId, 'kalshi');
              } else if (creds.email && creds.password) {
                const loginRes = await fetch(`${KALSHI_API_BASE}/login`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: creds.email, password: creds.password }),
                });
                if (loginRes.ok) {
                  const loginData = await loginRes.json() as { token: string };
                  const balRes = await fetch(balanceUrl, {
                    headers: { Authorization: `Bearer ${loginData.token}` },
                  });
                  const balData = await balRes.json() as KalshiBalanceResponse;
                  pnlData = {
                    balance: balData.balance !== undefined ? `$${(balData.balance / 100).toFixed(2)}` : 'N/A',
                    portfolioValue: balData.portfolio_value !== undefined ? `$${(balData.portfolio_value / 100).toFixed(2)}` : 'N/A',
                    pnl: balData.pnl !== undefined ? `$${(balData.pnl / 100).toFixed(2)}` : 'N/A',
                  };
                  await context.credentials.markSuccess(userId, 'kalshi');
                }
              } else {
                pnlData = { error: 'Kalshi credentials missing. Use setup_kalshi_credentials.' };
              }
            } catch (err) {
              await context.credentials.markFailure(userId, 'kalshi');
              pnlData = { error: 'Kalshi API error. Try again later.' };
            }
          } else {
            pnlData = { message: 'Kalshi P&L requires credentials. Use setup_kalshi_credentials first.' };
          }
        } else if (platform === 'manifold') {
          const response = await fetch(`https://api.manifold.markets/v0/user/${address}`);
          const data = await response.json() as { profitCached?: { allTime?: number }; balance?: number; creatorTraders?: { allTime?: number } };
          pnlData = {
            totalPnl: data.profitCached ? `M$${(data.profitCached.allTime || 0).toFixed(0)}` : 'N/A',
            balance: data.balance !== undefined ? `M$${data.balance.toFixed(0)}` : 'N/A',
            tradesCount: data.creatorTraders?.allTime || 'N/A',
          };
        } else if (platform === 'metaculus') {
          const response = await fetch(`https://www.metaculus.com/api2/users/${address}/`);
          const data = await response.json() as { score?: number; question_count?: number; rank?: number; points?: number };
          pnlData = {
            accuracy: data.score !== undefined ? `${data.score.toFixed(2)}` : 'N/A',
            questionsAnswered: data.question_count || 'N/A',
            rank: data.rank || 'N/A',
            points: data.points || 'N/A',
          };
        } else if (platform === 'predictit') {
          pnlData = {
            message: 'PredictIt API limitation: No public user P&L endpoint.',
            suggestion: 'Check your portfolio value on the PredictIt website.',
            note: 'You can manually track P&L using paper trading mode.',
          };
        } else if (platform === 'drift') {
          const response = await fetch(`https://bet.drift.trade/api/users/${address}/pnl`);
          const data = await response.json() as { totalPnl?: string; realizedPnl?: string; tradesCount?: number };
          pnlData = {
            totalPnl: data.totalPnl ? `$${parseFloat(data.totalPnl).toFixed(2)}` : 'N/A',
            realizedPnl: data.realizedPnl ? `$${parseFloat(data.realizedPnl).toFixed(2)}` : 'N/A',
            tradesCount: data.tradesCount || 'N/A',
          };
        }

        return JSON.stringify({
          result: {
            platform,
            address: address.length > 12 ? `${address.slice(0,6)}...${address.slice(-4)}` : address,
            ...pnlData,
          },
        });
      }

      case 'get_top_traders': {
        const sortBy = (toolInput.sort_by as string) || 'profit';
        const period = (toolInput.period as string) || '7d';
        const limit = (toolInput.limit as number) || 10;
        const platform = (toolInput.platform as string) || 'polymarket';

        let traders: Record<string, unknown>[] = [];

        if (platform === 'polymarket') {
          // Map period param to API timePeriod
          const timePeriodMap: Record<string, string> = { '24h': '24hr', '7d': '7d', '30d': '30d', 'all': 'ALL' };
          const timePeriod = timePeriodMap[period] || 'ALL';
          const orderBy = sortBy === 'volume' ? 'VOLUME' : 'PNL';
          const response = await fetch(`https://data-api.polymarket.com/v1/leaderboard?limit=${limit}&timePeriod=${timePeriod}&orderBy=${orderBy}`);
          const data = await response.json() as Array<Record<string, unknown>>;
          traders = (Array.isArray(data) ? data : []).slice(0, limit).map((t, i) => ({
            rank: i + 1,
            address: `${String(t.address || '').slice(0,6)}...${String(t.address || '').slice(-4)}`,
            fullAddress: t.address,
            profit: `$${parseFloat(String(t.pnl || t.profit || 0)).toFixed(2)}`,
            volume: `$${parseFloat(String(t.volume || 0)).toFixed(0)}`,
            markets: t.marketsTraded || t.markets || 'N/A',
          }));
        } else if (platform === 'kalshi') {
          traders = [{ message: 'Kalshi leaderboard not publicly available.' }];
        } else if (platform === 'manifold') {
          const response = await fetch(`https://api.manifold.markets/v0/users?limit=${limit}`);
          const data = await response.json() as Array<{ username?: string; name?: string; profitCached?: { allTime?: number }; balance?: number }>;
          traders = data.slice(0, limit).map((t, i) => ({
            rank: i + 1,
            username: t.username,
            name: t.name,
            profit: t.profitCached?.allTime !== undefined ? `M$${t.profitCached.allTime.toFixed(0)}` : 'N/A',
            balance: t.balance !== undefined ? `M$${t.balance.toFixed(0)}` : 'N/A',
          }));
        } else if (platform === 'metaculus') {
          const response = await fetch(`https://www.metaculus.com/api2/users/?order_by=-score&limit=${limit}`);
          const data = await response.json() as { results?: Array<{ username?: string; score?: number; question_count?: number; points?: number }> };
          traders = (data.results || []).slice(0, limit).map((t, i) => ({
            rank: i + 1,
            username: t.username,
            score: t.score !== undefined ? t.score.toFixed(2) : 'N/A',
            questionsAnswered: t.question_count || 0,
            points: t.points || 0,
          }));
        } else if (platform === 'predictit') {
          traders = [{ message: 'PredictIt does not have a public leaderboard.' }];
        } else if (platform === 'drift') {
          const response = await fetch(`https://bet.drift.trade/api/leaderboard?limit=${limit}`);
          const data = await response.json() as Array<Record<string, unknown>>;
          traders = data.slice(0, limit).map((t, i) => ({
            rank: i + 1,
            address: `${String(t.address || '').slice(0,6)}...${String(t.address || '').slice(-4)}`,
            fullAddress: t.address,
            profit: `$${parseFloat(String(t.profit || 0)).toFixed(2)}`,
            volume: `$${parseFloat(String(t.volume || 0)).toFixed(0)}`,
          }));
        }

        return JSON.stringify({
          result: {
            platform,
            period,
            sortedBy: sortBy,
            traders,
          },
        });
      }

      case 'copy_trade': {
        const address = (toolInput.address as string).toLowerCase();
        const tradeId = toolInput.trade_id as string;
        const sizeMultiplier = (toolInput.size_multiplier as number) || 0.5;

        // Currently only Polymarket copy trading is supported
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'Copy trading requires Polymarket credentials. Use setup_polymarket_credentials first.',
          });
        }

        try {
          // Fetch the original trade from the wallet
          const tradesRes = await fetchPolymarketClob(context, `https://clob.polymarket.com/trades?maker=${address}&limit=50`);
          const tradesData = await tradesRes.json() as PolymarketTradeResponse[];

          // Find the specific trade
          const originalTrade = (tradesData || []).find((t: any) => t.id === tradeId || t.hash === tradeId);
          if (!originalTrade) {
            return JSON.stringify({ error: `Trade ${tradeId} not found for wallet ${address}` });
          }

          // Calculate copy size
          const originalSize = parseFloat(originalTrade.size || '0');
          const copySize = Math.max(1, Math.floor(originalSize * sizeMultiplier));
          const price = parseFloat(originalTrade.price || '0.5');
          const side = originalTrade.side;
          const tokenId = originalTrade.asset_id || originalTrade.token_id;

          if (!tokenId) {
            return JSON.stringify({ error: 'Could not determine token ID from original trade' });
          }

          // Execute the copy trade via execution service
          const execSvc = context.tradingContext?.executionService;
          if (!execSvc) {
            return JSON.stringify({ error: 'Trading execution not available. Configure trading.enabled=true.' });
          }
          const orderResult = side === 'BUY'
            ? await execSvc.buyLimit({ platform: 'polymarket', marketId: tokenId, tokenId, price, size: copySize })
            : await execSvc.sellLimit({ platform: 'polymarket', marketId: tokenId, tokenId, price, size: copySize });
          const output = JSON.stringify(orderResult);
          await context.credentials.markSuccess(userId, 'polymarket');

          return JSON.stringify({
            result: {
              status: 'copied',
              original: {
                wallet: `${address.slice(0,6)}...${address.slice(-4)}`,
                side,
                size: originalSize,
                price: `${Math.round(price * 100)}¢`,
              },
              copied: {
                side,
                size: copySize,
                price: `${Math.round(price * 100)}¢`,
              },
              output: output.trim(),
            },
          });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'polymarket');
          }
          return JSON.stringify({ error: 'Copy trade failed', details: error.stderr || error.message });
        }
      }

      case 'enable_auto_copy': {
        const address = (toolInput.address as string).toLowerCase();
        const maxSize = toolInput.max_size as number;
        const sizeMultiplier = (toolInput.size_multiplier as number) || 0.5;
        const minConfidence = (toolInput.min_confidence as number) || 0.55;

        db.run(`
          INSERT OR REPLACE INTO auto_copy_settings (user_id, target_address, max_size, size_multiplier, min_confidence, enabled, created_at)
          VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
        `, [userId, address, maxSize, sizeMultiplier, minConfidence]);

        return JSON.stringify({
          result: {
            message: `Auto-copy enabled for ${address.slice(0,6)}...${address.slice(-4)}`,
            settings: {
              maxSize: `$${maxSize}`,
              sizeMultiplier: `${sizeMultiplier * 100}%`,
              minConfidence: `${minConfidence * 100}%`,
            },
            warning: '⚠️ Auto-copy executes real trades automatically. Use with caution.',
          },
        });
      }

      case 'disable_auto_copy': {
        const address = (toolInput.address as string).toLowerCase();
        db.run('UPDATE auto_copy_settings SET enabled = 0 WHERE user_id = ? AND target_address = ?', [userId, address]);
        return JSON.stringify({ result: { message: `Auto-copy disabled for ${address.slice(0,6)}...${address.slice(-4)}` } });
      }

      case 'list_auto_copy': {
        const settings = db.query<{ target_address: string; max_size: number; size_multiplier: number; min_confidence: number }>(
          'SELECT target_address, max_size, size_multiplier, min_confidence FROM auto_copy_settings WHERE user_id = ? AND enabled = 1',
          [userId]
        );

        if (settings.length === 0) {
          return JSON.stringify({ result: { message: 'No auto-copy wallets configured. Use enable_auto_copy to set one up.' } });
        }

        return JSON.stringify({
          result: {
            count: settings.length,
            wallets: settings.map(s => ({
              address: `${s.target_address.slice(0,6)}...${s.target_address.slice(-4)}`,
              maxSize: `$${s.max_size}`,
              sizeMultiplier: `${s.size_multiplier * 100}%`,
              minConfidence: `${s.min_confidence * 100}%`,
            })),
          },
        });
      }

      // ============================================
      // ARBITRAGE & CROSS-PLATFORM HANDLERS
      // ============================================

      case 'find_arbitrage': {
        const minEdge = (toolInput.min_edge as number) || 1;
        const query = (toolInput.query as string | undefined)?.trim() || '';
        const limit = (toolInput.limit as number) || 10;
        const mode = (toolInput.mode as string) || 'both';
        const minVolume = (toolInput.min_volume as number) || 0;
        const platforms = (toolInput.platforms as string[]) || ['polymarket', 'kalshi', 'manifold'];

        const normalize = (text: string) =>
          text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const opportunities: Array<Record<string, unknown>> = [];

        // Internal YES/NO arbitrage (Polymarket only)
        if (mode === 'both' || mode === 'internal') {
          const polyMarkets = await feeds.searchMarkets(query, 'polymarket');
          for (const market of polyMarkets.slice(0, 60)) {
            if (minVolume && (market.volume24h || 0) < minVolume) continue;
            if (market.outcomes.length < 2) continue;

            const yesOutcome = market.outcomes.find((o) => o.name?.toLowerCase() === 'yes') || market.outcomes[0];
            const noOutcome = market.outcomes.find((o) => o.name?.toLowerCase() === 'no') || market.outcomes[1];
            if (!yesOutcome || !noOutcome) continue;

            const yesPrice = yesOutcome.price ?? 0;
            const noPrice = noOutcome.price ?? 0;
            if (!Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) continue;

            const sum = yesPrice + noPrice;
            const edge = (1 - sum) * 100;

            if (edge >= minEdge) {
              opportunities.push({
                type: 'internal_arb',
                platform: market.platform,
                market: market.question,
                yesPrice: `${Math.round(yesPrice * 100)}¢`,
                noPrice: `${Math.round(noPrice * 100)}¢`,
                sum: `${Math.round(sum * 100)}¢`,
                edge: `${edge.toFixed(2)}%`,
                action: `Buy YES at ${Math.round(yesPrice * 100)}¢ + NO at ${Math.round(noPrice * 100)}¢ = ${edge.toFixed(2)}% edge`,
              });
            }
          }
        }

        // Cross-platform price discrepancies
        if (mode === 'both' || mode === 'cross') {
          const searchResults = await Promise.all(
            platforms.map(async (platform) => ({
              platform,
              markets: await feeds.searchMarkets(query, platform),
            }))
          );

          const grouped = new Map<string, Array<{ platform: string; market: Market; yesPrice: number }>>();
          for (const { platform, markets } of searchResults) {
            for (const market of markets.slice(0, 30)) {
              if (minVolume && (market.volume24h || 0) < minVolume) continue;
              const yesOutcome = market.outcomes.find((o) => o.name?.toLowerCase() === 'yes') || market.outcomes[0];
              if (!yesOutcome || !Number.isFinite(yesOutcome.price)) continue;
              const key = normalize(market.question).split(' ').slice(0, 8).join(' ');
              if (!key) continue;
              const list = grouped.get(key) || [];
              list.push({ platform, market, yesPrice: yesOutcome.price });
              grouped.set(key, list);
            }
          }

          for (const [, entries] of grouped.entries()) {
            const uniquePlatforms = new Set(entries.map((e) => e.platform));
            if (uniquePlatforms.size < 2) continue;

            const sorted = entries.slice().sort((a, b) => a.yesPrice - b.yesPrice);
            const low = sorted[0];
            const high = sorted[sorted.length - 1];
            const spread = (high.yesPrice - low.yesPrice) * 100;
            if (spread < minEdge) continue;

            opportunities.push({
              type: 'cross_platform',
              topic: low.market.question,
              low: { platform: low.platform, price: `${Math.round(low.yesPrice * 100)}¢` },
              high: { platform: high.platform, price: `${Math.round(high.yesPrice * 100)}¢` },
              spread: `${spread.toFixed(2)}%`,
            });
          }
        }

        opportunities.sort((a, b) => {
          const edgeA = Number.parseFloat(String((a.edge as string) ?? (a.spread as string) ?? '0')) || 0;
          const edgeB = Number.parseFloat(String((b.edge as string) ?? (b.spread as string) ?? '0')) || 0;
          return edgeB - edgeA;
        });

        return JSON.stringify({
          result: {
            query: query || undefined,
            minEdge: `${minEdge}%`,
            mode,
            opportunities: opportunities.slice(0, limit),
            message: opportunities.length === 0
              ? 'No arbitrage opportunities found above the minimum edge threshold.'
              : `Found ${opportunities.length} opportunities`,
          },
        });
      }

      case 'compare_prices': {
        const query = toolInput.query as string;

        // Search across all platforms
        const [polyResults, kalshiResults, manifoldResults] = await Promise.all([
          feeds.searchMarkets(query, 'polymarket'),
          feeds.searchMarkets(query, 'kalshi'),
          feeds.searchMarkets(query, 'manifold'),
        ]);

        const comparisons = [];

        // Simple string matching to find similar markets
        for (const poly of polyResults.slice(0, 5)) {
          const comparison: any = {
            topic: poly.question.slice(0, 60) + (poly.question.length > 60 ? '...' : ''),
            polymarket: poly.outcomes[0] ? `${Math.round(poly.outcomes[0].price * 100)}¢` : 'N/A',
          };

          // Find matching Kalshi market
          const kalshiMatch = kalshiResults.find(k =>
            k.question.toLowerCase().includes(query.toLowerCase()) ||
            poly.question.toLowerCase().includes(k.question.toLowerCase().split(' ')[0])
          );
          if (kalshiMatch?.outcomes[0]) {
            comparison.kalshi = `${Math.round(kalshiMatch.outcomes[0].price * 100)}¢`;
          }

          // Find matching Manifold market
          const manifoldMatch = manifoldResults.find(m =>
            m.question.toLowerCase().includes(query.toLowerCase()) ||
            poly.question.toLowerCase().includes(m.question.toLowerCase().split(' ')[0])
          );
          if (manifoldMatch?.outcomes[0]) {
            comparison.manifold = `${Math.round(manifoldMatch.outcomes[0].price * 100)}¢`;
          }

          comparisons.push(comparison);
        }

        return JSON.stringify({
          result: {
            query,
            comparisons,
            tip: 'Look for price differences > 5% for potential cross-platform arbitrage.',
          },
        });
      }

      case 'execute_arbitrage': {
        const marketId = toolInput.market_id as string;
        const platform = (toolInput.platform as string) || 'polymarket';
        const size = toolInput.size as number;

        if (platform !== 'polymarket') {
          return JSON.stringify({ error: 'Arbitrage execution currently only supported on Polymarket' });
        }

        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'Arbitrage execution requires Polymarket credentials. Use setup_polymarket_credentials first.',
          });
        }

        try {
          // Fetch the market to get current prices and token IDs
          const marketRes = await fetchPolymarketClob(context, `https://clob.polymarket.com/markets/${marketId}`);
          if (!marketRes.ok) {
            return JSON.stringify({ error: `Market ${marketId} not found` });
          }
          const marketData = await marketRes.json() as PolymarketMarketResponse;

          // Get YES and NO token IDs and prices
          const tokens = marketData.tokens || [];
          const yesToken = tokens.find((t) => t.outcome === 'Yes');
          const noToken = tokens.find((t) => t.outcome === 'No');

          if (!yesToken || !noToken) {
            return JSON.stringify({ error: 'Could not find YES/NO tokens for this market' });
          }

          // Fetch current orderbook prices
          const [yesBookRes, noBookRes] = await Promise.all([
            fetchPolymarketClob(context, `https://clob.polymarket.com/book?token_id=${yesToken.token_id}`),
            fetchPolymarketClob(context, `https://clob.polymarket.com/book?token_id=${noToken.token_id}`),
          ]);
          const yesBook = await yesBookRes.json() as PolymarketBookResponse;
          const noBook = await noBookRes.json() as PolymarketBookResponse;

          const yesAsk = parseFloat(yesBook.asks?.[0]?.price || '0.99');
          const noAsk = parseFloat(noBook.asks?.[0]?.price || '0.99');
          const sum = yesAsk + noAsk;

          if (sum >= 1) {
            return JSON.stringify({
              error: 'No arbitrage opportunity',
              yesPrice: `${Math.round(yesAsk * 100)}¢`,
              noPrice: `${Math.round(noAsk * 100)}¢`,
              sum: `${Math.round(sum * 100)}¢`,
              message: 'YES + NO prices sum to $1 or more - no profit available',
            });
          }

          const edge = (1 - sum) * 100;
          const profit = (size * 2) * (1 - sum);

          // Execute both trades via execution service
          const execSvc = context.tradingContext?.executionService;
          if (!execSvc) {
            return JSON.stringify({ error: 'Trading execution not available. Configure trading.enabled=true.' });
          }

          // Buy YES
          const yesResult = await execSvc.buyLimit({ platform: 'polymarket', marketId: yesToken.token_id, tokenId: yesToken.token_id, price: yesAsk, size });

          // Buy NO
          const noResult = await execSvc.buyLimit({ platform: 'polymarket', marketId: noToken.token_id, tokenId: noToken.token_id, price: noAsk, size });

          await context.credentials.markSuccess(userId, 'polymarket');

          return JSON.stringify({
            result: {
              status: 'executed',
              market: marketData.question?.slice(0, 50) || marketId,
              trades: [
                { side: 'YES', price: `${Math.round(yesAsk * 100)}¢`, size, result: yesResult },
                { side: 'NO', price: `${Math.round(noAsk * 100)}¢`, size, result: noResult },
              ],
              edge: `${edge.toFixed(2)}%`,
              expectedProfit: `$${profit.toFixed(2)}`,
              note: 'Profit is locked in at market resolution regardless of outcome',
            },
          });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Arbitrage execution failed', details: error.message });
        }
      }

      // ============================================
      // PAPER TRADING HANDLERS
      // ============================================

      case 'paper_trading_mode': {
        const enabled = toolInput.enabled as boolean;
        const startingBalance = (toolInput.starting_balance as number) || 10000;

        db.run(`
          INSERT OR REPLACE INTO paper_trading_settings (user_id, enabled, balance, starting_balance, created_at)
          VALUES (?, ?, COALESCE((SELECT balance FROM paper_trading_settings WHERE user_id = ?), ?), ?, datetime('now'))
        `, [userId, enabled ? 1 : 0, userId, startingBalance, startingBalance]);

        return JSON.stringify({
          result: {
            mode: enabled ? 'PAPER TRADING ENABLED' : 'REAL TRADING MODE',
            message: enabled
              ? `Paper trading active with $${startingBalance.toLocaleString()} virtual balance. All trades are simulated.`
              : 'Paper trading disabled. ⚠️ All trades will use real funds.',
          },
        });
      }

      case 'paper_balance': {
        const settings = db.query<{ balance: number; starting_balance: number }>(
          'SELECT balance, starting_balance FROM paper_trading_settings WHERE user_id = ?',
          [userId]
        )[0];

        if (!settings) {
          return JSON.stringify({ result: { message: 'Paper trading not set up. Use paper_trading_mode to enable.' } });
        }

        const pnl = settings.balance - settings.starting_balance;
        const pnlPct = (pnl / settings.starting_balance) * 100;

        return JSON.stringify({
          result: {
            balance: `$${settings.balance.toLocaleString()}`,
            startingBalance: `$${settings.starting_balance.toLocaleString()}`,
            pnl: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
            pnlPct: `${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`,
          },
        });
      }

      case 'paper_positions': {
        const positions = db.query<{ market_id: string; market_name: string; side: string; size: number; entry_price: number }>(
          'SELECT market_id, market_name, side, size, entry_price FROM paper_positions WHERE user_id = ?',
          [userId]
        );

        if (positions.length === 0) {
          return JSON.stringify({ result: { message: 'No paper trading positions. Start trading to build your portfolio!' } });
        }

        return JSON.stringify({
          result: {
            count: positions.length,
            positions: positions.map(p => ({
              market: p.market_name.slice(0, 40) + (p.market_name.length > 40 ? '...' : ''),
              side: p.side,
              size: p.size,
              entryPrice: `${Math.round(p.entry_price * 100)}¢`,
            })),
          },
        });
      }

      case 'paper_reset': {
        const startingBalance = (toolInput.starting_balance as number) || 10000;

        db.run('DELETE FROM paper_positions WHERE user_id = ?', [userId]);
        db.run('DELETE FROM paper_trades WHERE user_id = ?', [userId]);
        db.run(`
          UPDATE paper_trading_settings SET balance = ?, starting_balance = ? WHERE user_id = ?
        `, [startingBalance, startingBalance, userId]);

        return JSON.stringify({
          result: {
            message: `Paper trading account reset to $${startingBalance.toLocaleString()}`,
            balance: `$${startingBalance.toLocaleString()}`,
          },
        });
      }

      case 'paper_history': {
        const trades = db.query<{ market_name: string; side: string; size: number; price: number; pnl: number; created_at: string }>(
          'SELECT market_name, side, size, price, pnl, created_at FROM paper_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
          [userId]
        );

        const stats = db.query<{ total_trades: number; winning_trades: number; total_pnl: number }>(
          `SELECT COUNT(*) as total_trades, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades, SUM(pnl) as total_pnl
           FROM paper_trades WHERE user_id = ?`,
          [userId]
        )[0];

        return JSON.stringify({
          result: {
            stats: {
              totalTrades: stats?.total_trades || 0,
              winRate: stats?.total_trades ? `${((stats.winning_trades / stats.total_trades) * 100).toFixed(1)}%` : 'N/A',
              totalPnl: `$${(stats?.total_pnl || 0).toFixed(2)}`,
            },
            recentTrades: trades.map(t => ({
              market: t.market_name.slice(0, 30) + '...',
              side: t.side,
              size: t.size,
              price: `${Math.round(t.price * 100)}¢`,
              pnl: `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}`,
              date: t.created_at,
            })),
          },
        });
      }

      // ============================================
      // WHALE ALERTS HANDLERS
      // ============================================

      case 'whale_alerts': {
        const enabled = toolInput.enabled as boolean;
        const minSize = (toolInput.min_size as number) || 10000;
        const markets = toolInput.markets as string[] | undefined;

        db.run(`
          INSERT OR REPLACE INTO alert_settings (user_id, type, enabled, min_size, markets, created_at)
          VALUES (?, 'whale', ?, ?, ?, datetime('now'))
        `, [userId, enabled ? 1 : 0, minSize, markets ? JSON.stringify(markets) : null]);

        return JSON.stringify({
          result: {
            type: 'whale_alerts',
            enabled,
            minSize: `$${minSize.toLocaleString()}`,
            markets: markets || 'all',
            message: enabled
              ? `Whale alerts enabled. You'll be notified of trades ≥ $${minSize.toLocaleString()}`
              : 'Whale alerts disabled.',
          },
        });
      }

      case 'new_market_alerts': {
        const enabled = toolInput.enabled as boolean;
        const categories = toolInput.categories as string[] | undefined;

        db.run(`
          INSERT OR REPLACE INTO alert_settings (user_id, type, enabled, categories, created_at)
          VALUES (?, 'new_market', ?, ?, datetime('now'))
        `, [userId, enabled ? 1 : 0, categories ? JSON.stringify(categories) : null]);

        return JSON.stringify({
          result: {
            type: 'new_market_alerts',
            enabled,
            categories: categories || 'all',
            message: enabled
              ? 'New market alerts enabled.'
              : 'New market alerts disabled.',
          },
        });
      }

      case 'volume_spike_alerts': {
        const enabled = toolInput.enabled as boolean;
        const threshold = (toolInput.threshold_multiplier as number) || 3;

        db.run(`
          INSERT OR REPLACE INTO alert_settings (user_id, type, enabled, threshold, created_at)
          VALUES (?, 'volume_spike', ?, ?, datetime('now'))
        `, [userId, enabled ? 1 : 0, threshold]);

        return JSON.stringify({
          result: {
            type: 'volume_spike_alerts',
            enabled,
            threshold: `${threshold}x normal volume`,
            message: enabled
              ? `Volume spike alerts enabled. You'll be notified when volume exceeds ${threshold}x normal.`
              : 'Volume spike alerts disabled.',
          },
        });
      }

      // ============================================
      // CREDENTIAL ONBOARDING HANDLERS
      // ============================================

      case 'setup_polymarket_credentials': {
        const creds: PolymarketCredentials = {
          privateKey: toolInput.private_key as string,
          funderAddress: toolInput.funder_address as string,
          apiKey: toolInput.api_key as string,
          apiSecret: toolInput.api_secret as string,
          apiPassphrase: toolInput.api_passphrase as string,
        };

        await context.credentials.setCredentials(userId, 'polymarket', creds);
        return JSON.stringify({
          result: 'Polymarket credentials saved! You can now trade on Polymarket.',
          wallet: creds.funderAddress,
          security_notice: 'Your credentials are encrypted and stored securely. For maximum security, consider using a dedicated trading wallet with limited funds. Never share your private key with anyone else.',
        });
      }

      case 'setup_kalshi_credentials': {
        const apiKeyId = toolInput.api_key_id as string;
        const privateKeyPem = toolInput.private_key_pem as string;
        if (!apiKeyId || !privateKeyPem) {
          return JSON.stringify({
            error: 'Kalshi credentials require api_key_id and private_key_pem.',
          });
        }

        const creds: KalshiCredentials = {
          apiKeyId,
          privateKeyPem: normalizeKalshiPrivateKey(privateKeyPem),
        };

        await context.credentials.setCredentials(userId, 'kalshi', creds);
        return JSON.stringify({
          result: 'Kalshi credentials saved! You can now trade on Kalshi.',
          security_notice: 'Your credentials are encrypted and stored securely. Keep your private key safe and rotate it if compromised.',
        });
      }

      case 'setup_manifold_credentials': {
        const creds: ManifoldCredentials = {
          apiKey: toolInput.api_key as string,
        };

        await context.credentials.setCredentials(userId, 'manifold', creds);
        return JSON.stringify({
          result: 'Manifold credentials saved! You can now bet on Manifold.',
          security_notice: 'Your API key is encrypted and stored securely. You can regenerate your API key on Manifold settings if needed.',
        });
      }

      case 'list_trading_credentials': {
        const platforms = await context.credentials.listUserPlatforms(userId);

        if (platforms.length === 0) {
          return JSON.stringify({
            result: 'No trading credentials set up yet. Use setup_polymarket_credentials, setup_kalshi_credentials, or setup_manifold_credentials to enable trading.',
          });
        }

        return JSON.stringify({
          result: `Trading enabled for: ${platforms.join(', ')}`,
          platforms,
        });
      }

      case 'delete_trading_credentials': {
        const platform = toolInput.platform as Platform;
        await context.credentials.deleteCredentials(userId, platform);
        return JSON.stringify({
          result: `Deleted ${platform} credentials.`,
        });
      }

      // ============================================
      // TRADING EXECUTION HANDLERS
      // ============================================

      case 'polymarket_buy': {
        // Check for execution service first (preferred)
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          const tokenId = toolInput.token_id as string;
          const price = toolInput.price as number;
          const size = toolInput.size as number;
          const notional = price * size;
          const maxError = enforceMaxOrderSize(context, notional, 'polymarket_buy');
          if (maxError) return maxError;
          const exposureError = enforceExposureLimits(context, userId, {
            platform: 'polymarket',
            outcomeId: tokenId,
            notional,
            label: 'polymarket_buy',
          });
          if (exposureError) return exposureError;

          try {
            const result = await execSvc.buyLimit({
              platform: 'polymarket',
              marketId: tokenId,
              tokenId,
              price,
              size,
              orderType: 'GTC',
            });

            if (result.success) {
              await context.credentials.markSuccess(userId, 'polymarket');
              return JSON.stringify({
                result: 'Order placed',
                orderId: result.orderId,
                avgFillPrice: result.avgFillPrice,
              });
            } else {
              return JSON.stringify({ error: 'Order failed', details: result.error });
            }
          } catch (err: unknown) {
            const error = err as Error;
            return JSON.stringify({ error: 'Order failed', details: error.message });
          }
        }

        // Fallback: Check for credentials
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No trading service configured. Set up trading credentials in config.',
          });
        }

        // No execution service and no Python fallback available
        return JSON.stringify({
          error: 'Trading execution not available. Configure trading.enabled=true in config with Polymarket credentials.',
        });
      }

      case 'polymarket_sell': {
        const tokenId = toolInput.token_id as string;
        const size = toolInput.size as number;
        const price = (toolInput.price as number) || 0.01;

        // Use TypeScript execution service if available
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const result = await execSvc.sellLimit({
              platform: 'polymarket',
              marketId: tokenId,
              tokenId,
              price,
              size,
              orderType: 'GTC',
            });

            if (result.success) {
              await context.credentials.markSuccess(userId, 'polymarket');
              return JSON.stringify({
                result: 'Sell order placed',
                orderId: result.orderId,
                filledSize: result.filledSize,
                avgFillPrice: result.avgFillPrice,
                status: result.status,
              });
            } else {
              return JSON.stringify({ error: 'Sell failed', details: result.error });
            }
          } catch (err: unknown) {
            const error = err as Error;
            return JSON.stringify({ error: 'Order failed', details: error.message });
          }
        }

        // Fallback: Check for credentials
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No trading service configured. Set up trading credentials in config.',
          });
        }

        return JSON.stringify({
          error: 'Trading execution not available. Configure trading.enabled=true in config with Polymarket credentials.',
        });
      }

      case 'polymarket_positions': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }
        const creds = polyCreds.data as PolymarketCredentials;
        const auth = getPolymarketApiKeyAuth(creds);
        if (!auth) {
          return JSON.stringify({ error: 'Incomplete Polymarket credentials.' });
        }
        try {
          const { getPolymarketPositions } = await import('../execution');
          const positions = await getPolymarketPositions(auth);
          if (positions.length === 0) {
            return JSON.stringify({ result: 'No open positions.' });
          }
          // Enrich each position with live CLOB prices for accurate tracking/selling
          const enriched = await Promise.all(positions.map(async (p) => {
            try {
              const [buyRes, sellRes, midRes] = await Promise.all([
                fetch(`https://clob.polymarket.com/price?token_id=${p.tokenId}&side=BUY`),
                fetch(`https://clob.polymarket.com/price?token_id=${p.tokenId}&side=SELL`),
                fetch(`https://clob.polymarket.com/midpoint?token_id=${p.tokenId}`),
              ]);
              const buy = await buyRes.json() as { price?: string };
              const sell = await sellRes.json() as { price?: string };
              const mid = await midRes.json() as { mid?: string };
              const liveSellPrice = parseFloat(sell.price || '0');
              const liveValue = liveSellPrice * p.size;
              const cost = p.avgPrice * p.size;
              return {
                ...p,
                liveBuyPrice: buy.price || null,
                liveSellPrice: sell.price || null,
                liveMidpoint: mid.mid || null,
                liveValue: Math.round(liveValue * 100) / 100,
                livePnl: Math.round((liveValue - cost) * 100) / 100,
              };
            } catch {
              return p;
            }
          }));
          return JSON.stringify({ positions: enriched, count: enriched.length });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Failed to get positions', details: error.message });
        }
      }

      case 'polymarket_cancel_all': {
        // Use TypeScript execution service if available
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const cancelledCount = await execSvc.cancelAllOrders('polymarket');
            return JSON.stringify({ result: 'All orders cancelled', cancelledCount });
          } catch (err: unknown) {
            const error = err as Error;
            return JSON.stringify({ error: 'Cancel failed', details: error.message });
          }
        }

        // Fallback: Check for credentials
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No trading service configured. Set up trading credentials in config.',
          });
        }

        return JSON.stringify({
          error: 'Trading execution not available. Configure trading.enabled=true in config with Polymarket credentials.',
        });
      }

      case 'polymarket_orderbook': {
        // Orderbook is public - no credentials required
        const tokenId = toolInput.token_id as string;
        try {
          // Fetch raw book AND proper pricing endpoints in parallel
          const [bookRes, buyPriceRes, sellPriceRes, midRes, spreadRes, lastRes] = await Promise.all([
            fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`),
            fetch(`https://clob.polymarket.com/price?token_id=${tokenId}&side=BUY`),
            fetch(`https://clob.polymarket.com/price?token_id=${tokenId}&side=SELL`),
            fetch(`https://clob.polymarket.com/midpoint?token_id=${tokenId}`),
            fetch(`https://clob.polymarket.com/spread?token_id=${tokenId}`),
            fetch(`https://clob.polymarket.com/last-trade-price?token_id=${tokenId}`),
          ]);
          const data = await bookRes.json() as { bids?: Array<{ price: string; size: string }>; asks?: Array<{ price: string; size: string }> };
          const buyPrice = await buyPriceRes.json() as { price?: string };
          const sellPrice = await sellPriceRes.json() as { price?: string };
          const mid = await midRes.json() as { mid?: string };
          const spread = await spreadRes.json() as { spread?: string };
          const last = await lastRes.json() as { price?: string; side?: string };
          const bids = (data.bids || []).slice(0, 10);
          const asks = (data.asks || []).slice(0, 10);
          return JSON.stringify({
            token_id: tokenId,
            // Tradeable prices from official CLOB endpoints — use these, not raw book extremes
            buyPrice: buyPrice.price || null,
            sellPrice: sellPrice.price || null,
            midpoint: mid.mid || null,
            spread: spread.spread || null,
            lastTradePrice: last.price || null,
            lastTradeSide: last.side || null,
            // Raw book depth (may show AMM extremes at 1¢/99¢ — ignore those, use prices above)
            bids, asks, bid_count: bids.length, ask_count: asks.length,
          });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Orderbook fetch failed', details: error.message });
        }
      }

      case 'polymarket_balance': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }
        const creds = polyCreds.data as PolymarketCredentials;
        const auth = getPolymarketApiKeyAuth(creds);
        if (!auth) {
          return JSON.stringify({ error: 'Incomplete Polymarket credentials.' });
        }
        try {
          const { getPolymarketBalance } = await import('../execution');
          const { balance, allowance } = await getPolymarketBalance(auth);
          return JSON.stringify({
            balance: `$${balance.toFixed(2)} USDC`,
            allowance: `$${allowance.toFixed(2)} USDC`,
            raw: { balance, allowance },
          });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Balance fetch failed', details: error.message });
        }
      }

      case 'polymarket_cancel': {
        const orderId = toolInput.order_id as string;

        // Use TypeScript execution service if available
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const success = await execSvc.cancelOrder('polymarket', orderId);
            if (success) {
              return JSON.stringify({ result: 'Order cancelled', orderId });
            } else {
              return JSON.stringify({ error: 'Cancel failed', details: 'Order not found or already filled' });
            }
          } catch (err: unknown) {
            const error = err as Error;
            return JSON.stringify({ error: 'Cancel failed', details: error.message });
          }
        }

        // Fallback: Check for credentials
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No trading service configured. Set up trading credentials in config.',
          });
        }

        return JSON.stringify({
          error: 'Trading execution not available. Configure trading.enabled=true in config with Polymarket credentials.',
        });
      }

      case 'polymarket_orders': {
        // Use TypeScript execution service if available
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const orders = await execSvc.getOpenOrders('polymarket');
            return JSON.stringify({
              result: orders.map(o => ({
                orderId: o.orderId,
                marketId: o.marketId,
                tokenId: o.tokenId,
                side: o.side,
                price: o.price,
                originalSize: o.originalSize,
                remainingSize: o.remainingSize,
                filledSize: o.filledSize,
                status: o.status,
                createdAt: o.createdAt,
              })),
            });
          } catch (err: unknown) {
            const error = err as Error;
            return JSON.stringify({ error: 'Orders fetch failed', details: error.message });
          }
        }

        // Fallback: Check for credentials
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No trading service configured. Set up trading credentials in config.',
          });
        }

        return JSON.stringify({
          error: 'Trading execution not available. Configure trading.enabled=true in config with Polymarket credentials.',
        });
      }

      case 'polymarket_market_sell': {
        const tokenId = toolInput.token_id as string;
        const size = toolInput.size as number;

        // Use TypeScript execution service if available
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const result = await execSvc.marketSell({
              platform: 'polymarket',
              marketId: tokenId,
              tokenId,
              size,
            });

            if (result.success) {
              await context.credentials.markSuccess(userId, 'polymarket');
              return JSON.stringify({
                result: 'Market sell executed',
                orderId: result.orderId,
                filledSize: result.filledSize,
                avgFillPrice: result.avgFillPrice,
                status: result.status,
              });
            } else {
              return JSON.stringify({ error: 'Market sell failed', details: result.error });
            }
          } catch (err: unknown) {
            const error = err as Error;
            return JSON.stringify({ error: 'Market sell failed', details: error.message });
          }
        }

        // Fallback: Check for credentials
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No trading service configured. Set up trading credentials in config.',
          });
        }

        return JSON.stringify({
          error: 'Trading execution not available. Configure trading.enabled=true in config with Polymarket credentials.',
        });
      }

      case 'polymarket_market_buy': {
        const tokenId = toolInput.token_id as string;
        const amount = toolInput.amount as number;
        const maxError = enforceMaxOrderSize(context, amount, 'polymarket_market_buy');
        if (maxError) return maxError;
        const exposureError = enforceExposureLimits(context, userId, {
          platform: 'polymarket',
          outcomeId: tokenId,
          notional: amount,
          label: 'polymarket_market_buy',
        });
        if (exposureError) return exposureError;

        // Use TypeScript execution service if available
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const result = await execSvc.marketBuy({
              platform: 'polymarket',
              marketId: tokenId,
              tokenId,
              size: amount,
            });

            if (result.success) {
              await context.credentials.markSuccess(userId, 'polymarket');
              return JSON.stringify({
                result: 'Market buy executed',
                orderId: result.orderId,
                filledSize: result.filledSize,
                avgFillPrice: result.avgFillPrice,
                status: result.status,
              });
            } else {
              return JSON.stringify({ error: 'Market buy failed', details: result.error });
            }
          } catch (err: unknown) {
            const error = err as Error;
            return JSON.stringify({ error: 'Market buy failed', details: error.message });
          }
        }

        // Fallback: Check for credentials
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No trading service configured. Set up trading credentials in config.',
          });
        }

        return JSON.stringify({
          error: 'Trading execution not available. Configure trading.enabled=true in config with Polymarket credentials.',
        });
      }

      case 'polymarket_maker_buy': {
        const tokenId = toolInput.token_id as string;
        const price = toolInput.price as number;
        const size = toolInput.size as number;
        const notional = price * size;
        const maxError = enforceMaxOrderSize(context, notional, 'polymarket_maker_buy');
        if (maxError) return maxError;
        const exposureError = enforceExposureLimits(context, userId, {
          platform: 'polymarket',
          outcomeId: tokenId,
          notional,
          label: 'polymarket_maker_buy',
        });
        if (exposureError) return exposureError;

        // Use TypeScript execution service if available
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const result = await execSvc.makerBuy({
              platform: 'polymarket',
              marketId: tokenId,
              tokenId,
              price,
              size,
            });

            if (result.success) {
              await context.credentials.markSuccess(userId, 'polymarket');
              return JSON.stringify({
                result: 'Maker buy order placed (postOnly)',
                orderId: result.orderId,
                filledSize: result.filledSize,
                avgFillPrice: result.avgFillPrice,
                status: result.status,
              });
            } else {
              return JSON.stringify({ error: 'Maker buy failed', details: result.error });
            }
          } catch (err: unknown) {
            const error = err as Error;
            return JSON.stringify({ error: 'Maker buy failed', details: error.message });
          }
        }

        // Fallback: Check for credentials
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No trading service configured. Set up trading credentials in config.',
          });
        }

        return JSON.stringify({
          error: 'Trading execution not available. Configure trading.enabled=true in config with Polymarket credentials.',
        });
      }

      case 'polymarket_maker_sell': {
        const tokenId = toolInput.token_id as string;
        const price = toolInput.price as number;
        const size = toolInput.size as number;

        // Use TypeScript execution service if available
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const result = await execSvc.makerSell({
              platform: 'polymarket',
              marketId: tokenId,
              tokenId,
              price,
              size,
            });

            if (result.success) {
              await context.credentials.markSuccess(userId, 'polymarket');
              return JSON.stringify({
                result: 'Maker sell order placed (postOnly)',
                orderId: result.orderId,
                filledSize: result.filledSize,
                avgFillPrice: result.avgFillPrice,
                status: result.status,
              });
            } else {
              return JSON.stringify({ error: 'Maker sell failed', details: result.error });
            }
          } catch (err: unknown) {
            const error = err as Error;
            return JSON.stringify({ error: 'Maker sell failed', details: error.message });
          }
        }

        // Fallback: Check for credentials
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No trading service configured. Set up trading credentials in config.',
          });
        }

        return JSON.stringify({
          error: 'Trading execution not available. Configure trading.enabled=true in config with Polymarket credentials.',
        });
      }

      case 'polymarket_fee_rate': {
        // Fee rate is a public endpoint, no credentials needed
        const tokenId = toolInput.token_id as string;

        try {
          const response = await fetchPolymarketClob(context, `https://clob.polymarket.com/fee-rate?token_id=${tokenId}`);
          if (!response.ok) {
            return JSON.stringify({ error: `Failed to get fee rate: ${response.status}` });
          }
          const data = await response.json() as { fee_rate_bps?: number; base_fee?: number };
          const feeRateBps = data.fee_rate_bps || data.base_fee || 0;
          const hasFeesMessage = feeRateBps > 0
            ? `This market has FEES. Taker fee: ~${(feeRateBps / 100).toFixed(1)}% base rate. Use maker_buy/maker_sell to avoid fees.`
            : 'This market has NO FEES. Regular buy/sell is fine.';

          return JSON.stringify({
            token_id: tokenId,
            fee_rate_bps: feeRateBps,
            has_fees: feeRateBps > 0,
            message: hasFeesMessage,
          });
        } catch (err: unknown) {
          const error = err as { message?: string };
          return JSON.stringify({ error: 'Fee rate check failed', details: error.message });
        }
      }

      case 'polymarket_midpoint': {
        // Public endpoint - no credentials needed
        const tokenId = toolInput.token_id as string;

        try {
          const response = await fetchPolymarketClob(context, `https://clob.polymarket.com/midpoint?token_id=${tokenId}`);
          if (!response.ok) {
            return JSON.stringify({ error: `Failed to get midpoint: ${response.status}` });
          }
          const data = await response.json() as { mid?: string };
          return JSON.stringify({
            token_id: tokenId,
            midpoint: data.mid,
            message: `Current midpoint price: ${(parseFloat(data.mid || '0') * 100).toFixed(1)}¢`,
          });
        } catch (err: unknown) {
          const error = err as { message?: string };
          return JSON.stringify({ error: 'Midpoint fetch failed', details: error.message });
        }
      }

      case 'polymarket_spread': {
        // Public endpoint - no credentials needed
        const tokenId = toolInput.token_id as string;

        try {
          const response = await fetchPolymarketClob(context, `https://clob.polymarket.com/spread?token_id=${tokenId}`);
          if (!response.ok) {
            return JSON.stringify({ error: `Failed to get spread: ${response.status}` });
          }
          const data = await response.json() as { spread?: string };
          return JSON.stringify({
            token_id: tokenId,
            spread: data.spread,
            spread_pct: (parseFloat(data.spread || '0') * 100).toFixed(2) + '%',
            message: `Bid-ask spread: ${(parseFloat(data.spread || '0') * 100).toFixed(2)}%`,
          });
        } catch (err: unknown) {
          const error = err as { message?: string };
          return JSON.stringify({ error: 'Spread fetch failed', details: error.message });
        }
      }

      case 'polymarket_last_trade': {
        // Public endpoint - no credentials needed
        const tokenId = toolInput.token_id as string;

        try {
          const response = await fetchPolymarketClob(context, `https://clob.polymarket.com/last-trade-price?token_id=${tokenId}`);
          if (!response.ok) {
            return JSON.stringify({ error: `Failed to get last trade: ${response.status}` });
          }
          const data = await response.json() as { price?: string };
          return JSON.stringify({
            token_id: tokenId,
            last_trade_price: data.price,
            message: `Last trade: ${(parseFloat(data.price || '0') * 100).toFixed(1)}¢`,
          });
        } catch (err: unknown) {
          const error = err as { message?: string };
          return JSON.stringify({ error: 'Last trade fetch failed', details: error.message });
        }
      }

      case 'polymarket_tick_size': {
        // Public endpoint - no credentials needed
        const tokenId = toolInput.token_id as string;

        try {
          const response = await fetchPolymarketClob(context, `https://clob.polymarket.com/tick-size?token_id=${tokenId}`);
          if (!response.ok) {
            return JSON.stringify({ error: `Failed to get tick size: ${response.status}` });
          }
          const data = await response.json() as ApiResponse;
          return JSON.stringify({
            token_id: tokenId,
            tick_size: data.minimum_tick_size,
            message: `Minimum price increment: ${data.minimum_tick_size}`,
          });
        } catch (err: unknown) {
          const error = err as { message?: string };
          return JSON.stringify({ error: 'Tick size fetch failed', details: error.message });
        }
      }

      case 'polymarket_trades': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }
        const creds = polyCreds.data as PolymarketCredentials;
        const auth = getPolymarketApiKeyAuth(creds);
        if (!auth) {
          return JSON.stringify({ error: 'Incomplete Polymarket credentials.' });
        }
        try {
          const { getPolymarketTrades } = await import('../execution');
          const trades = await getPolymarketTrades(auth);
          await context.credentials.markSuccess(userId, 'polymarket');
          if (trades.length === 0) {
            return JSON.stringify({ result: 'No recent trades.' });
          }
          return JSON.stringify({ trades: trades.slice(0, 50), count: trades.length });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Trade history failed', details: error.message });
        }
      }

      case 'polymarket_cancel_market': {
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const marketId = toolInput.market_id as string;
            const cancelledCount = await execSvc.cancelAllOrders('polymarket', marketId);
            await context.credentials.markSuccess(userId, 'polymarket');
            return JSON.stringify({ result: 'Orders cancelled for market', cancelledCount });
          } catch (err: unknown) {
            const error = err as Error;
            return JSON.stringify({ error: 'Cancel market orders failed', details: error.message });
          }
        }
        return JSON.stringify({ error: 'Trading execution not available. Configure trading.enabled=true.' });
      }

      case 'polymarket_estimate_fill': {
        // Estimate fill by fetching orderbook and calculating slippage
        const tokenId = toolInput.token_id as string;
        const side = (toolInput.side as string).toUpperCase();
        const amount = toolInput.amount as number;
        try {
          const response = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`);
          if (!response.ok) {
            return JSON.stringify({ error: `Orderbook fetch failed: ${response.status}` });
          }
          const book = await response.json() as { bids?: Array<{ price: string; size: string }>; asks?: Array<{ price: string; size: string }> };
          const levels = side === 'BUY' ? (book.asks || []) : (book.bids || []);
          let remaining = amount;
          let totalCost = 0;
          const fills: Array<{ price: string; size: number }> = [];
          for (const level of levels) {
            if (remaining <= 0) break;
            const levelSize = parseFloat(level.size);
            const levelPrice = parseFloat(level.price);
            const fillSize = Math.min(remaining, levelSize);
            totalCost += fillSize * levelPrice;
            fills.push({ price: level.price, size: fillSize });
            remaining -= fillSize;
          }
          const avgPrice = amount > 0 ? totalCost / (amount - remaining) : 0;
          return JSON.stringify({
            token_id: tokenId,
            side,
            requested: amount,
            filled: amount - remaining,
            unfilled: remaining,
            avg_price: avgPrice.toFixed(4),
            total_cost: totalCost.toFixed(2),
            fills,
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: 'Fill estimate failed', details: (err as Error).message });
        }
      }

      case 'polymarket_market_info': {
        // Public endpoint - no credentials needed
        const conditionId = toolInput.condition_id as string;

        try {
          const response = await fetch(`https://gamma-api.polymarket.com/markets/${conditionId}`);
          if (!response.ok) {
            return JSON.stringify({ error: `Failed to get market info: ${response.status}` });
          }
          const data = await response.json() as {
            condition_id?: string;
            question?: string;
            description?: string;
            volume?: number;
            liquidity?: number;
            active?: boolean;
            closed?: boolean;
            end_date_iso?: string;
            tokens?: Array<{ token_id: string; outcome: string; price: number }>;
          };
          return JSON.stringify({
            condition_id: data.condition_id,
            question: data.question,
            description: data.description?.slice(0, 500),
            volume: data.volume,
            liquidity: data.liquidity,
            active: data.active,
            closed: data.closed,
            end_date: data.end_date_iso,
            outcomes: data.tokens?.map((t) => ({
              token_id: t.token_id,
              outcome: t.outcome,
              price: t.price,
            })),
          });
        } catch (err: unknown) {
          const error = err as { message?: string };
          return JSON.stringify({ error: 'Market info fetch failed', details: error.message });
        }
      }

      case 'orderbook_imbalance': {
        // Import dynamically to avoid circular dependency issues
        const { getOrderbookImbalance } = await import('../execution');

        const platform = toolInput.platform as 'polymarket' | 'kalshi';
        const marketId = toolInput.market_id as string;
        const depthLevels = (toolInput.depth_levels as number) || 5;

        try {
          const imbalance = await getOrderbookImbalance(platform, marketId, depthLevels);

          if (!imbalance) {
            return JSON.stringify({
              error: 'Could not fetch orderbook',
              hint: 'Check that the market/token ID is correct and the market is active',
            });
          }

          // Format for user-friendly output
          const signalEmoji = imbalance.signal === 'bullish' ? '🟢' :
                             imbalance.signal === 'bearish' ? '🔴' : '⚪';

          const timingEmoji = imbalance.imbalanceScore > 0.15 ? '⚡ Execute now - strong buy pressure' :
                              imbalance.imbalanceScore < -0.15 ? '⏳ Wait - sell pressure detected' :
                              '👀 Monitor - balanced orderbook';

          return JSON.stringify({
            signal: `${signalEmoji} ${imbalance.signal.toUpperCase()}`,
            imbalance_score: Math.round(imbalance.imbalanceScore * 100) / 100,
            bid_ask_ratio: Math.round(imbalance.bidAskRatio * 100) / 100,
            best_bid: imbalance.bestBid,
            best_ask: imbalance.bestAsk,
            mid_price: imbalance.midPrice,
            spread: `${(imbalance.spreadPct * 100).toFixed(2)}%`,
            total_bid_volume: Math.round(imbalance.totalBidVolume),
            total_ask_volume: Math.round(imbalance.totalAskVolume),
            confidence: `${(imbalance.confidence * 100).toFixed(1)}%`,
            timing: timingEmoji,
            interpretation: imbalance.signal === 'bullish'
              ? 'More buying pressure - price may rise. Favorable for BUY orders.'
              : imbalance.signal === 'bearish'
              ? 'More selling pressure - price may fall. Favorable for SELL orders.'
              : 'Balanced orderbook - no strong directional bias.',
          });
        } catch (err: unknown) {
          const error = err as { message?: string };
          return JSON.stringify({ error: 'Imbalance analysis failed', details: error.message });
        }
      }

      // ========== HEALTH & CONFIG HANDLERS ==========
      case 'polymarket_health': {
        try {
          const response = await fetchPolymarketClob(context, 'https://clob.polymarket.com/');
          return JSON.stringify({ ok: response.ok, status: response.status });
        } catch (err: unknown) {
          return JSON.stringify({ ok: false, error: (err as Error).message });
        }
      }

      case 'polymarket_server_time': {
        try {
          const response = await fetchPolymarketClob(context, 'https://clob.polymarket.com/time');
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_get_address': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        return JSON.stringify({ address: (polyCreds.data as PolymarketCredentials).funderAddress });
      }

      case 'polymarket_collateral_address': {
        return JSON.stringify({ address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', name: 'USDC on Polygon' });
      }

      case 'polymarket_conditional_address': {
        return JSON.stringify({ address: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045', name: 'CTF (Conditional Token Framework)' });
      }

      case 'polymarket_exchange_address': {
        const negRisk = toolInput.neg_risk as boolean;
        if (negRisk) {
          return JSON.stringify({ address: '0xC5d563A36AE78145C45a50134d48A1215220f80a', name: 'Neg Risk Exchange (crypto markets)' });
        }
        return JSON.stringify({ address: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E', name: 'Regular Exchange' });
      }

      // ========== ADDITIONAL MARKET DATA HANDLERS ==========
      case 'polymarket_price': {
        const tokenId = toolInput.token_id as string;
        const side = toolInput.side as string;
        try {
          const response = await fetchPolymarketClob(context, `https://clob.polymarket.com/price?token_id=${tokenId}&side=${side}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify({ token_id: tokenId, side, price: data.price });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_neg_risk': {
        const tokenId = toolInput.token_id as string;
        try {
          const response = await fetchPolymarketClob(context, `https://clob.polymarket.com/neg-risk?token_id=${tokenId}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify({ token_id: tokenId, neg_risk: data.neg_risk });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ========== BATCH HANDLERS ==========
      case 'polymarket_midpoints_batch': {
        const tokenIds = toolInput.token_ids as string[];
        try {
          const results = await Promise.all(tokenIds.map(async (id) => {
            const r = await fetch(`https://clob.polymarket.com/midpoint?token_id=${id}`);
            const d = await r.json() as { mid?: string };
            return { token_id: id, mid: d.mid };
          }));
          return JSON.stringify(results);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_prices_batch': {
        const requests = toolInput.requests as Array<{ token_id: string; side: string }>;
        try {
          const results = await Promise.all(requests.map(async (req) => {
            const r = await fetch(`https://clob.polymarket.com/price?token_id=${req.token_id}&side=${req.side}`);
            const d = await r.json() as { price?: string };
            return { token_id: req.token_id, side: req.side, price: d.price };
          }));
          return JSON.stringify(results);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_spreads_batch': {
        const tokenIds = toolInput.token_ids as string[];
        try {
          const results = await Promise.all(tokenIds.map(async (id) => {
            const r = await fetch(`https://clob.polymarket.com/spread?token_id=${id}`);
            const d = await r.json() as { spread?: string };
            return { token_id: id, spread: d.spread };
          }));
          return JSON.stringify(results);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_orderbooks_batch': {
        const tokenIds = toolInput.token_ids as string[];
        try {
          const results = await Promise.all(tokenIds.map(async (id) => {
            const r = await fetch(`https://clob.polymarket.com/book?token_id=${id}`);
            const d = await r.json() as { bids?: Array<{ price: string; size: string }>; asks?: Array<{ price: string; size: string }> };
            return { token_id: id, bids: (d.bids || []).slice(0, 5), asks: (d.asks || []).slice(0, 5) };
          }));
          return JSON.stringify(results);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_last_trades_batch': {
        const tokenIds = toolInput.token_ids as string[];
        try {
          const results = await Promise.all(tokenIds.map(async (id) => {
            const r = await fetch(`https://clob.polymarket.com/last-trade-price?token_id=${id}`);
            const d = await r.json() as { price?: string };
            return { token_id: id, price: d.price };
          }));
          return JSON.stringify(results);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ========== MARKET DISCOVERY HANDLERS ==========
      case 'polymarket_markets': {
        const nextCursor = toolInput.next_cursor as string | undefined;
        const limit = Math.min((toolInput.limit as number) || 25, 100);
        try {
          const url = nextCursor
            ? `https://clob.polymarket.com/markets?next_cursor=${nextCursor}`
            : 'https://clob.polymarket.com/markets';
          const response = await fetch(url);
          const data = await response.json() as { data?: Array<Record<string, unknown>>; next_cursor?: string; count?: number };
          const allItems = data.data || [];
          const markets = allItems.slice(0, limit).map((m: Record<string, unknown>) => ({
            condition_id: m.condition_id,
            question: m.question,
            description: typeof m.description === 'string' ? m.description.slice(0, 200) : undefined,
            tokens: (m.tokens as Array<{ outcome: string; price: number }> || []).map(t => ({
              outcome: t.outcome,
              price: t.price,
            })),
            active: m.active,
            end_date: m.end_date_iso,
            slug: m.market_slug,
          }));
          return JSON.stringify({ markets, showing: markets.length, total: allItems.length, next_cursor: data.next_cursor });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_simplified_markets': {
        const nextCursor = toolInput.next_cursor as string | undefined;
        const limit = Math.min((toolInput.limit as number) || 25, 100);
        try {
          const url = nextCursor
            ? `https://clob.polymarket.com/simplified-markets?next_cursor=${nextCursor}`
            : 'https://clob.polymarket.com/simplified-markets';
          const response = await fetch(url);
          const data = await response.json() as { data?: Array<Record<string, unknown>>; next_cursor?: string; count?: number };
          const allItems = data.data || [];
          const markets = allItems.slice(0, limit).map((m: Record<string, unknown>) => ({
            condition_id: m.condition_id,
            question: m.question,
            tokens: (m.tokens as Array<{ outcome: string; price: number }> || []).map(t => ({
              outcome: t.outcome,
              price: t.price,
            })),
            active: m.active,
            end_date: m.end_date_iso,
            slug: m.market_slug,
          }));
          return JSON.stringify({ markets, showing: markets.length, total: allItems.length, next_cursor: data.next_cursor });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_sampling_markets': {
        const nextCursor = toolInput.next_cursor as string | undefined;
        const limit = Math.min((toolInput.limit as number) || 25, 100);
        try {
          const url = nextCursor
            ? `https://clob.polymarket.com/sampling-markets?next_cursor=${nextCursor}`
            : 'https://clob.polymarket.com/sampling-markets';
          const response = await fetch(url);
          const data = await response.json() as { data?: Array<Record<string, unknown>>; next_cursor?: string; count?: number };
          const allItems = data.data || [];
          const markets = allItems.slice(0, limit).map((m: Record<string, unknown>) => ({
            condition_id: m.condition_id,
            question: m.question,
            tokens: (m.tokens as Array<{ outcome: string; price: number }> || []).map(t => ({
              outcome: t.outcome,
              price: t.price,
            })),
            active: m.active,
            end_date: m.end_date_iso,
            slug: m.market_slug,
          }));
          return JSON.stringify({ markets, showing: markets.length, total: allItems.length, next_cursor: data.next_cursor });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_market_trades_events': {
        const conditionId = toolInput.condition_id as string;
        try {
          const response = await fetchPolymarketClob(context, `https://clob.polymarket.com/markets/${conditionId}/trades`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ========== ORDER OPERATIONS HANDLERS ==========
      case 'polymarket_get_order': {
        try {
          const orderId = toolInput.order_id as string;
          const url = `https://clob.polymarket.com/order/${orderId}`;
          const response = await fetchPolymarketClob(context, url);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_post_orders_batch': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const orders = toolInput.orders as Array<{ token_id: string; price: number; size: number; side: string }>;
        if (Array.isArray(orders) && orders.length > 0) {
          let total = 0;
          const perToken = new Map<string, number>();
          for (const order of orders) {
            if (!order) continue;
            const side = String(order.side || '').toUpperCase();
            if (side && side !== 'BUY') continue;
            const price = Number(order.price);
            const size = Number(order.size);
            if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
            const notional = price * size;
            total += notional;
            perToken.set(order.token_id, (perToken.get(order.token_id) || 0) + notional);
          }
          const maxError = enforceMaxOrderSize(context, total, 'polymarket_post_orders_batch');
          if (maxError) return maxError;
          for (const [tokenId, notional] of perToken) {
            const exposureError = enforceExposureLimits(context, userId, {
              platform: 'polymarket',
              outcomeId: tokenId,
              notional,
              label: 'polymarket_post_orders_batch',
            });
            if (exposureError) return exposureError;
          }
        }
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const results = [];
            for (const order of orders) {
              const side = String(order.side || '').toUpperCase() as 'BUY' | 'SELL';
              const result = side === 'BUY'
                ? await execSvc.buyLimit({ platform: 'polymarket', marketId: order.token_id, tokenId: order.token_id, price: order.price, size: order.size })
                : await execSvc.sellLimit({ platform: 'polymarket', marketId: order.token_id, tokenId: order.token_id, price: order.price, size: order.size });
              results.push(result);
            }
            await context.credentials.markSuccess(userId, 'polymarket');
            return JSON.stringify({ results });
          } catch (err: unknown) {
            return JSON.stringify({ error: (err as Error).message });
          }
        }
        return JSON.stringify({ error: 'Trading execution not available.' });
      }

      case 'polymarket_cancel_orders_batch': {
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const orderIds = toolInput.order_ids as string[];
            const results: Array<{ orderId: string; success: boolean }> = [];
            for (const oid of orderIds) {
              const success = await execSvc.cancelOrder('polymarket', oid);
              results.push({ orderId: oid, success });
            }
            await context.credentials.markSuccess(userId, 'polymarket');
            return JSON.stringify({ result: 'Orders cancelled', cancelled: results });
          } catch (err: unknown) {
            return JSON.stringify({ error: (err as Error).message });
          }
        }
        return JSON.stringify({ error: 'Trading execution not available.' });
      }

      // ========== API KEY MANAGEMENT HANDLERS ==========
      case 'polymarket_create_api_key':
      case 'polymarket_derive_api_key': {
        // These require L1 wallet signing which needs the private key signer — not available via REST alone
        return JSON.stringify({ error: 'API key creation requires wallet signing. Use the Polymarket web interface or CLI.' });
      }

      case 'polymarket_get_api_keys': {
        try {
          const response = await fetchPolymarketClob(context, 'https://clob.polymarket.com/api-keys');
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_delete_api_key': {
        try {
          const response = await fetchPolymarketClob(context, 'https://clob.polymarket.com/api-key', { method: 'DELETE' });
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ========== READ-ONLY API KEY HANDLERS ==========
      case 'polymarket_create_readonly_api_key': {
        try {
          const response = await fetchPolymarketClob(context, 'https://clob.polymarket.com/readonly-api-key', { method: 'POST' });
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_get_readonly_api_keys': {
        try {
          const response = await fetchPolymarketClob(context, 'https://clob.polymarket.com/readonly-api-keys');
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_delete_readonly_api_key': {
        const apiKey = toolInput.api_key as string;
        try {
          const response = await fetchPolymarketClob(context, `https://clob.polymarket.com/readonly-api-key/${encodeURIComponent(apiKey)}`, { method: 'DELETE' });
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_validate_readonly_api_key': {
        const apiKey = toolInput.api_key as string;
        try {
          const response = await fetch(`https://clob.polymarket.com/readonly-api-key/validate/${encodeURIComponent(apiKey)}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ========== BALANCE & ALLOWANCE HANDLERS ==========
      case 'polymarket_get_balance_allowance': {
        const assetType = toolInput.asset_type as string;
        const tokenId = toolInput.token_id as string | undefined;
        try {
          let url = `https://clob.polymarket.com/balance-allowance?asset_type=${assetType}`;
          if (tokenId) url += `&token_id=${tokenId}`;
          const response = await fetchPolymarketClob(context, url);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }
      case 'polymarket_update_balance_allowance': {
        const assetType = toolInput.asset_type as string;
        const tokenId = toolInput.token_id as string | undefined;
        try {
          const body: Record<string, string> = { asset_type: assetType };
          if (tokenId) body.token_id = tokenId;
          const response = await fetchPolymarketClob(context, 'https://clob.polymarket.com/balance-allowance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ========== ADVANCED FEATURES HANDLERS ==========
      case 'polymarket_heartbeat': {
        try {
          const url = 'https://clob.polymarket.com/heartbeat';
          const response = await fetchPolymarketClob(context, url);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_is_order_scoring': {
        const orderId = toolInput.order_id as string;
        try {
          const response = await fetchPolymarketClob(context, `https://clob.polymarket.com/order-scoring?order_id=${orderId}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_are_orders_scoring': {
        const orderIds = toolInput.order_ids as string[];
        try {
          const response = await fetchPolymarketClob(context, `https://clob.polymarket.com/orders-scoring?order_ids=${orderIds.join(',')}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_notifications': {
        try {
          const response = await fetchPolymarketClob(context, 'https://clob.polymarket.com/notifications');
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_drop_notifications': {
        const notificationIds = toolInput.notification_ids as string[];
        try {
          const response = await fetchPolymarketClob(context, 'https://clob.polymarket.com/notifications', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: notificationIds }),
          });
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_closed_only_mode': {
        try {
          const response = await fetchPolymarketClob(context, 'https://clob.polymarket.com/closed-only');
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_orderbook_hash': {
        const tokenId = toolInput.token_id as string;
        try {
          const response = await fetch(`https://clob.polymarket.com/hash?token_id=${tokenId}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_sampling_simplified_markets': {
        const nextCursor = toolInput.next_cursor as string | undefined;
        try {
          const url = nextCursor
            ? `https://clob.polymarket.com/sampling-simplified-markets?next_cursor=${nextCursor}`
            : 'https://clob.polymarket.com/sampling-simplified-markets';
          const response = await fetch(url);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // POLYMARKET GAMMA API - Events & Markets
      // ============================================

      case 'polymarket_event': {
        const eventId = toolInput.event_id as string;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/events/${encodeURIComponent(eventId)}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_event_by_slug': {
        const slug = toolInput.slug as string;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_events': {
        const limit = (toolInput.limit as number) || 20;
        const offset = (toolInput.offset as number) || 0;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/events?_limit=${limit}&_offset=${offset}&active=true&closed=false`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_search_events': {
        const query = toolInput.query as string;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/events?_q=${encodeURIComponent(query)}&_limit=20&active=true`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_crypto_markets': {
        const coin = ((toolInput.coin as string) || 'ALL').toUpperCase();
        const timeframe = ((toolInput.timeframe as string) || 'ALL').toLowerCase();
        const coins = coin === 'ALL' ? ['BTC', 'ETH', 'SOL', 'XRP'] : [coin];
        const timeframes = timeframe === 'all' ? ['15m', '1h', 'daily'] : [timeframe];

        const COIN_NAMES: Record<string, string> = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'xrp' };
        const GAMMA = 'https://gamma-api.polymarket.com';
        const CLOB = 'https://clob.polymarket.com';

        const results: Array<Record<string, unknown>> = [];

        for (const c of coins) {
          const coinName = COIN_NAMES[c] || c.toLowerCase();
          for (const tf of timeframes) {
            try {
              let slug = '';
              if (tf === '15m') {
                // 15-min: {coin}-updown-15m-{unix_ts} where ts = floor(now/900)*900
                const now = Math.floor(Date.now() / 1000);
                const windowStart = Math.floor(now / 900) * 900;
                // Try current window, then next
                for (const offset of [0, 900]) {
                  slug = `${c.toLowerCase()}-updown-15m-${windowStart + offset}`;
                  const res = await fetch(`${GAMMA}/events?slug=${slug}`);
                  const events = await res.json() as Array<Record<string, unknown>>;
                  if (Array.isArray(events) && events.length > 0) {
                    const ev = events[0];
                    // Skip resolved/closed markets
                    if (ev.closed === true || ev.active === false) continue;
                    const mkts = ev.markets as Array<Record<string, unknown>> | undefined;
                    if (mkts && mkts.length > 0) {
                      const m = mkts[0];
                      if (m.closed === true || m.active === false) continue;
                      // Parse tokens
                      const tokenIds = JSON.parse((m.clobTokenIds as string) || '[]') as string[];
                      const outcomes = JSON.parse((m.outcomes as string) || '[]') as string[];
                      const prices = JSON.parse((m.outcomePrices as string) || '[]') as string[];
                      const tokens: Record<string, unknown> = {};
                      for (let i = 0; i < outcomes.length; i++) {
                        tokens[outcomes[i]] = { tokenId: tokenIds[i], price: prices[i] };
                      }
                      // Use official CLOB /price, /midpoint, /spread endpoints for real tradeable prices
                      const pricing: Record<string, unknown> = {};
                      for (let i = 0; i < tokenIds.length; i++) {
                        try {
                          const [buyRes, sellRes, midRes, spreadRes, lastRes] = await Promise.all([
                            fetch(`${CLOB}/price?token_id=${tokenIds[i]}&side=BUY`),
                            fetch(`${CLOB}/price?token_id=${tokenIds[i]}&side=SELL`),
                            fetch(`${CLOB}/midpoint?token_id=${tokenIds[i]}`),
                            fetch(`${CLOB}/spread?token_id=${tokenIds[i]}`),
                            fetch(`${CLOB}/last-trade-price?token_id=${tokenIds[i]}`),
                          ]);
                          const buy = await buyRes.json() as { price?: string };
                          const sell = await sellRes.json() as { price?: string };
                          const mid = await midRes.json() as { mid?: string };
                          const spread = await spreadRes.json() as { spread?: string };
                          const last = await lastRes.json() as { price?: string; side?: string };
                          pricing[outcomes[i]] = {
                            buyPrice: buy.price || null,
                            sellPrice: sell.price || null,
                            midpoint: mid.mid || null,
                            spread: spread.spread || null,
                            lastTrade: last.price || null,
                            lastTradeSide: last.side || null,
                          };
                        } catch { /* skip */ }
                      }
                      // Time remaining
                      const endTimeStr = m.endDate as string;
                      const endMs = endTimeStr ? new Date(endTimeStr).getTime() : 0;
                      const timeLeftSec = endMs ? Math.max(0, Math.round((endMs - Date.now()) / 1000)) : 0;
                      results.push({
                        coin: c, timeframe: '15m', slug, title: ev.title,
                        conditionId: m.conditionId, endDate: m.endDate,
                        timeLeftSeconds: timeLeftSec,
                        tokens, pricing,
                        volume: m.volumeNum, liquidity: m.liquidityNum,
                      });
                      break; // Found current window
                    }
                  }
                }
              } else if (tf === '1h') {
                // Hourly: {coinName}-up-or-down-{month}-{day}-{hour}{am/pm}-et
                const now = new Date();
                const etOffset = -5 * 60; // ET = UTC-5 (EST; adjust to -4 for EDT if needed)
                const etTime = new Date(now.getTime() + (etOffset + now.getTimezoneOffset()) * 60000);
                const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
                // Try current hour, next hour, and +2 hours (handles midnight rollover)
                let foundHourly = false;
                for (const hourOff of [0, 1, 2]) {
                  if (foundHourly) break;
                  const target = new Date(etTime.getTime() + hourOff * 3600000);
                  const month = months[target.getMonth()];
                  const day = target.getDate();
                  const h24 = target.getHours();
                  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
                  const ampm = h24 < 12 ? 'am' : 'pm';
                  slug = `${coinName}-up-or-down-${month}-${day}-${h12}${ampm}-et`;
                  const res = await fetch(`${GAMMA}/events?slug=${slug}`);
                  const events = await res.json() as Array<Record<string, unknown>>;
                  if (Array.isArray(events) && events.length > 0) {
                    const ev = events[0];
                    // Skip resolved/closed markets
                    if (ev.closed === true || ev.active === false) continue;
                    const mkts = ev.markets as Array<Record<string, unknown>> | undefined;
                    if (mkts && mkts.length > 0) {
                      const m = mkts[0];
                      if (m.closed === true || m.active === false) continue;
                      const tokenIds = JSON.parse((m.clobTokenIds as string) || '[]') as string[];
                      const outcomes = JSON.parse((m.outcomes as string) || '[]') as string[];
                      const prices = JSON.parse((m.outcomePrices as string) || '[]') as string[];
                      const tokens: Record<string, unknown> = {};
                      for (let i = 0; i < outcomes.length; i++) {
                        tokens[outcomes[i]] = { tokenId: tokenIds[i], price: prices[i] };
                      }
                      results.push({
                        coin: c, timeframe: '1h', slug, title: ev.title,
                        conditionId: m.conditionId, endDate: m.endDate,
                        tokens, volume: m.volumeNum, liquidity: m.liquidityNum,
                      });
                      foundHourly = true;
                    }
                  }
                }
              } else if (tf === 'daily') {
                // Daily: {coinName}-up-or-down-on-{month}-{day}
                // Try today and tomorrow (today's may be resolved)
                const now = new Date();
                const etOffset = -5 * 60;
                const etTime = new Date(now.getTime() + (etOffset + now.getTimezoneOffset()) * 60000);
                const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
                let foundDaily = false;
                for (const dayOff of [0, 1]) {
                  if (foundDaily) break;
                  const target = new Date(etTime.getTime() + dayOff * 86400000);
                  const month = months[target.getMonth()];
                  const day = target.getDate();
                  slug = `${coinName}-up-or-down-on-${month}-${day}`;
                  const res = await fetch(`${GAMMA}/events?slug=${slug}`);
                  const events = await res.json() as Array<Record<string, unknown>>;
                  if (Array.isArray(events) && events.length > 0) {
                    const ev = events[0];
                    // Skip resolved/closed markets
                    if (ev.closed === true || ev.active === false) continue;
                    const mkts = ev.markets as Array<Record<string, unknown>> | undefined;
                    if (mkts && mkts.length > 0) {
                      const m = mkts[0];
                      if (m.closed === true || m.active === false) continue;
                      const tokenIds = JSON.parse((m.clobTokenIds as string) || '[]') as string[];
                      const outcomes = JSON.parse((m.outcomes as string) || '[]') as string[];
                      const prices = JSON.parse((m.outcomePrices as string) || '[]') as string[];
                      const tokens: Record<string, unknown> = {};
                      for (let i = 0; i < outcomes.length; i++) {
                        tokens[outcomes[i]] = { tokenId: tokenIds[i], price: prices[i] };
                      }
                      results.push({
                        coin: c, timeframe: 'daily', slug, title: ev.title,
                        conditionId: m.conditionId, endDate: m.endDate,
                        tokens, volume: m.volumeNum, liquidity: m.liquidityNum,
                      });
                      foundDaily = true;
                    }
                  }
                }
              }
            } catch { /* skip failed lookups */ }
          }
        }

        if (results.length === 0) {
          return JSON.stringify({ error: 'No active crypto Up/Down markets found. Markets may be between rounds.' });
        }
        return JSON.stringify({ markets: results, count: results.length });
      }

      case 'polymarket_event_tags': {
        const eventId = toolInput.event_id as string;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/events/${encodeURIComponent(eventId)}/tags`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_market_by_slug': {
        const slug = toolInput.slug as string;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_market_tags': {
        const marketId = toolInput.market_id as string;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/markets/${encodeURIComponent(marketId)}/tags`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // POLYMARKET GAMMA API - Series
      // ============================================

      case 'polymarket_series': {
        const seriesId = toolInput.series_id as string | undefined;
        try {
          const url = seriesId
            ? `https://gamma-api.polymarket.com/series/${encodeURIComponent(seriesId)}`
            : 'https://gamma-api.polymarket.com/series';
          const response = await fetch(url);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_series_list': {
        const limit = (toolInput.limit as number) || 20;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/series?_limit=${limit}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // POLYMARKET GAMMA API - Tags
      // ============================================

      case 'polymarket_tags': {
        const limit = (toolInput.limit as number) || 50;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/tags?_limit=${limit}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_tag': {
        const tagId = toolInput.tag_id as string;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/tags/${encodeURIComponent(tagId)}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_tag_by_slug': {
        const slug = toolInput.slug as string;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/tags?slug=${encodeURIComponent(slug)}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_tag_relations': {
        const tagId = toolInput.tag_id as string;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/tags/${encodeURIComponent(tagId)}/relations`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // POLYMARKET GAMMA API - Sports
      // ============================================

      case 'polymarket_sports': {
        try {
          const response = await fetch('https://gamma-api.polymarket.com/sports');
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_teams': {
        const sport = toolInput.sport as string | undefined;
        try {
          const url = sport
            ? `https://gamma-api.polymarket.com/teams?sport=${encodeURIComponent(sport)}`
            : 'https://gamma-api.polymarket.com/teams';
          const response = await fetch(url);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // POLYMARKET GAMMA API - Comments
      // ============================================

      case 'polymarket_comments': {
        const marketId = toolInput.market_id as string;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/comments?market=${encodeURIComponent(marketId)}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_user_comments': {
        const address = toolInput.address as string;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/comments?address=${encodeURIComponent(address)}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // POLYMARKET DATA API - Portfolio & Analytics
      // ============================================

      case 'polymarket_positions_value': {
        const address = toolInput.address as string | undefined;
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        const walletAddr = address || (polyCreds?.data as PolymarketCredentials)?.funderAddress;
        if (!walletAddr) return JSON.stringify({ error: 'No address provided and no credentials set up.' });
        try {
          const response = await fetch(`https://data-api.polymarket.com/value?address=${walletAddr}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_closed_positions': {
        const address = toolInput.address as string | undefined;
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        const walletAddr = address || (polyCreds?.data as PolymarketCredentials)?.funderAddress;
        if (!walletAddr) return JSON.stringify({ error: 'No address provided and no credentials set up.' });
        try {
          const response = await fetch(`https://data-api.polymarket.com/positions?address=${walletAddr}&closed=true&_limit=50`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_pnl_timeseries': {
        const address = toolInput.address as string | undefined;
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        const walletAddr = address || (polyCreds?.data as PolymarketCredentials)?.funderAddress;
        if (!walletAddr) return JSON.stringify({ error: 'No address provided and no credentials set up.' });
        try {
          // PnL timeseries not available — compute from closed positions
          const response = await fetch(`https://data-api.polymarket.com/positions?user=${walletAddr.toLowerCase()}&closed=true&limit=500&sortBy=TIMESTAMP&sortDirection=DESC`);
          const positions = await response.json() as Array<{ cashPnl?: number; endDate?: string; title?: string }>;
          let cumPnl = 0;
          const series = (positions as Array<{ cashPnl?: number; endDate?: string; title?: string }>).reverse().map(p => {
            cumPnl += (p.cashPnl || 0);
            return { date: p.endDate, pnl: cumPnl, trade: p.title };
          });
          return JSON.stringify({ timeseries: series, totalPnl: cumPnl });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_overall_pnl': {
        const address = toolInput.address as string | undefined;
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        const walletAddr = address || (polyCreds?.data as PolymarketCredentials)?.funderAddress;
        if (!walletAddr) return JSON.stringify({ error: 'No address provided and no credentials set up.' });
        try {
          // Compute PnL from open + closed positions
          const [openRes, closedRes, valueRes] = await Promise.all([
            fetch(`https://data-api.polymarket.com/positions?user=${walletAddr.toLowerCase()}&sizeThreshold=0`),
            fetch(`https://data-api.polymarket.com/positions?user=${walletAddr.toLowerCase()}&closed=true&limit=500`),
            fetch(`https://data-api.polymarket.com/value?user=${walletAddr.toLowerCase()}`),
          ]);
          const open = await openRes.json() as Array<{ cashPnl?: number; initialValue?: number; currentValue?: number }>;
          const closed = await closedRes.json() as Array<{ cashPnl?: number; realizedPnl?: number }>;
          const value = await valueRes.json() as Array<{ value?: number }>;
          const unrealizedPnl = (open as Array<{ cashPnl?: number }>).reduce((s, p) => s + (p.cashPnl || 0), 0);
          const realizedPnl = (closed as Array<{ cashPnl?: number }>).reduce((s, p) => s + (p.cashPnl || 0), 0);
          return JSON.stringify({
            totalPnl: realizedPnl + unrealizedPnl,
            realizedPnl,
            unrealizedPnl,
            positionValue: (value as Array<{ value?: number }>)[0]?.value || 0,
            openPositions: (open as Array<unknown>).length,
            closedPositions: (closed as Array<unknown>).length,
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_user_rank': {
        const address = toolInput.address as string | undefined;
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        const walletAddr = address || (polyCreds?.data as PolymarketCredentials)?.funderAddress;
        if (!walletAddr) return JSON.stringify({ error: 'No address provided and no credentials set up.' });
        try {
          const response = await fetch(`https://data-api.polymarket.com/v1/leaderboard?user=${walletAddr.toLowerCase()}&timePeriod=ALL&limit=1`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_leaderboard': {
        const limit = (toolInput.limit as number) || 20;
        const period = (toolInput.period as string) || 'WEEK';
        const category = (toolInput.category as string) || 'OVERALL';
        try {
          const response = await fetch(`https://data-api.polymarket.com/v1/leaderboard?limit=${Math.min(limit, 50)}&timePeriod=${period}&category=${category}&orderBy=PNL`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_top_holders': {
        const marketId = toolInput.market_id as string;
        try {
          const response = await fetch(`https://data-api.polymarket.com/holders?market=${encodeURIComponent(marketId)}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_user_activity': {
        const address = toolInput.address as string | undefined;
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        const walletAddr = address || (polyCreds?.data as PolymarketCredentials)?.funderAddress;
        if (!walletAddr) return JSON.stringify({ error: 'No address provided and no credentials set up.' });
        try {
          const response = await fetch(`https://data-api.polymarket.com/activity?user=${walletAddr.toLowerCase()}&limit=100`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_open_interest': {
        const marketId = toolInput.market_id as string;
        try {
          const response = await fetch(`https://data-api.polymarket.com/oi?market=${encodeURIComponent(marketId)}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_live_volume': {
        const eventId = toolInput.event_id as string | undefined;
        if (!eventId) return JSON.stringify({ error: 'event_id is required for live volume' });
        try {
          const response = await fetch(`https://data-api.polymarket.com/live-volume?id=${encodeURIComponent(eventId)}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_price_history': {
        const tokenId = toolInput.token_id as string;
        const interval = toolInput.interval as string | undefined;
        try {
          let url = `https://clob.polymarket.com/prices-history?market=${tokenId}`;
          if (interval) url += `&interval=${interval}`;
          const response = await fetch(url);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // POLYMARKET REWARDS API
      // ============================================

      case 'polymarket_daily_rewards':
      case 'polymarket_market_rewards':
      case 'polymarket_reward_markets': {
        return JSON.stringify({ error: 'Polymarket rewards endpoints are no longer publicly available. Makers earn rewards automatically by posting resting limit orders.' });
      }

      // ============================================
      // POLYMARKET PROFILES API
      // ============================================

      case 'polymarket_profile': {
        const address = toolInput.address as string;
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/public-profile?address=${encodeURIComponent(address)}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }


      // Kalshi handlers — migrated to handlers/kalshi.ts
      // Manifold handlers — migrated to handlers/manifold.ts

      // ============================================
      // METACULUS HANDLERS (Forecasting Platform)
      // ============================================

      case 'metaculus_search': {
        const query = toolInput.query as string;
        const status = (toolInput.status as string) || 'open';
        const limit = (toolInput.limit as number) || 20;
        try {
          const params = new URLSearchParams({
            search: query,
            status,
            type: 'forecast',
            limit: limit.toString(),
            order_by: '-activity',
          });
          const response = await fetch(`https://www.metaculus.com/api2/questions/?${params}`, {
            headers: { 'Accept': 'application/json' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { results?: Array<Record<string, unknown>> };
          return JSON.stringify((data.results || []).slice(0, limit).map((q) => ({
            id: q.id,
            title: q.title,
            probability: (q.community_prediction as { full?: { q2?: number } } | undefined)?.full?.q2,
            status: q.status,
            url: q.page_url || `https://www.metaculus.com/questions/${q.id}/`,
            predictions: q.number_of_predictions,
          })));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_question': {
        const questionId = toolInput.question_id as string;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/questions/${questionId}/`, {
            headers: { 'Accept': 'application/json' },
          });
          if (!response.ok) {
            if (response.status === 404) return JSON.stringify({ error: 'Question not found' });
            return JSON.stringify({ error: `API error: ${response.status}` });
          }
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_tournaments': {
        try {
          const response = await fetch('https://www.metaculus.com/api2/tournaments/', {
            headers: { 'Accept': 'application/json' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { results?: Array<Record<string, unknown>> };
          return JSON.stringify((data.results || []).map((t) => ({
            id: t.id,
            name: t.name,
            questions_count: t.questions_count,
            close_date: t.close_date,
          })));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_tournament_questions': {
        const tournamentId = toolInput.tournament_id as string;
        const limit = (toolInput.limit as number) || 50;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/questions/?tournament=${tournamentId}&limit=${limit}`, {
            headers: { 'Accept': 'application/json' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { results?: Array<Record<string, unknown>> };
          return JSON.stringify((data.results || []).map((q) => ({
            id: q.id,
            title: q.title,
            probability: (q.community_prediction as { full?: { q2?: number } } | undefined)?.full?.q2,
            status: q.status,
          })));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // PREDICTIT HANDLERS (Read Only)
      // ============================================

      case 'predictit_search': {
        const query = toolInput.query as string;
        const limit = (toolInput.limit as number) || 20;
        try {
          const response = await fetch('https://www.predictit.org/api/marketdata/all/');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          type PredictItMarket = { id: number; name: string; shortName: string; url: string; status: string; contracts: Array<{ id: number; name: string; lastTradePrice: number }> };
          const data = await response.json() as { markets?: PredictItMarket[] };
          const queryLower = query.toLowerCase();
          const markets = (data.markets || [])
            .filter((m) =>
              m.name.toLowerCase().includes(queryLower) ||
              m.shortName.toLowerCase().includes(queryLower) ||
              m.contracts.some((c) => c.name.toLowerCase().includes(queryLower))
            )
            .slice(0, limit)
            .map((m) => ({
              id: m.id,
              name: m.name,
              url: m.url,
              contracts: m.contracts.map(c => ({
                id: c.id,
                name: c.name,
                price: c.lastTradePrice,
              })),
            }));
          return JSON.stringify(markets);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictit_market': {
        const marketId = toolInput.market_id as string;
        try {
          const response = await fetch('https://www.predictit.org/api/marketdata/all/');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          type PredictItMarket = { id: number; name: string; shortName: string; url: string; status: string; contracts: Array<{ id: number; name: string; lastTradePrice: number }> };
          const data = await response.json() as { markets?: PredictItMarket[] };
          const market = (data.markets || []).find((m) => m.id.toString() === marketId);
          if (!market) return JSON.stringify({ error: 'Market not found' });
          return JSON.stringify(market);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictit_all_markets': {
        try {
          const response = await fetch('https://www.predictit.org/api/marketdata/all/');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          type PredictItMarket = { id: number; name: string; shortName: string; url: string; status: string; contracts: Array<{ id: number; name: string; lastTradePrice: number }> };
          const data = await response.json() as { markets?: PredictItMarket[] };
          return JSON.stringify((data.markets || []).map((m) => ({
            id: m.id,
            name: m.name,
            shortName: m.shortName,
            url: m.url,
            status: m.status,
            contracts: m.contracts.length,
          })));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // DRIFT BET HANDLERS (Solana Prediction Markets)
      // ============================================

      case 'drift_search': {
        const query = toolInput.query as string;
        try {
          const response = await fetch('https://bet.drift.trade/api/markets');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          type DriftMarket = { marketIndex: number; marketName: string; baseAssetSymbol: string; probability: number; volume24h: number; status: string };
          const data = await response.json() as { markets?: DriftMarket[] };
          const queryLower = query.toLowerCase();
          const markets = (data.markets || [])
            .filter((m) =>
              m.marketName.toLowerCase().includes(queryLower) ||
              m.baseAssetSymbol.toLowerCase().includes(queryLower)
            )
            .map((m) => ({
              marketIndex: m.marketIndex,
              name: m.marketName,
              symbol: m.baseAssetSymbol,
              probability: m.probability,
              volume24h: m.volume24h,
              status: m.status,
              url: `https://bet.drift.trade/market/${m.marketIndex}`,
            }));
          return JSON.stringify(markets);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_market': {
        const marketIndex = toolInput.market_index as string;
        try {
          const response = await fetch(`https://bet.drift.trade/api/markets/${marketIndex}`);
          if (!response.ok) {
            if (response.status === 404) return JSON.stringify({ error: 'Market not found' });
            return JSON.stringify({ error: `API error: ${response.status}` });
          }
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_all_markets': {
        try {
          const response = await fetch('https://bet.drift.trade/api/markets');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          type DriftMarket = { marketIndex: number; marketName: string; baseAssetSymbol: string; probability: number; volume24h: number; status: string };
          const data = await response.json() as { markets?: DriftMarket[] };
          return JSON.stringify((data.markets || []).map((m) => ({
            marketIndex: m.marketIndex,
            name: m.marketName,
            symbol: m.baseAssetSymbol,
            probability: m.probability,
            volume24h: m.volume24h,
            status: m.status,
          })));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // COINGECKO HANDLERS (Crypto Prices)
      // ============================================

      case 'coingecko_price': {
        const coinId = toolInput.coin_id as string;
        const includeMarketCap = toolInput.include_market_cap as boolean || false;
        const include24hrVol = toolInput.include_24hr_vol as boolean || false;
        try {
          const params = new URLSearchParams({
            ids: coinId,
            vs_currencies: 'usd',
            include_24hr_change: 'true',
          });
          if (includeMarketCap) params.append('include_market_cap', 'true');
          if (include24hrVol) params.append('include_24hr_vol', 'true');
          const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?${params}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_prices': {
        const coinIds = toolInput.coin_ids as string;
        const vsCurrency = (toolInput.vs_currency as string) || 'usd';
        try {
          const params = new URLSearchParams({
            ids: coinIds,
            vs_currencies: vsCurrency,
            include_24hr_change: 'true',
            include_market_cap: 'true',
          });
          const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?${params}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_coin_info': {
        const coinId = toolInput.coin_id as string;
        try {
          const response = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as {
            id?: string;
            symbol?: string;
            name?: string;
            description?: { en?: string };
            links?: { homepage?: string[]; twitter_screen_name?: string; subreddit_url?: string };
            market_data?: {
              current_price?: { usd?: number };
              market_cap?: { usd?: number };
              total_volume?: { usd?: number };
              price_change_percentage_24h?: number;
              price_change_percentage_7d?: number;
              ath?: { usd?: number };
              ath_date?: { usd?: string };
              circulating_supply?: number;
              total_supply?: number;
            };
          };
          return JSON.stringify({
            id: data.id,
            symbol: data.symbol,
            name: data.name,
            description: data.description?.en?.slice(0, 500),
            links: {
              homepage: data.links?.homepage?.[0],
              twitter: data.links?.twitter_screen_name,
              reddit: data.links?.subreddit_url,
            },
            market_data: {
              current_price_usd: data.market_data?.current_price?.usd,
              market_cap_usd: data.market_data?.market_cap?.usd,
              total_volume_usd: data.market_data?.total_volume?.usd,
              price_change_24h_pct: data.market_data?.price_change_percentage_24h,
              price_change_7d_pct: data.market_data?.price_change_percentage_7d,
              ath_usd: data.market_data?.ath?.usd,
              ath_date: data.market_data?.ath_date?.usd,
              circulating_supply: data.market_data?.circulating_supply,
              total_supply: data.market_data?.total_supply,
            },
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_market_chart': {
        const coinId = toolInput.coin_id as string;
        const days = toolInput.days as string;
        const interval = toolInput.interval as string;
        try {
          const params = new URLSearchParams({ vs_currency: 'usd', days });
          if (interval) params.append('interval', interval);
          const response = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?${params}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { prices?: Array<[number, number]> };
          // Simplify the output
          const prices = (data.prices || []).slice(-50).map((p) => ({
            timestamp: new Date(p[0]).toISOString(),
            price: p[1],
          }));
          return JSON.stringify({ coin: coinId, days, dataPoints: prices.length, prices });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_trending': {
        try {
          const response = await fetch('https://api.coingecko.com/api/v3/search/trending');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { coins?: Array<{ item: Record<string, unknown> }> };
          const trending = (data.coins || []).map((c) => ({
            id: c.item.id,
            name: c.item.name,
            symbol: c.item.symbol,
            market_cap_rank: c.item.market_cap_rank,
            price_btc: c.item.price_btc,
          }));
          return JSON.stringify(trending);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_search': {
        const query = toolInput.query as string;
        try {
          const response = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { coins?: Array<Record<string, unknown>> };
          const coins = (data.coins || []).slice(0, 10).map((c) => ({
            id: c.id,
            name: c.name,
            symbol: c.symbol,
            market_cap_rank: c.market_cap_rank,
          }));
          return JSON.stringify(coins);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_markets': {
        const perPage = (toolInput.per_page as number) || 100;
        const page = (toolInput.page as number) || 1;
        const order = (toolInput.order as string) || 'market_cap_desc';
        try {
          const params = new URLSearchParams({
            vs_currency: 'usd',
            order,
            per_page: String(perPage),
            page: String(page),
            sparkline: 'false',
            price_change_percentage: '24h,7d',
          });
          const response = await fetch(`https://api.coingecko.com/api/v3/coins/markets?${params}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as Array<Record<string, unknown>>;
          return JSON.stringify(data.map((c) => ({
            id: c.id,
            symbol: c.symbol,
            name: c.name,
            current_price: c.current_price,
            market_cap: c.market_cap,
            market_cap_rank: c.market_cap_rank,
            total_volume: c.total_volume,
            price_change_24h_pct: c.price_change_percentage_24h,
            price_change_7d_pct: c.price_change_percentage_7d_in_currency,
          })));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_global': {
        try {
          const response = await fetch('https://api.coingecko.com/api/v3/global');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as {
            data?: {
              active_cryptocurrencies?: number;
              markets?: number;
              total_market_cap?: { usd?: number };
              total_volume?: { usd?: number };
              market_cap_percentage?: { btc?: number; eth?: number };
              market_cap_change_percentage_24h_usd?: number;
            };
          };
          const globalData = data.data;
          return JSON.stringify({
            active_cryptocurrencies: globalData?.active_cryptocurrencies,
            markets: globalData?.markets,
            total_market_cap_usd: globalData?.total_market_cap?.usd,
            total_volume_24h_usd: globalData?.total_volume?.usd,
            btc_dominance_pct: globalData?.market_cap_percentage?.btc,
            eth_dominance_pct: globalData?.market_cap_percentage?.eth,
            market_cap_change_24h_pct: globalData?.market_cap_change_percentage_24h_usd,
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // YAHOO FINANCE HANDLERS (Stocks)
      // ============================================

      case 'yahoo_quote': {
        const symbol = (toolInput.symbol as string).toUpperCase();
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { quoteResponse?: { result?: Array<Record<string, unknown>> } };
          const quote = data.quoteResponse?.result?.[0];
          if (!quote) return JSON.stringify({ error: 'Symbol not found' });
          return JSON.stringify({
            symbol: quote.symbol,
            name: quote.longName || quote.shortName,
            price: quote.regularMarketPrice,
            change: quote.regularMarketChange,
            change_pct: quote.regularMarketChangePercent,
            volume: quote.regularMarketVolume,
            market_cap: quote.marketCap,
            pe_ratio: quote.trailingPE,
            eps: quote.epsTrailingTwelveMonths,
            day_high: quote.regularMarketDayHigh,
            day_low: quote.regularMarketDayLow,
            week_52_high: quote.fiftyTwoWeekHigh,
            week_52_low: quote.fiftyTwoWeekLow,
            avg_volume: quote.averageDailyVolume3Month,
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_quotes': {
        const symbols = (toolInput.symbols as string).toUpperCase();
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { quoteResponse?: { result?: Array<Record<string, unknown>> } };
          const quotes = (data.quoteResponse?.result || []).map((q) => ({
            symbol: q.symbol,
            name: q.longName || q.shortName,
            price: q.regularMarketPrice,
            change: q.regularMarketChange,
            change_pct: q.regularMarketChangePercent,
            volume: q.regularMarketVolume,
            market_cap: q.marketCap,
          }));
          return JSON.stringify(quotes);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_chart': {
        const symbol = (toolInput.symbol as string).toUpperCase();
        const range = toolInput.range as string;
        const interval = (toolInput.interval as string) || '1d';
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as {
            chart?: {
              result?: Array<{
                timestamp?: number[];
                indicators?: { quote?: Array<{ open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[] }> };
              }>;
            };
          };
          const result = data.chart?.result?.[0];
          if (!result) return JSON.stringify({ error: 'No chart data' });
          const timestamps = result.timestamp || [];
          const quote = result.indicators?.quote?.[0] || {};
          const candles = timestamps.slice(-50).map((ts, i) => ({
            date: new Date(ts * 1000).toISOString().split('T')[0],
            open: quote.open?.[i],
            high: quote.high?.[i],
            low: quote.low?.[i],
            close: quote.close?.[i],
            volume: quote.volume?.[i],
          }));
          return JSON.stringify({ symbol, range, interval, candles });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_search': {
        const query = toolInput.query as string;
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { quotes?: Array<Record<string, unknown>> };
          const results = (data.quotes || []).map((q) => ({
            symbol: q.symbol,
            name: q.longname || q.shortname,
            type: q.quoteType,
            exchange: q.exchange,
          }));
          return JSON.stringify(results);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_options': {
        const symbol = (toolInput.symbol as string).toUpperCase();
        const expiration = toolInput.expiration as string;
        try {
          let url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}`;
          if (expiration) {
            const expTimestamp = Math.floor(new Date(expiration).getTime() / 1000);
            url += `?date=${expTimestamp}`;
          }
          const response = await fetch(url);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as {
            optionChain?: {
              result?: Array<{
                quote?: { regularMarketPrice?: number };
                expirationDates?: number[];
                options?: Array<{
                  calls?: Array<Record<string, unknown>>;
                  puts?: Array<Record<string, unknown>>;
                }>;
              }>;
            };
          };
          const result = data.optionChain?.result?.[0];
          if (!result) return JSON.stringify({ error: 'No options data' });
          return JSON.stringify({
            symbol,
            underlyingPrice: result.quote?.regularMarketPrice,
            expirations: result.expirationDates?.map((ts) => new Date(ts * 1000).toISOString().split('T')[0]),
            calls: result.options?.[0]?.calls?.slice(0, 20).map((o) => ({
              strike: o.strike,
              bid: o.bid,
              ask: o.ask,
              lastPrice: o.lastPrice,
              volume: o.volume,
              openInterest: o.openInterest,
              impliedVolatility: o.impliedVolatility,
            })),
            puts: result.options?.[0]?.puts?.slice(0, 20).map((o) => ({
              strike: o.strike,
              bid: o.bid,
              ask: o.ask,
              lastPrice: o.lastPrice,
              volume: o.volume,
              openInterest: o.openInterest,
              impliedVolatility: o.impliedVolatility,
            })),
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_news': {
        const symbol = (toolInput.symbol as string).toUpperCase();
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&quotesCount=0&newsCount=10`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { news?: Array<Record<string, unknown>> };
          const news = (data.news || []).map((n) => ({
            title: n.title,
            publisher: n.publisher,
            link: n.link,
            publishedAt: n.providerPublishTime ? new Date((n.providerPublishTime as number) * 1000).toISOString() : null,
          }));
          return JSON.stringify(news);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_fundamentals': {
        const symbol = (toolInput.symbol as string).toUpperCase();
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=summaryDetail,financialData,defaultKeyStatistics`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as {
            quoteSummary?: {
              result?: Array<{
                summaryDetail?: Record<string, { raw?: number }>;
                financialData?: Record<string, { raw?: number }>;
                defaultKeyStatistics?: Record<string, { raw?: number }>;
              }>;
            };
          };
          const result = data.quoteSummary?.result?.[0];
          if (!result) return JSON.stringify({ error: 'No fundamentals data' });
          const summary = result.summaryDetail || {};
          const financial = result.financialData || {};
          const stats = result.defaultKeyStatistics || {};
          return JSON.stringify({
            symbol,
            pe_ratio: summary.trailingPE?.raw,
            forward_pe: summary.forwardPE?.raw,
            peg_ratio: stats.pegRatio?.raw,
            price_to_book: summary.priceToBook?.raw,
            dividend_yield: summary.dividendYield?.raw,
            dividend_rate: summary.dividendRate?.raw,
            beta: summary.beta?.raw,
            profit_margin: financial.profitMargins?.raw,
            operating_margin: financial.operatingMargins?.raw,
            revenue: financial.totalRevenue?.raw,
            revenue_growth: financial.revenueGrowth?.raw,
            earnings_growth: financial.earningsGrowth?.raw,
            current_ratio: financial.currentRatio?.raw,
            debt_to_equity: financial.debtToEquity?.raw,
            return_on_equity: financial.returnOnEquity?.raw,
            free_cash_flow: financial.freeCashflow?.raw,
            enterprise_value: stats.enterpriseValue?.raw,
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_earnings': {
        const symbol = (toolInput.symbol as string).toUpperCase();
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=earnings,calendarEvents`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as {
            quoteSummary?: {
              result?: Array<{
                earnings?: {
                  earningsChart?: {
                    quarterly?: Array<{ date?: unknown; actual?: { raw?: number }; estimate?: { raw?: number } }>;
                  };
                };
                calendarEvents?: {
                  earnings?: {
                    earningsDate?: Array<{ raw: number }>;
                    earningsAverage?: { raw?: number };
                    earningsLow?: { raw?: number };
                    earningsHigh?: { raw?: number };
                    revenueAverage?: { raw?: number };
                  };
                };
              }>;
            };
          };
          const result = data.quoteSummary?.result?.[0];
          if (!result) return JSON.stringify({ error: 'No earnings data' });
          const earnings = result.earnings || {};
          const calendar = result.calendarEvents || {};
          return JSON.stringify({
            symbol,
            earningsDate: calendar.earnings?.earningsDate?.map((d) => new Date(d.raw * 1000).toISOString().split('T')[0]),
            earningsAverage: calendar.earnings?.earningsAverage?.raw,
            earningsLow: calendar.earnings?.earningsLow?.raw,
            earningsHigh: calendar.earnings?.earningsHigh?.raw,
            revenueAverage: calendar.earnings?.revenueAverage?.raw,
            quarterlyEarnings: earnings.earningsChart?.quarterly?.map((q) => ({
              date: q.date,
              actual: q.actual?.raw,
              estimate: q.estimate?.raw,
            })),
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // OPINION.TRADE HANDLERS (BNB Chain Prediction Market)
      // ============================================

      case 'opinion_markets': {
        const status = (toolInput.status as string) || 'active';
        const limit = (toolInput.limit as number) || 50;
        try {
          const params = new URLSearchParams({ limit: String(limit) });
          if (status !== 'all') params.append('status', status);
          const response = await fetch(`https://proxy.opinion.trade:8443/openapi/market?${params}`, {
            headers: { 'apikey': process.env.OPINION_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { code: number; msg?: string; result?: unknown };
          if (data.code !== 0) return JSON.stringify({ error: data.msg });
          return JSON.stringify(data.result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_market': {
        const marketId = toolInput.market_id as string;
        try {
          const response = await fetch(`https://proxy.opinion.trade:8443/openapi/market/${marketId}`, {
            headers: { 'apikey': process.env.OPINION_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { code: number; msg?: string; result?: unknown };
          if (data.code !== 0) return JSON.stringify({ error: data.msg });
          return JSON.stringify(data.result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_price': {
        const tokenId = toolInput.token_id as string;
        try {
          const response = await fetch(`https://proxy.opinion.trade:8443/openapi/token/latest-price?tokenId=${tokenId}`, {
            headers: { 'apikey': process.env.OPINION_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { code: number; msg?: string; result?: unknown };
          if (data.code !== 0) return JSON.stringify({ error: data.msg });
          return JSON.stringify(data.result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_orderbook': {
        const tokenId = toolInput.token_id as string;
        const depth = (toolInput.depth as number) || 10;
        try {
          const response = await fetch(`https://proxy.opinion.trade:8443/openapi/token/orderbook?tokenId=${tokenId}&depth=${depth}`, {
            headers: { 'apikey': process.env.OPINION_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { code: number; msg?: string; result?: unknown };
          if (data.code !== 0) return JSON.stringify({ error: data.msg });
          return JSON.stringify(data.result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_price_history': {
        const tokenId = toolInput.token_id as string;
        const interval = (toolInput.interval as string) || '1d';
        const limit = (toolInput.limit as number) || 100;
        try {
          const params = new URLSearchParams({
            tokenId,
            interval,
            limit: String(limit),
          });
          const response = await fetch(`https://proxy.opinion.trade:8443/openapi/token/price-history?${params}`, {
            headers: { 'apikey': process.env.OPINION_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { code: number; msg?: string; result?: unknown };
          if (data.code !== 0) return JSON.stringify({ error: data.msg });
          return JSON.stringify(data.result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_quote_tokens': {
        try {
          const response = await fetch('https://proxy.opinion.trade:8443/openapi/quoteToken', {
            headers: { 'apikey': process.env.OPINION_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as { code: number; msg?: string; result?: unknown };
          if (data.code !== 0) return JSON.stringify({ error: data.msg });
          return JSON.stringify(data.result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Opinion.trade TRADING handlers (full SDK implementation)
      case 'opinion_place_order': {
        const marketId = toolInput.market_id as number;
        const tokenId = toolInput.token_id as string;
        const side = (toolInput.side as string).toUpperCase() as 'BUY' | 'SELL';
        const price = toolInput.price as number;
        const amount = toolInput.amount as number;
        const orderType = ((toolInput.order_type as string) || 'LIMIT').toUpperCase() as 'LIMIT' | 'MARKET';

        // Use execution service if available (preferred)
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const result = side === 'BUY'
              ? await execSvc.buyLimit({
                  platform: 'opinion',
                  marketId: String(marketId),
                  tokenId,
                  price,
                  size: amount,
                  orderType: orderType === 'MARKET' ? 'FOK' : 'GTC',
                })
              : await execSvc.sellLimit({
                  platform: 'opinion',
                  marketId: String(marketId),
                  tokenId,
                  price,
                  size: amount,
                  orderType: orderType === 'MARKET' ? 'FOK' : 'GTC',
                });

            if (result.success) {
              const vaultAddress = context.tradingContext?.credentials.get('opinion')?.data as { vaultAddress?: string } | undefined;
              db.logOpinionTrade({
                oddsUserId: vaultAddress?.vaultAddress?.slice(0, 16) || 'unknown',
                orderId: result.orderId || '',
                marketId: String(marketId),
                tokenId,
                side,
                price,
                size: amount,
                orderType,
                timestamp: new Date(),
              });
            }

            return JSON.stringify({
              success: result.success,
              orderId: result.orderId,
              filledSize: result.filledSize,
              avgFillPrice: result.avgFillPrice,
              error: result.error,
            });
          } catch (err: unknown) {
            return JSON.stringify({ error: (err as Error).message });
          }
        }

        // Fallback to direct call with env vars
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({
            error: 'Opinion trading requires either trading.opinion config or OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS env vars.',
            docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
          });
        }

        try {
          const config = { apiKey, privateKey, vaultAddress, dryRun: process.env.DRY_RUN === 'true' };
          const result = await opinion.placeOrder(config, marketId, tokenId, side, price, amount, orderType);

          if (result.success) {
            db.logOpinionTrade({
              oddsUserId: vaultAddress.slice(0, 16),
              orderId: result.orderId || '',
              marketId: String(marketId),
              tokenId,
              side,
              price,
              size: amount,
              orderType,
              timestamp: new Date(),
            });
          }

          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_cancel_order': {
        const orderId = toolInput.order_id as string;

        // Use execution service if available
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const success = await execSvc.cancelOrder('opinion', orderId);
            return JSON.stringify({ success, orderId });
          } catch (err: unknown) {
            return JSON.stringify({ error: (err as Error).message });
          }
        }

        // Fallback to direct call
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({ error: 'Opinion trading requires either trading.opinion config or OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS' });
        }

        try {
          const config = { apiKey, privateKey, vaultAddress, dryRun: process.env.DRY_RUN === 'true' };
          const success = await opinion.cancelOrder(config, orderId);
          return JSON.stringify({ success, orderId });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_cancel_all_orders': {
        const marketId = toolInput.market_id as number | undefined;
        const side = toolInput.side as string | undefined;

        // Use execution service if available
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const cancelled = await execSvc.cancelAllOrders('opinion', marketId ? String(marketId) : undefined);
            return JSON.stringify({ success: true, cancelledCount: cancelled });
          } catch (err: unknown) {
            return JSON.stringify({ error: (err as Error).message });
          }
        }

        // Fallback to direct call
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({ error: 'Opinion trading requires either trading.opinion config or OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS' });
        }

        try {
          const config = { apiKey, privateKey, vaultAddress, dryRun: process.env.DRY_RUN === 'true' };
          const result = await opinion.cancelAllOrders(
            config,
            marketId,
            side ? (side.toUpperCase() as 'BUY' | 'SELL') : undefined
          );
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_orders': {
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({ error: 'Opinion.trade requires OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS' });
        }

        const marketId = toolInput.market_id as number | undefined;
        try {
          const config = { apiKey, privateKey, vaultAddress };
          const orders = await opinion.getOpenOrders(config, marketId);
          return JSON.stringify({ orders, count: orders.length });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_positions': {
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({ error: 'Opinion.trade requires OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS' });
        }

        const marketId = toolInput.market_id as number | undefined;
        try {
          const config = { apiKey, privateKey, vaultAddress };
          const positions = await opinion.getPositions(config, marketId);
          return JSON.stringify({ positions, count: positions.length });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_balances': {
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({ error: 'Opinion.trade requires OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS' });
        }

        try {
          const config = { apiKey, privateKey, vaultAddress };
          const balances = await opinion.getBalances(config);
          return JSON.stringify({ balances });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_trades': {
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({ error: 'Opinion.trade requires OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS' });
        }

        const marketId = toolInput.market_id as number | undefined;
        try {
          const config = { apiKey, privateKey, vaultAddress };
          const trades = await opinion.getTrades(config, marketId);
          return JSON.stringify({ trades, count: trades.length });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_redeem': {
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({ error: 'Opinion.trade requires OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS' });
        }

        const marketId = toolInput.market_id as number;
        try {
          const config = { apiKey, privateKey, vaultAddress, dryRun: process.env.DRY_RUN === 'true' };
          const result = await opinion.redeem(config, marketId);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Opinion.trade - Additional handlers for 100% API coverage
      case 'opinion_categorical_market': {
        const marketId = toolInput.market_id as number;
        try {
          const response = await fetch(`https://api.opinion.trade/api/v1/categorical-markets/${marketId}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_fee_rates': {
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;
        const tokenId = toolInput.token_id as string;

        // Can use SDK if configured, otherwise fallback to public API
        if (apiKey && privateKey && vaultAddress) {
          try {
            const config = { apiKey, privateKey, vaultAddress };
            const rates = await opinion.getFeeRates(config, tokenId);
            return JSON.stringify(rates);
          } catch (err: unknown) {
            return JSON.stringify({ error: (err as Error).message });
          }
        }

        // Fallback to public API
        try {
          const response = await fetch(`https://api.opinion.trade/api/v1/fee-rates?token_id=${tokenId}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_order_by_id': {
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({ error: 'Opinion.trade requires OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS' });
        }

        const orderId = toolInput.order_id as string;
        try {
          const config = { apiKey, privateKey, vaultAddress };
          const order = await opinion.getOrderById(config, orderId);
          if (!order) return JSON.stringify({ error: 'Order not found' });
          return JSON.stringify(order);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_place_orders_batch': {
        const orders = toolInput.orders as Array<{
          market_id: number;
          token_id: string;
          side: string;
          price: number;
          amount: number;
        }>;

        // Use execution service if available
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const orderRequests = orders.map(o => ({
              platform: 'opinion' as const,
              marketId: String(o.market_id),
              tokenId: o.token_id,
              side: o.side.toLowerCase() as 'buy' | 'sell',
              price: o.price,
              size: o.amount,
            }));
            const results = await execSvc.placeOrdersBatch(orderRequests);
            return JSON.stringify({ results, count: results.length });
          } catch (err: unknown) {
            return JSON.stringify({ error: (err as Error).message });
          }
        }

        // Fallback to direct call
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({ error: 'Opinion trading requires either trading.opinion config or OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS' });
        }

        try {
          const config = { apiKey, privateKey, vaultAddress, dryRun: process.env.DRY_RUN === 'true' };
          const orderInputs = orders.map(o => ({
            marketId: o.market_id,
            tokenId: o.token_id,
            side: o.side.toUpperCase() as 'BUY' | 'SELL',
            price: o.price,
            amount: o.amount,
          }));
          const results = await opinion.placeOrdersBatch(config, orderInputs);
          return JSON.stringify({ results, count: results.length });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_cancel_orders_batch': {
        const orderIds = toolInput.order_ids as string[];

        // Use execution service if available
        const execSvc = context.tradingContext?.executionService;
        if (execSvc) {
          try {
            const results = await execSvc.cancelOrdersBatch('opinion', orderIds);
            return JSON.stringify({ results });
          } catch (err: unknown) {
            return JSON.stringify({ error: (err as Error).message });
          }
        }

        // Fallback to direct call
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({ error: 'Opinion trading requires either trading.opinion config or OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS' });
        }

        try {
          const config = { apiKey, privateKey, vaultAddress, dryRun: process.env.DRY_RUN === 'true' };
          const results = await opinion.cancelOrdersBatch(config, orderIds);
          return JSON.stringify({ results });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_enable_trading': {
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({ error: 'Opinion.trade requires OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS' });
        }

        try {
          const config = { apiKey, privateKey, vaultAddress, dryRun: process.env.DRY_RUN === 'true' };
          const result = await opinion.enableTrading(config);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_split': {
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({ error: 'Opinion.trade requires OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS' });
        }

        const marketId = toolInput.market_id as number;
        const amount = toolInput.amount as number;
        try {
          const config = { apiKey, privateKey, vaultAddress, dryRun: process.env.DRY_RUN === 'true' };
          const result = await opinion.split(config, marketId, amount);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_merge': {
        const apiKey = process.env.OPINION_API_KEY;
        const privateKey = process.env.OPINION_PRIVATE_KEY;
        const vaultAddress = process.env.OPINION_VAULT_ADDRESS;

        if (!apiKey || !privateKey || !vaultAddress) {
          return JSON.stringify({ error: 'Opinion.trade requires OPINION_API_KEY, OPINION_PRIVATE_KEY, and OPINION_VAULT_ADDRESS' });
        }

        const marketId = toolInput.market_id as number;
        const amount = toolInput.amount as number;
        try {
          const config = { apiKey, privateKey, vaultAddress, dryRun: process.env.DRY_RUN === 'true' };
          const result = await opinion.merge(config, marketId, amount);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Predict.fun handlers — migrated to handlers/predictfun.ts

      // ============================================
      // DRIFT BET HANDLERS (Solana - requires Gateway)
      // ============================================

      case 'drift_place_order': {
        const marketIndex = toolInput.market_index as number;
        const marketType = toolInput.market_type as string;
        const side = toolInput.side as string;
        const orderType = toolInput.order_type as string;
        const price = toolInput.price as number | undefined;
        const amount = toolInput.amount as number;
        const reduceOnly = toolInput.reduce_only as boolean | undefined;
        const postOnly = toolInput.post_only as boolean | undefined;

        if (!Number.isFinite(amount) || amount <= 0) {
          return JSON.stringify({ error: 'amount must be a positive number' });
        }

        const signedAmount = side === 'sell' ? -Math.abs(amount) : Math.abs(amount);
        const payload: Record<string, unknown> = {
          marketIndex,
          marketType,
          amount: signedAmount,
          orderType: orderType === 'oracle' ? 'limit' : orderType,
        };

        if (orderType === 'oracle' && price !== undefined) {
          payload.oraclePriceOffset = price;
        } else if (price !== undefined) {
          payload.price = price;
        }
        if (reduceOnly !== undefined) payload.reduceOnly = reduceOnly;
        if (postOnly !== undefined) payload.postOnly = postOnly;

        try {
          const result = await driftGatewayRequest('POST', '/v2/orders', { orders: [payload] });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({
            error: (err as Error).message,
            hint: 'Ensure DRIFT_GATEWAY_URL points to a running drift-labs gateway.',
            gateway: 'https://github.com/drift-labs/gateway',
          });
        }
      }

      case 'drift_cancel_order': {
        const orderId = toolInput.order_id as number;
        const marketIndex = toolInput.market_index as number | undefined;
        const marketType = toolInput.market_type as string | undefined;
        const payload: Record<string, unknown> = { ids: [orderId] };
        if (marketIndex !== undefined) payload.marketIndex = marketIndex;
        if (marketType) payload.marketType = marketType;

        try {
          const result = await driftGatewayRequest('DELETE', '/v2/orders', payload);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message, gateway: 'https://github.com/drift-labs/gateway' });
        }
      }

      case 'drift_cancel_all_orders': {
        const marketIndex = toolInput.market_index as number | undefined;
        const marketType = toolInput.market_type as string | undefined;
        const payload: Record<string, unknown> = {};
        if (marketIndex !== undefined) payload.marketIndex = marketIndex;
        if (marketType) payload.marketType = marketType;

        try {
          const result = await driftGatewayRequest('DELETE', '/v2/orders', payload);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message, gateway: 'https://github.com/drift-labs/gateway' });
        }
      }

      case 'drift_orders': {
        const marketIndex = toolInput.market_index as number | undefined;
        const marketType = toolInput.market_type as string | undefined;
        const payload: Record<string, unknown> = {};
        if (marketIndex !== undefined) payload.marketIndex = marketIndex;
        if (marketType) payload.marketType = marketType;

        try {
          const result = await driftGatewayRequest('GET', '/v2/orders', payload);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message, gateway: 'https://github.com/drift-labs/gateway' });
        }
      }

      case 'drift_positions': {
        const marketIndex = toolInput.market_index as number | undefined;
        const payload: Record<string, unknown> = {};
        if (marketIndex !== undefined) payload.marketIndex = marketIndex;

        try {
          const result = await driftGatewayRequest('GET', '/v2/positions', payload);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message, gateway: 'https://github.com/drift-labs/gateway' });
        }
      }

      case 'drift_balance': {
        try {
          const result = await driftGatewayRequest('GET', '/v2/balance');
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message, gateway: 'https://github.com/drift-labs/gateway' });
        }
      }

      case 'drift_leverage': {
        const setLeverage = toolInput.set_leverage as number | undefined;
        try {
          if (setLeverage !== undefined) {
            const result = await driftGatewayRequest('POST', '/v2/leverage', {
              leverage: setLeverage.toString(),
            });
            return JSON.stringify(result);
          }
          const result = await driftGatewayRequest('GET', '/v2/leverage');
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message, gateway: 'https://github.com/drift-labs/gateway' });
        }
      }

      case 'drift_orderbook': {
        const marketIndex = toolInput.market_index as number;
        const marketType = toolInput.market_type as string;
        try {
          // Use public DLOB server for orderbook
          const response = await fetch(`https://dlob.drift.trade/l2?marketIndex=${marketIndex}&marketType=${marketType}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Drift - Additional handlers for 100% API coverage
      case 'drift_markets': {
        try {
          const response = await fetch('https://dlob.drift.trade/markets');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as Array<{ type: string } & Record<string, unknown>>;
          const marketType = toolInput.market_type as string;
          if (marketType) {
            return JSON.stringify(data.filter((m) => m.type === marketType));
          }
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_market_info': {
        const marketIndex = toolInput.market_index as number;
        try {
          const response = await fetch(`https://dlob.drift.trade/marketInfo/${marketIndex}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_margin_info': {
        try {
          const result = await driftGatewayRequest('GET', '/v2/user/marginInfo');
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message, gateway: 'https://github.com/drift-labs/gateway' });
        }
      }

      case 'drift_collateral': {
        try {
          const result = await driftGatewayRequest('GET', '/v2/collateral');
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message, gateway: 'https://github.com/drift-labs/gateway' });
        }
      }

      case 'drift_modify_order': {
        const orderId = toolInput.order_id as number;
        const newPrice = toolInput.new_price as number | undefined;
        const newSize = toolInput.new_size as number | undefined;

        if (newPrice === undefined && newSize === undefined) {
          return JSON.stringify({ error: 'Provide new_price and/or new_size to modify an order.' });
        }

        const payload: Record<string, unknown> = { orderId };
        if (newPrice !== undefined) payload.price = newPrice;
        if (newSize !== undefined) payload.amount = newSize;

        try {
          const result = await driftGatewayRequest('PATCH', '/v2/orders', { orders: [payload] });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message, gateway: 'https://github.com/drift-labs/gateway' });
        }
      }

      case 'drift_cancel_and_place': {
        const cancelOrderIds = (toolInput.cancel_order_ids as number[] | undefined) ?? [];
        const newOrders = (toolInput.new_orders as Array<Record<string, unknown>>) || [];

        const placeOrders = newOrders.map((order) => {
          const marketIndex = order.market_index as number;
          const marketType = order.market_type as string;
          const side = order.side as string;
          const orderType = order.order_type as string;
          const price = order.price as number | undefined;
          const amount = order.amount as number;
          const signedAmount = side === 'sell' ? -Math.abs(amount) : Math.abs(amount);
          const payload: Record<string, unknown> = {
            marketIndex,
            marketType,
            amount: signedAmount,
            orderType: orderType === 'oracle' ? 'limit' : orderType,
          };
          if (orderType === 'oracle' && price !== undefined) {
            payload.oraclePriceOffset = price;
          } else if (price !== undefined) {
            payload.price = price;
          }
          return payload;
        });

        try {
          const result = await driftGatewayRequest('POST', '/v2/orders/cancelAndPlace', {
            cancel: cancelOrderIds.length ? { ids: cancelOrderIds } : {},
            place: { orders: placeOrders },
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message, gateway: 'https://github.com/drift-labs/gateway' });
        }
      }

      case 'drift_transaction_events': {
        const signature = toolInput.signature as string | undefined;
        if (!signature) {
          return JSON.stringify({
            error: 'Provide a transaction signature to fetch an event.',
            endpoint: 'GET /v2/transactionEvent/{signature}',
          });
        }

        try {
          const result = await driftGatewayRequest('GET', `/v2/transactionEvent/${signature}`);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message, gateway: 'https://github.com/drift-labs/gateway' });
        }
      }

      // ============================================
      // CENTRALIZED FUTURES EXCHANGES
      // ============================================

      // Binance Futures handlers — migrated to handlers/binance.ts

      // Bybit handlers — migrated to handlers/bybit.ts

      // MEXC handlers
      case 'mexc_balance': {
        const apiKey = process.env.MEXC_API_KEY;
        const apiSecret = process.env.MEXC_API_SECRET;
        if (!apiKey || !apiSecret) {
          return JSON.stringify({ error: 'Set MEXC_API_KEY and MEXC_API_SECRET' });
        }
        try {
          const config: mexc.MexcConfig = { apiKey, apiSecret };
          const balances = await mexc.getBalance(config);
          return JSON.stringify({ balances });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'mexc_positions': {
        const apiKey = process.env.MEXC_API_KEY;
        const apiSecret = process.env.MEXC_API_SECRET;
        if (!apiKey || !apiSecret) {
          return JSON.stringify({ error: 'Set MEXC_API_KEY and MEXC_API_SECRET' });
        }
        try {
          const config: mexc.MexcConfig = { apiKey, apiSecret };
          const positions = await mexc.getPositions(config);
          return JSON.stringify({ positions });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'mexc_orders': {
        const apiKey = process.env.MEXC_API_KEY;
        const apiSecret = process.env.MEXC_API_SECRET;
        if (!apiKey || !apiSecret) {
          return JSON.stringify({ error: 'Set MEXC_API_KEY and MEXC_API_SECRET' });
        }
        try {
          const config: mexc.MexcConfig = { apiKey, apiSecret };
          const symbol = toolInput.symbol as string | undefined;
          const orders = await mexc.getOpenOrders(config, symbol);
          return JSON.stringify({ orders });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'mexc_long': {
        const apiKey = process.env.MEXC_API_KEY;
        const apiSecret = process.env.MEXC_API_SECRET;
        if (!apiKey || !apiSecret) {
          return JSON.stringify({ error: 'Set MEXC_API_KEY and MEXC_API_SECRET' });
        }
        const symbol = toolInput.symbol as string;
        const vol = toolInput.vol as number;
        const leverage = toolInput.leverage as number | undefined;
        try {
          const config: mexc.MexcConfig = { apiKey, apiSecret, dryRun: process.env.DRY_RUN === 'true' };
          const result = await mexc.openLong(config, symbol, vol, leverage);
          // Log trade to database (side: 1=Open Long)
          db.logMexcFuturesTrade({
            userId,
            orderId: result.orderId,
            symbol: result.symbol,
            side: 1, // Open Long
            vol: result.dealVol,
            price: result.dealAvgPrice || 0,
            leverage,
            timestamp: new Date(),
          });
          return JSON.stringify({ success: true, order: result });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'mexc_short': {
        const apiKey = process.env.MEXC_API_KEY;
        const apiSecret = process.env.MEXC_API_SECRET;
        if (!apiKey || !apiSecret) {
          return JSON.stringify({ error: 'Set MEXC_API_KEY and MEXC_API_SECRET' });
        }
        const symbol = toolInput.symbol as string;
        const vol = toolInput.vol as number;
        const leverage = toolInput.leverage as number | undefined;
        try {
          const config: mexc.MexcConfig = { apiKey, apiSecret, dryRun: process.env.DRY_RUN === 'true' };
          const result = await mexc.openShort(config, symbol, vol, leverage);
          // Log trade to database (side: 3=Open Short)
          db.logMexcFuturesTrade({
            userId,
            orderId: result.orderId,
            symbol: result.symbol,
            side: 3, // Open Short
            vol: result.dealVol,
            price: result.dealAvgPrice || 0,
            leverage,
            timestamp: new Date(),
          });
          return JSON.stringify({ success: true, order: result });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'mexc_close': {
        const apiKey = process.env.MEXC_API_KEY;
        const apiSecret = process.env.MEXC_API_SECRET;
        if (!apiKey || !apiSecret) {
          return JSON.stringify({ error: 'Set MEXC_API_KEY and MEXC_API_SECRET' });
        }
        const symbol = toolInput.symbol as string;
        try {
          const config: mexc.MexcConfig = { apiKey, apiSecret, dryRun: process.env.DRY_RUN === 'true' };
          const result = await mexc.closePosition(config, symbol);
          if (!result) {
            return JSON.stringify({ error: `No open position for ${symbol}` });
          }
          // Log trade to database
          db.logMexcFuturesTrade({
            userId,
            orderId: result.orderId,
            symbol: result.symbol,
            side: result.side,
            vol: result.dealVol,
            price: result.dealAvgPrice || 0,
            timestamp: new Date(),
          });
          return JSON.stringify({ success: true, order: result });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'mexc_price': {
        const apiKey = process.env.MEXC_API_KEY;
        const apiSecret = process.env.MEXC_API_SECRET;
        if (!apiKey || !apiSecret) {
          return JSON.stringify({ error: 'Set MEXC_API_KEY and MEXC_API_SECRET' });
        }
        const symbol = toolInput.symbol as string;
        try {
          const config: mexc.MexcConfig = { apiKey, apiSecret };
          const price = await mexc.getPrice(config, symbol);
          return JSON.stringify({ symbol, price });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'mexc_funding': {
        const apiKey = process.env.MEXC_API_KEY;
        const apiSecret = process.env.MEXC_API_SECRET;
        if (!apiKey || !apiSecret) {
          return JSON.stringify({ error: 'Set MEXC_API_KEY and MEXC_API_SECRET' });
        }
        const symbol = toolInput.symbol as string;
        try {
          const config: mexc.MexcConfig = { apiKey, apiSecret };
          const funding = await mexc.getFundingRate(config, symbol);
          return JSON.stringify(funding);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Hyperliquid handlers — migrated to handlers/hyperliquid.ts

      // ============================================
      // SOLANA WALLET + AGGREGATORS (Jupiter + Pump.fun)
      // ============================================

      case 'solana_address': {
        try {
          const keypair = loadSolanaKeypair();
          return JSON.stringify({ address: keypair.publicKey.toBase58() });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_swap': {
        const inputMint = toolInput.input_mint as string;
        const outputMint = toolInput.output_mint as string;
        const amount = toolInput.amount as string;
        const slippageBps = toolInput.slippage_bps as number | undefined;
        const swapMode = toolInput.swap_mode as 'ExactIn' | 'ExactOut' | undefined;
        const priorityFeeLamports = toolInput.priority_fee_lamports as number | undefined;
        const onlyDirectRoutes = toolInput.only_direct_routes as boolean | undefined;

        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await executeJupiterSwap(connection, keypair, {
            inputMint,
            outputMint,
            amount,
            slippageBps,
            swapMode,
            priorityFeeLamports,
            onlyDirectRoutes,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({
            error: (err as Error).message,
            hint: 'Set SOLANA_PRIVATE_KEY or SOLANA_KEYPAIR_PATH and SOLANA_RPC_URL if needed.',
          });
        }
      }

      case 'solana_jupiter_quote': {
        const inputMint = toolInput.input_mint as string;
        const outputMint = toolInput.output_mint as string;
        const amount = toolInput.amount as string;
        const slippageBps = toolInput.slippage_bps as number | undefined;
        const swapMode = toolInput.swap_mode as 'ExactIn' | 'ExactOut' | undefined;
        try {
          const result = await getJupiterQuote({ inputMint, outputMint, amount, slippageBps, swapMode });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_limit_order_create': {
        const inputMint = toolInput.input_mint as string;
        const outputMint = toolInput.output_mint as string;
        const inAmount = toolInput.in_amount as string;
        const outAmount = toolInput.out_amount as string;
        const expiredAtMs = toolInput.expired_at_ms as number | undefined;
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await createJupiterLimitOrder(connection, keypair, {
            inputMint,
            outputMint,
            inAmount,
            outAmount,
            expiredAtMs,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_limit_order_cancel': {
        const orderPubkey = toolInput.order_pubkey as string;
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const signature = await cancelJupiterLimitOrder(connection, keypair, orderPubkey);
          return JSON.stringify({ success: true, signature });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_limit_orders_list': {
        const owner = toolInput.owner as string | undefined;
        const inputMint = toolInput.input_mint as string | undefined;
        const outputMint = toolInput.output_mint as string | undefined;
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const ownerAddress = owner || keypair.publicKey.toBase58();
          const orders = await listJupiterLimitOrdersByMint(connection, {
            owner: ownerAddress,
            inputMint,
            outputMint,
          });
          return JSON.stringify({ count: orders.length, orders });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_limit_order_get': {
        const orderPubkey = toolInput.order_pubkey as string;
        try {
          const connection = getSolanaConnection();
          const order = await getJupiterLimitOrder(connection, orderPubkey);
          return JSON.stringify(order || { error: 'Order not found' });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_limit_order_history': {
        const wallet = toolInput.wallet as string;
        const take = toolInput.take as number | undefined;
        try {
          const connection = getSolanaConnection();
          const history = await getJupiterLimitOrderHistory(connection, wallet, { take });
          return JSON.stringify({ count: history.length, history });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_trade_history': {
        const wallet = toolInput.wallet as string;
        const take = toolInput.take as number | undefined;
        try {
          const connection = getSolanaConnection();
          const history = await getJupiterTradeHistory(connection, wallet, { take });
          return JSON.stringify({ count: history.length, history });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_dca_create': {
        const inputMint = toolInput.input_mint as string;
        const outputMint = toolInput.output_mint as string;
        const inAmount = toolInput.in_amount as string;
        const inAmountPerCycle = toolInput.in_amount_per_cycle as string;
        const cycleSecondsApart = toolInput.cycle_seconds_apart as number;
        const minOutAmountPerCycle = toolInput.min_out_amount_per_cycle as string | undefined;
        const maxOutAmountPerCycle = toolInput.max_out_amount_per_cycle as string | undefined;
        const startAtMs = toolInput.start_at_ms as number | undefined;
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await createJupiterDCA(connection, keypair, {
            inputMint,
            outputMint,
            inAmount,
            inAmountPerCycle,
            cycleSecondsApart,
            minOutAmountPerCycle,
            maxOutAmountPerCycle,
            startAtMs,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_dca_close': {
        const dcaPubkey = toolInput.dca_pubkey as string;
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const signature = await closeJupiterDCA(connection, keypair, dcaPubkey);
          return JSON.stringify({ success: true, signature });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_dca_deposit': {
        const dcaPubkey = toolInput.dca_pubkey as string;
        const amount = toolInput.amount as string;
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const signature = await depositJupiterDCA(connection, keypair, dcaPubkey, amount);
          return JSON.stringify({ success: true, signature });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_dca_withdraw': {
        const dcaPubkey = toolInput.dca_pubkey as string;
        const withdrawInAmount = toolInput.withdraw_in_amount as string | undefined;
        const withdrawOutAmount = toolInput.withdraw_out_amount as string | undefined;
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const signature = await withdrawJupiterDCA(connection, keypair, dcaPubkey, {
            withdrawInAmount,
            withdrawOutAmount,
          });
          return JSON.stringify({ success: true, signature });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_dca_list': {
        const user = toolInput.user as string | undefined;
        const inputMint = toolInput.input_mint as string | undefined;
        const outputMint = toolInput.output_mint as string | undefined;
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const userAddress = user || keypair.publicKey.toBase58();
          const dcas = await listJupiterDCAs(connection, userAddress, { inputMint, outputMint });
          return JSON.stringify({ count: dcas.length, dcas });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_dca_get': {
        const dcaPubkey = toolInput.dca_pubkey as string;
        try {
          const connection = getSolanaConnection();
          const dca = await getJupiterDCA(connection, dcaPubkey);
          return JSON.stringify(dca || { error: 'DCA not found' });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_dca_balance': {
        const dcaPubkey = toolInput.dca_pubkey as string;
        try {
          const connection = getSolanaConnection();
          const balance = await getJupiterDCABalance(connection, dcaPubkey);
          return JSON.stringify(balance);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_jupiter_dca_fills': {
        const dcaPubkey = toolInput.dca_pubkey as string;
        try {
          const connection = getSolanaConnection();
          const fills = await getJupiterDCAFillHistory(connection, dcaPubkey);
          return JSON.stringify({ count: fills.length, fills });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'pumpfun_trade': {
        const action = toolInput.action as 'buy' | 'sell';
        const mint = toolInput.mint as string;
        const amountRaw = toolInput.amount as string;
        const denominatedInSol = toolInput.denominated_in_sol as boolean;
        const slippageBps = toolInput.slippage_bps as number | undefined;
        const priorityFeeLamports = toolInput.priority_fee_lamports as number | undefined;
        const pool = toolInput.pool as string | undefined;

        const amountValue = amountRaw?.trim();
        if (!amountValue) {
          return JSON.stringify({ error: 'amount is required' });
        }

        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await executePumpFunTrade(connection, keypair, {
            action,
            mint,
            amount: amountValue,
            denominatedInSol,
            slippageBps,
            priorityFeeLamports,
            pool,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({
            error: (err as Error).message,
            hint: 'Ensure PUMPFUN_LOCAL_TX_URL is reachable and SOLANA_PRIVATE_KEY is set.',
          });
        }
      }

      case 'pumpfun_bonding_curve': {
        try {
          const connection = getSolanaConnection();
          const state = await getBondingCurveState(connection, toolInput.mint as string);
          if (!state) {
            return JSON.stringify({ error: 'Bonding curve not found - token may not exist or has graduated' });
          }
          return JSON.stringify({
            virtualTokenReserves: state.virtualTokenReserves.toString(),
            virtualSolReserves: state.virtualSolReserves.toString(),
            realTokenReserves: state.realTokenReserves.toString(),
            realSolReserves: state.realSolReserves.toString(),
            tokenTotalSupply: state.tokenTotalSupply.toString(),
            complete: state.complete,
            isMayhemMode: state.isMayhemMode,
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'pumpfun_price_onchain': {
        try {
          const connection = getSolanaConnection();
          const priceInfo = await getTokenPriceInfo(
            connection,
            toolInput.mint as string,
            toolInput.sol_price_usd as number | undefined
          );
          if (!priceInfo) {
            return JSON.stringify({ error: 'Token not found on Pump.fun' });
          }
          return JSON.stringify(priceInfo);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'pumpfun_buy_quote': {
        try {
          const connection = getSolanaConnection();
          const state = await getBondingCurveState(connection, toolInput.mint as string);
          if (!state) {
            return JSON.stringify({ error: 'Bonding curve not found' });
          }
          if (state.complete) {
            return JSON.stringify({ error: 'Token has graduated to PumpSwap - use Jupiter for swaps' });
          }
          const BN = (await import('bn.js')).default;
          const solAmount = new BN(Math.floor((toolInput.sol_amount as number) * 1e9));
          const quote = calculateBuyQuote(state, solAmount, toolInput.fee_bps as number | undefined);
          return JSON.stringify({
            tokensOut: quote.tokensOut.toString(),
            tokensOutFormatted: (quote.tokensOut.toNumber() / 1e6).toFixed(2),
            solCost: quote.solCost.toString(),
            fee: quote.fee.toString(),
            feeFormatted: (quote.fee.toNumber() / 1e9).toFixed(6),
            priceImpact: quote.priceImpact.toFixed(4),
            newPrice: quote.newPrice,
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'pumpfun_sell_quote': {
        try {
          const connection = getSolanaConnection();
          const state = await getBondingCurveState(connection, toolInput.mint as string);
          if (!state) {
            return JSON.stringify({ error: 'Bonding curve not found' });
          }
          if (state.complete) {
            return JSON.stringify({ error: 'Token has graduated to PumpSwap - use Jupiter for swaps' });
          }
          const BN = (await import('bn.js')).default;
          const tokenAmount = new BN(Math.floor((toolInput.token_amount as number) * 1e6));
          const quote = calculateSellQuote(state, tokenAmount, toolInput.fee_bps as number | undefined);
          return JSON.stringify({
            solOut: quote.solOut.toString(),
            solOutFormatted: (quote.solOut.toNumber() / 1e9).toFixed(6),
            fee: quote.fee.toString(),
            feeFormatted: (quote.fee.toNumber() / 1e9).toFixed(6),
            priceImpact: quote.priceImpact.toFixed(4),
            newPrice: quote.newPrice,
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'pumpfun_graduation_check': {
        try {
          const connection = getSolanaConnection();
          const result = await isGraduated(connection, toolInput.mint as string);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'pumpfun_portal_quote': {
        try {
          const quote = await getPumpPortalQuote({
            mint: toolInput.mint as string,
            action: toolInput.action as 'buy' | 'sell',
            amount: toolInput.amount as string,
            pool: toolInput.pool as string | undefined,
          });
          if (!quote) {
            return JSON.stringify({ error: 'Quote not available' });
          }
          return JSON.stringify(quote);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'pumpfun_balance': {
        try {
          const connection = getSolanaConnection();
          const keypair = loadSolanaKeypair();
          const owner = (toolInput.owner as string) || keypair.publicKey.toBase58();
          const balance = await getTokenBalance(connection, owner, toolInput.mint as string);
          if (!balance) {
            return JSON.stringify({ balance: 0, balanceRaw: '0', decimals: 6 });
          }
          return JSON.stringify(balance);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'pumpfun_holdings': {
        try {
          const connection = getSolanaConnection();
          const keypair = loadSolanaKeypair();
          const owner = (toolInput.owner as string) || keypair.publicKey.toBase58();
          const holdings = await getUserPumpTokens(connection, owner);
          return JSON.stringify({ count: holdings.length, tokens: holdings });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'pumpfun_best_pool': {
        try {
          const connection = getSolanaConnection();
          const result = await getBestPool(connection, toolInput.mint as string);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_swap': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await executeMeteoraDlmmSwap(connection, keypair, {
            poolAddress: toolInput.pool_address as string,
            inputMint: toolInput.input_mint as string,
            outputMint: toolInput.output_mint as string,
            inAmount: toolInput.in_amount as string,
            slippageBps: toolInput.slippage_bps as number | undefined,
            allowPartialFill: toolInput.allow_partial_fill as boolean | undefined,
            maxExtraBinArrays: toolInput.max_extra_bin_arrays as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'raydium_swap': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await executeRaydiumSwap(connection, keypair, {
            inputMint: toolInput.input_mint as string,
            outputMint: toolInput.output_mint as string,
            amount: toolInput.amount as string,
            slippageBps: toolInput.slippage_bps as number | undefined,
            swapMode: toolInput.swap_mode as 'BaseIn' | 'BaseOut' | undefined,
            txVersion: toolInput.tx_version as 'V0' | 'LEGACY' | undefined,
            computeUnitPriceMicroLamports: toolInput.compute_unit_price_micro_lamports as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'orca_whirlpool_swap': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await executeOrcaWhirlpoolSwap(connection, keypair, {
            poolAddress: toolInput.pool_address as string,
            inputMint: toolInput.input_mint as string,
            amount: toolInput.amount as string,
            slippageBps: toolInput.slippage_bps as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_direct_place_order': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await executeDriftDirectOrder(connection, keypair, {
            marketType: toolInput.market_type as 'perp' | 'spot',
            marketIndex: toolInput.market_index as number,
            side: toolInput.side as 'buy' | 'sell',
            orderType: toolInput.order_type as 'limit' | 'market',
            baseAmount: toolInput.base_amount as string,
            price: toolInput.price as string | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_direct_cancel_order': {
        try {
          const { cancelDriftOrder } = await import('../solana/drift');
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await cancelDriftOrder(connection, keypair, {
            orderId: toolInput.order_id as number | undefined,
            marketIndex: toolInput.market_index as number | undefined,
            marketType: toolInput.market_type as 'perp' | 'spot' | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_direct_orders': {
        try {
          const { getDriftOrders } = await import('../solana/drift');
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await getDriftOrders(
            connection,
            keypair,
            toolInput.market_index as number | undefined,
            toolInput.market_type as 'perp' | 'spot' | undefined
          );
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_direct_positions': {
        try {
          const { getDriftPositions } = await import('../solana/drift');
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await getDriftPositions(
            connection,
            keypair,
            toolInput.market_index as number | undefined
          );
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_direct_balance': {
        try {
          const { getDriftBalance } = await import('../solana/drift');
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await getDriftBalance(connection, keypair);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_direct_modify_order': {
        try {
          const { modifyDriftOrder } = await import('../solana/drift');
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await modifyDriftOrder(connection, keypair, {
            orderId: toolInput.order_id as number,
            newPrice: toolInput.new_price as string | undefined,
            newBaseAmount: toolInput.new_base_amount as string | undefined,
            reduceOnly: toolInput.reduce_only as boolean | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_direct_set_leverage': {
        try {
          const { setDriftLeverage } = await import('../solana/drift');
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await setDriftLeverage(connection, keypair, {
            marketIndex: toolInput.market_index as number,
            leverage: toolInput.leverage as number,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_pools': {
        try {
          const connection = getSolanaConnection();
          const tokenMints = toolInput.token_mints as string[] | undefined;
          const tokenSymbols = toolInput.token_symbols as string[] | undefined;
          const limit = toolInput.limit as number | undefined;
          const resolvedMints = tokenMints && tokenMints.length > 0
            ? tokenMints
            : tokenSymbols && tokenSymbols.length > 0
              ? await (await import('../solana/tokenlist')).resolveTokenMints(tokenSymbols)
              : undefined;
          const result = await listMeteoraDlmmPools(connection, { tokenMints: resolvedMints, limit, includeLiquidity: true });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_quote': {
        try {
          const connection = getSolanaConnection();
          const result = await getMeteoraDlmmQuote(connection, {
            poolAddress: toolInput.pool_address as string,
            inputMint: toolInput.input_mint as string,
            inAmount: toolInput.in_amount as string,
            slippageBps: toolInput.slippage_bps as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'raydium_pools': {
        try {
          const tokenMints = toolInput.token_mints as string[] | undefined;
          const tokenSymbols = toolInput.token_symbols as string[] | undefined;
          const limit = toolInput.limit as number | undefined;
          const resolvedMints = tokenMints && tokenMints.length > 0
            ? tokenMints
            : tokenSymbols && tokenSymbols.length > 0
              ? await (await import('../solana/tokenlist')).resolveTokenMints(tokenSymbols)
              : undefined;
          const result = await listRaydiumPools({ tokenMints: resolvedMints, limit });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'raydium_quote': {
        try {
          const result = await getRaydiumQuote({
            inputMint: toolInput.input_mint as string,
            outputMint: toolInput.output_mint as string,
            amount: toolInput.amount as string,
            slippageBps: toolInput.slippage_bps as number | undefined,
            swapMode: toolInput.swap_mode as 'BaseIn' | 'BaseOut' | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Raydium CLMM (Concentrated Liquidity) Cases
      case 'raydium_clmm_positions': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const poolId = toolInput.pool_id as string | undefined;
          const result = await getClmmPositions(connection, keypair, poolId);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'raydium_clmm_create_position': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await createClmmPosition(connection, keypair, {
            poolId: toolInput.pool_id as string,
            priceLower: toolInput.price_lower as number,
            priceUpper: toolInput.price_upper as number,
            baseAmount: toolInput.base_amount as string,
            baseIn: toolInput.base_in as boolean | undefined,
            slippage: toolInput.slippage as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'raydium_clmm_increase_liquidity': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await increaseClmmLiquidity(connection, keypair, {
            poolId: toolInput.pool_id as string,
            positionNftMint: toolInput.position_nft_mint as string,
            amountA: toolInput.amount_a as string | undefined,
            amountB: toolInput.amount_b as string | undefined,
            slippage: toolInput.slippage as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'raydium_clmm_decrease_liquidity': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await decreaseClmmLiquidity(connection, keypair, {
            poolId: toolInput.pool_id as string,
            positionNftMint: toolInput.position_nft_mint as string,
            liquidity: toolInput.liquidity as string | undefined,
            percentBps: toolInput.percent_bps as number | undefined,
            closePosition: toolInput.close_position as boolean | undefined,
            slippage: toolInput.slippage as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'raydium_clmm_close_position': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await closeClmmPosition(
            connection,
            keypair,
            toolInput.pool_id as string,
            toolInput.position_nft_mint as string
          );
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'raydium_clmm_harvest': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const poolId = toolInput.pool_id as string | undefined;
          const result = await harvestClmmRewards(connection, keypair, poolId);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'raydium_clmm_swap': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await swapClmm(connection, keypair, {
            poolId: toolInput.pool_id as string,
            inputMint: toolInput.input_mint as string,
            amountIn: toolInput.amount_in as string,
            slippage: toolInput.slippage as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Raydium AMM (V4) Liquidity Cases
      case 'raydium_amm_add_liquidity': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await addAmmLiquidity(connection, keypair, {
            poolId: toolInput.pool_id as string,
            amountA: toolInput.amount_a as string | undefined,
            amountB: toolInput.amount_b as string | undefined,
            fixedSide: toolInput.fixed_side as 'a' | 'b' | undefined,
            slippage: toolInput.slippage as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'raydium_amm_remove_liquidity': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await removeAmmLiquidity(connection, keypair, {
            poolId: toolInput.pool_id as string,
            lpAmount: toolInput.lp_amount as string,
            slippage: toolInput.slippage as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'raydium_clmm_create_pool': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await createClmmPool(connection, keypair, {
            mintA: toolInput.mint_a as string,
            mintB: toolInput.mint_b as string,
            initialPrice: toolInput.initial_price as number,
            configIndex: toolInput.config_index as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'raydium_clmm_configs': {
        try {
          const connection = getSolanaConnection();
          const result = await getClmmConfigs(connection);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'orca_whirlpool_pools': {
        try {
          const tokenMints = toolInput.token_mints as string[] | undefined;
          const tokenSymbols = toolInput.token_symbols as string[] | undefined;
          const limit = toolInput.limit as number | undefined;
          const resolvedMints = tokenMints && tokenMints.length > 0
            ? tokenMints
            : tokenSymbols && tokenSymbols.length > 0
              ? await (await import('../solana/tokenlist')).resolveTokenMints(tokenSymbols)
              : undefined;
          const result = await listOrcaWhirlpoolPools({ tokenMints: resolvedMints, limit });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'orca_whirlpool_quote': {
        try {
          const result = await getOrcaWhirlpoolQuote({
            poolAddress: toolInput.pool_address as string,
            inputMint: toolInput.input_mint as string,
            amount: toolInput.amount as string,
            slippageBps: toolInput.slippage_bps as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Orca LP Management Cases
      case 'orca_open_full_range_position': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await openOrcaFullRangePosition(connection, keypair, {
            poolAddress: toolInput.pool_address as string,
            tokenAmountA: toolInput.token_amount_a as string,
            tokenAmountB: toolInput.token_amount_b as string | undefined,
            slippageBps: toolInput.slippage_bps as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'orca_open_concentrated_position': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await openOrcaConcentratedPosition(connection, keypair, {
            poolAddress: toolInput.pool_address as string,
            tokenAmountA: toolInput.token_amount_a as string,
            tokenAmountB: toolInput.token_amount_b as string | undefined,
            tickLowerIndex: toolInput.tick_lower_index as number,
            tickUpperIndex: toolInput.tick_upper_index as number,
            slippageBps: toolInput.slippage_bps as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'orca_fetch_positions': {
        try {
          const connection = getSolanaConnection();
          const ownerAddress = (toolInput.owner_address as string) || loadSolanaKeypair().publicKey.toBase58();
          const result = await fetchOrcaPositionsForOwner(connection, ownerAddress);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'orca_increase_liquidity': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await increaseOrcaLiquidity(connection, keypair, {
            positionAddress: toolInput.position_address as string,
            tokenAmountA: toolInput.token_amount_a as string | undefined,
            tokenAmountB: toolInput.token_amount_b as string | undefined,
            liquidityAmount: toolInput.liquidity_amount as string | undefined,
            slippageBps: toolInput.slippage_bps as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'orca_decrease_liquidity': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await decreaseOrcaLiquidity(connection, keypair, {
            positionAddress: toolInput.position_address as string,
            tokenAmountA: toolInput.token_amount_a as string | undefined,
            tokenAmountB: toolInput.token_amount_b as string | undefined,
            liquidityAmount: toolInput.liquidity_amount as string | undefined,
            slippageBps: toolInput.slippage_bps as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'orca_harvest_position': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await harvestOrcaPosition(connection, keypair, toolInput.position_address as string);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'orca_close_position': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await closeOrcaPosition(connection, keypair, toolInput.position_address as string);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'orca_create_pool': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const poolType = (toolInput.pool_type as string) || 'splash';
          const result = poolType === 'concentrated'
            ? await createOrcaConcentratedLiquidityPool(connection, keypair, {
                tokenMintA: toolInput.token_mint_a as string,
                tokenMintB: toolInput.token_mint_b as string,
                tickSpacing: toolInput.tick_spacing as number | undefined,
                initialPrice: toolInput.initial_price as number | undefined,
              })
            : await createOrcaSplashPool(connection, keypair, {
                tokenMintA: toolInput.token_mint_a as string,
                tokenMintB: toolInput.token_mint_b as string,
                initialPrice: toolInput.initial_price as number | undefined,
              });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'orca_fetch_positions_in_pool': {
        try {
          const connection = getSolanaConnection();
          const result = await fetchOrcaPositionsInWhirlpool(connection, toolInput.pool_address as string);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'orca_find_pools_by_pair': {
        try {
          const connection = getSolanaConnection();
          const result = await fetchOrcaWhirlpoolsByTokenPair(
            connection,
            toolInput.token_mint_a as string,
            toolInput.token_mint_b as string
          );
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'orca_harvest_all_positions': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await harvestAllOrcaPositionFees(
            connection,
            keypair,
            toolInput.position_addresses as string[]
          );
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Meteora LP Management Cases
      case 'meteora_dlmm_quote_exact_out': {
        try {
          const connection = getSolanaConnection();
          const result = await getMeteoraDlmmQuoteExactOut(connection, {
            poolAddress: toolInput.pool_address as string,
            outputMint: toolInput.output_mint as string,
            outAmount: toolInput.out_amount as string,
            slippageBps: toolInput.slippage_bps as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_swap_exact_out': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await executeMeteoraDlmmSwapExactOut(connection, keypair, {
            poolAddress: toolInput.pool_address as string,
            inputMint: toolInput.input_mint as string,
            outputMint: toolInput.output_mint as string,
            inAmount: '0', // Will be calculated from outAmount
            outAmount: toolInput.out_amount as string,
            slippageBps: toolInput.slippage_bps as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_open_position': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await initializeMeteoraDlmmPosition(connection, keypair, {
            poolAddress: toolInput.pool_address as string,
            totalXAmount: toolInput.total_x_amount as string,
            totalYAmount: toolInput.total_y_amount as string,
            strategyType: toolInput.strategy_type as 'Spot' | 'BidAsk' | 'Curve' | undefined,
            minBinId: toolInput.min_bin_id as number | undefined,
            maxBinId: toolInput.max_bin_id as number | undefined,
            slippageBps: toolInput.slippage_bps as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_fetch_positions': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const userAddress = (toolInput.user_address as string) || keypair.publicKey.toBase58();
          const poolAddress = toolInput.pool_address as string | undefined;
          const result = poolAddress
            ? await getMeteoraDlmmPositionsByUser(connection, poolAddress, userAddress)
            : await getAllMeteoraDlmmPositionsByUser(connection, userAddress);
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_add_liquidity': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await addMeteoraDlmmLiquidity(connection, keypair, {
            poolAddress: toolInput.pool_address as string,
            positionAddress: toolInput.position_address as string,
            totalXAmount: toolInput.total_x_amount as string | undefined,
            totalYAmount: toolInput.total_y_amount as string | undefined,
            strategyType: toolInput.strategy_type as 'Spot' | 'BidAsk' | 'Curve' | undefined,
            slippageBps: toolInput.slippage_bps as number | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_remove_liquidity': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await removeMeteoraDlmmLiquidity(connection, keypair, {
            poolAddress: toolInput.pool_address as string,
            positionAddress: toolInput.position_address as string,
            fromBinId: toolInput.from_bin_id as number,
            toBinId: toolInput.to_bin_id as number,
            bps: toolInput.bps as number,
            shouldClaimAndClose: toolInput.should_claim_and_close as boolean | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_close_position': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await closeMeteoraDlmmPosition(
            connection,
            keypair,
            toolInput.pool_address as string,
            toolInput.position_address as string
          );
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_claim_fees': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await claimMeteoraDlmmSwapFee(
            connection,
            keypair,
            toolInput.pool_address as string,
            toolInput.position_address as string
          );
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_claim_rewards': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await claimMeteoraDlmmLMReward(
            connection,
            keypair,
            toolInput.pool_address as string,
            toolInput.position_address as string
          );
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_claim_all': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await claimAllMeteoraDlmmRewards(
            connection,
            keypair,
            toolInput.pool_address as string,
            toolInput.position_address as string
          );
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_pool_info': {
        try {
          const connection = getSolanaConnection();
          const poolAddress = toolInput.pool_address as string;
          const infoType = (toolInput.info_type as string) || 'all';
          const result: Record<string, unknown> = {};

          if (infoType === 'active_bin' || infoType === 'all') {
            result.activeBin = await getMeteoraDlmmActiveBin(connection, poolAddress);
          }
          if (infoType === 'fee_info' || infoType === 'all') {
            result.feeInfo = await getMeteoraDlmmFeeInfo(connection, poolAddress);
          }
          if (infoType === 'dynamic_fee' || infoType === 'all') {
            result.dynamicFee = await getMeteoraDlmmDynamicFee(connection, poolAddress);
          }
          if (infoType === 'emission_rate' || infoType === 'all') {
            result.emissionRate = await getMeteoraDlmmEmissionRate(connection, poolAddress);
          }

          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_create_pool': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const customizable = toolInput.customizable as boolean | undefined;
          const result = customizable
            ? await createCustomizableMeteoraDlmmPool(connection, keypair, {
                tokenX: toolInput.token_x as string,
                tokenY: toolInput.token_y as string,
                binStep: toolInput.bin_step as number,
                activeId: toolInput.active_id as number | undefined,
                feeBps: toolInput.fee_bps as number | undefined,
              })
            : await createMeteoraDlmmPool(connection, keypair, {
                tokenX: toolInput.token_x as string,
                tokenY: toolInput.token_y as string,
                binStep: toolInput.bin_step as number,
                activeId: toolInput.active_id as number | undefined,
              });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_create_empty_position': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await createEmptyMeteoraDlmmPosition(connection, keypair, {
            poolAddress: toolInput.pool_address as string,
            minBinId: toolInput.min_bin_id as number,
            maxBinId: toolInput.max_bin_id as number,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_swap_with_price_impact': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await executeMeteoraDlmmSwapWithPriceImpact(connection, keypair, {
            poolAddress: toolInput.pool_address as string,
            inputMint: toolInput.input_mint as string,
            outputMint: toolInput.output_mint as string,
            inAmount: toolInput.in_amount as string,
            maxPriceImpactBps: toolInput.max_price_impact_bps as number,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'meteora_dlmm_claim_all_fees': {
        try {
          const keypair = loadSolanaKeypair();
          const connection = getSolanaConnection();
          const result = await claimAllMeteoraDlmmSwapFees(
            connection,
            keypair,
            toolInput.pool_address as string,
            toolInput.position_addresses as string[]
          );
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_best_pool': {
        try {
          const connection = getSolanaConnection();
          const tokenMints = toolInput.token_mints as string[] | undefined;
          const tokenSymbols = toolInput.token_symbols as string[] | undefined;
          const limit = toolInput.limit as number | undefined;
          const sortBy = toolInput.sort_by as 'liquidity' | 'volume24h' | undefined;
          const preferredDexes = toolInput.preferred_dexes as Array<'meteora' | 'raydium' | 'orca'> | undefined;

          const result = await selectBestPool(connection, {
            tokenMints,
            tokenSymbols,
            limit,
            sortBy,
            preferredDexes,
          });

          return JSON.stringify(result ?? { error: 'No matching pools found' });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_auto_swap': {
        try {
          const amount = toolInput.amount as string;
          const slippageBps = toolInput.slippage_bps as number | undefined;
          const sortBy = toolInput.sort_by as 'liquidity' | 'volume24h' | undefined;
          const preferredDexes = toolInput.preferred_dexes as Array<'meteora' | 'raydium' | 'orca'> | undefined;

          const inputMint = toolInput.input_mint as string | undefined;
          const outputMint = toolInput.output_mint as string | undefined;
          const tokenSymbols = toolInput.token_symbols as string[] | undefined;

          const connection = getSolanaConnection();
          const keypair = loadSolanaKeypair();

          const resolvedMints = inputMint && outputMint
            ? [inputMint, outputMint]
            : tokenSymbols && tokenSymbols.length >= 2
              ? await (await import('../solana/tokenlist')).resolveTokenMints(tokenSymbols.slice(0, 2))
              : [];

          if (resolvedMints.length < 2) {
            return JSON.stringify({ error: 'Provide input_mint/output_mint or token_symbols with 2 entries.' });
          }

          const { pool } = await selectBestPoolWithResolvedMints(connection, {
            tokenMints: resolvedMints,
            sortBy,
            preferredDexes,
          });

          if (!pool) {
            return JSON.stringify({ error: 'No matching pools found.' });
          }

          if (pool.dex === 'meteora') {
            const result = await executeMeteoraDlmmSwap(connection, keypair, {
              poolAddress: pool.address,
              inputMint: resolvedMints[0],
              outputMint: resolvedMints[1],
              inAmount: amount,
              slippageBps,
            });
            return JSON.stringify({ dex: pool.dex, pool, result });
          }

          if (pool.dex === 'raydium') {
            const result = await executeRaydiumSwap(connection, keypair, {
              inputMint: resolvedMints[0],
              outputMint: resolvedMints[1],
              amount,
              slippageBps,
            });
            return JSON.stringify({ dex: pool.dex, pool, result });
          }

          if (pool.dex === 'orca') {
            const result = await executeOrcaWhirlpoolSwap(connection, keypair, {
              poolAddress: pool.address,
              inputMint: resolvedMints[0],
              amount,
              slippageBps,
            });
            return JSON.stringify({ dex: pool.dex, pool, result });
          }

          return JSON.stringify({ error: 'Unsupported pool type' });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_auto_route': {
        try {
          const connection = getSolanaConnection();
          const tokenMints = toolInput.token_mints as string[] | undefined;
          const tokenSymbols = toolInput.token_symbols as string[] | undefined;
          const sortBy = toolInput.sort_by as 'liquidity' | 'volume24h' | undefined;
          const preferredDexes = toolInput.preferred_dexes as Array<'meteora' | 'raydium' | 'orca'> | undefined;
          const limit = toolInput.limit as number | undefined;

          const { listAllPools } = await import('../solana/pools');
          const pools = await listAllPools(connection, {
            tokenMints,
            tokenSymbols,
            sortBy,
            preferredDexes,
            limit: limit ?? 20,
          });

          return JSON.stringify(pools);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'solana_auto_quote': {
        try {
          const connection = getSolanaConnection();
          const tokenMints = toolInput.token_mints as string[] | undefined;
          const tokenSymbols = toolInput.token_symbols as string[] | undefined;
          const amount = toolInput.amount as string;
          const slippageBps = toolInput.slippage_bps as number | undefined;
          const sortBy = toolInput.sort_by as 'liquidity' | 'volume24h' | undefined;
          const preferredDexes = toolInput.preferred_dexes as Array<'meteora' | 'raydium' | 'orca'> | undefined;

          const { listAllPools } = await import('../solana/pools');
          const pools = await listAllPools(connection, {
            tokenMints,
            tokenSymbols,
            sortBy,
            preferredDexes,
            limit: 30,
          });

          const perDex = new Map<string, typeof pools>();
          for (const pool of pools) {
            const list = perDex.get(pool.dex) || [];
            list.push(pool);
            perDex.set(pool.dex, list);
          }

          const results: Array<Record<string, unknown>> = [];
          for (const [dex, list] of perDex.entries()) {
            const pool = list[0];
            if (!pool) continue;

            try {
              if (dex === 'meteora') {
                const quote = await getMeteoraDlmmQuote(connection, {
                  poolAddress: pool.address,
                  inputMint: pool.tokenMintA,
                  inAmount: amount,
                  slippageBps,
                });
                results.push({ dex, pool, quote });
              } else if (dex === 'raydium') {
                const quote = await getRaydiumQuote({
                  inputMint: pool.tokenMintA,
                  outputMint: pool.tokenMintB,
                  amount,
                  slippageBps,
                });
                results.push({ dex, pool, quote });
              } else if (dex === 'orca') {
                const quote = await getOrcaWhirlpoolQuote({
                  poolAddress: pool.address,
                  inputMint: pool.tokenMintA,
                  amount,
                  slippageBps,
                });
                results.push({ dex, pool, quote });
              }
            } catch (err: unknown) {
              results.push({ dex, pool, error: (err as Error).message });
            }
          }

          return JSON.stringify(results);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // EVM DEX TRADING HANDLERS
      // ============================================

      case 'evm_swap': {
        const chain = (toolInput.chain as string) || 'ethereum';
        const inputToken = toolInput.input_token as string;
        const outputToken = toolInput.output_token as string;
        const amount = toolInput.amount as string;
        const slippageBps = (toolInput.slippage_bps as number) || 50;
        const dex = (toolInput.dex as string) || 'auto';

        try {
          // Dynamic import to avoid loading if not needed
          const { executeUniswapSwap, executeOneInchSwap, compareDexRoutes } = await import('../evm');

          if (dex === 'auto') {
            // Compare routes and use best one
            const comparison = await compareDexRoutes({
              chain: toEvmChain(chain),
              fromToken: inputToken,
              toToken: outputToken,
              amount,
            });

            if (comparison.best === 'uniswap' && comparison.uniswapQuote) {
              const result = await executeUniswapSwap({
                chain: toEvmChain(chain),
                inputToken,
                outputToken,
                amount,
                slippageBps,
              });
              return JSON.stringify({ ...result, routedVia: 'uniswap', comparison });
            } else if (comparison.oneInchQuote) {
              const result = await executeOneInchSwap({
                chain: toEvmChain(chain),
                fromToken: inputToken,
                toToken: outputToken,
                amount,
                slippageBps,
              });
              return JSON.stringify({ ...result, routedVia: '1inch', comparison });
            }
          } else if (dex === 'uniswap') {
            const result = await executeUniswapSwap({
              chain: toEvmChain(chain),
              inputToken,
              outputToken,
              amount,
              slippageBps,
            });
            return JSON.stringify(result);
          } else if (dex === '1inch') {
            const result = await executeOneInchSwap({
              chain: toEvmChain(chain),
              fromToken: inputToken,
              toToken: outputToken,
              amount,
              slippageBps,
            });
            return JSON.stringify(result);
          }

          return JSON.stringify({ error: 'Invalid DEX specified' });
        } catch (err: unknown) {
          return JSON.stringify({
            error: (err as Error).message,
            hint: 'Set ETHEREUM_PRIVATE_KEY and chain-specific RPC URLs (ETHEREUM_RPC_URL, etc.)',
          });
        }
      }

      case 'evm_quote': {
        const chain = (toolInput.chain as string) || 'ethereum';
        const inputToken = toolInput.input_token as string;
        const outputToken = toolInput.output_token as string;
        const amount = toolInput.amount as string;

        try {
          const { compareDexRoutes } = await import('../evm');
          const comparison = await compareDexRoutes({
            chain: toEvmChain(chain),
            fromToken: inputToken,
            toToken: outputToken,
            amount,
          });
          return JSON.stringify(comparison);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'evm_balance': {
        const chain = (toolInput.chain as string) || 'ethereum';
        const tokens = (toolInput.tokens as string[]) || ['ETH', 'USDC', 'WETH'];

        try {
          const { getEvmBalance } = await import('../evm');
          const balances: Record<string, string> = {};
          for (const token of tokens) {
            try {
              const balance = await getEvmBalance(token, toEvmChain(chain));
              balances[token] = balance;
            } catch {
              balances[token] = 'error';
            }
          }
          return JSON.stringify({ chain, balances });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'wormhole_quote': {
        try {
          const result = await wormholeQuote({
            network: toolInput.network as string | undefined,
            protocol: toolInput.protocol as 'token_bridge' | 'cctp' | undefined,
            source_chain: toolInput.source_chain as string,
            destination_chain: toolInput.destination_chain as string,
            source_address: toolInput.source_address as string | undefined,
            destination_address: toolInput.destination_address as string,
            token_address: toolInput.token_address as string | undefined,
            amount: toolInput.amount as string,
            amount_units: toolInput.amount_units as 'human' | 'atomic' | undefined,
            automatic: toolInput.automatic as boolean | undefined,
            payload_base64: toolInput.payload_base64 as string | undefined,
            destination_native_gas: toolInput.destination_native_gas as string | undefined,
            destination_native_gas_units: toolInput.destination_native_gas_units as 'human' | 'atomic' | undefined,
            source_rpc_url: toolInput.source_rpc_url as string | undefined,
            destination_rpc_url: toolInput.destination_rpc_url as string | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'wormhole_bridge': {
        try {
          const result = await wormholeBridge({
            network: toolInput.network as string | undefined,
            protocol: toolInput.protocol as 'token_bridge' | 'cctp' | undefined,
            source_chain: toolInput.source_chain as string,
            destination_chain: toolInput.destination_chain as string,
            destination_address: toolInput.destination_address as string,
            token_address: toolInput.token_address as string | undefined,
            amount: toolInput.amount as string,
            amount_units: toolInput.amount_units as 'human' | 'atomic' | undefined,
            automatic: toolInput.automatic as boolean | undefined,
            payload_base64: toolInput.payload_base64 as string | undefined,
            destination_native_gas: toolInput.destination_native_gas as string | undefined,
            destination_native_gas_units: toolInput.destination_native_gas_units as 'human' | 'atomic' | undefined,
            attest_timeout_ms: toolInput.attest_timeout_ms as number | undefined,
            skip_redeem: toolInput.skip_redeem as boolean | undefined,
            source_rpc_url: toolInput.source_rpc_url as string | undefined,
            destination_rpc_url: toolInput.destination_rpc_url as string | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({
            error: (err as Error).message,
            hint: 'Ensure RPC URLs and private keys are set for source/destination chains.',
          });
        }
      }

      case 'wormhole_redeem': {
        try {
          const result = await wormholeRedeem({
            network: toolInput.network as string | undefined,
            protocol: toolInput.protocol as 'token_bridge' | 'cctp' | undefined,
            source_chain: toolInput.source_chain as string,
            destination_chain: toolInput.destination_chain as string,
            source_txid: toolInput.source_txid as string,
            attest_timeout_ms: toolInput.attest_timeout_ms as number | undefined,
            source_rpc_url: toolInput.source_rpc_url as string | undefined,
            destination_rpc_url: toolInput.destination_rpc_url as string | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({
            error: (err as Error).message,
            hint: 'Ensure RPC URLs and destination private key are set for the target chain.',
          });
        }
      }

      case 'usdc_quote': {
        try {
          const result = await wormholeQuote({
            network: toolInput.network as string | undefined,
            protocol: 'cctp',
            source_chain: toolInput.source_chain as string,
            destination_chain: toolInput.destination_chain as string,
            source_address: toolInput.source_address as string | undefined,
            destination_address: toolInput.destination_address as string,
            amount: toolInput.amount as string,
            amount_units: toolInput.amount_units as 'human' | 'atomic' | undefined,
            automatic: toolInput.automatic as boolean | undefined,
            payload_base64: toolInput.payload_base64 as string | undefined,
            destination_native_gas: toolInput.destination_native_gas as string | undefined,
            destination_native_gas_units: toolInput.destination_native_gas_units as 'human' | 'atomic' | undefined,
            source_rpc_url: toolInput.source_rpc_url as string | undefined,
            destination_rpc_url: toolInput.destination_rpc_url as string | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'usdc_quote_auto': {
        try {
          const result = await usdcQuoteAuto({
            network: toolInput.network as string | undefined,
            source_chain: toolInput.source_chain as string,
            destination_chain: toolInput.destination_chain as string,
            source_address: toolInput.source_address as string | undefined,
            destination_address: toolInput.destination_address as string,
            token_address: toolInput.token_address as string | undefined,
            amount: toolInput.amount as string,
            amount_units: toolInput.amount_units as 'human' | 'atomic' | undefined,
            automatic: toolInput.automatic as boolean | undefined,
            payload_base64: toolInput.payload_base64 as string | undefined,
            destination_native_gas: toolInput.destination_native_gas as string | undefined,
            destination_native_gas_units: toolInput.destination_native_gas_units as 'human' | 'atomic' | undefined,
            source_rpc_url: toolInput.source_rpc_url as string | undefined,
            destination_rpc_url: toolInput.destination_rpc_url as string | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({
            error: (err as Error).message,
            hint: 'If CCTP is unsupported for this route, pass token_address for Token Bridge fallback.',
          });
        }
      }

      case 'usdc_bridge': {
        try {
          const result = await wormholeBridge({
            network: toolInput.network as string | undefined,
            protocol: 'cctp',
            source_chain: toolInput.source_chain as string,
            destination_chain: toolInput.destination_chain as string,
            destination_address: toolInput.destination_address as string,
            amount: toolInput.amount as string,
            amount_units: toolInput.amount_units as 'human' | 'atomic' | undefined,
            automatic: toolInput.automatic as boolean | undefined,
            payload_base64: toolInput.payload_base64 as string | undefined,
            destination_native_gas: toolInput.destination_native_gas as string | undefined,
            destination_native_gas_units: toolInput.destination_native_gas_units as 'human' | 'atomic' | undefined,
            attest_timeout_ms: toolInput.attest_timeout_ms as number | undefined,
            skip_redeem: toolInput.skip_redeem as boolean | undefined,
            source_rpc_url: toolInput.source_rpc_url as string | undefined,
            destination_rpc_url: toolInput.destination_rpc_url as string | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({
            error: (err as Error).message,
            hint: 'Ensure RPC URLs and private keys are set for source/destination chains.',
          });
        }
      }

      case 'usdc_bridge_auto': {
        try {
          const result = await usdcBridgeAuto({
            network: toolInput.network as string | undefined,
            source_chain: toolInput.source_chain as string,
            destination_chain: toolInput.destination_chain as string,
            destination_address: toolInput.destination_address as string,
            token_address: toolInput.token_address as string | undefined,
            amount: toolInput.amount as string,
            amount_units: toolInput.amount_units as 'human' | 'atomic' | undefined,
            automatic: toolInput.automatic as boolean | undefined,
            payload_base64: toolInput.payload_base64 as string | undefined,
            destination_native_gas: toolInput.destination_native_gas as string | undefined,
            destination_native_gas_units: toolInput.destination_native_gas_units as 'human' | 'atomic' | undefined,
            attest_timeout_ms: toolInput.attest_timeout_ms as number | undefined,
            skip_redeem: toolInput.skip_redeem as boolean | undefined,
            source_rpc_url: toolInput.source_rpc_url as string | undefined,
            destination_rpc_url: toolInput.destination_rpc_url as string | undefined,
          });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return JSON.stringify({
            error: (err as Error).message,
            hint: 'If CCTP is unsupported for this route, pass token_address for Token Bridge fallback.',
          });
        }
      }

      // ============================================
      // METACULUS HANDLERS (Forecasting - requires token)
      // ============================================

      case 'metaculus_submit_prediction': {
        const questionId = toolInput.question_id as number;
        const prediction = toolInput.prediction as number;
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus prediction requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        try {
          const response = await fetch(`https://www.metaculus.com/api2/questions/${questionId}/predict/`, {
            method: 'POST',
            headers: {
              'Authorization': `Token ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prediction }),
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify({ success: true, questionId, prediction });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_my_predictions': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        const limit = (toolInput.limit as number) || 50;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/questions/?forecast_type=made&limit=${limit}`, {
            headers: { 'Authorization': `Token ${token}` },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Metaculus - Additional handlers for comprehensive API coverage
      case 'metaculus_bulk_predict': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        const predictions = toolInput.predictions as Array<{ question_id: number; prediction: number }>;
        try {
          const response = await fetch('https://www.metaculus.com/api2/questions/bulk-predict/', {
            method: 'POST',
            headers: {
              'Authorization': `Token ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ predictions }),
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_prediction_history': {
        const questionId = toolInput.question_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/questions/${questionId}/prediction-history/`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_categories': {
        try {
          const response = await fetch('https://www.metaculus.com/api2/categories/');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_category': {
        const categoryId = toolInput.category_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/categories/${categoryId}/`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_comments': {
        const questionId = toolInput.question_id as number;
        const limit = (toolInput.limit as number) || 50;
        try {
          let url = `https://www.metaculus.com/api2/comments/?limit=${limit}`;
          if (questionId) url += `&question=${questionId}`;
          const response = await fetch(url);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_post_comment': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        const questionId = toolInput.question_id as number;
        const comment = toolInput.comment as string;
        const parentId = toolInput.parent_id as number;
        try {
          const body: { question: number; comment_text: string; parent?: number } = {
            question: questionId,
            comment_text: comment,
          };
          if (parentId) body.parent = parentId;
          const response = await fetch('https://www.metaculus.com/api2/comments/', {
            method: 'POST',
            headers: {
              'Authorization': `Token ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_projects': {
        const limit = (toolInput.limit as number) || 50;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/projects/?limit=${limit}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_project': {
        const projectId = toolInput.project_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/projects/${projectId}/`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_project_questions': {
        const projectId = toolInput.project_id as number;
        const status = toolInput.status as string;
        try {
          let url = `https://www.metaculus.com/api2/questions/?project=${projectId}`;
          if (status) url += `&status=${status}`;
          const response = await fetch(url);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_join_project': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        const projectId = toolInput.project_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/projects/${projectId}/join/`, {
            method: 'POST',
            headers: { 'Authorization': `Token ${token}` },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify({ success: true, projectId });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_notifications': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        try {
          const response = await fetch('https://www.metaculus.com/api2/notifications/', {
            headers: { 'Authorization': `Token ${token}` },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_mark_notifications_read': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        try {
          const response = await fetch('https://www.metaculus.com/api2/notifications/mark_read/', {
            method: 'POST',
            headers: { 'Authorization': `Token ${token}` },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify({ success: true });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_user_profile': {
        const userId = toolInput.user_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/user-profiles/${userId}/`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_user_stats': {
        const userId = toolInput.user_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/users/${userId}/`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_leaderboard': {
        const projectId = toolInput.project_id as number;
        const limit = (toolInput.limit as number) || 50;
        try {
          let url = `https://www.metaculus.com/api2/rankings/?limit=${limit}`;
          if (projectId) url = `https://www.metaculus.com/api2/projects/${projectId}/personal-stats/`;
          const response = await fetch(url);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_create_question': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        try {
          const response = await fetch('https://www.metaculus.com/api2/questions/', {
            method: 'POST',
            headers: {
              'Authorization': `Token ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: toolInput.title,
              description: toolInput.description,
              resolution_criteria: toolInput.resolution_criteria,
              type: toolInput.type,
              scheduled_close_time: toolInput.close_time,
              scheduled_resolve_time: toolInput.resolve_time,
              project: toolInput.project_id,
            }),
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_about_numbers': {
        try {
          const response = await fetch('https://www.metaculus.com/api2/about-numbers/');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_question_summaries': {
        const questionId = toolInput.question_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/question-summaries/${questionId}/`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_vote': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        const questionId = toolInput.question_id as number;
        const direction = toolInput.direction as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/questions/${questionId}/vote/`, {
            method: 'POST',
            headers: {
              'Authorization': `Token ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ direction }),
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify({ success: true, questionId, direction });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // QMD (MARKDOWN SEARCH)
      // ============================================

      case 'qmd_search': {
        const query = toolInput.query as string;
        const mode = (toolInput.mode as string) || 'search';
        if (!['search', 'vsearch', 'query'].includes(mode)) {
          return JSON.stringify({ error: 'Invalid qmd mode. Use search, vsearch, or query.' });
        }

        const collection = toolInput.collection as string | undefined;
        const limit = toolInput.limit as number | undefined;
        const json = toolInput.json as boolean | undefined;
        const files = toolInput.files as boolean | undefined;
        const all = toolInput.all as boolean | undefined;
        const full = toolInput.full as boolean | undefined;
        const minScore = toolInput.min_score as number | undefined;
        const timeoutMs = (toolInput.timeout_ms as number)
          ?? (mode === 'search' ? 30_000 : 180_000);

        const args = [mode, query];
        if (collection) args.push('-c', collection);
        if (typeof limit === 'number') args.push('-n', String(limit));
        if (json) args.push('--json');
        if (files) args.push('--files');
        if (all) args.push('--all');
        if (full) args.push('--full');
        if (typeof minScore === 'number') args.push('--min-score', String(minScore));

        const result = runQmdCommand(args, timeoutMs);
        return formatQmdResult(result, Boolean(json || files));
      }

      case 'qmd_get': {
        const target = toolInput.target as string;
        const json = toolInput.json as boolean | undefined;
        const full = toolInput.full as boolean | undefined;
        const timeoutMs = (toolInput.timeout_ms as number) ?? 30_000;

        const args = ['get', target];
        if (json) args.push('--json');
        if (full) args.push('--full');

        const result = runQmdCommand(args, timeoutMs);
        return formatQmdResult(result, Boolean(json));
      }

      case 'qmd_multi_get': {
        const targets = toolInput.targets as string[];
        if (!Array.isArray(targets) || targets.length === 0) {
          return JSON.stringify({ error: 'targets must be a non-empty array' });
        }
        const json = toolInput.json as boolean | undefined;
        const timeoutMs = (toolInput.timeout_ms as number) ?? 60_000;

        const args = ['multi-get', targets.join(', ')];
        if (json) args.push('--json');

        const result = runQmdCommand(args, timeoutMs);
        return formatQmdResult(result, Boolean(json));
      }

      case 'qmd_status': {
        const result = runQmdCommand(['status'], 30_000);
        return formatQmdResult(result, true);
      }

      case 'qmd_update': {
        const timeoutMs = (toolInput.timeout_ms as number) ?? 120_000;
        const result = runQmdCommand(['update'], timeoutMs);
        return formatQmdResult(result, false);
      }

      case 'qmd_embed': {
        const timeoutMs = (toolInput.timeout_ms as number) ?? 300_000;
        const result = runQmdCommand(['embed'], timeoutMs);
        return formatQmdResult(result, false);
      }

      case 'qmd_collection_add': {
        const path = toolInput.path as string;
        const name = toolInput.name as string;
        const mask = toolInput.mask as string | undefined;
        const timeoutMs = (toolInput.timeout_ms as number) ?? 60_000;

        const args = ['collection', 'add', path, '--name', name];
        if (mask) args.push('--mask', mask);

        const result = runQmdCommand(args, timeoutMs);
        return formatQmdResult(result, false);
      }

      case 'qmd_context_add': {
        const collection = toolInput.collection as string;
        const description = toolInput.description as string;
        const timeoutMs = (toolInput.timeout_ms as number) ?? 30_000;

        const result = runQmdCommand(['context', 'add', collection, description], timeoutMs);
        return formatQmdResult(result, false);
      }

      // ============================================
      // EXECUTION & BOT HANDLERS (like Clawdbot)
      // ============================================

      case 'exec_python': {
        const code = toolInput.code as string;
        const timeout = ((toolInput.timeout as number) || 30) * 1000;

        // Write code to temp file
        const tempFile = join('/tmp', `clodds_exec_${Date.now()}.py`);
        writeFileSync(tempFile, code);

        try {
          const output = execFileSync('python3', [tempFile], {
            timeout,
            encoding: 'utf-8',
            env: process.env,
            cwd: process.cwd(),
          });
          return JSON.stringify({ result: 'success', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; stdout?: string; message?: string };
          return JSON.stringify({
            error: 'Execution failed',
            stderr: error.stderr,
            stdout: error.stdout,
            message: error.message,
          });
        }
      }

      case 'exec_shell': {
        const command = toolInput.command as string;
        const timeout = ((toolInput.timeout as number) || 30) * 1000;

        // Basic input sanitization
        const sanitized = sanitize(command, { allowCode: true, allowHtml: false, allowUrls: true, maxLength: 1000 });
        const injection = detectInjection(sanitized);
        if (!injection.safe) {
          return JSON.stringify({ error: `Command blocked due to security risks: ${injection.threats.join(', ')}` });
        }

        // Security: Block dangerous commands
        const blockedPatterns = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'fork bomb'];
        for (const pattern of blockedPatterns) {
          if (command.includes(pattern)) {
            return JSON.stringify({ error: 'Command blocked for safety' });
          }
        }

        const approval = await execApprovals.checkCommand('default', command, {
          sessionId: session.id,
          waitForApproval: false,
          requester: {
            userId: session.userId,
            channel: session.channel,
            chatId: session.chatId,
          },
        });
        if (!approval.allowed) {
          return JSON.stringify({
            error: approval.reason || 'Approval required',
            requestId: approval.requestId,
            hint: 'Run: clodds permissions pending / clodds permissions approve <id>',
          });
        }

        try {
          const output = execSync(command, {
            timeout,
            encoding: 'utf-8',
            env: process.env,
            shell: '/bin/bash',
          });
          return JSON.stringify({ result: 'success', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; stdout?: string; message?: string };
          return JSON.stringify({
            error: 'Command failed',
            stderr: error.stderr,
            stdout: error.stdout,
            message: error.message,
          });
        }
      }

      case 'start_bot': {
        const name = toolInput.name as string;
        const script = toolInput.script as string;
        const args = (toolInput.args as string) || '';

        const botId = generateSecureId('bot');

        // Check if it's code or a file path
        let cmd: string;
        let cwd: string = process.cwd();

        if (script.includes('\n') || script.startsWith('import ') || script.startsWith('from ')) {
          // It's code - write to temp file
          const tempFile = join('/tmp', `clodds_bot_${botId}.py`);
          writeFileSync(tempFile, script);
          cmd = `python3 ${tempFile} ${args}`;
        } else {
          // It's a file path
          cmd = `python3 ${script} ${args}`;
        }

        const proc = spawn('bash', ['-c', cmd], {
          cwd,
          env: process.env,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const logs: string[] = [];

        proc.stdout?.on('data', (data: Buffer) => {
          const line = data.toString();
          logs.push(line);
          if (logs.length > 1000) logs.shift(); // Keep last 1000 lines
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const line = `[STDERR] ${data.toString()}`;
          logs.push(line);
          if (logs.length > 1000) logs.shift();
        });

        proc.on('exit', (code) => {
          logs.push(`[EXIT] Process exited with code ${code}`);
        });

        backgroundProcesses.set(botId, {
          process: proc,
          name,
          startedAt: new Date(),
          userId,
          logs,
        });

        return JSON.stringify({
          result: 'Bot started',
          botId,
          name,
          pid: proc.pid,
        });
      }

      case 'stop_bot': {
        const botId = toolInput.bot_id as string;
        const bot = backgroundProcesses.get(botId);

        if (!bot) {
          return JSON.stringify({ error: 'Bot not found' });
        }

        // Check ownership
        if (bot.userId !== userId) {
          return JSON.stringify({ error: 'Not your bot' });
        }

        try {
          bot.process.kill('SIGTERM');
          setTimeout(() => {
            if (!bot.process.killed) {
              bot.process.kill('SIGKILL');
            }
          }, 5000);
          backgroundProcesses.delete(botId);
          return JSON.stringify({ result: 'Bot stopped', botId });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Failed to stop bot', details: error.message });
        }
      }

      case 'list_bots': {
        const bots = Array.from(backgroundProcesses.entries())
          .filter(([, bot]) => bot.userId === userId)
          .map(([botId, bot]) => ({
            botId,
            name: bot.name,
            startedAt: bot.startedAt.toISOString(),
            pid: bot.process.pid,
            running: !bot.process.killed,
            recentLog: bot.logs.slice(-3).join('\n'),
          }));

        if (bots.length === 0) {
          return JSON.stringify({ result: 'No bots running' });
        }

        return JSON.stringify({ result: bots });
      }

      case 'get_bot_logs': {
        const botId = toolInput.bot_id as string;
        const lines = (toolInput.lines as number) || 50;
        const bot = backgroundProcesses.get(botId);

        if (!bot) {
          return JSON.stringify({ error: 'Bot not found' });
        }

        if (bot.userId !== userId) {
          return JSON.stringify({ error: 'Not your bot' });
        }

        const recentLogs = bot.logs.slice(-lines);
        return JSON.stringify({
          result: {
            botId,
            name: bot.name,
            running: !bot.process.killed,
            logs: recentLogs.join('\n'),
          },
        });
      }

      // ============================================
      // FILE & WORKSPACE HANDLERS
      // ============================================

      case 'write_file': {
        const filePath = toolInput.path as string;
        const content = toolInput.content as string;
        const append = Boolean(toolInput.append);
        const createDirs = Boolean(toolInput.create_dirs);

        try {
          context.files.write(filePath, content, { append, createDirs });
          return JSON.stringify({ result: 'File written', path: filePath, mode: append ? 'append' : 'write' });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Write failed', details: error.message });
        }
      }

      case 'read_file': {
        const filePath = toolInput.path as string;

        try {
          const maxBytes = toolInput.max_bytes as number | undefined;
          const content = context.files.read(filePath, { maxBytes });
          return JSON.stringify({ result: { path: filePath, content } });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Read failed', details: error.message });
        }
      }
      case 'edit_file': {
        const filePath = toolInput.path as string;
        const edits = Array.isArray(toolInput.edits) ? toolInput.edits : [];
        const createIfMissing = Boolean(toolInput.create_if_missing);

        try {
          const normalizedEdits = edits.map((edit) => ({
            find: edit.find as string,
            replace: edit.replace as string,
            all: Boolean(edit.all),
          }));

          const result = context.files.edit(filePath, normalizedEdits, { createIfMissing });
          return JSON.stringify({ result: { path: filePath, updated: result.updated, content: result.content } });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Edit failed', details: error.message });
        }
      }
      case 'list_files': {
        const dir = (toolInput.dir as string) || '.';
        const recursive = Boolean(toolInput.recursive);
        const includeDirs = Boolean(toolInput.include_dirs);
        const limit = toolInput.limit as number | undefined;

        try {
          const entries = context.files.list(dir, { recursive, includeDirs, limit });
          return JSON.stringify({ result: entries });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'List failed', details: error.message });
        }
      }
      case 'search_files': {
        const dir = (toolInput.dir as string) || '.';
        const query = toolInput.query as string;
        const recursive = toolInput.recursive === undefined ? true : Boolean(toolInput.recursive);
        const limit = toolInput.limit as number | undefined;

        try {
          const results = context.files.search(dir, query, { recursive, limit });
          return JSON.stringify({ result: results });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Search failed', details: error.message });
        }
      }
      case 'shell_history_list': {
        const shell = toolInput.shell as 'auto' | 'zsh' | 'bash' | 'fish' | undefined;
        const limit = toolInput.limit as number | undefined;
        const query = toolInput.query as string | undefined;

        try {
          const results = context.shellHistory.list({
            shell: shell && shell !== 'auto' ? shell : 'auto',
            limit,
            query,
          });
          return JSON.stringify({ result: results });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Shell history failed', details: error.message });
        }
      }
      case 'shell_history_search': {
        const shell = toolInput.shell as 'auto' | 'zsh' | 'bash' | 'fish' | undefined;
        const limit = toolInput.limit as number | undefined;
        const query = toolInput.query as string;

        try {
          const results = context.shellHistory.search(query, {
            shell: shell && shell !== 'auto' ? shell : 'auto',
            limit,
          });
          return JSON.stringify({ result: results });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Shell history failed', details: error.message });
        }
      }
      case 'git_status': {
        const cwd = toolInput.cwd as string | undefined;

        try {
          if (!context.git.isRepo(cwd)) {
            return JSON.stringify({ error: 'Not a git repository', cwd: cwd || '.' });
          }
          const result = context.git.status(cwd);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Git status failed', details: error.message });
        }
      }
      case 'git_diff': {
        const cwd = toolInput.cwd as string | undefined;
        const args = Array.isArray(toolInput.args) ? (toolInput.args as string[]) : undefined;

        try {
          if (!context.git.isRepo(cwd)) {
            return JSON.stringify({ error: 'Not a git repository', cwd: cwd || '.' });
          }
          const result = context.git.diff(cwd, args);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Git diff failed', details: error.message });
        }
      }
      case 'git_log': {
        const cwd = toolInput.cwd as string | undefined;
        const limit = toolInput.limit as number | undefined;

        try {
          if (!context.git.isRepo(cwd)) {
            return JSON.stringify({ error: 'Not a git repository', cwd: cwd || '.' });
          }
          const result = context.git.log(cwd, { limit });
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Git log failed', details: error.message });
        }
      }
      case 'git_show': {
        const cwd = toolInput.cwd as string | undefined;
        const ref = (toolInput.ref as string | undefined) || 'HEAD';

        try {
          if (!context.git.isRepo(cwd)) {
            return JSON.stringify({ error: 'Not a git repository', cwd: cwd || '.' });
          }
          const result = context.git.show(ref, cwd);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Git show failed', details: error.message });
        }
      }
      case 'git_rev_parse': {
        const cwd = toolInput.cwd as string | undefined;
        const ref = (toolInput.ref as string | undefined) || 'HEAD';

        try {
          if (!context.git.isRepo(cwd)) {
            return JSON.stringify({ error: 'Not a git repository', cwd: cwd || '.' });
          }
          const result = context.git.revParse(ref, cwd);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Git rev-parse failed', details: error.message });
        }
      }
      case 'git_branch': {
        const cwd = toolInput.cwd as string | undefined;

        try {
          if (!context.git.isRepo(cwd)) {
            return JSON.stringify({ error: 'Not a git repository', cwd: cwd || '.' });
          }
          const result = context.git.branch(cwd);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Git branch failed', details: error.message });
        }
      }
      case 'git_add': {
        const cwd = toolInput.cwd as string | undefined;
        const paths = Array.isArray(toolInput.paths) ? (toolInput.paths as string[]) : [];

        try {
          if (!context.git.isRepo(cwd)) {
            return JSON.stringify({ error: 'Not a git repository', cwd: cwd || '.' });
          }
          context.git.add(paths, cwd);
          return JSON.stringify({ result: 'Git add completed', count: paths.length });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Git add failed', details: error.message });
        }
      }
      case 'git_commit': {
        const cwd = toolInput.cwd as string | undefined;
        const message = toolInput.message as string;

        try {
          if (!context.git.isRepo(cwd)) {
            return JSON.stringify({ error: 'Not a git repository', cwd: cwd || '.' });
          }
          const result = context.git.commit(message, cwd);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Git commit failed', details: error.message });
        }
      }
      case 'email_send': {
        try {
          const result = await context.email.send({
            from: toolInput.from as { name?: string; email: string },
            to: toolInput.to as Array<{ name?: string; email: string } | string>,
            cc: toolInput.cc as Array<{ name?: string; email: string } | string> | undefined,
            bcc: toolInput.bcc as Array<{ name?: string; email: string } | string> | undefined,
            subject: toolInput.subject as string,
            text: toolInput.text as string,
            replyTo: toolInput.reply_to as { name?: string; email: string } | string | undefined,
            dryRun: Boolean(toolInput.dry_run),
          });
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Email send failed', details: error.message });
        }
      }
      case 'sms_send': {
        try {
          const result = await context.sms.send({
            to: toolInput.to as string,
            body: toolInput.body as string,
            from: toolInput.from as string | undefined,
            dryRun: Boolean(toolInput.dry_run),
          });
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'SMS send failed', details: error.message });
        }
      }
      case 'transcribe_audio': {
        const filePath = toolInput.path as string;

        try {
          const options: TranscriptionOptions = {
            engine: toolInput.engine as TranscriptionOptions['engine'] | undefined,
            language: toolInput.language as string | undefined,
            prompt: toolInput.prompt as string | undefined,
            model: toolInput.model as string | undefined,
            temperature: toolInput.temperature as number | undefined,
            timestamps: toolInput.timestamps as boolean | undefined,
            timeoutMs: toolInput.timeout_ms as number | undefined,
          };

          const result = await context.transcription.transcribe({ path: filePath, ...options });
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Transcription failed', details: error.message });
        }
      }
      case 'sql_query': {
        try {
          const sql = toolInput.sql as string;
          const params = Array.isArray(toolInput.params) ? toolInput.params : undefined;
          const maxRows = toolInput.max_rows as number | undefined;
          const result = await context.sql.query({ sql, params, maxRows });
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'SQL query failed', details: error.message });
        }
      }
      case 'register_webhook': {
        try {
          if (!context.webhooks) {
            return JSON.stringify({ error: 'Webhook manager not available in this runtime' });
          }

          const result = await context.webhooks.register({
            id: toolInput.id as string | undefined,
            path: toolInput.path as string,
            description: toolInput.description as string | undefined,
            rateLimit: toolInput.rate_limit as number | undefined,
            enabled: toolInput.enabled as boolean | undefined,
            secret: toolInput.secret as string | undefined,
            template: toolInput.template as string | undefined,
            target: {
              platform: toolInput.target_platform as string,
              chatId: toolInput.target_chat_id as string,
              userId: toolInput.target_user_id as string,
              username: toolInput.target_username as string | undefined,
            },
          });

          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Webhook registration failed', details: error.message });
        }
      }
      case 'list_webhooks': {
        try {
          if (!context.webhooks) {
            return JSON.stringify({ error: 'Webhook manager not available in this runtime' });
          }
          const includeSecrets = Boolean(toolInput.include_secrets);
          const result = await context.webhooks.list(includeSecrets);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Failed to list webhooks', details: error.message });
        }
      }
      case 'delete_webhook': {
        try {
          if (!context.webhooks) {
            return JSON.stringify({ error: 'Webhook manager not available in this runtime' });
          }
          const id = toolInput.id as string;
          const result = await context.webhooks.remove(id);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Failed to delete webhook', details: error.message });
        }
      }
      case 'enable_webhook': {
        try {
          if (!context.webhooks) {
            return JSON.stringify({ error: 'Webhook manager not available in this runtime' });
          }
          const id = toolInput.id as string;
          const enabled = Boolean(toolInput.enabled);
          const result = await context.webhooks.setEnabled(id, enabled);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Failed to toggle webhook', details: error.message });
        }
      }
      case 'rotate_webhook_secret': {
        try {
          if (!context.webhooks) {
            return JSON.stringify({ error: 'Webhook manager not available in this runtime' });
          }
          const id = toolInput.id as string;
          const result = await context.webhooks.rotateSecret(id);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Failed to rotate webhook secret', details: error.message });
        }
      }
      case 'sign_webhook_payload': {
        try {
          if (!context.webhooks) {
            return JSON.stringify({ error: 'Webhook manager not available in this runtime' });
          }
          const id = toolInput.id as string;
          const rawPayload = toolInput.payload as string;
          let payload: unknown = rawPayload;
          try {
            payload = JSON.parse(rawPayload);
          } catch {
            // keep raw string
          }
          const result = await context.webhooks.sign(id, payload);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Failed to sign payload', details: error.message });
        }
      }
      case 'trigger_webhook': {
        try {
          if (!context.webhooks) {
            return JSON.stringify({ error: 'Webhook manager not available in this runtime' });
          }
          const id = toolInput.id as string;
          const rawPayload = toolInput.payload as string;
          let payload: unknown = rawPayload;
          try {
            payload = JSON.parse(rawPayload);
          } catch {
            // keep raw string
          }
          const signature = toolInput.signature as string | undefined;
          const result = await context.webhooks.trigger(id, payload, signature);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Failed to trigger webhook', details: error.message });
        }
      }
      case 'docker_list_containers': {
        try {
          const all = toolInput.all as boolean | undefined;
          const result = await context.docker.listContainers(all ?? true);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Failed to list containers', details: error.message });
        }
      }
      case 'docker_list_images': {
        try {
          const result = await context.docker.listImages();
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Failed to list images', details: error.message });
        }
      }
      case 'docker_run': {
        try {
          const image = toolInput.image as string;
          const name = toolInput.name as string | undefined;
          const command = Array.isArray(toolInput.command)
            ? toolInput.command.map((c) => String(c))
            : undefined;
          const detach = toolInput.detach as boolean | undefined;
          const workdir = toolInput.workdir as string | undefined;
          const network = toolInput.network as string | undefined;

          const result = await context.docker.run({
            image,
            name,
            command,
            detach,
            workdir,
            network,
          });
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Docker run failed', details: error.message });
        }
      }
      case 'docker_stop': {
        try {
          const container = toolInput.container as string;
          const timeoutSeconds = toolInput.timeout_seconds as number | undefined;
          const result = await context.docker.stop(container, timeoutSeconds);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Docker stop failed', details: error.message });
        }
      }
      case 'docker_remove': {
        try {
          const container = toolInput.container as string;
          const force = toolInput.force as boolean | undefined;
          const result = await context.docker.remove(container, force);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Docker remove failed', details: error.message });
        }
      }
      case 'docker_logs': {
        try {
          const container = toolInput.container as string;
          const tail = toolInput.tail as number | undefined;
          const result = await context.docker.logs(container, tail);
          return JSON.stringify({ result });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Docker logs failed', details: error.message });
        }
      }

      // ============================================
      // SESSION MANAGEMENT HANDLERS
      // ============================================

      case 'clear_conversation_history': {
        context.clearHistory();
        return JSON.stringify({
          result: 'Conversation history cleared. Starting fresh!',
        });
      }

      case 'save_session_checkpoint': {
        const summary = toolInput.summary as string | undefined;
        context.sessionManager.saveCheckpoint(session, summary);
        return JSON.stringify({ result: 'Checkpoint saved.' });
      }

      case 'restore_session_checkpoint': {
        const restored = context.sessionManager.restoreCheckpoint(session);
        if (!restored) {
          return JSON.stringify({ error: 'No checkpoint available to restore.' });
        }
        return JSON.stringify({ result: 'Checkpoint restored.' });
      }

      case 'edit_message': {
        const platform = toolInput.platform as string;
        const chatId = toolInput.chat_id as string;
        const messageId = toolInput.message_id as string;
        const text = toolInput.text as string;
        const accountId = toolInput.account_id as string | undefined;

        if (!context.editMessage) {
          return JSON.stringify({ error: 'Edit not supported in this runtime.' });
        }

        await context.editMessage({
          platform,
          chatId,
          messageId,
          text,
          accountId,
          parseMode: 'Markdown',
        });
        return JSON.stringify({ result: 'Message edited.' });
      }

      case 'delete_message': {
        const platform = toolInput.platform as string;
        const chatId = toolInput.chat_id as string;
        const messageId = toolInput.message_id as string;
        const accountId = toolInput.account_id as string | undefined;

        if (!context.deleteMessage) {
          return JSON.stringify({ error: 'Delete not supported in this runtime.' });
        }

        await context.deleteMessage({
          platform,
          chatId,
          messageId,
          accountId,
          text: '',
        });
        return JSON.stringify({ result: 'Message deleted.' });
      }

      case 'react_message': {
        const platform = toolInput.platform as string;
        const chatId = toolInput.chat_id as string;
        const messageId = toolInput.message_id as string;
        const emoji = toolInput.emoji as string;
        const remove = toolInput.remove === true;
        const participant = toolInput.participant as string | undefined;
        const fromMe = toolInput.from_me === true;
        const accountId = toolInput.account_id as string | undefined;

        if (!context.reactMessage) {
          return JSON.stringify({ error: 'Reactions not supported in this runtime.' });
        }

        await context.reactMessage({
          platform,
          chatId,
          messageId,
          emoji,
          remove,
          participant,
          fromMe,
          accountId,
        });
        return JSON.stringify({ result: remove ? 'Reaction removed.' : 'Reaction added.' });
      }

      case 'create_poll': {
        const platform = toolInput.platform as string;
        const chatId = toolInput.chat_id as string;
        const question = toolInput.question as string;
        const options = Array.isArray(toolInput.options) ? (toolInput.options as string[]) : [];
        const multiSelect = toolInput.multi_select === true;
        const accountId = toolInput.account_id as string | undefined;

        if (!context.createPoll) {
          return JSON.stringify({ error: 'Polls not supported in this runtime.' });
        }

        const messageId = await context.createPoll({
          platform,
          chatId,
          question,
          options,
          multiSelect,
          accountId,
        });
        return JSON.stringify({ result: 'Poll sent.', message_id: messageId });
      }

      // ============================================
      // SUBAGENT HANDLERS
      // ============================================

      case 'subagent_start': {
        const task = toolInput.task as string;
        const id = (toolInput.id as string) || `subagent_${randomUUID()}`;
        const model = toolInput.model as string | undefined;
        const thinkingMode = toolInput.thinking_mode as
          | 'none'
          | 'basic'
          | 'extended'
          | 'chain-of-thought'
          | undefined;
        const maxTurns = toolInput.max_turns as number | undefined;
        const timeout = toolInput.timeout_ms as number | undefined;
        const toolsAllowlist = Array.isArray(toolInput.tools)
          ? (toolInput.tools as string[])
          : undefined;
        const background = toolInput.background !== false;

        const config = {
          id,
          sessionId: session.id,
          userId: session.userId,
          task,
          model,
          thinkingMode,
          maxTurns,
          timeout,
          tools: toolsAllowlist,
          background: background,
        };

        const subagentToolExecutor: ToolExecutor = async (tool, params, state) => {
          if (tool.startsWith('subagent_')) {
            return JSON.stringify({ error: 'Subagent tools are not allowed inside subagents.' });
          }
          if (state.config.tools && !state.config.tools.includes(tool)) {
            return JSON.stringify({ error: `Tool not allowed: ${tool}` });
          }
          return executeTool(tool, params, context);
        };

        if (background) {
          subagentManager.startBackground(config, subagentToolExecutor);
        } else {
          const run = subagentManager.start(config);
          await subagentManager.execute(run, subagentToolExecutor);
        }

        return JSON.stringify({ result: 'Subagent started', id });
      }

      case 'subagent_pause': {
        const id = toolInput.id as string;
        const ok = subagentManager.pause(id);
        if (!ok) {
          return JSON.stringify({ error: `Subagent not running: ${id}` });
        }
        return JSON.stringify({ result: 'Subagent paused', id });
      }

      case 'subagent_resume': {
        const id = toolInput.id as string;
        const background = toolInput.background !== false;
        const run = subagentManager.resume(id);
        if (!run) {
          return JSON.stringify({ error: `Subagent not found: ${id}` });
        }

        const subagentToolExecutor: ToolExecutor = async (tool, params, state) => {
          if (tool.startsWith('subagent_')) {
            return JSON.stringify({ error: 'Subagent tools are not allowed inside subagents.' });
          }
          if (state.config.tools && !state.config.tools.includes(tool)) {
            return JSON.stringify({ error: `Tool not allowed: ${tool}` });
          }
          return executeTool(tool, params, context);
        };

        if (background) {
          setImmediate(() => {
            subagentManager.execute(run, subagentToolExecutor).catch((error) => {
              logger.error({ id, error }, 'Subagent resume failed');
            });
          });
        } else {
          await subagentManager.execute(run, subagentToolExecutor);
        }

        return JSON.stringify({ result: 'Subagent resumed', id });
      }

      case 'subagent_status': {
        const id = toolInput.id as string;
        const state = subagentManager.getStatus(id);
        if (!state) {
          return JSON.stringify({ error: `Subagent not found: ${id}` });
        }
        return JSON.stringify({ result: state });
      }

      case 'subagent_progress': {
        const id = toolInput.id as string;
        const message = toolInput.message as string | undefined;
        const percent = typeof toolInput.percent === 'number' ? (toolInput.percent as number) : undefined;
        const ok = subagentManager.updateProgress(id, message, percent);
        if (!ok) {
          return JSON.stringify({ error: `Subagent not found: ${id}` });
        }
        return JSON.stringify({ result: 'Progress updated', id });
      }

      case 'tool_search': {
        // Fallback when TOOL_SEARCH_ENABLED is false or handler not intercepted.
        // Return a helpful message so Claude doesn't get a confusing error.
        return JSON.stringify({
          error: 'tool_search is not enabled. All tools are already available — use them directly.',
        });
      }

      default: {
        // Try modular handlers (Solana DEX, Bags.fm, Betfair, Smarkets, Opinion, Virtuals, etc.)
        if (hasHandler(toolName)) {
          const result = await dispatchHandler(toolName, toolInput, {
            db,
            userId,
            sessionId: session.id,
            tradingContext: context.tradingContext,
            credentials: context.credentials,
            feeds: context.feeds,
          });
          if (result) {
            // dispatchHandler returns HandlerResult (already JSON string), don't double-stringify
            return result;
          }
        }
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
      }
    }
  } catch (error) {
    logger.error(`Tool execution error (${toolName}):`, error);
    return JSON.stringify({
      error: `Tool failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
}

export async function createAgentManager(
  config: Config,
  feeds: FeedManager,
  db: Database,
  sessionManager: SessionManager,
  sendMessage: (msg: OutgoingMessage) => Promise<string | null>,
  editMessage?: (msg: OutgoingMessage & { messageId: string }) => Promise<void>,
  deleteMessage?: (msg: OutgoingMessage & { messageId: string }) => Promise<void>,
  reactMessage?: (msg: ReactionMessage) => Promise<void>,
  createPoll?: (msg: PollMessage) => Promise<string | null>,
  memory?: MemoryService,
  configProvider?: () => Config,
  webhookToolProvider?: () => WebhookTool | undefined,
  executionService?: ExecutionServiceRef | null
): Promise<AgentManager> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  const client = new Anthropic({ apiKey });
  const skills = createSkillManager(config.agents.defaults.workspace);
  const createCredentialsManager = await _loadCredentials();
  const credentials = createCredentialsManager(db);
  const transcription = createTranscriptionTool(config.agents.defaults.workspace);
  const files = createFileTool(config.agents.defaults.workspace);
  const shellHistory = createShellHistoryTool();
  const git = createGitTool(config.agents.defaults.workspace);
  const email = createEmailTool();
  const sms = createSmsTool();
  const sql = createSqlTool(db);
  const embeddings: EmbeddingsService = createEmbeddingsService(db);
  const marketIndex = createMarketIndexService(db, embeddings, {
    platformWeights: config.marketIndex?.platformWeights,
  });
  const docker = createDockerTool(config.agents.defaults.workspace);
  const subagentManager = createSubagentManager();
  subagentManager.setClient(client);
  const subagentProgressLastSent = new Map<string, number>();
  subagentManager.setAnnouncer(async (state) => {
    const session = sessionManager.getSessionById(state.config.sessionId);
    if (!session) {
      logger.warn({ id: state.config.id }, 'Subagent completed but session not found');
      return;
    }

    if (state.progress && state.status === 'running') {
      const lastSent = subagentProgressLastSent.get(state.config.id) ?? 0;
      const now = Date.now();
      if (now - lastSent < 5000) {
        return;
      }
      subagentProgressLastSent.set(state.config.id, now);
      const progressLine = [
        state.progress.message || 'Working…',
        typeof state.progress.percent === 'number' ? `(${state.progress.percent}%)` : '',
      ].filter(Boolean).join(' ');
      await sendMessage({
        platform: session.channel,
        chatId: session.chatId,
        accountId: session.accountId,
        text: `Subagent progress (${state.config.id}): ${progressLine}`,
        parseMode: 'Markdown',
      });
      return;
    }

    const result = state.result
      ? state.result.length > 500
        ? `${state.result.slice(0, 500)}…`
        : state.result
      : state.error
        ? `Error: ${state.error.message}`
        : 'No result.';
    await sendMessage({
      platform: session.channel,
      chatId: session.chatId,
      accountId: session.accountId,
      text: `Subagent finished (${state.config.id}). Result:\n\n${result}`,
      parseMode: 'Markdown',
    });
  });
  const allToolDefs = buildTools();

  // Build tool registry with inferred metadata
  const toolRegistry = new ToolRegistry<ToolDefinition>();
  for (const tool of allToolDefs) {
    const inferred = inferToolMetadata(tool.name, tool.description);
    const isCore = CORE_TOOL_NAMES.has(tool.name);
    const merged: ToolMetadata = {
      ...inferred,
      ...tool.metadata, // explicit metadata overrides inferred
      core: tool.metadata?.core ?? isCore,
    };
    // Sync categories with explicit category override to prevent divergence
    if (tool.metadata?.category && !tool.metadata?.categories) {
      merged.categories = [tool.metadata.category, ...(inferred.categories ?? []).filter(c => c !== tool.metadata!.category)];
    }
    toolRegistry.register({ ...tool, metadata: merged });
  }

  // Dynamic tool loading enabled by default. Set TOOL_SEARCH_ENABLED=false to disable.
  const TOOL_SEARCH_ENABLED = process.env.TOOL_SEARCH_ENABLED !== 'false';

  // Core tools (always sent) vs all tools (legacy mode)
  const coreTools = toolRegistry.getCoreTools();
  // When disabled, send all tools EXCEPT tool_search (no point confusing the LLM)
  const tools: ToolDefinition[] = TOOL_SEARCH_ENABLED
    ? coreTools
    : allToolDefs.filter(t => t.name !== 'tool_search');

  logger.info({
    totalTools: allToolDefs.length,
    coreTools: coreTools.length,
    toolSearchEnabled: TOOL_SEARCH_ENABLED,
  }, 'Tool registry initialized');

  const getConfig = configProvider || (() => config);
  const getWebhooks = webhookToolProvider || (() => undefined);
  const summarizer = createClaudeSummarizer();

  // =========================================================================
  // RATE LIMITING - Per-user rate limits to prevent abuse
  // =========================================================================
  function computeRateLimitConfig(): RateLimitConfig {
    const cfg = getConfig();
    return {
      maxRequests: cfg.agents.defaults.rateLimit?.maxRequests ?? 30,
      windowMs: cfg.agents.defaults.rateLimit?.windowMs ?? 60000,
      perUser: true,
    };
  }

  let rateLimitConfig: RateLimitConfig = computeRateLimitConfig();
  let rateLimiter = new RateLimiter(rateLimitConfig);

  function ensureRateLimiter(): void {
    const next = computeRateLimitConfig();
    if (next.maxRequests !== rateLimitConfig.maxRequests || next.windowMs !== rateLimitConfig.windowMs) {
      rateLimitConfig = next;
      rateLimiter = new RateLimiter(rateLimitConfig);
      logger.info({ rateLimitConfig }, 'Rate limiter reconfigured');
    }
  }

  // Periodic cleanup of expired rate limit entries (every 5 minutes)
  const rateLimitCleanupInterval = setInterval(() => {
    rateLimiter.cleanup();
  }, 5 * 60 * 1000);

  async function handleMessage(message: IncomingMessage, session: Session): Promise<string | null> {
    ensureRateLimiter();

    // =========================================================================
    // ACCESS CONTROL - Check if user is allowed
    // =========================================================================
    const accessResult = access.checkAccess(session.userId);
    if (!accessResult.allowed) {
      logger.warn({ userId: session.userId, reason: accessResult.reason }, 'Access denied');
      return `Access denied: ${accessResult.reason}`;
    }

    // =========================================================================
    // RATE LIMITING - Check rate limit before processing
    // =========================================================================
    const rateLimitKey = rateLimitConfig.perUser ? session.userId : 'global';
    const rateLimitResult = rateLimiter.check(rateLimitKey);

    if (!rateLimitResult.allowed) {
      const resetInSeconds = Math.ceil(rateLimitResult.resetIn / 1000);
      logger.warn({
        userId: session.userId,
        remaining: rateLimitResult.remaining,
        resetIn: resetInSeconds,
      }, 'Rate limit exceeded');
      return `You've sent too many messages. Please wait ${resetInSeconds} seconds before trying again.`;
    }

    logger.debug({
      userId: session.userId,
      remaining: rateLimitResult.remaining,
    }, 'Rate limit check passed');

    // =========================================================================
    // HOOKS: message:before - Can modify/cancel incoming message
    // =========================================================================
    const beforeMsgCtx = await hooks.trigger('message:before', {
      message,
      session,
    });
    if (beforeMsgCtx.cancelled) {
      logger.debug({ userId: session.userId }, 'Message cancelled by hook');
      return 'Message processing was cancelled.';
    }

    // Hooks may have modified the message
    const processedMessage = beforeMsgCtx.message || message;

    // Build trading context for this user (per-user credentials)
    const tradingContext = await credentials.buildTradingContext(session.userId, session.key);
    // Add execution service if available
    if (executionService) {
      tradingContext.executionService = executionService;
    }

    // Helper to add to conversation history
    const addToHistory = (role: 'user' | 'assistant', content: string) => {
      sessionManager.addToHistory(session, role, content);
    };

    // Helper to clear conversation history
    const clearHistory = () => {
      sessionManager.clearHistory(session);
    };

    const sendMessageWithAccount = (msg: OutgoingMessage) =>
      sendMessage({ ...msg, accountId: msg.accountId ?? session.accountId });
    const editMessageWithAccount = editMessage
      ? (msg: OutgoingMessage & { messageId: string }) =>
          editMessage({ ...msg, accountId: msg.accountId ?? session.accountId })
      : undefined;
    const deleteMessageWithAccount = deleteMessage
      ? (msg: OutgoingMessage & { messageId: string }) =>
          deleteMessage({ ...msg, accountId: msg.accountId ?? session.accountId })
      : undefined;
    const reactMessageWithAccount = reactMessage
      ? (msg: ReactionMessage) =>
          reactMessage({ ...msg, accountId: msg.accountId ?? session.accountId })
      : undefined;
    const createPollWithAccount = createPoll
      ? (msg: PollMessage) =>
          createPoll({ ...msg, accountId: msg.accountId ?? session.accountId })
      : undefined;

    const context: AgentContext = {
      session,
      feeds,
      db,
      sessionManager,
      skills,
      credentials,
      transcription,
      files,
      shellHistory,
      git,
      email,
      sms,
      sql,
      webhooks: getWebhooks(),
      docker,
      subagents: subagentManager,
      marketIndex,
      marketIndexConfig: config.marketIndex,
      tradingContext: tradingContext.credentials.size > 0 ? tradingContext : null,
      sendMessage: sendMessageWithAccount,
      editMessage: editMessageWithAccount,
      deleteMessage: deleteMessageWithAccount,
      reactMessage: reactMessageWithAccount,
      createPoll: createPollWithAccount,
      addToHistory,
      clearHistory,
    };

    try {
      // Build messages with conversation history for multi-turn context
      const history = sessionManager.getHistory(session);
      const messages: Anthropic.MessageParam[] = [];

      // Add previous conversation history
      for (const msg of history) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }

      // Add current user message (using processed message from hooks)
      messages.push({ role: 'user', content: processedMessage.text });

      // Save user message to history
      addToHistory('user', processedMessage.text);

      // Get model: session override > config default (Clawdbot-style)
      const liveConfig = getConfig();
      const defaultModelChain = {
        primary: liveConfig.agents.defaults.model.primary,
        fallbacks: liveConfig.agents.defaults.model.fallbacks,
      };
      const adaptiveModel = selectAdaptiveModel({
        ...defaultModelChain,
        strategy: getModelStrategy(),
      });
      const modelId = session.context.modelOverride || adaptiveModel;
      logger.info({ modelId, strategy: getModelStrategy() }, 'Selected model');

      let streamedResponseSent = false;
      let streamedMessageId: string | null = null;

      const createMessageWithRetry = (params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
        return withRetry(
          () => client.messages.create(params) as Promise<Anthropic.Message>,
          {
            ...RETRY_POLICIES.default.config,
            onRetry: (info) => {
              logger.warn({
                userId: session.userId,
                attempt: info.attempt,
                maxAttempts: info.maxAttempts,
                delay: info.delay,
                error: info.error.message,
              }, 'Retrying LLM request');
            },
          }
        );
      };

      const canStreamResponse =
        STREAM_RESPONSES_ENABLED &&
        Boolean(editMessage) &&
        STREAM_RESPONSE_PLATFORMS.has(processedMessage.platform);

      const extractResponseText = (response: Anthropic.Message): string => {
        const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
        return textBlocks.map((b) => b.text).join('\n');
      };

      const createMessageStreamed = async (
        params: Anthropic.MessageCreateParamsNonStreaming
      ): Promise<Anthropic.Message> => {
        let streamHasOutput = false;
        let pendingText = '';
        let lastSentText = '';
        let lastUpdateAt = 0;
        let updateTimer: NodeJS.Timeout | null = null;

        const scheduleFlush = (): void => {
          if (updateTimer) return;
          const delay = Math.max(0, STREAM_RESPONSE_INTERVAL_MS - (Date.now() - lastUpdateAt));
          updateTimer = setTimeout(() => {
            updateTimer = null;
            void flushUpdate(true);
          }, delay);
        };

        const flushUpdate = async (force = false): Promise<void> => {
          if (!pendingText || pendingText === lastSentText) return;
          const now = Date.now();
          if (!force && now - lastUpdateAt < STREAM_RESPONSE_INTERVAL_MS) {
            scheduleFlush();
            return;
          }
          try {
            if (!streamedMessageId) {
              const sentId = await sendMessage({
                platform: processedMessage.platform,
                chatId: processedMessage.chatId,
                text: pendingText,
                parseMode: 'Markdown',
                thread: processedMessage.thread,
              });
              if (!sentId) {
                logger.debug({ platform: processedMessage.platform }, 'Streaming send returned no messageId');
                return;
              }
              streamedMessageId = sentId;
              streamedResponseSent = true;
            } else if (editMessage) {
              await editMessage({
                platform: processedMessage.platform,
                chatId: processedMessage.chatId,
                messageId: streamedMessageId,
                text: pendingText,
                parseMode: 'Markdown',
                thread: processedMessage.thread,
              });
            }
            lastSentText = pendingText;
            lastUpdateAt = Date.now();
          } catch (error) {
            logger.debug({ error }, 'Streaming response update failed');
          }
        };

        const message = await withRetry(
          async () => {
            streamHasOutput = false;
            pendingText = '';
            lastSentText = '';
            lastUpdateAt = 0;
            if (updateTimer) {
              clearTimeout(updateTimer);
              updateTimer = null;
            }

            const stream = client.messages.stream(params);
            stream.on('text', (_delta, fullText) => {
              streamHasOutput = true;
              pendingText = fullText;
              scheduleFlush();
            });

            const finalMessage = await stream.finalMessage();
            if (updateTimer) {
              clearTimeout(updateTimer);
              updateTimer = null;
            }
            await flushUpdate(true);
            return finalMessage;
          },
          {
            ...RETRY_POLICIES.default.config,
            shouldRetry: (error) => !streamHasOutput && isRetryableError(error),
            onRetry: (info) => {
              logger.warn({
                userId: session.userId,
                attempt: info.attempt,
                maxAttempts: info.maxAttempts,
                delay: info.delay,
                error: info.error.message,
              }, 'Retrying streaming LLM request');
            },
          }
        );

        if (!streamedResponseSent) {
          const finalText = extractResponseText(message);
          if (finalText) {
            await sendMessage({
              platform: processedMessage.platform,
              chatId: processedMessage.chatId,
              text: finalText,
              parseMode: 'Markdown',
              thread: processedMessage.thread,
            });
            streamedResponseSent = true;
          }
        }

        return message;
      };

      const createMessage = async (
        params: Anthropic.MessageCreateParamsNonStreaming
      ): Promise<Anthropic.Message> => {
        if (!canStreamResponse) {
          return createMessageWithRetry(params);
        }
        return createMessageStreamed(params);
      };

      // Build final system prompt (Clawdbot-style)
      // Priority: routed agent prompt > default system prompt
      const skillContext = skills.getSkillContext();
      const baseSystemPrompt = SYSTEM_PROMPT.replace(
        '{{SKILLS}}',
        skillContext ? `\n## Skills Reference\n${skillContext}` : ''
      );
      let finalSystemPrompt = session.context.routedAgentPrompt || baseSystemPrompt;

      // Add memory context if available
      if (memory) {
        const memoryAuto = config.memory?.auto || {};
        const channelKey = processedMessage.chatId || processedMessage.platform;
        const scope = memoryAuto.scope === 'channel' ? channelKey : 'global';
        if (memoryAuto.includeMemoryContext !== false) {
          const memoryContext = memory.buildContextString(session.userId, scope);
          if (memoryContext) {
            finalSystemPrompt += `\n\n## User Memory\n${memoryContext}`;
          }
        }

        const semanticTopK = memoryAuto.semanticSearchTopK ?? (process.env.CLODDS_MEMORY_SEARCH === '1'
          ? Number(process.env.CLODDS_MEMORY_SEARCH_TOPK || 5)
          : 0);

        if (semanticTopK > 0 && processedMessage.text?.trim()) {
          try {
            const results = await memory.semanticSearch(
              session.userId,
              scope,
              processedMessage.text,
              semanticTopK
            );
            if (results.length > 0) {
              const lines = results.map((r) => `- ${r.entry.key}: ${r.entry.value} (score ${r.score.toFixed(2)})`);
              finalSystemPrompt += `\n\n## Relevant Memory (semantic search)\n${lines.join('\n')}`;
            }
          } catch (error) {
            logger.debug({ error }, 'Memory semantic search failed');
          }
        }
      }

      // =========================================================================
      // HOOKS: agent:before_start - Can modify system prompt
      // =========================================================================
      const { ctx: agentBeforeCtx, result: agentStartResult } = await hooks.triggerWithResult<AgentStartResult>(
        'agent:before_start',
        {
          message: processedMessage,
          session,
          data: {
            agentId: session.context.routedAgentId || 'default',
            systemPrompt: finalSystemPrompt,
            messages,
          },
        } as Partial<AgentHookContext>
      );

      // Apply hook modifications to system prompt
      if (agentStartResult?.systemPrompt) {
        finalSystemPrompt = agentStartResult.systemPrompt;
      }
      if (agentStartResult?.prependContext) {
        finalSystemPrompt = `${agentStartResult.prependContext}\n\n${finalSystemPrompt}`;
      }

      // =========================================================================
      // CONTEXT MANAGEMENT - Check token usage and compact if needed
      // =========================================================================
      // Model context window sizes (input limit)
      const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
        'claude-opus-4-6': 200000,
        'claude-opus-4-5-20250514': 200000,
        'claude-sonnet-4-5-20250929': 200000,
        'claude-sonnet-4-20250514': 200000,
        'claude-haiku-4-5-20251001': 200000,
        'claude-haiku-3-5-20250514': 200000,
        'claude-3-5-sonnet-20241022': 200000,
        'claude-3-opus-20240229': 200000,
      };
      const modelContextWindow = MODEL_CONTEXT_WINDOWS[modelId] || 200000;

      // Reserve space for system prompt + response buffer.
      // Tool tokens are NOT included here because client-side estimation of tool
      // tokens is wildly inaccurate (JSON.stringify tokenization != API's internal
      // tool token counting). Instead, we use actual API usage feedback after the
      // first call to calibrate. The API will reject if truly over limit.
      const systemTokenEstimate = estimateTokens(finalSystemPrompt, modelId);
      const reserveTokens = systemTokenEstimate + 8192;

      const contextConfig: ContextConfig = {
        maxTokens: modelContextWindow,
        reserveTokens,
        compactThreshold: 0.85,
        minMessagesAfterCompact: 6,
        summarizer,
        dedupe: process.env.CLODDS_CONTEXT_DEDUPE === '1',
        dedupeThreshold: Number(process.env.CLODDS_CONTEXT_DEDUPE_THRESHOLD || 0.92),
        dedupeWindow: Number(process.env.CLODDS_CONTEXT_DEDUPE_WINDOW || 12),
        embedder: memory?.embed,
        similarity: memory?.cosineSimilarity,
      };
      const contextManager = createContextManager(contextConfig, memory);
      const effectiveMaxTokens = modelContextWindow - reserveTokens;

      // Track actual API token usage for accurate compaction decisions
      let lastKnownInputTokens = 0;

      // Dynamic tool loading: tools discovered via tool_search during this request
      const discoveredTools: ToolDefinition[] = [];

      // Preload platform/category tools based on user message keywords.
      // Uses intersection mode when both platform AND intent are detected
      // to avoid loading all tools from multiple platforms (~150+).
      // Also checks conversation context for platform hints in multi-turn chats.
      if (TOOL_SEARCH_ENABLED && processedMessage.text) {
        const hints = detectToolHints(processedMessage.text);

        // CONVERSATION CONTEXT: If no platform in current message, borrow from recent history.
        // "buy YES at 40 cents" after discussing polymarket → still loads polymarket tools.
        if (hints.platforms.length === 0 && messages.length > 1) {
          const userMsgs = messages.filter(m => m.role === 'user');
          // Exclude current message (last one) — we already parsed it above
          const recentUserMsgs = userMsgs.slice(0, -1).slice(-4)
            .map(m => typeof m.content === 'string' ? m.content : '')
            .join(' ');
          if (recentUserMsgs) {
            const contextHints = detectToolHints(recentUserMsgs);
            // Only borrow platforms from context, not categories (current intent is authoritative)
            for (const p of contextHints.platforms) hints.platforms.push(p);
          }
        }

        const preloaded = new Set<string>();
        const GLOBAL_PRELOAD_CAP = 35;
        const MAX_TOOLS_PER_PLATFORM = 10;
        let preloadMode = 'none';

        // Helper: add a tool if not already preloaded and under global cap
        const addTool = (t: ToolDefinition): boolean => {
          if (preloaded.size >= GLOBAL_PRELOAD_CAP) return false;
          if (preloaded.has(t.name)) return false;
          discoveredTools.push(t);
          preloaded.add(t.name);
          return true;
        };

        // Helper: load top tools per platform, sorted by category priority
        const loadPlatformFallback = () => {
          const priorityRank: Record<string, number> = {
            trading: 4, market_data: 3, portfolio: 2, defi: 1,
          };
          for (const platform of hints.platforms) {
            const sorted = [...toolRegistry.searchByPlatform(platform)].sort((a, b) => {
              const aRank = priorityRank[a.metadata?.category ?? ''] ?? 0;
              const bRank = priorityRank[b.metadata?.category ?? ''] ?? 0;
              return bRank - aRank;
            });
            for (const t of sorted.slice(0, MAX_TOOLS_PER_PLATFORM)) {
              addTool(t);
            }
          }
        };

        if (hints.hasIntent && hints.platforms.length > 0) {
          // INTERSECTION MODE: Both platform AND intent detected
          // Only load tools matching BOTH criteria (e.g. polymarket + trading)
          preloadMode = 'intersection';
          for (const platform of hints.platforms) {
            for (const category of hints.categories) {
              for (const t of toolRegistry.searchByPlatformAndCategory(platform, category)) {
                if (!addTool(t)) break; // hit global cap
              }
            }
          }
          // If intersection found nothing, supplement with platform fallback.
          // With multi-category assignment this should be rare.
          if (preloaded.size === 0) {
            preloadMode = 'intersection+platform_fallback';
            loadPlatformFallback();
          }
        } else if (hints.platforms.length > 0) {
          // FALLBACK 1: Platform only, no clear intent
          // Load top tools per platform, prioritize trading/market_data/portfolio
          preloadMode = 'platform_fallback';
          loadPlatformFallback();
        } else if (hints.categories.length > 0) {
          // FALLBACK 2: Intent only, no platform
          // Distribute tools across platforms to avoid single-platform bias
          preloadMode = 'intent_fallback';
          const MAX_PER_PLATFORM_INTENT = 3;
          for (const category of hints.categories) {
            const perPlatformCount = new Map<string, number>();
            for (const t of toolRegistry.searchByCategory(category)) {
              const plat = t.metadata?.platform ?? 'unknown';
              const count = perPlatformCount.get(plat) ?? 0;
              if (count >= MAX_PER_PLATFORM_INTENT) continue;
              if (!addTool(t)) break; // hit global cap
              perPlatformCount.set(plat, count + 1);
            }
          }
        }

        if (discoveredTools.length > 0) {
          logger.info({
            mode: preloadMode,
            platforms: hints.platforms,
            categories: hints.categories,
            preloaded: discoveredTools.length,
          }, 'Preloaded tools from message keywords');
        }
      }

      // Add all messages to context manager for tracking
      for (const msg of messages) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        contextManager.addMessage({
          role: msg.role as 'user' | 'assistant',
          content,
        });
      }

      // Check if we need to compact before first API call
      // (tools + system prompt are already accounted for in reserveTokens)
      const guard = contextManager.checkGuard();
      if (guard.shouldCompact) {
        logger.info({ percentUsed: guard.percentUsed }, 'Context approaching limit, compacting');

        // Trigger compaction:before hook
        await hooks.trigger('compaction:before', {
          session,
          data: {
            sessionId: session.key,
            tokensBefore: guard.currentTokens,
            compactionCount: contextManager.getStats().compactionCount,
          },
        } as Partial<CompactionContext>);

        const compactionResult = await contextManager.compact();

        // Trigger compaction:after hook
        await hooks.trigger('compaction:after', {
          session,
          data: {
            sessionId: session.key,
            tokensBefore: compactionResult.tokensBefore,
            tokensAfter: compactionResult.tokensAfter,
            compactionCount: contextManager.getStats().compactionCount,
          },
        } as Partial<CompactionContext>);

        // Rebuild messages array from compacted context
        if (compactionResult.success) {
          const compactedMessages = contextManager.getMessagesForApi();
          messages.length = 0;
          for (const msg of compactedMessages) {
            messages.push({
              role: msg.role === 'system' ? 'user' : msg.role,
              content: msg.content,
            });
          }
          sessionManager.saveCheckpoint(session, compactionResult.summary);
          logger.info({
            removed: compactionResult.removedMessages,
            tokensSaved: compactionResult.tokensBefore - compactionResult.tokensAfter,
          }, 'Context compacted successfully');
        }
      }

      // Build dynamic tool set: core tools + any discovered tools
      const getActiveTools = (): ToolDefinition[] => {
        if (!TOOL_SEARCH_ENABLED || discoveredTools.length === 0) return tools;
        // Dedupe by name (core tools + discovered)
        const seen = new Set(tools.map(t => t.name));
        const extra = discoveredTools.filter(t => !seen.has(t.name));
        return [...tools, ...extra];
      };

      let response: Anthropic.Message;
      try {
        const activeTools = getActiveTools();
        response = await createMessage({
          model: modelId,
          max_tokens: 1024,
          system: finalSystemPrompt,
          tools: activeTools as Anthropic.Tool[],
          messages,
        });
      } catch (err: unknown) {
        // Handle prompt-too-long gracefully instead of crashing
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('prompt is too long') || errMsg.includes('too many tokens')) {
          logger.warn({ error: errMsg }, 'Prompt exceeded context window');
          return 'This conversation has gotten too long for me to process. Please start a new conversation and I\'ll be happy to help!';
        }
        throw err;
      }

      // Use actual API token count for accurate context tracking
      if (response.usage) {
        lastKnownInputTokens = response.usage.input_tokens;
        logger.info(
          { inputTokens: lastKnownInputTokens, max: modelContextWindow },
          'Actual API token usage'
        );
      }

      // Tool use loop
      while (response.stop_reason === 'tool_use') {
        const assistantContent = response.content;
        messages.push({ role: 'assistant', content: assistantContent });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of assistantContent) {
          if (block.type === 'tool_use') {
            logger.info(`Executing tool: ${block.name}`);

            // =========================================================================
            // HOOKS: tool:before_call - Can modify params or block execution
            // =========================================================================
            const toolParams = block.input as Record<string, unknown>;
            const { ctx: toolBeforeCtx, result: toolBeforeResult } = await hooks.triggerWithResult<ToolCallResult>(
              'tool:before_call',
              {
                message: processedMessage,
                session,
                toolName: block.name,
                toolParams,
                data: {
                  toolName: block.name,
                  toolParams,
                },
              } as Partial<ToolHookContext>
            );

            // Check if hook blocked the tool
            if (toolBeforeResult?.block) {
              logger.warn({ tool: block.name, reason: toolBeforeResult.blockReason }, 'Tool blocked by hook');
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ error: `Tool blocked: ${toolBeforeResult.blockReason || 'Unknown reason'}` }),
              });
              continue;
            }

            // Use potentially modified params
            const finalParams = toolBeforeResult?.params || toolParams;

            const toolStart = Date.now();
            let announced = false;
            let announceTimer: NodeJS.Timeout | null = null;

            const notifyToolStatus = async (text: string): Promise<void> => {
              try {
                await sendMessage({
                  platform: processedMessage.platform,
                  chatId: processedMessage.chatId,
                  text,
                });
              } catch (error) {
                logger.debug({ error, tool: block.name }, 'Tool status notification failed');
              }
            };

            if (STREAM_TOOL_CALLS_ENABLED && TOOL_STREAM_DELAY_MS > 0) {
              announceTimer = setTimeout(() => {
                announced = true;
                void notifyToolStatus(`Running tool: ${block.name}...`);
              }, TOOL_STREAM_DELAY_MS);
            }

            let result: string;

            // Handle tool_search in-scope (needs access to toolRegistry)
            if (block.name === 'tool_search' && TOOL_SEARCH_ENABLED) {
              const { platform, category, query } = finalParams as { platform?: string; category?: string; query?: string };
              let searchResults: ToolDefinition[];

              // Uses intersection when both platform and category provided.
              // When platform/category AND query are both given, use structured search
              // (query is just a hint the LLM adds — platform/category are authoritative).
              if (platform || category) {
                searchResults = toolRegistry.search({ platform, category });
                // If structured search found nothing and a text query was also given, try text search
                if (searchResults.length === 0 && query) {
                  searchResults = toolRegistry.searchByText(query);
                }
              } else if (query) {
                searchResults = toolRegistry.searchByText(query);
              } else {
                searchResults = [];
              }

              // Take top 25 results
              const topResults = searchResults.slice(0, 25);

              // Store discovered tools for next API call (dedupe)
              const alreadyDiscovered = new Set(discoveredTools.map(t => t.name));
              for (const t of topResults) {
                if (!alreadyDiscovered.has(t.name)) {
                  discoveredTools.push(t);
                }
              }

              result = JSON.stringify({
                found: topResults.length,
                total_available: searchResults.length,
                tools: topResults.map(t => ({
                  name: t.name,
                  description: t.description,
                })),
                hint: topResults.length > 0
                  ? 'These tools are now available for you to use. Call them directly.'
                  : 'No tools found. Try a different search query or platform.',
              });
              logger.info({ platform, category, query, found: topResults.length }, 'tool_search executed');
            } else {
              result = await executeTool(
                block.name,
                finalParams,
                context
              );
            }

            if (announceTimer) {
              clearTimeout(announceTimer);
              announceTimer = null;
            }

            if (announced && STREAM_TOOL_CALLS_ENABLED) {
              const elapsedMs = Date.now() - toolStart;
              void notifyToolStatus(`Finished tool: ${block.name} (${elapsedMs}ms)`);
            }

            // =========================================================================
            // HOOKS: tool:after_call - Fire-and-forget notification
            // =========================================================================
            hooks.trigger('tool:after_call', {
              message: processedMessage,
              session,
              toolName: block.name,
              toolParams: finalParams,
              data: {
                toolName: block.name,
                toolParams: finalParams,
                toolResult: result,
              },
            } as Partial<ToolHookContext>);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });

        // =========================================================================
        // CONTEXT CHECK - Compact if approaching limit during tool loop
        // =========================================================================
        // Track new messages in context manager
        for (const result of toolResults) {
          const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
          contextManager.addMessage({
            role: 'user',
            content,
          });
        }

        const loopGuard = contextManager.checkGuard();
        if (loopGuard.shouldCompact) {
          logger.info({ percentUsed: loopGuard.percentUsed }, 'Compacting context during tool loop');
          const loopCompactResult = await contextManager.compact();
          if (loopCompactResult.success) {
            const compactedMessages = contextManager.getMessagesForApi();
            messages.length = 0;
            for (const msg of compactedMessages) {
              messages.push({
                role: msg.role === 'system' ? 'user' : msg.role,
                content: msg.content,
              });
            }
            sessionManager.saveCheckpoint(session, loopCompactResult.summary);
          }
        }

        try {
          const activeTools = getActiveTools();
          response = await createMessage({
            model: modelId,
            max_tokens: 1024,
            system: finalSystemPrompt,
            tools: activeTools as Anthropic.Tool[],
            messages,
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg.includes('prompt is too long') || errMsg.includes('too many tokens')) {
            logger.warn({ error: errMsg }, 'Prompt exceeded context window during tool loop');
            break;
          }
          throw err;
        }

        // Update actual token usage after each API call
        if (response.usage) {
          lastKnownInputTokens = response.usage.input_tokens;
          // If actual usage is approaching limit, force compaction next iteration
          if (lastKnownInputTokens > modelContextWindow * 0.85) {
            logger.info({ inputTokens: lastKnownInputTokens }, 'API reports high token usage, will compact');
            const urgentCompact = await contextManager.compact();
            if (urgentCompact.success) {
              const compactedMessages = contextManager.getMessagesForApi();
              messages.length = 0;
              for (const msg of compactedMessages) {
                messages.push({
                  role: msg.role === 'system' ? 'user' : msg.role,
                  content: msg.content,
                });
              }
            }
          }
        }
      }

      // Extract text response
      const responseText = extractResponseText(response);

      // Save assistant response to history
      if (responseText) {
        addToHistory('assistant', responseText);
      }

      // Update session
      session.context.messageCount++;
      session.updatedAt = new Date();

      const finalResponse = responseText || 'Done.';

      // =========================================================================
      // HOOKS: agent:end - Agent finished processing
      // =========================================================================
      hooks.trigger('agent:end', {
        message: processedMessage,
        session,
        data: {
          agentId: session.context.routedAgentId || 'default',
          response: finalResponse,
        },
      });

      // =========================================================================
      // HOOKS: message:after - Fire-and-forget after message processing
      // =========================================================================
      hooks.trigger('message:after', {
        message: processedMessage,
        session,
        response: { text: finalResponse, platform: processedMessage.platform } as OutgoingMessage,
      });

      // Auto memory capture (fire-and-forget)
      if (memory && config.memory?.auto?.enabled !== false) {
        const memoryAuto = config.memory?.auto || {};
        const channelKey = processedMessage.chatId || processedMessage.platform;
        const scope = memoryAuto.scope === 'channel' ? channelKey : 'global';
        const minIntervalMs = memoryAuto.minIntervalMs ?? 2 * 60 * 1000;
        const lastCaptureAt = (session.context as { lastMemoryCaptureAt?: number }).lastMemoryCaptureAt ?? 0;
        const maxItems = memoryAuto.maxItemsPerType ?? 5;
        const profileUpdateEvery = memoryAuto.profileUpdateEvery ?? 6;
        const excludeSensitive = memoryAuto.excludeSensitive !== false;
        const turnCount = session.context.messageCount;

        if (Date.now() - lastCaptureAt >= minIntervalMs) {
          (session.context as { lastMemoryCaptureAt?: number }).lastMemoryCaptureAt = Date.now();

          void (async () => {
            const userText = sanitizeMemoryText(processedMessage.text || '');
            const assistantText = sanitizeMemoryText(finalResponse || '');

            if (!userText && !assistantText) return;
            if (excludeSensitive && containsSensitiveMemory(`${userText}\n${assistantText}`)) return;

            const extractInput = `User: ${userText}\nAssistant: ${assistantText}`;
            const extraction = await extractMemoryWithClaude(client, extractInput, maxItems);
            if (!extraction) return;

            const facts = limitItems(extraction.facts, maxItems);
            const prefs = limitItems(extraction.preferences, maxItems);
            const notes = limitItems(extraction.notes, maxItems);

            for (const fact of facts) {
              memory.remember(session.userId, scope, 'fact', fact.key, fact.value);
            }
            for (const pref of prefs) {
              memory.remember(session.userId, scope, 'preference', pref.key, pref.value);
            }
            for (const note of notes) {
              memory.remember(session.userId, scope, 'note', note.key, note.value);
            }

            if (extraction.profile_summary && turnCount % profileUpdateEvery === 0) {
              memory.remember(session.userId, scope, 'profile', 'profile', extraction.profile_summary);
            }

            if (extraction.summary) {
              const topics = Array.isArray(extraction.topics) ? extraction.topics.slice(0, 8) : [];
              const date = new Date().toISOString().slice(0, 10);
              memory.logDaily(session.userId, scope, date, extraction.summary, 1, topics);
            }
          })().catch((error) => {
            logger.debug({ error }, 'Memory auto-capture failed');
          });
        }
      }

      if (streamedResponseSent) {
        return null;
      }
      return finalResponse;
    } catch (error) {
      logger.error({ err: error }, 'Agent error');

      // =========================================================================
      // HOOKS: error - Error occurred during processing
      // =========================================================================
      hooks.trigger('error', {
        message,  // Use original message in case processedMessage wasn't created
        session,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      return 'Sorry, I encountered an error. Please try again.';
    }
  }

  return {
    handleMessage,
    dispose() {
      // Cleanup rate limit interval
      clearInterval(rateLimitCleanupInterval);
      logger.info('Agent manager disposed');
    },
    reloadSkills() {
      skills.reload();
    },
    getSkillCommands() {
      return skills.getEnabledSkills().map(s => ({
        name: s.name,
        description: s.description,
        subcommands: s.subcommands || [],
      }));
    },
    reloadConfig(nextConfig: Config) {
      // This method acts as a signal hook; most config is read lazily via getConfig().
      logger.info(
        {
          model: nextConfig.agents.defaults.model.primary,
          workspace: nextConfig.agents.defaults.workspace,
        },
        'Agent manager received config reload signal'
      );
      ensureRateLimiter();
    },
  };
}
