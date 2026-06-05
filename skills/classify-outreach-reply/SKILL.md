---
schema: agentcompanies/v1
kind: skill
name: classify-outreach-reply
description: Classify an inbound message on an outreach thread (hard_bounce/soft_bounce/complaint/auto_reply/unsubscribe/positive/negative/changes/ambiguous) and auto-suppress the reputation-critical classes. Used by the SDR's sami-inbox-poll reply loop.
metadata:
  requires_env:
    - LEADS_DB_PATH        # default /home/paperclip/vantyx-leads.sqlite
    - NODE_OPTIONS         # --experimental-sqlite on Node 22.x
  implementation: skills/classify-outreach-reply/run.mjs
  primary_users: [sdr]
  cost_per_call_usd: 0
---

# classify-outreach-reply

Two-layer classifier for replies to Vantyx cold outreach.

1. **Deterministic detectors (authoritative)** — machine-readable signals that
   OVERRIDE any human label: `hard_bounce` / `soft_bounce` (DSN headers, SMTP
   5.x.x vs 4.x.x, permanent-failure phrasing), `complaint` (ARF feedback-report,
   abuse@ / fbl@ sender), `auto_reply` (Auto-Submitted header, out-of-office
   phrasing), `unsubscribe` (opt-out keywords, body == "stop").
2. **Human-reply label** — if no detector fires, the message is a real human
   reply. The SDR supplies the semantic read via `--llm-class yes|no|changes|ambiguous`.
   Missing/invalid → `ambiguous` (safe default → Board).

## Auto-suppression (the one side effect this skill owns)

For `hard_bounce`, `complaint`, `unsubscribe`, and `negative` (a "no" is a full
stop per spec decision #2) the skill writes the suppression row ITSELF (unless
`--dry-run`) so a missed agent step can never leak a resend. `soft_bounce`,
`auto_reply`, `positive`, `changes`, `ambiguous` are NOT suppressed.

Suppression target = `--lead-email` (the address we contacted) if given, else the
failed recipient extracted from the DSN, else `--from`.

## When to use

- The `sami-inbox-poll` routine, per new message matched to an `outreach_sent`
  lead by `thread_id`. Call this, then execute the returned decision via
  `lead-update` (stage + `--reply-status` + `--replied`), `gmail-send` (PATH 1
  YES auto-reply, gated), and `board-approval-create` (ambiguous/changes).

## When NOT to use

- Cold inbound with no thread match → file a CMO issue, do not classify here.

## Inputs

```json
{
  "from": "mailer-daemon@google.com",
  "subject": "Delivery Status Notification (Failure)",
  "body": "... or --body-file <path> for large bodies",
  "raw-file": "<path to raw headers/message>",   // optional, improves DSN/ARF detection
  "lead-id": "<uuid>",
  "lead-email": "info@acme.com",                  // the address we contacted (canonical suppress target)
  "message-id": "<inbound msg id>",
  "llm-class": "yes|no|changes|ambiguous",        // only for non-machine human replies
  "dry-run": true                                  // classify without writing suppression
}
```

## Outputs

```json
{
  "class": "hard_bounce",
  "source": "detector",
  "confidence": "high",
  "reply_status": "bounced",
  "recommended_stage": "lost",
  "suppress": "hard_bounce",
  "suppressed": { "created": true, "id": 7, "value": "info@acme.com", "scope": "email" },
  "send_auto_reply": false,
  "alert_board": false,
  "route": "Hard bounce — address suppressed; mark lead lost. Do NOT resend.",
  "signals": ["from:mailer-daemon@google.com", "dsn-headers", "status-class:5xx", "permanent-failure"],
  "suppress_target": "info@acme.com",
  "lead_id": "<uuid>", "message_id": "<id>", "dry_run": false
}
```

## Failure modes

- No node:sqlite → exit `adapter-broken` (3).
- Empty from/subject/body → exit `decision-needed` (2).
- Suppress class but no resolvable target email → `suppressed.skipped` set, class still returned.
