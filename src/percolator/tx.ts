/**
 * Percolator transaction builder + sender.
 * Adapted from percolator-cli/src/runtime/tx.ts — simplified for Clodds.
 */

import {
  Connection,
  PublicKey,
  TransactionInstruction,
  Transaction,
  Keypair,
  SendOptions,
  Commitment,
  AccountMeta,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { logger } from '../utils/logger.js';

export interface BuildIxParams {
  programId: PublicKey;
  keys: AccountMeta[];
  data: Buffer;
}

export function buildIx(params: BuildIxParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: params.keys,
    data: params.data,
  });
}

export interface TxResult {
  signature: string;
  slot: number;
  err: string | null;
  logs: string[];
  unitsConsumed?: number;
}

export interface SimulateOrSendParams {
  connection: Connection;
  ix: TransactionInstruction;
  signers: Keypair[];
  simulate: boolean;
  commitment?: Commitment;
  computeUnitLimit?: number;
}

export async function simulateOrSend(
  params: SimulateOrSendParams,
): Promise<TxResult> {
  const { connection, ix, signers, simulate, commitment = 'confirmed', computeUnitLimit } = params;

  const tx = new Transaction();

  if (computeUnitLimit !== undefined) {
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
    );
  }

  tx.add(ix);
  const latestBlockhash = await connection.getLatestBlockhash(commitment);
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = signers[0].publicKey;

  if (simulate) {
    tx.sign(...signers);
    const result = await connection.simulateTransaction(tx, signers);
    const logs = result.value.logs ?? [];
    let err: string | null = null;
    if (result.value.err) {
      err = JSON.stringify(result.value.err);
    }
    return {
      signature: '(simulated)',
      slot: result.context.slot,
      err,
      logs,
      unitsConsumed: result.value.unitsConsumed ?? undefined,
    };
  }

  const options: SendOptions = {
    skipPreflight: false,
    preflightCommitment: commitment,
  };

  try {
    const signature = await connection.sendTransaction(tx, signers, options);
    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      commitment,
    );

    const txInfo = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    const logs = txInfo?.meta?.logMessages ?? [];
    let err: string | null = null;
    if (confirmation.value.err) {
      err = JSON.stringify(confirmation.value.err);
    }

    return {
      signature,
      slot: txInfo?.slot ?? 0,
      err,
      logs,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error({ err: message }, 'Percolator tx failed');
    return { signature: '', slot: 0, err: message, logs: [] };
  }
}
