/**
 * MCP Installer - Auto-configure Claude Desktop and Claude Code to use Clodds MCP
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

// =============================================================================
// PATHS
// =============================================================================

function getClaudeDesktopConfigPath(): string {
  const platform = process.platform;
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  // Linux
  return join(homedir(), '.config', 'claude', 'claude_desktop_config.json');
}

function getClaudeCodeConfigPath(): string {
  return join(homedir(), '.claude.json');
}

function getCloddsEntrypoint(): string {
  // Resolve to the built CLI entrypoint
  return resolve(join(__dirname, '..', 'cli', 'index.js'));
}

// =============================================================================
// CONFIG HELPERS
// =============================================================================

function readJsonFile(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

function backupAndWrite(path: string, data: Record<string, any>): void {
  if (existsSync(path)) {
    const backupPath = path + '.backup';
    copyFileSync(path, backupPath);
  }
  // Ensure directory exists
  const dir = join(path, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function getMcpServerEntry(): Record<string, any> {
  return {
    command: 'node',
    args: [getCloddsEntrypoint(), 'mcp'],
  };
}

// =============================================================================
// INSTALL
// =============================================================================

export function installMcpServer(): { installed: string[]; skipped: string[] } {
  const installed: string[] = [];
  const skipped: string[] = [];
  const entry = getMcpServerEntry();

  // Claude Desktop
  const desktopPath = getClaudeDesktopConfigPath();
  try {
    const config = readJsonFile(desktopPath);
    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers.clodds = entry;
    backupAndWrite(desktopPath, config);
    installed.push(`Claude Desktop: ${desktopPath}`);
  } catch (err: any) {
    skipped.push(`Claude Desktop: ${err.message}`);
  }

  // Claude Code
  const codePath = getClaudeCodeConfigPath();
  try {
    const config = readJsonFile(codePath);
    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers.clodds = entry;
    backupAndWrite(codePath, config);
    installed.push(`Claude Code: ${codePath}`);
  } catch (err: any) {
    skipped.push(`Claude Code: ${err.message}`);
  }

  return { installed, skipped };
}

// =============================================================================
// UNINSTALL
// =============================================================================

export function uninstallMcpServer(): { removed: string[]; skipped: string[] } {
  const removed: string[] = [];
  const skipped: string[] = [];

  for (const [name, pathFn] of [
    ['Claude Desktop', getClaudeDesktopConfigPath],
    ['Claude Code', getClaudeCodeConfigPath],
  ] as const) {
    const path = pathFn();
    try {
      if (!existsSync(path)) {
        skipped.push(`${name}: config not found`);
        continue;
      }
      const config = readJsonFile(path);
      if (config.mcpServers?.clodds) {
        delete config.mcpServers.clodds;
        backupAndWrite(path, config);
        removed.push(`${name}: ${path}`);
      } else {
        skipped.push(`${name}: clodds not configured`);
      }
    } catch (err: any) {
      skipped.push(`${name}: ${err.message}`);
    }
  }

  return { removed, skipped };
}
