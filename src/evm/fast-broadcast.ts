/**
 * Fast EVM Broadcast — TypeScript side of the fast-broadcast Rust worker.
 *
 * Racing a signed transaction across multiple RPC endpoints is a hot-path operation
 * (the whole point is shaving submission latency), so the actual racing loop lives in
 * Rust (rust/fast-broadcast/) rather than Node — no GC pauses, no event-loop
 * contention with whatever else Clodds is doing at that moment. This module is the
 * narrow interface: spawn the compiled binary, write one line of request JSON to its
 * stdin, read one line of result JSON back from its stdout.
 *
 * The Rust worker must be built first: `cargo build --release` in rust/fast-broadcast/.
 */

import { spawn } from 'child_process';
import path from 'path';
import { Wallet, type TransactionRequest } from 'ethers';
import { logger } from '../utils/logger';

export interface BroadcastRaceResult {
  hash: string;
  wonBy: string;
  latencyMs: number;
  endpointCount: number;
}

interface WorkerResponse {
  ok: boolean;
  hash?: string;
  wonBy?: string;
  latencyMs?: number;
  endpointCount?: number;
  error?: string;
}

function resolveBinaryPath(): string {
  const override = process.env.FAST_BROADCAST_BIN;
  if (override) return override;

  const root = path.join(__dirname, '..', '..', 'rust', 'fast-broadcast', 'target');
  return path.join(root, 'release', 'fast-broadcast');
}

/**
 * Submit `rawTx` (a pre-signed raw transaction hex string) to every URL in `rpcUrls`
 * at once via the Rust fast-broadcast worker. Resolves with whichever endpoint
 * accepts it first; rejects only if every endpoint fails.
 */
export async function broadcastRace(
  rawTx: string,
  rpcUrls: string[],
  timeoutMs = 5_000
): Promise<BroadcastRaceResult> {
  const binaryPath = resolveBinaryPath();
  const request = JSON.stringify({ rawTx, rpcUrls, timeoutMs });

  return new Promise<BroadcastRaceResult>((resolve, reject) => {
    const child = spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    child.on('error', (err) => {
      reject(new Error(`fast-broadcast worker failed to start (${binaryPath}): ${err.message}`));
    });

    child.on('close', () => {
      let parsed: WorkerResponse;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        reject(new Error(`fast-broadcast worker produced no valid JSON. stderr: ${stderr.trim() || '(empty)'}`));
        return;
      }

      if (!parsed.ok) {
        reject(new Error(parsed.error ?? 'fast-broadcast worker reported failure with no message'));
        return;
      }

      resolve({
        hash: parsed.hash!,
        wonBy: parsed.wonBy!,
        latencyMs: parsed.latencyMs!,
        endpointCount: parsed.endpointCount!,
      });
    });

    child.stdin.write(request);
    child.stdin.end();
  });
}

/**
 * Sign `tx` once with `wallet`, then race the resulting raw transaction across
 * `rpcUrls` via the Rust worker. Drop-in replacement for `wallet.sendTransaction(tx)`
 * at call sites that want lower submission latency — same inputs, returns the hash
 * plus which endpoint won.
 */
export async function signAndBroadcastRace(
  wallet: Wallet,
  tx: TransactionRequest,
  rpcUrls: string[],
  timeoutMs = 5_000
): Promise<BroadcastRaceResult> {
  const populated = await wallet.populateTransaction(tx);
  const rawTx = await wallet.signTransaction(populated);
  const result = await broadcastRace(rawTx, rpcUrls, timeoutMs);
  logger.debug(
    { hash: result.hash, wonBy: result.wonBy, latencyMs: result.latencyMs, endpointCount: result.endpointCount },
    'signAndBroadcastRace won'
  );
  return result;
}
