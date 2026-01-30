/**
 * x402 Payment Protocol Integration
 *
 * HTTP 402 Payment Required - machine-to-machine crypto payments
 *
 * Features:
 * - Client: Pay for APIs automatically with USDC
 * - Server: Paywall endpoints to receive payments
 * - Supports Base (EVM) and Solana networks
 * - Fee-free via Coinbase facilitator
 *
 * Docs: https://docs.cdp.coinbase.com/x402/welcome
 * Spec: https://www.x402.org/
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '../../utils/logger';
import { createEvmWallet, signEvmPayment, type EvmWallet } from './evm';
import { createSolanaWallet, signSolanaPayment, type SolanaWallet } from './solana';

// =============================================================================
// TYPES
// =============================================================================

export type X402Network = 'base' | 'base-sepolia' | 'solana' | 'solana-devnet';
export type X402Scheme = 'exact';

export interface X402PaymentDetails {
  /** Supported payment options */
  accepts: X402PaymentOption[];
  /** Human-readable description */
  description?: string;
  /** Resource being purchased */
  resource?: string;
  /** Additional metadata */
  extra?: Record<string, unknown>;
}

export interface X402PaymentOption {
  /** Payment scheme (e.g., "exact") */
  scheme: X402Scheme;
  /** Blockchain network */
  network: X402Network;
  /** Token to pay with (e.g., "USDC") */
  asset: string;
  /** Amount in smallest unit (e.g., wei, lamports) */
  maxAmountRequired: string;
  /** Recipient address */
  payTo: string;
  /** Payment deadline (Unix timestamp) */
  validUntil?: number;
  /** Extra parameters */
  extra?: Record<string, unknown>;
}

export interface X402PaymentPayload {
  /** The payment option being fulfilled */
  paymentOption: X402PaymentOption;
  /** Signature proving payment authorization */
  signature: string;
  /** Payer's address */
  payer: string;
  /** Nonce for replay protection */
  nonce: string;
  /** Timestamp */
  timestamp: number;
}

export interface X402Config {
  /** Default network to use */
  network?: X402Network;
  /** Facilitator URL (default: Coinbase) */
  facilitatorUrl?: string;
  /** Auto-approve payments under this amount (in USD) */
  autoApproveLimit?: number;
  /** EVM wallet private key */
  evmPrivateKey?: string;
  /** Solana wallet private key */
  solanaPrivateKey?: string;
  /** Dry run mode */
  dryRun?: boolean;
}

export interface X402PaymentResult {
  success: boolean;
  transactionHash?: string;
  network?: X402Network;
  amount?: string;
  asset?: string;
  error?: string;
}

export interface X402Client extends EventEmitter {
  /** Make a paid HTTP request */
  fetch(url: string, options?: RequestInit): Promise<Response>;

  /** Check if a 402 response and extract payment details */
  parsePaymentRequired(response: Response): X402PaymentDetails | null;

  /** Create payment payload for a request */
  createPayment(details: X402PaymentDetails): Promise<X402PaymentPayload | null>;

  /** Verify a payment was settled */
  verifyPayment(payload: X402PaymentPayload): Promise<boolean>;

  /** Get wallet address for a network */
  getAddress(network: X402Network): string | null;

  /** Get balance for a network */
  getBalance(network: X402Network): Promise<{ balance: string; asset: string } | null>;

  /** Check if client is configured for payments */
  isConfigured(): boolean;

  /** Get payment history */
  getPaymentHistory(): X402PaymentResult[];
}

export interface X402ServerConfig {
  /** Wallet address to receive payments */
  payToAddress: string;
  /** Network to receive on */
  network: X402Network;
  /** Facilitator URL for verification */
  facilitatorUrl?: string;
  /** Asset to accept (default: USDC) */
  asset?: string;
}

export interface X402EndpointConfig {
  /** Price in USD (converted to asset amount) */
  priceUsd: number;
  /** Description of what's being purchased */
  description?: string;
  /** Custom validation function */
  validate?: (payload: X402PaymentPayload) => Promise<boolean>;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const COINBASE_FACILITATOR_URL = 'https://x402.coinbase.com';

const USDC_ADDRESSES: Record<X402Network, string> = {
  'base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'solana': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana-devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

const USDC_DECIMALS: Record<X402Network, number> = {
  'base': 6,
  'base-sepolia': 6,
  'solana': 6,
  'solana-devnet': 6,
};

// =============================================================================
// X402 CLIENT
// =============================================================================

export function createX402Client(config: X402Config = {}): X402Client {
  const emitter = new EventEmitter() as X402Client;
  const facilitatorUrl = config.facilitatorUrl || COINBASE_FACILITATOR_URL;
  const defaultNetwork = config.network || 'base';
  const autoApproveLimit = config.autoApproveLimit ?? 1.0; // $1 default
  const dryRun = config.dryRun ?? false;

  const paymentHistory: X402PaymentResult[] = [];

  // EVM wallet
  let evmWallet: EvmWallet | null = null;
  if (config.evmPrivateKey) {
    evmWallet = createEvmWallet(config.evmPrivateKey);
    logger.info({ address: evmWallet.address }, 'x402: EVM wallet configured');
  }

  // Solana wallet
  let solanaWallet: SolanaWallet | null = null;
  if (config.solanaPrivateKey) {
    solanaWallet = createSolanaWallet(config.solanaPrivateKey);
    logger.info({ address: solanaWallet.publicKey }, 'x402: Solana wallet configured');
  }

  // Convert USD to token amount
  function usdToTokenAmount(usd: number, network: X402Network): string {
    const decimals = USDC_DECIMALS[network];
    const amount = Math.ceil(usd * Math.pow(10, decimals));
    return amount.toString();
  }

  // Parse token amount to USD
  function tokenAmountToUsd(amount: string, network: X402Network): number {
    const decimals = USDC_DECIMALS[network];
    return parseInt(amount, 10) / Math.pow(10, decimals);
  }

  // Sign EVM payment using proper EIP-712
  async function signEvmPaymentLocal(option: X402PaymentOption): Promise<X402PaymentPayload | null> {
    if (!evmWallet) {
      logger.error('x402: EVM private key not configured');
      return null;
    }

    return signEvmPayment(evmWallet, option);
  }

  // Sign Solana payment using Ed25519
  async function signSolanaPaymentLocal(option: X402PaymentOption): Promise<X402PaymentPayload | null> {
    if (!solanaWallet) {
      logger.error('x402: Solana private key not configured');
      return null;
    }

    return signSolanaPayment(solanaWallet, option);
  }

  // Attach methods
  Object.assign(emitter, {
    async fetch(url: string, options: RequestInit = {}): Promise<Response> {
      // First, try the request without payment
      const initialResponse = await fetch(url, options);

      // If not 402, return as-is
      if (initialResponse.status !== 402) {
        return initialResponse;
      }

      // Parse payment requirements
      const paymentDetails = emitter.parsePaymentRequired(initialResponse);
      if (!paymentDetails) {
        logger.error('x402: Could not parse payment details from 402 response');
        return initialResponse;
      }

      // Check if we can auto-approve
      const cheapestOption = paymentDetails.accepts
        .filter((o) => o.asset === 'USDC')
        .sort((a, b) => parseInt(a.maxAmountRequired) - parseInt(b.maxAmountRequired))[0];

      if (!cheapestOption) {
        logger.error('x402: No USDC payment option available');
        return initialResponse;
      }

      const usdAmount = tokenAmountToUsd(cheapestOption.maxAmountRequired, cheapestOption.network);

      if (usdAmount > autoApproveLimit) {
        logger.warn({ usdAmount, limit: autoApproveLimit }, 'x402: Payment exceeds auto-approve limit');
        emitter.emit('payment_required', { url, amount: usdAmount, details: paymentDetails });
        return initialResponse;
      }

      // Create payment
      const payload = await emitter.createPayment(paymentDetails);
      if (!payload) {
        return initialResponse;
      }

      if (dryRun) {
        logger.info({ url, amount: usdAmount, network: cheapestOption.network }, 'x402: Payment (dry run)');
        paymentHistory.push({
          success: true,
          network: cheapestOption.network,
          amount: cheapestOption.maxAmountRequired,
          asset: 'USDC',
        });
        return initialResponse;
      }

      // Retry with payment header
      const paymentHeader = Buffer.from(JSON.stringify(payload)).toString('base64');

      const paidResponse = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'X-PAYMENT': paymentHeader,
        },
      });

      if (paidResponse.ok) {
        logger.info({ url, amount: usdAmount }, 'x402: Payment successful');
        paymentHistory.push({
          success: true,
          network: cheapestOption.network,
          amount: cheapestOption.maxAmountRequired,
          asset: 'USDC',
        });
        emitter.emit('payment_success', { url, amount: usdAmount, payload });
      } else {
        logger.error({ url, status: paidResponse.status }, 'x402: Payment failed');
        paymentHistory.push({
          success: false,
          error: `HTTP ${paidResponse.status}`,
        });
        emitter.emit('payment_failed', { url, status: paidResponse.status });
      }

      return paidResponse;
    },

    parsePaymentRequired(response: Response): X402PaymentDetails | null {
      if (response.status !== 402) return null;

      // Try to parse from headers first
      const paymentHeader = response.headers.get('X-PAYMENT-DETAILS');
      if (paymentHeader) {
        try {
          return JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
        } catch {
          // Fall through to body parsing
        }
      }

      // Try WWW-Authenticate header (per spec)
      const authHeader = response.headers.get('WWW-Authenticate');
      if (authHeader?.startsWith('X402')) {
        try {
          const detailsMatch = authHeader.match(/details="([^"]+)"/);
          if (detailsMatch) {
            return JSON.parse(Buffer.from(detailsMatch[1], 'base64').toString());
          }
        } catch {
          // Fall through
        }
      }

      return null;
    },

    async createPayment(details: X402PaymentDetails): Promise<X402PaymentPayload | null> {
      // Find the best payment option (prefer our configured network)
      const options = details.accepts.filter((o) => o.asset === 'USDC');

      // Prefer configured network
      let option = options.find((o) => o.network === defaultNetwork);

      // Fall back to any available
      if (!option) {
        option = options.find((o) => o.network.startsWith('base')) ||
                 options.find((o) => o.network.startsWith('solana')) ||
                 options[0];
      }

      if (!option) {
        logger.error('x402: No compatible payment option found');
        return null;
      }

      // Sign based on network type
      if (option.network.startsWith('base')) {
        return signEvmPaymentLocal(option);
      } else if (option.network.startsWith('solana')) {
        return signSolanaPaymentLocal(option);
      }

      logger.error({ network: option.network }, 'x402: Unsupported network');
      return null;
    },

    async verifyPayment(payload: X402PaymentPayload): Promise<boolean> {
      try {
        const response = await fetch(`${facilitatorUrl}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          logger.error({ status: response.status }, 'x402: Verification failed');
          return false;
        }

        const result = await response.json() as { valid: boolean };
        return result.valid;
      } catch (err) {
        logger.error({ err }, 'x402: Verification error');
        return false;
      }
    },

    getAddress(network: X402Network): string | null {
      if (network.startsWith('base')) {
        return evmWallet?.address || null;
      } else if (network.startsWith('solana')) {
        return solanaWallet?.publicKey || null;
      }
      return null;
    },

    async getBalance(network: X402Network): Promise<{ balance: string; asset: string } | null> {
      const address = emitter.getAddress(network);
      if (!address) return null;

      try {
        if (network.startsWith('base')) {
          // Query EVM USDC balance via eth_call to balanceOf
          const usdcAddress = USDC_ADDRESSES[network];
          const rpcUrl = network === 'base'
            ? 'https://mainnet.base.org'
            : 'https://sepolia.base.org';

          // balanceOf(address) selector = 0x70a08231
          const data = '0x70a08231' + address.slice(2).padStart(64, '0');

          const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'eth_call',
              params: [{ to: usdcAddress, data }, 'latest'],
              id: 1,
            }),
          });

          const result = await response.json() as { result?: string; error?: { message: string } };
          if (result.error) {
            logger.warn({ error: result.error, network }, 'x402: Balance query failed');
            return { balance: '0', asset: 'USDC' };
          }

          // Parse hex balance
          const balanceHex = result.result || '0x0';
          const balance = BigInt(balanceHex).toString();
          return { balance, asset: 'USDC' };

        } else if (network.startsWith('solana')) {
          // Query Solana USDC token account balance
          const rpcUrl = network === 'solana'
            ? 'https://api.mainnet-beta.solana.com'
            : 'https://api.devnet.solana.com';

          const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'getTokenAccountsByOwner',
              params: [
                address,
                { mint: USDC_ADDRESSES[network] },
                { encoding: 'jsonParsed' },
              ],
              id: 1,
            }),
          });

          const result = await response.json() as {
            result?: { value: Array<{ account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }> };
            error?: { message: string };
          };

          if (result.error) {
            logger.warn({ error: result.error, network }, 'x402: Solana balance query failed');
            return { balance: '0', asset: 'USDC' };
          }

          // Sum all USDC token accounts
          const accounts = result.result?.value || [];
          let totalBalance = BigInt(0);
          for (const acc of accounts) {
            const amount = acc.account?.data?.parsed?.info?.tokenAmount?.amount || '0';
            totalBalance += BigInt(amount);
          }

          return { balance: totalBalance.toString(), asset: 'USDC' };
        }

        return null;
      } catch (error) {
        logger.warn({ error, network, address }, 'x402: Failed to query balance');
        return { balance: '0', asset: 'USDC' };
      }
    },

    isConfigured(): boolean {
      return !!(evmWallet || solanaWallet);
    },

    getPaymentHistory(): X402PaymentResult[] {
      return [...paymentHistory];
    },
  } as Partial<X402Client>);

  return emitter;
}

// =============================================================================
// X402 SERVER MIDDLEWARE
// =============================================================================

export interface X402Middleware {
  /** Express/Hono style middleware */
  middleware: (req: any, res: any, next: () => void) => Promise<void>;

  /** Get payment stats */
  getStats(): {
    totalPayments: number;
    totalRevenue: number;
    byEndpoint: Record<string, { count: number; revenue: number }>;
  };
}

export function createX402Server(
  serverConfig: X402ServerConfig,
  endpoints: Record<string, X402EndpointConfig>
): X402Middleware {
  const facilitatorUrl = serverConfig.facilitatorUrl || COINBASE_FACILITATOR_URL;
  const asset = serverConfig.asset || 'USDC';

  const stats = {
    totalPayments: 0,
    totalRevenue: 0,
    byEndpoint: {} as Record<string, { count: number; revenue: number }>,
  };

  // Convert USD price to payment details
  function createPaymentDetails(endpoint: string, config: X402EndpointConfig): X402PaymentDetails {
    const decimals = USDC_DECIMALS[serverConfig.network];
    const amount = Math.ceil(config.priceUsd * Math.pow(10, decimals)).toString();

    return {
      accepts: [{
        scheme: 'exact',
        network: serverConfig.network,
        asset,
        maxAmountRequired: amount,
        payTo: serverConfig.payToAddress,
        validUntil: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      }],
      description: config.description || `Access to ${endpoint}`,
      resource: endpoint,
    };
  }

  // Verify payment with facilitator
  async function verifyPayment(payload: X402PaymentPayload): Promise<boolean> {
    try {
      const response = await fetch(`${facilitatorUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) return false;

      const result = await response.json() as { valid: boolean; settled?: boolean };
      return result.valid && result.settled !== false;
    } catch {
      return false;
    }
  }

  return {
    async middleware(req: any, res: any, next: () => void) {
      // Get endpoint path
      const path = req.path || req.url?.split('?')[0] || '';
      const method = req.method || 'GET';
      const endpointKey = `${method} ${path}`;

      // Check if endpoint requires payment
      const endpointConfig = endpoints[endpointKey] || endpoints[path];
      if (!endpointConfig) {
        return next();
      }

      // Check for payment header
      const paymentHeader = req.headers?.['x-payment'] || req.headers?.['X-PAYMENT'];

      if (!paymentHeader) {
        // Return 402 with payment details
        const details = createPaymentDetails(path, endpointConfig);
        const detailsBase64 = Buffer.from(JSON.stringify(details)).toString('base64');

        res.status?.(402) || (res.statusCode = 402);
        res.setHeader?.('WWW-Authenticate', `X402 details="${detailsBase64}"`) ||
          res.set?.('WWW-Authenticate', `X402 details="${detailsBase64}"`);
        res.setHeader?.('X-PAYMENT-DETAILS', detailsBase64) ||
          res.set?.('X-PAYMENT-DETAILS', detailsBase64);

        res.json?.({ error: 'Payment Required', details }) ||
          res.end?.(JSON.stringify({ error: 'Payment Required', details }));
        return;
      }

      // Parse and verify payment
      try {
        const payload: X402PaymentPayload = JSON.parse(
          Buffer.from(paymentHeader, 'base64').toString()
        );

        // Custom validation if provided
        if (endpointConfig.validate) {
          const valid = await endpointConfig.validate(payload);
          if (!valid) {
            res.status?.(402) || (res.statusCode = 402);
            res.json?.({ error: 'Payment validation failed' }) ||
              res.end?.(JSON.stringify({ error: 'Payment validation failed' }));
            return;
          }
        }

        // Verify with facilitator
        const verified = await verifyPayment(payload);

        if (!verified) {
          res.status?.(402) || (res.statusCode = 402);
          res.json?.({ error: 'Payment verification failed' }) ||
            res.end?.(JSON.stringify({ error: 'Payment verification failed' }));
          return;
        }

        // Track stats
        stats.totalPayments++;
        stats.totalRevenue += endpointConfig.priceUsd;

        if (!stats.byEndpoint[path]) {
          stats.byEndpoint[path] = { count: 0, revenue: 0 };
        }
        stats.byEndpoint[path].count++;
        stats.byEndpoint[path].revenue += endpointConfig.priceUsd;

        logger.info(
          { path, amount: endpointConfig.priceUsd, payer: payload.payer },
          'x402: Payment received'
        );

        // Proceed to handler
        next();
      } catch (err) {
        logger.error({ err }, 'x402: Payment parsing error');
        res.status?.(400) || (res.statusCode = 400);
        res.json?.({ error: 'Invalid payment payload' }) ||
          res.end?.(JSON.stringify({ error: 'Invalid payment payload' }));
      }
    },

    getStats() {
      return { ...stats };
    },
  };
}

// =============================================================================
// WRAPPED FETCH FOR AUTOMATIC PAYMENTS
// =============================================================================

/**
 * Create a fetch function that automatically handles x402 payments
 */
export function createPaidFetch(config: X402Config): typeof fetch {
  const client = createX402Client(config);

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return client.fetch(url, init);
  };
}

// =============================================================================
// AXIOS INTERCEPTOR
// =============================================================================

/**
 * Create axios interceptor for automatic x402 payments
 */
export function createX402AxiosInterceptor(config: X402Config) {
  const client = createX402Client(config);

  return {
    onFulfilled: async (response: any) => response,

    onRejected: async (error: any) => {
      if (error.response?.status !== 402) {
        throw error;
      }

      const details = client.parsePaymentRequired(error.response);
      if (!details) {
        throw error;
      }

      const payload = await client.createPayment(details);
      if (!payload) {
        throw error;
      }

      // Retry with payment
      const paymentHeader = Buffer.from(JSON.stringify(payload)).toString('base64');

      return error.config.axios?.({
        ...error.config,
        headers: {
          ...error.config.headers,
          'X-PAYMENT': paymentHeader,
        },
      });
    },
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Format amount for display
 */
export function formatX402Amount(amount: string, network: X402Network): string {
  const decimals = USDC_DECIMALS[network];
  const value = parseInt(amount, 10) / Math.pow(10, decimals);
  return `$${value.toFixed(2)} USDC`;
}

/**
 * Get USDC contract address for a network
 */
export function getUsdcAddress(network: X402Network): string {
  return USDC_ADDRESSES[network];
}

/**
 * Check if a URL supports x402 payments
 */
export async function checkX402Support(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'OPTIONS' });
    const supports = response.headers.get('X-SUPPORTS-X402');
    return supports === 'true' || response.status === 402;
  } catch {
    return false;
  }
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

export { createEvmWallet, signEvmPayment, verifyEvmPayment } from './evm';
export type { EvmWallet } from './evm';

export { createSolanaWallet, signSolanaPayment, verifySolanaPayment } from './solana';
export type { SolanaWallet } from './solana';
