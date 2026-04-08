---
name: webhooks
description: "Create, manage, and secure webhooks with HMAC signing, rate limiting, and retry logic. Register endpoints, test deliveries, and monitor webhook health. Use when integrating external services, receiving trade notifications, or building event-driven workflows."
commands:
  - /webhooks
  - /webhook
---

# Webhooks

Register, manage, and inspect incoming webhook endpoints with optional HMAC-SHA256 signature verification.

## Commands

```
/webhooks list                              - List all registered webhooks
/webhooks register <id> <path>              - Register a webhook endpoint
/webhooks register <id> <path> --secret <key> - Register with HMAC secret
/webhooks unregister <id>                   - Remove a webhook
/webhooks enable <id>                       - Enable a webhook
/webhooks disable <id>                      - Disable a webhook
/webhooks get <id>                          - View webhook details
```

## Examples

```
/webhooks list
/webhooks register trade-signals /hooks/trades
/webhooks register alerts /hooks/alerts --secret mysecretkey
/webhooks get trade-signals
/webhooks disable trade-signals
/webhooks enable trade-signals
/webhooks unregister trade-signals
```

## Webhook Details

The `/webhooks get <id>` command shows:

- Path the webhook listens on
- Description (if set)
- Enabled/disabled status
- Whether an HMAC secret is configured
- Total trigger count

## Security

Webhooks support HMAC-SHA256 payload verification. Pass `--secret <key>` when registering to enable signature validation on incoming requests.
