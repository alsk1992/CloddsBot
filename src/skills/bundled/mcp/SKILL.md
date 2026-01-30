---
name: mcp
description: "Model Context Protocol server management and tool integration"
emoji: "🔌"
---

# MCP - Complete API Reference

Manage Model Context Protocol (MCP) servers, external tools, and AI integrations.

---

## Chat Commands

### Server Management

```
/mcp list                                   List configured MCP servers
/mcp status                                 Check server connection status
/mcp add <name> <command>                   Add new MCP server
/mcp remove <name>                          Remove MCP server
/mcp restart <name>                         Restart server
```

### Tool Interaction

```
/mcp tools                                  List available tools
/mcp tools <server>                         Tools from specific server
/mcp call <server> <tool> [args]            Call a tool directly
/mcp resources <server>                     List server resources
```

### Configuration

```
/mcp config <server>                        View server config
/mcp config <server> set <key> <value>      Update config
/mcp logs <server>                          View server logs
```

---

## TypeScript API Reference

### Create MCP Client

```typescript
import { createMCPClient } from 'clodds/mcp';

const mcp = createMCPClient({
  // Transport
  transport: 'stdio',  // 'stdio' | 'sse'

  // Server command
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],

  // Options
  timeout: 30000,
  retries: 3,
});
```

### Connect to Server

```typescript
// Connect
await mcp.connect();

// Check status
const status = mcp.getStatus();
console.log(`Connected: ${status.connected}`);
console.log(`Server: ${status.serverInfo?.name}`);
console.log(`Version: ${status.serverInfo?.version}`);

// Disconnect
await mcp.disconnect();
```

### List Tools

```typescript
// Get available tools
const tools = await mcp.listTools();

for (const tool of tools) {
  console.log(`${tool.name}: ${tool.description}`);
  console.log(`  Input schema: ${JSON.stringify(tool.inputSchema)}`);
}
```

### Call Tool

```typescript
// Call a tool
const result = await mcp.callTool({
  name: 'read_file',
  arguments: {
    path: '/path/to/file.txt',
  },
});

console.log(`Result: ${JSON.stringify(result)}`);
```

### List Resources

```typescript
// Get available resources
const resources = await mcp.listResources();

for (const resource of resources) {
  console.log(`${resource.uri}: ${resource.name}`);
  console.log(`  Type: ${resource.mimeType}`);
}

// Read a resource
const content = await mcp.readResource('file:///path/to/file.txt');
console.log(content);
```

### List Prompts

```typescript
// Get available prompts
const prompts = await mcp.listPrompts();

for (const prompt of prompts) {
  console.log(`${prompt.name}: ${prompt.description}`);
}

// Get prompt content
const prompt = await mcp.getPrompt('code-review', {
  code: 'function add(a, b) { return a + b; }',
});

console.log(prompt.messages);
```

### MCP Registry

```typescript
import { createMCPRegistry } from 'clodds/mcp';

const registry = createMCPRegistry({
  configPath: './mcp-servers.json',
});

// Add server
registry.addServer({
  name: 'filesystem',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user'],
  env: {},
});

// List servers
const servers = registry.listServers();

// Get server
const server = registry.getServer('filesystem');

// Remove server
registry.removeServer('filesystem');

// Start all servers
await registry.startAll();

// Stop all servers
await registry.stopAll();
```

---

## Popular MCP Servers

| Server | Purpose | Install |
|--------|---------|---------|
| **filesystem** | File operations | `@modelcontextprotocol/server-filesystem` |
| **github** | GitHub API | `@modelcontextprotocol/server-github` |
| **postgres** | Database queries | `@modelcontextprotocol/server-postgres` |
| **brave-search** | Web search | `@modelcontextprotocol/server-brave-search` |
| **puppeteer** | Browser automation | `@modelcontextprotocol/server-puppeteer` |

---

## Server Configuration

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
      "env": {}
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_..."
      }
    }
  }
}
```

---

## CLI Commands

```bash
# List MCP servers
clodds mcp list

# Add MCP server
clodds mcp add filesystem "npx -y @modelcontextprotocol/server-filesystem /home"

# Test server connection
clodds mcp test filesystem

# Remove server
clodds mcp remove filesystem
```

---

## Best Practices

1. **Use official servers** — Start with well-tested MCP servers
2. **Limit file access** — Restrict filesystem server to specific directories
3. **Secure credentials** — Use env vars for tokens, not command args
4. **Monitor logs** — Check server logs for errors
5. **Timeout handling** — Set appropriate timeouts for slow operations
