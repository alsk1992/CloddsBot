---
name: trading-kalshi
description: "Search markets, place orders, stream real-time prices, and use advanced order types on Kalshi. Manage positions and view portfolio analytics. Use when trading event contracts on Kalshi or monitoring Kalshi market data."
commands:
  - /kalshi
  - /trading-kalshi
---

# Kalshi Trading

Full access to Kalshi prediction markets: search, trade, stream real-time data, and use advanced order types (TWAP, bracket, trigger).

## Required Environment Variables

```bash
KALSHI_API_KEY_ID=your_api_key_id
KALSHI_PRIVATE_KEY=your_private_key_pem_contents
# OR
KALSHI_PRIVATE_KEY_PATH=/path/to/private_key.pem
```

Authentication uses RSA key-pair signing (not email/password). Generate an API key from the Kalshi dashboard.

Optional:

```bash
DRY_RUN=true   # Simulate trades without executing
```

## Commands

### Market Data

```
/kalshi search <query>                     - Search markets
/kalshi market <ticker>                    - Market details
/kalshi book <ticker>                      - View orderbook (REST snapshot)
/kalshi events [query]                     - Browse events
/kalshi event <event-ticker>              - Event details + markets
```

### Trading

```
/kalshi buy <ticker> <contracts> <price>   - Buy YES contracts
/kalshi sell <ticker> <contracts> <price>  - Sell YES contracts
/kalshi orders                             - View open orders
/kalshi cancel <order-id>                  - Cancel an order
/kalshi cancel all                         - Cancel all orders
/kalshi balance                            - Account balance
```

### Advanced Orders

```
/kalshi twap <buy|sell> <ticker> <total> <price> [slices] [interval-sec]
/kalshi twap status                        - Active TWAP progress
/kalshi twap cancel <id>                   - Cancel TWAP

/kalshi bracket <ticker> <size> <tp> <sl>  - Set take-profit / stop-loss
/kalshi bracket status                     - Active brackets
/kalshi bracket cancel <id>                - Cancel bracket

/kalshi trigger buy <ticker> <size> <price> [limit]   - Buy when price drops
/kalshi trigger sell <ticker> <size> <price> [limit]  - Sell when price rises
/kalshi trigger list                       - Active triggers
/kalshi trigger cancel <id>                - Cancel trigger
```

### Real-Time Streaming (WebSocket)

```
/kalshi stream <ticker> [channels]         - Start streaming (ticker,trade,orderbook)
/kalshi stream-fills                       - Stream your order fills
/kalshi streams                            - List active streams
/kalshi unstream <ticker>                  - Stop streaming a market
/kalshi unstream-fills                     - Stop fill notifications
/kalshi realtime-book <ticker>             - Get real-time orderbook from stream
```

### Cross-Platform

```
/kalshi route <ticker> <buy|sell> <size>   - Compare prices across platforms
/kalshi circuit                            - Circuit breaker status
```

## Examples

```
/kalshi search bitcoin
/kalshi market KXBTC-24JAN01
/kalshi book KXBTC-24JAN01
/kalshi buy KXBTC-24JAN01 10 0.65
/kalshi sell KXBTC-24JAN01 5 0.70
/kalshi stream KXBTC-24JAN01 ticker,trade
/kalshi twap buy KXBTC-24JAN01 50 0.60 10 30
/kalshi bracket KXBTC-24JAN01 10 0.80 0.40
/kalshi trigger buy KXBTC-24JAN01 10 45
```

## Notes

- Prices are in decimal format for commands (0.65 = 65 cents)
- Trigger prices are in cents (45 = 45 cents)
- Contracts pay $1 if correct; cost is the price
- Circuit breaker integration blocks trades when risk limits are hit
- Trigger orders poll every 5 seconds
