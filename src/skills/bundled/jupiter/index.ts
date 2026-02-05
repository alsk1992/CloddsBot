/**
 * Jupiter CLI Skill - Complete API Coverage (22 Commands)
 *
 * Swaps:
 * /jup swap <amount> <from> to <to>     - Execute swap
 * /jup quote <amount> <from> to <to>    - Get quote
 * /jup route <from> <to> [amount]       - Show route details
 *
 * Limit Orders:
 * /jup limit <amount> <from> to <to> @ <price> [--expiry <hours>]
 * /jup orders                           - List open orders
 * /jup order <pubkey>                   - Get order details
 * /jup cancel <pubkey>                  - Cancel order
 * /jup cancel-all                       - Cancel all orders
 * /jup cancel-expired <pubkey>          - Cancel expired order
 * /jup orders-by-mint --input <mint>    - Filter orders by mint
 * /jup fees                             - Show fee structure
 *
 * DCA (Dollar Cost Averaging):
 * /jup dca <total> <from> to <to> --per <amount> --every <seconds>
 * /jup dcas                             - List active DCAs
 * /jup dca-info <pubkey>                - DCA details
 * /jup dca-close <pubkey>               - Close DCA
 * /jup dca-deposit <pubkey> <amount>    - Deposit more
 * /jup dca-withdraw <pubkey>            - Withdraw remaining
 * /jup dca-fills <pubkey>               - DCA fill history
 * /jup dca-history                      - List closed DCAs
 * /jup dca-tokens                       - Available DCA tokens
 *
 * History:
 * /jup history                          - Trade history
 * /jup order-history                    - Limit order history
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

function formatAmount(amount: string, decimals: number): string {
  const num = parseFloat(amount) / Math.pow(10, decimals);
  if (num < 0.000001) return num.toExponential(2);
  if (num < 1) return num.toFixed(6);
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

// ============================================================================
// Swap Handlers
// ============================================================================

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

    return `**Jupiter Swap Complete**

${fromToken} -> ${toToken}
In: ${result.inAmount}
Out: ${result.outAmount}
Price Impact: ${result.priceImpactPct || 'N/A'}%
Route: ${result.routePlan?.map((r: { swapInfo?: { label?: string } }) => r.swapInfo?.label).join(' -> ') || 'Direct'}
TX: \`${result.signature}\``;
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
    const { jupiter, tokenlist } = await getSolanaModules();

    const [fromMint, toMint] = await tokenlist.resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens.`;
    }

    const tokens = await tokenlist.getTokenList();
    const fromDecimals = tokens.find(t => t.address === fromMint)?.decimals ?? 9;
    const toDecimals = tokens.find(t => t.address === toMint)?.decimals ?? 9;
    const amountBaseUnits = Math.floor(parseFloat(amount) * Math.pow(10, fromDecimals)).toString();

    const quote = await jupiter.getJupiterQuote({
      inputMint: fromMint,
      outputMint: toMint,
      amount: amountBaseUnits,
      slippageBps: 50,
    });

    const outHuman = formatAmount(quote.outAmount || '0', toDecimals);
    const minOutHuman = formatAmount(quote.otherAmountThreshold || '0', toDecimals);

    return `**Jupiter Quote**

${amount} ${fromToken} -> ${toToken}
Output: ${outHuman} ${toToken}
Min Output (slippage): ${minOutHuman} ${toToken}
Price Impact: ${quote.priceImpactPct || 'N/A'}%
Route: ${quote.routePlan?.length || 1} hops`;
  } catch (error) {
    return `Quote failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleRoute(from: string, to: string, amount: string): Promise<string> {
  if (!from || !to) {
    return 'Usage: /jup route <from> <to> [amount]';
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

// ============================================================================
// Limit Order Handlers
// ============================================================================

async function handleLimitOrder(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  // Parse: /jup limit <amount> <from> to <to> @ <price> [--expiry <hours>]
  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  const atIndex = args.findIndex(a => a === '@');

  if (toIndex < 2 || atIndex < toIndex || atIndex >= args.length - 1) {
    return `Usage: /jup limit <amount> <from> to <to> @ <price> [--expiry <hours>]

Example:
  /jup limit 1 SOL to USDC @ 250
  /jup limit 100 USDC to JUP @ 0.8 --expiry 168`;
  }

  const amount = args[0];
  const fromToken = args.slice(1, toIndex).join(' ');
  const toToken = args.slice(toIndex + 1, atIndex).join(' ');
  const priceStr = args[atIndex + 1];

  // Parse expiry
  let expiryHours = 168; // Default 1 week
  const expiryIndex = args.findIndex(a => a === '--expiry');
  if (expiryIndex >= 0 && args[expiryIndex + 1]) {
    expiryHours = parseInt(args[expiryIndex + 1]);
  }

  const price = parseFloat(priceStr);
  if (isNaN(price)) {
    return 'Price must be a number.';
  }

  try {
    const { wallet, jupiter, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [fromMint, toMint] = await tokenlist.resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens.`;
    }

    const tokens = await tokenlist.getTokenList();
    const fromDecimals = tokens.find(t => t.address === fromMint)?.decimals ?? 9;
    const toDecimals = tokens.find(t => t.address === toMint)?.decimals ?? 6;

    const inAmount = Math.floor(parseFloat(amount) * Math.pow(10, fromDecimals)).toString();
    const outAmount = Math.floor(parseFloat(amount) * price * Math.pow(10, toDecimals)).toString();
    const expiredAtMs = Date.now() + expiryHours * 60 * 60 * 1000;

    const result = await jupiter.createJupiterLimitOrder(connection, keypair, {
      inputMint: fromMint,
      outputMint: toMint,
      inAmount,
      outAmount,
      expiredAtMs,
    });

    return `**Limit Order Created**

Sell: ${amount} ${fromToken}
Buy: ${(parseFloat(amount) * price).toFixed(4)} ${toToken}
Price: ${price} ${toToken}/${fromToken}
Expiry: ${expiryHours} hours
Order: \`${result.orderPubKey}\`
TX: \`${result.signature}\``;
  } catch (error) {
    return `Limit order failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleListOrders(): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const orders = await jupiter.listJupiterLimitOrders(connection, keypair.publicKey.toBase58());

    if (!orders || orders.length === 0) {
      return '**Jupiter Limit Orders**\n\nNo open orders.';
    }

    let output = `**Jupiter Limit Orders** (${orders.length})\n\n`;
    for (const order of orders.slice(0, 10)) {
      output += `Order: \`${order.publicKey?.slice(0, 12) || 'N/A'}...\`\n`;
      output += `  Input: ${order.inputMint?.slice(0, 8)}... -> ${order.outputMint?.slice(0, 8)}...\n`;
      output += `  In: ${order.makingAmount} | Out: ${order.takingAmount}\n`;
      if (order.expiredAt) {
        const expiry = new Date(order.expiredAt * 1000).toLocaleString();
        output += `  Expires: ${expiry}\n`;
      }
      output += '\n';
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleGetOrder(pubkey: string): Promise<string> {
  if (!pubkey) {
    return 'Usage: /jup order <pubkey>';
  }

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const order = await jupiter.getJupiterLimitOrder(connection, pubkey);

    if (!order) {
      return `Order not found: \`${pubkey}\``;
    }

    return `**Jupiter Limit Order**

Order: \`${pubkey}\`
Input Mint: \`${order.inputMint}\`
Output Mint: \`${order.outputMint}\`
Making Amount: ${order.makingAmount}
Taking Amount: ${order.takingAmount}
Original Making: ${order.oriMakingAmount}
Original Taking: ${order.oriTakingAmount}
${order.expiredAt ? `Expires: ${new Date(order.expiredAt * 1000).toLocaleString()}` : 'No expiry'}
Waiting: ${order.waiting ? 'Yes' : 'No'}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCancelOrder(pubkey: string): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (!pubkey) {
    return 'Usage: /jup cancel <pubkey>';
  }

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const signature = await jupiter.cancelJupiterLimitOrder(connection, keypair, pubkey);

    return `**Order Cancelled**

Order: \`${pubkey}\`
TX: \`${signature}\``;
  } catch (error) {
    return `Cancel failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCancelAllOrders(): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    // First get all orders
    const orders = await jupiter.listJupiterLimitOrders(connection, keypair.publicKey.toBase58());

    if (!orders || orders.length === 0) {
      return 'No open orders to cancel.';
    }

    const orderPubkeys = orders.map(o => o.publicKey).filter((p): p is string => !!p);
    const signature = await jupiter.batchCancelJupiterLimitOrders(connection, keypair, orderPubkeys);

    return `**All Orders Cancelled**

Cancelled: ${orderPubkeys.length} orders
TX: \`${signature}\``;
  } catch (error) {
    return `Cancel all failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// DCA Handlers
// ============================================================================

async function handleCreateDCA(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  // Parse: /jup dca <total> <from> to <to> --per <amount> --every <seconds>
  const toIndex = args.findIndex(a => a.toLowerCase() === 'to');
  const perIndex = args.findIndex(a => a === '--per');
  const everyIndex = args.findIndex(a => a === '--every');

  if (toIndex < 2 || perIndex < 0 || everyIndex < 0) {
    return `Usage: /jup dca <total> <from> to <to> --per <amount> --every <seconds>

Example:
  /jup dca 100 USDC to JUP --per 10 --every 3600
  (Swap 10 USDC to JUP every hour, 100 total)`;
  }

  const total = args[0];
  const fromToken = args.slice(1, toIndex).join(' ');
  const toToken = args.slice(toIndex + 1, perIndex).join(' ');
  const perAmount = args[perIndex + 1];
  const everySeconds = parseInt(args[everyIndex + 1]);

  if (isNaN(everySeconds) || everySeconds < 30) {
    return 'Interval must be at least 30 seconds.';
  }

  try {
    const { wallet, jupiter, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const [fromMint, toMint] = await tokenlist.resolveTokenMints([fromToken, toToken]);
    if (!fromMint || !toMint) {
      return `Could not resolve tokens.`;
    }

    const tokens = await tokenlist.getTokenList();
    const fromDecimals = tokens.find(t => t.address === fromMint)?.decimals ?? 6;

    const inAmount = Math.floor(parseFloat(total) * Math.pow(10, fromDecimals)).toString();
    const inAmountPerCycle = Math.floor(parseFloat(perAmount) * Math.pow(10, fromDecimals)).toString();

    const result = await jupiter.createJupiterDCA(connection, keypair, {
      inputMint: fromMint,
      outputMint: toMint,
      inAmount,
      inAmountPerCycle,
      cycleSecondsApart: everySeconds,
    });

    const numCycles = Math.ceil(parseFloat(total) / parseFloat(perAmount));

    return `**DCA Created**

From: ${total} ${fromToken}
To: ${toToken}
Per Cycle: ${perAmount} ${fromToken}
Interval: ${everySeconds}s (${(everySeconds / 60).toFixed(1)} min)
Cycles: ~${numCycles}
DCA: \`${result.dcaPubKey}\`
TX: \`${result.signature}\``;
  } catch (error) {
    return `DCA creation failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleListDCAs(): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const dcas = await jupiter.listJupiterDCAs(connection, keypair.publicKey.toBase58());

    if (!dcas || dcas.length === 0) {
      return '**Jupiter DCAs**\n\nNo active DCAs.';
    }

    let output = `**Jupiter DCAs** (${dcas.length})\n\n`;
    for (const dca of dcas.slice(0, 10)) {
      output += `DCA: \`${dca.publicKey?.slice(0, 12) || 'N/A'}...\`\n`;
      output += `  ${dca.inputMint?.slice(0, 8)}... -> ${dca.outputMint?.slice(0, 8)}...\n`;
      if (dca.inDeposited && dca.inUsed) {
        const remaining = BigInt(dca.inDeposited) - BigInt(dca.inUsed);
        output += `  Remaining: ${remaining.toString()}\n`;
      }
      output += '\n';
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleDCAInfo(pubkey: string): Promise<string> {
  if (!pubkey) {
    return 'Usage: /jup dca-info <pubkey>';
  }

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const dca = await jupiter.getJupiterDCA(connection, pubkey);

    if (!dca) {
      return `DCA not found: \`${pubkey}\``;
    }

    const balance = await jupiter.getJupiterDCABalance(connection, pubkey);

    return `**Jupiter DCA**

DCA: \`${pubkey}\`
Input: \`${dca.inputMint}\`
Output: \`${dca.outputMint}\`
Deposited: ${dca.inDeposited}
Used: ${dca.inUsed}
Received: ${dca.outReceived}
Per Cycle: ${dca.inAmountPerCycle}
Interval: ${dca.cycleFrequency}s
Next Cycle: ${new Date(dca.nextCycleAt * 1000).toLocaleString()}
${balance ? `Input Balance: ${balance.inputBalance}\nOutput Balance: ${balance.outputBalance}` : ''}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCloseDCA(pubkey: string): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (!pubkey) {
    return 'Usage: /jup dca-close <pubkey>';
  }

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const signature = await jupiter.closeJupiterDCA(connection, keypair, pubkey);

    return `**DCA Closed**

DCA: \`${pubkey}\`
TX: \`${signature}\`

Remaining funds returned to your wallet.`;
  } catch (error) {
    return `Close DCA failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleDepositDCA(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return 'Usage: /jup dca-deposit <pubkey> <amount>';
  }

  const [pubkey, amountStr] = args;

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    // Get DCA to determine input mint decimals
    const dca = await jupiter.getJupiterDCA(connection, pubkey);
    if (!dca) {
      return `DCA not found: \`${pubkey}\``;
    }

    const signature = await jupiter.depositJupiterDCA(connection, keypair, pubkey, amountStr);

    return `**DCA Deposit**

DCA: \`${pubkey}\`
Deposited: ${amountStr}
TX: \`${signature}\``;
  } catch (error) {
    return `Deposit failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleWithdrawDCA(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (!args[0]) {
    return 'Usage: /jup dca-withdraw <pubkey> [--in <amount>] [--out <amount>]';
  }

  const pubkey = args[0];
  const inIndex = args.findIndex(a => a === '--in');
  const outIndex = args.findIndex(a => a === '--out');

  const withdrawInAmount = inIndex >= 0 ? args[inIndex + 1] : undefined;
  const withdrawOutAmount = outIndex >= 0 ? args[outIndex + 1] : undefined;

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const signature = await jupiter.withdrawJupiterDCA(connection, keypair, pubkey, {
      withdrawInAmount,
      withdrawOutAmount,
    });

    return `**DCA Withdraw**

DCA: \`${pubkey}\`
${withdrawInAmount ? `Withdrawn In: ${withdrawInAmount}` : ''}
${withdrawOutAmount ? `Withdrawn Out: ${withdrawOutAmount}` : ''}
TX: \`${signature}\``;
  } catch (error) {
    return `Withdraw failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// History Handlers
// ============================================================================

async function handleTradeHistory(): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const history = await jupiter.getJupiterTradeHistory(connection, keypair.publicKey.toBase58()) as Array<{
      id?: string;
      orderKey?: string;
      inputMint?: string;
      outputMint?: string;
      inAmount?: string;
      outAmount?: string;
      createdAt?: string;
    }>;

    if (!history || history.length === 0) {
      return '**Jupiter Trade History**\n\nNo trades found.';
    }

    let output = `**Jupiter Trade History** (${history.length})\n\n`;
    for (const trade of history.slice(0, 10)) {
      output += `Trade: \`${trade.id?.slice(0, 12) || trade.orderKey?.slice(0, 12) || 'N/A'}...\`\n`;
      output += `  ${trade.inputMint?.slice(0, 8)}... -> ${trade.outputMint?.slice(0, 8)}...\n`;
      if (trade.inAmount && trade.outAmount) {
        output += `  ${trade.inAmount} -> ${trade.outAmount}\n`;
      }
      if (trade.createdAt) {
        output += `  ${new Date(trade.createdAt).toLocaleString()}\n`;
      }
      output += '\n';
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleOrderHistory(): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const history = await jupiter.getJupiterLimitOrderHistory(connection, keypair.publicKey.toBase58()) as Array<{
      publicKey?: string;
      orderKey?: string;
      status?: string;
      inputMint?: string;
      outputMint?: string;
      makingAmount?: string;
      takingAmount?: string;
    }>;

    if (!history || history.length === 0) {
      return '**Jupiter Order History**\n\nNo order history found.';
    }

    let output = `**Jupiter Order History** (${history.length})\n\n`;
    for (const order of history.slice(0, 10)) {
      const status = order.status || 'unknown';
      output += `[${status.toUpperCase()}] \`${order.publicKey?.slice(0, 12) || order.orderKey?.slice(0, 12) || 'N/A'}...\`\n`;
      output += `  ${order.inputMint?.slice(0, 8)}... -> ${order.outputMint?.slice(0, 8)}...\n`;
      if (order.makingAmount && order.takingAmount) {
        output += `  Making: ${order.makingAmount} | Taking: ${order.takingAmount}\n`;
      }
      output += '\n';
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Additional Commands
// ============================================================================

async function handleDCAFills(pubkey: string): Promise<string> {
  if (!pubkey) {
    return 'Usage: /jup dca-fills <pubkey>';
  }

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const fills = await jupiter.getJupiterDCAFillHistory(connection, pubkey);

    if (!fills || fills.length === 0) {
      return `**DCA Fill History**\n\nNo fills found for \`${pubkey}\``;
    }

    let output = `**DCA Fill History** (${fills.length})\n\n`;
    for (const fill of fills.slice(0, 15)) {
      output += `TX: \`${fill.txId?.slice(0, 12)}...\`\n`;
      output += `  In: ${fill.inAmount} | Out: ${fill.outAmount}\n`;
      output += `  Fee: ${fill.fee} (${fill.feeMint?.slice(0, 8)}...)\n`;
      output += `  ${fill.confirmedAt ? new Date(fill.confirmedAt).toLocaleString() : ''}\n\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleClosedDCAs(): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const closed = await jupiter.listClosedJupiterDCAs(connection, keypair.publicKey.toBase58());

    if (!closed || closed.length === 0) {
      return '**Closed DCAs**\n\nNo closed DCAs found.';
    }

    let output = `**Closed DCAs** (${closed.length})\n\n`;
    for (const dca of closed.slice(0, 10)) {
      output += `DCA: \`${dca.publicKey?.slice(0, 12)}...\`\n`;
      output += `  ${dca.inputMint?.slice(0, 8)}... -> ${dca.outputMint?.slice(0, 8)}...\n`;
      output += `  Filled: ${dca.inFilled} | Received: ${dca.outReceived}\n`;
      output += `  User Closed: ${dca.userClosed ? 'Yes' : 'No'}\n\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleDCATokens(): Promise<string> {
  try {
    const { wallet, jupiter } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const tokens = await jupiter.getJupiterDCAAvailableTokens(connection);

    if (!tokens || tokens.length === 0) {
      return '**DCA Available Tokens**\n\nNo tokens found.';
    }

    let output = `**DCA Available Tokens** (${tokens.length})\n\n`;
    output += tokens.slice(0, 30).map(t => `\`${t.slice(0, 16)}...\``).join('\n');
    if (tokens.length > 30) {
      output += `\n\n... and ${tokens.length - 30} more`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleFees(): Promise<string> {
  try {
    const { wallet, jupiter } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const fees = await jupiter.getJupiterLimitOrderFee(connection);

    return `**Jupiter Limit Order Fees**

Maker Fee: ${fees.makerFee}
Maker Stable Fee: ${fees.makerStableFee}
Taker Fee: ${fees.takerFee}
Taker Stable Fee: ${fees.takerStableFee}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCancelExpired(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Jupiter not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (!args[0]) {
    return 'Usage: /jup cancel-expired <pubkey> or /jup cancel-expired --all <pubkey1> <pubkey2> ...';
  }

  try {
    const { wallet, jupiter } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    if (args[0] === '--all' && args.length > 1) {
      const pubkeys = args.slice(1);
      const signature = await jupiter.batchCancelExpiredJupiterLimitOrders(connection, keypair, pubkeys);
      return `**Batch Cancel Expired**\n\nCancelled: ${pubkeys.length} orders\nTX: \`${signature}\``;
    }

    const signature = await jupiter.cancelExpiredJupiterLimitOrder(connection, keypair, args[0]);
    if (!signature) {
      return `Order is not expired or not found: \`${args[0]}\``;
    }

    return `**Expired Order Cancelled**\n\nOrder: \`${args[0]}\`\nTX: \`${signature}\``;
  } catch (error) {
    return `Cancel expired failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleOrdersByMint(args: string[]): Promise<string> {
  const inputIndex = args.findIndex(a => a === '--input');
  const outputIndex = args.findIndex(a => a === '--output');

  if (inputIndex < 0 && outputIndex < 0) {
    return 'Usage: /jup orders-by-mint --input <mint> [--output <mint>]';
  }

  try {
    const { wallet, jupiter, tokenlist } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const inputToken = inputIndex >= 0 ? args[inputIndex + 1] : undefined;
    const outputToken = outputIndex >= 0 ? args[outputIndex + 1] : undefined;

    const [inputMint, outputMint] = await tokenlist.resolveTokenMints(
      [inputToken, outputToken].filter(Boolean) as string[]
    );

    const orders = await jupiter.listJupiterLimitOrdersByMint(connection, {
      owner: keypair.publicKey.toBase58(),
      inputMint: inputToken ? inputMint : undefined,
      outputMint: outputToken ? outputMint : undefined,
    });

    if (!orders || orders.length === 0) {
      return '**Orders by Mint**\n\nNo orders found matching filters.';
    }

    let output = `**Orders by Mint** (${orders.length})\n\n`;
    for (const order of orders.slice(0, 10)) {
      output += `Order: \`${order.publicKey?.slice(0, 12)}...\`\n`;
      output += `  Making: ${order.makingAmount} | Taking: ${order.takingAmount}\n\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
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
    case 'route':
      return handleRoute(rest[0], rest[1], rest[2]);

    // Limit Orders
    case 'limit':
      return handleLimitOrder(rest);
    case 'orders':
      return handleListOrders();
    case 'order':
      return handleGetOrder(rest[0]);
    case 'cancel':
      return handleCancelOrder(rest[0]);
    case 'cancel-all':
      return handleCancelAllOrders();

    // DCA
    case 'dca':
      return handleCreateDCA(rest);
    case 'dcas':
      return handleListDCAs();
    case 'dca-info':
      return handleDCAInfo(rest[0]);
    case 'dca-close':
      return handleCloseDCA(rest[0]);
    case 'dca-deposit':
      return handleDepositDCA(rest);
    case 'dca-withdraw':
      return handleWithdrawDCA(rest);
    case 'dca-fills':
      return handleDCAFills(rest[0]);
    case 'dca-history':
      return handleClosedDCAs();
    case 'dca-tokens':
      return handleDCATokens();

    // History
    case 'history':
      return handleTradeHistory();
    case 'order-history':
      return handleOrderHistory();

    // Additional
    case 'fees':
      return handleFees();
    case 'cancel-expired':
      return handleCancelExpired(rest);
    case 'orders-by-mint':
      return handleOrdersByMint(rest);

    case 'help':
    default:
      return `**Jupiter Aggregator** (22 Commands)

**Swaps:**
  /jup swap <amount> <from> to <to>      Execute swap
  /jup quote <amount> <from> to <to>     Get quote
  /jup route <from> <to> [amount]        Show route

**Limit Orders:**
  /jup limit <amt> <from> to <to> @ <price> [--expiry <hrs>]
  /jup orders                            List open orders
  /jup order <pubkey>                    Order details
  /jup cancel <pubkey>                   Cancel order
  /jup cancel-all                        Cancel all orders
  /jup cancel-expired <pubkey>           Cancel expired order
  /jup orders-by-mint --input <m> [--output <m>]  Filter by mint
  /jup fees                              Show fee structure

**DCA (Dollar Cost Averaging):**
  /jup dca <total> <from> to <to> --per <amt> --every <secs>
  /jup dcas                              List active DCAs
  /jup dca-info <pubkey>                 DCA details
  /jup dca-close <pubkey>                Close DCA
  /jup dca-deposit <pubkey> <amount>     Deposit more
  /jup dca-withdraw <pubkey> [--in/--out <amt>]  Withdraw
  /jup dca-fills <pubkey>                DCA fill history
  /jup dca-history                       Closed DCAs
  /jup dca-tokens                        Available DCA tokens

**History:**
  /jup history                           Trade history
  /jup order-history                     Limit order history

**Examples:**
  /jup swap 1 SOL to USDC
  /jup limit 1 SOL to USDC @ 250 --expiry 168
  /jup dca 100 USDC to JUP --per 10 --every 3600`;
  }
}

export default {
  name: 'jupiter',
  description: 'Jupiter aggregator - swaps, limit orders, DCA on Solana',
  commands: ['/jupiter', '/jup'],
  handle: execute,
};
