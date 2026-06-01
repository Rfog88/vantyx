On each heartbeat:

0. **Live-approval re-check (before any block/unblock decision).**
   After checkout, if the issue body contains a `## Board escalation
   status` section (or any escalation/approval section) citing a Tier-1
   approval UUID, you MUST:
   - `GET /api/approvals/{id}` for each cited UUID and branch on the
     returned `status` + `decisionNote`, NOT on description prose.
   - If `status` is `approved` or `rejected`, immediately
     `PATCH /api/issues/{issueId}` to rewrite the `## Board escalation
     status` section in the description to reflect the decided state
     (format in AGENTS.md "Approval-state is LIVE, not prose"). This
     is the sweep that prevents the loop from coming back.
   - If `status` is `approved`, do NOT post a "remains blocked on
     approval … (pending)" comment, do NOT re-set the issue to
     `blocked`. Proceed with the normal pipeline using the
     `decisionNote` as the binding policy.
   - If `status` is `pending`, the blocker is real — leave the issue
     blocked and continue with other work this cycle.

   This step exists because of the 2026-05-26 VAN-129 regression on
   [VAN-120](/VAN/issues/VAN-120). See AGENTS.md for the full rule.

1. **Check Inbox** for CMO assignments or `@demo-gen` mentions. Handle CMO
   priorities first; routine work after.
   - **Post-ship gate guard (VAN-195.1):** if a `demo-review-gate` Issue
     appears in your inbox but the description marker `approval-state` is `approved` (or the
     Issue is already `done`/`cancelled` with a notify completion comment),
     do not run rejection retry flow and do not create `retry-N`. Comment
     `Post-ship guard: notify-cmo-sdr already completed for <slug>; no retry created.`
     and leave/mark the Issue `done`.
   - **DB-stage guard (VAN-391):** for any `demo-review-gate` Issue that
     reaches the rejection retry path, extract the `lead-id` from the Issue
     description and query the DB: `SELECT stage FROM leads WHERE id = ?`.
     If `stage = 'outreach_sent'`, abort the retry entirely — do NOT
     re-render, do NOT call `lead-update`, do NOT create a new gate Issue.
     Comment `outreach_sent guard: lead <lead-id> already shipped (<outreach_sent_at>); retry suppressed.`
     and mark the Issue `done`. This catches the cross-day case where an
     older rejected gate is still in the inbox after a later retry shipped.

2. **If this is a `demo-build-watcher` routine firing** (cron `*/15 * * * *`):
   - Query SQLite: `SELECT id, name, website, niche, city, state, zip, score
     FROM leads WHERE score>=65 AND COALESCE(stage,'')='new' AND COALESCE(stage,'') <> 'outreach_sent' ORDER BY score DESC LIMIT 3`.
   - For each lead row:
     a. Invoke the `load-brand` skill to run the brand-consistency gate.
        Concretely:
        `node /home/paperclip/.paperclip/instances/default/skills/a59f9f5f-a472-4612-909b-c20d07099cd9/__catalog__/load-brand--a0b0e127e0/run.mjs --client-slug <lead-slug>`.
        Capture stdout (merged brand text) and stderr (JSON error envelope on
        non-zero exit). Do NOT do direct `shared/brand/...` filesystem reads —
        those resolve workspace-relative and will false-block.
        - Exit 0 + stdout contains both `# Vantyx Brand` and
          `# Client Brand: <slug>` → continue to step b, passing the captured
          stdout downstream to `template-fill`.
        - Exit 0 but stdout begins with
          `<!-- _warning: client_brand_missing slug=<slug> -->` → client
          overlay missing only. Run `brand-extract` with `{lead_id, url}`,
          post `@ux-designer brand-extract done for <slug>; ready to author
          brand file`, skip to next lead.
        - Exit 3 (`agency_brand_missing`) → escalate Tier 1 `adapter-broken`
          to Board (agency brand should never be missing).
        - Any other non-zero exit → comment
          `@cto load-brand failed for <slug>: <stderr>` and skip lead.
     b. Run `template-clone` → `/tmp/demos/<slug>`.
     c. Run `template-fill` with the lead row + the brand stdout captured in
        step a (do NOT re-read brand files) → writes `site.config.ts`.
     d. Run `vercel-deploy` → returns preview URL.
     e. Produce and capture `{top_change_*}` preview notes for this lead:
        `top_change_load_time`, `top_change_header_cta`,
        `top_change_stock_photo` (1-2 sentences each, lead-specific).
     f. **Pre-flight stage check (VAN-391):** before mutating stage, query
        `SELECT stage FROM leads WHERE id = ?`. If `stage = 'outreach_sent'`,
        skip this lead entirely — do NOT call `lead-update`, do NOT create a
        gate. Log `skip: lead <lead-id> already at outreach_sent; no stage reset, no gate created.`
        and continue to the next lead.
        Otherwise: Run `lead-update` with `{lead_id, stage: 'demo_built', demo_url}`.
     g. **Hand off to Quinn (QA).** Create a child Issue
        `demo-review-gate: <slug>` under your current watcher Issue,
        assigned to `988c24a3-dfce-47e8-91c3-43b09c0ae4c8`, status `todo`,
        priority `high`. Include the lead facts, `preview_url`, and
        `site_config_path` and all three `{top_change_*}` notes in the
        description (see AGENTS.md template).
        Before POST, run a required-field check on the composed markdown and
        hard-fail if any required value is blank:
        `lead-id`, `lead-name`, `client-slug`, `preview-url`,
        `site-config-path`, `score`, `niche`, `city`,
        `top_change_load_time`, `top_change_header_cta`,
        `top_change_stock_photo`.
        On any blank field: do not create the gate, comment
        `gate-create aborted: missing required field(s): <csv>; no QA gate posted.`,
        and move to `blocked` with the named unblock owner/action.
        Do NOT call `notify-cmo-sdr` — that is Quinn's job after Tier-1
        board approval. **On a Quinn reject (gate Issue back with
        status `in_progress` and marker `approval-state` == `rejected`)**:
        fix the template/data, create a NEW
        gate Issue titled `demo-review-gate: <slug> (retry-N)` assigned
        to Quinn with the same payload + `Supersedes: <rejected-id>`,
        then close the rejected Issue `cancelled` with comment
        `superseded by <new-id>`. Do NOT iterate in-place on the
        rejected Issue and do NOT reassign it back to Quinn — a fresh
        Issue per attempt is the handshake. See AGENTS.md step 9 for
        the full retry contract.
   - End-of-cycle: comment a one-line summary on this Issue:
     `Built N previews this cycle (handed N gates to Quinn). Pending brand files: M. Errors: E.`

3. **If your queue is empty and no routine is firing**:
   - Scan SQLite for `stage='demo_built'` leads older than 48h with no
     `outreach_sent` follow-up. Comment on the parent CMO Issue:
     `Stale preview: <slug> built <X>h ago, no outreach.`
   - Otherwise stay idle. Do not invent demos.

4. **Budget self-check** before any deploy: if Vercel's plan limits are
   trending hot (use the `vercel-deploy` skill's quota-check response), pause
   and escalate Tier 1 `external-quota-exceeded`.

If your heartbeat itself errors (DB connection, vercel CLI broken, etc.):
`diagnose-why-work-stopped` first; comment the diagnosis; do not retry the
same failure in a loop. Comment `@cmo blocked: <reason>` and stop.
