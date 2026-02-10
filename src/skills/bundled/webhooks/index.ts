/**
 * Webhooks CLI Skill
 *
 * Commands:
 * /webhooks list - List registered webhooks
 * /webhooks register <id> <path> - Register webhook endpoint
 * /webhooks unregister <id> - Remove webhook
 * /webhooks enable <id> - Enable webhook
 * /webhooks disable <id> - Disable webhook
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const { createWebhookManager } = await import('../../../automation/webhooks');
    const manager = createWebhookManager();

    switch (cmd) {
      case 'list': {
        const hooks = manager.list();
        if (!hooks.length) return 'No webhooks registered.';
        let output = `**Registered Webhooks** (${hooks.length})\n\n`;
        for (const h of hooks) {
          output += `[${h.id}] ${h.path}\n`;
          output += `  Description: ${h.description || '(none)'}\n`;
          output += `  Enabled: ${h.enabled !== false ? 'yes' : 'no'}\n`;
          output += `  Triggers: ${h.triggerCount}\n\n`;
        }
        return output;
      }

      case 'register': {
        const id = parts[1];
        const path = parts[2];
        if (!id || !path) return 'Usage: /webhooks register <id> <path> [--secret <key>]';
        const secretIdx = parts.indexOf('--secret');
        const secret = secretIdx >= 0 ? parts[secretIdx + 1] : undefined;
        manager.register(id, path, async () => {}, { secret });
        return `Webhook registered: ${id} at ${path}`;
      }

      case 'unregister':
      case 'remove':
      case 'delete': {
        if (!parts[1]) return 'Usage: /webhooks unregister <webhook-id>';
        const removed = manager.unregister(parts[1]);
        return removed ? `Webhook ${parts[1]} removed.` : `Webhook ${parts[1]} not found.`;
      }

      case 'enable': {
        if (!parts[1]) return 'Usage: /webhooks enable <webhook-id>';
        manager.setEnabled(parts[1], true);
        return `Webhook ${parts[1]} enabled.`;
      }

      case 'disable': {
        if (!parts[1]) return 'Usage: /webhooks disable <webhook-id>';
        manager.setEnabled(parts[1], false);
        return `Webhook ${parts[1]} disabled.`;
      }

      case 'get': {
        if (!parts[1]) return 'Usage: /webhooks get <webhook-id>';
        const hook = manager.get(parts[1]);
        if (!hook) return `Webhook ${parts[1]} not found.`;
        let output = `**Webhook: ${hook.id}**\n\n`;
        output += `Path: ${hook.path}\n`;
        output += `Description: ${hook.description || '(none)'}\n`;
        output += `Enabled: ${hook.enabled !== false ? 'yes' : 'no'}\n`;
        output += `HMAC secret: ${hook.secret ? 'configured' : 'none'}\n`;
        output += `Triggers: ${hook.triggerCount}\n`;
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
  return `**Webhooks Commands**

  /webhooks list                     - List webhooks
  /webhooks register <id> <path>     - Register endpoint
  /webhooks unregister <id>          - Remove webhook
  /webhooks enable <id>              - Enable webhook
  /webhooks disable <id>             - Disable webhook
  /webhooks get <id>                 - Webhook details

Webhooks use HMAC-SHA256 for payload verification.`;
}

export default {
  name: 'webhooks',
  description: 'Webhook management with HMAC signing and rate limiting',
  commands: ['/webhooks', '/webhook'],
  handle: execute,
};
