/**
 * Permissions CLI Skill
 *
 * Commands:
 * /perms list - List allowlist entries for an agent
 * /perms check <command> - Check if a command is allowed
 * /perms mode [deny|allowlist|full] - Get or set exec security mode
 * /perms allow <pattern> - Add pattern to allowlist
 * /perms remove <id> - Remove allowlist entry
 * /perms policy - View current security policy
 * /perms profiles - List available tool profiles
 * /perms pending - Show pending approval requests
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const mod = await import('../../../permissions/index');
    const { execApprovals, toolPolicies, TOOL_PROFILES, SAFE_BINS } = mod;
    const agentId = parts[1] === '--agent' ? parts[2] || 'default' : 'default';
    // If --agent was used, shift parts so subcommand args still work
    const cmdParts = parts[1] === '--agent' ? parts.slice(3) : parts.slice(1);

    switch (cmd) {
      case 'list':
      case 'ls': {
        const allowlist = execApprovals.getAllowlist(agentId);
        if (allowlist.length === 0) {
          return `**Allowlist for "${agentId}"**\n\nNo entries. Use \`/perms allow <pattern>\` to add one.\n\nSafe bins (always allowed): ${Array.from(SAFE_BINS).slice(0, 10).join(', ')}...`;
        }
        let output = `**Allowlist for "${agentId}"** (${allowlist.length} entries)\n\n`;
        output += '| ID | Pattern | Type | Added |\n|-----|---------|------|-------|\n';
        for (const entry of allowlist) {
          const added = new Date(entry.addedAt).toLocaleDateString();
          const shortId = entry.id.slice(0, 8);
          output += `| ${shortId} | \`${entry.pattern}\` | ${entry.type} | ${added} |\n`;
        }
        return output;
      }

      case 'check': {
        const command = cmdParts.join(' ');
        if (!command) return 'Usage: /perms check <command>\n\nExample: `/perms check npm install`';
        const result = await execApprovals.checkCommand(agentId, command, {
          skipApproval: true,
          waitForApproval: false,
        });
        const status = result.allowed ? 'ALLOWED' : 'DENIED';
        let output = `**Command Check:** \`${command}\`\n\n`;
        output += `Status: **${status}**\n`;
        output += `Reason: ${result.reason}\n`;
        if (result.entry) {
          output += `Matched: \`${result.entry.pattern}\` (${result.entry.type})`;
        }
        return output;
      }

      case 'mode': {
        const newMode = cmdParts[0]?.toLowerCase();
        if (!newMode) {
          const config = execApprovals.getSecurityConfig(agentId);
          return `**Exec Security Mode** (agent: ${agentId})\n\n` +
            `Mode: **${config.mode}**\n` +
            `Ask: **${config.ask}**\n` +
            `Approval Timeout: ${config.approvalTimeout || 60000}ms\n` +
            `Fallback: ${config.fallbackMode || 'deny'}`;
        }
        if (!['deny', 'allowlist', 'full'].includes(newMode)) {
          return 'Invalid mode. Use: `deny`, `allowlist`, or `full`';
        }
        const askMode = cmdParts[1]?.toLowerCase();
        const update: Record<string, string> = { mode: newMode };
        if (askMode && ['off', 'on-miss', 'always'].includes(askMode)) {
          (update as any).ask = askMode;
        }
        execApprovals.setSecurityConfig(agentId, update as any);
        return `Security mode set to **${newMode}**${askMode ? ` (ask: ${askMode})` : ''} for agent "${agentId}".`;
      }

      case 'allow':
      case 'grant': {
        const pattern = cmdParts[0];
        if (!pattern) return 'Usage: /perms allow <pattern> [prefix|glob|regex]\n\nExample: `/perms allow npm prefix`';
        const type = (cmdParts[1] as 'prefix' | 'glob' | 'regex') || 'prefix';
        if (!['prefix', 'glob', 'regex'].includes(type)) {
          return 'Invalid pattern type. Use: `prefix`, `glob`, or `regex`';
        }
        const description = cmdParts.slice(2).join(' ') || undefined;
        const entry = execApprovals.addToAllowlist(agentId, pattern, type, { description });
        return `Added to allowlist for "${agentId}":\n\n` +
          `Pattern: \`${pattern}\`\n` +
          `Type: ${type}\n` +
          `ID: \`${entry.id.slice(0, 8)}\``;
      }

      case 'revoke':
      case 'remove': {
        const entryId = cmdParts[0];
        if (!entryId) return 'Usage: /perms remove <id>\n\nUse `/perms list` to see entry IDs.';
        // Try to find full ID from prefix
        const allowlist = execApprovals.getAllowlist(agentId);
        const match = allowlist.find(e => e.id.startsWith(entryId));
        if (!match) {
          return `No allowlist entry found matching ID \`${entryId}\` for agent "${agentId}".`;
        }
        const removed = execApprovals.removeFromAllowlist(agentId, match.id);
        if (removed) {
          return `Removed allowlist entry \`${match.pattern}\` (${match.type}) from agent "${agentId}".`;
        }
        return `Failed to remove entry.`;
      }

      case 'policy': {
        const config = execApprovals.getSecurityConfig(agentId);
        const allowlist = execApprovals.getAllowlist(agentId);
        return `**Security Policy** (agent: ${agentId})\n\n` +
          `Exec Mode: **${config.mode}**\n` +
          `Ask Mode: **${config.ask}**\n` +
          `Approval Timeout: ${config.approvalTimeout || 60000}ms\n` +
          `Fallback Mode: ${config.fallbackMode || 'deny'}\n` +
          `Allowlist Entries: ${allowlist.length}\n` +
          `Safe Bins: ${SAFE_BINS.size} pre-approved utilities`;
      }

      case 'profiles': {
        let output = '**Tool Profiles**\n\n';
        for (const [name, tools] of Object.entries(TOOL_PROFILES)) {
          const expanded = toolPolicies.expandGroups(tools);
          output += `**${name}:** ${expanded.length === 1 && expanded[0] === '*' ? 'all tools' : expanded.join(', ')}\n`;
        }
        return output;
      }

      case 'pending': {
        const pending = execApprovals.getPendingApprovals();
        if (pending.length === 0) {
          return '**Pending Approvals**\n\nNo pending approval requests.';
        }
        let output = `**Pending Approvals** (${pending.length})\n\n`;
        for (const req of pending) {
          const age = Math.round((Date.now() - req.timestamp.getTime()) / 1000);
          output += `- \`${req.fullCommand}\` (agent: ${req.agentId}, ${age}s ago)\n  ID: \`${req.id.slice(0, 8)}\`\n`;
        }
        return output;
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Permissions Commands**

  /perms list                        - List allowlist entries
  /perms check <command>             - Check if command is allowed
  /perms mode [deny|allowlist|full]  - Get or set exec security mode
  /perms allow <pattern> [type]      - Add to allowlist (prefix|glob|regex)
  /perms remove <id>                 - Remove allowlist entry
  /perms policy                      - View security policy
  /perms profiles                    - List tool profiles
  /perms pending                     - Show pending approvals

Add \`--agent <id>\` after subcommand to target a specific agent.`;
}

export default {
  name: 'permissions',
  description: 'Command approvals, tool policies, and exec security',
  commands: ['/perms', '/permissions'],
  handle: execute,
};
