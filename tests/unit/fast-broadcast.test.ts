import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { broadcastRace } from '../../src/evm/fast-broadcast';

const RUST_ROOT = path.join(__dirname, '..', '..', 'rust', 'fast-broadcast', 'target');
const RELEASE_BIN = path.join(RUST_ROOT, 'release', 'fast-broadcast');
const DEBUG_BIN = path.join(RUST_ROOT, 'debug', 'fast-broadcast');

// This crate isn't part of the npm build — it's a separately-built Rust sidecar
// (see rust/fast-broadcast/README or `cargo build`). Most dev machines and CI
// runners for this Node project won't have it built, so skip rather than fail
// npm test/ci for everyone; run `cargo build` in rust/fast-broadcast/ to opt in.
const binPath = fs.existsSync(RELEASE_BIN) ? RELEASE_BIN : fs.existsSync(DEBUG_BIN) ? DEBUG_BIN : null;
if (binPath) process.env.FAST_BROADCAST_BIN = binPath;
const skip = binPath ? false : 'fast-broadcast Rust binary not built — run `cargo build` in rust/fast-broadcast/';

function mockRpc(delayMs: number, body: object): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        }, delayMs);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

describe('fast-broadcast (Rust worker via TS wrapper)', { skip }, () => {
  it('races real local servers and returns the faster one, via the actual compiled binary', async () => {
    const fast = await mockRpc(20, { jsonrpc: '2.0', id: 1, result: '0xfastresult00000000000000000000000000000000000000000000000000' });
    const slow = await mockRpc(400, { jsonrpc: '2.0', id: 1, result: '0xslowresult00000000000000000000000000000000000000000000000000' });

    try {
      const result = await broadcastRace('0xdeadbeef', [fast.url, slow.url], 3_000);
      assert.equal(result.hash, '0xfastresult00000000000000000000000000000000000000000000000000');
      assert.equal(result.wonBy, fast.url);
      assert.equal(result.endpointCount, 2);
      assert.ok(result.latencyMs < 300, `expected a fast win, got latencyMs=${result.latencyMs}`);
    } finally {
      fast.close();
      slow.close();
    }
  });

  it('rejects when every endpoint fails', async () => {
    const bad = await mockRpc(5, {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32000, message: 'insufficient funds' },
    });

    try {
      await assert.rejects(() => broadcastRace('0xdeadbeef', [bad.url], 2_000), /insufficient funds/);
    } finally {
      bad.close();
    }
  });

  it('rejects cleanly when no endpoints are provided', async () => {
    await assert.rejects(() => broadcastRace('0xdeadbeef', [], 1_000));
  });
});
