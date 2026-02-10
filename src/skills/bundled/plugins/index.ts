/**
 * Plugins CLI Skill
 *
 * Commands:
 * /plugins list - List registered plugins and their state
 * /plugins install <path> - Load plugins from a directory
 * /plugins remove <id> - Unregister a plugin
 * /plugins enable <id> - Enable a plugin
 * /plugins disable <id> - Disable a plugin
 * /plugins info <id> - Show plugin details
 * /plugins commands - List all plugin commands
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const mod = await import('../../../plugins/index');
    const pluginService = mod.createPluginService();

    switch (cmd) {
      case 'list':
      case 'ls': {
        const all = pluginService.list();
        if (all.length === 0) {
          return '**Installed Plugins**\n\nNo plugins registered. Use `/plugins install <path>` to load from a directory.';
        }
        let output = `**Installed Plugins** (${all.length})\n\n`;
        output += '| Name | Version | State | Commands |\n|------|---------|-------|----------|\n';
        for (const reg of all) {
          const { meta } = reg.plugin;
          const cmdCount = reg.commands.size;
          const stateLabel = reg.state === 'enabled' ? 'Enabled' :
            reg.state === 'error' ? `Error: ${reg.error}` : reg.state;
          output += `| ${meta.name} | ${meta.version} | ${stateLabel} | ${cmdCount} |\n`;
        }
        return output;
      }

      case 'install':
      case 'load': {
        const dir = parts[1];
        if (!dir) return 'Usage: /plugins install <directory>\n\nLoads all .js/.mjs plugin files from the given directory.';
        const count = await pluginService.loadFromDirectory(dir);
        if (count === 0) {
          return `No plugins found in \`${dir}\`. Plugins must export a \`meta\` object with at least an \`id\` field.`;
        }
        return `Loaded **${count}** plugin${count !== 1 ? 's' : ''} from \`${dir}\`.`;
      }

      case 'remove':
      case 'uninstall': {
        const pluginId = parts[1];
        if (!pluginId) return 'Usage: /plugins remove <id>\n\nUse `/plugins list` to see plugin IDs.';
        const existing = pluginService.get(pluginId);
        if (!existing) {
          return `Plugin \`${pluginId}\` not found.`;
        }
        pluginService.unregister(pluginId);
        return `Unregistered plugin **${existing.plugin.meta.name}** (\`${pluginId}\`).`;
      }

      case 'enable': {
        const pluginId = parts[1];
        if (!pluginId) return 'Usage: /plugins enable <id>';
        const existing = pluginService.get(pluginId);
        if (!existing) {
          return `Plugin \`${pluginId}\` not found.`;
        }
        if (existing.state === 'enabled') {
          return `Plugin **${existing.plugin.meta.name}** is already enabled.`;
        }
        try {
          await pluginService.enable(pluginId);
          return `Enabled plugin **${existing.plugin.meta.name}**.`;
        } catch (e) {
          return `Failed to enable plugin \`${pluginId}\`: ${e instanceof Error ? e.message : String(e)}`;
        }
      }

      case 'disable': {
        const pluginId = parts[1];
        if (!pluginId) return 'Usage: /plugins disable <id>';
        const existing = pluginService.get(pluginId);
        if (!existing) {
          return `Plugin \`${pluginId}\` not found.`;
        }
        if (existing.state !== 'enabled') {
          return `Plugin **${existing.plugin.meta.name}** is not currently enabled.`;
        }
        await pluginService.disable(pluginId);
        return `Disabled plugin **${existing.plugin.meta.name}**.`;
      }

      case 'info': {
        const pluginId = parts[1];
        if (!pluginId) return 'Usage: /plugins info <id>';
        const existing = pluginService.get(pluginId);
        if (!existing) {
          return `Plugin \`${pluginId}\` not found.`;
        }
        const { meta } = existing.plugin;
        let output = `**Plugin: ${meta.name}**\n\n`;
        output += `ID: \`${meta.id}\`\n`;
        output += `Version: ${meta.version}\n`;
        output += `State: ${existing.state}\n`;
        if (meta.description) output += `Description: ${meta.description}\n`;
        if (meta.author) output += `Author: ${meta.author}\n`;
        if (meta.homepage) output += `Homepage: ${meta.homepage}\n`;
        if (meta.dependencies && meta.dependencies.length > 0) {
          output += `Dependencies: ${meta.dependencies.join(', ')}\n`;
        }
        output += `\nCommands: ${existing.commands.size}\n`;
        output += `Tools: ${existing.tools.size}\n`;
        output += `Message hooks: ${existing.hooks.message.length}\n`;
        output += `Response hooks: ${existing.hooks.response.length}\n`;
        if (existing.error) {
          output += `\nError: ${existing.error}`;
        }
        return output;
      }

      case 'commands':
      case 'cmds': {
        const commands = pluginService.listCommands();
        if (commands.length === 0) {
          return '**Plugin Commands**\n\nNo commands registered. Enable a plugin with `/plugins enable <id>` first.';
        }
        let output = `**Plugin Commands** (${commands.length})\n\n`;
        output += '| Command | Plugin | Description |\n|---------|--------|-------------|\n';
        for (const cmd of commands) {
          output += `| /${cmd.name} | ${cmd.pluginId} | ${cmd.description || '-'} |\n`;
        }
        return output;
      }

      case 'tools': {
        const tools = pluginService.getTools();
        if (tools.length === 0) {
          return '**Plugin Tools**\n\nNo tools registered by plugins.';
        }
        let output = `**Plugin Tools** (${tools.length})\n\n`;
        for (const tool of tools) {
          output += `- **${tool.name}**: ${tool.description}\n`;
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
  return `**Plugin Commands**

  /plugins list                      - List installed plugins
  /plugins install <directory>       - Load plugins from directory
  /plugins remove <id>              - Unregister a plugin
  /plugins enable <id>              - Enable a plugin
  /plugins disable <id>             - Disable a plugin
  /plugins info <id>                - Show plugin details
  /plugins commands                  - List plugin commands
  /plugins tools                     - List plugin tools`;
}

export default {
  name: 'plugins',
  description: 'Plugin management, installation, and lifecycle control',
  commands: ['/plugins', '/plugin'],
  handle: execute,
};
