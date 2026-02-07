/**
 * HTTP + WebSocket server
 */

import express, { Request, Router } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createHttpServer, Server, IncomingMessage } from 'http';
import { logger } from '../utils/logger';
import type { Config } from '../types';
import type { WebhookManager } from '../automation/webhooks';
import { createWebhookMiddleware } from '../automation/webhooks';
import { createX402Server, type X402Middleware } from '../payments/x402';
import {
  runHealthCheck,
  getErrorStats,
  getRequestMetrics,
  type HealthStatus,
} from '../utils/production';
import type { TickStreamer } from '../services/tick-streamer';
import type { FeatureEngineering } from '../services/feature-engineering';

export interface GatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getWebSocketServer(): WebSocketServer | null;
  setChannelWebhookHandler(handler: ChannelWebhookHandler | null): void;
  setMarketIndexHandler(handler: MarketIndexHandler | null): void;
  setMarketIndexStatsHandler(handler: MarketIndexStatsHandler | null): void;
  setMarketIndexSyncHandler(handler: MarketIndexSyncHandler | null): void;
  setPerformanceDashboardHandler(handler: PerformanceDashboardHandler | null): void;
  setBacktestHandler(handler: BacktestHandler | null): void;
  setTicksHandler(handler: TicksHandler | null): void;
  setOHLCHandler(handler: OHLCHandler | null): void;
  setOrderbookHistoryHandler(handler: OrderbookHistoryHandler | null): void;
  setTickRecorderStatsHandler(handler: TickRecorderStatsHandler | null): void;
  setTickStreamer(streamer: TickStreamer | null): void;
  setFeatureEngineering(service: FeatureEngineering | null): void;
  setBittensorRouter(router: Router | null): void;
  setTradingApiRouter(router: Router | null): void;
  setCommandListHandler(handler: CommandListHandler | null): void;
}

export type CommandListHandler = () => Array<{ name: string; description: string; category: string; subcommands?: Array<{ name: string; description: string; category: string }> }>;

export type ChannelWebhookHandler = (
  platform: string,
  event: unknown,
  req: Request
) => Promise<unknown>;

export type MarketIndexHandler = (
  req: Request
) => Promise<{ results: unknown[] } | { error: string; status?: number }>;

export type MarketIndexStatsHandler = (
  req: Request
) => Promise<{ stats: unknown } | { error: string; status?: number }>;

export type MarketIndexSyncHandler = (
  req: Request
) => Promise<{ result: unknown } | { error: string; status?: number }>;

export type BacktestHandler = (
  req: Request
) => Promise<{
  result: {
    strategyId: string;
    metrics: {
      totalReturnPct: number;
      annualizedReturnPct: number;
      totalTrades: number;
      winRate: number;
      sharpeRatio: number;
      sortinoRatio: number;
      maxDrawdownPct: number;
      profitFactor: number;
    };
    trades: unknown[];
    equityCurve: Array<{ timestamp: string; equity: number }>;
    dailyReturns: Array<{ date: string; return: number }>;
  };
} | { error: string; status?: number }>;

export type PerformanceDashboardHandler = (
  req: Request
) => Promise<{
  stats: {
    totalTrades: number;
    winRate: number;
    totalPnl: number;
    avgPnlPct: number;
    sharpeRatio: number;
    maxDrawdown: number;
  };
  recentTrades: Array<{
    id: string;
    timestamp: string;
    market: string;
    side: string;
    size: number;
    entryPrice: number;
    exitPrice?: number;
    pnl?: number;
    pnlPct?: number;
    status: string;
  }>;
  dailyPnl: Array<{ date: string; pnl: number; cumulative: number }>;
  byStrategy: Array<{ strategy: string; trades: number; winRate: number; pnl: number }>;
} | { error: string; status?: number }>;

export type TicksHandler = (
  req: Request
) => Promise<{
  ticks: Array<{
    time: string;
    platform: string;
    marketId: string;
    outcomeId: string;
    price: number;
    prevPrice: number | null;
  }>;
} | { error: string; status?: number }>;

export type OHLCHandler = (
  req: Request
) => Promise<{
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    tickCount: number;
  }>;
} | { error: string; status?: number }>;

export type OrderbookHistoryHandler = (
  req: Request
) => Promise<{
  snapshots: Array<{
    time: string;
    platform: string;
    marketId: string;
    outcomeId: string;
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
    spread: number | null;
    midPrice: number | null;
  }>;
} | { error: string; status?: number }>;

export type TickRecorderStatsHandler = (
  req: Request
) => Promise<{
  stats: {
    ticksRecorded: number;
    orderbooksRecorded: number;
    ticksInBuffer: number;
    orderbooksInBuffer: number;
    lastFlushTime: number | null;
    dbConnected: boolean;
    platforms: string[];
  };
} | { error: string; status?: number }>;

export function createServer(
  config: Config['gateway'] & { x402?: Config['x402'] },
  webhooks?: WebhookManager,
  db?: { query: <T>(sql: string) => T[] }
): GatewayServer {
  const app = express();
  let httpServer: Server | null = null;
  let wss: WebSocketServer | null = null;
  let channelWebhookHandler: ChannelWebhookHandler | null = null;
  let marketIndexHandler: MarketIndexHandler | null = null;
  let marketIndexStatsHandler: MarketIndexStatsHandler | null = null;
  let marketIndexSyncHandler: MarketIndexSyncHandler | null = null;
  let performanceDashboardHandler: PerformanceDashboardHandler | null = null;
  let backtestHandler: BacktestHandler | null = null;
  let ticksHandler: TicksHandler | null = null;
  let ohlcHandler: OHLCHandler | null = null;
  let orderbookHistoryHandler: OrderbookHistoryHandler | null = null;
  let tickRecorderStatsHandler: TickRecorderStatsHandler | null = null;
  let tickStreamer: TickStreamer | null = null;
  let featureEngineering: FeatureEngineering | null = null;
  let commandListHandler: CommandListHandler | null = null;

  // Auth middleware for sensitive endpoints
  const authToken = process.env.CLODDS_TOKEN;
  const requireAuth = (req: Request, res: express.Response, next: express.NextFunction) => {
    if (!authToken) {
      // No token configured - allow access (for development)
      return next();
    }
    const providedToken = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (providedToken !== authToken) {
      res.status(401).json({ error: 'Unauthorized - provide valid token via Authorization header or ?token= param' });
      return;
    }
    next();
  };

  const corsConfig = config.cors ?? false;
  app.use((req, res, next) => {
    if (!corsConfig) {
      return next();
    }

    const originHeader = req.headers.origin;
    let origin = '';
    let allowCredentials = false;

    if (Array.isArray(corsConfig)) {
      // Security: Only allow specific origins from allowlist
      if (originHeader && corsConfig.includes(originHeader)) {
        origin = originHeader;
        allowCredentials = true; // Safe to allow credentials with specific origin
      }
    } else if (corsConfig === true) {
      // Security: Wildcard origin - do NOT allow credentials
      origin = '*';
      allowCredentials = false;
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      // Security: Only allow credentials with specific origins, never with wildcard
      if (allowCredentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  // IP-based rate limiting
  const ipRequestCounts = new Map<string, { count: number; resetAt: number }>();
  const IP_RATE_LIMIT = parseInt(process.env.CLODDS_IP_RATE_LIMIT || '100', 10); // requests per minute
  const IP_RATE_WINDOW_MS = 60 * 1000; // 1 minute

  app.use((req, res, next) => {
    // Skip rate limiting for health checks
    if (req.path === '/health') return next();

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let record = ipRequestCounts.get(ip);

    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + IP_RATE_WINDOW_MS };
      ipRequestCounts.set(ip, record);
    }

    record.count++;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', IP_RATE_LIMIT);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, IP_RATE_LIMIT - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));

    if (record.count > IP_RATE_LIMIT) {
      logger.warn({ ip, count: record.count }, 'Rate limit exceeded');
      res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil((record.resetAt - now) / 1000),
      });
      return;
    }

    next();
  });

  // Cleanup old IP records every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of ipRequestCounts) {
      if (now > record.resetAt + IP_RATE_WINDOW_MS) {
        ipRequestCounts.delete(ip);
      }
    }
  }, 5 * 60 * 1000);

  // HTTPS enforcement & security headers
  app.use((req, res, next) => {
    // HSTS header (only send over HTTPS or if explicitly enabled)
    const hstsEnabled = process.env.CLODDS_HSTS_ENABLED === 'true';
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';

    if (hstsEnabled || isSecure) {
      // 1 year HSTS with includeSubDomains
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // Additional security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Redirect HTTP to HTTPS if forced
    const forceHttps = process.env.CLODDS_FORCE_HTTPS === 'true';
    if (forceHttps && !isSecure) {
      const host = req.headers.host || 'localhost';
      res.redirect(301, `https://${host}${req.url}`);
      return;
    }

    next();
  });

  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      // Capture raw body for webhook signature verification
      (req as any).rawBody = buf.toString();
    },
  }));

  // x402 payment middleware for premium endpoints
  let x402: X402Middleware | null = null;
  if (config.x402?.server?.payToAddress) {
    x402 = createX402Server(
      {
        payToAddress: config.x402.server.payToAddress,
        network: config.x402.server.network || 'solana',
        facilitatorUrl: config.x402.facilitatorUrl,
      },
      {
        'POST /api/compute': { priceUsd: 0.01, description: 'Compute request' },
        'POST /api/backtest': { priceUsd: 0.05, description: 'Strategy backtest' },
        'GET /api/features': { priceUsd: 0.002, description: 'Feature snapshot' },
      }
    );
    logger.info({ network: config.x402.server.network || 'solana' }, 'x402 payment middleware enabled');

    // Apply x402 middleware to premium routes
    app.use(['/api/compute', '/api/backtest', '/api/features'], x402.middleware);
  }

  // Health check endpoint (enhanced for production)
  app.get('/health', async (req, res) => {
    const deep = req.query.deep === 'true';

    if (!db) {
      // Simple health check if no DB provided
      res.json({ status: 'healthy', timestamp: Date.now() });
      return;
    }

    try {
      const health: HealthStatus = await runHealthCheck(db, {
        checkExternalApis: deep,
      });

      const httpStatus = health.status === 'healthy' ? 200 :
                         health.status === 'degraded' ? 200 : 503;

      res.status(httpStatus).json(health);
    } catch (err) {
      logger.error({ err }, 'Health check failed');
      res.status(503).json({
        status: 'unhealthy',
        timestamp: Date.now(),
        error: 'Health check failed',
      });
    }
  });

  // Metrics endpoint (for monitoring) - requires auth if CLODDS_TOKEN is set
  app.get('/metrics', requireAuth, (_req, res) => {
    const requestMetrics = getRequestMetrics();
    const errorStats = getErrorStats();
    const memUsage = process.memoryUsage();

    res.json({
      timestamp: Date.now(),
      requests: requestMetrics,
      errors: {
        recentCount: errorStats.recentCount,
        topErrors: errorStats.topErrors,
      },
      memory: {
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memUsage.rss / 1024 / 1024),
      },
    });
  });

  // x402 payment stats endpoint
  app.get('/api/x402/stats', requireAuth, (_req, res) => {
    if (!x402) {
      res.json({ enabled: false });
      return;
    }
    res.json({ enabled: true, ...x402.getStats() });
  });

  // API info endpoint
  app.get('/', (_req, res) => {
    res.json({
      name: 'clodds',
      version: process.env.npm_package_version || '0.1.0',
      description: 'AI assistant for prediction markets',
      endpoints: {
        websocket: '/ws',
        webchat: '/chat',
        tickStream: '/api/ticks/stream',
        health: '/health',
        healthDeep: '/health?deep=true',
        metrics: '/metrics',
        dashboard: '/dashboard',
        tickStreamerStats: '/api/tick-streamer/stats',
        features: '/api/features/:platform/:marketId',
        featuresAll: '/api/features',
        featuresStats: '/api/features/stats',
      },
    });
  });

  // Command list for slash command palette
  app.get('/api/commands', (_req, res) => {
    if (!commandListHandler) {
      res.json({ commands: [] });
      return;
    }
    res.json({ commands: commandListHandler() });
  });

  // Serve simple WebChat HTML client
  app.get('/webchat', (_req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clodds</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg-primary: #0c0a1a;
      --bg-secondary: #151228;
      --bg-card: #1c1835;
      --bg-input: #1c1835;
      --border: #2d2755;
      --border-hover: #4a3f8a;
      --text-primary: #eee9ff;
      --text-secondary: #9b8fc4;
      --text-dim: #6b5f9e;
      --accent: #a78bfa;
      --accent-bright: #c4b5fd;
      --accent-glow: rgba(167, 139, 250, 0.15);
      --cyan: #22d3ee;
      --cyan-dim: rgba(34, 211, 238, 0.12);
      --orange: #f59e0b;
      --orange-dim: rgba(245, 158, 11, 0.12);
      --green: #34d399;
      --red: #f87171;
      --user-bg: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
      --bot-bg: #1c1835;
      --radius: 16px;
      --radius-sm: 10px;
      --radius-xs: 6px;
    }
    html, body { height: 100%; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px 24px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .header-logo {
      width: 42px; height: 42px;
      border-radius: var(--radius-sm);
      box-shadow: 0 0 20px rgba(167, 139, 250, 0.2);
    }
    .header-info { flex: 1; }
    .header-title {
      font-size: 18px;
      font-weight: 700;
      background: linear-gradient(135deg, #f5f3ff 0%, #c4b5fd 50%, #f59e0b 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .header-subtitle {
      font-size: 12px;
      color: var(--text-dim);
      margin-top: 1px;
    }
    .status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--text-dim);
      transition: background 0.3s;
      flex-shrink: 0;
    }
    .status-dot.connected { background: var(--green); box-shadow: 0 0 8px rgba(52, 211, 153, 0.5); }
    .status-dot.error { background: var(--red); }

    /* ── Messages ── */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      scroll-behavior: smooth;
    }
    #messages::-webkit-scrollbar { width: 5px; }
    #messages::-webkit-scrollbar-track { background: transparent; }
    #messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    #messages::-webkit-scrollbar-thumb:hover { background: var(--border-hover); }

    .msg-row { display: flex; align-items: flex-end; gap: 10px; animation: fadeUp 0.25s ease-out; }
    .msg-row.user-row { flex-direction: row-reverse; }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .msg-avatar {
      width: 30px; height: 30px;
      border-radius: 50%;
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px;
      margin-bottom: 2px;
    }
    .bot-avatar {
      background: linear-gradient(135deg, #4c1d95, #6d28d9);
      color: #f59e0b;
    }
    .user-avatar {
      background: linear-gradient(135deg, #0891b2, #06b6d4);
      color: #0c0a1a;
      font-weight: 600;
    }

    .msg-bubble {
      max-width: 75%;
      padding: 12px 16px;
      line-height: 1.6;
      font-size: 14px;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .msg-bubble.user-bubble {
      background: var(--user-bg);
      color: #f5f3ff;
      border-radius: var(--radius) var(--radius) var(--radius-xs) var(--radius);
    }
    .msg-bubble.bot-bubble {
      background: var(--bg-card);
      color: var(--text-primary);
      border: 1px solid var(--border);
      border-radius: var(--radius) var(--radius) var(--radius) var(--radius-xs);
    }
    .msg-bubble.bot-bubble pre, .msg-bubble.bot-bubble code {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
      font-size: 12.5px;
    }
    .msg-bubble.bot-bubble pre {
      background: rgba(0,0,0,0.3);
      padding: 10px 12px;
      border-radius: var(--radius-xs);
      margin: 8px 0;
      overflow-x: auto;
      border: 1px solid rgba(255,255,255,0.05);
    }
    .msg-bubble.bot-bubble code {
      background: rgba(167, 139, 250, 0.12);
      padding: 2px 6px;
      border-radius: 4px;
      color: var(--accent-bright);
    }
    .msg-bubble.bot-bubble a {
      color: var(--cyan);
      text-decoration: none;
    }
    .msg-bubble.bot-bubble a:hover { text-decoration: underline; }
    .msg-bubble.bot-bubble img {
      max-width: 100%;
      border-radius: var(--radius-sm);
      margin-top: 8px;
    }

    .msg-system {
      text-align: center;
      font-size: 12px;
      color: var(--text-dim);
      padding: 8px 16px;
      animation: fadeUp 0.25s ease-out;
    }
    .msg-system .pill {
      display: inline-block;
      padding: 4px 14px;
      background: var(--accent-glow);
      border: 1px solid rgba(167, 139, 250, 0.15);
      border-radius: 20px;
      color: var(--text-secondary);
    }

    /* ── Typing indicator ── */
    .typing { display: none; align-items: flex-end; gap: 10px; padding: 0 24px 6px; }
    .typing.visible { display: flex; }
    .typing-dots {
      display: flex; gap: 4px;
      padding: 14px 18px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius) var(--radius) var(--radius) var(--radius-xs);
    }
    .typing-dots span {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--text-dim);
      animation: bounce 1.4s infinite ease-in-out;
    }
    .typing-dots span:nth-child(2) { animation-delay: 0.16s; }
    .typing-dots span:nth-child(3) { animation-delay: 0.32s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    /* ── Input ── */
    .input-area {
      padding: 16px 24px 20px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
    .input-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 4px 4px 4px 18px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .input-wrap:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }
    #input {
      flex: 1;
      border: none;
      background: transparent;
      color: var(--text-primary);
      font-size: 14px;
      font-family: inherit;
      outline: none;
      padding: 10px 0;
    }
    #input::placeholder { color: var(--text-dim); }
    #send-btn {
      width: 40px; height: 40px;
      border: none;
      border-radius: 12px;
      background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
      color: white;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      transition: transform 0.1s, box-shadow 0.2s, opacity 0.2s;
      opacity: 0.5;
    }
    #send-btn.active { opacity: 1; }
    #send-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(124, 58, 237, 0.4); }
    #send-btn:active { transform: scale(0.95); }
    #send-btn svg { width: 18px; height: 18px; }

    .input-hint {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 11px;
      color: var(--text-dim);
      padding: 0 4px;
    }
    .input-hint kbd {
      background: rgba(255,255,255,0.06);
      padding: 1px 6px;
      border-radius: 4px;
      font-family: inherit;
      font-size: 11px;
    }

    /* ── Command Palette ── */
    .cmd-palette {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 0; right: 0;
      max-height: 380px;
      overflow-y: auto;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-bottom: none;
      border-radius: var(--radius) var(--radius) 0 0;
      z-index: 100;
      box-shadow: 0 -12px 48px rgba(0,0,0,0.5);
      scrollbar-width: thin;
      scrollbar-color: var(--border) transparent;
    }
    .cmd-palette::-webkit-scrollbar { width: 6px; }
    .cmd-palette::-webkit-scrollbar-track { background: transparent; }
    .cmd-palette::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    .cmd-palette.visible { display: block; }
    .cmd-palette-header {
      padding: 12px 16px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--text-dim);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: var(--bg-primary);
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 1;
      backdrop-filter: blur(8px);
    }
    .cmd-palette-hint {
      font-size: 10px;
      color: var(--text-dim);
      font-weight: 400;
      letter-spacing: 0;
      text-transform: none;
    }
    .cmd-palette-hint kbd {
      background: rgba(255,255,255,0.06);
      padding: 1px 5px;
      border-radius: 3px;
      font-family: inherit;
      font-size: 10px;
      margin: 0 1px;
    }
    .cmd-back {
      padding: 8px 16px;
      font-size: 11px;
      color: var(--text-dim);
      cursor: pointer;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cmd-back:hover { color: var(--accent); }
    .cmd-category {
      border-bottom: 1px solid rgba(45,39,85,0.5);
    }
    .cmd-category:last-child { border-bottom: none; }
    .cmd-category-label {
      padding: 10px 16px 4px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cmd-category-icon {
      font-size: 12px;
      opacity: 0.7;
    }
    .cmd-category-count {
      margin-left: auto;
      font-size: 9px;
      font-weight: 500;
      color: var(--text-dim);
      background: rgba(255,255,255,0.04);
      padding: 1px 6px;
      border-radius: 8px;
    }
    .cmd-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 16px 7px 28px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .cmd-item:hover, .cmd-item.active {
      background: var(--accent-glow);
    }
    .cmd-item.active {
      border-left: 2px solid var(--accent);
      padding-left: 26px;
    }
    .cmd-item-name {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 13px;
      font-weight: 600;
      color: var(--accent-bright);
      min-width: 140px;
      flex-shrink: 0;
    }
    .cmd-item-desc {
      font-size: 12px;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .cmd-count {
      font-size: 10px;
      color: var(--text-dim);
      background: rgba(255,255,255,0.04);
      padding: 2px 8px;
      border-radius: 8px;
    }

    /* ── Welcome ── */
    .welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      gap: 16px;
      padding: 40px 24px;
      text-align: center;
    }
    .welcome-logo {
      width: 80px; height: 80px;
      border-radius: 20px;
      box-shadow: 0 0 40px rgba(167, 139, 250, 0.25);
    }
    .welcome h2 {
      font-size: 20px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .welcome p {
      color: var(--text-secondary);
      font-size: 14px;
      max-width: 340px;
      line-height: 1.6;
    }
    .welcome-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
      margin-top: 4px;
    }
    .welcome-chip {
      padding: 8px 16px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 20px;
      color: var(--text-secondary);
      font-size: 13px;
      cursor: pointer;
      transition: border-color 0.2s, color 0.2s, background 0.2s;
    }
    .welcome-chip:hover {
      border-color: var(--accent);
      color: var(--accent-bright);
      background: var(--accent-glow);
    }

    /* ── Mobile ── */
    @media (max-width: 600px) {
      .header { padding: 12px 16px; }
      #messages { padding: 16px; }
      .input-area { padding: 12px 16px 16px; }
      .msg-bubble { max-width: 85%; }
      .msg-avatar { width: 26px; height: 26px; font-size: 12px; }
      .welcome-chips { gap: 6px; }
      .welcome-chip { font-size: 12px; padding: 6px 12px; }
      .input-hint { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <img class="header-logo" src="https://cloddsbot.com/logo.png" alt="Clodds" onerror="this.textContent=''" />
    <div class="header-info">
      <div class="header-title">Clodds</div>
      <div class="header-subtitle">AI Trading Terminal</div>
    </div>
    <div class="status-dot" id="status-dot" title="Connecting..."></div>
  </div>

  <div id="messages">
    <div class="welcome" id="welcome">
      <img class="welcome-logo" src="https://cloddsbot.com/logo.png" alt="" onerror="this.style.display='none'" />
      <h2>What can I help you with?</h2>
      <p>I can trade prediction markets, analyze odds, track positions, and more.</p>
      <div class="welcome-chips">
        <div class="welcome-chip" data-msg="What markets are trending right now?">Trending markets</div>
        <div class="welcome-chip" data-msg="Show my current positions">My positions</div>
        <div class="welcome-chip" data-msg="What skills do you have?">Your skills</div>
        <div class="welcome-chip" data-msg="Help me get started">Get started</div>
      </div>
    </div>
  </div>

  <div class="typing" id="typing">
    <div class="msg-avatar bot-avatar">C</div>
    <div class="typing-dots"><span></span><span></span><span></span></div>
  </div>

  <div class="input-area" style="position:relative">
    <div class="cmd-palette" id="cmd-palette"></div>
    <div class="input-wrap">
      <input type="text" id="input" placeholder="Ask anything... (type / for commands)" autocomplete="off" />
      <button id="send-btn" onclick="send()" title="Send">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
    <div class="input-hint">
      <span>Try: <kbd>/help</kbd> <kbd>/markets</kbd> <kbd>/positions</kbd></span>
      <span><kbd>Enter</kbd> to send</span>
    </div>
  </div>

  <script>
    const port = window.location.port || 80;
    const ws = new WebSocket('ws://' + window.location.hostname + ':' + port + '/chat');
    const messagesEl = document.getElementById('messages');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const statusDot = document.getElementById('status-dot');
    const typingEl = document.getElementById('typing');
    const welcomeEl = document.getElementById('welcome');
    let hasMessages = false;

    function hideWelcome() {
      if (welcomeEl && !hasMessages) {
        welcomeEl.remove();
        hasMessages = true;
      }
    }

    // Welcome chip clicks
    document.querySelectorAll('.welcome-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        input.value = chip.dataset.msg;
        send();
      });
    });

    // ── Command Palette ──
    let allCommands = [];
    let filteredCommands = [];
    let activeIndex = -1;
    let paletteVisible = false;
    const palette = document.getElementById('cmd-palette');

    fetch('/api/commands')
      .then(r => r.json())
      .then(data => { allCommands = data.commands || []; })
      .catch(() => {});

    const CAT_ICONS = {
      'Core': '\u2699', 'Markets': '\uD83D\uDCCA', 'Prediction Markets': '\uD83C\uDFB2',
      'Trading': '\uD83D\uDCC8', 'Portfolio': '\uD83D\uDCBC', 'Strategy': '\uD83C\uDFAF',
      'DeFi': '\uD83D\uDD17', 'AI Agents': '\uD83E\uDD16', 'Automation': '\u26A1',
      'Risk & Safety': '\uD83D\uDEE1', 'Config': '\uD83D\uDD27', 'Tools': '\uD83E\uDDF0',
      'Media': '\uD83C\uDFA4', 'Social': '\uD83D\uDCAC', 'Bittensor': '\u26A0',
      'Analytics': '\uD83D\uDD2C', 'Other': '\uD83D\uDCE6',
    };

    let subcommandMode = false;

    function showPalette(filter) {
      const text = filter.slice(1); // strip leading /
      const spaceIdx = text.indexOf(' ');

      if (spaceIdx > 0) {
        // SUBCOMMAND MODE: "/hl lo" → show /hl's subcommands filtered by "lo"
        const parentCmd = '/' + text.slice(0, spaceIdx);
        const subQuery = text.slice(spaceIdx + 1).toLowerCase();
        const parent = allCommands.find(c => c.name === parentCmd);
        if (!parent || !parent.subcommands || !parent.subcommands.length) { hidePalette(); return; }

        const subs = subQuery
          ? parent.subcommands.filter(s => s.name.toLowerCase().includes(subQuery) || s.description.toLowerCase().includes(subQuery) || (s.category || '').toLowerCase().includes(subQuery))
          : parent.subcommands;

        if (!subs.length) { hidePalette(); return; }
        filteredCommands = subs.map(s => ({ name: s.name, description: s.description, category: s.category || 'General', fullName: parentCmd + ' ' + s.name }));
        subcommandMode = true;

        let html = '<div class="cmd-palette-header">'
          + '<span>' + parentCmd + '</span>'
          + '<span class="cmd-palette-hint"><kbd>\u2191\u2193</kbd> navigate <kbd>Tab</kbd> select <kbd>Esc</kbd> close</span>'
          + '</div>';
        html += '<div class="cmd-back" data-action="back">\u2190 All commands</div>';

        // Group subcommands by category
        const subGroups = {};
        for (const cmd of filteredCommands) {
          (subGroups[cmd.category] = subGroups[cmd.category] || []).push(cmd);
        }

        let idx = 0;
        for (const [section, cmds] of Object.entries(subGroups)) {
          html += '<div class="cmd-category">'
            + '<div class="cmd-category-label">'
            + '<span>' + section + '</span>'
            + '<span class="cmd-category-count">' + cmds.length + '</span>'
            + '</div>';
          for (const cmd of cmds) {
            html += '<div class="cmd-item' + (idx === activeIndex ? ' active' : '') + '" data-index="' + idx + '" data-name="' + cmd.fullName + '">'
              + '<span class="cmd-item-name">' + cmd.name + '</span>'
              + '<span class="cmd-item-desc">' + cmd.description + '</span></div>';
            idx++;
          }
          html += '</div>';
        }

        palette.innerHTML = html;
        palette.classList.add('visible');
        paletteVisible = true;

        palette.querySelectorAll('.cmd-item').forEach(item => {
          item.addEventListener('click', () => {
            input.value = '/' + item.dataset.name + ' ';
            hidePalette();
            input.focus();
            sendBtn.classList.add('active');
          });
        });
        const backBtn = palette.querySelector('.cmd-back');
        if (backBtn) {
          backBtn.addEventListener('click', () => {
            input.value = '/';
            showPalette('/');
            input.focus();
          });
        }
        return;
      }

      // TOP-LEVEL MODE (existing behavior)
      subcommandMode = false;
      const query = text.toLowerCase();
      filteredCommands = query
        ? allCommands.filter(c =>
            c.name.toLowerCase().includes(query) ||
            c.description.toLowerCase().includes(query) ||
            c.category.toLowerCase().includes(query))
        : allCommands;

      if (filteredCommands.length === 0) {
        hidePalette();
        return;
      }

      // Group by category, preserve order
      const groups = {};
      for (const cmd of filteredCommands) {
        (groups[cmd.category] = groups[cmd.category] || []).push(cmd);
      }

      let html = '<div class="cmd-palette-header">'
        + '<span>Commands</span>'
        + '<span class="cmd-palette-hint"><kbd>\u2191\u2193</kbd> navigate <kbd>Tab</kbd> select <kbd>Esc</kbd> close</span>'
        + '</div>';

      let idx = 0;
      for (const [category, cmds] of Object.entries(groups)) {
        const icon = CAT_ICONS[category] || '\uD83D\uDCE6';
        html += '<div class="cmd-category">'
          + '<div class="cmd-category-label">'
          + '<span class="cmd-category-icon">' + icon + '</span>'
          + '<span>' + category + '</span>'
          + '<span class="cmd-category-count">' + cmds.length + '</span>'
          + '</div>';
        for (const cmd of cmds) {
          const hasSubs = cmd.subcommands && cmd.subcommands.length > 0;
          html += '<div class="cmd-item' + (idx === activeIndex ? ' active' : '') + '" data-index="' + idx + '" data-name="' + cmd.name + '">'
            + '<span class="cmd-item-name">' + cmd.name + '</span>'
            + '<span class="cmd-item-desc">' + cmd.description + (hasSubs ? ' \u203A' : '') + '</span></div>';
          idx++;
        }
        html += '</div>';
      }

      palette.innerHTML = html;
      palette.classList.add('visible');
      paletteVisible = true;

      palette.querySelectorAll('.cmd-item').forEach(item => {
        item.addEventListener('click', () => {
          input.value = item.dataset.name + ' ';
          hidePalette();
          input.focus();
          sendBtn.classList.add('active');
        });
      });
    }

    function hidePalette() {
      palette.classList.remove('visible');
      paletteVisible = false;
      activeIndex = -1;
    }

    // Send button active state + palette trigger
    input.addEventListener('input', () => {
      const text = input.value;
      if (text.startsWith('/')) {
        const afterSlash = text.slice(1);
        const spaceIdx = afterSlash.indexOf(' ');
        if (spaceIdx === -1) {
          // Top-level: "/hl" — filter commands
          showPalette(text);
        } else {
          // Subcommand: "/hl " or "/hl lo" — show subcommands
          const parentCmd = '/' + afterSlash.slice(0, spaceIdx);
          const parent = allCommands.find(c => c.name === parentCmd);
          if (parent && parent.subcommands && parent.subcommands.length > 0) {
            activeIndex = -1;
            showPalette(text);
          } else {
            hidePalette();
          }
        }
      } else {
        hidePalette();
      }
      sendBtn.classList.toggle('active', text.trim().length > 0);
    });

    document.addEventListener('click', (e) => {
      if (!palette.contains(e.target) && e.target !== input) hidePalette();
    });

    function addMsg(text, cls, messageId) {
      hideWelcome();
      if (cls === 'system') {
        const row = document.createElement('div');
        row.className = 'msg-system';
        if (messageId) row.dataset.messageId = messageId;
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.textContent = text;
        row.appendChild(pill);
        messagesEl.appendChild(row);
      } else {
        const row = document.createElement('div');
        row.className = 'msg-row ' + (cls === 'user' ? 'user-row' : '');
        if (messageId) row.dataset.messageId = messageId;

        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar ' + (cls === 'user' ? 'user-avatar' : 'bot-avatar');
        avatar.textContent = cls === 'user' ? 'U' : 'C';

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble ' + (cls === 'user' ? 'user-bubble' : 'bot-bubble');
        bubble.textContent = text;

        row.appendChild(avatar);
        row.appendChild(bubble);
        messagesEl.appendChild(row);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showTyping() { typingEl.classList.add('visible'); messagesEl.scrollTop = messagesEl.scrollHeight; }
    function hideTyping() { typingEl.classList.remove('visible'); }

    function getToken() {
      const params = new URLSearchParams(window.location.search);
      const queryToken = params.get('token');
      if (queryToken) {
        localStorage.setItem('webchat_token', queryToken);
        return queryToken;
      }
      return localStorage.getItem('webchat_token') || '';
    }

    ws.onopen = () => {
      statusDot.className = 'status-dot connected';
      statusDot.title = 'Connected';
      const token = getToken();
      ws.send(JSON.stringify({ type: 'auth', token, userId: 'web-' + Date.now() }));
    };

    function renderAttachments(attachments) {
      if (!Array.isArray(attachments) || attachments.length === 0) return [];
      const nodes = [];
      for (const attachment of attachments) {
        const resolvedUrl = attachment.url || (attachment.data && attachment.mimeType
          ? 'data:' + attachment.mimeType + ';base64,' + attachment.data
          : null);
        if (attachment.type === 'image' && resolvedUrl) {
          const img = document.createElement('img');
          img.src = resolvedUrl || '';
          img.style.maxWidth = '100%';
          img.style.display = 'block';
          img.style.marginTop = '8px';
          img.style.borderRadius = '10px';
          nodes.push(img);
          continue;
        }
        if ((attachment.type === 'video' || attachment.type === 'audio') && resolvedUrl) {
          const media = document.createElement(attachment.type === 'video' ? 'video' : 'audio');
          media.src = resolvedUrl;
          media.controls = true;
          media.style.width = '100%';
          media.style.marginTop = '8px';
          media.style.borderRadius = '10px';
          nodes.push(media);
          continue;
        }
        const link = document.createElement('a');
        link.href = resolvedUrl || '#';
        link.textContent = attachment.filename || attachment.mimeType || 'attachment';
        link.style.display = 'block';
        link.style.marginTop = '8px';
        link.target = '_blank';
        nodes.push(link);
      }
      return nodes;
    }

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      hideTyping();
      if (msg.type === 'authenticated') {
        // Silent auth — no system message needed
      } else if (msg.type === 'message') {
        hideWelcome();
        const row = document.createElement('div');
        row.className = 'msg-row';
        if (msg.messageId) row.dataset.messageId = msg.messageId;

        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar bot-avatar';
        avatar.textContent = 'C';

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble bot-bubble';
        bubble.textContent = msg.text || '';

        const nodes = renderAttachments(msg.attachments || []);

        row.appendChild(avatar);
        row.appendChild(bubble);
        for (const node of nodes) bubble.appendChild(node);
        messagesEl.appendChild(row);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      } else if (msg.type === 'edit') {
        const row = Array.from(messagesEl.children)
          .find(el => el.dataset && el.dataset.messageId === msg.messageId);
        if (row) {
          const bubble = row.querySelector('.msg-bubble') || row;
          bubble.textContent = msg.text || '';
        }
      } else if (msg.type === 'delete') {
        const row = Array.from(messagesEl.children)
          .find(el => el.dataset && el.dataset.messageId === msg.messageId);
        if (row) row.remove();
      } else if (msg.type === 'error') {
        if (msg.message === 'Invalid token') {
          const retry = window.prompt('Authentication required. Enter WebChat token:');
          if (retry) {
            localStorage.setItem('webchat_token', retry);
            ws.send(JSON.stringify({ type: 'auth', token: retry, userId: 'web-' + Date.now() }));
          } else {
            addMsg('Authentication failed. Set WEBCHAT_TOKEN or pass ?token= in URL.', 'system');
          }
        } else {
          addMsg(msg.message, 'system');
        }
      }
    };

    ws.onclose = () => {
      statusDot.className = 'status-dot error';
      statusDot.title = 'Disconnected';
      addMsg('Connection lost. Refresh to reconnect.', 'system');
    };

    function send() {
      const text = input.value.trim();
      if (text && ws.readyState === WebSocket.OPEN) {
        addMsg(text, 'user');
        ws.send(JSON.stringify({ type: 'message', text }));
        input.value = '';
        sendBtn.classList.remove('active');
        showTyping();
      }
    }

    input.addEventListener('keydown', (e) => {
      if (paletteVisible) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIndex = Math.min(activeIndex + 1, filteredCommands.length - 1);
          showPalette(input.value);
          const active = palette.querySelector('.cmd-item.active');
          if (active) active.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIndex = Math.max(activeIndex - 1, 0);
          showPalette(input.value);
          const active = palette.querySelector('.cmd-item.active');
          if (active) active.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Tab') {
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < filteredCommands.length) {
            const sel = filteredCommands[activeIndex];
            if (subcommandMode) {
              input.value = '/' + sel.fullName + ' ';
            } else {
              input.value = sel.name + ' ';
              // If the selected command has subcommands, re-show palette
              const parent = allCommands.find(c => c.name === sel.name);
              if (parent && parent.subcommands && parent.subcommands.length > 0) {
                activeIndex = -1;
                showPalette(input.value);
                sendBtn.classList.add('active');
                return;
              }
            }
            hidePalette();
            sendBtn.classList.add('active');
          }
        } else if (e.key === 'Enter' && !e.shiftKey) {
          if (activeIndex >= 0 && activeIndex < filteredCommands.length) {
            e.preventDefault();
            const sel = filteredCommands[activeIndex];
            if (subcommandMode) {
              input.value = '/' + sel.fullName + ' ';
            } else {
              input.value = sel.name + ' ';
            }
            hidePalette();
            sendBtn.classList.add('active');
            return;
          }
          e.preventDefault();
          hidePalette();
          send();
        } else if (e.key === 'Escape') {
          hidePalette();
        }
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    input.focus();
  </script>
</body>
</html>
    `);
  });

  if (webhooks) {
    const webhookMiddleware = createWebhookMiddleware(webhooks);
    app.post('/webhook/*', webhookMiddleware);
    app.post('/webhook', webhookMiddleware);
  }

  // Channel webhooks (Teams, Google Chat, etc.)
  app.post('/channels/:platform', async (req, res) => {
    if (!channelWebhookHandler) {
      res.status(404).json({ error: 'Channel webhooks not configured' });
      return;
    }

    const platform = req.params.platform;
    try {
      const result = await channelWebhookHandler(platform, req.body, req);

      if (result === null || result === undefined) {
        res.status(200).send();
        return;
      }

      if (typeof result === 'string') {
        res.json({ text: result });
        return;
      }

      res.json(result);
    } catch (error) {
      logger.error({ error, platform }, 'Channel webhook handler failed');
      res.status(500).json({ error: 'Channel webhook error' });
    }
  });

  // Market index search endpoint
  app.get('/market-index/search', async (req, res) => {
    if (!marketIndexHandler) {
      res.status(404).json({ error: 'Market index handler not configured' });
      return;
    }

    try {
      const result = await marketIndexHandler(req);
      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, 'Market index handler failed');
      res.status(500).json({ error: 'Market index error' });
    }
  });

  app.get('/market-index/stats', async (req, res) => {
    if (!marketIndexStatsHandler) {
      res.status(404).json({ error: 'Market index handler not configured' });
      return;
    }

    try {
      const result = await marketIndexStatsHandler(req);
      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, 'Market index stats handler failed');
      res.status(500).json({ error: 'Market index error' });
    }
  });

  app.post('/market-index/sync', async (req, res) => {
    if (!marketIndexSyncHandler) {
      res.status(404).json({ error: 'Market index handler not configured' });
      return;
    }

    try {
      const result = await marketIndexSyncHandler(req);
      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, 'Market index sync handler failed');
      res.status(500).json({ error: 'Market index error' });
    }
  });

  // Backtest API endpoint
  app.post('/api/backtest', async (req, res) => {
    if (!backtestHandler) {
      res.status(404).json({ error: 'Backtest handler not configured' });
      return;
    }

    try {
      const result = await backtestHandler(req);
      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, 'Backtest handler failed');
      res.status(500).json({ error: 'Backtest error' });
    }
  });

  // Performance dashboard API endpoint
  app.get('/api/performance', async (req, res) => {
    if (!performanceDashboardHandler) {
      res.status(404).json({ error: 'Performance dashboard not configured' });
      return;
    }

    try {
      const result = await performanceDashboardHandler(req);
      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, 'Performance dashboard handler failed');
      res.status(500).json({ error: 'Performance dashboard error' });
    }
  });

  // Tick recorder endpoints
  app.get('/api/ticks/:platform/:marketId', async (req, res) => {
    if (!ticksHandler) {
      res.status(404).json({ error: 'Tick recorder not enabled' });
      return;
    }

    try {
      const result = await ticksHandler(req);
      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, 'Ticks handler failed');
      res.status(500).json({ error: 'Ticks query error' });
    }
  });

  app.get('/api/ohlc/:platform/:marketId', async (req, res) => {
    if (!ohlcHandler) {
      res.status(404).json({ error: 'Tick recorder not enabled' });
      return;
    }

    try {
      const result = await ohlcHandler(req);
      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, 'OHLC handler failed');
      res.status(500).json({ error: 'OHLC query error' });
    }
  });

  app.get('/api/orderbook-history/:platform/:marketId', async (req, res) => {
    if (!orderbookHistoryHandler) {
      res.status(404).json({ error: 'Tick recorder not enabled' });
      return;
    }

    try {
      const result = await orderbookHistoryHandler(req);
      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, 'Orderbook history handler failed');
      res.status(500).json({ error: 'Orderbook history query error' });
    }
  });

  app.get('/api/tick-recorder/stats', async (req, res) => {
    if (!tickRecorderStatsHandler) {
      res.status(404).json({ error: 'Tick recorder not enabled' });
      return;
    }

    try {
      const result = await tickRecorderStatsHandler(req);
      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, 'Tick recorder stats handler failed');
      res.status(500).json({ error: 'Tick recorder stats error' });
    }
  });

  // Tick streamer stats endpoint
  app.get('/api/tick-streamer/stats', (_req, res) => {
    if (!tickStreamer) {
      res.status(404).json({ error: 'Tick streamer not enabled' });
      return;
    }

    const stats = tickStreamer.getStats();
    res.json({ stats });
  });

  // Feature engineering endpoints
  app.get('/api/features/:platform/:marketId', (req, res) => {
    if (!featureEngineering) {
      res.status(404).json({ error: 'Feature engineering not enabled' });
      return;
    }

    const { platform, marketId } = req.params;
    const outcomeId = typeof req.query.outcomeId === 'string' ? req.query.outcomeId : undefined;

    const features = featureEngineering.getFeatures(platform, marketId, outcomeId);
    if (!features) {
      res.status(404).json({ error: 'No features available for this market' });
      return;
    }

    res.json({ features });
  });

  app.get('/api/features', (_req, res) => {
    if (!featureEngineering) {
      res.status(404).json({ error: 'Feature engineering not enabled' });
      return;
    }

    const snapshots = featureEngineering.getAllFeatures();
    res.json({ snapshots, count: snapshots.length });
  });

  app.get('/api/features/stats', (_req, res) => {
    if (!featureEngineering) {
      res.status(404).json({ error: 'Feature engineering not enabled' });
      return;
    }

    const stats = featureEngineering.getStats();
    res.json({ stats });
  });

  // Telegram Mini App
  app.get('/miniapp', (_req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Clodds</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--tg-theme-bg-color, #0f1419);
      color: var(--tg-theme-text-color, #e7e9ea);
      min-height: 100vh;
      padding: 16px;
    }
    .header { text-align: center; margin-bottom: 24px; }
    .header h1 { font-size: 24px; font-weight: 600; }
    .header p { color: var(--tg-theme-hint-color, #71767b); margin-top: 4px; }
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      padding: 4px;
      background: var(--tg-theme-secondary-bg-color, #16202a);
      border-radius: 12px;
    }
    .tab {
      flex: 1;
      padding: 10px;
      text-align: center;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .tab.active {
      background: var(--tg-theme-button-color, #1d9bf0);
      color: var(--tg-theme-button-text-color, #fff);
    }
    .section { display: none; }
    .section.active { display: block; }
    .card {
      background: var(--tg-theme-secondary-bg-color, #16202a);
      border-radius: 16px;
      padding: 16px;
      margin-bottom: 12px;
    }
    .card-title { font-size: 14px; color: var(--tg-theme-hint-color, #71767b); margin-bottom: 8px; }
    .card-value { font-size: 28px; font-weight: 700; }
    .card-value.positive { color: #00ba7c; }
    .card-value.negative { color: #f91880; }
    .list-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid var(--tg-theme-secondary-bg-color, #2f3336);
    }
    .list-item:last-child { border-bottom: none; }
    .list-item .name { font-weight: 500; }
    .list-item .value { font-size: 14px; }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge.buy { background: rgba(0, 186, 124, 0.2); color: #00ba7c; }
    .badge.sell { background: rgba(249, 24, 128, 0.2); color: #f91880; }
    .badge.arb { background: rgba(29, 155, 240, 0.2); color: #1d9bf0; }
    .btn {
      width: 100%;
      padding: 14px;
      border-radius: 12px;
      border: none;
      background: var(--tg-theme-button-color, #1d9bf0);
      color: var(--tg-theme-button-text-color, #fff);
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 16px;
    }
    .btn:hover { opacity: 0.9; }
    .loading { text-align: center; padding: 40px; color: var(--tg-theme-hint-color, #71767b); }
    .empty { text-align: center; padding: 40px; }
    .empty-icon { font-size: 48px; margin-bottom: 12px; }
    .empty-text { color: var(--tg-theme-hint-color, #71767b); }
    .search { width: 100%; padding: 12px 16px; border-radius: 12px; border: none; background: var(--tg-theme-secondary-bg-color, #16202a); color: var(--tg-theme-text-color, #e7e9ea); font-size: 16px; margin-bottom: 16px; }
    .search::placeholder { color: var(--tg-theme-hint-color, #71767b); }
  </style>
</head>
<body>
  <div class="header">
    <h1>Clodds</h1>
    <p>Prediction Markets AI</p>
  </div>

  <div class="tabs">
    <div class="tab active" data-tab="portfolio">Portfolio</div>
    <div class="tab" data-tab="markets">Markets</div>
    <div class="tab" data-tab="arb">Arbitrage</div>
  </div>

  <div id="portfolio" class="section active">
    <div class="card">
      <div class="card-title">Total Value</div>
      <div class="card-value" id="total-value">$0.00</div>
    </div>
    <div class="card">
      <div class="card-title">P&L</div>
      <div class="card-value" id="pnl">$0.00</div>
    </div>
    <div class="card">
      <div class="card-title">Positions</div>
      <div id="positions"><div class="loading">Loading...</div></div>
    </div>
  </div>

  <div id="markets" class="section">
    <input type="text" class="search" placeholder="Search markets..." id="market-search">
    <div id="market-list"><div class="loading">Loading...</div></div>
  </div>

  <div id="arb" class="section">
    <div class="card">
      <div class="card-title">Active Opportunities</div>
      <div id="arb-list"><div class="loading">Loading...</div></div>
    </div>
    <button class="btn" onclick="scanArb()">Scan Now</button>
  </div>

  <script>
    const Telegram = window.Telegram.WebApp;
    Telegram.ready();
    Telegram.expand();

    const baseUrl = window.location.origin;

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });

    // Format helpers
    function formatUSD(val) {
      const sign = val >= 0 ? '' : '-';
      return sign + '$' + Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatPct(val) {
      const sign = val >= 0 ? '+' : '';
      return sign + val.toFixed(1) + '%';
    }

    // Load portfolio
    async function loadPortfolio() {
      try {
        const res = await fetch(baseUrl + '/api/performance');
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();

        document.getElementById('total-value').textContent = formatUSD(data.stats.totalPnl + 10000);
        const pnlEl = document.getElementById('pnl');
        pnlEl.textContent = formatUSD(data.stats.totalPnl) + ' (' + formatPct(data.stats.avgPnlPct) + ')';
        pnlEl.className = 'card-value ' + (data.stats.totalPnl >= 0 ? 'positive' : 'negative');

        if (data.recentTrades.length === 0) {
          document.getElementById('positions').innerHTML = '<div class="empty"><div class="empty-icon">📊</div><div class="empty-text">No positions yet</div></div>';
        } else {
          document.getElementById('positions').innerHTML = data.recentTrades.slice(0, 5).map(t => \`
            <div class="list-item">
              <div>
                <div class="name">\${t.market.slice(0, 30)}\${t.market.length > 30 ? '...' : ''}</div>
                <div class="value">\${formatUSD(t.size)} @ \${(t.entryPrice * 100).toFixed(0)}%</div>
              </div>
              <span class="badge \${t.side.toLowerCase()}">\${t.side}</span>
            </div>
          \`).join('');
        }
      } catch (err) {
        document.getElementById('positions').innerHTML = '<div class="empty"><div class="empty-text">Failed to load portfolio</div></div>';
      }
    }

    // Load markets
    async function loadMarkets(query = '') {
      try {
        const url = baseUrl + '/market-index/search?q=' + encodeURIComponent(query || 'election');
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();

        if (!data.results || data.results.length === 0) {
          document.getElementById('market-list').innerHTML = '<div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">No markets found</div></div>';
          return;
        }

        document.getElementById('market-list').innerHTML = data.results.slice(0, 10).map(m => \`
          <div class="list-item">
            <div>
              <div class="name">\${m.question?.slice(0, 40) || m.title?.slice(0, 40) || 'Market'}\${(m.question || m.title || '').length > 40 ? '...' : ''}</div>
              <div class="value">\${m.platform}</div>
            </div>
            <div>\${m.yesPrice ? ((m.yesPrice * 100).toFixed(0) + '%') : '-'}</div>
          </div>
        \`).join('');
      } catch (err) {
        document.getElementById('market-list').innerHTML = '<div class="empty"><div class="empty-text">Failed to load markets</div></div>';
      }
    }

    // Load arbitrage opportunities
    async function loadArb() {
      document.getElementById('arb-list').innerHTML = '<div class="empty"><div class="empty-icon">⚡</div><div class="empty-text">Use the Scan button to find opportunities</div></div>';
    }

    async function scanArb() {
      document.getElementById('arb-list').innerHTML = '<div class="loading">Scanning...</div>';
      Telegram.HapticFeedback.impactOccurred('medium');

      // Simulate scan (would call real API)
      setTimeout(() => {
        document.getElementById('arb-list').innerHTML = '<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">No opportunities found above 1% edge</div></div>';
      }, 1500);
    }

    // Search handler
    let searchTimeout;
    document.getElementById('market-search').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => loadMarkets(e.target.value), 500);
    });

    // Initialize
    loadPortfolio();
    loadMarkets();
    loadArb();
  </script>
</body>
</html>`);
  });

  // Performance dashboard HTML UI
  app.get('/dashboard', (_req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Clodds Performance Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1419; color: #e7e9ea; }
    .header { background: #16202a; padding: 20px 30px; border-bottom: 1px solid #2f3336; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 24px; font-weight: 600; }
    .header .refresh { background: #1d9bf0; color: white; border: none; padding: 10px 20px; border-radius: 20px; cursor: pointer; font-weight: 600; }
    .header .refresh:hover { background: #1a8cd8; }
    .container { max-width: 1400px; margin: 0 auto; padding: 30px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .stat-card { background: #16202a; border-radius: 16px; padding: 24px; border: 1px solid #2f3336; }
    .stat-card .label { color: #71767b; font-size: 14px; margin-bottom: 8px; }
    .stat-card .value { font-size: 32px; font-weight: 700; }
    .stat-card .value.positive { color: #00ba7c; }
    .stat-card .value.negative { color: #f91880; }
    .charts-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 30px; }
    .chart-card { background: #16202a; border-radius: 16px; padding: 24px; border: 1px solid #2f3336; }
    .chart-card h3 { margin-bottom: 20px; font-size: 18px; }
    .chart-container { position: relative; height: 300px; }
    .trades-table { width: 100%; border-collapse: collapse; }
    .trades-table th, .trades-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #2f3336; }
    .trades-table th { color: #71767b; font-weight: 500; font-size: 14px; }
    .trades-table tr:hover { background: #1c2732; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge.buy { background: rgba(0, 186, 124, 0.2); color: #00ba7c; }
    .badge.sell { background: rgba(249, 24, 128, 0.2); color: #f91880; }
    .badge.win { background: rgba(0, 186, 124, 0.2); color: #00ba7c; }
    .badge.loss { background: rgba(249, 24, 128, 0.2); color: #f91880; }
    .badge.open { background: rgba(29, 155, 240, 0.2); color: #1d9bf0; }
    .loading { text-align: center; padding: 60px; color: #71767b; }
    .error { text-align: center; padding: 60px; color: #f91880; }
    @media (max-width: 900px) { .charts-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Performance Dashboard</h1>
    <button class="refresh" onclick="loadData()">Refresh</button>
  </div>
  <div class="container">
    <div id="content" class="loading">Loading...</div>
  </div>

  <script>
    let pnlChart = null;
    let strategyChart = null;

    async function loadData() {
      const content = document.getElementById('content');
      content.innerHTML = '<div class="loading">Loading...</div>';

      try {
        const res = await fetch('/api/performance');
        if (!res.ok) throw new Error('Failed to load data');
        const data = await res.json();
        render(data);
      } catch (err) {
        content.innerHTML = '<div class="error">Failed to load performance data. Make sure trading is enabled.</div>';
      }
    }

    function formatCurrency(val) {
      const sign = val >= 0 ? '+' : '';
      return sign + '$' + Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatPercent(val) {
      const sign = val >= 0 ? '+' : '';
      return sign + val.toFixed(2) + '%';
    }

    function render(data) {
      const { stats, recentTrades, dailyPnl, byStrategy } = data;

      const html = \`
        <div class="stats-grid">
          <div class="stat-card">
            <div class="label">Total Trades</div>
            <div class="value">\${stats.totalTrades}</div>
          </div>
          <div class="stat-card">
            <div class="label">Win Rate</div>
            <div class="value \${stats.winRate >= 50 ? 'positive' : 'negative'}">\${stats.winRate.toFixed(1)}%</div>
          </div>
          <div class="stat-card">
            <div class="label">Total P&L</div>
            <div class="value \${stats.totalPnl >= 0 ? 'positive' : 'negative'}">\${formatCurrency(stats.totalPnl)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Avg P&L %</div>
            <div class="value \${stats.avgPnlPct >= 0 ? 'positive' : 'negative'}">\${formatPercent(stats.avgPnlPct)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Sharpe Ratio</div>
            <div class="value \${stats.sharpeRatio >= 1 ? 'positive' : stats.sharpeRatio < 0 ? 'negative' : ''}">\${stats.sharpeRatio.toFixed(2)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Max Drawdown</div>
            <div class="value negative">\${formatPercent(-stats.maxDrawdown)}</div>
          </div>
        </div>

        <div class="charts-grid">
          <div class="chart-card">
            <h3>Cumulative P&L</h3>
            <div class="chart-container"><canvas id="pnlChart"></canvas></div>
          </div>
          <div class="chart-card">
            <h3>By Strategy</h3>
            <div class="chart-container"><canvas id="strategyChart"></canvas></div>
          </div>
        </div>

        <div class="chart-card">
          <h3>Recent Trades</h3>
          <table class="trades-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Market</th>
                <th>Side</th>
                <th>Size</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>P&L</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              \${recentTrades.map(t => \`
                <tr>
                  <td>\${new Date(t.timestamp).toLocaleString()}</td>
                  <td>\${t.market.slice(0, 40)}\${t.market.length > 40 ? '...' : ''}</td>
                  <td><span class="badge \${t.side.toLowerCase()}">\${t.side}</span></td>
                  <td>$\${t.size.toLocaleString()}</td>
                  <td>\${(t.entryPrice * 100).toFixed(1)}%</td>
                  <td>\${t.exitPrice ? (t.exitPrice * 100).toFixed(1) + '%' : '-'}</td>
                  <td class="\${(t.pnl || 0) >= 0 ? 'positive' : 'negative'}">\${t.pnl != null ? formatCurrency(t.pnl) : '-'}</td>
                  <td><span class="badge \${t.status === 'win' ? 'win' : t.status === 'loss' ? 'loss' : 'open'}">\${t.status}</span></td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        </div>
      \`;

      document.getElementById('content').innerHTML = html;

      // Cumulative P&L chart
      if (pnlChart) pnlChart.destroy();
      const pnlCtx = document.getElementById('pnlChart').getContext('2d');
      pnlChart = new Chart(pnlCtx, {
        type: 'line',
        data: {
          labels: dailyPnl.map(d => d.date),
          datasets: [{
            label: 'Cumulative P&L',
            data: dailyPnl.map(d => d.cumulative),
            borderColor: '#1d9bf0',
            backgroundColor: 'rgba(29, 155, 240, 0.1)',
            fill: true,
            tension: 0.3,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: '#2f3336' }, ticks: { color: '#71767b' } },
            y: { grid: { color: '#2f3336' }, ticks: { color: '#71767b', callback: v => '$' + v } }
          }
        }
      });

      // Strategy breakdown chart
      if (strategyChart) strategyChart.destroy();
      const stratCtx = document.getElementById('strategyChart').getContext('2d');
      strategyChart = new Chart(stratCtx, {
        type: 'doughnut',
        data: {
          labels: byStrategy.map(s => s.strategy),
          datasets: [{
            data: byStrategy.map(s => s.trades),
            backgroundColor: ['#1d9bf0', '#00ba7c', '#f91880', '#ffd400', '#7856ff'],
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { color: '#e7e9ea' } }
          }
        }
      });
    }

    loadData();
  </script>
</body>
</html>`);
  });

  return {
    async start() {
      return new Promise((resolve) => {
        httpServer = createHttpServer(app);

        // WebSocket server - handles both /ws and /chat
        wss = new WebSocketServer({ noServer: true });

        // Handle upgrade requests
        httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
          const pathname = request.url?.split('?')[0] || '';

          if (pathname === '/ws' || pathname === '/chat') {
            wss!.handleUpgrade(request, socket, head, (ws) => {
              wss!.emit('connection', ws, request);
            });
          } else if (pathname === '/api/ticks/stream') {
            // Tick streaming WebSocket endpoint
            if (!tickStreamer) {
              socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
              socket.destroy();
              return;
            }
            wss!.handleUpgrade(request, socket, head, (ws) => {
              tickStreamer!.handleConnection(ws);
            });
          } else {
            socket.destroy();
          }
        });

        // Default /ws handler (for API/control)
        wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
          // /chat connections are handled by WebChat channel via attachWebSocket
          if (request.url === '/chat') {
            return; // Let WebChat handle it
          }

          logger.info('WebSocket API client connected');

          ws.on('message', (data) => {
            try {
              const message = JSON.parse(data.toString());
              logger.debug({ message }, 'WS API message received');

              ws.send(
                JSON.stringify({
                  type: 'res',
                  id: message.id,
                  ok: true,
                  payload: { echo: message },
                })
              );
            } catch (err) {
              logger.error({ err }, 'Failed to parse WS message');
            }
          });

          ws.on('close', () => {
            logger.info('WebSocket API client disconnected');
          });
        });

        httpServer.listen(config.port, () => {
          resolve();
        });
      });
    },

    async stop() {
      return new Promise((resolve) => {
        wss?.close();
        httpServer?.close(() => resolve());
      });
    },

    getWebSocketServer(): WebSocketServer | null {
      return wss;
    },

    setChannelWebhookHandler(handler: ChannelWebhookHandler | null): void {
      channelWebhookHandler = handler;
    },

    setMarketIndexHandler(handler: MarketIndexHandler | null): void {
      marketIndexHandler = handler;
    },
    setMarketIndexStatsHandler(handler: MarketIndexStatsHandler | null): void {
      marketIndexStatsHandler = handler;
    },
    setMarketIndexSyncHandler(handler: MarketIndexSyncHandler | null): void {
      marketIndexSyncHandler = handler;
    },
    setPerformanceDashboardHandler(handler: PerformanceDashboardHandler | null): void {
      performanceDashboardHandler = handler;
    },
    setBacktestHandler(handler: BacktestHandler | null): void {
      backtestHandler = handler;
    },
    setTicksHandler(handler: TicksHandler | null): void {
      ticksHandler = handler;
    },
    setOHLCHandler(handler: OHLCHandler | null): void {
      ohlcHandler = handler;
    },
    setOrderbookHistoryHandler(handler: OrderbookHistoryHandler | null): void {
      orderbookHistoryHandler = handler;
    },
    setTickRecorderStatsHandler(handler: TickRecorderStatsHandler | null): void {
      tickRecorderStatsHandler = handler;
    },
    setTickStreamer(streamer: TickStreamer | null): void {
      tickStreamer = streamer;
    },
    setFeatureEngineering(service: FeatureEngineering | null): void {
      featureEngineering = service;
    },
    setBittensorRouter(router: Router | null): void {
      if (router) {
        app.use('/api/bittensor', requireAuth, router);
      }
    },
    setTradingApiRouter(router: Router | null): void {
      if (router) {
        app.use('/api', requireAuth, router);
      }
    },
    setCommandListHandler(handler: CommandListHandler | null): void {
      commandListHandler = handler;
    },
  };
}
