#!/usr/bin/env node
/**
 * Clodds CLI - Command-line interface for Clodds
 *
 * Commands:
 * - clodds start - Start the gateway
 * - clodds pairing list <channel> - List pending pairing requests
 * - clodds pairing approve <channel> <code> - Approve a pairing request
 * - clodds pairing reject <channel> <code> - Reject a pairing request
 * - clodds pairing users <channel> - List paired users
 */

import { Command } from 'commander';
import { createDatabase } from '../db/index';
import { createPairingService } from '../pairing/index';
import { createGateway } from '../gateway/index';
import { loadConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { runDoctor } from './commands/doctor';
import { createSkillsCommands } from './commands/skills';
import { addAllCommands } from './commands/index';

const program = new Command();

program
  .name('clodds')
  .description('Claude + Odds: AI assistant for prediction markets')
  .version('0.1.0');

// Start command
program
  .command('start')
  .description('Start the Clodds gateway')
  .action(async () => {
    logger.info('Starting Clodds...');
    const config = await loadConfig();
    const gateway = await createGateway(config);
    await gateway.start();

    logger.info('Clodds is running!');

    const shutdown = async () => {
      logger.info('Shutting down...');
      await gateway.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

// Pairing commands
const pairing = program
  .command('pairing')
  .description('Manage DM pairing requests (Clawdbot-style access control)');

pairing
  .command('list <channel>')
  .description('List pending pairing requests for a channel')
  .action(async (channel: string) => {
    const db = createDatabase();
    const pairingService = createPairingService(db);

    const requests = pairingService.listPendingRequests(channel);

    if (requests.length === 0) {
      console.log(`No pending pairing requests for ${channel}`);
      return;
    }

    console.log(`\nPending pairing requests for ${channel}:\n`);
    console.log('Code\t\tUser ID\t\t\tUsername\tExpires');
    console.log('─'.repeat(70));

    for (const req of requests) {
      const expiresIn = Math.round((req.expiresAt.getTime() - Date.now()) / 1000 / 60);
      console.log(
        `${req.code}\t${req.userId.padEnd(20)}\t${(req.username || '-').padEnd(12)}\t${expiresIn}m`
      );
    }

    console.log(`\nTo approve: clodds pairing approve ${channel} <CODE>`);
    db.close();
  });

pairing
  .command('approve <channel> <code>')
  .description('Approve a pairing request')
  .action(async (channel: string, code: string) => {
    const db = createDatabase();
    const pairingService = createPairingService(db);

    const success = await pairingService.approveRequest(channel, code);

    if (success) {
      console.log(`\n✅ Approved pairing request: ${code.toUpperCase()}`);
      console.log('User can now chat with Clodds via DM.');
    } else {
      console.log(`\n❌ Failed to approve: Code not found or expired`);
      console.log(`Run "clodds pairing list ${channel}" to see pending requests.`);
    }

    db.close();
  });

pairing
  .command('reject <channel> <code>')
  .description('Reject a pairing request')
  .action(async (channel: string, code: string) => {
    const db = createDatabase();
    const pairingService = createPairingService(db);

    const success = await pairingService.rejectRequest(channel, code);

    if (success) {
      console.log(`\nRejected pairing request: ${code.toUpperCase()}`);
    } else {
      console.log(`\nFailed to reject: Code not found`);
    }

    db.close();
  });

pairing
  .command('users <channel>')
  .description('List paired users for a channel')
  .action(async (channel: string) => {
    const db = createDatabase();
    const pairingService = createPairingService(db);

    const users = pairingService.listPairedUsers(channel);

    if (users.length === 0) {
      console.log(`No paired users for ${channel}`);
      return;
    }

    console.log(`\nPaired users for ${channel}:\n`);
    console.log('User ID\t\t\t\tUsername\tRole\t\tPaired At');
    console.log('─'.repeat(80));

    for (const user of users) {
      const pairedAt = user.pairedAt.toISOString().slice(0, 16).replace('T', ' ');
      const role = user.isOwner ? 'OWNER' : 'paired';
      console.log(
        `${user.userId.padEnd(24)}\t${(user.username || '-').padEnd(12)}\t${role.padEnd(12)}\t${pairedAt}`
      );
    }

    db.close();
  });

pairing
  .command('set-owner <channel> <userId>')
  .option('-u, --username <username>', 'Username for the user')
  .description('Set a user as owner (can approve pairings via chat)')
  .action(async (channel: string, userId: string, options: { username?: string }) => {
    const db = createDatabase();
    const pairingService = createPairingService(db);

    pairingService.setOwner(channel, userId, options.username);
    console.log(`\n✅ Set ${userId} as owner for ${channel}`);
    console.log('This user can now approve pairing requests via chat commands.');

    db.close();
  });

pairing
  .command('remove-owner <channel> <userId>')
  .description('Remove owner status from a user')
  .action(async (channel: string, userId: string) => {
    const db = createDatabase();
    const pairingService = createPairingService(db);

    pairingService.removeOwner(channel, userId);
    console.log(`\nRemoved owner status from ${userId} for ${channel}`);

    db.close();
  });

pairing
  .command('owners <channel>')
  .description('List all owners for a channel')
  .action(async (channel: string) => {
    const db = createDatabase();
    const pairingService = createPairingService(db);

    const owners = pairingService.listOwners(channel);

    if (owners.length === 0) {
      console.log(`No owners for ${channel}`);
      console.log(`\nUse 'clodds pairing set-owner ${channel} <userId>' to add an owner.`);
      return;
    }

    console.log(`\nOwners for ${channel}:\n`);
    for (const owner of owners) {
      console.log(`  ${owner.userId} (${owner.username || 'no username'})`);
    }

    db.close();
  });

pairing
  .command('add <channel> <userId>')
  .option('-u, --username <username>', 'Username for the user')
  .description('Manually add a user to the paired list')
  .action(async (channel: string, userId: string, options: { username?: string }) => {
    const db = createDatabase();
    const pairingService = createPairingService(db);

    pairingService.addPairedUser(channel, userId, options.username, 'allowlist');
    console.log(`\nAdded user ${userId} to ${channel} paired list`);

    db.close();
  });

pairing
  .command('remove <channel> <userId>')
  .description('Remove a user from the paired list')
  .action(async (channel: string, userId: string) => {
    const db = createDatabase();
    const pairingService = createPairingService(db);

    pairingService.removePairedUser(channel, userId);
    console.log(`\nRemoved user ${userId} from ${channel} paired list`);

    db.close();
  });

// Doctor command
program
  .command('doctor')
  .description('Run system diagnostics')
  .action(async () => {
    console.log('\n🔍 Running Clodds diagnostics...\n');

    const results = await runDoctor();

    for (const result of results) {
      const icon = result.status === 'pass' ? '✅' :
                   result.status === 'warn' ? '⚠️' : '❌';
      console.log(`${icon} ${result.name}: ${result.message}`);
      if (result.fix) {
        console.log(`   ↳ Fix: ${result.fix}`);
      }
    }

    const passed = results.filter(r => r.status === 'pass').length;
    const warnings = results.filter(r => r.status === 'warn').length;
    const failed = results.filter(r => r.status === 'fail').length;

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${warnings} warnings, ${failed} failed\n`);

    if (failed > 0) {
      console.log('Fix the failed checks above before running Clodds.');
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show Clodds status')
  .action(async () => {
    const db = createDatabase();
    const pairingService = createPairingService(db);

    console.log('\nClodds Status\n');

    // Count paired users per channel
    const channels = ['telegram', 'discord', 'webchat'];
    for (const channel of channels) {
      const users = pairingService.listPairedUsers(channel);
      const pending = pairingService.listPendingRequests(channel);
      console.log(`${channel}: ${users.length} paired, ${pending.length} pending`);
    }

    db.close();
  });

// Skills commands
const skills = program
  .command('skills')
  .description('Manage skills (ClawdHub registry)');

const skillsCommands = createSkillsCommands();

skills
  .command('list')
  .description('List installed skills')
  .action(() => skillsCommands.list());

skills
  .command('search <query>')
  .description('Search skills in registry')
  .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
  .option('-l, --limit <n>', 'Limit results', '10')
  .action(async (query: string, options: { tags?: string; limit?: string }) => {
    await skillsCommands.search(query, {
      tags: options.tags?.split(','),
      limit: parseInt(options.limit || '10', 10),
    });
  });

skills
  .command('install <slug>')
  .description('Install a skill from registry')
  .option('-f, --force', 'Force reinstall if already installed')
  .action(async (slug: string, options: { force?: boolean }) => {
    await skillsCommands.install(slug, { force: options.force });
  });

skills
  .command('update [slug]')
  .description('Update a skill or all skills')
  .action(async (slug?: string) => {
    await skillsCommands.update(slug);
  });

skills
  .command('uninstall <slug>')
  .description('Uninstall a skill')
  .action(async (slug: string) => {
    await skillsCommands.uninstall(slug);
  });

skills
  .command('info <slug>')
  .description('Show skill details')
  .action(async (slug: string) => {
    await skillsCommands.info(slug);
  });

skills
  .command('check-updates')
  .description('Check for available updates')
  .action(async () => {
    await skillsCommands.checkUpdates();
  });

// Add all additional commands
addAllCommands(program);

program.parse();
