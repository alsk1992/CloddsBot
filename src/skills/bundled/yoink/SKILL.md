---
name: yoink
description: "Play Yoink capture-the-flag game on Base - yoink the flag, check scores, compete for trophy"
command: yoink
emoji: "🚩"
gates:
  envs:
    - PRIVATE_KEY
---

# Yoink - Capture the Flag on Base

Play Yoink, an onchain capture-the-flag game on Base. Yoink the flag from the current holder to start your clock.

## Contract

`0x4bBFD120d9f352A0BEd7a014bd67913a2007a878` on Base (chain ID 8453)

## Game Rules

1. **Yoink the flag** - Call `yoink()` to take the flag
2. **Cooldown** - 10 minutes (600 seconds) between yoinks
3. **No self-yoink** - You cannot yoink from yourself
4. **Accumulate time** - While holding the flag, your time score increases
5. **Trophy** - Player with most yoinks holds the trophy

## Commands

### Status
```
/yoink status                    Current flag holder and game stats
/yoink score <address>           Get player score
/yoink leaderboard               Top yoinkers
```

### Play
```
/yoink                           Yoink the flag!
/yoink cooldown                  Check your cooldown status
```

## Examples

```
/yoink status
/yoink score 0x1234...
/yoink
```

## Setup

```bash
export PRIVATE_KEY="0x..."  # For yoinking
```
