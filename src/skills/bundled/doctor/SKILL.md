---
name: doctor
description: "System health diagnostics and troubleshooting"
emoji: "🩺"
---

# Doctor - Complete API Reference

Run system diagnostics, check health status, and troubleshoot issues.

---

## Chat Commands

### Health Checks

```
/doctor                                     Run all diagnostics
/doctor quick                               Quick health check
/doctor full                                Full diagnostic scan
/doctor <component>                         Check specific component
```

### Component Checks

```
/doctor system                              OS, memory, disk
/doctor node                                Node.js version, memory
/doctor network                             Connectivity tests
/doctor api                                 API key validation
/doctor database                            Database connection
/doctor channels                            Channel health
```

### Status

```
/health                                     Quick health status
/status                                     System status overview
/status verbose                             Detailed status
```

---

## TypeScript API Reference

### Create Doctor Service

```typescript
import { createDoctorService } from 'clodds/doctor';

const doctor = createDoctorService({
  // Checks to run
  checks: ['system', 'node', 'network', 'api', 'database', 'channels'],

  // Thresholds
  thresholds: {
    memoryWarning: 80,    // % memory usage
    memoryCritical: 95,
    diskWarning: 80,      // % disk usage
    diskCritical: 95,
    latencyWarning: 1000, // ms
    latencyCritical: 5000,
  },

  // Timeout
  timeoutMs: 30000,
});
```

### Run Diagnostics

```typescript
// Run all checks
const report = await doctor.runDiagnostics();

console.log(`Overall: ${report.status}`);  // 'healthy' | 'degraded' | 'unhealthy'
console.log(`Checks passed: ${report.passed}/${report.total}`);

for (const check of report.checks) {
  const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
  console.log(`${icon} ${check.name}: ${check.message}`);
  if (check.details) {
    console.log(`  ${JSON.stringify(check.details)}`);
  }
}
```

### Run Specific Check

```typescript
// Check system resources
const system = await doctor.checkSystem();

console.log(`OS: ${system.os} ${system.version}`);
console.log(`CPU: ${system.cpuUsage}%`);
console.log(`Memory: ${system.memoryUsage}% (${system.memoryUsedGB}/${system.memoryTotalGB} GB)`);
console.log(`Disk: ${system.diskUsage}% (${system.diskUsedGB}/${system.diskTotalGB} GB)`);
```

### Check Node.js

```typescript
const node = await doctor.checkNode();

console.log(`Node.js: ${node.version}`);
console.log(`Heap: ${node.heapUsed}/${node.heapTotal} MB`);
console.log(`RSS: ${node.rss} MB`);
console.log(`Uptime: ${node.uptime} seconds`);
```

### Check Network

```typescript
const network = await doctor.checkNetwork();

console.log(`Internet: ${network.internet ? 'Connected' : 'Disconnected'}`);
console.log(`DNS: ${network.dns ? 'Working' : 'Failed'}`);

for (const [endpoint, result] of Object.entries(network.endpoints)) {
  console.log(`${endpoint}: ${result.reachable ? 'OK' : 'Failed'} (${result.latencyMs}ms)`);
}
```

### Check API Keys

```typescript
const api = await doctor.checkApiKeys();

for (const [provider, status] of Object.entries(api)) {
  console.log(`${provider}: ${status.valid ? 'Valid' : 'Invalid'}`);
  if (status.error) {
    console.log(`  Error: ${status.error}`);
  }
  if (status.quota) {
    console.log(`  Quota: ${status.quota.used}/${status.quota.limit}`);
  }
}
```

### Check Database

```typescript
const db = await doctor.checkDatabase();

console.log(`Connected: ${db.connected}`);
console.log(`Latency: ${db.latencyMs}ms`);
console.log(`Version: ${db.version}`);
console.log(`Tables: ${db.tables}`);
console.log(`Size: ${db.sizeMB} MB`);
```

### Check Channels

```typescript
const channels = await doctor.checkChannels();

for (const channel of channels) {
  console.log(`${channel.name}: ${channel.status}`);
  if (channel.error) {
    console.log(`  Error: ${channel.error}`);
  }
  console.log(`  Connected: ${channel.connected}`);
  console.log(`  Last message: ${channel.lastMessage}`);
}
```

### Format Report

```typescript
// Get formatted report
const report = await doctor.runDiagnostics();
const formatted = doctor.formatReport(report);

console.log(formatted);
// Outputs nicely formatted diagnostic report
```

---

## Diagnostic Checks

| Check | What it Tests |
|-------|---------------|
| **system** | OS, CPU, memory, disk |
| **node** | Node.js version, heap, memory |
| **network** | Internet, DNS, API endpoints |
| **api** | API key validity and quotas |
| **database** | Connection, latency, schema |
| **channels** | Channel connections, health |
| **mcp** | MCP server connections |
| **dependencies** | npm packages, versions |

---

## Status Levels

| Status | Meaning |
|--------|---------|
| **healthy** | All checks pass |
| **degraded** | Some warnings, still functional |
| **unhealthy** | Critical failures, action needed |

### Check Results

| Result | Meaning |
|--------|---------|
| **pass** | Check succeeded |
| **warn** | Warning threshold exceeded |
| **fail** | Critical failure |
| **skip** | Check skipped (not applicable) |

---

## CLI Commands

```bash
# Run all diagnostics
clodds doctor

# Quick check
clodds doctor --quick

# Check specific component
clodds doctor --check system

# JSON output
clodds doctor --json
```

---

## Common Issues

### High Memory Usage
```
⚠ Memory: 85% used
```
**Solution**: Restart the service or increase available memory

### API Key Invalid
```
✗ Anthropic API: Invalid key
```
**Solution**: Check ANTHROPIC_API_KEY in .env

### Database Connection Failed
```
✗ Database: Connection refused
```
**Solution**: Check DATABASE_URL and ensure PostgreSQL is running

### Channel Disconnected
```
⚠ Telegram: Disconnected
```
**Solution**: Check TELEGRAM_BOT_TOKEN and network connectivity

---

## Best Practices

1. **Run regularly** — Check health daily or after changes
2. **Monitor trends** — Watch for gradual degradation
3. **Set alerts** — Alert on unhealthy status
4. **Fix warnings** — Don't wait for failures
5. **Review before deploy** — Run doctor before production changes
