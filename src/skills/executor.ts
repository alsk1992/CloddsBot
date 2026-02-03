/**
 * Skill Executor - Central registry for all 103 bundled CLI skill handlers.
 *
 * ARCHITECTURE:
 * - Each skill lives in src/skills/bundled/<name>/index.ts
 * - Each skill exports default { name, description, commands, handle|handler }
 * - Skills are loaded lazily via dynamic import() on first use
 * - Each skill is loaded in its own try/catch so one broken skill can't crash others
 * - Skills can declare `requires: { env: ['VAR'] }` for pre-flight env checks
 *
 * ADDING A NEW SKILL:
 * 1. Create src/skills/bundled/<name>/index.ts with default export
 * 2. Add the directory name to SKILL_MANIFEST below
 * 3. Run `npx tsc --noEmit` to verify
 *
 * SKILL HANDLER CONTRACT:
 * - `handle(args: string)` receives everything AFTER the command prefix
 *   e.g., "/bf balance" calls handle("balance")
 * - Must return a Promise<string> (the response text)
 * - Both `handle` and `handler` method names are accepted (normalizeSkill handles both)
 * - commands can be string[] or {name, description, usage}[] (normalized to string[])
 *
 * BACKING MODULES:
 * - Most skills wrap real modules in src/ (e.g., execution/, trading/, feeds/, etc.)
 * - Skills use dynamic imports (await import(...)) inside try/catch so the CLI
 *   still works even if a backing module's dependencies aren't installed
 * - When a backing module can't load, the skill falls through to help text
 */

import { logger } from '../utils/logger';

// =============================================================================
// SKILL MANIFEST - all 103 bundled skill directory names
// =============================================================================

const SKILL_MANIFEST: string[] = [
  'acp',
  'ai-strategy',
  'alerts',
  'analytics',
  'arbitrage',
  'auto-reply',
  'automation',
  'backtest',
  'bags',
  'bankr',
  'betfair',
  'binance-futures',
  'botchan',
  'bridge',
  'bybit-futures',
  'clanker',
  'copy-trading',
  'copy-trading-solana',
  'credentials',
  'doctor',
  'drift',
  'drift-sdk',
  'edge',
  'embeddings',
  'endaoment',
  'ens',
  'erc8004',
  'execution',
  'farcaster',
  'features',
  'feeds',
  'harden',
  'history',
  'hyperliquid',
  'identity',
  'integrations',
  'jupiter',
  'ledger',
  'market-index',
  'markets',
  'mcp',
  'memory',
  'metaculus',
  'meteora',
  'metrics',
  'mev',
  'mexc-futures',
  'monitoring',
  'news',
  'onchainkit',
  'opinion',
  'opportunity',
  'orca',
  'pairing',
  'permissions',
  'plugins',
  'portfolio',
  'portfolio-sync',
  'positions',
  'predictfun',
  'predictit',
  'presence',
  'processes',
  'pump-swarm',
  'pumpfun',
  'qmd',
  'qrcoin',
  'raydium',
  'remote',
  'research',
  'risk',
  'router',
  'routing',
  'sandbox',
  'search-config',
  'sessions',
  'signals',
  'sizing',
  'slippage',
  'smarkets',
  'strategy',
  'streaming',
  'tailscale',
  'ticks',
  'trading-evm',
  'trading-futures',
  'trading-kalshi',
  'trading-manifold',
  'trading-polymarket',
  'trading-solana',
  'trading-system',
  'triggers',
  'tts',
  'tweet-ideas',
  'usage',
  'veil',
  'verify',
  'virtuals',
  'voice',
  'weather',
  'webhooks',
  'whale-tracking',
  'yoink',
];

// =============================================================================
// TYPES
// =============================================================================

export interface SkillHandler {
  name: string;
  description: string;
  commands: string[] | Array<{ name: string; description: string; usage: string }>;
  /** Handler function (can be named 'handle' or 'handler') */
  handle?: (args: string) => Promise<string>;
  handler?: (args: string) => Promise<string>;
  /** Optional requirements that must be met before the handler runs */
  requires?: {
    env?: string[];
  };
}

/** Normalized skill handler with guaranteed handle function */
interface NormalizedSkillHandler {
  name: string;
  description: string;
  commands: string[];
  handle: (args: string) => Promise<string>;
}

/** Normalize skill handler to consistent interface */
function normalizeSkill(skill: SkillHandler): NormalizedSkillHandler {
  // Normalize commands array (some skills have {name,description,usage} format)
  const commands: string[] = skill.commands.map((cmd) =>
    typeof cmd === 'string' ? cmd : cmd.name
  );

  // Use handle or handler method
  const handleFn = skill.handle || skill.handler;
  if (!handleFn) {
    throw new Error(`Skill ${skill.name} has no handle or handler method`);
  }

  // Wrap handler with env-var requirement checking if declared
  const requiredEnv = skill.requires?.env;
  let wrappedHandle: (args: string) => Promise<string>;

  if (requiredEnv && requiredEnv.length > 0) {
    const boundHandle = handleFn;
    wrappedHandle = async (args: string): Promise<string> => {
      const missing = requiredEnv.filter((v) => !process.env[v]);
      if (missing.length > 0) {
        return `⚠ ${skill.name} requires environment variables to be set:\n\n${missing.map((v) => `  • ${v}`).join('\n')}\n\nSet them in your environment or .env file to use this skill.`;
      }
      return boundHandle(args);
    };
  } else {
    wrappedHandle = handleFn;
  }

  return {
    name: skill.name,
    description: skill.description,
    commands,
    handle: wrappedHandle,
  };
}

// =============================================================================
// SKILL REGISTRY
// =============================================================================

/** Map of command prefix to skill handler */
const commandToSkill = new Map<string, NormalizedSkillHandler>();

/** All registered skill handlers */
const registeredSkills: NormalizedSkillHandler[] = [];

/** Track which skills failed to load */
const failedSkills: Array<{ name: string; error: string }> = [];

/** Track which skills have env requirements */
const skillRequirements: Map<string, string[]> = new Map();

/**
 * Register a skill handler
 */
function registerSkill(skill: SkillHandler): void {
  try {
    // Track requirements before normalizing
    if (skill.requires?.env) {
      skillRequirements.set(skill.name, skill.requires.env);
    }

    const normalized = normalizeSkill(skill);
    registeredSkills.push(normalized);
    for (const cmd of normalized.commands) {
      const normalizedCmd = cmd.toLowerCase().startsWith('/') ? cmd.toLowerCase() : `/${cmd.toLowerCase()}`;
      commandToSkill.set(normalizedCmd, normalized);
      logger.debug({ skill: normalized.name, command: normalizedCmd }, 'Registered skill command');
    }
  } catch (error) {
    logger.error({ skill: skill.name, error }, 'Failed to register skill');
  }
}

// =============================================================================
// LAZY INITIALIZATION
// =============================================================================

let initialized = false;
let initializing: Promise<void> | null = null;

/**
 * Lazily load and register all skills from SKILL_MANIFEST.
 * Each skill is loaded in its own try/catch so a missing dependency
 * (e.g., viem, @solana/web3.js) only takes down that one skill.
 */
async function initializeSkills(): Promise<void> {
  if (initialized) return;
  if (initializing) return initializing;

  initializing = (async () => {
    const results = await Promise.allSettled(
      SKILL_MANIFEST.map(async (name) => {
        try {
          const mod = await import(`./bundled/${name}/index`);
          const skill = mod.default || mod;
          registerSkill(skill as SkillHandler);
          return { name, ok: true };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          failedSkills.push({ name, error: errorMsg });
          logger.warn({ skill: name, error: errorMsg }, 'Failed to load skill');
          return { name, ok: false };
        }
      })
    );

    const loaded = results.filter(
      (r) => r.status === 'fulfilled' && r.value.ok
    ).length;
    const failed = SKILL_MANIFEST.length - loaded;

    logger.info(
      { loaded, failed, total: SKILL_MANIFEST.length },
      'Skill initialization complete'
    );

    if (failed > 0 && failed !== SKILL_MANIFEST.length) {
      logger.warn(
        { failed, names: failedSkills.map((f) => f.name) },
        'Some skills failed to load (missing dependencies?)'
      );
    }

    // Register the built-in /skills command
    registerBuiltinSkillsCommand();

    initialized = true;
  })();

  return initializing;
}

/**
 * Register the built-in /skills command that shows skill status
 */
function registerBuiltinSkillsCommand(): void {
  const skillsHandler: SkillHandler = {
    name: 'skills-status',
    description: 'Show status of all loaded skills',
    commands: ['/skills'],
    handle: async (_args: string): Promise<string> => {
      const lines: string[] = ['# Skill Status\n'];

      // Ready skills
      const ready: string[] = [];
      const needsConfig: string[] = [];

      for (const skill of registeredSkills) {
        if (skill.name === 'skills-status') continue;
        const reqs = skillRequirements.get(skill.name);
        if (reqs && reqs.length > 0) {
          const missing = reqs.filter((v) => !process.env[v]);
          if (missing.length > 0) {
            needsConfig.push(
              `  ⚙ ${skill.name} — needs: ${missing.join(', ')}`
            );
            continue;
          }
        }
        ready.push(`  ✓ ${skill.name}`);
      }

      lines.push(`## Ready (${ready.length})`);
      if (ready.length > 0) {
        lines.push(ready.join('\n'));
      }

      if (needsConfig.length > 0) {
        lines.push(`\n## Needs Configuration (${needsConfig.length})`);
        lines.push(needsConfig.join('\n'));
      }

      if (failedSkills.length > 0) {
        lines.push(`\n## Failed to Load (${failedSkills.length})`);
        for (const f of failedSkills) {
          // Truncate long error messages
          const shortErr = f.error.length > 80 ? f.error.slice(0, 77) + '...' : f.error;
          lines.push(`  ✗ ${f.name} — ${shortErr}`);
        }
      }

      lines.push(
        `\n**Total:** ${registeredSkills.length - 1} loaded, ${failedSkills.length} failed, ${SKILL_MANIFEST.length} in manifest`
      );

      return lines.join('\n');
    },
  };

  registerSkill(skillsHandler);
}

// =============================================================================
// EXECUTOR
// =============================================================================

export interface SkillExecutionResult {
  handled: boolean;
  response?: string;
  error?: string;
  skill?: string;
}

/**
 * Execute a skill command
 *
 * @param message - The full message text (e.g., "/bf balance")
 * @returns Result of execution
 */
export async function executeSkillCommand(message: string): Promise<SkillExecutionResult> {
  // Ensure skills are loaded on first invocation
  await initializeSkills();

  const trimmed = message.trim();

  // Check if it's a command
  if (!trimmed.startsWith('/')) {
    return { handled: false };
  }

  // Parse command and arguments
  const spaceIndex = trimmed.indexOf(' ');
  const command = spaceIndex === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIndex).toLowerCase();
  const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1);

  // Find matching skill handler
  const skill = commandToSkill.get(command);
  if (!skill) {
    return { handled: false };
  }

  try {
    logger.info({ skill: skill.name, command, args }, 'Executing skill command');
    const response = await skill.handle(args);
    return {
      handled: true,
      response,
      skill: skill.name,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ skill: skill.name, command, error: errorMessage }, 'Skill command failed');
    return {
      handled: true,
      error: errorMessage,
      skill: skill.name,
    };
  }
}

/**
 * Get all registered skill handlers
 */
export function getRegisteredSkills(): NormalizedSkillHandler[] {
  return [...registeredSkills];
}

/**
 * Get skill handler by command
 */
export function getSkillByCommand(command: string): NormalizedSkillHandler | undefined {
  const normalized = command.toLowerCase().startsWith('/') ? command.toLowerCase() : `/${command.toLowerCase()}`;
  return commandToSkill.get(normalized);
}

/**
 * Check if a command is handled by a skill
 */
export function isSkillCommand(command: string): boolean {
  const normalized = command.toLowerCase().startsWith('/') ? command.toLowerCase() : `/${command.toLowerCase()}`;
  return commandToSkill.has(normalized);
}

/**
 * Get all registered skill commands
 */
export function getSkillCommands(): Array<{ command: string; skill: string; description: string }> {
  const commands: Array<{ command: string; skill: string; description: string }> = [];
  for (const skill of registeredSkills) {
    for (const cmd of skill.commands) {
      commands.push({
        command: cmd,
        skill: skill.name,
        description: skill.description,
      });
    }
  }
  return commands;
}

/**
 * Get list of failed skills (for diagnostics)
 */
export function getFailedSkills(): Array<{ name: string; error: string }> {
  return [...failedSkills];
}
