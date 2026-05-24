---
schema: agentcompanies/v1
kind: skill
name: vercel-deploy
description: Run `vercel --prod` from a filled Vantyx Web OS clone, capture the deployed URL, return it for the lead-update step.
metadata:
  requires_env:
    - VERCEL_TOKEN
  implementation: skills/vercel-deploy/run.mjs
  primary_users: [demo-gen, developer]
  cost_per_call_usd: 0    # Vercel Pro subscription; build minutes vary
---

# vercel-deploy

Wrap the Vercel CLI for a production deploy of a per-lead clone of Vantyx
Web OS. Returns the canonical `*.vercel.app` URL.

Phase 1.5: previews go to auto-generated Vercel subdomains
(`preview-<slug>-<hash>.vercel.app`). Phase 2: migrate to
`*.preview.vantyx.com` once custom-domain wildcard is wired.

## When to use

- `demo-gen` heartbeat, step 4 — after `template-fill`.

## When NOT to use

- For internal Vantyx tooling (use a different Vercel project).
- Without `VERCEL_TOKEN` bound — skill exits cleanly with `api-key-missing`.

## Inputs

```json
{
  "clone-path": "/tmp/demos/acme-electric",
  "lead-slug": "acme-electric",
  "scope": "vantyx"           // optional; defaults to env VERCEL_SCOPE or "vantyx"
}
```

## Outputs

```json
{
  "url": "https://preview-acme-electric-abc123.vercel.app",
  "project_id": "prj_xyz",
  "deployment_id": "dpl_abc",
  "duration_ms": 38450
}
```

## Failure modes

- 401/403 from Vercel API → exit `api-key-missing`. demo-gen escalates Tier 2.
- 429 / build-minute exhaustion → exit `external-quota-exceeded`. demo-gen
  escalates Tier 1.
- Build errors (TypeScript, missing deps) → exit `adapter-broken` with the
  log tail attached. CTO investigates the Web OS repo.

## Prerequisites

- `vercel` CLI installed under the `paperclip` system user
  (`npm install -g vercel` if not already).
- `VERCEL_TOKEN` bound at agent or project env level in Paperclip Secrets.
