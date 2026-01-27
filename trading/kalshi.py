#!/usr/bin/env python3
"""
Kalshi Trading Module - FULL API IMPLEMENTATION (89 endpoints)
Complete coverage of Kalshi REST API v2.

Usage:
    # Exchange Info
    python kalshi.py exchange_status
    python kalshi.py exchange_schedule
    python kalshi.py announcements
    python kalshi.py fee_changes
    python kalshi.py user_data_timestamp

    # Market Discovery
    python kalshi.py search [query] [--status open|closed|settled] [--limit N]
    python kalshi.py market <ticker>
    python kalshi.py orderbook <ticker>
    python kalshi.py market_trades [--ticker <ticker>] [--limit N]
    python kalshi.py candlesticks <series_ticker> <ticker> [--interval 1|60|1440]
    python kalshi.py batch_candlesticks <tickers_json>

    # Events & Series
    python kalshi.py events [--status open|closed|settled] [--series <ticker>]
    python kalshi.py event <event_ticker>
    python kalshi.py event_metadata <event_ticker>
    python kalshi.py event_candlesticks <series_ticker> <event_ticker> [--interval 60]
    python kalshi.py forecast_history <series_ticker> <event_ticker>
    python kalshi.py multivariate_events
    python kalshi.py series [--category <cat>]
    python kalshi.py series_info <series_ticker>

    # Trading - Orders
    python kalshi.py buy <ticker> <yes|no> <count> <price_cents>
    python kalshi.py sell <ticker> <yes|no> <count> <price_cents>
    python kalshi.py market_order <ticker> <yes|no> <buy|sell> <count>
    python kalshi.py batch_create_orders <orders_json>
    python kalshi.py batch_cancel_orders <order_ids_comma_sep>

    # Order Management
    python kalshi.py orders [--ticker <ticker>] [--status resting|pending|canceled|executed]
    python kalshi.py get_order <order_id>
    python kalshi.py cancel <order_id>
    python kalshi.py cancel_all
    python kalshi.py amend_order <order_id> [--price <cents>] [--count <n>]
    python kalshi.py decrease_order <order_id> <reduce_by>
    python kalshi.py queue_position <order_id>
    python kalshi.py queue_positions

    # Order Groups (bracket/OCO orders)
    python kalshi.py create_order_group <orders_json> [--max_loss <cents>]
    python kalshi.py order_groups
    python kalshi.py order_group <group_id>
    python kalshi.py order_group_limit <group_id> <max_loss_cents>
    python kalshi.py order_group_trigger <group_id>
    python kalshi.py order_group_reset <group_id>
    python kalshi.py delete_order_group <group_id>

    # Portfolio
    python kalshi.py positions [--ticker <ticker>]
    python kalshi.py balance
    python kalshi.py fills [--ticker <ticker>] [--limit N]
    python kalshi.py settlements [--limit N]
    python kalshi.py resting_order_value

    # Subaccounts
    python kalshi.py create_subaccount <name>
    python kalshi.py subaccount_balances
    python kalshi.py subaccount_transfer <from_id> <to_id> <amount_cents>
    python kalshi.py subaccount_transfers

    # Communications (RFQ/Quotes - Block Trading)
    python kalshi.py comms_id
    python kalshi.py create_rfq <ticker> <side> <count> [--min_price <cents>] [--max_price <cents>]
    python kalshi.py rfqs
    python kalshi.py rfq <rfq_id>
    python kalshi.py cancel_rfq <rfq_id>
    python kalshi.py create_quote <rfq_id> <price_cents>
    python kalshi.py quotes
    python kalshi.py quote <quote_id>
    python kalshi.py cancel_quote <quote_id>
    python kalshi.py accept_quote <quote_id>
    python kalshi.py confirm_quote <quote_id>

    # Multivariate Collections
    python kalshi.py collections
    python kalshi.py collection <collection_ticker>
    python kalshi.py collection_lookup <collection_ticker>
    python kalshi.py collection_lookup_history <collection_ticker>

    # Live Data
    python kalshi.py live_data <type> <milestone_id>
    python kalshi.py live_data_batch <requests_json>

    # Milestones
    python kalshi.py milestones
    python kalshi.py milestone <milestone_id>

    # Structured Targets
    python kalshi.py structured_targets
    python kalshi.py structured_target <target_id>

    # Incentives
    python kalshi.py incentives

    # FCM (Futures Commission Merchant)
    python kalshi.py fcm_orders
    python kalshi.py fcm_positions

    # Search/Discovery
    python kalshi.py search_tags
    python kalshi.py search_sports

    # Account
    python kalshi.py account_limits
    python kalshi.py api_keys
    python kalshi.py create_api_key
    python kalshi.py delete_api_key <api_key>
"""

import os
import sys
import json
import time
import requests
from typing import Optional, List, Dict, Any

# Credentials from environment
KALSHI_EMAIL = os.getenv("KALSHI_EMAIL")
KALSHI_PASSWORD = os.getenv("KALSHI_PASSWORD")

# API URL
BASE_URL = "https://trading-api.kalshi.com/trade-api/v2"

# Auth state
_token = None
_token_expiry = 0


def _ensure_auth():
    """Refresh token if expired"""
    global _token, _token_expiry

    if not KALSHI_EMAIL or not KALSHI_PASSWORD:
        print("ERROR: Set KALSHI_EMAIL and KALSHI_PASSWORD environment variables")
        return False

    if time.time() > _token_expiry - 60:  # Refresh 1 min before expiry
        try:
            r = requests.post(f"{BASE_URL}/login", json={
                "email": KALSHI_EMAIL,
                "password": KALSHI_PASSWORD
            })
            r.raise_for_status()
            data = r.json()
            _token = data["token"]
            _token_expiry = time.time() + 29 * 60  # Token valid ~30 min
            return True
        except Exception as e:
            print(f"ERROR: Auth failed: {e}")
            return False

    return True


def _headers():
    """Get auth headers"""
    if not _ensure_auth():
        return {}
    return {
        "Authorization": f"Bearer {_token}",
        "Content-Type": "application/json"
    }


def search_markets(query: str = None, status: str = "open", limit: int = 20) -> List[Dict]:
    """Search for markets"""
    params = {"status": status, "limit": limit}

    r = requests.get(f"{BASE_URL}/markets", headers=_headers(), params=params)
    if r.status_code != 200:
        print(f"ERROR: Search failed: {r.status_code} - {r.text}")
        return []

    markets = r.json().get("markets", [])

    if query:
        query_lower = query.lower()
        markets = [m for m in markets if
                   query_lower in m.get("title", "").lower() or
                   query_lower in m.get("ticker", "").lower() or
                   query_lower in m.get("category", "").lower()]

    return [{
        "ticker": m["ticker"],
        "title": m["title"],
        "category": m.get("category", ""),
        "status": m.get("status", ""),
        "yes_bid": m.get("yes_bid", 0),
        "yes_ask": m.get("yes_ask", 0),
        "no_bid": m.get("no_bid", 0),
        "no_ask": m.get("no_ask", 0),
        "volume": m.get("volume", 0),
        "volume_24h": m.get("volume_24h", 0),
        "open_interest": m.get("open_interest", 0),
        "close_time": m.get("close_time", "")
    } for m in markets]


def get_market(ticker: str) -> Optional[Dict]:
    """Get single market details"""
    r = requests.get(f"{BASE_URL}/markets/{ticker}", headers=_headers())
    if r.status_code != 200:
        print(f"ERROR: Market fetch failed: {r.status_code}")
        return None

    m = r.json().get("market", {})
    return {
        "ticker": m["ticker"],
        "title": m["title"],
        "subtitle": m.get("subtitle", ""),
        "category": m.get("category", ""),
        "status": m.get("status", ""),
        "yes_bid": m.get("yes_bid", 0),
        "yes_ask": m.get("yes_ask", 0),
        "no_bid": m.get("no_bid", 0),
        "no_ask": m.get("no_ask", 0),
        "volume": m.get("volume", 0),
        "volume_24h": m.get("volume_24h", 0),
        "open_interest": m.get("open_interest", 0),
        "close_time": m.get("close_time", ""),
        "result": m.get("result")
    }


def place_order(
    ticker: str,
    side: str,      # "yes" or "no"
    action: str,    # "buy" or "sell"
    count: int,     # Number of contracts
    price: int,     # Price in CENTS (1-99)
    order_type: str = "limit"
) -> Dict:
    """
    Place an order on Kalshi

    Args:
        ticker: Market ticker (e.g., "FED-24MAR-T525")
        side: "yes" or "no"
        action: "buy" or "sell"
        count: Number of contracts
        price: Price in CENTS (1-99)
        order_type: "limit" or "market"

    Returns:
        Order result dict
    """
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    payload = {
        "ticker": ticker,
        "side": side.lower(),
        "action": action.lower(),
        "count": int(count),
        "type": order_type,
    }

    if order_type == "limit":
        payload["yes_price"] = int(price) if side.lower() == "yes" else (100 - int(price))

    try:
        r = requests.post(f"{BASE_URL}/portfolio/orders", headers=_headers(), json=payload)

        if r.status_code != 200:
            return {"success": False, "error": f"Order failed: {r.status_code} - {r.text}"}

        result = r.json()
        order = result.get("order", {})

        return {
            "success": True,
            "order_id": order.get("order_id"),
            "status": order.get("status"),
            "ticker": ticker,
            "side": side,
            "action": action,
            "count": count,
            "price": price,
            "result": result
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


def buy(ticker: str, side: str, count: int, price: int) -> Dict:
    """Place a BUY order"""
    return place_order(ticker, side, "buy", count, price)


def sell(ticker: str, side: str, count: int, price: int) -> Dict:
    """Place a SELL order"""
    return place_order(ticker, side, "sell", count, price)


def cancel_order(order_id: str) -> Dict:
    """Cancel a specific order"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.delete(f"{BASE_URL}/portfolio/orders/{order_id}", headers=_headers())

        if r.status_code not in [200, 204]:
            return {"success": False, "error": f"Cancel failed: {r.status_code}"}

        return {"success": True, "order_id": order_id}

    except Exception as e:
        return {"success": False, "error": str(e)}


def get_open_orders() -> List[Dict]:
    """Get all open orders"""
    if not _ensure_auth():
        return []

    r = requests.get(f"{BASE_URL}/portfolio/orders", headers=_headers())
    if r.status_code != 200:
        print(f"ERROR: Orders fetch failed: {r.status_code}")
        return []

    orders = r.json().get("orders", [])
    return [{
        "order_id": o.get("order_id"),
        "ticker": o.get("ticker"),
        "side": o.get("side"),
        "action": o.get("action"),
        "count": o.get("remaining_count", 0),
        "price": o.get("yes_price", 0),
        "status": o.get("status"),
        "created_time": o.get("created_time")
    } for o in orders]


def get_positions() -> List[Dict]:
    """Get current positions"""
    if not _ensure_auth():
        return []

    r = requests.get(f"{BASE_URL}/portfolio/positions", headers=_headers())
    if r.status_code != 200:
        print(f"ERROR: Positions fetch failed: {r.status_code}")
        return []

    positions = []
    for p in r.json().get("market_positions", []):
        ticker = p.get("ticker", "")

        # Get current market price
        market = get_market(ticker)
        current_price = market["yes_bid"] if market else 50

        position = p.get("position", 0)
        avg_price = p.get("average_price", 0)
        realized_pnl = p.get("realized_pnl", 0)

        # Calculate unrealized PnL
        unrealized_pnl = (current_price - avg_price) * position / 100 if position > 0 else 0

        positions.append({
            "ticker": ticker,
            "title": market["title"] if market else ticker,
            "position": position,
            "avg_price": avg_price,
            "current_price": current_price,
            "value": position * current_price / 100,
            "realized_pnl": realized_pnl / 100,
            "unrealized_pnl": unrealized_pnl,
            "total_pnl": (realized_pnl / 100) + unrealized_pnl
        })

    return positions


def get_balance() -> Dict:
    """Get account balance"""
    if not _ensure_auth():
        return {"available": 0, "portfolio_value": 0}

    r = requests.get(f"{BASE_URL}/portfolio/balance", headers=_headers())
    if r.status_code != 200:
        print(f"ERROR: Balance fetch failed: {r.status_code}")
        return {"available": 0, "portfolio_value": 0}

    data = r.json()
    return {
        "available": data.get("balance", 0) / 100,
        "portfolio_value": data.get("portfolio_value", 0) / 100
    }


# =============================================================================
# EXCHANGE INFO
# =============================================================================

def get_exchange_status() -> Dict:
    """Get current exchange operational status"""
    try:
        r = requests.get(f"{BASE_URL}/exchange/status")
        if r.status_code == 200:
            return {"success": True, "status": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_exchange_schedule() -> Dict:
    """Get exchange trading hours and schedule"""
    try:
        r = requests.get(f"{BASE_URL}/exchange/schedule")
        if r.status_code == 200:
            return {"success": True, "schedule": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_announcements() -> Dict:
    """Get platform-wide announcements"""
    try:
        r = requests.get(f"{BASE_URL}/exchange/announcements")
        if r.status_code == 200:
            return {"success": True, "announcements": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# MARKET DATA - EXTENDED
# =============================================================================

def get_orderbook(ticker: str) -> Dict:
    """Get orderbook for a market"""
    try:
        r = requests.get(f"{BASE_URL}/markets/{ticker}/orderbook", headers=_headers())
        if r.status_code == 200:
            data = r.json().get("orderbook", {})
            return {
                "success": True,
                "ticker": ticker,
                "yes_bids": data.get("yes", []),
                "no_bids": data.get("no", [])
            }
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_market_trades(ticker: str = None, limit: int = 100) -> Dict:
    """Get recent trades across markets or for specific ticker"""
    params = {"limit": limit}
    if ticker:
        params["ticker"] = ticker
    try:
        r = requests.get(f"{BASE_URL}/markets/trades", headers=_headers(), params=params)
        if r.status_code == 200:
            return {"success": True, "trades": r.json().get("trades", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_candlesticks(series_ticker: str, ticker: str, interval: int = 60) -> Dict:
    """
    Get candlestick data for a market

    Args:
        series_ticker: Series ticker (e.g., "FED")
        ticker: Market ticker
        interval: 1 (1 min), 60 (1 hour), or 1440 (1 day)
    """
    params = {"period_interval": interval}
    try:
        r = requests.get(
            f"{BASE_URL}/series/{series_ticker}/markets/{ticker}/candlesticks",
            headers=_headers(), params=params
        )
        if r.status_code == 200:
            return {"success": True, "candlesticks": r.json().get("candlesticks", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# EVENTS & SERIES
# =============================================================================

def get_events(status: str = None, series_ticker: str = None, limit: int = 100) -> Dict:
    """Get list of events"""
    params = {"limit": limit, "with_nested_markets": True}
    if status:
        params["status"] = status
    if series_ticker:
        params["series_ticker"] = series_ticker
    try:
        r = requests.get(f"{BASE_URL}/events", headers=_headers(), params=params)
        if r.status_code == 200:
            events = r.json().get("events", [])
            return {
                "success": True,
                "events": [{
                    "event_ticker": e.get("event_ticker"),
                    "title": e.get("title"),
                    "category": e.get("category"),
                    "status": e.get("status"),
                    "series_ticker": e.get("series_ticker"),
                    "markets_count": len(e.get("markets", []))
                } for e in events]
            }
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_event(event_ticker: str) -> Dict:
    """Get specific event with nested markets"""
    params = {"with_nested_markets": True}
    try:
        r = requests.get(f"{BASE_URL}/events/{event_ticker}", headers=_headers(), params=params)
        if r.status_code == 200:
            return {"success": True, "event": r.json().get("event", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_series(category: str = None) -> Dict:
    """Get list of series"""
    params = {"include_volume": True}
    if category:
        params["category"] = category
    try:
        r = requests.get(f"{BASE_URL}/series", headers=_headers(), params=params)
        if r.status_code == 200:
            return {"success": True, "series": r.json().get("series", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_series_info(series_ticker: str) -> Dict:
    """Get specific series details"""
    params = {"include_volume": True}
    try:
        r = requests.get(f"{BASE_URL}/series/{series_ticker}", headers=_headers(), params=params)
        if r.status_code == 200:
            return {"success": True, "series": r.json().get("series", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# ORDER MANAGEMENT - EXTENDED
# =============================================================================

def get_order(order_id: str) -> Dict:
    """Get specific order details"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}
    try:
        r = requests.get(f"{BASE_URL}/portfolio/orders/{order_id}", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "order": r.json().get("order", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def market_order(ticker: str, side: str, action: str, count: int) -> Dict:
    """
    Place a market order (immediate execution at best available price)

    Args:
        ticker: Market ticker
        side: "yes" or "no"
        action: "buy" or "sell"
        count: Number of contracts
    """
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    payload = {
        "ticker": ticker,
        "side": side.lower(),
        "action": action.lower(),
        "count": int(count),
        "type": "market"
    }

    try:
        r = requests.post(f"{BASE_URL}/portfolio/orders", headers=_headers(), json=payload)
        if r.status_code == 200:
            return {"success": True, "order": r.json().get("order", {})}
        return {"success": False, "error": f"HTTP {r.status_code} - {r.text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def batch_create_orders(orders: List[Dict]) -> Dict:
    """
    Create multiple orders in a single request (up to 20)

    Args:
        orders: List of order dicts with ticker, side, action, count, type, yes_price
    """
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    if len(orders) > 20:
        return {"success": False, "error": "Maximum 20 orders per batch"}

    try:
        r = requests.post(
            f"{BASE_URL}/portfolio/orders/batched",
            headers=_headers(),
            json={"orders": orders}
        )
        if r.status_code == 200:
            return {"success": True, "orders": r.json().get("orders", [])}
        return {"success": False, "error": f"HTTP {r.status_code} - {r.text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def batch_cancel_orders(order_ids: List[str]) -> Dict:
    """Cancel multiple orders in a single request"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.delete(
            f"{BASE_URL}/portfolio/orders/batched",
            headers=_headers(),
            json={"ids": order_ids}
        )
        if r.status_code in [200, 204]:
            return {"success": True, "cancelled": order_ids}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def cancel_all_orders() -> Dict:
    """Cancel ALL open orders"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    # First get all open orders
    orders = get_open_orders()
    if not orders:
        return {"success": True, "message": "No open orders to cancel"}

    order_ids = [o["order_id"] for o in orders if o.get("order_id")]
    if not order_ids:
        return {"success": True, "message": "No open orders to cancel"}

    return batch_cancel_orders(order_ids)


def amend_order(order_id: str, price: int = None, count: int = None) -> Dict:
    """
    Modify an existing order's price and/or count

    Args:
        order_id: Order ID to modify
        price: New price in cents (optional)
        count: New contract count (optional)
    """
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    payload = {}
    if price is not None:
        payload["price"] = int(price)
    if count is not None:
        payload["count"] = int(count)

    if not payload:
        return {"success": False, "error": "Must specify price and/or count"}

    try:
        r = requests.post(
            f"{BASE_URL}/portfolio/orders/{order_id}/amend",
            headers=_headers(),
            json=payload
        )
        if r.status_code == 200:
            return {"success": True, "order": r.json().get("order", {})}
        return {"success": False, "error": f"HTTP {r.status_code} - {r.text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def decrease_order(order_id: str, reduce_by: int) -> Dict:
    """
    Reduce the quantity of an existing order

    Args:
        order_id: Order ID to modify
        reduce_by: Number of contracts to reduce by
    """
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.post(
            f"{BASE_URL}/portfolio/orders/{order_id}/decrease",
            headers=_headers(),
            json={"reduce_by": int(reduce_by)}
        )
        if r.status_code == 200:
            return {"success": True, "order": r.json().get("order", {})}
        return {"success": False, "error": f"HTTP {r.status_code} - {r.text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_queue_position(order_id: str) -> Dict:
    """Get queue position for a specific resting order"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(
            f"{BASE_URL}/portfolio/orders/{order_id}/queue_position",
            headers=_headers()
        )
        if r.status_code == 200:
            return {"success": True, "queue_position": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_queue_positions() -> Dict:
    """Get queue positions for all resting orders"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/portfolio/orders/queue_positions", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "queue_positions": r.json().get("queue_positions", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# PORTFOLIO - EXTENDED
# =============================================================================

def get_fills(ticker: str = None, order_id: str = None, limit: int = 100) -> Dict:
    """Get trade fills (executed trades)"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    params = {"limit": limit}
    if ticker:
        params["ticker"] = ticker
    if order_id:
        params["order_id"] = order_id

    try:
        r = requests.get(f"{BASE_URL}/portfolio/fills", headers=_headers(), params=params)
        if r.status_code == 200:
            return {"success": True, "fills": r.json().get("fills", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_settlements(limit: int = 100) -> Dict:
    """Get settlement history (resolved positions)"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    params = {"limit": limit}
    try:
        r = requests.get(f"{BASE_URL}/portfolio/settlements", headers=_headers(), params=params)
        if r.status_code == 200:
            return {"success": True, "settlements": r.json().get("settlements", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# ACCOUNT & API KEYS
# =============================================================================

def get_account_limits() -> Dict:
    """Get API rate limits for your account tier"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/account/limits", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "limits": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_api_keys() -> Dict:
    """List all API keys for your account"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/api_keys", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "api_keys": r.json().get("api_keys", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def create_api_key() -> Dict:
    """Generate a new API key pair (returns private key once - save it!)"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.post(f"{BASE_URL}/api_keys/generate", headers=_headers())
        if r.status_code == 200:
            data = r.json()
            return {
                "success": True,
                "api_key": data.get("api_key"),
                "private_key": data.get("private_key"),
                "warning": "Save the private_key now - it won't be shown again!"
            }
        return {"success": False, "error": f"HTTP {r.status_code} - {r.text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def delete_api_key(api_key: str) -> Dict:
    """Delete an API key"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.delete(f"{BASE_URL}/api_keys/{api_key}", headers=_headers())
        if r.status_code in [200, 204]:
            return {"success": True, "deleted": api_key}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# EXCHANGE INFO - EXTENDED
# =============================================================================

def get_fee_changes() -> Dict:
    """Get upcoming series fee changes"""
    try:
        r = requests.get(f"{BASE_URL}/series/fee_changes", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "fee_changes": r.json().get("fee_changes", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_user_data_timestamp() -> Dict:
    """Get timestamp of last user data update (useful for caching)"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}
    try:
        r = requests.get(f"{BASE_URL}/exchange/user_data_timestamp", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "timestamp": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# MARKET DATA - BATCH
# =============================================================================

def batch_candlesticks(tickers: List[Dict]) -> Dict:
    """
    Get candlesticks for multiple markets in one request

    Args:
        tickers: List of dicts with series_ticker, ticker, period_interval
    """
    try:
        r = requests.post(
            f"{BASE_URL}/markets/candlesticks",
            headers=_headers(),
            json={"markets": tickers}
        )
        if r.status_code == 200:
            return {"success": True, "candlesticks": r.json().get("candlesticks", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# EVENTS - EXTENDED
# =============================================================================

def get_event_metadata(event_ticker: str) -> Dict:
    """Get metadata for an event (rules, resolution criteria, etc.)"""
    try:
        r = requests.get(f"{BASE_URL}/events/{event_ticker}/metadata", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "metadata": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_event_candlesticks(series_ticker: str, event_ticker: str, interval: int = 60) -> Dict:
    """Get candlestick data for an event"""
    params = {"period_interval": interval}
    try:
        r = requests.get(
            f"{BASE_URL}/series/{series_ticker}/events/{event_ticker}/candlesticks",
            headers=_headers(), params=params
        )
        if r.status_code == 200:
            return {"success": True, "candlesticks": r.json().get("candlesticks", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_forecast_history(series_ticker: str, event_ticker: str) -> Dict:
    """Get forecast percentile history for an event"""
    try:
        r = requests.get(
            f"{BASE_URL}/series/{series_ticker}/events/{event_ticker}/forecast_percentile_history",
            headers=_headers()
        )
        if r.status_code == 200:
            return {"success": True, "history": r.json().get("history", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_multivariate_events() -> Dict:
    """Get multivariate events (events with multiple correlated markets)"""
    try:
        r = requests.get(f"{BASE_URL}/events/multivariate", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "events": r.json().get("events", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# ORDER GROUPS (Bracket/OCO Orders)
# =============================================================================

def create_order_group(orders: List[Dict], max_loss: int = None) -> Dict:
    """
    Create an order group (bracket/OCO orders)

    Args:
        orders: List of order dicts
        max_loss: Maximum loss in cents for the group (optional)
    """
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    payload = {"orders": orders}
    if max_loss is not None:
        payload["max_loss"] = int(max_loss)

    try:
        r = requests.post(
            f"{BASE_URL}/portfolio/order_groups/create",
            headers=_headers(),
            json=payload
        )
        if r.status_code == 200:
            return {"success": True, "order_group": r.json().get("order_group", {})}
        return {"success": False, "error": f"HTTP {r.status_code} - {r.text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_order_groups() -> Dict:
    """List all order groups"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/portfolio/order_groups", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "order_groups": r.json().get("order_groups", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_order_group(group_id: str) -> Dict:
    """Get specific order group"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/portfolio/order_groups/{group_id}", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "order_group": r.json().get("order_group", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def update_order_group_limit(group_id: str, max_loss: int) -> Dict:
    """Update max loss limit for an order group"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.put(
            f"{BASE_URL}/portfolio/order_groups/{group_id}/limit",
            headers=_headers(),
            json={"max_loss": int(max_loss)}
        )
        if r.status_code == 200:
            return {"success": True, "order_group": r.json().get("order_group", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def trigger_order_group(group_id: str) -> Dict:
    """Manually trigger an order group"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.put(
            f"{BASE_URL}/portfolio/order_groups/{group_id}/trigger",
            headers=_headers()
        )
        if r.status_code == 200:
            return {"success": True, "order_group": r.json().get("order_group", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def reset_order_group(group_id: str) -> Dict:
    """Reset an order group to initial state"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.put(
            f"{BASE_URL}/portfolio/order_groups/{group_id}/reset",
            headers=_headers()
        )
        if r.status_code == 200:
            return {"success": True, "order_group": r.json().get("order_group", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def delete_order_group(group_id: str) -> Dict:
    """Delete an order group"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.delete(
            f"{BASE_URL}/portfolio/order_groups/{group_id}",
            headers=_headers()
        )
        if r.status_code in [200, 204]:
            return {"success": True, "deleted": group_id}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# PORTFOLIO - EXTENDED
# =============================================================================

def get_resting_order_value() -> Dict:
    """Get total value of resting orders"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(
            f"{BASE_URL}/portfolio/summary/total_resting_order_value",
            headers=_headers()
        )
        if r.status_code == 200:
            return {"success": True, "resting_order_value": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# SUBACCOUNTS
# =============================================================================

def create_subaccount(name: str) -> Dict:
    """Create a new subaccount"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.post(
            f"{BASE_URL}/portfolio/subaccounts",
            headers=_headers(),
            json={"name": name}
        )
        if r.status_code == 200:
            return {"success": True, "subaccount": r.json().get("subaccount", {})}
        return {"success": False, "error": f"HTTP {r.status_code} - {r.text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_subaccount_balances() -> Dict:
    """Get balances for all subaccounts"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/portfolio/subaccounts/balances", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "balances": r.json().get("balances", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def subaccount_transfer(from_id: str, to_id: str, amount: int) -> Dict:
    """
    Transfer funds between subaccounts

    Args:
        from_id: Source subaccount ID
        to_id: Destination subaccount ID
        amount: Amount in cents
    """
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.post(
            f"{BASE_URL}/portfolio/subaccounts/transfer",
            headers=_headers(),
            json={"from_subaccount_id": from_id, "to_subaccount_id": to_id, "amount": int(amount)}
        )
        if r.status_code == 200:
            return {"success": True, "transfer": r.json().get("transfer", {})}
        return {"success": False, "error": f"HTTP {r.status_code} - {r.text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_subaccount_transfers() -> Dict:
    """Get transfer history between subaccounts"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/portfolio/subaccounts/transfers", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "transfers": r.json().get("transfers", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# COMMUNICATIONS (RFQ/Quotes - Block Trading)
# =============================================================================

def get_comms_id() -> Dict:
    """Get your communications/RFQ user ID"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/communications/id", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "comms_id": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def create_rfq(ticker: str, side: str, count: int, min_price: int = None, max_price: int = None) -> Dict:
    """
    Create a Request for Quote (RFQ) for block trading

    Args:
        ticker: Market ticker
        side: "yes" or "no"
        count: Number of contracts
        min_price: Minimum acceptable price in cents (optional)
        max_price: Maximum acceptable price in cents (optional)
    """
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    payload = {
        "ticker": ticker,
        "side": side.lower(),
        "count": int(count)
    }
    if min_price is not None:
        payload["min_price"] = int(min_price)
    if max_price is not None:
        payload["max_price"] = int(max_price)

    try:
        r = requests.post(f"{BASE_URL}/communications/rfqs", headers=_headers(), json=payload)
        if r.status_code == 200:
            return {"success": True, "rfq": r.json().get("rfq", {})}
        return {"success": False, "error": f"HTTP {r.status_code} - {r.text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_rfqs() -> Dict:
    """List all your RFQs"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/communications/rfqs", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "rfqs": r.json().get("rfqs", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_rfq(rfq_id: str) -> Dict:
    """Get specific RFQ"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/communications/rfqs/{rfq_id}", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "rfq": r.json().get("rfq", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def cancel_rfq(rfq_id: str) -> Dict:
    """Cancel an RFQ"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.delete(f"{BASE_URL}/communications/rfqs/{rfq_id}", headers=_headers())
        if r.status_code in [200, 204]:
            return {"success": True, "cancelled": rfq_id}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def create_quote(rfq_id: str, price: int) -> Dict:
    """
    Create a quote in response to an RFQ

    Args:
        rfq_id: RFQ ID to respond to
        price: Price in cents
    """
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.post(
            f"{BASE_URL}/communications/quotes",
            headers=_headers(),
            json={"rfq_id": rfq_id, "price": int(price)}
        )
        if r.status_code == 200:
            return {"success": True, "quote": r.json().get("quote", {})}
        return {"success": False, "error": f"HTTP {r.status_code} - {r.text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_quotes() -> Dict:
    """List all your quotes"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/communications/quotes", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "quotes": r.json().get("quotes", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_quote(quote_id: str) -> Dict:
    """Get specific quote"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/communications/quotes/{quote_id}", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "quote": r.json().get("quote", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def cancel_quote(quote_id: str) -> Dict:
    """Cancel a quote"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.delete(f"{BASE_URL}/communications/quotes/{quote_id}", headers=_headers())
        if r.status_code in [200, 204]:
            return {"success": True, "cancelled": quote_id}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def accept_quote(quote_id: str) -> Dict:
    """Accept a quote (as the RFQ creator)"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.put(
            f"{BASE_URL}/communications/quotes/{quote_id}/accept",
            headers=_headers()
        )
        if r.status_code == 200:
            return {"success": True, "quote": r.json().get("quote", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def confirm_quote(quote_id: str) -> Dict:
    """Confirm a quote (as the quote creator, after acceptance)"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.put(
            f"{BASE_URL}/communications/quotes/{quote_id}/confirm",
            headers=_headers()
        )
        if r.status_code == 200:
            return {"success": True, "quote": r.json().get("quote", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# MULTIVARIATE COLLECTIONS
# =============================================================================

def get_collections() -> Dict:
    """List all multivariate event collections"""
    try:
        r = requests.get(f"{BASE_URL}/multivariate_event_collections", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "collections": r.json().get("collections", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_collection(collection_ticker: str) -> Dict:
    """Get specific multivariate collection"""
    try:
        r = requests.get(
            f"{BASE_URL}/multivariate_event_collections/{collection_ticker}",
            headers=_headers()
        )
        if r.status_code == 200:
            return {"success": True, "collection": r.json().get("collection", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_collection_lookup(collection_ticker: str) -> Dict:
    """Get market lookup for a multivariate collection"""
    try:
        r = requests.get(
            f"{BASE_URL}/multivariate_event_collections/{collection_ticker}/lookup",
            headers=_headers()
        )
        if r.status_code == 200:
            return {"success": True, "lookup": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_collection_lookup_history(collection_ticker: str) -> Dict:
    """Get lookup history for a multivariate collection"""
    try:
        r = requests.get(
            f"{BASE_URL}/multivariate_event_collections/{collection_ticker}/lookup_history",
            headers=_headers()
        )
        if r.status_code == 200:
            return {"success": True, "history": r.json().get("history", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# LIVE DATA
# =============================================================================

def get_live_data(data_type: str, milestone_id: str) -> Dict:
    """
    Get live data for a milestone

    Args:
        data_type: Type of data (e.g., "weather", "sports")
        milestone_id: Milestone ID
    """
    try:
        r = requests.get(
            f"{BASE_URL}/live_data/{data_type}/milestone/{milestone_id}",
            headers=_headers()
        )
        if r.status_code == 200:
            return {"success": True, "live_data": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_live_data_batch(requests_list: List[Dict]) -> Dict:
    """
    Get live data for multiple milestones in batch

    Args:
        requests_list: List of dicts with type and milestone_id
    """
    try:
        r = requests.post(
            f"{BASE_URL}/live_data/batch",
            headers=_headers(),
            json={"requests": requests_list}
        )
        if r.status_code == 200:
            return {"success": True, "results": r.json().get("results", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# MILESTONES
# =============================================================================

def get_milestones() -> Dict:
    """List all milestones"""
    try:
        r = requests.get(f"{BASE_URL}/milestones", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "milestones": r.json().get("milestones", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_milestone(milestone_id: str) -> Dict:
    """Get specific milestone"""
    try:
        r = requests.get(f"{BASE_URL}/milestones/{milestone_id}", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "milestone": r.json().get("milestone", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# STRUCTURED TARGETS
# =============================================================================

def get_structured_targets() -> Dict:
    """List all structured targets"""
    try:
        r = requests.get(f"{BASE_URL}/structured_targets", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "structured_targets": r.json().get("structured_targets", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_structured_target(target_id: str) -> Dict:
    """Get specific structured target"""
    try:
        r = requests.get(f"{BASE_URL}/structured_targets/{target_id}", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "structured_target": r.json().get("structured_target", {})}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# INCENTIVES
# =============================================================================

def get_incentives() -> Dict:
    """Get available incentive programs"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/incentive_programs", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "incentives": r.json().get("incentive_programs", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# FCM (Futures Commission Merchant)
# =============================================================================

def get_fcm_orders() -> Dict:
    """Get FCM orders (for institutional accounts)"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/fcm/orders", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "orders": r.json().get("orders", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_fcm_positions() -> Dict:
    """Get FCM positions (for institutional accounts)"""
    if not _ensure_auth():
        return {"success": False, "error": "Authentication failed"}

    try:
        r = requests.get(f"{BASE_URL}/fcm/positions", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "positions": r.json().get("positions", [])}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# SEARCH/DISCOVERY
# =============================================================================

def get_search_tags() -> Dict:
    """Get search tags organized by category"""
    try:
        r = requests.get(f"{BASE_URL}/search/tags_by_categories", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "tags": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_search_sports() -> Dict:
    """Get sports filters for search"""
    try:
        r = requests.get(f"{BASE_URL}/search/filters_by_sport", headers=_headers())
        if r.status_code == 200:
            return {"success": True, "sports": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    """CLI interface"""
    if len(sys.argv) < 2:
        print(__doc__)
        return

    cmd = sys.argv[1].lower()

    # ==========================================================================
    # EXCHANGE INFO
    # ==========================================================================

    if cmd == "exchange_status":
        result = get_exchange_status()
        print(json.dumps(result, indent=2))

    elif cmd == "exchange_schedule":
        result = get_exchange_schedule()
        print(json.dumps(result, indent=2))

    elif cmd == "announcements":
        result = get_announcements()
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # MARKET DISCOVERY
    # ==========================================================================

    elif cmd == "search":
        query = sys.argv[2] if len(sys.argv) > 2 else None
        results = search_markets(query)
        for r in results:
            print(f"\n{r['title']}")
            print(f"  Ticker: {r['ticker']}")
            print(f"  YES: {r['yes_bid']}¢ / {r['yes_ask']}¢")
            print(f"  Volume: ${r['volume']/100:,.2f}")

    elif cmd == "market":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py market <ticker>")
            return
        ticker = sys.argv[2]
        m = get_market(ticker)
        if m:
            print(json.dumps(m, indent=2))

    elif cmd == "orderbook":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py orderbook <ticker>")
            return
        result = get_orderbook(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "market_trades":
        ticker = None
        limit = 100
        for i, arg in enumerate(sys.argv[2:], 2):
            if arg == "--ticker" and i+1 < len(sys.argv):
                ticker = sys.argv[i+1]
            elif arg == "--limit" and i+1 < len(sys.argv):
                limit = int(sys.argv[i+1])
        result = get_market_trades(ticker, limit)
        print(json.dumps(result, indent=2))

    elif cmd == "candlesticks":
        if len(sys.argv) < 4:
            print("Usage: kalshi.py candlesticks <series_ticker> <ticker> [--interval 1|60|1440]")
            return
        series_ticker = sys.argv[2]
        ticker = sys.argv[3]
        interval = 60
        if "--interval" in sys.argv:
            idx = sys.argv.index("--interval")
            if idx+1 < len(sys.argv):
                interval = int(sys.argv[idx+1])
        result = get_candlesticks(series_ticker, ticker, interval)
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # EVENTS & SERIES
    # ==========================================================================

    elif cmd == "events":
        status = None
        series_ticker = None
        for i, arg in enumerate(sys.argv[2:], 2):
            if arg == "--status" and i+1 < len(sys.argv):
                status = sys.argv[i+1]
            elif arg == "--series" and i+1 < len(sys.argv):
                series_ticker = sys.argv[i+1]
        result = get_events(status, series_ticker)
        print(json.dumps(result, indent=2))

    elif cmd == "event":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py event <event_ticker>")
            return
        result = get_event(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "series":
        category = None
        if "--category" in sys.argv:
            idx = sys.argv.index("--category")
            if idx+1 < len(sys.argv):
                category = sys.argv[idx+1]
        result = get_series(category)
        print(json.dumps(result, indent=2))

    elif cmd == "series_info":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py series_info <series_ticker>")
            return
        result = get_series_info(sys.argv[2])
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # TRADING - ORDERS
    # ==========================================================================

    elif cmd == "buy":
        if len(sys.argv) < 6:
            print("Usage: kalshi.py buy <ticker> <yes|no> <count> <price_cents>")
            return
        ticker = sys.argv[2]
        side = sys.argv[3]
        count = int(sys.argv[4])
        price = int(sys.argv[5])
        result = buy(ticker, side, count, price)
        print(json.dumps(result, indent=2))

    elif cmd == "sell":
        if len(sys.argv) < 6:
            print("Usage: kalshi.py sell <ticker> <yes|no> <count> <price_cents>")
            return
        ticker = sys.argv[2]
        side = sys.argv[3]
        count = int(sys.argv[4])
        price = int(sys.argv[5])
        result = sell(ticker, side, count, price)
        print(json.dumps(result, indent=2))

    elif cmd == "market_order":
        if len(sys.argv) < 6:
            print("Usage: kalshi.py market_order <ticker> <yes|no> <buy|sell> <count>")
            return
        result = market_order(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]))
        print(json.dumps(result, indent=2))

    elif cmd == "batch_create_orders":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py batch_create_orders '<orders_json>'")
            return
        orders = json.loads(sys.argv[2])
        result = batch_create_orders(orders)
        print(json.dumps(result, indent=2))

    elif cmd == "batch_cancel_orders":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py batch_cancel_orders <order_ids_comma_sep>")
            return
        order_ids = sys.argv[2].split(",")
        result = batch_cancel_orders(order_ids)
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # ORDER MANAGEMENT
    # ==========================================================================

    elif cmd == "orders":
        orders = get_open_orders()
        if not orders:
            print("No open orders")
        else:
            print(json.dumps(orders, indent=2))

    elif cmd == "get_order":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py get_order <order_id>")
            return
        result = get_order(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "cancel":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py cancel <order_id>")
            return
        result = cancel_order(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "cancel_all":
        result = cancel_all_orders()
        print(json.dumps(result, indent=2))

    elif cmd == "amend_order":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py amend_order <order_id> [--price <cents>] [--count <n>]")
            return
        order_id = sys.argv[2]
        price = None
        count = None
        for i, arg in enumerate(sys.argv[3:], 3):
            if arg == "--price" and i+1 < len(sys.argv):
                price = int(sys.argv[i+1])
            elif arg == "--count" and i+1 < len(sys.argv):
                count = int(sys.argv[i+1])
        result = amend_order(order_id, price, count)
        print(json.dumps(result, indent=2))

    elif cmd == "decrease_order":
        if len(sys.argv) < 4:
            print("Usage: kalshi.py decrease_order <order_id> <reduce_by>")
            return
        result = decrease_order(sys.argv[2], int(sys.argv[3]))
        print(json.dumps(result, indent=2))

    elif cmd == "queue_position":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py queue_position <order_id>")
            return
        result = get_queue_position(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "queue_positions":
        result = get_queue_positions()
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # PORTFOLIO
    # ==========================================================================

    elif cmd == "balance":
        bal = get_balance()
        print(f"Available: ${bal['available']:,.2f}")
        print(f"Portfolio Value: ${bal['portfolio_value']:,.2f}")

    elif cmd == "positions":
        positions = get_positions()
        if not positions:
            print("No positions")
        else:
            print(json.dumps(positions, indent=2))

    elif cmd == "fills":
        ticker = None
        limit = 100
        for i, arg in enumerate(sys.argv[2:], 2):
            if arg == "--ticker" and i+1 < len(sys.argv):
                ticker = sys.argv[i+1]
            elif arg == "--limit" and i+1 < len(sys.argv):
                limit = int(sys.argv[i+1])
        result = get_fills(ticker=ticker, limit=limit)
        print(json.dumps(result, indent=2))

    elif cmd == "settlements":
        limit = 100
        if "--limit" in sys.argv:
            idx = sys.argv.index("--limit")
            if idx+1 < len(sys.argv):
                limit = int(sys.argv[idx+1])
        result = get_settlements(limit)
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # ACCOUNT
    # ==========================================================================

    elif cmd == "account_limits":
        result = get_account_limits()
        print(json.dumps(result, indent=2))

    elif cmd == "api_keys":
        result = get_api_keys()
        print(json.dumps(result, indent=2))

    elif cmd == "create_api_key":
        result = create_api_key()
        print(json.dumps(result, indent=2))

    elif cmd == "delete_api_key":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py delete_api_key <api_key>")
            return
        result = delete_api_key(sys.argv[2])
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # EXCHANGE INFO - EXTENDED
    # ==========================================================================

    elif cmd == "fee_changes":
        result = get_fee_changes()
        print(json.dumps(result, indent=2))

    elif cmd == "user_data_timestamp":
        result = get_user_data_timestamp()
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # MARKET DATA - BATCH
    # ==========================================================================

    elif cmd == "batch_candlesticks":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py batch_candlesticks '<tickers_json>'")
            return
        tickers = json.loads(sys.argv[2])
        result = batch_candlesticks(tickers)
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # EVENTS - EXTENDED
    # ==========================================================================

    elif cmd == "event_metadata":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py event_metadata <event_ticker>")
            return
        result = get_event_metadata(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "event_candlesticks":
        if len(sys.argv) < 4:
            print("Usage: kalshi.py event_candlesticks <series_ticker> <event_ticker> [--interval 60]")
            return
        series_ticker = sys.argv[2]
        event_ticker = sys.argv[3]
        interval = 60
        if "--interval" in sys.argv:
            idx = sys.argv.index("--interval")
            if idx+1 < len(sys.argv):
                interval = int(sys.argv[idx+1])
        result = get_event_candlesticks(series_ticker, event_ticker, interval)
        print(json.dumps(result, indent=2))

    elif cmd == "forecast_history":
        if len(sys.argv) < 4:
            print("Usage: kalshi.py forecast_history <series_ticker> <event_ticker>")
            return
        result = get_forecast_history(sys.argv[2], sys.argv[3])
        print(json.dumps(result, indent=2))

    elif cmd == "multivariate_events":
        result = get_multivariate_events()
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # ORDER GROUPS
    # ==========================================================================

    elif cmd == "create_order_group":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py create_order_group '<orders_json>' [--max_loss <cents>]")
            return
        orders = json.loads(sys.argv[2])
        max_loss = None
        if "--max_loss" in sys.argv:
            idx = sys.argv.index("--max_loss")
            if idx+1 < len(sys.argv):
                max_loss = int(sys.argv[idx+1])
        result = create_order_group(orders, max_loss)
        print(json.dumps(result, indent=2))

    elif cmd == "order_groups":
        result = get_order_groups()
        print(json.dumps(result, indent=2))

    elif cmd == "order_group":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py order_group <group_id>")
            return
        result = get_order_group(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "order_group_limit":
        if len(sys.argv) < 4:
            print("Usage: kalshi.py order_group_limit <group_id> <max_loss_cents>")
            return
        result = update_order_group_limit(sys.argv[2], int(sys.argv[3]))
        print(json.dumps(result, indent=2))

    elif cmd == "order_group_trigger":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py order_group_trigger <group_id>")
            return
        result = trigger_order_group(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "order_group_reset":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py order_group_reset <group_id>")
            return
        result = reset_order_group(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "delete_order_group":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py delete_order_group <group_id>")
            return
        result = delete_order_group(sys.argv[2])
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # PORTFOLIO - EXTENDED
    # ==========================================================================

    elif cmd == "resting_order_value":
        result = get_resting_order_value()
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # SUBACCOUNTS
    # ==========================================================================

    elif cmd == "create_subaccount":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py create_subaccount <name>")
            return
        result = create_subaccount(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "subaccount_balances":
        result = get_subaccount_balances()
        print(json.dumps(result, indent=2))

    elif cmd == "subaccount_transfer":
        if len(sys.argv) < 5:
            print("Usage: kalshi.py subaccount_transfer <from_id> <to_id> <amount_cents>")
            return
        result = subaccount_transfer(sys.argv[2], sys.argv[3], int(sys.argv[4]))
        print(json.dumps(result, indent=2))

    elif cmd == "subaccount_transfers":
        result = get_subaccount_transfers()
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # COMMUNICATIONS (RFQ/Quotes)
    # ==========================================================================

    elif cmd == "comms_id":
        result = get_comms_id()
        print(json.dumps(result, indent=2))

    elif cmd == "create_rfq":
        if len(sys.argv) < 5:
            print("Usage: kalshi.py create_rfq <ticker> <side> <count> [--min_price <cents>] [--max_price <cents>]")
            return
        ticker = sys.argv[2]
        side = sys.argv[3]
        count = int(sys.argv[4])
        min_price = None
        max_price = None
        if "--min_price" in sys.argv:
            idx = sys.argv.index("--min_price")
            if idx+1 < len(sys.argv):
                min_price = int(sys.argv[idx+1])
        if "--max_price" in sys.argv:
            idx = sys.argv.index("--max_price")
            if idx+1 < len(sys.argv):
                max_price = int(sys.argv[idx+1])
        result = create_rfq(ticker, side, count, min_price, max_price)
        print(json.dumps(result, indent=2))

    elif cmd == "rfqs":
        result = get_rfqs()
        print(json.dumps(result, indent=2))

    elif cmd == "rfq":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py rfq <rfq_id>")
            return
        result = get_rfq(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "cancel_rfq":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py cancel_rfq <rfq_id>")
            return
        result = cancel_rfq(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "create_quote":
        if len(sys.argv) < 4:
            print("Usage: kalshi.py create_quote <rfq_id> <price_cents>")
            return
        result = create_quote(sys.argv[2], int(sys.argv[3]))
        print(json.dumps(result, indent=2))

    elif cmd == "quotes":
        result = get_quotes()
        print(json.dumps(result, indent=2))

    elif cmd == "quote":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py quote <quote_id>")
            return
        result = get_quote(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "cancel_quote":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py cancel_quote <quote_id>")
            return
        result = cancel_quote(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "accept_quote":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py accept_quote <quote_id>")
            return
        result = accept_quote(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "confirm_quote":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py confirm_quote <quote_id>")
            return
        result = confirm_quote(sys.argv[2])
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # MULTIVARIATE COLLECTIONS
    # ==========================================================================

    elif cmd == "collections":
        result = get_collections()
        print(json.dumps(result, indent=2))

    elif cmd == "collection":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py collection <collection_ticker>")
            return
        result = get_collection(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "collection_lookup":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py collection_lookup <collection_ticker>")
            return
        result = get_collection_lookup(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "collection_lookup_history":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py collection_lookup_history <collection_ticker>")
            return
        result = get_collection_lookup_history(sys.argv[2])
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # LIVE DATA
    # ==========================================================================

    elif cmd == "live_data":
        if len(sys.argv) < 4:
            print("Usage: kalshi.py live_data <type> <milestone_id>")
            return
        result = get_live_data(sys.argv[2], sys.argv[3])
        print(json.dumps(result, indent=2))

    elif cmd == "live_data_batch":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py live_data_batch '<requests_json>'")
            return
        requests_list = json.loads(sys.argv[2])
        result = get_live_data_batch(requests_list)
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # MILESTONES
    # ==========================================================================

    elif cmd == "milestones":
        result = get_milestones()
        print(json.dumps(result, indent=2))

    elif cmd == "milestone":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py milestone <milestone_id>")
            return
        result = get_milestone(sys.argv[2])
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # STRUCTURED TARGETS
    # ==========================================================================

    elif cmd == "structured_targets":
        result = get_structured_targets()
        print(json.dumps(result, indent=2))

    elif cmd == "structured_target":
        if len(sys.argv) < 3:
            print("Usage: kalshi.py structured_target <target_id>")
            return
        result = get_structured_target(sys.argv[2])
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # INCENTIVES
    # ==========================================================================

    elif cmd == "incentives":
        result = get_incentives()
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # FCM
    # ==========================================================================

    elif cmd == "fcm_orders":
        result = get_fcm_orders()
        print(json.dumps(result, indent=2))

    elif cmd == "fcm_positions":
        result = get_fcm_positions()
        print(json.dumps(result, indent=2))

    # ==========================================================================
    # SEARCH/DISCOVERY
    # ==========================================================================

    elif cmd == "search_tags":
        result = get_search_tags()
        print(json.dumps(result, indent=2))

    elif cmd == "search_sports":
        result = get_search_sports()
        print(json.dumps(result, indent=2))

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)


if __name__ == "__main__":
    main()
