---
name: livetennis
description: "Live tennis scores, fixtures and player lookup — match-state ground truth for tennis event markets"
command: tennis
emoji: "🎾"
gates:
  envs:
    - LIVETENNIS_API_KEY
---

# Live Tennis

Live tennis scores, upcoming fixtures, and player lookup from the
Live Tennis API (livetennisapi.com) — ATP, WTA, Challenger, ITF and junior
Grand Slam coverage. Useful as match-state ground truth when reasoning about
tennis event markets on Polymarket, Kalshi or Betfair: the score object says
who is serving, the set/game state, and whether the current point is a
break point.

## Commands

```
/tennis live [tour]        Matches in play (tour: atp|wta|challenger|itf|juniors)
/tennis upcoming [tour]    Matches about to start
/tennis fixtures [n]       Upcoming scheduled fixtures, earliest first
/tennis player <name>      Player lookup (bio + current ranking)
/tennis match <id>         One match with its latest score
```

## Examples

```
/tennis live atp
/tennis upcoming wta
/tennis fixtures 15
/tennis player Alcaraz
/tennis match 12345
```

## Setup

Set `LIVETENNIS_API_KEY`. A free key (no card) is available at
https://livetennisapi.com/subscribe/free — API docs at
https://docs.livetennisapi.com

## Rate Limits (free tier)

30 requests/minute, 100 requests/day. That suits develop-and-test or
~15-minute-cadence checks, **not** continuous fast polling. The feed caches
responses in-process (live matches 60s, fixtures 10m, players 1h) so
repeated calls don't burn the daily quota.

## Notes for the Agent

- Match ids from `/tennis live`, `/tennis upcoming` and `/tennis fixtures`
  work with `/tennis match <id>`.
- "break point" in the output is derived from the score (receiver at AD, or
  receiver at 40 with the server at 0/15/30; never during tiebreaks).
- A player's own current ranking is included on the free tier; the
  rank-ordered top-N rankings listing is a paid endpoint and is not exposed
  by this skill.
- This skill is read-only market context; it places no orders.
