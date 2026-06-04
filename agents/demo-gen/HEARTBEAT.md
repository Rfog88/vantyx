On each heartbeat:

1. **Check Inbox** for CMO assignments or `@demo-gen` mentions. Handle CMO
   priorities first; routine work after. You no longer own any QA-gate or
   board-approval Issues — those are gone. Demo approval happens via the
   `morning-demo-review` routine + Ryan in the Paperclip UI, not through you.

2. **If this is a `demo-build-watcher` routine firing** (cron `*/15 * * * *`):
   - Query SQLite:
     `SELECT id, name, website, niche, city, state, zip, score
      FROM leads WHERE score>=65 AND COALESCE(stage,'')='new' ORDER BY score DESC LIMIT 3`.
   - For each lead row:
     a. **Pre-pipeline stage check (VAN-394).** Re-read the live stage:
        `SELECT stage FROM leads WHERE id = ?`. If it is anything other than
        `new` (i.e. already `demo_built`/`outreach_sent`/`replied`/...), skip the
        lead and log `skip: lead <id> already at stage=<stage>`. Continue to the
        next lead.
     b. Run `prompt-fill --lead-id <id> --out /tmp/demos/<slug>/lovable-prompt.txt`.
        Exit 2 (a required field missing) → comment on the parent Issue and skip
        the lead.
     c. Build via the Lovable MCP (see AGENTS.md step 3): resolve `workspace_id`,
        `create_project` with `name=<slug>` + the filled prompt, `set_project_visibility`
        public, `deploy_project`. Confirm the published URL is `https://<slug>.lovable.app`
        (deterministic slug — if Lovable suffixed it, log + handle per AGENTS.md 3f).
        MCP auth failure → Tier 2 `api-key-missing`; credits out → Tier 1
        `external-quota-exceeded`.
     d. The branded link is `https://<slug>.usevantyx.com` (Cloudflare Worker
        proxies it to the lovable deploy). This is what you store and send.
     e. **Pre-write stage re-check (VAN-391).** Before mutating stage, query
        `SELECT stage FROM leads WHERE id = ?` again. If it is no longer `new`,
        skip `lead-update` (another run shipped it). Otherwise run
        `lead-update --lead-id <id> --demo-url https://<slug>.usevantyx.com --stage demo_built`.
     f. Run `demo-smoke-check --preview-url https://<slug>.usevantyx.com --lead-name "<name>" --phone "<phone>"`.
        - Pass (exit 0) → leave the lead at `demo_built`; it is now eligible for
          the morning review. Log `built+live: <slug> https://<slug>.usevantyx.com`.
        - Fail (exit 2/3) → comment the findings on the parent Issue; do NOT
          leave a broken link for review. (Usually means the deterministic slug
          check failed, or deploy_project hadn't propagated yet — retry once.)
   - End-of-cycle: comment a one-line summary on this Issue:
     `Built N live demos this cycle. Skipped: S. Errors: E.`

3. **If your queue is empty and no routine is firing**:
   - Scan SQLite for `stage='demo_built'` leads with `review_posted_at IS NULL`
     older than 72h (built but never surfaced in a morning review). Comment on
     the parent CMO Issue: `Backlog: <slug> built <X>h ago, not yet reviewed.`
     so CMO/Board can check why the morning digest isn't draining the backlog.
   - Otherwise stay idle. Do not invent demos.

4. **Budget self-check** before any build: if Lovable build credits are trending
   hot, pause and escalate Tier 1 `external-quota-exceeded`.

If your heartbeat itself errors (DB connection, Lovable MCP down, etc.): run
`diagnose-why-work-stopped` first; comment the diagnosis; do not retry the same
failure in a loop. Comment `@cmo blocked: <reason>` and stop.
