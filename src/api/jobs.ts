/**
 * Job Manager - Async job queue for prompt execution
 *
 * Features:
 * - In-memory queue with optional persistence
 * - Concurrency control
 * - Timeout handling
 * - Retry logic
 * - Webhook callbacks
 */

import { EventEmitter } from 'eventemitter3';
import { randomBytes, createHash, createHmac } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';
import type {
  JobQueueConfig,
  JobData,
  JobStatusType,
  ApiRequest,
  PromptResultData,
  PricingTier,
  WebhookPayload,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface JobManager extends EventEmitter {
  /** Create a new job */
  create(request: ApiRequest, tier: PricingTier, cost: number): Job;
  /** Get job by ID */
  get(id: string): Job | null;
  /** Get all jobs for a wallet */
  getByWallet(wallet: string, limit?: number): Job[];
  /** Cancel a job */
  cancel(id: string): boolean;
  /** Process next job in queue */
  processNext(): Promise<void>;
  /** Start job processing */
  start(): void;
  /** Stop job processing */
  stop(): void;
  /** Get queue statistics */
  getStats(): JobStats;
  /** Clean up old jobs */
  cleanup(): number;
}

export interface Job {
  /** Job ID */
  id: string;
  /** Get job data */
  getData(): JobData;
  /** Update status */
  setStatus(status: JobStatusType): void;
  /** Set result */
  setResult(result: PromptResultData): void;
  /** Set error */
  setError(error: string): void;
  /** Increment retry count */
  retry(): boolean;
  /** Save to disk */
  save(): void;
}

export interface JobStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
}

export type JobExecutor = (job: Job) => Promise<PromptResultData>;

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<JobQueueConfig> = {
  concurrency: 10,
  timeout: 120000,
  retention: 86400000, // 24 hours
  persist: true,
  storageDir: join(homedir(), '.clodds', 'api', 'jobs'),
};

const MAX_RETRIES = 3;

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createJobManager(
  config: JobQueueConfig = {},
  executor?: JobExecutor
): JobManager {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const emitter = new EventEmitter() as JobManager;

  // Job storage
  const jobs = new Map<string, JobData>();
  const queue: string[] = []; // Job IDs in order
  let processing = 0;
  let isRunning = false;
  let processInterval: NodeJS.Timeout | null = null;

  // Ensure storage directory exists
  if (cfg.persist) {
    mkdirSync(cfg.storageDir, { recursive: true });
    loadPersistedJobs();
  }

  function generateId(): string {
    return `job_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  }

  function loadPersistedJobs(): void {
    try {
      const files = readdirSync(cfg.storageDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(readFileSync(join(cfg.storageDir, file), 'utf-8')) as JobData;
          jobs.set(data.id, data);

          // Re-queue pending jobs
          if (data.status === 'pending' || data.status === 'processing') {
            data.status = 'pending';
            queue.push(data.id);
          }
        } catch (e) {
          logger.warn({ file }, 'Failed to load persisted job');
        }
      }
      logger.info({ count: jobs.size, queued: queue.length }, 'Loaded persisted jobs');
    } catch (e) {
      logger.debug('No persisted jobs found');
    }
  }

  function persistJob(data: JobData): void {
    if (!cfg.persist) return;
    try {
      const filePath = join(cfg.storageDir, `${data.id}.json`);
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
      logger.error({ jobId: data.id, error: e }, 'Failed to persist job');
    }
  }

  function deletePersistedJob(id: string): void {
    if (!cfg.persist) return;
    try {
      const filePath = join(cfg.storageDir, `${id}.json`);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (e) {
      logger.debug({ jobId: id }, 'Failed to delete persisted job');
    }
  }

  function createJobWrapper(data: JobData): Job {
    return {
      id: data.id,
      getData: () => ({ ...data }),
      setStatus: (status: JobStatusType) => {
        data.status = status;
        data.updatedAt = Date.now();
        if (status === 'processing') {
          data.startedAt = Date.now();
        } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          data.completedAt = Date.now();
        }
        persistJob(data);
        emitter.emit('job:status', { id: data.id, status });
      },
      setResult: (result: PromptResultData) => {
        data.result = result;
        data.status = 'completed';
        data.completedAt = Date.now();
        data.updatedAt = Date.now();
        persistJob(data);
        emitter.emit('job:completed', { id: data.id, result });
        sendWebhook(data);
      },
      setError: (error: string) => {
        data.error = error;
        data.status = 'failed';
        data.completedAt = Date.now();
        data.updatedAt = Date.now();
        persistJob(data);
        emitter.emit('job:failed', { id: data.id, error });
        sendWebhook(data);
      },
      retry: () => {
        if (data.retries >= MAX_RETRIES) {
          return false;
        }
        data.retries++;
        data.status = 'pending';
        data.updatedAt = Date.now();
        queue.push(data.id);
        persistJob(data);
        return true;
      },
      save: () => persistJob(data),
    };
  }

  async function sendWebhook(data: JobData): Promise<void> {
    const callbackUrl = data.request.callbackUrl;
    if (!callbackUrl) return;

    try {
      const timestamp = Date.now();
      const bodyStr = JSON.stringify({
        event: data.status === 'completed' ? 'job.completed' : data.status === 'failed' ? 'job.failed' : 'job.cancelled',
        job: data,
        timestamp,
      });

      // Create HMAC signature using job ID + wallet as secret
      // Client can verify: HMAC-SHA256(jobId + wallet, body) === X-Clodds-Signature
      const secret = `${data.id}:${data.request.wallet}`;
      const signature = createHmac('sha256', secret).update(bodyStr).digest('hex');

      const payload: WebhookPayload = {
        ...JSON.parse(bodyStr),
        signature,
      };

      await fetch(callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Clodds-Signature': signature,
          'X-Clodds-Timestamp': timestamp.toString(),
          'X-Clodds-Version': '1.0.0',
          'User-Agent': 'Clodds-Webhook/1.0',
        },
        body: JSON.stringify(payload),
      });

      logger.debug({ jobId: data.id, callbackUrl }, 'Webhook sent');
    } catch (e) {
      logger.warn({ jobId: data.id, callbackUrl, error: e }, 'Webhook delivery failed');
    }
  }

  function create(request: ApiRequest, tier: PricingTier, cost: number): Job {
    const id = generateId();
    const now = Date.now();

    const data: JobData = {
      id,
      request,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      retries: 0,
      cost,
      tier,
    };

    jobs.set(id, data);
    queue.push(id);
    persistJob(data);

    emitter.emit('job:created', { id, request });
    logger.info({ jobId: id, wallet: request.wallet, tier, cost }, 'Job created');

    // Trigger processing
    if (isRunning) {
      setImmediate(() => processNext());
    }

    return createJobWrapper(data);
  }

  function get(id: string): Job | null {
    const data = jobs.get(id);
    if (!data) return null;
    return createJobWrapper(data);
  }

  function getByWallet(wallet: string, limit = 10): Job[] {
    const results: Job[] = [];
    const walletLower = wallet.toLowerCase();

    for (const data of jobs.values()) {
      if (data.request.wallet.toLowerCase() === walletLower) {
        results.push(createJobWrapper(data));
        if (results.length >= limit) break;
      }
    }

    // Sort by created time descending
    return results.sort((a, b) => b.getData().createdAt - a.getData().createdAt);
  }

  function cancel(id: string): boolean {
    const data = jobs.get(id);
    if (!data) return false;

    if (data.status !== 'pending' && data.status !== 'processing') {
      return false;
    }

    data.status = 'cancelled';
    data.completedAt = Date.now();
    data.updatedAt = Date.now();
    persistJob(data);

    // Remove from queue
    const idx = queue.indexOf(id);
    if (idx !== -1) {
      queue.splice(idx, 1);
    }

    emitter.emit('job:cancelled', { id });
    sendWebhook(data);
    logger.info({ jobId: id }, 'Job cancelled');

    return true;
  }

  async function processNext(): Promise<void> {
    if (!isRunning) return;
    if (processing >= cfg.concurrency) return;
    if (queue.length === 0) return;

    const jobId = queue.shift();
    if (!jobId) return;

    const data = jobs.get(jobId);
    if (!data || data.status !== 'pending') {
      // Job was cancelled or already processed
      return processNext();
    }

    const job = createJobWrapper(data);
    processing++;

    try {
      job.setStatus('processing');
      logger.debug({ jobId }, 'Processing job');

      if (!executor) {
        throw new Error('No job executor configured');
      }

      // Execute with timeout
      const result = await Promise.race([
        executor(job),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Job timeout')), cfg.timeout)
        ),
      ]);

      job.setResult(result);
      logger.info({ jobId, executionTime: result.executionTime }, 'Job completed');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ jobId, error: errorMsg }, 'Job failed');

      // Retry logic
      if (job.retry()) {
        logger.info({ jobId, retries: data.retries }, 'Job queued for retry');
      } else {
        job.setError(errorMsg);
      }
    } finally {
      processing--;
      // Process next job
      setImmediate(() => processNext());
    }
  }

  function start(): void {
    if (isRunning) return;
    isRunning = true;

    // Process queue
    processNext();

    // Periodic queue check
    processInterval = setInterval(() => {
      if (queue.length > 0 && processing < cfg.concurrency) {
        processNext();
      }
    }, 1000);

    logger.info({ concurrency: cfg.concurrency }, 'Job manager started');
  }

  function stop(): void {
    isRunning = false;
    if (processInterval) {
      clearInterval(processInterval);
      processInterval = null;
    }
    logger.info('Job manager stopped');
  }

  function getStats(): JobStats {
    const stats: JobStats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      total: 0,
    };

    for (const data of jobs.values()) {
      stats.total++;
      stats[data.status]++;
    }

    return stats;
  }

  function cleanup(): number {
    const cutoff = Date.now() - cfg.retention;
    let removed = 0;

    for (const [id, data] of jobs) {
      if (data.completedAt && data.completedAt < cutoff) {
        jobs.delete(id);
        deletePersistedJob(id);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info({ removed }, 'Cleaned up old jobs');
    }

    return removed;
  }

  // Periodic cleanup
  setInterval(cleanup, 3600000); // Every hour

  // Attach methods to emitter
  Object.assign(emitter, {
    create,
    get,
    getByWallet,
    cancel,
    processNext,
    start,
    stop,
    getStats,
    cleanup,
  });

  return emitter;
}

export type { JobData, JobStatusType };
