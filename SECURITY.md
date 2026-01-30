# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

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
  identityNetwork: 'base-sepolia' // Network for verification
}
```

See `/verify` command and `src/identity/erc8004.ts` for implementation.

## Known Security Considerations

### npm Dependencies

All npm vulnerabilities have been fixed using npm overrides:
- **bigint-buffer** → @vekexasia/bigint-buffer2 (secure fork)
- **elliptic** → Replaced with @noble/secp256k1 (modern, audited)
- **axios** → Forced to ^1.7.4
- **undici** → Forced to ^6.23.0
- **nanoid** → Forced to ^3.3.8
- **@cosmjs/**** → Forced to ^0.38.1 (uses @noble/curves)

Run `npm audit` to verify: **0 vulnerabilities**

### Sandbox Limitations

The `createSandbox()` function in `src/security/index.ts` is NOT a secure sandbox. It should only be used for trusted code. For untrusted code execution, use Docker containers or `isolated-vm`.

## Security Audit

See [docs/SECURITY_AUDIT.md](./docs/SECURITY_AUDIT.md) for the full security audit report.
