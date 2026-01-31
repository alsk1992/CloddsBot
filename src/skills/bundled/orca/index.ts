/**
 * Orca Whirlpools CLI Skill
 */

const getSolanaModules = async () => {
  const [wallet, orca, tokenlist] = await Promise.all([
    import('../../../solana/wallet'),
    import('../../../solana/orca'),
    import('../../../solana/tokenlist'),
  ]);
  return { wallet, orca, tokenlist };
};

function isConfigured(): boolean {
  return !!(process.env.SOLANA_PRIVATE_KEY || process.env.SOLANA_KEYPAIR_PATH);
}

async function handleSwap(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Orca not configured. Set SOLANA_PRIVATE_KEY.';
  }

  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /orca swap <amount> <from> to <to>';
  }

  const amount = args[0];
  const fromToken = args.slice(1, toIndex).join(' ');
  const toToken = args.slice(toIndex + 1).join(' ');

  try {
    const { wallet, orca, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [fromMint, toMint] = await tokenlist.resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens.`;
    }

    // Find best Whirlpool for the pair
    const pools = await orca.listOrcaWhirlpoolPools({ tokenMints: [fromMint, toMint], limit: 1 });
    if (pools.length === 0) {
      return `No Orca Whirlpool found for ${fromToken}/${toToken}`;
    }

    const result = await orca.executeOrcaWhirlpoolSwap(connection, keypair, {
      poolAddress: pools[0].address,
      inputMint: fromMint,
      amount,
      slippageBps: 50,
    });

    return `**Orca Swap Complete**\n\n` +
      `${fromToken} -> ${toToken}\n` +
      `In: ${result.inputAmount}\n` +
      `Out: ${result.outputAmount}\n` +
      `TX: \`${result.txId}\``;
  } catch (error) {
    return `Swap failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleQuote(args: string[]): Promise<string> {
  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /orca quote <amount> <from> to <to>';
  }

  const amount = args[0];
  const fromToken = args.slice(1, toIndex).join(' ');
  const toToken = args.slice(toIndex + 1).join(' ');

  try {
    const { wallet, orca, tokenlist } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const [fromMint, toMint] = await tokenlist.resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens.`;
    }

    const pools = await orca.listOrcaWhirlpoolPools({ tokenMints: [fromMint, toMint], limit: 1 });
    if (pools.length === 0) {
      return `No Orca Whirlpool found for ${fromToken}/${toToken}`;
    }

    const quote = await orca.getOrcaWhirlpoolQuote({
      poolAddress: pools[0].address,
      inputMint: fromMint,
      amount,
    });

    return `**Orca Quote**\n\n` +
      `${amount} ${fromToken} -> ${toToken}\n` +
      `Output: ${quote.amountOut}\n` +
      `Pool: \`${pools[0].address.slice(0, 16)}...\``;
  } catch (error) {
    return `Quote failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePools(token: string): Promise<string> {
  if (!token) {
    return 'Usage: /orca pools <token>';
  }

  try {
    const { orca, tokenlist } = await getSolanaModules();

    const [mint] = await tokenlist.resolveTokenMints([token]);
    if (!mint) {
      return `Could not resolve token: ${token}`;
    }

    const pools = await orca.listOrcaWhirlpoolPools({ tokenMints: [mint], limit: 15 });

    if (pools.length === 0) {
      return `No Orca Whirlpools found for ${token}`;
    }

    let output = `**Orca Whirlpools for ${token}** (${pools.length})\n\n`;
    for (const pool of pools.slice(0, 10)) {
      output += `Pool: \`${pool.address.slice(0, 20)}...\`\n`;
      if (pool.liquidity) output += `  TVL: $${pool.liquidity.toLocaleString()}\n`;
      if (pool.tickSpacing) output += `  Tick Spacing: ${pool.tickSpacing}\n`;
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
      return `**Orca Whirlpools**

/orca swap <amount> <from> to <to>   Execute swap
/orca quote <amount> <from> to <to>  Get quote
/orca pools <token>                  List Whirlpools

**Examples:**
  /orca swap 1 SOL to USDC
  /orca pools ORCA`;
  }
}

export default { execute };
