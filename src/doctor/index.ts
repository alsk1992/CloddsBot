/**
 * Doctor Module - Clawdbot-style health checks
 *
 * Features:
 * - System health checks
 * - Dependency verification
 * - Configuration validation
 * - Network connectivity tests
 * - Resource monitoring
 */

import { exec, execSync } from 'child_process';
import { existsSync, accessSync, constants } from 'fs';
import { promisify } from 'util';
import { platform, homedir, cpus, totalmem, freemem } from 'os';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

// =============================================================================
// TYPES
// =============================================================================

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  details?: string;
  duration?: number;
}

export interface DoctorReport {
  timestamp: Date;
  system: string;
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    warnings: number;
    failed: number;
    skipped: number;
  };
  healthy: boolean;
}

export interface CheckOptions {
  verbose?: boolean;
  fix?: boolean;
  categories?: string[];
}

// =============================================================================
// CHECKS
// =============================================================================

type Check = () => Promise<CheckResult>;

const checks: Record<string, Check> = {
  // System checks
  async os(): Promise<CheckResult> {
    const os = platform();
    const supported = ['darwin', 'linux', 'win32'];

    return {
      name: 'Operating System',
      status: supported.includes(os) ? 'pass' : 'warn',
      message: supported.includes(os) ? `${os} is supported` : `${os} may have limited support`,
      details: `Platform: ${os}, Arch: ${process.arch}`,
    };
  },

  async nodeVersion(): Promise<CheckResult> {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0], 10);

    return {
      name: 'Node.js Version',
      status: major >= 18 ? 'pass' : major >= 16 ? 'warn' : 'fail',
      message: major >= 18 ? `Node ${version} is supported` : `Node ${version} may have issues`,
      details: `Minimum: v18.0.0, Current: ${version}`,
    };
  },

  async memory(): Promise<CheckResult> {
    const total = totalmem();
    const free = freemem();
    const used = total - free;
    const usedPercent = (used / total) * 100;

    return {
      name: 'Memory',
      status: usedPercent < 80 ? 'pass' : usedPercent < 95 ? 'warn' : 'fail',
      message: `${usedPercent.toFixed(1)}% memory used`,
      details: `Total: ${(total / 1024 / 1024 / 1024).toFixed(1)}GB, Free: ${(free / 1024 / 1024 / 1024).toFixed(1)}GB`,
    };
  },

  async diskSpace(): Promise<CheckResult> {
    if (platform() === 'win32') {
      return { name: 'Disk Space', status: 'skip', message: 'Windows check not implemented' };
    }

    try {
      const { stdout } = await execAsync('df -h / | tail -1');
      const parts = stdout.trim().split(/\s+/);
      const usePercent = parseInt(parts[4]?.replace('%', '') || '0', 10);

      return {
        name: 'Disk Space',
        status: usePercent < 80 ? 'pass' : usePercent < 95 ? 'warn' : 'fail',
        message: `${usePercent}% disk used`,
        details: `Available: ${parts[3]}, Used: ${parts[2]}`,
      };
    } catch {
      return { name: 'Disk Space', status: 'skip', message: 'Could not check disk space' };
    }
  },

  // Config checks
  async configDir(): Promise<CheckResult> {
    const dir = `${homedir()}/.clodds`;

    if (!existsSync(dir)) {
      return {
        name: 'Config Directory',
        status: 'warn',
        message: 'Config directory not found',
        details: `Expected: ${dir}`,
      };
    }

    try {
      accessSync(dir, constants.R_OK | constants.W_OK);
      return {
        name: 'Config Directory',
        status: 'pass',
        message: 'Config directory accessible',
        details: dir,
      };
    } catch {
      return {
        name: 'Config Directory',
        status: 'fail',
        message: 'Config directory not accessible',
        details: dir,
      };
    }
  },

  // Dependency checks
  async git(): Promise<CheckResult> {
    try {
      const { stdout } = await execAsync('git --version');
      return {
        name: 'Git',
        status: 'pass',
        message: 'Git is installed',
        details: stdout.trim(),
      };
    } catch {
      return {
        name: 'Git',
        status: 'warn',
        message: 'Git not found',
        details: 'Some features may not work',
      };
    }
  },

  async python(): Promise<CheckResult> {
    try {
      const { stdout } = await execAsync('python3 --version');
      return {
        name: 'Python',
        status: 'pass',
        message: 'Python is installed',
        details: stdout.trim(),
      };
    } catch {
      return {
        name: 'Python',
        status: 'skip',
        message: 'Python not found (optional)',
      };
    }
  },

  // Network checks
  async internet(): Promise<CheckResult> {
    const start = Date.now();

    try {
      const response = await fetch('https://api.anthropic.com', {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });

      const duration = Date.now() - start;

      return {
        name: 'Internet Connectivity',
        status: response.ok || response.status === 404 ? 'pass' : 'warn',
        message: 'Internet connection available',
        details: `Latency: ${duration}ms`,
        duration,
      };
    } catch (error) {
      return {
        name: 'Internet Connectivity',
        status: 'fail',
        message: 'No internet connection',
        details: String(error),
      };
    }
  },

  async anthropicApi(): Promise<CheckResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return {
        name: 'Anthropic API',
        status: 'warn',
        message: 'ANTHROPIC_API_KEY not set',
        details: 'Set the environment variable to use Claude',
      };
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        return {
          name: 'Anthropic API',
          status: 'pass',
          message: 'API key is valid',
        };
      }

      const error = await response.text();
      return {
        name: 'Anthropic API',
        status: response.status === 401 ? 'fail' : 'warn',
        message: response.status === 401 ? 'Invalid API key' : `API error: ${response.status}`,
        details: error,
      };
    } catch (error) {
      return {
        name: 'Anthropic API',
        status: 'fail',
        message: 'Could not connect to Anthropic API',
        details: String(error),
      };
    }
  },

  // Platform-specific checks
  async macosPermissions(): Promise<CheckResult> {
    if (platform() !== 'darwin') {
      return { name: 'macOS Permissions', status: 'skip', message: 'Not on macOS' };
    }

    try {
      // Try to run a basic AppleScript
      execSync('osascript -e "return 1"', { stdio: 'pipe' });
      return {
        name: 'macOS Permissions',
        status: 'pass',
        message: 'AppleScript access granted',
      };
    } catch {
      return {
        name: 'macOS Permissions',
        status: 'warn',
        message: 'AppleScript access may be restricted',
        details: 'Grant Terminal full disk access in System Preferences',
      };
    }
  },

  // Docker check
  async docker(): Promise<CheckResult> {
    try {
      const { stdout } = await execAsync('docker --version');
      return {
        name: 'Docker',
        status: 'pass',
        message: 'Docker is installed',
        details: stdout.trim(),
      };
    } catch {
      return {
        name: 'Docker',
        status: 'skip',
        message: 'Docker not found (optional)',
      };
    }
  },
};

// =============================================================================
// DOCTOR
// =============================================================================

export async function runDoctor(options: CheckOptions = {}): Promise<DoctorReport> {
  const results: CheckResult[] = [];
  const categories = options.categories || Object.keys(checks);

  logger.info('Running health checks...');

  for (const [name, check] of Object.entries(checks)) {
    if (!categories.includes(name)) continue;

    try {
      const start = Date.now();
      const result = await check();
      result.duration = result.duration || (Date.now() - start);
      results.push(result);

      if (options.verbose) {
        const icon = result.status === 'pass' ? '✓' :
          result.status === 'warn' ? '⚠' :
          result.status === 'fail' ? '✗' : '○';
        console.log(`${icon} ${result.name}: ${result.message}`);
      }
    } catch (error) {
      results.push({
        name,
        status: 'fail',
        message: `Check failed: ${error}`,
      });
    }
  }

  const summary = {
    total: results.length,
    passed: results.filter(r => r.status === 'pass').length,
    warnings: results.filter(r => r.status === 'warn').length,
    failed: results.filter(r => r.status === 'fail').length,
    skipped: results.filter(r => r.status === 'skip').length,
  };

  return {
    timestamp: new Date(),
    system: `${platform()} ${process.arch}`,
    checks: results,
    summary,
    healthy: summary.failed === 0,
  };
}

/** Format a doctor report for display */
export function formatReport(report: DoctorReport): string {
  const lines: string[] = [];

  lines.push('╭─────────────────────────────────────────────╮');
  lines.push('│            Clodds Health Check              │');
  lines.push('╰─────────────────────────────────────────────╯');
  lines.push('');

  for (const check of report.checks) {
    const icon = check.status === 'pass' ? '✓' :
      check.status === 'warn' ? '⚠' :
      check.status === 'fail' ? '✗' : '○';

    const color = check.status === 'pass' ? '\x1b[32m' :
      check.status === 'warn' ? '\x1b[33m' :
      check.status === 'fail' ? '\x1b[31m' : '\x1b[90m';

    lines.push(`${color}${icon}\x1b[0m ${check.name}`);
    lines.push(`  ${check.message}`);
    if (check.details) {
      lines.push(`  \x1b[90m${check.details}\x1b[0m`);
    }
    lines.push('');
  }

  lines.push('─────────────────────────────────────────────');
  lines.push(`Summary: ${report.summary.passed} passed, ${report.summary.warnings} warnings, ${report.summary.failed} failed, ${report.summary.skipped} skipped`);

  if (report.healthy) {
    lines.push('\x1b[32m✓ System is healthy\x1b[0m');
  } else {
    lines.push('\x1b[31m✗ Issues detected\x1b[0m');
  }

  return lines.join('\n');
}

/** Run a quick health check */
export async function quickCheck(): Promise<boolean> {
  const essentialChecks = ['nodeVersion', 'memory', 'internet'];
  const report = await runDoctor({ categories: essentialChecks });
  return report.healthy;
}

/** Register a custom check */
export function registerCheck(name: string, check: Check): void {
  checks[name] = check;
}

/** Get available check names */
export function getCheckNames(): string[] {
  return Object.keys(checks);
}
