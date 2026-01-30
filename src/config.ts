/**
 * Environment bindings and configuration for Cloudflare Workers
 */

export interface Env {
  // D1 Database
  DB: D1Database;

  // KV for market cache
  CACHE: KVNamespace;

  // Durable Objects
  SESSION: DurableObjectNamespace;

  // Secrets (set via wrangler secret put)
  ANTHROPIC_API_KEY: string;
  TELEGRAM_BOT_TOKEN?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_BOT_TOKEN?: string;
  SLACK_SIGNING_SECRET?: string;
  SLACK_BOT_TOKEN?: string;
  KALSHI_API_KEY_ID?: string;
  KALSHI_PRIVATE_KEY?: string;

  // Vars
  ENVIRONMENT: string;
}

// Cache TTLs in seconds
export const CACHE_TTL = {
  MARKET: 60,           // 1 minute
  SEARCH: 300,          // 5 minutes
  ORDERBOOK: 30,        // 30 seconds
  LEADERBOARD: 3600,    // 1 hour
} as const;

// Platform API URLs
export const API_URLS = {
  POLYMARKET_REST: 'https://clob.polymarket.com',
  POLYMARKET_GAMMA: 'https://gamma-api.polymarket.com',
  KALSHI_API: 'https://api.elections.kalshi.com/trade-api/v2',
  MANIFOLD_API: 'https://api.manifold.markets/v0',
} as const;
