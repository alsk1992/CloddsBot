/**
 * EVM Module
 *
 * Unified EVM wallet, trading, and multi-chain capabilities.
 *
 * - Wallet generation and keystore management
 * - Multi-chain balance checking (7 chains)
 * - DEX aggregation via Odos
 * - Token transfers (ETH and ERC20)
 * - Generic smart contract interactions
 * - DEX trading (Uniswap, 1inch)
 * - Virtuals Protocol (Base chain AI agents)
 */

// Wallet generation and management
export * from './wallet';

// Multi-chain balance checking
export * from './multichain';

// Odos swap aggregator
export * from './odos';

// Token transfers
export * from './transfers';

// Generic contract interactions
export * from './contracts';

// DEX trading
export * from './uniswap';
export * from './oneinch';

// Virtuals Protocol
export * from './virtuals';
