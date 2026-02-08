/**
 * Standardized Help System for Skills
 *
 * Provides consistent help output format across all 116 skills.
 * Skills call formatHelp() in their default/help case.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface HelpCommand {
  cmd: string;
  description: string;
}

export interface HelpSection {
  title: string;
  commands: HelpCommand[];
}

export interface HelpConfig {
  name: string;
  emoji?: string;
  description: string;
  sections: HelpSection[];
  examples?: string[];
  envVars?: Array<{ name: string; description: string; required?: boolean }>;
  seeAlso?: Array<{ cmd: string; description: string }>;
  notes?: string[];
}

// =============================================================================
// FORMATTER
// =============================================================================

export function formatHelp(config: HelpConfig): string {
  const lines: string[] = [];

  // Header
  const emoji = config.emoji ? `${config.emoji} ` : '';
  lines.push(`**${emoji}${config.name}**`);
  lines.push(config.description);
  lines.push('');

  // Command sections
  for (const section of config.sections) {
    lines.push(`**${section.title}:**`);
    for (const cmd of section.commands) {
      lines.push(`  ${cmd.cmd}  —  ${cmd.description}`);
    }
    lines.push('');
  }

  // Examples
  if (config.examples && config.examples.length > 0) {
    lines.push('**Examples:**');
    for (const ex of config.examples) {
      lines.push(`  ${ex}`);
    }
    lines.push('');
  }

  // Environment variables
  if (config.envVars && config.envVars.length > 0) {
    lines.push('**Environment Variables:**');
    for (const v of config.envVars) {
      const req = v.required ? ' (required)' : ' (optional)';
      lines.push(`  ${v.name}${req} — ${v.description}`);
    }
    lines.push('');
  }

  // See also
  if (config.seeAlso && config.seeAlso.length > 0) {
    lines.push('**See Also:**');
    for (const s of config.seeAlso) {
      lines.push(`  ${s.cmd}  —  ${s.description}`);
    }
    lines.push('');
  }

  // Notes
  if (config.notes && config.notes.length > 0) {
    for (const note of config.notes) {
      lines.push(`> ${note}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// =============================================================================
// USAGE FORMATTER (for inline error messages)
// =============================================================================

export function formatUsage(command: string, args: string, example?: string): string {
  const lines = [`Usage: ${command} ${args}`];
  if (example) {
    lines.push(`Example: ${example}`);
  }
  return lines.join('\n');
}
