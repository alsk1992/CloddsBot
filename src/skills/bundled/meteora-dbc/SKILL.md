---
name: meteora-dbc
description: "Launch, buy, and sell tokens on Meteora dynamic bonding curves with anti-sniper fees and automated DAMM migration. Use when users mention DBC, bonding curve launch, token launch on Meteora, or migration."
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

## Examples

```bash
# Launch a new token on bonding curve
/dbc launch "MyToken" MTK "A cool token" --market-cap 100000

# Check pool status and migration progress
/dbc status So1abc...xyz

# Buy tokens with 0.5 SOL
/dbc buy So1abc...xyz 0.5

# Claim creator fees
/dbc claim PoolAbc123
```

## Workflow

1. **Launch** a token with name, symbol, and description via `/dbc launch`
2. **Monitor** pool status and migration progress with `/dbc status`
3. **Trade** on the curve using `/dbc buy` and `/dbc sell`
4. **Claim** creator or partner fees once available with `/dbc claim`
5. **Migrate** to DAMM when market cap target is reached via `/dbc migrate`

## Notes

- Anti-sniper fees protect against bot sniping at launch
- Configurable market cap targets trigger automatic DAMM migration
- Supports both v1 and v2 migration paths
