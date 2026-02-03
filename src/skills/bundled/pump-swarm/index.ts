/**
 * Pump.fun Swarm Trading Skill
 *
 * Coordinate multiple wallets for synchronized Pump.fun trading.
 */

import {
  PumpFunSwarm,
  getSwarm,
  SwarmTradeParams,
  SwarmTradeResult,
  SwarmWallet,
  ExecutionMode,
  DistributeResult,
  ConsolidateResult,
  QuoteResult,
  SimulationResult,
  StopLossConfig,
  TakeProfitConfig,
  DCAConfig,
  TradeHistoryEntry,
  RebalanceResult,
  SwarmStatus,
} from '../../../solana/pump-swarm';
import {
  getSwarmPresetService,
  SwarmPreset,
  SwarmPresetConfig,
  PresetType,
} from '../../../solana/swarm-presets';
import {
  StrategyBuilder,
  StrategyTemplates,
  StrategyExecutor,
  Strategy,
  StrategyResult,
} from '../../../solana/swarm-strategies';
import {
  SwarmCopyTrader,
  getSwarmCopyTrader,
  CopyTarget,
  CopyConfig,
  CopyResult,
} from '../../../solana/swarm-copytrade';
import { Connection } from '@solana/web3.js';

// Default user ID for CLI usage
const CLI_USER_ID = 'cli_user';

// Lazy-loaded copytrader instance
let copyTraderInstance: SwarmCopyTrader | null = null;
function getCopyTrader(): SwarmCopyTrader {
  if (!copyTraderInstance) {
    const swarm = getSwarm();
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    copyTraderInstance = getSwarmCopyTrader(connection, swarm);
  }
  return copyTraderInstance;
}

// ============================================================================
// Helpers
// ============================================================================

/** Fetch current token price from Jupiter Price API */
async function fetchTokenPrice(mint: string): Promise<number> {
  try {
    const resp = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
    if (resp.ok) {
      const data = await resp.json() as any;
      const price = parseFloat(data?.data?.[mint]?.price);
      if (!isNaN(price) && price > 0) return price;
    }
  } catch {
    // Fall through to quote-based estimate
  }

  // Fallback: use swarm's getQuotes for a tiny amount to derive price
  try {
    const swarm = getSwarm();
    const quote = await (swarm as any).getQuotes?.({
      mint,
      action: 'buy',
      amountPerWallet: 0.001,
    });
    if (quote?.quotes?.[0]?.outputAmount && quote?.quotes?.[0]?.inputAmount) {
      return quote.quotes[0].inputAmount / quote.quotes[0].outputAmount;
    }
  } catch {
    // ignore
  }

  throw new Error(`Could not fetch price for ${mint}. Check the mint address.`);
}

function formatSol(sol: number): string {
  return sol.toFixed(4);
}

function formatTokens(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
  return amount.toFixed(0);
}

function parseWalletIds(arg: string): string[] {
  return arg.split(',').map(s => s.trim()).filter(Boolean);
}

function formatTradeResult(result: SwarmTradeResult): string {
  const successCount = result.walletResults.filter(r => r.success).length;
  const totalCount = result.walletResults.length;

  let output = `**Swarm ${result.action.toUpperCase()} Result**\n\n`;
  output += `Token: \`${result.mint.slice(0, 20)}...\`\n`;
  output += `Status: ${result.success ? '✅ Success' : '❌ Failed'} (${successCount}/${totalCount} wallets)\n`;

  if (result.totalSolSpent) {
    output += `Total SOL: ${formatSol(result.totalSolSpent)}\n`;
  }
  output += `Time: ${result.executionTimeMs}ms\n`;

  output += `Mode: ${result.executionMode}\n`;

  if (result.bundleIds && result.bundleIds.length > 0) {
    if (result.bundleIds.length === 1) {
      output += `Bundle: \`${result.bundleIds[0].slice(0, 20)}...\`\n`;
    } else {
      output += `Bundles: ${result.bundleIds.length} submitted\n`;
    }
  }

  if (result.errors && result.errors.length > 0) {
    output += `\n**Errors:**\n`;
    for (const err of result.errors.slice(0, 5)) {
      output += `  - ${err}\n`;
    }
    if (result.errors.length > 5) {
      output += `  ... and ${result.errors.length - 5} more\n`;
    }
  }

  output += '\n**Wallet Results:**\n';
  for (const wr of result.walletResults) {
    const status = wr.success ? '✅' : '❌';
    output += `${status} **${wr.walletId}** (\`${wr.publicKey.slice(0, 8)}...\`)`;
    if (wr.success && wr.signature) {
      output += ` [tx](https://solscan.io/tx/${wr.signature})`;
    }
    if (wr.error) {
      output += ` - ${wr.error.slice(0, 50)}`;
    }
    output += '\n';
  }

  return output;
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleWallets(): Promise<string> {
  const swarm = getSwarm();
  const wallets = swarm.getWallets();

  if (wallets.length === 0) {
    return `**No Swarm Wallets Configured**

Set up wallets with environment variables:
\`\`\`bash
export SOLANA_PRIVATE_KEY="main-wallet-key"
export SOLANA_SWARM_KEY_1="wallet-2-key"
export SOLANA_SWARM_KEY_2="wallet-3-key"
# ... up to SOLANA_SWARM_KEY_20
\`\`\``;
  }

  const counts = swarm.getWalletCount();
  let output = `**Swarm Wallets (${counts.enabled}/${counts.total} enabled)**\n\n`;

  for (const w of wallets) {
    const status = w.enabled ? '🟢' : '🔴';
    output += `${status} **${w.id}**\n`;
    output += `   \`${w.publicKey}\`\n`;
    output += `   SOL: ${formatSol(w.solBalance)}`;
    if (w.positions.size > 0) {
      output += ` | ${w.positions.size} positions`;
    }
    output += '\n\n';
  }

  output += `_Run \`/swarm balances\` to refresh SOL balances_`;
  return output;
}

async function handleBalances(): Promise<string> {
  const swarm = getSwarm();
  const wallets = swarm.getWallets();

  if (wallets.length === 0) {
    return 'No swarm wallets configured. Set SOLANA_PRIVATE_KEY and SOLANA_SWARM_KEY_N env vars.';
  }

  let output = '**Fetching balances from chain...**\n\n';
  const balances = await swarm.refreshBalances();

  let totalSol = 0;
  for (const [id, balance] of balances) {
    const wallet = swarm.getWallet(id);
    const status = wallet?.enabled ? '🟢' : '🔴';
    output += `${status} ${id}: **${formatSol(balance)} SOL**\n`;
    totalSol += balance;
  }

  output += `\n**Total: ${formatSol(totalSol)} SOL** across ${balances.size} wallets`;
  return output;
}

async function handleRefresh(mint: string): Promise<string> {
  if (!mint) return 'Usage: /swarm refresh <mint>\n\nRefreshes token positions from chain for all wallets.';

  const swarm = getSwarm();

  let output = `**Refreshing positions for \`${mint.slice(0, 20)}...\`**\n\n`;
  const position = await swarm.refreshTokenPositions(mint);

  if (position.totalTokens === 0) {
    return output + 'No positions found across any wallets.';
  }

  output += `**Total: ${formatTokens(position.totalTokens)} tokens**\n\n`;
  output += `**By Wallet:**\n`;

  for (const [walletId, amount] of position.byWallet) {
    const pct = (amount / position.totalTokens * 100).toFixed(1);
    output += `  ${walletId}: ${formatTokens(amount)} (${pct}%)\n`;
  }

  return output;
}

async function handleEnable(walletId: string): Promise<string> {
  if (!walletId) return 'Usage: /swarm enable <wallet_id>';

  const swarm = getSwarm();
  const wallet = swarm.getWallet(walletId);

  if (!wallet) {
    const wallets = swarm.getWallets();
    return `Wallet "${walletId}" not found.\n\nAvailable: ${wallets.map(w => w.id).join(', ')}`;
  }

  swarm.enableWallet(walletId);
  return `✅ Wallet **${walletId}** enabled for trading.`;
}

async function handleDisable(walletId: string): Promise<string> {
  if (!walletId) return 'Usage: /swarm disable <wallet_id>';

  const swarm = getSwarm();
  const wallet = swarm.getWallet(walletId);

  if (!wallet) {
    return `Wallet "${walletId}" not found.`;
  }

  swarm.disableWallet(walletId);
  return `🔴 Wallet **${walletId}** disabled. Will not participate in trades.`;
}

async function handleBuy(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `**Usage:** /swarm buy <mint> <sol_per_wallet> [options]

**Options:**
  --preset <name>          Apply a saved preset
  --wallets <id1,id2,...>  Use specific wallets only
  --parallel               Parallel execution (fastest, default >5 wallets)
  --bundle                 Single Jito bundle (atomic, max 5 wallets)
  --multi-bundle           Multiple Jito bundles in parallel (>5 wallets)
  --sequential             Sequential execution (staggered, stealthy)
  --slippage <bps>         Slippage tolerance (default: 500 = 5%)
  --pool <pool>            Pool: pump, raydium, auto (pumpfun only)
  --dex <dex>              DEX: pumpfun (default), bags, meteora
  --pool-address <addr>    Specific pool address (for Meteora)

**Examples:**
  /swarm buy ABC123... 0.1
  /swarm buy ABC123... 0.05 --wallets wallet_0,wallet_1
  /swarm buy ABC123... 0.1 --multi-bundle --slippage 1000
  /swarm buy ABC123... 0.1 --preset stealth
  /swarm buy ABC123... 0.1 --dex bags
  /swarm buy ABC123... 0.1 --dex meteora --pool-address <pool>`;
  }

  const mint = args[0];
  const amountPerWallet = parseFloat(args[1]);

  if (isNaN(amountPerWallet) || amountPerWallet <= 0) {
    return '❌ Invalid amount. Must be a positive number (SOL per wallet).';
  }

  if (amountPerWallet > 10) {
    return '❌ Amount too high. Max 10 SOL per wallet for safety.';
  }

  // Parse options
  let walletIds: string[] | undefined;
  let executionMode: ExecutionMode | undefined;
  let slippageBps: number | undefined;
  let pool: string | undefined;
  let presetName: string | undefined;
  let dex: 'pumpfun' | 'bags' | 'meteora' | 'auto' | undefined;
  let poolAddress: string | undefined;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--wallets' && args[i + 1]) {
      walletIds = parseWalletIds(args[++i]);
    } else if (args[i] === '--preset' && args[i + 1]) {
      presetName = args[++i];
    } else if (args[i] === '--parallel') {
      executionMode = 'parallel';
    } else if (args[i] === '--bundle') {
      executionMode = 'bundle';
    } else if (args[i] === '--multi-bundle') {
      executionMode = 'multi-bundle';
    } else if (args[i] === '--sequential') {
      executionMode = 'sequential';
    } else if (args[i] === '--slippage' && args[i + 1]) {
      slippageBps = parseInt(args[++i]);
    } else if (args[i] === '--pool' && args[i + 1]) {
      pool = args[++i];
    } else if (args[i] === '--dex' && args[i + 1]) {
      const d = args[++i].toLowerCase();
      if (d === 'pumpfun' || d === 'bags' || d === 'meteora' || d === 'auto') {
        dex = d;
      }
    } else if ((args[i] === '--pool-address' || args[i] === '--pool_address') && args[i + 1]) {
      poolAddress = args[++i];
    }
  }

  const swarm = getSwarm();
  const counts = swarm.getWalletCount();

  if (counts.enabled === 0) {
    return '❌ No enabled wallets. Run `/swarm wallets` to check status.';
  }

  // Build base params
  let params: SwarmTradeParams = {
    mint,
    action: 'buy',
    amountPerWallet,
    denominatedInSol: true,
    slippageBps,
    pool,
    executionMode,
    walletIds,
    dex,
    poolAddress,
  };

  // Apply preset if specified
  if (presetName) {
    const presetService = getSwarmPresetService();
    const preset = await presetService.get(CLI_USER_ID, presetName);
    if (!preset) {
      return `❌ Preset "${presetName}" not found. Run \`/swarm preset list\` to see available presets.`;
    }
    params = presetService.applyToParams(preset, params);
  }

  const walletCount = params.walletIds?.length || counts.enabled;
  const totalSol = (typeof params.amountPerWallet === 'number' ? params.amountPerWallet : parseFloat(params.amountPerWallet as string)) * walletCount;
  let output = `**Swarm Buy**\n\n`;
  output += `Token: \`${mint}\`\n`;
  output += `Amount: **${formatSol(typeof params.amountPerWallet === 'number' ? params.amountPerWallet : parseFloat(params.amountPerWallet as string))} SOL** per wallet\n`;
  output += `Wallets: ${walletCount}\n`;
  output += `Max Total: ~${formatSol(totalSol)} SOL\n`;
  if (params.dex && params.dex !== 'pumpfun') {
    output += `DEX: **${params.dex}**\n`;
  }
  if (presetName) {
    output += `Preset: **${presetName}**\n`;
  }
  output += `\n_Executing..._\n\n`;

  const result = await swarm.coordinatedBuy(params);

  return output + formatTradeResult(result);
}

async function handleSell(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `**Usage:** /swarm sell <mint> <amount|%> [options]

**Amount formats:**
  - Percentage: "100%" or "50%" (of each wallet's position)
  - Tokens: exact token amount per wallet

**Options:**
  --preset <name>          Apply a saved preset
  --wallets <id1,id2,...>  Use specific wallets only
  --parallel               Parallel execution (fastest, default >5 wallets)
  --bundle                 Single Jito bundle (atomic, max 5 wallets)
  --multi-bundle           Multiple Jito bundles in parallel (>5 wallets)
  --sequential             Sequential execution (staggered, stealthy)
  --slippage <bps>         Slippage tolerance (default: 500 = 5%)
  --pool <pool>            Pool: pump, raydium, auto (pumpfun only)
  --dex <dex>              DEX: pumpfun (default), bags, meteora
  --pool-address <addr>    Specific pool address (for Meteora)

**Examples:**
  /swarm sell ABC123... 100%
  /swarm sell ABC123... 50% --multi-bundle
  /swarm sell ABC123... 1000000 --sequential
  /swarm sell ABC123... 100% --preset stealth
  /swarm sell ABC123... 100% --dex bags`;
  }

  const mint = args[0];
  const amountArg = args[1];

  // Parse options
  let walletIds: string[] | undefined;
  let executionMode: ExecutionMode | undefined;
  let slippageBps: number | undefined;
  let pool: string | undefined;
  let presetName: string | undefined;
  let dex: 'pumpfun' | 'bags' | 'meteora' | 'auto' | undefined;
  let poolAddress: string | undefined;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--wallets' && args[i + 1]) {
      walletIds = parseWalletIds(args[++i]);
    } else if (args[i] === '--preset' && args[i + 1]) {
      presetName = args[++i];
    } else if (args[i] === '--parallel') {
      executionMode = 'parallel';
    } else if (args[i] === '--bundle') {
      executionMode = 'bundle';
    } else if (args[i] === '--multi-bundle') {
      executionMode = 'multi-bundle';
    } else if (args[i] === '--sequential') {
      executionMode = 'sequential';
    } else if (args[i] === '--slippage' && args[i + 1]) {
      slippageBps = parseInt(args[++i]);
    } else if (args[i] === '--pool' && args[i + 1]) {
      pool = args[++i];
    } else if (args[i] === '--dex' && args[i + 1]) {
      const d = args[++i].toLowerCase();
      if (d === 'pumpfun' || d === 'bags' || d === 'meteora' || d === 'auto') {
        dex = d;
      }
    } else if ((args[i] === '--pool-address' || args[i] === '--pool_address') && args[i + 1]) {
      poolAddress = args[++i];
    }
  }

  const swarm = getSwarm();

  // Build base params
  let params: SwarmTradeParams = {
    mint,
    action: 'sell',
    amountPerWallet: amountArg,
    denominatedInSol: false,
    slippageBps,
    pool,
    executionMode,
    walletIds,
    dex,
    poolAddress,
  };

  // Apply preset if specified
  if (presetName) {
    const presetService = getSwarmPresetService();
    const preset = await presetService.get(CLI_USER_ID, presetName);
    if (!preset) {
      return `❌ Preset "${presetName}" not found. Run \`/swarm preset list\` to see available presets.`;
    }
    params = presetService.applyToParams(preset, params);
  }

  let output = `**Swarm Sell**\n\n`;
  output += `Token: \`${mint}\`\n`;
  output += `Amount: **${amountArg}** per wallet\n`;
  if (params.dex && params.dex !== 'pumpfun') {
    output += `DEX: **${params.dex}**\n`;
  }
  if (presetName) {
    output += `Preset: **${presetName}**\n`;
  }
  output += `\n_Fetching positions and executing..._\n\n`;

  const result = await swarm.coordinatedSell(params);

  return output + formatTradeResult(result);
}

async function handlePosition(mint: string): Promise<string> {
  if (!mint) {
    return `**Usage:** /swarm position <mint>

Shows cached token positions. Use \`/swarm refresh <mint>\` to fetch fresh data from chain.`;
  }

  const swarm = getSwarm();
  const position = swarm.getSwarmPosition(mint);

  if (position.totalTokens === 0) {
    return `No cached position for \`${mint.slice(0, 30)}...\`

Run \`/swarm refresh ${mint}\` to fetch from chain.`;
  }

  let output = `**Swarm Position**\n\n`;
  output += `Token: \`${mint}\`\n`;
  output += `Total: **${formatTokens(position.totalTokens)}** tokens\n\n`;
  output += `**By Wallet:**\n`;

  for (const [walletId, amount] of position.byWallet) {
    const pct = (amount / position.totalTokens * 100).toFixed(1);
    output += `  ${walletId}: ${formatTokens(amount)} (${pct}%)\n`;
  }

  output += `\n_Last updated: ${new Date(position.lastUpdated).toLocaleTimeString()}_`;
  return output;
}

// ============================================================================
// Preset Command Handlers
// ============================================================================

async function handlePreset(args: string[]): Promise<string> {
  const subcommand = args[0]?.toLowerCase() || 'help';
  const rest = args.slice(1);

  switch (subcommand) {
    case 'save':
      return await handlePresetSave(rest);
    case 'list':
    case 'ls':
      return await handlePresetList(rest[0]);
    case 'show':
    case 'get':
      return await handlePresetShow(rest[0]);
    case 'delete':
    case 'rm':
      return await handlePresetDelete(rest[0]);
    case 'help':
    default:
      return handlePresetHelp();
  }
}

function handlePresetHelp(): string {
  return `**Swarm Presets**

Save and reuse trading configurations.

**Commands:**
  /swarm preset save <name> [opts]   Save a preset
  /swarm preset list [type]          List presets (strategy|token|wallet_group)
  /swarm preset show <name>          Show preset details
  /swarm preset delete <name>        Delete a preset

**Save Options:**
  --type <type>              Preset type: strategy, token, wallet_group
  --desc "description"       Preset description
  --mint <address>           Token address (for token type)
  --amount <sol>             Default SOL per wallet
  --slippage <bps>           Slippage in basis points
  --pool <pump|raydium|auto> Pool preference
  --mode <mode>              parallel|bundle|multi-bundle|sequential
  --wallets <id1,id2,...>    Wallet IDs (for wallet_group type)

**Built-in Presets:**
  fast        Parallel, 5% slippage, auto pool
  atomic      Multi-bundle, 5% slippage
  stealth     Sequential, 3% slippage, 10% variance
  aggressive  Parallel, 10% slippage, pump pool
  safe        Bundle, 2% slippage

**Examples:**
  /swarm preset save my_stealth --type strategy --mode sequential --slippage 300
  /swarm preset save bonk_snipe --type token --mint DezXAZ... --slippage 1000
  /swarm preset save top5 --type wallet_group --wallets wallet_0,wallet_1,wallet_2
  /swarm buy ABC... 0.1 --preset my_stealth`;
}

async function handlePresetSave(args: string[]): Promise<string> {
  if (args.length === 0) {
    return 'Usage: /swarm preset save <name> [--type <type>] [--desc "..."] [options]';
  }

  const name = args[0];
  let type: PresetType = 'strategy';
  let description: string | undefined;
  let mint: string | undefined;
  let amountPerWallet: number | undefined;
  let slippageBps: number | undefined;
  let pool: 'pump' | 'raydium' | 'auto' | undefined;
  let executionMode: ExecutionMode | undefined;
  let walletIds: string[] | undefined;
  let dex: 'pumpfun' | 'bags' | 'meteora' | 'auto' | undefined;
  let poolAddress: string | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--type' && args[i + 1]) {
      const t = args[++i].toLowerCase();
      if (t === 'strategy' || t === 'token' || t === 'wallet_group') {
        type = t;
      }
    } else if ((arg === '--desc' || arg === '--description') && args[i + 1]) {
      description = args[++i];
    } else if (arg === '--mint' && args[i + 1]) {
      mint = args[++i];
    } else if (arg === '--amount' && args[i + 1]) {
      amountPerWallet = parseFloat(args[++i]);
    } else if (arg === '--slippage' && args[i + 1]) {
      slippageBps = parseInt(args[++i]);
    } else if (arg === '--pool' && args[i + 1]) {
      const p = args[++i].toLowerCase();
      if (p === 'pump' || p === 'raydium' || p === 'auto') {
        pool = p;
      }
    } else if (arg === '--mode' && args[i + 1]) {
      const m = args[++i].toLowerCase();
      if (m === 'parallel' || m === 'bundle' || m === 'multi-bundle' || m === 'sequential') {
        executionMode = m as ExecutionMode;
      }
    } else if (arg === '--wallets' && args[i + 1]) {
      walletIds = parseWalletIds(args[++i]);
    } else if (arg === '--dex' && args[i + 1]) {
      const d = args[++i].toLowerCase();
      if (d === 'pumpfun' || d === 'bags' || d === 'meteora' || d === 'auto') {
        dex = d;
      }
    } else if (arg === '--pool-address' && args[i + 1]) {
      poolAddress = args[++i];
    } else if (arg === '--parallel') {
      executionMode = 'parallel';
    } else if (arg === '--bundle') {
      executionMode = 'bundle';
    } else if (arg === '--multi-bundle') {
      executionMode = 'multi-bundle';
    } else if (arg === '--sequential') {
      executionMode = 'sequential';
    }
  }

  // Build config
  const config: SwarmPresetConfig = {};
  if (mint) config.mint = mint;
  if (amountPerWallet !== undefined && !isNaN(amountPerWallet)) config.amountPerWallet = amountPerWallet;
  if (slippageBps !== undefined && !isNaN(slippageBps)) config.slippageBps = slippageBps;
  if (pool) config.pool = pool;
  if (executionMode) config.executionMode = executionMode;
  if (walletIds && walletIds.length > 0) config.walletIds = walletIds;
  if (dex) config.dex = dex;
  if (poolAddress) config.poolAddress = poolAddress;

  if (Object.keys(config).length === 0) {
    return '❌ No configuration provided. Use --slippage, --mode, --pool, --dex, etc.';
  }

  const presetService = getSwarmPresetService();

  try {
    const preset = await presetService.create(CLI_USER_ID, {
      name,
      type,
      description,
      config,
    });

    let output = `✅ **Preset "${preset.name}" saved**\n\n`;
    output += `Type: ${preset.type}\n`;
    if (description) output += `Description: ${description}\n`;
    output += `\n**Settings:**\n`;
    for (const [key, value] of Object.entries(config)) {
      output += `  ${key}: ${Array.isArray(value) ? value.join(', ') : value}\n`;
    }
    return output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE constraint')) {
      return `❌ Preset "${name}" already exists. Delete it first with \`/swarm preset delete ${name}\``;
    }
    return `❌ Failed to save preset: ${msg}`;
  }
}

async function handlePresetList(typeFilter?: string): Promise<string> {
  const presetService = getSwarmPresetService();

  let type: PresetType | undefined;
  if (typeFilter) {
    const t = typeFilter.toLowerCase();
    if (t === 'strategy' || t === 'token' || t === 'wallet_group') {
      type = t;
    }
  }

  const presets = await presetService.list(CLI_USER_ID, type);

  if (presets.length === 0) {
    return type
      ? `No ${type} presets found.`
      : 'No presets found. Use `/swarm preset save <name>` to create one.';
  }

  let output = '**Swarm Presets**\n\n';

  // Group by type
  const byType = new Map<string, SwarmPreset[]>();
  for (const preset of presets) {
    const list = byType.get(preset.type) || [];
    list.push(preset);
    byType.set(preset.type, list);
  }

  for (const [presetType, list] of Array.from(byType.entries())) {
    output += `**${presetType.toUpperCase()}:**\n`;
    for (const preset of list) {
      const isBuiltin = preset.userId === 'system';
      const badge = isBuiltin ? ' (built-in)' : '';
      output += `  **${preset.name}**${badge}`;
      if (preset.description) {
        output += ` - ${preset.description}`;
      }
      output += '\n';
    }
    output += '\n';
  }

  return output.trim();
}

async function handlePresetShow(name: string): Promise<string> {
  if (!name) {
    return 'Usage: /swarm preset show <name>';
  }

  const presetService = getSwarmPresetService();
  const preset = await presetService.get(CLI_USER_ID, name);

  if (!preset) {
    return `❌ Preset "${name}" not found.`;
  }

  const isBuiltin = preset.userId === 'system';
  let output = `**Preset: ${preset.name}**${isBuiltin ? ' (built-in)' : ''}\n\n`;
  output += `Type: ${preset.type}\n`;
  if (preset.description) {
    output += `Description: ${preset.description}\n`;
  }
  output += `\n**Configuration:**\n`;

  const config = preset.config;
  if (config.mint) output += `  mint: ${config.mint}\n`;
  if (config.amountPerWallet !== undefined) output += `  amountPerWallet: ${config.amountPerWallet}\n`;
  if (config.slippageBps !== undefined) output += `  slippage: ${config.slippageBps} bps (${(config.slippageBps / 100).toFixed(1)}%)\n`;
  if (config.pool) output += `  pool: ${config.pool}\n`;
  if (config.executionMode) output += `  executionMode: ${config.executionMode}\n`;
  if (config.walletIds && config.walletIds.length > 0) output += `  wallets: ${config.walletIds.join(', ')}\n`;
  if (config.amountVariancePct !== undefined) output += `  amountVariance: ${config.amountVariancePct}%\n`;

  if (!isBuiltin) {
    output += `\nCreated: ${preset.createdAt.toLocaleDateString()}`;
  }

  return output;
}

async function handlePresetDelete(name: string): Promise<string> {
  if (!name) {
    return 'Usage: /swarm preset delete <name>';
  }

  const presetService = getSwarmPresetService();

  try {
    const deleted = await presetService.delete(CLI_USER_ID, name);
    if (deleted) {
      return `✅ Preset "${name}" deleted.`;
    } else {
      return `❌ Preset "${name}" not found.`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ ${msg}`;
  }
}

// ============================================================================
// Strategy Handlers - Smart Multi-Step Execution
// ============================================================================

// Track active strategies for status/cancel
const activeStrategies: Map<string, { strategy: Strategy; executor: StrategyExecutor }> = new Map();

async function handleStrategy(args: string[]): Promise<string> {
  const subCommand = args[0]?.toLowerCase();
  const rest = args.slice(1);

  switch (subCommand) {
    case 'scale-in':
    case 'scalein':
      return await handleStrategyScaleIn(rest);
    case 'scale-out':
    case 'scaleout':
      return await handleStrategyScaleOut(rest);
    case 'snipe':
      return await handleStrategySnipe(rest);
    case 'twap':
      return await handleStrategyTWAP(rest);
    case 'ladder':
      return await handleStrategyLadder(rest);
    case 'dca-smart':
      return await handleStrategyDCA(rest);
    case 'split':
      return await handleStrategySplit(rest);
    case 'rotation':
    case 'rotate':
      return await handleStrategyRotation(rest);
    case 'list':
    case 'active':
      return handleStrategyList();
    case 'cancel':
      return handleStrategyCancel(rest[0]);
    case 'pause':
      return handleStrategyPause(rest[0]);
    case 'resume':
      return handleStrategyResume(rest[0]);
    default:
      return `**Swarm Smart Strategies**

Execute complex multi-step trading strategies across your swarm.

**Available Strategies:**

**Scale-In** - Buy gradually at lower prices:
  /swarm strategy scale-in <mint> <total_sol> <levels> <drop%>
  Example: /swarm strategy scale-in ABC... 1.0 4 5
  Buys 25% now, then 25% at each 5% price drop (4 levels total)

**Scale-Out** - Sell gradually at higher prices:
  /swarm strategy scale-out <mint> <levels> <rise%>
  Example: /swarm strategy scale-out ABC... 4 25
  Sells 25% at +25%, +50%, +75%, +100%

**Snipe + Exit** - Fast entry with automatic TP/SL:
  /swarm strategy snipe <mint> <sol> <tp%> <sl%>
  Example: /swarm strategy snipe ABC... 0.5 50 20
  Buys immediately, auto-sells at +50% profit or -20% loss

**TWAP** - Time-weighted average execution:
  /swarm strategy twap <mint> <buy|sell> <total> <intervals> <delay>
  Example: /swarm strategy twap ABC... buy 1.0 10 5m
  Buys 0.1 SOL every 5 minutes, 10 times

**Ladder Buy** - Set multiple buy orders at price levels:
  /swarm strategy ladder <mint> <total_sol> <levels> <drop%>
  Example: /swarm strategy ladder ABC... 0.5 5 3
  Buys at current, -3%, -6%, -9%, -12%

**Split** - Different wallets do different actions:
  /swarm strategy split <mint> <buy_wallets> <sell_wallets> <buy_amt> <sell_amt>
  Example: /swarm strategy split ABC... wallet_0,wallet_1 wallet_2,wallet_3 0.1 50%
  Some wallets buy, others sell simultaneously

**Rotation** - Exit one token, enter another:
  /swarm strategy rotation <exit_mint> <enter_mint> <sell%>
  Example: /swarm strategy rotation ABC... XYZ... 100
  Sells 100% of ABC, uses proceeds to buy XYZ

**Control:**
  /swarm strategy list           List active strategies
  /swarm strategy cancel <id>    Cancel a running strategy
  /swarm strategy pause <id>     Pause a strategy
  /swarm strategy resume <id>    Resume a paused strategy`;
  }
}

async function handleStrategyScaleIn(args: string[]): Promise<string> {
  if (args.length < 4) {
    return `**Scale-In Strategy**

Buy gradually at lower price levels.

**Usage:** /swarm strategy scale-in <mint> <total_sol> <levels> <drop_percent>

**Parameters:**
  mint         Token mint address
  total_sol    Total SOL to spend across all levels
  levels       Number of buy levels (2-10)
  drop_percent Price drop % between levels

**Example:**
  /swarm strategy scale-in ABC... 1.0 4 5

  Level 1: Buy 0.25 SOL now
  Level 2: Buy 0.25 SOL if price drops 5%
  Level 3: Buy 0.25 SOL if price drops 10%
  Level 4: Buy 0.25 SOL if price drops 15%`;
  }

  const [mint, totalSolStr, levelsStr, dropStr] = args;
  const totalSol = parseFloat(totalSolStr);
  const levels = parseInt(levelsStr);
  const dropPercent = parseFloat(dropStr);

  if (isNaN(totalSol) || totalSol <= 0) return '❌ Invalid total SOL amount';
  if (isNaN(levels) || levels < 2 || levels > 10) return '❌ Levels must be 2-10';
  if (isNaN(dropPercent) || dropPercent <= 0) return '❌ Invalid drop percent';

  // Build price levels
  const priceLevels = [];
  const percentPerLevel = 100 / levels;
  for (let i = 0; i < levels; i++) {
    priceLevels.push({ price: 100 - (i * dropPercent), percent: percentPerLevel });
  }

  const currentPrice = await fetchTokenPrice(mint);

  const strategy = StrategyTemplates.scaleIn(mint, totalSol, priceLevels, currentPrice);

  // Execute
  const swarm = getSwarm();
  const executor = new StrategyExecutor(swarm);
  activeStrategies.set(strategy.id, { strategy, executor });

  // Run async
  executor.execute(strategy).then(result => {
    activeStrategies.delete(strategy.id);
  });

  return `**Scale-In Strategy Started**

ID: \`${strategy.id}\`
Token: \`${mint.slice(0, 20)}...\`
Total: ${totalSol} SOL across ${levels} levels
Drop between levels: ${dropPercent}%

Strategy will buy:
${priceLevels.map((l, i) => `  Level ${i + 1}: ${(totalSol * l.percent / 100).toFixed(4)} SOL at ${i === 0 ? 'current price' : `-${i * dropPercent}%`}`).join('\n')}

Use \`/swarm strategy list\` to check status.
Use \`/swarm strategy cancel ${strategy.id.slice(0, 12)}\` to stop.`;
}

async function handleStrategyScaleOut(args: string[]): Promise<string> {
  if (args.length < 3) {
    return `**Scale-Out Strategy**

Sell gradually at higher price levels.

**Usage:** /swarm strategy scale-out <mint> <levels> <rise_percent>

**Example:**
  /swarm strategy scale-out ABC... 4 25
  Sells 25% at +25%, 25% at +50%, 25% at +75%, 25% at +100%`;
  }

  const [mint, levelsStr, riseStr] = args;
  const levels = parseInt(levelsStr);
  const risePercent = parseFloat(riseStr);

  if (isNaN(levels) || levels < 2 || levels > 10) return '❌ Levels must be 2-10';
  if (isNaN(risePercent) || risePercent <= 0) return '❌ Invalid rise percent';

  const priceLevels = [];
  const percentPerLevel = 100 / levels;
  for (let i = 1; i <= levels; i++) {
    priceLevels.push({ price: i * risePercent, percent: percentPerLevel });
  }

  const currentPrice = await fetchTokenPrice(mint);
  const strategy = StrategyTemplates.scaleOut(mint, priceLevels, currentPrice);

  const swarm = getSwarm();
  const executor = new StrategyExecutor(swarm);
  activeStrategies.set(strategy.id, { strategy, executor });

  executor.execute(strategy).then(() => activeStrategies.delete(strategy.id));

  return `**Scale-Out Strategy Started**

ID: \`${strategy.id}\`
Token: \`${mint.slice(0, 20)}...\`
Levels: ${levels} sell points

Will sell:
${priceLevels.map((l, i) => `  Level ${i + 1}: ${l.percent.toFixed(0)}% at +${l.price}%`).join('\n')}

Use \`/swarm strategy cancel ${strategy.id.slice(0, 12)}\` to stop.`;
}

async function handleStrategySnipe(args: string[]): Promise<string> {
  if (args.length < 4) {
    return `**Snipe + Exit Strategy**

Fast entry with automatic take-profit and stop-loss.

**Usage:** /swarm strategy snipe <mint> <sol> <tp_percent> <sl_percent>

**Example:**
  /swarm strategy snipe ABC... 0.5 50 20
  Buys 0.5 SOL immediately
  Auto-sells all at +50% profit OR -20% loss (whichever hits first)`;
  }

  const [mint, solStr, tpStr, slStr] = args;
  const sol = parseFloat(solStr);
  const tp = parseFloat(tpStr);
  const sl = parseFloat(slStr);

  if (isNaN(sol) || sol <= 0) return '❌ Invalid SOL amount';
  if (isNaN(tp) || tp <= 0) return '❌ Invalid take-profit percent';
  if (isNaN(sl) || sl <= 0) return '❌ Invalid stop-loss percent';

  const currentPrice = await fetchTokenPrice(mint);
  const strategy = StrategyTemplates.snipeExit(mint, sol, tp, sl, currentPrice);

  const swarm = getSwarm();
  const executor = new StrategyExecutor(swarm);
  activeStrategies.set(strategy.id, { strategy, executor });

  executor.execute(strategy).then(() => activeStrategies.delete(strategy.id));

  return `**Snipe + Exit Strategy Started**

ID: \`${strategy.id}\`
Token: \`${mint.slice(0, 20)}...\`

Entry: ${sol} SOL (executing now...)
Take Profit: +${tp}%
Stop Loss: -${sl}%

Strategy will auto-exit at whichever level hits first.`;
}

async function handleStrategyTWAP(args: string[]): Promise<string> {
  if (args.length < 5) {
    return `**TWAP Strategy**

Time-Weighted Average Price - split order over time.

**Usage:** /swarm strategy twap <mint> <buy|sell> <total_amount> <intervals> <delay>

**Delay formats:** 30s, 5m, 1h

**Example:**
  /swarm strategy twap ABC... buy 1.0 10 5m
  Buys 0.1 SOL every 5 minutes, 10 times total`;
  }

  const [mint, action, amountStr, intervalsStr, delayStr] = args;
  const amount = parseFloat(amountStr);
  const intervals = parseInt(intervalsStr);

  if (!['buy', 'sell'].includes(action.toLowerCase())) return '❌ Action must be buy or sell';
  if (isNaN(amount) || amount <= 0) return '❌ Invalid amount';
  if (isNaN(intervals) || intervals < 2 || intervals > 100) return '❌ Intervals must be 2-100';

  // Parse delay
  let delayMs = 60000;
  const delayMatch = delayStr.match(/^(\d+)(s|m|h)$/i);
  if (delayMatch) {
    const num = parseInt(delayMatch[1]);
    const unit = delayMatch[2].toLowerCase();
    if (unit === 's') delayMs = num * 1000;
    else if (unit === 'm') delayMs = num * 60 * 1000;
    else if (unit === 'h') delayMs = num * 60 * 60 * 1000;
  }

  const strategy = StrategyTemplates.twap(mint, action.toLowerCase() as 'buy' | 'sell', amount, intervals, delayMs);

  const swarm = getSwarm();
  const executor = new StrategyExecutor(swarm);
  activeStrategies.set(strategy.id, { strategy, executor });

  executor.execute(strategy).then(() => activeStrategies.delete(strategy.id));

  const amountPer = amount / intervals;
  const totalTime = (intervals - 1) * delayMs;
  const totalTimeStr = totalTime >= 3600000
    ? `${(totalTime / 3600000).toFixed(1)}h`
    : totalTime >= 60000
      ? `${(totalTime / 60000).toFixed(0)}m`
      : `${(totalTime / 1000).toFixed(0)}s`;

  return `**TWAP Strategy Started**

ID: \`${strategy.id}\`
Token: \`${mint.slice(0, 20)}...\`
Action: ${action.toUpperCase()}
Total: ${amount} ${action === 'buy' ? 'SOL' : 'tokens'}
Intervals: ${intervals}
Amount per interval: ${amountPer.toFixed(4)}
Delay: ${delayStr}
Total duration: ~${totalTimeStr}`;
}

async function handleStrategyLadder(args: string[]): Promise<string> {
  if (args.length < 4) {
    return `**Ladder Buy Strategy**

Set multiple buy orders at decreasing price levels.

**Usage:** /swarm strategy ladder <mint> <total_sol> <levels> <drop_percent>

**Example:**
  /swarm strategy ladder ABC... 0.5 5 3
  Sets buys at current, -3%, -6%, -9%, -12%`;
  }

  const [mint, totalSolStr, levelsStr, dropStr] = args;
  const totalSol = parseFloat(totalSolStr);
  const levels = parseInt(levelsStr);
  const dropPercent = parseFloat(dropStr);

  if (isNaN(totalSol) || totalSol <= 0) return '❌ Invalid total SOL';
  if (isNaN(levels) || levels < 2 || levels > 10) return '❌ Levels must be 2-10';
  if (isNaN(dropPercent) || dropPercent <= 0) return '❌ Invalid drop percent';

  const currentPrice = await fetchTokenPrice(mint);
  const strategy = StrategyTemplates.ladderBuy(mint, totalSol, levels, dropPercent, currentPrice);

  const swarm = getSwarm();
  const executor = new StrategyExecutor(swarm);
  activeStrategies.set(strategy.id, { strategy, executor });

  executor.execute(strategy).then(() => activeStrategies.delete(strategy.id));

  return `**Ladder Buy Strategy Started**

ID: \`${strategy.id}\`
Token: \`${mint.slice(0, 20)}...\`
Total: ${totalSol} SOL
Levels: ${levels}
Drop per level: ${dropPercent}%

Buying ${(totalSol / levels).toFixed(4)} SOL at each level.`;
}

async function handleStrategyDCA(args: string[]): Promise<string> {
  if (args.length < 4) {
    return `**Smart DCA Strategy**

Dollar-cost average with time delays.

**Usage:** /swarm strategy dca-smart <mint> <amount_per_buy> <count> <interval>

**Example:**
  /swarm strategy dca-smart ABC... 0.1 10 1h
  Buys 0.1 SOL every hour, 10 times`;
  }

  const [mint, amountStr, countStr, intervalStr] = args;
  const amount = parseFloat(amountStr);
  const count = parseInt(countStr);

  if (isNaN(amount) || amount <= 0) return '❌ Invalid amount';
  if (isNaN(count) || count < 2 || count > 100) return '❌ Count must be 2-100';

  let intervalMs = 3600000;
  const match = intervalStr.match(/^(\d+)(s|m|h)$/i);
  if (match) {
    const num = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 's') intervalMs = num * 1000;
    else if (unit === 'm') intervalMs = num * 60 * 1000;
    else if (unit === 'h') intervalMs = num * 60 * 60 * 1000;
  }

  const strategy = StrategyTemplates.dca(mint, amount, count, intervalMs);

  const swarm = getSwarm();
  const executor = new StrategyExecutor(swarm);
  activeStrategies.set(strategy.id, { strategy, executor });

  executor.execute(strategy).then(() => activeStrategies.delete(strategy.id));

  return `**Smart DCA Strategy Started**

ID: \`${strategy.id}\`
Token: \`${mint.slice(0, 20)}...\`
Amount per buy: ${amount} SOL
Total buys: ${count}
Interval: ${intervalStr}
Total investment: ${(amount * count).toFixed(4)} SOL`;
}

async function handleStrategySplit(args: string[]): Promise<string> {
  if (args.length < 5) {
    return `**Split Strategy**

Different wallets execute different actions simultaneously.

**Usage:** /swarm strategy split <mint> <buy_wallets> <sell_wallets> <buy_amount> <sell_amount>

**Example:**
  /swarm strategy split ABC... wallet_0,wallet_1 wallet_2,wallet_3 0.1 50%
  Wallets 0,1 buy 0.1 SOL each while wallets 2,3 sell 50%`;
  }

  const [mint, buyWalletsStr, sellWalletsStr, buyAmtStr, sellAmtStr] = args;
  const buyWallets = buyWalletsStr.split(',').map(s => s.trim());
  const sellWallets = sellWalletsStr.split(',').map(s => s.trim());
  const buyAmount = parseFloat(buyAmtStr);
  const sellAmount = parseFloat(sellAmtStr.replace('%', ''));

  if (isNaN(buyAmount)) return '❌ Invalid buy amount';
  if (isNaN(sellAmount)) return '❌ Invalid sell amount';

  const strategy = StrategyTemplates.split(mint, buyWallets, sellWallets, buyAmount, sellAmount);

  const swarm = getSwarm();
  const executor = new StrategyExecutor(swarm);
  activeStrategies.set(strategy.id, { strategy, executor });

  executor.execute(strategy).then(() => activeStrategies.delete(strategy.id));

  return `**Split Strategy Started**

ID: \`${strategy.id}\`
Token: \`${mint.slice(0, 20)}...\`

Buy wallets: ${buyWallets.join(', ')} (${buyAmount} SOL each)
Sell wallets: ${sellWallets.join(', ')} (${sellAmtStr} each)

Executing simultaneously...`;
}

async function handleStrategyRotation(args: string[]): Promise<string> {
  if (args.length < 3) {
    return `**Rotation Strategy**

Exit one token and enter another atomically.

**Usage:** /swarm strategy rotation <exit_mint> <enter_mint> <sell_percent>

**Example:**
  /swarm strategy rotation ABC... XYZ... 100
  Sells 100% of ABC, immediately buys XYZ with proceeds`;
  }

  const [exitMint, enterMint, sellPctStr] = args;
  const sellPercent = parseFloat(sellPctStr);

  if (isNaN(sellPercent) || sellPercent <= 0 || sellPercent > 100) {
    return '❌ Sell percent must be 1-100';
  }

  const strategy = StrategyTemplates.rotation(exitMint, enterMint, sellPercent);

  const swarm = getSwarm();
  const executor = new StrategyExecutor(swarm);
  activeStrategies.set(strategy.id, { strategy, executor });

  executor.execute(strategy).then(() => activeStrategies.delete(strategy.id));

  return `**Rotation Strategy Started**

ID: \`${strategy.id}\`

Step 1: Sell ${sellPercent}% of \`${exitMint.slice(0, 16)}...\`
Step 2: Buy \`${enterMint.slice(0, 16)}...\` with proceeds

Executing...`;
}

function handleStrategyList(): string {
  if (activeStrategies.size === 0) {
    return '**No Active Strategies**\n\nUse `/swarm strategy` to see available strategy types.';
  }

  let output = `**Active Strategies (${activeStrategies.size})**\n\n`;

  for (const [id, { strategy }] of activeStrategies) {
    const elapsed = strategy.startedAt ? Math.round((Date.now() - strategy.startedAt) / 1000) : 0;
    const completedSteps = strategy.steps.filter(s => s.completed).length;

    output += `**${strategy.name}** (\`${id.slice(0, 16)}...\`)\n`;
    output += `  Type: ${strategy.type}\n`;
    output += `  Token: \`${strategy.mint.slice(0, 16)}...\`\n`;
    output += `  Status: ${strategy.status}\n`;
    output += `  Progress: ${completedSteps}/${strategy.steps.length} steps\n`;
    output += `  Running: ${elapsed}s\n\n`;
  }

  return output;
}

function handleStrategyCancel(idPrefix: string): string {
  if (!idPrefix) return 'Usage: /swarm strategy cancel <strategy_id>';

  for (const [id, { executor }] of activeStrategies) {
    if (id.startsWith(idPrefix) || id.includes(idPrefix)) {
      executor.cancel(id);
      activeStrategies.delete(id);
      return `✅ Strategy \`${id}\` cancelled.`;
    }
  }

  return `❌ No active strategy found matching "${idPrefix}"`;
}

function handleStrategyPause(idPrefix: string): string {
  if (!idPrefix) return 'Usage: /swarm strategy pause <strategy_id>';

  for (const [id, { executor }] of activeStrategies) {
    if (id.startsWith(idPrefix) || id.includes(idPrefix)) {
      if (executor.pause(id)) {
        return `⏸️ Strategy \`${id}\` paused.`;
      }
    }
  }

  return `❌ No active strategy found matching "${idPrefix}"`;
}

function handleStrategyResume(idPrefix: string): string {
  if (!idPrefix) return 'Usage: /swarm strategy resume <strategy_id>';

  for (const [id, { executor }] of activeStrategies) {
    if (id.startsWith(idPrefix) || id.includes(idPrefix)) {
      if (executor.resume(id)) {
        return `▶️ Strategy \`${id}\` resumed.`;
      }
    }
  }

  return `❌ No paused strategy found matching "${idPrefix}"`;
}

async function handleHelp(): Promise<string> {
  return `**Pump.fun Swarm Trading**

Coordinate up to 20 wallets for synchronized trading.

**Wallet Management:**
  /swarm wallets              List all swarm wallets
  /swarm balances             Refresh SOL balances from chain
  /swarm enable <id>          Enable wallet for trading
  /swarm disable <id>         Disable wallet
  /swarm status [mints...]    Full swarm status

**SOL Management:**
  /swarm distribute <sol>     Distribute SOL to all wallets
  /swarm consolidate          Collect all SOL to main wallet
  /swarm consolidate-tokens <mint>  Move all tokens to main wallet

**Trading:**
  /swarm buy <mint> <sol>     Buy on all enabled wallets
  /swarm sell <mint> <amt|%>  Sell from all wallets with positions
  /swarm quote <mint> <sol>   Get quotes without executing
  /swarm simulate <mint> <sol> Simulate trade (dry run)

**Position Management:**
  /swarm position <mint>      Check cached positions
  /swarm refresh <mint>       Fetch fresh positions from chain
  /swarm rebalance <mint>     Equalize positions across wallets

**Risk Management:**
  /swarm stop-loss <mint> <price> <pct>  Set stop loss
  /swarm take-profit <mint> <price> <pct> Set take profit
  /swarm triggers             List active triggers
  /swarm remove-trigger <mint> <type>   Remove a trigger

**DCA (Dollar Cost Averaging):**
  /swarm dca <mint> <sol> <interval> <count>  Schedule DCA buys
  /swarm dca-list             List active DCAs
  /swarm dca-cancel <id>      Cancel a DCA schedule

**History:**
  /swarm history [--mint <m>] [--wallet <w>] [--limit <n>]

**Presets:**
  /swarm preset save <name>   Save a trading preset
  /swarm preset list          List saved presets
  /swarm preset show <name>   Show preset details
  /swarm preset delete <name> Delete a preset

**Smart Strategies (Multi-Step):**
  /swarm strategy                    Show all strategy types
  /swarm strategy scale-in ...       Buy at multiple price dips
  /swarm strategy scale-out ...      Sell at multiple price rises
  /swarm strategy snipe ...          Fast buy with auto TP/SL
  /swarm strategy twap ...           Time-weighted execution
  /swarm strategy ladder ...         Ladder buy at price levels
  /swarm strategy split ...          Different wallets buy/sell
  /swarm strategy rotation ...       Exit one token, enter another
  /swarm strategy list               List active strategies
  /swarm strategy cancel <id>        Cancel a running strategy

**Copytrading (Amplified Wallet Following):**
  /swarm copy add <address> [options]    Follow a wallet with all swarm wallets
  /swarm copy list                       List copied wallets
  /swarm copy remove <id>                Stop copying
  /swarm copy stats [id]                 View copy statistics

**Execution Modes:**
  --parallel      All wallets in parallel (fastest)
  --bundle        Single Jito bundle (atomic, max 5)
  --multi-bundle  Multiple Jito bundles (6-20 wallets)
  --sequential    Staggered execution (stealthy)

**Multi-DEX Support:**
  --dex pumpfun   Pump.fun via PumpPortal (default)
  --dex bags      Bags.fm (requires BAGS_API_KEY)
  --dex meteora   Meteora DLMM pools

**Examples:**
  /swarm distribute 0.1                     # Send 0.1 SOL to each wallet
  /swarm buy ABC... 0.1 --preset stealth    # Buy with preset
  /swarm buy ABC... 0.1 --dex bags          # Buy on Bags.fm
  /swarm copy add 7xKX... --multiplier 2    # Copy wallet with 2x size
  /swarm stop-loss ABC... 0.00001 50        # Sell 50% if price drops
  /swarm strategy snipe ABC... 0.5 50 20    # Snipe with 50% TP, 20% SL`;
}

// ============================================================================
// SOL Distribution & Consolidation Handlers
// ============================================================================

async function handleDistribute(args: string[]): Promise<string> {
  if (args.length < 1) {
    return `**Usage:** /swarm distribute <sol_per_wallet> [--from <wallet_id>]

Distribute SOL from main wallet to all enabled wallets.

**Examples:**
  /swarm distribute 0.1              # Send 0.1 SOL to each wallet
  /swarm distribute 0.5 --from wallet_0`;
  }

  const amount = parseFloat(args[0]);
  if (isNaN(amount) || amount <= 0) {
    return '❌ Invalid amount. Must be a positive number.';
  }

  let fromWallet = 'wallet_0';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      fromWallet = args[++i];
    }
  }

  const swarm = getSwarm();
  const result = await swarm.distributeSOL(amount, fromWallet);

  let output = `**SOL Distribution**\n\n`;
  output += `From: ${result.fromWallet}\n`;
  output += `Amount per wallet: ${formatSol(amount)} SOL\n`;
  output += `Status: ${result.success ? '✅ Success' : '❌ Failed'}\n`;
  output += `Total distributed: ${formatSol(result.totalDistributed)} SOL\n\n`;

  if (result.distributions.length > 0) {
    output += `**Transfers:**\n`;
    for (const d of result.distributions) {
      if (d.signature) {
        output += `✅ ${d.toWallet}: ${formatSol(d.amount)} SOL\n`;
      } else {
        output += `❌ ${d.toWallet}: ${d.error}\n`;
      }
    }
  }

  if (result.errors && result.errors.length > 0) {
    output += `\n**Errors:**\n`;
    for (const err of result.errors) {
      output += `  - ${err}\n`;
    }
  }

  return output;
}

async function handleConsolidate(args: string[]): Promise<string> {
  let toWallet = 'wallet_0';
  let leaveAmount = 0.005;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to' && args[i + 1]) {
      toWallet = args[++i];
    } else if (args[i] === '--leave' && args[i + 1]) {
      leaveAmount = parseFloat(args[++i]);
    }
  }

  const swarm = getSwarm();
  const result = await swarm.consolidateSOL(toWallet, leaveAmount);

  let output = `**SOL Consolidation**\n\n`;
  output += `To: ${result.toWallet}\n`;
  output += `Leave per wallet: ${formatSol(leaveAmount)} SOL\n`;
  output += `Status: ${result.success ? '✅ Success' : '❌ Failed'}\n`;
  output += `Total consolidated: ${formatSol(result.totalConsolidated)} SOL\n\n`;

  if (result.consolidations.length > 0) {
    output += `**Transfers:**\n`;
    for (const c of result.consolidations) {
      if (c.signature) {
        output += `✅ ${c.fromWallet}: ${formatSol(c.amount)} SOL\n`;
      } else {
        output += `❌ ${c.fromWallet}: ${c.error}\n`;
      }
    }
  }

  return output;
}

async function handleConsolidateTokens(mint: string): Promise<string> {
  if (!mint) {
    return `**Usage:** /swarm consolidate-tokens <mint> [--to <wallet_id>]

Move all tokens of a specific mint to one wallet (sells from others).`;
  }

  const swarm = getSwarm();
  const result = await swarm.consolidateTokens(mint);

  let output = `**Token Consolidation**\n\n`;
  output += `Token: \`${mint.slice(0, 20)}...\`\n`;
  output += `To: ${result.toWallet}\n`;
  output += `Status: ${result.success ? '✅ Success' : '❌ Failed'}\n`;
  output += `Total: ${formatTokens(result.totalConsolidated)} tokens\n\n`;

  if (result.consolidations.length > 0) {
    output += `**Transfers:**\n`;
    for (const c of result.consolidations) {
      if (c.signature) {
        output += `✅ ${c.fromWallet}: ${formatTokens(c.amount)}\n`;
      } else {
        output += `❌ ${c.fromWallet}: ${c.error}\n`;
      }
    }
  }

  return output;
}

// ============================================================================
// Status & Quote Handlers
// ============================================================================

async function handleStatus(mints: string[]): Promise<string> {
  const swarm = getSwarm();
  const status = await swarm.getSwarmStatus(mints.length > 0 ? mints : undefined);

  let output = `**Swarm Status**\n\n`;
  output += `Wallets: ${status.enabledWallets}/${status.totalWallets} enabled\n`;
  output += `Total SOL: ${formatSol(status.totalSolBalance)}\n\n`;

  output += `**Balances:**\n`;
  for (const [id, balance] of status.balanceByWallet) {
    const wallet = swarm.getWallet(id);
    const statusIcon = wallet?.enabled ? '🟢' : '🔴';
    output += `${statusIcon} ${id}: ${formatSol(balance)} SOL\n`;
  }

  if (status.positions.size > 0) {
    output += `\n**Positions:**\n`;
    for (const [mint, pos] of status.positions) {
      output += `\`${mint.slice(0, 16)}...\`: ${formatTokens(pos.totalTokens)} total\n`;
    }
  }

  return output;
}

async function handleQuote(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `**Usage:** /swarm quote <mint> <sol_per_wallet> [--wallets <ids>]

Get quotes without executing trades.`;
  }

  const mint = args[0];
  const amount = parseFloat(args[1]);

  if (isNaN(amount) || amount <= 0) {
    return '❌ Invalid amount.';
  }

  let walletIds: string[] | undefined;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--wallets' && args[i + 1]) {
      walletIds = parseWalletIds(args[++i]);
    }
  }

  const swarm = getSwarm();
  const result = await swarm.coordinatedQuote({
    mint,
    action: 'buy',
    amountPerWallet: amount,
    denominatedInSol: true,
    walletIds,
  });

  let output = `**Swarm Quote**\n\n`;
  output += `Token: \`${mint.slice(0, 20)}...\`\n`;
  output += `Total Input: ${formatSol(result.totalInput)} SOL\n`;
  output += `Total Output: ${formatTokens(result.totalOutput)} tokens\n`;
  if (result.avgPriceImpact !== undefined) {
    output += `Avg Price Impact: ${result.avgPriceImpact.toFixed(2)}%\n`;
  }
  output += `\n**Per Wallet:**\n`;

  for (const q of result.quotes) {
    if (q.error) {
      output += `❌ ${q.walletId}: ${q.error}\n`;
    } else {
      output += `✅ ${q.walletId}: ${formatSol(q.inputAmount)} → ${formatTokens(q.outputAmount)}`;
      if (q.priceImpact !== undefined) {
        output += ` (${q.priceImpact.toFixed(2)}% impact)`;
      }
      output += `\n`;
    }
  }

  return output;
}

async function handleSimulate(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `**Usage:** /swarm simulate <mint> <sol> [options]

Simulate a trade without executing. Shows what would happen.`;
  }

  const mint = args[0];
  const amount = parseFloat(args[1]);
  const action = args.includes('--sell') ? 'sell' : 'buy';

  if (isNaN(amount) || amount <= 0) {
    return '❌ Invalid amount.';
  }

  const swarm = getSwarm();
  const result = await swarm.simulate({
    mint,
    action,
    amountPerWallet: action === 'sell' ? `${amount}%` : amount,
    denominatedInSol: action === 'buy',
  });

  let output = `**Simulation Result**\n\n`;
  output += `Would succeed: ${result.wouldSucceed ? '✅ Yes' : '❌ No'}\n`;
  output += `Wallets used: ${result.walletsUsed}\n`;
  if (result.estimatedTotalSol > 0) {
    output += `Est. SOL: ${formatSol(result.estimatedTotalSol)}\n`;
  }
  if (result.estimatedTotalTokens) {
    output += `Est. Tokens: ${formatTokens(result.estimatedTotalTokens)}\n`;
  }
  output += `Est. Fees: ${formatSol(result.estimatedFees)} SOL\n`;

  if (result.warnings.length > 0) {
    output += `\n**Warnings:**\n`;
    for (const w of result.warnings) {
      output += `  ⚠️ ${w}\n`;
    }
  }

  if (result.errors.length > 0) {
    output += `\n**Errors:**\n`;
    for (const e of result.errors) {
      output += `  ❌ ${e}\n`;
    }
  }

  return output;
}

// ============================================================================
// Stop Loss & Take Profit Handlers
// ============================================================================

async function handleStopLoss(args: string[]): Promise<string> {
  if (args.length < 3) {
    return `**Usage:** /swarm stop-loss <mint> <trigger_price> <sell_percent> [options]

Set a stop loss that automatically sells when price drops.

**Options:**
  --dex <dex>           DEX to use: pumpfun (default), bags, meteora
  --pool-address <addr> Specific pool address (for Meteora)

**Examples:**
  /swarm stop-loss ABC... 0.00001 100    # Sell 100% if price drops to 0.00001
  /swarm stop-loss ABC... 0.00002 50 --dex bags    # Sell on Bags.fm`;
  }

  const mint = args[0];
  const triggerPrice = parseFloat(args[1]);
  const sellPercent = parseFloat(args[2]);

  // Parse options
  let dex: 'pumpfun' | 'bags' | 'meteora' | undefined;
  let poolAddress: string | undefined;
  for (let i = 3; i < args.length; i++) {
    if (args[i] === '--dex' && args[i + 1]) {
      const d = args[++i].toLowerCase();
      if (d === 'pumpfun' || d === 'bags' || d === 'meteora') {
        dex = d;
      }
    } else if (args[i] === '--pool-address' && args[i + 1]) {
      poolAddress = args[++i];
    }
  }

  if (isNaN(triggerPrice) || triggerPrice <= 0) {
    return '❌ Invalid trigger price.';
  }

  if (isNaN(sellPercent) || sellPercent <= 0 || sellPercent > 100) {
    return '❌ Sell percent must be between 1 and 100.';
  }

  const swarm = getSwarm();
  swarm.setStopLoss({
    mint,
    triggerPrice,
    sellPercent,
    enabled: true,
    dex,
    poolAddress,
  });

  return `✅ **Stop Loss Set**

Token: \`${mint.slice(0, 20)}...\`
Trigger: ${triggerPrice}
Sell: ${sellPercent}%${dex ? `\nDEX: ${dex}` : ''}

_Monitoring active. Will auto-sell if price drops to trigger._`;
}

async function handleTakeProfit(args: string[]): Promise<string> {
  if (args.length < 3) {
    return `**Usage:** /swarm take-profit <mint> <trigger_price> <sell_percent> [options]

Set a take profit that automatically sells when price rises.

**Options:**
  --dex <dex>           DEX to use: pumpfun (default), bags, meteora
  --pool-address <addr> Specific pool address (for Meteora)

**Examples:**
  /swarm take-profit ABC... 0.001 50     # Sell 50% when price hits 0.001
  /swarm take-profit ABC... 0.002 100 --dex bags    # Sell on Bags.fm`;
  }

  const mint = args[0];
  const triggerPrice = parseFloat(args[1]);
  const sellPercent = parseFloat(args[2]);

  // Parse options
  let dex: 'pumpfun' | 'bags' | 'meteora' | undefined;
  let poolAddress: string | undefined;
  for (let i = 3; i < args.length; i++) {
    if (args[i] === '--dex' && args[i + 1]) {
      const d = args[++i].toLowerCase();
      if (d === 'pumpfun' || d === 'bags' || d === 'meteora') {
        dex = d;
      }
    } else if (args[i] === '--pool-address' && args[i + 1]) {
      poolAddress = args[++i];
    }
  }

  if (isNaN(triggerPrice) || triggerPrice <= 0) {
    return '❌ Invalid trigger price.';
  }

  if (isNaN(sellPercent) || sellPercent <= 0 || sellPercent > 100) {
    return '❌ Sell percent must be between 1 and 100.';
  }

  const swarm = getSwarm();
  swarm.setTakeProfit({
    mint,
    triggerPrice,
    sellPercent,
    enabled: true,
    dex,
    poolAddress,
  });

  return `✅ **Take Profit Set**

Token: \`${mint.slice(0, 20)}...\`
Trigger: ${triggerPrice}
Sell: ${sellPercent}%${dex ? `\nDEX: ${dex}` : ''}

_Monitoring active. Will auto-sell if price rises to trigger._`;
}

async function handleTriggers(): Promise<string> {
  const swarm = getSwarm();
  const stopLosses = swarm.getStopLossConfigs();
  const takeProfits = swarm.getTakeProfitConfigs();

  if (stopLosses.length === 0 && takeProfits.length === 0) {
    return 'No active triggers. Set with `/swarm stop-loss` or `/swarm take-profit`.';
  }

  let output = `**Active Triggers**\n\n`;

  if (stopLosses.length > 0) {
    output += `**Stop Losses:**\n`;
    for (const sl of stopLosses) {
      const status = sl.enabled ? '🟢' : '🔴';
      output += `${status} \`${sl.mint.slice(0, 16)}...\` @ ${sl.triggerPrice} → sell ${sl.sellPercent}%\n`;
    }
    output += '\n';
  }

  if (takeProfits.length > 0) {
    output += `**Take Profits:**\n`;
    for (const tp of takeProfits) {
      const status = tp.enabled ? '🟢' : '🔴';
      output += `${status} \`${tp.mint.slice(0, 16)}...\` @ ${tp.triggerPrice} → sell ${tp.sellPercent}%\n`;
    }
  }

  return output;
}

async function handleRemoveTrigger(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `**Usage:** /swarm remove-trigger <mint> <stop-loss|take-profit>`;
  }

  const mint = args[0];
  const type = args[1].toLowerCase();

  const swarm = getSwarm();
  let removed = false;

  if (type === 'stop-loss' || type === 'sl') {
    removed = swarm.removeStopLoss(mint);
  } else if (type === 'take-profit' || type === 'tp') {
    removed = swarm.removeTakeProfit(mint);
  } else {
    return '❌ Type must be `stop-loss` or `take-profit`.';
  }

  return removed
    ? `✅ Removed ${type} for \`${mint.slice(0, 20)}...\``
    : `❌ No ${type} found for that token.`;
}

// ============================================================================
// DCA Handlers
// ============================================================================

function parseInterval(str: string): number {
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return 0;

  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

async function handleDCA(args: string[]): Promise<string> {
  if (args.length < 4) {
    return `**Usage:** /swarm dca <mint> <sol_per_interval> <interval> <count> [options]

Schedule DCA (Dollar Cost Averaging) buys.

**Interval formats:** 30s, 5m, 1h, 1d

**Options:**
  --dex <dex>           DEX to use: pumpfun (default), bags, meteora
  --pool-address <addr> Specific pool address (for Meteora)

**Examples:**
  /swarm dca ABC... 0.05 1h 10    # Buy 0.05 SOL every hour, 10 times
  /swarm dca ABC... 0.1 30m 20 --dex bags    # DCA on Bags.fm`;
  }

  const mint = args[0];
  const amountPerInterval = parseFloat(args[1]);
  const intervalMs = parseInterval(args[2]);
  const totalIntervals = parseInt(args[3]);

  // Parse options
  let dex: 'pumpfun' | 'bags' | 'meteora' | undefined;
  let poolAddress: string | undefined;
  for (let i = 4; i < args.length; i++) {
    if (args[i] === '--dex' && args[i + 1]) {
      const d = args[++i].toLowerCase();
      if (d === 'pumpfun' || d === 'bags' || d === 'meteora') {
        dex = d;
      }
    } else if (args[i] === '--pool-address' && args[i + 1]) {
      poolAddress = args[++i];
    }
  }

  if (isNaN(amountPerInterval) || amountPerInterval <= 0) {
    return '❌ Invalid amount.';
  }

  if (intervalMs <= 0) {
    return '❌ Invalid interval. Use formats like 30s, 5m, 1h, 1d.';
  }

  if (isNaN(totalIntervals) || totalIntervals <= 0) {
    return '❌ Invalid count.';
  }

  const swarm = getSwarm();
  const config = swarm.scheduleDCA({
    mint,
    amountPerInterval,
    intervalMs,
    totalIntervals,
    enabled: true,
    dex,
    poolAddress,
  });

  const totalSol = amountPerInterval * totalIntervals;

  return `✅ **DCA Scheduled**

ID: \`${config.id}\`
Token: \`${mint.slice(0, 20)}...\`
Per interval: ${formatSol(amountPerInterval)} SOL
Interval: ${args[2]}
Count: ${totalIntervals}
Total SOL: ${formatSol(totalSol)}${dex ? `\nDEX: ${dex}` : ''}

_First buy in ${args[2]}. Use \`/swarm dca-cancel ${config.id}\` to stop._`;
}

async function handleDCAList(): Promise<string> {
  const swarm = getSwarm();
  const configs = swarm.getDCAConfigs();

  if (configs.length === 0) {
    return 'No active DCAs. Schedule with `/swarm dca`.';
  }

  let output = `**Active DCAs**\n\n`;

  for (const config of configs) {
    const status = config.enabled ? '🟢' : '🔴';
    const progress = `${config.completedIntervals}/${config.totalIntervals}`;
    output += `${status} **${config.id}**\n`;
    output += `   Token: \`${config.mint.slice(0, 16)}...\`\n`;
    output += `   Progress: ${progress}\n`;
    output += `   Amount: ${formatSol(config.amountPerInterval)} SOL\n`;
    output += `   Next: ${new Date(config.nextExecutionAt).toLocaleTimeString()}\n\n`;
  }

  return output;
}

async function handleDCACancel(id: string): Promise<string> {
  if (!id) {
    return 'Usage: /swarm dca-cancel <id>';
  }

  const swarm = getSwarm();
  const cancelled = swarm.cancelDCA(id);

  return cancelled
    ? `✅ DCA \`${id}\` cancelled.`
    : `❌ DCA \`${id}\` not found.`;
}

// ============================================================================
// History & Rebalance Handlers
// ============================================================================

async function handleHistory(args: string[]): Promise<string> {
  let mint: string | undefined;
  let walletId: string | undefined;
  let limit = 20;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mint' && args[i + 1]) {
      mint = args[++i];
    } else if (args[i] === '--wallet' && args[i + 1]) {
      walletId = args[++i];
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i]);
    }
  }

  const swarm = getSwarm();
  const history = swarm.getTradeHistory({ mint, walletId, limit });

  if (history.length === 0) {
    return 'No trade history. Trades will be recorded as you execute them.';
  }

  let output = `**Trade History** (${history.length})\n\n`;

  for (const entry of history) {
    const action = entry.action === 'buy' ? '🟢 BUY' : '🔴 SELL';
    const time = new Date(entry.timestamp).toLocaleString();
    const status = entry.success ? '✅' : '❌';
    output += `${status} ${action} ${entry.walletId}\n`;
    output += `   ${time}\n`;
    output += `   \`${entry.mint.slice(0, 16)}...\`\n`;
    if (entry.solAmount) output += `   SOL: ${formatSol(entry.solAmount)}\n`;
    if (entry.tokenAmount) output += `   Tokens: ${formatTokens(entry.tokenAmount)}\n`;
    output += '\n';
  }

  return output;
}

async function handleRebalance(mint: string): Promise<string> {
  if (!mint) {
    return `**Usage:** /swarm rebalance <mint>

Redistribute tokens evenly across all enabled wallets.`;
  }

  const swarm = getSwarm();
  const result = await swarm.rebalance(mint);

  let output = `**Rebalance Result**\n\n`;
  output += `Token: \`${mint.slice(0, 20)}...\`\n`;
  output += `Status: ${result.success ? '✅ Success' : '❌ Failed'}\n\n`;

  if (result.transfers.length > 0) {
    output += `**Transfers:**\n`;
    for (const t of result.transfers) {
      if (t.signature) {
        output += `✅ ${t.fromWallet} → ${t.toWallet}: ${formatTokens(t.amount)}\n`;
      } else {
        output += `❌ ${t.fromWallet}: ${t.error}\n`;
      }
    }
  } else {
    output += '_Positions already balanced (within 5% threshold)_';
  }

  return output;
}

// ============================================================================
// Main Execute Function
// ============================================================================

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  try {
    switch (command) {
      // Wallet management
      case 'wallets':
      case 'list':
        return await handleWallets();
      case 'balances':
      case 'balance':
        return await handleBalances();
      case 'enable':
        return await handleEnable(rest[0]);
      case 'disable':
        return await handleDisable(rest[0]);
      case 'status':
        return await handleStatus(rest);

      // SOL management
      case 'distribute':
        return await handleDistribute(rest);
      case 'consolidate':
        return await handleConsolidate(rest);
      case 'consolidate-tokens':
        return await handleConsolidateTokens(rest[0]);

      // Trading
      case 'buy':
        return await handleBuy(rest);
      case 'sell':
        return await handleSell(rest);
      case 'quote':
        return await handleQuote(rest);
      case 'simulate':
      case 'sim':
        return await handleSimulate(rest);

      // Positions
      case 'position':
      case 'pos':
        return await handlePosition(rest[0]);
      case 'refresh':
      case 'sync':
        return await handleRefresh(rest[0]);
      case 'rebalance':
        return await handleRebalance(rest[0]);

      // Risk management
      case 'stop-loss':
      case 'sl':
        return await handleStopLoss(rest);
      case 'take-profit':
      case 'tp':
        return await handleTakeProfit(rest);
      case 'triggers':
        return await handleTriggers();
      case 'remove-trigger':
        return await handleRemoveTrigger(rest);

      // DCA
      case 'dca':
        return await handleDCA(rest);
      case 'dca-list':
        return await handleDCAList();
      case 'dca-cancel':
        return await handleDCACancel(rest[0]);

      // History
      case 'history':
        return await handleHistory(rest);

      // Presets
      case 'preset':
      case 'presets':
        return await handlePreset(rest);

      // Smart Strategies
      case 'strategy':
      case 'strat':
        return await handleStrategy(rest);

      // Copytrading
      case 'copy':
      case 'copytrade':
        return await handleCopytrade(rest);

      case 'help':
      default:
        return await handleHelp();
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `❌ **Error:** ${msg}`;
  }
}

// ============================================================================
// Copytrading Handlers
// ============================================================================

async function handleCopytrade(args: string[]): Promise<string> {
  if (args.length === 0) {
    return handleCopytradeHelp();
  }

  const [subCmd, ...rest] = args;

  switch (subCmd.toLowerCase()) {
    case 'add':
      return await handleCopytradeAdd(rest);
    case 'remove':
    case 'rm':
      return await handleCopytradeRemove(rest[0]);
    case 'list':
    case 'ls':
      return handleCopytradeList();
    case 'enable':
      return handleCopytradeEnable(rest[0]);
    case 'disable':
      return handleCopytradeDisable(rest[0]);
    case 'config':
      return await handleCopytradeConfig(rest);
    case 'stats':
      return handleCopytradeStats(rest[0]);
    default:
      return handleCopytradeHelp();
  }
}

function handleCopytradeHelp(): string {
  return `**Swarm Copytrading**

Follow wallets and replicate their trades across ALL your swarm wallets.

**Commands:**
  /swarm copy add <address> [options]   Add wallet to copy
  /swarm copy remove <id>               Stop copying a wallet
  /swarm copy list                      List copied wallets
  /swarm copy enable <id>               Enable copying
  /swarm copy disable <id>              Pause copying
  /swarm copy config <id> [options]     Update copy settings
  /swarm copy stats [id]                View copy statistics

**Add Options:**
  --name "Whale 1"         Friendly name
  --multiplier <n>         Size multiplier (1.0 = same, 2.0 = 2x)
  --max-sol <n>            Max SOL per trade (default: 1.0)
  --min-sol <n>            Min SOL to copy (default: 0.01)
  --delay <ms>             Delay before copying (stealth)
  --buys-only              Only copy buys
  --sells-only             Only copy sells
  --dex <dex>              DEX for execution
  --mode <mode>            Execution mode

**Examples:**
  /swarm copy add 7xKX...abc --name "Alpha Whale" --multiplier 0.5
  /swarm copy add 9zYZ...xyz --buys-only --max-sol 0.5 --delay 1000
  /swarm copy list
  /swarm copy stats`;
}

async function handleCopytradeAdd(args: string[]): Promise<string> {
  if (args.length === 0) {
    return '❌ Usage: /swarm copy add <wallet_address> [options]';
  }

  const address = args[0];

  // Parse options
  let name: string | undefined;
  let multiplier = 1.0;
  let maxSolPerTrade = 1.0;
  let minSolPerTrade = 0.01;
  let delayMs = 0;
  let copyBuys = true;
  let copySells = true;
  let dex: 'pumpfun' | 'bags' | 'meteora' | 'auto' | undefined;
  let executionMode: 'parallel' | 'bundle' | 'multi-bundle' | 'sequential' | undefined;
  let slippageBps = 500;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--name' && args[i + 1]) {
      name = args[++i];
    } else if (arg === '--multiplier' && args[i + 1]) {
      multiplier = parseFloat(args[++i]);
    } else if (arg === '--max-sol' && args[i + 1]) {
      maxSolPerTrade = parseFloat(args[++i]);
    } else if (arg === '--min-sol' && args[i + 1]) {
      minSolPerTrade = parseFloat(args[++i]);
    } else if (arg === '--delay' && args[i + 1]) {
      delayMs = parseInt(args[++i]);
    } else if (arg === '--buys-only') {
      copySells = false;
    } else if (arg === '--sells-only') {
      copyBuys = false;
    } else if (arg === '--dex' && args[i + 1]) {
      const d = args[++i].toLowerCase();
      if (d === 'pumpfun' || d === 'bags' || d === 'meteora' || d === 'auto') {
        dex = d;
      }
    } else if (arg === '--mode' && args[i + 1]) {
      const m = args[++i].toLowerCase();
      if (m === 'parallel' || m === 'bundle' || m === 'multi-bundle' || m === 'sequential') {
        executionMode = m;
      }
    } else if (arg === '--slippage' && args[i + 1]) {
      slippageBps = parseInt(args[++i]);
    }
  }

  const copyTrader = getCopyTrader();
  const target = copyTrader.addTarget(address, {
    multiplier,
    maxSolPerTrade,
    minSolPerTrade,
    delayMs,
    copyBuys,
    copySells,
    dex,
    executionMode,
    slippageBps,
  }, name);

  return `✅ **Copytrading Target Added**

ID: \`${target.id}\`
Address: \`${address.slice(0, 20)}...\`${name ? `\nName: ${name}` : ''}
Multiplier: ${multiplier}x
Max per trade: ${maxSolPerTrade} SOL
Copy: ${copyBuys && copySells ? 'Buys & Sells' : copyBuys ? 'Buys only' : 'Sells only'}
Delay: ${delayMs}ms${dex ? `\nDEX: ${dex}` : ''}

_Now monitoring for trades..._`;
}

async function handleCopytradeRemove(id: string): Promise<string> {
  if (!id) {
    return '❌ Usage: /swarm copy remove <id>';
  }

  const copyTrader = getCopyTrader();
  const removed = copyTrader.removeTarget(id);

  return removed
    ? `✅ Removed copytrading target \`${id}\``
    : `❌ Target \`${id}\` not found`;
}

function handleCopytradeList(): string {
  const copyTrader = getCopyTrader();
  const targets = copyTrader.listTargets();

  if (targets.length === 0) {
    return 'No copytrading targets. Add one with `/swarm copy add <address>`.';
  }

  let output = `**Copytrading Targets** (${targets.length})\n\n`;

  for (const target of targets) {
    const status = target.enabled ? '🟢' : '⏸️';
    const addr = target.address.slice(0, 12) + '...';
    output += `${status} **${target.name || addr}**\n`;
    output += `   ID: \`${target.id}\`\n`;
    output += `   Address: \`${target.address.slice(0, 20)}...\`\n`;
    output += `   Multiplier: ${target.config.multiplier}x | Max: ${target.config.maxSolPerTrade} SOL\n`;
    output += `   Trades: ${target.stats.totalTradesCopied} | PnL: ${formatSol(target.stats.pnlSol)} SOL\n\n`;
  }

  return output;
}

function handleCopytradeEnable(id: string): string {
  if (!id) return '❌ Usage: /swarm copy enable <id>';

  const copyTrader = getCopyTrader();
  const enabled = copyTrader.enableTarget(id);

  return enabled
    ? `✅ Enabled copytrading for \`${id}\``
    : `❌ Target \`${id}\` not found`;
}

function handleCopytradeDisable(id: string): string {
  if (!id) return '❌ Usage: /swarm copy disable <id>';

  const copyTrader = getCopyTrader();
  const disabled = copyTrader.disableTarget(id);

  return disabled
    ? `⏸️ Paused copytrading for \`${id}\``
    : `❌ Target \`${id}\` not found`;
}

async function handleCopytradeConfig(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `**Usage:** /swarm copy config <id> [options]

Update configuration for a copy target.

**Options:**
  --multiplier <n>    Size multiplier
  --max-sol <n>       Max SOL per trade
  --min-sol <n>       Min SOL to copy
  --delay <ms>        Delay before copying
  --buys <on|off>     Copy buys
  --sells <on|off>    Copy sells
  --dex <dex>         DEX for execution`;
  }

  const id = args[0];
  const copyTrader = getCopyTrader();
  const target = copyTrader.getTarget(id);

  if (!target) {
    return `❌ Target \`${id}\` not found`;
  }

  const config: Partial<CopyConfig> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--multiplier' && args[i + 1]) {
      config.multiplier = parseFloat(args[++i]);
    } else if (arg === '--max-sol' && args[i + 1]) {
      config.maxSolPerTrade = parseFloat(args[++i]);
    } else if (arg === '--min-sol' && args[i + 1]) {
      config.minSolPerTrade = parseFloat(args[++i]);
    } else if (arg === '--delay' && args[i + 1]) {
      config.delayMs = parseInt(args[++i]);
    } else if (arg === '--buys' && args[i + 1]) {
      config.copyBuys = args[++i].toLowerCase() === 'on';
    } else if (arg === '--sells' && args[i + 1]) {
      config.copySells = args[++i].toLowerCase() === 'on';
    } else if (arg === '--dex' && args[i + 1]) {
      const d = args[++i].toLowerCase();
      if (d === 'pumpfun' || d === 'bags' || d === 'meteora' || d === 'auto') {
        config.dex = d;
      }
    }
  }

  copyTrader.updateTargetConfig(id, config);

  return `✅ Updated config for \`${id}\`\n\n${JSON.stringify(config, null, 2)}`;
}

function handleCopytradeStats(id?: string): string {
  const copyTrader = getCopyTrader();

  if (id) {
    const target = copyTrader.getTarget(id);
    if (!target) {
      return `❌ Target \`${id}\` not found`;
    }

    const stats = target.stats;
    return `**Copytrade Stats: ${target.name || target.address.slice(0, 12)}**

Total Trades: ${stats.totalTradesCopied}
Successful: ${stats.successfulTrades}
Failed: ${stats.failedTrades}
Success Rate: ${stats.totalTradesCopied > 0 ? ((stats.successfulTrades / stats.totalTradesCopied) * 100).toFixed(1) : 0}%

SOL Spent: ${formatSol(stats.totalSolSpent)}
SOL Received: ${formatSol(stats.totalSolReceived)}
**PnL: ${formatSol(stats.pnlSol)} SOL**

Today: ${stats.todayTrades} trades, ${formatSol(stats.todaySol)} SOL${stats.lastTradeAt ? `\nLast trade: ${new Date(stats.lastTradeAt).toLocaleString()}` : ''}`;
  }

  // Aggregate stats
  const targets = copyTrader.listTargets();
  if (targets.length === 0) {
    return 'No copytrading targets.';
  }

  let totalTrades = 0;
  let totalSuccess = 0;
  let totalSpent = 0;
  let totalReceived = 0;

  for (const t of targets) {
    totalTrades += t.stats.totalTradesCopied;
    totalSuccess += t.stats.successfulTrades;
    totalSpent += t.stats.totalSolSpent;
    totalReceived += t.stats.totalSolReceived;
  }

  const pnl = totalReceived - totalSpent;

  return `**Copytrade Summary (${targets.length} targets)**

Total Trades: ${totalTrades}
Success Rate: ${totalTrades > 0 ? ((totalSuccess / totalTrades) * 100).toFixed(1) : 0}%

SOL Spent: ${formatSol(totalSpent)}
SOL Received: ${formatSol(totalReceived)}
**Total PnL: ${formatSol(pnl)} SOL**`;
}

export default {
  name: 'pump-swarm',
  description: 'Coordinate multiple wallets for synchronized Pump.fun trading',
  commands: ['/pump-swarm', '/swarm'],
  requires: { env: ['SOLANA_PRIVATE_KEY'] },
  handle: execute,
};
