# Vantyx — Territory Queue

CMO maintains this queue. Sdr's morning routine reads the top 3 unscraped rows
each weekday. After scraping, sdr appends `scraped_at` so the next run picks
the next unscraped rows.

## Schema

| zip   | niche       | radius_mi | scraped_at | last_yield |
|-------|-------------|-----------|------------|------------|
| 45801 | electrician | 50        |            |            |
| 45801 | plumber     | 50        |            |            |
| 45801 | hvac        | 50        |            |            |
| 45801 | roofer      | 50        |            |            |
| 45801 | gc          | 50        |            |            |
| 45840 | electrician | 50        |            |            |
| 45840 | plumber     | 50        |            |            |
| 43604 | electrician | 30        |            |            |
| 43604 | plumber     | 30        |            |            |
| 43215 | electrician | 30        |            |            |
| 43215 | hvac        | 30        |            |            |
| 45402 | electrician | 30        |            |            |

## Niches

- `electrician` — Fogle & Sons home turf; Ryan defers on judgement
- `plumber`
- `hvac`
- `roofer`
- `gc` — general contractor

## ZIPs in scope (Phase 1)

- `45801` — Lima, OH
- `45840` — Findlay, OH
- `43604` — Toledo, OH
- `43215` — Columbus, OH
- `45402` — Dayton, OH

## Adding territories

CMO appends rows. Do NOT add a row without (a) a confirmed niche, (b) a target
metro Vantyx wants to serve, and (c) clear capacity downstream — if `demo-gen`
is paused or sdr is at SerpAPI quota, queue fills uselessly.
