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
| Jupiter | Aggregator | Best route across all DEXes, limit orders, DCA |
| Raydium | AMM | Concentrated liquidity, high volume |
| Orca | Whirlpool | Concentrated liquidity pools, LP management |
| Meteora | DLMM | Dynamic liquidity market maker, LP management |
| Pump.fun | Launchpad | New token launches |

---

## TypeScript API Reference

### Jupiter (Aggregator - Recommended)

```typescript
import {
  executeJupiterSwap,
  getJupiterQuote,
  createJupiterLimitOrder,
  cancelJupiterLimitOrder,
  listJupiterLimitOrders,
  createJupiterDCA,
  closeJupiterDCA,
  listJupiterDCAs,
} from 'clodds/solana/jupiter';

// Execute swap via Jupiter (best route)
const result = await executeJupiterSwap(connection, keypair, {
  inputMint: 'So11111111111111111111111111111111111111112',  // SOL
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  amount: '1000000000',  // 1 SOL in lamports
  slippageBps: 50,       // 0.5% slippage
});

console.log(`Swapped: ${result.inAmount} → ${result.outAmount}`);
console.log(`TX: ${result.signature}`);
```

#### Jupiter Limit Orders

```typescript
// Create limit order - sell 1 SOL for minimum 250 USDC
const order = await createJupiterLimitOrder(connection, keypair, {
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  inAmount: '1000000000',  // 1 SOL
  outAmount: '250000000',  // 250 USDC
  expiredAtMs: Date.now() + 7 * 24 * 60 * 60 * 1000, // 1 week expiry
});
console.log(`Order created: ${order.orderPubKey}`);

// List open orders
const orders = await listJupiterLimitOrders(connection, keypair.publicKey.toBase58());
console.log(`Open orders: ${orders.length}`);

// Cancel order
await cancelJupiterLimitOrder(connection, keypair, order.orderPubKey);
```

#### Jupiter DCA (Dollar Cost Averaging)

```typescript
// Create DCA - swap 100 USDC to JUP, 10 USDC every hour
const dca = await createJupiterDCA(connection, keypair, {
  inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  outputMint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
  inAmount: '100000000',        // Total 100 USDC
  inAmountPerCycle: '10000000', // 10 USDC per swap
  cycleSecondsApart: 3600,      // Every hour (min 30 seconds)
});
console.log(`DCA created: ${dca.dcaPubKey}`);

// List active DCAs
const dcas = await listJupiterDCAs(connection, keypair.publicKey.toBase58());

// Close DCA and withdraw remaining funds
await closeJupiterDCA(connection, keypair, dca.dcaPubKey);
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
