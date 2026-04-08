---
name: ledger
description: "Track and audit trading decisions with confidence calibration, win-rate statistics, and historical performance analysis. Use when users mention decision ledger, trade audit trail, calibration analysis, or decision statistics."
command: ledger
emoji: "📒"
---

# Ledger

Decision audit trail and performance statistics for all trading decisions.

## Commands

```
/ledger list [n] [category]    View recent decisions (with optional filters)
/ledger get <id>               Show detailed decision information
/ledger stats [period]         Decision statistics (24h, 7d, 30d, 90d, all)
/ledger calibration            Confidence accuracy analysis
/ledger help                   Show help
```

## Examples

```
/ledger list 10                View last 10 decisions
/ledger list 5 crypto          Last 5 crypto-related decisions
/ledger get abc123             Show full details for decision abc123
/ledger stats 7d               Performance stats for past week
/ledger stats 30d              Performance stats for past month
/ledger calibration            How well-calibrated are your confidence scores
```

## Workflow

1. **Review recent decisions** with `/ledger list` to see outcomes
2. **Drill into specifics** with `/ledger get <id>` for full reasoning and result
3. **Analyze patterns** with `/ledger stats` to identify strengths and weaknesses
4. **Calibrate confidence** with `/ledger calibration` to improve prediction accuracy over time
