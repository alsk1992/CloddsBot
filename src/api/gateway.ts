/**
 * API Gateway - Main HTTP server for Clodds Hosted API
 *
 * Endpoints:
 * - POST /v2/prompt       Submit natural language prompt (x402 payment)
 * - GET  /v2/job/:id      Check job status
 * - POST /v2/job/:id/cancel  Cancel pending job
 * - GET  /v2/jobs         List jobs for wallet
 * - GET  /v2/wallet       Get managed wallet info
 * - GET  /health          Basic health check
 * - GET  /health/live     Liveness check (is the process alive?)
 * - GET  /health/ready    Readiness check (is the service ready for traffic?)
 * - GET  /metrics         API metrics (JSON, auth required)
 * - GET  /metrics/prometheus  Prometheus-format metrics (auth required)
 */

import { EventEmitter } from 'eventemitter3';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';
import { createX402Middleware, type X402Middleware } from './middleware';
import { createJobManager, type JobManager, type Job } from './jobs';
import { createPromptHandler, type PromptHandler } from './prompt';
import { createCustodyManager, type CustodyManager } from './custody';
import {
  registry,
  httpRequestsTotal,
  httpRequestDuration,
  httpActiveConnections,
  httpErrorsTotal,
  jobsTotal,
  jobsActive,
  jobDuration,
  startMetricsCollection,
  stopMetricsCollection,
} from '../monitoring/metrics';
import {
  healthChecker,
  createMemoryHealthCheck,
  type HealthCheckResult,
  type ReadinessResult,
  type LivenessResult,
} from '../monitoring/health';
import type {
  ApiGatewayConfig,
  ApiRequest,
  ApiResponse,
  PaymentProof,
  PricingTier,
  ApiMetrics,
  PromptResultData,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface ApiGateway extends EventEmitter {
  /** Start the server */
  start(): Promise<void>;
  /** Stop the server */
  stop(): Promise<void>;
  /** Get server URL */
  getUrl(): string;
  /** Get API metrics */
  getMetrics(): ApiMetrics;
  /** Get middleware */
  getX402Middleware(): X402Middleware;
  /** Get job manager */
  getJobManager(): JobManager;
  /** Get prompt handler */
  getPromptHandler(): PromptHandler;
  /** Get custody manager */
  getCustodyManager(): CustodyManager;
}

interface ParsedRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

type RouteHandler = (req: ParsedRequest, res: ServerResponse) => Promise<void>;

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<ApiGatewayConfig> = {
  port: 3001,
  host: '0.0.0.0',
  cors: true,
  pricing: {
    basic: 0.05,
    standard: 0.10,
    complex: 0.25,
    defaultTier: 'standard',
    tokenDiscount: 0.2,
  },
  x402: {},
  jobs: {},
  custody: { enabled: false, masterKey: '' },
  rateLimit: { perMinute: 60, perWallet: 120, burst: 10 },
  logLevel: 'info',
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createApiGateway(config: ApiGatewayConfig = {}): ApiGateway {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const emitter = new EventEmitter() as ApiGateway;

  // Components
  const x402 = createX402Middleware({ ...cfg.x402, pricing: cfg.pricing });
  const jobs = createJobManager(cfg.jobs, executeJob);
  const prompt = createPromptHandler({ dryRun: process.env.CLODDS_DRY_RUN === 'true' });
  const custody = createCustodyManager(cfg.custody);

  // Rate limiting
  const rateLimits = new Map<string, { count: number; resetAt: number }>();

  // Metrics
  const metrics: ApiMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalRevenue: 0,
    revenueByTier: { basic: 0, standard: 0, complex: 0 },
    avgResponseTime: 0,
    activeJobs: 0,
    uniqueWallets: new Set<string>().size,
    uptime: 0,
    tradingVolume: 0,
    tradingFees: 0,
  };

  const uniqueWallets = new Set<string>();
  const startTime = Date.now();
  let totalResponseTime = 0;
  let responseCount = 0;

  // HTTP Server
  let server: ReturnType<typeof createServer> | null = null;

  // Routes
  const routes: Array<{ method: string; pattern: RegExp; handler: RouteHandler }> = [];

  function addRoute(method: string, path: string, handler: RouteHandler): void {
    // Convert /path/:param to regex
    const pattern = new RegExp(
      '^' + path.replace(/:[^/]+/g, '([^/]+)').replace(/\//g, '\\/') + '$'
    );
    routes.push({ method, pattern, handler });
  }

  function matchRoute(method: string, path: string): { handler: RouteHandler; params: Record<string, string> } | null {
    for (const route of routes) {
      if (route.method !== method && route.method !== '*') continue;

      const match = path.match(route.pattern);
      if (match) {
        // Extract params
        const paramNames = (route.pattern.source.match(/\([^)]+\)/g) || []);
        const params: Record<string, string> = {};
        paramNames.forEach((_, i) => {
          const name = routes.find(r => r.pattern === route.pattern)?.pattern.source
            .match(/:(\w+)/g)?.[i]?.slice(1);
          if (name && match[i + 1]) {
            params[name] = match[i + 1];
          }
        });

        return { handler: route.handler, params };
      }
    }
    return null;
  }

  // Helper functions
  function json(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'X-Powered-By': 'Clodds',
      'X-Clodds-Version': '1.0.0',
      'X-Request-Id': randomBytes(8).toString('hex'),
      ...getCorsHeaders(),
    });
    res.end(JSON.stringify(data));
  }

  function getCorsHeaders(): Record<string, string> {
    if (!cfg.cors) return {};
    if (cfg.cors === true) {
      return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Payment-Proof, X-Wallet-Address',
      };
    }
    return {
      'Access-Control-Allow-Origin': (cfg.cors as string[]).join(', '),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Payment-Proof, X-Wallet-Address',
    };
  }

  function checkRateLimit(key: string, limit: number): boolean {
    const now = Date.now();
    const entry = rateLimits.get(key);

    if (!entry || entry.resetAt < now) {
      rateLimits.set(key, { count: 1, resetAt: now + 60000 });
      return true;
    }

    if (entry.count >= limit) {
      return false;
    }

    entry.count++;
    return true;
  }

  function getClientIp(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  // Job executor
  async function executeJob(job: Job): Promise<PromptResultData> {
    const data = job.getData();
    const result = await prompt.process(data.request, data.tier);

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Unknown error');
    }

    return result.data;
  }

  // Route handlers
  async function handlePrompt(req: ParsedRequest, res: ServerResponse): Promise<void> {
    const requestStart = Date.now();
    metrics.totalRequests++;

    try {
      // Get wallet address
      const wallet = req.headers['x-wallet-address'] || (req.body as any)?.wallet;
      if (!wallet) {
        json(res, 400, { error: 'Missing wallet address' });
        metrics.failedRequests++;
        return;
      }

      // Rate limit by IP and wallet
      const clientIp = getClientIp({ headers: req.headers } as IncomingMessage);
      if (!checkRateLimit(`ip:${clientIp}`, cfg.rateLimit.perMinute || 60)) {
        json(res, 429, { error: 'Rate limit exceeded' });
        metrics.failedRequests++;
        return;
      }
      if (!checkRateLimit(`wallet:${wallet}`, cfg.rateLimit.perWallet || 120)) {
        json(res, 429, { error: 'Wallet rate limit exceeded' });
        metrics.failedRequests++;
        return;
      }

      // Get prompt
      const promptText = (req.body as any)?.prompt;
      if (!promptText) {
        json(res, 400, { error: 'Missing prompt' });
        metrics.failedRequests++;
        return;
      }

      // Classify and price
      const tier = x402.classifyPrompt(promptText);
      const price = x402.getPrice(tier);

      // Check payment
      let paymentProof: PaymentProof | undefined;
      const proofHeader = req.headers['x-payment-proof'];
      if (proofHeader) {
        try {
          paymentProof = JSON.parse(Buffer.from(proofHeader, 'base64').toString());
        } catch {
          json(res, 400, { error: 'Invalid payment proof format' });
          metrics.failedRequests++;
          return;
        }
      }

      const hasPayment = await x402.hasValidPayment(paymentProof, price);
      if (!hasPayment) {
        // Return 402 Payment Required
        const headers = x402.getPaymentRequiredHeaders(price, tier);
        res.writeHead(402, { 'Content-Type': 'application/json', ...headers, ...getCorsHeaders() });
        res.end(JSON.stringify({
          error: 'Payment Required',
          amount: price,
          currency: 'USD',
          tier,
          paymentAddress: x402.getPaymentAddress(),
          protocol: 'x402',
        }));
        return;
      }

      // Create request
      const apiRequest: ApiRequest = {
        id: `req_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`,
        prompt: promptText,
        wallet,
        paymentProof,
        useCustody: (req.body as any)?.useCustody,
        chain: (req.body as any)?.chain,
        callbackUrl: (req.body as any)?.callbackUrl,
        meta: (req.body as any)?.meta,
      };

      // Create job
      const job = jobs.create(apiRequest, tier, price);
      const jobData = job.getData();

      // Track metrics
      uniqueWallets.add(wallet.toLowerCase());
      metrics.uniqueWallets = uniqueWallets.size;
      metrics.totalRevenue += price;
      metrics.revenueByTier[tier] += price;
      metrics.successfulRequests++;

      // Track response time
      const responseTime = Date.now() - requestStart;
      totalResponseTime += responseTime;
      responseCount++;
      metrics.avgResponseTime = Math.round(totalResponseTime / responseCount);

      // Return response
      const response: ApiResponse = {
        id: apiRequest.id,
        jobId: jobData.id,
        status: jobData.status,
        cost: price,
        tier,
        timestamp: Date.now(),
      };

      json(res, 202, response);

      emitter.emit('request', { request: apiRequest, job: jobData });
    } catch (error) {
      metrics.failedRequests++;
      logger.error({ error }, 'Prompt handler error');
      json(res, 500, { error: 'Internal server error' });
    }
  }

  async function handleGetJob(req: ParsedRequest, res: ServerResponse): Promise<void> {
    const jobId = req.path.split('/').pop();
    if (!jobId) {
      json(res, 400, { error: 'Missing job ID' });
      return;
    }

    const job = jobs.get(jobId);
    if (!job) {
      json(res, 404, { error: 'Job not found' });
      return;
    }

    const data = job.getData();

    // Verify ownership - only job owner can view
    const requestWallet = req.headers['x-wallet-address']?.toLowerCase();
    if (requestWallet && data.request.wallet.toLowerCase() !== requestWallet) {
      json(res, 403, { error: 'Not authorized to view this job' });
      return;
    }
    const response: ApiResponse = {
      id: data.request.id,
      jobId: data.id,
      status: data.status,
      result: data.result,
      error: data.error,
      cost: data.cost,
      tier: data.tier,
      timestamp: data.updatedAt,
    };

    json(res, 200, response);
  }

  async function handleCancelJob(req: ParsedRequest, res: ServerResponse): Promise<void> {
    const parts = req.path.split('/');
    const jobId = parts[parts.length - 2];

    if (!jobId) {
      json(res, 400, { error: 'Missing job ID' });
      return;
    }

    // Verify ownership before cancel
    const job = jobs.get(jobId);
    if (!job) {
      json(res, 404, { error: 'Job not found' });
      return;
    }

    const requestWallet = req.headers['x-wallet-address']?.toLowerCase();
    if (!requestWallet || job.getData().request.wallet.toLowerCase() !== requestWallet) {
      json(res, 403, { error: 'Not authorized to cancel this job' });
      return;
    }

    const success = jobs.cancel(jobId);
    if (!success) {
      json(res, 400, { error: 'Cannot cancel job (already completed)' });
      return;
    }

    json(res, 200, { success: true, jobId });
  }

  async function handleListJobs(req: ParsedRequest, res: ServerResponse): Promise<void> {
    const wallet = req.headers['x-wallet-address'] || req.query.wallet;
    if (!wallet) {
      json(res, 400, { error: 'Missing wallet address' });
      return;
    }

    const limit = parseInt(req.query.limit || '10', 10);
    const jobList = jobs.getByWallet(wallet, limit);

    json(res, 200, {
      jobs: jobList.map(j => {
        const d = j.getData();
        return {
          id: d.id,
          status: d.status,
          tier: d.tier,
          cost: d.cost,
          createdAt: d.createdAt,
          completedAt: d.completedAt,
        };
      }),
    });
  }

  async function handleWallet(req: ParsedRequest, res: ServerResponse): Promise<void> {
    if (!cfg.custody.enabled) {
      json(res, 400, { error: 'Custody wallets not enabled' });
      return;
    }

    const wallet = req.headers['x-wallet-address'];
    if (!wallet) {
      json(res, 400, { error: 'Missing wallet address' });
      return;
    }

    const managed = await custody.getOrCreate(wallet);
    json(res, 200, managed.getData());
  }

  async function handleHealth(req: ParsedRequest, res: ServerResponse): Promise<void> {
    // Full health check with component status
    const health: HealthCheckResult = await healthChecker.checkHealth();

    const status = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
    json(res, status, {
      status: health.status,
      timestamp: health.timestamp,
      uptime: health.uptime,
      version: health.version,
      components: health.components,
      summary: health.summary,
    });
  }

  async function handleLiveness(req: ParsedRequest, res: ServerResponse): Promise<void> {
    // Liveness check - is the process alive and not stuck?
    const liveness: LivenessResult = await healthChecker.checkLiveness();

    const status = liveness.alive && liveness.eventLoop.healthy ? 200 : 503;
    json(res, status, liveness);
  }

  async function handleReadiness(req: ParsedRequest, res: ServerResponse): Promise<void> {
    // Readiness check - is the service ready to accept traffic?
    const readiness: ReadinessResult = await healthChecker.checkReadiness();

    const status = readiness.ready ? 200 : 503;
    json(res, status, readiness);
  }

  async function handleMetrics(req: ParsedRequest, res: ServerResponse): Promise<void> {
    // Auth check for metrics endpoint
    const authToken = process.env.CLODDS_TOKEN;
    if (authToken) {
      const providedToken = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
      if (providedToken !== authToken) {
        json(res, 401, { error: 'Unauthorized - provide valid token via Authorization header or ?token= param' });
        return;
      }
    }

    const jobStats = jobs.getStats();
    const paymentStats = x402.getStats();
    const custodyStats = custody.getStats();

    json(res, 200, {
      ...metrics,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      jobs: jobStats,
      payments: paymentStats,
      custody: custodyStats,
    });
  }

  async function handlePrometheusMetrics(req: ParsedRequest, res: ServerResponse): Promise<void> {
    // Auth check for metrics endpoint
    const authToken = process.env.CLODDS_TOKEN;
    if (authToken) {
      const providedToken = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
      if (providedToken !== authToken) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Unauthorized');
        return;
      }
    }

    // Return Prometheus-format metrics
    const prometheusText = registry.toPrometheusText();
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      ...getCorsHeaders(),
    });
    res.end(prometheusText);
  }

  // Register routes
  addRoute('POST', '/v2/prompt', handlePrompt);
  addRoute('GET', '/v2/job/:id', handleGetJob);
  addRoute('POST', '/v2/job/:id/cancel', handleCancelJob);
  addRoute('GET', '/v2/jobs', handleListJobs);
  addRoute('GET', '/v2/wallet', handleWallet);
  addRoute('POST', '/v2/wallet', handleWallet);
  // Health endpoints
  addRoute('GET', '/health', handleHealth);
  addRoute('GET', '/health/live', handleLiveness);
  addRoute('GET', '/health/ready', handleReadiness);
  // Metrics endpoints
  addRoute('GET', '/metrics', handleMetrics);
  addRoute('GET', '/metrics/prometheus', handlePrometheusMetrics);

  // Request handler
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestStart = Date.now();
    const method = req.method || 'GET';

    // Track active connections
    httpActiveConnections.inc();
    res.on('finish', () => {
      httpActiveConnections.dec();
    });

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, getCorsHeaders());
      res.end();
      return;
    }

    const url = parseUrl(req.url || '/', true);
    const path = url.pathname || '/';

    // Normalize path for metrics (replace IDs with :id)
    const normalizedPath = path.replace(/\/[a-f0-9-]{8,}(?:\/|$)/gi, '/:id/').replace(/\/$/, '');

    // Parse body for POST requests
    let body: unknown = {};
    if (method === 'POST') {
      body = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => {
          try {
            resolve(JSON.parse(data || '{}'));
          } catch {
            resolve({});
          }
        });
      });
    }

    // Build parsed request
    const parsed: ParsedRequest = {
      method,
      path,
      params: {},
      query: url.query as Record<string, string>,
      body,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v || ''])
      ),
    };

    // Match route
    const matched = matchRoute(parsed.method, path);
    if (!matched) {
      // Track 404 in metrics
      httpRequestsTotal.inc({ method, path: normalizedPath, status: '404' });
      httpRequestDuration.observe({ method, path: normalizedPath }, Date.now() - requestStart);
      json(res, 404, { error: 'Not found' });
      return;
    }

    parsed.params = matched.params;

    try {
      await matched.handler(parsed, res);

      // Track successful request in metrics
      const statusCode = res.statusCode || 200;
      httpRequestsTotal.inc({ method, path: normalizedPath, status: String(statusCode) });
      httpRequestDuration.observe({ method, path: normalizedPath }, Date.now() - requestStart);
    } catch (error) {
      logger.error({ error, path }, 'Request handler error');

      // Track error in metrics
      httpRequestsTotal.inc({ method, path: normalizedPath, status: '500' });
      httpErrorsTotal.inc({ method, path: normalizedPath, error_type: 'internal_error' });
      httpRequestDuration.observe({ method, path: normalizedPath }, Date.now() - requestStart);

      json(res, 500, { error: 'Internal server error' });
    }
  }

  // API
  async function start(): Promise<void> {
    return new Promise((resolve, reject) => {
      server = createServer(handleRequest);

      server.on('error', (err) => {
        logger.error({ error: err }, 'Server error');
        reject(err);
      });

      server.listen(cfg.port, cfg.host, () => {
        logger.info({ port: cfg.port, host: cfg.host }, 'Clodds API Gateway started');
        jobs.start();
        // Start collecting system metrics
        startMetricsCollection(15000);
        emitter.emit('started');
        resolve();
      });
    });
  }

  async function stop(): Promise<void> {
    return new Promise((resolve) => {
      jobs.stop();
      // Stop collecting system metrics
      stopMetricsCollection();

      if (server) {
        server.close(() => {
          logger.info('Clodds API Gateway stopped');
          emitter.emit('stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  function getUrl(): string {
    return `http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`;
  }

  function getMetrics(): ApiMetrics {
    return {
      ...metrics,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      activeJobs: jobs.getStats().processing,
    };
  }

  // Attach methods to emitter
  Object.assign(emitter, {
    start,
    stop,
    getUrl,
    getMetrics,
    getX402Middleware: () => x402,
    getJobManager: () => jobs,
    getPromptHandler: () => prompt,
    getCustodyManager: () => custody,
  });

  return emitter;
}
