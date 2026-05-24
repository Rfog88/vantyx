---
schema: agentcompanies/v1
kind: skill
name: brand-extract
description: Lightweight HTTP scraper that pulls logo, palette, fonts, services, NAP from a lead's existing website. No Playwright; fast and dependency-free.
metadata:
  implementation: skills/brand-extract/run.mjs
  primary_users: [demo-gen, ux-designer]
  cost_per_call_usd: 0
---

# brand-extract

HTTP-fetch + regex/HTML-parse a lead's existing website. Returns brand
metadata as JSON for UXDesigner to author the per-client brand file at
`shared/brand/clients/<lead-slug>.md`.

## When to use

- `demo-gen` heartbeat, step 1 of the pipeline, when a lead enters
  `stage='new'` with `score>=65`.
- Ad-hoc by UXDesigner when manually preparing a brand file.

## When NOT to use

- For leads with no website — the skill detects this and returns a niche-
  default payload so the pipeline can continue.
- For leads where UXDesigner has already authored the brand file (no need to
  re-extract).

## Inputs

```json
{
  "lead-id": "<uuid>",
  "url": "https://acme-electric.com",
  "niche": "electrician"
}
```

## Outputs

```json
{
  "logo_url": "https://acme-electric.com/logo.png",
  "palette": { "primary": "#0F172A", "accent": "#FACC15", "bg": "#FFFFFF", "text": "#111827", "muted": "#6B7280" },
  "fonts": ["Inter", "Roboto"],
  "title": "Acme Electric — Lima OH",
  "h1_voice_sample": "Lima's Trusted Electrician Since 2014",
  "services": ["Panel Upgrades", "EV Chargers", "..."],
  "nap": { "phone": "419-555-0101", "email": "...", "city": "Lima", "state": "OH", "zip": "45801" },
  "_status": "ok",
  "_palette_candidates": ["#0F172A", "#FACC15", "..."]
}
```

`_status` can be: `ok` | `no-website` | `unreachable` | `error`.

## Failure modes

- Site times out (>12s) → returns `_status: "error"` with niche-default
  palette. demo-gen continues.
- Site returns 4xx/5xx → returns `_status: "unreachable"` with niche-default.
- Site requires JS to render content → we miss client-rendered text. Phase 2
  will add Playwright for SPAs; Phase 1.5 accepts the gap.

## Implementation notes

- Uses native `fetch` with a 12s timeout.
- Color extraction = frequency-rank of hex codes in inline/linked CSS. Crude
  but workable for Phase 1.5; Phase 2 will replace with color-quantize on a
  screenshot.
- Font extraction looks at Google Fonts links and `font-family` declarations.
- Service guess looks for `<ul>` with 3–12 capitalized list items.
- User-Agent identifies as `VantyxBot/1.0` so it's auditable and respects robots.
