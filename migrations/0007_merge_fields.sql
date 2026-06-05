-- Build #4 — merge-field data layer.
--
-- Per-lead content the outreach/drip templates merge in. Populated by the
-- `derive-merge-fields` skill from data already on the lead row.
--
--   first_name     Confident owner first name ONLY (spec decision #1). NULL = drop the
--                  salutation entirely ("Hey — …"); never render a literal "{{first_name}}".
--   probe_finding  A REAL, honest website-health observation phrased for the owner
--                  (spec decision #6). Derived from site_age_signal / site_quality_verdict /
--                  website presence. The no-website case is the strongest finding. NULL when
--                  no credible finding exists (e.g. the site is genuinely current/strong) —
--                  Day-14 then omits the finding clause. Never fabricated.
--   timezone       IANA tz for the recipient-local send window, from state + zip
--                  (Eastern default; FL panhandle and NW-Indiana resolve to Central).
--                  NULL → drip-claim falls back to DRIP_TIMEZONE.
--
-- House idempotency contract (matches 0001-0006): plain ADD COLUMN, no IF NOT EXISTS.

ALTER TABLE leads ADD COLUMN first_name    TEXT;
ALTER TABLE leads ADD COLUMN probe_finding TEXT;
ALTER TABLE leads ADD COLUMN timezone      TEXT;
