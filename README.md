# Vantyx — Paperclip Company

AI-orchestrated web-transformation agency for local home-services businesses (electricians, plumbers, HVAC, roofers, general contractors).

## Import on the droplet

```bash
npx companies.sh add https://github.com/Rfog88/vantyx/tree/master
```

For updates after the first add:

```bash
npx companies.sh add https://github.com/Rfog88/vantyx/tree/master --update
```

## Repo layout

```
vantyx/
  COMPANY.md             # Company manifest (agentcompanies/v1)
  .paperclip.yaml        # Routines (cron-triggered work)
  agents/                # One folder per agent, four files each
    ceo/                 # AGENTS.md (ENTRY), HEARTBEAT.md, SOUL.md, TOOLS.md
    cto/
    cmo/
    ux-designer/
    developer/
    sdr/
  skills/                # Custom SKILL.md files (added to company library, then enabled per-agent in UI)
  shared/                # Cross-agent artifacts (brand, lessons, active clients)
    brand/vantyx.md      # Agency-brand source of truth (read by every customer-facing agent)
    brand/clients/       # Per-client brand files (only UXDesigner writes)
    clients/active.md    # Active client engagements
    lessons.md           # Failure-mode notes appended by any agent
  migrations/            # SQL migrations for Paperclip's embedded Postgres
```

## Design plan

Full implementation plan lives at `~/.claude/plans/crystalline-seeking-key.md`. Read it before making structural changes.

## Cost model (important)

Agent execution runs on Ryan's CLI subscriptions (Claude Max, ChatGPT Pro w/ Codex, Gemini AI), NOT on API tokens. Paperclip's Budget tab shows notional USD as a rate-limit signal — actual cost is the flat subscription. Only external service keys (SerpAPI, Vercel, Discord, Resend, Mapbox, etc.) are billable per-use.
