---
name: agent-kiosk
description: "x402 & MCP intelligence for trading agents: Polymarket/Kalshi arbitrage, Hyperliquid/dYdX funding spreads, Base pre-swap safety gate, AML compliance, and executable EVM swap calldata"
command: kiosk
emoji: "🏪"
homepage: "https://agent-kiosk.vercel.app"
commands:
  - /kiosk
  - /agent-kiosk
---

# Agent Kiosk (x402 & MCP Intelligence)

Attested market intelligence, pre-trade token safety checks, cross-venue prediction/perp arbitrage, AML compliance screening, and executable EVM DEX swap calldata over [x402](https://www.x402.org) (Base USDC) and Streamable-HTTP MCP.

Works out of the box with zero configuration (`/kiosk swap` is free, and `/mcp` includes 2 free unmasked calls/day). Set `AGENT_KIOSK_API_KEY` (`ak_live_...` pass) for unlimited calls without per-call signing.

## Optional Setup

```bash
# Optional: 7-day ($1 USDC) or 30-day ($5 USDC) prepaid API pass for unlimited calls
export AGENT_KIOSK_API_KEY=ak_live_your_pass_here
```

## Commands

```
/kiosk swap <amount> <from> <to> [chain]   Build executable EVM swap/bridge calldata (free)
/kiosk gate <0xToken> [notionalUsd]        Pre-trade Base token safety gate (GO/HOLD/BLOCK)
/kiosk arb [query]                         Scan Polymarket vs. Kalshi probability spreads
/kiosk funding [symbol]                    Scan Hyperliquid vs. dYdX perp funding spreads
/kiosk compliance <0xAddress> [chain]      Screen wallet/counterparty for OFAC & AML risks
/kiosk help                                Show command reference
```

## Examples

```
/kiosk swap 100 USDC WETH base
/kiosk gate 0x940181a94A35A4569E4529A3CDfB74e38FD98631 500
/kiosk arb bitcoin
/kiosk funding ETH
/kiosk compliance 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 base
```
