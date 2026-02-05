/**
 * Meteora DLMM CLI Skill - Complete API Coverage (18 Commands)
 *
 * Swaps:
 * /met swap <amount> <from> to <to>           - Execute swap
 * /met swap-exact-out <amount> <from> to <to> - Swap for exact output
 * /met quote <amount> <from> to <to>          - Get quote
 * /met quote-exact-out <amount> <from> to <to> - Quote for exact output
 *
 * Pool Discovery:
 * /met pools <token>                          - List DLMM pools
 * /met pool-info <pool>                       - Pool details (bin, fees, emissions)
 *
 * Position Management:
 * /met positions <pool>                       - List positions in pool
 * /met all-positions                          - All positions across pools
 * /met open <pool> <amountX> <amountY> [--strategy Spot|BidAsk|Curve]
 * /met add <pool> <position> <amountX> <amountY>  - Add liquidity
 * /met remove <pool> <position> <bps>         - Remove liquidity (5000 = 50%)
 * /met close <pool> <position>                - Close position
 *
 * Fee & Reward Claims:
 * /met claim-fees <pool> <position>           - Claim swap fees
 * /met claim-all-fees <pool> <pos1,pos2,...>  - Claim all fees
 * /met claim-rewards <pool> <position>        - Claim LM rewards
 * /met claim-all <pool> <position>            - Claim fees + rewards
 *
 * Pool Creation:
 * /met create-pool <tokenX> <tokenY> --bin-step <n>
 * /met create-custom-pool <tokenX> <tokenY> --bin-step <n> [--fee <bps>]
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

// ============================================================================
// Swap Handlers
// ============================================================================

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

    const pools = await meteora.listMeteoraDlmmPools(connection, { tokenMints: [fromMint, toMint], limit: 1 });
    if (pools.length === 0) {
      return `No Meteora DLMM pool found for ${fromToken}/${toToken}`;
    }

    const tokens = await tokenlist.getTokenList();
    const fromDecimals = tokens.find(t => t.address === fromMint)?.decimals ?? 9;
    const toDecimals = tokens.find(t => t.address === toMint)?.decimals ?? 9;
    const amountBaseUnits = Math.floor(parseFloat(amount) * Math.pow(10, fromDecimals)).toString();

    const result = await meteora.executeMeteoraDlmmSwap(connection, keypair, {
      poolAddress: pools[0].address,
      inputMint: fromMint,
      outputMint: toMint,
      inAmount: amountBaseUnits,
      slippageBps: 50,
    });

    const outHuman = result.outAmount
      ? (parseFloat(result.outAmount) / Math.pow(10, toDecimals)).toFixed(Math.min(toDecimals, 9))
      : 'N/A';

    return `**Meteora Swap Complete**

${amount} ${fromToken} -> ${outHuman} ${toToken}
Pool: \`${pools[0].address.slice(0, 20)}...\`
TX: \`${result.signature}\``;
  } catch (error) {
    return `Swap failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleSwapExactOut(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /met swap-exact-out <outAmount> <from> to <to>';
  }

  const outAmountHuman = args[0];
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

    const pools = await meteora.listMeteoraDlmmPools(connection, { tokenMints: [fromMint, toMint], limit: 1 });
    if (pools.length === 0) {
      return `No Meteora DLMM pool found for ${fromToken}/${toToken}`;
    }

    const tokens = await tokenlist.getTokenList();
    const fromDecimals = tokens.find(t => t.address === fromMint)?.decimals ?? 9;
    const toDecimals = tokens.find(t => t.address === toMint)?.decimals ?? 9;
    const outAmount = Math.floor(parseFloat(outAmountHuman) * Math.pow(10, toDecimals)).toString();

    const result = await meteora.executeMeteoraDlmmSwapExactOut(connection, keypair, {
      poolAddress: pools[0].address,
      inputMint: fromMint,
      outputMint: toMint,
      inAmount: '0', // Will be calculated
      outAmount,
      slippageBps: 50,
    });

    const inHuman = result.inAmount
      ? (parseFloat(result.inAmount) / Math.pow(10, fromDecimals)).toFixed(Math.min(fromDecimals, 9))
      : 'N/A';

    return `**Meteora Swap (Exact Out) Complete**

${inHuman} ${fromToken} -> ${outAmountHuman} ${toToken}
TX: \`${result.signature}\``;
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

    const tokens = await tokenlist.getTokenList();
    const fromDecimals = tokens.find(t => t.address === fromMint)?.decimals ?? 9;
    const toDecimals = tokens.find(t => t.address === toMint)?.decimals ?? 9;
    const amountBaseUnits = Math.floor(parseFloat(amount) * Math.pow(10, fromDecimals)).toString();

    const quote = await meteora.getMeteoraDlmmQuote(connection, {
      poolAddress: pools[0].address,
      inputMint: fromMint,
      inAmount: amountBaseUnits,
    });

    const outHuman = quote.outAmount
      ? (parseFloat(quote.outAmount) / Math.pow(10, toDecimals)).toFixed(Math.min(toDecimals, 9))
      : 'N/A';
    const minOutHuman = quote.minOutAmount
      ? (parseFloat(quote.minOutAmount) / Math.pow(10, toDecimals)).toFixed(Math.min(toDecimals, 9))
      : 'N/A';

    return `**Meteora Quote**

${amount} ${fromToken} -> ${toToken}
Output: ${outHuman} ${toToken}
Min Output: ${minOutHuman} ${toToken}
${quote.priceImpact ? `Price Impact: ${(quote.priceImpact * 100).toFixed(4)}%` : ''}
Pool: \`${pools[0].address.slice(0, 16)}...\``;
  } catch (error) {
    return `Quote failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleQuoteExactOut(args: string[]): Promise<string> {
  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /met quote-exact-out <outAmount> <from> to <to>';
  }

  const outAmountHuman = args[0];
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

    const tokens = await tokenlist.getTokenList();
    const fromDecimals = tokens.find(t => t.address === fromMint)?.decimals ?? 9;
    const toDecimals = tokens.find(t => t.address === toMint)?.decimals ?? 9;
    const outAmount = Math.floor(parseFloat(outAmountHuman) * Math.pow(10, toDecimals)).toString();

    const quote = await meteora.getMeteoraDlmmQuoteExactOut(connection, {
      poolAddress: pools[0].address,
      outputMint: toMint,
      outAmount,
    });

    const inHuman = quote.inAmount
      ? (parseFloat(quote.inAmount) / Math.pow(10, fromDecimals)).toFixed(Math.min(fromDecimals, 9))
      : 'N/A';
    const maxInHuman = quote.maxInAmount
      ? (parseFloat(quote.maxInAmount) / Math.pow(10, fromDecimals)).toFixed(Math.min(fromDecimals, 9))
      : 'N/A';

    return `**Meteora Quote (Exact Out)**

${fromToken} -> ${outAmountHuman} ${toToken}
Input Required: ${inHuman} ${fromToken}
Max Input: ${maxInHuman} ${fromToken}
${quote.priceImpact ? `Price Impact: ${(quote.priceImpact * 100).toFixed(4)}%` : ''}`;
  } catch (error) {
    return `Quote failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Pool Discovery Handlers
// ============================================================================

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
      output += `  Token X: \`${pool.tokenXMint.slice(0, 12)}...\`\n`;
      output += `  Token Y: \`${pool.tokenYMint.slice(0, 12)}...\`\n`;
      if (pool.binStep) output += `  Bin Step: ${pool.binStep}\n`;
      if (pool.activeId) output += `  Active Bin: ${pool.activeId}\n`;
      if (pool.liquidity) output += `  Liquidity: $${pool.liquidity.toLocaleString()}\n`;
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePoolInfo(poolAddress: string): Promise<string> {
  if (!poolAddress) {
    return 'Usage: /met pool-info <poolAddress>';
  }

  try {
    const { wallet, meteora } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const [activeBin, feeInfo, dynamicFee, emissions] = await Promise.all([
      meteora.getMeteoraDlmmActiveBin(connection, poolAddress),
      meteora.getMeteoraDlmmFeeInfo(connection, poolAddress),
      meteora.getMeteoraDlmmDynamicFee(connection, poolAddress),
      meteora.getMeteoraDlmmEmissionRate(connection, poolAddress),
    ]);

    let output = `**Meteora Pool Info**

Pool: \`${poolAddress}\`

**Active Bin:**
  Bin ID: ${activeBin.binId}
  Price: ${activeBin.price}
  Price Per Token: ${activeBin.pricePerToken}
  X Amount: ${activeBin.xAmount}
  Y Amount: ${activeBin.yAmount}

**Fees:**
  Base Fee Rate: ${feeInfo.baseFeeRate}
  Max Fee Rate: ${feeInfo.maxFeeRate}
  Protocol Fee: ${feeInfo.protocolFeeRate}
  Dynamic Fee: ${dynamicFee}`;

    if (emissions && emissions.length > 0) {
      output += '\n\n**Emission Rates:**';
      for (const e of emissions) {
        output += `\n  Reward: \`${e.rewardMint.slice(0, 12)}...\``;
        output += `\n  Rate: ${e.rewardPerSecond}/sec`;
        output += `\n  Ends: ${new Date(e.rewardDurationEnd * 1000).toLocaleString()}`;
      }
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Position Management Handlers
// ============================================================================

async function handlePositions(poolAddress: string): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (!poolAddress) {
    return 'Usage: /met positions <poolAddress>';
  }

  try {
    const { wallet, meteora } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const positions = await meteora.getMeteoraDlmmPositionsByUser(
      connection,
      poolAddress,
      keypair.publicKey.toBase58()
    );

    if (!positions || positions.length === 0) {
      return `**Meteora Positions**\n\nNo positions found in pool \`${poolAddress.slice(0, 16)}...\``;
    }

    let output = `**Meteora Positions** (${positions.length})\n\n`;
    for (const pos of positions) {
      output += `Position: \`${pos.address.slice(0, 16)}...\`\n`;
      output += `  Bin Range: ${pos.lowerBinId} - ${pos.upperBinId}\n`;
      output += `  X Amount: ${pos.totalXAmount}\n`;
      output += `  Y Amount: ${pos.totalYAmount}\n`;
      output += `  Fee X: ${pos.feeX} | Fee Y: ${pos.feeY}\n`;
      if (pos.rewardOne) output += `  Reward 1: ${pos.rewardOne}\n`;
      if (pos.rewardTwo) output += `  Reward 2: ${pos.rewardTwo}\n`;
      output += '\n';
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleAllPositions(): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, meteora } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const positions = await meteora.getAllMeteoraDlmmPositionsByUser(
      connection,
      keypair.publicKey.toBase58()
    );

    if (!positions || positions.length === 0) {
      return '**All Meteora Positions**\n\nNo positions found.';
    }

    let output = `**All Meteora Positions** (${positions.length})\n\n`;
    for (const pos of positions.slice(0, 15)) {
      output += `Position: \`${pos.address.slice(0, 12)}...\`\n`;
      output += `  Pool: \`${pos.lbPair.slice(0, 12)}...\`\n`;
      output += `  Bin Range: ${pos.lowerBinId} - ${pos.upperBinId}\n`;
      output += `  X: ${pos.totalXAmount} | Y: ${pos.totalYAmount}\n\n`;
    }

    if (positions.length > 15) {
      output += `\n... and ${positions.length - 15} more positions`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleOpenPosition(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  // /met open <pool> <amountX> <amountY> [--strategy Spot|BidAsk|Curve] [--min <binId>] [--max <binId>]
  if (args.length < 3) {
    return `Usage: /met open <pool> <amountX> <amountY> [--strategy Spot|BidAsk|Curve]

Example:
  /met open ABC123... 1000000 1000000 --strategy Spot`;
  }

  const poolAddress = args[0];
  const amountX = args[1];
  const amountY = args[2];

  const strategyIndex = args.findIndex(a => a === '--strategy');
  const minIndex = args.findIndex(a => a === '--min');
  const maxIndex = args.findIndex(a => a === '--max');

  const strategyType = strategyIndex >= 0 ? args[strategyIndex + 1] as 'Spot' | 'BidAsk' | 'Curve' : 'Spot';
  const minBinId = minIndex >= 0 ? parseInt(args[minIndex + 1]) : undefined;
  const maxBinId = maxIndex >= 0 ? parseInt(args[maxIndex + 1]) : undefined;

  try {
    const { wallet, meteora } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await meteora.initializeMeteoraDlmmPosition(connection, keypair, {
      poolAddress,
      totalXAmount: amountX,
      totalYAmount: amountY,
      strategyType,
      minBinId,
      maxBinId,
      slippageBps: 50,
    });

    return `**Position Opened**

Pool: \`${poolAddress.slice(0, 20)}...\`
Position: \`${result.positionAddress}\`
Strategy: ${strategyType}
TX: \`${result.signature}\``;
  } catch (error) {
    return `Open position failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleAddLiquidity(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  // /met add <pool> <position> <amountX> <amountY> [--strategy Spot|BidAsk|Curve]
  if (args.length < 4) {
    return 'Usage: /met add <pool> <position> <amountX> <amountY> [--strategy Spot]';
  }

  const [poolAddress, positionAddress, amountX, amountY] = args;
  const strategyIndex = args.findIndex(a => a === '--strategy');
  const strategyType = strategyIndex >= 0 ? args[strategyIndex + 1] as 'Spot' | 'BidAsk' | 'Curve' : 'Spot';

  try {
    const { wallet, meteora } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await meteora.addMeteoraDlmmLiquidity(connection, keypair, {
      poolAddress,
      positionAddress,
      totalXAmount: amountX,
      totalYAmount: amountY,
      strategyType,
      slippageBps: 50,
    });

    return `**Liquidity Added**

Position: \`${positionAddress.slice(0, 20)}...\`
TX: \`${result.signature}\``;
  } catch (error) {
    return `Add liquidity failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleRemoveLiquidity(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  // /met remove <pool> <position> <bps> [--close]
  if (args.length < 3) {
    return `Usage: /met remove <pool> <position> <bps> [--close]

BPS is basis points (5000 = 50%, 10000 = 100%)
Use --close to also close the position after removal`;
  }

  const [poolAddress, positionAddress, bpsStr] = args;
  const bps = parseInt(bpsStr);
  const shouldClose = args.includes('--close');

  if (isNaN(bps) || bps < 1 || bps > 10000) {
    return 'BPS must be 1-10000 (100% = 10000)';
  }

  try {
    const { wallet, meteora } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    // First get position to know bin range
    const positions = await meteora.getMeteoraDlmmPositionsByUser(connection, poolAddress, keypair.publicKey.toBase58());
    const pos = positions.find(p => p.address === positionAddress);
    if (!pos) {
      return `Position not found: \`${positionAddress}\``;
    }

    const result = await meteora.removeMeteoraDlmmLiquidity(connection, keypair, {
      poolAddress,
      positionAddress,
      fromBinId: pos.lowerBinId,
      toBinId: pos.upperBinId,
      bps,
      shouldClaimAndClose: shouldClose,
    });

    return `**Liquidity Removed**

Position: \`${positionAddress.slice(0, 20)}...\`
Removed: ${(bps / 100).toFixed(2)}%
${shouldClose ? 'Position closed.' : ''}
TX: \`${result.signature}\``;
  } catch (error) {
    return `Remove liquidity failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleClosePosition(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /met close <pool> <position>';
  }

  const [poolAddress, positionAddress] = args;

  try {
    const { wallet, meteora } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await meteora.closeMeteoraDlmmPosition(connection, keypair, poolAddress, positionAddress);

    return `**Position Closed**

Position: \`${positionAddress}\`
TX: \`${result.signature}\`

Rent recovered to your wallet.`;
  } catch (error) {
    return `Close position failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Fee & Reward Handlers
// ============================================================================

async function handleClaimFees(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /met claim-fees <pool> <position>';
  }

  const [poolAddress, positionAddress] = args;

  try {
    const { wallet, meteora } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await meteora.claimMeteoraDlmmSwapFee(connection, keypair, poolAddress, positionAddress);

    return `**Fees Claimed**

Position: \`${positionAddress.slice(0, 20)}...\`
TX: \`${result.signatures[0]}\``;
  } catch (error) {
    return `Claim fees failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleClaimAllFees(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /met claim-all-fees <pool> <pos1,pos2,...>';
  }

  const poolAddress = args[0];
  const positionAddresses = args[1].split(',');

  try {
    const { wallet, meteora } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await meteora.claimAllMeteoraDlmmSwapFees(connection, keypair, poolAddress, positionAddresses);

    return `**All Fees Claimed**

Positions: ${positionAddresses.length}
TXs: ${result.signatures.length}
${result.signatures.map(s => `\`${s.slice(0, 20)}...\``).join('\n')}`;
  } catch (error) {
    return `Claim all fees failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleClaimRewards(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /met claim-rewards <pool> <position>';
  }

  const [poolAddress, positionAddress] = args;

  try {
    const { wallet, meteora } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await meteora.claimMeteoraDlmmLMReward(connection, keypair, poolAddress, positionAddress);

    return `**LM Rewards Claimed**

Position: \`${positionAddress.slice(0, 20)}...\`
TX: \`${result.signatures[0]}\``;
  } catch (error) {
    return `Claim rewards failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleClaimAll(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /met claim-all <pool> <position>';
  }

  const [poolAddress, positionAddress] = args;

  try {
    const { wallet, meteora } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await meteora.claimAllMeteoraDlmmRewards(connection, keypair, poolAddress, positionAddress);

    return `**All Rewards Claimed (Fees + LM)**

Position: \`${positionAddress.slice(0, 20)}...\`
TX: \`${result.signatures[0]}\``;
  } catch (error) {
    return `Claim all failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Pool Creation Handlers
// ============================================================================

async function handleCreatePool(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  // /met create-pool <tokenX> <tokenY> --bin-step <n> [--active-id <n>]
  const binStepIndex = args.findIndex(a => a === '--bin-step');
  if (args.length < 2 || binStepIndex < 0) {
    return `Usage: /met create-pool <tokenX> <tokenY> --bin-step <n> [--active-id <n>]

Example:
  /met create-pool SOL USDC --bin-step 10`;
  }

  const tokenX = args[0];
  const tokenY = args[1];
  const binStep = parseInt(args[binStepIndex + 1]);
  const activeIdIndex = args.findIndex(a => a === '--active-id');
  const activeId = activeIdIndex >= 0 ? parseInt(args[activeIdIndex + 1]) : undefined;

  try {
    const { wallet, meteora, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [tokenXMint, tokenYMint] = await tokenlist.resolveTokenMints([tokenX, tokenY]);
    if (!tokenXMint || !tokenYMint) {
      return 'Could not resolve tokens.';
    }

    const result = await meteora.createMeteoraDlmmPool(connection, keypair, {
      tokenX: tokenXMint,
      tokenY: tokenYMint,
      binStep,
      activeId,
    });

    return `**Pool Created**

Pool: \`${result.poolAddress}\`
Token X: \`${result.tokenX}\`
Token Y: \`${result.tokenY}\`
Bin Step: ${binStep}
TX: \`${result.signature}\``;
  } catch (error) {
    return `Create pool failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCreateCustomPool(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Meteora not configured. Set SOLANA_PRIVATE_KEY.';
  }

  // /met create-custom-pool <tokenX> <tokenY> --bin-step <n> [--fee <bps>] [--has-alpha-vault]
  const binStepIndex = args.findIndex(a => a === '--bin-step');
  if (args.length < 2 || binStepIndex < 0) {
    return `Usage: /met create-custom-pool <tokenX> <tokenY> --bin-step <n> [--fee <bps>]

Example:
  /met create-custom-pool SOL USDC --bin-step 10 --fee 25`;
  }

  const tokenX = args[0];
  const tokenY = args[1];
  const binStep = parseInt(args[binStepIndex + 1]);
  const feeIndex = args.findIndex(a => a === '--fee');
  const feeBps = feeIndex >= 0 ? parseInt(args[feeIndex + 1]) : 25;
  const hasAlphaVault = args.includes('--has-alpha-vault');

  try {
    const { wallet, meteora, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [tokenXMint, tokenYMint] = await tokenlist.resolveTokenMints([tokenX, tokenY]);
    if (!tokenXMint || !tokenYMint) {
      return 'Could not resolve tokens.';
    }

    const result = await meteora.createCustomizableMeteoraDlmmPool(connection, keypair, {
      tokenX: tokenXMint,
      tokenY: tokenYMint,
      binStep,
      feeBps,
      hasAlphaVault,
    });

    return `**Custom Pool Created**

Pool: \`${result.poolAddress}\`
Token X: \`${result.tokenX}\`
Token Y: \`${result.tokenY}\`
Bin Step: ${binStep}
Fee: ${feeBps} bps
TX: \`${result.signature}\``;
  } catch (error) {
    return `Create custom pool failed: ${error instanceof Error ? error.message : String(error)}`;
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
    case 'swap-exact-out':
      return handleSwapExactOut(rest);
    case 'quote':
      return handleQuote(rest);
    case 'quote-exact-out':
      return handleQuoteExactOut(rest);

    // Pool Discovery
    case 'pools':
      return handlePools(rest.join(' '));
    case 'pool-info':
      return handlePoolInfo(rest[0]);

    // Position Management
    case 'positions':
      return handlePositions(rest[0]);
    case 'all-positions':
      return handleAllPositions();
    case 'open':
      return handleOpenPosition(rest);
    case 'add':
      return handleAddLiquidity(rest);
    case 'remove':
      return handleRemoveLiquidity(rest);
    case 'close':
      return handleClosePosition(rest);

    // Fee & Rewards
    case 'claim-fees':
      return handleClaimFees(rest);
    case 'claim-all-fees':
      return handleClaimAllFees(rest);
    case 'claim-rewards':
      return handleClaimRewards(rest);
    case 'claim-all':
      return handleClaimAll(rest);

    // Pool Creation
    case 'create-pool':
      return handleCreatePool(rest);
    case 'create-custom-pool':
      return handleCreateCustomPool(rest);

    case 'help':
    default:
      return `**Meteora DLMM - Complete CLI (18 Commands)**

**Swaps:**
  /met swap <amount> <from> to <to>           Execute swap
  /met swap-exact-out <out> <from> to <to>    Swap for exact output
  /met quote <amount> <from> to <to>          Get quote
  /met quote-exact-out <out> <from> to <to>   Quote exact output

**Pool Discovery:**
  /met pools <token>                          List DLMM pools
  /met pool-info <pool>                       Pool details

**Position Management:**
  /met positions <pool>                       List your positions
  /met all-positions                          All positions (all pools)
  /met open <pool> <amtX> <amtY> [--strategy Spot|BidAsk|Curve]
  /met add <pool> <pos> <amtX> <amtY>         Add liquidity
  /met remove <pool> <pos> <bps> [--close]    Remove liquidity
  /met close <pool> <pos>                     Close position

**Fee & Reward Claims:**
  /met claim-fees <pool> <pos>                Claim swap fees
  /met claim-all-fees <pool> <p1,p2,...>      Claim fees (multi)
  /met claim-rewards <pool> <pos>             Claim LM rewards
  /met claim-all <pool> <pos>                 Claim all rewards

**Pool Creation:**
  /met create-pool <X> <Y> --bin-step <n>     Create standard pool
  /met create-custom-pool <X> <Y> --bin-step <n> [--fee <bps>]

**Examples:**
  /met swap 1 SOL to USDC
  /met positions ABC123...
  /met open ABC123... 1000000 1000000 --strategy Spot
  /met claim-all ABC123... DEF456...`;
  }
}

export default {
  name: 'meteora',
  description: 'Meteora DLMM - swaps, positions, liquidity, fees on Solana',
  commands: ['/meteora', '/met'],
  handle: execute,
};
