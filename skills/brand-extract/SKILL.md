---
schema: agentcompanies/v1
kind: skill
name: brand-extract
description: Use Playwright headless to fetch a lead's current website and extract logo, dominant colors, typography hints, services, NAP, and H1 voice into a brand-extraction payload for UXDesigner.
metadata:
  requires_env:
    - DATABASE_URL
  implementation: skills/brand-extract/run.mjs
  cost_per_call_usd: 0      # local Playwright; only compute cost
  primary_users: [ux-designer, demo-gen]
  status: stub-phase-1.5
---

# brand-extract

Headless-browser scrape of a lead's existing website. Produces a JSON
payload that UXDesigner uses to author `shared/brand/clients/<slug>.md`.

## When to use

- Phase 1.5+: triggered automatically when demo-gen picks up a lead at
  `stage='new'` with `score >= 65`.
- Ad-hoc by UXDesigner when manually preparing a brand file for a lead.

## When NOT to use

- Phase 1 (no demo pipeline yet) — UXDesigner authors brand files manually
  from gmaps_rating + niche heuristics.
- On leads without a website (`website IS NULL`) — fall back to niche-default
  palette per UXDesigner's `_catalog.md`.

## Inputs

```json
{
  "lead_id": "<uuid>",
  "url": "https://acme-electric.com"
}
```

## Outputs

```json
{
  "logo_url": "...",
  "palette": ["#0F172A", "#F59E0B", "#FFFFFF"],
  "fonts": ["Inter", "system-ui"],
  "h1_voice_sample": "Lima's Trusted Electrician Since 2014",
  "services": ["Panel Upgrades", "EV Chargers", "..."],
  "nap": { "phone": "...", "address": "...", "hours": "..." }
}
```

## Implementation

Node ESM with Playwright. Status for Phase 1: stub (see `run.mjs`). Full
implementation deferred to Phase 1.5 per plan Section 4. Developer will
implement when CTO files the Issue.

## Failure modes

- Site unreachable / timeout → return partial payload with `errors: ["unreachable"]`; UXDesigner falls back to niche defaults.
- No logo found → omit `logo_url`; UXDesigner will note it for manual upload.
- Palette extraction confidence low → escalate Tier 1 `decision-needed` to Board (UXDesigner does the escalation, not this skill).
