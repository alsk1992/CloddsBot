# Clodds Deployment Guide

Complete guide for deploying Clodds in production environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Deployment Options](#deployment-options)
- [Database Setup](#database-setup)
- [Production Checklist](#production-checklist)
- [Monitoring](#monitoring)
- [Backups](#backups)
- [Security Hardening](#security-hardening)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 22+ | Required for all deployments |
| npm | 10+ | Bundled with Node.js |
| Python | 3.8+ | Required for some trading scripts |
| Docker | 24+ | Optional, for containerized deployment |
| Git | 2.x | For source deployment |

---

## Environment Variables

### Required (Minimum to Run)

```bash
# Anthropic API Key - Required for AI functionality
# Get from: https://console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-...
```

### Messaging Channels

At least one channel is recommended. WebChat works immediately without configuration.

```bash
# Telegram (Recommended - easiest setup)
# Get from: https://t.me/BotFather
TELEGRAM_BOT_TOKEN=

# Discord
# Get from: https://discord.com/developers/applications
DISCORD_BOT_TOKEN=
DISCORD_APP_ID=

# Slack
# Get from: https://api.slack.com/apps
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=

# WebChat (built-in browser client)
WEBCHAT_TOKEN=optional-auth-token

# WhatsApp (requires baileys library)
# Uses QR code authentication via CLI
WHATSAPP_ENABLED=true

# Matrix
MATRIX_HOMESERVER_URL=https://matrix.org
MATRIX_ACCESS_TOKEN=
MATRIX_USER_ID=@bot:matrix.org

# Signal (requires signal-cli)
SIGNAL_PHONE_NUMBER=+15551234567
SIGNAL_CLI_PATH=/usr/bin/signal-cli

# Microsoft Teams
TEAMS_APP_ID=
TEAMS_APP_PASSWORD=

# Google Chat
GOOGLECHAT_CREDENTIALS_PATH=/path/to/credentials.json

# LINE
LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=

# iMessage (macOS only)
IMESSAGE_ENABLED=false
```

### Trading Credentials

```bash
# Polymarket
POLY_API_KEY=
POLY_API_SECRET=
POLY_API_PASSPHRASE=
POLY_PRIVATE_KEY=0x...
POLY_FUNDER_ADDRESS=0x...

# Kalshi
KALSHI_API_KEY=
KALSHI_API_SECRET=

# Manifold
MANIFOLD_API_KEY=

# Betfair
BETFAIR_APP_KEY=
BETFAIR_USERNAME=
BETFAIR_PASSWORD=

# Smarkets
SMARKETS_TOKEN=

# Hyperliquid (Perpetuals)
HYPERLIQUID_WALLET=0x...
HYPERLIQUID_PRIVATE_KEY=0x...

# Binance Futures
BINANCE_API_KEY=
BINANCE_API_SECRET=

# Bybit Futures
BYBIT_API_KEY=
BYBIT_API_SECRET=

# Solana DeFi
SOLANA_PRIVATE_KEY=base58-encoded-key
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# EVM DeFi
EVM_PRIVATE_KEY=0x...
ALCHEMY_API_KEY=
```

### Gateway Configuration

```bash
# Server binding
CLODDS_PORT=18789
CLODDS_HOST=127.0.0.1

# State directory (database, backups)
CLODDS_STATE_DIR=~/.clodds
CLODDS_CONFIG_PATH=~/.clodds/clodds.json

# Security
CLODDS_TOKEN=your-secret-token
CLODDS_IP_RATE_LIMIT=100
CLODDS_FORCE_HTTPS=false
CLODDS_HSTS_ENABLED=false

# Webhooks
CLODDS_WEBHOOK_SECRET=your-webhook-secret
CLODDS_WEBHOOK_REQUIRE_SIGNATURE=1
```

### Database Configuration

```bash
# SQLite (default, auto-created)
CLODDS_DB_PATH=~/.clodds/clodds.db

# Backup settings
CLODDS_DB_BACKUP_ENABLED=true
CLODDS_DB_BACKUP_INTERVAL=86400000
CLODDS_DB_BACKUP_KEEP=7
```

### Market Index

```bash
MARKET_INDEX_ENABLED=true
MARKET_INDEX_SYNC_INTERVAL=300000
MARKET_INDEX_LIMIT_PER_PLATFORM=1000
```

### External Data Sources

```bash
# OpenAI (for embeddings)
OPENAI_API_KEY=

# Twitter/X (for news feeds)
TWITTER_BEARER_TOKEN=
X_BEARER_TOKEN=

# External probability sources
CME_FEDWATCH_ACCESS_TOKEN=
FIVETHIRTYEIGHT_FORECAST_URL=
SILVER_BULLETIN_FORECAST_URL=
ODDS_API_KEY=

# Whale tracking
BIRDEYE_API_KEY=
ALCHEMY_API_KEY=
```

### Telemetry

```bash
OTEL_ENABLED=true
OTEL_SERVICE_NAME=clodds
OTEL_ENDPOINT=http://localhost:4318
OTEL_METRICS_PORT=9090
OTEL_SAMPLE_RATE=1.0
```

---

## Deployment Options

### 1. npm Install (Recommended)

```bash
# Configure npm for @alsk1992 scope (one-time)
echo "@alsk1992:registry=https://npm.pkg.github.com" >> ~/.npmrc

# Install globally
npm install -g @alsk1992/clodds

# Set environment
export ANTHROPIC_API_KEY=sk-ant-...

# Run
clodds start
```

### 2. From Source

```bash
# Clone repository
git clone https://github.com/alsk1992/CloddsBot.git
cd CloddsBot

# Install dependencies
npm ci

# Create environment file
cp .env.example .env
# Edit .env with your API keys

# Build
npm run build

# Start
npm start
# Or: node dist/index.js
```

### 3. Docker (Single Container)

**Build:**
```bash
docker build -t clodds .
```

**Run:**
```bash
docker run --rm \
  -p 18789:18789 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e TELEGRAM_BOT_TOKEN=... \
  -e WEBCHAT_TOKEN=... \
  -v clodds_data:/data \
  clodds
```

The container sets `CLODDS_STATE_DIR=/data`, so:
- Database: `/data/clodds.db`
- Backups: `/data/backups`

### 4. Docker Compose

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  clodds:
    build: .
    ports:
      - "18789:18789"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - WEBCHAT_TOKEN=${WEBCHAT_TOKEN}
    volumes:
      - clodds_data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:18789/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  clodds_data:
```

**Start:**
```bash
docker compose up -d --build
```

**Update:**
```bash
docker compose pull
docker compose up -d --build
```

### 5. Systemd Service (Linux)

Create `/etc/systemd/system/clodds.service`:

```ini
[Unit]
Description=Clodds Gateway
After=network.target

[Service]
Type=simple
User=clodds
Group=clodds
WorkingDirectory=/opt/clodds
EnvironmentFile=/etc/clodds/clodds.env
ExecStart=/usr/bin/node /opt/clodds/dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/clodds
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

**Setup:**
```bash
# Create user
sudo useradd -r -s /sbin/nologin clodds

# Create directories
sudo mkdir -p /opt/clodds /var/lib/clodds /etc/clodds
sudo chown clodds:clodds /var/lib/clodds

# Copy application
sudo cp -r dist/* /opt/clodds/

# Create environment file
sudo cp .env /etc/clodds/clodds.env
sudo chmod 600 /etc/clodds/clodds.env

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable clodds
sudo systemctl start clodds

# Check status
sudo systemctl status clodds
sudo journalctl -u clodds -f
```

### 6. Vercel (Serverless)

Clodds includes a Cloudflare Worker variant for serverless deployment. See `apps/clodds-worker/`.

**For Vercel deployment of the docs site:**
```bash
cd apps/docs
vercel --prod --yes
```

---

## Database Setup

### SQLite (Default)

SQLite is used by default with the sql.js library (pure JavaScript, no native dependencies).

```bash
# Database location
~/.clodds/clodds.db

# Or specify custom path
CLODDS_DB_PATH=/var/lib/clodds/clodds.db
```

The database is created automatically on first run with all required tables.

### Schema Overview

| Table | Purpose |
|-------|---------|
| `users` | User accounts and settings |
| `sessions` | Chat session history |
| `trades` | Trade execution logs |
| `positions` | Open positions |
| `pnl_snapshots` | P&L history |
| `markets` | Market index cache |
| `ticks` | Price tick history |
| `orderbooks` | Orderbook snapshots |
| `webhooks` | Webhook configurations |
| `cron_jobs` | Scheduled tasks |
| `memories` | Semantic memory store |
| `ledger` | Decision audit trail |

### Backup Configuration

```bash
# Enable automatic backups
CLODDS_DB_BACKUP_ENABLED=true

# Backup interval (default: daily)
CLODDS_DB_BACKUP_INTERVAL=86400000

# Number of backups to keep
CLODDS_DB_BACKUP_KEEP=7

# Backup directory
CLODDS_DB_BACKUP_PATH=~/.clodds/backups
```

**Manual backup:**
```bash
cp ~/.clodds/clodds.db ~/.clodds/backups/clodds-$(date +%Y%m%d).db
```

---

## Production Checklist

### Pre-Deployment

- [ ] Node.js 22+ installed
- [ ] `.env` file created with required variables
- [ ] `ANTHROPIC_API_KEY` configured
- [ ] At least one messaging channel configured
- [ ] Trading credentials encrypted (if trading enabled)
- [ ] Webhook secrets set

### Security

- [ ] Gateway bound to loopback (`127.0.0.1`)
- [ ] Reverse proxy configured (nginx/Caddy) with TLS
- [ ] `CLODDS_WEBHOOK_REQUIRE_SIGNATURE=1`
- [ ] `CLODDS_TOKEN` set for metrics endpoint
- [ ] Firewall configured (SSH + app ports only)
- [ ] SSH password auth disabled
- [ ] fail2ban installed and configured

### Monitoring

- [ ] Health check endpoint monitored (`/health`)
- [ ] `clodds doctor` runs without errors
- [ ] Log aggregation configured
- [ ] Alerts set for service downtime
- [ ] OpenTelemetry configured (if needed)

### Database

- [ ] Database backup enabled
- [ ] Backup retention configured
- [ ] Disk space monitored

### Performance

- [ ] Market index enabled with reasonable limits
- [ ] Tick recorder buffer sizes configured
- [ ] Rate limits appropriate for traffic

---

## Monitoring

### Health Check

```bash
# HTTP health check
curl http://localhost:18789/health
# {"status":"ok","timestamp":1706500000000}

# CLI diagnostics
clodds doctor
```

### Prometheus Metrics

Enable OpenTelemetry:
```json
{
  "telemetry": {
    "enabled": true,
    "metricsPort": 9090
  }
}
```

Access at `http://localhost:9090/metrics`.

**Key Metrics:**
| Metric | Description |
|--------|-------------|
| `clodds_requests_total` | Total HTTP requests |
| `clodds_request_duration_ms` | Request latency |
| `llm_tokens_total` | LLM token usage |
| `llm_requests_total` | LLM API calls |
| `trades_total` | Total trades executed |
| `positions_value` | Open position value |

### Logging

Logs use Pino format (JSON by default).

**Pretty print in development:**
```bash
npm run dev | npx pino-pretty
```

**Log levels:**
```bash
# Set log level
LOG_LEVEL=debug  # trace, debug, info, warn, error
```

### Alerts

Configure alert targets in `clodds.json`:

```json
{
  "monitoring": {
    "alertTargets": [
      { "platform": "telegram", "chatId": "123456789" },
      { "platform": "slack", "channelId": "C12345" }
    ]
  }
}
```

---

## Reverse Proxy

### nginx

```nginx
upstream clodds {
    server 127.0.0.1:18789;
}

server {
    listen 443 ssl http2;
    server_name clodds.example.com;

    ssl_certificate /etc/letsencrypt/live/clodds.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/clodds.example.com/privkey.pem;

    location / {
        proxy_pass http://clodds;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

### Caddy

```caddyfile
clodds.example.com {
    reverse_proxy localhost:18789
}
```

---

## Security Hardening

### Built-in Hardening CLI

```bash
# Preview changes (safe)
clodds secure --dry-run

# Apply all hardening
sudo clodds secure

# Non-interactive
sudo clodds secure --yes

# Run audit only
clodds secure audit
```

### What Gets Hardened

| Component | Changes |
|-----------|---------|
| SSH | Disable password auth, root login, limit attempts |
| Firewall | Configure ufw with minimal ports |
| fail2ban | Block brute-force attempts |
| Auto-updates | Enable unattended-upgrades |
| Kernel | Apply sysctl hardening |

### Manual Security Steps

```bash
# 1. Disable SSH password auth
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# 2. Configure firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 443/tcp
sudo ufw enable

# 3. Install fail2ban
sudo apt install fail2ban
sudo systemctl enable fail2ban

# 4. Enable auto-updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## Troubleshooting

### Common Issues

**Gateway won't start:**
```bash
# Check logs
journalctl -u clodds -f

# Run diagnostics
clodds doctor

# Check if port is in use
lsof -i :18789
```

**Channel not responding:**
1. Verify token in `.env`
2. Check channel enabled in config
3. Verify pairing approved (for DMs)
4. Check bot permissions on platform

**Database errors:**
```bash
# Check file permissions
ls -la ~/.clodds/

# Verify database exists
sqlite3 ~/.clodds/clodds.db ".tables"

# Reset database (loses data!)
rm ~/.clodds/clodds.db
```

**Memory issues:**
```bash
# Increase Node.js memory
NODE_OPTIONS="--max-old-space-size=4096" npm start
```

**WebSocket disconnections:**
- Check reverse proxy timeout settings
- Ensure WebSocket upgrade headers are forwarded
- Verify keepalive pings are not filtered

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug npm run dev

# Enable Node.js debugging
node --inspect dist/index.js
```

### Support

- GitHub Issues: https://github.com/alsk1992/CloddsBot/issues
- Documentation: https://docs.cloddsbot.com
- Discord: https://discord.gg/clodds
