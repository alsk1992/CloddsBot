/**
 * Hooks System - Clawdbot-style event hooks with full lifecycle support
 *
 * Features:
 * - Register hooks for events (message, response, tool, agent, gateway, etc.)
 * - Sync and async hooks
 * - Hook priorities (higher runs first)
 * - Hook filtering by channel/user
 * - Result-returning hooks (can modify events)
 * - Tool interception (before/after tool calls)
 * - Message modification capability
 * - Gateway and agent lifecycle hooks
 * - Hook discovery from filesystem
 * - Eligibility checking (requirements validation)
 */

import { EventEmitter } from 'eventemitter3';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, appendFileSync, statSync, renameSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { generateId as generateSecureId } from '../utils/id';
import { logger } from '../utils/logger';
import type { IncomingMessage, OutgoingMessage, Session } from '../types';

// =============================================================================
// HOOK EVENT TYPES
// =============================================================================

export type HookEvent =
  // Message lifecycle
  | 'message:before'       // Before processing incoming message
  | 'message:after'        // After processing incoming message
  | 'message:received'     // Incoming message received
  | 'message:sending'      // Before sending (can modify/cancel)
  | 'message:sent'         // After message sent
  // Response lifecycle
  | 'response:before'      // Before sending response
  | 'response:after'       // After sending response
  // Session lifecycle
  | 'session:start'        // Session created
  | 'session:end'          // Session ended
  | 'session:reset'        // Session was reset
  | 'session:created'      // Alias for session:start
  // Agent lifecycle
  | 'agent:before_start'   // Before agent starts (can inject system prompt)
  | 'agent:end'            // Agent finished
  // Compaction lifecycle
  | 'compaction:before'    // Before context compaction
  | 'compaction:after'     // After context compaction
  // Tool lifecycle
  | 'tool:before_call'     // Before tool execution (can modify/block)
  | 'tool:after_call'      // After tool execution
  | 'tool:result_persist'  // Before persisting result (can transform)
  // Gateway lifecycle
  | 'gateway:start'        // Gateway started
  | 'gateway:stop'         // Gateway stopping
  // Error
  | 'error';               // Error occurred

// =============================================================================
// HOOK CONTEXT TYPES
// =============================================================================

export interface HookContext {
  event: HookEvent;
  message?: IncomingMessage;
  response?: OutgoingMessage;
  session?: Session;
  error?: Error;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  runId?: string;
  abortSignal?: AbortSignal;
  cancelledReason?: string;
  hookId?: string;
  hookName?: string;
  hookStateKey?: string;
  getState?: (key: string, defaultValue?: unknown) => unknown;
  setState?: (key: string, value: unknown) => void;
  clearState?: (key?: string) => void;
  /** Set to true to stop further processing */
  cancelled?: boolean;
  /** Custom data passed between hooks */
  data: Record<string, unknown>;
}

/** Context for agent hooks */
export interface AgentHookContext extends HookContext {
  agentId: string;
  sessionId?: string;
  /** System prompt (can be modified by before_agent_start) */
  systemPrompt?: string;
  /** Content to prepend to context */
  prependContext?: string;
  /** Messages in the conversation */
  messages?: Array<{ role: string; content: string }>;
}

/** Context for tool hooks */
export interface ToolHookContext extends HookContext {
  toolName: string;
  toolParams: Record<string, unknown>;
  /** Set to true to block tool execution */
  blocked?: boolean;
  /** Reason for blocking */
  blockReason?: string;
  /** Tool result (for after_call and result_persist) */
  toolResult?: unknown;
  /** Modified result (for result_persist) */
  modifiedResult?: unknown;
}

/** Context for message sending hooks */
export interface MessageSendingContext extends HookContext {
  /** Original content */
  content: string;
  /** Modified content (if changed) */
  modifiedContent?: string;
  /** Channel to send to */
  channel: string;
  /** Recipient */
  recipient?: string;
  /** Set to true to cancel sending */
  cancel?: boolean;
}

/** Context for compaction hooks */
export interface CompactionContext extends HookContext {
  sessionId: string;
  /** Token count before compaction */
  tokensBefore?: number;
  /** Token count after compaction */
  tokensAfter?: number;
  /** Compaction count (how many times compacted) */
  compactionCount: number;
}

// =============================================================================
// HOOK RESULT TYPES
// =============================================================================

/** Result from before_agent_start hook */
export interface AgentStartResult {
  systemPrompt?: string;
  prependContext?: string;
}

/** Result from message_sending hook */
export interface MessageSendingResult {
  content?: string;
  cancel?: boolean;
}

/** Result from before_tool_call hook */
export interface ToolCallResult {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
}

/** Result from tool_result_persist hook */
export interface ToolPersistResult {
  message?: unknown;
}

// =============================================================================
// HOOK TYPES
// =============================================================================

export type HookFn<TContext = HookContext, TResult = void> =
  (ctx: TContext) => Promise<TResult | void> | TResult | void;

export interface Hook<TContext = HookContext, TResult = void> {
  id: string;
  name?: string;
  event: HookEvent;
  fn: HookFn<TContext, TResult>;
  priority: number;
  /** Execution mode: sequential (for modifying) or parallel (fire-and-forget) */
  execution: 'sequential' | 'parallel';
  /** Whether this hook is sync-only (like tool_result_persist) */
  syncOnly?: boolean;
  filter?: {
    channels?: string[];
    users?: string[];
    agentIds?: string[];
    tools?: string[];
  };
  /** Conditional execution */
  when?: HookCondition;
  /** Requirements for this hook to be active */
  requirements?: HookRequirements;
  /** Whether hook is enabled */
  enabled: boolean;
  /** Source path (for discovered hooks) */
  sourcePath?: string;
}

export interface HookRequirements {
  /** Required binaries in PATH */
  bins?: string[];
  /** Required environment variables */
  env?: string[];
  /** Required config keys */
  config?: string[];
  /** Required OS */
  os?: string[];
}

export type HookCondition =
  | {
      any?: HookCondition[];
      all?: HookCondition[];
      not?: HookCondition;
    }
  | {
      field: 'channel' | 'userId' | 'agentId' | 'toolName' | 'messageText' | 'event';
      op: 'eq' | 'neq' | 'in' | 'contains' | 'regex' | 'startsWith' | 'endsWith';
      value: string | string[];
    };

// =============================================================================
// HOOK METADATA (for discovery)
// =============================================================================

export interface HookMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
  events: HookEvent[];
  priority?: number;
  execution?: 'sequential' | 'parallel';
  requirements?: HookRequirements;
}

export interface HookStateFile {
  version: number;
  sources: Record<string, { enabled: boolean; updatedAt: string }>;
}

export interface HookStateStore {
  version: number;
  data: Record<string, Record<string, unknown>>;
  updatedAt?: string;
}

export interface HookTraceEntry {
  id: string;
  hookId: string;
  hookName?: string;
  event: HookEvent;
  execution: 'sequential' | 'parallel';
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'error';
  error?: string;
}

export interface HookRunInfo {
  runId: string;
  event: HookEvent;
  startedAt: string;
  cancelled: boolean;
  reason?: string;
}

// =============================================================================
// HOOKS SERVICE
// =============================================================================

export interface HooksService {
  /** Register a hook */
  register<TContext extends HookContext = HookContext, TResult = void>(
    event: HookEvent,
    fn: HookFn<TContext, TResult>,
    opts?: {
      name?: string;
      priority?: number;
      execution?: 'sequential' | 'parallel';
      syncOnly?: boolean;
      filter?: Hook['filter'];
      requirements?: HookRequirements;
      sourcePath?: string;
      when?: HookCondition;
    }
  ): string;

  /** Unregister a hook */
  unregister(id: string): boolean;

  /** Enable/disable a hook */
  setEnabled(id: string, enabled: boolean): boolean;

  /** Trigger event (fire-and-forget for parallel hooks) */
  trigger(event: HookEvent, ctx: Partial<HookContext>): Promise<HookContext>;

  /** Trigger event with result collection (for modifying hooks) */
  triggerWithResult<TResult>(
    event: HookEvent,
    ctx: Partial<HookContext>,
    mergeResults?: (results: TResult[]) => TResult
  ): Promise<{ ctx: HookContext; result: TResult | undefined }>;

  /** Trigger sync hooks only (for hot paths like tool_result_persist) */
  triggerSync(event: HookEvent, ctx: Partial<HookContext>): HookContext;

  /** List all registered hooks */
  list(): Hook[];

  /** Get hook by ID */
  get(id: string): Hook | undefined;

  /** Check if hook requirements are met */
  checkRequirements(requirements: HookRequirements): { met: boolean; missing: string[] };

  /** Discover hooks from directories */
  discover(directories: string[]): Promise<number>;

  /** Install a hook from path */
  install(hookPath: string): Promise<string>;

  /** Enable/disable hook tracing */
  setTracingEnabled(enabled: boolean): void;
  /** Set trace buffer limit */
  setTraceLimit(limit: number): void;
  /** List recent hook traces */
  listTraces(limit?: number): HookTraceEntry[];
  /** Clear hook traces */
  clearTraces(): void;

  /** Cancel a running hook execution */
  cancel(runId: string, reason?: string): boolean;
  /** List running hook executions */
  listActiveRuns(): HookRunInfo[];

  /** Get hook state */
  getState(hookKey: string, key?: string): unknown;
  /** Set hook state */
  setState(hookKey: string, key: string, value: unknown): void;
  /** Clear hook state */
  clearState(hookKey: string, key?: string): void;
}

// =============================================================================
// HOOK EXECUTION MODES BY EVENT
// =============================================================================

const EVENT_EXECUTION_MODES: Record<HookEvent, 'sequential' | 'parallel'> = {
  // Sequential (can modify)
  'message:before': 'sequential',
  'message:sending': 'sequential',
  'response:before': 'sequential',
  'agent:before_start': 'sequential',
  'compaction:before': 'sequential',
  'tool:before_call': 'sequential',
  'tool:result_persist': 'sequential',

  // Parallel (fire-and-forget)
  'message:after': 'parallel',
  'message:received': 'parallel',
  'message:sent': 'parallel',
  'response:after': 'parallel',
  'session:start': 'parallel',
  'session:end': 'parallel',
  'session:reset': 'parallel',
  'session:created': 'parallel',
  'agent:end': 'parallel',
  'compaction:after': 'parallel',
  'tool:after_call': 'parallel',
  'gateway:start': 'parallel',
  'gateway:stop': 'parallel',
  'error': 'parallel',
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createHooksService(): HooksService {
  const hooks = new Map<string, Hook>();
  let idCounter = 0;
  const hooksDir = getHooksDir();
  let currentSourcePath: string | null = null;
  let tracingEnabled = process.env.CLODDS_HOOK_TRACE === '1';
  let traceLimit = Math.max(
    10,
    Number.parseInt(process.env.CLODDS_HOOK_TRACE_LIMIT ?? '200', 10) || 200
  );
  const traces: HookTraceEntry[] = [];
  const traceFilePath = process.env.CLODDS_HOOK_TRACE_FILE || join(hooksDir, 'trace.log');
  const activeRuns = new Map<string, { ctx: HookContext; controller: AbortController; startedAt: number }>();
  const stateStorePath = getHookStateStorePath();
  let stateStore = loadHookStateStore(stateStorePath);

  // Ensure hooks directory exists
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  /**
   * Check if requirements are met
   */
  function checkRequirements(requirements: HookRequirements): { met: boolean; missing: string[] } {
    const missing: string[] = [];

    // Check required binaries
    if (requirements.bins) {
      for (const bin of requirements.bins) {
        try {
          // Use execFileSync to prevent command injection
          require('child_process').execFileSync('which', [bin], { stdio: 'ignore' });
        } catch {
          missing.push(`bin:${bin}`);
        }
      }
    }

    // Check required env vars
    if (requirements.env) {
      for (const envVar of requirements.env) {
        if (!process.env[envVar]) {
          missing.push(`env:${envVar}`);
        }
      }
    }

    // Check OS
    if (requirements.os) {
      const platform = process.platform;
      if (!requirements.os.includes(platform)) {
        missing.push(`os:${platform}`);
      }
    }

    return { met: missing.length === 0, missing };
  }

  /**
   * Get matching hooks for an event
   */
  function getMatchingHooks(event: HookEvent, ctx: Partial<HookContext>): Hook[] {
    return Array.from(hooks.values())
      .filter((h) => h.event === event && h.enabled)
      .filter((h) => {
        if (!h.filter) return true;
        if (h.filter.channels && ctx.message && !h.filter.channels.includes(ctx.message.platform)) return false;
        if (h.filter.users && ctx.message && !h.filter.users.includes(ctx.message.userId)) return false;
        if (h.filter.tools && ctx.toolName && !h.filter.tools.includes(ctx.toolName)) return false;
        if (h.filter.tools && !ctx.toolName) return false;
        return true;
      })
      .filter((h) => {
        if (!h.when) return true;
        return evaluateHookCondition(h.when, ctx);
      })
      .filter((h) => {
        if (!h.requirements) return true;
        return checkRequirements(h.requirements).met;
      })
      .sort((a, b) => b.priority - a.priority);
  }

  const service: HooksService = {
    register(event, fn, opts = {}) {
      const id = `hook_${++idCounter}`;
      const execution = opts.execution ?? EVENT_EXECUTION_MODES[event] ?? 'parallel';
      const sourcePath = opts.sourcePath ?? currentSourcePath ?? undefined;

      const hook: Hook = {
        id,
        name: opts.name,
        event,
        fn: fn as unknown as HookFn,
        priority: opts.priority ?? 0,
        execution,
        syncOnly: opts.syncOnly,
        filter: opts.filter,
        when: opts.when,
        requirements: opts.requirements,
        enabled: true,
        sourcePath,
      };

      const persistedEnabled = sourcePath ? getHookSourceEnabled(sourcePath) : undefined;
      if (persistedEnabled === false) {
        hook.enabled = false;
      }

      hooks.set(id, hook);
      if (sourcePath && persistedEnabled === undefined) {
        setHookSourceEnabled(sourcePath, true);
      }

      logger.debug({ id, event, name: opts.name }, 'Hook registered');
      return id;
    },

    unregister(id) {
      const existed = hooks.delete(id);
      if (existed) {
        logger.debug({ id }, 'Hook unregistered');
      }
      return existed;
    },

    setEnabled(id, enabled) {
      const hook = hooks.get(id);
      if (!hook) return false;
      hook.enabled = enabled;
      if (hook.sourcePath) {
        setHookSourceEnabled(hook.sourcePath, enabled);
      }
      logger.debug({ id, enabled }, 'Hook enabled state changed');
      return true;
    },

    async trigger(event, partialCtx) {
      const { ctx, runId, controller } = createRunContext(event, partialCtx);

      const matching = getMatchingHooks(event, ctx);
      const execution = EVENT_EXECUTION_MODES[event] ?? 'parallel';

      if (execution === 'parallel') {
        await Promise.all(
          matching.map(async (hook) => {
            const startedAt = Date.now();
            try {
              if (ctx.abortSignal?.aborted || ctx.cancelled) return;
              const hookCtx = bindHookState(ctx, hook, true);
              await hook.fn(hookCtx);
              recordTrace(hook, event, startedAt, 'ok');
            } catch (error) {
              logger.error({ hookId: hook.id, error }, 'Hook error');
              recordTrace(hook, event, startedAt, 'error', error);
            }
          })
        );
      } else {
        // Sequential execution
        for (const hook of matching) {
          if (ctx.cancelled || ctx.abortSignal?.aborted) break;
          const startedAt = Date.now();
          try {
            const hookCtx = bindHookState(ctx, hook);
            await hook.fn(hookCtx);
            recordTrace(hook, event, startedAt, 'ok');
          } catch (error) {
            logger.error({ hookId: hook.id, error }, 'Hook error');
            recordTrace(hook, event, startedAt, 'error', error);
          }
        }
      }

      finalizeRun(runId, controller);
      return ctx;
    },

    async triggerWithResult<TResult>(
      event: HookEvent,
      partialCtx: Partial<HookContext>,
      mergeResults?: (results: TResult[]) => TResult
    ): Promise<{ ctx: HookContext; result: TResult | undefined }> {
      const { ctx, runId, controller } = createRunContext(event, partialCtx);

      const matching = getMatchingHooks(event, ctx);
      const results: TResult[] = [];

      // Always sequential for result-returning hooks
      for (const hook of matching) {
        if (ctx.cancelled || ctx.abortSignal?.aborted) break;
        const startedAt = Date.now();
        try {
          const hookCtx = bindHookState(ctx, hook);
          const result = await hook.fn(hookCtx);
          if (result !== undefined) {
            results.push(result as TResult);
          }
          recordTrace(hook, event, startedAt, 'ok');
        } catch (error) {
          logger.error({ hookId: hook.id, error }, 'Hook error');
          recordTrace(hook, event, startedAt, 'error', error);
        }
      }

      // Merge results if merger provided
      const finalResult = mergeResults && results.length > 0
        ? mergeResults(results)
        : results[results.length - 1]; // Default: last result wins

      finalizeRun(runId, controller);
      return { ctx, result: finalResult };
    },

    triggerSync(event, partialCtx) {
      const { ctx, runId, controller } = createRunContext(event, partialCtx);

      const matching = getMatchingHooks(event, ctx).filter(h => h.syncOnly !== false);

      for (const hook of matching) {
        if (ctx.cancelled || ctx.abortSignal?.aborted) break;
        const startedAt = Date.now();
        try {
          const hookCtx = bindHookState(ctx, hook);
          // Call synchronously (ignoring promises)
          hook.fn(hookCtx);
          recordTrace(hook, event, startedAt, 'ok');
        } catch (error) {
          logger.error({ hookId: hook.id, error }, 'Sync hook error');
          recordTrace(hook, event, startedAt, 'error', error);
        }
      }

      finalizeRun(runId, controller);
      return ctx;
    },

    list() {
      return Array.from(hooks.values());
    },

    get(id) {
      return hooks.get(id);
    },

    checkRequirements,

    async discover(directories) {
      let count = 0;

      for (const dir of directories) {
        if (!existsSync(dir)) continue;

        const entries = readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const hookDir = join(dir, entry.name);
          const metadataPath = join(hookDir, 'HOOK.md');
          const indexPath = join(hookDir, 'index.js');

          // Check for HOOK.md metadata
          if (!existsSync(metadataPath) && !existsSync(indexPath)) continue;

          try {
            // Try to load the hook
            if (existsSync(indexPath)) {
              currentSourcePath = hookDir;
              const hookModule = require(indexPath);
              if (typeof hookModule.register === 'function') {
                hookModule.register(service);
                count++;
                logger.info({ hook: entry.name }, 'Hook discovered and registered');
              }
            }
          } catch (error) {
            logger.warn({ hook: entry.name, error }, 'Failed to load hook');
          } finally {
            currentSourcePath = null;
          }
        }
      }

      return count;
    },

    async install(hookPath) {
      const hookName = basename(hookPath);
      const destDir = join(hooksDir, hookName);

      // Copy hook to hooks directory
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }

      // Simple copy (in production, would handle npm packages, git repos, etc.)
      const indexPath = join(hookPath, 'index.js');
      if (existsSync(indexPath)) {
        const content = readFileSync(indexPath, 'utf-8');
        writeFileSync(join(destDir, 'index.js'), content);
      }

      // Try to register
      await this.discover([hooksDir]);

      return hookName;
    },

    setTracingEnabled(enabled: boolean) {
      tracingEnabled = enabled;
    },

    setTraceLimit(limit: number) {
      traceLimit = Math.max(10, limit);
      if (traces.length > traceLimit) {
        traces.splice(0, traces.length - traceLimit);
      }
    },

    listTraces(limit?: number) {
      if (!tracingEnabled) return [];
      if (!limit || limit >= traces.length) {
        return [...traces];
      }
      return traces.slice(Math.max(0, traces.length - limit));
    },

    clearTraces() {
      traces.length = 0;
    },

    cancel(runId, reason) {
      const run = activeRuns.get(runId);
      if (!run) return false;
      run.ctx.cancelled = true;
      run.ctx.cancelledReason = reason;
      run.controller.abort(reason);
      return true;
    },

    listActiveRuns() {
      return Array.from(activeRuns.entries()).map(([runId, run]) => ({
        runId,
        event: run.ctx.event,
        startedAt: new Date(run.startedAt).toISOString(),
        cancelled: Boolean(run.ctx.cancelled || run.ctx.abortSignal?.aborted),
        reason: run.ctx.cancelledReason,
      }));
    },

    getState(hookKey, key) {
      const entry = stateStore.data[hookKey];
      if (!entry) return undefined;
      if (!key) return { ...entry };
      return entry[key];
    },

    setState(hookKey, key, value) {
      if (!stateStore.data[hookKey]) {
        const storeKeys = Object.keys(stateStore.data);
        if (storeKeys.length >= 10000) {
          delete stateStore.data[storeKeys[0]];
        }
        stateStore.data[hookKey] = {};
      }
      stateStore.data[hookKey][key] = value;
      persistHookStateStore();
    },

    clearState(hookKey, key) {
      if (!stateStore.data[hookKey]) return;
      if (key) {
        delete stateStore.data[hookKey][key];
      } else {
        delete stateStore.data[hookKey];
      }
      persistHookStateStore();
    },
  };

  function createRunContext(
    event: HookEvent,
    partialCtx: Partial<HookContext>
  ): { ctx: HookContext; runId: string; controller: AbortController } {
    const runId = generateSecureId('hookrun');
    const controller = new AbortController();
    const ctx: HookContext = {
      event,
      data: {},
      ...partialCtx,
      runId,
      abortSignal: controller.signal,
    };
    activeRuns.set(runId, { ctx, controller, startedAt: Date.now() });
    controller.signal.addEventListener('abort', () => {
      ctx.cancelled = true;
      ctx.cancelledReason = ctx.cancelledReason ?? 'cancelled';
    }, { once: true });
    return { ctx, runId, controller };
  }

  function finalizeRun(runId: string, _controller: AbortController): void {
    activeRuns.delete(runId);
  }

  function recordTrace(
    hook: Hook,
    event: HookEvent,
    startedAtMs: number,
    status: 'ok' | 'error',
    error?: unknown
  ): void {
    if (!tracingEnabled) return;
    const entry: HookTraceEntry = {
      id: generateSecureId('trace'),
      hookId: hook.id,
      hookName: hook.name,
      event,
      execution: hook.execution,
      startedAt: new Date(startedAtMs).toISOString(),
      durationMs: Math.max(0, Date.now() - startedAtMs),
      status,
      error: error instanceof Error ? error.message : error ? String(error) : undefined,
    };
    traces.push(entry);
    if (traces.length > traceLimit) {
      traces.splice(0, traces.length - traceLimit);
    }
    writeTraceToFile(entry);
  }

  function writeTraceToFile(entry: HookTraceEntry): void {
    if (!traceFilePath) return;
    try {
      const line = `${JSON.stringify(entry)}\n`;
      appendFileSync(traceFilePath, line);
      rotateTraceFileIfNeeded();
    } catch (error) {
      logger.warn({ error }, 'Failed to write hook trace file');
    }
  }

  function rotateTraceFileIfNeeded(): void {
    try {
      const stats = statSync(traceFilePath);
      const maxBytes = 5 * 1024 * 1024; // 5MB
      if (stats.size < maxBytes) return;
      const rotated = `${traceFilePath}.${Date.now()}`;
      renameSync(traceFilePath, rotated);
    } catch {
      // ignore rotation errors
    }
  }

  function bindHookState(ctx: HookContext, hook: Hook, copy = false): HookContext {
    const hookStateKey = resolveHookStateKey(hook.sourcePath || hook.name || hook.id);
    const bound: HookContext = copy ? { ...ctx } : ctx;
    bound.hookId = hook.id;
    bound.hookName = hook.name;
    bound.hookStateKey = hookStateKey;
    bound.getState = (key: string, defaultValue?: unknown) => {
      const entry = stateStore.data[hookStateKey];
      if (entry && Object.prototype.hasOwnProperty.call(entry, key)) {
        return entry[key];
      }
      return defaultValue;
    };
    bound.setState = (key: string, value: unknown) => {
      if (!stateStore.data[hookStateKey]) {
        const storeKeys = Object.keys(stateStore.data);
        if (storeKeys.length >= 10000) {
          delete stateStore.data[storeKeys[0]];
        }
        stateStore.data[hookStateKey] = {};
      }
      stateStore.data[hookStateKey][key] = value;
      persistHookStateStore();
    };
    bound.clearState = (key?: string) => {
      if (!stateStore.data[hookStateKey]) return;
      if (key) {
        delete stateStore.data[hookStateKey][key];
      } else {
        delete stateStore.data[hookStateKey];
      }
      persistHookStateStore();
    };
    return bound;
  }

  function persistHookStateStore(): void {
    stateStore.updatedAt = new Date().toISOString();
    saveHookStateStore(stateStorePath, stateStore);
  }

  function evaluateHookCondition(condition: HookCondition, ctx: Partial<HookContext>): boolean {
    if ('any' in condition || 'all' in condition || 'not' in condition) {
      const anyResult = condition.any ? condition.any.some((c) => evaluateHookCondition(c, ctx)) : undefined;
      const allResult = condition.all ? condition.all.every((c) => evaluateHookCondition(c, ctx)) : undefined;
      const notResult = condition.not ? !evaluateHookCondition(condition.not, ctx) : undefined;
      const results = [anyResult, allResult, notResult].filter((v) => v !== undefined) as boolean[];
      return results.length > 0 ? results.every(Boolean) : true;
    }

    const fieldCondition = condition as Extract<HookCondition, { field: string }>;
    const fieldValue = getConditionFieldValue(fieldCondition.field, ctx);
    if (fieldValue === undefined || fieldValue === null) return false;

    switch (fieldCondition.op) {
      case 'eq':
        return fieldValue === fieldCondition.value;
      case 'neq':
        return fieldValue !== fieldCondition.value;
      case 'in':
        return Array.isArray(fieldCondition.value) && fieldCondition.value.includes(String(fieldValue));
      case 'contains':
        return String(fieldValue).includes(String(fieldCondition.value));
      case 'startsWith':
        return String(fieldValue).startsWith(String(fieldCondition.value));
      case 'endsWith':
        return String(fieldValue).endsWith(String(fieldCondition.value));
      case 'regex':
        try {
          const pattern = Array.isArray(fieldCondition.value)
            ? fieldCondition.value.join('|')
            : fieldCondition.value;
          if (pattern.length > 1000) return false;
          return new RegExp(pattern).test(String(fieldValue));
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  function getConditionFieldValue(
    field: 'channel' | 'userId' | 'agentId' | 'toolName' | 'messageText' | 'event',
    ctx: Partial<HookContext>
  ): string | undefined {
    switch (field) {
      case 'channel':
        return ctx.message?.platform;
      case 'userId':
        return ctx.message?.userId;
      case 'agentId':
        return (ctx as Partial<AgentHookContext>).agentId;
      case 'toolName':
        return ctx.toolName;
      case 'messageText':
        return ctx.message?.text;
      case 'event':
        return ctx.event;
      default:
        return undefined;
    }
  }

  return service;
}

// =============================================================================
// HELPER FUNCTIONS FOR COMMON HOOK PATTERNS
// =============================================================================

/**
 * Create a tool interception hook
 */
export function createToolHook(
  service: HooksService,
  toolName: string | RegExp,
  handlers: {
    before?: (ctx: ToolHookContext) => Promise<ToolCallResult | void> | ToolCallResult | void;
    after?: (ctx: ToolHookContext) => Promise<void> | void;
  }
): string[] {
  const ids: string[] = [];
  const matchTool = (name: string) =>
    typeof toolName === 'string' ? name === toolName : toolName.test(name);

  if (handlers.before) {
    ids.push(service.register<ToolHookContext, ToolCallResult>(
      'tool:before_call',
      async (ctx) => {
        if (!matchTool(ctx.toolName)) return;
        return handlers.before!(ctx);
      },
      { name: `tool_hook_before_${toolName}` }
    ));
  }

  if (handlers.after) {
    ids.push(service.register<ToolHookContext>(
      'tool:after_call',
      async (ctx) => {
        if (!matchTool(ctx.toolName)) return;
        return handlers.after!(ctx);
      },
      { name: `tool_hook_after_${toolName}` }
    ));
  }

  return ids;
}

/**
 * Create a message filter hook
 */
export function createMessageFilter(
  service: HooksService,
  filter: (ctx: MessageSendingContext) => boolean,
  transform?: (content: string, ctx: MessageSendingContext) => string
): string {
  return service.register<MessageSendingContext, MessageSendingResult>(
    'message:sending',
    (ctx) => {
      if (!filter(ctx)) {
        return { cancel: true };
      }
      if (transform) {
        return { content: transform(ctx.content, ctx) };
      }
      return;
    },
    { name: 'message_filter' }
  );
}

/**
 * Create an agent system prompt injector
 */
export function createSystemPromptInjector(
  service: HooksService,
  inject: (ctx: AgentHookContext) => string | undefined
): string {
  return service.register<AgentHookContext, AgentStartResult>(
    'agent:before_start',
    (ctx) => {
      const extra = inject(ctx);
      if (extra) {
        return {
          systemPrompt: ctx.systemPrompt ? `${ctx.systemPrompt}\n\n${extra}` : extra,
        };
      }
      return;
    },
    { name: 'system_prompt_injector' }
  );
}

// =============================================================================
// EXPORTS
// =============================================================================

export const hooks = createHooksService();

export function getHooksDir(): string {
  return join(homedir(), '.clodds', 'hooks');
}

export function getHooksStatePath(): string {
  return join(getHooksDir(), 'hooks.json');
}

export function getHookStateStorePath(): string {
  return join(getHooksDir(), 'hook-state.json');
}

export function resolveHookStateKey(input: string): string {
  if (!input) return input;
  if (input.startsWith('~')) {
    return join(homedir(), input.slice(1));
  }
  if (input.includes('/') || input.includes('\\')) {
    return input;
  }
  return join(getHooksDir(), input);
}

export function loadHookStateStore(pathOverride?: string): HookStateStore {
  const path = pathOverride || getHookStateStorePath();
  if (!existsSync(path)) {
    return { version: 1, data: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as HookStateStore;
    if (!parsed.data) {
      return { version: 1, data: {} };
    }
    return parsed;
  } catch (error) {
    logger.warn({ error }, 'Failed to load hook state store');
    return { version: 1, data: {} };
  }
}

export function saveHookStateStore(pathOverride: string | undefined, store: HookStateStore): void {
  const path = pathOverride || getHookStateStorePath();
  try {
    if (!existsSync(getHooksDir())) {
      mkdirSync(getHooksDir(), { recursive: true });
    }
    writeFileSync(
      path,
      JSON.stringify(
        {
          version: store.version || 1,
          data: store.data || {},
          updatedAt: store.updatedAt,
        },
        null,
        2
      )
    );
  } catch (error) {
    logger.warn({ error }, 'Failed to save hook state store');
  }
}

export function loadHooksState(): HookStateFile {
  const statePath = getHooksStatePath();
  if (!existsSync(statePath)) {
    return { version: 1, sources: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf-8')) as HookStateFile;
    if (!parsed.sources) {
      return { version: 1, sources: {} };
    }
    return parsed;
  } catch (error) {
    logger.warn({ error }, 'Failed to load hooks state');
    return { version: 1, sources: {} };
  }
}

export function saveHooksState(state: HookStateFile): void {
  try {
    const statePath = getHooksStatePath();
    if (!existsSync(getHooksDir())) {
      mkdirSync(getHooksDir(), { recursive: true });
    }
    writeFileSync(
      statePath,
      JSON.stringify(
        {
          version: state.version || 1,
          sources: state.sources || {},
        },
        null,
        2
      )
    );
  } catch (error) {
    logger.warn({ error }, 'Failed to save hooks state');
  }
}

export function getHookSourceEnabled(sourcePath: string): boolean | undefined {
  const state = loadHooksState();
  const entry = state.sources[sourcePath];
  return entry ? entry.enabled : undefined;
}

export function setHookSourceEnabled(sourcePath: string, enabled: boolean): void {
  const state = loadHooksState();
  state.sources[sourcePath] = {
    enabled,
    updatedAt: new Date().toISOString(),
  };
  saveHooksState(state);
}

export function removeHookSourceState(sourcePath: string): void {
  const state = loadHooksState();
  if (state.sources[sourcePath]) {
    delete state.sources[sourcePath];
    saveHooksState(state);
  }
}
