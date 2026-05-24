#!/usr/bin/env node
// lead-score — apply the Vantyx 0–100 rubric to leads.
// Reads `score IS NULL` rows, runs a website-health probe, writes back score
// + site_lighthouse + site_age_signal.
//
// Storage: node:sqlite (requires NODE_OPTIONS=--experimental-sqlite on Node 22.x).
//
// Invocation: node skills/lead-score/run.mjs [--limit 100] [--rescore]

import { parseArgs } from "node:util";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (e) {
  console.error(JSON.stringify({
    error: "adapter-broken",
    reason: "node_sqlite_unavailable",
    detail: "Bind NODE_OPTIONS=--experimental-sqlite at project or agent env level.",
    message: e.message,
  }));
  process.exit(3);
}

const TARGET_METROS = new Set([
  "lima", "findlay", "toledo", "columbus", "dayton",
]);

const LOCAL_AREA_CODES = new Set([
  "419", "567",        // NW Ohio (Lima)
  "614", "380",        // Columbus
  "937",               // Dayton
  "330", "234",        // NE Ohio
]);

const NICHE_SET = new Set(["electrician", "plumber", "hvac", "roofer", "gc"]);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    company_id TEXT,
    name TEXT, phone TEXT, email TEXT, website TEXT,
    niche TEXT, city TEXT, state TEXT, zip TEXT,
    gmaps_rating REAL, review_count INTEGER,
    site_lighthouse INTEGER, site_age_signal TEXT,
    score INTEGER,
    stage TEXT DEFAULT 'new',
    demo_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`;

function openDb() {
  const path = process.env.LEADS_DB_PATH || "/home/paperclip/vantyx-leads.sqlite";
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

async function probeWebsite(url) {
  if (!url) return { lighthouse: null, age_signal: "no-site", has_ssl: false };
  const fullUrl = url.startsWith("http") ? url : `https://${url}`;
  try {
    const res = await fetch(fullUrl, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
    const hasSsl = fullUrl.startsWith("https://") && res.ok;
    const html = await res.text();
    let age_signal = "current";
    if (/<center>|<table[^>]*cellpadding/i.test(html)) age_signal = "looks-like-2012";
    if (!/<meta[^>]*viewport/i.test(html)) age_signal = "looks-like-2012";
    const copyrightMatch = html.match(/©|copyright[^0-9]*(\d{4})/i);
    if (copyrightMatch && parseInt(copyrightMatch[1] || "0") < 2022) age_signal = "stale-copyright";
    if (!hasSsl) age_signal = "no-ssl";
    return { lighthouse: null, age_signal, has_ssl: hasSsl };
  } catch (e) {
    return { lighthouse: null, age_signal: "unreachable", has_ssl: false };
  }
}

function scoreOne({ gmaps_rating, review_count, niche, city, site_lighthouse, site_age_signal, phone, has_ssl, has_site, review_age_months }) {
  let s = 0;
  if (gmaps_rating >= 4.0 && review_count >= 20) s += 25;
  if (!has_site || (site_lighthouse !== null && site_lighthouse < 50)) s += 20;
  if (NICHE_SET.has(niche)) s += 15;
  if (city && TARGET_METROS.has(city.toLowerCase())) s += 10;
  if (site_age_signal === "stale-copyright" || site_age_signal === "no-ssl" || site_age_signal === "looks-like-2012") s += 15;
  const areaCode = (phone || "").substring(0, 3);
  if (LOCAL_AREA_CODES.has(areaCode)) s += 10;
  if (review_age_months > 0 && review_count / review_age_months >= 1) s += 5;
  return Math.min(s, 100);
}

async function main() {
  const { values } = parseArgs({
    options: { limit: { type: "string", default: "100" }, rescore: { type: "boolean", default: false } },
  });

  const limit = parseInt(values.limit, 10);
  const rescore = values.rescore;

  const db = openDb();

  const where = rescore
    ? "stage = 'new'"
    : "stage = 'new' AND score IS NULL";
  const rows = db.prepare(`SELECT * FROM leads WHERE ${where} LIMIT ?`).all(limit);

  const update = db.prepare(
    "UPDATE leads SET score = ?, site_lighthouse = ?, site_age_signal = ?, updated_at = datetime('now') WHERE id = ?"
  );

  let scored = 0, high_score = 0, sub65 = 0, no_site = 0;

  for (const r of rows) {
    const has_site = !!r.website;
    const probe = await probeWebsite(r.website);
    if (!has_site) no_site++;
    const score = scoreOne({
      gmaps_rating: r.gmaps_rating || 0,
      review_count: r.review_count || 0,
      niche: r.niche,
      city: r.city,
      site_lighthouse: probe.lighthouse,
      site_age_signal: probe.age_signal,
      phone: r.phone,
      has_ssl: probe.has_ssl,
      has_site,
      review_age_months: 12,    // placeholder; Phase 2 will pull true GBP review history
    });

    update.run(score, probe.lighthouse, probe.age_signal, r.id);

    scored++;
    if (score >= 65) high_score++;
    else sub65++;
  }

  db.close();
  console.log(JSON.stringify({ scored, high_score, sub65, no_site, db: process.env.LEADS_DB_PATH || "/home/paperclip/vantyx-leads.sqlite" }));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
