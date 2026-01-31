/**
 * Meteora DLMM CLI Skill
 */

const getSolanaModules = async () => {
  const [wallet, meteora, tokenlist] = await Promise.all([
    import('../../../solana/wallet'),
    import('../../../solana/meteora'),
    import('../../../solana/tokenlist'),
  ]);
  return { wallet, meteora, tokenlist };
};

function isConfigured(): boolean {
  return !!(process.env.SOLANA_PRIVATE_KEY || process.env.SOLANA_KEYPAIR_PATH);
}

async function handleSwap(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /met swap <amount> <from> to <to>';
  }

  const amount = args[0];
  const fromToken = args.slice(1, toIndex).join(' ');
  const toToken = args.slice(toIndex + 1).join(' ');

  try {
    const { wallet, meteora, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [fromMint, toMint] = await tokenlist.resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens.`;
    }

    // Find best DLMM pool
    const pools = await meteora.listMeteoraDlmmPools(connection, { tokenMints: [fromMint, toMint], limit: 1 });
    if (pools.length === 0) {
      return `No Meteora DLMM pool found for ${fromToken}/${toToken}`;
    }

    const result = await meteora.executeMeteoraDlmmSwap(connection, keypair, {
      poolAddress: pools[0].address,
      inputMint: fromMint,
      outputMint: toMint,
      inAmount: amount,
      slippageBps: 50,
    });

    return `**Meteora Swap Complete**\n\n` +
      `${fromToken} -> ${toToken}\n` +
      `In: ${result.inAmount}\n` +
      `Out: ${result.outAmount}\n` +
      `TX: \`${result.txId}\``;
  } catch (error) {
    return `Swap failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleQuote(args: string[]): Promise<string> {
  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /met quote <amount> <from> to <to>';
  }

  const amount = args[0];
  const fromToken = args.slice(1, toIndex).join(' ');
  const toToken = args.slice(toIndex + 1).join(' ');

  try {
    const { wallet, meteora, tokenlist } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const [fromMint, toMint] = await tokenlist.resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens.`;
    }

    const pools = await meteora.listMeteoraDlmmPools(connection, { tokenMints: [fromMint, toMint], limit: 1 });
    if (pools.length === 0) {
      return `No Meteora pool found for ${fromToken}/${toToken}`;
    }

    const quote = await meteora.getMeteoraDlmmQuote(connection, {
      poolAddress: pools[0].address,
      inputMint: fromMint,
      inAmount: amount,
    });

    return `**Meteora Quote**\n\n` +
      `${amount} ${fromToken} -> ${toToken}\n` +
      `Output: ${quote.outAmount}\n` +
      `Pool: \`${pools[0].address.slice(0, 16)}...\``;
  } catch (error) {
    return `Quote failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePools(token: string): Promise<string> {
  if (!token) {
    return 'Usage: /met pools <token>';
  }

  try {
    const { wallet, meteora, tokenlist } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const [mint] = await tokenlist.resolveTokenMints([token]);
    if (!mint) {
      return `Could not resolve token: ${token}`;
    }

    const pools = await meteora.listMeteoraDlmmPools(connection, { tokenMints: [mint], limit: 15, includeLiquidity: true });

    if (pools.length === 0) {
      return `No Meteora DLMM pools found for ${token}`;
    }

    let output = `**Meteora DLMM Pools for ${token}** (${pools.length})\n\n`;
    for (const pool of pools.slice(0, 10)) {
      output += `Pool: \`${pool.address.slice(0, 20)}...\`\n`;
      if (pool.binStep) output += `  Bin Step: ${pool.binStep}\n`;
      if (pool.liquidity) output += `  Liquidity: $${pool.liquidity.toLocaleString()}\n`;
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    case 'swap':
      return handleSwap(rest);
    case 'quote':
      return handleQuote(rest);
    case 'pools':
      return handlePools(rest.join(' '));
    case 'help':
    default:
      return `**Meteora DLMM**

/met swap <amount> <from> to <to>   Execute swap
/met quote <amount> <from> to <to>  Get quote
/met pools <token>                  List DLMM pools

**Examples:**
  /met swap 1 SOL to USDC
  /met pools SOL`;
  }
}

export default { execute };
