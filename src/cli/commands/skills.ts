/**
 * Skills CLI Commands - Manage skills from command line
 *
 * Commands:
 * - clodds skills list - List installed skills
 * - clodds skills list --verbose - Show detailed info (requirements, commands)
 * - clodds skills search <query> - Search registry
 * - clodds skills install <slug> - Install a skill
 * - clodds skills update [slug] - Update skill(s)
 * - clodds skills uninstall <slug> - Uninstall a skill
 * - clodds skills info <slug> - Show skill details
 */

import * as fs from 'fs';
import * as path from 'path';
import { createSkillsManager, createSkillsRegistry } from '../../skills/index';
import type { Skill, InstalledSkill, RegistrySkill } from '../../skills/index';

export interface SkillsCommands {
  list(options?: { verbose?: boolean }): void;
  search(query: string, options?: { tags?: string[]; limit?: number }): Promise<void>;
  install(slug: string, options?: { force?: boolean }): Promise<void>;
  update(slug?: string): Promise<void>;
  uninstall(slug: string): Promise<void>;
  info(slug: string): Promise<void>;
  checkUpdates(): Promise<void>;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  emoji?: string;
  commands?: string[];
  gates?: {
    bins?: string[];
    envs?: string[] | { anyOf?: string[]; allOf?: string[] };
  };
}

/** Parse YAML frontmatter from SKILL.md content */
function parseFrontmatter(content: string): SkillFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: SkillFrontmatter = {};

  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Remove quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key === 'name') result.name = value;
    else if (key === 'description') result.description = value;
    else if (key === 'emoji') result.emoji = value;
  }

  return result;
}

/** Get skill metadata from SKILL.md file */
function getSkillMeta(skillPath: string): SkillFrontmatter {
  try {
    const content = fs.readFileSync(skillPath, 'utf-8');
    return parseFrontmatter(content);
  } catch {
    return {};
  }
}

export function createSkillsCommands(): SkillsCommands {
  const manager = createSkillsManager({});
  const registry = createSkillsRegistry({});

  /** Format skill for display */
  function formatSkill(skill: Skill | InstalledSkill, meta?: SkillFrontmatter): string {
    const status = 'eligible' in skill
      ? (skill.eligible ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m')
      : '\x1b[36m○\x1b[0m';
    const emoji = meta?.emoji ? `${meta.emoji} ` : '';
    const version = 'version' in skill ? ` \x1b[90mv${skill.version}\x1b[0m` : '';
    return `${status} ${emoji}\x1b[1m${skill.name}\x1b[0m${version}`;
  }

  /** Format registry skill */
  function formatRegistrySkill(skill: RegistrySkill): string {
    const rating = skill.rating ? `⭐${skill.rating.toFixed(1)}` : '';
    const installs = skill.installs ? `📥${skill.installs}` : '';
    return `  ${skill.slug} - ${skill.description}\n    ${rating} ${installs} v${skill.version}`;
  }

  return {
    list(options = {}) {
      console.log('\n\x1b[1m📦 Installed Skills\x1b[0m\n');

      // Load local skills
      manager.load();
      const skills = manager.getAll();

      if (skills.length === 0) {
        console.log('No skills installed.\n');
        console.log('Search for skills: clodds skills search <query>');
        console.log('Install a skill:   clodds skills install <slug>\n');
        return;
      }

      // Group by source
      const bySource: Record<string, Skill[]> = {};
      for (const skill of skills) {
        if (!bySource[skill.source]) {
          bySource[skill.source] = [];
        }
        bySource[skill.source].push(skill);
      }

      for (const [source, sourceSkills] of Object.entries(bySource)) {
        const sourceLabel = source === 'bundled' ? '📦 BUNDLED' : source === 'managed' ? '🔧 MANAGED' : `📁 ${source.toUpperCase()}`;
        console.log(`\x1b[1m${sourceLabel}\x1b[0m`);

        for (const skill of sourceSkills) {
          // Get metadata from SKILL.md if available
          const skillMdPath = skill.directory ? path.join(skill.directory, 'SKILL.md') : null;
          const meta = skillMdPath && fs.existsSync(skillMdPath) ? getSkillMeta(skillMdPath) : {};

          console.log(`  ${formatSkill(skill, meta)}`);

          if (skill.description) {
            console.log(`     \x1b[90m${skill.description}\x1b[0m`);
          }

          if (options.verbose) {
            // Show required environment variables
            if (meta.gates?.envs) {
              const envs = Array.isArray(meta.gates.envs)
                ? meta.gates.envs
                : meta.gates.envs.anyOf || meta.gates.envs.allOf || [];
              if (envs.length > 0) {
                const envStatus = envs.map(env => {
                  const set = !!process.env[env];
                  return set ? `\x1b[32m${env}\x1b[0m` : `\x1b[31m${env}\x1b[0m`;
                }).join(', ');
                console.log(`     \x1b[90mRequires:\x1b[0m ${envStatus}`);
              }
            }

            // Show commands from SKILL.md
            if (meta.commands && meta.commands.length > 0) {
              console.log(`     \x1b[90mCommands:\x1b[0m ${meta.commands.join(', ')}`);
            }
          }

          if (!skill.eligible && skill.ineligibleReason) {
            console.log(`     \x1b[33m⚠ ${skill.ineligibleReason}\x1b[0m`);
          }
        }
        console.log('');
      }

      // Summary
      const eligible = manager.getEligible().length;
      const total = skills.length;
      const status = eligible === total
        ? `\x1b[32mAll ${total} skills eligible\x1b[0m`
        : `\x1b[33m${eligible}/${total} skills eligible\x1b[0m`;

      console.log(status);

      if (!options.verbose) {
        console.log('\x1b[90mRun with --verbose for detailed requirements\x1b[0m\n');
      } else {
        console.log('');
      }
    },

    async search(query, options = {}) {
      console.log(`\n🔍 Searching for "${query}"...\n`);

      try {
        const results = await registry.search(query, {
          tags: options.tags,
          limit: options.limit || 10,
        });

        if (results.length === 0) {
          console.log('No skills found.\n');
          return;
        }

        console.log(`Found ${results.length} skills:\n`);
        for (const skill of results) {
          console.log(formatRegistrySkill(skill));
        }

        console.log('\nInstall with: clodds skills install <slug>\n');
      } catch (error) {
        console.error('Search failed:', error instanceof Error ? error.message : 'Unknown error');
      }
    },

    async install(slug, options = {}) {
      console.log(`\n📥 Installing ${slug}...\n`);

      try {
        const installed = await registry.install(slug, {
          force: options.force,
        });

        console.log(`✅ Installed ${installed.name} v${installed.version}`);
        console.log(`   Location: ${installed.directory}\n`);
      } catch (error) {
        console.error('Install failed:', error instanceof Error ? error.message : 'Unknown error');
      }
    },

    async update(slug?) {
      if (slug) {
        console.log(`\n🔄 Updating ${slug}...\n`);

        try {
          const updated = await registry.update(slug);
          if (updated) {
            console.log(`✅ Updated ${updated.name} to v${updated.version}\n`);
          } else {
            console.log('Skill not found or already up to date.\n');
          }
        } catch (error) {
          console.error('Update failed:', error instanceof Error ? error.message : 'Unknown error');
        }
      } else {
        console.log('\n🔄 Updating all skills...\n');

        try {
          const results = await registry.updateAll();

          let updated = 0;
          let failed = 0;

          for (const result of results) {
            if (result.updated) {
              console.log(`  ✅ ${result.slug}`);
              updated++;
            } else if (result.error) {
              console.log(`  ❌ ${result.slug}: ${result.error}`);
              failed++;
            } else {
              console.log(`  ⏭️  ${result.slug} (up to date)`);
            }
          }

          console.log(`\nUpdated: ${updated}, Failed: ${failed}, Total: ${results.length}\n`);
        } catch (error) {
          console.error('Update failed:', error instanceof Error ? error.message : 'Unknown error');
        }
      }
    },

    async uninstall(slug) {
      console.log(`\n🗑️  Uninstalling ${slug}...\n`);

      try {
        const success = await registry.uninstall(slug);
        if (success) {
          console.log(`✅ Uninstalled ${slug}\n`);
        } else {
          console.log('Skill not found.\n');
        }
      } catch (error) {
        console.error('Uninstall failed:', error instanceof Error ? error.message : 'Unknown error');
      }
    },

    async info(slug) {
      console.log(`\n📋 Skill Info: ${slug}\n`);

      try {
        const skill = await registry.getSkill(slug);
        if (!skill) {
          console.log('Skill not found in registry.\n');
          return;
        }

        console.log(`Name:        ${skill.name}`);
        console.log(`Slug:        ${skill.slug}`);
        console.log(`Version:     ${skill.version}`);
        console.log(`Author:      ${skill.author}`);
        console.log(`Description: ${skill.description}`);

        if (skill.homepage) {
          console.log(`Homepage:    ${skill.homepage}`);
        }
        if (skill.repository) {
          console.log(`Repository:  ${skill.repository}`);
        }
        if (skill.tags && skill.tags.length > 0) {
          console.log(`Tags:        ${skill.tags.join(', ')}`);
        }
        if (skill.platforms && skill.platforms.length > 0) {
          console.log(`Platforms:   ${skill.platforms.join(', ')}`);
        }
        if (skill.requiredEnv && skill.requiredEnv.length > 0) {
          console.log(`Requires:    ${skill.requiredEnv.join(', ')}`);
        }
        if (skill.rating) {
          console.log(`Rating:      ⭐${skill.rating.toFixed(1)}`);
        }
        if (skill.installs) {
          console.log(`Installs:    ${skill.installs.toLocaleString()}`);
        }

        console.log(`Updated:     ${skill.updatedAt}\n`);
      } catch (error) {
        console.error('Info failed:', error instanceof Error ? error.message : 'Unknown error');
      }
    },

    async checkUpdates() {
      console.log('\n🔍 Checking for updates...\n');

      try {
        const updates = await registry.checkUpdates();

        if (updates.length === 0) {
          console.log('All skills are up to date.\n');
          return;
        }

        console.log(`${updates.length} update(s) available:\n`);
        for (const update of updates) {
          console.log(`  ${update.slug}: ${update.currentVersion} → ${update.latestVersion}`);
        }

        console.log('\nRun "clodds skills update" to update all.\n');
      } catch (error) {
        console.error('Check failed:', error instanceof Error ? error.message : 'Unknown error');
      }
    },
  };
}
