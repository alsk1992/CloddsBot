/**
 * LLM Task Runner Extension
 * Executes complex multi-step tasks using LLM-based planning and execution
 *
 * Features:
 * - Task decomposition and planning
 * - Parallel and sequential execution
 * - Progress tracking and reporting
 * - Error recovery and retry logic
 * - State persistence
 */

import { logger } from '../../utils/logger';
import type { ProviderManager } from '../../providers/index';
import * as fs from 'fs';
import * as path from 'path';

export interface TaskDefinition {
  id: string;
  name: string;
  description: string;
  type: 'atomic' | 'composite' | 'parallel';
  dependencies?: string[];
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  subtasks?: TaskDefinition[];
  executor?: string;
  maxRetries?: number;
  timeout?: number;
}

export interface TaskResult {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime?: number;
  endTime?: number;
  output?: unknown;
  error?: string;
  attempts: number;
  subtaskResults?: TaskResult[];
}

export interface TaskRunnerConfig {
  /** Directory for task state persistence */
  stateDir?: string;
  /** Maximum concurrent tasks */
  maxConcurrent?: number;
  /** Default timeout in ms */
  defaultTimeout?: number;
  /** Default max retries */
  defaultMaxRetries?: number;
  /** Planning model */
  planningModel?: string;
  /** Execution model */
  executionModel?: string;
}

export interface TaskExecutor {
  name: string;
  execute: (task: TaskDefinition, context: TaskContext) => Promise<unknown>;
}

export interface TaskContext {
  runner: TaskRunner;
  provider: ProviderManager;
  variables: Record<string, unknown>;
  workDir: string;
}

// Built-in executors
const builtInExecutors: Map<string, TaskExecutor> = new Map();

// Shell executor with audit logging
builtInExecutors.set('shell', {
  name: 'shell',
  async execute(task, context) {
    const { execFile } = require('child_process');
    const command = task.input?.command as string;
    const args = (task.input?.args as string[]) || [];
    const cwd = (task.input?.cwd as string) || context.workDir;
    const startTime = Date.now();

    // Audit: Log execution attempt
    logger.info(
      { taskId: task.id, executor: 'shell', command, args, cwd },
      'Task runner: shell execution started'
    );

    // Security: Validate command is not empty and doesn't contain shell metacharacters
    if (!command || typeof command !== 'string') {
      logger.warn({ taskId: task.id }, 'Task runner: rejected empty command');
      throw new Error('Command must be a non-empty string');
    }
    const dangerousChars = /[;&|`$(){}[\]<>!\\]/;
    if (dangerousChars.test(command)) {
      logger.warn({ taskId: task.id, command }, 'Task runner: rejected dangerous command');
      throw new Error('Command contains potentially dangerous shell metacharacters');
    }
    for (const arg of args) {
      if (typeof arg !== 'string') {
        logger.warn({ taskId: task.id, arg }, 'Task runner: rejected non-string argument');
        throw new Error('All arguments must be strings');
      }
    }

    // Security: Only allow specific env vars, not arbitrary ones
    const allowedEnvKeys = ['PATH', 'HOME', 'USER', 'LANG', 'NODE_ENV', 'TZ'];
    const safeEnv: Record<string, string> = {};
    for (const key of allowedEnvKeys) {
      if (process.env[key]) safeEnv[key] = process.env[key]!;
    }

    return new Promise((resolve, reject) => {
      // Security: Use execFile instead of spawn with shell:true
      execFile(command, args, {
        cwd,
        env: safeEnv,
        maxBuffer: 10 * 1024 * 1024, // 10MB max output
        timeout: task.timeout || 60000, // Default 60s timeout
      }, (error: Error | null, stdout: string, stderr: string) => {
        const durationMs = Date.now() - startTime;
        if (error) {
          // Audit: Log failure
          logger.error(
            { taskId: task.id, command, durationMs, error: error.message },
            'Task runner: shell execution failed'
          );
          reject(new Error(`Command failed: ${stderr || error.message}`));
        } else {
          // Audit: Log success
          logger.info(
            { taskId: task.id, command, durationMs, stdoutLen: stdout.length },
            'Task runner: shell execution completed'
          );
          resolve({ stdout, stderr, exitCode: 0 });
        }
      });
    });
  },
});

// File executor with audit logging
builtInExecutors.set('file', {
  name: 'file',
  async execute(task, context) {
    const operation = task.input?.operation as string;
    const filePath = task.input?.path as string;
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(context.workDir, filePath);

    // Audit: Log file operation
    logger.info(
      { taskId: task.id, executor: 'file', operation, path: fullPath },
      'Task runner: file operation started'
    );

    try {
      let result: unknown;
      switch (operation) {
        case 'read':
          result = fs.readFileSync(fullPath, 'utf-8');
          logger.info({ taskId: task.id, operation, path: fullPath, size: (result as string).length }, 'Task runner: file read completed');
          return result;

        case 'write':
          const content = task.input?.content as string;
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content);
          logger.info({ taskId: task.id, operation, path: fullPath, size: content.length }, 'Task runner: file write completed');
          return { written: true, path: fullPath };

        case 'append':
          const appendContent = task.input?.content as string;
          fs.appendFileSync(fullPath, appendContent);
          logger.info({ taskId: task.id, operation, path: fullPath, size: appendContent.length }, 'Task runner: file append completed');
          return { appended: true, path: fullPath };

        case 'delete':
          fs.unlinkSync(fullPath);
          logger.info({ taskId: task.id, operation, path: fullPath }, 'Task runner: file delete completed');
          return { deleted: true, path: fullPath };

        case 'exists':
          const exists = fs.existsSync(fullPath);
          logger.info({ taskId: task.id, operation, path: fullPath, exists }, 'Task runner: file exists check completed');
          return { exists, path: fullPath };

        case 'list':
          const entries = fs.readdirSync(fullPath, { withFileTypes: true });
          logger.info({ taskId: task.id, operation, path: fullPath, count: entries.length }, 'Task runner: directory list completed');
          return entries.map(e => ({
            name: e.name,
            isDirectory: e.isDirectory(),
            isFile: e.isFile(),
          }));

        default:
          throw new Error(`Unknown file operation: ${operation}`);
      }
    } catch (err) {
      logger.error({ taskId: task.id, operation, path: fullPath, error: (err as Error).message }, 'Task runner: file operation failed');
      throw err;
    }
  },
});

// HTTP executor
builtInExecutors.set('http', {
  name: 'http',
  async execute(task, _context) {
    const url = task.input?.url as string;
    const method = (task.input?.method as string) || 'GET';
    const headers = (task.input?.headers as Record<string, string>) || {};
    const body = task.input?.body;

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const contentType = response.headers.get('content-type');
    const data = contentType?.includes('application/json')
      ? await response.json()
      : await response.text();

    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      data,
    };
  },
});

// LLM executor
builtInExecutors.set('llm', {
  name: 'llm',
  async execute(task, context) {
    const prompt = task.input?.prompt as string;
    const systemPrompt = task.input?.system as string;
    const model = (task.input?.model as string) || 'claude-3-5-sonnet-20241022';

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await context.provider.complete(messages, {
      model,
      maxTokens: task.input?.maxTokens as number,
    });

    return { response };
  },
});

// Safe property accessor - only allows simple dot-notation paths like "item.name" or "item.data.value"
function safeGetProperty(obj: unknown, path: string): unknown {
  if (!path || typeof path !== 'string') return obj;
  // Only allow alphanumeric property names with dots
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(path)) {
    throw new Error(`Invalid property path: ${path}`);
  }
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// Transform executor
builtInExecutors.set('transform', {
  name: 'transform',
  async execute(task, context) {
    const inputData = task.input?.data ?? context.variables[task.input?.source as string];
    const transform = task.input?.transform as string;

    switch (transform) {
      case 'json.parse':
        return JSON.parse(inputData as string);

      case 'json.stringify':
        return JSON.stringify(inputData, null, 2);

      case 'split':
        const delimiter = (task.input?.delimiter as string) || '\n';
        return (inputData as string).split(delimiter);

      case 'join':
        const joiner = (task.input?.joiner as string) || '\n';
        return (inputData as string[]).join(joiner);

      case 'filter':
        // Security: Only allow simple property-based filtering
        // Example: { field: "status", operator: "eq", value: "active" }
        const filterField = task.input?.field as string;
        const filterOp = task.input?.operator as string;
        const filterValue = task.input?.value;
        if (!filterField || !filterOp) {
          throw new Error('filter requires field and operator (eq, neq, gt, lt, gte, lte, contains, startsWith, endsWith)');
        }
        return (inputData as unknown[]).filter((item) => {
          const val = safeGetProperty(item, filterField);
          switch (filterOp) {
            case 'eq': return val === filterValue;
            case 'neq': return val !== filterValue;
            case 'gt': return (val as number) > (filterValue as number);
            case 'lt': return (val as number) < (filterValue as number);
            case 'gte': return (val as number) >= (filterValue as number);
            case 'lte': return (val as number) <= (filterValue as number);
            case 'contains': return String(val).includes(String(filterValue));
            case 'startsWith': return String(val).startsWith(String(filterValue));
            case 'endsWith': return String(val).endsWith(String(filterValue));
            case 'truthy': return !!val;
            case 'falsy': return !val;
            default: throw new Error(`Unknown filter operator: ${filterOp}`);
          }
        });

      case 'map':
        // Security: Only allow simple property extraction
        // Example: { field: "name" } or { fields: ["id", "name"] }
        const mapField = task.input?.field as string;
        const mapFields = task.input?.fields as string[];
        if (mapField) {
          return (inputData as unknown[]).map((item) => safeGetProperty(item, mapField));
        } else if (mapFields && Array.isArray(mapFields)) {
          return (inputData as unknown[]).map((item) => {
            const result: Record<string, unknown> = {};
            for (const f of mapFields) {
              result[f] = safeGetProperty(item, f);
            }
            return result;
          });
        }
        throw new Error('map requires field or fields array');

      case 'reduce':
        // Security: Only allow simple sum/count/concat operations
        const reduceOp = task.input?.operation as string;
        const reduceField = task.input?.field as string;
        const initial = task.input?.initial;
        switch (reduceOp) {
          case 'sum':
            return (inputData as unknown[]).reduce(
              (acc, item) => (acc as number) + (safeGetProperty(item, reduceField) as number || 0),
              initial ?? 0
            );
          case 'count':
            return (inputData as unknown[]).length;
          case 'concat':
            return (inputData as unknown[]).reduce(
              (acc, item) => [...(acc as unknown[]), safeGetProperty(item, reduceField)],
              initial ?? []
            );
          case 'min':
            return Math.min(...(inputData as unknown[]).map(item => safeGetProperty(item, reduceField) as number));
          case 'max':
            return Math.max(...(inputData as unknown[]).map(item => safeGetProperty(item, reduceField) as number));
          default:
            throw new Error(`reduce requires operation: sum, count, concat, min, or max`);
        }

      default:
        throw new Error(`Unknown transform: ${transform}`);
    }
  },
});

export class TaskRunner {
  private config: TaskRunnerConfig;
  private provider: ProviderManager;
  private executors: Map<string, TaskExecutor>;
  private results: Map<string, TaskResult>;
  private variables: Record<string, unknown>;
  private runningTasks: Set<string>;
  private stateDir: string;

  constructor(config: TaskRunnerConfig, provider: ProviderManager) {
    this.config = config;
    this.provider = provider;
    this.executors = new Map(builtInExecutors);
    this.results = new Map();
    this.variables = {};
    this.runningTasks = new Set();
    this.stateDir = config.stateDir || path.join(process.env.HOME || '', '.clodds', 'task-runner');

    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }

  /**
   * Register a custom executor
   */
  registerExecutor(executor: TaskExecutor): void {
    this.executors.set(executor.name, executor);
    logger.info({ executor: executor.name }, 'Registered task executor');
  }

  /**
   * Plan tasks from a high-level goal
   */
  async planTasks(goal: string, context?: string): Promise<TaskDefinition[]> {
    const planningModel = this.config.planningModel || 'claude-3-5-sonnet-20241022';

    const systemPrompt = `You are a task planner. Given a high-level goal, break it down into concrete, executable tasks.

Available executors:
- shell: Execute shell commands (input: command, args?, cwd?, env?)
- file: File operations (input: operation, path, content?)
- http: HTTP requests (input: url, method?, headers?, body?)
- llm: LLM completions (input: prompt, system?, model?)
- transform: Data transformations (input: data, transform, ...)

Output a JSON array of TaskDefinition objects with this structure:
{
  "id": "unique-id",
  "name": "Human readable name",
  "description": "What this task does",
  "type": "atomic" | "composite" | "parallel",
  "executor": "executor-name",
  "input": { ... executor-specific input ... },
  "dependencies": ["id-of-dependency"],
  "subtasks": [ ... for composite/parallel types ... ]
}

Rules:
- Tasks with dependencies must list them
- Use parallel type when tasks can run concurrently
- Use composite type for sequential subtask groups
- Keep atomic tasks focused on a single action`;

    const userPrompt = context
      ? `Goal: ${goal}\n\nContext: ${context}`
      : `Goal: ${goal}`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ];
    const response = await this.provider.complete(messages, {
      model: planningModel,
      maxTokens: 4096,
    });

    // Extract JSON from response
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Failed to parse task plan from LLM response');
    }

    const tasks = JSON.parse(jsonMatch[0]) as TaskDefinition[];
    logger.info({ taskCount: tasks.length }, 'Generated task plan');

    return tasks;
  }

  /**
   * Execute a single task
   */
  async executeTask(task: TaskDefinition, workDir?: string): Promise<TaskResult> {
    const taskId = task.id;
    const timeout = task.timeout || this.config.defaultTimeout || 60000;
    const maxRetries = task.maxRetries || this.config.defaultMaxRetries || 3;

    // Check if already running
    if (this.runningTasks.has(taskId)) {
      throw new Error(`Task ${taskId} is already running`);
    }

    // Check dependencies
    if (task.dependencies) {
      for (const depId of task.dependencies) {
        const depResult = this.results.get(depId);
        if (!depResult || depResult.status !== 'completed') {
          throw new Error(`Dependency ${depId} not completed`);
        }
      }
    }

    this.runningTasks.add(taskId);

    const result: TaskResult = {
      taskId,
      status: 'running',
      startTime: Date.now(),
      attempts: 0,
    };

    this.results.set(taskId, result);

    const context: TaskContext = {
      runner: this,
      provider: this.provider,
      variables: this.variables,
      workDir: workDir || process.cwd(),
    };

    try {
      logger.info({ taskId, name: task.name }, 'Starting task');

      if (task.type === 'parallel' && task.subtasks) {
        // Execute subtasks in parallel
        const subtaskPromises = task.subtasks.map(st => this.executeTask(st, workDir));
        result.subtaskResults = await Promise.all(subtaskPromises);
        result.output = result.subtaskResults.map(r => r.output);
      } else if (task.type === 'composite' && task.subtasks) {
        // Execute subtasks sequentially
        result.subtaskResults = [];
        for (const subtask of task.subtasks) {
          const subtaskResult = await this.executeTask(subtask, workDir);
          result.subtaskResults.push(subtaskResult);
        }
        result.output = result.subtaskResults.map(r => r.output);
      } else if (task.executor) {
        // Execute atomic task with retries
        const executor = this.executors.get(task.executor);
        if (!executor) {
          throw new Error(`Unknown executor: ${task.executor}`);
        }

        let lastError: Error | null = null;
        while (result.attempts < maxRetries) {
          result.attempts++;

          try {
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Task timeout')), timeout)
            );

            result.output = await Promise.race([
              executor.execute(task, context),
              timeoutPromise,
            ]);

            // Store output in variables
            this.variables[taskId] = result.output;
            lastError = null;
            break;
          } catch (error) {
            lastError = error as Error;
            logger.warn({ taskId, attempt: result.attempts, error }, 'Task attempt failed');

            if (result.attempts < maxRetries) {
              // Exponential backoff
              await new Promise(r => setTimeout(r, Math.pow(2, result.attempts) * 1000));
            }
          }
        }

        if (lastError) {
          throw lastError;
        }
      } else {
        throw new Error('Task has no executor or subtasks');
      }

      result.status = 'completed';
      result.endTime = Date.now();
      logger.info({
        taskId,
        name: task.name,
        duration: result.endTime - result.startTime!,
      }, 'Task completed');
    } catch (error) {
      result.status = 'failed';
      result.error = (error as Error).message;
      result.endTime = Date.now();
      logger.error({ taskId, name: task.name, error }, 'Task failed');
    } finally {
      this.runningTasks.delete(taskId);
      this.saveState();
    }

    return result;
  }

  /**
   * Execute multiple tasks respecting dependencies
   */
  async executeTasks(tasks: TaskDefinition[], workDir?: string): Promise<Map<string, TaskResult>> {
    // Build dependency graph
    const taskMap = new Map<string, TaskDefinition>();
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const task of tasks) {
      taskMap.set(task.id, task);
      inDegree.set(task.id, task.dependencies?.length || 0);
      dependents.set(task.id, []);
    }

    for (const task of tasks) {
      if (task.dependencies) {
        for (const dep of task.dependencies) {
          const deps = dependents.get(dep) || [];
          deps.push(task.id);
          dependents.set(dep, deps);
        }
      }
    }

    // Find initial tasks (no dependencies)
    const ready: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        ready.push(id);
      }
    }

    // Process tasks
    const maxConcurrent = this.config.maxConcurrent || 4;
    const running = new Set<string>();

    while (ready.length > 0 || running.size > 0) {
      // Start tasks up to concurrency limit
      while (ready.length > 0 && running.size < maxConcurrent) {
        const taskId = ready.shift()!;
        const task = taskMap.get(taskId)!;
        running.add(taskId);

        this.executeTask(task, workDir).then(result => {
          running.delete(taskId);

          if (result.status === 'completed') {
            // Update dependents
            for (const depId of dependents.get(taskId) || []) {
              const newDegree = (inDegree.get(depId) || 1) - 1;
              inDegree.set(depId, newDegree);
              if (newDegree === 0) {
                ready.push(depId);
              }
            }
          }
        });
      }

      // Wait a bit before checking again
      await new Promise(r => setTimeout(r, 100));
    }

    return this.results;
  }

  /**
   * Get task result
   */
  getResult(taskId: string): TaskResult | undefined {
    return this.results.get(taskId);
  }

  /**
   * Get all results
   */
  getAllResults(): Map<string, TaskResult> {
    return new Map(this.results);
  }

  /**
   * Get variable value
   */
  getVariable(name: string): unknown {
    return this.variables[name];
  }

  /**
   * Set variable value
   */
  setVariable(name: string, value: unknown): void {
    this.variables[name] = value;
  }

  /**
   * Cancel a running task
   */
  cancelTask(taskId: string): boolean {
    if (!this.runningTasks.has(taskId)) {
      return false;
    }

    const result = this.results.get(taskId);
    if (result) {
      result.status = 'cancelled';
      result.endTime = Date.now();
    }

    this.runningTasks.delete(taskId);
    return true;
  }

  /**
   * Reset runner state
   */
  reset(): void {
    this.results.clear();
    this.variables = {};
    this.runningTasks.clear();
  }

  /**
   * Save state to disk
   */
  private saveState(): void {
    const state = {
      results: Array.from(this.results.entries()),
      variables: this.variables,
      timestamp: Date.now(),
    };

    const statePath = path.join(this.stateDir, 'state.json');
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  }

  /**
   * Load state from disk
   */
  loadState(): boolean {
    const statePath = path.join(this.stateDir, 'state.json');

    if (!fs.existsSync(statePath)) {
      return false;
    }

    try {
      const data = fs.readFileSync(statePath, 'utf-8');
      const state = JSON.parse(data);

      this.results = new Map(state.results);
      this.variables = state.variables;

      logger.info({ taskCount: this.results.size }, 'Loaded task runner state');
      return true;
    } catch (error) {
      logger.warn({ error }, 'Failed to load task runner state');
      return false;
    }
  }
}

/**
 * Create a task runner instance
 */
export function createTaskRunner(
  config: TaskRunnerConfig,
  provider: ProviderManager
): TaskRunner {
  return new TaskRunner(config, provider);
}
