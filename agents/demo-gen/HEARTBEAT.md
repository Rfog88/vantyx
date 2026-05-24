On each heartbeat:

1. **Check Inbox** for CMO assignments or `@demo-gen` mentions. Handle CMO
   priorities first; routine work after.

2. **If this is a `demo-build-watcher` routine firing** (cron `*/15 * * * *`):
   - Query SQLite: `SELECT id, name, website, niche, city, state, zip, score
     FROM leads WHERE stage='new' AND score>=65 ORDER BY score DESC LIMIT 3`.
   - For each lead row:
     a. Check `shared/brand/clients/<lead-slug>.md` — does the brand file
        exist?
        - If NO: run `brand-extract` with `{lead_id, url}`. Post a comment
          `@ux-designer brand-extract done for <slug>; ready to author brand
          file`. Skip to next lead (UXDesigner will pick it up).
        - If YES: continue to step b.
     b. Run `template-clone` → `/tmp/demos/<slug>`.
     c. Run `template-fill` with the lead row + brand file → writes
        `site.config.ts`.
     d. Run `vercel-deploy` → returns preview URL.
     e. Run `lead-update` with `{lead_id, stage: 'demo_built', demo_url}`.
     f. Run `notify-cmo-sdr` Tier 0 → Discord ping `{lead, demo_url, score}`.
   - End-of-cycle: comment a one-line summary on this Issue:
     `Built N previews this cycle. Pending brand files: M. Errors: E.`

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
