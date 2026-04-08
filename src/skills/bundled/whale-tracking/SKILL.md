---
name: whale-tracking
description: "Monitor large whale trades on Polymarket and track whale wallets across Solana, Ethereum, Polygon, Arbitrum, Base, and Optimism. Set alerts for whale movements and analyze accumulation patterns. Use when tracking smart money, detecting large trades, or following whale wallets."
emoji: "🐋"
gates:
  envs:
    anyOf:
      - POLY_API_KEY
      - BIRDEYE_API_KEY
      - ALCHEMY_API_KEY
---

# Whale Tracking - Complete API Reference

Monitor large trades and positions on Polymarket and crypto chains to identify market-moving activity.

## Supported Platforms

### Prediction Markets
- **Polymarket** - WebSocket real-time trade monitoring

### Crypto Chains
| Chain | Provider | Features |
|-------|----------|----------|
| Solana | Birdeye WebSocket | Token transfers, swaps, NFTs |
| Ethereum | Alchemy WebSocket | ERC-20, ETH transfers |
| Polygon | Alchemy WebSocket | MATIC, tokens |
| Arbitrum | Alchemy WebSocket | L2 activity |
| Base | Alchemy WebSocket | Coinbase L2 |
| Optimism | Alchemy WebSocket | OP ecosystem |

---

## Chat Commands

### General

```
/whale                                      # Active whale alerts summary
/whale start                                # Start whale monitoring
/whale stop                                 # Stop monitoring
/whale config                               # Tracking configuration
/whale list                                 # List tracked wallets
```

### Tracking Wallets

```
/whale track <address>                      # Follow specific wallet
/whale untrack <address>                    # Stop following wallet
/whale watch <address> [--chain c]          # Track an address (same as track)
/whale unwatch <address>                    # Stop tracking (same as untrack)
```

### Polymarket Whale Activity

```
/whale polymarket [n]                       # Recent Polymarket whale trades
/whale polymarket market <id>               # Whale activity for a market
/whale activity <market>                    # Whale activity for market
/whale recent [n] [--min-size N]            # Last N whale trades
/whale top [n]                              # Top Polymarket whales
/whale profitable [wr%] [min-n]             # Profitable whales
/whale profile <address>                    # Whale profile + positions
/whale positions [market-id]                # Active whale positions
```

### Crypto Whale Tracking

```
/whale crypto [chain] [n]                   # On-chain whale txs
/whale top crypto [chain] [n]               # Top on-chain whales
```

Note: `/whales` also works as an alias for `/whale`.

---

## TypeScript API Reference

### Polymarket Whale Tracker

```typescript
import { createWhaleTracker, isWhaleAddress, getMarketWhaleActivity } from 'clodds/feeds/polymarket/whale-tracker';

// Create tracker
const tracker = createWhaleTracker({
  minTradeSize: 10000,      // $10k+ trades
  minPositionSize: 50000,   // $50k+ positions
  enableRealtime: true,     // WebSocket streaming
});

// Event handlers
tracker.on('trade', (trade) => {
  console.log(`🐋 Whale ${trade.side} $${trade.usdValue.toLocaleString()}`);
  console.log(`   Market: ${trade.marketQuestion}`);
  console.log(`   Address: ${trade.address}`);
  console.log(`   Price: ${trade.price}`);
});

tracker.on('positionOpened', (position) => {
  console.log(`📈 New whale position`);
  console.log(`   Address: ${position.address}`);
  console.log(`   Market: ${position.market}`);
  console.log(`   Size: $${position.size.toLocaleString()}`);
});

tracker.on('positionClosed', (position) => {
  console.log(`📉 Whale exited position`);
  console.log(`   P&L: $${position.pnl.toLocaleString()}`);
});

// Start tracking
await tracker.start();

// Track specific wallet
await tracker.trackAddress('0x1234...');
await tracker.untrackAddress('0x1234...');

// Get tracked addresses
const tracked = tracker.getTrackedAddresses();

// Stop tracking
await tracker.stop();
```

### Check Whale Status

```typescript
// Check if address is a whale
const isWhale = await isWhaleAddress('0x1234...', 100000);  // $100k min volume

// Get whale activity for a market
const activity = await getMarketWhaleActivity('market-slug');

console.log(`Total whale volume: $${activity.totalVolume.toLocaleString()}`);
console.log(`Whale trades: ${activity.tradeCount}`);
console.log(`Net whale sentiment: ${activity.sentiment}`);  // 'bullish' | 'bearish' | 'neutral'
console.log(`Top whales:`);
for (const whale of activity.topWhales) {
  console.log(`  ${whale.address}: $${whale.volume.toLocaleString()}`);
}
```

### Top Traders

```typescript
// Get top traders
const topTraders = await tracker.getTopTraders({
  period: '7d',           // 24h, 7d, 30d, all
  limit: 10,
  minVolume: 50000,
  minWinRate: 0.5,
});

for (const trader of topTraders) {
  console.log(`${trader.rank}. ${trader.address}`);
  console.log(`   Volume: $${trader.volume.toLocaleString()}`);
  console.log(`   Win rate: ${(trader.winRate * 100).toFixed(1)}%`);
  console.log(`   P&L: $${trader.pnl.toLocaleString()}`);
}
```

---

### Crypto Whale Tracker

```typescript
import { createCryptoWhaleTracker } from 'clodds/feeds/crypto/whale-tracker';

// Create multi-chain tracker
const cryptoTracker = createCryptoWhaleTracker({
  chains: ['solana', 'ethereum', 'polygon', 'arbitrum', 'base', 'optimism'],

  thresholds: {
    solana: 10000,      // $10k+ on Solana
    ethereum: 50000,    // $50k+ on ETH
    polygon: 5000,      // $5k+ on Polygon
    arbitrum: 10000,    // $10k+ on Arbitrum
    base: 10000,        // $10k+ on Base
    optimism: 10000,    // $10k+ on Optimism
  },

  // API keys
  birdeyeApiKey: process.env.BIRDEYE_API_KEY,
  alchemyApiKey: process.env.ALCHEMY_API_KEY,
});

// Event handlers
cryptoTracker.on('transaction', (tx) => {
  console.log(`🐋 ${tx.chain.toUpperCase()}`);
  console.log(`   Type: ${tx.type}`);  // 'transfer', 'swap', 'nft', 'stake'
  console.log(`   Amount: $${tx.usdValue.toLocaleString()}`);
  console.log(`   From: ${tx.from}`);
  console.log(`   To: ${tx.to}`);
  console.log(`   Token: ${tx.token}`);
  console.log(`   TX: ${tx.hash}`);
});

cryptoTracker.on('largeTransfer', (tx) => {
  console.log(`🚨 LARGE TRANSFER: $${tx.usdValue.toLocaleString()}`);
});

// Start tracking
await cryptoTracker.start();

// Watch specific wallets
await cryptoTracker.watchWallet('solana', 'ABC123...');
await cryptoTracker.watchWallet('ethereum', '0x1234...');

// Unwatch
await cryptoTracker.unwatchWallet('solana', 'ABC123...');

// Get recent whale transactions
const recent = await cryptoTracker.getRecentTransactions('solana', {
  limit: 20,
  minValue: 50000,
});

// Get top whales by chain
const topSolana = await cryptoTracker.getTopWhales('solana', 10);
const topEth = await cryptoTracker.getTopWhales('ethereum', 10);

// Stop
await cryptoTracker.stop();
```

---

## Alert Configuration

### Polymarket Alerts

```typescript
// Configure alerts
tracker.setAlertConfig({
  minTradeSize: 25000,      // Alert on $25k+ trades
  alertChannels: ['telegram', 'discord'],
  soundEnabled: true,
  markets: ['politics', 'crypto'],  // Filter by category
});
```

### Crypto Alerts

```typescript
// Configure per-chain alerts
cryptoTracker.setAlertConfig({
  solana: {
    minValue: 50000,
    tokens: ['SOL', 'JUP', 'BONK'],
  },
  ethereum: {
    minValue: 100000,
    tokens: ['ETH', 'USDC', 'PEPE'],
  },
});
```

---

## Data Export

```typescript
// Export whale data to CSV
await tracker.exportTrades({
  format: 'csv',
  path: './whale-trades.csv',
  period: '30d',
});

// Export top traders
await tracker.exportTopTraders({
  format: 'json',
  path: './top-traders.json',
  limit: 100,
});
```

---

## Best Practices

1. **Set reasonable thresholds** - Start with $10k for active markets
2. **Focus on specific markets** - Filter by category to reduce noise
3. **Track known smart money** - Follow wallets with proven track records
4. **Combine with copy trading** - Use whale data to inform copy decisions
5. **Monitor sentiment shifts** - Watch for net whale direction changes
6. **Check position sizes** - Large positions signal conviction
