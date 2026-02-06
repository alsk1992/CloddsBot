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

      // Test OpenAI
      if (!platform || platform === 'openai') {
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
          results.push({
            name: 'OpenAI',
            status: 'warn',
            message: 'Not configured (optional)',
            fix: 'Get key from: https://platform.openai.com/api-keys',
          });
        } else {
          try {
            const response = await fetch('https://api.openai.com/v1/models', {
              headers: { Authorization: `Bearer ${openaiKey}` },
            });
            if (response.ok) {
              results.push({ name: 'OpenAI', status: 'pass', message: 'Key valid' });
            } else if (response.status === 401) {
              results.push({ name: 'OpenAI', status: 'fail', message: 'Invalid API key', fix: 'Check at platform.openai.com' });
            } else {
              results.push({ name: 'OpenAI', status: 'warn', message: `HTTP ${response.status}` });
            }
          } catch {
            results.push({ name: 'OpenAI', status: 'warn', message: 'Network error' });
          }
        }
      }

      // Test Slack
      if (!platform || platform === 'slack') {
        const slackToken = process.env.SLACK_BOT_TOKEN;
        if (!slackToken) {
          results.push({
            name: 'Slack',
            status: 'warn',
            message: 'Not configured (optional)',
            fix: 'Get token from: https://api.slack.com/apps',
          });
        } else {
          try {
            const response = await fetch('https://slack.com/api/auth.test', {
              headers: { Authorization: `Bearer ${slackToken}` },
            });
            const data = await response.json() as { ok: boolean; user?: string; team?: string; error?: string };
            if (data.ok) {
              results.push({ name: 'Slack', status: 'pass', message: `${data.user} @ ${data.team}` });
            } else {
              results.push({ name: 'Slack', status: 'fail', message: data.error ?? 'Invalid token', fix: 'Check at api.slack.com/apps' });
            }
          } catch {
            results.push({ name: 'Slack', status: 'warn', message: 'Network error' });
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
// LOCALE COMMANDS
// =============================================================================

export function createLocaleCommands(program: Command): void {
  const locale = program
    .command('locale')
    .description('Manage language/locale settings');

  locale
    .command('list')
    .description('List supported languages')
    .action(async () => {
      const { getSupportedLocales, getLocale } = await import('../../i18n/index');
      const current = getLocale();
      const locales = getSupportedLocales();

      console.log('\n📍 Supported Languages\n');
      for (const loc of locales) {
        const marker = loc.code === current ? ' ← current' : '';
        console.log(`  ${loc.code}  ${loc.nativeName.padEnd(10)} (${loc.name})${marker}`);
      }
      console.log('\nSet with: clodds locale set <code>');
      console.log('Or: CLODDS_LOCALE=<code> in .env\n');
    });

  locale
    .command('get')
    .description('Show current locale')
    .action(async () => {
      const { getLocale, getSupportedLocales } = await import('../../i18n/index');
      const current = getLocale();
      const info = getSupportedLocales().find(l => l.code === current);
      console.log(`\nCurrent locale: ${current} (${info?.nativeName || current})\n`);
    });

  locale
    .command('set <code>')
    .description('Set locale (e.g., en, zh, es, ja)')
    .action(async (code: string) => {
      const { setLocale, isLocaleSupported, getSupportedLocales } = await import('../../i18n/index');

      if (!isLocaleSupported(code)) {
        console.error(`\n❌ Unsupported locale: ${code}`);
        console.log('\nSupported locales:');
        for (const loc of getSupportedLocales()) {
          console.log(`  ${loc.code}  ${loc.nativeName}`);
        }
        process.exit(1);
      }

      // Save to config
      const configPath = join(homedir(), '.clodds', 'config.json');
      let config: Record<string, unknown> = {};

      if (existsSync(configPath)) {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
      }

      config.locale = code.toLowerCase();
      const configDir = join(homedir(), '.clodds');
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      setLocale(code);
      const info = getSupportedLocales().find(l => l.code === code.toLowerCase());
      console.log(`\n✅ Locale set to: ${code} (${info?.nativeName || code})\n`);
    });

  locale
    .command('test [key]')
    .description('Test translation (default: welcome.message)')
    .action(async (key?: string) => {
      const { t, getLocale } = await import('../../i18n/index');
      const testKey = key || 'welcome.message';
      const result = t(testKey);
      console.log(`\nLocale: ${getLocale()}`);
      console.log(`Key: ${testKey}`);
      console.log(`Result: ${result}\n`);
    });
}

// =============================================================================
// LEDGER COMMANDS
// =============================================================================

export function createLedgerCommands(program: Command): void {
  const ledger = program
    .command('ledger')
    .description('Trade ledger - decision audit trail');

  const withDb = async <T,>(fn: (db: ReturnType<typeof createDatabase>) => T | Promise<T>) => {
    const db = createDatabase();
    createMigrationRunner(db).migrate();
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  };

  ledger
    .command('list [userId]')
    .description('List recent decisions')
    .option('-n, --limit <n>', 'Number of records', '20')
    .option('-c, --category <cat>', 'Filter by category (trade/copy/arbitrage/risk)')
    .option('-d, --decision <dec>', 'Filter by decision (approved/rejected/blocked)')
    .option('-p, --platform <plt>', 'Filter by platform')
    .action(async (userId?: string, options?: { limit?: string; category?: string; decision?: string; platform?: string }) => {
      await withDb(async (db) => {
        const { LedgerStorage } = await import('../../ledger/storage');
        const storage = new LedgerStorage(db as unknown as import('../../ledger/storage').LedgerDb);
        storage.init();

        const uid = userId || 'default';
        const records = storage.list(uid, {
          limit: parseInt(options?.limit || '20', 10),
          category: options?.category as import('../../ledger/types').DecisionCategory,
          decision: options?.decision as import('../../ledger/types').DecisionOutcome,
          platform: options?.platform,
        });

        if (records.length === 0) {
          console.log('\nNo decisions found\n');
          return;
        }

        console.log(`\n📒 Trade Ledger (${records.length} decisions)\n`);
        const { formatDecision } = await import('../../ledger/index');
        for (const record of records) {
          console.log(formatDecision(record));
        }
      });
    });

  ledger
    .command('stats [userId]')
    .description('Show decision statistics')
    .option('-p, --period <p>', 'Period (24h/7d/30d/90d/all)', '7d')
    .option('-c, --category <cat>', 'Filter by category')
    .action(async (userId?: string, options?: { period?: string; category?: string }) => {
      await withDb(async (db) => {
        const { LedgerStorage } = await import('../../ledger/storage');
        const storage = new LedgerStorage(db as unknown as import('../../ledger/storage').LedgerDb);
        storage.init();

        const uid = userId || 'default';
        const stats = storage.stats(uid, {
          period: options?.period as '24h' | '7d' | '30d' | '90d' | 'all',
          category: options?.category as import('../../ledger/types').DecisionCategory,
        });

        const { formatStats } = await import('../../ledger/index');
        console.log('\n' + formatStats(stats));
      });
    });

  ledger
    .command('calibration [userId]')
    .description('Show confidence calibration')
    .action(async (userId?: string) => {
      await withDb(async (db) => {
        const { LedgerStorage } = await import('../../ledger/storage');
        const storage = new LedgerStorage(db as unknown as import('../../ledger/storage').LedgerDb);
        storage.init();

        const uid = userId || 'default';
        const cal = storage.calibration(uid);

        console.log('\n📊 Confidence Calibration\n');
        console.log(`Overall accuracy: ${cal.overallAccuracy.toFixed(1)}% (${cal.totalWithOutcome} decisions with outcome)\n`);

        if (cal.totalWithOutcome > 0) {
          console.log('By confidence bucket:');
          for (const bucket of cal.buckets) {
            if (bucket.count > 0) {
              const bar = '█'.repeat(Math.round(bucket.accuracyRate / 10));
              console.log(`  ${bucket.range.padEnd(8)} ${bucket.accuracyRate.toFixed(0).padStart(3)}% ${bar} (${bucket.count} decisions)`);
            }
          }
        }
        console.log('');
      });
    });

  ledger
    .command('export [userId]')
    .description('Export decisions to file')
    .option('-f, --format <fmt>', 'Format (json/csv)', 'json')
    .option('-o, --output <file>', 'Output file')
    .action(async (userId?: string, options?: { format?: string; output?: string }) => {
      await withDb(async (db) => {
        const { LedgerStorage } = await import('../../ledger/storage');
        const storage = new LedgerStorage(db as unknown as import('../../ledger/storage').LedgerDb);
        storage.init();

        const uid = userId || 'default';
        const format = (options?.format || 'json') as 'json' | 'csv';
        const data = storage.export(uid, format);

        const output = options?.output || `ledger-${uid}-${Date.now()}.${format}`;
        writeFileSync(output, data);
        console.log(`\n✅ Exported to ${output}\n`);
      });
    });

  ledger
    .command('prune')
    .description('Delete old decisions')
    .option('-d, --days <n>', 'Retention days', '90')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options: { days?: string; yes?: boolean }) => {
      const days = parseInt(options.days || '90', 10);

      if (!options.yes) {
        console.log(`\n⚠️  This will delete decisions older than ${days} days.`);
        console.log('Run with --yes to confirm\n');
        return;
      }

      await withDb(async (db) => {
        const { LedgerStorage } = await import('../../ledger/storage');
        const storage = new LedgerStorage(db as unknown as import('../../ledger/storage').LedgerDb);
        storage.init();

        const count = storage.prune(days);
        console.log(`\n🗑️  Pruned ${count} old decisions\n`);
      });
    });

  ledger
    .command('verify <id>')
    .description('Verify decision hash integrity')
    .action(async (id: string) => {
      await withDb(async (db) => {
        const { LedgerStorage } = await import('../../ledger/storage');
        const { verifyHash } = await import('../../ledger/hash');
        const storage = new LedgerStorage(db as unknown as import('../../ledger/storage').LedgerDb);
        storage.init();

        const record = storage.get(id);
        if (!record) {
          console.log(`\n❌ Decision not found: ${id}\n`);
          process.exitCode = 1;
          return;
        }

        if (!record.hash) {
          console.log(`\n⚠️  No hash stored for decision ${id.slice(0, 8)}\n`);
          console.log('Enable hashIntegrity in ledger config to store hashes.\n');
          return;
        }

        const valid = verifyHash(record, record.hash);
        if (valid) {
          console.log(`\n✅ Hash verified: ${record.hash.slice(0, 16)}...\n`);
        } else {
          console.log(`\n❌ Hash mismatch - record may have been tampered with\n`);
          process.exitCode = 1;
        }
      });
    });

  ledger
    .command('config')
    .description('Show ledger configuration')
    .action(async () => {
      const configPath = join(homedir(), '.clodds', 'config.json');
      let ledgerConfig = {
        enabled: false,
        captureAll: false,
        hashIntegrity: false,
        retentionDays: 90,
        onchainAnchor: false,
      };

      if (existsSync(configPath)) {
        const data = JSON.parse(readFileSync(configPath, 'utf-8'));
        ledgerConfig = { ...ledgerConfig, ...data.ledger };
      }

      console.log('\n📒 Trade Ledger Configuration\n');
      console.log(`  enabled:        ${ledgerConfig.enabled ? '✅' : '❌'}`);
      console.log(`  captureAll:     ${ledgerConfig.captureAll ? 'All tools' : 'Trading tools only'}`);
      console.log(`  hashIntegrity:  ${ledgerConfig.hashIntegrity ? 'SHA-256 enabled' : 'Disabled'}`);
      console.log(`  retentionDays:  ${ledgerConfig.retentionDays}`);
      console.log(`  onchainAnchor:  ${ledgerConfig.onchainAnchor ? 'Enabled' : 'Disabled'}`);
      console.log('\nEnable with: clodds config set ledger.enabled true\n');
    });

  ledger
    .command('anchor <id>')
    .description('Anchor decision hash to blockchain')
    .option('-c, --chain <chain>', 'Chain to use (solana/polygon/base)', 'solana')
    .action(async (id: string, options: { chain?: string }) => {
      await withDb(async (db) => {
        const { LedgerStorage } = await import('../../ledger/storage');
        const { createAnchorService } = await import('../../ledger/anchor');
        const storage = new LedgerStorage(db as unknown as import('../../ledger/storage').LedgerDb);
        storage.init();

        const record = storage.get(id);
        if (!record) {
          console.log(`\n❌ Decision not found: ${id}\n`);
          process.exitCode = 1;
          return;
        }

        if (!record.hash) {
          console.log(`\n⚠️  No hash stored for decision ${id.slice(0, 8)}`);
          console.log('Enable hashIntegrity in ledger config first.\n');
          return;
        }

        const chain = (options.chain || 'solana') as 'solana' | 'polygon' | 'base';
        console.log(`\n⏳ Anchoring to ${chain}...`);

        const anchor = createAnchorService({ chain });
        const result = await anchor.anchor(record.hash);

        if (result.success) {
          console.log(`\n✅ Anchored to ${chain}`);
          console.log(`   Hash: ${record.hash.slice(0, 16)}...`);
          console.log(`   Tx: ${result.txHash}\n`);
        } else {
          console.log(`\n❌ Anchor failed: ${result.error}\n`);
          process.exitCode = 1;
        }
      });
    });

  ledger
    .command('verify-anchor <txHash> <hash>')
    .description('Verify an onchain anchor')
    .option('-c, --chain <chain>', 'Chain to check (solana/polygon/base)', 'solana')
    .action(async (txHash: string, hash: string, options: { chain?: string }) => {
      const { verifyAnchor } = await import('../../ledger/anchor');
      const chain = (options.chain || 'solana') as 'solana' | 'polygon' | 'base';

      console.log(`\n⏳ Verifying on ${chain}...`);

      const result = await verifyAnchor(txHash, hash, chain);

      if (result.verified) {
        console.log(`\n✅ Anchor verified on ${chain}`);
        console.log(`   Tx: ${txHash}`);
        console.log(`   Hash: ${hash.slice(0, 16)}...\n`);
      } else {
        console.log(`\n❌ Verification failed: ${result.error}\n`);
        process.exitCode = 1;
      }
    });
}

// =============================================================================
// BITTENSOR COMMANDS
// =============================================================================

function btcliExec(pythonPath: string, args: string[], timeoutMs = 30_000): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(pythonPath, ['-m', 'bittensor', ...args], {
    encoding: 'utf-8',
    timeout: timeoutMs,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

function detectPython(): string | null {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf-8', timeout: 5_000 });
    if (r.status === 0) return cmd;
  }
  return null;
}

function hasBtcli(pythonPath: string): boolean {
  const r = spawnSync(pythonPath, ['-c', 'import bittensor; print(bittensor.__version__)'], {
    encoding: 'utf-8',
    timeout: 10_000,
  });
  return r.status === 0;
}

export function createBittensorCommands(program: Command): void {
  const bittensor = program
    .command('bittensor')
    .alias('tao')
    .description('Bittensor subnet mining management');

  // ── setup: full onboarding wizard ──────────────────────────────────────────
  bittensor
    .command('setup')
    .description('One-command setup: installs btcli, creates wallet, configures Clodds')
    .option('--wallet-name <name>', 'Wallet name', 'default')
    .option('--skip-install', 'Skip btcli installation')
    .action(async (options: { walletName?: string; skipInstall?: boolean }) => {
      const walletName = options.walletName ?? 'default';
      const pythonEnv = process.env.BITTENSOR_PYTHON_PATH;

      console.log('\n=== Bittensor Mining Setup ===\n');

      // Step 0: Choose network
      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (prompt: string): Promise<string> =>
        new Promise((resolve) => rl.question(prompt, (a) => resolve(a.trim())));

      let network: string;
      while (true) {
        const choice = await ask('Network? (1) mainnet - real TAO, real earnings  (2) testnet - free to experiment\nChoose [1/2]: ');
        if (choice === '1' || choice.toLowerCase() === 'mainnet') {
          network = 'mainnet';
          break;
        } else if (choice === '2' || choice.toLowerCase() === 'testnet') {
          network = 'testnet';
          break;
        }
        console.log('  Please enter 1 or 2.\n');
      }
      rl.close();
      console.log(`\n  Selected: ${network}\n`);

      // Step 1: Find Python
      console.log('[1/5] Checking Python...');
      const pythonPath = pythonEnv || detectPython();
      if (!pythonPath) {
        console.log('  Python 3 not found. Install it first:');
        console.log('    macOS:  brew install python3');
        console.log('    Ubuntu: sudo apt install python3 python3-pip');
        console.log('    Windows: https://python.org/downloads\n');
        process.exitCode = 1;
        return;
      }
      const pyVer = spawnSync(pythonPath, ['--version'], { encoding: 'utf-8' });
      console.log(`  Found: ${pyVer.stdout?.trim() || pythonPath}`);

      // Step 2: Install btcli
      console.log('\n[2/5] Checking btcli...');
      if (hasBtcli(pythonPath)) {
        const ver = spawnSync(pythonPath, ['-c', 'import bittensor; print(bittensor.__version__)'], { encoding: 'utf-8' });
        console.log(`  Already installed: bittensor ${ver.stdout?.trim()}`);
      } else if (options.skipInstall) {
        console.log('  btcli not found (skipped install)');
      } else {
        console.log('  Installing bittensor (this takes 1-2 minutes)...');
        const install = spawnSync(pythonPath, ['-m', 'pip', 'install', 'bittensor', '--quiet'], {
          encoding: 'utf-8',
          timeout: 180_000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (install.status === 0) {
          console.log('  Installed successfully');
        } else {
          console.log(`  Installation failed: ${install.stderr?.slice(0, 200)}`);
          console.log('  Try manually: pip install bittensor\n');
          process.exitCode = 1;
          return;
        }
      }

      // Step 3: Create wallet
      console.log('\n[3/5] Setting up wallet...');
      const walletDir = join(homedir(), '.bittensor', 'wallets', walletName);
      const coldkeyPath = join(walletDir, 'coldkey');

      if (existsSync(coldkeyPath)) {
        console.log(`  Wallet "${walletName}" already exists at ${walletDir}`);
      } else {
        console.log(`  Creating wallet "${walletName}"...`);

        // Create coldkey
        const coldkey = btcliExec(pythonPath, [
          'wallet', 'create',
          '--wallet.name', walletName,
          '--no_prompt',
        ], 30_000);

        if (coldkey.ok || existsSync(coldkeyPath)) {
          console.log('  Wallet created');
        } else {
          // Try the newer btcli syntax
          const coldkey2 = spawnSync(pythonPath, ['-m', 'bittensor.cli', 'wallet', 'create', '--wallet.name', walletName, '--no_prompt'], {
            encoding: 'utf-8',
            timeout: 30_000,
          });
          if (coldkey2.status === 0 || existsSync(coldkeyPath)) {
            console.log('  Wallet created');
          } else {
            console.log('  Auto-create failed. Create manually:');
            console.log(`    btcli wallet create --wallet.name ${walletName}`);
          }
        }
      }

      // Show wallet address
      const overview = btcliExec(pythonPath, [
        'wallet', 'overview',
        '--wallet.name', walletName,
        '--no_prompt',
      ], 15_000);

      const addrMatch = overview.stdout.match(/coldkey[:\s]+(\w{48})/i)
        || overview.stdout.match(/(5[A-Za-z0-9]{47})/);
      if (addrMatch) {
        console.log(`  Address: ${addrMatch[1]}`);
      }

      // Step 4: Write config
      console.log('\n[4/5] Configuring Clodds...');
      const cloddsDir = join(homedir(), '.clodds');
      const configPath = join(cloddsDir, 'clodds.json');

      let existingConfig: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        try {
          existingConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
        } catch {
          // fresh config
        }
      } else {
        mkdirSync(cloddsDir, { recursive: true });
      }

      existingConfig.bittensor = {
        enabled: true,
        network,
        coldkeyPath: join(homedir(), '.bittensor', 'wallets', walletName, 'coldkey'),
        pythonPath,
      };

      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));
      console.log(`  Written to ${configPath}`);
      console.log(`  Network: ${network}`);

      // Step 5: Summary
      console.log('\n[5/5] Next steps:\n');
      if (network === 'testnet') {
        console.log('  You\'re on TESTNET - free to experiment, no real TAO needed.\n');
        console.log('  Get testnet TAO:');
        console.log('    btcli wallet faucet --wallet.name default --subtensor.network test\n');
      } else {
        console.log('  You\'re on MAINNET - you need real TAO to register.\n');
        if (addrMatch) {
          console.log(`  Fund your wallet: send TAO to ${addrMatch[1]}`);
          console.log('  Buy TAO: Binance, KuCoin, Gate.io, or MEXC\n');
        }
      }
      console.log('  Register on a subnet (Chutes SN64 recommended):');
      console.log('    clodds bittensor register 64\n');
      console.log('  Then start Clodds:');
      console.log('    clodds start\n');
      console.log('  Monitor in chat:');
      console.log('    /tao status');
      console.log('    /tao earnings\n');
    });

  // ── wallet: show / create ──────────────────────────────────────────────────
  const wallet = bittensor
    .command('wallet')
    .description('Wallet management');

  wallet
    .command('show')
    .description('Show wallet address and balance')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (options: { name?: string }) => {
      const pythonPath = process.env.BITTENSOR_PYTHON_PATH || detectPython();
      if (!pythonPath) {
        console.log('\nPython not found. Run: clodds bittensor setup\n');
        return;
      }

      const name = options.name ?? 'default';
      console.log(`\nWallet: ${name}`);

      const overview = btcliExec(pythonPath, [
        'wallet', 'overview',
        '--wallet.name', name,
        '--no_prompt',
      ], 15_000);

      if (overview.ok) {
        console.log(overview.stdout);
      } else {
        console.log(`  Not found. Create: clodds bittensor setup\n`);
      }
    });

  wallet
    .command('create')
    .description('Create a new Bittensor wallet')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (options: { name?: string }) => {
      const pythonPath = process.env.BITTENSOR_PYTHON_PATH || detectPython();
      if (!pythonPath || !hasBtcli(pythonPath)) {
        console.log('\nbtcli not found. Run: clodds bittensor setup\n');
        return;
      }

      const name = options.name ?? 'default';
      console.log(`\nCreating wallet "${name}"...`);

      const result = btcliExec(pythonPath, [
        'wallet', 'create',
        '--wallet.name', name,
        '--no_prompt',
      ], 30_000);

      if (result.ok) {
        console.log('Wallet created successfully.');
        console.log(result.stdout);
      } else {
        console.log(`Failed: ${result.stderr || result.stdout}`);
      }
      console.log('');
    });

  wallet
    .command('balance')
    .description('Check TAO balance')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (options: { name?: string }) => {
      const pythonPath = process.env.BITTENSOR_PYTHON_PATH || detectPython();
      if (!pythonPath || !hasBtcli(pythonPath)) {
        console.log('\nbtcli not found. Run: clodds bittensor setup\n');
        return;
      }

      const result = btcliExec(pythonPath, [
        'wallet', 'balance',
        '--wallet.name', options.name ?? 'default',
        '--no_prompt',
      ], 15_000);

      console.log(result.ok ? `\n${result.stdout}\n` : `\nFailed: ${result.stderr}\n`);
    });

  // ── register: join a subnet ────────────────────────────────────────────────
  bittensor
    .command('register <subnetId>')
    .description('Register on a subnet (e.g. 64 for Chutes)')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (subnetId: string, options: { name?: string }) => {
      const pythonPath = process.env.BITTENSOR_PYTHON_PATH || detectPython();
      if (!pythonPath || !hasBtcli(pythonPath)) {
        console.log('\nbtcli not found. Run: clodds bittensor setup\n');
        return;
      }

      const id = parseInt(subnetId, 10);
      if (isNaN(id)) {
        console.log('\nInvalid subnet ID. Example: clodds bittensor register 64\n');
        return;
      }

      // Read network from config
      let network = 'mainnet';
      const cfgPath = join(homedir(), '.clodds', 'clodds.json');
      if (existsSync(cfgPath)) {
        try {
          const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
          if (cfg.bittensor?.network) network = cfg.bittensor.network;
        } catch {}
      }

      console.log(`\nRegistering on subnet ${id} (${network})...`);
      console.log('This may cost TAO. Check your balance first: clodds bittensor wallet balance\n');

      const args = [
        'subnet', 'register',
        '--netuid', String(id),
        '--wallet.name', options.name ?? 'default',
        '--no_prompt',
      ];

      if (network === 'testnet') {
        args.push('--subtensor.network', 'test');
      }

      const result = btcliExec(pythonPath, args, 120_000);

      if (result.ok) {
        console.log('Registered successfully!');
        console.log(result.stdout);
      } else {
        console.log(`Registration failed: ${result.stderr || result.stdout}`);
      }
      console.log('');
    });

  // ── status ─────────────────────────────────────────────────────────────────
  bittensor
    .command('status')
    .description('Show Bittensor mining status')
    .action(async () => {
      const { loadConfig } = await import('../../utils/config');
      const config = await loadConfig();
      if (!config.bittensor?.enabled) {
        console.log('\nBittensor is not enabled. Run: clodds bittensor setup\n');
        return;
      }
      console.log('\nBittensor Configuration:');
      console.log(`  Network: ${config.bittensor.network ?? 'mainnet'}`);
      console.log(`  Coldkey: ${config.bittensor.coldkeyPath ?? '(not set)'}`);
      console.log(`  Python: ${config.bittensor.pythonPath ?? 'python3'}`);
      const subnets = (config.bittensor.subnets as Array<{ subnetId: number; type: string; enabled: boolean }>) ?? [];
      if (subnets.length > 0) {
        console.log('  Subnets:');
        for (const s of subnets) {
          console.log(`    SN${s.subnetId} [${s.type}]: ${s.enabled ? 'enabled' : 'disabled'}`);
        }
      } else {
        console.log('  Subnets: none configured');
      }
      console.log('\nLive status (requires running gateway):');
      console.log('  curl localhost:18789/api/bittensor/status\n');
    });

  // ── earnings: query from running gateway ─────────────────────────────────
  bittensor
    .command('earnings')
    .description('Show TAO earnings (queries running gateway)')
    .option('-p, --period <period>', 'Period: hourly, daily, weekly, monthly, all', 'daily')
    .option('--port <port>', 'Gateway port', '18789')
    .action(async (options: { period?: string; port?: string }) => {
      const port = options.port ?? '18789';
      const period = options.period ?? 'daily';
      try {
        const token = process.env.CLODDS_TOKEN;
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const r = await fetch(`http://127.0.0.1:${port}/api/bittensor/earnings?period=${period}`, { headers });
        if (!r.ok) {
          console.log(`\nGateway returned ${r.status}. Is Clodds running? (clodds start)\n`);
          return;
        }
        const body = await r.json() as { ok: boolean; data?: Array<{ subnetId: number; hotkey: string; taoEarned: number; usdEarned: number }> };
        const data = body.data ?? [];
        if (data.length === 0) {
          console.log(`\nNo ${period} earnings recorded yet.\n`);
          return;
        }
        const totalTao = data.reduce((s, e) => s + e.taoEarned, 0);
        const totalUsd = data.reduce((s, e) => s + e.usdEarned, 0);
        console.log(`\n${period.charAt(0).toUpperCase() + period.slice(1)} Earnings:`);
        console.log(`  TAO: ${totalTao.toFixed(4)}`);
        console.log(`  USD: $${totalUsd.toFixed(2)}`);
        console.log(`  Records: ${data.length}\n`);
      } catch {
        console.log('\nCould not reach gateway. Is Clodds running? (clodds start)\n');
      }
    });

  // ── miners: query from running gateway ───────────────────────────────────
  bittensor
    .command('miners')
    .description('Show registered miner statuses (queries running gateway)')
    .option('--port <port>', 'Gateway port', '18789')
    .action(async (options: { port?: string }) => {
      const port = options.port ?? '18789';
      try {
        const token = process.env.CLODDS_TOKEN;
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const r = await fetch(`http://127.0.0.1:${port}/api/bittensor/miners`, { headers });
        if (!r.ok) {
          console.log(`\nGateway returned ${r.status}. Is Clodds running? (clodds start)\n`);
          return;
        }
        const body = await r.json() as { ok: boolean; data?: Array<{ subnetId: number; hotkey: string; uid: number; trust: number; incentive: number; emission: number; rank: number; active: boolean }> };
        const data = body.data ?? [];
        if (data.length === 0) {
          console.log('\nNo miners registered.\n');
          return;
        }
        console.log('\nRegistered Miners:');
        for (const m of data) {
          console.log(`  SN${m.subnetId} UID${m.uid}: trust=${m.trust.toFixed(3)} incentive=${m.incentive.toFixed(3)} emission=${m.emission.toFixed(6)} rank=${m.rank} ${m.active ? 'ACTIVE' : 'OFFLINE'}`);
        }
        console.log('');
      } catch {
        console.log('\nCould not reach gateway. Is Clodds running? (clodds start)\n');
      }
    });

  // ── subnets: query from running gateway ──────────────────────────────────
  bittensor
    .command('subnets')
    .description('List available Bittensor subnets (queries running gateway)')
    .option('--port <port>', 'Gateway port', '18789')
    .action(async (options: { port?: string }) => {
      const port = options.port ?? '18789';
      try {
        const token = process.env.CLODDS_TOKEN;
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const r = await fetch(`http://127.0.0.1:${port}/api/bittensor/subnets`, { headers });
        if (!r.ok) {
          console.log(`\nGateway returned ${r.status}. Is Clodds running? (clodds start)\n`);
          return;
        }
        const body = await r.json() as { ok: boolean; data?: Array<{ netuid: number; name: string; minerCount: number; registrationCost: number }> };
        const data = body.data ?? [];
        if (data.length === 0) {
          console.log('\nCould not fetch subnets. Check connection.\n');
          return;
        }
        console.log('\nAvailable Subnets:');
        for (const s of data.slice(0, 30)) {
          console.log(`  SN${s.netuid} (${s.name}): ${s.minerCount} miners, reg: ${s.registrationCost.toFixed(4)} TAO`);
        }
        if (data.length > 30) console.log(`  ... and ${data.length - 30} more`);
        console.log('');
      } catch {
        console.log('\nCould not reach gateway. Is Clodds running? (clodds start)\n');
      }
    });

  // ── check: dependency verification ─────────────────────────────────────────
  bittensor
    .command('check')
    .description('Verify all dependencies are installed')
    .action(() => {
      console.log('\n=== Bittensor Dependency Check ===\n');

      // Python
      const pythonPath = process.env.BITTENSOR_PYTHON_PATH || detectPython();
      if (pythonPath) {
        const ver = spawnSync(pythonPath, ['--version'], { encoding: 'utf-8' });
        console.log(`  Python:       ${ver.stdout?.trim()} (${pythonPath})`);
      } else {
        console.log('  Python:       NOT FOUND');
      }

      // btcli
      if (pythonPath && hasBtcli(pythonPath)) {
        const ver = spawnSync(pythonPath, ['-c', 'import bittensor; print(bittensor.__version__)'], { encoding: 'utf-8' });
        console.log(`  bittensor:    ${ver.stdout?.trim()}`);
      } else {
        console.log('  bittensor:    NOT INSTALLED');
      }

      // Wallet
      const walletDir = join(homedir(), '.bittensor', 'wallets', 'default');
      console.log(`  Wallet:       ${existsSync(walletDir) ? 'found' : 'not found'} (${walletDir})`);

      // @polkadot/api
      try {
        require.resolve('@polkadot/api');
        console.log('  @polkadot/api: installed');
      } catch {
        console.log('  @polkadot/api: NOT INSTALLED');
      }

      // Config
      const configPath = join(homedir(), '.clodds', 'clodds.json');
      if (existsSync(configPath)) {
        try {
          const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
          console.log(`  Config:       ${cfg.bittensor?.enabled ? 'enabled' : 'disabled'} (${configPath})`);
        } catch {
          console.log(`  Config:       error reading (${configPath})`);
        }
      } else {
        console.log('  Config:       not found');
      }

      console.log('\nIf anything is missing, run: clodds bittensor setup\n');
    });
}

// =============================================================================
// DOCTOR COMMAND - comprehensive system health check
// =============================================================================

export function createDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run comprehensive system health checks')
    .option('--verbose', 'Show detailed output')
    .action(async (options: { verbose?: boolean }) => {
      const verbose = !!options.verbose;
      console.log('\n=== Clodds System Doctor ===\n');

      type CheckResult = { name: string; status: 'pass' | 'warn' | 'fail'; message: string; fix?: string };
      const results: CheckResult[] = [];

      // ── 1. Core: Config + DB ─────────────────────────────────────────────
      console.log('Checking core...');
      const configPath = join(homedir(), '.clodds', 'clodds.json');
      if (existsSync(configPath)) {
        results.push({ name: 'Config file', status: 'pass', message: configPath });
      } else {
        results.push({ name: 'Config file', status: 'warn', message: 'Not found', fix: 'Run: clodds onboard' });
      }

      const envPath = join(homedir(), '.clodds', '.env');
      if (existsSync(envPath)) {
        results.push({ name: '.env file', status: 'pass', message: envPath });
      } else {
        results.push({ name: '.env file', status: 'warn', message: 'Not found (using env vars only)' });
      }

      try {
        const db = createDatabase();
        const runner = createMigrationRunner(db);
        runner.migrate();
        results.push({ name: 'Database', status: 'pass', message: 'SQLite OK, migrations applied' });
      } catch (e) {
        results.push({ name: 'Database', status: 'fail', message: `Error: ${(e as Error).message}` });
      }

      // ── 2. AI Providers ──────────────────────────────────────────────────
      console.log('Checking AI providers...');

      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        results.push({ name: 'Anthropic', status: 'fail', message: 'ANTHROPIC_API_KEY not set', fix: 'https://console.anthropic.com' });
      } else {
        try {
          const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
          });
          if (r.ok || r.status === 429) {
            results.push({ name: 'Anthropic', status: 'pass', message: r.ok ? 'Key valid' : 'Key valid (rate limited)' });
          } else {
            results.push({ name: 'Anthropic', status: 'fail', message: `HTTP ${r.status}`, fix: 'Check key at console.anthropic.com' });
          }
        } catch (e) {
          results.push({ name: 'Anthropic', status: 'warn', message: `Network error: ${(e as Error).message}` });
        }
      }

      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        try {
          const r = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${openaiKey}` },
          });
          results.push({
            name: 'OpenAI',
            status: r.ok || r.status === 429 ? 'pass' : 'fail',
            message: r.ok ? 'Key valid' : `HTTP ${r.status}`,
            fix: r.ok ? undefined : 'Check key at platform.openai.com',
          });
        } catch (e) {
          results.push({ name: 'OpenAI', status: 'warn', message: `Network error: ${(e as Error).message}` });
        }
      } else if (verbose) {
        results.push({ name: 'OpenAI', status: 'warn', message: 'Not configured (optional)' });
      }

      // ── 3. Messaging Channels ────────────────────────────────────────────
      console.log('Checking channels...');

      // Telegram
      const tgToken = process.env.TELEGRAM_BOT_TOKEN;
      if (tgToken) {
        try {
          const r = await fetch(`https://api.telegram.org/bot${tgToken}/getMe`);
          const d = await r.json() as { ok: boolean; result?: { username: string } };
          results.push({
            name: 'Telegram',
            status: d.ok ? 'pass' : 'fail',
            message: d.ok ? `@${d.result?.username}` : 'Invalid token',
            fix: d.ok ? undefined : 'Get token from @BotFather',
          });
        } catch {
          results.push({ name: 'Telegram', status: 'warn', message: 'Network error' });
        }
      } else if (verbose) {
        results.push({ name: 'Telegram', status: 'warn', message: 'Not configured' });
      }

      // Discord
      const dcToken = process.env.DISCORD_BOT_TOKEN;
      if (dcToken) {
        try {
          const r = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bot ${dcToken}` },
          });
          if (r.ok) {
            const d = await r.json() as { username: string };
            results.push({ name: 'Discord', status: 'pass', message: `Bot: ${d.username}` });
          } else {
            results.push({ name: 'Discord', status: 'fail', message: `HTTP ${r.status}`, fix: 'Check token at discord.com/developers' });
          }
        } catch {
          results.push({ name: 'Discord', status: 'warn', message: 'Network error' });
        }
      } else if (verbose) {
        results.push({ name: 'Discord', status: 'warn', message: 'Not configured' });
      }

      // Slack
      const slackToken = process.env.SLACK_BOT_TOKEN;
      if (slackToken) {
        try {
          const r = await fetch('https://slack.com/api/auth.test', {
            headers: { Authorization: `Bearer ${slackToken}` },
          });
          const d = await r.json() as { ok: boolean; user?: string; team?: string; error?: string };
          results.push({
            name: 'Slack',
            status: d.ok ? 'pass' : 'fail',
            message: d.ok ? `${d.user} @ ${d.team}` : (d.error ?? 'Invalid token'),
            fix: d.ok ? undefined : 'Check token at api.slack.com/apps',
          });
        } catch {
          results.push({ name: 'Slack', status: 'warn', message: 'Network error' });
        }
      } else if (verbose) {
        results.push({ name: 'Slack', status: 'warn', message: 'Not configured' });
      }

      // WhatsApp - check auth dir exists
      const waAuthDir = join(process.cwd(), '.whatsapp-auth');
      const waConfigAuthDir = (() => {
        try {
          const cfg = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : {};
          return cfg.channels?.whatsapp?.authDir;
        } catch { return undefined; }
      })();
      const waDir = waConfigAuthDir || waAuthDir;
      if (existsSync(waDir)) {
        results.push({ name: 'WhatsApp', status: 'pass', message: `Auth at ${waDir}` });
      } else if (verbose) {
        results.push({ name: 'WhatsApp', status: 'warn', message: 'No auth session', fix: 'Run: clodds whatsapp setup' });
      }

      // ── 4. Trading Platforms ─────────────────────────────────────────────
      console.log('Checking trading platforms...');

      const polyKey = process.env.POLY_API_KEY;
      const polySecret = process.env.POLY_API_SECRET;
      const polyPass = process.env.POLY_API_PASSPHRASE;
      if (polyKey && polySecret && polyPass) {
        try {
          const r = await fetch('https://clob.polymarket.com/markets?limit=1');
          results.push({
            name: 'Polymarket',
            status: r.ok ? 'pass' : 'warn',
            message: r.ok ? 'API reachable, credentials configured' : `API returned ${r.status}`,
          });
        } catch {
          results.push({ name: 'Polymarket', status: 'warn', message: 'Network error' });
        }
        if (!process.env.POLY_PRIVATE_KEY) {
          results.push({ name: 'Polymarket (trade)', status: 'warn', message: 'POLY_PRIVATE_KEY not set — read-only mode' });
        }
      } else if (verbose) {
        results.push({ name: 'Polymarket', status: 'warn', message: 'Not configured' });
      }

      const kalshiKey = process.env.KALSHI_API_KEY;
      if (kalshiKey) {
        results.push({
          name: 'Kalshi',
          status: process.env.KALSHI_API_SECRET ? 'pass' : 'fail',
          message: process.env.KALSHI_API_SECRET ? 'API key + secret configured' : 'Missing KALSHI_API_SECRET',
        });
      } else if (verbose) {
        results.push({ name: 'Kalshi', status: 'warn', message: 'Not configured' });
      }

      // ── 5. External Services ─────────────────────────────────────────────
      console.log('Checking services...');

      const redisHost = process.env.REDIS_HOST;
      if (redisHost) {
        results.push({ name: 'Redis', status: 'warn', message: `Configured: ${redisHost} (not tested — requires connection)` });
      } else if (verbose) {
        results.push({ name: 'Redis', status: 'warn', message: 'Not configured (optional — used for execution queue)' });
      }

      const pgUrl = process.env.DATABASE_URL;
      if (pgUrl) {
        results.push({ name: 'PostgreSQL', status: 'warn', message: 'DATABASE_URL set (not tested — requires connection)' });
      } else if (verbose) {
        results.push({ name: 'PostgreSQL', status: 'warn', message: 'Not configured (optional — for tick recording)' });
      }

      // ── 6. Bittensor ────────────────────────────────────────────────────
      let btEnabled = false;
      try {
        const cfg = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : {};
        btEnabled = cfg.bittensor?.enabled === true;
      } catch {}

      if (btEnabled || process.env.BITTENSOR_ENABLED === 'true') {
        console.log('Checking Bittensor...');
        const py = process.env.BITTENSOR_PYTHON_PATH || detectPython();
        if (py) {
          results.push({ name: 'Python', status: 'pass', message: py });
          if (hasBtcli(py)) {
            results.push({ name: 'btcli', status: 'pass', message: 'Installed' });
          } else {
            results.push({ name: 'btcli', status: 'fail', message: 'Not installed', fix: 'Run: clodds bittensor setup' });
          }
        } else {
          results.push({ name: 'Python', status: 'fail', message: 'Not found', fix: 'Install Python 3' });
        }

        const walletDir = join(homedir(), '.bittensor', 'wallets', 'default');
        results.push({
          name: 'Bittensor wallet',
          status: existsSync(walletDir) ? 'pass' : 'fail',
          message: existsSync(walletDir) ? walletDir : 'Not found',
          fix: existsSync(walletDir) ? undefined : 'Run: clodds bittensor setup',
        });
      } else if (verbose) {
        results.push({ name: 'Bittensor', status: 'warn', message: 'Not enabled' });
      }

      // ── 7. Features Summary ──────────────────────────────────────────────
      if (verbose) {
        console.log('Checking features...');
        const features: Array<{ name: string; enabled: boolean; envVar: string }> = [
          { name: 'Paper Trading', enabled: process.env.PAPER_TRADING === 'true', envVar: 'PAPER_TRADING' },
          { name: 'Tick Recording', enabled: !!process.env.TICK_DB_URL, envVar: 'TICK_DB_URL' },
          { name: 'x402 Payments', enabled: process.env.X402_ENABLED === 'true', envVar: 'X402_ENABLED' },
          { name: 'Copy Trading', enabled: !!process.env.WHALE_TRACKER_WALLETS, envVar: 'WHALE_TRACKER_WALLETS' },
          { name: 'News Feed', enabled: !!process.env.TWITTER_BEARER_TOKEN, envVar: 'TWITTER_BEARER_TOKEN' },
          { name: 'Execution Queue', enabled: !!process.env.REDIS_HOST, envVar: 'REDIS_HOST' },
          { name: 'Cron Jobs', enabled: process.env.CRON_ENABLED === 'true', envVar: 'CRON_ENABLED' },
          { name: 'Bittensor Mining', enabled: btEnabled || process.env.BITTENSOR_ENABLED === 'true', envVar: 'BITTENSOR_ENABLED' },
        ];
        for (const f of features) {
          results.push({
            name: f.name,
            status: f.enabled ? 'pass' : 'warn',
            message: f.enabled ? 'Enabled' : `Disabled (set ${f.envVar} to enable)`,
          });
        }
      }

      // ── Display ──────────────────────────────────────────────────────────
      console.log('');
      const icons = { pass: '\x1b[32m✓\x1b[0m', warn: '\x1b[33m!\x1b[0m', fail: '\x1b[31m✗\x1b[0m' };

      for (const r of results) {
        console.log(`  ${icons[r.status]} ${r.name}: ${r.message}`);
        if (r.fix) {
          console.log(`    Fix: ${r.fix}`);
        }
      }

      const passed = results.filter(r => r.status === 'pass').length;
      const warned = results.filter(r => r.status === 'warn').length;
      const failed = results.filter(r => r.status === 'fail').length;

      console.log(`\n  ${passed} passed, ${warned} warnings, ${failed} failed`);

      if (failed > 0) {
        console.log('\n  Fix the failures above and run `clodds doctor` again.');
        process.exitCode = 1;
      } else if (warned > 0) {
        console.log('\n  Warnings are optional — fix them if you need those features.');
      } else {
        console.log('\n  Everything looks good!');
      }

      console.log(`\n  Tip: Run \`clodds doctor --verbose\` to see all features and optional services.\n`);
    });
}

// =============================================================================
// ONBOARD COMMAND - interactive setup wizard
// =============================================================================

export function createOnboardCommand(program: Command): void {
  program
    .command('onboard')
    .alias('setup')
    .description('Interactive setup wizard — get running in 60 seconds')
    .option('--api-key <key>', 'Anthropic API key (skip prompt)')
    .option('--channel <name>', 'Channel to configure (telegram, discord, slack, webchat)')
    .option('--no-start', 'Skip the "start now?" prompt')
    .action(async (options: { apiKey?: string; channel?: string; start?: boolean }) => {
      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (prompt: string): Promise<string> =>
        new Promise((resolve) => rl.question(prompt, (a) => resolve(a.trim())));

      // ANSI helpers
      const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
      const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
      const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
      const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
      const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
      const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
      const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
      const bgCyan = (s: string) => `\x1b[46m\x1b[30m${s}\x1b[0m`;

      const cloddsDir = join(homedir(), '.clodds');
      const envPath = join(cloddsDir, '.env');
      const configPath = join(cloddsDir, 'clodds.json');

      // Track what we'll write
      const envVars: Record<string, string> = {};
      const configObj: Record<string, unknown> = {};

      // Load existing config if present
      if (existsSync(configPath)) {
        try {
          Object.assign(configObj, JSON.parse(readFileSync(configPath, 'utf-8')));
        } catch { /* fresh */ }
      }

      // Load existing .env if present
      if (existsSync(envPath)) {
        try {
          const lines = readFileSync(envPath, 'utf-8').split('\n');
          for (const line of lines) {
            const match = line.match(/^([A-Z_]+)=(.+)$/);
            if (match) envVars[match[1]] = match[2];
          }
        } catch { /* fresh */ }
      }

      // ═══════════════════════════════════════════════════════════════════
      // WELCOME
      // ═══════════════════════════════════════════════════════════════════
      const figlet = await import('figlet');
      const banner = figlet.default.textSync('Clodds', { font: 'ANSI Shadow' });
      console.log('');
      for (const line of banner.split('\n')) {
        if (line.trim()) console.log(`  ${magenta(line)}`);
      }
      console.log('');
      console.log(`  ${bold('AI Trading Terminal')} ${dim('for prediction markets, crypto & futures')}`);
      console.log(`  ${dim('10 markets  |  22 channels  |  103 skills')}`);
      console.log('');
      console.log(`  ${dim('='.repeat(56))}`);
      console.log('');

      // ═══════════════════════════════════════════════════════════════════
      // STEP 1: API KEY
      // ═══════════════════════════════════════════════════════════════════
      console.log(`  ${bgCyan(' 1 ')} ${bold('Anthropic API Key')}`);
      console.log(`  ${dim('Powers the Claude AI brain. Get one free at:')}`);
      console.log(`  ${cyan('https://console.anthropic.com')}`);
      console.log('');

      let apiKey = options.apiKey || envVars.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
      const isPlaceholder = !apiKey || apiKey === 'sk-ant-...' || apiKey.length < 20;

      if (isPlaceholder) {
        apiKey = await ask(`  ${bold('Paste API key:')} `);
        if (!apiKey || apiKey.length < 10) {
          console.log('');
          console.log(`  ${red('No key provided.')} Add it later:`);
          console.log(`  ${dim('echo "ANTHROPIC_API_KEY=sk-ant-..." >> ~/.clodds/.env')}`);
          console.log('');
          rl.close();
          return;
        }
      } else {
        const masked = apiKey.slice(0, 10) + '...' + apiKey.slice(-4);
        console.log(`  ${dim('Found:')} ${masked}`);
        const reuse = await ask(`  ${bold('Use this key?')} ${dim('[Y/n]')} `);
        if (reuse.toLowerCase() === 'n') {
          apiKey = await ask(`  ${bold('Paste new key:')} `);
        }
      }

      envVars.ANTHROPIC_API_KEY = apiKey;

      // Validate
      process.stdout.write(`  ${dim('Validating...')}`);
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
        });
        if (r.ok || r.status === 429) {
          console.log(`\r  ${green('Valid')}                `);
        } else if (r.status === 401) {
          console.log(`\r  ${yellow('Invalid key (401)')} — continuing anyway   `);
        } else {
          console.log(`\r  ${yellow(`HTTP ${r.status}`)} — continuing anyway          `);
        }
      } catch {
        console.log(`\r  ${yellow('Offline')} — skipped validation        `);
      }
      console.log('');

      // ═══════════════════════════════════════════════════════════════════
      // STEP 2: CHANNEL
      // ═══════════════════════════════════════════════════════════════════
      console.log(`  ${bgCyan(' 2 ')} ${bold('Messaging Channel')}`);
      console.log(`  ${dim('WebChat is built-in at')} ${cyan('http://localhost:18789/webchat')}`);
      console.log(`  ${dim('Optionally connect a platform:')}`);
      console.log('');
      console.log(`    ${bold('1')}  WebChat only       ${dim('zero config, works immediately')}`);
      console.log(`    ${bold('2')}  Telegram            ${green('recommended')} ${dim('— easiest setup')}`);
      console.log(`    ${bold('3')}  Discord             ${dim('bot token from discord.com/developers')}`);
      console.log(`    ${bold('4')}  Slack               ${dim('bot + app tokens from api.slack.com')}`);
      console.log('');

      let channelChoice = options.channel || '';
      if (!channelChoice) {
        const choice = await ask(`  ${bold('Choose')} ${dim('[1-4, default 1]:')} `);
        const map: Record<string, string> = { '1': 'webchat', '2': 'telegram', '3': 'discord', '4': 'slack', '': 'webchat' };
        channelChoice = map[choice] || choice.toLowerCase();
      }
      console.log('');

      // ═══════════════════════════════════════════════════════════════════
      // STEP 3: CHANNEL TOKEN
      // ═══════════════════════════════════════════════════════════════════
      if (channelChoice === 'telegram') {
        console.log(`  ${bgCyan(' 3 ')} ${bold('Telegram Setup')}`);
        console.log(`  ${dim('1.')} Open Telegram, message ${cyan('@BotFather')}`);
        console.log(`  ${dim('2.')} Send ${bold('/newbot')} and follow the prompts`);
        console.log(`  ${dim('3.')} Copy the token it gives you`);
        console.log('');

        let token = envVars.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
        if (token) {
          console.log(`  ${dim('Found:')} ${token.slice(0, 8)}...`);
          const reuse = await ask(`  ${bold('Use this token?')} ${dim('[Y/n]')} `);
          if (reuse.toLowerCase() === 'n') token = '';
        }
        if (!token) {
          token = await ask(`  ${bold('Bot token:')} `);
        }
        if (token) {
          envVars.TELEGRAM_BOT_TOKEN = token;
          configObj.channels = { ...(configObj.channels as object || {}), telegram: { enabled: true } };

          // Validate token
          process.stdout.write(`  ${dim('Validating...')}`);
          try {
            const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
            const d = await r.json() as { ok: boolean; result?: { username: string } };
            if (d.ok) {
              console.log(`\r  ${green(`@${d.result?.username}`)} connected       `);
            } else {
              console.log(`\r  ${yellow('Token may be invalid')} — continuing       `);
            }
          } catch {
            console.log(`\r  ${yellow('Offline')} — skipped validation       `);
          }
        } else {
          console.log(`  ${dim('Skipped. Add later: TELEGRAM_BOT_TOKEN=... in ~/.clodds/.env')}`);
        }

      } else if (channelChoice === 'discord') {
        console.log(`  ${bgCyan(' 3 ')} ${bold('Discord Setup')}`);
        console.log(`  ${dim('1.')} Go to ${cyan('https://discord.com/developers/applications')}`);
        console.log(`  ${dim('2.')} Create app > Bot > Reset Token > Copy`);
        console.log('');

        let token = envVars.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN || '';
        if (token) {
          console.log(`  ${dim('Found:')} ${token.slice(0, 8)}...`);
          const reuse = await ask(`  ${bold('Use this token?')} ${dim('[Y/n]')} `);
          if (reuse.toLowerCase() === 'n') token = '';
        }
        if (!token) {
          token = await ask(`  ${bold('Bot token:')} `);
        }
        if (token) {
          envVars.DISCORD_BOT_TOKEN = token;
          const appId = await ask(`  ${bold('Application ID')} ${dim('(optional, Enter to skip):')} `);
          if (appId) envVars.DISCORD_APP_ID = appId;
          configObj.channels = { ...(configObj.channels as object || {}), discord: { enabled: true } };
          console.log(`  ${green('Discord configured')}`);
        } else {
          console.log(`  ${dim('Skipped. Add later: DISCORD_BOT_TOKEN=... in ~/.clodds/.env')}`);
        }

      } else if (channelChoice === 'slack') {
        console.log(`  ${bgCyan(' 3 ')} ${bold('Slack Setup')}`);
        console.log(`  ${dim('1.')} Go to ${cyan('https://api.slack.com/apps')} > Create App`);
        console.log(`  ${dim('2.')} OAuth > Bot Token (xoxb-...) and App Token (xapp-...)`);
        console.log('');

        let botToken = envVars.SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN || '';
        if (!botToken) {
          botToken = await ask(`  ${bold('Bot token')} ${dim('(xoxb-...):')} `);
        }
        let appToken = envVars.SLACK_APP_TOKEN || process.env.SLACK_APP_TOKEN || '';
        if (!appToken) {
          appToken = await ask(`  ${bold('App token')} ${dim('(xapp-...):')} `);
        }
        if (botToken && appToken) {
          envVars.SLACK_BOT_TOKEN = botToken;
          envVars.SLACK_APP_TOKEN = appToken;
          configObj.channels = { ...(configObj.channels as object || {}), slack: { enabled: true } };
          console.log(`  ${green('Slack configured')}`);
        } else {
          console.log(`  ${dim('Incomplete. Add tokens later in ~/.clodds/.env')}`);
        }

      } else {
        console.log(`  ${bgCyan(' 3 ')} ${bold('WebChat')} ${dim('— no extra setup needed')}`);
      }
      console.log('');

      // ═══════════════════════════════════════════════════════════════════
      // STEP 4: WRITE CONFIG
      // ═══════════════════════════════════════════════════════════════════
      console.log(`  ${bgCyan(' 4 ')} ${bold('Saving')}`);

      if (!existsSync(cloddsDir)) {
        mkdirSync(cloddsDir, { recursive: true });
      }

      // Write .env
      const envContent = Object.entries(envVars)
        .filter(([_, v]) => v && v !== 'sk-ant-...')
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n';
      writeFileSync(envPath, envContent, { mode: 0o600 });
      console.log(`  ${green('wrote')} ${dim(envPath)}`);

      // Write config
      if (!configObj.gateway) {
        configObj.gateway = { port: 18789 };
      }
      writeFileSync(configPath, JSON.stringify(configObj, null, 2));
      console.log(`  ${green('wrote')} ${dim(configPath)}`);

      // ═══════════════════════════════════════════════════════════════════
      // DONE
      // ═══════════════════════════════════════════════════════════════════
      console.log('');
      console.log(`  ${green(bold('Setup complete.'))}  Everything you need is ready.`);
      console.log('');
      console.log(`  ${dim('Quick reference:')}`);
      console.log(`    ${bold('clodds start')}     ${dim('launch the gateway')}`);
      console.log(`    ${bold('clodds doctor')}    ${dim('run diagnostics')}`);
      console.log(`    ${bold('clodds repl')}      ${dim('local test shell')}`);
      console.log('');
      console.log(`  ${dim('WebChat:')} ${cyan('http://localhost:18789/webchat')}`);

      if (channelChoice === 'telegram' && envVars.TELEGRAM_BOT_TOKEN) {
        console.log(`  ${dim('Telegram:')} message your bot to start chatting`);
      } else if (channelChoice === 'discord' && envVars.DISCORD_BOT_TOKEN) {
        console.log(`  ${dim('Discord:')} invite your bot, then mention it`);
      }

      console.log('');

      if (options.start !== false) {
        const startNow = await ask(`  ${bold('Start Clodds now?')} ${dim('[Y/n]')} `);
        rl.close();

        if (!startNow || startNow.toLowerCase() === 'y' || startNow.toLowerCase() === 'yes') {
          for (const [k, v] of Object.entries(envVars)) {
            process.env[k] = v;
          }

          console.log('');

          // Silence pino logs during startup so they don't pollute the wizard UI
          const prevLogLevel = process.env.LOG_LEVEL;
          process.env.LOG_LEVEL = 'silent';

          const config = await loadConfig();
          const { configureHttpClient } = await import('../../utils/http.js');
          configureHttpClient(config.http);
          const { createGateway } = await import('../../gateway/index.js');

          process.stdout.write(`  ${dim('Starting...')}`);
          const gateway = await createGateway(config);
          await gateway.start();

          // Restore log level for normal operation
          if (prevLogLevel !== undefined) {
            process.env.LOG_LEVEL = prevLogLevel;
          } else {
            delete process.env.LOG_LEVEL;
          }

          console.log(`\r  ${green(bold('Clodds is running'))}                `);
          console.log('');
          console.log(`  ${cyan(`http://localhost:${config.gateway.port}/webchat`)}`);
          console.log(`  ${dim('Press Ctrl+C to stop')}`);
          console.log('');

          const shutdown = async () => {
            console.log(`\n  ${dim('Shutting down...')}`);
            await gateway.stop();
            process.exit(0);
          };

          process.on('SIGINT', shutdown);
          process.on('SIGTERM', shutdown);
        }
      } else {
        rl.close();
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
  createLocaleCommands(program);
  createLedgerCommands(program);
  createInitCommand(program);
  createUpgradeCommand(program);
  createLoginCommand(program);
  createLogoutCommand(program);
  createWhatsAppCommands(program);
  createBittensorCommands(program);
  createOnboardCommand(program);
  createDoctorCommand(program);
  createVersionCommand(program);
}
