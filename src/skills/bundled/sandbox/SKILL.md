---
name: sandbox
description: "Safe code execution in Docker containers with resource limits"
emoji: "📦"
gates:
  envs:
    anyOf:
      - DOCKER_HOST
---

# Sandbox - Complete API Reference

Execute code safely in isolated Docker containers with resource limits and timeout protection.

---

## Chat Commands

### Run Code

```
/run python "print('Hello')"                Run Python code
/run node "console.log('Hi')"               Run JavaScript
/run bash "ls -la"                          Run shell command
/run ruby "puts 'Hello'"                    Run Ruby code
```

### With Options

```
/run python "code" --timeout 30             Set timeout (seconds)
/run node "code" --memory 512               Memory limit (MB)
/run python "code" --file script.py         From file
```

### Sandbox Management

```
/sandbox status                             Container status
/sandbox images                             Available images
/sandbox cleanup                            Remove old containers
```

---

## TypeScript API Reference

### Create Sandbox

```typescript
import { createSandbox } from 'clodds/sandbox';

const sandbox = createSandbox({
  // Docker settings
  dockerHost: process.env.DOCKER_HOST,

  // Default limits
  defaultTimeoutMs: 30000,
  defaultMemoryMB: 256,
  defaultCpuShares: 512,

  // Cleanup
  autoCleanup: true,
  maxContainerAgeMs: 3600000,
});
```

### Run Code

```typescript
// Run Python
const result = await sandbox.run({
  language: 'python',
  code: `
import math
print(f"Pi is {math.pi}")
  `,
});

console.log(`Output: ${result.stdout}`);
console.log(`Exit code: ${result.exitCode}`);
console.log(`Duration: ${result.durationMs}ms`);

// Run with limits
const result = await sandbox.run({
  language: 'node',
  code: `console.log('Hello from Node.js')`,
  timeout: 10000,
  memoryMB: 128,
});
```

### Supported Languages

```typescript
// Python
await sandbox.run({ language: 'python', code: 'print("Hello")' });

// JavaScript (Node.js)
await sandbox.run({ language: 'node', code: 'console.log("Hello")' });

// Bash
await sandbox.run({ language: 'bash', code: 'echo "Hello"' });

// Ruby
await sandbox.run({ language: 'ruby', code: 'puts "Hello"' });

// Go
await sandbox.run({ language: 'go', code: 'package main\nimport "fmt"\nfunc main() { fmt.Println("Hello") }' });
```

### Run From File

```typescript
const result = await sandbox.runFile({
  language: 'python',
  filePath: '/path/to/script.py',
  args: ['--input', 'data.csv'],
});
```

### Install Packages

```typescript
// Python packages
const result = await sandbox.run({
  language: 'python',
  code: `
import pandas as pd
print(pd.__version__)
  `,
  packages: ['pandas', 'numpy'],
});

// Node packages
const result = await sandbox.run({
  language: 'node',
  code: `
const _ = require('lodash');
console.log(_.VERSION);
  `,
  packages: ['lodash'],
});
```

### Resource Limits

```typescript
const result = await sandbox.run({
  language: 'python',
  code: 'import time; time.sleep(100)',

  // Limits
  timeout: 5000,        // 5 second timeout
  memoryMB: 256,        // 256 MB RAM
  cpuShares: 512,       // CPU shares (default 1024)
  networkDisabled: true, // No network access
});
```

### Container Management

```typescript
// Get status
const status = await sandbox.getStatus();
console.log(`Running containers: ${status.running}`);
console.log(`Total containers: ${status.total}`);

// List available images
const images = await sandbox.listImages();
for (const img of images) {
  console.log(`${img.language}: ${img.image}`);
}

// Cleanup old containers
await sandbox.cleanup({
  olderThan: '1h',
  status: 'exited',
});
```

---

## Language Images

| Language | Image | Version |
|----------|-------|---------|
| **python** | python:3.11-slim | 3.11 |
| **node** | node:20-slim | 20.x |
| **bash** | alpine:latest | Alpine |
| **ruby** | ruby:3.2-slim | 3.2 |
| **go** | golang:1.21-alpine | 1.21 |

---

## Resource Limits

| Resource | Default | Max |
|----------|---------|-----|
| **Timeout** | 30s | 300s |
| **Memory** | 256 MB | 2048 MB |
| **CPU** | 512 shares | 2048 shares |
| **Disk** | 100 MB | 1 GB |

---

## Security

| Feature | Description |
|---------|-------------|
| **Isolation** | Each run in separate container |
| **No network** | Network disabled by default |
| **No volumes** | No host filesystem access |
| **Read-only** | Filesystem is read-only |
| **Resource caps** | Memory and CPU limits |
| **Timeout** | Force kill after timeout |

---

## Use Cases

### Run Backtest

```typescript
const result = await sandbox.run({
  language: 'python',
  code: backtestCode,
  packages: ['pandas', 'numpy', 'ta'],
  timeout: 60000,
  memoryMB: 512,
});
```

### Data Processing

```typescript
const result = await sandbox.run({
  language: 'python',
  code: `
import json
data = ${JSON.stringify(inputData)}
result = process(data)
print(json.dumps(result))
  `,
});
const output = JSON.parse(result.stdout);
```

---

## Best Practices

1. **Set timeouts** — Prevent runaway code
2. **Limit memory** — Avoid OOM
3. **Disable network** — Unless needed
4. **Use slim images** — Faster startup
5. **Cleanup regularly** — Remove old containers
