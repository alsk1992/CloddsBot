import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { signAndSendVersionedTransaction, signAndSendTransaction } from './wallet';

// ============================================================================
// Types
// ============================================================================

export interface JupiterSwapParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  swapMode?: 'ExactIn' | 'ExactOut';
  priorityFeeLamports?: number;
  onlyDirectRoutes?: boolean;
}

export interface JupiterQuoteResult {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo?: {
      ammKey?: string;
      label?: string;
      inputMint?: string;
      outputMint?: string;
      inAmount?: string;
      outAmount?: string;
      feeAmount?: string;
      feeMint?: string;
    };
    percent?: number;
  }>;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
}

export interface JupiterSwapResult {
  signature: string;
  quote: JupiterQuoteResult;
  endpoint: string;
  inAmount?: string;
  outAmount?: string;
  priceImpactPct?: string;
  routePlan?: Array<{ swapInfo?: { label?: string; inputMint?: string; outputMint?: string } }>;
}

export interface JupiterLimitOrderParams {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  expiredAtMs?: number;
}

export interface JupiterLimitOrderResult {
  signature: string;
  orderPubKey: string;
}

export interface JupiterLimitOrder {
  publicKey: string;
  maker: string;
  inputMint: string;
  outputMint: string;
  makingAmount: string;
  takingAmount: string;
  oriMakingAmount: string;
  oriTakingAmount: string;
  expiredAt: number | null;
  waiting: boolean;
}

export interface JupiterDCAParams {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  inAmountPerCycle: string;
  cycleSecondsApart: number;
  minOutAmountPerCycle?: string;
  maxOutAmountPerCycle?: string;
  startAtMs?: number;
}

export interface JupiterDCAResult {
  signature: string;
  dcaPubKey: string;
}

export interface JupiterDCAAccount {
  publicKey: string;
  user: string;
  inputMint: string;
  outputMint: string;
  inDeposited: string;
  inWithdrawn: string;
  outWithdrawn: string;
  inUsed: string;
  outReceived: string;
  inAmountPerCycle: string;
  cycleFrequency: number;
  nextCycleAt: number;
  createdAt: number;
}

export interface JupiterDCABalance {
  inputBalance: string;
  outputBalance: string;
  inDeposited: string;
  inWithdrawn: string;
  outWithdrawn: string;
  inUsed: string;
  outReceived: string;
}

export interface JupiterDCAFill {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  fee: string;
  feeMint: string;
  txId: string;
  confirmedAt: Date;
}

export interface JupiterClosedDCA {
  publicKey: string;
  user: string;
  inputMint: string;
  outputMint: string;
  inDeposited: string;
  inAmountPerCycle: string;
  cycleFrequency: number;
  inFilled: string;
  outReceived: string;
  inWithdrawn: string;
  outWithdrawn: string;
  unfilledAmount: string;
  closeTxHash: string;
  openTxHash: string;
  userClosed: boolean;
  createdAt: number;
  updatedAt: number;
  fills: JupiterDCAFill[];
}

export interface JupiterLimitOrderFee {
  makerFee: string;
  makerStableFee: string;
  takerFee: string;
  takerStableFee: string;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_JUPITER_BASE = 'https://lite-api.jup.ag/swap/v1';

function getJupiterBaseUrl(): string {
  return process.env.JUPITER_SWAP_BASE_URL || DEFAULT_JUPITER_BASE;
}

function getJupiterHeaders(): Record<string, string> {
  const apiKey = process.env.JUPITER_API_KEY;
  return apiKey ? { 'x-api-key': apiKey } : {};
}

// ============================================================================
// Quote & Swap
// ============================================================================

/**
 * Get a Jupiter quote without executing a swap.
 * Useful for price discovery and displaying trade previews.
 */
export async function getJupiterQuote(params: JupiterSwapParams): Promise<JupiterQuoteResult> {
  const baseUrl = getJupiterBaseUrl();
  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    slippageBps: (params.slippageBps ?? 50).toString(),
    swapMode: params.swapMode ?? 'ExactIn',
  });

  if (params.onlyDirectRoutes) {
    query.set('onlyDirectRoutes', 'true');
  }

  const response = await fetch(`${baseUrl}/quote?${query}`, {
    headers: getJupiterHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Jupiter quote error: ${response.status}`);
  }

  return response.json();
}

/**
 * Execute a Jupiter swap.
 */
export async function executeJupiterSwap(
  connection: Connection,
  keypair: Keypair,
  params: JupiterSwapParams
): Promise<JupiterSwapResult> {
  const baseUrl = getJupiterBaseUrl();
  const quote = await getJupiterQuote(params);

  const swapResponse = await fetch(`${baseUrl}/swap`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...getJupiterHeaders(),
    },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toBase58(),
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: params.priorityFeeLamports,
      wrapAndUnwrapSol: true,
    }),
  });

  if (!swapResponse.ok) {
    throw new Error(`Jupiter swap error: ${swapResponse.status}`);
  }

  const swapJson = (await swapResponse.json()) as { swapTransaction?: string };
  if (!swapJson.swapTransaction) {
    throw new Error('Jupiter swap response missing swapTransaction');
  }

  const txBytes = Buffer.from(swapJson.swapTransaction, 'base64');
  const signature = await signAndSendVersionedTransaction(connection, keypair, new Uint8Array(txBytes));

  return { signature, quote, endpoint: baseUrl };
}

// ============================================================================
// Limit Orders
// ============================================================================

async function getLimitOrderProvider(connection: Connection) {
  const { LimitOrderProvider } = await import('@jup-ag/limit-order-sdk');
  return new LimitOrderProvider(connection);
}

/**
 * Create a Jupiter limit order.
 * The order will be filled when the market price reaches the specified rate.
 */
export async function createJupiterLimitOrder(
  connection: Connection,
  keypair: Keypair,
  params: JupiterLimitOrderParams
): Promise<JupiterLimitOrderResult> {
  const provider = await getLimitOrderProvider(connection);
  const base = Keypair.generate();

  const { tx, orderPubKey } = await provider.createOrder({
    owner: keypair.publicKey,
    inputMint: new PublicKey(params.inputMint),
    outputMint: new PublicKey(params.outputMint),
    inAmount: new BN(params.inAmount),
    outAmount: new BN(params.outAmount),
    base: base.publicKey,
    expiredAt: params.expiredAtMs ? new BN(Math.floor(params.expiredAtMs / 1000)) : null,
  });

  tx.sign(base);
  const signature = await signAndSendTransaction(connection, keypair, tx);

  return {
    signature,
    orderPubKey: orderPubKey.toBase58(),
  };
}

/**
 * Cancel a single Jupiter limit order.
 */
export async function cancelJupiterLimitOrder(
  connection: Connection,
  keypair: Keypair,
  orderPubKey: string
): Promise<string> {
  const provider = await getLimitOrderProvider(connection);

  const tx = await provider.cancelOrder({
    owner: keypair.publicKey,
    orderPubKey: new PublicKey(orderPubKey),
  });

  return signAndSendTransaction(connection, keypair, tx);
}

/**
 * Cancel multiple Jupiter limit orders in a single transaction.
 */
export async function batchCancelJupiterLimitOrders(
  connection: Connection,
  keypair: Keypair,
  orderPubKeys: string[]
): Promise<string> {
  const provider = await getLimitOrderProvider(connection);

  const tx = await provider.batchCancelOrder({
    owner: keypair.publicKey,
    ordersPubKey: orderPubKeys.map((pk) => new PublicKey(pk)),
  });

  return signAndSendTransaction(connection, keypair, tx);
}

/**
 * List all open Jupiter limit orders for a wallet.
 */
export async function listJupiterLimitOrders(
  connection: Connection,
  owner: string
): Promise<JupiterLimitOrder[]> {
  const provider = await getLimitOrderProvider(connection);
  const { ownerFilter } = await import('@jup-ag/limit-order-sdk');

  const orders = await provider.getOrders([ownerFilter(new PublicKey(owner))]);

  return orders.map((order) => ({
    publicKey: order.publicKey.toBase58(),
    maker: order.account.maker.toBase58(),
    inputMint: order.account.inputMint.toBase58(),
    outputMint: order.account.outputMint.toBase58(),
    makingAmount: order.account.makingAmount.toString(),
    takingAmount: order.account.takingAmount.toString(),
    oriMakingAmount: order.account.oriMakingAmount.toString(),
    oriTakingAmount: order.account.oriTakingAmount.toString(),
    expiredAt: order.account.expiredAt ? order.account.expiredAt.toNumber() : null,
    waiting: order.account.waiting,
  }));
}

/**
 * Get a single Jupiter limit order by its public key.
 */
export async function getJupiterLimitOrder(
  connection: Connection,
  orderPubKey: string
): Promise<JupiterLimitOrder | null> {
  const provider = await getLimitOrderProvider(connection);

  try {
    const order = await provider.getOrder(new PublicKey(orderPubKey));
    return {
      publicKey: orderPubKey,
      maker: order.maker.toBase58(),
      inputMint: order.inputMint.toBase58(),
      outputMint: order.outputMint.toBase58(),
      makingAmount: order.makingAmount.toString(),
      takingAmount: order.takingAmount.toString(),
      oriMakingAmount: order.oriMakingAmount.toString(),
      oriTakingAmount: order.oriTakingAmount.toString(),
      expiredAt: order.expiredAt ? order.expiredAt.toNumber() : null,
      waiting: order.waiting,
    };
  } catch {
    return null;
  }
}

/**
 * Get order history for a wallet (includes filled and cancelled orders).
 */
export async function getJupiterLimitOrderHistory(
  connection: Connection,
  wallet: string,
  options?: { lastCursor?: number; take?: number }
): Promise<unknown[]> {
  const provider = await getLimitOrderProvider(connection);

  return provider.getOrderHistory({
    wallet,
    lastCursor: options?.lastCursor,
    take: options?.take ?? 50,
  });
}

// ============================================================================
// DCA (Dollar Cost Averaging)
// ============================================================================

async function getDCAProvider(connection: Connection) {
  const { DCA } = await import('@jup-ag/dca-sdk');
  return new DCA(connection, 'mainnet-beta');
}

/**
 * Create a Jupiter DCA (Dollar Cost Averaging) order.
 * Automatically executes swaps at regular intervals.
 */
export async function createJupiterDCA(
  connection: Connection,
  keypair: Keypair,
  params: JupiterDCAParams
): Promise<JupiterDCAResult> {
  const dca = await getDCAProvider(connection);

  const { tx, dcaPubKey } = await dca.createDCA({
    user: keypair.publicKey,
    inputMint: new PublicKey(params.inputMint),
    outputMint: new PublicKey(params.outputMint),
    inAmount: new BN(params.inAmount),
    inAmountPerCycle: new BN(params.inAmountPerCycle),
    cycleSecondsApart: new BN(params.cycleSecondsApart),
    minOutAmountPerCycle: params.minOutAmountPerCycle ? new BN(params.minOutAmountPerCycle) : null,
    maxOutAmountPerCycle: params.maxOutAmountPerCycle ? new BN(params.maxOutAmountPerCycle) : null,
    startAt: params.startAtMs ? new BN(Math.floor(params.startAtMs / 1000)) : null,
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);

  return {
    signature,
    dcaPubKey: dcaPubKey.toBase58(),
  };
}

/**
 * Close a Jupiter DCA order and withdraw remaining funds.
 */
export async function closeJupiterDCA(
  connection: Connection,
  keypair: Keypair,
  dcaPubKey: string
): Promise<string> {
  const dca = await getDCAProvider(connection);

  const { tx } = await dca.closeDCA({
    user: keypair.publicKey,
    dca: new PublicKey(dcaPubKey),
  });

  return signAndSendTransaction(connection, keypair, tx);
}

/**
 * Deposit additional funds into an existing DCA order.
 */
export async function depositJupiterDCA(
  connection: Connection,
  keypair: Keypair,
  dcaPubKey: string,
  amount: string
): Promise<string> {
  const dca = await getDCAProvider(connection);

  const { tx } = await dca.deposit({
    user: keypair.publicKey,
    dca: new PublicKey(dcaPubKey),
    amount: new BN(amount),
  });

  return signAndSendTransaction(connection, keypair, tx);
}

/**
 * Withdraw funds from a DCA order (input or output tokens).
 */
export async function withdrawJupiterDCA(
  connection: Connection,
  keypair: Keypair,
  dcaPubKey: string,
  options: {
    inputMint?: string;
    outputMint?: string;
    withdrawInAmount?: string;
    withdrawOutAmount?: string;
  }
): Promise<string> {
  const dca = await getDCAProvider(connection);

  const { tx } = await dca.withdraw({
    user: keypair.publicKey,
    dca: new PublicKey(dcaPubKey),
    inputMint: options.inputMint ? new PublicKey(options.inputMint) : undefined,
    outputMint: options.outputMint ? new PublicKey(options.outputMint) : undefined,
    withdrawInAmount: options.withdrawInAmount ? new BN(options.withdrawInAmount) : undefined,
    withdrawOutAmount: options.withdrawOutAmount ? new BN(options.withdrawOutAmount) : undefined,
  });

  return signAndSendTransaction(connection, keypair, tx);
}

/**
 * List all active DCA orders for a user.
 */
export async function listJupiterDCAs(
  connection: Connection,
  user: string,
  options?: { inputMint?: string; outputMint?: string }
): Promise<JupiterDCAAccount[]> {
  const dca = await getDCAProvider(connection);

  const accounts = await dca.getCurrentByUser(
    new PublicKey(user),
    options?.inputMint ? new PublicKey(options.inputMint) : undefined,
    options?.outputMint ? new PublicKey(options.outputMint) : undefined
  );

  return accounts.map((acc) => ({
    publicKey: acc.publicKey.toBase58(),
    user: acc.account.user.toBase58(),
    inputMint: acc.account.inputMint.toBase58(),
    outputMint: acc.account.outputMint.toBase58(),
    inDeposited: acc.account.inDeposited.toString(),
    inWithdrawn: acc.account.inWithdrawn.toString(),
    outWithdrawn: acc.account.outWithdrawn.toString(),
    inUsed: acc.account.inUsed.toString(),
    outReceived: acc.account.outReceived.toString(),
    inAmountPerCycle: acc.account.inAmountPerCycle.toString(),
    cycleFrequency: acc.account.cycleFrequency.toNumber(),
    nextCycleAt: acc.account.nextCycleAt.toNumber(),
    createdAt: acc.account.createdAt.toNumber(),
  }));
}

/**
 * Get a single DCA account by its public key.
 */
export async function getJupiterDCA(
  connection: Connection,
  dcaPubKey: string
): Promise<JupiterDCAAccount | null> {
  const dca = await getDCAProvider(connection);

  try {
    const acc = await dca.fetchDCA(new PublicKey(dcaPubKey));
    return {
      publicKey: dcaPubKey,
      user: acc.user.toBase58(),
      inputMint: acc.inputMint.toBase58(),
      outputMint: acc.outputMint.toBase58(),
      inDeposited: acc.inDeposited.toString(),
      inWithdrawn: acc.inWithdrawn.toString(),
      outWithdrawn: acc.outWithdrawn.toString(),
      inUsed: acc.inUsed.toString(),
      outReceived: acc.outReceived.toString(),
      inAmountPerCycle: acc.inAmountPerCycle.toString(),
      cycleFrequency: acc.cycleFrequency.toNumber(),
      nextCycleAt: acc.nextCycleAt.toNumber(),
      createdAt: acc.createdAt.toNumber(),
    };
  } catch {
    return null;
  }
}

/**
 * Get the current balances for a DCA account.
 */
export async function getJupiterDCABalance(
  connection: Connection,
  dcaPubKey: string
): Promise<JupiterDCABalance> {
  const dca = await getDCAProvider(connection);

  const balances = await dca.getBalancesByAccount(new PublicKey(dcaPubKey));

  return {
    inputBalance: balances.in.dcaBalance.toString(),
    outputBalance: balances.out.dcaBalance.toString(),
    inDeposited: balances.stats.inDeposited.toString(),
    inWithdrawn: balances.stats.inWithdrawn.toString(),
    outWithdrawn: balances.stats.outWithdrawn.toString(),
    inUsed: balances.stats.inUsed.toString(),
    outReceived: balances.stats.outReceived.toString(),
  };
}

/**
 * Get the fill history for a DCA account.
 */
export async function getJupiterDCAFillHistory(
  connection: Connection,
  dcaPubKey: string
): Promise<JupiterDCAFill[]> {
  const dca = await getDCAProvider(connection);

  const fills = await dca.getFillHistory(dcaPubKey);

  return fills.map((fill) => ({
    inputMint: fill.inputMint.toBase58(),
    outputMint: fill.outputMint.toBase58(),
    inAmount: fill.inAmount,
    outAmount: fill.outAmount,
    fee: fill.fee,
    feeMint: fill.feeMint.toBase58(),
    txId: fill.txId,
    confirmedAt: fill.confirmedAt,
  }));
}

/**
 * Get closed/completed DCA orders for a user.
 */
export async function listClosedJupiterDCAs(
  connection: Connection,
  user: string,
  options?: {
    before?: Date;
    limit?: number;
    inputMint?: string;
    outputMint?: string;
  }
): Promise<JupiterClosedDCA[]> {
  const dca = await getDCAProvider(connection);

  const closed = await dca.getClosedByUser(
    new PublicKey(user),
    options?.before,
    options?.limit ?? 50,
    options?.inputMint ? new PublicKey(options.inputMint) : undefined,
    options?.outputMint ? new PublicKey(options.outputMint) : undefined
  );

  return closed.map((item) => ({
    publicKey: item.publicKey.toBase58(),
    user: item.account.user.toBase58(),
    inputMint: item.account.inputMint.toBase58(),
    outputMint: item.account.outputMint.toBase58(),
    inDeposited: item.account.inDeposited.toString(),
    inAmountPerCycle: item.account.inAmountPerCycle.toString(),
    cycleFrequency: item.account.cycleFrequency.toNumber(),
    inFilled: item.account.inFilled.toString(),
    outReceived: item.account.outReceived.toString(),
    inWithdrawn: item.account.inWithdrawn.toString(),
    outWithdrawn: item.account.outWithdrawn.toString(),
    unfilledAmount: item.account.unfilledAmount.toString(),
    closeTxHash: item.account.closeTxHash,
    openTxHash: item.account.openTxHash,
    userClosed: item.account.userClosed,
    createdAt: item.account.createdAt.toNumber(),
    updatedAt: item.account.updatedAt.toNumber(),
    fills: item.fills.map((f) => ({
      inputMint: f.inputMint.toBase58(),
      outputMint: f.outputMint.toBase58(),
      inAmount: f.inAmount,
      outAmount: f.outAmount,
      fee: f.fee,
      feeMint: f.feeMint.toBase58(),
      txId: f.txId,
      confirmedAt: f.confirmedAt,
    })),
  }));
}

/**
 * Get available tokens for DCA.
 */
export async function getJupiterDCAAvailableTokens(connection: Connection): Promise<string[]> {
  const dca = await getDCAProvider(connection);
  const tokens = await dca.getAvailableTokens();
  return tokens.map((t) => t.toBase58());
}

// ============================================================================
// Additional Limit Order Methods
// ============================================================================

/**
 * Get Jupiter limit order fee structure.
 */
export async function getJupiterLimitOrderFee(connection: Connection): Promise<JupiterLimitOrderFee> {
  const provider = await getLimitOrderProvider(connection);
  const fee = await provider.getFee();

  return {
    makerFee: fee.makerFee.toString(),
    makerStableFee: fee.makerStableFee.toString(),
    takerFee: fee.takerFee.toString(),
    takerStableFee: fee.takerStableFee.toString(),
  };
}

/**
 * Get trade history for a wallet (actual fills, not just orders).
 */
export async function getJupiterTradeHistory(
  connection: Connection,
  wallet: string,
  options?: { lastCursor?: number; take?: number }
): Promise<unknown[]> {
  const provider = await getLimitOrderProvider(connection);

  return provider.getTradeHistory({
    wallet,
    lastCursor: options?.lastCursor,
    take: options?.take ?? 50,
  });
}

/**
 * List limit orders filtered by input or output mint.
 */
export async function listJupiterLimitOrdersByMint(
  connection: Connection,
  options: {
    inputMint?: string;
    outputMint?: string;
    owner?: string;
  }
): Promise<JupiterLimitOrder[]> {
  const provider = await getLimitOrderProvider(connection);
  const { ownerFilter, inputMintFilter, outputMintFilter } = await import('@jup-ag/limit-order-sdk');

  const filters = [];
  if (options.owner) {
    filters.push(ownerFilter(new PublicKey(options.owner)));
  }
  if (options.inputMint) {
    filters.push(inputMintFilter(new PublicKey(options.inputMint)));
  }
  if (options.outputMint) {
    filters.push(outputMintFilter(new PublicKey(options.outputMint)));
  }

  const orders = await provider.getOrders(filters.length > 0 ? filters : undefined);

  return orders.map((order) => ({
    publicKey: order.publicKey.toBase58(),
    maker: order.account.maker.toBase58(),
    inputMint: order.account.inputMint.toBase58(),
    outputMint: order.account.outputMint.toBase58(),
    makingAmount: order.account.makingAmount.toString(),
    takingAmount: order.account.takingAmount.toString(),
    oriMakingAmount: order.account.oriMakingAmount.toString(),
    oriTakingAmount: order.account.oriTakingAmount.toString(),
    expiredAt: order.account.expiredAt ? order.account.expiredAt.toNumber() : null,
    waiting: order.account.waiting,
  }));
}

/**
 * Cancel an expired limit order (can be called by anyone, not just owner).
 */
export async function cancelExpiredJupiterLimitOrder(
  connection: Connection,
  keypair: Keypair,
  orderPubKey: string
): Promise<string | null> {
  const provider = await getLimitOrderProvider(connection);

  const tx = await provider.cancelExpiredOrder({
    orderPubKey: new PublicKey(orderPubKey),
  });

  if (!tx) return null;
  return signAndSendTransaction(connection, keypair, tx);
}

/**
 * Batch cancel multiple expired limit orders.
 */
export async function batchCancelExpiredJupiterLimitOrders(
  connection: Connection,
  keypair: Keypair,
  orderPubKeys: string[]
): Promise<string> {
  const provider = await getLimitOrderProvider(connection);

  const tx = await provider.batchCancelExpiredOrder({
    ordersPubKey: orderPubKeys.map((pk) => new PublicKey(pk)),
  });

  return signAndSendTransaction(connection, keypair, tx);
}

// ============================================================================
// Swap Instructions (Advanced)
// ============================================================================

export interface JupiterSwapInstructions {
  computeBudgetInstructions: unknown[];
  setupInstructions: unknown[];
  swapInstruction: unknown;
  cleanupInstruction?: unknown;
  addressLookupTableAddresses: string[];
  otherInstructions: unknown[];
}

/**
 * Get swap instructions instead of a full transaction.
 * Useful for composing with other instructions.
 */
export async function getJupiterSwapInstructions(
  params: JupiterSwapParams & { userPublicKey: string }
): Promise<JupiterSwapInstructions> {
  const baseUrl = getJupiterBaseUrl();
  const quote = await getJupiterQuote(params);

  const response = await fetch(`${baseUrl}/swap-instructions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...getJupiterHeaders(),
    },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: params.userPublicKey,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: params.priorityFeeLamports,
      wrapAndUnwrapSol: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Jupiter swap-instructions error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get Jupiter DEX labels by program ID.
 * Useful for identifying which DEX a swap went through.
 */
export async function getJupiterProgramIdToLabel(): Promise<Record<string, string>> {
  const baseUrl = getJupiterBaseUrl();

  const response = await fetch(`${baseUrl}/program-id-to-label`, {
    headers: getJupiterHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Jupiter program-id-to-label error: ${response.status}`);
  }

  return response.json();
}
