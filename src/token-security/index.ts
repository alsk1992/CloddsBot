/**
 * Token Security Scanner - GoPlus API integration
 *
 * Provides honeypot detection, rug-pull analysis, holder concentration,
 * and risk scoring for EVM and Solana tokens.
 *
 * GoPlus API is free and requires no API key.
 */

import { logger } from '../utils/logger.js';

// =============================================================================
// TYPES
// =============================================================================

export interface TokenSecurityResult {
  address: string;
  chain: string;
  name?: string;
  symbol?: string;
  isHoneypot: boolean;
  hasProxyContract: boolean;
  hasMintFunction: boolean;
  hasBlacklist: boolean;
  isOpenSource: boolean;
  buyTax: number;
  sellTax: number;
  holderCount: number;
  top10HolderPct: number;
  creatorHolderPct: number;
  totalLiquidity: number;
  liquidityLocked: boolean;
  riskScore: number; // 0-100 (100 = safest)
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  riskFlags: string[];
  /** Optional second opinion from TokenGuard (Solana only, when TOKENGUARD_PARTNER_ID is set). */
  secondOpinion?: { source: 'TokenGuard'; verdict: string; score: number /* 0-100, 0 = safest */; reasons: string[]; url: string };
}

export interface TokenSecurityService {
  auditToken(address: string, chain: string): Promise<TokenSecurityResult>;
  auditSolanaToken(address: string): Promise<TokenSecurityResult>;
  auditEvmToken(address: string, chainId?: number): Promise<TokenSecurityResult>;
  isSafe(address: string, chain: string): Promise<boolean>;
}

// =============================================================================
// CHAIN ID MAP
// =============================================================================

const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1, eth: 1,
  bsc: 56, bnb: 56,
  polygon: 137, matic: 137,
  arbitrum: 42161, arb: 42161,
  optimism: 10, op: 10,
  avalanche: 43114, avax: 43114,
  fantom: 250, ftm: 250,
  base: 8453,
  linea: 59144,
  scroll: 534352,
  zksync: 324,
  mantle: 5000,
  blast: 81457,
};

// =============================================================================
// GOPLUS API
// =============================================================================

const GOPLUS_BASE = 'https://api.gopluslabs.io/api/v1';

async function fetchGoPlusEvm(address: string, chainId: number): Promise<Record<string, any>> {
  const url = `${GOPLUS_BASE}/token_security/${chainId}?contract_addresses=${address.toLowerCase()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GoPlus API error: ${res.status}`);
  const data = await res.json() as any;
  if (data.code !== 1) throw new Error(`GoPlus API error: ${data.message || 'unknown'}`);
  const result = data.result?.[address.toLowerCase()];
  if (!result) throw new Error(`No data found for token ${address} on chain ${chainId}`);
  return result;
}

async function fetchGoPlusSolana(address: string): Promise<Record<string, any>> {
  const url = `${GOPLUS_BASE}/solana/token_security?contract_addresses=${address}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GoPlus API error: ${res.status}`);
  const data = await res.json() as any;
  if (data.code !== 1) throw new Error(`GoPlus API error: ${data.message || 'unknown'}`);
  const result = data.result?.[address];
  if (!result) throw new Error(`No data found for Solana token ${address}`);
  return result;
}

// Optional second opinion for Solana from the free TokenGuard partner API (no key, no fee, attribution only).
// Adds what GoPlus does not cover on Solana: a simulated sell, pump.fun creator history and crash risk.
// Enabled only when TOKENGUARD_PARTNER_ID is set; never fails the audit (6 s timeout, ignored on error).
async function fetchTokenGuard(address: string): Promise<TokenSecurityResult['secondOpinion'] | undefined> {
  const pid = process.env.TOKENGUARD_PARTNER_ID;
  if (!pid) return undefined;
  try {
    const res = await fetch(`https://tokenguard-bot.vercel.app/api/p/${pid}/${address}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return undefined;
    const d = await res.json() as any;
    return { source: 'TokenGuard', verdict: d.verdict, score: d.risk_score, reasons: (d.reasons || []).map((x: any) => x.text), url: d.report_url };
  } catch {
    return undefined;
  }
}

// =============================================================================
// RISK SCORING
// =============================================================================

function computeRisk(flags: string[]): { score: number; level: TokenSecurityResult['riskLevel'] } {
  let score = 100;
  const deductions: Record<string, number> = {
    'Honeypot detected': 100,
    'Not open source': 30,
    'Has mint function': 20,
    'Has blacklist': 15,
    'High buy tax': 20,
    'High sell tax': 20,
    'Top 10 holders own >50%': 15,
    'Creator holds >10%': 10,
    'Low liquidity (<$10k)': 15,
    'Liquidity not locked': 10,
    'Has proxy contract': 10,
    'Can self-destruct': 25,
    'External call risk': 15,
    'Hidden owner': 20,
    'Can take back ownership': 20,
    'Anti-whale mechanism': 5,
    'Freeze authority active': 40,
    'Balances can be modified': 40,
    'Non-transferable token': 100,
    'Has transfer fee': 15,
    'Has transfer hook': 20,
    'Flagged DANGER by TokenGuard': 40,
  };
  for (const flag of flags) {
    score -= deductions[flag] ?? 5;
  }
  score = Math.max(0, Math.min(100, score));
  const level: TokenSecurityResult['riskLevel'] =
    score >= 80 ? 'safe' :
    score >= 60 ? 'low' :
    score >= 40 ? 'medium' :
    score >= 20 ? 'high' : 'critical';
  return { score, level };
}

// =============================================================================
// PARSE HELPERS
// =============================================================================

function num(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function bool1(val: any): boolean {
  return val === '1' || val === 1 || val === true;
}

function parseEvmResult(address: string, chainId: number, r: Record<string, any>): TokenSecurityResult {
  const flags: string[] = [];

  if (bool1(r.is_honeypot)) flags.push('Honeypot detected');
  if (!bool1(r.is_open_source)) flags.push('Not open source');
  if (bool1(r.is_mintable)) flags.push('Has mint function');
  if (bool1(r.is_blacklisted)) flags.push('Has blacklist');
  if (bool1(r.is_proxy)) flags.push('Has proxy contract');
  if (bool1(r.selfdestruct)) flags.push('Can self-destruct');
  if (bool1(r.external_call)) flags.push('External call risk');
  if (bool1(r.hidden_owner)) flags.push('Hidden owner');
  if (bool1(r.can_take_back_ownership)) flags.push('Can take back ownership');
  if (bool1(r.anti_whale_modifiable)) flags.push('Anti-whale mechanism');

  const buyTax = num(r.buy_tax) * 100;
  const sellTax = num(r.sell_tax) * 100;
  if (buyTax > 10) flags.push('High buy tax');
  if (sellTax > 10) flags.push('High sell tax');

  const holders = Array.isArray(r.holders) ? r.holders : [];
  const top10Pct = holders.slice(0, 10).reduce((s: number, h: any) => s + num(h.percent) * 100, 0);
  if (top10Pct > 50) flags.push('Top 10 holders own >50%');

  const creatorPct = num(r.creator_percent) * 100;
  if (creatorPct > 10) flags.push('Creator holds >10%');

  const liq = num(r.total_supply) * num(r.token_price) * 0.01; // rough estimate
  const lpHolders = Array.isArray(r.lp_holders) ? r.lp_holders : [];
  const locked = lpHolders.some((lp: any) => bool1(lp.is_locked));
  if (liq < 10000) flags.push('Low liquidity (<$10k)');
  if (!locked && lpHolders.length > 0) flags.push('Liquidity not locked');

  const { score, level } = computeRisk(flags);

  const chainName = Object.entries(CHAIN_ID_MAP).find(([, id]) => id === chainId)?.[0] ?? String(chainId);

  return {
    address,
    chain: chainName,
    name: r.token_name || undefined,
    symbol: r.token_symbol || undefined,
    isHoneypot: bool1(r.is_honeypot),
    hasProxyContract: bool1(r.is_proxy),
    hasMintFunction: bool1(r.is_mintable),
    hasBlacklist: bool1(r.is_blacklisted),
    isOpenSource: bool1(r.is_open_source),
    buyTax,
    sellTax,
    holderCount: num(r.holder_count),
    top10HolderPct: top10Pct,
    creatorHolderPct: creatorPct,
    totalLiquidity: liq,
    liquidityLocked: locked,
    riskScore: score,
    riskLevel: level,
    riskFlags: flags,
  };
}

function parseSolanaResult(address: string, r: Record<string, any>): TokenSecurityResult {
  const flags: string[] = [];

  // GoPlus Solana fields differ from EVM: authorities are { status: "0" | "1", authority: [] } objects,
  // there is no is_open_source / is_mintable / top_10_holder_rate / total_liquidity.
  const on = (v: any) => bool1(v?.status ?? v);
  const hasMint = on(r.mintable);
  const hasFreeze = on(r.freezable);
  if (hasMint) flags.push('Has mint function');
  if (hasFreeze) flags.push('Freeze authority active');
  if (on(r.balance_mutable_authority)) flags.push('Balances can be modified');
  if (bool1(r.non_transferable)) flags.push('Non-transferable token');
  if (r.transfer_fee && Object.keys(r.transfer_fee).length > 0) flags.push('Has transfer fee');
  if (Array.isArray(r.transfer_hook) && r.transfer_hook.length > 0) flags.push('Has transfer hook');

  const holders = Array.isArray(r.holders) ? r.holders : [];
  const top10Pct = holders.slice(0, 10).reduce((s: number, h: any) => s + num(h.percent) * 100, 0);
  if (top10Pct > 50) flags.push('Top 10 holders own >50%');

  const pools = Array.isArray(r.dex) ? r.dex : [];
  const liq = pools.reduce((s: number, d: any) => s + num(d.tvl), 0);
  if (pools.length > 0 && liq < 10000) flags.push('Low liquidity (<$10k)');

  const { score, level } = computeRisk(flags);

  return {
    address,
    chain: 'solana',
    name: r.metadata?.name || r.token_name || undefined,
    symbol: r.metadata?.symbol || r.token_symbol || undefined,
    // A frozen account or a non-transferable token cannot be sold: the closest Solana equivalent of a honeypot.
    isHoneypot: hasFreeze || bool1(r.non_transferable),
    hasProxyContract: false,
    hasMintFunction: hasMint,
    hasBlacklist: hasFreeze,
    isOpenSource: true, // SPL tokens all run the shared token program
    buyTax: 0,
    sellTax: 0,
    holderCount: num(r.holder_count),
    top10HolderPct: top10Pct,
    creatorHolderPct: 0,
    totalLiquidity: liq,
    liquidityLocked: false,
    riskScore: score,
    riskLevel: level,
    riskFlags: flags,
  };
}

// =============================================================================
// AUTO-DETECT CHAIN
// =============================================================================

function detectChain(address: string): 'solana' | 'evm' {
  if (address.startsWith('0x') && address.length === 42) return 'evm';
  // Base58 addresses (Solana) are 32-44 chars, no 0x prefix
  if (!address.startsWith('0x') && address.length >= 32 && address.length <= 44) return 'solana';
  // Default to EVM
  return 'evm';
}

// =============================================================================
// SERVICE FACTORY
// =============================================================================

export function createTokenSecurityService(): TokenSecurityService {
  return {
    async auditEvmToken(address: string, chainId = 1): Promise<TokenSecurityResult> {
      logger.info({ address, chainId }, 'Auditing EVM token');
      const raw = await fetchGoPlusEvm(address, chainId);
      return parseEvmResult(address, chainId, raw);
    },

    async auditSolanaToken(address: string): Promise<TokenSecurityResult> {
      logger.info({ address }, 'Auditing Solana token');
      const [raw, second] = await Promise.all([fetchGoPlusSolana(address), fetchTokenGuard(address)]);
      const result = parseSolanaResult(address, raw);
      if (second) {
        result.secondOpinion = second;
        if (second.verdict === 'DANGER') {
          result.riskFlags.push(`TokenGuard: DANGER (${second.reasons.join(', ') || 'see report'})`);
          const risk = computeRisk([...result.riskFlags.slice(0, -1), 'Flagged DANGER by TokenGuard']);
          result.riskScore = risk.score;
          result.riskLevel = risk.level;
        }
      }
      return result;
    },

    async auditToken(address: string, chain: string): Promise<TokenSecurityResult> {
      if (chain === 'solana' || chain === 'sol') {
        return this.auditSolanaToken(address);
      }
      const chainId = CHAIN_ID_MAP[chain.toLowerCase()] ?? 1;
      return this.auditEvmToken(address, chainId);
    },

    async isSafe(address: string, chain: string): Promise<boolean> {
      const result = await this.auditToken(address, chain);
      return result.riskLevel === 'safe' || result.riskLevel === 'low';
    },
  };
}
