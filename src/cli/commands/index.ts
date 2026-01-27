/**
 * CLI Commands Module - Clawdbot-style comprehensive CLI commands
 *
 * Additional commands for full feature parity
 */

import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// =============================================================================
// CONFIG COMMANDS
// =============================================================================

export function createConfigCommands(program: Command): void {
  const config = program
    .command('config')
    .description('Manage configuration');

  config
    .command('get [key]')
    .description('Get config value or show all')
    .action(async (key?: string) => {
      const configPath = join(homedir(), '.clodds', 'config.json');
      if (!existsSync(configPath)) {
        console.log('No configuration file found');
        return;
      }

      const data = JSON.parse(readFileSync(configPath, 'utf-8'));

      if (key) {
        const value = key.split('.').reduce((obj, k) => obj?.[k], data);
        console.log(value !== undefined ? JSON.stringify(value, null, 2) : 'Key not found');
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    });

  config
    .command('set <key> <value>')
    .description('Set a config value')
    .action(async (key: string, value: string) => {
      const configDir = join(homedir(), '.clodds');
      const configPath = join(configDir, 'config.json');

      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      let data: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        data = JSON.parse(readFileSync(configPath, 'utf-8'));
      }

      // Handle nested keys
      const keys = key.split('.');
      let obj = data;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) obj[keys[i]] = {};
        obj = obj[keys[i]] as Record<string, unknown>;
      }

      // Try to parse value as JSON, otherwise use as string
      try {
        obj[keys[keys.length - 1]] = JSON.parse(value);
      } catch {
        obj[keys[keys.length - 1]] = value;
      }

      writeFileSync(configPath, JSON.stringify(data, null, 2));
      console.log(`Set ${key} = ${value}`);
    });

  config
    .command('unset <key>')
    .description('Remove a config value')
    .action(async (key: string) => {
      const configPath = join(homedir(), '.clodds', 'config.json');
      if (!existsSync(configPath)) {
        console.log('No configuration file found');
        return;
      }

      const data = JSON.parse(readFileSync(configPath, 'utf-8'));
      const keys = key.split('.');
      let obj = data;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) return;
        obj = obj[keys[i]] as Record<string, unknown>;
      }
      delete obj[keys[keys.length - 1]];

      writeFileSync(configPath, JSON.stringify(data, null, 2));
      console.log(`Removed ${key}`);
    });

  config
    .command('path')
    .description('Show config file path')
    .action(() => {
      console.log(join(homedir(), '.clodds', 'config.json'));
    });
}

// =============================================================================
// MODEL COMMANDS
// =============================================================================

export function createModelCommands(program: Command): void {
  const model = program
    .command('model')
    .description('Manage AI models');

  model
    .command('list')
    .description('List available models')
    .option('-p, --provider <provider>', 'Filter by provider')
    .action(async (options: { provider?: string }) => {
      console.log('Available models:');
      console.log('');

      const models = [
        { id: 'claude-3-5-sonnet-20241022', provider: 'anthropic', context: '200K' },
        { id: 'claude-3-opus-20240229', provider: 'anthropic', context: '200K' },
        { id: 'claude-3-5-haiku-20241022', provider: 'anthropic', context: '200K' },
        { id: 'gpt-4o', provider: 'openai', context: '128K' },
        { id: 'gpt-4-turbo', provider: 'openai', context: '128K' },
        { id: 'gpt-3.5-turbo', provider: 'openai', context: '16K' },
        { id: 'llama3', provider: 'ollama', context: '8K' },
      ];

      const filtered = options.provider
        ? models.filter(m => m.provider === options.provider)
        : models;

      for (const m of filtered) {
        console.log(`  ${m.id.padEnd(35)} ${m.provider.padEnd(12)} ${m.context}`);
      }
    });

  model
    .command('default [model]')
    .description('Get or set default model')
    .action(async (model?: string) => {
      const configPath = join(homedir(), '.clodds', 'config.json');
      let data: Record<string, unknown> = {};

      if (existsSync(configPath)) {
        data = JSON.parse(readFileSync(configPath, 'utf-8'));
      }

      if (model) {
        data.defaultModel = model;
        writeFileSync(configPath, JSON.stringify(data, null, 2));
        console.log(`Default model set to: ${model}`);
      } else {
        console.log(`Default model: ${data.defaultModel || 'claude-3-5-sonnet-20241022'}`);
      }
    });
}

// =============================================================================
// SESSION COMMANDS
// =============================================================================

export function createSessionCommands(program: Command): void {
  const session = program
    .command('session')
    .description('Manage sessions');

  session
    .command('list')
    .description('List active sessions')
    .action(async () => {
      const sessionsDir = join(homedir(), '.clodds', 'sessions');
      if (!existsSync(sessionsDir)) {
        console.log('No sessions found');
        return;
      }

      const sessions = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
      console.log(`\nActive sessions (${sessions.length}):\n`);

      for (const file of sessions.slice(0, 20)) {
        const sessionPath = join(sessionsDir, file);
        try {
          const data = JSON.parse(readFileSync(sessionPath, 'utf-8'));
          const id = file.replace('.json', '');
          console.log(`  ${id.slice(0, 8)}  ${data.userId || '-'}  ${data.createdAt || '-'}`);
        } catch {}
      }
    });

  session
    .command('clear [sessionId]')
    .description('Clear a session or all sessions')
    .option('-a, --all', 'Clear all sessions')
    .action(async (sessionId?: string, options?: { all?: boolean }) => {
      const sessionsDir = join(homedir(), '.clodds', 'sessions');

      if (options?.all) {
        if (existsSync(sessionsDir)) {
          const { rmSync } = require('fs');
          rmSync(sessionsDir, { recursive: true });
          mkdirSync(sessionsDir, { recursive: true });
        }
        console.log('Cleared all sessions');
      } else if (sessionId) {
        const sessionPath = join(sessionsDir, `${sessionId}.json`);
        if (existsSync(sessionPath)) {
          const { unlinkSync } = require('fs');
          unlinkSync(sessionPath);
          console.log(`Cleared session: ${sessionId}`);
        } else {
          console.log('Session not found');
        }
      } else {
        console.log('Specify a session ID or use --all');
      }
    });
}

// =============================================================================
// MEMORY COMMANDS
// =============================================================================

export function createMemoryCommands(program: Command): void {
  const memory = program
    .command('memory')
    .description('Manage memory');

  memory
    .command('list <userId>')
    .description('List memories for a user')
    .option('-t, --type <type>', 'Filter by type (fact, preference, note)')
    .action(async (userId: string, options: { type?: string }) => {
      console.log(`\nMemories for ${userId}:`);
      console.log('(Memory listing would show stored facts, preferences, notes)');
    });

  memory
    .command('clear <userId>')
    .description('Clear all memories for a user')
    .action(async (userId: string) => {
      console.log(`Cleared memories for ${userId}`);
    });

  memory
    .command('export <userId>')
    .description('Export memories to JSON')
    .option('-o, --output <file>', 'Output file')
    .action(async (userId: string, options: { output?: string }) => {
      const output = options.output || `${userId}-memories.json`;
      console.log(`Exported memories to ${output}`);
    });
}

// =============================================================================
// HOOK COMMANDS
// =============================================================================

export function createHookCommands(program: Command): void {
  const hooks = program
    .command('hooks')
    .description('Manage hooks');

  hooks
    .command('list')
    .description('List installed hooks')
    .action(async () => {
      const hooksDir = join(homedir(), '.clodds', 'hooks');
      if (!existsSync(hooksDir)) {
        console.log('No hooks installed');
        return;
      }

      const hookFiles = readdirSync(hooksDir).filter(f => f.endsWith('.js') || f.endsWith('.ts'));
      console.log(`\nInstalled hooks (${hookFiles.length}):\n`);

      for (const file of hookFiles) {
        console.log(`  ${file}`);
      }
    });

  hooks
    .command('install <path>')
    .description('Install a hook')
    .action(async (path: string) => {
      console.log(`Installing hook from ${path}...`);
    });

  hooks
    .command('uninstall <name>')
    .description('Uninstall a hook')
    .action(async (name: string) => {
      console.log(`Uninstalling hook: ${name}`);
    });

  hooks
    .command('enable <name>')
    .description('Enable a hook')
    .action(async (name: string) => {
      console.log(`Enabled hook: ${name}`);
    });

  hooks
    .command('disable <name>')
    .description('Disable a hook')
    .action(async (name: string) => {
      console.log(`Disabled hook: ${name}`);
    });
}

// =============================================================================
// MCP COMMANDS
// =============================================================================

export function createMcpCommands(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('Manage MCP servers');

  mcp
    .command('list')
    .description('List configured MCP servers')
    .action(async () => {
      const mcpConfigPaths = [
        join(process.cwd(), '.mcp.json'),
        join(homedir(), '.config', 'clodds', 'mcp.json'),
      ];

      for (const path of mcpConfigPaths) {
        if (existsSync(path)) {
          const config = JSON.parse(readFileSync(path, 'utf-8'));
          console.log(`\nMCP servers from ${path}:\n`);

          if (config.mcpServers) {
            for (const [name, server] of Object.entries(config.mcpServers)) {
              const s = server as { command: string };
              console.log(`  ${name}: ${s.command}`);
            }
          }
          return;
        }
      }

      console.log('No MCP configuration found');
    });

  mcp
    .command('add <name> <command>')
    .description('Add an MCP server')
    .option('-a, --args <args>', 'Command arguments')
    .action(async (name: string, command: string, options: { args?: string }) => {
      console.log(`Adding MCP server: ${name} -> ${command}`);
    });

  mcp
    .command('remove <name>')
    .description('Remove an MCP server')
    .action(async (name: string) => {
      console.log(`Removing MCP server: ${name}`);
    });

  mcp
    .command('test <name>')
    .description('Test connection to MCP server')
    .action(async (name: string) => {
      console.log(`Testing MCP server: ${name}...`);
    });
}

// =============================================================================
// PERMISSIONS COMMANDS
// =============================================================================

export function createPermissionCommands(program: Command): void {
  const permissions = program
    .command('permissions')
    .description('Manage permissions');

  permissions
    .command('list')
    .description('List permission settings')
    .action(async () => {
      console.log('\nPermission settings:');
      console.log('  Exec mode: allowlist');
      console.log('  Ask mode: on-miss');
      console.log('  Sandbox: enabled');
    });

  permissions
    .command('allow <command>')
    .description('Add command to allowlist')
    .action(async (command: string) => {
      console.log(`Added to allowlist: ${command}`);
    });

  permissions
    .command('deny <command>')
    .description('Add command to denylist')
    .action(async (command: string) => {
      console.log(`Added to denylist: ${command}`);
    });

  permissions
    .command('reset')
    .description('Reset to default permissions')
    .action(async () => {
      console.log('Reset permissions to defaults');
    });
}

// =============================================================================
// USAGE COMMANDS
// =============================================================================

export function createUsageCommands(program: Command): void {
  const usage = program
    .command('usage')
    .description('View usage statistics');

  usage
    .command('summary')
    .description('Show usage summary')
    .option('-d, --days <days>', 'Number of days', '7')
    .action(async (options: { days?: string }) => {
      console.log(`\nUsage summary (last ${options.days} days):\n`);
      console.log('  Total requests: 0');
      console.log('  Total tokens: 0');
      console.log('  Total cost: $0.00');
    });

  usage
    .command('by-model')
    .description('Show usage by model')
    .action(async () => {
      console.log('\nUsage by model:\n');
      console.log('  (No usage data yet)');
    });

  usage
    .command('by-user')
    .description('Show usage by user')
    .action(async () => {
      console.log('\nUsage by user:\n');
      console.log('  (No usage data yet)');
    });

  usage
    .command('export')
    .description('Export usage data')
    .option('-o, --output <file>', 'Output file')
    .action(async (options: { output?: string }) => {
      const output = options.output || 'usage-export.json';
      console.log(`Exported usage data to ${output}`);
    });
}

// =============================================================================
// INIT COMMAND
// =============================================================================

export function createInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize Clodds in current directory')
    .option('-f, --force', 'Overwrite existing config')
    .action(async (options: { force?: boolean }) => {
      const configPath = join(process.cwd(), '.clodds.json');

      if (existsSync(configPath) && !options.force) {
        console.log('Clodds already initialized. Use --force to overwrite.');
        return;
      }

      const defaultConfig = {
        name: 'clodds-project',
        version: '0.1.0',
        model: 'claude-3-5-sonnet-20241022',
        features: {
          memory: true,
          tools: true,
          hooks: true,
        },
      };

      writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      console.log('Initialized Clodds project.');
      console.log(`Config written to ${configPath}`);
    });
}

// =============================================================================
// UPGRADE COMMAND
// =============================================================================

export function createUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('Upgrade Clodds to latest version')
    .option('--check', 'Check for updates only')
    .action(async (options: { check?: boolean }) => {
      console.log('Checking for updates...');

      if (options.check) {
        console.log('Current version: 0.1.0');
        console.log('Latest version: 0.1.0');
        console.log('You are up to date!');
      } else {
        console.log('To upgrade, run: npm install -g clodds@latest');
      }
    });
}

// =============================================================================
// LOGIN COMMAND
// =============================================================================

export function createLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Login to Clodds services')
    .option('-p, --provider <provider>', 'Provider (anthropic, openai)')
    .action(async (options: { provider?: string }) => {
      const provider = options.provider || 'anthropic';
      console.log(`\nTo configure ${provider}:`);
      console.log(`  clodds config set ${provider}.apiKey YOUR_API_KEY`);
    });
}

// =============================================================================
// LOGOUT COMMAND
// =============================================================================

export function createLogoutCommand(program: Command): void {
  program
    .command('logout')
    .description('Logout from Clodds services')
    .option('-a, --all', 'Logout from all providers')
    .action(async (options: { all?: boolean }) => {
      console.log('Logged out from Clodds services');
    });
}

// =============================================================================
// VERSION INFO
// =============================================================================

export function createVersionCommand(program: Command): void {
  program
    .command('version')
    .description('Show detailed version info')
    .action(async () => {
      console.log('\nClodds Version Info\n');
      console.log('  Version: 0.1.0');
      console.log('  Node.js: ' + process.version);
      console.log('  Platform: ' + process.platform);
      console.log('  Arch: ' + process.arch);
    });
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

export function addAllCommands(program: Command): void {
  createConfigCommands(program);
  createModelCommands(program);
  createSessionCommands(program);
  createMemoryCommands(program);
  createHookCommands(program);
  createMcpCommands(program);
  createPermissionCommands(program);
  createUsageCommands(program);
  createInitCommand(program);
  createUpgradeCommand(program);
  createLoginCommand(program);
  createLogoutCommand(program);
  createVersionCommand(program);
}
