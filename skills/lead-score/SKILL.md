---
schema: agentcompanies/v1
kind: skill
name: lead-score
description: Apply the Vantyx 0–100 lead-scoring rubric to leads with stage='new' and missing scores; update site_lighthouse and site_age_signal in the process.
metadata:
  requires_env:
    - DATABASE_URL
  implementation: skills/lead-score/run.mjs
  primary_users: [sdr]
---

# lead-score

Score every lead in the `leads` table where `score IS NULL` per the plan
Section 3 rubric. Runs the website-health probe (HTTPS, mobile Lighthouse,
last-modified, SSL expiry, "looks-like-2012" heuristic) as part of the score
calculation. Demo threshold: ≥65.

## When to use

- Immediately after `gmaps-scrape` in the sdr morning routine.
- Ad-hoc rescoring when CMO tunes the rubric (rerun on all `stage='new'`).

## When NOT to use

- On leads already at `stage` other than `new` — they're past scoring.
- Without `gmaps-scrape` having run first — the inputs aren't there.

## Inputs

```json
{
  "limit": 100,                // max leads to score this run (cost guard)
  "rescore": false             // if true, also rescore where score IS NOT NULL
}
```

## Outputs

- Updates `score`, `site_lighthouse`, `site_age_signal` columns on the leads.
- Stdout: JSON summary `{scored: N, high_score: M, sub65: K, no_site: S}`.

## Rubric (locked from plan Section 3)

| Signal                                          | Points |
|-------------------------------------------------|--------|
| GBP rating 4.0+ AND review_count ≥ 20           | +25    |
| Lighthouse mobile <50 OR no website             | +20    |
| Niche match (electrician/plumber/hvac/roofer/gc)| +15    |
| Target metro (Lima/Findlay/Toledo/Columbus/Dayton)| +10  |
| Site copyright <2022 OR no SSL                  | +15    |
| Local area code in phone                        | +10    |
| Review velocity ≥1/mo (review_count / months)   | +5     |

Cap: 100. Demo build threshold: ≥65.
