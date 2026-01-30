---
name: mev
description: "MEV protection against sandwich attacks and front-running"
emoji: "🛡️"
---

# MEV Protection - Complete API Reference

Protect trades from MEV (Maximal Extractable Value) attacks including sandwich attacks and front-running.

---

## Chat Commands

### Protection Settings

```
/mev                                Show current protection
/mev status                         Protection status
/mev enable                         Enable protection
/mev disable                        Disable protection
```

### Configure Protection

```
/mev level aggressive               Maximum protection
/mev level standard                 Balanced protection
/mev level minimal                  Basic protection
/mev provider flashbots             Use Flashbots
/mev provider mev-blocker           Use MEV Blocker
```

### Check Transaction

```
/mev check <tx-hash>                Check if tx was attacked
/mev simulate <order>               Simulate MEV risk
```

---

## TypeScript API Reference

### Create MEV Protection

```typescript
import { createMEVProtection } from 'clodds/mev';

const mev = createMEVProtection({
  // Default level
  level: 'standard',

  // Providers
  providers: {
    ethereum: 'flashbots',    // 'flashbots' | 'mev-blocker'
    solana: 'jito',           // 'jito' | 'standard'
  },

  // Settings
  maxPriorityFee: 5,  // gwei
  bundleTimeout: 60,  // seconds
});
```

### Execute Protected Trade

```typescript
// EVM trade with protection
const result = await mev.executeProtected({
  chain: 'ethereum',
  type: 'swap',
  tokenIn: 'USDC',
  tokenOut: 'ETH',
  amountIn: 10000,
  minAmountOut: calculateMinOut(10000, 0.5),  // 0.5% slippage
});

console.log(`Tx hash: ${result.txHash}`);
console.log(`Protected: ${result.protected}`);
console.log(`Bundle ID: ${result.bundleId}`);
console.log(`Savings: $${result.estimatedSavings}`);
```

### Flashbots (Ethereum)

```typescript
// Submit via Flashbots Protect
const result = await mev.flashbots({
  to: routerAddress,
  data: swapCalldata,
  value: 0,
  maxFeePerGas: parseGwei('50'),
  maxPriorityFeePerGas: parseGwei('2'),
});

console.log(`Submitted to Flashbots`);
console.log(`Bundle hash: ${result.bundleHash}`);

// Wait for inclusion
const status = await mev.waitForInclusion(result.bundleHash);
console.log(`Included in block: ${status.blockNumber}`);
```

### MEV Blocker (Ethereum)

```typescript
// Use MEV Blocker by CoW Protocol
const result = await mev.mevBlocker({
  to: routerAddress,
  data: swapCalldata,
  value: 0,
});

// MEV Blocker automatically:
// - Protects from sandwich attacks
// - Backruns profitable MEV to you
// - Returns any captured MEV
console.log(`MEV captured: $${result.mevCaptured}`);
```

### Jito (Solana)

```typescript
// Submit via Jito bundles
const result = await mev.jito({
  instructions: swapInstructions,
  tip: 10000,  // lamports tip to validators
});

console.log(`Bundle ID: ${result.bundleId}`);
console.log(`Status: ${result.status}`);
```

### Check Transaction

```typescript
// Check if a past transaction was attacked
const analysis = await mev.analyzeTransaction(txHash);

console.log(`Was attacked: ${analysis.wasAttacked}`);
if (analysis.wasAttacked) {
  console.log(`Attack type: ${analysis.attackType}`);
  console.log(`Attacker: ${analysis.attacker}`);
  console.log(`Loss: $${analysis.estimatedLoss}`);
  console.log(`Frontrun tx: ${analysis.frontrunTx}`);
  console.log(`Backrun tx: ${analysis.backrunTx}`);
}
```

### Simulate MEV Risk

```typescript
// Before trading, check MEV risk
const risk = await mev.simulateRisk({
  chain: 'ethereum',
  type: 'swap',
  tokenIn: 'USDC',
  tokenOut: 'PEPE',
  amountIn: 50000,
});

console.log(`MEV risk: ${risk.level}`);  // 'low' | 'medium' | 'high'
console.log(`Estimated max loss: $${risk.maxLoss}`);
console.log(`Recommendation: ${risk.recommendation}`);

if (risk.level === 'high') {
  console.log('⚠️ High MEV risk - use protection!');
}
```

### Protection Levels

```typescript
// Aggressive - maximum protection, slower
mev.setLevel('aggressive', {
  usePrivateMempool: true,
  bundleOnly: true,
  maxSlippage: 0.1,
  waitForProtection: true,
});

// Standard - balanced protection
mev.setLevel('standard', {
  usePrivateMempool: true,
  bundleOnly: false,
  maxSlippage: 0.5,
});

// Minimal - basic protection
mev.setLevel('minimal', {
  usePrivateMempool: false,
  bundleOnly: false,
  maxSlippage: 1.0,
});
```

---

## MEV Attack Types

| Attack | Description | Protection |
|--------|-------------|------------|
| **Sandwich** | Front + backrun your trade | Private mempool |
| **Front-running** | Copy your trade first | Private mempool |
| **Back-running** | Profit after your trade | Jito/Flashbots |
| **JIT Liquidity** | Manipulate pool | Slippage limits |

---

## Protection Providers

| Chain | Provider | Method |
|-------|----------|--------|
| **Ethereum** | Flashbots Protect | Private relay |
| **Ethereum** | MEV Blocker | CoW Protocol |
| **Solana** | Jito | Bundle submission |
| **L2s** | Native | Sequencer protection |

---

## When to Use Protection

| Trade Size | Token | Recommendation |
|------------|-------|----------------|
| < $1,000 | Major | Minimal |
| $1,000 - $10,000 | Major | Standard |
| > $10,000 | Major | Aggressive |
| Any size | Meme/Low liquidity | Aggressive |

---

## Best Practices

1. **Always protect large trades** — MEV bots watch everything
2. **Use tight slippage** — Limits attack profitability
3. **Check before trading** — Simulate MEV risk
4. **Review transactions** — Learn from past attacks
5. **L2s are safer** — Sequencer provides natural protection
