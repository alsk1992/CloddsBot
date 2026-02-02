/**
 * Fee Calculator - Trading fees and revenue tracking
 *
 * Revenue sources:
 * 1. Prompt fees: $0.05-0.25 per request
 * 2. Trading fees: 0.3% of volume (configurable)
 * 3. Subscription revenue: $29-499/month
 */

import { logger } from '../utils/logger';
import type {
  TradingFeeConfig,
  DEFAULT_TRADING_FEES,
  SubscriptionTier,
  SUBSCRIPTION_TIERS,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface FeeCalculator {
  /** Calculate trading fee for a trade */
  calculateTradingFee(volumeUsd: number, tier?: SubscriptionTier, isTokenHolder?: boolean): FeeResult;
  /** Calculate prompt fee */
  calculatePromptFee(tier: 'basic' | 'standard' | 'complex', subscriptionTier?: SubscriptionTier): number;
  /** Get fee breakdown */
  getFeeBreakdown(volumeUsd: number, tier?: SubscriptionTier, isTokenHolder?: boolean): FeeBreakdown;
  /** Record fee revenue */
  recordRevenue(type: 'prompt' | 'trading' | 'subscription', amount: number, meta?: Record<string, unknown>): void;
  /** Get total revenue */
  getTotalRevenue(): RevenueStats;
  /** Get revenue by period */
  getRevenueByPeriod(startMs: number, endMs: number): RevenueStats;
}

export interface FeeResult {
  /** Fee in USD */
  feeUsd: number;
  /** Fee as percentage */
  feePct: number;
  /** Net amount after fee */
  netAmount: number;
  /** Discounts applied */
  discounts: FeeDiscount[];
}

export interface FeeDiscount {
  type: 'subscription' | 'token_holder' | 'referral' | 'volume';
  amount: number;
  reason: string;
}

export interface FeeBreakdown {
  grossFee: number;
  discounts: FeeDiscount[];
  netFee: number;
  platform: string;
  timestamp: number;
}

export interface RevenueRecord {
  type: 'prompt' | 'trading' | 'subscription';
  amount: number;
  timestamp: number;
  meta?: Record<string, unknown>;
}

export interface RevenueStats {
  total: number;
  byType: {
    prompt: number;
    trading: number;
    subscription: number;
  };
  count: number;
  period?: { start: number; end: number };
}

export interface FeeCalculatorConfig extends Partial<TradingFeeConfig> {
  /** Prompt pricing */
  promptPricing?: {
    basic: number;
    standard: number;
    complex: number;
  };
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: FeeCalculatorConfig = {
  baseFee: 0.003,
  minFee: 0.01,
  maxFee: 100,
  tokenHolderDiscount: 0.2,
  promptPricing: {
    basic: 0.05,
    standard: 0.10,
    complex: 0.25,
  },
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createFeeCalculator(config: FeeCalculatorConfig = {}): FeeCalculator {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Revenue tracking (in-memory, would use DB in production)
  const revenueLog: RevenueRecord[] = [];

  function calculateTradingFee(
    volumeUsd: number,
    subscriptionTier: SubscriptionTier = 'free',
    isTokenHolder: boolean = false
  ): FeeResult {
    if (volumeUsd <= 0) {
      return { feeUsd: 0, feePct: 0, netAmount: 0, discounts: [] };
    }

    const discounts: FeeDiscount[] = [];
    let effectiveRate = cfg.baseFee!;

    // Import tier config
    const tierConfig = require('./types').SUBSCRIPTION_TIERS[subscriptionTier];

    // Subscription discount
    if (tierConfig?.tradingFeeDiscount > 0) {
      const discount = effectiveRate * tierConfig.tradingFeeDiscount;
      effectiveRate -= discount;
      discounts.push({
        type: 'subscription',
        amount: discount * volumeUsd,
        reason: `${subscriptionTier} tier: ${(tierConfig.tradingFeeDiscount * 100).toFixed(0)}% off`,
      });
    }

    // Token holder discount
    if (isTokenHolder && cfg.tokenHolderDiscount! > 0) {
      const discount = effectiveRate * cfg.tokenHolderDiscount!;
      effectiveRate -= discount;
      discounts.push({
        type: 'token_holder',
        amount: discount * volumeUsd,
        reason: `$CLODDS holder: ${(cfg.tokenHolderDiscount! * 100).toFixed(0)}% off`,
      });
    }

    // Calculate fee
    let feeUsd = volumeUsd * effectiveRate;

    // Apply min/max
    feeUsd = Math.max(cfg.minFee!, Math.min(cfg.maxFee!, feeUsd));

    return {
      feeUsd: Math.round(feeUsd * 100) / 100,
      feePct: effectiveRate * 100,
      netAmount: Math.round((volumeUsd - feeUsd) * 100) / 100,
      discounts,
    };
  }

  function calculatePromptFee(
    promptTier: 'basic' | 'standard' | 'complex',
    subscriptionTier: SubscriptionTier = 'free'
  ): number {
    const basePrice = cfg.promptPricing![promptTier] || cfg.promptPricing!.standard;

    // Pro+ subscribers get prompts included
    const tierConfig = require('./types').SUBSCRIPTION_TIERS[subscriptionTier];
    if (tierConfig?.priceMonthly > 0) {
      // Subscribers pay reduced rate
      return Math.round(basePrice * 0.5 * 100) / 100;
    }

    return basePrice;
  }

  function getFeeBreakdown(
    volumeUsd: number,
    subscriptionTier?: SubscriptionTier,
    isTokenHolder?: boolean
  ): FeeBreakdown {
    const result = calculateTradingFee(volumeUsd, subscriptionTier, isTokenHolder);

    return {
      grossFee: volumeUsd * cfg.baseFee!,
      discounts: result.discounts,
      netFee: result.feeUsd,
      platform: 'clodds',
      timestamp: Date.now(),
    };
  }

  function recordRevenue(
    type: 'prompt' | 'trading' | 'subscription',
    amount: number,
    meta?: Record<string, unknown>
  ): void {
    revenueLog.push({
      type,
      amount,
      timestamp: Date.now(),
      meta,
    });

    logger.debug({ type, amount }, 'Revenue recorded');
  }

  function getTotalRevenue(): RevenueStats {
    return calculateStats(revenueLog);
  }

  function getRevenueByPeriod(startMs: number, endMs: number): RevenueStats {
    const filtered = revenueLog.filter(r => r.timestamp >= startMs && r.timestamp <= endMs);
    const stats = calculateStats(filtered);
    stats.period = { start: startMs, end: endMs };
    return stats;
  }

  function calculateStats(records: RevenueRecord[]): RevenueStats {
    const stats: RevenueStats = {
      total: 0,
      byType: { prompt: 0, trading: 0, subscription: 0 },
      count: records.length,
    };

    for (const record of records) {
      stats.total += record.amount;
      stats.byType[record.type] += record.amount;
    }

    // Round
    stats.total = Math.round(stats.total * 100) / 100;
    stats.byType.prompt = Math.round(stats.byType.prompt * 100) / 100;
    stats.byType.trading = Math.round(stats.byType.trading * 100) / 100;
    stats.byType.subscription = Math.round(stats.byType.subscription * 100) / 100;

    return stats;
  }

  return {
    calculateTradingFee,
    calculatePromptFee,
    getFeeBreakdown,
    recordRevenue,
    getTotalRevenue,
    getRevenueByPeriod,
  };
}

/**
 * Example fee calculations:
 *
 * Free user trades $1,000:
 *   Base fee: 0.3% = $3.00
 *   Net: $997.00
 *
 * Pro subscriber ($29/mo) trades $1,000:
 *   Base fee: 0.3% = $3.00
 *   Subscription discount: 10% = -$0.30
 *   Net fee: $2.70
 *
 * Business + $CLODDS holder trades $10,000:
 *   Base fee: 0.3% = $30.00
 *   Subscription discount: 25% = -$7.50
 *   Token holder discount: 20% of remaining = -$4.50
 *   Net fee: $18.00
 */
