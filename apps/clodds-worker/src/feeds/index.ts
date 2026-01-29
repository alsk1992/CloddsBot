/**
 * Feed Manager - Unified interface for market data
 */

import type { Env } from '../config';
import type { Market, Orderbook, Platform } from '../types';
import {
  searchPolymarkets,
  getPolymarket,
  getPolymarketOrderbook,
  getActivePolymarkets,
} from './polymarket';
import {
  searchKalshiMarkets,
  getKalshiMarket,
  getKalshiOrderbook,
  getActiveKalshiMarkets,
} from './kalshi';
import {
  searchManifoldMarkets,
  getManifoldMarket,
  getActiveManifoldMarkets,
} from './manifold';

export async function searchMarkets(
  query: string,
  env: Env,
  platform?: Platform,
  limit = 20
): Promise<Market[]> {
  if (platform) {
    switch (platform) {
      case 'polymarket':
        return searchPolymarkets(query, env, limit);
      case 'kalshi':
        return searchKalshiMarkets(query, env, limit);
      case 'manifold':
        return searchManifoldMarkets(query, env, limit);
      default:
        return [];
    }
  }

  // Search all platforms in parallel
  const [poly, kalshi, manifold] = await Promise.all([
    searchPolymarkets(query, env, limit),
    searchKalshiMarkets(query, env, limit),
    searchManifoldMarkets(query, env, limit),
  ]);

  return [...poly, ...kalshi, ...manifold].slice(0, limit);
}

export async function getMarket(
  marketId: string,
  platform: Platform,
  env: Env
): Promise<Market | null> {
  switch (platform) {
    case 'polymarket':
      return getPolymarket(marketId, env);
    case 'kalshi':
      return getKalshiMarket(marketId, env);
    case 'manifold':
      return getManifoldMarket(marketId, env);
    default:
      return null;
  }
}

export async function getOrderbook(
  marketId: string,
  platform: Platform,
  env: Env
): Promise<Orderbook | null> {
  switch (platform) {
    case 'polymarket':
      return getPolymarketOrderbook(marketId, env);
    case 'kalshi':
      return getKalshiOrderbook(marketId, env);
    default:
      // Manifold doesn't have orderbooks
      return null;
  }
}

export async function getActiveMarkets(
  env: Env,
  platform?: Platform,
  limit = 100
): Promise<Market[]> {
  if (platform) {
    switch (platform) {
      case 'polymarket':
        return getActivePolymarkets(env, limit);
      case 'kalshi':
        return getActiveKalshiMarkets(env, limit);
      case 'manifold':
        return getActiveManifoldMarkets(env, limit);
      default:
        return [];
    }
  }

  const [poly, kalshi, manifold] = await Promise.all([
    getActivePolymarkets(env, limit),
    getActiveKalshiMarkets(env, limit),
    getActiveManifoldMarkets(env, limit),
  ]);

  return [...poly, ...kalshi, ...manifold];
}

export {
  searchPolymarkets,
  getPolymarket,
  getPolymarketOrderbook,
  getActivePolymarkets,
} from './polymarket';

export {
  searchKalshiMarkets,
  getKalshiMarket,
  getKalshiOrderbook,
  getActiveKalshiMarkets,
} from './kalshi';

export {
  searchManifoldMarkets,
  getManifoldMarket,
  getActiveManifoldMarkets,
} from './manifold';
