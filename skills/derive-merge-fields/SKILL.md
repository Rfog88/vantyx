---
schema: agentcompanies/v1
kind: skill
name: derive-merge-fields
description: Populate per-lead merge fields (probe_finding, timezone, first_name) from data already on the lead row. Honest by construction — only claims a finding the scan supports. Build #4 data layer.
metadata:
  requires_env:
    - LEADS_DB_PATH        # default /home/paperclip/vantyx-leads.sqlite
    - NODE_OPTIONS         # --experimental-sqlite on Node 22.x
  implementation: skills/derive-merge-fields/run.mjs
  primary_users: [sdr, demo-gen]
  cost_per_call_usd: 0
---

# derive-merge-fields

Writes the merge fields the outreach/drip templates consume. No network, no LLM —
derived deterministically from existing lead columns.

## What it derives
- **probe_finding** — an honest, owner-facing website-health observation. Priority:
  no-website (strongest) → broken/unreachable → no-ssl (objective, always credible) →
  looks-dated → stale-copyright → thin (visual/subjective — claimed only when the site
  ISN'T independently rated `STRONG`, to stay credible). NULL when no real finding
  exists; Day-14 then omits the finding clause. Never fabricated (spec decision #6).
- **timezone** — IANA tz from state + zip. Eastern by default; FL panhandle (zip 324/325)
  and NW-Indiana (463/464) resolve to Central. Drives the per-lead drip send window.
- **first_name** — set ONLY from a clear owner self-identification in `owner_bio`
  (e.g. "I'm Dave…"). Otherwise NULL → the templates drop the salutation to "Hey"
  rather than guess (spec decision #1).

## Usage
```
node run.mjs --lead-id <id> [--dry-run] [--json]   # one lead
node run.mjs --all [--dry-run] [--json]            # backfill / refresh every lead
```
Re-running is safe: probe_finding and timezone are recomputed each run; first_name is
only written when a confident name is found (never blanked).

## Output
```json
// single
{ "dry_run": false, "id": "...", "name": "Led Electric LLC", "first_name": null,
  "timezone": "America/New_York",
  "probe_finding": "you don't have a website that shows up when someone looks you up — they find your competitors instead" }
// --all
{ "dry_run": false, "total": 41, "with_finding": 9, "no_finding": 32, "with_first_name": 1,
  "by_tz": { "America/New_York": 41 } }
```

## When to use
- Backfill once after migration 0007 (`--all`).
- Per lead after a website-health scan (demo-gen/SDR), so its drip Day-14 / salutation
  reflect current findings before the lead enters the follow-up sequence.
