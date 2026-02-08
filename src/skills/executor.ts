/**
 * Skill Executor - Central registry for all 116 bundled CLI skill handlers.
 *
 * ARCHITECTURE:
 * - Each skill lives in src/skills/bundled/<name>/index.ts
 * - Each skill exports default { name, description, commands, handle|handler }
 * - Skills are loaded lazily via dynamic import() on first use
 * - Each skill is loaded in its own try/catch so one broken skill can't crash others
 * - Skills can declare `requires: { env: ['VAR'] }` for pre-flight env checks
 *
 * ADDING A NEW SKILL:
 * 1. Create src/skills/bundled/<name>/index.ts with default export
 * 2. Add the directory name to SKILL_MANIFEST below
 * 3. Run `npx tsc --noEmit` to verify
 *
 * SKILL HANDLER CONTRACT:
 * - `handle(args: string)` receives everything AFTER the command prefix
 *   e.g., "/bf balance" calls handle("balance")
 * - Must return a Promise<string> (the response text)
 * - Both `handle` and `handler` method names are accepted (normalizeSkill handles both)
 * - commands can be string[] or {name, description, usage}[] (normalized to string[])
 *
 * BACKING MODULES:
 * - Most skills wrap real modules in src/ (e.g., execution/, trading/, feeds/, etc.)
 * - Skills use dynamic imports (await import(...)) inside try/catch so the CLI
 *   still works even if a backing module's dependencies aren't installed
 * - When a backing module can't load, the skill falls through to help text
 */

import { logger } from '../utils/logger';

// =============================================================================
// SKILL MANIFEST - all bundled skill directory names
// =============================================================================

const SKILL_MANIFEST: string[] = [
  'acp',
  'agentbets',
  'ai-strategy',
  'alerts',
  'analytics',
  'arbitrage',
  'auto-reply',
  'automation',
  'backtest',
  'bags',
  'bankr',
  'betfair',
  'binance-futures',
  'botchan',
  'bridge',
  'bybit-futures',
  'clanker',
  'copy-trading',
  'copy-trading-solana',
  'credentials',
  'crypto-hft',
  'divergence',
  'doctor',
  'drift',
  'drift-sdk',
  'edge',
  'embeddings',
  'endaoment',
  'ens',
  'erc8004',
  'execution',
  'farcaster',
  'features',
  'feeds',
  'harden',
  'history',
  'hyperliquid',
  'identity',
  'integrations',
  'jupiter',
  'kamino',
  'ledger',
  'lighter',
  'market-index',
  'markets',
  'mcp',
  'memory',
  'metaculus',
  'meteora',
  'meteora-dbc',
  'metrics',
  'mev',
  'mm',
  'mexc-futures',
  'monitoring',
  'news',
  'onchainkit',
  'opinion',
  'opportunity',
  'orca',
  'pairing',
  'pancakeswap',
  'percolator',
  'permissions',
  'plugins',
  'portfolio',
  'portfolio-sync',
  'positions',
  'predictfun',
  'predictit',
  'presence',
  'processes',
  'pump-swarm',
  'pumpfun',
  'qmd',
  'qrcoin',
  'raydium',
  'remote',
  'research',
  'risk',
  'router',
  'routing',
  'sandbox',
  'search-config',
  'sessions',
  'signals',
  'sizing',
  'slippage',
  'smarkets',
  'strategy',
  'streaming',
  'tailscale',
  'ticks',
  'trading-evm',
  'trading-futures',
  'trading-kalshi',
  'trading-manifold',
  'trading-polymarket',
  'trading-solana',
  'trading-system',
  'triggers',
  'tts',
  'tweet-ideas',
  'usage',
  'veil',
  'verify',
  'virtuals',
  'voice',
  'weather',
  'webhooks',
  'whale-tracking',
  'yoink',
  // ── New features (Feb 2026) ──
  'token-security',
  'dca',
  'shield',
  'setup',
];

// =============================================================================
// SKILL CATEGORIES — groups skills for /skills browsing
// =============================================================================

type SkillCategory =
  | 'DeFi & DEX'
  | 'Futures & Perps'
  | 'Prediction Markets'
  | 'Solana DeFi'
  | 'Portfolio & Risk'
  | 'Data & Feeds'
  | 'AI & Strategy'
  | 'Infrastructure'
  | 'Social & Identity'
  | 'Utilities'
  | 'Security';

const SKILL_CATEGORIES: Record<string, SkillCategory> = {
  // DeFi & DEX
  'pancakeswap': 'DeFi & DEX',
  'bridge': 'DeFi & DEX',
  'trading-evm': 'DeFi & DEX',
  'onchainkit': 'DeFi & DEX',
  'ens': 'DeFi & DEX',
  'erc8004': 'DeFi & DEX',
  'endaoment': 'DeFi & DEX',
  'clanker': 'DeFi & DEX',
  'slippage': 'DeFi & DEX',
  'router': 'DeFi & DEX',
  'mev': 'DeFi & DEX',
  'virtuals': 'DeFi & DEX',

  // Futures & Perps
  'hyperliquid': 'Futures & Perps',
  'lighter': 'Futures & Perps',
  'drift': 'Futures & Perps',
  'drift-sdk': 'Futures & Perps',
  'binance-futures': 'Futures & Perps',
  'bybit-futures': 'Futures & Perps',
  'mexc-futures': 'Futures & Perps',
  'trading-futures': 'Futures & Perps',

  // Prediction Markets
  'trading-polymarket': 'Prediction Markets',
  'betfair': 'Prediction Markets',
  'trading-kalshi': 'Prediction Markets',
  'trading-manifold': 'Prediction Markets',
  'predictfun': 'Prediction Markets',
  'predictit': 'Prediction Markets',
  'smarkets': 'Prediction Markets',
  'metaculus': 'Prediction Markets',
  'veil': 'Prediction Markets',
  'agentbets': 'Prediction Markets',
  'opinion': 'Prediction Markets',

  // Solana DeFi
  'jupiter': 'Solana DeFi',
  'raydium': 'Solana DeFi',
  'orca': 'Solana DeFi',
  'meteora': 'Solana DeFi',
  'meteora-dbc': 'Solana DeFi',
  'pumpfun': 'Solana DeFi',
  'pump-swarm': 'Solana DeFi',
  'kamino': 'Solana DeFi',
  'trading-solana': 'Solana DeFi',
  'copy-trading-solana': 'Solana DeFi',

  // Portfolio & Risk
  'portfolio': 'Portfolio & Risk',
  'portfolio-sync': 'Portfolio & Risk',
  'positions': 'Portfolio & Risk',
  'bags': 'Portfolio & Risk',
  'risk': 'Portfolio & Risk',
  'sizing': 'Portfolio & Risk',
  'ledger': 'Portfolio & Risk',
  'history': 'Portfolio & Risk',
  'divergence': 'Portfolio & Risk',
  'edge': 'Portfolio & Risk',
  'dca': 'Portfolio & Risk',

  // Data & Feeds
  'feeds': 'Data & Feeds',
  'markets': 'Data & Feeds',
  'market-index': 'Data & Feeds',
  'news': 'Data & Feeds',
  'ticks': 'Data & Feeds',
  'signals': 'Data & Feeds',
  'whale-tracking': 'Data & Feeds',
  'analytics': 'Data & Feeds',
  'metrics': 'Data & Feeds',
  'weather': 'Data & Feeds',

  // AI & Strategy
  'ai-strategy': 'AI & Strategy',
  'strategy': 'AI & Strategy',
  'arbitrage': 'AI & Strategy',
  'copy-trading': 'AI & Strategy',
  'crypto-hft': 'AI & Strategy',
  'execution': 'AI & Strategy',
  'backtest': 'AI & Strategy',
  'pairing': 'AI & Strategy',
  'mm': 'AI & Strategy',
  'opportunity': 'AI & Strategy',
  'research': 'AI & Strategy',
  'embeddings': 'AI & Strategy',
  'features': 'AI & Strategy',
  'trading-system': 'AI & Strategy',
  'percolator': 'AI & Strategy',

  // Infrastructure
  'credentials': 'Infrastructure',
  'automation': 'Infrastructure',
  'monitoring': 'Infrastructure',
  'alerts': 'Infrastructure',
  'triggers': 'Infrastructure',
  'webhooks': 'Infrastructure',
  'streaming': 'Infrastructure',
  'sessions': 'Infrastructure',
  'remote': 'Infrastructure',
  'mcp': 'Infrastructure',
  'plugins': 'Infrastructure',
  'processes': 'Infrastructure',
  'routing': 'Infrastructure',
  'tailscale': 'Infrastructure',
  'search-config': 'Infrastructure',
  'setup': 'Infrastructure',

  // Social & Identity
  'farcaster': 'Social & Identity',
  'identity': 'Social & Identity',
  'presence': 'Social & Identity',
  'botchan': 'Social & Identity',
  'auto-reply': 'Social & Identity',
  'tweet-ideas': 'Social & Identity',
  'voice': 'Social & Identity',
  'tts': 'Social & Identity',

  // Utilities
  'doctor': 'Utilities',
  'usage': 'Utilities',
  'verify': 'Utilities',
  'sandbox': 'Utilities',
  'permissions': 'Utilities',
  'integrations': 'Utilities',
  'memory': 'Utilities',
  'qmd': 'Utilities',
  'qrcoin': 'Utilities',
  'bankr': 'Utilities',
  'yoink': 'Utilities',
  'acp': 'Utilities',
  'harden': 'Utilities',

  // Security
  'token-security': 'Security',
  'shield': 'Security',
};

// =============================================================================
// COMMAND ALIASES — alternative names that map to real commands
// =============================================================================

const COMMAND_ALIASES: Record<string, string> = {
  '/pancakeswap': '/cake',
  '/pancake': '/cake',
  '/hyperliquid': '/hl',
  '/hyper': '/hl',
  '/polymarket': '/poly',
  '/prediction': '/poly',
  '/uniswap': '/swap',
  '/sushiswap': '/swap',
  '/balance': '/bags',
  '/wallet': '/bags',
  '/pnl': '/positions',
  '/trades': '/history',
  '/arb': '/arbitrage',
  '/hft': '/crypto-hft',
  '/bt': '/backtest',
  '/creds': '/credentials',
  '/keys': '/credentials',
  '/mon': '/monitoring',
  '/pricecheck': '/feeds',
  '/sol': '/trading-solana',
  '/solana': '/trading-solana',
  '/evm': '/trading-evm',
  '/kalshi': '/trading-kalshi',
  '/manifold': '/trading-manifold',
  '/security': '/token-security',
  '/audit': '/token-security',
  '/config': '/setup',
  '/onboard': '/setup',
  '/start': '/setup',
};

// =============================================================================
// ENV VAR DOCUMENTATION — describes what each var is for
// =============================================================================

const ENV_VAR_DOCS: Record<string, { description: string; example: string; url?: string }> = {
  EVM_PRIVATE_KEY: {
    description: 'Private key for EVM chains (ETH, BSC, ARB, Base)',
    example: 'export EVM_PRIVATE_KEY="0xabcdef..."',
  },
  SOLANA_PRIVATE_KEY: {
    description: 'Base58 private key for Solana transactions',
    example: 'export SOLANA_PRIVATE_KEY="5abc..."',
  },
  SOLANA_KEYPAIR_PATH: {
    description: 'Path to Solana keypair JSON file (alternative to SOLANA_PRIVATE_KEY)',
    example: 'export SOLANA_KEYPAIR_PATH="~/.config/solana/id.json"',
  },
  HYPERLIQUID_PRIVATE_KEY: {
    description: 'Private key for Hyperliquid L1',
    example: 'export HYPERLIQUID_PRIVATE_KEY="0xabcdef..."',
  },
  HYPERLIQUID_WALLET: {
    description: 'Wallet address on Hyperliquid (for vault/sub-account trading)',
    example: 'export HYPERLIQUID_WALLET="0x1234..."',
  },
  LIGHTER_API_KEY: {
    description: 'API key for Lighter DEX (optional, increases rate limits)',
    example: 'export LIGHTER_API_KEY="your-api-key"',
    url: 'https://lighter.xyz',
  },
  POLY_API_KEY: {
    description: 'Polymarket CLOB API key',
    example: 'export POLY_API_KEY="your-key"',
    url: 'https://docs.polymarket.com',
  },
  POLY_API_SECRET: {
    description: 'Polymarket CLOB API secret',
    example: 'export POLY_API_SECRET="your-secret"',
  },
  POLY_API_PASSPHRASE: {
    description: 'Polymarket CLOB API passphrase',
    example: 'export POLY_API_PASSPHRASE="your-passphrase"',
  },
  OPENAI_API_KEY: {
    description: 'OpenAI API key for embeddings and AI features',
    example: 'export OPENAI_API_KEY="sk-..."',
    url: 'https://platform.openai.com/api-keys',
  },
  BETFAIR_APP_KEY: {
    description: 'Betfair application key',
    example: 'export BETFAIR_APP_KEY="your-app-key"',
    url: 'https://developer.betfair.com',
  },
  BETFAIR_SESSION_TOKEN: {
    description: 'Betfair session token for authenticated requests',
    example: 'export BETFAIR_SESSION_TOKEN="your-token"',
  },
  BINANCE_API_KEY: {
    description: 'Binance API key for futures trading',
    example: 'export BINANCE_API_KEY="your-key"',
    url: 'https://www.binance.com/en/my/settings/api-management',
  },
  BINANCE_API_SECRET: {
    description: 'Binance API secret',
    example: 'export BINANCE_API_SECRET="your-secret"',
  },
  BYBIT_API_KEY: {
    description: 'Bybit API key for derivatives trading',
    example: 'export BYBIT_API_KEY="your-key"',
    url: 'https://www.bybit.com/app/user/api-management',
  },
  BYBIT_API_SECRET: {
    description: 'Bybit API secret',
    example: 'export BYBIT_API_SECRET="your-secret"',
  },
  MEXC_API_KEY: {
    description: 'MEXC API key for futures trading',
    example: 'export MEXC_API_KEY="your-key"',
    url: 'https://www.mexc.com/user/openapi',
  },
  MEXC_API_SECRET: {
    description: 'MEXC API secret',
    example: 'export MEXC_API_SECRET="your-secret"',
  },
  DRY_RUN: {
    description: 'When "true", simulates trades without executing',
    example: 'export DRY_RUN="true"',
  },
  CLODDS_CREDENTIAL_KEY: {
    description: 'Encryption key for credential storage (AES-256-GCM)',
    example: 'export CLODDS_CREDENTIAL_KEY="your-32-char-key"',
  },
};

// =============================================================================
// SKILL RELATIONS — maps skills to related skills for "See Also"
// =============================================================================

const SKILL_RELATIONS: Record<string, string[]> = {
  'pancakeswap': ['trading-evm', 'bridge', 'bags', 'slippage'],
  'lighter': ['hyperliquid', 'drift', 'trading-futures', 'positions'],
  'hyperliquid': ['lighter', 'drift', 'binance-futures', 'positions', 'copy-trading'],
  'drift': ['hyperliquid', 'lighter', 'trading-solana', 'positions'],
  'trading-polymarket': ['betfair', 'trading-kalshi', 'predictfun', 'feeds', 'arbitrage'],
  'betfair': ['trading-polymarket', 'smarkets', 'trading-kalshi', 'arbitrage'],
  'trading-kalshi': ['trading-polymarket', 'betfair', 'predictit'],
  'jupiter': ['raydium', 'orca', 'trading-solana', 'bags'],
  'raydium': ['jupiter', 'orca', 'meteora', 'pumpfun'],
  'portfolio': ['positions', 'bags', 'history', 'risk'],
  'positions': ['portfolio', 'bags', 'risk', 'history'],
  'bags': ['portfolio', 'positions', 'trading-solana', 'trading-evm'],
  'arbitrage': ['trading-polymarket', 'betfair', 'feeds', 'signals'],
  'bridge': ['trading-evm', 'pancakeswap', 'bags'],
  'credentials': ['setup', 'doctor'],
  'doctor': ['setup', 'credentials', 'monitoring'],
  'copy-trading': ['hyperliquid', 'crypto-hft', 'execution'],
  'binance-futures': ['bybit-futures', 'mexc-futures', 'hyperliquid', 'trading-futures'],
  'bybit-futures': ['binance-futures', 'mexc-futures', 'hyperliquid'],
  'mexc-futures': ['binance-futures', 'bybit-futures', 'hyperliquid'],
  'feeds': ['markets', 'signals', 'news', 'ticks'],
  'signals': ['feeds', 'strategy', 'alerts', 'triggers'],
  'risk': ['sizing', 'portfolio', 'positions'],
  'setup': ['credentials', 'doctor'],
  'token-security': ['shield', 'verify'],
  'shield': ['token-security', 'harden'],
};

// =============================================================================
// TYPES
// =============================================================================

export interface SkillHandler {
  name: string;
  description: string;
  commands: string[] | Array<{ name: string; description: string; usage: string }>;
  /** Handler function (can be named 'handle' or 'handler') */
  handle?: (args: string) => Promise<string>;
  handler?: (args: string) => Promise<string>;
  /** Optional requirements that must be met before the handler runs */
  requires?: {
    env?: string[];
  };
}

/** Normalized skill handler with guaranteed handle function */
interface NormalizedSkillHandler {
  name: string;
  description: string;
  commands: string[];
  handle: (args: string) => Promise<string>;
}

/** Normalize skill handler to consistent interface */
function normalizeSkill(skill: SkillHandler): NormalizedSkillHandler {
  // Normalize commands array (some skills have {name,description,usage} format)
  const commands: string[] = skill.commands.map((cmd) =>
    typeof cmd === 'string' ? cmd : cmd.name
  );

  // Use handle or handler method
  const handleFn = skill.handle || skill.handler;
  if (!handleFn) {
    throw new Error(`Skill ${skill.name} has no handle or handler method`);
  }

  // Wrap handler with env-var requirement checking if declared
  const requiredEnv = skill.requires?.env;
  let wrappedHandle: (args: string) => Promise<string>;

  if (requiredEnv && requiredEnv.length > 0) {
    const boundHandle = handleFn;
    wrappedHandle = async (args: string): Promise<string> => {
      const missing = requiredEnv.filter((v) => !process.env[v]);
      if (missing.length > 0) {
        const lines = [`**${skill.name}** requires configuration:\n`];
        for (const v of missing) {
          const doc = ENV_VAR_DOCS[v];
          if (doc) {
            lines.push(`  ${v} — ${doc.description}`);
            lines.push(`    ${doc.example}`);
            if (doc.url) lines.push(`    Docs: ${doc.url}`);
          } else {
            lines.push(`  ${v}`);
          }
        }
        lines.push('\nSet these in your environment or .env file.');

        // Suggest /setup if available
        const related = SKILL_RELATIONS[skill.name];
        if (related) {
          const suggestions = related.slice(0, 3).map(r => `/${r}`);
          lines.push(`\nSee also: ${suggestions.join(', ')}`);
        }
        lines.push('Run /setup to configure all skills interactively.');
        return lines.join('\n');
      }
      return boundHandle(args);
    };
  } else {
    wrappedHandle = handleFn;
  }

  return {
    name: skill.name,
    description: skill.description,
    commands,
    handle: wrappedHandle,
  };
}

// =============================================================================
// SKILL REGISTRY
// =============================================================================

/** Map of command prefix to skill handler */
const commandToSkill = new Map<string, NormalizedSkillHandler>();

/** All registered skill handlers */
const registeredSkills: NormalizedSkillHandler[] = [];

/** Track which skills failed to load */
const failedSkills: Array<{ name: string; error: string }> = [];

/** Track which skills have env requirements */
const skillRequirements: Map<string, string[]> = new Map();

/**
 * Register a skill handler
 */
function registerSkill(skill: SkillHandler): void {
  try {
    // Track requirements before normalizing
    if (skill.requires?.env) {
      skillRequirements.set(skill.name, skill.requires.env);
    }

    const normalized = normalizeSkill(skill);
    registeredSkills.push(normalized);
    for (const cmd of normalized.commands) {
      const normalizedCmd = cmd.toLowerCase().startsWith('/') ? cmd.toLowerCase() : `/${cmd.toLowerCase()}`;
      commandToSkill.set(normalizedCmd, normalized);
      logger.debug({ skill: normalized.name, command: normalizedCmd }, 'Registered skill command');
    }
  } catch (error) {
    logger.error({ skill: skill.name, error }, 'Failed to register skill');
  }
}

// =============================================================================
// LAZY INITIALIZATION
// =============================================================================

let initialized = false;
let initializing: Promise<void> | null = null;

/**
 * Lazily load and register all skills from SKILL_MANIFEST.
 * Each skill is loaded in its own try/catch so a missing dependency
 * (e.g., viem, @solana/web3.js) only takes down that one skill.
 */
async function initializeSkills(): Promise<void> {
  if (initialized) return;
  if (initializing) return initializing;

  initializing = (async () => {
    const results = await Promise.allSettled(
      SKILL_MANIFEST.map(async (name) => {
        try {
          const mod = await import(`./bundled/${name}/index`);
          const skill = mod.default || mod;
          registerSkill(skill as SkillHandler);
          return { name, ok: true };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          failedSkills.push({ name, error: errorMsg });
          logger.warn({ skill: name, error: errorMsg }, 'Failed to load skill');
          return { name, ok: false };
        }
      })
    );

    const loaded = results.filter(
      (r) => r.status === 'fulfilled' && r.value.ok
    ).length;
    const failed = SKILL_MANIFEST.length - loaded;

    logger.info(
      { loaded, failed, total: SKILL_MANIFEST.length },
      'Skill initialization complete'
    );

    if (failed > 0 && failed !== SKILL_MANIFEST.length) {
      logger.warn(
        { failed, names: failedSkills.map((f) => f.name) },
        'Some skills failed to load (missing dependencies?)'
      );
    }

    // Register the built-in /skills command
    registerBuiltinSkillsCommand();

    initialized = true;
  })();

  return initializing;
}

/**
 * Register the built-in /skills command with categories, search, and status
 */
function registerBuiltinSkillsCommand(): void {
  const skillsHandler: SkillHandler = {
    name: 'skills-status',
    description: 'Browse, search, and check status of all skills',
    commands: ['/skills'],
    handle: async (args: string): Promise<string> => {
      const parts = args.trim().split(/\s+/);
      const subCmd = parts[0]?.toLowerCase();

      // /skills search <query>
      if (subCmd === 'search' || subCmd === 'find' || subCmd === 'grep') {
        const query = parts.slice(1).join(' ').toLowerCase();
        if (!query) return 'Usage: /skills search <query>\nExample: /skills search swap';
        return handleSkillSearch(query);
      }

      // /skills <category>
      if (subCmd && subCmd !== 'status' && subCmd !== 'all' && subCmd !== '') {
        const categories = Object.values(SKILL_CATEGORIES);
        const matchedCat = categories.find(c =>
          c.toLowerCase().includes(subCmd) || c.toLowerCase().replace(/[&\s]/g, '').includes(subCmd)
        );
        if (matchedCat) return handleSkillCategory(matchedCat);

        // Maybe they typed a skill name
        const matchedSkill = registeredSkills.find(s =>
          s.name.includes(subCmd) || s.commands.some(c => c.includes(subCmd))
        );
        if (matchedSkill) return handleSkillInfo(matchedSkill);

        // Fuzzy search fallback
        return handleSkillSearch(subCmd);
      }

      // /skills (default) — categorized overview
      return handleSkillOverview();
    },
  };

  registerSkill(skillsHandler);
}

function handleSkillOverview(): string {
  const lines: string[] = ['**Skills Directory**\n'];

  // Group by category
  const grouped = new Map<SkillCategory, Array<{ name: string; cmds: string[]; ready: boolean }>>();

  for (const skill of registeredSkills) {
    if (skill.name === 'skills-status') continue;
    const cat = SKILL_CATEGORIES[skill.name] || 'Utilities';

    if (!grouped.has(cat as SkillCategory)) {
      grouped.set(cat as SkillCategory, []);
    }

    const reqs = skillRequirements.get(skill.name);
    const ready = !reqs || reqs.length === 0 || reqs.every((v) => !!process.env[v]);

    grouped.get(cat as SkillCategory)!.push({
      name: skill.name,
      cmds: skill.commands,
      ready,
    });
  }

  // Category display order
  const categoryOrder: SkillCategory[] = [
    'Futures & Perps', 'DeFi & DEX', 'Solana DeFi', 'Prediction Markets',
    'AI & Strategy', 'Portfolio & Risk', 'Data & Feeds', 'Security',
    'Infrastructure', 'Social & Identity', 'Utilities',
  ];

  for (const cat of categoryOrder) {
    const skills = grouped.get(cat);
    if (!skills || skills.length === 0) continue;

    const readyCount = skills.filter(s => s.ready).length;
    lines.push(`**${cat}** (${readyCount}/${skills.length} ready)`);

    for (const s of skills) {
      const status = s.ready ? '+' : '-';
      const cmds = s.cmds.map(c => `/${c}`).join(', ');
      lines.push(`  ${status} ${s.name} (${cmds})`);
    }
    lines.push('');
  }

  // Failed skills
  if (failedSkills.length > 0) {
    lines.push(`**Failed to Load** (${failedSkills.length})`);
    for (const f of failedSkills) {
      const shortErr = f.error.length > 60 ? f.error.slice(0, 57) + '...' : f.error;
      lines.push(`  x ${f.name} — ${shortErr}`);
    }
    lines.push('');
  }

  const total = registeredSkills.length - 1;
  lines.push(`**Total:** ${total} loaded, ${failedSkills.length} failed`);
  lines.push('');
  lines.push('**Commands:**');
  lines.push('  /skills <category>        — Browse a category (e.g., /skills defi)');
  lines.push('  /skills search <query>    — Search skills by name or keyword');
  lines.push('  /skills <name>            — Info about a specific skill');
  lines.push('  /setup                    — Configure environment for skills');

  return lines.join('\n');
}

function handleSkillSearch(query: string): string {
  const results: Array<{ name: string; cmds: string[]; desc: string; cat: string }> = [];

  for (const skill of registeredSkills) {
    if (skill.name === 'skills-status') continue;

    const searchable = `${skill.name} ${skill.description} ${skill.commands.join(' ')}`.toLowerCase();
    const cat = SKILL_CATEGORIES[skill.name] || 'Utilities';

    if (searchable.includes(query)) {
      results.push({
        name: skill.name,
        cmds: skill.commands,
        desc: skill.description,
        cat,
      });
    }
  }

  if (results.length === 0) {
    return `No skills found matching "${query}". Try /skills to browse all categories.`;
  }

  const lines = [`**Search results for "${query}"** (${results.length} found)\n`];
  for (const r of results) {
    const cmds = r.cmds.map(c => `/${c}`).join(', ');
    lines.push(`  ${r.name} (${cmds}) — ${r.desc}`);
    lines.push(`    Category: ${r.cat}`);
  }

  return lines.join('\n');
}

function handleSkillCategory(category: SkillCategory): string {
  const skills: Array<{ name: string; cmds: string[]; desc: string; ready: boolean }> = [];

  for (const skill of registeredSkills) {
    if (skill.name === 'skills-status') continue;
    const cat = SKILL_CATEGORIES[skill.name];
    if (cat !== category) continue;

    const reqs = skillRequirements.get(skill.name);
    const ready = !reqs || reqs.length === 0 || reqs.every((v) => !!process.env[v]);

    skills.push({ name: skill.name, cmds: skill.commands, desc: skill.description, ready });
  }

  if (skills.length === 0) {
    return `No skills in category "${category}".`;
  }

  const lines = [`**${category}** (${skills.length} skills)\n`];
  for (const s of skills) {
    const status = s.ready ? '+' : '-';
    const cmds = s.cmds.map(c => `/${c}`).join(', ');
    lines.push(`  ${status} **${s.name}** (${cmds})`);
    lines.push(`    ${s.desc}`);

    const reqs = skillRequirements.get(s.name);
    if (reqs && reqs.length > 0) {
      const missing = reqs.filter(v => !process.env[v]);
      if (missing.length > 0) {
        lines.push(`    Needs: ${missing.join(', ')}`);
      }
    }

    const related = SKILL_RELATIONS[s.name];
    if (related) {
      lines.push(`    See also: ${related.slice(0, 3).map(r => `/${r}`).join(', ')}`);
    }
  }

  return lines.join('\n');
}

function handleSkillInfo(skill: NormalizedSkillHandler): string {
  const lines = [`**${skill.name}**`];
  lines.push(skill.description);
  lines.push('');

  const cat = SKILL_CATEGORIES[skill.name] || 'Utilities';
  lines.push(`Category: ${cat}`);
  lines.push(`Commands: ${skill.commands.map(c => `/${c}`).join(', ')}`);

  const reqs = skillRequirements.get(skill.name);
  if (reqs && reqs.length > 0) {
    const missing = reqs.filter(v => !process.env[v]);
    lines.push('');
    lines.push('**Environment Variables:**');
    for (const v of reqs) {
      const doc = ENV_VAR_DOCS[v];
      const status = process.env[v] ? 'set' : 'MISSING';
      if (doc) {
        lines.push(`  ${status === 'set' ? '+' : '-'} ${v} (${status}) — ${doc.description}`);
        if (status !== 'set') lines.push(`    ${doc.example}`);
      } else {
        lines.push(`  ${status === 'set' ? '+' : '-'} ${v} (${status})`);
      }
    }
  }

  const related = SKILL_RELATIONS[skill.name];
  if (related && related.length > 0) {
    lines.push('');
    lines.push('**Related Skills:**');
    for (const r of related) {
      const relSkill = registeredSkills.find(s => s.name === r);
      if (relSkill) {
        lines.push(`  /${relSkill.commands[0] || r} — ${relSkill.description}`);
      }
    }
  }

  lines.push('');
  lines.push(`Run /${skill.commands[0] || skill.name} help for full command list.`);

  return lines.join('\n');
}

// =============================================================================
// EXECUTOR
// =============================================================================

export interface SkillExecutionResult {
  handled: boolean;
  response?: string;
  error?: string;
  skill?: string;
  /** If set, the command should be dispatched directly to this tool (bypass LLM) */
  dispatch?: {
    tool: string;
    args: string;
    argMode: 'raw' | 'parsed';
  };
}

// =============================================================================
// COMMAND DISPATCH (bypass LLM, route directly to tool)
// =============================================================================

interface DispatchEntry {
  toolName: string;
  argMode: 'raw' | 'parsed';
  skillName: string;
}

/** Map of /command → dispatch target for skills with command-dispatch: tool */
const dispatchMap = new Map<string, DispatchEntry>();

/**
 * Register a SKILL.md skill for direct command dispatch.
 * Called by the SkillManager when loading skills with command-dispatch: tool.
 */
export function registerDispatchSkill(command: string, entry: DispatchEntry): void {
  const normalized = command.toLowerCase().startsWith('/') ? command.toLowerCase() : `/${command.toLowerCase()}`;
  dispatchMap.set(normalized, entry);
  logger.debug({ command: normalized, tool: entry.toolName, skill: entry.skillName }, 'Registered dispatch skill');
}

/**
 * Clear all dispatch skill registrations (called on reload).
 */
export function clearDispatchSkills(): void {
  dispatchMap.clear();
}

/**
 * Get the full skill manifest (list of all bundled skill directory names).
 * Used by MCP server to expose skills as tools.
 */
export function getSkillManifest(): string[] {
  return [...SKILL_MANIFEST];
}

/**
 * Execute a skill command
 *
 * @param message - The full message text (e.g., "/bf balance")
 * @returns Result of execution
 */
export async function executeSkillCommand(message: string): Promise<SkillExecutionResult> {
  // Ensure skills are loaded on first invocation
  await initializeSkills();

  const trimmed = message.trim();

  // Check if it's a command
  if (!trimmed.startsWith('/')) {
    return { handled: false };
  }

  // Parse command and arguments
  const spaceIndex = trimmed.indexOf(' ');
  let command = spaceIndex === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIndex).toLowerCase();
  const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1);

  // Resolve aliases (e.g., /pancakeswap → /cake, /start → /setup)
  if (COMMAND_ALIASES[command]) {
    command = COMMAND_ALIASES[command];
  }

  // Check dispatch map first (command-dispatch: tool skills bypass LLM)
  const dispatch = dispatchMap.get(command);
  if (dispatch) {
    logger.info({ skill: dispatch.skillName, command, tool: dispatch.toolName, args }, 'Dispatching skill directly to tool');
    return {
      handled: true,
      skill: dispatch.skillName,
      dispatch: {
        tool: dispatch.toolName,
        args,
        argMode: dispatch.argMode,
      },
    };
  }

  // Find matching skill handler
  const skill = commandToSkill.get(command);
  if (!skill) {
    return { handled: false };
  }

  try {
    logger.info({ skill: skill.name, command, args }, 'Executing skill command');
    const response = await skill.handle(args);
    return {
      handled: true,
      response,
      skill: skill.name,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ skill: skill.name, command, error: errorMessage }, 'Skill command failed');
    return {
      handled: true,
      error: errorMessage,
      skill: skill.name,
    };
  }
}

/**
 * Get all registered skill handlers
 */
export function getRegisteredSkills(): NormalizedSkillHandler[] {
  return [...registeredSkills];
}

/**
 * Get skill handler by command
 */
export function getSkillByCommand(command: string): NormalizedSkillHandler | undefined {
  let normalized = command.toLowerCase().startsWith('/') ? command.toLowerCase() : `/${command.toLowerCase()}`;
  if (COMMAND_ALIASES[normalized]) normalized = COMMAND_ALIASES[normalized];
  return commandToSkill.get(normalized);
}

/**
 * Check if a command is handled by a skill (handler or dispatch)
 */
export function isSkillCommand(command: string): boolean {
  let normalized = command.toLowerCase().startsWith('/') ? command.toLowerCase() : `/${command.toLowerCase()}`;
  if (COMMAND_ALIASES[normalized]) normalized = COMMAND_ALIASES[normalized];
  return commandToSkill.has(normalized) || dispatchMap.has(normalized);
}

/**
 * Get all registered skill commands
 */
export function getSkillCommands(): Array<{ command: string; skill: string; description: string }> {
  const commands: Array<{ command: string; skill: string; description: string }> = [];
  for (const skill of registeredSkills) {
    for (const cmd of skill.commands) {
      commands.push({
        command: cmd,
        skill: skill.name,
        description: skill.description,
      });
    }
  }
  return commands;
}

/**
 * Get list of failed skills (for diagnostics)
 */
export function getFailedSkills(): Array<{ name: string; error: string }> {
  return [...failedSkills];
}
