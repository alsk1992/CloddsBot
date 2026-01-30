---
name: trading-solana
description: "Trade tokens on Solana DEXes - Jupiter, Raydium, Orca, Meteora, Pump.fun"
emoji: "☀️"
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Solana DEX Trading - Complete API Reference

Trade any token on Solana using Jupiter aggregator, Raydium, Orca Whirlpools, Meteora DLMM, and Pump.fun.

## Required Environment Variables

```bash
SOLANA_PRIVATE_KEY=base58_or_json_array    # Your Solana wallet private key
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com  # Optional: custom RPC
```

---

## Chat Commands

### Swaps

```
/swap sol <amount> <from> to <to>           # Swap tokens on Solana
/swap sol 1 SOL to USDC                     # Swap 1 SOL to USDC
/swap sol 100 USDC to JUP                   # Swap 100 USDC to JUP
/swap sol 0.5 SOL to BONK                   # Swap 0.5 SOL to BONK
```

### Quotes

```
/quote sol <amount> <from> to <to>          # Get swap quote without executing
/quote sol 1 SOL to USDC                    # Quote 1 SOL → USDC
```

### Pool Discovery

```
/pools sol <token>                          # List liquidity pools for token
/pools sol SOL                              # All SOL pools
/pools sol BONK                             # All BONK pools
```

### Balances

```
/balance sol                                # Check SOL and token balances
/balance sol <token>                        # Check specific token balance
```

---

## Supported DEXes

| DEX | Type | Features |
|-----|------|----------|
| Jupiter | Aggregator | Best route across all DEXes, lowest slippage |
| Raydium | AMM | Concentrated liquidity, high volume |
| Orca | Whirlpool | Concentrated liquidity pools |
| Meteora | DLMM | Dynamic liquidity market maker |
| Pump.fun | Launchpad | New token launches |

---

## TypeScript API Reference

### Jupiter (Aggregator - Recommended)

```typescript
import { executeJupiterSwap } from 'clodds/solana/jupiter';

// Execute swap via Jupiter (best route)
const result = await executeJupiterSwap({
  inputMint: 'So11111111111111111111111111111111111111112',  // SOL
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  amount: 1_000_000_000,  // 1 SOL in lamports
  slippageBps: 50,        // 0.5% slippage
});

console.log(`Swapped: ${result.inAmount} → ${result.outAmount}`);
console.log(`TX: ${result.signature}`);
```

### Raydium

```typescript
import { executeRaydiumSwap, getRaydiumQuote, listRaydiumPools } from 'clodds/solana/raydium';

// Get quote
const quote = await getRaydiumQuote({
  inputMint: 'SOL',
  outputMint: 'USDC',
  amount: 1_000_000_000,
});
console.log(`Expected output: ${quote.outAmount}`);

// Execute swap
const result = await executeRaydiumSwap({
  inputMint: 'SOL',
  outputMint: 'USDC',
  amount: 1_000_000_000,
  slippage: 0.5,
});

// List pools
const pools = await listRaydiumPools({ token: 'SOL' });
```

### Orca Whirlpools

```typescript
import { executeOrcaWhirlpoolSwap, getOrcaWhirlpoolQuote, listOrcaWhirlpoolPools } from 'clodds/solana/orca';

// Get quote
const quote = await getOrcaWhirlpoolQuote({
  inputMint: 'SOL',
  outputMint: 'USDC',
  amount: 1_000_000_000,
});

// Execute swap
const result = await executeOrcaWhirlpoolSwap({
  inputMint: 'SOL',
  outputMint: 'USDC',
  amount: 1_000_000_000,
  slippage: 0.5,
});

// List pools
const pools = await listOrcaWhirlpoolPools({ token: 'SOL' });
```

### Meteora DLMM

```typescript
import { executeMeteoraDlmmSwap, getMeteoraDlmmQuote, listMeteoraDlmmPools } from 'clodds/solana/meteora';

// Get quote
const quote = await getMeteoraDlmmQuote({
  inputMint: 'SOL',
  outputMint: 'USDC',
  amount: 1_000_000_000,
});

// Execute swap
const result = await executeMeteoraDlmmSwap({
  inputMint: 'SOL',
  outputMint: 'USDC',
  amount: 1_000_000_000,
  slippage: 0.5,
});

// List pools
const pools = await listMeteoraDlmmPools({ token: 'SOL' });
```

### Pump.fun

```typescript
import { executePumpFunTrade } from 'clodds/solana/pumpapi';

// Buy token on Pump.fun
const result = await executePumpFunTrade({
  mint: 'token_mint_address',
  action: 'buy',
  amount: 0.1,  // SOL amount
  slippage: 5,  // 5% slippage for volatile tokens
});

// Sell token
const result = await executePumpFunTrade({
  mint: 'token_mint_address',
  action: 'sell',
  amount: 1000000,  // Token amount
  slippage: 5,
});
```

### Token Resolution

```typescript
import { resolveTokenMints, getTokenList } from 'clodds/solana/tokenlist';

// Resolve token symbols to mint addresses
const mints = await resolveTokenMints(['SOL', 'USDC', 'JUP', 'BONK']);
// ['So111...', 'EPjF...', '...', '...']

// Get full token list
const tokens = await getTokenList();
```

### Pool Discovery

```typescript
import { listAllPools, selectBestPool } from 'clodds/solana/pools';

// List all pools for a token pair
const pools = await listAllPools({
  inputMint: 'SOL',
  outputMint: 'USDC',
});

// Select best pool based on liquidity
const best = await selectBestPool({
  inputMint: 'SOL',
  outputMint: 'USDC',
  amount: 1_000_000_000,
});
```

### Wallet Utilities

```typescript
import { loadSolanaKeypair, getSolanaConnection, signAndSendTransaction } from 'clodds/solana/wallet';

// Load keypair from env
const keypair = loadSolanaKeypair();

// Get connection
const connection = getSolanaConnection();

// Sign and send transaction
const signature = await signAndSendTransaction(connection, transaction, keypair);
```

---

## Token Symbols

Common token symbols that can be used:

| Symbol | Name | Mint Address |
|--------|------|--------------|
| SOL | Solana | So11111111111111111111111111111111111111112 |
| USDC | USD Coin | EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v |
| USDT | Tether | Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB |
| JUP | Jupiter | JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN |
| BONK | Bonk | DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 |
| WIF | dogwifhat | EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm |
| PYTH | Pyth | HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3 |

---

## Slippage Settings

| Token Type | Recommended Slippage |
|------------|---------------------|
| Major (SOL, USDC) | 0.5% |
| Mid-cap | 1-2% |
| Small-cap / Meme | 3-5% |
| New launches | 5-10% |

---

## Error Handling

```typescript
import { SolanaSwapError, InsufficientBalanceError, SlippageExceededError } from 'clodds/solana';

try {
  await executeJupiterSwap({ ... });
} catch (error) {
  if (error instanceof InsufficientBalanceError) {
    console.log('Not enough balance');
  } else if (error instanceof SlippageExceededError) {
    console.log('Price moved too much, increase slippage');
  }
}
```
