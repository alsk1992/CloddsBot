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
} from '../../../solana/pump-swarm';

// ============================================================================
// Helpers
// ============================================================================

function formatSol(lamports: number): string {
  return lamports.toFixed(4);
}

function formatTokens(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
  return amount.toFixed(2);
}

function parseWalletIds(arg: string): string[] {
  return arg.split(',').map(s => s.trim()).filter(Boolean);
}

function formatTradeResult(result: SwarmTradeResult): string {
  const successCount = result.walletResults.filter(r => r.success).length;
  const totalCount = result.walletResults.length;

  let output = `**Swarm ${result.action.toUpperCase()} Result**\n\n`;
  output += `Token: \`${result.mint.slice(0, 20)}...\`\n`;
  output += `Status: ${result.success ? '✅' : '❌'} ${successCount}/${totalCount} wallets\n`;
  output += `Total Amount: ${formatSol(result.totalAmount)} SOL\n`;
  output += `Execution Time: ${result.executionTimeMs}ms\n`;

  if (result.bundleId) {
    output += `Bundle ID: \`${result.bundleId}\`\n`;
  }

  output += '\n**Wallet Results:**\n';
  for (const wr of result.walletResults) {
    const status = wr.success ? '✅' : '❌';
    output += `${status} ${wr.walletId} (\`${wr.publicKey.slice(0, 8)}...\`)`;
    if (wr.success && wr.signature) {
      output += ` - [tx](https://solscan.io/tx/${wr.signature})`;
    }
    if (wr.error) {
      output += ` - ${wr.error}`;
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
\`\`\`
export SOLANA_PRIVATE_KEY="main-wallet-key"
export SOLANA_SWARM_KEY_1="wallet-2-key"
export SOLANA_SWARM_KEY_2="wallet-3-key"
\`\`\``;
  }

  let output = `**Swarm Wallets (${wallets.length})**\n\n`;

  for (const w of wallets) {
    const status = w.enabled ? '🟢' : '🔴';
    output += `${status} **${w.id}**\n`;
    output += `   Address: \`${w.publicKey}\`\n`;
    output += `   Balance: ${formatSol(w.balance)} SOL\n`;
    if (w.positions.size > 0) {
      output += `   Positions: ${w.positions.size} tokens\n`;
    }
    output += '\n';
  }

  return output;
}

async function handleBalances(): Promise<string> {
  const swarm = getSwarm();
  const wallets = swarm.getWallets();

  if (wallets.length === 0) {
    return 'No swarm wallets configured.';
  }

  let output = '**Refreshing Balances...**\n\n';
  const balances = await swarm.refreshBalances();

  let totalSol = 0;
  for (const [id, balance] of balances) {
    const wallet = swarm.getWallet(id);
    const status = wallet?.enabled ? '🟢' : '🔴';
    output += `${status} ${id}: **${formatSol(balance)} SOL**\n`;
    totalSol += balance;
  }

  output += `\n**Total: ${formatSol(totalSol)} SOL**`;
  return output;
}

async function handleEnable(walletId: string): Promise<string> {
  if (!walletId) return 'Usage: /swarm enable <wallet_id>';

  const swarm = getSwarm();
  const wallet = swarm.getWallet(walletId);

  if (!wallet) {
    return `Wallet "${walletId}" not found.`;
  }

  swarm.enableWallet(walletId);
  return `✅ Wallet **${walletId}** enabled.`;
}

async function handleDisable(walletId: string): Promise<string> {
  if (!walletId) return 'Usage: /swarm disable <wallet_id>';

  const swarm = getSwarm();
  const wallet = swarm.getWallet(walletId);

  if (!wallet) {
    return `Wallet "${walletId}" not found.`;
  }

  swarm.disableWallet(walletId);
  return `🔴 Wallet **${walletId}** disabled.`;
}

async function handleBuy(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /swarm buy <mint> <sol_per_wallet> [options]

Options:
  --wallets <id1,id2,...>  Specific wallets only
  --bundle                 Force Jito bundle
  --sequential             Force sequential
  --slippage <bps>         Slippage (default: 500)
  --pool <pool>            Pool: pump, raydium, auto

Example:
  /swarm buy ABC123... 0.1
  /swarm buy ABC123... 0.1 --wallets wallet_0,wallet_1 --bundle`;
  }

  const mint = args[0];
  const amountPerWallet = parseFloat(args[1]);

  if (isNaN(amountPerWallet) || amountPerWallet <= 0) {
    return 'Invalid amount. Must be a positive number (SOL per wallet).';
  }

  // Parse options
  let walletIds: string[] | undefined;
  let useBundle: boolean | undefined;
  let slippageBps: number | undefined;
  let pool: string | undefined;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--wallets' && args[i + 1]) {
      walletIds = parseWalletIds(args[++i]);
    } else if (args[i] === '--bundle') {
      useBundle = true;
    } else if (args[i] === '--sequential') {
      useBundle = false;
    } else if (args[i] === '--slippage' && args[i + 1]) {
      slippageBps = parseInt(args[++i]);
    } else if (args[i] === '--pool' && args[i + 1]) {
      pool = args[++i];
    }
  }

  const swarm = getSwarm();
  const enabledWallets = walletIds
    ? walletIds.map(id => swarm.getWallet(id)).filter((w): w is SwarmWallet => w !== undefined && w.enabled)
    : swarm.getEnabledWallets();

  if (enabledWallets.length === 0) {
    return 'No enabled wallets available. Check `/swarm wallets`.';
  }

  const totalSol = amountPerWallet * enabledWallets.length;
  let preview = `**Swarm Buy Preview**\n\n`;
  preview += `Token: \`${mint.slice(0, 30)}...\`\n`;
  preview += `Amount: ${formatSol(amountPerWallet)} SOL per wallet\n`;
  preview += `Wallets: ${enabledWallets.length}\n`;
  preview += `Total: ${formatSol(totalSol)} SOL\n`;
  preview += `Mode: ${useBundle === false ? 'Sequential' : 'Bundle (atomic)'}\n\n`;
  preview += `Executing...\n\n`;

  const params: SwarmTradeParams = {
    mint,
    action: 'buy',
    amountPerWallet,
    denominatedInSol: true,
    slippageBps,
    pool,
    useBundle,
    walletIds,
  };

  const result = await swarm.coordinatedBuy(params);
  return preview + formatTradeResult(result);
}

async function handleSell(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /swarm sell <mint> <amount|%> [options]

Amount can be:
  - Number: exact token amount
  - Percentage: "50%" or "100%"

Options:
  --wallets <id1,id2,...>  Specific wallets only
  --bundle                 Force Jito bundle
  --sequential             Force sequential
  --slippage <bps>         Slippage (default: 500)
  --pool <pool>            Pool: pump, raydium, auto

Example:
  /swarm sell ABC123... 100%
  /swarm sell ABC123... 50% --bundle`;
  }

  const mint = args[0];
  const amountArg = args[1];

  // Parse options
  let walletIds: string[] | undefined;
  let useBundle: boolean | undefined;
  let slippageBps: number | undefined;
  let pool: string | undefined;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--wallets' && args[i + 1]) {
      walletIds = parseWalletIds(args[++i]);
    } else if (args[i] === '--bundle') {
      useBundle = true;
    } else if (args[i] === '--sequential') {
      useBundle = false;
    } else if (args[i] === '--slippage' && args[i + 1]) {
      slippageBps = parseInt(args[++i]);
    } else if (args[i] === '--pool' && args[i + 1]) {
      pool = args[++i];
    }
  }

  const swarm = getSwarm();

  // Check swarm position
  const position = swarm.getSwarmPosition(mint);
  if (position.totalAmount === 0) {
    return `No swarm position found for \`${mint.slice(0, 30)}...\``;
  }

  let preview = `**Swarm Sell Preview**\n\n`;
  preview += `Token: \`${mint.slice(0, 30)}...\`\n`;
  preview += `Amount: ${amountArg}\n`;
  preview += `Current Position: ${formatTokens(position.totalAmount)} tokens\n`;
  preview += `Wallets with position: ${position.byWallet.size}\n`;
  preview += `Mode: ${useBundle === false ? 'Sequential' : 'Bundle (atomic)'}\n\n`;
  preview += `Executing...\n\n`;

  const params: SwarmTradeParams = {
    mint,
    action: 'sell',
    amountPerWallet: amountArg,
    denominatedInSol: false,
    slippageBps,
    pool,
    useBundle,
    walletIds,
  };

  const result = await swarm.coordinatedSell(params);
  return preview + formatTradeResult(result);
}

async function handlePosition(mint: string): Promise<string> {
  if (!mint) return 'Usage: /swarm position <mint>';

  const swarm = getSwarm();
  const position = swarm.getSwarmPosition(mint);

  if (position.totalAmount === 0) {
    return `No swarm position for \`${mint.slice(0, 30)}...\``;
  }

  let output = `**Swarm Position**\n\n`;
  output += `Token: \`${mint}\`\n`;
  output += `Total: **${formatTokens(position.totalAmount)}** tokens\n\n`;
  output += `**By Wallet:**\n`;

  for (const [walletId, amount] of position.byWallet) {
    const pct = (amount / position.totalAmount * 100).toFixed(1);
    output += `  ${walletId}: ${formatTokens(amount)} (${pct}%)\n`;
  }

  return output;
}

async function handleHelp(): Promise<string> {
  return `**Pump.fun Swarm Trading**

**Wallet Management:**
  /swarm wallets              List swarm wallets
  /swarm balances             Check SOL balances
  /swarm enable <id>          Enable wallet
  /swarm disable <id>         Disable wallet

**Trading:**
  /swarm buy <mint> <sol>     Buy on all wallets
  /swarm sell <mint> <amt|%>  Sell from all wallets
  /swarm position <mint>      Check swarm position

**Options:**
  --wallets <id1,id2>   Specific wallets
  --bundle              Force atomic execution
  --sequential          Force sequential
  --slippage <bps>      Slippage in basis points
  --pool <pool>         Pool: pump, raydium, auto

**Setup:**
  export SOLANA_PRIVATE_KEY="main-key"
  export SOLANA_SWARM_KEY_1="key-2"
  export SOLANA_SWARM_KEY_2="key-3"

**Examples:**
  /swarm buy ABC... 0.1              # 0.1 SOL each wallet
  /swarm sell ABC... 100% --bundle   # Sell all atomically`;
}

// ============================================================================
// Main Execute Function
// ============================================================================

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    case 'wallets':
      return handleWallets();
    case 'balances':
      return handleBalances();
    case 'enable':
      return handleEnable(rest[0]);
    case 'disable':
      return handleDisable(rest[0]);
    case 'buy':
      return handleBuy(rest);
    case 'sell':
      return handleSell(rest);
    case 'position':
      return handlePosition(rest[0]);
    case 'help':
    default:
      return handleHelp();
  }
}

export default { execute };
