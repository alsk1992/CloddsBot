/**
 * VPS Hardening Skill
 *
 * Security auditing and hardening for remote servers.
 * Checks common misconfigurations and applies fixes.
 */

import { execSync, spawn } from 'child_process';
import { logger } from '../../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface AuditResult {
  check: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
  fix?: string;
}

export interface AuditReport {
  host: string;
  timestamp: Date;
  results: AuditResult[];
  score: number;
  maxScore: number;
}

export interface HardenOptions {
  host: string;
  user?: string;
  keyPath?: string;
  dryRun?: boolean;
}

// =============================================================================
// SSH HELPER
// =============================================================================

function sshExec(host: string, command: string, user = 'root', keyPath?: string): string {
  const sshArgs = ['-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10'];
  if (keyPath) {
    sshArgs.push('-i', keyPath);
  }

  const target = user ? `${user}@${host}` : host;
  const fullCommand = `ssh ${sshArgs.join(' ')} ${target} "${command.replace(/"/g, '\\"')}"`;

  try {
    return execSync(fullCommand, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    const err = error as { stderr?: Buffer; message?: string };
    if (err.stderr) {
      return `ERROR: ${err.stderr.toString()}`;
    }
    return `ERROR: ${err.message || 'Command failed'}`;
  }
}

function sshExecSafe(host: string, command: string, user = 'root', keyPath?: string): string | null {
  try {
    const result = sshExec(host, command, user, keyPath);
    if (result.startsWith('ERROR:')) return null;
    return result;
  } catch {
    return null;
  }
}

// =============================================================================
// SECURITY CHECKS
// =============================================================================

/**
 * Check if system packages are up to date
 */
function checkUpdates(host: string, user: string, keyPath?: string): AuditResult {
  const result = sshExecSafe(host, 'apt list --upgradable 2>/dev/null | wc -l', user, keyPath);

  if (result === null) {
    return { check: 'System Updates', status: 'skip', message: 'Could not check updates' };
  }

  const count = parseInt(result, 10) - 1; // Subtract header line

  if (count <= 0) {
    return { check: 'System Updates', status: 'pass', message: 'System is up to date' };
  }

  return {
    check: 'System Updates',
    status: count > 10 ? 'fail' : 'warn',
    message: `${count} packages need updating`,
    fix: 'sudo apt update && sudo apt upgrade -y',
  };
}

/**
 * Check if unattended-upgrades is enabled
 */
function checkAutoUpdates(host: string, user: string, keyPath?: string): AuditResult {
  const result = sshExecSafe(host, 'dpkg -l | grep unattended-upgrades | wc -l', user, keyPath);

  if (result === null) {
    return { check: 'Auto Updates', status: 'skip', message: 'Could not check' };
  }

  if (parseInt(result, 10) > 0) {
    return { check: 'Auto Updates', status: 'pass', message: 'unattended-upgrades installed' };
  }

  return {
    check: 'Auto Updates',
    status: 'warn',
    message: 'Automatic security updates not configured',
    fix: 'sudo apt install unattended-upgrades -y && sudo dpkg-reconfigure -plow unattended-upgrades',
  };
}

/**
 * Check SSH root login status
 */
function checkRootLogin(host: string, user: string, keyPath?: string): AuditResult {
  const result = sshExecSafe(host, "grep -E '^PermitRootLogin' /etc/ssh/sshd_config | head -1", user, keyPath);

  if (result === null) {
    return { check: 'Root SSH Login', status: 'skip', message: 'Could not check SSH config' };
  }

  if (result.includes('no') || result.includes('prohibit-password')) {
    return { check: 'Root SSH Login', status: 'pass', message: 'Root login disabled or key-only' };
  }

  if (result.includes('yes') || result === '') {
    return {
      check: 'Root SSH Login',
      status: 'fail',
      message: 'Root login is enabled',
      fix: "sudo sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config && sudo systemctl restart sshd",
    };
  }

  return { check: 'Root SSH Login', status: 'warn', message: `Unknown config: ${result}` };
}

/**
 * Check if password authentication is disabled
 */
function checkPasswordAuth(host: string, user: string, keyPath?: string): AuditResult {
  const result = sshExecSafe(host, "grep -E '^PasswordAuthentication' /etc/ssh/sshd_config | head -1", user, keyPath);

  if (result === null) {
    return { check: 'Password Auth', status: 'skip', message: 'Could not check SSH config' };
  }

  if (result.includes('no')) {
    return { check: 'Password Auth', status: 'pass', message: 'Password authentication disabled' };
  }

  return {
    check: 'Password Auth',
    status: 'fail',
    message: 'Password authentication enabled',
    fix: "sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && sudo systemctl restart sshd",
  };
}

/**
 * Check firewall status
 */
function checkFirewall(host: string, user: string, keyPath?: string): AuditResult {
  const ufwResult = sshExecSafe(host, 'sudo ufw status 2>/dev/null | head -1', user, keyPath);

  if (ufwResult && ufwResult.includes('active')) {
    return { check: 'Firewall (UFW)', status: 'pass', message: 'UFW is active' };
  }

  // Check iptables as fallback
  const iptResult = sshExecSafe(host, 'sudo iptables -L -n 2>/dev/null | wc -l', user, keyPath);
  if (iptResult && parseInt(iptResult, 10) > 10) {
    return { check: 'Firewall (iptables)', status: 'pass', message: 'iptables rules configured' };
  }

  return {
    check: 'Firewall',
    status: 'fail',
    message: 'No firewall detected',
    fix: 'sudo apt install ufw -y && sudo ufw default deny incoming && sudo ufw default allow outgoing && sudo ufw allow ssh && sudo ufw --force enable',
  };
}

/**
 * Check fail2ban status
 */
function checkFail2ban(host: string, user: string, keyPath?: string): AuditResult {
  const result = sshExecSafe(host, 'systemctl is-active fail2ban 2>/dev/null', user, keyPath);

  if (result === 'active') {
    return { check: 'Fail2ban', status: 'pass', message: 'Fail2ban is running' };
  }

  return {
    check: 'Fail2ban',
    status: 'fail',
    message: 'Fail2ban not running',
    fix: 'sudo apt install fail2ban -y && sudo systemctl enable fail2ban && sudo systemctl start fail2ban',
  };
}

/**
 * Check system uptime (too long = no reboots for kernel updates)
 */
function checkUptime(host: string, user: string, keyPath?: string): AuditResult {
  const result = sshExecSafe(host, "cat /proc/uptime | awk '{print int($1/86400)}'", user, keyPath);

  if (result === null) {
    return { check: 'Uptime', status: 'skip', message: 'Could not check uptime' };
  }

  const days = parseInt(result, 10);

  if (days < 30) {
    return { check: 'Uptime', status: 'pass', message: `${days} days - reasonable` };
  }

  if (days < 90) {
    return { check: 'Uptime', status: 'warn', message: `${days} days - consider rebooting for kernel updates` };
  }

  return {
    check: 'Uptime',
    status: 'fail',
    message: `${days} days - likely missing kernel security patches`,
    fix: 'sudo reboot (after ensuring services will restart)',
  };
}

/**
 * Check listening services
 */
function checkListeningServices(host: string, user: string, keyPath?: string): AuditResult {
  const result = sshExecSafe(host, "sudo ss -tulpn | grep LISTEN | wc -l", user, keyPath);

  if (result === null) {
    return { check: 'Listening Services', status: 'skip', message: 'Could not check services' };
  }

  const count = parseInt(result, 10);

  if (count <= 5) {
    return { check: 'Listening Services', status: 'pass', message: `${count} services listening - minimal` };
  }

  if (count <= 10) {
    return { check: 'Listening Services', status: 'warn', message: `${count} services listening - review with: sudo ss -tulpn` };
  }

  return {
    check: 'Listening Services',
    status: 'fail',
    message: `${count} services listening - too many`,
    fix: 'Review: sudo ss -tulpn | grep LISTEN',
  };
}

/**
 * Check for non-root sudo user
 */
function checkSudoUser(host: string, user: string, keyPath?: string): AuditResult {
  const result = sshExecSafe(host, "getent group sudo | cut -d: -f4", user, keyPath);

  if (result === null) {
    return { check: 'Sudo Users', status: 'skip', message: 'Could not check sudo group' };
  }

  const users = result.split(',').filter(u => u && u !== 'root');

  if (users.length > 0) {
    return { check: 'Sudo Users', status: 'pass', message: `Non-root sudo users: ${users.join(', ')}` };
  }

  return {
    check: 'Sudo Users',
    status: 'warn',
    message: 'No non-root sudo users found',
    fix: 'adduser deployer && usermod -aG sudo deployer',
  };
}

/**
 * Check SSH MaxAuthTries
 */
function checkMaxAuthTries(host: string, user: string, keyPath?: string): AuditResult {
  const result = sshExecSafe(host, "grep -E '^MaxAuthTries' /etc/ssh/sshd_config | awk '{print $2}'", user, keyPath);

  if (result === null || result === '') {
    return {
      check: 'SSH MaxAuthTries',
      status: 'warn',
      message: 'MaxAuthTries not set (default 6)',
      fix: "echo 'MaxAuthTries 3' | sudo tee -a /etc/ssh/sshd_config && sudo systemctl restart sshd",
    };
  }

  const tries = parseInt(result, 10);

  if (tries <= 3) {
    return { check: 'SSH MaxAuthTries', status: 'pass', message: `MaxAuthTries set to ${tries}` };
  }

  return {
    check: 'SSH MaxAuthTries',
    status: 'warn',
    message: `MaxAuthTries is ${tries} (recommend 3)`,
    fix: "sudo sed -i 's/^MaxAuthTries.*/MaxAuthTries 3/' /etc/ssh/sshd_config && sudo systemctl restart sshd",
  };
}

// =============================================================================
// MAIN FUNCTIONS
// =============================================================================

/**
 * Run full security audit on a host
 */
export async function auditHost(options: HardenOptions): Promise<AuditReport> {
  const { host, user = 'root', keyPath } = options;

  logger.info({ host }, 'Starting security audit');

  const checks = [
    () => checkUpdates(host, user, keyPath),
    () => checkAutoUpdates(host, user, keyPath),
    () => checkRootLogin(host, user, keyPath),
    () => checkPasswordAuth(host, user, keyPath),
    () => checkFirewall(host, user, keyPath),
    () => checkFail2ban(host, user, keyPath),
    () => checkUptime(host, user, keyPath),
    () => checkListeningServices(host, user, keyPath),
    () => checkSudoUser(host, user, keyPath),
    () => checkMaxAuthTries(host, user, keyPath),
  ];

  const results: AuditResult[] = [];

  for (const check of checks) {
    try {
      results.push(check());
    } catch (error) {
      logger.debug({ error }, 'Check failed');
    }
  }

  const score = results.filter(r => r.status === 'pass').length;
  const maxScore = results.filter(r => r.status !== 'skip').length;

  return {
    host,
    timestamp: new Date(),
    results,
    score,
    maxScore,
  };
}

/**
 * Apply safe fixes to a host
 */
export async function hardenHost(options: HardenOptions): Promise<{ applied: string[]; skipped: string[] }> {
  const { host, user = 'root', keyPath, dryRun = false } = options;

  // First run audit
  const report = await auditHost(options);

  const applied: string[] = [];
  const skipped: string[] = [];

  // Safe fixes that won't lock you out
  const safeFixes = [
    'System Updates',
    'Auto Updates',
    'Firewall',
    'Fail2ban',
    'SSH MaxAuthTries',
  ];

  for (const result of report.results) {
    if (result.status === 'fail' || result.status === 'warn') {
      if (result.fix && safeFixes.includes(result.check)) {
        if (dryRun) {
          applied.push(`[DRY RUN] ${result.check}: ${result.fix}`);
        } else {
          logger.info({ check: result.check }, 'Applying fix');
          const output = sshExec(host, result.fix, user, keyPath);
          if (!output.startsWith('ERROR:')) {
            applied.push(`${result.check}: Applied`);
          } else {
            skipped.push(`${result.check}: ${output}`);
          }
        }
      } else {
        skipped.push(`${result.check}: Manual fix required - ${result.fix || 'no fix available'}`);
      }
    }
  }

  return { applied, skipped };
}

/**
 * Generate markdown report
 */
export function formatReport(report: AuditReport): string {
  const lines: string[] = [
    `# Security Audit Report`,
    '',
    `**Host:** ${report.host}`,
    `**Date:** ${report.timestamp.toISOString()}`,
    `**Score:** ${report.score}/${report.maxScore} (${Math.round(report.score / report.maxScore * 100)}%)`,
    '',
    '## Results',
    '',
    '| Check | Status | Details |',
    '|-------|--------|---------|',
  ];

  const statusIcon = {
    pass: '✅',
    fail: '❌',
    warn: '⚠️',
    skip: '⏭️',
  };

  for (const result of report.results) {
    lines.push(`| ${result.check} | ${statusIcon[result.status]} | ${result.message} |`);
  }

  // Add fixes section
  const fixes = report.results.filter(r => r.fix && (r.status === 'fail' || r.status === 'warn'));
  if (fixes.length > 0) {
    lines.push('');
    lines.push('## Recommended Fixes');
    lines.push('');
    for (const result of fixes) {
      lines.push(`### ${result.check}`);
      lines.push('```bash');
      lines.push(result.fix!);
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Quick emergency hardening (10-minute version)
 */
export async function emergencyHarden(options: HardenOptions): Promise<string> {
  const { host, user = 'root', keyPath, dryRun = false } = options;

  const commands = [
    '# Update system',
    'sudo apt update && sudo apt upgrade -y',
    '',
    '# Install security tools',
    'sudo apt install ufw fail2ban unattended-upgrades -y',
    '',
    '# Configure firewall',
    'sudo ufw default deny incoming',
    'sudo ufw default allow outgoing',
    'sudo ufw allow ssh',
    'sudo ufw --force enable',
    '',
    '# Enable fail2ban',
    'sudo systemctl enable fail2ban',
    'sudo systemctl start fail2ban',
    '',
    '# Lock root password',
    'sudo passwd -l root',
  ];

  const script = commands.join('\n');

  if (dryRun) {
    return `[DRY RUN] Would execute:\n\n${script}`;
  }

  logger.info({ host }, 'Running emergency hardening');

  // Run as single script
  const result = sshExec(host, script.replace(/\n/g, ' && ').replace(/# [^&]+&&/g, ''), user, keyPath);

  return `Emergency hardening complete.\n\nOutput:\n${result}`;
}

// =============================================================================
// SKILL EXPORT
// =============================================================================

export const skill = {
  name: 'harden',
  description: 'VPS security auditing and hardening',
  commands: [
    {
      name: 'harden',
      description: 'Security audit and hardening',
      usage: '/harden <audit|fix|emergency|report> <host> [--user=root] [--dry-run]',
    },
  ],

  async handler(args: string): Promise<string> {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const host = parts[1];

    // Parse options
    let user = 'root';
    let dryRun = false;

    for (const part of parts.slice(2)) {
      if (part.startsWith('--user=')) {
        user = part.slice(7);
      } else if (part === '--dry-run') {
        dryRun = true;
      }
    }

    if (!subcommand || subcommand === 'help') {
      return [
        'VPS Hardening Commands',
        '',
        '/harden audit <host>      - Run security audit',
        '/harden fix <host>        - Apply safe fixes',
        '/harden emergency <host>  - Quick 10-minute hardening',
        '/harden report <host>     - Generate markdown report',
        '',
        'Options:',
        '  --user=deployer   SSH user (default: root)',
        '  --dry-run         Show what would be done',
        '',
        'Examples:',
        '  /harden audit 192.168.1.100',
        '  /harden fix myserver --user=admin',
        '  /harden emergency vps.example.com --dry-run',
      ].join('\n');
    }

    if (!host) {
      return 'Error: Host required. Usage: /harden audit <host>';
    }

    const options: HardenOptions = { host, user, dryRun };

    switch (subcommand) {
      case 'audit': {
        const report = await auditHost(options);
        const lines = [
          `Security Audit: ${host}`,
          `Score: ${report.score}/${report.maxScore}`,
          '',
        ];

        for (const result of report.results) {
          const icon = result.status === 'pass' ? '✅' :
                       result.status === 'fail' ? '❌' :
                       result.status === 'warn' ? '⚠️' : '⏭️';
          lines.push(`${icon} ${result.check}: ${result.message}`);
        }

        const failCount = report.results.filter(r => r.status === 'fail').length;
        if (failCount > 0) {
          lines.push('');
          lines.push(`Run /harden fix ${host} to apply safe fixes`);
        }

        return lines.join('\n');
      }

      case 'fix': {
        const { applied, skipped } = await hardenHost(options);
        const lines = [`Hardening: ${host}`, ''];

        if (applied.length > 0) {
          lines.push('**Applied:**');
          for (const a of applied) lines.push(`  ✅ ${a}`);
        }

        if (skipped.length > 0) {
          lines.push('');
          lines.push('**Manual action required:**');
          for (const s of skipped) lines.push(`  ⚠️ ${s}`);
        }

        return lines.join('\n');
      }

      case 'emergency': {
        return await emergencyHarden(options);
      }

      case 'report': {
        const report = await auditHost(options);
        return formatReport(report);
      }

      default:
        return `Unknown subcommand: ${subcommand}. Use /harden help`;
    }
  },
};

export default skill;
