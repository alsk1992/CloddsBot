/**
 * Production-Grade Base Channel Adapter
 * Provides robust infrastructure for all channel implementations
 *
 * Features:
 * - Rate limiting with token bucket
 * - Circuit breaker pattern
 * - Health checks and heartbeat
 * - Metrics collection hooks
 * - Graceful shutdown
 * - Error categorization and handling
 * - Automatic reconnection with exponential backoff
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import type { ChannelAdapter, ChannelCallbacks, DraftStream } from './index';
import type { OutgoingMessage, IncomingMessage, ReactionMessage, PollMessage } from '../types';

export interface BaseAdapterConfig {
  platform: string;
  /** Rate limit: requests per second */
  rateLimit?: number;
  /** Rate limit burst size */
  rateLimitBurst?: number;
  /** Circuit breaker: failure threshold */
  circuitBreakerThreshold?: number;
  /** Circuit breaker: reset timeout in ms */
  circuitBreakerResetMs?: number;
  /** Health check interval in ms */
  healthCheckIntervalMs?: number;
  /** Max reconnection attempts */
  maxReconnectAttempts?: number;
  /** Initial reconnection delay in ms */
  initialReconnectDelayMs?: number;
  /** Max reconnection delay in ms */
  maxReconnectDelayMs?: number;
  /** Enable metrics collection */
  enableMetrics?: boolean;
}

export interface AdapterMetrics {
  messagesSent: number;
  messagesReceived: number;
  messagesFailed: number;
  reconnections: number;
  circuitBreakerTrips: number;
  rateLimitHits: number;
  lastError?: string;
  lastErrorTime?: number;
  uptime: number;
  connectionState: 'connected' | 'connecting' | 'disconnected' | 'circuit_open';
}

export interface AdapterHealth {
  healthy: boolean;
  status: string;
  lastCheck: number;
  metrics: AdapterMetrics;
}

type ErrorCategory = 'network' | 'auth' | 'rate_limit' | 'validation' | 'unknown';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number;
}

interface CircuitBreaker {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half_open';
  nextAttempt: number;
}

export abstract class BaseAdapter extends EventEmitter implements ChannelAdapter {
  platform: string;
  protected config: BaseAdapterConfig;
  protected callbacks: ChannelCallbacks;
  protected _connected: boolean = false;
  protected _starting: boolean = false;
  protected _stopping: boolean = false;
  protected startTime: number = 0;

  private tokenBucket: TokenBucket;
  private circuitBreaker: CircuitBreaker;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private metrics: AdapterMetrics;

  constructor(config: BaseAdapterConfig, callbacks: ChannelCallbacks) {
    super();
    this.platform = config.platform;
    this.config = {
      rateLimit: 30, // 30 messages per second
      rateLimitBurst: 10,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 30000,
      healthCheckIntervalMs: 30000,
      maxReconnectAttempts: 10,
      initialReconnectDelayMs: 1000,
      maxReconnectDelayMs: 60000,
      enableMetrics: true,
      ...config,
    };
    this.callbacks = callbacks;

    this.tokenBucket = {
      tokens: this.config.rateLimitBurst!,
      lastRefill: Date.now(),
      maxTokens: this.config.rateLimitBurst!,
      refillRate: this.config.rateLimit! / 1000, // tokens per ms
    };

    this.circuitBreaker = {
      failures: 0,
      lastFailure: 0,
      state: 'closed',
      nextAttempt: 0,
    };

    this.metrics = {
      messagesSent: 0,
      messagesReceived: 0,
      messagesFailed: 0,
      reconnections: 0,
      circuitBreakerTrips: 0,
      rateLimitHits: 0,
      uptime: 0,
      connectionState: 'disconnected',
    };
  }

  // Abstract methods to be implemented by subclasses
  protected abstract doStart(): Promise<void>;
  protected abstract doStop(): Promise<void>;
  protected abstract doSendMessage(message: OutgoingMessage): Promise<string | null>;
  protected abstract doHealthCheck(): Promise<boolean>;

  // Optional methods for subclasses
  protected doEditMessage?(message: OutgoingMessage & { messageId: string }): Promise<void>;
  protected doDeleteMessage?(message: OutgoingMessage & { messageId: string }): Promise<void>;
  protected doReactMessage?(message: ReactionMessage): Promise<void>;
  protected doSendPoll?(message: PollMessage): Promise<string | null>;
  protected doCreateDraftStream?(chatId: string): DraftStream;

  async start(): Promise<void> {
    if (this._connected || this._starting) {
      logger.warn({ platform: this.platform }, 'Adapter already started or starting');
      return;
    }

    this._starting = true;
    this.metrics.connectionState = 'connecting';

    try {
      await this.doStart();
      this._connected = true;
      this._starting = false;
      this.startTime = Date.now();
      this.reconnectAttempts = 0;
      this.metrics.connectionState = 'connected';

      // Start health checks
      if (this.config.healthCheckIntervalMs) {
        this.healthCheckTimer = setInterval(
          () => this.runHealthCheck(),
          this.config.healthCheckIntervalMs
        );
      }

      this.emit('connected');
      logger.info({ platform: this.platform }, 'Adapter started');
    } catch (error) {
      this._starting = false;
      this.metrics.connectionState = 'disconnected';
      this.metrics.lastError = (error as Error).message;
      this.metrics.lastErrorTime = Date.now();
      logger.error({ error, platform: this.platform }, 'Failed to start adapter');
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this._stopping) {
      return;
    }

    this._stopping = true;

    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    try {
      await this.doStop();
      this._connected = false;
      this._stopping = false;
      this.metrics.connectionState = 'disconnected';
      this.emit('disconnected');
      logger.info({ platform: this.platform }, 'Adapter stopped');
    } catch (error) {
      this._stopping = false;
      logger.error({ error, platform: this.platform }, 'Error stopping adapter');
      throw error;
    }
  }

  async sendMessage(message: OutgoingMessage): Promise<string | null> {
    // Check circuit breaker
    if (!this.checkCircuitBreaker()) {
      this.metrics.messagesFailed++;
      throw new Error(`Circuit breaker open for ${this.platform}`);
    }

    // Check rate limit
    if (!this.acquireToken()) {
      this.metrics.rateLimitHits++;
      await this.waitForToken();
    }

    try {
      const result = await this.doSendMessage(message);
      this.metrics.messagesSent++;
      this.recordSuccess();
      return result;
    } catch (error) {
      this.metrics.messagesFailed++;
      this.recordFailure(error as Error);
      throw error;
    }
  }

  async editMessage?(message: OutgoingMessage & { messageId: string }): Promise<void> {
    if (!this.doEditMessage) {
      throw new Error(`Edit not supported on ${this.platform}`);
    }
    return this.doEditMessage(message);
  }

  async deleteMessage?(message: OutgoingMessage & { messageId: string }): Promise<void> {
    if (!this.doDeleteMessage) {
      throw new Error(`Delete not supported on ${this.platform}`);
    }
    return this.doDeleteMessage(message);
  }

  async reactMessage?(message: ReactionMessage): Promise<void> {
    if (!this.doReactMessage) {
      throw new Error(`Reactions not supported on ${this.platform}`);
    }
    return this.doReactMessage(message);
  }

  async sendPoll?(message: PollMessage): Promise<string | null> {
    if (!this.doSendPoll) {
      throw new Error(`Polls not supported on ${this.platform}`);
    }
    return this.doSendPoll(message);
  }

  createDraftStream?(chatId: string): DraftStream {
    if (!this.doCreateDraftStream) {
      throw new Error(`Draft streams not supported on ${this.platform}`);
    }
    return this.doCreateDraftStream(chatId);
  }

  isConnected(message?: OutgoingMessage): boolean {
    return this._connected && this.circuitBreaker.state !== 'open';
  }

  getHealth(): AdapterHealth {
    return {
      healthy: this._connected && this.circuitBreaker.state !== 'open',
      status: this.getStatusString(),
      lastCheck: Date.now(),
      metrics: {
        ...this.metrics,
        uptime: this._connected ? Date.now() - this.startTime : 0,
      },
    };
  }

  getMetrics(): AdapterMetrics {
    return {
      ...this.metrics,
      uptime: this._connected ? Date.now() - this.startTime : 0,
    };
  }

  // Protected methods for subclasses

  protected handleIncomingMessage(message: IncomingMessage): void {
    this.metrics.messagesReceived++;
    this.callbacks.onMessage(message).catch(error => {
      logger.error({ error, platform: this.platform }, 'Error handling incoming message');
    });
  }

  protected handleDisconnect(reason?: string): void {
    this._connected = false;
    this.metrics.connectionState = 'disconnected';
    this.emit('disconnected', reason);
    logger.warn({ platform: this.platform, reason }, 'Adapter disconnected');

    // Attempt reconnection
    if (!this._stopping) {
      this.scheduleReconnect();
    }
  }

  protected handleError(error: Error, category?: ErrorCategory): void {
    const errorCategory = category || this.categorizeError(error);
    this.metrics.lastError = error.message;
    this.metrics.lastErrorTime = Date.now();

    logger.error({
      platform: this.platform,
      error: error.message,
      category: errorCategory,
    }, 'Adapter error');

    this.emit('error', error, errorCategory);

    // Handle specific error categories
    if (errorCategory === 'auth') {
      // Auth errors - stop adapter
      this.stop().catch((err) => {
        logger.debug({ err }, 'Error stopping adapter after auth error');
      });
    } else if (errorCategory === 'network') {
      // Network errors - trigger reconnect
      this.handleDisconnect(error.message);
    }
  }

  // Private methods

  private getStatusString(): string {
    if (this._stopping) return 'stopping';
    if (this._starting) return 'starting';
    if (this.circuitBreaker.state === 'open') return 'circuit_open';
    if (this._connected) return 'connected';
    return 'disconnected';
  }

  private acquireToken(): boolean {
    this.refillTokens();
    if (this.tokenBucket.tokens >= 1) {
      this.tokenBucket.tokens--;
      return true;
    }
    return false;
  }

  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.tokenBucket.lastRefill;
    const tokensToAdd = elapsed * this.tokenBucket.refillRate;

    this.tokenBucket.tokens = Math.min(
      this.tokenBucket.maxTokens,
      this.tokenBucket.tokens + tokensToAdd
    );
    this.tokenBucket.lastRefill = now;
  }

  private async waitForToken(): Promise<void> {
    const waitTime = Math.ceil((1 - this.tokenBucket.tokens) / this.tokenBucket.refillRate);
    await new Promise(resolve => setTimeout(resolve, Math.max(waitTime, 50)));
  }

  private checkCircuitBreaker(): boolean {
    if (this.circuitBreaker.state === 'closed') {
      return true;
    }

    if (this.circuitBreaker.state === 'open') {
      if (Date.now() >= this.circuitBreaker.nextAttempt) {
        this.circuitBreaker.state = 'half_open';
        logger.info({ platform: this.platform }, 'Circuit breaker half-open');
        return true;
      }
      return false;
    }

    // half_open - allow one request
    return true;
  }

  private recordSuccess(): void {
    if (this.circuitBreaker.state === 'half_open') {
      this.circuitBreaker.state = 'closed';
      this.circuitBreaker.failures = 0;
      this.metrics.connectionState = 'connected';
      logger.info({ platform: this.platform }, 'Circuit breaker closed');
    }
  }

  private recordFailure(error: Error): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();

    if (this.circuitBreaker.state === 'half_open') {
      // Failed during half-open - reopen circuit
      this.openCircuit();
    } else if (this.circuitBreaker.failures >= this.config.circuitBreakerThreshold!) {
      this.openCircuit();
    }
  }

  private openCircuit(): void {
    this.circuitBreaker.state = 'open';
    this.circuitBreaker.nextAttempt = Date.now() + this.config.circuitBreakerResetMs!;
    this.metrics.circuitBreakerTrips++;
    this.metrics.connectionState = 'circuit_open';
    logger.warn({ platform: this.platform }, 'Circuit breaker opened');
  }

  private async runHealthCheck(): Promise<void> {
    try {
      const healthy = await this.doHealthCheck();
      if (!healthy && this._connected) {
        this.handleDisconnect('Health check failed');
      }
    } catch (error) {
      logger.warn({ error, platform: this.platform }, 'Health check error');
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts!) {
      logger.error({ platform: this.platform }, 'Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(
      this.config.initialReconnectDelayMs! * Math.pow(2, this.reconnectAttempts),
      this.config.maxReconnectDelayMs!
    );

    this.reconnectAttempts++;
    this.metrics.reconnections++;

    logger.info({
      platform: this.platform,
      attempt: this.reconnectAttempts,
      delay,
    }, 'Scheduling reconnection');

    setTimeout(async () => {
      if (this._stopping) return;

      try {
        this.metrics.connectionState = 'connecting';
        await this.doStart();
        this._connected = true;
        this.reconnectAttempts = 0;
        this.metrics.connectionState = 'connected';
        this.emit('reconnected');
        logger.info({ platform: this.platform }, 'Reconnected successfully');
      } catch (error) {
        logger.warn({ error, platform: this.platform }, 'Reconnection failed');
        this.scheduleReconnect();
      }
    }, delay);
  }

  private categorizeError(error: Error): ErrorCategory {
    const message = error.message.toLowerCase();

    if (message.includes('econnrefused') ||
        message.includes('enotfound') ||
        message.includes('etimedout') ||
        message.includes('network') ||
        message.includes('socket')) {
      return 'network';
    }

    if (message.includes('unauthorized') ||
        message.includes('forbidden') ||
        message.includes('auth') ||
        message.includes('token') ||
        message.includes('401') ||
        message.includes('403')) {
      return 'auth';
    }

    if (message.includes('rate limit') ||
        message.includes('too many') ||
        message.includes('429')) {
      return 'rate_limit';
    }

    if (message.includes('invalid') ||
        message.includes('validation') ||
        message.includes('bad request') ||
        message.includes('400')) {
      return 'validation';
    }

    return 'unknown';
  }
}

/**
 * Helper to create production adapter config with defaults
 */
export function createAdapterConfig(
  platform: string,
  overrides?: Partial<BaseAdapterConfig>
): BaseAdapterConfig {
  return {
    platform,
    rateLimit: 30,
    rateLimitBurst: 10,
    circuitBreakerThreshold: 5,
    circuitBreakerResetMs: 30000,
    healthCheckIntervalMs: 30000,
    maxReconnectAttempts: 10,
    initialReconnectDelayMs: 1000,
    maxReconnectDelayMs: 60000,
    enableMetrics: true,
    ...overrides,
  };
}

/**
 * Middleware for request logging
 */
export function logRequest(platform: string, operation: string, data?: unknown): void {
  logger.debug({ platform, operation, data }, 'Channel request');
}

/**
 * Middleware for response logging
 */
export function logResponse(platform: string, operation: string, result?: unknown, duration?: number): void {
  logger.debug({ platform, operation, result, duration }, 'Channel response');
}
