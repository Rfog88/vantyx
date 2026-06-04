-- Add Board-review / approval tracking fields to leads.
--
-- The Lovable demo pipeline builds a demo and parks the lead at
-- stage='demo_built'. It does NOT send outreach. The `morning-demo-review`
-- routine (7am Mon-Fri) posts the top 3 unreviewed demos to Discord for the
-- Board (Ryan) to approve in the Paperclip UI; only on approval does the SDR
-- send outreach. These two columns drive that handoff without touching the
-- existing `stage` machine:
--
--   review_posted_at    set when the morning digest posts the demo link to
--                       Discord + opens the Board approval Issue. The digest
--                       selects `stage='demo_built' AND review_posted_at IS NULL`
--                       so a demo is never posted twice.
--   board_approved_at   set when Ryan approves and the SDR fires outreach. An
--                       audit trail of when the human gate was cleared.
--
-- Idempotent contract matches 0001/0002/0003: re-running on a partially-
-- migrated DB will error on the first duplicate ALTER (SQLite has no
-- ADD COLUMN IF NOT EXISTS). That is desired — forces an operator to check
-- state.
--
-- Column shapes:
--   review_posted_at    TEXT  — ISO-8601 UTC timestamp. NULL = not yet posted for review.
--   board_approved_at   TEXT  — ISO-8601 UTC timestamp. NULL = not yet approved.

ALTER TABLE leads ADD COLUMN review_posted_at TEXT;
ALTER TABLE leads ADD COLUMN board_approved_at TEXT;
