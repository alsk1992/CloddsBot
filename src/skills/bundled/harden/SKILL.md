---
name: harden
description: VPS security auditing and hardening
emoji: "🔒"
commands:
  - /harden
---

# VPS Hardening

Security auditing and automated hardening for remote servers.

## Commands

### `/harden audit <host>`
Run security audit against a server. Checks:
- System updates
- Auto-updates configuration
- SSH root login status
- Password authentication
- Firewall status
- Fail2ban status
- System uptime
- Listening services
- Sudo user configuration

### `/harden fix <host>`
Apply safe fixes that won't lock you out:
- Install system updates
- Enable unattended-upgrades
- Configure UFW firewall
- Install and enable fail2ban
- Set SSH MaxAuthTries

### `/harden emergency <host>`
Quick 10-minute hardening for new servers:
- Full system update
- Firewall setup
- Fail2ban installation
- Root password lock

### `/harden report <host>`
Generate markdown security report.

## Options

| Option | Description |
|--------|-------------|
| `--user=NAME` | SSH user (default: root) |
| `--dry-run` | Preview changes without applying |

## Examples

```
/harden audit 192.168.1.100
/harden fix myserver.com --user=admin
/harden emergency vps.example.com --dry-run
/harden report server.io > security-report.md
```

## Security Checks

| Check | Pass Criteria |
|-------|---------------|
| System Updates | 0 pending updates |
| Auto Updates | unattended-upgrades installed |
| Root Login | PermitRootLogin no |
| Password Auth | PasswordAuthentication no |
| Firewall | UFW active or iptables configured |
| Fail2ban | Service running |
| Uptime | < 90 days |
| Services | < 10 listening ports |
| Sudo Users | At least one non-root sudo user |
| MaxAuthTries | Set to 3 or less |
