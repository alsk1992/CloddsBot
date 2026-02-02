---
name: clanker
description: "Deploy ERC20 tokens with Uniswap V4 pools on Base, Ethereum, Arbitrum"
command: clanker
emoji: "🪙"
gates:
  envs:
    - PRIVATE_KEY
---

# Clanker - Token Deployment

Deploy production-ready ERC20 tokens with built-in Uniswap V4 liquidity pools using the Clanker SDK.

## Setup

```bash
export PRIVATE_KEY=0x...your_private_key
export BASE_RPC_URL=https://mainnet.base.org  # Optional
```

## Commands

### Deployment
```
/clanker deploy <name> <symbol> [options]   Deploy new token
/clanker simulate <name> <symbol> [opts]    Simulate deployment (no tx)
```

### Post-Deployment
```
/clanker claim-vault <token>                Claim vested tokens
/clanker claim-rewards <token>              Claim trading fee rewards
/clanker update-metadata <token> <json>     Update token metadata
/clanker update-image <token> <ipfs://...>  Update token image
```

### Info
```
/clanker info <token>                       Get token info
/clanker rewards <token>                    Check available rewards
/clanker vault <token>                      Check vested tokens
```

## Deploy Options

```
--image <ipfs://...>          Token image (IPFS)
--description "..."           Token description
--twitter <handle>            Twitter/X handle
--telegram <handle>           Telegram handle
--website <url>               Website URL
--vault <percent>             Vault percentage (vesting)
--vault-lockup <days>         Vault lockup period
--vault-vesting <days>        Vault vesting duration
--dev-buy <eth>               Initial purchase amount
--market-cap <eth>            Starting market cap
--vanity                      Generate vanity address
--chain <base|eth|arb>        Target chain (default: base)
```

## Examples

### Simple Token
```
/clanker deploy "My Token" TKN --image ipfs://Qm... --vanity
```

### With Vesting
```
/clanker deploy "Creator Token" CTK \
  --vault 10 \
  --vault-lockup 30 \
  --vault-vesting 30
```

### With Dev Buy
```
/clanker deploy "Launch Token" LTK \
  --dev-buy 0.1 \
  --market-cap 5
```

### Full Config
```
/clanker deploy "Community Token" CMT \
  --image ipfs://Qm... \
  --description "Community-owned token" \
  --twitter mytoken \
  --website https://mytoken.xyz \
  --vault 10 \
  --vault-lockup 7 \
  --vault-vesting 30 \
  --vanity \
  --chain base
```

## Supported Chains

| Chain | ID | Status |
|-------|-----|--------|
| Base | 8453 | Full support |
| Ethereum | 1 | Full support |
| Arbitrum | 42161 | Full support |

## Token Configuration

- **Supply**: 100 billion (fixed)
- **Max vault**: 90% (min 10% to LP)
- **Max extensions**: 10
- **Max reward recipients**: 7

## Fees & Protection

- Default sniper protection: 66% → 4% over 15 seconds
- Trading fees distributed to configured recipients
- 80% creator / 20% interface split by default

## Best Practices

1. **Test first** - Use `/clanker simulate` before real deployment
2. **Quality images** - Upload to IPFS before deploying
3. **Configure vesting** - Lock tokens to build trust
4. **Use vanity** - Memorable addresses help marketing
5. **Deploy on Base** - Lower gas fees than mainnet
