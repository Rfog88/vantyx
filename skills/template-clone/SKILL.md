---
schema: agentcompanies/v1
kind: skill
name: template-clone
description: Shallow-clone the public Vantyx Web OS repo into /tmp/demos/<lead-slug>/ so template-fill can write site.config.ts into it.
metadata:
  implementation: skills/template-clone/run.mjs
  primary_users: [demo-gen]
  cost_per_call_usd: 0
---

# template-clone

Wrapper around `git clone --depth 1 https://github.com/Rfog88/vantyx-web-os.git`
into a deterministic per-lead path. Idempotent — if the dir exists, re-clone
into a temp path and atomic-swap (so a half-clone never causes downstream failure).

## When to use

- `demo-gen` heartbeat, step 2 — immediately after UXDesigner's brand file
  is ready and before `template-fill`.

## When NOT to use

- For leads where a clone already exists AND was created in the same
  heartbeat cycle (would be redundant; demo-gen flow should not call this
  twice in a row).

## Inputs

```json
{
  "lead-slug": "acme-electric",
  "target-dir": "/tmp/demos"      // optional; defaults to /tmp/demos
}
```

## Outputs

```json
{
  "clone_path": "/tmp/demos/acme-electric",
  "head_sha": "f455ab8…",
  "size_bytes": 1234567
}
```

## Failure modes

- Repo not reachable → exit `adapter-broken` with clone error. demo-gen
  escalates Tier 1.
- Disk full → exit `unknown-failure`. CTO investigates.
- Lead-slug contains invalid path chars → exit `decision-needed`. demo-gen
  sanitizes and retries.
