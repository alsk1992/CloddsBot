/**
 * Subagents Module - Clawdbot-style subagent management
 *
 * Features:
 * - Session persistence (save/restore agent state)
 * - Run registry & resumption
 * - Background execution (async subagent tasks)
 * - Streaming interrupts (cancel/pause)
 * - Result announcement (notify when done)
 * - Cost tracking per run
 * - Error classification & recovery
 * - Thinking/reasoning modes
 */

import { EventEmitter } from 'events';
import { existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';
import Anthropic from '@anthropic-ai/sdk';

// =============================================================================
// TYPES
// =============================================================================

export type SubagentStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ThinkingMode =
  | 'none'           // No thinking, direct response
  | 'basic'          // Brief internal reasoning
  | 'extended'       // Extended thinking (Claude 3.5+)
  | 'chain-of-thought'; // Explicit step-by-step

export type ErrorCategory =
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'auth'
  | 'validation'
  | 'tool_error'
  | 'context_overflow'
  | 'unknown';

export interface SubagentConfig {
  /** Unique ID for this run */
  id: string;
  /** Parent session ID */
  sessionId: string;
  /** User ID who started the run */
  userId: string;
  /** Task description */
  task: string;
  /** Model to use */
  model?: string;
  /** Thinking mode */
  thinkingMode?: ThinkingMode;
  /** Maximum turns before stopping */
  maxTurns?: number;
  /** Timeout in ms */
  timeout?: number;
  /** Tools available to this subagent */
  tools?: string[];
  /** Run in background */
  background?: boolean;
  /** Auto-retry on failure */
  autoRetry?: boolean;
  /** Max retry attempts */
  maxRetries?: number;
}

export interface SubagentState {
  config: SubagentConfig;
  status: SubagentStatus;
  /** Current turn number */
  turn: number;
  /** Conversation history */
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    tokens?: number;
  }>;
  /** Tool calls made */
  toolCalls: Array<{
    tool: string;
    params: Record<string, unknown>;
    result?: unknown;
    error?: string;
    timestamp: Date;
    durationMs?: number;
  }>;
  /** Cost tracking */
  cost: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
    currency: string;
  };
  /** Timing */
  startedAt?: Date;
  pausedAt?: Date;
  completedAt?: Date;
  /** Result (if completed) */
  result?: string;
  /** Error (if failed) */
  error?: {
    message: string;
    category: ErrorCategory;
    retryable: boolean;
    stack?: string;
  };
  /** Retry count */
  retryCount: number;
}

export interface SubagentRun {
  state: SubagentState;
  /** Stream controller for interrupts */
  controller?: AbortController;
  /** Event emitter for progress */
  events: EventEmitter;
}

export interface RunRegistryEntry {
  id: string;
  sessionId: string;
  userId: string;
  task: string;
  status: SubagentStatus;
  startedAt: Date;
  completedAt?: Date;
  cost: number;
  turns: number;
}

// =============================================================================
// COST CALCULATION
// =============================================================================

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-3-opus-20240229': { input: 15, output: 75 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.25, output: 1.25 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
};

/**
 * Calculate cost for token usage
 * Costs are per 1M tokens
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const costs = MODEL_COSTS[model] || { input: 1, output: 3 }; // Default costs
  const inputCost = (inputTokens / 1_000_000) * costs.input;
  const outputCost = (outputTokens / 1_000_000) * costs.output;
  return inputCost + outputCost;
}

// =============================================================================
// ERROR CLASSIFICATION
// =============================================================================

/**
 * Classify an error into a category
 */
export function classifyError(error: Error): { category: ErrorCategory; retryable: boolean } {
  const message = error.message.toLowerCase();

  if (message.includes('rate limit') || message.includes('429')) {
    return { category: 'rate_limit', retryable: true };
  }

  if (message.includes('timeout') || message.includes('etimedout')) {
    return { category: 'timeout', retryable: true };
  }

  if (
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('socket')
  ) {
    return { category: 'network', retryable: true };
  }

  if (
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('401') ||
    message.includes('403')
  ) {
    return { category: 'auth', retryable: false };
  }

  if (
    message.includes('validation') ||
    message.includes('invalid') ||
    message.includes('400')
  ) {
    return { category: 'validation', retryable: false };
  }

  if (message.includes('tool') || message.includes('function')) {
    return { category: 'tool_error', retryable: false };
  }

  if (
    message.includes('context') ||
    message.includes('token') ||
    message.includes('overflow')
  ) {
    return { category: 'context_overflow', retryable: false };
  }

  return { category: 'unknown', retryable: false };
}

// =============================================================================
// SESSION PERSISTENCE
// =============================================================================

const PERSISTENCE_DIR = join(homedir(), '.clodds', 'subagents');

/**
 * Ensure persistence directory exists
 */
function ensurePersistenceDir(): void {
  if (!existsSync(PERSISTENCE_DIR)) {
    mkdirSync(PERSISTENCE_DIR, { recursive: true });
  }
}

/**
 * Save subagent state to disk
 */
export function saveSubagentState(state: SubagentState): void {
  ensurePersistenceDir();
  const filePath = join(PERSISTENCE_DIR, `${state.config.id}.json`);
  writeFileSync(filePath, JSON.stringify(state, null, 2));
  logger.debug({ id: state.config.id }, 'Saved subagent state');
}

/**
 * Load subagent state from disk
 */
export function loadSubagentState(id: string): SubagentState | null {
  const filePath = join(PERSISTENCE_DIR, `${id}.json`);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    logger.error({ id, error: err }, 'Failed to load subagent state');
    return null;
  }
}

/**
 * Delete subagent state from disk
 */
export function deleteSubagentState(id: string): boolean {
  const filePath = join(PERSISTENCE_DIR, `${id}.json`);
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * List all persisted subagent states
 */
export function listPersistedStates(): string[] {
  ensurePersistenceDir();
  try {
    return readdirSync(PERSISTENCE_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch {
    return [];
  }
}

// =============================================================================
// RUN REGISTRY
// =============================================================================

export interface RunRegistry {
  /** Register a new run */
  register(run: SubagentRun): void;
  /** Get a run by ID */
  get(id: string): SubagentRun | undefined;
  /** List all runs */
  list(filter?: { userId?: string; sessionId?: string; status?: SubagentStatus }): RunRegistryEntry[];
  /** Update run status */
  updateStatus(id: string, status: SubagentStatus): void;
  /** Remove a run */
  remove(id: string): void;
  /** Get runs that can be resumed */
  getResumable(userId: string): SubagentState[];
  /** Get background runs for user */
  getBackgroundRuns(userId: string): SubagentRun[];
}

/**
 * Create a run registry
 */
export function createRunRegistry(): RunRegistry {
  const runs: Map<string, SubagentRun> = new Map();

  return {
    register(run) {
      runs.set(run.state.config.id, run);
      // Also persist state
      saveSubagentState(run.state);
      logger.debug({ id: run.state.config.id }, 'Registered subagent run');
    },

    get(id) {
      return runs.get(id);
    },

    list(filter = {}) {
      const entries: RunRegistryEntry[] = [];

      for (const run of runs.values()) {
        const { state } = run;

        // Apply filters
        if (filter.userId && state.config.userId !== filter.userId) continue;
        if (filter.sessionId && state.config.sessionId !== filter.sessionId) continue;
        if (filter.status && state.status !== filter.status) continue;

        entries.push({
          id: state.config.id,
          sessionId: state.config.sessionId,
          userId: state.config.userId,
          task: state.config.task,
          status: state.status,
          startedAt: state.startedAt || new Date(),
          completedAt: state.completedAt,
          cost: state.cost.totalCost,
          turns: state.turn,
        });
      }

      return entries;
    },

    updateStatus(id, status) {
      const run = runs.get(id);
      if (run) {
        run.state.status = status;
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          run.state.completedAt = new Date();
        }
        saveSubagentState(run.state);
      }
    },

    remove(id) {
      runs.delete(id);
      deleteSubagentState(id);
    },

    getResumable(userId) {
      const resumable: SubagentState[] = [];

      // Check persisted states
      for (const id of listPersistedStates()) {
        const state = loadSubagentState(id);
        if (
          state &&
          state.config.userId === userId &&
          (state.status === 'paused' || state.status === 'running')
        ) {
          resumable.push(state);
        }
      }

      return resumable;
    },

    getBackgroundRuns(userId) {
      const background: SubagentRun[] = [];

      for (const run of runs.values()) {
        if (
          run.state.config.userId === userId &&
          run.state.config.background &&
          run.state.status === 'running'
        ) {
          background.push(run);
        }
      }

      return background;
    },
  };
}

// =============================================================================
// SUBAGENT MANAGER
// =============================================================================

/** Tool executor function type */
export type ToolExecutor = (
  toolName: string,
  params: Record<string, unknown>,
  state: SubagentState
) => Promise<string>;

export interface SubagentManager {
  /** Start a new subagent run */
  start(config: SubagentConfig): SubagentRun;
  /** Execute a subagent run (actually runs the agent loop) */
  execute(run: SubagentRun, toolExecutor?: ToolExecutor): Promise<SubagentState>;
  /** Start and execute in background (fire-and-forget) */
  startBackground(config: SubagentConfig, toolExecutor?: ToolExecutor): SubagentRun;
  /** Resume a paused/persisted run */
  resume(id: string): SubagentRun | null;
  /** Pause a running subagent */
  pause(id: string): boolean;
  /** Cancel a running subagent */
  cancel(id: string): boolean;
  /** Get run status */
  getStatus(id: string): SubagentState | null;
  /** Wait for a run to complete */
  waitFor(id: string, timeoutMs?: number): Promise<SubagentState>;
  /** Get the run registry */
  getRegistry(): RunRegistry;
  /** Set result announcer callback */
  setAnnouncer(fn: (state: SubagentState) => Promise<void>): void;
  /** Set Anthropic client */
  setClient(client: Anthropic): void;
}

/**
 * Create a subagent manager
 */
export function createSubagentManager(): SubagentManager {
  const registry = createRunRegistry();
  let announcer: ((state: SubagentState) => Promise<void>) | null = null;
  let anthropicClient: Anthropic | null = null;

  /**
   * Create initial state for a new run
   */
  function createInitialState(config: SubagentConfig): SubagentState {
    return {
      config,
      status: 'pending',
      turn: 0,
      messages: [],
      toolCalls: [],
      cost: {
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
        currency: 'USD',
      },
      retryCount: 0,
    };
  }

  /**
   * Announce completion to user
   */
  async function announceCompletion(state: SubagentState): Promise<void> {
    if (announcer && state.config.background) {
      try {
        await announcer(state);
      } catch (err) {
        logger.error({ id: state.config.id, error: err }, 'Failed to announce completion');
      }
    }
  }

  /**
   * Default tool executor (returns error for unknown tools)
   */
  const defaultToolExecutor: ToolExecutor = async (toolName, params) => {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  };

  /**
   * Execute the agent loop for a run
   */
  async function executeAgentLoop(
    run: SubagentRun,
    toolExecutor: ToolExecutor
  ): Promise<SubagentState> {
    const { state, controller } = run;
    const signal = controller?.signal;

    // Ensure we have a client
    if (!anthropicClient) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        state.status = 'failed';
        state.error = {
          message: 'ANTHROPIC_API_KEY not set',
          category: 'auth',
          retryable: false,
        };
        saveSubagentState(state);
        run.events.emit('error', new Error('ANTHROPIC_API_KEY not set'));
        return state;
      }
      anthropicClient = new Anthropic({ apiKey });
    }

    const model = state.config.model || 'claude-3-5-sonnet-20241022';
    const maxTurns = state.config.maxTurns || 10;
    const timeout = state.config.timeout || 300000; // 5 min default

    // Build system prompt with thinking mode
    let systemPrompt = `You are a helpful assistant completing the following task:\n\n${state.config.task}`;
    if (state.config.thinkingMode) {
      systemPrompt += buildThinkingPrompt(state.config.thinkingMode);
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (state.status === 'running') {
        state.status = 'failed';
        state.error = {
          message: 'Execution timeout',
          category: 'timeout',
          retryable: true,
        };
        controller?.abort();
      }
    }, timeout);

    try {
      // Build messages from state (for resumption)
      const messages: Anthropic.MessageParam[] = state.messages.map(m => ({
        role: m.role === 'system' ? 'user' : m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // If no messages, add initial user message
      if (messages.length === 0) {
        messages.push({
          role: 'user',
          content: state.config.task,
        });
        state.messages.push({
          role: 'user',
          content: state.config.task,
          timestamp: new Date(),
        });
      }

      // Agent loop
      while (state.turn < maxTurns && state.status === 'running') {
        // Check for abort
        if (signal?.aborted) {
          logger.debug({ id: state.config.id }, 'Subagent aborted');
          break;
        }

        state.turn++;
        run.events.emit('turn', state.turn);
        logger.debug({ id: state.config.id, turn: state.turn }, 'Subagent turn');

        // Make API call
        const response = await anthropicClient.messages.create({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages,
        });

        // Track tokens/cost
        state.cost.inputTokens += response.usage.input_tokens;
        state.cost.outputTokens += response.usage.output_tokens;
        state.cost.totalCost = calculateCost(model, state.cost.inputTokens, state.cost.outputTokens);

        // Check for tool use
        const hasToolUse = response.content.some(block => block.type === 'tool_use');

        if (hasToolUse) {
          // Process tool calls
          const assistantContent = response.content;
          messages.push({ role: 'assistant', content: assistantContent });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of assistantContent) {
            if (block.type === 'tool_use') {
              const startTime = Date.now();
              const toolCall = {
                tool: block.name,
                params: block.input as Record<string, unknown>,
                timestamp: new Date(),
                durationMs: 0,
                result: undefined as unknown,
                error: undefined as string | undefined,
              };

              try {
                const result = await toolExecutor(block.name, block.input as Record<string, unknown>, state);
                toolCall.result = result;
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: result,
                });
              } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                toolCall.error = errMsg;
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: JSON.stringify({ error: errMsg }),
                });
              }

              toolCall.durationMs = Date.now() - startTime;
              state.toolCalls.push(toolCall);
            }
          }

          messages.push({ role: 'user', content: toolResults });
        } else {
          // Extract final response
          const textBlocks = response.content.filter(b => b.type === 'text');
          const responseText = textBlocks
            .map(b => (b as Anthropic.TextBlock).text)
            .join('\n');

          state.messages.push({
            role: 'assistant',
            content: responseText,
            timestamp: new Date(),
            tokens: response.usage.output_tokens,
          });

          // Done!
          state.result = responseText;
          state.status = 'completed';
          state.completedAt = new Date();
          break;
        }

        // Periodically save state
        if (state.turn % 3 === 0) {
          saveSubagentState(state);
        }
      }

      // Check if we hit max turns without completing
      if (state.turn >= maxTurns && state.status === 'running') {
        state.status = 'failed';
        state.error = {
          message: `Max turns (${maxTurns}) exceeded`,
          category: 'timeout',
          retryable: false,
        };
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const { category, retryable } = classifyError(err);

      state.status = 'failed';
      state.error = {
        message: err.message,
        category,
        retryable,
        stack: err.stack,
      };

      // Auto-retry if configured
      if (retryable && state.config.autoRetry && state.retryCount < (state.config.maxRetries || 3)) {
        state.retryCount++;
        state.status = 'running';
        logger.info({ id: state.config.id, retry: state.retryCount }, 'Auto-retrying subagent');

        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, state.retryCount), 30000)));
        return executeAgentLoop(run, toolExecutor);
      }

      run.events.emit('error', err);
    } finally {
      clearTimeout(timeoutId);
      saveSubagentState(state);

      if (state.status === 'completed') {
        run.events.emit('complete');
      }
    }

    return state;
  }

  return {
    start(config) {
      const state = createInitialState(config);
      state.status = 'running';
      state.startedAt = new Date();

      const run: SubagentRun = {
        state,
        controller: new AbortController(),
        events: new EventEmitter(),
      };

      registry.register(run);

      // Set up completion handling
      run.events.on('complete', async () => {
        await announceCompletion(state);
      });

      logger.info({ id: config.id, task: config.task }, 'Started subagent run');
      return run;
    },

    async execute(run, toolExecutor) {
      const executor = toolExecutor || defaultToolExecutor;
      return executeAgentLoop(run, executor);
    },

    startBackground(config, toolExecutor) {
      // Ensure background flag is set
      const bgConfig = { ...config, background: true };
      const run = this.start(bgConfig);

      // Execute in background (fire-and-forget)
      const executor = toolExecutor || defaultToolExecutor;
      setImmediate(() => {
        executeAgentLoop(run, executor).catch(err => {
          logger.error({ id: config.id, error: err }, 'Background execution failed');
        });
      });

      logger.info({ id: config.id, task: config.task }, 'Started background subagent');
      return run;
    },

    resume(id) {
      // Check if already running
      let run = registry.get(id);
      if (run && run.state.status === 'running') {
        return run;
      }

      // Try to load from persistence
      const state = loadSubagentState(id);
      if (!state) {
        return null;
      }

      state.status = 'running';
      state.pausedAt = undefined;

      run = {
        state,
        controller: new AbortController(),
        events: new EventEmitter(),
      };

      registry.register(run);
      logger.info({ id }, 'Resumed subagent run');
      return run;
    },

    pause(id) {
      const run = registry.get(id);
      if (!run || run.state.status !== 'running') {
        return false;
      }

      run.state.status = 'paused';
      run.state.pausedAt = new Date();
      run.controller?.abort();
      saveSubagentState(run.state);

      logger.info({ id }, 'Paused subagent run');
      return true;
    },

    cancel(id) {
      const run = registry.get(id);
      if (!run) {
        return false;
      }

      run.state.status = 'cancelled';
      run.state.completedAt = new Date();
      run.controller?.abort();
      saveSubagentState(run.state);

      logger.info({ id }, 'Cancelled subagent run');
      return true;
    },

    getStatus(id) {
      const run = registry.get(id);
      if (run) {
        return run.state;
      }
      return loadSubagentState(id);
    },

    async waitFor(id, timeoutMs = 300000) {
      return new Promise((resolve, reject) => {
        const run = registry.get(id);
        if (!run) {
          const state = loadSubagentState(id);
          if (state && (state.status === 'completed' || state.status === 'failed')) {
            resolve(state);
            return;
          }
          reject(new Error(`Run not found: ${id}`));
          return;
        }

        // Already done?
        if (
          run.state.status === 'completed' ||
          run.state.status === 'failed' ||
          run.state.status === 'cancelled'
        ) {
          resolve(run.state);
          return;
        }

        // Set timeout
        const timer = setTimeout(() => {
          reject(new Error(`Timeout waiting for run: ${id}`));
        }, timeoutMs);

        // Listen for completion
        run.events.once('complete', () => {
          clearTimeout(timer);
          resolve(run.state);
        });

        run.events.once('error', (err: Error) => {
          clearTimeout(timer);
          reject(err);
        });
      });
    },

    getRegistry() {
      return registry;
    },

    setAnnouncer(fn) {
      announcer = fn;
    },

    setClient(client) {
      anthropicClient = client;
    },
  };
}

// =============================================================================
// THINKING MODE HELPERS
// =============================================================================

/**
 * Build system prompt modifier for thinking mode
 */
export function buildThinkingPrompt(mode: ThinkingMode): string {
  switch (mode) {
    case 'none':
      return '';

    case 'basic':
      return '\nBefore responding, briefly consider the key aspects of the question internally.';

    case 'extended':
      return `
Before providing your response, engage in extended thinking to thoroughly analyze the problem.
Use <thinking> tags to show your internal reasoning process.
Consider multiple angles, potential issues, and the best approach before responding.
`;

    case 'chain-of-thought':
      return `
Use explicit chain-of-thought reasoning for this task:
1. First, understand and restate the problem
2. Break it down into smaller steps
3. Work through each step systematically
4. Check your reasoning for errors
5. Provide a clear final answer

Show your reasoning process in your response.
`;

    default:
      return '';
  }
}

/**
 * Parse extended thinking from response
 */
export function parseThinkingResponse(response: string): {
  thinking: string | null;
  response: string;
} {
  const thinkingMatch = response.match(/<thinking>([\s\S]*?)<\/thinking>/);

  if (thinkingMatch) {
    const thinking = thinkingMatch[1].trim();
    const cleanResponse = response.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
    return { thinking, response: cleanResponse };
  }

  return { thinking: null, response };
}

// =============================================================================
// EXPORTS
// =============================================================================

export const subagents = {
  createManager: createSubagentManager,
  createRegistry: createRunRegistry,
  calculateCost,
  classifyError,
  saveState: saveSubagentState,
  loadState: loadSubagentState,
  deleteState: deleteSubagentState,
  listStates: listPersistedStates,
  buildThinkingPrompt,
  parseThinkingResponse,
};
