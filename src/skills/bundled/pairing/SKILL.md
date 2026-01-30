---
name: pairing
description: "User pairing, authentication, and trust management"
emoji: "🔗"
---

# Pairing - Complete API Reference

Pair new users to Clodds, manage trust levels, and control access across channels.

---

## Chat Commands

### Pairing (New Users)

```
/pair                                       Request pairing (generates code)
/pair-code ABC123                           Enter pairing code
/unpair                                     Remove your pairing
```

### Admin Commands

```
/pairing list                               List pending requests
/pairing approve <code>                     Approve pairing request
/pairing reject <code>                      Reject pairing request
/pairing users                              List paired users
/pairing remove <user>                      Remove user pairing
```

### Trust Management

```
/trust <user> owner                         Grant owner trust
/trust <user> paired                        Standard trust
/trust list                                 List trust levels
```

---

## TypeScript API Reference

### Create Pairing Service

```typescript
import { createPairingService } from 'clodds/pairing';

const pairing = createPairingService({
  // Code settings
  codeLength: 8,
  codeExpiryMinutes: 60,
  maxPendingPerChannel: 3,

  // Auto-approve settings
  autoApproveLocal: true,      // Auto-approve localhost
  autoApproveTailscale: true,  // Auto-approve Tailscale IPs
  autoApproveOwners: true,     // Owners auto-approve their requests

  // Storage
  storage: 'sqlite',
  dbPath: './pairing.db',
});
```

### Create Pairing Request

```typescript
// User requests pairing
const request = await pairing.createPairingRequest({
  channelId: 'telegram-123',
  userId: 'telegram-user-456',
  username: 'johndoe',
  displayName: 'John Doe',
});

console.log(`Pairing code: ${request.code}`);
console.log(`Expires: ${request.expiresAt}`);
console.log(`Share this code with an admin to get approved`);
```

### Validate Code

```typescript
// Check if code is valid
const valid = await pairing.validateCode({
  code: 'ABC123XY',
});

if (valid) {
  console.log(`Valid code for user: ${valid.username}`);
  console.log(`Channel: ${valid.channelId}`);
}
```

### Approve Request

```typescript
// Admin approves pairing
await pairing.approveRequest({
  code: 'ABC123XY',
  approvedBy: 'admin-user-id',
  trustLevel: 'paired',
});
```

### Reject Request

```typescript
// Admin rejects pairing
await pairing.rejectRequest({
  code: 'ABC123XY',
  rejectedBy: 'admin-user-id',
  reason: 'Unknown user',
});
```

### Check Pairing Status

```typescript
// Check if user is paired
const isPaired = await pairing.isPaired({
  channelId: 'telegram-123',
  userId: 'telegram-user-456',
});

if (isPaired) {
  console.log('User is paired and can use Clodds');
}
```

### Get Trust Level

```typescript
const trust = await pairing.getTrustLevel({
  channelId: 'telegram-123',
  userId: 'telegram-user-456',
});

console.log(`Trust level: ${trust}`);
// 'owner' | 'paired' | 'stranger'

// Check specific permission
if (trust === 'owner') {
  console.log('Full admin access');
} else if (trust === 'paired') {
  console.log('Standard trading access');
} else {
  console.log('No access - must pair first');
}
```

### List Pending Requests

```typescript
const pending = await pairing.listPendingRequests({
  channelId: 'telegram-123',  // Optional: filter by channel
});

for (const req of pending) {
  console.log(`Code: ${req.code}`);
  console.log(`User: ${req.username} (${req.displayName})`);
  console.log(`Requested: ${req.createdAt}`);
  console.log(`Expires: ${req.expiresAt}`);
}
```

### List Paired Users

```typescript
const users = await pairing.listPairedUsers({
  channelId: 'telegram-123',  // Optional: filter by channel
});

for (const user of users) {
  console.log(`${user.username}: ${user.trustLevel}`);
  console.log(`  Paired: ${user.pairedAt}`);
  console.log(`  Approved by: ${user.approvedBy}`);
}
```

### Check Owner Status

```typescript
const isOwner = await pairing.isOwner({
  channelId: 'telegram-123',
  userId: 'telegram-user-456',
});

if (isOwner) {
  console.log('User has owner privileges');
}
```

### Remove Pairing

```typescript
// Remove user's pairing
await pairing.removePairing({
  channelId: 'telegram-123',
  userId: 'telegram-user-456',
});
```

---

## Trust Levels

| Level | Access |
|-------|--------|
| **owner** | Full admin: approve users, manage settings, trading |
| **paired** | Standard: trading, portfolio, queries |
| **stranger** | None: must pair first |

---

## Pairing Code Format

- **Length**: 8 characters
- **Characters**: Uppercase letters + numbers
- **Excludes**: 0, O, 1, I, L (avoid confusion)
- **Example**: `ABC234XY`

---

## Auto-Approve Rules

| Condition | Behavior |
|-----------|----------|
| Localhost | Auto-approve with owner trust |
| Tailscale IP | Auto-approve with owner trust |
| Owner request | Auto-approve their other channels |

---

## Security Features

| Feature | Description |
|---------|-------------|
| **Code expiry** | Codes expire after 1 hour |
| **Rate limiting** | Max 3 pending per channel |
| **Unambiguous codes** | No confusable characters |
| **Audit trail** | Who approved/rejected when |

---

## CLI Admin Commands

```bash
# List pending pairing requests
clodds pairing list telegram

# Approve a request
clodds pairing approve ABC234XY

# List paired users
clodds pairing users telegram

# Add user directly (bypass code)
clodds pairing add telegram user-123

# Remove user
clodds pairing remove telegram user-123
```

---

## Best Practices

1. **Share codes securely** — Don't post in public channels
2. **Set expiry appropriately** — Shorter for sensitive systems
3. **Review pending regularly** — Don't let requests pile up
4. **Use owner sparingly** — Most users only need 'paired'
5. **Audit periodically** — Review who has access
