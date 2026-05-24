---
schema: agentcompanies/v1
kind: skill
name: kpi-rollup
description: Compute the morning KPI digest (leads scraped, ≥65 leads, demos built, agent quota burn) and post via board-notify Tier 0 if delta-worthy.
metadata:
  requires_env:
    - LEADS_DB_PATH        # optional; default /home/paperclip/vantyx-leads.sqlite
    - DISCORD_WEBHOOK_URL
    - NODE_OPTIONS         # set to --experimental-sqlite on Node 22.x
  implementation: skills/kpi-rollup/run.mjs
  primary_users: [ceo, cto, cmo]
  storage: sqlite (read-only here; populated by gmaps-scrape + lead-score)
---

# kpi-rollup

Pull yesterday's metrics from:
- The `leads` table (scraped/scored/stage transitions).
- Paperclip agent budget endpoints (notional USD spend per agent).
- Vercel API (deploys yesterday) — Phase 1.5+.

Compose a five-bullet digest. Compare to a 7-day moving average. Post via
`board-notify` Tier 0 **only if at least one metric has changed by >15%**
from average — otherwise stay silent (no "all systems normal" pings).

## When to use

- CEO heartbeat morning step (Aria's HEARTBEAT.md step 4).
- Weekly Monday rollup (longer horizon, posted by Aria explicitly).

## When NOT to use

- Mid-day rollups — that's noise unless something is on fire.
- During DND window (Tier 0 is silently dropped by board-notify).

## Inputs

```json
{
  "window": "daily"           // or "weekly"
}
```

## Outputs

- If delta-worthy: posts to Discord via board-notify; stdout
  `{posted: true, deltas: [...]}`.
- Otherwise: stdout `{posted: false, reason: "no_meaningful_delta"}`.

## Metrics calculated

1. **Leads scraped (24h)** — target ≥20, alert if <10.
2. **High-score leads ≥65 (24h)** — target ≥8, alert if <4.
3. **Demos built (24h, Phase 1.5)** — target ≥5.
4. **Stage conversions:** new → demo_built, demo_built → outreach_sent (Phase 2).
5. **Agent quota burn** — any agent over 50% by midday is a warning.

## Implementation status

Live for the leads-pipeline metrics (queries the SQLite store directly). The
Paperclip per-agent budget metric is deferred until we wire `PAPERCLIP_API_TOKEN`
properly; for now `kpi-rollup` reports lead-pipeline numbers only and skips
budget burn.
