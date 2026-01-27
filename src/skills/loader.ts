/**
 * Skill Loader
 * Parses SKILL.md files with YAML frontmatter and loads them for the agent
 */

import * as fs from 'fs';
import * as path from 'path';
import { Skill } from '../types';
import { logger } from '../utils/logger';

interface SkillFrontmatter {
  name: string;
  description: string;
  emoji?: string;
  commands?: string[];
  gates?: {
    bins?: string[];
    envs?: string[];
  };
}

/**
 * Parse YAML frontmatter from a SKILL.md file
 */
function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid SKILL.md format: missing frontmatter');
  }

  const [, yamlStr, body] = match;
  const frontmatter: SkillFrontmatter = { name: '', description: '' };

  // Simple YAML parser for our needs
  for (const line of yamlStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Remove quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key === 'name') frontmatter.name = value;
    else if (key === 'description') frontmatter.description = value;
    else if (key === 'emoji') frontmatter.emoji = value;
  }

  return { frontmatter, body: body.trim() };
}

/**
 * Check if a skill is gated and should be enabled
 */
function checkGates(gates?: SkillFrontmatter['gates']): boolean {
  if (!gates) return true;

  // Check required environment variables
  if (gates.envs) {
    for (const env of gates.envs) {
      if (!process.env[env]) {
        return false;
      }
    }
  }

  // Check required binaries (would need execSync to check, simplified here)
  // In a real implementation, you'd check if bins exist

  return true;
}

/**
 * Load a single skill from a SKILL.md file
 */
export function loadSkill(skillPath: string): Skill | null {
  try {
    const content = fs.readFileSync(skillPath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);

    const enabled = checkGates(frontmatter.gates);

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      path: skillPath,
      content: body,
      enabled,
    };
  } catch (error) {
    logger.error(`Failed to load skill from ${skillPath}:`, error);
    return null;
  }
}

/**
 * Load all skills from a directory
 */
export function loadSkillsFromDir(dir: string): Skill[] {
  const skills: Skill[] = [];

  if (!fs.existsSync(dir)) {
    return skills;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillPath = path.join(dir, entry.name, 'SKILL.md');
      if (fs.existsSync(skillPath)) {
        const skill = loadSkill(skillPath);
        if (skill) {
          skills.push(skill);
        }
      }
    }
  }

  return skills;
}

export interface SkillManager {
  skills: Map<string, Skill>;
  getSkill: (name: string) => Skill | undefined;
  getEnabledSkills: () => Skill[];
  getSkillContext: () => string;
  reload: () => void;
}

/**
 * Create a skill manager that handles loading from multiple sources
 * Priority: workspace > managed > bundled
 */
export function createSkillManager(workspacePath?: string): SkillManager {
  const skillsMap = new Map<string, Skill>();

  const loadAll = () => {
    skillsMap.clear();

    // 1. Load bundled skills first (lowest priority)
    const bundledDir = path.join(__dirname, 'bundled');
    const bundledSkills = loadSkillsFromDir(bundledDir);
    for (const skill of bundledSkills) {
      skillsMap.set(skill.name, skill);
    }

    // 2. Load managed skills (medium priority)
    const managedDir = path.join(process.cwd(), '.clodds', 'skills');
    const managedSkills = loadSkillsFromDir(managedDir);
    for (const skill of managedSkills) {
      skillsMap.set(skill.name, skill);
    }

    // 3. Load workspace skills (highest priority)
    if (workspacePath) {
      const workspaceSkillsDir = path.join(workspacePath, 'skills');
      const workspaceSkills = loadSkillsFromDir(workspaceSkillsDir);
      for (const skill of workspaceSkills) {
        skillsMap.set(skill.name, skill);
      }
    }

    logger.info(`Loaded ${skillsMap.size} skills`);
  };

  // Initial load
  loadAll();

  return {
    skills: skillsMap,

    getSkill(name: string) {
      return skillsMap.get(name);
    },

    getEnabledSkills() {
      return Array.from(skillsMap.values()).filter(s => s.enabled);
    },

    /**
     * Get context string for all enabled skills to inject into system prompt
     */
    getSkillContext() {
      const enabled = this.getEnabledSkills();
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
      loadAll();
    },
  };
}
