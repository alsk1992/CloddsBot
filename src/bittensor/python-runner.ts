/**
 * Python Runner
 * child_process wrapper for btcli and Python-based Bittensor operations.
 * Sanitizes arguments to prevent injection.
 */

import { spawn as nodeSpawn, execFile } from 'node:child_process';
import type { PythonRunner, PythonExecResult, PythonProcess } from './types';

const DEFAULT_TIMEOUT_MS = 60_000;

function sanitizeArg(arg: string): string {
  return arg.replace(/[;&|`$(){}[\]<>!#~]/g, '');
}

export function createPythonRunner(pythonPath: string = 'python3'): PythonRunner {
  function exec(cmd: string, args: string[], timeout: number = DEFAULT_TIMEOUT_MS): Promise<PythonExecResult> {
    const sanitizedArgs = args.map(sanitizeArg);

    return new Promise((resolve) => {
      const child = execFile(cmd, sanitizedArgs, { timeout }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: error ? (error as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0,
          success: !error,
        });
      });

      setTimeout(() => {
        child.kill('SIGKILL');
      }, timeout + 1000);
    });
  }

  function spawnProcess(cmd: string, args: string[], _logPrefix: string): PythonProcess {
    const sanitizedArgs = args.map(sanitizeArg);
    const child = nodeSpawn(cmd, sanitizedArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const exitCallbacks: Array<(code: number | null) => void> = [];
    const stdoutCallbacks: Array<(data: string) => void> = [];
    const stderrCallbacks: Array<(data: string) => void> = [];

    child.on('exit', (code) => {
      for (const cb of exitCallbacks) cb(code);
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      for (const cb of stdoutCallbacks) cb(text);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      for (const cb of stderrCallbacks) cb(text);
    });

    return {
      pid: child.pid,
      kill() {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
      },
      onExit(cb) { exitCallbacks.push(cb); },
      onStdout(cb) { stdoutCallbacks.push(cb); },
      onStderr(cb) { stderrCallbacks.push(cb); },
    };
  }

  function btcli(args: string[], timeout: number = DEFAULT_TIMEOUT_MS): Promise<PythonExecResult> {
    return exec(pythonPath, ['-m', 'bittensor.btcli', ...args], timeout);
  }

  return {
    exec,
    spawn: spawnProcess,
    btcli,
  };
}
