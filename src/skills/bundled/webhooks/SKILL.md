---
name: webhooks
description: "Incoming webhooks for custom data and signal ingestion"
emoji: "🪝"
---

# Webhooks - Complete API Reference

Create incoming webhook endpoints to receive external signals, data, and trigger actions.

---

## Chat Commands

### Create Webhooks

```
/webhook create trading-signals             Create new webhook
/webhook create alerts --secret abc123      With custom secret
/webhook list                               List all webhooks
```

### Manage Webhooks

```
/webhook info <name>                        View webhook details
/webhook url <name>                         Get webhook URL
/webhook regenerate <name>                  New URL/secret
/webhook delete <name>                      Remove webhook
```

### Testing

```
/webhook test <name>                        Send test payload
/webhook test <name> '{"signal":"BUY"}'     Custom test payload
/webhook logs <name>                        View recent payloads
/webhook debug <name>                       Enable debug mode
```

### Actions

```
/webhook action <name> add notify           Add action on trigger
/webhook action <name> add execute          Add trading action
/webhook action <name> remove <id>          Remove action
/webhook action <name> list                 List actions
```

---

## TypeScript API Reference

### Create Webhook Manager

```typescript
import { createWebhookManager } from 'clodds/webhooks';

const webhooks = createWebhookManager({
  // Base URL for webhooks
  baseUrl: 'https://your-domain.com',

  // Default settings
  defaultSecret: process.env.WEBHOOK_SECRET,
  validateSignatures: true,

  // Storage
  storage: 'sqlite',
  dbPath: './webhooks.db',

  // Logging
  logPayloads: true,
  maxLogEntries: 1000,
});
```

### Create Webhook

```typescript
// Create simple webhook
const hook = await webhooks.create({
  name: 'trading-signals',
  description: 'Receive external trading signals',
});

console.log(`Webhook URL: ${hook.url}`);
console.log(`Secret: ${hook.secret}`);

// Create with schema validation
const hook = await webhooks.create({
  name: 'price-alerts',
  description: 'Price alert triggers',
  schema: {
    type: 'object',
    properties: {
      symbol: { type: 'string' },
      price: { type: 'number' },
      direction: { enum: ['above', 'below'] },
    },
    required: ['symbol', 'price', 'direction'],
  },
});
```

### Handle Webhook

```typescript
// Register handler
webhooks.onReceive('trading-signals', async (payload, metadata) => {
  console.log(`Received signal: ${JSON.stringify(payload)}`);
  console.log(`From IP: ${metadata.ip}`);
  console.log(`Timestamp: ${metadata.timestamp}`);

  // Process the signal
  if (payload.action === 'BUY') {
    await tradingBot.buy(payload.symbol, payload.amount);
  }

  // Return response
  return { status: 'processed', id: metadata.id };
});
```

### Add Actions

```typescript
// Add notification action
await webhooks.addAction('trading-signals', {
  type: 'notify',
  channels: ['telegram', 'discord'],
  template: 'New signal: {{action}} {{symbol}} @ {{price}}',
});

// Add trading action
await webhooks.addAction('trading-signals', {
  type: 'execute',
  condition: (payload) => payload.confidence > 0.8,
  action: async (payload) => {
    return await tradingBot.execute({
      platform: 'polymarket',
      market: payload.market,
      side: payload.side,
      size: payload.size,
    });
  },
});

// Add logging action
await webhooks.addAction('trading-signals', {
  type: 'log',
  destination: 'database',
  table: 'signal_history',
});
```

### Get Webhook Info

```typescript
const info = await webhooks.get('trading-signals');

console.log(`Name: ${info.name}`);
console.log(`URL: ${info.url}`);
console.log(`Created: ${info.createdAt}`);
console.log(`Triggers: ${info.triggerCount}`);
console.log(`Last trigger: ${info.lastTrigger}`);
console.log(`Actions: ${info.actions.length}`);
```

### View Logs

```typescript
// Get recent payloads
const logs = await webhooks.getLogs('trading-signals', {
  limit: 50,
  since: Date.now() - 24 * 60 * 60 * 1000,  // Last 24h
});

for (const log of logs) {
  console.log(`[${log.timestamp}] ${log.status}`);
  console.log(`  Payload: ${JSON.stringify(log.payload)}`);
  console.log(`  Response: ${JSON.stringify(log.response)}`);
}
```

### Test Webhook

```typescript
// Send test payload
const result = await webhooks.test('trading-signals', {
  action: 'BUY',
  symbol: 'BTC',
  price: 100000,
  confidence: 0.95,
});

console.log(`Test result: ${result.status}`);
console.log(`Response: ${JSON.stringify(result.response)}`);
```

### Delete Webhook

```typescript
await webhooks.delete('trading-signals');
```

---

## Webhook Security

### Signature Validation

```typescript
// Webhooks use HMAC-SHA256 signatures
// Header: X-Webhook-Signature: sha256=<signature>

// Verify in your sender:
const crypto = require('crypto');
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(JSON.stringify(payload))
  .digest('hex');

fetch(webhookUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': `sha256=${signature}`,
  },
  body: JSON.stringify(payload),
});
```

### IP Allowlist

```typescript
const hook = await webhooks.create({
  name: 'secure-signals',
  allowedIps: ['192.168.1.0/24', '10.0.0.1'],
});
```

---

## Sending Webhooks (External)

```bash
# Send signal to your webhook
curl -X POST https://your-domain.com/webhooks/trading-signals \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=<signature>" \
  -d '{"action": "BUY", "symbol": "TRUMP-YES", "size": 100}'
```

```python
# Python example
import requests
import hmac
import hashlib
import json

payload = {"action": "BUY", "symbol": "TRUMP-YES", "size": 100}
secret = "your-webhook-secret"
signature = hmac.new(
    secret.encode(),
    json.dumps(payload).encode(),
    hashlib.sha256
).hexdigest()

requests.post(
    "https://your-domain.com/webhooks/trading-signals",
    json=payload,
    headers={"X-Webhook-Signature": f"sha256={signature}"}
)
```

---

## Action Types

| Type | Description |
|------|-------------|
| `notify` | Send notification to channels |
| `execute` | Execute trading action |
| `log` | Log to database |
| `forward` | Forward to another webhook |
| `custom` | Custom function |

---

## Best Practices

1. **Always use signatures** — Validate webhook authenticity
2. **Schema validation** — Reject malformed payloads
3. **Idempotency** — Handle duplicate deliveries
4. **Logging** — Keep payload history for debugging
5. **Rate limiting** — Protect against floods
6. **Error handling** — Return proper status codes
