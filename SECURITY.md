# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.9.x   | :white_check_mark: |
| < 1.9   | :x:                |

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of these methods:

1. **GitHub Security Advisories** (Preferred)
   - Go to the [Security tab](https://github.com/alsk1992/CloddsBot/security/advisories)
   - Click "Report a vulnerability"
   - Fill out the form with details

2. **Email**
   - Send details to the repository owner
   - Include "SECURITY" in the subject line

### What to Include

- Type of issue (e.g., command injection, credential exposure, etc.)
- Full paths of source file(s) related to the issue
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue

### Response Timeline

- **Initial response:** Within 48 hours
- **Status update:** Within 7 days
- **Fix timeline:** Depends on severity
  - Critical: 24-72 hours
  - High: 1-2 weeks
  - Medium: 2-4 weeks
  - Low: Next release

## Security Best Practices for Users

### Credential Safety

1. **Never commit credentials** - Use environment variables
2. **Use `.env` files** - Keep them in `.gitignore`
3. **Rotate API keys** - Regularly rotate trading platform keys
4. **Limit permissions** - Use read-only keys when possible

### Deployment

1. **Keep dependencies updated** - Run `npm audit` regularly
2. **Use HTTPS** - Never expose HTTP endpoints publicly
3. **Enable rate limiting** - Protect against abuse
4. **Review logs** - Monitor for suspicious activity

### Trading Safety

1. **Start with dry-run mode** - Test before live trading
2. **Set loss limits** - Configure circuit breakers
3. **Use separate wallets** - Don't use primary wallets for bots
4. **Monitor positions** - Set up alerts for large trades

### Agent Identity Verification (ERC-8004)

Clodds supports [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) for on-chain agent identity verification. This prevents impersonation attacks where malicious actors claim to be trusted traders.

**Why it matters:** On January 29, 2026, an agent named "samaltman" attempted to hijack bots via prompt injection. Anyone can claim to be anyone without verification.

**Recommended settings for copy trading:**

```typescript
{
  requireVerifiedIdentity: true,  // Only copy verified traders
  minReputationScore: 50,         // Minimum reputation score
  identityNetwork: 'base'         // Mainnet (live Jan 29, 2026)
}
```

**Live networks:** Ethereum, Base, Optimism, Arbitrum, Polygon (19,000+ agents registered)

See `/verify` command and `src/identity/erc8004.ts` for implementation.

## Known Security Considerations

### npm Dependencies

Clodds uses dependency overrides and direct upgrades where a compatible fix is available. The raw `npm audit` report still includes reviewed transitive advisories in the Solana and crypto SDK dependency trees; it is not currently a zero-vulnerability report.

CI runs `audit-ci` against production dependencies and fails on any new, unreviewed advisory of moderate severity or higher. The temporary exceptions, affected dependency paths, and rationale are documented in [`audit-ci.jsonc`](./audit-ci.jsonc). Revisit those exceptions as upstream SDKs release compatible fixes.

### Sandbox & Dynamic Code Execution

The following features are **disabled by default** for security:

| Feature | Environment Variable | Default |
|---------|---------------------|---------|
| JavaScript sandbox | `ALLOW_UNSAFE_SANDBOX` | `false` |
| Canvas JS eval | `CANVAS_ALLOW_JS_EVAL` | `false` |

Only enable these if you understand the risks. For untrusted code execution, use Docker containers or `isolated-vm`.

### MCP Server Security

When exposing Clodds as an MCP tool server, use these controls to restrict access:

| Feature | Environment Variable | Default |
|---------|---------------------|---------|
| Tool blocklist | `CLODDS_MCP_BLOCKED_TOOLS` | _(none)_ |
| Tool allowlist | `CLODDS_MCP_ALLOWED_TOOLS` | _(all)_ |
| Tool profile | `CLODDS_MCP_TOOL_PROFILE` | `full` |
| Rate limit | `CLODDS_MCP_RATE_LIMIT` | `60` calls/min |
| Audit logging | `CLODDS_MCP_AUDIT` | `true` |

Tool profiles provide predefined access levels:
- **`read-only`** — feeds, markets, analytics, portfolio, watchlist, search
- **`trading`** — read-only + trading, execution, order skills
- **`full`** — all tools (default)

All string arguments are scanned for injection patterns (SQL, command, XSS, path traversal) before execution.

### Rate Limiting & HTTPS

Production deployments should enable:

```bash
# IP-based rate limiting (requests per minute)
CLODDS_IP_RATE_LIMIT=100

# HTTPS enforcement
CLODDS_FORCE_HTTPS=true
CLODDS_HSTS_ENABLED=true
```

## Security Audit

See [docs/SECURITY_AUDIT.md](./docs/SECURITY_AUDIT.md) for the full security audit report.
