/**
 * Doctor CLI Skill
 *
 * Commands:
 * /doctor - Run full system diagnostics
 * /doctor feeds - Check feed connections
 * /doctor api - Check API health
 * /doctor db - Check database
 * /doctor env - Check environment variables
 */

import { logger } from '../../../utils/logger';

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'all';

  try {
    const { runDoctor } = await import('../../../doctor/index');
    const report = await runDoctor();
    let output = '**System Diagnostics**\n\n';

    for (const check of report.checks) {
      const icon = check.status === 'pass' ? '[OK]' : check.status === 'warn' ? '[WARN]' : check.status === 'fail' ? '[FAIL]' : '[SKIP]';
      output += `${icon} ${check.name}`;
      if (check.message) output += ` - ${check.message}`;
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export default {
  name: 'doctor',
  description: 'System health diagnostics and troubleshooting',
  commands: ['/doctor', '/diag'],
  handle: execute,
};
