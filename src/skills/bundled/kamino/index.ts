/**
 * Kamino Finance CLI Skill - Complete API Coverage (15 Commands)
 *
 * Lending:
 * /kamino deposit <amount> <token>          - Deposit collateral
 * /kamino withdraw <amount> <token>         - Withdraw collateral
 * /kamino borrow <amount> <token>           - Borrow assets
 * /kamino repay <amount> <token>            - Repay borrowed assets
 * /kamino obligation                        - View your positions
 * /kamino health                            - Check health factor
 * /kamino reserves                          - List available reserves
 * /kamino rates                             - View supply/borrow rates
 *
 * Liquidity Vaults:
 * /kamino strategies                        - List all strategies
 * /kamino strategy <address>                - Get strategy details
 * /kamino vault-deposit <strategy> <amtA> [amtB] - Deposit to vault
 * /kamino vault-withdraw <strategy> [shares]     - Withdraw from vault
 * /kamino shares                            - View your vault shares
 * /kamino share-price <strategy>            - Get strategy share price
 *
 * Info:
 * /kamino markets                           - List lending markets
 * /kamino help                              - Show this help
 */

import { formatHelp } from '../../help.js';
import { wrapSkillError } from '../../errors.js';

const getSolanaModules = async () => {
  const [wallet, kamino, tokenlist] = await Promise.all([
    import('../../../solana/wallet'),
    import('../../../solana/kamino'),
    import('../../../solana/tokenlist'),
  ]);
  return { wallet, kamino, tokenlist };
};

function isConfigured(): boolean {
  return !!(process.env.SOLANA_PRIVATE_KEY || process.env.SOLANA_KEYPAIR_PATH);
}

// ============================================
// LENDING HANDLERS
// ============================================

async function handleDeposit(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Kamino not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /kamino deposit <amount> <token>';
  }

  const amount = args[0];
  const token = args.slice(1).join(' ');

  try {
    const { wallet, kamino, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    // Resolve token to mint address
    const [mint] = await tokenlist.resolveTokenMints([token]);
    if (!mint) {
      return `Token not found: ${token}`;
    }

    const tokens = await tokenlist.getTokenList();
    const tokenInfo = tokens.find(t => t.address === mint);
    const decimals = tokenInfo?.decimals || 6;
    const amountLamports = (parseFloat(amount) * Math.pow(10, decimals)).toString();

    const result = await kamino.depositToKamino(connection, keypair, {
      reserveMint: mint,
      amount: amountLamports,
    });

    return `**Kamino Deposit**\n\n` +
      `Deposited: ${amount} ${result.symbol || token}\n` +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return wrapSkillError('Kamino', 'deposit', error);
  }
}

async function handleWithdraw(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Kamino not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /kamino withdraw <amount|all> <token>';
  }

  const amount = args[0];
  const token = args.slice(1).join(' ');
  const withdrawAll = amount.toLowerCase() === 'all';

  try {
    const { wallet, kamino, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [mint] = await tokenlist.resolveTokenMints([token]);
    if (!mint) {
      return `Token not found: ${token}`;
    }

    const tokens = await tokenlist.getTokenList();
    const tokenInfo = tokens.find(t => t.address === mint);
    const decimals = tokenInfo?.decimals || 6;
    const amountLamports = withdrawAll ? '0' : (parseFloat(amount) * Math.pow(10, decimals)).toString();

    const result = await kamino.withdrawFromKamino(connection, keypair, {
      reserveMint: mint,
      amount: amountLamports,
      withdrawAll,
    });

    return `**Kamino Withdraw**\n\n` +
      `Withdrew: ${withdrawAll ? 'ALL' : amount} ${result.symbol || token}\n` +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return wrapSkillError('Kamino', 'withdraw', error);
  }
}

async function handleBorrow(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Kamino not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /kamino borrow <amount> <token>';
  }

  const amount = args[0];
  const token = args.slice(1).join(' ');

  try {
    const { wallet, kamino, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [mint] = await tokenlist.resolveTokenMints([token]);
    if (!mint) {
      return `Token not found: ${token}`;
    }

    const tokens = await tokenlist.getTokenList();
    const tokenInfo = tokens.find(t => t.address === mint);
    const decimals = tokenInfo?.decimals || 6;
    const amountLamports = (parseFloat(amount) * Math.pow(10, decimals)).toString();

    const result = await kamino.borrowFromKamino(connection, keypair, {
      reserveMint: mint,
      amount: amountLamports,
    });

    return `**Kamino Borrow**\n\n` +
      `Borrowed: ${amount} ${result.symbol || token}\n` +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return wrapSkillError('Kamino', 'borrow', error);
  }
}

async function handleRepay(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Kamino not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /kamino repay <amount|all> <token>';
  }

  const amount = args[0];
  const token = args.slice(1).join(' ');
  const repayAll = amount.toLowerCase() === 'all';

  try {
    const { wallet, kamino, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [mint] = await tokenlist.resolveTokenMints([token]);
    if (!mint) {
      return `Token not found: ${token}`;
    }

    const tokens = await tokenlist.getTokenList();
    const tokenInfo = tokens.find(t => t.address === mint);
    const decimals = tokenInfo?.decimals || 6;
    const amountLamports = repayAll ? '0' : (parseFloat(amount) * Math.pow(10, decimals)).toString();

    const result = await kamino.repayToKamino(connection, keypair, {
      reserveMint: mint,
      amount: amountLamports,
      repayAll,
    });

    return `**Kamino Repay**\n\n` +
      `Repaid: ${repayAll ? 'ALL' : amount} ${result.symbol || token}\n` +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return wrapSkillError('Kamino', 'repay', error);
  }
}

async function handleObligation(): Promise<string> {
  if (!isConfigured()) {
    return 'Kamino not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, kamino } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const obligation = await kamino.getKaminoObligation(connection, keypair);

    if (!obligation) {
      return 'No active Kamino position found.';
    }

    let output = `**Kamino Position**\n\n`;
    output += `Address: \`${obligation.address}\`\n`;
    output += `Health Factor: **${obligation.healthFactor === Infinity ? '∞' : obligation.healthFactor.toFixed(2)}**\n`;
    output += `LTV: ${obligation.ltv.toFixed(1)}%\n\n`;

    if (obligation.deposits.length > 0) {
      output += `**Deposits** ($${parseFloat(obligation.totalDepositValue).toFixed(2)})\n`;
      for (const dep of obligation.deposits) {
        output += `  ${dep.symbol}: ${dep.amount} ($${parseFloat(dep.amountUsd).toFixed(2)})\n`;
      }
      output += '\n';
    }

    if (obligation.borrows.length > 0) {
      output += `**Borrows** ($${parseFloat(obligation.totalBorrowValue).toFixed(2)})\n`;
      for (const bor of obligation.borrows) {
        output += `  ${bor.symbol}: ${bor.amount} ($${parseFloat(bor.amountUsd).toFixed(2)})\n`;
      }
    }

    return output;
  } catch (error) {
    return wrapSkillError('Kamino', 'fetch obligation', error);
  }
}

async function handleHealth(): Promise<string> {
  if (!isConfigured()) {
    return 'Kamino not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, kamino } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const obligation = await kamino.getKaminoObligation(connection, keypair);

    if (!obligation) {
      return 'No active Kamino position found.';
    }

    const hf = obligation.healthFactor;
    let riskLevel = 'SAFE';
    if (hf < 1.1) riskLevel = 'CRITICAL';
    else if (hf < 1.25) riskLevel = 'HIGH';
    else if (hf < 1.5) riskLevel = 'MEDIUM';
    else if (hf < 2) riskLevel = 'LOW';

    return `**Kamino Health Check**\n\n` +
      `Health Factor: **${hf === Infinity ? '∞' : hf.toFixed(2)}**\n` +
      `Risk Level: **${riskLevel}**\n` +
      `LTV: ${obligation.ltv.toFixed(1)}%\n` +
      `Borrow Limit: $${parseFloat(obligation.borrowLimit).toFixed(2)}\n` +
      `Liquidation Threshold: $${parseFloat(obligation.liquidationThreshold).toFixed(2)}\n\n` +
      `Total Deposits: $${parseFloat(obligation.totalDepositValue).toFixed(2)}\n` +
      `Total Borrows: $${parseFloat(obligation.totalBorrowValue).toFixed(2)}`;
  } catch (error) {
    return wrapSkillError('Kamino', 'health check', error);
  }
}

async function handleReserves(): Promise<string> {
  try {
    const { wallet, kamino } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const reserves = await kamino.getKaminoReserves(connection);

    if (reserves.length === 0) {
      return 'No reserves found.';
    }

    let output = `**Kamino Reserves** (${reserves.length})\n\n`;

    for (const res of reserves.slice(0, 15)) {
      output += `**${res.symbol}**\n`;
      output += `  Supply APY: ${res.depositRate.toFixed(2)}% | Borrow APY: ${res.borrowRate.toFixed(2)}%\n`;
      output += `  Utilization: ${res.utilizationRate.toFixed(1)}% | LTV: ${res.ltv}%\n`;
    }

    if (reserves.length > 15) {
      output += `\n... and ${reserves.length - 15} more`;
    }

    return output;
  } catch (error) {
    return wrapSkillError('Kamino', 'fetch reserves', error);
  }
}

async function handleRates(): Promise<string> {
  try {
    const { wallet, kamino } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const reserves = await kamino.getKaminoReserves(connection);

    if (reserves.length === 0) {
      return 'No reserves found.';
    }

    let output = `**Kamino Interest Rates**\n\n`;
    output += `| Token | Supply APY | Borrow APY | Util |\n`;
    output += `|-------|------------|------------|------|\n`;

    for (const res of reserves.slice(0, 20)) {
      output += `| ${res.symbol.padEnd(5)} | ${res.depositRate.toFixed(2).padStart(9)}% | ${res.borrowRate.toFixed(2).padStart(9)}% | ${res.utilizationRate.toFixed(0).padStart(3)}% |\n`;
    }

    return output;
  } catch (error) {
    return wrapSkillError('Kamino', 'fetch rates', error);
  }
}

async function handleMarkets(): Promise<string> {
  try {
    const { wallet, kamino } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const markets = await kamino.getKaminoMarkets(connection);

    if (markets.length === 0) {
      return 'No markets found.';
    }

    let output = `**Kamino Lending Markets**\n\n`;

    for (const market of markets) {
      output += `**${market.name}**\n`;
      output += `Address: \`${market.address}\`\n`;
      output += `Reserves: ${market.reserves.length}\n\n`;
    }

    return output;
  } catch (error) {
    return wrapSkillError('Kamino', 'fetch markets', error);
  }
}

// ============================================
// VAULT HANDLERS
// ============================================

async function handleStrategies(): Promise<string> {
  try {
    const { wallet, kamino } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const strategies = await kamino.getKaminoStrategies(connection);

    if (strategies.length === 0) {
      return 'No strategies found.';
    }

    let output = `**Kamino Strategies** (${strategies.length})\n\n`;

    for (const strat of strategies.slice(0, 10)) {
      output += `**${strat.tokenASymbol}/${strat.tokenBSymbol}**\n`;
      output += `  Address: \`${strat.address.slice(0, 8)}...\`\n`;
      output += `  Protocol: ${strat.protocol} | Share Price: ${strat.sharePrice}\n`;
    }

    if (strategies.length > 10) {
      output += `\n... and ${strategies.length - 10} more`;
    }

    return output;
  } catch (error) {
    return wrapSkillError('Kamino', 'fetch strategies', error);
  }
}

async function handleStrategy(args: string[]): Promise<string> {
  if (args.length < 1) {
    return 'Usage: /kamino strategy <address>';
  }

  const strategyAddress = args[0];

  try {
    const { wallet, kamino } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const strategy = await kamino.getKaminoStrategy(connection, strategyAddress);

    if (!strategy) {
      return `Strategy not found: ${strategyAddress}`;
    }

    return `**Kamino Strategy**\n\n` +
      `Address: \`${strategy.address}\`\n` +
      `Pair: ${strategy.tokenASymbol}/${strategy.tokenBSymbol}\n` +
      `Protocol: ${strategy.protocol}\n` +
      `Share Price: ${strategy.sharePrice}\n` +
      `TVL: $${strategy.tvl}\n` +
      `Status: ${strategy.status}`;
  } catch (error) {
    return wrapSkillError('Kamino', 'fetch strategy', error);
  }
}

async function handleVaultDeposit(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Kamino not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /kamino vault-deposit <strategy> <amountA> [amountB]';
  }

  const strategyAddress = args[0];
  const amountA = args[1];
  const amountB = args[2];

  try {
    const { wallet, kamino } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await kamino.depositToKaminoVault(connection, keypair, {
      strategyAddress,
      tokenAAmount: amountA,
      tokenBAmount: amountB,
    });

    return `**Kamino Vault Deposit**\n\n` +
      `Strategy: \`${result.strategyAddress.slice(0, 8)}...\`\n` +
      `Amount A: ${result.tokenAAmount}\n` +
      (result.tokenBAmount ? `Amount B: ${result.tokenBAmount}\n` : '') +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return wrapSkillError('Kamino', 'vault deposit', error);
  }
}

async function handleVaultWithdraw(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Kamino not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 1) {
    return 'Usage: /kamino vault-withdraw <strategy> [shares|all]';
  }

  const strategyAddress = args[0];
  const sharesArg = args[1]?.toLowerCase();
  const withdrawAll = sharesArg === 'all' || !sharesArg;

  try {
    const { wallet, kamino } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await kamino.withdrawFromKaminoVault(connection, keypair, {
      strategyAddress,
      shares: withdrawAll ? undefined : sharesArg,
      withdrawAll,
    });

    return `**Kamino Vault Withdraw**\n\n` +
      `Strategy: \`${result.strategyAddress.slice(0, 8)}...\`\n` +
      `Shares: ${withdrawAll ? 'ALL' : result.shares}\n` +
      `TX: \`${result.signature}\``;
  } catch (error) {
    return wrapSkillError('Kamino', 'vault withdraw', error);
  }
}

async function handleShares(): Promise<string> {
  if (!isConfigured()) {
    return 'Kamino not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, kamino } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const shares = await kamino.getKaminoUserShares(connection, keypair);

    if (shares.length === 0) {
      return 'No vault shares found.';
    }

    let output = `**Your Kamino Vault Shares**\n\n`;

    for (const share of shares) {
      output += `Strategy: \`${share.strategyAddress.slice(0, 8)}...\`\n`;
      output += `  Shares: ${share.shares}\n`;
      output += `  Value: $${share.valueUsd}\n\n`;
    }

    return output;
  } catch (error) {
    return wrapSkillError('Kamino', 'fetch shares', error);
  }
}

async function handleSharePrice(args: string[]): Promise<string> {
  if (args.length < 1) {
    return 'Usage: /kamino share-price <strategy>';
  }

  const strategyAddress = args[0];

  try {
    const { wallet, kamino } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const price = await kamino.getKaminoSharePrice(connection, strategyAddress);

    return `**Kamino Share Price**\n\n` +
      `Strategy: \`${strategyAddress.slice(0, 8)}...\`\n` +
      `Share Price: ${price}`;
  } catch (error) {
    return wrapSkillError('Kamino', 'fetch share price', error);
  }
}

// ============================================
// MAIN HANDLER
// ============================================

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    // Lending
    case 'deposit':
      return handleDeposit(rest);
    case 'withdraw':
      return handleWithdraw(rest);
    case 'borrow':
      return handleBorrow(rest);
    case 'repay':
      return handleRepay(rest);
    case 'obligation':
    case 'position':
    case 'pos':
      return handleObligation();
    case 'health':
      return handleHealth();
    case 'reserves':
      return handleReserves();
    case 'rates':
      return handleRates();
    case 'markets':
      return handleMarkets();

    // Vaults
    case 'strategies':
    case 'vaults':
      return handleStrategies();
    case 'strategy':
    case 'vault':
      return handleStrategy(rest);
    case 'vault-deposit':
    case 'vd':
      return handleVaultDeposit(rest);
    case 'vault-withdraw':
    case 'vw':
      return handleVaultWithdraw(rest);
    case 'shares':
      return handleShares();
    case 'share-price':
      return handleSharePrice(rest);

    case 'help':
    default:
      return formatHelp({
        name: 'Kamino Finance',
        emoji: '🌀',
        description: 'Solana lending, borrowing, and liquidity vaults (15 commands)',
        sections: [
          {
            title: 'Lending',
            commands: [
              { cmd: '/kamino deposit <amount> <token>', description: 'Deposit collateral' },
              { cmd: '/kamino withdraw <amount|all> <token>', description: 'Withdraw collateral' },
              { cmd: '/kamino borrow <amount> <token>', description: 'Borrow assets' },
              { cmd: '/kamino repay <amount|all> <token>', description: 'Repay borrowed assets' },
              { cmd: '/kamino obligation', description: 'View your positions' },
              { cmd: '/kamino health', description: 'Check health factor & liquidation risk' },
              { cmd: '/kamino reserves', description: 'List available reserves with rates' },
              { cmd: '/kamino rates', description: 'View supply/borrow APYs' },
            ],
          },
          {
            title: 'Liquidity Vaults',
            commands: [
              { cmd: '/kamino strategies', description: 'List all vault strategies' },
              { cmd: '/kamino strategy <address>', description: 'Get strategy details' },
              { cmd: '/kamino vault-deposit <strat> <amtA> [amtB]', description: 'Deposit to vault' },
              { cmd: '/kamino vault-withdraw <strat> [shares|all]', description: 'Withdraw from vault' },
              { cmd: '/kamino shares', description: 'View your vault shares' },
              { cmd: '/kamino share-price <strategy>', description: 'Get strategy share price' },
            ],
          },
          {
            title: 'Info',
            commands: [
              { cmd: '/kamino markets', description: 'List lending markets' },
            ],
          },
        ],
        examples: [
          '/kamino deposit 100 USDC',
          '/kamino borrow 50 SOL',
          '/kamino health',
          '/kamino rates',
          '/kamino vault-deposit ABC123... 1000 500',
        ],
        envVars: [
          { name: 'SOLANA_PRIVATE_KEY', description: 'Solana wallet private key', required: true },
          { name: 'SOLANA_RPC_URL', description: 'Custom RPC endpoint', required: false },
        ],
        seeAlso: [
          { cmd: '/marginfi', description: 'MarginFi lending' },
          { cmd: '/solend', description: 'Solend lending' },
          { cmd: '/jup', description: 'Jupiter DEX aggregator' },
          { cmd: '/bags', description: 'Portfolio overview' },
        ],
      });
  }
}

export default {
  name: 'kamino',
  description: 'Kamino Finance - Lending and liquidity vaults on Solana',
  commands: ['/kamino'],
  handle: execute,
};
