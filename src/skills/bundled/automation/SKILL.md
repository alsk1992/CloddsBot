---
name: automation
description: "Schedule cron jobs, manage webhooks, and automate recurring tasks"
emoji: "⏰"
---

# Automation - Complete API Reference

Schedule recurring tasks with cron expressions, manage incoming webhooks, and automate workflows.

---

## Chat Commands

### Cron Jobs

```
/cron list                                  # List all scheduled jobs
/cron add "0 9 * * *" "scan for arbs"       # Add daily 9am job
/cron add "*/30 * * * *" "check prices"     # Every 30 minutes
/cron remove <job-id>                       # Remove job
/cron enable <job-id>                       # Enable job
/cron disable <job-id>                      # Disable job
/cron run <job-id>                          # Run job now
/cron history <job-id>                      # View run history
```

### Webhooks

```
/webhook list                               # List webhooks
/webhook add <name> <url>                   # Add webhook endpoint
/webhook remove <name>                      # Remove webhook
/webhook test <name>                        # Send test payload
/webhook logs <name>                        # View webhook logs
```

### Heartbeat

```
/heartbeat config --interval 60             # Set heartbeat interval
/heartbeat status                           # View heartbeat status
/heartbeat enable                           # Enable heartbeats
/heartbeat disable                          # Disable heartbeats
```

---

## TypeScript API Reference

### Cron Scheduler

```typescript
import { createCronScheduler } from 'clodds/automation';

const cron = createCronScheduler({
  timezone: 'America/New_York',
  autoStart: true,
});

// Add a job
const jobId = cron.addJob({
  name: 'daily-arb-scan',
  schedule: '0 9 * * *',  // 9am daily
  task: async () => {
    console.log('Running arbitrage scan...');
    // Your logic here
  },
  enabled: true,
});

// List jobs
const jobs = cron.listJobs();
for (const job of jobs) {
  console.log(`${job.id}: ${job.name} (${job.schedule})`);
  console.log(`  Next run: ${job.nextRun}`);
  console.log(`  Enabled: ${job.enabled}`);
}

// Remove job
cron.removeJob(jobId);

// Enable/disable
cron.enableJob(jobId);
cron.disableJob(jobId);

// Run immediately
await cron.runJob(jobId);

// Get history
const history = cron.getHistory(jobId, { limit: 10 });
for (const run of history) {
  console.log(`${run.timestamp}: ${run.status} (${run.duration}ms)`);
}
```

### Cron Expressions

| Expression | Description |
|------------|-------------|
| `* * * * *` | Every minute |
| `0 * * * *` | Every hour |
| `0 9 * * *` | Daily at 9am |
| `0 9 * * 1-5` | Weekdays at 9am |
| `*/15 * * * *` | Every 15 minutes |
| `0 0 1 * *` | First of month |

### Webhook Manager

```typescript
import { createWebhookManager } from 'clodds/automation';

const webhooks = createWebhookManager({
  secret: process.env.WEBHOOK_SECRET,
  validateSignatures: true,
});

// Register webhook endpoint
webhooks.register({
  name: 'trade-alerts',
  handler: async (payload) => {
    console.log('Received:', payload);
    // Process webhook
    return { status: 'ok' };
  },
  validatePayload: (payload) => {
    return payload.type && payload.data;
  },
});

// Get webhook URL
const url = webhooks.getUrl('trade-alerts');
console.log(`Webhook URL: ${url}`);

// Send test
await webhooks.test('trade-alerts', {
  type: 'test',
  data: { message: 'Hello' },
});

// View logs
const logs = webhooks.getLogs('trade-alerts', { limit: 10 });
for (const log of logs) {
  console.log(`${log.timestamp}: ${log.status}`);
  console.log(`  Payload: ${JSON.stringify(log.payload)}`);
}

// Remove webhook
webhooks.remove('trade-alerts');
```

### Heartbeat Service

```typescript
import { createHeartbeatService } from 'clodds/automation';

const heartbeat = createHeartbeatService({
  intervalMs: 60000,  // 1 minute
  endpoint: 'https://healthcheck.example.com/ping',
  onFailure: (error) => {
    console.error('Heartbeat failed:', error);
  },
});

// Start
heartbeat.start();

// Get status
const status = heartbeat.getStatus();
console.log(`Last ping: ${status.lastPing}`);
console.log(`Failures: ${status.failures}`);
console.log(`Uptime: ${status.uptime}%`);

// Stop
heartbeat.stop();
```

---

## Example Automations

### Daily Arbitrage Scan

```typescript
cron.addJob({
  name: 'daily-arb',
  schedule: '0 9,12,15,18 * * *',  // 9am, 12pm, 3pm, 6pm
  task: async () => {
    const opportunities = await opportunityFinder.scan();
    if (opportunities.length > 0) {
      await notify(`Found ${opportunities.length} arbitrage opportunities`);
    }
  },
});
```

### Portfolio Snapshot

```typescript
cron.addJob({
  name: 'portfolio-snapshot',
  schedule: '0 0 * * *',  // Midnight daily
  task: async () => {
    const portfolio = await trading.getPortfolio();
    await database.saveSnapshot({
      timestamp: Date.now(),
      value: portfolio.totalValue,
      positions: portfolio.positions.length,
    });
  },
});
```

### Webhook for External Signals

```typescript
webhooks.register({
  name: 'external-signals',
  handler: async (payload) => {
    if (payload.signal === 'buy') {
      await executor.marketBuy({
        platform: 'polymarket',
        marketId: payload.marketId,
        side: 'YES',
        size: 100,
      });
    }
    return { executed: true };
  },
});
```

---

## Best Practices

1. **Use meaningful job names** - Easy to identify later
2. **Set appropriate intervals** - Don't spam APIs
3. **Handle failures gracefully** - Add retry logic
4. **Monitor job history** - Check for failures
5. **Validate webhook payloads** - Prevent bad data
6. **Use heartbeats** - Know when system is down
