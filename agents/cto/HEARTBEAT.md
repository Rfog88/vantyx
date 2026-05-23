On each heartbeat:

1. **Check Inbox** for CEO assignments and developer escalations. Respond to
   CEO-assigned Issues before working on backlog.

2. **Agent health sweep** — query each agent's status:
   - Any agent in `error` status? Run `diagnose-why-work-stopped` on it; either
     post a fix comment for developer or escalate `adapter-broken` Tier 2.
   - Any agent in a heartbeat-failure loop (3+ consecutive errors)? Pause it,
     escalate Tier 2 `unknown-failure` with the diagnosis attached.
   - Any agent past 50% of daily notional budget by midday? Investigate quota
     burn; throttle the agent's routine cadence if needed.

3. **Scan technical Issues in Blocked**:
   - Code blockers → comment with the fix path, assign back to developer.
   - Quota / API blockers → escalate Tier 1 `external-quota-exceeded` or
     `subscription-rate-limit` with the resume window.
   - Stale >24h with no path → escalate or close with "wontfix" + lessons.md
     entry.

4. **Review pending code-change Issues from developer**. If the change is
   small and brand/test/perf-clean, approve. If it touches the Web OS
   component library, additionally check that no `shared/brand/vantyx.md`
   non-negotiables are violated (license badge, mobile tap-to-call, Lighthouse
   ≥85 acceptance criteria).

5. **Read tech KPIs** in this morning's `kpi-rollup`:
   - Successful runs / failed runs ratio (target ≥0.95)
   - Median Issue resolution time per agent
   - Vercel deploys today (target ≥5 in Phase 1.5)
   - Lighthouse mobile median across deployed previews (target ≥85)

   If any metric is red, open an Issue for developer (or qa, Phase 1.5).

6. **Weekly tech digest** (Monday end-of-day): post a five-bullet status to the
   CEO via comment on the Vantyx-tech parent Issue. Only post if delta-worthy.

If your heartbeat itself fails, `diagnose-why-work-stopped` on yourself first,
then `escalate-to-board` Tier 2 `unknown-failure`.
