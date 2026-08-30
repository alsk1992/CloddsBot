import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// CHAINS is built once at module load time from process.env, so each scenario
// needs a fresh process with its own environment — setting process.env after
// this process has already imported multichain.ts would have no effect.
const TSX_BIN = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx');

function getRaceUrlsInFreshProcess(env: Record<string, string>): string[] {
  const script = `
    import { getRaceUrls } from './src/evm/multichain';
    console.log(JSON.stringify(getRaceUrls('ethereum')));
  `;
  const result = spawnSync(TSX_BIN, ['--eval', script], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`subprocess failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim());
}

describe('multichain getRaceUrls', () => {
  it('defaults to just the primary RPC when no fallbacks are configured', () => {
    const urls = getRaceUrlsInFreshProcess({ ETH_RPC_FALLBACKS: '', ETH_RPC_URL: 'https://primary.example' });
    assert.deepEqual(urls, ['https://primary.example']);
  });

  it('includes configured fallbacks after the primary, trimmed', () => {
    const urls = getRaceUrlsInFreshProcess({
      ETH_RPC_URL: 'https://primary.example',
      ETH_RPC_FALLBACKS: ' https://fallback-a.example , https://fallback-b.example ',
    });
    assert.deepEqual(urls, ['https://primary.example', 'https://fallback-a.example', 'https://fallback-b.example']);
  });

  it('dedupes a fallback that matches the primary', () => {
    const urls = getRaceUrlsInFreshProcess({
      ETH_RPC_URL: 'https://primary.example',
      ETH_RPC_FALLBACKS: 'https://primary.example,https://fallback-a.example',
    });
    assert.deepEqual(urls, ['https://primary.example', 'https://fallback-a.example']);
  });
});
