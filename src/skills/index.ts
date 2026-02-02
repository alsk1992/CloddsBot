/**
 * Skills Module - Clawdbot-style skills registry (ClawdHub style)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, createWriteStream } from 'fs';
import { join, basename } from 'path';
import { homedir, tmpdir } from 'os';
import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { createHash, randomBytes } from 'crypto';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

// =============================================================================
// TYPES
// =============================================================================

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  dependencies?: Record<string, string>;
  main?: string;
  commands?: Array<{ name: string; description: string }>;
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
}

export interface InstalledSkill {
  manifest: SkillManifest;
  path: string;
  enabled: boolean;
  config: Record<string, unknown>;
  installedAt: Date;
  // Convenience accessors for CLI compatibility
  name: string;
  version: string;
  directory: string;
}

/** Skill as loaded by the manager (runtime form) */
export interface Skill {
  name: string;
  description?: string;
  version?: string;
  source: 'local' | 'registry' | 'builtin';
  directory?: string;
  eligible: boolean;
  ineligibleReason?: string;
}

/** Skill from the remote registry */
export interface RegistrySkill {
  slug: string;
  name: string;
  description: string;
  version: string;
  author: string;
  homepage?: string;
  repository?: string;
  tags?: string[];
  platforms?: string[];
  requiredEnv?: string[];
  rating?: number;
  installs?: number;
  updatedAt: string;
  /** Download URL for the skill package (tarball or zip) */
  downloadUrl?: string;
  /** Checksum for verification (sha256) */
  checksum?: string;
  /** Package type: tarball, zip, or git */
  packageType?: 'tarball' | 'zip' | 'git';
}

export class SkillRegistry extends EventEmitter {
  private skillsDir: string;
  private skills: Map<string, InstalledSkill> = new Map();
  private registryUrl: string;

  constructor(skillsDir?: string, registryUrl?: string) {
    super();
    this.skillsDir = skillsDir || join(homedir(), '.clodds', 'skills');
    this.registryUrl = registryUrl || 'https://registry.clodds.dev';
    this.ensureDir();
    this.loadSkills();
  }

  private ensureDir(): void {
    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true });
    }
  }

  private loadSkills(): void {
    const metaPath = join(this.skillsDir, 'skills.json');
    if (existsSync(metaPath)) {
      try {
        const data = JSON.parse(readFileSync(metaPath, 'utf-8'));
        for (const [name, skill] of Object.entries(data.skills || {})) {
          const s = skill as InstalledSkill;
          s.installedAt = new Date(s.installedAt);
          // Ensure convenience fields are set
          s.name = s.name || s.manifest?.name || name;
          s.version = s.version || s.manifest?.version || '0.0.0';
          s.directory = s.directory || s.path;
          this.skills.set(name, s);
        }
      } catch (error) {
        logger.error({ error }, 'Failed to load skills');
      }
    }
  }

  private saveSkills(): void {
    const metaPath = join(this.skillsDir, 'skills.json');
    writeFileSync(metaPath, JSON.stringify({
      version: 1,
      skills: Object.fromEntries(this.skills),
      updatedAt: new Date().toISOString(),
    }, null, 2));
  }

  async installLocal(sourcePath: string): Promise<InstalledSkill> {
    const manifestPath = join(sourcePath, 'skill.json');
    if (!existsSync(manifestPath)) {
      throw new Error('Invalid skill: missing skill.json');
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as SkillManifest;
    const skillPath = join(this.skillsDir, manifest.name);
    await execAsync(`cp -r "${sourcePath}" "${skillPath}"`);
    const installed: InstalledSkill = {
      manifest,
      path: skillPath,
      enabled: true,
      config: {},
      installedAt: new Date(),
      name: manifest.name,
      version: manifest.version,
      directory: skillPath,
    };
    this.skills.set(manifest.name, installed);
    this.saveSkills();
    this.emit('install', installed);
    return installed;
  }

  async uninstall(name: string): Promise<void> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill '${name}' not found`);
    if (existsSync(skill.path)) rmSync(skill.path, { recursive: true, force: true });
    this.skills.delete(name);
    this.saveSkills();
    this.emit('uninstall', { name });
  }

  enable(name: string): void {
    const skill = this.skills.get(name);
    if (skill) { skill.enabled = true; this.saveSkills(); }
  }

  disable(name: string): void {
    const skill = this.skills.get(name);
    if (skill) { skill.enabled = false; this.saveSkills(); }
  }

  get(name: string): InstalledSkill | undefined {
    return this.skills.get(name);
  }

  list(): InstalledSkill[] {
    return Array.from(this.skills.values());
  }

  listEnabled(): InstalledSkill[] {
    return this.list().filter(s => s.enabled);
  }
}

export function createSkillRegistry(skillsDir?: string): SkillRegistry {
  return new SkillRegistry(skillsDir);
}

// =============================================================================
// SKILLS MANAGER (for CLI compatibility)
// =============================================================================

export interface SkillsManagerConfig {
  skillsDir?: string;
  registryUrl?: string;
}

export class SkillsManager {
  private skillsDir: string;
  private loadedSkills: Skill[] = [];

  constructor(config: SkillsManagerConfig = {}) {
    this.skillsDir = config.skillsDir || join(homedir(), '.clodds', 'skills');
  }

  /** Load skills from disk */
  load(): void {
    this.loadedSkills = [];

    if (!existsSync(this.skillsDir)) {
      return;
    }

    const entries = readdirSync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = join(this.skillsDir, entry.name);
        const manifestPath = join(skillPath, 'skill.json');

        if (existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as SkillManifest;
            this.loadedSkills.push({
              name: manifest.name,
              description: manifest.description,
              version: manifest.version,
              source: 'local',
              directory: skillPath,
              eligible: true,
            });
          } catch {
            this.loadedSkills.push({
              name: entry.name,
              source: 'local',
              directory: skillPath,
              eligible: false,
              ineligibleReason: 'Invalid skill.json',
            });
          }
        }
      }
    }
  }

  /** Get all loaded skills */
  getAll(): Skill[] {
    return this.loadedSkills;
  }

  /** Get eligible skills */
  getEligible(): Skill[] {
    return this.loadedSkills.filter(s => s.eligible);
  }

  /** Get skill by name */
  get(name: string): Skill | undefined {
    return this.loadedSkills.find(s => s.name === name);
  }
}

// =============================================================================
// SKILLS REGISTRY CLIENT (for ClawdHub-style registry)
// =============================================================================

export interface SkillsRegistryConfig {
  registryUrl?: string;
  skillsDir?: string;
}

export class SkillsRegistryClient {
  private registryUrl: string;
  private skillsDir: string;

  constructor(config: SkillsRegistryConfig = {}) {
    this.registryUrl = config.registryUrl || 'https://registry.clodds.dev';
    this.skillsDir = config.skillsDir || join(homedir(), '.clodds', 'skills');
  }

  /** Search for skills in the registry */
  async search(query: string, options?: { tags?: string[]; limit?: number }): Promise<RegistrySkill[]> {
    try {
      const params = new URLSearchParams({ q: query });
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.tags) params.set('tags', options.tags.join(','));

      const response = await fetch(`${this.registryUrl}/api/skills/search?${params}`);
      if (!response.ok) return [];

      const data = await response.json() as { skills: RegistrySkill[] };
      return data.skills || [];
    } catch {
      return [];
    }
  }

  /** Download a file to a local path */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const fileStream = createWriteStream(destPath);
    // Convert web ReadableStream to Node.js stream
    const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
    await pipeline(nodeStream, fileStream);
  }

  /** Verify file checksum */
  private verifyChecksum(filePath: string, expectedChecksum: string): boolean {
    const fileBuffer = readFileSync(filePath);
    const hash = createHash('sha256').update(fileBuffer).digest('hex');
    return hash === expectedChecksum;
  }

  /** Extract a tarball */
  private async extractTarball(tarPath: string, destDir: string): Promise<void> {
    mkdirSync(destDir, { recursive: true });
    await execAsync(`tar -xzf "${tarPath}" -C "${destDir}" --strip-components=1`);
  }

  /** Extract a zip file */
  private async extractZip(zipPath: string, destDir: string): Promise<void> {
    mkdirSync(destDir, { recursive: true });
    await execAsync(`unzip -o "${zipPath}" -d "${destDir}"`);

    // Handle nested directory (common in GitHub zips)
    const entries = readdirSync(destDir, { withFileTypes: true });
    if (entries.length === 1 && entries[0].isDirectory()) {
      const nestedDir = join(destDir, entries[0].name);
      const nestedEntries = readdirSync(nestedDir);
      for (const entry of nestedEntries) {
        await execAsync(`mv "${join(nestedDir, entry)}" "${destDir}/"`);
      }
      rmSync(nestedDir, { recursive: true });
    }
  }

  /** Clone a git repository */
  private async cloneGitRepo(repoUrl: string, destDir: string, version?: string): Promise<void> {
    mkdirSync(destDir, { recursive: true });
    const branch = version ? `--branch ${version}` : '';
    await execAsync(`git clone --depth 1 ${branch} "${repoUrl}" "${destDir}"`);
    // Remove .git directory to save space
    const gitDir = join(destDir, '.git');
    if (existsSync(gitDir)) {
      rmSync(gitDir, { recursive: true });
    }
  }

  /** Derive download URL from repository if not provided */
  private deriveDownloadUrl(skill: RegistrySkill): { url: string; type: 'tarball' | 'zip' | 'git' } {
    // If downloadUrl is provided, use it
    if (skill.downloadUrl) {
      const type = skill.packageType || (skill.downloadUrl.endsWith('.zip') ? 'zip' : 'tarball');
      return { url: skill.downloadUrl, type };
    }

    // Try to derive from repository
    if (skill.repository) {
      // GitHub
      if (skill.repository.includes('github.com')) {
        const match = skill.repository.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
        if (match) {
          const [, owner, repo] = match;
          const tag = skill.version.startsWith('v') ? skill.version : `v${skill.version}`;
          return {
            url: `https://github.com/${owner}/${repo}/archive/refs/tags/${tag}.tar.gz`,
            type: 'tarball',
          };
        }
      }

      // GitLab
      if (skill.repository.includes('gitlab.com')) {
        const match = skill.repository.match(/gitlab\.com[\/:]([^\/]+)\/([^\/\.]+)/);
        if (match) {
          const [, owner, repo] = match;
          const tag = skill.version.startsWith('v') ? skill.version : `v${skill.version}`;
          return {
            url: `https://gitlab.com/${owner}/${repo}/-/archive/${tag}/${repo}-${tag}.tar.gz`,
            type: 'tarball',
          };
        }
      }

      // Generic git repo
      return { url: skill.repository, type: 'git' };
    }

    // Fallback to registry download endpoint
    return {
      url: `${this.registryUrl}/api/skills/${skill.slug}/download`,
      type: 'tarball',
    };
  }

  /** Run post-install hooks */
  private async runPostInstall(skillDir: string): Promise<void> {
    const manifestPath = join(skillDir, 'skill.json');
    if (!existsSync(manifestPath)) return;

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as SkillManifest & { postInstall?: string };

      // Run postInstall script if defined
      if (manifest.postInstall) {
        logger.info({ skillDir }, 'Running post-install script');
        await execAsync(manifest.postInstall, { cwd: skillDir });
      }

      // Install npm dependencies if package.json exists
      const packageJsonPath = join(skillDir, 'package.json');
      if (existsSync(packageJsonPath)) {
        logger.info({ skillDir }, 'Installing npm dependencies');
        await execAsync('npm install --production', { cwd: skillDir });
      }

      // Install pip dependencies if requirements.txt exists
      const requirementsPath = join(skillDir, 'requirements.txt');
      if (existsSync(requirementsPath)) {
        logger.info({ skillDir }, 'Installing pip dependencies');
        await execAsync('pip install -r requirements.txt', { cwd: skillDir });
      }
    } catch (error) {
      logger.warn({ error, skillDir }, 'Post-install script failed');
    }
  }

  /** Install a skill from the registry */
  async install(slug: string, options?: { force?: boolean }): Promise<InstalledSkill> {
    const skill = await this.getSkill(slug);
    if (!skill) {
      throw new Error(`Skill '${slug}' not found in registry`);
    }

    const skillDir = join(this.skillsDir, slug);

    // Check if already installed
    if (existsSync(skillDir)) {
      if (!options?.force) {
        throw new Error(`Skill '${slug}' is already installed. Use force option to reinstall.`);
      }
      // Remove existing installation
      rmSync(skillDir, { recursive: true, force: true });
    }

    // Ensure skills directory exists
    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true });
    }

    // Get download info
    const { url, type } = this.deriveDownloadUrl(skill);
    const tempId = randomBytes(8).toString('hex');
    const tempDir = join(tmpdir(), `clodds-skill-${tempId}`);

    try {
      logger.info({ slug, url, type }, 'Downloading skill');

      if (type === 'git') {
        // Clone git repository directly
        await this.cloneGitRepo(url, skillDir, skill.version);
      } else {
        // Download archive
        const ext = type === 'zip' ? '.zip' : '.tar.gz';
        const archivePath = join(tempDir, `${slug}${ext}`);
        mkdirSync(tempDir, { recursive: true });

        await this.downloadFile(url, archivePath);

        // Verify checksum if provided
        if (skill.checksum) {
          if (!this.verifyChecksum(archivePath, skill.checksum)) {
            throw new Error('Checksum verification failed');
          }
          logger.debug({ slug }, 'Checksum verified');
        }

        // Extract archive
        if (type === 'zip') {
          await this.extractZip(archivePath, skillDir);
        } else {
          await this.extractTarball(archivePath, skillDir);
        }
      }

      // Run post-install hooks
      await this.runPostInstall(skillDir);

      // Read the installed manifest
      const manifestPath = join(skillDir, 'skill.json');
      let manifest: SkillManifest;

      if (existsSync(manifestPath)) {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as SkillManifest;
      } else {
        // Create manifest from registry info if not present
        manifest = {
          name: skill.name,
          version: skill.version,
          description: skill.description,
          author: skill.author,
        };
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      }

      const installed: InstalledSkill = {
        manifest,
        path: skillDir,
        enabled: true,
        config: {},
        installedAt: new Date(),
        name: manifest.name,
        version: manifest.version,
        directory: skillDir,
      };

      // Save to skills index
      const indexPath = join(this.skillsDir, 'skills.json');
      let index: { skills: Record<string, InstalledSkill> } = { skills: {} };
      if (existsSync(indexPath)) {
        try {
          index = JSON.parse(readFileSync(indexPath, 'utf-8'));
        } catch {}
      }
      index.skills[slug] = installed;
      writeFileSync(indexPath, JSON.stringify(index, null, 2));

      logger.info({ slug, version: manifest.version }, 'Skill installed successfully');
      return installed;

    } finally {
      // Cleanup temp directory
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }

  /** Update a skill */
  async update(slug: string): Promise<InstalledSkill | null> {
    const skillDir = join(this.skillsDir, slug);
    if (!existsSync(skillDir)) {
      return null;
    }

    // Check current version
    const manifestPath = join(skillDir, 'skill.json');
    if (!existsSync(manifestPath)) {
      return null;
    }

    const currentManifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as SkillManifest;
    const remote = await this.getSkill(slug);

    if (!remote) {
      logger.warn({ slug }, 'Skill not found in registry');
      return null;
    }

    // Compare versions
    if (remote.version === currentManifest.version) {
      logger.info({ slug, version: remote.version }, 'Skill is already up to date');
      return null;
    }

    logger.info({ slug, from: currentManifest.version, to: remote.version }, 'Updating skill');
    return this.install(slug, { force: true });
  }

  /** Update all skills */
  async updateAll(): Promise<Array<{ slug: string; updated: boolean; error?: string }>> {
    const results: Array<{ slug: string; updated: boolean; error?: string }> = [];

    if (!existsSync(this.skillsDir)) return results;

    const entries = readdirSync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          await this.update(entry.name);
          results.push({ slug: entry.name, updated: true });
        } catch (error) {
          results.push({ slug: entry.name, updated: false, error: String(error) });
        }
      }
    }

    return results;
  }

  /** Uninstall a skill */
  async uninstall(slug: string): Promise<boolean> {
    const skillDir = join(this.skillsDir, slug);
    if (!existsSync(skillDir)) return false;

    rmSync(skillDir, { recursive: true, force: true });
    return true;
  }

  /** Get skill details from registry */
  async getSkill(slug: string): Promise<RegistrySkill | null> {
    try {
      const response = await fetch(`${this.registryUrl}/api/skills/${slug}`);
      if (!response.ok) return null;

      return await response.json() as RegistrySkill;
    } catch {
      return null;
    }
  }

  /** Check for available updates */
  async checkUpdates(): Promise<Array<{ slug: string; currentVersion: string; latestVersion: string }>> {
    const updates: Array<{ slug: string; currentVersion: string; latestVersion: string }> = [];

    if (!existsSync(this.skillsDir)) return updates;

    const entries = readdirSync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const manifestPath = join(this.skillsDir, entry.name, 'skill.json');
        if (existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as SkillManifest;
            const remote = await this.getSkill(entry.name);
            if (remote && remote.version !== manifest.version) {
              updates.push({
                slug: entry.name,
                currentVersion: manifest.version,
                latestVersion: remote.version,
              });
            }
          } catch {}
        }
      }
    }

    return updates;
  }
}

// =============================================================================
// FACTORY FUNCTIONS (for CLI compatibility)
// =============================================================================

export function createSkillsManager(config: SkillsManagerConfig): SkillsManager {
  return new SkillsManager(config);
}

export function createSkillsRegistry(config: SkillsRegistryConfig): SkillsRegistryClient {
  return new SkillsRegistryClient(config);
}

export const skills = new SkillRegistry();
