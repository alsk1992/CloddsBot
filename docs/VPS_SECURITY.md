# VPS Security Guide

Hardening checklist and automated tools for production servers.

## The Reality

Within 60 seconds of spinning up a VPS, bots are already trying to break in. Automated scanners constantly probe every IP on the internet for vulnerable servers.

This guide covers the 10 most common mistakes and how to fix them.

## Quick Start

```bash
# Run automated audit
/harden audit your-server-ip

# Apply safe fixes
/harden fix your-server-ip

# Emergency 10-minute hardening
/harden emergency your-server-ip
```

## The Checklist

| # | Check | Command to Verify |
|---|-------|-------------------|
| 1 | System updated | `apt list --upgradable` |
| 2 | Auto-updates enabled | `dpkg -l \| grep unattended` |
| 3 | Non-root user exists | `getent group sudo` |
| 4 | SSH keys only | `grep PasswordAuth /etc/ssh/sshd_config` |
| 5 | Root login disabled | `grep PermitRootLogin /etc/ssh/sshd_config` |
| 6 | Firewall active | `ufw status` |
| 7 | Fail2ban running | `systemctl is-active fail2ban` |
| 8 | Minimal services | `ss -tulpn \| grep LISTEN` |
| 9 | Reasonable uptime | `uptime` (< 90 days) |
| 10 | Backups configured | Manual check |

---

## Mistake #1: Not Updating

Every piece of software has vulnerabilities. Patches fix them.

**Check:**
```bash
apt list --upgradable 2>/dev/null | wc -l
```

**Fix:**
```bash
sudo apt update && sudo apt upgrade -y
```

**Enable auto-updates:**
```bash
sudo apt install unattended-upgrades -y
sudo dpkg-reconfigure -plow unattended-upgrades
```

A server up for 400 days isn't impressive. It's concerning.

---

## Mistake #2: Logging in as Root

Root can do anything. One typo, one compromised session = game over.

**Fix:**
```bash
# Create non-root user
adduser deployer
usermod -aG sudo deployer

# Test before proceeding
su - deployer
sudo whoami  # Should output: root
```

---

## Mistake #3: Password Authentication

Passwords can be guessed. SSH keys can't be brute-forced.

**Generate key (local machine):**
```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
```

**Copy to server:**
```bash
ssh-copy-id deployer@your-server-ip
```

**Disable passwords:**
```bash
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
PermitEmptyPasswords no
MaxAuthTries 3
AllowUsers deployer
```

```bash
sudo systemctl restart sshd
```

**Critical:** Keep current session open. Test in new terminal first.

---

## Mistake #4: No Firewall

Without a firewall, every port is accessible to the internet.

**Fix:**
```bash
sudo apt install ufw -y
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp   # If running web server
sudo ufw allow 443/tcp  # If running HTTPS
sudo ufw enable
```

Only open ports you're actually using. Every port is attack surface.

---

## Mistake #5: No Brute-Force Protection

Even with SSH keys, bots hammer your server constantly.

**Fix:**
```bash
sudo apt install fail2ban -y
```

**Configure:**
```bash
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
```

Edit `/etc/fail2ban/jail.local`:
```ini
[sshd]
enabled = true
port = ssh
maxretry = 3
bantime = 3600
findtime = 600
```

3 failed attempts in 10 minutes = banned for 1 hour.

```bash
sudo systemctl enable fail2ban
sudo systemctl restart fail2ban
```

**Check bans:**
```bash
sudo fail2ban-client status sshd
```

---

## Mistake #6: Unnecessary Services

Every running service is potential attack surface.

**Check what's listening:**
```bash
sudo ss -tulpn | grep LISTEN
```

**Disable what you don't need:**
```bash
sudo systemctl disable cups
sudo systemctl stop cups
```

Ask yourself: Do I actually need this service?

---

## Mistake #7: No Backups

Security isn't just prevention. It's recovery.

**Simple backup script:**
```bash
#!/bin/bash
# /usr/local/bin/backup.sh

BACKUP_DIR="/backup"
REMOTE="user@backup-server:/backups"
DATE=$(date +%Y-%m-%d)

# Create backup
tar -czf $BACKUP_DIR/backup-$DATE.tar.gz /home /etc /var/www

# Sync to remote (backup should NOT be on same server)
rsync -az $BACKUP_DIR/backup-$DATE.tar.gz $REMOTE/

# Clean old backups
find $BACKUP_DIR -name "backup-*.tar.gz" -mtime +7 -delete
```

**Schedule:**
```bash
sudo crontab -e
# Add:
0 2 * * * /usr/local/bin/backup.sh
```

---

## Emergency 10-Minute Hardening

No time? Do this immediately:

```bash
# Update everything
sudo apt update && sudo apt upgrade -y

# Create non-root user
adduser deployer && usermod -aG sudo deployer

# Basic firewall
sudo apt install ufw -y
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw --force enable

# Fail2ban with defaults
sudo apt install fail2ban -y
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Disable root password
sudo passwd -l root
```

---

## Using the Harden Skill

### Audit a Server

```bash
/harden audit 192.168.1.100
```

Output:
```
Security Audit: 192.168.1.100
Score: 6/10

✅ System Updates: System is up to date
✅ Auto Updates: unattended-upgrades installed
❌ Root SSH Login: Root login is enabled
❌ Password Auth: Password authentication enabled
✅ Firewall (UFW): UFW is active
✅ Fail2ban: Fail2ban is running
⚠️ Uptime: 45 days - consider rebooting for kernel updates
✅ Listening Services: 4 services listening - minimal
⚠️ Sudo Users: No non-root sudo users found
⚠️ SSH MaxAuthTries: MaxAuthTries not set (default 6)

Run /harden fix 192.168.1.100 to apply safe fixes
```

### Apply Safe Fixes

```bash
/harden fix myserver.com --user=admin
```

Safe fixes (won't lock you out):
- System updates
- Auto-updates installation
- Firewall setup
- Fail2ban installation
- SSH MaxAuthTries

Manual fixes required:
- Disabling root login (could lock you out)
- Disabling password auth (could lock you out)
- Creating sudo user

### Generate Report

```bash
/harden report vps.example.com
```

Outputs markdown report suitable for documentation.

### Options

```bash
/harden audit host --user=deployer  # Use non-root user
/harden fix host --dry-run          # Preview changes
```

---

## SSH Config Hardening

Full recommended `/etc/ssh/sshd_config`:

```bash
# Authentication
PermitRootLogin no
PasswordAuthentication no
PermitEmptyPasswords no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys

# Limits
MaxAuthTries 3
MaxSessions 5
LoginGraceTime 30

# Access control
AllowUsers deployer admin
# Or: AllowGroups ssh-users

# Security
X11Forwarding no
PermitUserEnvironment no
AllowAgentForwarding no
AllowTcpForwarding no

# Logging
LogLevel VERBOSE
```

---

## Monitoring

### Check failed login attempts

```bash
# Recent failures
sudo grep "Failed password" /var/log/auth.log | tail -20

# Count by IP
sudo grep "Failed password" /var/log/auth.log | \
  grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | \
  sort | uniq -c | sort -rn | head -10
```

### Check fail2ban status

```bash
# Overall status
sudo fail2ban-client status

# SSH jail specifically
sudo fail2ban-client status sshd

# Currently banned IPs
sudo fail2ban-client get sshd banned
```

### Check firewall

```bash
# UFW status
sudo ufw status verbose

# Actual iptables rules
sudo iptables -L -n -v
```

---

## Advanced: Additional Hardening

### Change SSH Port (security through obscurity)

```bash
# /etc/ssh/sshd_config
Port 2222

# Update firewall
sudo ufw allow 2222/tcp
sudo ufw delete allow ssh
sudo systemctl restart sshd
```

### Install rootkit scanner

```bash
sudo apt install rkhunter chkrootkit -y
sudo rkhunter --check
sudo chkrootkit
```

### Enable audit logging

```bash
sudo apt install auditd -y
sudo systemctl enable auditd

# Log all sudo commands
sudo auditctl -a always,exit -F arch=b64 -S execve -F euid=0 -k rootcmd
```

### Disable IPv6 (if not using)

```bash
# /etc/sysctl.conf
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1

sudo sysctl -p
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Update system | `sudo apt update && sudo apt upgrade -y` |
| Check listening ports | `sudo ss -tulpn` |
| Check firewall | `sudo ufw status` |
| Check fail2ban | `sudo fail2ban-client status sshd` |
| Check auth logs | `sudo tail -f /var/log/auth.log` |
| Restart SSH | `sudo systemctl restart sshd` |
| Ban IP manually | `sudo fail2ban-client set sshd banip 1.2.3.4` |
| Unban IP | `sudo fail2ban-client set sshd unbanip 1.2.3.4` |

---

## Resources

- [Ubuntu Server Guide](https://ubuntu.com/server/docs)
- [Fail2ban Documentation](https://www.fail2ban.org/)
- [UFW Documentation](https://help.ubuntu.com/community/UFW)
- [SSH Hardening Guide](https://www.ssh.com/academy/ssh/sshd_config)
