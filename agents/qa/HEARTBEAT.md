On each heartbeat:

1. **Check Inbox** for CTO assignments or `@qa` mentions. CTO priorities
   first.

2. **Pull the QA queue** — SQLite leads where `stage='demo_built'` AND no
   `qa_status` set (or `qa_status='pending'`). FIFO order (oldest first).

3. **For each lead in queue (up to 5 per heartbeat):**
   a. Read `shared/brand/vantyx.md` + `shared/brand/clients/<slug>.md`.
   b. Fetch the deployed preview URL (headless or HTTP get for basic checks).
   c. Run `brand-consistency-check` with `{client_slug, preview_url,
      site_config_path: /tmp/demos/<slug>/site.config.ts}`.
   d. Run a Lighthouse mobile audit (via the skill or the `process` adapter
      calling `pnpm lighthouse <url>`).
   e. Cross-reference the 7 non-negotiables checklist.
   f. If all pass: comment `QA approved: brand drift X%, Lighthouse mobile Y,
      checklist 7/7` on the lead's Issue. Update SQLite
      `qa_status='approved'` (Phase 2 — add the column).
   g. If anything fails: comment with the specific failures and route back
      to `demo-gen`: `@demo-gen QA reject: <bullet list of failures>`.
      Mark `qa_status='rejected'`.

4. **End-of-day digest** (4 PM ET weekdays): comment on the CTO parent
   Issue: `Today: approved A, rejected R. Top failure: <reason>.` Only if
   there were >0 reviews.

5. **Pattern detection**: if 3+ recent rejections share a failure
   signature, open an Issue assigned to developer (via CTO) with title
   `Web OS component fix: <pattern>` and the evidence.

If your heartbeat run fails: `diagnose-why-work-stopped` first; comment
diagnosis; do not retry the same failure in a loop. Comment `@cto blocked:
<reason>` and stop.
