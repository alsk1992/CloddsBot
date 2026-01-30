---
name: bridge
description: "Cross-chain token transfers using Wormhole and CCTP"
emoji: "🌉"
gates:
  envs:
    anyOf:
      - SOLANA_PRIVATE_KEY
      - EVM_PRIVATE_KEY
---

# Bridge - Complete API Reference

Transfer tokens across chains using Wormhole and Circle CCTP protocols.

## Supported Chains

| Chain | Wormhole | CCTP (USDC) |
|-------|----------|-------------|
| Solana | Yes | Yes |
| Ethereum | Yes | Yes |
| Polygon | Yes | Yes |
| Arbitrum | Yes | Yes |
| Optimism | Yes | Yes |
| Avalanche | Yes | Yes |
| Base | Yes | Yes |

---

## Chat Commands

### Quote

```
/bridge quote 100 USDC sol to eth           # Quote 100 USDC Solana → Ethereum
/bridge quote 1000 USDC arb to base         # Quote Arbitrum → Base
/bridge quote 50 USDC eth to sol            # Quote Ethereum → Solana
```

### Execute Transfer

```
/bridge send 100 USDC sol to eth            # Send 100 USDC Solana → Ethereum
/bridge send 1000 USDC arb to base          # Send Arbitrum → Base
/bridge send 50 USDC eth to sol --address <dest>  # To specific address
```

### Redeem (Claim)

```
/bridge redeem <tx-hash>                    # Claim transferred tokens
/bridge pending                             # List pending redemptions
```

### Status

```
/bridge status <tx-hash>                    # Check transfer status
/bridge history                             # View transfer history
```

---

## TypeScript API Reference

### Wormhole Bridge

```typescript
import { executeWormholeBridge, executeWormholeRedeem } from 'clodds/bridge/wormhole';

// Get quote
const quote = await getWormholeQuote({
  sourceChain: 'solana',
  destChain: 'ethereum',
  token: 'USDC',
  amount: 100,
});

console.log(`Transfer 100 USDC: Solana → Ethereum`);
console.log(`Fee: $${quote.fee}`);
console.log(`Est. time: ${quote.estimatedTime} seconds`);

// Execute transfer
const transfer = await executeWormholeBridge({
  sourceChain: 'solana',
  destChain: 'ethereum',
  token: 'USDC',
  amount: 100,

  // Source wallet
  sourcePrivateKey: process.env.SOLANA_PRIVATE_KEY,

  // Destination address (optional, defaults to your address)
  destAddress: '0x1234...',
});

console.log(`Transfer initiated: ${transfer.txHash}`);
console.log(`VAA: ${transfer.vaa}`);
console.log(`Status: ${transfer.status}`);

// Redeem on destination chain
const redeem = await executeWormholeRedeem({
  destChain: 'ethereum',
  vaa: transfer.vaa,
  destPrivateKey: process.env.EVM_PRIVATE_KEY,
});

console.log(`Redeemed: ${redeem.txHash}`);
console.log(`Amount received: ${redeem.amount} USDC`);
```

### CCTP (Circle) Bridge

```typescript
import { executeCCTPBridge, redeemCCTP } from 'clodds/bridge/cctp';

// CCTP is optimized for USDC transfers
const transfer = await executeCCTPBridge({
  sourceChain: 'arbitrum',
  destChain: 'base',
  amount: 1000,  // USDC

  sourcePrivateKey: process.env.EVM_PRIVATE_KEY,
  destAddress: '0x1234...',
});

console.log(`CCTP transfer: ${transfer.txHash}`);
console.log(`Message: ${transfer.messageHash}`);

// Wait for attestation (usually ~15 minutes)
await waitForAttestation(transfer.messageHash);

// Redeem
const redeem = await redeemCCTP({
  destChain: 'base',
  messageHash: transfer.messageHash,
  destPrivateKey: process.env.EVM_PRIVATE_KEY,
});
```

### Check Status

```typescript
import { getTransferStatus } from 'clodds/bridge';

const status = await getTransferStatus(txHash);

console.log(`Status: ${status.status}`);
// 'pending' | 'confirming' | 'attesting' | 'redeemable' | 'completed' | 'failed'

console.log(`Source confirmations: ${status.sourceConfirmations}`);
console.log(`VAA status: ${status.vaaStatus}`);
console.log(`Redeemed: ${status.redeemed}`);

if (status.status === 'redeemable') {
  console.log(`Ready to redeem! VAA: ${status.vaa}`);
}
```

### Get Pending Redemptions

```typescript
import { getPendingRedemptions } from 'clodds/bridge';

const pending = await getPendingRedemptions({
  chains: ['ethereum', 'solana', 'arbitrum'],
  address: myAddress,
});

for (const p of pending) {
  console.log(`${p.sourceChain} → ${p.destChain}`);
  console.log(`  Amount: ${p.amount} ${p.token}`);
  console.log(`  Status: ${p.status}`);
  console.log(`  Age: ${p.age} minutes`);
}
```

---

## Transfer Flow

### Wormhole

1. **Lock tokens** on source chain
2. **Wait for confirmations** (varies by chain)
3. **Guardian attestation** (VAA generation)
4. **Redeem** on destination chain

### CCTP

1. **Burn USDC** on source chain
2. **Wait for attestation** (~15 min)
3. **Mint USDC** on destination chain

---

## Fees & Times

| Route | Fee | Time |
|-------|-----|------|
| Solana → Ethereum | ~$5 | 15-20 min |
| Ethereum → Solana | ~$20 | 15-20 min |
| Arbitrum → Base (CCTP) | ~$0.50 | 15-20 min |
| Polygon → Arbitrum | ~$1 | 15-20 min |

---

## Best Practices

1. **Use CCTP for USDC** - Faster and cheaper
2. **Check gas prices** - High gas can increase costs
3. **Save VAA/message hash** - Needed for redemption
4. **Monitor pending transfers** - Don't forget to redeem
5. **Start with small amounts** - Test before large transfers
6. **Verify destination address** - Double-check before sending
