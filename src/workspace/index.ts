/**
 * Workspace Module - Clawdbot-style workspace and injected prompts
 *
 * Features:
 * - Workspace detection and management
 * - AGENTS.md and SOUL.md support
 * - Context injection
 * - Project-specific configuration
 * - Git integration
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename, resolve, relative } from 'path';
import { homedir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

// =============================================================================
// TYPES
// =============================================================================

export interface Workspace {
  path: string;
  name: string;
  type: 'git' | 'node' | 'python' | 'generic';
  files: WorkspaceFiles;
  config?: ProjectConfig;
}

export interface WorkspaceFiles {
  agentsMd?: string;
  soulMd?: string;
  readme?: string;
  packageJson?: unknown;
  pyprojectToml?: string;
  gitConfig?: GitInfo;
}

export interface GitInfo {
  branch: string;
  remote?: string;
  isClean: boolean;
  lastCommit?: string;
}

export interface ProjectConfig {
  name?: string;
  description?: string;
  model?: string;
  systemPrompt?: string;
  tools?: string[];
  commands?: Record<string, string>;
  context?: string[];
}

export interface WorkspaceContext {
  workspace: Workspace;
  systemPrompt: string;
  additionalContext: string[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

const WORKSPACE_FILES = [
  '.git',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
];

const CONTEXT_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'CLAUDE.md',
  '.clodds.md',
  '.clodds.json',
  'README.md',
];

// =============================================================================
// WORKSPACE DETECTION
// =============================================================================

/** Find the workspace root from a path */
export function findWorkspaceRoot(startPath?: string): string | null {
  let current = resolve(startPath || process.cwd());

  while (current !== dirname(current)) {
    for (const marker of WORKSPACE_FILES) {
      if (existsSync(join(current, marker))) {
        return current;
      }
    }
    current = dirname(current);
  }

  return null;
}

/** Detect workspace type */
function detectWorkspaceType(path: string): Workspace['type'] {
  if (existsSync(join(path, '.git'))) return 'git';
  if (existsSync(join(path, 'package.json'))) return 'node';
  if (existsSync(join(path, 'pyproject.toml')) || existsSync(join(path, 'setup.py'))) return 'python';
  return 'generic';
}

/** Load workspace files */
async function loadWorkspaceFiles(path: string): Promise<WorkspaceFiles> {
  const files: WorkspaceFiles = {};

  // AGENTS.md
  const agentsMdPath = join(path, 'AGENTS.md');
  if (existsSync(agentsMdPath)) {
    files.agentsMd = readFileSync(agentsMdPath, 'utf-8');
  }

  // SOUL.md
  const soulMdPath = join(path, 'SOUL.md');
  if (existsSync(soulMdPath)) {
    files.soulMd = readFileSync(soulMdPath, 'utf-8');
  }

  // CLAUDE.md (alternative)
  const claudeMdPath = join(path, 'CLAUDE.md');
  if (existsSync(claudeMdPath) && !files.agentsMd) {
    files.agentsMd = readFileSync(claudeMdPath, 'utf-8');
  }

  // README.md
  const readmePath = join(path, 'README.md');
  if (existsSync(readmePath)) {
    files.readme = readFileSync(readmePath, 'utf-8');
  }

  // package.json
  const pkgPath = join(path, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      files.packageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {}
  }

  // pyproject.toml
  const pyprojPath = join(path, 'pyproject.toml');
  if (existsSync(pyprojPath)) {
    files.pyprojectToml = readFileSync(pyprojPath, 'utf-8');
  }

  // Git info
  if (existsSync(join(path, '.git'))) {
    files.gitConfig = await getGitInfo(path);
  }

  return files;
}

async function getGitInfo(path: string): Promise<GitInfo> {
  const info: GitInfo = {
    branch: 'unknown',
    isClean: true,
  };

  try {
    const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: path });
    info.branch = branch.trim();

    const { stdout: remote } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: path }).catch(() => ({ stdout: '', stderr: '' }));
    if (remote.trim()) info.remote = remote.trim();

    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: path });
    info.isClean = status.trim() === '';

    const { stdout: commit } = await execFileAsync('git', ['log', '-1', '--pretty=format:%H'], { cwd: path }).catch(() => ({ stdout: '', stderr: '' }));
    if (commit.trim()) info.lastCommit = commit.trim().slice(0, 7);
  } catch {}

  return info;
}

/** Load project config from .clodds.json */
function loadProjectConfig(path: string): ProjectConfig | undefined {
  const configPath = join(path, '.clodds.json');
  if (!existsSync(configPath)) return undefined;

  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return undefined;
  }
}

// =============================================================================
// WORKSPACE CLASS
// =============================================================================

const MAX_CACHED_WORKSPACES = 20;

export class WorkspaceManager {
  private workspaces: Map<string, Workspace> = new Map();
  private current: Workspace | null = null;

  async load(path?: string): Promise<Workspace | null> {
    const workspacePath = path || findWorkspaceRoot();
    if (!workspacePath) return null;

    const cached = this.workspaces.get(workspacePath);
    if (cached) {
      this.current = cached;
      return cached;
    }

    const workspace: Workspace = {
      path: workspacePath,
      name: basename(workspacePath),
      type: detectWorkspaceType(workspacePath),
      files: await loadWorkspaceFiles(workspacePath),
      config: loadProjectConfig(workspacePath),
    };

    if (this.workspaces.size >= MAX_CACHED_WORKSPACES) {
      const oldest = this.workspaces.keys().next().value;
      if (oldest !== undefined) this.workspaces.delete(oldest);
    }

    this.workspaces.set(workspacePath, workspace);
    this.current = workspace;

    logger.debug({ path: workspacePath, type: workspace.type }, 'Workspace loaded');
    return workspace;
  }

  /** Get current workspace */
  getCurrent(): Workspace | null {
    return this.current;
  }

  /** Get workspace context for AI */
  getContext(): WorkspaceContext | null {
    if (!this.current) return null;

    const parts: string[] = [];

    // Project info
    if (this.current.config?.name || this.current.name) {
      parts.push(`Project: ${this.current.config?.name || this.current.name}`);
    }

    if (this.current.files.gitConfig) {
      const git = this.current.files.gitConfig;
      parts.push(`Branch: ${git.branch}${git.isClean ? '' : ' (dirty)'}`);
    }

    // AGENTS.md (primary instructions)
    let systemPrompt = '';
    if (this.current.files.agentsMd) {
      systemPrompt = this.current.files.agentsMd;
    }

    // SOUL.md (personality/style)
    if (this.current.files.soulMd) {
      systemPrompt = systemPrompt
        ? `${systemPrompt}\n\n---\n\n${this.current.files.soulMd}`
        : this.current.files.soulMd;
    }

    // Config system prompt
    if (this.current.config?.systemPrompt) {
      systemPrompt = systemPrompt
        ? `${systemPrompt}\n\n---\n\n${this.current.config.systemPrompt}`
        : this.current.config.systemPrompt;
    }

    // Additional context
    const additionalContext: string[] = [];

    // Add README summary if no AGENTS.md
    if (!this.current.files.agentsMd && this.current.files.readme) {
      // Extract first section of README
      const lines = this.current.files.readme.split('\n');
      const summary = lines.slice(0, 20).join('\n');
      additionalContext.push(`README Summary:\n${summary}`);
    }

    if (this.current.config?.context) {
      for (const file of this.current.config.context) {
        const filePath = resolve(this.current.path, file);
        const rel = relative(this.current.path, filePath);
        if (rel.startsWith('..') || rel.includes('/..')) continue;
        if (existsSync(filePath)) {
          additionalContext.push(`File: ${file}\n${readFileSync(filePath, 'utf-8')}`);
        }
      }
    }

    return {
      workspace: this.current,
      systemPrompt: systemPrompt || 'You are a helpful AI assistant.',
      additionalContext,
    };
  }

  /** Create AGENTS.md file */
  createAgentsMd(content?: string): void {
    if (!this.current) return;

    const defaultContent = `# Project Instructions

This file provides instructions for AI assistants working on this project.

## Overview

[Describe your project here]

## Guidelines

- Follow the existing code style
- Write tests for new functionality
- Keep commits focused and well-documented

## Architecture

[Describe the architecture]

## Important Files

- \`src/\` - Main source code
- \`tests/\` - Test files
`;

    const filePath = join(this.current.path, 'AGENTS.md');
    writeFileSync(filePath, content || defaultContent);
    logger.info({ path: filePath }, 'Created AGENTS.md');

    // Reload files
    this.load(this.current.path);
  }

  /** Create SOUL.md file */
  createSoulMd(content?: string): void {
    if (!this.current) return;

    const defaultContent = `# Assistant Personality

## Communication Style

- Be concise and direct
- Explain reasoning when helpful
- Ask clarifying questions when needed

## Expertise

- Focus on code quality and best practices
- Consider performance implications
- Prioritize maintainability

## Preferences

- Prefer simple solutions over complex ones
- Write self-documenting code
- Use modern language features appropriately
`;

    const filePath = join(this.current.path, 'SOUL.md');
    writeFileSync(filePath, content || defaultContent);
    logger.info({ path: filePath }, 'Created SOUL.md');

    // Reload files
    this.load(this.current.path);
  }

  /** Create .clodds.json config */
  createConfig(config: ProjectConfig): void {
    if (!this.current) return;

    const filePath = join(this.current.path, '.clodds.json');
    writeFileSync(filePath, JSON.stringify(config, null, 2));
    logger.info({ path: filePath }, 'Created .clodds.json');

    // Reload
    this.load(this.current.path);
  }

  listFiles(pattern?: string): string[] {
    if (!this.current) return [];

    const files: string[] = [];
    const MAX_FILES = 10000;

    const walk = (dir: string, depth = 0) => {
      if (depth > 3 || files.length >= MAX_FILES) return;

      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules') continue;

        const fullPath = join(dir, entry);
        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isSymbolicLink()) continue;

        if (stat.isFile()) {
          files.push(fullPath);
          if (files.length >= MAX_FILES) return;
        } else if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        }
      }
    };

    walk(this.current.path);

    if (pattern) {
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        return [];
      }
      return files.filter(f => regex.test(f));
    }

    return files;
  }
}

// =============================================================================
// USER-LEVEL FILES
// =============================================================================

/** Get user-level AGENTS.md */
export function getUserAgentsMd(): string | null {
  const paths = [
    join(homedir(), '.clodds', 'AGENTS.md'),
    join(homedir(), 'AGENTS.md'),
  ];

  for (const path of paths) {
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
  }

  return null;
}

/** Get user-level SOUL.md */
export function getUserSoulMd(): string | null {
  const paths = [
    join(homedir(), '.clodds', 'SOUL.md'),
    join(homedir(), 'SOUL.md'),
  ];

  for (const path of paths) {
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
  }

  return null;
}

/** Build full system prompt with all layers */
export function buildSystemPrompt(workspace: WorkspaceContext | null): string {
  const parts: string[] = [];

  // User-level SOUL.md (personality base)
  const userSoul = getUserSoulMd();
  if (userSoul) {
    parts.push(userSoul);
  }

  // User-level AGENTS.md (global instructions)
  const userAgents = getUserAgentsMd();
  if (userAgents) {
    parts.push(userAgents);
  }

  // Project-level (from workspace)
  if (workspace) {
    if (workspace.systemPrompt) {
      parts.push(workspace.systemPrompt);
    }
  }

  // Default fallback
  if (parts.length === 0) {
    parts.push('You are a helpful AI assistant.');
  }

  return parts.join('\n\n---\n\n');
}

// =============================================================================
// FACTORY
// =============================================================================

export function createWorkspaceManager(): WorkspaceManager {
  return new WorkspaceManager();
}

// =============================================================================
// DEFAULT INSTANCE
// =============================================================================

export const workspace = new WorkspaceManager();
