/**
 * Orca Whirlpools CLI Skill
 * Full coverage of Orca SDK functions
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

// ============================================
// SWAP & QUOTE
// ============================================

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

    const pools = await orca.listOrcaWhirlpoolPools({ tokenMints: [fromMint, toMint], limit: 1 });
    if (pools.length === 0) {
      return `No Orca Whirlpool found for ${fromToken}/${toToken}`;
    }

    const tokens = await tokenlist.getTokenList();
    const fromDecimals = tokens.find(t => t.address === fromMint)?.decimals ?? 9;
    const toDecimals = tokens.find(t => t.address === toMint)?.decimals ?? 9;
    const amountBaseUnits = Math.floor(parseFloat(amount) * Math.pow(10, fromDecimals)).toString();

    const result = await orca.executeOrcaWhirlpoolSwap(connection, keypair, {
      poolAddress: pools[0].address,
      inputMint: fromMint,
      amount: amountBaseUnits,
      slippageBps: 50,
    });

    const outHuman = result.outputAmount
      ? (parseFloat(result.outputAmount) / Math.pow(10, toDecimals)).toFixed(Math.min(toDecimals, 9))
      : 'N/A';

    return `**Orca Swap Complete**\n\n` +
      `${amount} ${fromToken} -> ${outHuman} ${toToken}\n` +
      `TX: \`${result.txId || result.signature}\``;
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

    const tokens = await tokenlist.getTokenList();
    const fromDecimals = tokens.find(t => t.address === fromMint)?.decimals ?? 9;
    const toDecimals = tokens.find(t => t.address === toMint)?.decimals ?? 9;
    const amountBaseUnits = Math.floor(parseFloat(amount) * Math.pow(10, fromDecimals)).toString();

    const quote = await orca.getOrcaWhirlpoolQuote({
      poolAddress: pools[0].address,
      inputMint: fromMint,
      amount: amountBaseUnits,
    });

    const outHuman = quote.amountOut
      ? (parseFloat(quote.amountOut) / Math.pow(10, toDecimals)).toFixed(Math.min(toDecimals, 9))
      : 'N/A';

    return `**Orca Quote**\n\n` +
      `${amount} ${fromToken} -> ${toToken}\n` +
      `Output: ${outHuman} ${toToken}\n` +
      `Pool: \`${pools[0].address.slice(0, 16)}...\``;
  } catch (error) {
    return `Quote failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================
// POOL DISCOVERY
// ============================================

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

async function handlePairPools(args: string[]): Promise<string> {
  // /orca pair-pools <tokenA> <tokenB>
  if (args.length < 2) {
    return 'Usage: /orca pair-pools <tokenA> <tokenB>';
  }

  const tokenA = args[0];
  const tokenB = args.slice(1).join(' ');

  try {
    const { wallet, orca, tokenlist } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const [mintA, mintB] = await tokenlist.resolveTokenMints([tokenA, tokenB]);
    if (!mintA || !mintB) {
      return `Could not resolve tokens: ${tokenA}, ${tokenB}`;
    }

    const pools = await orca.fetchOrcaWhirlpoolsByTokenPair(connection, mintA, mintB);

    if (pools.length === 0) {
      return `No Whirlpools found for ${tokenA}/${tokenB}`;
    }

    let output = `**Whirlpools for ${tokenA}/${tokenB}** (${pools.length})\n\n`;
    for (const pool of pools) {
      output += `\`${pool.address}\`\n`;
      if (pool.tickSpacing) output += `  Tick Spacing: ${pool.tickSpacing}\n`;
      if (pool.liquidity) output += `  Liquidity: ${pool.liquidity.toLocaleString()}\n`;
      if (pool.price) output += `  Price: ${pool.price}\n`;
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================
// POSITION MANAGEMENT
// ============================================

async function handlePositions(_args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Orca not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, orca } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const positions = await orca.fetchOrcaPositionsForOwner(connection, keypair.publicKey.toBase58());

    if (positions.length === 0) {
      return 'No Orca Whirlpool positions found.';
    }

    let output = `**Your Orca Positions** (${positions.length})\n\n`;
    for (const pos of positions) {
      output += `Position: \`${pos.address.slice(0, 20)}...\`\n`;
      output += `  Pool: \`${pos.whirlpool.slice(0, 16)}...\`\n`;
      output += `  Ticks: ${pos.tickLowerIndex} to ${pos.tickUpperIndex}\n`;
      output += `  Liquidity: ${pos.liquidity}\n`;
      if (pos.feeOwedA !== '0' || pos.feeOwedB !== '0') {
        output += `  Fees Owed: A=${pos.feeOwedA}, B=${pos.feeOwedB}\n`;
      }
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePoolPositions(poolAddress: string): Promise<string> {
  if (!poolAddress) {
    return 'Usage: /orca pool-positions <poolAddress>';
  }

  try {
    const { wallet, orca } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const positions = await orca.fetchOrcaPositionsInWhirlpool(connection, poolAddress);

    if (positions.length === 0) {
      return `No positions found in pool ${poolAddress.slice(0, 16)}...`;
    }

    let output = `**Positions in Pool** (${positions.length})\n\n`;
    for (const pos of positions.slice(0, 20)) {
      output += `\`${pos.address.slice(0, 20)}...\`\n`;
      output += `  Ticks: ${pos.tickLowerIndex} to ${pos.tickUpperIndex}\n`;
      output += `  Liquidity: ${pos.liquidity}\n`;
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleOpenPosition(args: string[]): Promise<string> {
  // /orca open <poolAddress> <amountA> [amountB]
  if (!isConfigured()) {
    return 'Orca not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /orca open <poolAddress> <amountA> [amountB]';
  }

  const poolAddress = args[0];
  const amountA = args[1];
  const amountB = args[2];

  try {
    const { wallet, orca, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    // Default to 9 decimals (SOL standard); most Solana SPL tokens use 9
    // Orca pool API doesn't support lookup by pool address, so we pass raw amounts
    const decimals = 9;
    const tokenAmountA = Math.floor(parseFloat(amountA) * Math.pow(10, decimals)).toString();
    const tokenAmountB = amountB ? Math.floor(parseFloat(amountB) * Math.pow(10, decimals)).toString() : undefined;

    const result = await orca.openOrcaFullRangePosition(connection, keypair, {
      poolAddress,
      tokenAmountA,
      tokenAmountB,
      slippageBps: 100,
    });

    return `**Full-Range Position Opened**\n\n` +
      `Position: \`${result.positionAddress}\`\n` +
      `Position Mint: \`${result.positionMint}\`\n` +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return `Failed to open position: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleOpenConcentrated(args: string[]): Promise<string> {
  // /orca open-concentrated <poolAddress> <amountA> <tickLower> <tickUpper> [amountB]
  if (!isConfigured()) {
    return 'Orca not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 4) {
    return 'Usage: /orca open-concentrated <poolAddress> <amountA> <tickLower> <tickUpper> [amountB]';
  }

  const poolAddress = args[0];
  const amountA = args[1];
  const tickLowerIndex = parseInt(args[2], 10);
  const tickUpperIndex = parseInt(args[3], 10);
  const amountB = args[4];

  if (isNaN(tickLowerIndex) || isNaN(tickUpperIndex)) {
    return 'Invalid tick indices. Must be integers.';
  }

  try {
    const { wallet, orca, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    // Default to 9 decimals (SOL standard); most Solana SPL tokens use 9
    const decimals = 9;
    const tokenAmountA = Math.floor(parseFloat(amountA) * Math.pow(10, decimals)).toString();
    const tokenAmountB = amountB ? Math.floor(parseFloat(amountB) * Math.pow(10, decimals)).toString() : undefined;

    const result = await orca.openOrcaConcentratedPosition(connection, keypair, {
      poolAddress,
      tokenAmountA,
      tokenAmountB,
      tickLowerIndex,
      tickUpperIndex,
      slippageBps: 100,
    });

    return `**Concentrated Position Opened**\n\n` +
      `Position: \`${result.positionAddress}\`\n` +
      `Position Mint: \`${result.positionMint}\`\n` +
      `Tick Range: ${tickLowerIndex} to ${tickUpperIndex}\n` +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return `Failed to open position: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleClosePosition(positionAddress: string): Promise<string> {
  if (!isConfigured()) {
    return 'Orca not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (!positionAddress) {
    return 'Usage: /orca close <positionAddress>';
  }

  try {
    const { wallet, orca } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await orca.closeOrcaPosition(connection, keypair, positionAddress);

    return `**Position Closed**\n\n` +
      `Position: \`${result.positionAddress}\`\n` +
      (result.rentReclaimed ? `Rent Reclaimed: ${result.rentReclaimed} lamports\n` : '') +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return `Failed to close position: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================
// LIQUIDITY MANAGEMENT
// ============================================

async function handleAddLiquidity(args: string[]): Promise<string> {
  // /orca add <positionAddress> <amountA> [amountB]
  if (!isConfigured()) {
    return 'Orca not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /orca add <positionAddress> <amountA> [amountB]';
  }

  const positionAddress = args[0];
  const amountA = args[1];
  const amountB = args[2];

  try {
    const { wallet, orca } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const tokenAmountA = Math.floor(parseFloat(amountA) * 1e9).toString();
    const tokenAmountB = amountB ? Math.floor(parseFloat(amountB) * 1e9).toString() : undefined;

    const result = await orca.increaseOrcaLiquidity(connection, keypair, {
      positionAddress,
      tokenAmountA,
      tokenAmountB,
      slippageBps: 100,
    });

    return `**Liquidity Added**\n\n` +
      `Position: \`${result.positionAddress}\`\n` +
      (result.liquidityDelta ? `Liquidity Delta: ${result.liquidityDelta}\n` : '') +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return `Failed to add liquidity: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleRemoveLiquidity(args: string[]): Promise<string> {
  // /orca remove <positionAddress> <liquidityAmount>
  // or /orca remove <positionAddress> --tokens <amountA> [amountB]
  if (!isConfigured()) {
    return 'Orca not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /orca remove <positionAddress> <liquidityAmount>\n  or: /orca remove <positionAddress> --tokens <amountA> [amountB]';
  }

  const positionAddress = args[0];

  try {
    const { wallet, orca } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    let params: {
      positionAddress: string;
      tokenAmountA?: string;
      tokenAmountB?: string;
      liquidityAmount?: string;
      slippageBps?: number;
    };

    if (args[1] === '--tokens') {
      const amountA = args[2];
      const amountB = args[3];
      params = {
        positionAddress,
        tokenAmountA: Math.floor(parseFloat(amountA) * 1e9).toString(),
        tokenAmountB: amountB ? Math.floor(parseFloat(amountB) * 1e9).toString() : undefined,
        slippageBps: 100,
      };
    } else {
      params = {
        positionAddress,
        liquidityAmount: args[1],
        slippageBps: 100,
      };
    }

    const result = await orca.decreaseOrcaLiquidity(connection, keypair, params);

    return `**Liquidity Removed**\n\n` +
      `Position: \`${result.positionAddress}\`\n` +
      (result.liquidityDelta ? `Liquidity Delta: ${result.liquidityDelta}\n` : '') +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return `Failed to remove liquidity: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================
// FEES & REWARDS
// ============================================

async function handleHarvest(positionAddress: string): Promise<string> {
  if (!isConfigured()) {
    return 'Orca not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (!positionAddress) {
    return 'Usage: /orca harvest <positionAddress>';
  }

  try {
    const { wallet, orca } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await orca.harvestOrcaPosition(connection, keypair, positionAddress);

    let output = `**Fees & Rewards Harvested**\n\n`;
    output += `Position: \`${result.positionAddress}\`\n`;
    if (result.feesCollectedA) output += `Fees A: ${result.feesCollectedA}\n`;
    if (result.feesCollectedB) output += `Fees B: ${result.feesCollectedB}\n`;
    if (result.rewardsCollected && result.rewardsCollected.length > 0) {
      output += `Rewards: ${result.rewardsCollected.join(', ')}\n`;
    }
    output += `TX: \`${result.signature}\``;
    return output;
  } catch (error) {
    return `Failed to harvest: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleHarvestAll(_args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Orca not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, orca } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    // Get all positions first
    const positions = await orca.fetchOrcaPositionsForOwner(connection, keypair.publicKey.toBase58());

    if (positions.length === 0) {
      return 'No positions to harvest.';
    }

    const positionAddresses = positions.map(p => p.address);
    const results = await orca.harvestAllOrcaPositionFees(connection, keypair, positionAddresses);

    let output = `**Harvested ${results.length} Positions**\n\n`;
    let successCount = 0;
    for (const result of results) {
      if (result.signature) {
        successCount++;
        output += `\`${result.positionAddress.slice(0, 16)}...\`: TX \`${result.signature.slice(0, 16)}...\`\n`;
      } else {
        output += `\`${result.positionAddress.slice(0, 16)}...\`: Failed\n`;
      }
    }
    output += `\nSuccess: ${successCount}/${results.length}`;
    return output;
  } catch (error) {
    return `Failed to harvest: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================
// POOL CREATION
// ============================================

async function handleCreateSplashPool(args: string[]): Promise<string> {
  // /orca create-splash <tokenA> <tokenB> [initialPrice]
  if (!isConfigured()) {
    return 'Orca not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /orca create-splash <tokenA> <tokenB> [initialPrice]';
  }

  const tokenA = args[0];
  const tokenB = args[1];
  const initialPrice = args[2] ? parseFloat(args[2]) : 1.0;

  try {
    const { wallet, orca, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [mintA, mintB] = await tokenlist.resolveTokenMints([tokenA, tokenB]);
    if (!mintA || !mintB) {
      return `Could not resolve tokens: ${tokenA}, ${tokenB}`;
    }

    const result = await orca.createOrcaSplashPool(connection, keypair, {
      tokenMintA: mintA,
      tokenMintB: mintB,
      initialPrice,
    });

    return `**Splash Pool Created**\n\n` +
      `Pool: \`${result.poolAddress}\`\n` +
      `Pair: ${tokenA}/${tokenB}\n` +
      `Initial Price: ${initialPrice}\n` +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return `Failed to create pool: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCreateCLPool(args: string[]): Promise<string> {
  // /orca create-clp <tokenA> <tokenB> <tickSpacing> [initialPrice]
  if (!isConfigured()) {
    return 'Orca not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 3) {
    return 'Usage: /orca create-clp <tokenA> <tokenB> <tickSpacing> [initialPrice]';
  }

  const tokenA = args[0];
  const tokenB = args[1];
  const tickSpacing = parseInt(args[2], 10);
  const initialPrice = args[3] ? parseFloat(args[3]) : 1.0;

  if (isNaN(tickSpacing)) {
    return 'Invalid tick spacing. Must be an integer (1, 8, 64, 128).';
  }

  try {
    const { wallet, orca, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [mintA, mintB] = await tokenlist.resolveTokenMints([tokenA, tokenB]);
    if (!mintA || !mintB) {
      return `Could not resolve tokens: ${tokenA}, ${tokenB}`;
    }

    const result = await orca.createOrcaConcentratedLiquidityPool(connection, keypair, {
      tokenMintA: mintA,
      tokenMintB: mintB,
      tickSpacing,
      initialPrice,
    });

    return `**Concentrated Liquidity Pool Created**\n\n` +
      `Pool: \`${result.poolAddress}\`\n` +
      `Pair: ${tokenA}/${tokenB}\n` +
      `Tick Spacing: ${tickSpacing}\n` +
      `Initial Price: ${initialPrice}\n` +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return `Failed to create pool: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================
// MAIN EXECUTE
// ============================================

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    // Swap & Quote
    case 'swap':
      return handleSwap(rest);
    case 'quote':
      return handleQuote(rest);

    // Pool Discovery
    case 'pools':
      return handlePools(rest.join(' '));
    case 'pair-pools':
      return handlePairPools(rest);

    // Position Management
    case 'positions':
      return handlePositions(rest);
    case 'pool-positions':
      return handlePoolPositions(rest.join(' '));
    case 'open':
      return handleOpenPosition(rest);
    case 'open-concentrated':
      return handleOpenConcentrated(rest);
    case 'close':
      return handleClosePosition(rest.join(' '));

    // Liquidity
    case 'add':
      return handleAddLiquidity(rest);
    case 'remove':
      return handleRemoveLiquidity(rest);

    // Fees & Rewards
    case 'harvest':
      return handleHarvest(rest.join(' '));
    case 'harvest-all':
      return handleHarvestAll(rest);

    // Pool Creation
    case 'create-splash':
      return handleCreateSplashPool(rest);
    case 'create-clp':
      return handleCreateCLPool(rest);

    case 'help':
    default:
      return `**Orca Whirlpools** (15 commands)

**Swap & Quote**
  /orca swap <amount> <from> to <to>     Execute swap
  /orca quote <amount> <from> to <to>    Get quote

**Pool Discovery**
  /orca pools <token>                    List Whirlpools for token
  /orca pair-pools <tokenA> <tokenB>     Find pools for token pair

**Position Management**
  /orca positions                        List your positions
  /orca pool-positions <poolAddress>     List positions in a pool
  /orca open <pool> <amtA> [amtB]        Open full-range position
  /orca open-concentrated <pool> <amtA> <tickLo> <tickHi> [amtB]
  /orca close <positionAddress>          Close position

**Liquidity**
  /orca add <position> <amtA> [amtB]     Add liquidity
  /orca remove <position> <liquidity>    Remove liquidity
  /orca remove <position> --tokens <amtA> [amtB]

**Fees & Rewards**
  /orca harvest <positionAddress>        Harvest fees/rewards
  /orca harvest-all                      Harvest all positions

**Pool Creation**
  /orca create-splash <tokenA> <tokenB> [price]
  /orca create-clp <tokenA> <tokenB> <tickSpacing> [price]

**Examples:**
  /orca swap 1 SOL to USDC
  /orca positions
  /orca open 7qbRF... 1.5 100
  /orca harvest 8xPQj...`;
  }
}

export default {
  name: 'orca',
  description: 'Orca Whirlpools: swaps, positions, liquidity, fees, pool creation',
  commands: ['/orca'],
  handle: execute,
};
