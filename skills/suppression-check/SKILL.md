---
schema: agentcompanies/v1
kind: skill
name: suppression-check
description: Read-only check of whether an email (or its domain) is on the do-not-contact list. The GLOBAL pre-send gate — call before every cold/drip/auto-reply send.
metadata:
  requires_env:
    - LEADS_DB_PATH        # default /home/paperclip/vantyx-leads.sqlite
    - NODE_OPTIONS         # --experimental-sqlite on Node 22.x
  implementation: skills/suppression-check/run.mjs
  primary_users: [sdr]
  cost_per_call_usd: 0
---

# suppression-check

Returns whether an address is suppressed — by exact email OR by a domain-scope
block. The send path (`pending-approved-outreach`) already calls the same query
inline; use this skill for ad-hoc checks or shell gating.

## When to use

- Before sending ANY email to a prospect (GLOBAL RULE). The send routine enforces
  this automatically; call it directly when composing a one-off.

## Inputs

```json
{ "email": "info@acme.com", "quiet": false }
```

`--quiet` suppresses stdout and exits 10 if suppressed, 0 if clear (for `&&` gating).

## Outputs

```json
{ "suppressed": true, "email": "info@acme.com", "matched_scope": "email", "matched_value": "info@acme.com", "reason": "unsubscribe", "since": "2026-06-04 23:50:00" }
{ "suppressed": false, "email": "fresh@lead.com" }
```

## Failure modes

- Invalid/missing `--email` → `decision-needed` (2).
- No node:sqlite → `adapter-broken` (3).
