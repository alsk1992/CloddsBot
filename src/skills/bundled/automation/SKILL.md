---
name: automation
description: "Schedule cron jobs and automate recurring tasks with named presets and manual triggers. Use when users want to set up recurring scans, periodic reports, or automated trading schedules."
commands:
  - /auto
  - /automation
---

# Automation - Cron Scheduler

Schedule recurring tasks using cron expressions with preset support.

## Commands

```
/auto list                            - List all scheduled jobs
/auto cron <schedule> <command>       - Create a cron job
/auto remove <id>                     - Remove a job
/auto enable <id>                     - Enable a job
/auto disable <id>                    - Disable a job
/auto trigger <id>                    - Manually run a job
/auto presets                         - Show available schedule presets
```

## Cron Expressions

| Expression | Description |
|------------|-------------|
| `* * * * *` | Every minute |
| `0 * * * *` | Every hour |
| `0 9 * * *` | Daily at 9am |
| `*/15 * * * *` | Every 15 minutes |
| `0 0 1 * *` | First of month |

## Presets

Instead of a cron expression, you can use a named preset:

```
/auto cron EVERY_MINUTE check-prices
/auto cron EVERY_5_MINUTES portfolio-sync
/auto cron EVERY_15_MINUTES scan-arbs
/auto cron HOURLY report
/auto cron DAILY_MIDNIGHT snapshot
/auto cron DAILY_9AM morning-scan
/auto cron WEEKLY_MONDAY_9AM weekly-report
/auto cron MONTHLY monthly-summary
```

## Examples

```
/auto cron "*/5 * * * *" portfolio-sync
/auto cron HOURLY check-positions
/auto list
/auto trigger job-1234567890
/auto disable job-1234567890
/auto remove job-1234567890
/auto presets
```
