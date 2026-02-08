/**
 * Percolator buffer encoding helpers.
 * Adapted from percolator-cli/src/abi/encode.ts
 */

import { PublicKey } from '@solana/web3.js';

export function encU8(val: number): Buffer {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(val, 0);
  return buf;
}

export function encU16(val: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(val, 0);
  return buf;
}

export function encU32(val: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(val, 0);
  return buf;
}

export function encU64(val: bigint | string): Buffer {
  const n = typeof val === 'string' ? BigInt(val) : val;
  if (n < 0n) throw new Error('encU64: value must be non-negative');
  if (n > 0xffff_ffff_ffff_ffffn) throw new Error('encU64: value exceeds u64 max');
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n, 0);
  return buf;
}

export function encI64(val: bigint | string): Buffer {
  const n = typeof val === 'string' ? BigInt(val) : val;
  const min = -(1n << 63n);
  const max = (1n << 63n) - 1n;
  if (n < min || n > max) throw new Error('encI64: value out of range');
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(n, 0);
  return buf;
}

export function encU128(val: bigint | string): Buffer {
  const n = typeof val === 'string' ? BigInt(val) : val;
  if (n < 0n) throw new Error('encU128: value must be non-negative');
  const max = (1n << 128n) - 1n;
  if (n > max) throw new Error('encU128: value exceeds u128 max');
  const buf = Buffer.alloc(16);
  const lo = n & 0xffff_ffff_ffff_ffffn;
  const hi = n >> 64n;
  buf.writeBigUInt64LE(lo, 0);
  buf.writeBigUInt64LE(hi, 8);
  return buf;
}

export function encI128(val: bigint | string): Buffer {
  const n = typeof val === 'string' ? BigInt(val) : val;
  const min = -(1n << 127n);
  const max = (1n << 127n) - 1n;
  if (n < min || n > max) throw new Error('encI128: value out of range');
  let unsigned = n;
  if (n < 0n) {
    unsigned = (1n << 128n) + n;
  }
  const buf = Buffer.alloc(16);
  const lo = unsigned & 0xffff_ffff_ffff_ffffn;
  const hi = unsigned >> 64n;
  buf.writeBigUInt64LE(lo, 0);
  buf.writeBigUInt64LE(hi, 8);
  return buf;
}

export function encPubkey(val: PublicKey | string): Buffer {
  const pk = typeof val === 'string' ? new PublicKey(val) : val;
  return Buffer.from(pk.toBytes());
}

export function encBool(val: boolean): Buffer {
  return encU8(val ? 1 : 0);
}
