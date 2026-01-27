/**
 * Clodds - AI Assistant for Prediction Markets
 * Claude + Odds
 *
 * Entry point - starts the gateway and all services
 */

import { createGateway } from './gateway/index';
import { loadConfig } from './utils/config';
import { logger } from './utils/logger';

async function main() {
  logger.info('Starting Clodds...');

  // Load configuration
  const config = await loadConfig();
  logger.info({ port: config.gateway.port }, 'Config loaded');

  // Create and start gateway
  const gateway = await createGateway(config);
  await gateway.start();

  logger.info('Clodds is running!');

  // Handle shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await gateway.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
