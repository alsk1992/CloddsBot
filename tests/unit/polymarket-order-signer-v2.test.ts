import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import {
  buildSignedOrderV2,
  SignatureType,
  CTF_EXCHANGE_V2,
  NEG_RISK_CTF_EXCHANGE_V2,
} from '../../src/utils/polymarket-order-signer';

// Well-known, funds-free Hardhat/Anvil default test account #0 — never used on any
// real chain with real value. Same key used in fast-broadcast-byte-parity.test.ts.
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

/**
 * Independent reference: computes the same V2 order signature via ethers' own
 * EIP-712 implementation (Wallet.signTypedData), built directly from Polymarket's
 * documented V2 domain/struct rather than reusing any of polymarket-order-signer.ts's
 * own hashing code — so a bug in that file's hand-rolled keccak/ABI-encoding can't
 * accidentally cancel out between the code under test and its own reference.
 */
async function referenceSignV2(
  exchange: string,
  order: {
    salt: string; maker: string; signer: string; tokenId: string;
    makerAmount: string; takerAmount: string; side: number; signatureType: number;
    timestamp: string; metadata: string; builder: string;
  }
): Promise<string> {
  const wallet = new Wallet(TEST_PRIVATE_KEY);
  const domain = { name: 'Polymarket CTF Exchange', version: '2', chainId: 137, verifyingContract: exchange };
  const types = {
    Order: [
      { name: 'salt', type: 'uint256' },
      { name: 'maker', type: 'address' },
      { name: 'signer', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
      { name: 'makerAmount', type: 'uint256' },
      { name: 'takerAmount', type: 'uint256' },
      { name: 'side', type: 'uint8' },
      { name: 'signatureType', type: 'uint8' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'metadata', type: 'bytes32' },
      { name: 'builder', type: 'bytes32' },
    ],
  };
  return wallet.signTypedData(domain, types, order);
}

describe('Polymarket V2 order signer byte parity with ethers EIP-712', () => {
  it('produces a byte-identical signature to an independent ethers reference (standard exchange, BUY)', async () => {
    const result = buildSignedOrderV2(
      { tokenId: '21742633143463906290569050155826241533067272736897614950488156847949938836455', price: 0.5, size: 100, side: 'buy' },
      { privateKey: TEST_PRIVATE_KEY, signatureType: SignatureType.EOA }
    );

    const refSig = await referenceSignV2(CTF_EXCHANGE_V2, {
      salt: result.order.salt.toString(),
      maker: result.order.maker,
      signer: result.order.signer,
      tokenId: result.order.tokenId,
      makerAmount: result.order.makerAmount,
      takerAmount: result.order.takerAmount,
      side: 0,
      signatureType: result.order.signatureType,
      timestamp: result.order.timestamp,
      metadata: result.order.metadata,
      builder: result.order.builder,
    });

    assert.equal(result.order.signature.toLowerCase(), refSig.toLowerCase());
  });

  it('produces a byte-identical signature to an independent ethers reference (negRisk exchange, SELL)', async () => {
    const result = buildSignedOrderV2(
      { tokenId: '98765432109876543210987654321098765432109876543210987654321098765432109876', price: 0.73, size: 50, side: 'sell', negRisk: true },
      { privateKey: TEST_PRIVATE_KEY, signatureType: SignatureType.EOA }
    );

    const refSig = await referenceSignV2(NEG_RISK_CTF_EXCHANGE_V2, {
      salt: result.order.salt.toString(),
      maker: result.order.maker,
      signer: result.order.signer,
      tokenId: result.order.tokenId,
      makerAmount: result.order.makerAmount,
      takerAmount: result.order.takerAmount,
      side: 1,
      signatureType: result.order.signatureType,
      timestamp: result.order.timestamp,
      metadata: result.order.metadata,
      builder: result.order.builder,
    });

    assert.equal(result.order.signature.toLowerCase(), refSig.toLowerCase());
  });

  it('defaults metadata/builder to 32 zero bytes and rejects POLY_1271', () => {
    const result = buildSignedOrderV2(
      { tokenId: '21742633143463906290569050155826241533067272736897614950488156847949938836455', price: 0.5, size: 100, side: 'buy' },
      { privateKey: TEST_PRIVATE_KEY }
    );
    assert.equal(result.order.metadata, '0x' + '0'.repeat(64));
    assert.equal(result.order.builder, '0x' + '0'.repeat(64));

    assert.throws(() =>
      buildSignedOrderV2(
        { tokenId: '21742633143463906290569050155826241533067272736897614950488156847949938836455', price: 0.5, size: 100, side: 'buy' },
        { privateKey: TEST_PRIVATE_KEY, signatureType: SignatureType.POLY_1271 }
      )
    );
  });
});
