/**
 * AI-Powered Strategy Builder
 *
 * Convert natural language descriptions into executable swarm strategies.
 * Uses pattern matching and intent detection to build strategies without LLM.
 *
 * Examples:
 * - "Buy 1 SOL when price drops 10%, sell half at 2x"
 * - "DCA 0.5 SOL every hour for 24 hours"
 * - "Copy wallet ABC... with 2x multiplier"
 * - "Snipe any new token with PEPE in the name"
 */

import { logger } from '../utils/logger';
import { generateId } from '../utils/id';
import {
  Strategy,
  StrategyStep,
  StrategyConfig,
  StrategyType,
  StepParams,
  TriggerType,
  ActionType,
  PriceLevel,
  StrategyBuilder,
  StrategyTemplates,
} from './swarm-strategies';
import type { DexType } from './swarm-builders';
import type { ExecutionMode } from './pump-swarm';

// ============================================================================
// Types
// ============================================================================

export interface ParsedIntent {
  type: IntentType;
  confidence: number;
  params: ParsedParams;
  rawText: string;
}

export type IntentType =
  | 'buy'
  | 'sell'
  | 'dca'
  | 'copy'
  | 'snipe'
  | 'scale_in'
  | 'scale_out'
  | 'stop_loss'
  | 'take_profit'
  | 'ladder'
  | 'twap'
  | 'arbitrage'
  | 'unknown';

export interface ParsedParams {
  mint?: string;
  amount?: number;
  amountUnit?: 'sol' | 'percent' | 'tokens';
  price?: number;
  priceChange?: number; // e.g., +10%, -5%
  multiplier?: number;
  interval?: number; // ms
  count?: number;
  walletAddress?: string;
  dex?: DexType;
  executionMode?: ExecutionMode;
  slippageBps?: number;
  takeProfitPct?: number;
  stopLossPct?: number;
  levels?: number[];
  keyword?: string;
}

export interface BuildResult {
  success: boolean;
  strategy?: Strategy;
  intent?: ParsedIntent;
  error?: string;
  suggestions?: string[];
}

// ============================================================================
// Pattern Matching
// ============================================================================

// Amount patterns
const AMOUNT_PATTERNS = [
  /(\d+(?:\.\d+)?)\s*sol/i,
  /(\d+(?:\.\d+)?)\s*%/i,
  /(\d+(?:\.\d+)?)\s*tokens?/i,
];

// Time interval patterns
const TIME_PATTERNS = [
  { pattern: /(\d+)\s*(?:sec(?:ond)?s?|s)\b/i, multiplier: 1000 },
  { pattern: /(\d+)\s*(?:min(?:ute)?s?|m)\b/i, multiplier: 60000 },
  { pattern: /(\d+)\s*(?:hour?s?|h)\b/i, multiplier: 3600000 },
  { pattern: /(\d+)\s*(?:day?s?|d)\b/i, multiplier: 86400000 },
];

// Price patterns
const PRICE_PATTERNS = [
  /(?:at|@|price)\s*(\d+(?:\.\d+)?)/i,
  /(\d+(?:\.\d+)?)\s*(?:usd|usdc|\$)/i,
  /price\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)/i,
];

// Price change patterns
const PRICE_CHANGE_PATTERNS = [
  /(?:drops?|falls?|down|decreases?)\s*(\d+(?:\.\d+)?)\s*%/i,
  /(?:rises?|up|increases?|pumps?)\s*(\d+(?:\.\d+)?)\s*%/i,
  /([+-]?\d+(?:\.\d+)?)\s*%/i,
];

// Multiplier patterns
const MULTIPLIER_PATTERNS = [
  /(\d+(?:\.\d+)?)\s*x(?:\s|$)/i,
  /(\d+(?:\.\d+)?)\s*times/i,
  /multiplier\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)/i,
];

// Count patterns
const COUNT_PATTERNS = [
  /(\d+)\s*(?:times|buys?|sells?|trades?|intervals?)/i,
  /(?:for|over)\s*(\d+)\s*(?:times|rounds?)/i,
];

// Mint address pattern
const MINT_PATTERN = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// Wallet address pattern (same as mint)
const WALLET_PATTERN = /(?:wallet|address|follow|copy)\s+([1-9A-HJ-NP-Za-km-z]{32,44})/i;

// Intent keywords
const INTENT_KEYWORDS: Record<IntentType, string[]> = {
  buy: ['buy', 'purchase', 'acquire', 'get', 'ape', 'entry', 'long'],
  sell: ['sell', 'dump', 'exit', 'close', 'liquidate'],
  dca: ['dca', 'dollar cost', 'average', 'recurring', 'scheduled', 'periodic'],
  copy: ['copy', 'follow', 'mirror', 'track', 'replicate'],
  snipe: ['snipe', 'catch', 'new launch', 'new token', 'detect'],
  scale_in: ['scale in', 'average down', 'ladder in', 'accumulate'],
  scale_out: ['scale out', 'take profit', 'ladder out', 'trim'],
  stop_loss: ['stop loss', 'stop-loss', 'sl', 'limit loss', 'cut loss'],
  take_profit: ['take profit', 'take-profit', 'tp', 'profit target'],
  ladder: ['ladder', 'levels', 'tiers', 'tranches'],
  twap: ['twap', 'time weighted', 'spread over time', 'gradually'],
  arbitrage: ['arbitrage', 'arb', 'price difference', 'cross-dex'],
  unknown: [],
};

// DEX keywords
const DEX_KEYWORDS: Record<DexType, string[]> = {
  pumpfun: ['pump', 'pumpfun', 'pump.fun'],
  pumpswap: ['pumpswap', 'pump swap', 'pump amm', 'graduated'],
  bags: ['bags', 'bags.fm'],
  meteora: ['meteora', 'dlmm'],
  auto: ['auto', 'best', 'any'],
};

// Execution mode keywords
const MODE_KEYWORDS: Record<ExecutionMode, string[]> = {
  parallel: ['parallel', 'fast', 'quick', 'all at once'],
  bundle: ['bundle', 'atomic', 'together', 'jito'],
  'multi-bundle': ['multi-bundle', 'multi bundle', 'chunked'],
  sequential: ['sequential', 'stealth', 'one by one', 'slow'],
};

// ============================================================================
// AIStrategyBuilder Class
// ============================================================================

export class AIStrategyBuilder {
  /**
   * Parse natural language into a strategy
   */
  buildFromText(text: string, defaultMint?: string): BuildResult {
    try {
      // Parse intent and parameters
      const intent = this.parseIntent(text);

      // Use default mint if none found and one is provided
      if (!intent.params.mint && defaultMint) {
        intent.params.mint = defaultMint;
      }

      // Build strategy based on intent
      const strategy = this.buildStrategy(intent);

      if (strategy) {
        return {
          success: true,
          strategy,
          intent,
        };
      }

      return {
        success: false,
        intent,
        error: 'Could not build strategy from intent',
        suggestions: this.getSuggestions(intent),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Parse user text into intent
   */
  parseIntent(text: string): ParsedIntent {
    const lower = text.toLowerCase();
    const params: ParsedParams = {};

    // Detect intent type
    let intentType: IntentType = 'unknown';
    let maxKeywords = 0;

    for (const [type, keywords] of Object.entries(INTENT_KEYWORDS)) {
      const matches = keywords.filter(kw => lower.includes(kw)).length;
      if (matches > maxKeywords) {
        maxKeywords = matches;
        intentType = type as IntentType;
      }
    }

    // Extract parameters
    params.mint = this.extractMint(text);
    params.amount = this.extractAmount(text);
    params.amountUnit = this.extractAmountUnit(text);
    params.price = this.extractPrice(text);
    params.priceChange = this.extractPriceChange(text);
    params.multiplier = this.extractMultiplier(text);
    params.interval = this.extractInterval(text);
    params.count = this.extractCount(text);
    params.walletAddress = this.extractWallet(text);
    params.dex = this.extractDex(text);
    params.executionMode = this.extractExecutionMode(text);
    params.slippageBps = this.extractSlippage(text);
    params.takeProfitPct = this.extractTakeProfit(text);
    params.stopLossPct = this.extractStopLoss(text);
    params.levels = this.extractLevels(text);
    params.keyword = this.extractKeyword(text);

    // Calculate confidence
    const confidence = this.calculateConfidence(intentType, params);

    return {
      type: intentType,
      confidence,
      params,
      rawText: text,
    };
  }

  private extractMint(text: string): string | undefined {
    const matches = text.match(MINT_PATTERN);
    return matches?.[0];
  }

  private extractAmount(text: string): number | undefined {
    for (const pattern of AMOUNT_PATTERNS) {
      const match = text.match(pattern);
      if (match) return parseFloat(match[1]);
    }
    // Try plain number at start
    const plainMatch = text.match(/^(\d+(?:\.\d+)?)/);
    return plainMatch ? parseFloat(plainMatch[1]) : undefined;
  }

  private extractAmountUnit(text: string): 'sol' | 'percent' | 'tokens' | undefined {
    const lower = text.toLowerCase();
    if (lower.includes('sol')) return 'sol';
    if (lower.includes('%')) return 'percent';
    if (lower.includes('token')) return 'tokens';
    return 'sol'; // Default
  }

  private extractPrice(text: string): number | undefined {
    for (const pattern of PRICE_PATTERNS) {
      const match = text.match(pattern);
      if (match) return parseFloat(match[1]);
    }
    return undefined;
  }

  private extractPriceChange(text: string): number | undefined {
    const lower = text.toLowerCase();

    // Check for drops
    const dropMatch = lower.match(/(?:drops?|falls?|down|decreases?)\s*(\d+(?:\.\d+)?)\s*%/);
    if (dropMatch) return -parseFloat(dropMatch[1]);

    // Check for rises
    const riseMatch = lower.match(/(?:rises?|up|increases?|pumps?)\s*(\d+(?:\.\d+)?)\s*%/);
    if (riseMatch) return parseFloat(riseMatch[1]);

    // Check for explicit +/-
    const explicitMatch = lower.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
    if (explicitMatch) return parseFloat(explicitMatch[1]);

    return undefined;
  }

  private extractMultiplier(text: string): number | undefined {
    for (const pattern of MULTIPLIER_PATTERNS) {
      const match = text.match(pattern);
      if (match) return parseFloat(match[1]);
    }
    return undefined;
  }

  private extractInterval(text: string): number | undefined {
    for (const { pattern, multiplier } of TIME_PATTERNS) {
      const match = text.match(pattern);
      if (match) return parseInt(match[1], 10) * multiplier;
    }
    return undefined;
  }

  private extractCount(text: string): number | undefined {
    for (const pattern of COUNT_PATTERNS) {
      const match = text.match(pattern);
      if (match) return parseInt(match[1], 10);
    }
    return undefined;
  }

  private extractWallet(text: string): string | undefined {
    const match = text.match(WALLET_PATTERN);
    return match?.[1];
  }

  private extractDex(text: string): DexType | undefined {
    const lower = text.toLowerCase();
    for (const [dex, keywords] of Object.entries(DEX_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        return dex as DexType;
      }
    }
    return undefined;
  }

  private extractExecutionMode(text: string): ExecutionMode | undefined {
    const lower = text.toLowerCase();
    for (const [mode, keywords] of Object.entries(MODE_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        return mode as ExecutionMode;
      }
    }
    return undefined;
  }

  private extractSlippage(text: string): number | undefined {
    const match = text.match(/slippage\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)\s*%?/i);
    if (match) {
      const value = parseFloat(match[1]);
      return value > 100 ? value : value * 100; // Convert to bps if given as %
    }
    return undefined;
  }

  private extractTakeProfit(text: string): number | undefined {
    const patterns = [
      /(?:tp|take\s*profit)\s*(?:at|=|:)?\s*(\d+(?:\.\d+)?)\s*%/i,
      /sell\s*(?:at|when)?\s*(\d+(?:\.\d+)?)\s*x/i,
      /(\d+(?:\.\d+)?)\s*x\s*(?:sell|exit|tp)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const value = parseFloat(match[1]);
        // If it looks like a multiplier (2x, 3x), convert to percent
        if (value < 10 && text.includes('x')) {
          return (value - 1) * 100;
        }
        return value;
      }
    }
    return undefined;
  }

  private extractStopLoss(text: string): number | undefined {
    const patterns = [
      /(?:sl|stop\s*loss)\s*(?:at|=|:)?\s*(\d+(?:\.\d+)?)\s*%/i,
      /cut\s*(?:loss|losses)\s*(?:at|=|:)?\s*(\d+(?:\.\d+)?)\s*%/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return parseFloat(match[1]);
    }
    return undefined;
  }

  private extractLevels(text: string): number[] | undefined {
    // Look for comma-separated or "and" separated numbers
    const levelMatch = text.match(/(?:at|levels?)\s*([\d.,\s]+(?:and\s*\d+)?)/i);
    if (levelMatch) {
      const numbers = levelMatch[1].match(/\d+(?:\.\d+)?/g);
      if (numbers) return numbers.map(Number);
    }
    return undefined;
  }

  private extractKeyword(text: string): string | undefined {
    // Look for quoted strings or "with X in name"
    const quotedMatch = text.match(/["']([^"']+)["']/);
    if (quotedMatch) return quotedMatch[1];

    const nameMatch = text.match(/(?:name|symbol|ticker)\s*(?:contains?|includes?|with)?\s*["']?(\w+)["']?/i);
    if (nameMatch) return nameMatch[1];

    return undefined;
  }

  private calculateConfidence(intent: IntentType, params: ParsedParams): number {
    if (intent === 'unknown') return 0;

    let confidence = 0.3; // Base confidence for matching intent

    // Add confidence for each extracted parameter
    if (params.mint) confidence += 0.2;
    if (params.amount !== undefined) confidence += 0.15;
    if (params.interval !== undefined) confidence += 0.1;
    if (params.count !== undefined) confidence += 0.1;
    if (params.priceChange !== undefined) confidence += 0.1;
    if (params.walletAddress) confidence += 0.15;
    if (params.dex) confidence += 0.05;
    if (params.executionMode) confidence += 0.05;

    return Math.min(confidence, 1.0);
  }

  /**
   * Build strategy from parsed intent
   */
  private buildStrategy(intent: ParsedIntent): Strategy | null {
    const { type, params } = intent;

    switch (type) {
      case 'buy':
        return this.buildBuyStrategy(params);
      case 'sell':
        return this.buildSellStrategy(params);
      case 'dca':
        return this.buildDCAStrategy(params);
      case 'scale_in':
        return this.buildScaleInStrategy(params);
      case 'scale_out':
        return this.buildScaleOutStrategy(params);
      case 'snipe':
        return this.buildSnipeStrategy(params);
      case 'ladder':
        return this.buildLadderStrategy(params);
      case 'twap':
        return this.buildTWAPStrategy(params);
      case 'stop_loss':
        return this.buildStopLossStrategy(params);
      case 'take_profit':
        return this.buildTakeProfitStrategy(params);
      default:
        return null;
    }
  }

  private buildBuyStrategy(params: ParsedParams): Strategy | null {
    if (!params.mint) return null;

    const amount = params.amount ?? 0.1;
    const builder = new StrategyBuilder('Buy Strategy', params.mint)
      .type('custom')
      .maxSlippage(params.slippageBps ?? 500);

    if (params.price && params.priceChange && params.priceChange < 0) {
      builder.buyAt(params.price, amount, {
        executionMode: params.executionMode || 'parallel',
        dex: params.dex,
      });
    } else {
      builder.buyNow(amount, {
        executionMode: params.executionMode || 'parallel',
        dex: params.dex,
      });
    }

    // Add take profit if specified
    if (params.takeProfitPct && params.price) {
      const tpPrice = params.price * (1 + params.takeProfitPct / 100);
      builder.sellPercentAt(tpPrice, 100, { dex: params.dex });
    }

    return builder.build();
  }

  private buildSellStrategy(params: ParsedParams): Strategy | null {
    if (!params.mint) return null;

    const amount = params.amountUnit === 'percent'
      ? `${params.amount ?? 100}%`
      : (params.amount ?? 0);

    const builder = new StrategyBuilder('Sell Strategy', params.mint)
      .type('custom')
      .maxSlippage(params.slippageBps ?? 500);

    if (params.price && params.priceChange && params.priceChange > 0) {
      builder.sellAt(params.price, amount, {
        executionMode: params.executionMode || 'parallel',
        dex: params.dex,
      });
    } else {
      builder.sellNow(amount, {
        executionMode: params.executionMode || 'parallel',
        dex: params.dex,
      });
    }

    return builder.build();
  }

  private buildDCAStrategy(params: ParsedParams): Strategy | null {
    if (!params.mint) return null;

    const amount = params.amount ?? 0.1;
    const count = params.count ?? 10;
    const interval = params.interval ?? 3600000; // Default 1 hour

    return StrategyTemplates.dca(params.mint, amount, count, interval);
  }

  private buildScaleInStrategy(params: ParsedParams): Strategy | null {
    if (!params.mint) return null;

    const totalSol = params.amount ?? 1;
    const currentPrice = params.price ?? 1; // Need current price
    const levels: PriceLevel[] = params.levels
      ? params.levels.map((price, i, arr) => ({
          price,
          percent: 100 / arr.length,
        }))
      : [
          { price: 100, percent: 33 }, // Buy now
          { price: 90, percent: 33 },  // Buy at -10%
          { price: 80, percent: 34 },  // Buy at -20%
        ];

    return StrategyTemplates.scaleIn(params.mint, totalSol, levels, currentPrice);
  }

  private buildScaleOutStrategy(params: ParsedParams): Strategy | null {
    if (!params.mint) return null;

    const currentPrice = params.price ?? 1;
    const levels: PriceLevel[] = params.levels
      ? params.levels.map((price, i, arr) => ({
          price,
          percent: 100 / arr.length,
        }))
      : [
          { price: 50, percent: 33 },  // Sell at +50%
          { price: 100, percent: 33 }, // Sell at +100%
          { price: 200, percent: 34 }, // Sell at +200%
        ];

    return StrategyTemplates.scaleOut(params.mint, levels, currentPrice);
  }

  private buildSnipeStrategy(params: ParsedParams): Strategy | null {
    if (!params.mint) return null;

    const sol = params.amount ?? 0.5;
    const tp = params.takeProfitPct ?? 100;
    const sl = params.stopLossPct ?? 20;
    const currentPrice = params.price ?? 1;

    return StrategyTemplates.snipeExit(params.mint, sol, tp, sl, currentPrice);
  }

  private buildLadderStrategy(params: ParsedParams): Strategy | null {
    if (!params.mint) return null;

    const totalSol = params.amount ?? 1;
    const levels = params.count ?? 5;
    const dropPercent = Math.abs(params.priceChange ?? 5);
    const currentPrice = params.price ?? 1;

    return StrategyTemplates.ladderBuy(params.mint, totalSol, levels, dropPercent, currentPrice);
  }

  private buildTWAPStrategy(params: ParsedParams): Strategy | null {
    if (!params.mint) return null;

    const amount = params.amount ?? 1;
    const intervals = params.count ?? 10;
    const delayMs = params.interval ?? 60000;

    return StrategyTemplates.twap(params.mint, 'buy', amount, intervals, delayMs);
  }

  private buildStopLossStrategy(params: ParsedParams): Strategy | null {
    if (!params.mint) return null;

    const stopPct = params.stopLossPct ?? 10;
    const currentPrice = params.price ?? 1;
    const slPrice = currentPrice * (1 - stopPct / 100);

    const builder = new StrategyBuilder('Stop Loss', params.mint)
      .type('custom')
      .describe(`Stop loss at -${stopPct}%`)
      .stopLoss(stopPct)
      .maxSlippage(1000); // Higher slippage for SL

    builder.sellPercentAt(slPrice, 100, { dex: params.dex });

    return builder.build();
  }

  private buildTakeProfitStrategy(params: ParsedParams): Strategy | null {
    if (!params.mint) return null;

    const takeProfitPct = params.takeProfitPct ?? 50;
    const currentPrice = params.price ?? 1;
    const tpPrice = currentPrice * (1 + takeProfitPct / 100);

    const builder = new StrategyBuilder('Take Profit', params.mint)
      .type('custom')
      .describe(`Take profit at +${takeProfitPct}%`)
      .takeProfit(takeProfitPct)
      .maxSlippage(500);

    builder.sellPercentAt(tpPrice, 50, { dex: params.dex }); // Sell half at TP

    return builder.build();
  }

  /**
   * Get suggestions for failed parses
   */
  private getSuggestions(intent: ParsedIntent): string[] {
    const suggestions: string[] = [];

    if (!intent.params.mint) {
      suggestions.push('Include a token mint address (e.g., "buy ABC123...")')
    }

    if (intent.params.amount === undefined) {
      suggestions.push('Specify an amount (e.g., "0.5 SOL" or "50%")');
    }

    if (intent.type === 'unknown') {
      suggestions.push(
        'Try starting with: buy, sell, dca, copy, snipe, ladder, or scale in/out'
      );
    }

    if (intent.type === 'dca' && !intent.params.interval) {
      suggestions.push('Specify an interval (e.g., "every 1h" or "every 30m")');
    }

    if (intent.type === 'copy' && !intent.params.walletAddress) {
      suggestions.push('Include wallet address to copy (e.g., "copy ABC123...")');
    }

    return suggestions;
  }

  /**
   * Get example prompts for users
   */
  getExamples(): string[] {
    return [
      'Buy 0.5 SOL of ABC123... when price drops 10%',
      'DCA 0.1 SOL every 1h for 24 times into XYZ...',
      'Scale in with 2 SOL over 5 price levels',
      'Sell 50% at 2x, rest at 3x',
      'Set stop loss at 20% for token DEF...',
      'Snipe new tokens with PEPE in name, 0.5 SOL each',
      'Copy wallet 7xKX... with 0.5x multiplier',
      'TWAP buy 1 SOL over 10 intervals, 5 min apart',
      'Ladder buy with 1 SOL, 5 levels, 5% drop each',
    ];
  }
}

// ============================================================================
// Factory
// ============================================================================

let aiBuilderInstance: AIStrategyBuilder | null = null;

export function getAIStrategyBuilder(): AIStrategyBuilder {
  if (!aiBuilderInstance) {
    aiBuilderInstance = new AIStrategyBuilder();
  }
  return aiBuilderInstance;
}
