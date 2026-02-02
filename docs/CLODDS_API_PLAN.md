# Clodds Hosted API Plan

## Bankr's Model (Verified Jan 2026)

**Pay-per-prompt via x402 protocol:**
- **$0.10 USDC per API request** (or equivalent in $BNKR token)
- No API key needed - just a wallet
- x402 handles payment automatically

**How it works:**
```
Your app → Bankr API → HTTP 402 "Payment Required"
         ← Pay $0.10 USDC via x402
         → Execute prompt, return result
```

**Two-Phase Rollout:**
1. Phase 1: Pay BNKR per prompt via x402, returns tx execution data
2. Phase 2: Wallet creation - agents/apps get full control through Bankr

## Clodds API Architecture

### Endpoints

```
POST /v2/prompt              # Submit natural language prompt (x402 payment)
GET  /v2/job/:id             # Check job status
POST /v2/job/:id/cancel      # Cancel pending job
```

### x402 Flow

```
Client                           Clodds API
  |                                  |
  |-- POST /v2/prompt -------------->|
  |                                  |
  |<-- 402 Payment Required ---------|
  |    X-Payment-Address: 0x...      |
  |    X-Payment-Amount: 0.10        |
  |    X-Payment-Token: USDC         |
  |                                  |
  |-- Pay USDC via Base ------------>|
  |                                  |
  |-- POST /v2/prompt + proof ------>|
  |                                  |
  |<-- 202 { jobId: "..." } ---------|
  |                                  |
  |-- GET /v2/job/:id -------------->|
  |<-- { status: "completed", ... }--|
```

### Pricing Strategy

| Tier | Price | Features |
|------|-------|----------|
| Basic | $0.05/prompt | Simple queries, prices, balances |
| Standard | $0.10/prompt | Trades, swaps, analysis |
| Complex | $0.25/prompt | Multi-step, automation setup |

Or flat $0.08/prompt to undercut Bankr.

### Revenue Model

- **Per-prompt fees**: $0.05-0.10 USDC
- **Trading fees**: 0.1% of volume (optional)
- **Premium features**: Copy trading, signals, webhooks
- **Subscription**: "Clodds Club" for unlimited prompts

## Implementation

### New Files

```
src/api/
  x402-gateway.ts       # x402 payment verification
  prompt-handler.ts     # Natural language → action
  job-manager.ts        # Async job queue

src/custody/
  wallet-manager.ts     # Managed wallets per user
  key-derivation.ts     # HD wallet derivation
```

### Clodds Already Has

- `src/x402/` - x402 protocol implementation ✅
- `src/agents/` - AI agent with tools ✅
- `src/execution/` - Trade execution ✅
- `src/solana/`, `src/evm/` - Chain support ✅

### Missing

- Hosted wallet custody
- Job queue (Redis/BullMQ)
- x402 payment verification middleware
- Usage metering/billing

## Comparison: Clodds vs Bankr

| Feature | Bankr | Clodds (Planned) |
|---------|-------|------------------|
| Chains | Base, ETH, Polygon, Solana, Unichain | Same + Arbitrum, Optimism |
| Prediction Markets | Polymarket | Polymarket, Kalshi, Betfair, + 6 more |
| Futures | Avantis only | Binance, Bybit, Hyperliquid, MEXC |
| Copy Trading | No | Yes (Solana wallets) |
| Signals | No | Yes (RSS, Twitter, webhooks) |
| Weather Betting | No | Yes (NOAA + Polymarket) |
| AI Strategy | Basic | Full NL → DCA, triggers, ladders |
| Swarm Trading | No | Yes (20 wallets, Jito bundles) |
| Price | $0.10/prompt | $0.08/prompt (undercut) |
| Open Source | No | Yes |

## Timeline

1. **Now**: Port openclaw skills → more features than Bankr
2. **Week 2**: Build x402 API gateway
3. **Week 3**: Add custody wallet system
4. **Week 4**: Launch beta API

## Sources

- [Bankr SDK x402 announcement](https://x.com/bankrbot/status/1950531042823282862)
- [Bankr SDK npm - $0.10/request](https://www.npmjs.com/package/@bankr/sdk)
- [x402 Protocol](https://www.x402.org/)
- [Bankr develops API](https://www.bitget.com/news/detail/12560604882820)
