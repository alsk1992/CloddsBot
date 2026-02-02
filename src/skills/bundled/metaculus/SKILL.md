---
name: metaculus
description: "Metaculus forecasting platform (read-only)"
emoji: "🔮"
commands:
  - /mc
---

# Metaculus

Integration with Metaculus, a community forecasting platform. View questions, predictions, and tournaments.

## Quick Start

```bash
# Search questions
/mc search AI

# Get question details
/mc question 12345

# List tournaments
/mc tournaments

# Get tournament questions
/mc tournament 123
```

## Commands

| Command | Description |
|---------|-------------|
| `/mc search [query]` | Search questions |
| `/mc question <id>` | Get question details |
| `/mc tournaments` | List active tournaments |
| `/mc tournament <id>` | Get tournament questions |

**Examples:**
```bash
/mc search pandemic         # Search for pandemic questions
/mc question 3479           # Get question details
/mc tournament 1234         # Get tournament questions
```

## Features

- **Community Forecasts** - Aggregate probability predictions
- **Tournaments** - Forecasting competitions
- **Question Types** - Binary, continuous, date ranges
- **Historical Accuracy** - Track prediction calibration

## Notes

- Metaculus is a forecasting platform (not trading)
- Questions show community prediction probabilities
- No trading or betting functionality
- Volume represents number of predictions

## Resources

- [Metaculus](https://www.metaculus.com/)
- [Metaculus API](https://www.metaculus.com/api2/)
