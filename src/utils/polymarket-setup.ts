/**
 * Polymarket Account Setup Utilities
 *
 * Handles first-time programmatic trading setup:
 *   1. API key derivation (L1 EIP-712 → L2 HMAC credentials)
 *   2. Token approvals (USDC + CTF → Exchange contracts)
 *
 * Reference:
 *   - clob-client: https://github.com/Polymarket/clob-client
 *   - ClobAuthDomain EIP-712: used for /auth/api-key and /auth/derive-api-key
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { secp256k1 } from '@noble/curves/secp256k1';

const CLOB_URL = 'https://clob.polymarket.com';

// =============================================================================
// CONTRACT ADDRESSES (Polygon Mainnet, chainId 137)
// =============================================================================

/** USDC on Polygon (bridged, 6 decimals) */
export const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
/** Conditional Tokens Framework (ERC-1155) */
export const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
/** CTF Exchange (standard binary markets) */
export const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
/** NegRisk CTF Exchange (multi-outcome / crypto markets) */
export const NEG_RISK_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
/** NegRisk Adapter */
export const NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';

// =============================================================================
// API KEY DERIVATION (L1 Auth → L2 Credentials)
// =============================================================================

/**
 * EIP-712 domain for CLOB authentication (NOT the same as the order domain).
 *
 * Official: { name: "ClobAuthDomain", version: "1", chainId: 137 }
 * Note: No verifyingContract for auth domain.
 */
const CLOB_AUTH_DOMAIN_TYPE =
  'EIP712Domain(string name,string version,uint256 chainId)';
const CLOB_AUTH_NAME = 'ClobAuthDomain';
const CLOB_AUTH_VERSION = '1';
const CHAIN_ID = 137;

const CLOB_AUTH_TYPE =
  'ClobAuth(address address,string timestamp,uint256 nonce,string message)';
const AUTH_MESSAGE = 'This message attests that I control the given wallet';

function keccak256(data: Buffer | Uint8Array): string {
  return bytesToHex(keccak_256(data));
}

function encodeUint256(value: number | bigint): string {
  return BigInt(value).toString(16).padStart(64, '0');
}

function encodeAddress(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, '0');
}

function hashAuthDomain(): string {
  const typeHash = Buffer.from(keccak256(Buffer.from(CLOB_AUTH_DOMAIN_TYPE)), 'hex');
  const nameHash = Buffer.from(keccak256(Buffer.from(CLOB_AUTH_NAME)), 'hex');
  const versionHash = Buffer.from(keccak256(Buffer.from(CLOB_AUTH_VERSION)), 'hex');
  const chainIdHex = CHAIN_ID.toString(16).padStart(64, '0');

  const encoded = Buffer.concat([
    typeHash,
    nameHash,
    versionHash,
    Buffer.from(chainIdHex, 'hex'),
  ]);

  return '0x' + keccak256(encoded);
}

function hashAuthMessage(address: string, timestamp: string, nonce: number): string {
  const typeHash = Buffer.from(keccak256(Buffer.from(CLOB_AUTH_TYPE)), 'hex');

  const encoded = Buffer.concat([
    typeHash,
    Buffer.from(encodeAddress(address), 'hex'),
    Buffer.from(keccak256(Buffer.from(timestamp)), 'hex'),
    Buffer.from(encodeUint256(nonce), 'hex'),
    Buffer.from(keccak256(Buffer.from(AUTH_MESSAGE)), 'hex'),
  ]);

  return '0x' + keccak256(encoded);
}

function signHash(hash: string, privateKey: string): string {
  const keyBytes = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  const hashBytes = hexToBytes(hash.startsWith('0x') ? hash.slice(2) : hash);

  const sig = secp256k1.sign(hashBytes, keyBytes);
  const r = sig.r.toString(16).padStart(64, '0');
  const s = sig.s.toString(16).padStart(64, '0');
  const v = sig.recovery + 27;

  return '0x' + r + s + v.toString(16).padStart(2, '0');
}

function deriveAddress(privateKey: string): string {
  const keyHex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  const pubKey = secp256k1.getPublicKey(keyHex, false).slice(1);
  const hash = keccak256(pubKey);
  return '0x' + hash.slice(-40);
}

function buildL1AuthHeaders(
  privateKey: string,
  nonce: number = 0,
): { address: string; headers: Record<string, string> } {
  const address = deriveAddress(privateKey);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const domainSep = hashAuthDomain();
  const structHash = hashAuthMessage(address, timestamp, nonce);

  const digest = '0x' + keccak256(Buffer.concat([
    Buffer.from([0x19, 0x01]),
    Buffer.from(domainSep.slice(2), 'hex'),
    Buffer.from(structHash.slice(2), 'hex'),
  ]));

  const signature = signHash(digest, privateKey);

  return {
    address,
    headers: {
      'POLY-ADDRESS': address,
      'POLY-SIGNATURE': signature,
      'POLY-TIMESTAMP': timestamp,
      'POLY-NONCE': nonce.toString(),
    },
  };
}

export interface ApiKeyCreds {
  apiKey: string;
  secret: string;
  passphrase: string;
}

/**
 * Create a new API key or derive an existing one.
 *
 * Matches the official clob-client `createOrDeriveApiKey()` flow:
 *   1. POST /auth/api-key (create new)
 *   2. If empty response, GET /auth/derive-api-key (re-derive existing)
 */
export async function createOrDeriveApiKey(
  privateKey: string,
  nonce: number = 0,
): Promise<ApiKeyCreds> {
  const { address, headers } = buildL1AuthHeaders(privateKey, nonce);

  // Try creating a new key first
  const createUrl = `${CLOB_URL}/auth/api-key`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
  });

  if (createRes.ok) {
    const data = (await createRes.json()) as { apiKey?: string; key?: string; secret?: string; passphrase?: string };
    const key = data.apiKey || data.key;
    if (key && data.secret) {
      return { apiKey: key, secret: data.secret, passphrase: data.passphrase || '' };
    }
  }

  // Fall back to deriving existing key
  const deriveUrl = `${CLOB_URL}/auth/derive-api-key`;
  const deriveRes = await fetch(deriveUrl, {
    method: 'GET',
    headers,
  });

  if (!deriveRes.ok) {
    const error = await deriveRes.text();
    throw new Error(`Failed to derive API key: HTTP ${deriveRes.status} — ${error}`);
  }

  const data = (await deriveRes.json()) as { apiKey?: string; key?: string; secret?: string; passphrase?: string };
  const key = data.apiKey || data.key;
  if (!key || !data.secret) {
    throw new Error('API key derivation returned empty credentials');
  }

  return { apiKey: key, secret: data.secret, passphrase: data.passphrase || '' };
}

// =============================================================================
// TOKEN APPROVALS
// =============================================================================

/**
 * ERC-20 approve(address spender, uint256 amount) selector
 */
const ERC20_APPROVE_SELECTOR = '095ea7b3';

/**
 * ERC-1155 setApprovalForAll(address operator, bool approved) selector
 */
const ERC1155_SET_APPROVAL_SELECTOR = 'a22cb465';

/** MaxUint256 for unlimited approval */
const MAX_UINT256 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

export interface ApprovalTx {
  to: string;
  data: string;
  description: string;
}

/**
 * Generate the list of approval transactions needed for trading.
 *
 * Standard markets need 3 approvals, negRisk markets need 4 more (7 total).
 * These must be sent from the funder address (proxy wallet for types 1/2, EOA for type 0).
 *
 * Returns raw transaction data — caller handles signing and sending via RPC.
 */
export function getRequiredApprovals(options?: { includeNegRisk?: boolean }): ApprovalTx[] {
  const txs: ApprovalTx[] = [
    // Standard market approvals (3)
    {
      to: USDC_ADDRESS,
      data: `0x${ERC20_APPROVE_SELECTOR}${encodeAddress(CTF_ADDRESS)}${MAX_UINT256}`,
      description: 'Approve USDC → Conditional Tokens contract',
    },
    {
      to: USDC_ADDRESS,
      data: `0x${ERC20_APPROVE_SELECTOR}${encodeAddress(CTF_EXCHANGE)}${MAX_UINT256}`,
      description: 'Approve USDC → CTF Exchange',
    },
    {
      to: CTF_ADDRESS,
      data: `0x${ERC1155_SET_APPROVAL_SELECTOR}${encodeAddress(CTF_EXCHANGE)}${'0'.repeat(63)}1`,
      description: 'Approve CTF tokens → CTF Exchange (setApprovalForAll)',
    },
  ];

  if (options?.includeNegRisk) {
    txs.push(
      {
        to: USDC_ADDRESS,
        data: `0x${ERC20_APPROVE_SELECTOR}${encodeAddress(NEG_RISK_ADAPTER)}${MAX_UINT256}`,
        description: 'Approve USDC → NegRisk Adapter',
      },
      {
        to: USDC_ADDRESS,
        data: `0x${ERC20_APPROVE_SELECTOR}${encodeAddress(NEG_RISK_EXCHANGE)}${MAX_UINT256}`,
        description: 'Approve USDC → NegRisk Exchange',
      },
      {
        to: CTF_ADDRESS,
        data: `0x${ERC1155_SET_APPROVAL_SELECTOR}${encodeAddress(NEG_RISK_EXCHANGE)}${'0'.repeat(63)}1`,
        description: 'Approve CTF tokens → NegRisk Exchange (setApprovalForAll)',
      },
      {
        to: CTF_ADDRESS,
        data: `0x${ERC1155_SET_APPROVAL_SELECTOR}${encodeAddress(NEG_RISK_ADAPTER)}${'0'.repeat(63)}1`,
        description: 'Approve CTF tokens → NegRisk Adapter (setApprovalForAll)',
      },
    );
  }

  return txs;
}

/**
 * Check if a specific ERC-20 approval is already set.
 * Returns the current allowance in raw units.
 */
export async function checkErc20Allowance(
  rpcUrl: string,
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
): Promise<bigint> {
  // allowance(address owner, address spender) selector: 0xdd62ed3e
  const data = `0xdd62ed3e${encodeAddress(ownerAddress)}${encodeAddress(spenderAddress)}`;

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: tokenAddress, data }, 'latest'],
      id: 1,
    }),
  });

  const json = (await res.json()) as { result?: string };
  return BigInt(json.result || '0x0');
}

/**
 * Check if ERC-1155 approval is set (isApprovedForAll).
 */
export async function checkErc1155Approval(
  rpcUrl: string,
  tokenAddress: string,
  ownerAddress: string,
  operatorAddress: string,
): Promise<boolean> {
  // isApprovedForAll(address account, address operator) selector: 0xe985e9c5
  const data = `0xe985e9c5${encodeAddress(ownerAddress)}${encodeAddress(operatorAddress)}`;

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: tokenAddress, data }, 'latest'],
      id: 1,
    }),
  });

  const json = (await res.json()) as { result?: string };
  return BigInt(json.result || '0x0') !== 0n;
}

export interface ApprovalStatus {
  description: string;
  approved: boolean;
}

/**
 * Check all required approvals for a given wallet.
 * Returns which approvals are missing.
 */
export async function checkAllApprovals(
  rpcUrl: string,
  walletAddress: string,
  options?: { includeNegRisk?: boolean },
): Promise<ApprovalStatus[]> {
  const results: ApprovalStatus[] = [];

  // Minimum allowance considered "approved" (at least 1000 USDC worth = 1000 * 10^6)
  const minAllowance = 1000n * 1000000n;

  // Standard ERC-20 approvals
  const usdcToCtf = await checkErc20Allowance(rpcUrl, USDC_ADDRESS, walletAddress, CTF_ADDRESS);
  results.push({ description: 'USDC → CTF contract', approved: usdcToCtf >= minAllowance });

  const usdcToExchange = await checkErc20Allowance(rpcUrl, USDC_ADDRESS, walletAddress, CTF_EXCHANGE);
  results.push({ description: 'USDC → CTF Exchange', approved: usdcToExchange >= minAllowance });

  // Standard ERC-1155 approval
  const ctfToExchange = await checkErc1155Approval(rpcUrl, CTF_ADDRESS, walletAddress, CTF_EXCHANGE);
  results.push({ description: 'CTF → CTF Exchange', approved: ctfToExchange });

  if (options?.includeNegRisk) {
    const usdcToAdapter = await checkErc20Allowance(rpcUrl, USDC_ADDRESS, walletAddress, NEG_RISK_ADAPTER);
    results.push({ description: 'USDC → NegRisk Adapter', approved: usdcToAdapter >= minAllowance });

    const usdcToNegExchange = await checkErc20Allowance(rpcUrl, USDC_ADDRESS, walletAddress, NEG_RISK_EXCHANGE);
    results.push({ description: 'USDC → NegRisk Exchange', approved: usdcToNegExchange >= minAllowance });

    const ctfToNegExchange = await checkErc1155Approval(rpcUrl, CTF_ADDRESS, walletAddress, NEG_RISK_EXCHANGE);
    results.push({ description: 'CTF → NegRisk Exchange', approved: ctfToNegExchange });

    const ctfToAdapter = await checkErc1155Approval(rpcUrl, CTF_ADDRESS, walletAddress, NEG_RISK_ADAPTER);
    results.push({ description: 'CTF → NegRisk Adapter', approved: ctfToAdapter });
  }

  return results;
}
