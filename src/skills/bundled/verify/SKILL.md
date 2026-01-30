---
name: verify
description: "Verify agent identity using ERC-8004 on-chain registry"
emoji: "🔐"
---

# Verify - Agent Identity Verification

Verify any agent's on-chain identity using ERC-8004. Prevents impersonation attacks.

## Why This Matters

On January 29, 2026, an agent named "samaltman" attempted to hijack bots via prompt injection. Anyone can claim to be anyone. ERC-8004 provides cryptographic proof of identity.

---

## Chat Commands

### Verify Agent

```
/verify 1234                           # Verify agent by ID
/verify 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7  # Verify by address
/verify eip155:8453:0x7177...Dd09A:1234             # Full format
```

### Check Before Copy Trading

```
/verify trader 0x123...                # Verify trader before copying
/verify whale 0xabc...                 # Verify whale identity
```

### Register Clodds

```
/verify register                       # Register this Clodds instance
/verify register --name "MyBot"        # With custom name
```

### Stats

```
/verify stats                          # Show total registered agents
/verify reputation 1234                # Get agent's reputation score
```

---

## TypeScript API

### Quick Verification

```typescript
import { verifyAgent, hasIdentity } from 'clodds/identity';

// Verify by agent ID
const result = await verifyAgent(1234);
if (result.verified) {
  console.log(`Verified: ${result.name}`);
  console.log(`Owner: ${result.owner}`);
  console.log(`Reputation: ${result.reputation?.averageScore}/100`);
}

// Check if address has identity
const hasId = await hasIdentity('0x742d35Cc...');
```

### Full Client

```typescript
import { createERC8004Client } from 'clodds/identity';

const client = createERC8004Client('base-sepolia');

// Get agent details
const agent = await client.getAgent(1234);
console.log(agent?.card?.name);
console.log(agent?.card?.description);

// Verify ownership
const isOwner = await client.verifyOwnership(1234, '0x742...');

// Get reputation
const rep = await client.getReputation(1234);
console.log(`Score: ${rep?.averageScore}/100 (${rep?.feedbackCount} reviews)`);

// Give feedback
const txHash = await client.giveFeedback(1234, 85, 'Great trading signals');
```

### Register Agent

```typescript
import { createERC8004Client, buildAgentCard } from 'clodds/identity';

const client = createERC8004Client('base-sepolia', process.env.PRIVATE_KEY);

// Build agent card
const card = buildAgentCard({
  name: 'Clodds Trading Bot',
  description: 'AI-powered prediction market assistant',
  walletAddress: '0x742d35Cc...',
  apiEndpoint: 'https://api.cloddsbot.com/agent',
});

// Upload to IPFS (use Pinata, web3.storage, etc.)
const ipfsUri = await uploadToIPFS(card);

// Register on-chain
const { agentId, txHash } = await client.register(ipfsUri);
console.log(`Registered as agent #${agentId}`);
```

---

## Contract Addresses

Same on all EVM chains (CREATE2 deterministic):

| Contract | Address |
|----------|---------|
| Identity Registry | `0x7177a6867296406881E20d6647232314736Dd09A` |
| Reputation Registry | `0xB5048e3ef1DA4E04deB6f7d0423D06F63869e322` |
| Validation Registry | `0x662b40A526cb4017d947e71eAF6753BF3eeE66d8` |

**Live on:** Ethereum Sepolia, Base Sepolia, Optimism Sepolia

---

## Supported Networks

| Network | Status |
|---------|--------|
| Base Sepolia | Live |
| Ethereum Sepolia | Live |
| Optimism Sepolia | Live |
| Base Mainnet | Pending |
| Ethereum Mainnet | Pending |

---

## Use Cases

### Copy Trading Verification

Before copying a trader, verify their identity:

```typescript
const result = await verifyAgent(traderAgentId);
if (!result.verified) {
  console.warn('UNVERIFIED TRADER - Proceed with caution');
}
if (result.reputation?.averageScore < 50) {
  console.warn('LOW REPUTATION - Consider skipping');
}
```

### Whale Tracking

Verify whale identity claims:

```typescript
const isVerified = await hasIdentity(whaleAddress);
// Only trust signals from verified whales
```

### Bot-to-Bot Communication

Verify other agents before interaction:

```typescript
const agent = await client.getAgent(otherAgentId);
if (agent?.card?.endpoints?.find(e => e.name === 'A2A')) {
  // Safe to communicate via A2A protocol
}
```

---

## Best Practices

1. **Always verify before copy trading** - Don't trust unverified traders
2. **Check reputation scores** - Low scores indicate potential issues
3. **Verify on the right network** - Use same network as trading
4. **Register your bot** - Build trust with verified identity
5. **Give feedback** - Help build the trust graph

---

## Links

- [ERC-8004 Spec](https://eips.ethereum.org/EIPS/eip-8004)
- [Reference Implementation](https://github.com/nuwa-protocol/nuwa-8004)
- [Awesome ERC-8004](https://github.com/sudeepb02/awesome-erc8004)
