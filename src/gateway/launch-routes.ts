/**
 * Launch API Routes — REST endpoints for one-call Solana token launches.
 *
 * Mounted as an Express Router via httpGateway.setLaunchRouter().
 * All endpoints are prefixed with /api/launch by the caller.
 *
 * Built on Meteora Dynamic Bonding Curves with automatic graduation
 * to DAMM v2 AMM. 90/10 fee split — creator keeps 90%.
 */

import { Router, type Request, type Response } from 'express';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../utils/logger.js';
import { getRegistryService } from '../acp/registry.js';

// ── Launch Registry (persisted to disk) ─────────────────────────────────────

interface LaunchRecord {
  /** Unique launch ID (incrementing) */
  id: number;
  /** Token mint address */
  mint: string;
  /** Bonding curve pool address */
  pool: string;
  /** Token name */
  name: string;
  /** Token symbol */
  symbol: string;
  /** Token description */
  description?: string;
  /** Creator wallet address */
  creatorWallet: string;
  /** Registered Clodds agent ID that launched this token */
  agentId: string;
  /** Creator fee % */
  creatorFeePercent: number;
  /** Graduation market cap in SOL */
  graduationMarketCap: number;
  /** ISO timestamp of launch */
  launchedAt: string;
  /** Solscan explorer URL */
  explorer: string;
  /** Image URL (if provided) */
  imageUrl?: string;
  /** Website URL (if provided) */
  website?: string;
  /** Twitter handle (if provided) */
  twitter?: string;
  /** Telegram handle (if provided) */
  telegram?: string;
  /** Wallets authorized to claim fees on behalf of the creator */
  feeDelegates?: string[];
}

const STATE_DIR = process.env.CLODDS_STATE_DIR || join(process.cwd(), '.clodds');
const LAUNCHES_FILE = join(STATE_DIR, 'launches.json');

function loadLaunches(): LaunchRecord[] {
  try {
    if (existsSync(LAUNCHES_FILE)) {
      return JSON.parse(readFileSync(LAUNCHES_FILE, 'utf-8'));
    }
  } catch {
    logger.warn('Launch registry: Failed to load launches.json, starting fresh');
  }
  return [];
}

function saveLaunches(launches: LaunchRecord[]): void {
  try {
    const dir = dirname(LAUNCHES_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(LAUNCHES_FILE, JSON.stringify(launches, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Launch registry: Failed to save launches.json');
  }
}

const launchRegistry: LaunchRecord[] = loadLaunches();

// ── Types ────────────────────────────────────────────────────────────────────

export interface LaunchRequest {
  /** Token name (max 32 chars) */
  name: string;
  /** Token ticker/symbol (max 10 chars) */
  symbol: string;
  /** Token description */
  description?: string;
  /** Metadata URI (IPFS/Arweave). If not provided, uploads via image + description. */
  uri?: string;
  /** Image URL for metadata (used if no uri provided) */
  imageUrl?: string;
  /** Twitter handle for token metadata */
  twitter?: string;
  /** Telegram handle for token metadata */
  telegram?: string;
  /** Website URL for token metadata */
  website?: string;
  /** Creator wallet address — receives fee claims and is set as feeClaimer/leftoverReceiver */
  creatorWallet?: string;
  /** Initial market cap in SOL (default: 30) */
  initialMarketCap?: number;
  /** Market cap in SOL at which pool graduates to AMM (default: 500) */
  graduationMarketCap?: number;
  /** Total token supply (default: 1,000,000,000) */
  totalSupply?: number;
  /** Token decimals: 6, 7, 8, or 9 (default: 6) */
  decimals?: number;
  /** Creator trading fee % — creator's share of trading fees (default: 90) */
  creatorFeePercent?: number;
  /** Starting fee in bps for anti-sniper protection (default: 500 = 5%) */
  antiSniperFeeBps?: number;
  /** Ending fee in bps after decay period (default: 100 = 1%) */
  endingFeeBps?: number;
  /** Anti-sniper fee decay period in seconds (default: 3600 = 1 hour) */
  feeDecayDurationSec?: number;
  /** Initial buy amount in SOL (optional — creator buys at launch) */
  initialBuySol?: number;
  /** Slippage tolerance in bps for initial buy (default: 500 = 5%) */
  slippageBps?: number;
  /** Use Token2022 standard instead of SPL (default: false) */
  token2022?: boolean;
}

export interface LaunchResponse {
  /** Token mint address */
  mint: string;
  /** Bonding curve pool address */
  pool: string;
  /** Config address */
  config: string;
  /** Transaction signature(s) */
  signatures: string[];
  /** Solscan link */
  explorer: string;
  /** Fee split description */
  feeSplit: string;
  /** Graduation target */
  graduationMarketCap: number;
  /** Creator wallet that receives fees (if provided) */
  creatorWallet: string;
}

// ── IPFS / Metadata ──────────────────────────────────────────────────────────

/**
 * Build a minimal JSON metadata blob and upload to a public IPFS gateway.
 * Falls back through multiple providers so we don't depend on any single service.
 */
async function uploadMetadata(params: {
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}): Promise<string> {
  // Build standard SPL token metadata JSON (Metaplex-compatible)
  const metadata: Record<string, unknown> = {
    name: params.name,
    symbol: params.symbol,
    description: params.description ?? params.name,
    showName: true,
  };
  if (params.imageUrl) metadata.image = params.imageUrl;
  if (params.twitter) metadata.twitter = params.twitter;
  if (params.telegram) metadata.telegram = params.telegram;
  if (params.website) {
    metadata.website = params.website;
    metadata.external_url = params.website;
  }

  // Strategy: try multiple IPFS upload services in order
  const providers = [
    uploadViaPumpFun,
    uploadViaNftStorage,
  ];

  for (const provider of providers) {
    try {
      const uri = await provider(params, metadata);
      if (uri) return uri;
    } catch (err) {
      logger.warn({ err, provider: provider.name }, 'Launch API: IPFS provider failed, trying next');
    }
  }

  throw new Error('All metadata upload providers failed. Provide a pre-uploaded uri instead.');
}

/** Upload via pump.fun IPFS (fast, free, but third-party) */
async function uploadViaPumpFun(params: {
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}, _metadata?: Record<string, unknown>): Promise<string> {
  const formData = new FormData();
  formData.append('name', params.name);
  formData.append('symbol', params.symbol);
  formData.append('description', params.description ?? params.name);
  if (params.twitter) formData.append('twitter', params.twitter);
  if (params.telegram) formData.append('telegram', params.telegram);
  if (params.website) formData.append('website', params.website);
  formData.append('showName', 'true');

  if (params.imageUrl) {
    const imgBlob = await fetchImageSafe(params.imageUrl);
    if (imgBlob) formData.append('file', imgBlob, 'image.png');
  }

  const response = await fetch('https://pump.fun/api/ipfs', {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) return '';
  const result = await response.json() as { metadataUri?: string };
  return result.metadataUri ?? '';
}

/** Upload via nft.storage (decentralized, free tier) */
async function uploadViaNftStorage(
  _params: Record<string, unknown>,
  metadata: Record<string, unknown>
): Promise<string> {
  const nftStorageKey = process.env.NFT_STORAGE_API_KEY;
  if (!nftStorageKey) return '';

  const response = await fetch('https://api.nft.storage/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${nftStorageKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) return '';
  const result = await response.json() as { value?: { cid?: string } };
  const cid = result.value?.cid;
  return cid ? `https://nftstorage.link/ipfs/${cid}` : '';
}

/**
 * Safely fetch an image URL. Blocks internal/private IPs to prevent SSRF.
 */
async function fetchImageSafe(url: string): Promise<Blob | null> {
  try {
    const parsed = new URL(url);

    // Block non-HTTP(S) schemes
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

    // Block internal hostnames
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname.startsWith('169.254.')
    ) {
      logger.warn({ url }, 'Launch API: Blocked SSRF attempt on imageUrl');
      return null;
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    if (!response.ok) return null;

    // Cap image size at 10MB
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) return null;

    return await response.blob();
  } catch {
    return null;
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

const VALID_DECIMALS = new Set([6, 7, 8, 9]);

function validateLaunchRequest(body: unknown): { valid: true; params: LaunchRequest } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;

  // Required fields
  if (!b.name || typeof b.name !== 'string') {
    return { valid: false, error: 'Required: name (string, max 32 chars)' };
  }
  if (b.name.length > 32) {
    return { valid: false, error: 'name must be 32 characters or fewer' };
  }
  if (!b.symbol || typeof b.symbol !== 'string') {
    return { valid: false, error: 'Required: symbol (string, max 10 chars)' };
  }
  if (b.symbol.length > 10) {
    return { valid: false, error: 'symbol must be 10 characters or fewer' };
  }
  if (!b.uri && !b.imageUrl && !b.description) {
    return { valid: false, error: 'Provide either uri (metadata URI) or imageUrl + description for auto-upload' };
  }

  // Validate creatorWallet is a valid Solana pubkey
  if (b.creatorWallet !== undefined) {
    if (typeof b.creatorWallet !== 'string') {
      return { valid: false, error: 'creatorWallet must be a string (Solana public key)' };
    }
    try {
      new PublicKey(b.creatorWallet as string);
    } catch {
      return { valid: false, error: 'creatorWallet is not a valid Solana public key' };
    }
  }

  // Numeric fields — check both type AND NaN (typeof NaN === 'number' trap)
  if (b.initialMarketCap !== undefined) {
    if (typeof b.initialMarketCap !== 'number' || Number.isNaN(b.initialMarketCap) || b.initialMarketCap <= 0) {
      return { valid: false, error: 'initialMarketCap must be a positive number (SOL)' };
    }
  }
  if (b.graduationMarketCap !== undefined) {
    if (typeof b.graduationMarketCap !== 'number' || Number.isNaN(b.graduationMarketCap) || b.graduationMarketCap <= 0) {
      return { valid: false, error: 'graduationMarketCap must be a positive number (SOL)' };
    }
  }

  // graduationMarketCap must be > initialMarketCap
  const initMcap = (typeof b.initialMarketCap === 'number' && !Number.isNaN(b.initialMarketCap)) ? b.initialMarketCap : 30;
  const gradMcap = (typeof b.graduationMarketCap === 'number' && !Number.isNaN(b.graduationMarketCap)) ? b.graduationMarketCap : 500;
  if (gradMcap <= initMcap) {
    return { valid: false, error: `graduationMarketCap (${gradMcap}) must be greater than initialMarketCap (${initMcap})` };
  }

  if (b.totalSupply !== undefined) {
    if (typeof b.totalSupply !== 'number' || Number.isNaN(b.totalSupply) || b.totalSupply <= 0 || !Number.isFinite(b.totalSupply)) {
      return { valid: false, error: 'totalSupply must be a positive finite number' };
    }
  }
  if (b.decimals !== undefined) {
    if (typeof b.decimals !== 'number' || !VALID_DECIMALS.has(b.decimals)) {
      return { valid: false, error: 'decimals must be 6, 7, 8, or 9' };
    }
  }
  if (b.creatorFeePercent !== undefined) {
    if (typeof b.creatorFeePercent !== 'number' || Number.isNaN(b.creatorFeePercent) || b.creatorFeePercent < 0 || b.creatorFeePercent > 100) {
      return { valid: false, error: 'creatorFeePercent must be 0-100' };
    }
  }
  if (b.antiSniperFeeBps !== undefined) {
    if (typeof b.antiSniperFeeBps !== 'number' || Number.isNaN(b.antiSniperFeeBps) || b.antiSniperFeeBps < 0 || b.antiSniperFeeBps > 10000) {
      return { valid: false, error: 'antiSniperFeeBps must be 0-10000' };
    }
  }
  if (b.endingFeeBps !== undefined) {
    if (typeof b.endingFeeBps !== 'number' || Number.isNaN(b.endingFeeBps) || b.endingFeeBps < 0 || b.endingFeeBps > 10000) {
      return { valid: false, error: 'endingFeeBps must be 0-10000' };
    }
  }
  if (b.feeDecayDurationSec !== undefined) {
    if (typeof b.feeDecayDurationSec !== 'number' || Number.isNaN(b.feeDecayDurationSec) || b.feeDecayDurationSec < 0) {
      return { valid: false, error: 'feeDecayDurationSec must be a non-negative number' };
    }
  }
  if (b.initialBuySol !== undefined) {
    if (typeof b.initialBuySol !== 'number' || Number.isNaN(b.initialBuySol) || b.initialBuySol < 0) {
      return { valid: false, error: 'initialBuySol must be a non-negative number' };
    }
  }
  if (b.slippageBps !== undefined) {
    if (typeof b.slippageBps !== 'number' || Number.isNaN(b.slippageBps) || b.slippageBps < 0 || b.slippageBps > 10000) {
      return { valid: false, error: 'slippageBps must be 0-10000' };
    }
  }

  // antiSniper starting fee should be >= ending fee
  const startFee = typeof b.antiSniperFeeBps === 'number' ? b.antiSniperFeeBps : 500;
  const endFee = typeof b.endingFeeBps === 'number' ? b.endingFeeBps : 100;
  if (endFee > startFee) {
    return { valid: false, error: `endingFeeBps (${endFee}) cannot be greater than antiSniperFeeBps (${startFee})` };
  }

  return { valid: true, params: b as unknown as LaunchRequest };
}

// ── SOL conversion helper ────────────────────────────────────────────────────

/**
 * Convert SOL to lamports using string math to avoid floating-point precision loss.
 * e.g. 1.5 SOL -> "1500000000"
 */
function solToLamports(sol: number): string {
  const str = sol.toFixed(9); // max 9 decimal places for lamports
  const [whole, frac = ''] = str.split('.');
  const padded = frac.padEnd(9, '0').slice(0, 9);
  const raw = (whole + padded).replace(/^0+/, '') || '0';
  return raw;
}

// ── Router factory ───────────────────────────────────────────────────────────

export function createLaunchRouter(connection: Connection, keypair: Keypair): Router {
  const router = Router();

  // ── GET /api/launch/info ─────────────────────────────────────────────────
  // Service info + pricing (free, no auth)
  router.get('/info', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      data: {
        service: 'Clodds Launch API',
        version: '1.0.0',
        description: 'One-call Solana token launches with bonding curves and automatic AMM graduation.',
        feeSplit: '90/10 — creator keeps 90% of trading fees',
        chain: 'Solana',
        technology: 'Meteora Dynamic Bonding Curves → DAMM v2 AMM',
        features: [
          'One API call to launch a token',
          '90/10 fee split (creator keeps 90%)',
          'Anti-sniper fee protection (decaying high fees at launch)',
          'Automatic AMM graduation at target market cap',
          'Optional initial creator buy at launch with slippage protection',
          'SPL and Token2022 support',
          'Auto metadata upload (or bring your own URI)',
          'Creator wallet support — fees go to your wallet',
          'Configurable bonding curve parameters',
        ],
        defaults: {
          initialMarketCap: '30 SOL',
          graduationMarketCap: '500 SOL',
          totalSupply: '1,000,000,000',
          decimals: 6,
          creatorFeePercent: 90,
          antiSniperFeeBps: 500,
          endingFeeBps: 100,
          feeDecayDuration: '1 hour',
          slippageBps: 500,
        },
        pricing: {
          launchFee: '$1.00 USDC (via x402)',
          swapFee: '$0.10 USDC (via x402)',
          claimFees: '$0.10 USDC (via x402)',
          statusCheck: 'free',
          quoteCheck: 'free',
        },
        exampleRequest: {
          name: 'My Token',
          symbol: 'MTK',
          description: 'A token launched via Clodds',
          imageUrl: 'https://example.com/logo.png',
          creatorWallet: '<your-solana-pubkey>',
          initialBuySol: 0.5,
        },
      },
    });
  });

  // ── GET /api/launch/list ────────────────────────────────────────────────
  // Public directory of all tokens launched via Clodds (free, no auth)
  router.get('/list', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      data: {
        total: launchRegistry.length,
        launches: launchRegistry.slice().reverse(), // newest first
      },
    });
  });

  // ── POST /api/launch/token ───────────────────────────────────────────────
  // Launch a token — requires a registered Clodds agent
  router.post('/token', async (req: Request, res: Response) => {
    // ── Agent gate: only registered Clodds agents can launch ──────────
    const agentId = (req.headers['x-agent-id'] as string) ?? req.body?.agentId;
    if (!agentId || typeof agentId !== 'string') {
      res.status(401).json({
        ok: false,
        error: 'Launching requires a registered Clodds agent. Provide agentId in request body or X-Agent-Id header.',
      });
      return;
    }

    let agentProfile;
    try {
      const registry = getRegistryService();
      agentProfile = await registry.getAgent(agentId);
    } catch {
      // Registry not initialized yet — fall through
    }

    if (!agentProfile || agentProfile.status !== 'active') {
      res.status(403).json({
        ok: false,
        error: `Agent "${agentId}" is not a registered active Clodds agent. Register at /api/acp/agents first.`,
      });
      return;
    }

    const validation = validateLaunchRequest(req.body);
    if (!validation.valid) {
      res.status(400).json({ ok: false, error: (validation as { valid: false; error: string }).error });
      return;
    }

    const params = (validation as { valid: true; params: LaunchRequest }).params;

    try {
      // Step 1: Resolve metadata URI
      let uri = params.uri;
      if (!uri) {
        logger.info({ name: params.name, symbol: params.symbol }, 'Launch API: Uploading metadata');
        uri = await uploadMetadata({
          name: params.name,
          symbol: params.symbol,
          description: params.description,
          imageUrl: params.imageUrl,
          twitter: params.twitter,
          telegram: params.telegram,
          website: params.website,
        });
      }

      // Step 2: Build bonding curve config
      const creatorFee = params.creatorFeePercent ?? 90;
      const graduationMcap = params.graduationMarketCap ?? 500;
      const creatorWallet = params.creatorWallet ?? keypair.publicKey.toBase58();

      const config = {
        totalTokenSupply: params.totalSupply ?? 1_000_000_000,
        tokenDecimals: params.decimals ?? 6,
        initialMarketCap: params.initialMarketCap ?? 30,
        migrationMarketCap: graduationMcap,
        migrationOption: 1, // DAMM v2
        startingFeeBps: params.antiSniperFeeBps ?? 500,
        endingFeeBps: params.endingFeeBps ?? 100,
        feeDecayPeriods: 10,
        feeDecayDurationSec: params.feeDecayDurationSec ?? 3600,
        dynamicFeeEnabled: true,
        creatorTradingFeePercent: creatorFee,
        creatorLiquidityPct: 5,
        creatorLockedPct: 45,
        partnerLiquidityPct: 0,
        partnerLockedPct: 50,
        tokenType: params.token2022 ? 1 : 0,
        collectFeeMode: 0,
        migrationFeeOption: 6,
        migrationFeePercentage: 15,
        creatorMigrationFeePercentage: 50,
        // Route fees to the creator's wallet, not the server
        feeClaimer: creatorWallet,
        leftoverReceiver: creatorWallet,
      };

      // Step 3: Launch token
      let result: { baseMint: string; poolAddress: string; configAddress: string; signatures: string[] };

      if (params.initialBuySol && params.initialBuySol > 0) {
        const { createDbcPoolWithFirstBuy } = await import('../solana/meteora-dbc.js');
        const buyLamports = solToLamports(params.initialBuySol);

        const r = await createDbcPoolWithFirstBuy(connection, keypair, {
          name: params.name,
          symbol: params.symbol,
          uri,
          config,
          buyAmountLamports: buyLamports,
        });
        result = { ...r, signatures: r.signatures };
      } else {
        const { createDbcPool } = await import('../solana/meteora-dbc.js');
        const r = await createDbcPool(connection, keypair, {
          name: params.name,
          symbol: params.symbol,
          uri,
          config,
        });
        result = { ...r, signatures: [r.signature] };
      }

      const response: LaunchResponse = {
        mint: result.baseMint,
        pool: result.poolAddress,
        config: result.configAddress,
        signatures: result.signatures,
        explorer: `https://solscan.io/token/${result.baseMint}`,
        feeSplit: `${creatorFee}/${100 - creatorFee} — creator keeps ${creatorFee}%`,
        graduationMarketCap: graduationMcap,
        creatorWallet,
      };

      // Record in public launch registry
      const record: LaunchRecord = {
        id: launchRegistry.length + 1,
        mint: result.baseMint,
        pool: result.poolAddress,
        name: params.name,
        symbol: params.symbol,
        description: params.description,
        creatorWallet,
        agentId,
        creatorFeePercent: creatorFee,
        graduationMarketCap: graduationMcap,
        launchedAt: new Date().toISOString(),
        explorer: `https://solscan.io/token/${result.baseMint}`,
        imageUrl: params.imageUrl,
        website: params.website,
        twitter: params.twitter,
        telegram: params.telegram,
        feeDelegates: [],
      };
      launchRegistry.push(record);
      saveLaunches(launchRegistry);

      logger.info({
        launchId: record.id,
        mint: result.baseMint,
        pool: result.poolAddress,
        name: params.name,
        symbol: params.symbol,
        creatorFee,
        creatorWallet,
      }, 'Launch API: Token launched successfully');

      res.json({ ok: true, data: { ...response, launchId: record.id } });
    } catch (err) {
      logger.warn({ err, name: params.name, symbol: params.symbol }, 'Launch API: Token launch failed');
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  // ── GET /api/launch/status/:mint ─────────────────────────────────────────
  // Check pool status, graduation progress, fees (free)
  router.get('/status/:mint', async (req: Request, res: Response) => {
    const { mint } = req.params;
    if (!mint || typeof mint !== 'string') {
      res.status(400).json({ ok: false, error: 'Required: mint address in URL' });
      return;
    }

    // Validate it looks like a base58 pubkey (32-44 chars, no special chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      res.status(400).json({ ok: false, error: 'Invalid mint address format' });
      return;
    }

    try {
      const { getDbcPoolStatus } = await import('../solana/meteora-dbc.js');
      const status = await getDbcPoolStatus(connection, mint);

      if (!status.found) {
        res.status(404).json({ ok: false, error: 'Pool not found for this mint' });
        return;
      }

      res.json({
        ok: true,
        data: {
          mint,
          pool: status.poolAddress,
          config: status.configAddress,
          creator: status.creator,
          graduated: status.isMigrated,
          graduationProgress: `${status.progressPercent}%`,
          quoteReserve: status.quoteReserve,
          migrationThreshold: status.migrationThreshold,
          fees: status.fees,
          explorer: `https://solscan.io/token/${mint}`,
        },
      });
    } catch (err) {
      logger.warn({ err, mint }, 'Launch API: Status check failed');
      res.status(500).json({ ok: false, error: 'Failed to fetch pool status' });
    }
  });

  // ── GET /api/launch/quote/:pool ──────────────────────────────────────────
  // Get a swap quote for a bonding curve pool (free)
  router.get('/quote/:pool', async (req: Request, res: Response) => {
    const { pool } = req.params;
    const { amountIn, side } = req.query;

    if (!pool || typeof pool !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pool)) {
      res.status(400).json({ ok: false, error: 'Required: valid pool address in URL' });
      return;
    }
    if (!amountIn || typeof amountIn !== 'string') {
      res.status(400).json({ ok: false, error: 'Required: amountIn query param (lamports)' });
      return;
    }

    const parsedAmount = parseInt(amountIn, 10);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0 || !Number.isFinite(parsedAmount)) {
      res.status(400).json({ ok: false, error: 'amountIn must be a positive integer (lamports)' });
      return;
    }

    try {
      const { getDbcSwapQuote } = await import('../solana/meteora-dbc.js');
      const quote = await getDbcSwapQuote(connection, {
        poolAddress: pool,
        amountIn: String(parsedAmount),
        swapBaseForQuote: side === 'sell',
      });

      res.json({ ok: true, data: quote });
    } catch (err) {
      logger.warn({ err, pool }, 'Launch API: Quote failed');
      res.status(500).json({ ok: false, error: 'Failed to get quote' });
    }
  });

  // ── POST /api/launch/swap ────────────────────────────────────────────────
  // Buy or sell on a bonding curve pool
  router.post('/swap', async (req: Request, res: Response) => {
    const { pool: poolAddress, amountIn, side, slippageBps } = req.body as {
      pool?: string;
      amountIn?: string;
      side?: 'buy' | 'sell';
      slippageBps?: number;
    };

    if (!poolAddress || typeof poolAddress !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(poolAddress)) {
      res.status(400).json({ ok: false, error: 'Required: pool (valid Solana address)' });
      return;
    }
    if (!amountIn || typeof amountIn !== 'string') {
      res.status(400).json({ ok: false, error: 'Required: amountIn (string, lamports)' });
      return;
    }
    if (!side || (side !== 'buy' && side !== 'sell')) {
      res.status(400).json({ ok: false, error: 'Required: side ("buy" or "sell")' });
      return;
    }

    const parsedAmount = parseInt(amountIn, 10);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0 || !Number.isFinite(parsedAmount)) {
      res.status(400).json({ ok: false, error: 'amountIn must be a positive integer (lamports)' });
      return;
    }

    // Slippage protection: default 5% (500 bps), require quote first for zero-slippage
    const slippage = (typeof slippageBps === 'number' && !Number.isNaN(slippageBps) && slippageBps >= 0)
      ? slippageBps
      : 500;

    try {
      // Get quote first to calculate minimumAmountOut with slippage
      const { getDbcSwapQuote, swapOnDbcPool } = await import('../solana/meteora-dbc.js');
      const quote = await getDbcSwapQuote(connection, {
        poolAddress,
        amountIn: String(parsedAmount),
        swapBaseForQuote: side === 'sell',
      });

      const expectedOut = BigInt(quote.amountOut || '0');
      const minOut = expectedOut - (expectedOut * BigInt(slippage) / 10000n);
      const minimumAmountOut = minOut > 0n ? minOut.toString() : '0';

      const result = await swapOnDbcPool(connection, keypair, {
        poolAddress,
        amountIn: String(parsedAmount),
        minimumAmountOut,
        swapBaseForQuote: side === 'sell',
      });

      res.json({
        ok: true,
        data: {
          signature: result.signature,
          direction: result.direction,
          expectedAmountOut: quote.amountOut,
          minimumAmountOut,
          slippageBps: slippage,
          explorer: `https://solscan.io/tx/${result.signature}`,
        },
      });
    } catch (err) {
      logger.warn({ err, pool: poolAddress, side }, 'Launch API: Swap failed');
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  // ── POST /api/launch/claim-fees ──────────────────────────────────────────
  // Claim creator trading fees — only the launching agent or a fee delegate
  router.post('/claim-fees', async (req: Request, res: Response) => {
    const { pool: poolAddress } = req.body as { pool?: string };
    const callerAgentId = (req.headers['x-agent-id'] as string) ?? req.body?.agentId;

    if (!poolAddress || typeof poolAddress !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(poolAddress)) {
      res.status(400).json({ ok: false, error: 'Required: pool (valid Solana address)' });
      return;
    }

    // Find the launch record for this pool
    const launch = launchRegistry.find((l) => l.pool === poolAddress);
    if (launch) {
      // Auth: only the creator agent or an authorized delegate can claim
      if (!callerAgentId || typeof callerAgentId !== 'string') {
        res.status(401).json({ ok: false, error: 'Provide agentId in request body or X-Agent-Id header to claim fees.' });
        return;
      }

      const isCreator = launch.agentId === callerAgentId;
      const isDelegate = launch.feeDelegates?.includes(callerAgentId) ?? false;

      // Also check if the caller's wallet address matches a delegate wallet
      let isDelegateByWallet = false;
      if (!isCreator && !isDelegate) {
        try {
          const registry = getRegistryService();
          const callerAgent = await registry.getAgent(callerAgentId);
          if (callerAgent && launch.feeDelegates?.includes(callerAgent.address)) {
            isDelegateByWallet = true;
          }
        } catch { /* registry unavailable */ }
      }

      if (!isCreator && !isDelegate && !isDelegateByWallet) {
        res.status(403).json({
          ok: false,
          error: `Only the creator agent (${launch.agentId}) or an authorized fee delegate can claim fees for this pool.`,
        });
        return;
      }
    }
    // If no launch record found (e.g. pre-registry launch), allow claim (backward compat)

    try {
      const { claimDbcCreatorFees } = await import('../solana/meteora-dbc.js');
      const result = await claimDbcCreatorFees(connection, keypair, poolAddress);

      res.json({
        ok: true,
        data: {
          signature: result.signature,
          explorer: `https://solscan.io/tx/${result.signature}`,
        },
      });
    } catch (err) {
      logger.warn({ err, pool: poolAddress }, 'Launch API: Fee claim failed');
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  // ── POST /api/launch/delegate ──────────────────────────────────────────
  // Add or remove a fee delegate for a launched token
  router.post('/delegate', async (req: Request, res: Response) => {
    const { pool: poolAddress, delegateId, action } = req.body as {
      pool?: string;
      delegateId?: string;
      action?: 'add' | 'remove';
    };
    const callerAgentId = (req.headers['x-agent-id'] as string) ?? req.body?.agentId;

    if (!poolAddress || typeof poolAddress !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(poolAddress)) {
      res.status(400).json({ ok: false, error: 'Required: pool (valid Solana address)' });
      return;
    }
    if (!delegateId || typeof delegateId !== 'string') {
      res.status(400).json({ ok: false, error: 'Required: delegateId (agent ID or wallet address to delegate to)' });
      return;
    }
    if (!callerAgentId || typeof callerAgentId !== 'string') {
      res.status(401).json({ ok: false, error: 'Provide agentId in request body or X-Agent-Id header.' });
      return;
    }

    const launch = launchRegistry.find((l) => l.pool === poolAddress);
    if (!launch) {
      res.status(404).json({ ok: false, error: 'No launch record found for this pool' });
      return;
    }

    // Only the creator agent can manage delegates
    if (launch.agentId !== callerAgentId) {
      res.status(403).json({
        ok: false,
        error: `Only the creator agent (${launch.agentId}) can manage fee delegates.`,
      });
      return;
    }

    if (!launch.feeDelegates) launch.feeDelegates = [];

    if (action === 'remove') {
      launch.feeDelegates = launch.feeDelegates.filter((d) => d !== delegateId);
      saveLaunches(launchRegistry);
      logger.info({ pool: poolAddress, delegateId, action }, 'Launch API: Fee delegate removed');
      res.json({ ok: true, data: { pool: poolAddress, feeDelegates: launch.feeDelegates } });
      return;
    }

    // Default action: add
    if (!launch.feeDelegates.includes(delegateId)) {
      launch.feeDelegates.push(delegateId);
      saveLaunches(launchRegistry);
      logger.info({ pool: poolAddress, delegateId, action: 'add' }, 'Launch API: Fee delegate added');
    }

    res.json({ ok: true, data: { pool: poolAddress, feeDelegates: launch.feeDelegates } });
  });

  logger.info('Launch API routes initialized');
  return router;
}
