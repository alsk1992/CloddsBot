---
name: credentials
description: "Secure credential management for trading platforms"
emoji: "🔐"
---

# Credentials - Complete API Reference

Securely store and manage API credentials for trading platforms with AES-256-GCM encryption.

---

## Chat Commands

### Add Credentials

```
/creds add polymarket                       Interactive setup
/creds add kalshi --key abc --secret xyz    Direct setup
/creds add binance                          Add Binance API
/creds add hyperliquid                      Add wallet key
```

### View Credentials

```
/creds list                                 List configured platforms
/creds status                               Check credential health
/creds test polymarket                      Test API connection
```

### Remove Credentials

```
/creds remove polymarket                    Remove platform creds
/creds clear                                Clear all (careful!)
```

### Auth Status

```
/auth status                                Overall auth status
/auth refresh kalshi                        Refresh tokens
/auth cooldown                              View cooldown status
```

---

## TypeScript API Reference

### Create Credentials Manager

```typescript
import { createCredentialsManager } from 'clodds/credentials';

const creds = createCredentialsManager({
  // Encryption key (required)
  encryptionKey: process.env.CREDENTIALS_KEY,

  // Storage backend
  storage: 'sqlite',  // 'sqlite' | 'postgres'
  dbPath: './credentials.db',

  // Cooldown settings
  cooldownMinutes: 15,
  maxFailures: 3,
});
```

### Set Credentials

```typescript
// Polymarket (API + signing key)
await creds.setCredentials({
  userId: 'user-123',
  platform: 'polymarket',
  credentials: {
    apiKey: 'pk_...',
    apiSecret: 'sk_...',
    privateKey: '0x...',  // For order signing
    funderAddress: '0x...',
  },
});

// Kalshi (API key)
await creds.setCredentials({
  userId: 'user-123',
  platform: 'kalshi',
  credentials: {
    email: 'user@example.com',
    apiKey: 'key_...',
  },
});

// Binance Futures
await creds.setCredentials({
  userId: 'user-123',
  platform: 'binance',
  credentials: {
    apiKey: 'abc...',
    apiSecret: 'xyz...',
  },
});

// Hyperliquid (wallet)
await creds.setCredentials({
  userId: 'user-123',
  platform: 'hyperliquid',
  credentials: {
    privateKey: '0x...',
    walletAddress: '0x...',
  },
});
```

### Get Credentials

```typescript
// Get for specific platform
const polymarketCreds = await creds.getCredentials({
  userId: 'user-123',
  platform: 'polymarket',
});

if (polymarketCreds) {
  console.log(`API Key: ${polymarketCreds.apiKey}`);
  // Credentials are decrypted on retrieval
}

// List user's configured platforms
const platforms = await creds.listUserPlatforms('user-123');
console.log(`Configured: ${platforms.join(', ')}`);
```

### Delete Credentials

```typescript
// Remove single platform
await creds.deleteCredentials({
  userId: 'user-123',
  platform: 'kalshi',
});

// Remove all for user
await creds.deleteAllCredentials('user-123');
```

### Test Credentials

```typescript
// Test API connection
const result = await creds.testCredentials({
  userId: 'user-123',
  platform: 'polymarket',
});

if (result.success) {
  console.log(`✓ Connected to ${result.platform}`);
  console.log(`  Balance: $${result.balance}`);
} else {
  console.log(`✗ Failed: ${result.error}`);
}
```

### Cooldown Management

```typescript
// Mark failed auth attempt
await creds.markFailure({
  userId: 'user-123',
  platform: 'kalshi',
  error: 'Invalid API key',
});

// Check if in cooldown
const inCooldown = await creds.isInCooldown({
  userId: 'user-123',
  platform: 'kalshi',
});

if (inCooldown) {
  const remaining = await creds.getCooldownRemaining({
    userId: 'user-123',
    platform: 'kalshi',
  });
  console.log(`Cooldown: ${remaining} minutes remaining`);
}

// Mark successful auth (resets failures)
await creds.markSuccess({
  userId: 'user-123',
  platform: 'kalshi',
});
```

### Build Trading Context

```typescript
// Get ready-to-use trading context
const context = await creds.buildTradingContext({
  userId: 'user-123',
  platform: 'polymarket',
});

// Context includes authenticated client
await context.client.getBalance();
await context.client.placeOrder({ ... });
```

---

## Supported Platforms

| Platform | Credentials Required |
|----------|---------------------|
| **Polymarket** | API key, secret, private key, funder address |
| **Kalshi** | Email, API key |
| **Betfair** | App key, session token |
| **Smarkets** | API key |
| **Binance** | API key, secret |
| **Bybit** | API key, secret |
| **Hyperliquid** | Private key, wallet address |
| **MEXC** | API key, secret |

---

## Security Features

| Feature | Description |
|---------|-------------|
| **AES-256-GCM** | Military-grade encryption at rest |
| **Per-user keys** | Isolated credential storage |
| **Cooldown** | Rate limits on failed attempts |
| **No logging** | Secrets never logged |
| **Memory wipe** | Credentials cleared from memory after use |

---

## Environment Variables

```bash
# Required encryption key (generate with: openssl rand -hex 32)
CREDENTIALS_KEY=your-64-char-hex-key

# Optional: per-platform keys
POLYMARKET_API_KEY=pk_...
POLYMARKET_API_SECRET=sk_...
POLYMARKET_PRIVATE_KEY=0x...
KALSHI_EMAIL=user@example.com
KALSHI_API_KEY=key_...
```

---

## Best Practices

1. **Strong encryption key** — Use `openssl rand -hex 32`
2. **Rotate keys regularly** — Update API keys periodically
3. **Test after adding** — Always verify credentials work
4. **Minimal permissions** — Use read-only keys when possible
5. **Backup securely** — Keep encrypted backups offline
