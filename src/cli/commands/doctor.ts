/**
 * Doctor Command - Clawdbot-style system diagnostics
 *
 * Checks:
 * - Node version
 * - API keys configured
 * - Channel configurations
 * - Database connectivity
 * - Security settings (DM policies)
 * - File permissions
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../../utils/config';

interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

export async function runDoctor(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. Node version check
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (majorVersion >= 22) {
    results.push({
      name: 'Node.js version',
      status: 'pass',
      message: `${nodeVersion} (>= 22 required)`,
    });
  } else if (majorVersion >= 18) {
    results.push({
      name: 'Node.js version',
      status: 'warn',
      message: `${nodeVersion} (22+ recommended)`,
      fix: 'Upgrade to Node.js 22 LTS',
    });
  } else {
    results.push({
      name: 'Node.js version',
      status: 'fail',
      message: `${nodeVersion} (too old)`,
      fix: 'Upgrade to Node.js 22 LTS',
    });
  }

  // 2. Config file exists
  const configPaths = [
    path.join(process.cwd(), 'clodds.json'),
    path.join(process.cwd(), 'clodds.config.json'),
    path.join(process.env.HOME || '', '.clodds', 'clodds.json'),
  ];

  let configFound = false;
  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      results.push({
        name: 'Config file',
        status: 'pass',
        message: configPath,
      });
      configFound = true;
      break;
    }
  }

  if (!configFound) {
    results.push({
      name: 'Config file',
      status: 'warn',
      message: 'No config file found',
      fix: 'Run: clodds onboard',
    });
  }

  // 3. API key check
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const masked = anthropicKey.slice(0, 10) + '...' + anthropicKey.slice(-4);
    results.push({
      name: 'Anthropic API key',
      status: 'pass',
      message: `Set (${masked})`,
    });
  } else {
    results.push({
      name: 'Anthropic API key',
      status: 'fail',
      message: 'Not set',
      fix: 'Set ANTHROPIC_API_KEY environment variable',
    });
  }

  // 4. Load config and check channels
  try {
    const config = await loadConfig();

    // Check Telegram
    if (config.channels?.telegram?.enabled) {
      if (config.channels.telegram.botToken || process.env.TELEGRAM_BOT_TOKEN) {
        results.push({
          name: 'Telegram channel',
          status: 'pass',
          message: 'Configured',
        });

        // Check DM policy
        const dmPolicy = config.channels.telegram.dmPolicy || 'pairing';
        if (dmPolicy === 'open') {
          results.push({
            name: 'Telegram DM policy',
            status: 'warn',
            message: 'OPEN - anyone can message',
            fix: 'Set dmPolicy: "pairing" for security',
          });
        } else {
          results.push({
            name: 'Telegram DM policy',
            status: 'pass',
            message: dmPolicy,
          });
        }
      } else {
        results.push({
          name: 'Telegram channel',
          status: 'fail',
          message: 'Enabled but no token',
          fix: 'Set TELEGRAM_BOT_TOKEN or channels.telegram.botToken',
        });
      }
    }

    // Check Discord
    if (config.channels?.discord?.enabled) {
      if (config.channels.discord.token || process.env.DISCORD_BOT_TOKEN) {
        results.push({
          name: 'Discord channel',
          status: 'pass',
          message: 'Configured',
        });
      } else {
        results.push({
          name: 'Discord channel',
          status: 'fail',
          message: 'Enabled but no token',
          fix: 'Set DISCORD_BOT_TOKEN or channels.discord.token',
        });
      }
    }

    // Check WhatsApp
    const whatsappConfig = (config.channels as any)?.whatsapp;
    if (whatsappConfig?.enabled) {
      const authDir = whatsappConfig.authDir || path.join(process.cwd(), '.whatsapp-auth');
      if (fs.existsSync(authDir)) {
        results.push({
          name: 'WhatsApp channel',
          status: 'pass',
          message: 'Auth directory exists',
        });
      } else {
        results.push({
          name: 'WhatsApp channel',
          status: 'warn',
          message: 'Needs QR pairing',
          fix: 'Start gateway and scan QR code',
        });
      }
    }

    // Check Slack
    const slackConfig = (config.channels as any)?.slack;
    if (slackConfig?.enabled) {
      if ((slackConfig.botToken || process.env.SLACK_BOT_TOKEN) &&
          (slackConfig.appToken || process.env.SLACK_APP_TOKEN)) {
        results.push({
          name: 'Slack channel',
          status: 'pass',
          message: 'Configured',
        });
      } else {
        results.push({
          name: 'Slack channel',
          status: 'fail',
          message: 'Missing tokens',
          fix: 'Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN',
        });
      }
    }
  } catch (error) {
    results.push({
      name: 'Config loading',
      status: 'warn',
      message: `Failed to load: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }

  // 5. Data directory
  const dataDir = path.join(process.env.HOME || '', '.clodds');
  if (fs.existsSync(dataDir)) {
    try {
      fs.accessSync(dataDir, fs.constants.W_OK);
      results.push({
        name: 'Data directory',
        status: 'pass',
        message: dataDir,
      });
    } catch {
      results.push({
        name: 'Data directory',
        status: 'fail',
        message: `${dataDir} (not writable)`,
        fix: `Run: chmod 755 ${dataDir}`,
      });
    }
  } else {
    results.push({
      name: 'Data directory',
      status: 'warn',
      message: 'Not created yet',
      fix: 'Will be created on first run',
    });
  }

  // 6. Database file
  const dbPath = path.join(dataDir, 'clodds.db');
  if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
    results.push({
      name: 'Database',
      status: 'pass',
      message: `${dbPath} (${sizeMb} MB)`,
    });
  } else {
    results.push({
      name: 'Database',
      status: 'warn',
      message: 'Not created yet',
      fix: 'Will be created on first run',
    });
  }

  return results;
}

/** Format results for CLI output */
export function formatDoctorResults(results: CheckResult[]): string {
  const lines: string[] = ['', 'Clodds Doctor', '=============', ''];

  const statusIcons: Record<string, string> = {
    pass: '✓',
    warn: '⚠',
    fail: '✗',
  };

  const statusColors: Record<string, string> = {
    pass: '\x1b[32m', // green
    warn: '\x1b[33m', // yellow
    fail: '\x1b[31m', // red
  };
  const reset = '\x1b[0m';

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const result of results) {
    const icon = statusIcons[result.status];
    const color = statusColors[result.status];

    lines.push(`${color}${icon}${reset} ${result.name}: ${result.message}`);

    if (result.fix) {
      lines.push(`  └─ Fix: ${result.fix}`);
    }

    if (result.status === 'pass') passCount++;
    if (result.status === 'warn') warnCount++;
    if (result.status === 'fail') failCount++;
  }

  lines.push('');
  lines.push(`Summary: ${passCount} passed, ${warnCount} warnings, ${failCount} failed`);

  if (failCount > 0) {
    lines.push('');
    lines.push('\x1b[31mSome checks failed. Please fix the issues above.\x1b[0m');
  } else if (warnCount > 0) {
    lines.push('');
    lines.push('\x1b[33mSome warnings found. Consider addressing them.\x1b[0m');
  } else {
    lines.push('');
    lines.push('\x1b[32mAll checks passed!\x1b[0m');
  }

  return lines.join('\n');
}

/** CLI entrypoint */
export async function doctor(): Promise<void> {
  const results = await runDoctor();
  console.log(formatDoctorResults(results));

  // Exit with error code if failures
  const hasFailures = results.some((r) => r.status === 'fail');
  if (hasFailures) {
    process.exit(1);
  }
}
