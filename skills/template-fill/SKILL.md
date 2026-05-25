---
schema: agentcompanies/v1
kind: skill
name: template-fill
description: Write site.config.ts in a cloned Vantyx Web OS directory by merging a lead's brand-extract output, the per-client brand file, the lead's SQLite row, and live Google Business Profile (GBP) media + reviews.
metadata:
  implementation: skills/template-fill/run.mjs
  requires_env:
    - LEADS_DB_PATH        # default /home/paperclip/vantyx-leads.sqlite
    - NODE_OPTIONS         # --experimental-sqlite on Node 22.x
  optional_env:
    - GOOGLE_PLACES_API_KEY        # Places API (New). Required for live GBP fetch; without it template-fill uses cached values only.
    - VANTYX_BRAND_FALLBACK_IMAGE_URL  # In-house hero fallback when GBP has no cover photo. Stock photos are NEVER acceptable.
  primary_users: [demo-gen]
  cost_per_call_usd: 0
---

# template-fill

Compose a complete `site.config.ts` for a per-lead Vantyx Web OS clone.
Reads three sources:
1. The lead row from SQLite (name, phone, niche, city, state, zip,
   gmaps_rating, license_no, tagline, testimonials, gallery, gmaps_place_id,
   gbp_hero_url, gbp_photos_cache_at)
2. The per-client brand file at `shared/brand/clients/<slug>.md` (palette,
   fonts, voice, photography notes — authored by UXDesigner)
3. The agency brand at `shared/brand/vantyx.md` (non-negotiables, fallback
   palette)

If the lead has a `gmaps_place_id` and `GOOGLE_PLACES_API_KEY` is bound on
the agent env, also fetches live Google Business Profile data:
- Up to 6 Google reviews → `testimonials` (cached in SQLite)
- Up to 4 photos (1 hero + 3 gallery) resolved to stable URIs via the
  Places API media endpoint → `gbp_hero_url` + `gallery` (cached in SQLite)
- 7-day cache TTL; pass `--force-gbp-fetch` to refresh

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
  "client-slug": "acme-electric",
  "force-gbp-fetch": false,
  "skip-gbp-fetch": false,
  "brand-fallback-image": "https://vantyx.com/brand/hero-fallback.jpg"
}
```

## Outputs

```json
{
  "wrote": "/tmp/demos/acme-electric/site.config.ts",
  "bytes": 4321,
  "warnings": ["client brand file missing — used niche defaults"],
  "gbp": {
    "attempted": true,
    "cached": false,
    "skipped": null,
    "reviewsFetched": 5,
    "photosFetched": 4,
    "errors": []
  },
  "heroSource": "gbp"
}
```

## Hero fallback chain (VAN-54)

Stock photos are never acceptable. Resolution order:
1. `gbp_hero_url` cached from Places API
2. `--brand-fallback-image` arg or `VANTYX_BRAND_FALLBACK_IMAGE_URL` env
3. Hard-fail with `decision-needed` (exit 2)

## Failure modes

- `clone-path` doesn't exist → exit `decision-needed`.
- `lead-id` not found in SQLite → exit `decision-needed`.
- Hero unresolvable (no GBP photo, no brand fallback) → exit
  `decision-needed`.
- Places API HTTP failure → recorded in `gbp.errors`, falls through to
  cached/fallback. Does NOT exit non-zero on GBP failure — the demo can
  still build off cache + fallback.
- Write fails (disk, permissions) → exit `unknown-failure`.
