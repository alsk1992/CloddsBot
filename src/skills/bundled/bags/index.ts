/**
 * Bags.fm CLI Skill - Complete API Coverage
 *
 * Solana token launchpad and trading platform with creator monetization.
 * Base URL: https://public-api-v2.bags.fm/api/v1/
 *
 * Commands:
 *
 * TRADING:
 * /bags quote <amount> <from> to <to> - Get swap quote
 * /bags swap <amount> <from> to <to> - Execute swap
 *
 * DISCOVERY:
 * /bags pools - List all Bags pools
 * /bags trending - Show trending tokens
 * /bags token <mint> - Get token info
 * /bags creators <mint> - Get token creators
 * /bags lifetime-fees <mint> - Get total fees collected
 *
 * FEE CLAIMING:
 * /bags fees <wallet> - Check claimable fees (all positions)
 * /bags claim <wallet> - Claim accumulated fees
 * /bags claim-events <mint> [--from <timestamp>] [--to <timestamp>] - Get claim history
 * /bags stats <mint> - Token claim statistics per claimer
 *
 * TOKEN LAUNCH:
 * /bags launch <name> <symbol> <description> [--image <url>] [--twitter <handle>] [--website <url>] - Launch new token
 * /bags launch-info - Show launch requirements and fees
 *
 * FEE SHARE CONFIG:
 * /bags fee-config <mint> <claimer1:bps> [claimer2:bps...] - Create fee share config (bps must sum to 10000)
 *
 * WALLET LOOKUP:
 * /bags wallet <provider> <username> - Lookup wallet by social (twitter/github/kick)
 * /bags wallets <provider> <user1,user2,...> - Bulk wallet lookup
 *
 * PARTNER SYSTEM:
 * /bags partner-config <mint> - Create partner config for fee sharing
 * /bags partner-claim <wallet> - Claim partner fees
 * /bags partner-stats <partner-key> - Get partner statistics
 */

const BAGS_API_BASE = 'https://public-api-v2.bags.fm/api/v1';

// ============================================================================
// Types
// ============================================================================

interface BagsQuote {
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  priceImpact: number;
  slippage: number;
  route: string[];
}

interface BagsPool {
  mint: string;
  name?: string;
  symbol?: string;
  meteoraPoolKey?: string;
  dammV2PoolKey?: string;
  liquidity?: number;
  volume24h?: number;
  price?: number;
  marketCap?: number;
}

interface ClaimablePosition {
  baseMint: string;
  tokenSymbol?: string;
  virtualPoolAddress?: string;
  virtualPoolClaimableAmount?: number;
  dammPoolClaimableAmount?: number;
  isCustomFeeVault?: boolean;
  customFeeVaultBalance?: number;
  isMigrated?: boolean;
  totalClaimable: number;
}

interface TokenCreator {
  wallet: string;
  username?: string;
  provider?: string;
  bps: number;
}

interface ClaimEvent {
  wallet: string;
  mint: string;
  amount: number;
  timestamp: number;
  signature: string;
}

interface ClaimStat {
  wallet: string;
  claimed: number;
  unclaimed: number;
  totalEarned: number;
}

interface PartnerStats {
  partnerKey: string;
  totalLaunches: number;
  totalFeesEarned: number;
  claimableAmount: number;
  tokens: Array<{ mint: string; feesEarned: number }>;
}

interface TokenLaunchResult {
  tokenMint: string;
  metadataUrl: string;
  signature: string;
}

// ============================================================================
// API Client
// ============================================================================

function getApiKey(): string | null {
  return process.env.BAGS_API_KEY || null;
}

async function bagsRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('BAGS_API_KEY not configured. Get one at dev.bags.fm');
  }

  const url = endpoint.startsWith('http') ? endpoint : `${BAGS_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Bags API error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<T>;
}

// ============================================================================
// Trading Handlers
// ============================================================================

async function handleQuote(args: string[]): Promise<string> {
  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /bags quote <amount> <from> to <to>\nExample: /bags quote 1 SOL to USDC';
  }

  const amount = args[0];
  const fromToken = args.slice(1, toIndex).join('');
  const toToken = args.slice(toIndex + 1).join('');

  try {
    const { resolveTokenMints } = await import('../../../solana/tokenlist');
    const [fromMint, toMint] = await resolveTokenMints([fromToken, toToken]);

    if (!fromMint || !toMint) {
      return `Could not resolve tokens: ${fromToken}, ${toToken}`;
    }

    const quote = await bagsRequest<BagsQuote>(
      `/trade/quote?inputMint=${fromMint}&outputMint=${toMint}&amount=${amount}`
    );

    return `**Bags Quote**\n\n` +
      `${amount} ${fromToken} -> ${toToken}\n` +
      `Output: ${quote.outputAmount}\n` +
      `Price Impact: ${(quote.priceImpact * 100).toFixed(2)}%\n` +
      `Slippage: ${(quote.slippage * 100).toFixed(2)}%`;
  } catch (error) {
    return `Quote failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleSwap(args: string[]): Promise<string> {
  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  if (toIndex < 2 || toIndex >= args.length - 1) {
    return 'Usage: /bags swap <amount> <from> to <to>\nExample: /bags swap 1 SOL to USDC';
  }

  const amount = args[0];
  const fromToken = args.slice(1, toIndex).join('');
  const toToken = args.slice(toIndex + 1).join('');

  try {
    const { resolveTokenMints } = await import('../../../solana/tokenlist');
    const { loadSolanaKeypair, getSolanaConnection, signAndSendVersionedTransaction } = await import('../../../solana/wallet');

    const [fromMint, toMint] = await resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens: ${fromToken}, ${toToken}`;
    }

    const keypair = loadSolanaKeypair();
    const walletAddress = keypair.publicKey.toBase58();

    // Get quote first
    const quote = await bagsRequest<BagsQuote>(
      `/trade/quote?inputMint=${fromMint}&outputMint=${toMint}&amount=${amount}`
    );

    // Create swap transaction
    const txResponse = await bagsRequest<{ transaction: string }>('/trade/swap', {
      method: 'POST',
      body: JSON.stringify({
        inputMint: fromMint,
        outputMint: toMint,
        amount,
        wallet: walletAddress,
        slippageBps: 50,
      }),
    });

    // Sign and send transaction
    const connection = getSolanaConnection();
    const txBuffer = Buffer.from(txResponse.transaction, 'base64');
    const { VersionedTransaction } = await import('@solana/web3.js');
    const tx = VersionedTransaction.deserialize(txBuffer);
    tx.sign([keypair]);

    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    return `**Bags Swap Complete**\n\n` +
      `${amount} ${fromToken} -> ${quote.outputAmount} ${toToken}\n` +
      `TX: \`${signature}\``;
  } catch (error) {
    return `Swap failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Discovery Handlers
// ============================================================================

async function handlePools(): Promise<string> {
  try {
    const pools = await bagsRequest<BagsPool[]>('/pools');

    if (!pools || pools.length === 0) {
      return 'No Bags pools found.';
    }

    let output = `**Bags Pools** (${pools.length})\n\n`;
    for (const pool of pools.slice(0, 20)) {
      output += `**${pool.symbol || pool.mint.slice(0, 8)}**`;
      if (pool.name) output += ` - ${pool.name}`;
      output += '\n';
      output += `  Mint: \`${pool.mint.slice(0, 20)}...\`\n`;
      if (pool.price) output += `  Price: $${pool.price.toFixed(6)}\n`;
      if (pool.liquidity) output += `  Liquidity: $${pool.liquidity.toLocaleString()}\n`;
      if (pool.volume24h) output += `  24h Volume: $${pool.volume24h.toLocaleString()}\n`;
      if (pool.marketCap) output += `  MCap: $${pool.marketCap.toLocaleString()}\n`;
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error fetching pools: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleTrending(): Promise<string> {
  try {
    const pools = await bagsRequest<BagsPool[]>('/pools?sort=volume24h&order=desc&limit=15');

    if (!pools || pools.length === 0) {
      return 'No trending tokens found.';
    }

    let output = `**Trending on Bags.fm**\n\n`;
    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      output += `${i + 1}. **${pool.symbol || pool.mint.slice(0, 8)}**`;
      if (pool.name) output += ` - ${pool.name}`;
      output += '\n';
      if (pool.volume24h) output += `   24h Vol: $${pool.volume24h.toLocaleString()}`;
      if (pool.price) output += ` | Price: $${pool.price.toFixed(6)}`;
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleToken(mint: string): Promise<string> {
  if (!mint) {
    return 'Usage: /bags token <mint>';
  }

  try {
    const [tokenInfo, creators, lifetimeFees, pools] = await Promise.all([
      bagsRequest<{ name?: string; symbol?: string; decimals?: number; description?: string; image?: string; twitter?: string; website?: string; telegram?: string }>(`/token/${mint}`).catch(() => null),
      bagsRequest<{ creators: TokenCreator[] }>(`/token-launch/creator?tokenMint=${mint}`).catch(() => null),
      bagsRequest<{ totalFees: number; totalVolume?: number }>(`/fee-share/token/lifetime-fees?tokenMint=${mint}`).catch(() => null),
      bagsRequest<BagsPool[]>(`/pools?mint=${mint}`).catch(() => null),
    ]);

    let output = `**Bags Token**\n\n`;
    output += `Mint: \`${mint}\`\n`;

    if (tokenInfo) {
      if (tokenInfo.name) output += `Name: ${tokenInfo.name}\n`;
      if (tokenInfo.symbol) output += `Symbol: ${tokenInfo.symbol}\n`;
      if (tokenInfo.decimals !== undefined) output += `Decimals: ${tokenInfo.decimals}\n`;
      if (tokenInfo.description) output += `Description: ${tokenInfo.description.slice(0, 100)}${tokenInfo.description.length > 100 ? '...' : ''}\n`;
      if (tokenInfo.twitter) output += `Twitter: @${tokenInfo.twitter}\n`;
      if (tokenInfo.website) output += `Website: ${tokenInfo.website}\n`;
      if (tokenInfo.telegram) output += `Telegram: ${tokenInfo.telegram}\n`;
    }

    if (pools && pools.length > 0) {
      const pool = pools[0];
      output += `\n**Market Data:**\n`;
      if (pool.price) output += `  Price: $${pool.price.toFixed(6)}\n`;
      if (pool.liquidity) output += `  Liquidity: $${pool.liquidity.toLocaleString()}\n`;
      if (pool.volume24h) output += `  24h Volume: $${pool.volume24h.toLocaleString()}\n`;
      if (pool.marketCap) output += `  Market Cap: $${pool.marketCap.toLocaleString()}\n`;
    }

    if (creators?.creators?.length) {
      output += `\n**Creators (${creators.creators.length}):**\n`;
      for (const creator of creators.creators.slice(0, 5)) {
        output += `  - \`${creator.wallet.slice(0, 12)}...\``;
        if (creator.username) output += ` (@${creator.username})`;
        output += ` - ${(creator.bps / 100).toFixed(1)}%\n`;
      }
    }

    if (lifetimeFees) {
      output += `\n**Fee Stats:**\n`;
      output += `  Lifetime Fees: $${lifetimeFees.totalFees.toLocaleString()}\n`;
      if (lifetimeFees.totalVolume) output += `  Total Volume: $${lifetimeFees.totalVolume.toLocaleString()}\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCreators(mint: string): Promise<string> {
  if (!mint) {
    return 'Usage: /bags creators <mint>';
  }

  try {
    const result = await bagsRequest<{ creators: TokenCreator[] }>(
      `/token-launch/creator?tokenMint=${mint}`
    );

    if (!result.creators || result.creators.length === 0) {
      return `No creators found for token ${mint.slice(0, 12)}...`;
    }

    let output = `**Token Creators**\n\nMint: \`${mint.slice(0, 20)}...\`\n\n`;
    let totalBps = 0;

    for (const creator of result.creators) {
      output += `**${creator.username || creator.wallet.slice(0, 12) + '...'}**\n`;
      output += `  Wallet: \`${creator.wallet}\`\n`;
      if (creator.provider) output += `  Provider: ${creator.provider}\n`;
      output += `  Share: ${(creator.bps / 100).toFixed(2)}%\n\n`;
      totalBps += creator.bps;
    }

    output += `**Total Share: ${(totalBps / 100).toFixed(2)}%**`;
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleLifetimeFees(mint: string): Promise<string> {
  if (!mint) {
    return 'Usage: /bags lifetime-fees <mint>';
  }

  try {
    const result = await bagsRequest<{
      totalFees: number;
      totalVolume?: number;
      feeRate?: number;
      launchDate?: string;
    }>(`/fee-share/token/lifetime-fees?tokenMint=${mint}`);

    let output = `**Lifetime Fees**\n\nMint: \`${mint.slice(0, 20)}...\`\n\n`;
    output += `Total Fees Collected: **$${result.totalFees.toLocaleString()}**\n`;
    if (result.totalVolume) output += `Total Volume: $${result.totalVolume.toLocaleString()}\n`;
    if (result.feeRate) output += `Fee Rate: ${(result.feeRate * 100).toFixed(2)}%\n`;
    if (result.launchDate) output += `Launch Date: ${new Date(result.launchDate).toLocaleDateString()}\n`;

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Fee Claiming Handlers
// ============================================================================

async function handleFees(walletArg: string): Promise<string> {
  let walletAddress = walletArg;

  if (!walletAddress) {
    // Use configured wallet if not provided
    try {
      const { loadSolanaKeypair } = await import('../../../solana/wallet');
      const keypair = loadSolanaKeypair();
      walletAddress = keypair.publicKey.toBase58();
    } catch {
      return 'Usage: /bags fees <wallet>\nOr configure SOLANA_PRIVATE_KEY to use your wallet.';
    }
  }

  try {
    const positions = await bagsRequest<{ positions: ClaimablePosition[] }>(
      `/fee-share/claimable?wallet=${walletAddress}`
    );

    if (!positions.positions || positions.positions.length === 0) {
      return `No claimable fees for wallet ${walletAddress.slice(0, 12)}...`;
    }

    let output = `**Claimable Fees**\n\nWallet: \`${walletAddress.slice(0, 12)}...\`\n\n`;
    let totalClaimable = 0;

    for (const pos of positions.positions) {
      const symbol = pos.tokenSymbol || pos.baseMint.slice(0, 8);
      output += `**${symbol}**\n`;
      output += `  Mint: \`${pos.baseMint.slice(0, 16)}...\`\n`;

      if (pos.virtualPoolClaimableAmount) {
        output += `  Virtual Pool: $${pos.virtualPoolClaimableAmount.toFixed(2)}\n`;
      }
      if (pos.dammPoolClaimableAmount) {
        output += `  DAMM Pool: $${pos.dammPoolClaimableAmount.toFixed(2)}\n`;
      }
      if (pos.customFeeVaultBalance) {
        output += `  Custom Vault: $${pos.customFeeVaultBalance.toFixed(2)}\n`;
      }

      output += `  **Total: $${pos.totalClaimable.toFixed(2)}**\n\n`;
      totalClaimable += pos.totalClaimable;
    }

    output += `\n**Grand Total: $${totalClaimable.toFixed(2)}**\n`;
    output += `\nUse \`/bags claim ${walletAddress}\` to claim all fees.`;
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleClaim(walletArg: string): Promise<string> {
  try {
    const { loadSolanaKeypair, getSolanaConnection } = await import('../../../solana/wallet');
    const keypair = loadSolanaKeypair();
    const walletAddress = walletArg || keypair.publicKey.toBase58();

    // Verify wallet matches if specified
    if (walletArg && keypair.publicKey.toBase58() !== walletArg) {
      return `Wallet mismatch. Your configured wallet is ${keypair.publicKey.toBase58().slice(0, 12)}...`;
    }

    // Get all claimable positions first
    const positions = await bagsRequest<{ positions: ClaimablePosition[] }>(
      `/fee-share/claimable?wallet=${walletAddress}`
    );

    if (!positions.positions || positions.positions.length === 0) {
      return 'No fees to claim.';
    }

    // Get claim transactions for all positions
    const claimTxs = await bagsRequest<{ transactions: string[] }>(
      `/fee-share/claim`,
      {
        method: 'POST',
        body: JSON.stringify({ wallet: walletAddress }),
      }
    );

    if (!claimTxs.transactions || claimTxs.transactions.length === 0) {
      return 'No claim transactions generated. Fees may already be claimed.';
    }

    const connection = getSolanaConnection();
    const { VersionedTransaction } = await import('@solana/web3.js');
    const signatures: string[] = [];

    for (const txBase64 of claimTxs.transactions) {
      const txBuffer = Buffer.from(txBase64, 'base64');
      const tx = VersionedTransaction.deserialize(txBuffer);
      tx.sign([keypair]);
      const sig = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(sig, 'confirmed');
      signatures.push(sig);
    }

    const totalClaimed = positions.positions.reduce((sum, p) => sum + p.totalClaimable, 0);

    return `**Fees Claimed Successfully**\n\n` +
      `Amount: $${totalClaimed.toFixed(2)}\n` +
      `Positions: ${positions.positions.length}\n` +
      `Transactions: ${signatures.length}\n\n` +
      signatures.map(s => `- \`${s.slice(0, 24)}...\``).join('\n');
  } catch (error) {
    return `Claim failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleClaimEvents(args: string[]): Promise<string> {
  if (args.length === 0) {
    return 'Usage: /bags claim-events <mint> [--from <timestamp>] [--to <timestamp>]';
  }

  const mint = args[0];
  let fromTs: number | undefined;
  let toTs: number | undefined;

  // Parse optional flags
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      fromTs = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--to' && args[i + 1]) {
      toTs = parseInt(args[i + 1]);
      i++;
    }
  }

  try {
    let endpoint = `/fee-share/token/claim-events?tokenMint=${mint}`;
    if (fromTs || toTs) {
      endpoint += '&mode=time';
      if (fromTs) endpoint += `&from=${fromTs}`;
      if (toTs) endpoint += `&to=${toTs}`;
    }

    const result = await bagsRequest<{ events: ClaimEvent[] }>(endpoint);

    if (!result.events || result.events.length === 0) {
      return `No claim events for token ${mint.slice(0, 12)}...`;
    }

    let output = `**Claim Events**\n\nMint: \`${mint.slice(0, 20)}...\`\n\n`;
    let totalClaimed = 0;

    for (const event of result.events.slice(0, 20)) {
      const date = new Date(event.timestamp * 1000).toLocaleString();
      output += `**${event.wallet.slice(0, 12)}...** claimed $${event.amount.toFixed(2)}\n`;
      output += `  ${date} | \`${event.signature.slice(0, 16)}...\`\n\n`;
      totalClaimed += event.amount;
    }

    output += `\n**Total Claimed: $${totalClaimed.toFixed(2)}**`;
    if (result.events.length > 20) {
      output += `\n(Showing 20 of ${result.events.length} events)`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleStats(mint: string): Promise<string> {
  if (!mint) {
    return 'Usage: /bags stats <mint>';
  }

  try {
    const stats = await bagsRequest<{ claimers: ClaimStat[] }>(
      `/fee-share/token/claim-stats?tokenMint=${mint}`
    );

    if (!stats.claimers || stats.claimers.length === 0) {
      return `No claim stats for token ${mint.slice(0, 12)}...`;
    }

    let output = `**Token Claim Stats**\n\nMint: \`${mint.slice(0, 20)}...\`\n\n`;
    let totalClaimed = 0;
    let totalUnclaimed = 0;
    let totalEarned = 0;

    for (const claimer of stats.claimers) {
      output += `**${claimer.wallet.slice(0, 12)}...**\n`;
      output += `  Claimed: $${claimer.claimed.toFixed(2)}\n`;
      output += `  Unclaimed: $${claimer.unclaimed.toFixed(2)}\n`;
      output += `  Total Earned: $${claimer.totalEarned.toFixed(2)}\n\n`;
      totalClaimed += claimer.claimed;
      totalUnclaimed += claimer.unclaimed;
      totalEarned += claimer.totalEarned;
    }

    output += `**Totals:**\n`;
    output += `  Claimed: $${totalClaimed.toFixed(2)}\n`;
    output += `  Unclaimed: $${totalUnclaimed.toFixed(2)}\n`;
    output += `  Total Earned: $${totalEarned.toFixed(2)}`;

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Token Launch Handlers
// ============================================================================

async function handleLaunch(args: string[]): Promise<string> {
  if (args.length < 3) {
    return `Usage: /bags launch <name> <symbol> <description> [options]

Options:
  --image <url>       Token image URL (or will be uploaded)
  --twitter <handle>  Twitter handle
  --website <url>     Website URL
  --telegram <url>    Telegram URL
  --initial <SOL>     Initial buy amount in SOL (default: 0)

Example:
  /bags launch "My Token" MTK "A great token" --twitter mytoken --initial 0.1`;
  }

  const name = args[0];
  const symbol = args[1];
  const description = args[2];

  // Parse optional flags
  let imageUrl: string | undefined;
  let twitter: string | undefined;
  let website: string | undefined;
  let telegram: string | undefined;
  let initialBuyLamports = 0;

  for (let i = 3; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === '--image' && value) { imageUrl = value; i++; }
    else if (flag === '--twitter' && value) { twitter = value; i++; }
    else if (flag === '--website' && value) { website = value; i++; }
    else if (flag === '--telegram' && value) { telegram = value; i++; }
    else if (flag === '--initial' && value) {
      initialBuyLamports = Math.floor(parseFloat(value) * 1e9);
      i++;
    }
  }

  try {
    const { loadSolanaKeypair, getSolanaConnection } = await import('../../../solana/wallet');
    const keypair = loadSolanaKeypair();
    const walletAddress = keypair.publicKey.toBase58();

    // Step 1: Create token info and metadata
    const tokenInfo = await bagsRequest<{ tokenMint: string; metadataUrl: string }>(
      '/token-launch/create-token-info',
      {
        method: 'POST',
        body: JSON.stringify({
          name,
          symbol,
          description,
          imageUrl,
          twitter,
          website,
          telegram,
        }),
      }
    );

    // Step 2: Create fee share config (100% to creator by default)
    const feeConfig = await bagsRequest<{ configKey: string; transactions: string[] }>(
      '/fee-share/create-config',
      {
        method: 'POST',
        body: JSON.stringify({
          payer: walletAddress,
          baseMint: tokenInfo.tokenMint,
          feeClaimers: [{ user: walletAddress, userBps: 10000 }],
        }),
      }
    );

    // Sign and send fee config transactions
    const connection = getSolanaConnection();
    const { VersionedTransaction } = await import('@solana/web3.js');

    for (const txBase64 of feeConfig.transactions) {
      const txBuffer = Buffer.from(txBase64, 'base64');
      const tx = VersionedTransaction.deserialize(txBuffer);
      tx.sign([keypair]);
      const sig = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(sig, 'confirmed');
    }

    // Step 3: Create launch transaction
    const launchTx = await bagsRequest<{ transaction: string }>(
      '/token-launch/create-launch-transaction',
      {
        method: 'POST',
        body: JSON.stringify({
          metadataUrl: tokenInfo.metadataUrl,
          tokenMint: tokenInfo.tokenMint,
          launchWallet: walletAddress,
          initialBuyLamports,
          configKey: feeConfig.configKey,
        }),
      }
    );

    // Sign and send launch transaction
    const launchTxBuffer = Buffer.from(launchTx.transaction, 'base64');
    const tx = VersionedTransaction.deserialize(launchTxBuffer);
    tx.sign([keypair]);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    return `**Token Launched Successfully!**\n\n` +
      `Name: ${name}\n` +
      `Symbol: ${symbol}\n` +
      `Mint: \`${tokenInfo.tokenMint}\`\n` +
      `Metadata: ${tokenInfo.metadataUrl}\n` +
      `TX: \`${signature}\`\n\n` +
      `Your token is now live on Bags.fm! You earn 1% of all trading volume.`;
  } catch (error) {
    return `Launch failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleLaunchInfo(): Promise<string> {
  return `**Bags.fm Token Launch**

**Requirements:**
- BAGS_API_KEY from dev.bags.fm
- SOLANA_PRIVATE_KEY for signing
- SOL for transaction fees (~0.05 SOL)

**Features:**
- 1% creator fee on all trades
- Up to 100 fee claimers per token
- Automatic Meteora DAMM pool creation
- Social links (Twitter, Telegram, Website)

**Fee Distribution:**
- Default: 100% to creator
- Custom: Split between up to 100 wallets
- Claim fees anytime with /bags claim

**Launch Steps:**
1. /bags launch <name> <symbol> <desc> [options]
2. Token is created with metadata on IPFS
3. Fee share config is set up
4. Token launches on Meteora pool
5. Trading starts immediately

**Cost:** ~0.05 SOL (Solana transaction fees only)`;
}

// ============================================================================
// Fee Share Config Handlers
// ============================================================================

async function handleFeeConfig(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /bags fee-config <mint> <claimer1:bps> [claimer2:bps ...]

BPS (basis points) must sum to 10000 (100%)

Examples:
  /bags fee-config <mint> wallet1:5000 wallet2:5000   # 50/50 split
  /bags fee-config <mint> wallet1:7000 wallet2:3000   # 70/30 split
  /bags fee-config <mint> wallet1:10000               # 100% to one wallet`;
  }

  const mint = args[0];
  const claimerArgs = args.slice(1);

  const feeClaimers: Array<{ user: string; userBps: number }> = [];
  let totalBps = 0;

  for (const arg of claimerArgs) {
    const [wallet, bpsStr] = arg.split(':');
    if (!wallet || !bpsStr) {
      return `Invalid claimer format: ${arg}. Use wallet:bps format.`;
    }
    const bps = parseInt(bpsStr);
    if (isNaN(bps) || bps < 0 || bps > 10000) {
      return `Invalid BPS value: ${bpsStr}. Must be 0-10000.`;
    }
    feeClaimers.push({ user: wallet, userBps: bps });
    totalBps += bps;
  }

  if (totalBps !== 10000) {
    return `BPS must sum to 10000. Current total: ${totalBps}`;
  }

  try {
    const { loadSolanaKeypair, getSolanaConnection } = await import('../../../solana/wallet');
    const keypair = loadSolanaKeypair();
    const walletAddress = keypair.publicKey.toBase58();

    const result = await bagsRequest<{ configKey: string; transactions: string[] }>(
      '/fee-share/create-config',
      {
        method: 'POST',
        body: JSON.stringify({
          payer: walletAddress,
          baseMint: mint,
          feeClaimers,
        }),
      }
    );

    // Sign and send transactions
    const connection = getSolanaConnection();
    const { VersionedTransaction } = await import('@solana/web3.js');
    const signatures: string[] = [];

    for (const txBase64 of result.transactions) {
      const txBuffer = Buffer.from(txBase64, 'base64');
      const tx = VersionedTransaction.deserialize(txBuffer);
      tx.sign([keypair]);
      const sig = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(sig, 'confirmed');
      signatures.push(sig);
    }

    let output = `**Fee Share Config Created**\n\n`;
    output += `Mint: \`${mint.slice(0, 20)}...\`\n`;
    output += `Config Key: \`${result.configKey}\`\n\n`;
    output += `**Fee Distribution:**\n`;
    for (const claimer of feeClaimers) {
      output += `  ${claimer.user.slice(0, 12)}... - ${(claimer.userBps / 100).toFixed(1)}%\n`;
    }
    output += `\nTransactions: ${signatures.length}`;

    return output;
  } catch (error) {
    return `Config creation failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Wallet Lookup Handlers
// ============================================================================

async function handleWalletLookup(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /bags wallet <provider> <username>

Providers: twitter, github, kick, tiktok

Examples:
  /bags wallet twitter elonmusk
  /bags wallet github vbuterin`;
  }

  const provider = args[0].toLowerCase();
  const username = args[1];

  if (!['twitter', 'github', 'kick', 'tiktok'].includes(provider)) {
    return `Invalid provider: ${provider}. Use: twitter, github, kick, or tiktok`;
  }

  try {
    const result = await bagsRequest<{ wallet: string; username: string; provider: string }>(
      `/fee-share/wallet/v2?provider=${provider}&username=${username}`
    );

    return `**Wallet Lookup**\n\n` +
      `Provider: ${result.provider}\n` +
      `Username: @${result.username}\n` +
      `Wallet: \`${result.wallet}\``;
  } catch (error) {
    return `Lookup failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBulkWalletLookup(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /bags wallets <provider> <user1,user2,user3,...>

Example:
  /bags wallets twitter user1,user2,user3`;
  }

  const provider = args[0].toLowerCase();
  const usernames = args[1].split(',').map(u => u.trim());

  if (!['twitter', 'github', 'kick', 'tiktok'].includes(provider)) {
    return `Invalid provider: ${provider}. Use: twitter, github, kick, or tiktok`;
  }

  try {
    const result = await bagsRequest<{ wallets: Array<{ username: string; wallet: string }> }>(
      '/fee-share/wallet/v2/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ provider, usernames }),
      }
    );

    let output = `**Bulk Wallet Lookup** (${provider})\n\n`;
    for (const entry of result.wallets) {
      output += `@${entry.username}: \`${entry.wallet}\`\n`;
    }
    return output;
  } catch (error) {
    return `Lookup failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Partner System Handlers
// ============================================================================

async function handlePartnerConfig(mint: string): Promise<string> {
  if (!mint) {
    return 'Usage: /bags partner-config <mint>';
  }

  try {
    const { loadSolanaKeypair, getSolanaConnection } = await import('../../../solana/wallet');
    const keypair = loadSolanaKeypair();
    const walletAddress = keypair.publicKey.toBase58();

    const result = await bagsRequest<{ partnerKey: string; transaction: string }>(
      '/fee-share/partner/create-config',
      {
        method: 'POST',
        body: JSON.stringify({
          payer: walletAddress,
          tokenMint: mint,
        }),
      }
    );

    // Sign and send transaction
    const connection = getSolanaConnection();
    const { VersionedTransaction } = await import('@solana/web3.js');
    const txBuffer = Buffer.from(result.transaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuffer);
    tx.sign([keypair]);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    return `**Partner Config Created**\n\n` +
      `Mint: \`${mint.slice(0, 20)}...\`\n` +
      `Partner Key: \`${result.partnerKey}\`\n` +
      `TX: \`${signature}\`\n\n` +
      `Use this partner key when launching tokens to earn referral fees.`;
  } catch (error) {
    return `Failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePartnerClaim(walletArg: string): Promise<string> {
  try {
    const { loadSolanaKeypair, getSolanaConnection } = await import('../../../solana/wallet');
    const keypair = loadSolanaKeypair();
    const walletAddress = walletArg || keypair.publicKey.toBase58();

    const claimTxs = await bagsRequest<{ transactions: string[] }>(
      '/fee-share/partner/claim',
      {
        method: 'POST',
        body: JSON.stringify({ wallet: walletAddress }),
      }
    );

    if (!claimTxs.transactions || claimTxs.transactions.length === 0) {
      return 'No partner fees to claim.';
    }

    const connection = getSolanaConnection();
    const { VersionedTransaction } = await import('@solana/web3.js');
    const signatures: string[] = [];

    for (const txBase64 of claimTxs.transactions) {
      const txBuffer = Buffer.from(txBase64, 'base64');
      const tx = VersionedTransaction.deserialize(txBuffer);
      tx.sign([keypair]);
      const sig = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(sig, 'confirmed');
      signatures.push(sig);
    }

    return `**Partner Fees Claimed**\n\n` +
      `Transactions: ${signatures.length}\n` +
      signatures.map(s => `- \`${s.slice(0, 24)}...\``).join('\n');
  } catch (error) {
    return `Claim failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePartnerStats(partnerKey: string): Promise<string> {
  if (!partnerKey) {
    return 'Usage: /bags partner-stats <partner-key>';
  }

  try {
    const stats = await bagsRequest<PartnerStats>(
      `/fee-share/partner/stats?partnerKey=${partnerKey}`
    );

    let output = `**Partner Stats**\n\n`;
    output += `Partner Key: \`${stats.partnerKey.slice(0, 20)}...\`\n`;
    output += `Total Launches: ${stats.totalLaunches}\n`;
    output += `Total Fees Earned: $${stats.totalFeesEarned.toLocaleString()}\n`;
    output += `Claimable: $${stats.claimableAmount.toFixed(2)}\n\n`;

    if (stats.tokens.length > 0) {
      output += `**Tokens:**\n`;
      for (const token of stats.tokens.slice(0, 10)) {
        output += `  \`${token.mint.slice(0, 12)}...\` - $${token.feesEarned.toFixed(2)}\n`;
      }
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Main Execute Function
// ============================================================================

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    // Trading
    case 'quote':
      return handleQuote(rest);
    case 'swap':
      return handleSwap(rest);

    // Discovery
    case 'pools':
      return handlePools();
    case 'trending':
      return handleTrending();
    case 'token':
      return handleToken(rest[0]);
    case 'creators':
      return handleCreators(rest[0]);
    case 'lifetime-fees':
      return handleLifetimeFees(rest[0]);

    // Fee Claiming
    case 'fees':
      return handleFees(rest[0]);
    case 'claim':
      return handleClaim(rest[0]);
    case 'claim-events':
      return handleClaimEvents(rest);
    case 'stats':
      return handleStats(rest[0]);

    // Token Launch
    case 'launch':
      return handleLaunch(rest);
    case 'launch-info':
      return handleLaunchInfo();

    // Fee Share Config
    case 'fee-config':
      return handleFeeConfig(rest);

    // Wallet Lookup
    case 'wallet':
      return handleWalletLookup(rest);
    case 'wallets':
      return handleBulkWalletLookup(rest);

    // Partner System
    case 'partner-config':
      return handlePartnerConfig(rest[0]);
    case 'partner-claim':
      return handlePartnerClaim(rest[0]);
    case 'partner-stats':
      return handlePartnerStats(rest[0]);

    case 'help':
    default:
      return `**Bags.fm - Complete Solana Token Launchpad**

**Trading:**
  /bags quote <amount> <from> to <to>      Get swap quote
  /bags swap <amount> <from> to <to>       Execute swap

**Discovery:**
  /bags pools                              List all pools
  /bags trending                           Show trending tokens
  /bags token <mint>                       Full token info
  /bags creators <mint>                    Get token creators
  /bags lifetime-fees <mint>               Total fees collected

**Fee Claiming:**
  /bags fees [wallet]                      Check claimable fees
  /bags claim [wallet]                     Claim all fees
  /bags claim-events <mint> [--from/--to]  Claim history
  /bags stats <mint>                       Per-claimer statistics

**Token Launch:**
  /bags launch <name> <symbol> <desc>      Launch new token
  /bags launch-info                        Launch requirements

**Fee Share Config:**
  /bags fee-config <mint> <wallet:bps>...  Create fee distribution

**Wallet Lookup:**
  /bags wallet <provider> <username>       Lookup by social
  /bags wallets <provider> <user1,user2>   Bulk lookup

**Partner System:**
  /bags partner-config <mint>              Create partner key
  /bags partner-claim [wallet]             Claim partner fees
  /bags partner-stats <key>                View partner stats

**Setup:**
  export BAGS_API_KEY="your-key"           # From dev.bags.fm
  export SOLANA_PRIVATE_KEY="your-key"     # For signing txs

**Examples:**
  /bags quote 1 SOL to USDC
  /bags swap 0.5 SOL to BONK
  /bags launch "Moon Token" MOON "To the moon!" --twitter moontoken
  /bags fee-config <mint> wallet1:5000 wallet2:5000`;
  }
}

export default { execute };
