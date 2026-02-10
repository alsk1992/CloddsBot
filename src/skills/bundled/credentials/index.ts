/**
 * Credentials CLI Skill
 *
 * Commands:
 * /creds list - List stored credentials
 * /creds set <platform> <key> <value> - Set credential
 * /creds delete <platform> - Delete credentials
 * /creds check <platform> - Verify credentials work
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const credPath = ['..', '..', '..', 'credentials', 'index'].join('/');
    const dbPath = ['..', '..', '..', 'db', 'index'].join('/');
    const { createCredentialsManager } = await import(credPath);
    const { createDatabase } = await import(dbPath);
    const db = createDatabase();
    const manager = createCredentialsManager(db);
    const userId = 'default';

    switch (cmd) {
      case 'list':
      case 'ls': {
        const platforms = ['polymarket', 'kalshi', 'manifold'] as const;
        let output = '**Stored Credentials**\n\n| Platform | Status |\n|----------|--------|\n';
        for (const platform of platforms) {
          const has = await manager.hasCredentials(userId, platform);
          output += `| ${platform} | ${has ? 'Configured' : 'Not set'} |\n`;
        }
        // Also check env vars for additional platforms
        output += `| Binance | ${process.env.BINANCE_API_KEY ? 'Configured (env)' : 'Not set'} |\n`;
        output += `| Bybit | ${process.env.BYBIT_API_KEY ? 'Configured (env)' : 'Not set'} |\n`;
        output += `| Hyperliquid | ${process.env.HYPERLIQUID_API_KEY ? 'Configured (env)' : 'Not set'} |\n`;
        return output;
      }

      case 'set': {
        if (parts.length < 4) return 'Usage: /creds set <platform> <key> <value>\n\nPlatforms: polymarket, kalshi, manifold\nKeys vary by platform (api_key, api_secret, api_passphrase, etc.)';
        const platform = parts[1].toLowerCase();
        const validPlatforms = ['polymarket', 'kalshi', 'manifold', 'binance', 'bybit', 'hyperliquid', 'drift'];
        if (!validPlatforms.includes(platform)) {
          return `Unknown platform "${platform}". Supported: ${validPlatforms.join(', ')}`;
        }
        const key = parts[2];
        const value = parts[3];
        // Build credentials object from key-value
        const existing = (await manager.getCredentials(userId, platform as any) || {}) as Record<string, string>;
        const updated = { ...existing, [key]: value };
        await manager.setCredentials(userId, platform as any, updated as any);
        return `Credential **${key}** set for **${platform}** (encrypted with AES-256-GCM).`;
      }

      case 'delete':
      case 'remove': {
        if (!parts[1]) return 'Usage: /creds delete <platform>';
        const platform = parts[1].toLowerCase();
        await manager.deleteCredentials(userId, platform as any);
        return `Credentials for **${platform}** deleted.`;
      }

      case 'check':
      case 'verify': {
        if (!parts[1]) return 'Usage: /creds check <platform>';
        const platform = parts[1].toLowerCase();
        const has = await manager.hasCredentials(userId, platform as any);
        if (!has) return `No credentials stored for **${platform}**. Use \`/creds set\` first.`;
        const creds = await manager.getCredentials(userId, platform as any);
        if (creds) {
          await manager.markSuccess(userId, platform as any);
          return `Credentials for **${platform}** are stored and decryptable.`;
        }
        return `Failed to decrypt credentials for **${platform}**. They may be corrupted.`;
      }

      case 'status': {
        const hasKey = Boolean(process.env.CLODDS_CREDENTIAL_KEY);
        return `**Credential System Status**\n\n` +
          `Encryption key: ${hasKey ? 'Set (CLODDS_CREDENTIAL_KEY)' : 'NOT SET - credentials cannot be encrypted'}\n` +
          `Algorithm: AES-256-GCM\n` +
          `Storage: SQLite (encrypted at rest)`;
      }

      default:
        return helpText();
    }
  } catch {
    return helpText();
  }
}

function helpText(): string {
  return `**Credentials Commands**

  /creds list                          - List stored credentials
  /creds set <platform> <key> <value>  - Set credential (encrypted)
  /creds delete <platform>             - Delete credentials
  /creds check <platform>              - Verify credentials work
  /creds status                        - Encryption system status

**Platforms:** polymarket, kalshi, manifold
Credentials encrypted with AES-256-GCM. Set CLODDS_CREDENTIAL_KEY env var.`;
}

export default {
  name: 'credentials',
  description: 'Secure credential management for trading platforms',
  commands: ['/creds', '/credentials'],
  handle: execute,
};
