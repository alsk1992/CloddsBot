---
name: auto-reply
description: "Create automatic response rules with keyword matching, regex patterns, cooldowns, and conditional triggers. Use when users want to set up auto-replies, scheduled messages, or pattern-based bot responses."
emoji: "🤖"
---

# Auto-Reply - Complete API Reference

Create rules for automatic responses based on patterns, keywords, and conditions.

---

## Chat Commands

### List Rules

```
/autoreply list                             List all rules
/autoreply active                           Show active rules only
/autoreply stats                            Rule statistics
```

### Create Rules

```
/autoreply add <pattern> <response>         Simple keyword match
/autoreply add-regex <regex> <response>     Regex pattern
/autoreply add-keywords <kw1,kw2> <resp>    Keyword rule
```

### Manage Rules

```
/autoreply enable <id>                      Enable rule
/autoreply disable <id>                     Disable rule
/autoreply remove <id>                      Remove rule
/autoreply edit <id> <new-response>         Update response
/autoreply get <id>                         Rule details
```

### Testing

```
/autoreply test <message>                   Test which rules match
/autoreply simulate <message>               Preview response
```

### Advanced

```
/autoreply cooldown <id> <seconds>          Set cooldown
/autoreply schedule <id> <start-end>        Active hours (e.g. 9-17)
/autoreply priority <id> <number>           Set priority (higher first)
/autoreply channel <id> <channel>           Restrict to channel
/autoreply clear-cooldowns                  Clear all cooldowns
/autoreply reload                           Reload rules from disk
```

---

## TypeScript API Reference

### Create Auto-Reply Manager

```typescript
import { createAutoReplyManager } from 'clodds/auto-reply';

const autoReply = createAutoReplyManager({
  // Storage
  storage: 'sqlite',
  dbPath: './auto-reply.db',

  // Defaults
  defaultCooldownMs: 0,
  defaultPriority: 0,

  // Limits
  maxRulesPerUser: 100,
  maxResponseLength: 2000,
});
```

### Add Simple Rule

```typescript
// Keyword match
await autoReply.addRule({
  name: 'greeting',
  pattern: {
    type: 'keyword',
    value: 'hello',
    caseSensitive: false,
  },
  response: 'Hi there! How can I help?',
});
```

### Add Regex Rule

```typescript
// Regex pattern
await autoReply.addRule({
  name: 'price-query',
  pattern: {
    type: 'regex',
    value: /price\s+(btc|eth|sol)/i,
  },
  response: async (match, ctx) => {
    const symbol = match[1].toUpperCase();
    const price = await getPrice(symbol);
    return `${symbol} price: $${price}`;
  },
});
```

### Add Conditional Rule

```typescript
// With conditions
await autoReply.addRule({
  name: 'trading-hours',
  pattern: {
    type: 'keyword',
    value: 'trade',
  },
  conditions: [
    // Only during market hours
    {
      type: 'time',
      start: '09:30',
      end: '16:00',
      timezone: 'America/New_York',
    },
    // Only on weekdays
    {
      type: 'day',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    },
    // Only for certain users
    {
      type: 'user',
      userIds: ['user-123', 'user-456'],
    },
  ],
  response: 'Markets are open! What would you like to trade?',
  elseResponse: 'Markets are closed. Try again during trading hours.',
});
```

### Add Cooldown

```typescript
// Prevent spam
await autoReply.addRule({
  name: 'faq',
  pattern: {
    type: 'keyword',
    value: 'faq',
  },
  response: 'Check our FAQ at https://...',
  cooldown: {
    perUser: 60000,    // 60s per user
    perChannel: 10000, // 10s per channel
    global: 5000,      // 5s global
  },
});
```

### Dynamic Responses

```typescript
// Response with variables
await autoReply.addRule({
  name: 'welcome',
  pattern: {
    type: 'exact',
    value: '!welcome',
  },
  response: 'Welcome {{user.name}}! You joined {{user.joinDate}}.',
  variables: {
    'user.name': (ctx) => ctx.user.displayName,
    'user.joinDate': (ctx) => ctx.user.createdAt.toDateString(),
  },
});

// Response with API call
await autoReply.addRule({
  name: 'portfolio',
  pattern: {
    type: 'keyword',
    value: 'portfolio',
  },
  response: async (match, ctx) => {
    const portfolio = await getPortfolio(ctx.user.id);
    return `Your portfolio: $${portfolio.totalValue.toFixed(2)}`;
  },
});
```

### List Rules

```typescript
const rules = await autoReply.listRules();

for (const rule of rules) {
  console.log(`${rule.id}: ${rule.name}`);
  console.log(`  Pattern: ${rule.pattern.value}`);
  console.log(`  Enabled: ${rule.enabled}`);
  console.log(`  Triggers: ${rule.triggerCount}`);
}
```

### Test Rule

```typescript
// Test which rules would match
const matches = await autoReply.test('hello world', {
  userId: 'user-123',
  channelId: 'telegram-456',
});

for (const match of matches) {
  console.log(`Rule: ${match.rule.name}`);
  console.log(`Response: ${match.response}`);
}
```

### Enable/Disable

```typescript
await autoReply.enable('rule-id');
await autoReply.disable('rule-id');
```

### Delete Rule

```typescript
await autoReply.deleteRule('rule-id');
```

---

## Pattern Types

| Type | Example | Description |
|------|---------|-------------|
| `keyword` | `hello` | Contains keyword |
| `exact` | `!help` | Exact match only |
| `regex` | `/price\s+\w+/i` | Regular expression |
| `startsWith` | `!` | Starts with prefix |
| `endsWith` | `?` | Ends with suffix |

---

## Condition Types

| Type | Description |
|------|-------------|
| `time` | Active during time window |
| `day` | Active on specific days |
| `user` | Only for specific users |
| `channel` | Only in specific channels |
| `role` | Only for users with role |
| `custom` | Custom function |

---

## Response Variables

| Variable | Description |
|----------|-------------|
| `{{user.name}}` | User display name |
| `{{user.id}}` | User ID |
| `{{channel.name}}` | Channel name |
| `{{match[0]}}` | Full regex match |
| `{{match[1]}}` | First capture group |
| `{{date}}` | Current date |
| `{{time}}` | Current time |

---

## Best Practices

1. **Use priorities** — Important rules first
2. **Set cooldowns** — Prevent spam
3. **Test patterns** — Verify before enabling
4. **Use conditions** — Context-aware responses
5. **Monitor triggers** — Check rule effectiveness
