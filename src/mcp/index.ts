/**
 * MCP (Model Context Protocol) - Clawdbot-style server integration
 *
 * Features:
 * - Full MCP protocol support (tools, resources, prompts)
 * - JSON-RPC 2.0 transport
 * - Protocol schemas & validation
 * - Command registry & discovery
 * - Server lifecycle management
 * - mcporter skill integration
 * - Stdio and SSE transports
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';

// =============================================================================
// MCP PROTOCOL TYPES
// =============================================================================

/** JSON-RPC 2.0 Request */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 Response */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

/** JSON-RPC 2.0 Error */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** MCP Capability */
export interface McpCapability {
  name: string;
  version?: string;
}

/** MCP Server Info */
export interface McpServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
  capabilities?: McpCapability[];
}

/** MCP Tool Definition */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

/** MCP Resource */
export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** MCP Resource Template */
export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** MCP Prompt */
export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/** MCP Content */
export interface McpContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
}

/** MCP Tool Call Result */
export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

/** MCP Resource Contents */
export interface McpResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

/** JSON Schema (simplified) */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  additionalProperties?: boolean | JsonSchema;
}

// =============================================================================
// MCP SERVER CONFIG
// =============================================================================

export interface McpServerConfig {
  /** Unique server name */
  name: string;
  /** Command to run the server */
  command: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
  /** Transport type */
  transport?: 'stdio' | 'sse';
  /** SSE endpoint for sse transport */
  sseEndpoint?: string;
  /** Auto-start on init */
  autoStart?: boolean;
  /** Retry on failure */
  retryOnFailure?: boolean;
  /** Max retries */
  maxRetries?: number;
}

// =============================================================================
// MCP CLIENT
// =============================================================================

export interface McpClient {
  /** Server info */
  serverInfo?: McpServerInfo;
  /** Is connected */
  connected: boolean;

  /** Connect to server */
  connect(): Promise<void>;
  /** Disconnect from server */
  disconnect(): Promise<void>;

  /** List available tools */
  listTools(): Promise<McpTool[]>;
  /** Call a tool */
  callTool(name: string, params: Record<string, unknown>): Promise<McpToolResult>;

  /** List available resources */
  listResources(): Promise<McpResource[]>;
  /** List resource templates */
  listResourceTemplates(): Promise<McpResourceTemplate[]>;
  /** Read a resource */
  readResource(uri: string): Promise<McpResourceContents>;

  /** List available prompts */
  listPrompts(): Promise<McpPrompt[]>;
  /** Get a prompt */
  getPrompt(name: string, args?: Record<string, string>): Promise<McpContent[]>;
}

// =============================================================================
// MCP REGISTRY
// =============================================================================

export interface McpRegistry {
  /** Register a server config */
  register(config: McpServerConfig): void;
  /** Unregister a server */
  unregister(name: string): void;
  /** Get a client for a server */
  getClient(name: string): McpClient | undefined;
  /** Get all registered servers */
  listServers(): string[];
  /** Connect all auto-start servers */
  connectAll(): Promise<void>;
  /** Disconnect all servers */
  disconnectAll(): Promise<void>;
  /** Get all available tools across servers */
  getAllTools(): Promise<Array<McpTool & { server: string }>>;
  /** Call a tool by fully qualified name (server:tool) */
  callTool(qualifiedName: string, params: Record<string, unknown>): Promise<McpToolResult>;
}

// =============================================================================
// STDIO CLIENT IMPLEMENTATION
// =============================================================================

class StdioMcpClient implements McpClient {
  private config: McpServerConfig;
  private process: ChildProcess | null = null;
  private pendingRequests: Map<string | number, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private requestId = 0;
  private buffer = '';
  private events = new EventEmitter();

  serverInfo?: McpServerInfo;
  connected = false;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      const env = { ...process.env, ...this.config.env };

      this.process = spawn(this.config.command, this.config.args || [], {
        env,
        cwd: this.config.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleData(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        logger.debug({ server: this.config.name, stderr: data.toString() }, 'MCP server stderr');
      });

      this.process.on('error', (err) => {
        logger.error({ server: this.config.name, error: err }, 'MCP server error');
        this.connected = false;
        reject(err);
      });

      this.process.on('exit', (code) => {
        logger.info({ server: this.config.name, code }, 'MCP server exited');
        this.connected = false;
      });

      // Initialize connection
      this.initialize()
        .then((info) => {
          this.serverInfo = info;
          this.connected = true;
          logger.info({ server: this.config.name, info }, 'MCP server connected');
          resolve();
        })
        .catch(reject);
    });
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
    this.pendingRequests.clear();
  }

  private handleData(data: string): void {
    this.buffer += data;

    // Process complete JSON-RPC messages
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response: JsonRpcResponse = JSON.parse(line);
        this.handleResponse(response);
      } catch (err) {
        logger.warn({ line, error: err }, 'Failed to parse MCP response');
      }
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    if (response.id === undefined) {
      // Notification, emit event
      this.events.emit('notification', response);
      return;
    }

    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      logger.warn({ id: response.id }, 'Unknown response ID');
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(`MCP Error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  private async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.process?.stdin) {
      throw new Error('Not connected');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (r: unknown) => void, reject });
      this.process!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  private async initialize(): Promise<McpServerInfo> {
    const result = await this.request<{
      serverInfo: McpServerInfo;
      capabilities: Record<string, unknown>;
    }>('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: {
        name: 'clodds',
        version: '0.1.0',
      },
      capabilities: {},
    });

    // Send initialized notification
    this.process?.stdin?.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n');

    return result.serverInfo;
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.request<{ tools: McpTool[] }>('tools/list');
    return result.tools || [];
  }

  async callTool(name: string, params: Record<string, unknown>): Promise<McpToolResult> {
    const result = await this.request<McpToolResult>('tools/call', {
      name,
      arguments: params,
    });
    return result;
  }

  async listResources(): Promise<McpResource[]> {
    const result = await this.request<{ resources: McpResource[] }>('resources/list');
    return result.resources || [];
  }

  async listResourceTemplates(): Promise<McpResourceTemplate[]> {
    const result = await this.request<{ resourceTemplates: McpResourceTemplate[] }>('resources/templates/list');
    return result.resourceTemplates || [];
  }

  async readResource(uri: string): Promise<McpResourceContents> {
    const result = await this.request<{ contents: McpResourceContents[] }>('resources/read', { uri });
    return result.contents?.[0] || { uri };
  }

  async listPrompts(): Promise<McpPrompt[]> {
    const result = await this.request<{ prompts: McpPrompt[] }>('prompts/list');
    return result.prompts || [];
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<McpContent[]> {
    const result = await this.request<{ messages: Array<{ content: McpContent }> }>('prompts/get', {
      name,
      arguments: args,
    });
    return result.messages?.map(m => m.content) || [];
  }
}

// =============================================================================
// MCP REGISTRY IMPLEMENTATION
// =============================================================================

export function createMcpRegistry(): McpRegistry {
  const servers: Map<string, McpServerConfig> = new Map();
  const clients: Map<string, McpClient> = new Map();

  return {
    register(config) {
      servers.set(config.name, config);
      logger.debug({ name: config.name }, 'MCP server registered');
    },

    unregister(name) {
      const client = clients.get(name);
      if (client) {
        client.disconnect();
        clients.delete(name);
      }
      servers.delete(name);
    },

    getClient(name) {
      return clients.get(name);
    },

    listServers() {
      return Array.from(servers.keys());
    },

    async connectAll() {
      const promises: Promise<void>[] = [];

      for (const [name, config] of servers) {
        if (config.autoStart !== false) {
          const client = new StdioMcpClient(config);
          clients.set(name, client);

          const connectPromise = client.connect().catch((err) => {
            logger.error({ name, error: err }, 'Failed to connect MCP server');
          });
          promises.push(connectPromise);
        }
      }

      await Promise.all(promises);
    },

    async disconnectAll() {
      const promises: Promise<void>[] = [];

      for (const client of clients.values()) {
        promises.push(client.disconnect());
      }

      await Promise.all(promises);
      clients.clear();
    },

    async getAllTools() {
      const allTools: Array<McpTool & { server: string }> = [];

      for (const [name, client] of clients) {
        if (!client.connected) continue;
        try {
          const tools = await client.listTools();
          for (const tool of tools) {
            allTools.push({ ...tool, server: name });
          }
        } catch (err) {
          logger.warn({ server: name, error: err }, 'Failed to list tools');
        }
      }

      return allTools;
    },

    async callTool(qualifiedName, params) {
      const [serverName, toolName] = qualifiedName.includes(':')
        ? qualifiedName.split(':', 2)
        : [null, qualifiedName];

      // If no server specified, search all
      if (!serverName) {
        for (const client of clients.values()) {
          if (!client.connected) continue;
          try {
            const tools = await client.listTools();
            if (tools.some(t => t.name === toolName)) {
              return client.callTool(toolName, params);
            }
          } catch {}
        }
        throw new Error(`Tool not found: ${qualifiedName}`);
      }

      const client = clients.get(serverName);
      if (!client?.connected) {
        throw new Error(`Server not connected: ${serverName}`);
      }

      return client.callTool(toolName, params);
    },
  };
}

// =============================================================================
// SCHEMA VALIDATION
// =============================================================================

/**
 * Validate data against JSON Schema
 */
export function validateSchema(data: unknown, schema: JsonSchema): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  function validate(value: unknown, sch: JsonSchema, path: string): void {
    if (!sch) return;

    // Type validation
    if (sch.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (sch.type === 'integer' && typeof value === 'number' && Number.isInteger(value)) {
        // ok
      } else if (sch.type === 'array' && Array.isArray(value)) {
        // ok
      } else if (sch.type !== actualType) {
        errors.push(`${path}: expected ${sch.type}, got ${actualType}`);
        return;
      }
    }

    // Enum validation
    if (sch.enum && !sch.enum.includes(value)) {
      errors.push(`${path}: value must be one of: ${sch.enum.join(', ')}`);
    }

    // Object properties
    if (sch.properties && typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;

      // Required fields
      if (sch.required) {
        for (const reqField of sch.required) {
          if (!(reqField in obj)) {
            errors.push(`${path}.${reqField}: required field missing`);
          }
        }
      }

      // Validate each property
      for (const [key, propSchema] of Object.entries(sch.properties)) {
        if (key in obj) {
          validate(obj[key], propSchema, `${path}.${key}`);
        }
      }

      // Additional properties
      if (sch.additionalProperties === false) {
        const allowed = new Set(Object.keys(sch.properties));
        for (const key of Object.keys(obj)) {
          if (!allowed.has(key)) {
            errors.push(`${path}.${key}: additional property not allowed`);
          }
        }
      }
    }

    // Array items
    if (sch.items && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        validate(value[i], sch.items, `${path}[${i}]`);
      }
    }
  }

  validate(data, schema, '$');

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// MCPORTER - SKILL IMPORT
// =============================================================================

export interface ImportedSkill {
  name: string;
  description?: string;
  commands: string[];
  source: string;
}

/**
 * Import skills from a Claude Code skills directory
 */
export function importSkillsFromDirectory(skillsDir: string): ImportedSkill[] {
  if (!existsSync(skillsDir)) {
    logger.warn({ dir: skillsDir }, 'Skills directory not found');
    return [];
  }

  const skills: ImportedSkill[] = [];

  // Look for skill manifest files
  const manifestNames = ['skill.json', 'manifest.json', 'package.json'];

  try {
    const { readdirSync, statSync } = require('fs');
    const entries = readdirSync(skillsDir);

    for (const entry of entries) {
      const entryPath = join(skillsDir, entry);
      const stat = statSync(entryPath);

      if (stat.isDirectory()) {
        // Check for manifest in subdirectory
        for (const manifestName of manifestNames) {
          const manifestPath = join(entryPath, manifestName);
          if (existsSync(manifestPath)) {
            try {
              const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
              skills.push({
                name: manifest.name || entry,
                description: manifest.description,
                commands: manifest.commands || manifest.skills || [],
                source: entryPath,
              });
            } catch (err) {
              logger.warn({ path: manifestPath, error: err }, 'Failed to parse skill manifest');
            }
            break;
          }
        }
      }
    }
  } catch (err) {
    logger.error({ dir: skillsDir, error: err }, 'Failed to read skills directory');
  }

  logger.info({ count: skills.length }, 'Imported skills');
  return skills;
}

// =============================================================================
// CONFIG FILE MANAGEMENT
// =============================================================================

export interface McpConfigFile {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

/**
 * Load MCP config from .mcp.json or similar
 */
export function loadMcpConfig(configPath?: string): McpConfigFile {
  const paths = configPath
    ? [configPath]
    : [
        join(process.cwd(), '.mcp.json'),
        join(process.cwd(), 'mcp.json'),
        join(homedir(), '.config', 'clodds', 'mcp.json'),
        join(homedir(), '.claude', 'mcp.json'),
      ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf-8');
        const config = JSON.parse(content);
        logger.info({ path: p }, 'Loaded MCP config');
        return config;
      } catch (err) {
        logger.warn({ path: p, error: err }, 'Failed to parse MCP config');
      }
    }
  }

  return {};
}

/**
 * Initialize registry from config file
 */
export function initializeFromConfig(registry: McpRegistry, config: McpConfigFile): void {
  if (!config.mcpServers) return;

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    registry.register({
      name,
      command: serverConfig.command,
      args: serverConfig.args,
      env: serverConfig.env,
      autoStart: true,
    });
  }
}

// =============================================================================
// TOOL ADAPTER
// =============================================================================

/**
 * Convert MCP tool to Clodds tool format
 */
export function mcpToolToClodds(mcpTool: McpTool & { server: string }): {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (params: Record<string, unknown>) => Promise<string>;
  registry: McpRegistry;
} {
  return {
    name: `mcp__${mcpTool.server}__${mcpTool.name}`,
    description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
    parameters: mcpTool.inputSchema,
    registry: null as unknown as McpRegistry, // Will be set by caller
    async execute(params) {
      const registry = this.registry;
      const result = await registry.callTool(`${mcpTool.server}:${mcpTool.name}`, params);

      // Convert MCP result to string
      if (result.isError) {
        throw new Error(result.content.map(c => c.text).join('\n'));
      }

      return result.content
        .map(c => {
          if (c.type === 'text') return c.text;
          if (c.type === 'resource') return `[Resource: ${c.uri}]`;
          if (c.type === 'image') return `[Image: ${c.mimeType}]`;
          return '';
        })
        .join('\n');
    },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export const mcp = {
  createRegistry: createMcpRegistry,
  loadConfig: loadMcpConfig,
  initializeFromConfig,
  validateSchema,
  importSkills: importSkillsFromDirectory,
  toolToClodds: mcpToolToClodds,
};
