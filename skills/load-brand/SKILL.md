---
schema: agentcompanies/v1
kind: skill
name: load-brand
description: Return the agency brand file plus (optionally) a per-client brand file as a single markdown payload. Read-only.
metadata:
  implementation: skills/load-brand/run.mjs
  primary_users: [ceo, cmo, ux-designer, developer, sdr, demo-gen]
---

# load-brand

Read `shared/brand/vantyx.md` (agency brand) and optionally
`shared/brand/clients/<client_slug>.md` (per-client brand). Return both as
a single concatenated markdown payload with section separators.

Every customer-facing agent reads this at the start of any client-facing
work — it's the Memento fix per plan Section 8.

## When to use

- Before generating, reviewing, or approving any client-facing output
  (copy, code, design, demo).
- Before responding to a Board comment that involves brand or voice.

## When NOT to use

- For internal-only work (CRM hygiene, infra config, etc.).
- In a tight loop — cache the result for the duration of one Issue.

## Inputs

```json
{
  "client_slug": null    // or "<lead-slug>" for per-client overlay
}
```

## Outputs

Concatenated markdown, agency brand first then per-client (if any),
separated by `\n\n---\n\n` and section headers `# Vantyx Brand` and
`# Client Brand: <slug>`.

## Failure modes

- Agency file missing (`shared/brand/vantyx.md`) → Tier 2 `unknown-failure`.
  This is the source of truth; its absence is a project-level emergency.
- Client file missing when `client_slug` supplied → return agency brand only
  with a `_warning: "client_brand_missing"` JSON line at the top.
