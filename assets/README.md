# Assets

This directory contains visual assets for the README and documentation.

## Required Files

### Demo GIF
- `demo.gif` - Main demo showing Clodds in action (recommended: 800x500px, <5MB)

### Screenshots (in `/screenshots`)
- `telegram.png` - Telegram chat interface
- `webchat.png` - WebChat browser interface
- `arbitrage.png` - Arbitrage scanner output
- `portfolio.png` - Portfolio dashboard

## Creating Screenshots

### Telegram
1. Open Telegram chat with the bot
2. Run `/opportunity scan` or `/portfolio`
3. Screenshot the conversation

### WebChat
1. Visit `http://localhost:18789/webchat`
2. Run a few commands
3. Screenshot the interface

### Arbitrage
1. Run `/opportunity scan` with results
2. Or `/opportunity combinatorial`
3. Screenshot showing opportunities found

### Portfolio
1. Run `/portfolio` with positions
2. Screenshot showing P&L

## Creating Demo GIF

Recommended tools:
- macOS: Kap, Gifox
- Windows: ScreenToGif
- Linux: Peek

Record:
1. Start fresh conversation
2. `/markets trump` - show search
3. `/opportunity scan` - show arbitrage
4. `/portfolio` - show positions
5. Keep under 30 seconds
