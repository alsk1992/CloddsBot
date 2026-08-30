import { test } from 'node:test';
import assert from 'node:assert/strict';
import skill from '../../src/skills/bundled/rust-hft-arbitrage/index';

test('rust-hft-arbitrage report summarizes reuse targets', async () => {
  const report = await skill.handle!('report');

  assert.ok(report.includes('Rust HFT Arbitrage Swarm Report'));
  assert.ok(report.includes('p27'));
  assert.ok(report.includes('op'));
  assert.ok(report.includes('Solana'));
  assert.ok(report.includes('EVM'));
});

test('rust-hft-arbitrage venues command lists concrete venues', async () => {
  const venues = await skill.handle!('venues');

  assert.ok(venues.includes('Jupiter'));
  assert.ok(venues.includes('Raydium'));
  assert.ok(venues.includes('Uniswap'));
  assert.ok(venues.includes('Lighter'));
});

test('rust-hft-arbitrage scan help shows usage without hitting the network', async () => {
  const help = await skill.handle!('scan help');

  assert.ok(help.includes('Usage: /hft-arb scan'));
  assert.ok(help.includes('chain=arbitrum'));
});

test('rust-hft-arbitrage scan rejects an unknown family before scanning', async () => {
  const out = await skill.handle!('scan bogus SOL USDC 100');

  assert.ok(out.includes('Usage: /hft-arb scan'));
});

test('rust-hft-arbitrage scan requires size and tokens', async () => {
  const out = await skill.handle!('scan solana SOL');

  assert.ok(out.includes('Usage: /hft-arb scan'));
});

test('rust-hft-arbitrage scan requires a valid chain for evm/cross families', async () => {
  const out = await skill.handle!('scan evm WETH USDC 1000');

  assert.ok(out.includes('Missing or invalid chain'));
});
