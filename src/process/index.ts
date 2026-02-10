/**
 * Process Module - Clawdbot-style process management
 *
 * Features:
 * - Spawn and manage child processes
 * - Process pools
 * - Signal handling
 * - Output streaming
 * - Timeout management
 */

import { spawn, exec, execSync, execFileSync, ChildProcess, SpawnOptions, ExecOptions } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  duration: number;
  killed: boolean;
  timedOut: boolean;
}

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
  shell?: boolean | string;
  uid?: number;
  gid?: number;
  killSignal?: NodeJS.Signals;
  detached?: boolean;
}

export interface StreamingProcess extends EventEmitter {
  pid: number | undefined;
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
  wait(): Promise<ProcessResult>;
}

export interface ProcessPoolOptions {
  maxConcurrent?: number;
  idleTimeout?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB
const DEFAULT_KILL_SIGNAL: NodeJS.Signals = 'SIGTERM';

// =============================================================================
// HELPERS
// =============================================================================

function parseCommand(command: string): { cmd: string; args: string[] } {
  // Simple shell-style parsing
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const char of command) {
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === ' ' || char === '\t') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  return {
    cmd: parts[0] || '',
    args: parts.slice(1),
  };
}

// =============================================================================
// PROCESS EXECUTION
// =============================================================================

/** Execute a command and wait for result */
export async function execute(command: string, options: ProcessOptions = {}): Promise<ProcessResult> {
  const startTime = Date.now();
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const killSignal = options.killSignal ?? DEFAULT_KILL_SIGNAL;

  return new Promise((resolve) => {
    let timedOut = false;
    let killed = false;

    const execOptions: ExecOptions = {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      timeout,
      maxBuffer,
      shell: typeof options.shell === 'string' ? options.shell : undefined,
      uid: options.uid,
      gid: options.gid,
      killSignal,
    };

    const child = exec(command, execOptions, (error, stdout, stderr) => {
      const duration = Date.now() - startTime;

      if (error && 'killed' in error) {
        killed = error.killed ?? false;
        timedOut = (error.killed ?? false) && error.signal === killSignal;
      }

      resolve({
        exitCode: error ? (error as { code?: number }).code ?? 1 : 0,
        signal: (error?.signal as NodeJS.Signals) ?? null,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        duration,
        killed,
        timedOut,
      });
    });

    logger.debug({ command: command.slice(0, 100), pid: child.pid }, 'Process started');
  });
}

/** Execute a command synchronously */
export function executeSync(command: string, options: ProcessOptions = {}): ProcessResult {
  const startTime = Date.now();

  try {
    const shellOption = typeof options.shell === 'string'
      ? options.shell
      : (options.shell !== false ? '/bin/sh' : undefined);

    const stdout = execSync(command, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
      shell: shellOption,
      uid: options.uid,
      gid: options.gid,
      encoding: 'utf-8',
    });

    return {
      exitCode: 0,
      signal: null,
      stdout: stdout.toString(),
      stderr: '',
      duration: Date.now() - startTime,
      killed: false,
      timedOut: false,
    };
  } catch (error: unknown) {
    const err = error as { status?: number; signal?: string; stdout?: Buffer; stderr?: Buffer; killed?: boolean };
    return {
      exitCode: err.status ?? 1,
      signal: (err.signal as NodeJS.Signals) || null,
      stdout: err.stdout?.toString() || '',
      stderr: err.stderr?.toString() || '',
      duration: Date.now() - startTime,
      killed: err.killed || false,
      timedOut: false,
    };
  }
}

/** Spawn a process with streaming output */
export function spawnProcess(command: string, args: string[] = [], options: ProcessOptions = {}): StreamingProcess {
  const emitter = new EventEmitter() as StreamingProcess;
  const startTime = Date.now();

  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    shell: options.shell,
    uid: options.uid,
    gid: options.gid,
    detached: options.detached,
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  const child = spawn(command, args, spawnOptions);

  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  let stdout = '';
  let stderr = '';
  let killed = false;
  let timedOut = false;
  let exitResult: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  let exitError: Error | null = null;

  let timeoutId: NodeJS.Timeout | undefined;
  if (options.timeout) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill(options.killSignal ?? DEFAULT_KILL_SIGNAL);
    }, options.timeout);
  }

  child.stdout?.on('data', (data: Buffer) => {
    const str = data.toString();
    if (stdout.length < maxBuffer) {
      stdout += str.slice(0, maxBuffer - stdout.length);
    }
    emitter.emit('stdout', str);
  });

  child.stderr?.on('data', (data: Buffer) => {
    const str = data.toString();
    if (stderr.length < maxBuffer) {
      stderr += str.slice(0, maxBuffer - stderr.length);
    }
    emitter.emit('stderr', str);
  });

  child.on('exit', (code, signal) => {
    if (timeoutId) clearTimeout(timeoutId);
    exitResult = { code, signal };
    emitter.emit('exit', code, signal);
  });

  child.on('error', (error) => {
    if (timeoutId) clearTimeout(timeoutId);
    exitError = error;
    emitter.emit('error', error);
  });

  emitter.pid = child.pid;
  emitter.stdin = child.stdin;
  emitter.stdout = child.stdout;
  emitter.stderr = child.stderr;

  emitter.kill = (signal = DEFAULT_KILL_SIGNAL) => {
    killed = true;
    return child.kill(signal);
  };

  emitter.wait = () => new Promise((resolve) => {
    if (exitResult) {
      return resolve({
        exitCode: exitResult.code,
        signal: exitResult.signal,
        stdout,
        stderr,
        duration: Date.now() - startTime,
        killed,
        timedOut,
      });
    }
    if (exitError) {
      return resolve({
        exitCode: 1,
        signal: null,
        stdout,
        stderr: stderr + '\n' + exitError.message,
        duration: Date.now() - startTime,
        killed,
        timedOut,
      });
    }

    emitter.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        duration: Date.now() - startTime,
        killed,
        timedOut,
      });
    });

    emitter.once('error', (error: Error) => {
      resolve({
        exitCode: 1,
        signal: null,
        stdout,
        stderr: stderr + '\n' + error.message,
        duration: Date.now() - startTime,
        killed,
        timedOut,
      });
    });
  });

  logger.debug({ command, args, pid: child.pid }, 'Process spawned');

  return emitter;
}

/** Spawn from a command string */
export function spawnCommand(command: string, options: ProcessOptions = {}): StreamingProcess {
  if (options.shell !== false) {
    // Use shell to parse the command
    return spawnProcess(process.platform === 'win32' ? 'cmd' : '/bin/sh',
      process.platform === 'win32' ? ['/c', command] : ['-c', command],
      { ...options, shell: false }
    );
  }

  const { cmd, args } = parseCommand(command);
  return spawnProcess(cmd, args, options);
}

// =============================================================================
// PROCESS POOL
// =============================================================================

interface PooledProcess {
  process: StreamingProcess;
  busy: boolean;
  lastUsed: number;
}

export interface ProcessPool {
  execute(command: string, options?: ProcessOptions): Promise<ProcessResult>;
  spawn(command: string, args?: string[], options?: ProcessOptions): StreamingProcess;
  getStats(): { active: number; idle: number; total: number };
  shutdown(): Promise<void>;
}

export function createProcessPool(poolOptions: ProcessPoolOptions = {}): ProcessPool {
  const maxConcurrent = poolOptions.maxConcurrent ?? 10;
  const idleTimeout = poolOptions.idleTimeout ?? 60000;

  let activeCount = 0;
  const queue: Array<{ resolve: (p: StreamingProcess) => void; command: string; args: string[]; options: ProcessOptions }> = [];

  function processQueue() {
    while (queue.length > 0 && activeCount < maxConcurrent) {
      const item = queue.shift()!;
      activeCount++;
      const proc = spawnProcess(item.command, item.args, item.options);

      proc.on('exit', () => {
        activeCount--;
        processQueue();
      });

      item.resolve(proc);
    }
  }

  return {
    async execute(command, options = {}) {
      const proc = await new Promise<StreamingProcess>((resolve) => {
        const { cmd, args } = parseCommand(command);
        if (activeCount < maxConcurrent) {
          activeCount++;
          const p = spawnProcess(cmd, args, options);
          p.on('exit', () => {
            activeCount--;
            processQueue();
          });
          resolve(p);
        } else {
          queue.push({ resolve, command: cmd, args, options });
        }
      });

      return proc.wait();
    },

    spawn(command, args = [], options = {}) {
      if (activeCount >= maxConcurrent) {
        throw new Error('Process pool at capacity');
      }

      activeCount++;
      const proc = spawnProcess(command, args, options);

      proc.on('exit', () => {
        activeCount--;
        processQueue();
      });

      return proc;
    },

    getStats() {
      return {
        active: activeCount,
        idle: maxConcurrent - activeCount,
        total: maxConcurrent,
      };
    },

    async shutdown() {
      // Clear queue
      queue.length = 0;
      // Wait for active processes (they'll be orphaned)
      logger.info({ active: activeCount }, 'Process pool shutdown');
    },
  };
}

// =============================================================================
// SIGNAL HANDLING
// =============================================================================

type SignalHandler = () => void | Promise<void>;

const signalHandlers = new Map<NodeJS.Signals, SignalHandler[]>();
let signalHandlersInstalled = false;

function installSignalHandlers() {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

  for (const signal of signals) {
    process.on(signal, async () => {
      const handlers = signalHandlers.get(signal) || [];
      logger.info({ signal, handlers: handlers.length }, 'Signal received');

      for (const handler of handlers) {
        try {
          await handler();
        } catch (error) {
          logger.error({ signal, error }, 'Signal handler error');
        }
      }

      // Re-raise signal for default handling
      process.kill(process.pid, signal);
    });
  }
}

/** Register a signal handler */
export function onSignal(signal: NodeJS.Signals, handler: SignalHandler): () => void {
  installSignalHandlers();

  const handlers = signalHandlers.get(signal) || [];
  handlers.push(handler);
  signalHandlers.set(signal, handlers);

  // Return unsubscribe function
  return () => {
    const handlers = signalHandlers.get(signal) || [];
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  };
}

/** Register cleanup handler for graceful shutdown */
export function onShutdown(handler: SignalHandler): () => void {
  const unsub1 = onSignal('SIGINT', handler);
  const unsub2 = onSignal('SIGTERM', handler);

  return () => {
    unsub1();
    unsub2();
  };
}

// =============================================================================
// UTILITIES
// =============================================================================

/** Check if a command exists */
export function commandExists(command: string): boolean {
  try {
    // Use execFileSync with array args to prevent command injection
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Get current process info */
export function getProcessInfo(): { pid: number; ppid: number; uid: number; gid: number; cwd: string; memory: NodeJS.MemoryUsage; uptime: number } {
  return {
    pid: process.pid,
    ppid: process.ppid,
    uid: process.getuid?.() ?? 0,
    gid: process.getgid?.() ?? 0,
    cwd: process.cwd(),
    memory: process.memoryUsage(),
    uptime: process.uptime(),
  };
}

/** Kill a process tree */
export function killTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}
