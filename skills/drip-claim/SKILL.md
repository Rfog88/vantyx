---
schema: agentcompanies/v1
kind: skill
name: drip-claim
description: PATH 2 / PATH 4 follow-up engine. Selects leads due for their next drip (Day 3/7/14) or nurture (~90d, max 2) step, applies every safety guard, atomically claims the step, and returns the exact on-thread email to send. Does NOT send.
metadata:
  requires_env:
    - LEADS_DB_PATH            # default /home/paperclip/vantyx-leads.sqlite
    - NODE_OPTIONS             # --experimental-sqlite on Node 22.x
    - DRIP_POSTAL_ADDRESS      # REQUIRED to claim — physical address for the CAN-SPAM footer
    - DRIP_DAILY_CAP           # default 15 (combined cold + drip + nurture)
    - DRIP_SAMI_PHONE          # optional footer phone
    - DRIP_UNSUBSCRIBE_LINK    # optional; else footer uses "reply stop" only
    - DRIP_PROOF_URL           # default https://fogleandsons.com (electrician proof)
    - DRIP_TIMEZONE            # default America/New_York (global until per-lead tz, build #4)
    - DRIP_WINDOW              # default "7-12" local hours
  implementation: skills/drip-claim/run.mjs
  primary_users: [sdr]
  cost_per_call_usd: 0
---

# drip-claim

The deterministic safety + scheduling layer for follow-ups. The SDR (Sami) only
transports what this returns.

## Cadence (clocked off `outreach_sent_at`)
- **Day 3** soft nudge · **Day 7** proof (`DRIP_PROOF_URL`) · **Day 14** objection
  (probe_finding clause omitted until build #4 adds it). Then **nurture** every ~90
  days, max 2. Lifetime ceiling = 1 cold + 3 drip + 2 nurture = 6.

## Guards (a claim passes ALL)
- Eligible: `stage='outreach_sent'` AND `reply_status IN (NULL,'soft_bounce')` — any
  real reply, suppression, or stage change drops the lead from the drip.
- Has `outreach_thread_id` + `outreach_message_id` (to reply "Re:" on the thread).
- Not on the suppression list (email or domain).
- Inside the recipient-local send window (Mon–Fri morning; no Fri PM / weekends).
- Under the combined daily cap.
- **Compliance:** refuses to claim anything unless `DRIP_POSTAL_ADDRESS` is set.

## Atomic claim
`INSERT OR IGNORE` a unique `drip:<lead>:<step>` row into `sent_email_dedup` (PK
conflict ⇒ already claimed ⇒ skip) + a guarded `drip_step`/`nurture_count` advance.
Claim happens BEFORE the send; a crash after claim under-sends (spec-preferred).

## Usage
```
node run.mjs [--limit N] [--now ISO] [--dry-run] [--ignore-window] [--json]
```
`--now`/`--ignore-window` are for testing. `--dry-run` renders without claiming.

## Output
```json
{ "now":"...", "tz":"America/New_York", "window_ok":true, "cap":15, "sent_today":0,
  "remaining_after":13, "postal_ok":true, "dry_run":false, "count":2,
  "claimed":[ { "leadId":"...", "step":"day3", "kind":"drip", "to":"info@acme.com",
    "threadId":"...", "inReplyTo":"<msgid>", "subject":"Re: ...", "body":"...", "dedupKey":"drip:...:day3" } ],
  "skipped": { "not_due":7, "suppressed":1, "no_thread":1, "cap_reached":0, "race":0 } }
```
`blocked` is set (`compliance` | `send-window`) instead of `claimed` when a global gate stops the run.

## Caller contract (SDR)
For each `claimed` item: send via `gmail-send` from `sami@usevantyx.com` as a reply on
`threadId` (`In-Reply-To: inReplyTo`), body verbatim (do NOT rewrite — copy + footer are
compliance-checked). The step is already claimed/advanced; a failed send just under-sends.
**Gated:** only runs when the `drip-schedule` routine trigger is enabled (warm-up, build #5).
