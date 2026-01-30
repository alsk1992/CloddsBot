---
name: monitoring
description: "System health monitoring, alerts, and error tracking"
emoji: "🔔"
---

# Monitoring - Complete API Reference

Monitor system health, track errors, and receive alerts when issues occur.

---

## Chat Commands

### Service Control

```
/monitor start                              # Start monitoring
/monitor stop                               # Stop monitoring
/monitor status                             # Check monitoring status
```

### Health Checks

```
/monitor health                             # Run health check
/monitor health --verbose                   # Detailed health info
/monitor providers                          # Check LLM provider status
```

### Alerts

```
/monitor alerts                             # View recent alerts
/monitor alerts --unread                    # Unread alerts only
/monitor alert-targets                      # View alert destinations
/monitor alert-targets add email <addr>     # Add email target
/monitor alert-targets add webhook <url>    # Add webhook target
/monitor alert-targets remove <id>          # Remove target
```

### Configuration

```
/monitor config                             # View config
/monitor cooldown 300                       # Set alert cooldown (seconds)
/monitor threshold cpu 80                   # Set CPU alert threshold
/monitor threshold memory 90                # Set memory threshold
```

---

## TypeScript API Reference

### Create Monitoring Service

```typescript
import { createMonitoringService } from 'clodds/monitoring';

const monitor = createMonitoringService({
  // Health check interval
  intervalMs: 60000,  // 1 minute

  // Alert targets
  alertTargets: [
    { type: 'email', address: 'alerts@example.com' },
    { type: 'webhook', url: 'https://hooks.example.com/alerts' },
  ],

  // Alert cooldown (prevent spam)
  alertCooldownMs: 300000,  // 5 minutes

  // Thresholds
  thresholds: {
    cpu: 80,        // Alert at 80% CPU
    memory: 90,     // Alert at 90% memory
    errorRate: 10,  // Alert at 10% error rate
  },
});
```

### Start/Stop Monitoring

```typescript
// Start monitoring
await monitor.start();

// Check if running
const isRunning = monitor.isRunning();

// Stop monitoring
await monitor.stop();
```

### Health Checks

```typescript
// Run health check
const health = await monitor.runHealthCheck();

console.log(`Overall: ${health.status}`);  // 'healthy' | 'degraded' | 'unhealthy'

console.log('\nSystem:');
console.log(`  CPU: ${health.system.cpu}%`);
console.log(`  Memory: ${health.system.memory}%`);
console.log(`  Disk: ${health.system.disk}%`);

console.log('\nProviders:');
for (const [name, status] of Object.entries(health.providers)) {
  console.log(`  ${name}: ${status.status} (${status.latencyMs}ms)`);
}

console.log('\nServices:');
for (const [name, status] of Object.entries(health.services)) {
  console.log(`  ${name}: ${status.status}`);
}
```

### Provider Health

```typescript
// Check LLM provider status
const providers = await monitor.checkProviders();

for (const provider of providers) {
  console.log(`${provider.name}:`);
  console.log(`  Status: ${provider.status}`);
  console.log(`  Latency: ${provider.latencyMs}ms`);
  console.log(`  Last error: ${provider.lastError || 'none'}`);
  console.log(`  Error rate: ${provider.errorRate}%`);
}
```

### Alert Management

```typescript
// Get recent alerts
const alerts = await monitor.getAlerts({ limit: 10 });

for (const alert of alerts) {
  console.log(`[${alert.severity}] ${alert.title}`);
  console.log(`  ${alert.message}`);
  console.log(`  Time: ${alert.timestamp}`);
  console.log(`  Acknowledged: ${alert.acknowledged}`);
}

// Acknowledge alert
await monitor.acknowledgeAlert(alertId);

// Get unread count
const unread = await monitor.getUnreadAlertCount();
```

### Alert Targets

```typescript
// Add alert target
await monitor.addAlertTarget({
  type: 'email',
  address: 'team@example.com',
});

await monitor.addAlertTarget({
  type: 'webhook',
  url: 'https://hooks.slack.com/...',
});

// List targets
const targets = monitor.getAlertTargets();

// Remove target
await monitor.removeAlertTarget(targetId);
```

### Event Handlers

```typescript
// Listen for events
monitor.on('alert', (alert) => {
  console.log(`🚨 Alert: ${alert.title}`);
});

monitor.on('healthCheck', (health) => {
  if (health.status !== 'healthy') {
    console.log(`⚠️ System ${health.status}`);
  }
});

monitor.on('providerDown', (provider) => {
  console.log(`❌ Provider down: ${provider.name}`);
});

monitor.on('providerRecovered', (provider) => {
  console.log(`✅ Provider recovered: ${provider.name}`);
});
```

### Manual Alerts

```typescript
// Send manual alert
await monitor.sendAlert({
  severity: 'warning',  // 'info' | 'warning' | 'error' | 'critical'
  title: 'Custom Alert',
  message: 'Something important happened',
  metadata: { key: 'value' },
});
```

---

## Alert Types

| Type | Trigger |
|------|---------|
| **provider_down** | LLM provider not responding |
| **high_cpu** | CPU usage above threshold |
| **high_memory** | Memory usage above threshold |
| **high_error_rate** | Error rate above threshold |
| **unhandled_exception** | Uncaught exception |
| **unhandled_rejection** | Unhandled promise rejection |

---

## Configuration

```typescript
// Update config
monitor.configure({
  intervalMs: 30000,
  alertCooldownMs: 600000,
  thresholds: {
    cpu: 85,
    memory: 95,
    errorRate: 5,
  },
});
```

---

## Best Practices

1. **Set appropriate thresholds** - Avoid alert fatigue
2. **Use cooldowns** - Prevent alert spam
3. **Multiple targets** - Email + webhook for redundancy
4. **Acknowledge alerts** - Track what's been handled
5. **Monitor providers** - Know when APIs are down
6. **Check health regularly** - Don't just rely on alerts
