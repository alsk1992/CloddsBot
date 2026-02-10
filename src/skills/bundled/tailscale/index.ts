/**
 * Tailscale CLI Skill
 *
 * Commands:
 * /tailscale status - Tailscale status
 * /tailscale serve <port> - Expose port via Tailscale Serve
 * /tailscale funnel <port> - Expose port via Tailscale Funnel
 * /tailscale stop - Stop serving
 * /tailscale list - List peers on tailnet
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'status';

  try {
    const { TailscaleClient, ServeManager } = await import('../../../tailscale/index');

    const client = new TailscaleClient();

    switch (cmd) {
      case 'status': {
        const installed = await client.isInstalled();
        if (!installed) {
          return '**Tailscale Status**\n\nTailscale is not installed. Install from https://tailscale.com/download';
        }
        const running = await client.isRunning();
        if (!running) {
          return '**Tailscale Status**\n\nTailscale is installed but not running. Start with `tailscale up`.';
        }
        const status = await client.getStatus();
        const onlinePeers = status.peers.filter(p => p.online);
        const ip = status.tailscaleIPs?.[0] || 'unknown';

        return `**Tailscale Status**\n\n` +
          `State: ${status.backendState}\n` +
          `Version: ${status.version}\n` +
          `IP: ${ip}\n` +
          `Hostname: ${status.self.hostName}\n` +
          `DNS: ${status.self.dnsName}\n` +
          `Tailnet: ${status.currentTailnet || 'unknown'}\n` +
          `MagicDNS: ${status.magicDnsSuffix || 'n/a'}\n` +
          `Peers: ${onlinePeers.length} online / ${status.peers.length} total`;
      }

      case 'serve': {
        if (!parts[1]) return 'Usage: /tailscale serve <port> [--path /prefix]';
        const port = parseInt(parts[1], 10);
        if (isNaN(port)) return 'Invalid port number.';

        const pathIdx = parts.indexOf('--path');
        const path = pathIdx >= 0 ? parts[pathIdx + 1] : undefined;

        const manager = new ServeManager(client);
        const url = await manager.serve(port, { path });

        return `**Tailscale Serve Started**\n\n` +
          `Port: ${port}\n` +
          `URL: ${url}\n` +
          `Access: Private (tailnet only)\n\n` +
          `Stop with: /tailscale stop`;
      }

      case 'funnel': {
        if (!parts[1]) return 'Usage: /tailscale funnel <port> [--path /prefix]';
        const port = parseInt(parts[1], 10);
        if (isNaN(port)) return 'Invalid port number.';

        const available = await client.funnelAvailable();
        if (!available) {
          return '**Tailscale Funnel**\n\nFunnel is not available for this account. Check your Tailscale plan and ACL settings.';
        }

        const pathIdx = parts.indexOf('--path');
        const path = pathIdx >= 0 ? parts[pathIdx + 1] : undefined;

        const manager = new ServeManager(client);
        const url = await manager.funnel(port, { path });

        return `**Tailscale Funnel Started**\n\n` +
          `Port: ${port}\n` +
          `URL: ${url}\n` +
          `Access: **PUBLIC** (internet accessible)\n\n` +
          `Stop with: /tailscale stop`;
      }

      case 'stop': {
        const manager = new ServeManager(client);
        await manager.stopAll();
        return 'Tailscale Serve and Funnel stopped.';
      }

      case 'list':
      case 'peers': {
        const installed = await client.isInstalled();
        if (!installed) return 'Tailscale is not installed.';
        const running = await client.isRunning();
        if (!running) return 'Tailscale is not running.';

        const peers = await client.listPeers();
        if (peers.length === 0) {
          return '**Tailnet Peers**\n\nNo peers found.';
        }

        const lines = peers.map(p => {
          const status = p.online ? 'online' : 'offline';
          const ip = p.tailscaleIPs?.[0] || 'no IP';
          return `- **${p.hostName}** (${p.os}) [${status}] ${ip}`;
        });

        return `**Tailnet Peers (${peers.length})**\n\n${lines.join('\n')}`;
      }

      case 'ping': {
        if (!parts[1]) return 'Usage: /tailscale ping <hostname>';
        const result = await client.ping(parts[1], 3);
        if (!result.online) {
          return `**Ping ${parts[1]}**: offline / unreachable`;
        }
        return `**Ping ${parts[1]}**: ${result.latency.toFixed(1)}ms`;
      }

      case 'ip': {
        const ip = await client.getIP();
        return ip ? `Tailscale IP: ${ip}` : 'Could not get Tailscale IP.';
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Tailscale Commands**

  /tailscale status                  - Connection status
  /tailscale serve <port>            - Expose via Serve (private)
  /tailscale funnel <port>           - Expose via Funnel (public)
  /tailscale stop                    - Stop serving
  /tailscale list                    - List tailnet peers
  /tailscale ping <host>             - Ping a peer
  /tailscale ip                      - Show Tailscale IP`;
}

export default {
  name: 'tailscale',
  description: 'Tailscale VPN sharing, Serve, and Funnel for remote access',
  commands: ['/tailscale', '/ts'],
  handle: execute,
};
