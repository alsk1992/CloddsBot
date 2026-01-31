/**
 * Slash Command Registry - shared command registration and handling
 *
 * Provides a single source of truth for commands across channels and
 * supports platform-level registration (e.g., Telegram setMyCommands).
 */

import type { IncomingMessage, OutgoingMessage, Platform, Position, Session, User, Market } from '../types';
import type { SessionManager } from '../sessions/index';
import type { FeedManager } from '../feeds/index';
import type { Database } from '../db/index';
import type { MemoryService } from '../memory/index';
import type { OpportunityFinder } from '../opportunity/index';
import { logger } from '../utils/logger';
import { execApprovals } from '../permissions';
import * as virtuals from '../evm/virtuals';
import * as wallet from '../evm/wallet';
import * as multichain from '../evm/multichain';
import * as odos from '../evm/odos';
import * as transfers from '../evm/transfers';

export interface CommandContext {
  session: Session;
  message: IncomingMessage;
  sessions: SessionManager;
  feeds: FeedManager;
  db: Database;
  memory?: MemoryService;
  opportunityFinder?: OpportunityFinder;
  commands: CommandRegistry;
  send: (message: OutgoingMessage) => Promise<string | null>;
}

export interface CommandDefinition {
  /** Command name without leading slash, e.g. "help" */
  name: string;
  /** Short human-readable description */
  description: string;
  /** Usage string including slash */
  usage: string;
  /** Optional aliases without leading slash */
  aliases?: string[];
  /** Whether this should be registered with platform UIs */
  register?: boolean;
  /** Handle a command invocation */
  handler: (args: string, ctx: CommandContext) => Promise<string> | string;
}

export interface CommandInfo {
  name: string;
  description: string;
  usage: string;
  register: boolean;
}

export interface CommandRegistry {
  register(command: CommandDefinition): void;
  registerMany(commands: CommandDefinition[]): void;
  list(): CommandInfo[];
  /**
   * Handle a command message. Returns null when not handled.
   */
  handle(message: IncomingMessage, ctx: Omit<CommandContext, 'message' | 'commands'>): Promise<string | null>;
}

const PLATFORM_NAMES: Platform[] = [
  'polymarket',
  'kalshi',
  'manifold',
  'metaculus',
  'predictit',
  'drift',
  'betfair',
  'smarkets',
  'opinion',
  'virtuals',
];

function isPlatformName(value: string): value is Platform {
  return PLATFORM_NAMES.includes(value as Platform);
}

function parseRememberArgs(args: string): {
  scope: 'global' | 'channel';
  type: 'fact' | 'preference' | 'note' | 'profile';
  key: string;
  value: string;
  error?: string;
} {
  const trimmed = args.trim();
  if (!trimmed) {
    return {
      scope: 'global',
      type: 'note',
      key: '',
      value: '',
      error: 'Usage: /remember [global|channel] [fact|preference|note|profile] <key>=<value>',
    };
  }

  const tokens = trimmed.split(/\s+/);
  let scope: 'global' | 'channel' = 'global';
  let type: 'fact' | 'preference' | 'note' | 'profile' = 'note';

  if (tokens[0] === 'global' || tokens[0] === 'channel') {
    scope = tokens.shift() as 'global' | 'channel';
  }

  if (
    tokens[0] === 'fact' ||
    tokens[0] === 'preference' ||
    tokens[0] === 'note' ||
    tokens[0] === 'profile'
  ) {
    type = tokens.shift() as 'fact' | 'preference' | 'note' | 'profile';
  }

  const remainder = tokens.join(' ').trim();
  if (!remainder) {
    return {
      scope,
      type,
      key: '',
      value: '',
      error: 'Usage: /remember [global|channel] [fact|preference|note|profile] <key>=<value>',
    };
  }

  if (type === 'profile' && !remainder.includes('=') && !remainder.includes(':')) {
    return {
      scope,
      type,
      key: 'profile',
      value: remainder,
    };
  }

  const match = remainder.match(/^([^:=]+)[:=](.+)$/);
  if (!match) {
    return {
      scope,
      type,
      key: '',
      value: '',
      error: 'Usage: /remember [global|channel] [fact|preference|note|profile] <key>=<value>',
    };
  }

  const key = match[1].trim();
  const value = match[2].trim();
  if (!key || !value) {
    return {
      scope,
      type,
      key: '',
      value: '',
      error: 'Usage: /remember [global|channel] [fact|preference|note|profile] <key>=<value>',
    };
  }

  return {
    scope,
    type,
    key: key.slice(0, 120),
    value: value.slice(0, 500),
  };
}

function formatPriceCents(price: number): string {
  const cents = Math.round(price * 100);
  return `${cents}c`;
}

function formatMemoryEntries(
  label: string,
  entries: Array<{ key: string; value: string }>,
  max = 10
): string[] {
  const lines: string[] = [label];
  for (const entry of entries.slice(0, max)) {
    const value = entry.value.length > 80 ? `${entry.value.slice(0, 80)}...` : entry.value;
    lines.push(`- ${entry.key}: ${value}`);
  }
  if (entries.length > max) {
    lines.push(`...and ${entries.length - max} more.`);
  }
  return lines;
}

function estimateTokensFromHistory(session: Session): number {
  const history = session.context.conversationHistory || [];
  const totalChars = history.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  return Math.max(0, Math.round(totalChars / 4));
}

function isOwner(db: Database, channel: string, userId: string): boolean {
  try {
    const rows = db.query<{ isOwner: number }>(
      'SELECT isOwner FROM paired_users WHERE channel = ? AND userId = ? LIMIT 1',
      [channel, userId]
    );
    return rows[0]?.isOwner === 1;
  } catch {
    return false;
  }
}

function summarizePositions(positions: Position[]): {
  totalValue: number;
  totalPnl: number;
  totalPnlPct: number;
  byPlatform: Map<string, { value: number; pnl: number }>;
} {
  let totalValue = 0;
  let totalPnl = 0;
  const byPlatform = new Map<string, { value: number; pnl: number }>();

  for (const pos of positions) {
    const value = pos.shares * pos.currentPrice;
    const pnl = value - pos.shares * pos.avgPrice;

    totalValue += value;
    totalPnl += pnl;

    const agg = byPlatform.get(pos.platform) || { value: 0, pnl: 0 };
    agg.value += value;
    agg.pnl += pnl;
    byPlatform.set(pos.platform, agg);
  }

  const totalCostBasis = positions.reduce((sum, p) => sum + p.shares * p.avgPrice, 0);
  const totalPnlPct = totalCostBasis > 0 ? totalPnl / totalCostBasis : 0;

  return { totalValue, totalPnl, totalPnlPct, byPlatform };
}

function parsePnlHistoryArgs(args: string): {
  sinceMs?: number;
  limit: number;
  error?: string;
} {
  const trimmed = args.trim();
  if (!trimmed) {
    return { limit: 24 };
  }

  let limit = 24;
  let sinceMs: number | undefined;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const now = Date.now();

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith('limit=')) {
      const value = Number.parseInt(lower.slice('limit='.length), 10);
      if (!Number.isFinite(value) || value <= 0) {
        return { limit, error: 'Limit must be a positive integer.' };
      }
      limit = Math.min(value, 500);
      continue;
    }

    const match = lower.match(/^(\d+)([hdw]|m)$/);
    if (match) {
      const amount = Number.parseInt(match[1], 10);
      const unit = match[2];
      const mult =
        unit === 'm'
          ? 60 * 1000
          : unit === 'h'
            ? 60 * 60 * 1000
            : unit === 'd'
              ? 24 * 60 * 60 * 1000
              : 7 * 24 * 60 * 60 * 1000;
      sinceMs = now - amount * mult;
      continue;
    }

    if (/^\d+$/.test(lower)) {
      const hours = Number.parseInt(lower, 10);
      sinceMs = now - hours * 60 * 60 * 1000;
      continue;
    }

    return { limit, error: 'Usage: /pnl [24h|7d|30m] [limit=50]' };
  }

  return { sinceMs, limit };
}

function parseCompareArgs(args: string): {
  query?: string;
  platforms?: string[];
  limit: number;
  error?: string;
} {
  const trimmed = args.trim();
  if (!trimmed) {
    return { limit: 3, error: 'Usage: /compare <query> [platforms=polymarket,kalshi] [limit=3]' };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const queryParts: string[] = [];
  let platforms: string[] | undefined;
  let limit = 3;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith('limit=')) {
      const value = Number.parseInt(lower.slice('limit='.length), 10);
      if (!Number.isFinite(value) || value <= 0) {
        return { limit, error: 'Limit must be a positive integer.' };
      }
      limit = Math.min(value, 10);
      continue;
    }
    if (lower.startsWith('platforms=')) {
      const raw = lower.slice('platforms='.length);
      platforms = raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      continue;
    }
    queryParts.push(token);
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    return { limit, error: 'Usage: /compare <query> [platforms=polymarket,kalshi] [limit=3]' };
  }
  return { query, platforms, limit };
}

function parseArbitrageArgs(args: string): {
  query: string;
  platforms?: string[];
  limit: number;
  minEdge: number;
  mode: 'internal' | 'cross' | 'both';
  error?: string;
} {
  const trimmed = args.trim();
  if (!trimmed) {
    return { query: '', platforms: undefined, limit: 10, minEdge: 1, mode: 'both' };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const queryParts: string[] = [];
  let platforms: string[] | undefined;
  let limit = 10;
  let minEdge = 1;
  let mode: 'internal' | 'cross' | 'both' = 'both';

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith('limit=')) {
      const value = Number.parseInt(lower.slice('limit='.length), 10);
      if (!Number.isFinite(value) || value <= 0) {
        return { query: '', platforms, limit, minEdge, mode, error: 'Limit must be a positive integer.' };
      }
      limit = Math.min(value, 20);
      continue;
    }
    if (lower.startsWith('minedge=')) {
      const value = Number.parseFloat(lower.slice('minedge='.length));
      if (!Number.isFinite(value) || value < 0) {
        return { query: '', platforms, limit, minEdge, mode, error: 'minEdge must be a non-negative number.' };
      }
      minEdge = value;
      continue;
    }
    if (lower.startsWith('platforms=')) {
      const raw = lower.slice('platforms='.length);
      platforms = raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      continue;
    }
    if (lower.startsWith('mode=')) {
      const raw = lower.slice('mode='.length);
      if (raw === 'internal' || raw === 'cross' || raw === 'both') {
        mode = raw;
        continue;
      }
      return { query: '', platforms, limit, minEdge, mode, error: 'mode must be internal, cross, or both.' };
    }
    queryParts.push(token);
  }

  return { query: queryParts.join(' ').trim(), platforms, limit, minEdge, mode };
}

function parseRiskSettingsArgs(args: string): {
  patch?: Partial<User['settings']>;
  error?: string;
  show?: boolean;
} {
  const trimmed = args.trim();
  if (!trimmed) {
    return { show: true };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const head = tokens[0]?.toLowerCase();
  if (head === 'show') {
    return { show: true };
  }

  if (head === 'reset' || head === 'clear') {
    return {
      patch: {
        maxOrderSize: undefined,
        maxPositionValue: undefined,
        maxTotalExposure: undefined,
        stopLossPct: undefined,
      },
    };
  }

  if (head === 'off' || head === 'disable') {
    return {
      patch: {
        maxOrderSize: 0,
        maxPositionValue: 0,
        maxTotalExposure: 0,
        stopLossPct: 0,
      },
    };
  }

  if (head === 'set') {
    tokens.shift();
  }

  if (tokens.length === 0) {
    return { error: 'Usage: /risk set maxOrderSize=100 maxPositionValue=500 maxTotalExposure=2000 stopLossPct=0.2' };
  }

  const patch: Partial<User['settings']> = {};
  for (const token of tokens) {
    const [rawKey, rawValue] = token.split('=');
    if (!rawKey || rawValue === undefined) {
      return { error: 'Usage: /risk set maxOrderSize=100 maxPositionValue=500 maxTotalExposure=2000 stopLossPct=0.2' };
    }
    const key = rawKey.trim().toLowerCase();
    let valueText = rawValue.trim();
    if (!valueText) continue;

    let value: number | undefined;
    if (valueText.toLowerCase() === 'off') {
      value = 0;
    } else {
      if (valueText.endsWith('%')) {
        valueText = valueText.slice(0, -1);
      }
      const parsed = Number(valueText);
      if (!Number.isFinite(parsed)) {
        return { error: `Invalid number for ${rawKey}: ${rawValue}` };
      }
      value = parsed;
    }

    switch (key) {
      case 'maxordersize':
      case 'max_order_size':
      case 'max-order-size':
        patch.maxOrderSize = value;
        break;
      case 'maxpositionvalue':
      case 'max_position_value':
      case 'max-position-value':
        patch.maxPositionValue = value;
        break;
      case 'maxtotalexposure':
      case 'max_total_exposure':
      case 'max-total-exposure':
        patch.maxTotalExposure = value;
        break;
      case 'stoplosspct':
      case 'stop_loss_pct':
      case 'stop-loss-pct':
        patch.stopLossPct = value;
        break;
      default:
        return { error: `Unknown setting: ${rawKey}` };
    }
  }

  return { patch };
}

function parseDigestSettingsArgs(args: string): {
  patch?: Partial<User['settings']>;
  error?: string;
  show?: boolean;
} {
  const trimmed = args.trim();
  if (!trimmed) {
    return { show: true };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const patch: Partial<User['settings']> = {};
  let show = false;

  for (const rawToken of tokens) {
    const token = rawToken.toLowerCase();
    if (token === 'show' || token === 'status') {
      show = true;
      continue;
    }
    if (token === 'on' || token === 'enable') {
      patch.digestEnabled = true;
      continue;
    }
    if (token === 'off' || token === 'disable') {
      patch.digestEnabled = false;
      continue;
    }
    if (token === 'reset' || token === 'clear') {
      patch.digestEnabled = false;
      patch.digestTime = undefined;
      continue;
    }

    const timeToken = token.startsWith('time=') ? token.slice('time='.length) : token;
    const match = timeToken.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      const hour = Number.parseInt(match[1], 10);
      const minute = Number.parseInt(match[2], 10);
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
        return { error: 'Hour must be between 0 and 23.' };
      }
      if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
        return { error: 'Minute must be between 0 and 59.' };
      }
      patch.digestTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      patch.digestEnabled = true;
      continue;
    }

    return { error: 'Usage: /digest [on|off|HH:MM|time=HH:MM|show|reset]' };
  }

  if (show && Object.keys(patch).length === 0) {
    return { show: true };
  }

  return { patch: Object.keys(patch).length === 0 ? undefined : patch };
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, CommandDefinition>();
  const aliasToName = new Map<string, string>();

  function register(command: CommandDefinition): void {
    commands.set(command.name, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        aliasToName.set(alias, command.name);
      }
    }
  }

  function registerMany(defs: CommandDefinition[]): void {
    for (const def of defs) register(def);
  }

  function list(): CommandInfo[] {
    return Array.from(commands.values())
      .map((c) => ({
        name: `/${c.name}`,
        description: c.description,
        usage: c.usage,
        register: c.register !== false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function handle(
    message: IncomingMessage,
    ctx: Omit<CommandContext, 'message' | 'commands'>
  ): Promise<string | null> {
    const text = message.text.trim();
    if (!text.startsWith('/')) return null;

    const spaceIdx = text.indexOf(' ');
    const rawName = (spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1)).toLowerCase();
    const args = spaceIdx > 0 ? text.slice(spaceIdx + 1).trim() : '';

    const resolvedName = commands.has(rawName) ? rawName : aliasToName.get(rawName);
    if (!resolvedName) return null;

    const command = commands.get(resolvedName);
    if (!command) return null;

    try {
      const response = await command.handler(args, {
        ...ctx,
        commands: registry,
        message,
      });
      logger.info({ command: command.name, userId: message.userId }, 'Command handled');
      return response;
    } catch (error) {
      logger.error({ error, command: command.name }, 'Command handler failed');
      return `Error running /${command.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  const registry: CommandRegistry = {
    register,
    registerMany,
    list,
    handle,
  };

  return registry;
}

export function createDefaultCommands(): CommandDefinition[] {
  return [
    {
      name: 'help',
      description: 'Show available commands',
      usage: '/help',
      handler: (_args, ctx) => {
        const lines = ['Clodds Commands', ''];
        for (const cmd of ctx.commands.list()) {
          lines.push(`${cmd.name} - ${cmd.description}`);
        }
        lines.push('', 'Tip: try /markets <query> or /portfolio');
        return lines.join('\n');
      },
    },
    {
      name: 'remember',
      description: 'Store a memory entry',
      usage: '/remember [global|channel] [fact|preference|note|profile] <key>=<value>',
      handler: (args, ctx) => {
        if (!ctx.memory) {
          return 'Memory service not available.';
        }

        const parsed = parseRememberArgs(args);
        if (parsed.error) {
          return parsed.error;
        }

        const channelKey = ctx.message.chatId || ctx.message.platform;
        const scopeKey = parsed.scope === 'channel' ? channelKey : 'global';

        ctx.memory.remember(ctx.message.userId, scopeKey, parsed.type, parsed.key, parsed.value);

        return `Saved ${parsed.type} to ${parsed.scope} memory: ${parsed.key}`;
      },
    },
    {
      name: 'memory',
      description: 'Show stored memory entries',
      usage: '/memory',
      handler: (_args, ctx) => {
        if (!ctx.memory) {
          return 'Memory service not available.';
        }

        const channelKey = ctx.message.chatId || ctx.message.platform;
        const globalEntries = ctx.memory.recallAll(ctx.message.userId, 'global');
        const channelEntries = channelKey === 'global'
          ? []
          : ctx.memory.recallAll(ctx.message.userId, channelKey);

        if (globalEntries.length === 0 && channelEntries.length === 0) {
          return 'No memories stored for you yet.';
        }

        const lines: string[] = ['Your Memory', ''];
        if (globalEntries.length > 0) {
          lines.push(...formatMemoryEntries('Global', globalEntries));
          lines.push('');
        }
        if (channelEntries.length > 0) {
          lines.push(...formatMemoryEntries('This Channel', channelEntries));
        }
        return lines.join('\n').trim();
      },
    },
    {
      name: 'forget',
      description: 'Forget a memory entry',
      usage: '/forget <key>',
      handler: (args, ctx) => {
        if (!ctx.memory) {
          return 'Memory service not available.';
        }

        const key = args.trim();
        if (!key) {
          return 'Usage: /forget <key>';
        }

        const channelKey = ctx.message.chatId || ctx.message.platform;
        const channelRemoved = ctx.memory.forget(ctx.message.userId, channelKey, key);
        const globalRemoved = channelKey !== 'global'
          ? ctx.memory.forget(ctx.message.userId, 'global', key)
          : false;

        if (channelRemoved || globalRemoved) {
          const scopes = [
            channelRemoved ? 'channel' : null,
            globalRemoved ? 'global' : null,
          ].filter(Boolean).join(' + ');
          return `Forgot ${key} (${scopes})`;
        }
        return `Memory not found: ${key}`;
      },
    },
    {
      name: 'new',
      description: 'Start a fresh conversation',
      usage: '/new',
      aliases: ['reset'],
      handler: (_args, ctx) => {
        ctx.sessions.reset(ctx.session.id);
        return 'Session reset. Starting fresh.';
      },
    },
    {
      name: 'resume',
      description: 'Resume from the last checkpoint (if available)',
      usage: '/resume',
      handler: (_args, ctx) => {
        const restored = ctx.sessions.restoreCheckpoint(ctx.session);
        return restored
          ? 'Resumed conversation from last checkpoint.'
          : 'No checkpoint found to resume.';
      },
    },
    {
      name: 'status',
      description: 'Show session status and context usage',
      usage: '/status',
      handler: (_args, ctx) => {
        const uptimeMinutes = Math.max(
          0,
          Math.round((Date.now() - ctx.session.createdAt.getTime()) / 60000)
        );
        const tokens = estimateTokensFromHistory(ctx.session);

        return [
          'Session Status',
          `Session: ${ctx.session.id.slice(0, 8)}...`,
          `Channel: ${ctx.session.channel}`,
          `Messages: ${(ctx.session.context.conversationHistory || []).length}`,
          `Est. tokens: ~${tokens.toLocaleString()}`,
          `Uptime: ${uptimeMinutes}m`,
        ].join('\n');
      },
    },
    {
      name: 'risk',
      description: 'Show or update your risk limits',
      usage: '/risk [show|set ...|reset|off]',
      handler: (args, ctx) => {
        const parsed = parseRiskSettingsArgs(args);
        if (parsed.error) return parsed.error;

        if (parsed.show || !parsed.patch) {
          const user = ctx.db.getUser(ctx.session.userId);
          const settings: Partial<User['settings']> = user?.settings ?? {};
          const lines = [
            'Risk Settings',
            `maxOrderSize: ${settings.maxOrderSize ?? 'unset'}`,
            `maxPositionValue: ${settings.maxPositionValue ?? 'unset'}`,
            `maxTotalExposure: ${settings.maxTotalExposure ?? 'unset'}`,
            `stopLossPct: ${settings.stopLossPct ?? 'unset'}`,
          ];
          return lines.join('\n');
        }

        const ok = ctx.db.updateUserSettings(ctx.session.userId, parsed.patch);
        if (!ok) return 'Failed to update settings.';
        return 'Risk settings updated.';
      },
    },
    {
      name: 'digest',
      description: 'Configure daily digest notifications',
      usage: '/digest [on|off|HH:MM|time=HH:MM|show|reset]',
      handler: (args, ctx) => {
        const parsed = parseDigestSettingsArgs(args);
        if (parsed.error) return parsed.error;

        if (parsed.show || !parsed.patch) {
          const user = ctx.db.getUser(ctx.session.userId);
          const settings = user?.settings ?? {
            digestEnabled: false,
            digestTime: undefined,
          };
          const time = settings.digestTime ?? '09:00';
          return [
            'Daily Digest',
            `enabled: ${settings.digestEnabled ? 'on' : 'off'}`,
            `time: ${time}`,
          ].join('\n');
        }

        const ok = ctx.db.updateUserSettings(ctx.session.userId, parsed.patch);
        if (!ok) return 'Failed to update digest settings.';
        return 'Digest settings updated.';
      },
    },
    {
      name: 'approvals',
      description: 'List pending approval requests (owner only)',
      usage: '/approvals',
      handler: (_args, ctx) => {
        if (!isOwner(ctx.db, ctx.message.platform, ctx.message.userId)) {
          return 'Only owners can view approvals.';
        }

        const pending = execApprovals.getPendingApprovalsFromDisk();
        if (pending.length === 0) {
          return 'No pending approvals.';
        }

        const lines = ['Pending Approvals'];
        for (const req of pending.slice(0, 10)) {
          const expires = req.expiresAt ? req.expiresAt.toLocaleString() : 'n/a';
          lines.push(`- ${req.id} ${req.command} (agent ${req.agentId})`);
          lines.push(`  Expires: ${expires}`);
          if (req.requester) {
            lines.push(`  From: ${req.requester.userId} (${req.requester.channel})`);
          }
        }
        if (pending.length > 10) {
          lines.push(`...and ${pending.length - 10} more.`);
        }
        return lines.join('\n');
      },
    },
    {
      name: 'approve',
      description: 'Approve a pending request (owner only)',
      usage: '/approve <id> [always]',
      handler: (args, ctx) => {
        if (!isOwner(ctx.db, ctx.message.platform, ctx.message.userId)) {
          return 'Only owners can approve requests.';
        }

        const parts = args.trim().split(/\s+/).filter(Boolean);
        const requestId = parts[0];
        if (!requestId) {
          return 'Usage: /approve <id> [always]';
        }

        const always = parts.slice(1).some((p) => p.toLowerCase() === 'always');
        const decision = always ? 'allow-always' : 'allow-once';
        const ok = execApprovals.recordDecision(requestId, decision, ctx.message.userId);
        return ok ? `Approved ${requestId} (${decision})` : `Request not found: ${requestId}`;
      },
    },
    {
      name: 'deny',
      description: 'Deny a pending request (owner only)',
      usage: '/deny <id>',
      handler: (args, ctx) => {
        if (!isOwner(ctx.db, ctx.message.platform, ctx.message.userId)) {
          return 'Only owners can deny requests.';
        }

        const requestId = args.trim();
        if (!requestId) {
          return 'Usage: /deny <id>';
        }

        const ok = execApprovals.recordDecision(requestId, 'deny', ctx.message.userId);
        return ok ? `Denied ${requestId}` : `Request not found: ${requestId}`;
      },
    },
    {
      name: 'model',
      description: 'Show or change the current model',
      usage: '/model [sonnet|opus|haiku|claude-...]',
      handler: (args, ctx) => {
        const defaultModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
        const currentModel =
          ctx.session.context.modelOverride || ctx.session.context.model || defaultModel;

        if (!args) {
          return ['Current Model', currentModel, '', 'Usage: /model sonnet'].join('\n');
        }

        const requested = args.toLowerCase();
        const aliases: Record<string, string> = {
          sonnet: 'claude-sonnet-4-20250514',
          opus: 'claude-opus-4-20250514',
          haiku: 'claude-haiku-3-20240307',
        };

        const resolved = aliases[requested] || requested;
        if (!resolved.startsWith('claude-')) {
          return 'Unknown model. Try: sonnet, opus, haiku.';
        }

        ctx.session.context.modelOverride = resolved;
        ctx.sessions.updateSession(ctx.session);
        return `Model set to ${resolved}`;
      },
    },
    {
      name: 'context',
      description: 'Preview recent conversation context',
      usage: '/context',
      handler: (_args, ctx) => {
        const recent = (ctx.session.context.conversationHistory || []).slice(-5);
        if (recent.length === 0) {
          return 'No conversation history yet.';
        }

        const lines = ['Recent Context'];
        for (const [index, msg] of recent.entries()) {
          const preview = msg.content.length > 80 ? `${msg.content.slice(0, 80)}...` : msg.content;
          lines.push(`${index + 1}. [${msg.role}] ${preview}`);
        }
        return lines.join('\n');
      },
    },
    {
      name: 'markets',
      description: 'Search markets across platforms',
      usage: '/markets [platform] <query>',
      handler: async (args, ctx) => {
        if (!args) {
          return 'Usage: /markets [platform] <query>\nExample: /markets polymarket trump 2028';
        }

        const parts = args.split(/\s+/).filter(Boolean);
        let platform: Platform | undefined;
        let queryParts = parts;

        if (parts.length > 1 && isPlatformName(parts[0].toLowerCase())) {
          platform = parts[0].toLowerCase() as Platform;
          queryParts = parts.slice(1);
        }

        const query = queryParts.join(' ');
        if (!query) {
          return 'Please provide a search query.';
        }

        const markets = await ctx.feeds.searchMarkets(query, platform);
        if (markets.length === 0) {
          return `No markets found for "${query}"${platform ? ` on ${platform}` : ''}.`;
        }

        const top = markets.slice(0, 6);
        const lines = [`Markets${platform ? ` - ${platform}` : ''}`];

        for (const market of top) {
          const bestOutcome =
            market.outcomes.slice().sort((a, b) => b.volume24h - a.volume24h)[0] ||
            market.outcomes[0];
          const price = bestOutcome ? formatPriceCents(bestOutcome.price) : 'n/a';
          lines.push(`- ${market.question}`);
          lines.push(`  ${market.platform} - ${price} - vol ${Math.round(market.volume24h).toLocaleString()}`);
        }

        if (markets.length > top.length) {
          lines.push('', `...and ${markets.length - top.length} more.`);
        }

        return lines.join('\n');
      },
    },
    {
      name: 'compare',
      description: 'Compare market prices across platforms',
      usage: '/compare <query> [platforms=polymarket,kalshi] [limit=3]',
      handler: async (args, ctx) => {
        const parsed = parseCompareArgs(args);
        if (parsed.error || !parsed.query) return parsed.error || 'Please provide a query.';

        const markets = await ctx.feeds.searchMarkets(parsed.query);
        const filtered = parsed.platforms?.length
          ? markets.filter((m) => parsed.platforms?.includes(m.platform))
          : markets;

        if (filtered.length === 0) {
          return `No markets found for "${parsed.query}".`;
        }

        const byPlatform = new Map<string, typeof filtered>();
        for (const market of filtered) {
          const list = byPlatform.get(market.platform) || [];
          list.push(market);
          byPlatform.set(market.platform, list);
        }

        const lines: string[] = [`Market Comparison: ${parsed.query}`];
        const platforms = Array.from(byPlatform.keys()).sort();

        for (const platform of platforms) {
          const list = byPlatform.get(platform) || [];
          const top = list
            .slice()
            .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
            .slice(0, parsed.limit);

          lines.push('', platform);
          for (const market of top) {
            const yesOutcome = market.outcomes.find((o) => o.name?.toLowerCase() === 'yes');
            const bestOutcome = yesOutcome || market.outcomes[0];
            const price = bestOutcome ? formatPriceCents(bestOutcome.price) : 'n/a';
            const outcomeLabel = bestOutcome?.name ? ` (${bestOutcome.name})` : '';
            lines.push(
              `- ${market.question} — ${price}${outcomeLabel} — vol ${Math.round(market.volume24h).toLocaleString()}`
            );
          }
        }

        return lines.join('\n');
      },
    },
    {
      name: 'arbitrage',
      description: 'Find simple arbitrage opportunities (YES + NO < $1)',
      usage: '/arbitrage [query] [minEdge=1] [platforms=polymarket,kalshi] [mode=internal|cross|both] [limit=10]',
      handler: async (args, ctx) => {
        const parsed = parseArbitrageArgs(args);
        if (parsed.error) {
          return `Usage: /arbitrage [query] [minEdge=1] [platforms=polymarket,kalshi] [mode=internal|cross|both] [limit=10]\n${parsed.error}`;
        }

        const normalize = (text: string) =>
          text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const opportunities: Array<{ edge: number; lines: string[] }> = [];
        const query = parsed.query || '';

        if (parsed.mode === 'both' || parsed.mode === 'internal') {
          const markets = await ctx.feeds.searchMarkets(query, 'polymarket');
          for (const market of markets.slice(0, 60)) {
            if (market.outcomes.length < 2) continue;
            const yesOutcome = market.outcomes.find((o) => o.name?.toLowerCase() === 'yes') || market.outcomes[0];
            const noOutcome = market.outcomes.find((o) => o.name?.toLowerCase() === 'no') || market.outcomes[1];
            if (!yesOutcome || !noOutcome) continue;
            const yesPrice = yesOutcome.price;
            const noPrice = noOutcome.price;
            if (!Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) continue;
            const sum = yesPrice + noPrice;
            const edge = (1 - sum) * 100;
            if (edge < parsed.minEdge) continue;

            opportunities.push({
              edge,
              lines: [
                `- ${market.question} — ${edge.toFixed(2)}% (YES ${formatPriceCents(yesPrice)} / NO ${formatPriceCents(noPrice)})`,
                `  Buy YES at ${formatPriceCents(yesPrice)} + NO at ${formatPriceCents(noPrice)} = ${edge.toFixed(2)}% edge`,
              ],
            });
          }
        }

        if (parsed.mode === 'both' || parsed.mode === 'cross') {
          const platforms = parsed.platforms?.length ? parsed.platforms : ['polymarket', 'kalshi', 'manifold'];
          const results = await Promise.all(
            platforms.map(async (platform) => ({
              platform,
              markets: await ctx.feeds.searchMarkets(query, platform as Platform),
            }))
          );

          const grouped = new Map<string, Array<{ platform: string; market: Market; yesPrice: number }>>();
          for (const { platform, markets } of results) {
            for (const market of markets.slice(0, 30)) {
              const yesOutcome = market.outcomes.find((o) => o.name?.toLowerCase() === 'yes') || market.outcomes[0];
              if (!yesOutcome || !Number.isFinite(yesOutcome.price)) continue;
              const key = normalize(market.question).split(' ').slice(0, 8).join(' ');
              if (!key) continue;
              const list = grouped.get(key) || [];
              list.push({ platform, market, yesPrice: yesOutcome.price });
              grouped.set(key, list);
            }
          }

          for (const [, entries] of grouped.entries()) {
            const uniquePlatforms = new Set(entries.map((e) => e.platform));
            if (uniquePlatforms.size < 2) continue;
            const sorted = entries.slice().sort((a, b) => a.yesPrice - b.yesPrice);
            const low = sorted[0];
            const high = sorted[sorted.length - 1];
            const spread = (high.yesPrice - low.yesPrice) * 100;
            if (spread < parsed.minEdge) continue;

            opportunities.push({
              edge: spread,
              lines: [
                `- ${low.market.question} — ${spread.toFixed(2)}% spread`,
                `  Low: ${low.platform} ${formatPriceCents(low.yesPrice)} / High: ${high.platform} ${formatPriceCents(high.yesPrice)}`,
              ],
            });
          }
        }

        if (opportunities.length === 0) {
          return `No arbitrage opportunities found above ${parsed.minEdge}% edge.`;
        }

        opportunities.sort((a, b) => b.edge - a.edge);
        const lines = [`Arbitrage (${parsed.minEdge}%+ edge)`];
        for (const opp of opportunities.slice(0, parsed.limit)) {
          lines.push(...opp.lines);
        }
        return lines.join('\n');
      },
    },
    {
      name: 'portfolio',
      description: 'Show your tracked positions and P&L',
      usage: '/portfolio',
      handler: async (_args, ctx) => {
        const positions = await ctx.db.getPositions(ctx.session.userId);
        if (positions.length === 0) {
          return 'No tracked positions yet. Add one by telling me what you bought.';
        }

        const summary = summarizePositions(positions);
        const lines = ['Portfolio'];
        lines.push(
          `Value: $${summary.totalValue.toFixed(2)} - P&L: $${summary.totalPnl.toFixed(2)} (${(
            summary.totalPnlPct * 100
          ).toFixed(1)}%)`
        );

        for (const [platform, agg] of summary.byPlatform) {
          const pnlPrefix = agg.pnl >= 0 ? '+' : '';
          lines.push(`- ${platform}: $${agg.value.toFixed(2)} (${pnlPrefix}$${agg.pnl.toFixed(2)})`);
        }

        const top = positions.slice(0, 6);
        lines.push('', 'Top positions:');
        for (const pos of top) {
          lines.push(
            `- [${pos.side}] ${pos.marketQuestion} - ${pos.outcome} - ${formatPriceCents(
              pos.currentPrice
            )} - ${pos.shares.toFixed(2)} sh`
          );
        }

        if (positions.length > top.length) {
          lines.push(`...and ${positions.length - top.length} more.`);
        }

        return lines.join('\n');
      },
    },
    {
      name: 'pnl',
      description: 'Show portfolio P&L history (snapshots)',
      usage: '/pnl [24h|7d|30m] [limit=50]',
      handler: async (args, ctx) => {
        const parsed = parsePnlHistoryArgs(args);
        if (parsed.error) return parsed.error;

        const snapshots = ctx.db.getPortfolioSnapshots(ctx.session.userId, {
          sinceMs: parsed.sinceMs,
          limit: parsed.limit,
          order: 'asc',
        });

        if (snapshots.length === 0) {
          return 'No P&L history yet. Snapshots are recorded when position prices update.';
        }

        const first = snapshots[0];
        const last = snapshots[snapshots.length - 1];
        const deltaPnl = last.totalPnl - first.totalPnl;
        const deltaValue = last.totalValue - first.totalValue;

        const formatStamp = (date: Date) =>
          date.toISOString().replace('T', ' ').slice(0, 16);

        const lines: string[] = [];
        lines.push(`P&L history (${snapshots.length} points)`);
        lines.push(
          `Start: $${first.totalValue.toFixed(2)} (${(first.totalPnlPct * 100).toFixed(1)}%) at ${formatStamp(
            first.createdAt
          )}`
        );
        lines.push(
          `Latest: $${last.totalValue.toFixed(2)} (${(last.totalPnlPct * 100).toFixed(1)}%) at ${formatStamp(
            last.createdAt
          )}`
        );
        lines.push(
          `Change: $${deltaValue.toFixed(2)} value, ${deltaPnl >= 0 ? '+' : ''}$${deltaPnl.toFixed(2)} P&L`
        );

        const display = snapshots.length > 10 ? snapshots.slice(-10) : snapshots;
        lines.push('', 'Latest snapshots:');
        for (const snap of display) {
          const pnlPrefix = snap.totalPnl >= 0 ? '+' : '';
          lines.push(
            `- ${formatStamp(snap.createdAt)}  $${snap.totalValue.toFixed(2)}  ${pnlPrefix}$${snap.totalPnl.toFixed(
              2
            )} (${(snap.totalPnlPct * 100).toFixed(1)}%)`
          );
        }

        return lines.join('\n');
      },
    },
    // ==========================================================================
    // Trading Bot Commands
    // ==========================================================================
    {
      name: 'bot',
      description: 'Manage trading bots (start/stop/status/list)',
      usage: '/bot [start|stop|pause|resume|status] <strategy-id>',
      aliases: ['bots', 'strategy'],
      handler: async (args, ctx) => {
        // Get trading system from context if available
        const trading = (ctx as any).trading;
        if (!trading?.bots) {
          return 'Trading system not initialized. Configure trading in clodds.json.';
        }

        const parts = args.trim().split(/\s+/).filter(Boolean);
        const subcommand = parts[0]?.toLowerCase() || 'list';
        const strategyId = parts[1];

        switch (subcommand) {
          case 'list': {
            const statuses = trading.bots.getAllBotStatuses();
            if (statuses.length === 0) {
              return [
                'Trading Bots',
                'No strategies registered.',
                '',
                'Register strategies programmatically:',
                '  trading.bots.registerStrategy(createMeanReversionStrategy())',
              ].join('\n');
            }

            const lines = ['Trading Bots', ''];
            for (const status of statuses) {
              const statusEmoji =
                status.status === 'running' ? '🟢' :
                status.status === 'paused' ? '🟡' :
                status.status === 'error' ? '🔴' : '⚪';
              lines.push(`${statusEmoji} ${status.name} (${status.id})`);
              lines.push(`   Status: ${status.status}`);
              lines.push(`   Trades: ${status.tradesCount} | Win rate: ${status.winRate.toFixed(1)}%`);
              lines.push(`   PnL: $${status.totalPnL.toFixed(2)}`);
            }
            return lines.join('\n');
          }

          case 'start': {
            if (!strategyId) {
              return 'Usage: /bot start <strategy-id>';
            }
            const started = await trading.bots.startBot(strategyId);
            return started
              ? `Bot ${strategyId} started successfully.`
              : `Failed to start bot ${strategyId}. Check if strategy is registered.`;
          }

          case 'stop': {
            if (!strategyId) {
              return 'Usage: /bot stop <strategy-id>';
            }
            await trading.bots.stopBot(strategyId);
            return `Bot ${strategyId} stopped.`;
          }

          case 'pause': {
            if (!strategyId) {
              return 'Usage: /bot pause <strategy-id>';
            }
            trading.bots.pauseBot(strategyId);
            return `Bot ${strategyId} paused.`;
          }

          case 'resume': {
            if (!strategyId) {
              return 'Usage: /bot resume <strategy-id>';
            }
            trading.bots.resumeBot(strategyId);
            return `Bot ${strategyId} resumed.`;
          }

          case 'status': {
            if (!strategyId) {
              return 'Usage: /bot status <strategy-id>';
            }
            const status = trading.bots.getBotStatus(strategyId);
            if (!status) {
              return `Strategy ${strategyId} not found.`;
            }

            const lines = [
              `Bot: ${status.name} (${status.id})`,
              '',
              `Status: ${status.status}`,
              `Started: ${status.startedAt?.toISOString() || 'never'}`,
              `Last check: ${status.lastCheck?.toISOString() || 'never'}`,
              '',
              'Performance:',
              `  Trades: ${status.tradesCount}`,
              `  Win rate: ${status.winRate.toFixed(1)}%`,
              `  Total PnL: $${status.totalPnL.toFixed(2)}`,
            ];

            if (status.lastSignal) {
              lines.push('', `Last signal: ${status.lastSignal.type} ${status.lastSignal.outcome}`);
              if (status.lastSignal.reason) {
                lines.push(`  Reason: ${status.lastSignal.reason}`);
              }
            }

            if (status.lastError) {
              lines.push('', `Last error: ${status.lastError}`);
            }

            return lines.join('\n');
          }

          default:
            return [
              'Usage: /bot [command] [strategy-id]',
              '',
              'Commands:',
              '  list     - Show all registered bots',
              '  start    - Start a bot',
              '  stop     - Stop a bot',
              '  pause    - Pause a running bot',
              '  resume   - Resume a paused bot',
              '  status   - Show detailed bot status',
            ].join('\n');
        }
      },
    },
    {
      name: 'track',
      description: 'Manage custom tracking columns and data',
      usage: '/track [columns|add|remove|get|summary] [args]',
      aliases: ['tracking'],
      handler: async (args, ctx) => {
        const trading = (ctx as any).trading;
        if (!trading?.tracking) {
          return 'Tracking manager not initialized.';
        }

        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || 'columns';
        const rest = parts.slice(1);

        switch (subcommand) {
          case 'columns': {
            const category = rest[0];
            const columns = trading.tracking.getColumns(category);

            if (columns.length === 0) {
              return category
                ? `No columns in category "${category}".`
                : 'No tracking columns defined.';
            }

            const grouped = new Map<string, typeof columns>();
            for (const col of columns) {
              const cat = col.category || 'other';
              const list = grouped.get(cat) || [];
              list.push(col);
              grouped.set(cat, list);
            }

            const lines = ['Tracking Columns', ''];
            for (const [cat, cols] of grouped) {
              lines.push(`**${cat}**`);
              for (const col of cols) {
                const summary = col.showInSummary ? ' [summary]' : '';
                lines.push(`  ${col.name} (${col.type})${summary}`);
                if (col.description) {
                  lines.push(`    ${col.description}`);
                }
              }
              lines.push('');
            }

            return lines.join('\n');
          }

          case 'add': {
            // /track add column_name type [category] [description]
            const name = rest[0];
            const type = (rest[1]?.toLowerCase() || 'string') as 'number' | 'string' | 'boolean' | 'json';
            const category = rest[2] || 'custom';
            const description = rest.slice(3).join(' ') || undefined;

            if (!name) {
              return [
                'Usage: /track add <name> [type] [category] [description]',
                '',
                'Types: number, string, boolean, json',
                '',
                'Examples:',
                '  /track add my_score number trade My custom score',
                '  /track add trade_notes string trade Notes for each trade',
              ].join('\n');
            }

            if (!['number', 'string', 'boolean', 'json'].includes(type)) {
              return `Invalid type: ${type}. Use: number, string, boolean, json`;
            }

            trading.tracking.defineColumn({
              name,
              label: name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              type,
              category,
              description,
              showInSummary: type === 'number',
              aggregation: type === 'number' ? 'avg' : undefined,
            });

            return `Column "${name}" added (${type}, ${category}).`;
          }

          case 'remove': {
            const name = rest[0];
            if (!name) {
              return 'Usage: /track remove <column_name>';
            }

            trading.tracking.removeColumn(name);
            return `Column "${name}" removed.`;
          }

          case 'set': {
            // /track set entity_type entity_id column value
            const [entityType, entityId, column, ...valueParts] = rest;

            if (!entityType || !entityId || !column || valueParts.length === 0) {
              return [
                'Usage: /track set <entity_type> <entity_id> <column> <value>',
                '',
                'Examples:',
                '  /track set trade trade_abc123 my_score 85',
                '  /track set bot mean-reversion notes "Tweaked params"',
              ].join('\n');
            }

            const value = valueParts.join(' ');
            const numValue = parseFloat(value);
            const finalValue = isNaN(numValue) ? value : numValue;

            trading.tracking.track({
              entityType,
              entityId,
              column,
              value: finalValue,
            });

            return `Tracked: ${entityType}/${entityId}.${column} = ${finalValue}`;
          }

          case 'get': {
            // /track get entity_type entity_id [column]
            const [entityType, entityId, column] = rest;

            if (!entityType || !entityId) {
              return 'Usage: /track get <entity_type> <entity_id> [column]';
            }

            if (column) {
              const value = trading.tracking.getLatest(entityType, entityId, column);
              return value !== undefined
                ? `${column}: ${JSON.stringify(value)}`
                : `No value for ${column}`;
            }

            const entries = trading.tracking.get({ entityType, entityId, limit: 20 });
            if (entries.length === 0) {
              return `No tracking data for ${entityType}/${entityId}`;
            }

            const lines = [`Tracking: ${entityType}/${entityId}`, ''];
            const byColumn = new Map<string, unknown>();
            for (const entry of entries) {
              if (!byColumn.has(entry.column)) {
                byColumn.set(entry.column, entry.value);
              }
            }

            for (const [col, val] of byColumn) {
              lines.push(`  ${col}: ${JSON.stringify(val)}`);
            }

            return lines.join('\n');
          }

          case 'summary': {
            const column = rest[0];
            if (!column) {
              return 'Usage: /track summary <column>';
            }

            const summary = trading.tracking.getSummary(column);

            const lines = [`Summary: ${column}`, ''];
            lines.push(`  Count: ${summary.count}`);
            if (summary.sum !== null) lines.push(`  Sum: ${summary.sum?.toFixed(2)}`);
            if (summary.avg !== null) lines.push(`  Avg: ${summary.avg?.toFixed(2)}`);
            if (summary.min !== null) lines.push(`  Min: ${summary.min?.toFixed(2)}`);
            if (summary.max !== null) lines.push(`  Max: ${summary.max?.toFixed(2)}`);
            if (summary.latest !== undefined) lines.push(`  Latest: ${JSON.stringify(summary.latest)}`);

            return lines.join('\n');
          }

          case 'export': {
            const csv = trading.tracking.exportCsv({ limit: 100 });
            return `Exported ${csv.split('\n').length - 1} rows:\n\n${csv.slice(0, 1000)}${csv.length > 1000 ? '\n...' : ''}`;
          }

          default:
            return [
              'Usage: /track [command]',
              '',
              'Commands:',
              '  columns [category]         - List tracking columns',
              '  add <name> [type] [cat]    - Add custom column',
              '  remove <name>              - Remove column',
              '  set <type> <id> <col> <v>  - Track a value',
              '  get <type> <id> [col]      - Get tracked values',
              '  summary <column>           - Get column stats',
              '  export                     - Export to CSV',
            ].join('\n');
        }
      },
    },
    {
      name: 'safety',
      description: 'Trading safety controls and circuit breakers',
      usage: '/safety [status|limits|kill|resume|alerts]',
      handler: async (args, ctx) => {
        const trading = (ctx as any).trading;
        if (!trading?.safety) {
          return 'Safety manager not initialized.';
        }

        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || 'status';
        const rest = parts.slice(1);

        switch (subcommand) {
          case 'status': {
            const state = trading.safety.getState();
            const canTrade = trading.safety.canTrade();

            const lines = [
              'Trading Safety Status',
              '',
              `Trading: ${canTrade ? '🟢 ENABLED' : '🔴 DISABLED'}`,
            ];

            if (!canTrade && state.disabledReason) {
              lines.push(`Reason: ${state.disabledReason}`);
              if (state.resumeAt) {
                lines.push(`Resume at: ${state.resumeAt.toLocaleString()}`);
              }
            }

            lines.push('');
            lines.push('Today:');
            lines.push(`  PnL: $${state.dailyPnL.toFixed(2)}`);
            lines.push(`  Trades: ${state.dailyTrades}`);
            lines.push('');
            lines.push('Drawdown:');
            lines.push(`  Current: ${state.currentDrawdownPct.toFixed(1)}%`);
            lines.push(`  Peak: $${state.peakValue.toFixed(2)}`);
            lines.push(`  Current: $${state.currentValue.toFixed(2)}`);

            if (state.alerts.length > 0) {
              lines.push('');
              lines.push(`⚠️ ${state.alerts.length} active alerts`);
            }

            return lines.join('\n');
          }

          case 'kill': {
            const reason = rest.join(' ') || 'Manual kill switch';
            trading.safety.killSwitch(reason);
            return '🚨 KILL SWITCH ACTIVATED - All trading stopped.\n\nUse /safety resume to re-enable.';
          }

          case 'resume': {
            const resumed = trading.safety.resumeTrading();
            return resumed
              ? '✅ Trading resumed. Be careful!'
              : 'Trading was already enabled.';
          }

          case 'alerts': {
            const alerts = trading.safety.getAlerts();
            if (alerts.length === 0) {
              return 'No active safety alerts.';
            }

            const lines = ['Safety Alerts', ''];
            for (const alert of alerts.slice(0, 10)) {
              const emoji = alert.type === 'breaker_tripped' ? '🚨' : alert.type === 'critical' ? '❌' : '⚠️';
              lines.push(`${emoji} [${alert.category}] ${alert.message}`);
              lines.push(`   ${alert.timestamp.toLocaleString()}`);
            }
            return lines.join('\n');
          }

          case 'clear': {
            trading.safety.clearAlerts();
            return 'Alerts cleared.';
          }

          default:
            return [
              'Usage: /safety [command]',
              '',
              'Commands:',
              '  status   - Show safety status',
              '  kill     - Emergency stop all trading',
              '  resume   - Resume trading after kill',
              '  alerts   - Show safety alerts',
              '  clear    - Clear alerts',
            ].join('\n');
        }
      },
    },
    {
      name: 'backtest',
      description: 'Backtest a strategy on historical data',
      usage: '/backtest <strategy-id> [days=30] [capital=10000]',
      aliases: ['bt'],
      handler: async (args, ctx) => {
        const trading = (ctx as any).trading;
        if (!trading?.backtest || !trading?.bots) {
          return 'Backtest engine not initialized.';
        }

        const parts = args.trim().split(/\s+/);
        const strategyId = parts[0];

        if (!strategyId) {
          return [
            'Usage: /backtest <strategy-id> [days=30] [capital=10000]',
            '',
            'Example:',
            '  /backtest mean-reversion days=60 capital=5000',
          ].join('\n');
        }

        // Parse options
        let days = 30;
        let capital = 10000;

        for (const part of parts.slice(1)) {
          if (part.startsWith('days=')) {
            days = parseInt(part.slice(5), 10) || 30;
          }
          if (part.startsWith('capital=')) {
            capital = parseInt(part.slice(8), 10) || 10000;
          }
        }

        // Find strategy
        const strategies = trading.bots.getStrategies();
        const stratConfig = strategies.find((s: any) => s.id === strategyId);

        if (!stratConfig) {
          return `Strategy ${strategyId} not found. Use /bot list to see available strategies.`;
        }

        // This is simplified - would need actual strategy instance
        return [
          `Backtest: ${stratConfig.name}`,
          '',
          `Period: ${days} days`,
          `Initial capital: $${capital.toLocaleString()}`,
          '',
          '⏳ Running backtest...',
          '',
          'Note: Full backtest requires historical price data.',
          'Use trading.backtest.run() programmatically for full results.',
        ].join('\n');
      },
    },
    {
      name: 'account',
      description: 'Manage trading accounts for multi-account/A/B testing',
      usage: '/account [add|list|remove|switch] [args]',
      aliases: ['accounts', 'acc'],
      handler: async (args, ctx) => {
        const trading = (ctx as any).trading;
        if (!trading?.accounts) {
          return 'Account manager not initialized.';
        }

        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || 'list';
        const rest = parts.slice(1);

        switch (subcommand) {
          case 'list': {
            const accounts = trading.accounts.listAccounts();
            if (accounts.length === 0) {
              return [
                'No trading accounts configured.',
                '',
                'Add one with:',
                '  /account add <name> <platform> [type]',
                '',
                'Example:',
                '  /account add "Main Poly" polymarket live',
                '  /account add "Test Account" polymarket test_a',
              ].join('\n');
            }

            const lines = ['Trading Accounts', ''];
            for (const acc of accounts) {
              const status = acc.enabled ? '🟢' : '🔴';
              const typeLabel = acc.type === 'live' ? '' : ` [${acc.type}]`;
              lines.push(`${status} **${acc.name}** (${acc.id})${typeLabel}`);
              lines.push(`   Platform: ${acc.platform} | Max: $${acc.risk.maxOrderSize}`);
            }
            return lines.join('\n');
          }

          case 'add': {
            const name = rest[0];
            const platform = rest[1]?.toLowerCase() as Platform;
            const type = (rest[2]?.toLowerCase() || 'live') as 'live' | 'paper' | 'test_a' | 'test_b';

            if (!name || !platform) {
              return 'Usage: /account add <name> <platform> [type]\n\nTypes: live, paper, test_a, test_b';
            }

            const account = trading.accounts.addAccount({
              name,
              platform,
              type,
              credentials: {}, // User will need to configure separately
              risk: { maxOrderSize: 100, maxExposure: 1000 },
              enabled: true,
            });

            return [
              `Account Created: ${account.name}`,
              '',
              `ID: ${account.id}`,
              `Platform: ${platform}`,
              `Type: ${type}`,
              '',
              'Configure credentials in clodds.json or via:',
              `  /account config ${account.id} apiKey=xxx apiSecret=xxx`,
            ].join('\n');
          }

          case 'remove': {
            const accountId = rest[0];
            if (!accountId) {
              return 'Usage: /account remove <account-id>';
            }
            const removed = trading.accounts.removeAccount(accountId);
            return removed ? `Account ${accountId} removed.` : `Account ${accountId} not found.`;
          }

          case 'config': {
            const accountId = rest[0];
            if (!accountId) {
              return 'Usage: /account config <account-id> key=value ...';
            }

            const account = trading.accounts.getAccount(accountId);
            if (!account) {
              return `Account ${accountId} not found.`;
            }

            // Parse key=value pairs
            const updates: Record<string, string> = {};
            for (const pair of rest.slice(1)) {
              const [key, ...valueParts] = pair.split('=');
              if (key && valueParts.length > 0) {
                updates[key] = valueParts.join('=');
              }
            }

            if (Object.keys(updates).length === 0) {
              // Show current config (hide sensitive values)
              const creds = account.credentials;
              const lines = [`Account: ${account.name}`, ''];
              for (const key of Object.keys(creds)) {
                const value = creds[key];
                if (value) {
                  lines.push(`  ${key}: ${value.slice(0, 4)}...${value.slice(-4)}`);
                }
              }
              return lines.join('\n');
            }

            // Update credentials
            account.credentials = { ...account.credentials, ...updates };
            trading.accounts.updateAccount(accountId, { credentials: account.credentials });

            return `Account ${accountId} updated with ${Object.keys(updates).length} credential(s).`;
          }

          case 'enable': {
            const accountId = rest[0];
            if (!accountId) return 'Usage: /account enable <account-id>';
            const ok = trading.accounts.updateAccount(accountId, { enabled: true });
            return ok ? `Account ${accountId} enabled.` : `Account not found.`;
          }

          case 'disable': {
            const accountId = rest[0];
            if (!accountId) return 'Usage: /account disable <account-id>';
            const ok = trading.accounts.updateAccount(accountId, { enabled: false });
            return ok ? `Account ${accountId} disabled.` : `Account not found.`;
          }

          default:
            return [
              'Usage: /account [command]',
              '',
              'Commands:',
              '  list              - List all accounts',
              '  add <n> <p> [t]   - Add account (name, platform, type)',
              '  remove <id>       - Remove account',
              '  config <id> k=v   - Configure credentials',
              '  enable <id>       - Enable account',
              '  disable <id>      - Disable account',
              '',
              'Types: live, paper, test_a, test_b',
            ].join('\n');
        }
      },
    },
    {
      name: 'abtest',
      description: 'Run A/B tests across multiple accounts',
      usage: '/abtest [create|start|stop|status|results] [args]',
      aliases: ['ab'],
      handler: async (args, ctx) => {
        const trading = (ctx as any).trading;
        if (!trading?.accounts) {
          return 'Account manager not initialized.';
        }

        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || 'list';
        const rest = parts.slice(1);

        switch (subcommand) {
          case 'list': {
            const tests = trading.accounts.listABTests();
            if (tests.length === 0) {
              return [
                'No A/B tests configured.',
                '',
                'Create one with:',
                '  /abtest create <name> <strategy> <accountA> <accountB>',
              ].join('\n');
            }

            const lines = ['A/B Tests', ''];
            for (const test of tests) {
              const status = test.status === 'running' ? '🟢' : test.status === 'completed' ? '✅' : '⏸️';
              lines.push(`${status} **${test.name}** (${test.id})`);
              lines.push(`   Strategy: ${test.strategyId} | Accounts: ${test.accounts.length}`);
              if (test.results?.significance) {
                lines.push(`   Winner: ${test.results.significance.winner} (p=${test.results.significance.pValue.toFixed(3)})`);
              }
            }
            return lines.join('\n');
          }

          case 'create': {
            // /abtest create "Test Name" strategy_id acc_a acc_b param=valueA,valueB
            const name = rest[0];
            const strategyId = rest[1];
            const accountA = rest[2];
            const accountB = rest[3];
            const paramSpec = rest[4]; // e.g., "stopLoss=5,10"

            if (!name || !strategyId || !accountA || !accountB) {
              return [
                'Usage: /abtest create <name> <strategy> <accountA> <accountB> [param=valA,valB]',
                '',
                'Example:',
                '  /abtest create "Stop Loss Test" mean-reversion acc_123 acc_456 stopLossPct=5,10',
              ].join('\n');
            }

            let varyParam = 'stopLossPct';
            let valueA: unknown = 5;
            let valueB: unknown = 10;

            if (paramSpec && paramSpec.includes('=')) {
              const [param, values] = paramSpec.split('=');
              const [valA, valB] = values.split(',');
              varyParam = param;
              valueA = isNaN(Number(valA)) ? valA : Number(valA);
              valueB = isNaN(Number(valB)) ? valB : Number(valB);
            }

            // Import helper
            const { createQuickABTest } = await import('../trading/accounts');
            const test = createQuickABTest(trading.accounts, {
              name,
              strategyId,
              accountA,
              accountB,
              varyParam,
              valueA,
              valueB,
            });

            return [
              `A/B Test Created: ${test.name}`,
              '',
              `ID: ${test.id}`,
              `Strategy: ${strategyId}`,
              '',
              'Variations:',
              `  Control (A): ${varyParam}=${JSON.stringify(valueA)} → ${accountA}`,
              `  Test (B): ${varyParam}=${JSON.stringify(valueB)} → ${accountB}`,
              '',
              `Start with: /abtest start ${test.id}`,
            ].join('\n');
          }

          case 'start': {
            const testId = rest[0];
            if (!testId) return 'Usage: /abtest start <test-id>';

            const started = await trading.accounts.startABTest(testId);
            return started
              ? `A/B test ${testId} started. Bots running on all accounts.`
              : `Failed to start test. Check if test exists and accounts are configured.`;
          }

          case 'stop': {
            const testId = rest[0];
            if (!testId) return 'Usage: /abtest stop <test-id>';

            await trading.accounts.stopABTest(testId);
            const test = trading.accounts.getABTest(testId);

            if (test?.results) {
              return [
                `A/B test ${testId} stopped.`,
                '',
                '**Results:**',
                test.results.summary,
                '',
                test.results.significance?.confident
                  ? `✅ Statistically significant: ${test.results.significance.winner} wins`
                  : '⚠️ Not enough data for statistical significance',
              ].join('\n');
            }

            return `A/B test ${testId} stopped.`;
          }

          case 'status':
          case 'results': {
            const testId = rest[0];
            if (!testId) return 'Usage: /abtest status <test-id>';

            const test = trading.accounts.getABTest(testId);
            if (!test) return `Test ${testId} not found.`;

            const results = trading.accounts.calculateResults(testId);

            const lines = [
              `A/B Test: ${test.name}`,
              '',
              `Status: ${test.status}`,
              `Strategy: ${test.strategyId}`,
              `Started: ${test.startedAt?.toLocaleString() || 'not started'}`,
              '',
              'Variations:',
            ];

            for (const [name, variation] of Object.entries(test.variations) as [string, { name: string }][]) {
              const acc = test.accounts.find((a: { variation: string; accountId?: string }) => a.variation === name);
              const stats = results?.byVariation[name];
              lines.push(`  **${variation.name}** (${acc?.accountId})`);
              if (stats) {
                lines.push(`    Trades: ${stats.trades} | Win rate: ${stats.winRate.toFixed(1)}%`);
                lines.push(`    PnL: $${stats.totalPnL.toFixed(2)} | Avg: $${stats.avgPnL.toFixed(2)}`);
              }
            }

            if (results?.significance) {
              lines.push('');
              lines.push(`**Winner:** ${results.significance.winner}`);
              lines.push(`Confidence: ${results.significance.confident ? 'High' : 'Low'} (p=${results.significance.pValue.toFixed(3)})`);
            }

            return lines.join('\n');
          }

          case 'compare': {
            const accountIds = rest;
            if (accountIds.length < 2) {
              return 'Usage: /abtest compare <account1> <account2> [account3...]';
            }

            const comparison = trading.accounts.compareAccounts(accountIds);

            const lines = ['Account Comparison', ''];
            for (const acc of comparison.accounts) {
              lines.push(`**${acc.name}** (${acc.id})`);
              lines.push(`  Trades: ${acc.stats.totalTrades} | Win rate: ${acc.stats.winRate.toFixed(1)}%`);
              lines.push(`  PnL: $${acc.stats.totalPnL.toFixed(2)}`);
            }

            if (comparison.best.byPnL) {
              lines.push('');
              lines.push(`Best by PnL: ${comparison.best.byPnL}`);
              lines.push(`Best by Win Rate: ${comparison.best.byWinRate}`);
            }

            return lines.join('\n');
          }

          default:
            return [
              'Usage: /abtest [command]',
              '',
              'Commands:',
              '  list                              - List all A/B tests',
              '  create <n> <s> <a> <b> [p=v1,v2]  - Create test',
              '  start <id>                        - Start test',
              '  stop <id>                         - Stop test & show results',
              '  status <id>                       - Show test status',
              '  compare <acc1> <acc2>             - Compare accounts',
            ].join('\n');
        }
      },
    },
    {
      name: 'strategy',
      description: 'Create or manage trading strategies',
      usage: '/strategy [create|list|delete|templates] [args]',
      aliases: ['strat'],
      handler: async (args, ctx) => {
        const trading = (ctx as any).trading;
        if (!trading?.builder) {
          return 'Strategy builder not initialized.';
        }

        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || 'list';
        const rest = parts.slice(1).join(' ');

        switch (subcommand) {
          case 'templates': {
            const templates = trading.builder.listTemplates();
            const lines = ['Available Strategy Templates', ''];
            for (const tmpl of templates) {
              lines.push(`**${tmpl.name}**`);
              lines.push(`  ${tmpl.description}`);
            }
            lines.push('', 'Use: /strategy create <description>');
            return lines.join('\n');
          }

          case 'create': {
            if (!rest) {
              return [
                'Usage: /strategy create <natural language description>',
                '',
                'Examples:',
                '  /strategy create buy the dip on polymarket when price drops 5%',
                '  /strategy create momentum strategy with 10% take profit',
                '  /strategy create arbitrage between polymarket and kalshi',
              ].join('\n');
            }

            const result = trading.builder.parseNaturalLanguage(rest);
            if ('error' in result) {
              return `Error: ${result.error}`;
            }

            const validation = trading.builder.validate(result);
            if (!validation.valid) {
              return `Validation errors:\n${validation.errors.map((e: string) => `- ${e}`).join('\n')}`;
            }

            // Save the definition
            const defId = trading.builder.saveDefinition(ctx.session.userId, result);

            // Create and register the strategy
            const strategy = trading.builder.createStrategy(result);
            trading.bots.registerStrategy(strategy);

            return [
              `Strategy Created: ${result.name}`,
              '',
              `ID: ${strategy.config.id}`,
              `Template: ${result.template}`,
              `Platforms: ${result.platforms.join(', ')}`,
              '',
              'Entry conditions:',
              ...result.entry.map((e: any) => `  - ${e.type}: ${e.value}`),
              '',
              'Exit conditions:',
              ...result.exit.map((e: any) => `  - ${e.type}: ${e.value}`),
              '',
              'Risk:',
              `  - Max position: $${result.risk.maxPositionSize}`,
              `  - Stop loss: ${result.risk.stopLossPct}%`,
              `  - Take profit: ${result.risk.takeProfitPct}%`,
              '',
              'Mode: DRY RUN (use /bot start to begin)',
              '',
              `Use /bot start ${strategy.config.id} to start trading.`,
            ].join('\n');
          }

          case 'list': {
            const definitions = trading.builder.loadDefinitions(ctx.session.userId);
            if (definitions.length === 0) {
              return 'No strategies saved. Use /strategy create to create one.';
            }

            const lines = ['Your Strategies', ''];
            for (const def of definitions) {
              lines.push(`**${def.definition.name}** (${def.id})`);
              lines.push(`  Template: ${def.definition.template} | Platforms: ${def.definition.platforms.join(', ')}`);
              lines.push(`  Created: ${def.createdAt.toLocaleDateString()}`);
            }
            return lines.join('\n');
          }

          case 'delete': {
            if (!rest) {
              return 'Usage: /strategy delete <strategy-id>';
            }
            const deleted = trading.builder.deleteDefinition(ctx.session.userId, rest);
            return deleted ? `Strategy ${rest} deleted.` : `Strategy ${rest} not found.`;
          }

          default:
            return [
              'Usage: /strategy [command]',
              '',
              'Commands:',
              '  create <description> - Create strategy from natural language',
              '  list                 - List your strategies',
              '  delete <id>         - Delete a strategy',
              '  templates           - Show available templates',
            ].join('\n');
        }
      },
    },
    {
      name: 'stream',
      description: 'Configure trading activity streaming',
      usage: '/stream [on|off|status|channel] [args]',
      handler: async (args, ctx) => {
        const trading = (ctx as any).trading;
        if (!trading?.stream) {
          return 'Trading stream not initialized.';
        }

        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || 'status';
        const rest = parts.slice(1);

        switch (subcommand) {
          case 'status': {
            const config = trading.stream.getConfig();
            return [
              'Trading Stream Status',
              '',
              `Privacy: ${config.privacy}`,
              `Channels: ${config.channels.length}`,
              `Events: ${config.events.join(', ')}`,
              '',
              'Privacy settings:',
              `  Show platforms: ${config.showPlatforms}`,
              `  Show markets: ${config.showMarkets}`,
              `  Show exact prices: ${config.showExactPrices}`,
              `  Show sizes: ${config.showSizes}`,
              `  Show PnL amounts: ${config.showPnL}`,
            ].join('\n');
          }

          case 'on': {
            // Subscribe to console output
            trading.stream.addChannel({ type: 'console', id: 'console' });
            return 'Streaming enabled (console output). Use /stream webhook <url> to add webhook.';
          }

          case 'off': {
            trading.stream.removeChannel('console');
            return 'Streaming disabled.';
          }

          case 'privacy': {
            const level = rest[0]?.toLowerCase();
            if (!level || !['public', 'obscured', 'private'].includes(level)) {
              return 'Usage: /stream privacy [public|obscured|private]';
            }
            trading.stream.configure({ privacy: level });
            return `Privacy set to: ${level}`;
          }

          case 'webhook': {
            const url = rest[0];
            if (!url || !url.startsWith('http')) {
              return 'Usage: /stream webhook <url>';
            }
            trading.stream.addChannel({ type: 'webhook', id: `wh_${Date.now()}`, webhookUrl: url });
            return `Webhook added: ${url}`;
          }

          case 'discord': {
            const url = rest[0];
            if (!url || !url.includes('discord')) {
              return 'Usage: /stream discord <webhook-url>';
            }
            trading.stream.addChannel({ type: 'discord', id: `discord_${Date.now()}`, webhookUrl: url });
            return 'Discord webhook added.';
          }

          case 'slack': {
            const url = rest[0];
            if (!url || !url.includes('slack')) {
              return 'Usage: /stream slack <webhook-url>';
            }
            trading.stream.addChannel({ type: 'slack', id: `slack_${Date.now()}`, webhookUrl: url });
            return 'Slack webhook added.';
          }

          default:
            return [
              'Usage: /stream [command]',
              '',
              'Commands:',
              '  status              - Show stream configuration',
              '  on                  - Enable console streaming',
              '  off                 - Disable streaming',
              '  privacy <level>     - Set privacy (public/obscured/private)',
              '  webhook <url>       - Add webhook endpoint',
              '  discord <url>       - Add Discord webhook',
              '  slack <url>         - Add Slack webhook',
            ].join('\n');
        }
      },
    },
    {
      name: 'devtools',
      description: 'Configure developer tools and debugging',
      usage: '/devtools [on|off|status|ws|datadog|sentry] [args]',
      aliases: ['debug', 'dev'],
      handler: async (args, ctx) => {
        const trading = (ctx as any).trading;
        if (!trading?.devtools) {
          return 'DevTools not initialized. Enable in trading config: devtools: { enabled: true }';
        }

        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || 'status';
        const rest = parts.slice(1);

        switch (subcommand) {
          case 'status': {
            const config = trading.devtools.getConfig();
            const stats = trading.devtools.getStats();

            const lines = [
              'DevTools Status',
              '',
              `Console: ${config.console?.enabled ? '🟢 ON' : '⚪ OFF'}`,
              `WebSocket: ${config.websocket?.enabled ? `🟢 ON (port ${config.websocket.port})` : '⚪ OFF'}`,
              `Datadog: ${config.datadog?.enabled ? '🟢 ON' : '⚪ OFF'}`,
              `Sentry: ${config.sentry?.enabled ? '🟢 ON' : '⚪ OFF'}`,
              '',
              'Stats:',
              `  Events recorded: ${stats.eventsRecorded}`,
              `  Profiler calls: ${stats.profilerCalls}`,
              `  WS clients: ${stats.wsClients}`,
            ];

            return lines.join('\n');
          }

          case 'on': {
            trading.devtools.enable();
            return 'DevTools enabled. Console logging active.';
          }

          case 'off': {
            trading.devtools.disable();
            return 'DevTools disabled.';
          }

          case 'console': {
            const level = rest[0]?.toLowerCase() || 'info';
            const colors = rest.includes('colors') || rest.includes('color');

            trading.devtools.configure({
              console: {
                enabled: true,
                level: level as 'debug' | 'info' | 'warn' | 'error',
                colors,
              },
            });

            return `Console logging: ${level}${colors ? ' with colors' : ''}`;
          }

          case 'ws': {
            const port = parseInt(rest[0], 10) || 9229;

            trading.devtools.configure({
              websocket: { enabled: true, port },
            });

            return [
              `WebSocket server starting on port ${port}`,
              '',
              'Connect with:',
              `  ws://localhost:${port}`,
              '',
              'Or use browser DevTools WebSocket client.',
            ].join('\n');
          }

          case 'datadog': {
            const apiKey = rest[0];
            if (!apiKey) {
              return 'Usage: /devtools datadog <api-key> [service-name]';
            }

            const service = rest[1] || 'clodds-trading';

            trading.devtools.configure({
              datadog: { enabled: true, apiKey, service },
            });

            return `Datadog integration enabled (service: ${service})`;
          }

          case 'sentry': {
            const dsn = rest[0];
            if (!dsn) {
              return 'Usage: /devtools sentry <dsn>';
            }

            trading.devtools.configure({
              sentry: { enabled: true, dsn },
            });

            return 'Sentry error tracking enabled.';
          }

          case 'profile': {
            const operation = rest.join(' ') || 'test_profile';

            // Start profiling
            const profile = trading.devtools.startProfile(operation);

            // Simulate some work
            await new Promise(resolve => setTimeout(resolve, 100));

            // End profiling
            const result = trading.devtools.endProfile(profile.id);

            return [
              'Profile Result',
              '',
              `Operation: ${operation}`,
              `Duration: ${result.duration.toFixed(2)}ms`,
              `Memory delta: ${result.memoryDelta ? `${(result.memoryDelta / 1024).toFixed(2)}KB` : 'n/a'}`,
            ].join('\n');
          }

          case 'events': {
            const limit = parseInt(rest[0], 10) || 10;
            const events = trading.devtools.getRecentEvents(limit);

            if (events.length === 0) {
              return 'No events recorded yet.';
            }

            const lines = [`Recent Events (${events.length})`, ''];
            for (const event of events.slice(0, 10)) {
              const time = event.timestamp.toISOString().slice(11, 19);
              lines.push(`[${time}] ${event.type}: ${event.message || JSON.stringify(event.data).slice(0, 50)}`);
            }

            return lines.join('\n');
          }

          case 'clear': {
            trading.devtools.clearEvents();
            return 'Event history cleared.';
          }

          default:
            return [
              'Usage: /devtools [command]',
              '',
              'Commands:',
              '  status            - Show DevTools status',
              '  on                - Enable DevTools',
              '  off               - Disable DevTools',
              '  console [level]   - Configure console logging',
              '  ws [port]         - Start WebSocket server',
              '  datadog <key>     - Enable Datadog integration',
              '  sentry <dsn>      - Enable Sentry error tracking',
              '  profile [name]    - Run a profile measurement',
              '  events [limit]    - Show recent events',
              '  clear             - Clear event history',
            ].join('\n');
        }
      },
    },
    {
      name: 'opportunity',
      description: 'Find arbitrage and edge opportunities across platforms',
      usage: '/opportunity [scan|active|link|stats|pairs] [args]',
      aliases: ['opp', 'arb', 'find'],
      handler: async (args, ctx) => {
        const finder = ctx.opportunityFinder;
        if (!finder) {
          return 'Opportunity finder not initialized. Enable in config.';
        }

        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || 'scan';
        const rest = parts.slice(1);

        switch (subcommand) {
          case 'scan': {
            // Parse options
            let query: string | undefined;
            let minEdge = 0.5;
            let limit = 20;
            const platforms: string[] = [];
            const types: Array<'internal' | 'cross_platform' | 'edge'> = [];

            for (const part of rest) {
              const lower = part.toLowerCase();
              if (lower.startsWith('minedge=')) {
                minEdge = parseFloat(lower.slice(8)) || 0.5;
              } else if (lower.startsWith('limit=')) {
                limit = parseInt(lower.slice(6), 10) || 20;
              } else if (lower.startsWith('platforms=')) {
                platforms.push(...lower.slice(10).split(','));
              } else if (lower.startsWith('types=')) {
                types.push(...lower.slice(6).split(',') as typeof types);
              } else if (!query) {
                query = part;
              }
            }

            const opportunities = await finder.scan({
              query,
              minEdge,
              limit,
              platforms: platforms.length > 0 ? platforms as Platform[] : undefined,
              types: types.length > 0 ? types : undefined,
              sortBy: 'score',
            });

            if (opportunities.length === 0) {
              return `No opportunities found above ${minEdge}% edge.`;
            }

            const lines = [`Opportunities Found: ${opportunities.length}`, ''];

            for (const opp of opportunities.slice(0, 10)) {
              const typeEmoji = opp.type === 'internal' ? '🔄' :
                                opp.type === 'cross_platform' ? '🌐' : '📊';

              lines.push(`${typeEmoji} **${opp.edgePct.toFixed(2)}% edge** (score: ${opp.score})`);

              for (const market of opp.markets) {
                const action = market.action === 'buy' ? '🟢 BUY' : '🔴 SELL';
                lines.push(`   ${action} ${market.outcome} @ ${(market.price * 100).toFixed(1)}c`);
                lines.push(`   ${market.platform} - ${market.question.slice(0, 50)}...`);
              }

              lines.push(`   💰 Profit/$100: $${opp.profitPer100.toFixed(2)} | Kelly: ${(opp.kellyFraction * 100).toFixed(1)}%`);
              lines.push(`   ⚠️ Slippage: ~${opp.estimatedSlippage.toFixed(1)}% | Liq: $${opp.totalLiquidity.toFixed(0)}`);
              lines.push('');
            }

            if (opportunities.length > 10) {
              lines.push(`...and ${opportunities.length - 10} more. Use limit= to see more.`);
            }

            return lines.join('\n');
          }

          case 'active': {
            const active = finder.getActive();

            if (active.length === 0) {
              return 'No active opportunities. Run /opportunity scan to find some.';
            }

            const lines = [`Active Opportunities: ${active.length}`, ''];

            for (const opp of active.slice(0, 10)) {
              const age = Math.round((Date.now() - opp.discoveredAt.getTime()) / 1000);
              const ttl = Math.round((opp.expiresAt.getTime() - Date.now()) / 1000);

              lines.push(`**${opp.id.slice(0, 20)}...**`);
              lines.push(`  Type: ${opp.type} | Edge: ${opp.edgePct.toFixed(2)}%`);
              lines.push(`  Age: ${age}s | TTL: ${ttl}s | Status: ${opp.status}`);
            }

            return lines.join('\n');
          }

          case 'link': {
            // /opportunity link polymarket:abc kalshi:xyz [confidence]
            const marketA = rest[0];
            const marketB = rest[1];
            const confidence = parseFloat(rest[2]) || 1.0;

            if (!marketA || !marketB) {
              return [
                'Usage: /opportunity link <market_a> <market_b> [confidence]',
                '',
                'Market format: platform:marketId',
                '',
                'Example:',
                '  /opportunity link polymarket:0x123 kalshi:fed-rate-jan',
              ].join('\n');
            }

            finder.linkMarkets(marketA, marketB, confidence);
            return `Linked ${marketA} <-> ${marketB} (confidence: ${confidence})`;
          }

          case 'unlink': {
            const marketA = rest[0];
            const marketB = rest[1];

            if (!marketA || !marketB) {
              return 'Usage: /opportunity unlink <market_a> <market_b>';
            }

            finder.unlinkMarkets(marketA, marketB);
            return `Unlinked ${marketA} <-> ${marketB}`;
          }

          case 'links': {
            const marketKey = rest[0];

            if (!marketKey) {
              // Show all links
              const stats = finder.linker.getStats();
              const allLinks = finder.linker.getAllLinks({ minConfidence: 0.5 });

              const lines = [
                'Market Links',
                '',
                `Total: ${stats.totalLinks}`,
                `By source: ${Object.entries(stats.bySource).map(([k, v]) => `${k}=${v}`).join(', ')}`,
                `Avg confidence: ${stats.avgConfidence.toFixed(2)}`,
                '',
                'Recent links:',
              ];

              for (const link of allLinks.slice(0, 10)) {
                lines.push(`  ${link.marketA} <-> ${link.marketB}`);
                lines.push(`    Confidence: ${link.confidence.toFixed(2)} | Source: ${link.source}`);
              }

              return lines.join('\n');
            }

            // Show links for specific market
            const links = finder.getLinkedMarkets(marketKey);

            if (links.length === 0) {
              return `No links found for ${marketKey}`;
            }

            const lines = [`Links for ${marketKey}`, ''];
            for (const link of links) {
              const other = link.marketA === marketKey ? link.marketB : link.marketA;
              lines.push(`  -> ${other} (${link.confidence.toFixed(2)}, ${link.source})`);
            }

            return lines.join('\n');
          }

          case 'stats': {
            const days = parseInt(rest[0], 10) || 30;
            const stats = finder.getAnalytics({ days });

            const lines = [
              `Opportunity Stats (${days} days)`,
              '',
              `Found: ${stats.totalFound}`,
              `Taken: ${stats.taken}`,
              `Win Rate: ${stats.winRate.toFixed(1)}%`,
              `Total Profit: $${stats.totalProfit.toFixed(2)}`,
              `Avg Edge: ${stats.avgEdge.toFixed(2)}%`,
              '',
              'By Type:',
            ];

            for (const [type, data] of Object.entries(stats.byType)) {
              lines.push(`  ${type}: ${data.count} found, ${data.winRate.toFixed(1)}% WR, $${data.profit.toFixed(2)} profit`);
            }

            if (stats.bestPlatformPair) {
              const bp = stats.bestPlatformPair;
              lines.push('');
              lines.push(`Best Pair: ${bp.platforms.join(' <-> ')}`);
              lines.push(`  ${bp.winRate.toFixed(1)}% WR, $${bp.profit.toFixed(2)} profit`);
            }

            return lines.join('\n');
          }

          case 'pairs': {
            const pairs = finder.getPlatformPairs();

            if (pairs.length === 0) {
              return 'No platform pair data yet. Run scans to build up data.';
            }

            const lines = ['Platform Pair Performance', ''];

            for (const pair of pairs.slice(0, 10)) {
              lines.push(`**${pair.platforms.join(' <-> ')}**`);
              lines.push(`  Opportunities: ${pair.count}`);
              lines.push(`  Avg Edge: ${pair.avgEdge.toFixed(2)}%`);
              lines.push('');
            }

            return lines.join('\n');
          }

          case 'realtime': {
            const action = rest[0]?.toLowerCase() || 'status';

            if (action === 'start') {
              await finder.startRealtime();
              return 'Real-time opportunity scanning started.';
            }

            if (action === 'stop') {
              finder.stopRealtime();
              return 'Real-time scanning stopped.';
            }

            return [
              'Usage: /opportunity realtime [start|stop]',
              '',
              'Start real-time scanning to get live opportunity alerts.',
            ].join('\n');
          }

          case 'take': {
            const oppId = rest[0];
            if (!oppId) {
              return 'Usage: /opportunity take <opportunity-id>';
            }

            const opp = finder.get(oppId);
            if (!opp) {
              return `Opportunity ${oppId} not found or expired.`;
            }

            finder.markTaken(oppId);
            return [
              `Marked opportunity as taken: ${oppId}`,
              '',
              'Execution plan:',
              ...opp.execution.steps.map((s: any) =>
                `  ${s.order}. ${s.action.toUpperCase()} ${s.outcome} @ ${(s.price * 100).toFixed(1)}c on ${s.platform}`
              ),
              '',
              `Estimated profit: $${opp.execution.estimatedProfit.toFixed(2)}`,
              `Risk: ${opp.execution.risk}`,
              ...(opp.execution.warnings.length > 0 ? ['', 'Warnings:', ...opp.execution.warnings.map((w: string) => `  ⚠️ ${w}`)] : []),
            ].join('\n');
          }

          case 'combinatorial':
          case 'comb': {
            // Combinatorial arbitrage scanner (from arXiv:2508.03474)
            // Detects: rebalancing (YES+NO != $1), conditional dependencies
            const { scanCombinatorialArbitrage } = await import('../opportunity/combinatorial');

            let minEdge = 0.5;
            const platforms: string[] = [];

            for (const part of rest) {
              const lower = part.toLowerCase();
              if (lower.startsWith('minedge=')) {
                minEdge = parseFloat(lower.slice(8)) || 0.5;
              } else if (lower.startsWith('platforms=')) {
                platforms.push(...lower.slice(10).split(','));
              }
            }

            const result = await scanCombinatorialArbitrage(ctx.feeds, {
              platforms: platforms.length > 0 ? platforms : ['polymarket', 'kalshi', 'betfair'],
              minEdgePct: minEdge,
            });

            const lines = [
              '**Combinatorial Arbitrage Scan**',
              `(Based on arXiv:2508.03474 - "Unravelling the Probabilistic Forest")`,
              '',
              `Scanned: ${result.scannedMarkets} markets, ${result.scannedPairs} pairs`,
              `Clusters found: ${result.clusters.length}`,
              '',
            ];

            // Rebalancing opportunities
            if (result.rebalance.length > 0) {
              lines.push(`**Rebalancing (YES+NO != $1): ${result.rebalance.length}**`);
              for (const opp of result.rebalance.slice(0, 5)) {
                const emoji = opp.type === 'rebalance_long' ? '📈' : '📉';
                lines.push(`${emoji} ${opp.edgePct.toFixed(2)}% - ${opp.market.question.slice(0, 40)}...`);
                lines.push(`   Cost: $${opp.totalCost.toFixed(3)} → Payout: $1.00 | Net: $${opp.netProfit.toFixed(3)}`);
              }
              lines.push('');
            }

            // Combinatorial opportunities
            if (result.combinatorial.length > 0) {
              lines.push(`**Combinatorial (conditional deps): ${result.combinatorial.length}**`);
              for (const opp of result.combinatorial.slice(0, 5)) {
                const relEmoji: Record<string, string> = {
                  implies: '→',
                  implied_by: '←',
                  mutually_exclusive: '⊕',
                  exhaustive: '∨',
                  equivalent: '↔',
                  inverse: '¬',
                };
                lines.push(`${relEmoji[opp.relationship] || '?'} ${opp.edgePct.toFixed(2)}% (${opp.relationship})`);
                for (const m of opp.markets.slice(0, 2)) {
                  lines.push(`   ${m.platform}: ${m.question.slice(0, 35)}...`);
                }
                lines.push(`   Strategy: ${opp.strategy.action.toUpperCase()} | Conf: ${(opp.confidence * 100).toFixed(0)}%`);
              }
              lines.push('');
            }

            // Cluster summary
            if (result.clusters.length > 0) {
              lines.push('**Top Clusters:**');
              for (const cluster of result.clusters.slice(0, 5)) {
                lines.push(`  ${cluster.topic}: ${cluster.markets.length} markets (sim: ${cluster.avgSimilarity.toFixed(2)})`);
              }
            }

            if (result.rebalance.length === 0 && result.combinatorial.length === 0) {
              lines.push('No combinatorial arbitrage found above threshold.');
            }

            return lines.join('\n');
          }

          default:
            return [
              'Usage: /opportunity [command]',
              '',
              'Commands:',
              '  scan [query] [minEdge=0.5] [limit=20]  - Find opportunities',
              '  active                                  - Show active opportunities',
              '  combinatorial [minEdge=0.5]            - Scan for combinatorial arbitrage',
              '  link <a> <b> [confidence]              - Link equivalent markets',
              '  unlink <a> <b>                         - Remove market link',
              '  links [market]                         - Show market links',
              '  stats [days=30]                        - Show performance stats',
              '  pairs                                  - Show platform pair performance',
              '  realtime [start|stop]                  - Real-time scanning',
              '  take <id>                              - Mark opportunity as taken',
              '',
              'Options:',
              '  minEdge=N      - Minimum edge % (default: 0.5)',
              '  limit=N        - Max results (default: 20)',
              '  platforms=a,b  - Filter platforms',
              '  types=a,b      - Filter types (internal, cross_platform, edge)',
              '',
              'Combinatorial (arXiv:2508.03474):',
              '  - Rebalancing: YES+NO != $1 within single market',
              '  - Dependencies: implies, inverse, mutually_exclusive',
            ].join('\n');
        }
      },
    },
    {
      name: 'trades',
      description: 'View trade history and stats',
      usage: '/trades [stats|export|recent] [platform] [limit=20]',
      handler: async (args, ctx) => {
        const trading = (ctx as any).trading;
        if (!trading?.logger) {
          return 'Trading system not initialized.';
        }

        const parts = args.trim().split(/\s+/).filter(Boolean);
        const subcommand = parts[0]?.toLowerCase() || 'recent';

        let platform: string | undefined;
        let limit = 20;

        for (const part of parts.slice(1)) {
          const lower = part.toLowerCase();
          if (lower.startsWith('limit=')) {
            limit = Math.min(100, parseInt(lower.slice(6), 10) || 20);
          } else if (isPlatformName(lower)) {
            platform = lower;
          }
        }

        switch (subcommand) {
          case 'stats': {
            const filter = platform ? { platform: platform as Platform } : {};
            const stats = trading.logger.getStats(filter);

            return [
              `Trade Statistics${platform ? ` (${platform})` : ''}`,
              '',
              `Total trades: ${stats.totalTrades}`,
              `Win rate: ${stats.winRate.toFixed(1)}%`,
              `Winning: ${stats.winningTrades} | Losing: ${stats.losingTrades}`,
              '',
              `Total PnL: $${stats.totalPnL.toFixed(2)}`,
              `Avg PnL: $${stats.avgPnL.toFixed(2)}`,
              `Avg Win: $${stats.avgWin.toFixed(2)} | Avg Loss: $${stats.avgLoss.toFixed(2)}`,
              `Largest win: $${stats.largestWin.toFixed(2)}`,
              `Largest loss: $${stats.largestLoss.toFixed(2)}`,
              '',
              `Profit factor: ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}`,
              `Total volume: $${stats.totalVolume.toFixed(2)}`,
              `Total fees: $${stats.totalFees.toFixed(2)}`,
            ].join('\n');
          }

          case 'daily': {
            const dailyPnL = trading.logger.getDailyPnL(30);
            if (dailyPnL.length === 0) {
              return 'No daily PnL data yet.';
            }

            const lines = ['Daily PnL (last 30 days)', ''];
            for (const day of dailyPnL.slice(0, 14)) {
              const prefix = day.pnl >= 0 ? '+' : '';
              lines.push(`${day.date}: ${prefix}$${day.pnl.toFixed(2)} (${day.trades} trades)`);
            }
            return lines.join('\n');
          }

          case 'export': {
            const filter = platform ? { platform: platform as Platform } : {};
            const csv = trading.logger.exportCsv(filter);
            return `Exported ${csv.split('\n').length - 1} trades to CSV format.\n\n${csv.slice(0, 1000)}${csv.length > 1000 ? '\n...(truncated)' : ''}`;
          }

          case 'recent':
          default: {
            const filter: any = { limit };
            if (platform) filter.platform = platform;

            const trades = trading.logger.getTrades(filter);
            if (trades.length === 0) {
              return 'No trades recorded yet.';
            }

            const lines = [`Recent Trades (${trades.length})`, ''];
            for (const trade of trades.slice(0, 10)) {
              const pnlStr = trade.realizedPnL !== undefined
                ? ` PnL: ${trade.realizedPnL >= 0 ? '+' : ''}$${trade.realizedPnL.toFixed(2)}`
                : '';
              lines.push(`- ${trade.side.toUpperCase()} ${trade.outcome} @ ${trade.price.toFixed(2)}`);
              lines.push(`  ${trade.platform} | ${trade.status} | ${trade.filled}/${trade.size} shares${pnlStr}`);
            }

            if (trades.length > 10) {
              lines.push(`\n...and ${trades.length - 10} more.`);
            }

            return lines.join('\n');
          }
        }
      },
    },

    // =========================================================================
    // VIRTUALS PROTOCOL COMMANDS
    // =========================================================================
    {
      name: 'agents',
      description: 'Search AI agents on Virtuals Protocol',
      usage: '/agents <query>',
      aliases: ['virtuals'],
      handler: async (args, ctx) => {
        if (!args.trim()) {
          return 'Usage: /agents <query>\nExample: /agents luna\n\nOr use /trending-agents or /new-agents';
        }

        const agents = await virtuals.searchAgents(args.trim(), 10);
        if (agents.length === 0) {
          return `No agents found for "${args}"`;
        }

        const lines = [`AI Agents matching "${args}"`, ''];
        for (const agent of agents) {
          const priceChange = agent.priceChange24h !== undefined
            ? ` (${agent.priceChange24h >= 0 ? '+' : ''}${(agent.priceChange24h * 100).toFixed(1)}%)`
            : '';
          lines.push(`**${agent.name}** ($${agent.symbol})`);
          lines.push(`  Price: ${agent.price.toFixed(6)} VIRTUAL${priceChange}`);
          lines.push(`  MCap: $${(agent.marketCap / 1000).toFixed(1)}K | Vol: $${(agent.volume24h / 1000).toFixed(1)}K | Status: ${agent.status}`);
          lines.push(`  Token: \`${agent.tokenAddress.slice(0, 10)}...${agent.tokenAddress.slice(-6)}\``);
          lines.push('');
        }

        return lines.join('\n');
      },
    },
    {
      name: 'agent',
      description: 'Get detailed info about an AI agent',
      usage: '/agent <token-address>',
      handler: async (args, ctx) => {
        const tokenAddress = args.trim();
        if (!tokenAddress || !tokenAddress.startsWith('0x')) {
          return 'Usage: /agent <token-address>\nExample: /agent 0x1234...';
        }

        const [apiAgent, tokenInfo] = await Promise.all([
          virtuals.getAgentByToken(tokenAddress),
          virtuals.getAgentTokenInfo(tokenAddress).catch(() => null),
        ]);

        if (!apiAgent && !tokenInfo) {
          return `Agent not found: ${tokenAddress}`;
        }

        const lines = [];

        if (apiAgent) {
          lines.push(`**${apiAgent.name}** ($${apiAgent.symbol})`);
          lines.push('');
          lines.push(`Status: ${apiAgent.status.toUpperCase()}`);
          lines.push(`Price: ${apiAgent.price.toFixed(6)} VIRTUAL`);
          lines.push(`Market Cap: $${apiAgent.marketCap.toLocaleString()}`);
          lines.push(`24h Volume: $${apiAgent.volume24h.toLocaleString()}`);
          lines.push(`Holders: ${apiAgent.holders.toLocaleString()}`);
          if (apiAgent.description) {
            lines.push('');
            lines.push(`Description: ${apiAgent.description.slice(0, 200)}${apiAgent.description.length > 200 ? '...' : ''}`);
          }
        }

        if (tokenInfo) {
          lines.push('');
          lines.push('--- On-Chain Data ---');
          lines.push(`Graduated: ${tokenInfo.isGraduated ? 'Yes (trading on Uniswap)' : 'No (bonding curve)'}`);

          if (tokenInfo.bondingCurve) {
            lines.push(`Progress to Graduation: ${tokenInfo.bondingCurve.progressToGraduation.toFixed(1)}%`);
            lines.push(`VIRTUAL Reserve: ${parseFloat(tokenInfo.bondingCurve.virtualReserve).toFixed(2)}`);
            lines.push(`Current Price: ${parseFloat(tokenInfo.bondingCurve.currentPrice).toFixed(8)} VIRTUAL`);
          }

          if (tokenInfo.uniswapPair) {
            lines.push(`Uniswap Pair: ${tokenInfo.uniswapPair}`);
          }
        }

        lines.push('');
        lines.push(`Token: ${tokenAddress}`);
        lines.push(`View: https://app.virtuals.io/agents/${tokenAddress}`);

        return lines.join('\n');
      },
    },
    {
      name: 'trending-agents',
      description: 'Show trending AI agents by volume',
      usage: '/trending-agents [limit]',
      aliases: ['hot-agents'],
      handler: async (args, _ctx) => {
        const limit = Math.min(parseInt(args) || 10, 20);
        const agents = await virtuals.getTrendingAgents(limit);

        if (agents.length === 0) {
          return 'No trending agents found.';
        }

        const lines = ['🔥 Trending AI Agents (by 24h volume)', ''];
        for (let i = 0; i < agents.length; i++) {
          const agent = agents[i];
          const priceChange = agent.priceChange24h !== undefined
            ? ` ${agent.priceChange24h >= 0 ? '📈' : '📉'}${(agent.priceChange24h * 100).toFixed(1)}%`
            : '';
          lines.push(`${i + 1}. **${agent.name}** ($${agent.symbol})${priceChange}`);
          lines.push(`   Vol: $${(agent.volume24h / 1000).toFixed(1)}K | MCap: $${(agent.marketCap / 1000).toFixed(1)}K`);
        }

        return lines.join('\n');
      },
    },
    {
      name: 'new-agents',
      description: 'Show newly launched AI agents',
      usage: '/new-agents [limit]',
      aliases: ['latest-agents'],
      handler: async (args, _ctx) => {
        const limit = Math.min(parseInt(args) || 10, 20);
        const agents = await virtuals.getNewAgents(limit);

        if (agents.length === 0) {
          return 'No new agents found.';
        }

        const lines = ['🆕 New AI Agents', ''];
        for (let i = 0; i < agents.length; i++) {
          const agent = agents[i];
          const created = new Date(agent.createdAt).toLocaleDateString();
          lines.push(`${i + 1}. **${agent.name}** ($${agent.symbol}) - ${agent.status}`);
          lines.push(`   MCap: $${(agent.marketCap / 1000).toFixed(1)}K | Created: ${created}`);
        }

        return lines.join('\n');
      },
    },
    {
      name: 'agent-quote',
      description: 'Get a quote for buying/selling an AI agent token',
      usage: '/agent-quote <buy|sell> <token-address> <amount>',
      handler: async (args, _ctx) => {
        const parts = args.trim().split(/\s+/);
        if (parts.length < 3) {
          return 'Usage: /agent-quote <buy|sell> <token-address> <amount>\nExample: /agent-quote buy 0x1234... 100';
        }

        const [side, tokenAddress, amountStr] = parts;
        if (side !== 'buy' && side !== 'sell') {
          return 'Side must be "buy" or "sell"';
        }
        if (!tokenAddress.startsWith('0x')) {
          return 'Invalid token address';
        }

        const amount = amountStr;

        try {
          const quote = await virtuals.getVirtualsQuote({
            agentToken: tokenAddress,
            amount,
            side: side as 'buy' | 'sell',
            slippageBps: 100,
          });

          const lines = [
            `Quote: ${side.toUpperCase()} ${quote.agentToken.symbol}`,
            '',
            `Route: ${quote.route === 'bonding' ? 'Bonding Curve' : 'Uniswap V2'}`,
            `Input: ${quote.inputAmount} ${side === 'buy' ? 'VIRTUAL' : quote.agentToken.symbol}`,
            `Output: ${quote.outputAmount} ${side === 'buy' ? quote.agentToken.symbol : 'VIRTUAL'}`,
            `Min Output (1% slippage): ${quote.outputAmountMin}`,
            `Price Impact: ${quote.priceImpact.toFixed(2)}%`,
            '',
            `Current Price: ${quote.currentPrice.toFixed(8)} VIRTUAL`,
            `New Price: ${quote.newPrice.toFixed(8)} VIRTUAL`,
          ];

          return lines.join('\n');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return `Quote failed: ${message}`;
        }
      },
    },
    {
      name: 'virtual-balance',
      description: 'Check VIRTUAL token balance',
      usage: '/virtual-balance [address]',
      handler: async (args, _ctx) => {
        const address = args.trim() || undefined;

        try {
          const [virtualBal, veBal] = await Promise.all([
            virtuals.getVirtualBalance(address),
            virtuals.getVeVirtualBalance(address).catch(() => '0'),
          ]);

          const lines = [
            'VIRTUAL Balances',
            '',
            `VIRTUAL: ${parseFloat(virtualBal).toFixed(4)}`,
            `veVIRTUAL: ${parseFloat(veBal).toFixed(4)}`,
          ];

          const canCreate = await virtuals.canCreateAgent(address);
          lines.push('');
          lines.push(`Can Create Agent: ${canCreate.canCreate ? '✅ Yes' : '❌ No'}`);
          if (!canCreate.canCreate) {
            lines.push(`  Need ${canCreate.shortfall} more VIRTUAL (100 required)`);
          }

          return lines.join('\n');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return `Failed to fetch balance: ${message}`;
        }
      },
    },

    // =========================================================================
    // EVM WALLET COMMANDS
    // =========================================================================
    {
      name: 'wallet',
      description: 'Manage EVM wallets',
      usage: '/wallet <create|list|balance> [options]',
      handler: async (args, _ctx) => {
        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase();

        if (!subcommand || subcommand === 'help') {
          return [
            'EVM Wallet Commands',
            '',
            '/wallet create [name]     - Generate new wallet',
            '/wallet list              - List saved wallets',
            '/wallet balance [address] - Check balances across chains',
            '',
            'Keys are stored locally in ~/.clodds/wallets/',
          ].join('\n');
        }

        if (subcommand === 'create') {
          const name = parts[1] || undefined;
          const generated = wallet.generateWallet();
          return [
            'New Wallet Generated',
            '',
            `Address: ${generated.address}`,
            `Public Key: ${generated.publicKey.slice(0, 30)}...`,
            '',
            '**Save these securely:**',
            `Private Key: ${generated.privateKey}`,
            generated.mnemonic ? `Mnemonic: ${generated.mnemonic}` : '',
            '',
            'Use /wallet save <password> to encrypt and store',
          ].filter(Boolean).join('\n');
        }

        if (subcommand === 'list') {
          const wallets = wallet.listWallets();
          if (wallets.length === 0) {
            return 'No saved wallets. Use /wallet create to generate one.';
          }
          const lines = ['Saved Wallets', ''];
          for (const w of wallets) {
            lines.push(`- **${w.name}**: ${w.address}`);
          }
          return lines.join('\n');
        }

        if (subcommand === 'balance') {
          const address = parts[1];
          if (!address || !wallet.isValidAddress(address)) {
            return 'Usage: /wallet balance <0x...address>';
          }

          const result = await multichain.getMultiChainBalances(address);
          const lines = [`Balances for ${address.slice(0, 10)}...${address.slice(-6)}`, ''];

          for (const chain of result.balances) {
            const nativeBal = parseFloat(chain.native.balance);
            if (nativeBal > 0.0001 || chain.tokens.length > 0) {
              lines.push(`**${chain.chainName}**`);
              if (nativeBal > 0.0001) {
                lines.push(`  ${chain.native.symbol}: ${nativeBal.toFixed(6)}`);
              }
              for (const token of chain.tokens) {
                lines.push(`  ${token.symbol}: ${parseFloat(token.balance).toFixed(4)}`);
              }
            }
          }

          if (lines.length === 2) {
            lines.push('No balances found on any chain');
          }

          return lines.join('\n');
        }

        return 'Unknown subcommand. Use /wallet help for options.';
      },
    },
    {
      name: 'swap',
      description: 'Swap tokens via Odos aggregator',
      usage: '/swap <chain> <from> <to> <amount>',
      handler: async (args, _ctx) => {
        const parts = args.trim().split(/\s+/);
        if (parts.length < 4) {
          return [
            'Usage: /swap <chain> <from-token> <to-token> <amount>',
            '',
            'Chains: ethereum, base, polygon, arbitrum, bsc, optimism, avalanche',
            '',
            'Examples:',
            '  /swap base ETH USDC 0.1',
            '  /swap polygon MATIC 0x2791... 100',
            '',
            'Note: Requires EVM_PRIVATE_KEY environment variable',
          ].join('\n');
        }

        const [chainInput, fromToken, toToken, amount] = parts;
        const chain = multichain.resolveChain(chainInput);

        if (!chain) {
          return `Unknown chain: ${chainInput}. Supported: ethereum, base, polygon, arbitrum, bsc, optimism, avalanche`;
        }

        const privateKey = process.env.EVM_PRIVATE_KEY;
        if (!privateKey) {
          return 'EVM_PRIVATE_KEY not set. Configure your wallet key to execute swaps.';
        }

        try {
          // Get quote first
          const quote = await odos.getOdosQuote({
            chain,
            inputToken: fromToken,
            outputToken: toToken,
            amount,
          });

          return [
            'Swap Quote (Odos)',
            '',
            `Chain: ${multichain.getChainConfig(chain).name}`,
            `Input: ${quote.inputAmount} ${fromToken}`,
            `Output: ${quote.outputAmount} ${toToken}`,
            `Price Impact: ${(quote.priceImpact * 100).toFixed(2)}%`,
            `Route: ${quote.route.join(' → ') || 'Direct'}`,
            '',
            'To execute, use /swap-execute with same params',
          ].join('\n');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return `Quote failed: ${message}`;
        }
      },
    },
    {
      name: 'send',
      description: 'Send ETH or ERC20 tokens',
      usage: '/send <chain> <to> <amount> [token]',
      handler: async (args, _ctx) => {
        const parts = args.trim().split(/\s+/);
        if (parts.length < 3) {
          return [
            'Usage: /send <chain> <to-address> <amount> [token-address]',
            '',
            'Examples:',
            '  /send base 0x123... 0.1                    # Send 0.1 ETH',
            '  /send polygon 0x123... 100 0x2791...       # Send 100 USDC',
            '',
            'Chains: ethereum, base, polygon, arbitrum, bsc, optimism, avalanche',
            'Note: Requires EVM_PRIVATE_KEY',
          ].join('\n');
        }

        const [chainInput, to, amount, tokenAddress] = parts;
        const chain = multichain.resolveChain(chainInput);

        if (!chain) {
          return `Unknown chain: ${chainInput}`;
        }

        if (!transfers.validateAddress(to)) {
          return `Invalid recipient address: ${to}`;
        }

        const privateKey = process.env.EVM_PRIVATE_KEY;
        if (!privateKey) {
          return 'EVM_PRIVATE_KEY not set. Configure your wallet key first.';
        }

        try {
          const config = multichain.getChainConfig(chain);

          if (tokenAddress) {
            // ERC20 transfer
            const result = await transfers.sendToken({
              chain,
              to,
              amount,
              privateKey,
              tokenAddress,
            });

            if (result.success) {
              return [
                'Token Transfer Sent',
                '',
                `Token: ${result.token}`,
                `Amount: ${result.amount}`,
                `To: ${result.to}`,
                `TX: ${config.explorer}/tx/${result.txHash}`,
              ].join('\n');
            } else {
              return `Transfer failed: ${result.error}`;
            }
          } else {
            // Native transfer
            const result = await transfers.sendNative({
              chain,
              to,
              amount,
              privateKey,
            });

            if (result.success) {
              return [
                'Transfer Sent',
                '',
                `Amount: ${result.amount} ${config.nativeCurrency.symbol}`,
                `To: ${result.to}`,
                `TX: ${config.explorer}/tx/${result.txHash}`,
              ].join('\n');
            } else {
              return `Transfer failed: ${result.error}`;
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return `Transfer failed: ${message}`;
        }
      },
    },
    {
      name: 'chains',
      description: 'List supported EVM chains',
      usage: '/chains',
      handler: async (_args, _ctx) => {
        const lines = ['Supported EVM Chains', ''];
        for (const [key, config] of Object.entries(multichain.CHAINS)) {
          lines.push(`**${config.name}** (${key})`);
          lines.push(`  Chain ID: ${config.chainId}`);
          lines.push(`  Native: ${config.nativeCurrency.symbol}`);
          lines.push(`  Explorer: ${config.explorer}`);
          lines.push('');
        }
        return lines.join('\n');
      },
    },
  ];
}
