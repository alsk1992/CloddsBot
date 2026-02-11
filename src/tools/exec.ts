/**
 * Exec Tool - Clawdbot-style shell command execution
 *
 * Features:
 * - Execute commands in workspace directory
 * - Timeout support
 * - Background execution
 * - Elevated privileges (with approval)
 * - TTY support for interactive commands
 * - Approval gating via ExecApprovalsManager
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { logger } from '../utils/logger';
import {
  execApprovals,
  elevatedPermissions,
  assertSandboxPath,
} from '../permissions/index';

/** Exec options */
export interface ExecOptions {
  /** Working directory (defaults to workspace) */
  cwd?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Run in background */
  background?: boolean;
  /** Use elevated privileges */
  elevated?: boolean;
  /** Sandbox mode enforcement */
  sandboxMode?: 'off' | 'docker';
  /** Docker sandbox configuration */
  sandbox?: {
    image?: string;
    networkEnabled?: boolean;
    memory?: string;
    cpus?: number;
    readonly?: boolean;
  };
  /** Environment variables to add */
  env?: Record<string, string>;
  /** Max output size in bytes */
  maxOutput?: number;
  /** Agent ID for approval checking */
  agentId?: string;
  /** Session ID for approval tracking */
  sessionId?: string;
  /** Skip approval check (use with caution) */
  skipApproval?: boolean;
  /** Provider name for elevated permission checks */
  provider?: string;
  /** Sender ID for elevated permission checks */
  senderId?: string;
  /** Channel ID for elevated permission checks */
  channelId?: string;
  /** User roles for elevated permission checks */
  roles?: string[];
}

/** Exec result */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  /** Process ID if running in background */
  pid?: number;
}

/** Background process tracking */
interface BackgroundProcess {
  pid: number;
  command: string;
  startedAt: Date;
  process: ChildProcess;
  stdout: string[];
  stderr: string[];
}

const backgroundProcesses = new Map<number, BackgroundProcess>();
const MAX_BACKGROUND_PROCESSES = 50;
const MAX_BG_OUTPUT_BYTES = 512 * 1024; // 512KB per stream

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_OUTPUT = 1024 * 1024; // 1MB
const DEFAULT_DOCKER_IMAGE = process.env.CLODDS_SANDBOX_IMAGE || 'debian:bookworm-slim';

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeoutId =
      options.timeout && options.timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            setTimeout(() => {
              if (!child.killed) child.kill('SIGKILL');
            }, 1000);
          }, options.timeout)
        : null;

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({
        stdout: stdout.trim(),
        stderr: timedOut ? (stderr || 'Process timed out') : stderr.trim(),
        exitCode: timedOut ? 124 : code ?? 1,
      });
    });

    child.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}

async function runInDockerSandbox(
  command: string,
  cwd: string,
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
  timeout: number,
  sandbox: NonNullable<ExecOptions['sandbox']>
): Promise<ExecResult> {
  // Ensure cwd is within the workspace sandbox root.
  assertSandboxPath(cwd, { root: workspaceRoot, allowSymlinks: false });

  const image = sandbox.image || DEFAULT_DOCKER_IMAGE;
  const networkEnabled = sandbox.networkEnabled ?? false;
  const readonly = sandbox.readonly ?? false;

  // Basic docker availability check.
  const dockerInfo = await runProcess('docker', ['info'], { timeout: 5000 });
  if (dockerInfo.exitCode !== 0) {
    return {
      stdout: '',
      stderr: dockerInfo.stderr || 'Docker is not available',
      exitCode: 127,
      signal: null,
      timedOut: false,
    };
  }

  const containerName = `clodds-sbx-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const dockerArgs = [
    'run',
    '--name',
    containerName,
    '--rm',
    '-d',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '256',
    '-v',
    `${cwd}:/workspace${readonly ? ':ro' : ''}`,
    '-w',
    '/workspace',
    '--network',
    networkEnabled ? 'bridge' : 'none',
  ];

  if (sandbox.memory) {
    dockerArgs.push('-m', sandbox.memory);
  }
  if (sandbox.cpus) {
    dockerArgs.push('--cpus', String(sandbox.cpus));
  }

  dockerArgs.push(image, 'sh', '-lc', command);

  const started = await runProcess('docker', dockerArgs, { env, timeout: 15000 });
  if (started.exitCode !== 0) {
    return {
      stdout: started.stdout,
      stderr: started.stderr || 'Failed to start docker sandbox',
      exitCode: started.exitCode,
      signal: null,
      timedOut: false,
    };
  }

  let timedOut = false;
  let exitCode: number | null = null;

  const waitPromise = runProcess('docker', ['wait', containerName], {
    env,
    timeout: Math.max(timeout, 1000),
  });

  const timeoutPromise = new Promise<{ exitCode: number }>((resolve) => {
    setTimeout(async () => {
      timedOut = true;
      try {
        await runProcess('docker', ['kill', '-s', 'TERM', containerName], { env, timeout: 3000 });
      } catch {}
      setTimeout(() => {
        runProcess('docker', ['kill', '-s', 'KILL', containerName], {
          env,
          timeout: 3000,
        }).catch(() => {});
      }, 1000);
      resolve({ exitCode: 124 });
    }, timeout);
  });

  const waitResult = await Promise.race([waitPromise, timeoutPromise]);
  if ('stdout' in waitResult) {
    const parsed = parseInt(waitResult.stdout, 10);
    exitCode = Number.isFinite(parsed) ? parsed : waitResult.exitCode;
  } else {
    exitCode = waitResult.exitCode;
  }

  const logs = await runProcess('docker', ['logs', containerName], {
    env,
    timeout: 10000,
  });

  // Best-effort cleanup (container may already be removed).
  void runProcess('docker', ['rm', '-f', containerName], { env, timeout: 5000 });

  return {
    stdout: logs.stdout,
    stderr: logs.stderr,
    exitCode: exitCode ?? 1,
    signal: null,
    timedOut,
  };
}

export interface ExecTool {
  /** Execute a command */
  run(command: string, options?: ExecOptions): Promise<ExecResult>;

  /** List background processes */
  listBackground(): Array<{
    pid: number;
    command: string;
    startedAt: Date;
    running: boolean;
  }>;

  /** Get background process output */
  getOutput(pid: number): { stdout: string; stderr: string } | null;

  /** Kill a background process */
  kill(pid: number): boolean;

  /** Clear completed background processes */
  clearCompleted(): number;
}

export function createExecTool(workspaceDir: string, defaultAgentId: string = 'default'): ExecTool {
  return {
    async run(command, options = {}): Promise<ExecResult> {
      const cwd = options.cwd || workspaceDir;
      const timeout = options.timeout || DEFAULT_TIMEOUT;
      const maxOutput = options.maxOutput || DEFAULT_MAX_OUTPUT;
      const agentId = options.agentId || defaultAgentId;
      const sandboxMode =
        options.sandboxMode || (process.env.CLODDS_SANDBOX_MODE === 'docker' ? 'docker' : 'off');

      logger.info({ command, cwd, background: options.background, agentId }, 'Executing command');

      // =========================================================================
      // APPROVAL GATING - Check command against allowlist/approval system
      // =========================================================================
      if (!options.skipApproval) {
        const approvalResult = await execApprovals.checkCommand(agentId, command, {
          sessionId: options.sessionId,
          skipApproval: false,
        });

        if (!approvalResult.allowed) {
          logger.warn({ command, reason: approvalResult.reason, agentId }, 'Command blocked by approval system');
          return {
            stdout: '',
            stderr: `Command blocked: ${approvalResult.reason}`,
            exitCode: 126, // Standard "permission denied" exit code
            signal: null,
            timedOut: false,
          };
        }

        logger.debug({ command, reason: approvalResult.reason, entry: approvalResult.entry?.id }, 'Command approved');
      }

      // Build environment
      const env = {
        ...process.env,
        ...options.env,
      };

      // Handle elevated execution - requires explicit permission check
      let finalCommand = command;
      if (options.elevated) {
        // Check if elevated permissions are allowed for this user/context
        const canElevate = options.provider && options.senderId
          ? elevatedPermissions.isAllowed(
              options.provider,
              options.senderId,
              options.channelId,
              options.roles
            )
          : false;

        if (!canElevate) {
          logger.warn({ command, agentId }, 'Elevated execution denied - not authorized');
          return {
            stdout: '',
            stderr: 'Elevated execution denied: User not authorized for elevated privileges',
            exitCode: 126,
            signal: null,
            timedOut: false,
          };
        }

        // Require an explicit approval decision for the elevated form.
        const elevatedApproval = await execApprovals.checkCommand(agentId, `sudo ${command}`, {
          sessionId: options.sessionId,
          skipApproval: false,
        });

        if (!elevatedApproval.allowed) {
          logger.warn(
            { command, reason: elevatedApproval.reason, agentId },
            'Elevated command blocked by approval system'
          );
          return {
            stdout: '',
            stderr: `Elevated command blocked: ${elevatedApproval.reason}`,
            exitCode: 126,
            signal: null,
            timedOut: false,
          };
        }

        logger.warn(
          { command, agentId, senderId: options.senderId },
          'Elevated execution approved'
        );
        // Security: We intentionally do NOT interpolate `command` into a sudo
        // string (e.g. `sudo -n -- ${command}`) because that would be passed to
        // `sh -c` below, allowing shell metacharacters in `command` to escape
        // the sudo context.  Instead we spawn sudo directly with the command
        // passed to a nested `sh -c` as a single argument, which avoids double
        // shell interpretation.
        //
        // Note: the approval gating above is the primary security boundary;
        // unapproved commands never reach this point.
        finalCommand = command;  // will be handled by the sudoElevated path below
      }

      // Enforce docker sandboxing when configured.
      if (sandboxMode === 'docker' && !options.background) {
        logger.info({ command, cwd }, 'Executing command in Docker sandbox');
        const sandboxConfig = options.sandbox || {};
        return runInDockerSandbox(finalCommand, cwd, workspaceDir, env, timeout, sandboxConfig);
      }

      return new Promise((resolve) => {
        // Security: When elevated, spawn sudo directly so that `command` is
        // passed as a single string argument to `sh -c` under sudo, avoiding
        // double shell interpretation that would occur with string interpolation
        // like `sudo -n -- ${command}` passed to sh -c.
        const spawnCmd = options.elevated ? 'sudo' : 'sh';
        const spawnArgs = options.elevated
          ? ['-n', '--', 'sh', '-c', finalCommand]
          : ['-c', finalCommand];
        const child = spawn(spawnCmd, spawnArgs, {
          cwd,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        // Handle background mode
        if (options.background) {
          if (child.pid === undefined) {
            resolve({
              stdout: '',
              stderr: 'Failed to spawn background process (no PID)',
              exitCode: 1,
              signal: null,
              timedOut: false,
            });
            return;
          }

          // Evict completed background processes if at capacity.
          if (backgroundProcesses.size >= MAX_BACKGROUND_PROCESSES) {
            for (const [pid, bp] of backgroundProcesses) {
              if (bp.process.killed || bp.process.exitCode !== null) {
                backgroundProcesses.delete(pid);
              }
            }
          }

          let bgStdoutBytes = 0;
          let bgStderrBytes = 0;
          const bgProcess: BackgroundProcess = {
            pid: child.pid,
            command,
            startedAt: new Date(),
            process: child,
            stdout: [],
            stderr: [],
          };

          child.stdout?.on('data', (data) => {
            const chunk = data.toString();
            if (bgStdoutBytes < MAX_BG_OUTPUT_BYTES) {
              bgProcess.stdout.push(chunk);
              bgStdoutBytes += chunk.length;
            }
          });

          child.stderr?.on('data', (data) => {
            const chunk = data.toString();
            if (bgStderrBytes < MAX_BG_OUTPUT_BYTES) {
              bgProcess.stderr.push(chunk);
              bgStderrBytes += chunk.length;
            }
          });

          backgroundProcesses.set(child.pid, bgProcess);

          resolve({
            stdout: '',
            stderr: '',
            exitCode: null,
            signal: null,
            timedOut: false,
            pid: child.pid,
          });
          return;
        }

        // Collect output with size limits
        child.stdout?.on('data', (data) => {
          if (stdout.length < maxOutput) {
            stdout += data.toString();
          }
        });

        child.stderr?.on('data', (data) => {
          if (stderr.length < maxOutput) {
            stderr += data.toString();
          }
        });

        // Set timeout
        const timeoutId = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 1000);
        }, timeout);

        child.on('close', (code, signal) => {
          clearTimeout(timeoutId);

          // Truncate output if needed
          if (stdout.length > maxOutput) {
            stdout = stdout.slice(0, maxOutput) + '\n... (output truncated)';
          }
          if (stderr.length > maxOutput) {
            stderr = stderr.slice(0, maxOutput) + '\n... (output truncated)';
          }

          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code,
            signal: signal,
            timedOut,
          });
        });

        child.on('error', (err) => {
          clearTimeout(timeoutId);
          resolve({
            stdout: '',
            stderr: err.message,
            exitCode: 1,
            signal: null,
            timedOut: false,
          });
        });
      });
    },

    listBackground() {
      return Array.from(backgroundProcesses.values()).map((bp) => ({
        pid: bp.pid,
        command: bp.command,
        startedAt: bp.startedAt,
        running: !bp.process.killed && bp.process.exitCode === null,
      }));
    },

    getOutput(pid) {
      const bp = backgroundProcesses.get(pid);
      if (!bp) return null;

      return {
        stdout: bp.stdout.join(''),
        stderr: bp.stderr.join(''),
      };
    },

    kill(pid) {
      const bp = backgroundProcesses.get(pid);
      if (!bp) return false;

      try {
        bp.process.kill('SIGTERM');
        setTimeout(() => {
          if (!bp.process.killed) {
            bp.process.kill('SIGKILL');
          }
        }, 1000);
        return true;
      } catch {
        return false;
      }
    },

    clearCompleted() {
      let cleared = 0;
      for (const [pid, bp] of backgroundProcesses) {
        if (bp.process.killed || bp.process.exitCode !== null) {
          backgroundProcesses.delete(pid);
          cleared++;
        }
      }
      return cleared;
    },
  };
}
