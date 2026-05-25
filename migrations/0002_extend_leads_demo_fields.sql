-- VAN-42 / VAN-35.1 — add demo-data fields the template-fill skill needs.
--
-- Five new nullable columns on `leads`. JSON-encoded TEXT for the array
-- shapes; no separate row-per-item tables, to keep the writer pipe a single
-- SELECT. `leads_van16_backup` is left untouched (per VAN-42 scope).
--
-- Idempotent: each ALTER is followed by a SELECT against the column so a
-- re-run on a partially-migrated DB fails loud rather than silently dropping
-- through. SQLite has no `ADD COLUMN IF NOT EXISTS` — running this twice on
-- the same DB will error on the first duplicate ALTER, which is the desired
-- behavior (forces an operator to check state).
--
-- Column shapes:
--   license_no          TEXT     — single string, e.g. "EC.0010234"
--   service_area_zips   TEXT     — JSON array of strings (5-digit zips)
--   testimonials        TEXT     — JSON array of { author, location?, body, rating?: number }
--   gallery             TEXT     — JSON array of { before, after, caption? } (URLs)
--   tagline             TEXT     — short marketing tagline string

ALTER TABLE leads ADD COLUMN license_no TEXT;
ALTER TABLE leads ADD COLUMN service_area_zips TEXT;
ALTER TABLE leads ADD COLUMN testimonials TEXT;
ALTER TABLE leads ADD COLUMN gallery TEXT;
ALTER TABLE leads ADD COLUMN tagline TEXT;
