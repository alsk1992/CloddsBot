---
name: trading-evm
description: "Trade tokens on EVM chains - Uniswap V3, 1inch on Ethereum, Arbitrum, Optimism, Base, Polygon"
emoji: "⟠"
gates:
  envs:
    - EVM_PRIVATE_KEY
---

# EVM DEX Trading - Complete API Reference

Trade any token on Ethereum, Arbitrum, Optimism, Base, and Polygon using Uniswap V3 and 1inch aggregator.

## Required Environment Variables

```bash
EVM_PRIVATE_KEY=0x...                      # Your EVM wallet private key
ALCHEMY_API_KEY=...                        # Optional: for better RPC
ONEINCH_API_KEY=...                        # Optional: for 1inch API
```

---

## Supported Chains

| Chain | Chain ID | DEXes | MEV Protection |
|-------|----------|-------|----------------|
| Ethereum | 1 | Uniswap V3, 1inch | Flashbots Protect |
| Arbitrum | 42161 | Uniswap V3, 1inch | Sequencer |
| Optimism | 10 | Uniswap V3, 1inch | Sequencer |
| Base | 8453 | Uniswap V3, 1inch | Sequencer |
| Polygon | 137 | Uniswap V3, 1inch | Standard |

---

## Chat Commands

### Swaps

```
/swap eth <amount> <from> to <to>           # Swap on Ethereum
/swap arb <amount> <from> to <to>           # Swap on Arbitrum
/swap op <amount> <from> to <to>            # Swap on Optimism
/swap base <amount> <from> to <to>          # Swap on Base
/swap matic <amount> <from> to <to>         # Swap on Polygon

# Examples:
/swap eth 1 ETH to USDC                     # Swap 1 ETH to USDC on Ethereum
/swap arb 100 USDC to ARB                   # Swap 100 USDC to ARB on Arbitrum
/swap base 0.5 ETH to DEGEN                 # Swap 0.5 ETH to DEGEN on Base
```

### Quotes

```
/quote eth <amount> <from> to <to>          # Get quote without executing
/quote arb 1 ETH to USDC                    # Quote on Arbitrum
```

### Compare Routes

```
/compare <chain> <amount> <from> to <to>    # Compare Uniswap vs 1inch
/compare eth 1 ETH to USDC                  # Compare routes on Ethereum
```

### Balances

```
/balance eth                                # Check ETH and token balances
/balance arb                                # Check Arbitrum balances
/balance base <token>                       # Check specific token on Base
```

---

## TypeScript API Reference

### Uniswap V3

```typescript
import {
  executeUniswapSwap,
  getUniswapQuote,
  resolveToken,
  getTokenInfo,
  getEvmBalance
} from 'clodds/evm/uniswap';

// Get quote
const quote = await getUniswapQuote({
  chain: 'ethereum',
  tokenIn: 'ETH',
  tokenOut: 'USDC',
  amountIn: '1000000000000000000',  // 1 ETH in wei
  slippageTolerance: 0.5,
});

console.log(`Expected output: ${quote.amountOut}`);
console.log(`Price impact: ${quote.priceImpact}%`);
console.log(`Route: ${quote.route.join(' → ')}`);

// Execute swap
const result = await executeUniswapSwap({
  chain: 'ethereum',
  tokenIn: 'ETH',
  tokenOut: 'USDC',
  amountIn: '1000000000000000000',
  slippageTolerance: 0.5,
  deadline: 300,  // 5 minutes
});

console.log(`TX: ${result.transactionHash}`);
console.log(`Amount out: ${result.amountOut}`);

// Resolve token symbol to address
const usdcAddress = resolveToken('USDC', 'ethereum');

// Get token info
const tokenInfo = await getTokenInfo('ethereum', usdcAddress);
console.log(`${tokenInfo.symbol}: ${tokenInfo.decimals} decimals`);

// Check balance
const balance = await getEvmBalance('ethereum', walletAddress, 'USDC');
```

### 1inch Aggregator

```typescript
import {
  executeOneInchSwap,
  getOneInchQuote,
  getOneInchProtocols,
  compareDexRoutes
} from 'clodds/evm/oneinch';

// Get quote from 1inch
const quote = await getOneInchQuote({
  chain: 'ethereum',
  fromToken: 'ETH',
  toToken: 'USDC',
  amount: '1000000000000000000',
});

console.log(`Expected output: ${quote.toAmount}`);
console.log(`Estimated gas: ${quote.estimatedGas}`);
console.log(`Protocols used: ${quote.protocols.join(', ')}`);

// Execute swap via 1inch
const result = await executeOneInchSwap({
  chain: 'ethereum',
  fromToken: 'ETH',
  toToken: 'USDC',
  amount: '1000000000000000000',
  slippage: 0.5,
});

// Get available protocols
const protocols = await getOneInchProtocols('ethereum');
// ['UNISWAP_V3', 'SUSHISWAP', 'CURVE', ...]

// Compare routes between Uniswap and 1inch
const comparison = await compareDexRoutes({
  chain: 'ethereum',
  tokenIn: 'ETH',
  tokenOut: 'USDC',
  amountIn: '1000000000000000000',
});

console.log(`Uniswap: ${comparison.uniswap.amountOut}`);
console.log(`1inch: ${comparison.oneinch.amountOut}`);
console.log(`Best: ${comparison.best}`);
```

---

## Chain-Specific Examples

### Ethereum

```typescript
// Swap ETH → USDC on Ethereum with MEV protection
const result = await executeUniswapSwap({
  chain: 'ethereum',
  tokenIn: 'ETH',
  tokenOut: 'USDC',
  amountIn: '1000000000000000000',
  useMevProtection: true,  // Uses Flashbots
});
```

### Arbitrum

```typescript
// Swap on Arbitrum (lower gas)
const result = await executeOneInchSwap({
  chain: 'arbitrum',
  fromToken: 'ETH',
  toToken: 'ARB',
  amount: '500000000000000000',  // 0.5 ETH
  slippage: 1,
});
```

### Base

```typescript
// Swap on Base
const result = await executeUniswapSwap({
  chain: 'base',
  tokenIn: 'ETH',
  tokenOut: 'DEGEN',
  amountIn: '100000000000000000',  // 0.1 ETH
  slippageTolerance: 2,  // Higher slippage for meme coins
});
```

### Optimism

```typescript
// Swap on Optimism
const result = await executeOneInchSwap({
  chain: 'optimism',
  fromToken: 'USDC',
  toToken: 'OP',
  amount: '100000000',  // 100 USDC (6 decimals)
  slippage: 0.5,
});
```

### Polygon

```typescript
// Swap on Polygon
const result = await executeUniswapSwap({
  chain: 'polygon',
  tokenIn: 'MATIC',
  tokenOut: 'USDC',
  amountIn: '10000000000000000000',  // 10 MATIC
  slippageTolerance: 0.5,
});
```

---

## Common Tokens

### Ethereum

| Symbol | Address |
|--------|---------|
| ETH | Native |
| USDC | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 |
| USDT | 0xdAC17F958D2ee523a2206206994597C13D831ec7 |
| WETH | 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 |
| DAI | 0x6B175474E89094C44Da98b954EescdeCB5BE3830 |

### Arbitrum

| Symbol | Address |
|--------|---------|
| ETH | Native |
| ARB | 0x912CE59144191C1204E64559FE8253a0e49E6548 |
| USDC | 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 |

### Base

| Symbol | Address |
|--------|---------|
| ETH | Native |
| USDC | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |
| DEGEN | 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed |

### Optimism

| Symbol | Address |
|--------|---------|
| ETH | Native |
| OP | 0x4200000000000000000000000000000000000042 |
| USDC | 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85 |

---

## MEV Protection

### Ethereum (Flashbots)

```typescript
// Automatically uses Flashbots Protect RPC
const result = await executeUniswapSwap({
  chain: 'ethereum',
  useMevProtection: true,  // Sends via Flashbots
  ...
});
```

### L2 Chains

L2s (Arbitrum, Optimism, Base) have sequencer-level MEV protection by default.

---

## Gas Estimation

```typescript
// Get gas estimate before swapping
const quote = await getUniswapQuote({ ... });
console.log(`Estimated gas: ${quote.gasEstimate}`);
console.log(`Gas price: ${quote.gasPrice} gwei`);
console.log(`Total gas cost: ${quote.gasCostUsd} USD`);
```

---

## Error Handling

```typescript
import { EvmSwapError, InsufficientBalanceError, SlippageExceededError } from 'clodds/evm';

try {
  await executeUniswapSwap({ ... });
} catch (error) {
  if (error instanceof InsufficientBalanceError) {
    console.log('Not enough balance');
  } else if (error instanceof SlippageExceededError) {
    console.log('Price moved, increase slippage');
  }
}
```
