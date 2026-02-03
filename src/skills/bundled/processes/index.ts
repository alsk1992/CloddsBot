/**
 * Processes CLI Skill
 *
 * Commands:
 * /processes - List running processes
 * /processes run <cmd> - Run a command
 * /processes info - Current process info
 * /processes kill <pid> - Kill a process tree
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'info';

  try {
    const proc = await import('../../../process/index');

    switch (cmd) {
      case 'info': {
        const info = proc.getProcessInfo();
        let output = '**Process Info**\n\n';
        output += `PID: ${info.pid}\n`;
        output += `PPID: ${info.ppid}\n`;
        output += `CWD: ${info.cwd}\n`;
        output += `Uptime: ${info.uptime.toFixed(0)}s\n`;
        output += `Memory: ${(info.memory.heapUsed / 1024 / 1024).toFixed(1)}MB heap\n`;
        return output;
      }

      case 'run':
      case 'exec': {
        const command = parts.slice(1).join(' ');
        if (!command) return 'Usage: /processes run <command>';
        const result = await proc.execute(command, { timeout: 30000 });
        let output = `**Exit: ${result.exitCode}** (${result.duration}ms)\n`;
        if (result.stdout) output += `\n\`\`\`\n${result.stdout.slice(0, 2000)}\n\`\`\``;
        if (result.stderr) output += `\nStderr:\n\`\`\`\n${result.stderr.slice(0, 500)}\n\`\`\``;
        return output;
      }

      case 'kill': {
        const pid = parseInt(parts[1]);
        if (isNaN(pid)) return 'Usage: /processes kill <pid>';
        proc.killTree(pid);
        return `Sent SIGTERM to process tree rooted at PID ${pid}.`;
      }

      case 'check': {
        const bin = parts[1];
        if (!bin) return 'Usage: /processes check <binary-name>';
        const exists = proc.commandExists(bin);
        return exists ? `\`${bin}\` is available on PATH.` : `\`${bin}\` not found on PATH.`;
      }

      case 'pool': {
        const pool = proc.createProcessPool();
        const stats = pool.getStats();
        let output = '**Process Pool Status**\n\n';
        output += `Active: ${stats.active}\n`;
        output += `Idle: ${stats.idle}\n`;
        output += `Total: ${stats.total}`;
        await pool.shutdown();
        return output;
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Process error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Processes Commands**

  /processes                         - Current process info
  /processes run <command>           - Execute a command
  /processes kill <pid>              - Kill process tree
  /processes check <binary>          - Check if binary exists
  /processes pool                    - Process pool status`;
}

export default {
  name: 'processes',
  description: 'Process management - spawn, monitor, and control child processes',
  commands: ['/processes', '/proc'],
  handle: execute,
};
