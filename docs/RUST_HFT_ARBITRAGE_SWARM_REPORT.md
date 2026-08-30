# Rust HFT Arbitrage Swarm Report

Snapshot date: 2026-08-30

## Goal

Make Clodds a specialist in Rust-based HFT price arbitrage between DEX, orderbook, and CLOB venues across Solana and EVM while preserving CloddsBot as the control plane.

## Consolidated Swarm Findings

### Market-Structure Swarm

- The current `v2-hft-arbitrage` branch already contains a reusable planner in `src/trading/venue-arbitrage.ts`, but it is still biased toward prediction-market platforms.
- The venue set already present in this workspace is strong enough to support a specialist mode:
  - Solana AMM and routing: Jupiter, Raydium, Orca, Meteora
  - Solana orderbook or perp exposure: Drift, Percolator
  - EVM routing and AMM: Uniswap, 1inch, PancakeSwap
  - EVM orderbook: Lighter
- Cross-chain opportunities should be modeled as inventory-prepositioned arbitrage. Bridging should remain a slower rebalance path, not a hedge leg in the fire path.

### Solana Execution Swarm

The `p27` repo is the main Rust reuse target for Solana:

- `src/rpc/client.rs` provides warm RPC, cached blockhashes, and live priority-fee tracking.
- `src/monitor/websocket.rs` provides a resilient state monitor with reconnection discipline and event diffs.
- `src/bundle/builder.rs` provides Jito bundle construction, folded tips, V0 transaction support, and adaptive tips.
- `src/platform.rs` provides a strong example of venue-state normalization under a shared trading context.
- `src/sell_engine/engine.rs` shows how to decouple event handling, evaluation cadence, verification, and execution.

These patterns are directly relevant for a Solana arbitrage sidecar that needs to observe quotes, reserve resources ahead of time, and emit deterministic evidence for every sent route.

### EVM Execution Swarm

The `op` repo is the main Rust reuse target for EVM:

- `src/nonce_ledger.rs` is the most reusable primitive: it treats local nonce state as the authority, reserves ahead of time, and persists off the hot path.
- `src/evm.rs` provides atomic writes, typed contract interfaces, and chain-specific guardrails around canonical addresses.
- `docs/v7-architecture.md` documents a strong execution discipline: pre-signed transactions, isolated exit path, relay fanout, and exact-hash confirmation.
- `src/snipe.rs` demonstrates a clean pure-logic trigger engine that can be repurposed for opportunity gating.

The main lesson is that EVM execution should not rely on generic "send order" abstractions. It should own nonce, gas, relay, and confirmation policy explicitly.

### Risk and Control-Plane Swarm

- CloddsBot should keep chat, skills, subagent orchestration, risk thresholds, reporting, and operator UX.
- Rust workers should own latency-sensitive quote normalization, orderbook math, and chain-native execution.
- Every opportunity should be filtered by:
  - net edge after fee and slippage assumptions
  - quote age
  - venue latency
  - inventory skew
  - venue health
- Every fired opportunity should produce a post-trade evidence object with expected edge, realized fill quality, route metadata, and failure reason if cancelled.

## Recommended Architecture

```text
CloddsBot TypeScript control plane
  - skill routing
  - operator chat
  - risk config
  - opportunity review
  - subagent coordination

Shared planner
  - canonical instrument normalization
  - fee and latency aware scoring
  - venue allowlists and inventory caps

Solana Rust sidecar
  - quote normalization
  - blockhash and fee management
  - Jito or RPC execution
  - fill verification

EVM Rust sidecar
  - nonce authority
  - gas and relay fanout
  - exact-hash confirmation
  - inventory and treasury reconciliation
```

## Immediate Branch Actions

1. Extend the planner to accept concrete Solana and EVM venues.
2. Add a first-class Clodds skill that exposes the specialist report, reuse map, and next steps.
3. Start feeding normalized live venue quotes into the planner from existing Clodds connectors.
4. Build Rust sidecars incrementally by lifting proven patterns from `p27` and `op`.

## Suggested Phase Plan

### Phase 1

- Normalize quote schemas across current Clodds connectors.
- Calibrate conservative bootstrap fee and latency defaults.
- Keep execution simulated or paper-only.

### Phase 2

- Introduce Solana and EVM Rust workers with a narrow command interface.
- Add replay tooling for quote-to-fill analysis.

### Phase 3

- Add inventory-aware routing and venue health weighting.
- Promote one operator-facing skill to dispatch and synthesize subagent reports.

### Phase 4

- Add full evidence capture and automated post-trade review.
- Tighten fee, latency, and slippage models from real observed data.
