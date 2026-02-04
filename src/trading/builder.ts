/**
 * Strategy Builder - Create trading bots through chat
 *
 * Features:
 * - Natural language strategy definition
 * - Template-based strategy creation
 * - Parameter validation
 * - Dry-run requirement before live trading
 */

import { Database } from '../db/index';
import { logger } from '../utils/logger';
import type { Platform } from '../types';
import type { Strategy, StrategyConfig, Signal, StrategyContext } from './bots/index';

// =============================================================================
// TYPES
// =============================================================================

export type StrategyTemplate =
  | 'mean_reversion'
  | 'momentum'
  | 'arbitrage'
  | 'price_threshold'
  | 'volume_spike'
  | 'market_making'
  | 'custom';

export interface StrategyDefinition {
  /** User-provided name */
  name: string;
  /** Description */
  description?: string;
  /** Template to use */
  template: StrategyTemplate;
  /** Platforms to trade on */
  platforms: Platform[];
  /** Markets to watch (can be keywords or IDs) */
  markets?: string[];
  /** Entry conditions */
  entry: EntryCondition[];
  /** Exit conditions */
  exit: ExitCondition[];
  /** Risk parameters */
  risk: RiskParams;
  /** Evaluation interval */
  intervalMs?: number;
  /** Start in dry-run mode */
  dryRun?: boolean;
}

export interface EntryCondition {
  type: 'price_below' | 'price_above' | 'price_change' | 'volume_above' | 'spread_above' | 'custom';
  value: number;
  /** For price_change: lookback period in seconds */
  lookbackSec?: number;
  /** Custom condition code (for advanced users) */
  customCode?: string;
}

export interface ExitCondition {
  type: 'take_profit' | 'stop_loss' | 'time_limit' | 'price_target' | 'trailing_stop' | 'custom';
  value: number;
  /** For time_limit: seconds to hold */
  holdSec?: number;
  /** Custom condition code */
  customCode?: string;
}

export interface RiskParams {
  /** Max position size in USD */
  maxPositionSize: number;
  /** Max total exposure in USD */
  maxExposure?: number;
  /** Max percentage of portfolio per trade */
  maxPortfolioPct?: number;
  /** Stop loss percentage */
  stopLossPct: number;
  /** Take profit percentage */
  takeProfitPct: number;
  /** Max trades per day */
  maxTradesPerDay?: number;
  /** Cooldown between trades in seconds */
  cooldownSec?: number;
}

export interface StrategyBuilder {
  /** Parse natural language into strategy definition */
  parseNaturalLanguage(text: string): StrategyDefinition | { error: string };

  /** Create strategy from definition */
  createStrategy(definition: StrategyDefinition): Strategy;

  /** Validate a strategy definition */
  validate(definition: StrategyDefinition): { valid: boolean; errors: string[] };

  /** List available templates */
  listTemplates(): Array<{ name: StrategyTemplate; description: string }>;

  /** Get template parameters */
  getTemplateParams(template: StrategyTemplate): Record<string, { type: string; default: unknown; description: string }>;

  /** Save strategy definition to DB */
  saveDefinition(userId: string, definition: StrategyDefinition): string;

  /** Load strategy definitions for user */
  loadDefinitions(userId: string): Array<{ id: string; definition: StrategyDefinition; createdAt: Date }>;

  /** Delete a saved definition */
  deleteDefinition(userId: string, definitionId: string): boolean;
}

// =============================================================================
// TEMPLATES
// =============================================================================

const TEMPLATES: Record<StrategyTemplate, { description: string; defaultParams: Partial<StrategyDefinition> }> = {
  mean_reversion: {
    description: 'Buy when price drops significantly below average, sell when it recovers',
    defaultParams: {
      entry: [{ type: 'price_change', value: -0.05, lookbackSec: 300 }],
      exit: [{ type: 'take_profit', value: 0.1 }, { type: 'stop_loss', value: 0.05 }],
      risk: { maxPositionSize: 100, stopLossPct: 5, takeProfitPct: 10 },
      intervalMs: 60000,
    },
  },
  momentum: {
    description: 'Follow price trends - buy rising markets, sell when momentum fades',
    defaultParams: {
      entry: [{ type: 'price_change', value: 0.03, lookbackSec: 600 }],
      exit: [{ type: 'trailing_stop', value: 0.05 }, { type: 'take_profit', value: 0.2 }],
      risk: { maxPositionSize: 100, stopLossPct: 8, takeProfitPct: 20 },
      intervalMs: 60000,
    },
  },
  arbitrage: {
    description: 'Exploit price differences across platforms for the same event',
    defaultParams: {
      entry: [{ type: 'spread_above', value: 0.03 }],
      exit: [{ type: 'price_target', value: 0 }],
      risk: { maxPositionSize: 500, stopLossPct: 2, takeProfitPct: 3 },
      intervalMs: 10000,
    },
  },
  price_threshold: {
    description: 'Buy when price falls below threshold, sell when above',
    defaultParams: {
      entry: [{ type: 'price_below', value: 0.3 }],
      exit: [{ type: 'price_target', value: 0.6 }, { type: 'stop_loss', value: 0.1 }],
      risk: { maxPositionSize: 100, stopLossPct: 10, takeProfitPct: 30 },
      intervalMs: 300000,
    },
  },
  volume_spike: {
    description: 'Trade on unusual volume activity',
    defaultParams: {
      entry: [{ type: 'volume_above', value: 2.0 }],
      exit: [{ type: 'time_limit', value: 3600, holdSec: 3600 }],
      risk: { maxPositionSize: 100, stopLossPct: 5, takeProfitPct: 15 },
      intervalMs: 60000,
    },
  },
  market_making: {
    description: 'Two-sided quoting with inventory management and spread optimization',
    defaultParams: {
      entry: [{ type: 'custom', value: 0, customCode: 'market_making' }],
      exit: [{ type: 'stop_loss', value: 0.1 }, { type: 'take_profit', value: 0.05 }],
      risk: { maxPositionSize: 500, stopLossPct: 10, takeProfitPct: 5, maxTradesPerDay: 1000 },
      intervalMs: 5000,
    },
  },
  custom: {
    description: 'Define your own entry/exit conditions',
    defaultParams: {
      entry: [],
      exit: [{ type: 'stop_loss', value: 0.1 }, { type: 'take_profit', value: 0.2 }],
      risk: { maxPositionSize: 100, stopLossPct: 10, takeProfitPct: 20 },
      intervalMs: 60000,
    },
  },
};

// =============================================================================
// NATURAL LANGUAGE PARSER
// =============================================================================

function parseNaturalLanguageImpl(text: string): StrategyDefinition | { error: string } {
  const lower = text.toLowerCase();

  // Detect template
  let template: StrategyTemplate = 'custom';
  if (lower.includes('mean reversion') || lower.includes('buy the dip')) {
    template = 'mean_reversion';
  } else if (lower.includes('momentum') || lower.includes('follow trend')) {
    template = 'momentum';
  } else if (lower.includes('arbitrage') || lower.includes('cross platform')) {
    template = 'arbitrage';
  } else if (lower.includes('threshold') || lower.includes('when price')) {
    template = 'price_threshold';
  } else if (lower.includes('volume')) {
    template = 'volume_spike';
  }

  // Extract platforms
  const platforms: Platform[] = [];
  if (lower.includes('polymarket')) platforms.push('polymarket');
  if (lower.includes('kalshi')) platforms.push('kalshi');
  if (lower.includes('manifold')) platforms.push('manifold');
  if (lower.includes('betfair')) platforms.push('betfair');
  if (lower.includes('drift')) platforms.push('drift');
  if (platforms.length === 0) platforms.push('polymarket');

  // Extract numbers
  const percentMatch = lower.match(/(\d+(?:\.\d+)?)\s*%/g);
  const dollarMatch = lower.match(/\$\s*(\d+(?:\.\d+)?)/g);

  // Extract entry conditions
  const entry: EntryCondition[] = [];
  if (lower.includes('below') && percentMatch) {
    const value = parseFloat(percentMatch[0]) / 100;
    entry.push({ type: 'price_below', value });
  }
  if (lower.includes('above') && percentMatch) {
    const value = parseFloat(percentMatch[0]) / 100;
    entry.push({ type: 'price_above', value });
  }
  if (lower.includes('drop') || lower.includes('fall')) {
    const value = percentMatch ? parseFloat(percentMatch[0]) / 100 : 0.05;
    entry.push({ type: 'price_change', value: -value, lookbackSec: 300 });
  }
  if (lower.includes('rise') || lower.includes('gain')) {
    const value = percentMatch ? parseFloat(percentMatch[0]) / 100 : 0.05;
    entry.push({ type: 'price_change', value, lookbackSec: 300 });
  }

  // Extract exit conditions
  const exit: ExitCondition[] = [];
  const tpMatch = lower.match(/take\s*profit\s*(\d+(?:\.\d+)?)\s*%?/);
  const slMatch = lower.match(/stop\s*loss\s*(\d+(?:\.\d+)?)\s*%?/);

  if (tpMatch) {
    exit.push({ type: 'take_profit', value: parseFloat(tpMatch[1]) / 100 });
  }
  if (slMatch) {
    exit.push({ type: 'stop_loss', value: parseFloat(slMatch[1]) / 100 });
  }

  // Extract risk params
  const maxPosition = dollarMatch ? parseFloat(dollarMatch[0].replace('$', '')) : 100;

  // Use template defaults if we couldn't parse
  const defaults = TEMPLATES[template].defaultParams;

  const definition: StrategyDefinition = {
    name: `${template.replace('_', ' ')} strategy`,
    description: `Auto-generated from: "${text.slice(0, 100)}"`,
    template,
    platforms,
    entry: entry.length > 0 ? entry : (defaults.entry || []),
    exit: exit.length > 0 ? exit : (defaults.exit || []),
    risk: {
      maxPositionSize: maxPosition,
      stopLossPct: slMatch ? parseFloat(slMatch[1]) : (defaults.risk?.stopLossPct || 10),
      takeProfitPct: tpMatch ? parseFloat(tpMatch[1]) : (defaults.risk?.takeProfitPct || 20),
    },
    intervalMs: defaults.intervalMs || 60000,
    dryRun: true, // Always start in dry-run
  };

  return definition;
}

// =============================================================================
// STRATEGY GENERATOR
// =============================================================================

function createStrategyFromDefinition(definition: StrategyDefinition): Strategy {
  const config: StrategyConfig = {
    id: `user_${Date.now().toString(36)}`,
    name: definition.name,
    description: definition.description,
    platforms: definition.platforms,
    intervalMs: definition.intervalMs,
    maxPositionSize: definition.risk.maxPositionSize,
    maxExposure: definition.risk.maxExposure,
    stopLossPct: definition.risk.stopLossPct,
    takeProfitPct: definition.risk.takeProfitPct,
    enabled: true,
    dryRun: definition.dryRun !== false,
    params: {
      entry: definition.entry,
      exit: definition.exit,
      risk: definition.risk,
    },
  };

  // Track state
  const priceHistory = new Map<string, number[]>();
  let lastTradeTime = 0;
  let tradesToday = 0;
  let lastDayCheck = new Date().toDateString();

  return {
    config,

    async evaluate(ctx: StrategyContext): Promise<Signal[]> {
      const signals: Signal[] = [];
      const params = config.params as any;

      // Reset daily counter
      const today = new Date().toDateString();
      if (today !== lastDayCheck) {
        tradesToday = 0;
        lastDayCheck = today;
      }

      // Check cooldown
      const cooldownMs = (params.risk.cooldownSec || 60) * 1000;
      if (Date.now() - lastTradeTime < cooldownMs) {
        return signals;
      }

      // Check max trades per day
      if (params.risk.maxTradesPerDay && tradesToday >= params.risk.maxTradesPerDay) {
        return signals;
      }

      // Evaluate each position
      for (const [key, position] of ctx.positions) {
        const [platform, marketId, outcome] = key.split(':');
        const history = priceHistory.get(key) || [];

        // Update price history
        history.push(position.currentPrice);
        if (history.length > 100) history.shift();
        priceHistory.set(key, history);

        // Check entry conditions (when not in position)
        if (position.shares === 0) {
          let shouldEnter = true;

          for (const condition of params.entry) {
            switch (condition.type) {
              case 'price_below':
                if (position.currentPrice >= condition.value) shouldEnter = false;
                break;
              case 'price_above':
                if (position.currentPrice <= condition.value) shouldEnter = false;
                break;
              case 'price_change': {
                const lookbackPrices = history.slice(-Math.ceil((condition.lookbackSec || 300) / 60));
                if (lookbackPrices.length < 2) {
                  shouldEnter = false;
                  break;
                }
                const startPrice = lookbackPrices[0];
                const change = (position.currentPrice - startPrice) / startPrice;
                if (condition.value < 0) {
                  // Looking for drops
                  if (change > condition.value) shouldEnter = false;
                } else {
                  // Looking for rises
                  if (change < condition.value) shouldEnter = false;
                }
                break;
              }
              case 'volume_above':
                // Would need volume data
                break;
              case 'spread_above':
                // Would need cross-platform comparison
                break;
            }
          }

          if (shouldEnter && params.entry.length > 0) {
            signals.push({
              type: 'buy',
              platform: platform as Platform,
              marketId,
              outcome,
              price: position.currentPrice,
              sizePct: params.risk.maxPortfolioPct || 5,
              reason: `Entry conditions met`,
            });
            lastTradeTime = Date.now();
            tradesToday++;
          }
        }

        // Check exit conditions (when in position)
        if (position.shares > 0) {
          const pnlPct = ((position.currentPrice - position.avgPrice) / position.avgPrice) * 100;
          let shouldExit = false;
          let exitReason = '';

          for (const condition of params.exit) {
            switch (condition.type) {
              case 'stop_loss':
                if (pnlPct <= -(condition.value * 100)) {
                  shouldExit = true;
                  exitReason = `Stop loss triggered (${pnlPct.toFixed(1)}%)`;
                }
                break;
              case 'take_profit':
                if (pnlPct >= condition.value * 100) {
                  shouldExit = true;
                  exitReason = `Take profit triggered (${pnlPct.toFixed(1)}%)`;
                }
                break;
              case 'price_target':
                if (position.currentPrice >= condition.value) {
                  shouldExit = true;
                  exitReason = `Price target reached`;
                }
                break;
              case 'trailing_stop': {
                const maxPrice = Math.max(...history.slice(-20));
                const dropFromMax = (maxPrice - position.currentPrice) / maxPrice;
                if (dropFromMax >= condition.value) {
                  shouldExit = true;
                  exitReason = `Trailing stop triggered (${(dropFromMax * 100).toFixed(1)}% from peak)`;
                }
                break;
              }
              case 'time_limit': {
                // Would need entry time tracking
                break;
              }
            }
          }

          if (shouldExit) {
            signals.push({
              type: 'sell',
              platform: platform as Platform,
              marketId,
              outcome,
              size: position.shares,
              reason: exitReason,
            });
          }
        }
      }

      return signals;
    },
  };
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createStrategyBuilder(db: Database): StrategyBuilder {
  // Initialize table
  db.run(`
    CREATE TABLE IF NOT EXISTS user_strategies (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      definition_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_user_strategies_user ON user_strategies(user_id)`);

  function validate(definition: StrategyDefinition): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!definition.name || definition.name.length < 2) {
      errors.push('Name must be at least 2 characters');
    }

    if (!definition.platforms || definition.platforms.length === 0) {
      errors.push('At least one platform is required');
    }

    if (!definition.entry || definition.entry.length === 0) {
      errors.push('At least one entry condition is required');
    }

    if (!definition.exit || definition.exit.length === 0) {
      errors.push('At least one exit condition is required');
    }

    if (!definition.risk) {
      errors.push('Risk parameters are required');
    } else {
      if (definition.risk.maxPositionSize <= 0) {
        errors.push('maxPositionSize must be positive');
      }
      if (definition.risk.stopLossPct < 0 || definition.risk.stopLossPct > 100) {
        errors.push('stopLossPct must be between 0 and 100');
      }
      if (definition.risk.takeProfitPct < 0 || definition.risk.takeProfitPct > 1000) {
        errors.push('takeProfitPct must be between 0 and 1000');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  return {
    parseNaturalLanguage: parseNaturalLanguageImpl,

    createStrategy: createStrategyFromDefinition,

    validate,

    listTemplates() {
      return Object.entries(TEMPLATES).map(([name, { description }]) => ({
        name: name as StrategyTemplate,
        description,
      }));
    },

    getTemplateParams(template): Record<string, { type: string; default: unknown; description: string }> {
      const tmpl = TEMPLATES[template];
      if (!tmpl) return {};

      return {
        entry: { type: 'array', default: tmpl.defaultParams.entry, description: 'Entry conditions' },
        exit: { type: 'array', default: tmpl.defaultParams.exit, description: 'Exit conditions' },
        risk: { type: 'object', default: tmpl.defaultParams.risk, description: 'Risk parameters' },
        intervalMs: { type: 'number', default: tmpl.defaultParams.intervalMs, description: 'Check interval in ms' },
      };
    },

    saveDefinition(userId, definition) {
      const id = `strat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const now = new Date().toISOString();

      db.run(
        `INSERT INTO user_strategies (id, user_id, definition_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, userId, JSON.stringify(definition), now, now]
      );

      logger.info({ userId, strategyId: id, name: definition.name }, 'User strategy saved');
      return id;
    },

    loadDefinitions(userId) {
      const rows = db.query<any>(
        `SELECT * FROM user_strategies WHERE user_id = ? ORDER BY created_at DESC`,
        [userId]
      );

      return rows.map((row) => ({
        id: row.id,
        definition: JSON.parse(row.definition_json) as StrategyDefinition,
        createdAt: new Date(row.created_at),
      }));
    },

    deleteDefinition(userId, definitionId) {
      // Check if definition exists before deleting
      const existing = db.query<any>(
        `SELECT id FROM user_strategies WHERE id = ? AND user_id = ?`,
        [definitionId, userId]
      );

      if (existing.length === 0) {
        return false;
      }

      db.run(
        `DELETE FROM user_strategies WHERE id = ? AND user_id = ?`,
        [definitionId, userId]
      );

      return true;
    },
  };
}
