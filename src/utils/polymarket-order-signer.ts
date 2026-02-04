/**
 * Polymarket CLOB Order Signing (EIP-712)
 *
 * Builds and signs orders for the Polymarket CTF Exchange contract.
 * Uses the same @noble/curves + @noble/hashes primitives as x402/evm.ts.
 *
 * Reference:
 *   - Contract: https://github.com/Polymarket/ctf-exchange
 *   - Order utils: https://github.com/Polymarket/clob-order-utils
 *   - EIP-712 domain: { name: "Polymarket CTF Exchange", version: "1", chainId: 137, verifyingContract: <exchange> }
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { secp256k1 } from '@noble/curves/secp256k1';

// =============================================================================
// CONSTANTS
// =============================================================================

const PROTOCOL_NAME = 'Polymarket CTF Exchange';
const PROTOCOL_VERSION = '1';
const CHAIN_ID = 137; // Polygon

/** CTF Exchange (standard binary markets) */
export const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
/** Neg Risk CTF Exchange (multi-outcome / crypto markets) */
export const NEG_RISK_CTF_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';

/** Operator/taker address (Polymarket's operator) */
const OPERATOR_ADDRESS = '0x0000000000000000000000000000000000000000';

/** USDC has 6 decimals on Polygon */
const USDC_DECIMALS = 6;

// EIP-712 type string for Order struct
const ORDER_TYPE_STRING =
  'Order(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType)';

// Signature types
export enum SignatureType {
  EOA = 0,
  POLY_PROXY = 1,
  POLY_GNOSIS_SAFE = 2,
}

// Side enum matching contract
export enum OrderSide {
  BUY = 0,
  SELL = 1,
}

// =============================================================================
// TYPES
// =============================================================================

export interface PolymarketOrder {
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  expiration: string;
  nonce: string;
  feeRateBps: string;
  side: string;
  signatureType: number;
}

/**
 * JSON body for POST /order — matches official clob-client format.
 *
 * Critical field types (verified against official repos):
 *   - salt: number (integer, NOT string)
 *   - side: "BUY" | "SELL" (string, NOT numeric 0/1)
 *   - signatureType: number (0, 1, or 2)
 *   - makerAmount/takerAmount/tokenId/expiration/nonce/feeRateBps: string
 *   - owner: API key (NOT wallet address)
 */
export interface PostOrderBody {
  order: {
    salt: number;
    maker: string;
    signer: string;
    taker: string;
    tokenId: string;
    makerAmount: string;
    takerAmount: string;
    expiration: string;
    nonce: string;
    feeRateBps: string;
    side: 'BUY' | 'SELL';
    signatureType: number;
    signature: string;
  };
  owner: string;
  orderType: 'GTC' | 'GTD' | 'FOK';
  deferExec: boolean;
  postOnly?: boolean;
}

export interface OrderParams {
  tokenId: string;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  feeRateBps?: number;
  nonce?: string;
  expiration?: number;
  negRisk?: boolean;
}

export interface SignerConfig {
  privateKey: string;
  funderAddress?: string; // If using proxy wallet, this is the maker
  signatureType?: SignatureType;
}

// =============================================================================
// KECCAK256
// =============================================================================

function keccak256(data: Buffer | Uint8Array): string {
  return bytesToHex(keccak_256(data));
}

// =============================================================================
// AMOUNT CONVERSION
// =============================================================================

/**
 * Convert price (0.01-0.99) and size (shares) to makerAmount / takerAmount.
 *
 * For BUY: maker pays USDC, taker provides shares
 *   makerAmount = size * price (in USDC raw units, 6 decimals)
 *   takerAmount = size (in conditional token raw units, 6 decimals)
 *
 * For SELL: maker provides shares, taker pays USDC
 *   makerAmount = size (in conditional token raw units, 6 decimals)
 *   takerAmount = size * price (in USDC raw units, 6 decimals)
 */
export function getOrderAmounts(
  price: number,
  size: number,
  side: 'buy' | 'sell',
): { makerAmount: string; takerAmount: string } {
  // Round price to 2 decimals, size to 2 decimals
  const roundedPrice = Math.round(price * 100) / 100;
  const roundedSize = Math.round(size * 100) / 100;

  const rawSize = Math.round(roundedSize * Math.pow(10, USDC_DECIMALS));
  const rawCost = Math.round(roundedSize * roundedPrice * Math.pow(10, USDC_DECIMALS));

  if (side === 'buy') {
    return {
      makerAmount: rawCost.toString(),
      takerAmount: rawSize.toString(),
    };
  } else {
    return {
      makerAmount: rawSize.toString(),
      takerAmount: rawCost.toString(),
    };
  }
}

// =============================================================================
// EIP-712 HASHING
// =============================================================================

function hashDomain(contractAddress: string): string {
  const typeHash = Buffer.from(keccak256(
    Buffer.from('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
  ), 'hex');

  const nameHash = Buffer.from(keccak256(Buffer.from(PROTOCOL_NAME)), 'hex');
  const versionHash = Buffer.from(keccak256(Buffer.from(PROTOCOL_VERSION)), 'hex');
  const chainIdHex = CHAIN_ID.toString(16).padStart(64, '0');
  const contractHex = contractAddress.slice(2).toLowerCase().padStart(64, '0');

  const encoded = Buffer.concat([
    typeHash,
    nameHash,
    versionHash,
    Buffer.from(chainIdHex, 'hex'),
    Buffer.from(contractHex, 'hex'),
  ]);

  return '0x' + keccak256(encoded);
}

function encodeUint256(value: string | number | bigint): string {
  return BigInt(value).toString(16).padStart(64, '0');
}

function encodeAddress(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, '0');
}

function hashOrder(order: PolymarketOrder): string {
  const typeHash = Buffer.from(keccak256(Buffer.from(ORDER_TYPE_STRING)), 'hex');

  const encoded = Buffer.concat([
    typeHash,
    Buffer.from(encodeUint256(order.salt), 'hex'),
    Buffer.from(encodeAddress(order.maker), 'hex'),
    Buffer.from(encodeAddress(order.signer), 'hex'),
    Buffer.from(encodeAddress(order.taker), 'hex'),
    Buffer.from(encodeUint256(order.tokenId), 'hex'),
    Buffer.from(encodeUint256(order.makerAmount), 'hex'),
    Buffer.from(encodeUint256(order.takerAmount), 'hex'),
    Buffer.from(encodeUint256(order.expiration), 'hex'),
    Buffer.from(encodeUint256(order.nonce), 'hex'),
    Buffer.from(encodeUint256(order.feeRateBps), 'hex'),
    Buffer.from(encodeUint256(order.side), 'hex'),
    Buffer.from(encodeUint256(order.signatureType), 'hex'),
  ]);

  return '0x' + keccak256(encoded);
}

function createTypedDataHash(contractAddress: string, order: PolymarketOrder): string {
  const domainSeparator = hashDomain(contractAddress);
  const structHash = hashOrder(order);

  const encoded = Buffer.concat([
    Buffer.from([0x19, 0x01]),
    Buffer.from(domainSeparator.slice(2), 'hex'),
    Buffer.from(structHash.slice(2), 'hex'),
  ]);

  return '0x' + keccak256(encoded);
}

// =============================================================================
// SIGNING
// =============================================================================

function signHash(hash: string, privateKey: string): string {
  const keyBytes = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  const hashBytes = hexToBytes(hash.startsWith('0x') ? hash.slice(2) : hash);

  const sig = secp256k1.sign(hashBytes, keyBytes);
  const r = sig.r.toString(16).padStart(64, '0');
  const s = sig.s.toString(16).padStart(64, '0');
  const v = sig.recovery + 27;

  return '0x' + r + s + v.toString(16).padStart(2, '0');
}

/**
 * Generate salt matching official Polymarket implementation:
 *   Math.round(Math.random() * Date.now())
 */
function generateSalt(): string {
  return Math.round(Math.random() * Date.now()).toString();
}

function deriveAddress(privateKey: string): string {
  const keyHex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  const pubKey = secp256k1.getPublicKey(keyHex, false).slice(1);
  const hash = keccak256(pubKey);
  return '0x' + hash.slice(-40);
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Build and sign a Polymarket CLOB order.
 *
 * Returns a PostOrder ready for POST /order or POST /orders (batch).
 */
export function buildSignedOrder(
  params: OrderParams,
  signer: SignerConfig,
): PostOrderBody {
  const signerAddress = deriveAddress(signer.privateKey);
  const maker = signer.funderAddress || signerAddress;
  // signatureType must match how the account was created on Polymarket:
  //   0 = EOA (direct wallet, no proxy)
  //   1 = POLY_PROXY (Magic Link / email login)
  //   2 = POLY_GNOSIS_SAFE (MetaMask / browser wallet — most common)
  // Default: EOA if no funder, POLY_GNOSIS_SAFE if funder is set (most Polymarket web accounts)
  const signatureType = signer.signatureType ?? (signer.funderAddress ? SignatureType.POLY_GNOSIS_SAFE : SignatureType.EOA);
  const exchange = params.negRisk ? NEG_RISK_CTF_EXCHANGE : CTF_EXCHANGE;

  const { makerAmount, takerAmount } = getOrderAmounts(params.price, params.size, params.side);
  const salt = generateSalt();
  const sideNum = params.side === 'buy' ? OrderSide.BUY : OrderSide.SELL;

  // Build the order struct for EIP-712 signing (uses numeric side)
  const order: PolymarketOrder = {
    salt,
    maker,
    signer: signerAddress,
    taker: OPERATOR_ADDRESS,
    tokenId: params.tokenId,
    makerAmount,
    takerAmount,
    expiration: (params.expiration || 0).toString(),
    nonce: params.nonce || '0',
    feeRateBps: (params.feeRateBps || 0).toString(),
    side: sideNum.toString(),
    signatureType,
  };

  const hash = createTypedDataHash(exchange, order);
  const signature = signHash(hash, signer.privateKey);

  // Convert to API format (salt=int, side="BUY"/"SELL", owner=API key set by caller)
  return {
    order: {
      salt: parseInt(salt, 10),
      maker,
      signer: signerAddress,
      taker: OPERATOR_ADDRESS,
      tokenId: params.tokenId,
      makerAmount,
      takerAmount,
      expiration: (params.expiration || 0).toString(),
      nonce: params.nonce || '0',
      feeRateBps: (params.feeRateBps || 0).toString(),
      side: params.side === 'buy' ? 'BUY' : 'SELL',
      signatureType,
      signature,
    },
    owner: '', // Caller MUST set this to the API key
    orderType: 'GTC',
    deferExec: false,
  };
}

/**
 * Build multiple signed orders for batch placement.
 */
export function buildSignedOrders(
  paramsList: OrderParams[],
  signer: SignerConfig,
): PostOrderBody[] {
  return paramsList.map((p) => buildSignedOrder(p, signer));
}
