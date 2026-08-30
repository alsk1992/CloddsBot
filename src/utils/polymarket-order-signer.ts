/**
 * Polymarket CLOB Order Signing (EIP-712)
 *
 * Builds and signs orders for the Polymarket CTF Exchange contract. Both V1 and V2
 * exchanges are live simultaneously (verified on-chain) — GET /version on the live
 * CLOB currently returns 2, meaning V2 is the exchange-wide default order format
 * right now, but V1 is not dead (repo archival on GitHub reflects where new
 * development happens, not that the deployed V1 contract stopped working).
 * Uses the same @noble/curves + @noble/hashes primitives as x402/evm.ts.
 *
 * Reference:
 *   - V1 contract (archived repo, still live on-chain): https://github.com/Polymarket/ctf-exchange
 *   - V2 contract: https://github.com/Polymarket/ctf-exchange-v2
 *   - Order utils: https://github.com/Polymarket/clob-order-utils
 *   - V1 EIP-712 domain: { name: "Polymarket CTF Exchange", version: "1", chainId: 137, verifyingContract: <exchange> }
 *   - V2 EIP-712 domain: { name: "Polymarket CTF Exchange", version: "2", chainId: 137, verifyingContract: <exchangeV2> }
 *   - V2 has no taker/expiration(struct)/nonce/feeRateBps fields — replaced by
 *     timestamp (unix ms) + metadata (bytes32) + builder (bytes32), all verified
 *     against ctf-exchange-v2's Structs.sol/Hashing.sol and clob-client-v2's
 *     exchangeOrderBuilderV2.ts (both agree byte-for-byte on the type string).
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { secp256k1 } from '@noble/curves/secp256k1';

// =============================================================================
// CONSTANTS
// =============================================================================

const PROTOCOL_NAME = 'Polymarket CTF Exchange';
const PROTOCOL_VERSION = '1';
const PROTOCOL_VERSION_V2 = '2';
const CHAIN_ID = 137; // Polygon

/** CTF Exchange V1 (standard binary markets) */
export const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
/** Neg Risk CTF Exchange V1 (multi-outcome / crypto markets) */
export const NEG_RISK_CTF_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
/** CTF Exchange V2 — verified live on Polygon (real bytecode), matches clob-client-v2's config.ts */
export const CTF_EXCHANGE_V2 = '0xE111180000d2663C0091e4f400237545B87B996B';
/** Neg Risk CTF Exchange V2 — verified live on Polygon */
export const NEG_RISK_CTF_EXCHANGE_V2 = '0xe2222d279d744050d28e00520010520000310F59';

/** Operator/taker address (Polymarket's operator) — V1 only, V2 has no taker field */
const OPERATOR_ADDRESS = '0x0000000000000000000000000000000000000000';

/** 32 zero bytes — V2's default metadata/builder value when the caller doesn't set one */
const BYTES32_ZERO = '0x' + '0'.repeat(64);

/** USDC has 6 decimals on Polygon */
const USDC_DECIMALS = 6;

// EIP-712 type string for the V1 Order struct
const ORDER_TYPE_STRING =
  'Order(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType)';

// EIP-712 type string for the V2 Order struct — no taker/nonce/feeRateBps, adds
// timestamp/metadata/builder. Verified identical in both ctf-exchange-v2's
// Structs.sol comment and clob-client-v2's exchangeOrderBuilderV2.ts.
const ORDER_TYPE_STRING_V2 =
  'Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)';

// Signature types (V1 supports EOA/POLY_PROXY/POLY_GNOSIS_SAFE; V2 adds POLY_1271 for
// smart-contract wallets, which needs a different nested-signature scheme entirely and
// is intentionally not implemented here — buildSignedOrderV2 throws if it's requested)
export enum SignatureType {
  EOA = 0,
  POLY_PROXY = 1,
  POLY_GNOSIS_SAFE = 2,
  POLY_1271 = 3,
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
  /** V2 only — bytes32 hex string, defaults to 32 zero bytes if omitted */
  metadata?: string;
  /** V2 only — bytes32 hex string, defaults to 32 zero bytes if omitted */
  builderCode?: string;
}

export interface PolymarketOrderV2 {
  salt: string;
  maker: string;
  signer: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  side: string;
  signatureType: number;
  timestamp: string;
  metadata: string;
  builder: string;
}

/**
 * JSON body for POST /order under the V2 order format — verified against
 * clob-client-v2's ordersV2.ts orderToJsonV2(). No `nonce`/`feeRateBps` (V1-only);
 * adds `timestamp`/`metadata`/`builder`. `expiration` here is API/off-chain
 * bookkeeping for the CLOB matching engine, not part of the signed EIP-712 struct.
 */
export interface PostOrderBodyV2 {
  order: {
    salt: number;
    maker: string;
    signer: string;
    tokenId: string;
    makerAmount: string;
    takerAmount: string;
    side: 'BUY' | 'SELL';
    signatureType: number;
    timestamp: string;
    expiration: string;
    metadata: string;
    builder: string;
    signature: string;
  };
  owner: string;
  orderType: 'GTC' | 'GTD' | 'FOK';
  deferExec: boolean;
  postOnly?: boolean;
}

// =============================================================================
// INPUT VALIDATION
// =============================================================================

export class OrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderValidationError';
  }
}

/**
 * Validate order parameters before signing.
 * Throws OrderValidationError if validation fails.
 */
export function validateOrderParams(params: OrderParams): void {
  // Validate tokenId - should be a large positive integer string
  if (!params.tokenId || params.tokenId.trim() === '') {
    throw new OrderValidationError('tokenId is required');
  }
  if (!/^\d+$/.test(params.tokenId)) {
    throw new OrderValidationError('tokenId must be a numeric string');
  }
  // Token IDs are typically very large (>20 digits)
  if (params.tokenId.length < 10) {
    throw new OrderValidationError('tokenId appears too short - verify it is correct');
  }

  // Validate price - must be between 0.01 and 0.99
  if (typeof params.price !== 'number' || isNaN(params.price)) {
    throw new OrderValidationError('price must be a valid number');
  }
  if (params.price < 0.01 || params.price > 0.99) {
    throw new OrderValidationError(`price ${params.price} out of range [0.01, 0.99]`);
  }

  // Validate size - must be positive
  if (typeof params.size !== 'number' || isNaN(params.size)) {
    throw new OrderValidationError('size must be a valid number');
  }
  if (params.size <= 0) {
    throw new OrderValidationError(`size must be positive, got ${params.size}`);
  }
  // Minimum order size is typically $1 worth
  if (params.size * params.price < 0.5) {
    throw new OrderValidationError('order value too small (minimum ~$1)');
  }

  // Validate side
  if (params.side !== 'buy' && params.side !== 'sell') {
    throw new OrderValidationError(`side must be 'buy' or 'sell', got '${params.side}'`);
  }

  // Validate feeRateBps if provided
  if (params.feeRateBps !== undefined) {
    if (typeof params.feeRateBps !== 'number' || params.feeRateBps < 0 || params.feeRateBps > 10000) {
      throw new OrderValidationError('feeRateBps must be between 0 and 10000');
    }
  }

  // Validate expiration if provided
  if (params.expiration !== undefined && params.expiration !== 0) {
    const now = Math.floor(Date.now() / 1000);
    if (params.expiration < now) {
      throw new OrderValidationError('expiration must be in the future');
    }
    // Minimum 60 seconds for GTD orders
    if (params.expiration - now < 60) {
      throw new OrderValidationError('expiration must be at least 60 seconds in the future');
    }
  }
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

// V2 domain — same 4-field EIP712Domain shape as V1, just a different version string
// ("2"), so it gets its own hash rather than parametrizing hashDomain (keeps the
// already-verified V1 path untouched).
function hashDomainV2(contractAddress: string): string {
  const typeHash = Buffer.from(keccak256(
    Buffer.from('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
  ), 'hex');

  const nameHash = Buffer.from(keccak256(Buffer.from(PROTOCOL_NAME)), 'hex');
  const versionHash = Buffer.from(keccak256(Buffer.from(PROTOCOL_VERSION_V2)), 'hex');
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

function encodeBytes32(value: string): string {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  return hex.toLowerCase().padStart(64, '0');
}

// Field order here must exactly match ORDER_TYPE_STRING_V2's declared order — EIP-712
// struct hashing is positional (by type-string field order), not by object key order.
function hashOrderV2(order: PolymarketOrderV2): string {
  const typeHash = Buffer.from(keccak256(Buffer.from(ORDER_TYPE_STRING_V2)), 'hex');

  const encoded = Buffer.concat([
    typeHash,
    Buffer.from(encodeUint256(order.salt), 'hex'),
    Buffer.from(encodeAddress(order.maker), 'hex'),
    Buffer.from(encodeAddress(order.signer), 'hex'),
    Buffer.from(encodeUint256(order.tokenId), 'hex'),
    Buffer.from(encodeUint256(order.makerAmount), 'hex'),
    Buffer.from(encodeUint256(order.takerAmount), 'hex'),
    Buffer.from(encodeUint256(order.side), 'hex'),
    Buffer.from(encodeUint256(order.signatureType), 'hex'),
    Buffer.from(encodeUint256(order.timestamp), 'hex'),
    Buffer.from(encodeBytes32(order.metadata), 'hex'),
    Buffer.from(encodeBytes32(order.builder), 'hex'),
  ]);

  return '0x' + keccak256(encoded);
}

function createTypedDataHashV2(contractAddress: string, order: PolymarketOrderV2): string {
  const domainSeparator = hashDomainV2(contractAddress);
  const structHash = hashOrderV2(order);

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
 * Generate cryptographically secure salt for order signing.
 * Uses 16 bytes of randomness for sufficient entropy.
 */
function generateSalt(): string {
  // Use crypto-secure random bytes instead of Math.random()
  const bytes = randomBytes(16);
  // Convert to BigInt and take absolute value to ensure positive
  const hex = bytesToHex(bytes);
  // Use first 12 hex chars (48 bits) to stay within safe integer range
  return parseInt(hex.slice(0, 12), 16).toString();
}

// Nonce counter to ensure uniqueness within same millisecond
let nonceCounter = 0;
let lastNonceTimestamp = 0;

/**
 * Generate unique nonce for order signing.
 * Combines timestamp with counter to prevent replay attacks.
 */
function generateNonce(): string {
  const now = Date.now();
  if (now === lastNonceTimestamp) {
    nonceCounter++;
  } else {
    nonceCounter = 0;
    lastNonceTimestamp = now;
  }
  // Combine timestamp and counter: timestamp * 1000 + counter
  // This ensures unique nonces even with multiple orders per millisecond
  return (now * 1000 + nonceCounter).toString();
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
 * @throws {OrderValidationError} if order parameters are invalid
 */
export function buildSignedOrder(
  params: OrderParams,
  signer: SignerConfig,
): PostOrderBody {
  // Validate inputs before signing
  validateOrderParams(params);

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
  const nonce = params.nonce || generateNonce(); // Use unique nonce if not provided
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
    nonce,
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
      nonce,
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

/**
 * Build and sign a Polymarket CLOB order in the V2 format (see file header for what
 * changed vs V1). Use getCurrentPolymarketOrderVersion() to decide whether to call
 * this or buildSignedOrder() — V2 is the live exchange-wide default as of this
 * writing, but callers that already know their target version can call either
 * directly.
 * @throws {OrderValidationError} if order parameters are invalid
 */
export function buildSignedOrderV2(
  params: OrderParams,
  signer: SignerConfig,
): PostOrderBodyV2 {
  validateOrderParams(params);

  const signatureType = signer.signatureType ?? (signer.funderAddress ? SignatureType.POLY_GNOSIS_SAFE : SignatureType.EOA);
  if (signatureType === SignatureType.POLY_1271) {
    throw new Error(
      'POLY_1271 (smart-contract wallet) signing is not implemented — it requires a nested ' +
      'TypedDataSign wrapper around the order, not a plain EIP-712 signature. Use EOA, ' +
      'POLY_PROXY, or POLY_GNOSIS_SAFE instead.'
    );
  }

  const signerAddress = deriveAddress(signer.privateKey);
  const maker = signer.funderAddress || signerAddress;
  const exchange = params.negRisk ? NEG_RISK_CTF_EXCHANGE_V2 : CTF_EXCHANGE_V2;

  const { makerAmount, takerAmount } = getOrderAmounts(params.price, params.size, params.side);
  const salt = generateSalt();
  const timestamp = Date.now().toString();
  const sideNum = params.side === 'buy' ? OrderSide.BUY : OrderSide.SELL;
  const metadata = params.metadata ? normalizeBytes32(params.metadata) : BYTES32_ZERO;
  const builder = params.builderCode ? normalizeBytes32(params.builderCode) : BYTES32_ZERO;

  const order: PolymarketOrderV2 = {
    salt,
    maker,
    signer: signerAddress,
    tokenId: params.tokenId,
    makerAmount,
    takerAmount,
    side: sideNum.toString(),
    signatureType,
    timestamp,
    metadata,
    builder,
  };

  const hash = createTypedDataHashV2(exchange, order);
  const signature = signHash(hash, signer.privateKey);

  return {
    order: {
      salt: parseInt(salt, 10),
      maker,
      signer: signerAddress,
      tokenId: params.tokenId,
      makerAmount,
      takerAmount,
      side: params.side === 'buy' ? 'BUY' : 'SELL',
      signatureType,
      timestamp,
      expiration: (params.expiration || 0).toString(),
      metadata,
      builder,
      signature,
    },
    owner: '', // Caller MUST set this to the API key
    orderType: 'GTC',
    deferExec: false,
  };
}

/**
 * Build multiple V2 signed orders for batch placement.
 */
export function buildSignedOrdersV2(
  paramsList: OrderParams[],
  signer: SignerConfig,
): PostOrderBodyV2[] {
  return paramsList.map((p) => buildSignedOrderV2(p, signer));
}

function normalizeBytes32(value: string): string {
  return value.startsWith('0x') ? value : `0x${value}`;
}

// =============================================================================
// EXCHANGE VERSION RESOLUTION
// =============================================================================

let cachedVersion: { version: 1 | 2; fetchedAt: number } | null = null;
const VERSION_CACHE_MS = 5 * 60 * 1000; // 5 min — exchange-wide version flips are rare, no need to check every order

/**
 * Ask the live CLOB which order version it currently expects (GET /version).
 * Falls back to 2 on any failure — matches clob-client-v2's own fallback
 * (`response?.version ?? 2`); confirmed live that the endpoint currently returns 2.
 */
export async function getCurrentPolymarketOrderVersion(
  clobBaseUrl: string = 'https://clob.polymarket.com',
): Promise<1 | 2> {
  if (cachedVersion && Date.now() - cachedVersion.fetchedAt < VERSION_CACHE_MS) {
    return cachedVersion.version;
  }
  try {
    const res = await fetch(`${clobBaseUrl}/version`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { version?: number };
    const version: 1 | 2 = data.version === 1 ? 1 : 2;
    cachedVersion = { version, fetchedAt: Date.now() };
    return version;
  } catch {
    cachedVersion = { version: 2, fetchedAt: Date.now() };
    return 2;
  }
}
