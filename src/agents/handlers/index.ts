/**
 * Handlers Index
 *
 * Aggregates all platform handlers and provides a unified interface
 * for the agent manager to dispatch tool calls.
 *
 * Architecture:
 * - Each platform has its own handler module (e.g., opinion.ts, kalshi.ts)
 * - Handlers are exported as a map of tool name -> handler function
 * - This index aggregates all handlers into a single dispatch function
 *
 * Migration guide:
 * 1. Create new handler file: src/agents/handlers/<platform>.ts
 * 2. Export handlers as `<platform>Handlers: HandlersMap`
 * 3. Import and spread into `allHandlers` below
 * 4. Remove corresponding switch cases from agents/index.ts
 */

import type { ToolInput, HandlerResult, HandlerContext, HandlersMap } from './types';
export type { ToolInput, HandlerResult, HandlerContext, HandlersMap } from './types';
export { errorResult, successResult, safeHandler } from './types';

// Platform handlers
import { opinionHandlers } from './opinion';
import { betfairHandlers } from './betfair';
import { smarketsHandlers } from './smarkets';
import { virtualsHandlers } from './virtuals';
import { solanaHandlers } from './solana';
import { acpHandlers } from './acp';
import { polymarketHandlers } from './polymarket';
import { marketsHandlers } from './markets';
import { walletsHandlers } from './wallets';
import { arbitrageHandlers } from './arbitrage';
import { paperTradingHandlers } from './paper-trading';
import { credentialsHandlers } from './credentials';
import { binanceHandlers } from './binance';
import { bybitHandlers } from './bybit';
import { hyperliquidHandlers } from './hyperliquid';
import { predictfunHandlers } from './predictfun';
import { manifoldHandlers } from './manifold';
import { kalshiHandlers } from './kalshi';

/**
 * All handlers aggregated from platform modules
 */
const allHandlers: HandlersMap = {
  ...opinionHandlers,
  ...betfairHandlers,
  ...smarketsHandlers,
  ...virtualsHandlers,
  ...solanaHandlers,
  ...acpHandlers,
  ...polymarketHandlers,
  ...marketsHandlers,
  ...walletsHandlers,
  ...arbitrageHandlers,
  ...paperTradingHandlers,
  ...credentialsHandlers,
  ...binanceHandlers,
  ...bybitHandlers,
  ...hyperliquidHandlers,
  ...predictfunHandlers,
  ...manifoldHandlers,
  ...kalshiHandlers,
};

/**
 * Check if a tool has a modular handler
 */
export function hasHandler(toolName: string): boolean {
  return toolName in allHandlers;
}

/**
 * Get handler for a tool (if exists)
 */
export function getHandler(toolName: string): ((input: ToolInput, ctx: HandlerContext) => Promise<HandlerResult>) | undefined {
  return allHandlers[toolName];
}

/**
 * Dispatch a tool call to its handler
 *
 * @param toolName - Name of the tool to execute
 * @param toolInput - Input parameters for the tool
 * @param context - Handler context (db, userId, etc.)
 * @returns Result string, or null if no handler exists
 */
export async function dispatchHandler(
  toolName: string,
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult | null> {
  const handler = allHandlers[toolName];

  if (!handler) {
    return null; // No modular handler, fall back to inline switch
  }

  return handler(toolInput, context);
}

/**
 * List all available modular handlers
 */
export function listHandlers(): string[] {
  return Object.keys(allHandlers);
}

/**
 * List handlers by platform prefix
 */
export function listHandlersByPlatform(): Record<string, string[]> {
  const byPlatform: Record<string, string[]> = {};

  for (const toolName of Object.keys(allHandlers)) {
    const platform = toolName.split('_')[0];
    if (!byPlatform[platform]) {
      byPlatform[platform] = [];
    }
    byPlatform[platform].push(toolName);
  }

  return byPlatform;
}

// Re-export platform handlers for direct access if needed
export { opinionHandlers };
export { betfairHandlers };
export { smarketsHandlers };
export { virtualsHandlers };
export { solanaHandlers };
export { acpHandlers };
export { polymarketHandlers };
export { marketsHandlers };
export { walletsHandlers };
export { arbitrageHandlers };
export { paperTradingHandlers };
export { credentialsHandlers };
export { binanceHandlers };
export { bybitHandlers };
export { hyperliquidHandlers };
export { predictfunHandlers };
export { manifoldHandlers };
export { kalshiHandlers };
