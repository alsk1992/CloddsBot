---
name: tailscale
description: "Tailscale VPN sharing, Serve, and Funnel for remote access"
emoji: "🔗"
gates:
  envs:
    anyOf:
      - TAILSCALE_AUTHKEY
---

# Tailscale - Complete API Reference

Share local services via Tailscale Serve (private) and Funnel (public internet access).

---

## Chat Commands

### Share Local Services (Private)

```
/tailscale serve 3000                       Share port on tailnet
/tailscale serve 3000 --path /api           Share at specific path
/tailscale serve stop 3000                  Stop sharing port
/tailscale serve status                     View active shares
```

### Public Access (Funnel)

```
/tailscale funnel 3000                      Expose to internet
/tailscale funnel 3000 --https              Force HTTPS
/tailscale funnel stop 3000                 Stop public access
/tailscale funnel status                    View funnels
```

### Network Status

```
/tailscale status                           Network status
/tailscale ip                               Show Tailscale IP
/tailscale peers                            List connected peers
/tailscale ping <peer>                      Ping a peer
```

### File Transfer

```
/tailscale send <file> <peer>               Send file to peer
/tailscale receive                          Receive incoming files
```

---

## TypeScript API Reference

### Create Tailscale Client

```typescript
import { createTailscaleClient } from 'clodds/tailscale';

const tailscale = createTailscaleClient({
  // Auth (optional if already logged in)
  authKey: process.env.TAILSCALE_AUTHKEY,

  // Socket path
  socketPath: '/var/run/tailscale/tailscaled.sock',
});
```

### Serve (Private Sharing)

```typescript
// Share local port on tailnet
await tailscale.serve({
  port: 3000,
  protocol: 'https',  // 'http' | 'https'
});

console.log(`Shared at: https://${tailscale.hostname}:3000`);

// Share at specific path
await tailscale.serve({
  port: 8080,
  path: '/api',
  protocol: 'https',
});

// Share with custom hostname
await tailscale.serve({
  port: 3000,
  hostname: 'clodds',  // clodds.tailnet-name.ts.net
});

// Stop sharing
await tailscale.serveStop(3000);

// Get serve status
const serves = await tailscale.serveStatus();
for (const serve of serves) {
  console.log(`Port ${serve.port} → ${serve.url}`);
}
```

### Funnel (Public Internet)

```typescript
// Expose to public internet
await tailscale.funnel({
  port: 3000,
  protocol: 'https',
});

console.log(`Public URL: https://${tailscale.hostname}.ts.net`);

// With custom domain (if configured)
await tailscale.funnel({
  port: 3000,
  hostname: 'api.example.com',
});

// Stop funnel
await tailscale.funnelStop(3000);

// Get funnel status
const funnels = await tailscale.funnelStatus();
for (const funnel of funnels) {
  console.log(`Port ${funnel.port} → ${funnel.publicUrl}`);
}
```

### Network Status

```typescript
// Get status
const status = await tailscale.status();

console.log(`Hostname: ${status.hostname}`);
console.log(`IP: ${status.ip}`);
console.log(`Tailnet: ${status.tailnet}`);
console.log(`Online: ${status.online}`);

// List peers
const peers = await tailscale.peers();
for (const peer of peers) {
  console.log(`${peer.hostname} (${peer.ip})`);
  console.log(`  OS: ${peer.os}`);
  console.log(`  Online: ${peer.online}`);
  console.log(`  Last seen: ${peer.lastSeen}`);
}

// Ping peer
const ping = await tailscale.ping('other-machine');
console.log(`Latency: ${ping.latencyMs}ms`);
```

### File Transfer

```typescript
// Send file to peer
await tailscale.sendFile({
  file: '/path/to/file.zip',
  peer: 'other-machine',
});

// Receive files (returns when file received)
const received = await tailscale.receiveFile({
  savePath: '/downloads',
  timeout: 60000,
});

console.log(`Received: ${received.filename}`);
console.log(`From: ${received.sender}`);
console.log(`Size: ${received.size} bytes`);
```

### Get Tailscale IP

```typescript
const ip = await tailscale.getIP();
console.log(`Tailscale IP: ${ip}`);  // 100.x.x.x
```

---

## Serve vs Funnel

| Feature | Serve | Funnel |
|---------|-------|--------|
| **Access** | Tailnet only | Public internet |
| **Auth** | Tailscale identity | None (public) |
| **URL** | machine.tailnet.ts.net | machine.ts.net |
| **Use case** | Internal tools | Public APIs |

---

## URL Formats

| Type | Format |
|------|--------|
| **Serve** | `https://machine.tailnet-name.ts.net:port` |
| **Funnel** | `https://machine.ts.net` |
| **Custom domain** | `https://your-domain.com` |

---

## Use Cases

### Share Dev Server

```typescript
// Share local dev server with team
await tailscale.serve({ port: 3000 });
// Team can access at https://your-machine.tailnet.ts.net:3000
```

### Expose Webhook Endpoint

```typescript
// Make webhook publicly accessible
await tailscale.funnel({ port: 3000, path: '/webhooks' });
// External services can POST to https://your-machine.ts.net/webhooks
```

### Share Bot with Phone

```typescript
// Access bot from phone while away from desk
await tailscale.serve({ port: 18789 });
// Open https://your-machine.tailnet.ts.net:18789/webchat on phone
```

---

## Requirements

- Tailscale installed and running
- Logged into a Tailnet
- For Funnel: Funnel enabled in Tailscale admin

---

## Best Practices

1. **Use Serve for internal** — Keep private services private
2. **Use Funnel sparingly** — Only for truly public endpoints
3. **Add authentication** — Funnel bypasses Tailscale auth
4. **Monitor access** — Check who's connecting
5. **Stop when done** — Don't leave services exposed
