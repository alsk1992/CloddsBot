---
name: metrics
description: "System metrics, telemetry, and performance monitoring"
emoji: "📈"
---

# Metrics - Complete API Reference

Monitor system health, track performance metrics, and analyze telemetry data.

---

## Chat Commands

### System Metrics

```
/metrics                               Show current metrics
/metrics system                        CPU, memory, latency
/metrics api                           API performance stats
/metrics ws                            WebSocket health
```

### Trading Metrics

```
/metrics trades                        Trade execution stats
/metrics fills                         Fill rate metrics
/metrics latency                       Order latency stats
/metrics errors                        Error rates
```

### Custom Metrics

```
/metrics track <name> <value>          Track custom metric
/metrics query <name>                  Query metric history
/metrics alert <name> > 100            Set metric alert
```

### Export & Reports

```
/metrics export csv                    Export to CSV
/metrics report daily                  Generate daily report
/metrics dashboard                     Open metrics dashboard
```

---

## TypeScript API Reference

### Create Metrics Service

```typescript
import { createMetricsService } from 'clodds/metrics';

const metrics = createMetricsService({
  // Collection
  collectInterval: 5000,  // ms
  retention: '30d',

  // Storage
  storage: 'sqlite',
  dbPath: './metrics.db',

  // Export
  enablePrometheus: true,
  prometheusPort: 9090,
});

// Start collection
await metrics.start();
```

### System Metrics

```typescript
const system = await metrics.getSystemMetrics();

console.log('=== System Health ===');
console.log(`CPU Usage: ${system.cpuUsage}%`);
console.log(`Memory: ${system.memoryUsed}MB / ${system.memoryTotal}MB`);
console.log(`Uptime: ${system.uptimeHours}h`);
console.log(`Active connections: ${system.activeConnections}`);
console.log(`Event loop lag: ${system.eventLoopLag}ms`);
```

### API Metrics

```typescript
const api = await metrics.getApiMetrics();

console.log('=== API Performance ===');
console.log(`Total requests: ${api.totalRequests}`);
console.log(`Requests/sec: ${api.requestsPerSecond}`);
console.log(`Avg latency: ${api.avgLatency}ms`);
console.log(`P50 latency: ${api.p50Latency}ms`);
console.log(`P95 latency: ${api.p95Latency}ms`);
console.log(`P99 latency: ${api.p99Latency}ms`);
console.log(`Error rate: ${api.errorRate}%`);

console.log('\nBy Endpoint:');
for (const endpoint of api.byEndpoint) {
  console.log(`  ${endpoint.path}: ${endpoint.avgLatency}ms (${endpoint.calls} calls)`);
}
```

### WebSocket Metrics

```typescript
const ws = await metrics.getWebSocketMetrics();

console.log('=== WebSocket Health ===');
console.log(`Active connections: ${ws.activeConnections}`);
console.log(`Messages/sec: ${ws.messagesPerSecond}`);
console.log(`Avg message size: ${ws.avgMessageSize} bytes`);
console.log(`Reconnections: ${ws.reconnections}`);
console.log(`Dropped messages: ${ws.droppedMessages}`);

console.log('\nBy Feed:');
for (const feed of ws.byFeed) {
  console.log(`  ${feed.name}: ${feed.messagesPerSecond}/s, ${feed.latency}ms lag`);
}
```

### Trade Execution Metrics

```typescript
const trades = await metrics.getTradeMetrics();

console.log('=== Trade Execution ===');
console.log(`Total orders: ${trades.totalOrders}`);
console.log(`Fill rate: ${trades.fillRate}%`);
console.log(`Partial fills: ${trades.partialFillRate}%`);
console.log(`Rejections: ${trades.rejectionRate}%`);
console.log(`Avg fill time: ${trades.avgFillTime}ms`);
console.log(`Avg slippage: ${trades.avgSlippage}%`);

console.log('\nBy Platform:');
for (const platform of trades.byPlatform) {
  console.log(`  ${platform.name}:`);
  console.log(`    Fill rate: ${platform.fillRate}%`);
  console.log(`    Avg latency: ${platform.avgLatency}ms`);
}
```

### Latency Breakdown

```typescript
const latency = await metrics.getLatencyBreakdown();

console.log('=== Latency Breakdown ===');
console.log(`Total order latency: ${latency.total}ms`);
console.log(`  Signal processing: ${latency.signalProcessing}ms`);
console.log(`  Order construction: ${latency.orderConstruction}ms`);
console.log(`  Network round-trip: ${latency.networkRoundTrip}ms`);
console.log(`  Exchange processing: ${latency.exchangeProcessing}ms`);
console.log(`  Confirmation: ${latency.confirmation}ms`);
```

### Error Metrics

```typescript
const errors = await metrics.getErrorMetrics();

console.log('=== Error Rates ===');
console.log(`Total errors: ${errors.totalErrors}`);
console.log(`Error rate: ${errors.errorRate}%`);
console.log(`Errors/hour: ${errors.errorsPerHour}`);

console.log('\nBy Type:');
for (const type of errors.byType) {
  console.log(`  ${type.name}: ${type.count} (${type.percentage}%)`);
}

console.log('\nBy Platform:');
for (const platform of errors.byPlatform) {
  console.log(`  ${platform.name}: ${platform.errorRate}%`);
}
```

### Custom Metrics

```typescript
// Track custom metric
metrics.track('edge_detected', 1, {
  market: 'trump-2028',
  edgeSize: 0.05,
});

// Increment counter
metrics.increment('trades_executed');

// Set gauge
metrics.gauge('active_positions', 5);

// Record timing
const timer = metrics.startTimer('order_execution');
// ... execute order ...
timer.end();

// Histogram
metrics.histogram('slippage', 0.003, {
  platform: 'polymarket',
});
```

### Query Metrics

```typescript
const query = await metrics.query({
  metric: 'edge_detected',
  period: '7d',
  aggregation: 'sum',
  groupBy: 'market',
});

console.log('Edge Detection by Market:');
for (const row of query.results) {
  console.log(`  ${row.market}: ${row.value} detections`);
}
```

### Metric Alerts

```typescript
// Set alert threshold
metrics.setAlert({
  metric: 'error_rate',
  condition: '>',
  threshold: 5,  // > 5% error rate
  window: '5m',
  action: 'notify',
});

metrics.setAlert({
  metric: 'latency_p99',
  condition: '>',
  threshold: 1000,  // > 1000ms
  window: '1m',
  action: 'escalate',
});

// Alert handlers
metrics.on('alert', (alert) => {
  console.log(`🚨 Alert: ${alert.metric} ${alert.condition} ${alert.threshold}`);
  console.log(`  Current value: ${alert.currentValue}`);
});
```

### Export Metrics

```typescript
// Export to CSV
await metrics.export({
  format: 'csv',
  metrics: ['api_latency', 'trade_fill_rate', 'error_rate'],
  period: '30d',
  outputPath: './metrics-export.csv',
});

// Export to Prometheus
const prometheusFormat = metrics.toPrometheus();

// Export to JSON
const jsonMetrics = await metrics.toJSON({
  period: '24h',
});
```

### Generate Reports

```typescript
const report = await metrics.generateReport({
  type: 'daily',
  include: ['summary', 'api', 'trades', 'errors'],
});

console.log('=== Daily Metrics Report ===');
console.log(`Date: ${report.date}`);
console.log(`\nSummary:`);
console.log(`  Uptime: ${report.summary.uptime}%`);
console.log(`  Total requests: ${report.summary.totalRequests}`);
console.log(`  Total trades: ${report.summary.totalTrades}`);
console.log(`  Error rate: ${report.summary.errorRate}%`);
console.log(`\nHighlights:`);
for (const highlight of report.highlights) {
  console.log(`  - ${highlight}`);
}
```

### Real-time Streaming

```typescript
// Stream metrics in real-time
const stream = metrics.stream(['cpu', 'memory', 'latency']);

stream.on('data', (data) => {
  console.log(`CPU: ${data.cpu}%, Memory: ${data.memory}MB, Latency: ${data.latency}ms`);
});

// Stop streaming
stream.stop();
```

---

## Metric Types

| Type | Description | Example |
|------|-------------|---------|
| **Counter** | Monotonic increasing | `trades_total` |
| **Gauge** | Point-in-time value | `active_positions` |
| **Histogram** | Distribution | `latency_ms` |
| **Timer** | Duration measurement | `order_execution_time` |

---

## Built-in Metrics

| Category | Metrics |
|----------|---------|
| **System** | cpu_usage, memory_used, uptime, connections |
| **API** | request_count, latency_p50/p95/p99, error_rate |
| **WebSocket** | messages_per_sec, lag, reconnections |
| **Trades** | orders_total, fill_rate, slippage, execution_time |
| **Errors** | error_count, error_rate_by_type |

---

## Best Practices

1. **Monitor latency percentiles** — P99 matters more than average
2. **Set alerts proactively** — Catch issues before users notice
3. **Track custom metrics** — Business-specific KPIs
4. **Review daily reports** — Spot trends early
5. **Export for analysis** — Use external tools for deep dives
