/**
 * Tool Definitions for Claude API
 * Phase 1: Read-only market data tools
 */

import type Anthropic from '@anthropic-ai/sdk';

type ToolDefinition = Anthropic.Tool;

export const TOOLS: ToolDefinition[] = [
  // Market tools
  {
    name: 'search_markets',
    description:
      'Search prediction markets by keyword across platforms. Returns top results with current prices.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "Trump 2028", "Fed rate cut", "Bitcoin 100k")',
        },
        platform: {
          type: 'string',
          description: 'Optional: filter to specific platform',
          enum: ['polymarket', 'kalshi', 'manifold'],
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_market',
    description: 'Get detailed info about a specific market including all outcomes and prices',
    input_schema: {
      type: 'object' as const,
      properties: {
        market_id: {
          type: 'string',
          description: 'The market ID or slug',
        },
        platform: {
          type: 'string',
          description: 'The platform',
          enum: ['polymarket', 'kalshi', 'manifold'],
        },
      },
      required: ['market_id', 'platform'],
    },
  },
  {
    name: 'get_price',
    description: 'Get the current price for a specific market outcome',
    input_schema: {
      type: 'object' as const,
      properties: {
        market_id: {
          type: 'string',
          description: 'The market ID or token ID',
        },
        platform: {
          type: 'string',
          description: 'The platform',
          enum: ['polymarket', 'kalshi', 'manifold'],
        },
      },
      required: ['market_id', 'platform'],
    },
  },
  {
    name: 'compare_prices',
    description: 'Compare prices for the same event across multiple platforms',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find matching markets',
        },
      },
      required: ['query'],
    },
  },

  // Arbitrage tools
  {
    name: 'find_arbitrage',
    description:
      'Find arbitrage opportunities where YES + NO prices sum to < 1 or cross-platform price discrepancies',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Optional search query to narrow markets',
        },
        min_edge: {
          type: 'number',
          description: 'Minimum edge % to report (default 1%)',
        },
        limit: {
          type: 'number',
          description: 'Max opportunities to return (default 10)',
        },
        platforms: {
          type: 'array',
          description: 'Platforms to scan',
          items: { type: 'string', enum: ['polymarket', 'kalshi', 'manifold'] },
        },
      },
    },
  },

  // Portfolio tools (read-only)
  {
    name: 'get_portfolio',
    description: "Get user's portfolio: all manually tracked positions",
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // Alert tools
  {
    name: 'create_alert',
    description: 'Create a price alert for a market',
    input_schema: {
      type: 'object' as const,
      properties: {
        market_id: {
          type: 'string',
          description: 'Market ID',
        },
        platform: {
          type: 'string',
          description: 'Platform',
          enum: ['polymarket', 'kalshi', 'manifold'],
        },
        market_name: {
          type: 'string',
          description: 'Market name (for display)',
        },
        condition_type: {
          type: 'string',
          description: 'Alert condition',
          enum: ['price_above', 'price_below', 'price_change_pct'],
        },
        threshold: {
          type: 'number',
          description: 'Threshold (0.0-1.0 for price, percentage for change)',
        },
      },
      required: ['market_id', 'platform', 'condition_type', 'threshold'],
    },
  },
  {
    name: 'list_alerts',
    description: 'List all active alerts for the user',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'delete_alert',
    description: 'Delete an alert',
    input_schema: {
      type: 'object' as const,
      properties: {
        alert_id: {
          type: 'string',
          description: 'Alert ID to delete',
        },
      },
      required: ['alert_id'],
    },
  },

  // Analysis tools
  {
    name: 'calculate_kelly',
    description: 'Calculate Kelly criterion bet sizing given edge estimate',
    input_schema: {
      type: 'object' as const,
      properties: {
        market_price: {
          type: 'number',
          description: 'Current market price (0.0-1.0)',
        },
        estimated_probability: {
          type: 'number',
          description: 'Your estimated true probability (0.0-1.0)',
        },
        bankroll: {
          type: 'number',
          description: 'Available bankroll in dollars',
        },
      },
      required: ['market_price', 'estimated_probability', 'bankroll'],
    },
  },
];

export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}
