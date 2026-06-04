---
schema: agentcompanies/v1
kind: skill
name: demo-smoke-check
description: Light pre-review check that a freshly deployed demo is live and public (HTTP 200, not behind a Vercel auth wall) before it is posted to Discord for Board approval. Replaces the retired brand-consistency-check.
metadata:
  implementation: skills/demo-smoke-check/run.mjs
  primary_users: [demo-gen]
  cost_per_call_usd: 0
---

# demo-smoke-check

A light reachability check, **not** the quality gate. Ryan's approval in the
`morning-demo-review` flow is the quality gate; this skill exists only so a
**dead link or an auth-walled deploy never reaches Ryan's Discord**. It replaces
`brand-consistency-check`, which inspected vantyx-web-os-specific HTML markers
that a Lovable-built site does not have.

## When to use

- demo-gen heartbeat, immediately after `vercel-deploy` + `lead-update`. On
  pass, the lead stays at `stage='demo_built'` (eligible for the morning review
  digest). On fail, demo-gen comments on the Issue and skips — the broken demo
  is not posted.

## Inputs

CLI flags or a JSON object on stdin:

```json
{ "preview_url": "https://preview-acme-electric-abc123.vercel.app",
  "lead_name": "Acme Electric", "phone": "(419) 555-0147" }
```

- `--preview-url <url>` (required) — the canonical `*.vercel.app` demo URL.
- `--lead-name <name>` / `--phone <phone>` (optional) — used for the
  informational `has_name` / `has_phone` checks.

## Outputs

```json
{ "passes": true, "url": "...", "status": 200,
  "checks": { "http_200": true, "public": true, "has_tel": false,
              "has_phone": false, "has_name": true },
  "findings": [] }
```

`passes` is `true` when the demo returns HTTP 200 and is **not** behind a Vercel
auth/protection wall.

## Exit codes

- `0` — passes (live + public).
- `2` — does not pass (non-200, or protection still enabled).
- `3` — fetch / network error.
- `1` — CLI error (missing `--preview-url`).

## SPA caveat

Lovable ships a **client-rendered** Vite/React app, so the raw HTML of
`index.html` often does not contain the phone/name text even though the rendered
page does. `has_tel` / `has_phone` / `has_name` are therefore **informational
only** — `passes` depends solely on reachability + public access. The prompt
template asks Lovable to put the company name and phone in static markup, which
improves these signals but they are never hard-failed here.
