/**
 * Prompt Handler - Natural language prompt processing
 *
 * Transforms user prompts into executable actions using the agent system.
 * Integrates with Clodds subagent system for actual execution.
 */

import { EventEmitter } from 'eventemitter3';
import { randomBytes } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';
import type {
  ApiRequest,
  PromptResultData,
  PromptAction,
  TransactionResult,
  PricingTier,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface PromptHandler {
  /** Process a prompt and return result */
  process(request: ApiRequest, tier: PricingTier): Promise<PromptResult>;
  /** Classify prompt into action type */
  classifyAction(prompt: string): PromptAction;
  /** Check if prompt requires custody wallet */
  requiresCustody(prompt: string): boolean;
  /** Validate prompt before processing */
  validate(prompt: string): ValidationResult;
  /** Get supported actions */
  getSupportedActions(): PromptAction[];
}

export interface PromptResult {
  success: boolean;
  data?: PromptResultData;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

export interface PromptHandlerConfig {
  /** Maximum prompt length (default: 2000) */
  maxLength?: number;
  /** Timeout for processing (default: 60000ms) */
  timeout?: number;
  /** Agent model to use (default: 'claude-sonnet-4-20250514') */
  model?: string;
  /** Enable dry run mode (default: false) */
  dryRun?: boolean;
  /** Anthropic API key (defaults to env) */
  apiKey?: string;
  /** Maximum tokens for response */
  maxTokens?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<PromptHandlerConfig> = {
  maxLength: 2000,
  timeout: 60000,
  model: 'claude-sonnet-4-20250514',
  dryRun: false,
  apiKey: '',
  maxTokens: 4096,
};

// System prompt for API execution
const API_SYSTEM_PROMPT = `You are Clodds API, an AI assistant for prediction markets and trading.

You help users via natural language commands:
- Query prices, balances, positions across platforms
- Execute trades on Polymarket, Kalshi, and other markets
- Swap tokens on DEXs (Solana, Base, Ethereum)
- Set up copy trading and signals
- Analyze markets and find edge

IMPORTANT: You are executing via API, not chat. Be concise and return structured data.
When executing trades, always confirm the action with specific details.
Never execute trades without explicit user intent in the prompt.

Available platforms: polymarket, kalshi, manifold, hyperliquid, binance
Supported chains: ethereum, base, solana, polygon, arbitrum`;


// Action classification patterns
const ACTION_PATTERNS: Record<PromptAction, RegExp[]> = {
  query: [
    /(?:what|how much|show|get|check|display|list|view|lookup|find).*(?:price|balance|position|portfolio|status|info)/i,
    /(?:price|balance|value|worth|pnl|profit|loss).*(?:of|for|is)/i,
  ],
  trade: [
    /(?:buy|sell|long|short).*(?:\$|usd|usdc|token|share|contract)/i,
    /(?:place|submit|execute).*(?:order|trade|bet|position)/i,
    /(?:market|limit).*(?:buy|sell|order)/i,
  ],
  swap: [
    /swap.*(?:for|to|into)/i,
    /(?:exchange|convert|trade).*(?:for|to|into)/i,
  ],
  transfer: [
    /(?:send|transfer|move).*(?:to|from)/i,
    /(?:withdraw|deposit)/i,
  ],
  stake: [
    /(?:stake|lock|delegate)/i,
  ],
  unstake: [
    /(?:unstake|unlock|undelegate|withdraw.*stake)/i,
  ],
  claim: [
    /(?:claim|collect|harvest).*(?:reward|yield|earning|airdrop)/i,
  ],
  approve: [
    /(?:approve|allow|permit).*(?:spend|token|contract)/i,
  ],
  bridge: [
    /(?:bridge|cross-chain|transfer.*chain)/i,
  ],
  analysis: [
    /(?:analyze|analyse|research|compare|evaluate)/i,
    /(?:should i|is it good|worth|recommend)/i,
  ],
  automation: [
    /(?:automate|schedule|recurring|trigger|alert|notify)/i,
    /(?:set up|create).*(?:bot|strategy|rule)/i,
    /(?:copy|follow|mirror).*(?:trade|wallet|trader)/i,
    /(?:dca|dollar cost|ladder)/i,
  ],
  unknown: [],
};

// Patterns that indicate execution (vs read-only)
const EXECUTION_PATTERNS = [
  /(?:buy|sell|swap|trade|transfer|send|stake|unstake|claim|approve|bridge)/i,
  /(?:execute|submit|place|create|set up)/i,
];

// Forbidden patterns (safety)
const FORBIDDEN_PATTERNS = [
  /(?:hack|exploit|steal|drain|rug)/i,
  /(?:private.*key|seed.*phrase|mnemonic)/i,
  /(?:all.*funds|entire.*balance|max.*out)/i,
];

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createPromptHandler(config: PromptHandlerConfig = {}): PromptHandler {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Initialize Anthropic client
  // Note: Use typeof to avoid conflict with local `process` function
  const envApiKey = typeof globalThis !== 'undefined' && 'process' in globalThis
    ? (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.ANTHROPIC_API_KEY
    : undefined;
  const apiKey = cfg.apiKey || envApiKey;
  const anthropicClient = apiKey ? new Anthropic({ apiKey }) : null;

  function validate(prompt: string): ValidationResult {
    // Check length
    if (!prompt || prompt.trim().length === 0) {
      return { valid: false, error: 'Prompt cannot be empty' };
    }

    if (prompt.length > cfg.maxLength) {
      return { valid: false, error: `Prompt exceeds maximum length of ${cfg.maxLength} characters` };
    }

    // Check for forbidden patterns
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(prompt)) {
        return { valid: false, error: 'Prompt contains forbidden content' };
      }
    }

    // Sanitize
    const sanitized = prompt
      .trim()
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/[<>]/g, '')           // Remove potential HTML
      .slice(0, cfg.maxLength);

    return { valid: true, sanitized };
  }

  function classifyAction(prompt: string): PromptAction {
    const normalized = prompt.toLowerCase();

    // Check each action type
    for (const [action, patterns] of Object.entries(ACTION_PATTERNS)) {
      if (action === 'unknown') continue;

      for (const pattern of patterns) {
        if (pattern.test(normalized)) {
          return action as PromptAction;
        }
      }
    }

    return 'unknown';
  }

  function requiresCustody(prompt: string): boolean {
    // Execution actions require custody
    for (const pattern of EXECUTION_PATTERNS) {
      if (pattern.test(prompt)) {
        return true;
      }
    }
    return false;
  }

  async function process(request: ApiRequest, tier: PricingTier): Promise<PromptResult> {
    const startTime = Date.now();

    try {
      // Validate prompt
      const validation = validate(request.prompt);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const prompt = validation.sanitized || request.prompt;
      const action = classifyAction(prompt);

      logger.info({
        requestId: request.id,
        wallet: request.wallet,
        action,
        tier,
        promptLength: prompt.length,
      }, 'Processing prompt');

      // In dry run mode, return mock result
      if (cfg.dryRun) {
        return createMockResult(action, prompt, startTime);
      }

      // Process based on action type
      let result: PromptResultData;

      switch (action) {
        case 'query':
          result = await processQuery(request, prompt);
          break;
        case 'trade':
          result = await processTrade(request, prompt);
          break;
        case 'swap':
          result = await processSwap(request, prompt);
          break;
        case 'transfer':
          result = await processTransfer(request, prompt);
          break;
        case 'analysis':
          result = await processAnalysis(request, prompt);
          break;
        case 'automation':
          result = await processAutomation(request, prompt);
          break;
        default:
          // Use generic agent processing
          result = await processGeneric(request, prompt, action);
      }

      result.executionTime = Date.now() - startTime;
      return { success: true, data: result };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ requestId: request.id, error: errorMsg }, 'Prompt processing failed');
      return { success: false, error: errorMsg };
    }
  }

  function createMockResult(action: PromptAction, prompt: string, startTime: number): PromptResult {
    return {
      success: true,
      data: {
        action,
        summary: `[DRY RUN] Would execute ${action} action for: "${prompt.slice(0, 50)}..."`,
        data: { dryRun: true, prompt },
        executionTime: Date.now() - startTime,
      },
    };
  }

  /**
   * Execute prompt using Claude API
   */
  async function executeWithClaude(
    request: ApiRequest,
    prompt: string,
    action: PromptAction
  ): Promise<PromptResultData> {
    if (!anthropicClient) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const startTime = Date.now();

    // Build context-aware system prompt
    const systemPrompt = `${API_SYSTEM_PROMPT}

User wallet: ${request.wallet}
Chain preference: ${request.chain || 'auto'}
Action type: ${action}
Request ID: ${request.id}`;

    try {
      const response = await anthropicClient.messages.create({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Extract text response
      const textContent = response.content.find(c => c.type === 'text');
      const responseText = textContent?.type === 'text' ? textContent.text : 'No response';

      // Parse for any transaction data in response
      let transaction: TransactionResult | undefined;
      const txMatch = responseText.match(/(?:tx|transaction|hash)[:\s]+([0-9a-fx]+)/i);
      if (txMatch) {
        transaction = {
          hash: txMatch[1],
          chain: request.chain || 'unknown',
          status: 'pending',
        };
      }

      return {
        action,
        summary: responseText.slice(0, 200) + (responseText.length > 200 ? '...' : ''),
        data: {
          response: responseText,
          model: cfg.model,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
        },
        transaction,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      logger.error({ error, requestId: request.id }, 'Claude API error');
      throw error;
    }
  }

  async function processQuery(request: ApiRequest, prompt: string): Promise<PromptResultData> {
    return executeWithClaude(request, prompt, 'query');
  }

  async function processTrade(request: ApiRequest, prompt: string): Promise<PromptResultData> {
    // For trades, we need custody wallet
    if (!request.useCustody) {
      return {
        action: 'trade',
        summary: 'Trade execution requires custody wallet. Set useCustody: true in your request.',
        data: { prompt, requiresCustody: true },
        executionTime: 0,
      };
    }
    return executeWithClaude(request, prompt, 'trade');
  }

  async function processSwap(request: ApiRequest, prompt: string): Promise<PromptResultData> {
    if (!request.useCustody) {
      return {
        action: 'swap',
        summary: 'Swap execution requires custody wallet. Set useCustody: true in your request.',
        data: { prompt, requiresCustody: true },
        executionTime: 0,
      };
    }
    return executeWithClaude(request, prompt, 'swap');
  }

  async function processTransfer(request: ApiRequest, prompt: string): Promise<PromptResultData> {
    if (!request.useCustody) {
      return {
        action: 'transfer',
        summary: 'Transfer execution requires custody wallet. Set useCustody: true in your request.',
        data: { prompt, requiresCustody: true },
        executionTime: 0,
      };
    }
    return executeWithClaude(request, prompt, 'transfer');
  }

  async function processAnalysis(request: ApiRequest, prompt: string): Promise<PromptResultData> {
    return executeWithClaude(request, prompt, 'analysis');
  }

  async function processAutomation(request: ApiRequest, prompt: string): Promise<PromptResultData> {
    // Automation requires premium tier
    return {
      action: 'automation',
      summary: 'Automation setup requires Business tier subscription.',
      data: { prompt, requiresPremium: true },
      executionTime: 0,
    };
  }

  async function processGeneric(request: ApiRequest, prompt: string, action: PromptAction): Promise<PromptResultData> {
    return executeWithClaude(request, prompt, action);
  }

  function getSupportedActions(): PromptAction[] {
    return Object.keys(ACTION_PATTERNS).filter(a => a !== 'unknown') as PromptAction[];
  }

  return {
    process,
    classifyAction,
    requiresCustody,
    validate,
    getSupportedActions,
  };
}
