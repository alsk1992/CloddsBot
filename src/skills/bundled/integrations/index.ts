/**
 * Integrations CLI Skill
 *
 * Commands:
 * /integrations - List all connected integrations
 * /integrations status - Connection status for all platforms
 * /integrations connect <platform> - Connect a platform
 * /integrations disconnect <platform> - Disconnect a platform
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'list';

  try {
    const _credPath = '../../../credentials/index';
    const { createCredentialsManager } = await import(_credPath);
    const { createDatabase } = await import('../../../db/index');
    const db = createDatabase();
    const manager = createCredentialsManager(db);
    const userId = 'default';

    switch (cmd) {
      case 'list':
      case '': {
        // Check which platforms have credentials configured
        const platforms = [
          { name: 'Polymarket', id: 'polymarket', env: 'POLY_API_KEY' },
          { name: 'Kalshi', id: 'kalshi', env: 'KALSHI_API_KEY' },
          { name: 'Manifold', id: 'manifold', env: 'MANIFOLD_API_KEY' },
          { name: 'Binance Futures', id: 'binance', env: 'BINANCE_API_KEY' },
          { name: 'Bybit', id: 'bybit', env: 'BYBIT_API_KEY' },
          { name: 'MEXC', id: 'mexc', env: 'MEXC_API_KEY' },
          { name: 'Hyperliquid', id: 'hyperliquid', env: 'HYPERLIQUID_API_KEY' },
        ];

        let output = '**Connected Integrations**\n\n';
        output += '| Platform | Status |\n|----------|--------|\n';
        for (const p of platforms) {
          const hasCreds = await manager.hasCredentials(userId, p.id as any);
          const hasEnv = Boolean(process.env[p.env]);
          const status = hasCreds ? 'Connected (db)' : hasEnv ? 'Connected (env)' : 'Not configured';
          output += `| ${p.name} | ${status} |\n`;
        }

        output += '\n**Data Feeds:**\n';
        output += '  Opinion, Betfair, Metaculus, Smarkets, PredictIt, PredictFun, Veil\n';
        output += '  News, Weather (NOAA), Whale tracking\n';
        output += '\nUse `/integrations status` for detailed health check.';
        return output;
      }

      case 'status': {
        const platforms = [
          { name: 'Polymarket', id: 'polymarket', env: 'POLY_API_KEY', url: 'https://clob.polymarket.com' },
          { name: 'Kalshi', id: 'kalshi', env: 'KALSHI_API_KEY', url: 'https://api.elections.kalshi.com' },
          { name: 'Binance', id: 'binance', env: 'BINANCE_API_KEY', url: 'https://fapi.binance.com' },
        ];

        let output = '**Integration Health**\n\n';
        for (const p of platforms) {
          const hasCreds = await manager.hasCredentials(userId, p.id as any);
          const hasEnv = Boolean(process.env[p.env]);
          const configured = hasCreds || hasEnv;
          output += `**${p.name}**\n`;
          output += `  Credentials: ${configured ? 'Yes' : 'No'}\n`;
          output += `  API: ${p.url}\n\n`;
        }
        return output;
      }

      case 'connect': {
        if (!parts[1]) return 'Usage: /integrations connect <platform>\n\nPlatforms: polymarket, kalshi, manifold, binance, bybit, mexc, hyperliquid';
        const platform = parts[1].toLowerCase();
        const has = await manager.hasCredentials(userId, platform as any);
        if (has) return `Already connected to **${platform}**. Use \`/creds check ${platform}\` to verify.`;
        return `To connect **${platform}**, set credentials:\n\n\`/creds set ${platform} api_key <your-key>\`\n\`/creds set ${platform} api_secret <your-secret>\``;
      }

      case 'disconnect': {
        if (!parts[1]) return 'Usage: /integrations disconnect <platform>';
        const platform = parts[1].toLowerCase();
        await manager.deleteCredentials(userId, platform as any);
        return `Disconnected from **${platform}**. Credentials removed.`;
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Integrations Commands**

  /integrations                        - List all integrations
  /integrations status                 - Connection health
  /integrations connect <platform>     - Connect platform
  /integrations disconnect <platform>  - Disconnect platform

**Platforms:** polymarket, kalshi, manifold, binance, bybit, mexc, hyperliquid`;
}

export default {
  name: 'integrations',
  description: 'Manage platform integrations - prediction markets, exchanges, messaging',
  commands: ['/integrations', '/integration'],
  handle: execute,
};
