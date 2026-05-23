#!/usr/bin/env node
// kpi-rollup — morning digest of yesterday's lead-pipeline + agent metrics.
// Posts via board-notify Tier 0 only if delta-worthy.
//
// Invocation: node skills/kpi-rollup/run.mjs [--window daily|weekly]

import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

async function leadsMetrics(client, hours) {
  const r = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE created_at > now() - interval '${hours} hours') AS scraped,
      COUNT(*) FILTER (WHERE created_at > now() - interval '${hours} hours' AND score >= 65) AS high_score,
      COUNT(*) FILTER (WHERE updated_at > now() - interval '${hours} hours' AND stage = 'demo_built') AS demos_built,
      COUNT(*) FILTER (WHERE updated_at > now() - interval '${hours} hours' AND stage = 'outreach_sent') AS outreach_sent
    FROM leads
  `);
  return r.rows[0];
}

async function priorAverages(client, hours, days) {
  // 7-day moving average for the same window.
  const r = await client.query(`
    SELECT
      AVG(daily.scraped) AS scraped_avg,
      AVG(daily.high_score) AS high_score_avg,
      AVG(daily.demos_built) AS demos_built_avg
    FROM (
      SELECT
        date_trunc('day', created_at) AS d,
        COUNT(*) AS scraped,
        COUNT(*) FILTER (WHERE score >= 65) AS high_score,
        COUNT(*) FILTER (WHERE stage = 'demo_built') AS demos_built
      FROM leads
      WHERE created_at > now() - interval '${days} days' AND created_at < now() - interval '${hours} hours'
      GROUP BY 1
    ) daily
  `);
  return r.rows[0];
}

function deltaPct(actual, avg) {
  const a = parseFloat(avg) || 0;
  if (a === 0) return actual > 0 ? 100 : 0;
  return ((parseFloat(actual) - a) / a) * 100;
}

async function postDigest(payload) {
  const proc = spawnSync(
    "node",
    [resolve(repoRoot, "skills", "board-notify", "run.mjs")],
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

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(JSON.stringify({ error: "api-key-missing", service: "database" }));
    process.exit(3);
  }
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  const m = await leadsMetrics(client, hours);
  const avg = await priorAverages(client, hours, baselineDays);
  await client.end();

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
