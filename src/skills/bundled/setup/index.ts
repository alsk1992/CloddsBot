/**
 * Setup Wizard Skill
 *
 * Interactive onboarding that checks skill readiness and guides configuration.
 */

import { logger } from '../../../utils/logger.js';

// =============================================================================
// CATEGORY DEFINITIONS
// =============================================================================

interface SetupCategory {
  name: string;
  description: string;
  envVars: Array<{
    name: string;
    description: string;
    example: string;
    required?: boolean;
  }>;
  skills: Array<{
    name: string;
    command: string;
    description: string;
  }>;
  quickStart: string[];
}

const CATEGORIES: Record<string, SetupCategory> = {
  defi: {
    name: 'DeFi & DEX',
    description: 'Swap tokens on EVM chains (Ethereum, BSC, Arbitrum, Base)',
    envVars: [
      {
        name: 'EVM_PRIVATE_KEY',
        description: 'Private key for EVM wallet (all chains)',
        example: 'export EVM_PRIVATE_KEY="0xabcdef1234567890..."',
        required: true,
      },
      {
        name: 'BSC_RPC_URL',
        description: 'Custom BNB Smart Chain RPC (optional)',
        example: 'export BSC_RPC_URL="https://bsc-dataseed.binance.org"',
      },
      {
        name: 'ETH_RPC_URL',
        description: 'Custom Ethereum RPC (optional)',
        example: 'export ETH_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/..."',
      },
    ],
    skills: [
      { name: 'pancakeswap', command: '/cake', description: 'PancakeSwap multi-chain DEX' },
      { name: 'trading-evm', command: '/trading-evm', description: 'EVM token trading' },
      { name: 'bridge', command: '/bridge', description: 'Cross-chain bridging' },
      { name: 'ens', command: '/ens', description: 'ENS name resolution' },
      { name: 'onchainkit', command: '/onchainkit', description: 'Base chain toolkit' },
    ],
    quickStart: [
      '/cake quote BNB USDT 1 --chain bsc',
      '/cake balance CAKE',
      '/bridge status',
    ],
  },

  futures: {
    name: 'Futures & Perps',
    description: 'Trade perpetual futures on CEX and DEX platforms',
    envVars: [
      {
        name: 'HYPERLIQUID_PRIVATE_KEY',
        description: 'Hyperliquid L1 private key',
        example: 'export HYPERLIQUID_PRIVATE_KEY="0xabcdef..."',
        required: true,
      },
      {
        name: 'HYPERLIQUID_WALLET',
        description: 'Hyperliquid wallet address (for vault trading)',
        example: 'export HYPERLIQUID_WALLET="0x1234..."',
      },
      {
        name: 'EVM_PRIVATE_KEY',
        description: 'For Lighter DEX on Arbitrum',
        example: 'export EVM_PRIVATE_KEY="0xabcdef..."',
        required: true,
      },
      {
        name: 'LIGHTER_API_KEY',
        description: 'Lighter DEX API key (optional, higher rate limits)',
        example: 'export LIGHTER_API_KEY="your-key"',
      },
      {
        name: 'BINANCE_API_KEY',
        description: 'Binance futures API key',
        example: 'export BINANCE_API_KEY="your-key"',
      },
      {
        name: 'BINANCE_API_SECRET',
        description: 'Binance futures API secret',
        example: 'export BINANCE_API_SECRET="your-secret"',
      },
      {
        name: 'BYBIT_API_KEY',
        description: 'Bybit API key',
        example: 'export BYBIT_API_KEY="your-key"',
      },
      {
        name: 'BYBIT_API_SECRET',
        description: 'Bybit API secret',
        example: 'export BYBIT_API_SECRET="your-secret"',
      },
      {
        name: 'MEXC_API_KEY',
        description: 'MEXC API key',
        example: 'export MEXC_API_KEY="your-key"',
      },
      {
        name: 'MEXC_API_SECRET',
        description: 'MEXC API secret',
        example: 'export MEXC_API_SECRET="your-secret"',
      },
    ],
    skills: [
      { name: 'hyperliquid', command: '/hl', description: 'Hyperliquid perps DEX' },
      { name: 'lighter', command: '/lighter', description: 'Lighter orderbook DEX' },
      { name: 'drift', command: '/drift', description: 'Drift Protocol (Solana perps)' },
      { name: 'binance-futures', command: '/binance', description: 'Binance futures' },
      { name: 'bybit-futures', command: '/bybit', description: 'Bybit derivatives' },
      { name: 'mexc-futures', command: '/mexc', description: 'MEXC futures' },
    ],
    quickStart: [
      '/hl markets',
      '/lighter markets',
      '/hl balance',
    ],
  },

  prediction: {
    name: 'Prediction Markets',
    description: 'Trade on prediction market platforms',
    envVars: [
      {
        name: 'POLY_API_KEY',
        description: 'Polymarket CLOB API key',
        example: 'export POLY_API_KEY="your-key"',
        required: true,
      },
      {
        name: 'POLY_API_SECRET',
        description: 'Polymarket CLOB API secret',
        example: 'export POLY_API_SECRET="your-secret"',
        required: true,
      },
      {
        name: 'POLY_API_PASSPHRASE',
        description: 'Polymarket CLOB API passphrase',
        example: 'export POLY_API_PASSPHRASE="your-passphrase"',
        required: true,
      },
      {
        name: 'BETFAIR_APP_KEY',
        description: 'Betfair application key',
        example: 'export BETFAIR_APP_KEY="your-key"',
      },
      {
        name: 'BETFAIR_SESSION_TOKEN',
        description: 'Betfair session token',
        example: 'export BETFAIR_SESSION_TOKEN="your-token"',
      },
    ],
    skills: [
      { name: 'trading-polymarket', command: '/poly', description: 'Polymarket trading' },
      { name: 'betfair', command: '/bf', description: 'Betfair exchange' },
      { name: 'trading-kalshi', command: '/kalshi', description: 'Kalshi events' },
      { name: 'trading-manifold', command: '/manifold', description: 'Manifold Markets' },
      { name: 'predictfun', command: '/predictfun', description: 'Predict.fun' },
      { name: 'smarkets', command: '/smarkets', description: 'Smarkets exchange' },
      { name: 'metaculus', command: '/metaculus', description: 'Metaculus forecasts' },
    ],
    quickStart: [
      '/poly search "election"',
      '/bf markets',
      '/feeds trending',
    ],
  },

  solana: {
    name: 'Solana DeFi',
    description: 'Trade tokens and LP on Solana',
    envVars: [
      {
        name: 'SOLANA_PRIVATE_KEY',
        description: 'Base58 Solana private key',
        example: 'export SOLANA_PRIVATE_KEY="5abc..."',
        required: true,
      },
      {
        name: 'SOLANA_KEYPAIR_PATH',
        description: 'Alternative: path to keypair JSON',
        example: 'export SOLANA_KEYPAIR_PATH="~/.config/solana/id.json"',
      },
      {
        name: 'HELIUS_API_KEY',
        description: 'Helius RPC API key (faster Solana RPCs)',
        example: 'export HELIUS_API_KEY="your-key"',
      },
    ],
    skills: [
      { name: 'jupiter', command: '/jup', description: 'Jupiter aggregator' },
      { name: 'raydium', command: '/raydium', description: 'Raydium AMM' },
      { name: 'orca', command: '/orca', description: 'Orca DEX' },
      { name: 'meteora', command: '/meteora', description: 'Meteora DLMM' },
      { name: 'pumpfun', command: '/pumpfun', description: 'Pump.fun tokens' },
      { name: 'kamino', command: '/kamino', description: 'Kamino Finance' },
      { name: 'trading-solana', command: '/trading-solana', description: 'Solana trading' },
    ],
    quickStart: [
      '/jup quote SOL USDC 1',
      '/bags sol',
      '/raydium pools',
    ],
  },

  ai: {
    name: 'AI & Strategy',
    description: 'AI-powered trading strategies, backtesting, and automation',
    envVars: [
      {
        name: 'OPENAI_API_KEY',
        description: 'OpenAI API key (for embeddings and AI features)',
        example: 'export OPENAI_API_KEY="sk-..."',
      },
      {
        name: 'VOYAGE_API_KEY',
        description: 'Voyage AI API key (alternative embedding provider)',
        example: 'export VOYAGE_API_KEY="your-key"',
      },
    ],
    skills: [
      { name: 'ai-strategy', command: '/ai-strategy', description: 'AI trading strategies' },
      { name: 'strategy', command: '/strategy', description: 'Strategy management' },
      { name: 'arbitrage', command: '/arb', description: 'Cross-market arbitrage' },
      { name: 'backtest', command: '/backtest', description: 'Strategy backtesting' },
      { name: 'embeddings', command: '/embeddings', description: 'Semantic search & similarity' },
      { name: 'copy-trading', command: '/copy', description: 'Copy trading' },
      { name: 'execution', command: '/exec', description: 'Order execution engine' },
    ],
    quickStart: [
      '/arb scan',
      '/strategy list',
      '/backtest run',
    ],
  },
};

// =============================================================================
// HANDLERS
// =============================================================================

function handleOverview(): string {
  const lines = ['**Setup Wizard**', ''];
  lines.push('Check which skills are ready and configure what you need.\n');

  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const total = cat.envVars.filter(v => v.required).length;
    const set = cat.envVars.filter(v => v.required && process.env[v.name]).length;
    const ready = total === 0 || set === total;
    const status = ready ? 'Ready' : `${set}/${total} configured`;

    lines.push(`**${cat.name}** — ${status}`);
    lines.push(`  ${cat.description}`);
    lines.push(`  /setup ${key} for details`);
    lines.push('');
  }

  lines.push('**Commands:**');
  lines.push('  /setup <category>  — Configure a category');
  lines.push('  /setup env         — List all environment variables');
  lines.push('  /setup check       — Health check');
  lines.push('');
  lines.push('**Browse skills:** /skills');

  return lines.join('\n');
}

function handleCategory(key: string): string {
  const cat = CATEGORIES[key];
  if (!cat) {
    const available = Object.keys(CATEGORIES).join(', ');
    return `Unknown category "${key}". Available: ${available}`;
  }

  const lines = [`**${cat.name} Setup**`, ''];
  lines.push(cat.description);
  lines.push('');

  // Env vars status
  lines.push('**Environment Variables:**');
  for (const v of cat.envVars) {
    const isSet = !!process.env[v.name];
    const req = v.required ? ' (required)' : ' (optional)';
    const status = isSet ? '+' : '-';
    lines.push(`  ${status} ${v.name}${req}`);
    lines.push(`    ${v.description}`);
    if (!isSet) {
      lines.push(`    ${v.example}`);
    }
  }
  lines.push('');

  // Skills in this category
  lines.push('**Available Skills:**');
  for (const s of cat.skills) {
    lines.push(`  ${s.command} — ${s.description}`);
  }
  lines.push('');

  // Quick start
  lines.push('**Try These First:**');
  for (const qs of cat.quickStart) {
    lines.push(`  ${qs}`);
  }

  return lines.join('\n');
}

function handleEnvCheck(): string {
  const lines = ['**Environment Variables Status**', ''];

  const allVars = new Map<string, { description: string; example: string; categories: string[] }>();

  for (const [key, cat] of Object.entries(CATEGORIES)) {
    for (const v of cat.envVars) {
      if (allVars.has(v.name)) {
        allVars.get(v.name)!.categories.push(cat.name);
      } else {
        allVars.set(v.name, { description: v.description, example: v.example, categories: [cat.name] });
      }
    }
  }

  const setVars: string[] = [];
  const missingVars: string[] = [];

  for (const [name, info] of allVars) {
    const isSet = !!process.env[name];
    const cats = info.categories.join(', ');

    if (isSet) {
      setVars.push(`  + ${name} — ${info.description} (${cats})`);
    } else {
      missingVars.push(`  - ${name} — ${info.description} (${cats})`);
      missingVars.push(`    ${info.example}`);
    }
  }

  if (setVars.length > 0) {
    lines.push(`**Configured (${setVars.length}):**`);
    lines.push(setVars.join('\n'));
    lines.push('');
  }

  if (missingVars.length > 0) {
    lines.push(`**Not Set (${allVars.size - setVars.length}):**`);
    lines.push(missingVars.join('\n'));
    lines.push('');
  }

  lines.push(`**Total:** ${setVars.length}/${allVars.size} configured`);

  return lines.join('\n');
}

function handleHealthCheck(): string {
  const lines = ['**Health Check**', ''];

  let readyCount = 0;
  let totalCount = 0;

  for (const [, cat] of Object.entries(CATEGORIES)) {
    for (const s of cat.skills) {
      totalCount++;
      const catDef = cat;
      const requiredVars = catDef.envVars.filter(v => v.required);
      const allSet = requiredVars.every(v => !!process.env[v.name]);
      if (allSet) readyCount++;
    }
  }

  lines.push(`Skills ready: ${readyCount}/${totalCount}`);
  lines.push('');

  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const requiredVars = cat.envVars.filter(v => v.required);
    const allSet = requiredVars.length === 0 || requiredVars.every(v => !!process.env[v.name]);
    const status = allSet ? '+' : '-';

    lines.push(`  ${status} ${cat.name} (${cat.skills.length} skills)`);

    if (!allSet) {
      const missing = requiredVars.filter(v => !process.env[v.name]).map(v => v.name);
      lines.push(`    Missing: ${missing.join(', ')}`);
      lines.push(`    Run: /setup ${key}`);
    }
  }

  lines.push('');
  if (readyCount === totalCount) {
    lines.push('All configured! Run /skills to browse available commands.');
  } else {
    lines.push('Run /setup <category> to configure missing features.');
  }

  return lines.join('\n');
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const skill = {
  name: 'setup',
  description: 'Setup wizard — configure environment for all skills',
  commands: [
    {
      name: 'setup',
      description: 'Setup and configuration wizard',
      usage: '/setup [category]',
    },
  ],

  async handler(args: string): Promise<string> {
    const parts = args.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    try {
      switch (cmd) {
        case 'defi':
        case 'dex':
        case 'evm':
          return handleCategory('defi');
        case 'futures':
        case 'perps':
        case 'cex':
          return handleCategory('futures');
        case 'prediction':
        case 'pred':
        case 'markets':
          return handleCategory('prediction');
        case 'solana':
        case 'sol':
          return handleCategory('solana');
        case 'ai':
        case 'strategy':
        case 'ml':
          return handleCategory('ai');
        case 'env':
        case 'vars':
        case 'envvars':
          return handleEnvCheck();
        case 'check':
        case 'health':
        case 'status':
          return handleHealthCheck();
        case 'help':
        case '':
        case undefined:
        default:
          return handleOverview();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, args }, 'Setup command failed');
      return `Error: ${message}`;
    }
  },
};

export default skill;
