/**
 * Shared frontmatter parser for SKILL.md files
 * Supports both Clodds-native and OpenClaw-format frontmatter
 */

import YAML from 'yaml';
import JSON5 from 'json5';

// =============================================================================
// TYPES
// =============================================================================

export interface SkillGates {
  bins?: string[];
  anyBins?: string[];
  envs?: string[];
  os?: string[];
  config?: string[];
}

export interface ParsedFrontmatter {
  name?: string;
  description?: string;
  emoji?: string;
  homepage?: string;
  commands?: string[];
  metadata?: string;
  gates?: SkillGates;
  userInvocable?: boolean;
  modelInvocable?: boolean;
  // Command dispatch (bypass LLM, route directly to tool)
  commandDispatch?: 'tool';
  commandTool?: string;
  commandArgMode?: 'raw' | 'parsed';
  [key: string]: unknown;
}

export interface InstallCommands {
  darwin?: { command: string };
  linux?: { command: string };
  win32?: { command: string };
}

export interface OpenClawMetadata {
  emoji?: string;
  homepage?: string;
  primaryEnv?: string;
  skillKey?: string;
  always?: boolean;
  os?: string[];
  install?: InstallCommands;
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
}

// =============================================================================
// PARSER
// =============================================================================

const MANIFEST_KEYS = ['clodds', 'openclaw', 'clawdbot'] as const;

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Returns empty frontmatter (no throw) if frontmatter block is missing.
 */
export function parseFrontmatter(content: string): { frontmatter: ParsedFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }

  const [, yamlStr, body] = match;

  let parsed: Record<string, unknown>;
  try {
    parsed = YAML.parse(yamlStr) ?? {};
  } catch {
    // Fall back to empty if YAML is malformed
    return { frontmatter: {}, body: body.trim() };
  }

  const frontmatter: ParsedFrontmatter = {};

  // Scalar fields
  if (typeof parsed.name === 'string') frontmatter.name = parsed.name;
  if (typeof parsed.description === 'string') frontmatter.description = parsed.description;
  if (typeof parsed.emoji === 'string') frontmatter.emoji = parsed.emoji;
  if (typeof parsed.homepage === 'string') frontmatter.homepage = parsed.homepage;

  // Commands array
  if (Array.isArray(parsed.commands)) {
    frontmatter.commands = parsed.commands.filter((c): c is string => typeof c === 'string');
  }

  // Metadata — can be a string (JSON/JSON5) or an object
  if (typeof parsed.metadata === 'string') {
    frontmatter.metadata = parsed.metadata;
  } else if (typeof parsed.metadata === 'object' && parsed.metadata !== null) {
    frontmatter.metadata = JSON.stringify(parsed.metadata);
  }

  // Gates (Clodds native)
  if (typeof parsed.gates === 'object' && parsed.gates !== null) {
    const g = parsed.gates as Record<string, unknown>;
    frontmatter.gates = {};
    if (Array.isArray(g.bins)) frontmatter.gates.bins = g.bins.filter((b): b is string => typeof b === 'string');
    if (Array.isArray(g.anyBins)) frontmatter.gates.anyBins = g.anyBins.filter((b): b is string => typeof b === 'string');
    if (Array.isArray(g.envs)) frontmatter.gates.envs = g.envs.filter((e): e is string => typeof e === 'string');
    if (Array.isArray(g.os)) frontmatter.gates.os = g.os.filter((o): o is string => typeof o === 'string');
    if (Array.isArray(g.config)) frontmatter.gates.config = g.config.filter((c): c is string => typeof c === 'string');
  }

  // Invocation policy
  if (typeof parsed['user-invocable'] === 'boolean') {
    frontmatter.userInvocable = parsed['user-invocable'];
  }
  if (typeof parsed['disable-model-invocation'] === 'boolean') {
    frontmatter.modelInvocable = !parsed['disable-model-invocation'];
  }

  // Command dispatch (bypass LLM, route directly to tool)
  if (parsed['command-dispatch'] === 'tool') {
    frontmatter.commandDispatch = 'tool';
  }
  if (typeof parsed['command-tool'] === 'string') {
    frontmatter.commandTool = parsed['command-tool'];
  }
  if (parsed['command-arg-mode'] === 'raw' || parsed['command-arg-mode'] === 'parsed') {
    frontmatter.commandArgMode = parsed['command-arg-mode'];
  }

  return { frontmatter, body: body.trim() };
}

// =============================================================================
// OPENCLAW METADATA RESOLUTION
// =============================================================================

/**
 * Extract OpenClaw-format metadata from the frontmatter metadata field.
 * Checks for keys: clodds, openclaw, clawdbot
 */
export function resolveMetadata(frontmatter: ParsedFrontmatter): OpenClawMetadata | undefined {
  if (!frontmatter.metadata) return undefined;

  let metaObj: Record<string, unknown>;
  try {
    metaObj = JSON5.parse(frontmatter.metadata);
  } catch {
    return undefined;
  }

  // Find the manifest block under known keys
  for (const key of MANIFEST_KEYS) {
    const block = metaObj[key];
    if (typeof block === 'object' && block !== null) {
      const b = block as Record<string, unknown>;
      const result: OpenClawMetadata = {};

      if (typeof b.emoji === 'string') result.emoji = b.emoji;
      if (typeof b.homepage === 'string') result.homepage = b.homepage;
      if (typeof b.primaryEnv === 'string') result.primaryEnv = b.primaryEnv;
      if (typeof b.skillKey === 'string') result.skillKey = b.skillKey;
      if (typeof b.always === 'boolean') result.always = b.always;
      if (Array.isArray(b.os)) result.os = b.os.filter((o): o is string => typeof o === 'string');

      // Install commands per platform
      if (typeof b.install === 'object' && b.install !== null) {
        const inst = b.install as Record<string, unknown>;
        result.install = {};
        for (const plat of ['darwin', 'linux', 'win32'] as const) {
          const platObj = inst[plat];
          if (typeof platObj === 'object' && platObj !== null) {
            const p = platObj as Record<string, unknown>;
            if (typeof p.command === 'string') {
              result.install[plat] = { command: p.command };
            }
          }
        }
      }

      if (typeof b.requires === 'object' && b.requires !== null) {
        const r = b.requires as Record<string, unknown>;
        result.requires = {};
        if (Array.isArray(r.bins)) result.requires.bins = r.bins.filter((x): x is string => typeof x === 'string');
        if (Array.isArray(r.anyBins)) result.requires.anyBins = r.anyBins.filter((x): x is string => typeof x === 'string');
        if (Array.isArray(r.env)) result.requires.env = r.env.filter((x): x is string => typeof x === 'string');
        if (Array.isArray(r.config)) result.requires.config = r.config.filter((x): x is string => typeof x === 'string');
      }

      return result;
    }
  }

  return undefined;
}

// =============================================================================
// GATE MERGING
// =============================================================================

/**
 * Merge Clodds-native gates with OpenClaw requires into a unified SkillGates.
 */
export function mergeGates(gates?: SkillGates, ocRequires?: OpenClawMetadata['requires']): SkillGates {
  const merged: SkillGates = {};

  // Bins: combine both sources
  const bins = [...(gates?.bins || []), ...(ocRequires?.bins || [])];
  if (bins.length > 0) merged.bins = [...new Set(bins)];

  // AnyBins: combine
  const anyBins = [...(gates?.anyBins || []), ...(ocRequires?.anyBins || [])];
  if (anyBins.length > 0) merged.anyBins = [...new Set(anyBins)];

  // Envs: Clodds uses 'envs', OpenClaw uses 'env'
  const envs = [...(gates?.envs || []), ...(ocRequires?.env || [])];
  if (envs.length > 0) merged.envs = [...new Set(envs)];

  // Config keys
  const config = [...(gates?.config || []), ...(ocRequires?.config || [])];
  if (config.length > 0) merged.config = [...new Set(config)];

  // OS: from gates only (merged at call site from ocMeta)
  if (gates?.os?.length) merged.os = gates.os;

  return merged;
}
