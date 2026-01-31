import { Connection, Keypair } from '@solana/web3.js';
import { signAndSendVersionedTransaction } from './wallet';

export interface JupiterSwapParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  swapMode?: 'ExactIn' | 'ExactOut';
  priorityFeeLamports?: number;
  onlyDirectRoutes?: boolean;
}

export interface JupiterSwapResult {
  signature: string;
  quote: unknown;
  endpoint: string;
  inAmount?: string;
  outAmount?: string;
  priceImpactPct?: string;
  routePlan?: Array<{ swapInfo?: { label?: string; inputMint?: string; outputMint?: string } }>;
}

const DEFAULT_JUPITER_BASE = 'https://lite-api.jup.ag/swap/v1';

function getJupiterBaseUrl(): string {
  return process.env.JUPITER_SWAP_BASE_URL || DEFAULT_JUPITER_BASE;
}

function getJupiterHeaders(): Record<string, string> {
  const apiKey = process.env.JUPITER_API_KEY;
  return apiKey ? { 'x-api-key': apiKey } : {};
}

export async function executeJupiterSwap(
  connection: Connection,
  keypair: Keypair,
  params: JupiterSwapParams
): Promise<JupiterSwapResult> {
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

  const quoteResponse = await fetch(`${baseUrl}/quote?${query}`, {
    headers: getJupiterHeaders(),
  });

  if (!quoteResponse.ok) {
    throw new Error(`Jupiter quote error: ${quoteResponse.status}`);
  }

  const quote = await quoteResponse.json();
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

  const swapJson = await swapResponse.json() as { swapTransaction?: string };
  if (!swapJson.swapTransaction) {
    throw new Error('Jupiter swap response missing swapTransaction');
  }

  const txBytes = Buffer.from(swapJson.swapTransaction, 'base64');
  const signature = await signAndSendVersionedTransaction(connection, keypair, new Uint8Array(txBytes));

  return { signature, quote, endpoint: baseUrl };
}
