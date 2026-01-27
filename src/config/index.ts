/**
 * Configuration System - Clawdbot-style config management
 *
 * Features:
 * - JSON5 config file loading
 * - Environment variable substitution
 * - Config validation with Zod
 * - Default values
 * - Config paths resolution
 * - Backup rotation
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';

// =============================================================================
// PATHS
// =============================================================================

/** Resolve ~ to home directory */
function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('~')) {
    return resolve(trimmed.replace(/^~(?=$|[\\/])/, homedir()));
  }
  return resolve(trimmed);
}

/** State directory for mutable data */
export function resolveStateDir(env = process.env): string {
  const override = env.CLODDS_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  return join(homedir(), '.clodds');
}

/** Config file path */
export function resolveConfigPath(env = process.env): string {
  const override = env.CLODDS_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  return join(resolveStateDir(env), 'clodds.json');
}

/** Credentials directory */
export function resolveCredentialsDir(env = process.env): string {
  return join(resolveStateDir(env), 'credentials');
}

/** Logs directory */
export function resolveLogsDir(env = process.env): string {
  return join(resolveStateDir(env), 'logs');
}

/** Workspace directory */
export function resolveWorkspaceDir(env = process.env): string {
  const override = env.CLODDS_WORKSPACE?.trim();
  if (override) return resolveUserPath(override);
  return join(homedir(), 'clodds');
}

export const STATE_DIR = resolveStateDir();
export const CONFIG_PATH = resolveConfigPath();
export const CREDENTIALS_DIR = resolveCredentialsDir();
export const LOGS_DIR = resolveLogsDir();
export const WORKSPACE_DIR = resolveWorkspaceDir();
export const DEFAULT_GATEWAY_PORT = 18789;

// =============================================================================
// TYPES
// =============================================================================

export interface AgentConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  workspace?: string;
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
  sandbox?: {
    mode?: 'off' | 'non-main' | 'all';
    allowedTools?: string[];
    deniedTools?: string[];
  };
}

export interface GatewayConfig {
  port?: number;
  bind?: 'loopback' | 'all';
  auth?: {
    mode?: 'off' | 'token' | 'password';
    token?: string;
    password?: string;
  };
  tailscale?: {
    mode?: 'off' | 'serve' | 'funnel';
    resetOnExit?: boolean;
  };
}

export interface ChannelConfig {
  enabled?: boolean;
  allowFrom?: string[];
  groups?: Record<string, { requireMention?: boolean }>;
}

export interface TelegramConfig extends ChannelConfig {
  botToken?: string;
  webhookUrl?: string;
}

export interface DiscordConfig extends ChannelConfig {
  token?: string;
  guilds?: string[];
}

export interface SlackConfig extends ChannelConfig {
  botToken?: string;
  appToken?: string;
}

export interface WhatsAppConfig extends ChannelConfig {
  // Uses Baileys, stores session in credentials dir
}

export interface ChannelsConfig {
  telegram?: TelegramConfig;
  discord?: DiscordConfig;
  slack?: SlackConfig;
  whatsapp?: WhatsAppConfig;
  signal?: ChannelConfig & { phone?: string };
  imessage?: ChannelConfig;
}

export interface BrowserConfig {
  enabled?: boolean;
  headless?: boolean;
  executablePath?: string;
  userDataDir?: string;
}

export interface TTSConfig {
  enabled?: boolean;
  provider?: 'elevenlabs' | 'system';
  voice?: string;
  apiKey?: string;
}

export interface CronConfig {
  enabled?: boolean;
  jobs?: Array<{
    id: string;
    schedule: string;
    action: string;
    enabled?: boolean;
  }>;
}

export interface PluginsConfig {
  enabled?: boolean;
  autoEnable?: string[];
  disabled?: string[];
}

export interface LoggingConfig {
  level?: 'debug' | 'info' | 'warn' | 'error';
  file?: boolean;
  json?: boolean;
}

export interface MetaConfig {
  lastTouchedVersion?: string;
  lastTouchedAt?: string;
}

export interface CloddsConfig {
  agent?: AgentConfig;
  gateway?: GatewayConfig;
  channels?: ChannelsConfig;
  browser?: BrowserConfig;
  tts?: TTSConfig;
  cron?: CronConfig;
  plugins?: PluginsConfig;
  logging?: LoggingConfig;
  meta?: MetaConfig;
}

// =============================================================================
// DEFAULTS
// =============================================================================

export const DEFAULT_CONFIG: CloddsConfig = {
  agent: {
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    temperature: 0.7,
    thinkingLevel: 'medium',
    sandbox: { mode: 'off' },
  },
  gateway: {
    port: DEFAULT_GATEWAY_PORT,
    bind: 'loopback',
    auth: { mode: 'off' },
    tailscale: { mode: 'off' },
  },
  channels: {},
  browser: {
    enabled: true,
    headless: true,
  },
  tts: {
    enabled: false,
    provider: 'elevenlabs',
  },
  cron: {
    enabled: true,
    jobs: [],
  },
  plugins: {
    enabled: true,
    autoEnable: [],
    disabled: [],
  },
  logging: {
    level: 'info',
    file: true,
    json: false,
  },
};

// =============================================================================
// ENV SUBSTITUTION
// =============================================================================

/** Environment variables that can be used in config */
const ENV_MAPPINGS: Record<string, (cfg: CloddsConfig) => void> = {
  ANTHROPIC_API_KEY: () => {}, // Used directly by agent
  OPENAI_API_KEY: () => {},
  ELEVENLABS_API_KEY: (cfg) => {
    if (cfg.tts) cfg.tts.apiKey = process.env.ELEVENLABS_API_KEY;
  },
  TELEGRAM_BOT_TOKEN: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.telegram) cfg.channels.telegram = {};
    cfg.channels.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
  },
  DISCORD_BOT_TOKEN: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.discord) cfg.channels.discord = {};
    cfg.channels.discord.token = process.env.DISCORD_BOT_TOKEN;
  },
  SLACK_BOT_TOKEN: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.slack) cfg.channels.slack = {};
    cfg.channels.slack.botToken = process.env.SLACK_BOT_TOKEN;
  },
  SLACK_APP_TOKEN: (cfg) => {
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels.slack) cfg.channels.slack = {};
    cfg.channels.slack.appToken = process.env.SLACK_APP_TOKEN;
  },
  CLODDS_GATEWAY_TOKEN: (cfg) => {
    if (!cfg.gateway) cfg.gateway = {};
    if (!cfg.gateway.auth) cfg.gateway.auth = {};
    cfg.gateway.auth.token = process.env.CLODDS_GATEWAY_TOKEN;
    cfg.gateway.auth.mode = 'token';
  },
  CLODDS_GATEWAY_PASSWORD: (cfg) => {
    if (!cfg.gateway) cfg.gateway = {};
    if (!cfg.gateway.auth) cfg.gateway.auth = {};
    cfg.gateway.auth.password = process.env.CLODDS_GATEWAY_PASSWORD;
    cfg.gateway.auth.mode = 'password';
  },
};

/** Apply environment variable overrides */
function applyEnvOverrides(cfg: CloddsConfig): CloddsConfig {
  for (const [envKey, applier] of Object.entries(ENV_MAPPINGS)) {
    if (process.env[envKey]) {
      applier(cfg);
    }
  }
  return cfg;
}

/** Substitute ${VAR} patterns in config values */
function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, varName) => {
      const value = process.env[varName];
      if (value === undefined) {
        logger.warn({ varName }, 'Missing environment variable in config');
        return '';
      }
      return value;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVars);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVars(value);
    }
    return result;
  }
  return obj;
}

// =============================================================================
// LOADING
// =============================================================================

/** Parse JSON5 (with comments, trailing commas) */
function parseJson5(text: string): unknown {
  // Simple JSON5 parser - handle comments and trailing commas
  let cleaned = text
    .replace(/\/\*[\s\S]*?\*\//g, '') // Block comments
    .replace(/\/\/.*$/gm, '') // Line comments
    .replace(/,(\s*[}\]])/g, '$1'); // Trailing commas

  // Handle unquoted keys
  cleaned = cleaned.replace(/(\s*)(\w+)(\s*):/g, '$1"$2"$3:');

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to strict JSON
    return JSON.parse(text);
  }
}

/** Deep merge configs */
function deepMerge(target: CloddsConfig, source: CloddsConfig): CloddsConfig {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof CloddsConfig>) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
      if (targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)) {
        result[key] = { ...targetVal, ...sourceVal } as typeof result[typeof key];
      } else {
        result[key] = sourceVal as typeof result[typeof key];
      }
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as typeof result[typeof key];
    }
  }

  return result;
}

/** Load config from file */
export function loadConfig(configPath = CONFIG_PATH): CloddsConfig {
  let userConfig: CloddsConfig = {};

  // Ensure state dir exists
  const stateDir = resolveStateDir();
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  // Load config file if exists
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = parseJson5(raw);
      userConfig = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        ? parsed as CloddsConfig
        : {};
      logger.debug({ configPath }, 'Config loaded');
    } catch (error) {
      logger.error({ configPath, error }, 'Failed to load config');
    }
  }

  // Substitute env vars in config values
  userConfig = substituteEnvVars(userConfig) as CloddsConfig;

  // Merge with defaults
  let config = deepMerge(DEFAULT_CONFIG, userConfig);

  // Apply environment overrides
  config = applyEnvOverrides(config);

  return config;
}

/** Load config and return raw snapshot */
export function loadConfigSnapshot(configPath = CONFIG_PATH): { config: CloddsConfig; raw: string | null; hash: string } {
  let raw: string | null = null;

  if (existsSync(configPath)) {
    raw = readFileSync(configPath, 'utf-8');
  }

  const config = loadConfig(configPath);
  const hash = createHash('sha256').update(raw || '').digest('hex');

  return { config, raw, hash };
}

// =============================================================================
// SAVING
// =============================================================================

const CONFIG_BACKUP_COUNT = 5;

/** Rotate config backups */
function rotateBackups(configPath: string): void {
  const backupBase = `${configPath}.bak`;

  // Delete oldest
  try {
    unlinkSync(`${backupBase}.${CONFIG_BACKUP_COUNT - 1}`);
  } catch {}

  // Shift backups
  for (let i = CONFIG_BACKUP_COUNT - 2; i >= 1; i--) {
    try {
      renameSync(`${backupBase}.${i}`, `${backupBase}.${i + 1}`);
    } catch {}
  }

  // Move current backup
  try {
    renameSync(backupBase, `${backupBase}.1`);
  } catch {}
}

/** Save config to file */
export function saveConfig(config: CloddsConfig, configPath = CONFIG_PATH): void {
  // Ensure directory exists
  const dir = resolve(configPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Backup existing config
  if (existsSync(configPath)) {
    try {
      const existing = readFileSync(configPath, 'utf-8');
      writeFileSync(`${configPath}.bak`, existing);
      rotateBackups(configPath);
    } catch {}
  }

  // Stamp version
  const stamped: CloddsConfig = {
    ...config,
    meta: {
      ...config.meta,
      lastTouchedVersion: '0.1.0', // TODO: Get from package.json
      lastTouchedAt: new Date().toISOString(),
    },
  };

  // Write config
  const content = JSON.stringify(stamped, null, 2);
  writeFileSync(configPath, content, 'utf-8');
  logger.info({ configPath }, 'Config saved');
}

// =============================================================================
// VALIDATION
// =============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/** Validate config structure */
export function validateConfig(config: CloddsConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate gateway
  if (config.gateway?.port !== undefined) {
    if (typeof config.gateway.port !== 'number' || config.gateway.port < 1 || config.gateway.port > 65535) {
      errors.push({ path: 'gateway.port', message: 'Port must be a number between 1 and 65535' });
    }
  }

  if (config.gateway?.bind && !['loopback', 'all'].includes(config.gateway.bind)) {
    errors.push({ path: 'gateway.bind', message: 'Bind must be "loopback" or "all"' });
  }

  // Validate agent
  if (config.agent?.thinkingLevel && !['off', 'minimal', 'low', 'medium', 'high'].includes(config.agent.thinkingLevel)) {
    errors.push({ path: 'agent.thinkingLevel', message: 'Invalid thinking level' });
  }

  // Validate logging
  if (config.logging?.level && !['debug', 'info', 'warn', 'error'].includes(config.logging.level)) {
    errors.push({ path: 'logging.level', message: 'Invalid log level' });
  }

  return errors;
}

// =============================================================================
// CONFIG SERVICE
// =============================================================================

export interface ConfigService {
  /** Get current config */
  get(): CloddsConfig;
  /** Get a specific config value */
  getValue<T>(path: string): T | undefined;
  /** Set a config value */
  setValue(path: string, value: unknown): void;
  /** Reload config from file */
  reload(): CloddsConfig;
  /** Save current config to file */
  save(): void;
  /** Get config hash */
  getHash(): string;
  /** Watch for config changes */
  watch(callback: (config: CloddsConfig) => void): () => void;
}

export function createConfigService(configPath = CONFIG_PATH): ConfigService {
  let { config, hash } = loadConfigSnapshot(configPath);
  const watchers: Array<(config: CloddsConfig) => void> = [];

  return {
    get() {
      return config;
    },

    getValue<T>(path: string): T | undefined {
      const parts = path.split('.');
      let current: unknown = config;

      for (const part of parts) {
        if (current && typeof current === 'object') {
          current = (current as Record<string, unknown>)[part];
        } else {
          return undefined;
        }
      }

      return current as T;
    },

    setValue(path: string, value: unknown) {
      const parts = path.split('.');
      let current: unknown = config;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const obj = current as Record<string, unknown>;
        if (!obj[part] || typeof obj[part] !== 'object') {
          obj[part] = {};
        }
        current = obj[part];
      }

      (current as Record<string, unknown>)[parts[parts.length - 1]] = value;
    },

    reload() {
      const snapshot = loadConfigSnapshot(configPath);
      config = snapshot.config;
      hash = snapshot.hash;

      for (const watcher of watchers) {
        watcher(config);
      }

      return config;
    },

    save() {
      saveConfig(config, configPath);
      hash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    },

    getHash() {
      return hash;
    },

    watch(callback) {
      watchers.push(callback);
      return () => {
        const idx = watchers.indexOf(callback);
        if (idx >= 0) watchers.splice(idx, 1);
      };
    },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export { deepMerge, parseJson5, substituteEnvVars };
