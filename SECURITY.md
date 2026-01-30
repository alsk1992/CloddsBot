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

## Known Security Considerations

### npm Dependencies

Some transitive dependencies have known vulnerabilities that cannot be fixed without breaking changes:

- `@solana/spl-token` chain (bigint-buffer)
- `@cosmjs/*` chain (elliptic)
- `@orca-so/whirlpool-sdk` (axios)

These are monitored and will be updated when upstream fixes are available.

### Sandbox Limitations

The `createSandbox()` function in `src/security/index.ts` is NOT a secure sandbox. It should only be used for trusted code. For untrusted code execution, use Docker containers or `isolated-vm`.

## Security Audit

See [docs/SECURITY_AUDIT.md](./docs/SECURITY_AUDIT.md) for the full security audit report.
