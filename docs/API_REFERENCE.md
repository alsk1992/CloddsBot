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
  "version": "0.3.4",
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

**Services:** `llm`, `code`, `web`, `trade`, `data`, `storage`

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
    "model": "claude-sonnet-4-20250514",
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
    "model": "claude-sonnet-4-20250514",
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
    "model": "claude-sonnet-4-20250514",
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
- `claude-sonnet-4-20250514`
- `claude-3-5-haiku-latest`
- `claude-opus-4-20250514`
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

**Data Types:** `price`, `orderbook`, `candles`, `trades`, `markets`, `positions`, `balance`, `news`, `sentiment`

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
