/**
 * Clodds - AI Assistant for Prediction Markets
 * Claude + Odds
 *
 * Entry point - starts the gateway and all services
 */

import 'dotenv/config';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createGateway } from './gateway/index';
import { loadConfig } from './utils/config';
import { logger } from './utils/logger';
import { installHttpClient, configureHttpClient } from './utils/http';

// =============================================================================
// STARTUP PROGRESS INDICATOR
// =============================================================================

interface StartupStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  detail?: string;
}

const startupSteps: StartupStep[] = [];
let spinnerInterval: NodeJS.Timeout | null = null;
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerFrame = 0;

function addStep(name: string): number {
  const idx = startupSteps.push({ name, status: 'pending' }) - 1;
  return idx;
}

function updateStep(idx: number, status: StartupStep['status'], detail?: string): void {
  if (startupSteps[idx]) {
    startupSteps[idx].status = status;
    if (detail) startupSteps[idx].detail = detail;
  }
  renderProgress();
}

function renderProgress(): void {
  // Only render in TTY mode
  if (!process.stdout.isTTY) return;

  // Clear previous lines
  const linesToClear = startupSteps.length + 2;
  process.stdout.write(`\x1b[${linesToClear}A\x1b[0J`);

  console.log('\n\x1b[1m🚀 Starting Clodds...\x1b[0m\n');

  for (const step of startupSteps) {
    let icon: string;
    let color: string;
    switch (step.status) {
      case 'done':
        icon = '✓';
        color = '\x1b[32m'; // green
        break;
      case 'failed':
        icon = '✗';
        color = '\x1b[31m'; // red
        break;
      case 'skipped':
        icon = '○';
        color = '\x1b[90m'; // gray
        break;
      case 'running':
        icon = spinnerFrames[spinnerFrame % spinnerFrames.length];
        color = '\x1b[36m'; // cyan
        break;
      default:
        icon = '○';
        color = '\x1b[90m'; // gray
    }
    const detail = step.detail ? ` \x1b[90m(${step.detail})\x1b[0m` : '';
    console.log(`  ${color}${icon}\x1b[0m ${step.name}${detail}`);
  }
}

function startSpinner(): void {
  if (!process.stdout.isTTY) return;
  spinnerInterval = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % spinnerFrames.length;
    renderProgress();
  }, 80);
}

function stopSpinner(): void {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate required environment variables and configuration
 * Provides clear error messages for common setup issues
 */
function validateStartupRequirements(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for Anthropic API key (required for AI functionality)
  if (!process.env.ANTHROPIC_API_KEY) {
    errors.push(
      'ANTHROPIC_API_KEY is not set. The AI agent will not function.\n' +
      '  Fix: Add ANTHROPIC_API_KEY=sk-ant-... to your .env file\n' +
      '  Or run: clodds onboard'
    );
  }

  // Auto-generate credential encryption key if not set
  if (!process.env.CLODDS_CREDENTIAL_KEY) {
    const generated = randomBytes(32).toString('hex');
    process.env.CLODDS_CREDENTIAL_KEY = generated;

    // Persist to ~/.clodds/.env so it survives restarts
    const cloddsDir = join(homedir(), '.clodds');
    const envPath = join(cloddsDir, '.env');
    try {
      if (!existsSync(cloddsDir)) {
        mkdirSync(cloddsDir, { recursive: true });
      }
      if (existsSync(envPath)) {
        // Append if file exists and doesn't already contain the key
        const existing = readFileSync(envPath, 'utf-8');
        if (!existing.includes('CLODDS_CREDENTIAL_KEY=')) {
          appendFileSync(envPath, `\nCLODDS_CREDENTIAL_KEY=${generated}\n`);
        }
      } else {
        writeFileSync(envPath, `CLODDS_CREDENTIAL_KEY=${generated}\n`, { mode: 0o600 });
      }
      logger.info('Auto-generated CLODDS_CREDENTIAL_KEY for credential encryption');
    } catch (err) {
      logger.warn({ err }, 'Could not persist CLODDS_CREDENTIAL_KEY to .env file — key is set for this session only');
    }
  }

  // Check for common channel configurations (warnings only)
  if (!process.env.TELEGRAM_BOT_TOKEN && !process.env.DISCORD_BOT_TOKEN) {
    warnings.push(
      'No messaging channel configured (TELEGRAM_BOT_TOKEN or DISCORD_BOT_TOKEN).\n' +
      '  WebChat at http://localhost:18789/webchat will still work.'
    );
  }

  // Log warnings
  for (const warning of warnings) {
    logger.warn(warning);
  }

  // Exit with errors if critical requirements missing
  if (errors.length > 0) {
    logger.error('Clodds Startup Failed');
    for (const error of errors) {
      logger.error(error);
    }
    logger.error('Run "clodds doctor" for full diagnostics.');
    process.exit(1);
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  installHttpClient();

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.error({ error }, 'Uncaught exception');
    process.exit(1);
  });

  // Initialize progress display
  const isTTY = process.stdout.isTTY;
  if (isTTY) {
    // Pre-populate steps for visual display
    const idxValidate = addStep('Validating configuration');
    const idxConfig = addStep('Loading config');
    const idxDatabase = addStep('Connecting to database');
    const idxFeeds = addStep('Starting market feeds');
    const idxChannels = addStep('Connecting channels');
    const idxGateway = addStep('Starting HTTP gateway');

    // Print initial state
    console.log('\n\x1b[1m🚀 Starting Clodds...\x1b[0m\n');
    for (const step of startupSteps) {
      console.log(`  \x1b[90m○\x1b[0m ${step.name}`);
    }

    startSpinner();

    // Step 1: Validate
    updateStep(idxValidate, 'running');
    try {
      validateStartupRequirements();
      updateStep(idxValidate, 'done');
    } catch (e) {
      updateStep(idxValidate, 'failed');
      stopSpinner();
      throw e;
    }

    // Step 2: Load config
    updateStep(idxConfig, 'running');
    let config;
    try {
      config = await loadConfig();
      configureHttpClient(config.http);
      updateStep(idxConfig, 'done', `port ${config.gateway.port}`);
    } catch (e) {
      updateStep(idxConfig, 'failed');
      stopSpinner();
      throw e;
    }

    // Step 3-6: Gateway handles DB, feeds, channels internally
    // We mark them as running since createGateway does the work
    updateStep(idxDatabase, 'running');
    updateStep(idxFeeds, 'running');
    updateStep(idxChannels, 'running');
    updateStep(idxGateway, 'running');

    let gateway;
    try {
      gateway = await createGateway(config);
      updateStep(idxDatabase, 'done');
      updateStep(idxFeeds, 'done');
      updateStep(idxChannels, 'done');
    } catch (e) {
      updateStep(idxDatabase, 'failed');
      stopSpinner();
      throw e;
    }

    try {
      await gateway.start();
      updateStep(idxGateway, 'done', `http://localhost:${config.gateway.port}`);
    } catch (e) {
      updateStep(idxGateway, 'failed');
      stopSpinner();
      throw e;
    }

    stopSpinner();
    renderProgress();

    // Final success message
    console.log('\n\x1b[32m\x1b[1m✓ Clodds is running!\x1b[0m');
    console.log(`\n  WebChat: \x1b[36mhttp://localhost:${config.gateway.port}/webchat\x1b[0m`);
    if (process.env.TELEGRAM_BOT_TOKEN) {
      console.log('  Telegram: \x1b[32mConnected\x1b[0m');
    }
    if (process.env.DISCORD_BOT_TOKEN) {
      console.log('  Discord: \x1b[32mConnected\x1b[0m');
    }
    console.log('\n  Press Ctrl+C to stop\n');

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log('\n\x1b[33mShutting down...\x1b[0m');
      try {
        await gateway.stop();
      } catch (e) {
        logger.error({ err: e }, 'Error during shutdown');
      }
      console.log('\x1b[32mGoodbye!\x1b[0m\n');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } else {
    // Non-TTY mode: simple logging
    logger.info('Starting Clodds...');

    validateStartupRequirements();

    const config = await loadConfig();
    configureHttpClient(config.http);
    logger.info({ port: config.gateway.port }, 'Config loaded');

    const gateway = await createGateway(config);
    await gateway.start();

    logger.info('Clodds is running!');

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info('Shutting down...');
      try {
        await gateway.stop();
      } catch (e) {
        logger.error({ err: e }, 'Error during shutdown');
      }
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

main().catch((err) => {
  stopSpinner();
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
