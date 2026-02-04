/**
 * Market Making Module
 *
 * Two-sided quoting engine with inventory management and spread optimization
 * for prediction markets (Polymarket, Kalshi).
 */

export * from './types';
export * from './engine';
export { createMMStrategy, getMMState } from './strategy';
export type { MMStrategyDeps } from './strategy';
