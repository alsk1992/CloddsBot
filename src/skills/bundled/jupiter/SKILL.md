---
name: jupiter
description: "Jupiter DEX aggregator - swaps, limit orders, and DCA on Solana"
command: jup
emoji: "🪐"
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Jupiter Aggregator

Jupiter finds the best swap routes across all Solana DEXes, plus limit orders and DCA (Dollar Cost Averaging).

## Commands

### Swaps
```
/jup swap <amount> <from> to <to>    Execute swap via Jupiter
/jup quote <amount> <from> to <to>   Get quote without executing
/jup route <from> <to> <amount>      Show detailed route info
```

### Limit Orders
```
/jup limit create <sell> <from> for <buy> <to>   Create limit order
/jup limit cancel <order_pubkey>                  Cancel limit order
/jup limit list                                   List your open orders
/jup limit history                                Order history
```

### DCA (Dollar Cost Averaging)
```
/jup dca create <total> <from> to <to> every <interval>   Create DCA
/jup dca close <dca_pubkey>                               Close DCA
/jup dca list                                             List active DCAs
/jup dca deposit <dca_pubkey> <amount>                    Add funds
/jup dca withdraw <dca_pubkey>                            Withdraw funds
```

## Examples

### Swaps
```
/jup swap 1 SOL to USDC
/jup quote 100 USDC to JUP
/jup route SOL BONK 1
```

### Limit Orders
```
/jup limit create 1 SOL for 250 USDC        # Sell 1 SOL when price hits $250
/jup limit create 100 USDC for 0.5 SOL      # Buy SOL at $200
/jup limit list
/jup limit cancel ABC123...
```

### DCA
```
/jup dca create 10 SOL to USDC every 1 day   # DCA 10 SOL into USDC daily
/jup dca create 1000 USDC to JUP every 1 hour # Accumulate JUP hourly
/jup dca list
/jup dca close XYZ789...
```

## Features

- Best route across 20+ DEXes
- Automatic route splitting
- MEV protection
- Priority fee support
- **Limit Orders** - set target prices
- **DCA** - automated periodic swaps

## Tools Available

### Swap Tools
| Tool | Description |
|------|-------------|
| `solana_jupiter_swap` | Execute swap |
| `solana_jupiter_quote` | Get quote (no execution) |

### Limit Order Tools
| Tool | Description |
|------|-------------|
| `solana_jupiter_limit_order_create` | Create limit order |
| `solana_jupiter_limit_order_cancel` | Cancel order |
| `solana_jupiter_limit_orders_list` | List open orders |
| `solana_jupiter_limit_order_get` | Get order details |
| `solana_jupiter_limit_order_history` | Order history |
| `solana_jupiter_trade_history` | Trade fill history |

### DCA Tools
| Tool | Description |
|------|-------------|
| `solana_jupiter_dca_create` | Create DCA order |
| `solana_jupiter_dca_close` | Close DCA |
| `solana_jupiter_dca_deposit` | Add funds |
| `solana_jupiter_dca_withdraw` | Withdraw funds |
| `solana_jupiter_dca_list` | List active DCAs |
| `solana_jupiter_dca_get` | Get DCA details |
| `solana_jupiter_dca_balance` | Check balances |
| `solana_jupiter_dca_fills` | Fill history |

## TypeScript API

```typescript
import {
  // Swaps
  executeJupiterSwap,
  getJupiterQuote,

  // Limit Orders
  createJupiterLimitOrder,
  cancelJupiterLimitOrder,
  listJupiterLimitOrders,
  getJupiterLimitOrder,
  getJupiterLimitOrderHistory,
  getJupiterTradeHistory,

  // DCA
  createJupiterDCA,
  closeJupiterDCA,
  depositJupiterDCA,
  withdrawJupiterDCA,
  listJupiterDCAs,
  getJupiterDCA,
  getJupiterDCABalance,
  getJupiterDCAFillHistory,
} from 'clodds/solana/jupiter';

// Swap example
const swap = await executeJupiterSwap(connection, keypair, {
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '1000000000', // 1 SOL
  slippageBps: 50,
});

// Limit order example
const order = await createJupiterLimitOrder(connection, keypair, {
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  inAmount: '1000000000',   // Sell 1 SOL
  outAmount: '250000000',   // For 250 USDC (min)
});

// DCA example
const dca = await createJupiterDCA(connection, keypair, {
  inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  outputMint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  inAmount: '100000000',           // Total 100 USDC
  inAmountPerCycle: '10000000',    // 10 USDC per swap
  cycleSecondsApart: 3600,         // Every hour
});
```

## Environment Variables

```bash
SOLANA_PRIVATE_KEY=<base58 or JSON array>
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com  # optional
```
