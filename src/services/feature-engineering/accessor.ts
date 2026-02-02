/**
 * Feature Engineering Accessor
 *
 * Provides global access to the feature engineering instance.
 * This is set by the gateway during startup.
 */

import type { FeatureEngineering, CombinedFeatures } from './types';

let featureEngineInstance: FeatureEngineering | null = null;

/**
 * Set the feature engineering instance (called by gateway)
 */
export function setFeatureEngine(engine: FeatureEngineering | null): void {
  featureEngineInstance = engine;
}

/**
 * Get the feature engineering instance
 */
export function getFeatureEngine(): FeatureEngineering | null {
  return featureEngineInstance;
}

/**
 * Convenience function to get features for a market
 */
export function getMarketFeatures(
  platform: string,
  marketId: string,
  outcomeId?: string
): CombinedFeatures | null {
  return featureEngineInstance?.getFeatures(platform, marketId, outcomeId) ?? null;
}
