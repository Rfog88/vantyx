#!/usr/bin/env node
// kpi-rollup — morning digest of yesterday's lead-pipeline metrics.
// Posts via board-notify Tier 0 only if delta-worthy.
//
// Storage: node:sqlite (requires NODE_OPTIONS=--experimental-sqlite on Node 22.x).
//
// Invocation: node skills/kpi-rollup/run.mjs [--window daily|weekly]

import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

const here = dirname(fileURLToPath(import.meta.url));

// Locate a sibling skill's run.mjs. Skills are installed under
// `<root>/__catalog__/<name>--<hash>/run.mjs`, so resolve by scanning the
// parent catalog for an entry that matches the skill name (with or without
// the `--<hash>` suffix). Falls back to `<root>/skills/<name>/run.mjs` for
// dev layouts where skills live as plain directories.
function resolveSiblingSkill(name) {
  const catalogDir = dirname(here);
  if (existsSync(catalogDir) && statSync(catalogDir).isDirectory()) {
    const entries = readdirSync(catalogDir);
    const match = entries.find((d) => d === name || d.startsWith(`${name}--`));
    if (match) {
      const p = resolve(catalogDir, match, "run.mjs");
      if (existsSync(p)) return p;
    }
  }
  const devPath = resolve(here, "..", "..", "skills", name, "run.mjs");
  if (existsSync(devPath)) return devPath;
  throw new Error(`sibling skill not found: ${name} (searched ${catalogDir} and ${devPath})`);
}

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

function leadsMetrics(db, hours) {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN created_at > datetime('now', '-${hours} hours') THEN 1 ELSE 0 END) AS scraped,
      SUM(CASE WHEN created_at > datetime('now', '-${hours} hours') AND score >= 65 THEN 1 ELSE 0 END) AS high_score,
      SUM(CASE WHEN updated_at > datetime('now', '-${hours} hours') AND stage = 'demo_built' THEN 1 ELSE 0 END) AS demos_built,
      SUM(CASE WHEN updated_at > datetime('now', '-${hours} hours') AND stage = 'outreach_sent' THEN 1 ELSE 0 END) AS outreach_sent
    FROM leads
  `).get();
  return {
    scraped: row?.scraped || 0,
    high_score: row?.high_score || 0,
    demos_built: row?.demos_built || 0,
    outreach_sent: row?.outreach_sent || 0,
  };
}

function priorAverages(db, hours, days) {
  // Average daily count over the prior `days` days, excluding the most recent window.
  const row = db.prepare(`
    SELECT
      AVG(daily.scraped) AS scraped_avg,
      AVG(daily.high_score) AS high_score_avg,
      AVG(daily.demos_built) AS demos_built_avg
    FROM (
      SELECT
        date(created_at) AS d,
        COUNT(*) AS scraped,
        SUM(CASE WHEN score >= 65 THEN 1 ELSE 0 END) AS high_score,
        SUM(CASE WHEN stage = 'demo_built' THEN 1 ELSE 0 END) AS demos_built
      FROM leads
      WHERE created_at > datetime('now', '-${days} days')
        AND created_at < datetime('now', '-${hours} hours')
      GROUP BY 1
    ) daily
  `).get();
  return {
    scraped_avg: row?.scraped_avg || 0,
    high_score_avg: row?.high_score_avg || 0,
    demos_built_avg: row?.demos_built_avg || 0,
  };
}

function deltaPct(actual, avg) {
  const a = parseFloat(avg) || 0;
  if (a === 0) return actual > 0 ? 100 : 0;
  return ((parseFloat(actual) - a) / a) * 100;
}

async function postDigest(payload) {
  let scriptPath;
  try { scriptPath = resolveSiblingSkill("board-notify"); }
  catch (e) { return { status: "error", reason: "board_notify_not_found", message: e.message }; }
  const proc = spawnSync(
    "node",
    [scriptPath],
    { input: JSON.stringify(payload), encoding: "utf8" }
  );
  if (proc.status !== 0) return { status: "error", stderr: proc.stderr };
  return { status: "ok" };
}

async function main() {
  const { values } = parseArgs({ options: { window: { type: "string", default: "daily" } } });
  const isWeekly = values.window === "weekly";
  const hours = isWeekly ? 168 : 24;
  const baselineDays = isWeekly ? 28 : 7;

  const db = openDb();
  const m = leadsMetrics(db, hours);
  const avg = priorAverages(db, hours, baselineDays);
  db.close();

  const deltas = [
    { name: "scraped",       value: m.scraped,       delta: deltaPct(m.scraped, avg.scraped_avg) },
    { name: "≥65 score",     value: m.high_score,    delta: deltaPct(m.high_score, avg.high_score_avg) },
    { name: "demos built",   value: m.demos_built,   delta: deltaPct(m.demos_built, avg.demos_built_avg) },
    { name: "outreach sent", value: m.outreach_sent, delta: null },
  ];

  const meaningful = deltas.some(d => d.delta !== null && Math.abs(d.delta) >= 15);
  if (!meaningful) {
    console.log(JSON.stringify({ posted: false, reason: "no_meaningful_delta", deltas }));
    return;
  }

  const body = deltas
    .map(d => `- ${d.name}: ${d.value}${d.delta !== null ? ` (${d.delta > 0 ? "+" : ""}${d.delta.toFixed(0)}% vs ${baselineDays}d avg)` : ""}`)
    .join("\n");

  const result = await postDigest({
    tier: 0,
    title: `Vantyx ${isWeekly ? "weekly" : "daily"} KPI rollup`,
    body,
  });

  console.log(JSON.stringify({ posted: true, deltas, notify: result }));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
