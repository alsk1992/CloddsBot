/**
 * Auto-Reply CLI Skill
 *
 * Commands:
 * /autoreply list - List all rules
 * /autoreply add <pattern> <response> - Add rule
 * /autoreply remove <id> - Remove rule
 * /autoreply enable <id> - Enable rule
 * /autoreply disable <id> - Disable rule
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const { createAutoReplyService } = await import('../../../auto-reply/index');
    const service = createAutoReplyService();

    switch (cmd) {
      case 'list':
      case 'ls': {
        const rules = service.listRules();
        if (!rules.length) return 'No auto-reply rules configured. Use `/autoreply add` to create one.';
        let output = `**Auto-Reply Rules** (${rules.length})\n\n`;
        for (const rule of rules) {
          output += `[${rule.id}] ${rule.name} (priority: ${rule.priority})\n`;
          output += `  Enabled: ${rule.enabled ? 'yes' : 'no'}\n`;
          output += `  Conditions: ${rule.conditions.map(c => `${c.type}:${c.pattern || c.keywords?.join(',') || ''}`).join(', ')}\n`;
          if (rule.description) output += `  Description: ${rule.description}\n`;
          if (rule.cooldownMs) output += `  Cooldown: ${rule.cooldownMs / 1000}s\n`;
          output += '\n';
        }
        return output;
      }

      case 'add': {
        const pattern = parts[1];
        const response = parts.slice(2).join(' ');
        if (!pattern || !response) return 'Usage: /autoreply add <pattern> <response>';
        const id = `rule-${Date.now()}`;
        service.addRule({
          id,
          name: `Rule: ${pattern}`,
          enabled: true,
          priority: 0,
          conditions: [{ type: 'contains', pattern, ignoreCase: true }],
          response: { type: 'text', content: response },
        });
        service.save();
        return `Auto-reply rule added: id=${id}, pattern="${pattern}", response="${response}"`;
      }

      case 'add-regex': {
        const regex = parts[1];
        const response = parts.slice(2).join(' ');
        if (!regex || !response) return 'Usage: /autoreply add-regex <regex-pattern> <response>';
        const id = `rule-${Date.now()}`;
        service.addRule({
          id,
          name: `Regex: ${regex}`,
          enabled: true,
          priority: 0,
          conditions: [{ type: 'regex', pattern: regex, ignoreCase: true }],
          response: { type: 'text', content: response },
        });
        service.save();
        return `Auto-reply regex rule added: id=${id}, pattern=/${regex}/i`;
      }

      case 'add-keywords': {
        const keywords = parts[1]?.split(',');
        const response = parts.slice(2).join(' ');
        if (!keywords?.length || !response) return 'Usage: /autoreply add-keywords <kw1,kw2,...> <response>';
        const id = `rule-${Date.now()}`;
        service.addRule({
          id,
          name: `Keywords: ${keywords.join(',')}`,
          enabled: true,
          priority: 0,
          conditions: [{ type: 'keywords', keywords, ignoreCase: true, minKeywords: 1 }],
          response: { type: 'text', content: response },
        });
        service.save();
        return `Auto-reply keyword rule added: id=${id}, keywords=[${keywords.join(', ')}]`;
      }

      case 'remove':
      case 'delete': {
        if (!parts[1]) return 'Usage: /autoreply remove <id>';
        const removed = service.removeRule(parts[1]);
        if (removed) {
          service.save();
          return `Auto-reply rule \`${parts[1]}\` removed.`;
        }
        return `Rule \`${parts[1]}\` not found.`;
      }

      case 'enable': {
        if (!parts[1]) return 'Usage: /autoreply enable <id>';
        const enabled = service.enableRule(parts[1]);
        if (enabled) {
          service.save();
          return `Auto-reply rule \`${parts[1]}\` enabled.`;
        }
        return `Rule \`${parts[1]}\` not found.`;
      }

      case 'disable': {
        if (!parts[1]) return 'Usage: /autoreply disable <id>';
        const disabled = service.disableRule(parts[1]);
        if (disabled) {
          service.save();
          return `Auto-reply rule \`${parts[1]}\` disabled.`;
        }
        return `Rule \`${parts[1]}\` not found.`;
      }

      case 'get':
      case 'info': {
        if (!parts[1]) return 'Usage: /autoreply get <id>';
        const rule = service.getRule(parts[1]);
        if (!rule) return `Rule \`${parts[1]}\` not found.`;
        let output = `**Rule: ${rule.name}** (${rule.id})\n\n`;
        output += `Enabled: ${rule.enabled ? 'yes' : 'no'}\n`;
        output += `Priority: ${rule.priority}\n`;
        output += `Conditions:\n`;
        for (const c of rule.conditions) {
          output += `  - ${c.type}: ${c.pattern || c.keywords?.join(', ') || '(all)'}\n`;
        }
        output += `Response: ${rule.response.content}\n`;
        if (rule.cooldownMs) output += `Cooldown: ${rule.cooldownMs / 1000}s${rule.perUserCooldown ? ' (per-user)' : ''}\n`;
        if (rule.timeWindow) output += `Time window: ${rule.timeWindow.startHour}:00 - ${rule.timeWindow.endHour}:00\n`;
        if (rule.channels?.length) output += `Channels: ${rule.channels.join(', ')}\n`;
        return output;
      }

      case 'clear-cooldowns': {
        service.clearCooldowns();
        return 'All auto-reply cooldowns cleared.';
      }

      case 'reload': {
        service.load();
        const rules = service.listRules();
        return `Reloaded ${rules.length} auto-reply rules from disk.`;
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Auto-Reply Commands**

  /autoreply list                              - List all rules
  /autoreply add <pattern> <response>          - Add contains-match rule
  /autoreply add-regex <regex> <response>      - Add regex rule
  /autoreply add-keywords <kw1,kw2> <response> - Add keyword rule
  /autoreply remove <id>                       - Remove a rule
  /autoreply enable <id>                       - Enable a rule
  /autoreply disable <id>                      - Disable a rule
  /autoreply get <id>                          - Rule details
  /autoreply clear-cooldowns                   - Clear all cooldowns
  /autoreply reload                            - Reload rules from disk

Rules saved to ~/.clodds/auto-reply-rules.json`;
}

export default {
  name: 'auto-reply',
  description: 'Automatic response rules, patterns, and scheduled messages',
  commands: ['/autoreply', '/ar'],
  handle: execute,
};
