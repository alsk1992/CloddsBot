/**
 * Clodds API Types
 */

import type { X402Network } from '../payments/x402';

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface ApiGatewayConfig {
  /** Server port (default: 3001) */
  port?: number;
  /** Server host (default: '0.0.0.0') */
  host?: string;
  /** Enable CORS (default: true) */
  cors?: boolean | string[];
  /** Pricing tiers in USD */
  pricing?: PricingConfig;
  /** x402 payment configuration */
  x402?: X402PaymentConfig;
  /** Job queue configuration */
  jobs?: JobQueueConfig;
  /** Custody wallet configuration */
  custody?: CustodyConfig;
  /** Rate limiting */
  rateLimit?: RateLimitConfig;
  /** Logging level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface PricingConfig {
  /** Basic queries: prices, balances, simple lookups (default: $0.05) */
  basic?: number;
  /** Standard operations: trades, swaps, analysis (default: $0.10) */
  standard?: number;
  /** Complex operations: multi-step, automation (default: $0.25) */
  complex?: number;
  /** Default tier for unclassified prompts (default: 'standard') */
  defaultTier?: PricingTier;
  /** Discount for $CLODDS token payments (0-1, default: 0.2 = 20% off) */
  tokenDiscount?: number;
}

export type PricingTier = 'basic' | 'standard' | 'complex';

export interface X402PaymentConfig {
  /** Payment network (default: 'base') */
  network?: X402Network;
  /** Server private key for payment verification */
  privateKey?: string;
  /** Payment token address (default: USDC on Base) */
  tokenAddress?: string;
  /** Facilitator URL (default: Coinbase) */
  facilitatorUrl?: string;
  /** Payment timeout in ms (default: 60000) */
  timeout?: number;
}

export interface JobQueueConfig {
  /** Maximum concurrent jobs (default: 10) */
  concurrency?: number;
  /** Job timeout in ms (default: 120000) */
  timeout?: number;
  /** Job retention period in ms (default: 86400000 = 24h) */
  retention?: number;
  /** Enable persistence (default: true) */
  persist?: boolean;
  /** Storage directory (default: ~/.clodds/api/jobs) */
  storageDir?: string;
}

export interface CustodyConfig {
  /** Enable managed wallets (default: false) */
  enabled?: boolean;
  /** Master encryption key (required if enabled) */
  masterKey?: string;
  /** HD derivation path (default: "m/44'/60'/0'/0") */
  derivationPath?: string;
  /** Storage directory (default: ~/.clodds/api/wallets) */
  storageDir?: string;
}

export interface RateLimitConfig {
  /** Requests per minute per IP (default: 60) */
  perMinute?: number;
  /** Requests per minute per wallet (default: 120) */
  perWallet?: number;
  /** Burst allowance (default: 10) */
  burst?: number;
}

// =============================================================================
// API REQUEST/RESPONSE
// =============================================================================

export interface ApiRequest {
  /** Unique request ID */
  id: string;
  /** Natural language prompt */
  prompt: string;
  /** Caller's wallet address */
  wallet: string;
  /** Payment proof (after x402 payment) */
  paymentProof?: PaymentProof;
  /** Optional: use managed custody wallet */
  useCustody?: boolean;
  /** Optional: specific chain for execution */
  chain?: string;
  /** Optional: callback URL for async results */
  callbackUrl?: string;
  /** Optional: metadata */
  meta?: Record<string, unknown>;
}

export interface ApiResponse {
  /** Request ID */
  id: string;
  /** Job ID for async tracking */
  jobId: string;
  /** Current status */
  status: JobStatusType;
  /** Result data (when completed) */
  result?: PromptResultData;
  /** Error message (when failed) */
  error?: string;
  /** Cost in USD */
  cost: number;
  /** Pricing tier applied */
  tier: PricingTier;
  /** Timestamp */
  timestamp: number;
}

export interface PaymentProof {
  /** Transaction hash */
  txHash: string;
  /** Network */
  network: X402Network;
  /** Amount paid in USD */
  amountUsd: number;
  /** Token used */
  token: string;
  /** Timestamp */
  timestamp: number;
  /** x402 payload */
  payload?: string;
}

// =============================================================================
// JOB TYPES
// =============================================================================

export type JobStatusType = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface JobData {
  /** Job ID */
  id: string;
  /** Original request */
  request: ApiRequest;
  /** Current status */
  status: JobStatusType;
  /** Result data */
  result?: PromptResultData;
  /** Error message */
  error?: string;
  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt: number;
  /** Processing started timestamp */
  startedAt?: number;
  /** Completed timestamp */
  completedAt?: number;
  /** Retry count */
  retries: number;
  /** Cost in USD */
  cost: number;
  /** Pricing tier */
  tier: PricingTier;
}

// =============================================================================
// PROMPT RESULT TYPES
// =============================================================================

export interface PromptResultData {
  /** Action type performed */
  action: PromptAction;
  /** Human-readable summary */
  summary: string;
  /** Structured data */
  data: unknown;
  /** Transaction details (if applicable) */
  transaction?: TransactionResult;
  /** Execution time in ms */
  executionTime: number;
}

export type PromptAction =
  | 'query'           // Read-only query (prices, balances, etc.)
  | 'trade'           // Execute trade
  | 'swap'            // Token swap
  | 'transfer'        // Transfer tokens
  | 'stake'           // Staking operation
  | 'unstake'         // Unstaking operation
  | 'claim'           // Claim rewards
  | 'approve'         // Token approval
  | 'bridge'          // Cross-chain bridge
  | 'analysis'        // Market analysis
  | 'automation'      // Set up automation
  | 'unknown';        // Unclassified

export interface TransactionResult {
  /** Transaction hash */
  hash: string;
  /** Chain/network */
  chain: string;
  /** Block number (if confirmed) */
  blockNumber?: number;
  /** Gas used */
  gasUsed?: string;
  /** Status */
  status: 'pending' | 'confirmed' | 'failed';
  /** Explorer URL */
  explorerUrl?: string;
}

// =============================================================================
// CUSTODY TYPES
// =============================================================================

export interface ManagedWalletData {
  /** Wallet ID */
  id: string;
  /** Owner's external wallet address */
  owner: string;
  /** EVM address */
  evmAddress: string;
  /** Solana address */
  solanaAddress?: string;
  /** Created timestamp */
  createdAt: number;
  /** Last used timestamp */
  lastUsedAt: number;
  /** Derivation index */
  derivationIndex: number;
}

// =============================================================================
// WEBHOOK/CALLBACK TYPES
// =============================================================================

export interface WebhookPayload {
  /** Event type */
  event: 'job.completed' | 'job.failed' | 'job.cancelled';
  /** Job data */
  job: JobData;
  /** Timestamp */
  timestamp: number;
  /** Signature for verification */
  signature: string;
}

// =============================================================================
// METRICS TYPES
// =============================================================================

export interface ApiMetrics {
  /** Total requests */
  totalRequests: number;
  /** Successful requests */
  successfulRequests: number;
  /** Failed requests */
  failedRequests: number;
  /** Total revenue in USD */
  totalRevenue: number;
  /** Revenue by tier */
  revenueByTier: Record<PricingTier, number>;
  /** Average response time in ms */
  avgResponseTime: number;
  /** Active jobs */
  activeJobs: number;
  /** Unique wallets */
  uniqueWallets: number;
  /** Uptime in seconds */
  uptime: number;
  /** Trading volume in USD */
  tradingVolume: number;
  /** Trading fees earned in USD */
  tradingFees: number;
}

// =============================================================================
// SUBSCRIPTION TYPES
// =============================================================================

export type SubscriptionTier = 'free' | 'pro' | 'business' | 'enterprise';

export interface SubscriptionConfig {
  /** Tier name */
  tier: SubscriptionTier;
  /** Monthly price in USD (0 for free) */
  priceMonthly: number;
  /** Prompts per day limit */
  promptsPerDay: number;
  /** Can execute trades */
  canTrade: boolean;
  /** Can use copy trading */
  canCopyTrade: boolean;
  /** Can use signals */
  canUseSignals: boolean;
  /** Can use automation */
  canAutomate: boolean;
  /** Trading fee discount (0-1) */
  tradingFeeDiscount: number;
  /** Priority support */
  prioritySupport: boolean;
}

export const SUBSCRIPTION_TIERS: Record<SubscriptionTier, SubscriptionConfig> = {
  free: {
    tier: 'free',
    priceMonthly: 0,
    promptsPerDay: 5,
    canTrade: false,
    canCopyTrade: false,
    canUseSignals: false,
    canAutomate: false,
    tradingFeeDiscount: 0,
    prioritySupport: false,
  },
  pro: {
    tier: 'pro',
    priceMonthly: 29,
    promptsPerDay: 500,
    canTrade: true,
    canCopyTrade: false,
    canUseSignals: true,
    canAutomate: false,
    tradingFeeDiscount: 0.1,
    prioritySupport: false,
  },
  business: {
    tier: 'business',
    priceMonthly: 99,
    promptsPerDay: -1, // unlimited
    canTrade: true,
    canCopyTrade: true,
    canUseSignals: true,
    canAutomate: true,
    tradingFeeDiscount: 0.25,
    prioritySupport: true,
  },
  enterprise: {
    tier: 'enterprise',
    priceMonthly: 499,
    promptsPerDay: -1,
    canTrade: true,
    canCopyTrade: true,
    canUseSignals: true,
    canAutomate: true,
    tradingFeeDiscount: 0.5,
    prioritySupport: true,
  },
};

// =============================================================================
// TRADING FEE TYPES
// =============================================================================

export interface TradingFeeConfig {
  /** Base fee as decimal (0.003 = 0.3%) */
  baseFee: number;
  /** Minimum fee in USD */
  minFee: number;
  /** Maximum fee in USD */
  maxFee: number;
  /** Fee discount for $CLODDS token holders */
  tokenHolderDiscount: number;
}

export const DEFAULT_TRADING_FEES: TradingFeeConfig = {
  baseFee: 0.003, // 0.3%
  minFee: 0.01,   // $0.01 minimum
  maxFee: 100,    // $100 maximum
  tokenHolderDiscount: 0.2, // 20% off for $CLODDS holders
};

// =============================================================================
// API KEY TYPES
// =============================================================================

export interface ApiKeyData {
  /** Key ID (public) */
  id: string;
  /** Hashed secret (stored) */
  secretHash: string;
  /** Owner wallet */
  owner: string;
  /** Key name/label */
  name: string;
  /** Subscription tier */
  tier: SubscriptionTier;
  /** Created timestamp */
  createdAt: number;
  /** Last used timestamp */
  lastUsedAt: number;
  /** Expires at (0 = never) */
  expiresAt: number;
  /** Is active */
  active: boolean;
  /** Daily prompt count */
  dailyPrompts: number;
  /** Daily prompt reset time */
  dailyResetAt: number;
  /** Referral code (who referred this user) */
  referredBy?: string;
  /** This user's referral code */
  referralCode: string;
  /** Total USD spent by this user */
  totalSpent: number;
  /** Referral earnings for this user (from referred users' spending) */
  referralEarnings: number;
}

// =============================================================================
// REFERRAL TYPES
// =============================================================================

export interface ReferralConfig {
  /** Revenue share for referrer (0-1) */
  referrerShare: number;
  /** Bonus for referred user (0-1) */
  referredBonus: number;
  /** Minimum payout in USD */
  minPayout: number;
}

export const DEFAULT_REFERRAL_CONFIG: ReferralConfig = {
  referrerShare: 0.1,  // 10% of fees
  referredBonus: 0.05, // 5% discount
  minPayout: 10,       // $10 minimum
};
