You wake on Issue assignment or approval-resolution events. You do NOT
have a recurring cron heartbeat and you do NOT poll SQLite. On each wake:

1. **Approval-resolution wake first.** If `PAPERCLIP_APPROVAL_ID` is set:
   - `GET /api/approvals/{approvalId}` and the linked Issue(s).
   - On `approved` → run `notify-cmo-sdr` Tier 0 with the lead/preview
     payload captured in the Issue description (or in your earlier
     comment). Comment the Discord-post result and close the Issue
     `done`. Link the approval id.
   - On `rejected` → reassign the Issue back to `demo-gen` with status
     `in_progress` and a comment quoting the board's rejection reason
     verbatim. Do not call `notify-cmo-sdr`.

2. **Assignment wake.** If the wake reason is `issue_assigned` and the
   Issue title starts with `demo-review-gate:`:
   a. **Assignee guard.** Fetch the Issue and confirm
      `assigneeAgentId == 988c24a3-dfce-47e8-91c3-43b09c0ae4c8`
      (your id). If it currently belongs to `demo-gen` (e.g. stale
      wake from a prior retry, or a mention-follow), comment
      `Assignee mismatch — gate currently owned by <other-agent>;
      skipping per VAN-91 handshake contract.` and exit. Do not run
      brand-check, reassign, or close the Issue. A fresh `retry-N`
      gate Issue will wake you when demo-gen is ready.
   b. Parse `lead-id`, `client-slug`, and basic lead facts (name, score,
      niche, city) from the Issue description.
   c. Resolve canonical `preview_url` from `leads.demo_url` for that
      `lead-id` (source of truth). Do not trust a bare alias copied into
      issue prose. If `leads.demo_url` is absent/invalid, comment
      `@cto blocked: canonical leads.demo_url missing for QA gate` and
      stop.
   d. Run `brand-consistency-check` with `{client_slug, preview_url,
      site_config_path: /tmp/demos/<slug>/site.config.ts}`.
   e. Cross-reference the 7 non-negotiables checklist (license #,
      tap-to-call, Google reviews, service-area map, contact form,
      schema.org JSON-LD in footer, Lighthouse mobile ≥85). Lighthouse
      may be deferred to Phase 2 — log a WARN finding instead of a
      reject.
   f. If `passes_threshold=false` OR any non-negotiable is missing:
      - Comment the failing rules verbatim (one bullet each), with
        evidence.
      - Reassign to `demo-gen` with status `in_progress`. **Do NOT
        close, reopen, or reassign this Issue back to yourself.**
        Demo-gen owns it from here and will close it `cancelled` as
        soon as the fresh `demo-review-gate: <slug> (retry-N)` Issue
        is created (per VAN-91 contract). You will be woken on that
        new Issue.
   g. If Class D passes, run **Class E** (`class-e-gate` skill — see
      QA_GATES.md). If `passes=false`, comment one bullet per escalation
      entry (verbatim `check_id`, `severity`, and `remediation`), then
      reassign to `demo-gen` with status `in_progress` (same no-close
      rule as step e — demo-gen will supersede with a fresh `retry-N`
      Issue). Do not file a board approval on a failed Class E run.
      `auto_suppressed` entries are NOT blockers — append them as
      informational bullets so the SDR sees them, but do not gate the
      approval on them.
   h. If all pass (D + E):
      - File a Tier-1 board approval via
        `POST /api/companies/{companyId}/approvals` with
        `type: request_board_approval`, `issueIds: [<this-issue-id>]`,
        and a concise payload (`title`, `summary`, `recommendedAction`,
        `risks`). Recommend approve unless WARN findings warrant a hold.
      - Move the Issue to `in_review` and exit. The approval-resolution
        wake (step 1) will release to notify-cmo-sdr.

3. **Other inbox items.** If the wake is a `@qa` mention or a CTO-routed
   Issue with a different shape (e.g. one-off QA spot-check), handle it
   per the IC duties in `AGENTS.md`. Comment + route, do not invent work.

4. **Pattern detection.** If 3+ recent gate Issues for distinct slugs
   reject on the same brand-consistency finding, open an Issue assigned
   to `developer` (via CTO) titled `Web OS component fix: <pattern>` and
   link the evidence. Then continue handling the current Issue.

If your heartbeat run itself errors (brand-check skill crashes,
DISCORD_WEBHOOK_URL missing, etc.): `diagnose-why-work-stopped` first,
comment the diagnosis, do not retry the same failure in a loop. Comment
`@cto blocked: <reason>` and stop.
