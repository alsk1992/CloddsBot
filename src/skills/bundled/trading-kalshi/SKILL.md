---
name: trading-kalshi
description: "Execute trades on Kalshi - full REST API access for markets, orders, positions, balance"
emoji: "📈"
gates:
  envs:
    - KALSHI_EMAIL
    - KALSHI_PASSWORD
---

# Kalshi Trading - Complete API Reference

Full access to Kalshi's CFTC-regulated prediction market via their REST API.

**Docs**: https://docs.kalshi.com/welcome
**Discord**: #dev channel for support

## Required Environment Variables

```bash
KALSHI_EMAIL=your@email.com
KALSHI_PASSWORD=your_password
```

## Installation

```bash
pip install requests
# Optional: pip install kalshi-python  # Official SDK
```

---

## API Base URLs

```python
# Production
BASE_URL = "https://trading-api.kalshi.com/trade-api/v2"

# Demo/Sandbox (for testing)
DEMO_URL = "https://demo-api.kalshi.co/trade-api/v2"
```

---

## Authentication

Kalshi uses email/password login returning a bearer token valid for 30 minutes.

### Login & Token Management

```python
import os
import time
import requests

BASE_URL = "https://trading-api.kalshi.com/trade-api/v2"

class KalshiClient:
    def __init__(self):
        self.email = os.getenv("KALSHI_EMAIL")
        self.password = os.getenv("KALSHI_PASSWORD")
        self.token = None
        self.token_expiry = 0
        self.member_id = None

    def _ensure_auth(self):
        """Refresh token if expired (30 min lifetime)"""
        if time.time() > self.token_expiry - 60:
            self._login()

    def _login(self):
        """POST /login - Get new auth token"""
        r = requests.post(f"{BASE_URL}/login", json={
            "email": self.email,
            "password": self.password
        })
        r.raise_for_status()
        data = r.json()
        self.token = data["token"]
        self.member_id = data.get("member_id")
        self.token_expiry = time.time() + 29 * 60  # Refresh at 29 mins
        return data

    def _headers(self):
        """Get auth headers for requests"""
        self._ensure_auth()
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }

    def logout(self):
        """POST /logout - Invalidate current token"""
        r = requests.post(f"{BASE_URL}/logout", headers=self._headers())
        self.token = None
        self.token_expiry = 0
        return r.status_code == 200

# Initialize
client = KalshiClient()
```

---

## Market Data Endpoints

### Get Markets

```python
def get_markets(
    status: str = "open",    # "open", "closed", "settled"
    series_ticker: str = None,  # Filter by series
    limit: int = 100,
    cursor: str = None  # For pagination
):
    """GET /markets - List markets"""
    params = {"status": status, "limit": limit}
    if series_ticker:
        params["series_ticker"] = series_ticker
    if cursor:
        params["cursor"] = cursor

    r = requests.get(f"{BASE_URL}/markets", headers=client._headers(), params=params)
    r.raise_for_status()
    data = r.json()
    return {
        "markets": data.get("markets", []),
        "cursor": data.get("cursor")  # Use for pagination
    }

# Examples
markets = get_markets(series_ticker="INXD")  # S&P 500 daily
markets = get_markets(series_ticker="FED")    # Fed rate decisions
markets = get_markets(series_ticker="KXBTC")  # Bitcoin price
```

### Get Single Market

```python
def get_market(ticker: str):
    """GET /markets/{ticker} - Single market details"""
    r = requests.get(f"{BASE_URL}/markets/{ticker}", headers=client._headers())
    r.raise_for_status()
    return r.json()["market"]

market = get_market("INXD-24JAN10-T5805")
# Returns: ticker, title, subtitle, status, yes_bid, yes_ask,
#          no_bid, no_ask, volume, open_interest, close_time, result
```

### Get Market Orderbook

```python
def get_orderbook(ticker: str, depth: int = 10):
    """GET /markets/{ticker}/orderbook - Full orderbook"""
    r = requests.get(f"{BASE_URL}/markets/{ticker}/orderbook",
                    headers=client._headers(),
                    params={"depth": depth})
    r.raise_for_status()
    data = r.json()["orderbook"]

    # data["yes"] = list of [price, size] for YES side
    # data["no"] = list of [price, size] for NO side
    return data

book = get_orderbook("INXD-24JAN10-T5805")
print(f"Yes bids: {book['yes']}")  # [[45, 100], [44, 200], ...]
print(f"No asks: {book['no']}")
```

### Get Market History/Trades

```python
def get_market_history(ticker: str, limit: int = 100):
    """GET /markets/{ticker}/history - Trade history"""
    r = requests.get(f"{BASE_URL}/markets/{ticker}/history",
                    headers=client._headers(),
                    params={"limit": limit})
    r.raise_for_status()
    return r.json().get("history", [])

trades = get_market_history("INXD-24JAN10-T5805")
for t in trades:
    print(f"{t['created_time']}: {t['count']} @ {t['yes_price']}¢")
```

### Get Series/Events

```python
def get_series():
    """GET /series - List all series (categories)"""
    r = requests.get(f"{BASE_URL}/series", headers=client._headers())
    r.raise_for_status()
    return r.json().get("series", [])

def get_events(series_ticker: str = None):
    """GET /events - List events"""
    params = {}
    if series_ticker:
        params["series_ticker"] = series_ticker
    r = requests.get(f"{BASE_URL}/events", headers=client._headers(), params=params)
    r.raise_for_status()
    return r.json().get("events", [])

series = get_series()
events = get_events("FED")
```

---

## Order Management

### Place Order

```python
def place_order(
    ticker: str,
    side: str,           # "yes" or "no"
    action: str,         # "buy" or "sell"
    count: int,          # Number of contracts
    price: int = None,   # Price in cents (1-99), None for market
    order_type: str = "limit",  # "limit" or "market"
    expiration_ts: int = None,  # Optional: GTD expiration timestamp
    client_order_id: str = None  # Optional: Your reference ID
):
    """POST /portfolio/orders - Place an order"""
    payload = {
        "ticker": ticker,
        "side": side.lower(),
        "action": action.lower(),
        "count": count,
        "type": order_type
    }

    if order_type == "limit" and price:
        # yes_price is always from YES perspective
        payload["yes_price"] = price if side.lower() == "yes" else (100 - price)

    if expiration_ts:
        payload["expiration_ts"] = expiration_ts

    if client_order_id:
        payload["client_order_id"] = client_order_id

    r = requests.post(f"{BASE_URL}/portfolio/orders",
                     headers=client._headers(),
                     json=payload)
    r.raise_for_status()
    return r.json()

# Examples
# Buy 10 YES at 45 cents
result = place_order("INXD-24JAN10-T5805", "yes", "buy", 10, 45)

# Sell 5 NO at 30 cents (equivalent to YES at 70 cents)
result = place_order("INXD-24JAN10-T5805", "no", "sell", 5, 30)

# Market order (immediate fill)
result = place_order("INXD-24JAN10-T5805", "yes", "buy", 10, order_type="market")
```

### Batch Create Orders

```python
def batch_create_orders(orders: list):
    """POST /portfolio/orders/batched - Create multiple orders"""
    payload = {"orders": orders}
    r = requests.post(f"{BASE_URL}/portfolio/orders/batched",
                     headers=client._headers(),
                     json=payload)
    r.raise_for_status()
    return r.json()

orders = [
    {"ticker": "INXD-24JAN10-T5805", "side": "yes", "action": "buy", "count": 5, "type": "limit", "yes_price": 40},
    {"ticker": "INXD-24JAN10-T5805", "side": "yes", "action": "buy", "count": 5, "type": "limit", "yes_price": 42},
]
results = batch_create_orders(orders)
```

### Amend Order

```python
def amend_order(order_id: str, count: int = None, price: int = None):
    """POST /portfolio/orders/{order_id}/amend - Modify order"""
    payload = {}
    if count:
        payload["count"] = count
    if price:
        payload["yes_price"] = price

    r = requests.post(f"{BASE_URL}/portfolio/orders/{order_id}/amend",
                     headers=client._headers(),
                     json=payload)
    r.raise_for_status()
    return r.json()
```

### Decrease Order Size

```python
def decrease_order(order_id: str, reduce_by: int):
    """POST /portfolio/orders/{order_id}/decrease - Reduce order size"""
    r = requests.post(f"{BASE_URL}/portfolio/orders/{order_id}/decrease",
                     headers=client._headers(),
                     json={"reduce_by": reduce_by})
    r.raise_for_status()
    return r.json()
```

### Cancel Order

```python
def cancel_order(order_id: str):
    """DELETE /portfolio/orders/{order_id} - Cancel single order"""
    r = requests.delete(f"{BASE_URL}/portfolio/orders/{order_id}",
                       headers=client._headers())
    return r.status_code in [200, 204]

def batch_cancel_orders(order_ids: list):
    """DELETE /portfolio/orders/batched - Cancel multiple orders"""
    r = requests.delete(f"{BASE_URL}/portfolio/orders/batched",
                       headers=client._headers(),
                       json={"order_ids": order_ids})
    r.raise_for_status()
    return r.json()

# Cancel specific order
cancel_order("abc123-order-id")

# Cancel multiple
batch_cancel_orders(["order-1", "order-2", "order-3"])
```

### Get Orders

```python
def get_orders(
    ticker: str = None,
    status: str = None,  # "resting", "canceled", "executed", "pending"
    limit: int = 100
):
    """GET /portfolio/orders - List orders"""
    params = {"limit": limit}
    if ticker:
        params["ticker"] = ticker
    if status:
        params["status"] = status

    r = requests.get(f"{BASE_URL}/portfolio/orders",
                    headers=client._headers(),
                    params=params)
    r.raise_for_status()
    return r.json().get("orders", [])

def get_order(order_id: str):
    """GET /portfolio/orders/{order_id} - Single order"""
    r = requests.get(f"{BASE_URL}/portfolio/orders/{order_id}",
                    headers=client._headers())
    r.raise_for_status()
    return r.json()["order"]

# Get all open orders
orders = get_orders(status="resting")
for o in orders:
    print(f"{o['order_id']}: {o['action']} {o['side']} {o['remaining_count']} @ {o['yes_price']}¢")
```

---

## Portfolio Management

### Get Balance

```python
def get_balance():
    """GET /portfolio/balance - Account balance"""
    r = requests.get(f"{BASE_URL}/portfolio/balance", headers=client._headers())
    r.raise_for_status()
    data = r.json()

    return {
        "balance": data.get("balance", 0) / 100,  # Available in dollars
        "portfolio_value": data.get("portfolio_value", 0) / 100
    }

bal = get_balance()
print(f"Available: ${bal['balance']:.2f}")
print(f"Portfolio: ${bal['portfolio_value']:.2f}")
```

### Get Positions

```python
def get_positions(limit: int = 100):
    """GET /portfolio/positions - Current positions"""
    r = requests.get(f"{BASE_URL}/portfolio/positions",
                    headers=client._headers(),
                    params={"limit": limit})
    r.raise_for_status()
    return r.json().get("market_positions", [])

positions = get_positions()
for p in positions:
    if p.get("position", 0) != 0:
        print(f"{p['ticker']}: {p['position']} contracts @ avg {p['average_price']}¢")
        print(f"  Realized P&L: ${p.get('realized_pnl', 0) / 100:.2f}")
```

### Get Fills (Trade History)

```python
def get_fills(
    ticker: str = None,
    limit: int = 100,
    cursor: str = None
):
    """GET /portfolio/fills - Executed trades"""
    params = {"limit": limit}
    if ticker:
        params["ticker"] = ticker
    if cursor:
        params["cursor"] = cursor

    r = requests.get(f"{BASE_URL}/portfolio/fills",
                    headers=client._headers(),
                    params=params)
    r.raise_for_status()
    data = r.json()
    return {
        "fills": data.get("fills", []),
        "cursor": data.get("cursor")
    }

fills = get_fills()
for f in fills["fills"]:
    print(f"{f['created_time']}: {f['action']} {f['side']} {f['count']} @ {f['price']}¢")
```

### Get Settlements

```python
def get_settlements(limit: int = 100):
    """GET /portfolio/settlements - Settlement history"""
    r = requests.get(f"{BASE_URL}/portfolio/settlements",
                    headers=client._headers(),
                    params={"limit": limit})
    r.raise_for_status()
    return r.json().get("settlements", [])

settlements = get_settlements()
for s in settlements:
    print(f"{s['ticker']}: Settled at {s['settlement_value']}¢, P&L: ${s['revenue'] / 100:.2f}")
```

---

## Exchange Status

```python
def get_exchange_status():
    """GET /exchange/status - Exchange operational status"""
    r = requests.get(f"{BASE_URL}/exchange/status", headers=client._headers())
    r.raise_for_status()
    return r.json()

status = get_exchange_status()
print(f"Trading: {status.get('trading_active')}")
print(f"Exchange open: {status.get('exchange_active')}")
```

---

## WebSocket (Real-time Data)

For real-time updates, use WebSocket after REST authentication:

```python
import websocket
import json

def on_message(ws, message):
    data = json.loads(message)
    print(f"Update: {data}")

def on_open(ws):
    # Subscribe to orderbook updates
    ws.send(json.dumps({
        "type": "subscribe",
        "channel": "orderbook",
        "ticker": "INXD-24JAN10-T5805"
    }))

# Connect with auth token
ws = websocket.WebSocketApp(
    f"wss://trading-api.kalshi.com/trade-api/ws/v2?token={client.token}",
    on_message=on_message,
    on_open=on_open
)
ws.run_forever()
```

---

## Complete Trading Bot

```python
#!/usr/bin/env python3
"""
Production Kalshi trading bot
"""

import os
import time
import requests

BASE_URL = "https://trading-api.kalshi.com/trade-api/v2"

class KalshiBot:
    def __init__(self):
        self.email = os.getenv("KALSHI_EMAIL")
        self.password = os.getenv("KALSHI_PASSWORD")
        self.token = None
        self.token_expiry = 0

    def _auth(self):
        if time.time() > self.token_expiry - 60:
            r = requests.post(f"{BASE_URL}/login", json={
                "email": self.email, "password": self.password
            })
            r.raise_for_status()
            self.token = r.json()["token"]
            self.token_expiry = time.time() + 29 * 60

    def _h(self):
        self._auth()
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def get_market(self, ticker):
        r = requests.get(f"{BASE_URL}/markets/{ticker}", headers=self._h())
        r.raise_for_status()
        return r.json()["market"]

    def get_positions(self):
        r = requests.get(f"{BASE_URL}/portfolio/positions", headers=self._h())
        r.raise_for_status()
        return {p["ticker"]: p for p in r.json().get("market_positions", [])}

    def get_balance(self):
        r = requests.get(f"{BASE_URL}/portfolio/balance", headers=self._h())
        r.raise_for_status()
        return r.json().get("balance", 0) / 100

    def buy(self, ticker, side, count, price):
        payload = {
            "ticker": ticker, "side": side, "action": "buy",
            "count": count, "type": "limit",
            "yes_price": price if side == "yes" else (100 - price)
        }
        r = requests.post(f"{BASE_URL}/portfolio/orders", headers=self._h(), json=payload)
        return r.json() if r.status_code == 200 else {"error": r.text}

    def sell(self, ticker, side, count, price):
        payload = {
            "ticker": ticker, "side": side, "action": "sell",
            "count": count, "type": "limit",
            "yes_price": price if side == "yes" else (100 - price)
        }
        r = requests.post(f"{BASE_URL}/portfolio/orders", headers=self._h(), json=payload)
        return r.json() if r.status_code == 200 else {"error": r.text}

# Run
bot = KalshiBot()
TICKER = "INXD-24JAN10-T5805"

while True:
    try:
        market = bot.get_market(TICKER)
        positions = bot.get_positions()
        balance = bot.get_balance()

        yes_bid = market["yes_bid"]
        yes_ask = market["yes_ask"]
        pos = positions.get(TICKER, {}).get("position", 0)

        print(f"Balance: ${balance:.2f}, Position: {pos}, Price: {yes_bid}/{yes_ask}")

        # Trading logic
        if yes_ask < 40 and pos < 10 and balance > 5:
            print(f"BUYING at {yes_ask}")
            bot.buy(TICKER, "yes", 5, yes_ask)
        elif yes_bid > 60 and pos > 0:
            print(f"SELLING at {yes_bid}")
            bot.sell(TICKER, "yes", pos, yes_bid)

        time.sleep(10)

    except Exception as e:
        print(f"Error: {e}")
        time.sleep(30)
```

---

## Popular Market Series

| Series | Description | Example Ticker |
|--------|-------------|----------------|
| FED | Fed rate decisions | FED-24MAR-T525 |
| INXD | S&P 500 daily close | INXD-24JAN10-T5805 |
| KXBTC | Bitcoin price brackets | KXBTC-24JAN-T45000 |
| KXETH | Ethereum price | KXETH-24JAN-T2500 |
| CPI | Inflation data | CPI-24JAN-T3.5 |
| GDP | GDP growth | GDP-24Q1-T2.0 |
| NFP | Non-farm payrolls | NFP-24JAN-T200K |

---

## Key Notes

1. **Prices in CENTS** - 45 means $0.45 per contract
2. **Contracts pay $1 if correct** - Cost is the price, profit is $1 - price
3. **No trading fees** - Only spread matters
4. **Token expires in 30 min** - Auto-refresh before expiry
5. **US residents only** - KYC verification required
6. **Rate limits exist** - Implement exponential backoff on 429 errors
7. **Max position limits** - Varies by market, check market details

---

## CLI Wrapper

For quick CLI access:

```bash
python trading/kalshi.py search "fed rate"
python trading/kalshi.py market <ticker>
python trading/kalshi.py buy <ticker> <side> <count> <price>
python trading/kalshi.py sell <ticker> <side> <count> <price>
python trading/kalshi.py positions
python trading/kalshi.py balance
python trading/kalshi.py orders
python trading/kalshi.py cancel <order_id>
```
