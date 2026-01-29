/**
 * Health Check Endpoint
 */

import type { Env } from '../config';

export function handleHealthCheck(env: Env): Response {
  const status = {
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    services: {
      telegram: !!env.TELEGRAM_BOT_TOKEN,
      discord: !!env.DISCORD_PUBLIC_KEY,
      slack: !!env.SLACK_BOT_TOKEN,
      kalshi: !!env.KALSHI_API_KEY_ID,
      anthropic: !!env.ANTHROPIC_API_KEY,
    },
  };

  return Response.json(status);
}
