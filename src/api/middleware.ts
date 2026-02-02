/**
 * x402 Payment Middleware
 *
 * Handles HTTP 402 Payment Required flow:
 * 1. Request arrives without payment
 * 2. Return 402 with payment details
 * 3. Client pays via x402 protocol
 * 4. Client retries with payment proof
 * 5. Verify payment and proceed
 */

import { EventEmitter } from 'eventemitter3';
import { createHash, randomBytes } from 'crypto';
import { logger } from '../utils/logger';
import type {
  X402PaymentConfig,
  PaymentProof,
  PricingTier,
  PricingConfig,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface X402MiddlewareConfig extends X402PaymentConfig {
  /** Pricing configuration */
  pricing?: PricingConfig;
  /** Payment verification timeout (default: 30000ms) */
  verificationTimeout?: number;
  /** Cache verified payments (default: true) */
  cachePayments?: boolean;
  /** Payment cache TTL (default: 300000ms = 5min) */
  cacheTtl?: number;
}

export interface X402Middleware {
  /** Check if request has valid payment */
  hasValidPayment(proof?: PaymentProof, requiredAmount?: number): Promise<boolean>;
  /** Generate 402 response headers */
  getPaymentRequiredHeaders(amount: number, tier: PricingTier): Record<string, string>;
  /** Verify payment proof */
  verifyPayment(proof: PaymentProof): Promise<PaymentVerificationResult>;
  /** Get payment address */
  getPaymentAddress(): string;
  /** Calculate price for tier */
  getPrice(tier: PricingTier): number;
  /** Classify prompt to pricing tier */
  classifyPrompt(prompt: string): PricingTier;
  /** Get cached payment by hash */
  getCachedPayment(txHash: string): PaymentProof | null;
  /** Clear payment cache */
  clearCache(): void;
  /** Get statistics */
  getStats(): PaymentStats;
}

export interface PaymentVerificationResult {
  valid: boolean;
  error?: string;
  amount?: number;
  token?: string;
  network?: string;
}

export interface PaymentStats {
  totalVerified: number;
  totalRevenue: number;
  cacheHits: number;
  cacheMisses: number;
  failedVerifications: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_PRICING: Required<PricingConfig> = {
  basic: 0.05,
  standard: 0.10,
  complex: 0.25,
  defaultTier: 'standard',
  tokenDiscount: 0.2,
};

// USDC on Base
const DEFAULT_TOKEN_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Payment patterns for classification
const BASIC_PATTERNS = [
  /price|balance|check|show|get|list|view|display|what.*(?:is|are)/i,
  /how much|status|info|details|lookup/i,
];

const COMPLEX_PATTERNS = [
  /automat|schedul|recurring|trigger|webhook|alert/i,
  /multi|batch|bulk|all.*positions|portfolio/i,
  /copy.*trad|follow|mirror|signal/i,
  /strateg|backtest|optimiz|analyz.*(?:all|portfolio)/i,
];

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createX402Middleware(config: X402MiddlewareConfig = {}): X402Middleware {
  const pricing = { ...DEFAULT_PRICING, ...config.pricing };
  const tokenAddress = config.tokenAddress || DEFAULT_TOKEN_ADDRESS;
  const network = config.network || 'base';
  const cacheTtl = config.cacheTtl || 300000;
  const cacheEnabled = config.cachePayments !== false;

  // Payment cache: txHash -> { proof, timestamp }
  const paymentCache = new Map<string, { proof: PaymentProof; timestamp: number }>();

  // Stats
  const stats: PaymentStats = {
    totalVerified: 0,
    totalRevenue: 0,
    cacheHits: 0,
    cacheMisses: 0,
    failedVerifications: 0,
  };

  // Get treasury wallet from env or config
  function getPaymentAddress(): string {
    // First check env var (recommended for production)
    const envTreasury = process.env.CLODDS_TREASURY_WALLET;
    if (envTreasury && envTreasury.startsWith('0x')) {
      return envTreasury;
    }
    // Fall back to config
    if (config.privateKey) {
      const hash = createHash('sha256').update(config.privateKey).digest('hex');
      return `0x${hash.slice(0, 40)}`;
    }
    // No treasury configured - will reject payments
    throw new Error('CLODDS_TREASURY_WALLET env var not set');
  }

  function getPrice(tier: PricingTier): number {
    return pricing[tier] || pricing.standard;
  }

  function classifyPrompt(prompt: string): PricingTier {
    const normalized = prompt.toLowerCase().trim();

    // Check for complex patterns first (highest priority)
    for (const pattern of COMPLEX_PATTERNS) {
      if (pattern.test(normalized)) {
        return 'complex';
      }
    }

    // Check for basic patterns
    for (const pattern of BASIC_PATTERNS) {
      if (pattern.test(normalized)) {
        // But if it also contains action words, upgrade to standard
        if (/buy|sell|swap|trade|transfer|send|stake|unstake|claim|bridge/i.test(normalized)) {
          return 'standard';
        }
        return 'basic';
      }
    }

    return pricing.defaultTier;
  }

  function getPaymentRequiredHeaders(amount: number, tier: PricingTier): Record<string, string> {
    const nonce = randomBytes(16).toString('hex');
    const paymentAddress = getPaymentAddress();

    return {
      'X-Payment-Required': 'true',
      'X-Payment-Address': paymentAddress,
      'X-Payment-Amount': amount.toFixed(6),
      'X-Payment-Currency': 'USD',
      'X-Payment-Token': tokenAddress,
      'X-Payment-Network': network,
      'X-Payment-Tier': tier,
      'X-Payment-Nonce': nonce,
      'X-Payment-Protocol': 'x402',
      'X-Payment-Version': '1.0',
      'X-Payment-Facilitator': config.facilitatorUrl || 'https://x402.org/facilitator',
    };
  }

  async function verifyPayment(proof: PaymentProof): Promise<PaymentVerificationResult> {
    try {
      // Check cache first
      if (cacheEnabled) {
        const cached = paymentCache.get(proof.txHash);
        if (cached && Date.now() - cached.timestamp < cacheTtl) {
          stats.cacheHits++;
          return { valid: true, amount: cached.proof.amountUsd, token: cached.proof.token, network: cached.proof.network };
        }
        stats.cacheMisses++;
      }

      // Verify with facilitator or directly on-chain
      const isValid = await verifyOnChain(proof);

      if (isValid) {
        stats.totalVerified++;
        stats.totalRevenue += proof.amountUsd;

        // Cache the verified payment
        if (cacheEnabled) {
          paymentCache.set(proof.txHash, { proof, timestamp: Date.now() });
        }

        return {
          valid: true,
          amount: proof.amountUsd,
          token: proof.token,
          network: proof.network,
        };
      }

      stats.failedVerifications++;
      return { valid: false, error: 'Payment verification failed' };
    } catch (error) {
      stats.failedVerifications++;
      logger.error({ error, txHash: proof.txHash }, 'Payment verification error');
      return { valid: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async function verifyOnChain(proof: PaymentProof): Promise<boolean> {
    // Basic validation
    if (!proof.txHash || !proof.txHash.startsWith('0x') || proof.txHash.length !== 66) {
      logger.warn({ txHash: proof.txHash }, 'Invalid tx hash format');
      return false;
    }

    if (proof.amountUsd <= 0) {
      logger.warn({ amount: proof.amountUsd }, 'Invalid payment amount');
      return false;
    }

    // Check timestamp (payment must be recent - within 10 minutes)
    const maxAge = 10 * 60 * 1000; // 10 minutes
    if (Date.now() - proof.timestamp > maxAge) {
      logger.warn({ timestamp: proof.timestamp }, 'Payment proof expired');
      return false;
    }

    // Dev mode: accept well-formed proofs
    if (process.env.NODE_ENV === 'development' || process.env.CLODDS_DEV_MODE === 'true') {
      logger.debug({ proof }, 'Dev mode: accepting payment');
      return true;
    }

    // Production: verify on-chain via RPC
    try {
      const rpcUrl = proof.network === 'base'
        ? 'https://mainnet.base.org'
        : proof.network === 'base-sepolia'
        ? 'https://sepolia.base.org'
        : 'https://mainnet.base.org';

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getTransactionReceipt',
          params: [proof.txHash],
          id: 1,
        }),
      });

      const data = await response.json() as { result?: { status: string; to?: string } };

      if (!data.result) {
        logger.warn({ txHash: proof.txHash }, 'Transaction not found');
        return false;
      }

      // Check transaction succeeded
      if (data.result.status !== '0x1') {
        logger.warn({ txHash: proof.txHash, status: data.result.status }, 'Transaction failed');
        return false;
      }

      // Verify recipient (should be our payment address or USDC contract)
      const paymentAddress = getPaymentAddress().toLowerCase();
      const recipient = data.result.to?.toLowerCase();
      if (recipient !== paymentAddress && recipient !== tokenAddress.toLowerCase()) {
        logger.warn({ txHash: proof.txHash, to: recipient, expected: paymentAddress }, 'Wrong recipient');
        return false;
      }

      logger.info({ txHash: proof.txHash, amount: proof.amountUsd }, 'Payment verified on-chain');
      return true;
    } catch (error) {
      logger.error({ error, txHash: proof.txHash }, 'On-chain verification failed');
      return false;
    }
  }

  async function hasValidPayment(proof?: PaymentProof, requiredAmount?: number): Promise<boolean> {
    if (!proof) {
      return false;
    }

    const result = await verifyPayment(proof);
    if (!result.valid) {
      return false;
    }

    // Check amount if specified
    if (requiredAmount !== undefined && result.amount !== undefined) {
      // Allow 1% tolerance for rounding
      const tolerance = requiredAmount * 0.01;
      if (result.amount < requiredAmount - tolerance) {
        return false;
      }
    }

    return true;
  }

  function getCachedPayment(txHash: string): PaymentProof | null {
    const cached = paymentCache.get(txHash);
    if (cached && Date.now() - cached.timestamp < cacheTtl) {
      return cached.proof;
    }
    return null;
  }

  function clearCache(): void {
    paymentCache.clear();
  }

  function getStats(): PaymentStats {
    return { ...stats };
  }

  // Periodic cache cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [hash, entry] of paymentCache) {
      if (now - entry.timestamp > cacheTtl) {
        paymentCache.delete(hash);
      }
    }
  }, cacheTtl);

  return {
    hasValidPayment,
    getPaymentRequiredHeaders,
    verifyPayment,
    getPaymentAddress,
    getPrice,
    classifyPrompt,
    getCachedPayment,
    clearCache,
    getStats,
  };
}

// =============================================================================
// EXPRESS MIDDLEWARE HELPER
// =============================================================================

/**
 * Create Express-compatible middleware
 */
export function createExpressX402Middleware(config: X402MiddlewareConfig = {}) {
  const middleware = createX402Middleware(config);

  return async (req: any, res: any, next: any) => {
    // Skip for non-prompt endpoints
    if (!req.path.startsWith('/v2/prompt')) {
      return next();
    }

    // Check for payment proof in headers
    const paymentHeader = req.headers['x-payment-proof'];
    let proof: PaymentProof | undefined;

    if (paymentHeader) {
      try {
        proof = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
      } catch {
        return res.status(400).json({ error: 'Invalid payment proof format' });
      }
    }

    // Classify the prompt to determine price
    const prompt = req.body?.prompt || '';
    const tier = middleware.classifyPrompt(prompt);
    const price = middleware.getPrice(tier);

    // Check if payment is valid
    const hasPayment = await middleware.hasValidPayment(proof, price);

    if (!hasPayment) {
      // Return 402 Payment Required
      const headers = middleware.getPaymentRequiredHeaders(price, tier);
      for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value);
      }
      return res.status(402).json({
        error: 'Payment Required',
        amount: price,
        currency: 'USD',
        tier,
        paymentAddress: middleware.getPaymentAddress(),
        protocol: 'x402',
      });
    }

    // Payment valid - attach to request and continue
    req.payment = { proof, tier, price };
    next();
  };
}
