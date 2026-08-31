import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { readFileSync } from 'fs';

export interface SolanaWalletConfig {
  rpcUrl?: string;
  privateKey?: string;
  keypairPath?: string;
}

export function loadSolanaKeypair(config: SolanaWalletConfig = {}): Keypair {
  const secret = config.privateKey || process.env.SOLANA_PRIVATE_KEY;
  const keypairPath = config.keypairPath || process.env.SOLANA_KEYPAIR_PATH;

  if (secret) {
    const secretBytes = decodeSecretKey(secret);
    return Keypair.fromSecretKey(secretBytes);
  }

  if (keypairPath) {
    const raw = readFileSync(keypairPath, 'utf-8').trim();
    const secretBytes = decodeSecretKey(raw);
    return Keypair.fromSecretKey(secretBytes);
  }

  throw new Error('Missing Solana wallet credentials. Set SOLANA_PRIVATE_KEY or SOLANA_KEYPAIR_PATH.');
}

export function getSolanaConnection(config: SolanaWalletConfig = {}): Connection {
  const rpcUrl = config.rpcUrl || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  return new Connection(rpcUrl, 'confirmed');
}

/**
 * confirmTransaction only THROWS on expiry/timeout/nonce-invalidation — a
 * transaction that lands on-chain but whose program instruction reverts
 * resolves normally, with the failure reported solely via result.value.err.
 * Every caller of these two functions used to ignore that field entirely,
 * meaning a reverted trade (wrong slippage, insufficient funds, whatever)
 * was reported back as a successful signature. Real-money callers need to
 * know the difference between "landed and succeeded" and "landed and
 * reverted" — throw here so they can't silently miss it.
 */
function assertConfirmedOk(
  signature: string,
  result: Awaited<ReturnType<Connection['confirmTransaction']>>
): void {
  if (result.value.err) {
    throw new Error(`Transaction ${signature} landed but reverted on-chain: ${JSON.stringify(result.value.err)}`);
  }
}

export async function signAndSendVersionedTransaction(
  connection: Connection,
  keypair: Keypair,
  txBytes: Uint8Array
): Promise<string> {
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([keypair]);
  const raw = tx.serialize();
  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  // Confirm transaction to detect on-chain failures
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  assertConfirmedOk(signature, result);

  return signature;
}

export async function signAndSendTransaction(
  connection: Connection,
  keypair: Keypair,
  transaction: Transaction | VersionedTransaction,
  /**
   * The lastValidBlockHeight that actually corresponds to the blockhash
   * already baked into transaction's message — pass this when the caller
   * fetched that blockhash itself before building the message (every
   * pump.fun call site does, since blockhash-fetch is parallelized with
   * instruction-building). Without it, this falls back to fetching a NEW
   * blockhash's height purely to have *a* number to confirm against — which
   * doesn't correspond to the height this specific already-signed
   * transaction actually expires at, and can make confirmTransaction poll
   * longer than necessary before detecting a genuine expiry. Fail-safe
   * either way (never reports false success/failure), just a latency
   * difference in the already-rare true-expiry case.
   */
  lastValidBlockHeight?: number
): Promise<string> {
  if (transaction instanceof VersionedTransaction) {
    transaction.sign([keypair]);
    const raw = transaction.serialize();
    const signature = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // Confirm to detect on-chain failures
    const blockhash = transaction.message.recentBlockhash;
    const height = lastValidBlockHeight ?? (await connection.getLatestBlockhash('confirmed')).lastValidBlockHeight;
    const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight: height }, 'confirmed');
    assertConfirmedOk(signature, result);

    return signature;
  }

  // Legacy Transaction always gets a freshly-fetched blockhash right here
  // (unlike VersionedTransaction above, it isn't pre-built by the caller
  // with its own blockhash already baked in), so this height genuinely
  // does correspond to what's being signed — no staleness concern, and the
  // lastValidBlockHeight parameter isn't relevant to this branch.
  transaction.feePayer = keypair.publicKey;
  const { blockhash, lastValidBlockHeight: legacyLastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.sign(keypair);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  // Confirm to detect on-chain failures
  const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight: legacyLastValidBlockHeight }, 'confirmed');
  assertConfirmedOk(signature, result);

  return signature;
}

export function decodeSecretKey(value: string): Uint8Array {
  const trimmed = value.trim();

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid Solana secret key JSON.');
    }
    return Uint8Array.from(parsed);
  }

  try {
    return bs58.decode(trimmed);
  } catch {
    // continue to base64
  }

  try {
    const buffer = Buffer.from(trimmed, 'base64');
    if (buffer.length === 0) throw new Error('Empty base64 secret key.');
    return new Uint8Array(buffer);
  } catch {
    throw new Error('Invalid Solana secret key format. Provide base58 or JSON array.');
  }
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
