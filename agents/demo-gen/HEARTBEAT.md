On each heartbeat:

1. **Check Inbox** for CMO assignments or `@demo-gen` mentions. Handle CMO
   priorities first; routine work after.

2. **If this is a `demo-build-watcher` routine firing** (cron `*/15 * * * *`):
   - Query SQLite: `SELECT id, name, website, niche, city, state, zip, score
     FROM leads WHERE stage='new' AND score>=65 ORDER BY score DESC LIMIT 3`.
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
     f. Run `lead-update` with `{lead_id, stage: 'demo_built', demo_url}`.
     g. **Hand off to Quinn (QA).** Create a child Issue
        `demo-review-gate: <slug>` under your current watcher Issue,
        assigned to `988c24a3-dfce-47e8-91c3-43b09c0ae4c8`, status `todo`,
        priority `high`. Include the lead facts, `preview_url`, and
        `site_config_path` and all three `{top_change_*}` notes in the
        description (see AGENTS.md template).
        Do NOT call `notify-cmo-sdr` — that is Quinn's job after Tier-1
        board approval. If Quinn rejects, she reassigns the gate Issue
        back to you; iterate then create a fresh gate Issue.
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
