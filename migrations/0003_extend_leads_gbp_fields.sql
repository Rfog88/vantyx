-- VAN-54 / VAN-37.1 — add Google Business Profile (GBP) fields to leads.
--
-- Three new nullable columns to support the Places API integration in
-- template-fill (hero photo + gallery + cached photo URLs so we are not
-- re-billing Places API on every rebuild).
--
-- Idempotent contract matches 0001: re-running on a partially-migrated DB
-- will error on the first duplicate ALTER (SQLite has no ADD COLUMN IF NOT
-- EXISTS). That is desired — forces an operator to check state.
--
-- Column shapes:
--   gmaps_place_id        TEXT  — Places API place_id, e.g. "ChIJ...". Source-of-truth for the GBP fetch.
--   gbp_hero_url          TEXT  — Cached resolved photoUri for hero slot.
--   gbp_photos_cache_at   TEXT  — ISO-8601 UTC timestamp of last successful Places photo fetch. NULL = never fetched.

ALTER TABLE leads ADD COLUMN gmaps_place_id TEXT;
ALTER TABLE leads ADD COLUMN gbp_hero_url TEXT;
ALTER TABLE leads ADD COLUMN gbp_photos_cache_at TEXT;
