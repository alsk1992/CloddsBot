# Clodds Deployment Guide

This guide covers production-style deployment for Clodds using Node.js,
Docker, or a systemd service.

## Prerequisites

- Node.js 20+ (for non-Docker installs)
- Python 3 (required for trading scripts)
- A configured `.env` with your API keys

Required environment variables (minimum):
- `ANTHROPIC_API_KEY`
- `TELEGRAM_BOT_TOKEN` (if using Telegram)

Optional:
- `WEBCHAT_TOKEN` (WebChat auth)
- `SMTP_*` (email alerts)
- `MARKET_INDEX_*` (market index tuning)

## Runtime data locations

Clodds stores persistent data in the state directory (defaults to the user's
home directory under `~/.clodds`). You can override it with
`CLODDS_STATE_DIR`.

- Database: `~/.clodds/clodds.db` (or `$CLODDS_STATE_DIR/clodds.db`)
- Backups: `~/.clodds/backups` (or `$CLODDS_STATE_DIR/backups`)

You can control paths for config and workspace with:
- `CLODDS_CONFIG_PATH`
- `CLODDS_WORKSPACE`

## Deployment options

Choose the deployment method that fits your needs:

| Method | Best For | Infra Required |
|--------|----------|----------------|
| Node.js | Development, full control | Server/VPS |
| Docker | Containerized environments | Docker host |
| systemd | Production Linux servers | Linux VPS |
| **Cloudflare Workers** | Edge, no server needed | Cloudflare account |

### 1) Node.js (bare metal)

```
npm ci
npm run build
node dist/index.js
```

For CLI usage after build:

```
node dist/cli/index.js start
```

### 2) Docker (single container)

Build the image:

```
docker build -t clodds .
```

Run it:

```
docker run --rm \
  -p 18789:18789 \
  -e ANTHROPIC_API_KEY=... \
  -e TELEGRAM_BOT_TOKEN=... \
  -e WEBCHAT_TOKEN=... \
  -v clodds_data:/data \
  clodds
```

Note: the container sets `CLODDS_STATE_DIR=/data`, so the database lives at
`/data/clodds.db` (backups at `/data/backups`).

### 3) Docker Compose

Use the included `docker-compose.yml`:

```
docker compose up -d --build
```

To pass secrets, add an `.env` file in the same directory and list variables
there, or edit the `environment:` section.

### 4) systemd (Linux)

Create a unit file (example: `/etc/systemd/system/clodds.service`):

```
[Unit]
Description=Clodds Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/clodds
EnvironmentFile=/etc/clodds/clodds.env
ExecStart=/usr/bin/node /opt/clodds/dist/index.js
Restart=on-failure
User=clodds

[Install]
WantedBy=multi-user.target
```

Then:

```
systemctl daemon-reload
systemctl enable clodds
systemctl start clodds
```

### 5) Cloudflare Workers (edge/serverless)

For lightweight edge deployment without dedicated hardware. Supports webhook-based
channels (Telegram, Discord, Slack), market search, and arbitrage scanning.

**Limitations vs full deployment:**
- No WebSocket channels (webchat, real-time feeds)
- No trading execution (read-only market data)
- No shell/browser tools
- No whale tracking or copy trading

**Setup:**

```bash
cd apps/clodds-worker
npm install

# Create Cloudflare resources
npx wrangler d1 create clodds
npx wrangler kv:namespace create CACHE

# Update wrangler.toml with the returned IDs
# database_id = "..." and id = "..."

# Run migrations
npx wrangler d1 migrations apply clodds

# Set secrets
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN  # optional
npx wrangler secret put DISCORD_PUBLIC_KEY  # optional
npx wrangler secret put SLACK_BOT_TOKEN     # optional

# Deploy
npx wrangler deploy
```

**Set up Telegram webhook:**

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://clodds-worker.<account>.workers.dev/webhook/telegram"
```

See [apps/clodds-worker/README.md](../apps/clodds-worker/README.md) for full documentation.

## Reverse proxy and TLS

If exposing the gateway publicly, put it behind a reverse proxy (nginx, Caddy,
Traefik) and terminate TLS there. Keep the gateway on loopback and only forward
port 18789 from the proxy.

## Updates

```
git pull
npm ci
npm run build
systemctl restart clodds
```

For Docker:

```
docker compose pull
docker compose up -d --build
```

## Monitoring and health checks

- `GET /health` returns gateway status.
- `clodds doctor` runs local checks for config and channel health.

## Backups

The SQLite DB is stored at `$CLODDS_STATE_DIR/clodds.db` (defaults to
`~/.clodds/clodds.db`). Backups are written to
`$CLODDS_STATE_DIR/backups` (see `CLODDS_DB_BACKUP_*` in `.env.example`).
