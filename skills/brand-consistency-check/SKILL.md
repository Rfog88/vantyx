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

`preview_url` must be the canonical deployment URL from `leads.demo_url`
(the gate issue `preview-url:` value), typically the hash URL like
`preview-<slug>-<hash>-<scope>.vercel.app`. Bare aliases like
`preview-<slug>.vercel.app` are rejected.

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
  "preview_url": "https://preview-acme-electric-abcd1234.vercel.app/",
  "drift_score": 8,
  "palette_drift": 4,
  "checklist_passed": "7/7",
  "passes_threshold": true,
  "subIssueChecks": {
    "slots_present":        { "passed": true,  "evidence": "data-placeholder-slot count = 3; data-trust-slot count = 5" },
    "geo_city_consistency": { "passed": true,  "evidence": "JSON-LD geo.latitude=27.9506 resolves to Tampa FL (0.1 mi); address.addressLocality=Tampa" },
    "no_unsplash":          { "passed": true,  "evidence": "0 unsplash.com refs in rendered HTML" },
    "brand_chrome_present": { "passed": true,  "evidence": "sticky nav present; footer badge block present; trust strip 5-item" },
    "payload_fidelity":     { "passed": true,  "evidence": "phone, license_no, city all agree with rendered HTML" },
    "license_render":       {
      "passed": true,
      "case": "placeholder_lead",
      "evidence": "placeholder_lead: license slot rendered correctly; no raw placeholders.",
      "license_no_raw_placeholder": { "passed": true, "evidence": "no raw x{4,}/0{4,} substrings in rendered HTML" },
      "license_field_render":       { "passed": true, "case": "placeholder_lead", "evidence": "placeholder_lead: \"License verification pending\" + data-placeholder-slot=\"license\" + aria-label=\"License pending — concept demo\" all present." }
    }
  },
  "subIssueFailures": [],
  "findings": [
    "OK: license # in hero",
    "OK: tap-to-call header",
    "WARN: accent color is #F59E0B but client palette is #E11D48 (delta=12%)",
    "OK: Lighthouse mobile 87"
  ]
}
```

### `subIssueChecks` contract (consumer rules for demo-gen)

VAN-124 surfaces per-sub-issue family pass/fail alongside the aggregate
`drift_score`. Demo-gen MUST use this block — not just `drift_score` — when
composing REJECT reasons so Cipher can route the right reconciliation issue.

| Family | What it greps in deployed HTML |
|---|---|
| `slots_present`        | `data-placeholder-slot` + `data-trust-slot` count > 0 (mirrors Class E `slots_absent` pre-check). |
| `geo_city_consistency` | LocalBusiness JSON-LD `geo.latitude`/`geo.longitude` reverse-geocodes to a locality that matches `address.addressLocality`, and must remain coherent with Class E ZIP-centroid checks (notably Tampa ZIP set including `33635`). |
| `no_unsplash`          | Zero `images.unsplash.com` / `source.unsplash.com` / `plus.unsplash.com` refs in user-visible HTML. Detects both plain and `_next/image?url=...`-encoded forms. |
| `brand_chrome_present` | Sticky `<header>`/`<nav>` + `<footer>` badge block + ≥3-item trust strip. |
| `payload_fidelity`     | site.config.ts `contact.phone`, `business.licenseNumber`, `contact.address.city`, and any `gallery[].src` URLs appear in rendered HTML. Placeholder license_no (`xxxxxxxx`) is skipped here — see `license_render` for the labeled-pending check. |
| `license_render`       | VAN-131 / Board policy 06e8edd9. Two assertions: (a) `license_no_raw_placeholder` — no `x{4,}` or `0{4,}` substring anywhere in rendered HTML; (b) `license_field_render` — placeholder leads render literal `License verification pending` + `data-placeholder-slot="license"` + concept-demo aria-label; verified leads render the real value and must NOT contain the pending label. Per-case pass/fail (`placeholder_lead` / `verified_lead`) surfaced alongside the family's `passed` boolean for mechanical VAN-96 sub-issue closure. Supersedes the prior VAN-66 auto-suppression path. |

Each entry shape:
```json
{ "passed": true|false, "evidence": "human-readable string" }
```

`passes_threshold` is `true` only when `drift_score ≤ 15` AND every
`subIssueChecks` entry is `passed: true`. Any red family also lands in the
flat `subIssueFailures` array (`[{ family, evidence }]`) and is appended to
`findings` at `level: "fail"` so demo-gen's REJECT comment can name the
specific family that regressed instead of a generic drift score.

When the preview is unreachable (HTTP error, timeout), every family is
emitted as `{ passed: false, evidence: "preview unreachable: <reason>" }`
and `passes_threshold` is `false`.

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
