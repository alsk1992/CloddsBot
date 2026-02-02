/**
 * Compute Gateway - Main entry point for agent compute marketplace
 *
 * Agents pay USDC for compute resources. No API keys needed - just a wallet.
 */

import { randomBytes } from 'crypto';
import { EventEmitter } from 'eventemitter3';
import { logger } from '../../utils/logger';
import type {
  ComputeService,
  ComputeRequest,
  ComputeResponse,
  ComputeUsage,
  ComputePricing,
  PaymentProof,
  COMPUTE_PRICING,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface ComputeGateway {
  /** Submit a compute request */
  submit(request: ComputeRequest): Promise<ComputeResponse>;
  /** Get job status */
  getJob(jobId: string): Promise<ComputeResponse | null>;
  /** Cancel a job */
  cancelJob(jobId: string, wallet: string): Promise<boolean>;
  /** Get pricing for a service */
  getPricing(service: ComputeService): ComputePricing;
  /** Get wallet balance/credits */
  getBalance(wallet: string): Promise<WalletBalance>;
  /** Deposit credits */
  depositCredits(wallet: string, proof: PaymentProof): Promise<DepositResult>;
  /** Get usage stats */
  getUsage(wallet: string): Promise<UsageStats>;
  /** Event emitter for job updates */
  events: EventEmitter;
}

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
}

export interface WalletBalance {
  wallet: string;
  /** Available credits in USD */
  available: number;
  /** Pending (in-flight jobs) */
  pending: number;
  /** Total deposited */
  totalDeposited: number;
  /** Total spent */
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
  /** Usage by service */
  byService: Record<ComputeService, ServiceUsage>;
  /** Total cost */
  totalCost: number;
  /** Total requests */
  totalRequests: number;
}

export interface ServiceUsage {
  requests: number;
  cost: number;
  avgDuration: number;
  lastUsed: number;
}

interface ComputeJob {
  id: string;
  request: ComputeRequest;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  cost: number;
  usage?: ComputeUsage;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<ComputeGatewayConfig> = {
  minBalance: 0.001,
  jobTimeout: 300000,
  maxConcurrent: 10,
  usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  treasuryWallet: process.env.CLODDS_TREASURY_WALLET || '', // Set via env var
};

// Base RPC for payment verification
const BASE_RPC = 'https://mainnet.base.org';

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createComputeGateway(
  config: ComputeGatewayConfig = {},
  pricing: Record<ComputeService, ComputePricing>
): ComputeGateway {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const events = new EventEmitter();

  // In-memory storage (replace with DB in production)
  const jobs = new Map<string, ComputeJob>();
  const balances = new Map<string, WalletBalance>();
  const usage = new Map<string, UsageStats>();

  // Service handlers
  const handlers = new Map<ComputeService, (req: ComputeRequest) => Promise<unknown>>();

  function generateJobId(): string {
    return `job_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }

  function getOrCreateBalance(wallet: string): WalletBalance {
    let balance = balances.get(wallet.toLowerCase());
    if (!balance) {
      balance = {
        wallet: wallet.toLowerCase(),
        available: 0,
        pending: 0,
        totalDeposited: 0,
        totalSpent: 0,
      };
      balances.set(wallet.toLowerCase(), balance);
    }
    return balance;
  }

  function estimateCost(service: ComputeService, payload: unknown): number {
    const price = pricing[service];
    if (!price) return 0;

    // Estimate based on payload size/complexity
    let units = 1;

    if (service === 'llm') {
      // Estimate tokens from message length
      const messages = (payload as { messages?: Array<{ content: string }> })?.messages || [];
      const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
      units = Math.ceil(totalChars / 4); // ~4 chars per token
    } else if (service === 'code') {
      // Estimate execution time
      units = 10; // Assume 10 seconds
    } else if (service === 'storage') {
      // Estimate MB
      const content = (payload as { content?: string })?.content || '';
      units = Math.max(1, Math.ceil(content.length / 1024 / 1024));
    }

    const cost = price.basePrice + (units * price.pricePerUnit);
    return Math.min(Math.max(cost, price.minCharge), price.maxCharge);
  }

  async function verifyPayment(proof: PaymentProof): Promise<boolean> {
    if (!proof.txHash || !proof.network) return false;

    // Only verify Base transactions for now
    if (proof.network !== 'base') {
      logger.warn({ network: proof.network }, 'Unsupported payment network');
      return false;
    }

    try {
      const response = await fetch(BASE_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getTransactionReceipt',
          params: [proof.txHash],
          id: 1,
        }),
      });

      const data = await response.json() as { result?: { status: string; to: string } };
      if (!data.result) return false;

      // Check success status
      if (data.result.status !== '0x1') return false;

      // Verify it's a USDC transfer to our treasury
      const to = data.result.to?.toLowerCase();
      if (to !== cfg.usdcAddress.toLowerCase()) return false;

      return true;
    } catch (error) {
      logger.error({ error, txHash: proof.txHash }, 'Payment verification failed');
      return false;
    }
  }

  async function submit(request: ComputeRequest): Promise<ComputeResponse> {
    const jobId = generateJobId();
    const startTime = Date.now();

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

      // Check balance
      const balance = getOrCreateBalance(request.wallet);
      const estimatedCost = estimateCost(request.service, request.payload);

      if (balance.available < estimatedCost) {
        // Check for payment proof
        if (request.paymentProof) {
          const valid = await verifyPayment(request.paymentProof);
          if (valid) {
            balance.available += request.paymentProof.amountUsd;
            balance.totalDeposited += request.paymentProof.amountUsd;
          } else {
            return {
              id: request.id,
              jobId,
              service: request.service,
              status: 'failed',
              error: 'Invalid payment proof',
              cost: 0,
              timestamp: startTime,
            };
          }
        } else {
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

      // Create job
      const job: ComputeJob = {
        id: jobId,
        request,
        status: 'pending',
        cost: estimatedCost,
        createdAt: startTime,
      };
      jobs.set(jobId, job);

      logger.info({
        jobId,
        service: request.service,
        wallet: request.wallet,
        estimatedCost,
      }, 'Compute job created');

      // Execute async
      executeJob(job).catch(error => {
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

  async function executeJob(job: ComputeJob): Promise<void> {
    job.status = 'processing';
    job.startedAt = Date.now();
    events.emit('job:started', job);

    try {
      // Get handler for service
      const handler = handlers.get(job.request.service);
      if (!handler) {
        throw new Error(`No handler registered for service: ${job.request.service}`);
      }

      // Execute with timeout
      const result = await Promise.race([
        handler(job.request),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Job timeout')), cfg.jobTimeout)
        ),
      ]);

      const completedAt = Date.now();
      const durationMs = completedAt - (job.startedAt || job.createdAt);

      // Calculate actual usage
      job.usage = calculateUsage(job.request.service, job.cost, durationMs);
      job.result = result;
      job.status = 'completed';
      job.completedAt = completedAt;

      // Update balance
      const balance = getOrCreateBalance(job.request.wallet);
      const actualCost = job.usage.breakdown.total;
      const refund = job.cost - actualCost;

      balance.pending -= job.cost;
      balance.available += refund;
      balance.totalSpent += actualCost;
      job.cost = actualCost;

      // Update usage stats
      updateUsage(job.request.wallet, job.request.service, actualCost, durationMs);

      events.emit('job:completed', job);

      // Send callback if configured
      if (job.request.callbackUrl) {
        sendCallback(job).catch(err => {
          logger.error({ err, jobId: job.id }, 'Callback failed');
        });
      }

      logger.info({
        jobId: job.id,
        service: job.request.service,
        cost: actualCost,
        durationMs,
      }, 'Job completed');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      job.status = 'failed';
      job.error = errorMsg;
      job.completedAt = Date.now();

      // Refund on failure
      const balance = getOrCreateBalance(job.request.wallet);
      balance.pending -= job.cost;
      balance.available += job.cost;
      job.cost = 0;

      events.emit('job:failed', job);
      logger.error({ jobId: job.id, error: errorMsg }, 'Job failed');
    }
  }

  function calculateUsage(
    service: ComputeService,
    estimatedCost: number,
    durationMs: number
  ): ComputeUsage {
    const price = pricing[service];
    const units = Math.ceil(durationMs / 1000); // Simplified

    return {
      units,
      unitType: price.unit,
      durationMs,
      breakdown: {
        base: price.basePrice,
        usage: units * price.pricePerUnit,
        total: Math.min(
          Math.max(price.basePrice + units * price.pricePerUnit, price.minCharge),
          price.maxCharge
        ),
      },
    };
  }

  function updateUsage(
    wallet: string,
    service: ComputeService,
    cost: number,
    durationMs: number
  ): void {
    const key = wallet.toLowerCase();
    let stats = usage.get(key);

    if (!stats) {
      stats = {
        wallet: key,
        period: 'all',
        byService: {} as Record<ComputeService, ServiceUsage>,
        totalCost: 0,
        totalRequests: 0,
      };
      usage.set(key, stats);
    }

    if (!stats.byService[service]) {
      stats.byService[service] = {
        requests: 0,
        cost: 0,
        avgDuration: 0,
        lastUsed: 0,
      };
    }

    const svc = stats.byService[service];
    svc.avgDuration = (svc.avgDuration * svc.requests + durationMs) / (svc.requests + 1);
    svc.requests++;
    svc.cost += cost;
    svc.lastUsed = Date.now();

    stats.totalCost += cost;
    stats.totalRequests++;
  }

  async function sendCallback(job: ComputeJob): Promise<void> {
    if (!job.request.callbackUrl) return;

    const response: ComputeResponse = {
      id: job.request.id,
      jobId: job.id,
      service: job.request.service,
      status: job.status,
      result: job.result,
      error: job.error,
      cost: job.cost,
      usage: job.usage,
      timestamp: job.completedAt || Date.now(),
    };

    await fetch(job.request.callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clodds-Signature': signCallback(response),
      },
      body: JSON.stringify(response),
    });
  }

  function signCallback(data: unknown): string {
    // HMAC signature for webhook verification
    const { createHmac } = require('crypto');
    const secret = process.env.CLODDS_WEBHOOK_SECRET || 'dev-secret';
    return createHmac('sha256', secret)
      .update(JSON.stringify(data))
      .digest('hex');
  }

  async function getJob(jobId: string): Promise<ComputeResponse | null> {
    const job = jobs.get(jobId);
    if (!job) return null;

    return {
      id: job.request.id,
      jobId: job.id,
      service: job.request.service,
      status: job.status,
      result: job.result,
      error: job.error,
      cost: job.cost,
      usage: job.usage,
      timestamp: job.completedAt || job.startedAt || job.createdAt,
    };
  }

  async function cancelJob(jobId: string, wallet: string): Promise<boolean> {
    const job = jobs.get(jobId);
    if (!job) return false;

    // Verify ownership
    if (job.request.wallet.toLowerCase() !== wallet.toLowerCase()) {
      return false;
    }

    // Can only cancel pending jobs
    if (job.status !== 'pending') {
      return false;
    }

    job.status = 'failed';
    job.error = 'Cancelled by user';
    job.completedAt = Date.now();

    // Refund
    const balance = getOrCreateBalance(wallet);
    balance.pending -= job.cost;
    balance.available += job.cost;
    job.cost = 0;

    events.emit('job:cancelled', job);
    return true;
  }

  function getPricing(service: ComputeService): ComputePricing {
    return pricing[service];
  }

  async function getBalance(wallet: string): Promise<WalletBalance> {
    return getOrCreateBalance(wallet);
  }

  async function depositCredits(
    wallet: string,
    proof: PaymentProof
  ): Promise<DepositResult> {
    const valid = await verifyPayment(proof);

    if (!valid) {
      return {
        success: false,
        credits: 0,
        txHash: proof.txHash,
        error: 'Invalid payment proof',
      };
    }

    const balance = getOrCreateBalance(wallet);
    balance.available += proof.amountUsd;
    balance.totalDeposited += proof.amountUsd;

    logger.info({
      wallet,
      amount: proof.amountUsd,
      txHash: proof.txHash,
    }, 'Credits deposited');

    return {
      success: true,
      credits: proof.amountUsd,
      txHash: proof.txHash,
    };
  }

  async function getUsage(wallet: string): Promise<UsageStats> {
    const key = wallet.toLowerCase();
    return usage.get(key) || {
      wallet: key,
      period: 'all',
      byService: {} as Record<ComputeService, ServiceUsage>,
      totalCost: 0,
      totalRequests: 0,
    };
  }

  // Method to register service handlers
  (submit as unknown as { registerHandler: (s: ComputeService, h: (r: ComputeRequest) => Promise<unknown>) => void }).registerHandler = (
    service: ComputeService,
    handler: (req: ComputeRequest) => Promise<unknown>
  ) => {
    handlers.set(service, handler);
  };

  return {
    submit,
    getJob,
    cancelJob,
    getPricing,
    getBalance,
    depositCredits,
    getUsage,
    events,
  };
}
