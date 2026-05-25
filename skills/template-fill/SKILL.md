---
schema: agentcompanies/v1
kind: skill
name: template-fill
description: Write site.config.ts in a cloned Vantyx Web OS directory by merging a lead's brand-extract output, the per-client brand file, and the lead's SQLite row.
metadata:
  implementation: skills/template-fill/run.mjs
  requires_env:
    - LEADS_DB_PATH        # default /home/paperclip/vantyx-leads.sqlite
    - NODE_OPTIONS         # --experimental-sqlite on Node 22.x
  primary_users: [demo-gen]
  cost_per_call_usd: 0
---

# template-fill

Compose a complete `site.config.ts` for a per-lead Vantyx Web OS clone.
Reads three sources:
1. The lead row from SQLite (name, phone, niche, city, state, zip, gmaps_rating)
2. The per-client brand file at `shared/brand/clients/<slug>.md` (palette,
   fonts, voice, photography notes — authored by UXDesigner)
3. The agency brand at `shared/brand/vantyx.md` (non-negotiables, fallback
   palette)

Writes to `<clone-path>/site.config.ts`. Overwrites any existing file.

## When to use

- `demo-gen` heartbeat, step 3 — after `template-clone` and after
  UXDesigner has authored the per-client brand file.

## When NOT to use

- Before `template-clone` (no target directory yet).
- Before UXDesigner brand file exists (would fall back to niche-default
  silently — not the intent).

## Inputs

```json
{
  "lead-id": "<uuid>",
  "clone-path": "/tmp/demos/acme-electric",
  "client-slug": "acme-electric"
}
```

## Outputs

```json
{
  "wrote": "/tmp/demos/acme-electric/site.config.ts",
  "bytes": 4321,
  "warnings": ["client brand file missing — used niche defaults"]
}
```

## Failure modes

- `clone-path` doesn't exist → exit `decision-needed`.
- `lead-id` not found in SQLite → exit `decision-needed`.
- Write fails (disk, permissions) → exit `unknown-failure`.
