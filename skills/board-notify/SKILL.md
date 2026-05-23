---
schema: agentcompanies/v1
kind: skill
name: board-notify
description: Lower-level notification helper. Posts to Discord via webhook and (optionally) sends Twilio SMS for Tier-2. Does NOT create a Paperclip Issue — use `escalate-to-board` for that.
metadata:
  requires_env:
    - DISCORD_WEBHOOK_URL
    # optional Tier-2-only:
    - TWILIO_AUTH_TOKEN
    - TWILIO_ACCOUNT_SID
    - TWILIO_FROM_NUMBER
    - BOARD_PHONE
    - BOARD_DND_HOURS    # e.g. "22-07"; Tier-1 holds inside window
  implementation: skills/board-notify/run.mjs
  primary_users: [all]
---

# board-notify

Fire-and-forget notification primitive. Used by `escalate-to-board` and
`kpi-rollup`, and directly by agents only when a Paperclip-Issue
escalation would be overkill (e.g., Tier-0 daily digest).

## When to use

- Tier-0 status digest (CEO end-of-day weekday post).
- As the Discord layer underneath `escalate-to-board`.

## When NOT to use

- For anything that needs Board ACK — use `escalate-to-board` instead so
  there is a tracked Paperclip Issue.
- For per-Issue progress updates — comment on the Issue instead.

## Inputs

```json
{
  "tier": 0,                    // 0=info, 1=decision, 2=hardblock
  "channel": "vantyx-status",   // discord channel (resolved via webhook URL routing)
  "title": "...",
  "body": "...",
  "issue_url": "...",           // optional Paperclip Issue link
  "sms_on_tier_2": true
}
```

## Outputs

- HTTP 204 from Discord (success).
- Stdout: JSON `{discord: "ok", sms: "sent"|"skipped"|"dnd"}`.

## Behavior

- Honors `BOARD_DND_HOURS` env var for tier 1 (holds in queue until window
  ends). Tier 0 silently drops during DND. Tier 2 always fires.
- Includes a "Reply ACK on this message" hint for tier ≥1.
