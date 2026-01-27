/**
 * Plugin SDK - Clawdbot-style plugin system
 *
 * Features:
 * - Register custom plugins
 * - Plugin lifecycle (install, enable, disable, uninstall)
 * - Plugin hooks into core services
 * - Plugin settings/config persistence
 * - Hot reload support
 */

import { EventEmitter } from 'eventemitter3';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';
import { logger } from '../utils/logger';
import type { HookFn, HookEvent, HooksService } from '../hooks';
import type { IncomingMessage, OutgoingMessage } from '../types';

// =============================================================================
// CONSTANTS
// =============================================================================

const PLUGINS_DIR = join(homedir(), '.clodds', 'plugins');
const PLUGIN_SETTINGS_FILE = join(homedir(), '.clodds', 'plugin-settings.json');

// Ensure directories exist
if (!existsSync(PLUGINS_DIR)) {
  mkdirSync(PLUGINS_DIR, { recursive: true });
}

// =============================================================================
// TYPES
// =============================================================================

/** Plugin metadata */
export interface PluginMeta {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  repository?: string;
  dependencies?: string[];
}

/** Plugin state */
export type PluginState = 'installed' | 'enabled' | 'disabled' | 'error';

/** Command handler */
export type CommandHandler = (
  args: string[],
  ctx: CommandContext
) => Promise<string | void> | string | void;

/** Command context */
export interface CommandContext {
  userId: string;
  channel: string;
  platform: string;
  rawMessage: string;
  reply: (text: string) => Promise<void>;
}

/** Tool definition for AI */
export interface PluginTool {
  name: string;
  description: string;
  parameters: Record<string, {
    type: string;
    description: string;
    required?: boolean;
    enum?: string[];
  }>;
  handler: (params: Record<string, unknown>, ctx: CommandContext) => Promise<unknown>;
}

/** Plugin context - passed during initialization */
export interface PluginContext {
  /** Plugin metadata */
  meta: PluginMeta;

  /** Register a message hook */
  onMessage(fn: (msg: IncomingMessage) => Promise<void> | void): void;

  /** Register a response hook */
  onResponse(fn: (msg: OutgoingMessage) => Promise<void> | void): void;

  /** Register a command (e.g., /mycommand) */
  registerCommand(name: string, handler: CommandHandler, description?: string): void;

  /** Register a tool for AI to use */
  registerTool(tool: PluginTool): void;

  /** Get plugin settings */
  getSettings<T = Record<string, unknown>>(): T;

  /** Update plugin settings */
  setSettings<T = Record<string, unknown>>(settings: Partial<T>): void;

  /** Get another plugin's API (if exposed) */
  getPlugin<T = unknown>(pluginId: string): T | null;

  /** Expose an API for other plugins */
  exposeApi<T>(api: T): void;

  /** Log with plugin context */
  log: {
    debug: (msg: string, data?: Record<string, unknown>) => void;
    info: (msg: string, data?: Record<string, unknown>) => void;
    warn: (msg: string, data?: Record<string, unknown>) => void;
    error: (msg: string, data?: Record<string, unknown>) => void;
  };

  /** Storage helpers */
  storage: {
    get<T>(key: string): T | null;
    set<T>(key: string, value: T): void;
    delete(key: string): void;
    list(): string[];
  };
}

/** Plugin definition */
export interface Plugin {
  meta: PluginMeta;
  /** Called when plugin is enabled */
  onEnable?(ctx: PluginContext): Promise<void> | void;
  /** Called when plugin is disabled */
  onDisable?(ctx: PluginContext): Promise<void> | void;
  /** Called periodically (every minute) */
  onTick?(ctx: PluginContext): Promise<void> | void;
}

/** Registered plugin info */
export interface RegisteredPlugin {
  plugin: Plugin;
  state: PluginState;
  settings: Record<string, unknown>;
  storage: Record<string, unknown>;
  error?: string;
  api?: unknown;
  commands: Map<string, { handler: CommandHandler; description?: string }>;
  tools: Map<string, PluginTool>;
  hooks: {
    message: Array<(msg: IncomingMessage) => Promise<void> | void>;
    response: Array<(msg: OutgoingMessage) => Promise<void> | void>;
  };
}

/** Plugin service events */
export interface PluginServiceEvents {
  'plugin:enabled': (pluginId: string) => void;
  'plugin:disabled': (pluginId: string) => void;
  'plugin:error': (pluginId: string, error: Error) => void;
}

/** Plugin service */
export interface PluginService {
  /** Register a plugin */
  register(plugin: Plugin): void;
  /** Unregister a plugin */
  unregister(pluginId: string): void;
  /** Enable a plugin */
  enable(pluginId: string): Promise<void>;
  /** Disable a plugin */
  disable(pluginId: string): Promise<void>;
  /** Get plugin info */
  get(pluginId: string): RegisteredPlugin | null;
  /** List all plugins */
  list(): RegisteredPlugin[];
  /** Execute a plugin command */
  executeCommand(name: string, args: string[], ctx: CommandContext): Promise<string | void>;
  /** List all commands */
  listCommands(): Array<{ name: string; pluginId: string; description?: string }>;
  /** Get tools for AI */
  getTools(): PluginTool[];
  /** Process incoming message through plugins */
  processMessage(msg: IncomingMessage): Promise<void>;
  /** Process outgoing response through plugins */
  processResponse(msg: OutgoingMessage): Promise<void>;
  /** Run tick on all enabled plugins */
  tick(): Promise<void>;
  /** Load plugins from directory */
  loadFromDirectory(dir?: string): Promise<number>;
  /** Subscribe to events */
  on<K extends keyof PluginServiceEvents>(event: K, fn: PluginServiceEvents[K]): void;
  off<K extends keyof PluginServiceEvents>(event: K, fn: PluginServiceEvents[K]): void;
}

// =============================================================================
// SETTINGS PERSISTENCE
// =============================================================================

function loadAllSettings(): Record<string, Record<string, unknown>> {
  try {
    if (existsSync(PLUGIN_SETTINGS_FILE)) {
      return JSON.parse(readFileSync(PLUGIN_SETTINGS_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveAllSettings(settings: Record<string, Record<string, unknown>>): void {
  writeFileSync(PLUGIN_SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// =============================================================================
// SERVICE IMPLEMENTATION
// =============================================================================

export function createPluginService(): PluginService {
  const emitter = new EventEmitter();
  const plugins = new Map<string, RegisteredPlugin>();
  const allSettings = loadAllSettings();
  let tickInterval: NodeJS.Timeout | null = null;

  /** Create plugin context */
  function createContext(pluginId: string): PluginContext {
    const registered = plugins.get(pluginId);
    if (!registered) throw new Error(`Plugin ${pluginId} not found`);

    const storageFile = join(PLUGINS_DIR, `${pluginId}.storage.json`);

    return {
      meta: registered.plugin.meta,

      onMessage(fn) {
        registered.hooks.message.push(fn);
      },

      onResponse(fn) {
        registered.hooks.response.push(fn);
      },

      registerCommand(name, handler, description) {
        registered.commands.set(name, { handler, description });
        logger.debug({ pluginId, command: name }, 'Command registered');
      },

      registerTool(tool) {
        registered.tools.set(tool.name, tool);
        logger.debug({ pluginId, tool: tool.name }, 'Tool registered');
      },

      getSettings<T>() {
        return registered.settings as T;
      },

      setSettings<T>(settings: Partial<T>) {
        registered.settings = { ...registered.settings, ...settings };
        allSettings[pluginId] = registered.settings;
        saveAllSettings(allSettings);
      },

      getPlugin<T>(targetPluginId: string) {
        const target = plugins.get(targetPluginId);
        if (target?.state === 'enabled' && target.api) {
          return target.api as T;
        }
        return null;
      },

      exposeApi<T>(api: T) {
        registered.api = api;
      },

      log: {
        debug: (msg, data) => logger.debug({ pluginId, ...data }, msg),
        info: (msg, data) => logger.info({ pluginId, ...data }, msg),
        warn: (msg, data) => logger.warn({ pluginId, ...data }, msg),
        error: (msg, data) => logger.error({ pluginId, ...data }, msg),
      },

      storage: {
        get<T>(key: string) {
          return (registered.storage[key] as T) ?? null;
        },
        set<T>(key: string, value: T) {
          registered.storage[key] = value;
          writeFileSync(storageFile, JSON.stringify(registered.storage, null, 2));
        },
        delete(key: string) {
          delete registered.storage[key];
          writeFileSync(storageFile, JSON.stringify(registered.storage, null, 2));
        },
        list() {
          return Object.keys(registered.storage);
        },
      },
    };
  }

  /** Load storage for plugin */
  function loadStorage(pluginId: string): Record<string, unknown> {
    const storageFile = join(PLUGINS_DIR, `${pluginId}.storage.json`);
    try {
      if (existsSync(storageFile)) {
        return JSON.parse(readFileSync(storageFile, 'utf-8'));
      }
    } catch {}
    return {};
  }

  const service: PluginService = {
    register(plugin) {
      if (plugins.has(plugin.meta.id)) {
        throw new Error(`Plugin ${plugin.meta.id} already registered`);
      }

      plugins.set(plugin.meta.id, {
        plugin,
        state: 'installed',
        settings: allSettings[plugin.meta.id] || {},
        storage: loadStorage(plugin.meta.id),
        commands: new Map(),
        tools: new Map(),
        hooks: { message: [], response: [] },
      });

      logger.info({ pluginId: plugin.meta.id, name: plugin.meta.name }, 'Plugin registered');
    },

    unregister(pluginId) {
      const registered = plugins.get(pluginId);
      if (!registered) return;

      if (registered.state === 'enabled') {
        this.disable(pluginId);
      }

      plugins.delete(pluginId);
      logger.info({ pluginId }, 'Plugin unregistered');
    },

    async enable(pluginId) {
      const registered = plugins.get(pluginId);
      if (!registered) throw new Error(`Plugin ${pluginId} not found`);
      if (registered.state === 'enabled') return;

      // Check dependencies
      for (const dep of registered.plugin.meta.dependencies || []) {
        const depPlugin = plugins.get(dep);
        if (!depPlugin || depPlugin.state !== 'enabled') {
          throw new Error(`Plugin ${pluginId} requires ${dep} to be enabled first`);
        }
      }

      try {
        const ctx = createContext(pluginId);
        if (registered.plugin.onEnable) {
          await registered.plugin.onEnable(ctx);
        }
        registered.state = 'enabled';
        registered.error = undefined;
        emitter.emit('plugin:enabled', pluginId);
        logger.info({ pluginId }, 'Plugin enabled');
      } catch (e) {
        registered.state = 'error';
        registered.error = e instanceof Error ? e.message : String(e);
        emitter.emit('plugin:error', pluginId, e);
        logger.error({ pluginId, error: e }, 'Plugin enable failed');
        throw e;
      }
    },

    async disable(pluginId) {
      const registered = plugins.get(pluginId);
      if (!registered) throw new Error(`Plugin ${pluginId} not found`);
      if (registered.state !== 'enabled') return;

      try {
        const ctx = createContext(pluginId);
        if (registered.plugin.onDisable) {
          await registered.plugin.onDisable(ctx);
        }
      } catch (e) {
        logger.error({ pluginId, error: e }, 'Plugin disable error');
      }

      // Clear hooks and commands
      registered.hooks = { message: [], response: [] };
      registered.commands.clear();
      registered.tools.clear();
      registered.api = undefined;
      registered.state = 'disabled';

      emitter.emit('plugin:disabled', pluginId);
      logger.info({ pluginId }, 'Plugin disabled');
    },

    get(pluginId) {
      return plugins.get(pluginId) || null;
    },

    list() {
      return Array.from(plugins.values());
    },

    async executeCommand(name, args, ctx) {
      for (const [pluginId, registered] of plugins) {
        if (registered.state !== 'enabled') continue;

        const cmd = registered.commands.get(name);
        if (cmd) {
          return cmd.handler(args, ctx);
        }
      }
      throw new Error(`Command /${name} not found`);
    },

    listCommands() {
      const commands: Array<{ name: string; pluginId: string; description?: string }> = [];

      for (const [pluginId, registered] of plugins) {
        if (registered.state !== 'enabled') continue;

        for (const [name, cmd] of registered.commands) {
          commands.push({ name, pluginId, description: cmd.description });
        }
      }

      return commands;
    },

    getTools() {
      const tools: PluginTool[] = [];

      for (const [_, registered] of plugins) {
        if (registered.state !== 'enabled') continue;
        tools.push(...registered.tools.values());
      }

      return tools;
    },

    async processMessage(msg) {
      for (const [pluginId, registered] of plugins) {
        if (registered.state !== 'enabled') continue;

        for (const hook of registered.hooks.message) {
          try {
            await hook(msg);
          } catch (e) {
            logger.error({ pluginId, error: e }, 'Plugin message hook error');
          }
        }
      }
    },

    async processResponse(msg) {
      for (const [pluginId, registered] of plugins) {
        if (registered.state !== 'enabled') continue;

        for (const hook of registered.hooks.response) {
          try {
            await hook(msg);
          } catch (e) {
            logger.error({ pluginId, error: e }, 'Plugin response hook error');
          }
        }
      }
    },

    async tick() {
      for (const [pluginId, registered] of plugins) {
        if (registered.state !== 'enabled') continue;

        if (registered.plugin.onTick) {
          try {
            const ctx = createContext(pluginId);
            await registered.plugin.onTick(ctx);
          } catch (e) {
            logger.error({ pluginId, error: e }, 'Plugin tick error');
          }
        }
      }
    },

    async loadFromDirectory(dir = PLUGINS_DIR) {
      let count = 0;

      try {
        const files = readdirSync(dir);

        for (const file of files) {
          if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue;

          try {
            const pluginPath = join(dir, file);
            const module = await import(pluginPath);
            const plugin = module.default || module;

            if (plugin.meta && plugin.meta.id) {
              this.register(plugin);
              count++;
            }
          } catch (e) {
            logger.error({ file, error: e }, 'Failed to load plugin');
          }
        }
      } catch {}

      if (count > 0) {
        logger.info({ count, dir }, 'Loaded plugins from directory');
      }

      return count;
    },

    on(event, fn) {
      emitter.on(event, fn);
    },

    off(event, fn) {
      emitter.off(event, fn);
    },
  };

  // Start tick interval
  tickInterval = setInterval(() => {
    service.tick().catch(e => logger.error({ error: e }, 'Plugin tick failed'));
  }, 60000);

  return service;
}

// =============================================================================
// EXAMPLE PLUGINS
// =============================================================================

/** Example: Simple echo command plugin */
export const echoPlugin: Plugin = {
  meta: {
    id: 'echo',
    name: 'Echo Plugin',
    version: '1.0.0',
    description: 'Adds /echo command',
  },

  onEnable(ctx) {
    ctx.registerCommand('echo', (args) => {
      return args.join(' ') || 'Nothing to echo';
    }, 'Echo back your message');

    ctx.log.info('Echo plugin enabled');
  },
};

/** Example: Message counter plugin */
export const counterPlugin: Plugin = {
  meta: {
    id: 'counter',
    name: 'Message Counter',
    version: '1.0.0',
    description: 'Counts messages per user',
  },

  onEnable(ctx) {
    ctx.onMessage((msg) => {
      const counts = ctx.storage.get<Record<string, number>>('counts') || {};
      counts[msg.userId] = (counts[msg.userId] || 0) + 1;
      ctx.storage.set('counts', counts);
    });

    ctx.registerCommand('mycount', (_, cmdCtx) => {
      const counts = ctx.storage.get<Record<string, number>>('counts') || {};
      const count = counts[cmdCtx.userId] || 0;
      return `You've sent ${count} messages`;
    }, 'Show your message count');

    ctx.log.info('Counter plugin enabled');
  },
};

/** Example: Scheduled reminder plugin */
export const reminderPlugin: Plugin = {
  meta: {
    id: 'reminder',
    name: 'Reminder Plugin',
    version: '1.0.0',
    description: 'Set reminders',
  },

  onEnable(ctx) {
    ctx.registerCommand('remind', (args, cmdCtx) => {
      if (args.length < 2) {
        return 'Usage: /remind <minutes> <message>';
      }

      const minutes = parseInt(args[0]);
      const message = args.slice(1).join(' ');

      if (isNaN(minutes) || minutes < 1) {
        return 'Minutes must be a positive number';
      }

      const reminders = ctx.storage.get<Array<{ userId: string; message: string; time: number }>>('reminders') || [];
      reminders.push({
        userId: cmdCtx.userId,
        message,
        time: Date.now() + minutes * 60 * 1000,
      });
      ctx.storage.set('reminders', reminders);

      return `Reminder set for ${minutes} minutes from now`;
    }, 'Set a reminder: /remind <minutes> <message>');

    ctx.log.info('Reminder plugin enabled');
  },

  onTick(ctx) {
    const reminders = ctx.storage.get<Array<{ userId: string; message: string; time: number }>>('reminders') || [];
    const now = Date.now();
    const due = reminders.filter(r => r.time <= now);
    const remaining = reminders.filter(r => r.time > now);

    if (due.length > 0) {
      ctx.storage.set('reminders', remaining);
      // Would need to send notifications here
      for (const reminder of due) {
        ctx.log.info(`Reminder due for ${reminder.userId}: ${reminder.message}`);
      }
    }
  },
};
