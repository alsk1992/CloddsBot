# Clodds API Reference

Complete reference for the Clodds HTTP and WebSocket APIs.

## Base URL

The gateway binds to loopback by default on port 18789:

```
http://127.0.0.1:18789
```

For the Compute API (agent marketplace):

```
https://api.cloddsbot.com
```

---

## Authentication

### Gateway API (Self-Hosted)

By default, HTTP endpoints do not require authentication. For production deployments:

1. **WebChat Token**: Set `WEBCHAT_TOKEN` environment variable
2. **Webhook Signatures**: HMAC-SHA256 signatures required by default
3. **Network Controls**: Use a reverse proxy with TLS for public exposure

### Compute API (Agent Marketplace)

Two authentication methods:

**1. Bearer Token (API Key)**
```http
Authorization: Bearer clodds_apikey_xxxxx
```

**2. Wallet Address in Body**
```json
{
  "wallet": "0x1234...5678",
  "payload": { ... }
}
```

### Rate Limiting

| Scope | Limit |
|-------|-------|
| Per-wallet | 60 requests/minute |
| Per-IP | 100 requests/minute |

Rate limit headers:
- `X-RateLimit-Remaining`: Requests remaining in window
- `Retry-After`: Seconds to wait when rate limited

---

## What Can You Build With This API?

The HTTP API turns Clodds from a CLI chatbot into a **headless trading platform** that any software can control. Skills and agents running inside Clodds call services directly in-process — the HTTP API is for everything external.

### Trading Dashboards / UIs

Build a React, Next.js, or mobile frontend on top of Clodds. Show live positions, PnL charts, and portfolio stats. Let users manage TP/SL visually, monitor whale activity, and act on arbitrage opportunities — all powered by the REST endpoints below.

### Automation Scripts

Write a Python or Node script that chains endpoints together:

```
GET /api/feeds/price/polymarket/:id   →  get current price
POST /api/risk/assess                 →  check if trade is safe
POST /api/routing/quote               →  find best execution route
POST /api/positions/managed/:id/stop-loss  →  set risk controls
```

### Multi-Bot Orchestration

Run multiple Clodds instances. A master controller queries each one via HTTP — one instance scans for opportunities, another executes trades, a third monitors risk.

### Telegram / Discord Bots

Build a lightweight bot that proxies user commands to the API. User types `/whales` in Telegram, bot calls `GET /api/whales/activity`, formats the response, and sends it back.

### Copy Trading Platform

Build a social trading site: users browse the whale leaderboard (`GET /api/whales/leaderboard`), pick leaders to follow (`POST /api/copy-trading/leaders`), and monitor copied positions (`GET /api/copy-trading/positions`).

### Monitoring & Alerting (Grafana, Datadog)

Scrape `GET /api/monitoring/health` and `GET /api/monitoring/process` for system metrics. Set up alerts on memory usage, provider outages, or queue backlogs. Wire price alerts via `POST /api/alerts/price`.

### AI Agent Integration

Other AI agents (AutoGPT, CrewAI, LangChain, etc.) can use Clodds as a "trading tool" by calling the REST API. Wrap endpoints as MCP tools so Claude or other LLMs can trade, check positions, and manage risk through function calling.

### Scheduled Jobs & Workflows

Use the Cron API (`POST /api/cron/jobs`) to schedule recurring tasks: daily portfolio rebalancing, periodic market scans, automated stop-loss sweeps, or daily digest reports — all without writing external cron jobs.

---

## Gateway HTTP Endpoints

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": 1706500000000
}
```

### GET /

API info and available endpoints.

**Response:**
```json
{
  "name": "clodds",
  "version": "0.3.10",
  "description": "AI assistant for prediction markets",
  "endpoints": {
    "websocket": "/ws",
    "webchat": "/chat",
    "health": "/health"
  }
}
```

### GET /webchat

Returns the WebChat HTML client that connects to `/chat` WebSocket.

---

## Market Data Endpoints

### GET /market-index/search

Search markets across platforms.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search text |
| `platform` | string | No | Filter: `polymarket\|kalshi\|manifold\|metaculus` |
| `limit` | number | No | Max results |
| `maxCandidates` | number | No | Max candidates to consider |
| `minScore` | number | No | Minimum relevance score |
| `platformWeights` | JSON | No | Platform weighting |

**Response:**
```json
{
  "results": [
    {
      "score": 0.8421,
      "market": {
        "platform": "polymarket",
        "id": "0x123abc",
        "slug": "will-x-happen",
        "question": "Will X happen by 2026?",
        "description": "Resolution criteria...",
        "url": "https://polymarket.com/...",
        "status": "open",
        "endDate": "2026-01-01T00:00:00.000Z",
        "resolved": false,
        "volume24h": 125000,
        "liquidity": 50000,
        "openInterest": 75000,
        "predictions": 1250
      }
    }
  ]
}
```

### GET /market-index/stats

Market index statistics.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `platforms` | string | No | Comma-separated platform list |

### POST /market-index/sync

Trigger manual market index sync.

**Request Body:**
```json
{
  "platforms": ["polymarket", "kalshi"],
  "limitPerPlatform": 500,
  "status": "open",
  "excludeSports": true,
  "minVolume24h": 1000,
  "minLiquidity": 500,
  "excludeResolved": true,
  "prune": true,
  "staleAfterMs": 86400000
}
```

**Response:**
```json
{
  "result": {
    "indexed": 450,
    "byPlatform": {
      "polymarket": 300,
      "kalshi": 150
    }
  }
}
```

---

## Tick Data Endpoints

### GET /api/ticks/:platform/:marketId

Get historical tick data.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `outcomeId` | string | No | Filter by outcome |
| `startTime` | number | No | Unix timestamp ms (default: 24h ago) |
| `endTime` | number | No | Unix timestamp ms (default: now) |
| `limit` | number | No | Max results (default: 1000) |

**Response:**
```json
{
  "ticks": [
    {
      "time": "2026-02-02T12:00:00.000Z",
      "platform": "polymarket",
      "marketId": "0x123",
      "outcomeId": "yes",
      "price": 0.55,
      "prevPrice": 0.54
    }
  ]
}
```

### GET /api/ohlc/:platform/:marketId

Get OHLC candle data.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `outcomeId` | string | Yes | Outcome ID |
| `interval` | string | No | `1m\|5m\|15m\|1h\|4h\|1d` (default: `1h`) |
| `startTime` | number | No | Unix timestamp ms (default: 7d ago) |
| `endTime` | number | No | Unix timestamp ms (default: now) |

**Response:**
```json
{
  "candles": [
    {
      "time": 1706500000000,
      "open": 0.50,
      "high": 0.56,
      "low": 0.49,
      "close": 0.55,
      "tickCount": 42
    }
  ]
}
```

### GET /api/orderbook-history/:platform/:marketId

Historical orderbook snapshots.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `outcomeId` | string | No | Filter by outcome |
| `startTime` | number | No | Unix timestamp ms (default: 1h ago) |
| `endTime` | number | No | Unix timestamp ms (default: now) |
| `limit` | number | No | Max results (default: 100) |

**Response:**
```json
{
  "snapshots": [
    {
      "time": "2026-02-02T12:00:00.000Z",
      "platform": "polymarket",
      "marketId": "0x123",
      "outcomeId": "yes",
      "bids": [[0.54, 1000], [0.53, 500]],
      "asks": [[0.56, 800], [0.57, 1200]],
      "spread": 0.02,
      "midPrice": 0.55
    }
  ]
}
```

### GET /api/tick-recorder/stats

Tick recorder statistics.

**Response:**
```json
{
  "stats": {
    "ticksRecorded": 150000,
    "orderbooksRecorded": 50000,
    "ticksInBuffer": 45,
    "orderbooksInBuffer": 12,
    "lastFlushTime": 1706500000000,
    "dbConnected": true,
    "platforms": ["polymarket", "kalshi"]
  }
}
```

---

## Feature Engineering Endpoints

### GET /api/features/:platform/:marketId

Get computed trading features.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `outcomeId` | string | No | Specific outcome |

**Response:**
```json
{
  "features": {
    "timestamp": 1706500000000,
    "platform": "polymarket",
    "marketId": "0x123",
    "outcomeId": "yes",
    "tick": {
      "price": 0.55,
      "priceChange": 0.01,
      "priceChangePct": 1.85,
      "momentum": 0.03,
      "velocity": 0.001,
      "volatility": 0.015,
      "volatilityPct": 1.5,
      "tickCount": 150,
      "tickIntensity": 2.5,
      "vwap": null
    },
    "orderbook": {
      "spread": 0.02,
      "spreadPct": 3.6,
      "midPrice": 0.55,
      "bidDepth": 5000,
      "askDepth": 4500,
      "totalDepth": 9500,
      "imbalance": 0.053,
      "imbalanceRatio": 1.11,
      "bestBid": 0.54,
      "bestAsk": 0.56,
      "bestBidSize": 1000,
      "bestAskSize": 800,
      "weightedBidPrice": 0.535,
      "weightedAskPrice": 0.565,
      "bidDepthAt1Pct": 2000,
      "askDepthAt1Pct": 1800,
      "bidDepthAt5Pct": 4500,
      "askDepthAt5Pct": 4000
    },
    "signals": {
      "buyPressure": 0.62,
      "sellPressure": 0.38,
      "trendStrength": 0.15,
      "liquidityScore": 0.72
    }
  }
}
```

### GET /api/features

Get all computed features for tracked markets.

### GET /api/features/stats

Feature engineering service statistics.

---

## Percolator Endpoints

On-chain Solana perpetual futures. Requires `PERCOLATOR_ENABLED=true`.

### GET /api/percolator/status

Market state: oracle price, open interest, funding rate, LP bid/ask spread.

### GET /api/percolator/positions

User's open positions with PnL, entry price, capital.

### POST /api/percolator/trade

Execute long/short trade. Body: `{ "direction": "long"|"short", "size": <usd> }`

### POST /api/percolator/deposit

Deposit USDC collateral. Body: `{ "amount": <usd> }`

### POST /api/percolator/withdraw

Withdraw USDC collateral. Body: `{ "amount": <usd> }`

---

## Security Shield Endpoints

### POST /api/shield/scan

Scan code for malicious patterns (75 rules, 9 categories). Body: `{ "code": "..." }`

### POST /api/shield/check

Check address safety (auto-detects Solana/EVM). Body: `{ "address": "..." }`

### POST /api/shield/validate

Pre-flight transaction validation. Body: `{ "destination": "...", "amount": 100, "token": "USDC" }`

### GET /api/shield/stats

Scanner statistics — code scans, address checks, threats blocked, scam DB size.

---

## Token Audit Endpoints

### GET /api/audit/:address

GoPlus-powered token security analysis. Auto-detects chain (base58 = Solana, 0x = EVM).

Query: `?chain=ethereum` (optional override)

Returns: risk score (0-100), 16 risk flags, honeypot detection, liquidity, holder concentration.

### GET /api/audit/:address/safe

Quick boolean safety check. Returns `{ "address": "...", "chain": "...", "safe": true|false }`.

---

## DCA Endpoints

### GET /api/dca/orders

List active DCA orders across all platforms. Query: `?userId=default`

### GET /api/dca/:id

Get a single DCA order by ID.

### POST /api/dca/create

Create DCA order. Body: `{ "platform": "polymarket", "marketId": "...", "totalAmount": 1000, "amountPerCycle": 50, "intervalSec": 3600, "side": "buy" }`

### POST /api/dca/:id/pause

Pause a running DCA order.

### POST /api/dca/:id/resume

Resume a paused DCA order.

### DELETE /api/dca/:id

Cancel and delete a DCA order.

---

## Webhook Endpoints

### POST /webhook or /webhook/*

Generic webhook for automation.

**Headers:**
| Header | Description |
|--------|-------------|
| `x-webhook-signature` | HMAC-SHA256 hex digest of body |
| `x-hub-signature-256` | Alternative signature header |

**Signature Calculation:**
```javascript
const crypto = require('crypto');
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(rawBody)
  .digest('hex');
```

**Responses:**
| Status | Description |
|--------|-------------|
| 200 | `{ "ok": true }` |
| 401 | Invalid/missing signature |
| 404 | Unknown webhook path |
| 429 | Rate limited |

Set `CLODDS_WEBHOOK_REQUIRE_SIGNATURE=0` to disable signature checks.

### POST /channels/:platform

Channel-specific webhook entrypoint for Teams, Google Chat, etc.

---

## WebSocket Endpoints

### WS /ws

Development WebSocket endpoint.

**Message Format:**
```json
{
  "type": "res",
  "id": "<client-id>",
  "ok": true,
  "payload": { "echo": "<message>" }
}
```

### WS /chat (WebChat)

WebChat WebSocket for the browser client.

**Client Messages:**

**Auth:**
```json
{
  "type": "auth",
  "token": "<WEBCHAT_TOKEN>",
  "userId": "web-123"
}
```

**Message:**
```json
{
  "type": "message",
  "text": "What's the price of BTC?",
  "attachments": []
}
```

**Edit:**
```json
{
  "type": "edit",
  "messageId": "<id>",
  "text": "Updated text"
}
```

**Delete:**
```json
{
  "type": "delete",
  "messageId": "<id>"
}
```

**Server Messages:**
- `connected` - Connection established
- `authenticated` - Auth successful
- `ack` - Message received
- `message` - Response from agent
- `edit` - Edit confirmation
- `delete` - Delete confirmation
- `error` - Error occurred

**Attachment Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `image\|video\|audio\|document\|voice\|sticker` |
| `url` | string | URL to file |
| `data` | string | Base64-encoded data |
| `mimeType` | string | MIME type |
| `filename` | string | File name |
| `size` | number | File size in bytes |
| `width` | number | Image/video width |
| `height` | number | Image/video height |
| `duration` | number | Audio/video duration |
| `caption` | string | Caption text |

### WS /api/ticks/stream

Real-time tick data streaming.

**Subscribe:**
```json
{
  "type": "subscribe",
  "platform": "polymarket",
  "marketId": "0x123",
  "ticks": true,
  "orderbook": true
}
```

**Unsubscribe:**
```json
{
  "type": "unsubscribe",
  "platform": "polymarket",
  "marketId": "0x123"
}
```

**Ping (keepalive):**
```json
{ "type": "ping" }
```

**Server Messages:**

**Subscribed:**
```json
{
  "type": "subscribed",
  "platform": "polymarket",
  "marketId": "0x123",
  "ticks": true,
  "orderbook": true
}
```

**Tick:**
```json
{
  "type": "tick",
  "platform": "polymarket",
  "marketId": "0x123",
  "outcomeId": "yes",
  "price": 0.55,
  "prevPrice": 0.54,
  "timestamp": 1706500000000
}
```

**Orderbook:**
```json
{
  "type": "orderbook",
  "platform": "polymarket",
  "marketId": "0x123",
  "outcomeId": "yes",
  "bids": [[0.54, 1000]],
  "asks": [[0.56, 800]],
  "spread": 0.02,
  "midPrice": 0.55,
  "timestamp": 1706500000000
}
```

**Pong:**
```json
{
  "type": "pong",
  "timestamp": 1706500000000
}
```

**Error:**
```json
{
  "type": "error",
  "message": "Max subscriptions reached",
  "code": "MAX_SUBSCRIPTIONS"
}
```

**JavaScript Example:**
```javascript
const ws = new WebSocket('ws://localhost:18789/api/ticks/stream');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    platform: 'polymarket',
    marketId: '0x123abc',
    ticks: true,
    orderbook: true
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'tick') {
    console.log(`Price: ${msg.price}`);
  } else if (msg.type === 'orderbook') {
    console.log(`Spread: ${msg.spread}`);
  }
};
```

---

## Compute API Endpoints

### GET /v1/health

Health check.

**Response:**
```json
{
  "status": "ok",
  "service": "clodds-compute",
  "version": "v1",
  "uptime": 123456,
  "activeJobs": 2
}
```

### GET /v1/pricing

Service pricing.

**Response:**
```json
{
  "llm": {
    "service": "llm",
    "basePrice": 0,
    "unit": "token",
    "pricePerUnit": 0.000003,
    "minCharge": 0.001,
    "maxCharge": 10
  },
  "code": {
    "service": "code",
    "basePrice": 0.01,
    "unit": "second",
    "pricePerUnit": 0.001,
    "minCharge": 0.01,
    "maxCharge": 1
  },
  "web": {
    "service": "web",
    "basePrice": 0.005,
    "unit": "request",
    "pricePerUnit": 0.005,
    "minCharge": 0.005,
    "maxCharge": 0.1
  },
  "trade": {
    "service": "trade",
    "basePrice": 0.01,
    "unit": "call",
    "pricePerUnit": 0.01,
    "minCharge": 0.01,
    "maxCharge": 0.5
  },
  "data": {
    "service": "data",
    "basePrice": 0.001,
    "unit": "request",
    "pricePerUnit": 0.001,
    "minCharge": 0.001,
    "maxCharge": 0.1
  },
  "storage": {
    "service": "storage",
    "basePrice": 0,
    "unit": "mb",
    "pricePerUnit": 0.0001,
    "minCharge": 0.001,
    "maxCharge": 1
  }
}
```

### GET /v1/balance/:wallet

Check wallet balance.

**Response:**
```json
{
  "wallet": "0x...",
  "available": 10.50,
  "pending": 0.25,
  "totalDeposited": 15.00,
  "totalSpent": 4.25
}
```

### POST /v1/deposit

Deposit credits.

**Request:**
```json
{
  "wallet": "0x...",
  "paymentProof": {
    "txHash": "0x...",
    "network": "base",
    "amountUsd": 10.00,
    "token": "USDC",
    "timestamp": 1706500000000
  }
}
```

**Response:**
```json
{
  "success": true,
  "credits": 10.00,
  "txHash": "0x..."
}
```

### POST /v1/compute/:service

Submit compute request.

**Services:** `llm`, `code`, `web`, `trade`, `data`, `storage`, `gpu`, `ml`, `security`

**Request:**
```json
{
  "wallet": "0x...",
  "payload": { ... },
  "paymentProof": { ... },
  "callbackUrl": "https://your-server.com/webhook"
}
```

**Response:**
```json
{
  "id": "req_123",
  "jobId": "job_456",
  "service": "llm",
  "status": "pending",
  "cost": 0.05,
  "timestamp": 1706500000000
}
```

### POST /v1/stream/llm

Streaming LLM inference via Server-Sent Events.

**Request:**
```json
{
  "wallet": "0x...",
  "payload": {
    "model": "claude-opus-4-6",
    "messages": [
      { "role": "user", "content": "Write a poem" }
    ],
    "maxTokens": 1000
  }
}
```

**Response (SSE):**
```
data: {"type": "start", "requestId": "req_123"}

data: {"type": "text", "text": "In the "}

data: {"type": "text", "text": "realm of code..."}

data: {"type": "usage", "usage": {"inputTokens": 25, "outputTokens": 150}}

data: {"type": "done", "response": {...}}
```

### GET /v1/job/:jobId

Get job status.

**Response:**
```json
{
  "id": "req_123",
  "jobId": "job_456",
  "service": "llm",
  "status": "completed",
  "result": {
    "content": "The weather is sunny.",
    "model": "claude-opus-4-6",
    "usage": { "inputTokens": 10, "outputTokens": 5 },
    "stopReason": "end_turn"
  },
  "cost": 0.05,
  "timestamp": 1706500000000
}
```

**Status Values:** `pending`, `processing`, `completed`, `failed`

### DELETE /v1/job/:jobId

Cancel a pending job.

**Headers:**
- `X-Wallet-Address` (required): Wallet address for ownership verification

---

## Service Payloads

### LLM Service

```json
{
  "wallet": "0x...",
  "payload": {
    "model": "claude-opus-4-6",
    "messages": [
      { "role": "user", "content": "What's the weather?" }
    ],
    "system": "You are a helpful assistant",
    "maxTokens": 1000,
    "temperature": 0.7
  }
}
```

**Available Models:**
- `claude-opus-4-6` (latest, most capable)
- `claude-sonnet-4-5-20250929`
- `claude-haiku-4-5-20251001`
- `gpt-4o`
- `gpt-4o-mini`
- `llama-3.1-70b`
- `llama-3.1-8b`
- `mixtral-8x7b`

### Code Execution Service

```json
{
  "wallet": "0x...",
  "payload": {
    "language": "python",
    "code": "print('Hello World')",
    "stdin": "",
    "timeout": 30000,
    "memoryMb": 256
  }
}
```

**Supported Languages:** `python`, `javascript`, `typescript`, `rust`, `go`, `bash`

### Web Scraping Service

```json
{
  "wallet": "0x...",
  "payload": {
    "url": "https://example.com",
    "method": "GET",
    "headers": {},
    "javascript": false,
    "extract": {
      "title": "title",
      "heading": "h1"
    }
  }
}
```

### Data Service

```json
{
  "wallet": "0x...",
  "payload": {
    "type": "price",
    "query": {
      "asset": "bitcoin"
    }
  }
}
```

**Data Types:** `price`, `orderbook`, `candles`, `trades`, `markets`, `positions`, `balance`, `news`, `sentiment`, `percolator_state`

### Storage Service

```json
{
  "wallet": "0x...",
  "payload": {
    "operation": "put",
    "key": "my-file.txt",
    "content": "Hello World",
    "contentType": "text/plain",
    "ttl": 3600
  }
}
```

**Operations:** `put`, `get`, `delete`, `list`

---

## TWAP Endpoints

### GET /api/twap/orders

List all TWAP orders.

### GET /api/twap/:id

Get a specific TWAP order by ID.

### POST /api/twap/create

Create a new TWAP order.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | Yes | Trading platform |
| `marketId` | string | Yes | Market identifier |
| `tokenId` | string | Yes | Token identifier |
| `side` | string | Yes | `buy` or `sell` |
| `totalSize` | number | Yes | Total order size |
| `slices` | number | Yes | Number of slices |
| `intervalSec` | number | Yes | Seconds between slices |
| `priceLimit` | number | No | Max/min price limit |

### POST /api/twap/:id/pause

Pause a running TWAP order.

### POST /api/twap/:id/resume

Resume a paused TWAP order.

### DELETE /api/twap/:id

Cancel a TWAP order.

---

## Bracket Order Endpoints

### GET /api/bracket/orders

List all bracket orders.

### GET /api/bracket/:id

Get a specific bracket order by ID.

### POST /api/bracket/create

Create a bracket order (entry + take-profit + stop-loss).

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | Yes | Trading platform |
| `marketId` | string | Yes | Market identifier |
| `tokenId` | string | Yes | Token identifier |
| `side` | string | Yes | `buy` or `sell` |
| `size` | number | Yes | Order size |
| `entryPrice` | number | Yes | Entry price |
| `takeProfit` | number | Yes | Take-profit price |
| `stopLoss` | number | Yes | Stop-loss price |

### POST /api/bracket/:id/cancel

Cancel a bracket order.

### GET /api/bracket/stats

Get bracket order statistics.

---

## Trigger Order Endpoints

### GET /api/triggers/orders

List all trigger orders.

### GET /api/triggers/:id

Get a specific trigger order by ID.

### POST /api/triggers/create

Create a trigger order.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | Yes | Trading platform |
| `marketId` | string | Yes | Market identifier |
| `tokenId` | string | Yes | Token identifier |
| `side` | string | Yes | `buy` or `sell` |
| `size` | number | Yes | Order size |
| `triggerPrice` | number | Yes | Price to trigger at |
| `triggerCondition` | string | Yes | `above` or `below` |
| `expiresAt` | string | No | ISO 8601 expiry time |

### DELETE /api/triggers/:id

Cancel a trigger order.

### POST /api/triggers/:id/pause

Pause a trigger order.

### POST /api/triggers/:id/resume

Resume a paused trigger order.

---

## Copy Trading Endpoints

### GET /api/copy-trading/leaders

List tracked leader wallets.

### POST /api/copy-trading/leaders

Add a leader wallet to track.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `address` | string | Yes | Leader wallet address |
| `platform` | string | Yes | Platform to track on |
| `allocation` | number | No | Max allocation |
| `maxPositionSize` | number | No | Max per-position size |

### DELETE /api/copy-trading/leaders/:address

Remove a leader wallet.

### GET /api/copy-trading/positions

List all copied positions.

### GET /api/copy-trading/leaders/:address/positions

List positions copied from a specific leader.

### GET /api/copy-trading/leaders/:address/stats

Get copy performance stats for a leader.

### POST /api/copy-trading/start

Start copy trading.

### POST /api/copy-trading/stop

Stop copy trading.

### GET /api/copy-trading/status

Get copy trading service status.

### GET /api/copy-trading/stats

Get aggregate copy trading statistics.

### PUT /api/copy-trading/config

Update copy trading configuration.

---

## Opportunity Finder Endpoints

### GET /api/opportunities

List detected cross-platform arbitrage opportunities.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `minSpread` | number | Minimum spread filter |
| `platforms` | string | Comma-separated platform filter |
| `limit` | number | Max results |

### GET /api/opportunities/:id

Get a specific opportunity by ID.

### GET /api/opportunities/history

Get historical opportunities.

### GET /api/opportunities/stats

Get opportunity finder statistics.

### GET /api/opportunities/linked-markets

Get linked markets across platforms.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `marketKey` | string | Yes | Market key to look up |

### POST /api/opportunities/scan

Trigger a manual opportunity scan.

### POST /api/opportunities/start

Start continuous opportunity scanning.

### POST /api/opportunities/stop

Stop opportunity scanning.

### PUT /api/opportunities/config

Update opportunity finder configuration.

### GET /api/opportunities/platforms

Get available platform information.

### POST /api/opportunities/:id/execute

Execute an arbitrage opportunity.

### POST /api/opportunities/:id/simulate

Simulate executing an opportunity.

### GET /api/opportunities/executions

Get past execution results.

### POST /api/opportunities/auto-execute/start

Start auto-execution of opportunities.

---

## Whale Tracker Endpoints

### GET /api/whales/wallets

List all tracked wallets.

### POST /api/whales/wallets

Add a wallet to track.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `address` | string | Yes | Wallet address |
| `label` | string | No | Display label |
| `platforms` | string[] | No | Platforms to track |

### DELETE /api/whales/wallets/:address

Remove a tracked wallet.

### GET /api/whales/:address/positions

Get positions for a specific wallet.

### GET /api/whales/:address/history

Get transaction history for a wallet.

### POST /api/whales/:address/record-close

Record a closed position for a wallet.

### GET /api/whales/stats

Get whale tracker statistics.

### GET /api/whales/leaderboard

Get whale performance leaderboard.

### POST /api/whales/start

Start whale tracking.

### POST /api/whales/stop

Stop whale tracking.

### GET /api/whales/status

Get whale tracker service status.

### PUT /api/whales/config

Update whale tracker configuration.

### GET /api/whales/activity

Get recent whale activity across all wallets.

---

## Risk Engine Endpoints

### POST /api/risk/assess

Assess risk for a proposed trade.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User identifier |
| `platform` | string | Yes | Trading platform |
| `marketId` | string | Yes | Market identifier |
| `side` | string | Yes | `buy` or `sell` |
| `size` | number | Yes | Order size |
| `price` | number | Yes | Order price |

### GET /api/risk/limits/:userId

Get risk limits for a user.

### PUT /api/risk/limits/:userId

Update risk limits for a user.

### POST /api/risk/pnl

Record a PnL entry.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User identifier |
| `pnlUsd` | number | Yes | PnL in USD |
| `pnlPct` | number | Yes | PnL percentage |

### GET /api/risk/report/:userId

Get a full risk report for a user.

### GET /api/risk/stats

Get risk engine statistics.

---

## Smart Router Endpoints

### POST /api/routing/quote

Find the best route for an order.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | Yes | Source platform |
| `marketId` | string | Yes | Market identifier |
| `side` | string | Yes | `buy` or `sell` |
| `size` | number | Yes | Order size |

### POST /api/routing/quotes

Get quotes from all available routes.

### POST /api/routing/compare

Compare routes across platforms.

### PUT /api/routing/config

Update smart router configuration.

---

## Feeds Manager Endpoints

### GET /api/feeds/cache-stats

Get feed cache statistics.

### POST /api/feeds/cache/clear

Clear the feed cache.

### GET /api/feeds/search

Search for markets across feeds.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query |
| `limit` | number | No | Max results |

### GET /api/feeds/news

Get latest news from all feeds.

### GET /api/feeds/news/search

Search news articles.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query |
| `limit` | number | No | Max results |

### GET /api/feeds/market/:marketId

Get market data from feeds.

### GET /api/feeds/price/:platform/:marketId

Get current price for a market.

### GET /api/feeds/orderbook/:platform/:marketId

Get orderbook for a market.

### POST /api/feeds/analyze-edge

Analyze edge for a market opportunity.

### POST /api/feeds/kelly

Calculate Kelly criterion for a bet.

---

## Monitoring Endpoints

### GET /api/monitoring/health

System health check (hostname, memory, CPU, uptime).

### GET /api/monitoring/providers

LLM provider health status.

### GET /api/monitoring/process

Node.js process info (pid, uptime, memory, CPU usage).

---

## Alt Data Endpoints

### GET /api/alt-data/signals

Get recent alternative data signals.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Max results |

### GET /api/alt-data/sentiment/:marketId

Get market-specific sentiment data.

### GET /api/alt-data/stats

Get alt data service statistics.

---

## Alerts Endpoints

### GET /api/alerts

List alerts for a user.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | User ID (default: `default`) |

### GET /api/alerts/:id

Get a specific alert.

### POST /api/alerts/price

Create a price alert (above/below threshold).

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | Yes | Trading platform |
| `marketId` | string | Yes | Market identifier |
| `type` | string | Yes | `price_above` or `price_below` |
| `threshold` | number | Yes | Price threshold |
| `userId` | string | No | User ID |
| `deliveryChannel` | string | No | `http`, `telegram`, etc. |
| `oneTime` | boolean | No | Delete after triggered |

### POST /api/alerts/price-change

Create a price change alert (% change in time window).

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | Yes | Trading platform |
| `marketId` | string | Yes | Market identifier |
| `changePct` | number | Yes | Change percentage threshold |
| `timeWindowSecs` | number | Yes | Time window in seconds |

### POST /api/alerts/volume

Create a volume spike alert.

### PUT /api/alerts/:id/enable

Enable an alert.

### PUT /api/alerts/:id/disable

Disable an alert.

### DELETE /api/alerts/:id

Delete an alert.

### POST /api/alerts/start-monitoring

Start alert monitoring.

### POST /api/alerts/stop-monitoring

Stop alert monitoring.

---

## Execution Queue Endpoints

### GET /api/queue/jobs/:id

Get status of a queued execution job.

### POST /api/queue/jobs/:id/wait

Wait for a job to complete (with timeout).

**Request Body:**
| Field | Type | Description |
|-------|------|-------------|
| `timeoutMs` | number | Max wait time (default: 30000) |

---

## Webhooks Management Endpoints

### GET /api/webhooks

List all registered webhooks.

### GET /api/webhooks/:id

Get a specific webhook.

### PUT /api/webhooks/:id/enable

Enable a webhook.

### PUT /api/webhooks/:id/disable

Disable a webhook.

### DELETE /api/webhooks/:id

Delete a webhook.

### POST /api/webhooks/:id/regenerate-secret

Regenerate the HMAC secret for a webhook.

---

## Payments (x402) Endpoints

### GET /api/payments/status

Check if payments are configured.

### GET /api/payments/history

Get payment history.

### GET /api/payments/balance/:network

Get balance for a network (`base`, `base-sepolia`, `solana`, `solana-devnet`).

### GET /api/payments/address/:network

Get wallet address for a network.

---

## Embeddings Endpoints

### POST /api/embeddings/embed

Generate embedding for a single text.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | Text to embed |

### POST /api/embeddings/embed-batch

Generate embeddings for multiple texts.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `texts` | string[] | Yes | Texts to embed |

### POST /api/embeddings/similarity

Compute cosine similarity between two vectors.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `a` | number[] | Yes | First vector |
| `b` | number[] | Yes | Second vector |

### POST /api/embeddings/search

Semantic search over a list of items.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `items` | string[] | Yes | Items to search |
| `topK` | number | No | Max results |

### POST /api/embeddings/cache/clear

Clear the embedding cache.

---

## Cron Service Endpoints

### GET /api/cron/status

Get cron service status (running, job count, next job).

### GET /api/cron/jobs

List all scheduled jobs.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `includeDisabled` | boolean | Include disabled jobs |

### GET /api/cron/jobs/:id

Get a specific scheduled job.

### POST /api/cron/jobs

Create a new scheduled job.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Job name |
| `schedule` | object | Yes | Schedule config (`{ kind: 'every', everyMs: 60000 }` or `{ kind: 'cron', expr: '*/5 * * * *' }`) |
| `payload` | object | Yes | Job payload (`{ kind: 'systemEvent', text: '...' }`, etc.) |
| `enabled` | boolean | No | Enabled (default: true) |

### PATCH /api/cron/jobs/:id

Update a scheduled job.

### DELETE /api/cron/jobs/:id

Remove a scheduled job.

### POST /api/cron/jobs/:id/run

Run a job immediately.

**Request Body:**
| Field | Type | Description |
|-------|------|-------------|
| `mode` | string | `force` (default) or `due` |

---

## Position Manager Endpoints

### GET /api/positions/managed

List all managed positions with stats.

### GET /api/positions/managed/:id

Get a specific managed position.

### GET /api/positions/managed/by-platform/:platform

Get managed positions filtered by platform.

### POST /api/positions/managed

Create or update a managed position.

### POST /api/positions/managed/:id/close

Close a managed position.

**Request Body:**
| Field | Type | Description |
|-------|------|-------------|
| `price` | number | Close price (default: current price) |

### POST /api/positions/managed/:id/stop-loss

Set stop-loss on a position.

**Request Body:**
| Field | Type | Description |
|-------|------|-------------|
| `price` | number | Absolute stop-loss price |
| `percentFromEntry` | number | Stop-loss as % from entry |
| `trailingPercent` | number | Trailing stop percentage |

### POST /api/positions/managed/:id/take-profit

Set take-profit on a position.

**Request Body:**
| Field | Type | Description |
|-------|------|-------------|
| `price` | number | Absolute take-profit price |
| `percentFromEntry` | number | Take-profit as % from entry |
| `partialLevels` | array | Partial TP levels `[{ percent, sizePercent }]` |

### DELETE /api/positions/managed/:id/stop-loss

Remove stop-loss from a position.

### DELETE /api/positions/managed/:id/take-profit

Remove take-profit from a position.

### PUT /api/positions/managed/:id/price

Update current price for a position (triggers TP/SL checks).

### PUT /api/positions/managed/prices

Batch update prices for multiple positions.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `updates` | array | Yes | `[{ positionId, price }]` |

### POST /api/positions/managed/start

Start position monitoring (TP/SL checker).

### POST /api/positions/managed/stop

Stop position monitoring.

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_REQUEST` | 400 | Malformed request body |
| `MISSING_WALLET` | 400 | Wallet address required |
| `INVALID_SIGNATURE` | 401 | Webhook signature invalid |
| `INSUFFICIENT_BALANCE` | 402 | Not enough credits |
| `UNAUTHORIZED` | 403 | Access denied |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMITED` | 429 | Too many requests |
| `MAX_SUBSCRIPTIONS` | 429 | WebSocket subscription limit |
| `INTERNAL_ERROR` | 500 | Server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily down |

**Error Response Format:**
```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Need $0.05, have $0.00"
  }
}
```

---

## Webhooks (Callbacks)

When you provide a `callbackUrl` in compute requests, results are POSTed:

```json
{
  "id": "req_123",
  "jobId": "job_456",
  "service": "llm",
  "status": "completed",
  "result": { ... },
  "cost": 0.05,
  "timestamp": 1706500000000
}
```

**Verification Header:**
- `X-Clodds-Signature`: HMAC-SHA256 of body using webhook secret

---

## OpenAPI Specification

Full OpenAPI 3.0 spec available at:

```
/docs/openapi.yaml
```

Or view interactively:
```
/docs/swagger
```
