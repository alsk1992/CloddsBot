# V2 HFT Arbitrage Foundation

Date: August 30, 2026

This branch starts a clean v2 line from the current `main` tip with a narrower execution focus:

- Faster cross-venue arbitrage loops
- Three- and four-hop pathfinding where the graph supports it
- Better latency awareness in route selection
- Smaller, tighter execution plans instead of broad opportunity dumps

## What This PR Adds

- A pure venue arbitrage planner in `src/trading/venue-arbitrage.ts`
- A multi-hop path planner in `src/trading/multi-hop-arbitrage.ts`
- An opportunity-level HFT planning service in `src/opportunity/hft.ts`
- Config defaults under `venueArbitrage`
- Opportunity API endpoints for direct HFT planning on active opportunities, linked market groups, and explicit multi-hop graphs
- Unit tests that cover net-edge filtering, staleness rejection, latency ranking, maker/taker leg sequencing, multi-hop cycles, Solana atomic bundles, EVM exact-in execution hints, and live opportunity/linked-market quote translation

## Execution Model

The venue planner assumes quotes have already been normalized onto a shared `instrumentId`. For each instrument, it:

1. Chooses a buy venue and sell venue
2. Applies fee, latency, stale-quote, and inventory penalties
3. Rejects plans that fail minimum net-edge or profit thresholds
4. Emits an ordered two-leg execution plan

The path planner accepts directed hop quotes (`fromAsset -> toAsset`) and searches cycles up to `maxHops`:

1. Walk the trade graph up to 3-4 hops
2. Propagate exact input size and path capacity through every hop
3. Detect profitable cycles back to the start asset
4. Annotate execution strategy for Solana bundles or EVM exact-in entry

The opportunity HFT service now connects those planners to live product surfaces:

1. `POST /api/opportunities/:id/hft-plan` converts an active opportunity into a size-capped execution plan
2. `POST /api/opportunities/hft/linked-plan` pulls a linked market identity, fetches live books, and runs venue planning
3. `POST /api/opportunities/hft/multi-hop/plan` runs 3-4 hop pathfinding against an explicit directed graph payload

Supported execution styles:

- `taker_taker`: cross both legs immediately, default for speed
- `maker_taker`: queue on the cheap venue, then hedge aggressively
- `maker_maker`: passive on both venues when edge persistence matters more than immediacy

Additional execution semantics:

- `solana_atomic_bundle`: all hops can be submitted as one atomic bundle
- `evm_exact_in`: every hop uses deterministic exact-in sizing for controlled entry

Current limitation:

- Those are planner outputs and execution hints, not a Jito bundle sender or EVM calldata executor yet

## Why This Shape

The repo already has:

- `src/opportunity/*` for broad opportunity discovery
- `src/execution/smart-router.ts` for single-order venue routing

What it did not have was a dedicated planner for HFT-style venue pairing plus multi-hop path execution. These modules fill that gap without forcing an immediate integration rewrite.

## Next Steps

- Feed normalized live quotes from `OpportunityFinder` or dedicated venue feeds into the planner
- Feed normalized directed swap/perp edges into the multi-hop planner
- Add partial-fill handling and unwind policies on top of `ExecutionService`
- Persist planner decisions and realized outcomes for replay and model tuning
- Add per-venue inventory budgets and hedge eligibility rules
