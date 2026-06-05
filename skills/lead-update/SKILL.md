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
  "score": 78,                      // optional (rescore path)
  "review-posted": true,            // optional flag — stamp review_posted_at = now
  "board-approved": true,           // optional flag — stamp board_approved_at = now
  "reply-status": "positive",       // optional — reply classification (build #2)
  "replied": true                   // optional flag — stamp replied_at = now
}
```

At least one of the optional fields/flags must be provided.

- `--review-posted` — set by the `morning-demo-review` routine when a demo is
  posted to Discord for Board review (so it isn't reposted next morning).
- `--board-approved` — set by the SDR when Ryan approves the demo and outreach
  fires (usually together with `--stage outreach_sent`).
- `--reply-status` — set by the SDR reply loop from `classify-outreach-reply`.
  One of: `positive | negative | changes | ambiguous | unsubscribed | bounced |
  soft_bounce | complaint | auto_reply`.
- `--replied` — stamp `replied_at = now` when an inbound reply/bounce is processed.

Stages accepted: `new, demo_built, outreach_sent, replied, qualifying,
closed_no_interest, closed_unsubscribed, booked, won, lost`. The terminal-stage
guard refuses to downgrade an already-shipped/closed lead back to `demo_built`/`new`.

## Outputs

```json
{ "updated": true, "lead_id": "<uuid>", "fields_set": ["stage", "demo_url"] }
```

## Failure modes

- `lead-id` not found → exit `decision-needed`.
- No update fields provided → exit `decision-needed`.
- Disallowed field → exit `decision-needed` with allowed list.
