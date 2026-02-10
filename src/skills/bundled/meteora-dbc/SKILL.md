---
name: meteora-dbc
description: "Launch tokens on Meteora dynamic bonding curves"
command: dbc
emoji: "🚀"
---

# Meteora DBC

Launch tokens on Meteora's dynamic bonding curves with anti-sniper fees, configurable market caps, and automated DAMM migration.

## Commands

```
/dbc launch <name> <symbol> <desc> [options]    Launch token on bonding curve
/dbc status <mint>                               Check pool status and migration progress
/dbc buy <mint> <amountSOL>                      Buy tokens on curve
/dbc sell <mint> <amountTokens>                  Sell tokens back to curve
/dbc quote <mint> <amount> [--sell]              Get swap quote
/dbc claim <pool> [--partner]                    Claim creator/partner fees
/dbc migrate <command> [args]                    Migration commands (v1, v2, locker, etc)
/dbc fees <pool>                                 Show fee breakdown
/dbc pools <command> [args]                      Query pools and configs
/dbc help                                        Show all commands
```
