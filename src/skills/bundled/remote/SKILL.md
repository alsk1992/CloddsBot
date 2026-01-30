---
name: remote
description: "SSH tunnels, ngrok, and remote access management"
emoji: "🌐"
---

# Remote - Complete API Reference

Manage SSH tunnels, ngrok exposure, and remote access to your local Clodds instance.

---

## Chat Commands

### Create Tunnels

```
/remote tunnel ngrok 3000                   Expose port via ngrok
/remote tunnel cloudflare 3000              Expose via Cloudflare
/remote tunnel ssh 3000 user@server         SSH tunnel
/remote tunnel localtunnel 3000             Expose via localtunnel
```

### Manage Tunnels

```
/remote list                                List active tunnels
/remote status <id>                         Check tunnel health
/remote url <id>                            Get tunnel URL
/remote close <id>                          Close tunnel
/remote close-all                           Close all tunnels
```

### Port Forwarding

```
/remote forward 8080:localhost:3000         Local port forward
/remote forward remote 3000:server:80       Remote port forward
```

---

## TypeScript API Reference

### Create Remote Manager

```typescript
import { createRemoteManager } from 'clodds/remote';

const remote = createRemoteManager({
  // ngrok auth
  ngrokAuthToken: process.env.NGROK_AUTH_TOKEN,

  // Cloudflare tunnel
  cloudflareToken: process.env.CLOUDFLARE_TUNNEL_TOKEN,

  // SSH key
  sshKeyPath: '~/.ssh/id_rsa',

  // Auto-reconnect
  autoReconnect: true,
  reconnectDelayMs: 5000,
});
```

### Create ngrok Tunnel

```typescript
const tunnel = await remote.createNgrokTunnel({
  port: 3000,
  protocol: 'http',  // 'http' | 'tcp' | 'tls'

  // Optional
  subdomain: 'my-clodds',  // Requires paid plan
  authToken: process.env.NGROK_AUTH_TOKEN,
});

console.log(`Public URL: ${tunnel.url}`);
console.log(`Tunnel ID: ${tunnel.id}`);
```

### Create Cloudflare Tunnel

```typescript
const tunnel = await remote.createCloudflareTunnel({
  port: 3000,
  hostname: 'clodds.example.com',
  token: process.env.CLOUDFLARE_TUNNEL_TOKEN,
});

console.log(`URL: ${tunnel.url}`);
```

### Create SSH Tunnel

```typescript
const tunnel = await remote.createSshTunnel({
  localPort: 3000,
  remoteHost: 'server.example.com',
  remotePort: 80,
  username: 'deploy',
  privateKey: fs.readFileSync('~/.ssh/id_rsa'),
});

console.log(`Tunnel established`);
console.log(`Access via: ssh -L 3000:localhost:80 deploy@server.example.com`);
```

### List Tunnels

```typescript
const tunnels = remote.listTunnels();

for (const tunnel of tunnels) {
  console.log(`${tunnel.id}: ${tunnel.type}`);
  console.log(`  URL: ${tunnel.url}`);
  console.log(`  Port: ${tunnel.port}`);
  console.log(`  Status: ${tunnel.status}`);
  console.log(`  Created: ${tunnel.createdAt}`);
}
```

### Check Status

```typescript
const status = await remote.getStatus(tunnelId);

console.log(`Status: ${status.status}`);  // 'connected' | 'reconnecting' | 'disconnected'
console.log(`Uptime: ${status.uptimeMs}ms`);
console.log(`Bytes in: ${status.bytesIn}`);
console.log(`Bytes out: ${status.bytesOut}`);
```

### Close Tunnel

```typescript
// Close single tunnel
await remote.closeTunnel(tunnelId);

// Close all tunnels
await remote.closeAll();
```

### Event Handlers

```typescript
remote.on('connected', (tunnel) => {
  console.log(`Tunnel connected: ${tunnel.url}`);
});

remote.on('disconnected', (tunnel) => {
  console.log(`Tunnel disconnected: ${tunnel.id}`);
});

remote.on('error', (tunnel, error) => {
  console.error(`Tunnel error: ${error.message}`);
});
```

---

## Tunnel Types

| Type | Best For | Requirements |
|------|----------|--------------|
| **ngrok** | Quick testing | Free account |
| **Cloudflare** | Production | Cloudflare account |
| **SSH** | Secure access | SSH server |
| **localtunnel** | Free, temporary | None |

---

## Use Cases

### Expose Webhook Endpoint

```typescript
// Expose local server for webhook testing
const tunnel = await remote.createNgrokTunnel({ port: 3000 });
console.log(`Set webhook URL to: ${tunnel.url}/webhooks/trading-signals`);
```

### Remote Bot Access

```typescript
// Access bot from phone while at home
const tunnel = await remote.createCloudflareTunnel({
  port: 3000,
  hostname: 'clodds.mysite.com',
});
// Now access at https://clodds.mysite.com
```

---

## Best Practices

1. **Use Cloudflare for production** — More stable than ngrok
2. **Secure with auth** — Don't expose without protection
3. **Monitor connections** — Watch for disconnections
4. **Close unused tunnels** — Don't leave open indefinitely
