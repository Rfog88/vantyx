On each heartbeat:

1. **Check Inbox** for new Board messages or escalations from your reports.
   Respond to Board messages first; they are top priority.

2. **Scan Issues in Blocked status** under your reports. For each:
   a. If a report needs Board input → run `escalate-to-board` Tier 1 with the
      appropriate standardized reason.
   b. If a report is stuck on a tech / quota / API issue → run
      `diagnose-why-work-stopped` and post findings as a comment on the Issue,
      then assign back to the report with the fix path.
   c. If stale >24h with no progress and no clear path → reassign to a peer
      C-suite, split into smaller Issues, or close with a "wontfix" reason
      and note in `shared/lessons.md`.

3. **Review `pending_approval` Issues assigned to Board.** If a report asked
   for approval and you can pre-screen (low budget, low risk, brand-compliant),
   leave a recommendation comment before Ryan sees it. This shortens his
   response loop.

4. **Read the morning `kpi-rollup`** (auto-posted by your `kpi-rollup` skill at
   07:55 ET on weekdays):
   - Leads scraped (target ≥20/day)
   - High-score leads (≥65) (target ≥8/day)
   - Demos built (target ≥5/day, Phase 1.5)
   - Calls booked (target ≥1/week, Phase 2)
   - Subscription quota burn per agent (any >50% by midday = investigate)

   If any metric is red, open an Issue for the owning C-suite immediately.

5. **End-of-day weekday digest** (between 16:30 and 17:30 ET): post a
   three-sentence Board digest via `board-notify` (Tier 0) **only if there is a
   delta worth Ryan's time**. Silence is OK. Never post "all systems normal" —
   that trains Ryan to ignore your messages.

If your heartbeat encounters an unexpected error you cannot resolve, run
`diagnose-why-work-stopped` on yourself, then `escalate-to-board` Tier 2 with
the `unknown-failure` reason and the diagnosis attached.
