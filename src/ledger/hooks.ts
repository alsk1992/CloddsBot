/**
 * Trade Ledger - Hook Integration
 *
 * Auto-capture decisions via the Clodds hooks system.
 */

import type {
  DecisionRecord,
  DecisionCategory,
  DecisionOutcome,
  ConstraintEvaluation,
  LedgerConfig,
} from './types';
import type { LedgerStorage } from './storage';

// =============================================================================
// HOOK CONTEXT TYPES (matches Clodds hooks)
// =============================================================================

export interface HookContext {
  event: string;
  message?: {
    userId?: string;
    chatId?: string;
    text?: string;
  };
  session?: {
    id?: string;
    userId?: string;
  };
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: unknown;
  data: Record<string, unknown>;
  cancelled?: boolean;
}

// =============================================================================
// TRADING TOOLS TO CAPTURE
// =============================================================================

const TRADING_TOOLS = new Set([
  'execute_trade',
  'execute_order',
  'buy_shares',
  'sell_shares',
  'place_order',
  'cancel_order',
  'follow_wallet',
  'copy_trade',
  'execute_arbitrage',
  'swap_tokens',
  'open_position',
  'close_position',
]);

const TOOL_TO_CATEGORY: Record<string, DecisionCategory> = {
  execute_trade: 'trade',
  execute_order: 'trade',
  buy_shares: 'trade',
  sell_shares: 'trade',
  place_order: 'trade',
  follow_wallet: 'copy',
  copy_trade: 'copy',
  execute_arbitrage: 'arbitrage',
  swap_tokens: 'trade',
  open_position: 'trade',
  close_position: 'trade',
};

// =============================================================================
// HOOK HANDLERS
// =============================================================================

/**
 * Create ledger hook handlers
 */
export function createLedgerHooks(
  storage: LedgerStorage,
  config: LedgerConfig
): {
  beforeTool: (ctx: HookContext) => void;
  afterTool: (ctx: HookContext) => void;
} {
  const pendingDecisions = new Map<string, { id: string; ts: number }>();

  const evictStale = () => {
    if (pendingDecisions.size > 500) {
      const cutoff = Date.now() - 300_000;
      for (const [key, entry] of pendingDecisions) {
        if (entry.ts < cutoff) pendingDecisions.delete(key);
      }
    }
  };

  return {
    /**
     * Before tool execution - capture decision context
     */
    beforeTool(ctx: HookContext) {
      if (!config.enabled) return;

      const { toolName, toolParams, session, message } = ctx;
      if (!toolName) return;

      // Check if this is a tool we should capture
      const shouldCapture = config.captureAll || TRADING_TOOLS.has(toolName);
      if (!shouldCapture) return;

      const userId = session?.userId || message?.userId || 'unknown';
      const category = TOOL_TO_CATEGORY[toolName] || 'tool';

      // Extract relevant params for inputs
      const inputs = extractInputs(toolName, toolParams || {});

      // Build constraint list from params (if available)
      const constraints = extractConstraints(toolParams || {});

      // Create the decision record
      const record: Omit<DecisionRecord, 'id' | 'timestamp' | 'hash'> = {
        userId,
        sessionId: session?.id,
        category,
        action: toolName,
        platform: inputs.platform as string | undefined,
        marketId: inputs.marketId as string | undefined,
        inputs,
        constraints,
        decision: 'executed', // Will be updated in afterTool
        reason: `Executing ${toolName}`,
      };

      // Capture and store the ID for later update
      const decisionId = storage.capture(record, { hashIntegrity: config.hashIntegrity });

      const callId = `${toolName}-${Date.now()}`;
      pendingDecisions.set(callId, { id: decisionId, ts: Date.now() });
      ctx.data.ledgerCallId = callId;
      ctx.data.ledgerDecisionId = decisionId;
      evictStale();
    },

    /**
     * After tool execution - update with outcome
     */
    afterTool(ctx: HookContext) {
      if (!config.enabled) return;

      const decisionId = ctx.data.ledgerDecisionId as string | undefined;
      if (!decisionId) return;

      const { toolResult } = ctx;

      // Extract outcome from result
      const outcome = extractOutcome(toolResult);

      // Update the decision record
      storage.updateOutcome(decisionId, outcome);

      // Clean up pending
      const callId = ctx.data.ledgerCallId as string;
      if (callId) {
        pendingDecisions.delete(callId);
      }
    },
  };
}

// =============================================================================
// EXTRACTION HELPERS
// =============================================================================

function extractInputs(
  toolName: string,
  params: Record<string, unknown>
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {
    toolName,
  };

  // Common fields
  if (params.platform !== undefined) inputs.platform = params.platform;
  if (params.market !== undefined) inputs.market = params.market;
  if (params.marketId !== undefined) inputs.marketId = params.marketId;
  if (params.side !== undefined) inputs.side = params.side;
  if (params.size !== undefined) inputs.size = params.size;
  if (params.price !== undefined) inputs.price = params.price;
  if (params.amount !== undefined) inputs.amount = params.amount;
  if (params.address !== undefined) inputs.address = params.address;
  if (params.wallet !== undefined) inputs.wallet = params.wallet;
  if (params.token !== undefined) inputs.token = params.token;
  if (params.leverage !== undefined) inputs.leverage = params.leverage;

  return inputs;
}

function extractConstraints(params: Record<string, unknown>): ConstraintEvaluation[] {
  const constraints: ConstraintEvaluation[] = [];

  // If the tool params include constraint info, extract it
  if (params.maxSize !== undefined) {
    constraints.push({
      type: 'max_order_size',
      rule: 'Maximum order size',
      threshold: params.maxSize as number,
      passed: true,
    });
  }

  if (params.maxExposure !== undefined) {
    constraints.push({
      type: 'max_exposure',
      rule: 'Maximum exposure',
      threshold: params.maxExposure as number,
      passed: true,
    });
  }

  // Add a default "tool_executed" constraint if none found
  if (constraints.length === 0) {
    constraints.push({
      type: 'custom',
      rule: 'Tool execution permitted',
      passed: true,
    });
  }

  return constraints;
}

function extractOutcome(result: unknown): {
  success?: boolean;
  orderId?: string;
  error?: string;
  pnl?: number;
  [key: string]: unknown;
} {
  if (!result) {
    return { success: false, error: 'No result returned' };
  }

  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>;

    return {
      success: r.success === true || r.status === 'filled' || r.status === 'success',
      orderId: r.orderId as string | undefined,
      error: r.error as string | undefined,
      pnl: r.pnl as number | undefined,
      filledSize: r.filledSize as number | undefined,
      avgPrice: r.avgPrice as number | undefined,
    };
  }

  return { success: true };
}

// =============================================================================
// MANUAL CAPTURE HELPERS
// =============================================================================

/**
 * Capture an opportunity decision
 */
export function captureOpportunityDecision(
  storage: LedgerStorage,
  config: LedgerConfig,
  data: {
    userId: string;
    sessionId?: string;
    opportunityId: string;
    type: string;
    edge: number;
    liquidity: number;
    constraints: ConstraintEvaluation[];
    decision: DecisionOutcome;
    reason: string;
    confidence?: number;
    platform?: string;
    marketId?: string;
  }
): string | null {
  if (!config.enabled) return null;

  const record: Omit<DecisionRecord, 'id' | 'timestamp' | 'hash'> = {
    userId: data.userId,
    sessionId: data.sessionId,
    category: 'opportunity',
    action: `opportunity_${data.type}`,
    platform: data.platform,
    marketId: data.marketId,
    inputs: {
      opportunityId: data.opportunityId,
      type: data.type,
      edge: data.edge,
      liquidity: data.liquidity,
    },
    constraints: data.constraints,
    confidence: data.confidence,
    decision: data.decision,
    reason: data.reason,
  };

  return storage.capture(record, { hashIntegrity: config.hashIntegrity });
}

/**
 * Capture a copy trading decision
 */
export function captureCopyDecision(
  storage: LedgerStorage,
  config: LedgerConfig,
  data: {
    userId: string;
    sessionId?: string;
    followedAddress: string;
    originalTrade: Record<string, unknown>;
    constraints: ConstraintEvaluation[];
    decision: DecisionOutcome;
    reason: string;
    confidence?: number;
    platform?: string;
  }
): string | null {
  if (!config.enabled) return null;

  const record: Omit<DecisionRecord, 'id' | 'timestamp' | 'hash'> = {
    userId: data.userId,
    sessionId: data.sessionId,
    category: 'copy',
    action: 'copy_trade',
    platform: data.platform,
    inputs: {
      followedAddress: data.followedAddress,
      originalTrade: data.originalTrade,
    },
    constraints: data.constraints,
    confidence: data.confidence,
    decision: data.decision,
    reason: data.reason,
  };

  return storage.capture(record, { hashIntegrity: config.hashIntegrity });
}

/**
 * Capture a risk check decision
 */
export function captureRiskDecision(
  storage: LedgerStorage,
  config: LedgerConfig,
  data: {
    userId: string;
    sessionId?: string;
    checkType: string;
    proposed: number;
    current?: number;
    limit: number;
    passed: boolean;
    reason: string;
    platform?: string;
    marketId?: string;
  }
): string | null {
  if (!config.enabled) return null;

  const record: Omit<DecisionRecord, 'id' | 'timestamp' | 'hash'> = {
    userId: data.userId,
    sessionId: data.sessionId,
    category: 'risk',
    action: `risk_check_${data.checkType}`,
    platform: data.platform,
    marketId: data.marketId,
    inputs: {
      checkType: data.checkType,
      proposed: data.proposed,
      current: data.current,
      limit: data.limit,
    },
    constraints: [
      {
        type: data.checkType as ConstraintEvaluation['type'],
        rule: `${data.checkType} limit`,
        threshold: data.limit,
        actual: data.proposed,
        passed: data.passed,
        violation: data.passed ? undefined : data.reason,
      },
    ],
    decision: data.passed ? 'approved' : 'blocked',
    reason: data.reason,
  };

  return storage.capture(record, { hashIntegrity: config.hashIntegrity });
}

// =============================================================================
// COPY TRADER INTEGRATION
// =============================================================================

export interface CopyTraderEvents {
  on(
    event: 'tradeCopied',
    listener: (data: {
      target: { address: string; name?: string; config: { multiplier: number; maxPositionSol: number } };
      trade: { action: 'buy' | 'sell'; mint: string; solAmount: number; signature: string };
      result: { success: boolean; solSpent?: number; solReceived?: number; error?: string; signature?: string };
    }) => void
  ): void;
}

/**
 * Integrate ledger with CopyTrader events
 * Call this to auto-capture copy trading decisions
 */
export function integrateCopyTrader(
  storage: LedgerStorage,
  config: LedgerConfig,
  copyTrader: CopyTraderEvents,
  userId = 'default'
): void {
  if (!config.enabled) return;

  copyTrader.on('tradeCopied', ({ target, trade, result }) => {
    const constraints: ConstraintEvaluation[] = [
      {
        type: 'max_order_size',
        rule: `Max position ${target.config.maxPositionSol} SOL`,
        threshold: target.config.maxPositionSol,
        actual: result.solSpent ?? trade.solAmount * target.config.multiplier,
        passed: true,
      },
    ];

    captureCopyDecision(storage, config, {
      userId,
      followedAddress: target.address,
      originalTrade: {
        action: trade.action,
        mint: trade.mint,
        solAmount: trade.solAmount,
        signature: trade.signature,
      },
      constraints,
      decision: result.success ? 'executed' : 'failed',
      reason: result.success
        ? `Copied ${trade.action} from ${target.name || target.address.slice(0, 8)}`
        : `Copy failed: ${result.error}`,
      platform: 'solana',
    });
  });
}
