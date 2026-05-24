---
schema: agentcompanies/v1
kind: skill
name: notify-cmo-sdr
description: Post a structured "demo ready" message to Discord for CMO + SDR — wraps board-notify Tier 0 with a consistent format.
metadata:
  requires_env:
    - DISCORD_WEBHOOK_URL
  implementation: skills/notify-cmo-sdr/run.mjs
  primary_users: [demo-gen]
  cost_per_call_usd: 0
---

# notify-cmo-sdr

Higher-level Discord notification for the "Before We Even Spoke" pipeline.
Wraps `board-notify` Tier 0 with a consistent template so CMO and SDR can
quickly scan deploys.

## When to use

- `demo-gen` step 6 — final action after `lead-update` succeeds. Posts
  `{lead_name, demo_url, score, niche, city}` so the next outreach action
  is one click away.

## When NOT to use

- For escalations or decision-needed scenarios → use `escalate-to-board`
  instead.
- For weekly digests → use `kpi-rollup`.

## Inputs

```json
{
  "lead-name": "Collier Electric",
  "demo-url": "https://preview-collier-electric-abc.vercel.app",
  "score": 75,
  "niche": "electrician",
  "city": "Lima, OH"
}
```

## Outputs

```json
{ "posted": true, "channel": "discord-default" }
```

## Failure modes

- `DISCORD_WEBHOOK_URL` missing → exit `api-key-missing`.
- Webhook returns non-2xx → exit `adapter-broken` (don't retry — the
  underlying `board-notify` already handles transient retries).
