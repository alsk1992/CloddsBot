/**
 * Handler Types - Common types for platform handlers
 */

import type { Database } from '../../db';
import type { TradingContext, PolymarketCredentials, KalshiCredentials, Config } from '../../types';
import type { CredentialsManager } from '../../credentials';
import type { FeedManager } from '../../feeds';

/**
 * Tool input from the agent
 */
export type ToolInput = Record<string, unknown>;

/**
 * Handler result - always a JSON string
 */
export type HandlerResult = string;

/**
 * Handler context available to all handlers
 */
export interface HandlerContext {
  db: Database;
  userId?: string;
  sessionId?: string;

  // Extended context for trading handlers
  tradingContext?: TradingContext | null;
  credentials?: CredentialsManager;
  feeds?: FeedManager;
  config?: Config;
}

/**
 * Platform handler function signature
 */
export type HandlerFn = (
  toolInput: ToolInput,
  context: HandlerContext
) => Promise<HandlerResult>;

/**
 * Platform handlers map - tool name to handler function
 */
export type HandlersMap = Record<string, HandlerFn>;

/**
 * API response wrapper (common pattern)
 */
export interface ApiResponse<T = unknown> {
  code?: number;
  msg?: string;
  result?: T;
  success?: boolean;
  data?: T;
  error?: string;
}

/**
 * Helper to create JSON error result
 */
export function errorResult(message: string): HandlerResult {
  return JSON.stringify({ error: message });
}

/**
 * Helper to create JSON success result
 */
export function successResult<T>(data: T): HandlerResult {
  return JSON.stringify(data);
}

/**
 * Helper to safely execute handler with error catching
 */
export async function safeHandler<T>(
  fn: () => Promise<T>,
  errorPrefix?: string
): Promise<HandlerResult> {
  try {
    const result = await fn();
    return successResult(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return errorResult(errorPrefix ? `${errorPrefix}: ${message}` : message);
  }
}
