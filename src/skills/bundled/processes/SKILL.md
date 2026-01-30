---
name: processes
description: "Background jobs, long-running processes, and task management"
emoji: "⚙️"
---

# Processes - Complete API Reference

Spawn and manage background processes, long-running jobs, and scheduled tasks.

---

## Chat Commands

### Spawn Jobs

```
/job spawn "npm run backtest"               Start background job
/job spawn "python train.py" --name ml      Named job
/job spawn "node bot.js" --restart          Auto-restart on exit
```

### Manage Jobs

```
/jobs                                       List all jobs
/job status <id>                            Check job status
/job output <id>                            View job output
/job output <id> --follow                   Stream output
/job stop <id>                              Stop job
/job restart <id>                           Restart job
```

### Logs

```
/job logs <id>                              View logs
/job logs <id> --tail 100                   Last 100 lines
/job logs <id> --since 1h                   Last hour
```

---

## TypeScript API Reference

### Create Process Manager

```typescript
import { createProcessManager } from 'clodds/processes';

const processes = createProcessManager({
  // Working directory
  cwd: process.cwd(),

  // Environment
  env: process.env,

  // Limits
  maxProcesses: 10,
  maxMemoryMB: 1024,

  // Logging
  logDir: './logs/jobs',
  maxLogSizeMB: 100,

  // Storage
  storage: 'sqlite',
  dbPath: './jobs.db',
});
```

### Spawn Process

```typescript
// Simple spawn
const job = await processes.spawn({
  command: 'npm',
  args: ['run', 'backtest'],
  name: 'backtest-btc',
});

console.log(`Job ID: ${job.id}`);
console.log(`PID: ${job.pid}`);

// With options
const job = await processes.spawn({
  command: 'python',
  args: ['train.py', '--epochs', '100'],
  name: 'ml-training',

  // Environment
  env: {
    ...process.env,
    CUDA_VISIBLE_DEVICES: '0',
  },

  // Working directory
  cwd: '/path/to/ml-project',

  // Auto-restart
  restart: true,
  maxRestarts: 3,
  restartDelayMs: 5000,

  // Resource limits
  maxMemoryMB: 4096,
  timeoutMs: 3600000,  // 1 hour
});
```

### List Jobs

```typescript
const jobs = await processes.list();

for (const job of jobs) {
  console.log(`${job.id}: ${job.name}`);
  console.log(`  Status: ${job.status}`);  // 'running' | 'stopped' | 'failed' | 'completed'
  console.log(`  PID: ${job.pid}`);
  console.log(`  Started: ${job.startedAt}`);
  console.log(`  Memory: ${job.memoryMB}MB`);
  console.log(`  CPU: ${job.cpuPercent}%`);
}
```

### Get Status

```typescript
const status = await processes.getStatus(jobId);

console.log(`Status: ${status.status}`);
console.log(`Exit code: ${status.exitCode}`);
console.log(`Runtime: ${status.runtimeMs}ms`);
console.log(`Restarts: ${status.restarts}`);
console.log(`Memory: ${status.memoryMB}MB`);
console.log(`CPU: ${status.cpuPercent}%`);
```

### Get Output

```typescript
// Get all output
const output = await processes.getOutput(jobId);
console.log(output.stdout);
console.log(output.stderr);

// Get last N lines
const output = await processes.getOutput(jobId, { tail: 100 });

// Stream output
const stream = processes.streamOutput(jobId);
stream.on('stdout', (data) => console.log(data));
stream.on('stderr', (data) => console.error(data));
stream.on('exit', (code) => console.log(`Exit: ${code}`));
```

### Stop Job

```typescript
// Graceful stop (SIGTERM)
await processes.stop(jobId);

// Force kill (SIGKILL)
await processes.stop(jobId, { force: true });

// Stop all
await processes.stopAll();
```

### Restart Job

```typescript
await processes.restart(jobId);
```

### Event Handlers

```typescript
processes.on('started', (job) => {
  console.log(`Job started: ${job.name}`);
});

processes.on('stopped', (job) => {
  console.log(`Job stopped: ${job.name} (code: ${job.exitCode})`);
});

processes.on('failed', (job, error) => {
  console.error(`Job failed: ${job.name}`, error);
});

processes.on('output', (job, type, data) => {
  console.log(`[${job.name}] ${type}: ${data}`);
});
```

---

## Job Status

| Status | Description |
|--------|-------------|
| `running` | Currently executing |
| `stopped` | Stopped by user |
| `completed` | Finished successfully |
| `failed` | Exited with error |
| `restarting` | Auto-restarting |

---

## Use Cases

### Run Backtest

```typescript
const job = await processes.spawn({
  command: 'npm',
  args: ['run', 'backtest', '--', '--strategy', 'momentum'],
  name: 'backtest-momentum',
});

// Wait for completion
const result = await processes.wait(job.id);
console.log(`Backtest complete: ${result.exitCode === 0 ? 'success' : 'failed'}`);
```

### Train ML Model

```typescript
const job = await processes.spawn({
  command: 'python',
  args: ['train.py'],
  name: 'ml-training',
  cwd: './ml',
  maxMemoryMB: 8192,
  timeoutMs: 86400000,  // 24 hours
});

// Monitor progress
processes.streamOutput(job.id).on('stdout', (line) => {
  if (line.includes('Epoch')) {
    console.log(line);
  }
});
```

---

## Best Practices

1. **Name your jobs** — Easier to identify
2. **Set timeouts** — Prevent runaway processes
3. **Monitor memory** — Prevent OOM kills
4. **Use restart sparingly** — Debug failures first
5. **Check logs** — Always review output
