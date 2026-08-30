import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Wallet, JsonRpcProvider, keccak256 } from 'ethers';

// Well-known, funds-free Hardhat/Anvil default test account #0 — never used on any
// real chain with real value.
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

/**
 * A JSON-RPC mock that returns fixed, deterministic values for every method
 * populateTransaction/estimateGas could call, so calling it twice (once inside
 * ethers' own wallet.sendTransaction, once directly for the fast-broadcast path)
 * resolves to identical inputs both times. Captures the raw hex from any
 * eth_sendRawTransaction call it receives.
 */
function startDeterministicMockChain(): Promise<{ url: string; close: () => void; capturedRawTxs: string[] }> {
  const capturedRawTxs: string[] = [];

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        // ethers' JsonRpcProvider batches multiple calls made within the same tick
        // into a single POST whose body is an array of requests, expecting an array
        // of responses back — so every request here is handled as a batch of one
        // or more, never assumed to be a single bare object.
        const parsed = JSON.parse(body);
        const requests = Array.isArray(parsed) ? parsed : [parsed];

        const responses = requests.map(({ method, params, id }) => {
          let result: unknown;
          switch (method) {
            case 'eth_chainId':
              result = '0x1';
              break;
            case 'eth_blockNumber':
              result = '0x1';
              break;
            case 'eth_getTransactionCount':
              result = '0x7';
              break;
            case 'eth_estimateGas':
              result = '0x5208';
              break;
            case 'eth_gasPrice':
              result = '0x3b9aca00';
              break;
            case 'eth_feeHistory':
              result = {
                baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
                gasUsedRatio: [0.5],
                reward: [['0x3b9aca00']],
              };
              break;
            case 'eth_maxPriorityFeePerGas':
              result = '0x3b9aca00';
              break;
            case 'eth_getBlockByNumber':
              result = {
                hash: `0x${'ab'.repeat(32)}`,
                parentHash: `0x${'00'.repeat(32)}`,
                number: '0x1',
                timestamp: '0x68b00000',
                difficulty: '0x0',
                gasLimit: '0x1c9c380',
                gasUsed: '0x5208',
                extraData: '0x',
                baseFeePerGas: '0x3b9aca00',
                transactions: [],
              };
              break;
            case 'eth_sendRawTransaction': {
              const rawTx = params[0] as string;
              capturedRawTxs.push(rawTx);
              // ethers' broadcastTransaction checks the node's returned hash against
              // the tx's real computed hash, so this must be the genuine keccak256
              // of what was actually sent, not a canned value.
              result = keccak256(rawTx);
              break;
            }
            default:
              result = null;
          }
          return { jsonrpc: '2.0', id, result };
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Array.isArray(parsed) ? responses : responses[0]));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close(), capturedRawTxs });
    });
  });
}

describe('fast-broadcast byte parity with ethers wallet.sendTransaction', () => {
  it('produces the exact same signed raw transaction bytes as the native ethers path', async () => {
    const chain = await startDeterministicMockChain();
    try {
      const txRequest = {
        to: '0x000000000000000000000000000000000000dEaD',
        value: 1_000_000_000_000_000n, // 0.001 ETH
      };

      // Path A: ethers' own wallet.sendTransaction — the pre-existing pattern used
      // throughout src/evm/*.ts (oneinch.ts, odos.ts). We capture the raw bytes it
      // actually broadcasts via our mock's eth_sendRawTransaction handler.
      const providerA = new JsonRpcProvider(chain.url, 1, { staticNetwork: true });
      const walletA = new Wallet(TEST_PRIVATE_KEY, providerA);
      await walletA.sendTransaction(txRequest);
      assert.equal(chain.capturedRawTxs.length, 1, 'expected exactly one broadcast from wallet.sendTransaction');
      const nativeRawTx = chain.capturedRawTxs[0];

      // Path B: the fast-broadcast populate+sign sequence (src/evm/fast-broadcast.ts),
      // using a fresh wallet/provider pair so path A's state can't leak in (e.g. a
      // cached nonce), reproduced inline here rather than importing the module so
      // this test exercises the exact same ethers calls without spawning the Rust
      // worker binary.
      const providerB = new JsonRpcProvider(chain.url, 1, { staticNetwork: true });
      const walletB = new Wallet(TEST_PRIVATE_KEY, providerB);
      const populated = await walletB.populateTransaction(txRequest);
      const fastBroadcastRawTx = await walletB.signTransaction(populated);

      assert.equal(
        fastBroadcastRawTx,
        nativeRawTx,
        'fast-broadcast signing path must produce byte-identical output to wallet.sendTransaction'
      );
    } finally {
      chain.close();
    }
  });
});
