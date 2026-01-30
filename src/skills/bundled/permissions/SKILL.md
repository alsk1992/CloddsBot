---
name: permissions
description: "Command approvals, tool policies, and exec security"
emoji: "🛡️"
---

# Permissions - Complete API Reference

Manage command execution approvals, tool access policies, and security controls.

---

## Chat Commands

### View Permissions

```
/permissions                                View current permissions
/permissions list                           List all rules
/permissions pending                        View pending approvals
/permissions history                        View approval history
```

### Approve/Reject

```
/approve                                    Approve pending command
/approve <id>                               Approve specific request
/reject                                     Reject pending command
/reject <id> "reason"                       Reject with reason
```

### Allow/Block Rules

```
/permissions allow "npm install"            Allow pattern
/permissions allow "git *"                  Allow with wildcard
/permissions block "rm -rf"                 Block dangerous command
/permissions remove <rule-id>               Remove rule
```

### Security Mode

```
/permissions mode                           Check current mode
/permissions mode allowlist                 Only allowed commands
/permissions mode blocklist                 Block specific commands
/permissions mode full                      Allow all (dangerous)
```

---

## TypeScript API Reference

### Create Permissions Manager

```typescript
import { createPermissionsManager } from 'clodds/permissions';

const perms = createPermissionsManager({
  // Security mode
  mode: 'allowlist',  // 'deny' | 'allowlist' | 'blocklist' | 'full'

  // Default rules
  defaultAllow: [
    'ls *',
    'cat *',
    'git status',
    'git diff',
    'npm run *',
  ],

  defaultBlock: [
    'rm -rf *',
    'sudo *',
    'chmod 777 *',
  ],

  // Approval settings
  requireApproval: true,
  approvalTimeoutMs: 60000,

  // Storage
  storage: 'sqlite',
  dbPath: './permissions.db',
});
```

### Check Permission

```typescript
// Check if command is allowed
const result = await perms.check({
  command: 'npm install lodash',
  userId: 'user-123',
  context: 'Installing dependency',
});

if (result.allowed) {
  console.log('Command allowed');
} else if (result.needsApproval) {
  console.log(`Waiting for approval: ${result.requestId}`);
} else {
  console.log(`Blocked: ${result.reason}`);
}
```

### Request Approval

```typescript
// Request approval for command
const request = await perms.requestApproval({
  command: 'docker build -t myapp .',
  userId: 'user-123',
  reason: 'Building application container',
});

console.log(`Request ID: ${request.id}`);
console.log(`Status: ${request.status}`);

// Wait for approval
const approved = await perms.waitForApproval(request.id, {
  timeoutMs: 60000,
});

if (approved) {
  console.log('Approved! Executing...');
}
```

### Approve/Reject

```typescript
// Approve request
await perms.approve({
  requestId: 'req-123',
  approvedBy: 'admin-user',
  note: 'Looks safe',
});

// Reject request
await perms.reject({
  requestId: 'req-123',
  rejectedBy: 'admin-user',
  reason: 'Command too broad',
});
```

### List Pending

```typescript
// Get pending approvals
const pending = await perms.listPending();

for (const req of pending) {
  console.log(`[${req.id}] ${req.command}`);
  console.log(`  User: ${req.userId}`);
  console.log(`  Reason: ${req.reason}`);
  console.log(`  Requested: ${req.createdAt}`);
}
```

### Add Rules

```typescript
// Add allow rule
await perms.addRule({
  type: 'allow',
  pattern: 'npm run *',
  description: 'Allow npm scripts',
  createdBy: 'admin',
});

// Add block rule
await perms.addRule({
  type: 'block',
  pattern: 'rm -rf /',
  description: 'Prevent root deletion',
  createdBy: 'admin',
});

// List rules
const rules = await perms.listRules();

for (const rule of rules) {
  console.log(`${rule.type}: ${rule.pattern}`);
}

// Remove rule
await perms.removeRule('rule-id');
```

### Tool Policies

```typescript
// Set tool policy for agent
await perms.setToolPolicy({
  agentId: 'trading',
  allow: ['execute', 'portfolio', 'markets'],
  deny: ['browser', 'docker', 'exec'],
});

// Check tool access
const canUse = perms.isToolAllowed('trading', 'execute');

// Get agent's allowed tools
const tools = perms.getAllowedTools('trading');
```

---

## Security Modes

| Mode | Behavior |
|------|----------|
| **deny** | Block all exec commands |
| **allowlist** | Only explicitly allowed commands |
| **blocklist** | Block specific patterns, allow rest |
| **full** | Allow all (dangerous!) |

---

## Pattern Syntax

| Pattern | Matches |
|---------|---------|
| `npm install` | Exact command |
| `npm *` | npm with any args |
| `git status` | Exact command |
| `* --version` | Any command with --version |

---

## Built-in Safety Rules

Always blocked regardless of mode:
- `rm -rf /`
- `sudo rm -rf`
- `chmod 777 /`
- `:(){ :|:& };:` (fork bomb)
- Commands with shell injection patterns

---

## CLI Commands

```bash
# List permission rules
clodds permissions list

# Add allow pattern
clodds permissions allow "npm run *"

# View pending approvals
clodds permissions pending

# Approve request
clodds permissions approve req-123
```

---

## Best Practices

1. **Use allowlist mode** — Most secure, explicit permissions
2. **Review pending regularly** — Don't let requests pile up
3. **Specific patterns** — `npm install lodash` over `npm *`
4. **Audit history** — Review what was approved
5. **Tool policies** — Restrict agent tool access
