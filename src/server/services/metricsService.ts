/**
 * Production Prometheus Metrics Registry for ContentX Platform
 * Zero-dependency, thread-safe, low-cardinality metrics collector.
 */

interface MetricLabels {
  [key: string]: string;
}

class Counter {
  private values = new Map<string, number>();

  constructor(
    public name: string,
    public help: string
  ) {}

  public inc(labels: MetricLabels = {}, value = 1): void {
    const key = this.serializeLabels(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  public get(labels: MetricLabels = {}): number {
    const key = this.serializeLabels(labels);
    return this.values.get(key) || 0;
  }

  public serializeLabels(labels: MetricLabels): string {
    const keys = Object.keys(labels).sort();
    if (keys.length === 0) return '';
    return keys.map((k) => `${k}="${this.escapeLabelValue(labels[k])}"`).join(',');
  }

  private escapeLabelValue(val: string): string {
    return String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  public render(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];

    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const [labels, val] of this.values.entries()) {
        const labelStr = labels ? `{${labels}}` : '';
        lines.push(`${this.name}${labelStr} ${val}`);
      }
    }
    return lines.join('\n');
  }
}

class Gauge {
  private values = new Map<string, number>();

  constructor(
    public name: string,
    public help: string
  ) {}

  public set(value: number, labels: MetricLabels = {}): void {
    const key = this.serializeLabels(labels);
    this.values.set(key, value);
  }

  public inc(labels: MetricLabels = {}, value = 1): void {
    const key = this.serializeLabels(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  public dec(labels: MetricLabels = {}, value = 1): void {
    const key = this.serializeLabels(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, Math.max(0, current - value));
  }

  public get(labels: MetricLabels = {}): number {
    const key = this.serializeLabels(labels);
    return this.values.get(key) || 0;
  }

  private serializeLabels(labels: MetricLabels): string {
    const keys = Object.keys(labels).sort();
    if (keys.length === 0) return '';
    return keys.map((k) => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`).join(',');
  }

  public render(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ];

    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const [labels, val] of this.values.entries()) {
        const labelStr = labels ? `{${labels}}` : '';
        lines.push(`${this.name}${labelStr} ${val}`);
      }
    }
    return lines.join('\n');
  }
}

class Histogram {
  private buckets: number[];
  // Keyed by labels string -> bucket values map & sum & count
  private data = new Map<
    string,
    { counts: number[]; sum: number; count: number }
  >();

  constructor(
    public name: string,
    public help: string,
    buckets: number[]
  ) {
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  public observe(value: number, labels: MetricLabels = {}): void {
    const key = this.serializeLabels(labels);
    let entry = this.data.get(key);
    if (!entry) {
      entry = {
        counts: new Array(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
      };
      this.data.set(key, entry);
    }

    entry.sum += value;
    entry.count += 1;

    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        entry.counts[i] += 1;
      }
    }
  }

  private serializeLabels(labels: MetricLabels): string {
    const keys = Object.keys(labels).sort();
    if (keys.length === 0) return '';
    return keys.map((k) => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`).join(',');
  }

  public render(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];

    if (this.data.size === 0) {
      for (const b of this.buckets) {
        lines.push(`${this.name}_bucket{le="${b}"} 0`);
      }
      lines.push(`${this.name}_bucket{le="+Inf"} 0`);
      lines.push(`${this.name}_sum 0`);
      lines.push(`${this.name}_count 0`);
    } else {
      for (const [labelsStr, entry] of this.data.entries()) {
        const prefix = labelsStr ? `${labelsStr},` : '';
        let cumulative = 0;
        for (let i = 0; i < this.buckets.length; i++) {
          cumulative += entry.counts[i];
          lines.push(
            `${this.name}_bucket{${prefix}le="${this.buckets[i]}"} ${cumulative}`
          );
        }
        lines.push(`${this.name}_bucket{${prefix}le="+Inf"} ${entry.count}`);
        lines.push(
          `${this.name}_sum${labelsStr ? `{${labelsStr}}` : ''} ${entry.sum.toFixed(6)}`
        );
        lines.push(
          `${this.name}_count${labelsStr ? `{${labelsStr}}` : ''} ${entry.count}`
        );
      }
    }
    return lines.join('\n');
  }
}

class MetricsRegistry {
  // HTTP Metrics
  public httpRequestsTotal = new Counter(
    'contentx_http_requests_total',
    'Total count of HTTP requests processed by ContentX'
  );
  public httpRequestDuration = new Histogram(
    'contentx_http_request_duration_seconds',
    'HTTP request execution duration in seconds',
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  );
  public httpActiveRequests = new Gauge(
    'contentx_http_active_requests',
    'Number of currently active HTTP requests'
  );

  // Generation Metrics
  public generationJobsTotal = new Counter(
    'contentx_generation_jobs_total',
    'Total count of AI transformation generation jobs'
  );
  public generationDuration = new Histogram(
    'contentx_generation_duration_seconds',
    'AI transformation generation execution duration in seconds',
    [0.5, 1, 2, 5, 10, 20, 30, 60]
  );
  public generationValidationFailuresTotal = new Counter(
    'contentx_generation_validation_failures_total',
    'Total count of 15-point validation gate failures'
  );

  // SSE Metrics
  public sseConnectionsTotal = new Counter(
    'contentx_sse_connections_total',
    'Total number of established SSE progress connections'
  );
  public sseActiveConnections = new Gauge(
    'contentx_sse_active_connections',
    'Number of currently active SSE stream subscribers'
  );
  public sseEventsTotal = new Counter(
    'contentx_sse_events_total',
    'Total number of progress events published via SSE'
  );

  // Database Metrics
  public databaseOperationsTotal = new Counter(
    'contentx_database_operations_total',
    'Total count of PostgreSQL database operations'
  );
  public databaseErrorsTotal = new Counter(
    'contentx_database_errors_total',
    'Total count of PostgreSQL database operation errors'
  );

  /**
   * Render all registered metrics in standard Prometheus exposition format.
   */
  public renderMetrics(): string {
    const sections = [
      this.httpRequestsTotal.render(),
      this.httpRequestDuration.render(),
      this.httpActiveRequests.render(),
      this.generationJobsTotal.render(),
      this.generationDuration.render(),
      this.generationValidationFailuresTotal.render(),
      this.sseConnectionsTotal.render(),
      this.sseActiveConnections.render(),
      this.sseEventsTotal.render(),
      this.databaseOperationsTotal.render(),
      this.databaseErrorsTotal.render(),
    ];
    return sections.join('\n\n') + '\n';
  }
}

export const metricsRegistry = new MetricsRegistry();
