#!/usr/bin/env node
/**
 * Execution Worker Process
 *
 * Standalone process that consumes execution jobs from Redis/BullMQ.
 * Run separately from the gateway for fault isolation:
 *
 *   npm run worker
 *
 * Or in production:
 *
 *   node dist/bin/worker.js
 *
 * Configuration (reads from ~/.clodds/clodds.json then env vars):
 *
 *   // clodds.json
 *   {
 *     "queue": {
 *       "enabled": true,
 *       "redis": { "host": "localhost", "port": 6379 },
 *       "concurrency": 10
 *     }
 *   }
 *
 * Environment variable overrides:
 *   REDIS_HOST          - Redis host (default: localhost)
 *   REDIS_PORT          - Redis port (default: 6379)
 *   REDIS_PASSWORD      - Redis password (optional)
 *   WORKER_CONCURRENCY  - Max concurrent jobs (default: 10)
 */

import 'dotenv/config';
import { createExecutionWorker } from '../queue/jobs';
import { createExecutionService, type ExecutionConfig } from '../execution';
import { loadConfig } from '../utils/config';
import { logger } from '../utils/logger';
import type { RedisOptions } from 'ioredis';

async function main(): Promise<void> {
  logger.info('Starting execution worker process');

  // Load config (reads ~/.clodds/clodds.json + env vars)
  const config = await loadConfig();

  // Build Redis connection — config.queue.redis takes priority, env vars as fallback
  const redis: RedisOptions = {
    host: config.queue?.redis?.host ?? process.env.REDIS_HOST ?? 'localhost',
    port: config.queue?.redis?.port ?? (parseInt(process.env.REDIS_PORT ?? '6379', 10) || 6379),
    password: config.queue?.redis?.password ?? process.env.REDIS_PASSWORD ?? undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
  };

  // Build execution service from config
  const execConfig: ExecutionConfig = {};

  if (config.trading?.enabled) {
    const poly = config.trading.polymarket;
    const kalshi = config.trading.kalshi;
    const opinionCfg = config.trading.opinion;
    const predictfunCfg = config.trading?.predictfun;

    const hasPolymarketCreds = poly?.address && poly?.apiKey && poly?.apiSecret && poly?.apiPassphrase;
    const hasKalshiCreds = kalshi?.apiKeyId && kalshi?.privateKeyPem;
    const hasOpinionCreds = opinionCfg?.apiKey && opinionCfg?.privateKey && opinionCfg?.vaultAddress;
    const hasPredictFunCreds = !!predictfunCfg?.privateKey;

    if (hasPolymarketCreds) {
      execConfig.polymarket = {
        address: poly!.address,
        apiKey: poly!.apiKey,
        apiSecret: poly!.apiSecret,
        apiPassphrase: poly!.apiPassphrase,
        privateKey: poly!.privateKey,
        funderAddress: (poly as any)?.funderAddress || poly!.address,
        signatureType: (poly as any)?.signatureType as number | undefined,
      };
    }

    if (hasKalshiCreds) {
      execConfig.kalshi = {
        apiKeyId: kalshi!.apiKeyId,
        privateKeyPem: kalshi!.privateKeyPem,
      };
    }

    if (hasOpinionCreds) {
      execConfig.opinion = {
        apiKey: opinionCfg!.apiKey,
        privateKey: opinionCfg!.privateKey,
        multiSigAddress: opinionCfg!.vaultAddress,
        rpcUrl: opinionCfg!.rpcUrl,
      };
    }

    if (hasPredictFunCreds) {
      execConfig.predictfun = {
        privateKey: predictfunCfg!.privateKey,
        predictAccount: predictfunCfg!.predictAccount,
        rpcUrl: predictfunCfg!.rpcUrl,
        apiKey: predictfunCfg!.apiKey,
      };
    }

    execConfig.maxOrderSize = config.trading.maxOrderSize ?? 1000;
    execConfig.dryRun = config.trading.dryRun ?? false;
  }

  const executionService = createExecutionService(execConfig);
  const concurrency = config.queue?.concurrency
    ?? (parseInt(process.env.WORKER_CONCURRENCY ?? '10', 10) || 10);

  logger.info({
    redis: { host: redis.host, port: redis.port },
    concurrency,
    dryRun: execConfig.dryRun ?? false,
    polymarket: !!execConfig.polymarket,
    kalshi: !!execConfig.kalshi,
    opinion: !!execConfig.opinion,
    predictfun: !!execConfig.predictfun,
  }, 'Worker configuration');

  const worker = createExecutionWorker({
    redis,
    concurrency,
    executionService,
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down worker');
    await worker.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('Execution worker ready - waiting for jobs');
}

main().catch((error) => {
  logger.error({ error }, 'Worker failed to start');
  process.exit(1);
});
