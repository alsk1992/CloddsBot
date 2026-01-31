/**
 * Solana DEX Handlers
 *
 * Platform handlers for Solana DEX protocols:
 * - Jupiter (aggregator)
 * - Raydium (AMM)
 * - Orca (Whirlpools)
 * - Meteora (DLMM)
 * - Pump.fun (token launchpad)
 * - Drift (perps + prediction markets)
 */

import type { ToolInput, HandlerResult, HandlersMap } from './types';
import { safeHandler } from './types';

// Lazy imports to avoid loading heavy SDKs unless needed
const getSolanaModules = async () => {
  const [wallet, jupiter, raydium, orca, meteora, pumpapi, drift, pools, tokenlist] = await Promise.all([
    import('../../solana/wallet'),
    import('../../solana/jupiter'),
    import('../../solana/raydium'),
    import('../../solana/orca'),
    import('../../solana/meteora'),
    import('../../solana/pumpapi'),
    import('../../solana/drift'),
    import('../../solana/pools'),
    import('../../solana/tokenlist'),
  ]);
  return { wallet, jupiter, raydium, orca, meteora, pumpapi, drift, pools, tokenlist };
};

// ============================================================================
// Wallet / Address
// ============================================================================

async function addressHandler(): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    return { address: keypair.publicKey.toBase58() };
  });
}

// ============================================================================
// Jupiter Handlers
// ============================================================================

async function jupiterSwapHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const inputMint = toolInput.input_mint as string;
  const outputMint = toolInput.output_mint as string;
  const amount = toolInput.amount as string;
  const slippageBps = toolInput.slippage_bps as number | undefined;
  const swapMode = toolInput.swap_mode as 'ExactIn' | 'ExactOut' | undefined;
  const priorityFeeLamports = toolInput.priority_fee_lamports as number | undefined;
  const onlyDirectRoutes = toolInput.only_direct_routes as boolean | undefined;

  return safeHandler(async () => {
    const { wallet, jupiter } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    return jupiter.executeJupiterSwap(connection, keypair, {
      inputMint,
      outputMint,
      amount,
      slippageBps,
      swapMode,
      priorityFeeLamports,
      onlyDirectRoutes,
    });
  }, 'Jupiter swap failed. Set SOLANA_PRIVATE_KEY and SOLANA_RPC_URL.');
}

// ============================================================================
// Raydium Handlers
// ============================================================================

async function raydiumSwapHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, raydium } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    return raydium.executeRaydiumSwap(connection, keypair, {
      inputMint: toolInput.input_mint as string,
      outputMint: toolInput.output_mint as string,
      amount: toolInput.amount as string,
      slippageBps: toolInput.slippage_bps as number | undefined,
      swapMode: toolInput.swap_mode as 'BaseIn' | 'BaseOut' | undefined,
      txVersion: toolInput.tx_version as 'V0' | 'LEGACY' | undefined,
      computeUnitPriceMicroLamports: toolInput.compute_unit_price_micro_lamports as number | undefined,
    });
  });
}

async function raydiumPoolsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { raydium, tokenlist } = await getSolanaModules();
    const tokenMints = toolInput.token_mints as string[] | undefined;
    const tokenSymbols = toolInput.token_symbols as string[] | undefined;
    const limit = toolInput.limit as number | undefined;
    const resolvedMints = tokenMints && tokenMints.length > 0
      ? tokenMints
      : tokenSymbols && tokenSymbols.length > 0
        ? await tokenlist.resolveTokenMints(tokenSymbols)
        : undefined;
    return raydium.listRaydiumPools({ tokenMints: resolvedMints, limit });
  });
}

async function raydiumQuoteHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { raydium } = await getSolanaModules();
    return raydium.getRaydiumQuote({
      inputMint: toolInput.input_mint as string,
      outputMint: toolInput.output_mint as string,
      amount: toolInput.amount as string,
      slippageBps: toolInput.slippage_bps as number | undefined,
      swapMode: toolInput.swap_mode as 'BaseIn' | 'BaseOut' | undefined,
    });
  });
}

// ============================================================================
// Orca Handlers
// ============================================================================

async function orcaSwapHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, orca } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    return orca.executeOrcaWhirlpoolSwap(connection, keypair, {
      poolAddress: toolInput.pool_address as string,
      inputMint: toolInput.input_mint as string,
      amount: toolInput.amount as string,
      slippageBps: toolInput.slippage_bps as number | undefined,
    });
  });
}

async function orcaPoolsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { orca, tokenlist } = await getSolanaModules();
    const tokenMints = toolInput.token_mints as string[] | undefined;
    const tokenSymbols = toolInput.token_symbols as string[] | undefined;
    const limit = toolInput.limit as number | undefined;
    const resolvedMints = tokenMints && tokenMints.length > 0
      ? tokenMints
      : tokenSymbols && tokenSymbols.length > 0
        ? await tokenlist.resolveTokenMints(tokenSymbols)
        : undefined;
    return orca.listOrcaWhirlpoolPools({ tokenMints: resolvedMints, limit });
  });
}

async function orcaQuoteHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, orca } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();
    return orca.getOrcaWhirlpoolQuote(connection, {
      poolAddress: toolInput.pool_address as string,
      inputMint: toolInput.input_mint as string,
      amount: toolInput.amount as string,
      slippageBps: toolInput.slippage_bps as number | undefined,
    });
  });
}

// ============================================================================
// Meteora Handlers
// ============================================================================

async function meteoraSwapHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, meteora } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    return meteora.executeMeteoraDlmmSwap(connection, keypair, {
      poolAddress: toolInput.pool_address as string,
      inputMint: toolInput.input_mint as string,
      outputMint: toolInput.output_mint as string,
      inAmount: toolInput.in_amount as string,
      slippageBps: toolInput.slippage_bps as number | undefined,
      allowPartialFill: toolInput.allow_partial_fill as boolean | undefined,
      maxExtraBinArrays: toolInput.max_extra_bin_arrays as number | undefined,
    });
  });
}

async function meteoraPoolsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, meteora, tokenlist } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();
    const tokenMints = toolInput.token_mints as string[] | undefined;
    const tokenSymbols = toolInput.token_symbols as string[] | undefined;
    const limit = toolInput.limit as number | undefined;
    const resolvedMints = tokenMints && tokenMints.length > 0
      ? tokenMints
      : tokenSymbols && tokenSymbols.length > 0
        ? await tokenlist.resolveTokenMints(tokenSymbols)
        : undefined;
    return meteora.listMeteoraDlmmPools(connection, { tokenMints: resolvedMints, limit, includeLiquidity: true });
  });
}

async function meteoraQuoteHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, meteora } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();
    return meteora.getMeteoraDlmmQuote(connection, {
      poolAddress: toolInput.pool_address as string,
      inputMint: toolInput.input_mint as string,
      inAmount: toolInput.in_amount as string,
      slippageBps: toolInput.slippage_bps as number | undefined,
    });
  });
}

// ============================================================================
// Pump.fun Handlers
// ============================================================================

async function pumpfunTradeHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const action = toolInput.action as 'buy' | 'sell';
  const mint = toolInput.mint as string;
  const amountRaw = toolInput.amount as string;
  const denominatedInSol = toolInput.denominated_in_sol as boolean;
  const slippageBps = toolInput.slippage_bps as number | undefined;
  const priorityFeeLamports = toolInput.priority_fee_lamports as number | undefined;
  const pool = toolInput.pool as string | undefined;

  const amountValue = amountRaw?.trim();
  if (!amountValue) {
    return JSON.stringify({ error: 'amount is required' });
  }

  return safeHandler(async () => {
    const { wallet, pumpapi } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    return pumpapi.executePumpFunTrade(connection, keypair, {
      action,
      mint,
      amount: amountValue,
      denominatedInSol,
      slippageBps,
      priorityFeeLamports,
      pool,
    });
  }, 'Ensure PUMPFUN_LOCAL_TX_URL is reachable and SOLANA_PRIVATE_KEY is set.');
}

// ============================================================================
// Drift Handlers
// ============================================================================

async function driftPlaceOrderHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    return drift.executeDriftDirectOrder(connection, keypair, {
      marketType: toolInput.market_type as 'perp' | 'spot',
      marketIndex: toolInput.market_index as number,
      side: toolInput.side as 'buy' | 'sell',
      orderType: toolInput.order_type as 'limit' | 'market',
      baseAmount: toolInput.base_amount as string,
      price: toolInput.price as string | undefined,
    });
  });
}

async function driftCancelOrderHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    return drift.cancelDriftOrder(connection, keypair, {
      orderId: toolInput.order_id as number | undefined,
      marketIndex: toolInput.market_index as number | undefined,
      marketType: toolInput.market_type as 'perp' | 'spot' | undefined,
    });
  });
}

async function driftOrdersHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    return drift.getDriftOrders(
      connection,
      keypair,
      toolInput.market_index as number | undefined,
      toolInput.market_type as 'perp' | 'spot' | undefined
    );
  });
}

async function driftPositionsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    return drift.getDriftPositions(
      connection,
      keypair,
      toolInput.market_index as number | undefined
    );
  });
}

async function driftBalanceHandler(): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    return drift.getDriftBalance(connection, keypair);
  });
}

async function driftModifyOrderHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    return drift.modifyDriftOrder(connection, keypair, {
      orderId: toolInput.order_id as number,
      newPrice: toolInput.new_price as string | undefined,
      newBaseAmount: toolInput.new_base_amount as string | undefined,
      reduceOnly: toolInput.reduce_only as boolean | undefined,
    });
  });
}

async function driftSetLeverageHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, drift } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    return drift.setDriftLeverage(connection, keypair, {
      marketIndex: toolInput.market_index as number,
      leverage: toolInput.leverage as number,
    });
  });
}

// ============================================================================
// Auto-Routing Handlers (Best Pool Selection)
// ============================================================================

async function bestPoolHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, pools } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();
    const result = await pools.selectBestPool(connection, {
      tokenMints: toolInput.token_mints as string[] | undefined,
      tokenSymbols: toolInput.token_symbols as string[] | undefined,
      limit: toolInput.limit as number | undefined,
      sortBy: toolInput.sort_by as 'liquidity' | 'volume24h' | undefined,
      preferredDexes: toolInput.preferred_dexes as Array<'meteora' | 'raydium' | 'orca'> | undefined,
    });
    return result ?? { error: 'No matching pools found' };
  });
}

async function autoRouteHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, pools } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();
    return pools.listAllPools(connection, {
      tokenMints: toolInput.token_mints as string[] | undefined,
      tokenSymbols: toolInput.token_symbols as string[] | undefined,
      sortBy: toolInput.sort_by as 'liquidity' | 'volume24h' | undefined,
      preferredDexes: toolInput.preferred_dexes as Array<'meteora' | 'raydium' | 'orca'> | undefined,
      limit: (toolInput.limit as number | undefined) ?? 20,
    });
  });
}

async function autoSwapHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const amount = toolInput.amount as string;
  const slippageBps = toolInput.slippage_bps as number | undefined;
  const sortBy = toolInput.sort_by as 'liquidity' | 'volume24h' | undefined;
  const preferredDexes = toolInput.preferred_dexes as Array<'meteora' | 'raydium' | 'orca'> | undefined;
  const inputMint = toolInput.input_mint as string | undefined;
  const outputMint = toolInput.output_mint as string | undefined;
  const tokenSymbols = toolInput.token_symbols as string[] | undefined;

  return safeHandler(async () => {
    const { wallet, pools, tokenlist, meteora, raydium, orca } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();
    const keypair = wallet.loadSolanaKeypair();

    const resolvedMints = inputMint && outputMint
      ? [inputMint, outputMint]
      : tokenSymbols && tokenSymbols.length >= 2
        ? await tokenlist.resolveTokenMints(tokenSymbols.slice(0, 2))
        : [];

    if (resolvedMints.length < 2) {
      return { error: 'Provide input_mint/output_mint or token_symbols with 2 entries.' };
    }

    const { pool } = await pools.selectBestPoolWithResolvedMints(connection, {
      tokenMints: resolvedMints,
      sortBy,
      preferredDexes,
    });

    if (!pool) {
      return { error: 'No matching pools found.' };
    }

    if (pool.dex === 'meteora') {
      const result = await meteora.executeMeteoraDlmmSwap(connection, keypair, {
        poolAddress: pool.address,
        inputMint: resolvedMints[0],
        outputMint: resolvedMints[1],
        inAmount: amount,
        slippageBps,
      });
      return { dex: pool.dex, pool, result };
    }

    if (pool.dex === 'raydium') {
      const result = await raydium.executeRaydiumSwap(connection, keypair, {
        inputMint: resolvedMints[0],
        outputMint: resolvedMints[1],
        amount,
        slippageBps,
      });
      return { dex: pool.dex, pool, result };
    }

    if (pool.dex === 'orca') {
      const result = await orca.executeOrcaWhirlpoolSwap(connection, keypair, {
        poolAddress: pool.address,
        inputMint: resolvedMints[0],
        amount,
        slippageBps,
      });
      return { dex: pool.dex, pool, result };
    }

    return { error: 'Unsupported pool type' };
  });
}

async function autoQuoteHandler(toolInput: ToolInput): Promise<HandlerResult> {
  return safeHandler(async () => {
    const { wallet, pools, meteora, raydium, orca } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();
    const amount = toolInput.amount as string;
    const slippageBps = toolInput.slippage_bps as number | undefined;

    const allPools = await pools.listAllPools(connection, {
      tokenMints: toolInput.token_mints as string[] | undefined,
      tokenSymbols: toolInput.token_symbols as string[] | undefined,
      sortBy: toolInput.sort_by as 'liquidity' | 'volume24h' | undefined,
      preferredDexes: toolInput.preferred_dexes as Array<'meteora' | 'raydium' | 'orca'> | undefined,
      limit: 30,
    });

    const perDex = new Map<string, typeof allPools>();
    for (const pool of allPools) {
      const list = perDex.get(pool.dex) || [];
      list.push(pool);
      perDex.set(pool.dex, list);
    }

    const results: Array<Record<string, unknown>> = [];
    for (const [dex, list] of perDex.entries()) {
      const pool = list[0];
      if (!pool) continue;

      try {
        if (dex === 'meteora') {
          const quote = await meteora.getMeteoraDlmmQuote(connection, {
            poolAddress: pool.address,
            inputMint: pool.tokenMintA,
            inAmount: amount,
            slippageBps,
          });
          results.push({ dex, pool, quote });
        } else if (dex === 'raydium') {
          const quote = await raydium.getRaydiumQuote({
            inputMint: pool.tokenMintA,
            outputMint: pool.tokenMintB,
            amount,
            slippageBps,
          });
          results.push({ dex, pool, quote });
        } else if (dex === 'orca') {
          const quote = await orca.getOrcaWhirlpoolQuote(connection, {
            poolAddress: pool.address,
            inputMint: pool.tokenMintA,
            amount,
            slippageBps,
          });
          results.push({ dex, pool, quote });
        }
      } catch {
        // Skip failed quotes
      }
    }

    return results;
  });
}

// ============================================================================
// Bags.fm Handlers - Complete API Coverage
// ============================================================================

const BAGS_API_BASE = 'https://public-api-v2.bags.fm/api/v1';

async function bagsRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const apiKey = process.env.BAGS_API_KEY;
  if (!apiKey) throw new Error('BAGS_API_KEY not configured. Get one at dev.bags.fm');

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
  return response.json();
}

// Trading
async function bagsQuoteHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const inputMint = toolInput.input_mint as string;
  const outputMint = toolInput.output_mint as string;
  const amount = toolInput.amount as string;

  return safeHandler(async () => {
    const quote = await bagsRequest<{
      inputAmount: string;
      outputAmount: string;
      priceImpact: number;
      slippage: number;
    }>(`/trade/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}`);
    return quote;
  });
}

async function bagsSwapHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const inputMint = toolInput.input_mint as string;
  const outputMint = toolInput.output_mint as string;
  const amount = toolInput.amount as string;
  const slippageBps = (toolInput.slippage_bps as number) || 50;

  return safeHandler(async () => {
    const { wallet } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const walletAddress = keypair.publicKey.toBase58();
    const connection = wallet.getSolanaConnection();

    const txResponse = await bagsRequest<{ transaction: string }>('/trade/swap', {
      method: 'POST',
      body: JSON.stringify({ inputMint, outputMint, amount, wallet: walletAddress, slippageBps }),
    });

    const { VersionedTransaction } = await import('@solana/web3.js');
    const txBuffer = Buffer.from(txResponse.transaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuffer);
    tx.sign([keypair]);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    return { signature, inputMint, outputMint, amount };
  }, 'Bags swap failed. Ensure BAGS_API_KEY and SOLANA_PRIVATE_KEY are set.');
}

// Discovery
async function bagsPoolsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const sort = (toolInput.sort as string) || '';
  const limit = (toolInput.limit as number) || 50;

  return safeHandler(async () => {
    let endpoint = '/pools';
    if (sort) endpoint += `?sort=${sort}&order=desc&limit=${limit}`;
    const pools = await bagsRequest<Array<{
      mint: string;
      name?: string;
      symbol?: string;
      liquidity?: number;
      volume24h?: number;
      price?: number;
      marketCap?: number;
    }>>(endpoint);
    return { pools: pools.slice(0, limit) };
  });
}

async function bagsTrendingHandler(): Promise<HandlerResult> {
  return safeHandler(async () => {
    const pools = await bagsRequest<Array<{
      mint: string;
      symbol?: string;
      name?: string;
      volume24h?: number;
      price?: number;
    }>>('/pools?sort=volume24h&order=desc&limit=20');
    return { trending: pools };
  });
}

async function bagsTokenHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const mint = toolInput.mint as string;

  return safeHandler(async () => {
    const [tokenInfo, creators, lifetimeFees, pools] = await Promise.all([
      bagsRequest<{ name?: string; symbol?: string; decimals?: number; description?: string; twitter?: string; website?: string }>(`/token/${mint}`).catch(() => null),
      bagsRequest<{ creators: Array<{ wallet: string; username?: string; bps: number }> }>(`/token-launch/creator?tokenMint=${mint}`).catch(() => null),
      bagsRequest<{ totalFees: number; totalVolume?: number }>(`/fee-share/token/lifetime-fees?tokenMint=${mint}`).catch(() => null),
      bagsRequest<Array<{ price?: number; liquidity?: number; volume24h?: number; marketCap?: number }>>(`/pools?mint=${mint}`).catch(() => null),
    ]);
    return { tokenInfo, creators: creators?.creators, lifetimeFees, marketData: pools?.[0] };
  });
}

async function bagsCreatorsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const mint = toolInput.mint as string;

  return safeHandler(async () => {
    const result = await bagsRequest<{ creators: Array<{ wallet: string; username?: string; provider?: string; bps: number }> }>(
      `/token-launch/creator?tokenMint=${mint}`
    );
    return result;
  });
}

async function bagsLifetimeFeesHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const mint = toolInput.mint as string;

  return safeHandler(async () => {
    const result = await bagsRequest<{ totalFees: number; totalVolume?: number; feeRate?: number; launchDate?: string }>(
      `/fee-share/token/lifetime-fees?tokenMint=${mint}`
    );
    return result;
  });
}

// Fee Claiming
async function bagsFeesHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const wallet = toolInput.wallet as string;

  return safeHandler(async () => {
    const positions = await bagsRequest<{
      positions: Array<{
        baseMint: string;
        tokenSymbol?: string;
        virtualPoolClaimableAmount?: number;
        dammPoolClaimableAmount?: number;
        customFeeVaultBalance?: number;
        totalClaimable: number;
      }>;
    }>(`/fee-share/claimable?wallet=${wallet}`);
    return positions;
  });
}

async function bagsClaimHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const walletArg = toolInput.wallet as string;

  return safeHandler(async () => {
    const { wallet: solWallet } = await getSolanaModules();
    const keypair = solWallet.loadSolanaKeypair();
    const walletAddress = walletArg || keypair.publicKey.toBase58();
    const connection = solWallet.getSolanaConnection();

    const claimTxs = await bagsRequest<{ transactions: string[] }>('/fee-share/claim', {
      method: 'POST',
      body: JSON.stringify({ wallet: walletAddress }),
    });

    if (!claimTxs.transactions?.length) return { claimed: false, message: 'No fees to claim' };

    const { VersionedTransaction } = await import('@solana/web3.js');
    const signatures: string[] = [];

    for (const txBase64 of claimTxs.transactions) {
      const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
      tx.sign([keypair]);
      const sig = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(sig, 'confirmed');
      signatures.push(sig);
    }

    return { claimed: true, signatures };
  }, 'Claim failed. Ensure BAGS_API_KEY and SOLANA_PRIVATE_KEY are set.');
}

async function bagsClaimEventsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const mint = toolInput.mint as string;
  const from = toolInput.from as number | undefined;
  const to = toolInput.to as number | undefined;

  return safeHandler(async () => {
    let endpoint = `/fee-share/token/claim-events?tokenMint=${mint}`;
    if (from || to) {
      endpoint += '&mode=time';
      if (from) endpoint += `&from=${from}`;
      if (to) endpoint += `&to=${to}`;
    }
    const result = await bagsRequest<{ events: Array<{ wallet: string; amount: number; timestamp: number; signature: string }> }>(endpoint);
    return result;
  });
}

async function bagsClaimStatsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const mint = toolInput.mint as string;

  return safeHandler(async () => {
    const stats = await bagsRequest<{ claimers: Array<{ wallet: string; claimed: number; unclaimed: number; totalEarned: number }> }>(
      `/fee-share/token/claim-stats?tokenMint=${mint}`
    );
    return stats;
  });
}

// Token Launch
async function bagsLaunchHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const name = toolInput.name as string;
  const symbol = toolInput.symbol as string;
  const description = toolInput.description as string;
  const imageUrl = toolInput.image_url as string | undefined;
  const twitter = toolInput.twitter as string | undefined;
  const website = toolInput.website as string | undefined;
  const telegram = toolInput.telegram as string | undefined;
  const initialBuyLamports = Math.floor(((toolInput.initial_sol as number) || 0) * 1e9);

  return safeHandler(async () => {
    const { wallet } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const walletAddress = keypair.publicKey.toBase58();
    const connection = wallet.getSolanaConnection();

    // Step 1: Create token info
    const tokenInfo = await bagsRequest<{ tokenMint: string; metadataUrl: string }>('/token-launch/create-token-info', {
      method: 'POST',
      body: JSON.stringify({ name, symbol, description, imageUrl, twitter, website, telegram }),
    });

    // Step 2: Create fee share config
    const feeConfig = await bagsRequest<{ configKey: string; transactions: string[] }>('/fee-share/create-config', {
      method: 'POST',
      body: JSON.stringify({ payer: walletAddress, baseMint: tokenInfo.tokenMint, feeClaimers: [{ user: walletAddress, userBps: 10000 }] }),
    });

    const { VersionedTransaction } = await import('@solana/web3.js');
    for (const txBase64 of feeConfig.transactions) {
      const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
      tx.sign([keypair]);
      const sig = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(sig, 'confirmed');
    }

    // Step 3: Launch
    const launchTx = await bagsRequest<{ transaction: string }>('/token-launch/create-launch-transaction', {
      method: 'POST',
      body: JSON.stringify({ metadataUrl: tokenInfo.metadataUrl, tokenMint: tokenInfo.tokenMint, launchWallet: walletAddress, initialBuyLamports, configKey: feeConfig.configKey }),
    });

    const tx = VersionedTransaction.deserialize(Buffer.from(launchTx.transaction, 'base64'));
    tx.sign([keypair]);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    return { tokenMint: tokenInfo.tokenMint, metadataUrl: tokenInfo.metadataUrl, signature };
  }, 'Launch failed. Ensure BAGS_API_KEY and SOLANA_PRIVATE_KEY are set.');
}

// Fee Share Config
async function bagsFeeConfigHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const mint = toolInput.mint as string;
  const feeClaimers = toolInput.fee_claimers as Array<{ user: string; userBps: number }>;

  return safeHandler(async () => {
    const { wallet } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const walletAddress = keypair.publicKey.toBase58();
    const connection = wallet.getSolanaConnection();

    const result = await bagsRequest<{ configKey: string; transactions: string[] }>('/fee-share/create-config', {
      method: 'POST',
      body: JSON.stringify({ payer: walletAddress, baseMint: mint, feeClaimers }),
    });

    const { VersionedTransaction } = await import('@solana/web3.js');
    const signatures: string[] = [];
    for (const txBase64 of result.transactions) {
      const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
      tx.sign([keypair]);
      const sig = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(sig, 'confirmed');
      signatures.push(sig);
    }

    return { configKey: result.configKey, signatures };
  });
}

// Wallet Lookup
async function bagsWalletLookupHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const provider = toolInput.provider as string;
  const username = toolInput.username as string;

  return safeHandler(async () => {
    const result = await bagsRequest<{ wallet: string; username: string; provider: string }>(
      `/fee-share/wallet/v2?provider=${provider}&username=${username}`
    );
    return result;
  });
}

async function bagsBulkWalletLookupHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const provider = toolInput.provider as string;
  const usernames = toolInput.usernames as string[];

  return safeHandler(async () => {
    const result = await bagsRequest<{ wallets: Array<{ username: string; wallet: string }> }>('/fee-share/wallet/v2/bulk', {
      method: 'POST',
      body: JSON.stringify({ provider, usernames }),
    });
    return result;
  });
}

// Partner System
async function bagsPartnerConfigHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const mint = toolInput.mint as string;

  return safeHandler(async () => {
    const { wallet } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const walletAddress = keypair.publicKey.toBase58();
    const connection = wallet.getSolanaConnection();

    const result = await bagsRequest<{ partnerKey: string; transaction: string }>('/fee-share/partner/create-config', {
      method: 'POST',
      body: JSON.stringify({ payer: walletAddress, tokenMint: mint }),
    });

    const { VersionedTransaction } = await import('@solana/web3.js');
    const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, 'base64'));
    tx.sign([keypair]);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    return { partnerKey: result.partnerKey, signature };
  });
}

async function bagsPartnerClaimHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const walletArg = toolInput.wallet as string | undefined;

  return safeHandler(async () => {
    const { wallet: solWallet } = await getSolanaModules();
    const keypair = solWallet.loadSolanaKeypair();
    const walletAddress = walletArg || keypair.publicKey.toBase58();
    const connection = solWallet.getSolanaConnection();

    const claimTxs = await bagsRequest<{ transactions: string[] }>('/fee-share/partner/claim', {
      method: 'POST',
      body: JSON.stringify({ wallet: walletAddress }),
    });

    if (!claimTxs.transactions?.length) return { claimed: false, message: 'No partner fees to claim' };

    const { VersionedTransaction } = await import('@solana/web3.js');
    const signatures: string[] = [];
    for (const txBase64 of claimTxs.transactions) {
      const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
      tx.sign([keypair]);
      const sig = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(sig, 'confirmed');
      signatures.push(sig);
    }

    return { claimed: true, signatures };
  });
}

async function bagsPartnerStatsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const partnerKey = toolInput.partner_key as string;

  return safeHandler(async () => {
    const stats = await bagsRequest<{
      partnerKey: string;
      totalLaunches: number;
      totalFeesEarned: number;
      claimableAmount: number;
      tokens: Array<{ mint: string; feesEarned: number }>;
    }>(`/fee-share/partner/stats?partnerKey=${partnerKey}`);
    return stats;
  });
}

// ============================================================================
// Export All Handlers
// ============================================================================

export const solanaHandlers: HandlersMap = {
  // Wallet
  solana_address: addressHandler,

  // Jupiter
  solana_jupiter_swap: jupiterSwapHandler,

  // Raydium
  raydium_swap: raydiumSwapHandler,
  raydium_pools: raydiumPoolsHandler,
  raydium_quote: raydiumQuoteHandler,

  // Orca
  orca_whirlpool_swap: orcaSwapHandler,
  orca_whirlpool_pools: orcaPoolsHandler,
  orca_whirlpool_quote: orcaQuoteHandler,

  // Meteora
  meteora_dlmm_swap: meteoraSwapHandler,
  meteora_dlmm_pools: meteoraPoolsHandler,
  meteora_dlmm_quote: meteoraQuoteHandler,

  // Pump.fun
  pumpfun_trade: pumpfunTradeHandler,

  // Drift
  drift_direct_place_order: driftPlaceOrderHandler,
  drift_direct_cancel_order: driftCancelOrderHandler,
  drift_direct_orders: driftOrdersHandler,
  drift_direct_positions: driftPositionsHandler,
  drift_direct_balance: driftBalanceHandler,
  drift_direct_modify_order: driftModifyOrderHandler,
  drift_direct_set_leverage: driftSetLeverageHandler,

  // Auto-routing
  solana_best_pool: bestPoolHandler,
  solana_auto_route: autoRouteHandler,
  solana_auto_swap: autoSwapHandler,
  solana_auto_quote: autoQuoteHandler,

  // Bags.fm - Complete Coverage
  bags_quote: bagsQuoteHandler,
  bags_swap: bagsSwapHandler,
  bags_pools: bagsPoolsHandler,
  bags_trending: bagsTrendingHandler,
  bags_token: bagsTokenHandler,
  bags_creators: bagsCreatorsHandler,
  bags_lifetime_fees: bagsLifetimeFeesHandler,
  bags_fees: bagsFeesHandler,
  bags_claim: bagsClaimHandler,
  bags_claim_events: bagsClaimEventsHandler,
  bags_claim_stats: bagsClaimStatsHandler,
  bags_launch: bagsLaunchHandler,
  bags_fee_config: bagsFeeConfigHandler,
  bags_wallet_lookup: bagsWalletLookupHandler,
  bags_bulk_wallet_lookup: bagsBulkWalletLookupHandler,
  bags_partner_config: bagsPartnerConfigHandler,
  bags_partner_claim: bagsPartnerClaimHandler,
  bags_partner_stats: bagsPartnerStatsHandler,
};

export default solanaHandlers;
