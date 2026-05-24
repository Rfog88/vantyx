-- REFERENCE ONLY — not auto-applied.
--
-- Vantyx Phase 1 uses SQLite (node:sqlite) for the leads table, not
-- Paperclip's embedded Postgres. The skills (gmaps-scrape, lead-score,
-- kpi-rollup) create the table idempotently via CREATE TABLE IF NOT EXISTS
-- on every run, so no migration step is required.
--
-- This file is the canonical SCHEMA REFERENCE in case we ever migrate to a
-- real Postgres later (e.g., for Phase 2 multi-machine deployment).

-- Postgres syntax (reference):
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  name TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  niche TEXT,                       -- electrician | plumber | hvac | roofer | gc
  city TEXT,
  state TEXT,
  zip TEXT,
  gmaps_rating NUMERIC,
  review_count INT,
  site_lighthouse INT,
  site_age_signal TEXT,             -- "looks-like-2012" | "no-ssl" | "current" | "no-site" | "stale-copyright" | "unreachable"
  score INT,
  stage TEXT DEFAULT 'new',         -- new | demo_built | outreach_sent | replied | booked | won | lost
  demo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_stage_score_idx ON leads(stage, score);
CREATE INDEX IF NOT EXISTS leads_niche_zip_idx   ON leads(niche, zip);
CREATE INDEX IF NOT EXISTS leads_updated_at_idx  ON leads(updated_at DESC);

-- SQLite equivalent (what the skills actually create at runtime):
--
-- CREATE TABLE IF NOT EXISTS leads (
--   id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
--   company_id TEXT,
--   name TEXT, phone TEXT, email TEXT, website TEXT,
--   niche TEXT, city TEXT, state TEXT, zip TEXT,
--   gmaps_rating REAL, review_count INTEGER,
--   site_lighthouse INTEGER, site_age_signal TEXT,
--   score INTEGER,
--   stage TEXT DEFAULT 'new',
--   demo_url TEXT,
--   created_at TEXT DEFAULT (datetime('now')),
--   updated_at TEXT DEFAULT (datetime('now'))
-- );
-- CREATE INDEX IF NOT EXISTS leads_stage_score_idx ON leads(stage, score);
-- CREATE INDEX IF NOT EXISTS leads_niche_zip_idx   ON leads(niche, zip);
-- CREATE INDEX IF NOT EXISTS leads_updated_at_idx  ON leads(updated_at DESC);
