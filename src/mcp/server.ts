/**
 * MCP Server Mode - Expose all Clodds skills as MCP tools via stdio
 *
 * Reads JSON-RPC from stdin, writes to stdout, logs to stderr.
 * Protocol version: 2024-11-05
 */

import { createInterface } from 'readline';
import type { JsonRpcRequest, JsonRpcResponse, McpTool } from './index.js';

// =============================================================================
// TYPES
// =============================================================================

interface McpServerCapabilities {
  tools?: Record<string, never>;
}

interface McpInitializeResult {
  protocolVersion: string;
  capabilities: McpServerCapabilities;
  serverInfo: { name: string; version: string };
}

// =============================================================================
// HELPERS
// =============================================================================

function sendResponse(res: JsonRpcResponse): void {
  const json = JSON.stringify(res);
  process.stdout.write(json + '\n');
}

function errorResponse(id: string | number | undefined, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// =============================================================================
// SKILL LOADER (lazy)
// =============================================================================

let skillManifest: string[] | null = null;
let executeSkill: ((msg: string) => Promise<{ handled: boolean; response?: string; error?: string }>) | null = null;

async function ensureSkills(): Promise<void> {
  if (skillManifest && executeSkill) return;
  const executor = await import('../skills/executor.js');
  skillManifest = executor.getSkillManifest();
  executeSkill = executor.executeSkillCommand;
}

// =============================================================================
// TOOL MAPPING
// =============================================================================

async function listTools(): Promise<McpTool[]> {
  await ensureSkills();
  return skillManifest!.map((name) => ({
    name: `clodds_${name.replace(/-/g, '_')}`,
    description: `Clodds skill: ${name}`,
    inputSchema: {
      type: 'object',
      properties: {
        args: { type: 'string', description: 'Arguments to pass to the skill command' },
      },
    },
  }));
}

async function callTool(toolName: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  await ensureSkills();

  // clodds_trading_polymarket → trading-polymarket
  const skillName = toolName.replace(/^clodds_/, '').replace(/_/g, '-');
  const skillArgs = typeof args.args === 'string' ? args.args : '';

  // Build command string like "/trading-polymarket balance"
  const command = `/${skillName} ${skillArgs}`.trim();

  const result = await executeSkill!(command);

  if (!result.handled) {
    return {
      content: [{ type: 'text', text: `Unknown skill: ${skillName}` }],
      isError: true,
    };
  }

  if (result.error) {
    return {
      content: [{ type: 'text', text: result.error }],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text', text: result.response || '(no output)' }],
  };
}

// =============================================================================
// REQUEST HANDLER
// =============================================================================

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  switch (req.method) {
    case 'initialize': {
      const result: McpInitializeResult = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'clodds', version: '0.1.0' },
      };
      return { jsonrpc: '2.0', id: req.id, result };
    }

    case 'notifications/initialized':
      // No response for notifications (no id)
      return null;

    case 'tools/list': {
      const tools = await listTools();
      return { jsonrpc: '2.0', id: req.id, result: { tools } };
    }

    case 'tools/call': {
      const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name) {
        return errorResponse(req.id, -32602, 'Missing tool name');
      }
      const toolResult = await callTool(params.name, params.arguments ?? {});
      return { jsonrpc: '2.0', id: req.id, result: toolResult };
    }

    default:
      return errorResponse(req.id, -32601, `Method not found: ${req.method}`);
  }
}

// =============================================================================
// STDIO TRANSPORT
// =============================================================================

export async function startMcpServer(): Promise<void> {
  // Redirect log output to stderr so stdout is clean for JSON-RPC
  process.env.LOG_LEVEL = 'silent';

  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed);
    } catch {
      sendResponse(errorResponse(undefined, -32700, 'Parse error'));
      return;
    }

    try {
      const response = await handleRequest(req);
      if (response) sendResponse(response);
    } catch (err: any) {
      sendResponse(errorResponse(req.id, -32603, err.message || 'Internal error'));
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });

  // Signal readiness via stderr
  process.stderr.write('Clodds MCP server started (stdio)\n');
}
