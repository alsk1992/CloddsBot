# Opinion.trade Integration

BNB Chain prediction market with on-chain CLOB.

## Overview

Opinion.trade is a decentralized prediction market on BNB Chain featuring:
- On-chain Central Limit Order Book (CLOB)
- Real-time WebSocket price feeds
- EIP-712 signed orders

```
┌─────────────────────────────────────────────────────────────┐
│                    Opinion.trade                             │
├─────────────────┬─────────────────┬─────────────────────────┤
│   Market Data   │    Trading      │      WebSocket          │
├─────────────────┼─────────────────┼─────────────────────────┤
│ • Markets list  │ • Place orders  │ • Price updates         │
│ • Orderbooks    │ • Cancel orders │ • Order fills           │
│ • Price history │ • Open orders   │ • Market events         │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## Quick Start

### 1. Get API Key

1. Go to https://opinion.trade
2. Connect wallet and navigate to API settings
3. Generate API key

### 2. Configure

```bash
export OPINION_API_KEY="your-api-key"
# For trading:
export OPINION_PRIVATE_KEY="0x..."
export OPINION_MULTISIG_ADDRESS="0x..."
```

Or in `~/.clodds/clodds.json`:

```json
{
  "feeds": {
    "opinion": {
      "enabled": true,
      "apiKey": "${OPINION_API_KEY}"
    }
  },
  "trading": {
    "opinion": {
      "apiKey": "${OPINION_API_KEY}",
      "privateKey": "${OPINION_PRIVATE_KEY}",
      "multiSigAddress": "${OPINION_MULTISIG_ADDRESS}"
    }
  }
}
```

### 3. Use Commands

```
/markets opinion crypto      # Search Opinion markets
/compare bitcoin opinion,polymarket  # Compare prices
```

## Commands

### Direct Commands (`/op`)

| Command | Description |
|---------|-------------|
| `/op markets [query]` | Search Opinion markets |
| `/op market <id>` | Get market details |
| `/op price <id>` | Current prices |
| `/op book <tokenId>` | Show orderbook |

**Trading:**
| Command | Description |
|---------|-------------|
| `/op buy <marketId> <outcome> <price> <size>` | Place buy order |
| `/op sell <marketId> <outcome> <price> <size>` | Place sell order |
| `/op cancel <orderId>` | Cancel order |
| `/op cancelall` | Cancel all orders |
| `/op orders` | List open orders |

**Examples:**
```bash
/op markets trump
/op buy 813 YES 0.55 100     # Buy YES at 55c, 100 shares
/op sell 813 NO 0.40 50      # Sell NO at 40c, 50 shares
/op cancel abc123            # Cancel specific order
```

### Standard Commands

Opinion.trade also works with standard market commands:

| Command | Description |
|---------|-------------|
| `/markets opinion <query>` | Search Opinion markets |
| `/compare <query> [platforms]` | Compare prices across platforms |
| `/arbitrage [query] [platforms=opinion,polymarket]` | Find arbitrage opportunities |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/market` | GET | List all markets |
| `/market/{id}` | GET | Get market details |
| `/token/latest-price?tokenId=X` | GET | Current token price |
| `/token/orderbook?tokenId=X` | GET | Order book |
| `/token/price-history?tokenId=X` | GET | Price history |

Base URL: `https://proxy.opinion.trade:8443/openapi`

## WebSocket

Real-time updates via WebSocket:

```
URL: wss://ws.opinion.trade?apikey={API_KEY}
```

### Messages

**Heartbeat** (every 30s):
```json
{"action": "HEARTBEAT"}
```

**Subscribe to market**:
```json
{"action": "SUBSCRIBE", "channel": "PRICE", "marketId": 123}
```

**Price update**:
```json
{"channel": "PRICE", "marketId": 123, "tokenId": "...", "price": 0.55}
```

## Programmatic Usage

### Search Markets

```typescript
// Via FeedManager
const markets = await feeds.searchMarkets('crypto', 'opinion');

// Direct feed access
const feed = await createOpinionFeed({ apiKey: 'your-key' });
await feed.connect();
const markets = await feed.searchMarkets('bitcoin');
```

### Get Orderbook

```typescript
const orderbook = await feeds.getOrderbook('opinion', tokenId);
console.log('Best bid:', orderbook.bids[0]);
console.log('Best ask:', orderbook.asks[0]);
console.log('Spread:', orderbook.spread);
```

### Subscribe to Prices

```typescript
feeds.subscribePrice('opinion', marketId, (update) => {
  console.log('Price:', update.price);
  console.log('Previous:', update.previousPrice);
});
```

### Place Order

```typescript
const result = await execution.buyLimit({
  platform: 'opinion',
  marketId: '123',
  tokenId: '456...',
  price: 0.55,
  size: 100,
});

if (result.success) {
  console.log('Order ID:', result.orderId);
}
```

### Cancel Order

```typescript
await execution.cancelOrder('opinion', orderId);
```

### Get Open Orders

```typescript
const orders = await execution.getOpenOrders('opinion');
```

## Trading Notes

1. **Chain**: BNB Chain (chainId 56)

2. **Token IDs**: Large uint256 integers - always use string representation

3. **Rate Limits**: 15 requests/second

4. **Order Signing**: Uses EIP-712 typed data signatures

5. **Fees**: Check platform for current fee structure

## Configuration Reference

### Feed Config

```typescript
interface OpinionFeedConfig {
  enabled: boolean;
  apiKey?: string;
}
```

### Execution Config

```typescript
interface OpinionExecutionConfig {
  apiKey: string;
  privateKey?: string;      // For signing orders
  multiSigAddress?: string; // Vault/funder address
}
```

## Resources

- [Opinion.trade](https://opinion.trade)
- [Documentation](https://docs.opinion.trade)
- [BscScan](https://bscscan.com)
