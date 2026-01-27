#!/usr/bin/env python3
"""
Polymarket Trading Module - COMPLETE API IMPLEMENTATION
All CLOB (trading) + Gamma (market data) + Data (portfolio/analytics) APIs.
90+ methods for full API coverage.

Usage:
    # Search & Info
    python polymarket.py search "bitcoin"
    python polymarket.py orderbook <token_id>
    python polymarket.py midpoint <token_id>
    python polymarket.py spread <token_id>
    python polymarket.py price <token_id> [side]
    python polymarket.py last_trade <token_id>
    python polymarket.py tick_size <token_id>
    python polymarket.py fee_rate <token_id>
    python polymarket.py neg_risk <token_id>

    # Batch Operations
    python polymarket.py midpoints_batch <token_ids_comma_sep>
    python polymarket.py prices_batch <token_ids_comma_sep>
    python polymarket.py spreads_batch <token_ids_comma_sep>
    python polymarket.py orderbooks_batch <token_ids_comma_sep>
    python polymarket.py last_trades_batch <token_ids_comma_sep>

    # Market Discovery
    python polymarket.py markets [next_cursor]
    python polymarket.py simplified_markets [next_cursor]
    python polymarket.py sampling_markets [next_cursor]
    python polymarket.py market_trades_events <condition_id>
    python polymarket.py market_info <condition_id>
    python polymarket.py market_by_slug <slug>

    # Trading - Limit Orders (GTC)
    python polymarket.py buy <token_id> <price> <size>
    python polymarket.py sell <token_id> <size> [price]

    # Trading - Market Orders (FOK)
    python polymarket.py market_buy <token_id> <usdc_amount>
    python polymarket.py market_sell <token_id> [size]

    # Trading - Maker Orders (POST_ONLY - avoid fees, earn rebates)
    python polymarket.py maker_buy <token_id> <price> <size>
    python polymarket.py maker_sell <token_id> <price> <size>

    # Account Info
    python polymarket.py positions
    python polymarket.py balance
    python polymarket.py orders
    python polymarket.py get_order <order_id>
    python polymarket.py trades [--market <id>] [--token <id>]

    # Order Management
    python polymarket.py cancel <order_id>
    python polymarket.py cancel_all
    python polymarket.py cancel_market <market_id> [token_id]
    python polymarket.py post_orders_batch <orders_json>
    python polymarket.py cancel_orders_batch <order_ids_comma_sep>

    # API Key Management
    python polymarket.py create_api_key
    python polymarket.py derive_api_key [nonce]
    python polymarket.py get_api_keys
    python polymarket.py delete_api_key

    # Read-Only API Keys
    python polymarket.py create_readonly_api_key
    python polymarket.py get_readonly_api_keys
    python polymarket.py delete_readonly_api_key <api_key>
    python polymarket.py validate_readonly_api_key <api_key>

    # Balance & Allowance
    python polymarket.py get_balance_allowance [COLLATERAL|CONDITIONAL] [token_id]
    python polymarket.py update_balance_allowance

    # Orderbook Hash (for efficient change detection)
    python polymarket.py orderbook_hash <token_id>

    # Sampling/Featured Markets (simplified format)
    python polymarket.py sampling_simplified_markets [next_cursor]

    # Advanced Features
    python polymarket.py heartbeat [heartbeat_id]
    python polymarket.py is_order_scoring <order_id>
    python polymarket.py are_orders_scoring <order_ids_comma_sep>
    python polymarket.py notifications
    python polymarket.py drop_notifications

    # Health & Config
    python polymarket.py health
    python polymarket.py server_time
    python polymarket.py get_address
    python polymarket.py collateral_address
    python polymarket.py conditional_address
    python polymarket.py exchange_address

    # Analysis
    python polymarket.py estimate_fill <token_id> <BUY|SELL> <amount>

    # =========================================================================
    # GAMMA API - Events & Markets (read-only market data)
    # =========================================================================
    python polymarket.py event <event_id>
    python polymarket.py event_by_slug <slug>
    python polymarket.py events [limit] [offset]
    python polymarket.py search_events <query>
    python polymarket.py event_tags <event_id>

    # Series
    python polymarket.py series [series_id]
    python polymarket.py series_list [limit]

    # Tags
    python polymarket.py tags [limit]
    python polymarket.py tag <tag_id>
    python polymarket.py tag_by_slug <slug>
    python polymarket.py tag_relations <tag_id>

    # Sports
    python polymarket.py sports
    python polymarket.py teams [sport]

    # Comments
    python polymarket.py comments <market_id>
    python polymarket.py user_comments <address>

    # =========================================================================
    # DATA API - Portfolio & Analytics
    # =========================================================================
    python polymarket.py positions_value [address]
    python polymarket.py closed_positions [address]
    python polymarket.py pnl_timeseries [address] [interval]
    python polymarket.py overall_pnl [address]
    python polymarket.py user_rank [address]
    python polymarket.py leaderboard [limit]
    python polymarket.py top_holders <market_id>
    python polymarket.py user_activity [address]
    python polymarket.py open_interest <market_id>
    python polymarket.py live_volume [event_id]
    python polymarket.py price_history <token_id> [interval]

    # =========================================================================
    # REWARDS API
    # =========================================================================
    python polymarket.py daily_rewards
    python polymarket.py market_rewards <market_id>
    python polymarket.py reward_markets
"""

import os
import sys
import json
import requests
from decimal import Decimal
from typing import Optional, List, Dict, Any

# Load from environment or use defaults for dev
PRIVATE_KEY = os.getenv("PRIVATE_KEY", os.getenv("POLY_PRIVATE_KEY"))
FUNDER_ADDRESS = os.getenv("POLY_FUNDER_ADDRESS")
API_KEY = os.getenv("POLY_API_KEY")
API_SECRET = os.getenv("POLY_API_SECRET")
API_PASSPHRASE = os.getenv("POLY_API_PASSPHRASE")

# Contract addresses
CTF_CONTRACT = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"  # Conditional Token Framework
USDC_CONTRACT = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"  # USDC on Polygon

# API URLs
CLOB_URL = "https://clob.polymarket.com"
GAMMA_URL = "https://gamma-api.polymarket.com"
RPC_URL = "https://polygon-rpc.com/"


def get_client():
    """Initialize py_clob_client with credentials"""
    try:
        from py_clob_client.client import ClobClient
        from py_clob_client.clob_types import ApiCreds

        if not all([PRIVATE_KEY, FUNDER_ADDRESS, API_KEY, API_SECRET, API_PASSPHRASE]):
            print("ERROR: Missing Polymarket credentials. Set environment variables:")
            print("  PRIVATE_KEY, POLY_FUNDER_ADDRESS, POLY_API_KEY, POLY_API_SECRET, POLY_API_PASSPHRASE")
            return None

        client = ClobClient(
            CLOB_URL,
            key=PRIVATE_KEY,
            chain_id=137,  # Polygon mainnet
            funder=FUNDER_ADDRESS,
            signature_type=2  # POLY_GNOSIS_SAFE
        )

        client.set_api_creds(ApiCreds(
            api_key=API_KEY,
            api_secret=API_SECRET,
            api_passphrase=API_PASSPHRASE
        ))

        return client
    except ImportError:
        print("ERROR: py_clob_client not installed. Run: pip install py-clob-client")
        return None


def search_markets(query: str, limit: int = 10) -> List[Dict]:
    """Search for markets by keyword"""
    url = f"{GAMMA_URL}/markets"
    params = {
        "_q": query,
        "active": "true",
        "closed": "false",
        "_limit": limit
    }

    r = requests.get(url, params=params)
    if r.status_code != 200:
        print(f"ERROR: Search failed: {r.status_code}")
        return []

    markets = r.json()
    results = []

    for m in markets:
        tokens = m.get("tokens", [])
        result = {
            "condition_id": m.get("condition_id"),
            "question": m.get("question"),
            "slug": m.get("slug"),
            "volume": float(m.get("volume", 0)),
            "liquidity": float(m.get("liquidity", 0)),
            "outcomes": []
        }

        for t in tokens:
            result["outcomes"].append({
                "token_id": t.get("token_id"),
                "outcome": t.get("outcome"),
                "price": float(t.get("price", 0))
            })

        results.append(result)

    return results


def get_orderbook(token_id: str) -> Dict:
    """Get orderbook for a token"""
    url = f"{CLOB_URL}/book"
    params = {"token_id": token_id}

    r = requests.get(url, params=params)
    if r.status_code != 200:
        print(f"ERROR: Orderbook fetch failed: {r.status_code}")
        return {}

    book = r.json()
    bids = book.get("bids", [])
    asks = book.get("asks", [])

    best_bid = float(bids[0]["price"]) if bids else 0
    best_ask = float(asks[0]["price"]) if asks else 1
    spread = best_ask - best_bid

    return {
        "best_bid": best_bid,
        "best_ask": best_ask,
        "spread": spread,
        "bid_depth": sum(float(b["size"]) for b in bids[:5]),
        "ask_depth": sum(float(a["size"]) for a in asks[:5]),
        "bids": bids[:10],
        "asks": asks[:10]
    }


def get_token_balance(token_id: str, wallet: str = None) -> float:
    """Get balance of a specific token via on-chain RPC call"""
    wallet = wallet or FUNDER_ADDRESS
    if not wallet:
        print("ERROR: No wallet address")
        return 0

    token_int = int(token_id)
    # ERC-1155 balanceOf(address,uint256)
    data = f"0x00fdd58e000000000000000000000000{wallet[2:].lower()}{token_int:064x}"

    payload = {
        "jsonrpc": "2.0",
        "method": "eth_call",
        "params": [{"to": CTF_CONTRACT, "data": data}, "latest"],
        "id": 1
    }

    r = requests.post(RPC_URL, json=payload)
    result = r.json().get("result", "0x0")
    balance = int(result, 16) / 1e6  # Convert from raw to shares

    return balance


def get_usdc_balance(wallet: str = None) -> float:
    """Get USDC balance"""
    wallet = wallet or FUNDER_ADDRESS
    if not wallet:
        return 0

    # ERC-20 balanceOf(address)
    data = f"0x70a08231000000000000000000000000{wallet[2:].lower()}"

    payload = {
        "jsonrpc": "2.0",
        "method": "eth_call",
        "params": [{"to": USDC_CONTRACT, "data": data}, "latest"],
        "id": 1
    }

    r = requests.post(RPC_URL, json=payload)
    result = r.json().get("result", "0x0")
    balance = int(result, 16) / 1e6  # USDC has 6 decimals

    return balance


def get_positions(token_ids: List[str] = None) -> List[Dict]:
    """Get positions for given tokens or fetch from Gamma API"""
    if not FUNDER_ADDRESS:
        print("ERROR: No wallet address set")
        return []

    # If specific tokens provided, check those
    if token_ids:
        positions = []
        for tid in token_ids:
            balance = get_token_balance(tid)
            if balance > 0:
                positions.append({
                    "token_id": tid,
                    "balance": balance
                })
        return positions

    # Otherwise use Gamma API
    url = f"{GAMMA_URL}/positions"
    params = {"user": FUNDER_ADDRESS.lower()}

    r = requests.get(url, params=params)
    if r.status_code != 200:
        print(f"ERROR: Positions fetch failed: {r.status_code}")
        return []

    positions = r.json()
    return [{
        "token_id": p.get("tokenId"),
        "condition_id": p.get("conditionId"),
        "outcome": p.get("outcome"),
        "title": p.get("title"),
        "size": float(p.get("size", 0)),
        "avg_price": float(p.get("avgPrice", 0)),
        "current_price": float(p.get("currentPrice", 0)),
        "pnl": float(p.get("pnl", 0)),
        "value": float(p.get("value", 0))
    } for p in positions]


def place_order(token_id: str, side: str, price: float, size: float) -> Dict:
    """
    Place an order on Polymarket

    Args:
        token_id: The outcome token ID
        side: "BUY" or "SELL"
        price: Price between 0.01 and 0.99
        size: Number of shares

    Returns:
        Order result dict
    """
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}

    try:
        from py_clob_client.clob_types import OrderArgs

        # Validate inputs
        if price < 0.01 or price > 0.99:
            return {"success": False, "error": "Price must be between 0.01 and 0.99"}

        if size < 0.01:
            return {"success": False, "error": "Size must be at least 0.01"}

        result = client.create_and_post_order(OrderArgs(
            token_id=token_id,
            price=price,
            size=size,
            side=side.upper()
        ))

        return {
            "success": True,
            "order_id": result.get("orderID") or result.get("order_id"),
            "result": result
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


def buy(token_id: str, price: float, size: float) -> Dict:
    """Place a BUY order"""
    return place_order(token_id, "BUY", price, size)


def sell(token_id: str, price: float, size: float) -> Dict:
    """Place a SELL order"""
    return place_order(token_id, "SELL", price, size)


def market_sell(token_id: str, size: float = None) -> Dict:
    """
    Market sell - sells at 0.01 for immediate fill
    If size not specified, sells entire position
    """
    if size is None:
        size = get_token_balance(token_id)
        if size <= 0:
            return {"success": False, "error": "No position to sell"}

    return sell(token_id, 0.01, size)


def market_buy(token_id: str, amount: float) -> Dict:
    """
    Market buy - spend a specific USDC amount at current ask price.
    Uses FOK (fill or kill) for immediate execution.

    Args:
        token_id: The outcome token ID
        amount: USDC amount to spend (e.g., 50 for $50)

    Returns:
        Order result dict
    """
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}

    try:
        from py_clob_client.clob_types import MarketOrderArgs, OrderType

        # Get current ask to calculate expected shares
        book = get_orderbook(token_id)
        best_ask = book.get('best_ask', 0.99)
        expected_shares = amount / best_ask if best_ask > 0 else 0

        # Create and post market order with FOK
        signed = client.create_market_order(MarketOrderArgs(
            token_id=token_id,
            amount=amount,
            side="BUY"
        ))
        result = client.post_order(signed, orderType=OrderType.FOK)

        return {
            "success": True,
            "amount_spent": amount,
            "expected_shares": round(expected_shares, 2),
            "ask_price": best_ask,
            "result": result
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


def maker_buy(token_id: str, price: float, size: float) -> Dict:
    """
    POST-ONLY maker buy - places order that MUST add liquidity.
    If order would cross spread, it gets REJECTED instead of taking.
    Use this to avoid taker fees (1-1.5% on 15-min crypto) and earn rebates.

    Args:
        token_id: The outcome token ID
        price: Price (0.01-0.99). Must be BELOW current ask to be maker.
        size: Number of shares

    Returns:
        Order result dict
    """
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}

    try:
        from py_clob_client.clob_types import OrderArgs, OrderType

        # Validate inputs
        if price < 0.01 or price > 0.99:
            return {"success": False, "error": "Price must be between 0.01 and 0.99"}

        if size < 0.01:
            return {"success": False, "error": "Size must be at least 0.01"}

        # Check current orderbook to warn if price would cross
        book = get_orderbook(token_id)
        best_ask = book.get('best_ask', 1)
        if price >= best_ask:
            return {
                "success": False,
                "error": f"Price {price} >= best ask {best_ask}. POST_ONLY order would be rejected. Use a lower price to be maker."
            }

        # Create order
        signed = client.create_order(OrderArgs(
            token_id=token_id,
            price=price,
            size=size,
            side="BUY"
        ))

        # Post with POST_ONLY flag
        result = client.post_order(signed, orderType=OrderType.GTC, post_only=True)

        return {
            "success": True,
            "type": "POST_ONLY_MAKER",
            "side": "BUY",
            "price": price,
            "size": size,
            "order_id": result.get("orderID") or result.get("order_id"),
            "message": "Order placed as maker. You pay 0 fees and earn rebates when filled.",
            "result": result
        }

    except Exception as e:
        error_msg = str(e)
        if "would cross" in error_msg.lower() or "rejected" in error_msg.lower():
            return {"success": False, "error": f"Order would cross spread - use a lower price to be maker. {error_msg}"}
        return {"success": False, "error": error_msg}


def maker_sell(token_id: str, price: float, size: float) -> Dict:
    """
    POST-ONLY maker sell - places order that MUST add liquidity.
    If order would cross spread, it gets REJECTED instead of taking.
    Use this to avoid taker fees (1-1.5% on 15-min crypto) and earn rebates.

    Args:
        token_id: The outcome token ID
        price: Price (0.01-0.99). Must be ABOVE current bid to be maker.
        size: Number of shares

    Returns:
        Order result dict
    """
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}

    try:
        from py_clob_client.clob_types import OrderArgs, OrderType

        # Validate inputs
        if price < 0.01 or price > 0.99:
            return {"success": False, "error": "Price must be between 0.01 and 0.99"}

        if size < 0.01:
            return {"success": False, "error": "Size must be at least 0.01"}

        # Check current orderbook to warn if price would cross
        book = get_orderbook(token_id)
        best_bid = book.get('best_bid', 0)
        if price <= best_bid:
            return {
                "success": False,
                "error": f"Price {price} <= best bid {best_bid}. POST_ONLY order would be rejected. Use a higher price to be maker."
            }

        # Create order
        signed = client.create_order(OrderArgs(
            token_id=token_id,
            price=price,
            size=size,
            side="SELL"
        ))

        # Post with POST_ONLY flag
        result = client.post_order(signed, orderType=OrderType.GTC, post_only=True)

        return {
            "success": True,
            "type": "POST_ONLY_MAKER",
            "side": "SELL",
            "price": price,
            "size": size,
            "order_id": result.get("orderID") or result.get("order_id"),
            "message": "Order placed as maker. You pay 0 fees and earn rebates when filled.",
            "result": result
        }

    except Exception as e:
        error_msg = str(e)
        if "would cross" in error_msg.lower() or "rejected" in error_msg.lower():
            return {"success": False, "error": f"Order would cross spread - use a higher price to be maker. {error_msg}"}
        return {"success": False, "error": error_msg}


def cancel_order(order_id: str) -> Dict:
    """Cancel a specific order"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}

    try:
        result = client.cancel(order_id)
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def cancel_all_orders() -> Dict:
    """Cancel all open orders"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}

    try:
        result = client.cancel_all()
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_open_orders() -> List[Dict]:
    """Get all open orders"""
    client = get_client()
    if not client:
        return []

    try:
        orders = client.get_orders()
        return orders if orders else []
    except Exception as e:
        print(f"ERROR: {e}")
        return []


def get_trades(market_id: str = None, token_id: str = None) -> List[Dict]:
    """Get trade history for your account"""
    client = get_client()
    if not client:
        return []

    try:
        from py_clob_client.clob_types import TradeParams

        params = TradeParams()
        if market_id:
            params.market = market_id
        if token_id:
            params.asset_id = token_id

        trades = client.get_trades(params=params)
        return trades if trades else []
    except Exception as e:
        print(f"ERROR: {e}")
        return []


def cancel_market_orders(market_id: str, token_id: str = None) -> Dict:
    """Cancel all orders for a specific market or token"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}

    try:
        result = client.cancel_market_orders(market=market_id, asset_id=token_id)
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def estimate_fill(token_id: str, side: str, amount: float) -> Dict:
    """
    Estimate fill price for a market order before executing.
    Shows expected slippage based on current orderbook.

    Args:
        token_id: Token ID
        side: "BUY" or "SELL"
        amount: USDC amount for BUY, shares for SELL

    Returns:
        Estimated fill price and details
    """
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}

    try:
        from py_clob_client.clob_types import OrderType

        # Get current orderbook for comparison
        book = get_orderbook(token_id)
        best_bid = book.get('best_bid', 0)
        best_ask = book.get('best_ask', 1)
        midpoint = (best_bid + best_ask) / 2 if best_bid and best_ask else 0.5

        # Calculate expected fill price using the API
        estimated_price = client.calculate_market_price(
            token_id=token_id,
            side=side.upper(),
            amount=amount,
            order_type=OrderType.FOK
        )

        # Calculate slippage
        if side.upper() == "BUY":
            slippage = ((estimated_price - best_ask) / best_ask * 100) if best_ask else 0
            expected_shares = amount / estimated_price if estimated_price else 0
        else:
            slippage = ((best_bid - estimated_price) / best_bid * 100) if best_bid else 0
            expected_shares = amount  # For sell, amount is shares

        return {
            "success": True,
            "token_id": token_id,
            "side": side.upper(),
            "amount": amount,
            "estimated_fill_price": round(estimated_price, 4),
            "best_bid": best_bid,
            "best_ask": best_ask,
            "midpoint": round(midpoint, 4),
            "estimated_slippage_pct": round(slippage, 3),
            "expected_shares": round(expected_shares, 2) if side.upper() == "BUY" else None,
            "message": f"Expected fill at {estimated_price:.4f} ({slippage:+.2f}% slippage from {'ask' if side.upper() == 'BUY' else 'bid'})"
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# MARKET DATA - SINGLE TOKEN
# =============================================================================

def get_midpoint(token_id: str) -> Dict:
    """Get midpoint price for a token"""
    url = f"{CLOB_URL}/midpoint"
    params = {"token_id": token_id}
    try:
        r = requests.get(url, params=params)
        if r.status_code == 200:
            data = r.json()
            return {"success": True, "token_id": token_id, "midpoint": float(data.get("mid", 0))}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_spread(token_id: str) -> Dict:
    """Get bid-ask spread for a token"""
    url = f"{CLOB_URL}/spread"
    params = {"token_id": token_id}
    try:
        r = requests.get(url, params=params)
        if r.status_code == 200:
            data = r.json()
            return {
                "success": True,
                "token_id": token_id,
                "bid": float(data.get("bid", 0)),
                "ask": float(data.get("ask", 1)),
                "spread": float(data.get("spread", 0))
            }
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_order_book_hash(token_id: str) -> Dict:
    """Get hash of an orderbook (for detecting changes efficiently)"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_order_book_hash(token_id)
        return {"success": True, "token_id": token_id, "hash": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_price(token_id: str, side: str = None) -> Dict:
    """Get price for a token (optionally for specific side)"""
    url = f"{CLOB_URL}/price"
    params = {"token_id": token_id}
    if side:
        params["side"] = side.upper()
    try:
        r = requests.get(url, params=params)
        if r.status_code == 200:
            data = r.json()
            return {"success": True, "token_id": token_id, "price": float(data.get("price", 0))}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_last_trade(token_id: str) -> Dict:
    """Get last trade for a token"""
    url = f"{CLOB_URL}/last-trade-price"
    params = {"token_id": token_id}
    try:
        r = requests.get(url, params=params)
        if r.status_code == 200:
            data = r.json()
            return {"success": True, "token_id": token_id, "price": float(data.get("price", 0))}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_tick_size(token_id: str) -> Dict:
    """Get tick size for a token"""
    url = f"{CLOB_URL}/tick-size"
    params = {"token_id": token_id}
    try:
        r = requests.get(url, params=params)
        if r.status_code == 200:
            data = r.json()
            return {"success": True, "token_id": token_id, "tick_size": float(data.get("minimum_tick_size", 0.01))}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_fee_rate(token_id: str) -> Dict:
    """Get fee rate for a token (0 for regular markets, 10% for 15-min crypto)"""
    url = f"{CLOB_URL}/fee-rate"
    params = {"token_id": token_id}
    try:
        r = requests.get(url, params=params)
        if r.status_code == 200:
            data = r.json()
            fee_bps = data.get("fee_rate_bps", data.get("base_fee", 0))
            return {
                "success": True,
                "token_id": token_id,
                "fee_rate_bps": fee_bps,
                "fee_rate_pct": fee_bps / 100 if fee_bps else 0,
                "has_fees": fee_bps > 0
            }
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_neg_risk(token_id: str) -> Dict:
    """Check if token is negative risk (crypto 15-min markets)"""
    url = f"{CLOB_URL}/neg-risk"
    params = {"token_id": token_id}
    try:
        r = requests.get(url, params=params)
        if r.status_code == 200:
            data = r.json()
            return {"success": True, "token_id": token_id, "neg_risk": data.get("neg_risk", False)}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# MARKET DATA - BATCH OPERATIONS
# =============================================================================

def get_midpoints_batch(token_ids: List[str]) -> Dict:
    """Get midpoints for multiple tokens"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_midpoints(token_ids)
        return {"success": True, "midpoints": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_prices_batch(token_ids: List[str]) -> Dict:
    """Get prices for multiple tokens"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_prices(token_ids)
        return {"success": True, "prices": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_spreads_batch(token_ids: List[str]) -> Dict:
    """Get spreads for multiple tokens"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_spreads(token_ids)
        return {"success": True, "spreads": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_orderbooks_batch(token_ids: List[str]) -> Dict:
    """Get orderbooks for multiple tokens"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_order_books(token_ids)
        return {"success": True, "orderbooks": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_last_trades_batch(token_ids: List[str]) -> Dict:
    """Get last trade prices for multiple tokens"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_last_trade_prices(token_ids)
        return {"success": True, "last_trades": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# MARKET DISCOVERY
# =============================================================================

def get_markets(next_cursor: str = None) -> Dict:
    """Get paginated list of all markets"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_markets(next_cursor=next_cursor)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_simplified_markets(next_cursor: str = None) -> Dict:
    """Get paginated list of simplified markets"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_simplified_markets(next_cursor=next_cursor)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_sampling_markets(next_cursor: str = None) -> Dict:
    """Get paginated list of sampling markets"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_sampling_markets(next_cursor=next_cursor)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_sampling_simplified_markets(next_cursor: str = None) -> Dict:
    """Get paginated list of sampling (featured) markets in simplified format"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_sampling_simplified_markets(next_cursor=next_cursor)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_market_trades_events(condition_id: str) -> Dict:
    """Get trades and events for a market"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_market_trades_events(condition_id=condition_id)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_market_info(condition_id: str) -> Dict:
    """Get detailed market info"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_market(condition_id=condition_id)
        return {"success": True, "market": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# ORDER OPERATIONS
# =============================================================================

def get_order(order_id: str) -> Dict:
    """Get details of a specific order"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_order(order_id)
        return {"success": True, "order": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def post_orders_batch(orders_json: str) -> Dict:
    """
    Post multiple orders in a single batch.

    Args:
        orders_json: JSON array of order objects, each with:
            - token_id: Token ID
            - side: "BUY" or "SELL"
            - price: Price (0.01-0.99)
            - size: Number of shares

    Returns:
        Batch result dict
    """
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}

    try:
        from py_clob_client.clob_types import OrderArgs

        orders = json.loads(orders_json)
        signed_orders = []

        for o in orders:
            signed = client.create_order(OrderArgs(
                token_id=o['token_id'],
                price=float(o['price']),
                size=float(o['size']),
                side=o['side'].upper()
            ))
            signed_orders.append(signed)

        result = client.post_orders(signed_orders)
        return {"success": True, "result": result}
    except json.JSONDecodeError as e:
        return {"success": False, "error": f"Invalid JSON: {e}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def cancel_orders_batch(order_ids: List[str]) -> Dict:
    """Cancel multiple orders in a single batch"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.cancel_orders(order_ids)
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# API KEY MANAGEMENT
# =============================================================================

def create_api_key() -> Dict:
    """Create a new API key"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.create_api_key()
        return {"success": True, "api_key": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def derive_api_key(nonce: int = None) -> Dict:
    """Derive API key from private key (optionally with specific nonce)"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        if nonce is not None:
            result = client.derive_api_key(nonce=nonce)
        else:
            result = client.derive_api_key()
        return {"success": True, "api_key": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_api_keys() -> Dict:
    """Get all API keys for this account"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_api_keys()
        return {"success": True, "api_keys": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def delete_api_key() -> Dict:
    """Delete current API key"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.delete_api_key()
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# READ-ONLY API KEYS
# =============================================================================

def create_readonly_api_key() -> Dict:
    """Create a read-only API key (can view but not trade)"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.create_readonly_api_key()
        return {"success": True, "api_key": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_readonly_api_keys() -> Dict:
    """Get all read-only API keys for this account"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_readonly_api_keys()
        return {"success": True, "api_keys": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def delete_readonly_api_key(api_key: str) -> Dict:
    """Delete a read-only API key"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.delete_readonly_api_key(api_key)
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def validate_readonly_api_key(api_key: str) -> Dict:
    """Validate a read-only API key (public endpoint - no credentials needed)"""
    try:
        url = f"{CLOB_URL}/auth/api-key/{api_key}"
        r = requests.get(url)
        if r.status_code == 200:
            return {"success": True, "valid": True, "data": r.json()}
        elif r.status_code == 404:
            return {"success": True, "valid": False}
        else:
            return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# BALANCE & ALLOWANCE
# =============================================================================

def get_balance_allowance(asset_type: str = "COLLATERAL", token_id: str = None) -> Dict:
    """
    Get balance allowance for trading.

    Args:
        asset_type: COLLATERAL (USDC) or CONDITIONAL (tokens)
        token_id: Token ID (required for CONDITIONAL)
    """
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        from py_clob_client.clob_types import AssetType
        at = AssetType.COLLATERAL if asset_type == "COLLATERAL" else AssetType.CONDITIONAL
        if token_id and asset_type == "CONDITIONAL":
            result = client.get_balance_allowance(asset_type=at, token_id=token_id)
        else:
            result = client.get_balance_allowance(asset_type=at)
        return {"success": True, "balance_allowance": result}
    except Exception as e:
        return {"success": False, "error": str(e)}

def update_balance_allowance() -> Dict:
    """Update/refresh balance allowance for trading"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.update_balance_allowance()
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# ADVANCED FEATURES
# =============================================================================

def heartbeat(heartbeat_id: str = None) -> Dict:
    """
    Send heartbeat to keep orders alive.
    If not sent within 10 seconds, all orders are cancelled.

    Args:
        heartbeat_id: Heartbeat ID from previous call (omit for first call)

    Returns:
        New heartbeat_id to use in next call
    """
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        if heartbeat_id:
            result = client.heartbeat(heartbeat_id=heartbeat_id)
        else:
            result = client.start_heartbeat()
        return {"success": True, "heartbeat_id": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def is_order_scoring(order_id: str) -> Dict:
    """Check if an order is eligible for rewards scoring"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.is_order_scoring(order_id)
        return {"success": True, "order_id": order_id, "is_scoring": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def are_orders_scoring(order_ids: List[str]) -> Dict:
    """Check if multiple orders are eligible for rewards scoring"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.are_orders_scoring(order_ids)
        return {"success": True, "scoring_status": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_notifications() -> Dict:
    """Get pending notifications"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_notifications()
        return {"success": True, "notifications": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def drop_notifications() -> Dict:
    """Clear/drop all pending notifications"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.drop_notifications()
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# HEALTH & CONFIG
# =============================================================================

def health_check() -> Dict:
    """Check API health status"""
    try:
        r = requests.get(f"{CLOB_URL}/")
        return {"success": True, "healthy": r.status_code == 200, "status_code": r.status_code}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_server_time() -> Dict:
    """Get server time"""
    client = get_client()
    if not client:
        return {"success": False, "error": "Failed to initialize client"}
    try:
        result = client.get_server_time()
        return {"success": True, "server_time": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_address() -> Dict:
    """Get your wallet address"""
    return {"success": True, "address": FUNDER_ADDRESS}


def get_collateral_address() -> Dict:
    """Get USDC collateral contract address"""
    return {"success": True, "collateral_address": USDC_CONTRACT}


def get_conditional_address() -> Dict:
    """Get CTF (Conditional Token Framework) contract address"""
    return {"success": True, "conditional_address": CTF_CONTRACT}


def get_exchange_address() -> Dict:
    """Get exchange contract addresses"""
    client = get_client()
    if not client:
        # Return known addresses
        return {
            "success": True,
            "ctf_exchange": "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
            "neg_risk_ctf": "0xC5d563A36AE78145C45a50134d48A1215220f80a"
        }
    try:
        # Try to get from client if available
        result = {
            "success": True,
            "ctf_exchange": "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
            "neg_risk_ctf": "0xC5d563A36AE78145C45a50134d48A1215220f80a"
        }
        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# GAMMA API - Events & Markets (read-only market data)
# =============================================================================

DATA_API_URL = "https://data-api.polymarket.com"


def get_event(event_id: str) -> Dict:
    """Get event by ID from Gamma API"""
    try:
        r = requests.get(f"{GAMMA_URL}/events/{event_id}")
        if r.status_code == 200:
            return {"success": True, "event": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_event_by_slug(slug: str) -> Dict:
    """Get event by slug from Gamma API"""
    try:
        r = requests.get(f"{GAMMA_URL}/events/slug/{slug}")
        if r.status_code == 200:
            return {"success": True, "event": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_events(limit: int = 20, offset: int = 0, active: bool = True) -> Dict:
    """Get list of events from Gamma API"""
    try:
        params = {"_limit": limit, "_offset": offset}
        if active:
            params["active"] = "true"
            params["closed"] = "false"
        r = requests.get(f"{GAMMA_URL}/events", params=params)
        if r.status_code == 200:
            return {"success": True, "events": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def search_events(query: str, limit: int = 10) -> Dict:
    """Search events by keyword"""
    try:
        params = {"_q": query, "_limit": limit}
        r = requests.get(f"{GAMMA_URL}/events", params=params)
        if r.status_code == 200:
            return {"success": True, "events": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_event_tags(event_id: str) -> Dict:
    """Get tags for a specific event"""
    try:
        r = requests.get(f"{GAMMA_URL}/events/{event_id}/tags")
        if r.status_code == 200:
            return {"success": True, "tags": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_market_by_slug(slug: str) -> Dict:
    """Get market by slug from Gamma API"""
    try:
        r = requests.get(f"{GAMMA_URL}/markets/slug/{slug}")
        if r.status_code == 200:
            return {"success": True, "market": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_market_tags(market_id: str) -> Dict:
    """Get tags for a specific market"""
    try:
        r = requests.get(f"{GAMMA_URL}/markets/{market_id}/tags")
        if r.status_code == 200:
            return {"success": True, "tags": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# GAMMA API - Series
# =============================================================================

def get_series(series_id: str = None) -> Dict:
    """Get series by ID or list all series"""
    try:
        if series_id:
            r = requests.get(f"{GAMMA_URL}/series/{series_id}")
        else:
            r = requests.get(f"{GAMMA_URL}/series")
        if r.status_code == 200:
            return {"success": True, "series": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_series_list(limit: int = 20) -> Dict:
    """Get list of all series"""
    try:
        r = requests.get(f"{GAMMA_URL}/series", params={"_limit": limit})
        if r.status_code == 200:
            return {"success": True, "series": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# GAMMA API - Tags
# =============================================================================

def get_tags(limit: int = 50) -> Dict:
    """Get list of all tags"""
    try:
        r = requests.get(f"{GAMMA_URL}/tags", params={"_limit": limit})
        if r.status_code == 200:
            return {"success": True, "tags": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_tag(tag_id: str) -> Dict:
    """Get tag by ID"""
    try:
        r = requests.get(f"{GAMMA_URL}/tags/{tag_id}")
        if r.status_code == 200:
            return {"success": True, "tag": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_tag_by_slug(slug: str) -> Dict:
    """Get tag by slug"""
    try:
        r = requests.get(f"{GAMMA_URL}/tags/slug/{slug}")
        if r.status_code == 200:
            return {"success": True, "tag": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_tag_relations(tag_id: str) -> Dict:
    """Get related tags for a tag"""
    try:
        r = requests.get(f"{GAMMA_URL}/tags/{tag_id}/related")
        if r.status_code == 200:
            return {"success": True, "related_tags": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# GAMMA API - Sports
# =============================================================================

def get_sports() -> Dict:
    """Get list of all sports/categories"""
    try:
        r = requests.get(f"{GAMMA_URL}/sports")
        if r.status_code == 200:
            return {"success": True, "sports": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_teams(sport: str = None) -> Dict:
    """Get list of teams, optionally filtered by sport"""
    try:
        params = {}
        if sport:
            params["sport"] = sport
        r = requests.get(f"{GAMMA_URL}/teams", params=params)
        if r.status_code == 200:
            return {"success": True, "teams": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# GAMMA API - Comments
# =============================================================================

def get_comments(market_id: str, limit: int = 20) -> Dict:
    """Get comments for a market"""
    try:
        r = requests.get(f"{GAMMA_URL}/comments", params={"market": market_id, "_limit": limit})
        if r.status_code == 200:
            return {"success": True, "comments": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_user_comments(address: str, limit: int = 20) -> Dict:
    """Get comments by a user"""
    try:
        r = requests.get(f"{GAMMA_URL}/comments", params={"user": address.lower(), "_limit": limit})
        if r.status_code == 200:
            return {"success": True, "comments": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# DATA API - Portfolio & Analytics
# =============================================================================

def get_positions_value(address: str = None) -> Dict:
    """Get total value of positions for an address"""
    address = address or FUNDER_ADDRESS
    if not address:
        return {"success": False, "error": "No address provided"}
    try:
        r = requests.get(f"{DATA_API_URL}/value", params={"user": address.lower()})
        if r.status_code == 200:
            return {"success": True, "value": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_closed_positions(address: str = None, limit: int = 50) -> Dict:
    """Get closed positions for an address"""
    address = address or FUNDER_ADDRESS
    if not address:
        return {"success": False, "error": "No address provided"}
    try:
        r = requests.get(f"{DATA_API_URL}/positions", params={
            "user": address.lower(),
            "closed": "true",
            "_limit": limit
        })
        if r.status_code == 200:
            return {"success": True, "positions": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_pnl_timeseries(address: str = None, interval: str = "1d") -> Dict:
    """
    Get P&L timeseries for an address.

    Args:
        address: Wallet address (defaults to configured address)
        interval: Time interval - 1h, 1d, 1w, 1m
    """
    address = address or FUNDER_ADDRESS
    if not address:
        return {"success": False, "error": "No address provided"}
    try:
        r = requests.get(f"{DATA_API_URL}/pnl", params={
            "user": address.lower(),
            "interval": interval
        })
        if r.status_code == 200:
            return {"success": True, "pnl": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_overall_pnl(address: str = None) -> Dict:
    """Get overall/total P&L for an address"""
    address = address or FUNDER_ADDRESS
    if not address:
        return {"success": False, "error": "No address provided"}
    try:
        r = requests.get(f"{DATA_API_URL}/pnl/total", params={"user": address.lower()})
        if r.status_code == 200:
            return {"success": True, "pnl": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_user_rank(address: str = None) -> Dict:
    """Get leaderboard rank for an address"""
    address = address or FUNDER_ADDRESS
    if not address:
        return {"success": False, "error": "No address provided"}
    try:
        r = requests.get(f"{DATA_API_URL}/rank", params={"user": address.lower()})
        if r.status_code == 200:
            return {"success": True, "rank": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_leaderboard(limit: int = 100) -> Dict:
    """Get top traders leaderboard"""
    try:
        r = requests.get(f"{DATA_API_URL}/leaderboard", params={"_limit": limit})
        if r.status_code == 200:
            return {"success": True, "leaderboard": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_top_holders(market_id: str, limit: int = 50) -> Dict:
    """Get top holders for a market"""
    try:
        r = requests.get(f"{DATA_API_URL}/holders", params={
            "market": market_id,
            "_limit": limit
        })
        if r.status_code == 200:
            return {"success": True, "holders": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_user_activity(address: str = None, limit: int = 50) -> Dict:
    """Get activity feed for an address"""
    address = address or FUNDER_ADDRESS
    if not address:
        return {"success": False, "error": "No address provided"}
    try:
        r = requests.get(f"{DATA_API_URL}/activity", params={
            "user": address.lower(),
            "_limit": limit
        })
        if r.status_code == 200:
            return {"success": True, "activity": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_open_interest(market_id: str) -> Dict:
    """Get open interest for a market"""
    try:
        r = requests.get(f"{DATA_API_URL}/open-interest", params={"market": market_id})
        if r.status_code == 200:
            return {"success": True, "open_interest": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_live_volume(event_id: str = None) -> Dict:
    """Get live trading volume, optionally for a specific event"""
    try:
        params = {}
        if event_id:
            params["event"] = event_id
        r = requests.get(f"{DATA_API_URL}/volume", params=params)
        if r.status_code == 200:
            return {"success": True, "volume": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_price_history(token_id: str, interval: str = "1h", limit: int = 100) -> Dict:
    """
    Get price history for a token.

    Args:
        token_id: The token ID
        interval: Time interval - 1m, 5m, 15m, 1h, 4h, 1d
        limit: Number of data points
    """
    try:
        r = requests.get(f"{DATA_API_URL}/prices", params={
            "token": token_id,
            "interval": interval,
            "_limit": limit
        })
        if r.status_code == 200:
            return {"success": True, "prices": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# REWARDS API
# =============================================================================

def get_daily_rewards() -> Dict:
    """Get your daily reward earnings"""
    if not FUNDER_ADDRESS:
        return {"success": False, "error": "No address configured"}
    try:
        r = requests.get(f"{CLOB_URL}/rewards/daily", params={"user": FUNDER_ADDRESS.lower()})
        if r.status_code == 200:
            return {"success": True, "rewards": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_market_rewards(market_id: str) -> Dict:
    """Get rewards info for a specific market"""
    try:
        r = requests.get(f"{CLOB_URL}/rewards/markets/{market_id}")
        if r.status_code == 200:
            return {"success": True, "rewards": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_reward_markets() -> Dict:
    """Get list of markets with active reward programs"""
    try:
        r = requests.get(f"{CLOB_URL}/rewards/markets")
        if r.status_code == 200:
            return {"success": True, "markets": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# PROFILES API
# =============================================================================

def get_profile(address: str) -> Dict:
    """Get public profile for a wallet address"""
    try:
        r = requests.get(f"{GAMMA_URL}/profiles/{address.lower()}")
        if r.status_code == 200:
            return {"success": True, "profile": r.json()}
        return {"success": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    """CLI interface"""
    if len(sys.argv) < 2:
        print(__doc__)
        return

    cmd = sys.argv[1].lower()

    if cmd == "search":
        query = sys.argv[2] if len(sys.argv) > 2 else ""
        results = search_markets(query)
        for r in results:
            print(f"\n{r['question']}")
            print(f"  Condition ID: {r['condition_id']}")
            print(f"  Volume: ${r['volume']:,.2f}, Liquidity: ${r['liquidity']:,.2f}")
            for o in r['outcomes']:
                print(f"  {o['outcome']}: {o['price']*100:.1f}¢ (token: {o['token_id'][:20]}...)")

    elif cmd == "orderbook":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py orderbook <token_id>")
            return
        token_id = sys.argv[2]
        book = get_orderbook(token_id)
        print(f"Best Bid: {book['best_bid']:.4f}")
        print(f"Best Ask: {book['best_ask']:.4f}")
        print(f"Spread: {book['spread']:.4f}")
        print(f"Bid Depth (top 5): {book['bid_depth']:.2f}")
        print(f"Ask Depth (top 5): {book['ask_depth']:.2f}")

    elif cmd == "balance":
        usdc = get_usdc_balance()
        print(f"USDC Balance: ${usdc:,.2f}")
        print(f"Wallet: {FUNDER_ADDRESS}")

    elif cmd == "positions":
        positions = get_positions()
        if not positions:
            print("No positions found")
        else:
            total_value = 0
            total_pnl = 0
            for p in positions:
                print(f"\n{p.get('title', 'Unknown')[:50]}")
                print(f"  {p['outcome']}: {p['size']:.2f} shares")
                print(f"  Avg: {p['avg_price']:.2f} -> Current: {p['current_price']:.2f}")
                print(f"  Value: ${p['value']:.2f}, PnL: ${p['pnl']:+.2f}")
                total_value += p['value']
                total_pnl += p['pnl']
            print(f"\nTotal Value: ${total_value:,.2f}")
            print(f"Total PnL: ${total_pnl:+,.2f}")

    elif cmd == "buy":
        if len(sys.argv) < 5:
            print("Usage: polymarket.py buy <token_id> <price> <size>")
            return
        token_id = sys.argv[2]
        price = float(sys.argv[3])
        size = float(sys.argv[4])
        result = buy(token_id, price, size)
        print(json.dumps(result, indent=2))

    elif cmd == "sell":
        if len(sys.argv) < 4:
            print("Usage: polymarket.py sell <token_id> <size> [price]")
            print("       If price omitted, market sells at 0.01")
            return
        token_id = sys.argv[2]
        size = float(sys.argv[3])
        price = float(sys.argv[4]) if len(sys.argv) > 4 else 0.01
        result = sell(token_id, price, size)
        print(json.dumps(result, indent=2))

    elif cmd == "market_sell":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py market_sell <token_id> [size]")
            return
        token_id = sys.argv[2]
        size = float(sys.argv[3]) if len(sys.argv) > 3 else None
        result = market_sell(token_id, size)
        print(json.dumps(result, indent=2))

    elif cmd == "market_buy":
        if len(sys.argv) < 4:
            print("Usage: polymarket.py market_buy <token_id> <usdc_amount>")
            return
        token_id = sys.argv[2]
        amount = float(sys.argv[3])
        result = market_buy(token_id, amount)
        print(json.dumps(result, indent=2))

    elif cmd == "maker_buy":
        if len(sys.argv) < 5:
            print("Usage: polymarket.py maker_buy <token_id> <price> <size>")
            print("       POST-ONLY order - must be BELOW best ask to be maker")
            return
        token_id = sys.argv[2]
        price = float(sys.argv[3])
        size = float(sys.argv[4])
        result = maker_buy(token_id, price, size)
        print(json.dumps(result, indent=2))

    elif cmd == "maker_sell":
        if len(sys.argv) < 5:
            print("Usage: polymarket.py maker_sell <token_id> <price> <size>")
            print("       POST-ONLY order - must be ABOVE best bid to be maker")
            return
        token_id = sys.argv[2]
        price = float(sys.argv[3])
        size = float(sys.argv[4])
        result = maker_sell(token_id, price, size)
        print(json.dumps(result, indent=2))

    elif cmd == "cancel":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py cancel <order_id>")
            return
        order_id = sys.argv[2]
        result = cancel_order(order_id)
        print(json.dumps(result, indent=2))

    elif cmd == "cancel_all":
        result = cancel_all_orders()
        print(json.dumps(result, indent=2))

    elif cmd == "orders":
        orders = get_open_orders()
        if not orders:
            print("No open orders")
        else:
            for o in orders:
                print(f"Order {o.get('id', 'N/A')}: {o.get('side')} {o.get('size')} @ {o.get('price')}")

    elif cmd == "trades":
        # Parse optional args
        market_id = None
        token_id = None
        i = 2
        while i < len(sys.argv):
            if sys.argv[i] == "--market" and i + 1 < len(sys.argv):
                market_id = sys.argv[i + 1]
                i += 2
            elif sys.argv[i] == "--token" and i + 1 < len(sys.argv):
                token_id = sys.argv[i + 1]
                i += 2
            else:
                i += 1
        trades = get_trades(market_id=market_id, token_id=token_id)
        if not trades:
            print("No trades found")
        else:
            for t in trades:
                print(f"Trade {t.get('id', 'N/A')}: {t.get('side')} {t.get('size')} @ {t.get('price')}")
                print(f"  Market: {t.get('market', 'N/A')[:30]}...")
        print(json.dumps(trades, indent=2))

    elif cmd == "cancel_market":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py cancel_market <market_id> [token_id]")
            return
        market_id = sys.argv[2]
        token_id = sys.argv[3] if len(sys.argv) > 3 else None
        result = cancel_market_orders(market_id, token_id)
        print(json.dumps(result, indent=2))

    elif cmd == "estimate_fill":
        if len(sys.argv) < 5:
            print("Usage: polymarket.py estimate_fill <token_id> <BUY|SELL> <amount>")
            return
        token_id = sys.argv[2]
        side = sys.argv[3]
        amount = float(sys.argv[4])
        result = estimate_fill(token_id, side, amount)
        print(json.dumps(result, indent=2))

    # =============================================================================
    # MARKET DATA - SINGLE TOKEN
    # =============================================================================

    elif cmd == "midpoint":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py midpoint <token_id>")
            return
        result = get_midpoint(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "spread":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py spread <token_id>")
            return
        result = get_spread(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "orderbook_hash":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py orderbook_hash <token_id>")
            return
        result = get_order_book_hash(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "price":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py price <token_id> [side]")
            return
        side = sys.argv[3] if len(sys.argv) > 3 else None
        result = get_price(sys.argv[2], side)
        print(json.dumps(result, indent=2))

    elif cmd == "last_trade":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py last_trade <token_id>")
            return
        result = get_last_trade(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "tick_size":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py tick_size <token_id>")
            return
        result = get_tick_size(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "fee_rate":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py fee_rate <token_id>")
            return
        result = get_fee_rate(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "neg_risk":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py neg_risk <token_id>")
            return
        result = get_neg_risk(sys.argv[2])
        print(json.dumps(result, indent=2))

    # =============================================================================
    # MARKET DATA - BATCH OPERATIONS
    # =============================================================================

    elif cmd == "midpoints_batch":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py midpoints_batch <token_ids_comma_sep>")
            return
        token_ids = sys.argv[2].split(',')
        result = get_midpoints_batch(token_ids)
        print(json.dumps(result, indent=2))

    elif cmd == "prices_batch":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py prices_batch <token_ids_comma_sep>")
            return
        token_ids = sys.argv[2].split(',')
        result = get_prices_batch(token_ids)
        print(json.dumps(result, indent=2))

    elif cmd == "spreads_batch":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py spreads_batch <token_ids_comma_sep>")
            return
        token_ids = sys.argv[2].split(',')
        result = get_spreads_batch(token_ids)
        print(json.dumps(result, indent=2))

    elif cmd == "orderbooks_batch":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py orderbooks_batch <token_ids_comma_sep>")
            return
        token_ids = sys.argv[2].split(',')
        result = get_orderbooks_batch(token_ids)
        print(json.dumps(result, indent=2))

    elif cmd == "last_trades_batch":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py last_trades_batch <token_ids_comma_sep>")
            return
        token_ids = sys.argv[2].split(',')
        result = get_last_trades_batch(token_ids)
        print(json.dumps(result, indent=2))

    # =============================================================================
    # MARKET DISCOVERY
    # =============================================================================

    elif cmd == "markets":
        next_cursor = sys.argv[2] if len(sys.argv) > 2 else None
        result = get_markets(next_cursor)
        print(json.dumps(result, indent=2))

    elif cmd == "simplified_markets":
        next_cursor = sys.argv[2] if len(sys.argv) > 2 else None
        result = get_simplified_markets(next_cursor)
        print(json.dumps(result, indent=2))

    elif cmd == "sampling_markets":
        next_cursor = sys.argv[2] if len(sys.argv) > 2 else None
        result = get_sampling_markets(next_cursor)
        print(json.dumps(result, indent=2))

    elif cmd == "sampling_simplified_markets":
        next_cursor = sys.argv[2] if len(sys.argv) > 2 else None
        result = get_sampling_simplified_markets(next_cursor)
        print(json.dumps(result, indent=2))

    elif cmd == "market_trades_events":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py market_trades_events <condition_id>")
            return
        result = get_market_trades_events(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "market_info":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py market_info <condition_id>")
            return
        result = get_market_info(sys.argv[2])
        print(json.dumps(result, indent=2))

    # =============================================================================
    # ORDER OPERATIONS
    # =============================================================================

    elif cmd == "get_order":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py get_order <order_id>")
            return
        result = get_order(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "post_orders_batch":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py post_orders_batch <orders_json>")
            print('  orders_json: [{"token_id":"...","side":"BUY","price":0.5,"size":10}, ...]')
            return
        result = post_orders_batch(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "cancel_orders_batch":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py cancel_orders_batch <order_ids_comma_sep>")
            return
        order_ids = sys.argv[2].split(',')
        result = cancel_orders_batch(order_ids)
        print(json.dumps(result, indent=2))

    # =============================================================================
    # API KEY MANAGEMENT
    # =============================================================================

    elif cmd == "create_api_key":
        result = create_api_key()
        print(json.dumps(result, indent=2))

    elif cmd == "derive_api_key":
        nonce = int(sys.argv[2]) if len(sys.argv) > 2 else None
        result = derive_api_key(nonce)
        print(json.dumps(result, indent=2))

    elif cmd == "get_api_keys":
        result = get_api_keys()
        print(json.dumps(result, indent=2))

    elif cmd == "delete_api_key":
        result = delete_api_key()
        print(json.dumps(result, indent=2))

    # =============================================================================
    # READ-ONLY API KEYS
    # =============================================================================

    elif cmd == "create_readonly_api_key":
        result = create_readonly_api_key()
        print(json.dumps(result, indent=2))

    elif cmd == "get_readonly_api_keys":
        result = get_readonly_api_keys()
        print(json.dumps(result, indent=2))

    elif cmd == "delete_readonly_api_key":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py delete_readonly_api_key <api_key>")
            return
        result = delete_readonly_api_key(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "validate_readonly_api_key":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py validate_readonly_api_key <api_key>")
            return
        result = validate_readonly_api_key(sys.argv[2])
        print(json.dumps(result, indent=2))

    # =============================================================================
    # BALANCE & ALLOWANCE
    # =============================================================================

    elif cmd == "get_balance_allowance":
        asset_type = sys.argv[2] if len(sys.argv) > 2 else "COLLATERAL"
        token_id = sys.argv[3] if len(sys.argv) > 3 else None
        result = get_balance_allowance(asset_type, token_id)
        print(json.dumps(result, indent=2))

    elif cmd == "update_balance_allowance":
        result = update_balance_allowance()
        print(json.dumps(result, indent=2))

    # =============================================================================
    # ADVANCED FEATURES
    # =============================================================================

    elif cmd == "heartbeat":
        heartbeat_id = sys.argv[2] if len(sys.argv) > 2 else None
        result = heartbeat(heartbeat_id)
        print(json.dumps(result, indent=2))

    elif cmd == "is_order_scoring":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py is_order_scoring <order_id>")
            return
        result = is_order_scoring(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "are_orders_scoring":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py are_orders_scoring <order_ids_comma_sep>")
            return
        order_ids = sys.argv[2].split(',')
        result = are_orders_scoring(order_ids)
        print(json.dumps(result, indent=2))

    elif cmd == "notifications":
        result = get_notifications()
        print(json.dumps(result, indent=2))

    elif cmd == "drop_notifications":
        result = drop_notifications()
        print(json.dumps(result, indent=2))

    # =============================================================================
    # HEALTH & CONFIG
    # =============================================================================

    elif cmd == "health":
        result = health_check()
        print(json.dumps(result, indent=2))

    elif cmd == "server_time":
        result = get_server_time()
        print(json.dumps(result, indent=2))

    elif cmd == "get_address":
        result = get_address()
        print(json.dumps(result, indent=2))

    elif cmd == "collateral_address":
        result = get_collateral_address()
        print(json.dumps(result, indent=2))

    elif cmd == "conditional_address":
        result = get_conditional_address()
        print(json.dumps(result, indent=2))

    elif cmd == "exchange_address":
        result = get_exchange_address()
        print(json.dumps(result, indent=2))

    # =============================================================================
    # GAMMA API - Events & Markets
    # =============================================================================

    elif cmd == "event":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py event <event_id>")
            return
        result = get_event(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "event_by_slug":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py event_by_slug <slug>")
            return
        result = get_event_by_slug(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "events":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        offset = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        result = get_events(limit=limit, offset=offset)
        print(json.dumps(result, indent=2))

    elif cmd == "search_events":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py search_events <query>")
            return
        result = search_events(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "event_tags":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py event_tags <event_id>")
            return
        result = get_event_tags(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "market_by_slug":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py market_by_slug <slug>")
            return
        result = get_market_by_slug(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "market_tags":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py market_tags <market_id>")
            return
        result = get_market_tags(sys.argv[2])
        print(json.dumps(result, indent=2))

    # =============================================================================
    # GAMMA API - Series
    # =============================================================================

    elif cmd == "series":
        series_id = sys.argv[2] if len(sys.argv) > 2 else None
        result = get_series(series_id)
        print(json.dumps(result, indent=2))

    elif cmd == "series_list":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        result = get_series_list(limit)
        print(json.dumps(result, indent=2))

    # =============================================================================
    # GAMMA API - Tags
    # =============================================================================

    elif cmd == "tags":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        result = get_tags(limit)
        print(json.dumps(result, indent=2))

    elif cmd == "tag":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py tag <tag_id>")
            return
        result = get_tag(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "tag_by_slug":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py tag_by_slug <slug>")
            return
        result = get_tag_by_slug(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "tag_relations":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py tag_relations <tag_id>")
            return
        result = get_tag_relations(sys.argv[2])
        print(json.dumps(result, indent=2))

    # =============================================================================
    # GAMMA API - Sports
    # =============================================================================

    elif cmd == "sports":
        result = get_sports()
        print(json.dumps(result, indent=2))

    elif cmd == "teams":
        sport = sys.argv[2] if len(sys.argv) > 2 else None
        result = get_teams(sport)
        print(json.dumps(result, indent=2))

    # =============================================================================
    # GAMMA API - Comments
    # =============================================================================

    elif cmd == "comments":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py comments <market_id>")
            return
        result = get_comments(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "user_comments":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py user_comments <address>")
            return
        result = get_user_comments(sys.argv[2])
        print(json.dumps(result, indent=2))

    # =============================================================================
    # DATA API - Portfolio & Analytics
    # =============================================================================

    elif cmd == "positions_value":
        address = sys.argv[2] if len(sys.argv) > 2 else None
        result = get_positions_value(address)
        print(json.dumps(result, indent=2))

    elif cmd == "closed_positions":
        address = sys.argv[2] if len(sys.argv) > 2 else None
        result = get_closed_positions(address)
        print(json.dumps(result, indent=2))

    elif cmd == "pnl_timeseries":
        address = sys.argv[2] if len(sys.argv) > 2 else None
        interval = sys.argv[3] if len(sys.argv) > 3 else "1d"
        result = get_pnl_timeseries(address, interval)
        print(json.dumps(result, indent=2))

    elif cmd == "overall_pnl":
        address = sys.argv[2] if len(sys.argv) > 2 else None
        result = get_overall_pnl(address)
        print(json.dumps(result, indent=2))

    elif cmd == "user_rank":
        address = sys.argv[2] if len(sys.argv) > 2 else None
        result = get_user_rank(address)
        print(json.dumps(result, indent=2))

    elif cmd == "leaderboard":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 100
        result = get_leaderboard(limit)
        print(json.dumps(result, indent=2))

    elif cmd == "top_holders":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py top_holders <market_id>")
            return
        result = get_top_holders(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "user_activity":
        address = sys.argv[2] if len(sys.argv) > 2 else None
        result = get_user_activity(address)
        print(json.dumps(result, indent=2))

    elif cmd == "open_interest":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py open_interest <market_id>")
            return
        result = get_open_interest(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "live_volume":
        event_id = sys.argv[2] if len(sys.argv) > 2 else None
        result = get_live_volume(event_id)
        print(json.dumps(result, indent=2))

    elif cmd == "price_history":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py price_history <token_id> [interval]")
            return
        token_id = sys.argv[2]
        interval = sys.argv[3] if len(sys.argv) > 3 else "1h"
        result = get_price_history(token_id, interval)
        print(json.dumps(result, indent=2))

    # =============================================================================
    # REWARDS API
    # =============================================================================

    elif cmd == "daily_rewards":
        result = get_daily_rewards()
        print(json.dumps(result, indent=2))

    elif cmd == "market_rewards":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py market_rewards <market_id>")
            return
        result = get_market_rewards(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "reward_markets":
        result = get_reward_markets()
        print(json.dumps(result, indent=2))

    # =============================================================================
    # PROFILES API
    # =============================================================================

    elif cmd == "profile":
        if len(sys.argv) < 3:
            print("Usage: polymarket.py profile <address>")
            return
        result = get_profile(sys.argv[2])
        print(json.dumps(result, indent=2))

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)


if __name__ == "__main__":
    main()
