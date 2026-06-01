---
schema: agentcompanies/v1
kind: skill
name: template-fill
description: Deterministic writer for a cloned vantyx-web-os template's site.config.ts. Takes a lead row + brand markdown, emits a typed SiteConfig with no LLM in the file-write path.
metadata:
  requires_env:
    - NODE_OPTIONS         # set to --experimental-sqlite on Node 22.x
  implementation: skills/template-fill/run.mjs
  primary_users: [demo-gen]
  cost_per_call_usd: 0
  storage: sqlite (reads /home/paperclip/vantyx-leads.sqlite by default)
---

# template-fill

Replaces the previous model-driven `site.config.ts` write in the demo-gen
pipeline. The model used to construct the entire file via prose and kept
emitting a hallucinated `import type { SiteConfig } from "./site.config";`
self-import; sed-correction in `AGENTS.md` step 5 mitigated the symptom.
**This skill removes the class of failure** — the file is built from a
hardcoded template string + interpolated JSON, never from a model write.

## When to use

- Step 5 of demo-gen's heartbeat, immediately after `template-clone`.
- Ad-hoc rebuild of a single lead's `site.config.ts` (e.g. after a brand-file
  update).

## When NOT to use

- For the upstream Vantyx Web OS repo's own `site.config.ts` (the "Lima
  default"). That's hand-maintained by developer; this skill writes per-lead
  outputs only.
- Before the brand file at `shared/brand/clients/<slug>.md` exists. The skill
  will still run and emit Vantyx-default branding, but demo-gen step 3
  already enforces the brand-file gate — don't bypass it.

## Inputs (CLI flags)

| Flag                  | Required | Purpose                                                                 |
|-----------------------|----------|-------------------------------------------------------------------------|
| `--lead-id <id>`      | One of   | SQLite primary key in the `leads` table.                                |
| `--lead-json <path>`  | these    | Pre-fetched lead row as JSON (same column names as the leads table).    |
| `--brand-file <path>` | no       | `shared/brand/clients/<slug>.md`. If omitted, niche-default branding.   |
| `--template-dir <path>` | one of | Cloned vantyx-web-os dir; writes to `<dir>/site.config.ts`.             |
| `--out <path>`        | these    | Explicit output path.                                                   |
| `--dry-run`           |          | Print to stdout instead of writing.                                     |
| `--leads-db <path>`   | no       | Override default `/home/paperclip/vantyx-leads.sqlite`.                 |
| `--enrichment-json <path>` | no  | Optional model-produced data values (tagline, hero copy, services).     |

## Outputs

- Writes `site.config.ts` at `<template-dir>/site.config.ts` (or `--out`).
- Stdout JSON: `{ ok: true, wrote, lead_id, slug, warnings: [...] }`.

## Exit codes

- `0` — wrote the file, all invariants hold.
- `1` — CLI / IO error (missing arg, unreadable file).
- `2` — lead not found or missing required fields (`id`, `name`, `niche`).
- `3` — brand file unparseable. (Currently unreachable — parser is lenient
  and falls back to defaults; reserved for stricter future modes.)
- `4` — post-write invariant check failed. **Should be impossible** — if it
  fires, the skill has a bug. Escalate Tier 2 `adapter-broken`.

## Invariants (post-write check, mirrors the old sed/grep gate)

After rendering, the skill verifies all three before exit:

1. `export const siteConfig` is present.
2. The import is exactly `from "@/lib/site-config"`.
3. No `from "./site.config"` self-import anywhere.

Any failure exits `4` without writing. Demo-gen `AGENTS.md` step 5 no longer
needs its own sed/grep gate — this skill owns the invariant.

## Determinism guarantees

- The import line is a hardcoded string constant in `run.mjs` (search for
  `CRITICAL: the import line is HARDCODED`). It is not derived from any
  input.
- The `siteConfig` body is `JSON.stringify(obj, null, 2)` of a
  programmatically-built object. JSON is a valid subset of TypeScript object
  literal syntax, so the result type-checks against `SiteConfig`.
- Brand-markdown parsing falls back to Vantyx defaults on any missing field
  — the skill never throws on a brand-file ambiguity.
- Lead `city` column is checked for street-address patterns (starts with a
  digit, or contains St/Rd/Ave/Blvd/Dr/etc.). When it looks like a street, it
  moves to `address.street` and the niche-default metro for the state is
  used for `city`. Logged as a warning.

## Example

```bash
NODE_OPTIONS=--experimental-sqlite \
node /path/to/codex-home/skills/template-fill/run.mjs \
  --lead-id 5ceba4a21e40f91b27348e99ce817352 \
  --brand-file /path/to/shared/brand/clients/collier-electric.md \
  --template-dir /tmp/demos/collier-electric
```

## Schema coupling

`site.config.ts` must `import type { SiteConfig } from "@/lib/site-config"`
because the type lives in the template at `src/lib/site-config.ts` (post
VAN-9, 2026-05-24). If that path ever changes, edit the `importLine`
constant in `run.mjs` to match.
