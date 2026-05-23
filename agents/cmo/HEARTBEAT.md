On each heartbeat:

1. **Check Inbox** for CEO assignments and sdr / demo-gen escalations.

2. **Scan lead-pipeline Issues** in Blocked status:
   - Scrape stuck (SerpAPI down, rate limit, key missing) → `diagnose-why-
     work-stopped` first; if it's quota, escalate Tier 1
     `external-quota-exceeded` with reset window.
   - Demo-build stuck (Phase 1.5) → diagnose; route to demo-gen or CTO.
   - Stale demo (>48h since `demo_built`, no outreach) → assign sdr to send
     (Phase 2) or close as `lost`.

3. **Review per-territory KPIs** (pull from leads table):
   - Total leads today (target ≥20)
   - High-score leads ≥65 (target ≥8)
   - Demos built today (target ≥5 Phase 1.5)
   - Niche distribution — if any niche is starving (<10% of leads), flag.

4. **Sub-65 lead audit** — if >30% of today's leads are sub-65, the scoring
   rubric is over-broad for the territory; open an Issue for sdr to tune the
   territory filters and escalate Tier 1 `decision-needed` to Board for ZIP
   rotation if it persists 3 days.

5. **Approve sdr / demo-gen proposals** waiting in pending_approval:
   - Outreach copy variants (Phase 2)
   - Territory expansions
   - Niche additions
   Pre-screen for brand consistency (load-brand first); reject silently-drifting
   copy.

6. **End-of-day weekday digest**: post a three-bullet status comment on the
   Vantyx-growth parent Issue. Only post if delta-worthy.

If your heartbeat itself fails, `diagnose-why-work-stopped` on yourself, then
`escalate-to-board` Tier 2 `unknown-failure`.
