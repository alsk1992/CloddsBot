/**
 * Compute Gateway - Main entry point for agent compute marketplace
 *
 * Agents pay USDC for compute resources. No API keys needed - just a wallet.
 */

import { randomBytes, createHmac } from 'crypto';
import { EventEmitter } from 'eventemitter3';
import { logger } from '../../utils/logger';
import { createPersistenceLayer, type PersistenceLayer } from './persistence';
import type {
  ComputeService,
  ComputeRequest,
  ComputeResponse,
  ComputeUsage,
  ComputePricing,
  PaymentProof,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface ComputeGateway {
  /** Submit a compute request */
  submit(request: ComputeRequest): Promise<ComputeResponse>;
  /** Get job status */
  getJob(jobId: string, wallet?: string): Promise<ComputeResponse | null>;
  /** Get all jobs for a wallet */
  getJobsByWallet(wallet: string, limit?: number): Promise<ComputeResponse[]>;
  /** Cancel a job */
  cancelJob(jobId: string, wallet: string): Promise<boolean>;
  /** Get pricing for a service */
  getPricing(service: ComputeService): ComputePricing;
  /** Get wallet balance/credits */
  getBalance(wallet: string): Promise<WalletBalance>;
  /** Deposit credits */
  depositCredits(wallet: string, proof: PaymentProof): Promise<DepositResult>;
  /** Get usage stats */
  getUsage(wallet: string, period?: 'day' | 'week' | 'month' | 'all'): Promise<UsageStats>;
  /** Register service handler */
  registerHandler(service: ComputeService, handler: ServiceHandler): void;
  /** Check rate limit */
  checkRateLimit(wallet: string, ip: string): RateLimitResult;
  /** Get metrics */
  getMetrics(): GatewayMetrics;
  /** Event emitter for job updates */
  events: EventEmitter;
  /** Shutdown */
  shutdown(): void;
}

export type ServiceHandler = (request: ComputeRequest) => Promise<unknown>;

export interface ComputeGatewayConfig {
  /** Minimum balance to execute (default: 0.001) */
  minBalance?: number;
  /** Job timeout in ms (default: 300000) */
  jobTimeout?: number;
  /** Max concurrent jobs per wallet (default: 10) */
  maxConcurrent?: number;
  /** USDC contract address on Base */
  usdcAddress?: string;
  /** Treasury wallet for payments */
  treasuryWallet?: string;
  /** Rate limit: requests per minute per wallet */
  walletRateLimit?: number;
  /** Rate limit: requests per minute per IP */
  ipRateLimit?: number;
  /** Database path */
  dbPath?: string;
  /** Supported payment networks */
  supportedNetworks?: string[];
}

export interface WalletBalance {
  wallet: string;
  available: number;
  pending: number;
  totalDeposited: number;
  totalSpent: number;
}

export interface DepositResult {
  success: boolean;
  credits: number;
  txHash: string;
  error?: string;
}

export interface UsageStats {
  wallet: string;
  period: 'day' | 'week' | 'month' | 'all';
  byService: Record<string, ServiceUsage>;
  totalCost: number;
  totalRequests: number;
}

export interface ServiceUsage {
  requests: number;
  cost: number;
  avgDuration: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  remaining?: number;
}

export interface GatewayMetrics {
  uptime: number;
  totalRequests: number;
  totalRevenue: number;
  activeJobs: number;
  jobsByStatus: Record<string, number>;
  requestsByService: Record<string, number>;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<ComputeGatewayConfig> = {
  minBalance: 0.001,
  jobTimeout: 300000,
  maxConcurrent: 10,
  usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  treasuryWallet: process.env.CLODDS_TREASURY_WALLET || '',
  walletRateLimit: 60, // 60 requests per minute
  ipRateLimit: 100, // 100 requests per minute
  dbPath: '',
  supportedNetworks: ['base', 'ethereum', 'polygon'],
};

// RPC endpoints for payment verification
const RPC_ENDPOINTS: Record<string, string> = {
  base: 'https://mainnet.base.org',
  ethereum: 'https://eth.llamarpc.com',
  polygon: 'https://polygon-rpc.com',
};

// USDC addresses per network
const USDC_ADDRESSES: Record<string, string> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  polygon: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
};

// ERC20 Transfer event signature
const TRANSFER_EVENT_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createComputeGateway(
  config: ComputeGatewayConfig = {},
  pricing: Record<ComputeService, ComputePricing>
): ComputeGateway {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const events = new EventEmitter();
  const startTime = Date.now();

  // Initialize persistence
  const db = createPersistenceLayer(cfg.dbPath || undefined);

  // Service handlers
  const handlers = new Map<ComputeService, ServiceHandler>();

  // In-memory job tracking for active jobs
  const activeJobs = new Map<string, { wallet: string; startedAt: number }>();

  // Metrics
  let totalRequests = 0;
  let totalRevenue = 0;
  const requestsByService: Record<string, number> = {};
  const jobsByStatus: Record<string, number> = { pending: 0, processing: 0, completed: 0, failed: 0 };

  function generateJobId(): string {
    return `job_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }

  function registerHandler(service: ComputeService, handler: ServiceHandler): void {
    handlers.set(service, handler);
    logger.info({ service }, 'Service handler registered');
  }

  function getOrCreateBalance(wallet: string): WalletBalance {
    const row = db.getBalance(wallet);
    if (row) {
      return {
        wallet: row.wallet,
        available: row.available,
        pending: row.pending,
        totalDeposited: row.total_deposited,
        totalSpent: row.total_spent,
      };
    }
    return {
      wallet: wallet.toLowerCase(),
      available: 0,
      pending: 0,
      totalDeposited: 0,
      totalSpent: 0,
    };
  }

  function saveBalance(balance: WalletBalance): void {
    db.upsertBalance(
      balance.wallet,
      balance.available,
      balance.pending,
      balance.totalDeposited,
      balance.totalSpent
    );
  }

  function estimateCost(service: ComputeService, payload: unknown): number {
    const price = pricing[service];
    if (!price) return 0;

    let units = 1;

    if (service === 'llm') {
      const messages = (payload as { messages?: Array<{ content: string }> })?.messages || [];
      const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
      units = Math.ceil(totalChars / 4);
    } else if (service === 'code') {
      const timeout = (payload as { timeout?: number })?.timeout || 30000;
      units = Math.ceil(timeout / 1000);
    } else if (service === 'storage') {
      const content = (payload as { content?: string })?.content || '';
      units = Math.max(1, Math.ceil(content.length / 1024 / 1024));
    }

    const cost = price.basePrice + (units * price.pricePerUnit);
    return Math.min(Math.max(cost, price.minCharge), price.maxCharge);
  }

  async function verifyPayment(proof: PaymentProof): Promise<{ valid: boolean; amount: number; error?: string }> {
    if (!proof.txHash || !proof.network) {
      return { valid: false, amount: 0, error: 'Missing txHash or network' };
    }

    // Check supported network
    if (!cfg.supportedNetworks.includes(proof.network)) {
      return { valid: false, amount: 0, error: `Unsupported network: ${proof.network}` };
    }

    // Check for replay attack
    if (db.isTransactionUsed(proof.txHash)) {
      return { valid: false, amount: 0, error: 'Transaction already used' };
    }

    const rpcUrl = RPC_ENDPOINTS[proof.network];
    const usdcAddress = USDC_ADDRESSES[proof.network];

    if (!rpcUrl || !usdcAddress) {
      return { valid: false, amount: 0, error: `Network ${proof.network} not configured` };
    }

    try {
      // Get transaction receipt
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getTransactionReceipt',
          params: [proof.txHash],
          id: 1,
        }),
      });

      const data = await response.json() as {
        result?: {
          status: string;
          logs: Array<{
            address: string;
            topics: string[];
            data: string;
          }>;
        };
      };

      if (!data.result) {
        return { valid: false, amount: 0, error: 'Transaction not found' };
      }

      // Check success status
      if (data.result.status !== '0x1') {
        return { valid: false, amount: 0, error: 'Transaction failed' };
      }

      // Find USDC Transfer event to our treasury
      const treasury = cfg.treasuryWallet.toLowerCase();
      let transferAmount = 0;

      for (const log of data.result.logs) {
        // Check if it's USDC contract
        if (log.address.toLowerCase() !== usdcAddress.toLowerCase()) continue;

        // Check if it's Transfer event
        if (log.topics[0] !== TRANSFER_EVENT_SIG) continue;

        // topics[2] is the 'to' address (padded to 32 bytes)
        const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();

        if (toAddress === treasury) {
          // Decode amount from data (USDC has 6 decimals)
          const amountHex = log.data;
          const amountRaw = BigInt(amountHex);
          transferAmount = Number(amountRaw) / 1e6;
          break;
        }
      }

      if (transferAmount === 0) {
        return { valid: false, amount: 0, error: 'No transfer to treasury found' };
      }

      // Verify amount matches (with 1% tolerance for gas)
      if (Math.abs(transferAmount - proof.amountUsd) / proof.amountUsd > 0.01) {
        return { valid: false, amount: transferAmount, error: `Amount mismatch: expected ${proof.amountUsd}, got ${transferAmount}` };
      }

      return { valid: true, amount: transferAmount };
    } catch (error) {
      logger.error({ error, txHash: proof.txHash }, 'Payment verification failed');
      return { valid: false, amount: 0, error: 'Verification failed' };
    }
  }

  function checkRateLimit(wallet: string, ip: string): RateLimitResult {
    const windowMs = 60000; // 1 minute

    const walletCount = db.getRequestCount(wallet, windowMs);
    if (walletCount >= cfg.walletRateLimit) {
      return {
        allowed: false,
        retryAfter: 60,
        remaining: 0,
      };
    }

    const ipCount = db.getIpRequestCount(ip, windowMs);
    if (ipCount >= cfg.ipRateLimit) {
      return {
        allowed: false,
        retryAfter: 60,
        remaining: 0,
      };
    }

    db.recordRequest(wallet, ip);

    return {
      allowed: true,
      remaining: Math.min(cfg.walletRateLimit - walletCount - 1, cfg.ipRateLimit - ipCount - 1),
    };
  }

  async function submit(request: ComputeRequest): Promise<ComputeResponse> {
    const jobId = generateJobId();
    const startTime = Date.now();
    totalRequests++;
    requestsByService[request.service] = (requestsByService[request.service] || 0) + 1;

    try {
      // Validate service
      if (!pricing[request.service]) {
        return {
          id: request.id,
          jobId,
          service: request.service,
          status: 'failed',
          error: `Unknown service: ${request.service}`,
          cost: 0,
          timestamp: startTime,
        };
      }

      // Check handler exists
      if (!handlers.has(request.service)) {
        return {
          id: request.id,
          jobId,
          service: request.service,
          status: 'failed',
          error: `Service ${request.service} not available`,
          cost: 0,
          timestamp: startTime,
        };
      }

      // Check balance
      const balance = getOrCreateBalance(request.wallet);
      const estimatedCost = estimateCost(request.service, request.payload);

      if (balance.available < estimatedCost) {
        // Check for payment proof
        if (request.paymentProof) {
          const verification = await verifyPayment(request.paymentProof);
          if (verification.valid) {
            // Mark transaction as used
            db.markTransactionUsed(
              request.paymentProof.txHash,
              request.wallet,
              verification.amount
            );
            balance.available += verification.amount;
            balance.totalDeposited += verification.amount;
            saveBalance(balance);
          } else {
            return {
              id: request.id,
              jobId,
              service: request.service,
              status: 'failed',
              error: verification.error || 'Invalid payment proof',
              cost: 0,
              timestamp: startTime,
            };
          }
        }

        // Re-check after payment
        if (balance.available < estimatedCost) {
          return {
            id: request.id,
            jobId,
            service: request.service,
            status: 'failed',
            error: `Insufficient balance. Need $${estimatedCost.toFixed(4)}, have $${balance.available.toFixed(4)}`,
            cost: 0,
            timestamp: startTime,
          };
        }
      }

      // Reserve balance
      balance.available -= estimatedCost;
      balance.pending += estimatedCost;
      saveBalance(balance);

      // Create job in database
      db.createJob({
        job_id: jobId,
        request_id: request.id,
        wallet: request.wallet,
        service: request.service,
        status: 'pending',
        payload: JSON.stringify(request.payload),
        result: null,
        error: null,
        cost: estimatedCost,
        usage: null,
        created_at: startTime,
        started_at: null,
        completed_at: null,
      });

      jobsByStatus.pending++;

      logger.info({
        jobId,
        service: request.service,
        wallet: request.wallet,
        estimatedCost,
      }, 'Compute job created');

      // Execute async
      executeJob(jobId, request, estimatedCost).catch(error => {
        logger.error({ error, jobId }, 'Job execution failed');
      });

      return {
        id: request.id,
        jobId,
        service: request.service,
        status: 'pending',
        cost: estimatedCost,
        timestamp: startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        id: request.id,
        jobId,
        service: request.service,
        status: 'failed',
        error: errorMsg,
        cost: 0,
        timestamp: startTime,
      };
    }
  }

  async function executeJob(jobId: string, request: ComputeRequest, estimatedCost: number): Promise<void> {
    const startedAt = Date.now();

    // Update status to processing
    db.updateJob(jobId, { status: 'processing', started_at: startedAt });
    jobsByStatus.pending--;
    jobsByStatus.processing++;

    activeJobs.set(jobId, { wallet: request.wallet, startedAt });
    events.emit('job:started', { jobId, service: request.service });

    try {
      const handler = handlers.get(request.service);
      if (!handler) {
        throw new Error(`No handler for service: ${request.service}`);
      }

      // Execute with timeout
      const result = await Promise.race([
        handler(request),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Job timeout')), cfg.jobTimeout)
        ),
      ]);

      const completedAt = Date.now();
      const durationMs = completedAt - startedAt;

      // Calculate actual usage
      const usage = calculateUsage(request.service, durationMs, request.payload);

      // Update balance
      const balance = getOrCreateBalance(request.wallet);
      const actualCost = usage.breakdown.total;
      const refund = estimatedCost - actualCost;

      balance.pending -= estimatedCost;
      balance.available += refund;
      balance.totalSpent += actualCost;
      saveBalance(balance);

      // Update job
      db.updateJob(jobId, {
        status: 'completed',
        result: JSON.stringify(result),
        cost: actualCost,
        usage: JSON.stringify(usage),
        completed_at: completedAt,
      });

      // Record usage stats
      db.recordUsage(request.wallet, request.service, actualCost, durationMs);

      jobsByStatus.processing--;
      jobsByStatus.completed++;
      totalRevenue += actualCost;

      activeJobs.delete(jobId);
      events.emit('job:completed', { jobId, service: request.service, cost: actualCost });

      // Send callback if configured
      if (request.callbackUrl) {
        sendCallback(request.callbackUrl, {
          id: request.id,
          jobId,
          service: request.service,
          status: 'completed',
          result,
          cost: actualCost,
          usage,
          timestamp: completedAt,
        }).catch(err => {
          logger.error({ err, jobId }, 'Callback failed');
        });
      }

      logger.info({
        jobId,
        service: request.service,
        cost: actualCost,
        durationMs,
      }, 'Job completed');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const completedAt = Date.now();

      // Refund on failure
      const balance = getOrCreateBalance(request.wallet);
      balance.pending -= estimatedCost;
      balance.available += estimatedCost;
      saveBalance(balance);

      db.updateJob(jobId, {
        status: 'failed',
        error: errorMsg,
        cost: 0,
        completed_at: completedAt,
      });

      jobsByStatus.processing--;
      jobsByStatus.failed++;

      activeJobs.delete(jobId);
      events.emit('job:failed', { jobId, error: errorMsg });

      logger.error({ jobId, error: errorMsg }, 'Job failed');
    }
  }

  function calculateUsage(service: ComputeService, durationMs: number, payload: unknown): ComputeUsage {
    const price = pricing[service];
    let units: number;

    switch (service) {
      case 'llm': {
        // Would get actual tokens from result, estimate for now
        const messages = (payload as { messages?: Array<{ content: string }> })?.messages || [];
        const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
        units = Math.ceil(totalChars / 4);
        break;
      }
      case 'code':
        units = Math.ceil(durationMs / 1000);
        break;
      case 'storage': {
        const content = (payload as { content?: string })?.content || '';
        units = Math.max(1, Math.ceil(content.length / 1024 / 1024));
        break;
      }
      default:
        units = 1;
    }

    const baseCost = price.basePrice;
    const usageCost = units * price.pricePerUnit;
    const total = Math.min(Math.max(baseCost + usageCost, price.minCharge), price.maxCharge);

    return {
      units,
      unitType: price.unit,
      durationMs,
      breakdown: {
        base: baseCost,
        usage: usageCost,
        total,
      },
    };
  }

  async function sendCallback(url: string, data: ComputeResponse): Promise<void> {
    const secret = process.env.CLODDS_WEBHOOK_SECRET || 'default-secret';
    const signature = createHmac('sha256', secret)
      .update(JSON.stringify(data))
      .digest('hex');

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clodds-Signature': signature,
        'X-Clodds-Timestamp': Date.now().toString(),
      },
      body: JSON.stringify(data),
    });
  }

  async function getJob(jobId: string, wallet?: string): Promise<ComputeResponse | null> {
    const row = db.getJob(jobId);
    if (!row) return null;

    // Verify ownership if wallet provided
    if (wallet && row.wallet.toLowerCase() !== wallet.toLowerCase()) {
      return null; // Don't reveal job exists to non-owner
    }

    return {
      id: row.request_id,
      jobId: row.job_id,
      service: row.service as ComputeService,
      status: row.status as 'pending' | 'processing' | 'completed' | 'failed',
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error || undefined,
      cost: row.cost,
      usage: row.usage ? JSON.parse(row.usage) : undefined,
      timestamp: row.completed_at || row.started_at || row.created_at,
    };
  }

  async function getJobsByWallet(wallet: string, limit: number = 50): Promise<ComputeResponse[]> {
    const rows = db.getJobsByWallet(wallet, limit);
    return rows.map(row => ({
      id: row.request_id,
      jobId: row.job_id,
      service: row.service as ComputeService,
      status: row.status as 'pending' | 'processing' | 'completed' | 'failed',
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error || undefined,
      cost: row.cost,
      usage: row.usage ? JSON.parse(row.usage) : undefined,
      timestamp: row.completed_at || row.started_at || row.created_at,
    }));
  }

  async function cancelJob(jobId: string, wallet: string): Promise<boolean> {
    const row = db.getJob(jobId);
    if (!row) return false;

    // Verify ownership
    if (row.wallet.toLowerCase() !== wallet.toLowerCase()) {
      return false;
    }

    // Can only cancel pending jobs
    if (row.status !== 'pending') {
      return false;
    }

    // Refund
    const balance = getOrCreateBalance(wallet);
    balance.pending -= row.cost;
    balance.available += row.cost;
    saveBalance(balance);

    db.updateJob(jobId, {
      status: 'failed',
      error: 'Cancelled by user',
      cost: 0,
      completed_at: Date.now(),
    });

    jobsByStatus.pending--;
    jobsByStatus.failed++;

    events.emit('job:cancelled', { jobId });
    return true;
  }

  function getPricing(service: ComputeService): ComputePricing {
    return pricing[service];
  }

  async function getBalance(wallet: string): Promise<WalletBalance> {
    return getOrCreateBalance(wallet);
  }

  async function depositCredits(wallet: string, proof: PaymentProof): Promise<DepositResult> {
    const verification = await verifyPayment(proof);

    if (!verification.valid) {
      return {
        success: false,
        credits: 0,
        txHash: proof.txHash,
        error: verification.error,
      };
    }

    // Mark as used
    db.markTransactionUsed(proof.txHash, wallet, verification.amount);

    // Update balance
    const balance = getOrCreateBalance(wallet);
    balance.available += verification.amount;
    balance.totalDeposited += verification.amount;
    saveBalance(balance);

    logger.info({
      wallet,
      amount: verification.amount,
      txHash: proof.txHash,
    }, 'Credits deposited');

    return {
      success: true,
      credits: verification.amount,
      txHash: proof.txHash,
    };
  }

  async function getUsage(wallet: string, period: 'day' | 'week' | 'month' | 'all' = 'all'): Promise<UsageStats> {
    const rows = db.getUsage(wallet, period);

    const byService: Record<string, ServiceUsage> = {};
    let totalCost = 0;
    let totalRequests = 0;

    for (const row of rows) {
      byService[row.service] = {
        requests: row.requests,
        cost: row.total_cost,
        avgDuration: row.total_duration_ms / row.requests,
      };
      totalCost += row.total_cost;
      totalRequests += row.requests;
    }

    return {
      wallet,
      period,
      byService,
      totalCost,
      totalRequests,
    };
  }

  function getMetrics(): GatewayMetrics {
    return {
      uptime: Date.now() - startTime,
      totalRequests,
      totalRevenue,
      activeJobs: activeJobs.size,
      jobsByStatus: { ...jobsByStatus },
      requestsByService: { ...requestsByService },
    };
  }

  function shutdown(): void {
    db.close();
  }

  // Cleanup old jobs periodically (keep 7 days)
  setInterval(() => {
    const cleaned = db.cleanupOldJobs(7 * 24 * 60 * 60 * 1000);
    if (cleaned > 0) {
      logger.info({ count: cleaned }, 'Cleaned up old jobs');
    }
  }, 3600000); // Every hour

  return {
    submit,
    getJob,
    getJobsByWallet,
    cancelJob,
    getPricing,
    getBalance,
    depositCredits,
    getUsage,
    registerHandler,
    checkRateLimit,
    getMetrics,
    events,
    shutdown,
  };
}
