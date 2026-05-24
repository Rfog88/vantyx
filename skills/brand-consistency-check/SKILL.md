---
schema: agentcompanies/v1
kind: skill
name: brand-consistency-check
description: Diff a built site directory against the agency + per-client brand files and return a drift percentage with specific findings. Phase 1.5+.
metadata:
  implementation: skills/brand-consistency-check/run.mjs
  primary_users: [ux-designer, qa]
  status: stub-phase-1.5
---

# brand-consistency-check

Compare a generated site (the `site.config.ts` + the deployed Vercel
preview URL) against `shared/brand/vantyx.md` (agency) and
`shared/brand/clients/<slug>.md` (client). Return a drift score 0–100
where 0 = perfect match and 100 = totally drifted.

**Hard reject threshold: drift > 15%** — UXDesigner/QA blocks the deploy.

## When to use

- UXDesigner HEARTBEAT step 3 (review demo before deploy).
- QA HEARTBEAT (Phase 1.5) — final gate before public preview URL is sent
  to a prospect.

## When NOT to use

- For internal-only sites (Vantyx tooling, dashboards).
- Without a per-client brand file (`shared/brand/clients/<slug>.md`) —
  cannot diff against agency-only baseline meaningfully.

## Inputs

```json
{
  "client_slug": "acme-electric",
  "site_config_path": "/tmp/demos/acme-electric/site.config.ts",
  "preview_url": "https://acme-electric.preview.<your-domain>"
}
```

## Outputs

```json
{
  "drift_score": 8,
  "passes_threshold": true,
  "findings": [
    "OK: license # in hero",
    "OK: tap-to-call header",
    "WARN: accent color is #F59E0B but client palette is #E11D48 (delta=12%)",
    "OK: Lighthouse mobile 87"
  ]
}
```

## Drift dimensions checked

1. Palette (color delta in LAB space).
2. Typography (font family / weight / size match).
3. Non-negotiables checklist from `shared/brand/vantyx.md`:
   - License # above the fold
   - Mobile tap-to-call header
   - Real Google reviews (not placeholder)
   - Service-area map present
   - Contact form present
   - Schema.org JSON-LD in footer
   - Lighthouse mobile ≥85

## Implementation

Phase 1.5 live: HTTP-fetch + regex/HTML-parse against the deployed preview;
palette diff in LAB color space against the per-client brand file. Lighthouse
audit deferred to Phase 2 (needs a real Lighthouse run, not a check).

Returns `drift_score 0-100` (lower is better) and `passes_threshold` boolean
(true if drift_score ≤ 15). Findings array has per-check `{level, msg}` so
QA's rejection comment writes itself.
