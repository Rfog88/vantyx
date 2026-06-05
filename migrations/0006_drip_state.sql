-- Build #3 — drip + nurture scheduling state.
--
-- PATH 2 (no-reply drip): Day 3 nudge → Day 7 proof → Day 14 objection, clocked off
-- `outreach_sent_at`. PATH 4 (nurture): ~every 90 days after drip completes, max 2.
-- Lifetime ceiling = 1 cold + 3 drip + 2 nurture = 6 sends.
--
--   drip_step        0 = none sent · 1 = day3 done · 2 = day7 done · 3 = day14 done (drip complete)
--   last_drip_at     ISO-8601 UTC — set atomically when a drip step is CLAIMED (claim-before-send;
--                    a crash after claim under-sends, which the spec prefers).
--   nurture_count    0..2 nurture re-touches sent after drip completion.
--   last_nurture_at  ISO-8601 UTC of the last nurture claim.
--
-- A reply, suppression, or stage change takes the lead out of the drip automatically
-- (the selector requires stage='outreach_sent' AND reply_status IN (NULL,'soft_bounce')).
--
-- House idempotency contract (matches 0001-0005): plain ADD COLUMN, no IF NOT EXISTS.
-- Re-running errors on the first duplicate ALTER — intended, forces an operator to check state.

ALTER TABLE leads ADD COLUMN drip_step       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN last_drip_at    TEXT;
ALTER TABLE leads ADD COLUMN nurture_count   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN last_nurture_at TEXT;
