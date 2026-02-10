/**
 * MCP CLI Skill
 *
 * Commands:
 * /mcp list - List MCP servers
 * /mcp connect - Connect all configured servers
 * /mcp disconnect <name> - Disconnect a server
 * /mcp tools [server] - List available tools
 * /mcp call <tool> [args] - Call a tool
 * /mcp health - Check server health
 */

import { logger } from '../../../utils/logger';

function helpText(): string {
  return `**MCP Commands**

  /mcp list                          - List configured MCP servers
  /mcp connect                       - Connect all configured servers
  /mcp disconnect <name>             - Disconnect a server
  /mcp tools [server]                - List available tools
  /mcp call <server:tool> [json]     - Call a tool with JSON args
  /mcp health                        - Check health of all servers

**Examples:**
  /mcp list
  /mcp tools
  /mcp call myserver:search {"query": "test"}
  /mcp health`;
}

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const {
      createMcpRegistry,
      loadMcpConfig,
      initializeFromConfig,
    } = await import('../../../mcp/index');

    const registry = createMcpRegistry();
    const config = loadMcpConfig();
    initializeFromConfig(registry, config);

    switch (cmd) {
      case 'list':
      case 'ls': {
        const servers = registry.listServers();
        if (servers.length === 0) {
          return '**MCP Servers**\n\nNo MCP servers configured.\n\nAdd servers to `.mcp.json` or `~/.config/clodds/mcp.json`:\n```json\n{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "@my/mcp-server"]\n    }\n  }\n}\n```';
        }

        let output = `**MCP Servers** (${servers.length})\n\n`;
        for (const name of servers) {
          const client = registry.getClient(name);
          const status = client?.connected ? 'connected' : 'disconnected';
          const info = client?.serverInfo;
          output += `- **${name}** [${status}]`;
          if (info) {
            output += ` (${info.name} v${info.version}, protocol ${info.protocolVersion})`;
          }
          output += '\n';
        }
        return output;
      }

      case 'connect': {
        const servers = registry.listServers();
        if (servers.length === 0) {
          return 'No MCP servers configured. Add servers to `.mcp.json`.';
        }

        await registry.connectAll();

        let output = '**MCP Connect Results**\n\n';
        for (const name of servers) {
          const client = registry.getClient(name);
          const status = client?.connected ? 'connected' : 'failed';
          output += `- ${name}: ${status}`;
          if (client?.serverInfo) {
            output += ` (${client.serverInfo.name} v${client.serverInfo.version})`;
          }
          output += '\n';
        }
        return output;
      }

      case 'disconnect': {
        const name = parts[1];
        if (!name) return 'Usage: /mcp disconnect <name>';

        const client = registry.getClient(name);
        if (!client) {
          return `Server **${name}** not found. Use \`/mcp list\` to see servers.`;
        }

        await client.disconnect();
        return `Disconnected from **${name}**.`;
      }

      case 'tools': {
        const serverFilter = parts[1];

        // Need to connect first to list tools
        await registry.connectAll();

        const allTools = await registry.getAllTools();
        const tools = serverFilter
          ? allTools.filter(t => t.server === serverFilter)
          : allTools;

        if (tools.length === 0) {
          return serverFilter
            ? `No tools found for server **${serverFilter}**. Check connection with \`/mcp health\`.`
            : 'No tools available. Connect MCP servers first with `/mcp connect`.';
        }

        let output = `**MCP Tools** (${tools.length})\n\n`;
        let currentServer = '';
        for (const tool of tools) {
          if (tool.server !== currentServer) {
            currentServer = tool.server;
            output += `\n**${currentServer}:**\n`;
          }
          output += `  - \`${tool.server}:${tool.name}\``;
          if (tool.description) output += ` - ${tool.description}`;
          output += '\n';
          if (tool.inputSchema?.properties) {
            const params = Object.keys(tool.inputSchema.properties);
            const required = tool.inputSchema.required || [];
            output += `    Params: ${params.map(p => required.includes(p) ? `${p}*` : p).join(', ')}\n`;
          }
        }
        return output;
      }

      case 'call': {
        const toolName = parts[1];
        if (!toolName) return 'Usage: /mcp call <server:tool> [json args]\n\nExample: /mcp call myserver:search {"query": "test"}';

        // Parse JSON args from remaining parts
        const argsStr = parts.slice(2).join(' ');
        let toolArgs: Record<string, unknown> = {};
        if (argsStr) {
          try {
            toolArgs = JSON.parse(argsStr);
          } catch {
            return `Invalid JSON arguments: ${argsStr}\n\nProvide args as valid JSON, e.g.: {"key": "value"}`;
          }
        }

        await registry.connectAll();
        const result = await registry.callTool(toolName, toolArgs);

        if (result.isError) {
          return `**Tool Error**\n\n${result.content.map(c => c.text || '').join('\n')}`;
        }

        let output = `**Tool Result: ${toolName}**\n\n`;
        for (const c of result.content) {
          if (c.type === 'text' && c.text) output += c.text + '\n';
          else if (c.type === 'resource') output += `[Resource: ${c.uri}]\n`;
          else if (c.type === 'image') output += `[Image: ${c.mimeType}]\n`;
        }
        return output;
      }

      case 'health': {
        const servers = registry.listServers();
        if (servers.length === 0) {
          return 'No MCP servers configured.';
        }

        await registry.connectAll();
        const health = await registry.checkHealth();

        let output = '**MCP Server Health**\n\n';
        for (const [name, healthy] of Object.entries(health)) {
          output += `- ${name}: ${healthy ? 'healthy' : 'unhealthy'}\n`;
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

export default {
  name: 'mcp',
  description: 'Model Context Protocol server management and tool integration',
  commands: ['/mcp'],
  handle: execute,
};
