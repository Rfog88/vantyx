-- Vantyx — Lead Intelligence Engine storage
-- See plan Section 3 for the scoring rubric and source-of-truth field semantics.

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,                  -- prospect's business identifier (place_id-derived UUID)
  name TEXT,                        -- legal / GBP name
  phone TEXT,
  email TEXT,
  website TEXT,                     -- current site URL or NULL
  niche TEXT,                       -- electrician | plumber | hvac | roofer | gc
  city TEXT,
  state TEXT,
  zip TEXT,
  gmaps_rating NUMERIC,             -- 0.0 to 5.0
  review_count INT,                 -- GBP review count
  site_lighthouse INT,              -- 0-100 mobile score; NULL if no site
  site_age_signal TEXT,             -- "looks-like-2012" | "no-ssl" | "current" | "no-site"
  score INT,                        -- 0-100, see plan Section 3 rubric
  stage TEXT DEFAULT 'new',         -- new | demo_built | outreach_sent | replied | booked | won | lost
  demo_url TEXT,                    -- populated by demo-gen when preview is deployed
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_stage_score_idx ON leads(stage, score);
CREATE INDEX IF NOT EXISTS leads_niche_zip_idx   ON leads(niche, zip);
CREATE INDEX IF NOT EXISTS leads_updated_at_idx  ON leads(updated_at DESC);
