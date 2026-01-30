---
name: identity
description: "User identity, OAuth connections, and device management"
emoji: "🪪"
---

# Identity - Complete API Reference

Manage user identity, OAuth provider connections, and device authentication.

---

## Chat Commands

### View Identity

```
/identity                                   Show your identity
/identity status                            Auth status
/identity devices                           List linked devices
```

### OAuth Providers

```
/identity providers                         List available providers
/identity link google                       Connect Google account
/identity link github                       Connect GitHub account
/identity unlink google                     Disconnect provider
```

### Device Management

```
/identity device list                       List devices
/identity device name "Work Laptop"         Name this device
/identity device revoke <id>                Revoke device access
/identity device revoke-all                 Revoke all except current
```

### Trust & Security

```
/identity trust                             View trust level
/identity sessions                          Active sessions
/identity session logout <id>               End session
/identity security                          Security settings
```

---

## TypeScript API Reference

### Create Identity Service

```typescript
import { createIdentityService } from 'clodds/identity';

const identity = createIdentityService({
  // OAuth providers
  providers: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    },
  },

  // Session settings
  sessionDurationMs: 86400000 * 30,  // 30 days
  deviceTrustDurationMs: 86400000 * 90,  // 90 days

  // Storage
  storage: 'sqlite',
  dbPath: './identity.db',
});
```

### Get User Identity

```typescript
const user = await identity.getUser(userId);

console.log(`ID: ${user.id}`);
console.log(`Name: ${user.displayName}`);
console.log(`Email: ${user.email}`);
console.log(`Trust level: ${user.trustLevel}`);
console.log(`Created: ${user.createdAt}`);
```

### Link OAuth Provider

```typescript
// Generate OAuth URL
const authUrl = identity.getOAuthUrl('google', {
  redirectUri: 'https://your-domain.com/auth/callback',
  state: 'random-state-string',
  scopes: ['email', 'profile'],
});

// Handle callback
const result = await identity.handleOAuthCallback('google', {
  code: 'oauth-code-from-callback',
  state: 'random-state-string',
});

console.log(`Linked: ${result.provider}`);
console.log(`Email: ${result.email}`);
```

### List Linked Providers

```typescript
const providers = await identity.getLinkedProviders(userId);

for (const provider of providers) {
  console.log(`${provider.name}: ${provider.email}`);
  console.log(`  Linked: ${provider.linkedAt}`);
  console.log(`  Last used: ${provider.lastUsed}`);
}
```

### Unlink Provider

```typescript
await identity.unlinkProvider(userId, 'google');
```

### Device Management

```typescript
// List devices
const devices = await identity.getDevices(userId);

for (const device of devices) {
  console.log(`${device.id}: ${device.name || 'Unknown'}`);
  console.log(`  Type: ${device.type}`);  // 'desktop' | 'mobile' | 'tablet'
  console.log(`  Browser: ${device.browser}`);
  console.log(`  OS: ${device.os}`);
  console.log(`  Last seen: ${device.lastSeen}`);
  console.log(`  Current: ${device.isCurrent}`);
}

// Name device
await identity.nameDevice(userId, deviceId, 'Work Laptop');

// Revoke device
await identity.revokeDevice(userId, deviceId);

// Revoke all except current
await identity.revokeAllDevices(userId, { exceptCurrent: true });
```

### Session Management

```typescript
// List active sessions
const sessions = await identity.getSessions(userId);

for (const session of sessions) {
  console.log(`${session.id}: ${session.device}`);
  console.log(`  Started: ${session.startedAt}`);
  console.log(`  Last active: ${session.lastActive}`);
  console.log(`  IP: ${session.ip}`);
}

// End session
await identity.endSession(sessionId);

// End all sessions
await identity.endAllSessions(userId);
```

### Trust Level

```typescript
// Get trust level
const trust = await identity.getTrustLevel(userId);
console.log(`Trust: ${trust}`);  // 'owner' | 'paired' | 'stranger'

// Set trust level (admin only)
await identity.setTrustLevel(userId, 'paired');
```

---

## Trust Levels

| Level | Access |
|-------|--------|
| **owner** | Full admin access |
| **paired** | Standard user access |
| **stranger** | No access (must pair) |

---

## OAuth Providers

| Provider | Scopes |
|----------|--------|
| **Google** | email, profile |
| **GitHub** | user:email |
| **Discord** | identify, email |
| **Twitter** | users.read |

---

## Device Types

| Type | Detection |
|------|-----------|
| `desktop` | Windows, macOS, Linux |
| `mobile` | iOS, Android |
| `tablet` | iPad, Android tablet |
| `unknown` | Unrecognized UA |

---

## Best Practices

1. **Link multiple providers** — Backup auth methods
2. **Review devices regularly** — Revoke unused ones
3. **Name your devices** — Easier to identify
4. **Check sessions** — Monitor for suspicious access
5. **Use strong auth** — OAuth over passwords
