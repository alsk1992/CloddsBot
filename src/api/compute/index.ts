/**
 * Clodds Compute - Agent Compute Marketplace
 *
 * Agents pay USDC for compute resources:
 * - LLM inference (Claude, GPT, Llama)
 * - Code execution (sandboxed)
 * - Web scraping
 * - Trade execution
 * - Market data
 * - File storage
 *
 * No API keys needed - just a wallet.
 */

export { createComputeGateway, type ComputeGateway, type ComputeGatewayConfig, type WalletBalance, type DepositResult, type UsageStats } from './gateway';
export { createLLMService, type LLMService, type LLMServiceConfig } from './llm';
export { createCodeRunner, type CodeRunner, type CodeRunnerConfig } from './code';
export { createWebScraper, type WebScraper, type WebScraperConfig } from './web';
export { createTradeExecutor, type TradeExecutor, type TradeExecutorConfig, type PlatformConfig } from './trade';
export { createDataService, type DataService, type DataServiceConfig, type PriceData, type OrderbookData } from './data';
export { createStorageService, type StorageService, type StorageServiceConfig, type StorageStats } from './storage';
export * from './types';
