---
schema: agentcompanies/v1
kind: skill
name: lead-update
description: Update a lead row in SQLite — set stage, demo_url, or other fields. Used by demo-gen after a successful deploy.
metadata:
  requires_env:
    - LEADS_DB_PATH        # default /home/paperclip/vantyx-leads.sqlite
    - NODE_OPTIONS         # --experimental-sqlite on Node 22.x
  implementation: skills/lead-update/run.mjs
  primary_users: [demo-gen, sdr, cmo]
  cost_per_call_usd: 0
---

# lead-update

Single-row UPDATE on the `leads` SQLite table. Validates allowed columns
to prevent accidental schema changes.

## When to use

- `demo-gen` step 5 — after `vercel-deploy` returns a URL, write
  `stage='demo_built'` and `demo_url=<url>` on the lead row.
- `cmo`/`sdr` lifecycle transitions: `outreach_sent`, `replied`, `booked`,
  `won`, `lost`.

## When NOT to use

- For bulk updates (write a dedicated skill).
- For schema changes (those live in `migrations/`).

## Inputs

```json
{
  "lead-id": "<uuid>",
  "stage": "demo_built",          // optional
  "demo-url": "https://...",       // optional
  "score": 78                       // optional (rescore path)
}
```

At least one of the optional fields must be provided.

## Outputs

```json
{ "updated": true, "lead_id": "<uuid>", "fields_set": ["stage", "demo_url"] }
```

## Failure modes

- `lead-id` not found → exit `decision-needed`.
- No update fields provided → exit `decision-needed`.
- Disallowed field → exit `decision-needed` with allowed list.
