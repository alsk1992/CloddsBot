# Virtuals Protocol Integration

AI Agent marketplace trading on Base chain.

## Overview

Virtuals Protocol is a platform for creating, trading, and interacting with AI agents. Each agent has its own token that trades on a bonding curve until graduation (42K VIRTUAL accumulated), then moves to Uniswap V2.

```
┌─────────────────────────────────────────────────────────────┐
│                   Virtuals Protocol                          │
├─────────────────┬─────────────────┬─────────────────────────┤
│   Discovery     │    Trading      │      Staking            │
├─────────────────┼─────────────────┼─────────────────────────┤
│ • Search agents │ • Bonding curve │ • veVIRTUAL             │
│ • Trending      │ • Uniswap V2    │ • Voting power          │
│ • New launches  │ • Auto-routing  │ • Delegation            │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## Quick Start

### 1. Configure Base RPC (optional)

```bash
# Default: https://mainnet.base.org
export BASE_RPC_URL="https://your-base-rpc.com"
```

### 2. For trading, set wallet key

```bash
export EVM_PRIVATE_KEY="0x..."
```

### 3. Use commands

```
/agents luna              # Search for AI agents
/trending-agents          # See what's hot
/agent 0x1234...          # Get agent details
/agent-quote buy 0x... 100  # Get trade quote
```

## Commands

### Discovery

| Command | Description |
|---------|-------------|
| `/agents <query>` | Search AI agents by name/symbol |
| `/agent <token-address>` | Get detailed agent info |
| `/trending-agents [limit]` | Top agents by 24h volume |
| `/new-agents [limit]` | Recently launched agents |

### Trading

| Command | Description |
|---------|-------------|
| `/agent-quote <buy\|sell> <token> <amount>` | Get quote with price impact |
| `/virtual-balance [address]` | Check VIRTUAL & veVIRTUAL balances |
| `/markets virtuals <query>` | Search via unified markets command |

## Agent Lifecycle

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  PROTOTYPE   │ ──► │   SENTIENT   │ ──► │  GRADUATED   │
│              │     │              │     │              │
│ Just created │     │ Has traction │     │ On Uniswap   │
│ 100 VIRTUAL  │     │ <42K VIRTUAL │     │ 42K+ VIRTUAL │
│ to launch    │     │ accumulated  │     │ in curve     │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       └────────────────────┴────────────────────┘
                     Bonding Curve          Uniswap V2
```

## Contract Addresses (Base Chain)

| Contract | Address |
|----------|---------|
| VIRTUAL Token | `0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b` |
| Bonding Proxy | `0xF66DeA7b3e897cD44A5a231c61B6B4423d613259` |
| Sell Executor | `0xF8DD39c71A278FE9F4377D009D7627EF140f809e` |
| Creator Vault | `0xdAd686299FB562f89e55DA05F1D96FaBEb2A2E32` |
| veVIRTUAL | `0x14559863b6E695A8aa4B7e68541d240ac1BBeB2f` |
| Uniswap V2 Router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` |
| Uniswap V2 Factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` |

## Programmatic Usage

### Get Agent Info

```typescript
import { getAgentTokenInfo, getAgentStatus } from './evm/virtuals';

const info = await getAgentTokenInfo('0x1234...');
console.log(info.name, info.symbol);
console.log('Graduated:', info.isGraduated);
console.log('Progress:', info.bondingCurve?.progressToGraduation);

const status = await getAgentStatus('0x1234...');
// 'prototype' | 'sentient' | 'graduated'
```

### Get Quote

```typescript
import { getVirtualsQuote } from './evm/virtuals';

const quote = await getVirtualsQuote({
  agentToken: '0x1234...',
  amount: '100',        // VIRTUAL for buy, tokens for sell
  side: 'buy',
  slippageBps: 100,     // 1%
});

console.log('Route:', quote.route);  // 'bonding' or 'uniswap'
console.log('Output:', quote.outputAmount);
console.log('Price Impact:', quote.priceImpact, '%');
```

### Execute Trade

```typescript
import { buyAgentToken, sellAgentToken } from './evm/virtuals';

// Buy agent tokens with VIRTUAL
const buyResult = await buyAgentToken({
  agentToken: '0x1234...',
  amount: '100',          // 100 VIRTUAL
  slippageBps: 100,
});

if (buyResult.success) {
  console.log('TX:', buyResult.txHash);
  console.log('Received:', buyResult.outputAmount);
  console.log('Route:', buyResult.route);
}

// Sell agent tokens for VIRTUAL
const sellResult = await sellAgentToken({
  agentToken: '0x1234...',
  amount: '1000000',      // 1M agent tokens
  slippageBps: 100,
});
```

### Staking

```typescript
import { stakeVirtual, getVeVirtualBalance, delegateVotingPower } from './evm/virtuals';

// Stake VIRTUAL for veVIRTUAL
const stakeResult = await stakeVirtual({
  amount: '1000',
  delegatee: '0x...',  // Optional: delegate voting power
});

// Check balance
const veBalance = await getVeVirtualBalance();

// Delegate to another address
await delegateVotingPower('0x...');
```

### Agent Discovery

```typescript
import { searchAgents, getTrendingAgents, getNewAgents } from './evm/virtuals';

// Search
const results = await searchAgents('luna', 10);

// Trending by volume
const trending = await getTrendingAgents(10);

// New launches
const newAgents = await getNewAgents(10);
```

### Check Creation Requirements

```typescript
import { canCreateAgent } from './evm/virtuals';

const check = await canCreateAgent();
console.log('Can create:', check.canCreate);
console.log('Balance:', check.balance);
console.log('Required:', check.required);  // 100 VIRTUAL
console.log('Shortfall:', check.shortfall);
```

## Feed Integration

Virtuals is integrated with the feed manager for unified market access:

```typescript
// Via FeedManager
const markets = await feeds.searchMarkets('luna', 'virtuals');

// Subscribe to price updates
const unsub = feeds.subscribePrice('virtuals', agentId, (update) => {
  console.log('Price:', update.price);
});
```

## Key Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `GRADUATION_THRESHOLD` | 42,000 VIRTUAL | Triggers move to Uniswap |
| `AGENT_CREATION_COST` | 100 VIRTUAL | Minimum to create agent |
| `AGENT_TOKEN_SUPPLY` | 1 billion | Fixed supply per agent |
| `BASE_CHAIN_ID` | 8453 | Base mainnet |

## Trading Notes

1. **Auto-routing**: Trades automatically route to bonding curve (pre-graduation) or Uniswap (post-graduation)

2. **Price Impact**: Bonding curve trades can have significant impact - always check quotes first

3. **Graduation**: Once an agent accumulates 42K VIRTUAL, it graduates to Uniswap with locked liquidity (10 years)

4. **Fees**: 1% tax on trades:
   - Pre-graduation: 100% to protocol treasury
   - Post-graduation: 30% creator, 20% affiliates, 50% agent SubDAO

5. **Slippage**: Default 1% (100 bps) - increase for volatile agents

## Resources

- [Virtuals Protocol Whitepaper](https://whitepaper.virtuals.io/)
- [App](https://app.virtuals.io/)
- [Fun (Agent Creation)](https://fun.virtuals.io/)
- [BaseScan VIRTUAL Token](https://basescan.org/token/0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b)
