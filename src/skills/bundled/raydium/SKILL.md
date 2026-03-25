---
name: raydium
description: "Execute token swaps, manage CLMM concentrated liquidity positions, and provide AMM liquidity on Raydium DEX (Solana). Use when users ask about Raydium pools, swaps, or LP management."
command: ray
emoji: "💜"
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Raydium DEX

Raydium is a high-volume DEX on Solana with AMM pools and CLMM (Concentrated Liquidity Market Maker) pools.

## Commands

### Swaps
```
/ray swap <amount> <from> to <to>    Execute swap on Raydium
/ray quote <amount> <from> to <to>   Get quote without executing
/ray pools <token>                   List pools for token
```

### CLMM (Concentrated Liquidity)
```
/ray clmm positions                  List your CLMM positions
/ray clmm create <pool> <lower> <upper> <amount>   Open position
/ray clmm add <pool> <nft> <amount>  Add liquidity to position
/ray clmm remove <pool> <nft> [%]    Remove liquidity
/ray clmm close <pool> <nft>         Close position
/ray clmm harvest                    Harvest all rewards
```

### AMM Liquidity
```
/ray amm add <pool> <amountA> [amountB]   Add liquidity
/ray amm remove <pool> <lpAmount>         Remove liquidity
```

## Examples

### Swaps
```
/ray swap 1 SOL to USDC
/ray quote 100 USDC to RAY
/ray pools SOL
```

### CLMM Positions
```
/ray clmm positions                              # List all positions
/ray clmm create ABC123... 100 200 1000000000   # Open position with price range
/ray clmm add ABC123... NFT456... 500000000     # Add liquidity
/ray clmm remove ABC123... NFT456... 50         # Remove 50%
/ray clmm harvest                                # Harvest rewards
```

## Pool Types

| Type | Description | Features |
|------|-------------|----------|
| AMM (V4) | Standard constant-product AMM | Simple, high volume |
| CLMM | Concentrated liquidity | Capital efficient, earn fees in range |
| CPMM | Constant product (newer) | Lower fees |

## Tools Available

### Swap Tools
| Tool | Description |
|------|-------------|
| `raydium_swap` | Execute swap via Raydium |
| `raydium_quote` | Get quote without executing |
| `raydium_pools` | List available pools |

### CLMM Tools
| Tool | Description |
|------|-------------|
| `raydium_clmm_positions` | List your CLMM positions |
| `raydium_clmm_create_position` | Open new concentrated liquidity position |
| `raydium_clmm_increase_liquidity` | Add liquidity to existing position |
| `raydium_clmm_decrease_liquidity` | Remove liquidity from position |
| `raydium_clmm_close_position` | Close an empty position |
| `raydium_clmm_harvest` | Harvest fees and rewards |
| `raydium_clmm_swap` | Swap directly on a specific CLMM pool |
| `raydium_clmm_create_pool` | Create new CLMM pool |
| `raydium_clmm_configs` | Get available fee tier configs |

### AMM Tools
| Tool | Description |
|------|-------------|
| `raydium_amm_add_liquidity` | Add liquidity to AMM pool |
| `raydium_amm_remove_liquidity` | Remove liquidity from AMM pool |

## TypeScript API

```typescript
import {
  // Swaps
  executeRaydiumSwap,
  getRaydiumQuote,
  listRaydiumPools,

  // CLMM (Concentrated Liquidity)
  getClmmPositions,
  createClmmPosition,
  increaseClmmLiquidity,
  decreaseClmmLiquidity,
  closeClmmPosition,
  harvestClmmRewards,
  swapClmm,
  createClmmPool,
  getClmmConfigs,

  // AMM Liquidity
  addAmmLiquidity,
  removeAmmLiquidity,
} from 'clodds/solana/raydium';

// Execute swap
const swap = await executeRaydiumSwap(connection, keypair, {
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '1000000000', // 1 SOL in lamports
  slippageBps: 50,
});

// Open CLMM position
const position = await createClmmPosition(connection, keypair, {
  poolId: 'POOL_ID_HERE',
  priceLower: 100,
  priceUpper: 200,
  baseAmount: '1000000000', // 1 SOL
  slippage: 0.01,
});
console.log(`Position NFT: ${position.nftMint}`);

// List positions
const positions = await getClmmPositions(connection, keypair);
for (const pos of positions) {
  console.log(`Pool: ${pos.poolId}, Liquidity: ${pos.liquidity}`);
}

// Add liquidity to position
await increaseClmmLiquidity(connection, keypair, {
  poolId: 'POOL_ID_HERE',
  positionNftMint: 'NFT_MINT_HERE',
  amountA: '500000000', // 0.5 SOL
});

// Harvest rewards
const rewards = await harvestClmmRewards(connection, keypair);
console.log(`Harvested: ${rewards.signatures.length} transactions`);

// AMM: Add liquidity
await addAmmLiquidity(connection, keypair, {
  poolId: 'AMM_POOL_ID',
  amountA: '1000000000',
  fixedSide: 'a',
  slippage: 0.01,
});

// AMM: Remove liquidity
await removeAmmLiquidity(connection, keypair, {
  poolId: 'AMM_POOL_ID',
  lpAmount: '1000000', // LP tokens to burn
  slippage: 0.1,
});
```

## Environment Variables

```bash
SOLANA_PRIVATE_KEY=<base58 or JSON array>
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com  # optional
```

## CLMM Position Management

### Opening a Position

1. Choose a pool (e.g., SOL-USDC)
2. Set price range (lower, upper)
3. Deposit tokens - you'll provide both tokens proportionally

### Managing Positions

- **Add liquidity**: Deposit more tokens to existing position
- **Remove liquidity**: Withdraw tokens (partial or full)
- **Harvest**: Collect trading fees earned
- **Close**: Close position after removing all liquidity

### Price Range Strategy

| Strategy | Range | Risk/Reward |
|----------|-------|-------------|
| Wide range | 50% - 200% of current | Lower fees, less IL |
| Narrow range | 95% - 105% | Higher fees, more IL risk |
| Full range | 0 - infinity | Like standard AMM |
