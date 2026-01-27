/**
 * Skills CLI Commands - Manage skills from command line
 *
 * Commands:
 * - clodds skills list - List installed skills
 * - clodds skills search <query> - Search registry
 * - clodds skills install <slug> - Install a skill
 * - clodds skills update [slug] - Update skill(s)
 * - clodds skills uninstall <slug> - Uninstall a skill
 * - clodds skills info <slug> - Show skill details
 */

import { createSkillsManager, createSkillsRegistry } from '../../skills/index';
import type { Skill, InstalledSkill, RegistrySkill } from '../../skills/index';

export interface SkillsCommands {
  list(): void;
  search(query: string, options?: { tags?: string[]; limit?: number }): Promise<void>;
  install(slug: string, options?: { force?: boolean }): Promise<void>;
  update(slug?: string): Promise<void>;
  uninstall(slug: string): Promise<void>;
  info(slug: string): Promise<void>;
  checkUpdates(): Promise<void>;
}

export function createSkillsCommands(): SkillsCommands {
  const manager = createSkillsManager({});
  const registry = createSkillsRegistry({});

  /** Format skill for display */
  function formatSkill(skill: Skill | InstalledSkill): string {
    const status = 'eligible' in skill
      ? (skill.eligible ? '✅' : '❌')
      : '📦';
    const version = 'version' in skill ? ` v${skill.version}` : '';
    return `${status} ${skill.name}${version}`;
  }

  /** Format registry skill */
  function formatRegistrySkill(skill: RegistrySkill): string {
    const rating = skill.rating ? `⭐${skill.rating.toFixed(1)}` : '';
    const installs = skill.installs ? `📥${skill.installs}` : '';
    return `  ${skill.slug} - ${skill.description}\n    ${rating} ${installs} v${skill.version}`;
  }

  return {
    list() {
      console.log('\n📦 Installed Skills\n');

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
        console.log(`\n${source.toUpperCase()}:`);
        for (const skill of sourceSkills) {
          console.log(`  ${formatSkill(skill)}`);
          if (skill.description) {
            console.log(`    ${skill.description}`);
          }
          if (!skill.eligible && skill.ineligibleReason) {
            console.log(`    ⚠️  ${skill.ineligibleReason}`);
          }
        }
      }

      console.log(`\nTotal: ${skills.length} skills (${manager.getEligible().length} eligible)\n`);
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
