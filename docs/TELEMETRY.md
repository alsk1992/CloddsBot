# Telemetry & Observability Guide

Clodds includes a comprehensive OpenTelemetry integration for monitoring and debugging.

## Overview

The telemetry module (`src/telemetry/index.ts`) provides:

- **Distributed Tracing**: Track requests across services
- **Metrics**: Prometheus-compatible metrics
- **LLM Instrumentation**: Specialized tracing for AI operations

## Configuration

### Basic Setup

```json
{
  "telemetry": {
    "enabled": true,
    "serviceName": "clodds",
    "serviceVersion": "0.1.0",
    "environment": "production"
  }
}
```

### Full Configuration

```json
{
  "telemetry": {
    "enabled": true,
    "serviceName": "clodds",
    "serviceVersion": "0.1.0",
    "environment": "production",
    "otlpEndpoint": "http://localhost:4318",
    "jaegerEndpoint": "http://localhost:14268",
    "zipkinEndpoint": "http://localhost:9411",
    "metricsPort": 9090,
    "sampleRate": 1.0,
    "resourceAttributes": {
      "deployment.region": "us-west-2"
    }
  }
}
```

| Option | Description | Default |
|--------|-------------|---------|
| `enabled` | Enable telemetry collection | `false` |
| `serviceName` | Service name in traces | `clodds` |
| `serviceVersion` | Service version | `0.1.0` |
| `environment` | Deployment environment | `development` |
| `otlpEndpoint` | OTLP collector endpoint | - |
| `jaegerEndpoint` | Jaeger endpoint | - |
| `zipkinEndpoint` | Zipkin endpoint | - |
| `metricsPort` | Prometheus metrics port | `9090` |
| `sampleRate` | Trace sampling rate (0.0-1.0) | `1.0` |

## Tracing

### Basic Tracing

```typescript
import { initTelemetry, getTelemetry } from 'clodds/telemetry';

// Initialize
const telemetry = initTelemetry({ enabled: true, serviceName: 'clodds' });

// Create trace
const span = telemetry.startTrace('my-operation', {
  'custom.attribute': 'value'
});

// Add events
telemetry.addEvent(span, 'checkpoint-reached', { step: 1 });

// Set attributes
telemetry.setAttribute(span, 'result.count', 42);

// End span
telemetry.endSpan(span, 'ok'); // or 'error'
```

### Child Spans

```typescript
const parentSpan = telemetry.startTrace('parent-operation');

const childSpan = telemetry.startSpan('child-operation', parentSpan, {
  'child.attribute': 'value'
});

// ... do work ...

telemetry.endSpan(childSpan, 'ok');
telemetry.endSpan(parentSpan, 'ok');
```

### Error Handling

```typescript
try {
  // ... operation ...
  telemetry.endSpan(span, 'ok');
} catch (error) {
  telemetry.endSpan(span, 'error', error);
  throw error;
}
```

## LLM Instrumentation

Specialized instrumentation for AI/LLM operations:

```typescript
import { createLLMInstrumentation, initTelemetry } from 'clodds/telemetry';

initTelemetry({ enabled: true, serviceName: 'clodds' });
const llmInstr = createLLMInstrumentation();

// Trace completion
const { result, span } = await llmInstr.traceCompletion(
  'anthropic',          // provider
  'claude-3-5-sonnet',  // model
  async () => {
    // Your LLM call
    return await client.complete({ messages });
  },
  {
    inputTokens: 100,
    promptLength: 500,
    userId: 'user-123',
  }
);

// Record token usage
llmInstr.recordTokenUsage(
  'anthropic',
  'claude-3-5-sonnet',
  100,  // input tokens
  500   // output tokens
);

// Trace tool calls
const parentSpan = telemetry.startTrace('chat');
const toolSpan = llmInstr.traceToolCall(parentSpan, 'search_markets');
// ... execute tool ...
telemetry.endSpan(toolSpan, 'ok');

// Trace streaming
const stream = llmInstr.traceStreaming(parentSpan);
for await (const chunk of response) {
  stream.onChunk(chunk.text);
}
stream.onComplete(totalTokens);
```

## Metrics

### Built-in Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `llm_requests_total` | Counter | LLM requests by provider/model/status |
| `llm_request_duration_ms` | Histogram | Request latency |
| `llm_tokens_input_total` | Counter | Input tokens used |
| `llm_tokens_output_total` | Counter | Output tokens used |
| `llm_tokens_by_user` | Counter | Tokens by user ID |

### Custom Metrics

```typescript
// Counter
telemetry.recordCounter('api_requests_total', 1, {
  endpoint: '/markets',
  method: 'GET',
});

// Gauge
telemetry.recordGauge('active_connections', 42, {
  channel: 'telegram',
});

// Histogram
telemetry.recordHistogram('request_duration_ms', 150, {
  endpoint: '/api/search',
});
```

### Prometheus Endpoint

Start the metrics server:

```typescript
telemetry.startMetricsServer(9090);
```

Access metrics at `http://localhost:9090/metrics`:

```
# TYPE llm_requests_total counter
llm_requests_total{provider="anthropic",model="claude-3-5-sonnet",status="success"} 42

# TYPE llm_request_duration_ms histogram
llm_request_duration_ms{provider="anthropic",model="claude-3-5-sonnet"} 150
```

### Prometheus Config

```yaml
scrape_configs:
  - job_name: 'clodds'
    static_configs:
      - targets: ['localhost:9090']
```

## Exporters

### OTLP (OpenTelemetry Protocol)

```json
{
  "telemetry": {
    "otlpEndpoint": "http://collector:4318"
  }
}
```

Compatible with:
- OpenTelemetry Collector
- Grafana Tempo
- Honeycomb
- Lightstep

### Jaeger

```json
{
  "telemetry": {
    "jaegerEndpoint": "http://jaeger:14268"
  }
}
```

### Zipkin

```json
{
  "telemetry": {
    "zipkinEndpoint": "http://zipkin:9411"
  }
}
```

## Health Check

```typescript
const health = telemetry.getHealth();
// {
//   healthy: true,
//   status: 'connected',
//   metrics: {
//     messagesSent: 100,
//     messagesReceived: 150,
//     uptime: 3600000,
//     ...
//   }
// }
```

## Shutdown

Always shutdown telemetry gracefully to flush buffered data:

```typescript
process.on('SIGTERM', async () => {
  await telemetry.shutdown();
  process.exit(0);
});
```

## Docker Compose Example

```yaml
version: '3'
services:
  clodds:
    build: .
    environment:
      - TELEMETRY_ENABLED=true
      - TELEMETRY_OTLP_ENDPOINT=http://collector:4318
    depends_on:
      - collector

  collector:
    image: otel/opentelemetry-collector:latest
    ports:
      - "4318:4318"
    volumes:
      - ./otel-config.yaml:/etc/otel/config.yaml

  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9091:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
```
