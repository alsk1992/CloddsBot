---
name: portfolio-sync
description: "Sync portfolio positions from Polymarket, Kalshi, and Manifold"
emoji: "📁"
---

# Portfolio Sync Skill

Real methods to fetch and sync positions from each prediction market platform.

## Polymarket Position Sync

Polymarket positions are held as ERC-1155 tokens on Polygon. Query on-chain balances.

```python
import os
import requests

WALLET = os.getenv("POLY_FUNDER_ADDRESS")
CTF_CONTRACT = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"  # Conditional Token Framework

def get_polymarket_positions(token_ids: list[str]) -> dict:
    """
    Get balances for specific token IDs

    Args:
        token_ids: List of token IDs to check (from market data)

    Returns:
        Dict of token_id -> balance in shares
    """
    positions = {}

    for token_id in token_ids:
        token_int = int(token_id)

        # ERC-1155 balanceOf call
        data = f"0x00fdd58e000000000000000000000000{WALLET[2:].lower()}{token_int:064x}"

        r = requests.post("https://polygon-rpc.com/", json={
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [{"to": CTF_CONTRACT, "data": data}, "latest"],
            "id": 1
        })

        result = r.json().get("result", "0x0")
        balance = int(result, 16) / 1e6  # Raw to shares

        if balance > 0:
            positions[token_id] = balance

    return positions

# Example: Check positions for BTC 15-min market
btc_tokens = [
    "21742633143463906290569050155826241533067272736897614950488156847949938836455",  # YES
    "48331043336612883890938759509493159234755048973500640148014422747788308965745"   # NO
]

positions = get_polymarket_positions(btc_tokens)
for token_id, balance in positions.items():
    print(f"Token {token_id[:20]}...: {balance} shares")
```

### Get All Polymarket Positions (via Gamma API)

```python
def get_all_polymarket_positions(wallet: str):
    """Get all positions for a wallet via Gamma API"""
    url = f"https://gamma-api.polymarket.com/positions?user={wallet.lower()}"
    r = requests.get(url)

    if r.status_code != 200:
        return []

    positions = r.json()

    result = []
    for p in positions:
        result.append({
            "market_id": p.get("conditionId"),
            "market_question": p.get("title", "Unknown"),
            "token_id": p.get("tokenId"),
            "outcome": p.get("outcome"),
            "size": float(p.get("size", 0)),
            "avg_price": float(p.get("avgPrice", 0)),
            "current_price": float(p.get("currentPrice", 0)),
            "pnl": float(p.get("pnl", 0)),
            "value": float(p.get("value", 0))
        })

    return result

positions = get_all_polymarket_positions(WALLET)
for p in positions:
    print(f"{p['market_question'][:40]}")
    print(f"  {p['outcome']}: {p['size']} shares @ {p['avg_price']:.2f} -> {p['current_price']:.2f}")
    print(f"  PnL: ${p['pnl']:.2f}")
```

### Get USDC Balance

```python
def get_usdc_balance(wallet: str) -> float:
    """Get USDC balance on Polygon"""
    USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"  # USDC on Polygon

    # ERC-20 balanceOf
    data = f"0x70a08231000000000000000000000000{wallet[2:].lower()}"

    r = requests.post("https://polygon-rpc.com/", json={
        "jsonrpc": "2.0",
        "method": "eth_call",
        "params": [{"to": USDC, "data": data}, "latest"],
        "id": 1
    })

    result = r.json().get("result", "0x0")
    balance = int(result, 16) / 1e6  # USDC has 6 decimals

    return balance

usdc = get_usdc_balance(WALLET)
print(f"USDC Balance: ${usdc:.2f}")
```

## Kalshi Position Sync

```python
import requests
import time

BASE_URL = "https://trading-api.kalshi.com/trade-api/v2"

class KalshiSync:
    def __init__(self, email: str, password: str):
        self.email = email
        self.password = password
        self.token = None
        self.token_expiry = 0

    def _auth(self):
        if time.time() > self.token_expiry - 60:
            r = requests.post(f"{BASE_URL}/login", json={
                "email": self.email,
                "password": self.password
            })
            r.raise_for_status()
            self.token = r.json()["token"]
            self.token_expiry = time.time() + 29 * 60

    def _headers(self):
        self._auth()
        return {"Authorization": f"Bearer {self.token}"}

    def get_positions(self):
        """Get all Kalshi positions"""
        r = requests.get(f"{BASE_URL}/portfolio/positions", headers=self._headers())
        r.raise_for_status()

        positions = []
        for p in r.json().get("market_positions", []):
            # Get market details
            market = requests.get(
                f"{BASE_URL}/markets/{p['ticker']}",
                headers=self._headers()
            ).json().get("market", {})

            positions.append({
                "market_id": p["ticker"],
                "market_question": market.get("title", p["ticker"]),
                "side": "YES" if p.get("position", 0) > 0 else "NO",
                "size": abs(p.get("position", 0)),
                "avg_price": p.get("average_price", 0) / 100,
                "current_price": market.get("yes_bid", 50) / 100,
                "value": abs(p.get("position", 0)) * market.get("yes_bid", 50) / 100,
                "pnl": p.get("realized_pnl", 0) / 100
            })

        return positions

    def get_balance(self):
        """Get Kalshi balance"""
        r = requests.get(f"{BASE_URL}/portfolio/balance", headers=self._headers())
        r.raise_for_status()
        data = r.json()
        return {
            "available": data.get("balance", 0) / 100,
            "portfolio_value": data.get("portfolio_value", 0) / 100
        }

# Usage
sync = KalshiSync(os.getenv("KALSHI_EMAIL"), os.getenv("KALSHI_PASSWORD"))

positions = sync.get_positions()
for p in positions:
    print(f"{p['market_question'][:40]}")
    print(f"  {p['side']}: {p['size']} @ {p['avg_price']:.2f} -> {p['current_price']:.2f}")

balance = sync.get_balance()
print(f"\nAvailable: ${balance['available']:.2f}")
print(f"Portfolio: ${balance['portfolio_value']:.2f}")
```

## Manifold Position Sync

```python
import requests

API_URL = "https://api.manifold.markets/v0"
API_KEY = os.getenv("MANIFOLD_API_KEY")

def get_manifold_positions():
    """Get all Manifold positions"""
    headers = {"Authorization": f"Key {API_KEY}"}

    # Get user profile
    r = requests.get(f"{API_URL}/me", headers=headers)
    r.raise_for_status()
    user = r.json()
    user_id = user["id"]
    balance = user.get("balance", 0)

    # Get all bets
    r = requests.get(f"{API_URL}/bets", headers=headers, params={"userId": user_id, "limit": 1000})
    bets = r.json()

    # Aggregate positions by market
    markets = {}
    for bet in bets:
        if bet.get("isSold") or bet.get("isCancelled"):
            continue

        mid = bet["contractId"]
        if mid not in markets:
            markets[mid] = {
                "yes_shares": 0,
                "no_shares": 0,
                "invested": 0,
                "question": bet.get("contractQuestion", "Unknown")
            }

        if bet["outcome"] == "YES":
            markets[mid]["yes_shares"] += bet.get("shares", 0)
        else:
            markets[mid]["no_shares"] += bet.get("shares", 0)

        markets[mid]["invested"] += bet["amount"]

    # Get current prices
    positions = []
    for mid, data in markets.items():
        if data["yes_shares"] == 0 and data["no_shares"] == 0:
            continue

        # Fetch current market price
        r = requests.get(f"{API_URL}/market/{mid}")
        if r.status_code == 200:
            market = r.json()
            prob = market.get("probability", 0.5)

            yes_value = data["yes_shares"] * prob
            no_value = data["no_shares"] * (1 - prob)
            total_value = yes_value + no_value
            pnl = total_value - data["invested"]

            positions.append({
                "market_id": mid,
                "market_question": data["question"],
                "yes_shares": data["yes_shares"],
                "no_shares": data["no_shares"],
                "invested": data["invested"],
                "current_value": total_value,
                "probability": prob,
                "pnl": pnl,
                "url": market.get("url", "")
            })

    return positions, balance

positions, balance = get_manifold_positions()
print(f"Mana Balance: {balance}")

for p in positions:
    print(f"\n{p['market_question'][:50]}")
    print(f"  YES: {p['yes_shares']:.1f} shares, NO: {p['no_shares']:.1f} shares")
    print(f"  Value: {p['current_value']:.0f}M, PnL: {p['pnl']:+.0f}M")
```

## Unified Portfolio Sync

```python
#!/usr/bin/env python3
"""
Sync portfolio from all prediction markets
"""

import os
from dataclasses import dataclass
from typing import List

@dataclass
class Position:
    platform: str
    market_id: str
    market_question: str
    side: str
    size: float
    avg_price: float
    current_price: float
    value: float
    pnl: float
    pnl_pct: float

def sync_all_portfolios() -> List[Position]:
    """Sync positions from all platforms"""
    all_positions = []

    # Polymarket
    if os.getenv("POLY_FUNDER_ADDRESS"):
        poly_positions = get_all_polymarket_positions(os.getenv("POLY_FUNDER_ADDRESS"))
        for p in poly_positions:
            avg = p["avg_price"] or 0.01
            pnl_pct = ((p["current_price"] - avg) / avg * 100) if avg > 0 else 0

            all_positions.append(Position(
                platform="polymarket",
                market_id=p["market_id"],
                market_question=p["market_question"],
                side=p["outcome"],
                size=p["size"],
                avg_price=avg,
                current_price=p["current_price"],
                value=p["value"],
                pnl=p["pnl"],
                pnl_pct=pnl_pct
            ))

    # Kalshi
    if os.getenv("KALSHI_EMAIL"):
        kalshi = KalshiSync(os.getenv("KALSHI_EMAIL"), os.getenv("KALSHI_PASSWORD"))
        kalshi_positions = kalshi.get_positions()
        for p in kalshi_positions:
            avg = p["avg_price"] or 0.01
            pnl_pct = ((p["current_price"] - avg) / avg * 100) if avg > 0 else 0

            all_positions.append(Position(
                platform="kalshi",
                market_id=p["market_id"],
                market_question=p["market_question"],
                side=p["side"],
                size=p["size"],
                avg_price=avg,
                current_price=p["current_price"],
                value=p["value"],
                pnl=p["pnl"],
                pnl_pct=pnl_pct
            ))

    # Manifold
    if os.getenv("MANIFOLD_API_KEY"):
        mani_positions, _ = get_manifold_positions()
        for p in mani_positions:
            invested = p["invested"] or 1
            pnl_pct = (p["pnl"] / invested * 100) if invested > 0 else 0

            # Add YES position
            if p["yes_shares"] > 0:
                all_positions.append(Position(
                    platform="manifold",
                    market_id=p["market_id"],
                    market_question=p["market_question"],
                    side="YES",
                    size=p["yes_shares"],
                    avg_price=0,  # Manifold doesn't track this
                    current_price=p["probability"],
                    value=p["yes_shares"] * p["probability"],
                    pnl=p["pnl"] / 2,  # Split PnL
                    pnl_pct=pnl_pct
                ))

            # Add NO position
            if p["no_shares"] > 0:
                all_positions.append(Position(
                    platform="manifold",
                    market_id=p["market_id"],
                    market_question=p["market_question"],
                    side="NO",
                    size=p["no_shares"],
                    avg_price=0,
                    current_price=1 - p["probability"],
                    value=p["no_shares"] * (1 - p["probability"]),
                    pnl=p["pnl"] / 2,
                    pnl_pct=pnl_pct
                ))

    return all_positions

# Run sync
positions = sync_all_portfolios()

# Print summary
total_value = sum(p.value for p in positions)
total_pnl = sum(p.pnl for p in positions)

print(f"\n{'='*60}")
print(f"PORTFOLIO SUMMARY")
print(f"{'='*60}")
print(f"Total Value: ${total_value:.2f}")
print(f"Total PnL: ${total_pnl:+.2f}")
print(f"{'='*60}")

for platform in ["polymarket", "kalshi", "manifold"]:
    plat_positions = [p for p in positions if p.platform == platform]
    if plat_positions:
        plat_value = sum(p.value for p in plat_positions)
        plat_pnl = sum(p.pnl for p in plat_positions)
        print(f"\n{platform.upper()}: ${plat_value:.2f} (PnL: ${plat_pnl:+.2f})")

        for p in plat_positions:
            print(f"  {p.market_question[:35]}")
            print(f"    {p.side}: {p.size:.1f} @ {p.avg_price:.2f} -> {p.current_price:.2f}")
            print(f"    Value: ${p.value:.2f}, PnL: ${p.pnl:+.2f} ({p.pnl_pct:+.1f}%)")
```

## Cron Job for Auto-Sync

```python
#!/usr/bin/env python3
"""
Run every hour to sync positions to database
"""

import sqlite3
from datetime import datetime

def sync_to_db():
    """Sync all positions to SQLite"""
    conn = sqlite3.connect("~/.clodds/clodds.db")
    positions = sync_all_portfolios()

    for p in positions:
        conn.execute("""
            INSERT OR REPLACE INTO positions
            (platform, market_id, market_question, side, size, avg_price, current_price, value, pnl, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            p.platform, p.market_id, p.market_question, p.side,
            p.size, p.avg_price, p.current_price, p.value, p.pnl,
            datetime.now().isoformat()
        ))

    conn.commit()
    conn.close()
    print(f"Synced {len(positions)} positions at {datetime.now()}")

if __name__ == "__main__":
    sync_to_db()
```

Add to crontab:
```bash
# Sync every hour
0 * * * * cd /path/to/clodds && python3 -c "from skills.portfolio_sync import sync_to_db; sync_to_db()"
```
