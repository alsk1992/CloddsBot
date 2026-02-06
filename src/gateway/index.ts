/**
 * Gateway Module - Clawdbot-style WebSocket gateway protocol
 *
 * Features:
 * - WebSocket server for remote connections
 * - Binary and JSON message support
 * - Connection authentication
 * - Heartbeat/keepalive
 * - Message routing
 * - Session management
 */

import { WebSocket, WebSocketServer, RawData } from 'ws';
import * as http from 'http';
import * as https from 'https';
import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';
import { RateLimiter, type RateLimitConfig } from '../security';
import type { Config, IncomingMessage, OutgoingMessage, ReactionMessage, PollMessage, Platform } from '../types';
import { createServer as createHttpGatewayServer } from './server';
import { createX402Client, type X402Client } from '../payments/x402';
import { createDatabase } from '../db';
import { createMigrationRunner } from '../db/migrations';
import { initACP } from '../acp';
import { initOrderPersistence } from '../execution/order-persistence';
import { createFeedManager } from '../feeds';
import { createSessionManager } from '../sessions';
import { createAgentManager } from '../agents';
import { createChannelManager } from '../channels';
import { createPairingService } from '../pairing';
import { createMemoryService } from '../memory';
import { createCronService, type CronService } from '../cron';
import { createCredentialsManager } from '../credentials';
import { createCommandRegistry, createDefaultCommands } from '../commands/registry';
import { createWebhookManager } from '../automation';
import { createWebhookTool, WebhookTool } from '../tools/webhooks';
import { createProviders, createProviderHealthMonitor, ProviderHealthMonitor } from '../providers';
import { createMonitoringService, MonitoringService } from '../monitoring';
import { createEmbeddingsService } from '../embeddings';
import { createMarketIndexService } from '../market-index';
import { createOpportunityFinder, type OpportunityFinder } from '../opportunity';
import { createWhaleTracker, type WhaleTracker } from '../feeds/polymarket/whale-tracker';
import { createCopyTradingService, type CopyTradingService } from '../trading/copy-trading';
import { createSmartRouter, type SmartRouter } from '../execution/smart-router';
import { createExecutionService, type ExecutionService } from '../execution';
import { createRealtimeAlertsService, connectWhaleTracker, connectOpportunityFinder, type RealtimeAlertsService } from '../alerts';
import { createOpportunityExecutor, type OpportunityExecutor } from '../opportunity/executor';
import { createTickRecorder, type TickRecorder } from '../services/tick-recorder';
import { createTickStreamer, type TickStreamer } from '../services/tick-streamer';
import { createBittensorService, type BittensorService } from '../bittensor';
import { createBittensorRouter } from '../bittensor/server';
import { setBittensorService } from '../agents/handlers/bittensor';
import { createFeatureEngineering, setFeatureEngine, type FeatureEngineering } from '../services/feature-engineering';
import { createAltDataService, type AltDataService, type EmbeddingsLike, type FeedManagerLike } from '../services/alt-data';
import { createExecutionProducer, createQueuedExecutionService, type ExecutionProducer } from '../queue/jobs';
import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import { loadConfig, CONFIG_FILE } from '../utils/config';
import { configureHttpClient } from '../utils/http';
import { normalizeIncomingMessage } from '../messages/unified';
import { setupShutdownHandlers, onShutdown, trackError } from '../utils/production';
import { createSignalBus, type SignalBus } from './signal-bus';

// =============================================================================
// TYPES
// =============================================================================

export interface GatewayConfig {
  port?: number;
  host?: string;
  path?: string;
  ssl?: { cert: string; key: string };
  auth?: {
    type: 'token' | 'basic' | 'none';
    tokens?: string[];
    users?: Record<string, string>;
  };
  heartbeatInterval?: number;
  maxClients?: number;
}

export interface GatewayClient {
  id: string;
  socket: WebSocket;
  authenticated: boolean;
  metadata: Record<string, unknown>;
  connectedAt: Date;
  lastHeartbeat: Date;
}

export interface GatewayMessage {
  op: number;
  d?: unknown;
  t?: string;
  s?: number;
}

export const GatewayOpcodes = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 3,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
};

// =============================================================================
// GATEWAY SERVER
// =============================================================================

export class GatewayServer extends EventEmitter {
  private config: GatewayConfig;
  private server: http.Server | https.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, GatewayClient> = new Map();
  private heartbeatChecker: NodeJS.Timeout | null = null;
  private sequence = 0;

  constructor(config: GatewayConfig = {}) {
    super();
    this.config = {
      port: config.port ?? 8080,
      host: config.host ?? '0.0.0.0',
      path: config.path ?? '/gateway',
      heartbeatInterval: config.heartbeatInterval ?? 45000,
      maxClients: config.maxClients ?? 1000,
      auth: config.auth ?? { type: 'none' },
      ...config,
    };
  }

  /** Start the gateway server */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      // Create HTTP(S) server
      if (this.config.ssl) {
        const fs = require('fs');
        this.server = https.createServer({
          cert: fs.readFileSync(this.config.ssl.cert),
          key: fs.readFileSync(this.config.ssl.key),
        });
      } else {
        this.server = http.createServer();
      }

      // Create WebSocket server
      this.wss = new WebSocketServer({
        server: this.server,
        path: this.config.path,
      });

      this.wss.on('connection', (socket, request) => {
        this.handleConnection(socket, request);
      });

      // Start heartbeat checker
      this.heartbeatChecker = setInterval(() => {
        this.checkHeartbeats();
      }, this.config.heartbeatInterval);

      // Start listening
      this.server.listen(this.config.port, this.config.host, () => {
        const protocol = this.config.ssl ? 'wss' : 'ws';
        logger.info({
          url: `${protocol}://${this.config.host}:${this.config.port}${this.config.path}`,
        }, 'Gateway server started');
        resolve();
      });
    });
  }

  /** Stop the gateway server */
  async stop(): Promise<void> {
    if (this.heartbeatChecker) {
      clearInterval(this.heartbeatChecker);
      this.heartbeatChecker = null;
    }

    for (const client of this.clients.values()) {
      this.send(client, { op: GatewayOpcodes.RECONNECT });
      client.socket.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          if (this.server) {
            this.server.close(() => {
              logger.info('Gateway server stopped');
              resolve();
            });
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /** Send message to a client */
  send(client: GatewayClient, message: GatewayMessage): void {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }

  /** Broadcast to all authenticated clients */
  broadcast(message: GatewayMessage, filter?: (client: GatewayClient) => boolean): void {
    for (const client of this.clients.values()) {
      if (client.authenticated && (!filter || filter(client))) {
        this.send(client, message);
      }
    }
  }

  /** Dispatch an event to all clients */
  dispatch(event: string, data: unknown): void {
    this.sequence++;
    this.broadcast({
      op: GatewayOpcodes.DISPATCH,
      t: event,
      d: data,
      s: this.sequence,
    });
  }

  /** Get connected clients */
  getClients(): GatewayClient[] {
    return Array.from(this.clients.values());
  }

  /** Get client by ID */
  getClient(id: string): GatewayClient | undefined {
    return this.clients.get(id);
  }

  /** Disconnect a client */
  disconnect(id: string, code = 1000, reason = ''): void {
    const client = this.clients.get(id);
    if (client) {
      client.socket.close(code, reason);
      this.clients.delete(id);
    }
  }

  private handleConnection(socket: WebSocket, request: http.IncomingMessage): void {
    if (this.clients.size >= this.config.maxClients!) {
      socket.close(1013, 'Server at capacity');
      return;
    }

    const clientId = this.generateClientId();
    const client: GatewayClient = {
      id: clientId,
      socket,
      authenticated: this.config.auth?.type === 'none',
      metadata: {},
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
    };

    this.clients.set(clientId, client);
    logger.debug({ clientId }, 'Gateway client connected');

    this.send(client, {
      op: GatewayOpcodes.HELLO,
      d: {
        heartbeat_interval: this.config.heartbeatInterval,
        session_id: clientId,
      },
    });

    socket.on('message', (data) => {
      this.handleMessage(client, data);
    });

    socket.on('close', (code, reason) => {
      this.clients.delete(clientId);
      this.emit('disconnect', { clientId, code, reason: reason.toString() });
      logger.debug({ clientId, code }, 'Gateway client disconnected');
    });

    socket.on('error', (error) => {
      logger.error({ clientId, error }, 'Gateway client error');
    });

    this.emit('connection', client);
  }

  private handleMessage(client: GatewayClient, data: RawData): void {
    try {
      const message = JSON.parse(data.toString()) as GatewayMessage;

      switch (message.op) {
        case GatewayOpcodes.HEARTBEAT:
          client.lastHeartbeat = new Date();
          this.send(client, { op: GatewayOpcodes.HEARTBEAT_ACK });
          break;

        case GatewayOpcodes.IDENTIFY:
          this.handleIdentify(client, message.d as {
            token?: string;
            username?: string;
            password?: string;
          });
          break;

        case GatewayOpcodes.RESUME:
          client.authenticated = true;
          this.emit('resume', { client, data: message.d });
          break;

        case GatewayOpcodes.DISPATCH:
          if (client.authenticated) {
            this.emit('message', {
              client,
              event: message.t,
              data: message.d,
            });
          }
          break;
      }
    } catch (error) {
      logger.warn({ clientId: client.id, error }, 'Invalid gateway message');
    }
  }

  private handleIdentify(client: GatewayClient, data: {
    token?: string;
    username?: string;
    password?: string;
  } = {}): void {
    let authenticated = false;

    switch (this.config.auth?.type) {
      case 'none':
        authenticated = true;
        break;
      case 'token':
        authenticated = this.config.auth.tokens?.includes(data.token || '') ?? false;
        break;
      case 'basic':
        if (data.username && data.password) {
          authenticated = this.config.auth.users?.[data.username] === data.password;
        }
        break;
    }

    if (authenticated) {
      client.authenticated = true;
      client.metadata = { ...data, password: undefined };
      this.emit('identify', client);
      this.dispatch('READY', { session_id: client.id });
    } else {
      this.send(client, { op: GatewayOpcodes.INVALID_SESSION, d: false });
      client.socket.close(4001, 'Authentication failed');
    }
  }

  private checkHeartbeats(): void {
    const timeout = this.config.heartbeatInterval! * 2;
    const now = Date.now();

    for (const [id, client] of this.clients) {
      if (now - client.lastHeartbeat.getTime() > timeout) {
        logger.debug({ clientId: id }, 'Client heartbeat timeout');
        client.socket.close(4009, 'Heartbeat timeout');
        this.clients.delete(id);
      }
    }
  }

  private generateClientId(): string {
    return randomBytes(16).toString('hex');
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createGatewayServer(config?: GatewayConfig): GatewayServer {
  return new GatewayServer(config);
}

export interface AppGateway {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Create the full application gateway (HTTP + channels + agent).
 *
 * This wires together:
 * - HTTP/WebSocket server (for webchat + health)
 * - Channel manager (Telegram/Slack/etc)
 * - Sessions, feeds, DB, memory
 * - Command registry and command handling
 * - Agent manager for non-command messages
 */
export async function createGateway(config: Config): Promise<AppGateway> {
  let currentConfig = config;
  configureHttpClient(currentConfig.http);
  const configPath = process.env.CLODDS_CONFIG_PATH || CONFIG_FILE;
  const db = createDatabase();
  try {
    const runner = createMigrationRunner(db);
    runner.migrate();
  } catch (error) {
    logger.error({ error }, 'Database migration failed');
    throw error;
  }

  // Initialize ACP (Agent Commerce Protocol) with database
  initACP(db);

  // Initialize order persistence for TWAP and bracket orders
  initOrderPersistence(db);

  let feeds = await createFeedManager(config.feeds);
  const sessions = createSessionManager(db, config.session);
  const memory = createMemoryService(db);
  const pairing = createPairingService(db);
  const webhookManager = createWebhookManager();
  const providerManager = createProviders({
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
    ollamaUrl: process.env.OLLAMA_URL,
    groqKey: process.env.GROQ_API_KEY,
    togetherKey: process.env.TOGETHER_API_KEY,
    fireworksKey: process.env.FIREWORKS_API_KEY,
    geminiKey: process.env.GEMINI_API_KEY,
  });
  const providerHealth: ProviderHealthMonitor | null =
    providerManager.list().length > 0
      ? createProviderHealthMonitor(providerManager)
      : null;
  let monitoring: MonitoringService | null = null;

  const commands = createCommandRegistry();
  commands.registerMany(createDefaultCommands());

  const httpGateway = createHttpGatewayServer(
    { ...config.gateway, x402: config.x402 },
    webhookManager,
    db
  );

  let channels: Awaited<ReturnType<typeof createChannelManager>> | null = null;
  const watchers: FSWatcher[] = [];
  let started = false;
  let reloadInFlight: Promise<void> | null = null;
  let pendingReload = false;
  let channelRateLimitCleanupInterval: NodeJS.Timeout | null = null;
  let positionPriceUpdateInterval: NodeJS.Timeout | null = null;
  let marketCacheCleanupInterval: NodeJS.Timeout | null = null;
  let marketIndexSyncInterval: NodeJS.Timeout | null = null;
  const channelRateLimiters = new Map<string, { config: RateLimitConfig; limiter: RateLimiter }>();
  const embeddings = createEmbeddingsService(db);
  const marketIndex = createMarketIndexService(db, embeddings, {
    platformWeights: config.marketIndex?.platformWeights,
  });
  const cronCredentials = createCredentialsManager(db);
  let cronService: CronService | null = null;

  // Create opportunity finder for cross-platform arbitrage detection
  const opportunityFinder: OpportunityFinder | null = config.opportunityFinder?.enabled !== false
    ? createOpportunityFinder(db, feeds, embeddings, {
        minEdge: config.opportunityFinder?.minEdge ?? 0.5,
        minLiquidity: config.opportunityFinder?.minLiquidity ?? 100,
        platforms: config.opportunityFinder?.platforms,
        realtime: config.opportunityFinder?.realtime ?? false,
        scanIntervalMs: config.opportunityFinder?.scanIntervalMs ?? 10000,
        semanticMatching: config.opportunityFinder?.semanticMatching ?? true,
        similarityThreshold: config.opportunityFinder?.similarityThreshold ?? 0.85,
        includeInternal: config.opportunityFinder?.includeInternal ?? true,
        includeCross: config.opportunityFinder?.includeCross ?? true,
        includeEdge: config.opportunityFinder?.includeEdge ?? true,
      })
    : null;

  // Create whale tracker for monitoring large trades
  let whaleTracker: WhaleTracker | null = config.whaleTracking?.enabled
    ? createWhaleTracker({
        minTradeSize: config.whaleTracking?.minTradeSize ?? 10000,
        minPositionSize: config.whaleTracking?.minPositionSize ?? 50000,
        enableRealtime: config.whaleTracking?.realtime ?? true,
      })
    : null;

  // Create Bittensor mining service if enabled
  let bittensorService: BittensorService | null = null;
  if (config.bittensor?.enabled) {
    const btConfig: import('../bittensor/types').BittensorConfig = {
      enabled: true,
      network: config.bittensor.network ?? 'mainnet',
      subtensorUrl: config.bittensor.subtensorUrl,
      coldkeyPath: config.bittensor.coldkeyPath,
      coldkeyPassword: config.bittensor.coldkeyPassword,
      pythonPath: config.bittensor.pythonPath,
      subnets: config.bittensor.subnets as import('../bittensor/types').SubnetMinerConfig[] | undefined,
      earningsPollIntervalMs: config.bittensor.earningsPollIntervalMs,
      taoPriceUsd: config.bittensor.taoPriceUsd,
    };
    bittensorService = createBittensorService(btConfig, db);
    setBittensorService(bittensorService);
    const bittensorRouter = createBittensorRouter(bittensorService);
    httpGateway.setBittensorRouter(bittensorRouter);
    logger.info({ network: btConfig.network }, 'Bittensor service created');
  }

  // Create alt-data sentiment pipeline if enabled
  let altDataService: AltDataService | null = null;

  // Create execution service for real trading
  let executionService: ExecutionService | null = null;
  if (config.trading?.enabled) {
    const poly = config.trading.polymarket;
    const kalshi = config.trading.kalshi;
    const opinionCfg = config.trading.opinion;
    const hasPolymarketCreds = poly?.address && poly?.apiKey && poly?.apiSecret && poly?.apiPassphrase;
    const hasKalshiCreds = kalshi?.apiKeyId && kalshi?.privateKeyPem;
    const hasOpinionCreds = opinionCfg?.apiKey && opinionCfg?.privateKey && opinionCfg?.vaultAddress;
    const predictfunCfg = config.trading?.predictfun;
    const hasPredictFunCreds = !!predictfunCfg?.privateKey;

    if (hasPolymarketCreds || hasKalshiCreds || hasOpinionCreds || hasPredictFunCreds) {
      executionService = createExecutionService({
        polymarket: hasPolymarketCreds ? {
          address: poly!.address,
          apiKey: poly!.apiKey,
          apiSecret: poly!.apiSecret,
          apiPassphrase: poly!.apiPassphrase,
          privateKey: poly!.privateKey,
          funderAddress: (poly as any)?.funderAddress || poly!.address,
          signatureType: (poly as any)?.signatureType as number | undefined,
        } : undefined,
        kalshi: hasKalshiCreds ? {
          apiKeyId: kalshi!.apiKeyId,
          privateKeyPem: kalshi!.privateKeyPem,
        } : undefined,
        opinion: hasOpinionCreds ? {
          apiKey: opinionCfg!.apiKey,
          privateKey: opinionCfg!.privateKey,
          multiSigAddress: opinionCfg!.vaultAddress,
          rpcUrl: opinionCfg!.rpcUrl,
        } : undefined,
        predictfun: hasPredictFunCreds ? {
          privateKey: predictfunCfg!.privateKey,
          predictAccount: predictfunCfg!.predictAccount,
          rpcUrl: predictfunCfg!.rpcUrl,
          apiKey: predictfunCfg!.apiKey,
        } : undefined,
        maxOrderSize: config.trading.maxOrderSize ?? 1000,
        dryRun: config.trading.dryRun ?? false,
      });
      logger.info({
        dryRun: config.trading.dryRun ?? false,
        polymarket: !!hasPolymarketCreds,
        kalshi: !!hasKalshiCreds,
        opinion: !!hasOpinionCreds,
        predictfun: !!hasPredictFunCreds,
      }, 'Execution service initialized');
    } else {
      logger.warn('Trading enabled but no platform credentials configured');
    }
  }

  // Execution queue setup — reads from config.queue or env vars.
  // Decouples gateway from execution: orders go through BullMQ.
  // Only agent tool handlers use the queued wrapper; other services
  // (copy trading, arbitrage executor) keep using the direct service
  // since they need the full ExecutionService interface.
  let executionProducer: ExecutionProducer | null = null;
  let queuedExecutionRef: import('../types').ExecutionServiceRef | null = null;
  const queueRedisHost = config.queue?.redis?.host || process.env.REDIS_HOST;
  const queueEnabled = config.queue?.enabled ?? !!queueRedisHost;
  if (queueEnabled && queueRedisHost && executionService) {
    try {
      const queueRedisPort = config.queue?.redis?.port
        ?? parseInt(process.env.REDIS_PORT || '6379', 10);
      const queueRedisPassword = config.queue?.redis?.password
        || process.env.REDIS_PASSWORD || undefined;
      const queueTimeoutMs = config.queue?.timeoutMs
        ?? parseInt(process.env.EXECUTION_QUEUE_TIMEOUT_MS || '30000', 10);

      executionProducer = createExecutionProducer({
        redis: {
          host: queueRedisHost,
          port: queueRedisPort,
          password: queueRedisPassword,
          maxRetriesPerRequest: null,
        },
        defaultTimeoutMs: queueTimeoutMs,
      });

      // Create queue-based wrapper for agent tool handlers only
      queuedExecutionRef = createQueuedExecutionService(executionProducer);

      logger.info(
        { redisHost: queueRedisHost, redisPort: queueRedisPort },
        'Execution queue enabled - agent orders will be processed via BullMQ worker'
      );
    } catch (error) {
      logger.warn(
        { error },
        'Failed to create execution queue producer - falling back to direct execution'
      );
    }
  }

  // Create copy trading service
  let copyTrading: CopyTradingService | null = null;
  if (config.copyTrading?.enabled && whaleTracker) {
    copyTrading = createCopyTradingService(whaleTracker, executionService, {
      followedAddresses: config.copyTrading?.followedAddresses ?? [],
      sizingMode: config.copyTrading?.sizingMode ?? 'fixed',
      fixedSize: config.copyTrading?.fixedSize ?? 100,
      proportionMultiplier: config.copyTrading?.proportionalMultiplier ?? 0.1,
      portfolioPercentage: config.copyTrading?.portfolioPercentage ?? 1,
      maxPositionSize: config.copyTrading?.maxPositionSize ?? 500,
      copyDelayMs: config.copyTrading?.copyDelayMs ?? 5000,
      dryRun: executionService ? (config.copyTrading?.dryRun ?? false) : true,
    });
  }

  // Create smart router for order routing
  const smartRouter: SmartRouter | null = config.smartRouting?.enabled !== false
    ? createSmartRouter(feeds, {
        mode: config.smartRouting?.mode ?? 'balanced',
        enabledPlatforms: config.smartRouting?.platforms ?? ['polymarket', 'kalshi'],
        maxSlippage: config.smartRouting?.maxSlippage ?? 1,
        preferMaker: config.smartRouting?.preferMaker ?? true,
        allowSplitting: config.smartRouting?.allowSplitting ?? false,
      })
    : null;

  // Realtime alerts service (created after sendMessage is defined)
  let realtimeAlerts: RealtimeAlertsService | null = null;
  let whaleTrackerCleanup: (() => void) | null = null;
  let opportunityFinderCleanup: (() => void) | null = null;

  // Auto-arbitrage executor
  let arbitrageExecutor: OpportunityExecutor | null = null;

  // Tick recorder for historical data
  let tickRecorder: TickRecorder | null = null;

  // Tick streamer for real-time WebSocket streaming
  let tickStreamer: TickStreamer | null = null;

  // Feature engineering for computing trading indicators
  let featureEngine: FeatureEngineering | null = null;

  const sendMessage = async (message: OutgoingMessage): Promise<string | null> => {
    if (!channels) {
      logger.warn({ platform: message.platform }, 'Channel manager not ready; dropping message');
      return null;
    }
    return channels.send(message);
  };

  const editMessage = async (message: OutgoingMessage & { messageId: string }): Promise<void> => {
    if (!channels) {
      logger.warn({ platform: message.platform }, 'Channel manager not ready; dropping edit');
      return;
    }
    await channels.edit(message);
  };

  const deleteMessage = async (message: OutgoingMessage & { messageId: string }): Promise<void> => {
    if (!channels) {
      logger.warn({ platform: message.platform }, 'Channel manager not ready; dropping delete');
      return;
    }
    await channels.delete(message);
  };

  const reactMessage = async (message: ReactionMessage): Promise<void> => {
    if (!channels) {
      logger.warn({ platform: message.platform }, 'Channel manager not ready; dropping reaction');
      return;
    }
    await channels.react(message);
  };

  const createPoll = async (message: PollMessage): Promise<string | null> => {
    if (!channels) {
      logger.warn({ platform: message.platform }, 'Channel manager not ready; dropping poll');
      return null;
    }
    return channels.sendPoll(message);
  };

  // Initialize realtime alerts if enabled
  if (config.realtimeAlerts?.enabled) {
    realtimeAlerts = createRealtimeAlertsService(sendMessage, {
      enabled: true,
      targets: config.realtimeAlerts.targets?.map(t => ({
        platform: t.platform as any,
        chatId: t.chatId,
        accountId: t.accountId,
      })),
      whaleTrades: config.realtimeAlerts.whaleTrades,
      arbitrage: config.realtimeAlerts.arbitrage,
      priceMovement: config.realtimeAlerts.priceMovement,
      copyTrading: config.realtimeAlerts.copyTrading,
    });

    // Connect to whale tracker if available
    if (whaleTracker) {
      whaleTrackerCleanup = connectWhaleTracker(realtimeAlerts, whaleTracker);
    }

    // Connect to opportunity finder if available
    if (opportunityFinder) {
      opportunityFinderCleanup = connectOpportunityFinder(realtimeAlerts, opportunityFinder);
    }

    logger.info({ targets: config.realtimeAlerts.targets?.length ?? 0 }, 'Realtime alerts service initialized');
  }

  // Initialize auto-arbitrage executor if enabled
  if (config.arbitrageExecution?.enabled && opportunityFinder) {
    const wantsDryRun = config.arbitrageExecution?.dryRun ?? false;
    const effectiveDryRun = executionService ? wantsDryRun : true;

    if (!executionService && !wantsDryRun) {
      logger.warn('arbitrageExecution.dryRun=false but no execution service available - forcing dry run');
    }

    arbitrageExecutor = createOpportunityExecutor(opportunityFinder, executionService, {
      dryRun: effectiveDryRun,
      minEdge: config.arbitrageExecution?.minEdge ?? 1.0,
      minLiquidity: config.arbitrageExecution?.minLiquidity ?? 500,
      maxPositionSize: config.arbitrageExecution?.maxPositionSize ?? 100,
      maxDailyLoss: config.arbitrageExecution?.maxDailyLoss ?? 500,
      maxConcurrentPositions: config.arbitrageExecution?.maxConcurrentPositions ?? 3,
      enabledPlatforms: config.arbitrageExecution?.platforms ?? ['polymarket', 'kalshi'],
      preferMakerOrders: config.arbitrageExecution?.preferMakerOrders ?? true,
      confirmationDelayMs: config.arbitrageExecution?.confirmationDelayMs ?? 0,
    }, smartRouter);

    logger.info({ dryRun: effectiveDryRun, hasExecutionService: !!executionService }, 'Arbitrage executor initialized');
  }

  // Initialize tick recorder if enabled
  if (config.tickRecorder?.enabled && config.tickRecorder.connectionString) {
    tickRecorder = createTickRecorder({
      enabled: true,
      connectionString: config.tickRecorder.connectionString,
      batchSize: config.tickRecorder.batchSize,
      flushIntervalMs: config.tickRecorder.flushIntervalMs,
      retentionDays: config.tickRecorder.retentionDays,
      platforms: config.tickRecorder.platforms,
    });

    logger.info(
      { platforms: config.tickRecorder.platforms ?? 'all' },
      'Tick recorder initialized (will start with gateway)'
    );
  }

  // Initialize tick streamer for real-time WebSocket streaming
  tickStreamer = createTickStreamer({
    maxSubscriptionsPerClient: 100,
    pingIntervalMs: 30000,
    connectionTimeoutMs: 60000,
  });

  // Initialize feature engineering for computing trading indicators
  featureEngine = createFeatureEngineering({
    tickWindowSize: 100,
    orderbookWindowSize: 50,
    momentumLookback: 20,
    volatilityLookback: 50,
  });

  // Make feature engine available globally for other services
  setFeatureEngine(featureEngine);

  // ── Signal Bus: single subscription point for all feed consumers ──────────
  const signalBus = createSignalBus();

  // Tick consumers (error-isolated via signal bus)
  signalBus.onTick((update) => tickRecorder?.recordTick(update));
  signalBus.onTick((update) => {
    if (tickStreamer && update.outcomeId) {
      tickStreamer.broadcastTick({
        platform: update.platform,
        marketId: update.marketId,
        outcomeId: update.outcomeId,
        price: update.price,
        prevPrice: update.prevPrice ?? null,
        timestamp: update.timestamp,
      });
    }
  });
  signalBus.onTick((update) => {
    if (featureEngine && update.outcomeId) {
      featureEngine.processTick({
        platform: update.platform,
        marketId: update.marketId,
        outcomeId: update.outcomeId,
        price: update.price,
        prevPrice: update.prevPrice ?? null,
        timestamp: update.timestamp,
      });
    }
  });

  // Orderbook consumers
  signalBus.onOrderbook((update) => tickRecorder?.recordOrderbook(update));
  signalBus.onOrderbook((update) => {
    if (tickStreamer) {
      tickStreamer.broadcastOrderbook({
        platform: update.platform,
        marketId: update.marketId,
        outcomeId: update.outcomeId,
        bids: update.bids,
        asks: update.asks,
        spread: update.spread ?? null,
        midPrice: update.midPrice ?? null,
        timestamp: update.timestamp,
      });
    }
  });
  signalBus.onOrderbook((update) => {
    if (featureEngine) {
      featureEngine.processOrderbook({
        platform: update.platform,
        marketId: update.marketId,
        outcomeId: update.outcomeId,
        bids: update.bids,
        asks: update.asks,
        timestamp: update.timestamp,
      });
    }
  });

  // Log feature signals for observability (consumers can subscribe via signalBus.onSignal)
  signalBus.onSignal((signal) => {
    logger.debug(
      { type: signal.type, platform: signal.platform, market: signal.marketId, strength: signal.strength, direction: signal.direction },
      'Trading signal emitted'
    );
  });

  // Connect feature engine signal output → signal bus
  featureEngine.setEmitter(signalBus);

  // Connect feeds → signal bus (single subscription point)
  signalBus.connectFeeds(feeds);

  logger.info('Signal bus wired: feeds → tick/orderbook/signal consumers');

  // Initialize x402 client for outbound payments (agent-to-agent)
  let x402Client: X402Client | null = null;
  if (config.x402?.enabled && (config.x402.evmPrivateKey || config.x402.solanaPrivateKey)) {
    x402Client = createX402Client({
      network: config.x402.network,
      evmPrivateKey: config.x402.evmPrivateKey,
      solanaPrivateKey: config.x402.solanaPrivateKey,
      autoApproveLimit: config.x402.autoApproveLimit,
      dryRun: config.x402.dryRun,
    });
    logger.info('x402 client initialized for outbound payments');
  }

  const startMonitoring = () => {
    monitoring?.stop();
    monitoring = createMonitoringService({
      config: currentConfig.monitoring,
      providerHealth,
      sendMessage,
      resolveAccountId: (target) => {
        if (target.accountId) return target.accountId;
        if (!target.platform || !target.chatId) return undefined;
        const session = db.getLatestSessionForChat(target.platform, target.chatId);
        return session?.accountId;
      },
    });
    monitoring.start();
  };

  async function startCronService(): Promise<void> {
    const cronEnabled = currentConfig.cron?.enabled !== false;
    if (!cronEnabled) {
      cronService?.stop();
      cronService = null;
      logger.info('Cron service disabled');
      return;
    }

    cronService?.stop();
    cronService = createCronService({
      db,
      feeds,
      sendMessage,
      credentials: cronCredentials,
      config: currentConfig,
    });

    await cronService.start();
  }

  async function updatePositionPrices(): Promise<void> {
    const positions = db.listPositionsForPricing();
    if (positions.length === 0) return;

    const grouped = new Map<string, typeof positions>();
    for (const position of positions) {
      const key = `${position.platform}:${position.marketId}`;
      const list = grouped.get(key) || [];
      list.push(position);
      grouped.set(key, list);
    }

    for (const [key, entries] of grouped.entries()) {
      const [platform, marketId] = key.split(':');
      try {
        const market = await feeds.getMarket(marketId, platform);
        if (!market) continue;

        for (const position of entries) {
          const outcome = market.outcomes.find((o) =>
            o.id === position.outcomeId ||
            o.name.toLowerCase() === position.outcome.toLowerCase()
          );
          if (!outcome) continue;
          if (Number.isFinite(outcome.price)) {
            db.updatePositionPrice(position.id, outcome.price);
          }
        }
      } catch (error) {
        logger.warn({ error, platform, marketId }, 'Failed to update position prices for market');
      }
    }

    const positionConfig = currentConfig.positions ?? {};
    if (positionConfig.pnlSnapshotsEnabled !== false) {
      const userIds = new Set(positions.map((pos) => pos.userId));
      for (const userId of userIds) {
        const userPositions = db.getPositions(userId);
        if (userPositions.length === 0) continue;

        let totalValue = 0;
        let totalPnl = 0;
        let totalCostBasis = 0;
        const byPlatform: Record<string, { value: number; pnl: number }> = {};

        for (const pos of userPositions) {
          const value = pos.shares * pos.currentPrice;
          const costBasis = pos.shares * pos.avgPrice;
          const pnl = value - costBasis;

          totalValue += value;
          totalPnl += pnl;
          totalCostBasis += costBasis;

          const agg = byPlatform[pos.platform] || { value: 0, pnl: 0 };
          agg.value += value;
          agg.pnl += pnl;
          byPlatform[pos.platform] = agg;
        }

        const totalPnlPct = totalCostBasis > 0 ? totalPnl / totalCostBasis : 0;

        db.createPortfolioSnapshot({
          userId,
          totalValue,
          totalPnl,
          totalPnlPct,
          totalCostBasis,
          positionsCount: userPositions.length,
          byPlatform,
        });
      }

      const historyDays = positionConfig.pnlHistoryDays ?? 90;
      if (historyDays > 0) {
        const cutoffMs = Date.now() - historyDays * 24 * 60 * 60 * 1000;
        db.deletePortfolioSnapshotsBefore(cutoffMs);
      }
    }
  }

  function startMarketCacheCleanup(): void {
    const cacheConfig = currentConfig.marketCache ?? {};
    if (cacheConfig.enabled === false) return;
    const ttlMs = cacheConfig.ttlMs ?? 30 * 60 * 1000;
    const intervalMs = cacheConfig.cleanupIntervalMs ?? 15 * 60 * 1000;

    const runCleanup = () => {
      const cutoff = Date.now() - ttlMs;
      const removed = db.pruneMarketCache(cutoff);
      if (removed > 0) {
        logger.info({ removed, cutoff }, 'Market cache cleanup completed');
      }
    };

    runCleanup();
    if (!marketCacheCleanupInterval) {
      marketCacheCleanupInterval = setInterval(() => {
        runCleanup();
      }, intervalMs);
      logger.info({ ttlMs, intervalMs }, 'Market cache cleanup started');
    }
  }

  function startMarketIndexSync(): void {
    const indexConfig = currentConfig.marketIndex ?? {};
    if (indexConfig.enabled === false) return;
    const intervalMs = indexConfig.syncIntervalMs ?? 6 * 60 * 60 * 1000;
    const staleAfterMs = indexConfig.staleAfterMs ?? 7 * 24 * 60 * 60 * 1000;
    const limitPerPlatform = indexConfig.limitPerPlatform ?? 300;
    const status = indexConfig.status ?? 'open';
    const excludeSports = indexConfig.excludeSports ?? true;
    const platforms = indexConfig.platforms ?? ['polymarket', 'kalshi', 'manifold', 'metaculus'];
    const minVolume24h = indexConfig.minVolume24h ?? 0;
    const minLiquidity = indexConfig.minLiquidity ?? 0;
    const minOpenInterest = indexConfig.minOpenInterest ?? 0;
    const minPredictions = indexConfig.minPredictions ?? 0;
    const excludeResolved = indexConfig.excludeResolved ?? false;

    const runSync = async () => {
      try {
        const result = await marketIndex.sync({
          platforms,
          limitPerPlatform,
          status,
          excludeSports,
          minVolume24h,
          minLiquidity,
          minOpenInterest,
          minPredictions,
          excludeResolved,
          prune: true,
          staleAfterMs,
        });
        logger.info({ result }, 'Market index sync completed');
      } catch (error) {
        logger.warn({ error }, 'Market index sync failed');
      }
    };

    void runSync();
    if (!marketIndexSyncInterval) {
      marketIndexSyncInterval = setInterval(() => {
        void runSync();
      }, intervalMs);
      logger.info(
        {
          intervalMs,
          platforms,
          limitPerPlatform,
          status,
          minVolume24h,
          minLiquidity,
          minOpenInterest,
          minPredictions,
          staleAfterMs,
        },
        'Market index sync scheduled'
      );
    }
  }

  const getConfig = (): Config => currentConfig;
  let webhookTool: WebhookTool | undefined;
  // Pass queued wrapper to agents when available; fall back to direct service
  let agents = await createAgentManager(
    currentConfig,
    feeds,
    db,
    sessions,
    sendMessage,
    editMessage,
    deleteMessage,
    reactMessage,
    createPoll,
    memory,
    getConfig,
    () => webhookTool,
    queuedExecutionRef ?? executionService
  );

  webhookTool = createWebhookTool({
    manager: webhookManager,
    gatewayPort: currentConfig.gateway.port,
    sessions,
    commands,
    feeds,
    db,
    memory,
    sendMessage,
    handleAgentMessage: (message, session) => agents.handleMessage(message, session),
  });

  let skillWatcher: FSWatcher | null = null;
  let skillReloadTimer: NodeJS.Timeout | null = null;
  let configReloadTimer: NodeJS.Timeout | null = null;

  function getSkillWatchPaths(cfg: Config): string[] {
    const bundledDir = path.join(__dirname, '..', 'skills', 'bundled');
    const managedDir = path.join(process.cwd(), '.clodds', 'skills');
    const workspaceDir = path.join(cfg.agents.defaults.workspace, 'skills');
    return [bundledDir, managedDir, workspaceDir];
  }

  function scheduleSkillReload(trigger: string): void {
    if (skillReloadTimer) {
      clearTimeout(skillReloadTimer);
    }
    skillReloadTimer = setTimeout(() => {
      logger.info({ trigger }, 'Reloading skills');
      agents.reloadSkills();
    }, 150);
  }

  function setupSkillWatcher(): void {
    if (skillWatcher) {
      skillWatcher.close().catch((err) => {
        logger.debug({ err }, 'Error closing skill watcher during reset');
      });
    }

    const paths = getSkillWatchPaths(currentConfig);
    skillWatcher = chokidar.watch(paths, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    skillWatcher.on('add', () => scheduleSkillReload('add'));
    skillWatcher.on('change', () => scheduleSkillReload('change'));
    skillWatcher.on('unlink', () => scheduleSkillReload('unlink'));

    watchers.push(skillWatcher);
    logger.info({ paths }, 'Skill hot-reload watcher started');
  }

  async function rebuildRuntime(reason: string, workspaceChanged: boolean): Promise<void> {
    if (!started) return;

    if (reloadInFlight) {
      pendingReload = true;
      logger.info({ reason }, 'Reload already in progress; queued follow-up reload');
      await reloadInFlight;
      return;
    }

    reloadInFlight = (async () => {
      logger.info({ reason }, 'Rebuilding feeds/channels/agent from updated config');

      const oldChannels = channels;
      const oldFeeds = feeds;
      const oldAgents = agents;

      monitoring?.stop();
      monitoring = null;

      try {
        await oldChannels?.stop();
      } catch (error) {
        logger.warn({ error }, 'Failed to stop old channels during reload');
      }

      // Stop alt-data service before rebuilding feeds
      if (altDataService) {
        altDataService.stop();
        altDataService = null;
      }

      try {
        await oldFeeds.stop();
      } catch (error) {
        logger.warn({ error }, 'Failed to stop old feeds during reload');
      }

      try {
        oldAgents.dispose();
      } catch (error) {
        logger.warn({ error }, 'Failed to dispose old agent during reload');
      }

      feeds = await createFeedManager(currentConfig.feeds);

      // Reconnect signal bus to new feeds (consumers keep their state)
      signalBus.disconnectFeeds();
      signalBus.connectFeeds(feeds);

      agents = await createAgentManager(
        currentConfig,
        feeds,
        db,
        sessions,
        sendMessage,
        editMessage,
        deleteMessage,
        reactMessage,
        createPoll,
        memory,
        getConfig,
        () => webhookTool,
        queuedExecutionRef ?? executionService
      );

      channels = await createChannelManager(
        currentConfig.channels,
        {
          onMessage: handleIncomingMessage,
          pairing,
          commands,
        },
        { offlineQueue: currentConfig.messages?.offlineQueue }
      );
      httpGateway.setChannelWebhookHandler(async (platform, event, req) => {
        if (!channels) {
          logger.warn({ platform }, 'Channel webhook received before channels initialized');
          return null;
        }
        const adapter = channels.getAdapters()[platform];
        if (!adapter?.handleEvent) {
          logger.warn({ platform }, 'Channel webhook handler not registered');
          return null;
        }
        return adapter.handleEvent(event, req);
      });

      const wss = httpGateway.getWebSocketServer();
      if (wss) {
        channels.attachWebSocket(wss);
      }

      await feeds.start();
      await channels.start();
      await startCronService();
      startMonitoring();

      // Recreate alt-data service with fresh feeds
      const rebuildAltDataCfg = currentConfig.altData;
      if (rebuildAltDataCfg?.enabled !== false) {
        altDataService = createAltDataService({
          config: rebuildAltDataCfg ?? {},
          signalBus,
          feeds: feeds as unknown as FeedManagerLike,
          embeddings: embeddings as unknown as EmbeddingsLike,
        });
        await altDataService.start();
      }

      if (workspaceChanged) {
        setupSkillWatcher();
      } else {
        scheduleSkillReload('config');
      }

      logger.info('Runtime rebuild complete');
    })()
      .catch((error) => {
        logger.error({ error }, 'Runtime rebuild failed');
      })
      .finally(async () => {
        reloadInFlight = null;
        if (pendingReload) {
          pendingReload = false;
          await rebuildRuntime('pending reload', true);
        }
      });

    await reloadInFlight;
  }

  function setupConfigWatcher(): void {
    const watcher = chokidar.watch(configPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    const scheduleConfigReload = () => {
      if (configReloadTimer) {
        clearTimeout(configReloadTimer);
      }

      configReloadTimer = setTimeout(async () => {
        try {
          const previousWorkspace = currentConfig.agents.defaults.workspace;
          const next = await loadConfig(configPath);
          currentConfig = next;
          configureHttpClient(currentConfig.http);

          const workspaceChanged = next.agents.defaults.workspace !== previousWorkspace;
          agents.reloadConfig(next);
          await rebuildRuntime('config change', workspaceChanged);

          logger.info({ configPath }, 'Config hot-reloaded');
        } catch (error) {
          logger.error({ error, configPath }, 'Failed to hot-reload config');
        }
      }, 250);
    };

    watcher.on('add', scheduleConfigReload);
    watcher.on('change', scheduleConfigReload);
    watcher.on('unlink', scheduleConfigReload);

    watchers.push(watcher);
    logger.info({ configPath }, 'Config hot-reload watcher started');
  }

  function getChannelRateLimitConfig(platform: string): RateLimitConfig | null {
    const channelConfig =
      (currentConfig.channels as Record<string, { rateLimit?: RateLimitConfig }> | undefined)?.[
        platform
      ];
    if (!channelConfig?.rateLimit) return null;
    return channelConfig.rateLimit;
  }

  function getChannelRateLimiter(
    platform: string,
    config: RateLimitConfig
  ): { config: RateLimitConfig; limiter: RateLimiter } {
    const existing = channelRateLimiters.get(platform);
    if (
      existing &&
      existing.config.maxRequests === config.maxRequests &&
      existing.config.windowMs === config.windowMs &&
      existing.config.perUser === config.perUser
    ) {
      return existing;
    }

    const limiter = new RateLimiter(config);
    const entry = { config, limiter };
    channelRateLimiters.set(platform, entry);
    return entry;
  }

  const handleIncomingMessage = async (message: IncomingMessage): Promise<void> => {
    const normalized = normalizeIncomingMessage(message);
    const channelRateLimit = getChannelRateLimitConfig(normalized.platform);
    if (channelRateLimit) {
      const limiterEntry = getChannelRateLimiter(normalized.platform, channelRateLimit);
      const rateLimitKey = channelRateLimit.perUser
        ? `${normalized.platform}:${normalized.userId}`
        : `${normalized.platform}:global`;
      const rateLimitResult = limiterEntry.limiter.check(rateLimitKey);
      if (!rateLimitResult.allowed) {
        const resetInSeconds = Math.ceil(rateLimitResult.resetIn / 1000);
        logger.warn(
          { platform: normalized.platform, userId: normalized.userId, resetInSeconds },
          'Channel rate limit exceeded'
        );
        await sendMessage({
          platform: normalized.platform,
          chatId: normalized.chatId,
          text: `Rate limit exceeded for ${normalized.platform}. Try again in ${resetInSeconds}s.`,
          parseMode: 'Markdown',
          thread: normalized.thread,
        });
        return;
      }
    }
    const session = await sessions.getOrCreateSession(normalized);

    const commandResponse = await commands.handle(normalized, {
      session,
      sessions,
      feeds,
      db,
      memory,
      opportunityFinder: opportunityFinder ?? undefined,
      bittensorService: bittensorService ?? undefined,
      send: sendMessage,
    });

    if (commandResponse) {
      await sendMessage({
        platform: normalized.platform,
        chatId: normalized.chatId,
        text: commandResponse,
        parseMode: 'Markdown',
        thread: normalized.thread,
      });
      return;
    }

    const responseText = await agents.handleMessage(normalized, session);
    if (responseText !== null) {
      await sendMessage({
        platform: normalized.platform,
        chatId: normalized.chatId,
        text: responseText,
        parseMode: 'Markdown',
        thread: normalized.thread,
      });
    }
  };

  channels = await createChannelManager(
    config.channels,
    {
      onMessage: handleIncomingMessage,
      pairing,
      commands,
    },
    { offlineQueue: config.messages?.offlineQueue }
  );

  httpGateway.setChannelWebhookHandler(async (platform, event, req) => {
    if (!channels) {
      logger.warn({ platform }, 'Channel webhook received before channels initialized');
      return null;
    }
    const adapter = channels.getAdapters()[platform];
    if (!adapter?.handleEvent) {
      logger.warn({ platform }, 'Channel webhook handler not registered');
      return null;
    }
    return adapter.handleEvent(event, req);
  });

  httpGateway.setMarketIndexHandler(async (req) => {
    if (!currentConfig.marketIndex || currentConfig.marketIndex.enabled === false) {
      return { error: 'Market index disabled', status: 503 };
    }

    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      return { error: 'Missing query parameter: q', status: 400 };
    }

    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
    const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : undefined;
    const maxCandidates = req.query.maxCandidates
      ? Number.parseInt(String(req.query.maxCandidates), 10)
      : undefined;
    const minScore = req.query.minScore ? Number.parseFloat(String(req.query.minScore)) : undefined;

    let platformWeights: Record<string, number> | undefined;
    if (typeof req.query.platformWeights === 'string') {
      try {
        platformWeights = JSON.parse(req.query.platformWeights);
      } catch {
        return { error: 'Invalid platformWeights JSON', status: 400 };
      }
    }

    const results = await marketIndex.search({
      query,
      platform: platform as any,
      limit,
      maxCandidates,
      minScore,
      platformWeights: platformWeights as any,
    });

    return {
      results: results.map((r) => ({
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
    };
  });

  httpGateway.setMarketIndexStatsHandler(async (req) => {
    if (!currentConfig.marketIndex || currentConfig.marketIndex.enabled === false) {
      return { error: 'Market index disabled', status: 503 };
    }

    const platforms = typeof req.query.platforms === 'string'
      ? req.query.platforms.split(',').map((p) => p.trim()).filter(Boolean)
      : undefined;

    const stats = marketIndex.stats(platforms as any);
    return { stats };
  });

  httpGateway.setMarketIndexSyncHandler(async (req) => {
    if (!currentConfig.marketIndex || currentConfig.marketIndex.enabled === false) {
      return { error: 'Market index disabled', status: 503 };
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const platforms = Array.isArray(body.platforms)
      ? body.platforms
      : typeof body.platforms === 'string'
        ? body.platforms.split(',').map((p) => p.trim()).filter(Boolean)
        : undefined;
    const limitPerPlatform = typeof body.limitPerPlatform === 'number' ? body.limitPerPlatform : undefined;
    const status = typeof body.status === 'string' ? body.status : undefined;
    const excludeSports = typeof body.excludeSports === 'boolean' ? body.excludeSports : undefined;
    const minVolume24h = typeof body.minVolume24h === 'number' ? body.minVolume24h : undefined;
    const minLiquidity = typeof body.minLiquidity === 'number' ? body.minLiquidity : undefined;
    const minOpenInterest = typeof body.minOpenInterest === 'number' ? body.minOpenInterest : undefined;
    const minPredictions = typeof body.minPredictions === 'number' ? body.minPredictions : undefined;
    const excludeResolved = typeof body.excludeResolved === 'boolean' ? body.excludeResolved : undefined;
    const prune = typeof body.prune === 'boolean' ? body.prune : undefined;
    const staleAfterMs = typeof body.staleAfterMs === 'number' ? body.staleAfterMs : undefined;

    const result = await marketIndex.sync({
      platforms: platforms as any,
      limitPerPlatform,
      status: status as any,
      excludeSports,
      minVolume24h,
      minLiquidity,
      minOpenInterest,
      minPredictions,
      excludeResolved,
      prune,
      staleAfterMs,
    });

    return { result };
  });

  // Performance dashboard handler
  httpGateway.setPerformanceDashboardHandler(async (_req) => {
    // Get trade statistics from database
    const trades = db.query<{
      id: string;
      timestamp: string;
      market: string;
      side: string;
      size: number;
      entryPrice: number;
      exitPrice: number | null;
      pnl: number | null;
      pnlPct: number | null;
      status: string;
      strategy: string | null;
    }>(`
      SELECT
        id,
        created_at as timestamp,
        COALESCE(market_question, market_id) as market,
        side,
        size,
        entry_price as entryPrice,
        exit_price as exitPrice,
        pnl,
        pnl_pct as pnlPct,
        status,
        strategy
      FROM trades
      ORDER BY created_at DESC
      LIMIT 100
    `);

    // Calculate stats
    const closedTrades = trades.filter(t => t.status === 'closed' && t.pnl != null);
    const winningTrades = closedTrades.filter(t => (t.pnl ?? 0) > 0);

    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const avgPnlPct = closedTrades.length > 0
      ? closedTrades.reduce((sum, t) => sum + (t.pnlPct ?? 0), 0) / closedTrades.length
      : 0;

    // Calculate Sharpe ratio (simplified - daily returns)
    const dailyPnl: Record<string, number> = {};
    for (const t of closedTrades) {
      const date = t.timestamp.split('T')[0];
      dailyPnl[date] = (dailyPnl[date] ?? 0) + (t.pnl ?? 0);
    }
    const dailyReturns = Object.values(dailyPnl);
    const avgReturn = dailyReturns.length > 0
      ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
      : 0;
    const stdDev = dailyReturns.length > 1
      ? Math.sqrt(dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (dailyReturns.length - 1))
      : 1;
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    // Calculate max drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;
    const dailyData: Array<{ date: string; pnl: number; cumulative: number }> = [];

    const sortedDates = Object.keys(dailyPnl).sort();
    for (const date of sortedDates) {
      cumulative += dailyPnl[date];
      peak = Math.max(peak, cumulative);
      const drawdown = peak > 0 ? (peak - cumulative) / peak : 0;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      dailyData.push({ date, pnl: dailyPnl[date], cumulative });
    }

    // Group by strategy
    const strategyMap: Record<string, { trades: number; wins: number; pnl: number }> = {};
    for (const t of closedTrades) {
      const strat = t.strategy ?? 'Unknown';
      if (!strategyMap[strat]) {
        strategyMap[strat] = { trades: 0, wins: 0, pnl: 0 };
      }
      strategyMap[strat].trades++;
      if ((t.pnl ?? 0) > 0) strategyMap[strat].wins++;
      strategyMap[strat].pnl += t.pnl ?? 0;
    }

    const byStrategy = Object.entries(strategyMap).map(([strategy, data]) => ({
      strategy,
      trades: data.trades,
      winRate: data.trades > 0 ? (data.wins / data.trades) * 100 : 0,
      pnl: data.pnl,
    }));

    // Format recent trades
    const recentTrades = trades.slice(0, 20).map(t => ({
      id: t.id,
      timestamp: t.timestamp,
      market: t.market,
      side: t.side,
      size: t.size,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice ?? undefined,
      pnl: t.pnl ?? undefined,
      pnlPct: t.pnlPct ?? undefined,
      status: t.status === 'closed'
        ? ((t.pnl ?? 0) > 0 ? 'win' : 'loss')
        : t.status,
    }));

    return {
      stats: {
        totalTrades: trades.length,
        winRate: closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0,
        totalPnl,
        avgPnlPct,
        sharpeRatio,
        maxDrawdown: maxDrawdown * 100,
      },
      recentTrades,
      dailyPnl: dailyData,
      byStrategy,
    };
  });

  // Backtest handler - runs backtest on historical trade data
  httpGateway.setBacktestHandler(async (req) => {
    const body = req.body as {
      strategyId?: string;
      startDate?: string;
      endDate?: string;
      initialCapital?: number;
      platform?: string;
      marketId?: string;
    };

    // Get historical trades for analysis
    const startDate = body.startDate ? new Date(body.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = body.endDate ? new Date(body.endDate) : new Date();
    const initialCapital = body.initialCapital ?? 10000;

    // Query historical trades
    const trades = db.query<{
      created_at: string;
      side: string;
      size: number;
      entry_price: number;
      exit_price: number | null;
      pnl: number | null;
      pnl_pct: number | null;
      status: string;
    }>(`
      SELECT created_at, side, size, entry_price, exit_price, pnl, pnl_pct, status
      FROM trades
      WHERE created_at >= ? AND created_at <= ?
      ${body.platform ? 'AND platform = ?' : ''}
      ${body.marketId ? 'AND market_id = ?' : ''}
      ORDER BY created_at
    `, [
      startDate.toISOString(),
      endDate.toISOString(),
      ...(body.platform ? [body.platform] : []),
      ...(body.marketId ? [body.marketId] : []),
    ]);

    // Build equity curve from trades
    let equity = initialCapital;
    const equityCurve: Array<{ timestamp: string; equity: number }> = [
      { timestamp: startDate.toISOString(), equity: initialCapital }
    ];
    const dailyPnl: Record<string, number> = {};

    const closedTrades = trades.filter(t => t.status === 'closed' && t.pnl != null);

    for (const trade of closedTrades) {
      equity += trade.pnl ?? 0;
      equityCurve.push({ timestamp: trade.created_at, equity });

      const date = trade.created_at.split('T')[0];
      dailyPnl[date] = (dailyPnl[date] ?? 0) + (trade.pnl ?? 0);
    }

    // Calculate metrics
    const wins = closedTrades.filter(t => (t.pnl ?? 0) > 0);
    const losses = closedTrades.filter(t => (t.pnl ?? 0) < 0);
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const totalReturnPct = (totalPnl / initialCapital) * 100;
    const days = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
    const annualizedReturnPct = totalReturnPct * (365 / Math.max(1, days));

    // Sharpe & Sortino
    const dailyReturns = Object.values(dailyPnl).map(pnl => pnl / initialCapital);
    const avgReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const stdDev = dailyReturns.length > 1 ? Math.sqrt(dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (dailyReturns.length - 1)) : 1;
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    const negReturns = dailyReturns.filter(r => r < 0);
    const downsideDev = negReturns.length > 0 ? Math.sqrt(negReturns.reduce((sum, r) => sum + r * r, 0) / negReturns.length) : 1;
    const sortinoRatio = downsideDev > 0 ? (avgReturn / downsideDev) * Math.sqrt(252) : 0;

    // Max drawdown
    let peak = initialCapital;
    let maxDrawdownPct = 0;
    for (const point of equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const dd = ((peak - point.equity) / peak) * 100;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }

    // Profit factor
    const grossProfit = wins.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.pnl ?? 0), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    return {
      result: {
        strategyId: body.strategyId || 'historical',
        metrics: {
          totalReturnPct,
          annualizedReturnPct,
          totalTrades: trades.length,
          winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
          sharpeRatio,
          sortinoRatio,
          maxDrawdownPct,
          profitFactor: profitFactor === Infinity ? 999 : profitFactor,
        },
        trades: trades.slice(0, 50).map(t => ({
          timestamp: t.created_at,
          side: t.side,
          size: t.size,
          entryPrice: t.entry_price,
          exitPrice: t.exit_price,
          pnl: t.pnl,
        })),
        equityCurve,
        dailyReturns: Object.entries(dailyPnl).map(([date, pnl]) => ({ date, return: pnl / initialCapital })),
      },
    };
  });

  // Tick recorder handlers
  httpGateway.setTicksHandler(async (req) => {
    if (!tickRecorder) {
      return { error: 'Tick recorder not enabled', status: 503 };
    }

    const platform = req.params.platform as Platform;
    const marketId = req.params.marketId;
    const outcomeId = typeof req.query.outcomeId === 'string' ? req.query.outcomeId : undefined;
    const startTime = req.query.startTime ? Number(req.query.startTime) : Date.now() - 24 * 60 * 60 * 1000;
    const endTime = req.query.endTime ? Number(req.query.endTime) : Date.now();
    const limit = req.query.limit ? Number(req.query.limit) : 1000;

    const ticks = await tickRecorder.getTicks({
      platform,
      marketId,
      outcomeId,
      startTime,
      endTime,
      limit,
    });

    return {
      ticks: ticks.map((t) => ({
        time: t.time.toISOString(),
        platform: t.platform,
        marketId: t.marketId,
        outcomeId: t.outcomeId,
        price: t.price,
        prevPrice: t.prevPrice,
      })),
    };
  });

  httpGateway.setOHLCHandler(async (req) => {
    if (!tickRecorder) {
      return { error: 'Tick recorder not enabled', status: 503 };
    }

    const platform = req.params.platform as Platform;
    const marketId = req.params.marketId;
    const outcomeId = typeof req.query.outcomeId === 'string' ? req.query.outcomeId : undefined;
    const interval = (typeof req.query.interval === 'string' ? req.query.interval : '1h') as '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
    const startTime = req.query.startTime ? Number(req.query.startTime) : Date.now() - 7 * 24 * 60 * 60 * 1000;
    const endTime = req.query.endTime ? Number(req.query.endTime) : Date.now();

    if (!outcomeId) {
      return { error: 'Missing required query parameter: outcomeId', status: 400 };
    }

    const candles = await tickRecorder.getOHLC({
      platform,
      marketId,
      outcomeId,
      interval,
      startTime,
      endTime,
    });

    return { candles };
  });

  httpGateway.setOrderbookHistoryHandler(async (req) => {
    if (!tickRecorder) {
      return { error: 'Tick recorder not enabled', status: 503 };
    }

    const platform = req.params.platform as Platform;
    const marketId = req.params.marketId;
    const outcomeId = typeof req.query.outcomeId === 'string' ? req.query.outcomeId : undefined;
    const startTime = req.query.startTime ? Number(req.query.startTime) : Date.now() - 60 * 60 * 1000;
    const endTime = req.query.endTime ? Number(req.query.endTime) : Date.now();
    const limit = req.query.limit ? Number(req.query.limit) : 100;

    const snapshots = await tickRecorder.getOrderbookSnapshots({
      platform,
      marketId,
      outcomeId,
      startTime,
      endTime,
      limit,
    });

    return {
      snapshots: snapshots.map((s) => ({
        time: s.time.toISOString(),
        platform: s.platform,
        marketId: s.marketId,
        outcomeId: s.outcomeId,
        bids: s.bids,
        asks: s.asks,
        spread: s.spread,
        midPrice: s.midPrice,
      })),
    };
  });

  httpGateway.setTickRecorderStatsHandler(async (_req) => {
    if (!tickRecorder) {
      return { error: 'Tick recorder not enabled', status: 503 };
    }

    const stats = tickRecorder.getStats();
    return { stats };
  });

  // Set tick streamer for WebSocket streaming endpoint
  httpGateway.setTickStreamer(tickStreamer);

  // Set feature engineering for REST API
  httpGateway.setFeatureEngineering(featureEngine);

  return {
    async start(): Promise<void> {
      logger.info('Starting gateway services');

      // Setup graceful shutdown handlers
      setupShutdownHandlers();

      // Register shutdown cleanup
      onShutdown(async () => {
        logger.info('Shutting down gateway services');
        if (executionProducer) await executionProducer.close();
        if (whaleTracker) whaleTracker.stop();
        if (copyTrading) copyTrading.stop();
        if (realtimeAlerts) realtimeAlerts.stop();
        if (arbitrageExecutor) arbitrageExecutor.stop();
        // Stop event flow first, then flush pending writes
        signalBus.disconnectFeeds();
        if (tickRecorder) await tickRecorder.stop();
        if (tickStreamer) tickStreamer.stop();
        if (cronService) await cronService.stop();
        if (monitoring) monitoring.stop();
        providerHealth?.stop();
        await feeds.stop();
        if (channels) await channels.stop();
        await httpGateway.stop();
        db.close();
      });

      await httpGateway.start();

      const wss = httpGateway.getWebSocketServer();
      if (wss) {
        channels!.attachWebSocket(wss);
      }

      await feeds.start();
      await channels!.start();
      providerHealth?.start();
      await startCronService();
      startMonitoring();

      // Start whale tracker if enabled
      if (whaleTracker) {
        await whaleTracker.start();
        logger.info('Whale tracker started');
      }

      // Start copy trading if enabled
      if (copyTrading) {
        copyTrading.start();
        logger.info('Copy trading service started');
      }

      // Start realtime alerts if enabled
      if (realtimeAlerts) {
        realtimeAlerts.start();
        logger.info('Realtime alerts service started');
      }

      // Start arbitrage executor if enabled
      if (arbitrageExecutor) {
        arbitrageExecutor.start();
        logger.info('Arbitrage executor started');
      }

      // Start tick recorder if enabled
      if (tickRecorder) {
        await tickRecorder.start();
        logger.info('Tick recorder started');
      }

      // Start Bittensor mining service if enabled
      if (bittensorService) {
        await bittensorService.start();
        logger.info('Bittensor mining service started');
      }

      // Start alt-data sentiment pipeline if enabled
      const altDataCfg = currentConfig.altData;
      if (altDataCfg?.enabled !== false) {
        altDataService = createAltDataService({
          config: altDataCfg ?? {},
          signalBus,
          feeds: feeds as unknown as FeedManagerLike,
          embeddings: embeddings as unknown as EmbeddingsLike,
        });
        await altDataService.start();
        logger.info({ feeds: altDataService.getStats().activeFeeds }, 'Alt-data service started');
      }

      started = true;
      if (!channelRateLimitCleanupInterval) {
        channelRateLimitCleanupInterval = setInterval(() => {
          for (const entry of channelRateLimiters.values()) {
            entry.limiter.cleanup();
          }
        }, 5 * 60 * 1000);
      }

      startMarketCacheCleanup();
      startMarketIndexSync();

      const positionConfig = currentConfig.positions ?? {};
      const positionUpdatesEnabled = positionConfig.enabled !== false;
      if (positionUpdatesEnabled) {
        const intervalMs = positionConfig.priceUpdateIntervalMs ?? 5 * 60 * 1000;
        if (!positionPriceUpdateInterval) {
          updatePositionPrices().catch((error) => {
            logger.warn({ error }, 'Initial position price update failed');
          });
          positionPriceUpdateInterval = setInterval(() => {
            updatePositionPrices().catch((error) => {
              logger.warn({ error }, 'Position price update failed');
            });
          }, intervalMs);
          logger.info({ intervalMs }, 'Position price updater started');
        }
      }
      setupSkillWatcher();
      setupConfigWatcher();

      logger.info({ port: currentConfig.gateway.port }, 'Gateway started');
    },

    async stop(): Promise<void> {
      logger.info('Stopping gateway services');

      if (cronService) {
        cronService.stop();
        cronService = null;
      }

      for (const watcher of watchers) {
        try {
          await watcher.close();
        } catch (error) {
          logger.warn({ error }, 'Failed to close watcher cleanly');
        }
      }
      if (skillReloadTimer) {
        clearTimeout(skillReloadTimer);
        skillReloadTimer = null;
      }
      if (configReloadTimer) {
        clearTimeout(configReloadTimer);
        configReloadTimer = null;
      }
      if (reloadInFlight) {
        await reloadInFlight;
      }
      if (channelRateLimitCleanupInterval) {
        clearInterval(channelRateLimitCleanupInterval);
        channelRateLimitCleanupInterval = null;
      }
      if (positionPriceUpdateInterval) {
        clearInterval(positionPriceUpdateInterval);
        positionPriceUpdateInterval = null;
      }
      if (marketCacheCleanupInterval) {
        clearInterval(marketCacheCleanupInterval);
        marketCacheCleanupInterval = null;
      }
      if (marketIndexSyncInterval) {
        clearInterval(marketIndexSyncInterval);
        marketIndexSyncInterval = null;
      }

      agents.dispose();
      providerHealth?.stop();
      monitoring?.stop();
      monitoring = null;

      // Stop Bittensor mining service
      if (bittensorService) {
        await bittensorService.stop();
        setBittensorService(null);
        bittensorService = null;
      }

      // Stop alt-data service
      if (altDataService) {
        altDataService.stop();
        altDataService = null;
      }

      // Stop arbitrage executor
      if (arbitrageExecutor) {
        arbitrageExecutor.stop();
        arbitrageExecutor = null;
      }

      // Stop event flow first, then flush pending writes
      signalBus.disconnectFeeds();

      if (tickRecorder) {
        await tickRecorder.stop();
        tickRecorder = null;
      }

      if (tickStreamer) {
        tickStreamer.stop();
        tickStreamer = null;
      }

      // Stop realtime alerts and cleanup subscriptions
      if (realtimeAlerts) {
        if (whaleTrackerCleanup) {
          whaleTrackerCleanup();
          whaleTrackerCleanup = null;
        }
        if (opportunityFinderCleanup) {
          opportunityFinderCleanup();
          opportunityFinderCleanup = null;
        }
        realtimeAlerts.stop();
        realtimeAlerts = null;
      }

      // Stop copy trading and whale tracker
      if (copyTrading) {
        copyTrading.stop();
        copyTrading = null;
      }
      if (whaleTracker) {
        whaleTracker.stop();
        whaleTracker = null;
      }

      // Close execution queue producer
      if (executionProducer) {
        await executionProducer.close();
        executionProducer = null;
      }

      await channels?.stop();
      await feeds.stop();
      await httpGateway.stop();
      sessions.dispose();
      started = false;

      // Close DB if it exposes a close method
      try {
        await db.close();
      } catch (error) {
        logger.warn({ error }, 'Failed to close database cleanly');
      }

      logger.info('Gateway stopped');
    },
  };
}
