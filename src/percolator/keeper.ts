/**
 * Percolator keeper — optional background crank runner.
 * Permissionless: callerIdx = 65535 means "no account, just crank".
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { logger } from '../utils/logger.js';
import { loadSolanaKeypair } from '../solana/wallet.js';
import type { PercolatorConfig } from './types.js';
import { ACCOUNTS_KEEPER_CRANK, buildAccountMetas, WELL_KNOWN } from './accounts.js';
import { encodeKeeperCrank } from './instructions.js';
import { buildIx, simulateOrSend } from './tx.js';

export interface PercolatorKeeper {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createPercolatorKeeper(config: PercolatorConfig): PercolatorKeeper {
  const rpcUrl = config.rpcUrl ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const programId = new PublicKey(config.programId ?? '2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp');
  const slabAddress = config.slabAddress ? new PublicKey(config.slabAddress) : null;
  const oracleAddress = config.oracleAddress ? new PublicKey(config.oracleAddress) : null;
  const intervalMs = config.keeperIntervalMs ?? 5000;
  const dryRun = config.dryRun ?? true;

  let timer: ReturnType<typeof setInterval> | null = null;
  let connection: Connection | null = null;
  let keypair: Keypair | null = null;

  async function crank(): Promise<void> {
    if (!slabAddress || !oracleAddress) return;
    try {
      if (!connection) connection = new Connection(rpcUrl, 'confirmed');
      if (!keypair) keypair = loadSolanaKeypair({ rpcUrl });

      const ixData = encodeKeeperCrank({ callerIdx: 65535, allowPanic: false });
      const keys = buildAccountMetas(ACCOUNTS_KEEPER_CRANK, [
        keypair.publicKey,
        slabAddress,
        WELL_KNOWN.clock,
        oracleAddress,
      ]);

      const ix = buildIx({ programId, keys, data: ixData });
      const result = await simulateOrSend({
        connection,
        ix,
        signers: [keypair],
        simulate: dryRun,
      });

      if (result.err) {
        logger.debug({ err: result.err }, 'Percolator crank: no-op or error');
      } else {
        logger.debug({ sig: result.signature, slot: result.slot }, 'Percolator crank sent');
      }
    } catch (err) {
      logger.warn({ err }, 'Percolator keeper crank error');
    }
  }

  return {
    start() {
      if (timer) return;
      if (!slabAddress || !oracleAddress) {
        logger.warn('Percolator keeper: missing slabAddress or oracleAddress');
        return;
      }
      logger.info({ intervalMs, slab: slabAddress.toBase58() }, 'Percolator keeper started');
      timer = setInterval(crank, intervalMs);
      // Initial crank
      crank();
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        logger.info('Percolator keeper stopped');
      }
    },

    isRunning() {
      return timer !== null;
    },
  };
}
