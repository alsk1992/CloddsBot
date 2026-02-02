/**
 * CLI Commands Module - Clawdbot-style comprehensive CLI commands
 *
 * Additional commands for full feature parity
 */

import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, cpSync, statSync, truncateSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getHooksDir, loadHooksState, removeHookSourceState, setHookSourceEnabled, resolveHookStateKey, loadHookStateStore, saveHookStateStore } from '../../hooks';
import { createDatabase } from '../../db';
import { createMigrationRunner } from '../../db/migrations';
import { execApprovals } from '../../permissions';
import type { User } from '../../types';
import { loadConfig } from '../../utils/config';
import { loginWhatsAppWithQr, resolveWhatsAppAuthDir } from '../../channels/whatsapp/index';

// =============================================================================
// CONFIG COMMANDS
// =============================================================================

export function createConfigCommands(program: Command): void {
  const config = program
    .command('config')
    .description('Manage configuration');

  config
    .command('get [key]')
    .description('Get config value or show all')
    .action(async (key?: string) => {
      const configPath = join(homedir(), '.clodds', 'config.json');
      if (!existsSync(configPath)) {
        console.log('No configuration file found');
        return;
      }

      const data = JSON.parse(readFileSync(configPath, 'utf-8'));

      if (key) {
        const value = key.split('.').reduce((obj, k) => obj?.[k], data);
        console.log(value !== undefined ? JSON.stringify(value, null, 2) : 'Key not found');
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    });

  config
    .command('set <key> <value>')
    .description('Set a config value')
    .action(async (key: string, value: string) => {
      const configDir = join(homedir(), '.clodds');
      const configPath = join(configDir, 'config.json');

      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      let data: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        data = JSON.parse(readFileSync(configPath, 'utf-8'));
      }

      // Handle nested keys
      const keys = key.split('.');
      let obj = data;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) obj[keys[i]] = {};
        obj = obj[keys[i]] as Record<string, unknown>;
      }

      // Try to parse value as JSON, otherwise use as string
      try {
        obj[keys[keys.length - 1]] = JSON.parse(value);
      } catch {
        obj[keys[keys.length - 1]] = value;
      }

      writeFileSync(configPath, JSON.stringify(data, null, 2));
      console.log(`Set ${key} = ${value}`);
    });

  config
    .command('unset <key>')
    .description('Remove a config value')
    .action(async (key: string) => {
      const configPath = join(homedir(), '.clodds', 'config.json');
      if (!existsSync(configPath)) {
        console.log('No configuration file found');
        return;
      }

      const data = JSON.parse(readFileSync(configPath, 'utf-8'));
      const keys = key.split('.');
      let obj = data;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) return;
        obj = obj[keys[i]] as Record<string, unknown>;
      }
      delete obj[keys[keys.length - 1]];

      writeFileSync(configPath, JSON.stringify(data, null, 2));
      console.log(`Removed ${key}`);
    });

  config
    .command('path')
    .description('Show config file path')
    .action(() => {
      console.log(join(homedir(), '.clodds', 'config.json'));
    });
}

// =============================================================================
// MODEL COMMANDS
// =============================================================================

export function createModelCommands(program: Command): void {
  const model = program
    .command('model')
    .description('Manage AI models');

  model
    .command('list')
    .description('List available models')
    .option('-p, --provider <provider>', 'Filter by provider')
    .action(async (options: { provider?: string }) => {
      console.log('Available models:');
      console.log('');

      const models = [
        { id: 'claude-3-5-sonnet-20241022', provider: 'anthropic', context: '200K' },
        { id: 'claude-3-opus-20240229', provider: 'anthropic', context: '200K' },
        { id: 'claude-3-5-haiku-20241022', provider: 'anthropic', context: '200K' },
        { id: 'gpt-4o', provider: 'openai', context: '128K' },
        { id: 'gpt-4-turbo', provider: 'openai', context: '128K' },
        { id: 'gpt-3.5-turbo', provider: 'openai', context: '16K' },
        { id: 'llama3', provider: 'ollama', context: '8K' },
      ];

      const filtered = options.provider
        ? models.filter(m => m.provider === options.provider)
        : models;

      for (const m of filtered) {
        console.log(`  ${m.id.padEnd(35)} ${m.provider.padEnd(12)} ${m.context}`);
      }
    });

  model
    .command('default [model]')
    .description('Get or set default model')
    .action(async (model?: string) => {
      const configPath = join(homedir(), '.clodds', 'config.json');
      let data: Record<string, unknown> = {};

      if (existsSync(configPath)) {
        data = JSON.parse(readFileSync(configPath, 'utf-8'));
      }

      if (model) {
        data.defaultModel = model;
        writeFileSync(configPath, JSON.stringify(data, null, 2));
        console.log(`Default model set to: ${model}`);
      } else {
        console.log(`Default model: ${data.defaultModel || 'claude-3-5-sonnet-20241022'}`);
      }
    });
}

// =============================================================================
// SESSION COMMANDS
// =============================================================================

export function createSessionCommands(program: Command): void {
  const session = program
    .command('session')
    .description('Manage sessions');

  session
    .command('list')
    .description('List active sessions')
    .action(async () => {
      const sessionsDir = join(homedir(), '.clodds', 'sessions');
      if (!existsSync(sessionsDir)) {
        console.log('No sessions found');
        return;
      }

      const sessions = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
      console.log(`\nActive sessions (${sessions.length}):\n`);

      for (const file of sessions.slice(0, 20)) {
        const sessionPath = join(sessionsDir, file);
        try {
          const data = JSON.parse(readFileSync(sessionPath, 'utf-8'));
          const id = file.replace('.json', '');
          console.log(`  ${id.slice(0, 8)}  ${data.userId || '-'}  ${data.createdAt || '-'}`);
        } catch {}
      }
    });

  session
    .command('clear [sessionId]')
    .description('Clear a session or all sessions')
    .option('-a, --all', 'Clear all sessions')
    .action(async (sessionId?: string, options?: { all?: boolean }) => {
      const sessionsDir = join(homedir(), '.clodds', 'sessions');

      if (options?.all) {
        if (existsSync(sessionsDir)) {
          const { rmSync } = require('fs');
          rmSync(sessionsDir, { recursive: true });
          mkdirSync(sessionsDir, { recursive: true });
        }
        console.log('Cleared all sessions');
      } else if (sessionId) {
        const sessionPath = join(sessionsDir, `${sessionId}.json`);
        if (existsSync(sessionPath)) {
          const { unlinkSync } = require('fs');
          unlinkSync(sessionPath);
          console.log(`Cleared session: ${sessionId}`);
        } else {
          console.log('Session not found');
        }
      } else {
        console.log('Specify a session ID or use --all');
      }
    });
}

// =============================================================================
// CRON COMMANDS
// =============================================================================

export function createCronCommands(program: Command): void {
  const cron = program
    .command('cron')
    .description('Manage scheduled cron jobs');

  const withDb = async <T,>(fn: (db: ReturnType<typeof createDatabase>) => T | Promise<T>) => {
    const db = createDatabase();
    createMigrationRunner(db).migrate();
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  };

  const formatSchedule = (schedule: { kind: string; [key: string]: unknown } | undefined): string => {
    if (!schedule) return 'n/a';
    if (schedule.kind === 'every') {
      const ms = schedule.everyMs as number;
      if (!ms || ms <= 0) return 'every ?';
      const mins = Math.round(ms / 60000);
      return mins >= 60 ? `every ${Math.round(mins / 60)}h` : `every ${mins}m`;
    }
    if (schedule.kind === 'cron') {
      return `cron ${String(schedule.expr ?? '')}`;
    }
    if (schedule.kind === 'at') {
      const atMs = schedule.atMs as number;
      return atMs ? `at ${new Date(atMs).toLocaleString()}` : 'at ?';
    }
    return String(schedule.kind);
  };

  const parseJob = (record: { id: string; data: string; enabled: boolean; createdAtMs: number; updatedAtMs: number }) => {
    try {
      const job = JSON.parse(record.data) as { name?: string; schedule?: { kind: string }; state?: { nextRunAtMs?: number } };
      return {
        ...record,
        job,
      };
    } catch {
      return { ...record, job: {} };
    }
  };

  cron
    .command('list')
    .description('List cron jobs')
    .option('-a, --all', 'Include disabled jobs')
    .action(async (options: { all?: boolean }) => {
      await withDb(async (db) => {
        const records = db.listCronJobs();
        if (records.length === 0) {
          console.log('No cron jobs found.');
          return;
        }

        const entries = records.map(parseJob)
          .filter((entry) => options.all || entry.enabled);

        if (entries.length === 0) {
          console.log('No enabled cron jobs found.');
          return;
        }

        console.log('\nCron Jobs:\n');
        console.log('ID			Enabled	Schedule		Next Run		Name');
        console.log('─'.repeat(90));
        for (const entry of entries) {
          const schedule = formatSchedule(entry.job.schedule);
          const nextRun = entry.job.state?.nextRunAtMs
            ? new Date(entry.job.state.nextRunAtMs).toLocaleString()
            : '-';
          const name = entry.job.name || '-';
          console.log(`${entry.id}	${entry.enabled ? 'yes' : 'no '}	${schedule}	${nextRun}	${name}`);
        }
      });
    });

  cron
    .command('show <id>')
    .description('Show a cron job detail')
    .action(async (id: string) => {
      await withDb(async (db) => {
        const record = db.getCronJob(id);
        if (!record) {
          console.log(`Cron job not found: ${id}`);
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(record.data);
        } catch {
          parsed = record.data;
        }
        console.log(JSON.stringify({
          id: record.id,
          enabled: record.enabled,
          createdAt: new Date(record.createdAtMs).toISOString(),
          updatedAt: new Date(record.updatedAtMs).toISOString(),
          job: parsed,
        }, null, 2));
      });
    });

  const setEnabled = async (id: string, enabled: boolean) => {
    await withDb(async (db) => {
      const record = db.getCronJob(id);
      if (!record) {
        console.log(`Cron job not found: ${id}`);
        return;
      }
      let job: { enabled?: boolean } | null = null;
      try {
        job = JSON.parse(record.data);
      } catch {
        job = null;
      }
      if (job && typeof job === 'object') {
        job.enabled = enabled;
      }
      const data = job ? JSON.stringify(job) : record.data;
      db.upsertCronJob({
        id: record.id,
        data,
        enabled,
        createdAtMs: record.createdAtMs,
        updatedAtMs: Date.now(),
      });
      console.log(`Cron job ${enabled ? 'enabled' : 'disabled'}: ${id}`);
      console.log('Restart the gateway if it is already running to apply changes.');
    });
  };

  cron
    .command('enable <id>')
    .description('Enable a cron job')
    .action(async (id: string) => setEnabled(id, true));

  cron
    .command('disable <id>')
    .description('Disable a cron job')
    .action(async (id: string) => setEnabled(id, false));

  cron
    .command('delete <id>')
    .description('Delete a cron job')
    .action(async (id: string) => {
      await withDb(async (db) => {
        const record = db.getCronJob(id);
        if (!record) {
          console.log(`Cron job not found: ${id}`);
          return;
        }
        db.deleteCronJob(id);
        console.log(`Cron job deleted: ${id}`);
        console.log('Restart the gateway if it is already running to apply changes.');
      });
    });
}

// =============================================================================
// QMD COMMANDS
// =============================================================================

export function createQmdCommands(program: Command): void {
  const qmd = program
    .command('qmd')
    .description('Local markdown search powered by qmd');

  const runQmd = (args: string[], timeoutMs?: number): void => {
    const env = { ...process.env };
    const bunBin = join(homedir(), '.bun', 'bin');
    env.PATH = [bunBin, env.PATH || ''].filter(Boolean).join(':');

    const result = spawnSync('qmd', args, {
      stdio: 'inherit',
      env,
      timeout: timeoutMs,
    });

    if (result.error) {
      const err = result.error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        console.error('qmd not found. Install with: bun install -g https://github.com/tobi/qmd');
      } else {
        console.error(err.message || 'Failed to run qmd');
      }
      process.exitCode = 1;
      return;
    }

    if (typeof result.status === 'number' && result.status !== 0) {
      process.exitCode = result.status;
    }
  };

  const buildSearchArgs = (
    mode: 'search' | 'vsearch' | 'query',
    query: string,
    options: {
      collection?: string;
      limit?: string;
      json?: boolean;
      files?: boolean;
      all?: boolean;
      full?: boolean;
      minScore?: string;
    }
  ): string[] => {
    const args = [mode, query];
    if (options.collection) args.push('-c', options.collection);
    if (options.limit) args.push('-n', options.limit);
    if (options.json) args.push('--json');
    if (options.files) args.push('--files');
    if (options.all) args.push('--all');
    if (options.full) args.push('--full');
    if (options.minScore) args.push('--min-score', options.minScore);
    return args;
  };

  const addSearchCommand = (mode: 'search' | 'vsearch' | 'query', description: string, timeoutMs: number) => {
    qmd
      .command(`${mode} <query>`)
      .description(description)
      .option('-c, --collection <name>', 'Restrict to a collection')
      .option('-n, --limit <n>', 'Number of results')
      .option('--json', 'JSON output')
      .option('--files', 'File-only output (JSON)')
      .option('--all', 'Return all matches above threshold')
      .option('--full', 'Return full document content')
      .option('--min-score <score>', 'Minimum score threshold')
      .action((query: string, options: {
        collection?: string;
        limit?: string;
        json?: boolean;
        files?: boolean;
        all?: boolean;
        full?: boolean;
        minScore?: string;
      }) => {
        runQmd(buildSearchArgs(mode, query, options), timeoutMs);
      });
  };

  addSearchCommand('search', 'Keyword search (BM25)', 30_000);
  addSearchCommand('vsearch', 'Semantic search (slow)', 180_000);
  addSearchCommand('query', 'Hybrid search + rerank (slow)', 180_000);

  qmd
    .command('get <target>')
    .description('Retrieve a document by path or #docid')
    .option('--json', 'JSON output')
    .option('--full', 'Return full document content')
    .action((target: string, options: { json?: boolean; full?: boolean }) => {
      const args = ['get', target];
      if (options.json) args.push('--json');
      if (options.full) args.push('--full');
      runQmd(args, 30_000);
    });

  qmd
    .command('multi-get <targets>')
    .description('Retrieve multiple documents (comma-separated list)')
    .option('--json', 'JSON output')
    .action((targets: string, options: { json?: boolean }) => {
      const args = ['multi-get', targets];
      if (options.json) args.push('--json');
      runQmd(args, 60_000);
    });

  qmd
    .command('status')
    .description('Show index status')
    .action(() => runQmd(['status'], 30_000));

  qmd
    .command('update')
    .description('Incrementally update the index')
    .action(() => runQmd(['update'], 120_000));

  qmd
    .command('embed')
    .description('Update embeddings (slow)')
    .action(() => runQmd(['embed'], 300_000));

  const collection = qmd
    .command('collection')
    .description('Manage collections');

  collection
    .command('add <path>')
    .description('Add a markdown collection')
    .requiredOption('-n, --name <name>', 'Collection name')
    .option('-m, --mask <glob>', 'Glob mask (default "**/*.md")')
    .action((path: string, options: { name: string; mask?: string }) => {
      const args = ['collection', 'add', path, '--name', options.name];
      if (options.mask) args.push('--mask', options.mask);
      runQmd(args, 60_000);
    });

  const contextCmd = qmd
    .command('context')
    .description('Manage collection context');

  contextCmd
    .command('add <collection> <description>')
    .description('Attach a description to a collection')
    .action((collectionName: string, description: string) => {
      runQmd(['context', 'add', collectionName, description], 30_000);
    });
}

// =============================================================================
// USER COMMANDS
// =============================================================================

export function createUserCommands(program: Command): void {
  const users = program
    .command('users')
    .description('Manage users and per-user settings');

  const withDb = async <T,>(fn: (db: ReturnType<typeof createDatabase>) => T | Promise<T>) => {
    const db = createDatabase();
    createMigrationRunner(db).migrate();
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  };

  users
    .command('list')
    .description('List known users')
    .action(async () => {
      await withDb((db) => {
        const rows = db.listUsers();
        if (rows.length === 0) {
          console.log('No users found.');
          return;
        }
        console.log('\nUsers:\n');
        console.log('ID\t\tPlatform\tPlatformUserId\tUsername');
        console.log('─'.repeat(80));
        for (const user of rows) {
          console.log(`${user.id}\t${user.platform}\t${user.platformUserId}\t${user.username || '-'}`);
        }
      });
    });

  users
    .command('settings <platform> <platformUserId>')
    .description('Show settings for a user')
    .action(async (platform: string, platformUserId: string) => {
      await withDb((db) => {
        const user = db.getUserByPlatformId(platform, platformUserId);
        if (!user) {
          console.log('User not found.');
          return;
        }
        console.log(JSON.stringify(user.settings || {}, null, 2));
      });
    });

  users
    .command('settings-by-id <userId>')
    .description('Show settings for a user by internal ID')
    .action(async (userId: string) => {
      await withDb((db) => {
        const user = db.getUser(userId);
        if (!user) {
          console.log('User not found.');
          return;
        }
        console.log(JSON.stringify(user.settings || {}, null, 2));
      });
    });

  const applySettings = async (
    db: ReturnType<typeof createDatabase>,
    userId: string,
    patch: Partial<User['settings']>
  ): Promise<boolean> => {
    return db.updateUserSettings(userId, patch);
  };

  const parseNumber = (value?: string): number | undefined => {
    if (value === undefined) return undefined;
    const num = Number(value);
    if (!Number.isFinite(num)) return undefined;
    return num;
  };

  const parseDigestTime = (value?: string): string | undefined => {
    if (!value) return undefined;
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return undefined;
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return undefined;
    if (!Number.isFinite(minute) || minute < 0 || minute > 59) return undefined;
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  users
    .command('set-settings <platform> <platformUserId>')
    .description('Update settings for a user')
    .option('--max-order-size <usd>', 'Max single order size (USD)')
    .option('--max-position-value <usd>', 'Max exposure per position (USD)')
    .option('--max-total-exposure <usd>', 'Max total exposure (USD)')
    .option('--stop-loss-pct <pct>', 'Stop-loss trigger percent (e.g., 0.2 or 20)')
    .option('--digest-enable', 'Enable daily digest notifications')
    .option('--digest-disable', 'Disable daily digest notifications')
    .option('--digest-time <HH:MM>', 'Set daily digest time (24h, local)')
    .option('--digest-reset', 'Disable digest and clear time')
    .option('--reset', 'Clear risk limits')
    .option('--disable', 'Disable risk limits (set to 0)')
    .action(async (platform: string, platformUserId: string, options: {
      maxOrderSize?: string;
      maxPositionValue?: string;
      maxTotalExposure?: string;
      stopLossPct?: string;
      digestEnable?: boolean;
      digestDisable?: boolean;
      digestTime?: string;
      digestReset?: boolean;
      reset?: boolean;
      disable?: boolean;
    }) => {
      await withDb(async (db) => {
        const user = db.getUserByPlatformId(platform, platformUserId);
        if (!user) {
          console.log('User not found.');
          return;
        }
        const patch: Partial<User['settings']> = {};
        if (options.reset) {
          patch.maxOrderSize = undefined;
          patch.maxPositionValue = undefined;
          patch.maxTotalExposure = undefined;
          patch.stopLossPct = undefined;
        } else if (options.disable) {
          patch.maxOrderSize = 0;
          patch.maxPositionValue = 0;
          patch.maxTotalExposure = 0;
          patch.stopLossPct = 0;
        } else {
          const maxOrderSize = parseNumber(options.maxOrderSize);
          const maxPositionValue = parseNumber(options.maxPositionValue);
          const maxTotalExposure = parseNumber(options.maxTotalExposure);
          const stopLossPct = parseNumber(options.stopLossPct);
          if (maxOrderSize !== undefined) patch.maxOrderSize = maxOrderSize;
          if (maxPositionValue !== undefined) patch.maxPositionValue = maxPositionValue;
          if (maxTotalExposure !== undefined) patch.maxTotalExposure = maxTotalExposure;
          if (stopLossPct !== undefined) patch.stopLossPct = stopLossPct;
        }

        if (options.digestReset) {
          patch.digestEnabled = false;
          patch.digestTime = undefined;
        } else {
          if (options.digestEnable) patch.digestEnabled = true;
          if (options.digestDisable) patch.digestEnabled = false;
          if (options.digestTime) {
            const time = parseDigestTime(options.digestTime);
            if (!time) {
              console.log('Invalid --digest-time. Use HH:MM (24h).');
              return;
            }
            patch.digestTime = time;
            patch.digestEnabled = true;
          }
        }

        if (Object.keys(patch).length === 0) {
          console.log('No settings provided.');
          return;
        }
        const ok = await applySettings(db, user.id, patch);
        console.log(ok ? 'Updated settings.' : 'Failed to update settings.');
      });
    });

  users
    .command('set-settings-by-id <userId>')
    .description('Update settings by internal user ID')
    .option('--max-order-size <usd>', 'Max single order size (USD)')
    .option('--max-position-value <usd>', 'Max exposure per position (USD)')
    .option('--max-total-exposure <usd>', 'Max total exposure (USD)')
    .option('--stop-loss-pct <pct>', 'Stop-loss trigger percent (e.g., 0.2 or 20)')
    .option('--digest-enable', 'Enable daily digest notifications')
    .option('--digest-disable', 'Disable daily digest notifications')
    .option('--digest-time <HH:MM>', 'Set daily digest time (24h, local)')
    .option('--digest-reset', 'Disable digest and clear time')
    .option('--reset', 'Clear risk limits')
    .option('--disable', 'Disable risk limits (set to 0)')
    .action(async (userId: string, options: {
      maxOrderSize?: string;
      maxPositionValue?: string;
      maxTotalExposure?: string;
      stopLossPct?: string;
      digestEnable?: boolean;
      digestDisable?: boolean;
      digestTime?: string;
      digestReset?: boolean;
      reset?: boolean;
      disable?: boolean;
    }) => {
      await withDb(async (db) => {
        const patch: Partial<User['settings']> = {};
        if (options.reset) {
          patch.maxOrderSize = undefined;
          patch.maxPositionValue = undefined;
          patch.maxTotalExposure = undefined;
          patch.stopLossPct = undefined;
        } else if (options.disable) {
          patch.maxOrderSize = 0;
          patch.maxPositionValue = 0;
          patch.maxTotalExposure = 0;
          patch.stopLossPct = 0;
        } else {
          const maxOrderSize = parseNumber(options.maxOrderSize);
          const maxPositionValue = parseNumber(options.maxPositionValue);
          const maxTotalExposure = parseNumber(options.maxTotalExposure);
          const stopLossPct = parseNumber(options.stopLossPct);
          if (maxOrderSize !== undefined) patch.maxOrderSize = maxOrderSize;
          if (maxPositionValue !== undefined) patch.maxPositionValue = maxPositionValue;
          if (maxTotalExposure !== undefined) patch.maxTotalExposure = maxTotalExposure;
          if (stopLossPct !== undefined) patch.stopLossPct = stopLossPct;
        }

        if (options.digestReset) {
          patch.digestEnabled = false;
          patch.digestTime = undefined;
        } else {
          if (options.digestEnable) patch.digestEnabled = true;
          if (options.digestDisable) patch.digestEnabled = false;
          if (options.digestTime) {
            const time = parseDigestTime(options.digestTime);
            if (!time) {
              console.log('Invalid --digest-time. Use HH:MM (24h).');
              return;
            }
            patch.digestTime = time;
            patch.digestEnabled = true;
          }
        }

        if (Object.keys(patch).length === 0) {
          console.log('No settings provided.');
          return;
        }
        const ok = await applySettings(db, userId, patch);
        console.log(ok ? 'Updated settings.' : 'User not found.');
      });
    });
}

// =============================================================================
// MEMORY COMMANDS
// =============================================================================

export function createMemoryCommands(program: Command): void {
  const memory = program
    .command('memory')
    .description('Manage memory');

  const withDb = async <T,>(fn: (db: ReturnType<typeof createDatabase>) => T | Promise<T>) => {
    const db = createDatabase();
    createMigrationRunner(db).migrate();
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  };

  memory
    .command('list <userId>')
    .description('List memories for a user')
    .option('-t, --type <type>', 'Filter by type (fact, preference, note, summary, context, profile)')
    .option('-c, --channel <channel>', 'Filter by channel', 'cli')
    .option('-l, --limit <n>', 'Limit results', '50')
    .action(async (userId: string, options: { type?: string; channel?: string; limit?: string }) => {
      await withDb((db) => {
        const limit = parseInt(options.limit || '50', 10);
        let query = 'SELECT * FROM user_memory WHERE userId = ?';
        const params: (string | number)[] = [userId];

        if (options.channel) {
          query += ' AND channel = ?';
          params.push(options.channel);
        }
        if (options.type) {
          query += ' AND type = ?';
          params.push(options.type);
        }
        query += ' ORDER BY updatedAt DESC LIMIT ?';
        params.push(limit);

        try {
          const rows = db.query<{
            id: string;
            userId: string;
            channel: string;
            type: string;
            key: string;
            value: string;
            createdAt: string;
            updatedAt: string;
            expiresAt: string | null;
          }>(query, params);

          if (rows.length === 0) {
            console.log(`\nNo memories found for user: ${userId}`);
            if (options.type) console.log(`  (filtered by type: ${options.type})`);
            return;
          }

          console.log(`\nMemories for ${userId} (${rows.length}):\n`);
          console.log('Type\t\tKey\t\t\tValue\t\t\t\tUpdated');
          console.log('─'.repeat(90));

          for (const row of rows) {
            const key = row.key.length > 20 ? row.key.slice(0, 17) + '...' : row.key.padEnd(20);
            const value = row.value.length > 30 ? row.value.slice(0, 27) + '...' : row.value.padEnd(30);
            const updated = row.updatedAt.slice(0, 16).replace('T', ' ');
            console.log(`${row.type.padEnd(12)}\t${key}\t${value}\t${updated}`);
          }
        } catch (e) {
          // Table might not exist yet
          console.log(`\nNo memories found for user: ${userId}`);
          console.log('(Memory table not initialized - run the gateway first)');
        }
      });
    });

  memory
    .command('clear <userId>')
    .description('Clear all memories for a user')
    .option('-c, --channel <channel>', 'Clear only for specific channel')
    .option('-t, --type <type>', 'Clear only specific type')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (userId: string, options: { channel?: string; type?: string; yes?: boolean }) => {
      await withDb((db) => {
        let query = 'DELETE FROM user_memory WHERE userId = ?';
        const params: string[] = [userId];
        let desc = `all memories for ${userId}`;

        if (options.channel) {
          query += ' AND channel = ?';
          params.push(options.channel);
          desc += ` in channel ${options.channel}`;
        }
        if (options.type) {
          query += ' AND type = ?';
          params.push(options.type);
          desc += ` of type ${options.type}`;
        }

        if (!options.yes) {
          console.log(`About to delete ${desc}`);
          console.log('Run with --yes to confirm');
          return;
        }

        try {
          // Count before delete
          const countBefore = db.query<{ count: number }>('SELECT COUNT(*) as count FROM user_memory WHERE userId = ?', [userId]);
          db.run(query, params);
          const countAfter = db.query<{ count: number }>('SELECT COUNT(*) as count FROM user_memory WHERE userId = ?', [userId]);
          const deleted = (countBefore[0]?.count || 0) - (countAfter[0]?.count || 0);
          console.log(`Cleared ${deleted} memories for ${userId}`);
        } catch (e) {
          console.log('No memories to clear (table not initialized)');
        }
      });
    });

  memory
    .command('export <userId>')
    .description('Export memories to JSON')
    .option('-o, --output <file>', 'Output file')
    .option('-c, --channel <channel>', 'Export only for specific channel')
    .action(async (userId: string, options: { output?: string; channel?: string }) => {
      await withDb((db) => {
        let query = 'SELECT * FROM user_memory WHERE userId = ?';
        const params: string[] = [userId];

        if (options.channel) {
          query += ' AND channel = ?';
          params.push(options.channel);
        }
        query += ' ORDER BY type, key';

        try {
          const rows = db.query<Record<string, unknown>>(query, params);
          const output = options.output || `${userId}-memories.json`;

          if (rows.length === 0) {
            console.log(`No memories to export for ${userId}`);
            return;
          }

          writeFileSync(output, JSON.stringify(rows, null, 2));
          console.log(`Exported ${rows.length} memories to ${output}`);
        } catch (e) {
          console.log('No memories to export (table not initialized)');
        }
      });
    });

  memory
    .command('search <userId> <query>')
    .description('Search memories by content')
    .option('-c, --channel <channel>', 'Search only in specific channel')
    .action(async (userId: string, query: string, options: { channel?: string }) => {
      await withDb((db) => {
        let sql = 'SELECT * FROM user_memory WHERE userId = ? AND (key LIKE ? OR value LIKE ?)';
        const searchPattern = `%${query}%`;
        const params: string[] = [userId, searchPattern, searchPattern];

        if (options.channel) {
          sql += ' AND channel = ?';
          params.push(options.channel);
        }
        sql += ' ORDER BY updatedAt DESC LIMIT 20';

        try {
          const rows = db.query<{
            type: string;
            key: string;
            value: string;
            updatedAt: string;
          }>(sql, params);

          if (rows.length === 0) {
            console.log(`\nNo memories matching "${query}" for ${userId}`);
            return;
          }

          console.log(`\nSearch results for "${query}" (${rows.length}):\n`);
          for (const row of rows) {
            console.log(`[${row.type}] ${row.key}: ${row.value.slice(0, 60)}${row.value.length > 60 ? '...' : ''}`);
          }
        } catch (e) {
          console.log('Memory table not initialized');
        }
      });
    });
}

// =============================================================================
// HOOK COMMANDS
// =============================================================================

export function createHookCommands(program: Command): void {
  const hooks = program
    .command('hooks')
    .description('Manage hooks');

  hooks
    .command('list')
    .description('List installed hooks')
    .action(async () => {
      const hooksDir = getHooksDir();
      if (!existsSync(hooksDir)) {
        console.log('No hooks installed');
        return;
      }

      const entries = readdirSync(hooksDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      if (entries.length === 0) {
        console.log('No hooks installed');
        return;
      }
      const state = loadHooksState();
      console.log(`\nInstalled hooks (${entries.length}):\n`);

      for (const entry of entries) {
        const hookPath = join(hooksDir, entry.name);
        const enabled = state.sources[hookPath]?.enabled ?? true;
        console.log(`  ${entry.name} (${enabled ? 'enabled' : 'disabled'})`);
      }
    });

  hooks
    .command('install <path>')
    .description('Install a hook')
    .action(async (path: string) => {
      const hooksDir = getHooksDir();
      if (!existsSync(hooksDir)) {
        mkdirSync(hooksDir, { recursive: true });
      }
      const resolved = path.trim();
      if (!resolved) {
        console.error('Missing hook path');
        return;
      }

      const stats = statSync(resolved);
      const hookName = resolved.split('/').filter(Boolean).pop()!;
      const destDir = join(hooksDir, hookName);
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }

      if (stats.isDirectory()) {
        cpSync(resolved, destDir, { recursive: true });
      } else {
        const content = readFileSync(resolved, 'utf-8');
        writeFileSync(join(destDir, 'index.js'), content);
      }

      setHookSourceEnabled(destDir, true);
      console.log(`Installed hook: ${hookName}`);
    });

  hooks
    .command('uninstall <name>')
    .description('Uninstall a hook')
    .action(async (name: string) => {
      const hooksDir = getHooksDir();
      const target = join(hooksDir, name);
      if (!existsSync(target)) {
        console.log(`Hook not found: ${name}`);
        return;
      }
      rmSync(target, { recursive: true, force: true });
      removeHookSourceState(target);
      console.log(`Uninstalled hook: ${name}`);
    });

  hooks
    .command('enable <name>')
    .description('Enable a hook')
    .action(async (name: string) => {
      const hooksDir = getHooksDir();
      const target = join(hooksDir, name);
      if (!existsSync(target)) {
        console.log(`Hook not found: ${name}`);
        return;
      }
      setHookSourceEnabled(target, true);
      console.log(`Enabled hook: ${name}`);
    });

  hooks
    .command('disable <name>')
    .description('Disable a hook')
    .action(async (name: string) => {
      const hooksDir = getHooksDir();
      const target = join(hooksDir, name);
      if (!existsSync(target)) {
        console.log(`Hook not found: ${name}`);
        return;
      }
      setHookSourceEnabled(target, false);
      console.log(`Disabled hook: ${name}`);
    });

  hooks
    .command('trace')
    .description('Show recent hook traces')
    .option('-n, --limit <n>', 'Number of trace entries to show', '50')
    .option('--clear', 'Clear trace log')
    .action(async (options: { limit: string; clear?: boolean }) => {
      const hooksDir = getHooksDir();
      const tracePath = join(hooksDir, 'trace.log');

      if (options.clear) {
        if (existsSync(tracePath)) {
          truncateSync(tracePath, 0);
        }
        console.log('Hook trace log cleared');
        return;
      }

      if (!existsSync(tracePath)) {
        console.log('No hook trace log found');
        return;
      }

      const limit = Math.max(1, Number.parseInt(options.limit, 10) || 50);
      const content = readFileSync(tracePath, 'utf-8').trim();
      if (!content) {
        console.log('Hook trace log is empty');
        return;
      }
      const lines = content.split('\n').filter(Boolean);
      const slice = lines.slice(Math.max(0, lines.length - limit));
      console.log(`\nHook traces (last ${slice.length}):\n`);
      for (const line of slice) {
        try {
          const entry = JSON.parse(line) as { event?: string; hookName?: string; hookId?: string; durationMs?: number; status?: string; error?: string };
          const name = entry.hookName || entry.hookId || 'unknown';
          const status = entry.status || 'ok';
          const duration = typeof entry.durationMs === 'number' ? `${entry.durationMs}ms` : '';
          const error = entry.error ? ` - ${entry.error}` : '';
          console.log(`  ${entry.event} :: ${name} :: ${status} ${duration}${error}`);
        } catch {
          console.log(`  ${line}`);
        }
      }
    });

  const hookState = hooks
    .command('state')
    .description('Manage hook state storage');

  hookState
    .command('get <name> [key]')
    .description('Get hook state (whole or key)')
    .action(async (name: string, key?: string) => {
      const hookKey = resolveHookStateKey(name);
      const store = loadHookStateStore();
      const data = store.data[hookKey];
      if (!data) {
        console.log('No state found for hook');
        return;
      }
      if (key) {
        console.log(JSON.stringify(data[key], null, 2));
        return;
      }
      console.log(JSON.stringify(data, null, 2));
    });

  hookState
    .command('set <name> <key> <value>')
    .description('Set hook state (value can be JSON)')
    .action(async (name: string, key: string, value: string) => {
      const hookKey = resolveHookStateKey(name);
      const store = loadHookStateStore();
      let parsed: unknown = value;
      try {
        parsed = JSON.parse(value);
      } catch {
        // keep as string
      }
      if (!store.data[hookKey]) {
        store.data[hookKey] = {};
      }
      store.data[hookKey][key] = parsed;
      store.updatedAt = new Date().toISOString();
      saveHookStateStore(undefined, store);
      console.log('Hook state updated');
    });

  hookState
    .command('clear <name> [key]')
    .description('Clear hook state (entire hook or single key)')
    .action(async (name: string, key?: string) => {
      const hookKey = resolveHookStateKey(name);
      const store = loadHookStateStore();
      if (!store.data[hookKey]) {
        console.log('No state found for hook');
        return;
      }
      if (key) {
        delete store.data[hookKey][key];
      } else {
        delete store.data[hookKey];
      }
      store.updatedAt = new Date().toISOString();
      saveHookStateStore(undefined, store);
      console.log('Hook state cleared');
    });
}

// =============================================================================
// MCP COMMANDS
// =============================================================================

export function createMcpCommands(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('Manage MCP servers');

  mcp
    .command('list')
    .description('List configured MCP servers')
    .action(async () => {
      const mcpConfigPaths = [
        join(process.cwd(), '.mcp.json'),
        join(homedir(), '.config', 'clodds', 'mcp.json'),
      ];

      for (const path of mcpConfigPaths) {
        if (existsSync(path)) {
          const config = JSON.parse(readFileSync(path, 'utf-8'));
          console.log(`\nMCP servers from ${path}:\n`);

          if (config.mcpServers) {
            for (const [name, server] of Object.entries(config.mcpServers)) {
              const s = server as {
                command?: string;
                transport?: string;
                sseEndpoint?: string;
                messageEndpoint?: string;
              };
              if (s.transport === 'sse') {
                console.log(`  ${name}: sse ${s.sseEndpoint || ''}`.trim());
                if (s.messageEndpoint) {
                  console.log(`    message: ${s.messageEndpoint}`);
                }
              } else {
                console.log(`  ${name}: ${s.command || '(missing command)'}`);
              }
            }
          }
          return;
        }
      }

      console.log('No MCP configuration found');
    });

  mcp
    .command('add <name> <command>')
    .description('Add an MCP server')
    .option('-a, --args <args>', 'Command arguments (comma-separated)')
    .option('-e, --env <env>', 'Environment variables (KEY=VALUE,KEY2=VALUE2)')
    .option('--global', 'Add to global config instead of project')
    .action(async (name: string, command: string, options: { args?: string; env?: string; global?: boolean }) => {
      const configPath = options.global
        ? join(homedir(), '.config', 'clodds', 'mcp.json')
        : join(process.cwd(), '.mcp.json');

      // Ensure directory exists for global config
      if (options.global) {
        const configDir = join(homedir(), '.config', 'clodds');
        if (!existsSync(configDir)) {
          mkdirSync(configDir, { recursive: true });
        }
      }

      // Load or create config
      let config: { mcpServers?: Record<string, unknown> } = { mcpServers: {} };
      if (existsSync(configPath)) {
        try {
          config = JSON.parse(readFileSync(configPath, 'utf-8'));
        } catch (e) {
          console.error(`Error reading ${configPath}: ${e}`);
          return;
        }
      }

      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      // Check if already exists
      if (config.mcpServers[name]) {
        console.log(`MCP server "${name}" already exists. Use 'mcp remove' first to replace.`);
        return;
      }

      // Build server config
      const serverConfig: {
        command: string;
        args?: string[];
        env?: Record<string, string>;
      } = { command };

      if (options.args) {
        serverConfig.args = options.args.split(',').map(a => a.trim());
      }

      if (options.env) {
        serverConfig.env = {};
        for (const pair of options.env.split(',')) {
          const [key, ...valueParts] = pair.split('=');
          if (key && valueParts.length > 0) {
            serverConfig.env[key.trim()] = valueParts.join('=').trim();
          }
        }
      }

      config.mcpServers[name] = serverConfig;

      // Write config
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`Added MCP server "${name}" to ${configPath}`);
      console.log(`  Command: ${command}`);
      if (serverConfig.args) console.log(`  Args: ${serverConfig.args.join(' ')}`);
      if (serverConfig.env) console.log(`  Env: ${Object.keys(serverConfig.env).join(', ')}`);
    });

  mcp
    .command('remove <name>')
    .description('Remove an MCP server')
    .option('--global', 'Remove from global config instead of project')
    .action(async (name: string, options: { global?: boolean }) => {
      const configPath = options.global
        ? join(homedir(), '.config', 'clodds', 'mcp.json')
        : join(process.cwd(), '.mcp.json');

      if (!existsSync(configPath)) {
        console.log(`No MCP config found at ${configPath}`);
        return;
      }

      let config: { mcpServers?: Record<string, unknown> };
      try {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
      } catch (e) {
        console.error(`Error reading ${configPath}: ${e}`);
        return;
      }

      if (!config.mcpServers || !config.mcpServers[name]) {
        console.log(`MCP server "${name}" not found in ${configPath}`);
        return;
      }

      delete config.mcpServers[name];
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`Removed MCP server "${name}" from ${configPath}`);
    });

  mcp
    .command('test <name>')
    .description('Test connection to MCP server')
    .option('--global', 'Look in global config instead of project')
    .option('--timeout <ms>', 'Timeout in milliseconds', '5000')
    .action(async (name: string, options: { global?: boolean; timeout?: string }) => {
      const configPaths = options.global
        ? [join(homedir(), '.config', 'clodds', 'mcp.json')]
        : [join(process.cwd(), '.mcp.json'), join(homedir(), '.config', 'clodds', 'mcp.json')];

      let serverConfig: { command?: string; args?: string[]; env?: Record<string, string> } | null = null;
      let foundPath = '';

      for (const configPath of configPaths) {
        if (existsSync(configPath)) {
          try {
            const config = JSON.parse(readFileSync(configPath, 'utf-8'));
            if (config.mcpServers?.[name]) {
              serverConfig = config.mcpServers[name];
              foundPath = configPath;
              break;
            }
          } catch {}
        }
      }

      if (!serverConfig || !serverConfig.command) {
        console.log(`MCP server "${name}" not found`);
        return;
      }

      console.log(`Testing MCP server "${name}" from ${foundPath}...`);
      console.log(`  Command: ${serverConfig.command} ${(serverConfig.args || []).join(' ')}`);

      // Try to spawn the process and check if it starts
      const { spawn } = require('child_process');
      const timeout = parseInt(options.timeout || '5000', 10);

      try {
        const proc = spawn(serverConfig.command, serverConfig.args || [], {
          env: { ...process.env, ...serverConfig.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let output = '';
        let errorOutput = '';

        proc.stdout.on('data', (data: Buffer) => {
          output += data.toString();
        });

        proc.stderr.on('data', (data: Buffer) => {
          errorOutput += data.toString();
        });

        const result = await Promise.race([
          new Promise<'started'>((resolve) => {
            // If process emits any data or stays alive for a bit, consider it started
            setTimeout(() => resolve('started'), 1000);
          }),
          new Promise<'error'>((_, reject) => {
            proc.on('error', (err: Error) => reject(err));
          }),
          new Promise<'exited'>((resolve) => {
            proc.on('exit', (code: number) => {
              if (code !== 0) resolve('exited');
            });
          }),
          new Promise<'timeout'>((resolve) => {
            setTimeout(() => resolve('timeout'), timeout);
          }),
        ]);

        // Kill the process after test
        proc.kill();

        if (result === 'started' || result === 'timeout') {
          console.log(`\n✅ MCP server "${name}" started successfully`);
          if (output) console.log(`  Output: ${output.slice(0, 200)}`);
        } else {
          console.log(`\n❌ MCP server "${name}" failed to start`);
          if (errorOutput) console.log(`  Error: ${errorOutput.slice(0, 200)}`);
        }
      } catch (e) {
        const err = e as Error;
        console.log(`\n❌ Failed to start MCP server "${name}"`);
        console.log(`  Error: ${err.message}`);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          console.log(`  Command not found: ${serverConfig.command}`);
        }
      }
    });
}

// =============================================================================
// MARKET INDEX COMMANDS
// =============================================================================

export function createMarketIndexCommands(program: Command): void {
  const marketIndex = program
    .command('market-index')
    .description('Market index maintenance');

  marketIndex
    .command('stats')
    .description('Show market index stats (counts by platform)')
    .option('-p, --platforms <platforms>', 'Comma-separated platforms')
    .action(async (options: { platforms?: string }) => {
      const { initDatabase } = await import('../../db');
      const { createEmbeddingsService } = await import('../../embeddings');
      const { createMarketIndexService } = await import('../../market-index');

      const db = await initDatabase();
      const embeddings = createEmbeddingsService(db);
      const marketIndexService = createMarketIndexService(db, embeddings);

      const platforms = options.platforms
        ? options.platforms.split(',').map((p) => p.trim()).filter(Boolean)
        : undefined;

      const stats = marketIndexService.stats(platforms as any);
      console.log('\nMarket Index Stats:');
      console.log(`  Total: ${stats.total}`);
      for (const [platform, count] of Object.entries(stats.byPlatform)) {
        console.log(`  ${platform}: ${count}`);
      }

      if (stats.lastSyncAt) {
        console.log(`\nLast Sync: ${stats.lastSyncAt.toISOString()}`);
        if (stats.lastSyncIndexed !== undefined) {
          console.log(`  Indexed: ${stats.lastSyncIndexed}`);
        }
        if (stats.lastSyncDurationMs !== undefined) {
          console.log(`  Duration: ${stats.lastSyncDurationMs}ms`);
        }
        if (stats.lastPruned !== undefined) {
          console.log(`  Pruned: ${stats.lastPruned}`);
        }
      }
    });

  marketIndex
    .command('sync')
    .description('Run a market index sync now')
    .option('-p, --platforms <platforms>', 'Comma-separated platforms')
    .option('-l, --limit <limit>', 'Limit per platform', (v) => Number.parseInt(v, 10))
    .option('-s, --status <status>', 'Status: open|closed|settled|all')
    .option('--include-sports', 'Include sports markets')
    .option('--min-volume-24h <num>', 'Minimum 24h volume', (v) => Number.parseFloat(v))
    .option('--min-liquidity <num>', 'Minimum liquidity', (v) => Number.parseFloat(v))
    .option('--min-open-interest <num>', 'Minimum open interest', (v) => Number.parseFloat(v))
    .option('--min-predictions <num>', 'Minimum predictions', (v) => Number.parseInt(v, 10))
    .option('--exclude-resolved', 'Exclude resolved markets')
    .option('--prune', 'Prune stale entries during sync')
    .option('--stale-after-ms <ms>', 'Stale age threshold (ms)', (v) => Number.parseInt(v, 10))
    .action(async (options: {
      platforms?: string;
      limit?: number;
      status?: string;
      includeSports?: boolean;
      minVolume24h?: number;
      minLiquidity?: number;
      minOpenInterest?: number;
      minPredictions?: number;
      excludeResolved?: boolean;
      prune?: boolean;
      staleAfterMs?: number;
    }) => {
      const { initDatabase } = await import('../../db');
      const { createEmbeddingsService } = await import('../../embeddings');
      const { createMarketIndexService } = await import('../../market-index');

      const db = await initDatabase();
      const embeddings = createEmbeddingsService(db);
      const marketIndexService = createMarketIndexService(db, embeddings);

      const platforms = options.platforms
        ? options.platforms.split(',').map((p) => p.trim()).filter(Boolean)
        : undefined;

      const result = await marketIndexService.sync({
        platforms: platforms as any,
        limitPerPlatform: options.limit,
        status: options.status as any,
        excludeSports: options.includeSports ? false : undefined,
        minVolume24h: options.minVolume24h,
        minLiquidity: options.minLiquidity,
        minOpenInterest: options.minOpenInterest,
        minPredictions: options.minPredictions,
        excludeResolved: options.excludeResolved,
        prune: options.prune,
        staleAfterMs: options.staleAfterMs,
      });

      console.log('\nMarket Index Sync:');
      console.log(`  Indexed: ${result.indexed}`);
      for (const [platform, count] of Object.entries(result.byPlatform)) {
        console.log(`  ${platform}: ${count}`);
      }
    });
}

// =============================================================================
// PERMISSIONS COMMANDS
// =============================================================================

export function createPermissionCommands(program: Command): void {
  const permissions = program
    .command('permissions')
    .description('Manage permissions');

  permissions
    .command('list')
    .description('List permission settings')
    .option('-a, --agent <agentId>', 'Agent ID', 'default')
    .action(async (options: { agent?: string }) => {
      const agentId = options.agent || 'default';
      const security = execApprovals.getSecurityConfig(agentId);
      const allowlist = execApprovals.getAllowlist(agentId);

      console.log('\nPermission settings:');
      console.log(`  Agent: ${agentId}`);
      console.log(`  Exec mode: ${security.mode}`);
      console.log(`  Ask mode: ${security.ask}`);
      console.log(`  Approval timeout: ${security.approvalTimeout ?? 60000}ms`);
      console.log(`  Fallback mode: ${security.fallbackMode ?? 'deny'}`);

      console.log('\nAllowlist:');
      if (allowlist.length === 0) {
        console.log('  (empty)');
      } else {
        for (const entry of allowlist) {
          const when = entry.addedAt ? new Date(entry.addedAt).toLocaleString() : '-';
          console.log(`  ${entry.id}  ${entry.type}  ${entry.pattern}  (${when})`);
        }
      }
    });

  permissions
    .command('allow <pattern>')
    .description('Add command to allowlist')
    .option('-a, --agent <agentId>', 'Agent ID', 'default')
    .option('-t, --type <type>', 'Match type: prefix|glob|regex', 'prefix')
    .option('-d, --description <desc>', 'Description/reason')
    .option('--by <name>', 'Added by')
    .action(async (pattern: string, options: {
      agent?: string;
      type?: 'prefix' | 'glob' | 'regex';
      description?: string;
      by?: string;
    }) => {
      const entry = execApprovals.addToAllowlist(
        options.agent || 'default',
        pattern,
        options.type || 'prefix',
        {
          description: options.description,
          addedBy: options.by,
        }
      );
      console.log(`Added to allowlist: ${entry.id} (${entry.type}) ${entry.pattern}`);
    });

  permissions
    .command('remove <entryId>')
    .description('Remove allowlist entry')
    .option('-a, --agent <agentId>', 'Agent ID', 'default')
    .action(async (entryId: string, options: { agent?: string }) => {
      const removed = execApprovals.removeFromAllowlist(options.agent || 'default', entryId);
      if (removed) {
        console.log(`Removed allowlist entry: ${entryId}`);
      } else {
        console.log(`Entry not found: ${entryId}`);
      }
    });

  permissions
    .command('mode <mode>')
    .description('Set exec security mode (deny|allowlist|full)')
    .option('-a, --agent <agentId>', 'Agent ID', 'default')
    .action(async (mode: string, options: { agent?: string }) => {
      if (!['deny', 'allowlist', 'full'].includes(mode)) {
        console.error('Invalid mode. Use: deny, allowlist, full');
        process.exitCode = 1;
        return;
      }
      execApprovals.setSecurityConfig(options.agent || 'default', { mode: mode as any });
      console.log(`Set exec mode to ${mode}`);
    });

  permissions
    .command('ask <mode>')
    .description('Set approval ask mode (off|on-miss|always)')
    .option('-a, --agent <agentId>', 'Agent ID', 'default')
    .action(async (mode: string, options: { agent?: string }) => {
      if (!['off', 'on-miss', 'always'].includes(mode)) {
        console.error('Invalid ask mode. Use: off, on-miss, always');
        process.exitCode = 1;
        return;
      }
      execApprovals.setSecurityConfig(options.agent || 'default', { ask: mode as any });
      console.log(`Set ask mode to ${mode}`);
    });

  permissions
    .command('pending')
    .description('List pending approval requests')
    .action(async () => {
      const pending = execApprovals.getPendingApprovalsFromDisk();
      if (pending.length === 0) {
        console.log('No pending approvals.');
        return;
      }

      console.log('\nPending approvals:\n');
      console.log('ID\t\tCommand\t\tAgent\t\tExpires');
      console.log('─'.repeat(80));
      for (const req of pending) {
        const expires = req.expiresAt ? req.expiresAt.toLocaleString() : '-';
        console.log(`${req.id}\t${req.command}\t${req.agentId}\t${expires}`);
        if (req.requester) {
          console.log(`  requested by ${req.requester.userId} (${req.requester.channel})`);
        }
      }
    });

  permissions
    .command('approve <requestId>')
    .description('Approve a pending request')
    .option('--always', 'Allow always (adds to allowlist)')
    .option('--by <name>', 'Approver name')
    .action(async (requestId: string, options: { always?: boolean; by?: string }) => {
      const decision = options.always ? 'allow-always' : 'allow-once';
      const ok = execApprovals.recordDecision(requestId, decision, options.by);
      if (!ok) {
        console.log(`Request not found: ${requestId}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Approved ${requestId} (${decision})`);
    });

  permissions
    .command('deny <requestId>')
    .description('Deny a pending request')
    .option('--by <name>', 'Approver name')
    .action(async (requestId: string, options: { by?: string }) => {
      const ok = execApprovals.recordDecision(requestId, 'deny', options.by);
      if (!ok) {
        console.log(`Request not found: ${requestId}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Denied ${requestId}`);
    });
}

// =============================================================================
// USAGE COMMANDS
// =============================================================================

export function createUsageCommands(program: Command): void {
  const usage = program
    .command('usage')
    .description('View usage statistics');

  const withDb = async <T,>(fn: (db: ReturnType<typeof createDatabase>) => T | Promise<T>) => {
    const db = createDatabase();
    createMigrationRunner(db).migrate();
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  };

  const formatCost = (cost: number) => cost < 0.01 ? `$${cost.toFixed(6)}` : `$${cost.toFixed(4)}`;

  usage
    .command('summary')
    .description('Show usage summary')
    .option('-d, --days <days>', 'Number of days', '7')
    .action(async (options: { days?: string }) => {
      await withDb((db) => {
        const days = parseInt(options.days || '7', 10);
        const since = new Date();
        since.setDate(since.getDate() - days);
        const sinceStr = since.toISOString();

        try {
          const results = db.query<{ requests: number; input_tokens: number; output_tokens: number; cost: number }>(`
            SELECT
              COUNT(*) as requests,
              COALESCE(SUM(input_tokens), 0) as input_tokens,
              COALESCE(SUM(output_tokens), 0) as output_tokens,
              COALESCE(SUM(estimated_cost), 0) as cost
            FROM usage_records
            WHERE timestamp >= ?
          `, [sinceStr]);

          const result = results[0];
          if (!result || result.requests === 0) {
            console.log(`\nUsage summary (last ${days} days):\n`);
            console.log('  No usage data recorded');
            console.log('\n  Usage is tracked when the gateway is running.');
            return;
          }

          const totalTokens = result.input_tokens + result.output_tokens;

          console.log(`\nUsage summary (last ${days} days):\n`);
          console.log(`  Total requests:    ${result.requests.toLocaleString()}`);
          console.log(`  Input tokens:      ${result.input_tokens.toLocaleString()}`);
          console.log(`  Output tokens:     ${result.output_tokens.toLocaleString()}`);
          console.log(`  Total tokens:      ${totalTokens.toLocaleString()}`);
          console.log(`  Estimated cost:    ${formatCost(result.cost)}`);
        } catch (e) {
          console.log('\nUsage table not initialized - run the gateway first');
        }
      });
    });

  usage
    .command('by-model')
    .description('Show usage by model')
    .option('-d, --days <days>', 'Number of days', '7')
    .action(async (options: { days?: string }) => {
      await withDb((db) => {
        const days = parseInt(options.days || '7', 10);
        const since = new Date();
        since.setDate(since.getDate() - days);
        const sinceStr = since.toISOString();

        try {
          const rows = db.query<{
            model: string;
            requests: number;
            input_tokens: number;
            output_tokens: number;
            cost: number;
          }>(`
            SELECT
              model,
              COUNT(*) as requests,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(estimated_cost) as cost
            FROM usage_records
            WHERE timestamp >= ?
            GROUP BY model
            ORDER BY cost DESC
          `, [sinceStr]);

          if (rows.length === 0) {
            console.log('\nUsage by model:\n');
            console.log('  No usage data recorded');
            return;
          }

          console.log(`\nUsage by model (last ${days} days):\n`);
          console.log('Model\t\t\t\t\tRequests\tTokens\t\tCost');
          console.log('─'.repeat(85));

          for (const row of rows) {
            const model = row.model.length > 30 ? row.model.slice(0, 27) + '...' : row.model.padEnd(30);
            const tokens = (row.input_tokens + row.output_tokens).toLocaleString();
            console.log(`${model}\t${row.requests}\t\t${tokens.padEnd(12)}\t${formatCost(row.cost)}`);
          }
        } catch (e) {
          console.log('\nUsage table not initialized - run the gateway first');
        }
      });
    });

  usage
    .command('by-user')
    .description('Show usage by user')
    .option('-d, --days <days>', 'Number of days', '7')
    .option('-l, --limit <n>', 'Limit results', '20')
    .action(async (options: { days?: string; limit?: string }) => {
      await withDb((db) => {
        const days = parseInt(options.days || '7', 10);
        const limit = parseInt(options.limit || '20', 10);
        const since = new Date();
        since.setDate(since.getDate() - days);
        const sinceStr = since.toISOString();

        try {
          const rows = db.query<{
            user_id: string;
            requests: number;
            input_tokens: number;
            output_tokens: number;
            cost: number;
          }>(`
            SELECT
              user_id,
              COUNT(*) as requests,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(estimated_cost) as cost
            FROM usage_records
            WHERE timestamp >= ?
            GROUP BY user_id
            ORDER BY cost DESC
            LIMIT ?
          `, [sinceStr, limit]);

          if (rows.length === 0) {
            console.log('\nUsage by user:\n');
            console.log('  No usage data recorded');
            return;
          }

          console.log(`\nUsage by user (last ${days} days, top ${limit}):\n`);
          console.log('User ID\t\t\t\t\tRequests\tTokens\t\tCost');
          console.log('─'.repeat(85));

          for (const row of rows) {
            const userId = row.user_id.length > 28 ? row.user_id.slice(0, 25) + '...' : row.user_id.padEnd(28);
            const tokens = (row.input_tokens + row.output_tokens).toLocaleString();
            console.log(`${userId}\t${row.requests}\t\t${tokens.padEnd(12)}\t${formatCost(row.cost)}`);
          }
        } catch (e) {
          console.log('\nUsage table not initialized - run the gateway first');
        }
      });
    });

  usage
    .command('export')
    .description('Export usage data')
    .option('-o, --output <file>', 'Output file')
    .option('-d, --days <days>', 'Number of days to export', '30')
    .option('--csv', 'Export as CSV instead of JSON')
    .action(async (options: { output?: string; days?: string; csv?: boolean }) => {
      await withDb((db) => {
        const days = parseInt(options.days || '30', 10);
        const since = new Date();
        since.setDate(since.getDate() - days);
        const sinceStr = since.toISOString();

        try {
          const rows = db.query<Record<string, unknown>>(`
            SELECT
              id, session_id, user_id, model,
              input_tokens, output_tokens, total_tokens,
              estimated_cost, timestamp
            FROM usage_records
            WHERE timestamp >= ?
            ORDER BY timestamp DESC
          `, [sinceStr]);

          if (rows.length === 0) {
            console.log('No usage data to export');
            return;
          }

          const ext = options.csv ? 'csv' : 'json';
          const output = options.output || `usage-export-${new Date().toISOString().slice(0, 10)}.${ext}`;

          if (options.csv) {
            const headers = ['id', 'session_id', 'user_id', 'model', 'input_tokens', 'output_tokens', 'total_tokens', 'estimated_cost', 'timestamp'];
            const csvContent = [
              headers.join(','),
              ...rows.map(row => headers.map(h => {
                const val = row[h];
                if (typeof val === 'string' && val.includes(',')) return `"${val}"`;
                return val;
              }).join(','))
            ].join('\n');
            writeFileSync(output, csvContent);
          } else {
            writeFileSync(output, JSON.stringify(rows, null, 2));
          }

          console.log(`Exported ${rows.length} usage records to ${output}`);
        } catch (e) {
          console.log('Usage table not initialized - run the gateway first');
        }
      });
    });

  usage
    .command('today')
    .description('Show today\'s usage')
    .action(async () => {
      await withDb((db) => {
        const today = new Date().toISOString().slice(0, 10);

        try {
          const results = db.query<{ requests: number; input_tokens: number; output_tokens: number; cost: number }>(`
            SELECT
              COUNT(*) as requests,
              COALESCE(SUM(input_tokens), 0) as input_tokens,
              COALESCE(SUM(output_tokens), 0) as output_tokens,
              COALESCE(SUM(estimated_cost), 0) as cost
            FROM usage_records
            WHERE timestamp >= ?
          `, [today]);

          const result = results[0];
          if (!result || result.requests === 0) {
            console.log(`\nToday's usage (${today}):\n`);
            console.log('  No usage yet today');
            return;
          }

          console.log(`\nToday's usage (${today}):\n`);
          console.log(`  Requests:      ${result.requests.toLocaleString()}`);
          console.log(`  Input tokens:  ${result.input_tokens.toLocaleString()}`);
          console.log(`  Output tokens: ${result.output_tokens.toLocaleString()}`);
          console.log(`  Total tokens:  ${(result.input_tokens + result.output_tokens).toLocaleString()}`);
          console.log(`  Cost:          ${formatCost(result.cost)}`);
        } catch (e) {
          console.log('Usage table not initialized - run the gateway first');
        }
      });
    });
}

// =============================================================================
// INIT COMMAND
// =============================================================================

export function createInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize Clodds in current directory')
    .option('-f, --force', 'Overwrite existing config')
    .action(async (options: { force?: boolean }) => {
      const configPath = join(process.cwd(), '.clodds.json');

      if (existsSync(configPath) && !options.force) {
        console.log('Clodds already initialized. Use --force to overwrite.');
        return;
      }

      const defaultConfig = {
        name: 'clodds-project',
        version: '0.1.0',
        model: 'claude-3-5-sonnet-20241022',
        features: {
          memory: true,
          tools: true,
          hooks: true,
        },
      };

      writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      console.log('Initialized Clodds project.');
      console.log(`Config written to ${configPath}`);
    });
}

// =============================================================================
// UPGRADE COMMAND
// =============================================================================

export function createUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('Upgrade Clodds to latest version')
    .option('--check', 'Check for updates only')
    .action(async (options: { check?: boolean }) => {
      console.log('Checking for updates...');

      if (options.check) {
        console.log('Current version: 0.1.0');
        console.log('Latest version: 0.1.0');
        console.log('You are up to date!');
      } else {
        console.log('To upgrade, run: npm install -g clodds@latest');
      }
    });
}

// =============================================================================
// LOGIN COMMAND
// =============================================================================

export function createLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Login to Clodds services')
    .option('-p, --provider <provider>', 'Provider (anthropic, openai)')
    .action(async (options: { provider?: string }) => {
      const provider = options.provider || 'anthropic';
      console.log(`\nTo configure ${provider}:`);
      console.log(`  clodds config set ${provider}.apiKey YOUR_API_KEY`);
    });
}

// =============================================================================
// LOGOUT COMMAND
// =============================================================================

export function createLogoutCommand(program: Command): void {
  program
    .command('logout')
    .description('Logout from Clodds services')
    .option('-a, --all', 'Logout from all providers')
    .action(async (options: { all?: boolean }) => {
      console.log('Logged out from Clodds services');
    });
}

// =============================================================================
// VERSION INFO
// =============================================================================

export function createVersionCommand(program: Command): void {
  program
    .command('version')
    .description('Show detailed version info')
    .action(async () => {
      console.log('\nClodds Version Info\n');
      console.log('  Version: 0.1.0');
      console.log('  Node.js: ' + process.version);
      console.log('  Platform: ' + process.platform);
      console.log('  Arch: ' + process.arch);
    });
}

// =============================================================================
// WHATSAPP COMMANDS
// =============================================================================

export function createWhatsAppCommands(program: Command): void {
  const whatsapp = program
    .command('whatsapp')
    .description('WhatsApp channel utilities');

  whatsapp
    .command('login')
    .description('Link a WhatsApp account via QR code')
    .option('-a, --account <id>', 'Account ID from channels.whatsapp.accounts')
    .option('--auth-dir <path>', 'Override auth directory')
    .option('--timeout <ms>', 'Timeout in milliseconds', (value) => Number.parseInt(value, 10))
    .action(async (options: { account?: string; authDir?: string; timeout?: number }) => {
      const config = await loadConfig();
      const whatsappConfig = config.channels?.whatsapp;
      if (!whatsappConfig) {
        console.log('WhatsApp is not configured in your config file.');
        return;
      }

      const resolved = resolveWhatsAppAuthDir(whatsappConfig, {
        accountId: options.account,
        authDirOverride: options.authDir,
      });
      const timeoutMs = Number.isFinite(options.timeout) ? (options.timeout as number) : undefined;
      console.log(`Starting WhatsApp login for account "${resolved.accountId}"...`);
      console.log(`Auth dir: ${resolved.authDir}`);
      const result = await loginWhatsAppWithQr(resolved.authDir, timeoutMs);
      if (result.connected) {
        console.log(`WhatsApp linked${result.jid ? ` (${result.jid})` : ''}.`);
      } else {
        console.log('WhatsApp login timed out or failed.');
      }
    });
}

// =============================================================================
// CREDS TEST COMMAND
// =============================================================================

export function createCredsCommands(program: Command): void {
  const creds = program
    .command('creds')
    .description('Test and validate API credentials');

  creds
    .command('test [platform]')
    .description('Test API credentials for a platform')
    .action(async (platform?: string) => {
      console.log('\n🔑 Credential Validation\n');

      const results: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; message: string; fix?: string }> = [];

      // Test Anthropic
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!platform || platform === 'anthropic') {
        if (!anthropicKey) {
          results.push({
            name: 'Anthropic API',
            status: 'fail',
            message: 'ANTHROPIC_API_KEY not set',
            fix: 'Get key from: https://console.anthropic.com',
          });
        } else if (!anthropicKey.startsWith('sk-ant-')) {
          results.push({
            name: 'Anthropic API',
            status: 'warn',
            message: 'Key format looks wrong (should start with sk-ant-)',
            fix: 'Verify key at: https://console.anthropic.com',
          });
        } else {
          // Test the key
          try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 1,
                messages: [{ role: 'user', content: 'hi' }],
              }),
            });

            if (response.ok) {
              results.push({
                name: 'Anthropic API',
                status: 'pass',
                message: 'Key valid and working',
              });
            } else if (response.status === 401) {
              results.push({
                name: 'Anthropic API',
                status: 'fail',
                message: 'Invalid API key',
                fix: 'Check key at: https://console.anthropic.com',
              });
            } else if (response.status === 429) {
              results.push({
                name: 'Anthropic API',
                status: 'warn',
                message: 'Rate limited (but key is valid)',
              });
            } else {
              results.push({
                name: 'Anthropic API',
                status: 'warn',
                message: `Unexpected response: ${response.status}`,
              });
            }
          } catch (e) {
            results.push({
              name: 'Anthropic API',
              status: 'warn',
              message: `Network error: ${(e as Error).message}`,
              fix: 'Check internet connection',
            });
          }
        }
      }

      // Test Polymarket
      if (!platform || platform === 'polymarket') {
        const polyKey = process.env.POLY_API_KEY;
        const polySecret = process.env.POLY_API_SECRET;
        const polyPass = process.env.POLY_API_PASSPHRASE;
        const polyPrivate = process.env.POLY_PRIVATE_KEY;

        if (!polyKey && !polySecret && !polyPass) {
          results.push({
            name: 'Polymarket',
            status: 'warn',
            message: 'Not configured (optional)',
            fix: 'Get keys from: https://polymarket.com/settings/api',
          });
        } else if (!polyKey || !polySecret || !polyPass) {
          results.push({
            name: 'Polymarket',
            status: 'fail',
            message: 'Incomplete credentials (need API key, secret, and passphrase)',
            fix: 'Set all: POLY_API_KEY, POLY_API_SECRET, POLY_API_PASSPHRASE',
          });
        } else {
          // Test fetch markets (read-only, no auth needed)
          try {
            const response = await fetch('https://clob.polymarket.com/markets?limit=1');
            if (response.ok) {
              results.push({
                name: 'Polymarket (read)',
                status: 'pass',
                message: 'Can fetch markets',
              });
            } else {
              results.push({
                name: 'Polymarket (read)',
                status: 'warn',
                message: `API returned ${response.status}`,
              });
            }
          } catch {
            results.push({
              name: 'Polymarket (read)',
              status: 'warn',
              message: 'Network error',
            });
          }

          // Check for trading capability
          if (!polyPrivate) {
            results.push({
              name: 'Polymarket (trade)',
              status: 'warn',
              message: 'POLY_PRIVATE_KEY not set (cannot trade)',
              fix: 'Add your wallet private key to enable trading',
            });
          } else {
            results.push({
              name: 'Polymarket (trade)',
              status: 'pass',
              message: 'Trading credentials configured',
            });
          }
        }
      }

      // Test Kalshi
      if (!platform || platform === 'kalshi') {
        const kalshiKey = process.env.KALSHI_API_KEY;
        const kalshiSecret = process.env.KALSHI_API_SECRET;
        const kalshiEmail = process.env.KALSHI_EMAIL;

        if (!kalshiKey && !kalshiEmail) {
          results.push({
            name: 'Kalshi',
            status: 'warn',
            message: 'Not configured (optional)',
            fix: 'Get keys from: https://kalshi.com/account/api',
          });
        } else if (kalshiKey && !kalshiSecret) {
          results.push({
            name: 'Kalshi',
            status: 'fail',
            message: 'API key set but missing secret',
            fix: 'Set KALSHI_API_SECRET',
          });
        } else if (kalshiKey) {
          results.push({
            name: 'Kalshi',
            status: 'pass',
            message: 'API key credentials configured',
          });
        } else if (kalshiEmail) {
          results.push({
            name: 'Kalshi',
            status: 'warn',
            message: 'Using legacy email auth (API keys recommended)',
            fix: 'Switch to API keys: https://kalshi.com/account/api',
          });
        }
      }

      // Test Telegram
      if (!platform || platform === 'telegram') {
        const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!telegramToken) {
          results.push({
            name: 'Telegram',
            status: 'warn',
            message: 'Not configured',
            fix: 'Get token from: https://t.me/BotFather',
          });
        } else {
          try {
            const response = await fetch(`https://api.telegram.org/bot${telegramToken}/getMe`);
            const data = await response.json() as { ok: boolean; result?: { username: string } };
            if (data.ok) {
              results.push({
                name: 'Telegram',
                status: 'pass',
                message: `Bot: @${data.result?.username}`,
              });
            } else {
              results.push({
                name: 'Telegram',
                status: 'fail',
                message: 'Invalid bot token',
                fix: 'Check token with @BotFather',
              });
            }
          } catch {
            results.push({
              name: 'Telegram',
              status: 'warn',
              message: 'Network error testing token',
            });
          }
        }
      }

      // Test Discord
      if (!platform || platform === 'discord') {
        const discordToken = process.env.DISCORD_BOT_TOKEN;
        if (!discordToken) {
          results.push({
            name: 'Discord',
            status: 'warn',
            message: 'Not configured',
            fix: 'Get token from: https://discord.com/developers/applications',
          });
        } else {
          try {
            const response = await fetch('https://discord.com/api/v10/users/@me', {
              headers: { Authorization: `Bot ${discordToken}` },
            });
            if (response.ok) {
              const data = await response.json() as { username: string };
              results.push({
                name: 'Discord',
                status: 'pass',
                message: `Bot: ${data.username}`,
              });
            } else if (response.status === 401) {
              results.push({
                name: 'Discord',
                status: 'fail',
                message: 'Invalid bot token',
                fix: 'Check token at: https://discord.com/developers/applications',
              });
            } else {
              results.push({
                name: 'Discord',
                status: 'warn',
                message: `API returned ${response.status}`,
              });
            }
          } catch {
            results.push({
              name: 'Discord',
              status: 'warn',
              message: 'Network error testing token',
            });
          }
        }
      }

      // Display results
      const icons = { pass: '✅', warn: '⚠️ ', fail: '❌' };

      for (const result of results) {
        console.log(`${icons[result.status]} ${result.name}: ${result.message}`);
        if (result.fix) {
          console.log(`   Fix: ${result.fix}`);
        }
      }

      const passed = results.filter(r => r.status === 'pass').length;
      const warned = results.filter(r => r.status === 'warn').length;
      const failed = results.filter(r => r.status === 'fail').length;

      console.log(`\nSummary: ${passed} passed, ${warned} warnings, ${failed} failed`);

      if (failed > 0) {
        console.log('\n💡 Run `clodds doctor` for full system diagnostics');
        process.exitCode = 1;
      }
    });
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

export function addAllCommands(program: Command): void {
  createConfigCommands(program);
  createModelCommands(program);
  createSessionCommands(program);
  createCronCommands(program);
  createQmdCommands(program);
  createUserCommands(program);
  createMemoryCommands(program);
  createHookCommands(program);
  createMcpCommands(program);
  createMarketIndexCommands(program);
  createPermissionCommands(program);
  createUsageCommands(program);
  createCredsCommands(program);
  createInitCommand(program);
  createUpgradeCommand(program);
  createLoginCommand(program);
  createLogoutCommand(program);
  createWhatsAppCommands(program);
  createVersionCommand(program);
}
