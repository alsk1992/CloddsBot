---
name: x-research
description: "Research X/Twitter via Composio integration. Search tweets, analyze threads, monitor profiles, and manage watchlists for market intelligence. Use when gathering social sentiment, tracking influencer takes, or monitoring breaking news on X."
emoji: "🐦"
gates:
  envs:
    - COMPOSIO_API_KEY
    - COMPOSIO_CONNECTION_ID
---

# X Research Skill

X/Twitter research agent powered by Composio. Zero API cost.

Search for real-time discussions, breaking news, expert opinions, and engagement data.

## Commands

### Search
```
/x search <query> [--sort likes|recent] [--since 1h|1d|7d] [--limit N] [--pages N] [--json] [--markdown]
```
Search recent tweets (last 7 days). Supports engagement sorting, time filtering, pagination, and multiple output formats (default, `--json` for raw data, `--markdown` for research documents).

### Profile
```
/x profile <username> [--count N] [--replies] [--json]
```
Fetch recent tweets from a specific user. Excludes replies by default. Use `--json` for raw data.

### Thread
```
/x thread <tweet_id> [--pages N]
```
Reconstruct a full conversation thread from a root tweet ID.

### Single Tweet
```
/x tweet <tweet_id> [--json]
```
Fetch and display a single tweet with engagement metrics. Use `--json` for raw data.

### Cache
```
/x cache clear                  Clear search cache
```
Manage the in-memory search cache (15-minute TTL).

### Watchlist
```
/x watchlist                    Show all tracked accounts
/x watchlist add <user> [note]  Add user to watchlist
/x watchlist remove <user>      Remove user from watchlist
/x watchlist check              Check recent tweets from all watchlist accounts
```
Track accounts of interest. Watchlist is session-scoped (in-memory).

## Research Workflow

For deep research on a topic:

1. Decompose your question into 3-5 targeted search queries
2. Search with different sort modes (likes for signal, recent for breaking)
3. Follow high-engagement threads for context
4. Check profiles of key accounts found in results
5. Add important accounts to watchlist for monitoring

## Search Operators

Composio supports standard X search operators:

- `"exact phrase"` — Match exact text
- `from:username` — Tweets from a user
- `-is:retweet` — Exclude retweets (added by default)
- `-is:reply` — Exclude replies (use `--no-replies`)
- `#hashtag` — Filter by hashtag
- `has:links` — Only tweets with links
- `lang:en` — Filter by language

## Examples

```
/x search "prediction markets" --sort likes --since 7d
/x search "polymarket whale" --since 1d --limit 5
/x search "AI agents" --markdown
/x profile polyaborat --count 10
/x thread 1234567890 --pages 3
/x watchlist add vitalikbuterin "ETH creator"
/x watchlist check
```

## Environment Variables

- `COMPOSIO_API_KEY` — Your Composio API key (free tier available)
- `COMPOSIO_CONNECTION_ID` — Your Composio X/Twitter connection ID

Get both at https://composio.dev after connecting your X account.
