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
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
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
  };
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
  const hooksDir = join(homedir(), '.clodds', 'hooks');

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
          require('child_process').execSync(`which ${bin}`, { stdio: 'ignore' });
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
        return true;
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

      hooks.set(id, {
        id,
        name: opts.name,
        event,
        fn: fn as unknown as HookFn,
        priority: opts.priority ?? 0,
        execution,
        syncOnly: opts.syncOnly,
        filter: opts.filter,
        requirements: opts.requirements,
        enabled: true,
      });

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
      logger.debug({ id, enabled }, 'Hook enabled state changed');
      return true;
    },

    async trigger(event, partialCtx) {
      const ctx: HookContext = {
        event,
        data: {},
        ...partialCtx,
      };

      const matching = getMatchingHooks(event, ctx);
      const execution = EVENT_EXECUTION_MODES[event] ?? 'parallel';

      if (execution === 'parallel') {
        // Fire all hooks in parallel, don't wait
        await Promise.all(
          matching.map(async (hook) => {
            try {
              await hook.fn(ctx);
            } catch (error) {
              logger.error({ hookId: hook.id, error }, 'Hook error');
            }
          })
        );
      } else {
        // Sequential execution
        for (const hook of matching) {
          if (ctx.cancelled) break;
          try {
            await hook.fn(ctx);
          } catch (error) {
            logger.error({ hookId: hook.id, error }, 'Hook error');
          }
        }
      }

      return ctx;
    },

    async triggerWithResult<TResult>(
      event: HookEvent,
      partialCtx: Partial<HookContext>,
      mergeResults?: (results: TResult[]) => TResult
    ): Promise<{ ctx: HookContext; result: TResult | undefined }> {
      const ctx: HookContext = {
        event,
        data: {},
        ...partialCtx,
      };

      const matching = getMatchingHooks(event, ctx);
      const results: TResult[] = [];

      // Always sequential for result-returning hooks
      for (const hook of matching) {
        if (ctx.cancelled) break;
        try {
          const result = await hook.fn(ctx);
          if (result !== undefined) {
            results.push(result as TResult);
          }
        } catch (error) {
          logger.error({ hookId: hook.id, error }, 'Hook error');
        }
      }

      // Merge results if merger provided
      const finalResult = mergeResults && results.length > 0
        ? mergeResults(results)
        : results[results.length - 1]; // Default: last result wins

      return { ctx, result: finalResult };
    },

    triggerSync(event, partialCtx) {
      const ctx: HookContext = {
        event,
        data: {},
        ...partialCtx,
      };

      const matching = getMatchingHooks(event, ctx).filter(h => h.syncOnly !== false);

      for (const hook of matching) {
        if (ctx.cancelled) break;
        try {
          // Call synchronously (ignoring promises)
          hook.fn(ctx);
        } catch (error) {
          logger.error({ hookId: hook.id, error }, 'Sync hook error');
        }
      }

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
              const hookModule = require(indexPath);
              if (typeof hookModule.register === 'function') {
                hookModule.register(service);
                count++;
                logger.info({ hook: entry.name }, 'Hook discovered and registered');
              }
            }
          } catch (error) {
            logger.warn({ hook: entry.name, error }, 'Failed to load hook');
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
  };

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
