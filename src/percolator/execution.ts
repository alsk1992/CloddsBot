/**
 * Percolator execution service — wraps trade-cpi as a partial ExecutionService adapter.
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { logger } from '../utils/logger.js';

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}
import { loadSolanaKeypair } from '../solana/wallet.js';
import type { PercolatorConfig, PercolatorPosition } from './types.js';
import { DEFAULT_RPC_URL } from './types.js';
import { fetchSlab, parseConfig, parseEngine, parseAllAccounts, AccountKind } from './slab.js';
import { ACCOUNTS_TRADE_CPI, ACCOUNTS_DEPOSIT_COLLATERAL, ACCOUNTS_WITHDRAW_COLLATERAL, buildAccountMetas, WELL_KNOWN } from './accounts.js';
import { encodeTradeCpi, encodeDepositCollateral, encodeWithdrawCollateral } from './instructions.js';
import { deriveLpPda, deriveVaultAuthority } from './pda.js';
import { buildIx, simulateOrSend, type TxResult } from './tx.js';

export interface PercolatorOrderRequest {
  /** Positive size = long, negative = short (in base units) */
  size: bigint;
  /** LP index to trade against (default: config.lpIndex ?? 0) */
  lpIndex?: number;
}

export interface PercolatorOrderResult {
  success: boolean;
  signature?: string;
  error?: string;
  slot?: number;
}

export interface PercolatorExecutionService {
  marketBuy(req: { size: number }): Promise<PercolatorOrderResult>;
  marketSell(req: { size: number }): Promise<PercolatorOrderResult>;
  deposit(amount: bigint): Promise<PercolatorOrderResult>;
  withdraw(amount: bigint): Promise<PercolatorOrderResult>;
  getPositions(): Promise<PercolatorPosition[]>;
  getUserIndex(): Promise<number | null>;
}

export function createPercolatorExecution(config: PercolatorConfig): PercolatorExecutionService {
  const rpcUrl = config.rpcUrl ?? process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const programId = new PublicKey(config.programId ?? '2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp');
  const slabAddress = config.slabAddress ? new PublicKey(config.slabAddress) : null;
  const matcherProgram = config.matcherProgram ? new PublicKey(config.matcherProgram) : null;
  const matcherContext = config.matcherContext ? new PublicKey(config.matcherContext) : null;
  const oracleAddress = config.oracleAddress ? new PublicKey(config.oracleAddress) : null;
  const defaultLpIndex = config.lpIndex ?? 0;
  const dryRun = config.dryRun ?? true;

  let connection: Connection | null = null;
  let keypair: Keypair | null = null;

  function getConnection(): Connection {
    if (!connection) {
      connection = new Connection(rpcUrl, 'confirmed');
    }
    return connection;
  }

  function getKeypair(): Keypair {
    if (!keypair) {
      keypair = loadSolanaKeypair({ rpcUrl });
    }
    return keypair;
  }

  async function findUserIndex(data: Buffer, owner: PublicKey): Promise<number | null> {
    const allAccounts = parseAllAccounts(data);
    for (const { idx, account } of allAccounts) {
      if (account.kind === AccountKind.User && account.owner.equals(owner)) {
        return idx;
      }
    }
    return null;
  }

  async function executeTrade(size: bigint, lpIndex?: number): Promise<PercolatorOrderResult> {
    if (!slabAddress) return { success: false, error: 'slabAddress not configured' };
    if (!matcherProgram) return { success: false, error: 'matcherProgram not configured' };
    if (!matcherContext) return { success: false, error: 'matcherContext not configured' };
    if (!oracleAddress) return { success: false, error: 'oracleAddress not configured' };

    try {
      const conn = getConnection();
      const kp = getKeypair();
      const lpIdx = lpIndex ?? defaultLpIndex;

      // Fetch slab to find user index and LP owner
      const data = await fetchSlab(conn, slabAddress);
      const userIdx = await findUserIndex(data, kp.publicKey);
      if (userIdx === null) {
        return { success: false, error: 'No user account found on slab. Run init-user first.' };
      }

      // Find LP owner from slab
      const allAccounts = parseAllAccounts(data);
      const lpAccount = allAccounts.find(a => a.idx === lpIdx && a.account.kind === AccountKind.LP);
      if (!lpAccount) {
        return { success: false, error: `LP account at index ${lpIdx} not found` };
      }
      const lpOwner = lpAccount.account.owner;

      // Derive LP PDA
      const [lpPda] = deriveLpPda(programId, slabAddress, lpIdx);

      // Encode instruction
      const ixData = encodeTradeCpi({ lpIdx, userIdx, size });

      // Build account metas
      const keys = buildAccountMetas(ACCOUNTS_TRADE_CPI, [
        kp.publicKey,       // user (signer)
        lpOwner,            // lpOwner
        slabAddress,        // slab (writable)
        WELL_KNOWN.clock,   // clock
        oracleAddress,      // oracle
        matcherProgram,     // matcherProg
        matcherContext,     // matcherCtx (writable)
        lpPda,              // lpPda
      ]);

      // Build and send
      const ix = buildIx({ programId, keys, data: ixData });
      const result: TxResult = await simulateOrSend({
        connection: conn,
        ix,
        signers: [kp],
        simulate: dryRun,
      });

      if (result.err) {
        logger.warn({ err: result.err, sig: result.signature }, 'Percolator trade failed');
        return { success: false, error: result.err, signature: result.signature };
      }

      logger.info({
        sig: result.signature,
        slot: result.slot,
        size: size.toString(),
        lpIdx,
      }, 'Percolator trade executed');

      return { success: true, signature: result.signature, slot: result.slot };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, 'Percolator trade error');
      return { success: false, error: msg };
    }
  }

  return {
    async marketBuy(req) {
      // Convert USD size to base units (1e6 for USDC)
      const sizeUnits = BigInt(Math.round(req.size * 1_000_000));
      return executeTrade(sizeUnits);
    },

    async marketSell(req) {
      const sizeUnits = BigInt(Math.round(req.size * 1_000_000));
      return executeTrade(-sizeUnits);
    },

    async deposit(amount) {
      if (!slabAddress) return { success: false, error: 'slabAddress not configured' };
      try {
        const conn = getConnection();
        const kp = getKeypair();
        const data = await fetchSlab(conn, slabAddress);
        const userIdx = await findUserIndex(data, kp.publicKey);
        if (userIdx === null) return { success: false, error: 'No user account found' };

        const mktConfig = parseConfig(data);
        const userAta = deriveAta(kp.publicKey, mktConfig.collateralMint);

        const ixData = encodeDepositCollateral({ userIdx, amount });
        const keys = buildAccountMetas(ACCOUNTS_DEPOSIT_COLLATERAL, [
          kp.publicKey,
          slabAddress,
          userAta,
          mktConfig.vaultPubkey,
          WELL_KNOWN.tokenProgram,
          WELL_KNOWN.clock,
        ]);

        const ix = buildIx({ programId, keys, data: ixData });
        const result = await simulateOrSend({ connection: conn, ix, signers: [kp], simulate: dryRun });

        if (result.err) return { success: false, error: result.err };
        return { success: true, signature: result.signature, slot: result.slot };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async withdraw(amount) {
      if (!slabAddress || !oracleAddress) return { success: false, error: 'slabAddress/oracleAddress not configured' };
      try {
        const conn = getConnection();
        const kp = getKeypair();
        const data = await fetchSlab(conn, slabAddress);
        const userIdx = await findUserIndex(data, kp.publicKey);
        if (userIdx === null) return { success: false, error: 'No user account found' };

        const mktConfig = parseConfig(data);
        const userAta = deriveAta(kp.publicKey, mktConfig.collateralMint);
        const [vaultPda] = deriveVaultAuthority(programId, slabAddress);

        const ixData = encodeWithdrawCollateral({ userIdx, amount });
        const keys = buildAccountMetas(ACCOUNTS_WITHDRAW_COLLATERAL, [
          kp.publicKey,
          slabAddress,
          mktConfig.vaultPubkey,
          userAta,
          vaultPda,
          WELL_KNOWN.tokenProgram,
          WELL_KNOWN.clock,
          oracleAddress,
        ]);

        const ix = buildIx({ programId, keys, data: ixData });
        const result = await simulateOrSend({ connection: conn, ix, signers: [kp], simulate: dryRun });

        if (result.err) return { success: false, error: result.err };
        return { success: true, signature: result.signature, slot: result.slot };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async getPositions() {
      if (!slabAddress) return [];
      try {
        const conn = getConnection();
        const kp = getKeypair();
        const data = await fetchSlab(conn, slabAddress);
        const allAccounts = parseAllAccounts(data);
        return allAccounts
          .filter(({ account }) =>
            account.kind === AccountKind.User &&
            account.positionSize !== 0n &&
            account.owner.equals(kp.publicKey),
          )
          .map(({ idx, account }) => ({
            accountIndex: idx,
            capital: account.capital,
            positionSize: account.positionSize,
            entryPrice: account.entryPrice,
            pnl: account.pnl,
            fundingIndex: account.fundingIndex,
            owner: account.owner,
          }));
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Percolator getPositions failed');
        return [];
      }
    },

    async getUserIndex() {
      if (!slabAddress) return null;
      try {
        const conn = getConnection();
        const kp = getKeypair();
        const data = await fetchSlab(conn, slabAddress);
        return findUserIndex(data, kp.publicKey);
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Percolator getUserIndex failed');
        return null;
      }
    },
  };
}
