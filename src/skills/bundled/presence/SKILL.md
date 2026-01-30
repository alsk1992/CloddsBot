---
name: presence
description: "Online status, activity tracking, and multi-device sync"
emoji: "🟢"
---

# Presence - Complete API Reference

Manage online status, track activity across devices, and sync presence information.

---

## Chat Commands

### View Status

```
/presence                                   Show your status
/presence who                               Who's online
/presence activity                          Recent activity
```

### Set Status

```
/presence online                            Set online
/presence away                              Set away
/presence dnd                               Do not disturb
/presence offline                           Appear offline
/presence status "In a meeting"             Custom status
```

### Devices

```
/presence devices                           Your connected devices
/presence sync                              Force sync all devices
```

---

## TypeScript API Reference

### Create Presence Service

```typescript
import { createPresenceService } from 'clodds/presence';

const presence = createPresenceService({
  // Update interval
  heartbeatIntervalMs: 30000,

  // Auto-away after idle
  awayAfterMs: 300000,  // 5 minutes

  // Storage
  storage: 'redis',  // 'redis' | 'memory'
  redisUrl: process.env.REDIS_URL,
});
```

### Get Status

```typescript
// Get own status
const status = await presence.getStatus(userId);

console.log(`Status: ${status.status}`);  // 'online' | 'away' | 'dnd' | 'offline'
console.log(`Custom: ${status.customStatus}`);
console.log(`Last seen: ${status.lastSeen}`);
console.log(`Device: ${status.activeDevice}`);

// Get multiple users
const statuses = await presence.getStatuses(['user-1', 'user-2', 'user-3']);
```

### Set Status

```typescript
// Set status
await presence.setStatus(userId, 'online');
await presence.setStatus(userId, 'away');
await presence.setStatus(userId, 'dnd');
await presence.setStatus(userId, 'offline');

// Set custom status message
await presence.setCustomStatus(userId, 'Trading BTC');

// Clear custom status
await presence.clearCustomStatus(userId);
```

### Activity Tracking

```typescript
// Record activity
await presence.recordActivity(userId, {
  type: 'message',
  channelId: 'telegram-123',
  timestamp: Date.now(),
});

// Get recent activity
const activity = await presence.getActivity(userId, {
  limit: 10,
  since: Date.now() - 3600000,  // Last hour
});

for (const event of activity) {
  console.log(`${event.type} at ${event.timestamp}`);
  console.log(`  Channel: ${event.channelId}`);
}
```

### Device Presence

```typescript
// Get user's devices
const devices = await presence.getDevices(userId);

for (const device of devices) {
  console.log(`${device.id}: ${device.name}`);
  console.log(`  Status: ${device.status}`);
  console.log(`  Last seen: ${device.lastSeen}`);
  console.log(`  Active: ${device.isActive}`);
}

// Set device status
await presence.setDeviceStatus(userId, deviceId, 'online');
```

### Who's Online

```typescript
// Get online users
const online = await presence.getOnlineUsers({
  channelId: 'telegram-123',  // Optional: filter by channel
});

for (const user of online) {
  console.log(`${user.name}: ${user.status}`);
}
```

### Event Handlers

```typescript
// Status changes
presence.on('statusChange', (userId, oldStatus, newStatus) => {
  console.log(`${userId}: ${oldStatus} -> ${newStatus}`);
});

// User came online
presence.on('online', (userId) => {
  console.log(`${userId} is now online`);
});

// User went offline
presence.on('offline', (userId) => {
  console.log(`${userId} went offline`);
});
```

### Sync Across Devices

```typescript
// Force sync
await presence.sync(userId);

// Get sync status
const syncStatus = await presence.getSyncStatus(userId);
console.log(`Devices synced: ${syncStatus.synced}/${syncStatus.total}`);
console.log(`Last sync: ${syncStatus.lastSync}`);
```

---

## Status Types

| Status | Description |
|--------|-------------|
| `online` | Active and available |
| `away` | Idle/inactive |
| `dnd` | Do not disturb |
| `offline` | Not available |

---

## Auto-Away

Presence automatically changes to `away` after inactivity:

```typescript
const presence = createPresenceService({
  awayAfterMs: 300000,    // 5 min idle -> away
  offlineAfterMs: 3600000, // 1 hour idle -> offline
});
```

---

## Multi-Device Sync

When user is active on multiple devices:
- Most recent activity determines primary device
- Status syncs across all devices
- Custom status shared everywhere

---

## Best Practices

1. **Use heartbeats** — Keep status accurate
2. **Set away appropriately** — Don't spam status changes
3. **Custom status** — Let others know what you're doing
4. **Review devices** — Keep device list clean
5. **DND for focus** — Mute notifications during trades
