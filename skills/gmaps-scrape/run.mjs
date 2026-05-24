#!/usr/bin/env node
// gmaps-scrape — SerpAPI google_maps → Vantyx leads SQLite store.
// Storage: node:sqlite (requires Node 22.5+ and NODE_OPTIONS=--experimental-sqlite
//          OR run node with --experimental-sqlite flag).
//
// Invocation: node skills/gmaps-scrape/run.mjs --zip 45801 --radius 50 --niche electrician

import { parseArgs } from "node:util";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (e) {
  console.error(JSON.stringify({
    error: "adapter-broken",
    reason: "node_sqlite_unavailable",
    detail: "Bind NODE_OPTIONS=--experimental-sqlite at project or agent env level. node:sqlite is experimental in Node 22.x.",
    message: e.message,
  }));
  process.exit(3);
}

const NICHE_QUERIES = {
  electrician: "electrician",
  plumber: "plumber",
  hvac: "HVAC contractor",
  roofer: "roofer",
  gc: "general contractor",
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    company_id TEXT,
    name TEXT,
    phone TEXT,
    email TEXT,
    website TEXT,
    niche TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    gmaps_rating REAL,
    review_count INTEGER,
    site_lighthouse INTEGER,
    site_age_signal TEXT,
    score INTEGER,
    stage TEXT DEFAULT 'new',
    demo_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS leads_stage_score_idx ON leads(stage, score);
  CREATE INDEX IF NOT EXISTS leads_niche_zip_idx  ON leads(niche, zip);
  CREATE INDEX IF NOT EXISTS leads_updated_at_idx ON leads(updated_at DESC);
`;

function openDb() {
  const path = process.env.LEADS_DB_PATH || "/home/paperclip/vantyx-leads.sqlite";
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

async function main() {
  const { values } = parseArgs({
    options: {
      zip: { type: "string" },
      radius: { type: "string", default: "50" },
      niche: { type: "string" },
    },
  });

  const { zip, radius, niche } = values;
  if (!zip || !niche) {
    console.error("usage: --zip <z> --radius <mi> --niche <slug>");
    process.exit(2);
  }
  if (!NICHE_QUERIES[niche]) {
    console.error(`unknown niche: ${niche}. accepted: ${Object.keys(NICHE_QUERIES).join(", ")}`);
    process.exit(2);
  }

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.error(JSON.stringify({ error: "api-key-missing", service: "serpapi" }));
    process.exit(3);
  }

  // SerpAPI google_maps engine wants either `ll=@lat,lng,zoom_level` (true GPS)
  // OR `location=<place>` (string). Zip codes work as `location`. Pair with `z`
  // (zoom level) where ~50mi maps to z=10. See Sami's patch notes on VAN-1.
  const query = NICHE_QUERIES[niche];
  const r = parseInt(radius, 10);
  const zoom = r <= 5 ? 14 : r <= 15 ? 12 : r <= 30 ? 11 : r <= 60 ? 10 : 9;
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("q", query);
  url.searchParams.set("location", zip);
  url.searchParams.set("z", String(zoom));
  url.searchParams.set("type", "search");
  url.searchParams.set("api_key", apiKey);

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 401 || res.status === 403) {
    console.error(JSON.stringify({ error: "api-key-missing", status: res.status }));
    process.exit(3);
  }
  if (res.status === 429) {
    console.error(JSON.stringify({ error: "external-quota-exceeded", service: "serpapi", status: 429 }));
    process.exit(4);
  }
  if (!res.ok) {
    console.error(JSON.stringify({ error: "adapter-broken", service: "serpapi", status: res.status }));
    process.exit(5);
  }

  const data = await res.json();
  const places = data.local_results || [];

  const db = openDb();
  const dupCheck = db.prepare(
    "SELECT 1 FROM leads WHERE (phone = ? AND ? <> '') OR (website = ? AND ? <> '') LIMIT 1"
  );
  const insert = db.prepare(`
    INSERT INTO leads (name, phone, website, niche, city, state, zip, gmaps_rating, review_count, stage)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
  `);

  let scraped = places.length;
  let inserted = 0;
  let duplicates = 0;
  let errors = 0;

  for (const p of places) {
    const phone = (p.phone || "").replace(/\D/g, "");
    const website = (p.website || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!phone && !website) { errors++; continue; }

    const dup = dupCheck.get(phone, phone, website, website);
    if (dup) { duplicates++; continue; }

    // SerpAPI address formats vary: "1234 Main St, Lima, OH 45801",
    // "Lima, OH 45801", or sometimes without ZIP. City is the segment
    // immediately before "STATE ZIP". (Sami flagged the old slice(-3,-2)
    // logic as misaligned on VAN-1.)
    const addr = p.address || "";
    const parts = addr.split(",").map(s => s.trim()).filter(Boolean);
    const lastPart = parts[parts.length - 1] || "";
    const stateZipMatch = lastPart.match(/^([A-Z]{2})(?:\s+\d{5})?$/);
    const state = stateZipMatch ? stateZipMatch[1] : null;
    const city = state && parts.length >= 2 ? parts[parts.length - 2] : null;

    try {
      insert.run(
        p.title || null,
        phone || null,
        website || null,
        niche,
        city,
        state,
        zip,
        p.rating || null,
        p.reviews || null
      );
      inserted++;
    } catch (e) {
      errors++;
    }
  }

  db.close();

  console.log(JSON.stringify({ scraped, inserted, duplicates, errors, zip, niche, db: process.env.LEADS_DB_PATH || "/home/paperclip/vantyx-leads.sqlite" }));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
