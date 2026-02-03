/**
 * Prometheus-compatible Metrics System
 *
 * Features:
 * - Counters: Monotonically increasing values (requests, errors)
 * - Gauges: Point-in-time values (active connections, memory)
 * - Histograms: Distribution of values with buckets (latency)
 * - Labels: Dimensional data for filtering
 * - Prometheus text format export
 */

import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricLabels {
  [key: string]: string;
}

export interface MetricOptions {
  name: string;
  help: string;
  labels?: string[];
  buckets?: number[]; // For histograms
}

export interface MetricValue {
  value: number;
  labels: MetricLabels;
  timestamp?: number;
}

export interface HistogramValue {
  sum: number;
  count: number;
  buckets: Map<number, number>;
  labels: MetricLabels;
}

// =============================================================================
// METRIC CLASSES
// =============================================================================

/**
 * Counter - Monotonically increasing metric
 */
export class Counter {
  readonly name: string;
  readonly help: string;
  readonly labelNames: string[];
  private values: Map<string, MetricValue> = new Map();

  constructor(options: MetricOptions) {
    this.name = options.name;
    this.help = options.help;
    this.labelNames = options.labels || [];
  }

  private getKey(labels: MetricLabels): string {
    return JSON.stringify(labels);
  }

  inc(labels: MetricLabels = {}, value = 1): void {
    if (value < 0) {
      logger.warn({ metric: this.name, value }, 'Counter cannot be decreased');
      return;
    }
    const key = this.getKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += value;
      existing.timestamp = Date.now();
    } else {
      this.values.set(key, { value, labels, timestamp: Date.now() });
    }
  }

  get(labels: MetricLabels = {}): number {
    const key = this.getKey(labels);
    return this.values.get(key)?.value || 0;
  }

  getAll(): MetricValue[] {
    return Array.from(this.values.values());
  }

  reset(): void {
    this.values.clear();
  }
}

/**
 * Gauge - Point-in-time metric that can go up or down
 */
export class Gauge {
  readonly name: string;
  readonly help: string;
  readonly labelNames: string[];
  private values: Map<string, MetricValue> = new Map();

  constructor(options: MetricOptions) {
    this.name = options.name;
    this.help = options.help;
    this.labelNames = options.labels || [];
  }

  private getKey(labels: MetricLabels): string {
    return JSON.stringify(labels);
  }

  set(labels: MetricLabels, value: number): void;
  set(value: number): void;
  set(arg1: MetricLabels | number, arg2?: number): void {
    let labels: MetricLabels;
    let value: number;
    if (typeof arg1 === 'number') {
      labels = {};
      value = arg1;
    } else {
      labels = arg1;
      value = arg2!;
    }
    const key = this.getKey(labels);
    this.values.set(key, { value, labels, timestamp: Date.now() });
  }

  inc(labels: MetricLabels = {}, value = 1): void {
    const key = this.getKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += value;
      existing.timestamp = Date.now();
    } else {
      this.values.set(key, { value, labels, timestamp: Date.now() });
    }
  }

  dec(labels: MetricLabels = {}, value = 1): void {
    this.inc(labels, -value);
  }

  get(labels: MetricLabels = {}): number {
    const key = this.getKey(labels);
    return this.values.get(key)?.value || 0;
  }

  getAll(): MetricValue[] {
    return Array.from(this.values.values());
  }

  reset(): void {
    this.values.clear();
  }
}

/**
 * Histogram - Distribution of values with configurable buckets
 */
export class Histogram {
  readonly name: string;
  readonly help: string;
  readonly labelNames: string[];
  readonly buckets: number[];
  private values: Map<string, HistogramValue> = new Map();

  constructor(options: MetricOptions) {
    this.name = options.name;
    this.help = options.help;
    this.labelNames = options.labels || [];
    // Default latency buckets in ms
    this.buckets = options.buckets || [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    // Ensure +Inf bucket
    if (!this.buckets.includes(Infinity)) {
      this.buckets.push(Infinity);
    }
    this.buckets.sort((a, b) => a - b);
  }

  private getKey(labels: MetricLabels): string {
    return JSON.stringify(labels);
  }

  observe(labels: MetricLabels, value: number): void;
  observe(value: number): void;
  observe(arg1: MetricLabels | number, arg2?: number): void {
    let labels: MetricLabels;
    let value: number;
    if (typeof arg1 === 'number') {
      labels = {};
      value = arg1;
    } else {
      labels = arg1;
      value = arg2!;
    }

    const key = this.getKey(labels);
    let histogram = this.values.get(key);

    if (!histogram) {
      histogram = {
        sum: 0,
        count: 0,
        buckets: new Map(this.buckets.map(b => [b, 0])),
        labels,
      };
      this.values.set(key, histogram);
    }

    histogram.sum += value;
    histogram.count++;

    // Increment all buckets where value <= bucket
    for (const bucket of this.buckets) {
      if (value <= bucket) {
        histogram.buckets.set(bucket, (histogram.buckets.get(bucket) || 0) + 1);
      }
    }
  }

  /**
   * Time a function and record the duration
   */
  async time<T>(labels: MetricLabels, fn: () => Promise<T>): Promise<T>;
  async time<T>(fn: () => Promise<T>): Promise<T>;
  async time<T>(arg1: MetricLabels | (() => Promise<T>), arg2?: () => Promise<T>): Promise<T> {
    let labels: MetricLabels;
    let fn: () => Promise<T>;
    if (typeof arg1 === 'function') {
      labels = {};
      fn = arg1;
    } else {
      labels = arg1;
      fn = arg2!;
    }

    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.observe(labels, Date.now() - start);
    }
  }

  /**
   * Start a timer that can be stopped later
   */
  startTimer(labels: MetricLabels = {}): () => number {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.observe(labels, duration);
      return duration;
    };
  }

  get(labels: MetricLabels = {}): HistogramValue | undefined {
    const key = this.getKey(labels);
    return this.values.get(key);
  }

  getAll(): HistogramValue[] {
    return Array.from(this.values.values());
  }

  reset(): void {
    this.values.clear();
  }
}

// =============================================================================
// REGISTRY
// =============================================================================

export class MetricsRegistry {
  private counters: Map<string, Counter> = new Map();
  private gauges: Map<string, Gauge> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  private prefix: string;

  constructor(prefix = 'clodds') {
    this.prefix = prefix;
  }

  createCounter(options: MetricOptions): Counter {
    const name = `${this.prefix}_${options.name}`;
    const counter = new Counter({ ...options, name });
    this.counters.set(name, counter);
    return counter;
  }

  createGauge(options: MetricOptions): Gauge {
    const name = `${this.prefix}_${options.name}`;
    const gauge = new Gauge({ ...options, name });
    this.gauges.set(name, gauge);
    return gauge;
  }

  createHistogram(options: MetricOptions): Histogram {
    const name = `${this.prefix}_${options.name}`;
    const histogram = new Histogram({ ...options, name });
    this.histograms.set(name, histogram);
    return histogram;
  }

  getCounter(name: string): Counter | undefined {
    return this.counters.get(`${this.prefix}_${name}`);
  }

  getGauge(name: string): Gauge | undefined {
    return this.gauges.get(`${this.prefix}_${name}`);
  }

  getHistogram(name: string): Histogram | undefined {
    return this.histograms.get(`${this.prefix}_${name}`);
  }

  /**
   * Export metrics in Prometheus text format
   */
  toPrometheusText(): string {
    const lines: string[] = [];

    // Counters
    for (const counter of this.counters.values()) {
      lines.push(`# HELP ${counter.name} ${counter.help}`);
      lines.push(`# TYPE ${counter.name} counter`);
      for (const value of counter.getAll()) {
        const labelStr = formatLabels(value.labels);
        lines.push(`${counter.name}${labelStr} ${value.value}`);
      }
    }

    // Gauges
    for (const gauge of this.gauges.values()) {
      lines.push(`# HELP ${gauge.name} ${gauge.help}`);
      lines.push(`# TYPE ${gauge.name} gauge`);
      for (const value of gauge.getAll()) {
        const labelStr = formatLabels(value.labels);
        lines.push(`${gauge.name}${labelStr} ${value.value}`);
      }
    }

    // Histograms
    for (const histogram of this.histograms.values()) {
      lines.push(`# HELP ${histogram.name} ${histogram.help}`);
      lines.push(`# TYPE ${histogram.name} histogram`);
      for (const value of histogram.getAll()) {
        const baseLabels = formatLabels(value.labels);
        // Buckets
        for (const [bucket, count] of value.buckets.entries()) {
          const le = bucket === Infinity ? '+Inf' : bucket.toString();
          const bucketLabels = value.labels
            ? formatLabels({ ...value.labels, le })
            : `{le="${le}"}`;
          lines.push(`${histogram.name}_bucket${bucketLabels} ${count}`);
        }
        // Sum and count
        lines.push(`${histogram.name}_sum${baseLabels} ${value.sum}`);
        lines.push(`${histogram.name}_count${baseLabels} ${value.count}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Export metrics as JSON
   */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const counter of this.counters.values()) {
      result[counter.name] = {
        type: 'counter',
        help: counter.help,
        values: counter.getAll(),
      };
    }

    for (const gauge of this.gauges.values()) {
      result[gauge.name] = {
        type: 'gauge',
        help: gauge.help,
        values: gauge.getAll(),
      };
    }

    for (const histogram of this.histograms.values()) {
      result[histogram.name] = {
        type: 'histogram',
        help: histogram.help,
        values: histogram.getAll().map(v => ({
          labels: v.labels,
          sum: v.sum,
          count: v.count,
          buckets: Object.fromEntries(v.buckets),
        })),
      };
    }

    return result;
  }

  reset(): void {
    for (const counter of this.counters.values()) counter.reset();
    for (const gauge of this.gauges.values()) gauge.reset();
    for (const histogram of this.histograms.values()) histogram.reset();
  }
}

function formatLabels(labels: MetricLabels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const parts = entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return `{${parts.join(',')}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// =============================================================================
// DEFAULT METRICS
// =============================================================================

export const registry = new MetricsRegistry();

// HTTP metrics
export const httpRequestsTotal = registry.createCounter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labels: ['method', 'path', 'status'],
});

export const httpRequestDuration = registry.createHistogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labels: ['method', 'path'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
});

export const httpActiveConnections = registry.createGauge({
  name: 'http_active_connections',
  help: 'Number of active HTTP connections',
});

export const httpErrorsTotal = registry.createCounter({
  name: 'http_errors_total',
  help: 'Total HTTP errors',
  labels: ['method', 'path', 'error_type'],
});

// WebSocket metrics
export const wsConnectionsTotal = registry.createCounter({
  name: 'ws_connections_total',
  help: 'Total WebSocket connections',
  labels: ['type'],
});

export const wsActiveConnections = registry.createGauge({
  name: 'ws_active_connections',
  help: 'Number of active WebSocket connections',
  labels: ['type'],
});

export const wsMessagesTotal = registry.createCounter({
  name: 'ws_messages_total',
  help: 'Total WebSocket messages',
  labels: ['type', 'direction'],
});

// Feed metrics
export const feedMessagesTotal = registry.createCounter({
  name: 'feed_messages_total',
  help: 'Total feed messages received',
  labels: ['platform', 'type'],
});

export const feedMessagesPerSecond = registry.createGauge({
  name: 'feed_messages_per_second',
  help: 'Feed messages per second',
  labels: ['platform'],
});

export const feedSubscriptions = registry.createGauge({
  name: 'feed_subscriptions',
  help: 'Number of active feed subscriptions',
  labels: ['platform'],
});

export const feedLatency = registry.createHistogram({
  name: 'feed_latency_ms',
  help: 'Feed message latency in milliseconds',
  labels: ['platform'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
});

export const feedReconnects = registry.createCounter({
  name: 'feed_reconnects_total',
  help: 'Total feed reconnections',
  labels: ['platform'],
});

// Trading metrics
export const tradingVolumeTotal = registry.createCounter({
  name: 'trading_volume_usd_total',
  help: 'Total trading volume in USD',
  labels: ['platform', 'side'],
});

export const tradingOrdersTotal = registry.createCounter({
  name: 'trading_orders_total',
  help: 'Total trading orders',
  labels: ['platform', 'side', 'status'],
});

export const tradingPnl = registry.createGauge({
  name: 'trading_pnl_usd',
  help: 'Current trading PnL in USD',
  labels: ['platform'],
});

export const tradingFillRate = registry.createHistogram({
  name: 'trading_fill_rate_pct',
  help: 'Order fill rate percentage',
  labels: ['platform', 'order_type'],
  buckets: [0, 10, 25, 50, 75, 90, 95, 99, 100],
});

export const tradingLatency = registry.createHistogram({
  name: 'trading_latency_ms',
  help: 'Trading operation latency in milliseconds',
  labels: ['platform', 'operation'],
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
});

// System metrics
export const processMemoryBytes = registry.createGauge({
  name: 'process_memory_bytes',
  help: 'Process memory usage in bytes',
  labels: ['type'],
});

export const processCpuUsage = registry.createGauge({
  name: 'process_cpu_usage_pct',
  help: 'Process CPU usage percentage',
});

export const processUptime = registry.createGauge({
  name: 'process_uptime_seconds',
  help: 'Process uptime in seconds',
});

// Job metrics
export const jobsTotal = registry.createCounter({
  name: 'jobs_total',
  help: 'Total jobs',
  labels: ['status', 'tier'],
});

export const jobsActive = registry.createGauge({
  name: 'jobs_active',
  help: 'Number of active jobs',
  labels: ['tier'],
});

export const jobDuration = registry.createHistogram({
  name: 'job_duration_ms',
  help: 'Job execution duration in milliseconds',
  labels: ['tier'],
  buckets: [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
});

// =============================================================================
// METRIC COLLECTION HELPERS
// =============================================================================

let metricsInterval: NodeJS.Timeout | null = null;

/**
 * Start collecting system metrics at regular intervals
 */
export function startMetricsCollection(intervalMs = 15000): void {
  if (metricsInterval) {
    clearInterval(metricsInterval);
  }

  const collectMetrics = () => {
    // Memory metrics
    const memUsage = process.memoryUsage();
    processMemoryBytes.set({ type: 'heapUsed' }, memUsage.heapUsed);
    processMemoryBytes.set({ type: 'heapTotal' }, memUsage.heapTotal);
    processMemoryBytes.set({ type: 'rss' }, memUsage.rss);
    processMemoryBytes.set({ type: 'external' }, memUsage.external);

    // CPU metrics (approximate)
    const cpuUsage = process.cpuUsage();
    const totalCpu = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
    processCpuUsage.set(totalCpu);

    // Uptime
    processUptime.set(process.uptime());
  };

  // Collect immediately
  collectMetrics();

  // Then at intervals
  metricsInterval = setInterval(collectMetrics, intervalMs);
}

/**
 * Stop collecting system metrics
 */
export function stopMetricsCollection(): void {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  formatLabels,
  escapeLabel,
};
