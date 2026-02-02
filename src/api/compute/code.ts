/**
 * Code Execution Service - Sandboxed code runner for agents
 *
 * Supports Python, JavaScript, TypeScript, Rust, Go, Bash
 * Uses isolated containers for safety
 */

import { spawn } from 'child_process';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { logger } from '../../utils/logger';
import type {
  ComputeRequest,
  CodeRequest,
  CodeResponse,
  CodeLanguage,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface CodeRunner {
  /** Execute code */
  execute(request: ComputeRequest): Promise<CodeResponse>;
  /** Get supported languages */
  getLanguages(): CodeLanguage[];
  /** Check if language is available */
  isAvailable(language: CodeLanguage): Promise<boolean>;
}

export interface CodeRunnerConfig {
  /** Sandbox mode: 'docker' | 'native' (default: 'native' in dev) */
  sandbox?: 'docker' | 'native';
  /** Working directory for temp files */
  workDir?: string;
  /** Default timeout in ms (default: 30000) */
  defaultTimeout?: number;
  /** Default memory limit in MB (default: 256) */
  defaultMemoryMb?: number;
  /** Docker image for sandbox */
  dockerImage?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<CodeRunnerConfig> = {
  sandbox: 'native',
  workDir: '/tmp/clodds-code',
  defaultTimeout: 30000,
  defaultMemoryMb: 256,
  dockerImage: 'clodds/sandbox:latest',
};

const LANGUAGE_COMMANDS: Record<CodeLanguage, { cmd: string; ext: string; compile?: string }> = {
  python: { cmd: 'python3', ext: '.py' },
  javascript: { cmd: 'node', ext: '.js' },
  typescript: { cmd: 'npx ts-node', ext: '.ts' },
  rust: { cmd: './main', ext: '.rs', compile: 'rustc -o main' },
  go: { cmd: 'go run', ext: '.go' },
  bash: { cmd: 'bash', ext: '.sh' },
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createCodeRunner(config: CodeRunnerConfig = {}): CodeRunner {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  function getLanguages(): CodeLanguage[] {
    return Object.keys(LANGUAGE_COMMANDS) as CodeLanguage[];
  }

  async function isAvailable(language: CodeLanguage): Promise<boolean> {
    const langConfig = LANGUAGE_COMMANDS[language];
    if (!langConfig) return false;

    try {
      const cmd = langConfig.cmd.split(' ')[0];
      await execCommand('which', [cmd], 5000);
      return true;
    } catch {
      return false;
    }
  }

  async function execute(request: ComputeRequest): Promise<CodeResponse> {
    const payload = request.payload as CodeRequest;
    const {
      language,
      code,
      stdin,
      env,
      timeout = cfg.defaultTimeout,
      memoryMb = cfg.defaultMemoryMb,
      files,
    } = payload;

    const langConfig = LANGUAGE_COMMANDS[language];
    if (!langConfig) {
      throw new Error(`Unsupported language: ${language}`);
    }

    // Create isolated work directory
    const sessionId = randomBytes(8).toString('hex');
    const sessionDir = join(cfg.workDir, sessionId);

    const startTime = Date.now();

    try {
      await mkdir(sessionDir, { recursive: true });

      // Write main code file
      const mainFile = join(sessionDir, `main${langConfig.ext}`);
      await writeFile(mainFile, code, 'utf-8');

      // Write additional files
      if (files) {
        for (const file of files) {
          const filePath = join(sessionDir, file.name);
          await writeFile(filePath, file.content, 'utf-8');
        }
      }

      // Compile if needed
      if (langConfig.compile) {
        const compileResult = await execInDir(
          sessionDir,
          langConfig.compile,
          [`main${langConfig.ext}`],
          timeout,
          env
        );

        if (compileResult.exitCode !== 0) {
          return {
            exitCode: compileResult.exitCode,
            stdout: compileResult.stdout,
            stderr: `Compilation failed:\n${compileResult.stderr}`,
            durationMs: Date.now() - startTime,
            memoryMb: 0,
          };
        }
      }

      // Execute
      let result: ExecResult;

      if (cfg.sandbox === 'docker') {
        result = await execDocker(
          sessionDir,
          langConfig.cmd,
          language === 'go' ? [`main${langConfig.ext}`] : (langConfig.compile ? [] : [`main${langConfig.ext}`]),
          timeout,
          memoryMb,
          env,
          stdin
        );
      } else {
        const args = language === 'go'
          ? [`main${langConfig.ext}`]
          : (langConfig.compile ? [] : [`main${langConfig.ext}`]);

        result = await execInDir(
          sessionDir,
          langConfig.cmd,
          args,
          timeout,
          env,
          stdin
        );
      }

      // Read output files
      const outputFiles: Array<{ name: string; content: string }> = [];
      // Could scan for new files here if needed

      const durationMs = Date.now() - startTime;

      logger.info({
        requestId: request.id,
        language,
        exitCode: result.exitCode,
        durationMs,
      }, 'Code execution completed');

      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs,
        memoryMb: result.memoryMb || 0,
        files: outputFiles.length > 0 ? outputFiles : undefined,
      };
    } finally {
      // Cleanup
      try {
        await rm(sessionDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  interface ExecResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    memoryMb?: number;
  }

  async function execCommand(
    cmd: string,
    args: string[],
    timeout: number
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { timeout });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
        });
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  async function execInDir(
    cwd: string,
    cmd: string,
    args: string[],
    timeout: number,
    env?: Record<string, string>,
    stdin?: string
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const [executable, ...cmdArgs] = cmd.split(' ');
      const fullArgs = [...cmdArgs, ...args];

      const proc = spawn(executable, fullArgs, {
        cwd,
        timeout,
        env: { ...getProcessEnv(), ...env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        // Limit output size
        if (stdout.length > 1024 * 1024) {
          proc.kill();
          stderr += '\n[Output truncated - exceeded 1MB limit]';
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > 1024 * 1024) {
          proc.kill();
          stderr = stderr.slice(0, 1024 * 1024) + '\n[Stderr truncated]';
        }
      });

      // Send stdin if provided
      if (stdin) {
        proc.stdin?.write(stdin);
        proc.stdin?.end();
      }

      proc.on('close', (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout: stdout.slice(0, 100000), // Limit final output
          stderr: stderr.slice(0, 100000),
        });
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  async function execDocker(
    sessionDir: string,
    cmd: string,
    args: string[],
    timeout: number,
    memoryMb: number,
    env?: Record<string, string>,
    stdin?: string
  ): Promise<ExecResult> {
    const dockerArgs = [
      'run',
      '--rm',
      '--network=none', // No network access
      `--memory=${memoryMb}m`,
      `--memory-swap=${memoryMb}m`,
      '--cpus=1',
      '--pids-limit=100',
      '-v', `${sessionDir}:/code:ro`,
      '-w', '/code',
    ];

    // Add environment variables
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        dockerArgs.push('-e', `${key}=${value}`);
      }
    }

    dockerArgs.push(cfg.dockerImage);
    dockerArgs.push(...cmd.split(' '));
    dockerArgs.push(...args);

    return new Promise((resolve, reject) => {
      const proc = spawn('docker', dockerArgs, { timeout });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      if (stdin) {
        proc.stdin?.write(stdin);
        proc.stdin?.end();
      }

      proc.on('close', (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          memoryMb,
        });
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  function getProcessEnv(): Record<string, string> {
    if (typeof globalThis !== 'undefined' && 'process' in globalThis) {
      const proc = (globalThis as { process?: { env?: Record<string, string> } }).process;
      return proc?.env || {};
    }
    return {};
  }

  return {
    execute,
    getLanguages,
    isAvailable,
  };
}
