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

  const lines = content.split('\n');
  let currentSection = 'General';

  const tableRegex = /^\|\s*`\/?[\w-]+\s+([\w-]+)(?:\s[^`]*)?\`\s*\|\s*([^|]+)\|/;
  const lineRegex = new RegExp(
    `^\\s*\\/?${normalized}\\s+(\\w[\\w-]*)(?:\\s[^#\\n]*)?(?:#\\s*(.+))?$`
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
    if (fs.existsSync(skillPath)) {
      const skill = loadSkill(skillPath, opts?.configKeys);
      if (skill) {
        skills.push(skill);
      }
    } else {
      // Fallback: try loading from JS module default export
      const indexPath = path.join(dir, entry.name, 'index.js');
      if (fs.existsSync(indexPath)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const mod = require(indexPath);
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
