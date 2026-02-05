/**
 * Raydium CLI Skill - Complete CLMM + AMM Support (16 commands)
 *
 * Swaps:
 * /ray swap <amount> <from> to <to>   - Execute swap via REST API
 * /ray quote <amount> <from> to <to>  - Get quote
 * /ray clmm-swap <pool> <amt> <mint>  - Direct CLMM swap
 *
 * Pool Discovery:
 * /ray pools <token>                  - List pools (legacy API)
 * /ray sdk-pools [type] [token]       - List pools (SDK)
 * /ray pool-info <poolId>             - Get pool details
 * /ray configs                        - List CLMM fee configs
 *
 * CLMM (Concentrated Liquidity):
 * /ray positions [poolId]             - List your CLMM positions
 * /ray open <pool> <lower> <upper> <amount> - Open position
 * /ray add <pool> <nft> <amount>      - Add liquidity to position
 * /ray remove <pool> <nft> [%]        - Remove liquidity
 * /ray close <pool> <nft>             - Close empty position
 * /ray harvest [poolId]               - Harvest all rewards
 * /ray create-pool <A> <B> <price>    - Create CLMM pool
 *
 * AMM:
 * /ray amm-add <pool> <amount>        - Add AMM liquidity
 * /ray amm-remove <pool> <lp-amount>  - Remove AMM liquidity
 */

const getSolanaModules = async () => {
  const [wallet, raydium, tokenlist] = await Promise.all([
    import('../../../solana/wallet'),
    import('../../../solana/raydium'),
    import('../../../solana/tokenlist'),
  ]);
  return { wallet, raydium, tokenlist };
};

function isConfigured(): boolean {
  return !!(process.env.SOLANA_PRIVATE_KEY || process.env.SOLANA_KEYPAIR_PATH);
}

function formatPrice(price: number): string {
  if (price < 0.000001) return price.toExponential(2);
  if (price < 0.01) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}

// ============================================================================
// Swap Handlers
// ============================================================================

async function handleSwap(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Raydium not configured. Set SOLANA_PRIVATE_KEY.';
  }

  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /ray swap <amount> <from> to <to>';
  }

  const amount = args[0];
  const fromToken = args.slice(1, toIndex).join(' ');
  const toToken = args.slice(toIndex + 1).join(' ');

  try {
    const { wallet, raydium, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [fromMint, toMint] = await tokenlist.resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens.`;
    }

    const tokens = await tokenlist.getTokenList();
    const fromDecimals = tokens.find(t => t.address === fromMint)?.decimals ?? 9;
    const toDecimals = tokens.find(t => t.address === toMint)?.decimals ?? 9;
    const amountBaseUnits = Math.floor(parseFloat(amount) * Math.pow(10, fromDecimals)).toString();

    const result = await raydium.executeRaydiumSwap(connection, keypair, {
      inputMint: fromMint,
      outputMint: toMint,
      amount: amountBaseUnits,
      slippageBps: 50,
    });

    const outHuman = result.outputAmount
      ? (parseFloat(result.outputAmount) / Math.pow(10, toDecimals)).toFixed(Math.min(toDecimals, 9))
      : 'N/A';

    return `**Raydium Swap Complete**

${amount} ${fromToken} -> ${outHuman} ${toToken}
TX: \`${result.txId || result.signature}\``;
  } catch (error) {
    return `Swap failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleQuote(args: string[]): Promise<string> {
  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /ray quote <amount> <from> to <to>';
  }

  const amount = args[0];
  const fromToken = args.slice(1, toIndex).join(' ');
  const toToken = args.slice(toIndex + 1).join(' ');

  try {
    const { raydium, tokenlist } = await getSolanaModules();

    const [fromMint, toMint] = await tokenlist.resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens.`;
    }

    const tokens = await tokenlist.getTokenList();
    const fromDecimals = tokens.find(t => t.address === fromMint)?.decimals ?? 9;
    const toDecimals = tokens.find(t => t.address === toMint)?.decimals ?? 9;
    const amountBaseUnits = Math.floor(parseFloat(amount) * Math.pow(10, fromDecimals)).toString();

    const quote = await raydium.getRaydiumQuote({
      inputMint: fromMint,
      outputMint: toMint,
      amount: amountBaseUnits,
    });

    const outHuman = quote.outAmount
      ? (parseFloat(quote.outAmount) / Math.pow(10, toDecimals)).toFixed(Math.min(toDecimals, 9))
      : 'N/A';
    const minOutHuman = quote.minOutAmount
      ? (parseFloat(quote.minOutAmount) / Math.pow(10, toDecimals)).toFixed(Math.min(toDecimals, 9))
      : 'N/A';

    return `**Raydium Quote**

${amount} ${fromToken} -> ${toToken}
Output: ${outHuman} ${toToken}
Min Output: ${minOutHuman} ${toToken}
Price Impact: ${quote.priceImpact ?? 'N/A'}%`;
  } catch (error) {
    return `Quote failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePools(token: string): Promise<string> {
  if (!token) {
    return 'Usage: /ray pools <token>';
  }

  try {
    const { raydium, tokenlist } = await getSolanaModules();

    const [mint] = await tokenlist.resolveTokenMints([token]);
    if (!mint) {
      return `Could not resolve token: ${token}`;
    }

    const pools = await raydium.listRaydiumPools({ tokenMints: [mint], limit: 15 });

    if (pools.length === 0) {
      return `No Raydium pools found for ${token}`;
    }

    let output = `**Raydium Pools for ${token}** (${pools.length})\n\n`;
    for (const pool of pools.slice(0, 10)) {
      const poolType = pool.type || 'AMM';
      output += `**${poolType}** \`${pool.id?.slice(0, 16) || pool.address?.slice(0, 16)}...\`\n`;
      if (pool.liquidity) output += `  Liquidity: $${pool.liquidity.toLocaleString()}\n`;
      if (pool.volume24h) output += `  24h Volume: $${pool.volume24h.toLocaleString()}\n`;
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// CLMM Position Handlers
// ============================================================================

async function handlePositions(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Raydium not configured. Set SOLANA_PRIVATE_KEY.';
  }

  const poolId = args[0]; // Optional filter

  try {
    const { wallet, raydium } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const positions = await raydium.getClmmPositions(connection, keypair, poolId);

    if (!positions || positions.length === 0) {
      return `**CLMM Positions**

No positions found.${poolId ? ` (filtered by pool ${poolId.slice(0, 12)}...)` : ''}`;
    }

    let output = `**CLMM Positions** (${positions.length})\n\n`;

    for (const pos of positions.slice(0, 10)) {
      output += `**Position** \`${pos.nftMint?.slice(0, 12) || 'N/A'}...\`\n`;
      output += `  Pool: \`${pos.poolId?.slice(0, 12) || 'N/A'}...\`\n`;
      output += `  Liquidity: ${pos.liquidity || 'N/A'}\n`;
      if (pos.tickLower !== undefined && pos.tickUpper !== undefined) {
        output += `  Tick Range: ${pos.tickLower} - ${pos.tickUpper}\n`;
      }
      if (pos.tokenA && pos.tokenB) {
        output += `  Tokens: ${pos.tokenA.slice(0, 8)}... / ${pos.tokenB.slice(0, 8)}...\n`;
      }
      if (pos.feeOwedA || pos.feeOwedB) {
        output += `  Fees Owed: ${pos.feeOwedA || '0'} / ${pos.feeOwedB || '0'}\n`;
      }
      output += '\n';
    }

    if (positions.length > 10) {
      output += `... and ${positions.length - 10} more positions`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleOpenPosition(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Raydium not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 4) {
    return `Usage: /ray open <poolId> <priceLower> <priceUpper> <amount>

Example:
  /ray open ABC123... 100 200 1000000000`;
  }

  const [poolId, lowerStr, upperStr, amountStr] = args;
  const priceLower = parseFloat(lowerStr);
  const priceUpper = parseFloat(upperStr);

  if (isNaN(priceLower) || isNaN(priceUpper)) {
    return 'Price bounds must be numbers.';
  }

  try {
    const { wallet, raydium } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await raydium.createClmmPosition(connection, keypair, {
      poolId,
      priceLower,
      priceUpper,
      baseAmount: amountStr,
      slippage: 0.01,
    });

    return `**CLMM Position Opened**

Pool: \`${poolId.slice(0, 20)}...\`
NFT Mint: \`${result.nftMint}\`
Price Range: ${priceLower} - ${priceUpper}
TX: \`${result.signature}\``;
  } catch (error) {
    return `Open position failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleAddLiquidity(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Raydium not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 3) {
    return `Usage: /ray add <poolId> <positionNftMint> <amount>

Example:
  /ray add ABC123... NFT456... 500000000`;
  }

  const [poolId, nftMint, amountStr] = args;

  try {
    const { wallet, raydium } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await raydium.increaseClmmLiquidity(connection, keypair, {
      poolId,
      positionNftMint: nftMint,
      amountA: amountStr,
      slippage: 0.01,
    });

    return `**Liquidity Added**

Pool: \`${poolId.slice(0, 20)}...\`
Position: \`${nftMint.slice(0, 20)}...\`
TX: \`${result.signature}\``;
  } catch (error) {
    return `Add liquidity failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleRemoveLiquidity(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Raydium not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return `Usage: /ray remove <poolId> <positionNftMint> [percentage]

Examples:
  /ray remove ABC123... NFT456...       (remove all)
  /ray remove ABC123... NFT456... 50    (remove 50%)`;
  }

  const [poolId, nftMint, pctStr] = args;
  const percentage = pctStr ? parseInt(pctStr) : 100;

  try {
    const { wallet, raydium } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await raydium.decreaseClmmLiquidity(connection, keypair, {
      poolId,
      positionNftMint: nftMint,
      percentBps: percentage * 100, // Convert percent to basis points
      slippage: 0.01,
    });

    return `**Liquidity Removed** (${percentage}%)

Pool: \`${poolId.slice(0, 20)}...\`
Position: \`${nftMint.slice(0, 20)}...\`
Amount A: ${result.amountA}
Amount B: ${result.amountB}
TX: \`${result.signature}\``;
  } catch (error) {
    return `Remove liquidity failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleClosePosition(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Raydium not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /ray close <poolId> <positionNftMint>';
  }

  const [poolId, nftMint] = args;

  try {
    const { wallet, raydium } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await raydium.closeClmmPosition(connection, keypair, poolId, nftMint);

    return `**Position Closed**

Pool: \`${poolId.slice(0, 20)}...\`
Position: \`${nftMint.slice(0, 20)}...\`
TX: \`${result.signature}\``;
  } catch (error) {
    return `Close position failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleHarvest(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Raydium not configured. Set SOLANA_PRIVATE_KEY.';
  }

  const poolId = args[0]; // Optional filter

  try {
    const { wallet, raydium } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await raydium.harvestClmmRewards(connection, keypair, poolId);

    if (!result.signatures || result.signatures.length === 0) {
      return `**No Rewards to Harvest**

No pending rewards found.${poolId ? ` (pool: ${poolId.slice(0, 12)}...)` : ''}`;
    }

    return `**Rewards Harvested**

Transactions: ${result.signatures.length}
${result.signatures.map((sig, i) => `${i + 1}. \`${sig}\``).join('\n')}`;
  } catch (error) {
    return `Harvest failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// AMM Handlers
// ============================================================================

async function handleAmmAdd(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Raydium not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return `Usage: /ray amm-add <poolId> <amountA> [amountB]

Example:
  /ray amm-add ABC123... 1000000000`;
  }

  const [poolId, amountA, amountB] = args;

  try {
    const { wallet, raydium } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await raydium.addAmmLiquidity(connection, keypair, {
      poolId,
      amountA,
      amountB,
      fixedSide: 'a',
      slippage: 0.01,
    });

    return `**AMM Liquidity Added**

Pool: \`${poolId.slice(0, 20)}...\`
LP Tokens: ${result.lpAmount}
TX: \`${result.signature}\``;
  } catch (error) {
    return `AMM add failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleAmmRemove(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Raydium not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return `Usage: /ray amm-remove <poolId> <lpAmount>

Example:
  /ray amm-remove ABC123... 1000000`;
  }

  const [poolId, lpAmount] = args;

  try {
    const { wallet, raydium } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await raydium.removeAmmLiquidity(connection, keypair, {
      poolId,
      lpAmount,
      slippage: 0.1,
    });

    return `**AMM Liquidity Removed**

Pool: \`${poolId.slice(0, 20)}...\`
Amount A: ${result.amountA}
Amount B: ${result.amountB}
TX: \`${result.signature}\``;
  } catch (error) {
    return `AMM remove failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleConfigs(): Promise<string> {
  try {
    const { wallet, raydium } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const configs = await raydium.getClmmConfigs(connection);

    if (!configs || configs.length === 0) {
      return 'No CLMM configs found.';
    }

    let output = '**Raydium CLMM Fee Configs**\n\n';
    for (const config of configs.slice(0, 15)) {
      output += `ID: \`${config.id.slice(0, 16)}...\`\n`;
      output += `  Index: ${config.index}\n`;
      output += `  Tick Spacing: ${config.tickSpacing}\n`;
      output += `  Trade Fee: ${(config.tradeFeeRate / 10000).toFixed(2)}%\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePoolInfo(poolId: string): Promise<string> {
  if (!poolId) {
    return 'Usage: /ray pool-info <poolId>';
  }

  try {
    const { wallet, raydium } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const pool = await raydium.getRaydiumPoolInfoSdk(connection, poolId);

    if (!pool) {
      return `Pool not found: ${poolId}`;
    }

    let output = `**Pool Info**\n\n`;
    output += `ID: \`${pool.id}\`\n`;
    output += `Type: ${pool.type}\n`;
    output += `Pair: ${pool.symbolA || pool.mintA.slice(0, 8)}... / ${pool.symbolB || pool.mintB.slice(0, 8)}...\n`;
    if (pool.price) output += `Price: ${formatPrice(pool.price)}\n`;
    if (pool.tvl) output += `TVL: $${pool.tvl.toLocaleString()}\n`;
    if (pool.volume24h) output += `24h Volume: $${pool.volume24h.toLocaleString()}\n`;
    if (pool.feeRate) output += `Fee: ${(pool.feeRate * 100).toFixed(2)}%\n`;

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleSdkPools(args: string[]): Promise<string> {
  // /ray sdk-pools [type] [token]
  const poolType = args[0]?.toUpperCase() as 'CLMM' | 'AMM' | 'CPMM' | 'all' | undefined;
  const token = args[1];

  try {
    const { wallet, raydium, tokenlist } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    let tokenMint: string | undefined;
    if (token) {
      const [mint] = await tokenlist.resolveTokenMints([token]);
      tokenMint = mint || undefined;
    }

    const pools = await raydium.listRaydiumPoolsSdk(connection, {
      type: poolType || 'all',
      tokenMint,
      limit: 20,
    });

    if (!pools || pools.length === 0) {
      return 'No pools found.';
    }

    let output = `**Raydium Pools** (${pools.length})\n\n`;
    for (const pool of pools.slice(0, 15)) {
      output += `**${pool.type}** \`${pool.id.slice(0, 16)}...\`\n`;
      output += `  ${pool.symbolA || '?'}/${pool.symbolB || '?'}\n`;
      if (pool.tvl) output += `  TVL: $${pool.tvl.toLocaleString()}\n`;
      if (pool.volume24h) output += `  Vol: $${pool.volume24h.toLocaleString()}\n`;
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleClmmSwap(args: string[]): Promise<string> {
  // /ray clmm-swap <poolId> <amount> <inputMint>
  if (!isConfigured()) {
    return 'Raydium not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 3) {
    return 'Usage: /ray clmm-swap <poolId> <amount> <inputMint>';
  }

  const [poolId, amount, inputMint] = args;

  try {
    const { wallet, raydium } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await raydium.swapClmm(connection, keypair, {
      poolId,
      amountIn: amount,
      inputMint,
      slippage: 0.01,
    });

    return `**CLMM Swap Complete**\n\n` +
      `Input: ${result.inputAmount}\n` +
      `Output: ${result.outputAmount}\n` +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return `CLMM swap failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCreatePool(args: string[]): Promise<string> {
  // /ray create-pool <mintA> <mintB> <initialPrice> [configIndex]
  if (!isConfigured()) {
    return 'Raydium not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 3) {
    return 'Usage: /ray create-pool <tokenA> <tokenB> <initialPrice> [configIndex]';
  }

  const [tokenA, tokenB, priceStr, configIndexStr] = args;
  const initialPrice = parseFloat(priceStr);
  const configIndex = configIndexStr ? parseInt(configIndexStr, 10) : 0;

  if (isNaN(initialPrice)) {
    return 'Initial price must be a number.';
  }

  try {
    const { wallet, raydium, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [mintA, mintB] = await tokenlist.resolveTokenMints([tokenA, tokenB]);
    if (!mintA || !mintB) {
      return `Could not resolve tokens: ${tokenA}, ${tokenB}`;
    }

    const result = await raydium.createClmmPool(connection, keypair, {
      mintA,
      mintB,
      initialPrice,
      configIndex,
    });

    return `**CLMM Pool Created**\n\n` +
      `Pool ID: \`${result.poolId}\`\n` +
      `Pair: ${tokenA}/${tokenB}\n` +
      `Initial Price: ${initialPrice}\n` +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return `Create pool failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Main Execute
// ============================================================================

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    // Swaps
    case 'swap':
      return handleSwap(rest);
    case 'quote':
      return handleQuote(rest);
    case 'pools':
      return handlePools(rest.join(' '));

    // CLMM Positions
    case 'positions':
      return handlePositions(rest);
    case 'open':
      return handleOpenPosition(rest);
    case 'add':
      return handleAddLiquidity(rest);
    case 'remove':
      return handleRemoveLiquidity(rest);
    case 'close':
      return handleClosePosition(rest);
    case 'harvest':
      return handleHarvest(rest);
    case 'configs':
      return handleConfigs();

    // AMM
    case 'amm-add':
      return handleAmmAdd(rest);
    case 'amm-remove':
      return handleAmmRemove(rest);

    // Pool Discovery (SDK)
    case 'pool-info':
      return handlePoolInfo(rest.join(' '));
    case 'sdk-pools':
      return handleSdkPools(rest);

    // Direct CLMM Operations
    case 'clmm-swap':
      return handleClmmSwap(rest);
    case 'create-pool':
      return handleCreatePool(rest);

    case 'help':
    default:
      return `**Raydium DEX** (16 Commands)

**Swaps:**
  /ray swap <amount> <from> to <to>    Execute swap via REST API
  /ray quote <amount> <from> to <to>   Get quote
  /ray clmm-swap <pool> <amt> <mint>   Direct CLMM swap

**Pool Discovery:**
  /ray pools <token>                   List pools (legacy API)
  /ray sdk-pools [type] [token]        List pools (SDK, type=CLMM/AMM/CPMM)
  /ray pool-info <poolId>              Get pool details
  /ray configs                         List CLMM fee configs

**CLMM (Concentrated Liquidity):**
  /ray positions [poolId]              List your positions
  /ray open <pool> <lower> <upper> <amount>  Open position
  /ray add <pool> <nft> <amount>       Add liquidity
  /ray remove <pool> <nft> [%]         Remove liquidity
  /ray close <pool> <nft>              Close position
  /ray harvest [poolId]                Harvest all rewards
  /ray create-pool <A> <B> <price> [cfg]  Create CLMM pool

**AMM Liquidity:**
  /ray amm-add <pool> <amount>         Add AMM liquidity
  /ray amm-remove <pool> <lp-amount>   Remove AMM liquidity

**Examples:**
  /ray swap 1 SOL to USDC
  /ray sdk-pools CLMM SOL
  /ray positions`;
  }
}

export default {
  name: 'raydium',
  description: 'Raydium DEX - swaps, CLMM positions, AMM liquidity on Solana',
  commands: ['/raydium', '/ray'],
  handle: execute,
};
