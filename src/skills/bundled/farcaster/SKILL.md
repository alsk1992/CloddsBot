---
name: farcaster
description: "Farcaster social protocol via Neynar API - read feeds, post casts, follow users"
command: fc
emoji: "🟪"
gates:
  envs:
    - NEYNAR_API_KEY
---

# Farcaster

Interact with the Farcaster decentralized social protocol via Neynar API.

## Setup

Get your API key from [dev.neynar.com](https://dev.neynar.com):

```bash
export NEYNAR_API_KEY=xxx

# Optional: For posting (requires signer)
export NEYNAR_SIGNER_UUID=xxx
```

## Commands

### Users
```
/fc user <username>           Look up user profile
/fc search-users <query>      Search for users
```

### Feeds
```
/fc feed [--channel X]        Get feed (optionally from channel)
/fc trending                  Trending casts
/fc channel <id>              Get channel info
/fc channels <query>          Search channels
```

### Search
```
/fc search <query>            Search casts
```

### Write Operations (require signer)
```
/fc post <text>               Post a cast
/fc reply <hash> <text>       Reply to a cast
/fc like <hash>               Like a cast
/fc recast <hash>             Recast
/fc follow <username>         Follow user
/fc unfollow <username>       Unfollow user
```

## Examples

```
/fc user vitalik.eth
/fc trending
/fc channel base
/fc search "ethereum"
/fc post "Hello Farcaster!"
/fc follow dwr.eth
```

## Rate Limits

- Free tier: 300 requests/minute
- Standard: 1,000 requests/minute
- Premium: Higher limits

## Features

- User profiles with verified addresses
- Cast search and feeds
- Channel discovery
- Trending content
- Full write operations (with signer)
