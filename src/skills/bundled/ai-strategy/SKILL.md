---
name: ai-strategy
description: "Convert natural language into executable trading strategies with DCA, stop-loss, and ladder orders. Use when users describe trades in plain English or want automated strategy execution on Solana."
command: strategy
emoji: "🤖"
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# AI Strategy

Convert natural language descriptions into executable trading strategies.

## Commands

```
/strategy "<description>"          Create strategy from natural language
/strategies                        List active strategies
/strategy status <id>              Check strategy status
/strategy cancel <id>              Cancel strategy
/strategy cancel all               Cancel all strategies
/strategy templates                List available templates
/strategy template <name>          Use a template
/execute <action>                  Execute trade immediately
```

## Examples

```
/strategy "buy $100 of SOL if it drops 5%"
/strategy "sell half my BONK when it hits $0.00003"
/strategy "DCA $50 into JUP every hour for 12 hours"
/strategy "set stop loss at 20% for my SOL position"

/execute buy 0.5 SOL of ABC123...
/execute sell all BONK
```

## Strategy Types

### Price Triggers
```
/strategy "buy $100 of SOL if price drops 5%"
/strategy "sell all ETH when it hits $4000"
/strategy "buy 0.5 SOL of TOKEN... at price $0.001"
```

### DCA (Dollar Cost Average)
```
/strategy "DCA $50 into SOL every 1 hour for 24 hours"
/strategy "DCA 0.1 SOL into JUP every 30 minutes, 10 times"
```

### Take Profit / Stop Loss
```
/strategy "sell half at 2x, rest at 3x"
/strategy "set stop loss at 20%"
/strategy "take profit at 50% for TOKEN..."
```

### Scale In / Scale Out
```
/strategy "scale in with 1 SOL over 5 levels, 5% drop each"
/strategy "scale out: sell 25% at 50%, 25% at 100%, 50% at 200%"
```

### Ladder Orders
```
/strategy "ladder buy 1 SOL from $0.01 to $0.005, 5 orders"
```

## Templates

| Template | Description |
|----------|-------------|
| `dip-buy` | Buy when price drops X% |
| `take-profit` | Sell at profit target |
| `dca-daily` | Daily DCA into token |
| `stop-loss` | Sell if price drops X% |
| `ladder-buy` | Buy at multiple price levels |
| `scale-out` | Sell in tranches as price rises |

```
/strategy template dca-daily
```

## Immediate Execution

Skip conditions and execute immediately:

```
/execute buy 0.5 SOL of ABC123...
/execute sell 100% BONK
/execute swap 1 SOL to USDC
```

## Monitoring

Strategies are monitored every 5 seconds:
- Price checked via Birdeye/Jupiter
- Condition evaluated (above/below/change)
- Trade executed when condition met
- Status updated in strategy list

## Supported Tokens

Any Solana token with liquidity on Jupiter:
- Major tokens: SOL, USDC, JUP, BONK, WIF, etc.
- Pump.fun tokens: Use full mint address
- Any SPL token with Jupiter route
