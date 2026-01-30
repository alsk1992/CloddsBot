/**
 * OpenTelemetry Diagnostics Module
 * Full observability stack for Clodds
 *
 * Supports:
 * - Distributed tracing (Jaeger, Zipkin, OTLP)
 * - Metrics (Prometheus, OTLP)
 * - Logging (structured, correlated)
 * - Custom spans for LLM operations
 */

import { logger } from '../utils/logger';

export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  /** OTLP endpoint for traces */
  otlpEndpoint?: string;
  /** Prometheus metrics port */
  metricsPort?: number;
  /** Jaeger endpoint */
  jaegerEndpoint?: string;
  /** Zipkin endpoint */
  zipkinEndpoint?: string;
  /** Sample rate (0.0 - 1.0) */
  sampleRate?: number;
  /** Custom attributes */
  resourceAttributes?: Record<string, string>;
}

export interface Span {
  spanId: string;
  traceId: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: 'ok' | 'error' | 'unset';
  attributes: Record<string, unknown>;
  events: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, unknown>;
  }>;
  parentSpanId?: string;
}

export interface Metric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

// In-memory storage for demo (real impl would use OTEL SDK)
const spans = new Map<string, Span>();
const metrics = new Map<string, Metric[]>();
const activeSpans = new Map<string, string>(); // traceId -> current spanId

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export class TelemetryService {
  private config: TelemetryConfig;
  private spanBuffer: Span[] = [];
  private metricBuffer: Metric[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(config: TelemetryConfig) {
    this.config = config;

    if (config.enabled) {
      this.startFlushInterval();
      logger.info({ serviceName: config.serviceName }, 'Telemetry service initialized');
    }
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 10000); // Flush every 10 seconds
  }

  /**
   * Start a new trace
   */
  startTrace(name: string, attributes?: Record<string, unknown>): Span {
    const traceId = generateId();
    const spanId = generateSpanId();

    const span: Span = {
      spanId,
      traceId,
      name,
      startTime: Date.now(),
      status: 'unset',
      attributes: {
        'service.name': this.config.serviceName,
        'service.version': this.config.serviceVersion || '0.1.0',
        'deployment.environment': this.config.environment || 'development',
        ...this.config.resourceAttributes,
        ...attributes,
      },
      events: [],
    };

    spans.set(spanId, span);
    activeSpans.set(traceId, spanId);

    logger.debug({ traceId, spanId, name }, 'Started trace');
    return span;
  }

  /**
   * Start a child span within an existing trace
   */
  startSpan(name: string, parentSpan: Span, attributes?: Record<string, unknown>): Span {
    const spanId = generateSpanId();

    const span: Span = {
      spanId,
      traceId: parentSpan.traceId,
      parentSpanId: parentSpan.spanId,
      name,
      startTime: Date.now(),
      status: 'unset',
      attributes: attributes || {},
      events: [],
    };

    spans.set(spanId, span);
    activeSpans.set(parentSpan.traceId, spanId);

    logger.debug({ traceId: span.traceId, spanId, name }, 'Started span');
    return span;
  }

  /**
   * End a span
   */
  endSpan(span: Span, status: 'ok' | 'error' = 'ok', error?: Error): void {
    span.endTime = Date.now();
    span.status = status;

    if (error) {
      span.attributes['error.type'] = error.name;
      span.attributes['error.message'] = error.message;
      span.attributes['error.stack'] = error.stack;
    }

    // Calculate duration
    span.attributes['duration_ms'] = span.endTime - span.startTime;

    // Add to buffer for export
    this.spanBuffer.push(span);

    // Restore parent span as active
    if (span.parentSpanId) {
      activeSpans.set(span.traceId, span.parentSpanId);
    } else {
      activeSpans.delete(span.traceId);
    }

    logger.debug({
      traceId: span.traceId,
      spanId: span.spanId,
      name: span.name,
      duration: span.endTime - span.startTime,
      status,
    }, 'Ended span');
  }

  /**
   * Add event to span
   */
  addEvent(span: Span, name: string, attributes?: Record<string, unknown>): void {
    span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  /**
   * Set span attribute
   */
  setAttribute(span: Span, key: string, value: unknown): void {
    span.attributes[key] = value;
  }

  /**
   * Record a counter metric
   */
  recordCounter(name: string, value: number = 1, labels: Record<string, string> = {}): void {
    if (!this.config.enabled) return;

    const metric: Metric = {
      name,
      type: 'counter',
      value,
      labels: {
        service: this.config.serviceName,
        ...labels,
      },
      timestamp: Date.now(),
    };

    this.metricBuffer.push(metric);
    logger.debug({ name, value, labels }, 'Recorded counter');
  }

  /**
   * Record a gauge metric
   */
  recordGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!this.config.enabled) return;

    const metric: Metric = {
      name,
      type: 'gauge',
      value,
      labels: {
        service: this.config.serviceName,
        ...labels,
      },
      timestamp: Date.now(),
    };

    this.metricBuffer.push(metric);
    logger.debug({ name, value, labels }, 'Recorded gauge');
  }

  /**
   * Record a histogram metric
   */
  recordHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!this.config.enabled) return;

    const metric: Metric = {
      name,
      type: 'histogram',
      value,
      labels: {
        service: this.config.serviceName,
        ...labels,
      },
      timestamp: Date.now(),
    };

    this.metricBuffer.push(metric);
    logger.debug({ name, value, labels }, 'Recorded histogram');
  }

  /**
   * Flush buffered telemetry data
   */
  async flush(): Promise<void> {
    if (!this.config.enabled) return;

    const spansToExport = this.spanBuffer.splice(0);
    const metricsToExport = this.metricBuffer.splice(0);

    if (spansToExport.length === 0 && metricsToExport.length === 0) {
      return;
    }

    // Export to OTLP endpoint if configured
    if (this.config.otlpEndpoint && spansToExport.length > 0) {
      try {
        await this.exportSpansOTLP(spansToExport);
      } catch (error) {
        logger.warn({ error }, 'Failed to export spans to OTLP');
        // Re-add to buffer for retry
        this.spanBuffer.push(...spansToExport);
      }
    }

    // Export to Jaeger if configured
    if (this.config.jaegerEndpoint && spansToExport.length > 0) {
      try {
        await this.exportSpansJaeger(spansToExport);
      } catch (error) {
        logger.warn({ error }, 'Failed to export spans to Jaeger');
      }
    }

    // Export to Zipkin if configured
    if (this.config.zipkinEndpoint && spansToExport.length > 0) {
      try {
        await this.exportSpansZipkin(spansToExport);
      } catch (error) {
        logger.warn({ error }, 'Failed to export spans to Zipkin');
      }
    }

    logger.debug({
      spans: spansToExport.length,
      metrics: metricsToExport.length,
    }, 'Flushed telemetry');
  }

  private async exportSpansOTLP(spans: Span[]): Promise<void> {
    const otlpSpans = spans.map(span => ({
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      kind: 1, // INTERNAL
      startTimeUnixNano: span.startTime * 1000000,
      endTimeUnixNano: (span.endTime || Date.now()) * 1000000,
      attributes: Object.entries(span.attributes).map(([key, value]) => ({
        key,
        value: { stringValue: String(value) },
      })),
      events: span.events.map(event => ({
        timeUnixNano: event.timestamp * 1000000,
        name: event.name,
        attributes: event.attributes ? Object.entries(event.attributes).map(([key, value]) => ({
          key,
          value: { stringValue: String(value) },
        })) : [],
      })),
      status: {
        code: span.status === 'ok' ? 1 : span.status === 'error' ? 2 : 0,
      },
    }));

    const payload = {
      resourceSpans: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: this.config.serviceName } },
            { key: 'service.version', value: { stringValue: this.config.serviceVersion || '0.1.0' } },
          ],
        },
        scopeSpans: [{
          scope: { name: 'clodds', version: '0.1.0' },
          spans: otlpSpans,
        }],
      }],
    };

    await fetch(`${this.config.otlpEndpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  private async exportSpansJaeger(spans: Span[]): Promise<void> {
    // Jaeger Thrift format (simplified - real impl would use Thrift)
    const jaegerSpans = spans.map(span => ({
      traceIdLow: span.traceId.substring(16),
      traceIdHigh: span.traceId.substring(0, 16),
      spanId: span.spanId,
      parentSpanId: span.parentSpanId || '0',
      operationName: span.name,
      references: span.parentSpanId ? [{
        refType: 'CHILD_OF',
        traceIdLow: span.traceId.substring(16),
        traceIdHigh: span.traceId.substring(0, 16),
        spanId: span.parentSpanId,
      }] : [],
      flags: 1,
      startTime: span.startTime * 1000,
      duration: ((span.endTime || Date.now()) - span.startTime) * 1000,
      tags: Object.entries(span.attributes).map(([key, value]) => ({
        key,
        type: 'string',
        value: String(value),
      })),
      logs: span.events.map(event => ({
        timestamp: event.timestamp * 1000,
        fields: [
          { key: 'event', type: 'string', value: event.name },
          ...Object.entries(event.attributes || {}).map(([key, value]) => ({
            key,
            type: 'string',
            value: String(value),
          })),
        ],
      })),
    }));

    await fetch(`${this.config.jaegerEndpoint}/api/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        process: {
          serviceName: this.config.serviceName,
          tags: [],
        },
        spans: jaegerSpans,
      }),
    });
  }

  private async exportSpansZipkin(spans: Span[]): Promise<void> {
    const zipkinSpans = spans.map(span => ({
      traceId: span.traceId,
      id: span.spanId,
      parentId: span.parentSpanId,
      name: span.name,
      timestamp: span.startTime * 1000,
      duration: ((span.endTime || Date.now()) - span.startTime) * 1000,
      localEndpoint: {
        serviceName: this.config.serviceName,
      },
      tags: Object.fromEntries(
        Object.entries(span.attributes).map(([k, v]) => [k, String(v)])
      ),
      annotations: span.events.map(event => ({
        timestamp: event.timestamp * 1000,
        value: event.name,
      })),
    }));

    await fetch(`${this.config.zipkinEndpoint}/api/v2/spans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(zipkinSpans),
    });
  }

  /**
   * Get Prometheus metrics endpoint content
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [];
    const metricGroups = new Map<string, Metric[]>();

    // Group metrics by name
    for (const metric of this.metricBuffer) {
      const group = metricGroups.get(metric.name) || [];
      group.push(metric);
      metricGroups.set(metric.name, group);
    }

    for (const [name, metrics] of metricGroups) {
      const type = metrics[0].type;
      lines.push(`# TYPE ${name} ${type}`);

      for (const metric of metrics) {
        const labels = Object.entries(metric.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        lines.push(`${name}{${labels}} ${metric.value}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Start Prometheus metrics server
   */
  startMetricsServer(port?: number): void {
    const http = require('http');
    const metricsPort = port || this.config.metricsPort || 9090;

    const server = http.createServer((req: any, res: any) => {
      if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(this.getPrometheusMetrics());
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(metricsPort, () => {
      logger.info({ port: metricsPort }, 'Prometheus metrics server started');
    });
  }

  /**
   * Shutdown telemetry service
   */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
    logger.info('Telemetry service shutdown');
  }
}

// LLM-specific instrumentation helpers
export class LLMInstrumentation {
  private telemetry: TelemetryService;

  constructor(telemetry: TelemetryService) {
    this.telemetry = telemetry;
  }

  /**
   * Instrument an LLM completion call
   */
  async traceCompletion<T>(
    provider: string,
    model: string,
    operation: () => Promise<T>,
    options?: {
      inputTokens?: number;
      promptLength?: number;
      userId?: string;
    }
  ): Promise<{ result: T; span: Span }> {
    const span = this.telemetry.startTrace('llm.completion', {
      'llm.provider': provider,
      'llm.model': model,
      'llm.input_tokens': options?.inputTokens,
      'llm.prompt_length': options?.promptLength,
      'user.id': options?.userId,
    });

    this.telemetry.addEvent(span, 'request.start');

    try {
      const startTime = Date.now();
      const result = await operation();
      const duration = Date.now() - startTime;

      this.telemetry.setAttribute(span, 'llm.latency_ms', duration);
      this.telemetry.addEvent(span, 'response.received');

      // Record metrics
      this.telemetry.recordHistogram('llm_request_duration_ms', duration, {
        provider,
        model,
      });
      this.telemetry.recordCounter('llm_requests_total', 1, {
        provider,
        model,
        status: 'success',
      });

      this.telemetry.endSpan(span, 'ok');
      return { result, span };
    } catch (error) {
      this.telemetry.addEvent(span, 'error', {
        'error.type': (error as Error).name,
        'error.message': (error as Error).message,
      });

      this.telemetry.recordCounter('llm_requests_total', 1, {
        provider,
        model,
        status: 'error',
      });

      this.telemetry.endSpan(span, 'error', error as Error);
      throw error;
    }
  }

  /**
   * Instrument token usage
   */
  recordTokenUsage(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    userId?: string
  ): void {
    this.telemetry.recordCounter('llm_tokens_input_total', inputTokens, {
      provider,
      model,
    });
    this.telemetry.recordCounter('llm_tokens_output_total', outputTokens, {
      provider,
      model,
    });

    if (userId) {
      this.telemetry.recordCounter('llm_tokens_by_user', inputTokens + outputTokens, {
        provider,
        model,
        user_id: userId,
      });
    }
  }

  /**
   * Instrument tool/function calls
   */
  traceToolCall(parentSpan: Span, toolName: string): Span {
    return this.telemetry.startSpan('llm.tool_call', parentSpan, {
      'tool.name': toolName,
    });
  }

  /**
   * Instrument streaming response
   */
  traceStreaming(parentSpan: Span): {
    onChunk: (chunk: string) => void;
    onComplete: (totalTokens: number) => void;
    onError: (error: Error) => void;
  } {
    const streamSpan = this.telemetry.startSpan('llm.stream', parentSpan);
    let chunkCount = 0;
    let totalChars = 0;

    return {
      onChunk: (chunk: string) => {
        chunkCount++;
        totalChars += chunk.length;
        this.telemetry.addEvent(streamSpan, 'chunk', {
          chunk_number: chunkCount,
          chunk_size: chunk.length,
        });
      },
      onComplete: (totalTokens: number) => {
        this.telemetry.setAttribute(streamSpan, 'stream.chunks', chunkCount);
        this.telemetry.setAttribute(streamSpan, 'stream.total_chars', totalChars);
        this.telemetry.setAttribute(streamSpan, 'llm.output_tokens', totalTokens);
        this.telemetry.endSpan(streamSpan, 'ok');
      },
      onError: (error: Error) => {
        this.telemetry.endSpan(streamSpan, 'error', error);
      },
    };
  }
}

// Global telemetry instance
let globalTelemetry: TelemetryService | null = null;

export function initTelemetry(config: TelemetryConfig): TelemetryService {
  globalTelemetry = new TelemetryService(config);
  return globalTelemetry;
}

export function getTelemetry(): TelemetryService | null {
  return globalTelemetry;
}

export function createLLMInstrumentation(): LLMInstrumentation | null {
  if (!globalTelemetry) return null;
  return new LLMInstrumentation(globalTelemetry);
}
