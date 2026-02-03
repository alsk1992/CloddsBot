/**
 * Monitoring CLI Skill
 *
 * Commands:
 * /monitor status - System health
 * /monitor metrics - Key metrics
 * /monitor alerts - Active alerts
 * /monitor errors [n] - Recent errors
 * /monitor uptime - Uptime info
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'status';

  switch (cmd) {
    case 'status': {
      let output = `**System Health**\n\n`;
      output += `Uptime: ${Math.floor(process.uptime())}s\n`;
      output += `Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB / ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB\n`;
      output += `Node: ${process.version}\n`;
      output += `Platform: ${process.platform}`;
      try {
        const { getSystemHealth } = await import('../../../infra/index');
        const health = await getSystemHealth();
        output += `\n\nLoad: ${health.load.map(l => l.toFixed(2)).join(', ')}`;
        output += `\nCPU: ${health.cpu.cores} cores (${health.cpu.model})`;
        output += `\nDisk: ${health.disk ? `${health.disk.percent.toFixed(1)}% used` : 'n/a'}`;
      } catch {
        // infra module not available
      }
      return output;
    }

    case 'metrics': {
      try {
        const { registry } = await import('../../../monitoring/metrics');
        const snapshot = registry.toJSON();
        let output = '**Key Metrics**\n\n';
        const entries = Object.entries(snapshot);
        if (entries.length > 0) {
          for (const [name, value] of entries) {
            output += `${name}: ${JSON.stringify(value)}\n`;
          }
        } else {
          output += `Heap Used: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n`;
          output += `RSS: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB\n`;
          output += `CPU: ${JSON.stringify(process.cpuUsage())}`;
        }
        return output;
      } catch {
        return `**Key Metrics**\n\n` +
          `Heap Used: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n` +
          `RSS: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB\n` +
          `CPU: ${JSON.stringify(process.cpuUsage())}`;
      }
    }

    case 'alerts': {
      try {
        const { alertManager } = await import('../../../monitoring/alerts');
        const stats = alertManager.getStats();
        const recent = alertManager.getHistory({ limit: 10 });
        if (recent.length === 0) return '**Alerts**\n\nNo alerts recorded.';
        let output = `**Alerts** (${stats.total} total, ${stats.lastHour} last hour)\n\n`;
        for (const alert of recent) {
          output += `- [${alert.level}] ${alert.name}: ${alert.message}\n`;
          output += `  Time: ${new Date(alert.timestamp).toLocaleString()}\n`;
        }
        return output;
      } catch {
        return '**Alerts**\n\nNo alerts recorded.';
      }
    }

    case 'errors': {
      const n = parseInt(parts[1] || '10', 10);
      try {
        const { alertManager } = await import('../../../monitoring/alerts');
        const errors = alertManager.getHistory({ level: 'critical', limit: n });
        if (errors.length === 0) return `**Recent Errors (last ${n})**\n\nNo errors recorded.`;
        let output = `**Recent Errors** (${errors.length})\n\n`;
        for (const err of errors) {
          output += `- ${new Date(err.timestamp).toLocaleString()}: ${err.name} - ${err.message}\n`;
        }
        return output;
      } catch {
        return `**Recent Errors (last ${n})**\n\nNo errors recorded.`;
      }
    }

    case 'uptime':
      return `**Uptime**\n\n${Math.floor(process.uptime())} seconds (${(process.uptime() / 3600).toFixed(1)} hours)`;

    default:
      return `**Monitoring Commands**

  /monitor status                    - System health
  /monitor metrics                   - Key metrics
  /monitor alerts                    - Active alerts
  /monitor errors [n]                - Recent errors
  /monitor uptime                    - Uptime info`;
  }
}

export default {
  name: 'monitoring',
  description: 'System health monitoring, alerts, and error tracking',
  commands: ['/monitor', '/monitoring'],
  handle: execute,
};
