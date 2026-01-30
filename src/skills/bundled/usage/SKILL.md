---
name: usage
description: "Token usage tracking, cost estimation, and usage analytics"
emoji: "📊"
---

# Usage - Complete API Reference

Track token usage, estimate costs, and analyze AI consumption across sessions and users.

---

## Chat Commands

### View Usage

```
/usage                                      Current session usage
/usage today                                Today's total usage
/usage week                                 This week's usage
/usage month                                This month's usage
```

### Detailed Breakdown

```
/usage by-model                             Usage by AI model
/usage by-user                              Usage by user (admin)
/usage by-session                           Usage by session
/usage history                              Historical usage
```

### Cost Tracking

```
/usage cost                                 Estimated costs
/usage cost today                           Today's cost
/usage cost month                           Monthly cost
/usage budget                               Check against budget
```

### Settings

```
/usage footer on                            Show usage in responses
/usage footer tokens                        Show token counts only
/usage footer full                          Show tokens + cost
/usage footer off                           Hide usage footer
```

---

## TypeScript API Reference

### Create Usage Service

```typescript
import { createUsageService } from 'clodds/usage';

const usage = createUsageService({
  // Storage
  storage: 'sqlite',  // 'sqlite' | 'postgres' | 'memory'
  dbPath: './usage.db',

  // Pricing (per 1M tokens)
  pricing: {
    'claude-3-opus': { input: 15.00, output: 75.00 },
    'claude-3-sonnet': { input: 3.00, output: 15.00 },
    'claude-3-haiku': { input: 0.25, output: 1.25 },
    'gpt-4': { input: 30.00, output: 60.00 },
    'gpt-4o': { input: 5.00, output: 15.00 },
  },

  // Footer mode
  footerMode: 'tokens',  // 'off' | 'tokens' | 'full'
});
```

### Record Usage

```typescript
// Record a request
await usage.record({
  userId: 'user-123',
  sessionId: 'session-456',
  model: 'claude-3-sonnet',
  inputTokens: 1500,
  outputTokens: 800,
  durationMs: 2300,
  cached: false,
});
```

### Get Session Usage

```typescript
const session = await usage.getSessionUsage('session-456');

console.log(`Session: ${session.sessionId}`);
console.log(`Requests: ${session.requests}`);
console.log(`Input tokens: ${session.inputTokens.toLocaleString()}`);
console.log(`Output tokens: ${session.outputTokens.toLocaleString()}`);
console.log(`Total tokens: ${session.totalTokens.toLocaleString()}`);
console.log(`Est. cost: $${session.estimatedCost.toFixed(4)}`);
console.log(`Duration: ${session.totalDurationMs}ms`);
```

### Get User Usage

```typescript
const user = await usage.getUserUsage('user-123', {
  period: 'month',  // 'day' | 'week' | 'month' | 'all'
});

console.log(`User: ${user.userId}`);
console.log(`Sessions: ${user.sessions}`);
console.log(`Total tokens: ${user.totalTokens.toLocaleString()}`);
console.log(`Est. cost: $${user.estimatedCost.toFixed(2)}`);
```

### Get Total Usage

```typescript
const total = await usage.getTotalUsage({
  from: '2024-01-01',
  to: '2024-01-31',
});

console.log(`Total requests: ${total.requests}`);
console.log(`Total tokens: ${total.totalTokens.toLocaleString()}`);
console.log(`Total cost: $${total.estimatedCost.toFixed(2)}`);
```

### Usage by Model

```typescript
const byModel = await usage.getUsageByModel({
  period: 'month',
});

for (const [model, stats] of Object.entries(byModel)) {
  console.log(`${model}:`);
  console.log(`  Requests: ${stats.requests}`);
  console.log(`  Tokens: ${stats.totalTokens.toLocaleString()}`);
  console.log(`  Cost: $${stats.cost.toFixed(2)}`);
}
```

### Format Footer

```typescript
// Get formatted usage footer for messages
const footer = usage.formatFooter({
  inputTokens: 1500,
  outputTokens: 800,
  model: 'claude-3-sonnet',
});

// Output: "Tokens: 1.5k in / 800 out | Cost: ~$0.02"
```

### Format Summary

```typescript
// Get formatted summary
const summary = await usage.formatSummary({
  userId: 'user-123',
  period: 'today',
});

console.log(summary);
// "Today: 15 requests | 45k tokens | ~$0.85"
```

### Estimate Cost

```typescript
// Estimate cost for a request
const cost = usage.estimateCost({
  model: 'claude-3-opus',
  inputTokens: 5000,
  outputTokens: 2000,
});

console.log(`Estimated cost: $${cost.toFixed(4)}`);
```

---

## Model Pricing (per 1M tokens)

| Model | Input | Output |
|-------|-------|--------|
| **claude-3-opus** | $15.00 | $75.00 |
| **claude-3-sonnet** | $3.00 | $15.00 |
| **claude-3-haiku** | $0.25 | $1.25 |
| **gpt-4** | $30.00 | $60.00 |
| **gpt-4o** | $5.00 | $15.00 |
| **gpt-4o-mini** | $0.15 | $0.60 |

---

## Footer Modes

| Mode | Output |
|------|--------|
| `off` | No usage shown |
| `tokens` | `Tokens: 1.5k in / 800 out` |
| `full` | `Tokens: 1.5k in / 800 out | Cost: ~$0.02` |

---

## Budget Alerts

```typescript
// Set monthly budget
usage.setBudget({
  userId: 'user-123',
  monthly: 50.00,  // $50/month
  alertAt: [0.5, 0.8, 0.95],  // Alert at 50%, 80%, 95%
});

// Check budget status
const budget = await usage.checkBudget('user-123');

console.log(`Budget: $${budget.limit}`);
console.log(`Used: $${budget.used.toFixed(2)} (${budget.percent}%)`);
console.log(`Remaining: $${budget.remaining.toFixed(2)}`);
```

---

## Best Practices

1. **Monitor regularly** — Check usage weekly
2. **Set budgets** — Prevent unexpected costs
3. **Use appropriate models** — Haiku for simple tasks
4. **Cache when possible** — Reduce duplicate queries
5. **Review by user** — Identify heavy users
