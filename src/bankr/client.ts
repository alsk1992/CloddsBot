/**
 * Bankr API Client
 *
 * AI-powered crypto trading via natural language.
 * Supports Base, Ethereum, Polygon, Solana, Unichain.
 *
 * API Reference: https://www.notion.so/Agent-API-2e18e0f9661f80cb83ccfc046f8872e3
 */

import { logger } from '../utils/logger';

// =============================================================================
// Types
// =============================================================================

export interface BankrConfig {
  apiKey: string;
  apiUrl?: string;
  /** Polling interval in ms (default: 2000) */
  pollInterval?: number;
  /** Max polling time in ms (default: 300000 = 5 min) */
  maxPollTime?: number;
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface StatusUpdate {
  message: string;
  timestamp: string;
}

export interface RichData {
  type?: string;
  [key: string]: unknown;
}

export interface JobResult {
  success: boolean;
  jobId: string;
  status: JobStatus;
  prompt: string;
  response?: string;
  richData?: RichData[];
  statusUpdates?: StatusUpdate[];
  error?: string;
  createdAt: string;
  completedAt?: string;
  cancelledAt?: string;
  startedAt?: string;
  processingTime?: number;
  cancellable?: boolean;
}

export interface SubmitResponse {
  success: boolean;
  jobId: string;
  status: JobStatus;
  message: string;
}

// =============================================================================
// Client Implementation
// =============================================================================

export class BankrClient {
  private apiKey: string;
  private apiUrl: string;
  private pollInterval: number;
  private maxPollTime: number;

  constructor(config: BankrConfig) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl || 'https://api.bankr.bot';
    this.pollInterval = config.pollInterval || 2000;
    this.maxPollTime = config.maxPollTime || 300000;
  }

  /**
   * Submit a prompt and wait for completion
   */
  async execute(
    prompt: string,
    options?: {
      onStatusUpdate?: (update: StatusUpdate) => void;
      timeout?: number;
    }
  ): Promise<JobResult> {
    const { jobId } = await this.submitJob(prompt);
    return this.waitForCompletion(jobId, {
      onStatusUpdate: options?.onStatusUpdate,
      timeout: options?.timeout,
    });
  }

  /**
   * Submit a prompt and get job ID (non-blocking)
   */
  async submitJob(prompt: string): Promise<SubmitResponse> {
    if (prompt.length > 10000) {
      throw new Error('Prompt too long (max 10,000 characters)');
    }

    const response = await fetch(`${this.apiUrl}/agent/prompt`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });

    if (response.status === 401) {
      throw new Error('Authentication failed - check your BANKR_API_KEY');
    }
    if (response.status === 403) {
      throw new Error('Agent API access not enabled - enable at bankr.bot/api');
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || `Bankr API error: ${response.status}`);
    }

    return response.json() as Promise<SubmitResponse>;
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<JobResult> {
    const response = await fetch(`${this.apiUrl}/agent/job/${jobId}`, {
      headers: {
        'X-API-Key': this.apiKey,
      },
    });

    if (response.status === 404) {
      throw new Error(`Job not found: ${jobId}`);
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || `Failed to get job status: ${response.status}`);
    }

    return response.json() as Promise<JobResult>;
  }

  /**
   * Cancel a pending/processing job
   */
  async cancelJob(jobId: string): Promise<JobResult> {
    const response = await fetch(`${this.apiUrl}/agent/job/${jobId}/cancel`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 400) {
      const err = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || 'Cannot cancel job (may be completed/failed)');
    }
    if (response.status === 404) {
      throw new Error(`Job not found: ${jobId}`);
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || `Failed to cancel job: ${response.status}`);
    }

    return response.json() as Promise<JobResult>;
  }

  /**
   * Poll until job completes
   */
  async waitForCompletion(
    jobId: string,
    options?: {
      onStatusUpdate?: (update: StatusUpdate) => void;
      timeout?: number;
    }
  ): Promise<JobResult> {
    const timeout = options?.timeout || this.maxPollTime;
    const startTime = Date.now();
    let lastUpdateCount = 0;

    while (Date.now() - startTime < timeout) {
      const result = await this.getJobStatus(jobId);

      // Emit new status updates
      if (options?.onStatusUpdate && result.statusUpdates) {
        const newUpdates = result.statusUpdates.slice(lastUpdateCount);
        for (const update of newUpdates) {
          options.onStatusUpdate(update);
        }
        lastUpdateCount = result.statusUpdates.length;
      }

      // Check terminal states
      if (result.status === 'completed' || result.status === 'failed' || result.status === 'cancelled') {
        return result;
      }

      await this.sleep(this.pollInterval);
    }

    // Timeout - try to cancel
    logger.warn({ jobId }, 'Bankr job timed out, attempting cancel');
    try {
      await this.cancelJob(jobId);
    } catch {
      // Ignore cancel errors
    }
    throw new Error(`Job timed out after ${timeout / 1000}s`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Factory
// =============================================================================

let defaultClient: BankrClient | null = null;

export function getBankrClient(config?: BankrConfig): BankrClient {
  if (config) {
    return new BankrClient(config);
  }

  if (!defaultClient) {
    const apiKey = process.env.BANKR_API_KEY;
    if (!apiKey) {
      throw new Error('BANKR_API_KEY environment variable not set');
    }
    defaultClient = new BankrClient({
      apiKey,
      apiUrl: process.env.BANKR_API_URL,
    });
  }

  return defaultClient;
}

/**
 * Quick execute helper
 */
export async function bankrExecute(prompt: string): Promise<string> {
  const client = getBankrClient();
  const result = await client.execute(prompt);

  if (result.status === 'failed') {
    throw new Error(result.error || 'Bankr job failed');
  }

  return result.response || '';
}
