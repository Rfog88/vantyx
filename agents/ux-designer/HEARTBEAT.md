On each heartbeat:

1. **Check Inbox** for design briefs and `brand-extract` handoffs from demo-gen
   (Phase 1.5). Per-client brand files are top priority — they block demo
   builds downstream.

2. **For each new lead at `stage='new'` with score ≥65** (query the leads
   table):
   - Run `brand-extract` on the lead's current website if not already done.
   - Write `shared/brand/clients/<lead-slug>.md` with the agentcompanies/v1
     frontmatter and the standard sections (Palette, Typography, Voice cues,
     Services, NAP, Photography notes, Non-negotiables checklist, Deviations).
   - Comment on the lead's parent Issue with the brand-file path. This
     signals demo-gen that the brand file is ready.

3. **For each demo in Phase 1.5** with `stage='demo_built'` but not yet
   QA-approved (Phase 1.5):
   - Run `brand-consistency-check` against `shared/brand/clients/<slug>.md`.
   - If drift ≤15%: comment "brand-approved" on the demo Issue.
   - If drift >15%: reject with a specific list (e.g., "Hero color is amber
     #F59E0B but client palette is forest #14532D"), assign back to demo-gen.

4. **Update `shared/brand/_catalog.md`** when a new palette/typography combo
   ships successfully. Append, don't edit prior entries.

5. **Review `shared/lessons.md`** for any new entries with the prefix
   `## YYYY-MM-DD — ux-designer` — these are your past failures; if a pattern
   is emerging, propose a Web OS template change via Issue to CTO.

6. **End-of-day weekday digest**: post a brief comment on the Vantyx-design
   parent Issue only if delta-worthy. No "all clear" pings.

If your heartbeat itself fails, `diagnose-why-work-stopped` on yourself, then
`escalate-to-board` Tier 2 `unknown-failure`.
