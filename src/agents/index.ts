/**
 * Agent Manager
 * Handles AI agent instances and message routing
 */

import Anthropic from '@anthropic-ai/sdk';
import { spawn, ChildProcess, execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Session, IncomingMessage, OutgoingMessage, Config, Alert, Platform, TradingContext, PolymarketCredentials, KalshiCredentials, ManifoldCredentials } from '../types';
import { logger } from '../utils/logger';
import { createSkillManager, SkillManager } from '../skills/loader';
import { FeedManager } from '../feeds';
import { Database } from '../db';
import { CredentialsManager, createCredentialsManager } from '../credentials';
import { SessionManager } from '../sessions';
import { MemoryService } from '../memory';
import { RateLimiter, RateLimitConfig, access, AccessControl } from '../security/index';
import { hooks, HooksService, AgentHookContext, ToolHookContext, ToolCallResult, AgentStartResult, CompactionContext } from '../hooks/index';
import { createContextManager, ContextManager, estimateTokens, ContextConfig } from '../memory/context';

// Background process tracking
const backgroundProcesses: Map<string, {
  process: ChildProcess;
  name: string;
  startedAt: Date;
  userId: string;
  logs: string[];
}> = new Map();

export interface AgentContext {
  session: Session;
  feeds: FeedManager;
  db: Database;
  skills: SkillManager;
  credentials: CredentialsManager;
  tradingContext: TradingContext | null;  // null if user hasn't set up credentials
  sendMessage: (msg: OutgoingMessage) => Promise<void>;
  /** Add message to conversation history */
  addToHistory: (role: 'user' | 'assistant', content: string) => void;
  /** Clear conversation history */
  clearHistory: () => void;
}

export interface AgentManager {
  handleMessage: (message: IncomingMessage, session: Session) => Promise<string>;
  dispose: () => void;
}

const SYSTEM_PROMPT = `You are Clodds, an AI assistant for prediction markets. Claude + Odds.

You help users:
- Track prediction markets across platforms (Polymarket, Kalshi, Manifold, Metaculus, PredictIt)
- Manage their portfolio and positions
- Set up price alerts
- Research markets (base rates, resolution rules, historical data)
- Find edge (comparing market prices to external models like 538, CME FedWatch)
- Monitor news that affects markets

Be concise and direct. Use data when available. Format responses for chat (keep it readable on mobile).

When presenting prices, use cents format (e.g., "45¢" not "0.45").
When presenting changes, use percentage format (e.g., "+5.2%").

{{SKILLS}}

Available platforms: polymarket, kalshi, manifold, metaculus, predictit

Remember: You're chatting via Telegram/Discord. Keep responses concise but informative.`;

// JSON Schema type for tool input schemas (supports nested objects/arrays)
type JsonSchemaProperty = {
  type: string;
  description?: string;
  enum?: (string | number | boolean)[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: unknown;
};

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
}

// Type guard for Polymarket credentials
function isPolymarketCredentials(creds: PolymarketCredentials | KalshiCredentials | ManifoldCredentials): creds is PolymarketCredentials {
  return 'privateKey' in creds && 'funderAddress' in creds;
}

// Type guard for Kalshi credentials
function isKalshiCredentials(creds: PolymarketCredentials | KalshiCredentials | ManifoldCredentials): creds is KalshiCredentials {
  return 'email' in creds && 'password' in creds;
}

// Type guard for Manifold credentials
function isManifoldCredentials(creds: PolymarketCredentials | KalshiCredentials | ManifoldCredentials): creds is ManifoldCredentials {
  return 'apiKey' in creds && !('privateKey' in creds);
}

// Generic API response type - uses any for dynamic API data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = any;

function buildTools(): ToolDefinition[] {
  return [
    // Market tools
    {
      name: 'search_markets',
      description: 'Search prediction markets by keyword across all platforms. Returns top results with current prices.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "Trump 2028", "Fed rate cut", "Bitcoin 100k")' },
          platform: {
            type: 'string',
            description: 'Optional: filter to specific platform',
            enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit'],
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_market',
      description: 'Get detailed info about a specific market including all outcomes and prices',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'The market ID or slug' },
          platform: {
            type: 'string',
            description: 'The platform',
            enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit'],
          },
        },
        required: ['market_id', 'platform'],
      },
    },

    // Portfolio tools
    {
      name: 'get_portfolio',
      description: 'Get user\'s portfolio: all positions with current value and P&L',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'add_position',
      description: 'Manually track a position (for platforms without API sync)',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Platform name' },
          market_id: { type: 'string', description: 'Market ID' },
          market_question: { type: 'string', description: 'Market question text' },
          outcome: { type: 'string', description: 'Outcome name (e.g., "Yes", "No", "Trump")' },
          side: { type: 'string', description: 'YES or NO', enum: ['YES', 'NO'] },
          shares: { type: 'number', description: 'Number of shares' },
          avg_price: { type: 'number', description: 'Average entry price (0.0-1.0)' },
        },
        required: ['platform', 'market_id', 'market_question', 'outcome', 'side', 'shares', 'avg_price'],
      },
    },

    // Alert tools
    {
      name: 'create_alert',
      description: 'Create a price alert for a market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          platform: { type: 'string', description: 'Platform' },
          market_name: { type: 'string', description: 'Market name (for display)' },
          condition_type: {
            type: 'string',
            description: 'Alert condition',
            enum: ['price_above', 'price_below', 'price_change_pct'],
          },
          threshold: { type: 'number', description: 'Threshold (0.0-1.0 for price, percentage for change)' },
        },
        required: ['market_id', 'platform', 'condition_type', 'threshold'],
      },
    },
    {
      name: 'list_alerts',
      description: 'List all active alerts for the user',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'delete_alert',
      description: 'Delete an alert',
      input_schema: {
        type: 'object',
        properties: {
          alert_id: { type: 'string', description: 'Alert ID to delete' },
        },
        required: ['alert_id'],
      },
    },

    // News tools
    {
      name: 'get_recent_news',
      description: 'Get recent market-moving news',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of items (default 10)' },
        },
      },
    },
    {
      name: 'search_news',
      description: 'Search news by keyword',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_news_for_market',
      description: 'Get news relevant to a specific market',
      input_schema: {
        type: 'object',
        properties: {
          market_question: { type: 'string', description: 'The market question to find news for' },
        },
        required: ['market_question'],
      },
    },

    // Edge detection tools
    {
      name: 'analyze_edge',
      description: 'Analyze potential edge by comparing market price to external models (538, CME FedWatch, polls)',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          market_question: { type: 'string', description: 'Market question' },
          current_price: { type: 'number', description: 'Current market price (0.0-1.0)' },
          category: {
            type: 'string',
            description: 'Market category for finding relevant external data',
            enum: ['politics', 'economics', 'sports', 'other'],
          },
        },
        required: ['market_id', 'market_question', 'current_price', 'category'],
      },
    },
    {
      name: 'calculate_kelly',
      description: 'Calculate Kelly criterion bet sizing given edge estimate',
      input_schema: {
        type: 'object',
        properties: {
          market_price: { type: 'number', description: 'Current market price (0.0-1.0)' },
          estimated_probability: { type: 'number', description: 'Your estimated true probability (0.0-1.0)' },
          bankroll: { type: 'number', description: 'Available bankroll in dollars' },
        },
        required: ['market_price', 'estimated_probability', 'bankroll'],
      },
    },

    // ============================================
    // WHALE TRACKING & COPY TRADING TOOLS
    // ============================================

    {
      name: 'watch_wallet',
      description: 'Start tracking a wallet/user for real-time trade alerts. Get notified when they buy/sell.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (0x...) or username depending on platform' },
          platform: { type: 'string', description: 'Platform', enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit', 'drift'], default: 'polymarket' },
          nickname: { type: 'string', description: 'Optional nickname for this wallet (e.g., "Whale #1")' },
        },
        required: ['address'],
      },
    },
    {
      name: 'unwatch_wallet',
      description: 'Stop tracking a wallet address',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address to stop watching' },
        },
        required: ['address'],
      },
    },
    {
      name: 'list_watched_wallets',
      description: 'List all wallets you are currently tracking',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_wallet_trades',
      description: 'Get recent trades for a specific wallet/user',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address or username depending on platform' },
          platform: { type: 'string', description: 'Platform', enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit', 'drift'], default: 'polymarket' },
          limit: { type: 'number', description: 'Number of trades (default 20)' },
        },
        required: ['address'],
      },
    },
    {
      name: 'get_wallet_positions',
      description: 'Get current positions for a wallet/user',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address or username depending on platform' },
          platform: { type: 'string', description: 'Platform', enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit', 'drift'], default: 'polymarket' },
        },
        required: ['address'],
      },
    },
    {
      name: 'get_wallet_pnl',
      description: 'Get P&L stats for a wallet/user',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address or username depending on platform' },
          platform: { type: 'string', description: 'Platform', enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit', 'drift'], default: 'polymarket' },
        },
        required: ['address'],
      },
    },
    {
      name: 'get_top_traders',
      description: 'Get leaderboard of top traders/forecasters by profit, ROI, or accuracy',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Platform', enum: ['polymarket', 'kalshi', 'manifold', 'metaculus', 'predictit', 'drift'], default: 'polymarket' },
          sort_by: { type: 'string', description: 'Sort criteria', enum: ['profit', 'roi', 'volume', 'win_rate', 'accuracy'], default: 'profit' },
          period: { type: 'string', description: 'Time period', enum: ['24h', '7d', '30d', 'all'], default: '7d' },
          limit: { type: 'number', description: 'Number of traders (default 10)' },
        },
      },
    },
    {
      name: 'copy_trade',
      description: 'Copy a specific trade from a wallet (manual copy trading)',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet to copy from' },
          trade_id: { type: 'string', description: 'Trade ID to copy' },
          size_multiplier: { type: 'number', description: 'Size multiplier (0.1 = 10% of their size, 1.0 = same size)', default: 0.5 },
        },
        required: ['address', 'trade_id'],
      },
    },
    {
      name: 'enable_auto_copy',
      description: 'Enable automatic copy trading for a wallet',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet to auto-copy' },
          max_size: { type: 'number', description: 'Maximum position size per trade in dollars' },
          size_multiplier: { type: 'number', description: 'Size multiplier (0.1 = 10% of their size)', default: 0.5 },
          min_confidence: { type: 'number', description: 'Only copy if wallet has > this win rate (0-1)', default: 0.55 },
        },
        required: ['address', 'max_size'],
      },
    },
    {
      name: 'disable_auto_copy',
      description: 'Disable automatic copy trading for a wallet',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet to stop auto-copying' },
        },
        required: ['address'],
      },
    },
    {
      name: 'list_auto_copy',
      description: 'List all wallets with auto-copy enabled and their settings',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },

    // ============================================
    // ARBITRAGE & CROSS-PLATFORM TOOLS
    // ============================================

    {
      name: 'find_arbitrage',
      description: 'Find arbitrage opportunities where YES + NO prices sum to < 1 or cross-platform price discrepancies',
      input_schema: {
        type: 'object',
        properties: {
          min_edge: { type: 'number', description: 'Minimum edge % to report (default 1%)', default: 1 },
          platforms: {
            type: 'array',
            description: 'Platforms to scan',
            items: { type: 'string', enum: ['polymarket', 'kalshi', 'manifold'] },
          },
        },
      },
    },
    {
      name: 'compare_prices',
      description: 'Compare prices for the same event across multiple platforms',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query to find matching markets' },
        },
        required: ['query'],
      },
    },
    {
      name: 'execute_arbitrage',
      description: 'Execute a YES+NO arbitrage trade (buy both YES and NO when sum < $1 for guaranteed profit)',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID or slug to arbitrage' },
          platform: { type: 'string', description: 'Platform', enum: ['polymarket'], default: 'polymarket' },
          size: { type: 'number', description: 'Size in dollars per side' },
        },
        required: ['market_id', 'size'],
      },
    },

    // ============================================
    // PAPER TRADING MODE
    // ============================================

    {
      name: 'paper_trading_mode',
      description: 'Enable or disable paper trading mode. In paper mode, all trades are simulated.',
      input_schema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'true to enable paper trading, false to use real money' },
          starting_balance: { type: 'number', description: 'Starting virtual balance (default $10,000)', default: 10000 },
        },
        required: ['enabled'],
      },
    },
    {
      name: 'paper_balance',
      description: 'Get current paper trading balance and P&L',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'paper_positions',
      description: 'Get all paper trading positions',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'paper_reset',
      description: 'Reset paper trading account to starting balance',
      input_schema: {
        type: 'object',
        properties: {
          starting_balance: { type: 'number', description: 'New starting balance', default: 10000 },
        },
      },
    },
    {
      name: 'paper_history',
      description: 'Get paper trading trade history and performance stats',
      input_schema: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Time period', enum: ['24h', '7d', '30d', 'all'], default: 'all' },
        },
      },
    },

    // ============================================
    // WHALE ALERTS & NOTIFICATIONS
    // ============================================

    {
      name: 'whale_alerts',
      description: 'Enable or configure whale alerts for large trades',
      input_schema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'Enable whale alerts' },
          min_size: { type: 'number', description: 'Minimum trade size to alert (in dollars)', default: 10000 },
          markets: { type: 'array', description: 'Market IDs to watch (empty = all markets)', items: { type: 'string' } },
        },
        required: ['enabled'],
      },
    },
    {
      name: 'new_market_alerts',
      description: 'Get alerts when new markets are created',
      input_schema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'Enable new market alerts' },
          categories: {
            type: 'array',
            description: 'Categories to watch (empty = all)',
            items: { type: 'string', enum: ['politics', 'crypto', 'sports', 'entertainment', 'science', 'economics'] },
          },
        },
        required: ['enabled'],
      },
    },
    {
      name: 'volume_spike_alerts',
      description: 'Get alerts when markets have unusual volume spikes',
      input_schema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'Enable volume spike alerts' },
          threshold_multiplier: { type: 'number', description: 'Alert when volume is X times normal (default 3)', default: 3 },
        },
        required: ['enabled'],
      },
    },

    // ============================================
    // TRADING EXECUTION TOOLS
    // ============================================

    // Polymarket trading
    {
      name: 'polymarket_buy',
      description: 'Buy shares on Polymarket. Executes a real trade using py_clob_client.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID of the outcome to buy (get from search_markets)' },
          price: { type: 'number', description: 'Price per share (0.01-0.99)' },
          size: { type: 'number', description: 'Number of shares to buy' },
        },
        required: ['token_id', 'price', 'size'],
      },
    },
    {
      name: 'polymarket_sell',
      description: 'Sell shares on Polymarket. Executes a real trade.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID of the outcome to sell' },
          size: { type: 'number', description: 'Number of shares to sell' },
          price: { type: 'number', description: 'Price per share (0.01 for market sell)' },
        },
        required: ['token_id', 'size'],
      },
    },
    {
      name: 'polymarket_positions',
      description: 'Get current Polymarket positions and USDC balance',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'polymarket_cancel_all',
      description: 'Cancel all open orders on Polymarket',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'polymarket_orderbook',
      description: 'Get orderbook for a Polymarket token - shows best bid/ask, spread, and depth. Public endpoint - no credentials required. Essential for checking prices before trading.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to get orderbook for' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_balance',
      description: 'Get USDC balance on Polymarket (available funds for trading)',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'polymarket_cancel',
      description: 'Cancel a specific order on Polymarket by order ID',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID to cancel' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'polymarket_orders',
      description: 'Get all open orders on Polymarket',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'polymarket_market_sell',
      description: 'Market sell - immediately sell shares at best available price (0.01). If size not specified, sells entire position.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to sell' },
          size: { type: 'number', description: 'Number of shares to sell (omit to sell all)' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_market_buy',
      description: 'Market buy - spend a specific USDC amount to buy shares at current ask price. Uses FOK (fill or kill) for immediate execution.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to buy' },
          amount: { type: 'number', description: 'USDC amount to spend (e.g., 50 for $50)' },
        },
        required: ['token_id', 'amount'],
      },
    },
    {
      name: 'polymarket_maker_buy',
      description: 'POST-ONLY maker buy - places order that MUST add liquidity (sit on book). If order would cross spread, it gets REJECTED instead of taking. Use this to avoid taker fees (1-1.5% on 15-min crypto) and earn maker rebates.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to buy' },
          price: { type: 'number', description: 'Price (0.01-0.99). Must be BELOW current ask to be maker.' },
          size: { type: 'number', description: 'Number of shares' },
        },
        required: ['token_id', 'price', 'size'],
      },
    },
    {
      name: 'polymarket_maker_sell',
      description: 'POST-ONLY maker sell - places order that MUST add liquidity (sit on book). If order would cross spread, it gets REJECTED instead of taking. Use this to avoid taker fees (1-1.5% on 15-min crypto) and earn maker rebates.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to sell' },
          price: { type: 'number', description: 'Price (0.01-0.99). Must be ABOVE current bid to be maker.' },
          size: { type: 'number', description: 'Number of shares' },
        },
        required: ['token_id', 'price', 'size'],
      },
    },
    {
      name: 'polymarket_fee_rate',
      description: 'Check if a market has trading fees. 15-minute crypto markets (BTC/ETH/SOL/XRP) have 1-1.5% taker fees. Regular markets have 0% fees.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to check' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_midpoint',
      description: 'Get the midpoint price for a token (average of best bid and ask). Faster than full orderbook.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_spread',
      description: 'Get the bid-ask spread for a token. Shows how much slippage you might face.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_last_trade',
      description: 'Get the last trade price for a token.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_tick_size',
      description: 'Get the tick size (minimum price increment) for a token. Returns "0.1", "0.01", "0.001", or "0.0001".',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_trades',
      description: 'Get trade history for your account. Shows recent fills with prices and sizes.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market (condition_id)' },
          token_id: { type: 'string', description: 'Optional: filter by token' },
        },
      },
    },
    {
      name: 'polymarket_cancel_market',
      description: 'Cancel all orders for a specific market or token. More targeted than cancel_all.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market condition_id to cancel orders for' },
          token_id: { type: 'string', description: 'Optional: specific token to cancel' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'polymarket_estimate_fill',
      description: 'Estimate the fill price for a market order before executing. Shows expected slippage.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
          side: { type: 'string', description: 'BUY or SELL', enum: ['BUY', 'SELL'] },
          amount: { type: 'number', description: 'Amount (USDC for BUY, shares for SELL)' },
        },
        required: ['token_id', 'side', 'amount'],
      },
    },
    {
      name: 'polymarket_market_info',
      description: 'Get detailed info about a market by condition_id. Shows all outcomes, tokens, volume, liquidity.',
      input_schema: {
        type: 'object',
        properties: {
          condition_id: { type: 'string', description: 'Market condition ID' },
        },
        required: ['condition_id'],
      },
    },

    // ========== HEALTH & CONFIG ==========
    {
      name: 'polymarket_health',
      description: 'Check if Polymarket CLOB server is up and running.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_server_time',
      description: 'Get Polymarket server timestamp.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_get_address',
      description: 'Get your signer wallet address.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_collateral_address',
      description: 'Get the USDC contract address on Polygon.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_conditional_address',
      description: 'Get the Conditional Token Framework (CTF) contract address.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_exchange_address',
      description: 'Get the exchange contract address.',
      input_schema: {
        type: 'object',
        properties: {
          neg_risk: { type: 'boolean', description: 'If true, returns neg_risk exchange (for crypto markets)' },
        },
      },
    },

    // ========== ADDITIONAL MARKET DATA ==========
    {
      name: 'polymarket_price',
      description: 'Get the best price for a specific side (BUY or SELL).',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
          side: { type: 'string', description: 'BUY or SELL', enum: ['BUY', 'SELL'] },
        },
        required: ['token_id', 'side'],
      },
    },
    {
      name: 'polymarket_neg_risk',
      description: 'Check if a token is in a negative risk market (crypto 15-min markets).',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
        },
        required: ['token_id'],
      },
    },

    // ========== BATCH MARKET DATA ==========
    {
      name: 'polymarket_midpoints_batch',
      description: 'Get midpoint prices for multiple tokens at once.',
      input_schema: {
        type: 'object',
        properties: {
          token_ids: { type: 'array', items: { type: 'string' }, description: 'Array of token IDs' },
        },
        required: ['token_ids'],
      },
    },
    {
      name: 'polymarket_prices_batch',
      description: 'Get best prices for multiple tokens at once.',
      input_schema: {
        type: 'object',
        properties: {
          requests: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                token_id: { type: 'string' },
                side: { type: 'string', enum: ['BUY', 'SELL'] },
              },
            },
            description: 'Array of {token_id, side} objects',
          },
        },
        required: ['requests'],
      },
    },
    {
      name: 'polymarket_spreads_batch',
      description: 'Get spreads for multiple tokens at once.',
      input_schema: {
        type: 'object',
        properties: {
          token_ids: { type: 'array', items: { type: 'string' }, description: 'Array of token IDs' },
        },
        required: ['token_ids'],
      },
    },
    {
      name: 'polymarket_orderbooks_batch',
      description: 'Get orderbooks for multiple tokens at once.',
      input_schema: {
        type: 'object',
        properties: {
          token_ids: { type: 'array', items: { type: 'string' }, description: 'Array of token IDs' },
        },
        required: ['token_ids'],
      },
    },
    {
      name: 'polymarket_last_trades_batch',
      description: 'Get last trade prices for multiple tokens at once.',
      input_schema: {
        type: 'object',
        properties: {
          token_ids: { type: 'array', items: { type: 'string' }, description: 'Array of token IDs' },
        },
        required: ['token_ids'],
      },
    },

    // ========== MARKET DISCOVERY ==========
    {
      name: 'polymarket_markets',
      description: 'Get all active markets from the CLOB (paginated).',
      input_schema: {
        type: 'object',
        properties: {
          next_cursor: { type: 'string', description: 'Pagination cursor for next page' },
        },
      },
    },
    {
      name: 'polymarket_simplified_markets',
      description: 'Get simplified market list with less detail.',
      input_schema: {
        type: 'object',
        properties: {
          next_cursor: { type: 'string', description: 'Pagination cursor' },
        },
      },
    },
    {
      name: 'polymarket_sampling_markets',
      description: 'Get featured/sampling markets.',
      input_schema: {
        type: 'object',
        properties: {
          next_cursor: { type: 'string', description: 'Pagination cursor' },
        },
      },
    },
    {
      name: 'polymarket_market_trades_events',
      description: 'Get trade events for a specific market.',
      input_schema: {
        type: 'object',
        properties: {
          condition_id: { type: 'string', description: 'Market condition ID' },
        },
        required: ['condition_id'],
      },
    },

    // ========== ORDER OPERATIONS ==========
    {
      name: 'polymarket_get_order',
      description: 'Get details of a specific order by ID.',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'polymarket_post_orders_batch',
      description: 'Post multiple orders at once (batch).',
      input_schema: {
        type: 'object',
        properties: {
          orders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                token_id: { type: 'string' },
                price: { type: 'number' },
                size: { type: 'number' },
                side: { type: 'string', enum: ['BUY', 'SELL'] },
              },
            },
            description: 'Array of order objects',
          },
        },
        required: ['orders'],
      },
    },
    {
      name: 'polymarket_cancel_orders_batch',
      description: 'Cancel multiple orders at once by IDs.',
      input_schema: {
        type: 'object',
        properties: {
          order_ids: { type: 'array', items: { type: 'string' }, description: 'Array of order IDs to cancel' },
        },
        required: ['order_ids'],
      },
    },

    // ========== API KEY MANAGEMENT ==========
    {
      name: 'polymarket_create_api_key',
      description: 'Create a new API key for your wallet.',
      input_schema: {
        type: 'object',
        properties: {
          nonce: { type: 'number', description: 'Nonce for key derivation (default 0)' },
        },
      },
    },
    {
      name: 'polymarket_derive_api_key',
      description: 'Derive existing API key if you lost credentials but have private key.',
      input_schema: {
        type: 'object',
        properties: {
          nonce: { type: 'number', description: 'Nonce used when creating (default 0)' },
        },
      },
    },
    {
      name: 'polymarket_get_api_keys',
      description: 'List all your API keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_delete_api_key',
      description: 'Delete your current API key.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_create_readonly_api_key',
      description: 'Create a read-only API key (can view but not trade).',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_get_readonly_api_keys',
      description: 'List all read-only API keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_delete_readonly_api_key',
      description: 'Delete a read-only API key.',
      input_schema: {
        type: 'object',
        properties: {
          api_key: { type: 'string', description: 'The read-only API key to delete' },
        },
        required: ['api_key'],
      },
    },
    {
      name: 'polymarket_validate_readonly_api_key',
      description: 'Validate a read-only API key (public endpoint).',
      input_schema: {
        type: 'object',
        properties: {
          api_key: { type: 'string', description: 'The read-only API key to validate' },
        },
        required: ['api_key'],
      },
    },

    // ========== BALANCE & ALLOWANCE ==========
    {
      name: 'polymarket_get_balance_allowance',
      description: 'Get current balance and trading allowance for USDC or conditional tokens.',
      input_schema: {
        type: 'object',
        properties: {
          asset_type: { type: 'string', description: 'COLLATERAL (USDC) or CONDITIONAL (tokens)', enum: ['COLLATERAL', 'CONDITIONAL'] },
          token_id: { type: 'string', description: 'Token ID (required for CONDITIONAL)' },
        },
        required: ['asset_type'],
      },
    },
    {
      name: 'polymarket_update_balance_allowance',
      description: 'Refresh your balance and allowance cache.',
      input_schema: {
        type: 'object',
        properties: {
          asset_type: { type: 'string', description: 'COLLATERAL (USDC) or CONDITIONAL (tokens)', enum: ['COLLATERAL', 'CONDITIONAL'] },
          token_id: { type: 'string', description: 'Token ID (required for CONDITIONAL)' },
        },
        required: ['asset_type'],
      },
    },

    // ========== ADVANCED FEATURES ==========
    {
      name: 'polymarket_heartbeat',
      description: 'Send heartbeat to keep orders alive. If not sent within 10s, all orders cancelled.',
      input_schema: {
        type: 'object',
        properties: {
          heartbeat_id: { type: 'string', description: 'Heartbeat ID from previous call (omit for first call)' },
        },
      },
    },
    {
      name: 'polymarket_is_order_scoring',
      description: 'Check if an order is scoring (earning rewards).',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID to check' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'polymarket_are_orders_scoring',
      description: 'Check if multiple orders are scoring.',
      input_schema: {
        type: 'object',
        properties: {
          order_ids: { type: 'array', items: { type: 'string' }, description: 'Order IDs to check' },
        },
        required: ['order_ids'],
      },
    },
    {
      name: 'polymarket_notifications',
      description: 'Get your notifications.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_drop_notifications',
      description: 'Delete/dismiss notifications.',
      input_schema: {
        type: 'object',
        properties: {
          notification_ids: { type: 'array', items: { type: 'string' }, description: 'Notification IDs to delete' },
        },
        required: ['notification_ids'],
      },
    },
    {
      name: 'polymarket_closed_only_mode',
      description: 'Check if CLOB is in closed-only mode (no new orders).',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_orderbook_hash',
      description: 'Get the hash of an orderbook (for detecting changes efficiently).',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'polymarket_sampling_simplified_markets',
      description: 'Get sampling (featured) markets in simplified format for display.',
      input_schema: {
        type: 'object',
        properties: {
          next_cursor: { type: 'string', description: 'Pagination cursor (omit for first page)' },
        },
      },
    },

    // Polymarket Gamma API - Events & Markets
    {
      name: 'polymarket_event',
      description: 'Get event details by ID from Polymarket Gamma API.',
      input_schema: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Event ID' },
        },
        required: ['event_id'],
      },
    },
    {
      name: 'polymarket_event_by_slug',
      description: 'Get event details by slug from Polymarket Gamma API.',
      input_schema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Event slug (URL-friendly name)' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'polymarket_events',
      description: 'Get list of events from Polymarket. Returns active/open events by default.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 20)' },
          offset: { type: 'number', description: 'Pagination offset (default 0)' },
        },
      },
    },
    {
      name: 'polymarket_search_events',
      description: 'Search Polymarket events by keyword.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'polymarket_event_tags',
      description: 'Get tags associated with an event.',
      input_schema: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Event ID' },
        },
        required: ['event_id'],
      },
    },
    {
      name: 'polymarket_market_by_slug',
      description: 'Get market details by slug from Polymarket Gamma API.',
      input_schema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Market slug (URL-friendly name)' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'polymarket_market_tags',
      description: 'Get tags associated with a market.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market/condition ID' },
        },
        required: ['market_id'],
      },
    },

    // Polymarket Gamma API - Series
    {
      name: 'polymarket_series',
      description: 'Get series by ID or list all series (grouped events like "2024 Election").',
      input_schema: {
        type: 'object',
        properties: {
          series_id: { type: 'string', description: 'Series ID (optional, lists all if omitted)' },
        },
      },
    },
    {
      name: 'polymarket_series_list',
      description: 'Get list of all series.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },

    // Polymarket Gamma API - Tags
    {
      name: 'polymarket_tags',
      description: 'Get list of all tags used to categorize markets.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'polymarket_tag',
      description: 'Get tag details by ID.',
      input_schema: {
        type: 'object',
        properties: {
          tag_id: { type: 'string', description: 'Tag ID' },
        },
        required: ['tag_id'],
      },
    },
    {
      name: 'polymarket_tag_by_slug',
      description: 'Get tag details by slug.',
      input_schema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Tag slug' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'polymarket_tag_relations',
      description: 'Get related tags for a tag.',
      input_schema: {
        type: 'object',
        properties: {
          tag_id: { type: 'string', description: 'Tag ID' },
        },
        required: ['tag_id'],
      },
    },

    // Polymarket Gamma API - Sports
    {
      name: 'polymarket_sports',
      description: 'Get list of all sports/betting categories on Polymarket.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_teams',
      description: 'Get list of teams, optionally filtered by sport.',
      input_schema: {
        type: 'object',
        properties: {
          sport: { type: 'string', description: 'Sport to filter by (optional)' },
        },
      },
    },

    // Polymarket Gamma API - Comments
    {
      name: 'polymarket_comments',
      description: 'Get comments on a market.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market/condition ID' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'polymarket_user_comments',
      description: 'Get comments made by a user.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['address'],
      },
    },

    // Polymarket Data API - Portfolio & Analytics
    {
      name: 'polymarket_positions_value',
      description: 'Get total value of positions for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (optional, uses configured if omitted)' },
        },
      },
    },
    {
      name: 'polymarket_closed_positions',
      description: 'Get closed/settled positions for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (optional)' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'polymarket_pnl_timeseries',
      description: 'Get P&L over time for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (optional)' },
          interval: { type: 'string', description: 'Time interval: 1h, 1d, 1w, 1m (default 1d)' },
        },
      },
    },
    {
      name: 'polymarket_overall_pnl',
      description: 'Get overall/total P&L for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (optional)' },
        },
      },
    },
    {
      name: 'polymarket_user_rank',
      description: 'Get leaderboard rank for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (optional)' },
        },
      },
    },
    {
      name: 'polymarket_leaderboard',
      description: 'Get top traders leaderboard.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 100)' },
        },
      },
    },
    {
      name: 'polymarket_top_holders',
      description: 'Get top holders for a market.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market/condition ID' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'polymarket_user_activity',
      description: 'Get activity feed for an address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address (optional)' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'polymarket_open_interest',
      description: 'Get open interest for a market.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market/condition ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'polymarket_live_volume',
      description: 'Get live trading volume, optionally for a specific event.',
      input_schema: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Event ID (optional)' },
        },
      },
    },
    {
      name: 'polymarket_price_history',
      description: 'Get historical price data for a token.',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
          interval: { type: 'string', description: 'Time interval: 1m, 5m, 15m, 1h, 4h, 1d (default 1h)' },
          limit: { type: 'number', description: 'Number of data points (default 100)' },
        },
        required: ['token_id'],
      },
    },

    // Polymarket Rewards API
    {
      name: 'polymarket_daily_rewards',
      description: 'Get your daily reward earnings from market making.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'polymarket_market_rewards',
      description: 'Get rewards info for a specific market.',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market/condition ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'polymarket_reward_markets',
      description: 'Get list of markets with active reward programs.',
      input_schema: { type: 'object', properties: {} },
    },

    // Polymarket Profiles API
    {
      name: 'polymarket_profile',
      description: 'Get public profile for a wallet address.',
      input_schema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address' },
        },
        required: ['address'],
      },
    },

    // Kalshi trading
    {
      name: 'kalshi_buy',
      description: 'Buy contracts on Kalshi. Executes a real trade.',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker (e.g., INXD-24JAN10-T5805)' },
          side: { type: 'string', description: 'yes or no', enum: ['yes', 'no'] },
          count: { type: 'number', description: 'Number of contracts' },
          price: { type: 'number', description: 'Price in cents (1-99)' },
        },
        required: ['ticker', 'side', 'count', 'price'],
      },
    },
    {
      name: 'kalshi_sell',
      description: 'Sell contracts on Kalshi. Executes a real trade.',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker' },
          side: { type: 'string', description: 'yes or no', enum: ['yes', 'no'] },
          count: { type: 'number', description: 'Number of contracts' },
          price: { type: 'number', description: 'Price in cents (1-99)' },
        },
        required: ['ticker', 'side', 'count', 'price'],
      },
    },
    {
      name: 'kalshi_positions',
      description: 'Get current Kalshi positions and balance',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'kalshi_search',
      description: 'Search for Kalshi markets',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (optional)' },
          status: { type: 'string', description: 'Market status filter', enum: ['open', 'closed', 'settled'] },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
    {
      name: 'kalshi_market',
      description: 'Get detailed information about a specific Kalshi market',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker (e.g., FED-24MAR-T525)' },
        },
        required: ['ticker'],
      },
    },
    {
      name: 'kalshi_balance',
      description: 'Get Kalshi account balance',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'kalshi_orders',
      description: 'Get all open orders on Kalshi',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'kalshi_cancel',
      description: 'Cancel a Kalshi order',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID to cancel' },
        },
        required: ['order_id'],
      },
    },

    // ========== KALSHI - EXCHANGE INFO ==========
    {
      name: 'kalshi_exchange_status',
      description: 'Get current Kalshi exchange operational status (trading hours, maintenance)',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_exchange_schedule',
      description: 'Get Kalshi trading hours and schedule',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_announcements',
      description: 'Get platform-wide Kalshi announcements',
      input_schema: { type: 'object', properties: {} },
    },

    // ========== KALSHI - MARKET DATA ==========
    {
      name: 'kalshi_orderbook',
      description: 'Get orderbook (bid/ask depth) for a Kalshi market',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker' },
        },
        required: ['ticker'],
      },
    },
    {
      name: 'kalshi_market_trades',
      description: 'Get recent trades for a market or across all markets',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker (optional - omit for all markets)' },
          limit: { type: 'number', description: 'Max trades to return (default 100)' },
        },
      },
    },
    {
      name: 'kalshi_candlesticks',
      description: 'Get candlestick/OHLC data for price history',
      input_schema: {
        type: 'object',
        properties: {
          series_ticker: { type: 'string', description: 'Series ticker (e.g., FED)' },
          ticker: { type: 'string', description: 'Market ticker' },
          interval: { type: 'number', description: 'Interval: 1 (1min), 60 (1hr), or 1440 (1day)', enum: [1, 60, 1440] },
        },
        required: ['series_ticker', 'ticker'],
      },
    },

    // ========== KALSHI - EVENTS & SERIES ==========
    {
      name: 'kalshi_events',
      description: 'List Kalshi events (groups of related markets)',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status', enum: ['open', 'closed', 'settled'] },
          series_ticker: { type: 'string', description: 'Filter by series' },
        },
      },
    },
    {
      name: 'kalshi_event',
      description: 'Get specific event with all its markets',
      input_schema: {
        type: 'object',
        properties: {
          event_ticker: { type: 'string', description: 'Event ticker' },
        },
        required: ['event_ticker'],
      },
    },
    {
      name: 'kalshi_series',
      description: 'List all Kalshi series (categories of events)',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter by category (optional)' },
        },
      },
    },
    {
      name: 'kalshi_series_info',
      description: 'Get specific series details',
      input_schema: {
        type: 'object',
        properties: {
          series_ticker: { type: 'string', description: 'Series ticker' },
        },
        required: ['series_ticker'],
      },
    },

    // ========== KALSHI - ADVANCED TRADING ==========
    {
      name: 'kalshi_market_order',
      description: 'Place a market order (immediate execution at best price)',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker' },
          side: { type: 'string', description: 'yes or no', enum: ['yes', 'no'] },
          action: { type: 'string', description: 'buy or sell', enum: ['buy', 'sell'] },
          count: { type: 'number', description: 'Number of contracts' },
        },
        required: ['ticker', 'side', 'action', 'count'],
      },
    },
    {
      name: 'kalshi_batch_create_orders',
      description: 'Create multiple orders in one request (up to 20)',
      input_schema: {
        type: 'object',
        properties: {
          orders: { type: 'array', description: 'Array of order objects with ticker, side, action, count, type, yes_price' },
        },
        required: ['orders'],
      },
    },
    {
      name: 'kalshi_batch_cancel_orders',
      description: 'Cancel multiple orders in one request',
      input_schema: {
        type: 'object',
        properties: {
          order_ids: { type: 'array', items: { type: 'string' }, description: 'Array of order IDs to cancel' },
        },
        required: ['order_ids'],
      },
    },
    {
      name: 'kalshi_cancel_all',
      description: 'Cancel ALL open orders on Kalshi',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_get_order',
      description: 'Get details of a specific order',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'kalshi_amend_order',
      description: 'Modify an existing order price and/or count',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID to modify' },
          price: { type: 'number', description: 'New price in cents (optional)' },
          count: { type: 'number', description: 'New contract count (optional)' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'kalshi_decrease_order',
      description: 'Reduce the quantity of an existing order',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID to modify' },
          reduce_by: { type: 'number', description: 'Number of contracts to reduce by' },
        },
        required: ['order_id', 'reduce_by'],
      },
    },
    {
      name: 'kalshi_queue_position',
      description: 'Get queue position for a resting order (how many contracts ahead)',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'kalshi_queue_positions',
      description: 'Get queue positions for all resting orders',
      input_schema: { type: 'object', properties: {} },
    },

    // ========== KALSHI - PORTFOLIO ==========
    {
      name: 'kalshi_fills',
      description: 'Get trade fills (executed trades history)',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Filter by market ticker (optional)' },
          limit: { type: 'number', description: 'Max fills to return (default 100)' },
        },
      },
    },
    {
      name: 'kalshi_settlements',
      description: 'Get settlement history (resolved positions)',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max settlements to return (default 100)' },
        },
      },
    },

    // ========== KALSHI - ACCOUNT ==========
    {
      name: 'kalshi_account_limits',
      description: 'Get API rate limits for your account tier',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_api_keys',
      description: 'List all API keys for your Kalshi account',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_create_api_key',
      description: 'Generate a new API key (returns private key once - save it!)',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_delete_api_key',
      description: 'Delete an API key',
      input_schema: {
        type: 'object',
        properties: {
          api_key: { type: 'string', description: 'API key to delete' },
        },
        required: ['api_key'],
      },
    },

    // Kalshi Exchange Info Extended
    {
      name: 'kalshi_fee_changes',
      description: 'Get upcoming series fee changes on Kalshi',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_user_data_timestamp',
      description: 'Get timestamp of last user data update (useful for caching)',
      input_schema: { type: 'object', properties: {} },
    },

    // Kalshi Market Data Batch
    {
      name: 'kalshi_batch_candlesticks',
      description: 'Get candlesticks for multiple Kalshi markets in one request',
      input_schema: {
        type: 'object',
        properties: {
          tickers: { type: 'array', description: 'Array of {series_ticker, ticker, period_interval} objects' },
        },
        required: ['tickers'],
      },
    },

    // Kalshi Events Extended
    {
      name: 'kalshi_event_metadata',
      description: 'Get metadata for a Kalshi event (rules, resolution criteria)',
      input_schema: {
        type: 'object',
        properties: {
          event_ticker: { type: 'string', description: 'Event ticker' },
        },
        required: ['event_ticker'],
      },
    },
    {
      name: 'kalshi_event_candlesticks',
      description: 'Get candlestick data for a Kalshi event',
      input_schema: {
        type: 'object',
        properties: {
          series_ticker: { type: 'string', description: 'Series ticker' },
          event_ticker: { type: 'string', description: 'Event ticker' },
          interval: { type: 'number', description: 'Interval: 1 (min), 60 (hour), 1440 (day)', default: 60 },
        },
        required: ['series_ticker', 'event_ticker'],
      },
    },
    {
      name: 'kalshi_forecast_history',
      description: 'Get forecast percentile history for a Kalshi event',
      input_schema: {
        type: 'object',
        properties: {
          series_ticker: { type: 'string', description: 'Series ticker' },
          event_ticker: { type: 'string', description: 'Event ticker' },
        },
        required: ['series_ticker', 'event_ticker'],
      },
    },
    {
      name: 'kalshi_multivariate_events',
      description: 'Get multivariate events (events with multiple correlated markets)',
      input_schema: { type: 'object', properties: {} },
    },

    // Kalshi Order Groups (Bracket/OCO Orders)
    {
      name: 'kalshi_create_order_group',
      description: 'Create an order group (bracket/OCO orders) on Kalshi',
      input_schema: {
        type: 'object',
        properties: {
          orders: { type: 'array', description: 'Array of order objects' },
          max_loss: { type: 'number', description: 'Max loss in cents (optional)' },
        },
        required: ['orders'],
      },
    },
    {
      name: 'kalshi_order_groups',
      description: 'List all Kalshi order groups',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_order_group',
      description: 'Get a specific Kalshi order group',
      input_schema: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Order group ID' },
        },
        required: ['group_id'],
      },
    },
    {
      name: 'kalshi_order_group_limit',
      description: 'Update max loss limit for a Kalshi order group',
      input_schema: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Order group ID' },
          max_loss: { type: 'number', description: 'Max loss in cents' },
        },
        required: ['group_id', 'max_loss'],
      },
    },
    {
      name: 'kalshi_order_group_trigger',
      description: 'Manually trigger a Kalshi order group',
      input_schema: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Order group ID' },
        },
        required: ['group_id'],
      },
    },
    {
      name: 'kalshi_order_group_reset',
      description: 'Reset a Kalshi order group to initial state',
      input_schema: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Order group ID' },
        },
        required: ['group_id'],
      },
    },
    {
      name: 'kalshi_delete_order_group',
      description: 'Delete a Kalshi order group',
      input_schema: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Order group ID' },
        },
        required: ['group_id'],
      },
    },

    // Kalshi Portfolio Extended
    {
      name: 'kalshi_resting_order_value',
      description: 'Get total value of resting orders on Kalshi',
      input_schema: { type: 'object', properties: {} },
    },

    // Kalshi Subaccounts
    {
      name: 'kalshi_create_subaccount',
      description: 'Create a new Kalshi subaccount',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Subaccount name' },
        },
        required: ['name'],
      },
    },
    {
      name: 'kalshi_subaccount_balances',
      description: 'Get balances for all Kalshi subaccounts',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_subaccount_transfer',
      description: 'Transfer funds between Kalshi subaccounts',
      input_schema: {
        type: 'object',
        properties: {
          from_id: { type: 'string', description: 'Source subaccount ID' },
          to_id: { type: 'string', description: 'Destination subaccount ID' },
          amount: { type: 'number', description: 'Amount in cents' },
        },
        required: ['from_id', 'to_id', 'amount'],
      },
    },
    {
      name: 'kalshi_subaccount_transfers',
      description: 'Get transfer history between Kalshi subaccounts',
      input_schema: { type: 'object', properties: {} },
    },

    // Kalshi Communications (RFQ/Quotes - Block Trading)
    {
      name: 'kalshi_comms_id',
      description: 'Get your Kalshi communications/RFQ user ID',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_create_rfq',
      description: 'Create a Request for Quote (RFQ) on Kalshi for block trading',
      input_schema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Market ticker' },
          side: { type: 'string', description: 'yes or no', enum: ['yes', 'no'] },
          count: { type: 'number', description: 'Number of contracts' },
          min_price: { type: 'number', description: 'Min acceptable price in cents (optional)' },
          max_price: { type: 'number', description: 'Max acceptable price in cents (optional)' },
        },
        required: ['ticker', 'side', 'count'],
      },
    },
    {
      name: 'kalshi_rfqs',
      description: 'List all your Kalshi RFQs',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_rfq',
      description: 'Get a specific Kalshi RFQ',
      input_schema: {
        type: 'object',
        properties: {
          rfq_id: { type: 'string', description: 'RFQ ID' },
        },
        required: ['rfq_id'],
      },
    },
    {
      name: 'kalshi_cancel_rfq',
      description: 'Cancel a Kalshi RFQ',
      input_schema: {
        type: 'object',
        properties: {
          rfq_id: { type: 'string', description: 'RFQ ID' },
        },
        required: ['rfq_id'],
      },
    },
    {
      name: 'kalshi_create_quote',
      description: 'Create a quote in response to a Kalshi RFQ',
      input_schema: {
        type: 'object',
        properties: {
          rfq_id: { type: 'string', description: 'RFQ ID to respond to' },
          price: { type: 'number', description: 'Price in cents' },
        },
        required: ['rfq_id', 'price'],
      },
    },
    {
      name: 'kalshi_quotes',
      description: 'List all your Kalshi quotes',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_quote',
      description: 'Get a specific Kalshi quote',
      input_schema: {
        type: 'object',
        properties: {
          quote_id: { type: 'string', description: 'Quote ID' },
        },
        required: ['quote_id'],
      },
    },
    {
      name: 'kalshi_cancel_quote',
      description: 'Cancel a Kalshi quote',
      input_schema: {
        type: 'object',
        properties: {
          quote_id: { type: 'string', description: 'Quote ID' },
        },
        required: ['quote_id'],
      },
    },
    {
      name: 'kalshi_accept_quote',
      description: 'Accept a Kalshi quote (as the RFQ creator)',
      input_schema: {
        type: 'object',
        properties: {
          quote_id: { type: 'string', description: 'Quote ID' },
        },
        required: ['quote_id'],
      },
    },
    {
      name: 'kalshi_confirm_quote',
      description: 'Confirm a Kalshi quote (as quote creator, after acceptance)',
      input_schema: {
        type: 'object',
        properties: {
          quote_id: { type: 'string', description: 'Quote ID' },
        },
        required: ['quote_id'],
      },
    },

    // Kalshi Multivariate Collections
    {
      name: 'kalshi_collections',
      description: 'List all Kalshi multivariate event collections',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_collection',
      description: 'Get a specific Kalshi multivariate collection',
      input_schema: {
        type: 'object',
        properties: {
          collection_ticker: { type: 'string', description: 'Collection ticker' },
        },
        required: ['collection_ticker'],
      },
    },
    {
      name: 'kalshi_collection_lookup',
      description: 'Get market lookup for a Kalshi multivariate collection',
      input_schema: {
        type: 'object',
        properties: {
          collection_ticker: { type: 'string', description: 'Collection ticker' },
        },
        required: ['collection_ticker'],
      },
    },
    {
      name: 'kalshi_collection_lookup_history',
      description: 'Get lookup history for a Kalshi multivariate collection',
      input_schema: {
        type: 'object',
        properties: {
          collection_ticker: { type: 'string', description: 'Collection ticker' },
        },
        required: ['collection_ticker'],
      },
    },

    // Kalshi Live Data
    {
      name: 'kalshi_live_data',
      description: 'Get live data for a Kalshi milestone (weather, sports, etc)',
      input_schema: {
        type: 'object',
        properties: {
          data_type: { type: 'string', description: 'Type of data (e.g., weather, sports)' },
          milestone_id: { type: 'string', description: 'Milestone ID' },
        },
        required: ['data_type', 'milestone_id'],
      },
    },
    {
      name: 'kalshi_live_data_batch',
      description: 'Get live data for multiple Kalshi milestones in batch',
      input_schema: {
        type: 'object',
        properties: {
          requests: { type: 'array', description: 'Array of {type, milestone_id} objects' },
        },
        required: ['requests'],
      },
    },

    // Kalshi Milestones
    {
      name: 'kalshi_milestones',
      description: 'List all Kalshi milestones',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_milestone',
      description: 'Get a specific Kalshi milestone',
      input_schema: {
        type: 'object',
        properties: {
          milestone_id: { type: 'string', description: 'Milestone ID' },
        },
        required: ['milestone_id'],
      },
    },

    // Kalshi Structured Targets
    {
      name: 'kalshi_structured_targets',
      description: 'List all Kalshi structured targets',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_structured_target',
      description: 'Get a specific Kalshi structured target',
      input_schema: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'Structured target ID' },
        },
        required: ['target_id'],
      },
    },

    // Kalshi Incentives
    {
      name: 'kalshi_incentives',
      description: 'Get available Kalshi incentive programs',
      input_schema: { type: 'object', properties: {} },
    },

    // Kalshi FCM (Futures Commission Merchant)
    {
      name: 'kalshi_fcm_orders',
      description: 'Get Kalshi FCM orders (for institutional accounts)',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_fcm_positions',
      description: 'Get Kalshi FCM positions (for institutional accounts)',
      input_schema: { type: 'object', properties: {} },
    },

    // Kalshi Search/Discovery
    {
      name: 'kalshi_search_tags',
      description: 'Get Kalshi search tags organized by category',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'kalshi_search_sports',
      description: 'Get Kalshi sports filters for search',
      input_schema: { type: 'object', properties: {} },
    },

    // Manifold betting
    {
      name: 'manifold_bet',
      description: 'Place a bet on Manifold Markets using Mana',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          amount: { type: 'number', description: 'Mana amount to bet' },
          outcome: { type: 'string', description: 'YES or NO', enum: ['YES', 'NO'] },
          limit_prob: { type: 'number', description: 'Optional limit order probability (0.0-1.0)' },
        },
        required: ['market_id', 'amount', 'outcome'],
      },
    },
    {
      name: 'manifold_sell',
      description: 'Sell shares on Manifold Markets',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          outcome: { type: 'string', description: 'YES or NO', enum: ['YES', 'NO'] },
          shares: { type: 'number', description: 'Number of shares (omit to sell all)' },
        },
        required: ['market_id', 'outcome'],
      },
    },
    {
      name: 'manifold_search',
      description: 'Search for Manifold markets',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'manifold_market',
      description: 'Get detailed information about a Manifold market by ID or slug',
      input_schema: {
        type: 'object',
        properties: {
          id_or_slug: { type: 'string', description: 'Market ID or slug' },
        },
        required: ['id_or_slug'],
      },
    },
    {
      name: 'manifold_balance',
      description: 'Get your Mana balance on Manifold',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'manifold_positions',
      description: 'Get your current positions on Manifold Markets',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'manifold_bets',
      description: 'Get your bet history on Manifold',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Filter by market ID (optional)' },
        },
      },
    },
    {
      name: 'manifold_cancel',
      description: 'Cancel a limit order on Manifold',
      input_schema: {
        type: 'object',
        properties: {
          bet_id: { type: 'string', description: 'Bet ID to cancel' },
        },
        required: ['bet_id'],
      },
    },
    {
      name: 'manifold_multiple_choice',
      description: 'Place a bet on a multiple choice market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          answer_id: { type: 'string', description: 'Answer ID to bet on' },
          amount: { type: 'number', description: 'Mana amount' },
        },
        required: ['market_id', 'answer_id', 'amount'],
      },
    },

    // ============================================
    // MANIFOLD - USER ENDPOINTS
    // ============================================
    {
      name: 'manifold_get_user',
      description: 'Get a Manifold user by their username',
      input_schema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Username to look up' },
        },
        required: ['username'],
      },
    },
    {
      name: 'manifold_get_user_lite',
      description: 'Get basic display info for a Manifold user',
      input_schema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Username to look up' },
        },
        required: ['username'],
      },
    },
    {
      name: 'manifold_get_user_by_id',
      description: 'Get a Manifold user by their ID',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID to look up' },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'manifold_get_user_by_id_lite',
      description: 'Get basic display info for a Manifold user by ID',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID to look up' },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'manifold_get_me',
      description: 'Get your own Manifold user profile with full details',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'manifold_get_user_portfolio',
      description: 'Get live portfolio metrics for a Manifold user',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID (optional, defaults to self)' },
        },
      },
    },
    {
      name: 'manifold_get_user_portfolio_history',
      description: 'Get portfolio value history for a Manifold user',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID' },
          period: { type: 'string', description: 'Time period: daily, weekly, monthly, allTime', enum: ['daily', 'weekly', 'monthly', 'allTime'] },
        },
        required: ['user_id', 'period'],
      },
    },
    {
      name: 'manifold_list_users',
      description: 'List Manifold users ordered by creation date descending',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 1000)' },
          before: { type: 'string', description: 'Cursor for pagination' },
        },
      },
    },

    // ============================================
    // MANIFOLD - GROUP/TOPIC ENDPOINTS
    // ============================================
    {
      name: 'manifold_get_groups',
      description: 'List all Manifold topics/groups ordered by creation date',
      input_schema: {
        type: 'object',
        properties: {
          before_time: { type: 'number', description: 'Unix timestamp for pagination' },
          available_to_user_id: { type: 'string', description: 'Filter to groups available to this user' },
        },
      },
    },
    {
      name: 'manifold_get_group',
      description: 'Get a Manifold topic/group by slug',
      input_schema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Group slug' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'manifold_get_group_by_id',
      description: 'Get a Manifold topic/group by ID',
      input_schema: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Group ID' },
        },
        required: ['group_id'],
      },
    },

    // ============================================
    // MANIFOLD - MARKET ENDPOINTS (EXTENDED)
    // ============================================
    {
      name: 'manifold_list_markets',
      description: 'List Manifold markets with filtering and sorting',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 500)' },
          sort: { type: 'string', description: 'Sort field', enum: ['created-time', 'updated-time', 'last-bet-time', 'last-comment-time'] },
          order: { type: 'string', description: 'Sort order', enum: ['asc', 'desc'] },
          before: { type: 'string', description: 'Cursor for pagination' },
          user_id: { type: 'string', description: 'Filter by creator user ID' },
          group_id: { type: 'string', description: 'Filter by group/topic ID' },
        },
      },
    },
    {
      name: 'manifold_get_market_by_slug',
      description: 'Get a Manifold market by its URL slug',
      input_schema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Market slug from URL' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'manifold_get_probability',
      description: 'Get current probability for a market (max 1s cache)',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'manifold_get_probabilities',
      description: 'Get probabilities for multiple markets at once',
      input_schema: {
        type: 'object',
        properties: {
          market_ids: { type: 'array', items: { type: 'string' }, description: 'Array of market IDs' },
        },
        required: ['market_ids'],
      },
    },
    {
      name: 'manifold_get_market_positions',
      description: 'Get position information for a market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          order: { type: 'string', description: 'Sort by profit or shares', enum: ['profit', 'shares'] },
          top: { type: 'number', description: 'Get top N positions' },
          bottom: { type: 'number', description: 'Get bottom N positions' },
          user_id: { type: 'string', description: 'Filter by specific user' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'manifold_get_user_metrics',
      description: 'Get user contract metrics with corresponding contract data',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID' },
          limit: { type: 'number', description: 'Max results' },
          offset: { type: 'number', description: 'Offset for pagination' },
          order: { type: 'string', description: 'Sort order', enum: ['desc', 'asc'] },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'manifold_create_market',
      description: 'Create a new Manifold market (requires auth)',
      input_schema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Market question' },
          outcome_type: { type: 'string', description: 'Market type', enum: ['BINARY', 'MULTIPLE_CHOICE', 'PSEUDO_NUMERIC', 'POLL', 'BOUNTIED_QUESTION'] },
          description: { type: 'string', description: 'Market description (markdown)' },
          close_time: { type: 'number', description: 'Unix timestamp when market closes' },
          initial_prob: { type: 'number', description: 'Initial probability for binary (1-99)' },
          min: { type: 'number', description: 'Min value for numeric markets' },
          max: { type: 'number', description: 'Max value for numeric markets' },
          answers: { type: 'array', items: { type: 'string' }, description: 'Answers for multiple choice' },
          group_ids: { type: 'array', items: { type: 'string' }, description: 'Topic IDs to add market to' },
          visibility: { type: 'string', description: 'Market visibility', enum: ['public', 'unlisted'] },
        },
        required: ['question', 'outcome_type'],
      },
    },
    {
      name: 'manifold_add_answer',
      description: 'Add an answer to a multiple choice market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          text: { type: 'string', description: 'Answer text' },
        },
        required: ['market_id', 'text'],
      },
    },
    {
      name: 'manifold_add_liquidity',
      description: 'Add Mana to a market liquidity pool',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          amount: { type: 'number', description: 'Mana amount to add' },
        },
        required: ['market_id', 'amount'],
      },
    },
    {
      name: 'manifold_add_bounty',
      description: 'Add bounty reward to a market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          amount: { type: 'number', description: 'Mana amount to add as bounty' },
        },
        required: ['market_id', 'amount'],
      },
    },
    {
      name: 'manifold_award_bounty',
      description: 'Award bounty to a comment/answer',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          comment_id: { type: 'string', description: 'Comment ID to award' },
          amount: { type: 'number', description: 'Mana amount to award' },
        },
        required: ['market_id', 'comment_id', 'amount'],
      },
    },
    {
      name: 'manifold_close_market',
      description: 'Set or update the close time for a market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          close_time: { type: 'number', description: 'Unix timestamp for new close time' },
        },
        required: ['market_id', 'close_time'],
      },
    },
    {
      name: 'manifold_manage_topic',
      description: 'Add or remove a topic tag from a market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          group_id: { type: 'string', description: 'Topic/group ID' },
          remove: { type: 'boolean', description: 'Set true to remove instead of add' },
        },
        required: ['market_id', 'group_id'],
      },
    },
    {
      name: 'manifold_resolve_market',
      description: 'Resolve a market you created',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          outcome: { type: 'string', description: 'Resolution: YES, NO, MKT, CANCEL (or answerId for MC)' },
          probability_int: { type: 'number', description: 'For MKT resolution: probability 0-100' },
        },
        required: ['market_id', 'outcome'],
      },
    },

    // ============================================
    // MANIFOLD - BETTING ENDPOINTS (EXTENDED)
    // ============================================
    {
      name: 'manifold_multi_bet',
      description: 'Place multiple YES bets on a sums-to-one multiple choice market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          answer_ids: { type: 'array', items: { type: 'string' }, description: 'Answer IDs to bet on' },
          amount: { type: 'number', description: 'Total Mana amount' },
        },
        required: ['market_id', 'answer_ids', 'amount'],
      },
    },

    // ============================================
    // MANIFOLD - COMMENT ENDPOINTS
    // ============================================
    {
      name: 'manifold_get_comments',
      description: 'Get comments for a market or user',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Filter by market ID' },
          market_slug: { type: 'string', description: 'Filter by market slug' },
          user_id: { type: 'string', description: 'Filter by user ID' },
          limit: { type: 'number', description: 'Max results (default 1000)' },
          page: { type: 'number', description: 'Page number for pagination' },
        },
      },
    },
    {
      name: 'manifold_create_comment',
      description: 'Create a comment on a market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          content: { type: 'string', description: 'Comment content (markdown)' },
        },
        required: ['market_id', 'content'],
      },
    },

    // ============================================
    // MANIFOLD - TRANSACTION ENDPOINTS
    // ============================================
    {
      name: 'manifold_get_transactions',
      description: 'Get transaction history',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 100)' },
          offset: { type: 'number', description: 'Offset for pagination' },
          before: { type: 'string', description: 'Get transactions before this ID' },
          after: { type: 'string', description: 'Get transactions after this ID' },
          to_id: { type: 'string', description: 'Filter by recipient' },
          from_id: { type: 'string', description: 'Filter by sender' },
          category: { type: 'string', description: 'Filter by category' },
        },
      },
    },
    {
      name: 'manifold_send_mana',
      description: 'Send Mana to other users',
      input_schema: {
        type: 'object',
        properties: {
          to_ids: { type: 'array', items: { type: 'string' }, description: 'User IDs to send to' },
          amount: { type: 'number', description: 'Mana amount per recipient' },
          message: { type: 'string', description: 'Optional message' },
        },
        required: ['to_ids', 'amount'],
      },
    },

    // ============================================
    // MANIFOLD - LEAGUE ENDPOINTS
    // ============================================
    {
      name: 'manifold_get_leagues',
      description: 'Get league standings for a user or season',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID to get standings for' },
          season: { type: 'number', description: 'Season number' },
          cohort: { type: 'string', description: 'Cohort name' },
        },
      },
    },

    // ============================================
    // METACULUS (Forecasting Platform - Read Only)
    // ============================================
    {
      name: 'metaculus_search',
      description: 'Search for Metaculus forecasting questions',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term' },
          status: { type: 'string', description: 'Question status', enum: ['open', 'closed', 'resolved'] },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'metaculus_question',
      description: 'Get details about a Metaculus question by ID',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'string', description: 'Question ID' },
        },
        required: ['question_id'],
      },
    },
    {
      name: 'metaculus_tournaments',
      description: 'List Metaculus tournaments/competitions',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'metaculus_tournament_questions',
      description: 'Get questions in a Metaculus tournament',
      input_schema: {
        type: 'object',
        properties: {
          tournament_id: { type: 'string', description: 'Tournament ID' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
        required: ['tournament_id'],
      },
    },

    // ============================================
    // PREDICTIT (Read Only - No Trading API)
    // ============================================
    {
      name: 'predictit_search',
      description: 'Search for PredictIt markets',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'predictit_market',
      description: 'Get details about a PredictIt market by ID',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'predictit_all_markets',
      description: 'Get all PredictIt markets (full snapshot)',
      input_schema: { type: 'object', properties: {} },
    },

    // ============================================
    // DRIFT BET (Solana Prediction Markets - Read Only)
    // ============================================
    {
      name: 'drift_search',
      description: 'Search for Drift BET prediction markets on Solana',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term' },
        },
        required: ['query'],
      },
    },
    {
      name: 'drift_market',
      description: 'Get details about a Drift BET market by index',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'string', description: 'Market index' },
        },
        required: ['market_index'],
      },
    },
    {
      name: 'drift_all_markets',
      description: 'Get all Drift BET markets',
      input_schema: { type: 'object', properties: {} },
    },

    // ============================================
    // COINGECKO API (Crypto Prices - like Clawdbot's crypto-price)
    // ============================================

    {
      name: 'coingecko_price',
      description: 'Get current price for a cryptocurrency. Returns price in USD plus 24h change.',
      input_schema: {
        type: 'object',
        properties: {
          coin_id: { type: 'string', description: 'CoinGecko coin ID (e.g., bitcoin, ethereum, solana)' },
          include_market_cap: { type: 'boolean', description: 'Include market cap data (default false)' },
          include_24hr_vol: { type: 'boolean', description: 'Include 24h volume (default false)' },
        },
        required: ['coin_id'],
      },
    },
    {
      name: 'coingecko_prices',
      description: 'Get prices for multiple cryptocurrencies at once',
      input_schema: {
        type: 'object',
        properties: {
          coin_ids: { type: 'string', description: 'Comma-separated coin IDs (e.g., bitcoin,ethereum,solana)' },
          vs_currency: { type: 'string', description: 'Target currency (default: usd)' },
        },
        required: ['coin_ids'],
      },
    },
    {
      name: 'coingecko_coin_info',
      description: 'Get detailed info about a cryptocurrency including description, links, market data',
      input_schema: {
        type: 'object',
        properties: {
          coin_id: { type: 'string', description: 'CoinGecko coin ID' },
        },
        required: ['coin_id'],
      },
    },
    {
      name: 'coingecko_market_chart',
      description: 'Get historical price data for charting (OHLC candles)',
      input_schema: {
        type: 'object',
        properties: {
          coin_id: { type: 'string', description: 'CoinGecko coin ID' },
          days: { type: 'string', description: 'Number of days (1, 7, 14, 30, 90, 180, 365, max)' },
          interval: { type: 'string', description: 'Data interval: daily, hourly (auto-selected based on days if not specified)' },
        },
        required: ['coin_id', 'days'],
      },
    },
    {
      name: 'coingecko_trending',
      description: 'Get trending cryptocurrencies (top 7 by search popularity)',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'coingecko_search',
      description: 'Search for coins by name or symbol',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., bitcoin, btc, ethereum)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'coingecko_markets',
      description: 'Get top cryptocurrencies by market cap with prices and 24h changes',
      input_schema: {
        type: 'object',
        properties: {
          per_page: { type: 'number', description: 'Number of results (default 100, max 250)' },
          page: { type: 'number', description: 'Page number (default 1)' },
          order: { type: 'string', description: 'Sort order', enum: ['market_cap_desc', 'market_cap_asc', 'volume_desc', 'volume_asc'] },
        },
      },
    },
    {
      name: 'coingecko_global',
      description: 'Get global crypto market data (total market cap, BTC dominance, etc.)',
      input_schema: { type: 'object', properties: {} },
    },

    // ============================================
    // YAHOO FINANCE API (Stocks - like Clawdbot's yahoo-finance)
    // ============================================

    {
      name: 'yahoo_quote',
      description: 'Get real-time stock quote with price, change, volume, market cap',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol (e.g., AAPL, GOOGL, TSLA)' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'yahoo_quotes',
      description: 'Get quotes for multiple stocks at once',
      input_schema: {
        type: 'object',
        properties: {
          symbols: { type: 'string', description: 'Comma-separated ticker symbols (e.g., AAPL,GOOGL,MSFT)' },
        },
        required: ['symbols'],
      },
    },
    {
      name: 'yahoo_chart',
      description: 'Get historical price data for a stock (OHLCV)',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol' },
          range: { type: 'string', description: 'Time range', enum: ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max'] },
          interval: { type: 'string', description: 'Data interval', enum: ['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo'] },
        },
        required: ['symbol', 'range'],
      },
    },
    {
      name: 'yahoo_search',
      description: 'Search for stock tickers by company name',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (company name or partial ticker)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'yahoo_options',
      description: 'Get options chain data for a stock',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol' },
          expiration: { type: 'string', description: 'Expiration date (YYYY-MM-DD), omit for nearest expiration' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'yahoo_news',
      description: 'Get recent news articles for a stock',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'yahoo_fundamentals',
      description: 'Get fundamental data: P/E, EPS, dividend yield, revenue, etc.',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'yahoo_earnings',
      description: 'Get earnings history and upcoming earnings date',
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol' },
        },
        required: ['symbol'],
      },
    },

    // ============================================
    // OPINION.TRADE API (BNB Chain Prediction Market)
    // ============================================

    {
      name: 'opinion_markets',
      description: 'List all Opinion.trade prediction markets with optional filters',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status', enum: ['active', 'resolved', 'all'] },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'opinion_market',
      description: 'Get detailed info about a specific Opinion.trade market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'opinion_price',
      description: 'Get latest trade price for an Opinion.trade token',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID (yes or no token)' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'opinion_orderbook',
      description: 'Get orderbook depth for an Opinion.trade token',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
          depth: { type: 'number', description: 'Orderbook depth (default 10)' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'opinion_price_history',
      description: 'Get historical prices for an Opinion.trade token',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID' },
          interval: { type: 'string', description: 'Time interval', enum: ['1h', '4h', '1d', '1w'] },
          limit: { type: 'number', description: 'Number of data points (default 100)' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'opinion_quote_tokens',
      description: 'List available quote tokens (currencies) on Opinion.trade',
      input_schema: { type: 'object', properties: {} },
    },
    // Opinion.trade TRADING tools (requires SDK/wallet)
    {
      name: 'opinion_place_order',
      description: 'Place a buy or sell order on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          token_id: { type: 'string', description: 'Token ID (YES or NO token)' },
          side: { type: 'string', description: 'Order side', enum: ['BUY', 'SELL'] },
          order_type: { type: 'string', description: 'Order type', enum: ['LIMIT', 'MARKET'] },
          price: { type: 'number', description: 'Limit price (0.01-0.99), ignored for MARKET orders' },
          amount: { type: 'number', description: 'Amount in quote token (e.g., USDT)' },
        },
        required: ['market_id', 'token_id', 'side', 'order_type', 'amount'],
      },
    },
    {
      name: 'opinion_cancel_order',
      description: 'Cancel an open order on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID to cancel' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'opinion_cancel_all_orders',
      description: 'Cancel all open orders on Opinion.trade, optionally filtered by market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: only cancel orders for this market' },
          side: { type: 'string', description: 'Optional: only cancel BUY or SELL orders', enum: ['BUY', 'SELL'] },
        },
      },
    },
    {
      name: 'opinion_orders',
      description: 'Get your open orders on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market' },
          status: { type: 'string', description: 'Order status filter', enum: ['open', 'filled', 'cancelled', 'all'] },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
    {
      name: 'opinion_positions',
      description: 'Get your positions on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market' },
        },
      },
    },
    {
      name: 'opinion_balances',
      description: 'Get your token balances on Opinion.trade',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'opinion_trades',
      description: 'Get your trade history on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'opinion_redeem',
      description: 'Redeem winnings from a resolved Opinion.trade market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID to redeem from' },
        },
        required: ['market_id'],
      },
    },
    // Opinion.trade - MISSING METHODS (8 added for 100% API coverage)
    {
      name: 'opinion_categorical_market',
      description: 'Get detailed info for a categorical (multi-outcome) Opinion.trade market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'number', description: 'Categorical market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'opinion_fee_rates',
      description: 'Get maker/taker fee rates for an Opinion.trade token',
      input_schema: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to check fees for' },
        },
        required: ['token_id'],
      },
    },
    {
      name: 'opinion_order_by_id',
      description: 'Get full details for a specific Opinion.trade order',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'opinion_place_orders_batch',
      description: 'Place multiple orders on Opinion.trade in a single batch',
      input_schema: {
        type: 'object',
        properties: {
          orders: {
            type: 'array',
            description: 'Array of orders to place',
            items: {
              type: 'object',
              properties: {
                market_id: { type: 'string', description: 'Market ID' },
                token_id: { type: 'string', description: 'Token ID' },
                side: { type: 'string', enum: ['BUY', 'SELL'] },
                order_type: { type: 'string', enum: ['LIMIT', 'MARKET'] },
                price: { type: 'number', description: 'Price (0.01-0.99)' },
                amount: { type: 'number', description: 'Amount' },
              },
            },
          },
        },
        required: ['orders'],
      },
    },
    {
      name: 'opinion_cancel_orders_batch',
      description: 'Cancel multiple orders on Opinion.trade in a single batch',
      input_schema: {
        type: 'object',
        properties: {
          order_ids: {
            type: 'array',
            description: 'Array of order IDs to cancel',
            items: { type: 'string' },
          },
        },
        required: ['order_ids'],
      },
    },
    {
      name: 'opinion_enable_trading',
      description: 'Enable trading on Opinion.trade by approving tokens for exchange contract (one-time setup)',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'opinion_split',
      description: 'Split collateral (USDT) into YES+NO outcome tokens on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'number', description: 'Market ID' },
          amount: { type: 'number', description: 'Amount of collateral to split' },
        },
        required: ['market_id', 'amount'],
      },
    },
    {
      name: 'opinion_merge',
      description: 'Merge YES+NO outcome tokens back into collateral (USDT) on Opinion.trade',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'number', description: 'Market ID' },
          amount: { type: 'number', description: 'Amount of outcome tokens to merge' },
        },
        required: ['market_id', 'amount'],
      },
    },

    // ============================================
    // PREDICT.FUN API (BNB Chain Prediction Market)
    // ============================================

    {
      name: 'predictfun_markets',
      description: 'List Predict.fun prediction markets with pagination',
      input_schema: {
        type: 'object',
        properties: {
          first: { type: 'number', description: 'Number of results (default 50)' },
          after: { type: 'string', description: 'Cursor for pagination' },
        },
      },
    },
    {
      name: 'predictfun_market',
      description: 'Get detailed info about a specific Predict.fun market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'predictfun_orderbook',
      description: 'Get orderbook for a Predict.fun market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'predictfun_market_stats',
      description: 'Get statistics for a Predict.fun market (volume, liquidity)',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'predictfun_last_sale',
      description: 'Get last sale info for a Predict.fun market',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
        },
        required: ['market_id'],
      },
    },
    {
      name: 'predictfun_categories',
      description: 'List all Predict.fun market categories',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'predictfun_category',
      description: 'Get a specific category and its markets by slug',
      input_schema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Category slug (e.g., crypto, sports, politics)' },
        },
        required: ['slug'],
      },
    },
    // Predict.fun TRADING tools (requires API key + wallet)
    {
      name: 'predictfun_create_order',
      description: 'Create an order on Predict.fun (requires signed order via SDK)',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Market ID' },
          side: { type: 'string', description: 'Order side', enum: ['BUY', 'SELL'] },
          outcome: { type: 'string', description: 'Outcome to trade', enum: ['YES', 'NO'] },
          strategy: { type: 'string', description: 'Order strategy', enum: ['LIMIT', 'MARKET'] },
          price: { type: 'number', description: 'Price per share (0.01-0.99) for LIMIT orders' },
          amount: { type: 'number', description: 'Amount in USDT' },
          slippage_bps: { type: 'number', description: 'Slippage tolerance in basis points (default 100 = 1%)' },
        },
        required: ['market_id', 'side', 'outcome', 'strategy', 'amount'],
      },
    },
    {
      name: 'predictfun_cancel_orders',
      description: 'Cancel orders on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          order_hashes: { type: 'string', description: 'Comma-separated order hashes to cancel' },
        },
        required: ['order_hashes'],
      },
    },
    {
      name: 'predictfun_orders',
      description: 'Get your orders on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market' },
          status: { type: 'string', description: 'Order status', enum: ['open', 'filled', 'cancelled'] },
        },
      },
    },
    {
      name: 'predictfun_positions',
      description: 'Get your positions on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market' },
        },
      },
    },
    {
      name: 'predictfun_account',
      description: 'Get your Predict.fun account info',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'predictfun_activity',
      description: 'Get your trading activity on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    // Predict.fun - MISSING METHODS (6 added for 100% API coverage)
    {
      name: 'predictfun_order_by_hash',
      description: 'Get a specific order by its hash on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          order_hash: { type: 'string', description: 'Order hash' },
        },
        required: ['order_hash'],
      },
    },
    {
      name: 'predictfun_redeem_positions',
      description: 'Redeem winning positions from resolved Predict.fun markets',
      input_schema: {
        type: 'object',
        properties: {
          condition_id: { type: 'string', description: 'Condition ID from position' },
          index_set: { type: 'number', description: 'Index set (1 or 2)', enum: [1, 2] },
          amount: { type: 'number', description: 'Amount to redeem (optional, defaults to full balance)' },
        },
        required: ['condition_id', 'index_set'],
      },
    },
    {
      name: 'predictfun_merge_positions',
      description: 'Merge YES+NO positions back to collateral on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          condition_id: { type: 'string', description: 'Condition ID' },
          amount: { type: 'number', description: 'Amount of positions to merge' },
        },
        required: ['condition_id', 'amount'],
      },
    },
    {
      name: 'predictfun_set_approvals',
      description: 'Set token approvals for trading on Predict.fun (one-time setup)',
      input_schema: {
        type: 'object',
        properties: {
          is_yield_bearing: { type: 'boolean', description: 'For yield-bearing collateral (default false)' },
        },
      },
    },
    {
      name: 'predictfun_balance',
      description: 'Get your USDT balance on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'predictfun_matches',
      description: 'Get matched trades/fills for your orders on Predict.fun',
      input_schema: {
        type: 'object',
        properties: {
          market_id: { type: 'string', description: 'Optional: filter by market' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },

    // ============================================
    // DRIFT BET API (Solana Prediction Market) - EXPANDED
    // ============================================

    // Drift Gateway trading endpoints (self-hosted)
    {
      name: 'drift_place_order',
      description: 'Place an order on Drift BET prediction markets',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'number', description: 'Market index' },
          market_type: { type: 'string', description: 'Market type', enum: ['perp', 'spot'] },
          side: { type: 'string', description: 'Order side', enum: ['buy', 'sell'] },
          order_type: { type: 'string', description: 'Order type', enum: ['limit', 'market', 'oracle'] },
          price: { type: 'number', description: 'Price for limit orders' },
          amount: { type: 'number', description: 'Order size' },
          reduce_only: { type: 'boolean', description: 'Reduce only flag (default false)' },
          post_only: { type: 'boolean', description: 'Post only flag (default false)' },
        },
        required: ['market_index', 'market_type', 'side', 'order_type', 'amount'],
      },
    },
    {
      name: 'drift_cancel_order',
      description: 'Cancel an order on Drift',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'number', description: 'Order ID to cancel' },
          market_index: { type: 'number', description: 'Market index' },
          market_type: { type: 'string', description: 'Market type', enum: ['perp', 'spot'] },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'drift_cancel_all_orders',
      description: 'Cancel all orders on Drift, optionally filtered by market',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'number', description: 'Optional: market index filter' },
          market_type: { type: 'string', description: 'Optional: market type filter', enum: ['perp', 'spot'] },
        },
      },
    },
    {
      name: 'drift_orders',
      description: 'Get your open orders on Drift',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'number', description: 'Optional: filter by market' },
          market_type: { type: 'string', description: 'Optional: filter by type', enum: ['perp', 'spot'] },
        },
      },
    },
    {
      name: 'drift_positions',
      description: 'Get your positions on Drift',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'number', description: 'Optional: filter by market' },
        },
      },
    },
    {
      name: 'drift_balance',
      description: 'Get your collateral balance on Drift',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'drift_leverage',
      description: 'Get or set account leverage on Drift',
      input_schema: {
        type: 'object',
        properties: {
          set_leverage: { type: 'number', description: 'Optional: set new max leverage' },
        },
      },
    },
    {
      name: 'drift_orderbook',
      description: 'Get L2 orderbook for a Drift market',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'number', description: 'Market index' },
          market_type: { type: 'string', description: 'Market type', enum: ['perp', 'spot'] },
          depth: { type: 'number', description: 'Orderbook depth (default 10)' },
        },
        required: ['market_index', 'market_type'],
      },
    },
    // Drift - Additional methods for 100% coverage
    {
      name: 'drift_markets',
      description: 'Get all available Drift markets (spot and perp)',
      input_schema: {
        type: 'object',
        properties: {
          market_type: { type: 'string', description: 'Filter by type', enum: ['perp', 'spot'] },
        },
      },
    },
    {
      name: 'drift_market_info',
      description: 'Get detailed info for a specific Drift market',
      input_schema: {
        type: 'object',
        properties: {
          market_index: { type: 'number', description: 'Market index' },
        },
        required: ['market_index'],
      },
    },
    {
      name: 'drift_margin_info',
      description: 'Get account margin requirements on Drift',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'drift_collateral',
      description: 'Get maintenance collateral balance on Drift',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'drift_modify_order',
      description: 'Modify an existing order on Drift (change price/size)',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'number', description: 'Order ID to modify' },
          new_price: { type: 'number', description: 'New price' },
          new_size: { type: 'number', description: 'New size' },
        },
        required: ['order_id'],
      },
    },
    {
      name: 'drift_cancel_and_place',
      description: 'Atomically cancel existing orders and place new ones on Drift',
      input_schema: {
        type: 'object',
        properties: {
          cancel_order_ids: {
            type: 'array',
            description: 'Order IDs to cancel',
            items: { type: 'number' },
          },
          new_orders: {
            type: 'array',
            description: 'New orders to place',
            items: {
              type: 'object',
              properties: {
                market_index: { type: 'number' },
                market_type: { type: 'string' },
                side: { type: 'string' },
                order_type: { type: 'string' },
                price: { type: 'number' },
                amount: { type: 'number' },
              },
            },
          },
        },
        required: ['new_orders'],
      },
    },
    {
      name: 'drift_transaction_events',
      description: 'Get transaction history/events on Drift',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },

    // ============================================
    // METACULUS API (Forecasting Platform) - EXPANDED (127 endpoints)
    // ============================================

    {
      name: 'metaculus_submit_prediction',
      description: 'Submit a prediction/forecast to a Metaculus question',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'number', description: 'Question ID to predict on' },
          prediction: { type: 'number', description: 'Your prediction (0-1 for binary, or numeric value)' },
          confidence_lower: { type: 'number', description: 'Lower bound of confidence interval (for numeric questions)' },
          confidence_upper: { type: 'number', description: 'Upper bound of confidence interval (for numeric questions)' },
        },
        required: ['question_id', 'prediction'],
      },
    },
    {
      name: 'metaculus_my_predictions',
      description: 'Get your prediction history on Metaculus',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    // Metaculus - Additional endpoints for comprehensive coverage
    {
      name: 'metaculus_bulk_predict',
      description: 'Submit predictions to multiple Metaculus questions at once',
      input_schema: {
        type: 'object',
        properties: {
          predictions: {
            type: 'array',
            description: 'Array of predictions',
            items: {
              type: 'object',
              properties: {
                question_id: { type: 'number' },
                prediction: { type: 'number' },
              },
            },
          },
        },
        required: ['predictions'],
      },
    },
    {
      name: 'metaculus_prediction_history',
      description: 'Get prediction history for a specific Metaculus question',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'number', description: 'Question ID' },
        },
        required: ['question_id'],
      },
    },
    {
      name: 'metaculus_categories',
      description: 'List all Metaculus question categories',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'metaculus_category',
      description: 'Get a specific Metaculus category by ID',
      input_schema: {
        type: 'object',
        properties: {
          category_id: { type: 'number', description: 'Category ID' },
        },
        required: ['category_id'],
      },
    },
    {
      name: 'metaculus_comments',
      description: 'Get comments on a Metaculus question',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'number', description: 'Optional: filter by question' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'metaculus_post_comment',
      description: 'Post a comment on a Metaculus question',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'number', description: 'Question ID' },
          comment: { type: 'string', description: 'Comment text' },
          parent_id: { type: 'number', description: 'Optional: parent comment ID for replies' },
        },
        required: ['question_id', 'comment'],
      },
    },
    {
      name: 'metaculus_projects',
      description: 'List Metaculus projects/tournaments',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'metaculus_project',
      description: 'Get details for a specific Metaculus project',
      input_schema: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'Project ID' },
        },
        required: ['project_id'],
      },
    },
    {
      name: 'metaculus_project_questions',
      description: 'Get all questions in a Metaculus project',
      input_schema: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'Project ID' },
          status: { type: 'string', description: 'Filter by status', enum: ['open', 'closed', 'resolved'] },
        },
        required: ['project_id'],
      },
    },
    {
      name: 'metaculus_join_project',
      description: 'Join a Metaculus project/tournament',
      input_schema: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'Project ID to join' },
        },
        required: ['project_id'],
      },
    },
    {
      name: 'metaculus_notifications',
      description: 'Get your Metaculus notifications',
      input_schema: {
        type: 'object',
        properties: {
          unread_only: { type: 'boolean', description: 'Only show unread (default false)' },
        },
      },
    },
    {
      name: 'metaculus_mark_notifications_read',
      description: 'Mark Metaculus notifications as read',
      input_schema: {
        type: 'object',
        properties: {
          notification_ids: {
            type: 'array',
            description: 'Notification IDs to mark read (omit for all)',
            items: { type: 'number' },
          },
        },
      },
    },
    {
      name: 'metaculus_user_profile',
      description: 'Get a Metaculus user profile',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'number', description: 'User ID' },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'metaculus_user_stats',
      description: 'Get forecasting statistics for a Metaculus user',
      input_schema: {
        type: 'object',
        properties: {
          user_id: { type: 'number', description: 'User ID' },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'metaculus_leaderboard',
      description: 'Get Metaculus leaderboard/rankings',
      input_schema: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'Optional: project-specific leaderboard' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'metaculus_create_question',
      description: 'Create a new question on Metaculus (requires permissions)',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Question title' },
          description: { type: 'string', description: 'Full question description' },
          resolution_criteria: { type: 'string', description: 'How question will be resolved' },
          type: { type: 'string', description: 'Question type', enum: ['binary', 'numeric', 'date'] },
          close_time: { type: 'string', description: 'When predictions close (ISO date)' },
          resolve_time: { type: 'string', description: 'When question resolves (ISO date)' },
          project_id: { type: 'number', description: 'Optional: add to project' },
        },
        required: ['title', 'description', 'resolution_criteria', 'type', 'close_time', 'resolve_time'],
      },
    },
    {
      name: 'metaculus_about_numbers',
      description: 'Get Metaculus platform statistics (total questions, users, predictions)',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'metaculus_question_summaries',
      description: 'Get AI-generated summaries for Metaculus questions',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'number', description: 'Question ID' },
        },
        required: ['question_id'],
      },
    },
    {
      name: 'metaculus_vote',
      description: 'Vote on a Metaculus question (upvote/downvote)',
      input_schema: {
        type: 'object',
        properties: {
          question_id: { type: 'number', description: 'Question ID' },
          direction: { type: 'number', description: 'Vote direction: 1 (up), -1 (down), 0 (remove)' },
        },
        required: ['question_id', 'direction'],
      },
    },

    // ============================================
    // EXECUTION & BOT TOOLS (like Clawdbot's exec)
    // ============================================

    {
      name: 'exec_python',
      description: 'Execute a Python script. Can run trading scripts, data analysis, or custom automation. The script runs in the workspace directory.',
      input_schema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Python code to execute' },
          timeout: { type: 'number', description: 'Timeout in seconds (default 30)' },
        },
        required: ['code'],
      },
    },
    {
      name: 'exec_shell',
      description: 'Execute a shell command. Use for pip install, git, file operations, etc.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          timeout: { type: 'number', description: 'Timeout in seconds (default 30)' },
        },
        required: ['command'],
      },
    },
    {
      name: 'start_bot',
      description: 'Start a trading bot as a background process. The bot runs until stopped.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Bot name for identification' },
          script: { type: 'string', description: 'Python script path or code' },
          args: { type: 'string', description: 'Command line arguments' },
        },
        required: ['name', 'script'],
      },
    },
    {
      name: 'stop_bot',
      description: 'Stop a running background bot',
      input_schema: {
        type: 'object',
        properties: {
          bot_id: { type: 'string', description: 'Bot ID to stop' },
        },
        required: ['bot_id'],
      },
    },
    {
      name: 'list_bots',
      description: 'List all running background bots with their status',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_bot_logs',
      description: 'Get recent logs from a background bot',
      input_schema: {
        type: 'object',
        properties: {
          bot_id: { type: 'string', description: 'Bot ID' },
          lines: { type: 'number', description: 'Number of recent lines (default 50)' },
        },
        required: ['bot_id'],
      },
    },

    // ============================================
    // FILE & WORKSPACE TOOLS
    // ============================================

    {
      name: 'write_file',
      description: 'Write content to a file in the workspace',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
          content: { type: 'string', description: 'File content' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'read_file',
      description: 'Read a file from the workspace',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
        },
        required: ['path'],
      },
    },

    // ============================================
    // CREDENTIAL ONBOARDING TOOLS
    // ============================================

    {
      name: 'setup_polymarket_credentials',
      description: 'Set up Polymarket trading credentials for this user. Required before trading on Polymarket.',
      input_schema: {
        type: 'object',
        properties: {
          private_key: { type: 'string', description: 'Ethereum private key (0x...)' },
          funder_address: { type: 'string', description: 'Wallet address (0x...)' },
          api_key: { type: 'string', description: 'Polymarket API key' },
          api_secret: { type: 'string', description: 'Polymarket API secret' },
          api_passphrase: { type: 'string', description: 'Polymarket API passphrase' },
        },
        required: ['private_key', 'funder_address', 'api_key', 'api_secret', 'api_passphrase'],
      },
    },
    {
      name: 'setup_kalshi_credentials',
      description: 'Set up Kalshi trading credentials for this user. Required before trading on Kalshi.',
      input_schema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Kalshi account email' },
          password: { type: 'string', description: 'Kalshi account password' },
        },
        required: ['email', 'password'],
      },
    },
    {
      name: 'setup_manifold_credentials',
      description: 'Set up Manifold trading credentials for this user. Required before betting on Manifold.',
      input_schema: {
        type: 'object',
        properties: {
          api_key: { type: 'string', description: 'Manifold API key (from settings page)' },
        },
        required: ['api_key'],
      },
    },
    {
      name: 'list_trading_credentials',
      description: 'List which platforms the user has trading credentials set up for',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'delete_trading_credentials',
      description: 'Delete trading credentials for a platform',
      input_schema: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            description: 'Platform to delete credentials for',
            enum: ['polymarket', 'kalshi', 'manifold'],
          },
        },
        required: ['platform'],
      },
    },

    // ============================================
    // SESSION MANAGEMENT TOOLS
    // ============================================

    {
      name: 'clear_conversation_history',
      description: 'Clear the conversation history to start fresh. Use when user wants to reset context.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
  ];
}

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: AgentContext
): Promise<string> {
  const { feeds, db, session } = context;
  const userId = session.userId;

  try {
    switch (toolName) {
      // Market tools
      case 'search_markets': {
        const query = toolInput.query as string;
        const platform = toolInput.platform as string | undefined;
        const markets = await feeds.searchMarkets(query, platform);

        if (markets.length === 0) {
          return JSON.stringify({ result: 'No markets found.' });
        }

        return JSON.stringify({
          result: markets.slice(0, 8).map(m => ({
            id: m.id,
            platform: m.platform,
            question: m.question,
            outcomes: m.outcomes.slice(0, 3).map(o => ({
              name: o.name,
              price: o.price,
              priceCents: `${Math.round(o.price * 100)}¢`,
            })),
            volume24h: m.volume24h,
            url: m.url,
          })),
        });
      }

      case 'get_market': {
        const marketId = toolInput.market_id as string;
        const platform = toolInput.platform as string;
        const market = await feeds.getMarket(marketId, platform);

        if (!market) {
          return JSON.stringify({ error: 'Market not found' });
        }

        return JSON.stringify({
          result: {
            ...market,
            outcomes: market.outcomes.map(o => ({
              ...o,
              priceCents: `${Math.round(o.price * 100)}¢`,
            })),
          },
        });
      }

      // Portfolio tools
      case 'get_portfolio': {
        const positions = db.getPositions(userId);

        if (positions.length === 0) {
          return JSON.stringify({ result: 'No positions tracked. Use add_position to track manually.' });
        }

        const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
        const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
        const totalCost = totalValue - totalPnl;

        return JSON.stringify({
          result: {
            positions: positions.map(p => ({
              ...p,
              pnlFormatted: `${p.pnl >= 0 ? '+' : ''}$${p.pnl.toFixed(2)} (${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(1)}%)`,
            })),
            summary: {
              totalValue: `$${totalValue.toFixed(2)}`,
              totalPnl: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`,
              totalPnlPct: totalCost > 0 ? `${((totalPnl / totalCost) * 100).toFixed(1)}%` : '0%',
            },
          },
        });
      }

      case 'add_position': {
        const position = {
          id: crypto.randomUUID(),
          platform: toolInput.platform as Platform,
          marketId: toolInput.market_id as string,
          marketQuestion: toolInput.market_question as string,
          outcome: toolInput.outcome as string,
          outcomeId: `${toolInput.market_id}-${toolInput.outcome}`,
          side: toolInput.side as 'YES' | 'NO',
          shares: toolInput.shares as number,
          avgPrice: toolInput.avg_price as number,
          currentPrice: toolInput.avg_price as number,
          pnl: 0,
          pnlPct: 0,
          value: (toolInput.shares as number) * (toolInput.avg_price as number),
          openedAt: new Date(),
        };

        db.upsertPosition(userId, position);
        return JSON.stringify({ result: 'Position added successfully', position });
      }

      // Alert tools
      case 'create_alert': {
        const alert: Alert = {
          id: crypto.randomUUID(),
          userId,
          type: 'price',
          name: toolInput.market_name as string,
          marketId: toolInput.market_id as string,
          platform: toolInput.platform as Platform,
          condition: {
            type: toolInput.condition_type as 'price_above' | 'price_below' | 'price_change_pct',
            threshold: toolInput.threshold as number,
          },
          enabled: true,
          triggered: false,
          createdAt: new Date(),
        };

        db.createAlert(alert);
        return JSON.stringify({
          result: 'Alert created!',
          alert: {
            id: alert.id,
            condition: `${alert.condition.type} ${alert.condition.threshold}`,
          },
        });
      }

      case 'list_alerts': {
        const alerts = db.getAlerts(userId);

        if (alerts.length === 0) {
          return JSON.stringify({ result: 'No active alerts.' });
        }

        return JSON.stringify({
          result: alerts.map(a => ({
            id: a.id,
            name: a.name,
            platform: a.platform,
            condition: `${a.condition.type} ${a.condition.threshold}`,
            enabled: a.enabled,
            triggered: a.triggered,
          })),
        });
      }

      case 'delete_alert': {
        db.deleteAlert(toolInput.alert_id as string);
        return JSON.stringify({ result: 'Alert deleted.' });
      }

      // News tools
      case 'get_recent_news': {
        const limit = (toolInput.limit as number) || 10;
        const news = feeds.getRecentNews(limit);

        if (news.length === 0) {
          return JSON.stringify({ result: 'No recent news available.' });
        }

        return JSON.stringify({
          result: news.map(n => ({
            title: n.title,
            source: n.source,
            publishedAt: n.publishedAt,
            relevantMarkets: n.relevantMarkets,
            url: n.url,
          })),
        });
      }

      case 'search_news': {
        const query = toolInput.query as string;
        const news = feeds.searchNews(query);

        if (news.length === 0) {
          return JSON.stringify({ result: 'No news found for that query.' });
        }

        return JSON.stringify({
          result: news.slice(0, 10).map(n => ({
            title: n.title,
            source: n.source,
            publishedAt: n.publishedAt,
            url: n.url,
          })),
        });
      }

      case 'get_news_for_market': {
        const question = toolInput.market_question as string;
        const news = feeds.getNewsForMarket(question);

        if (news.length === 0) {
          return JSON.stringify({ result: 'No relevant news found.' });
        }

        return JSON.stringify({
          result: news.map(n => ({
            title: n.title,
            source: n.source,
            publishedAt: n.publishedAt,
            url: n.url,
          })),
        });
      }

      // Edge detection tools
      case 'analyze_edge': {
        const analysis = await feeds.analyzeEdge(
          toolInput.market_id as string,
          toolInput.market_question as string,
          toolInput.current_price as number,
          toolInput.category as 'politics' | 'economics' | 'sports' | 'other'
        );

        return JSON.stringify({
          result: {
            marketPrice: `${Math.round(analysis.marketPrice * 100)}¢`,
            fairValue: `${Math.round(analysis.fairValue * 100)}¢`,
            edge: `${analysis.edge >= 0 ? '+' : ''}${Math.round(analysis.edge * 100)}¢`,
            edgePct: `${analysis.edgePct >= 0 ? '+' : ''}${analysis.edgePct.toFixed(1)}%`,
            confidence: analysis.confidence,
            sources: analysis.sources.map(s => ({
              name: s.name,
              probability: `${Math.round(s.probability * 100)}%`,
              type: s.type,
            })),
          },
        });
      }

      case 'calculate_kelly': {
        const result = feeds.calculateKelly(
          toolInput.market_price as number,
          toolInput.estimated_probability as number,
          toolInput.bankroll as number
        );

        return JSON.stringify({
          result: {
            recommendation: 'Use half-Kelly or quarter-Kelly for safety',
            fullKelly: `$${result.fullKelly.toFixed(2)}`,
            halfKelly: `$${result.halfKelly.toFixed(2)} (recommended)`,
            quarterKelly: `$${result.quarterKelly.toFixed(2)} (conservative)`,
          },
        });
      }

      // ============================================
      // WHALE TRACKING & COPY TRADING HANDLERS
      // ============================================

      case 'watch_wallet': {
        const address = (toolInput.address as string).toLowerCase();
        const platform = (toolInput.platform as string) || 'polymarket';
        const nickname = toolInput.nickname as string | undefined;

        // Save to database
        db.run(`
          INSERT OR REPLACE INTO watched_wallets (user_id, address, platform, nickname, created_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `, [userId, address, platform, nickname || null]);

        return JSON.stringify({
          result: {
            message: `Now watching wallet ${nickname ? `"${nickname}" (${address.slice(0,6)}...${address.slice(-4)})` : `${address.slice(0,6)}...${address.slice(-4)}`}`,
            address,
            platform,
            tip: 'You will receive alerts when this wallet makes trades.',
          },
        });
      }

      case 'unwatch_wallet': {
        const address = (toolInput.address as string).toLowerCase();
        db.run('DELETE FROM watched_wallets WHERE user_id = ? AND address = ?', [userId, address]);
        return JSON.stringify({ result: { message: `Stopped watching ${address.slice(0,6)}...${address.slice(-4)}` } });
      }

      case 'list_watched_wallets': {
        const wallets = db.query<{ address: string; platform: string; nickname: string | null; created_at: string }>(
          'SELECT address, platform, nickname, created_at FROM watched_wallets WHERE user_id = ?',
          [userId]
        );

        if (wallets.length === 0) {
          return JSON.stringify({ result: { message: 'No wallets being watched. Use watch_wallet to start tracking.' } });
        }

        return JSON.stringify({
          result: {
            count: wallets.length,
            wallets: wallets.map(w => ({
              address: `${w.address.slice(0,6)}...${w.address.slice(-4)}`,
              fullAddress: w.address,
              platform: w.platform,
              nickname: w.nickname,
              since: w.created_at,
            })),
          },
        });
      }

      case 'get_wallet_trades': {
        const address = toolInput.address as string;
        const limit = (toolInput.limit as number) || 20;
        const platform = (toolInput.platform as string) || 'polymarket';

        let trades: any[] = [];

        if (platform === 'polymarket') {
          const response = await fetch(`https://clob.polymarket.com/trades?maker=${address}&limit=${limit}`);
          const data = await response.json() as ApiResponse;
          trades = (data || []).slice(0, limit).map((t: any) => ({
            market: t.market || 'Unknown',
            side: t.side,
            size: t.size,
            price: `${Math.round(parseFloat(t.price) * 100)}¢`,
            timestamp: t.timestamp,
          }));
        } else if (platform === 'kalshi') {
          // Try to use authenticated API if user has credentials
          const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
          if (kalshiCreds && kalshiCreds.platform === 'kalshi') {
            try {
              // Authenticate and get fills
              const creds = kalshiCreds.data as KalshiCredentials;
              const loginRes = await fetch('https://api.elections.kalshi.com/trade-api/v2/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: creds.email, password: creds.password }),
              });
              if (loginRes.ok) {
                const loginData = await loginRes.json() as { token: string };
                const fillsRes = await fetch(`https://api.elections.kalshi.com/trade-api/v2/fills?limit=${limit}`, {
                  headers: { Authorization: `Bearer ${loginData.token}` },
                });
                const fillsData = await fillsRes.json() as { fills?: any[] };
                trades = (fillsData.fills || []).map((f: any) => ({
                  ticker: f.ticker,
                  side: f.side,
                  count: f.count,
                  price: `${f.price}¢`,
                  timestamp: f.created_time,
                }));
                await context.credentials.markSuccess(userId, 'kalshi');
              }
            } catch (err) {
              await context.credentials.markFailure(userId, 'kalshi');
              trades = [{ error: 'Kalshi API error. Try again later.' }];
            }
          } else {
            trades = [{ message: 'Kalshi wallet tracking requires credentials. Use setup_kalshi_credentials first.' }];
          }
        } else if (platform === 'manifold') {
          const response = await fetch(`https://api.manifold.markets/v0/bets?userId=${address}&limit=${limit}`);
          const data = await response.json() as ApiResponse;
          trades = (data || []).slice(0, limit).map((t: any) => ({
            market: t.contractSlug || 'Unknown',
            side: t.outcome,
            size: t.amount,
            price: `${Math.round((t.probAfter || 0) * 100)}¢`,
            timestamp: t.createdTime,
          }));
        } else if (platform === 'metaculus') {
          const response = await fetch(`https://www.metaculus.com/api2/users/${address}/predictions/?limit=${limit}`);
          const data = await response.json() as ApiResponse;
          trades = (data?.results || []).slice(0, limit).map((t: any) => ({
            question: t.question_title || 'Unknown',
            prediction: `${Math.round((t.prediction || 0) * 100)}%`,
            timestamp: t.created_time,
          }));
        } else if (platform === 'predictit') {
          trades = [{
            message: 'PredictIt API limitation: No public user trade history endpoint.',
            suggestion: 'Use PredictIt website or export your data from your account settings.',
            note: 'Market data (prices, volumes) is still available via search_markets.',
          }];
        } else if (platform === 'drift') {
          const response = await fetch(`https://bet.drift.trade/api/users/${address}/trades?limit=${limit}`);
          const data = await response.json() as ApiResponse;
          trades = (data || []).slice(0, limit).map((t: any) => ({
            market: t.marketName || 'Unknown',
            side: t.side,
            size: t.size,
            price: `${Math.round(parseFloat(t.price || 0) * 100)}¢`,
            timestamp: t.timestamp,
          }));
        }

        return JSON.stringify({
          result: {
            platform,
            address: address.length > 12 ? `${address.slice(0,6)}...${address.slice(-4)}` : address,
            trades,
          },
        });
      }

      case 'get_wallet_positions': {
        const address = toolInput.address as string;
        const platform = (toolInput.platform as string) || 'polymarket';

        let positions: any[] = [];

        if (platform === 'polymarket') {
          const response = await fetch(`https://data-api.polymarket.com/positions?user=${address}`);
          const data = await response.json() as ApiResponse;
          positions = (data || []).map((p: any) => ({
            market: p.title || p.market || 'Unknown',
            outcome: p.outcome,
            size: p.size,
            avgPrice: `${Math.round(parseFloat(p.avgPrice || 0) * 100)}¢`,
            currentPrice: `${Math.round(parseFloat(p.currentPrice || 0) * 100)}¢`,
            pnl: p.pnl ? `$${parseFloat(p.pnl).toFixed(2)}` : 'N/A',
          }));
        } else if (platform === 'kalshi') {
          // Try to use authenticated API if user has credentials
          const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
          if (kalshiCreds && kalshiCreds.platform === 'kalshi') {
            try {
              const creds = kalshiCreds.data as KalshiCredentials;
              const loginRes = await fetch('https://api.elections.kalshi.com/trade-api/v2/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: creds.email, password: creds.password }),
              });
              if (loginRes.ok) {
                const loginData = await loginRes.json() as { token: string };
                const posRes = await fetch('https://api.elections.kalshi.com/trade-api/v2/portfolio/positions', {
                  headers: { Authorization: `Bearer ${loginData.token}` },
                });
                const posData = await posRes.json() as { market_positions?: any[] };
                positions = (posData.market_positions || []).map((p: any) => ({
                  ticker: p.ticker,
                  side: p.position > 0 ? 'Yes' : 'No',
                  count: Math.abs(p.position),
                  avgPrice: `${p.total_traded ? Math.round((p.realized_pnl || 0) / p.total_traded * 100) : 0}¢`,
                  marketPrice: `${p.market_exposure || 0}¢`,
                }));
                await context.credentials.markSuccess(userId, 'kalshi');
              }
            } catch (err) {
              await context.credentials.markFailure(userId, 'kalshi');
              positions = [{ error: 'Kalshi API error. Try again later.' }];
            }
          } else {
            positions = [{ message: 'Kalshi positions require credentials. Use setup_kalshi_credentials first.' }];
          }
        } else if (platform === 'manifold') {
          const response = await fetch(`https://api.manifold.markets/v0/bets?userId=${address}`);
          const data = await response.json() as ApiResponse;
          const byMarket = new Map<string, any>();
          for (const bet of (data || [])) {
            if (!byMarket.has(bet.contractId)) {
              byMarket.set(bet.contractId, { market: bet.contractSlug, shares: 0, totalCost: 0 });
            }
            const pos = byMarket.get(bet.contractId);
            pos.shares += bet.shares || 0;
            pos.totalCost += bet.amount || 0;
          }
          positions = Array.from(byMarket.values()).filter(p => p.shares > 0);
        } else if (platform === 'metaculus') {
          const response = await fetch(`https://www.metaculus.com/api2/users/${address}/predictions/`);
          const data = await response.json() as ApiResponse;
          positions = (data?.results || []).slice(0, 20).map((p: any) => ({
            question: p.question_title || 'Unknown',
            prediction: `${Math.round((p.prediction || 0) * 100)}%`,
            status: p.question_status,
          }));
        } else if (platform === 'predictit') {
          positions = [{
            message: 'PredictIt API limitation: No public user positions endpoint.',
            suggestion: 'Check your positions on the PredictIt website or mobile app.',
            note: 'Market data (prices, volumes) is still available via search_markets.',
          }];
        } else if (platform === 'drift') {
          const response = await fetch(`https://bet.drift.trade/api/users/${address}/positions`);
          const data = await response.json() as ApiResponse;
          positions = (data || []).map((p: any) => ({
            market: p.marketName || 'Unknown',
            side: p.side,
            size: p.size,
            entryPrice: `${Math.round(parseFloat(p.entryPrice || 0) * 100)}¢`,
          }));
        }

        return JSON.stringify({
          result: {
            platform,
            address: address.length > 12 ? `${address.slice(0,6)}...${address.slice(-4)}` : address,
            positions,
          },
        });
      }

      case 'get_wallet_pnl': {
        const address = toolInput.address as string;
        const platform = (toolInput.platform as string) || 'polymarket';

        let pnlData: any = {};

        if (platform === 'polymarket') {
          const response = await fetch(`https://data-api.polymarket.com/pnl?user=${address}`);
          const data = await response.json() as ApiResponse;
          pnlData = {
            totalPnl: data?.totalPnl ? `$${parseFloat(data.totalPnl).toFixed(2)}` : 'N/A',
            realizedPnl: data?.realizedPnl ? `$${parseFloat(data.realizedPnl).toFixed(2)}` : 'N/A',
            unrealizedPnl: data?.unrealizedPnl ? `$${parseFloat(data.unrealizedPnl).toFixed(2)}` : 'N/A',
            winRate: data?.winRate ? `${(parseFloat(data.winRate) * 100).toFixed(1)}%` : 'N/A',
            tradesCount: data?.tradesCount || 'N/A',
          };
        } else if (platform === 'kalshi') {
          // Try to use authenticated API if user has credentials
          const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
          if (kalshiCreds && kalshiCreds.platform === 'kalshi') {
            try {
              const creds = kalshiCreds.data as KalshiCredentials;
              const loginRes = await fetch('https://api.elections.kalshi.com/trade-api/v2/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: creds.email, password: creds.password }),
              });
              if (loginRes.ok) {
                const loginData = await loginRes.json() as { token: string };
                const balRes = await fetch('https://api.elections.kalshi.com/trade-api/v2/portfolio/balance', {
                  headers: { Authorization: `Bearer ${loginData.token}` },
                });
                const balData = await balRes.json() as any;
                pnlData = {
                  balance: balData.balance ? `$${(balData.balance / 100).toFixed(2)}` : 'N/A',
                  portfolioValue: balData.portfolio_value ? `$${(balData.portfolio_value / 100).toFixed(2)}` : 'N/A',
                  pnl: balData.pnl ? `$${(balData.pnl / 100).toFixed(2)}` : 'N/A',
                };
                await context.credentials.markSuccess(userId, 'kalshi');
              }
            } catch (err) {
              await context.credentials.markFailure(userId, 'kalshi');
              pnlData = { error: 'Kalshi API error. Try again later.' };
            }
          } else {
            pnlData = { message: 'Kalshi P&L requires credentials. Use setup_kalshi_credentials first.' };
          }
        } else if (platform === 'manifold') {
          const response = await fetch(`https://api.manifold.markets/v0/user/${address}`);
          const data = await response.json() as ApiResponse;
          pnlData = {
            totalPnl: data?.profitCached ? `M$${parseFloat(data.profitCached.allTime || 0).toFixed(0)}` : 'N/A',
            balance: data?.balance ? `M$${parseFloat(data.balance).toFixed(0)}` : 'N/A',
            tradesCount: data?.creatorTraders?.allTime || 'N/A',
          };
        } else if (platform === 'metaculus') {
          const response = await fetch(`https://www.metaculus.com/api2/users/${address}/`);
          const data = await response.json() as ApiResponse;
          pnlData = {
            accuracy: data?.score ? `${data.score.toFixed(2)}` : 'N/A',
            questionsAnswered: data?.question_count || 'N/A',
            rank: data?.rank || 'N/A',
            points: data?.points || 'N/A',
          };
        } else if (platform === 'predictit') {
          pnlData = {
            message: 'PredictIt API limitation: No public user P&L endpoint.',
            suggestion: 'Check your portfolio value on the PredictIt website.',
            note: 'You can manually track P&L using paper trading mode.',
          };
        } else if (platform === 'drift') {
          const response = await fetch(`https://bet.drift.trade/api/users/${address}/pnl`);
          const data = await response.json() as ApiResponse;
          pnlData = {
            totalPnl: data?.totalPnl ? `$${parseFloat(data.totalPnl).toFixed(2)}` : 'N/A',
            realizedPnl: data?.realizedPnl ? `$${parseFloat(data.realizedPnl).toFixed(2)}` : 'N/A',
            tradesCount: data?.tradesCount || 'N/A',
          };
        }

        return JSON.stringify({
          result: {
            platform,
            address: address.length > 12 ? `${address.slice(0,6)}...${address.slice(-4)}` : address,
            ...pnlData,
          },
        });
      }

      case 'get_top_traders': {
        const sortBy = (toolInput.sort_by as string) || 'profit';
        const period = (toolInput.period as string) || '7d';
        const limit = (toolInput.limit as number) || 10;
        const platform = (toolInput.platform as string) || 'polymarket';

        let traders: any[] = [];

        if (platform === 'polymarket') {
          const response = await fetch(`https://data-api.polymarket.com/leaderboard?period=${period}&limit=${limit}`);
          const data = await response.json() as ApiResponse;
          traders = (data || []).slice(0, limit).map((t: any, i: number) => ({
            rank: i + 1,
            address: `${t.address?.slice(0,6)}...${t.address?.slice(-4)}`,
            fullAddress: t.address,
            profit: `$${parseFloat(t.profit || 0).toFixed(2)}`,
            roi: `${(parseFloat(t.roi || 0) * 100).toFixed(1)}%`,
            volume: `$${parseFloat(t.volume || 0).toFixed(0)}`,
            winRate: `${(parseFloat(t.winRate || 0) * 100).toFixed(1)}%`,
          }));
        } else if (platform === 'kalshi') {
          traders = [{ message: 'Kalshi leaderboard not publicly available.' }];
        } else if (platform === 'manifold') {
          const response = await fetch(`https://api.manifold.markets/v0/users?limit=${limit}`);
          const data = await response.json() as ApiResponse;
          traders = (data || []).slice(0, limit).map((t: any, i: number) => ({
            rank: i + 1,
            username: t.username,
            name: t.name,
            profit: t.profitCached?.allTime ? `M$${parseFloat(t.profitCached.allTime).toFixed(0)}` : 'N/A',
            balance: t.balance ? `M$${parseFloat(t.balance).toFixed(0)}` : 'N/A',
          }));
        } else if (platform === 'metaculus') {
          const response = await fetch(`https://www.metaculus.com/api2/users/?order_by=-score&limit=${limit}`);
          const data = await response.json() as ApiResponse;
          traders = (data?.results || []).slice(0, limit).map((t: any, i: number) => ({
            rank: i + 1,
            username: t.username,
            score: t.score?.toFixed(2) || 'N/A',
            questionsAnswered: t.question_count || 0,
            points: t.points || 0,
          }));
        } else if (platform === 'predictit') {
          traders = [{ message: 'PredictIt does not have a public leaderboard.' }];
        } else if (platform === 'drift') {
          const response = await fetch(`https://bet.drift.trade/api/leaderboard?limit=${limit}`);
          const data = await response.json() as ApiResponse;
          traders = (data || []).slice(0, limit).map((t: any, i: number) => ({
            rank: i + 1,
            address: `${t.address?.slice(0,6)}...${t.address?.slice(-4)}`,
            fullAddress: t.address,
            profit: `$${parseFloat(t.profit || 0).toFixed(2)}`,
            volume: `$${parseFloat(t.volume || 0).toFixed(0)}`,
          }));
        }

        return JSON.stringify({
          result: {
            platform,
            period,
            sortedBy: sortBy,
            traders,
          },
        });
      }

      case 'copy_trade': {
        const address = (toolInput.address as string).toLowerCase();
        const tradeId = toolInput.trade_id as string;
        const sizeMultiplier = (toolInput.size_multiplier as number) || 0.5;

        // Currently only Polymarket copy trading is supported
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'Copy trading requires Polymarket credentials. Use setup_polymarket_credentials first.',
          });
        }

        try {
          // Fetch the original trade from the wallet
          const tradesRes = await fetch(`https://clob.polymarket.com/trades?maker=${address}&limit=50`);
          const tradesData = await tradesRes.json() as any[];

          // Find the specific trade
          const originalTrade = (tradesData || []).find((t: any) => t.id === tradeId || t.hash === tradeId);
          if (!originalTrade) {
            return JSON.stringify({ error: `Trade ${tradeId} not found for wallet ${address}` });
          }

          // Calculate copy size
          const originalSize = parseFloat(originalTrade.size || '0');
          const copySize = Math.max(1, Math.floor(originalSize * sizeMultiplier));
          const price = parseFloat(originalTrade.price || '0.5');
          const side = originalTrade.side;
          const tokenId = originalTrade.asset_id || originalTrade.token_id;

          if (!tokenId) {
            return JSON.stringify({ error: 'Could not determine token ID from original trade' });
          }

          // Execute the copy trade via Python script
          const tradingDir = join(__dirname, '..', '..', 'trading');
          const cmd = side === 'BUY'
            ? `cd ${tradingDir} && python3 polymarket.py buy ${tokenId} ${price} ${copySize}`
            : `cd ${tradingDir} && python3 polymarket.py sell ${tokenId} ${copySize} ${price}`;

          const creds = polyCreds.data as PolymarketCredentials;
          const userEnv = {
            ...process.env,
            PRIVATE_KEY: creds.privateKey,
            POLY_FUNDER_ADDRESS: creds.funderAddress,
            POLY_API_KEY: creds.apiKey,
            POLY_API_SECRET: creds.apiSecret,
            POLY_API_PASSPHRASE: creds.apiPassphrase,
          };

          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          await context.credentials.markSuccess(userId, 'polymarket');

          return JSON.stringify({
            result: {
              status: 'copied',
              original: {
                wallet: `${address.slice(0,6)}...${address.slice(-4)}`,
                side,
                size: originalSize,
                price: `${Math.round(price * 100)}¢`,
              },
              copied: {
                side,
                size: copySize,
                price: `${Math.round(price * 100)}¢`,
              },
              output: output.trim(),
            },
          });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'polymarket');
          }
          return JSON.stringify({ error: 'Copy trade failed', details: error.stderr || error.message });
        }
      }

      case 'enable_auto_copy': {
        const address = (toolInput.address as string).toLowerCase();
        const maxSize = toolInput.max_size as number;
        const sizeMultiplier = (toolInput.size_multiplier as number) || 0.5;
        const minConfidence = (toolInput.min_confidence as number) || 0.55;

        db.run(`
          INSERT OR REPLACE INTO auto_copy_settings (user_id, target_address, max_size, size_multiplier, min_confidence, enabled, created_at)
          VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
        `, [userId, address, maxSize, sizeMultiplier, minConfidence]);

        return JSON.stringify({
          result: {
            message: `Auto-copy enabled for ${address.slice(0,6)}...${address.slice(-4)}`,
            settings: {
              maxSize: `$${maxSize}`,
              sizeMultiplier: `${sizeMultiplier * 100}%`,
              minConfidence: `${minConfidence * 100}%`,
            },
            warning: '⚠️ Auto-copy executes real trades automatically. Use with caution.',
          },
        });
      }

      case 'disable_auto_copy': {
        const address = (toolInput.address as string).toLowerCase();
        db.run('UPDATE auto_copy_settings SET enabled = 0 WHERE user_id = ? AND target_address = ?', [userId, address]);
        return JSON.stringify({ result: { message: `Auto-copy disabled for ${address.slice(0,6)}...${address.slice(-4)}` } });
      }

      case 'list_auto_copy': {
        const settings = db.query<{ target_address: string; max_size: number; size_multiplier: number; min_confidence: number }>(
          'SELECT target_address, max_size, size_multiplier, min_confidence FROM auto_copy_settings WHERE user_id = ? AND enabled = 1',
          [userId]
        );

        if (settings.length === 0) {
          return JSON.stringify({ result: { message: 'No auto-copy wallets configured. Use enable_auto_copy to set one up.' } });
        }

        return JSON.stringify({
          result: {
            count: settings.length,
            wallets: settings.map(s => ({
              address: `${s.target_address.slice(0,6)}...${s.target_address.slice(-4)}`,
              maxSize: `$${s.max_size}`,
              sizeMultiplier: `${s.size_multiplier * 100}%`,
              minConfidence: `${s.min_confidence * 100}%`,
            })),
          },
        });
      }

      // ============================================
      // ARBITRAGE & CROSS-PLATFORM HANDLERS
      // ============================================

      case 'find_arbitrage': {
        const minEdge = (toolInput.min_edge as number) || 1;
        const platforms = (toolInput.platforms as string[]) || ['polymarket', 'kalshi', 'manifold'];

        // Search for common topics across platforms
        const opportunities: any[] = [];

        // Check for YES+NO arbitrage within Polymarket
        const polyMarkets = await feeds.searchMarkets('', 'polymarket');
        for (const market of polyMarkets.slice(0, 20)) {
          if (market.outcomes.length === 2) {
            const yesPrice = market.outcomes[0]?.price || 0;
            const noPrice = market.outcomes[1]?.price || 0;
            const sum = yesPrice + noPrice;
            const edge = (1 - sum) * 100;

            if (edge >= minEdge) {
              opportunities.push({
                type: 'internal_arb',
                platform: market.platform,
                market: market.question.slice(0, 50) + (market.question.length > 50 ? '...' : ''),
                yesPrice: `${Math.round(yesPrice * 100)}¢`,
                noPrice: `${Math.round(noPrice * 100)}¢`,
                sum: `${Math.round(sum * 100)}¢`,
                edge: `${edge.toFixed(2)}%`,
                action: `Buy YES at ${Math.round(yesPrice * 100)}¢ + NO at ${Math.round(noPrice * 100)}¢ = guaranteed ${Math.round(edge)}¢ profit per $1`,
              });
            }
          }
        }

        return JSON.stringify({
          result: {
            scanned: polyMarkets.length,
            minEdge: `${minEdge}%`,
            opportunities: opportunities.slice(0, 10),
            message: opportunities.length === 0
              ? 'No arbitrage opportunities found above the minimum edge threshold.'
              : `Found ${opportunities.length} opportunities`,
          },
        });
      }

      case 'compare_prices': {
        const query = toolInput.query as string;

        // Search across all platforms
        const [polyResults, kalshiResults, manifoldResults] = await Promise.all([
          feeds.searchMarkets(query, 'polymarket'),
          feeds.searchMarkets(query, 'kalshi'),
          feeds.searchMarkets(query, 'manifold'),
        ]);

        const comparisons = [];

        // Simple string matching to find similar markets
        for (const poly of polyResults.slice(0, 5)) {
          const comparison: any = {
            topic: poly.question.slice(0, 60) + (poly.question.length > 60 ? '...' : ''),
            polymarket: poly.outcomes[0] ? `${Math.round(poly.outcomes[0].price * 100)}¢` : 'N/A',
          };

          // Find matching Kalshi market
          const kalshiMatch = kalshiResults.find(k =>
            k.question.toLowerCase().includes(query.toLowerCase()) ||
            poly.question.toLowerCase().includes(k.question.toLowerCase().split(' ')[0])
          );
          if (kalshiMatch?.outcomes[0]) {
            comparison.kalshi = `${Math.round(kalshiMatch.outcomes[0].price * 100)}¢`;
          }

          // Find matching Manifold market
          const manifoldMatch = manifoldResults.find(m =>
            m.question.toLowerCase().includes(query.toLowerCase()) ||
            poly.question.toLowerCase().includes(m.question.toLowerCase().split(' ')[0])
          );
          if (manifoldMatch?.outcomes[0]) {
            comparison.manifold = `${Math.round(manifoldMatch.outcomes[0].price * 100)}¢`;
          }

          comparisons.push(comparison);
        }

        return JSON.stringify({
          result: {
            query,
            comparisons,
            tip: 'Look for price differences > 5% for potential cross-platform arbitrage.',
          },
        });
      }

      case 'execute_arbitrage': {
        const marketId = toolInput.market_id as string;
        const platform = (toolInput.platform as string) || 'polymarket';
        const size = toolInput.size as number;

        if (platform !== 'polymarket') {
          return JSON.stringify({ error: 'Arbitrage execution currently only supported on Polymarket' });
        }

        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'Arbitrage execution requires Polymarket credentials. Use setup_polymarket_credentials first.',
          });
        }

        try {
          // Fetch the market to get current prices and token IDs
          const marketRes = await fetch(`https://clob.polymarket.com/markets/${marketId}`);
          if (!marketRes.ok) {
            return JSON.stringify({ error: `Market ${marketId} not found` });
          }
          const marketData = await marketRes.json() as any;

          // Get YES and NO token IDs and prices
          const tokens = marketData.tokens || [];
          const yesToken = tokens.find((t: any) => t.outcome === 'Yes');
          const noToken = tokens.find((t: any) => t.outcome === 'No');

          if (!yesToken || !noToken) {
            return JSON.stringify({ error: 'Could not find YES/NO tokens for this market' });
          }

          // Fetch current orderbook prices
          const [yesBookRes, noBookRes] = await Promise.all([
            fetch(`https://clob.polymarket.com/book?token_id=${yesToken.token_id}`),
            fetch(`https://clob.polymarket.com/book?token_id=${noToken.token_id}`),
          ]);
          const yesBook = await yesBookRes.json() as any;
          const noBook = await noBookRes.json() as any;

          const yesAsk = parseFloat(yesBook.asks?.[0]?.price || '0.99');
          const noAsk = parseFloat(noBook.asks?.[0]?.price || '0.99');
          const sum = yesAsk + noAsk;

          if (sum >= 1) {
            return JSON.stringify({
              error: 'No arbitrage opportunity',
              yesPrice: `${Math.round(yesAsk * 100)}¢`,
              noPrice: `${Math.round(noAsk * 100)}¢`,
              sum: `${Math.round(sum * 100)}¢`,
              message: 'YES + NO prices sum to $1 or more - no profit available',
            });
          }

          const edge = (1 - sum) * 100;
          const profit = (size * 2) * (1 - sum);

          // Execute both trades
          const tradingDir = join(__dirname, '..', '..', 'trading');
          const creds = polyCreds.data as PolymarketCredentials;
          const userEnv = {
            ...process.env,
            PRIVATE_KEY: creds.privateKey,
            POLY_FUNDER_ADDRESS: creds.funderAddress,
            POLY_API_KEY: creds.apiKey,
            POLY_API_SECRET: creds.apiSecret,
            POLY_API_PASSPHRASE: creds.apiPassphrase,
          };

          // Buy YES
          const yesCmd = `cd ${tradingDir} && python3 polymarket.py buy ${yesToken.token_id} ${yesAsk} ${size}`;
          const yesOutput = execSync(yesCmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });

          // Buy NO
          const noCmd = `cd ${tradingDir} && python3 polymarket.py buy ${noToken.token_id} ${noAsk} ${size}`;
          const noOutput = execSync(noCmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });

          await context.credentials.markSuccess(userId, 'polymarket');

          return JSON.stringify({
            result: {
              status: 'executed',
              market: marketData.question?.slice(0, 50) || marketId,
              trades: [
                { side: 'YES', price: `${Math.round(yesAsk * 100)}¢`, size, output: yesOutput.trim() },
                { side: 'NO', price: `${Math.round(noAsk * 100)}¢`, size, output: noOutput.trim() },
              ],
              edge: `${edge.toFixed(2)}%`,
              expectedProfit: `$${profit.toFixed(2)}`,
              note: 'Profit is locked in at market resolution regardless of outcome',
            },
          });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'polymarket');
          }
          return JSON.stringify({ error: 'Arbitrage execution failed', details: error.stderr || error.message });
        }
      }

      // ============================================
      // PAPER TRADING HANDLERS
      // ============================================

      case 'paper_trading_mode': {
        const enabled = toolInput.enabled as boolean;
        const startingBalance = (toolInput.starting_balance as number) || 10000;

        db.run(`
          INSERT OR REPLACE INTO paper_trading_settings (user_id, enabled, balance, starting_balance, created_at)
          VALUES (?, ?, COALESCE((SELECT balance FROM paper_trading_settings WHERE user_id = ?), ?), ?, datetime('now'))
        `, [userId, enabled ? 1 : 0, userId, startingBalance, startingBalance]);

        return JSON.stringify({
          result: {
            mode: enabled ? 'PAPER TRADING ENABLED' : 'REAL TRADING MODE',
            message: enabled
              ? `Paper trading active with $${startingBalance.toLocaleString()} virtual balance. All trades are simulated.`
              : 'Paper trading disabled. ⚠️ All trades will use real funds.',
          },
        });
      }

      case 'paper_balance': {
        const settings = db.query<{ balance: number; starting_balance: number }>(
          'SELECT balance, starting_balance FROM paper_trading_settings WHERE user_id = ?',
          [userId]
        )[0];

        if (!settings) {
          return JSON.stringify({ result: { message: 'Paper trading not set up. Use paper_trading_mode to enable.' } });
        }

        const pnl = settings.balance - settings.starting_balance;
        const pnlPct = (pnl / settings.starting_balance) * 100;

        return JSON.stringify({
          result: {
            balance: `$${settings.balance.toLocaleString()}`,
            startingBalance: `$${settings.starting_balance.toLocaleString()}`,
            pnl: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
            pnlPct: `${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`,
          },
        });
      }

      case 'paper_positions': {
        const positions = db.query<{ market_id: string; market_name: string; side: string; size: number; entry_price: number }>(
          'SELECT market_id, market_name, side, size, entry_price FROM paper_positions WHERE user_id = ?',
          [userId]
        );

        if (positions.length === 0) {
          return JSON.stringify({ result: { message: 'No paper trading positions. Start trading to build your portfolio!' } });
        }

        return JSON.stringify({
          result: {
            count: positions.length,
            positions: positions.map(p => ({
              market: p.market_name.slice(0, 40) + (p.market_name.length > 40 ? '...' : ''),
              side: p.side,
              size: p.size,
              entryPrice: `${Math.round(p.entry_price * 100)}¢`,
            })),
          },
        });
      }

      case 'paper_reset': {
        const startingBalance = (toolInput.starting_balance as number) || 10000;

        db.run('DELETE FROM paper_positions WHERE user_id = ?', [userId]);
        db.run('DELETE FROM paper_trades WHERE user_id = ?', [userId]);
        db.run(`
          UPDATE paper_trading_settings SET balance = ?, starting_balance = ? WHERE user_id = ?
        `, [startingBalance, startingBalance, userId]);

        return JSON.stringify({
          result: {
            message: `Paper trading account reset to $${startingBalance.toLocaleString()}`,
            balance: `$${startingBalance.toLocaleString()}`,
          },
        });
      }

      case 'paper_history': {
        const trades = db.query<{ market_name: string; side: string; size: number; price: number; pnl: number; created_at: string }>(
          'SELECT market_name, side, size, price, pnl, created_at FROM paper_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
          [userId]
        );

        const stats = db.query<{ total_trades: number; winning_trades: number; total_pnl: number }>(
          `SELECT COUNT(*) as total_trades, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades, SUM(pnl) as total_pnl
           FROM paper_trades WHERE user_id = ?`,
          [userId]
        )[0];

        return JSON.stringify({
          result: {
            stats: {
              totalTrades: stats?.total_trades || 0,
              winRate: stats?.total_trades ? `${((stats.winning_trades / stats.total_trades) * 100).toFixed(1)}%` : 'N/A',
              totalPnl: `$${(stats?.total_pnl || 0).toFixed(2)}`,
            },
            recentTrades: trades.map(t => ({
              market: t.market_name.slice(0, 30) + '...',
              side: t.side,
              size: t.size,
              price: `${Math.round(t.price * 100)}¢`,
              pnl: `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}`,
              date: t.created_at,
            })),
          },
        });
      }

      // ============================================
      // WHALE ALERTS HANDLERS
      // ============================================

      case 'whale_alerts': {
        const enabled = toolInput.enabled as boolean;
        const minSize = (toolInput.min_size as number) || 10000;
        const markets = toolInput.markets as string[] | undefined;

        db.run(`
          INSERT OR REPLACE INTO alert_settings (user_id, type, enabled, min_size, markets, created_at)
          VALUES (?, 'whale', ?, ?, ?, datetime('now'))
        `, [userId, enabled ? 1 : 0, minSize, markets ? JSON.stringify(markets) : null]);

        return JSON.stringify({
          result: {
            type: 'whale_alerts',
            enabled,
            minSize: `$${minSize.toLocaleString()}`,
            markets: markets || 'all',
            message: enabled
              ? `Whale alerts enabled. You'll be notified of trades ≥ $${minSize.toLocaleString()}`
              : 'Whale alerts disabled.',
          },
        });
      }

      case 'new_market_alerts': {
        const enabled = toolInput.enabled as boolean;
        const categories = toolInput.categories as string[] | undefined;

        db.run(`
          INSERT OR REPLACE INTO alert_settings (user_id, type, enabled, categories, created_at)
          VALUES (?, 'new_market', ?, ?, datetime('now'))
        `, [userId, enabled ? 1 : 0, categories ? JSON.stringify(categories) : null]);

        return JSON.stringify({
          result: {
            type: 'new_market_alerts',
            enabled,
            categories: categories || 'all',
            message: enabled
              ? 'New market alerts enabled.'
              : 'New market alerts disabled.',
          },
        });
      }

      case 'volume_spike_alerts': {
        const enabled = toolInput.enabled as boolean;
        const threshold = (toolInput.threshold_multiplier as number) || 3;

        db.run(`
          INSERT OR REPLACE INTO alert_settings (user_id, type, enabled, threshold, created_at)
          VALUES (?, 'volume_spike', ?, ?, datetime('now'))
        `, [userId, enabled ? 1 : 0, threshold]);

        return JSON.stringify({
          result: {
            type: 'volume_spike_alerts',
            enabled,
            threshold: `${threshold}x normal volume`,
            message: enabled
              ? `Volume spike alerts enabled. You'll be notified when volume exceeds ${threshold}x normal.`
              : 'Volume spike alerts disabled.',
          },
        });
      }

      // ============================================
      // CREDENTIAL ONBOARDING HANDLERS
      // ============================================

      case 'setup_polymarket_credentials': {
        const creds: PolymarketCredentials = {
          privateKey: toolInput.private_key as string,
          funderAddress: toolInput.funder_address as string,
          apiKey: toolInput.api_key as string,
          apiSecret: toolInput.api_secret as string,
          apiPassphrase: toolInput.api_passphrase as string,
        };

        await context.credentials.setCredentials(userId, 'polymarket', creds);
        return JSON.stringify({
          result: 'Polymarket credentials saved! You can now trade on Polymarket.',
          wallet: creds.funderAddress,
          security_notice: 'Your credentials are encrypted and stored securely. For maximum security, consider using a dedicated trading wallet with limited funds. Never share your private key with anyone else.',
        });
      }

      case 'setup_kalshi_credentials': {
        const creds: KalshiCredentials = {
          email: toolInput.email as string,
          password: toolInput.password as string,
        };

        await context.credentials.setCredentials(userId, 'kalshi', creds);
        return JSON.stringify({
          result: 'Kalshi credentials saved! You can now trade on Kalshi.',
          email: creds.email,
          security_notice: 'Your credentials are encrypted and stored securely. Consider using a unique password for trading. You can delete credentials anytime with delete_trading_credentials.',
        });
      }

      case 'setup_manifold_credentials': {
        const creds: ManifoldCredentials = {
          apiKey: toolInput.api_key as string,
        };

        await context.credentials.setCredentials(userId, 'manifold', creds);
        return JSON.stringify({
          result: 'Manifold credentials saved! You can now bet on Manifold.',
          security_notice: 'Your API key is encrypted and stored securely. You can regenerate your API key on Manifold settings if needed.',
        });
      }

      case 'list_trading_credentials': {
        const platforms = await context.credentials.listUserPlatforms(userId);

        if (platforms.length === 0) {
          return JSON.stringify({
            result: 'No trading credentials set up yet. Use setup_polymarket_credentials, setup_kalshi_credentials, or setup_manifold_credentials to enable trading.',
          });
        }

        return JSON.stringify({
          result: `Trading enabled for: ${platforms.join(', ')}`,
          platforms,
        });
      }

      case 'delete_trading_credentials': {
        const platform = toolInput.platform as Platform;
        await context.credentials.deleteCredentials(userId, platform);
        return JSON.stringify({
          result: `Deleted ${platform} credentials.`,
        });
      }

      // ============================================
      // TRADING EXECUTION HANDLERS
      // ============================================

      case 'polymarket_buy': {
        // Check for credentials first
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const tokenId = toolInput.token_id as string;
        const price = toolInput.price as number;
        const size = toolInput.size as number;

        // Execute via Python trading script with user's credentials
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py buy ${tokenId} ${price} ${size}`;

        // Build env with user's credentials
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, {
            timeout: 30000,
            encoding: 'utf-8',
            env: userEnv,
          });

          // Mark credential success
          await context.credentials.markSuccess(userId, 'polymarket');
          return JSON.stringify({ result: 'Order placed', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          // Check if auth failure
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'polymarket');
          }
          return JSON.stringify({ error: 'Order failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_sell': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const tokenId = toolInput.token_id as string;
        const size = toolInput.size as number;
        const price = (toolInput.price as number) || 0.01;

        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py sell ${tokenId} ${size} ${price}`;

        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          await context.credentials.markSuccess(userId, 'polymarket');
          return JSON.stringify({ result: 'Sell order placed', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'polymarket');
          }
          return JSON.stringify({ error: 'Sell failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_positions': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py positions`;

        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return JSON.stringify({ result: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          return JSON.stringify({ error: 'Failed to get positions', details: error.stderr || error.message });
        }
      }

      case 'polymarket_cancel_all': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py cancel_all`;

        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return JSON.stringify({ result: 'All orders cancelled', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          return JSON.stringify({ error: 'Cancel failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_orderbook': {
        // Orderbook is public - no credentials required
        const tokenId = toolInput.token_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py orderbook ${tokenId}`;

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return JSON.stringify({ result: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          return JSON.stringify({ error: 'Orderbook fetch failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_balance': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py balance`;

        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return JSON.stringify({ result: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          return JSON.stringify({ error: 'Balance fetch failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_cancel': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const orderId = toolInput.order_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py cancel ${orderId}`;

        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return JSON.stringify({ result: 'Order cancelled', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          return JSON.stringify({ error: 'Cancel failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_orders': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py orders`;

        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return JSON.stringify({ result: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          return JSON.stringify({ error: 'Orders fetch failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_market_sell': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const tokenId = toolInput.token_id as string;
        const size = toolInput.size as number | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = size
          ? `cd ${tradingDir} && python3 polymarket.py market_sell ${tokenId} ${size}`
          : `cd ${tradingDir} && python3 polymarket.py market_sell ${tokenId}`;

        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          await context.credentials.markSuccess(userId, 'polymarket');
          return JSON.stringify({ result: 'Market sell executed', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'polymarket');
          }
          return JSON.stringify({ error: 'Market sell failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_market_buy': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const tokenId = toolInput.token_id as string;
        const amount = toolInput.amount as number;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py market_buy ${tokenId} ${amount}`;

        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          await context.credentials.markSuccess(userId, 'polymarket');
          return JSON.stringify({ result: 'Market buy executed', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'polymarket');
          }
          return JSON.stringify({ error: 'Market buy failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_maker_buy': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const tokenId = toolInput.token_id as string;
        const price = toolInput.price as number;
        const size = toolInput.size as number;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py maker_buy ${tokenId} ${price} ${size}`;

        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          await context.credentials.markSuccess(userId, 'polymarket');
          return JSON.stringify({ result: 'Maker buy order placed (POST_ONLY)', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'polymarket');
          }
          return JSON.stringify({ error: 'Maker buy failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_maker_sell': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const tokenId = toolInput.token_id as string;
        const price = toolInput.price as number;
        const size = toolInput.size as number;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py maker_sell ${tokenId} ${price} ${size}`;

        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          await context.credentials.markSuccess(userId, 'polymarket');
          return JSON.stringify({ result: 'Maker sell order placed (POST_ONLY)', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'polymarket');
          }
          return JSON.stringify({ error: 'Maker sell failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_fee_rate': {
        // Fee rate is a public endpoint, no credentials needed
        const tokenId = toolInput.token_id as string;

        try {
          const response = await fetch(`https://clob.polymarket.com/fee-rate?token_id=${tokenId}`);
          if (!response.ok) {
            return JSON.stringify({ error: `Failed to get fee rate: ${response.status}` });
          }
          const data = await response.json() as ApiResponse;
          const feeRateBps = data.fee_rate_bps || data.base_fee || 0;
          const hasFeesMessage = feeRateBps > 0
            ? `This market has FEES. Taker fee: ~${(feeRateBps / 100).toFixed(1)}% base rate. Use maker_buy/maker_sell to avoid fees.`
            : 'This market has NO FEES. Regular buy/sell is fine.';

          return JSON.stringify({
            token_id: tokenId,
            fee_rate_bps: feeRateBps,
            has_fees: feeRateBps > 0,
            message: hasFeesMessage,
          });
        } catch (err: unknown) {
          const error = err as { message?: string };
          return JSON.stringify({ error: 'Fee rate check failed', details: error.message });
        }
      }

      case 'polymarket_midpoint': {
        // Public endpoint - no credentials needed
        const tokenId = toolInput.token_id as string;

        try {
          const response = await fetch(`https://clob.polymarket.com/midpoint?token_id=${tokenId}`);
          if (!response.ok) {
            return JSON.stringify({ error: `Failed to get midpoint: ${response.status}` });
          }
          const data = await response.json() as ApiResponse;
          return JSON.stringify({
            token_id: tokenId,
            midpoint: data.mid,
            message: `Current midpoint price: ${(parseFloat(data.mid) * 100).toFixed(1)}¢`,
          });
        } catch (err: unknown) {
          const error = err as { message?: string };
          return JSON.stringify({ error: 'Midpoint fetch failed', details: error.message });
        }
      }

      case 'polymarket_spread': {
        // Public endpoint - no credentials needed
        const tokenId = toolInput.token_id as string;

        try {
          const response = await fetch(`https://clob.polymarket.com/spread?token_id=${tokenId}`);
          if (!response.ok) {
            return JSON.stringify({ error: `Failed to get spread: ${response.status}` });
          }
          const data = await response.json() as ApiResponse;
          return JSON.stringify({
            token_id: tokenId,
            spread: data.spread,
            spread_pct: (parseFloat(data.spread) * 100).toFixed(2) + '%',
            message: `Bid-ask spread: ${(parseFloat(data.spread) * 100).toFixed(2)}%`,
          });
        } catch (err: unknown) {
          const error = err as { message?: string };
          return JSON.stringify({ error: 'Spread fetch failed', details: error.message });
        }
      }

      case 'polymarket_last_trade': {
        // Public endpoint - no credentials needed
        const tokenId = toolInput.token_id as string;

        try {
          const response = await fetch(`https://clob.polymarket.com/last-trade-price?token_id=${tokenId}`);
          if (!response.ok) {
            return JSON.stringify({ error: `Failed to get last trade: ${response.status}` });
          }
          const data = await response.json() as ApiResponse;
          return JSON.stringify({
            token_id: tokenId,
            last_trade_price: data.price,
            message: `Last trade: ${(parseFloat(data.price) * 100).toFixed(1)}¢`,
          });
        } catch (err: unknown) {
          const error = err as { message?: string };
          return JSON.stringify({ error: 'Last trade fetch failed', details: error.message });
        }
      }

      case 'polymarket_tick_size': {
        // Public endpoint - no credentials needed
        const tokenId = toolInput.token_id as string;

        try {
          const response = await fetch(`https://clob.polymarket.com/tick-size?token_id=${tokenId}`);
          if (!response.ok) {
            return JSON.stringify({ error: `Failed to get tick size: ${response.status}` });
          }
          const data = await response.json() as ApiResponse;
          return JSON.stringify({
            token_id: tokenId,
            tick_size: data.minimum_tick_size,
            message: `Minimum price increment: ${data.minimum_tick_size}`,
          });
        } catch (err: unknown) {
          const error = err as { message?: string };
          return JSON.stringify({ error: 'Tick size fetch failed', details: error.message });
        }
      }

      case 'polymarket_trades': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const marketId = toolInput.market_id as string | undefined;
        const tokenId = toolInput.token_id as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py trades`;
        if (marketId) cmd += ` --market ${marketId}`;
        if (tokenId) cmd += ` --token ${tokenId}`;

        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          await context.credentials.markSuccess(userId, 'polymarket');
          return JSON.stringify({ result: 'Trade history', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'polymarket');
          }
          return JSON.stringify({ error: 'Trade history failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_cancel_market': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const marketId = toolInput.market_id as string;
        const tokenId = toolInput.token_id as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py cancel_market ${marketId}`;
        if (tokenId) cmd += ` ${tokenId}`;

        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          await context.credentials.markSuccess(userId, 'polymarket');
          return JSON.stringify({ result: 'Orders cancelled for market', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'polymarket');
          }
          return JSON.stringify({ error: 'Cancel market orders failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_estimate_fill': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds || polyCreds.platform !== 'polymarket') {
          return JSON.stringify({
            error: 'No Polymarket credentials set up. Use setup_polymarket_credentials first.',
          });
        }

        const tokenId = toolInput.token_id as string;
        const side = toolInput.side as string;
        const amount = toolInput.amount as number;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py estimate_fill ${tokenId} ${side} ${amount}`;

        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          await context.credentials.markSuccess(userId, 'polymarket');
          return JSON.stringify({ result: 'Fill estimate', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'polymarket');
          }
          return JSON.stringify({ error: 'Fill estimate failed', details: error.stderr || error.message });
        }
      }

      case 'polymarket_market_info': {
        // Public endpoint - no credentials needed
        const conditionId = toolInput.condition_id as string;

        try {
          const response = await fetch(`https://gamma-api.polymarket.com/markets/${conditionId}`);
          if (!response.ok) {
            return JSON.stringify({ error: `Failed to get market info: ${response.status}` });
          }
          const data = await response.json() as ApiResponse;
          return JSON.stringify({
            condition_id: data.condition_id,
            question: data.question,
            description: data.description?.slice(0, 500),
            volume: data.volume,
            liquidity: data.liquidity,
            active: data.active,
            closed: data.closed,
            end_date: data.end_date_iso,
            outcomes: data.tokens?.map((t: { token_id: string; outcome: string; price: number }) => ({
              token_id: t.token_id,
              outcome: t.outcome,
              price: t.price,
            })),
          });
        } catch (err: unknown) {
          const error = err as { message?: string };
          return JSON.stringify({ error: 'Market info fetch failed', details: error.message });
        }
      }

      // ========== HEALTH & CONFIG HANDLERS ==========
      case 'polymarket_health': {
        try {
          const response = await fetch('https://clob.polymarket.com/');
          return JSON.stringify({ ok: response.ok, status: response.status });
        } catch (err: unknown) {
          return JSON.stringify({ ok: false, error: (err as Error).message });
        }
      }

      case 'polymarket_server_time': {
        try {
          const response = await fetch('https://clob.polymarket.com/time');
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_get_address': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        return JSON.stringify({ address: (polyCreds.data as PolymarketCredentials).funderAddress });
      }

      case 'polymarket_collateral_address': {
        return JSON.stringify({ address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', name: 'USDC on Polygon' });
      }

      case 'polymarket_conditional_address': {
        return JSON.stringify({ address: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045', name: 'CTF (Conditional Token Framework)' });
      }

      case 'polymarket_exchange_address': {
        const negRisk = toolInput.neg_risk as boolean;
        if (negRisk) {
          return JSON.stringify({ address: '0xC5d563A36AE78145C45a50134d48A1215220f80a', name: 'Neg Risk Exchange (crypto markets)' });
        }
        return JSON.stringify({ address: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E', name: 'Regular Exchange' });
      }

      // ========== ADDITIONAL MARKET DATA HANDLERS ==========
      case 'polymarket_price': {
        const tokenId = toolInput.token_id as string;
        const side = toolInput.side as string;
        try {
          const response = await fetch(`https://clob.polymarket.com/price?token_id=${tokenId}&side=${side}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify({ token_id: tokenId, side, price: data.price });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_neg_risk': {
        const tokenId = toolInput.token_id as string;
        try {
          const response = await fetch(`https://clob.polymarket.com/neg-risk?token_id=${tokenId}`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify({ token_id: tokenId, neg_risk: data.neg_risk });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ========== BATCH HANDLERS ==========
      case 'polymarket_midpoints_batch': {
        const tokenIds = toolInput.token_ids as string[];
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py midpoints_batch ${tokenIds.join(',')}`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { message?: string }).message });
        }
      }

      case 'polymarket_prices_batch': {
        const requests = toolInput.requests as Array<{ token_id: string; side: string }>;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const requestsJson = JSON.stringify(requests);
        const cmd = `cd ${tradingDir} && python3 polymarket.py prices_batch '${requestsJson}'`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { message?: string }).message });
        }
      }

      case 'polymarket_spreads_batch': {
        const tokenIds = toolInput.token_ids as string[];
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py spreads_batch ${tokenIds.join(',')}`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { message?: string }).message });
        }
      }

      case 'polymarket_orderbooks_batch': {
        const tokenIds = toolInput.token_ids as string[];
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py orderbooks_batch ${tokenIds.join(',')}`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { message?: string }).message });
        }
      }

      case 'polymarket_last_trades_batch': {
        const tokenIds = toolInput.token_ids as string[];
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py last_trades_batch ${tokenIds.join(',')}`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { message?: string }).message });
        }
      }

      // ========== MARKET DISCOVERY HANDLERS ==========
      case 'polymarket_markets': {
        const nextCursor = toolInput.next_cursor as string | undefined;
        try {
          const url = nextCursor
            ? `https://clob.polymarket.com/markets?next_cursor=${nextCursor}`
            : 'https://clob.polymarket.com/markets';
          const response = await fetch(url);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_simplified_markets': {
        const nextCursor = toolInput.next_cursor as string | undefined;
        try {
          const url = nextCursor
            ? `https://clob.polymarket.com/simplified-markets?next_cursor=${nextCursor}`
            : 'https://clob.polymarket.com/simplified-markets';
          const response = await fetch(url);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_sampling_markets': {
        const nextCursor = toolInput.next_cursor as string | undefined;
        try {
          const url = nextCursor
            ? `https://clob.polymarket.com/sampling-markets?next_cursor=${nextCursor}`
            : 'https://clob.polymarket.com/sampling-markets';
          const response = await fetch(url);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_market_trades_events': {
        const conditionId = toolInput.condition_id as string;
        try {
          const response = await fetch(`https://clob.polymarket.com/markets/${conditionId}/trades`);
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ========== ORDER OPERATIONS HANDLERS ==========
      case 'polymarket_get_order': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const orderId = toolInput.order_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py get_order ${orderId}`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_post_orders_batch': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const orders = toolInput.orders as Array<{ token_id: string; price: number; size: number; side: string }>;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const ordersJson = JSON.stringify(orders);
        const cmd = `cd ${tradingDir} && python3 polymarket.py post_orders_batch '${ordersJson}'`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 60000, encoding: 'utf-8', env: userEnv });
          await context.credentials.markSuccess(userId, 'polymarket');
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_cancel_orders_batch': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const orderIds = toolInput.order_ids as string[];
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py cancel_orders_batch ${orderIds.join(',')}`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          await context.credentials.markSuccess(userId, 'polymarket');
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== API KEY MANAGEMENT HANDLERS ==========
      case 'polymarket_create_api_key': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const nonce = (toolInput.nonce as number) || 0;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py create_api_key ${nonce}`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_derive_api_key': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const nonce = (toolInput.nonce as number) || 0;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py derive_api_key ${nonce}`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_get_api_keys': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py get_api_keys`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_delete_api_key': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py delete_api_key`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== READ-ONLY API KEY HANDLERS ==========
      case 'polymarket_create_readonly_api_key': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py create_readonly_api_key`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_get_readonly_api_keys': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py get_readonly_api_keys`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_delete_readonly_api_key': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const apiKey = toolInput.api_key as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py delete_readonly_api_key "${apiKey}"`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_validate_readonly_api_key': {
        // This is a public endpoint - doesn't need user credentials
        const apiKey = toolInput.api_key as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py validate_readonly_api_key "${apiKey}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== BALANCE & ALLOWANCE HANDLERS ==========
      case 'polymarket_get_balance_allowance': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const assetType = toolInput.asset_type as string;
        const tokenId = toolInput.token_id as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py get_balance_allowance ${assetType}`;
        if (tokenId) cmd += ` ${tokenId}`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }
      case 'polymarket_update_balance_allowance': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const assetType = toolInput.asset_type as string;
        const tokenId = toolInput.token_id as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py update_balance_allowance ${assetType}`;
        if (tokenId) cmd += ` ${tokenId}`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== ADVANCED FEATURES HANDLERS ==========
      case 'polymarket_heartbeat': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const heartbeatId = toolInput.heartbeat_id as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py heartbeat`;
        if (heartbeatId) cmd += ` ${heartbeatId}`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_is_order_scoring': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const orderId = toolInput.order_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py is_order_scoring ${orderId}`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_are_orders_scoring': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const orderIds = toolInput.order_ids as string[];
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py are_orders_scoring ${orderIds.join(',')}`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_notifications': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py notifications`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_drop_notifications': {
        const polyCreds = context.tradingContext?.credentials.get('polymarket');
        if (!polyCreds) {
          return JSON.stringify({ error: 'No Polymarket credentials set up.' });
        }
        const notificationIds = toolInput.notification_ids as string[];
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py drop_notifications ${notificationIds.join(',')}`;
        const creds = polyCreds.data as PolymarketCredentials;
        const userEnv = {
          ...process.env,
          PRIVATE_KEY: creds.privateKey,
          POLY_FUNDER_ADDRESS: creds.funderAddress,
          POLY_API_KEY: creds.apiKey,
          POLY_API_SECRET: creds.apiSecret,
          POLY_API_PASSPHRASE: creds.apiPassphrase,
        };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_closed_only_mode': {
        try {
          const response = await fetch('https://clob.polymarket.com/closed-only');
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'polymarket_orderbook_hash': {
        const tokenId = toolInput.token_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py orderbook_hash ${tokenId}`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_sampling_simplified_markets': {
        const nextCursor = toolInput.next_cursor as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py sampling_simplified_markets`;
        if (nextCursor) cmd += ` "${nextCursor}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ============================================
      // POLYMARKET GAMMA API - Events & Markets
      // ============================================

      case 'polymarket_event': {
        const eventId = toolInput.event_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py event "${eventId}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_event_by_slug': {
        const slug = toolInput.slug as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py event_by_slug "${slug}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_events': {
        const limit = toolInput.limit as number | undefined;
        const offset = toolInput.offset as number | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py events`;
        if (limit) cmd += ` ${limit}`;
        if (offset) cmd += ` ${offset}`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_search_events': {
        const query = toolInput.query as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py search_events "${query}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_event_tags': {
        const eventId = toolInput.event_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py event_tags "${eventId}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_market_by_slug': {
        const slug = toolInput.slug as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py market_by_slug "${slug}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_market_tags': {
        const marketId = toolInput.market_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py market_tags "${marketId}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ============================================
      // POLYMARKET GAMMA API - Series
      // ============================================

      case 'polymarket_series': {
        const seriesId = toolInput.series_id as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py series`;
        if (seriesId) cmd += ` "${seriesId}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_series_list': {
        const limit = toolInput.limit as number | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py series_list`;
        if (limit) cmd += ` ${limit}`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ============================================
      // POLYMARKET GAMMA API - Tags
      // ============================================

      case 'polymarket_tags': {
        const limit = toolInput.limit as number | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py tags`;
        if (limit) cmd += ` ${limit}`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_tag': {
        const tagId = toolInput.tag_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py tag "${tagId}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_tag_by_slug': {
        const slug = toolInput.slug as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py tag_by_slug "${slug}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_tag_relations': {
        const tagId = toolInput.tag_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py tag_relations "${tagId}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ============================================
      // POLYMARKET GAMMA API - Sports
      // ============================================

      case 'polymarket_sports': {
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py sports`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_teams': {
        const sport = toolInput.sport as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py teams`;
        if (sport) cmd += ` "${sport}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ============================================
      // POLYMARKET GAMMA API - Comments
      // ============================================

      case 'polymarket_comments': {
        const marketId = toolInput.market_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py comments "${marketId}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_user_comments': {
        const address = toolInput.address as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py user_comments "${address}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ============================================
      // POLYMARKET DATA API - Portfolio & Analytics
      // ============================================

      case 'polymarket_positions_value': {
        const address = toolInput.address as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py positions_value`;
        if (address) cmd += ` "${address}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_closed_positions': {
        const address = toolInput.address as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py closed_positions`;
        if (address) cmd += ` "${address}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_pnl_timeseries': {
        const address = toolInput.address as string | undefined;
        const interval = toolInput.interval as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py pnl_timeseries`;
        if (address) cmd += ` "${address}"`;
        if (interval) cmd += ` "${interval}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_overall_pnl': {
        const address = toolInput.address as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py overall_pnl`;
        if (address) cmd += ` "${address}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_user_rank': {
        const address = toolInput.address as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py user_rank`;
        if (address) cmd += ` "${address}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_leaderboard': {
        const limit = toolInput.limit as number | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py leaderboard`;
        if (limit) cmd += ` ${limit}`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_top_holders': {
        const marketId = toolInput.market_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py top_holders "${marketId}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_user_activity': {
        const address = toolInput.address as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py user_activity`;
        if (address) cmd += ` "${address}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_open_interest': {
        const marketId = toolInput.market_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py open_interest "${marketId}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_live_volume': {
        const eventId = toolInput.event_id as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py live_volume`;
        if (eventId) cmd += ` "${eventId}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_price_history': {
        const tokenId = toolInput.token_id as string;
        const interval = toolInput.interval as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 polymarket.py price_history "${tokenId}"`;
        if (interval) cmd += ` "${interval}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ============================================
      // POLYMARKET REWARDS API
      // ============================================

      case 'polymarket_daily_rewards': {
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py daily_rewards`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_market_rewards': {
        const marketId = toolInput.market_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py market_rewards "${marketId}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'polymarket_reward_markets': {
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py reward_markets`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ============================================
      // POLYMARKET PROFILES API
      // ============================================

      case 'polymarket_profile': {
        const address = toolInput.address as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 polymarket.py profile "${address}"`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_buy': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({
            error: 'No Kalshi credentials set up. Use setup_kalshi_credentials first.',
          });
        }

        const ticker = toolInput.ticker as string;
        const side = toolInput.side as string;
        const count = toolInput.count as number;
        const price = toolInput.price as number;

        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py buy ${ticker} ${side} ${count} ${price}`;

        const creds = kalshiCreds.data;
        const userEnv = {
          ...process.env,
          KALSHI_EMAIL: creds.email,
          KALSHI_PASSWORD: creds.password,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          await context.credentials.markSuccess(userId, 'kalshi');
          return JSON.stringify({ result: 'Order placed', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'kalshi');
          }
          return JSON.stringify({ error: 'Order failed', details: error.stderr || error.message });
        }
      }

      case 'kalshi_sell': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({
            error: 'No Kalshi credentials set up. Use setup_kalshi_credentials first.',
          });
        }

        const ticker = toolInput.ticker as string;
        const side = toolInput.side as string;
        const count = toolInput.count as number;
        const price = toolInput.price as number;

        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py sell ${ticker} ${side} ${count} ${price}`;

        const creds = kalshiCreds.data;
        const userEnv = {
          ...process.env,
          KALSHI_EMAIL: creds.email,
          KALSHI_PASSWORD: creds.password,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          await context.credentials.markSuccess(userId, 'kalshi');
          return JSON.stringify({ result: 'Sell order placed', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          if (error.stderr?.includes('auth') || error.stderr?.includes('401')) {
            await context.credentials.markFailure(userId, 'kalshi');
          }
          return JSON.stringify({ error: 'Sell failed', details: error.stderr || error.message });
        }
      }

      case 'kalshi_positions': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({
            error: 'No Kalshi credentials set up. Use setup_kalshi_credentials first.',
          });
        }

        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py positions`;

        const creds = kalshiCreds.data;
        const userEnv = {
          ...process.env,
          KALSHI_EMAIL: creds.email,
          KALSHI_PASSWORD: creds.password,
        };

        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return JSON.stringify({ result: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          return JSON.stringify({ error: 'Failed to get positions', details: error.stderr || error.message });
        }
      }

      case 'kalshi_search': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up. Use setup_kalshi_credentials first.' });
        }
        const query = toolInput.query as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = query
          ? `cd ${tradingDir} && python3 kalshi.py search "${query}"`
          : `cd ${tradingDir} && python3 kalshi.py search`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_market': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up. Use setup_kalshi_credentials first.' });
        }
        const ticker = toolInput.ticker as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py market ${ticker}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_balance': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up. Use setup_kalshi_credentials first.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py balance`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_orders': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up. Use setup_kalshi_credentials first.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py orders`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_cancel': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up. Use setup_kalshi_credentials first.' });
        }
        const orderId = toolInput.order_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py cancel ${orderId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - EXCHANGE INFO ==========
      case 'kalshi_exchange_status': {
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py exchange_status`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_exchange_schedule': {
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py exchange_schedule`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_announcements': {
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py announcements`;
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - MARKET DATA ==========
      case 'kalshi_orderbook': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const ticker = toolInput.ticker as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py orderbook ${ticker}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_market_trades': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const ticker = toolInput.ticker as string | undefined;
        const limit = toolInput.limit as number | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 kalshi.py market_trades`;
        if (ticker) cmd += ` --ticker ${ticker}`;
        if (limit) cmd += ` --limit ${limit}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_candlesticks': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const seriesTicker = toolInput.series_ticker as string;
        const ticker = toolInput.ticker as string;
        const interval = toolInput.interval as number | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 kalshi.py candlesticks ${seriesTicker} ${ticker}`;
        if (interval) cmd += ` --interval ${interval}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - EVENTS & SERIES ==========
      case 'kalshi_events': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const status = toolInput.status as string | undefined;
        const seriesTicker = toolInput.series_ticker as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 kalshi.py events`;
        if (status) cmd += ` --status ${status}`;
        if (seriesTicker) cmd += ` --series ${seriesTicker}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_event': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const eventTicker = toolInput.event_ticker as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py event ${eventTicker}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_series': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const category = toolInput.category as string | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 kalshi.py series`;
        if (category) cmd += ` --category ${category}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_series_info': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const seriesTicker = toolInput.series_ticker as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py series_info ${seriesTicker}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - ADVANCED TRADING ==========
      case 'kalshi_market_order': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const ticker = toolInput.ticker as string;
        const side = toolInput.side as string;
        const action = toolInput.action as string;
        const count = toolInput.count as number;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py market_order ${ticker} ${side} ${action} ${count}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_batch_create_orders': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const orders = toolInput.orders as unknown[];
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const ordersJson = JSON.stringify(orders).replace(/"/g, '\\"');
        const cmd = `cd ${tradingDir} && python3 kalshi.py batch_create_orders "${ordersJson}"`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_batch_cancel_orders': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const orderIds = toolInput.order_ids as string[];
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py batch_cancel_orders ${orderIds.join(',')}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_cancel_all': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py cancel_all`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_get_order': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const orderId = toolInput.order_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py get_order ${orderId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_amend_order': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const orderId = toolInput.order_id as string;
        const price = toolInput.price as number | undefined;
        const count = toolInput.count as number | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 kalshi.py amend_order ${orderId}`;
        if (price !== undefined) cmd += ` --price ${price}`;
        if (count !== undefined) cmd += ` --count ${count}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_decrease_order': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const orderId = toolInput.order_id as string;
        const reduceBy = toolInput.reduce_by as number;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py decrease_order ${orderId} ${reduceBy}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_queue_position': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const orderId = toolInput.order_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py queue_position ${orderId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_queue_positions': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py queue_positions`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - PORTFOLIO ==========
      case 'kalshi_fills': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const ticker = toolInput.ticker as string | undefined;
        const limit = toolInput.limit as number | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 kalshi.py fills`;
        if (ticker) cmd += ` --ticker ${ticker}`;
        if (limit) cmd += ` --limit ${limit}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_settlements': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const limit = toolInput.limit as number | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 kalshi.py settlements`;
        if (limit) cmd += ` --limit ${limit}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - ACCOUNT ==========
      case 'kalshi_account_limits': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py account_limits`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_api_keys': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py api_keys`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_create_api_key': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py create_api_key`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_delete_api_key': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const apiKey = toolInput.api_key as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py delete_api_key ${apiKey}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - EXCHANGE INFO EXTENDED ==========
      case 'kalshi_fee_changes': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py fee_changes`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_user_data_timestamp': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py user_data_timestamp`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - MARKET DATA BATCH ==========
      case 'kalshi_batch_candlesticks': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tickers = toolInput.tickers as unknown[];
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const tickersJson = JSON.stringify(tickers);
        const cmd = `cd ${tradingDir} && python3 kalshi.py batch_candlesticks '${tickersJson}'`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - EVENTS EXTENDED ==========
      case 'kalshi_event_metadata': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const eventTicker = toolInput.event_ticker as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py event_metadata ${eventTicker}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_event_candlesticks': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const seriesTicker = toolInput.series_ticker as string;
        const eventTicker = toolInput.event_ticker as string;
        const interval = toolInput.interval as number | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 kalshi.py event_candlesticks ${seriesTicker} ${eventTicker}`;
        if (interval) cmd += ` --interval ${interval}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_forecast_history': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const seriesTicker = toolInput.series_ticker as string;
        const eventTicker = toolInput.event_ticker as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py forecast_history ${seriesTicker} ${eventTicker}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_multivariate_events': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py multivariate_events`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - ORDER GROUPS ==========
      case 'kalshi_create_order_group': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const orders = toolInput.orders as unknown[];
        const maxLoss = toolInput.max_loss as number | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const ordersJson = JSON.stringify(orders);
        let cmd = `cd ${tradingDir} && python3 kalshi.py create_order_group '${ordersJson}'`;
        if (maxLoss) cmd += ` --max_loss ${maxLoss}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_order_groups': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py order_groups`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_order_group': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const groupId = toolInput.group_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py order_group ${groupId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_order_group_limit': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const groupId = toolInput.group_id as string;
        const maxLoss = toolInput.max_loss as number;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py order_group_limit ${groupId} ${maxLoss}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_order_group_trigger': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const groupId = toolInput.group_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py order_group_trigger ${groupId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_order_group_reset': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const groupId = toolInput.group_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py order_group_reset ${groupId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_delete_order_group': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const groupId = toolInput.group_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py delete_order_group ${groupId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - PORTFOLIO EXTENDED ==========
      case 'kalshi_resting_order_value': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py resting_order_value`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - SUBACCOUNTS ==========
      case 'kalshi_create_subaccount': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const name = toolInput.name as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py create_subaccount "${name}"`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_subaccount_balances': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py subaccount_balances`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_subaccount_transfer': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const fromId = toolInput.from_id as string;
        const toId = toolInput.to_id as string;
        const amount = toolInput.amount as number;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py subaccount_transfer ${fromId} ${toId} ${amount}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_subaccount_transfers': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py subaccount_transfers`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - COMMUNICATIONS (RFQ/QUOTES) ==========
      case 'kalshi_comms_id': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py comms_id`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_create_rfq': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const ticker = toolInput.ticker as string;
        const side = toolInput.side as string;
        const count = toolInput.count as number;
        const minPrice = toolInput.min_price as number | undefined;
        const maxPrice = toolInput.max_price as number | undefined;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        let cmd = `cd ${tradingDir} && python3 kalshi.py create_rfq ${ticker} ${side} ${count}`;
        if (minPrice) cmd += ` --min_price ${minPrice}`;
        if (maxPrice) cmd += ` --max_price ${maxPrice}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_rfqs': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py rfqs`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_rfq': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const rfqId = toolInput.rfq_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py rfq ${rfqId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_cancel_rfq': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const rfqId = toolInput.rfq_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py cancel_rfq ${rfqId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_create_quote': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const rfqId = toolInput.rfq_id as string;
        const price = toolInput.price as number;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py create_quote ${rfqId} ${price}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_quotes': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py quotes`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_quote': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const quoteId = toolInput.quote_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py quote ${quoteId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_cancel_quote': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const quoteId = toolInput.quote_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py cancel_quote ${quoteId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_accept_quote': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const quoteId = toolInput.quote_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py accept_quote ${quoteId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_confirm_quote': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const quoteId = toolInput.quote_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py confirm_quote ${quoteId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - MULTIVARIATE COLLECTIONS ==========
      case 'kalshi_collections': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py collections`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_collection': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const collectionTicker = toolInput.collection_ticker as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py collection ${collectionTicker}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_collection_lookup': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const collectionTicker = toolInput.collection_ticker as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py collection_lookup ${collectionTicker}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_collection_lookup_history': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const collectionTicker = toolInput.collection_ticker as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py collection_lookup_history ${collectionTicker}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - LIVE DATA ==========
      case 'kalshi_live_data': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const dataType = toolInput.data_type as string;
        const milestoneId = toolInput.milestone_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py live_data ${dataType} ${milestoneId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_live_data_batch': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const requests = toolInput.requests as unknown[];
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const requestsJson = JSON.stringify(requests);
        const cmd = `cd ${tradingDir} && python3 kalshi.py live_data_batch '${requestsJson}'`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - MILESTONES ==========
      case 'kalshi_milestones': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py milestones`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_milestone': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const milestoneId = toolInput.milestone_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py milestone ${milestoneId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - STRUCTURED TARGETS ==========
      case 'kalshi_structured_targets': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py structured_targets`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_structured_target': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const targetId = toolInput.target_id as string;
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py structured_target ${targetId}`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - INCENTIVES ==========
      case 'kalshi_incentives': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py incentives`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - FCM ==========
      case 'kalshi_fcm_orders': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py fcm_orders`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_fcm_positions': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py fcm_positions`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      // ========== KALSHI - SEARCH/DISCOVERY ==========
      case 'kalshi_search_tags': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py search_tags`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'kalshi_search_sports': {
        const kalshiCreds = context.tradingContext?.credentials.get('kalshi');
        if (!kalshiCreds || kalshiCreds.platform !== 'kalshi') {
          return JSON.stringify({ error: 'No Kalshi credentials set up.' });
        }
        const tradingDir = join(__dirname, '..', '..', 'trading');
        const cmd = `cd ${tradingDir} && python3 kalshi.py search_sports`;
        const creds = kalshiCreds.data;
        const userEnv = { ...process.env, KALSHI_EMAIL: creds.email, KALSHI_PASSWORD: creds.password };
        try {
          const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', env: userEnv });
          return output.trim();
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as { stderr?: string; message?: string }).stderr || (err as { message?: string }).message });
        }
      }

      case 'manifold_bet': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({
            error: 'No Manifold credentials set up. Use setup_manifold_credentials first.',
          });
        }

        const marketId = toolInput.market_id as string;
        const amount = toolInput.amount as number;
        const outcome = toolInput.outcome as string;
        const limitProb = toolInput.limit_prob as number | undefined;

        const apiKey = manifoldCreds.data.apiKey;

        const body: Record<string, unknown> = {
          contractId: marketId,
          amount,
          outcome,
        };
        if (limitProb !== undefined) {
          body.limitProb = limitProb;
        }

        try {
          const response = await fetch('https://api.manifold.markets/v0/bet', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 401 || response.status === 403) {
              await context.credentials.markFailure(userId, 'manifold');
            }
            return JSON.stringify({ error: 'Bet failed', details: errorText });
          }

          await context.credentials.markSuccess(userId, 'manifold');
          const result = await response.json() as ApiResponse;
          return JSON.stringify({ result: 'Bet placed', betId: result.betId, shares: result.shares });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Bet failed', details: error.message });
        }
      }

      case 'manifold_sell': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({
            error: 'No Manifold credentials set up. Use setup_manifold_credentials first.',
          });
        }

        const marketId = toolInput.market_id as string;
        const outcome = toolInput.outcome as string;
        const shares = toolInput.shares as number | undefined;

        const apiKey = manifoldCreds.data.apiKey;

        const body: Record<string, unknown> = {
          contractId: marketId,
          outcome,
        };
        if (shares !== undefined) {
          body.shares = shares;
        }

        try {
          const response = await fetch('https://api.manifold.markets/v0/market/' + marketId + '/sell', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 401 || response.status === 403) {
              await context.credentials.markFailure(userId, 'manifold');
            }
            return JSON.stringify({ error: 'Sell failed', details: errorText });
          }

          await context.credentials.markSuccess(userId, 'manifold');
          const result = await response.json() as ApiResponse;
          return JSON.stringify({ result: 'Shares sold', ...(result || {}) });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Sell failed', details: error.message });
        }
      }

      case 'manifold_search': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const query = toolInput.query as string;
        const limit = (toolInput.limit as number) || 10;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(query)}&limit=${limit}&filter=open&sort=liquidity`);
          const markets = await response.json() as ApiResponse[];
          return JSON.stringify(markets.slice(0, limit).map((m: ApiResponse) => ({
            id: m.id,
            question: m.question,
            probability: m.probability,
            volume: m.volume,
            url: m.url,
          })));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_market': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const idOrSlug = toolInput.id_or_slug as string;
        try {
          let response = await fetch(`https://api.manifold.markets/v0/market/${idOrSlug}`);
          if (!response.ok) {
            response = await fetch(`https://api.manifold.markets/v0/slug/${idOrSlug}`);
          }
          const market = await response.json();
          return JSON.stringify(market);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_balance': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        try {
          const response = await fetch('https://api.manifold.markets/v0/me', {
            headers: { 'Authorization': `Key ${apiKey}` },
          });
          const user = await response.json() as ApiResponse;
          return JSON.stringify({ balance: user.balance, username: user.username });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_positions': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        try {
          const response = await fetch('https://api.manifold.markets/v0/bets?limit=1000', {
            headers: { 'Authorization': `Key ${apiKey}` },
          });
          const bets = await response.json() as ApiResponse[];
          // Aggregate by market
          const positions: Record<string, { yes: number; no: number; invested: number }> = {};
          for (const bet of bets) {
            if (!positions[bet.contractId]) {
              positions[bet.contractId] = { yes: 0, no: 0, invested: 0 };
            }
            if (bet.outcome === 'YES') {
              positions[bet.contractId].yes += bet.shares || 0;
            } else {
              positions[bet.contractId].no += bet.shares || 0;
            }
            if (!bet.isSold) {
              positions[bet.contractId].invested += bet.amount;
            }
          }
          return JSON.stringify(positions);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_bets': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        const marketId = toolInput.market_id as string | undefined;
        try {
          const url = marketId
            ? `https://api.manifold.markets/v0/bets?contractId=${marketId}`
            : 'https://api.manifold.markets/v0/bets';
          const response = await fetch(url, {
            headers: { 'Authorization': `Key ${apiKey}` },
          });
          const bets = await response.json() as ApiResponse[];
          return JSON.stringify(bets.slice(0, 50));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_cancel': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        const betId = toolInput.bet_id as string;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/bet/cancel/${betId}`, {
            method: 'POST',
            headers: { 'Authorization': `Key ${apiKey}` },
          });
          if (!response.ok) {
            return JSON.stringify({ error: `Cancel failed: ${response.status}` });
          }
          return JSON.stringify({ result: 'Cancelled', bet_id: betId });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_multiple_choice': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        const marketId = toolInput.market_id as string;
        const answerId = toolInput.answer_id as string;
        const amount = toolInput.amount as number;
        try {
          const response = await fetch('https://api.manifold.markets/v0/bet', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify({ contractId: marketId, amount, answerId }),
          });
          if (!response.ok) {
            return JSON.stringify({ error: `Bet failed: ${response.status}` });
          }
          const result = await response.json() as ApiResponse;
          return JSON.stringify({ result: 'Bet placed', ...(result || {}) });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // MANIFOLD - USER ENDPOINT HANDLERS
      // ============================================

      case 'manifold_get_user': {
        const username = toolInput.username as string;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/user/${encodeURIComponent(username)}`);
          if (!response.ok) return JSON.stringify({ error: `User not found: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_get_user_lite': {
        const username = toolInput.username as string;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/user/${encodeURIComponent(username)}/lite`);
          if (!response.ok) return JSON.stringify({ error: `User not found: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_get_user_by_id': {
        const userId = toolInput.user_id as string;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/user/by-id/${userId}`);
          if (!response.ok) return JSON.stringify({ error: `User not found: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_get_user_by_id_lite': {
        const userId = toolInput.user_id as string;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/user/by-id/${userId}/lite`);
          if (!response.ok) return JSON.stringify({ error: `User not found: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_get_me': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        try {
          const response = await fetch('https://api.manifold.markets/v0/me', {
            headers: { 'Authorization': `Key ${apiKey}` },
          });
          if (!response.ok) return JSON.stringify({ error: `Auth failed: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_get_user_portfolio': {
        const userId = toolInput.user_id as string | undefined;
        let targetUserId = userId;

        if (!targetUserId) {
          const manifoldCreds = context.tradingContext?.credentials.get('manifold');
          if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
            return JSON.stringify({ error: 'No user_id provided and no Manifold credentials set up.' });
          }
          // Get own user ID first
          const apiKey = manifoldCreds.data.apiKey;
          const meResponse = await fetch('https://api.manifold.markets/v0/me', {
            headers: { 'Authorization': `Key ${apiKey}` },
          });
          if (!meResponse.ok) return JSON.stringify({ error: 'Could not get user info' });
          const me = await meResponse.json() as { id: string };
          targetUserId = me.id;
        }

        try {
          const response = await fetch(`https://api.manifold.markets/v0/get-user-portfolio?userId=${targetUserId}`);
          if (!response.ok) return JSON.stringify({ error: `Portfolio fetch failed: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_get_user_portfolio_history': {
        const userId = toolInput.user_id as string;
        const period = toolInput.period as string;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/get-user-portfolio-history?userId=${userId}&period=${period}`);
          if (!response.ok) return JSON.stringify({ error: `Portfolio history fetch failed: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_list_users': {
        const limit = (toolInput.limit as number) || 1000;
        const before = toolInput.before as string | undefined;
        try {
          let url = `https://api.manifold.markets/v0/users?limit=${limit}`;
          if (before) url += `&before=${before}`;
          const response = await fetch(url);
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // MANIFOLD - GROUP/TOPIC HANDLERS
      // ============================================

      case 'manifold_get_groups': {
        const beforeTime = toolInput.before_time as number | undefined;
        const availableToUserId = toolInput.available_to_user_id as string | undefined;
        try {
          let url = 'https://api.manifold.markets/v0/groups';
          const params: string[] = [];
          if (beforeTime) params.push(`beforeTime=${beforeTime}`);
          if (availableToUserId) params.push(`availableToUserId=${availableToUserId}`);
          if (params.length) url += '?' + params.join('&');
          const response = await fetch(url);
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_get_group': {
        const slug = toolInput.slug as string;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/group/${encodeURIComponent(slug)}`);
          if (!response.ok) return JSON.stringify({ error: `Group not found: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_get_group_by_id': {
        const groupId = toolInput.group_id as string;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/group/by-id/${groupId}`);
          if (!response.ok) return JSON.stringify({ error: `Group not found: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // MANIFOLD - MARKET ENDPOINT HANDLERS (EXTENDED)
      // ============================================

      case 'manifold_list_markets': {
        const limit = (toolInput.limit as number) || 500;
        const sort = toolInput.sort as string | undefined;
        const order = toolInput.order as string | undefined;
        const before = toolInput.before as string | undefined;
        const userId = toolInput.user_id as string | undefined;
        const groupId = toolInput.group_id as string | undefined;
        try {
          let url = `https://api.manifold.markets/v0/markets?limit=${limit}`;
          if (sort) url += `&sort=${sort}`;
          if (order) url += `&order=${order}`;
          if (before) url += `&before=${before}`;
          if (userId) url += `&userId=${userId}`;
          if (groupId) url += `&groupId=${groupId}`;
          const response = await fetch(url);
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_get_market_by_slug': {
        const slug = toolInput.slug as string;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/slug/${encodeURIComponent(slug)}`);
          if (!response.ok) return JSON.stringify({ error: `Market not found: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_get_probability': {
        const marketId = toolInput.market_id as string;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/market/${marketId}/prob`);
          if (!response.ok) return JSON.stringify({ error: `Market not found: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_get_probabilities': {
        const marketIds = toolInput.market_ids as string[];
        try {
          const response = await fetch(`https://api.manifold.markets/v0/market-probs?ids=${marketIds.join(',')}`);
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_get_market_positions': {
        const marketId = toolInput.market_id as string;
        const order = toolInput.order as string | undefined;
        const top = toolInput.top as number | undefined;
        const bottom = toolInput.bottom as number | undefined;
        const userId = toolInput.user_id as string | undefined;
        try {
          let url = `https://api.manifold.markets/v0/market/${marketId}/positions`;
          const params: string[] = [];
          if (order) params.push(`order=${order}`);
          if (top) params.push(`top=${top}`);
          if (bottom) params.push(`bottom=${bottom}`);
          if (userId) params.push(`userId=${userId}`);
          if (params.length) url += '?' + params.join('&');
          const response = await fetch(url);
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_get_user_metrics': {
        const userId = toolInput.user_id as string;
        const limit = toolInput.limit as number | undefined;
        const offset = toolInput.offset as number | undefined;
        const order = toolInput.order as string | undefined;
        try {
          let url = `https://api.manifold.markets/v0/get-user-contract-metrics-with-contracts?userId=${userId}`;
          if (limit) url += `&limit=${limit}`;
          if (offset) url += `&offset=${offset}`;
          if (order) url += `&order=${order}`;
          const response = await fetch(url);
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_create_market': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;

        const body: Record<string, unknown> = {
          outcomeType: toolInput.outcome_type,
          question: toolInput.question,
        };
        if (toolInput.description) body.descriptionMarkdown = toolInput.description;
        if (toolInput.close_time) body.closeTime = toolInput.close_time;
        if (toolInput.initial_prob) body.initialProb = toolInput.initial_prob;
        if (toolInput.min !== undefined) body.min = toolInput.min;
        if (toolInput.max !== undefined) body.max = toolInput.max;
        if (toolInput.answers) body.answers = toolInput.answers;
        if (toolInput.group_ids) body.groupIds = toolInput.group_ids;
        if (toolInput.visibility) body.visibility = toolInput.visibility;

        try {
          const response = await fetch('https://api.manifold.markets/v0/market', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify(body),
          });
          if (!response.ok) {
            const errText = await response.text();
            return JSON.stringify({ error: `Create failed: ${response.status}`, details: errText });
          }
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_add_answer': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        const marketId = toolInput.market_id as string;
        const text = toolInput.text as string;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/market/${marketId}/answer`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify({ text }),
          });
          if (!response.ok) return JSON.stringify({ error: `Add answer failed: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_add_liquidity': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        const marketId = toolInput.market_id as string;
        const amount = toolInput.amount as number;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/market/${marketId}/add-liquidity`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify({ amount }),
          });
          if (!response.ok) return JSON.stringify({ error: `Add liquidity failed: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_add_bounty': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        const marketId = toolInput.market_id as string;
        const amount = toolInput.amount as number;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/market/${marketId}/add-bounty`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify({ amount }),
          });
          if (!response.ok) return JSON.stringify({ error: `Add bounty failed: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_award_bounty': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        const marketId = toolInput.market_id as string;
        const commentId = toolInput.comment_id as string;
        const amount = toolInput.amount as number;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/market/${marketId}/award-bounty`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify({ amount, commentId }),
          });
          if (!response.ok) return JSON.stringify({ error: `Award bounty failed: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_close_market': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        const marketId = toolInput.market_id as string;
        const closeTime = toolInput.close_time as number;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/market/${marketId}/close`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify({ closeTime }),
          });
          if (!response.ok) return JSON.stringify({ error: `Close market failed: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_manage_topic': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        const marketId = toolInput.market_id as string;
        const groupId = toolInput.group_id as string;
        const remove = toolInput.remove as boolean || false;
        try {
          const response = await fetch(`https://api.manifold.markets/v0/market/${marketId}/group`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify({ groupId, remove }),
          });
          if (!response.ok) return JSON.stringify({ error: `Manage topic failed: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_resolve_market': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        const marketId = toolInput.market_id as string;
        const outcome = toolInput.outcome as string;
        const probabilityInt = toolInput.probability_int as number | undefined;

        const body: Record<string, unknown> = { outcome };
        if (probabilityInt !== undefined) body.probabilityInt = probabilityInt;

        try {
          const response = await fetch(`https://api.manifold.markets/v0/market/${marketId}/resolve`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify(body),
          });
          if (!response.ok) return JSON.stringify({ error: `Resolve failed: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // MANIFOLD - BETTING HANDLERS (EXTENDED)
      // ============================================

      case 'manifold_multi_bet': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        const marketId = toolInput.market_id as string;
        const answerIds = toolInput.answer_ids as string[];
        const amount = toolInput.amount as number;
        try {
          const response = await fetch('https://api.manifold.markets/v0/multi-bet', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify({ contractId: marketId, answerIds, amount }),
          });
          if (!response.ok) return JSON.stringify({ error: `Multi-bet failed: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // MANIFOLD - COMMENT HANDLERS
      // ============================================

      case 'manifold_get_comments': {
        const marketId = toolInput.market_id as string | undefined;
        const marketSlug = toolInput.market_slug as string | undefined;
        const userId = toolInput.user_id as string | undefined;
        const limit = (toolInput.limit as number) || 1000;
        const page = toolInput.page as number | undefined;
        try {
          let url = 'https://api.manifold.markets/v0/comments';
          const params: string[] = [];
          if (marketId) params.push(`contractId=${marketId}`);
          if (marketSlug) params.push(`contractSlug=${marketSlug}`);
          if (userId) params.push(`userId=${userId}`);
          params.push(`limit=${limit}`);
          if (page) params.push(`page=${page}`);
          if (params.length) url += '?' + params.join('&');
          const response = await fetch(url);
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_create_comment': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        const marketId = toolInput.market_id as string;
        const content = toolInput.content as string;
        try {
          const response = await fetch('https://api.manifold.markets/v0/comment', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify({ contractId: marketId, markdown: content }),
          });
          if (!response.ok) return JSON.stringify({ error: `Create comment failed: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // MANIFOLD - TRANSACTION HANDLERS
      // ============================================

      case 'manifold_get_transactions': {
        const limit = (toolInput.limit as number) || 100;
        const offset = toolInput.offset as number | undefined;
        const before = toolInput.before as string | undefined;
        const after = toolInput.after as string | undefined;
        const toId = toolInput.to_id as string | undefined;
        const fromId = toolInput.from_id as string | undefined;
        const category = toolInput.category as string | undefined;
        try {
          let url = 'https://api.manifold.markets/v0/txns';
          const params: string[] = [`limit=${limit}`];
          if (offset) params.push(`offset=${offset}`);
          if (before) params.push(`before=${before}`);
          if (after) params.push(`after=${after}`);
          if (toId) params.push(`toId=${toId}`);
          if (fromId) params.push(`fromId=${fromId}`);
          if (category) params.push(`category=${category}`);
          url += '?' + params.join('&');
          const response = await fetch(url);
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'manifold_send_mana': {
        const manifoldCreds = context.tradingContext?.credentials.get('manifold');
        if (!manifoldCreds || manifoldCreds.platform !== 'manifold') {
          return JSON.stringify({ error: 'No Manifold credentials set up. Use setup_manifold_credentials first.' });
        }
        const apiKey = manifoldCreds.data.apiKey;
        const toIds = toolInput.to_ids as string[];
        const amount = toolInput.amount as number;
        const message = toolInput.message as string | undefined;

        const body: Record<string, unknown> = { toIds, amount };
        if (message) body.message = message;

        try {
          const response = await fetch('https://api.manifold.markets/v0/managram', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${apiKey}`,
            },
            body: JSON.stringify(body),
          });
          if (!response.ok) return JSON.stringify({ error: `Send mana failed: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // MANIFOLD - LEAGUE HANDLERS
      // ============================================

      case 'manifold_get_leagues': {
        const userId = toolInput.user_id as string | undefined;
        const season = toolInput.season as number | undefined;
        const cohort = toolInput.cohort as string | undefined;
        try {
          let url = 'https://api.manifold.markets/v0/leagues';
          const params: string[] = [];
          if (userId) params.push(`userId=${userId}`);
          if (season) params.push(`season=${season}`);
          if (cohort) params.push(`cohort=${cohort}`);
          if (params.length) url += '?' + params.join('&');
          const response = await fetch(url);
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // METACULUS HANDLERS (Forecasting Platform)
      // ============================================

      case 'metaculus_search': {
        const query = toolInput.query as string;
        const status = (toolInput.status as string) || 'open';
        const limit = (toolInput.limit as number) || 20;
        try {
          const params = new URLSearchParams({
            search: query,
            status,
            type: 'forecast',
            limit: limit.toString(),
            order_by: '-activity',
          });
          const response = await fetch(`https://www.metaculus.com/api2/questions/?${params}`, {
            headers: { 'Accept': 'application/json' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          return JSON.stringify((data.results || []).slice(0, limit).map((q: Record<string, unknown>) => ({
            id: q.id,
            title: q.title,
            probability: (q.community_prediction as { full?: { q2?: number } })?.full?.q2,
            status: q.status,
            url: q.page_url || `https://www.metaculus.com/questions/${q.id}/`,
            predictions: q.number_of_predictions,
          })));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_question': {
        const questionId = toolInput.question_id as string;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/questions/${questionId}/`, {
            headers: { 'Accept': 'application/json' },
          });
          if (!response.ok) {
            if (response.status === 404) return JSON.stringify({ error: 'Question not found' });
            return JSON.stringify({ error: `API error: ${response.status}` });
          }
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_tournaments': {
        try {
          const response = await fetch('https://www.metaculus.com/api2/tournaments/', {
            headers: { 'Accept': 'application/json' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          return JSON.stringify((data.results || []).map((t: Record<string, unknown>) => ({
            id: t.id,
            name: t.name,
            questions_count: t.questions_count,
            close_date: t.close_date,
          })));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_tournament_questions': {
        const tournamentId = toolInput.tournament_id as string;
        const limit = (toolInput.limit as number) || 50;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/questions/?tournament=${tournamentId}&limit=${limit}`, {
            headers: { 'Accept': 'application/json' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          return JSON.stringify((data.results || []).map((q: Record<string, unknown>) => ({
            id: q.id,
            title: q.title,
            probability: (q.community_prediction as { full?: { q2?: number } })?.full?.q2,
            status: q.status,
          })));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // PREDICTIT HANDLERS (Read Only)
      // ============================================

      case 'predictit_search': {
        const query = toolInput.query as string;
        const limit = (toolInput.limit as number) || 20;
        try {
          const response = await fetch('https://www.predictit.org/api/marketdata/all/');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const queryLower = query.toLowerCase();
          const markets = (data.markets || [])
            .filter((m: { name: string; shortName: string; contracts: Array<{ name: string }> }) =>
              m.name.toLowerCase().includes(queryLower) ||
              m.shortName.toLowerCase().includes(queryLower) ||
              m.contracts.some((c: { name: string }) => c.name.toLowerCase().includes(queryLower))
            )
            .slice(0, limit)
            .map((m: Record<string, unknown>) => ({
              id: m.id,
              name: m.name,
              url: m.url,
              contracts: (m.contracts as Array<{ id: number; name: string; lastTradePrice: number }>).map(c => ({
                id: c.id,
                name: c.name,
                price: c.lastTradePrice,
              })),
            }));
          return JSON.stringify(markets);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictit_market': {
        const marketId = toolInput.market_id as string;
        try {
          const response = await fetch('https://www.predictit.org/api/marketdata/all/');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const market = (data.markets || []).find((m: { id: number }) => m.id.toString() === marketId);
          if (!market) return JSON.stringify({ error: 'Market not found' });
          return JSON.stringify(market);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictit_all_markets': {
        try {
          const response = await fetch('https://www.predictit.org/api/marketdata/all/');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          return JSON.stringify((data.markets || []).map((m: Record<string, unknown>) => ({
            id: m.id,
            name: m.name,
            shortName: m.shortName,
            url: m.url,
            status: m.status,
            contracts: (m.contracts as Array<{ id: number; name: string; lastTradePrice: number }>).length,
          })));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // DRIFT BET HANDLERS (Solana Prediction Markets)
      // ============================================

      case 'drift_search': {
        const query = toolInput.query as string;
        try {
          const response = await fetch('https://bet.drift.trade/api/markets');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const queryLower = query.toLowerCase();
          const markets = (data.markets || [])
            .filter((m: { marketName: string; baseAssetSymbol: string }) =>
              m.marketName.toLowerCase().includes(queryLower) ||
              m.baseAssetSymbol.toLowerCase().includes(queryLower)
            )
            .map((m: Record<string, unknown>) => ({
              marketIndex: m.marketIndex,
              name: m.marketName,
              symbol: m.baseAssetSymbol,
              probability: m.probability,
              volume24h: m.volume24h,
              status: m.status,
              url: `https://bet.drift.trade/market/${m.marketIndex}`,
            }));
          return JSON.stringify(markets);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_market': {
        const marketIndex = toolInput.market_index as string;
        try {
          const response = await fetch(`https://bet.drift.trade/api/markets/${marketIndex}`);
          if (!response.ok) {
            if (response.status === 404) return JSON.stringify({ error: 'Market not found' });
            return JSON.stringify({ error: `API error: ${response.status}` });
          }
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_all_markets': {
        try {
          const response = await fetch('https://bet.drift.trade/api/markets');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          return JSON.stringify((data.markets || []).map((m: Record<string, unknown>) => ({
            marketIndex: m.marketIndex,
            name: m.marketName,
            symbol: m.baseAssetSymbol,
            probability: m.probability,
            volume24h: m.volume24h,
            status: m.status,
          })));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // COINGECKO HANDLERS (Crypto Prices)
      // ============================================

      case 'coingecko_price': {
        const coinId = toolInput.coin_id as string;
        const includeMarketCap = toolInput.include_market_cap as boolean || false;
        const include24hrVol = toolInput.include_24hr_vol as boolean || false;
        try {
          const params = new URLSearchParams({
            ids: coinId,
            vs_currencies: 'usd',
            include_24hr_change: 'true',
          });
          if (includeMarketCap) params.append('include_market_cap', 'true');
          if (include24hrVol) params.append('include_24hr_vol', 'true');
          const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?${params}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_prices': {
        const coinIds = toolInput.coin_ids as string;
        const vsCurrency = (toolInput.vs_currency as string) || 'usd';
        try {
          const params = new URLSearchParams({
            ids: coinIds,
            vs_currencies: vsCurrency,
            include_24hr_change: 'true',
            include_market_cap: 'true',
          });
          const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?${params}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_coin_info': {
        const coinId = toolInput.coin_id as string;
        try {
          const response = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          return JSON.stringify({
            id: data.id,
            symbol: data.symbol,
            name: data.name,
            description: data.description?.en?.slice(0, 500),
            links: {
              homepage: data.links?.homepage?.[0],
              twitter: data.links?.twitter_screen_name,
              reddit: data.links?.subreddit_url,
            },
            market_data: {
              current_price_usd: data.market_data?.current_price?.usd,
              market_cap_usd: data.market_data?.market_cap?.usd,
              total_volume_usd: data.market_data?.total_volume?.usd,
              price_change_24h_pct: data.market_data?.price_change_percentage_24h,
              price_change_7d_pct: data.market_data?.price_change_percentage_7d,
              ath_usd: data.market_data?.ath?.usd,
              ath_date: data.market_data?.ath_date?.usd,
              circulating_supply: data.market_data?.circulating_supply,
              total_supply: data.market_data?.total_supply,
            },
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_market_chart': {
        const coinId = toolInput.coin_id as string;
        const days = toolInput.days as string;
        const interval = toolInput.interval as string;
        try {
          const params = new URLSearchParams({ vs_currency: 'usd', days });
          if (interval) params.append('interval', interval);
          const response = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?${params}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          // Simplify the output
          const prices = (data.prices || []).slice(-50).map((p: [number, number]) => ({
            timestamp: new Date(p[0]).toISOString(),
            price: p[1],
          }));
          return JSON.stringify({ coin: coinId, days, dataPoints: prices.length, prices });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_trending': {
        try {
          const response = await fetch('https://api.coingecko.com/api/v3/search/trending');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const trending = (data.coins || []).map((c: { item: Record<string, unknown> }) => ({
            id: c.item.id,
            name: c.item.name,
            symbol: c.item.symbol,
            market_cap_rank: c.item.market_cap_rank,
            price_btc: c.item.price_btc,
          }));
          return JSON.stringify(trending);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_search': {
        const query = toolInput.query as string;
        try {
          const response = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const coins = (data.coins || []).slice(0, 10).map((c: Record<string, unknown>) => ({
            id: c.id,
            name: c.name,
            symbol: c.symbol,
            market_cap_rank: c.market_cap_rank,
          }));
          return JSON.stringify(coins);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_markets': {
        const perPage = (toolInput.per_page as number) || 100;
        const page = (toolInput.page as number) || 1;
        const order = (toolInput.order as string) || 'market_cap_desc';
        try {
          const params = new URLSearchParams({
            vs_currency: 'usd',
            order,
            per_page: String(perPage),
            page: String(page),
            sparkline: 'false',
            price_change_percentage: '24h,7d',
          });
          const response = await fetch(`https://api.coingecko.com/api/v3/coins/markets?${params}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data.map((c: Record<string, unknown>) => ({
            id: c.id,
            symbol: c.symbol,
            name: c.name,
            current_price: c.current_price,
            market_cap: c.market_cap,
            market_cap_rank: c.market_cap_rank,
            total_volume: c.total_volume,
            price_change_24h_pct: c.price_change_percentage_24h,
            price_change_7d_pct: c.price_change_percentage_7d_in_currency,
          })));
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'coingecko_global': {
        try {
          const response = await fetch('https://api.coingecko.com/api/v3/global');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const global = data.data;
          return JSON.stringify({
            active_cryptocurrencies: global.active_cryptocurrencies,
            markets: global.markets,
            total_market_cap_usd: global.total_market_cap?.usd,
            total_volume_24h_usd: global.total_volume?.usd,
            btc_dominance_pct: global.market_cap_percentage?.btc,
            eth_dominance_pct: global.market_cap_percentage?.eth,
            market_cap_change_24h_pct: global.market_cap_change_percentage_24h_usd,
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // YAHOO FINANCE HANDLERS (Stocks)
      // ============================================

      case 'yahoo_quote': {
        const symbol = (toolInput.symbol as string).toUpperCase();
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const quote = data.quoteResponse?.result?.[0];
          if (!quote) return JSON.stringify({ error: 'Symbol not found' });
          return JSON.stringify({
            symbol: quote.symbol,
            name: quote.longName || quote.shortName,
            price: quote.regularMarketPrice,
            change: quote.regularMarketChange,
            change_pct: quote.regularMarketChangePercent,
            volume: quote.regularMarketVolume,
            market_cap: quote.marketCap,
            pe_ratio: quote.trailingPE,
            eps: quote.epsTrailingTwelveMonths,
            day_high: quote.regularMarketDayHigh,
            day_low: quote.regularMarketDayLow,
            week_52_high: quote.fiftyTwoWeekHigh,
            week_52_low: quote.fiftyTwoWeekLow,
            avg_volume: quote.averageDailyVolume3Month,
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_quotes': {
        const symbols = (toolInput.symbols as string).toUpperCase();
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const quotes = (data.quoteResponse?.result || []).map((q: Record<string, unknown>) => ({
            symbol: q.symbol,
            name: q.longName || q.shortName,
            price: q.regularMarketPrice,
            change: q.regularMarketChange,
            change_pct: q.regularMarketChangePercent,
            volume: q.regularMarketVolume,
            market_cap: q.marketCap,
          }));
          return JSON.stringify(quotes);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_chart': {
        const symbol = (toolInput.symbol as string).toUpperCase();
        const range = toolInput.range as string;
        const interval = (toolInput.interval as string) || '1d';
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const result = data.chart?.result?.[0];
          if (!result) return JSON.stringify({ error: 'No chart data' });
          const timestamps = result.timestamp || [];
          const quote = result.indicators?.quote?.[0] || {};
          const candles = timestamps.slice(-50).map((ts: number, i: number) => ({
            date: new Date(ts * 1000).toISOString().split('T')[0],
            open: quote.open?.[i],
            high: quote.high?.[i],
            low: quote.low?.[i],
            close: quote.close?.[i],
            volume: quote.volume?.[i],
          }));
          return JSON.stringify({ symbol, range, interval, candles });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_search': {
        const query = toolInput.query as string;
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const results = (data.quotes || []).map((q: Record<string, unknown>) => ({
            symbol: q.symbol,
            name: q.longname || q.shortname,
            type: q.quoteType,
            exchange: q.exchange,
          }));
          return JSON.stringify(results);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_options': {
        const symbol = (toolInput.symbol as string).toUpperCase();
        const expiration = toolInput.expiration as string;
        try {
          let url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}`;
          if (expiration) {
            const expTimestamp = Math.floor(new Date(expiration).getTime() / 1000);
            url += `?date=${expTimestamp}`;
          }
          const response = await fetch(url);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const result = data.optionChain?.result?.[0];
          if (!result) return JSON.stringify({ error: 'No options data' });
          return JSON.stringify({
            symbol,
            underlyingPrice: result.quote?.regularMarketPrice,
            expirations: result.expirationDates?.map((ts: number) => new Date(ts * 1000).toISOString().split('T')[0]),
            calls: result.options?.[0]?.calls?.slice(0, 20).map((o: Record<string, unknown>) => ({
              strike: o.strike,
              bid: o.bid,
              ask: o.ask,
              lastPrice: o.lastPrice,
              volume: o.volume,
              openInterest: o.openInterest,
              impliedVolatility: o.impliedVolatility,
            })),
            puts: result.options?.[0]?.puts?.slice(0, 20).map((o: Record<string, unknown>) => ({
              strike: o.strike,
              bid: o.bid,
              ask: o.ask,
              lastPrice: o.lastPrice,
              volume: o.volume,
              openInterest: o.openInterest,
              impliedVolatility: o.impliedVolatility,
            })),
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_news': {
        const symbol = (toolInput.symbol as string).toUpperCase();
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&quotesCount=0&newsCount=10`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const news = (data.news || []).map((n: Record<string, unknown>) => ({
            title: n.title,
            publisher: n.publisher,
            link: n.link,
            publishedAt: n.providerPublishTime ? new Date((n.providerPublishTime as number) * 1000).toISOString() : null,
          }));
          return JSON.stringify(news);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_fundamentals': {
        const symbol = (toolInput.symbol as string).toUpperCase();
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=summaryDetail,financialData,defaultKeyStatistics`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const result = data.quoteSummary?.result?.[0];
          if (!result) return JSON.stringify({ error: 'No fundamentals data' });
          const summary = result.summaryDetail || {};
          const financial = result.financialData || {};
          const stats = result.defaultKeyStatistics || {};
          return JSON.stringify({
            symbol,
            pe_ratio: summary.trailingPE?.raw,
            forward_pe: summary.forwardPE?.raw,
            peg_ratio: stats.pegRatio?.raw,
            price_to_book: summary.priceToBook?.raw,
            dividend_yield: summary.dividendYield?.raw,
            dividend_rate: summary.dividendRate?.raw,
            beta: summary.beta?.raw,
            profit_margin: financial.profitMargins?.raw,
            operating_margin: financial.operatingMargins?.raw,
            revenue: financial.totalRevenue?.raw,
            revenue_growth: financial.revenueGrowth?.raw,
            earnings_growth: financial.earningsGrowth?.raw,
            current_ratio: financial.currentRatio?.raw,
            debt_to_equity: financial.debtToEquity?.raw,
            return_on_equity: financial.returnOnEquity?.raw,
            free_cash_flow: financial.freeCashflow?.raw,
            enterprise_value: stats.enterpriseValue?.raw,
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'yahoo_earnings': {
        const symbol = (toolInput.symbol as string).toUpperCase();
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=earnings,calendarEvents`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const result = data.quoteSummary?.result?.[0];
          if (!result) return JSON.stringify({ error: 'No earnings data' });
          const earnings = result.earnings || {};
          const calendar = result.calendarEvents || {};
          return JSON.stringify({
            symbol,
            earningsDate: calendar.earnings?.earningsDate?.map((d: { raw: number }) => new Date(d.raw * 1000).toISOString().split('T')[0]),
            earningsAverage: calendar.earnings?.earningsAverage?.raw,
            earningsLow: calendar.earnings?.earningsLow?.raw,
            earningsHigh: calendar.earnings?.earningsHigh?.raw,
            revenueAverage: calendar.earnings?.revenueAverage?.raw,
            quarterlyEarnings: earnings.earningsChart?.quarterly?.map((q: Record<string, { raw: number }>) => ({
              date: q.date,
              actual: q.actual?.raw,
              estimate: q.estimate?.raw,
            })),
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // OPINION.TRADE HANDLERS (BNB Chain Prediction Market)
      // ============================================

      case 'opinion_markets': {
        const status = (toolInput.status as string) || 'active';
        const limit = (toolInput.limit as number) || 50;
        try {
          const params = new URLSearchParams({ limit: String(limit) });
          if (status !== 'all') params.append('status', status);
          const response = await fetch(`https://proxy.opinion.trade:8443/openapi/market?${params}`, {
            headers: { 'apikey': process.env.OPINION_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          if (data.code !== 0) return JSON.stringify({ error: data.msg });
          return JSON.stringify(data.result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_market': {
        const marketId = toolInput.market_id as string;
        try {
          const response = await fetch(`https://proxy.opinion.trade:8443/openapi/market/${marketId}`, {
            headers: { 'apikey': process.env.OPINION_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          if (data.code !== 0) return JSON.stringify({ error: data.msg });
          return JSON.stringify(data.result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_price': {
        const tokenId = toolInput.token_id as string;
        try {
          const response = await fetch(`https://proxy.opinion.trade:8443/openapi/token/latest-price?tokenId=${tokenId}`, {
            headers: { 'apikey': process.env.OPINION_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          if (data.code !== 0) return JSON.stringify({ error: data.msg });
          return JSON.stringify(data.result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_orderbook': {
        const tokenId = toolInput.token_id as string;
        const depth = (toolInput.depth as number) || 10;
        try {
          const response = await fetch(`https://proxy.opinion.trade:8443/openapi/token/orderbook?tokenId=${tokenId}&depth=${depth}`, {
            headers: { 'apikey': process.env.OPINION_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          if (data.code !== 0) return JSON.stringify({ error: data.msg });
          return JSON.stringify(data.result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_price_history': {
        const tokenId = toolInput.token_id as string;
        const interval = (toolInput.interval as string) || '1d';
        const limit = (toolInput.limit as number) || 100;
        try {
          const params = new URLSearchParams({
            tokenId,
            interval,
            limit: String(limit),
          });
          const response = await fetch(`https://proxy.opinion.trade:8443/openapi/token/price-history?${params}`, {
            headers: { 'apikey': process.env.OPINION_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          if (data.code !== 0) return JSON.stringify({ error: data.msg });
          return JSON.stringify(data.result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_quote_tokens': {
        try {
          const response = await fetch('https://proxy.opinion.trade:8443/openapi/quoteToken', {
            headers: { 'apikey': process.env.OPINION_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          if (data.code !== 0) return JSON.stringify({ error: data.msg });
          return JSON.stringify(data.result);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Opinion.trade TRADING handlers (require SDK setup)
      case 'opinion_place_order': {
        // Note: Full implementation requires Opinion CLOB SDK with wallet
        return JSON.stringify({
          error: 'Opinion.trade trading requires SDK setup. Set OPINION_PRIVATE_KEY env var.',
          hint: 'Use opinion_markets and opinion_orderbook for read-only data.',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      case 'opinion_cancel_order': {
        return JSON.stringify({
          error: 'Opinion.trade trading requires SDK setup',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      case 'opinion_cancel_all_orders': {
        return JSON.stringify({
          error: 'Opinion.trade trading requires SDK setup',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      case 'opinion_orders': {
        return JSON.stringify({
          error: 'Opinion.trade trading requires SDK setup for authenticated endpoints',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      case 'opinion_positions': {
        return JSON.stringify({
          error: 'Opinion.trade trading requires SDK setup for authenticated endpoints',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      case 'opinion_balances': {
        return JSON.stringify({
          error: 'Opinion.trade trading requires SDK setup for authenticated endpoints',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      case 'opinion_trades': {
        return JSON.stringify({
          error: 'Opinion.trade trading requires SDK setup for authenticated endpoints',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      case 'opinion_redeem': {
        return JSON.stringify({
          error: 'Opinion.trade redemption requires SDK setup with wallet',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      // Opinion.trade - Additional handlers for 100% API coverage
      case 'opinion_categorical_market': {
        const marketId = toolInput.market_id as number;
        try {
          const response = await fetch(`https://api.opinion.trade/api/v1/categorical-markets/${marketId}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_fee_rates': {
        const tokenId = toolInput.token_id as string;
        try {
          const response = await fetch(`https://api.opinion.trade/api/v1/fee-rates?token_id=${tokenId}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'opinion_order_by_id': {
        return JSON.stringify({
          error: 'Opinion.trade order lookup requires SDK setup',
          hint: 'Use opinion_orders to list all your orders',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      case 'opinion_place_orders_batch': {
        return JSON.stringify({
          error: 'Opinion.trade batch orders require SDK setup with wallet',
          hint: 'Use opinion_place_order for single orders',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      case 'opinion_cancel_orders_batch': {
        return JSON.stringify({
          error: 'Opinion.trade batch cancel requires SDK setup with wallet',
          hint: 'Use opinion_cancel_order for single cancels',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      case 'opinion_enable_trading': {
        return JSON.stringify({
          error: 'Opinion.trade enable_trading requires SDK setup with wallet',
          hint: 'This approves tokens for the exchange contract - one-time setup',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      case 'opinion_split': {
        return JSON.stringify({
          error: 'Opinion.trade split requires SDK setup with wallet',
          hint: 'Split converts collateral (USDT) into YES+NO outcome tokens',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      case 'opinion_merge': {
        return JSON.stringify({
          error: 'Opinion.trade merge requires SDK setup with wallet',
          hint: 'Merge converts YES+NO tokens back into collateral (USDT)',
          docs: 'https://docs.opinion.trade/developer-guide/opinion-clob-sdk',
        });
      }

      // ============================================
      // PREDICT.FUN HANDLERS (BNB Chain Prediction Market)
      // ============================================

      case 'predictfun_markets': {
        const first = (toolInput.first as number) || 50;
        const after = toolInput.after as string;
        try {
          const params = new URLSearchParams({ first: String(first) });
          if (after) params.append('after', after);
          const response = await fetch(`https://api.predict.fun/v1/markets?${params}`, {
            headers: { 'x-api-key': process.env.PREDICTFUN_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          if (!data.success) return JSON.stringify({ error: 'Request failed' });
          return JSON.stringify({
            cursor: data.cursor,
            markets: data.data.map((m: Record<string, unknown>) => ({
              id: m.id,
              title: m.title,
              question: m.question,
              status: m.status,
              isNegRisk: m.isNegRisk,
              feeRateBps: m.feeRateBps,
              outcomes: m.outcomes,
            })),
          });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictfun_market': {
        const marketId = toolInput.market_id as string;
        try {
          const response = await fetch(`https://api.predict.fun/v1/markets/${marketId}`, {
            headers: { 'x-api-key': process.env.PREDICTFUN_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          if (!data.success) return JSON.stringify({ error: 'Market not found' });
          return JSON.stringify(data.data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictfun_orderbook': {
        const marketId = toolInput.market_id as string;
        try {
          const response = await fetch(`https://api.predict.fun/v1/markets/${marketId}/orderbook`, {
            headers: { 'x-api-key': process.env.PREDICTFUN_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          if (!data.success) return JSON.stringify({ error: 'Orderbook not found' });
          return JSON.stringify(data.data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictfun_market_stats': {
        const marketId = toolInput.market_id as string;
        try {
          const response = await fetch(`https://api.predict.fun/v1/markets/${marketId}/statistics`, {
            headers: { 'x-api-key': process.env.PREDICTFUN_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          if (!data.success) return JSON.stringify({ error: 'Stats not found' });
          return JSON.stringify(data.data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictfun_last_sale': {
        const marketId = toolInput.market_id as string;
        try {
          const response = await fetch(`https://api.predict.fun/v1/markets/${marketId}/last-sale`, {
            headers: { 'x-api-key': process.env.PREDICTFUN_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          if (!data.success) return JSON.stringify({ error: 'No sales data' });
          return JSON.stringify(data.data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictfun_categories': {
        try {
          const response = await fetch('https://api.predict.fun/v1/categories', {
            headers: { 'x-api-key': process.env.PREDICTFUN_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          if (!data.success) return JSON.stringify({ error: 'Failed to get categories' });
          return JSON.stringify(data.data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictfun_category': {
        const slug = toolInput.slug as string;
        try {
          const response = await fetch(`https://api.predict.fun/v1/categories/${slug}`, {
            headers: { 'x-api-key': process.env.PREDICTFUN_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          if (!data.success) return JSON.stringify({ error: 'Category not found' });
          return JSON.stringify(data.data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Predict.fun TRADING handlers (require SDK/wallet)
      case 'predictfun_create_order': {
        return JSON.stringify({
          error: 'Predict.fun trading requires SDK setup with wallet signing',
          hint: 'Use predictfun_markets and predictfun_orderbook for read-only data.',
          docs: 'https://dev.predict.fun/how-to-create-or-cancel-orders-679306m0',
          sdk: 'npm install @predictdotfun/sdk',
        });
      }

      case 'predictfun_cancel_orders': {
        return JSON.stringify({
          error: 'Predict.fun trading requires SDK setup',
          docs: 'https://dev.predict.fun/',
        });
      }

      case 'predictfun_orders': {
        try {
          const response = await fetch('https://api.predict.fun/v1/orders', {
            headers: { 'x-api-key': process.env.PREDICTFUN_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data.success ? data.data : { error: 'Failed to get orders' });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictfun_positions': {
        try {
          const response = await fetch('https://api.predict.fun/v1/positions', {
            headers: { 'x-api-key': process.env.PREDICTFUN_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data.success ? data.data : { error: 'Failed to get positions' });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictfun_account': {
        try {
          const response = await fetch('https://api.predict.fun/v1/account', {
            headers: { 'x-api-key': process.env.PREDICTFUN_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data.success ? data.data : { error: 'Failed to get account' });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictfun_activity': {
        const limit = (toolInput.limit as number) || 50;
        try {
          const response = await fetch(`https://api.predict.fun/v1/account/activity?limit=${limit}`, {
            headers: { 'x-api-key': process.env.PREDICTFUN_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          return JSON.stringify(data.success ? data.data : { error: 'Failed to get activity' });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Predict.fun - Additional handlers for 100% API coverage
      case 'predictfun_order_by_hash': {
        const orderHash = toolInput.order_hash as string;
        try {
          const response = await fetch(`https://api.predict.fun/v1/orders/${orderHash}`, {
            headers: { 'x-api-key': process.env.PREDICTFUN_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'predictfun_redeem_positions': {
        return JSON.stringify({
          error: 'Predict.fun redemption requires SDK setup with wallet',
          hint: 'Use OrderBuilder.redeem_positions() from @predictdotfun/sdk',
          docs: 'https://dev.predict.fun/',
        });
      }

      case 'predictfun_merge_positions': {
        return JSON.stringify({
          error: 'Predict.fun merge requires SDK setup with wallet',
          hint: 'Use OrderBuilder.merge_positions() from @predictdotfun/sdk',
          docs: 'https://dev.predict.fun/',
        });
      }

      case 'predictfun_set_approvals': {
        return JSON.stringify({
          error: 'Predict.fun approvals require SDK setup with wallet',
          hint: 'Use OrderBuilder.set_approvals() - one-time setup before trading',
          docs: 'https://dev.predict.fun/',
        });
      }

      case 'predictfun_balance': {
        return JSON.stringify({
          error: 'Predict.fun balance check requires SDK setup with wallet',
          hint: 'Use OrderBuilder.balance_of() from @predictdotfun/sdk',
          docs: 'https://dev.predict.fun/',
        });
      }

      case 'predictfun_matches': {
        const marketId = toolInput.market_id as string;
        const limit = (toolInput.limit as number) || 50;
        try {
          let url = `https://api.predict.fun/v1/matches?limit=${limit}`;
          if (marketId) url += `&market_id=${marketId}`;
          const response = await fetch(url, {
            headers: { 'x-api-key': process.env.PREDICTFUN_API_KEY || '' },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // DRIFT BET HANDLERS (Solana - requires Gateway)
      // ============================================

      case 'drift_place_order': {
        return JSON.stringify({
          error: 'Drift trading requires self-hosted Gateway setup',
          hint: 'Use drift_search and drift_all_markets for read-only data.',
          docs: 'https://docs.drift.trade/sdk-documentation',
          gateway: 'https://github.com/drift-labs/gateway',
        });
      }

      case 'drift_cancel_order': {
        return JSON.stringify({
          error: 'Drift trading requires Gateway setup',
          docs: 'https://github.com/drift-labs/gateway',
        });
      }

      case 'drift_cancel_all_orders': {
        return JSON.stringify({
          error: 'Drift trading requires Gateway setup',
          docs: 'https://github.com/drift-labs/gateway',
        });
      }

      case 'drift_orders': {
        return JSON.stringify({
          error: 'Drift account data requires Gateway setup',
          docs: 'https://github.com/drift-labs/gateway',
        });
      }

      case 'drift_positions': {
        return JSON.stringify({
          error: 'Drift account data requires Gateway setup',
          docs: 'https://github.com/drift-labs/gateway',
        });
      }

      case 'drift_balance': {
        return JSON.stringify({
          error: 'Drift account data requires Gateway setup',
          docs: 'https://github.com/drift-labs/gateway',
        });
      }

      case 'drift_leverage': {
        return JSON.stringify({
          error: 'Drift account data requires Gateway setup',
          docs: 'https://github.com/drift-labs/gateway',
        });
      }

      case 'drift_orderbook': {
        const marketIndex = toolInput.market_index as number;
        const marketType = toolInput.market_type as string;
        try {
          // Use public DLOB server for orderbook
          const response = await fetch(`https://dlob.drift.trade/l2?marketIndex=${marketIndex}&marketType=${marketType}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Drift - Additional handlers for 100% API coverage
      case 'drift_markets': {
        try {
          const response = await fetch('https://dlob.drift.trade/markets');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          const data = await response.json() as ApiResponse;
          const marketType = toolInput.market_type as string;
          if (marketType) {
            return JSON.stringify(data.filter((m: { type: string }) => m.type === marketType));
          }
          return JSON.stringify(data);
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_market_info': {
        const marketIndex = toolInput.market_index as number;
        try {
          const response = await fetch(`https://dlob.drift.trade/marketInfo/${marketIndex}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'drift_margin_info': {
        return JSON.stringify({
          error: 'Drift margin info requires Gateway setup',
          endpoint: 'GET /v2/user/marginInfo',
          docs: 'https://github.com/drift-labs/gateway',
        });
      }

      case 'drift_collateral': {
        return JSON.stringify({
          error: 'Drift collateral requires Gateway setup',
          endpoint: 'GET /v2/collateral',
          docs: 'https://github.com/drift-labs/gateway',
        });
      }

      case 'drift_modify_order': {
        return JSON.stringify({
          error: 'Drift order modify requires Gateway setup',
          endpoint: 'PATCH /v2/orders',
          docs: 'https://github.com/drift-labs/gateway',
        });
      }

      case 'drift_cancel_and_place': {
        return JSON.stringify({
          error: 'Drift atomic cancel+place requires Gateway setup',
          endpoint: 'PUT /v2/orders',
          docs: 'https://github.com/drift-labs/gateway',
        });
      }

      case 'drift_transaction_events': {
        return JSON.stringify({
          error: 'Drift transaction events requires Gateway setup',
          endpoint: 'GET /v2/transactionEvents',
          docs: 'https://github.com/drift-labs/gateway',
        });
      }

      // ============================================
      // METACULUS HANDLERS (Forecasting - requires token)
      // ============================================

      case 'metaculus_submit_prediction': {
        const questionId = toolInput.question_id as number;
        const prediction = toolInput.prediction as number;
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus prediction requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        try {
          const response = await fetch(`https://www.metaculus.com/api2/questions/${questionId}/predict/`, {
            method: 'POST',
            headers: {
              'Authorization': `Token ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prediction }),
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify({ success: true, questionId, prediction });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_my_predictions': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        const limit = (toolInput.limit as number) || 50;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/questions/?forecast_type=made&limit=${limit}`, {
            headers: { 'Authorization': `Token ${token}` },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // Metaculus - Additional handlers for comprehensive API coverage
      case 'metaculus_bulk_predict': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        const predictions = toolInput.predictions as Array<{ question_id: number; prediction: number }>;
        try {
          const response = await fetch('https://www.metaculus.com/api2/questions/bulk-predict/', {
            method: 'POST',
            headers: {
              'Authorization': `Token ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ predictions }),
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_prediction_history': {
        const questionId = toolInput.question_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/questions/${questionId}/prediction-history/`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_categories': {
        try {
          const response = await fetch('https://www.metaculus.com/api2/categories/');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_category': {
        const categoryId = toolInput.category_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/categories/${categoryId}/`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_comments': {
        const questionId = toolInput.question_id as number;
        const limit = (toolInput.limit as number) || 50;
        try {
          let url = `https://www.metaculus.com/api2/comments/?limit=${limit}`;
          if (questionId) url += `&question=${questionId}`;
          const response = await fetch(url);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_post_comment': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        const questionId = toolInput.question_id as number;
        const comment = toolInput.comment as string;
        const parentId = toolInput.parent_id as number;
        try {
          const body: { question: number; comment_text: string; parent?: number } = {
            question: questionId,
            comment_text: comment,
          };
          if (parentId) body.parent = parentId;
          const response = await fetch('https://www.metaculus.com/api2/comments/', {
            method: 'POST',
            headers: {
              'Authorization': `Token ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_projects': {
        const limit = (toolInput.limit as number) || 50;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/projects/?limit=${limit}`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_project': {
        const projectId = toolInput.project_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/projects/${projectId}/`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_project_questions': {
        const projectId = toolInput.project_id as number;
        const status = toolInput.status as string;
        try {
          let url = `https://www.metaculus.com/api2/questions/?project=${projectId}`;
          if (status) url += `&status=${status}`;
          const response = await fetch(url);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_join_project': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        const projectId = toolInput.project_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/projects/${projectId}/join/`, {
            method: 'POST',
            headers: { 'Authorization': `Token ${token}` },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify({ success: true, projectId });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_notifications': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        try {
          const response = await fetch('https://www.metaculus.com/api2/notifications/', {
            headers: { 'Authorization': `Token ${token}` },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_mark_notifications_read': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        try {
          const response = await fetch('https://www.metaculus.com/api2/notifications/mark_read/', {
            method: 'POST',
            headers: { 'Authorization': `Token ${token}` },
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify({ success: true });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_user_profile': {
        const userId = toolInput.user_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/user-profiles/${userId}/`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_user_stats': {
        const userId = toolInput.user_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/users/${userId}/`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_leaderboard': {
        const projectId = toolInput.project_id as number;
        const limit = (toolInput.limit as number) || 50;
        try {
          let url = `https://www.metaculus.com/api2/rankings/?limit=${limit}`;
          if (projectId) url = `https://www.metaculus.com/api2/projects/${projectId}/personal-stats/`;
          const response = await fetch(url);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_create_question': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        try {
          const response = await fetch('https://www.metaculus.com/api2/questions/', {
            method: 'POST',
            headers: {
              'Authorization': `Token ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: toolInput.title,
              description: toolInput.description,
              resolution_criteria: toolInput.resolution_criteria,
              type: toolInput.type,
              scheduled_close_time: toolInput.close_time,
              scheduled_resolve_time: toolInput.resolve_time,
              project: toolInput.project_id,
            }),
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_about_numbers': {
        try {
          const response = await fetch('https://www.metaculus.com/api2/about-numbers/');
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_question_summaries': {
        const questionId = toolInput.question_id as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/question-summaries/${questionId}/`);
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify(await response.json());
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      case 'metaculus_vote': {
        const token = process.env.METACULUS_TOKEN;
        if (!token) {
          return JSON.stringify({
            error: 'Metaculus requires METACULUS_TOKEN env var',
            hint: 'Get your token at https://metaculus.com/aib',
          });
        }
        const questionId = toolInput.question_id as number;
        const direction = toolInput.direction as number;
        try {
          const response = await fetch(`https://www.metaculus.com/api2/questions/${questionId}/vote/`, {
            method: 'POST',
            headers: {
              'Authorization': `Token ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ direction }),
          });
          if (!response.ok) return JSON.stringify({ error: `API error: ${response.status}` });
          return JSON.stringify({ success: true, questionId, direction });
        } catch (err: unknown) {
          return JSON.stringify({ error: (err as Error).message });
        }
      }

      // ============================================
      // EXECUTION & BOT HANDLERS (like Clawdbot)
      // ============================================

      case 'exec_python': {
        const code = toolInput.code as string;
        const timeout = ((toolInput.timeout as number) || 30) * 1000;

        // Write code to temp file
        const tempFile = join('/tmp', `clodds_exec_${Date.now()}.py`);
        writeFileSync(tempFile, code);

        try {
          const output = execSync(`python3 ${tempFile}`, {
            timeout,
            encoding: 'utf-8',
            env: process.env,
            cwd: process.cwd(),
          });
          return JSON.stringify({ result: 'success', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; stdout?: string; message?: string };
          return JSON.stringify({
            error: 'Execution failed',
            stderr: error.stderr,
            stdout: error.stdout,
            message: error.message,
          });
        }
      }

      case 'exec_shell': {
        const command = toolInput.command as string;
        const timeout = ((toolInput.timeout as number) || 30) * 1000;

        // Security: Block dangerous commands
        const blockedPatterns = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'fork bomb'];
        for (const pattern of blockedPatterns) {
          if (command.includes(pattern)) {
            return JSON.stringify({ error: 'Command blocked for safety' });
          }
        }

        try {
          const output = execSync(command, {
            timeout,
            encoding: 'utf-8',
            env: process.env,
            shell: '/bin/bash',
          });
          return JSON.stringify({ result: 'success', output: output.trim() });
        } catch (err: unknown) {
          const error = err as { stderr?: string; stdout?: string; message?: string };
          return JSON.stringify({
            error: 'Command failed',
            stderr: error.stderr,
            stdout: error.stdout,
            message: error.message,
          });
        }
      }

      case 'start_bot': {
        const name = toolInput.name as string;
        const script = toolInput.script as string;
        const args = (toolInput.args as string) || '';

        const botId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Check if it's code or a file path
        let cmd: string;
        let cwd: string = process.cwd();

        if (script.includes('\n') || script.startsWith('import ') || script.startsWith('from ')) {
          // It's code - write to temp file
          const tempFile = join('/tmp', `clodds_bot_${botId}.py`);
          writeFileSync(tempFile, script);
          cmd = `python3 ${tempFile} ${args}`;
        } else {
          // It's a file path
          cmd = `python3 ${script} ${args}`;
        }

        const proc = spawn('bash', ['-c', cmd], {
          cwd,
          env: process.env,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const logs: string[] = [];

        proc.stdout?.on('data', (data: Buffer) => {
          const line = data.toString();
          logs.push(line);
          if (logs.length > 1000) logs.shift(); // Keep last 1000 lines
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const line = `[STDERR] ${data.toString()}`;
          logs.push(line);
          if (logs.length > 1000) logs.shift();
        });

        proc.on('exit', (code) => {
          logs.push(`[EXIT] Process exited with code ${code}`);
        });

        backgroundProcesses.set(botId, {
          process: proc,
          name,
          startedAt: new Date(),
          userId,
          logs,
        });

        return JSON.stringify({
          result: 'Bot started',
          botId,
          name,
          pid: proc.pid,
        });
      }

      case 'stop_bot': {
        const botId = toolInput.bot_id as string;
        const bot = backgroundProcesses.get(botId);

        if (!bot) {
          return JSON.stringify({ error: 'Bot not found' });
        }

        // Check ownership
        if (bot.userId !== userId) {
          return JSON.stringify({ error: 'Not your bot' });
        }

        try {
          bot.process.kill('SIGTERM');
          setTimeout(() => {
            if (!bot.process.killed) {
              bot.process.kill('SIGKILL');
            }
          }, 5000);
          backgroundProcesses.delete(botId);
          return JSON.stringify({ result: 'Bot stopped', botId });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Failed to stop bot', details: error.message });
        }
      }

      case 'list_bots': {
        const bots = Array.from(backgroundProcesses.entries())
          .filter(([, bot]) => bot.userId === userId)
          .map(([botId, bot]) => ({
            botId,
            name: bot.name,
            startedAt: bot.startedAt.toISOString(),
            pid: bot.process.pid,
            running: !bot.process.killed,
            recentLog: bot.logs.slice(-3).join('\n'),
          }));

        if (bots.length === 0) {
          return JSON.stringify({ result: 'No bots running' });
        }

        return JSON.stringify({ result: bots });
      }

      case 'get_bot_logs': {
        const botId = toolInput.bot_id as string;
        const lines = (toolInput.lines as number) || 50;
        const bot = backgroundProcesses.get(botId);

        if (!bot) {
          return JSON.stringify({ error: 'Bot not found' });
        }

        if (bot.userId !== userId) {
          return JSON.stringify({ error: 'Not your bot' });
        }

        const recentLogs = bot.logs.slice(-lines);
        return JSON.stringify({
          result: {
            botId,
            name: bot.name,
            running: !bot.process.killed,
            logs: recentLogs.join('\n'),
          },
        });
      }

      // ============================================
      // FILE & WORKSPACE HANDLERS
      // ============================================

      case 'write_file': {
        const filePath = toolInput.path as string;
        const content = toolInput.content as string;

        // Security: Restrict to workspace
        const workspaceDir = process.cwd();
        const fullPath = join(workspaceDir, filePath);

        // Prevent path traversal
        if (!fullPath.startsWith(workspaceDir)) {
          return JSON.stringify({ error: 'Path must be within workspace' });
        }

        try {
          // Create directory if needed
          const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
          if (dir && !existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }

          writeFileSync(fullPath, content);
          return JSON.stringify({ result: 'File written', path: filePath });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Write failed', details: error.message });
        }
      }

      case 'read_file': {
        const filePath = toolInput.path as string;

        const workspaceDir = process.cwd();
        const fullPath = join(workspaceDir, filePath);

        // Prevent path traversal
        if (!fullPath.startsWith(workspaceDir)) {
          return JSON.stringify({ error: 'Path must be within workspace' });
        }

        if (!existsSync(fullPath)) {
          return JSON.stringify({ error: 'File not found' });
        }

        try {
          const content = readFileSync(fullPath, 'utf-8');
          return JSON.stringify({ result: { path: filePath, content } });
        } catch (err: unknown) {
          const error = err as Error;
          return JSON.stringify({ error: 'Read failed', details: error.message });
        }
      }

      // ============================================
      // SESSION MANAGEMENT HANDLERS
      // ============================================

      case 'clear_conversation_history': {
        context.clearHistory();
        return JSON.stringify({
          result: 'Conversation history cleared. Starting fresh!',
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (error) {
    logger.error(`Tool execution error (${toolName}):`, error);
    return JSON.stringify({
      error: `Tool failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
}

export async function createAgentManager(
  config: Config,
  feeds: FeedManager,
  db: Database,
  sessionManager: SessionManager,
  sendMessage: (msg: OutgoingMessage) => Promise<void>,
  memory?: MemoryService
): Promise<AgentManager> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  const client = new Anthropic({ apiKey });
  const skills = createSkillManager(config.agents.defaults.workspace);
  const credentials = createCredentialsManager(db);
  const tools = buildTools();

  // =========================================================================
  // RATE LIMITING - Per-user rate limits to prevent abuse
  // =========================================================================
  const rateLimitConfig: RateLimitConfig = {
    maxRequests: config.agents.defaults.rateLimit?.maxRequests ?? 30,  // 30 requests
    windowMs: config.agents.defaults.rateLimit?.windowMs ?? 60000,     // per minute
    perUser: true,
  };
  const rateLimiter = new RateLimiter(rateLimitConfig);

  // Periodic cleanup of expired rate limit entries (every 5 minutes)
  const rateLimitCleanupInterval = setInterval(() => {
    rateLimiter.cleanup();
  }, 5 * 60 * 1000);

  // Build system prompt with skills
  const skillContext = skills.getSkillContext();
  const systemPrompt = SYSTEM_PROMPT.replace(
    '{{SKILLS}}',
    skillContext ? `\n## Skills Reference\n${skillContext}` : ''
  );

  async function handleMessage(message: IncomingMessage, session: Session): Promise<string> {
    // =========================================================================
    // ACCESS CONTROL - Check if user is allowed
    // =========================================================================
    const accessResult = access.checkAccess(session.userId);
    if (!accessResult.allowed) {
      logger.warn({ userId: session.userId, reason: accessResult.reason }, 'Access denied');
      return `Access denied: ${accessResult.reason}`;
    }

    // =========================================================================
    // RATE LIMITING - Check rate limit before processing
    // =========================================================================
    const rateLimitKey = rateLimitConfig.perUser ? session.userId : 'global';
    const rateLimitResult = rateLimiter.check(rateLimitKey);

    if (!rateLimitResult.allowed) {
      const resetInSeconds = Math.ceil(rateLimitResult.resetIn / 1000);
      logger.warn({
        userId: session.userId,
        remaining: rateLimitResult.remaining,
        resetIn: resetInSeconds,
      }, 'Rate limit exceeded');
      return `You've sent too many messages. Please wait ${resetInSeconds} seconds before trying again.`;
    }

    logger.debug({
      userId: session.userId,
      remaining: rateLimitResult.remaining,
    }, 'Rate limit check passed');

    // =========================================================================
    // HOOKS: message:before - Can modify/cancel incoming message
    // =========================================================================
    const beforeMsgCtx = await hooks.trigger('message:before', {
      message,
      session,
    });
    if (beforeMsgCtx.cancelled) {
      logger.debug({ userId: session.userId }, 'Message cancelled by hook');
      return 'Message processing was cancelled.';
    }

    // Hooks may have modified the message
    const processedMessage = beforeMsgCtx.message || message;

    // Build trading context for this user (per-user credentials)
    const tradingContext = await credentials.buildTradingContext(session.userId, session.key);

    // Helper to add to conversation history
    const addToHistory = (role: 'user' | 'assistant', content: string) => {
      sessionManager.addToHistory(session, role, content);
    };

    // Helper to clear conversation history
    const clearHistory = () => {
      sessionManager.clearHistory(session);
    };

    const context: AgentContext = {
      session,
      feeds,
      db,
      skills,
      credentials,
      tradingContext: tradingContext.credentials.size > 0 ? tradingContext : null,
      sendMessage,
      addToHistory,
      clearHistory,
    };

    try {
      // Build messages with conversation history for multi-turn context
      const history = sessionManager.getHistory(session);
      const messages: Anthropic.MessageParam[] = [];

      // Add previous conversation history
      for (const msg of history) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }

      // Add current user message (using processed message from hooks)
      messages.push({ role: 'user', content: processedMessage.text });

      // Save user message to history
      addToHistory('user', processedMessage.text);

      // Get model: session override > config default (Clawdbot-style)
      const defaultModel = config.agents.defaults.model.primary.replace('anthropic/', '');
      const modelId = session.context.modelOverride || defaultModel;

      // Build final system prompt (Clawdbot-style)
      // Priority: routed agent prompt > default system prompt
      let finalSystemPrompt = session.context.routedAgentPrompt || systemPrompt;

      // Add memory context if available
      if (memory) {
        const memoryContext = memory.buildContextString(session.userId, processedMessage.platform);
        if (memoryContext) {
          finalSystemPrompt += `\n\n## User Memory\n${memoryContext}`;
        }
      }

      // =========================================================================
      // HOOKS: agent:before_start - Can modify system prompt
      // =========================================================================
      const { ctx: agentBeforeCtx, result: agentStartResult } = await hooks.triggerWithResult<AgentStartResult>(
        'agent:before_start',
        {
          message: processedMessage,
          session,
          data: {
            agentId: session.agentId || 'default',
            systemPrompt: finalSystemPrompt,
            messages,
          },
        } as Partial<AgentHookContext>
      );

      // Apply hook modifications to system prompt
      if (agentStartResult?.systemPrompt) {
        finalSystemPrompt = agentStartResult.systemPrompt;
      }
      if (agentStartResult?.prependContext) {
        finalSystemPrompt = `${agentStartResult.prependContext}\n\n${finalSystemPrompt}`;
      }

      // =========================================================================
      // CONTEXT MANAGEMENT - Check token usage and compact if needed
      // =========================================================================
      const contextConfig: ContextConfig = {
        maxTokens: 128000,
        reserveTokens: 4096,
        compactThreshold: 0.85,
        minMessagesAfterCompact: 6,
      };
      const contextManager = createContextManager(contextConfig, memory);

      // Add all messages to context manager for tracking
      for (const msg of messages) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        contextManager.addMessage({
          role: msg.role as 'user' | 'assistant',
          content,
        });
      }

      // Add system prompt tokens
      const systemTokens = estimateTokens(finalSystemPrompt);

      // Check if we need to compact before first API call
      const guard = contextManager.checkGuard(systemTokens);
      if (guard.shouldCompact) {
        logger.info({ percentUsed: guard.percentUsed }, 'Context approaching limit, compacting');

        // Trigger compaction:before hook
        await hooks.trigger('compaction:before', {
          session,
          data: {
            sessionId: session.key,
            tokensBefore: guard.currentTokens,
            compactionCount: contextManager.getStats().compactionCount,
          },
        } as Partial<CompactionContext>);

        const compactionResult = await contextManager.compact();

        // Trigger compaction:after hook
        await hooks.trigger('compaction:after', {
          session,
          data: {
            sessionId: session.key,
            tokensBefore: compactionResult.tokensBefore,
            tokensAfter: compactionResult.tokensAfter,
            compactionCount: contextManager.getStats().compactionCount,
          },
        } as Partial<CompactionContext>);

        // Rebuild messages array from compacted context
        if (compactionResult.success) {
          const compactedMessages = contextManager.getMessagesForApi();
          messages.length = 0;
          for (const msg of compactedMessages) {
            messages.push({
              role: msg.role === 'system' ? 'user' : msg.role,
              content: msg.content,
            });
          }
          logger.info({
            removed: compactionResult.removedMessages,
            tokensSaved: compactionResult.tokensBefore - compactionResult.tokensAfter,
          }, 'Context compacted successfully');
        }
      }

      let response = await client.messages.create({
        model: modelId,
        max_tokens: 1024,
        system: finalSystemPrompt,
        tools: tools as Anthropic.Tool[],
        messages,
      });

      // Tool use loop
      while (response.stop_reason === 'tool_use') {
        const assistantContent = response.content;
        messages.push({ role: 'assistant', content: assistantContent });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of assistantContent) {
          if (block.type === 'tool_use') {
            logger.info(`Executing tool: ${block.name}`);

            // =========================================================================
            // HOOKS: tool:before_call - Can modify params or block execution
            // =========================================================================
            const toolParams = block.input as Record<string, unknown>;
            const { ctx: toolBeforeCtx, result: toolBeforeResult } = await hooks.triggerWithResult<ToolCallResult>(
              'tool:before_call',
              {
                message: processedMessage,
                session,
                data: {
                  toolName: block.name,
                  toolParams,
                },
              } as Partial<ToolHookContext>
            );

            // Check if hook blocked the tool
            if (toolBeforeResult?.block) {
              logger.warn({ tool: block.name, reason: toolBeforeResult.blockReason }, 'Tool blocked by hook');
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ error: `Tool blocked: ${toolBeforeResult.blockReason || 'Unknown reason'}` }),
              });
              continue;
            }

            // Use potentially modified params
            const finalParams = toolBeforeResult?.params || toolParams;

            const result = await executeTool(
              block.name,
              finalParams,
              context
            );

            // =========================================================================
            // HOOKS: tool:after_call - Fire-and-forget notification
            // =========================================================================
            hooks.trigger('tool:after_call', {
              message: processedMessage,
              session,
              data: {
                toolName: block.name,
                toolParams: finalParams,
                toolResult: result,
              },
            } as Partial<ToolHookContext>);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });

        // =========================================================================
        // CONTEXT CHECK - Compact if approaching limit during tool loop
        // =========================================================================
        // Track new messages in context manager
        for (const result of toolResults) {
          const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
          contextManager.addMessage({
            role: 'user',
            content,
          });
        }

        const loopGuard = contextManager.checkGuard(0);
        if (loopGuard.shouldCompact) {
          logger.info({ percentUsed: loopGuard.percentUsed }, 'Compacting context during tool loop');
          const loopCompactResult = await contextManager.compact();
          if (loopCompactResult.success) {
            const compactedMessages = contextManager.getMessagesForApi();
            messages.length = 0;
            for (const msg of compactedMessages) {
              messages.push({
                role: msg.role === 'system' ? 'user' : msg.role,
                content: msg.content,
              });
            }
          }
        }

        response = await client.messages.create({
          model: modelId,
          max_tokens: 1024,
          system: finalSystemPrompt,
          tools: tools as Anthropic.Tool[],
          messages,
        });
      }

      // Extract text response
      const textBlocks = response.content.filter(b => b.type === 'text');
      const responseText = textBlocks
        .map(b => (b as Anthropic.TextBlock).text)
        .join('\n');

      // Save assistant response to history
      if (responseText) {
        addToHistory('assistant', responseText);
      }

      // Update session
      session.context.messageCount++;
      session.updatedAt = new Date();

      const finalResponse = responseText || 'Done.';

      // =========================================================================
      // HOOKS: agent:end - Agent finished processing
      // =========================================================================
      hooks.trigger('agent:end', {
        message: processedMessage,
        session,
        data: {
          agentId: session.agentId || 'default',
          response: finalResponse,
        },
      });

      // =========================================================================
      // HOOKS: message:after - Fire-and-forget after message processing
      // =========================================================================
      hooks.trigger('message:after', {
        message: processedMessage,
        session,
        response: { text: finalResponse, platform: processedMessage.platform } as OutgoingMessage,
      });

      return finalResponse;
    } catch (error) {
      logger.error('Agent error:', error);

      // =========================================================================
      // HOOKS: error - Error occurred during processing
      // =========================================================================
      hooks.trigger('error', {
        message,  // Use original message in case processedMessage wasn't created
        session,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      return 'Sorry, I encountered an error. Please try again.';
    }
  }

  return {
    handleMessage,
    dispose() {
      // Cleanup rate limit interval
      clearInterval(rateLimitCleanupInterval);
      logger.info('Agent manager disposed');
    },
  };
}
