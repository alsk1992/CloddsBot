/**
 * Permissions Module - Clawdbot-style exec approvals and command allowlisting
 *
 * Features:
 * - Exec security modes (deny/allowlist/full)
 * - Shell command allowlist engine with pattern matching
 * - Approval gating with ask modes (off/on-miss/always)
 * - Command chain parsing (&&, ||, |, ;)
 * - Safe bins list (pre-approved utilities)
 * - Tool profiles (minimal/coding/messaging/full)
 * - Per-provider tool policies
 * - Sandbox path enforcement
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, lstatSync } from 'fs';
import { join, dirname, resolve, normalize, isAbsolute } from 'path';
import { homedir } from 'os';
import { execSync, execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

/** Execution security mode */
export type ExecSecurityMode = 'deny' | 'allowlist' | 'full';

/** Ask mode for approval requests */
export type AskMode = 'off' | 'on-miss' | 'always';

/** Approval decision */
export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

/** Tool profile names */
export type ToolProfile = 'minimal' | 'coding' | 'messaging' | 'full' | 'custom';

export interface ExecSecurityConfig {
  /** Security mode */
  mode: ExecSecurityMode;
  /** Ask mode for approval */
  ask: AskMode;
  /** Timeout for approval requests (ms) */
  approvalTimeout?: number;
  /** Fallback mode if approval times out */
  fallbackMode?: ExecSecurityMode;
}

export interface AllowlistEntry {
  id: string;
  /** Pattern to match (command prefix, glob, or regex) */
  pattern: string;
  /** Pattern type */
  type: 'prefix' | 'glob' | 'regex';
  /** Last used timestamp */
  lastUsedAt?: number;
  /** Last resolved command path */
  lastResolvedPath?: string;
  /** Added timestamp */
  addedAt: number;
  /** Who added this entry */
  addedBy?: string;
  /** Description/reason */
  description?: string;
}

export interface ApprovalRequest {
  id: string;
  command: string;
  args: string[];
  fullCommand: string;
  agentId: string;
  sessionId?: string;
  timestamp: Date;
  expiresAt?: Date;
  awaitingDecision?: boolean;
  requester?: {
    userId: string;
    channel: string;
    chatId: string;
  };
  status: 'pending' | 'approved' | 'denied' | 'timeout';
  decision?: ApprovalDecision;
  decidedBy?: string;
  decidedAt?: Date;
}

interface PendingApprovalRecord {
  id: string;
  command: string;
  args: string[];
  fullCommand: string;
  agentId: string;
  sessionId?: string;
  timestamp: string;
  expiresAt?: string;
  requester?: ApprovalRequest['requester'];
}

interface PendingApprovalsFile {
  version: number;
  pending: PendingApprovalRecord[];
  updatedAt: string;
}

interface ApprovalDecisionRecord {
  id: string;
  decision: ApprovalDecision;
  decidedBy?: string;
  decidedAt: string;
}

interface ApprovalDecisionsFile {
  version: number;
  decisions: ApprovalDecisionRecord[];
  updatedAt: string;
}

export interface ExecApprovalsConfig {
  version: number;
  defaults: ExecSecurityConfig;
  agents: Record<string, {
    security?: ExecSecurityConfig;
    allowlist: AllowlistEntry[];
  }>;
}

export interface ToolPolicy {
  /** Tools to allow */
  allow?: string[];
  /** Tools to deny (overrides allow) */
  deny?: string[];
  /** Additional tools to allow on top of profile */
  alsoAllow?: string[];
}

export interface CommandResolution {
  command: string;
  fullPath: string | null;
  args: string[];
  isSafeBin: boolean;
  matchedAllowlist: AllowlistEntry | null;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Pre-approved safe binaries (low-risk utilities) */
export const SAFE_BINS = new Set([
  'jq', 'grep', 'cut', 'sort', 'uniq', 'head', 'tail', 'tr', 'wc',
  'awk', 'sed', 'cat', 'echo', 'printf', 'test', '[', 'true', 'false',
  'date', 'basename', 'dirname', 'pwd', 'whoami', 'hostname',
  'env', 'printenv', 'which', 'type', 'file',
  'ls', 'find', 'stat', 'du', 'df', 'realpath', 'readlink',
  'diff', 'comm', 'join', 'paste', 'column',
  'xargs', 'tee', 'yes', 'seq', 'shuf',
  'md5sum', 'sha256sum', 'sha1sum', 'base64',
  'gzip', 'gunzip', 'zcat', 'bzip2', 'bunzip2', 'xz', 'unxz',
  'tar', 'zip', 'unzip',
]);

/** Tool groups for policy expansion */
export const TOOL_GROUPS: Record<string, string[]> = {
  'group:memory': ['memory_search', 'memory_get', 'memory_store'],
  'group:web': ['web_search', 'web_fetch', 'web_browse'],
  'group:fs': ['read_file', 'write_file', 'list_dir', 'file_search'],
  'group:runtime': ['bash', 'exec', 'eval'],
  'group:sessions': ['session_list', 'session_send', 'session_spawn', 'session_status'],
  'group:messaging': ['message_send', 'message_edit', 'message_delete', 'message_react'],
};

/** Built-in tool profiles */
export const TOOL_PROFILES: Record<ToolProfile, string[]> = {
  minimal: ['session_status'],
  coding: [
    'session_status',
    'group:fs',
    'group:runtime',
    'group:sessions',
    'group:memory',
  ],
  messaging: [
    'session_status',
    'group:messaging',
    'group:sessions',
  ],
  full: ['*'],
  custom: [],
};

const DEFAULT_APPROVAL_TIMEOUT = 60000; // 1 minute
const CONFIG_VERSION = 1;

// =============================================================================
// COMMAND PARSING
// =============================================================================

/** Shell command chain operators */
const CHAIN_OPERATORS = ['&&', '||', '|', ';'];

/**
 * Split a command string into individual commands based on shell operators
 */
export function splitCommandChain(command: string): string[] {
  const commands: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let escape = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = char;
      }
      current += char;
      continue;
    }

    if (!inQuote) {
      // Check for chain operators
      let foundOperator = false;
      for (const op of CHAIN_OPERATORS) {
        if (command.slice(i, i + op.length) === op) {
          if (current.trim()) {
            commands.push(current.trim());
          }
          current = '';
          i += op.length - 1;
          foundOperator = true;
          break;
        }
      }
      if (foundOperator) continue;
    }

    current += char;
  }

  if (current.trim()) {
    commands.push(current.trim());
  }

  return commands;
}

/**
 * Parse a command string into command and arguments
 */
export function parseCommand(commandStr: string): { command: string; args: string[] } {
  const parts: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let escape = false;

  for (const char of commandStr) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = char;
      } else {
        current += char;
      }
      continue;
    }

    if (char === ' ' && !inQuote) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return {
    command: parts[0] || '',
    args: parts.slice(1),
  };
}

/**
 * Resolve command to full path using PATH
 */
export function resolveCommandPath(command: string): string | null {
  // If already absolute path
  if (isAbsolute(command)) {
    return existsSync(command) ? command : null;
  }

  // Try to resolve using 'which' - use execFileSync to prevent command injection
  try {
    const result = execFileSync('which', [command], { encoding: 'utf8', timeout: 5000 });
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check if a command is in the safe bins list
 */
export function isSafeBin(command: string): boolean {
  const basename = command.split('/').pop() || command;
  return SAFE_BINS.has(basename);
}

// =============================================================================
// ALLOWLIST MATCHING
// =============================================================================

/**
 * Check if a command matches an allowlist pattern
 */
export function matchesAllowlistPattern(
  command: string,
  fullCommand: string,
  entry: AllowlistEntry
): boolean {
  switch (entry.type) {
    case 'prefix':
      return fullCommand.startsWith(entry.pattern) || command.startsWith(entry.pattern);

    case 'glob':
      // Simple glob matching (supports * and ?)
      const regex = new RegExp(
        '^' + entry.pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') + '$'
      );
      return regex.test(command) || regex.test(fullCommand);

    case 'regex':
      try {
        if (entry.pattern.length > 1000) return false;
        const re = new RegExp(entry.pattern);
        return re.test(command) || re.test(fullCommand);
      } catch {
        return false;
      }

    default:
      return false;
  }
}

// =============================================================================
// SANDBOX PATH ENFORCEMENT
// =============================================================================

export interface SandboxConfig {
  /** Root directory for sandboxed operations */
  root: string;
  /** Allow symlinks */
  allowSymlinks?: boolean;
}

/**
 * Validate a path is within the sandbox
 */
export function assertSandboxPath(path: string, config: SandboxConfig): void {
  if (path.includes('\0')) {
    throw new Error(`Null byte in path: ${path}`);
  }

  const normalizedPath = normalize(resolve(path));
  const normalizedRoot = normalize(resolve(config.root));

  if (!normalizedPath.startsWith(normalizedRoot + '/') && normalizedPath !== normalizedRoot) {
    throw new Error(`Path escapes sandbox: ${path}`);
  }

  // Check for symlinks if not allowed
  if (!config.allowSymlinks && existsSync(path)) {
    try {
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) {
        const realPath = realpathSync(path);
        if (!realPath.startsWith(normalizedRoot + '/') && realPath !== normalizedRoot) {
          throw new Error(`Symlink escapes sandbox: ${path} -> ${realPath}`);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

/**
 * Resolve a path within the sandbox
 */
export function resolveSandboxPath(path: string, config: SandboxConfig): string {
  const resolved = isAbsolute(path) ? path : join(config.root, path);
  assertSandboxPath(resolved, config);
  return resolved;
}

// =============================================================================
// EXEC APPROVALS MANAGER
// =============================================================================

export class ExecApprovalsManager extends EventEmitter {
  private config: ExecApprovalsConfig;
  private configPath: string;
  private pendingPath: string;
  private decisionsPath: string;
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private decisionPoller: ReturnType<typeof setInterval> | null = null;

  constructor(configPath?: string) {
    super();
    this.configPath = configPath || join(homedir(), '.clodds', 'exec-approvals.json');
    this.pendingPath = join(homedir(), '.clodds', 'exec-approvals.pending.json');
    this.decisionsPath = join(homedir(), '.clodds', 'exec-approvals.decisions.json');
    this.config = this.loadConfig();

    const pending = this.loadPendingFile();
    const now = Date.now();
    for (const entry of pending.pending) {
      const expiresAt = entry.expiresAt ? new Date(entry.expiresAt) : undefined;
      if (expiresAt && expiresAt.getTime() <= now) {
        continue;
      }
      this.pendingApprovals.set(entry.id, {
        id: entry.id,
        command: entry.command,
        args: entry.args,
        fullCommand: entry.fullCommand,
        agentId: entry.agentId,
        sessionId: entry.sessionId,
        timestamp: new Date(entry.timestamp),
        expiresAt,
        requester: entry.requester,
        status: 'pending',
      });
    }

    this.decisionPoller = setInterval(() => {
      this.applyDecisionsFromDisk();
    }, 1000);
    this.decisionPoller.unref?.();
  }

  destroy(): void {
    if (this.decisionPoller) {
      clearInterval(this.decisionPoller);
      this.decisionPoller = null;
    }
    this.pendingApprovals.clear();
    this.removeAllListeners();
  }

  private loadConfig(): ExecApprovalsConfig {
    try {
      if (existsSync(this.configPath)) {
        const data = JSON.parse(readFileSync(this.configPath, 'utf-8'));
        if (data.version === CONFIG_VERSION) {
          return data;
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load exec approvals config');
    }

    // Return default config
    return {
      version: CONFIG_VERSION,
      defaults: {
        mode: 'allowlist',
        ask: 'on-miss',
        approvalTimeout: DEFAULT_APPROVAL_TIMEOUT,
        fallbackMode: 'deny',
      },
      agents: {},
    };
  }

  private refreshConfig(): void {
    this.config = this.loadConfig();
  }

  private saveConfig(): void {
    try {
      const dir = dirname(this.configPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      logger.error({ error }, 'Failed to save exec approvals config');
    }
  }

  private loadPendingFile(): PendingApprovalsFile {
    try {
      if (existsSync(this.pendingPath)) {
        const data = JSON.parse(readFileSync(this.pendingPath, 'utf-8')) as PendingApprovalsFile;
        if (data.version === 1 && Array.isArray(data.pending)) {
          return data;
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load exec approvals pending file');
    }

    return {
      version: 1,
      pending: [],
      updatedAt: new Date().toISOString(),
    };
  }

  private savePendingFile(pending: PendingApprovalRecord[]): void {
    try {
      const dir = dirname(this.pendingPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data: PendingApprovalsFile = {
        version: 1,
        pending,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(this.pendingPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error({ error }, 'Failed to save exec approvals pending file');
    }
  }

  private loadDecisionsFile(): ApprovalDecisionsFile {
    try {
      if (existsSync(this.decisionsPath)) {
        const data = JSON.parse(readFileSync(this.decisionsPath, 'utf-8')) as ApprovalDecisionsFile;
        if (data.version === 1 && Array.isArray(data.decisions)) {
          return data;
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load exec approvals decisions file');
    }

    return {
      version: 1,
      decisions: [],
      updatedAt: new Date().toISOString(),
    };
  }

  private saveDecisionsFile(decisions: ApprovalDecisionRecord[]): void {
    try {
      const dir = dirname(this.decisionsPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data: ApprovalDecisionsFile = {
        version: 1,
        decisions,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(this.decisionsPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error({ error }, 'Failed to save exec approvals decisions file');
    }
  }

  private persistPending(): void {
    const pending: PendingApprovalRecord[] = Array.from(this.pendingApprovals.values())
      .filter((req) => req.status === 'pending')
      .map((req) => ({
        id: req.id,
        command: req.command,
        args: req.args,
        fullCommand: req.fullCommand,
        agentId: req.agentId,
        sessionId: req.sessionId,
        timestamp: req.timestamp.toISOString(),
        expiresAt: req.expiresAt?.toISOString(),
        requester: req.requester,
      }));
    this.savePendingFile(pending);
  }

  private consumeDecisionForRequest(requestId: string): ApprovalDecisionRecord | null {
    const data = this.loadDecisionsFile();
    if (data.decisions.length === 0) return null;

    const remaining: ApprovalDecisionRecord[] = [];
    let matched: ApprovalDecisionRecord | null = null;

    for (const decision of data.decisions) {
      if (!matched && decision.id === requestId) {
        matched = decision;
      } else {
        remaining.push(decision);
      }
    }

    if (matched) {
      this.saveDecisionsFile(remaining);
    }

    return matched;
  }

  private applyDecisionsFromDisk(): void {
    const data = this.loadDecisionsFile();
    if (data.decisions.length === 0) return;

    const remaining: ApprovalDecisionRecord[] = [];
    let changed = false;

    for (const decision of data.decisions) {
      const request = this.pendingApprovals.get(decision.id);
      if (!request) {
        continue;
      }

      request.status = decision.decision === 'deny' ? 'denied' : 'approved';
      request.decision = decision.decision;
      request.decidedBy = decision.decidedBy;
      request.decidedAt = new Date(decision.decidedAt);

      this.pendingApprovals.delete(decision.id);
      changed = true;

      if (decision.decision === 'allow-always' && !request.awaitingDecision) {
        this.addToAllowlist(request.agentId, request.command, 'prefix', {
          description: 'Auto-added via approval',
          addedBy: decision.decidedBy,
        });
      }

      this.emit('approval:decision', {
        requestId: decision.id,
        decision: decision.decision,
        decidedBy: decision.decidedBy,
      });
    }

    if (remaining.length !== data.decisions.length) {
      this.saveDecisionsFile(remaining);
    }

    if (changed) {
      this.persistPending();
    }
  }

  /**
   * Get security config for an agent
   */
  getSecurityConfig(agentId: string): ExecSecurityConfig {
    return this.config.agents[agentId]?.security || this.config.defaults;
  }

  /**
   * Set security config for an agent
   */
  setSecurityConfig(agentId: string, config: Partial<ExecSecurityConfig>): void {
    if (!this.config.agents[agentId]) {
      this.config.agents[agentId] = { allowlist: [] };
    }
    this.config.agents[agentId].security = {
      ...this.config.defaults,
      ...this.config.agents[agentId].security,
      ...config,
    };
    this.saveConfig();
  }

  /**
   * Get allowlist for an agent
   */
  getAllowlist(agentId: string): AllowlistEntry[] {
    return this.config.agents[agentId]?.allowlist || [];
  }

  /**
   * Add to allowlist
   */
  addToAllowlist(
    agentId: string,
    pattern: string,
    type: AllowlistEntry['type'] = 'prefix',
    options: Partial<AllowlistEntry> = {}
  ): AllowlistEntry {
    if (!this.config.agents[agentId]) {
      this.config.agents[agentId] = { allowlist: [] };
    }

    const entry: AllowlistEntry = {
      id: randomUUID(),
      pattern,
      type,
      addedAt: Date.now(),
      description: options.description,
      addedBy: options.addedBy,
    };

    this.config.agents[agentId].allowlist.push(entry);
    this.saveConfig();

    logger.info({ agentId, pattern, type }, 'Added to allowlist');
    return entry;
  }

  /**
   * Remove from allowlist
   */
  removeFromAllowlist(agentId: string, entryId: string): boolean {
    const agent = this.config.agents[agentId];
    if (!agent) return false;

    const index = agent.allowlist.findIndex(e => e.id === entryId);
    if (index === -1) return false;

    agent.allowlist.splice(index, 1);
    this.saveConfig();

    logger.info({ agentId, entryId }, 'Removed from allowlist');
    return true;
  }

  /**
   * Check if a command is allowed
   */
  async checkCommand(
    agentId: string,
    fullCommand: string,
    options: {
      sessionId?: string;
      skipApproval?: boolean;
      waitForApproval?: boolean;
      requester?: ApprovalRequest['requester'];
    } = {}
  ): Promise<{ allowed: boolean; reason: string; entry?: AllowlistEntry; requestId?: string }> {
    this.refreshConfig();
    const security = this.getSecurityConfig(agentId);
    const waitForApproval = options.waitForApproval !== false;

    // Full mode - allow everything
    if (security.mode === 'full') {
      return { allowed: true, reason: 'Full access mode' };
    }

    // Deny mode - block everything
    if (security.mode === 'deny') {
      return { allowed: false, reason: 'Deny mode - all commands blocked' };
    }

    // Parse command chain
    const commands = splitCommandChain(fullCommand);

    for (const cmdStr of commands) {
      const { command, args } = parseCommand(cmdStr);

      // Check safe bins
      if (isSafeBin(command)) {
        continue; // Safe bin, check next command in chain
      }

      // Check allowlist
      const allowlist = this.getAllowlist(agentId);
      const matchedEntry = allowlist.find(entry =>
        matchesAllowlistPattern(command, cmdStr, entry)
      );

      if (matchedEntry) {
        // Update last used
        matchedEntry.lastUsedAt = Date.now();
        matchedEntry.lastResolvedPath = resolveCommandPath(command) || undefined;
        this.saveConfig();
        continue; // Allowed, check next command
      }

      // Not in allowlist - check ask mode
      if (security.ask === 'off' || options.skipApproval) {
        return { allowed: false, reason: `Command not in allowlist: ${command}` };
      }

      // Request approval
      if (security.ask === 'on-miss' || security.ask === 'always') {
        if (!waitForApproval) {
          const pending = this.createApprovalRequest(
            agentId,
            command,
            args,
            cmdStr,
            options.sessionId,
            options.requester,
            false
          );
          return {
            allowed: false,
            reason: 'Approval required',
            requestId: pending.id,
          };
        }

        const approval = await this.requestApproval(agentId, command, args, cmdStr, options.sessionId, options.requester);

        if (approval.status === 'approved') {
          if (approval.decision === 'allow-always') {
            // Add to allowlist
            this.addToAllowlist(agentId, command, 'prefix', {
              description: 'Auto-added via approval',
              addedBy: approval.decidedBy,
            });
          }
          continue;
        }

        return {
          allowed: false,
          reason: approval.status === 'denied' ? 'Approval denied' : 'Approval timeout',
        };
      }
    }

    return { allowed: true, reason: 'All commands allowed' };
  }

  private createApprovalRequest(
    agentId: string,
    command: string,
    args: string[],
    fullCommand: string,
    sessionId?: string,
    requester?: ApprovalRequest['requester'],
    awaitingDecision: boolean = false
  ): ApprovalRequest {
    const security = this.getSecurityConfig(agentId);
    const timeout = security.approvalTimeout ?? DEFAULT_APPROVAL_TIMEOUT;

    const request: ApprovalRequest = {
      id: randomUUID(),
      command,
      args,
      fullCommand,
      agentId,
      sessionId,
      requester,
      awaitingDecision,
      timestamp: new Date(),
      expiresAt: new Date(Date.now() + timeout),
      status: 'pending',
    };

    this.pendingApprovals.set(request.id, request);
    this.persistPending();
    this.emit('approval:request', request);

    logger.info({ requestId: request.id, command, agentId }, 'Approval requested');

    setTimeout(() => {
      const existing = this.pendingApprovals.get(request.id);
      if (existing && existing.status === 'pending' && existing.expiresAt) {
        if (Date.now() >= existing.expiresAt.getTime()) {
          existing.status = 'timeout';
          this.pendingApprovals.delete(request.id);
          this.persistPending();
          this.emit('approval:timeout', existing);
        }
      }
    }, timeout + 500);

    return request;
  }

  /**
   * Request approval for a command
   */
  async requestApproval(
    agentId: string,
    command: string,
    args: string[],
    fullCommand: string,
    sessionId?: string,
    requester?: ApprovalRequest['requester']
  ): Promise<ApprovalRequest> {
    const request = this.createApprovalRequest(
      agentId,
      command,
      args,
      fullCommand,
      sessionId,
      requester,
      true
    );

    // Wait for decision or timeout
    const security = this.getSecurityConfig(agentId);
    const timeout = security.approvalTimeout ?? DEFAULT_APPROVAL_TIMEOUT;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (request.status === 'pending') {
          request.status = 'timeout';
          this.pendingApprovals.delete(request.id);
          this.persistPending();
          this.emit('approval:timeout', request);
          clearInterval(poller);
          resolve(request);
        }
      }, timeout);

      const poller = setInterval(() => {
        const decision = this.consumeDecisionForRequest(request.id);
        if (!decision) return;
        this.emit('approval:decision', {
          requestId: decision.id,
          decision: decision.decision,
          decidedBy: decision.decidedBy,
        });
      }, 500);

      // Listen for decision
      const handler = (decision: { requestId: string; decision: ApprovalDecision; decidedBy?: string }) => {
        if (decision.requestId === request.id) {
          clearTimeout(timer);
          clearInterval(poller);
          request.status = decision.decision === 'deny' ? 'denied' : 'approved';
          request.decision = decision.decision;
          request.decidedBy = decision.decidedBy;
          request.decidedAt = new Date();
          this.pendingApprovals.delete(request.id);
          this.persistPending();
          this.removeListener('approval:decision', handler);
          resolve(request);
        }
      };

      this.on('approval:decision', handler);
    });
  }

  /**
   * Make a decision on an approval request
   */
  decide(requestId: string, decision: ApprovalDecision, decidedBy?: string): boolean {
    const request = this.pendingApprovals.get(requestId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    this.emit('approval:decision', { requestId, decision, decidedBy });
    logger.info({ requestId, decision, decidedBy }, 'Approval decision made');
    return true;
  }

  /**
   * Get pending approval requests
   */
  getPendingApprovals(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values());
  }

  /**
   * Get pending approval requests from disk (cross-process)
   */
  getPendingApprovalsFromDisk(): ApprovalRequest[] {
    const data = this.loadPendingFile();
    const now = Date.now();
    const active = data.pending.filter((entry) => !entry.expiresAt || new Date(entry.expiresAt).getTime() > now);
    if (active.length !== data.pending.length) {
      this.savePendingFile(active);
    }
    return active
      .map((entry): ApprovalRequest => ({
        id: entry.id,
        command: entry.command,
        args: entry.args,
        fullCommand: entry.fullCommand,
        agentId: entry.agentId,
        sessionId: entry.sessionId,
        timestamp: new Date(entry.timestamp),
        expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : undefined,
        requester: entry.requester,
        status: 'pending',
      }))
      .filter((req) => !req.expiresAt || req.expiresAt.getTime() > now);
  }

  /**
   * Record a decision to disk (for external approvers like CLI)
   */
  recordDecision(requestId: string, decision: ApprovalDecision, decidedBy?: string): boolean {
    const pending = this.loadPendingFile();
    const exists = pending.pending.some((entry) => entry.id === requestId);
    if (!exists) {
      return false;
    }

    const decisions = this.loadDecisionsFile();
    const filtered = decisions.decisions.filter((entry) => entry.id !== requestId);
    filtered.push({
      id: requestId,
      decision,
      decidedBy,
      decidedAt: new Date().toISOString(),
    });
    this.saveDecisionsFile(filtered);
    return true;
  }

  /**
   * Get pending approval by ID
   */
  getPendingApproval(requestId: string): ApprovalRequest | undefined {
    return this.pendingApprovals.get(requestId);
  }
}

// =============================================================================
// TOOL POLICY MANAGER
// =============================================================================

export class ToolPolicyManager {
  private policies: Map<string, ToolPolicy> = new Map();

  /**
   * Set policy for an agent
   */
  setPolicy(agentId: string, policy: ToolPolicy): void {
    this.policies.set(agentId, policy);
  }

  /**
   * Get policy for an agent
   */
  getPolicy(agentId: string): ToolPolicy | undefined {
    return this.policies.get(agentId);
  }

  /**
   * Expand tool groups in a list
   */
  expandGroups(tools: string[]): string[] {
    const expanded: Set<string> = new Set();

    for (const tool of tools) {
      if (tool.startsWith('group:')) {
        const group = TOOL_GROUPS[tool];
        if (group) {
          group.forEach(t => expanded.add(t));
        }
      } else {
        expanded.add(tool);
      }
    }

    return Array.from(expanded);
  }

  /**
   * Get allowed tools for an agent based on profile and policy
   */
  getAllowedTools(agentId: string, profile: ToolProfile = 'coding'): string[] {
    const policy = this.policies.get(agentId);

    // Start with profile tools
    let allowed = new Set(this.expandGroups(TOOL_PROFILES[profile] || []));

    // Apply policy
    if (policy) {
      if (policy.allow) {
        allowed = new Set(this.expandGroups(policy.allow));
      }

      if (policy.alsoAllow) {
        for (const tool of this.expandGroups(policy.alsoAllow)) {
          allowed.add(tool);
        }
      }

      if (policy.deny) {
        for (const tool of this.expandGroups(policy.deny)) {
          allowed.delete(tool);
        }
      }
    }

    return Array.from(allowed);
  }

  /**
   * Check if a tool is allowed for an agent
   */
  isToolAllowed(agentId: string, tool: string, profile: ToolProfile = 'coding'): boolean {
    const allowed = this.getAllowedTools(agentId, profile);

    // Wildcard allows everything
    if (allowed.includes('*')) {
      const policy = this.policies.get(agentId);
      // But still check deny list
      if (policy?.deny) {
        return !this.expandGroups(policy.deny).includes(tool);
      }
      return true;
    }

    return allowed.includes(tool);
  }
}

// =============================================================================
// ELEVATED PERMISSIONS
// =============================================================================

export interface ElevatedConfig {
  enabled: boolean;
  allowFrom: Record<string, string[]>; // provider -> [user:id, channel:id, role:name]
}

export class ElevatedPermissions {
  private config: ElevatedConfig;

  constructor(config: Partial<ElevatedConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? false,
      allowFrom: config.allowFrom ?? {},
    };
  }

  /**
   * Check if elevated access is allowed
   */
  isAllowed(provider: string, senderId: string, channelId?: string, roles?: string[]): boolean {
    if (!this.config.enabled) {
      return false;
    }

    const allowList = this.config.allowFrom[provider] || this.config.allowFrom['*'] || [];

    for (const entry of allowList) {
      // Check user ID
      if (entry.startsWith('user:') && entry === `user:${senderId}`) {
        return true;
      }

      // Check channel ID
      if (entry.startsWith('channel:') && channelId && entry === `channel:${channelId}`) {
        return true;
      }

      // Check role
      if (entry.startsWith('role:') && roles) {
        const roleName = entry.slice(5);
        if (roles.includes(roleName)) {
          return true;
        }
      }

      // Check @ prefix (user or role shorthand)
      if (entry.startsWith('@')) {
        const name = entry.slice(1);
        if (senderId === name || roles?.includes(name)) {
          return true;
        }
      }

      // Wildcard
      if (entry === '*') {
        return true;
      }
    }

    return false;
  }

  /**
   * Add to allow list
   */
  allow(provider: string, entry: string): void {
    if (!this.config.allowFrom[provider]) {
      this.config.allowFrom[provider] = [];
    }
    if (!this.config.allowFrom[provider].includes(entry)) {
      this.config.allowFrom[provider].push(entry);
    }
  }

  /**
   * Remove from allow list
   */
  disallow(provider: string, entry: string): void {
    if (this.config.allowFrom[provider]) {
      this.config.allowFrom[provider] = this.config.allowFrom[provider].filter(e => e !== entry);
    }
  }

  /**
   * Enable/disable elevated permissions
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export const execApprovals = new ExecApprovalsManager();
export const toolPolicies = new ToolPolicyManager();
export const elevatedPermissions = new ElevatedPermissions();
