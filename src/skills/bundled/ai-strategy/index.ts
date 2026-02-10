/**
 * AI Strategy Skill - Natural language to trades
 *
 * Commands:
 * /strategy "<description>"      Create strategy from natural language
 * /strategies                    List active strategies
 * /strategy status <id>          Check strategy status
 * /strategy cancel <id>          Cancel strategy
 * /strategy templates            List templates
 * /strategy template <name>      Use template
 * /execute <action>              Execute immediately
 */

import { logger } from '../../../utils/logger';
import { generateId } from '../../../utils/id';

// ============================================================================
// Types
// ============================================================================

interface ParsedStrategy {
  id: string;
  originalText: string;
  action: 'buy' | 'sell' | 'dca' | 'stop_loss' | 'take_profit' | 'ladder';
  asset: {
    symbol?: string;
    mint?: string;
  };
  amount: {
    value: number;
    unit: 'sol' | 'usd' | 'percent' | 'tokens';
  };
  condition?: {
    type: 'price_above' | 'price_below' | 'price_change' | 'immediate';
    value: number;
    unit?: 'usd' | 'percent';
  };
  schedule?: {
    interval: number;     // ms
    count: number;
    executed: number;
  };
  status: 'pending' | 'active' | 'monitoring' | 'completed' | 'cancelled' | 'failed';
  platform: 'solana';
  createdAt: number;
  lastCheckAt?: number;
  executedAt?: number;
  result?: {
    success: boolean;
    signature?: string;
    error?: string;
  };
}

// Storage
const strategies: Map<string, ParsedStrategy> = new Map();
let monitorInterval: NodeJS.Timeout | null = null;

// Patterns for parsing
const AMOUNT_PATTERNS = {
  sol: /(\d+(?:\.\d+)?)\s*sol\b/i,
  usd: /\$(\d+(?:\.\d+)?)/i,
  percent: /(\d+(?:\.\d+)?)\s*%/i,
  tokens: /(\d+(?:\.\d+)?)\s*tokens?\b/i,
};

const PRICE_PATTERNS = {
  drops: /(?:drops?|falls?|down|decreases?)\s*(\d+(?:\.\d+)?)\s*%/i,
  rises: /(?:rises?|up|increases?|pumps?|hits?)\s*(\d+(?:\.\d+)?)\s*%/i,
  at_price: /(?:at|@|price)\s*\$?(\d+(?:\.\d+)?)/i,
};

const TIME_PATTERNS = {
  seconds: { pattern: /(\d+)\s*(?:sec(?:ond)?s?|s)\b/i, mult: 1000 },
  minutes: { pattern: /(\d+)\s*(?:min(?:ute)?s?|m)\b/i, mult: 60000 },
  hours: { pattern: /(\d+)\s*(?:hour?s?|h)\b/i, mult: 3600000 },
  days: { pattern: /(\d+)\s*(?:day?s?|d)\b/i, mult: 86400000 },
};

const MINT_PATTERN = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// Common token symbols
const TOKEN_SYMBOLS: Record<string, string> = {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'JUP': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'WIF': 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'PYTH': 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
};

// ============================================================================
// Parsing
// ============================================================================

function parseStrategy(text: string): Partial<ParsedStrategy> {
  const lower = text.toLowerCase();
  const result: Partial<ParsedStrategy> = {
    originalText: text,
    platform: 'solana',
  };

  // Detect action
  if (lower.includes('dca') || lower.includes('dollar cost') || lower.includes('every')) {
    result.action = 'dca';
  } else if (lower.includes('stop loss') || lower.includes('stop-loss') || lower.includes('sl ')) {
    result.action = 'stop_loss';
  } else if (lower.includes('take profit') || lower.includes('take-profit') || lower.includes('tp ') || /sell.*at.*\d+x/i.test(lower)) {
    result.action = 'take_profit';
  } else if (lower.includes('ladder') || lower.includes('scale')) {
    result.action = 'ladder';
  } else if (lower.includes('sell') || lower.includes('exit') || lower.includes('close')) {
    result.action = 'sell';
  } else if (lower.includes('buy') || lower.includes('ape') || lower.includes('get') || lower.includes('acquire')) {
    result.action = 'buy';
  }

  // Extract amount
  for (const [unit, pattern] of Object.entries(AMOUNT_PATTERNS)) {
    const match = text.match(pattern);
    if (match) {
      result.amount = {
        value: parseFloat(match[1]),
        unit: unit as 'sol' | 'usd' | 'percent' | 'tokens',
      };
      break;
    }
  }

  // Extract asset
  const mintMatch = text.match(MINT_PATTERN);
  if (mintMatch) {
    result.asset = { mint: mintMatch[0] };
  } else {
    // Try to find token symbol
    for (const [symbol, mint] of Object.entries(TOKEN_SYMBOLS)) {
      if (lower.includes(symbol.toLowerCase())) {
        result.asset = { symbol, mint };
        break;
      }
    }
  }

  // Extract condition
  const dropsMatch = text.match(PRICE_PATTERNS.drops);
  if (dropsMatch) {
    result.condition = {
      type: 'price_change',
      value: -parseFloat(dropsMatch[1]),
      unit: 'percent',
    };
  }

  const risesMatch = text.match(PRICE_PATTERNS.rises);
  if (risesMatch) {
    result.condition = {
      type: 'price_change',
      value: parseFloat(risesMatch[1]),
      unit: 'percent',
    };
  }

  const priceMatch = text.match(PRICE_PATTERNS.at_price);
  if (priceMatch && !dropsMatch && !risesMatch) {
    result.condition = {
      type: lower.includes('below') ? 'price_below' : 'price_above',
      value: parseFloat(priceMatch[1]),
      unit: 'usd',
    };
  }

  // Extract schedule for DCA
  if (result.action === 'dca') {
    let intervalMs = 3600000; // Default 1 hour

    for (const [, { pattern, mult }] of Object.entries(TIME_PATTERNS)) {
      const match = text.match(pattern);
      if (match) {
        intervalMs = parseInt(match[1]) * mult;
        break;
      }
    }

    let count = 10; // Default
    const countMatch = text.match(/(\d+)\s*(?:times|iterations|rounds)/i);
    if (countMatch) {
      count = parseInt(countMatch[1]);
    }

    const forMatch = text.match(/for\s*(\d+)/i);
    if (forMatch) {
      count = parseInt(forMatch[1]);
    }

    result.schedule = {
      interval: intervalMs,
      count,
      executed: 0,
    };
  }

  return result;
}

function isConfigured(): boolean {
  return !!(process.env.SOLANA_PRIVATE_KEY || process.env.SOLANA_KEYPAIR_PATH);
}

function formatStrategy(strategy: ParsedStrategy): string {
  const statusEmoji = {
    pending: '⏳',
    active: '▶️',
    monitoring: '👀',
    completed: '✅',
    cancelled: '🚫',
    failed: '❌',
  }[strategy.status];

  let output = `${statusEmoji} **${strategy.action.toUpperCase()}**\n`;
  output += `   ID: \`${strategy.id}\`\n`;
  output += `   "${strategy.originalText.slice(0, 50)}${strategy.originalText.length > 50 ? '...' : ''}"\n`;

  if (strategy.asset?.symbol) {
    output += `   Asset: ${strategy.asset.symbol}\n`;
  } else if (strategy.asset?.mint) {
    output += `   Asset: ${strategy.asset.mint.slice(0, 8)}...\n`;
  }

  if (strategy.amount) {
    const unit = strategy.amount.unit === 'usd' ? '$' : strategy.amount.unit === 'sol' ? ' SOL' : strategy.amount.unit === 'percent' ? '%' : ' tokens';
    output += `   Amount: ${strategy.amount.unit === 'usd' ? '$' : ''}${strategy.amount.value}${strategy.amount.unit !== 'usd' ? unit : ''}\n`;
  }

  if (strategy.condition) {
    output += `   Condition: ${strategy.condition.type} ${strategy.condition.value}${strategy.condition.unit === 'percent' ? '%' : ''}\n`;
  }

  if (strategy.schedule) {
    const intervalMins = Math.round(strategy.schedule.interval / 60000);
    output += `   Schedule: every ${intervalMins}m, ${strategy.schedule.executed}/${strategy.schedule.count} done\n`;
  }

  output += `   Status: ${strategy.status}`;

  if (strategy.result?.signature) {
    output += ` | [tx](https://solscan.io/tx/${strategy.result.signature})`;
  }

  return output;
}

// ============================================================================
// Monitoring
// ============================================================================

function startMonitoring(): void {
  if (monitorInterval) return;

  monitorInterval = setInterval(async () => {
    for (const strategy of strategies.values()) {
      if (strategy.status !== 'monitoring') continue;

      try {
        await checkStrategy(strategy);
      } catch (error) {
        logger.error(`[Strategy] Error checking ${strategy.id}:`, error);
      }
    }
  }, 5000); // Check every 5 seconds
}

function stopMonitoring(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

async function checkStrategy(strategy: ParsedStrategy): Promise<void> {
  strategy.lastCheckAt = Date.now();

  if (!strategy.asset?.mint && !strategy.asset?.symbol) {
    strategy.status = 'failed';
    strategy.result = { success: false, error: 'No asset specified' };
    return;
  }

  // Get current price
  const mint = strategy.asset.mint || TOKEN_SYMBOLS[strategy.asset.symbol || ''];
  if (!mint) {
    strategy.status = 'failed';
    strategy.result = { success: false, error: 'Unknown token' };
    return;
  }

  try {
    // Simple price fetch from Jupiter
    const priceUrl = `https://price.jup.ag/v4/price?ids=${mint}`;
    const response = await fetch(priceUrl);
    const data = await response.json() as { data: Record<string, { price: number }> };
    const price = data.data[mint]?.price;

    if (!price) {
      logger.warn(`[Strategy] No price for ${mint}`);
      return;
    }

    // Check condition
    let shouldExecute = false;

    if (strategy.condition?.type === 'immediate') {
      shouldExecute = true;
    } else if (strategy.condition?.type === 'price_below') {
      shouldExecute = price <= strategy.condition.value;
    } else if (strategy.condition?.type === 'price_above') {
      shouldExecute = price >= strategy.condition.value;
    }

    // For DCA, check if it's time for next execution
    if (strategy.action === 'dca' && strategy.schedule) {
      const now = Date.now();
      const lastExec = strategy.executedAt || strategy.createdAt;
      if (now - lastExec >= strategy.schedule.interval) {
        shouldExecute = true;
      }
    }

    if (shouldExecute) {
      await executeStrategy(strategy, price);
    }
  } catch (error) {
    logger.error(`[Strategy] Price check failed:`, error);
  }
}

async function executeStrategy(strategy: ParsedStrategy, currentPrice: number): Promise<void> {
  const mint = strategy.asset?.mint || TOKEN_SYMBOLS[strategy.asset?.symbol || ''];

  try {
    const { loadSolanaKeypair, getSolanaConnection } = await import('../../../solana/wallet');
    const { executeJupiterSwap } = await import('../../../solana/jupiter');

    const keypair = loadSolanaKeypair();
    const connection = getSolanaConnection();
    const SOL_MINT = 'So11111111111111111111111111111111111111112';

    let amount: string;

    if (strategy.amount?.unit === 'sol') {
      amount = String(Math.floor(strategy.amount.value * 1e9));
    } else if (strategy.amount?.unit === 'usd') {
      // Convert USD to SOL (rough estimate)
      const solPrice = await getSolPrice();
      const solAmount = strategy.amount.value / solPrice;
      amount = String(Math.floor(solAmount * 1e9));
    } else {
      amount = String(Math.floor((strategy.amount?.value || 0.1) * 1e9));
    }

    if (strategy.action === 'buy' || strategy.action === 'dca') {
      const result = await executeJupiterSwap(connection, keypair, {
        inputMint: SOL_MINT,
        outputMint: mint,
        amount,
        slippageBps: 500,
      });

      strategy.result = { success: true, signature: result.signature };
      logger.info(`[Strategy] Buy executed: ${result.signature}`);
    } else if (strategy.action === 'sell' || strategy.action === 'stop_loss' || strategy.action === 'take_profit') {
      // Get token balance
      const { PublicKey } = await import('@solana/web3.js');
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        keypair.publicKey,
        { mint: new PublicKey(mint) }
      );

      if (tokenAccounts.value.length === 0) {
        strategy.result = { success: false, error: 'No tokens to sell' };
        strategy.status = 'failed';
        return;
      }

      const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
      let sellAmount = balance;

      if (strategy.amount?.unit === 'percent') {
        sellAmount = String(Math.floor(parseInt(balance) * (strategy.amount.value / 100)));
      }

      const result = await executeJupiterSwap(connection, keypair, {
        inputMint: mint,
        outputMint: SOL_MINT,
        amount: sellAmount,
        slippageBps: 500,
      });

      strategy.result = { success: true, signature: result.signature };
      logger.info(`[Strategy] Sell executed: ${result.signature}`);
    }

    strategy.executedAt = Date.now();

    // Update status
    if (strategy.action === 'dca' && strategy.schedule) {
      strategy.schedule.executed++;
      if (strategy.schedule.executed >= strategy.schedule.count) {
        strategy.status = 'completed';
      }
    } else {
      strategy.status = 'completed';
    }
  } catch (error) {
    strategy.result = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
    strategy.status = 'failed';
    logger.error(`[Strategy] Execution failed:`, error);
  }
}

async function getSolPrice(): Promise<number> {
  try {
    const response = await fetch('https://price.jup.ag/v4/price?ids=So11111111111111111111111111111111111111112');
    const data = await response.json() as { data: Record<string, { price: number }> };
    return data.data['So11111111111111111111111111111111111111112']?.price || 150;
  } catch {
    return 150; // Fallback
  }
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleCreate(text: string): Promise<string> {
  if (!text) {
    return `Usage: /strategy "<your strategy description>"

Examples:
  /strategy "buy $100 of SOL if it drops 5%"
  /strategy "DCA $50 into JUP every hour for 12 hours"
  /strategy "set stop loss at 20% for TOKEN..."`;
  }

  // Remove surrounding quotes
  const cleanText = text.replace(/^["']|["']$/g, '');

  const parsed = parseStrategy(cleanText);

  if (!parsed.action) {
    return `Could not understand strategy. Try being more explicit:

- "buy 0.5 SOL of ABC123..."
- "sell 50% when price rises 20%"
- "DCA $100 every 1 hour for 24 times"`;
  }

  if (!parsed.asset?.mint && !parsed.asset?.symbol) {
    return `Please specify a token. Include:
- A token symbol (SOL, JUP, BONK, etc.)
- Or a mint address (32-44 character base58 string)`;
  }

  const strategy: ParsedStrategy = {
    id: generateId().slice(0, 8),
    originalText: cleanText,
    action: parsed.action,
    asset: parsed.asset || {},
    amount: parsed.amount || { value: 0.1, unit: 'sol' },
    condition: parsed.condition,
    schedule: parsed.schedule,
    status: 'monitoring',
    platform: 'solana',
    createdAt: Date.now(),
  };

  strategies.set(strategy.id, strategy);
  startMonitoring();

  return `**Strategy Created**

${formatStrategy(strategy)}

Strategy is now monitoring. Check with \`/strategy status ${strategy.id}\``;
}

async function handleList(): Promise<string> {
  if (strategies.size === 0) {
    return `**No Active Strategies**

Create one with:
\`\`\`
/strategy "buy $100 of SOL if it drops 5%"
\`\`\``;
  }

  let output = `**Strategies (${strategies.size})**\n\n`;

  for (const strategy of strategies.values()) {
    output += formatStrategy(strategy) + '\n\n';
  }

  return output;
}

async function handleStatus(args: string[]): Promise<string> {
  if (args.length === 0) {
    return 'Usage: /strategy status <id>';
  }

  const id = args[0];
  const strategy = strategies.get(id);

  if (!strategy) {
    return `Strategy not found: ${id}`;
  }

  return `**Strategy Status**\n\n${formatStrategy(strategy)}`;
}

async function handleCancel(args: string[]): Promise<string> {
  if (args.length === 0) {
    return 'Usage: /strategy cancel <id>\n       /strategy cancel all';
  }

  if (args[0].toLowerCase() === 'all') {
    const count = strategies.size;
    for (const strategy of strategies.values()) {
      strategy.status = 'cancelled';
    }
    strategies.clear();
    stopMonitoring();
    return `Cancelled ${count} strategies.`;
  }

  const id = args[0];
  const strategy = strategies.get(id);

  if (!strategy) {
    return `Strategy not found: ${id}`;
  }

  strategy.status = 'cancelled';
  strategies.delete(id);

  if (strategies.size === 0) {
    stopMonitoring();
  }

  return `Cancelled strategy: ${id}`;
}

async function handleTemplates(): Promise<string> {
  return `**Strategy Templates**

\`/strategy template dip-buy\`
  Buy when price drops X%

\`/strategy template take-profit\`
  Sell at profit target (e.g., 2x)

\`/strategy template dca-daily\`
  DCA into token daily

\`/strategy template stop-loss\`
  Sell if price drops X%

\`/strategy template ladder-buy\`
  Buy at multiple price levels

Use: \`/strategy template <name>\``;
}

async function handleTemplate(args: string[]): Promise<string> {
  if (args.length === 0) {
    return handleTemplates();
  }

  const name = args[0].toLowerCase();

  const templates: Record<string, string> = {
    'dip-buy': 'Buy 0.5 SOL of TOKEN if it drops 10%',
    'take-profit': 'Sell 50% when price rises 100%',
    'dca-daily': 'DCA 0.1 SOL into TOKEN every 24 hours for 30 times',
    'stop-loss': 'Sell all if price drops 20%',
    'ladder-buy': 'Buy 0.1 SOL at each level: -5%, -10%, -15%, -20%, -25%',
  };

  const template = templates[name];
  if (!template) {
    return `Unknown template: ${name}\n\nAvailable: ${Object.keys(templates).join(', ')}`;
  }

  return `**Template: ${name}**

\`\`\`
${template}
\`\`\`

Copy and modify, then run:
\`\`\`
/strategy "${template.replace('TOKEN', 'YOUR_TOKEN_MINT')}"
\`\`\``;
}

async function handleExecute(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /execute <action> <amount> <token>

Examples:
  /execute buy 0.5 SOL of ABC123...
  /execute sell all BONK
  /execute swap 1 SOL to USDC`;
  }

  const text = args.join(' ');
  const parsed = parseStrategy(text);

  if (!parsed.asset?.mint && !parsed.asset?.symbol) {
    return 'Please specify a token (symbol or mint address)';
  }

  const strategy: ParsedStrategy = {
    id: generateId().slice(0, 8),
    originalText: text,
    action: parsed.action || 'buy',
    asset: parsed.asset || {},
    amount: parsed.amount || { value: 0.1, unit: 'sol' },
    condition: { type: 'immediate', value: 0 },
    status: 'active',
    platform: 'solana',
    createdAt: Date.now(),
  };

  strategies.set(strategy.id, strategy);

  try {
    await executeStrategy(strategy, 0);

    if (strategy.result?.success) {
      return `**Trade Executed**

${formatStrategy(strategy)}`;
    } else {
      return `**Trade Failed**

${strategy.result?.error || 'Unknown error'}`;
    }
  } finally {
    strategies.delete(strategy.id);
  }
}

export async function execute(args: string): Promise<string> {
  if (!isConfigured()) {
    return 'AI Strategy not configured. Set SOLANA_PRIVATE_KEY environment variable.';
  }

  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  // Check if the whole arg is a quoted strategy
  if (args.trim().startsWith('"') || args.trim().startsWith("'")) {
    return handleCreate(args.trim());
  }

  switch (command) {
    case 'status':
    case 'check':
      return handleStatus(rest);

    case 'cancel':
    case 'stop':
    case 'remove':
      return handleCancel(rest);

    case 'templates':
      return handleTemplates();

    case 'template':
      return handleTemplate(rest);

    case 'list':
    case 'ls':
      return handleList();

    case 'help':
    default:
      // If first arg looks like a strategy description, create it
      if (args.trim().length > 10 && !args.startsWith('/')) {
        return handleCreate(args.trim());
      }

      return `**AI Strategy**

Convert natural language to trades.

**Commands:**
\`\`\`
/strategy "<description>"      Create strategy
/strategies                    List active strategies
/strategy status <id>          Check status
/strategy cancel <id>          Cancel strategy
/strategy templates            List templates
/execute <action>              Execute immediately
\`\`\`

**Examples:**
\`\`\`
/strategy "buy $100 of SOL if it drops 5%"
/strategy "DCA $50 into JUP every hour for 12 hours"
/strategy "set stop loss at 20%"
/execute buy 0.5 SOL of ABC123...
\`\`\`

**Templates:**
  dip-buy, take-profit, dca-daily, stop-loss, ladder-buy`;
  }
}

// Also export handleExecute directly for /execute command
export async function executeCommand(args: string): Promise<string> {
  if (!isConfigured()) {
    return 'Not configured. Set SOLANA_PRIVATE_KEY environment variable.';
  }
  return handleExecute(args.trim().split(/\s+/));
}

export default {
  name: 'ai-strategy',
  description: 'AI Strategy - Convert natural language to automated trades on Solana',
  commands: ['/ai-strategy'],
  handle: execute,
};
