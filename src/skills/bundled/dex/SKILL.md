---
name: dex
description: "Cross-chain DEX market intelligence - trending tokens, gainers, losers, volume, stats across all chains and protocols"
command: dex
emoji: "📊"
---

# DEX Market Intelligence

Cross-chain, cross-DEX market data powered by DexScreener. No API key needed. Works across Solana, Ethereum, BSC, Base, Arbitrum, and 10+ more chains.

**Use this skill when users ask about:**
- What's trending, what's hot, what's pumping on any chain or DEX
- Top gainers or losers (24h or right now)
- Token volume, liquidity, price changes, transaction counts
- Market data for any token on any chain
- Comparing tokens across different DEXes
- Virtuals Protocol, Clanker, Aerodrome, PumpSwap, Raydium, Uniswap, PancakeSwap tokens
- "What's the most active token right now?"
- "Show me the top movers on Base/Ethereum/Solana"

## Discovery Commands

```
/dex trending [filter]    Top tokens by 24h volume
/dex gainers [filter]     Top 24h price gainers
/dex losers [filter]      Top 24h price losers
/dex hot [filter]         Most active right now (1h transactions)
/dex new [filter]         Newest token profiles
/dex boosted              DexScreener trending/boosted tokens
```

**Filter** can be a chain OR a specific DEX/protocol:

| Filter | What it covers |
|--------|---------------|
| `solana` / `sol` | All Solana DEXes |
| `ethereum` / `eth` | All Ethereum DEXes |
| `bsc` / `bnb` | All BSC DEXes |
| `base` | All Base chain DEXes |
| `arbitrum` / `arb` | All Arbitrum DEXes |
| `pumpfun` / `pump` | Pump.fun tokens only |
| `pumpswap` | PumpSwap AMM tokens |
| `raydium` | Raydium tokens |
| `orca` | Orca tokens |
| `meteora` | Meteora tokens |
| `virtuals` | Virtuals Protocol (Base) |
| `clanker` | Clanker tokens (Base) |
| `aerodrome` | Aerodrome DEX (Base) |
| `uniswap` | Uniswap (Ethereum) |
| `pancakeswap` | PancakeSwap (BSC) |

**Examples:**
```
/dex trending solana          What's hot on Solana?
/dex trending pumpfun         Top pump.fun tokens by volume
/dex gainers virtuals         Virtuals Protocol top gainers
/dex losers ethereum          What dumped on Ethereum?
/dex hot base                 Most active on Base right now
/dex trending                 Top across ALL chains
```

## Token Data Commands

```
/dex token <address> [chain]    Full stats: price, volume, liquidity, txns, price changes
/dex pairs <address> [chain]    All trading pairs for a token
/dex search <query>             Search any token across all chains
```

**Examples:**
```
/dex token EPjFW...Dt1v solana
/dex search PEPE
/dex pairs 0x1234... eth
```

## Data Available Per Token

- Price (USD and native)
- Market cap / FDV
- Liquidity (USD)
- Volume: 5m, 1h, 6h, 24h
- Price change: 5m, 1h, 6h, 24h
- Transaction counts: buys vs sells at each timeframe
- DEX / pool info
- All trading pairs
