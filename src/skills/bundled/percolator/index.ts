/**
 * /percolator skill — on-chain Solana perpetual futures via Percolator protocol.
 *
 * Subcommands:
 *   /percolator status     — market state (price, OI, funding, spread)
 *   /percolator positions   — your open positions
 *   /percolator long <size> — open long position (size in USD)
 *   /percolator short <size> — open short position (size in USD)
 *   /percolator deposit <amount> — deposit USDC collateral
 *   /percolator withdraw <amount> — withdraw USDC collateral
 *   /percolator help        — show this help
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const sub = (parts[0] || 'help').toLowerCase();

  switch (sub) {
    case 'status':
    case 'market':
    case 'state':
      return await statusCommand();

    case 'positions':
    case 'pos':
      return await positionsCommand();

    case 'long':
    case 'buy':
      return await tradeCommand('long', parts[1]);

    case 'short':
    case 'sell':
      return await tradeCommand('short', parts[1]);

    case 'deposit':
      return await depositCommand(parts[1]);

    case 'withdraw':
      return await withdrawCommand(parts[1]);

    case 'help':
    default:
      return helpText();
  }
}

function helpText(): string {
  return [
    '**Percolator — On-chain Solana Perpetual Futures**',
    '',
    '`/percolator status` — market state (oracle price, OI, funding rate, spread)',
    '`/percolator positions` — your open positions',
    '`/percolator long <size>` — open long (size in USD)',
    '`/percolator short <size>` — open short (size in USD)',
    '`/percolator deposit <amount>` — deposit USDC collateral',
    '`/percolator withdraw <amount>` — withdraw USDC collateral',
    '',
    'Configure via env: `PERCOLATOR_ENABLED=true PERCOLATOR_SLAB=<pubkey> PERCOLATOR_ORACLE=<pubkey>`',
    'Full docs: https://github.com/aeyakovenko/percolator-cli',
  ].join('\n');
}

async function loadFeed() {
  try {
    const { createPercolatorFeed } = await import('../../../percolator/feed.js');
    const config = getConfigFromEnv();
    if (!config.slabAddress) throw new Error('PERCOLATOR_SLAB not set');
    const feed = createPercolatorFeed(config);
    await feed.connect();
    return feed;
  } catch (err) {
    throw new Error(`Percolator not configured: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function loadExecution() {
  try {
    const { createPercolatorExecution } = await import('../../../percolator/execution.js');
    const config = getConfigFromEnv();
    if (!config.slabAddress) throw new Error('PERCOLATOR_SLAB not set');
    return createPercolatorExecution(config);
  } catch (err) {
    throw new Error(`Percolator execution not configured: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function getConfigFromEnv() {
  const slabAddress = process.env.PERCOLATOR_SLAB;
  if (!slabAddress) {
    throw new Error('PERCOLATOR_SLAB env var is required');
  }
  return {
    enabled: true,
    rpcUrl: process.env.PERCOLATOR_RPC_URL || process.env.SOLANA_RPC_URL,
    programId: process.env.PERCOLATOR_PROGRAM_ID || '2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp',
    slabAddress,
    matcherProgram: process.env.PERCOLATOR_MATCHER_PROGRAM,
    matcherContext: process.env.PERCOLATOR_MATCHER_CONTEXT,
    oracleAddress: process.env.PERCOLATOR_ORACLE,
    lpIndex: process.env.PERCOLATOR_LP_INDEX ? parseInt(process.env.PERCOLATOR_LP_INDEX, 10) : 0,
    spreadBps: process.env.PERCOLATOR_SPREAD_BPS ? parseInt(process.env.PERCOLATOR_SPREAD_BPS, 10) : 50,
    dryRun: process.env.PERCOLATOR_DRY_RUN !== 'false',
    pollIntervalMs: 2000,
  };
}

async function statusCommand(): Promise<string> {
  const feed = await loadFeed();
  try {
    const state = feed.getMarketState();
    if (!state) return 'No market data yet — try again in a few seconds.';

    const price = state.oraclePriceUsd.toFixed(2);
    const oi = (Number(state.totalOpenInterest) / 1_000_000).toFixed(2);
    const vault = (Number(state.vault) / 1_000_000).toFixed(2);
    const insurance = (Number(state.insuranceFund) / 1_000_000).toFixed(2);
    const funding = Number(state.fundingRate);
    const fundingStr = funding === 0 ? '0' : `${funding > 0 ? '+' : ''}${funding} bps/slot`;
    const spread = state.spreadBps.toFixed(1);
    const bid = state.bestBid ? `$${state.bestBid.priceUsd.toFixed(2)}` : 'n/a';
    const ask = state.bestAsk ? `$${state.bestAsk.priceUsd.toFixed(2)}` : 'n/a';

    return [
      '**Percolator Market State**',
      '',
      `Oracle Price: **$${price}**`,
      `Best Bid/Ask: ${bid} / ${ask} (${spread} bps spread)`,
      `Open Interest: $${oi}`,
      `Vault: $${vault}`,
      `Insurance Fund: $${insurance}`,
      `Funding Rate: ${fundingStr}`,
      `Last Crank: slot ${state.lastCrankSlot.toString()}`,
    ].join('\n');
  } finally {
    feed.disconnect();
  }
}

async function positionsCommand(): Promise<string> {
  const exec = await loadExecution();
  const positions = await exec.getPositions();

  if (positions.length === 0) {
    return 'No open positions on Percolator.';
  }

  const lines = ['**Your Percolator Positions**', ''];
  for (const pos of positions) {
    const side = pos.positionSize > 0n ? 'LONG' : 'SHORT';
    const size = (Number(pos.positionSize < 0n ? -pos.positionSize : pos.positionSize) / 1_000_000).toFixed(2);
    const entry = (Number(pos.entryPrice) / 1_000_000).toFixed(2);
    const capital = (Number(pos.capital) / 1_000_000).toFixed(2);
    const pnl = (Number(pos.pnl) / 1_000_000).toFixed(2);
    const pnlSign = pos.pnl >= 0n ? '+' : '';

    lines.push(`**${side}** $${size} @ $${entry} | Capital: $${capital} | PnL: ${pnlSign}$${pnl}`);
  }

  return lines.join('\n');
}

async function tradeCommand(direction: 'long' | 'short', sizeStr?: string): Promise<string> {
  if (!sizeStr || isNaN(Number(sizeStr))) {
    return `Usage: \`/percolator ${direction} <size_usd>\`\nExample: \`/percolator ${direction} 100\``;
  }

  const size = Number(sizeStr);
  if (size <= 0) return 'Size must be positive.';

  const exec = await loadExecution();
  const dryRun = process.env.PERCOLATOR_DRY_RUN !== 'false';

  const result = direction === 'long'
    ? await exec.marketBuy({ size })
    : await exec.marketSell({ size });

  if (!result.success) {
    return `Trade failed: ${result.error}`;
  }

  const mode = dryRun ? '(simulated)' : '';
  return `**${direction.toUpperCase()}** $${size} ${mode}\nSignature: \`${result.signature}\``;
}

async function depositCommand(amountStr?: string): Promise<string> {
  if (!amountStr || isNaN(Number(amountStr))) {
    return 'Usage: `/percolator deposit <amount_usd>`\nExample: `/percolator deposit 500`';
  }

  const amount = BigInt(Math.round(Number(amountStr) * 1_000_000));
  const exec = await loadExecution();
  const result = await exec.deposit(amount);

  if (!result.success) return `Deposit failed: ${result.error}`;
  return `Deposited $${amountStr} USDC\nSignature: \`${result.signature}\``;
}

async function withdrawCommand(amountStr?: string): Promise<string> {
  if (!amountStr || isNaN(Number(amountStr))) {
    return 'Usage: `/percolator withdraw <amount_usd>`\nExample: `/percolator withdraw 100`';
  }

  const amount = BigInt(Math.round(Number(amountStr) * 1_000_000));
  const exec = await loadExecution();
  const result = await exec.withdraw(amount);

  if (!result.success) return `Withdraw failed: ${result.error}`;
  return `Withdrew $${amountStr} USDC\nSignature: \`${result.signature}\``;
}

export default {
  name: 'percolator',
  description: 'Percolator — On-chain Solana perpetual futures (long/short with leverage)',
  commands: ['/percolator', '/perc'],
  handle: execute,
};
