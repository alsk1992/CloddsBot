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

## WebSocket endpoints

### WS /ws

Development WebSocket endpoint. Currently echoes incoming JSON with a wrapper:

```
{ "type": "res", "id": "<client id>", "ok": true, "payload": { "echo": <message> } }
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
