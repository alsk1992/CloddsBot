---
name: routing
description: "Multi-agent routing, channel bindings, and tool policies"
emoji: "🔀"
---

# Routing - Complete API Reference

Route messages to specialized agents, configure channel bindings, and manage tool access policies.

---

## Chat Commands

### Agent Management

```
/agents                                     List available agents
/agent trading                              Switch to trading agent
/agent research                             Switch to research agent
/agent main                                 Switch to main agent
/agent status                               Current agent info
```

### Channel Bindings

```
/bind trading                               Bind channel to trading agent
/bind research                              Bind channel to research agent
/unbind                                     Remove channel binding
/bindings                                   List all bindings
```

### Tool Policies (Admin)

```
/tools                                      List available tools
/tools allow <agent> <tool>                 Allow tool for agent
/tools deny <agent> <tool>                  Deny tool for agent
/tools policy <agent>                       View agent's tool policy
```

---

## TypeScript API Reference

### Create Routing Service

```typescript
import { createRoutingService } from 'clodds/routing';

const routing = createRoutingService({
  // Default agent
  defaultAgent: 'main',

  // Agent definitions
  agents: {
    main: {
      name: 'Main',
      description: 'General assistant',
      model: 'claude-3-sonnet',
      systemPrompt: 'You are a helpful trading assistant...',
      allowedTools: ['*'],  // All tools
    },
    trading: {
      name: 'Trading',
      description: 'Order execution specialist',
      model: 'claude-3-haiku',
      systemPrompt: 'You execute trades efficiently...',
      allowedTools: ['execute', 'portfolio', 'markets', 'feeds'],
    },
    research: {
      name: 'Research',
      description: 'Market analysis expert',
      model: 'claude-3-opus',
      systemPrompt: 'You provide deep market analysis...',
      allowedTools: ['web-search', 'web-fetch', 'markets', 'news'],
    },
    alerts: {
      name: 'Alerts',
      description: 'Notification handler',
      model: 'claude-3-haiku',
      systemPrompt: 'You manage price alerts...',
      allowedTools: ['alerts', 'feeds'],
    },
  },

  // Storage
  storage: 'sqlite',
  dbPath: './routing.db',
});
```

### Route Message

```typescript
// Route determines best agent
const route = await routing.route({
  message: 'Buy 100 shares of Trump YES',
  channelId: 'telegram-123',
  userId: 'user-456',
});

console.log(`Routed to: ${route.agent}`);
console.log(`Confidence: ${route.confidence}`);
console.log(`Reason: ${route.reason}`);
```

### Get Available Agents

```typescript
const agents = routing.getAgents();

for (const [id, agent] of Object.entries(agents)) {
  console.log(`${id}: ${agent.name}`);
  console.log(`  ${agent.description}`);
  console.log(`  Model: ${agent.model}`);
  console.log(`  Tools: ${agent.allowedTools.join(', ')}`);
}
```

### Add Custom Agent

```typescript
routing.addAgent({
  id: 'defi',
  name: 'DeFi Specialist',
  description: 'Solana and EVM DeFi expert',
  model: 'claude-3-sonnet',
  systemPrompt: 'You are an expert in DeFi protocols...',
  allowedTools: ['solana', 'evm', 'bridge', 'portfolio'],
  patterns: [
    /swap|dex|liquidity|pool/i,
    /solana|jupiter|raydium/i,
    /uniswap|1inch|bridge/i,
  ],
});
```

### Update Agent

```typescript
routing.updateAgent('trading', {
  model: 'claude-3-sonnet',  // Upgrade model
  allowedTools: [...currentTools, 'futures'],
});
```

### Channel Bindings

```typescript
// Bind channel to specific agent
await routing.addBinding({
  channelId: 'telegram-trading-group',
  agentId: 'trading',
});

// Get binding for channel
const binding = await routing.getBinding('telegram-trading-group');
console.log(`Channel bound to: ${binding?.agentId || 'default'}`);

// List all bindings
const bindings = await routing.getBindings();
for (const b of bindings) {
  console.log(`${b.channelId} → ${b.agentId}`);
}

// Remove binding
await routing.removeBinding('telegram-trading-group');
```

### Tool Policies

```typescript
// Check if tool is allowed for agent
const allowed = routing.isToolAllowed('trading', 'web-search');
console.log(`web-search allowed for trading: ${allowed}`);

// Get allowed tools for agent
const tools = routing.getAllowedTools('trading');
console.log(`Trading agent tools: ${tools.join(', ')}`);

// Update tool policy
routing.setToolPolicy('trading', {
  allow: ['execute', 'portfolio', 'futures'],
  deny: ['web-search', 'browser'],
});
```

---

## Built-in Agents

| Agent | Model | Purpose | Tools |
|-------|-------|---------|-------|
| **main** | Sonnet | General assistant | All |
| **trading** | Haiku | Fast order execution | Execute, Portfolio |
| **research** | Opus | Deep analysis | Search, Fetch, News |
| **alerts** | Haiku | Notifications | Alerts, Feeds |

---

## Routing Rules

Messages are routed based on:

1. **Channel binding** — If channel is bound, use that agent
2. **Pattern matching** — Match against agent patterns
3. **Keyword detection** — Trading terms → trading agent
4. **Default fallback** — Use main agent

### Pattern Examples

```typescript
{
  trading: [/buy|sell|order|position|close/i],
  research: [/analyze|research|explain|why/i],
  alerts: [/alert|notify|when|watch/i],
}
```

---

## Tool Categories

| Category | Tools |
|----------|-------|
| **Execution** | execute, portfolio, markets |
| **Data** | feeds, news, web-search, web-fetch |
| **Crypto** | solana, evm, bridge |
| **System** | files, browser, docker |

---

## Workspace Isolation

Each agent can have isolated workspace:

```typescript
routing.addAgent({
  id: 'research',
  workspace: {
    directory: '/tmp/research',
    allowedPaths: ['/tmp/research/**'],
    sandboxed: true,
  },
});
```

---

## Best Practices

1. **Use fast models for trading** — Haiku for time-sensitive operations
2. **Restrict tools appropriately** — Trading agent doesn't need browser
3. **Channel bindings** — Dedicated channels for specific workflows
4. **Custom agents** — Create specialized agents for your use case
5. **Monitor routing** — Check logs to see routing decisions
