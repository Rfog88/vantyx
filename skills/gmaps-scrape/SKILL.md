---
schema: agentcompanies/v1
kind: skill
name: gmaps-scrape
description: Scrape Google Maps Places for local businesses in a (zip, radius, niche) territory and write rows to the Vantyx leads table.
metadata:
  requires_env:
    - SERPAPI_KEY
    - DATABASE_URL    # set by Paperclip's embedded Postgres bridge
  implementation: skills/gmaps-scrape/run.mjs
  cost_per_call_usd: 0.01   # SerpAPI Developer plan
  primary_users: [sdr]
---

# gmaps-scrape

Pull local businesses from Google Maps via SerpAPI's `google_maps` engine,
normalize the results, and insert into the `leads` table at `stage='new'`.
Dedupe on (phone) then (website).

## When to use

- Morning routine for the `sdr` agent (weekday 8am ET).
- Ad-hoc territory requests routed from CMO to sdr.

## When NOT to use

- For agents other than sdr (cost discipline — keep scraping centralized).
- For sub-65 score backfill (scoring is downstream of this skill).
- When today's SerpAPI spend is >$5 — throttle or pause.

## Inputs

```json
{
  "zip": "45801",
  "radius_miles": 50,
  "niche": "electrician"
}
```

Accepted niches: `electrician`, `plumber`, `hvac`, `roofer`, `gc` (general contractor).

## Outputs

- Rows inserted into `leads` table with: name, phone, email (if available),
  website, niche, city, state, zip, gmaps_rating, review_count,
  site_lighthouse (NULL — populated by `lead-score`), site_age_signal (NULL),
  score (NULL), stage='new'.
- Stdout: JSON summary `{scraped: N, inserted: M, duplicates: D, errors: E}`.

## Implementation

Node ESM script at `skills/gmaps-scrape/run.mjs`. Calls SerpAPI's
`https://serpapi.com/search.json` with `engine=google_maps`. Reads
`SERPAPI_KEY` from env (bound per plan Section 12 step "Bind to an agent").

## Failure modes

- `401/403`: bad key → Tier 2 `api-key-missing`.
- `429`: rate-limited → Tier 1 `external-quota-exceeded` with the reset window.
- Empty results: try wider radius once; if still empty, escalate Tier 1
  `adapter-broken`.
