/**
 * Jupiter CLI Skill
 *
 * Commands:
 * /jup swap <amount> <from> to <to> - Execute swap
 * /jup quote <amount> <from> to <to> - Get quote
 * /jup route <from> <to> <amount> - Show route details
 */

const getSolanaModules = async () => {
  const [wallet, jupiter, tokenlist] = await Promise.all([
    import('../../../solana/wallet'),
    import('../../../solana/jupiter'),
    import('../../../solana/tokenlist'),
  ]);
  return { wallet, jupiter, tokenlist };
};

function isConfigured(): boolean {
  return !!(process.env.SOLANA_PRIVATE_KEY || process.env.SOLANA_KEYPAIR_PATH);
}

async function handleSwap(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /jup swap <amount> <from> to <to>';
  }

  const amount = args[0];
  const fromToken = args.slice(1, toIndex).join(' ');
  const toToken = args.slice(toIndex + 1).join(' ');

  try {
    const { wallet, jupiter, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [fromMint, toMint] = await tokenlist.resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens. Use symbols like SOL, USDC, JUP.`;
    }

    const result = await jupiter.executeJupiterSwap(connection, keypair, {
      inputMint: fromMint,
      outputMint: toMint,
      amount,
      slippageBps: 50,
    });

    return `**Jupiter Swap Complete**\n\n` +
      `${fromToken} -> ${toToken}\n` +
      `In: ${result.inAmount}\n` +
      `Out: ${result.outAmount}\n` +
      `Price Impact: ${result.priceImpactPct || 'N/A'}%\n` +
      `Route: ${result.routePlan?.map((r: { swapInfo?: { label?: string } }) => r.swapInfo?.label).join(' -> ') || 'Direct'}\n` +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return `Swap failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleQuote(args: string[]): Promise<string> {
  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /jup quote <amount> <from> to <to>';
  }

  const amount = args[0];
  const fromToken = args.slice(1, toIndex).join(' ');
  const toToken = args.slice(toIndex + 1).join(' ');

  try {
    const { tokenlist } = await getSolanaModules();

    const [fromMint, toMint] = await tokenlist.resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens.`;
    }

    // Jupiter quote API
    const url = `https://quote-api.jup.ag/v6/quote?inputMint=${fromMint}&outputMint=${toMint}&amount=${amount}&slippageBps=50`;
    const response = await fetch(url);
    const data = await response.json() as { outAmount?: string; priceImpactPct?: string; routePlan?: unknown[] };

    if (!data.outAmount) {
      return `No quote available for ${fromToken} -> ${toToken}`;
    }

    return `**Jupiter Quote**\n\n` +
      `${amount} ${fromToken} -> ${toToken}\n` +
      `Output: ${data.outAmount}\n` +
      `Price Impact: ${data.priceImpactPct || 'N/A'}%\n` +
      `Route: ${data.routePlan?.length || 1} hops`;
  } catch (error) {
    return `Quote failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleRoute(from: string, to: string, amount: string): Promise<string> {
  if (!from || !to) {
    return 'Usage: /jup route <from> <to> <amount>';
  }

  try {
    const { tokenlist } = await getSolanaModules();

    const [fromMint, toMint] = await tokenlist.resolveTokenMints([from, to]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens.`;
    }

    const url = `https://quote-api.jup.ag/v6/quote?inputMint=${fromMint}&outputMint=${toMint}&amount=${amount || '1000000000'}&slippageBps=50`;
    const response = await fetch(url);
    const data = await response.json() as { outAmount?: string; priceImpactPct?: string; routePlan?: Array<{ swapInfo?: { label?: string; inputMint?: string; outputMint?: string } }> };

    if (!data.routePlan) {
      return `No route found for ${from} -> ${to}`;
    }

    let output = `**Jupiter Route: ${from} -> ${to}**\n\n`;
    output += `Output: ${data.outAmount}\n`;
    output += `Price Impact: ${data.priceImpactPct || 'N/A'}%\n\n`;
    output += `**Route Steps:**\n`;

    for (const step of data.routePlan || []) {
      const info = step.swapInfo || {};
      output += `- ${info.label || 'Unknown'}: ${info.inputMint?.slice(0, 8)}... -> ${info.outputMint?.slice(0, 8)}...\n`;
    }

    return output;
  } catch (error) {
    return `Route failed: ${error instanceof Error ? error.message : String(error)}`;
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

    case 'route':
      return handleRoute(rest[0], rest[1], rest[2]);

    case 'help':
    default:
      return `**Jupiter Aggregator**

/jup swap <amount> <from> to <to>   Execute swap
/jup quote <amount> <from> to <to>  Get quote
/jup route <from> <to> [amount]     Show route details

**Examples:**
  /jup swap 1 SOL to USDC
  /jup quote 100 USDC to JUP
  /jup route SOL BONK 1000000000`;
  }
}

export default { execute };
