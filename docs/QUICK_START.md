# Quick Start Guide

Get Clodds running in under 5 minutes.

## 1. Get Your API Key

You need an Anthropic API key:
1. Go to https://console.anthropic.com
2. Create an account or sign in
3. Generate an API key

## 2. Configure

```bash
# Copy the example config
cp .env.example .env

# Edit .env and add your API key
# Only ANTHROPIC_API_KEY is required!
```

**Minimum .env file:**
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

## 3. Run

```bash
# Install dependencies (first time only)
npm install

# Start the gateway
npm start
```

## 4. Try It Out

Open http://localhost:18789/webchat in your browser.

Try asking:
- "What markets are trending on Polymarket?"
- "Show me my portfolio"
- "Find arbitrage opportunities"

## 5. Add a Messaging Channel (Optional)

### Telegram (Recommended)
1. Message @BotFather on Telegram
2. Send `/newbot` and follow prompts
3. Add to .env: `TELEGRAM_BOT_TOKEN=your-token`
4. Restart: `npm start`

### Discord
1. Go to https://discord.com/developers/applications
2. Create app → Bot → Copy token
3. Add to .env: `DISCORD_BOT_TOKEN=your-token`
4. Restart: `npm start`

## 6. Verify Setup

```bash
# Check credentials are working
npx clodds creds test

# Full system diagnostics
npx clodds doctor
```

## Common Issues

### "ANTHROPIC_API_KEY not set"
Make sure your .env file is in the project root and has:
```
ANTHROPIC_API_KEY=sk-ant-...
```

### "Port 18789 is in use"
Another instance is running. Kill it or change the port:
```bash
# Find and kill existing process
lsof -i :18789 | grep LISTEN | awk '{print $2}' | xargs kill

# Or change port in config
npx clodds config set gateway.port 18790
```

### Telegram bot not responding
1. Make sure you're messaging your bot directly (not a group)
2. Check the DM policy: `npx clodds doctor`
3. If using pairing mode, you may need to approve access

## Next Steps

- **Trading**: See [TRADING.md](TRADING.md) to connect trading accounts
- **Arbitrage**: See [OPPORTUNITY_FINDER.md](OPPORTUNITY_FINDER.md) for cross-platform arbitrage
- **Customization**: See [USER_GUIDE.md](USER_GUIDE.md) for full configuration options

## Need Help?

```bash
# Full diagnostics
npx clodds doctor

# Test specific credentials
npx clodds creds test polymarket
```

Report issues: https://github.com/your-repo/clodds/issues
