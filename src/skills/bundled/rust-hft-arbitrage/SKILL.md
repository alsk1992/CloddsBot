---
name: rust-hft-arbitrage
description: "Rust-first cross-venue HFT arbitrage specialist for Solana and EVM"
commands:
  - /hft-arb
  - /venue-arb
  - /rust-arb
---

# Rust HFT Arbitrage Specialist

Snapshot date: 2026-08-30.

Clodds should treat this domain as a Rust-first execution problem with a TypeScript control plane.

## Objective

Make Clodds reliable at price arbitrage between:

- Solana AMMs and routers: Jupiter, Raydium, Orca, Meteora
- Solana orderbook and perp venues already in-repo: Drift, Percolator
- EVM routers and AMMs already in-repo: Uniswap, 1inch, PancakeSwap
- EVM orderbook venue already in-repo: Lighter

Cross-chain arbitrage should assume pre-positioned inventory. A live bridge is inventory management, not an HFT hedge leg.

## Specialist Rules

- Separate planning from execution. The planner may be shared; the sender must stay chain-native.
- Normalize instruments first. A route is valid only if both legs map to the same hedgeable instrument or clearly-defined basis pair.
- Penalize stale quotes, routing latency, and inventory skew before a trade is considered actionable.
- Use Rust for hot paths: quote normalization, orderbook math, nonce or blockhash management, and fire-path execution.
- Keep Clodds in charge of orchestration, operator UX, skill routing, risk configuration, and post-trade reporting.

## Reuse Map

### CloddsBot

- `src/trading/venue-arbitrage.ts` already provides a cross-venue scoring shell.
- `src/solana/*` and `src/evm/*` already expose venue connectors and skills.
- `src/agents/subagents.ts` already supports focused background task delegation.
- `src/skills/bundled/*` already gives the operator surface for venue-specific commands.

### p27

Use `p27` as the Solana low-latency reference:

- `src/rpc/client.rs`: cached blockhash, warm RPC path, live priority-fee tracking
- `src/monitor/websocket.rs`: resilient WebSocket state monitor with reconnection logic
- `src/bundle/builder.rs`: Jito bundle builder, tip tracking, V0 transaction support
- `src/platform.rs`: unified `TradingContext` and state normalization across venue states
- `src/sell_engine/engine.rs`: event-driven exit engine and verification discipline
- `src/wallet/*` and `src/volume/*`: wallet fleet coordination and session control

### op

Use `op` as the EVM low-latency reference:

- `src/nonce_ledger.rs`: local nonce authority, reservation, rollback, background persistence
- `src/evm.rs`: atomic writes, typed contract interfaces, and chain-specific guardrails
- `src/snipe.rs`: rule engine structure for hot-path trigger logic
- `docs/v7-architecture.md`: pre-signed fanout, isolated exit path, exact-hash confirmation

## Target Architecture

```text
Clodds chat + skills + risk config
        |
        v
Shared venue-arbitrage planner
        |
        +--> Solana Rust worker
        |     - quote normalization
        |     - Jito and priority-fee execution
        |     - inventory and fill reporting
        |
        +--> EVM Rust worker
              - nonce ledger
              - gas and relay fanout
              - exact-hash confirmation
```

## Swarm Roles

### Market-Structure Swarm

- Build a canonical `instrumentId`
- Classify each venue as AMM, router, CLOB, or perp
- Define which venue pairs are directly hedgeable

### Execution Swarm

- Solana executor owns Jito, blockhashes, fee markets, and retry policy
- EVM executor owns nonces, gas policy, relay fanout, and confirmation

### Risk Swarm

- Net-edge thresholds
- Inventory caps by venue and by chain
- Staleness and latency gates
- Kill switches and venue health

### Integration Swarm

- Expose report, venue, reuse, and next-step views through a single skill
- Keep one top-level Clodds operator session that can dispatch subagent work and merge results

## Recommended Immediate Steps

1. Expand the planner to accept concrete Solana and EVM venues, not only market platforms.
2. Feed normalized quotes from existing Clodds connectors into that planner.
3. Build Rust sidecars for chain-native execution using `p27` and `op` patterns.
4. Replay quote streams and calibrate real fee and latency penalties from logs.
5. Emit one post-trade evidence report per opportunity.

## Live Scan Command

Step 2 above is implemented in `src/trading/venue-arbitrage-scanner.ts` and wired into this skill as
`/hft-arb scan`. It pulls live round-trip quotes (buy then sell) from the venues below, feeds them into
the shared `venue-arbitrage` planner, and reports any net-positive crossed plans. This is read-only —
it never signs or sends a transaction.

- Solana: Jupiter, Raydium, Orca, Meteora
- EVM: Uniswap, 1inch, PancakeSwap, Lighter (Arbitrum only)
- Cross-chain: scans both sides and compares, assuming pre-positioned inventory

Usage: `/hft-arb scan <solana|evm|cross> <base> <quote> <size> [options]`. Run `/hft-arb scan help` for
the full option list (venue selection, chain, edge/notional thresholds, slippage, RPC override).
