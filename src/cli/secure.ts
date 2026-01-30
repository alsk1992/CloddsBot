#!/usr/bin/env node
/**
 * Server Security Hardening CLI
 *
 * Usage: clodds secure [options]
 *
 * Automatically applies security best practices:
 * - SSH hardening (disable password auth, root login)
 * - Firewall setup (ufw)
 * - fail2ban installation
 * - Automatic security updates
 * - Kernel hardening (sysctl)
 */

import { execSync, execFileSync, spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync, copyFileSync } from 'fs';
import { homedir, platform, userInfo } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

// =============================================================================
// TYPES
// =============================================================================

interface SecurityCheck {
  name: string;
  description: string;
  check: () => boolean;
  fix: () => void;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

interface HardeningOptions {
  dryRun: boolean;
  interactive: boolean;
  sshPort?: number;
  allowedPorts?: number[];
  skipFirewall?: boolean;
  skipFail2ban?: boolean;
  skipSsh?: boolean;
  skipUpdates?: boolean;
  skipKernel?: boolean;
}

// =============================================================================
// HELPERS
// =============================================================================

const isRoot = () => process.getuid?.() === 0;
const isLinux = () => platform() === 'linux';
const isMac = () => platform() === 'darwin';

function log(level: 'info' | 'warn' | 'error' | 'success', msg: string) {
  const colors = {
    info: '\x1b[36m',    // cyan
    warn: '\x1b[33m',    // yellow
    error: '\x1b[31m',   // red
    success: '\x1b[32m', // green
  };
  const icons = {
    info: 'ℹ',
    warn: '⚠',
    error: '✖',
    success: '✔',
  };
  console.log(`${colors[level]}${icons[level]} ${msg}\x1b[0m`);
}

function commandExists(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runCommand(cmd: string, args: string[], options: { sudo?: boolean; dryRun?: boolean } = {}): string {
  const { sudo = false, dryRun = false } = options;

  const finalArgs = sudo && !isRoot() ? ['sudo', cmd, ...args] : [cmd, ...args];
  const finalCmd = finalArgs[0];
  const finalCmdArgs = finalArgs.slice(1);

  if (dryRun) {
    log('info', `[DRY RUN] Would execute: ${finalArgs.join(' ')}`);
    return '';
  }

  try {
    return execFileSync(finalCmd, finalCmdArgs, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    throw new Error(error.stderr || error.message || 'Command failed');
  }
}

function backupFile(path: string): void {
  if (existsSync(path)) {
    const backupPath = `${path}.backup.${Date.now()}`;
    copyFileSync(path, backupPath);
    log('info', `Backed up ${path} to ${backupPath}`);
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

// =============================================================================
// SSH HARDENING
// =============================================================================

function hardenSSH(options: HardeningOptions): void {
  log('info', '=== SSH Hardening ===');

  const sshdConfig = '/etc/ssh/sshd_config';
  if (!existsSync(sshdConfig)) {
    log('warn', 'SSH config not found, skipping SSH hardening');
    return;
  }

  if (!options.dryRun) {
    backupFile(sshdConfig);
  }

  let config = readFileSync(sshdConfig, 'utf-8');
  const changes: string[] = [];

  // Disable password authentication
  if (!/^PasswordAuthentication\s+no/m.test(config)) {
    config = config.replace(/^#?PasswordAuthentication\s+.*/m, 'PasswordAuthentication no');
    if (!/PasswordAuthentication/m.test(config)) {
      config += '\nPasswordAuthentication no';
    }
    changes.push('Disabled password authentication');
  }

  // Disable root login
  if (!/^PermitRootLogin\s+no/m.test(config)) {
    config = config.replace(/^#?PermitRootLogin\s+.*/m, 'PermitRootLogin no');
    if (!/PermitRootLogin/m.test(config)) {
      config += '\nPermitRootLogin no';
    }
    changes.push('Disabled root login');
  }

  // Disable empty passwords
  if (!/^PermitEmptyPasswords\s+no/m.test(config)) {
    config = config.replace(/^#?PermitEmptyPasswords\s+.*/m, 'PermitEmptyPasswords no');
    if (!/PermitEmptyPasswords/m.test(config)) {
      config += '\nPermitEmptyPasswords no';
    }
    changes.push('Disabled empty passwords');
  }

  // Use SSH protocol 2 only
  if (!/^Protocol\s+2/m.test(config)) {
    config = config.replace(/^#?Protocol\s+.*/m, 'Protocol 2');
    if (!/Protocol/m.test(config)) {
      config += '\nProtocol 2';
    }
    changes.push('Enforced SSH Protocol 2');
  }

  // Limit authentication attempts
  if (!/^MaxAuthTries\s+3/m.test(config)) {
    config = config.replace(/^#?MaxAuthTries\s+.*/m, 'MaxAuthTries 3');
    if (!/MaxAuthTries/m.test(config)) {
      config += '\nMaxAuthTries 3';
    }
    changes.push('Limited auth attempts to 3');
  }

  // Set login grace time
  if (!/^LoginGraceTime\s+60/m.test(config)) {
    config = config.replace(/^#?LoginGraceTime\s+.*/m, 'LoginGraceTime 60');
    if (!/LoginGraceTime/m.test(config)) {
      config += '\nLoginGraceTime 60';
    }
    changes.push('Set login grace time to 60s');
  }

  // Change SSH port if specified
  if (options.sshPort && options.sshPort !== 22) {
    config = config.replace(/^#?Port\s+.*/m, `Port ${options.sshPort}`);
    if (!/^Port\s+/m.test(config)) {
      config += `\nPort ${options.sshPort}`;
    }
    changes.push(`Changed SSH port to ${options.sshPort}`);
  }

  if (changes.length === 0) {
    log('success', 'SSH already hardened');
    return;
  }

  for (const change of changes) {
    log('info', `  ${change}`);
  }

  if (options.dryRun) {
    log('info', '[DRY RUN] Would update SSH config');
    return;
  }

  writeFileSync(sshdConfig, config);
  log('success', 'SSH config updated');

  // Restart SSH service
  try {
    if (commandExists('systemctl')) {
      runCommand('systemctl', ['restart', 'sshd'], { sudo: true });
    } else {
      runCommand('service', ['ssh', 'restart'], { sudo: true });
    }
    log('success', 'SSH service restarted');
  } catch {
    log('warn', 'Could not restart SSH service - manual restart may be needed');
  }
}

// =============================================================================
// FIREWALL SETUP
// =============================================================================

function setupFirewall(options: HardeningOptions): void {
  log('info', '=== Firewall Setup ===');

  if (!isLinux()) {
    log('warn', 'Firewall setup only supported on Linux');
    return;
  }

  // Install ufw if not present
  if (!commandExists('ufw')) {
    log('info', 'Installing ufw...');
    if (!options.dryRun) {
      runCommand('apt-get', ['update'], { sudo: true });
      runCommand('apt-get', ['install', '-y', 'ufw'], { sudo: true });
    }
  }

  const sshPort = options.sshPort || 22;
  const allowedPorts = options.allowedPorts || [sshPort, 80, 443];

  // Ensure SSH port is always allowed
  if (!allowedPorts.includes(sshPort)) {
    allowedPorts.unshift(sshPort);
  }

  if (options.dryRun) {
    log('info', `[DRY RUN] Would configure ufw:`);
    log('info', `  - Default deny incoming`);
    log('info', `  - Default allow outgoing`);
    for (const port of allowedPorts) {
      log('info', `  - Allow port ${port}`);
    }
    return;
  }

  // Reset and configure
  runCommand('ufw', ['--force', 'reset'], { sudo: true });
  runCommand('ufw', ['default', 'deny', 'incoming'], { sudo: true });
  runCommand('ufw', ['default', 'allow', 'outgoing'], { sudo: true });

  // Allow specified ports
  for (const port of allowedPorts) {
    runCommand('ufw', ['allow', port.toString()], { sudo: true });
    log('info', `  Allowed port ${port}`);
  }

  // Enable firewall
  runCommand('ufw', ['--force', 'enable'], { sudo: true });
  log('success', 'Firewall configured and enabled');
}

// =============================================================================
// FAIL2BAN SETUP
// =============================================================================

function setupFail2ban(options: HardeningOptions): void {
  log('info', '=== fail2ban Setup ===');

  if (!isLinux()) {
    log('warn', 'fail2ban setup only supported on Linux');
    return;
  }

  // Install fail2ban if not present
  if (!commandExists('fail2ban-client')) {
    log('info', 'Installing fail2ban...');
    if (!options.dryRun) {
      runCommand('apt-get', ['update'], { sudo: true });
      runCommand('apt-get', ['install', '-y', 'fail2ban'], { sudo: true });
    }
  }

  const sshPort = options.sshPort || 22;
  const jailConfig = `[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3
backend = systemd

[sshd]
enabled = true
port = ${sshPort}
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 86400
`;

  const jailLocalPath = '/etc/fail2ban/jail.local';

  if (options.dryRun) {
    log('info', '[DRY RUN] Would create fail2ban config:');
    log('info', `  - Ban time: 1 hour (24h for SSH)`);
    log('info', `  - Max retries: 3`);
    log('info', `  - SSH jail enabled on port ${sshPort}`);
    return;
  }

  backupFile(jailLocalPath);
  writeFileSync(jailLocalPath, jailConfig);
  log('info', 'Created fail2ban jail config');

  // Restart fail2ban
  try {
    runCommand('systemctl', ['restart', 'fail2ban'], { sudo: true });
    runCommand('systemctl', ['enable', 'fail2ban'], { sudo: true });
    log('success', 'fail2ban configured and enabled');
  } catch {
    log('warn', 'Could not restart fail2ban - manual restart may be needed');
  }
}

// =============================================================================
// AUTOMATIC UPDATES
// =============================================================================

function setupAutoUpdates(options: HardeningOptions): void {
  log('info', '=== Automatic Security Updates ===');

  if (!isLinux()) {
    log('warn', 'Auto-updates setup only supported on Linux');
    return;
  }

  // Install unattended-upgrades
  if (!existsSync('/etc/apt/apt.conf.d/50unattended-upgrades')) {
    log('info', 'Installing unattended-upgrades...');
    if (!options.dryRun) {
      runCommand('apt-get', ['update'], { sudo: true });
      runCommand('apt-get', ['install', '-y', 'unattended-upgrades'], { sudo: true });
    }
  }

  const autoUpgradeConfig = `APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
`;

  const configPath = '/etc/apt/apt.conf.d/20auto-upgrades';

  if (options.dryRun) {
    log('info', '[DRY RUN] Would enable automatic security updates');
    return;
  }

  writeFileSync(configPath, autoUpgradeConfig);
  log('success', 'Automatic security updates enabled');
}

// =============================================================================
// KERNEL HARDENING
// =============================================================================

function hardenKernel(options: HardeningOptions): void {
  log('info', '=== Kernel Hardening ===');

  if (!isLinux()) {
    log('warn', 'Kernel hardening only supported on Linux');
    return;
  }

  const sysctlConfig = `# Clodds Security Hardening
# IP Spoofing protection
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Ignore ICMP broadcast requests
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Disable source packet routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0

# Ignore send redirects
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0

# Block SYN attacks
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2
net.ipv4.tcp_syn_retries = 5

# Log Martians
net.ipv4.conf.all.log_martians = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1

# Ignore ICMP redirects
net.ipv4.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0

# Disable IPv6 if not needed (uncomment if desired)
# net.ipv6.conf.all.disable_ipv6 = 1
# net.ipv6.conf.default.disable_ipv6 = 1

# Protect against time-wait assassination
net.ipv4.tcp_rfc1337 = 1
`;

  const sysctlPath = '/etc/sysctl.d/99-clodds-security.conf';

  if (options.dryRun) {
    log('info', '[DRY RUN] Would apply kernel hardening:');
    log('info', '  - IP spoofing protection');
    log('info', '  - SYN flood protection');
    log('info', '  - ICMP hardening');
    log('info', '  - Disable source routing');
    return;
  }

  backupFile(sysctlPath);
  writeFileSync(sysctlPath, sysctlConfig);

  // Apply sysctl settings
  try {
    runCommand('sysctl', ['--system'], { sudo: true });
    log('success', 'Kernel hardening applied');
  } catch {
    log('warn', 'Could not apply sysctl settings - reboot may be needed');
  }
}

// =============================================================================
// SECURITY AUDIT
// =============================================================================

function runSecurityAudit(): void {
  log('info', '=== Security Audit ===\n');

  const checks: Array<{ name: string; status: 'pass' | 'fail' | 'warn'; message: string }> = [];

  // Check SSH config
  if (existsSync('/etc/ssh/sshd_config')) {
    const sshConfig = readFileSync('/etc/ssh/sshd_config', 'utf-8');

    checks.push({
      name: 'SSH Password Auth',
      status: /^PasswordAuthentication\s+no/m.test(sshConfig) ? 'pass' : 'fail',
      message: /^PasswordAuthentication\s+no/m.test(sshConfig) ? 'Disabled' : 'Enabled (should be disabled)',
    });

    checks.push({
      name: 'SSH Root Login',
      status: /^PermitRootLogin\s+no/m.test(sshConfig) ? 'pass' : 'fail',
      message: /^PermitRootLogin\s+no/m.test(sshConfig) ? 'Disabled' : 'Enabled (should be disabled)',
    });

    const portMatch = sshConfig.match(/^Port\s+(\d+)/m);
    const sshPort = portMatch ? parseInt(portMatch[1]) : 22;
    checks.push({
      name: 'SSH Port',
      status: sshPort !== 22 ? 'pass' : 'warn',
      message: `Port ${sshPort}${sshPort === 22 ? ' (consider changing from default)' : ''}`,
    });
  }

  // Check firewall
  if (commandExists('ufw')) {
    try {
      const ufwStatus = execFileSync('ufw', ['status'], { encoding: 'utf-8' });
      const isActive = ufwStatus.includes('Status: active');
      checks.push({
        name: 'Firewall (ufw)',
        status: isActive ? 'pass' : 'fail',
        message: isActive ? 'Active' : 'Inactive',
      });
    } catch {
      checks.push({
        name: 'Firewall (ufw)',
        status: 'fail',
        message: 'Could not check status',
      });
    }
  } else {
    checks.push({
      name: 'Firewall (ufw)',
      status: 'fail',
      message: 'Not installed',
    });
  }

  // Check fail2ban
  if (commandExists('fail2ban-client')) {
    try {
      execFileSync('fail2ban-client', ['status'], { encoding: 'utf-8' });
      checks.push({
        name: 'fail2ban',
        status: 'pass',
        message: 'Running',
      });
    } catch {
      checks.push({
        name: 'fail2ban',
        status: 'warn',
        message: 'Installed but not running',
      });
    }
  } else {
    checks.push({
      name: 'fail2ban',
      status: 'fail',
      message: 'Not installed',
    });
  }

  // Check auto-updates
  if (existsSync('/etc/apt/apt.conf.d/20auto-upgrades')) {
    const config = readFileSync('/etc/apt/apt.conf.d/20auto-upgrades', 'utf-8');
    const enabled = config.includes('Unattended-Upgrade "1"');
    checks.push({
      name: 'Auto-updates',
      status: enabled ? 'pass' : 'warn',
      message: enabled ? 'Enabled' : 'Disabled',
    });
  } else {
    checks.push({
      name: 'Auto-updates',
      status: 'warn',
      message: 'Not configured',
    });
  }

  // Check for running services
  if (isLinux()) {
    try {
      const services = execSync('ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null', { encoding: 'utf-8' });
      const openPorts = (services.match(/:\d+\s/g) || []).map(p => p.trim().replace(':', ''));
      const uniquePorts = [...new Set(openPorts)].filter(p => p);
      checks.push({
        name: 'Open Ports',
        status: uniquePorts.length <= 5 ? 'pass' : 'warn',
        message: uniquePorts.slice(0, 10).join(', ') + (uniquePorts.length > 10 ? '...' : ''),
      });
    } catch {
      // Skip if can't check
    }
  }

  // Print results
  const statusIcons = { pass: '\x1b[32m✔\x1b[0m', fail: '\x1b[31m✖\x1b[0m', warn: '\x1b[33m⚠\x1b[0m' };

  for (const check of checks) {
    console.log(`${statusIcons[check.status]} ${check.name}: ${check.message}`);
  }

  const passCount = checks.filter(c => c.status === 'pass').length;
  const failCount = checks.filter(c => c.status === 'fail').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;

  console.log(`\n${passCount} passed, ${warnCount} warnings, ${failCount} failed`);

  if (failCount > 0) {
    console.log('\nRun `clodds secure` to fix security issues.');
  }
}

// =============================================================================
// MAIN
// =============================================================================

export async function runSecure(args: string[]): Promise<void> {
  console.log('\n\x1b[1m🔒 Clodds Server Security Hardening\x1b[0m\n');

  // Parse arguments
  const options: HardeningOptions = {
    dryRun: args.includes('--dry-run') || args.includes('-n'),
    interactive: !args.includes('--yes') && !args.includes('-y'),
    sshPort: parseInt(args.find(a => a.startsWith('--ssh-port='))?.split('=')[1] || '22'),
    skipFirewall: args.includes('--skip-firewall'),
    skipFail2ban: args.includes('--skip-fail2ban'),
    skipSsh: args.includes('--skip-ssh'),
    skipUpdates: args.includes('--skip-updates'),
    skipKernel: args.includes('--skip-kernel'),
  };

  // Handle subcommands
  if (args.includes('audit') || args.includes('--audit')) {
    runSecurityAudit();
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: clodds secure [options]

Commands:
  audit              Run security audit without making changes

Options:
  --dry-run, -n      Show what would be changed without modifying anything
  --yes, -y          Skip confirmation prompts
  --ssh-port=PORT    Set SSH port (default: 22)
  --skip-firewall    Skip firewall configuration
  --skip-fail2ban    Skip fail2ban setup
  --skip-ssh         Skip SSH hardening
  --skip-updates     Skip auto-updates setup
  --skip-kernel      Skip kernel hardening
  --help, -h         Show this help message

Examples:
  clodds secure --dry-run          Preview changes
  clodds secure --yes              Apply all hardening without prompts
  clodds secure --ssh-port=2222    Change SSH port to 2222
  clodds secure audit              Run security audit only
`);
    return;
  }

  // Check platform
  if (!isLinux()) {
    log('error', 'Server hardening is only supported on Linux');
    log('info', 'Run `clodds secure audit` to check current security status');
    return;
  }

  // Check permissions
  if (!isRoot() && !options.dryRun) {
    log('warn', 'Some operations require root privileges');
    log('info', 'Run with sudo or as root for full hardening');
  }

  if (options.dryRun) {
    log('info', '=== DRY RUN MODE - No changes will be made ===\n');
  }

  // Confirm before proceeding
  if (options.interactive && !options.dryRun) {
    console.log('This will apply the following security hardening:');
    if (!options.skipSsh) console.log('  • SSH: Disable password auth, root login, limit attempts');
    if (!options.skipFirewall) console.log('  • Firewall: Configure ufw with minimal open ports');
    if (!options.skipFail2ban) console.log('  • fail2ban: Protect against brute force attacks');
    if (!options.skipUpdates) console.log('  • Auto-updates: Enable automatic security patches');
    if (!options.skipKernel) console.log('  • Kernel: Apply sysctl security settings');
    console.log('');

    const proceed = await confirm('Proceed with hardening?');
    if (!proceed) {
      log('info', 'Aborted');
      return;
    }
    console.log('');
  }

  // Run hardening steps
  try {
    if (!options.skipSsh) {
      hardenSSH(options);
      console.log('');
    }

    if (!options.skipFirewall) {
      setupFirewall(options);
      console.log('');
    }

    if (!options.skipFail2ban) {
      setupFail2ban(options);
      console.log('');
    }

    if (!options.skipUpdates) {
      setupAutoUpdates(options);
      console.log('');
    }

    if (!options.skipKernel) {
      hardenKernel(options);
      console.log('');
    }

    log('success', '=== Security hardening complete ===');

    if (!options.dryRun) {
      console.log('\n⚠️  Important:');
      console.log('  1. Make sure you have SSH key access before logging out');
      console.log('  2. Test SSH connection in a new terminal before closing this one');
      if (options.sshPort && options.sshPort !== 22) {
        console.log(`  3. Use: ssh -p ${options.sshPort} user@server`);
      }
      console.log('\nRun `clodds secure audit` to verify security status');
    }
  } catch (err) {
    log('error', `Hardening failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runSecure(process.argv.slice(2)).catch(console.error);
}
