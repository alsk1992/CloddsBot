# Security Audit Report

**Date:** 2026-01-30
**Version:** 0.1.0
**Status:** Pre-release audit

---

## Executive Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| npm Dependencies | 0 | 16 | 6 | 13 | 35 |
| Code Vulnerabilities | 0 | 2 | 4 | 3 | 9 |
| **Total** | **0** | **18** | **10** | **16** | **44** |

**Recommendation:** Fix HIGH severity issues before npm publish.

---

## 1. npm Dependency Vulnerabilities (35)

### HIGH Severity (16)

#### 1.1 axios ≤0.29.0 (GHSA-wf5p-g6vw-rhxx, GHSA-jr5f-v2jv-69x6)
- **Issue:** CSRF vulnerability, SSRF and credential leakage via absolute URL
- **Affected:** `@orca-so/whirlpool-sdk`
- **Fix:** Update whirlpool-sdk or replace with alternative
- **Priority:** HIGH

#### 1.2 bigint-buffer (GHSA-3gc7-fjrx-p6mg)
- **Issue:** Buffer overflow via toBigIntLE()
- **Affected:** `@solana/buffer-layout-utils`, `@solana/spl-token`, `@solana/web3.js`
- **Fix:** `npm audit fix --force` (breaking change to wormhole-sdk)
- **Priority:** HIGH

#### 1.3 elliptic (GHSA-848j-6mx2-7j84)
- **Issue:** Cryptographic primitive with risky implementation
- **Affected:** `@cosmjs/crypto`, `secp256k1`
- **Fix:** Update secp256k1 to 1.1.6+ (breaking change)
- **Priority:** HIGH - affects crypto signing

### MODERATE Severity (6)

#### 1.4 nanoid <3.3.8 (GHSA-mwcw-c2x4-8c55)
- **Issue:** Predictable results with non-integer values
- **Affected:** `@drift-labs/sdk`
- **Fix:** Update drift-labs/sdk
- **Priority:** MEDIUM

#### 1.5 nodemailer ≤7.0.10 (GHSA-mm7p-fcc7-pg87, GHSA-rcmh-qjqh-p98v)
- **Issue:** Email domain interpretation conflict, DoS via recursion
- **Affected:** Direct dependency
- **Fix:** `npm update nodemailer` to 7.0.13+
- **Priority:** MEDIUM

#### 1.6 undici <6.23.0 (GHSA-g9mf-h72j-4rw9)
- **Issue:** Unbounded decompression chain DoS
- **Affected:** `discord.js`, `@discordjs/rest`
- **Fix:** Update discord.js
- **Priority:** MEDIUM

### LOW Severity (13)
- Various transitive dependencies with minor issues
- Most are informational or require specific conditions to exploit

---

## 2. Code Vulnerabilities

### HIGH Risk

#### 2.1 Command Injection - `src/nodes/index.ts`
```typescript
// VULNERABLE: User-controlled paths in shell commands
execSync(`ffmpeg ... -y "${outPath}" ...`);
execSync(`say "${text.replace(/"/g, '\\"')}"`);
execSync(`notify-send "${title}" "${body}"`);
```
- **Risk:** If `outPath`, `text`, `title`, or `body` contain shell metacharacters, arbitrary commands can be executed
- **Fix:** Use `execFile()` with array arguments instead of `execSync()` with string interpolation
- **Files:** `src/nodes/index.ts`, `src/macos/index.ts`

#### 2.2 Unsafe Sandbox - `src/security/index.ts`
```typescript
// WARNING in code: "Very basic sandboxing - in production, use vm2 or isolated-vm"
const fn = new Function(...Object.keys(sandbox), `"use strict"; return (${code})`);
```
- **Risk:** `new Function()` can be escaped; sandbox is not secure
- **Fix:** Replace with `isolated-vm` or `vm2` for production use
- **Files:** `src/security/index.ts:558`

### MEDIUM Risk

#### 2.3 Prototype Pollution Risk
```typescript
Object.assign(opp, scored);  // If 'scored' has __proto__, pollution possible
```
- **Risk:** If external data is merged without sanitization
- **Files:** Multiple files use `Object.assign()` with external data
- **Fix:** Validate objects before merging, use `Object.create(null)` for maps

#### 2.4 Credential Logging Risk
- **Risk:** 388 `process.env` references - ensure sensitive vars aren't logged
- **Fix:** Audit all logging calls to ensure no credential exposure
- **Files:** Throughout codebase

#### 2.5 Path Traversal - Potential
- **Risk:** User-controlled paths could escape intended directories
- **Fix:** Validate and normalize paths, use `path.resolve()` with base checks
- **Files:** File operation handlers

#### 2.6 Missing Rate Limiting
- **Risk:** API endpoints without rate limiting could be abused
- **Fix:** Implement rate limiting on all public endpoints
- **Files:** `src/gateway/`

### LOW Risk

#### 2.7 Error Message Information Disclosure
- **Risk:** Detailed error messages may leak internal paths/state
- **Fix:** Sanitize error messages in production

#### 2.8 Insecure Randomness
- **Risk:** `Math.random()` used in some non-crypto contexts
- **Fix:** Use `crypto.randomBytes()` for any security-sensitive randomness

#### 2.9 Missing Input Validation
- **Risk:** Some API inputs not fully validated
- **Fix:** Add input validation schemas (zod/joi)

---

## 3. Remediation Plan

### Phase 1: Critical Fixes (Before npm Publish)

| # | Issue | Fix | Status |
|---|-------|-----|--------|
| 1 | nodemailer | Updated to 7.0.13 | ✅ DONE |
| 2 | Command injection | Replaced execSync with execFileSync in nodes/index.ts and macos/index.ts | ✅ DONE |
| 3 | Unsafe sandbox | Added security warning + production logging in security/index.ts | ✅ DONE |

### Phase 2: High Priority (Next Release)

| # | Issue | Fix | Effort |
|---|-------|-----|--------|
| 4 | elliptic/secp256k1 | Update with breaking change testing | 4 hours |
| 5 | bigint-buffer | Update Solana libs | 4 hours |
| 6 | axios in orca-sdk | Replace orca-sdk or patch | 2 hours |
| 7 | discord.js undici | Update discord.js | 1 hour |

### Phase 3: Hardening (Ongoing)

| # | Issue | Fix | Effort |
|---|-------|-----|--------|
| 8 | Prototype pollution | Add object sanitization | 2 hours |
| 9 | Rate limiting | Add express-rate-limit | 2 hours |
| 10 | Input validation | Add zod schemas | 4 hours |
| 11 | Credential audit | Review all logging | 2 hours |

---

## 4. Security Best Practices Implemented

✅ **Encrypted credentials** - AES-256-GCM at rest
✅ **No hardcoded secrets** - All from environment
✅ **HTTPS enforced** - For all API calls
✅ **Webhook signature verification** - HMAC validation
✅ **SQL injection prevention** - Parameterized queries
✅ **Audit logging** - All trades logged

---

## 5. Recommended Security Headers

Add to gateway responses:
```typescript
{
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'",
}
```

---

## 6. Before Publishing Checklist

- [ ] Fix nodemailer vulnerability
- [ ] Fix command injection in nodes/index.ts
- [ ] Add sandbox warning or replace with vm2
- [ ] Run `npm audit` - ensure no critical/high in direct deps
- [ ] Test all trading functions work after updates
- [ ] Review this document with team

---

## 7. Disclosure Policy

Security issues should be reported to: security@clodds.dev (or GitHub Security Advisories)

Do NOT create public issues for security vulnerabilities.

---

*Generated by security audit on 2026-01-30*
