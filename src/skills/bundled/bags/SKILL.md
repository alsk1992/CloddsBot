---
name: bags
description: "Bags.fm - Complete Solana token launchpad with creator monetization"
command: bags
emoji: "💰"
gates:
  envs:
    - BAGS_API_KEY
---

# Bags.fm - Complete API Coverage

Bags.fm is a Solana token launchpad and trading platform with creator monetization. Creators earn 1% of all trading volume on their tokens.

## Trading

```
/bags quote <amount> <from> to <to>    Get swap quote
/bags swap <amount> <from> to <to>     Execute swap
```

## Discovery

```
/bags pools                            List all Bags pools
/bags trending                         Show trending tokens by volume
/bags token <mint>                     Full token info (metadata, creators, fees, market data)
/bags creators <mint>                  Get token creators and fee shares
/bags lifetime-fees <mint>             Total fees collected for a token
```

## Fee Claiming

```
/bags fees [wallet]                    Check claimable fees (all positions)
/bags claim [wallet]                   Claim all accumulated fees
/bags claim-events <mint> [--from X] [--to Y]  Get claim history with time filters
/bags stats <mint>                     Per-claimer statistics
```

## Token Launch

```
/bags launch <name> <symbol> <desc> [options]  Launch new token
/bags launch-info                              Show launch requirements and fees
```

**Launch Options:**
- `--image <url>` - Token image URL
- `--twitter <handle>` - Twitter handle
- `--website <url>` - Website URL
- `--telegram <url>` - Telegram URL
- `--initial <SOL>` - Initial buy amount in SOL

## Fee Share Configuration

```
/bags fee-config <mint> <wallet:bps>...   Create fee distribution (bps must sum to 10000)
```

**Examples:**
```
/bags fee-config <mint> wallet1:5000 wallet2:5000   # 50/50 split
/bags fee-config <mint> wallet1:7000 wallet2:3000   # 70/30 split
```

## Wallet Lookup (Social -> Wallet)

```
/bags wallet <provider> <username>        Lookup wallet by social handle
/bags wallets <provider> <user1,user2>    Bulk wallet lookup
```

**Providers:** twitter, github, kick, tiktok

## Partner System

```
/bags partner-config <mint>              Create partner key for referral fees
/bags partner-claim [wallet]             Claim accumulated partner fees
/bags partner-stats <partner-key>        View partner statistics
```

## Examples

```
# Trading
/bags quote 1 SOL to USDC
/bags swap 0.5 SOL to BONK

# Discovery
/bags trending
/bags token ABC123...

# Launch a token
/bags launch "Moon Token" MOON "To the moon!" --twitter moontoken --initial 0.1

# Check and claim fees
/bags fees
/bags claim

# Set up 50/50 fee share
/bags fee-config <mint> wallet1:5000 wallet2:5000

# Lookup wallet by Twitter
/bags wallet twitter elonmusk
```

## Configuration

```bash
export BAGS_API_KEY="your-api-key"           # From dev.bags.fm
export SOLANA_PRIVATE_KEY="your-private-key" # For signing swaps/launches
```

## API Reference

- Base URL: `https://public-api-v2.bags.fm/api/v1/`
- Auth: `x-api-key` header
- Rate limit: 1000 requests/hour
- Get your API key at [dev.bags.fm](https://dev.bags.fm)

## Features

- Token launching with 1% creator fees
- Up to 100 fee claimers per token (with automatic lookup tables)
- Meteora DAMM v2 pool integration
- Virtual pool and custom vault fee claiming
- Partner referral system
- Social wallet lookup (Twitter, GitHub, Kick, TikTok)
- Jito bundle support for launches
