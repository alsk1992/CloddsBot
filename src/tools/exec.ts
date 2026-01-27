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

import { spawn, execSync, ChildProcess } from 'child_process';
import * as path from 'path';
import { logger } from '../utils/logger';
import { execApprovals, elevatedPermissions, isSafeBin, splitCommandChain, parseCommand } from '../permissions/index';

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

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_OUTPUT = 1024 * 1024; // 1MB

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

        logger.warn({ command, agentId, senderId: options.senderId }, 'Elevated execution approved');
        finalCommand = `sudo ${command}`;
      }

      return new Promise((resolve) => {
        const child = spawn('sh', ['-c', finalCommand], {
          cwd,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        // Handle background mode
        if (options.background) {
          const bgProcess: BackgroundProcess = {
            pid: child.pid!,
            command,
            startedAt: new Date(),
            process: child,
            stdout: [],
            stderr: [],
          };

          child.stdout?.on('data', (data) => {
            bgProcess.stdout.push(data.toString());
          });

          child.stderr?.on('data', (data) => {
            bgProcess.stderr.push(data.toString());
          });

          backgroundProcesses.set(child.pid!, bgProcess);

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
