# Vantyx — Complete Company Breakdown

> A single-source, exhaustive reference describing everything about Vantyx: what
> it is, who runs it, the Paperclip platform it lives on, the DigitalOcean
> droplet, every AI agent, the full pipeline, the website-build process, the
> marketing and sales motion, the lead database, the skills toolchain, the cost
> model, the history, and the current status. Written to be loaded into
> NotebookLM as the knowledge base for the company.
>
> Compiled 2026-06-08. Point-in-time. Some operational details (funnel counts,
> in-flight builds) move fast; treat the live droplet and the project STATE.md
> as the final word where they disagree.

---

## 1. What Vantyx is, in one paragraph

**Vantyx is an AI-orchestrated web-transformation agency for local home-services
businesses** — electricians, plumbers, HVAC companies, roofers, and general
contractors — in Ohio and adjacent markets. It is not a SaaS product and not a
template shop. It is a **services company that uses a fleet of AI agents as force
multiplication** to find under-served local contractors, rebuild their website as
a polished live preview *before the first sales call ever happens*, and convert
that preview into project + retainer revenue (hosting, SEO, blog content, Google
Business Profile / reputation management, ads, AI chatbots, ongoing maintenance).

The whole company runs as an autonomous "agent company" inside a platform called
**Paperclip**, self-hosted on a DigitalOcean droplet. A human — Ryan Fogle — sits
above it as the **Board**: he sets direction, approves, and is escalated to. The
**CEO is an AI agent**, not Ryan. That distinction is foundational to how
everything below works.

**Slug:** `vantyx` · **Paperclip URL code:** `VAN` (so issues are `VAN-123`, URLs
`localhost:3100/VAN/...`) · **Brand domain:** `usevantyx.com` (the original
`vantyx.io` and `vantyx.com` were unavailable at registration; `usevantyx.com` is
the live identity) · **GitHub:** `github.com/Rfog88/vantyx` (public, default
branch `master`). · Started **2026-05-23**.

---

## 2. The person behind it — Ryan Fogle and the "Board" model

**Ryan Fogle** owns **Fogle & Sons Electric**, a real electrical-contracting
business. That lived trades experience is the company's deepest moat — he knows
the home-services market from the inside (electricians, plumbers, HVAC, roofers,
GCs) and the agency's instincts are tuned to it.

Ryan's role in Vantyx is **the Board**, the top of the org chart:

- He owns **strategic direction, approvals, escalations, and hiring agents**.
- He is explicitly **NOT the CEO** — the CEO is an AI agent (Aria). Ryan has
  corrected this twice; it is canonical.
- The operating pattern is **"advisors propose, Ryan approves."** Anything that
  writes to authoritative state, sends a real email, signs a client, or spends
  real money without his approval violates the pattern.
- He reads **Discord and the Paperclip Inbox roughly equally**; both must fire
  for a Tier-1+ escalation to count as "delivered."
- He is **allergic to the word "AI" in client-facing copy.** The agency uses AI;
  the contractor buys "a website" and "more calls." Never say "AI-powered" to a
  prospect.
- **Working style:** concrete and iterative — wants real artifacts running
  end-to-end before optimizing; prefers command-line walkthroughs; thinks out
  loud via voice transcript (read for meaning, not literal typos); values honest
  "here's the tradeoff" framing over agreeable hand-waving.

Ryan's biggest historical pain point with Paperclip — and the thing the whole
escalation system exists to solve — is that **work silently piles up in the
"Blocked" column and he can't tell what actually needs him.** In his words: *"in
my other companies from Paperclip AI it's hard to decipher why something is stuck
if there's a lot going on, so I want to make sure if there's something I need to
do I am 100% alerted."*

**Emails:** work = `ryan@fogleandsons.com`; personal = `financearf88@gmail.com`.
The agency's outbound sales mailbox is a separate identity, **`sami@usevantyx.com`**
(the SDR agent's Google Workspace mailbox).

---

## 3. The Paperclip platform — what the company actually runs inside

**Paperclip** (the product / CLI is `paperclipai`) is a platform for building and
running "agent companies" — orgs of AI agents that do real work on cron schedules,
file issues, escalate, and operate semi-autonomously. Vantyx is one company
running on Ryan's Paperclip instance; he runs others alongside it.

### 3.1 Core Paperclip concepts

- **Board → CEO → C-suite → ICs.** The human is the Board. The CEO is an AI
  agent. C-suite agents (CTO/CMO/UXDesigner) delegate down to individual
  contributors (developer, SDR, QA, demo-gen) via `reportsTo` relationships.
- **Each agent = 4 instruction files** in the repo, which map to the agent's
  Instructions tabs in the UI:
  - `AGENTS.md` (the ENTRY file) — role definition, delegation rules, what they
    do and don't do.
  - `SOUL.md` — identity, voice, operating principles, persistent memory, "life."
  - `HEARTBEAT.md` — exactly what to do on each heartbeat tick.
  - `TOOLS.md` — the list of skill slugs the agent may call.
- **Skills** are checkbox-enabled capabilities. Built-ins ship with Paperclip
  (`paperclip`, `paperclip-create-agent`, `paperclip-create-plugin`,
  `paperclip-dev`, `paperclip-converting-plans-to-tasks`,
  `diagnose-why-work-stopped`, `para-memory-files`, `terminal-bench-loop`).
  Custom skills are authored as `SKILL.md` + a `run.mjs` under `skills/<slug>/`,
  added to the company's skill library, then enabled per-agent in the UI.
- **Issues are the canonical unit of work.** Everything is an Issue with a code
  like `VAN-123`. Valid statuses: `backlog, todo, in_progress, in_review, done,
  blocked, cancelled`. Issues nest via `parentId` (delegation = create a
  sub-Issue assigned to a report).
- **Routines materialize into Issues.** A routine is a cron-triggered (or
  webhook/manual) prompt assigned to an agent. Every time it fires it creates a
  new execution Issue — so there's always an audit trail.
- **Heartbeats** are the agent's autonomous loop. **Critical gate:** a routine
  firing does NOT mean the agent runs — the agent's `runtimeConfig.heartbeat.enabled`
  must ALSO be `true`. Freshly imported agents default to `enabled: false` (the
  deliberate "pre-launch" state). Triggers and heartbeat-enabled are two
  independent gates.
- **Inbox + the Blocked filter** is the native human-alert surface (alongside
  Discord).
- **Approvals** are first-class: an agent files a `request_board_approval`, which
  shows up with Approve / Reject / Request-revision buttons in the UI. Approving
  is what triggers downstream autonomous action.

### 3.2 The droplet (production host)

- **DigitalOcean droplet**, Ubuntu 24.04, NYC1 region. Public IP
  **`68.183.104.145`**, hostname **`paperclip-prod`**. SSH as `root` (alias
  `ssh vantyx` / `ssh paperclip`).
- Ryan reaches the UI via an SSH tunnel: `ssh -L 3100:127.0.0.1:3100 root@68.183.104.145`
  — Paperclip's UI is **loopback-only** (`127.0.0.1:3100`), so it's only
  reachable through the tunnel. Auth mode is `local_trusted` (the tunnel user is
  treated as the Board, user id `local-board`).
- **Not Docker.** Paperclip runs as a **systemd service** (`paperclip.service`)
  under the `paperclip` user. ExecStart: `/home/paperclip/.npm-global/bin/paperclipai run`.
  Restart with `sudo systemctl restart paperclip`; logs via `sudo journalctl -u paperclip -f`.
- **Data dir:** `/home/paperclip/.paperclip/instances/default/`.
- **Embedded Postgres** at `127.0.0.1:54329` (loopback only) holds Paperclip's
  own state (agents, issues, skills orchestration).
- **Node v22.x** (22.22.2). `node:sqlite` is available but experimental, so
  custom skills need `NODE_OPTIONS=--experimental-sqlite`.
- **Separate, unrelated project on the same box:** `/home/hermes` (a general agent
  framework — Ryan's Hermes EA assistant). Vantyx work stays strictly inside
  `/home/paperclip`; the two never cross.
- Other Paperclip companies on the same instance (do not touch from Vantyx
  sessions): `WEB` (Website Growth — an earlier test), `INV` (Investment Ops),
  `EXP` (Explorer), `FAC` (Faceless Media Holdings — an AI faceless-YouTube
  operation).

### 3.3 Why custom data lives in SQLite, not Paperclip's Postgres

Paperclip's embedded Postgres is **sealed** — it never exposes a `DATABASE_URL`
or password to the outside, and `pg_hba.conf` requires password auth for every
connection. So custom skills cannot talk to it. Vantyx therefore stores all its
lead data in a **standalone SQLite file** at **`/home/paperclip/vantyx-leads.sqlite`**
(override via `LEADS_DB_PATH`), accessed through Node's built-in `node:sqlite`
(zero dependencies). Skills create the schema idempotently with
`CREATE TABLE IF NOT EXISTS` on every run, so there's no migration step in
production — the `migrations/*.sql` files are reference schemas.

### 3.4 The cost model (the single most misunderstood thing)

Agent "thinking" does **not** cost API tokens. Paperclip's `claude_local`,
`codex_local`, and `gemini_local` adapters run the agents on Ryan's **flat-rate
CLI subscriptions** — Claude Max (Opus/Sonnet/Haiku via Claude Code CLI), ChatGPT
Pro with Codex (gpt-5-codex via Codex CLI), and Gemini. The droplet runs in
**subscription mode** (the `ANTHROPIC_API_KEY` is commented out in
`/etc/paperclip/env`), so the real marginal cost of an agent heartbeat is **$0**.

The **Budget tab's dollar figures are notional** — token-count × published API
price — and serve only as a **rate-limit / quota-burn signal**, not a bill. The
real constraints are (a) the Claude Max **5-hour rate limit** (overage disabled,
so no surprise spend — it manifests as adapter errors, never a charge), and (b)
the genuinely **billable external services**, metered per use:

- **SerpAPI** (~$0.01/Google-Maps query) — lead sourcing.
- **Google Places API (New)** (~$0.08/lead) — real reviews/photos enrichment.
- **Lovable build credits** — metered on the Lovable plan; the demo builder.
- **Vercel** (Pro), **Resend** (email), **Discord** (webhook, free),
  **Mapbox**, optional **Twilio** (Tier-2 SMS), etc.

Empirically the flat subscription (~$120/mo) pays for itself in ~3–4 days versus
what the same agent activity would cost in API tokens.

### 3.5 Escalation — the tiered system that keeps Ryan in the loop without noise

Because silent stuck work is Ryan's #1 complaint, **every agent carries a tiered
escalation pattern**. Every escalation MUST cite one standardized reason:
`api-key-missing`, `subscription-rate-limit`, `decision-needed`,
`external-quota-exceeded`, `agent-conflict`, `human-review-required`,
`adapter-broken`, `unknown-failure` (the last with a `diagnose-why-work-stopped`
diagnosis attached).

- **Tier 0 (status):** silent Discord digest, only if something delta-worthy
  changed. **Never** "all systems normal" pings (those train Ryan to ignore the
  channel).
- **Tier 1 (decision needed):** Discord post **+** a Paperclip Inbox Issue
  assigned to Board with a `pending_human` label. Max 3 nudges (immediate, +4h,
  +24h) before auto-promotion to Tier 2. Held inside `BOARD_DND_HOURS` (e.g.
  22:00–07:00).
- **Tier 2 (hard block):** Discord `@here` + Inbox + optional Twilio SMS.
  Deduped by `(agent_slug, error_signature)` so one broken adapter can't storm
  the channel. Repeats every 4h until acknowledged. Dependent Issues
  auto-Blocked. Tier-2 fires even during DND.
- **Acknowledgement:** a 👍 / reply in Discord, or opening+commenting the Issue,
  or replying "ACK" to the SMS, marks it acknowledged; the originating agent gets
  a "Board has seen this" system comment so it knows to resume.

This is delivered by two skills: `board-notify` (the Discord/SMS primitive) and
`escalate-to-board` (which also files the tracked Paperclip Issue with labels and
dependency rules).

### 3.6 Progressive automation gate — how new "real-world action" channels go live

Any new channel where an agent takes a consequential real-world action (sending a
cold email, deploying, paying, posting publicly, auto-replying to a prospect)
**starts gated, per-action**. It graduates to autonomous only after BOTH: **N**
total Board-approved actions AND the **last K consecutive** were clean approvals
(no "approve-with-edits"). Pending-approval queue depth is capped at **M** so the
Board being away doesn't cascade into a backlog.

- For outreach-class actions: **N=5, K=3, M=3.** Higher-consequence channels
  (billing, contracts, public publishing) use bigger numbers.
- Why: at launch the agent's own quality gate is itself unproven. The canonical
  cautionary tale is **VAN-52** — QA passed a demo 7/7 ✅ that rendered the literal
  string `License #xxxxxxxx` to prospects. The Board empirically catches what
  synthetic gates miss; once you have N clean approvals you have evidence the gate
  works and can flip to autonomous.

---

## 4. The org chart — every agent in detail

```
Board (Ryan Fogle, human — strategy, approvals, hiring, escalation target)
└── CEO          Aria   — claude_local / Opus
    ├── CTO      Cipher — claude_local / Opus
    │   ├── developer  Dexter — codex_local / gpt-5-codex
    │   └── QA         Quinn  — claude_local  (Phase 1.5)
    ├── CMO      Mavis  — claude_local / Sonnet
    │   ├── SDR        Sami   — claude_local / Haiku
    │   └── demo-gen   Deci   — claude_local  (Phase 1.5)
    └── UXDesigner  Dyna — claude_local / Sonnet
```

Eight agents. Six were the Phase-1 core (CEO, CTO, CMO, UXDesigner, developer,
SDR); Phase 1.5 added QA (under CTO) and demo-gen (under CMO). Each agent has a
distinct name, model adapter (chosen for cost/capability fit), voice, and a
strict "what I do / what I never do" boundary. A universal rule across all of
them: **terse, numeric, no emojis, never the word "AI" in client-facing copy,**
and **delegate rather than do** (for the managers).

### 4.1 Aria — CEO (`ceo`), claude_local / Opus

The operator who decomposes Ryan's vision into routed work. **Force-multiplier,
not a doer** — never writes code, drafts copy, designs pages, or fixes bugs
herself; even small tasks get delegated.

- **Routing:** code/bugs/infra/deploys → CTO; lead-gen/outreach/marketing/growth →
  CMO; UX/design/brand → UXDesigner; cross-functional → split into per-department
  sub-Issues. If the right report doesn't exist, she *hires* one via
  `paperclip-create-agent` before delegating.
- **Must escalate to Board before:** spending >$50 external-API on one demo,
  hiring an agent, signing a client, modifying her own prompt, adding/removing a
  C-suite agent.
- **Heartbeat:** check Inbox (Board messages first) → sweep reports' Blocked
  Issues and resolve/escalate each → pre-screen pending approvals to shorten
  Ryan's loop → read the morning KPI rollup and open Issues for red metrics →
  end-of-day digest **only if delta-worthy** (silence is fine).
- **Creed:** "Last-mile is where reliability lives" (refuse the 80%-ship until
  the last 20% is right); "Silent stuck work is the cardinal sin."

### 4.2 Cipher — CTO (`cto`), claude_local / Opus

Runs a reliable platform — "an operator, not a hero who fixes things at 2am."
Owns the platform, agent health, adapter configuration, and all code shipping
under the Vantyx name. Delegates code to developer, QA to Quinn.

- **Signature discipline — `code-complete` vs `deploy-verified`:** a sub-issue is
  NOT closeable on "the code landed." Closure requires fetching the canonical
  live URL and grepping the actual deployed HTML/JSON-LD for the expected
  signals (and grepping that bad strings are *absent* — e.g. `License #xxxxxxxx`,
  leaked fixture values, `unsplash`). He runs the `curl | grep -c` himself; "QA
  said so" / "developer reports" is not acceptance. (Codified after a Board
  re-open, VAN-155/VAN-169.)
- **Heartbeat:** Inbox → **agent-health sweep** (anything in `error` >2 ticks →
  diagnose or escalate `adapter-broken`; anything past 50% notional budget by
  midday → investigate quota burn) → scan technical Blocked Issues → review
  developer's code changes → read tech KPIs.
- Owns `migrations/`, adapter config, and hiring QA.

### 4.3 Mavis — CMO (`cmo`), claude_local / Sonnet

Leads lead-gen, outreach, marketing, growth. Delegates scraping/scoring to SDR,
demo generation to demo-gen, brand to UXDesigner (via CEO).

- Owns **territory strategy** (which ZIPs, niches, score thresholds — maintains
  `shared/territories.md`), the **conversion funnel**, and **per-niche
  playbooks** (`shared/playbooks/<niche>.md` with A/B logs — winners codified,
  losers kept for the record).
- **Creed:** "Conversion is the only god"; "Score is the gate" (sub-65 leads
  never get outreach, ever — if you want an exception, lower the threshold for
  the territory via an Issue, don't freelance); "Specificity converts" ("Built 47
  sites for Ohio electricians" > "Trusted nationwide").
- Escalates a lost ≥80 lead (the most expensive misses) so Ryan gets a
  post-mortem. Maintains the do-not-contact list.

### 4.4 Dexter — developer (`developer`), codex_local / gpt-5-codex

The full-stack IC. Reports to CTO, delegates to no one. Runs on Codex (so the
adapter split — ~3 Claude : 5 Codex — doubles the daily quota ceiling). **Writes
code, not essays.**

- Builds/maintains the component library (historically `vantyx-web-os`), writes
  custom skill `run.mjs` implementations, runs Vercel deploys (holds
  `VERCEL_TOKEN`, scope `rfog88s-projects`), runs Lighthouse audits, writes SQL
  migrations, fixes bugs.
- **Never** ships without CTO review, never makes unilateral architecture calls,
  never ships a demo failing brand-check or Lighthouse <85.
- Holds a fine-grained GitHub PAT (`GITHUB_TOKEN_VANTYX_WEB_OS`) scoped to
  Contents R+W on the web-os repo only — least privilege; pushes via
  `https://x-access-token:$TOKEN@github.com/...`. Notable milestone: the **first
  agent-driven git push** (VAN-12, Dexter authored commit `a353bc3`).

### 4.5 Sami — SDR (`sdr`), claude_local / Haiku

The cheapest, fastest adapter — "stay light." Reports to CMO. Three jobs:
**scrape, score, write leads** — plus, since Phase 2 design, **reply handling**.

- Runs `gmaps-scrape` on assigned territories, the website-health probe, and
  `lead-score`. Keeps the leads table clean (dedupe on phone then website; close
  stale `new` rows >30 days as `lost`).
- **Sends cold email only after Ryan approves that specific demo** — there is no
  freelance send. Sends from `sami@usevantyx.com` via `gmail-send`, with the
  preview `demo_url` as the centerpiece, then stamps `stage='outreach_sent'`.
- **Reply handling (hybrid):** the `sami-inbox-poll` routine matches inbound mail
  to outreach threads and runs `classify-outreach-reply`. Deterministic detectors
  (bounce/complaint/unsubscribe/auto-reply) override any human label and
  auto-suppress the reputation-critical classes. **GLOBAL RULE — suppression is
  law:** a "no," an unsubscribe, a hard bounce, or a complaint is permanent and
  applies even if the business is re-scraped later as a fresh row.
- The follow-up **drip** (Day 3/7/14 + nurture) is driven by `drip-claim`, which
  hands Sami the exact compliance-checked email to send verbatim — she never
  composes her own follow-up copy.

### 4.6 Deci — demo-gen (`demo-gen`), claude_local (Phase 1.5)

"Vantyx's moat made flesh." Turns a high-score lead into a deployed preview
website *before anyone says hello*. Reports to CMO.

- **Hard rule: stops at `stage='demo_built'`. Never sends outreach, never calls
  `notify-cmo-sdr`.** Ryan is the quality gate.
- The current build path is **Lovable** (see §7). Pipeline per lead: pick a
  `score≥65, stage='new'` lead (cap 3/cycle) → re-check live stage (TOCTOU
  guard) → `prompt-fill` → drive the Lovable MCP (`create_project(name=<slug>)` →
  public → `deploy_project`) → compute the branded `<slug>.usevantyx.com` URL →
  `lead-update` to `demo_built` → `demo-smoke-check`. On pass, park it for Ryan's
  morning review; on fail, comment and skip (never post a broken link).
- Idempotent by construction: two stage re-checks (VAN-394 pre-pipeline, VAN-391
  pre-write) plus the `lead-update` write-layer guard prevent re-processing a
  lead another run already shipped.

### 4.7 Quinn — QA (`qa`), claude_local (Phase 1.5)

"The last line between a broken preview and a contractor's first impression — be
paranoid." Reports to CTO. **Note:** QA is part of the *in-house template* quality
regime; under the current Lovable pipeline the QA gate is **dormant** (quality is
enforced inside the Lovable prompt instead — see §10). Its design is retained
because it captures hard-won "honest demo" rules.

- Owns gate **Classes D and E** of a five-class pipeline (A–C are demo-gen's
  build-time checks): **Class D** = brand-consistency (palette delta in LAB + the
  7 non-negotiables; drift >15% rejects); **Class E** = commercial viability /
  sellability (`class-e-gate`, six fail-closed checks: placeholder leakage, owner
  identity, work evidence, sourced ratings, license realism, no-Unsplash-in-trust-slot).
- Is the only path between `demo_built` and `notify-cmo-sdr` in the template
  regime; files the Tier-1 board approval only after D+E both pass.

### 4.8 Dyna — UXDesigner (`ux-designer`), claude_local / Sonnet (Phase 1)

Single source of truth for brand. The agency brand at `shared/brand/vantyx.md` is
read-only foundation; she is the **only** agent allowed to write per-client brand
files (`shared/brand/clients/<slug>.md`). **Also dormant under the Lovable
pipeline** (brand is enforced in the prompt now), but retained.

- "Sites should look like the trucks they own, not the lawyers they hire."
  Mobile-first (test at 375px first), trust signals before sales pitch (license #
  > tagline; real Google reviews > generic testimonials).
- Niche aesthetic notes she maintains: electricians = industrial blues + safety
  yellow; plumbers = navy + white + serif headlines; HVAC = red accents (avoid
  all-blue); roofers = earthy browns + photography-heavy; GCs = most variable.

---

## 5. The mission and the two moats

Vantyx's job is a three-verb loop: **Identify → Demonstrate → Convert.**

### Moat #1 — The Lead Intelligence Engine

Find under-served local contractors automatically and score them, so the company
spends effort only on businesses that genuinely need a new site:

- **Sources:** Google Maps via **SerpAPI** (`gmaps-scrape`), an **Ohio new-LLC
  RSS** feed (newly formed businesses with no web presence yet), and a
  **neglected-website scoring** pass.
- **Scoring:** a **0–100 rubric** run by `lead-score`, which probes each lead's
  existing website (HTTPS status, mobile Lighthouse, last-modified header, SSL
  expiry, and a "looks-like-2012" heuristic) and tags a `site_age_signal`
  (`no-site`, `no-ssl`, `looks-like-2012`, `stale-copyright`, `unreachable`,
  `current`). **Demo threshold = score ≥ 65.** Sub-65 leads are explicitly out of
  scope — they never enter the pipeline.
- A complementary **qualification gate** (`site-qualify`) was added to *disqualify*
  leads that already have a strong modern site (a strong-site lead makes a bad
  "we rebuilt your site" pitch) and TARGET only weak/no-site leads.

### Moat #2 — The "Before We Even Spoke" demo pipeline

The agent **rebuilds the prospect's homepage as a deployed, live preview website
BEFORE the first sales conversation.** The cold-outreach message leads with a
working link to *their own rebuilt site* at `https://<slug>.usevantyx.com`. The
prospect clicks and sees what Vantyx can do for them, personalized, before any
call.

**Why these moats matter:** most "AI web agencies" are one person + ChatGPT + a
template producing low-quality output. Vantyx's edge is **operational scaling via
Paperclip** (a whole org of agents, not one human) **plus deep contractor-niche
knowledge** from Fogle & Sons. The demo-first motion inverts the normal sales
sequence — proof before pitch — and shrinks the prospect's "yes" bar.

---

## 6. The full pipeline, stage by stage

The lead's life is tracked by the `stage` column in SQLite. The canonical
progression and the agent that owns each transition:

| Stage | Meaning | Owner / trigger |
|---|---|---|
| `new` | Scraped + scored, score ≥65, not yet built | SDR (`gmaps-scrape`+`lead-score`) |
| `demo_built` | Live preview deployed + smoke-checked, awaiting Board review | demo-gen |
| (review posted) | Top demos surfaced to Discord + Board approval Issue opened | `morning-demo-review` routine (CMO) |
| (board approved) | Ryan clicked Approve in the Paperclip UI | Board (human gate) |
| `outreach_sent` | Cold email sent with the demo link | SDR, only after approval |
| `replied` / `qualifying` | Prospect responded; classified | SDR (`classify-outreach-reply`) |
| `booked` → `won` | Call booked → retainer signed | (Phase 2; conversion/handoff not yet built) |
| `lost` / `closed_no_interest` / `closed_unsubscribed` | Dead, with reason | SDR/CMO |

**The end-to-end autonomous chain (when fully "hot"):**

1. **Source & score** — `sdr-morning` routine fires weekdays 8am ET; Sami scrapes
   the top 3 queued territories, probes + scores each lead, writes `new` rows.
2. **Build** — `demo-build-watcher` routine (every 15 min) wakes demo-gen, which
   builds Lovable demos for up to 3 `score≥65, new` leads and parks each at
   `demo_built` (+ smoke check). It does **not** send anything.
3. **Surface for review** — `morning-demo-review` routine (7am Mon–Fri) posts the
   top 3 unreviewed demos to Discord `#vantyx-ops` and opens a per-demo "Approve
   demo: <name>" Board approval Issue with the clickable link.
4. **Human gate** — Ryan reviews the live links and approves/rejects each in the
   Paperclip UI. This is the deliberate quality gate.
5. **Send** — the `Outreach on approval` routine (every 10 min, gated) detects
   approved demos and has Sami send the cold email from `sami@usevantyx.com`,
   then stamps `outreach_sent`.
6. **Reply handling** — `sami-inbox-poll` matches replies to threads, classifies
   them, and routes per the table in §11.
7. **Follow-up drip** — `drip-schedule` routine (gated until domain warm-up)
   sends Day 3/7/14 nudges + nurture to non-repliers via `drip-claim`.

Three "morning" routines (Demo-Build watcher, Morning demo review, Outreach on
approval) are **gated (disabled) by default**; flipping their triggers to enabled
turns the autonomous loop on. This staged go-live is the progressive-automation
gate (§3.6) in practice.

### Routines (the cron schedule)

| Routine | Cadence | Assignee | Purpose |
|---|---|---|---|
| `sdr-morning` | Weekdays 8:00 ET | sdr | Scrape + score top-3 queued territories |
| `kpi-rollup-morning` | Weekdays 7:55 ET | ceo | Morning KPI digest (posts to Discord only on >15% delta) |
| `budget-rollup` | Every 6h | cto | Notional burn per agent; nudge at >80%, pause + escalate at ≥100% |
| `demo-build-watcher` | Every 15 min | demo-gen | Build up to 3 demos, park at `demo_built` |
| `morning-demo-review` | Weekdays 7:00 ET | cmo | Surface top-3 demos for Board approval |
| `Outreach on approval` | Every 10 min (gated) | sdr | Send cold email for each Board-approved demo |
| `sami-inbox-poll` | ~Every 15 min | sdr | Detect + classify replies |
| `drip-schedule` | Daily (gated until warm-up) | sdr | Day 3/7/14 + nurture follow-ups |
| `patch-sync-vantyx` | Mondays 9:00 ET | developer | Sync droplet self-patches up to GitHub master |
| `panic-pause-all` | Manual only | cto | Pause every non-CEO agent instantly (kill switch) |

(Routines are **not** importable by the companies-tool — they're created in the
Paperclip UI or via the live API. `.paperclip.yaml` documents them as the source
of intent.)

---

## 7. How demos are actually built — the Lovable pipeline

As of June 2026, Vantyx no longer hand-builds demos from an in-house Next.js
template. Demos are generated by **Lovable** (the AI app builder) via its **MCP
server** (`https://mcp.lovable.dev`, v1 API, OAuth, connected to the demo-gen
agent). Lovable produces a far better site than the retired template, faster.

**The build, step by step (demo-gen):**

1. **`prompt-fill`** — deterministic (no LLM in the write path). Reads the lead
   row, substitutes `{{PLACEHOLDER}}` tokens in `shared/lovable-demo-prompt.md`
   (the master prompt), and writes the finished prompt to
   `/tmp/demos/<slug>/lovable-prompt.txt`. Required fields are `COMPANY_NAME`,
   `PHONE`, `NICHE_LABEL`; missing → exit 2 → skip the lead.
2. **Drive the Lovable MCP:** resolve `workspace_id` → `create_project(name=<slug>)`
   with the filled prompt → `set_project_visibility` **public** →
   `deploy_project`. Lovable publishes at `https://<slug>.lovable.app`.
   - **The project name MUST equal the lead `<slug>`** (e.g. `collier-electric`),
     because the branded URL is derived deterministically from it.
   - There is **no file-export tool** in the Lovable MCP — so demos use Lovable
     hosting; Vantyx does *not* pull source or deploy to Vercel for Lovable demos.
3. **Branded URL (critical):** prospects must never see `lovable.app`. A
   **Cloudflare Worker** (`infra/cloudflare/`) serves
   `https://<slug>.usevantyx.com` by proxying `https://<slug>.lovable.app`. The
   stored/sent link is always the branded `usevantyx.com` form.
4. **`lead-update`** → `stage='demo_built'`, `demo_url=https://<slug>.usevantyx.com`.
5. **`demo-smoke-check`** → confirms the branded URL is live and public (HTTP 200,
   not behind an auth wall). Pass → park for morning review; fail → comment + skip.

**The Lovable demo prompt** (`shared/lovable-demo-prompt.md`) is Ryan's approved
"BlueLine Plumbing" prompt turned into a token template. It instructs Lovable to
build a **frontend-only, fully public, conversion-focused home-services site** —
no Supabase/auth/database/login wall. It bakes in brand and the section structure
(see §8) and, crucially, **data-honesty rules** (see §9): never fabricate a
license number, star rating, or review count; gracefully omit any field marked
`[NOT PROVIDED]`; never print a placeholder token; never use the word "AI" or
emojis.

*(Historical note: the prior pipeline built sites from an in-house component
library `vantyx-web-os` — Next.js 15 + Tailwind v4 + shadcn — deployed to Vercel,
reverse-engineered from the Fogle & Sons site (navy `#1a2238` + gold `#f0a800`).
That whole stack, plus the `template-clone`/`template-fill`/`vercel-deploy`/
`brand-consistency-check` skills and the QA + UXDesigner gates, is **retired but
documented**; "concept rebuild" demos and the honest-placeholder philosophy
carried forward into the Lovable prompt.)*

---

## 8. What the websites look like — structure and non-negotiables

Every Vantyx demo is a **premium, mobile-first, conversion-tuned home-services
site**. The brand voice (`shared/brand/vantyx.md`) is local-first, contractor-not-
software-vendor, "done by Friday" energy, **no jargon, no emojis, and never the
word "AI."** Default feel: clean and trustworthy, blue/white primary palette with
a bold orange accent for CTAs, premium typography (Inter / Plus Jakarta Sans),
generous whitespace, subtle animation.

**Conversion elements (every site):** sticky header with click-to-call + logo +
nav + a prominent "Book Service" button; a hero with a strong headline, dual
"Call Now" + "Schedule Online" CTAs and trust badges; a floating "Call Now" button
on mobile; an above-the-fold emergency banner.

**Section order (every site):**

1. Hero
2. Trust bar — Licensed, Insured, BBB A+, Google rating (if provided), Financing
3. Services grid — niche-appropriate icon cards
4. Why Choose Us — upfront pricing, on-time guarantee, background-checked techs,
   warranty, same-day service
5. How It Works — Book → We Arrive On Time → Problem Solved
6. Testimonials carousel (only if real reviews exist)
7. Service-area list / map of neighborhoods served
8. Financing & offers (default "$50 Off Your First Service")
9. FAQ accordion
10. Final CTA band + contact form (front-end only, success state)
11. Footer — hours, phone, address, license # (if provided), social links

**Technical / SEO:** fully mobile-responsive (home-services traffic is mostly
mobile), fast-loading, WCAG-accessible, semantic HTML, meta tags,
**LocalBusiness + review schema.org JSON-LD**, company name + phone in static
crawlable markup, `tel:` click-to-call everywhere.

**The 7 non-negotiables** (from the agency brand — the in-house QA checklist; the
Lovable prompt enforces the spirit of these): (1) license # + insurance badge
above the fold; (2) mobile tap-to-call in the header; (3) **real** Google reviews
embedded (never fake testimonials); (4) service-area map with explicit ZIPs;
(5) a contact form that delivers to the client's email *and* texts the owner;
(6) schema.org LocalBusiness + Service JSON-LD in the footer; (7) Lighthouse
mobile ≥ 85 before deploy.

---

## 9. The "honest concept demo" philosophy (the most important content rule)

Vantyx demos are pitched to prospects as **honest concepts built from public
data — "built in 20 minutes from your public info, 10 more minutes from finished
if you send a couple photos"** — *not* as finished sites. This is a hard-won rule
(from the VAN-27 audit and the VAN-52 Collier Electric incident) and it governs
how missing data renders:

- **Missing media (owner photo, before/after gallery, logo)** renders as a
  **designed placeholder** — a dashed-border frame at the correct aspect ratio
  with a small icon and a one-line caption ("Your photo goes here — text us one
  selfie and we'll swap it in"). **Never** Unsplash/stock photos in trust slots,
  and **never** silent omission. The placeholder becomes an asset: proof of
  personalization and proof of how the work happens.
- **License #** missing → render the literal labeled placeholder **"License
  verification pending"** (clearly a concept-demo caveat), **never** a raw
  `License #xxxxxxxx` and never styled to look like a verified credential. On a
  positive reply the real number swaps in. (Board decision, the Collier policy.)
- **Testimonials / unsourced star ratings** → **hide entirely** if there's no
  real data. **Never fabricate** reviews or ratings — legal + credibility risk.
  (This is why one V2 design variant was rejected outright: the generator
  invented testimonials.)
- **SDR copy:** use "framed slots" / "where your photos go" — **never** the word
  "placeholder" to a prospect. Lead with the personalized demo URL, support with
  the portfolio link, single "reply yes" CTA, no meeting ask in the first touch.
- **Portfolio is recursive:** the first outreach batch is anchored by Ryan's own
  Fogle & Sons Electric site (`https://www.fogleandsons.com/`); every real shipped
  demo becomes portfolio for the next prospect. No fictional showcase sites.

---

## 10. Quality gates (in-house template regime — currently dormant)

When demos were built in-house, quality ran through a strict **five-class gate**
(a demo only reaches Class N after N-1 passes):

| Class | Owner | Question | Implementation |
|---|---|---|---|
| A | demo-gen | Config generated without missing fields? | `template-fill --require <field>` |
| B | demo-gen | Lead data wired into props correctly? | enrichment-json contract, no silent drops |
| C | demo-gen | Build renders without errors? | `npm run build` exits 0 |
| D | **QA (Quinn)** | Meets the agency brand standard? | `brand-consistency-check` — LAB palette delta + 7 non-negotiables; drift >15% rejects |
| E | **QA (Quinn)** | Is the demo *sellable* (commercially viable)? | `class-e-gate` — 6 fail-closed checks: placeholder leakage, owner identity, work evidence, sourced ratings, license realism, no-Unsplash-in-trust-slot |

Under the **current Lovable pipeline this gate is replaced by two things:** (1)
quality enforced *at generation time* inside `shared/lovable-demo-prompt.md`, and
(2) `demo-smoke-check` (a light "is it live and public" reachability check) plus
**Ryan's human review** in the Paperclip UI as the real quality gate. If demos
drift, the fix is a **prompt edit**, not a per-lead patch.

---

## 11. Sales / outreach pipeline — the approved sequence

The outreach motion (approved 2026-06-04, partially built) is a cold first-touch
that carries the demo URL, then four reply paths plus a drip for non-repliers,
all governed by a permanent suppression list.

**First touch (cold):** sent only after Board approval of that demo. From
`sami@usevantyx.com`, contractor-plain voice, demo URL as the centerpiece,
portfolio link for credibility, a single "reply yes" CTA, no meeting ask. The
salutation uses a confident `first_name` if known, else drops to "Hey" (never
renders an empty/guessed name).

**Reply classification** (`classify-outreach-reply`, two layers — deterministic
detectors override any human label and auto-suppress the reputation-critical
classes):

| Class | What happens |
|---|---|
| `hard_bounce` | Auto-suppressed; lead → `lost`. No send. |
| `soft_bounce` | Marked, **not** suppressed; drip may retry. |
| `complaint` | Auto-suppressed; lead → `lost`; **high-priority Discord alert** to Ryan (reputation event). |
| `unsubscribe` | Auto-suppressed; lead → `closed_unsubscribed`. No reply. |
| `auto_reply` | Out-of-office — not a real reply; no state change, no suppression. |
| `positive` (YES) | Lead → `qualifying`. Today: **alert Ryan, he follows up personally** (auto-reply send is OFF until warm-up go-live). The YES auto-reply (confirm + 2 questions, "Ryan follows up personally," **no** photo ask) lands with build #5. |
| `negative` (NO) | **Full stop** + suppressed as `no_interest`; lead → `closed_no_interest`. **No soft-no email.** |
| `changes` (YES-but-wants-changes) | Its own lane → `qualifying`: capture the edits, alert Ryan, and on his OK rebuild/redeploy the demo via Lovable, then re-engage. |
| `ambiguous` | File a Tier-1 Board approval Issue with the message, the classifier signals, and 3 candidate drafts. Board decides. |

**No-reply drip** (`drip-claim`, clocked off `outreach_sent_at`, gated until
domain warm-up): **Day 3** soft nudge · **Day 7** proof (`DRIP_PROOF_URL`, default
`fogleandsons.com`) · **Day 14** objection (includes the lead's real
`probe_finding` if one exists) → then **nurture** every ~90 days, max 2.
**Lifetime ceiling = 6 touches** (1 cold + 3 drip + 2 nurture). `drip-claim`
applies every guard atomically (suppression, daily cap, recipient-local send
window, lifetime ceiling, CAN-SPAM compliance) and returns the exact email to send
verbatim; Sami never composes follow-up copy.

**Reachability rule (Ryan, 2026-06-04):** every new lead must have an **email OR
phone**, and the pipeline picks the channel accordingly. `gmaps-scrape` returns
phone, not email, so `email-enrich` crawls each lead's site (homepage + contact/
about) for a contact address; leads with no site and no email are email-dead and
need the (future) SMS channel.

**Go-live gates** before the drip can be enabled: reply→lead matching reliable +
bounce/complaint suppression live + domain warmed + DKIM verified-signing (DMARC
already `p=none` monitor).

**Ryan's 7 baked-in outreach decisions:** (1) first_name is a fallback, drop the
salutation if no confident name; (2) "no" = full stop (no soft-no email); (3)
bounce/complaint → auto-suppress; (4) hot-lead alert = Discord (SMS deferred); (5)
combined warm-up daily cap, start ~10–20/day; (6) probe_finding = a real per-lead
scan finding (no-website is the strongest), proof_url = `fogleandsons.com` for the
current all-electrician backlog; (7) the YES auto-reply auto-sends Ryan-approved
drafts.

---

## 12. The leads database (SQLite) — the company's CRM

One table, `leads`, at `/home/paperclip/vantyx-leads.sqlite`, plus a
`suppressions` table. Key columns, grouped by what added them:

- **Core (0001):** `id, company_id, name, phone, email, website, niche, city,
  state, zip, gmaps_rating, review_count, site_lighthouse, site_age_signal,
  score, stage, demo_url, created_at, updated_at`.
- **Demo content (0002):** `license_no, service_area_zips` (JSON),
  `testimonials` (JSON), `gallery` (JSON), `tagline`.
- **Google Business Profile (0003):** `gmaps_place_id`, `gbp_hero_url`,
  `gbp_photos_cache_at` (so the Places API isn't re-billed on every rebuild).
- **Board review (0004):** `review_posted_at` (set when the morning digest posts
  the demo), `board_approved_at` (set when Ryan approves) — drives the human-gate
  handoff without touching the `stage` machine.
- **Reply/suppression (0005):** the **`suppressions`** table (the permanent
  do-not-contact list, keyed by `(value, scope)` so a single address OR a whole
  domain can be blocked; reasons: `unsubscribe | hard_bounce | complaint |
  no_interest | manual`) + `leads.reply_status`, `leads.replied_at`.
- **Drip state (0006):** `drip_step` (0–3), `last_drip_at`, `nurture_count`
  (0–2), `last_nurture_at`.
- **Merge fields (0007):** `first_name` (confident owner name only), `probe_finding`
  (honest website-health finding), `timezone` (IANA, for the send window).

`stage` values: `new | demo_built | outreach_sent | replied | booked | won | lost`
(plus `qualifying`, `closed_no_interest`, `closed_unsubscribed`). `site_age_signal`:
`no-site | no-ssl | looks-like-2012 | stale-copyright | unreachable | current`.

---

## 13. The skills toolchain (the agents' tools)

Custom skills live under `skills/<slug>/` (a `SKILL.md` spec + `run.mjs`
implementation), are added to the company library, then enabled per agent.

**Lead engine**
- `gmaps-scrape` — SerpAPI Google-Maps scrape of a `(zip, radius, niche)`
  territory → `new` rows (dedupe on phone then website). ~$0.01/query. [sdr]
- `lead-score` — applies the 0–100 rubric, runs the website-health probe, writes
  `score` + `site_lighthouse` + `site_age_signal`. Threshold ≥65. [sdr]
- `email-enrich` — crawl a lead's website for a contact email (prefers
  domain-matched role accounts; never clobbers an existing email). [sdr]
- `derive-merge-fields` — deterministically fill `first_name`, `probe_finding`,
  `timezone` from existing columns (honest by construction). [sdr, demo-gen]

**Demo build**
- `prompt-fill` — fill the Lovable prompt template from a lead row (no LLM in the
  write path). [demo-gen]
- `demo-smoke-check` — verify a deployed demo is live + public before review. [demo-gen]
- `lead-update` — single-row stage/field update with allowed-column validation +
  terminal-stage downgrade guard. [demo-gen, sdr, cmo]
- `vercel-deploy` — (retired-path) Vercel `--prod` deploy + URL capture. [demo-gen, developer]

**Outreach / reputation**
- `classify-outreach-reply` — two-layer reply classifier + auto-suppression. [sdr]
- `suppression-check` — read-only "is this address/domain suppressed?" pre-send
  gate. [sdr]
- `suppression-add` — idempotent write to the do-not-contact list. [sdr, cmo]
- `drip-claim` — the drip/nurture safety + scheduling engine (claims a step
  atomically, returns the exact compliant email). [sdr]
- `pending-approved-outreach` — list Board-approved demos still at `demo_built`
  with email, for the on-approval send. [sdr]
- `board-approval-create` — deterministically create an "Approve demo: <name>"
  Issue + a real `request_board_approval` with `payload.leadId`. [cmo]
- `notify-cmo-sdr` — structured "demo ready" Discord post (template-regime). [demo-gen]

**Brand (dormant under Lovable)**
- `brand-extract` — HTTP-scrape a lead's site for logo/palette/fonts/services/NAP. [demo-gen, ux-designer]
- `load-brand` — return agency brand + optional per-client overlay as one payload. [most agents]
- `brand-consistency-check` — Class D gate (LAB palette delta + 7 non-negotiables). [qa, developer]
- `class-e-gate` — Class E commercial-viability gate (6 fail-closed checks). [qa]

**Ops / escalation / governance**
- `escalate-to-board` — the canonical "I need a human" channel (files the Issue +
  fires `board-notify`). [all]
- `board-notify` — Discord/SMS notification primitive (tiers 0/1/2). [all]
- `kpi-rollup` — morning KPI digest; posts to Discord only on >15% delta. [ceo, cto, cmo]
- `patch-sync-vantyx` — weekly sync of in-droplet agent/skill self-patches up to
  GitHub `master` with clean attribution + an audit Issue. [developer]
- Built-ins: `paperclip`, `paperclip-create-agent`, `paperclip-create-plugin`,
  `paperclip-dev`, `paperclip-converting-plans-to-tasks`,
  `diagnose-why-work-stopped`, `para-memory-files`, `terminal-bench-loop`.

**Self-patching note:** agents sometimes fix their own skill code at runtime (e.g.
Sami autonomously patched two SerpAPI bugs in `gmaps-scrape` during the Phase-1
acceptance test). Those patches live in a prompt-cache directory and would be lost
on the next re-import — so `patch-sync-vantyx` exists to propagate them back to
GitHub weekly. Treat an agent self-patch like a draft PR: review, sync, commit.

---

## 14. Marketing, territories, and niches

- **Niches:** electrician (Fogle & Sons home turf — Ryan defers to nobody here),
  plumber, HVAC, roofer, general contractor (`gc`).
- **Phase-1 ZIPs:** Lima OH `45801`, Findlay OH `45840`, Toledo OH `43604`,
  Columbus OH `43215`, Dayton OH `45402` (50-mile radius for the Lima/Findlay
  rows, 30-mile for the metros). Some real leads also came from Florida markets
  (Tampa, Sarasota, Dunedin) via earlier scrapes.
- **Territory queue** (`shared/territories.md`): CMO maintains a markdown table;
  the SDR morning routine reads the top 3 *unscraped* rows, scrapes them, and
  stamps `scraped_at` so the next run advances. CMO only adds a row with a
  confirmed niche, a target metro, and confirmed downstream capacity (no point
  filling the queue if demo-gen is paused or SDR is at SerpAPI quota).
- **Per-niche playbooks** (`shared/playbooks/<niche>.md`): CMO's running A/B log
  of subject lines, response rates, demo-to-call conversion, objections, and
  winning hooks. Winners become the new default; losers are kept for the record.
- **Marketing voice:** specific and numeric, contractor-vernacular, no hype,
  trust signals first. "Built 47 sites for Ohio electricians" beats "Trusted
  nationwide." The agency markets *by doing* — the personalized demo is the ad.

---

## 15. Infrastructure, domains, and secrets

- **Domain / identity:** `usevantyx.com` (Google Workspace). Outbound sales
  mailbox `sami@usevantyx.com` (2SV via Ryan's phone; App Password bound as a
  Paperclip secret). Demos served at `https://<slug>.usevantyx.com` via a
  **Cloudflare Worker** that proxies Lovable hosting.
- **GitHub:** `github.com/Rfog88/vantyx` (the company repo, public, default
  branch `master`). Import to the droplet with
  `npx companies.sh add https://github.com/Rfog88/vantyx/tree/master` (the
  explicit `/tree/<branch>` form is **required** — the shorthand fails with a
  misleading "missing COMPANY.md"; `--collision=skip` is safe for re-imports;
  routines are NOT imported).
- **Secrets** (Paperclip secrets, bound per-agent; never on disk): `SERPAPI_KEY`,
  `GOOGLE_PLACES_API_KEY`, `VERCEL_TOKEN`, `DISCORD_WEBHOOK_URL`,
  `RESEND_API_KEY`, `MAPBOX_TOKEN`, Sami's Gmail App Password, two GitHub PATs
  (a fine-grained one scoped to the web-os repo), and optional `TWILIO_*` for
  Tier-2 SMS. Lovable authenticates via OAuth at the Claude-Code layer on the
  droplet (not a Paperclip secret).
- **Cost-relevant env:** `NODE_OPTIONS=--experimental-sqlite` (project-wide, for
  `node:sqlite`); `LEADS_DB_PATH`; `BOARD_DND_HOURS`; `DRIP_*` config
  (`DRIP_POSTAL_ADDRESS` is **required** before the drip can send — CAN-SPAM
  footer).
- **Persistent memory spine:** the company uses a git-backed `claude-memory` repo
  (the "spine") for cross-machine project state (`projects/vantyx/STATE.md`,
  session logs, shared references). A SessionStart hook (`bootstrap.sh`) auto-
  loads it. Identity is keyed off the git remote, not the launch path.

---

## 16. History — the phases

- **2026-05-23 — Phase 1 shipped.** Board→CEO→C-suite→IC org tree (6 agents) +
  the Lead Intelligence Engine. End-to-end acceptance PASSED on Lima OH 45801,
  50mi, electrician: 19 leads inserted, 5 scored ≥65, total spend ~$1.50 (vs a
  $15 ceiling). Subscription mode confirmed. Sami autonomously self-patched two
  SerpAPI bugs — the moment that motivated `patch-sync-vantyx`.
- **2026-05-24 — Phase 1.5 shipped.** Added demo-gen + QA. The `demo-build-watcher`
  cron ran the full pipeline for 3 leads and all 3 preview URLs landed in Discord
  — validating the "Before We Even Spoke" thesis end-to-end. First agent-driven
  GitHub push (Dexter, VAN-12). Domain corrected to `usevantyx.com`.
- **Late May — pipeline hardening.** The VAN-27 audit + VAN-52 Collier incident
  produced the honest-concept-demo philosophy and the progressive-automation
  gate. GBP enrichment (`place-enrich`) and the `site-qualify` TARGET/DISQUALIFY
  gate were added; strong-site leads (Brandon/Green Light/Collier) were correctly
  reclassified as `lost`. Snapshot 2026-05-29: 38 leads → 11 scored ≥65 → 9 demos
  → 6 outreach sent → 1 reply.
- **Early June — the website-quality overhaul + the Lovable pivot.** An in-house
  "house style" design system (`vantyx-web-os`, navy+gold, reverse-engineered from
  the Fogle & Sons site, via a Google Stitch → DESIGN.md → Claude Code workflow)
  was built and proven by hand (e.g. `vantyx-led.vercel.app` rendering real Google
  reviews + hero photo). But wiring it into the autonomous pipeline hit three
  independent breaks (split-brain git history, no skill invoked the new generator,
  a `SiteConfig`↔`SiteContent` contract mismatch). **Decision: adopt Lovable
  instead** — it produces better sites faster, with quality enforced in the prompt.
  The in-house template stack, plus the QA + UXDesigner gates, were retired (but
  documented). The outreach follow-up sequence was approved 2026-06-04 and is
  partly built (classifier + suppression + on-approval send proven end-to-end on a
  throwaway test lead).

---

## 17. Current status and open work (as of early June 2026)

**Working / proven:** the org + 8 agents; the Lead Intelligence Engine (sourcing +
scoring); the Lovable demo build → branded URL → smoke-check; the morning review +
Board-approval flow; the on-approval autonomous send (proven end-to-end on a test
lead); reply classification + permanent suppression; the escalation system; the
subscription cost model.

**Gated by design (flip to go live):** the three demo/outreach routines (Demo-Build
watcher, Morning demo review, Outreach on approval) and the drip schedule are
disabled until Ryan turns warm-up on — the progressive-automation gate in action.
Most agent heartbeats are deliberately OFF pre-launch; the company is currently
Board-gated and routine-driven, not fully self-running.

**Open last-mile items:** finish the outreach build order (classifier expansion →
bounce/complaint suppression → drip engine → merge-field layer → warm-up enable);
an email-finder API (Hunter/Apollo) for the website leads that only expose contact
forms; an SMS channel for no-email leads; DKIM propagation + domain warm-up before
enabling the drip; and the not-yet-built **conversion / sales-handoff** stage
(turning a booked call into a signed retainer — Stage 11, no mechanism yet).

**The one-sentence summary for NotebookLM:** *Vantyx is a fleet of named AI agents,
running as an org inside Paperclip on a DigitalOcean droplet, that finds neglected
Ohio home-services contractors, rebuilds their website as a live personalized
preview with Lovable before any sales call, and — once Ryan approves each demo —
sends honest, contractor-plain cold outreach that converts those previews into web
projects and recurring retainers, all on flat-rate AI subscriptions rather than
per-token API spend.*
