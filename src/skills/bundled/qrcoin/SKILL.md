---
name: qrcoin
description: "Participate in QR Coin auctions on Base - bid to display URLs on QR codes"
command: qr
emoji: "📱"
gates:
  envs:
    - PRIVATE_KEY
---

# QR Coin Auction

Participate in [QR Coin](https://qrcoin.fun) auctions on Base blockchain. Bid to display URLs on QR codes.

## Contracts (Base)

| Contract | Address |
|----------|---------|
| QR Auction | `0x7309779122069EFa06ef71a45AE0DB55A259A176` |
| USDC | `0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913` |

## How It Works

1. Each auction runs ~24 hours
2. Bidders submit URLs with USDC
3. Creating a new bid: ~11.11 USDC
4. Contributing to existing bid: ~1.00 USDC
5. Highest bid wins; winner's URL encoded in QR code

## Commands

### Status
```
/qr status                       Current auction info
/qr bids                         List active bids
/qr reserves                     Check reserve prices
```

### Bidding
```
/qr bid <url> <name>             Create new bid (~11 USDC)
/qr contribute <url> <name>      Contribute to existing bid (~1 USDC)
/qr approve <amount>             Approve USDC for bidding
```

## Examples

```
/qr status
/qr bid https://mysite.com "MyProject"
/qr contribute https://mysite.com "MyProject"
```

## Setup

```bash
export PRIVATE_KEY="0x..."  # Your wallet key
```

Requires USDC on Base for bidding.
