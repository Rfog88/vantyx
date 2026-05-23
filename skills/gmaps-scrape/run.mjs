#!/usr/bin/env node
// gmaps-scrape — SerpAPI google_maps → Vantyx leads table.
// Invocation: node skills/gmaps-scrape/run.mjs --zip 45801 --radius 50 --niche electrician
//
// STATUS: scaffolded. The SerpAPI call + DB insert path is implemented; the
// website-health probe is left as a TODO for `lead-score` skill to populate
// via a second pass.

import { parseArgs } from "node:util";
import pg from "pg";

const { Client } = pg;

const NICHE_QUERIES = {
  electrician: "electrician",
  plumber: "plumber",
  hvac: "HVAC contractor",
  roofer: "roofer",
  gc: "general contractor",
};

const TARGET_METROS = new Set([
  "Lima", "Findlay", "Toledo", "Columbus", "Dayton",
]);

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

  const query = NICHE_QUERIES[niche];
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("q", query);
  url.searchParams.set("ll", `@${zip},${radius}z`);
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

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(JSON.stringify({ error: "api-key-missing", service: "database" }));
    process.exit(3);
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  let scraped = places.length;
  let inserted = 0;
  let duplicates = 0;
  let errors = 0;

  for (const p of places) {
    const phone = (p.phone || "").replace(/\D/g, "");
    const website = (p.website || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!phone && !website) { errors++; continue; }

    const dup = await client.query(
      "SELECT 1 FROM leads WHERE (phone = $1 AND $1 <> '') OR (website = $2 AND $2 <> '') LIMIT 1",
      [phone, website]
    );
    if (dup.rowCount > 0) { duplicates++; continue; }

    const city = p.address?.split(",").slice(-3, -2)[0]?.trim() || null;
    const state = p.address?.match(/\b([A-Z]{2})\b/)?.[1] || null;

    try {
      await client.query(
        `INSERT INTO leads (name, phone, website, niche, city, state, zip, gmaps_rating, review_count, stage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new')`,
        [p.title, phone || null, website || null, niche, city, state, zip, p.rating || null, p.reviews || null]
      );
      inserted++;
    } catch (e) {
      errors++;
    }
  }

  await client.end();

  console.log(JSON.stringify({ scraped, inserted, duplicates, errors, zip, niche }));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
