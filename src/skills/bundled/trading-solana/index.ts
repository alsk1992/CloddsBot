/**
 * Solana DEX Trading CLI Skill
 *
 * Commands:
 * /sol swap <amount> <from> to <to> - Execute swap
 * /sol quote <amount> <from> to <to> - Get quote
 * /sol pools <token> - List pools for token
 * /sol balance - Check balances
 * /sol address - Show wallet address
 * /sol route <from> <to> - Find best route
 */

import { logger } from '../../../utils/logger';

// Lazy load Solana modules
const getSolanaModules = async () => {
  const [wallet, jupiter, raydium, orca, meteora, pools, tokenlist] = await Promise.all([
    import('../../../solana/wallet'),
    import('../../../solana/jupiter'),
    import('../../../solana/raydium'),
    import('../../../solana/orca'),
    import('../../../solana/meteora'),
    import('../../../solana/pools'),
    import('../../../solana/tokenlist'),
  ]);
  return { wallet, jupiter, raydium, orca, meteora, pools, tokenlist };
};

function isConfigured(): boolean {
  return !!(process.env.SOLANA_PRIVATE_KEY || process.env.SOLANA_KEYPAIR_PATH);
}

async function handleAddress(): Promise<string> {
  if (!isConfigured()) {
    return 'Solana wallet not configured. Set SOLANA_PRIVATE_KEY or SOLANA_KEYPAIR_PATH.';
  }

  try {
    const { wallet } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    return `**Solana Wallet**\n\nAddress: \`${keypair.publicKey.toBase58()}\``;
  } catch (error) {
    return `Error loading wallet: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBalance(): Promise<string> {
  if (!isConfigured()) {
    return 'Solana wallet not configured. Set SOLANA_PRIVATE_KEY or SOLANA_KEYPAIR_PATH.';
  }

  try {
    const { wallet } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();
    const keypair = wallet.loadSolanaKeypair();
    const balance = await connection.getBalance(keypair.publicKey);
    const solBalance = balance / 1e9;

    return `**Solana Balances**\n\n` +
      `Address: \`${keypair.publicKey.toBase58()}\`\n` +
      `SOL: ${solBalance.toFixed(4)}`;
  } catch (error) {
    return `Error fetching balance: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleSwap(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Solana wallet not configured. Set SOLANA_PRIVATE_KEY or SOLANA_KEYPAIR_PATH.';
  }

  // Parse: <amount> <from> to <to>
  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /sol swap <amount> <from> to <to>\nExample: /sol swap 1 SOL to USDC';
  }

  const amount = args[0];
  const fromToken = args.slice(1, toIndex).join(' ');
  const toToken = args.slice(toIndex + 1).join(' ');

  try {
    const { wallet, jupiter, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    // Resolve token symbols to mint addresses
    const [fromMint, toMint] = await tokenlist.resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve token symbols. Use mint addresses or common symbols like SOL, USDC, JUP.`;
    }

    // Use Jupiter aggregator for best route
    const result = await jupiter.executeJupiterSwap(connection, keypair, {
      inputMint: fromMint,
      outputMint: toMint,
      amount,
      slippageBps: 50, // 0.5% default
    });

    return `**Swap Executed**\n\n` +
      `From: ${fromToken}\n` +
      `To: ${toToken}\n` +
      `Amount In: ${result.inAmount}\n` +
      `Amount Out: ${result.outAmount}\n` +
      `Price Impact: ${result.priceImpactPct || 'N/A'}%\n` +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return `Swap failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleQuote(args: string[]): Promise<string> {
  // Parse: <amount> <from> to <to>
  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /sol quote <amount> <from> to <to>\nExample: /sol quote 1 SOL to USDC';
  }

  const amount = args[0];
  const fromToken = args.slice(1, toIndex).join(' ');
  const toToken = args.slice(toIndex + 1).join(' ');

  try {
    const { wallet, raydium, orca, meteora, pools, tokenlist } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    // Resolve tokens
    const [fromMint, toMint] = await tokenlist.resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve token symbols.`;
    }

    // Get quotes from multiple DEXes
    const quotes: Array<{ dex: string; outAmount: string; priceImpact?: string }> = [];

    try {
      const rayQuote = await raydium.getRaydiumQuote({
        inputMint: fromMint,
        outputMint: toMint,
        amount,
      });
      if (rayQuote?.outAmount) quotes.push({ dex: 'Raydium', outAmount: rayQuote.outAmount, priceImpact: rayQuote.priceImpact?.toString() });
    } catch { /* skip */ }

    // Find best pool and get quote
    const allPools = await pools.listAllPools(connection, {
      tokenMints: [fromMint, toMint],
      limit: 10,
    });

    for (const pool of allPools.slice(0, 3)) {
      try {
        if (pool.dex === 'meteora') {
          const quote = await meteora.getMeteoraDlmmQuote(connection, {
            poolAddress: pool.address,
            inputMint: fromMint,
            inAmount: amount,
          });
          if (quote) quotes.push({ dex: 'Meteora', outAmount: quote.outAmount });
        } else if (pool.dex === 'orca') {
          const quote = await orca.getOrcaWhirlpoolQuote({
            poolAddress: pool.address,
            inputMint: fromMint,
            amount,
          });
          if (quote) quotes.push({ dex: 'Orca', outAmount: quote.amountOut });
        }
      } catch { /* skip */ }
    }

    if (quotes.length === 0) {
      return `No quotes available for ${fromToken} -> ${toToken}`;
    }

    let output = `**Swap Quotes: ${amount} ${fromToken} -> ${toToken}**\n\n`;
    for (const q of quotes) {
      output += `**${q.dex}**: ${q.outAmount} ${toToken}`;
      if (q.priceImpact) output += ` (impact: ${q.priceImpact}%)`;
      output += '\n';
    }

    return output;
  } catch (error) {
    return `Quote failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePools(token: string): Promise<string> {
  if (!token) {
    return 'Usage: /sol pools <token>\nExample: /sol pools SOL';
  }

  try {
    const { wallet, pools, tokenlist } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    // Resolve token
    const [mint] = await tokenlist.resolveTokenMints([token]);
    if (!mint) {
      return `Could not resolve token: ${token}`;
    }

    const allPools = await pools.listAllPools(connection, {
      tokenMints: [mint],
      limit: 20,
    });

    if (allPools.length === 0) {
      return `No pools found for ${token}`;
    }

    let output = `**Pools for ${token}** (${allPools.length} found)\n\n`;
    for (const pool of allPools.slice(0, 15)) {
      output += `**${pool.dex}**: ${pool.tokenMintA?.slice(0, 8) || 'A'}/${pool.tokenMintB?.slice(0, 8) || 'B'}\n`;
      output += `  Address: \`${pool.address.slice(0, 12)}...\`\n`;
      if (pool.liquidity) output += `  Liquidity: $${pool.liquidity.toLocaleString()}\n`;
      if (pool.volume24h) output += `  24h Volume: $${pool.volume24h.toLocaleString()}\n`;
      output += '\n';
    }

    return output;
  } catch (error) {
    return `Error fetching pools: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleRoute(from: string, to: string): Promise<string> {
  if (!from || !to) {
    return 'Usage: /sol route <from> <to>\nExample: /sol route SOL USDC';
  }

  try {
    const { wallet, pools, tokenlist } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const [fromMint, toMint] = await tokenlist.resolveTokenMints([from, to]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens: ${from}, ${to}`;
    }

    const best = await pools.selectBestPool(connection, {
      tokenMints: [fromMint, toMint],
      sortBy: 'liquidity',
    });

    if (!best) {
      return `No route found for ${from} -> ${to}`;
    }

    return `**Best Route: ${from} -> ${to}**\n\n` +
      `DEX: ${best.dex || 'Unknown'}\n` +
      `Pool: \`${best.address || 'Unknown'}\`\n` +
      `Liquidity: $${(best.liquidity || 0).toLocaleString()}\n` +
      `24h Volume: $${(best.volume24h || 0).toLocaleString()}`;
  } catch (error) {
    return `Error finding route: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleDex(dex: string, subCommand: string, args: string[]): Promise<string> {
  const dexName = dex.toLowerCase();

  if (!['raydium', 'orca', 'meteora', 'ray', 'met'].includes(dexName)) {
    return `Unknown DEX: ${dex}. Use raydium, orca, or meteora.`;
  }

  if (subCommand === 'pools') {
    const token = args[0];
    if (!token) return `Usage: /sol ${dex} pools <token>`;

    try {
      const { wallet, raydium, orca, meteora, tokenlist } = await getSolanaModules();
      const connection = wallet.getSolanaConnection();

      const [mint] = await tokenlist.resolveTokenMints([token]);
      if (!mint) return `Could not resolve token: ${token}`;

      let pools: Array<{ address?: string; id?: string; liquidity?: number; volume24h?: number }> = [];

      if (dexName === 'raydium' || dexName === 'ray') {
        pools = await raydium.listRaydiumPools({ tokenMints: [mint], limit: 10 });
      } else if (dexName === 'orca') {
        pools = await orca.listOrcaWhirlpoolPools({ tokenMints: [mint], limit: 10 });
      } else if (dexName === 'meteora' || dexName === 'met') {
        pools = await meteora.listMeteoraDlmmPools(connection, { tokenMints: [mint], limit: 10 });
      }

      if (pools.length === 0) {
        return `No ${dex} pools found for ${token}`;
      }

      let output = `**${dex} Pools for ${token}**\n\n`;
      for (const pool of pools.slice(0, 10)) {
        const poolAddr = pool.address || pool.id || 'Unknown';
        output += `Address: \`${poolAddr.slice(0, 20)}...\`\n`;
        if (pool.liquidity) output += `  Liquidity: $${pool.liquidity.toLocaleString()}\n`;
        output += '\n';
      }
      return output;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return `Usage: /sol ${dex} pools <token>`;
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  try {
    switch (command) {
      case 'swap':
        return handleSwap(rest);

      case 'quote':
        return handleQuote(rest);

      case 'pools':
        return handlePools(rest.join(' '));

      case 'balance':
      case 'bal':
        return handleBalance();

      case 'address':
      case 'wallet':
        return handleAddress();

      case 'route':
        return handleRoute(rest[0], rest[1]);

      case 'raydium':
      case 'ray':
        return handleDex('Raydium', rest[0], rest.slice(1));

      case 'orca':
        return handleDex('Orca', rest[0], rest.slice(1));

      case 'meteora':
      case 'met':
        return handleDex('Meteora', rest[0], rest.slice(1));

      case 'help':
      default:
        return `**Solana DEX Trading**

**Swaps:**
  /sol swap <amount> <from> to <to>   Execute swap (uses Jupiter)
  /sol quote <amount> <from> to <to>  Get quotes from all DEXes

**Pool Discovery:**
  /sol pools <token>                  List all pools for token
  /sol route <from> <to>              Find best route

**DEX-Specific:**
  /sol raydium pools <token>          Raydium pools
  /sol orca pools <token>             Orca Whirlpools
  /sol meteora pools <token>          Meteora DLMM pools

**Wallet:**
  /sol balance                        Check SOL balance
  /sol address                        Show wallet address

**Examples:**
  /sol swap 1 SOL to USDC
  /sol quote 100 USDC to JUP
  /sol pools BONK
  /sol route SOL USDC`;
    }
  } catch (error) {
    logger.error({ error, args }, 'Solana skill error');
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export default {
  name: 'trading-solana',
  description: 'Solana DEX trading - swap, quote, pools, routes across Jupiter, Raydium, Orca, and Meteora',
  commands: ['/sol', '/trade-sol', '/tradesol'],
  handle: execute,
};
