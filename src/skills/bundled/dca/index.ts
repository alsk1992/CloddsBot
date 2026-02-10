/**
 * DCA (Dollar-Cost Averaging) Skill
 *
 * Platform-specific subcommands — each uses its native SDK directly.
 *
 * Commands:
 * /dca poly <token-id> <total-$> --per <$> --every <interval> [--price <p>]
 * /dca kalshi <ticker> <total-$> --per <$> --every <interval> [--price <p>]
 * /dca pump <mint> <total-SOL> --per <SOL> --every <interval> [--slippage <bps>] [--pool pump|raydium|auto]
 * /dca hl <coin> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]
 * /dca bf <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]
 * /dca bb <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]
 * /dca sol <total> <from> to <to> --per <amt> --every <secs>  — Jupiter DCA
 * /dca list / info / pause / resume / cancel / help
 */

import type { ExecutionService, OrderResult } from '../../../execution/index.js';

const HELP = `DCA (Dollar-Cost Averaging) — spread orders over time

Platform Subcommands:
  /dca poly <token-id> <total-$> --per <$> --every <interval> [--price <p>]
      Polymarket DCA

  /dca kalshi <ticker> <total-$> --per <$> --every <interval> [--price <p>]
      Kalshi DCA

  /dca pump <mint> <total-SOL> --per <SOL> --every <interval> [--slippage <bps>] [--pool pump|raydium|auto]
      PumpFun DCA (buys via PumpPortal)

  /dca hl <coin> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]
      Hyperliquid perps DCA

  /dca bf <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]
      Binance Futures DCA

  /dca bb <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]
      Bybit Futures DCA

  /dca virtuals <agent-token> <total-VIRTUAL> --per <VIRTUAL> --every <interval> [--slippage <bps>]
      Virtuals agent token DCA (Base chain bonding curves)

  /dca base <input-token> to <output-token> <total> --per <amt> --every <interval> [--slippage <bps>]
      Base chain swap DCA via Odos

  /dca mexc <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]
      MEXC Futures DCA

  /dca drift <market-index> <total-$> --per <$> --every <interval> [--type perp|spot] [--side long|short]
      Drift Protocol DCA (Solana perps/spot)

  /dca opinion <market-id> <total-$> --per <$> --every <interval> [--price <p>]
      Opinion.trade DCA (BNB Chain)

  /dca predict <market-id> <total-$> --per <$> --every <interval> [--price <p>]
      Predict.fun DCA (BNB Chain)

  /dca orca <pool-address> <input-mint> <total> --per <amt> --every <interval> [--slippage <bps>]
      Orca Whirlpool DCA (Solana)

  /dca raydium <input-mint> to <output-mint> <total> --per <amt> --every <interval> [--slippage <bps>]
      Raydium DCA (Solana)

  /dca evm <chain> <input-token> to <output-token> <total> --per <amt> --every <interval> [--slippage <bps>]
      Generic EVM swap DCA via Odos (ethereum, polygon, arbitrum, bsc, optimism, avalanche)

  /dca sol <total> <from-mint> to <to-mint> --per <amt> --every <secs>
      Jupiter DCA on Solana

Management:
  /dca list                  List active DCA orders
  /dca info <id>             Show order details and progress
  /dca pause <id>            Pause a running DCA order
  /dca resume <id>           Resume a paused DCA order
  /dca cancel <id>           Cancel a DCA order

Intervals: 30s, 1m, 5m, 15m, 1h, 4h, 1d

Examples:
  /dca poly 0x1234...cond 100 --per 10 --every 1h --price 0.45
  /dca kalshi KXBTC-25FEB 500 --per 25 --every 4h
  /dca pump 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 5 --per 0.5 --every 5m
  /dca hl BTC 1000 --per 100 --every 4h --side long --leverage 5
  /dca bf BTCUSDT 1000 --per 100 --every 4h --side long --leverage 10
  /dca bb BTCUSDT 1000 --per 100 --every 4h --side short --leverage 3
  /dca virtuals 0xABC...token 1000 --per 100 --every 1h --slippage 200
  /dca base ETH to 0xABC...token 1 --per 0.1 --every 1h --slippage 100
  /dca mexc BTC_USDT 1000 --per 100 --every 4h --side long --leverage 20
  /dca drift 0 500 --per 50 --every 4h --type perp --side long
  /dca opinion 12345 100 --per 10 --every 1h --price 0.40
  /dca predict abc-market 100 --per 10 --every 1h
  /dca orca <pool-addr> <input-mint> 100 --per 10 --every 1h
  /dca raydium SOL to USDC 10 --per 1 --every 1h
  /dca evm polygon USDC to WETH 500 --per 50 --every 4h
  /dca sol 100 USDC to SOL --per 10 --every 3600
  /dca list
  /dca cancel abc123`;

// =============================================================================
// INTERVAL PARSING
// =============================================================================

function parseInterval(s: string): number | null {
  const m = s.match(/^(\d+(?:\.\d+)?)(s|m|h|d)$/i);
  if (!m) return null;
  const val = parseFloat(m[1]);
  switch (m[2].toLowerCase()) {
    case 's': return val * 1000;
    case 'm': return val * 60 * 1000;
    case 'h': return val * 3600 * 1000;
    case 'd': return val * 86400 * 1000;
    default: return null;
  }
}

function formatMs(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(0)}m`;
  if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h`;
  return `${(ms / 86400000).toFixed(1)}d`;
}

function formatProgress(p: any): string {
  const pct = p.totalAmount > 0 ? ((p.investedAmount / p.totalAmount) * 100).toFixed(1) : '0';
  const avg = p.avgPrice > 0 ? p.avgPrice.toFixed(4) : 'n/a';
  const lines = [
    `Status: ${p.status.toUpperCase()}`,
    `Progress: $${p.investedAmount.toFixed(2)} / $${p.totalAmount.toFixed(2)} (${pct}%)`,
    `Cycles: ${p.cyclesCompleted} / ${p.cyclesTotal}`,
    `Shares: ${p.totalShares.toFixed(2)}`,
    `Avg Price: ${avg}`,
  ];
  if (p.nextCycleAt) lines.push(`Next Cycle: ${p.nextCycleAt.toISOString()}`);
  if (p.startedAt) lines.push(`Started: ${p.startedAt.toISOString()}`);
  return lines.join('\n');
}

/** Parse common flags from args array */
function parseFlag(parts: string[], flag: string): string | undefined {
  const idx = parts.indexOf(flag);
  return idx !== -1 && idx + 1 < parts.length ? parts[idx + 1] : undefined;
}

// =============================================================================
// PLATFORM-SPECIFIC EXECUTOR ADAPTERS
// =============================================================================

/**
 * Creates an ExecutionService-compatible adapter for PumpFun trades.
 * Wraps pumpapi.executePumpFunTrade to match the buyLimit/sellLimit interface.
 */
async function createPumpExecutor(mint: string, slippageBps: number, pool: string): Promise<ExecutionService> {
  const wallet = await import('../../../solana/wallet.js');
  const pumpapi = await import('../../../solana/pumpapi.js');
  const keypair = wallet.loadSolanaKeypair();
  const connection = wallet.getSolanaConnection();

  const adapter = {
    buyLimit: async (req: any): Promise<OrderResult> => {
      const result = await pumpapi.executePumpFunTrade(connection, keypair, {
        action: 'buy',
        mint,
        amount: req.size,
        denominatedInSol: true,
        slippageBps,
        pool,
      });
      return { success: true, orderId: result.signature, avgFillPrice: req.price, filledSize: req.size };
    },
    sellLimit: async (req: any): Promise<OrderResult> => {
      const result = await pumpapi.executePumpFunTrade(connection, keypair, {
        action: 'sell',
        mint,
        amount: req.size,
        denominatedInSol: false,
        slippageBps,
        pool,
      });
      return { success: true, orderId: result.signature, avgFillPrice: req.price, filledSize: req.size };
    },
  };
  return adapter as unknown as ExecutionService;
}

/**
 * Creates an ExecutionService-compatible adapter for Hyperliquid perps.
 */
async function createHLExecutor(coin: string, leverage?: number): Promise<ExecutionService> {
  const hl = await import('../../../exchanges/hyperliquid/index.js');
  const config = {
    walletAddress: process.env.HYPERLIQUID_WALLET!,
    privateKey: process.env.HYPERLIQUID_PRIVATE_KEY!,
  };

  if (leverage) await hl.updateLeverage(config, coin, leverage);

  const adapter = {
    buyLimit: async (req: any): Promise<OrderResult> => {
      const r = await hl.placePerpOrder(config, { coin, side: 'BUY', size: req.size, type: 'MARKET' });
      return { success: r.success, orderId: r.orderId != null ? String(r.orderId) : undefined, error: r.error };
    },
    sellLimit: async (req: any): Promise<OrderResult> => {
      const r = await hl.placePerpOrder(config, { coin, side: 'SELL', size: req.size, type: 'MARKET' });
      return { success: r.success, orderId: r.orderId != null ? String(r.orderId) : undefined, error: r.error };
    },
  };
  return adapter as unknown as ExecutionService;
}

/**
 * Creates an ExecutionService-compatible adapter for Binance Futures.
 */
async function createBFExecutor(symbol: string, leverage?: number): Promise<ExecutionService> {
  const bf = await import('../../../exchanges/binance-futures/index.js');
  const config = { apiKey: process.env.BINANCE_API_KEY!, apiSecret: process.env.BINANCE_API_SECRET! };

  const adapter = {
    buyLimit: async (req: any): Promise<OrderResult> => {
      const result = await bf.openLong(config, symbol, req.size, leverage);
      return { success: true, orderId: String(result.orderId), avgFillPrice: result.avgPrice, filledSize: result.executedQty };
    },
    sellLimit: async (req: any): Promise<OrderResult> => {
      const result = await bf.openShort(config, symbol, req.size, leverage);
      return { success: true, orderId: String(result.orderId), avgFillPrice: result.avgPrice, filledSize: result.executedQty };
    },
  };
  return adapter as unknown as ExecutionService;
}

/**
 * Creates an ExecutionService-compatible adapter for Bybit Futures.
 */
async function createBBExecutor(symbol: string, leverage?: number): Promise<ExecutionService> {
  const bb = await import('../../../exchanges/bybit/index.js');
  const config = { apiKey: process.env.BYBIT_API_KEY!, apiSecret: process.env.BYBIT_API_SECRET! };

  const adapter = {
    buyLimit: async (req: any): Promise<OrderResult> => {
      const result = await bb.openLong(config, symbol, req.size, leverage);
      return { success: true, orderId: String(result.orderId), avgFillPrice: result.avgPrice, filledSize: result.cumExecQty };
    },
    sellLimit: async (req: any): Promise<OrderResult> => {
      const result = await bb.openShort(config, symbol, req.size, leverage);
      return { success: true, orderId: String(result.orderId), avgFillPrice: result.avgPrice, filledSize: result.cumExecQty };
    },
  };
  return adapter as unknown as ExecutionService;
}

/**
 * Creates an ExecutionService-compatible adapter for Virtuals (Base chain).
 * Uses buyAgentToken/sellAgentToken from the virtuals module.
 */
async function createVirtualsExecutor(agentToken: string, slippageBps: number): Promise<ExecutionService> {
  const virtuals = await import('../../../evm/virtuals.js');

  const adapter = {
    buyLimit: async (req: any): Promise<OrderResult> => {
      const result = await virtuals.buyAgentToken({ agentToken, amount: String(req.size), side: 'buy', slippageBps });
      return { success: result.success, orderId: result.txHash, filledSize: req.size, error: result.error };
    },
    sellLimit: async (req: any): Promise<OrderResult> => {
      const result = await virtuals.sellAgentToken({ agentToken, amount: String(req.size), side: 'sell', slippageBps });
      return { success: result.success, orderId: result.txHash, filledSize: req.size, error: result.error };
    },
  };
  return adapter as unknown as ExecutionService;
}

/**
 * Creates an ExecutionService-compatible adapter for generic EVM swaps via Odos.
 * Works on any supported chain (ethereum, base, polygon, arbitrum, bsc, etc.).
 */
async function createEvmExecutor(chain: string, inputToken: string, outputToken: string, slippageBps: number): Promise<ExecutionService> {
  const odos = await import('../../../evm/odos.js');

  const adapter = {
    buyLimit: async (req: any): Promise<OrderResult> => {
      const result = await odos.executeOdosSwap({
        chain: chain as any,
        inputToken,
        outputToken,
        amount: String(req.size),
        slippageBps,
        privateKey: process.env.EVM_PRIVATE_KEY!,
      });
      return { success: result.success, orderId: result.txHash, filledSize: req.size, error: result.error };
    },
    sellLimit: async (req: any): Promise<OrderResult> => {
      const result = await odos.executeOdosSwap({
        chain: chain as any,
        inputToken: outputToken,
        outputToken: inputToken,
        amount: String(req.size),
        slippageBps,
        privateKey: process.env.EVM_PRIVATE_KEY!,
      });
      return { success: result.success, orderId: result.txHash, filledSize: req.size, error: result.error };
    },
  };
  return adapter as unknown as ExecutionService;
}

/**
 * Creates an ExecutionService-compatible adapter for MEXC Futures.
 */
async function createMexcExecutor(symbol: string, leverage?: number): Promise<ExecutionService> {
  const mexc = await import('../../../exchanges/mexc/index.js');
  const config = { apiKey: process.env.MEXC_API_KEY!, apiSecret: process.env.MEXC_API_SECRET! };

  const adapter = {
    buyLimit: async (req: any): Promise<OrderResult> => {
      const result = await mexc.openLong(config, symbol, req.size, leverage);
      return { success: true, orderId: String(result.orderId), avgFillPrice: result.dealAvgPrice, filledSize: req.size };
    },
    sellLimit: async (req: any): Promise<OrderResult> => {
      const result = await mexc.openShort(config, symbol, req.size, leverage);
      return { success: true, orderId: String(result.orderId), avgFillPrice: result.dealAvgPrice, filledSize: req.size };
    },
  };
  return adapter as unknown as ExecutionService;
}

/**
 * Creates an ExecutionService-compatible adapter for Drift (Solana perps).
 */
async function createDriftExecutor(marketIndex: number, marketType: 'perp' | 'spot'): Promise<ExecutionService> {
  const drift = await import('../../../solana/drift.js');
  const wallet = await import('../../../solana/wallet.js');
  const keypair = wallet.loadSolanaKeypair();
  const connection = wallet.getSolanaConnection();

  const adapter = {
    buyLimit: async (req: any): Promise<OrderResult> => {
      const result = await drift.executeDriftDirectOrder(connection, keypair, {
        marketType, marketIndex, side: 'buy', orderType: 'market', baseAmount: String(req.size),
      });
      return { success: true, orderId: String(result.orderId) };
    },
    sellLimit: async (req: any): Promise<OrderResult> => {
      const result = await drift.executeDriftDirectOrder(connection, keypair, {
        marketType, marketIndex, side: 'sell', orderType: 'market', baseAmount: String(req.size),
      });
      return { success: true, orderId: String(result.orderId) };
    },
  };
  return adapter as unknown as ExecutionService;
}

/**
 * Creates an ExecutionService for Opinion.trade using createExecutionService.
 */
async function createOpinionExecutor(): Promise<ExecutionService> {
  const { createExecutionService } = await import('../../../execution/index.js');
  return createExecutionService({
    opinion: {
      apiKey: process.env.OPINION_API_KEY!,
      privateKey: process.env.OPINION_PRIVATE_KEY,
    },
  });
}

/**
 * Creates an ExecutionService for Predict.fun using createExecutionService.
 */
async function createPredictExecutor(): Promise<ExecutionService> {
  const { createExecutionService } = await import('../../../execution/index.js');
  return createExecutionService({
    predictfun: {
      privateKey: process.env.PREDICTFUN_PRIVATE_KEY!,
      predictAccount: process.env.PREDICTFUN_ACCOUNT,
      apiKey: process.env.PREDICTFUN_API_KEY,
    },
  });
}

/**
 * Creates an ExecutionService-compatible adapter for Orca Whirlpool swaps (Solana).
 */
async function createOrcaExecutor(poolAddress: string, inputMint: string, slippageBps: number): Promise<ExecutionService> {
  const orca = await import('../../../solana/orca.js');
  const wallet = await import('../../../solana/wallet.js');
  const keypair = wallet.loadSolanaKeypair();
  const connection = wallet.getSolanaConnection();

  const adapter = {
    buyLimit: async (req: any): Promise<OrderResult> => {
      const result = await orca.executeOrcaWhirlpoolSwap(connection, keypair, {
        poolAddress, inputMint, amount: String(req.size), slippageBps,
      });
      return { success: true, orderId: result.signature, filledSize: req.size };
    },
    sellLimit: async (_req: any): Promise<OrderResult> => {
      return { success: false, error: 'Orca DCA sell not supported — use /dca cancel and sell manually' };
    },
  };
  return adapter as unknown as ExecutionService;
}

/**
 * Creates an ExecutionService-compatible adapter for Raydium swaps (Solana).
 */
async function createRaydiumExecutor(inputMint: string, outputMint: string, slippageBps: number): Promise<ExecutionService> {
  const raydium = await import('../../../solana/raydium.js');
  const wallet = await import('../../../solana/wallet.js');
  const keypair = wallet.loadSolanaKeypair();
  const connection = wallet.getSolanaConnection();

  const adapter = {
    buyLimit: async (req: any): Promise<OrderResult> => {
      const result = await raydium.executeRaydiumSwap(connection, keypair, {
        inputMint, outputMint, amount: String(req.size), slippageBps,
      });
      return { success: true, orderId: result.signature, filledSize: req.size };
    },
    sellLimit: async (req: any): Promise<OrderResult> => {
      const result = await raydium.executeRaydiumSwap(connection, keypair, {
        inputMint: outputMint, outputMint: inputMint, amount: String(req.size), slippageBps,
      });
      return { success: true, orderId: result.signature, filledSize: req.size };
    },
  };
  return adapter as unknown as ExecutionService;
}

/**
 * Creates an ExecutionService for Polymarket using the standard createExecutionService.
 */
async function createPolyExecutor(): Promise<ExecutionService> {
  const { createExecutionService } = await import('../../../execution/index.js');
  return createExecutionService({
    polymarket: {
      apiKey: process.env.POLY_API_KEY!,
      apiSecret: process.env.POLY_API_SECRET!,
      apiPassphrase: process.env.POLY_API_PASSPHRASE!,
      address: process.env.POLY_FUNDER_ADDRESS!,
      funderAddress: process.env.POLY_FUNDER_ADDRESS,
      privateKey: process.env.POLY_PRIVATE_KEY,
      signatureType: 2,
    },
  });
}

/**
 * Creates an ExecutionService for Kalshi using the standard createExecutionService.
 */
async function createKalshiExecutor(): Promise<ExecutionService> {
  const { createExecutionService } = await import('../../../execution/index.js');
  const { normalizeKalshiPrivateKey } = await import('../../../utils/kalshi-auth.js');
  return createExecutionService({
    kalshi: {
      apiKeyId: process.env.KALSHI_API_KEY_ID!,
      privateKeyPem: normalizeKalshiPrivateKey(process.env.KALSHI_PRIVATE_KEY!),
    },
  });
}

// =============================================================================
// PLATFORM HANDLERS
// =============================================================================

async function handlePoly(args: string): Promise<string> {
  // /dca poly <token-id> <total-$> --per <$> --every <interval> [--price <p>]
  const parts = args.split(/\s+/);
  if (parts.length < 6) return 'Usage: /dca poly <token-id> <total-$> --per <$> --every <interval> [--price <p>]';

  const tokenId = parts[0];
  const totalAmount = parseFloat(parts[1]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const price = parseFloat(parseFlag(parts, '--price') ?? '0.50');
  const maxPrice = parseFlag(parts, '--max-price') ? parseFloat(parseFlag(parts, '--max-price')!) : undefined;

  try {
    const exec = await createPolyExecutor();
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'polymarket', marketId: tokenId, side: 'buy', price, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs, maxPrice },
      { userId: 'cli-user' },
      { platform: 'poly' }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (Polymarket)`,
      `ID: ${order.id}`,
      `Token: ${tokenId}`,
      `Total: $${totalAmount} over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: $${amountPerCycle} every ${formatMs(cycleIntervalMs)}`,
      `Price: ${price}`,
      maxPrice ? `Max Price: ${maxPrice}` : '',
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].filter(Boolean).join('\n');
  } catch (err: any) {
    return `Failed to create Polymarket DCA: ${err.message}`;
  }
}

async function handleKalshi(args: string): Promise<string> {
  // /dca kalshi <ticker> <total-$> --per <$> --every <interval> [--price <p>]
  const parts = args.split(/\s+/);
  if (parts.length < 6) return 'Usage: /dca kalshi <ticker> <total-$> --per <$> --every <interval> [--price <p>]';

  const ticker = parts[0];
  const totalAmount = parseFloat(parts[1]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const price = parseFloat(parseFlag(parts, '--price') ?? '0.50');

  try {
    const exec = await createKalshiExecutor();
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'kalshi', marketId: ticker, side: 'buy', price, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs },
      { userId: 'cli-user' },
      { platform: 'kalshi' }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (Kalshi)`,
      `ID: ${order.id}`,
      `Ticker: ${ticker}`,
      `Total: $${totalAmount} over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: $${amountPerCycle} every ${formatMs(cycleIntervalMs)}`,
      `Price: ${price}`,
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].join('\n');
  } catch (err: any) {
    return `Failed to create Kalshi DCA: ${err.message}`;
  }
}

async function handlePump(args: string): Promise<string> {
  // /dca pump <mint> <total-SOL> --per <SOL> --every <interval> [--slippage <bps>] [--pool pump|pump-amm|auto]
  const parts = args.split(/\s+/);
  if (parts.length < 6) return 'Usage: /dca pump <mint> <total-SOL> --per <SOL> --every <interval> [--slippage <bps>] [--pool pump|pump-amm|auto]';

  const mint = parts[0];
  const totalAmount = parseFloat(parts[1]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total SOL amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const slippageBps = parseInt(parseFlag(parts, '--slippage') ?? '500', 10);
  const pool = parseFlag(parts, '--pool') ?? 'auto';

  // If pool=auto, detect best pool
  let resolvedPool = pool;
  if (pool === 'auto') {
    try {
      const pumpapi = await import('../../../solana/pumpapi.js');
      const wallet = await import('../../../solana/wallet.js');
      const connection = wallet.getSolanaConnection();
      const best = await pumpapi.getBestPool(connection, mint);
      resolvedPool = best.pool;
    } catch {
      resolvedPool = 'pump';
    }
  }

  try {
    const exec = await createPumpExecutor(mint, slippageBps, resolvedPool);
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'polymarket' as any, marketId: mint, side: 'buy', price: 1, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs },
      { userId: 'cli-user' },
      { platform: 'pump', mint, slippageBps, pool: resolvedPool }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (PumpFun)`,
      `ID: ${order.id}`,
      `Mint: ${mint}`,
      `Total: ${totalAmount} SOL over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: ${amountPerCycle} SOL every ${formatMs(cycleIntervalMs)}`,
      `Slippage: ${slippageBps} bps`,
      `Pool: ${resolvedPool}`,
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].join('\n');
  } catch (err: any) {
    return `Failed to create PumpFun DCA: ${err.message}`;
  }
}

async function handleHL(args: string): Promise<string> {
  // /dca hl <coin> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]
  const parts = args.split(/\s+/);
  if (parts.length < 6) return 'Usage: /dca hl <coin> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]';

  const coin = parts[0];
  const totalAmount = parseFloat(parts[1]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const sideStr = parseFlag(parts, '--side') ?? 'long';
  const side = sideStr === 'short' ? 'sell' : 'buy';
  const leverage = parseFlag(parts, '--leverage') ? parseInt(parseFlag(parts, '--leverage')!, 10) : undefined;

  if (!process.env.HYPERLIQUID_WALLET || !process.env.HYPERLIQUID_PRIVATE_KEY) {
    return 'Missing HYPERLIQUID_WALLET or HYPERLIQUID_PRIVATE_KEY env vars.';
  }

  try {
    const exec = await createHLExecutor(coin, leverage);
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'polymarket' as any, marketId: coin, side: side as 'buy' | 'sell', price: 1, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs },
      { userId: 'cli-user' },
      { platform: 'hl', coin, leverage, side: sideStr }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (Hyperliquid)`,
      `ID: ${order.id}`,
      `Coin: ${coin}`,
      `Side: ${sideStr}${leverage ? ` @ ${leverage}x` : ''}`,
      `Total: $${totalAmount} over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: $${amountPerCycle} every ${formatMs(cycleIntervalMs)}`,
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].join('\n');
  } catch (err: any) {
    return `Failed to create Hyperliquid DCA: ${err.message}`;
  }
}

async function handleBF(args: string): Promise<string> {
  // /dca bf <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]
  const parts = args.split(/\s+/);
  if (parts.length < 6) return 'Usage: /dca bf <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]';

  const symbol = parts[0];
  const totalAmount = parseFloat(parts[1]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const sideStr = parseFlag(parts, '--side') ?? 'long';
  const side = sideStr === 'short' ? 'sell' : 'buy';
  const leverage = parseFlag(parts, '--leverage') ? parseInt(parseFlag(parts, '--leverage')!, 10) : undefined;

  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    return 'Missing BINANCE_API_KEY or BINANCE_API_SECRET env vars.';
  }

  try {
    const exec = await createBFExecutor(symbol, leverage);
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'polymarket' as any, marketId: symbol, side: side as 'buy' | 'sell', price: 1, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs },
      { userId: 'cli-user' },
      { platform: 'bf', symbol, leverage, side: sideStr }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (Binance Futures)`,
      `ID: ${order.id}`,
      `Symbol: ${symbol}`,
      `Side: ${sideStr}${leverage ? ` @ ${leverage}x` : ''}`,
      `Total: $${totalAmount} over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: $${amountPerCycle} every ${formatMs(cycleIntervalMs)}`,
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].join('\n');
  } catch (err: any) {
    return `Failed to create Binance Futures DCA: ${err.message}`;
  }
}

async function handleBB(args: string): Promise<string> {
  // /dca bb <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]
  const parts = args.split(/\s+/);
  if (parts.length < 6) return 'Usage: /dca bb <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]';

  const symbol = parts[0];
  const totalAmount = parseFloat(parts[1]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const sideStr = parseFlag(parts, '--side') ?? 'long';
  const side = sideStr === 'short' ? 'sell' : 'buy';
  const leverage = parseFlag(parts, '--leverage') ? parseInt(parseFlag(parts, '--leverage')!, 10) : undefined;

  if (!process.env.BYBIT_API_KEY || !process.env.BYBIT_API_SECRET) {
    return 'Missing BYBIT_API_KEY or BYBIT_API_SECRET env vars.';
  }

  try {
    const exec = await createBBExecutor(symbol, leverage);
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'polymarket' as any, marketId: symbol, side: side as 'buy' | 'sell', price: 1, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs },
      { userId: 'cli-user' },
      { platform: 'bb', symbol, leverage, side: sideStr }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (Bybit)`,
      `ID: ${order.id}`,
      `Symbol: ${symbol}`,
      `Side: ${sideStr}${leverage ? ` @ ${leverage}x` : ''}`,
      `Total: $${totalAmount} over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: $${amountPerCycle} every ${formatMs(cycleIntervalMs)}`,
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].join('\n');
  } catch (err: any) {
    return `Failed to create Bybit DCA: ${err.message}`;
  }
}

async function handleVirtuals(args: string): Promise<string> {
  // /dca virtuals <agent-token> <total-VIRTUAL> --per <VIRTUAL> --every <interval> [--slippage <bps>]
  const parts = args.split(/\s+/);
  if (parts.length < 6) return 'Usage: /dca virtuals <agent-token-address> <total-VIRTUAL> --per <VIRTUAL> --every <interval> [--slippage <bps>]';

  const agentToken = parts[0];
  const totalAmount = parseFloat(parts[1]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const slippageBps = parseInt(parseFlag(parts, '--slippage') ?? '100', 10);

  if (!process.env.EVM_PRIVATE_KEY) {
    return 'Missing EVM_PRIVATE_KEY env var.';
  }

  try {
    const exec = await createVirtualsExecutor(agentToken, slippageBps);
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'polymarket' as any, marketId: agentToken, side: 'buy', price: 1, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs },
      { userId: 'cli-user' },
      { platform: 'virtuals', agentToken, slippageBps }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (Virtuals / Base)`,
      `ID: ${order.id}`,
      `Agent Token: ${agentToken}`,
      `Total: ${totalAmount} VIRTUAL over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: ${amountPerCycle} VIRTUAL every ${formatMs(cycleIntervalMs)}`,
      `Slippage: ${slippageBps} bps`,
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].join('\n');
  } catch (err: any) {
    return `Failed to create Virtuals DCA: ${err.message}`;
  }
}

async function handleEvmSwap(args: string, fixedChain?: string): Promise<string> {
  const parts = args.split(/\s+/);

  // If chain is fixed (e.g. /dca base), args start with <input-token>
  // If not fixed (e.g. /dca evm), first arg is the chain
  let chain: string;
  let tokenStartIdx: number;

  if (fixedChain) {
    chain = fixedChain;
    tokenStartIdx = 0;
    if (parts.length < 7) return `Usage: /dca ${fixedChain} <input-token> to <output-token> <total> --per <amt> --every <interval> [--slippage <bps>]`;
  } else {
    chain = parts[0];
    tokenStartIdx = 1;
    if (parts.length < 8) return 'Usage: /dca evm <chain> <input-token> to <output-token> <total> --per <amt> --every <interval> [--slippage <bps>]\nChains: ethereum, base, polygon, arbitrum, bsc, optimism, avalanche';
  }

  const inputToken = parts[tokenStartIdx];
  const toIdx = parts.indexOf('to');
  if (toIdx === -1) {
    const usage = fixedChain
      ? `Usage: /dca ${fixedChain} <input> to <output> <total> --per <amt> --every <interval>`
      : 'Usage: /dca evm <chain> <input> to <output> <total> --per <amt> --every <interval>';
    return 'Missing "to" keyword. ' + usage;
  }
  const outputToken = parts[toIdx + 1];
  const totalAmount = parseFloat(parts[toIdx + 2]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const slippageBps = parseInt(parseFlag(parts, '--slippage') ?? '50', 10);

  if (!process.env.EVM_PRIVATE_KEY) {
    return 'Missing EVM_PRIVATE_KEY env var.';
  }

  try {
    const exec = await createEvmExecutor(chain, inputToken, outputToken, slippageBps);
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'polymarket' as any, marketId: `${inputToken}->${outputToken}`, side: 'buy', price: 1, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs },
      { userId: 'cli-user' },
      { platform: 'evm', chain, inputToken, outputToken, slippageBps }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (${chain})`,
      `ID: ${order.id}`,
      `Swap: ${inputToken} -> ${outputToken}`,
      `Chain: ${chain}`,
      `Total: ${totalAmount} over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: ${amountPerCycle} every ${formatMs(cycleIntervalMs)}`,
      `Slippage: ${slippageBps} bps`,
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].join('\n');
  } catch (err: any) {
    return `Failed to create ${chain} DCA: ${err.message}`;
  }
}

async function handleEvm(args: string): Promise<string> {
  return handleEvmSwap(args);
}

async function handleBase(args: string): Promise<string> {
  return handleEvmSwap(args, 'base');
}

async function handleMexc(args: string): Promise<string> {
  // /dca mexc <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]
  const parts = args.split(/\s+/);
  if (parts.length < 6) return 'Usage: /dca mexc <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]';

  const symbol = parts[0];
  const totalAmount = parseFloat(parts[1]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const sideStr = parseFlag(parts, '--side') ?? 'long';
  const side = sideStr === 'short' ? 'sell' : 'buy';
  const leverage = parseFlag(parts, '--leverage') ? parseInt(parseFlag(parts, '--leverage')!, 10) : undefined;

  if (!process.env.MEXC_API_KEY || !process.env.MEXC_API_SECRET) {
    return 'Missing MEXC_API_KEY or MEXC_API_SECRET env vars.';
  }

  try {
    const exec = await createMexcExecutor(symbol, leverage);
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'polymarket' as any, marketId: symbol, side: side as 'buy' | 'sell', price: 1, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs },
      { userId: 'cli-user' },
      { platform: 'mexc', symbol, leverage, side: sideStr }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (MEXC Futures)`,
      `ID: ${order.id}`,
      `Symbol: ${symbol}`,
      `Side: ${sideStr}${leverage ? ` @ ${leverage}x` : ''}`,
      `Total: $${totalAmount} over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: $${amountPerCycle} every ${formatMs(cycleIntervalMs)}`,
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].join('\n');
  } catch (err: any) {
    return `Failed to create MEXC DCA: ${err.message}`;
  }
}

async function handleDrift(args: string): Promise<string> {
  // /dca drift <market-index> <total-$> --per <$> --every <interval> [--type perp|spot] [--side long|short]
  const parts = args.split(/\s+/);
  if (parts.length < 6) return 'Usage: /dca drift <market-index> <total-$> --per <$> --every <interval> [--type perp|spot] [--side long|short]';

  const marketIndex = parseInt(parts[0], 10);
  if (isNaN(marketIndex)) return 'Invalid market index (must be a number).';

  const totalAmount = parseFloat(parts[1]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const marketType = (parseFlag(parts, '--type') ?? 'perp') as 'perp' | 'spot';
  const sideStr = parseFlag(parts, '--side') ?? 'long';
  const side = sideStr === 'short' ? 'sell' : 'buy';

  try {
    const exec = await createDriftExecutor(marketIndex, marketType);
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'polymarket' as any, marketId: String(marketIndex), side: side as 'buy' | 'sell', price: 1, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs },
      { userId: 'cli-user' },
      { platform: 'drift', marketIndex, marketType, side: sideStr }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (Drift ${marketType})`,
      `ID: ${order.id}`,
      `Market Index: ${marketIndex}`,
      `Side: ${sideStr}`,
      `Total: $${totalAmount} over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: $${amountPerCycle} every ${formatMs(cycleIntervalMs)}`,
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].join('\n');
  } catch (err: any) {
    return `Failed to create Drift DCA: ${err.message}`;
  }
}

async function handleOpinion(args: string): Promise<string> {
  // /dca opinion <market-id> <total-$> --per <$> --every <interval> [--price <p>]
  const parts = args.split(/\s+/);
  if (parts.length < 6) return 'Usage: /dca opinion <market-id> <total-$> --per <$> --every <interval> [--price <p>]';

  const marketId = parts[0];
  const totalAmount = parseFloat(parts[1]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const price = parseFloat(parseFlag(parts, '--price') ?? '0.50');

  if (!process.env.OPINION_API_KEY) {
    return 'Missing OPINION_API_KEY env var.';
  }

  try {
    const exec = await createOpinionExecutor();
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'opinion', marketId, side: 'buy', price, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs },
      { userId: 'cli-user' },
      { platform: 'opinion' }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (Opinion.trade)`,
      `ID: ${order.id}`,
      `Market: ${marketId}`,
      `Total: $${totalAmount} over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: $${amountPerCycle} every ${formatMs(cycleIntervalMs)}`,
      `Price: ${price}`,
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].join('\n');
  } catch (err: any) {
    return `Failed to create Opinion DCA: ${err.message}`;
  }
}

async function handlePredict(args: string): Promise<string> {
  // /dca predict <market-id> <total-$> --per <$> --every <interval> [--price <p>]
  const parts = args.split(/\s+/);
  if (parts.length < 6) return 'Usage: /dca predict <market-id> <total-$> --per <$> --every <interval> [--price <p>]';

  const marketId = parts[0];
  const totalAmount = parseFloat(parts[1]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const price = parseFloat(parseFlag(parts, '--price') ?? '0.50');

  if (!process.env.PREDICTFUN_PRIVATE_KEY) {
    return 'Missing PREDICTFUN_PRIVATE_KEY env var.';
  }

  try {
    const exec = await createPredictExecutor();
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'predictfun', marketId, side: 'buy', price, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs },
      { userId: 'cli-user' },
      { platform: 'predict' }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (Predict.fun)`,
      `ID: ${order.id}`,
      `Market: ${marketId}`,
      `Total: $${totalAmount} over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: $${amountPerCycle} every ${formatMs(cycleIntervalMs)}`,
      `Price: ${price}`,
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].join('\n');
  } catch (err: any) {
    return `Failed to create Predict.fun DCA: ${err.message}`;
  }
}

async function handleOrca(args: string): Promise<string> {
  // /dca orca <pool-address> <input-mint> <total> --per <amt> --every <interval> [--slippage <bps>]
  const parts = args.split(/\s+/);
  if (parts.length < 7) return 'Usage: /dca orca <pool-address> <input-mint> <total> --per <amt> --every <interval> [--slippage <bps>]';

  const poolAddress = parts[0];
  const inputMint = parts[1];
  const totalAmount = parseFloat(parts[2]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const slippageBps = parseInt(parseFlag(parts, '--slippage') ?? '50', 10);

  try {
    const exec = await createOrcaExecutor(poolAddress, inputMint, slippageBps);
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'polymarket' as any, marketId: poolAddress, side: 'buy', price: 1, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs },
      { userId: 'cli-user' },
      { platform: 'orca', poolAddress, inputMint, slippageBps }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (Orca Whirlpool)`,
      `ID: ${order.id}`,
      `Pool: ${poolAddress}`,
      `Input: ${inputMint}`,
      `Total: ${totalAmount} over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: ${amountPerCycle} every ${formatMs(cycleIntervalMs)}`,
      `Slippage: ${slippageBps} bps`,
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].join('\n');
  } catch (err: any) {
    return `Failed to create Orca DCA: ${err.message}`;
  }
}

async function handleRaydium(args: string): Promise<string> {
  // /dca raydium <input-mint> to <output-mint> <total> --per <amt> --every <interval> [--slippage <bps>]
  const parts = args.split(/\s+/);
  if (parts.length < 7) return 'Usage: /dca raydium <input-mint> to <output-mint> <total> --per <amt> --every <interval> [--slippage <bps>]';

  const inputMint = parts[0];
  const toIdx = parts.indexOf('to');
  if (toIdx === -1) return 'Missing "to" keyword. Usage: /dca raydium <input> to <output> <total> --per <amt> --every <interval>';
  const outputMint = parts[toIdx + 1];
  const totalAmount = parseFloat(parts[toIdx + 2]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const slippageBps = parseInt(parseFlag(parts, '--slippage') ?? '50', 10);

  try {
    const exec = await createRaydiumExecutor(inputMint, outputMint, slippageBps);
    const { createDCAOrder } = await import('../../../execution/dca.js');

    const order = createDCAOrder(
      exec,
      { platform: 'polymarket' as any, marketId: `${inputMint}->${outputMint}`, side: 'buy', price: 1, negRisk: false },
      { totalAmount, amountPerCycle, cycleIntervalMs },
      { userId: 'cli-user' },
      { platform: 'raydium', inputMint, outputMint, slippageBps }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);
    return [
      `DCA Order Created (Raydium)`,
      `ID: ${order.id}`,
      `Swap: ${inputMint} -> ${outputMint}`,
      `Total: ${totalAmount} over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: ${amountPerCycle} every ${formatMs(cycleIntervalMs)}`,
      `Slippage: ${slippageBps} bps`,
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].join('\n');
  } catch (err: any) {
    return `Failed to create Raydium DCA: ${err.message}`;
  }
}

// =============================================================================
// LEGACY: /dca create (backwards compatible)
// =============================================================================

async function handleCreate(args: string): Promise<string> {
  // Parse: <market-id> <total> --per <amt> --every <interval> [--platform X] [--side Y] [--price P] [--max-price MP]
  const parts = args.split(/\s+/);
  if (parts.length < 6) return 'Usage: /dca create <market-id> <total-$> --per <$> --every <interval>\n\n' + HELP;

  const marketId = parts[0];
  const totalAmount = parseFloat(parts[1]);
  if (isNaN(totalAmount) || totalAmount <= 0) return 'Invalid total amount.';

  const amountPerCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  if (isNaN(amountPerCycle) || amountPerCycle <= 0) return 'Invalid --per amount.';

  const intervalStr = parseFlag(parts, '--every') ?? '';
  const cycleIntervalMs = parseInterval(intervalStr);
  if (!cycleIntervalMs) return `Invalid interval "${intervalStr}". Use: 30s, 1m, 5m, 15m, 1h, 4h, 1d`;

  const platform = parseFlag(parts, '--platform') ?? 'polymarket';
  const side = parseFlag(parts, '--side') ?? 'buy';
  const price = parseFloat(parseFlag(parts, '--price') ?? '0.50');
  const maxPrice = parseFlag(parts, '--max-price') ? parseFloat(parseFlag(parts, '--max-price')!) : undefined;

  try {
    const { createDCAOrder } = await import('../../../execution/dca.js');
    const { createExecutionService } = await import('../../../execution/index.js');
    const exec = createExecutionService({});

    const order = createDCAOrder(
      exec,
      {
        platform: platform as any,
        marketId,
        side: side as 'buy' | 'sell',
        price,
        negRisk: false,
      },
      { totalAmount, amountPerCycle, cycleIntervalMs, maxPrice },
      { userId: 'cli-user' },
      { platform }
    );

    order.start();
    const cycles = Math.ceil(totalAmount / amountPerCycle);

    return [
      `DCA Order Created`,
      `ID: ${order.id}`,
      `Market: ${marketId}`,
      `Total: $${totalAmount} over ${cycles} cycles (~${formatMs(cycleIntervalMs * cycles)})`,
      `Per Cycle: $${amountPerCycle} every ${formatMs(cycleIntervalMs)}`,
      `Platform: ${platform}`,
      `Side: ${side} @ ${price}`,
      maxPrice ? `Max Price: ${maxPrice}` : '',
      '',
      'Use /dca info <id> to check progress, /dca cancel <id> to stop.',
    ].filter(Boolean).join('\n');
  } catch (err: any) {
    return `Failed to create DCA order: ${err.message}`;
  }
}

// =============================================================================
// MANAGEMENT HANDLERS
// =============================================================================

const PLATFORM_LABELS: Record<string, string> = {
  poly: 'Polymarket', kalshi: 'Kalshi', pump: 'PumpFun',
  hl: 'Hyperliquid', bf: 'Binance Futures', bb: 'Bybit', mexc: 'MEXC Futures',
  drift: 'Drift', opinion: 'Opinion.trade', predict: 'Predict.fun',
  orca: 'Orca', raydium: 'Raydium',
  virtuals: 'Virtuals (Base)', base: 'Base', evm: 'EVM',
  sol: 'Jupiter', polymarket: 'Polymarket',
};

async function handleList(): Promise<string> {
  try {
    const { getAllActiveDCAOrders } = await import('../../../execution/dca.js');
    const orders = getAllActiveDCAOrders();

    if (orders.length === 0) {
      let jupMsg = '';
      try { jupMsg = '\n\nTip: Use /jup dca list for Solana Jupiter DCA orders.'; } catch { /* ignore */ }
      return 'No active DCA orders.' + jupMsg;
    }

    const lines = ['Active DCA Orders:', ''];
    for (const order of orders) {
      const p = order.getProgress();
      const pct = p.totalAmount > 0 ? ((p.investedAmount / p.totalAmount) * 100).toFixed(0) : '0';
      const platformLabel = (order as any).extraConfig?.platform
        ? PLATFORM_LABELS[(order as any).extraConfig.platform] ?? (order as any).extraConfig.platform
        : '';
      const prefix = platformLabel ? `[${platformLabel}] ` : '';
      lines.push(`${prefix}[${p.status.toUpperCase()}] ${order.id.slice(0, 8)}... — $${p.investedAmount.toFixed(2)}/$${p.totalAmount.toFixed(2)} (${pct}%) — ${p.cyclesCompleted}/${p.cyclesTotal} cycles`);
    }

    return lines.join('\n');
  } catch (err: any) {
    return `Error listing DCA orders: ${err.message}`;
  }
}

async function handleInfo(id: string): Promise<string> {
  if (!id) return 'Usage: /dca info <order-id>';
  try {
    const { getActiveDCAOrder } = await import('../../../execution/dca.js');
    const order = getActiveDCAOrder(id);
    if (!order) {
      const { getDCAOrder } = await import('../../../execution/dca-persistence.js');
      const persisted = getDCAOrder(id);
      if (!persisted) return `DCA order ${id} not found.`;
      const platformLabel = persisted.extraConfig?.platform
        ? PLATFORM_LABELS[persisted.extraConfig.platform] ?? persisted.extraConfig.platform
        : persisted.platform;
      return [
        `DCA Order: ${persisted.id}`,
        `Platform: ${platformLabel}`,
        `Market: ${persisted.marketId}`,
        `Status: ${persisted.status.toUpperCase()}`,
        `Progress: $${persisted.investedAmount.toFixed(2)} / $${persisted.totalAmount.toFixed(2)}`,
        `Cycles: ${persisted.cyclesCompleted}`,
        persisted.extraConfig ? `Config: ${JSON.stringify(persisted.extraConfig)}` : '',
      ].filter(Boolean).join('\n');
    }
    const p = order.getProgress();
    return `DCA Order: ${order.id}\n` + formatProgress(p);
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

async function handlePause(id: string): Promise<string> {
  if (!id) return 'Usage: /dca pause <order-id>';
  try {
    const { getActiveDCAOrder } = await import('../../../execution/dca.js');
    const order = getActiveDCAOrder(id);
    if (!order) return `DCA order ${id} not found or not active.`;
    order.pause();
    return `Paused DCA order ${id.slice(0, 8)}...`;
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

async function handleResume(id: string): Promise<string> {
  if (!id) return 'Usage: /dca resume <order-id>';
  try {
    const { getActiveDCAOrder } = await import('../../../execution/dca.js');
    const order = getActiveDCAOrder(id);
    if (!order) return `DCA order ${id} not found or not active.`;
    order.resume();
    return `Resumed DCA order ${id.slice(0, 8)}...`;
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

async function handleCancel(id: string): Promise<string> {
  if (!id) return 'Usage: /dca cancel <order-id>';
  try {
    const { getActiveDCAOrder } = await import('../../../execution/dca.js');
    const order = getActiveDCAOrder(id);
    if (!order) return `DCA order ${id} not found or not active.`;
    await order.cancel();
    const p = order.getProgress();
    return `Cancelled DCA order ${id.slice(0, 8)}...\nInvested: $${p.investedAmount.toFixed(2)} / $${p.totalAmount.toFixed(2)} (${p.cyclesCompleted} cycles)`;
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

async function handleSol(args: string): Promise<string> {
  // /dca sol <total> <from-mint> to <to-mint> --per <amt> --every <secs>
  const parts = args.split(/\s+/);
  if (parts.length < 6) return 'Usage: /dca sol <total> <from-mint> to <to-mint> --per <amt> --every <secs>';

  const total = parseFloat(parts[0]);
  const fromMint = parts[1];
  const toIdx = parts.indexOf('to');
  if (toIdx === -1) return 'Missing "to" keyword. Usage: /dca sol <total> <from> to <to> --per <amt> --every <secs>';
  const toMint = parts[toIdx + 1];

  const perCycle = parseFloat(parseFlag(parts, '--per') ?? '');
  const everySecs = parseInt(parseFlag(parts, '--every') ?? '', 10);

  if (isNaN(total) || isNaN(perCycle) || isNaN(everySecs)) return 'Invalid numbers.';

  try {
    const { createJupiterDCA } = await import('../../../solana/jupiter.js');
    const wallet = await import('../../../solana/wallet.js');
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    const result = await createJupiterDCA(connection, keypair, {
      inputMint: fromMint,
      outputMint: toMint,
      inAmount: String(Math.floor(total * 1e6)),
      inAmountPerCycle: String(Math.floor(perCycle * 1e6)),
      cycleSecondsApart: everySecs,
    });

    return [
      'Jupiter DCA Created',
      `Signature: ${result.signature}`,
      `DCA Account: ${result.dcaPubKey}`,
      `Total: ${total} over ${Math.ceil(total / perCycle)} cycles`,
      `Per Cycle: ${perCycle} every ${everySecs}s`,
    ].join('\n');
  } catch (err: any) {
    return `Jupiter DCA failed: ${err.message}`;
  }
}

// =============================================================================
// EXPORT
// =============================================================================

export default {
  name: 'dca',
  description: 'Dollar-cost averaging across all platforms',
  commands: [
    { name: 'dca', description: 'DCA order management', usage: '/dca <platform|list|info|pause|resume|cancel|help>' },
  ],
  async handle(args: string): Promise<string> {
    const trimmed = args.trim();
    if (!trimmed || trimmed === 'help') return HELP;

    const spaceIdx = trimmed.indexOf(' ');
    const subcommand = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const subArgs = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

    switch (subcommand) {
      // Platform subcommands
      case 'poly': return handlePoly(subArgs);
      case 'kalshi': return handleKalshi(subArgs);
      case 'pump': return handlePump(subArgs);
      case 'hl': return handleHL(subArgs);
      case 'bf': return handleBF(subArgs);
      case 'bb': return handleBB(subArgs);
      case 'mexc': return handleMexc(subArgs);
      case 'drift': return handleDrift(subArgs);
      case 'opinion': return handleOpinion(subArgs);
      case 'predict': return handlePredict(subArgs);
      case 'orca': return handleOrca(subArgs);
      case 'raydium': return handleRaydium(subArgs);
      case 'virtuals': return handleVirtuals(subArgs);
      case 'base': return handleBase(subArgs);
      case 'evm': return handleEvm(subArgs);
      case 'sol': return handleSol(subArgs);
      // Legacy
      case 'create': return handleCreate(subArgs);
      // Management
      case 'list': return handleList();
      case 'info': return handleInfo(subArgs);
      case 'pause': return handlePause(subArgs);
      case 'resume': return handleResume(subArgs);
      case 'cancel': return handleCancel(subArgs);
      default: return `Unknown subcommand: ${subcommand}. Run /dca help.`;
    }
  },
};
