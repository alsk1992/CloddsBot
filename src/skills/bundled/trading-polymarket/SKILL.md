---
name: trading-polymarket
description: "Execute trades on Polymarket using py_clob_client - full API access for market data, orders, positions"
emoji: "💰"
gates:
  envs:
    - POLY_API_KEY
    - POLY_API_SECRET
    - POLY_API_PASSPHRASE
    - PRIVATE_KEY
---

# Polymarket Trading - Complete API Reference

Full access to Polymarket's CLOB (Central Limit Order Book) via the official `py_clob_client` library.

**60+ methods documented. This is the complete reference.**

## Required Environment Variables

```bash
PRIVATE_KEY=0x...           # Ethereum private key for signing
POLY_FUNDER_ADDRESS=0x...   # Your wallet address on Polygon
POLY_API_KEY=...            # From Polymarket API
POLY_API_SECRET=...         # Base64 encoded secret
POLY_API_PASSPHRASE=...     # API passphrase
```

## Installation

```bash
pip install py-clob-client requests
```

---

## Authentication Levels

| Level | Requirements | Capabilities |
|-------|--------------|--------------|
| **L0** | None | Read-only: orderbooks, prices, markets |
| **L1** | Private key | Create & sign orders (not post) |
| **L2** | Private key + API creds | Full trading: post orders, cancel, query |

### Signature Types

| Type | Use Case |
|------|----------|
| `0` | Standard EOA (MetaMask, hardware wallets) |
| `1` | Magic/email wallets (delegated signing) |
| `2` | Proxy wallets (Gnosis Safe, browser proxy) |

---

## ClobClient - Complete API (60+ Methods)

### Initialization

```python
from py_clob_client.client import ClobClient
from py_clob_client.clob_types import (
    OrderArgs, MarketOrderArgs, ApiCreds, OrderType,
    BookParams, TradeParams, OpenOrderParams, BalanceAllowanceParams,
    AssetType, OrderScoringParams, OrdersScoringParams, DropNotificationParams
)
from py_clob_client.order_builder.constants import BUY, SELL
from py_clob_client.constants import POLYGON  # 137

# Level 2 Auth (full trading access)
client = ClobClient(
    host="https://clob.polymarket.com",
    key=os.getenv("PRIVATE_KEY"),           # Private key for signing
    chain_id=POLYGON,                        # 137 for mainnet, 80002 for Amoy testnet
    funder=os.getenv("POLY_FUNDER_ADDRESS"), # Wallet address (for proxy wallets)
    signature_type=2                         # 0=EOA, 1=MagicLink, 2=Proxy
)

# Set API credentials for authenticated endpoints
client.set_api_creds(ApiCreds(
    api_key=os.getenv("POLY_API_KEY"),
    api_secret=os.getenv("POLY_API_SECRET"),
    api_passphrase=os.getenv("POLY_API_PASSPHRASE")
))
```

### Health & Configuration

```python
client.get_ok()                    # Check if server is up
client.get_server_time()           # Get server timestamp
client.get_address()               # Your signer's public address
client.get_collateral_address()    # USDC contract address
client.get_conditional_address()   # CTF contract address
client.get_exchange_address()      # Exchange contract (neg_risk=False default)
```

### Market Data - Single Token

```python
# Get prices and spreads
client.get_midpoint(token_id)              # Mid market price
client.get_price(token_id, side="BUY")     # Best price for side
client.get_spread(token_id)                # Current spread
client.get_last_trade_price(token_id)      # Last executed trade price

# Get full orderbook
orderbook = client.get_order_book(token_id)
# Returns: OrderBookSummary with bids, asks, tick_size, neg_risk, timestamp, hash
```

### Market Data - Batch (Multiple Tokens)

```python
params = [
    BookParams(token_id="TOKEN1", side="BUY"),
    BookParams(token_id="TOKEN2", side="SELL")
]

client.get_midpoints(params)           # Multiple midpoints
client.get_prices(params)              # Multiple prices
client.get_spreads(params)             # Multiple spreads
client.get_order_books(params)         # Multiple orderbooks
client.get_last_trades_prices(params)  # Multiple last prices
```

### Market Metadata

```python
client.get_tick_size(token_id)      # Returns: "0.1", "0.01", "0.001", or "0.0001"
client.get_neg_risk(token_id)       # Returns: True/False (negative risk market)
client.get_fee_rate_bps(token_id)   # Returns: fee rate in basis points (0 or 1000)
```

---

## Order Types

```python
from py_clob_client.clob_types import OrderType

OrderType.GTC   # Good Till Cancelled - stays open until filled/cancelled
OrderType.FOK   # Fill Or Kill - fill entirely immediately or cancel
OrderType.GTD   # Good Till Date - expires at timestamp (min 60 seconds)
OrderType.FAK   # Fill And Kill - fill what's possible, cancel rest
```

### When to Use Each Order Type

| Type | Use Case | Example |
|------|----------|---------|
| **GTC** | Entries - wait for fill | Place buy at 0.45, wait for dip |
| **FOK** | Exits - need immediate fill | Market sell entire position NOW |
| **GTD** | Time-limited orders | Offer expires in 5 minutes |
| **FAK** | Partial fills OK | Get as much as possible now |

### OrderArgs - Limit Orders

```python
OrderArgs(
    token_id: str,           # Token ID (outcome to trade)
    price: float,            # Price 0.01-0.99
    size: float,             # Number of shares
    side: str,               # "BUY" or "SELL" (or use BUY/SELL constants)
    fee_rate_bps: int = 0,   # Optional: fee rate in bps (0 or check market)
    nonce: int = 0,          # Optional: unique nonce for cancellation
    expiration: int = 0,     # Optional: expiry timestamp (0 = GTC, use timestamp for GTD)
    taker: str = ZERO_ADDRESS  # Optional: specific taker (ZERO_ADDRESS = anyone)
)
```

### MarketOrderArgs - Market Orders

```python
MarketOrderArgs(
    token_id: str,           # Token ID
    amount: float,           # Total USDC amount to spend (BUY) or shares (SELL)
    side: str,               # "BUY" or "SELL"
    price: float = 0,        # Optional: worst acceptable price (slippage protection)
    fee_rate_bps: int = 0,   # Optional: fee rate
    nonce: int = 0,          # Optional: nonce
    taker: str = ZERO_ADDRESS,  # Optional: taker address
    order_type: OrderType = FOK  # Optional: FOK (default) or FAK
)
```

### Complete Order Examples

```python
from py_clob_client.order_builder.constants import BUY, SELL

# 1. LIMIT BUY (GTC) - sits on book until filled
order = client.create_and_post_order(
    OrderArgs(token_id=TOKEN_ID, price=0.45, size=100.0, side=BUY)
)

# 2. LIMIT SELL (GTC)
order = client.create_and_post_order(
    OrderArgs(token_id=TOKEN_ID, price=0.55, size=50.0, side=SELL)
)

# 3. MARKET BUY - spend $100 USDC at current prices (FOK)
signed = client.create_market_order(
    MarketOrderArgs(token_id=TOKEN_ID, amount=100.0, side=BUY)
)
result = client.post_order(signed, orderType=OrderType.FOK)

# 4. MARKET SELL - sell all shares immediately (FOK)
signed = client.create_market_order(
    MarketOrderArgs(token_id=TOKEN_ID, amount=my_shares, side=SELL)
)
result = client.post_order(signed, orderType=OrderType.FOK)

# 5. POST-ONLY MAKER ORDER (avoid taker fees, earn rebates)
signed = client.create_order(
    OrderArgs(token_id=TOKEN_ID, price=0.44, size=100.0, side=BUY)
)
result = client.post_order(signed, orderType=OrderType.GTC, post_only=True)
# If order would cross spread, it gets REJECTED instead of taking

# 6. GOOD TIL DATE (GTD) - expires after timestamp
import time
expiry = int(time.time()) + 300  # 5 minutes from now
signed = client.create_order(
    OrderArgs(token_id=TOKEN_ID, price=0.50, size=100.0, side=BUY, expiration=expiry)
)
result = client.post_order(signed, orderType=OrderType.GTD)

# 7. FILL AND KILL (FAK) - fill what you can, cancel rest
signed = client.create_market_order(
    MarketOrderArgs(token_id=TOKEN_ID, amount=1000.0, side=BUY)
)
result = client.post_order(signed, orderType=OrderType.FAK)
```

---

## Order Operations

### Create and Post Orders

```python
# SIMPLE: Create and post in one call (recommended)
result = client.create_and_post_order(
    OrderArgs(
        token_id="123456789012345678901234567890",
        price=0.45,
        size=10.0,
        side="BUY"
    )
)
# Returns: {"orderID": "...", "status": "...", ...}

# ADVANCED: Separate create and post
order = client.create_order(OrderArgs(...))  # Returns SignedOrder
result = client.post_order(order, orderType=OrderType.GTC, post_only=False)

# Market order (calculates price automatically)
result = client.create_market_order(
    MarketOrderArgs(
        token_id="...",
        amount=100.0,    # Spend $100 USDC
        side="BUY"
    )
)

# Calculate expected fill price before market order
price = client.calculate_market_price(
    token_id="...",
    side="BUY",
    amount=100.0,
    order_type=OrderType.FOK
)
```

### Cancel Orders

```python
client.cancel(order_id="ORDER_ID")           # Cancel specific order
client.cancel_orders(["ID1", "ID2", "ID3"])  # Cancel multiple
client.cancel_all()                          # Cancel ALL open orders
client.cancel_market_orders(                 # Cancel by market/asset
    market="CONDITION_ID",
    asset_id="TOKEN_ID"
)
```

### Query Orders

```python
# Get all open orders
orders = client.get_orders(
    params=OpenOrderParams(
        id="ORDER_ID",      # Optional: specific order
        market="COND_ID",   # Optional: filter by market
        asset_id="TOKEN"    # Optional: filter by token
    ),
    next_cursor="MA=="      # For pagination
)

# Get specific order
order = client.get_order(order_id="ORDER_ID")
```

### Trade History

```python
trades = client.get_trades(
    params=TradeParams(
        id="TRADE_ID",           # Optional: specific trade
        maker_address="0x...",   # Optional: filter by maker
        market="CONDITION_ID",   # Optional: filter by market
        asset_id="TOKEN_ID",     # Optional: filter by token
        before="2024-01-01",     # Optional: before date
        after="2023-01-01"       # Optional: after date
    ),
    next_cursor="MA=="
)
```

### Balance & Allowance

```python
# Check balance and allowances
balance = client.get_balance_allowance(
    params=BalanceAllowanceParams(
        asset_type=AssetType.COLLATERAL,  # USDC balance
        # or AssetType.CONDITIONAL         # Token balance
        token_id="TOKEN_ID"                # For conditional tokens
    )
)

# Update/refresh allowance cache
client.update_balance_allowance(params=...)
```

---

## Market Discovery

### Get Markets from CLOB

```python
# All active markets
markets = client.get_markets(next_cursor="MA==")
simplified = client.get_simplified_markets()

# Specific market
market = client.get_market(condition_id="CONDITION_ID")

# Market trade events
events = client.get_market_trades_events(condition_id="CONDITION_ID")

# Sampling/featured markets
client.get_sampling_markets()
client.get_sampling_simplified_markets()
```

### Get Markets from Gamma API (More Details)

```python
import requests

def search_markets(query: str, limit: int = 10):
    """Search Polymarket markets by keyword"""
    url = "https://gamma-api.polymarket.com/markets"
    params = {
        "_q": query,
        "active": "true",
        "closed": "false",
        "_limit": limit
    }
    r = requests.get(url, params=params)
    return r.json()

# Get market details
markets = search_markets("bitcoin")
for m in markets:
    print(f"Question: {m['question']}")
    print(f"Condition ID: {m['condition_id']}")
    print(f"Volume: ${m.get('volume', 0):,.2f}")
    for token in m.get('tokens', []):
        print(f"  {token['outcome']}: {token['token_id']}")
        print(f"    Price: {float(token['price']):.2f}")
```

---

## On-Chain Operations

### Check Token Balance (Position Size)

```python
import requests

CTF_CONTRACT = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"
RPC_URL = "https://polygon-rpc.com/"

def get_token_balance(wallet: str, token_id: str) -> float:
    """Get balance of a specific outcome token in shares"""
    token_int = int(token_id)
    # ERC-1155 balanceOf(address,uint256)
    data = f"0x00fdd58e000000000000000000000000{wallet[2:].lower()}{token_int:064x}"

    r = requests.post(RPC_URL, json={
        "jsonrpc": "2.0",
        "method": "eth_call",
        "params": [{"to": CTF_CONTRACT, "data": data}, "latest"],
        "id": 1
    })

    result = r.json().get("result", "0x0")
    balance = int(result, 16) / 1e6  # Convert from raw to shares
    return balance

# Usage
balance = get_token_balance(
    wallet="0x7c2211103e7Fbb257Ac6fa59f972cfd8bc9D4795",
    token_id="12345678901234567890"
)
print(f"Position: {balance} shares")
```

### Check USDC Balance

```python
USDC_CONTRACT = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"

def get_usdc_balance(wallet: str) -> float:
    """Get USDC balance on Polygon"""
    # ERC-20 balanceOf(address)
    data = f"0x70a08231000000000000000000000000{wallet[2:].lower()}"

    r = requests.post(RPC_URL, json={
        "jsonrpc": "2.0",
        "method": "eth_call",
        "params": [{"to": USDC_CONTRACT, "data": data}, "latest"],
        "id": 1
    })

    result = r.json().get("result", "0x0")
    return int(result, 16) / 1e6  # USDC has 6 decimals
```

---

## API Key Management

```python
# Create new API key
creds = client.create_api_key(nonce=0)

# Derive existing API key (if you lost creds but have private key)
creds = client.derive_api_key(nonce=0)

# Create or derive (tries both)
creds = client.create_or_derive_api_creds(nonce=0)

# Get all your API keys
keys = client.get_api_keys()

# Delete current API key
client.delete_api_key()

# Readonly API keys (for monitoring only)
readonly = client.create_readonly_api_key()
client.get_readonly_api_keys()
client.delete_readonly_api_key(key="...")
client.validate_readonly_api_key(address="0x...", key="...")
```

---

## Advanced Features

### Order Heartbeat (Keep Orders Alive)

```python
# Start heartbeat - if not sent within 10s, all orders cancelled
heartbeat_id = client.post_heartbeat(heartbeat_id=None)

# Continue sending heartbeats
while trading:
    client.post_heartbeat(heartbeat_id=heartbeat_id)
    time.sleep(5)
```

### Order Scoring

```python
# Check if order is scoring (earning rewards)
is_scoring = client.is_order_scoring(
    params=OrderScoringParams(order_id="...")
)

# Check multiple orders
scores = client.are_orders_scoring(
    params=OrdersScoringParams(order_ids=["ID1", "ID2"])
)
```

### Notifications

```python
notifications = client.get_notifications()
client.drop_notifications(params=DropNotificationParams(...))
```

---

## Fee Structure

**IMPORTANT: Most Polymarket markets have ZERO fees (0% maker, 0% taker).**

### 15-min Crypto Markets (Exception)

Only 15-minute BTC/ETH/SOL/XRP price prediction markets have fees:

```
fee = shares × 0.25 × (price × (1 - price))²
```

| Entry Price | Fee % (per side) |
|-------------|------------------|
| 0.50 | ~1.56% |
| 0.60 or 0.40 | ~1.44% |
| 0.70 or 0.30 | ~1.10% |
| 0.80 or 0.20 | ~0.64% |
| 0.90 or 0.10 | ~0.20% |

**TAKER = crosses spread = PAYS fee**
**MAKER = adds liquidity = NO fee + earns rebates**

To be a maker: Post orders that don't immediately fill (inside the spread).

---

## Decimal Precision Rules

| Order Side | Price Decimals | Size Decimals |
|------------|----------------|---------------|
| BUY | 2 | 4 |
| SELL | 2 | 2 |

**Min order size:** $1 per side

---

## Complete Trading Example

```python
#!/usr/bin/env python3
"""
Production-ready Polymarket trading script
"""

import os
import time
import requests
from py_clob_client.client import ClobClient
from py_clob_client.clob_types import OrderArgs, ApiCreds, OrderType

# Initialize
client = ClobClient(
    "https://clob.polymarket.com",
    key=os.getenv("PRIVATE_KEY"),
    chain_id=137,
    funder=os.getenv("POLY_FUNDER_ADDRESS"),
    signature_type=2
)
client.set_api_creds(ApiCreds(
    api_key=os.getenv("POLY_API_KEY"),
    api_secret=os.getenv("POLY_API_SECRET"),
    api_passphrase=os.getenv("POLY_API_PASSPHRASE")
))

TOKEN_ID = "YOUR_TOKEN_ID"
WALLET = os.getenv("POLY_FUNDER_ADDRESS")
CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"

def get_balance(token_id):
    """Get position size"""
    token_int = int(token_id)
    data = f"0x00fdd58e000000000000000000000000{WALLET[2:].lower()}{token_int:064x}"
    r = requests.post("https://polygon-rpc.com/", json={
        "jsonrpc": "2.0", "method": "eth_call",
        "params": [{"to": CTF, "data": data}, "latest"], "id": 1
    })
    return int(r.json().get("result", "0x0"), 16) / 1e6

def get_orderbook(token_id):
    """Get current bid/ask"""
    book = client.get_order_book(token_id)
    return {
        "best_bid": float(book.bids[0].price) if book.bids else 0,
        "best_ask": float(book.asks[0].price) if book.asks else 1
    }

# Check position
position = get_balance(TOKEN_ID)
print(f"Current position: {position} shares")

# Get market
book = get_orderbook(TOKEN_ID)
print(f"Bid: {book['best_bid']:.2f}, Ask: {book['best_ask']:.2f}")

# Place a buy order (maker - inside spread)
buy_price = book['best_bid'] + 0.01  # 1 cent above bid
if buy_price < book['best_ask']:  # Ensure we're maker
    result = client.create_and_post_order(OrderArgs(
        token_id=TOKEN_ID,
        price=buy_price,
        size=10.0,
        side="BUY"
    ))
    print(f"Buy order placed: {result}")

# Place a sell order (market sell via FOK)
if position > 0:
    result = client.create_and_post_order(OrderArgs(
        token_id=TOKEN_ID,
        price=0.01,  # Lowest price = immediate fill
        size=position,
        side="SELL"
    ))
    print(f"Sold position: {result}")
```

---

## Error Handling

```python
from py_clob_client.exceptions import PolyApiException

try:
    result = client.create_and_post_order(OrderArgs(...))
except PolyApiException as e:
    print(f"API Error: {e}")
except Exception as e:
    print(f"Error: {e}")
```

Common errors:
- `"insufficient balance"` - Not enough USDC/tokens
- `"invalid price"` - Price outside 0.01-0.99 or wrong decimals
- `"order too small"` - Below minimum order size
- `"market closed"` - Market not accepting orders

---

## CLI Wrapper

For quick CLI access, use the bundled script:

```bash
python trading/polymarket.py search "bitcoin"
python trading/polymarket.py orderbook <token_id>
python trading/polymarket.py buy <token_id> <price> <size>
python trading/polymarket.py sell <token_id> <size>
python trading/polymarket.py positions
python trading/polymarket.py balance
python trading/polymarket.py cancel_all
```

---

## Clodds CLI Commands (`/poly`)

Access Polymarket trading directly from Claude Code:

### Market Data
```bash
/poly search <query>                     # Search markets
/poly market <condition-id>              # Market details
/poly book <token-id>                    # View orderbook
```

### Trading
```bash
/poly buy <token-id> <size> <price>      # Buy shares (limit)
/poly sell <token-id> <size> <price>     # Sell shares (limit)
/poly orders                             # Open orders
/poly cancel <order-id>                  # Cancel order
/poly cancel all                         # Cancel all orders
/poly trades [limit]                     # Recent trade history
/poly balance                            # USDC + positions
```

### Advanced Orders
```bash
/poly twap <buy|sell> <token> <total> <price> [slices] [interval-sec]
/poly bracket <token> <size> <tp> <sl>   # TP + SL bracket
/poly trigger buy <token> <size> <price> # Buy when price drops
/poly redeem                             # Redeem resolved positions
```

### Real-Time Fills (WebSocket)
```bash
/poly fills                              # Connect fills WebSocket
/poly fills status                       # Show connection + recent fills
/poly fills stop                         # Disconnect fills WebSocket
/poly fills clear                        # Clear tracked fills
```

### Order Heartbeat
```bash
/poly heartbeat                          # Start heartbeat (keeps orders alive)
/poly heartbeat status                   # Check heartbeat status
/poly heartbeat stop                     # Stop heartbeat (orders cancelled in 10s)
```

### Account & Settlements
```bash
/poly settlements                        # View pending settlements from resolved markets
/poly allowance                          # Check USDC approval status
/poly orderbooks <token1> [token2] ...   # Batch fetch orderbooks
```

---

## Complete ClobClient Method Reference

### Health & Config (L0 - No Auth)

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `get_ok()` | - | dict | Health check |
| `get_server_time()` | - | dict | Server timestamp |
| `get_address()` | - | str | Your signer address |
| `get_collateral_address()` | - | str | USDC contract |
| `get_conditional_address()` | - | str | CTF contract |
| `get_exchange_address(neg_risk)` | bool | str | Exchange contract |

### Market Data (L0 - No Auth)

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `get_midpoint(token_id)` | str | dict | Mid price |
| `get_midpoints(params)` | list[BookParams] | dict | Multiple mid prices |
| `get_price(token_id, side)` | str, str | dict | Best price for side |
| `get_prices(params)` | list[BookParams] | dict | Multiple prices |
| `get_spread(token_id)` | str | dict | Bid-ask spread |
| `get_spreads(params)` | list[BookParams] | dict | Multiple spreads |
| `get_order_book(token_id)` | str | OrderBookSummary | Full orderbook |
| `get_order_books(params)` | list[BookParams] | list | Multiple orderbooks |
| `get_last_trade_price(token_id)` | str | dict | Last trade |
| `get_last_trades_prices(params)` | list[BookParams] | dict | Multiple last trades |
| `get_tick_size(token_id)` | str | TickSize | "0.1"/"0.01"/"0.001"/"0.0001" |
| `get_neg_risk(token_id)` | str | bool | Is neg_risk market |
| `get_fee_rate_bps(token_id)` | str | int | Fee in basis points |

### Market Discovery (L0 - No Auth)

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `get_markets(next_cursor)` | str | dict | Paginated markets |
| `get_simplified_markets(next_cursor)` | str | dict | Simplified markets |
| `get_sampling_markets(next_cursor)` | str | dict | Featured markets |
| `get_market(condition_id)` | str | dict | Single market |
| `get_market_trades_events(condition_id)` | str | dict | Trade events |

### Order Creation (L1 - Needs Private Key)

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `create_order(order_args, options)` | OrderArgs, CreateOrderOptions | dict | Sign limit order |
| `create_market_order(order_args, options)` | MarketOrderArgs, CreateOrderOptions | dict | Sign market order |
| `calculate_market_price(token_id, side, amount, order_type)` | str, str, float, OrderType | float | Expected fill price |

### Order Posting (L2 - Needs API Creds)

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `post_order(order, orderType, post_only)` | SignedOrder, OrderType, bool | dict | Post single order |
| `post_orders(args)` | list[PostOrdersArgs] | dict | Post batch orders |
| `create_and_post_order(order_args, options)` | OrderArgs, PartialCreateOrderOptions | dict | Create + post (recommended) |

### Order Cancellation (L2 - Needs API Creds)

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `cancel(order_id)` | str | dict | Cancel one order |
| `cancel_orders(order_ids)` | list[str] | dict | Cancel multiple |
| `cancel_all()` | - | dict | Cancel ALL orders |
| `cancel_market_orders(market, asset_id)` | str, str | dict | Cancel by market |

### Order Queries (L2 - Needs API Creds)

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `get_orders(params, next_cursor)` | OpenOrderParams, str | list | Get open orders |
| `get_order(order_id)` | str | dict | Get specific order |
| `get_trades(params, next_cursor)` | TradeParams, str | list | Trade history |

### API Key Management (L2 - Needs API Creds)

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `create_api_key(nonce)` | int | ApiCreds | Create new key |
| `derive_api_key(nonce)` | int | ApiCreds | Derive existing key |
| `create_or_derive_api_creds(nonce)` | int | ApiCreds | Create or derive |
| `set_api_creds(creds)` | ApiCreds | - | Set credentials |
| `get_api_keys()` | - | dict | List your keys |
| `delete_api_key()` | - | dict | Delete current key |
| `create_readonly_api_key()` | - | ReadonlyApiKeyResponse | Readonly key |
| `get_readonly_api_keys()` | - | list[str] | List readonly keys |
| `delete_readonly_api_key(key)` | str | bool | Delete readonly key |

### Balance & Allowance (L2 - Needs API Creds)

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `get_balance_allowance(params)` | BalanceAllowanceParams | dict | Check balance |
| `update_balance_allowance(params)` | BalanceAllowanceParams | dict | Refresh allowance |

### Advanced Features (L2 - Needs API Creds)

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `post_heartbeat(heartbeat_id)` | str | dict | Keep orders alive (10s timeout) |
| `is_order_scoring(params)` | OrderScoringParams | dict | Check if earning rewards |
| `are_orders_scoring(params)` | OrdersScoringParams | dict | Check multiple orders |
| `get_notifications()` | - | dict | Get notifications |
| `drop_notifications(params)` | DropNotificationParams | dict | Delete notifications |
| `get_closed_only_mode()` | - | dict | Check closed-only status |

---

## Contract Addresses (Polygon Mainnet)

```python
USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"           # Collateral token
CTF  = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"           # Conditional tokens (ERC-1155)
EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E"       # Regular exchange
NEG_RISK = "0xC5d563A36AE78145C45a50134d48A1215220f80a"       # Neg risk exchange (crypto)
```

---

## Quick Reference: Common Patterns

### Check Position → Sell All
```python
balance = get_token_balance(wallet, token_id)
if balance > 0:
    client.create_and_post_order(OrderArgs(
        token_id=token_id, price=0.01, size=balance, side="SELL"
    ))
```

### Maker Entry (No Fees)
```python
book = client.get_order_book(token_id)
best_bid = float(book.bids[0].price) if book.bids else 0
maker_price = best_bid + 0.01  # 1 cent above bid
signed = client.create_order(OrderArgs(token_id=token_id, price=maker_price, size=100, side="BUY"))
client.post_order(signed, orderType=OrderType.GTC, post_only=True)
```

### Market Buy $50 Worth
```python
signed = client.create_market_order(MarketOrderArgs(token_id=token_id, amount=50.0, side="BUY"))
client.post_order(signed, orderType=OrderType.FOK)
```

### Cancel Everything
```python
client.cancel_all()
```

---

## WebSocket Channels (Real-Time Updates)

Polymarket provides WebSocket channels for real-time updates. **No RPC needed - everything goes through CLOB.**

### WebSocket URLs

```python
MARKET_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
USER_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/user"
```

### Market Channel (Public - No Auth)

Subscribe to orderbook updates, price changes, trades for any market.

```python
import websocket
import json

def on_message(ws, message):
    data = json.loads(message)
    event_type = data.get("event_type")

    if event_type == "book":
        # Full orderbook snapshot (on subscribe + after trades)
        print(f"Book update: {data['bids']}, {data['asks']}")

    elif event_type == "price_change":
        # Order placed/cancelled affecting price level
        print(f"Price change: {data}")

    elif event_type == "last_trade_price":
        # Trade executed
        print(f"Trade: {data['price']} x {data['size']}")

    elif event_type == "tick_size_change":
        # Tick size changed (price went extreme)
        print(f"Tick size: {data['old_tick_size']} -> {data['new_tick_size']}")

def on_open(ws):
    # Subscribe to specific token
    ws.send(json.dumps({
        "type": "subscribe",
        "channel": "market",
        "assets_ids": [TOKEN_ID]  # List of token IDs
    }))

ws = websocket.WebSocketApp(
    "wss://ws-subscriptions-clob.polymarket.com/ws/market",
    on_message=on_message,
    on_open=on_open
)
ws.run_forever()
```

### User Channel (Authenticated - For Fills)

Subscribe to YOUR order updates, fills, trades. **This is how you get fill notifications.**

```python
import websocket
import json
import hmac
import hashlib
import time
import base64

API_KEY = os.getenv("POLY_API_KEY")
API_SECRET = os.getenv("POLY_API_SECRET")
API_PASSPHRASE = os.getenv("POLY_API_PASSPHRASE")

def get_auth_headers():
    """Generate HMAC auth for WebSocket"""
    timestamp = str(int(time.time()))
    message = f"GET\n{timestamp}\n/ws/user"
    signature = hmac.new(
        base64.b64decode(API_SECRET),
        message.encode(),
        hashlib.sha256
    ).digest()
    return {
        "POLY-ADDRESS": WALLET_ADDRESS,
        "POLY-SIGNATURE": base64.b64encode(signature).decode(),
        "POLY-TIMESTAMP": timestamp,
        "POLY-API-KEY": API_KEY,
        "POLY-PASSPHRASE": API_PASSPHRASE
    }

def on_message(ws, message):
    data = json.loads(message)
    event_type = data.get("event_type")

    if event_type == "trade":
        # YOUR FILL - order matched!
        status = data.get("status")  # MATCHED, MINED, CONFIRMED, FAILED
        print(f"FILL: {data['side']} {data['size']} @ {data['price']}")
        print(f"  Status: {status}")
        print(f"  Trade ID: {data['id']}")
        print(f"  Market: {data['market']}")

        if status == "CONFIRMED":
            print("  ✓ Trade confirmed on-chain!")
        elif status == "FAILED":
            print("  ✗ Trade failed - check logs")

    elif event_type == "order":
        order_type = data.get("type")  # PLACEMENT, UPDATE, CANCELLATION
        print(f"ORDER {order_type}: {data['side']} {data['original_size']} @ {data['price']}")
        print(f"  Filled: {data.get('size_matched', 0)}")

        if order_type == "CANCELLATION":
            print("  Order cancelled")

def on_open(ws):
    # Subscribe with auth
    ws.send(json.dumps({
        "type": "subscribe",
        "channel": "user",
        "auth": get_auth_headers(),
        # Optional: filter to specific market
        # "markets": [CONDITION_ID]
    }))

ws = websocket.WebSocketApp(
    "wss://ws-subscriptions-clob.polymarket.com/ws/user",
    on_message=on_message,
    on_open=on_open
)
ws.run_forever()
```

### Message Types Summary

**Market Channel:**
| Event | Trigger | Key Fields |
|-------|---------|------------|
| `book` | Subscribe, trades affect book | bids, asks, timestamp |
| `price_change` | Order placed/cancelled | price, size, side |
| `last_trade_price` | Trade executed | price, size, side |
| `tick_size_change` | Price extreme (>0.96 or <0.04) | old_tick_size, new_tick_size |

**User Channel:**
| Event | Trigger | Key Fields |
|-------|---------|------------|
| `trade` | Your order filled | status, side, size, price, market |
| `order` | Order placed/updated/cancelled | type (PLACEMENT/UPDATE/CANCELLATION), size_matched |

### Trade Status Flow

```
MATCHED → MINED → CONFIRMED (success)
                → RETRYING → CONFIRMED/FAILED
```

### Keepalive

Send PING every 10 seconds to keep connection alive:
```python
import threading

def send_ping():
    while True:
        ws.send(json.dumps({"type": "ping"}))
        time.sleep(10)

threading.Thread(target=send_ping, daemon=True).start()
```

### Real-Time Data Client (Alternative)

Polymarket also provides `@polymarket/real-time-data-client` for TypeScript:

```typescript
import { RealTimeDataClient } from "@polymarket/real-time-data-client";

const client = new RealTimeDataClient({
    onMessage: (msg) => console.log(msg),
    onConnect: (c) => {
        // Subscribe to user fills with auth
        c.subscribe({
            subscriptions: [{
                topic: "clob_user",
                type: "*",
                clob_auth: {
                    key: API_KEY,
                    secret: API_SECRET,
                    passphrase: API_PASSPHRASE
                }
            }]
        });
    }
});

client.connect();
```

---

## No RPC Needed - CLOB Handles Everything

| Operation | Method |
|-----------|--------|
| Get positions | `GET /data/positions?user={address}` via Gamma API |
| Get balance | `client.get_balance_allowance()` |
| Place orders | `client.create_and_post_order()` |
| Get fills | User WebSocket channel |
| Get prices | `client.get_order_book()` or Market WebSocket |
| Cancel orders | `client.cancel()` |

The only time you might use RPC is to check on-chain token balances independently, but even that's available via Gamma API positions endpoint.
