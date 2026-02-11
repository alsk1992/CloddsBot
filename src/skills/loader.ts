/**
 * Skill Loader
 * Parses SKILL.md files with YAML frontmatter and loads them for the agent.
 * Supports both Clodds-native and OpenClaw-format SKILL.md files.
 *
 * Features:
 * - YAML frontmatter parsing (shared parser)
 * - OpenClaw metadata resolution
 * - Dependency gating (bins, env, OS, config keys)
 * - bins/ directory scanning with PATH injection
 * - Run-scoped environment injection (save/restore)
 * - Snapshot caching (skip reload if files unchanged)
 * - File watching with debounced hot-reload
 * - Skill whitelisting (allowBundled)
 * - {baseDir} template resolution
 * - command-dispatch for direct tool routing
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { Skill, SkillManagerConfig } from '../types';
import { logger } from '../utils/logger';
import { parseFrontmatter, resolveMetadata, mergeGates, type SkillGates } from './frontmatter.js';
import { registerDispatchSkill, clearDispatchSkills } from './executor';

// =============================================================================
// BINARY CHECKING
// =============================================================================

/** Cache bin lookups so we don't shell out repeatedly */
const BIN_CACHE_MAX = 500;
const binCache = new Map<string, boolean>();

function hasBin(name: string): boolean {
  const cached = binCache.get(name);
  if (cached !== undefined) return cached;
  let found: boolean;
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    found = true;
  } catch {
    found = false;
  }
  if (binCache.size >= BIN_CACHE_MAX) {
    const firstKey = binCache.keys().next().value;
    if (firstKey !== undefined) binCache.delete(firstKey);
  }
  binCache.set(name, found);
  return found;
}

// =============================================================================
// GATE CHECKING
// =============================================================================

/**
 * Check if a skill's gates are satisfied.
 * Config keys are checked against the configKeys map passed from SkillManagerConfig.
 */
function checkGates(gates?: SkillGates, configKeys?: Record<string, unknown>): boolean {
  if (!gates) return true;

  // Check required environment variables
  if (gates.envs?.length) {
    for (const env of gates.envs) {
      if (!process.env[env]) return false;
    }
  }

  // Check required binaries (ALL must exist)
  if (gates.bins?.length) {
    for (const bin of gates.bins) {
      if (!hasBin(bin)) return false;
    }
  }

  // Check any-of binaries (at least ONE must exist)
  if (gates.anyBins?.length) {
    if (!gates.anyBins.some(hasBin)) return false;
  }

  // Check OS
  if (gates.os?.length) {
    const platform = process.platform;
    if (!gates.os.some(os =>
      os === platform ||
      (os === 'macos' && platform === 'darwin') ||
      (os === 'windows' && platform === 'win32')
    )) {
      return false;
    }
  }

  // Check config keys
  if (gates.config?.length && configKeys) {
    for (const key of gates.config) {
      // Support dot-notation: "browser.enabled" → configKeys.browser?.enabled
      const parts = key.split('.');
      let val: unknown = configKeys;
      for (const part of parts) {
        if (typeof val !== 'object' || val === null) { val = undefined; break; }
        if (part === '__proto__' || part === 'constructor' || part === 'prototype') { val = undefined; break; }
        if (!Object.prototype.hasOwnProperty.call(val, part)) { val = undefined; break; }
        val = (val as Record<string, unknown>)[part];
      }
      if (!val) return false;
    }
  }

  return true;
}

// =============================================================================
// BINS/ DIRECTORY SCANNING
// =============================================================================

/**
 * Scan a skill directory for a bins/ subdirectory.
 * Returns the absolute path if it exists and contains files, otherwise undefined.
 */
function scanBinsDir(skillDir: string): string | undefined {
  const binsDir = path.join(skillDir, 'bins');
  if (!fs.existsSync(binsDir)) return undefined;
  try {
    const entries = fs.readdirSync(binsDir);
    if (entries.length > 0) return binsDir;
  } catch {
    // Ignore read errors
  }
  return undefined;
}

// =============================================================================
// ENV OVERRIDES FROM skill.json
// =============================================================================

/**
 * Read env overrides from a skill.json file alongside SKILL.md.
 */
function readEnvOverrides(skillDir: string): Record<string, string> | undefined {
  const jsonPath = path.join(skillDir, 'skill.json');
  if (!fs.existsSync(jsonPath)) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    if (typeof data.env === 'object' && data.env !== null) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(data.env)) {
        if (typeof v === 'string') env[k] = v;
      }
      return Object.keys(env).length > 0 ? env : undefined;
    }
  } catch {
    // Ignore parse errors
  }
  return undefined;
}

// =============================================================================
// SUBCOMMAND PARSING
// =============================================================================

/**
 * Parse subcommands from SKILL.md content, grouped by ### section headings.
 */
function parseSubcommands(skillName: string, content: string): Array<{ name: string; description: string; category: string }> {
  const seen = new Set<string>();
  const result: Array<{ name: string; description: string; category: string }> = [];
  const normalized = skillName.toLowerCase().replace(/\s+/g, '-');
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const lines = content.split('\n');
  let currentSection = 'General';

  const tableRegex = /^\|\s*`\/?[\w-]+\s+([\w-]+)(?:\s[^`]*)?\`\s*\|\s*([^|]+)\|/;
  const lineRegex = new RegExp(
    `^\\s*\\/?${escaped}\\s+(\\w[\\w-]*)(?:\\s[^#\\n]*)?(?:#\\s*(.+))?$`
  );

  for (const line of lines) {
    const headingMatch = line.match(/^###\s+(.+)/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      continue;
    }

    const tableMatch = line.match(tableRegex);
    if (tableMatch) {
      const sub = tableMatch[1].toLowerCase();
      const desc = tableMatch[2].trim();
      if (!seen.has(sub)) {
        seen.add(sub);
        result.push({ name: sub, description: desc, category: currentSection });
      }
      continue;
    }

    const lineMatch = line.match(lineRegex);
    if (lineMatch) {
      const sub = lineMatch[1].toLowerCase();
      const desc = (lineMatch[2] || '').trim();
      if (!seen.has(sub)) {
        seen.add(sub);
        result.push({ name: sub, description: desc, category: currentSection });
      }
    }
  }

  return result;
}

// =============================================================================
// SNAPSHOT CACHING
// =============================================================================

interface SkillSnapshot {
  hash: string;
  skills: Skill[];
}

/**
 * Compute a hash from directory structure and file mtimes.
 * If the hash matches a previous snapshot, we can skip reloading.
 */
function computeDirHash(dir: string): string {
  if (!fs.existsSync(dir)) return '';
  const hash = createHash('sha256');
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMd = path.join(dir, entry.name, 'SKILL.md');
        const skillJson = path.join(dir, entry.name, 'skill.json');
        hash.update(entry.name);
        try {
          if (fs.existsSync(skillMd)) {
            const stat = fs.statSync(skillMd);
            hash.update(String(stat.mtimeMs));
          }
          if (fs.existsSync(skillJson)) {
            const stat = fs.statSync(skillJson);
            hash.update(String(stat.mtimeMs));
          }
        } catch {
          // File may have been deleted between readdir and stat
        }
      }
    }
  } catch {
    return '';
  }
  return hash.digest('hex');
}

// =============================================================================
// SINGLE SKILL LOADER
// =============================================================================

/**
 * Load a single skill from a SKILL.md file.
 */
export function loadSkill(skillPath: string, configKeys?: Record<string, unknown>): Skill | null {
  try {
    const content = fs.readFileSync(skillPath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);

    // Derive name from frontmatter or directory name
    const name = frontmatter.name || path.basename(path.dirname(skillPath));

    // Resolve OpenClaw metadata block
    const ocMeta = resolveMetadata(frontmatter);

    // Merge gates: Clodds native gates + OpenClaw requires
    const gates = mergeGates(frontmatter.gates, ocMeta?.requires);

    // Merge OS from frontmatter gates and OpenClaw metadata
    const os = frontmatter.gates?.os || ocMeta?.os;
    if (os) {
      gates.os = os;
    }

    const enabled = checkGates(gates, configKeys);
    const baseDir = path.dirname(skillPath);

    // Resolve {baseDir} placeholders in body
    const resolvedBody = body.replace(/\{baseDir\}/g, baseDir);

    // Merge top-level fields: frontmatter wins, then ocMeta fallback
    const emoji = frontmatter.emoji || ocMeta?.emoji;
    const homepage = frontmatter.homepage || ocMeta?.homepage;

    // Scan for bins/ directory
    const binsPath = scanBinsDir(baseDir);
    const binPaths = binsPath ? [binsPath] : undefined;

    // Read env overrides from skill.json
    const envOverrides = readEnvOverrides(baseDir);

    return {
      name,
      description: frontmatter.description || '',
      path: skillPath,
      content: resolvedBody,
      enabled,
      subcommands: parseSubcommands(name, resolvedBody),
      emoji,
      homepage,
      primaryEnv: ocMeta?.primaryEnv,
      skillKey: ocMeta?.skillKey,
      always: ocMeta?.always,
      os,
      userInvocable: frontmatter.userInvocable,
      modelInvocable: frontmatter.modelInvocable !== false,
      baseDir,
      commandDispatch: frontmatter.commandDispatch,
      commandTool: frontmatter.commandTool,
      commandArgMode: frontmatter.commandArgMode,
      binPaths,
      envOverrides,
      install: ocMeta?.install,
    };
  } catch (error) {
    logger.error(`Failed to load skill from ${skillPath}:`, error);
    return null;
  }
}

// =============================================================================
// DIRECTORY LOADER
// =============================================================================

/**
 * Load all skills from a directory.
 * Optionally filtered by allowBundled whitelist.
 */
export function loadSkillsFromDir(
  dir: string,
  opts?: { allowList?: string[]; configKeys?: Record<string, unknown> },
): Skill[] {
  const skills: Skill[] = [];

  if (!fs.existsSync(dir)) {
    return skills;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // Whitelist filter
    if (opts?.allowList && !opts.allowList.includes(entry.name)) continue;

    const skillPath = path.join(dir, entry.name, 'SKILL.md');
    const resolvedSkillPath = path.resolve(skillPath);
    if (!resolvedSkillPath.startsWith(path.resolve(dir) + path.sep)) continue;
    if (fs.existsSync(skillPath)) {
      const skill = loadSkill(skillPath, opts?.configKeys);
      if (skill) {
        skills.push(skill);
      }
    } else {
      const indexPath = path.join(dir, entry.name, 'index.js');
      const resolvedIndex = path.resolve(indexPath);
      if (!resolvedIndex.startsWith(path.resolve(dir) + path.sep)) continue;
      if (fs.existsSync(resolvedIndex)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const mod = require(resolvedIndex);
          const def = mod.default || mod;
          if (def && def.name) {
            const cmds = (def.commands || []) as string[];
            const fallbackContent = cmds.length > 0 ? `Commands: ${cmds.join(', ')}` : '';
            skills.push({
              name: def.name,
              description: def.description || '',
              path: indexPath,
              content: fallbackContent,
              enabled: true,
              subcommands: parseSubcommands(def.name, fallbackContent),
            });
          }
        } catch {
          // Skip modules that fail to load
        }
      }
    }
  }

  return skills;
}

// =============================================================================
// SKILL MANAGER
// =============================================================================

export interface SkillManager {
  skills: Map<string, Skill>;
  getSkill: (name: string) => Skill | undefined;
  getEnabledSkills: () => Skill[];
  getSkillContext: () => string;
  /** Get context with only relevant skills expanded based on user message */
  getSkillContextForMessage: (
    message: string,
    hints?: { platforms: string[]; categories: string[] },
    conversationDepth?: number
  ) => string;
  reload: () => void;
  /** Inject skill env overrides into process.env. Returns a restore function. */
  applyEnvOverrides: () => () => void;
  /** Get all bin paths from enabled skills for PATH injection */
  getBinPaths: () => string[];
  /** Stop file watcher if active */
  stopWatching: () => void;
}

/**
 * Create a skill manager that handles loading from multiple sources.
 * Priority: workspace > managed > extraDirs > bundled
 */
export function createSkillManager(workspacePath?: string, config?: SkillManagerConfig): SkillManager {
  const SNAPSHOT_CACHE_MAX = 50;
  const skillsMap = new Map<string, Skill>();
  const snapshots = new Map<string, SkillSnapshot>();
  const watchers: fs.FSWatcher[] = [];
  let watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Load skills from a directory, using snapshot cache if files haven't changed.
   */
  const loadDirCached = (
    dir: string,
    opts?: { allowList?: string[]; configKeys?: Record<string, unknown> },
  ): Skill[] => {
    const hash = computeDirHash(dir);
    const cached = snapshots.get(dir);
    if (cached && cached.hash === hash) {
      return cached.skills;
    }
    const skills = loadSkillsFromDir(dir, opts);
    if (snapshots.size >= SNAPSHOT_CACHE_MAX) {
      const firstKey = snapshots.keys().next().value;
      if (firstKey !== undefined) snapshots.delete(firstKey);
    }
    snapshots.set(dir, { hash, skills });
    return skills;
  };

  const loadAll = () => {
    skillsMap.clear();

    const loaderOpts = { configKeys: config?.configKeys };

    // 1. Load bundled skills first (lowest priority)
    const bundledDir = path.join(__dirname, 'bundled');
    const bundledSkills = loadDirCached(bundledDir, {
      allowList: config?.allowBundled,
      ...loaderOpts,
    });
    for (const skill of bundledSkills) {
      skillsMap.set(skill.name, skill);
    }

    // 2. Load from extra directories
    if (config?.extraDirs) {
      for (const dir of config.extraDirs) {
        const extraSkills = loadDirCached(dir, loaderOpts);
        for (const skill of extraSkills) {
          skillsMap.set(skill.name, skill);
        }
      }
    }

    // 3. Load managed skills (medium priority)
    const managedDir = path.join(process.cwd(), '.clodds', 'skills');
    const managedSkills = loadDirCached(managedDir, loaderOpts);
    for (const skill of managedSkills) {
      skillsMap.set(skill.name, skill);
    }

    // 4. Load workspace skills (highest priority)
    if (workspacePath) {
      const workspaceSkillsDir = path.join(workspacePath, 'skills');
      const workspaceSkills = loadDirCached(workspaceSkillsDir, loaderOpts);
      for (const skill of workspaceSkills) {
        skillsMap.set(skill.name, skill);
      }
    }

    // Register dispatch skills (command-dispatch: tool)
    clearDispatchSkills();
    for (const skill of skillsMap.values()) {
      if (skill.commandDispatch === 'tool' && skill.commandTool && skill.enabled) {
        // Register the skill name as the command (e.g., /himalaya)
        registerDispatchSkill(skill.name, {
          toolName: skill.commandTool,
          argMode: skill.commandArgMode || 'raw',
          skillName: skill.name,
        });
        // Also register any subcommand prefixes
        if (skill.subcommands) {
          for (const sub of skill.subcommands) {
            registerDispatchSkill(`${skill.name} ${sub.name}`, {
              toolName: skill.commandTool,
              argMode: skill.commandArgMode || 'raw',
              skillName: skill.name,
            });
          }
        }
      }
    }

    logger.info(`Loaded ${skillsMap.size} skills`);
  };

  /**
   * Set up file watchers on all skill directories for hot-reload.
   */
  const startWatching = () => {
    const debounceMs = config?.watchDebounceMs ?? 500;
    const dirs = [
      path.join(__dirname, 'bundled'),
      path.join(process.cwd(), '.clodds', 'skills'),
      ...(config?.extraDirs || []),
    ];
    if (workspacePath) {
      dirs.push(path.join(workspacePath, 'skills'));
    }

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const watcher = fs.watch(dir, { recursive: true }, () => {
          // Debounce: multiple file events fire in quick succession
          if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
          watchDebounceTimer = setTimeout(() => {
            logger.info('Skills changed on disk, reloading...');
            // Clear snapshot cache so changes are picked up
            snapshots.clear();
            binCache.clear();
            loadAll();
          }, debounceMs);
        });
        watchers.push(watcher);
      } catch {
        // Directory may not support watching
      }
    }
  };

  // Initial load
  loadAll();

  // Start watching if configured
  if (config?.watch) {
    startWatching();
  }

  return {
    skills: skillsMap,

    getSkill(name: string) {
      return skillsMap.get(name);
    },

    getEnabledSkills() {
      return Array.from(skillsMap.values()).filter(s => s.enabled);
    },

    /**
     * Get context string for all enabled skills to inject into system prompt.
     * Filters out skills with modelInvocable: false.
     */
    getSkillContext() {
      const enabled = this.getEnabledSkills()
        .filter(s => s.modelInvocable !== false);
      if (enabled.length === 0) return '';

      const parts = ['## Available Skills\n'];

      for (const skill of enabled) {
        parts.push(`### ${skill.name}`);
        parts.push(`${skill.description}\n`);
        parts.push(skill.content);
        parts.push('\n---\n');
      }

      return parts.join('\n');
    },

    /**
     * Get context with lazy skill loading — only expand skills matching the message.
     * Uses a compact grouped directory (~300 tokens) + keyword matching to expand
     * only relevant skills within a token budget.
     *
     * Token savings: "hi" → ~300 tokens (vs 133K). "buy on polymarket" → ~8K (vs 133K).
     */
    getSkillContextForMessage(
      message: string,
      hints?: { platforms: string[]; categories: string[] },
      conversationDepth?: number,
    ) {
      const enabled = this.getEnabledSkills()
        .filter(s => s.modelInvocable !== false);
      if (enabled.length === 0) return '';

      const msg = message.toLowerCase();
      const CHARS_PER_TOKEN = 4; // Conservative estimate

      // =====================================================================
      // KEYWORD ALIASES — map abbreviations to canonical names used in skills
      // =====================================================================
      const ALIASES: Record<string, string[]> = {
        // Platform abbreviations
        poly: ['polymarket'], pm: ['polymarket'], polymarket: ['polymarket'],
        sol: ['solana'], solana: ['solana'],
        eth: ['ethereum', 'evm'], ethereum: ['evm'],
        btc: ['bitcoin'], bitcoin: ['bitcoin'],
        hl: ['hyperliquid'], hyper: ['hyperliquid'],
        bnb: ['pancakeswap', 'opinion'],
        // Trading intents (NOT "trading" — too broad, matches all trading-* skills)
        buy: ['execution'], sell: ['execution'],
        trade: ['execution'], order: ['execution'],
        long: ['futures'], short: ['futures'],
        // Strategy
        arb: ['arbitrage', 'opportunity'], arbitrage: ['arbitrage', 'opportunity'],
        perps: ['futures'], perpetuals: ['futures'], leverage: ['futures'],
        copy: ['copy'], mirror: ['copy'],
        snipe: ['pumpfun', 'pump'], pump: ['pumpfun', 'pump'],
        meme: ['pumpfun', 'pump', 'bags'],
        strat: ['strategy', 'backtest'], strategy: ['strategy', 'backtest'],
        backtest: ['backtest'], test: ['backtest'],
        // DeFi
        swap: ['jupiter', 'raydium', 'dex'],
        lp: ['liquidity', 'pool'], pool: ['liquidity'],
        lend: ['kamino', 'marginfi', 'solend'], borrow: ['kamino', 'marginfi', 'solend'],
        defi: ['jupiter', 'raydium', 'orca', 'kamino', 'marginfi', 'solend', 'meteora'],
        bridge: ['bridge'], transfer: ['bridge'],
        // Portfolio & risk
        portfolio: ['portfolio', 'positions'], pnl: ['portfolio', 'positions'],
        balance: ['portfolio'], balances: ['portfolio'], positions: ['positions'],
        risk: ['risk', 'sizing'], sizing: ['sizing'],
        slippage: ['slippage'],
        // Monitoring & data
        whale: ['whale'], whales: ['whale'],
        alert: ['alerts', 'triggers'], alerts: ['alerts', 'triggers'],
        price: ['markets'], prices: ['markets'],
        chart: ['feeds'], charts: ['feeds'],
        news: ['news'], research: ['research', 'edge'],
        search: ['markets'],
        // Admin & config
        setup: ['setup', 'credentials'], config: ['setup', 'credentials'],
        credentials: ['credentials'], api: ['credentials'],
        key: ['credentials'], keys: ['credentials'],
        // System
        help: ['doctor'], diagnose: ['doctor'], debug: ['doctor'],
        ssh: ['remote', 'tailscale'], vpn: ['tailscale'],
        voice: ['voice', 'tts'], speak: ['tts'],
        memory: ['memory'], remember: ['memory'],
        // Social
        tweet: ['tweet', 'farcaster', 'x'],
        twitter: ['x', 'tweet'], farcaster: ['farcaster'],
      };

      // =====================================================================
      // STOP WORDS — skip these when matching description words
      // =====================================================================
      const STOP_WORDS = new Set([
        // English stop words
        'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was',
        'will', 'can', 'all', 'has', 'have', 'been', 'not', 'but', 'use',
        'via', 'your', 'you', 'any', 'more', 'also', 'into', 'when',
        'data', 'based', 'using', 'across', 'complete', 'full', 'manage',
        // Domain-generic words (appear in most trading skill descriptions)
        'market', 'markets', 'trading', 'trade', 'trades', 'token', 'tokens',
        'price', 'prices', 'order', 'orders', 'platform', 'platforms',
        'crypto', 'chain', 'chains', 'protocol', 'exchange', 'onchain',
        'automated', 'monitor', 'track', 'system', 'real', 'time',
        // Generic command verbs (common subcommand names — not useful for matching)
        'check', 'show', 'get', 'set', 'list', 'start', 'stop', 'status',
        'help', 'info', 'view', 'update', 'delete', 'create', 'add', 'remove',
        'search', 'find', 'open', 'close', 'run', 'cancel', 'new', 'true', 'false',
        'config', 'pause', 'resume',
        // Trading verbs too generic as subcommand names (every exchange has buy/sell)
        'buy', 'sell', 'send', 'deposit', 'withdraw', 'balance', 'transfer',
        // Prepositions & connectors
        'across', 'between', 'about', 'over', 'under', 'after', 'before',
        // Prediction market terms too generic
        'yes', 'prediction',
      ]);

      // =====================================================================
      // EXPAND MESSAGE — resolve aliases to get expanded keyword set
      // =====================================================================
      const msgWords = msg.split(/\W+/).filter(w => w.length >= 2);
      const originalWords = new Set(msgWords); // Unaliased — for subcommand matching
      const expandedKeywords = new Set(msgWords); // Aliased — for name/description matching
      for (const word of msgWords) {
        const aliases = ALIASES[word];
        if (aliases) {
          for (const a of aliases) expandedKeywords.add(a);
        }
      }

      // =====================================================================
      // SCORE SKILLS — match against expanded keywords
      // =====================================================================
      const scored: Array<{ skill: Skill; score: number }> = [];
      for (const skill of enabled) {
        let score = 0;

        // Match skill name parts (e.g. "trading-polymarket" → ["trading", "polymarket"])
        // ONLY whole-word matching to avoid "market" matching inside "polymarket"
        const nameParts = skill.name.split(/[-_]/);
        for (const part of nameParts) {
          if (part.length < 3) continue;
          if (expandedKeywords.has(part)) score += 3;
        }

        // Match meaningful description words (lower weight — descriptions are broad)
        const descWords = skill.description.toLowerCase().split(/\W+/);
        for (const w of descWords) {
          if (w.length < 4 || STOP_WORDS.has(w)) continue;
          if (expandedKeywords.has(w)) score += 1;
        }

        // Match subcommand names — use ORIGINAL words only (not aliases)
        // to prevent alias expansion like pnl→"positions" from matching
        // the "positions" subcommand in every exchange skill
        if (skill.subcommands) {
          for (const sub of skill.subcommands) {
            const subName = sub.name.toLowerCase();
            if (subName.length >= 3 && !STOP_WORDS.has(subName) && originalWords.has(subName)) score += 4;
          }
        }

        // Minimum score 2 — require at least a name-part match (3) or
        // multiple description/subcommand matches. Single description word
        // matches (score 1) are too noisy.
        if (score >= 2) scored.push({ skill, score });
      }

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // Calculate dynamic budget based on query complexity
      const totalScore = scored.reduce((sum, s) => sum + s.score, 0);
      const platformCount = hints?.platforms.length ?? 0;
      const categoryCount = hints?.categories.length ?? 0;
      const depth = conversationDepth ?? 0;

      let TOKEN_BUDGET: number;
      if (scored.length === 0) {
        TOKEN_BUDGET = 500;
      } else if (scored.length <= 2 && totalScore < 10) {
        TOKEN_BUDGET = 2000;
      } else if (scored.length <= 4 && totalScore < 20) {
        TOKEN_BUDGET = 8000;
      } else if (scored.length <= 6 && platformCount <= 2) {
        TOKEN_BUDGET = 16000;
      } else if (platformCount >= 3 || categoryCount >= 3) {
        TOKEN_BUDGET = 48000;
      } else {
        TOKEN_BUDGET = 32000;
      }

      // Deep conversations need less skill detail (rely on history)
      if (depth > 10) TOKEN_BUDGET = Math.max(8000, Math.floor(TOKEN_BUDGET * 0.6));

      // Cap at 80K
      TOKEN_BUDGET = Math.min(80000, TOKEN_BUDGET);

      const CHAR_BUDGET = TOKEN_BUDGET * CHARS_PER_TOKEN;

      logger.info({
        skillMatches: scored.length,
        budget: TOKEN_BUDGET,
        platforms: platformCount,
        categories: categoryCount,
        depth,
        totalScore,
      }, 'Skill context: Dynamic budget calculated');

      // Select within token budget
      const expanded = new Set<string>();
      let charBudgetUsed = 0;
      for (const { skill } of scored) {
        const contentChars = skill.content.length;
        if (charBudgetUsed + contentChars > CHAR_BUDGET) {
          // If we haven't expanded anything yet, allow one skill even if over budget
          if (expanded.size > 0) continue;
        }
        expanded.add(skill.name);
        charBudgetUsed += contentChars;
      }

      // =====================================================================
      // BUILD CONTEXT — compact directory + expanded details
      // =====================================================================
      const SKILL_GROUPS: Record<string, string[]> = {
        'Trading': [], 'Futures/Perps': [], 'Solana DeFi': [], 'EVM': [],
        'Strategy': [], 'Portfolio': [], 'Monitoring': [], 'Analytics': [],
        'Social': [], 'Admin': [], 'System': [], 'Other': [],
      };

      // Categorize skills into groups based on name patterns
      const categorize = (name: string): string => {
        if (/^trading-/.test(name) || /^(betfair|smarkets|metaculus|predictit|predictfun|opinion|veil|agentbets|markets)$/.test(name)) return 'Trading';
        if (/futures$/.test(name) || /^(hyperliquid|drift|drift-sdk|percolator|lighter)$/.test(name)) return 'Futures/Perps';
        if (/^(jupiter|raydium|pumpfun|pump-swarm|meteora|meteora-dbc|orca|kamino|marginfi|solend|dex|mev|bags|copy-trading-solana)$/.test(name)) return 'Solana DeFi';
        if (/^(bridge|clanker|pancakeswap|ens|onchainkit|erc8004)$/.test(name)) return 'EVM';
        if (/^(arbitrage|opportunity|edge|divergence|crypto-hft|mm|copy-trading|ai-strategy|strategy|backtest|sizing|signals|dca)$/.test(name)) return 'Strategy';
        if (/^(portfolio|portfolio-sync|positions|risk|slippage|execution|router|trading-system)$/.test(name)) return 'Portfolio';
        if (/^(whale-tracking|alerts|triggers|feeds|ticks|monitoring|features|weather|news)$/.test(name)) return 'Monitoring';
        if (/^(metrics|analytics|history|usage|ledger|market-index|search-config)$/.test(name)) return 'Analytics';
        if (/^(farcaster|tweet-ideas|x-research|botchan|bankr|virtuals)$/.test(name)) return 'Social';
        if (/^(credentials|sessions|permissions|identity|setup|harden|shield|verify|doctor)$/.test(name)) return 'Admin';
        if (/^(processes|automation|webhooks|routing|pairing|auto-reply|mcp|plugins|acp|remote|tailscale|sandbox|voice|tts|streaming|presence|memory|embeddings|qmd)$/.test(name)) return 'System';
        return 'Other';
      };

      for (const skill of enabled) {
        const group = categorize(skill.name);
        SKILL_GROUPS[group].push(skill.name);
      }

      const parts = ['## Available Skills\n'];

      // Compact grouped directory
      for (const [group, names] of Object.entries(SKILL_GROUPS)) {
        if (names.length === 0) continue;
        parts.push(`**${group}:** ${names.join(', ')}`);
      }
      parts.push('');

      // Expanded skill details
      if (expanded.size > 0) {
        parts.push('### Relevant Skill Details\n');
        for (const skill of enabled) {
          if (!expanded.has(skill.name)) continue;
          parts.push(`#### ${skill.name}`);
          parts.push(skill.content);
          parts.push('\n---\n');
        }
      }

      return parts.join('\n');
    },

    reload() {
      snapshots.clear();
      binCache.clear();
      loadAll();
    },

    /**
     * Inject env overrides from all enabled skills into process.env.
     * Returns a restore function that undoes all changes.
     */
    applyEnvOverrides() {
      const saved = new Map<string, string | undefined>();
      const enabled = this.getEnabledSkills();

      for (const skill of enabled) {
        if (!skill.envOverrides) continue;
        for (const [key, value] of Object.entries(skill.envOverrides)) {
          // Save original value (undefined if not set)
          if (!saved.has(key)) {
            saved.set(key, process.env[key]);
          }
          process.env[key] = value;
        }
      }

      // Return restore function
      return () => {
        for (const [key, original] of saved) {
          if (original === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = original;
          }
        }
      };
    },

    /**
     * Get all bin paths from enabled skills for PATH injection.
     * Caller should prepend these to process.env.PATH.
     */
    getBinPaths() {
      const paths: string[] = [];
      for (const skill of this.getEnabledSkills()) {
        if (skill.binPaths) {
          paths.push(...skill.binPaths);
        }
      }
      return paths;
    },

    stopWatching() {
      for (const watcher of watchers) {
        try { watcher.close(); } catch { /* ignore */ }
      }
      watchers.length = 0;
      if (watchDebounceTimer) {
        clearTimeout(watchDebounceTimer);
        watchDebounceTimer = null;
      }
    },
  };
}
