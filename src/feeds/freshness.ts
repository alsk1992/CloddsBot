/**
 * WebSocket Feed Freshness Tracking
 *
 * Monitors WebSocket message timestamps and alerts on stale data.
 * Supports automatic fallback to polling when feeds go stale.
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '../utils/logger';
import type { Platform } from '../types';

export interface FreshnessConfig {
  /** Maximum age in ms before data is considered stale (default: 5000) */
  staleThresholdMs?: number;
  /** Check interval in ms (default: 1000) */
  checkIntervalMs?: number;
  /** Number of stale checks before alerting (default: 3) */
  staleCountThreshold?: number;
  /** Enable automatic polling fallback (default: true) */
  enablePollingFallback?: boolean;
  /** Polling interval when in fallback mode (default: 2000) */
  pollingIntervalMs?: number;
}

export interface FreshnessStatus {
  platform: Platform;
  marketId: string;
  lastMessageTime: number;
  age: number;
  isStale: boolean;
  staleCount: number;
  inFallbackMode: boolean;
}

export interface FreshnessEvents {
  stale: (status: FreshnessStatus) => void;
  recovered: (status: FreshnessStatus) => void;
  fallbackStarted: (status: FreshnessStatus) => void;
  fallbackEnded: (status: FreshnessStatus) => void;
}

interface FeedState {
  platform: Platform;
  marketId: string;
  lastMessageTime: number;
  staleCount: number;
  inFallbackMode: boolean;
  pollingInterval?: ReturnType<typeof setInterval>;
  pollingCallback?: () => Promise<void>;
}

const DEFAULT_CONFIG: Required<FreshnessConfig> = {
  staleThresholdMs: 5000,
  checkIntervalMs: 1000,
  staleCountThreshold: 3,
  enablePollingFallback: true,
  pollingIntervalMs: 2000,
};

export class FreshnessTracker extends EventEmitter {
  private feeds = new Map<string, FeedState>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private config: Required<FreshnessConfig>;

  constructor(config: FreshnessConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start tracking freshness for a feed
   */
  track(
    platform: Platform,
    marketId: string,
    pollingCallback?: () => Promise<void>
  ): void {
    const key = this.getKey(platform, marketId);

    if (this.feeds.has(key)) {
      // Update existing entry
      const state = this.feeds.get(key)!;
      state.lastMessageTime = Date.now();
      state.staleCount = 0;
      if (pollingCallback) {
        state.pollingCallback = pollingCallback;
      }
      return;
    }

    this.feeds.set(key, {
      platform,
      marketId,
      lastMessageTime: Date.now(),
      staleCount: 0,
      inFallbackMode: false,
      pollingCallback,
    });

    // Start check interval if not running
    if (!this.checkInterval) {
      this.startChecking();
    }
  }

  /**
   * Record a message received for a feed
   */
  recordMessage(platform: Platform, marketId: string): void {
    const key = this.getKey(platform, marketId);
    const state = this.feeds.get(key);

    if (state) {
      state.lastMessageTime = Date.now();
      state.staleCount = 0;

      // Exit fallback mode if we were in it
      if (state.inFallbackMode) {
        this.exitFallbackMode(state);
      }
    }
  }

  /**
   * Stop tracking a feed
   */
  untrack(platform: Platform, marketId: string): void {
    const key = this.getKey(platform, marketId);
    const state = this.feeds.get(key);

    if (state) {
      if (state.pollingInterval) {
        clearInterval(state.pollingInterval);
      }
      this.feeds.delete(key);
    }

    // Stop checking if no feeds left
    if (this.feeds.size === 0 && this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Get current status for a feed
   */
  getStatus(platform: Platform, marketId: string): FreshnessStatus | null {
    const key = this.getKey(platform, marketId);
    const state = this.feeds.get(key);

    if (!state) return null;

    const now = Date.now();
    const age = now - state.lastMessageTime;

    return {
      platform: state.platform,
      marketId: state.marketId,
      lastMessageTime: state.lastMessageTime,
      age,
      isStale: age > this.config.staleThresholdMs,
      staleCount: state.staleCount,
      inFallbackMode: state.inFallbackMode,
    };
  }

  /**
   * Get all tracked feeds' status
   */
  getAllStatus(): FreshnessStatus[] {
    return Array.from(this.feeds.values()).map((state) => {
      const age = Date.now() - state.lastMessageTime;
      return {
        platform: state.platform,
        marketId: state.marketId,
        lastMessageTime: state.lastMessageTime,
        age,
        isStale: age > this.config.staleThresholdMs,
        staleCount: state.staleCount,
        inFallbackMode: state.inFallbackMode,
      };
    });
  }

  /**
   * Get count of stale feeds
   */
  getStaleCount(): number {
    const now = Date.now();
    let count = 0;
    for (const state of this.feeds.values()) {
      if (now - state.lastMessageTime > this.config.staleThresholdMs) {
        count++;
      }
    }
    return count;
  }

  /**
   * Stop all tracking
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    for (const state of this.feeds.values()) {
      if (state.pollingInterval) {
        clearInterval(state.pollingInterval);
      }
    }

    this.feeds.clear();
  }

  private getKey(platform: Platform, marketId: string): string {
    return `${platform}:${marketId}`;
  }

  private startChecking(): void {
    this.checkInterval = setInterval(() => {
      this.checkFreshness();
    }, this.config.checkIntervalMs);
  }

  private checkFreshness(): void {
    const now = Date.now();

    for (const state of this.feeds.values()) {
      const age = now - state.lastMessageTime;
      const wasStale = state.staleCount >= this.config.staleCountThreshold;

      if (age > this.config.staleThresholdMs) {
        state.staleCount++;

        const status = this.getStatus(state.platform, state.marketId)!;

        // First time hitting threshold
        if (state.staleCount === this.config.staleCountThreshold) {
          logger.warn(
            {
              platform: state.platform,
              marketId: state.marketId,
              age,
              staleCount: state.staleCount,
            },
            'Feed data stale'
          );
          this.emit('stale', status);

          // Enter fallback mode
          if (this.config.enablePollingFallback && state.pollingCallback) {
            this.enterFallbackMode(state);
          }
        }
      } else if (wasStale) {
        // Recovered from stale state
        const status = this.getStatus(state.platform, state.marketId)!;
        logger.info(
          {
            platform: state.platform,
            marketId: state.marketId,
          },
          'Feed recovered'
        );
        this.emit('recovered', status);
        state.staleCount = 0;
      }
    }
  }

  private enterFallbackMode(state: FeedState): void {
    if (state.inFallbackMode) return;

    state.inFallbackMode = true;
    logger.info(
      {
        platform: state.platform,
        marketId: state.marketId,
        pollingInterval: this.config.pollingIntervalMs,
      },
      'Entering polling fallback mode'
    );

    const status = this.getStatus(state.platform, state.marketId)!;
    this.emit('fallbackStarted', status);

    // Start polling
    if (state.pollingCallback) {
      state.pollingInterval = setInterval(async () => {
        try {
          await state.pollingCallback!();
          state.lastMessageTime = Date.now();
        } catch (err) {
          logger.debug(
            { err, platform: state.platform, marketId: state.marketId },
            'Polling fallback error'
          );
        }
      }, this.config.pollingIntervalMs);

      // Run immediately
      state.pollingCallback().catch((err) => {
        logger.warn({ err }, 'Polling callback failed in fallback mode');
      });
    }
  }

  private exitFallbackMode(state: FeedState): void {
    if (!state.inFallbackMode) return;

    state.inFallbackMode = false;

    if (state.pollingInterval) {
      clearInterval(state.pollingInterval);
      state.pollingInterval = undefined;
    }

    logger.info(
      {
        platform: state.platform,
        marketId: state.marketId,
      },
      'Exiting polling fallback mode'
    );

    const status = this.getStatus(state.platform, state.marketId)!;
    this.emit('fallbackEnded', status);
  }
}

/**
 * Create a freshness tracker instance
 */
export function createFreshnessTracker(config?: FreshnessConfig): FreshnessTracker {
  return new FreshnessTracker(config);
}

/**
 * Global freshness tracker for all feeds
 */
let globalTracker: FreshnessTracker | null = null;

export function getGlobalFreshnessTracker(): FreshnessTracker {
  if (!globalTracker) {
    globalTracker = createFreshnessTracker();
  }
  return globalTracker;
}
