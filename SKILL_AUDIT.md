# Full Skill Audit - 103 Skills

## Legend
- **WIRED**: Has `await import()` to real backing module, all commands call it
- **PARTIAL**: Has import but some commands are stubs/hardcoded
- **STUB+BACKING**: No import, but backing module EXISTS in src/ - needs wiring
- **SELF-CONTAINED**: No backing module, skill has real inline logic (fetch calls, etc.)
- **PURE STUB**: No import, no backing module, returns only hardcoded strings

---

## CATEGORY A: WIRED (all commands call real modules) - 51 skills

| # | Skill | Lines | Backing Module | Notes |
|---|-------|-------|---------------|-------|
| 1 | auto-reply | 179 | src/auto-reply/index.ts | Clean |
| 2 | copy-trading | 176 | src/trading/copy-trading.ts | Config display hardcoded defaults |
| 3 | credentials | 106 | src/credentials/index.ts | Clean |
| 4 | execution | 146 | src/execution/index.ts | Clean |
| 5 | history | 180 | src/history/index.ts | Clean |
| 6 | identity | 189 | src/identity/index.ts | Clean |
| 7 | integrations | 110 | src/credentials/index.ts | Clean |
| 8 | market-index | 155 | src/market-index/index.ts | Clean |
| 9 | mcp | 200 | src/mcp/index.ts | Clean |
| 10 | memory | 196 | src/memory/index.ts | Clean |
| 11 | permissions | 177 | src/permissions/index.ts | Clean |
| 12 | plugins | 176 | src/plugins/index.ts | Clean |
| 13 | portfolio | 199 | src/portfolio/index.ts | Clean |
| 14 | remote | 174 | src/remote/index.ts | Good error handling |
| 15 | research | 147 | src/market-index/index.ts | Clean |
| 16 | streaming | 121 | src/streaming/index.ts | Clean |
| 17 | tailscale | 153 | src/tailscale/index.ts | Clean |
| 18 | trading-evm | 283 | src/evm/index.ts | Clean |
| 19 | trading-futures | 286 | src/trading/futures/index.ts | margin cmd is stub (see PARTIAL) |
| 20 | trading-kalshi | 455 | src/feeds/kalshi + src/execution | Clean |
| 21 | trading-manifold | 446 | src/feeds/manifold + fetch API | Clean |
| 22 | trading-polymarket | 598 | src/feeds/polymarket + src/execution | Clean |
| 23 | trading-system | 330 | src/trading/index.ts + safety | Clean |
| 24 | usage | 130 | src/usage/index.ts | Clean |
| 25 | voice | 173 | src/voice/index.ts | Clean |
| 26 | whale-tracking | 443 | src/feeds/polymarket/whale-tracker + crypto | Clean |
| 27 | bags | 1160 | Multiple solana imports | Clean, large |
| 28 | ai-strategy | 738 | Multiple imports + fetch | Clean |
| 29 | signals | 945 | Multiple imports + fetch | Clean |
| 30 | pumpfun | 1119 | src/solana/pumpapi + fetch | Clean |
| 31 | copy-trading-solana | 462 | src/solana/copytrade.ts | Clean |
| 32 | weather | 542 | Fetch-based | Real API calls |
| 33 | analytics | 83 | src/analytics + src/history | Small, real |
| 34 | doctor | 46 | Import-based | Small, real |
| 35 | edge | 59 | Import-based | Small, real |
| 36 | markets | 65 | Import-based | Small, real |
| 37 | metrics | 62 | Import-based | Small, real |
| 38 | mev | 82 | Import-based | Small, real |
| 39 | portfolio-sync | 87 | src/portfolio/index.ts | Wired: sync, platform filter, status |
| 40 | positions | 117 | src/execution/position-manager.ts | Wired: list, SL/TP, trailing, close |
| 41 | router | 131 | src/execution/smart-router.ts | Wired: status, config, set, route |
| 42 | strategy | 136 | src/trading/builder.ts + src/db | Wired: list, create, start, status, delete |
| 43 | triggers | 141 | src/cron/index.ts + src/db | Wired: list, create, delete, cron |
| 44 | sandbox | 93 | src/canvas/index.ts | Wired: start, push, reset, screenshot, status |
| 45 | monitoring | 108 | src/monitoring + src/infra | Wired: status, metrics, alerts, errors |
| 46 | sizing | 145 | src/trading/kelly.ts | Wired: config+state, set, dynamic calc |
| 47 | processes | 89 | src/process/index.ts | Wired: pool command added |
| 48 | verify | 124 | src/identity/erc8004.ts | Wired: register calls client.register() |
| 49 | qmd | 117 | execSync (qmd CLI) | Improved: install instructions on missing |
| 50 | onchainkit | 415 | src/process/index.ts | Wired: create runs npm via proc.execute |
| 51 | tweet-ideas | 515 | src/feeds/news/index.ts | Already wired: trends fetch news |

---

## CATEGORY B: PARTIAL (wired but some commands are stubs) - 8 skills

### B1. backtest (115 lines) - src/trading/backtest.ts
- `run` with --market: PARTIAL (loads data, never runs strategy)
- `run` without --market: STUB (hardcoded string)
- `results`: STUB ("No backtest results in current session")
- `monte-carlo`: STUB (returns static instructions)
- `compare`: STUB ("Run individual backtests first")
- `list`: STUB ("No saved runs")
- `config`: STUB (hardcoded config display)
- **FIX**: Wire `run` to `engine.runBacktest()`, `results` to stored results, etc.

### B2. bridge (172 lines) - src/bridge/wormhole.ts
- `quote`: REAL
- `usdc`: REAL
- `redeem`: REAL
- `status`: STUB (hardcoded "Use Wormhole Explorer")
- `routes`: STUB (hardcoded markdown table)
- default bridge: REAL
- **FIX**: `status` could query wormhole API; `routes` is acceptable as static

### B3. presence (122 lines) - src/presence/index.ts
- `show`: REAL
- `set`: STUB (returns confirmation, persists nothing)
- `devices`: STUB (always "1. CLI")
- `typing/start-typing/stop-typing/stop-all`: REAL
- **FIX**: Remove `set` and `devices` or mark as not-implemented

### B4. feeds (150 lines) - src/feeds/index.ts
- `status/subscribe/search/price/cache`: REAL
- `unsubscribe`: STUB (no-op, never calls unsub)
- `list`: STUB (hardcoded platform list)
- **FIX**: Store unsub handles, wire `list` to feed manager

### B5. automation (120 lines) - src/automation/cron.ts
- All scheduler calls are REAL
- BUT `cron` creates jobs with empty `async () => {}` callback
- **FIX**: Wire callback to skill executor

### B6. tts (108 lines) - src/tts/index.ts
- `voices`: REAL
- `config`: PARTIAL (checks isAvailable, hardcoded defaults)
- `set`: STUB (confirms but persists nothing)
- default (synthesize): REAL
- **FIX**: Add config persistence or remove `set`

### B7. search-config (160 lines) - src/search/index.ts
- All config is in-memory only (lost on restart)
- `test`: REAL (calls bm25Search but on hardcoded sample docs)
- **FIX**: Add persistence to DB or config file

### B8. trading-futures (286 lines) - src/trading/futures/index.ts
- All commands REAL except:
- `margin`: STUB (returns static string)
- `leverage`: FRAGILE (optional chaining may silently fail)
- **FIX**: Remove margin stub or wire to exchange client

---

## CATEGORY C: STUB + BACKING MODULE EXISTS - 30 skills
These have backing modules in src/ but the skill doesn't import them.

| # | Skill | Lines | Backing Module | Priority |
|---|-------|-------|---------------|----------|
| 1 | alerts | 209 | src/alerts/index.ts | HIGH |
| 2 | arbitrage | 282 | src/arbitrage/index.ts | HIGH |
| 3 | betfair | 425 | src/feeds/betfair/index.ts | MED |
| 4 | binance-futures | 539 | src/exchanges/binance-futures/index.ts | HIGH |
| 5 | bybit-futures | 360 | src/exchanges/bybit/index.ts | HIGH |
| 6 | drift | 313 | src/feeds/drift/index.ts + src/solana/drift.ts | MED |
| 7 | embeddings | 163 | src/embeddings/index.ts | MED |
| 8 | farcaster | 344 | src/farcaster/index.ts | MED |
| 9 | hyperliquid | 1431 | src/exchanges/hyperliquid/index.ts | HIGH |
| 10 | jupiter | 175 | src/solana/jupiter.ts | HIGH |
| 11 | ledger | 215 | src/ledger/index.ts | MED |
| 12 | metaculus | 185 | src/feeds/metaculus/index.ts | MED |
| 13 | meteora | 169 | src/solana/meteora.ts | MED |
| 14 | mexc-futures | 371 | src/exchanges/mexc/index.ts | HIGH |
| 15 | ~~monitoring~~ | ~~54~~ | ~~src/monitoring/index.ts~~ | DONE - moved to Cat A |
| 16 | news | 169 | src/feeds/news/index.ts | MED |
| 17 | opinion | 405 | src/feeds/opinion/index.ts + src/exchanges/opinion/ | HIGH |
| 18 | opportunity | 317 | src/opportunity/index.ts | MED |
| 19 | orca | 167 | src/solana/orca.ts | MED |
| 20 | pairing | 261 | src/pairing/index.ts | LOW |
| 21 | predictfun | 620 | src/feeds/predictfun/index.ts + src/exchanges/predictfun/ | HIGH |
| 22 | predictit | 149 | src/feeds/predictit/index.ts | MED |
| 23 | raydium | 155 | src/solana/raydium.ts | MED |
| 24 | risk | 185 | src/risk/index.ts | HIGH |
| 25 | routing | 292 | src/routing/index.ts | MED |
| 26 | sessions | 217 | src/sessions/index.ts | MED |
| 27 | smarkets | 377 | src/feeds/smarkets/index.ts | MED |
| 28 | virtuals | 279 | src/evm/virtuals.ts (but also src/feeds/virtuals/) | MED |
| 29 | bankr | 296 | src/bankr/index.ts | LOW |
| 30 | pump-swarm | 2452 | src/solana/pump-swarm.ts | MED |

---

## CATEGORY D: SELF-CONTAINED (no backing module, but has real logic) - 3 skills
These use inline fetch() or have meaningful logic without a separate module.

| # | Skill | Lines | Notes |
|---|-------|-------|-------|
| 1 | features | 426 | Feature flag system, has fetch |
| 2 | ticks | 387 | Price ticks, has fetch |
| 3 | trading-solana | 385 | Uses src/solana/wallet.ts (exists) |

NOTE: processes, router, sandbox, strategy moved to Category A (fully wired).

---

## CATEGORY E: SELF-CONTAINED STUBS (no backing module, all hardcoded) - 11 skills
No backing module exists in src/. These are fully self-contained with hardcoded responses.

| # | Skill | Lines | Notes |
|---|-------|-------|-------|
| 1 | acp | 575 | Agent Communication Protocol - all hardcoded |
| 2 | botchan | 266 | Bot channel management - hardcoded |
| 3 | clanker | 830 | Token launcher - large but no module |
| 4 | drift-sdk | 538 | Drift protocol SDK - hardcoded |
| 5 | endaoment | 316 | Donation protocol - hardcoded |
| 6 | ens | 307 | ENS resolution - hardcoded |
| 7 | harden | 618 | Security hardening - hardcoded |
| 8 | qrcoin | 358 | QR coin - hardcoded |
| 9 | slippage | 57 | Slippage config - hardcoded |
| 10 | veil | 297 | Veil markets - hardcoded |
| 11 | yoink | 255 | Yoink game - hardcoded |
| 12 | webhooks | 103 | Has import, webhook mgmt |

NOTE: sizing, triggers, verify, monitoring, onchainkit, qmd, tweet-ideas moved to Category A (fully wired).

---

## CATEGORY F: SMALL UTILITIES (wired, functional) - already counted in A

These are small (< 150 lines) skills that have imports and work:
- doctor (46), slippage (57), edge (59), metrics (62), markets (65), mev (82), analytics (83)
- portfolio-sync (87), processes (89), sandbox (93), monitoring (108), positions (117), qmd (117), verify (124), router (131), strategy (136), triggers (141), sizing (145)

---

## CROSS-CUTTING ISSUES

### Error Handling
25/33 wired skills silently swallow ALL errors:
```typescript
} catch { return helpText(); }
```
Should at minimum log the error or distinguish import failure from command error.

### Missing wiring count
- **30 skills** have backing modules but don't import them (Category C)
- **8 skills** are partially wired with stub commands (Category B)
- **~18 skills** are pure stubs with no backing module (Category E)

### Total work needed
- **Category B fixes**: 8 skills, surgical fixes to stub commands
- **Category C wiring**: 30 skills need `await import()` added
- **Category E**: Accept as-is OR create backing modules (out of scope)

---

## FIX PRIORITY ORDER

### P0 - Critical (exchange/trading stubs with real backing)
1. binance-futures -> src/exchanges/binance-futures/index.ts
2. bybit-futures -> src/exchanges/bybit/index.ts
3. hyperliquid -> src/exchanges/hyperliquid/index.ts
4. mexc-futures -> src/exchanges/mexc/index.ts
5. opinion -> src/feeds/opinion/index.ts + src/exchanges/opinion/
6. predictfun -> src/feeds/predictfun/index.ts + src/exchanges/predictfun/

### P1 - High (market feeds with real backing)
7. alerts -> src/alerts/index.ts
8. arbitrage -> src/arbitrage/index.ts
9. risk -> src/risk/index.ts
10. betfair -> src/feeds/betfair/index.ts
11. metaculus -> src/feeds/metaculus/index.ts
12. smarkets -> src/feeds/smarkets/index.ts
13. predictit -> src/feeds/predictit/index.ts
14. news -> src/feeds/news/index.ts

### P2 - Medium (Solana/DeFi with real backing)
15. jupiter -> src/solana/jupiter.ts
16. raydium -> src/solana/raydium.ts
17. meteora -> src/solana/meteora.ts
18. orca -> src/solana/orca.ts
19. drift -> src/feeds/drift/index.ts + src/solana/drift.ts
20. pump-swarm -> src/solana/pump-swarm.ts
21. virtuals -> src/evm/virtuals.ts
22. erc8004 -> src/identity/erc8004.ts

### P3 - Medium (infrastructure with real backing)
23. embeddings -> src/embeddings/index.ts
24. farcaster -> src/farcaster/index.ts
25. ledger -> src/ledger/index.ts
26. monitoring -> src/monitoring/index.ts
27. opportunity -> src/opportunity/index.ts
28. routing -> src/routing/index.ts
29. sessions -> src/sessions/index.ts
30. bankr -> src/bankr/index.ts
31. pairing -> src/pairing/index.ts

### P4 - Partial fixes (wired skills with stub commands)
32. backtest - wire remaining 5 stub commands
33. bridge - wire status command
34. presence - remove/fix set and devices stubs
35. feeds - wire unsubscribe, fix list
36. automation - wire cron callback
37. tts - fix set persistence
38. search-config - add persistence
39. trading-futures - fix margin, leverage

### P5 - Accept as-is (no backing module)
40-57. acp, botchan, clanker, drift-sdk, endaoment, ens, features, harden,
       onchainkit, qmd, qrcoin, slippage, ticks, trading-solana, tweet-ideas,
       veil, yoink
