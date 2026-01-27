/**
 * Onboard command - interactive setup wizard
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

export async function runOnboard(): Promise<void> {
  console.log('\n🎯 Welcome to Clodds Setup!\n');
  console.log('Let\'s get you set up with your prediction markets assistant.\n');

  const config: Record<string, unknown> = {
    gateway: { port: 18789 },
    agents: {
      defaults: {
        workspace: process.cwd(),
        model: { primary: 'anthropic/claude-sonnet-4' },
      },
    },
    channels: {},
    feeds: {},
    alerts: {
      priceChange: { threshold: 0.05, windowSecs: 300 },
      volumeSpike: { multiplier: 3 },
    },
  };

  // Anthropic API Key
  console.log('1️⃣  Claude API\n');
  const anthropicKey = await question('Enter your Anthropic API key (required): ');
  if (!anthropicKey) {
    console.log('\n❌ Anthropic API key is required. Get one at https://console.anthropic.com/\n');
    rl.close();
    process.exit(1);
  }

  // Telegram
  console.log('\n2️⃣  Telegram (optional)\n');
  const telegramToken = await question('Enter your Telegram bot token (or press Enter to skip): ');
  if (telegramToken) {
    (config.channels as Record<string, unknown>).telegram = {
      enabled: true,
      botToken: '${TELEGRAM_BOT_TOKEN}',
      dmPolicy: 'allowlist',
      allowFrom: [],
    };
  }

  // Discord
  console.log('\n3️⃣  Discord (optional)\n');
  const discordToken = await question('Enter your Discord bot token (or press Enter to skip): ');
  if (discordToken) {
    (config.channels as Record<string, unknown>).discord = {
      enabled: true,
      token: '${DISCORD_BOT_TOKEN}',
    };
  }

  // Market Feeds
  console.log('\n4️⃣  Market Feeds\n');
  const enablePolymarket = (await question('Enable Polymarket feed? (Y/n): ')).toLowerCase() !== 'n';
  const enableKalshi = (await question('Enable Kalshi feed? (Y/n): ')).toLowerCase() !== 'n';
  const enableManifold = (await question('Enable Manifold feed? (Y/n): ')).toLowerCase() !== 'n';

  (config.feeds as Record<string, unknown>).polymarket = { enabled: enablePolymarket };
  (config.feeds as Record<string, unknown>).kalshi = { enabled: enableKalshi };
  (config.feeds as Record<string, unknown>).manifold = { enabled: enableManifold };

  // Write config file
  const configDir = path.join(process.env.HOME || '', '.clodds');
  const configPath = path.join(configDir, 'config.json');

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Write .env file
  const envContent = [
    `ANTHROPIC_API_KEY=${anthropicKey}`,
    telegramToken ? `TELEGRAM_BOT_TOKEN=${telegramToken}` : '',
    discordToken ? `DISCORD_BOT_TOKEN=${discordToken}` : '',
  ].filter(Boolean).join('\n');

  const envPath = path.join(configDir, '.env');
  fs.writeFileSync(envPath, envContent);

  console.log('\n✅ Setup complete!\n');
  console.log(`Config saved to: ${configPath}`);
  console.log(`Environment saved to: ${envPath}`);
  console.log('\nTo start Clodds, run:\n');
  console.log('  npx clodds start\n');

  rl.close();
}
