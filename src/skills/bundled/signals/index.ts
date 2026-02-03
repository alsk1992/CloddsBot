/**
 * Signals Trading Skill - RSS/Twitter/Telegram/Webhook triggers
 *
 * Commands:
 * /signal add <type> <config>     Add signal source
 * /signal remove <id>             Remove source
 * /signal list                    List sources
 * /signal pause <id>              Pause source
 * /signal resume <id>             Resume source
 * /signal history [source]        View signal history
 * /signal filter <id> <action>    Manage filters
 * /signal config <id> [options]   Configure source
 */

import { Connection, Keypair } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { logger } from '../../../utils/logger';
import { generateId } from '../../../utils/id';

// ============================================================================
// Types (standalone, not dependent on swarm)
// ============================================================================

type SignalSourceType = 'rss' | 'twitter' | 'telegram' | 'webhook';

interface SignalSource {
  id: string;
  type: SignalSourceType;
  name: string;
  config: SignalSourceConfig;
  enabled: boolean;
  filters: SignalFilter[];
  tradeConfig: SignalTradeConfig;
  stats: SignalStats;
  createdAt: number;
  lastCheckAt?: number;
  lastSignalAt?: number;
}

interface SignalSourceConfig {
  feedUrl?: string;
  checkIntervalMs?: number;
  username?: string;
  nitterInstance?: string;
  webhookSecret?: string;
}

interface SignalFilter {
  type: 'keyword' | 'mint' | 'sentiment' | 'regex';
  value: string;
  action: 'buy' | 'sell' | 'ignore';
}

interface SignalTradeConfig {
  amountSol: number;
  slippageBps: number;
  cooldownMs: number;
  requireMintInMessage: boolean;
}

interface SignalStats {
  signalsReceived: number;
  signalsMatched: number;
  tradesExecuted: number;
  tradesSuccessful: number;
  tradesFailed: number;
  totalSolSpent: number;
  totalSolReceived: number;
}

interface DetectedSignal {
  sourceId: string;
  content: string;
  url?: string;
  author?: string;
  timestamp: number;
  detectedMints: string[];
  sentiment: 'bullish' | 'bearish' | 'neutral';
  matchedFilters: SignalFilter[];
}

// Singleton storage
const sources: Map<string, SignalSource> = new Map();
const signalHistory: DetectedSignal[] = [];
const intervals: Map<string, NodeJS.Timeout> = new Map();
const lastSeenItems: Map<string, Set<string>> = new Map();
const tradeCooldowns: Map<string, number> = new Map();

// Patterns
const MINT_REGEX = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const BULLISH_KEYWORDS = ['buy', 'bullish', 'moon', 'pump', 'gem', 'alpha', 'ape', '100x', '10x'];
const BEARISH_KEYWORDS = ['sell', 'bearish', 'dump', 'rug', 'scam', 'exit', 'short'];

// ============================================================================
// Helpers
// ============================================================================

function isConfigured(): boolean {
  return !!(process.env.SOLANA_PRIVATE_KEY || process.env.SOLANA_KEYPAIR_PATH);
}

function formatSource(source: SignalSource): string {
  const status = source.enabled ? '🟢' : '🔴';
  const lastCheck = source.lastCheckAt
    ? `${Math.floor((Date.now() - source.lastCheckAt) / 1000)}s ago`
    : 'never';

  let output = `${status} **${source.name}** (${source.type})\n`;
  output += `   ID: \`${source.id}\`\n`;

  if (source.type === 'rss' && source.config.feedUrl) {
    output += `   URL: ${source.config.feedUrl.slice(0, 50)}...\n`;
  }
  if (source.type === 'twitter' && source.config.username) {
    output += `   User: @${source.config.username}\n`;
  }
  if (source.type === 'webhook') {
    output += `   Webhook: POST /webhook/${source.id}\n`;
  }

  output += `   Signals: ${source.stats.signalsReceived} | Trades: ${source.stats.tradesExecuted}\n`;
  output += `   Last check: ${lastCheck}`;

  return output;
}

function extractMints(content: string): string[] {
  const matches = content.match(MINT_REGEX) || [];
  return [...new Set(matches)].filter(m => m.length >= 32 && m.length <= 44);
}

function analyzeSentiment(content: string): 'bullish' | 'bearish' | 'neutral' {
  const lower = content.toLowerCase();
  let bullish = 0;
  let bearish = 0;

  for (const kw of BULLISH_KEYWORDS) {
    if (lower.includes(kw)) bullish++;
  }
  for (const kw of BEARISH_KEYWORDS) {
    if (lower.includes(kw)) bearish++;
  }

  if (bullish > bearish) return 'bullish';
  if (bearish > bullish) return 'bearish';
  return 'neutral';
}

function matchFilters(
  filters: SignalFilter[],
  content: string,
  mints: string[],
  sentiment: string
): SignalFilter[] {
  const matched: SignalFilter[] = [];
  const lower = content.toLowerCase();

  for (const filter of filters) {
    switch (filter.type) {
      case 'keyword':
        if (lower.includes(filter.value.toLowerCase())) {
          matched.push(filter);
        }
        break;
      case 'mint':
        if (mints.includes(filter.value)) {
          matched.push(filter);
        }
        break;
      case 'sentiment':
        if (sentiment === filter.value) {
          matched.push(filter);
        }
        break;
      case 'regex':
        try {
          const regex = new RegExp(filter.value, 'i');
          if (regex.test(content)) {
            matched.push(filter);
          }
        } catch {
          // Invalid regex
        }
        break;
    }
  }

  return matched;
}

// ============================================================================
// RSS Polling
// ============================================================================

async function checkRSS(source: SignalSource): Promise<void> {
  if (!source.config.feedUrl) return;

  try {
    const response = await fetch(source.config.feedUrl);
    if (!response.ok) return;

    const text = await response.text();
    const items = parseRSSItems(text);
    const seen = lastSeenItems.get(source.id) || new Set();

    for (const item of items) {
      const key = item.guid || item.link || item.title;
      if (seen.has(key)) continue;
      seen.add(key);

      await processSignal(source, `${item.title} ${item.description || ''}`, item.link, item.author);
    }

    // Keep set size reasonable
    if (seen.size > 500) {
      const arr = Array.from(seen);
      seen.clear();
      arr.slice(-250).forEach(k => seen.add(k));
    }

    lastSeenItems.set(source.id, seen);
  } catch (error) {
    logger.error(`[Signals] RSS error for ${source.name}:`, error);
  }
}

function parseRSSItems(xml: string): Array<{
  title: string;
  description?: string;
  link?: string;
  guid?: string;
  author?: string;
}> {
  const items: Array<{
    title: string;
    description?: string;
    link?: string;
    guid?: string;
    author?: string;
  }> = [];

  const itemMatches = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const itemXml of itemMatches) {
    const title = extractXmlTag(itemXml, 'title');
    if (!title) continue;

    items.push({
      title,
      description: extractXmlTag(itemXml, 'description'),
      link: extractXmlTag(itemXml, 'link'),
      guid: extractXmlTag(itemXml, 'guid'),
      author: extractXmlTag(itemXml, 'author') || extractXmlTag(itemXml, 'dc:creator'),
    });
  }

  return items;
}

function extractXmlTag(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? (match[1] || match[2])?.trim() : undefined;
}

// ============================================================================
// Twitter Polling (via Nitter)
// ============================================================================

async function checkTwitter(source: SignalSource): Promise<void> {
  const nitter = source.config.nitterInstance || 'https://nitter.net';
  const username = source.config.username;
  if (!username) return;

  try {
    const url = `${nitter}/${username}/rss`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!response.ok) return;

    const text = await response.text();
    const items = parseRSSItems(text);
    const seen = lastSeenItems.get(source.id) || new Set();

    for (const item of items) {
      const key = item.guid || item.link || item.title;
      if (seen.has(key)) continue;
      seen.add(key);

      await processSignal(source, item.title, item.link, username);
    }

    if (seen.size > 500) {
      const arr = Array.from(seen);
      seen.clear();
      arr.slice(-250).forEach(k => seen.add(k));
    }

    lastSeenItems.set(source.id, seen);
  } catch (error) {
    logger.error(`[Signals] Twitter error for ${source.name}:`, error);
  }
}

// ============================================================================
// Signal Processing
// ============================================================================

async function processSignal(
  source: SignalSource,
  content: string,
  url?: string,
  author?: string
): Promise<void> {
  source.stats.signalsReceived++;
  source.lastSignalAt = Date.now();

  const mints = extractMints(content);
  const sentiment = analyzeSentiment(content);
  const matched = matchFilters(source.filters, content, mints, sentiment);

  const signal: DetectedSignal = {
    sourceId: source.id,
    content: content.slice(0, 500),
    url,
    author,
    timestamp: Date.now(),
    detectedMints: mints,
    sentiment,
    matchedFilters: matched,
  };

  signalHistory.push(signal);
  if (signalHistory.length > 1000) {
    signalHistory.splice(0, 500);
  }

  // Check if we should trade
  if (matched.length === 0) return;

  source.stats.signalsMatched++;

  // Check cooldown
  const lastTrade = tradeCooldowns.get(source.id) || 0;
  if (Date.now() - lastTrade < source.tradeConfig.cooldownMs) {
    logger.info(`[Signals] Skipping trade (cooldown)`);
    return;
  }

  // Get mint to trade
  const mint = mints[0];
  if (source.tradeConfig.requireMintInMessage && !mint) {
    logger.info(`[Signals] Skipping trade (no mint found)`);
    return;
  }

  if (!mint) return;

  // Determine action
  const actionFilter = matched.find(f => f.action !== 'ignore');
  if (!actionFilter) return;

  const action = actionFilter.action as 'buy' | 'sell';

  // Execute trade
  tradeCooldowns.set(source.id, Date.now());
  source.stats.tradesExecuted++;

  try {
    const { loadSolanaKeypair, getSolanaConnection } = await import('../../../solana/wallet');
    const { executeJupiterSwap } = await import('../../../solana/jupiter');

    const keypair = loadSolanaKeypair();
    const connection = getSolanaConnection();
    const SOL_MINT = 'So11111111111111111111111111111111111111112';

    if (action === 'buy') {
      const result = await executeJupiterSwap(connection, keypair, {
        inputMint: SOL_MINT,
        outputMint: mint,
        amount: String(Math.floor(source.tradeConfig.amountSol * 1e9)),
        slippageBps: source.tradeConfig.slippageBps,
      });

      source.stats.tradesSuccessful++;
      source.stats.totalSolSpent += source.tradeConfig.amountSol;
      logger.info(`[Signals] Buy executed: ${result.signature}`);
    } else {
      // For sells, check balance first
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        keypair.publicKey,
        { mint: new (await import('@solana/web3.js')).PublicKey(mint) }
      );

      if (tokenAccounts.value.length === 0) {
        logger.info(`[Signals] No tokens to sell`);
        source.stats.tradesFailed++;
        return;
      }

      const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;

      const result = await executeJupiterSwap(connection, keypair, {
        inputMint: mint,
        outputMint: SOL_MINT,
        amount: balance,
        slippageBps: source.tradeConfig.slippageBps,
      });

      source.stats.tradesSuccessful++;
      const sellQuote = result.quote as { outAmount?: string } | undefined;
      source.stats.totalSolReceived += sellQuote?.outAmount ? parseFloat(sellQuote.outAmount) / 1e9 : 0;
      logger.info(`[Signals] Sell executed: ${result.signature}`);
    }
  } catch (error) {
    source.stats.tradesFailed++;
    logger.error(`[Signals] Trade failed:`, error);
  }
}

// ============================================================================
// Source Management
// ============================================================================

function startPolling(source: SignalSource): void {
  if (intervals.has(source.id)) return;

  const intervalMs = source.config.checkIntervalMs || 30000;

  const poll = async () => {
    if (!source.enabled) return;
    source.lastCheckAt = Date.now();

    switch (source.type) {
      case 'rss':
        await checkRSS(source);
        break;
      case 'twitter':
        await checkTwitter(source);
        break;
    }
  };

  poll();
  const interval = setInterval(poll, intervalMs);
  intervals.set(source.id, interval);
}

function stopPolling(source: SignalSource): void {
  const interval = intervals.get(source.id);
  if (interval) {
    clearInterval(interval);
    intervals.delete(source.id);
  }
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleAddRSS(args: string[]): Promise<string> {
  if (args.length === 0) {
    return 'Usage: /signal add rss <url> [--name "label"]';
  }

  const url = args[0];
  let name = url.slice(0, 30);

  const nameIndex = args.indexOf('--name');
  if (nameIndex >= 0 && args[nameIndex + 1]) {
    name = args[nameIndex + 1];
  }

  const source: SignalSource = {
    id: generateId(),
    type: 'rss',
    name,
    config: {
      feedUrl: url,
      checkIntervalMs: 30000,
    },
    enabled: true,
    filters: [],
    tradeConfig: {
      amountSol: 0.1,
      slippageBps: 500,
      cooldownMs: 60000,
      requireMintInMessage: true,
    },
    stats: {
      signalsReceived: 0,
      signalsMatched: 0,
      tradesExecuted: 0,
      tradesSuccessful: 0,
      tradesFailed: 0,
      totalSolSpent: 0,
      totalSolReceived: 0,
    },
    createdAt: Date.now(),
  };

  sources.set(source.id, source);
  lastSeenItems.set(source.id, new Set());
  startPolling(source);

  return `**RSS Source Added**

${formatSource(source)}

Add filters with: \`/signal filter ${source.id} add keyword "buy" buy\``;
}

async function handleAddTwitter(args: string[]): Promise<string> {
  if (args.length === 0) {
    return 'Usage: /signal add twitter <username> [--name "label"]';
  }

  const username = args[0].replace('@', '');
  let name = `@${username}`;

  const nameIndex = args.indexOf('--name');
  if (nameIndex >= 0 && args[nameIndex + 1]) {
    name = args[nameIndex + 1];
  }

  const source: SignalSource = {
    id: generateId(),
    type: 'twitter',
    name,
    config: {
      username,
      nitterInstance: 'https://nitter.net',
      checkIntervalMs: 60000,
    },
    enabled: true,
    filters: [],
    tradeConfig: {
      amountSol: 0.1,
      slippageBps: 500,
      cooldownMs: 60000,
      requireMintInMessage: true,
    },
    stats: {
      signalsReceived: 0,
      signalsMatched: 0,
      tradesExecuted: 0,
      tradesSuccessful: 0,
      tradesFailed: 0,
      totalSolSpent: 0,
      totalSolReceived: 0,
    },
    createdAt: Date.now(),
  };

  sources.set(source.id, source);
  lastSeenItems.set(source.id, new Set());
  startPolling(source);

  return `**Twitter Source Added**

${formatSource(source)}

Add filters with: \`/signal filter ${source.id} add keyword "alpha" buy\``;
}

async function handleAddWebhook(args: string[]): Promise<string> {
  let name = 'webhook';

  const nameIndex = args.indexOf('--name');
  if (nameIndex >= 0 && args[nameIndex + 1]) {
    name = args[nameIndex + 1];
  }

  const secret = generateId();

  const source: SignalSource = {
    id: generateId(),
    type: 'webhook',
    name,
    config: {
      webhookSecret: secret,
    },
    enabled: true,
    filters: [],
    tradeConfig: {
      amountSol: 0.1,
      slippageBps: 500,
      cooldownMs: 60000,
      requireMintInMessage: true,
    },
    stats: {
      signalsReceived: 0,
      signalsMatched: 0,
      tradesExecuted: 0,
      tradesSuccessful: 0,
      tradesFailed: 0,
      totalSolSpent: 0,
      totalSolReceived: 0,
    },
    createdAt: Date.now(),
  };

  sources.set(source.id, source);

  return `**Webhook Source Added**

${formatSource(source)}

**Webhook URL:** POST /webhook/${source.id}

**Payload:**
\`\`\`json
{
  "content": "Your signal text with mint address...",
  "author": "optional-author",
  "secret": "${secret}"
}
\`\`\`

Add filters with: \`/signal filter ${source.id} add keyword "buy" buy\``;
}

async function handleAdd(args: string[]): Promise<string> {
  if (args.length === 0) {
    return `Usage: /signal add <type> <config>

Types:
  rss <url>          Add RSS feed
  twitter <user>     Add Twitter account
  webhook            Get webhook URL`;
  }

  const type = args[0].toLowerCase();
  const rest = args.slice(1);

  switch (type) {
    case 'rss':
      return handleAddRSS(rest);
    case 'twitter':
    case 'x':
      return handleAddTwitter(rest);
    case 'webhook':
      return handleAddWebhook(rest);
    default:
      return `Unknown source type: ${type}. Use rss, twitter, or webhook.`;
  }
}

async function handleRemove(args: string[]): Promise<string> {
  if (args.length === 0) {
    return 'Usage: /signal remove <id>';
  }

  const id = args[0];
  const source = sources.get(id);

  if (!source) {
    return `No source found with ID: ${id}`;
  }

  stopPolling(source);
  sources.delete(id);
  lastSeenItems.delete(id);

  return `Removed signal source: ${source.name}`;
}

async function handleList(): Promise<string> {
  if (sources.size === 0) {
    return `**No Signal Sources**

Add a source with:
\`\`\`
/signal add rss https://example.com/feed.xml
/signal add twitter CryptoTrader
/signal add webhook
\`\`\``;
  }

  let output = `**Signal Sources (${sources.size})**\n\n`;

  for (const source of sources.values()) {
    output += formatSource(source) + '\n\n';
  }

  return output;
}

async function handlePause(args: string[]): Promise<string> {
  if (args.length === 0) {
    return 'Usage: /signal pause <id>';
  }

  const id = args[0];
  const source = sources.get(id);

  if (!source) {
    return `No source found with ID: ${id}`;
  }

  source.enabled = false;
  stopPolling(source);

  return `Paused signal source: ${source.name}`;
}

async function handleResume(args: string[]): Promise<string> {
  if (args.length === 0) {
    return 'Usage: /signal resume <id>';
  }

  const id = args[0];
  const source = sources.get(id);

  if (!source) {
    return `No source found with ID: ${id}`;
  }

  source.enabled = true;
  startPolling(source);

  return `Resumed signal source: ${source.name}`;
}

async function handleHistory(args: string[]): Promise<string> {
  const sourceId = args[0];
  let history = signalHistory;

  if (sourceId) {
    history = history.filter(s => s.sourceId === sourceId);
  }

  if (history.length === 0) {
    return 'No signal history found.';
  }

  let output = '**Signal History**\n\n';

  for (const signal of history.slice(-20).reverse()) {
    const time = new Date(signal.timestamp).toLocaleTimeString();
    const sentiment = signal.sentiment === 'bullish' ? '📈' : signal.sentiment === 'bearish' ? '📉' : '➖';
    const mints = signal.detectedMints.length > 0 ? ` | ${signal.detectedMints.length} mints` : '';

    output += `${sentiment} ${time} | ${signal.content.slice(0, 50)}...${mints}\n`;
  }

  return output;
}

async function handleFilter(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /signal filter <id> <action>

Actions:
  add <type> <value> <trade-action>   Add filter
  list                                List filters
  remove <index>                      Remove filter

Types: keyword, mint, sentiment, regex
Trade actions: buy, sell, ignore`;
  }

  const id = args[0];
  const action = args[1].toLowerCase();
  const source = sources.get(id);

  if (!source) {
    return `No source found with ID: ${id}`;
  }

  switch (action) {
    case 'add': {
      if (args.length < 5) {
        return 'Usage: /signal filter <id> add <type> <value> <action>';
      }

      const filterType = args[2] as SignalFilter['type'];
      const value = args[3];
      const tradeAction = args[4] as 'buy' | 'sell' | 'ignore';

      if (!['keyword', 'mint', 'sentiment', 'regex'].includes(filterType)) {
        return 'Invalid filter type. Use: keyword, mint, sentiment, regex';
      }

      if (!['buy', 'sell', 'ignore'].includes(tradeAction)) {
        return 'Invalid action. Use: buy, sell, ignore';
      }

      source.filters.push({ type: filterType, value, action: tradeAction });
      return `Added filter: ${filterType} "${value}" -> ${tradeAction}`;
    }

    case 'list': {
      if (source.filters.length === 0) {
        return `No filters for ${source.name}. Add with: /signal filter ${id} add keyword "buy" buy`;
      }

      let output = `**Filters for ${source.name}**\n\n`;
      source.filters.forEach((f, i) => {
        output += `${i}. ${f.type}: "${f.value}" -> ${f.action}\n`;
      });
      return output;
    }

    case 'remove': {
      const index = parseInt(args[2]);
      if (isNaN(index) || index < 0 || index >= source.filters.length) {
        return 'Invalid filter index.';
      }

      const removed = source.filters.splice(index, 1)[0];
      return `Removed filter: ${removed.type} "${removed.value}"`;
    }

    default:
      return 'Unknown action. Use: add, list, remove';
  }
}

async function handleConfig(args: string[]): Promise<string> {
  if (args.length === 0) {
    return `Usage: /signal config <id> [options]

Options:
  --amount <sol>      SOL per trade
  --slippage <bps>    Slippage tolerance
  --cooldown <ms>     Cooldown between trades
  --require-mint      Only trade if mint found`;
  }

  const id = args[0];
  const source = sources.get(id);

  if (!source) {
    return `No source found with ID: ${id}`;
  }

  // Parse options
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--amount':
        source.tradeConfig.amountSol = parseFloat(next);
        i++;
        break;
      case '--slippage':
        source.tradeConfig.slippageBps = parseInt(next);
        i++;
        break;
      case '--cooldown':
        source.tradeConfig.cooldownMs = parseInt(next);
        i++;
        break;
      case '--require-mint':
        source.tradeConfig.requireMintInMessage = true;
        break;
      case '--no-require-mint':
        source.tradeConfig.requireMintInMessage = false;
        break;
    }
  }

  return `**Config for ${source.name}**

Amount: ${source.tradeConfig.amountSol} SOL
Slippage: ${source.tradeConfig.slippageBps} bps
Cooldown: ${source.tradeConfig.cooldownMs}ms
Require mint: ${source.tradeConfig.requireMintInMessage}`;
}

export async function execute(args: string): Promise<string> {
  if (!isConfigured()) {
    return 'Signals not configured. Set SOLANA_PRIVATE_KEY environment variable.';
  }

  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    case 'add':
      return handleAdd(rest);
    case 'remove':
    case 'rm':
    case 'delete':
      return handleRemove(rest);
    case 'list':
    case 'ls':
      return handleList();
    case 'pause':
    case 'stop':
      return handlePause(rest);
    case 'resume':
    case 'start':
      return handleResume(rest);
    case 'history':
    case 'hist':
      return handleHistory(rest);
    case 'filter':
    case 'f':
      return handleFilter(rest);
    case 'config':
    case 'cfg':
      return handleConfig(rest);
    case 'help':
    default:
      return `**Signals Trading**

Monitor RSS, Twitter, and webhooks to trigger automatic trades.

**Commands:**
\`\`\`
/signal add <type> <config>     Add signal source
/signal remove <id>             Remove source
/signal list                    List sources
/signal pause <id>              Pause source
/signal resume <id>             Resume source
/signal history [source]        View history
/signal filter <id> <action>    Manage filters
/signal config <id> [options]   Configure source
\`\`\`

**Source Types:**
  rss <url>         RSS/Atom feed
  twitter <user>    Twitter via Nitter
  webhook           Custom webhook

**Example:**
\`\`\`
/signal add rss https://example.com/feed.xml
/signal filter abc123 add keyword "bullish" buy
\`\`\``;
  }
}

export default {
  name: 'signals',
  description: 'Signals trading - monitor RSS, Twitter, and webhooks to trigger automatic trades',
  commands: ['/signals'],
  requires: { env: ['SOLANA_PRIVATE_KEY'] },
  handle: execute,
};
