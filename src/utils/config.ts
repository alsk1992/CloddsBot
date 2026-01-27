/**
 * Configuration loading and management
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import JSON5 from 'json5';
import { config as dotenvConfig } from 'dotenv';
import type { Config } from '../types';

// Load .env file
dotenvConfig();

const CONFIG_DIR = join(homedir(), '.clodds');
const CONFIG_FILE = join(CONFIG_DIR, 'clodds.json');

const DEFAULT_CONFIG: Config = {
  gateway: {
    port: 18789,
    auth: {},
  },
  agents: {
    defaults: {
      workspace: join(homedir(), 'clodds'),
      model: { primary: 'anthropic/claude-sonnet-4' },
    },
  },
  channels: {
    telegram: {
      enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      dmPolicy: 'pairing',
      allowFrom: [],
    },
    webchat: {
      enabled: true, // WebChat enabled by default
    },
  },
  feeds: {
    polymarket: { enabled: true },
    kalshi: { enabled: true },
    manifold: { enabled: true },
    metaculus: { enabled: true },
    drift: { enabled: false }, // Solana - disabled by default
    news: { enabled: false },
  },
  trading: {
    enabled: false,
    dryRun: true,
    maxOrderSize: 100,
    maxDailyLoss: 200,
  },
  alerts: {
    priceChange: { threshold: 5, windowSecs: 600 },
    volumeSpike: { multiplier: 3 },
  },
};

/**
 * Substitute environment variables in config values
 * Supports ${VAR_NAME} syntax
 */
function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, varName) => {
      return process.env[varName] || '';
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

/**
 * Deep merge two objects
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = (target as Record<string, unknown>)[key];

    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }
  return result;
}

/**
 * Load configuration from file and environment
 */
export async function loadConfig(customPath?: string): Promise<Config> {
  let fileConfig: Partial<Config> = {};

  // Try to load config file
  const configPath = customPath || CONFIG_FILE;
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      fileConfig = JSON5.parse(content) as Partial<Config>;
    } catch (err) {
      console.error(`Failed to parse config file: ${configPath}`, err);
    }
  }

  // Merge with defaults
  const merged = deepMerge(DEFAULT_CONFIG, fileConfig);

  // Substitute environment variables
  const config = substituteEnvVars(merged) as Config;

  return config;
}

export { CONFIG_DIR, CONFIG_FILE };
