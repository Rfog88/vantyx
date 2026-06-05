---
schema: agentcompanies/v1
kind: skill
name: suppression-add
description: Add an email address or whole domain to the durable do-not-contact (suppression) list. Idempotent. Used by classify-outreach-reply and for manual board-directed suppressions.
metadata:
  requires_env:
    - LEADS_DB_PATH        # default /home/paperclip/vantyx-leads.sqlite
    - NODE_OPTIONS         # --experimental-sqlite on Node 22.x
  implementation: skills/suppression-add/run.mjs
  primary_users: [sdr, cmo]
  cost_per_call_usd: 0
---

# suppression-add

Write to the `suppressions` table (the reputation-critical do-not-contact list).
Idempotent: re-adding the same (value, scope) keeps the original reason and bumps
`updated_at`.

## When to use

- Manually, when the Board says "never contact X again".
- `classify-outreach-reply` writes suppressions itself for hard_bounce / complaint
  / unsubscribe / no-interest, so you usually don't call this in the reply loop.

## Inputs

```json
{ "email": "info@acme.com", "reason": "unsubscribe", "lead-id": "<uuid>", "message-id": "<id>", "notes": "..." }
{ "domain": "acme.com",     "reason": "complaint",   "notes": "domain-wide block" }
```

Reasons: `unsubscribe | hard_bounce | complaint | no_interest | manual`.
Exactly one of `--email` / `--domain` required.

## Outputs

```json
{ "suppressed": true, "ok": true, "created": true, "id": 12, "value": "info@acme.com", "scope": "email", "reason": "unsubscribe" }
```

## Failure modes

- Missing/invalid `--reason` → `decision-needed` (2) with allowed list.
- Neither `--email` nor `--domain` → `decision-needed` (2).
- Malformed email → `decision-needed` (2).
