---
name: edge
description: "Scan prediction markets for mispricing by comparing prices to 538, CME FedWatch, polls, Vegas lines, and other external models with Kelly criterion sizing. Use when users ask about finding edge, mispriced markets, fair value, or optimal bet sizing."
emoji: "🎯"
---

# Edge Detection Skill

Compare prediction market prices to external models, polls, and data sources to find potential edge.

## Commands

### Scan for Edge
```
/edge
/edge politics
/edge fed
```

### Compare Specific Market
```
/edge compare "Trump 2028" 538 betting-odds
/edge compare "BTC above 100k" polymarket kalshi
```

### Kelly Calculator
```
/edge kelly 0.6 2.0 1000
# probability, decimal odds, bankroll
/edge kelly 55 2.5
# 55% prob, 2.5 odds, $100 default bankroll
```

## Data Sources

### Political
- **538/Silver Bulletin** - Election models
- **RealClearPolitics** - Polling averages
- **Betting Odds** - Pinnacle, offshore books
- **PredictIt** - Alternative market prices

### Economic
- **CME FedWatch** - Rate probabilities
- **Bloomberg Consensus** - Economist forecasts
- **Treasury Yields** - Implied expectations

### Sports
- **Vegas Lines** - Sharp money indicators
- **ESPN FPI** - Power rankings
- **Historical Models** - ELO ratings

## Examples

User: "Find me some edge"
→ Scan markets where price differs >10% from models
→ Return top opportunities with confidence levels

User: "Is the Fed market fairly priced?"
→ Compare to CME FedWatch probabilities
→ Show discrepancy and confidence

User: "What size should I bet if I think Trump is 55% to win but market says 45%?"
→ Kelly criterion: (0.55 * 0.55 - 0.45 * 0.45) / 0.55 = 18% of bankroll

## Output Format

```
🎯 EDGE DETECTED

Market: "Fed cuts rates in March 2026"
Platform: Polymarket

Current Price: 23¢

External Sources:
• CME FedWatch: 41%
• Bloomberg Consensus: 38%
• Historical base rate: 35%

Estimated Fair Value: 38¢
Edge: +15¢ (+65%)
Confidence: Medium

Kelly Suggestion:
• Conservative (half-Kelly): 8% of bankroll
• Aggressive (full-Kelly): 16% of bankroll
```
