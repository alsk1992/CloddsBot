/**
 * Compute Marketplace Types
 */

// =============================================================================
// COMPUTE SERVICES
// =============================================================================

export type ComputeService =
  | 'llm'       // LLM inference
  | 'code'      // Code execution
  | 'web'       // Web scraping
  | 'trade'     // Trade execution
  | 'data'      // Market data
  | 'storage'   // File storage
  | 'gpu'       // GPU compute (future)
  | 'ml'        // ML inference (future)
  ;

// =============================================================================
// PRICING
// =============================================================================

export interface ComputePricing {
  service: ComputeService;
  /** Base price in USD */
  basePrice: number;
  /** Unit of measurement */
  unit: 'request' | 'token' | 'second' | 'mb' | 'call';
  /** Price per unit */
  pricePerUnit: number;
  /** Minimum charge */
  minCharge: number;
  /** Maximum charge per request */
  maxCharge: number;
}

export const COMPUTE_PRICING: Record<ComputeService, ComputePricing> = {
  llm: {
    service: 'llm',
    basePrice: 0,
    unit: 'token',
    pricePerUnit: 0.000003, // $3 per 1M tokens (input)
    minCharge: 0.001,
    maxCharge: 10,
  },
  code: {
    service: 'code',
    basePrice: 0.01,
    unit: 'second',
    pricePerUnit: 0.001, // $0.001 per second
    minCharge: 0.01,
    maxCharge: 1,
  },
  web: {
    service: 'web',
    basePrice: 0.005,
    unit: 'request',
    pricePerUnit: 0.005,
    minCharge: 0.005,
    maxCharge: 0.1,
  },
  trade: {
    service: 'trade',
    basePrice: 0.01,
    unit: 'call',
    pricePerUnit: 0.01,
    minCharge: 0.01,
    maxCharge: 0.5,
  },
  data: {
    service: 'data',
    basePrice: 0.001,
    unit: 'request',
    pricePerUnit: 0.001,
    minCharge: 0.001,
    maxCharge: 0.1,
  },
  storage: {
    service: 'storage',
    basePrice: 0,
    unit: 'mb',
    pricePerUnit: 0.0001, // $0.10 per GB
    minCharge: 0.001,
    maxCharge: 1,
  },
  gpu: {
    service: 'gpu',
    basePrice: 0,
    unit: 'second',
    pricePerUnit: 0.01, // $0.01 per second
    minCharge: 0.1,
    maxCharge: 100,
  },
  ml: {
    service: 'ml',
    basePrice: 0.01,
    unit: 'request',
    pricePerUnit: 0.01,
    minCharge: 0.01,
    maxCharge: 1,
  },
};

// =============================================================================
// REQUESTS & RESPONSES
// =============================================================================

export interface ComputeRequest {
  /** Request ID */
  id: string;
  /** Service type */
  service: ComputeService;
  /** Wallet address */
  wallet: string;
  /** Service-specific payload */
  payload: unknown;
  /** Payment proof */
  paymentProof?: PaymentProof;
  /** Callback URL for async results */
  callbackUrl?: string;
  /** Metadata */
  meta?: Record<string, unknown>;
}

export interface ComputeResponse {
  /** Request ID */
  id: string;
  /** Job ID for async tracking */
  jobId: string;
  /** Service type */
  service: ComputeService;
  /** Status */
  status: 'pending' | 'processing' | 'completed' | 'failed';
  /** Result (when completed) */
  result?: unknown;
  /** Error (when failed) */
  error?: string;
  /** Cost in USD */
  cost: number;
  /** Usage breakdown */
  usage?: ComputeUsage;
  /** Timestamp */
  timestamp: number;
}

export interface ComputeUsage {
  /** Units consumed */
  units: number;
  /** Unit type */
  unitType: string;
  /** Duration in ms */
  durationMs: number;
  /** Cost breakdown */
  breakdown: {
    base: number;
    usage: number;
    total: number;
  };
}

export interface PaymentProof {
  txHash: string;
  network: string;
  amountUsd: number;
  token: string;
  timestamp: number;
}

// =============================================================================
// LLM SERVICE
// =============================================================================

export interface LLMRequest {
  /** Model to use */
  model: LLMModel;
  /** Messages */
  messages: LLMMessage[];
  /** System prompt */
  system?: string;
  /** Max tokens */
  maxTokens?: number;
  /** Temperature */
  temperature?: number;
  /** Tools */
  tools?: LLMTool[];
  /** Stream response */
  stream?: boolean;
}

export type LLMModel =
  | 'claude-sonnet-4-20250514'
  | 'claude-3-5-haiku-latest'
  | 'claude-opus-4-20250514'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'llama-3.1-70b'
  | 'llama-3.1-8b'
  | 'mixtral-8x7b'
  ;

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: string;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

// =============================================================================
// CODE EXECUTION SERVICE
// =============================================================================

export interface CodeRequest {
  /** Language */
  language: CodeLanguage;
  /** Code to execute */
  code: string;
  /** Stdin input */
  stdin?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in ms (max 30000) */
  timeout?: number;
  /** Memory limit in MB (max 512) */
  memoryMb?: number;
  /** Files to include */
  files?: Array<{ name: string; content: string }>;
}

export type CodeLanguage =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'rust'
  | 'go'
  | 'bash'
  ;

export interface CodeResponse {
  /** Exit code */
  exitCode: number;
  /** Stdout */
  stdout: string;
  /** Stderr */
  stderr: string;
  /** Execution time in ms */
  durationMs: number;
  /** Memory used in MB */
  memoryMb: number;
  /** Output files */
  files?: Array<{ name: string; content: string }>;
}

// =============================================================================
// WEB SCRAPING SERVICE
// =============================================================================

export interface WebRequest {
  /** URL to scrape */
  url: string;
  /** Method */
  method?: 'GET' | 'POST';
  /** Headers */
  headers?: Record<string, string>;
  /** Body (for POST) */
  body?: string;
  /** Wait for selector */
  waitFor?: string;
  /** Screenshot */
  screenshot?: boolean;
  /** Extract selectors */
  extract?: Record<string, string>;
  /** Use JavaScript rendering */
  javascript?: boolean;
  /** Proxy country */
  proxyCountry?: string;
}

export interface WebResponse {
  /** HTTP status */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
  /** HTML content */
  html?: string;
  /** Extracted data */
  extracted?: Record<string, string>;
  /** Screenshot (base64) */
  screenshot?: string;
  /** Final URL (after redirects) */
  finalUrl: string;
}

// =============================================================================
// TRADE EXECUTION SERVICE
// =============================================================================

export interface TradeRequest {
  /** Platform */
  platform: TradePlatform;
  /** Market ID */
  marketId: string;
  /** Side */
  side: 'buy' | 'sell';
  /** Size in USD or shares */
  size: number;
  /** Size type */
  sizeType: 'usd' | 'shares';
  /** Price (for limit orders) */
  price?: number;
  /** Order type */
  orderType: 'market' | 'limit' | 'gtc';
  /** Outcome (for prediction markets) */
  outcome?: string;
  /** Slippage tolerance */
  slippagePct?: number;
  /** Use custody wallet */
  useCustody?: boolean;
}

export type TradePlatform =
  | 'polymarket'
  | 'kalshi'
  | 'hyperliquid'
  | 'binance'
  | 'jupiter'    // Solana DEX
  | 'uniswap'    // ETH DEX
  | 'aerodrome'  // Base DEX
  ;

export interface TradeResponse {
  /** Order ID */
  orderId: string;
  /** Status */
  status: 'pending' | 'filled' | 'partial' | 'cancelled' | 'failed';
  /** Fill price */
  fillPrice?: number;
  /** Filled size */
  filledSize?: number;
  /** Transaction hash */
  txHash?: string;
  /** Fee paid */
  fee?: number;
  /** Explorer URL */
  explorerUrl?: string;
}

// =============================================================================
// DATA SERVICE
// =============================================================================

export interface DataRequest {
  /** Data type */
  type: DataType;
  /** Query parameters */
  query: Record<string, unknown>;
}

export type DataType =
  | 'price'           // Asset price
  | 'orderbook'       // Order book
  | 'candles'         // OHLCV candles
  | 'trades'          // Recent trades
  | 'markets'         // Market list
  | 'positions'       // Wallet positions
  | 'balance'         // Wallet balance
  | 'news'            // Market news
  | 'sentiment'       // Social sentiment
  ;

export interface DataResponse {
  type: DataType;
  data: unknown;
  timestamp: number;
  source: string;
}

// =============================================================================
// STORAGE SERVICE
// =============================================================================

export interface StorageRequest {
  /** Operation */
  operation: 'put' | 'get' | 'delete' | 'list';
  /** Key/path */
  key: string;
  /** Content (for put) */
  content?: string | Buffer;
  /** Content type */
  contentType?: string;
  /** TTL in seconds (0 = permanent) */
  ttl?: number;
}

export interface StorageResponse {
  /** Operation result */
  success: boolean;
  /** Key */
  key: string;
  /** Content (for get) */
  content?: string;
  /** Size in bytes */
  size?: number;
  /** URL (for public files) */
  url?: string;
  /** List results */
  keys?: string[];
}
