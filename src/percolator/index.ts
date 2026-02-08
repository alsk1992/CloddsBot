/**
 * Percolator module — on-chain Solana perpetual futures.
 * Factory + re-exports.
 */

export type { PercolatorConfig, PercolatorMarketState, PercolatorPosition } from './types.js';
export type { PercolatorFeed } from './feed.js';
export type { PercolatorExecutionService, PercolatorOrderResult } from './execution.js';
export type { PercolatorKeeper } from './keeper.js';
export { createPercolatorFeed } from './feed.js';
export { createPercolatorExecution } from './execution.js';
export { createPercolatorKeeper } from './keeper.js';

import type { PercolatorConfig } from './types.js';
import type { PercolatorFeed } from './feed.js';
import type { PercolatorExecutionService } from './execution.js';
import type { PercolatorKeeper } from './keeper.js';
import { createPercolatorFeed } from './feed.js';
import { createPercolatorExecution } from './execution.js';
import { createPercolatorKeeper } from './keeper.js';

export function createPercolatorService(config: PercolatorConfig): {
  feed: PercolatorFeed;
  execution: PercolatorExecutionService;
  keeper: PercolatorKeeper | null;
} {
  const feed = createPercolatorFeed(config);
  const execution = createPercolatorExecution(config);
  const keeper = config.keeperEnabled ? createPercolatorKeeper(config) : null;
  return { feed, execution, keeper };
}
