---
schema: agentcompanies/v1
kind: skill
name: patch-sync-vantyx
description: Weekly sync of in-droplet agent/skill self-patches up to the Rfog88/vantyx master branch. Diffs droplet copies against upstream, pushes only real drift, and files a per-cycle audit Issue.
metadata:
  requires_env:
    - GITHUB_TOKEN_VANTYX        # scoped PAT, Contents R+W on Rfog88/vantyx
    - PAPERCLIP_COMPANY_ID
    - PAPERCLIP_API_URL
    - PAPERCLIP_API_KEY
    - PAPERCLIP_RUN_ID
    - PAPERCLIP_TASK_ID          # the execution Issue created by the routine
  implementation: skills/patch-sync-vantyx/run.mjs
  cost_per_call_usd: 0.0         # GitHub API + 1 git clone — negligible
  primary_users: [developer]
  storage: ephemeral /tmp clone
---

# patch-sync-vantyx

Weekly routine that keeps droplet copies of agent and skill files in lock-step
with the source-of-truth GitHub repo `Rfog88/vantyx`. Triggered by the
`patch-sync-vantyx` routine (cron Mondays 09:00 America/New_York, or via
manual `api` trigger).

The trigger incident: 2026-05-23 `sdr` patched `gmaps-scrape/run.mjs` inside
the droplet to fix a SerpAPI URL bug. That edit was at risk of being lost on
the next droplet reimport. The Board mandated that droplet self-patches must
propagate up to master every week with clean attribution. This skill is that
enforcement.

## When to use

- Scheduled weekly fire from the `patch-sync-vantyx` routine (Monday 09:00 ET).
- Ad-hoc force-fire via the routine's `api` trigger for acceptance / smoke.

## When NOT to use

- For non-Vantyx repos. The clone URL is hard-coded to `Rfog88/vantyx`.
- For files outside the glob coverage (see below) — those are explicitly off-limits.
- As a substitute for proper PR review on substantive refactors. This is for
  small in-droplet self-patches (typos, URL fixes, prompt tweaks). Anything
  larger should go through CTO review.

## Glob coverage (hard-coded)

- Agents: `agents/{urlKey}/{AGENTS,HEARTBEAT,SOUL,TOOLS}.md`
- Skills: `skills/{name}/{SKILL.md,run.mjs}`

Any other file basename is ignored. The basename allowlist is enforced in code
as a hard guard — broadening it requires a CTO-reviewed change.

## Droplet → upstream path mapping

| Upstream (Rfog88/vantyx) | Droplet source |
|---|---|
| `agents/{urlKey}/AGENTS.md` | `companies/{companyId}/agents/{agentId}/instructions/AGENTS.md` |
| `agents/{urlKey}/{HEARTBEAT,SOUL,TOOLS}.md` | same dir, same basename |
| `skills/{name}/{SKILL.md,run.mjs}` | `skills/{companyId}/__catalog__/{name}--{hash}/{file}` |

- `urlKey` is pulled live from `GET /api/companies/{companyId}/agents`.
- `name` is the skill catalog dir's prefix before `--{hash}`.
- Skills not present upstream are skipped with a log line (not pushed) — the
  spec is "lift droplet self-patches up", not "publish new droplet skills".

## Algorithm (one cycle)

1. Shallow-clone `Rfog88/vantyx` into `/tmp/vantyx-sync-{cycleId}` using the
   token via env-var URL.
2. Build live mappings (agents API + skill catalog scan).
3. For each pair: skip if droplet missing, log+skip if upstream missing,
   skip if byte-equal, otherwise overwrite upstream and stage.
4. Group staged files by entity (agent urlKey or skill name).
5. One commit per entity:
   `{entity}: sync droplet self-patch to {basenames} (auto-sync of in-droplet self-patch)`
   Author: `Paperclip patch-sync <noreply@paperclip.ing>`.
6. `git push origin HEAD:master` (no force, no rebase).
7. PATCH the per-cycle Issue (the routine's execution Issue, identified by
   `PAPERCLIP_TASK_ID`) with the final title, the drift table, and
   `status: done`.
8. Delete the clone dir.

If zero drift: still PATCH the Issue with body "No drift detected this
cycle." — that's still a passing run. No empty commit is pushed.

## Inputs

None. The skill reads everything from env + droplet + upstream state.

Optional CLI flags (for local smoke / debugging — NOT used by the routine):

- `--dry-run` — diff only, no commits, no push, no Issue PATCH.

## Outputs

- Stdout: single JSON line with `{cycleId, date, commits[], pushed, skipped, issuePatched}`.
- Side effects:
  - 0..N commits pushed to `Rfog88/vantyx` master.
  - The execution Issue patched to `done` with the cycle report.

## Safety guardrails

- **Path-traversal guard**: every droplet path is `path.resolve`d and verified
  to live under the company's `agents/` or `skills/__catalog__/` root.
  Anything else is rejected silently (and counts as "droplet missing").
- **Basename allowlist**: hard-coded set of 6 basenames. Anything else in
  those dirs is ignored.
- **Token hygiene**: `GITHUB_TOKEN_VANTYX` is never echoed; clone URL is
  built with an env-substituted form and never logged.
- **No force push, no rebase, no history rewrite.** Plain
  `git push origin HEAD:master`.
- **No empty commits.** If no drift, only the audit Issue is written.

## Failure modes

- Missing `GITHUB_TOKEN_VANTYX` → exit 3, `api-key-missing`.
- Clone fails (network, auth) → exit 1, `patch-sync-failed`.
- Push rejected (non-fast-forward, branch protection) → exit 1, message
  includes the git error. CTO should investigate; the per-cycle Issue is
  NOT auto-filed in this case because we can't trust the cycle ran cleanly.
- Per-entity commit fails → logged, other entities still committed. Skill
  continues to push the entities that did commit cleanly.
