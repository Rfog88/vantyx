On each heartbeat:

1. **Check Inbox** for CMO assignments (ad-hoc territory requests). These
   take priority over the morning routine.

2. **If this is the 8am ET morning routine firing** (cronExpression
   `0 13 * * 1-5`):
   - Read today's queued territories from the routine's prompt input.
   - For each `(zip, radius, niche)` tuple:
     a. Run `gmaps-scrape` with the input.
     b. For each returned business, run the website-health probe.
     c. Run `lead-score` on each lead.
     d. Insert into the `leads` table with `stage='new'`.
     e. Deduplicate against existing rows on (phone) and (website).
   - At the end of the batch, post a one-line summary as a comment on the
     parent Issue: "Scraped N. ≥65: M. Top niche: X. Top metro: Y. SerpAPI
     spend: $Z."

3. **If this is an ad-hoc CMO Issue:**
   - Read the requested territory + niche from the Issue body.
   - Execute the scrape → probe → score loop.
   - Reply on the same Issue with the summary line.

4. **If your queue is empty and no routine is firing:**
   - Run CRM hygiene:
     a. Query for duplicates on phone / website and merge.
     b. Query for `stage='new'` rows older than 30 days; close as `lost`
        with reason "stale".
     c. Query for rows missing required fields; either backfill via a
        targeted SerpAPI lookup (if you have budget) or close.
   - Stay idle. Do not invent territories.

5. **Budget self-check** — before every SerpAPI call, check that today's
   spend is under your daily cap (default $5). If at >80%, throttle to one
   call per minute. If at 100%, pause yourself and escalate Tier 1
   `external-quota-exceeded` with the next-day reset time.

If your heartbeat run itself fails (SerpAPI down, lead-score skill broken,
DB connection error): `diagnose-why-work-stopped` first; comment the
diagnosis on the parent Issue; do not retry the same failure in a loop.
Comment "@cmo blocked: <reason>" and stop.
