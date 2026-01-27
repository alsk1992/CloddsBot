---
name: alerts
description: "Create and manage price alerts for prediction markets"
emoji: "🔔"
---

# Alerts Skill

Set up price alerts to get notified when markets move.

## Commands

### Create Alert
```
/alert "Trump 2028" above 0.50
/alert "Fed rate cut" below 0.30
/alert "Trump 2028" change 5%
```

### List Alerts
```
/alerts
```

### Delete Alert
```
/alert delete [alert-id]
```

## Alert Types

### Price Above
Triggers when price goes above threshold:
```
/alert "market" above 0.60
```

### Price Below
Triggers when price drops below threshold:
```
/alert "market" below 0.25
```

### Price Change
Triggers on X% move in either direction within time window:
```
/alert "market" change 5%        # 5% in any direction
/alert "market" change 10% 1h    # 10% within 1 hour
```

### Volume Spike
Triggers when volume exceeds normal levels:
```
/alert "market" volume 3x        # 3x normal volume
```

## Examples

User: "Alert me if Trump drops below 40 cents"
→ Create price_below alert at 0.40

User: "Notify me on any 5% move in the Fed market"
→ Create price_change alert at 5%

User: "What alerts do I have?"
→ List all active alerts with current vs trigger prices
