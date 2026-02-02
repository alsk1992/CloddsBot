/**
 * Clodds Hosted API - x402 Pay-per-prompt API Gateway
 *
 * Architecture:
 * - x402 payment verification middleware
 * - Job queue for async prompt execution
 * - Custody wallet system for managed accounts
 *
 * Usage:
 * ```typescript
 * import { createApiGateway } from './api';
 *
 * const api = createApiGateway({
 *   port: 3000,
 *   pricing: { basic: 0.05, standard: 0.10, complex: 0.25 },
 *   x402: { network: 'base', privateKey: '0x...' },
 * });
 *
 * await api.start();
 * ```
 */

export { createApiGateway, type ApiGateway } from './gateway';
export { createJobManager, type JobManager, type Job, type JobStats } from './jobs';
export { createPromptHandler, type PromptHandler, type PromptResult } from './prompt';
export { createX402Middleware, type X402MiddlewareConfig } from './middleware';
export { createCustodyManager, type CustodyManager, type ManagedWallet } from './custody';
export { createApiKeyManager, type ApiKeyManager, type ApiKeyResult, parseApiKey } from './apikeys';
export { createFeeCalculator, type FeeCalculator, type FeeResult, type RevenueStats } from './fees';
export * from './types';
