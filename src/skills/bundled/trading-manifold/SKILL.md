---
name: trading-manifold
description: "Place bets on Manifold Markets using their REST API"
emoji: "🎲"
gates:
  envs:
    - MANIFOLD_API_KEY
---

# Manifold Markets Trading Skill

Real, working methods to bet on Manifold Markets using Mana (play money that can be donated to charity).

## Setup

Get your API key from: https://manifold.markets/profile (API key section)

```python
import os
import requests

API_URL = "https://api.manifold.markets/v0"
API_KEY = os.getenv("MANIFOLD_API_KEY")

def headers():
    return {
        "Authorization": f"Key {API_KEY}",
        "Content-Type": "application/json"
    }
```

## Search Markets

```python
def search_markets(query: str, limit: int = 10):
    """Search for markets"""
    r = requests.get(f"{API_URL}/search-markets", params={
        "term": query,
        "limit": limit,
        "filter": "open",
        "sort": "liquidity"
    })
    r.raise_for_status()
    markets = r.json()

    for m in markets[:5]:
        prob = m.get("probability", 0.5)
        print(f"\nMarket: {m['question']}")
        print(f"ID: {m['id']}")
        print(f"Probability: {prob*100:.1f}%")
        print(f"URL: {m.get('url', '')}")

    return markets

markets = search_markets("AI")
```

## Get Market by ID or Slug

```python
def get_market(id_or_slug: str):
    """Get market details"""
    # Try by ID first
    r = requests.get(f"{API_URL}/market/{id_or_slug}")
    if r.status_code == 404:
        # Try by slug
        r = requests.get(f"{API_URL}/slug/{id_or_slug}")

    r.raise_for_status()
    return r.json()

market = get_market("will-gpt5-be-released-before-2025")
print(f"Question: {market['question']}")
print(f"Probability: {market.get('probability', 0.5)*100:.1f}%")
```

## Place a Bet

```python
def place_bet(
    market_id: str,
    amount: int,           # Mana amount to bet
    outcome: str = "YES",  # "YES" or "NO"
    limit_prob: float = None  # Optional limit order probability
):
    """
    Place a bet on Manifold

    Args:
        market_id: The market ID (not slug!)
        amount: Amount of Mana to bet
        outcome: "YES" or "NO"
        limit_prob: Optional - if set, creates a limit order at this probability
    """
    payload = {
        "contractId": market_id,
        "amount": amount,
        "outcome": outcome
    }

    if limit_prob is not None:
        payload["limitProb"] = limit_prob

    r = requests.post(f"{API_URL}/bet", headers=headers(), json=payload)
    r.raise_for_status()
    result = r.json()

    print(f"Bet placed!")
    print(f"Shares: {result.get('shares', 0):.2f}")
    print(f"Probability after: {result.get('probAfter', 0)*100:.1f}%")

    return result

# Market bet - buys at current price
result = place_bet(
    market_id="abc123",
    amount=100,  # 100 Mana
    outcome="YES"
)

# Limit order - only fills at 40% or below
result = place_bet(
    market_id="abc123",
    amount=100,
    outcome="YES",
    limit_prob=0.40
)
```

## Cancel Bet (Limit Orders Only)

```python
def cancel_bet(bet_id: str):
    """Cancel a limit order"""
    r = requests.post(f"{API_URL}/bet/cancel/{bet_id}", headers=headers())
    r.raise_for_status()
    return True

cancel_bet("bet123")
```

## Sell Shares

```python
def sell_shares(
    market_id: str,
    outcome: str = "YES",
    shares: float = None  # None = sell all
):
    """
    Sell shares in a market

    Args:
        market_id: The market ID
        outcome: "YES" or "NO" - which shares to sell
        shares: Number of shares to sell (None = all)
    """
    payload = {
        "contractId": market_id,
        "outcome": outcome
    }

    if shares is not None:
        payload["shares"] = shares

    r = requests.post(f"{API_URL}/market/{market_id}/sell", headers=headers(), json=payload)
    r.raise_for_status()
    return r.json()

# Sell all YES shares
sell_shares("abc123", "YES")

# Sell specific amount
sell_shares("abc123", "YES", shares=50.0)
```

## Get Your Bets

```python
def get_my_bets(market_id: str = None):
    """Get your bets"""
    params = {}
    if market_id:
        params["contractId"] = market_id

    r = requests.get(f"{API_URL}/bets", headers=headers(), params=params)
    r.raise_for_status()
    bets = r.json()

    for b in bets[:10]:
        print(f"Bet: {b['outcome']} {b['amount']}M @ {b.get('probBefore', 0)*100:.0f}%")

    return bets

bets = get_my_bets()
```

## Get Your Positions

```python
def get_positions():
    """Get current positions across all markets"""
    # Get user info first
    r = requests.get(f"{API_URL}/me", headers=headers())
    r.raise_for_status()
    user = r.json()

    # Get bets to calculate positions
    r = requests.get(f"{API_URL}/bets", headers=headers(), params={"limit": 1000})
    bets = r.json()

    # Aggregate by market
    positions = {}
    for bet in bets:
        mid = bet["contractId"]
        if mid not in positions:
            positions[mid] = {"yes": 0, "no": 0, "invested": 0}

        if bet["outcome"] == "YES":
            positions[mid]["yes"] += bet.get("shares", 0)
        else:
            positions[mid]["no"] += bet.get("shares", 0)

        if not bet.get("isSold", False):
            positions[mid]["invested"] += bet["amount"]

    return positions, user.get("balance", 0)

positions, balance = get_positions()
print(f"Balance: {balance} Mana")
for mid, pos in positions.items():
    if pos["yes"] > 0 or pos["no"] > 0:
        print(f"Market {mid}: YES={pos['yes']:.1f}, NO={pos['no']:.1f}")
```

## Get Balance

```python
def get_balance():
    """Get your Mana balance"""
    r = requests.get(f"{API_URL}/me", headers=headers())
    r.raise_for_status()
    user = r.json()
    return user.get("balance", 0)

balance = get_balance()
print(f"Balance: {balance} Mana")
```

## Complete Trading Bot Example

```python
#!/usr/bin/env python3
"""
Manifold arbitrage bot - finds mispriced markets
"""

import os
import time
import requests

API_URL = "https://api.manifold.markets/v0"
API_KEY = os.getenv("MANIFOLD_API_KEY")

def h():
    return {"Authorization": f"Key {API_KEY}", "Content-Type": "application/json"}

def search(query):
    r = requests.get(f"{API_URL}/search-markets",
                    params={"term": query, "limit": 20, "filter": "open"})
    return r.json()

def bet(market_id, amount, outcome, limit_prob=None):
    payload = {"contractId": market_id, "amount": amount, "outcome": outcome}
    if limit_prob:
        payload["limitProb"] = limit_prob
    r = requests.post(f"{API_URL}/bet", headers=h(), json=payload)
    return r.json()

def get_balance():
    r = requests.get(f"{API_URL}/me", headers=h())
    return r.json().get("balance", 0)

# Strategy: Buy extreme probabilities (likely to revert)
MIN_LIQUIDITY = 1000  # Only trade liquid markets

while True:
    try:
        balance = get_balance()
        print(f"\nBalance: {balance} Mana")

        # Search trending markets
        markets = search("2024")

        for m in markets:
            prob = m.get("probability", 0.5)
            liquidity = m.get("totalLiquidity", 0)

            if liquidity < MIN_LIQUIDITY:
                continue

            # Buy YES on very low probability (< 10%)
            if prob < 0.10:
                print(f"LOW: {m['question'][:50]} at {prob*100:.1f}%")
                if balance > 50:
                    bet(m["id"], 50, "YES", limit_prob=0.15)

            # Buy NO on very high probability (> 90%)
            elif prob > 0.90:
                print(f"HIGH: {m['question'][:50]} at {prob*100:.1f}%")
                if balance > 50:
                    bet(m["id"], 50, "NO", limit_prob=0.85)

        time.sleep(300)  # Check every 5 minutes

    except Exception as e:
        print(f"Error: {e}")
        time.sleep(60)
```

## Multiple Choice Markets

```python
def bet_multiple_choice(market_id: str, answer_id: str, amount: int):
    """Bet on a multiple choice market"""
    payload = {
        "contractId": market_id,
        "amount": amount,
        "answerId": answer_id
    }

    r = requests.post(f"{API_URL}/bet", headers=headers(), json=payload)
    r.raise_for_status()
    return r.json()

# Get market with answers
market = get_market("who-will-win-2024-election")
for answer in market.get("answers", []):
    print(f"{answer['text']}: {answer['probability']*100:.1f}% (ID: {answer['id']})")

# Bet on specific answer
bet_multiple_choice("market123", "answer456", 100)
```

## Create a Market

```python
def create_market(
    question: str,
    description: str = "",
    close_time: int = None,  # Unix timestamp
    initial_prob: float = 0.5,
    ante: int = 100  # Initial liquidity
):
    """Create a new binary market"""
    payload = {
        "outcomeType": "BINARY",
        "question": question,
        "description": description,
        "initialProb": int(initial_prob * 100),
        "ante": ante
    }

    if close_time:
        payload["closeTime"] = close_time * 1000  # Milliseconds

    r = requests.post(f"{API_URL}/market", headers=headers(), json=payload)
    r.raise_for_status()
    return r.json()

# Create market
new_market = create_market(
    question="Will it rain tomorrow in NYC?",
    initial_prob=0.3,
    ante=100
)
print(f"Created: {new_market['url']}")
```

## Important Notes

1. **Mana is play money** - Can be donated to charity
2. **No limit on bets** - Unlike real money markets
3. **Market maker AMM** - Prices move based on bets
4. **Limit orders** - Use `limitProb` for better prices
5. **API rate limits** - Be gentle, ~60 requests/minute
6. **Shares ≠ Mana** - Shares vary based on probability
