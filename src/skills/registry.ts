/**
 * Skills Registry - ClawdHub-style skill discovery and installation
 *
 * Features:
 * - Search skills from registry
 * - Install/update skills
 * - Manage installed skills
 * - Auto-discovery for agent
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/logger';

/** Registry skill metadata */
export interface RegistrySkill {
  slug: string;
  name: string;
  description: string;
  version: string;
  author: string;
  homepage?: string;
  repository?: string;
  /** Required environment variables */
  requiredEnv?: string[];
  /** Required binaries */
  requiredBinaries?: string[];
  /** Supported platforms */
  platforms?: string[];
  /** Download URL */
  downloadUrl: string;
  /** SHA256 checksum */
  checksum?: string;
  /** Install count */
  installs?: number;
  /** Rating (0-5) */
  rating?: number;
  /** Tags */
  tags?: string[];
  updatedAt: string;
}

/** Installed skill info */
export interface InstalledSkill {
  slug: string;
  name: string;
  version: string;
  installedAt: Date;
  updatedAt: Date;
  directory: string;
  enabled: boolean;
}

/** Registry configuration */
export interface RegistryConfig {
  /** Registry URL */
  registryUrl?: string;
  /** Skills directory */
  skillsDir?: string;
  /** Auto-update on startup */
  autoUpdate?: boolean;
  /** Cache TTL in ms */
  cacheTtl?: number;
}

export interface SkillsRegistry {
  /** Search skills in registry */
  search(query: string, options?: {
    tags?: string[];
    limit?: number;
  }): Promise<RegistrySkill[]>;

  /** Get skill details */
  getSkill(slug: string): Promise<RegistrySkill | null>;

  /** Install a skill */
  install(slug: string, options?: {
    version?: string;
    force?: boolean;
  }): Promise<InstalledSkill>;

  /** Update a skill */
  update(slug: string): Promise<InstalledSkill | null>;

  /** Update all installed skills */
  updateAll(): Promise<Array<{ slug: string; updated: boolean; error?: string }>>;

  /** Uninstall a skill */
  uninstall(slug: string): Promise<boolean>;

  /** List installed skills */
  listInstalled(): InstalledSkill[];

  /** Check for updates */
  checkUpdates(): Promise<Array<{
    slug: string;
    currentVersion: string;
    latestVersion: string;
  }>>;

  /** Enable/disable a skill */
  setEnabled(slug: string, enabled: boolean): void;

  /** Sync with registry (refresh cache) */
  sync(): Promise<void>;
}

const DEFAULT_REGISTRY_URL = 'https://cloddhub.com/api/v1';
const DEFAULT_CACHE_TTL = 60 * 60 * 1000; // 1 hour

export function createSkillsRegistry(config: RegistryConfig): SkillsRegistry {
  const registryUrl = config.registryUrl || DEFAULT_REGISTRY_URL;
  const skillsDir = config.skillsDir || path.join(process.env.HOME || '', '.clodds', 'skills');
  const cacheTtl = config.cacheTtl || DEFAULT_CACHE_TTL;

  // Ensure skills directory exists
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  // Cache
  let skillsCache: RegistrySkill[] = [];
  let cacheTime = 0;

  // Installed skills tracking
  const installedSkillsFile = path.join(skillsDir, '.installed.json');
  let installedSkills: Map<string, InstalledSkill>;

  /** Load installed skills from file */
  function loadInstalled(): Map<string, InstalledSkill> {
    try {
      if (fs.existsSync(installedSkillsFile)) {
        const data = JSON.parse(fs.readFileSync(installedSkillsFile, 'utf-8'));
        return new Map(data.map((s: InstalledSkill) => [s.slug, {
          ...s,
          installedAt: new Date(s.installedAt),
          updatedAt: new Date(s.updatedAt),
        }]));
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load installed skills');
    }
    return new Map();
  }

  /** Save installed skills to file */
  function saveInstalled(): void {
    try {
      const data = Array.from(installedSkills.values());
      fs.writeFileSync(installedSkillsFile, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error({ error }, 'Failed to save installed skills');
    }
  }

  installedSkills = loadInstalled();

  /** Fetch from registry API */
  async function fetchRegistry<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${registryUrl}${endpoint}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Clodds/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Registry API error: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  /** Download and extract skill */
  async function downloadSkill(skill: RegistrySkill): Promise<string> {
    const skillDir = path.join(skillsDir, skill.slug);

    // Create directory
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true });
    }
    fs.mkdirSync(skillDir, { recursive: true });

    // Download
    const response = await fetch(skill.downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download skill: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Verify checksum if provided
    if (skill.checksum) {
      const crypto = await import('crypto');
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      if (hash !== skill.checksum) {
        throw new Error('Checksum mismatch');
      }
    }

    // Extract (assuming tar.gz)
    const tarPath = path.join(skillDir, 'skill.tar.gz');
    fs.writeFileSync(tarPath, buffer);

    try {
      execSync(`tar -xzf skill.tar.gz`, { cwd: skillDir });
      fs.unlinkSync(tarPath);
    } catch {
      // Try as zip
      try {
        execSync(`unzip -o skill.tar.gz`, { cwd: skillDir });
        fs.unlinkSync(tarPath);
      } catch {
        // Just keep the raw file
        fs.renameSync(tarPath, path.join(skillDir, 'SKILL.md'));
      }
    }

    return skillDir;
  }

  const registry: SkillsRegistry = {
    async search(query, options = {}) {
      const params = new URLSearchParams({ q: query });
      if (options.tags) {
        params.set('tags', options.tags.join(','));
      }
      if (options.limit) {
        params.set('limit', options.limit.toString());
      }

      try {
        const results = await fetchRegistry<{ skills: RegistrySkill[] }>(
          `/skills/search?${params}`
        );
        return results.skills;
      } catch (error) {
        logger.error({ error }, 'Registry search failed');
        return [];
      }
    },

    async getSkill(slug) {
      try {
        return await fetchRegistry<RegistrySkill>(`/skills/${slug}`);
      } catch {
        return null;
      }
    },

    async install(slug, options = {}) {
      logger.info({ slug }, 'Installing skill');

      // Check if already installed
      const existing = installedSkills.get(slug);
      if (existing && !options.force) {
        logger.info({ slug }, 'Skill already installed');
        return existing;
      }

      // Fetch skill info
      const skill = await this.getSkill(slug);
      if (!skill) {
        throw new Error(`Skill not found: ${slug}`);
      }

      // Check platform compatibility
      if (skill.platforms && skill.platforms.length > 0) {
        if (!skill.platforms.includes(process.platform)) {
          throw new Error(`Skill not compatible with ${process.platform}`);
        }
      }

      // Download and install
      const directory = await downloadSkill(skill);

      const installed: InstalledSkill = {
        slug,
        name: skill.name,
        version: skill.version,
        installedAt: new Date(),
        updatedAt: new Date(),
        directory,
        enabled: true,
      };

      installedSkills.set(slug, installed);
      saveInstalled();

      logger.info({ slug, version: skill.version }, 'Skill installed');
      return installed;
    },

    async update(slug) {
      const installed = installedSkills.get(slug);
      if (!installed) {
        return null;
      }

      const latest = await this.getSkill(slug);
      if (!latest) {
        logger.warn({ slug }, 'Skill not found in registry');
        return null;
      }

      if (latest.version === installed.version) {
        logger.info({ slug }, 'Skill already up to date');
        return installed;
      }

      // Reinstall
      return this.install(slug, { force: true });
    },

    async updateAll() {
      const results: Array<{ slug: string; updated: boolean; error?: string }> = [];

      for (const [slug] of installedSkills) {
        try {
          const updated = await this.update(slug);
          results.push({ slug, updated: !!updated });
        } catch (error) {
          results.push({
            slug,
            updated: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      return results;
    },

    async uninstall(slug) {
      const installed = installedSkills.get(slug);
      if (!installed) {
        return false;
      }

      // Remove directory
      if (fs.existsSync(installed.directory)) {
        fs.rmSync(installed.directory, { recursive: true });
      }

      installedSkills.delete(slug);
      saveInstalled();

      logger.info({ slug }, 'Skill uninstalled');
      return true;
    },

    listInstalled() {
      return Array.from(installedSkills.values());
    },

    async checkUpdates() {
      const updates: Array<{
        slug: string;
        currentVersion: string;
        latestVersion: string;
      }> = [];

      for (const [slug, installed] of installedSkills) {
        try {
          const latest = await this.getSkill(slug);
          if (latest && latest.version !== installed.version) {
            updates.push({
              slug,
              currentVersion: installed.version,
              latestVersion: latest.version,
            });
          }
        } catch {
          // Ignore errors
        }
      }

      return updates;
    },

    setEnabled(slug, enabled) {
      const installed = installedSkills.get(slug);
      if (installed) {
        installed.enabled = enabled;
        saveInstalled();
        logger.info({ slug, enabled }, 'Skill enabled status changed');
      }
    },

    async sync() {
      try {
        const response = await fetchRegistry<{ skills: RegistrySkill[] }>('/skills');
        skillsCache = response.skills;
        cacheTime = Date.now();
        logger.info({ count: skillsCache.length }, 'Registry synced');
      } catch (error) {
        logger.error({ error }, 'Registry sync failed');
      }
    },
  };

  // Auto-sync on creation
  if (config.autoUpdate) {
    registry.sync().catch((err) => {
      logger.warn({ err }, 'Failed to auto-sync skill registry');
    });
  }

  return registry;
}
