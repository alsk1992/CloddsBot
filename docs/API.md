# Clodds API

This document describes the HTTP and WebSocket endpoints exposed by the Clodds gateway.

## Base URL

By default the gateway binds to loopback and listens on port 18789.

```
http://127.0.0.1:18789
```

## Authentication and security

- HTTP endpoints do not enforce authentication by default. Protect the gateway with network controls or a reverse proxy if you expose it publicly.
- WebChat supports an optional token. Set `WEBCHAT_TOKEN` and send it in the WebSocket auth message.
- Webhooks require HMAC signatures by default. See the webhook section below.

## HTTP endpoints

### GET /health

Basic health check.

Response:
```
{ "status": "ok", "timestamp": 1730000000000 }
```

### GET /

API info and supported endpoints.

Response:
```
{
  "name": "clodds",
  "version": "0.1.0",
  "description": "AI assistant for prediction markets",
  "endpoints": { "websocket": "/ws", "webchat": "/chat", "health": "/health" }
}
```

### GET /webchat

Returns a simple HTML client that connects to the WebChat WebSocket endpoint (`/chat`).

### POST /webhook or /webhook/*

Generic webhook endpoint for automation hooks.

Headers:
- `x-webhook-signature` or `x-hub-signature-256` (required by default)

Signature:
- HMAC SHA-256 hex digest of the raw request body using the webhook secret.
- To disable signature requirements, set `CLODDS_WEBHOOK_REQUIRE_SIGNATURE=0`.

Responses:
- `200 { "ok": true }` on success
- `401` for missing/invalid signatures
- `404` for unknown webhook paths
- `429` if rate limited

### POST /channels/:platform

Channel webhook entrypoint for platforms like Teams, Google Chat, etc.

Behavior:
- Forwards the JSON body to the configured channel adapter.
- Returns `404` if that platform handler is not configured.

### GET /market-index/search

Search the market index (requires `marketIndex.enabled`).

Query parameters:
- `q` (string, required): search text
- `platform` (string, optional): `polymarket|kalshi|manifold|metaculus`
- `limit` (number, optional)
- `maxCandidates` (number, optional)
- `minScore` (number, optional)
- `platformWeights` (JSON string, optional)

Response:
```
{
  "results": [
    {
      "score": 0.8421,
      "market": {
        "platform": "polymarket",
        "id": "123",
        "slug": "will-x-happen",
        "question": "...",
        "description": "...",
        "url": "...",
        "status": "open",
        "endDate": "2026-01-01T00:00:00.000Z",
        "resolved": false,
        "volume24h": 1234,
        "liquidity": 5678,
        "openInterest": 910,
        "predictions": 42
      }
    }
  ]
}
```

### GET /market-index/stats

Market index stats (requires `marketIndex.enabled`).

Query parameters:
- `platforms` (comma-separated list, optional)

### POST /market-index/sync

Trigger a manual market index sync (requires `marketIndex.enabled`).

Body (JSON):
- `platforms` (array or comma-separated string, optional)
- `limitPerPlatform` (number, optional)
- `status` (`open|closed|settled|all`, optional)
- `excludeSports` (boolean, optional)
- `minVolume24h` (number, optional)
- `minLiquidity` (number, optional)
- `minOpenInterest` (number, optional)
- `minPredictions` (number, optional)
- `excludeResolved` (boolean, optional)
- `prune` (boolean, optional)
- `staleAfterMs` (number, optional)

Response:
```
{ "result": { "indexed": 123, "byPlatform": { "polymarket": 100 } } }
```

### GET /api/ticks/:platform/:marketId

Get historical tick data (requires `tickRecorder.enabled`).

Query parameters:
- `outcomeId` (string, optional): filter by outcome
- `startTime` (number, optional): Unix timestamp in ms (default: 24h ago)
- `endTime` (number, optional): Unix timestamp in ms (default: now)
- `limit` (number, optional): max results (default: 1000)

Response:
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

Get OHLC candle data (requires `tickRecorder.enabled`).

Query parameters:
- `outcomeId` (string, required): outcome ID
- `interval` (string, optional): `1m|5m|15m|1h|4h|1d` (default: `1h`)
- `startTime` (number, optional): Unix timestamp in ms (default: 7d ago)
- `endTime` (number, optional): Unix timestamp in ms (default: now)

Response:
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

Get historical orderbook snapshots (requires `tickRecorder.enabled`).

Query parameters:
- `outcomeId` (string, optional): filter by outcome
- `startTime` (number, optional): Unix timestamp in ms (default: 1h ago)
- `endTime` (number, optional): Unix timestamp in ms (default: now)
- `limit` (number, optional): max results (default: 100)

Response:
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

Get tick recorder statistics (requires `tickRecorder.enabled`).

Response:
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

### GET /api/tick-streamer/stats

Get tick streamer statistics.

Response:
```json
{
  "stats": {
    "connectedClients": 5,
    "totalSubscriptions": 12,
    "ticksBroadcast": 45000,
    "orderbooksBroadcast": 15000,
    "uptime": 3600000
  }
}
```

### GET /api/features/:platform/:marketId

Get computed trading features for a specific market.

Query parameters:
- `outcomeId` (string, optional): specific outcome

Response:
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

Get all computed features for all tracked markets.

Response:
```json
{
  "snapshots": [
    {
      "timestamp": 1706500000000,
      "platform": "polymarket",
      "marketId": "0x123",
      "outcomeId": "yes",
      "features": { ... }
    }
  ],
  "count": 15
}
```

### GET /api/features/stats

Get feature engineering service statistics.

Response:
```json
{
  "stats": {
    "marketsTracked": 15,
    "ticksProcessed": 45000,
    "orderbooksProcessed": 12000
  }
}
```

## WebSocket endpoints

### WS /ws

Development WebSocket endpoint. Currently echoes incoming JSON with a wrapper:

```
{ "type": "res", "id": "<client id>", "ok": true, "payload": { "echo": <message> } }
```

### WS /api/ticks/stream (Tick Streaming)

Real-time tick data streaming via WebSocket. Subscribe to specific markets and receive live price/orderbook updates.

**Client messages:**

```json
// Subscribe to a market (ticks enabled by default, orderbook opt-in)
{ "type": "subscribe", "platform": "polymarket", "marketId": "0x123", "ticks": true, "orderbook": true }

// Unsubscribe
{ "type": "unsubscribe", "platform": "polymarket", "marketId": "0x123" }

// Ping (keepalive)
{ "type": "ping" }
```

**Server messages:**

```json
// Subscription confirmed
{ "type": "subscribed", "platform": "polymarket", "marketId": "0x123", "ticks": true, "orderbook": true }

// Price tick
{ "type": "tick", "platform": "polymarket", "marketId": "0x123", "outcomeId": "yes", "price": 0.55, "prevPrice": 0.54, "timestamp": 1706500000000 }

// Orderbook update
{ "type": "orderbook", "platform": "polymarket", "marketId": "0x123", "outcomeId": "yes", "bids": [[0.54, 1000]], "asks": [[0.56, 800]], "spread": 0.02, "midPrice": 0.55, "timestamp": 1706500000000 }

// Pong (keepalive response)
{ "type": "pong", "timestamp": 1706500000000 }

// Error
{ "type": "error", "message": "Max subscriptions reached", "code": "MAX_SUBSCRIPTIONS" }
```

**Example usage (JavaScript):**

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
    console.log(`Price: ${msg.price}, Change: ${msg.price - msg.prevPrice}`);
  } else if (msg.type === 'orderbook') {
    console.log(`Spread: ${msg.spread}, Mid: ${msg.midPrice}`);
  }
};
```

### WS /chat (WebChat)

WebChat WebSocket endpoint used by `/webchat`.

Client messages:
- `auth`: `{ "type": "auth", "token": "<WEBCHAT_TOKEN>", "userId": "web-123" }`
- `message`: `{ "type": "message", "text": "hi", "attachments": [] }`
- `edit`: `{ "type": "edit", "messageId": "<id>", "text": "new text" }`
- `delete`: `{ "type": "delete", "messageId": "<id>" }`

Server messages:
- `connected`, `authenticated`, `ack`, `message`, `edit`, `delete`, `error`

Attachment fields (if provided):
- `type`: `image|video|audio|document|voice|sticker`
- `url` or `data` (base64)
- `mimeType`, `filename`, `size`, `width`, `height`, `duration`, `caption`

---

## Cloudflare Worker API

The lightweight Clodds Worker (`apps/clodds-worker`) exposes a separate REST API on Cloudflare's edge network.

### Base URL

```
https://clodds-worker.<account>.workers.dev
```

### GET /api/health

Health check with service status.

Response:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "timestamp": "2026-01-29T...",
  "services": {
    "telegram": true,
    "discord": false,
    "slack": false,
    "kalshi": true,
    "anthropic": true
  }
}
```

### GET /api/markets/search

Search markets across platforms.

Query parameters:
- `q` or `query` (string, required): search text
- `platform` (string, optional): `polymarket|kalshi|manifold`
- `limit` (number, optional, max 50)

Response:
```json
{
  "markets": [
    {
      "id": "...",
      "platform": "polymarket",
      "question": "Will X happen?",
      "outcomes": [{ "id": "...", "name": "Yes", "price": 0.45 }],
      "volume24h": 12345,
      "url": "https://polymarket.com/..."
    }
  ],
  "count": 10
}
```

### GET /api/markets/:platform/:id

Get a specific market by platform and ID.

Response:
```json
{ "market": { ... } }
```

### GET /api/markets/:platform/:id/orderbook

Get orderbook for a market (Polymarket, Kalshi only).

Response:
```json
{
  "orderbook": {
    "platform": "polymarket",
    "marketId": "...",
    "bids": [[0.45, 1000], [0.44, 500]],
    "asks": [[0.46, 800], [0.47, 1200]],
    "spread": 0.01,
    "midPrice": 0.455,
    "timestamp": 1706500000000
  }
}
```

### GET /api/arbitrage/scan

Scan for arbitrage opportunities.

Query parameters:
- `min_edge` (number, optional): minimum edge % (default 1)
- `platforms` (string, optional): comma-separated list
- `limit` (number, optional, max 50)

Response:
```json
{
  "opportunities": [
    {
      "id": "polymarket-abc123",
      "platform": "polymarket",
      "marketId": "abc123",
      "marketQuestion": "Will X?",
      "yesPrice": 0.48,
      "noPrice": 0.49,
      "edgePct": 0.03,
      "mode": "internal",
      "foundAt": 1706500000000
    }
  ],
  "count": 5,
  "scannedPlatforms": ["polymarket", "kalshi"],
  "minEdge": 1
}
```

### GET /api/arbitrage/recent

Get recently found arbitrage opportunities from database.

Query parameters:
- `limit` (number, optional, max 100)

### Webhook endpoints

- `POST /webhook/telegram` - Telegram Bot API webhook
- `POST /webhook/discord` - Discord Interactions endpoint
- `POST /webhook/slack` - Slack Events API endpoint

See [apps/clodds-worker/README.md](../apps/clodds-worker/README.md) for webhook setup instructions.

---

## Programmatic Trading Modules

The following modules can be imported and used directly in your TypeScript/JavaScript code.

### EVM DEX Trading

```typescript
import { executeUniswapSwap, getUniswapQuote, executeOneInchSwap, compareDexRoutes } from 'clodds/evm';

// Get quote from Uniswap V3
const quote = await getUniswapQuote({
  chain: 'ethereum', // 'ethereum' | 'arbitrum' | 'optimism' | 'base' | 'polygon'
  inputToken: 'USDC',
  outputToken: 'WETH',
  amount: '1000',
  slippageBps: 50,
});

// Execute swap with MEV protection
const result = await executeUniswapSwap({
  chain: 'ethereum',
  inputToken: 'USDC',
  outputToken: 'WETH',
  amount: '1000',
});

// Compare Uniswap vs 1inch for best route
const comparison = await compareDexRoutes({
  chain: 'ethereum',
  fromToken: 'USDC',
  toToken: 'WETH',
  amount: '1000',
});
console.log(`Best route: ${comparison.best}, saves ${comparison.savings}`);
```

### MEV Protection

```typescript
import { createMevProtectionService, sendFlashbotsProtect, submitJitoBundle } from 'clodds/execution/mev-protection';

// Create protection service
const mev = createMevProtectionService({
  level: 'aggressive', // 'none' | 'basic' | 'aggressive'
  maxPriceImpact: 3,
  jitoTipLamports: 10000,
});

// Send EVM transaction via Flashbots Protect
const result = await mev.sendEvmTransaction('ethereum', signedTx);

// Submit Solana bundle via Jito
const bundle = await mev.createSolanaBundle(transactions, payerPubkey);
await mev.submitSolanaBundle(bundle);
```

### Whale Tracking (Polymarket)

```typescript
import { createWhaleTracker, getMarketWhaleActivity } from 'clodds/feeds/polymarket/whale-tracker';

const tracker = createWhaleTracker({
  minTradeSize: 10000,    // $10k minimum
  minPositionSize: 50000, // $50k to track
  enableRealtime: true,
});

tracker.on('trade', (trade) => {
  console.log(`Whale ${trade.side} $${trade.usdValue} on ${trade.marketQuestion}`);
});

tracker.on('positionOpened', (position) => {
  console.log(`New position: ${position.address} - $${position.usdValue}`);
});

await tracker.start();

// Get whale activity for a specific market
const activity = await getMarketWhaleActivity(marketId);
console.log(`Buy volume: $${activity.buyVolume}, Sell volume: $${activity.sellVolume}`);
```

### Crypto Whale Tracking (Multi-Chain)

```typescript
import { createCryptoWhaleTracker } from 'clodds/feeds/crypto/whale-tracker';

const tracker = createCryptoWhaleTracker({
  chains: ['solana', 'ethereum', 'polygon', 'arbitrum', 'base', 'optimism'],
  thresholds: {
    solana: 10000,      // $10k+ on Solana
    ethereum: 50000,    // $50k+ on ETH
    polygon: 5000,      // $5k+ on Polygon
    arbitrum: 10000,
    base: 10000,
    optimism: 10000,
  },
  birdeyeApiKey: process.env.BIRDEYE_API_KEY,  // For Solana
  alchemyApiKey: process.env.ALCHEMY_API_KEY,  // For EVM chains
});

// Real-time transaction events
tracker.on('transaction', (tx) => {
  console.log(`${tx.chain}: ${tx.type} $${tx.usdValue} from ${tx.wallet}`);
  console.log(`  Token: ${tx.token}, Amount: ${tx.amount}`);
});

// Whale alerts (above threshold)
tracker.on('alert', (alert) => {
  console.log(`WHALE ALERT: ${alert.message}`);
});

// Watch specific wallets
tracker.watchWallet('solana', 'ABC123...', { label: 'Known Whale' });
tracker.watchWallet('ethereum', '0x1234...', { label: 'Smart Money' });

await tracker.start();

// Query methods
const topSolWhales = tracker.getTopWhales('solana', 10);
const recentEthTxs = tracker.getRecentTransactions('ethereum', 100);
const wallet = tracker.getWallet('solana', 'ABC123...');
```

**Supported Chains:**
| Chain | Provider | Features |
|-------|----------|----------|
| Solana | Birdeye WebSocket | Token transfers, swaps, NFTs |
| Ethereum | Alchemy WebSocket | ERC-20, ETH transfers |
| Polygon | Alchemy WebSocket | MATIC, tokens |
| Arbitrum | Alchemy WebSocket | L2 activity |
| Base | Alchemy WebSocket | Coinbase L2 |
| Optimism | Alchemy WebSocket | OP ecosystem |

**Transaction Types:** `transfer`, `swap`, `nft`, `stake`, `unknown`

### Copy Trading

```typescript
import { createCopyTradingService, findBestAddressesToCopy } from 'clodds/trading/copy-trading';

// Find profitable addresses to copy
const topTraders = await findBestAddressesToCopy(whaleTracker, {
  minWinRate: 55,
  minTrades: 10,
  minAvgReturn: 5,
});

const copyTrader = createCopyTradingService(whaleTracker, execution, {
  followedAddresses: topTraders.map(t => t.address),
  sizingMode: 'fixed',    // 'fixed' | 'proportional' | 'percentage'
  fixedSize: 100,         // $100 per trade
  maxPositionSize: 500,   // Max $500 per market
  copyDelayMs: 5000,      // 5s delay before copying
  dryRun: true,           // Start in dry run mode
  // Stop-loss / Take-profit monitoring
  stopLossPct: 10,        // Exit at 10% loss
  takeProfitPct: 20,      // Exit at 20% profit
});

copyTrader.on('tradeCopied', (trade) => {
  console.log(`Copied: ${trade.side} ${trade.size} @ ${trade.entryPrice}`);
});

// SL/TP events
copyTrader.on('positionClosed', (trade, reason) => {
  console.log(`Position closed: ${reason} at ${trade.exitPrice}`);
  // reason: 'stop_loss' | 'take_profit' | 'manual'
});

copyTrader.start();

// Follow/unfollow addresses dynamically
copyTrader.follow('0x...');
copyTrader.unfollow('0x...');
```

**SL/TP Monitoring:**
- 5-second price polling interval
- Automatic position exit when thresholds hit
- Events emitted for position closures with reason

### Smart Order Routing

```typescript
import { createSmartRouter, quickPriceCompare } from 'clodds/execution/smart-router';

const router = createSmartRouter(feeds, {
  mode: 'balanced',  // 'best_price' | 'best_liquidity' | 'lowest_fee' | 'balanced'
  enabledPlatforms: ['polymarket', 'kalshi'],
  maxSlippage: 1,
  preferMaker: true,
  allowSplitting: true,
});

// Find best route for an order
const result = await router.findBestRoute({
  marketId: 'trump-win-2024',
  side: 'buy',
  size: 1000,
  limitPrice: 0.52,
});

console.log(`Best platform: ${result.bestRoute.platform}`);
console.log(`Net price: ${result.bestRoute.netPrice}`);
console.log(`Savings: $${result.totalSavings}`);

// Quick price comparison
const prices = await quickPriceCompare(feeds, 'trump-win-2024');
console.log(prices); // { polymarket: 0.52, kalshi: 0.54 }
```

### Authentication (OAuth, Copilot, Google, Qwen)

```typescript
import {
  OAuthClient,
  interactiveOAuth,
  createAnthropicOAuth,
  createOpenAIOAuth,
  createGoogleOAuth
} from 'clodds/auth/oauth';
import { CopilotAuthClient, interactiveCopilotAuth } from 'clodds/auth/copilot';
import { GoogleAuthClient, GeminiClient, interactiveGoogleAuth } from 'clodds/auth/google';
import { QwenAuthClient, QwenClient } from 'clodds/auth/qwen';

// OAuth for Anthropic/OpenAI
const anthropicOAuth = createAnthropicOAuth('client-id', 'client-secret');
const tokens = await interactiveOAuth({
  provider: 'anthropic',
  clientId: 'your-client-id',
  scopes: ['api:read', 'api:write'],
});

// GitHub Copilot authentication
const copilotAuth = new CopilotAuthClient();
await interactiveCopilotAuth(); // Interactive device code flow
const headers = await copilotAuth.getHeaders();

// Google/Gemini authentication
const googleAuth = new GoogleAuthClient({ projectId: 'my-project' });
await interactiveGoogleAuth();
const gemini = new GeminiClient({ projectId: 'my-project' });
const response = await gemini.generateContent('gemini-pro', 'Hello world');

// Qwen/DashScope authentication
const qwen = new QwenClient({ apiKey: process.env.DASHSCOPE_API_KEY });
const result = await qwen.generate('qwen-turbo', 'Hello');
```

### OpenTelemetry Diagnostics

```typescript
import {
  initTelemetry,
  TelemetryService,
  LLMInstrumentation,
  createLLMInstrumentation
} from 'clodds/telemetry';

// Initialize telemetry
const telemetry = initTelemetry({
  enabled: true,
  serviceName: 'clodds',
  otlpEndpoint: 'http://localhost:4318', // OTLP collector
  jaegerEndpoint: 'http://localhost:14268', // Jaeger
  metricsPort: 9090, // Prometheus metrics
  sampleRate: 1.0,
});

// Create LLM instrumentation
const llmInstr = createLLMInstrumentation();

// Trace LLM completion
const { result, span } = await llmInstr.traceCompletion(
  'anthropic',
  'claude-3-5-sonnet',
  () => provider.complete({ model, messages }),
  { inputTokens: 100, userId: 'user-123' }
);

// Record token usage
llmInstr.recordTokenUsage('anthropic', 'claude-3-5-sonnet', 100, 500);

// Manual tracing
const span = telemetry.startTrace('my-operation', { custom: 'attr' });
telemetry.addEvent(span, 'checkpoint');
telemetry.endSpan(span, 'ok');

// Metrics
telemetry.recordCounter('requests_total', 1, { endpoint: '/api' });
telemetry.recordHistogram('request_duration_ms', 150);

// Start Prometheus metrics server
telemetry.startMetricsServer(9090);
```

### Task Runner Extension

```typescript
import { createTaskRunner, TaskRunner, TaskDefinition } from 'clodds/extensions/task-runner';

const runner = createTaskRunner({
  maxConcurrent: 4,
  defaultTimeout: 60000,
  planningModel: 'claude-3-5-sonnet',
}, provider);

// Plan tasks from high-level goal
const tasks = await runner.planTasks('Build a REST API with user authentication');

// Execute tasks with dependency resolution
const results = await runner.executeTasks(tasks, '/path/to/workdir');

// Built-in executors: shell, file, http, llm, transform
const shellTask: TaskDefinition = {
  id: 'build',
  name: 'Build project',
  type: 'atomic',
  executor: 'shell',
  input: { command: 'npm', args: ['run', 'build'] },
};

// Register custom executor
runner.registerExecutor({
  name: 'custom',
  execute: async (task, context) => {
    // Custom logic
    return { success: true };
  },
});
```

### Open Prose Extension

```typescript
import { createOpenProseExtension } from 'clodds/extensions/open-prose';

const prose = await createOpenProseExtension({
  enabled: true,
  enableHistory: true,
  maxHistoryEntries: 100,
});

// Create and edit documents
const doc = await prose.createDocument('My Article', '# Draft\n\nContent here...', 'markdown');
await prose.updateDocument(doc.id, '# Updated\n\nNew content', 'Major revision');

// AI-assisted editing (requires provider)
const { document, changes } = await prose.aiEdit(doc.id, 'Make it more concise', provider);
const completion = await prose.aiComplete(doc.id, 50, provider);
const summary = await prose.aiSummarize(doc.id, provider);
const { document: rewritten } = await prose.aiRewrite(doc.id, 'formal', provider);

// Version history
const history = await prose.getHistory(doc.id);
await prose.restoreVersion(doc.id, 3);

// Export
const html = await prose.exportDocument(doc.id, 'html');
```

### Auto-Arbitrage Execution

```typescript
import { createOpportunityExecutor } from 'clodds/opportunity/executor';

const executor = createOpportunityExecutor(finder, execution, {
  minEdge: 1.0,           // Minimum 1% edge
  minLiquidity: 500,      // Minimum $500 liquidity
  maxPositionSize: 100,   // Max $100 per trade
  maxDailyLoss: 500,      // Stop after $500 daily loss
  maxConcurrentPositions: 3,
  preferMakerOrders: true,
  dryRun: true,           // Start in dry run mode
});

executor.on('executed', (opp, result) => {
  console.log(`Executed: ${opp.id}, profit: $${result.actualProfit}`);
});

executor.on('skipped', (opp, reason) => {
  console.log(`Skipped: ${reason}`);
});

executor.start();

// View stats
const stats = executor.getStats();
console.log(`Win rate: ${stats.winRate}%, Total P&L: $${stats.totalProfit - stats.totalLoss}`);
```

### External Data Feeds

```typescript
import {
  getFedWatchProbabilities,
  get538Probability,
  getRCPPollingAverage,
  analyzeEdge,
  calculateKelly
} from 'clodds/feeds/external';

// Get Fed rate probabilities
const fedWatch = await getFedWatchProbabilities();
console.log(fedWatch.get('January 2026')); // 0.85

// Get election model probability
const model = await get538Probability('Trump president');
console.log(model?.probability); // 0.52

// Get polling average
const polls = await getRCPPollingAverage('Trump vs Biden');
console.log(polls?.probability); // 0.48

// Analyze edge vs market price
const edge = await analyzeEdge(
  'market-123',
  'Will Trump win?',
  0.45,  // market price
  'politics'
);
console.log(`Fair value: ${edge.fairValue}, Edge: ${edge.edgePct}%`);

// Calculate Kelly bet size
const kelly = calculateKelly(0.45, 0.52, 10000);
console.log(`Half Kelly: $${kelly.halfKelly}`);
```

---

# Clodds Compute API

The Compute API allows agents to pay for compute resources with USDC. No API keys needed - just a wallet.

## Base URL

```
https://api.cloddsbot.com
```

## Authentication

No API keys required. Agents authenticate by:
1. Depositing USDC to the treasury wallet on any supported network
2. Including payment proof in requests

**Treasury wallet:** Set via `CLODDS_TREASURY_WALLET` env var on the server.

**Supported networks:** Base, Ethereum, Polygon (USDC)

## Rate Limiting

- **Per-wallet:** 60 requests/minute
- **Per-IP:** 100 requests/minute

Rate limit headers are included in responses:
- `X-RateLimit-Remaining`: Remaining requests in window
- `Retry-After`: Seconds to wait (when rate limited)

## Endpoints

### GET /v1/health

Health check and service info.

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

Get pricing for all compute services.

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
  },
  "gpu": {
    "service": "gpu",
    "basePrice": 0,
    "unit": "second",
    "pricePerUnit": 0.01,
    "minCharge": 0.1,
    "maxCharge": 100
  },
  "ml": {
    "service": "ml",
    "basePrice": 0.01,
    "unit": "request",
    "pricePerUnit": 0.01,
    "minCharge": 0.01,
    "maxCharge": 1
  }
}
```

### GET /v1/metrics

Get API metrics and statistics.

**Response:**
```json
{
  "uptime": 123456,
  "totalRequests": 1500,
  "totalRevenue": 45.50,
  "activeJobs": 2,
  "jobsByStatus": {
    "pending": 1,
    "processing": 1,
    "completed": 1450,
    "failed": 48
  },
  "requestsByService": {
    "llm": 1200,
    "code": 200,
    "web": 100
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

Deposit credits to a wallet.

**Request body:**
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

### GET /v1/usage/:wallet

Get usage statistics for a wallet.

**Query parameters:**
- `period` (optional): `day`, `week`, `month`, or `all` (default: `all`)

**Response:**
```json
{
  "wallet": "0x...",
  "period": "week",
  "byService": {
    "llm": {
      "requests": 50,
      "cost": 2.50,
      "avgDuration": 1500
    },
    "code": {
      "requests": 10,
      "cost": 0.50,
      "avgDuration": 3000
    }
  },
  "totalCost": 3.00,
  "totalRequests": 60
}
```

### GET /v1/jobs/:wallet

List jobs for a wallet.

**Query parameters:**
- `limit` (optional): Max results (default: 50, max: 100)

**Response:**
```json
{
  "jobs": [
    {
      "id": "req_123",
      "jobId": "job_456",
      "service": "llm",
      "status": "completed",
      "cost": 0.05,
      "timestamp": 1706500000000
    }
  ],
  "count": 1
}
```

### GET /v1/job/:jobId

Get status of an async compute job.

**Headers:**
- `X-Wallet-Address` (optional): Wallet address for ownership verification

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
  "usage": {
    "units": 1500,
    "unitType": "token",
    "durationMs": 2300,
    "breakdown": {
      "base": 0,
      "usage": 0.0045,
      "total": 0.0045
    }
  },
  "timestamp": 1706500000000
}
```

**Status values:** `pending`, `processing`, `completed`, `failed`

### DELETE /v1/job/:jobId

Cancel a pending job and refund the reserved balance.

**Headers:**
- `X-Wallet-Address` (required): Wallet address for ownership verification

**Response:**
```json
{
  "success": true,
  "jobId": "job_456"
}
```

**Note:** Only pending jobs can be cancelled. Processing/completed jobs cannot be cancelled.

### POST /v1/compute/:service

Submit a compute request. Replace `:service` with: `llm`, `code`, `web`, `trade`, `data`, or `storage`.

**Request body:**
```json
{
  "wallet": "0x...",
  "payload": { ... },
  "paymentProof": {
    "txHash": "0x...",
    "network": "base",
    "amountUsd": 10.00,
    "token": "USDC",
    "timestamp": 1706500000000
  },
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

**Available models:**
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

**Supported languages:** `python`, `javascript`, `typescript`, `rust`, `go`, `bash`

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

**Data types:** `price`, `orderbook`, `candles`, `trades`, `markets`, `positions`, `balance`, `news`, `sentiment`

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

## Payment Flow

1. **Deposit USDC** to the treasury wallet on Base network
2. **Include payment proof** in your first request:
   ```json
   {
     "paymentProof": {
       "txHash": "0x...",
       "network": "base",
       "amountUsd": 10.00,
       "token": "USDC",
       "timestamp": 1706500000000
     }
   }
   ```
3. **API verifies on-chain** and credits your balance
4. **Subsequent requests** just need your wallet address - balance is tracked server-side

## Error Responses

```json
{
  "id": "req_123",
  "jobId": "job_456",
  "service": "llm",
  "status": "failed",
  "error": "Insufficient balance. Need $0.05, have $0.00",
  "cost": 0,
  "timestamp": 1706500000000
}
```

## Webhooks

If you provide a `callbackUrl`, the API will POST results when jobs complete:

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

The webhook includes an `X-Clodds-Signature` header (HMAC-SHA256) for verification.

## Streaming LLM Endpoint

### POST /v1/stream/llm

Stream LLM responses via Server-Sent Events (SSE). This endpoint streams text chunks in real-time as the model generates them.

**Request body:**
```json
{
  "wallet": "0x...",
  "payload": {
    "model": "claude-sonnet-4-20250514",
    "messages": [
      { "role": "user", "content": "Write a poem about coding" }
    ],
    "system": "You are a creative writer",
    "maxTokens": 1000,
    "temperature": 0.7
  }
}
```

**Response:** Server-Sent Events stream

```
data: {"type": "start", "requestId": "req_123"}

data: {"type": "text", "text": "In "}

data: {"type": "text", "text": "the "}

data: {"type": "text", "text": "realm "}

data: {"type": "text", "text": "of "}

data: {"type": "text", "text": "code..."}

data: {"type": "usage", "usage": {"inputTokens": 25, "outputTokens": 150}}

data: {"type": "done", "response": {"content": "In the realm of code...", "model": "claude-sonnet-4-20250514", "usage": {"inputTokens": 25, "outputTokens": 150}, "stopReason": "end_turn"}}
```

**Event types:**
- `start`: Stream initiated, includes requestId
- `text`: Text chunk from the model
- `usage`: Token usage statistics
- `error`: Error occurred
- `done`: Stream complete, includes full response

**JavaScript example:**
```javascript
const response = await fetch('https://api.cloddsbot.com/v1/stream/llm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    wallet: '0x...',
    payload: {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }]
    }
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  const lines = chunk.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      if (data.type === 'text') {
        process.stdout.write(data.text);
      }
    }
  }
}
```

**Supported streaming models:**
- All Claude models (via Anthropic streaming API)
- All GPT models (via OpenAI streaming API)
- All Together models (Llama, Mixtral)
