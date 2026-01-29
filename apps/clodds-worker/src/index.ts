/**
 * Clodds Worker - Main Entry Point
 *
 * Handles:
 * - Webhook routes for Telegram, Discord, Slack
 * - REST API endpoints for markets/arbitrage
 * - Cron trigger for arbitrage scanning
 */

import type { Env } from './config';
import { handleTelegramWebhook } from './channels/telegram';
import { handleDiscordInteraction } from './channels/discord';
import { handleSlackEvent } from './channels/slack';
import { handleMarketsApi } from './api/markets';
import { handleArbitrageApi } from './api/arbitrage';
import { handleHealthCheck } from './api/health';
import { scanArbitrage } from './cron/arbitrage';

export { SessionDO } from './durable/session';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Health check
      if (path === '/api/health' || path === '/health') {
        return handleHealthCheck(env);
      }

      // Webhook handlers
      if (path === '/webhook/telegram' && request.method === 'POST') {
        return handleTelegramWebhook(request, env, ctx);
      }

      if (path === '/webhook/discord' && request.method === 'POST') {
        return handleDiscordInteraction(request, env, ctx);
      }

      if (path === '/webhook/slack' && request.method === 'POST') {
        return handleSlackEvent(request, env, ctx);
      }

      // REST API
      if (path.startsWith('/api/markets')) {
        return handleMarketsApi(request, env, path);
      }

      if (path.startsWith('/api/arbitrage')) {
        return handleArbitrageApi(request, env, path);
      }

      // Root path
      if (path === '/') {
        return new Response(JSON.stringify({
          name: 'clodds-worker',
          version: '0.1.0',
          endpoints: {
            health: '/api/health',
            markets: '/api/markets/*',
            arbitrage: '/api/arbitrage/*',
            webhooks: ['/webhook/telegram', '/webhook/discord', '/webhook/slack'],
          },
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('Request error:', error);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Run arbitrage scan every 5 minutes
    ctx.waitUntil(scanArbitrage(env));
  },
};
