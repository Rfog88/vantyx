---
schema: agentcompanies/v1
kind: skill
name: prompt-fill
description: Deterministic filler for the Lovable demo prompt. Takes a lead row, substitutes the {{PLACEHOLDER}} tokens in shared/lovable-demo-prompt.md, and writes the finished prompt that lovable-build sends to Lovable. No LLM in the write path.
metadata:
  requires_env:
    - NODE_OPTIONS         # set to --experimental-sqlite on Node 22.x
    - LEADS_DB_PATH        # default /home/paperclip/vantyx-leads.sqlite
  implementation: skills/prompt-fill/run.mjs
  primary_users: [demo-gen]
  cost_per_call_usd: 0
  storage: sqlite (reads /home/paperclip/vantyx-leads.sqlite by default)
---

# prompt-fill

Replaces the retired `template-fill` skill. Where `template-fill` wrote a
`site.config.ts` for the in-house `vantyx-web-os` template, `prompt-fill` writes
the **Lovable build prompt**: it reads a lead row, substitutes the
`{{PLACEHOLDER}}` tokens in `shared/lovable-demo-prompt.md`, and emits the
finished prompt for `lovable-build` to hand to the Lovable MCP `create` tool.
No model is in the write path — it is straight string interpolation.

## When to use

- Step 1 of demo-gen's heartbeat, before `lovable-build`.
- Ad-hoc regeneration of a single lead's prompt (e.g. after editing the
  template or refreshing the lead's data).

## When NOT to use

- To edit the template itself — that is `shared/lovable-demo-prompt.md`,
  hand-maintained (Ryan owns the voice/structure).

## Inputs (CLI flags)

| Flag                      | Required | Purpose                                                            |
|---------------------------|----------|--------------------------------------------------------------------|
| `--lead-id <id>`          | one of   | SQLite primary key in the `leads` table.                           |
| `--lead-json <path>`      | these    | Pre-fetched lead row as JSON (needs `--allow-lead-json`).          |
| `--prompt-template <path>`| no       | Default `shared/lovable-demo-prompt.md`.                           |
| `--out <path>`            | no       | Default `/tmp/demos/<slug>/lovable-prompt.txt`.                    |
| `--stdout`                | no       | Print the prompt to stdout (JSON summary → stderr) instead of writing. |
| `--leads-db <path>`       | no       | Override default `/home/paperclip/vantyx-leads.sqlite`.            |
| `--require <csv>`         | no       | Placeholder names that must be present. Default `COMPANY_NAME,PHONE,NICHE_LABEL`. |

## How tokens resolve

- The template's `## Placeholder → source map` lists every token. Tokens map to
  lead columns; a few are computed (`NICHE_LABEL`, `SERVICE_AREA_LABEL`,
  `SERVICES` from `niche`; `TESTIMONIALS` formatted from the JSON array) and a
  few have defaults with no backing column (`HOURS`, `OFFER`).
- A token with no data is substituted with the literal `[NOT PROVIDED]`. The
  prompt body instructs Lovable to omit those elements and never fabricate a
  license number, rating, or review count.
- Only the text **after** the `<!-- ===PROMPT BODY=== -->` delimiter is emitted;
  the documentation above it is dropped. If the delimiter is absent, the whole
  file is used.

## Outputs

- Writes the filled prompt to `--out` (default `/tmp/demos/<slug>/lovable-prompt.txt`).
- Stdout JSON: `{ ok, lead_id, slug, prompt_path, prompt_chars,
  filled_placeholders[], empty_placeholders[], required_missing[] }`.

## Exit codes

- `0` — wrote the filled prompt; all `--require` placeholders present.
- `1` — CLI / IO error (missing arg, unreadable template).
- `2` — lead not found, missing core fields (`id`, `name`, `niche`, `phone`),
  or a `--require` placeholder resolved empty.
- `3` — template contains a `{{PLACEHOLDER}}` this skill can't resolve (typo or
  a new token added to the template without updating the resolver in `run.mjs`).

## Example

```bash
NODE_OPTIONS=--experimental-sqlite \
node /path/to/codex-home/skills/prompt-fill/run.mjs \
  --lead-id 5ceba4a21e40f91b27348e99ce817352 \
  --out /tmp/demos/collier-electric/lovable-prompt.txt
```
