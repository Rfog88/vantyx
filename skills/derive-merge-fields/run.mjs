#!/usr/bin/env node
// derive-merge-fields — populate the per-lead merge fields (build #4) from data already
// on the lead row. Honest by construction: it only claims a probe_finding that the scan
// data actually supports, and only sets first_name from a confident self-identification.
//
//   probe_finding  Real website-health observation phrased for the owner. Priority:
//                  no-website (strongest) > broken/unreachable > no-ssl (objective, always
//                  credible) > looks-dated > stale-copyright > thin (visual/subjective —
//                  only when the site ISN'T independently rated STRONG). Else NULL.
//   timezone       IANA tz from state + zip (Eastern default; FL panhandle 324/325 and
//                  NW-Indiana 463/464 → Central).
//   first_name     Only from a clear owner self-ID in owner_bio; else NULL (drop salutation).
//
// Usage:
//   node run.mjs --lead-id <id> [--dry-run] [--json]
//   node run.mjs --all [--dry-run] [--json]
// Exit: 0 ok · 2 decision-needed · 3 adapter-broken

import { parseArgs } from "node:util";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (e) {
  console.error(JSON.stringify({ error: "adapter-broken", reason: "node_sqlite_unavailable",
    detail: "Bind NODE_OPTIONS=--experimental-sqlite.", message: e.message }));
  process.exit(3);
}

export function deriveProbeFinding(lead) {
  const age = String(lead.site_age_signal || "").toLowerCase().trim();
  const verdict = String(lead.site_quality_verdict || "").toUpperCase().trim();
  const noWebsite = !lead.website || !String(lead.website).trim() || /no-?website|no-?site/.test(age);
  const city = lead.city ? ` in ${lead.city}` : "";

  // Objective hard defects — always credible, regardless of verdict.
  if (noWebsite)
    return "you don't have a website that shows up when someone looks you up — they find your competitors instead";
  if (verdict === "BROKEN" || /unreachable|broken|down/.test(age))
    return "your website doesn't load when someone tries to open it — a dead link costs you the call";
  if (/no-?ssl/.test(age))
    return "your site isn't secure — there's no padlock, and phone browsers flash a warning that scares people off before they reach you";

  // Visual / subjective signals — only credible when the site isn't independently rated strong.
  if (verdict !== "STRONG") {
    if (/looks-like-201\d|dated|outdated|old\b/.test(age))
      return `your site looks dated next to the other electricians${city} — it reads like it's from about a decade ago`;
    if (/stale-?copyright/.test(age))
      return "your site still shows an old copyright year in the footer, which makes it look unattended";
    if (verdict === "WEAK")
      return "there's not much on your site for someone deciding whether to call — it comes across thin";
  }
  return null; // current/strong/blocked/none → no credible finding (Day-14 omits the clause)
}

export function deriveTimezone(lead) {
  const st = String(lead.state || "").toUpperCase().trim();
  const z3 = String(lead.zip || "").trim().slice(0, 3);
  if (st === "FL") return new Set(["324", "325"]).has(z3) ? "America/Chicago" : "America/New_York"; // panhandle = Central
  if (st === "IN") return new Set(["463", "464"]).has(z3) ? "America/Chicago" : "America/New_York"; // NW Indiana = Central
  return "America/New_York"; // OH/SC/FL-peninsula/IN-Indianapolis and default — Eastern
}

export function deriveFirstName(lead) {
  const bio = String(lead.owner_bio || "");
  const m = bio.match(/\b(?:i'?m|i am|my name is|owner[:,]?\s+|founded by|started by)\s+([A-Z][a-z]{1,15})\b/);
  if (m && !/^(The|Our|We|A|An|My|This|Owner|Founder|Family)$/i.test(m[1])) return m[1];
  return null; // conservative — drop the salutation rather than guess (spec decision #1)
}

function openDb() { return new DatabaseSync(process.env.LEADS_DB_PATH || "/home/paperclip/vantyx-leads.sqlite"); }

function applyOne(db, lead, dry) {
  const probe_finding = deriveProbeFinding(lead);
  const timezone = deriveTimezone(lead);
  const first_name = deriveFirstName(lead);
  if (!dry) {
    if (first_name) {
      db.prepare("UPDATE leads SET first_name=?, probe_finding=?, timezone=?, updated_at=datetime('now') WHERE id=?")
        .run(first_name, probe_finding, timezone, lead.id);
    } else {
      db.prepare("UPDATE leads SET probe_finding=?, timezone=?, updated_at=datetime('now') WHERE id=?")
        .run(probe_finding, timezone, lead.id);
    }
  }
  return { id: lead.id, name: lead.name, first_name, timezone, probe_finding };
}

const COLS = "id,name,city,state,zip,website,site_age_signal,site_quality_verdict,owner_bio,first_name";

async function main() {
  const { values } = parseArgs({ options: {
    "lead-id": { type: "string" }, all: { type: "boolean" }, "dry-run": { type: "boolean" }, json: { type: "boolean" },
  } });
  const dry = !!values["dry-run"];
  const db = openDb();

  if (values["lead-id"]) {
    const lead = db.prepare(`SELECT ${COLS} FROM leads WHERE id=?`).get(values["lead-id"]);
    if (!lead) { db.close(); console.error(JSON.stringify({ error: "decision-needed", reason: "lead-id not found" })); process.exit(2); }
    const r = applyOne(db, lead, dry);
    db.close();
    console.log(JSON.stringify({ dry_run: dry, ...r }, null, values.json ? 2 : 0));
    return;
  }
  if (!values.all) { db.close(); console.error(JSON.stringify({ error: "decision-needed", reason: "provide --lead-id or --all" })); process.exit(2); }

  const leads = db.prepare(`SELECT ${COLS} FROM leads`).all();
  const summary = { dry_run: dry, total: leads.length, with_finding: 0, no_finding: 0, with_first_name: 0, by_tz: {} };
  const rows = [];
  for (const lead of leads) {
    const r = applyOne(db, lead, dry);
    if (r.probe_finding) summary.with_finding++; else summary.no_finding++;
    if (r.first_name) summary.with_first_name++;
    summary.by_tz[r.timezone] = (summary.by_tz[r.timezone] || 0) + 1;
    rows.push(r);
  }
  db.close();
  console.log(JSON.stringify(values.json ? { ...summary, rows } : summary, null, values.json ? 2 : 0));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("run.mjs")) {
  main().catch((e) => { console.error(JSON.stringify({ error: "unknown-failure", message: e.message })); process.exit(1); });
}
