-- Build #2 — reply classification + bounce/complaint auto-suppression.
--
-- Two pieces land here:
--
-- 1. `suppressions` — the durable do-not-contact list. This is the
--    reputation-critical guard. The outreach send path checks it BEFORE every
--    send (GLOBAL RULE in VANTYX-OUTREACH-SEQUENCE.md), so a lead that
--    unsubscribed, hard-bounced, complained, or said "no" can never be emailed
--    again — even if the same business is re-scraped later as a brand-new lead
--    row (the lead `stage` machine alone can't protect against that; a fresh
--    row starts at stage='new'). Keyed by (value, scope) so we can suppress a
--    single address OR a whole domain (e.g. a domain-wide spam complaint).
--
-- 2. `leads.reply_status` / `leads.replied_at` — the per-lead reply outcome the
--    classifier writes (positive | negative | changes | ambiguous | unsubscribed
--    | bounced | soft_bounce | complaint | auto_reply). AGENTS.md already
--    referenced these columns but they never existed; the SDR's reply-handling
--    lead-update calls were silently no-ops. This adds them for real.
--
-- Idempotency contract:
--   - The CREATE TABLE/INDEX use IF NOT EXISTS — re-running is harmless, and we
--     never want a half-applied migration to risk the suppression list.
--   - The two ALTERs follow the house style of 0001-0004: plain ADD COLUMN with
--     no IF NOT EXISTS (SQLite has none). Re-running on an already-migrated DB
--     errors on the first duplicate ALTER. That is intended — it forces an
--     operator to check state rather than silently double-apply.

CREATE TABLE IF NOT EXISTS suppressions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  value             TEXT NOT NULL,                       -- normalized lowercase email (scope=email) or domain (scope=domain)
  scope             TEXT NOT NULL DEFAULT 'email',       -- 'email' | 'domain'
  reason            TEXT NOT NULL,                       -- unsubscribe | hard_bounce | complaint | no_interest | manual
  lead_id           TEXT,                                -- lead row that triggered it (nullable)
  source_message_id TEXT,                                -- inbound message id that triggered it (nullable)
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(value, scope)
);

CREATE INDEX IF NOT EXISTS suppressions_value_idx  ON suppressions(value);
CREATE INDEX IF NOT EXISTS suppressions_domain_idx ON suppressions(scope, value);

ALTER TABLE leads ADD COLUMN reply_status TEXT;   -- positive|negative|changes|ambiguous|unsubscribed|bounced|soft_bounce|complaint|auto_reply
ALTER TABLE leads ADD COLUMN replied_at   TEXT;   -- ISO-8601 UTC timestamp of the inbound reply/bounce
