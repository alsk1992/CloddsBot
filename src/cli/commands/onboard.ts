/**
 * Onboard command - interactive setup wizard with credential validation
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

function spinner(text: string): { stop: (success: boolean, result?: string) => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${frames[i++ % frames.length]} ${text}`);
  }, 80);
  return {
    stop(success: boolean, result?: string) {
      clearInterval(interval);
      const icon = success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      const msg = result ? ` ${result}` : '';
      process.stdout.write(`\r  ${icon} ${text}${msg}\n`);
    },
  };
}

// =============================================================================
// CREDENTIAL VALIDATORS
// =============================================================================

async function validateAnthropicKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    if (response.ok) {
      return { valid: true };
    }

    const data = await response.json() as { error?: { message?: string } };
    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' };
    }
    if (response.status === 429) {
      // Rate limited means the key is valid
      return { valid: true };
    }
    return { valid: false, error: data.error?.message || `HTTP ${response.status}` };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Connection failed' };
  }
}

async function validateTelegramToken(token: string): Promise<{ valid: boolean; botName?: string; error?: string }> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await response.json() as { ok?: boolean; result?: { username?: string }; description?: string };

    if (data.ok && data.result?.username) {
      return { valid: true, botName: data.result.username };
    }
    return { valid: false, error: data.description || 'Invalid token' };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Connection failed' };
  }
}

async function validateDiscordToken(token: string): Promise<{ valid: boolean; botName?: string; error?: string }> {
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
    });
    const data = await response.json() as { username?: string; message?: string };

    if (response.ok && data.username) {
      return { valid: true, botName: data.username };
    }
    return { valid: false, error: data.message || 'Invalid token' };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Connection failed' };
  }
}

// =============================================================================
// MAIN ONBOARD FLOW
// =============================================================================

export async function runOnboard(): Promise<void> {
  console.log('\n\x1b[1m🎯 Welcome to Clodds Setup!\x1b[0m\n');
  console.log("Let's get you set up with your prediction markets assistant.\n");
  console.log('\x1b[90mThis wizard will:\x1b[0m');
  console.log('  1. Set up your Claude API key (required)');
  console.log('  2. Configure messaging channels (Telegram/Discord)');
  console.log('  3. Choose which market feeds to enable');
  console.log('  4. Validate all credentials before saving\n');

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

  // ==========================================================================
  // Step 1: Anthropic API Key (Required)
  // ==========================================================================
  console.log('\x1b[1m1️⃣  Claude API (Required)\x1b[0m\n');
  console.log('\x1b[90m   Get your API key from: https://console.anthropic.com\x1b[0m\n');

  let anthropicKey = '';
  while (!anthropicKey) {
    anthropicKey = await question('   Enter your Anthropic API key: ');
    if (!anthropicKey) {
      console.log('\x1b[31m   API key is required to continue.\x1b[0m\n');
      continue;
    }

    // Validate
    const spin = spinner('Validating API key...');
    const result = await validateAnthropicKey(anthropicKey);
    spin.stop(result.valid, result.valid ? '' : `\x1b[31m${result.error}\x1b[0m`);

    if (!result.valid) {
      console.log('\x1b[90m   Check your key and try again.\x1b[0m\n');
      anthropicKey = '';
    }
  }
  console.log('');

  // ==========================================================================
  // Step 2: Telegram (Optional)
  // ==========================================================================
  console.log('\x1b[1m2️⃣  Telegram Bot (Optional)\x1b[0m\n');
  console.log('\x1b[90m   Create a bot with @BotFather on Telegram (send /newbot)\x1b[0m\n');

  let telegramToken = await question('   Enter Telegram bot token (or press Enter to skip): ');
  let telegramBotName = '';

  if (telegramToken) {
    const spin = spinner('Validating Telegram token...');
    const result = await validateTelegramToken(telegramToken);
    spin.stop(result.valid, result.valid ? `@${result.botName}` : `\x1b[31m${result.error}\x1b[0m`);

    if (!result.valid) {
      const retry = await question('   Try again? (y/N): ');
      if (retry.toLowerCase() === 'y') {
        telegramToken = await question('   Enter Telegram bot token: ');
        if (telegramToken) {
          const spin2 = spinner('Validating Telegram token...');
          const result2 = await validateTelegramToken(telegramToken);
          spin2.stop(result2.valid, result2.valid ? `@${result2.botName}` : `\x1b[31m${result2.error}\x1b[0m`);
          if (result2.valid) {
            telegramBotName = result2.botName || '';
          } else {
            telegramToken = ''; // Skip if still invalid
          }
        }
      } else {
        telegramToken = '';
      }
    } else {
      telegramBotName = result.botName || '';
    }

    if (telegramToken) {
      // DM Policy guidance
      console.log('\n\x1b[90m   DM Policy controls who can message your bot:\x1b[0m');
      console.log('   • \x1b[36mopen\x1b[0m     - Anyone can message (easiest)');
      console.log('   • \x1b[36mallowlist\x1b[0m - Only approved users (more secure)');
      console.log('   • \x1b[36mpairing\x1b[0m  - Requires pairing code (most secure)\n');

      const dmPolicy = (await question('   DM policy (open/allowlist/pairing) [open]: ')).toLowerCase() || 'open';

      (config.channels as Record<string, unknown>).telegram = {
        enabled: true,
        dmPolicy: ['open', 'allowlist', 'pairing'].includes(dmPolicy) ? dmPolicy : 'open',
        allowFrom: [],
      };
    }
  }
  console.log('');

  // ==========================================================================
  // Step 3: Discord (Optional)
  // ==========================================================================
  console.log('\x1b[1m3️⃣  Discord Bot (Optional)\x1b[0m\n');
  console.log('\x1b[90m   Create a bot at: https://discord.com/developers/applications\x1b[0m\n');

  let discordToken = await question('   Enter Discord bot token (or press Enter to skip): ');

  if (discordToken) {
    const spin = spinner('Validating Discord token...');
    const result = await validateDiscordToken(discordToken);
    spin.stop(result.valid, result.valid ? result.botName : `\x1b[31m${result.error}\x1b[0m`);

    if (!result.valid) {
      const retry = await question('   Try again? (y/N): ');
      if (retry.toLowerCase() === 'y') {
        discordToken = await question('   Enter Discord bot token: ');
        if (discordToken) {
          const spin2 = spinner('Validating Discord token...');
          const result2 = await validateDiscordToken(discordToken);
          spin2.stop(result2.valid, result2.valid ? result2.botName : `\x1b[31m${result2.error}\x1b[0m`);
          if (!result2.valid) {
            discordToken = '';
          }
        }
      } else {
        discordToken = '';
      }
    }

    if (discordToken) {
      (config.channels as Record<string, unknown>).discord = {
        enabled: true,
      };
    }
  }
  console.log('');

  // ==========================================================================
  // Step 4: Market Feeds
  // ==========================================================================
  console.log('\x1b[1m4️⃣  Market Feeds\x1b[0m\n');
  console.log('\x1b[90m   Choose which prediction market platforms to monitor:\x1b[0m\n');

  console.log('   \x1b[36mPolymarket\x1b[0m - Crypto-based prediction market (most popular)');
  const enablePolymarket = (await question('   Enable Polymarket? (Y/n): ')).toLowerCase() !== 'n';

  console.log('\n   \x1b[36mKalshi\x1b[0m - US-regulated prediction market');
  const enableKalshi = (await question('   Enable Kalshi? (Y/n): ')).toLowerCase() !== 'n';

  console.log('\n   \x1b[36mManifold\x1b[0m - Play-money prediction market');
  const enableManifold = (await question('   Enable Manifold? (Y/n): ')).toLowerCase() !== 'n';

  console.log('\n   \x1b[36mMetaculus\x1b[0m - Community forecasting platform');
  const enableMetaculus = (await question('   Enable Metaculus? (Y/n): ')).toLowerCase() !== 'n';

  (config.feeds as Record<string, unknown>).polymarket = { enabled: enablePolymarket };
  (config.feeds as Record<string, unknown>).kalshi = { enabled: enableKalshi };
  (config.feeds as Record<string, unknown>).manifold = { enabled: enableManifold };
  (config.feeds as Record<string, unknown>).metaculus = { enabled: enableMetaculus };

  // ==========================================================================
  // Save Configuration
  // ==========================================================================
  console.log('\n');
  const spin = spinner('Saving configuration...');

  const configDir = path.join(process.env.HOME || '', '.clodds');
  const configPath = path.join(configDir, 'config.json');

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Write .env file
  const envLines = [
    `ANTHROPIC_API_KEY=${anthropicKey}`,
  ];
  if (telegramToken) envLines.push(`TELEGRAM_BOT_TOKEN=${telegramToken}`);
  if (discordToken) envLines.push(`DISCORD_BOT_TOKEN=${discordToken}`);

  const envPath = path.join(configDir, '.env');
  fs.writeFileSync(envPath, envLines.join('\n') + '\n');

  spin.stop(true, '');

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n\x1b[32m\x1b[1m✅ Setup complete!\x1b[0m\n');

  console.log('\x1b[1mConfiguration:\x1b[0m');
  console.log(`   Config: ${configPath}`);
  console.log(`   Environment: ${envPath}`);

  console.log('\n\x1b[1mEnabled services:\x1b[0m');
  console.log(`   \x1b[32m✓\x1b[0m Claude AI (Anthropic)`);
  console.log(`   \x1b[32m✓\x1b[0m WebChat (http://localhost:18789/webchat)`);
  if (telegramToken) console.log(`   \x1b[32m✓\x1b[0m Telegram (@${telegramBotName})`);
  if (discordToken) console.log(`   \x1b[32m✓\x1b[0m Discord`);

  console.log('\n\x1b[1mMarket feeds:\x1b[0m');
  if (enablePolymarket) console.log('   \x1b[32m✓\x1b[0m Polymarket');
  if (enableKalshi) console.log('   \x1b[32m✓\x1b[0m Kalshi');
  if (enableManifold) console.log('   \x1b[32m✓\x1b[0m Manifold');
  if (enableMetaculus) console.log('   \x1b[32m✓\x1b[0m Metaculus');

  console.log('\n\x1b[1mNext steps:\x1b[0m');
  console.log('\n   1. Copy the .env file to your project:');
  console.log(`      \x1b[36mcp ${envPath} ./.env\x1b[0m`);
  console.log('\n   2. Start Clodds:');
  console.log('      \x1b[36mnpm start\x1b[0m');
  console.log('\n   3. Open WebChat:');
  console.log('      \x1b[36mhttp://localhost:18789/webchat\x1b[0m\n');

  rl.close();
}
