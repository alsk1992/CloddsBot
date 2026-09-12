# Quick Start

Get Clodds running in 2 commands.

## Install & Setup

```bash
npm install -g https://github.com/alsk1992/CloddsBot/releases/latest/download/clodds.tgz
clodds onboard
```

The legacy `clodds` package on npmjs.com is outdated; supported builds are published through GitHub Releases.

The setup wizard will:
1. Ask for your [Anthropic API key](https://console.anthropic.com)
2. Let you pick a messaging channel (WebChat, Telegram, Discord, or Slack)
3. Write your config to `~/.clodds/`
4. Offer to start the gateway immediately

Once running, open **http://localhost:18789/webchat** in your browser.

## Try It Out

Ask anything:
- "What markets are trending on Polymarket?"
- "Show me my portfolio"
- "Find arbitrage opportunities"

## Verify Setup

```bash
clodds doctor       # Full system diagnostics
clodds creds test   # Check credentials are working
```

## From Source (Alternative)

If you prefer to build from source:

```bash
git clone https://github.com/alsk1992/CloddsBot.git
cd CloddsBot
npm install
cp .env.example .env
# Add ANTHROPIC_API_KEY to .env
npm run build
npm start
```

## Common Issues

### "ANTHROPIC_API_KEY not set"
Run `clodds onboard` again — it will prompt for your key and save it to `~/.clodds/.env`.

### "Port 18789 is in use"
Another instance is running. Kill it or change the port:
```bash
lsof -i :18789 | grep LISTEN | awk '{print $2}' | xargs kill

# Or change port
clodds config set gateway.port 18790
```

### Telegram bot not responding
1. Make sure you're messaging your bot directly (not a group)
2. Run `clodds doctor` to check connectivity
3. If using pairing mode, approve access first

## Next Steps

- **Add channels**: Run `clodds onboard` again to add more messaging platforms
- **Trading**: See [TRADING.md](TRADING.md) to connect trading accounts
- **Arbitrage**: See [OPPORTUNITY_FINDER.md](OPPORTUNITY_FINDER.md) for cross-platform arbitrage
- **All commands**: See [USER_GUIDE.md](USER_GUIDE.md) for the full CLI and chat reference

## Need Help?

```bash
clodds doctor                  # Full diagnostics
clodds creds test polymarket   # Test specific credentials
```

Report issues: https://github.com/alsk1992/CloddsBot/issues
